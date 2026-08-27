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
from uuid import uuid4

from django.db import transaction

from organization_management.apps.operations import audit_service
from organization_management.apps.operations.clock import Clock
from organization_management.apps.operations.exceptions import DomainError
from organization_management.apps.operations.models_event import (
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

# Шаблон чек-листа рекогносцировки нового ОМ (порт мок-фикстуры).
RECON_CHECKLIST_TEMPLATE = [
    "Подъездные пути и парковка",
    "Периметр и ограждение",
    "Входные группы и КПП",
    "Пути эвакуации",
    "Связь и электропитание",
]

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


def lock_event(event_id):
    """Событие под замком агрегата; незнакомый id — 404 с конвертом."""
    if not str(event_id).isdigit():
        raise _not_found("Мероприятие не найдено.", event_id)
    event = (
        OpsSecurityEvent.objects.select_for_update().filter(pk=event_id).first()
    )
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
def create_event(
    *,
    title,
    object_id,
    business_date,
    business_date_end=None,
    kind=None,
    event_time=None,
    protected_person_id=None,
    location=None,
    chief_employee_id=None,
    actor,
):
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
        chief_employee_id=chief.pk if chief is not None else None,
        chief_name=personnel_display_name(chief) if chief is not None else "",
        stage=initial_stage,
        readiness_percent=STAGE_READINESS[initial_stage],
        force_need=0,
        conflicts_count=0,
        # Подпись, а не id учётки: поле уходит на экран карточки и в значения
        # фильтра реестра. Идентификатор остаётся аудиту — ему нужен именно он.
        owner_name=actor_display_name(actor),
        brief_description="",
        initial_tasks="",
        recon_checklist=[
            {
                "id": f"checklist-{index}",
                "label": label,
                "done": False,
                "result": None,
                "comment": "",
            }
            for index, label in enumerate(RECON_CHECKLIST_TEMPLATE)
        ],
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
            position=0,
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
    )
    event.refresh_from_db()
    return event


@transaction.atomic
def update_visit_object(event_id, visit_object_id, *, visit_day, note):
    """Правка дня посещения и примечания у объекта посещения.

    Оба поля переехали сюда из патча сводки ГВО (ключ `visits`, «Реестр
    ОМ-35.1»): список объектов теперь один — таблица, — и править его подпись
    надо там же, где он живёт. Сам объект здесь не меняется: подмена объекта
    посещения — это снятие одной строки и добавление другой, у них своя
    расстановка и свои замещающие.

    `visitDay` пустой (не пришёл, `null` или пустая строка) — день посещения
    снимается, и сводка снова показывает объект в дате мероприятия. Это ОТВЕТ,
    а не отсутствие ответа: «в день ОМ» — нормальное состояние строки.
    """
    event = lock_event(event_id)
    if event.stage == "CLOSED":
        raise DomainError(
            "INVALID_STAGE_TRANSITION",
            422,
            message="Мероприятие закрыто — объекты посещения не меняются.",
        )
    visit = _visit_object_or_404(event, visit_object_id)

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
    visit.save(update_fields=["visit_day", "note", "updated_at"])
    event.refresh_from_db()
    return event


@transaction.atomic
def remove_visit_object(event_id, visit_object_id):
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
    event.delete()
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
def update_bulletin(event_id, *, brief_description, initial_tasks):
    event = lock_event(event_id)
    field_errors = {}
    brief = str(brief_description or "").strip()
    tasks = str(initial_tasks or "").strip()
    if brief == "":
        field_errors["briefDescription"] = ["Обязательное поле."]
    if tasks == "":
        field_errors["initialTasks"] = ["Обязательное поле."]
    if field_errors:
        raise _validation(field_errors)
    event.brief_description = brief
    event.initial_tasks = tasks
    event.save(update_fields=["brief_description", "initial_tasks", "updated_at"])
    return event


@transaction.atomic
def complete_bulletin(event_id):
    event = lock_event(event_id)
    _require_stage(
        event, "BULLETIN", "Бюллетень можно завершить только на этапе «Бюллетень»."
    )
    # Гейт держит ОБЪЕКТ, а не текст бюллетеня. Новые ОМ с объектом заводятся
    # сразу на рекогносцировке (см. `create_event`), и требовать описание с
    # задачами от ОМ, заведённых до этого правила, значило бы держать две
    # разные цепочки для одного и того же состояния. Осматривать нечего ровно
    # тогда, когда объекта нет — там текст бюллетеня остаётся условием: он
    # единственное, что старший наряда получает до выезда.
    has_object = (
        event.security_object_id is not None
        or event.visit_objects.exists()
    )
    if not has_object and (
        event.brief_description.strip() == "" or event.initial_tasks.strip() == ""
    ):
        raise DomainError("BULLETIN_INCOMPLETE", 422, message=
            "Заполните и сохраните описание и первичные задачи либо добавьте "
            "объект посещения, прежде чем открывать рекогносцировку.",
        )
    return _advance(event, "RECON")


_STAGE_ORDER = [
    "BULLETIN", "RECON", "DEMAND", "FORCES", "PLACEMENT", "APPROVAL",
    "ACKNOWLEDGEMENT", "CONDUCT", "CLOSED",
]


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


def _advance(event, stage):
    old_stage = event.stage
    event.stage = stage
    event.readiness_percent = STAGE_READINESS[stage]
    event.save(update_fields=["stage", "readiness_percent", "updated_at"])
    record_transition(event, old_stage, stage)
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



@transaction.atomic
def update_recon(event_id, *, checklist, sector_posts, force_request=None):
    """Правка рекогносцировки. `force_request` — запрос личного состава
    (Plane «Реестр ОМ-23»); `None` означает «поле не прислали» и оставляет
    сохранённое значение, а не обнуляет его: старые клиенты и мок-слой шлют
    тело без этого поля, и трактовка «нет ключа = ноль» стирала бы запрос при
    каждом чужом сохранении."""
    event = lock_event(event_id)
    checklist = checklist or []
    sector_posts = sector_posts or []
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
    for index, item in enumerate(checklist):
        if item.get("result") == "NEEDS_CHANGES" and not str(
            item.get("comment", "")
        ).strip():
            field_errors[f"checklist.{index}.comment"] = ["Укажите комментарий."]
    for index, row in enumerate(sector_posts):
        if not str(row.get("sector", "")).strip():
            field_errors[f"sectorPosts.{index}.sector"] = ["Обязательное поле."]
        if not str(row.get("post", "")).strip():
            field_errors[f"sectorPosts.{index}.post"] = ["Обязательное поле."]
        if int(row.get("need", 0)) < 1:
            field_errors[f"sectorPosts.{index}.need"] = ["Должно быть не меньше 1."]
    if field_errors:
        raise _validation(field_errors)
    event.recon_checklist = [
        {**item, "comment": str(item.get("comment", "")).strip()}
        for item in checklist
    ]
    known_ids = {
        str(row.get("id") or "") for row in (event.recon_sector_posts or [])
    }
    event.recon_sector_posts = _normalize_post_ids(
        [
            {
                **row,
                "sector": str(row.get("sector", "")).strip(),
                "post": str(row.get("post", "")).strip(),
                "task": str(row.get("task", "")).strip(),
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
                "requirements": str(row.get("requirements", "")).strip(),
                "comment": str(row.get("comment", "")).strip(),
            }
            for row in sector_posts
        ],
        known_ids=known_ids,
    )
    fields = ["recon_checklist", "recon_sector_posts", "updated_at"]
    if parsed_request is not None:
        event.recon_force_request = parsed_request
        fields.append("recon_force_request")
    event.save(update_fields=fields)
    return event


