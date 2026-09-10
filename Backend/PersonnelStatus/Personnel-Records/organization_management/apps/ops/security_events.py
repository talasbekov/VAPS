"""Жизненный цикл охранного мероприятия (ОМ) — серверная реализация контракта
клиента (entities/security-event): bulletin → recon → demand → forces →
placement → approval → acknowledgement → conduct → closed.

Правила и тексты повторяют мок-слой клиента (mocks/ops/security-events-
handlers.ts) ДОСЛОВНО — он был первой реализацией контракта, и экран написан
под его исходы. Расхождение в правиле здесь оторвало бы карточку от реестра.

ЗАМОК АГРЕГАТА. Все мутации перечитывают событие под select_for_update:
коллекции этапов лежат JSONB-полями одной строки, и без замка две
конкурентные правки затирали бы друг друга по последнему save. Гварды стадий
исполняются ПОСЛЕ замка — по свежей строке, а не по той, что видел клиент.
"""
import datetime as dt
import hashlib
import logging
import re
from uuid import uuid4

from django.db import transaction
from django.utils import timezone
from django.utils.dateparse import parse_datetime

from organization_management.apps.operations import audit_service
from organization_management.apps.ops import approval_route as approval_route_service
from organization_management.apps.operations.clock import Clock
from organization_management.apps.operations.exceptions import DomainError
from organization_management.apps.operations.models_event import (
    OpsPlacementDocumentVersion,
    OpsSecurityEvent,
    OpsSecurityEventTransition,
    OpsSecurityEventVisitObject,
    OpsVisitObjectDeputy,
)
from organization_management.apps.operations.models_gvo import (
    OpsProtectedPerson,
)
from organization_management.apps.operations.models_object import (
    OpsPassportVersion,
    OpsSecurityObject,
)

# Побочные каналы (уведомления) свои отказы не роняют наверх, но и не молчат:
# след остаётся в журнале процесса — как у `operations.notify_service`.
logger = logging.getLogger(__name__)

# Шаблон чек-листа рекогносцировки нового ОМ (порт мок-фикстуры).
RECON_CHECKLIST_TEMPLATE = [
    "Подъездные пути и парковка",
    "Периметр и ограждение",
    "Входные группы и КПП",
    "Пути эвакуации",
    "Связь и электропитание",
]


def new_recon_checklist():
    """Новый независимый чек-лист объекта."""
    return [
        {
            "id": f"checklist-{index}",
            "label": label,
            "state": "UNCHECKED",
            "required": True,
            "done": False,
            "result": None,
            "comment": "",
        }
        for index, label in enumerate(RECON_CHECKLIST_TEMPLATE)
    ]

# Состояние пункта чек-листа (`[РЕК-04]`, Plane №443): ОДИН переключатель
# «Норма / Замечание / Не проверено» вместо чекбокса и select. Старые ключи
# `done`/`result` ВЫВОДЯТСЯ из состояния и остаются для прежних читателей
# (документы, сид, пробы) — снимаются отдельным шагом.
CHECK_STATES = ("NORMAL", "REMARK", "UNCHECKED")


#: Идентификаторы пунктов ШАБЛОНА и их обязательность (Plane №541).
#:
#: Пункты шаблона заводит `create_event` под именами `checklist-<индекс>`, и
#: обязательны они ВСЕ — это правило `[РЕК-07]`, а не поле формы.
TEMPLATE_CHECK_IDS = frozenset(
    f"checklist-{index}" for index in range(len(RECON_CHECKLIST_TEMPLATE))
)


def _required_of(item):
    """Обязателен ли пункт — по ШАБЛОНУ, а не по телу запроса (Plane №541).

    🔴 ПРОВЕРКА, КОТОРУЮ МОЖНО ВЫКЛЮЧИТЬ СНАРУЖИ, ПРОВЕРКОЙ НЕ ЯВЛЯЕТСЯ.
    Признак брался прямо из присланного (`bool(item.get("required", True))`), а
    `complete_recon` отказывается закрывать этап только из-за обязательных
    пунктов. Значит любой клиент, вернувший чек-лист с `required: false`, снимал
    правило `[РЕК-07]` целиком — и для этого не нужен злой умысел, довольно
    клиента, который теряет поле при сериализации. На экране при этом всё
    выглядело рабочим.

    Пункт ШАБЛОНА обязателен всегда; присланное значение у него игнорируется.
    Пункт, дописанный человеком (свой `id`), обязательности не наследует —
    он не часть `[РЕК-07]`, и его признак остаётся за тем, кто его завёл.
    """
    if str(item.get("id") or "") in TEMPLATE_CHECK_IDS:
        return True
    return bool(item.get("required", True))


def normalize_check_item(item):
    """Пункт чек-листа с согласованными `state`, `done`, `result`."""
    if item.get("result") == "NEEDS_CHANGES":
        derived = "REMARK"
    elif item.get("done") or item.get("result") == "MATCHES":
        derived = "NORMAL"
    else:
        derived = "UNCHECKED"
    state = item.get("state")
    # 🔴 ЯВНОЕ СОСТОЯНИЕ ПОБЕЖДАЕТ ВСЕГДА (Plane №538). Здесь стояла оговорка
    # «кроме случая, когда старый клиент прислал `done: True` поверх „Не
    # проверено“ — тогда верим старым ключам». Писалась она под клиента,
    # который про `state` не знает вовсе, а попадал под неё ТЕКУЩИЙ: экран
    # мержит патч на существующий пункт, поэтому вместе с
    # `state: "UNCHECKED"` наверх уезжают унаследованные `done: true` и
    # `result: "MATCHES"`. Сервер выводил `derived = "NORMAL"` и переписывал
    # состояние обратно — кнопка «Не проверено» не действовала вовсе, счётчик
    # «Проверено K из N» не уменьшался, а `complete_recon` переставал держать
    # этап.
    #
    # Старый клиент по-прежнему обслужен ПЕРВЫМ условием: он `state` не
    # присылает, значит состояние выводится из `done`/`result`, как и раньше.
    # Оговорка защищала не его, а гипотетического клиента, который присылает
    # ОБА набора ключей и хочет, чтобы победили старые, — такого нет.
    if state not in CHECK_STATES:
        state = derived
    return {
        **item,
        "state": state,
        "required": _required_of(item),
        "done": state != "UNCHECKED",
        "result": {"NORMAL": "MATCHES", "REMARK": "NEEDS_CHANGES"}.get(state),
        "comment": str(item.get("comment", "")).strip(),
    }


NO_PUBLISHED_VERSION_TEXT = (
    "На дату мероприятия нет опубликованной версии паспорта объекта — "
    "расчёт постов ведётся вручную."
)

# Готовность стадии — демонстрационная метрика прототипа; значения задаются
# переходом (порт мока), а не выводятся, и владелец у них один — эта карта.
STAGE_READINESS = {
    "BULLETIN": 0,
    "RECON": 15,
    "DEMAND": 30,
    "FORCES": 45,
    "PLACEMENT": 60,
    "APPROVAL": 75,
    "ACKNOWLEDGEMENT": 85,
    "CONDUCT": 95,
    "CLOSED": 100,
}


def _now_iso():
    return Clock.now().isoformat()


def _validation(field_errors, message="Проверьте заполнение формы."):
    return DomainError("VALIDATION_ERROR", 400, detail=field_errors, message=message)


def _not_found(entity_message, entity_id):
    return DomainError(
        "ENTITY_NOT_FOUND", 404, detail={"id": str(entity_id)}, message=entity_message
    )


def _require_stage(event, stage, message):
    if event.stage != stage:
        raise DomainError("INVALID_STAGE_TRANSITION", 422, message= message)


def _require_visit_stage(visit, stages, message):
    """То же для операции НАД ОБЪЕКТОМ: спрашиваем стадию ЕГО, а не ОМ.

    🔴 ПОЧЕМУ ЭТОГО НЕ ДЕЛАЕТ `_require_stage` (Plane №475). Стадия
    мероприятия — НАИМЕНЬШАЯ среди объектов (`recompute_event_stage`), и это
    задумано: карточка показывает, докуда дошло самое отстающее место. Пока
    этап был один на мероприятие, разницы между «стадией ОМ» и «стадией
    объекта» не было; после переезда этапов на объекты (`[МД-04]`, №411)
    охранять действие над объектом стадией мероприятия стало значить «пусть
    сосед решает за тебя».

    Чем это било: возврат объекта А на доработку ронял стадию ОМ до
    «Расстановки», и у объекта Б переставали работать ВСЕ действия
    согласования разом — 422 на каждой живой кнопке. Из интерфейса выхода не
    было: последняя подпись по Б тоже не закрывала этап (автозавершение
    выходило по тому же условию), а ручной кнопки «Завершить этап» у
    согласующего нет (`[СОГ-11]`, №446). Возврат при этом — ход штатный, а не
    редкий, так что любое ОМ с двумя объектами вставало при первом же.

    `stages` — строка или набор: у отправки на согласование их два, и это не
    послабление, а `[СОГ-04]` («любое изменение = новая версия → повторное
    согласование»). Уже согласованный объект стоит на «Ознакомлении», и
    отправка новой версии обязана быть ему доступна — иначе согласованную
    расстановку нельзя пересогласовать вовсе.

    Отказ несёт `visitObjectId`: без него сообщение «можно только на этапе
    …» на карточке с несколькими объектами не говорит, о котором из них речь.
    """
    allowed = (stages,) if isinstance(stages, str) else tuple(stages)
    if visit.stage in allowed:
        return
    raise DomainError(
        "INVALID_STAGE_TRANSITION",
        422,
        detail={"visitObjectId": str(visit.pk), "stage": visit.stage},
        message=message,
    )


def lock_event(event_id):
    """Событие под замком агрегата; незнакомый id — 404 с конвертом.

    Только для ПРАВКИ. Чистое чтение берёт `read_event` ниже: замок строки
    держится до конца транзакции и выстраивает в очередь все параллельные
    переходы этапа (Plane №647).
    """
    if not str(event_id).isdigit():
        raise _not_found("Мероприятие не найдено.", event_id)
    event = (
        OpsSecurityEvent.objects.select_for_update().filter(pk=event_id).first()
    )
    if event is None:
        raise _not_found("Мероприятие не найдено.", event_id)
    return event


def read_event(event_id):
    """Событие ДЛЯ ЧТЕНИЯ — без `SELECT … FOR UPDATE` (Plane №647).

    Отличается от `lock_event` ровно замком, и отказы у них одинаковые: 404 с
    тем же конвертом на незнакомом и на нечисловом id — читатель не должен
    угадывать по коду ответа, какой из двух путей его обслужил.

    Зачем отдельная функция, а не «просто `.first()`» на месте вызова: правило
    «читаем без замка» должно быть названо один раз и одним именем, иначе
    следующий читатель снова возьмёт `lock_event` — он ближе и выглядит
    привычнее.
    """
    if not str(event_id).isdigit():
        raise _not_found("Мероприятие не найдено.", event_id)
    event = OpsSecurityEvent.objects.filter(pk=event_id).first()
    if event is None:
        raise _not_found("Мероприятие не найдено.", event_id)
    return event


# ── Привязка версии паспорта ────────────────────────────────────────────────


def resolve_applicable_version(security_object, business_date):
    """Версия, действующая на дату: последняя по номеру среди тех, чей
    effective_from не позже даты; None — подходящей публикации нет."""
    return (
        OpsPassportVersion.objects.filter(
            security_object=security_object, effective_from__lte=business_date
        )
        .order_by("-version_number")
        .first()
    )


def bind_passport_version(security_object, version, bound_at):
    return {
        "objectId": str(security_object.pk),
        "objectName": security_object.name,
        "versionId": str(version.pk),
        "versionNumber": version.version_number,
        "effectiveFrom": version.effective_from.isoformat(),
        "boundAt": bound_at,
    }


# ── Создание ────────────────────────────────────────────────────────────────


@transaction.atomic
def _creator_account_id(actor):
    """Идентификатор учётки создателя или пустая строка для системного актора."""
    value = "" if actor is None else str(actor).strip()
    return value if value.isdigit() else ""


def create_event(
    *,
    title,
    object_id,
    business_date,
    business_date_end=None,
    kind=None,
    event_time=None,
    protected_person_id=None,
    protected_person_ids=None,
    location=None,
    # Локация структурой и атрибуты лиц (Plane №418) — см. `event_location`.
    country_id=None,
    city_id=None,
    address=None,
    protected_person_details=None,
    chief_employee_id=None,
    actor,
):
    from organization_management.apps.ops import event_location as loc

    field_errors = {}
    title = str(title or "").strip()
    if title == "":
        field_errors["title"] = ["Обязательное поле."]
    # Объект НЕОБЯЗАТЕЛЕН (решение заказчика 24.08): бюллетень заводят, когда
    # маршрут ещё не согласован, и объекты дописывают позже кнопкой у строки
    # реестра. Без объекта не будет привязки паспорта — а значит и импорта
    # постов на рекогносцировке; это не молчаливая потеря: импорт отвечает
    # NO_PASSPORT_VERSION со своим текстом.
    object_id = str(object_id or "").strip()
    # Тип — обязателен: от него зависят маршрут согласования и старший. У
    # строк, заведённых до появления поля, он NULL, но новые без него не
    # заводятся (иначе легаси-пробел рос бы дальше).
    kind = str(kind or "").strip()
    if kind == "":
        field_errors["kind"] = ["Обязательное поле."]
    elif kind not in dict(OpsSecurityEvent.Kind.choices):
        field_errors["kind"] = ["Неизвестный тип мероприятия."]
    try:
        parsed_date = dt.date.fromisoformat(str(business_date or ""))
    except ValueError:
        parsed_date = None
        field_errors["businessDate"] = ["Укажите дату в формате ГГГГ-ММ-ДД."]
    parsed_end = None
    raw_end = str(business_date_end or "").strip()
    if raw_end != "":
        try:
            parsed_end = dt.date.fromisoformat(raw_end)
        except ValueError:
            field_errors["businessDateEnd"] = [
                "Укажите дату в формате ГГГГ-ММ-ДД."
            ]
        else:
            # Окончание раньше начала — не «пустое поле», а неверный факт:
            # из такой пары нельзя посчитать ни продолжительность, ни убытие.
            if parsed_date is not None and parsed_end < parsed_date:
                field_errors["businessDateEnd"] = [
                    "Дата окончания раньше даты начала."
                ]
    parsed_time = None
    raw_time = str(event_time or "").strip()
    if raw_time != "":
        try:
            # Браузерный <input type="time"> шлёт «ЧЧ:ММ», но с включёнными
            # секундами — «ЧЧ:ММ:СС»; принимаем оба.
            parsed_time = dt.time.fromisoformat(raw_time)
        except ValueError:
            field_errors["eventTime"] = ["Укажите время в формате ЧЧ:ММ."]
    location = str(location or "").strip()
    if len(location) > 255:
        field_errors["location"] = ["Не длиннее 255 символов."]
    country, city, address = loc.resolve_location(
        country_id=country_id, city_id=city_id, address=address,
        field_errors=field_errors,
    )
    # Структура названа — строка собирается из неё; названа только строка
    # (вызовы до №418) — она и есть адрес. Читатели `location` не меняются.
    if country is not None or city is not None or address:
        location = loc.compose_location(country, city, address)
    elif location and not address:
        address = location
    person_details = loc.parse_person_details(protected_person_details, field_errors)

    # ЛИЦ МОЖЕТ БЫТЬ НЕСКОЛЬКО (Plane №188), и старое одиночное поле принимается
    # ПО-ПРЕЖНЕМУ: его шлют мок-слой, сиды и все вызовы, написанные до №188.
    # Снять его вместе с вводом списка значило бы починить окно и сломать всё
    # остальное в тот же заход.
    #
    # Прислали оба — список главнее: он подробнее, а одиночное поле в такой
    # паре означает лишь «главное лицо», и оно всё равно вычисляется как первое
    # в списке.
    if protected_person_ids is not None:
        persons = resolve_protected_persons(protected_person_ids, field_errors)
    else:
        persons = resolve_protected_persons(
            [protected_person_id], field_errors, field="protectedPersonId"
        )
    person = persons[0] if persons else None

    chief = None
    raw_chief = str(chief_employee_id or "").strip()
    if raw_chief != "":
        chief = _find_personnel(raw_chief)
        if chief is None:
            field_errors["chiefEmployeeId"] = ["Сотрудник не найден."]

    security_object = None
    if not field_errors and object_id != "":
        security_object = (
            OpsSecurityObject.objects.filter(pk=object_id).first()
            if object_id.isdigit()
            else None
        )
        if security_object is None:
            field_errors["objectId"] = ["Объект не найден в реестре."]
    if field_errors:
        raise _validation(field_errors)

    now = _now_iso()
    # Мероприятие С ОБЪЕКТОМ заводится СРАЗУ на рекогносцировке (задача
    # заказчика «Реестр ОМ-5»): в эталоне рекогносцировка — первый шаг
    # цепочки, а стадия «Бюллетень» своего шага не имеет с 24.08.2026 —
    # сведения бюллетеня заполняются панелью НАД этапами и правятся на любой
    # стадии. Без объекта осматривать нечего: ОМ остаётся на «Бюллетене», и
    # карточка зовёт добавить объект посещения.
    initial_stage = "RECON" if security_object is not None else "BULLETIN"
    # Номер — СЛЕДУЮЩИЙ ЗА НАИБОЛЬШИМ выданным в этом году, а не «count + 1».
    # Счёт строк ломается от удаления: после чистки реестра от пробных строк
    # (Plane «Реестр ОМ-34», 230 удалённых) `count + 1` стал указывать на
    # номера, которые давно заняты, и КАЖДОЕ создание падало 500 на
    # уникальности кода. Номер — не количество строк, а счётчик выданных.
    prefix = f"ОМ-{parsed_date.year}-"
    issued = [
        int(code[len(prefix):])
        for code in OpsSecurityEvent.objects.filter(
            code__startswith=prefix
        ).values_list("code", flat=True)
        if code[len(prefix):].isdigit()
    ]
    number = (max(issued) + 1) if issued else 1
    binding = None
    if security_object is not None:
        applicable = resolve_applicable_version(security_object, parsed_date)
        if applicable is not None:
            binding = bind_passport_version(security_object, applicable, now)
    event = OpsSecurityEvent.objects.create(
        code=f"ОМ-{parsed_date.year}-{number}",
        title=title,
        security_object=security_object,
        # Пустое имя — «объект не выбран», а не «объект без названия»: экраны
        # различают это словами (см. реестр и карточку ОМ).
        object_name="" if security_object is None else security_object.name,
        passport_binding=binding,
        business_date=parsed_date,
        business_date_end=parsed_end,
        kind=kind,
        event_time=parsed_time,
        protected_person=person,
        # Снимок подписи рядом со ссылкой — как object_name у объекта: скрытие
        # лица из справочника не должно стирать имя из истории.
        protected_person_name=person.name if person is not None else "",
        location=location,
        country=country,
        city=city,
        address=address,
        chief_employee_id=chief.pk if chief is not None else None,
        chief_name=personnel_display_name(chief) if chief is not None else "",
        stage=initial_stage,
        readiness_percent=STAGE_READINESS[initial_stage],
        force_need=0,
        conflicts_count=0,
        # Подпись, а не id учётки: поле уходит на экран карточки и в значения
        # фильтра реестра. Идентификатор остаётся аудиту — ему нужен именно он.
        owner_name=actor_display_name(actor),
        # Идентификатор создателя — ЗДЕСЬ, одним сохранением со строкой (Plane
        # №949, ревью №825 по №947). Вьюха ставила его вторым `save` после
        # коммита сервиса: ОМ жил «ничьим» между сохранениями, а сиды и любой
        # другой вызыватель создателя не получали вовсе. Только идентификатор
        # учётки (`resolve_actor_id` → цифры): системная метка сида в поле
        # «id учётки» — ложь о типе.
        owner_actor_id=_creator_account_id(actor),
        brief_description="",
        initial_tasks="",
        recon_checklist=new_recon_checklist(),
        recon_sector_posts=[],
        demand_rows=[],
        demand_approved=False,
        force_requests=[],
        placement_assignments=[],
        approval_status="PENDING",
        approval_comment="",
        journal_entries=[],
        closure_direction_summaries=[],
        closed_at=None,
    )
    # Объект посещения заводится вместе с бюллетенем — но только если объект
    # ВЫБРАН: у ОМ без объекта раскрытие строки честно пусто («объекты
    # посещения не заведены»), и там же стоит кнопка их добавить.
    # Связь заполняется ПОСЛЕ создания: у M2M нет иного способа: строки
    # `OpsSecurityEvent` до сохранения ещё не существует.
    if persons:
        event.protected_persons.set(persons)
        loc.apply_person_details(event, person_details)
    if security_object is not None:
        OpsSecurityEventVisitObject.objects.create(
            event=event,
            security_object=security_object,
            object_name=security_object.name,
            passport_binding=binding,
            protected_person=person,
            protected_person_name=person.name if person is not None else "",
            # СТАРШИЙ НАСЛЕДУЕТСЯ ОТ МЕРОПРИЯТИЯ (Plane №190). Заказчик:
            # «При создании бюллетени выбираешь старшего наряда, но после
            # создания бюллетени объект не имеет старшего». Так и было:
            # окно спрашивало старшего, клало его мероприятию, а первый
            # объект заводился пустым — человек видел «старший не назначен»
            # сразу после того, как его назначил.
            #
            # Наследование действует ТОЛЬКО на объект, заведённый вместе с
            # бюллетенем. Объекты, дописанные позже кнопкой «+», старшего не
            # получают: у визита иностранного ОЛ на каждом объекте свой
            # ответственный, и подставлять туда старшего наряда значило бы
            # назначить его молча — ровно та ошибка, от которой уходим.
            chief_employee_id=chief.pk if chief is not None else None,
            chief_name=personnel_display_name(chief) if chief is not None else "",
            recon_checklist=new_recon_checklist(),
            position=0,
            # Стадия объекта — стадия мероприятия с первой секунды (Plane
            # №412). Без этого ОМ, заведённое сразу на рекогносцировке,
            # получало объект на «Бюллетене», и карточка звала заполнять
            # бюллетень, который сервер уже закрыл.
            stage=initial_stage,
        )
    record_transition(event, None, initial_stage)
    audit_service.record(
        actor=actor,
        action=audit_service.SECURITY_EVENT_CREATED,
        entity_type=audit_service.ENTITY_SECURITY_EVENT,
        entity_id=event.pk,
        new_value={
            "code": event.code,
            "title": event.title,
            "businessDate": event.business_date.isoformat(),
        },
    )
    return event


