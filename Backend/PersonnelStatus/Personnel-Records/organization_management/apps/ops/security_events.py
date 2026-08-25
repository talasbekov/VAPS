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
    event.recon_sector_posts = [
        {
            **row,
            "sector": str(row.get("sector", "")).strip(),
            "post": str(row.get("post", "")).strip(),
            "task": str(row.get("task", "")).strip(),
            "requirements": str(row.get("requirements", "")).strip(),
            "comment": str(row.get("comment", "")).strip(),
        }
        for row in sector_posts
    ]
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
    now = _now_iso()
    added = []
    counter = 0
    for sector in version.sectors_snapshot:
        for post in sector.get("posts", []):
            if post.get("id") in already_imported:
                continue
            counter += 1
            added.append(
                {
                    "id": f"imported-{now}-{counter}",
                    "sector": sector.get("name", ""),
                    "post": post.get("name", ""),
                    "task": post.get("task", ""),
                    # паспорт описывает пост, а не численность на мероприятие:
                    # 1 — минимально допустимое, уточняет старший наряда
                    "need": 1,
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
    # Запрос личного состава — ИТОГ рекогносцировки, а не приложение к ней:
    # завершение этапа адресует его штабу 2-го департамента, и завершать
    # рекогносцировку без числа значило бы отправлять штабу пустой запрос
    # (Plane «Реестр ОМ-23», эталонный блок «Итог рекогносцировки»).
    if event.recon_force_request < 1:
        raise DomainError("RECON_FORCE_REQUEST_EMPTY", 422, message=
            "Укажите требуемое число сотрудников: завершение рекогносцировки "
            "направляет запрос штабу 2-го департамента.",
        )
    # Момент отправки запроса штабу. Проставляется ЗДЕСЬ, а не при правке
    # числа: до завершения этапа число — черновик старшего наряда, штаб его
    # не видит, и лента «что пришло нового» считала бы черновики.
    event.recon_force_requested_at = Clock.now()
    event.save(update_fields=["recon_force_requested_at", "updated_at"])
    return _advance(event, "DEMAND")


# ── Потребность ─────────────────────────────────────────────────────────────


@transaction.atomic
def approve_demand(event_id, *, rows):
    event = lock_event(event_id)
    rows = rows or []
    field_errors = {}
    for index, row in enumerate(rows):
        if not str(row.get("sector", "")).strip():
            field_errors[f"rows.{index}.sector"] = ["Обязательное поле."]
        if not str(row.get("task", "")).strip():
            field_errors[f"rows.{index}.task"] = ["Обязательное поле."]
        if not str(row.get("group", "")).strip():
            field_errors[f"rows.{index}.group"] = ["Выберите группу."]
        if int(row.get("need", 0)) < 1:
            field_errors[f"rows.{index}.need"] = ["Должно быть не меньше 1."]
    if field_errors:
        raise _validation(field_errors)
    if not rows:
        raise DomainError("DEMAND_ROWS_EMPTY", 422, message= "Добавьте хотя бы одну строку потребности.")
    _require_stage(
        event, "DEMAND", "Потребность можно утвердить только на этапе «Потребность»."
    )
    cleaned = [
        {
            **row,
            "sector": str(row.get("sector", "")).strip(),
            "task": str(row.get("task", "")).strip(),
            "shift": str(row.get("shift", "")).strip(),
            "group": str(row.get("group", "")).strip(),
            "requirements": str(row.get("requirements", "")).strip(),
            "comment": str(row.get("comment", "")).strip(),
        }
        for row in rows
    ]
    by_group = {}
    for row in cleaned:
        by_group[row["group"]] = by_group.get(row["group"], 0) + int(row["need"])
    event.demand_rows = cleaned
    event.demand_approved = True
    event.force_requests = [
        {
            "id": f"force-request-{index}-{group}",
            "group": group,
            "requestedCount": requested,
            "allocatedCount": 0,
            "status": "NOT_SENT",
            "comment": "",
        }
        for index, (group, requested) in enumerate(by_group.items())
    ]
    event.force_need = sum(int(row["need"]) for row in cleaned)
    _forces_from_stage = event.stage
    event.stage = "FORCES"
    event.readiness_percent = STAGE_READINESS["FORCES"]
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
    record_transition(event, _forces_from_stage, "FORCES")
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
def complete_forces(event_id):
    event = lock_event(event_id)
    _require_stage(
        event,
        "FORCES",
        "Выделение сил можно завершить только на этапе «Запрос сил».",
    )
    requests = event.force_requests
    if not requests or not all(
        int(r.get("allocatedCount", 0)) >= int(r.get("requestedCount", 0))
        for r in requests
    ):
        raise DomainError("FORCE_ALLOCATION_INCOMPLETE", 422, message= "Не все запросы полностью выделены."
        )
    return _advance(event, "PLACEMENT")


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
            "status": "PENDING",
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
    found = False
    for item in route:
        if item.get("id") == approver_id:
            item["status"] = decision
            item["decidedAt"] = _now_iso()
            item["comment"] = clean_comment
            found = True
            break
    if not found:
        raise _not_found("Согласующий не найден.", approver_id)
    event.approval_route = route
    event.save(update_fields=["approval_route", "updated_at"])
    return event


@transaction.atomic
def approve_placement(event_id):
    event = lock_event(event_id)
    _require_stage(
        event,
        "APPROVAL",
        "Согласовать расстановку можно только на этапе «Согласование».",
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
# шагов цепочки, а не все девять: шаг «Расстановка» начинается с «Потребности»,
# шаг «Закрытие» — с «Проведения», и предлагать середину шага значило бы
# показывать в интерфейсе стадии, которых цепочка не называет.
#
# CLOSED в списке НЕТ намеренно. Закрытие несёт итоги направлений и время
# закрытия; «перевести сюда» без них завело бы архив, которого не было, — а
# закрытое ОМ читают отчёты и выгрузки. Закрывают через close_event, по итогам.
STAGE_OVERRIDE_TARGETS = [
    "BULLETIN", "RECON", "DEMAND", "APPROVAL", "ACKNOWLEDGEMENT", "CONDUCT",
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
    audit_service.record(
        actor=actor,
        action=audit_service.SECURITY_EVENT_CLOSED,
        entity_type=audit_service.ENTITY_SECURITY_EVENT,
        entity_id=event.pk,
        old_value={"stage": old_stage},
        new_value={"stage": "CLOSED", "code": event.code},
    )
    return event