@transaction.atomic
def import_recon_from_passport(event_id):
    event = lock_event(event_id)
    # Свой код у кнопки импорта (контракт мока): та же стадийная беда, что
    # INVALID_STAGE_TRANSITION, но карточка показывает свою подсказку.
    if event.stage != "RECON":
        raise DomainError("RECON_STAGE_REQUIRED", 422, message=
            "Расчёт постов формируется на этапе рекогносцировки.",
        )
    binding = event.passport_binding
    if binding is None:
        raise DomainError("NO_PASSPORT_VERSION", 422, message= NO_PUBLISHED_VERSION_TEXT)
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
    already_imported = {
        row.get("sourcePostId")
        for row in event.recon_sector_posts
        if row.get("sourcePostId") is not None
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
                }
            )
    if not added:
        raise DomainError("NOTHING_TO_IMPORT", 422, message= "Все посты этой версии паспорта уже в расчёте."
        )
    event.recon_sector_posts = [*event.recon_sector_posts, *added]
    event.save(update_fields=["recon_sector_posts", "updated_at"])
    return event


@transaction.atomic
def complete_recon(event_id):
    event = lock_event(event_id)
    _require_stage(
        event,
        "RECON",
        "Рекогносцировку можно завершить только на этапе «Рекогносцировка».",
    )
    if not all(item.get("done") for item in event.recon_checklist):
        raise DomainError("RECON_CHECKLIST_INCOMPLETE", 422, message=
            "Не все пункты чек-листа отмечены выполненными.",
        )
    if not event.recon_sector_posts:
        raise DomainError("RECON_SECTOR_POSTS_EMPTY", 422, message=
            "Добавьте хотя бы один пост, прежде чем завершать этап.",
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
    if event.recon_force_request < 1:
        event.recon_force_request = sum(
            max(int(row.get("need") or 0), 0) for row in event.recon_sector_posts
        )
    # Момент отправки запроса штабу. Проставляется ЗДЕСЬ, а не при правке
    # расчёта: до завершения этапа расчёт — черновик старшего наряда, штаб его
    # не видит, и лента «что пришло нового» считала бы черновики.
    event.recon_force_requested_at = Clock.now()
    event.save(
        update_fields=[
            "recon_force_request",
            "recon_force_requested_at",
            "updated_at",
        ]
    )
    # Стадии «Потребность» и «Запрос сил» человек больше не ведёт руками
    # (Plane №110): их проходит сервер расчётом рекогносцировки, и завершение
    # осмотра выводит мероприятие сразу на «Расстановку».
    _advance(event, "DEMAND")
    return _autopass_demand_and_forces(event)


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


def _autopass_demand_and_forces(event):
    """Провести мероприятие через `DEMAND` и `FORCES` расчётом рекогносцировки.

    Возвращает мероприятие уже на стадии `PLACEMENT`. Идемпотентности не
    обещает: зовётся ровно из двух мест — завершения рекогносцировки и
    миграции-бэкфилла, и оба проверяют стадию до вызова.
    """
    rows = [
        {
            "id": f"demand-{index}",
            "sector": str(post.get("sector") or "").strip(),
            "task": str(post.get("task") or post.get("post") or "").strip(),
            "shift": "",
            "need": max(int(post.get("need") or 0), 0),
            "group": "",
            "requirements": str(post.get("requirements") or "").strip(),
            "comment": "",
        }
        for index, post in enumerate(event.recon_sector_posts, start=1)
    ]
    event.demand_rows = rows
    event.demand_approved = True
    event.force_need = sum(int(row["need"]) for row in rows)
    # Заявка на силы — ОДНА на мероприятие, а не по группам: групп больше
    # никто не вводит. Число в ней то же, что штаб видит во входящих, и
    # расходиться с `force_need` оно не может — считается из тех же строк.
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

# Статус заявки департаменту. Правится раскладка только у тех, кого ещё не
# оповещали: у остальных внутри уже живут управления и выделенные люди.
_ALLOCATION_DRAFT = "DRAFT"


def force_demand_total(event):
    """Сколько всего людей делит штаб.

    Число берётся у запроса с рекогносцировки (`recon_force_request`) —
    именно оно приходит штабу и именно его он раскладывает. `force_need`
    (сумма утверждённой потребности) — другой факт и появляется позже;
    у мероприятий, доехавших до утверждения, он подставляется запасным, иначе
    раскладка старых строк упёрлась бы в ноль и не сохранилась бы вовсе.
    """
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


@transaction.atomic
def split_force_demand(event_id, *, rows):
    """Сохранить раскладку потребности по департаментам.

    Правится целиком списком, а не по строке: раскладка — одно решение штаба
    («кому сколько»), и построчное сохранение позволяло бы сумме уехать за
    потребность между двумя запросами.
    """
    event = lock_event(event_id)
    if event.stage not in _ALLOCATION_STAGES:
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
    for index, row in enumerate(rows):
        if not str(row.get("departmentId", "")).strip():
            field_errors[f"rows.{index}.departmentId"] = ["Выберите департамент."]
        try:
            need = int(row.get("need", 0))
        except (TypeError, ValueError):
            need = 0
        if need < 1:
            field_errors[f"rows.{index}.need"] = ["Должно быть не меньше 1."]
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

    total = force_demand_total(event)
    requested = sum(int(row.get("need", 0)) for row in rows)
    if total and requested > total:
        raise DomainError(
            "ALLOCATION_OVER_DEMAND",
            422,
            message=(
                f"Разложено {requested} человек при потребности {total} — "
                "уберите лишних."
            ),
        )

    previous = {
        str(item.get("departmentId")): item for item in (event.force_allocation or [])
    }
    # Департамент, которому уже сказали собирать людей, из раскладки молча не
    # исчезает: его управления оповещены, а люди, возможно, уже выделены.
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
                "comment": str(row.get("comment") or "").strip(),
                "notifiedAt": kept.get("notifiedAt"),
                "submittedAt": kept.get("submittedAt"),
                "decidedAt": kept.get("decidedAt"),
                "decisionComment": kept.get("decisionComment", ""),
                "directorates": kept.get("directorates", []),
                "members": kept.get("members", []),
            }
        )
    event.force_allocation = saved
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
    if event.stage not in _ALLOCATION_STAGES:
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
    rows = []
    for pk, name in directorates:
        key = str(pk)
        kept = known.get(key)
        rows.append(
            {
                "id": (kept or {}).get("id") or f"force-directorate-{key}",
                "divisionId": key,
                "name": name,
                # Уже оповещённому момент НЕ переписывается: повторное нажатие
                # добирает тех, кому не сказали, а не объявляет всех
                # оповещёнными заново — иначе «когда сказали» стало бы
                # временем последнего нажатия у всех сразу.
                "notifiedAt": (kept or {}).get("notifiedAt") or now,
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
        },
    )
    return event


# Статус привлечения на мероприятие. Код справочника, а не своя строка: расход
# дня и «Сбор сил» считают привлечённых именно по нему.
ASSIGNMENT_STATUS_CODE = "EVENT_ASSIGNMENT"


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


def day_status_map(employee_ids, on_date):
    """{id сотрудника: (код статуса, подпись)} на дату, ОДИН запрос.

    Предикат «какая строка действует на дату» берётся у расхода
    (`EmployeeStatusSelector`) — второй способ решить тот же вопрос разошёлся
    бы с ним молча. Отсутствие ключа значит «действующего статуса нет», что и
    есть «в строю»: строки «в строю» в справочнике не существует.
    """
    from organization_management.apps.operations.selectors import (
        EmployeeStatusSelector,
        StatusTypeSelector,
    )

    numeric = [int(key) for key in employee_ids if str(key).isdigit()]
    if not numeric:
        return {}
    names = StatusTypeSelector.names_map()
    return {
        str(row["employee_id"]): (
            row["status_type_code"],
            names.get(row["status_type_code"], row["status_type_code"]),
        )
        for row in EmployeeStatusSelector.overlapping_on(
            on_date, employee_ids=numeric
        )
    }