# ── Правка бюллетеня ────────────────────────────────────────────────────────


@transaction.atomic
def update_bulletin_details(
    event_id,
    *,
    title=None,
    business_date=None,
    business_date_end=None,
    event_time=None,
    protected_person_id=None,
    protected_person_ids=None,
    location=None,
    country_id=None,
    city_id=None,
    address=None,
    protected_person_details=None,
    actor,
):
    """Править СВЕДЕНИЯ бюллетеня после создания (Plane №192).

    Заказчик: «Нету кнопки Редактировать». Её и не было чем сделать: у
    мероприятия не существовало ни одной ручки правки — `PATCH .../bulletin/`
    меняет только описание и первичные задачи, а название, дата, время,
    охраняемое лицо и локация задавались один раз в окне создания и застывали
    навсегда. Опечатка в названии жила до удаления мероприятия.

    ЧТО ЗДЕСЬ ПРАВИТСЯ И ЧТО НЕТ — граница проведена по последствиям, а не по
    удобству:

    * **правятся** название, период, время, охраняемое лицо, локация — это
      сведения бюллетеня, они ни на что в системе не завязаны и меняются
      ровно так же, как их однажды ввели;
    * **тип мероприятия НЕ правится**: от него зависят маршрут согласования и
      кто считается старшим (наряда против ГВО). Смена типа на полпути
      означала бы другую цепочку у мероприятия, которое уже идёт по этой —
      это не правка сведений, а другое мероприятие;
    * **объекты НЕ правятся** — у них свои ручки (`visit-objects`), и они
      несут паспорта и расстановку;
    * **старший НЕ правится** — у него своя ручка с №190 и своя запись
      журнала.

    ОТСУТСТВУЮЩИЙ КЛЮЧ — НЕ ПУСТОЕ ЗНАЧЕНИЕ. `None` означает «поле не
    прислали, не трогай»; пустая строка — «очисти». Разница существенна для
    охраняемого лица и локации: их законно снимают, и трактовать «не прислали»
    как «сними» значило бы стирать данные при частичной правке.

    Закрытое мероприятие — история: сведения отработавшего наряда не
    переписываются.
    """
    event = lock_event(event_id)
    if event.stage == "CLOSED":
        raise DomainError(
            "INVALID_STAGE_TRANSITION",
            422,
            message="Мероприятие закрыто — сведения бюллетеня не меняются.",
        )

    # Снимок ДО правки берётся сразу: ниже поля меняются прямо на объекте, и
    # читать «как было» после этого пришлось бы отдельным запросом в базу —
    # приём рабочий, но при первом же перемещении строки он молча начинает
    # показывать уже НОВОЕ значение.
    before = {
        "code": event.code,
        "title": event.title,
        "businessDate": event.business_date.isoformat(),
        "protectedPersonName": event.protected_person_name,
        "location": event.location,
    }
    field_errors = {}
    updates = []

    if title is not None:
        new_title = str(title).strip()
        if new_title == "":
            field_errors["title"] = ["Обязательное поле."]
        else:
            event.title = new_title
            updates.append("title")

    # Даты разбираются ВМЕСТЕ, даже если прислали одну: правило «окончание не
    # раньше начала» связывает их, и проверять новую дату против старой пары
    # надо на той паре, которая получится, а не на той, что была.
    new_start = event.business_date
    if business_date is not None:
        try:
            new_start = dt.date.fromisoformat(str(business_date))
        except ValueError:
            field_errors["businessDate"] = ["Укажите дату в формате ГГГГ-ММ-ДД."]
            new_start = None

    new_end = event.business_date_end
    if business_date_end is not None:
        raw_end = str(business_date_end).strip()
        if raw_end == "":
            new_end = None
        else:
            try:
                new_end = dt.date.fromisoformat(raw_end)
            except ValueError:
                field_errors["businessDateEnd"] = [
                    "Укажите дату в формате ГГГГ-ММ-ДД."
                ]
                new_end = None

    if (
        "businessDate" not in field_errors
        and "businessDateEnd" not in field_errors
        and new_start is not None
        and new_end is not None
        and new_end < new_start
    ):
        field_errors["businessDateEnd"] = ["Дата окончания раньше даты начала."]

    if event_time is not None:
        raw_time = str(event_time).strip()
        if raw_time == "":
            event.event_time = None
            updates.append("event_time")
        else:
            try:
                # Браузерный <input type="time"> шлёт «ЧЧ:ММ», но с
                # включёнными секундами — «ЧЧ:ММ:СС»; принимаем оба.
                event.event_time = dt.time.fromisoformat(raw_time)
                updates.append("event_time")
            except ValueError:
                field_errors["eventTime"] = ["Укажите время в формате ЧЧ:ММ."]

    from organization_management.apps.ops import event_location as loc

    if location is not None:
        new_location = str(location).strip()
        if len(new_location) > 255:
            field_errors["location"] = ["Не длиннее 255 символов."]
        else:
            event.location = new_location
            updates.append("location")
    # Структура (Plane №418): любой из трёх ключей — правка локации, строка
    # `location` пересобирается из структуры. Ключа нет — поле не трогается.
    if country_id is not None or city_id is not None or address is not None:
        next_country = country_id if country_id is not None else event.country_id
        next_city = city_id if city_id is not None else event.city_id
        # 🔴 СКРЫТЫЙ ГОРОД НЕ ЗАПИРАЕТ МЕРОПРИЯТИЕ (Plane №617/№495). Строгую
        # проверку `is_active` проходят ТОЛЬКО ИЗМЕНЁННЫЕ координаты: id,
        # совпадающий с уже сохранённым, — не новый ввод, а то, что было
        # выбрано раньше. Окно правки шлёт `countryId`/`cityId` всегда, поэтому
        # «не прислали» здесь не годится как признак: после скрытия города
        # ЛЮБАЯ правка бюллетеня — переименование, время, лица — отвечала 400
        # про поле, которого человек не касался.
        unchanged = []
        if str(next_country or "") == str(event.country_id or ""):
            unchanged.append("countryId")
        if str(next_city or "") == str(event.city_id or ""):
            unchanged.append("cityId")
        country, city, new_address = loc.resolve_location(
            country_id=next_country,
            city_id=next_city,
            address=address if address is not None else event.address,
            field_errors=field_errors,
            unchanged=unchanged,
        )
        if not field_errors:
            event.country = country
            event.city = city
            event.address = new_address
            event.location = loc.compose_location(country, city, new_address)
            updates += ["country", "city", "address", "location"]
    person_details = loc.parse_person_details(protected_person_details, field_errors)

    # Лиц может быть несколько (Plane №188). Ключа нет — список не трогаем;
    # пустой список — снимаем всех, ровно как пустая строка снимала одного.
    new_persons = None
    if protected_person_ids is not None:
        new_persons = resolve_protected_persons(protected_person_ids, field_errors)
    elif protected_person_id is not None:
        # Старое одиночное поле принимается по-прежнему — им пользуются
        # мок-слой, сиды и вызовы, написанные до №188. Пустая строка здесь
        # означает «снять лицо», и список становится пустым вместе с ним:
        # оставить в списке того, кого сняли с главного поля, значило бы
        # показать человеку снятое лицо на экране.
        raw = str(protected_person_id).strip()
        new_persons = (
            []
            if raw == ""
            else resolve_protected_persons(
                [raw], field_errors, field="protectedPersonId"
            )
        )

    if new_persons is not None and not field_errors:
        main = new_persons[0] if new_persons else None
        event.protected_person = main
        # Снимок подписи стирается ВМЕСТЕ со ссылкой: он существует, чтобы
        # пережить скрытие лица из справочника, а не чтобы пережить его
        # снятие с мероприятия.
        event.protected_person_name = main.name if main is not None else ""
        updates += ["protected_person", "protected_person_name"]

    if field_errors:
        raise _validation(field_errors)

    if business_date is not None:
        event.business_date = new_start
        updates.append("business_date")
    if business_date_end is not None:
        event.business_date_end = new_end
        updates.append("business_date_end")

    if not updates and new_persons is None and not person_details:
        # Нечего менять — отвечаем мероприятием как есть, без записи журнала:
        # «правка без изменений» это не событие, и лента, засоренная такими,
        # перестаёт отвечать на вопрос «что менялось».
        return event

    event.save(update_fields=sorted(set(updates)) + ["updated_at"])
    if new_persons is not None:
        # `set` и на пустом списке: снятие всех лиц — такое же изменение, как
        # назначение, и «пусто значит не трогать» здесь было бы вторым
        # смыслом пустоты в одной функции.
        event.protected_persons.set(new_persons)
    loc.apply_person_details(event, person_details)
    audit_service.record(
        actor=actor,
        action=audit_service.SECURITY_EVENT_DETAILS_UPDATED,
        entity_type=audit_service.ENTITY_SECURITY_EVENT,
        entity_id=event.pk,
        old_value=before,
        new_value={
            "code": event.code,
            "title": event.title,
            "businessDate": event.business_date.isoformat(),
            "businessDateEnd": (
                event.business_date_end.isoformat()
                if event.business_date_end is not None
                else None
            ),
            "eventTime": (
                event.event_time.strftime("%H:%M")
                if event.event_time is not None
                else None
            ),
            "protectedPersonName": event.protected_person_name,
            "protectedPersonNames": sorted(
                p.name for p in (new_persons if new_persons is not None else [])
            )
            if new_persons is not None
            else None,
            "location": event.location,
        },
    )
    return event


# ── Старший мероприятия ─────────────────────────────────────────────────────


@transaction.atomic
def set_event_chief(event_id, *, employee_id, actor):
    """Назначить, заменить или снять СТАРШЕГО НАРЯДА мероприятия (Plane №190).

    Заказчик, дословно: «даже если объект не выбран то должна быть возможность
    добавлять старшего наряда». До этого старшего можно было назвать ровно
    один раз — в окне создания; забыл или ошибся — исправить было нечем, а у
    ОМ без объекта не помогал и обходной путь через старшего объекта, потому
    что объекта нет.

    ОДНА ручка на три действия. Пустой `employee_id` снимает старшего: у
    мероприятия он ОДИН, и требование «сначала снимите, потом назначьте»
    превратило бы обычную замену в две операции с промежуточным состоянием
    «старшего нет», которого никто не хотел.

    Закрытое мероприятие — история: наряд отработал, и менять его старшего
    задним числом значило бы переписывать, кто отвечал.
    """
    event = lock_event(event_id)
    if event.stage == "CLOSED":
        raise DomainError(
            "INVALID_STAGE_TRANSITION",
            422,
            message="Мероприятие закрыто — старший наряда не меняется.",
        )

    raw = str(employee_id or "").strip()
    employee = None
    if raw != "":
        employee = _find_personnel(raw)
        if employee is None:
            raise _validation({"employeeId": ["Сотрудник не найден."]})

    previous = (
        {
            "employeeId": str(event.chief_employee_id),
            "employeeName": event.chief_name,
        }
        if event.chief_employee_id is not None
        else None
    )
    if employee is None and previous is None:
        # Снимать нечего. Отказ, а не тихое «ок»: молчаливый успех на пустом
        # месте читается как «сняли», и человек уходит с экрана уверенным.
        raise _not_found("У мероприятия не назначен старший.", event_id)

    event.chief_employee_id = employee.pk if employee is not None else None
    event.chief_name = (
        personnel_display_name(employee) if employee is not None else ""
    )
    event.save(update_fields=["chief_employee_id", "chief_name", "updated_at"])
    audit_service.record(
        actor=actor,
        action=audit_service.SECURITY_EVENT_CHIEF_SET,
        entity_type=audit_service.ENTITY_SECURITY_EVENT,
        entity_id=event.pk,
        old_value=previous,
        new_value=(
            {
                "code": event.code,
                "employeeId": str(event.chief_employee_id),
                "employeeName": event.chief_name,
            }
            if employee is not None
            # Снятие — запись БЕЗ человека, а не отсутствие записи: «кто снял
            # и когда» спрашивают так же, как «кто поставил».
            else {"code": event.code, "employeeId": None, "employeeName": ""}
        ),
    )
    return event


# ── Объекты посещения ───────────────────────────────────────────────────────


def _pin_unmarked_posts_to_the_only_visit(event):
    """Закрепить неразмеченные посты за ЕДИНСТВЕННЫМ объектом мероприятия.

    Зовётся ПЕРЕД добавлением второго объекта (Plane №490). Пока объект один,
    неразмеченный пост принадлежит ему по правилу `visit_object_posts`;
    появление второго меняет ответ на «никому», и всё, что этим ответом
    пользуется — подпись расстановки, снимок согласования, печатный
    документ, — молча меняет смысл.

    Ничего не делает, когда объектов не один: у ОМ без объектов приписывать
    некому, а у нескольких — приписать значило бы выдумать факт (тот же довод,
    что в `visit_object_posts`). Закрепляемый факт здесь не выдумывается, а
    ВЫВОДИТСЯ: секунду назад `visit_object_posts` отвечал ровно так же.
    """
    visits = list(event.visit_objects.all())
    if len(visits) != 1:
        return
    posts = event.recon_sector_posts or []
    owner = str(visits[0].pk)
    changed = False
    marked = []
    for post in posts:
        # 🔴 «НИЧЕЙ» — ЭТО И ПУСТАЯ РАЗМЕТКА, И ССЫЛКА В ПУСТОТУ (найдено
        # ревью №825; тот же разрез, что у `event_force_need` после №759).
        # Здесь стояло `== ""`, и пост, чей объект СНЯЛИ с мероприятия, пин не
        # закреплял. Пока объект один, `visit_object_posts` отдаёт такой пост
        # ВМЕСТЕ СО ВСЕМИ (правило «у единственного его посты — все»), и он
        # попадает в `approval_snapshot`; появление второго объекта его теряет,
        # подпись сжимается или пустеет — и воспроизводится дословно то, ради
        # чего заведена №490, вплоть до уводящего в сторону `PLACEMENT_EMPTY`
        # вместо `RECON_POSTS_UNASSIGNED`.
        if str(post.get("visitObjectId") or "").strip() != owner:
            post = {**post, "visitObjectId": owner}
            changed = True
        marked.append(post)
    if not changed:
        return
    event.recon_sector_posts = marked
    event.save(update_fields=["recon_sector_posts", "updated_at"])


@transaction.atomic
def add_visit_object(event_id, *, object_id, protected_person_id=None):
    """Добавить объект посещения к мероприятию.

    Объекты посещения появляются ПОЗЖЕ бюллетеня — заказчик заводит ОМ, когда
    маршрут ещё не известен, и дописывает объекты по мере согласования. Поэтому
    операция разрешена на любой живой стадии; закрытое мероприятие — история, и
    дописывать в неё маршрут нельзя.

    Привязка версии паспорта считается на дату ОМ тем же правилом, что при
    создании: у объекта посещения свой снимок, а не ссылка на общий.

    Журнал мутаций раздела здесь не пишется — по правилу модуля
    (audit_service: у ОМ пишутся заведение и закрытие, промежуточные правки
    агрегата свой след оставляют в самой карточке).
    """
    event = lock_event(event_id)
    if event.stage == "CLOSED":
        raise DomainError(
            "INVALID_STAGE_TRANSITION",
            422,
            message="Мероприятие закрыто — объекты посещения не меняются.",
        )

    field_errors = {}
    raw_object = str(object_id or "").strip()
    security_object = None
    if raw_object == "":
        field_errors["objectId"] = ["Обязательное поле."]
    else:
        security_object = (
            OpsSecurityObject.objects.filter(pk=raw_object).first()
            if raw_object.isdigit()
            else None
        )
        if security_object is None:
            field_errors["objectId"] = ["Объект не найден в реестре."]
        elif event.visit_objects.filter(
            security_object_id=security_object.pk
        ).exists():
            # Отбиваем ДО INSERT: уникальность в базе отдала бы конверт про
            # ограничение, а человеку нужно имя поля и понятная причина.
            field_errors["objectId"] = [
                "Этот объект уже добавлен в мероприятие."
            ]

    person = None
    raw_person = str(protected_person_id or "").strip()
    if raw_person != "":
        person = (
            OpsProtectedPerson.objects.filter(
                pk=raw_person, is_active=True
            ).first()
            if raw_person.isdigit()
            else None
        )
        if person is None:
            field_errors["protectedPersonId"] = [
                "Охраняемое лицо не найдено в справочнике."
            ]
    if field_errors:
        raise _validation(field_errors)

    binding = None
    applicable = resolve_applicable_version(security_object, event.business_date)
    if applicable is not None:
        binding = bind_passport_version(security_object, applicable, _now_iso())

    # 🔴 РАЗМЕТКА ЗАКРЕПЛЯЕТСЯ ДО ПОЯВЛЕНИЯ ВТОРОГО ОБЪЕКТА (Plane №490).
    #
    # Пока объект ОДИН, неразмеченный пост принадлежит ему — это не допущение,
    # а правило `visit_object_posts`: другим он принадлежать не может. Как
    # только объектов становится двое, то же правило отвечает «никому», и
    # смысл существующих данных меняется В МОМЕНТ ДОБАВЛЕНИЯ, без единой
    # правки расчёта.
    #
    # Чем это било. ОМ с одним объектом и неразмеченными постами отправлен на
    # согласование: `approval_snapshot` записан по ВСЕМ постам. Добавляют
    # второй объект — и `placement_signature` первого становится ПУСТОЙ:
    # `approval_is_stale` навсегда истинна, `_approve_visit` отбивает
    # `APPROVAL_STALE`, а повторная отправка — `PLACEMENT_EMPTY`. Объект
    # нельзя ни согласовать, ни переотправить, а мероприятие не уйдёт с этапа
    # никогда, потому что оно ждёт согласования ВСЕХ объектов. Тем же
    # переключением молча пустеет печатный документ.
    #
    # Поэтому разметка проставляется ЯВНО ровно тем объектом, которому посты и
    # так принадлежали. Это не выдуманный факт: он был верен секунду назад по
    # тому же правилу — просто перестаёт быть выводимым, и его записывают.
    _pin_unmarked_posts_to_the_only_visit(event)

    # Позиция — следующая по порядку человека, а не по id: удаление строки из
    # середины не должно перетасовывать оставшиеся.
    last = event.visit_objects.order_by("-position").first()
    OpsSecurityEventVisitObject.objects.create(
        event=event,
        security_object=security_object,
        object_name=security_object.name,
        passport_binding=binding,
        protected_person=person,
        protected_person_name=person.name if person is not None else "",
        position=0 if last is None else last.position + 1,
        # ОБЪЕКТ ВСТУПАЕТ В МЕРОПРИЯТИЕ ТАМ, ГДЕ ОНО СЕЙЧАС (Plane №412).
        # Стадия по умолчанию («Бюллетень») откатывала бы ВСЁ мероприятие
        # назад при каждом добавленном объекте: стадия мероприятия —
        # наименьшая среди объектов, и новичок на бюллетене утянул бы за
        # собой согласованные. Такого решения никто не принимал, а работу по
        # новому объекту открывает обход этапов (`event.stage_override`).
        stage=event.stage,
        recon_checklist=new_recon_checklist(),
    )
    event.refresh_from_db()
    # СНИМОК ПОТРЕБНОСТИ ПЕРЕСЧИТЫВАЕТСЯ (Plane №414). Прежде здесь стояло
    # «принадлежность постов изменилась: неразмеченная строка принадлежит
    # единственному объекту и НИКОМУ, как только объектов стало двое» — и это
    # перестало быть правдой в тот же заход (найдено ревью №825): пин выше
    # существует ровно затем, чтобы принадлежность НЕ менялась. Пересчёт всё
    # равно нужен, но по другой причине: у НОВОГО объекта снимок пуст и его
    # надо завести, а `recompute_event_stage` складывает потребность
    # мероприятия из снимков — без пересчёта в реестре печаталось бы число
    # прежнего разреза.
    recompute_visit_needs(event)
    return event


@transaction.atomic
def update_visit_object(event_id, visit_object_id, *, visit_day, note, description=None):
    """Правка дня посещения, примечания и описания визита у объекта посещения.

    День и примечание переехали сюда из патча сводки ГВО (ключ `visits`,
    «Реестр ОМ-35.1»): список объектов теперь один — таблица, — и править его
    подпись надо там же, где он живёт. `description` — та же идея для цели
    визита (Plane SJ-1049): предложение о том, зачем именно на ЭТОМ ОМ едут на
    этот объект («Основная площадка мероприятия.») — отдельно от `note`
    (короткая служебная подпись для сводки ГВО). Сам объект здесь не
    меняется: подмена объекта посещения — это снятие одной строки и
    добавление другой, у них своя расстановка и свои замещающие.

    `visitDay` пустой (не пришёл, `null` или пустая строка) — день посещения
    снимается, и сводка снова показывает объект в дате мероприятия. Это ОТВЕТ,
    а не отсутствие ответа: «в день ОМ» — нормальное состояние строки.

    `description=None` — параметр не пришёл вовсе (старый клиент шлёт только
    `visitDay`/`note`): поле остаётся как было. Пустая строка — описание
    снимается осознанно, это тоже ответ.
    """
    event = lock_event(event_id)
    if event.stage == "CLOSED":
        raise DomainError(
            "INVALID_STAGE_TRANSITION",
            422,
            message="Мероприятие закрыто — объекты посещения не меняются.",
        )
    visit = _visit_object_or_404(event, visit_object_id)
    _require_visit_open(visit, "день посещения и примечание не меняются")

    raw_day = str(visit_day or "").strip()
    day = None
    if raw_day != "":
        try:
            day = dt.date.fromisoformat(raw_day)
        except ValueError:
            raise _validation(
                {"visitDay": ["Укажите дату в формате ГГГГ-ММ-ДД."]}
            ) from None

    raw_note = str(note or "").strip()
    if len(raw_note) > 255:
        raise _validation({"note": ["Не длиннее 255 символов."]})

    visit.visit_day = day
    visit.note = raw_note
    update_fields = ["visit_day", "note", "updated_at"]
    if description is not None:
        raw_description = str(description).strip()
        if len(raw_description) > 255:
            raise _validation({"description": ["Не длиннее 255 символов."]})
        visit.description = raw_description
        update_fields.append("description")
    visit.save(update_fields=update_fields)
    event.refresh_from_db()
    return event


@transaction.atomic
def remove_visit_object(event_id, visit_object_id, *, actor=None):
    """Убрать объект посещения. Закрытое мероприятие не правится."""
    event = lock_event(event_id)
    if event.stage == "CLOSED":
        raise DomainError(
            "INVALID_STAGE_TRANSITION",
            422,
            message="Мероприятие закрыто — объекты посещения не меняются.",
        )
    visit = (
        event.visit_objects.filter(pk=visit_object_id).first()
        if str(visit_object_id).isdigit()
        else None
    )
    if visit is None:
        raise _not_found("Объект посещения не найден.", visit_object_id)
    _require_visit_open(visit, "снять его с мероприятия уже нельзя")
    # Посты, размеченные за этим объектом, остались бы сиротами — расчёт
    # считает их «ничьими», и готовность объекта исчезла бы молча.
    scoped_posts = [
        p
        for p in (event.recon_sector_posts or [])
        if str(p.get("visitObjectId") or "") == str(visit.pk)
    ]
    if scoped_posts:
        raise DomainError(
            "VALIDATION_ERROR",
            422,
            message=(
                "У объекта есть посты в расчёте — сначала снимите или "
                "перенесите их."
            ),
        )
    visit.delete()
    event.refresh_from_db()
    # Обратная сторона той же правки (Plane №414): объект мог снова стать
    # единственным, и неразмеченные посты вернулись к нему.
    recompute_visit_needs(event)
    # 🔴 ЭТАП МЕРОПРИЯТИЯ ПЕРЕСЧИТЫВАЕТСЯ ТОЖЕ (Plane №525). С №412
    # `event.stage` — МИНИМУМ по объектам, а снятие объекта минимум меняет:
    # ушёл тот, кто один и держал мероприятие на раннем этапе. Без пересчёта
    # `event.stage` остаётся НИЖЕ нового минимума, и дальше
    # `complete_acknowledgement` отбивает единственный оставшийся объект,
    # который уже стоит на «Ознакомлении», — мероприятие запирается снятием
    # чужого объекта.
    old_stage = event.stage
    recompute_event_stage(event)
    # 🔴 ПЕРЕХОД ЗАПИСЫВАЕТСЯ В ЖУРНАЛ (доводка №525 по ревью №825).
    # `recompute_event_stage` меняет стадию и сохраняет — но `record_transition`
    # не зовёт, в отличие от ВСЕХ прочих путей смены этапа (`_advance`,
    # согласование и ознакомление объекта, отзыв, возврат расстановки, обход,
    # закрытие). Пока писался только переход в CLOSED (ветка ниже, №608),
    # мероприятие, перескочившее снятием отстающего объекта с «Расстановки» на
    # «Ознакомление», двигалось МОЛЧА: в ленте переходов пусто, воронка
    # `analytics` недосчитывает FORWARD, и на вопрос «когда ОМ оказалось на
    # этом этапе» ответа нет вовсе.
    #
    # CLOSED здесь исключён нарочно: его пишет `_finalize_event_closure` ниже
    # вместе со штампом, оцениванием и аудитом — записать переход дважды было
    # бы хуже, чем не записать.
    if event.stage != old_stage and event.stage != "CLOSED":
        record_transition(event, old_stage, event.stage)
    # 🔴 СНЯТИЕ ОБЪЕКТА ТОЖЕ МОЖЕТ ЗАКРЫТЬ МЕРОПРИЯТИЕ (Plane №608).
    # Автозакрытие `[ЗАК-12]` жило только в `close_visit_object`, а «все
    # объекты закрыты» становится правдой и отсюда: закрыли объект А
    # (мероприятие осталось на «Проведении» из-за Б), сняли Б — и открытых
    # объектов не осталось. Мероприятие навсегда стояло на CONDUCT с
    # готовностью меньше 100, `close_visit_object(А)` отвечал «объект уже
    # закрыт», и добить его могло только ручное `close_event`. В реестре ОМ
    # без единого открытого объекта числился «Проведением».
    #
    # Финал тот же, что у закрытия последнего объекта, — штамп, переход,
    # оценивание, аудит: закрытие мероприятия не должно зависеть от того,
    # каким действием оно наступило.
    if event.stage == "CLOSED" and old_stage != "CLOSED":
        # 🔴 АКТОР — НАСТОЯЩИЙ, А НЕ МЕТКА (Plane №608; найдено ревью, задача
        #    №825). Здесь стояла постоянная строка «system:visit-object-removed»,
        #    и она уходила НЕ ТОЛЬКО в аудит: `_finalize_event_closure`
        #    передаёт актора в `open_evaluation_for_event`, а тот в ветке
        #    «добор адресата» ПЕРЕПИСЫВАЕТ `evaluator_user_id` у каждого
        #    неотправленного задания. Очередь оценщика фильтруется ровно по
        #    этому полю — значит живые задания уходили из очередей настоящих
        #    людей в учётную запись, которой не существует. Это тот же дефект,
        #    что закрывали №641/№642, только через другую дверь. Плюс запись
        #    аудита о ЗАКРЫТИИ мероприятия называла псевдоактора, тогда как
        #    соседний `close_visit_object` на том же пути пишет настоящего.
        _finalize_event_closure(
            event, actor=actor or "system:visit-object-removed", old_stage=old_stage
        )
    return event


# ── Удаление мероприятия ────────────────────────────────────────────────────


#: Мероприятия, которые НЕЛЬЗЯ удалить: у них есть внешний след.
DELETE_FORBIDDEN_STAGES = frozenset({"CLOSED"})


@transaction.atomic
def delete_event(event_id, *, actor, force=False):
    """Убрать мероприятие из реестра.

    Зачем удаление вообще: бюллетень, заведённый по ошибке (опечатка в
    названии, дубль, пробный прогон), убрать было НЕЧЕМ — реестр копил мусор,
    и на 24.08.2026 из 194 строк 188 были пробными. Реестр, который нельзя
    почистить, перестаёт читаться глазом, и проверка UI идёт по мусору.

    Чего удаление НЕ делает:

    * закрытое ОМ не трогает — у него внешний след (номер в бумаге, итоги
      направлений, ознакомления), и стирать его значило бы терять историю;
    * ОМ с назначениями и записями журнала штаба не трогает — там уже была
      работа людей, и «удалить» вместо «отменить» скрыло бы её;
    * прав не смягчает: своё право `event.delete`, отдельное от `event.manage`
      (ведущий правит мероприятие, стирает — админ).

    `force` снимает ОБА запрета и предназначен ровно одному вызывающему —
    команде чистки пробных строк (`purge_probe_events`). Права он не заменяет:
    команду запускает администратор с консоли, а API `force` не передаёт
    НИКОГДА — иначе запрет, ради которого он и заведён, снимался бы кнопкой.
    Пробная строка не история и не работа людей: её пометил прогон, и именно
    метка, а не стадия, определяет, что она мусор.

    Журнал мутаций пишется ДО удаления и снимком целиком: строка исчезает, и
    журнал остаётся единственным следом того, что она была.
    """
    event = lock_event(event_id)
    if not force and event.stage in DELETE_FORBIDDEN_STAGES:
        raise DomainError(
            "EVENT_DELETE_FORBIDDEN",
            422,
            message=(
                "Закрытое мероприятие не удаляется — это история: итоги "
                "направлений и ознакомления остаются его следом."
            ),
        )
    if not force and (event.placement_assignments or event.journal_entries):
        raise DomainError(
            "EVENT_DELETE_FORBIDDEN",
            422,
            message=(
                "В мероприятии есть расстановка или записи журнала штаба — "
                "это работа людей. Такое ОМ проводят или закрывают, а не "
                "стирают из реестра."
            ),
        )
    snapshot = {
        "code": event.code,
        "title": event.title,
        "stage": event.stage,
        "businessDate": event.business_date.isoformat(),
        "objectName": event.object_name,
        "ownerName": event.owner_name,
        # Обход запретов виден В ЖУРНАЛЕ: удаление отработавшего ОМ и удаление
        # пустого бюллетеня — разные по последствиям события, и различать их
        # задним числом надо уметь.
        "forced": bool(force),
    }
    audit_service.record(
        actor=actor,
        action=audit_service.SECURITY_EVENT_DELETED,
        entity_type=audit_service.ENTITY_SECURITY_EVENT,
        entity_id=event.pk,
        old_value=snapshot,
    )
    deleted_id = event.pk
    event.delete()
    # 🔴 УЧАСТИЯ НА УДАЛЁННОЕ ОМ СНИМАЮТСЯ ЗДЕСЬ ЖЕ (Plane №355, решение
    # 02.09.2026).
    #
    # Ссылка «участие → мероприятие» плоская НАМЕРЕННО: раздел статусов не
    # должен зависеть от таблицы ОМ. Но у плоской ссылки была цена, и она
    # оказалась выше пользы: удалённое мероприятие оставляло участие живым, а
    # оно и после удаления ЗАНИМАЕТ ДЕНЬ сотрудника — новый статус на те же
    # даты не заводится, и человек числится «привлечён неизвестно куда»
    # (проверено делом 02.09.2026: после удаления ОМ у участия опустели
    # `event_code` и `event_title`, а сам статус остался действующим).
    #
    # Снимаются РОВНО участия на это мероприятие; статус сносится, только если
    # других участий у него не осталось, — это правило уже жило в уборке
    # сирот, и второй его копии здесь нет. Журнал пишет ту же уборка: строка
    # «снято N участий» с актором.
    #
    # Отвергнуто: (а) архивировать мероприятия вместо удаления — цена в правке
    # всех читателей реестра, а удаление как действие исчезло бы совсем;
    # (б) оставить как есть и чистить регламентной командой — призраки живут
    # между уборками, и день сотрудника занят всё это время.
    from organization_management.apps.operations.status_cleanup import (
        purge_orphan_participations,
    )

    purge_orphan_participations([deleted_id], actor=str(actor))
    return snapshot


# ── Замещающие на объекте посещения ─────────────────────────────────────────


def _visit_object_or_404(event, visit_object_id):
    visit = (
        event.visit_objects.filter(pk=visit_object_id).first()
        if str(visit_object_id).isdigit()
        else None
    )
    if visit is None:
        raise _not_found("Объект посещения не найден.", visit_object_id)
    return visit


def _require_visit_open(visit, what):
    """Закрытый объект посещения не правится (`[ЗАК-12]`, Plane №607).

    🔴 ГАРД ПО ОБЪЕКТУ, А НЕ ПО МЕРОПРИЯТИЮ. Правки объекта сторожил только
    `event.stage == "CLOSED"`, а этап мероприятия — НАИМЕНЬШИЙ среди его
    объектов: пока жив хоть один незакрытый, мероприятие стоит на
    «Проведении», и закрытый объект оставался открытым для правки. День
    посещения, примечание, старший и замещающие менялись у закрытого объекта
    молча, вопреки записи `VISIT_OBJECT_CLOSED` в журнале и тексту диалога
    закрытия. На ОМ с ОДНИМ объектом дефекта не видно вовсе — закрытие
    единственного объекта закрывает и мероприятие, и старый гард срабатывает
    за компанию.

    Правило и код ошибки — те же, что у соседей, которые считали по объекту с
    самого начала: `conduct_evaluations._require_open` и `close_visit_object`.
    Гард мероприятия при этом ОСТАЁТСЯ на месте: он отвечает на другой вопрос
    («мероприятие закрыто целиком») и даёт свой текст.

    `what` — хвост сообщения о том, что именно не изменится: человеку нужен
    не код, а причина отказа именно этого действия.
    """
    if visit.stage == "CLOSED":
        raise DomainError(
            "VISIT_OBJECT_ALREADY_CLOSED",
            422,
            message=f"Объект «{visit.object_name}» закрыт — {what}.",
        )


def deputy_can_edit_placement(event, employee_id, post):
    """Может ли этот сотрудник править расстановку ЭТОГО поста как замещающий.

    Право выдаётся ПО ОБЪЕКТУ ПОСЕЩЕНИЯ, а операция идёт по посту — связать их
    можно только разметкой поста (`visitObjectId` в строке расчёта). Разметки
    сегодня нет у большинства ОМ: расчёт постов ведётся на мероприятии целиком
    (решение 24.08). Поэтому правило такое:

    * пост РАЗМЕЧЕН — право проверяется по его объекту, и только по нему;
    * пост НЕ размечен, а объект посещения у ОМ ОДИН — все посты его, и
      замещающий этого объекта правит их (это ровно то, что видит человек на
      экране: один объект, один расчёт);
    * пост не размечен, а объектов НЕСКОЛЬКО — чей это пост, неизвестно, и
      право не выдаётся. Ошибиться здесь значит пустить человека в чужую
      расстановку; отказ он увидит и попросит разметить расчёт.
    """
    if employee_id is None:
        return False
    scoped = str((post or {}).get("visitObjectId") or "")
    if scoped != "":
        return OpsVisitObjectDeputy.objects.filter(
            visit_object_id=scoped,
            visit_object__event_id=event.pk,
            employee_id=employee_id,
            can_edit_placement=True,
        ).exists()
    visits = list(event.visit_objects.all()[:2])
    if len(visits) != 1:
        return False
    return OpsVisitObjectDeputy.objects.filter(
        visit_object_id=visits[0].pk,
        employee_id=employee_id,
        can_edit_placement=True,
    ).exists()


def _record_deputy_placement(event, deputy, payload):
    """Журнал мутаций для операции расстановки, сделанной ЗАМЕЩАЮЩИМ.

    Обычная расстановка следа в журнале мутаций не оставляет — её след живёт
    в самом агрегате. Здесь исключение по тому же основанию, что у перевода
    этапа админом: действие совершено в обход общего права, по роли в данных,
    и обязано быть именным.
    """
    if deputy is None:
        return
    audit_service.record(
        actor=deputy.user if getattr(deputy, "user", None) is not None else deputy,
        action=audit_service.SECURITY_EVENT_PLACEMENT_BY_DEPUTY,
        entity_type=audit_service.ENTITY_SECURITY_EVENT,
        entity_id=event.pk,
        new_value={
            "code": event.code,
            "deputyId": str(deputy.pk),
            "deputyName": personnel_display_name(deputy),
            **payload,
        },
    )


def record_object_lead_action(event, visit, lead, action_name):
    """Журнал мутаций для согласования, ведомого СТАРШИМ ОБЪЕКТА (Plane №576).

    То же основание, что у `_record_deputy_placement`: действие совершено в
    обход общего права `event.manage`, по роли в данных, и обязано быть
    именным. Обычная отправка на согласование следа в журнале мутаций не
    оставляет — её след живёт в версии документа и в маршруте.

    `lead is None` — действовал правообладатель, писать нечего.
    """
    if lead is None:
        return
    audit_service.record(
        actor=lead.user if getattr(lead, "user", None) is not None else lead,
        action=audit_service.SECURITY_EVENT_APPROVAL_BY_OBJECT_LEAD,
        entity_type=audit_service.ENTITY_SECURITY_EVENT,
        entity_id=event.pk,
        new_value={
            "code": event.code,
            "action": action_name,
            "leadId": str(lead.pk),
            "leadName": personnel_display_name(lead),
            "visitObjectId": str(visit.pk) if visit is not None else None,
            "objectName": visit.object_name if visit is not None else "",
        },
    )


@transaction.atomic
def add_visit_object_deputy(
    event_id, visit_object_id, *, employee_id, can_edit_placement, actor
):
    """Назначить замещающего на объект посещения.

    Журнал мутаций здесь пишется — в отличие от остальных правок агрегата: это
    раздача ПРАВА, а не данных (см. `audit_service`).
    """
    event = lock_event(event_id)
    if event.stage == "CLOSED":
        raise DomainError(
            "INVALID_STAGE_TRANSITION",
            422,
            message="Мероприятие закрыто — замещающие не назначаются.",
        )
    visit = _visit_object_or_404(event, visit_object_id)
    _require_visit_open(visit, "замещающие не назначаются")

    employee = _find_personnel(employee_id)
    if employee is None:
        raise _validation({"employeeId": ["Сотрудник не найден."]})
    if visit.deputies.filter(employee_id=employee.pk).exists():
        # Отбиваем ДО INSERT: уникальность базы отдала бы конверт про
        # ограничение, а человеку нужно имя поля и причина.
        raise _validation(
            {"employeeId": ["Этот сотрудник уже назначен замещающим."]}
        )

    deputy = OpsVisitObjectDeputy.objects.create(
        visit_object=visit,
        employee_id=employee.pk,
        employee_name=personnel_display_name(employee),
        can_edit_placement=can_edit_placement is not False,
        assigned_by=actor_display_name(actor),
    )
    audit_service.record(
        actor=actor,
        action=audit_service.SECURITY_EVENT_DEPUTY_ASSIGNED,
        entity_type=audit_service.ENTITY_SECURITY_EVENT,
        entity_id=event.pk,
        new_value={
            "code": event.code,
            "visitObjectId": str(visit.pk),
            "objectName": visit.object_name,
            "employeeId": str(deputy.employee_id),
            "employeeName": deputy.employee_name,
            "canEditPlacement": deputy.can_edit_placement,
        },
    )
    event.refresh_from_db()
    return event


@transaction.atomic
def remove_visit_object_deputy(event_id, visit_object_id, deputy_id, *, actor):
    event = lock_event(event_id)
    if event.stage == "CLOSED":
        raise DomainError(
            "INVALID_STAGE_TRANSITION",
            422,
            message="Мероприятие закрыто — замещающие не меняются.",
        )
    visit = _visit_object_or_404(event, visit_object_id)
    _require_visit_open(visit, "замещающие не меняются")
    deputy = (
        visit.deputies.filter(pk=deputy_id).first()
        if str(deputy_id).isdigit()
        else None
    )
    if deputy is None:
        raise _not_found("Замещающий не найден.", deputy_id)
    # Снимок ДО удаления: журнал обязан назвать, у кого сняли право, а после
    # `delete()` строки уже нет.
    removed = {
        "code": event.code,
        "visitObjectId": str(visit.pk),
        "objectName": visit.object_name,
        "employeeId": str(deputy.employee_id),
        "employeeName": deputy.employee_name,
    }
    deputy.delete()
    audit_service.record(
        actor=actor,
        action=audit_service.SECURITY_EVENT_DEPUTY_REVOKED,
        entity_type=audit_service.ENTITY_SECURITY_EVENT,
        entity_id=event.pk,
        old_value=removed,
    )
    event.refresh_from_db()
    return event


# ── Старший объекта посещения ───────────────────────────────────────────────


def _require_visit_chief(visit):
    """`[РЕК-02]`/`[РЕК-07]` (Plane №424): без старшего объекта рекогносцировка
    закрыта — правило у сервера, экран лишь повторяет его пустым состоянием."""
    if visit.chief_employee_id is None:
        raise DomainError(
            "VISIT_CHIEF_REQUIRED",
            422,
            message=(
                f"Назначьте старшего объекта «{visit.object_name}», чтобы "
                "начать рекогносцировку."
            ),
        )


def _visits_with_changed_posts(event, sector_posts):
    """Объекты, чей СОСТАВ расчёта запрос МЕНЯЕТ (Plane №634).

    🔴 НЕРАЗМЕЧЕННАЯ СТРОКА — СВОЯ У ЕДИНСТВЕННОГО ОБЪЕКТА (Plane №862,
    решение заказчика 06.09.2026: «требовать старшего и здесь»).

    Что было. Набор считался через `_posts_by_visit`, а он выбрасывал строки
    без `visitObjectId` как ничьи. Исключение заводилось для строк, живших ДО
    разметки (№408/№416): их нельзя отнести к объекту, и трогать их гард не
    должен. Но у ОМ с ЕДИНСТВЕННЫМ объектом неразмеченными заводятся ВСЕ
    посты — разметку им проставляет только добавление ВТОРОГО объекта, — и
    исключение отключало правило `[РЕК-02]`/№424 «посты объекта пишет его
    старший» для всех одиночных мероприятий целиком. Заморозка (№535) тот же
    случай трактует наоборот, и расхождение двух правил на одних данных
    заказчик закрыл в пользу старшего.

    При НЕСКОЛЬКИХ объектах неразмеченная строка по-прежнему ничья: отнести
    её не к чему, и это не изменилось.

    🔴 ЧЕК-ЛИСТ ЭТИМ НЕ ЗАПИРАЕТСЯ, и болезнь №634 не возвращается: пункты
    осмотра живут в `recon_checklist`, отдельном поле, и запрос, меняющий
    только их, оставляет `sector_posts` прежними — набор пуст, гард не
    зовётся. Закреплено пробой, а не рассуждением.

    🔴 СЕГОДНЯ ЭТОТ НАБОР СОВПАДАЕТ С НАБОРОМ ЗАМОРОЗКИ, и это не повод их
    сливать. Совпадение — следствие того, что после ревью №825 отпечаток
    строки считается ЦЕЛИКОМ. Вопросы у них разные (`[РЕК-02]` про автора
    правки, `[СОГ-04]` про подписанный документ), и стоит сузить один —
    наборы разойдутся снова. Общий у них ОДИН помощник, а не одна функция:
    так расхождение вернётся осознанно, а не молча.
    """
    visits = list(event.visit_objects.all())
    only = str(visits[0].pk) if len(visits) == 1 else None
    before = _rows_by_visit(event.recon_sector_posts or [], only=only)
    after = _rows_by_visit(sector_posts, only=only)
    return {
        key
        for key in set(before) | set(after)
        if before.get(key, []) != after.get(key, [])
    }


#: Ключи строки поста, не входящие в сравнение «строка изменилась».
#: `visitObjectId` — принадлежность, её уже несёт ключ группировки; сравнивать
#: её ещё и внутри строки значило бы объявлять правкой саму разметку.
_ROW_FINGERPRINT_SKIP = ("visitObjectId",)