def force_roster_view(event):
    """Состав мероприятия со статусом дня (Plane №65, шаг «Р-2»).

    Состав — источник кандидатов расстановки с шага «СС-6», и подбор обязан
    показывать, свободен ли человек в день ОМ: предлагать занятого значит
    предлагать конфликт. Статус считается НА ЧТЕНИИ по той же причине, что и у
    назначения, — записанная копия соврала бы к утру.
    """
    rows = event.force_roster or []
    if not rows:
        return []
    statuses = day_status_map(
        {str(row.get("employeeId")) for row in rows}, event.business_date
    )
    view = []
    for row in rows:
        code, label = statuses.get(str(row.get("employeeId")), (None, None))
        view.append({**row, "statusCode": code, "statusLabel": label})
    return view


def placement_assignments_view(event):
    """Назначения на посты С ПОДРАЗДЕЛЕНИЕМ и статусом дня (Plane №65, «Р-1»).

    Оба факта считаются НА ЧТЕНИИ, а не хранятся в строке назначения: статус
    сотрудника меняется мимо мероприятия (отпуск оформили вечером), и копия,
    записанная в момент назначения, соврала бы уже к утру. Подразделение по
    той же причине: перевод человека не должен требовать правки чужих строк.

    Статус берётся тем же предикатом, что и расход дня
    (`EmployeeStatusSelector`), — второй способ решить «какая строка действует
    на дату» разошёлся бы с расходом молча. Дата — деловая дата мероприятия:
    расстановка отвечает на вопрос «кто будет в строю В ДЕНЬ ОМ», а не «кто в
    строю сейчас».

    `statusCode`/`statusLabel` = null означает «действующего статуса нет», что
    и есть «в строю»; подписывает это клиент, потому что «в строю» — не строка
    справочника, а его отсутствие.
    """
    from organization_management.apps.employees.models import Employee

    rows = event.placement_assignments or []
    if not rows:
        return []
    keys = {str(row.get("employeeId")) for row in rows}
    numeric = [int(key) for key in keys if key.isdigit()]
    employees = {
        str(employee.pk): employee
        for employee in Employee.objects.filter(pk__in=numeric).select_related(
            "staff_unit__division"
        )
    }
    statuses = day_status_map(keys, event.business_date)
    view = []
    for row in rows:
        key = str(row.get("employeeId"))
        employee = employees.get(key)
        _, division_name = (
            _employee_division(employee) if employee is not None else (None, "")
        )
        code, label = statuses.get(key, (None, None))
        view.append(
            {
                **row,
                "divisionName": division_name,
                "statusCode": code,
                "statusLabel": label,
                # Явный bool: строки, заведённые до появления старшего сектора,
                # ключа не несут вовсе, и клиенту незачем знать разницу между
                # «не старший» и «поля не было».
                "isSectorSenior": bool(row.get("isSectorSenior")),
            }
        )
    return view


@transaction.atomic
def add_allocation_member(
    event_id, allocation_id, *, employee_id, actor, override=False, override_reason=""
):
    """Управление выделяет человека на мероприятие (Plane №73, шаг «СС-3»).

    Выделение — не запись в списке, а СТАТУС: расход дня и счётчики «Сбора
    сил» считают привлечённых по `EVENT_ASSIGNMENT`, и человек, попавший в
    список без статуса, для всей остальной системы остался бы в строю.

    Поэтому же здесь работает обычный протокол статусов: пересечение с чужим
    статусом отдаёт свой отказ (жёсткое — 422, мягкое — 409 с обходом по
    причине). Своей проверки занятости раздел не заводит — вторая реализация
    правила разошлась бы с расходом.
    """
    from organization_management.apps.operations import status_service

    event = lock_event(event_id)
    if event.stage not in _ALLOCATION_STAGES:
        raise DomainError(
            "INVALID_STAGE_TRANSITION",
            422,
            message=(
                "Выделять людей можно после рекогносцировки и до согласования "
                "расстановки."
            ),
        )
    target = _find_allocation(event, allocation_id)
    employee = _find_personnel(employee_id)
    if employee is None:
        raise _validation({"employeeId": ["Сотрудник не найден."]})
    employee_key = str(employee.pk)
    for row in event.force_allocation:
        if any(m.get("employeeId") == employee_key for m in row.get("members", [])):
            raise DomainError(
                "DOUBLE_ASSIGNMENT",
                422,
                message=(
                    f"{personnel_display_name(employee)} уже выделен(а) на это "
                    f"мероприятие департаментом «{row.get('departmentName')}»."
                ),
            )

    division_id, division_name = _employee_division(employee)
    status = status_service.create_status(
        employee_id=employee.pk,
        status_type_code=ASSIGNMENT_STATUS_CODE,
        date_start=event.business_date,
        # Полуинтервал [начало, окончание): день мероприятия закрывается
        # следующим днём, иначе строка пуста и статуса нет ни одного дня.
        date_end=(event.business_date_end or event.business_date)
        + dt.timedelta(days=1),
        actor=actor,
        comment=f"Привлечение на мероприятие {event.code}",
        source_ref=f"security-event:{event.pk}",
        override=override,
        override_reason=override_reason,
    )
    member = {
        "employeeId": employee_key,
        "name": personnel_display_name(employee),
        "divisionId": division_id,
        "divisionName": division_name,
        "addedAt": _now_iso(),
        # Ссылка на статус — то, чем выделение снимается: без неё снятие
        # искало бы «похожий» статус и однажды закрыло бы чужой.
        "statusId": str(status.pk),
    }
    event.force_allocation = [
        {**row, "members": [*row.get("members", []), member]}
        if row.get("id") == allocation_id
        else row
        for row in event.force_allocation
    ]
    event.save(update_fields=["force_allocation", "updated_at"])
    return event


@transaction.atomic
def remove_allocation_member(event_id, allocation_id, employee_id, *, actor):
    """Снять выделенного человека — вместе с его статусом привлечения.

    Начавшееся привлечение НЕ снимается: статус, который уже идёт, — факт, и
    домен статусов отменяет только не начавшиеся строки (`cancel_status`).
    Раздел ОМ своего исключения из этого правила не заводит: «человека сегодня
    привлекли, а потом сделали вид, что не привлекали» — это переписывание
    расхода задним числом.
    """
    from organization_management.apps.operations import status_service
    from organization_management.apps.operations.models_status import (
        LifecycleState,
        OpsEmployeeStatus,
    )

    event = lock_event(event_id)
    target = _find_allocation(event, allocation_id)
    member = next(
        (
            m
            for m in target.get("members", [])
            if m.get("employeeId") == str(employee_id)
        ),
        None,
    )
    if member is None:
        raise _not_found("Выделенный сотрудник не найден в заявке.", employee_id)

    status = (
        OpsEmployeeStatus.objects.filter(pk=member.get("statusId")).first()
        if member.get("statusId")
        else None
    )
    if status is not None and status.state in (
        LifecycleState.ACTIVE,
        LifecycleState.COMPLETED,
    ):
        # И начавшееся, и уже закончившееся привлечение — случившийся факт;
        # отменяют только не начавшееся (см. cancel_status).
        raise DomainError(
            "ASSIGNMENT_ALREADY_STARTED",
            422,
            message=(
                f"{member.get('name')} уже привлечён(а) — снять можно только "
                "до начала мероприятия."
            ),
        )
    if status is not None and status.state == LifecycleState.PLANNED:
        status_service.cancel_status(
            status,
            actor=actor,
            reason=f"Снят(а) с выделения на мероприятие {event.code}",
        )

    event.force_allocation = [
        {
            **row,
            "members": [
                m
                for m in row.get("members", [])
                if m.get("employeeId") != str(employee_id)
            ],
        }
        if row.get("id") == allocation_id
        else row
        for row in event.force_allocation
    ]
    event.save(update_fields=["force_allocation", "updated_at"])
    return event