def _row_fingerprint(row):
    """Отпечаток строки поста ЦЕЛИКОМ, а не по списку полей.

    🔴 СПИСОК ПОЛЕЙ БЫЛ ДЫРОЙ (Plane №535 и №634, найдено ревью №825). Прежний
    `_POST_FINGERPRINT_FIELDS` перечислял восемь полей — `id`, `sector`,
    `post`, `task`, `need`, `shift`, `requirements`, `comment`, — а строка
    поста несёт ещё `minRating`, `postType`, `weapon`, `uniform`,
    `parentPostId`, `sourceSectorId`, `sourcePostId`, `result`; и все они
    попадают в снимок подписываемого документа (`_document_snapshot` кладёт
    строки целиком).
    Значит у СОГЛАСОВАННОГО объекта минимальный балл поста менялся ответом
    200: заморозка молчала, `document_version_diff` сравнивает только пары
    «сектор · пост» и «кто на посту» — и расхождение подписанного документа с
    фактом не отмечалось нигде. Ровно то, «чем грозит» карточка №535.

    Пустое значение и отсутствие ключа — одно и то же: клиент необязательные
    поля не присылает вовсе, и считать это правкой значило бы отбивать
    сохранение, ничего не меняющее. По той же причине значения приводятся к
    строке со `strip`: `need` приходит и числом, и строкой.
    """
    return tuple(sorted(
        (str(key), str(value).strip())
        for key, value in (row or {}).items()
        if key not in _ROW_FINGERPRINT_SKIP
        and value is not None
        and str(value).strip() != ""
    ))


def _rows_by_visit(rows, *, only=None):
    """{объект → отпечатки его строк}. Неразмеченная строка принадлежит
    ЕДИНСТВЕННОМУ объекту (`only`) — тем же правилом, что `visit_object_posts`
    и `_visit_of_post`; при нескольких объектах она по-прежнему ничья.

    🔴 ЭТО ЕДИНСТВЕННЫЙ ГРУППИРОВЩИК (Plane №862). Рядом жил `_posts_by_visit`
    — тот же код, но неразмеченные строки он выбрасывал всегда. Его читал гард
    старшего, из-за чего у ОМ с единственным объектом гард не срабатывал
    никогда. После правки его не читал никто, и он снят: мёртвый помощник,
    отличающийся от живого одной строкой, — приглашение позвать не тот.
    """
    grouped = {}
    for row in rows or []:
        key = str(row.get("visitObjectId") or "").strip() or (only or "")
        if not key:
            continue
        grouped.setdefault(key, []).append(_row_fingerprint(row))
    return {key: sorted(items) for key, items in grouped.items()}


def _unassigned_rows_changed_outside_claim(event, sector_posts, target_id):
    if event.visit_objects.count() <= 1:
        return False
    stored = {
        str(row.get("id") or "").strip(): row
        for row in (event.recon_sector_posts or [])
        if not str(row.get("visitObjectId") or "").strip()
    }
    claimed = {
        row_id
        for row in (sector_posts or [])
        if (row_id := str(row.get("id") or "").strip()) in stored
        and str(row.get("visitObjectId") or "").strip() == str(target_id)
        and _row_fingerprint(row) == _row_fingerprint(stored[row_id])
    }

    def remaining(rows, *, skip=()):
        return sorted(
            (
                str(row.get("id") or "").strip(),
                _row_fingerprint(row),
            )
            for row in (rows or [])
            if not str(row.get("visitObjectId") or "").strip()
            and str(row.get("id") or "").strip() not in skip
        )

    return remaining(event.recon_sector_posts, skip=claimed) != remaining(sector_posts)


def _visits_with_edited_rows(event, sector_posts):
    """Объекты, чьи строки расчёта запрос МЕНЯЕТ ХОТЬ ЧЕМ-ТО (Plane №535).

    🔴 ЭТО ДРУГОЙ ВОПРОС, ЧЕМ У `_visits_with_changed_posts`, и потому
    отдельная функция, а не расширение той. Гард старшего (№634) спрашивает
    «изменился ли СОСТАВ расчёта»: отметка результата осмотра или правка
    минимального балла старшего не требуют — иначе пункт чек-листа стал бы
    несохраняемым у объекта без старшего, то есть вернулась бы сама болезнь
    №634. Заморозка (`[СОГ-04]`) спрашивает другое: «изменилась ли хоть одна
    строка того, что подписано». Один ответ на два вопроса был бы неверен на
    обоих.

    🔴 НЕРАЗМЕЧЕННЫЕ СТРОКИ СЧИТАЮТСЯ (Plane №535, найдено ревью №825).
    `_posts_by_visit` их выбрасывает («они ничьи»), и для гарда старшего это
    верно. Но у ОМ с ЕДИНСТВЕННЫМ объектом неразмеченный пост — ЕГО пост: так
    считает `visit_object_posts`, так считает `_visit_of_post`, и по
    `visit_object_posts` собирается подписываемый снимок. Пока заморозка
    ключилась на `_posts_by_visit`, у такого ОМ она не срабатывала НИКОГДА:
    `placement/assign/` по тому же посту отвечал `PLACEMENT_FROZEN`, а
    `PATCH /recon/`, снимающий этот пост, отвечал 200 — то есть репро карточки
    №535 воспроизводилось дальше. Состояние обычное, а не краевое: посты
    заводятся неразмеченными, а `_pin_unmarked_posts_to_the_only_visit`
    закрепляет их только ПЕРЕД добавлением ВТОРОГО объекта.
    """
    visits = list(event.visit_objects.all())
    only = str(visits[0].pk) if len(visits) == 1 else None
    before = _rows_by_visit(event.recon_sector_posts or [], only=only)
    after = _rows_by_visit(sector_posts, only=only)
    return {
        key
        for key in set(before) | set(after)
        if before.get(key, []) != after.get(key, [])
    }


@transaction.atomic
def assign_visit_object_chief(event_id, visit_object_id, *, employee_id, actor):
    """Назначить старшего НА ОБЪЕКТ посещения (Plane «Реестр ОМ-35.2»).

    Старший объекта — не старший мероприятия: у визита иностранного ОЛ
    объектов несколько, и на каждом свой ответственный. Назначение именное и
    попадает в журнал мутаций — по нему спрашивают доклад, и «кто его
    поставил» обязано иметь ответ.

    Замена старшего идёт этой же ручкой: снимать перед назначением не нужно —
    у объекта старший ОДИН, и требование «сначала снимите» превратило бы
    обычную замену в две операции. В журнале при замене остаётся и прежняя
    подпись (old_value), и новая.
    """
    event = lock_event(event_id)
    if event.stage == "CLOSED":
        raise DomainError(
            "INVALID_STAGE_TRANSITION",
            422,
            message="Мероприятие закрыто — старший объекта не меняется.",
        )
    visit = _visit_object_or_404(event, visit_object_id)
    _require_visit_open(visit, "старший объекта не меняется")

    employee = _find_personnel(employee_id)
    if employee is None:
        raise _validation({"employeeId": ["Сотрудник не найден."]})

    previous = (
        {
            "employeeId": str(visit.chief_employee_id),
            "employeeName": visit.chief_name,
        }
        if visit.chief_employee_id is not None
        else None
    )
    visit.chief_employee_id = employee.pk
    visit.chief_name = personnel_display_name(employee)
    visit.save(update_fields=["chief_employee_id", "chief_name", "updated_at"])
    audit_service.record(
        actor=actor,
        action=audit_service.VISIT_OBJECT_CHIEF_ASSIGNED,
        entity_type=audit_service.ENTITY_SECURITY_EVENT,
        entity_id=event.pk,
        old_value=previous,
        new_value={
            "code": event.code,
            "visitObjectId": str(visit.pk),
            "objectName": visit.object_name,
            "employeeId": str(visit.chief_employee_id),
            "employeeName": visit.chief_name,
        },
    )
    event.refresh_from_db()
    return event


@transaction.atomic
def remove_visit_object_chief(event_id, visit_object_id, *, actor):
    """Снять старшего с объекта посещения. Некого снимать — 404 с конвертом, а
    не тихий успех: «снял того, кого не было» это ошибка вызывающего."""
    event = lock_event(event_id)
    if event.stage == "CLOSED":
        raise DomainError(
            "INVALID_STAGE_TRANSITION",
            422,
            message="Мероприятие закрыто — старший объекта не меняется.",
        )
    visit = _visit_object_or_404(event, visit_object_id)
    _require_visit_open(visit, "старший объекта не меняется")
    if visit.chief_employee_id is None:
        raise _not_found("У объекта не назначен старший.", visit_object_id)

    # Снимок ДО очистки: журнал обязан назвать, кого сняли.
    removed = {
        "code": event.code,
        "visitObjectId": str(visit.pk),
        "objectName": visit.object_name,
        "employeeId": str(visit.chief_employee_id),
        "employeeName": visit.chief_name,
    }
    visit.chief_employee_id = None
    visit.chief_name = ""
    visit.save(update_fields=["chief_employee_id", "chief_name", "updated_at"])
    audit_service.record(
        actor=actor,
        action=audit_service.VISIT_OBJECT_CHIEF_REVOKED,
        entity_type=audit_service.ENTITY_SECURITY_EVENT,
        entity_id=event.pk,
        old_value=removed,
    )
    event.refresh_from_db()
    return event


# ── Бюллетень ───────────────────────────────────────────────────────────────


@transaction.atomic
def complete_bulletin(event_id):
    event = lock_event(event_id)
    _require_stage(
        event, "BULLETIN", "Бюллетень можно завершить только на этапе «Бюллетень»."
    )
    # Текста бюллетеня («краткое описание», «первичные задачи направлениям»)
    # переход БОЛЬШЕ НЕ ТРЕБУЕТ (Plane №943, слово заказчика 07.09.2026:
    # «вот эту часть полностью со всего проекта убери»). В бланке «Орда-4»
    # (`[БЛН-01]`…`[БЛН-04]`) этих полей нет — они прототипный остаток, и
    # экран их не показывает. До этого ОМ без объекта не открывал
    # рекогносцировку без заполненного текста (`BULLETIN_INCOMPLETE`).
    # `update_bulletin` и ручка `PATCH .../bulletin/` сняты (Plane №950) —
    # `brief_description`/`initial_tasks` остаются полями модели без читателя
    # ни на экране, ни в контракте API; снятие самих колонок — миграцией
    # отдельным шагом, здесь не требуется.
    return _advance(event, "RECON")


_STAGE_ORDER = [
    "BULLETIN", "RECON", "DEMAND", "FORCES", "PLACEMENT", "APPROVAL",
    "ACKNOWLEDGEMENT", "CONDUCT", "CLOSED",
]


# Статус ОБЪЕКТА словами для реестра (`[РЕЕ-08]`/`[РЕК-08]`, Plane №423).
# «Потребность» и «Запрос сил» объект проходит сервером за один вызов
# `complete_recon` (Plane №110) — человек их не видит, поэтому обе подписаны
# фактом, который он совершил: «Рекогносцировка завершена». Та же подпись у
# «Расстановки», пока на объект никого не назначили: этап открыт автопроходом,
# а не действием старшего, и «Расстановка» в реестре обещала бы работу, которой
# ещё нет — спецификация просит «статус „Рекогносцировка завершена“, в реестре
# „потребность N, назначено 0“».
_VISIT_STATUS_LABELS = {
    "BULLETIN": "Бюллетень",
    "RECON": "Рекогносцировка",
    "DEMAND": "Рекогносцировка завершена",
    "FORCES": "Рекогносцировка завершена",
    "PLACEMENT": "Расстановка",
    "APPROVAL": "На согласовании",
    "ACKNOWLEDGEMENT": "Ознакомление",
    "CONDUCT": "Проведение",
    "CLOSED": "Закрыто",
}


def visit_status_label(visit, *, assigned):
    """Подпись статуса объекта посещения; `assigned` — назначено на посты
    объекта (None — разрез по объектам неизвестен, тогда подпись по этапу)."""
    if visit.stage == "PLACEMENT" and assigned == 0:
        return _VISIT_STATUS_LABELS["DEMAND"]
    return _VISIT_STATUS_LABELS.get(visit.stage, visit.stage)


def record_transition(event, from_stage, to_stage):
    """Журнал переходов (§22.14) — append-only, в ТОЙ ЖЕ транзакции, что и
    смена стадии: отдельная запись пережила бы неудавшийся коммит и сообщила
    бы о переходе, которого не произошло. Возврат (движение назад по порядку
    стадий) помечается своим видом — воронка не должна считать его прогрессом."""
    kind = "FORWARD"
    if from_stage in _STAGE_ORDER and to_stage in _STAGE_ORDER:
        if _STAGE_ORDER.index(to_stage) < _STAGE_ORDER.index(from_stage):
            kind = "RETURN"
    OpsSecurityEventTransition.objects.create(
        event=event,
        from_stage=from_stage,
        to_stage=to_stage,
        kind=kind,
        occurred_at=Clock.now(),
    )


# ── Мероприятие считается по объектам (Plane №412, Ш-6 плана №385) ──────────
#
# 🔴 СТАДИЮ, ГОТОВНОСТЬ И ПОТРЕБНОСТЬ МЕРОПРИЯТИЯ БОЛЬШЕ НЕ ВЕДУТ — ИХ СЧИТАЮТ.
# Требование `[МД-04]`: «у объекта свои этапы 1–5». Пока стадию вели у
# мероприятия, ОМ с двумя объектами имел ОДНУ стадию на оба: первый объект
# согласован, второй ещё на расстановке — а карточка говорила что-то одно, и
# что именно, зависело от того, кто последним нажал кнопку.
#
# ПОЛЯ ОСТАЛИСЬ КОЛОНКАМИ, А НЕ СТАЛИ СВОЙСТВАМИ. По `stage` реестр фильтрует
# и сортирует запросом (`api/views.py`, фильтр «Этап»), по нему же считает
# воронку аналитика; вычисляемое свойство пришлось бы обходить перебором в
# память на каждом экране. Колонка теперь ХРАНИТ ВЫВОД: её пересчитывает
# `recompute_event_stage` в той же транзакции, что и правку объектов.
#
# У ОМ БЕЗ ОБЪЕКТОВ ПОСЕЩЕНИЯ считать не из чего, и там стадия остаётся своей:
# такие ОМ есть (бюллетень без объекта, посты заведены руками), и обнулить им
# стадию значило бы стереть работающее ради стройности.


def _stage_index(stage):
    return _STAGE_ORDER.index(stage) if stage in _STAGE_ORDER else 0


def event_force_need(event, visits=None):
    """Сколько людей просит МЕРОПРИЯТИЕ — единственный ответ на этот вопрос.

    СУММА потребностей объектов ПЛЮС посты, не отнесённые ни к одному из них:
    людей просят на все места сразу, и штаб делит одно число.

    НЕРАЗМЕЧЕННЫЕ ПОСТЫ СЧИТАЮТСЯ ЗДЕСЬ, И БЕЗ НИХ ЧИСЛО ПАДАЛО (Plane №476).
    Разрез `visit_object_posts` отдаёт неразмеченный пост ЕДИНСТВЕННОМУ
    объекту и НИКОМУ, как только объектов стало двое. Для потребности ОБЪЕКТА
    это правильно — приписать чужое значило бы выдумать факт. Но мероприятию
    такой пост нужен всё равно: наряд на него просят.

    ДВОЙНОГО СЧЁТА НЕТ: у ЕДИНСТВЕННОГО объекта неразмеченные посты уже сидят
    в его снимке, поэтому добавка включается только начиная со второго.

    🔴 ФУНКЦИЯ ОБЩАЯ, И ЭТО ГЛАВНОЕ В НЕЙ (Plane №743). Тот же вопрос задают
    ДВА пути: переход стадии (`recompute_event_stage`) и завершение
    рекогносцировки (`_autopass_demand_and_forces`). Формулы у них разошлись:
    №476 починил первый, а второй остался на `sum(объекты) or sum(строки)` —
    запасная ветка через `or` спасала только ПОЛНОСТЬЮ неразмеченный случай
    (`0 or 12` → 12), а при ЧАСТИЧНОЙ разметке коротила на частичной сумме.
    Автопроход отрабатывает ПЕРВЫМ, поэтому реестр показывал 5 до первого
    перехода стадии и сам менялся на 12 после — без действия человека и без
    строки в журнале. Двум ответам на один вопрос здесь взяться неоткуда.

    `visits` передаётся, когда список уже прочитан: лишний запрос на каждом
    переходе стадии — та же цена, что и у N+1, ради ухода от которого снимки
    вообще появились.

    ОБЪЕКТОВ НЕТ ВОВСЕ — складывать нечего, и число берётся прямо из расчёта
    постов: у такого ОМ снимков не существует, а люди на посты всё равно нужны.
    """
    if visits is None:
        visits = list(event.visit_objects.all())
    posts = event.recon_sector_posts or []
    if not visits:
        return _physical_need(posts)
    need = sum(int(visit.force_need or 0) for visit in visits)
    if len(visits) > 1:
        # 🔴 «НИЧЕЙ» — ЭТО И ПУСТАЯ РАЗМЕТКА, И ССЫЛКА В ПУСТОТУ (Plane №759).
        # Добавка отбирала посты по «`visitObjectId` пуст», а пост, чей объект
        # СНЯЛИ с мероприятия, не пуст и при этом ничей: `visit_object_posts`
        # его не отдаёт никому, и из числа он выпадал совсем. При этом
        # `remove_post` считает по ВСЕМ оставшимся постам и его учитывает —
        # потребность падала при переходе стадии и возвращалась при снятии
        # любого другого поста. Штаб собирал людей по числу, которое меняется
        # само, без действия человека и без строки в журнале: та же болезнь,
        # ради которой заведены №476 и №743, но по другому поводу.
        #
        # Выбран ответ (а) из карточки — считать такой пост МЕРОПРИЯТИЮ:
        # правка живёт на чтении и ничего не стирает. Ответ (б) — чистить
        # разметку при снятии объекта — даёт то же число, но трогает данные и
        # требует миграции для уже накопленных строк; он остаётся доступен
        # отдельным шагом и этой правке не мешает.
        alive = {str(visit.pk) for visit in visits}
        need += _physical_need(
            post
            for post in posts
            if str(post.get("visitObjectId") or "").strip() not in alive
        )
    return need


def recompute_event_stage(event):
    """Свести стадию, готовность и потребность мероприятия по его объектам.

    Стадия — НАИМЕНЬШАЯ среди объектов: мероприятие прошло этап тогда, когда
    его прошёл последний объект. Взять наибольшую значило бы объявить готовым
    ОМ, у которого половина мест ещё не расписана.

    Потребность — СУММА потребностей объектов ПЛЮС посты, не отнесённые ни к
    одному из них: людей просят на все места сразу, и штаб делит одно число.

    НЕРАЗМЕЧЕННЫЕ ПОСТЫ СЧИТАЮТСЯ ЗДЕСЬ, И БЕЗ НИХ ЧИСЛО ПАДАЛО В НОЛЬ
    (Plane №476). Разрез `visit_object_posts` отдаёт неразмеченный пост
    ЕДИНСТВЕННОМУ объекту и НИКОМУ, как только объектов стало двое. Для
    потребности ОБЪЕКТА это правильно — приписать чужое значило бы выдумать
    факт. Но мероприятию такой пост нужен всё равно: наряд на него просят, и
    из суммы одних объектных снимков он выпадал молча. У ОМ с двумя объектами
    и неразмеченным расчётом (ровно то, что оставляет после себя миграция
    0069) потребность обнулялась при первом же переходе стадии — без отказа,
    без записи в журнал, — и штаб собирал людей по числу, которого нет.

    ДВОЙНОГО СЧЁТА НЕТ: у ЕДИНСТВЕННОГО объекта неразмеченные посты уже сидят
    в его снимке (их вернул `visit_object_posts`), поэтому добавка включается
    только начиная со второго объекта.

    Запись идёт, только если что-то изменилось: лишний `save` дёргал бы
    `updated_at`, а по нему на экране написано «обновлено».
    """
    visits = list(event.visit_objects.all())
    if not visits:
        return event
    stage = min((v.stage for v in visits), key=_stage_index)
    need = event_force_need(event, visits)
    fields = []
    if event.stage != stage:
        event.stage = stage
        event.readiness_percent = STAGE_READINESS[stage]
        fields += ["stage", "readiness_percent"]
    if event.force_need != need:
        event.force_need = need
        fields.append("force_need")
    if fields:
        event.save(update_fields=[*fields, "updated_at"])
    return event


def advance_visits(event, stage, visits=None, *, actor=None):
    """Перевести объекты на стадию и пересчитать по ним мероприятие.

    `visits=None` — ВСЕ объекты: так работают переходы, которые человек делает
    для мероприятия целиком (бюллетень, ознакомление, закрытие). Переходы,
    у которых адресат — объект (согласование, возврат), передают его явно.

    `actor` доезжает до открытия оценивания (Plane №642): задания оценщика
    адресуются учётной записи, и без адресата очередь оценщика не отдаёт их
    НИКОМУ — заявленная цель «задания заводятся входом в этап 5» не
    достигалась вовсе. `None` остаётся законным значением: переходы бывают и
    без человека (пересчёт, обслуживание), и тогда адресата добирает первый
    же вызов с актором (`open_evaluation_for_event`, Plane №641).
    """
    rows = visits if visits is not None else list(event.visit_objects.all())
    for visit in rows:
        if visit.stage == stage:
            continue
        visit.stage = stage
        visit.save(update_fields=["stage", "updated_at"])
    if stage == "CONDUCT":
        # Оценивание открывается входом в этап 5 (`[ЗАК-02]`, Plane №433):
        # задания оценщика заводятся здесь, а не закрытием ОМ — иначе на
        # этапе оценивать было бы нечего. Вызов идемпотентен.
        from organization_management.apps.ops import ratings as ratings_service
        ratings_service.open_evaluation_for_event(event, actor=actor)
    return recompute_event_stage(event)


def _advance(event, stage, *, actor=None):
    """Стадия мероприятия целиком: объектам ставится та же, событие — вывод.

    Переход в журнал (`record_transition`) пишется по ФАКТУ смены стадии
    МЕРОПРИЯТИЯ. У ОМ с двумя объектами один объект может уйти вперёд, а
    мероприятие остаться — и записать такой переход значило бы соврать ленте:
    мероприятие никуда не переходило.
    """
    old_stage = event.stage
    if event.visit_objects.exists():
        advance_visits(event, stage, actor=actor)
    else:
        # ОМ без объектов посещения: считать не из чего, стадия своя.
        event.stage = stage
        event.readiness_percent = STAGE_READINESS[stage]
        event.save(update_fields=["stage", "readiness_percent", "updated_at"])
    if event.stage != old_stage:
        record_transition(event, old_stage, event.stage)
    return event