def _update_allocation(event, allocation_id, patch):
    """Заменить ОДНУ заявку в раскладке, не трогая соседние."""
    event.force_allocation = [
        {**row, **patch} if row.get("id") == allocation_id else row
        for row in event.force_allocation
    ]
    event.save(update_fields=["force_allocation", "updated_at"])
    return event


@transaction.atomic
def submit_allocation(event_id, allocation_id, *, actor):
    """Департамент отправляет окончательный список штабу (Plane №73, «СС-4»).

    Недобор отправить МОЖНО: решает штаб, а не форма. Он назван числом на
    экране и виден в самой заявке — запрет здесь означал бы, что департамент,
    не набравший людей, вообще ничего не может сообщить.
    """
    event = lock_event(event_id)
    if event.stage not in _ALLOCATION_STAGES:
        raise DomainError(
            "INVALID_STAGE_TRANSITION",
            422,
            message=(
                "Отправлять список можно после рекогносцировки и до согласования "
                "расстановки."
            ),
        )
    target = _find_allocation(event, allocation_id)
    if target.get("status") not in ("NOTIFIED", "RETURNED"):
        raise DomainError(
            "ALLOCATION_NOT_SUBMITTABLE",
            422,
            message=(
                "Отправить список может департамент, которому заявку уже "
                "передали и который её ещё не отправил."
            ),
        )
    if not target.get("members"):
        raise DomainError(
            "ALLOCATION_EMPTY",
            422,
            message="Никто не выделен — отправлять нечего.",
        )
    now = _now_iso()
    event = _update_allocation(
        event, allocation_id, {"status": "SUBMITTED", "submittedAt": now}
    )
    audit_service.record(
        actor=actor,
        action=audit_service.FORCE_ALLOCATION_SUBMITTED,
        entity_type=audit_service.ENTITY_SECURITY_EVENT,
        entity_id=event.pk,
        new_value={
            "code": event.code,
            "departmentId": target["departmentId"],
            "departmentName": target["departmentName"],
            "need": target["need"],
            "members": [m.get("name") for m in target.get("members", [])],
        },
    )
    return event


@transaction.atomic
def withdraw_allocation(event_id, allocation_id, *, actor):
    """Отозвать отправленный список — пока штаб не решил.

    Решённую заявку отзывать нечего: решение штаба — это уже его акт, и
    «отзыв» после него означал бы отмену чужого решения задним числом.
    """
    event = lock_event(event_id)
    target = _find_allocation(event, allocation_id)
    if target.get("status") != "SUBMITTED":
        raise DomainError(
            "ALLOCATION_NOT_WITHDRAWABLE",
            422,
            message="Отозвать можно только отправленный и ещё не решённый список.",
        )
    return _update_allocation(
        event, allocation_id, {"status": "NOTIFIED", "submittedAt": None}
    )


@transaction.atomic
def accept_allocation(event_id, allocation_id, *, actor):
    """Штаб принимает список и отдаёт людей мероприятию (Plane №73, «СС-5»).

    Принятые уезжают в СОСТАВ мероприятия (`force_roster`) — отдельный факт от
    расстановки: человек приходит в состав до постов и остаётся в нём, когда
    его снимают с поста.
    """
    event = lock_event(event_id)
    target = _find_allocation(event, allocation_id)
    if target.get("status") != "SUBMITTED":
        raise DomainError(
            "ALLOCATION_NOT_DECIDABLE",
            422,
            message="Решать можно только по отправленному списку.",
        )
    now = _now_iso()
    known = {str(row.get("employeeId")) for row in (event.force_roster or [])}
    incoming = [
        {
            "employeeId": str(member.get("employeeId")),
            "name": member.get("name", ""),
            "divisionId": member.get("divisionId"),
            "divisionName": member.get("divisionName", ""),
            "departmentId": target.get("departmentId"),
            "departmentName": target.get("departmentName", ""),
            "acceptedAt": now,
        }
        for member in target.get("members", [])
        # Повторная приёмка того же человека состав не удваивает: список
        # отзывают и отправляют заново, и второй проход тем же людям не
        # обязан плодить строки.
        if str(member.get("employeeId")) not in known
    ]
    event.force_roster = [*(event.force_roster or []), *incoming]
    event.force_allocation = [
        {**row, "status": "ACCEPTED", "decidedAt": now, "decisionComment": ""}
        if row.get("id") == allocation_id
        else row
        for row in event.force_allocation
    ]
    _sync_auto_force_request(event)
    event.save(
        update_fields=[
            "force_roster",
            "force_allocation",
            "force_requests",
            "updated_at",
        ]
    )
    audit_service.record(
        actor=actor,
        action=audit_service.FORCE_ALLOCATION_ACCEPTED,
        entity_type=audit_service.ENTITY_SECURITY_EVENT,
        entity_id=event.pk,
        new_value={
            "code": event.code,
            "departmentName": target.get("departmentName", ""),
            "accepted": [row["name"] for row in incoming],
        },
    )
    return event


@transaction.atomic
def return_allocation(event_id, allocation_id, *, reason, actor):
    """Вернуть список департаменту с ПРИЧИНОЙ.

    Причина обязательна: возврат без объяснения департамент читает как «сделай
    ещё раз то же самое», и следующий список приходит тем же.
    """
    event = lock_event(event_id)
    reason = str(reason or "").strip()
    if reason == "":
        raise _validation(
            {"reason": ["Обязательное поле."]},
            message="При возврате списка обязательна причина.",
        )
    target = _find_allocation(event, allocation_id)
    if target.get("status") != "SUBMITTED":
        raise DomainError(
            "ALLOCATION_NOT_DECIDABLE",
            422,
            message="Решать можно только по отправленному списку.",
        )
    now = _now_iso()
    event = _update_allocation(
        event,
        allocation_id,
        {
            "status": "RETURNED",
            "decidedAt": now,
            "decisionComment": reason,
            # Момент отправки снимается: список снова у департамента, и
            # «отправлено тогда-то» перестало быть правдой.
            "submittedAt": None,
        },
    )
    audit_service.record(
        actor=actor,
        action=audit_service.FORCE_ALLOCATION_RETURNED,
        entity_type=audit_service.ENTITY_SECURITY_EVENT,
        entity_id=event.pk,
        new_value={
            "code": event.code,
            "departmentName": target.get("departmentName", ""),
        },
        reason=reason,
    )
    return event


# ── Выделение сил ───────────────────────────────────────────────────────────