# ── Рекогносцировка ─────────────────────────────────────────────────────────


def _new_post_id() -> str:
    return f"post-{uuid4().hex[:12]}"


def _normalize_post_ids(rows, *, known_ids):
    """Идентификаторы строк расчёта постов выдаёт СЕРВЕР, а не клиент.

    Клиент обязан чем-то помечать ещё не сохранённые строки (React требует
    ключ), но его счётчик живёт в памяти вкладки и обнуляется на перезагрузке.
    Пока сервер писал присланный id как есть, у одного ОМ набиралось шесть
    постов с `recon-local-1` — и `placement/assign` по такому id попадал в
    ПЕРВЫЙ совпавший пост, то есть назначение уезжало на чужую строку
    (Plane №30).

    Здесь id сохраняется только если он уже принадлежит этому ОМ и в этой
    правке встречается впервые; всё остальное — новая строка и получает
    собственный id. Так переживают правку ссылки на посты (расстановка,
    ознакомление), а неизвестное клиентское имя не становится ключом.
    """
    used = set()
    remap = {}
    normalized = []
    for row in rows:
        original = str(row.get("id") or "").strip()
        row_id = original
        if not row_id or row_id not in known_ids or row_id in used:
            row_id = _new_post_id()
            while row_id in used or row_id in known_ids:
                row_id = _new_post_id()
        used.add(row_id)
        if original and original not in remap:
            remap[original] = row_id
        normalized.append({**row, "id": row_id})
    # Подпост ссылается на родителя ЕГО ЖЕ id (`parentPostId`), и родитель мог
    # приехать в этой же правке — тогда ссылка вела бы на клиентское имя,
    # которого в сохранённом расчёте нет. Переписываем по первому вхождению:
    # именно в него и целился клиент, отображая подпост под родителем.
    for row in normalized:
        parent = str(row.get("parentPostId") or "").strip()
        if parent and parent in remap:
            row["parentPostId"] = remap[parent]
    return normalized



#: Что человеку делать дальше — СВОЁ на каждый статус (Plane №533, доведено
#: ревью №825). Прежний текст говорил «документ на согласовании ИЛИ согласован»
#: и советовал одно на оба случая — «через возврат на доработку». Для
#: согласованного объекта этот совет НЕИСПОЛНИМ: `return_placement` требует
#: стадии «Согласование», а согласованный объект уже на «Ознакомлении». То есть
#: отказ называл ту самую величину, которая и вводила в заблуждение, и посылал
#: туда, куда не пройти.
_FROZEN_MESSAGE = {
    "SUBMITTED": (
        "Документ отправлен на согласование — состав только для чтения. "
        "Чтобы править: «Отозвать с согласования» (пока никто не подписал) "
        "или дождаться возврата согласующим."
    ),
    "APPROVED": (
        "Документ согласован — состав заморожен. Замена людей — на этапе "
        "«Ознакомление»; изменение состава постов — новой версией документа "
        "после возврата согласующим."
    ),
}

#: Закрытый объект заморожен независимо от статуса документа (`[ЗАК-05]`), и
#: статус там может быть любым, включая «Черновик». Отдельная строка, а не
#: запись в таблице выше: таблица отвечает на вопрос «что с документом», а это
#: — «объекта больше нет в работе».
_CLOSED_MESSAGE = (
    "Объект закрыт — изменения невозможны (`[ЗАК-05]`). Правка закрытого "
    "объекта возможна только его повторным открытием."
)


def _refuse_frozen_placement(visit, *, what):
    """Единый отказ заморозки: и по посту, и по объекту (Plane №535, №533).

    🔴 КОНВЕРТ ОДИН, А НЕ ДВА (найдено ревью №825). Предикат уже жил в одном
    месте (`placement_frozen`), а `DomainError` с кодом, `detail` и текстом
    был продублирован — и тексты успели разойтись («Расчёт постов объекта
    заморожен…» против «Расстановка объекта заморожена…») ещё до того, как
    кто-нибудь это заметил. Разное здесь ровно одно — ЧТО именно человек
    пытался изменить, и оно приходит параметром.
    """
    status = document_status_of(visit)
    closed = visit.stage == "CLOSED" or visit.closed_at is not None
    # Причина, а не «документ на согласовании или согласован»: у закрытого
    # объекта статус документа может быть любым, вплоть до черновика.
    why = _CLOSED_MESSAGE if closed else _FROZEN_MESSAGE[status]
    raise DomainError(
        "PLACEMENT_FROZEN",
        422,
        detail={
            "visitObjectId": str(visit.pk),
            "stage": visit.stage,
            "documentStatus": status,
            "closed": closed,
        },
        message=f"{what} заморожен(а): {why}",
    )


def _require_visit_placement_editable(visit):
    """Отказ, если расстановка объекта заморожена (Plane №535)."""
    if placement_frozen(visit):
        _refuse_frozen_placement(visit, what="Расчёт постов объекта")


@transaction.atomic
def update_recon(
    event_id,
    *,
    checklist,
    sector_posts,
    force_request=None,
    visit_object_id=None,
):
    """Правка рекогносцировки. `force_request` — запрос личного состава
    (Plane «Реестр ОМ-23»); `None` означает «поле не прислали» и оставляет
    сохранённое значение, а не обнуляет его: старые клиенты и мок-слой шлют
    тело без этого поля, и трактовка «нет ключа = ноль» стирала бы запрос при
    каждом чужом сохранении."""
    event = lock_event(event_id)
    target = (
        pick_visit_object(
            event,
            visit_object_id,
            no_objects="У мероприятия нет объектов посещения.",
            ambiguous=(
                "У мероприятия несколько объектов посещения — выберите объект."
            ),
        )
        if visit_object_id is not None or event.visit_objects.count() == 1
        else None
    )
    checklist = checklist or []
    # «Ключа нет» — не «пусто» (Plane №416, учтено в №424): отметка чек-листа
    # отдельным вызовом без пересылки постов стирала расчёт в пустой список, и
    # `recon/complete` падал `RECON_SECTOR_POSTS_EMPTY` без понятной причины.
    # Та же трактовка, что у `force_request` строкой ниже.
    if sector_posts is None:
        sector_posts = list(event.recon_sector_posts or [])
    field_errors = {}
    if force_request is not None:
        try:
            parsed_request = int(force_request)
        except (TypeError, ValueError):
            parsed_request = -1
        if parsed_request < 0:
            field_errors["forceRequest"] = ["Укажите целое число не меньше нуля."]
    else:
        parsed_request = None
    checklist = [normalize_check_item(item) for item in checklist]
    for index, item in enumerate(checklist):
        # Комментарий обязателен при «Замечание» (`[РЕК-04]`).
        if item["state"] == "REMARK" and not item["comment"]:
            field_errors[f"checklist.{index}.comment"] = ["Укажите комментарий."]
    # Объекты посещения ЭТОГО мероприятия: пост может принадлежать только им.
    # Чужой (или выдуманный) идентификатор молча превращал бы потребность
    # объекта в потребность никого — «неизвестно» вместо числа, и разбирались
    # бы с этим на экране, а не здесь (Plane №408).
    own_visit_ids = {
        str(pk) for pk in event.visit_objects.values_list("pk", flat=True)
    }
    stored_by_id = {
        str(row.get("id") or "").strip(): row
        for row in (event.recon_sector_posts or [])
        if str(row.get("id") or "").strip()
    }
    from organization_management.apps.operations.models_settings import OpsDictionaryEntry

    participation_kinds = set(
        OpsDictionaryEntry.objects.filter(
            dictionary_code="EVENT_PARTICIPATION_KINDS", is_active=True
        ).values_list("code", flat=True)
    )
    participation_kinds.add(PHYSICAL_SQUAD_KIND)
    seen_known_ids = set()
    for index, row in enumerate(sector_posts):
        if not str(row.get("sector", "")).strip():
            field_errors[f"sectorPosts.{index}.sector"] = ["Обязательное поле."]
        if not str(row.get("post", "")).strip():
            field_errors[f"sectorPosts.{index}.post"] = ["Обязательное поле."]
        try:
            row_need = int(row.get("need", 0))
        except (TypeError, ValueError):
            field_errors[f"sectorPosts.{index}.need"] = ["Должно быть целым числом не меньше 1."]
        else:
            if row_need < 1:
                field_errors[f"sectorPosts.{index}.need"] = ["Должно быть не меньше 1."]
        kind_code = _demand_kind_of(row)
        if kind_code not in participation_kinds:
            field_errors[f"sectorPosts.{index}.demandKindCode"] = [
                "Выберите действующий вид участия."
            ]
        visit_id = str(row.get("visitObjectId") or "").strip()
        if visit_id and visit_id not in own_visit_ids:
            field_errors[f"sectorPosts.{index}.visitObjectId"] = [
                "Объекта посещения нет в этом мероприятии."
            ]
        row_id = str(row.get("id") or "").strip()
        stored = stored_by_id.get(row_id)
        if stored is None:
            continue
        if row_id in seen_known_ids:
            field_errors[f"sectorPosts.{index}.id"] = [
                "Идентификатор поста повторяется."
            ]
        seen_known_ids.add(row_id)
        stored_visit_id = str(stored.get("visitObjectId") or "").strip()
        # Неразмеченную legacy-строку можно отнести к объекту.
        # Уже привязанный ID нельзя копировать/переносить в чужой
        # объект: иначе `_normalize_post_ids` оставит его копии,
        # а исходной строке выдаст новый ID, обойдя объектный гард.
        if target is not None and stored_visit_id and visit_id != stored_visit_id:
            field_errors[f"sectorPosts.{index}.id"] = [
                "Принадлежность существующего поста объекту не меняется."
            ]
    if field_errors:
        raise _validation(field_errors)
    # Посты объекта пишет его старший — без старшего объект закрыт (№424).
    # Нераспределённые строки (без `visitObjectId`) гард не трогает.
    #
    # 🔴 «ТРОНУТ» ЗНАЧИТ «ИЗМЕНЁН», А НЕ «УПОМЯНУТ» (Plane №634). Гард смотрел
    # на все объекты, названные в присланных постах, — а посты присылаются
    # ЦЕЛИКОМ, и при отметке одного пункта чек-листа список подставляется из
    # хранимого (запасной путь №416). Значит один объект без старшего делал
    # несохраняемой рекогносцировку ВСЕГО мероприятия: и чужие посты, и даже
    # галочку в чек-листе, к постам не относящуюся. То же у любого ОМ, чьи
    # посты старше правила.
    #
    # Сравниваются наборы постов по объекту: гард держит только те объекты,
    # чьи посты человек ДЕЙСТВИТЕЛЬНО правит. Перенос строки между объектами
    # меняет оба набора — оба и требуют старшего, это верно: пост уходит из
    # одного расчёта и приходит в другой.
    if target is not None and _unassigned_rows_changed_outside_claim(
        event, sector_posts, target.pk
    ):
        raise DomainError(
            "PERMISSION_DENIED",
            403,
            message="Неразмеченные посты изменяет только руководство ОМ.",
        )
    touched = _visits_with_changed_posts(event, sector_posts)
    if target is not None and touched - {str(target.pk)}:
        raise DomainError(
            "PERMISSION_DENIED",
            403,
            message="Рекогносцировку другого объекта изменять нельзя.",
        )
    for visit in event.visit_objects.filter(pk__in=touched or [-1]):
        _require_visit_chief(visit)
    # 🔴 ЗАМОРОЗКА ДЕЙСТВУЕТ И ЗДЕСЬ (Plane №535). Правка рекогносцировки
    # переписывает `recon_sector_posts` ЦЕЛИКОМ, минуя `_require_placement_
    # editable`, которым закрыты точечные операции расстановки. Через неё пост
    # СОГЛАСОВАННОГО объекта удалялся ответом 200: пост исчезал, назначение на
    # него оставалось сиротой, документ по-прежнему числился согласованным,
    # новой версии не появлялось. Согласованный документ расходился с фактом,
    # и расхождение нигде не отмечалось.
    #
    # Держатся только те объекты, чьи строки человек ДЕЙСТВИТЕЛЬНО правит, —
    # иначе один замороженный объект запер бы правку чужих постов и даже
    # галочку в чек-листе (ровно болезнь №634, вылеченная строкой выше).
    #
    # 🔴 НО НАБОР СВОЙ, А НЕ «ТОТ ЖЕ, ЧТО У СТАРШЕГО» (найдено ревью №825).
    # У гарда старшего он уже, и обеими своими границами не годился заморозке:
    # неразмеченные строки он выбрасывает (у ОМ с ОДНИМ объектом это ЕГО
    # посты), а сравнивает восемь полей из семнадцати (вне сравнения остаётся
    # в том числе `minRating`, который правится на этом же экране и уезжает в
    # подписываемый снимок). Разбор — в `_visits_with_edited_rows`.
    for visit in event.visit_objects.filter(
        pk__in=_visits_with_edited_rows(event, sector_posts) or [-1]
    ):
        _require_visit_placement_editable(visit)
    normalized_checklist = [
        {**item, "comment": str(item.get("comment", "")).strip()}
        for item in checklist
    ]
    known_ids = {
        str(row.get("id") or "") for row in (event.recon_sector_posts or [])
    }
    # 🔴 ЗДЕСЬ ТОЖЕ ИСЧЕЗАЮТ ПОСТЫ — И ЗАМЕЧАНИЯ К НИМ ОСТАВАЛИСЬ ВИСЕТЬ
    # (Plane №510, найдено ревью №825). Отвязка стояла только в
    # `remove_placement_post`, а расчёт исчезает и отсюда: у экрана
    # рекогносцировки есть «Удалить пост», «Удалить подпост» и «Удалить
    # сектор», и после возврата на доработку человек идёт чинить именно туда.
    # Замечание оставалось `OPEN` со ссылкой на несуществующий пост,
    # `_approval_ready` держал этап навсегда, а на экране согласующего
    # печаталось «пост <сырой id>» — дословно сценарий карточки, только вторым
    # входом. Правило проекта «все входы, а не первый попавшийся».
    incoming_ids = {str(row.get("id") or "") for row in sector_posts}
    stored_by_id = {
        str(row.get("id") or ""): row for row in (event.recon_sector_posts or [])
    }
    for gone_id in sorted(known_ids - incoming_ids):
        if not gone_id:
            continue
        _detach_remarks_of_post(event, gone_id, stored_by_id.get(gone_id) or {})
    event.recon_sector_posts = _normalize_post_ids(
        [
            {
                **row,
                "sector": str(row.get("sector", "")).strip(),
                "post": str(row.get("post", "")).strip(),
                "task": str(row.get("task", "")).strip(),
                "demandKindCode": _demand_kind_of(row),
                "demandSpecification": str(
                    row.get("demandSpecification", "")
                ).strip(),
                # Смена — свойство ПОСТА, как в эталоне (`posts[].shift`:
                # «Сектор A · смена 07:00–15:00»). До Plane №123 её вводили в
                # строке потребности, а когда бокс потребности сняли (№110),
                # задавать смену стало негде вовсе, и колонка на расстановке
                # опустела у всех новых мероприятий.
                #
                # Свободный текст, а не справочник: эталон пишет диапазон
                # времени, а прежний бокс писал «Дневная», и запирать домен в
                # один из двух форматов, не спросив заказчика, значило бы
                # решить за него.
                "shift": str(row.get("shift", "")).strip(),
                # Чей пост. Пустая строка приводится к None: «не размечен» —
                # это отсутствие ответа, а не объект с пустым именем.
                "visitObjectId": (
                    str(row.get("visitObjectId") or "").strip() or None
                ),
                "requirements": str(row.get("requirements", "")).strip(),
                "comment": str(row.get("comment", "")).strip(),
            }
            for row in sector_posts
        ],
        known_ids=known_ids,
    )
    event_fields = ["recon_sector_posts", "updated_at"]
    if target is None:
        event.recon_checklist = normalized_checklist
        event_fields.append("recon_checklist")
        if parsed_request is not None:
            event.recon_force_request = parsed_request
            event_fields.append("recon_force_request")
    else:
        target.recon_checklist = normalized_checklist
        target_fields = ["recon_checklist", "updated_at"]
        if parsed_request is not None:
            target.recon_force_request = parsed_request
            target_fields.append("recon_force_request")
        target.save(update_fields=target_fields)
        # Однообъектный legacy-ответ остаётся совместимым.
        if event.visit_objects.count() == 1:
            event.recon_checklist = normalized_checklist
            event_fields.append("recon_checklist")
            if parsed_request is not None:
                event.recon_force_request = parsed_request
                event_fields.append("recon_force_request")
    event.save(update_fields=event_fields)
    # Разметка постов могла переехать — с ней переезжает и потребность объекта.
    recompute_visit_needs(event)
    return event


def pick_visit_object(event, visit_object_id, *, no_objects, ambiguous):
    """Объект посещения, которому адресована операция этапа.

    ОДНО ПРАВИЛО НА ВСЕ ЭТАПЫ (Plane №408 — импорт постов, №411 —
    согласование): объект не назван и он ОДИН — берётся он, другого адресата
    нет; объектов несколько — ОТКАЗ, а не «первый попавшийся», потому что
    выбор за человеком, а угаданный адресат потом не отличить от названного;
    объектов нет вовсе — отказ с указанием завести объект.

    Тексты отказов приходят от вызывающего: «посты расчёта принадлежат
    объекту» и «документ принадлежит объекту» чинятся по-разному, и общая
    формулировка не подсказала бы ни того, ни другого.
    """
    visits = list(event.visit_objects.order_by("position", "pk"))
    if not visits:
        raise DomainError("VISIT_OBJECT_REQUIRED", 422, message=no_objects)
    if visit_object_id in (None, ""):
        if len(visits) > 1:
            raise DomainError("VISIT_OBJECT_REQUIRED", 422, message=ambiguous)
        return visits[0]
    target = next(
        (v for v in visits if str(v.pk) == str(visit_object_id)), None
    )
    if target is None:
        raise DomainError(
            "VISIT_OBJECT_NOT_FOUND",
            404,
            message="Объект посещения не найден в этом мероприятии.",
        )
    return target


def primary_visit_object(event):
    """Объект, которым отвечают ПОЛЯ МЕРОПРИЯТИЯ, пока их читатели не переехали.

    Мост шагов Ш-5…Ш-7 плана №385, а не самостоятельное понятие. Поля
    `approval_*` у `OpsSecurityEvent` ещё читает сериализатор (и через него —
    клиент, написанный до разреза по объектам); писать в них мутации перестали,
    поэтому единственный честный ответ «что показать в них» — состояние ПЕРВОГО
    объекта: ровно его показывал экран и до переезда, когда согласование было
    одно на мероприятие. Снимается вместе с полями в Ш-7 (№413).
    """
    # 🔴 ПОДТЯНУТЫЙ СПИСОК ЧИТАЕТСЯ, А НЕ ОБХОДИТСЯ (Plane №480). `order_by`
    # заводит НОВЫЙ queryset и игнорирует `prefetch_related` набора реестра:
    # на каждую строку уходил свой запрос, и не один — сериализатор зовёт это
    # трижды на мероприятие. `.all()` на подтянутой связи запросов не делает
    # вовсе, а порядок здесь тот же, что в `order_by`. Тот же приём и по той
    # же причине уже стоит в `_serialize_visit_objects` (Plane №786).
    if "visit_objects" in getattr(event, "_prefetched_objects_cache", {}):
        visits = sorted(
            event.visit_objects.all(), key=lambda v: (v.position, v.pk)
        )
        return visits[0] if visits else None
    return event.visit_objects.order_by("position", "pk").first()


def visit_object_posts(event, visit, *, single=None):
    """Строки расчёта постов, принадлежащие объекту посещения.

    У ЕДИНСТВЕННОГО объекта его посты — ВСЕ, включая неразмеченные: другим
    объектам они принадлежать не могут (так же считает `_visit_placement`
    сериализатора и разрез экрана `useVisitObjectScope`). У второго и
    последующих неразмеченная строка не принадлежит никому: приписать её
    объекту значило бы выдумать факт, которого в данных нет.
    """
    posts = event.recon_sector_posts or []
    scoped = [
        p for p in posts if str(p.get("visitObjectId") or "") == str(visit.pk)
    ]
    # `single` считает ВЫЗЫВАЮЩИЙ, когда уже знает ответ (Plane №480): своим
    # `count()` здесь мы делали по запросу на каждый вызов, а сериализатор
    # строки реестра зовёт это дважды на объект посещения. `None` — «не
    # знаю», тогда спрашиваем сами: у одиночных вызовов из ручек считать
    # заранее нечего.
    if single is None:
        single = event.visit_objects.count() == 1
    if single:
        return list(posts)
    return scoped


def _import_target(event, visit_object_id):
    """Объект посещения, для которого идёт импорт постов (Plane №408).

    Спецификация `[РЕК-05]`: «Импорт из паспорта ОБЪЕКТА ПОСЕЩЕНИЯ». До этого
    шага импорт брал паспорт МЕРОПРИЯТИЯ и клал посты в общий расчёт без
    указания, чьи они, — а `_visit_placement` из-за этого отвечал «неизвестно»
    у любого ОМ с двумя объектами: потребность объекта посчитать было не из
    чего.
    """
    return pick_visit_object(
        event,
        visit_object_id,
        no_objects=(
            "У мероприятия нет объектов посещения: добавьте объект — "
            "посты расчёта принадлежат ему, а не мероприятию."
        ),
        ambiguous=(
            "У мероприятия несколько объектов посещения — выберите, "
            "для какого импортировать посты."
        ),
    )


@transaction.atomic
def import_recon_from_passport(event_id, *, visit_object_id=None):
    event = lock_event(event_id)
    # Свой код у кнопки импорта (контракт мока): та же стадийная беда, что
    # INVALID_STAGE_TRANSITION, но карточка показывает свою подсказку.
    if event.stage != "RECON":
        raise DomainError("RECON_STAGE_REQUIRED", 422, message=
            "Расчёт постов формируется на этапе рекогносцировки.",
        )
    target = _import_target(event, visit_object_id)
    # Паспорт берётся у ОБЪЕКТА посещения.
    #
    # Снимок мероприятия годится ТОЛЬКО когда объект посещения — тот же самый
    # объект реестра, что у мероприятия: так выглядят строки, заведённые
    # бэкфиллом до появления собственных привязок. Для ЧУЖОГО объекта эта
    # подстановка импортировала бы посты одного объекта в расчёт другого —
    # молча и без единого признака на экране.
    same_object = (
        target.security_object_id is not None
        and target.security_object_id == event.security_object_id
    )
    binding = target.passport_binding or (
        event.passport_binding if same_object else None
    )
    if binding is None:
        raise DomainError(
            "NO_PASSPORT_VERSION",
            422,
            message=(
                f"У объекта «{target.object_name}» нет привязанной версии "
                "паспорта — импортировать посты не из чего."
            ),
        )
    version = OpsPassportVersion.objects.filter(
        pk=binding.get("versionId", "")
        if str(binding.get("versionId", "")).isdigit()
        else None
    ).first()
    if version is None:
        raise DomainError("PASSPORT_VERSION_NOT_FOUND", 422, message=
            "Привязанная версия паспорта недоступна — обратитесь к владельцу "
            "объекта.",
        )
    # Старший проверяется ПОСЛЕ паспорта: «импортировать не из чего» — ответ
    # про объект, и он не должен прятаться за «назначьте старшего» (№424).
    _require_visit_chief(target)
    # 🔴 ЗАМОРОЗКА — ЗАЩИТА ВГЛУБЬ, А НЕ ЗАКРЫТИЕ ИЗВЕСТНОЙ ДЫРЫ (Plane №868,
    # найдено ревью №535). Из четырёх писателей `recon_sector_posts` гарда не
    # было только здесь: импорт проверял лишь стадию МЕРОПРИЯТИЯ.
    #
    # Сценарий узкий: стадия мероприятия — наименьшая по объектам, новый
    # объект вступает с ней же, и «RECON при замороженном соседе» получается
    # по сути только после админского обхода этапов (`override_stage` двигает
    # стадии и статуса документа не трогает); обычно там же раньше сработает
    # `NOTHING_TO_IMPORT`. Но единственный незакрытый писатель — плохая опора:
    # правило «состав объекта после отправки документа не меняется» держится
    # тем, что его соблюдают ВСЕ входы, а не тем, что к последнему трудно
    # подойти.
    #
    # Проверяется ОБЪЕКТ ИМПОРТА, а не все объекты мероприятия: замороженный
    # сосед не должен запирать импорт в свой же чужой объект — это болезнь
    # №634, вылеченная ровно таким сужением в `update_recon`.
    _require_visit_placement_editable(target)
    # Повтор считается В ПРЕДЕЛАХ ОБЪЕКТА: один и тот же пост паспорта у двух
    # объектов посещения — это два разных поста расчёта, а не дубль.
    already_imported = {
        row.get("sourcePostId")
        for row in event.recon_sector_posts
        if row.get("sourcePostId") is not None
        and str(row.get("visitObjectId") or "") == str(target.pk)
    }
    added = []
    for sector in version.sectors_snapshot:
        for post in sector.get("posts", []):
            if post.get("id") in already_imported:
                continue
            added.append(
                {
                    "id": _new_post_id(),
                    "sector": sector.get("name", ""),
                    "post": post.get("name", ""),
                    "task": post.get("task", ""),
                    # паспорт описывает пост, а не численность на мероприятие:
                    # 1 — минимально допустимое, уточняет старший наряда
                    "need": 1,
                    # Смены в паспорте объекта НЕТ: он описывает пост вообще, а
                    # смена — про конкретное мероприятие. Импорт оставляет её
                    # пустой, заполняет старший наряда (Plane №123).
                    "shift": "",
                    "requirements": post.get("requirements", ""),
                    "result": None,
                    "comment": "",
                    "sourceSectorId": sector.get("id"),
                    "sourcePostId": post.get("id"),
                    "minRating": None,
                    # Чей это пост. Из этой разметки считаются «потребность» и
                    # «назначено» объекта в раскрытой строке реестра.
                    "visitObjectId": str(target.pk),
                }
            )
    if not added:
        raise DomainError("NOTHING_TO_IMPORT", 422, message= "Все посты этой версии паспорта уже в расчёте."
        )
    event.recon_sector_posts = [*event.recon_sector_posts, *added]
    event.save(update_fields=["recon_sector_posts", "updated_at"])
    return event


@transaction.atomic
def complete_recon(event_id, *, visit_object_id=None):
    event = lock_event(event_id)
    visits = list(event.visit_objects.all())
    # Совместимый адрес без `visitObjectId` у многообъектного ОМ доступен
    # только руководству/admin (это держит view-policy): он завершает прежний
    # event-wide расчёт. Поимённый старший всегда называет свой объект.
    # Без объектов остаётся legacy-путь: его используют сиды и старые
    # ОМ, где расчёт ещё живёт только на мероприятии.
    legacy_all = visit_object_id in (None, "") and len(visits) != 1
    target = None if legacy_all else pick_visit_object(
        event,
        visit_object_id,
        no_objects="У мероприятия нет объектов посещения.",
        ambiguous=(
            "У мероприятия несколько объектов посещения — выберите объект."
        ),
    )
    if target is None:
        _require_stage(
            event,
            "RECON",
            "Рекогносцировку можно завершить только на этапе «Рекогносцировка».",
        )
        for visit in visits:
            if visit.stage == "RECON":
                _require_visit_chief(visit)
    else:
        _require_visit_stage(
            target,
            "RECON",
            "Рекогносцировку объекта можно завершить только на его этапе «Рекогносцировка».",
        )
        # `[РЕК-07]` (№424/№982): завершает СВОЙ объект его назначенный
        # старший; сосед без старшего не запирает готовый объект.
        _require_visit_chief(target)
    # `[РЕК-04]`/`[РЕК-07]` (Plane №443): обязательные пункты не могут остаться
    # в «Не проверено»; «Замечание» — проверено, и завершать не мешает.
    #
    # 🔴 СЧИТАЕТСЯ ПО ШАБЛОНУ, А НЕ ПО ПРИСЛАННОМУ (Plane №541, доведено ревью
    # №825). Признак обязательности уже брался из шаблона (`_required_of`), но
    # сам ПЕРЕЧЕНЬ по-прежнему приходил снаружи: цикл шёл по
    # `event.recon_checklist`, а его целиком заменяет тело `PATCH /recon/`.
    # Значит `{"checklist": []}` снимало `[РЕК-07]` полностью, и то же давало
    # переименование `id` шаблонного пункта — проверять становилось нечего.
    # Дыра та же, что закрывал `_required_of`, только другим входом: правило,
    # которое можно выключить снаружи, правилом не является.
    #
    # ОТСУТСТВУЮЩИЙ пункт шаблона считается «Не проверено»: он и не проверен —
    # его нет. Отказать по нему честнее, чем промолчать; вернуть его в список
    # человек может тем же сохранением.
    checklist_source = (
        event.recon_checklist if target is None else target.recon_checklist
    )
    stored = {
        str(item.get("id") or ""): normalize_check_item(item)
        for item in (checklist_source or [])
    }
    unchecked = [
        check_id
        for check_id in sorted(TEMPLATE_CHECK_IDS)
        if stored.get(check_id, {"state": "UNCHECKED"})["state"] == "UNCHECKED"
    ]
    unchecked += [
        str(item.get("id") or "")
        for item in (checklist_source or [])
        if str(item.get("id") or "") not in TEMPLATE_CHECK_IDS
        and normalize_check_item(item)["required"]
        and normalize_check_item(item)["state"] == "UNCHECKED"
    ]
    if unchecked:
        raise DomainError("RECON_CHECKLIST_INCOMPLETE", 422, message=
            "Обязательные пункты чек-листа остались в «Не проверено».",
        )
    target_posts = (
        event.recon_sector_posts
        if target is None
        else visit_object_posts(event, target)
    )
    if not target_posts:
        raise DomainError("RECON_SECTOR_POSTS_EMPTY", 422, message=
            "Добавьте хотя бы один пост объекта, прежде чем завершать этап.",
        )
    # Число, которое получает штаб, — РАСЧЁТ ПО ПОСТАМ, а не отдельная оценка
    # старшего наряда: запроса личного состава на этапе больше нет (задача
    # заказчика Plane №64 «запрос сил не нужно делать на этом этапе»).
    # Считается здесь, а не на клиенте: экран расчёта — не единственный вход,
    # и сумма, присланная телом запроса, была бы утверждением клиента о том,
    # что сервер и так знает.
    #
    # Ручной ввод, если он уже был сохранён, НЕ затирается: у мероприятий,
    # прошедших рекогносцировку по прежним правилам, число ввёл человек, и
    # подменять его расчётом значило бы переписать чужое решение.
    if target is None:
        if event.recon_force_request < 1:
            event.recon_force_request = _physical_need(event.recon_sector_posts)
        event.recon_force_requested_at = Clock.now()
        event.save(
            update_fields=[
                "recon_force_request",
                "recon_force_requested_at",
                "updated_at",
            ]
        )
        _advance(event, "DEMAND")
        return _autopass_demand_and_forces(event)

    # Объект сначала покидает рекогносцировку ОТДЕЛЬНО. Стадия мероприятия —
    # минимум по объектам, поэтому сосед продолжает работу, а карточка ОМ
    # остаётся на RECON до последнего объекта.
    if target.recon_force_request < 1:
        target.recon_force_request = _physical_need(target_posts)
        target.save(update_fields=["recon_force_request", "updated_at"])

    old_event_stage = event.stage
    advance_visits(event, "DEMAND", [target])
    if event.stage != old_event_stage:
        record_transition(event, old_event_stage, event.stage)
    return _publish_completed_visit_demand(event, target)



# ── Потребность ─────────────────────────────────────────────────────────────
#
# `approve_demand` СНЯТА 26.08.2026 (Plane №149). Стадию «Потребность»
# проходит сервер (`_autopass_demand_and_forces`, Plane №110), миграция 0046
# провела через неё всё заведённое, форм у неё на клиенте нет, и мероприятий
# на этой стадии не осталось ни одного. Ручка `POST demand/approve/` снята
# вместе с функцией по решению заказчика — контракт правится осознанно, а не
# зарастает путями, которыми никто не ходит.


# ── Автопроход потребности и выделения сил ──────────────────────────────────
#
# Задача заказчика Plane №110: с шага «Расстановка» сняты боксы «подготовка
# расчёта» и «выделение сил» — «они не нужны». Форм, которыми человек вёл
# стадии `DEMAND` и `FORCES`, на клиенте больше нет, поэтому обе стадии
# проходит сервер сам, в момент завершения рекогносцировки.
#
# Стадии НЕ удалены из модели, и ручки `approve_demand`/`complete_forces`
# живы: по ним ведут мероприятия, заведённые прежним путём, и на них смотрит
# история переходов. Автопроход именно ПРОХОДИТ их, а не вырезает —
# «расширять, не подменять».
#
# Обе записи истории (`DEMAND→FORCES` и `FORCES→PLACEMENT`) пишутся: лента
# переходов обязана показать, что стадии были, иначе она соврёт про цепочку,
# по которой шло мероприятие.
#
# Потребность собирается ИЗ РАСЧЁТА ПОСТОВ рекогносцировки — другого источника
# у неё нет. Группа у автострок пустая сознательно: группу задавал человек в
# снятом боксе, и подставлять вместо него выдуманное название пула значило бы
# записать в данные утверждение, которого никто не делал.


# Подпись автозаявки на силы. Не название пула — его никто больше не вводит, —
# а источник числа: заявка одна на мероприятие и говорит, откуда взялась.
AUTO_FORCE_REQUEST_GROUP = "По расчёту рекогносцировки"
PHYSICAL_SQUAD_KIND = "PHYSICAL_SQUAD"


def _demand_kind_of(row):
    """Вид потребности; старые строки расчёта были только физнарядом."""
    return str(
        row.get("demandKindCode")
        or row.get("kindCode")
        or PHYSICAL_SQUAD_KIND
    ).strip()


def _physical_need(rows):
    return sum(
        max(int(row.get("need") or 0), 0)
        for row in (rows or [])
        if _demand_kind_of(row) == PHYSICAL_SQUAD_KIND
    )


def _sync_auto_force_request(event):
    """Свести числа автозаявки с фактом цепочки «Сбор сил».

    Заявку на силы правил человек в снятом боксе «выделение сил» (Plane №110);
    без него `allocatedCount` остался бы нулём навсегда, и лента штаба
    показывала бы вечный недобор при полностью собранном составе.

    Трогается ТОЛЬКО автозаявка: у мероприятий, которые вели числами по
    группам, эти строки заполнял человек, и пересчёт затёр бы его работу.
    """
    requests = event.force_requests or []
    if len(requests) != 1 or requests[0].get("group") != AUTO_FORCE_REQUEST_GROUP:
        return
    accepted = len(event.force_roster or [])
    requested = int(requests[0].get("requestedCount") or 0)
    status = "NOT_SENT"
    if accepted >= requested and requested > 0:
        status = "ALLOCATED"
    elif accepted > 0:
        status = "PARTIALLY_ALLOCATED"
    elif event.force_allocation:
        status = "SENT"
    event.force_requests = [
        {**requests[0], "allocatedCount": accepted, "status": status}
    ]


def recompute_visit_needs(event):
    """Потребность и «назначено» у каждого объекта — по ЕГО постам.

    Оба числа — СНИМКИ, а не выводы на чтении: их показывает раскрытая строка
    реестра (Plane №387), и считать их запросом на каждую строку значило бы
    вернуть N+1, ради ухода от которого замещающие и потребность вообще
    попали в строку объекта.

    Разрез тот же, что у согласования и у экрана (`visit_object_posts`): у
    единственного объекта неразмеченные посты — его, у второго и последующих —
    ничьи. Неразмеченные строки при нескольких объектах в сумму НЕ входят
    нигде: приписать их кому-то значило бы выдумать факт.
    """
    assignments = event.placement_assignments or []
    for visit in event.visit_objects.all():
        post_ids = {str(p.get("id")) for p in visit_object_posts(event, visit)}
        need = _physical_need(visit_object_posts(event, visit))
        assigned = sum(
            1 for a in assignments if str(a.get("postId")) in post_ids
        )
        if visit.force_need == need and visit.force_assigned == assigned:
            continue
        visit.force_need = need
        visit.force_assigned = assigned
        visit.save(update_fields=["force_need", "force_assigned", "updated_at"])
    return event


def _demand_rows_of(posts):
    """Строки потребности по расчёту постов.

    Вынесено из автопрохода после рекогносцировки, потому что читателей стало
    два: сам автопроход и снятие лишнего поста на «Расстановке» (Plane №259).
    Второй способ построить строку разошёлся бы с первым — и разошёлся бы
    именно в числе, по которому собирают людей.
    """
    rows = []
    for index, post in enumerate(posts or [], start=1):
        source_id = str(post.get("id") or "").strip()
        sector = str(post.get("sector") or "").strip()
        post_name = str(post.get("post") or "").strip()
        rows.append(
            {
                "id": f"demand-{source_id}" if source_id else f"demand-{index}",
                "sourcePostId": source_id or None,
                "visitObjectId": str(post.get("visitObjectId") or "").strip() or None,
                "sector": sector,
                "task": str(post.get("task") or post_name).strip(),
                "place": " · ".join(part for part in (sector, post_name) if part),
                "shift": str(post.get("shift") or "").strip(),
                "need": max(int(post.get("need") or 0), 0),
                "kindCode": _demand_kind_of(post),
                "specification": str(post.get("demandSpecification") or "").strip(),
                "requirements": str(post.get("requirements") or "").strip(),
                "comment": "",
            }
        )
    return rows


def _publish_completed_visit_demand(event, target):
    """Publish completed objects without consuming a neighbour's draft (§18)."""
    visits = list(event.visit_objects.all())
    ready = [visit for visit in visits if visit.stage not in ("BULLETIN", "RECON")]
    posts = [post for visit in ready for post in visit_object_posts(event, visit)]
    event.demand_rows = _demand_rows_of(posts)
    event.recon_force_request = sum(int(visit.recon_force_request or 0) for visit in ready)
    event.recon_force_requested_at = Clock.now()
    event.demand_approved = len(ready) == len(visits)
    requests = event.force_requests or []
    if not requests and event.recon_force_request > 0:
        requests = [{
            "id": "force-request-1", "group": AUTO_FORCE_REQUEST_GROUP,
            "requestedCount": event.recon_force_request, "allocatedCount": 0,
            "status": "NOT_SENT", "comment": "",
        }]
    elif len(requests) == 1 and requests[0].get("group") == AUTO_FORCE_REQUEST_GROUP:
        requests = [{**requests[0], "requestedCount": event.recon_force_request}]
    event.force_requests = requests
    _sync_auto_force_request(event)
    event.save(update_fields=[
        "demand_rows", "recon_force_request", "recon_force_requested_at",
        "demand_approved", "force_requests", "updated_at",
    ])
    # Only this object advances; the event continues to show the lowest stage.
    old_stage = event.stage
    advance_visits(event, "FORCES", [target])
    if event.stage != old_stage:
        record_transition(event, old_stage, event.stage)
    old_stage = event.stage
    advance_visits(event, "PLACEMENT", [target])
    if event.stage != old_stage:
        record_transition(event, old_stage, event.stage)
    return event


def _autopass_demand_and_forces(event):
    """Провести мероприятие через `DEMAND` и `FORCES` расчётом рекогносцировки.

    Возвращает мероприятие уже на стадии `PLACEMENT`. Идемпотентности не
    обещает: зовётся ровно из двух мест — завершения рекогносцировки и
    миграции-бэкфилла, и оба проверяют стадию до вызова.
    """
    rows = _demand_rows_of(event.recon_sector_posts)
    event.demand_rows = rows
    event.demand_approved = True
    # ПОТРЕБНОСТЬ СНАЧАЛА У ОБЪЕКТОВ, потом сумма у мероприятия (Plane №412):
    # число мероприятия — вывод, и считать его отдельно значило бы завести
    # второй ответ на «сколько людей просим».
    recompute_visit_needs(event)
    # 🔴 ЧИТАЕТСЯ ОБЩЕЙ ФОРМУЛОЙ, А НЕ СВОЕЙ (Plane №743). Здесь стояло
    # `sum(объекты) or sum(строки)`, и запасная ветка через `or` спасала
    # только ПОЛНОСТЬЮ неразмеченный расчёт: при частичной разметке она
    # коротила на частичной сумме, и неразмеченные посты выпадали.
    event.force_need = event_force_need(event)
    # Заявка на силы — ОДНА на мероприятие, а не по группам: групп больше
    # никто не вводит. Число в ней то же, что штаб видит во входящих, и
    # расходиться с `force_need` оно не может — считается той же формулой.
    event.force_requests = (
        [
            {
                "id": "force-request-1",
                "group": AUTO_FORCE_REQUEST_GROUP,
                "requestedCount": event.force_need,
                "allocatedCount": 0,
                "status": "NOT_SENT",
                "comment": "",
            }
        ]
        if event.force_need > 0
        else []
    )
    from_stage = event.stage
    # Стадию ставим ОБЪЕКТАМ, мероприятие берёт наименьшую (Plane №412). У ОМ
    # без объектов посещения считать не из чего — там стадия по-прежнему своя.
    if event.visit_objects.exists():
        for visit in event.visit_objects.all():
            visit.stage = "PLACEMENT"
            visit.save(update_fields=["stage", "updated_at"])
    event.stage = "PLACEMENT"
    event.readiness_percent = STAGE_READINESS["PLACEMENT"]
    event.save(
        update_fields=[
            "demand_rows",
            "demand_approved",
            "force_requests",
            "force_need",
            "stage",
            "readiness_percent",
            "updated_at",
        ]
    )
    if from_stage != "FORCES":
        record_transition(event, from_stage, "FORCES")
        from_stage = "FORCES"
    record_transition(event, from_stage, "PLACEMENT")
    return event


# ── Область действия для проверки прав ──────────────────────────────────────
#
# Заказчик просил разграничить цепочку сбора сил не только по действиям, но и
# по подразделениям (Plane №74): «в своём департаменте, не в чужом», «только по
# своему управлению». Область берётся ИЗ ДАННЫХ мероприятия, а не из тела
# запроса: присланная клиентом область была бы утверждением проверяемого о том,
# что он проверяет.


def allocation_scope_division(event_id, allocation_id):
    """Департамент строки раскладки — область для оповещения и отправки списка.

    Мероприятия или строки НЕТ — это 404, а не «нет доступа»: адрес строки
    стоит в URL, право на действие проверено картой ещё до тела, и подменять
    «такого адреса нет» отказом значило бы врать про причину. Ровно тот же 404
    вернул бы дальше сам сервис.

    Строка ЕСТЬ, но департамент в ней не читается — возвращается `None`, и
    проверка прав отказывает: сверять область не с чем, а пропускать
    непроверенное нельзя (fail-closed).
    """
    event = OpsSecurityEvent.objects.filter(pk=event_id).first()
    if event is None:
        raise _not_found("Мероприятие не найдено.", event_id)
    for row in event.force_allocation or []:
        if str(row.get("id")) == str(allocation_id):
            return _as_division_id(row.get("departmentId"))
    raise _not_found("Заявка департаменту не найдена.", allocation_id)


def employee_scope_division(employee_id):
    """Управление сотрудника — область для выделения его на мероприятие.

    Именно выделение проставляет статус «Участие на мероприятии», и именно его
    заказчик закрепил за начальником управления по СВОЕМУ управлению.

    `None` (сотрудника нет, либо у него нет штатной единицы, а значит и
    подразделения) — отказ на стороне проверки прав. Существование сотрудника
    здесь СОЗНАТЕЛЬНО не подтверждается: идентификатор приходит из тела
    запроса, и отвечать на него «такого нет» значило бы отдать проверяющему
    перебор по кадрам. Человеку с ролью без области и администратору это
    ничего не стоит — их проверка не сужает.
    """
    employee = _find_personnel(employee_id)
    if employee is None:
        return None
    division_id, _ = _employee_division(employee)
    return _as_division_id(division_id)