@transaction.atomic
def update_force_allocation(event_id, request_id, *, allocated_count, comment):
    event = lock_event(event_id)
    allocated = int(allocated_count)
    if allocated < 0:
        raise _validation({"allocatedCount": ["Не может быть отрицательным."]})
    target = next(
        (r for r in event.force_requests if r.get("id") == request_id), None
    )
    if target is None:
        raise _not_found("Запрос сил не найден.", request_id)
    def updated(r):
        if r.get("id") != request_id:
            return r
        status = (
            "SENT"
            if allocated == 0
            else "PARTIALLY_ALLOCATED"
            if allocated < int(r.get("requestedCount", 0))
            else "ALLOCATED"
        )
        return {
            **r,
            "allocatedCount": allocated,
            "status": status,
            "comment": str(comment or "").strip(),
        }
    event.force_requests = [updated(r) for r in event.force_requests]
    event.save(update_fields=["force_requests", "updated_at"])
    return event


@transaction.atomic
# `complete_forces` СНЯТА 26.08.2026 (Plane №149) — по тому же основанию, что
# и `approve_demand` выше: стадию «Запрос сил» проходит сервер, форм у неё нет,
# мероприятий на ней не осталось.


# ── Расстановка ─────────────────────────────────────────────────────────────


def _find_personnel(employee_id):
    from organization_management.apps.employees.models import Employee

    if not str(employee_id or "").isdigit():
        return None
    return Employee.objects.filter(pk=employee_id, is_active=True).first()


def personnel_display_name(employee):
    initial = f" {employee.first_name[0]}." if employee.first_name else ""
    return f"{employee.last_name}{initial}"


def actor_display_name(actor):
    """Подпись актора для ЭКРАНА: ФИО из живой кадровой записи, иначе username
    учётки, иначе сам идентификатор.

    `resolve_actor_id` отдаёт id учётной записи — он и должен уходить в аудит,
    но не в поля, которые читает человек: в реестре ОМ такой id оказывался и
    в «Ответственном», и в значениях фильтра по ответственному. Привязки
    `Employee.user` у части учёток нет (сид её не заполняет), поэтому
    username — не запасной вариант «на всякий случай», а штатный исход.
    """
    if actor is None:
        return ""
    from django.contrib.auth.models import User

    from organization_management.apps.employees.models import Employee

    actor = str(actor)
    user = User.objects.filter(pk=actor).first() if actor.isdigit() else None
    if user is None:
        return actor
    employee = Employee.objects.filter(user=user).first()
    if employee is not None:
        return personnel_display_name(employee)
    return user.username


@transaction.atomic
def assign_placement(
    event_id, *, post_id, employee_id, override, override_reason, deputy=None
):
    event = lock_event(event_id)
    employee = _find_personnel(employee_id)
    if employee is None:
        raise _validation({"employeeId": ["Сотрудник не найден."]})
    post = next(
        (p for p in event.recon_sector_posts if p.get("id") == post_id), None
    )
    if post is None:
        raise _not_found("Пост не найден.", post_id)
    employee_key = str(employee.pk)
    # Кандидаты — СОСТАВ мероприятия: расставляют тех, кого штаб отдал
    # (Plane №73, шаг «СС-6»). У мероприятий без состава (их вели прежним
    # путём, числами по группам) правило не включается — иначе новая цепочка
    # заперла бы им расстановку.
    if event.force_roster and all(
        str(member.get("employeeId")) != employee_key
        for member in event.force_roster
    ):
        raise DomainError(
            "NOT_IN_ROSTER",
            422,
            message=(
                f"{personnel_display_name(employee)} не в составе мероприятия — "
                "на посты ставят тех, кого штаб принял в «Сборе сил»."
            ),
        )
    # hard-правило: сотрудник не может занимать два поста одного ОМ
    if any(
        a.get("employeeId") == employee_key and a.get("postId") != post_id
        for a in event.placement_assignments
    ):
        raise DomainError("DOUBLE_ASSIGNMENT", 422, message=
            f"{personnel_display_name(employee)} уже назначен(а) на другой "
            "пост этого мероприятия.",
        )
    # мягкое предупреждение по требованию рейтинга — ПОСЛЕ жёстких правил:
    # обходить обоснованием можно только назначение, которое иначе состоялось
    # бы. Данных рейтинга у бэка нет — предупреждение «данных нет», не
    # молчаливое «соответствует».
    reason = str(override_reason or "").strip() if override is True else ""
    rating_conflict = None
    if post.get("minRating") is not None:
        rating_conflict = "Данных рейтинга для проверки требования поста нет."
        if reason == "":
            raise DomainError(
                "SOFT_CONFLICT_DETECTED",
                409,
                detail={
                    "conflicts": [
                        {
                            "conflict_code": "RATING_DATA_MISSING",
                            "severity": "WARNING",
                            "employee_id": employee_key,
                            "message": rating_conflict,
                        }
                    ]
                },
                overridable=True,
                message=rating_conflict,
            )
    assignment = {
        "id": f"assignment-{len(event.placement_assignments) + 1}-{_now_iso()}",
        "postId": post_id,
        "employeeId": employee_key,
        "employeeName": personnel_display_name(employee),
        "acknowledgedAt": None,
        # обоснование сохраняется только при реально возникшем предупреждении
        "ratingOverrideReason": None if rating_conflict is None else reason,
    }
    event.placement_assignments = [*event.placement_assignments, assignment]
    event.save(update_fields=["placement_assignments", "updated_at"])
    _record_deputy_placement(
        event,
        deputy,
        {
            "operation": "ASSIGN",
            "postId": str(post_id),
            "employeeId": employee_key,
        },
    )
    return event


@transaction.atomic
def unassign_placement(event_id, assignment_id, *, deputy=None):
    event = lock_event(event_id)
    event.placement_assignments = [
        a for a in event.placement_assignments if a.get("id") != assignment_id
    ]
    event.save(update_fields=["placement_assignments", "updated_at"])
    _record_deputy_placement(
        event, deputy, {"operation": "UNASSIGN", "assignmentId": str(assignment_id)}
    )
    return event


def _post_of_assignment(event, assignment):
    """Пост назначения или None: сектор человека известен только через пост."""
    for post in event.recon_sector_posts or []:
        if str(post.get("id")) == str(assignment.get("postId")):
            return post
    return None


@transaction.atomic
def set_sector_senior(event_id, assignment_id, *, senior, actor):
    """Старший сектора на расстановке (Plane №65, шаг «Р-4»).

    Старший — ОДИН на сектор: назначение снимает признак у остальных
    назначений того же сектора. Двое старших означали бы, что доклад с сектора
    спрашивать не с кого конкретно, — а ради этого признак и заводится.

    Сектор берётся у ПОСТА назначения: своего поля сектора у назначения нет и
    быть не должно — пост уже знает свой сектор, и вторая копия разошлась бы
    с ним при переносе поста.
    """
    event = lock_event(event_id)
    target = next(
        (a for a in event.placement_assignments if a.get("id") == assignment_id),
        None,
    )
    if target is None:
        raise _not_found("Назначение не найдено.", assignment_id)
    post = _post_of_assignment(event, target)
    if post is None:
        raise DomainError(
            "POST_NOT_FOUND",
            422,
            message="Пост назначения не найден — сектор определить нечем.",
        )
    sector = str(post.get("sector") or "")
    previous = next(
        (
            a
            for a in event.placement_assignments
            if bool(a.get("isSectorSenior"))
            and str((_post_of_assignment(event, a) or {}).get("sector") or "")
            == sector
        ),
        None,
    )
    rows = []
    for row in event.placement_assignments:
        if row.get("id") == assignment_id:
            rows.append({**row, "isSectorSenior": bool(senior)})
            continue
        same_sector = (
            str((_post_of_assignment(event, row) or {}).get("sector") or "") == sector
        )
        rows.append({**row, "isSectorSenior": False} if same_sector else row)
    event.placement_assignments = rows
    event.save(update_fields=["placement_assignments", "updated_at"])
    audit_service.record(
        actor=actor,
        action=audit_service.PLACEMENT_SECTOR_SENIOR_SET,
        entity_type=audit_service.ENTITY_SECURITY_EVENT,
        entity_id=event.pk,
        old_value=(
            None
            if previous is None
            else {
                "employeeId": str(previous.get("employeeId")),
                "employeeName": previous.get("employeeName"),
            }
        ),
        new_value={
            "code": event.code,
            "sector": sector,
            "employeeId": str(target.get("employeeId")) if senior else None,
            "employeeName": target.get("employeeName") if senior else None,
        },
    )
    event.refresh_from_db()
    return event