def placement_is_led_by(event, employee_id):
    """Ведёт ли расстановку ЭТОГО мероприятия именно этот сотрудник (Plane №74).

    Заказчик закрепил расстановку за «старшим объекта/мероприятия». В домене
    таких старших два и оба плоскими ссылками: `chief_employee_id` у самого ОМ
    и `chief_employee_id` у объекта посещения. Замещающие с правом правки
    расстановки (`deputy_can_edit_placement`) проверяются отдельно — у них своя
    привязка к посту.

    **Если старший НЕ НАЗНАЧЕН нигде — возвращается True.** Это осознанное
    послабление, а не дыра: запирать расстановку мероприятия, которому забыли
    назвать старшего, значит устраивать простой вместо разграничения. Право
    `placement.manage` при этом всё равно требуется — проверка отвечает лишь на
    вопрос «чьё это мероприятие», и когда ответа в данных нет, она молчит.
    Отклонение записано в `Decisions.md`; захочет заказчик строгости —
    достаточно убрать эту ветку.
    """
    if employee_id is None:
        chiefs = _placement_chiefs(event)
        return not chiefs
    chiefs = _placement_chiefs(event)
    if not chiefs:
        return True
    return int(employee_id) in chiefs


def _placement_chiefs(event):
    """Идентификаторы старших: мероприятия и всех его объектов посещения."""
    chiefs = set()
    if event.chief_employee_id is not None:
        chiefs.add(int(event.chief_employee_id))
    for visit in event.visit_objects.all():
        if visit.chief_employee_id is not None:
            chiefs.add(int(visit.chief_employee_id))
    return chiefs


def _as_division_id(value):
    """Идентификатор подразделения числом либо `None` — «область не установлена».

    Дерево подразделений сравнивает ЧИСЛА (`DivisionTreeSelector.subtree_ids`),
    а в JSON мероприятия идентификаторы лежат строками; строка «2» не совпала
    бы с числом 2 молча — и область, которую человек считает своей, перестала
    бы совпадать с собой.
    """
    try:
        return int(value)
    except (TypeError, ValueError):
        return None


# ── Раскладка потребности по департаментам ──────────────────────────────────
#
# Первое звено цепочки «Сбор сил на ОМ» (задача заказчика Plane №73): штаб
# получает с рекогносцировки ЧИСЛО и делит его между департаментами. Дальше
# по этой же раскладке пойдут оповещение управлений (СС-2), выделение людей
# (СС-3), отправка списка (СС-4) и приёмка штабом (СС-5).

# Стадии, на которых раскладку правят: она заводится сразу после
# рекогносцировки («Потребность») и остаётся живой, пока идёт выделение сил.
#
# «Расстановка» в списке с 26.08.2026 (Plane №110). После того как стадии
# «Потребность» и «Запрос сил» стал проходить сервер сам, мероприятие приходит
# на «Расстановку» СРАЗУ с рекогносцировки — и если бы раскладка кончалась на
# прежних двух стадиях, вся цепочка «Сбор сил на ОМ» (Plane №73) отбивалась бы
# 422 у каждого нового мероприятия. Штаб раскладывает и принимает людей, пока
# ОМ уже стоит на расстановке; пул подбора на доске растёт по мере приёмки.
_ALLOCATION_STAGES = ("DEMAND", "FORCES", "PLACEMENT")


def can_collect_forces(event):
    """A completed object's published demand opens collection during RECON."""
    if event.stage in _ALLOCATION_STAGES:
        return True
    if event.stage != "RECON" or not event.demand_rows:
        return False
    published_visit_ids = {
        str(row.get("visitObjectId")) for row in event.demand_rows
        if str(row.get("visitObjectId") or "").isdigit()
    }
    return event.visit_objects.filter(
        pk__in=published_visit_ids, stage__in=_ALLOCATION_STAGES,
    ).exists()


def published_visit_ids(event):
    """Object boundary of an early force collection; ``None`` means all."""
    if event.stage != "RECON":
        return None
    return {
        str(row.get("visitObjectId")) for row in (event.demand_rows or [])
        if str(row.get("visitObjectId") or "").isdigit()
    }


# Статус заявки департаменту. Правится раскладка только у тех, кого ещё не
# оповещали: у остальных внутри уже живут управления и выделенные люди.
_ALLOCATION_DRAFT = "DRAFT"

#: Статусы, при которых строка не считается просроченной (Plane №287, №553).
#: Список — здесь, а не литералом внутри `allocation_is_overdue`: его читает и
#: клиент через ответ ручки, и рассуждение о каждом члене живёт в докстринге
#: функции.
_ALLOCATION_NOT_OVERDUE = ("SUBMITTED", "ACCEPTED", "RETURNED", "DECLINED")

#: Статусы, при которых разбивка по управлениям уже не правится (Plane №554).
#: Не «всё, что не DRAFT»: отказ (`DECLINED`) — тоже не DRAFT, а управлений
#: при нём никто не запрашивал.
_QUOTAS_LOCKED_STATUSES = ("SUBMITTED", "ACCEPTED", "RETURNED")


def force_demand_total(event):
    """Сколько всего людей делит штаб.

    Число берётся у запроса с рекогносцировки (`recon_force_request`) —
    именно оно приходит штабу и именно его он раскладывает. `force_need`
    (сумма утверждённой потребности) — другой факт и появляется позже;
    у мероприятий, доехавших до утверждения, он подставляется запасным, иначе
    раскладка старых строк упёрлась бы в ноль и не сохранилась бы вовсе.
    """
    if event.recon_force_requested_at is not None:
        return int(event.recon_force_request or 0)
    return int(event.recon_force_request or 0) or int(event.force_need or 0)


def _department_directory(ids):
    """Департаменты по идентификаторам: {id: имя}.

    Проверка «это департамент» делается ЗДЕСЬ, а не на клиенте: выбор из
    справочника подсказывает, но не запрещает — запрос приходит и мимо формы.
    """
    from organization_management.apps.divisions.models import Division

    rows = Division.objects.filter(
        pk__in=[i for i in ids if str(i).isdigit()],
        division_type=Division.DivisionType.DEPARTMENT,
        is_active=True,
    ).values_list("pk", "name")
    return {str(pk): name for pk, name in rows}


def allocation_default_due_at(event):
    """Срок сдачи списка по умолчанию — ЗА СУТКИ до начала мероприятия.

    Эталон заказчика печатает у заявки колонку «Срок» — дату со временем, за
    сутки до ОМ (Plane №287). Поля такого не было вовсе: у мероприятия есть
    своя дата и своё время, а момента, к которому департамент обязан отдать
    список, не существовало ни как поля, ни как правила — «опоздал» и «ещё
    можно» были неразличимы.

    Время берётся у самого ОМ; его может не быть (`event_time` необязателен —
    дата известна всегда, час не всегда), и тогда началом считается полночь.
    Зона — местная зона раздела: срок читает человек, и «за сутки до» он
    отмеряет по своим часам, а не по UTC.
    """
    start_time = event.event_time or dt.time(0, 0)
    naive = dt.datetime.combine(event.business_date, start_time)
    local = naive.replace(tzinfo=_ops_local_tz())
    return (local - dt.timedelta(days=1)).isoformat()


def _ops_local_tz():
    from organization_management.apps.operations.clock import _local_tz

    return _local_tz()


def _parse_due_at(raw):
    """ISO-момент из тела запроса; None — значения нет. Ошибку поднимает вызывающий."""
    text = str(raw or "").strip()
    if not text:
        return None
    parsed = dt.datetime.fromisoformat(text.replace("Z", "+00:00"))
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=_ops_local_tz())
    return parsed.isoformat()


def _whole_number(value, field, *, message="Укажите целое число."):
    """Целое из тела запроса — или ошибка поля (Plane №556).

    🔴 ГОЛЫЙ `int()` НЕ ПРОВЕРЯЕТ ЦЕЛОСТЬ, А ПРИВОДИТ К НЕЙ. `int(2.9)` даёт 2,
    `int(True)` даёт 1, и оба молча становились официальным ответом
    департамента: текст ошибки обещал «целое число», а сервер вместо отказа
    округлял вниз. Département слал 2.9 (описка в форме, кривой клиент) и
    получал 2 — цифру, которой не называл, и узнать об этом было неоткуда.

    Принимается: `int` (кроме `bool`) и строка из одних цифр со знаком.
    Отвергается всё остальное — `True`, `2.9`, `"2.9"`, `"2 "`, `None`,
    списки. `bool` отвергается ОТДЕЛЬНОЙ веткой, потому что в Python он
    подкласс `int` и проверка `isinstance(value, int)` пропустила бы его.
    """
    if isinstance(value, bool):
        raise _validation({field: [message]})
    if isinstance(value, int):
        return value
    text = value if isinstance(value, str) else None
    if text is not None and _WHOLE_NUMBER_RE.fullmatch(text.strip()):
        return int(text.strip())
    raise _validation({field: [message]})


#: Целое число в тексте: знак и цифры, ничего больше. `"2.0"` не проходит
#: сознательно — это запись дробного, и принимать её значило бы гадать, что
#: имел в виду отправитель.
_WHOLE_NUMBER_RE = re.compile(r"[+-]?\d+")


def allocation_is_overdue(row, now=None):
    """Срок вышел, а список не отправлен.

    Считается НА ЧТЕНИИ, а не хранится: «просрочено» — это факт о текущем
    моменте, и записанный флаг устарел бы через минуту после записи (то же
    правило, что у прогресса управлений и статуса дня).

    Отправленная, принятая и возвращённая штабом заявка просроченной не
    считается: у первых двух список уже у штаба, а возвращённая ждёт решения
    департамента по замечаниям — свой срок ей назначает штаб заново.

    🔴 `RETURNED` В СПИСКЕ ОСВОБОЖДЁННЫХ — не мелочь и не поблажка. Департамент
    мог сдать ВОВРЕМЯ, а штаб вернуть на доработку уже после срока: без этой
    ветки строка краснела бы «Просрочено» и добавляла +1 к `overdueCount` за
    задержку, которой департамент не совершал. Обещание docstring и поведение
    кода разошлись в первой редакции — код догнал (найдено ревью).

    🔴 `DECLINED` ТОЖЕ ОСВОБОЖДЁН (Plane №553). «0 закрывает запрос»
    (`[СБС-21]`) — это ОКОНЧАТЕЛЬНЫЙ ответ департамента, а не молчание: слать
    ему больше нечего и ждать от него нечего. Без этой ветки отказавшаяся
    строка после `dueAt` краснела «Просрочено» в таблице департамента и вечно
    прибавляла +1 к `overdueCount` штабу — то есть замысел «отказ закрывает
    запрос» отменялся счётчиком, который его не знал.
    """
    if row.get("status") in _ALLOCATION_NOT_OVERDUE:
        return False
    due_at = row.get("dueAt")
    if not due_at:
        return False
    moment = now or Clock.now()
    return moment > dt.datetime.fromisoformat(due_at)


@transaction.atomic
def split_force_demand(event_id, *, rows):
    """Сохранить раскладку потребности по департаментам.

    Правится целиком списком, а не по строке: раскладка — одно решение штаба
    («кому сколько»), и построчное сохранение позволяло бы сумме уехать за
    потребность между двумя запросами.
    """
    event = lock_event(event_id)
    if not can_collect_forces(event):
        raise DomainError(
            "INVALID_STAGE_TRANSITION",
            422,
            message=(
                "Раскладывать потребность можно после рекогносцировки и до "
                "согласования расстановки."
            ),
        )
    rows = rows or []
    field_errors = {}
    group_demands = {
        str(row.get("id")): row
        for row in (event.demand_rows or [])
        if row.get("id") and _demand_kind_of(row) != PHYSICAL_SQUAD_KIND
    }
    assigned_group_ids = set()
    for index, row in enumerate(rows):
        if not str(row.get("departmentId", "")).strip():
            field_errors[f"rows.{index}.departmentId"] = ["Выберите департамент."]
        # Целость проверяется, а не достигается округлением (Plane №556):
        # `int(2.9)` дал бы 2 и сохранил бы департаменту число, которого штаб
        # не называл.
        try:
            need = _whole_number(row.get("need", 0), "need")
        except DomainError:
            # Не `continue`: срок этой же строки проверяется ниже, и человеку
            # надо показать ВСЕ ошибки формы разом, а не по одной за заход.
            field_errors[f"rows.{index}.need"] = ["Укажите целое число."]
        else:
            if need < 1:
                field_errors[f"rows.{index}.need"] = ["Должно быть не меньше 1."]
        # Срок НЕОБЯЗАТЕЛЕН в теле: не задан — берётся умолчание «за сутки до
        # ОМ». Заданный, но неразбираемый — ошибка формы, а не молчаливое
        # умолчание: иначе опечатка в дате выглядела бы как принятое решение.
        if row.get("dueAt") not in (None, ""):
            try:
                _parse_due_at(row.get("dueAt"))
            except ValueError:
                field_errors[f"rows.{index}.dueAt"] = [
                    "Укажите момент в формате ГГГГ-ММ-ДДTЧЧ:ММ."
                ]
        raw_group_ids = row.get("groupDemandIds", [])
        if not isinstance(raw_group_ids, list):
            field_errors[f"rows.{index}.groupDemandIds"] = [
                "Ожидается список строк потребности."
            ]
        else:
            normalized_group_ids = [str(value).strip() for value in raw_group_ids]
            if len(normalized_group_ids) != len(set(normalized_group_ids)):
                field_errors[f"rows.{index}.groupDemandIds"] = [
                    "Строка потребности указана дважды."
                ]
            elif any(value not in group_demands for value in normalized_group_ids):
                field_errors[f"rows.{index}.groupDemandIds"] = [
                    "Строка специальной группы не найдена в потребности ОМ."
                ]
            elif assigned_group_ids.intersection(normalized_group_ids):
                field_errors[f"rows.{index}.groupDemandIds"] = [
                    "Строка потребности уже адресована другому департаменту."
                ]
            assigned_group_ids.update(normalized_group_ids)
    if field_errors:
        raise _validation(field_errors)

    known = _department_directory([row.get("departmentId") for row in rows])
    seen = set()
    for index, row in enumerate(rows):
        key = str(row.get("departmentId")).strip()
        if key not in known:
            field_errors[f"rows.{index}.departmentId"] = [
                "Такого департамента нет в справочнике."
            ]
        elif key in seen:
            # Дважды один департамент — не «сумма двух строк», а ошибка ввода:
            # у департамента один ответственный и одна заявка.
            field_errors[f"rows.{index}.departmentId"] = [
                "Департамент уже есть в раскладке."
            ]
        seen.add(key)
    if field_errors:
        raise _validation(field_errors)

    # 🔴 БЛОКИРОВКИ НА СУММУ НЕТ (`[СБС-12]`, Plane №944). Здесь стоял отказ
    # `ALLOCATION_OVER_DEMAND` при сумме сверх потребности; спецификация
    # говорит прямо: «Блокировки на сумму нет» — запрос штаба пожелание, не
    # наряд (`[СБС-01]`), департамент отвечает своей цифрой, и штаб вправе
    # просить с запасом. Перебор виден в «Итоге» карточки словами, а не
    # отбивается.

    # 🔴 У ДЕПАРТАМЕНТА БЫВАЕТ БОЛЬШЕ ОДНОЙ СТРОКИ (Plane №675). Довыделение
    # недобора (`[СБС-12]`, №426) дописывает департаменту ВТОРУЮ строку с
    # `topUpOf`, а этот редактор знает про одну на департамент: его проверка
    # `seen` прямо запрещает прислать две («Департамент уже есть в
    # раскладке»). Пока строки ключились по департаменту, в словаре оставалась
    # ПОСЛЕДНЯЯ — то есть довыделенная, — и пересохранение раскладки ради
    # чужого `need` уничтожало обе: довыделенная в `saved` не попадала вовсе, а
    # исходная пересобиралась из чужого `kept` и теряла id, состав, ответ
    # департамента, момент оповещения и пометку опоздания. История в
    # `ops_department_requests` оставалась сиротой.
    #
    # Разделение по `topUpOf`, а не по «первая/последняя»: довыделение —
    # отдельный вид строки, и признак у него свой. Редактор правит БАЗОВЫЕ
    # строки; довыделенные проходят сквозь него нетронутыми — их правит своя
    # ручка (`top_up`), а не эта форма.
    top_ups = [
        item for item in (event.force_allocation or []) if item.get("topUpOf")
    ]
    previous = {
        str(item.get("departmentId")): item
        for item in (event.force_allocation or [])
        if not item.get("topUpOf")
    }
    # Департамент, которому уже сказали собирать людей, из раскладки молча не
    # исчезает: его управления оповещены, а люди, возможно, уже выделены.
    #
    # Довыделенные строки в этой проверке не участвуют и не должны: снять
    # базовую строку, у которой есть довыделение, и так нельзя — довыделять
    # можно только ОТПРАВЛЕННЫЙ запрос (`top_up` отбивает черновик), а
    # отправленный отсюда не снимается по правилу ниже.
    dropped = [
        item
        for key, item in previous.items()
        if key not in seen and item.get("status") != _ALLOCATION_DRAFT
    ]
    if dropped:
        names = ", ".join(str(item.get("departmentName") or "—") for item in dropped)
        raise DomainError(
            "ALLOCATION_LOCKED",
            422,
            message=(
                f"Заявка уже ушла в департамент ({names}) — снять его из "
                "раскладки нельзя."
            ),
        )

    saved = []
    for row in rows:
        key = str(row.get("departmentId")).strip()
        kept = previous.get(key, {})
        saved.append(
            {
                # Не `**kept`: состав строки перечислен явно ниже, и спред
                # лишь тащил бы в неё ключи прежних форм. Красная проба на
                # него зелёная — это и есть признак лишнего гарда.
                "id": kept.get("id") or f"force-allocation-{key}-{_now_iso()}",
                "departmentId": key,
                "departmentName": known[key],
                "need": int(row.get("need", 0)),
                "status": kept.get("status") or _ALLOCATION_DRAFT,
                # Комментарий штаба переживает пересохранение ЧУЖОЙ строки
                # (Plane №1023, ревью №944/№825): у редактора нет поля ввода
                # для этого комментария вовсе (он приходит из сида/API), и
                # `SplitEditor` шлёт отправленные строки как `{departmentId,
                # need}` без ключа `comment` — тем же правилом, что уже
                # применено к `dueAt`/`submittedLate`/`answerComment` ниже,
                # отсутствующий в запросе комментарий не стирает сохранённый.
                "comment": str(row.get("comment") or kept.get("comment") or "").strip(),
                # Срок сдачи списка (Plane №287). Задан штабом — берём его;
                # не задан — сохраняем прежний, а у новой строки считаем
                # умолчание. Пересчитывать умолчание каждой правке нельзя:
                # штаб, однажды передвинувший срок, потерял бы своё решение
                # при следующем сохранении раскладки.
                "dueAt": (
                    _parse_due_at(row.get("dueAt"))
                    or kept.get("dueAt")
                    or allocation_default_due_at(event)
                ),
                "notifiedAt": kept.get("notifiedAt"),
                "submittedAt": kept.get("submittedAt"),
                # Пометка опоздания переносится ВМЕСТЕ с моментом отправки, а
                # не теряется при пересохранении раскладки (найдено ревью,
                # Plane №287): строка пересобирается явным перечнем ключей, и
                # забытый ключ означает не «поле пустое», а «факт стёрт».
                # Департамент сдал с опозданием → штаб пересохранил раскладку
                # ради чужого `need` → пометка исчезала навсегда.
                "submittedLate": bool(kept.get("submittedLate")),
                "decidedAt": kept.get("decidedAt"),
                "decisionComment": kept.get("decisionComment", ""),
                "directorates": kept.get("directorates", []),
                "members": kept.get("members", []),
                "groupDemands": [
                    group_demands[group_id]
                    for group_id in (
                        [str(value).strip() for value in row.get("groupDemandIds", [])]
                        if "groupDemandIds" in row
                        else [
                            str(item.get("id"))
                            for item in kept.get("groupDemands", [])
                            if str(item.get("id")) in group_demands
                        ]
                    )
                ],
                "groupOffers": kept.get("groupOffers", []),
                # Ответ департамента «Выделяем: X» (Plane №391, `[СБС-21]`)
                # переносится по тому же правилу, что и опоздание выше: строка
                # пересобирается явным перечнем, и забытый ключ — стёртый
                # факт. Штаб, пересохранивший раскладку ради чужого `need`,
                # стирал бы ответ департамента.
                "allocating": kept.get("allocating"),
                "answerComment": kept.get("answerComment", ""),
                "declinedAt": kept.get("declinedAt"),
                # Статус, который был у строки ДО отказа (Plane №552),
                # переносится по тому же правилу, что и всё выше: строка
                # пересобирается явным перечнем ключей, и забытый ключ —
                # стёртый факт. Без него отзыв отказа терял «Возвращено
                # штабом» всякий раз, когда штаб между делом пересохранил
                # раскладку.
                "statusBeforeDecline": kept.get("statusBeforeDecline"),
            }
        )
    # Довыделенные строки дописываются В КОНЕЦ и в прежнем виде: редактор их
    # не правит, а порядок «базовые, затем довыделения» тот же, в котором их
    # заводит `top_up`.
    event.force_allocation = [*saved, *top_ups]
    # Раскладка есть — значит заявка ушла из «не отправлена»: лента штаба
    # обязана отличать «ещё не тронуто» от «раздано и ждём людей».
    _sync_auto_force_request(event)
    event.save(update_fields=["force_allocation", "force_requests", "updated_at"])
    return event


def _find_allocation(event, allocation_id):
    row = next(
        (
            item
            for item in (event.force_allocation or [])
            if item.get("id") == allocation_id
        ),
        None,
    )
    if row is None:
        raise _not_found("Заявка департаменту не найдена.", allocation_id)
    return row