@transaction.atomic
def complete_placement(event_id):
    event = lock_event(event_id)
    _require_stage(
        event,
        "PLACEMENT",
        "Расстановку можно завершить только на этапе «Расстановка».",
    )
    assigned = {a.get("postId") for a in event.placement_assignments}
    unstaffed = [
        p for p in event.recon_sector_posts if p.get("id") not in assigned
    ]
    if not event.recon_sector_posts or unstaffed:
        raise DomainError("PLACEMENT_INCOMPLETE", 422, message= "Не все посты укомплектованы.")
    return _advance(event, "APPROVAL")


# ── Согласование ────────────────────────────────────────────────────────────


def _next_approver_number(route):
    numbers = []
    for item in route:
        raw = str(item.get("id", "")).rsplit("-", 1)[-1]
        if raw.isdigit():
            numbers.append(int(raw))
    return (max(numbers) + 1) if numbers else 1


@transaction.atomic
def add_approver(event_id, *, name, unit, position):
    """Добавляет согласующего в конец маршрута.

    Порядок — позиция в списке: у согласования он значим (кто первый), и
    отдельного поля под номер не нужно, иначе появятся два источника правды.
    """
    event = lock_event(event_id)
    clean_name = str(name or "").strip()
    if clean_name == "":
        raise _validation({"name": ["Обязательное поле."]})
    route = list(event.approval_route or [])
    route.append(
        {
            # Идентификатор едет в URL, поэтому без времени и двоеточий:
            # следующий номер за максимальным, а не длина списка — удаление
            # середины иначе дало бы повтор.
            "id": f"approver-{_next_approver_number(route)}",
            "name": clean_name,
            "unit": str(unit or "").strip(),
            "position": str(position or "").strip(),
            # «Не отправлено» — начальное состояние эталона: согласующего
            # вносят в маршрут заранее, а решать он начинает только после
            # ОТПРАВКИ. До неё «ожидает решения» было бы неправдой: ему ещё
            # ничего не присылали.
            "status": "NOT_SENT",
            "decidedAt": None,
            "comment": "",
        }
    )
    event.approval_route = route
    event.save(update_fields=["approval_route", "updated_at"])
    return event


@transaction.atomic
def remove_approver(event_id, approver_id):
    event = lock_event(event_id)
    route = [a for a in (event.approval_route or []) if a.get("id") != approver_id]
    if len(route) == len(event.approval_route or []):
        raise _not_found("Согласующий не найден.", approver_id)
    event.approval_route = route
    event.save(update_fields=["approval_route", "updated_at"])
    return event


@transaction.atomic
def decide_approver(event_id, *, approver_id, decision, comment):
    """Решение одного согласующего. Возврат требует причины — как и возврат
    расстановки: «вернул без объяснения» неисполнимо для исполнителя."""
    event = lock_event(event_id)
    if decision not in ("APPROVED", "RETURNED"):
        raise _validation({"decision": ["Допустимо APPROVED или RETURNED."]})
    clean_comment = str(comment or "").strip()
    if decision == "RETURNED" and clean_comment == "":
        raise _validation({"comment": ["Укажите причину возврата."]})
    route = list(event.approval_route or [])
    target = next(
        (item for item in route if item.get("id") == approver_id), None
    )
    if target is None:
        raise _not_found("Согласующий не найден.", approver_id)
    # Решает только тот, кому ОТПРАВИЛИ. Решение по неотправленному маршруту —
    # подпись под составом, которого согласующий не видел (эталон: кнопки
    # решения появляются лишь у статуса «На согласовании»).
    if target.get("status") == "NOT_SENT":
        raise DomainError("APPROVAL_NOT_SENT", 422, message=
            "Расстановка не отправлена на согласование — решать нечего.",
        )
    now = _now_iso()
    target["status"] = decision
    target["decidedAt"] = now
    # При согласовании комментарий не спрашивают: эталон проставляет «Без
    # замечаний» сам, и пустая графа читалась бы как «забыли написать».
    target["comment"] = clean_comment if decision == "RETURNED" else "Без замечаний"
    event.approval_route = route
    fields = ["approval_route", "updated_at"]
    if decision == "RETURNED":
        # Возврат порождает ЗАМЕЧАНИЕ: решение согласующего живёт в его
        # строке, а работа по нему — в списке, который закрывают по одному.
        remarks = list(event.approval_remarks or [])
        remarks.append(
            {
                "id": f"remark-{len(remarks) + 1}-{approver_id}",
                "approverId": approver_id,
                "author": target.get("name", ""),
                "createdAt": now,
                "text": clean_comment,
                "resolved": False,
                "resolvedAt": None,
            }
        )
        event.approval_remarks = remarks
        fields.insert(1, "approval_remarks")
    event.save(update_fields=fields)
    return event


def placement_signature(event):
    """Подпись расстановки: что именно согласуют.

    Сортированная, потому что порядок назначений в списке — деталь хранения, а
    не факт о расстановке: перестановка тех же людей по тем же постам не
    является изменением, и «расстановка изменилась» на неё было бы ложной
    тревогой. В подпись входят пост и человек — ровно то, что подписывают.
    """
    pairs = sorted(
        f"{item.get('postId')}:{item.get('employeeId')}"
        for item in (event.placement_assignments or [])
    )
    return ";".join(pairs)


def approval_is_stale(event):
    """Расстановка изменилась ПОСЛЕ отправки на согласование.

    Пустой снимок — «не отправляли», а не «не изменилась»: до отправки
    сравнивать не с чем, и баннер о повторном согласовании там был бы шумом.
    """
    if event.approval_snapshot == "":
        return False
    return event.approval_snapshot != placement_signature(event)


@transaction.atomic
def send_for_approval(event_id):
    """Отправить расстановку согласующим.

    До отправки маршрут — это список людей, а не процесс: решать им нечего.
    Отправка фиксирует СНИМОК расстановки — тот состав, под которым они
    подпишутся.
    """
    event = lock_event(event_id)
    _require_stage(
        event,
        "APPROVAL",
        "Отправить на согласование можно только на этапе «Согласование».",
    )
    route = list(event.approval_route or [])
    if not route:
        raise DomainError("APPROVAL_ROUTE_EMPTY", 422, message=
            "Маршрут согласования пуст — добавьте хотя бы одного согласующего.",
        )
    if not event.placement_assignments:
        raise DomainError("PLACEMENT_EMPTY", 422, message=
            "Расстановка пуста — согласовывать нечего.",
        )
    for item in route:
        # Прежнее состояние читается ДО присвоения: причина возврата не
        # стирается (она объясняет, что чинили, и нужна тому же согласующему
        # при повторном решении), а «без замечаний» от прошлого согласования
        # к новому составу отношения не имеет.
        was_returned = item.get("status") == "RETURNED"
        item["status"] = "PENDING"
        item["decidedAt"] = None
        if not was_returned:
            item["comment"] = ""
    event.approval_route = route
    event.approval_snapshot = placement_signature(event)
    event.save(
        update_fields=["approval_route", "approval_snapshot", "updated_at"]
    )
    return event