@transaction.atomic
def split_directorate_quotas(event_id, allocation_id, rows, *, actor):
    """Департамент делит СВОЮ квоту между управлениями (Plane №272, Ш-1).

    Третий уровень раскладки: штаб делит потребность между департаментами
    (СС-1), департамент — между своими управлениями. До этого шага строка
    управления существовала (`directorates[]`, её заводит оповещение), но
    квоты у неё не было вовсе: управление узнавало «нас позвали» и не
    узнавало «сколько от нас нужно».

    Правила названы эталоном заказчика и повторяют СС-1, а не выдумывают свои:

    - **Перебор — отказ, недобор — нет.** Разложить больше квоты департамента
      невозможно; разложить меньше можно, и остаток назван числом: департамент
      раскладывает в несколько заходов, а запрет на это превратил бы форму в
      ультиматум.
    - **Правка только ДО запроса управлений** («Квоты редактируются до запроса
      управлений» — подпись эталона). После оповещения управление уже работает
      по названному числу, и молчаливая правка означала бы, что человек
      выделяет людей под квоту, которой больше нет.
    - **Адресат обязан быть управлением ЭТОГО департамента.** Иначе департамент
      раздавал бы квоты чужим.
    - **Список целиком одним запросом**, как и у СС-1: «кому сколько» — одно
      решение, и построчное сохранение позволяло бы сумме уехать за квоту
      между двумя запросами.
    """
    from organization_management.apps.divisions.models import Division

    event = lock_event(event_id)
    if not can_collect_forces(event):
        raise DomainError(
            "INVALID_STAGE_TRANSITION",
            422,
            message=(
                "Делить квоту между управлениями можно после рекогносцировки "
                "и до согласования расстановки."
            ),
        )
    target = _find_allocation(event, allocation_id)
    # 🔴 ЗАПИРАЕТ ФАКТ ЗАПРОСА, А НЕ «СТАТУС НЕ DRAFT» (Plane №554). Прежнее
    # условие `status != DRAFT` ловило заодно ОТКАЗ: департамент, ответивший
    # «0» ещё до рассылки, терял разбивку целиком — все поля квот гасли,
    # кнопка «Отправить в управления» пропадала, а объяснение на экране и в
    # ответе сервера называло причиной «управления уже запрошены», хотя ни
    # одного не запрашивали. Чтобы вернуть себе форму, департамент должен был
    # догадаться отозвать собственный отказ — а текст вёл его в другую
    # сторону.
    #
    # Настоящее правило эталона одно: «квоты редактируются ДО запроса
    # управлений». Факт запроса — это `notifiedAt` строки, его ставит
    # `notify_directorates`. Отправленный и принятый список запирается
    # отдельно: там решение принимает уже штаб.
    if target.get("notifiedAt") or target.get("status") in _QUOTAS_LOCKED_STATUSES:
        raise DomainError(
            "DIRECTORATE_QUOTAS_LOCKED",
            422,
            message=(
                "Управления уже запрошены — квоты правятся до запроса. "
                "Чтобы изменить раскладку, отзовите список."
            ),
        )

    known = {
        str(pk): name
        for pk, name in Division.objects.filter(
            parent_id=target["departmentId"],
            division_type=Division.DivisionType.DIRECTORATE,
            is_active=True,
        ).values_list("pk", "name")
    }
    # 🔴 СПИСОК, А НЕ ПОСЛЕДОВАТЕЛЬНОСТЬ (доводка №668 по ревью №825). Тот же
    # класс дефекта, что уже чинили для employeeIds/protectedPersonIds/
    # remarks/split_force_demand: `list(rows or [])` без проверки типа делал
    # из строки "18" список символов ['1', '8'] — `.get()` у строки нет,
    # `AttributeError` → 500 вместо конверта поля.
    if rows is not None and not isinstance(rows, list):
        raise _validation({"rows": ["Ожидается список строк."]})
    incoming = list(rows or [])
    seen = set()
    assigned_group_ids = set()
    allowed_group_ids = {
        str(row.get("id")) for row in target.get("groupDemands", []) if row.get("id")
    }
    prepared = []
    for index, row in enumerate(incoming):
        key = str(row.get("divisionId") or "").strip()
        if key not in known:
            raise _validation(
                {f"rows.{index}.divisionId": ["Управление не найдено в департаменте."]}
            )
        if key in seen:
            raise _validation(
                {f"rows.{index}.divisionId": ["Управление указано дважды."]}
            )
        seen.add(key)
        # Целость, а не округление (Plane №556): `int(2.9)` тихо дал бы
        # управлению 2 человека вместо отказа по кривому полю.
        need = _whole_number(row.get("need", 0), f"rows.{index}.need")
        if need < 0:
            raise _validation({f"rows.{index}.need": ["Число не может быть меньше нуля."]})
        raw_group_ids = row.get("groupDemandIds", [])
        if not isinstance(raw_group_ids, list):
            raise _validation(
                {f"rows.{index}.groupDemandIds": ["Ожидается список строк потребности."]}
            )
        group_ids = [str(value).strip() for value in raw_group_ids]
        if len(group_ids) != len(set(group_ids)):
            raise _validation(
                {f"rows.{index}.groupDemandIds": ["Строка потребности указана дважды."]}
            )
        if any(value not in allowed_group_ids for value in group_ids):
            raise _validation(
                {f"rows.{index}.groupDemandIds": ["Группа не адресована департаменту."]}
            )
        repeated = assigned_group_ids.intersection(group_ids)
        if repeated:
            raise _validation(
                {f"rows.{index}.groupDemandIds": ["Группа уже назначена другому управлению."]}
            )
        assigned_group_ids.update(group_ids)
        prepared.append((key, need, group_ids))

    # ПРЕДЕЛ — ОТ «ВЫДЕЛЯЕМ» (Plane №392, `[СБС-22]`: «разбивка по
    # управлениям — от цифры „Выделяем“»). Пока департамент не ответил —
    # запрос штаба, как и раньше: раскладывать больше, чем сам решил дать,
    # нельзя; больше, чем просили, — тоже (ответ это разрешает, раскладка нет:
    # она делит именно ответ).
    # 🔴 СУММА СЧИТАЕТСЯ ПО СОХРАНЯЕМОМУ, А НЕ ПО ПРИСЛАННОМУ (Plane №559).
    # Строке, которую запрос не назвал, квота НЕ обнуляется (правило ниже, и
    # оно верное), — а предел проверялся только по присланным строкам. Значит
    # защита, ради которой правку и делали, обходилась двумя запросами: квота
    # 2, управления A и B; `{rows:[{A,2}]}` принято, затем `{rows:[{B,2}]}`
    # тоже принято — и сохранено A=2 И B=2 при квоте 2. Докстринг выше прямо
    # утверждает, что этого быть не может.
    need_of = {key: need for key, need, _group_ids in prepared}
    groups_of = {key: group_ids for key, _need, group_ids in prepared}
    kept_rows = {
        str(row.get("divisionId")): row for row in target.get("directorates", [])
    }
    resulting_groups = {
        key: groups_of.get(key, list(kept_rows.get(key, {}).get("groupDemandIds", [])))
        for key in known
    }
    for key, kept in kept_rows.items():
        if key not in resulting_groups:
            resulting_groups[key] = list(kept.get("groupDemandIds", []))
    group_owner = {}
    for key, group_ids in resulting_groups.items():
        for group_id in group_ids:
            previous_owner = group_owner.get(group_id)
            if previous_owner is not None and previous_owner != key:
                raise _validation(
                    {"rows": ["Группа уже назначена другому управлению."]}
                )
            group_owner[group_id] = key
    resulting = {
        key: need_of.get(key, int(kept_rows.get(key, {}).get("need") or 0))
        for key in known
    }
    # Выбывшее из департамента управление считается тоже: его люди никуда не
    # делись, и не считать их значило бы разрешить перебор через перевод
    # управления.
    for key, kept in kept_rows.items():
        if key not in resulting:
            resulting[key] = int(kept.get("need") or 0)
    total = sum(resulting.values())

    answered = target.get("allocating")
    quota = int(answered if answered is not None else (target.get("need") or 0))
    if total > quota:
        raise DomainError(
            "DIRECTORATE_QUOTA_OVERFLOW",
            422,
            message=(
                f"Разложено {total} при «Выделяем» {quota} — лишних {total - quota}."
                if answered is not None
                else f"Разложено {total} при квоте департамента {quota} — "
                f"лишних {total - quota}."
            ),
            detail={"quota": str(quota), "split": str(total)},
        )

    saved = []
    for key, name in known.items():
        kept = kept_rows.get(key, {})
        saved.append(
            {
                "id": kept.get("id") or f"force-directorate-{key}",
                "divisionId": key,
                "name": name,
                # Не названному в запросе квота НЕ обнуляется молча: запрос
                # описывает то, что человек правил, а строка, которой он не
                # касался, остаётся как была. Именно поэтому предел выше
                # считается по `resulting`, а не по `prepared`.
                "need": resulting[key],
                "groupDemandIds": resulting_groups[key],
                "notifiedAt": kept.get("notifiedAt"),
            }
        )
    # Управление, выбывшее из департамента, из заявки не стирается — тем же
    # правилом, что и у оповещения: его след это факт.
    for key, kept in kept_rows.items():
        if key not in known:
            saved.append({**kept, "need": resulting[key]})

    event.force_allocation = [
        {**item, "directorates": saved} if item.get("id") == allocation_id else item
        for item in event.force_allocation
    ]
    event.save(update_fields=["force_allocation", "updated_at"])
    audit_service.record(
        actor=actor,
        action=audit_service.FORCE_ALLOCATION_SPLIT,
        entity_type=audit_service.ENTITY_SECURITY_EVENT,
        entity_id=event.pk,
        new_value={
            "code": event.code,
            "departmentName": target.get("departmentName"),
            "quota": quota,
            "split": total,
            "rows": [
                {"divisionId": key, "need": need, "groupDemandIds": group_ids}
                for key, need, group_ids in prepared
            ],
        },
    )
    return event


@transaction.atomic
def notify_directorates(event_id, allocation_id, *, actor):
    """Оповестить управления департамента о заявке (Plane №73, шаг «СС-2»).

    Оповещение — МОМЕНТ у управления, а не булев флаг: департамент оповещает
    повторно (добавилось управление, потерялся ответ), и «оповещено ли» без
    времени не отвечает на вопрос «когда сказали».

    Персональной рассылки нет сознательно: `notifications.Notification`
    адресуется пользователю, а связи «учётка ↔ начальник управления» в системе
    до задачи №36 нет вовсе. Адресат заявки при этом хранится — разделение по
    ролям (№74) начнётся с прав, а не с переписывания модели.
    """
    from organization_management.apps.divisions.models import Division

    event = lock_event(event_id)
    if not can_collect_forces(event):
        raise DomainError(
            "INVALID_STAGE_TRANSITION",
            422,
            message=(
                "Оповещать управления можно после рекогносцировки и до "
                "согласования расстановки."
            ),
        )
    target = _find_allocation(event, allocation_id)

    directorates = list(
        Division.objects.filter(
            parent_id=target["departmentId"],
            division_type=Division.DivisionType.DIRECTORATE,
            is_active=True,
        )
        .order_by("lft", "id")
        .values_list("pk", "name")
    )
    if not directorates:
        raise DomainError(
            "ALLOCATION_NO_DIRECTORATES",
            422,
            message=(
                f"У департамента «{target['departmentName']}» нет действующих "
                "управлений — оповещать некого."
            ),
        )

    now = _now_iso()
    known = {
        str(row.get("divisionId")): row for row in target.get("directorates", [])
    }
    # 🔴 РАССЫЛКА НЕ УХОДИТ ШИРЕ ОБЕЩАННОГО (Plane №558). Разбивка ограничена
    # цифрой «Выделяем» в момент сохранения, но сама цифра правится, пока
    # список не ушёл, — значит предел обходился порядком действий: разложить 3,
    # пока «Выделяем» не задан (потолок падает на запрос штаба), затем ответить
    # «1». Разбивка не пересчитывается, и начальникам уходило суммарно 3
    # против обещанного одного. Карточка департамента писала «Больше
    # „Выделяем“ на 2», а состояние жило и рассылалось.
    #
    # Проверка стоит ЗДЕСЬ, а не в `respond_allocation`: ответ департамента —
    # его решение, и запрещать «0 закрывает запрос» из-за сохранённой разбивки
    # значило бы отменить правило `[СБС-21]`. Вред же наступает ровно в момент
    # рассылки, и отбивается он тоже здесь — с указанием, что поправить.
    planned = sum(
        int((known.get(str(pk)) or {}).get("need") or 0) for pk, _name in directorates
    )
    answered = target.get("allocating")
    promised = int(answered if answered is not None else (target.get("need") or 0))
    has_directorate_work = any(
        int((known.get(str(pk)) or {}).get("need") or 0) > 0
        or bool((known.get(str(pk)) or {}).get("groupDemandIds"))
        for pk, _name in directorates
    )
    if not has_directorate_work:
        raise DomainError(
            "DIRECTORATE_QUOTA_EMPTY",
            422,
            message=(
                "По управлениям ничего не разложено — оповещать некого. "
                "Сначала разложите людей или специальные группы и сохраните "
                "раскладку."
            ),
            detail={"quota": str(promised), "split": "0"},
        )
    if planned > promised:
        raise DomainError(
            "DIRECTORATE_QUOTA_OVERFLOW",
            422,
            message=(
                f"По управлениям разложено {planned}, а обещано {promised} — "
                f"лишних {planned - promised}. Поправьте разбивку и повторите."
            ),
            detail={"quota": str(promised), "split": str(planned)},
        )
    rows = []
    for pk, name in directorates:
        key = str(pk)
        kept = known.get(key)
        need = int((kept or {}).get("need") or 0)
        group_demand_ids = list((kept or {}).get("groupDemandIds", []))
        has_work = need > 0 or bool(group_demand_ids)
        rows.append(
            {
                "id": (kept or {}).get("id") or f"force-directorate-{key}",
                "divisionId": key,
                "name": name,
                # Квота управления (Plane №272, Ш-1) переносится КАК ЕСТЬ:
                # её ставит департамент отдельным действием, оповещение
                # только рассылает. Пересборка строки без этого поля стирала
                # бы раскладку в момент рассылки — то есть ровно тогда, когда
                # число впервые становится нужным.
                "need": need,
                "groupDemandIds": group_demand_ids,
                # Уже оповещённому момент НЕ переписывается: повторное нажатие
                # добирает тех, кому не сказали, а не объявляет всех
                # оповещёнными заново — иначе «когда сказали» стало бы
                # временем последнего нажатия у всех сразу.
                #
                # 🔴 И СТАВИТСЯ ОН ТОЛЬКО ТОМУ, КОМУ ОТПРАВИЛИ (Plane №557,
                # найдено ревью №825). Момент проставлялся КАЖДОМУ действующему
                # управлению, включая те, у которых квоты нет и которые
                # `notify_directorate_heads` сознательно пропускает. Экран
                # печатал такому управлению «Запрошено ДД.ММ ЧЧ:ММ», журнал
                # честно писал его в `directoratesWithoutQuota` — и разбор
                # «почему управление никого не выделило» уходил по ложному
                # следу: экран утверждал, что просили. Это то же правило, что
                # ввела соседняя №551: «разослана» — это `notifiedAt`, и ставит
                # его только состоявшаяся рассылка.
                "notifiedAt": (
                    ((kept or {}).get("notifiedAt") or now) if has_work
                    else (kept or {}).get("notifiedAt")
                ),
            }
        )
    # Управление, выбывшее из департамента, из заявки не стирается: оповещение
    # состоялось, и его след — факт, а не текущая принадлежность.
    for key, kept in known.items():
        if all(row["divisionId"] != key for row in rows):
            rows.append(kept)

    event.force_allocation = [
        {
            **item,
            "directorates": rows,
            "status": "NOTIFIED" if item.get("status") == "DRAFT" else item["status"],
            "notifiedAt": item.get("notifiedAt") or now,
        }
        if item.get("id") == allocation_id
        else item
        for item in event.force_allocation
    ]
    event.save(update_fields=["force_allocation", "updated_at"])
    # Персональная рассылка начальникам управлений (Plane №392, `[СБС-22]`):
    # с ролями и областями (№74) адресат есть — учётка с областью ровно на
    # управление. Отчёт (кому не дошло) уходит в журнал: экран заявки
    # получает мероприятие, а не отчёт, и терять имена управлений без
    # начальника молча нельзя.
    from organization_management.apps.ops.forces_notify import notify_directorate_heads

    delivery = notify_directorate_heads(event, target, rows)
    audit_service.record(
        actor=actor,
        action=audit_service.FORCE_ALLOCATION_NOTIFIED,
        entity_type=audit_service.ENTITY_SECURITY_EVENT,
        entity_id=event.pk,
        new_value={
            "code": event.code,
            "departmentId": target["departmentId"],
            "departmentName": target["departmentName"],
            "need": target["need"],
            "directorates": [row["name"] for row in rows],
            "notifiedHeads": delivery["notified"],
            # 🔴 ЧИСЛО НЕ ОТВЕЧАЕТ НА ВОПРОС, РАДИ КОТОРОГО ЗАПИСЬ ВЕДЁТСЯ
            # (Plane №921). Соседние графы этой же записи поимённые —
            # `headlessDirectorates`, `directoratesWithoutQuota`,
            # `undeliveredHeads`, — и только доставленное было числом. Разбор
            # «почему у нас никого не запросили» упирался в `notifiedHeads: 3`:
            # неизвестно, дошло ли до нужного человека, а у управления может
            # быть несколько учёток с областью. Число оставлено рядом: оно
            # отвечает на «сколько», список — на «кому именно».
            "notifiedHeadsList": delivery["delivered"],
            "headlessDirectorates": delivery["headlessDirectorates"],
            # Кому не отправляли (нет квоты) и кому не дошло (Plane №557,
            # №561). Оба списка поимённые: разбор «почему у нас никого не
            # запросили» идёт по журналу, и число вместо имён на этот вопрос
            # не отвечает.
            "directoratesWithoutQuota": delivery["withoutQuota"],
            "undeliveredHeads": delivery["undelivered"],
        },
    )
    return event


# Статус привлечения на мероприятие. Код справочника, а не своя строка: расход
# дня и «Сбор сил» считают привлечённых именно по нему.
#
# 🔴 ОДИН КОД НА ВСЮ ЗАНЯТОСТЬ (Plane №486, решение заказчика 04.09.2026:
# «убери статусы Привлечён на мероприятие, обе»). Было два —
# `EVENT_ASSIGNMENT` (наряд) и `EVENT_ASSIGNMENT_GROUP` (боевая группа), — и
# различие между ними жило В КОДЕ СТАТУСА. Теперь код один, а различие живёт
# там, где ему и место: в `participations[].kind_code`. Старые коды остались
# только у ЧИТАТЕЛЕЙ (`strength_report.EVENT_INVOLVEMENT_CODES`) — ради строк,
# не прошедших миграцию.
ASSIGNMENT_STATUS_CODE = "IN_EVENT"

# Вид участия выводится ИЗ КОДА СТАТУСА — тем же соответствием, что и бэкфилл
# Ш-3 (`operations/migrations/0062_status_participation.py`). Держать его в
# одном месте нельзя: миграция обязана быть замороженной во времени, а
# рабочий код — жить. Поэтому соответствие продублировано ОСОЗНАННО, и
# расхождение стережёт `apps/ops/tests/test_ops_participation_kind_guard.py`:
# он читает словарь `kind_of` из исходника миграции (разбором `ast` — литерал
# там локальный) и сверяет с этим. До №734 оба комментария называли пробу
# `test_allocation_kind_matches_backfill`, которой НЕ СУЩЕСТВОВАЛО ни одной, —
# задвоение не стерёг никто, а обещание сторожа читалось как выполненное.
_PARTICIPATION_KIND_BY_STATUS = {
    # Цепочка выделяет людей физическим нарядом — это её вид участия.
    "IN_EVENT": "PHYSICAL_SQUAD",
    # Старые коды оставлены ради строк, не прошедших миграцию №486; их и
    # сверяет с замороженным бэкфиллом Ш-3 сторож, названный выше.
    "EVENT_ASSIGNMENT": "PHYSICAL_SQUAD",
    "EVENT_ASSIGNMENT_GROUP": "SCREENING_GROUP",
}


def _employee_division(employee):
    """Подразделение сотрудника — через штатную единицу.

    У `Employee` своего подразделения НЕТ: связь идёт через `staff_unit`, и
    строки у неё может не быть вовсе (обратный OneToOne бросает исключение).
    """
    from organization_management.apps.employees.models import Employee

    try:
        staff_unit = employee.staff_unit
    except Employee.staff_unit.RelatedObjectDoesNotExist:
        return None, ""
    if staff_unit is None or staff_unit.division is None:
        return None, ""
    return str(staff_unit.division_id), staff_unit.division.name


class RegistryReadContext:
    """Чтения, общие на СТРАНИЦУ реестра, а не на строку (Plane №909).

    🔴 ЗАЧЕМ. Три самых дорогих поля строки — назначения, состав и раскладка —
    каждое спрашивало своё: справочник статусов (`ops_status_types`, полный
    скан на КАЖДЫЙ вызов), перекрытия дня (`ops_employee_statuses`) и кадровые
    записи. На строку выходило шесть запросов, и все шесть росли линейно вместе
    с числом мероприятий. Сторож реестра этого не видел: его фикстура оставляла
    все три поля ПУСТЫМИ, а вьюхи начинаются с `if not rows: return []`.

    🔴 ПОЧЕМУ КОНТЕКСТ, А НЕ КЭШ ВНУТРИ СЕЛЕКТОРА. Кэш на уровне селектора
    пришлось бы гасить при каждой правке справочника, и он жил бы дольше
    запроса — то есть отвечал бы вчерашним составом на сегодняшний вопрос.
    Контекст живёт ровно один ответ ручки: собран во вьюхе, отдан сериализатору,
    выброшен. Никакой инвалидации не требуется по построению.

    Контекста НЕТ — всё работает как раньше, построчно: карточка одного ОМ,
    документы, команды. Там строка одна, и собирать для неё пакет незачем.
    """

    def __init__(self):
        self._status_names = None
        #: {деловая дата: {id сотрудника: (код, подпись)}} — по датам, потому
        #: что предикат «действует на дату» у расхода спрашивается на дату.
        self._statuses_by_date = {}
        self._employees = {}
        #: {id мероприятия: [строки участия]} — см. `prime_participations`.
        self._participations = {}
        #: Карта детей подразделений — одна на ответ (Plane №933).
        self._division_children = None
    # Через контекст страницы, если он собран (Plane №1031): та же карточка
    # сотрудника, что уже подняли для `_merge_status_members` выше, второго
    # запроса на строку не нужно.
    if not member_ids:
        live_division = {}
    elif read_context is not None:
        live_division = read_context.divisions_of(member_ids)
    else:
        live_division = StaffUnitSelector.divisions_of(member_ids)