@transaction.atomic
def withdraw_from_approval(event_id):
    """Отозвать с согласования.

    Уже принятые решения не отменяются: согласовавший согласовал, вернувший
    вернул — стирать чужое решение отзывом значило бы переписывать историю.
    Снимок тоже остаётся: отзыв не меняет расстановку.
    """
    event = lock_event(event_id)
    _require_stage(
        event,
        "APPROVAL",
        "Отозвать с согласования можно только на этапе «Согласование».",
    )
    route = list(event.approval_route or [])
    for item in route:
        if item.get("status") == "PENDING":
            item["status"] = "NOT_SENT"
    event.approval_route = route
    event.save(update_fields=["approval_route", "updated_at"])
    return event


@transaction.atomic
def move_approver(event_id, approver_id, *, direction):
    """Переставить согласующего в маршруте на позицию вверх или вниз."""
    event = lock_event(event_id)
    if direction not in ("UP", "DOWN"):
        raise _validation({"direction": ["Допустимо UP или DOWN."]})
    route = list(event.approval_route or [])
    index = next(
        (i for i, item in enumerate(route) if item.get("id") == approver_id), None
    )
    if index is None:
        raise _not_found("Согласующий не найден.", approver_id)
    target = index - 1 if direction == "UP" else index + 1
    # Край списка — не ошибка, а «дальше некуда»: отказ здесь заставлял бы
    # клиента считать границы, которые сервер и так знает.
    if 0 <= target < len(route):
        route[index], route[target] = route[target], route[index]
        event.approval_route = route
        event.save(update_fields=["approval_route", "updated_at"])
    return event


@transaction.atomic
def resolve_remark(event_id, remark_id, *, resolved):
    """Отметить замечание устранённым (или вернуть его в работу)."""
    event = lock_event(event_id)
    remarks = list(event.approval_remarks or [])
    found = False
    for item in remarks:
        if item.get("id") == remark_id:
            item["resolved"] = bool(resolved)
            item["resolvedAt"] = _now_iso() if resolved else None
            found = True
            break
    if not found:
        raise _not_found("Замечание не найдено.", remark_id)
    event.approval_remarks = remarks
    event.save(update_fields=["approval_remarks", "updated_at"])
    return event


@transaction.atomic
def approve_placement(event_id):
    event = lock_event(event_id)
    _require_stage(
        event,
        "APPROVAL",
        "Согласовать расстановку можно только на этапе «Согласование».",
    )
    # Условия завершения этапа — из эталона (задача заказчика «ОМ-37.3»).
    # Каждое отвечает на свой вопрос, поэтому и текст у каждого свой: «не
    # получилось» без причины не подсказывает, что чинить.
    route = list(event.approval_route or [])
    if not route:
        raise DomainError("APPROVAL_ROUTE_EMPTY", 422, message=
            "Маршрут согласования пуст — добавьте согласующих и отправьте им "
            "расстановку.",
        )
    if approval_is_stale(event):
        raise DomainError("APPROVAL_STALE", 422, message=
            "Расстановка изменилась после отправки — отправьте её на "
            "повторное согласование.",
        )
    if any(item.get("status") == "RETURNED" for item in route):
        raise DomainError("APPROVAL_RETURNED", 422, message=
            "Есть возврат на доработку — устраните замечания и отправьте "
            "расстановку повторно.",
        )
    if any(item.get("status") != "APPROVED" for item in route):
        # Два разных состояния и два разных ответа: «ещё не решили» и «даже не
        # отправляли» чинятся по-разному.
        pending = any(item.get("status") == "PENDING" for item in route)
        raise DomainError("APPROVAL_INCOMPLETE", 422, message=
            "Не все согласующие приняли решение."
            if pending
            else "Расстановка не отправлена на согласование.",
        )
    if any(not item.get("resolved") for item in (event.approval_remarks or [])):
        raise DomainError("APPROVAL_REMARKS_OPEN", 422, message=
            "Есть неустранённые замечания — закройте их перед завершением "
            "этапа.",
        )
    # утверждение сразу открывает «Ознакомление», без отдельного клика
    event.approval_status = "APPROVED"
    event.approval_comment = ""
    event.stage = "ACKNOWLEDGEMENT"
    event.readiness_percent = STAGE_READINESS["ACKNOWLEDGEMENT"]
    event.save(
        update_fields=[
            "approval_status",
            "approval_comment",
            "stage",
            "readiness_percent",
            "updated_at",
        ]
    )
    record_transition(event, "APPROVAL", "ACKNOWLEDGEMENT")
    return event


@transaction.atomic
def return_placement(event_id, *, comment):
    event = lock_event(event_id)
    comment = str(comment or "").strip()
    if comment == "":
        raise _validation({"comment": ["Укажите причину возврата."]})
    _require_stage(
        event,
        "APPROVAL",
        "Вернуть на доработку можно только на этапе «Согласование».",
    )
    event.approval_status = "RETURNED"
    event.approval_comment = comment
    event.stage = "PLACEMENT"
    event.readiness_percent = STAGE_READINESS["PLACEMENT"]
    event.save(
        update_fields=[
            "approval_status",
            "approval_comment",
            "stage",
            "readiness_percent",
            "updated_at",
        ]
    )
    record_transition(event, "APPROVAL", "PLACEMENT")
    return event


# ── Ознакомление ────────────────────────────────────────────────────────────


@transaction.atomic
def acknowledge_assignment(event_id, assignment_id):
    event = lock_event(event_id)
    if not any(
        a.get("id") == assignment_id for a in event.placement_assignments
    ):
        raise _not_found("Назначение не найдено.", assignment_id)
    now = _now_iso()
    event.placement_assignments = [
        {**a, "acknowledgedAt": now} if a.get("id") == assignment_id else a
        for a in event.placement_assignments
    ]
    event.save(update_fields=["placement_assignments", "updated_at"])
    return event


@transaction.atomic
def complete_acknowledgement(event_id):
    event = lock_event(event_id)
    _require_stage(
        event,
        "ACKNOWLEDGEMENT",
        "Ознакомление можно завершить только на этапе «Ознакомление».",
    )
    if not all(
        a.get("acknowledgedAt") is not None for a in event.placement_assignments
    ):
        raise DomainError("ACKNOWLEDGEMENT_INCOMPLETE", 422, message=
            "Не все назначенные сотрудники подтвердили ознакомление.",
        )
    return _advance(event, "CONDUCT")


# ── Проведение ──────────────────────────────────────────────────────────────


@transaction.atomic
def add_journal_entry(event_id, *, entry_type, title, description):
    event = lock_event(event_id)
    title = str(title or "").strip()
    if title == "":
        raise _validation({"title": ["Обязательное поле."]})
    _require_stage(
        event, "CONDUCT", "Журнал штаба доступен только на этапе «Проведение»."
    )
    entry = {
        "id": f"journal-{len(event.journal_entries) + 1}-{_now_iso()}",
        "type": entry_type,
        "title": title,
        "description": str(description or "").strip(),
        "createdAt": _now_iso(),
    }
    event.journal_entries = [entry, *event.journal_entries]
    event.save(update_fields=["journal_entries", "updated_at"])
    return event


@transaction.atomic
def replace_assignment(event_id, *, assignment_id, incoming_employee_id, reason_code):
    event = lock_event(event_id)
    reason = str(reason_code or "").strip()
    if reason == "":
        raise _validation({"reasonCode": ["Обязательное поле."]})
    incoming = _find_personnel(incoming_employee_id)
    if incoming is None:
        raise _validation({"incomingEmployeeId": ["Сотрудник не найден."]})
    _require_stage(event, "CONDUCT", "Замена доступна только на этапе «Проведение».")
    outgoing = next(
        (a for a in event.placement_assignments if a.get("id") == assignment_id),
        None,
    )
    if outgoing is None:
        raise _not_found("Назначение не найдено.", assignment_id)
    incoming_key = str(incoming.pk)
    if any(
        a.get("employeeId") == incoming_key
        and a.get("postId") != outgoing.get("postId")
        for a in event.placement_assignments
    ):
        raise DomainError("DOUBLE_ASSIGNMENT", 422, message=
            f"{personnel_display_name(incoming)} уже назначен(а) на другой "
            "пост этого мероприятия.",
        )
    post = next(
        (
            p
            for p in event.recon_sector_posts
            if p.get("id") == outgoing.get("postId")
        ),
        None,
    )
    incoming_assignment = {
        "id": f"assignment-{len(event.placement_assignments) + 1}-{_now_iso()}",
        "postId": outgoing.get("postId"),
        "employeeId": incoming_key,
        "employeeName": personnel_display_name(incoming),
        "acknowledgedAt": None,
        # замена в ходе проведения — не расстановка: обхода не было
        "ratingOverrideReason": None,
    }
    journal_entry = {
        "id": f"journal-{len(event.journal_entries) + 1}-{_now_iso()}",
        "type": "REPLACEMENT",
        "title": f"Замена: {(post or {}).get('post', outgoing.get('postId'))}",
        "description": (
            f"{outgoing.get('employeeName')} → "
            f"{personnel_display_name(incoming)} — причина: {reason}"
        ),
        "createdAt": _now_iso(),
    }
    event.placement_assignments = [
        *(a for a in event.placement_assignments if a.get("id") != assignment_id),
        incoming_assignment,
    ]
    event.journal_entries = [journal_entry, *event.journal_entries]
    event.save(
        update_fields=["placement_assignments", "journal_entries", "updated_at"]
    )
    return event


# ── Закрытие ────────────────────────────────────────────────────────────────


# Стадии, на которые администратор переводит ОМ вручную — ВХОДНЫЕ стадии пяти
# шагов цепочки, а не все девять: шаг «Закрытие» начинается с «Проведения», и
# предлагать середину шага значило бы показывать в интерфейсе стадии, которых
# цепочка не называет.
#
# Вход шага «Расстановка» — `PLACEMENT`, а не `DEMAND` (Plane №110). Стадии
# «Потребность» и «Запрос сил» человек больше не ведёт: форм у них нет, и
# перевод ОМ на них запирал бы мероприятие навсегда — двигать его дальше было
# бы нечем.
#
# CLOSED в списке НЕТ намеренно. Закрытие несёт итоги направлений и время
# закрытия; «перевести сюда» без них завело бы архив, которого не было, — а
# закрытое ОМ читают отчёты и выгрузки. Закрывают через close_event, по итогам.
STAGE_OVERRIDE_TARGETS = [
    "BULLETIN", "RECON", "PLACEMENT", "APPROVAL", "ACKNOWLEDGEMENT", "CONDUCT",
]


@transaction.atomic
def override_stage(event_id, *, stage, actor):
    """Перевод ОМ на выбранный этап в обход условий — админ-полномочие.

    Обычная цепочка проверяет готовность каждого этапа (`_require_stage` и
    проверки полноты), и это правильно для того, кто ведёт мероприятие.
    Администратору нужен другой инструмент: пройти карточку целиком, посмотреть
    любой этап и вернуть ОМ назад — на разборе, демонстрации и при исправлении
    чужой ошибки. Поэтому обход НЕ ослабляет гварды этапов, а стоит рядом с
    ними отдельной операцией под отдельным правом.

    След остаётся двойной: переход в журнале переходов (FORWARD/RETURN считает
    `record_transition`) и запись в журнале мутаций — обход условий это решение
    человека, и по нему разбираются поимённо.
    """
    event = lock_event(event_id)
    if stage not in STAGE_OVERRIDE_TARGETS:
        raise _validation(
            {"stage": ["Недопустимый этап для перевода."]},
            message="На этот этап перевести нельзя.",
        )
    old_stage = event.stage
    # Идемпотентность: перевод на текущий этап — не ошибка, а «уже там».
    # Иначе повтор запроса (двойной клик, ретрай сети) писал бы в журнал
    # переход из этапа в него же.
    if old_stage == stage:
        return event
    event.stage = stage
    event.readiness_percent = STAGE_READINESS[stage]
    fields = ["stage", "readiness_percent", "updated_at"]
    # Выход из закрытия снимает время закрытия: живое мероприятие со штампом
    # «закрыто в …» врало бы и в карточке, и в выгрузках. Итоги направлений
    # при этом ОСТАЮТСЯ — это собранный факт, а не следствие стадии.
    if old_stage == "CLOSED":
        event.closed_at = None
        fields.append("closed_at")
    event.save(update_fields=fields)
    record_transition(event, old_stage, stage)
    audit_service.record(
        actor=actor,
        action=audit_service.SECURITY_EVENT_STAGE_OVERRIDDEN,
        entity_type=audit_service.ENTITY_SECURITY_EVENT,
        entity_id=event.pk,
        old_value={"stage": old_stage},
        new_value={"stage": stage, "code": event.code},
    )
    return event


@transaction.atomic
def close_event(event_id, *, direction_summaries, actor):
    event = lock_event(event_id)
    summaries = direction_summaries or []
    field_errors = {}
    for index, item in enumerate(summaries):
        if not str(item.get("summary", "")).strip():
            field_errors[f"directionSummaries.{index}.summary"] = [
                "Обязательное поле."
            ]
    if field_errors:
        raise _validation(field_errors)
    _require_stage(event, "CONDUCT", "Закрыть ОМ можно только на этапе «Проведение».")
    # итоги ВСЕХ направлений обязательны — не частичное закрытие
    directions = {p.get("sector") for p in event.recon_sector_posts}
    covered = {item.get("direction") for item in summaries}
    missing = sorted(d for d in directions if d not in covered)
    if missing:
        raise DomainError("CLOSURE_DIRECTIONS_INCOMPLETE", 422, message=
            f"Не хватает итогов направлений: {', '.join(missing)}.",
        )
    old_stage = event.stage
    event.stage = "CLOSED"
    event.readiness_percent = STAGE_READINESS["CLOSED"]
    event.closure_direction_summaries = [
        {
            "direction": item.get("direction"),
            "summary": str(item.get("summary", "")).strip(),
        }
        for item in summaries
    ]
    event.closed_at = Clock.now()
    event.save(
        update_fields=[
            "stage",
            "readiness_percent",
            "closure_direction_summaries",
            "closed_at",
            "updated_at",
        ]
    )
    record_transition(event, old_stage, "CLOSED")
    # Оценивание заводится ЗАКРЫТИЕМ (задача заказчика Plane №96: «оценивание
    # на каждом ОМ»). Импорт локальный: модуль рейтинга читает мероприятия ОМ,
    # и импорт на уровне модуля замкнул бы их друг на друга.
    from organization_management.apps.ops import ratings as ratings_service
    ratings_service.open_evaluation_for_event(event, actor=actor)
    audit_service.record(
        actor=actor,
        action=audit_service.SECURITY_EVENT_CLOSED,
        entity_type=audit_service.ENTITY_SECURITY_EVENT,
        entity_id=event.pk,
        old_value={"stage": old_stage},
        new_value={"stage": "CLOSED", "code": event.code},
    )
    return event
