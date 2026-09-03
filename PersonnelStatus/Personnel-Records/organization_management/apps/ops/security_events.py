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
    protected_person_ids=None,
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
    # Связь заполняется ПОСЛЕ создания: у M2M нет иного способа: строки
    # `OpsSecurityEvent` до сохранения ещё не существует.
    if persons:
        event.protected_persons.set(persons)
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

    if location is not None:
        new_location = str(location).strip()
        if len(new_location) > 255:
            field_errors["location"] = ["Не длиннее 255 символов."]
        else:
            event.location = new_location
            updates.append("location")

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

    if not updates and new_persons is None:
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
        # ОБЪЕКТ ВСТУПАЕТ В МЕРОПРИЯТИЕ ТАМ, ГДЕ ОНО СЕЙЧАС (Plane №412).
        # Стадия по умолчанию («Бюллетень») откатывала бы ВСЁ мероприятие
        # назад при каждом добавленном объекте: стадия мероприятия —
        # наименьшая среди объектов, и новичок на бюллетене утянул бы за
        # собой согласованные. Такого решения никто не принимал, а работу по
        # новому объекту открывает обход этапов (`event.stage_override`).
        stage=event.stage,
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


def recompute_event_stage(event):
    """Свести стадию, готовность и потребность мероприятия по его объектам.

    Стадия — НАИМЕНЬШАЯ среди объектов: мероприятие прошло этап тогда, когда
    его прошёл последний объект. Взять наибольшую значило бы объявить готовым
    ОМ, у которого половина мест ещё не расписана.

    Потребность — СУММА потребностей объектов: людей просят на все места
    сразу, и штаб делит одно число.

    Запись идёт, только если что-то изменилось: лишний `save` дёргал бы
    `updated_at`, а по нему на экране написано «обновлено».
    """
    visits = list(event.visit_objects.all())
    if not visits:
        return event
    stage = min((v.stage for v in visits), key=_stage_index)
    need = sum(int(v.force_need or 0) for v in visits)
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


def advance_visits(event, stage, visits=None):
    """Перевести объекты на стадию и пересчитать по ним мероприятие.

    `visits=None` — ВСЕ объекты: так работают переходы, которые человек делает
    для мероприятия целиком (бюллетень, ознакомление, закрытие). Переходы,
    у которых адресат — объект (согласование, возврат), передают его явно.
    """
    rows = visits if visits is not None else list(event.visit_objects.all())
    for visit in rows:
        if visit.stage == stage:
            continue
        visit.stage = stage
        visit.save(update_fields=["stage", "updated_at"])
    return recompute_event_stage(event)


def _advance(event, stage):
    """Стадия мероприятия целиком: объектам ставится та же, событие — вывод.

    Переход в журнал (`record_transition`) пишется по ФАКТУ смены стадии
    МЕРОПРИЯТИЯ. У ОМ с двумя объектами один объект может уйти вперёд, а
    мероприятие остаться — и записать такой переход значило бы соврать ленте:
    мероприятие никуда не переходило.
    """
    old_stage = event.stage
    if event.visit_objects.exists():
        advance_visits(event, stage)
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
    # Объекты посещения ЭТОГО мероприятия: пост может принадлежать только им.
    # Чужой (или выдуманный) идентификатор молча превращал бы потребность
    # объекта в потребность никого — «неизвестно» вместо числа, и разбирались
    # бы с этим на экране, а не здесь (Plane №408).
    own_visit_ids = {
        str(pk) for pk in event.visit_objects.values_list("pk", flat=True)
    }
    for index, row in enumerate(sector_posts):
        if not str(row.get("sector", "")).strip():
            field_errors[f"sectorPosts.{index}.sector"] = ["Обязательное поле."]
        if not str(row.get("post", "")).strip():
            field_errors[f"sectorPosts.{index}.post"] = ["Обязательное поле."]
        if int(row.get("need", 0)) < 1:
            field_errors[f"sectorPosts.{index}.need"] = ["Должно быть не меньше 1."]
        visit_id = str(row.get("visitObjectId") or "").strip()
        if visit_id and visit_id not in own_visit_ids:
            field_errors[f"sectorPosts.{index}.visitObjectId"] = [
                "Объекта посещения нет в этом мероприятии."
            ]
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
    fields = ["recon_checklist", "recon_sector_posts", "updated_at"]
    if parsed_request is not None:
        event.recon_force_request = parsed_request
        fields.append("recon_force_request")
    event.save(update_fields=fields)
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
    return event.visit_objects.order_by("position", "pk").first()


def visit_object_posts(event, visit):
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
    if event.visit_objects.count() == 1:
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
        need = sum(
            int(p.get("need") or 0)
            for p in visit_object_posts(event, visit)
        )
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
    return [
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
        for index, post in enumerate(posts or [], start=1)
    ]


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
    event.force_need = sum(
        int(v.force_need or 0) for v in event.visit_objects.all()
    ) or sum(int(row["need"]) for row in rows)
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
    """
    if row.get("status") in ("SUBMITTED", "ACCEPTED", "RETURNED"):
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
                # Ответ департамента «Выделяем: X» (Plane №391, `[СБС-21]`)
                # переносится по тому же правилу, что и опоздание выше: строка
                # пересобирается явным перечнем, и забытый ключ — стёртый
                # факт. Штаб, пересохранивший раскладку ради чужого `need`,
                # стирал бы ответ департамента.
                "allocating": kept.get("allocating"),
                "answerComment": kept.get("answerComment", ""),
                "declinedAt": kept.get("declinedAt"),
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
    if event.stage not in _ALLOCATION_STAGES:
        raise DomainError(
            "INVALID_STAGE_TRANSITION",
            422,
            message=(
                "Делить квоту между управлениями можно после рекогносцировки "
                "и до согласования расстановки."
            ),
        )
    target = _find_allocation(event, allocation_id)
    if target.get("status") != _ALLOCATION_DRAFT:
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
    incoming = list(rows or [])
    seen = set()
    total = 0
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
        try:
            need = int(row.get("need", 0))
        except (TypeError, ValueError):
            raise _validation({f"rows.{index}.need": ["Укажите число."]})
        if need < 0:
            raise _validation({f"rows.{index}.need": ["Число не может быть меньше нуля."]})
        total += need
        prepared.append((key, need))

    # ПРЕДЕЛ — ОТ «ВЫДЕЛЯЕМ» (Plane №392, `[СБС-22]`: «разбивка по
    # управлениям — от цифры „Выделяем“»). Пока департамент не ответил —
    # запрос штаба, как и раньше: раскладывать больше, чем сам решил дать,
    # нельзя; больше, чем просили, — тоже (ответ это разрешает, раскладка нет:
    # она делит именно ответ).
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

    need_of = dict(prepared)
    kept_rows = {
        str(row.get("divisionId")): row for row in target.get("directorates", [])
    }
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
                # касался, остаётся как была.
                "need": need_of.get(key, int(kept.get("need") or 0)),
                "notifiedAt": kept.get("notifiedAt"),
            }
        )
    # Управление, выбывшее из департамента, из заявки не стирается — тем же
    # правилом, что и у оповещения: его след это факт.
    for key, kept in kept_rows.items():
        if key not in known:
            saved.append({**kept, "need": int(kept.get("need") or 0)})

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
            "rows": [{"divisionId": key, "need": need} for key, need in prepared],
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
                # Квота управления (Plane №272, Ш-1) переносится КАК ЕСТЬ:
                # её ставит департамент отдельным действием, оповещение
                # только рассылает. Пересборка строки без этого поля стирала
                # бы раскладку в момент рассылки — то есть ровно тогда, когда
                # число впервые становится нужным.
                "need": int((kept or {}).get("need") or 0),
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
            "headlessDirectorates": delivery["headlessDirectorates"],
        },
    )
    return event


# Статус привлечения на мероприятие. Код справочника, а не своя строка: расход
# дня и «Сбор сил» считают привлечённых именно по нему.
ASSIGNMENT_STATUS_CODE = "EVENT_ASSIGNMENT"

# Вид участия выводится ИЗ КОДА СТАТУСА — тем же соответствием, что и бэкфилл
# Ш-3 (`operations/migrations/0062_status_participation.py`). Держать его в
# одном месте нельзя: миграция обязана быть замороженной во времени, а
# рабочий код — жить. Поэтому соответствие продублировано ОСОЗНАННО, и
# расхождение стережёт проба `test_allocation_kind_matches_backfill`.
_PARTICIPATION_KIND_BY_STATUS = {
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


def _merge_status_members(event, rows):
    """Люди строк раскладки: ручной набор штаба ПЛЮС взятые из статусов.

    Выделено из `allocation_members_view` при Ш-2 (Plane №272): считать
    «выделено N из M» по управлениям можно только по УЖЕ СВЕДЁННОМУ составу,
    а сведение имеет три ранних выхода. Держать счёт внутри них значило бы
    написать его трижды и однажды разойтись.

    Разбор направления — в `allocation_members_view` ниже (Plane №274, Ш-5).

    ПЕРЕВОРОТ НАПРАВЛЕНИЯ, которого просил заказчик. До этого шага список
    департамента был ручным набором штаба: человек попадал в него только если
    штаб нажал «выделить». Начальник управления мог поставить человеку статус
    участия в своём расходе — и в списке ОМ он не появлялся, потому что список
    ничего не знал про статусы. Теперь наоборот: источник — статус, а ручной
    набор стал одним из способов его поставить.

    Старый путь ЖИВЁТ, а не снимается: `add_allocation_member` по-прежнему
    пишет строку в `force_allocation` и ставит статус (теперь со строкой
    участия). Снятие JSON-хранилища — отдельный шаг после переезда читателей,
    как и с `force_requests`; здесь оно остаётся источником ВСЕГО, что
    статусом не описано: момент добавления и ссылка на статус для снятия.

    Что даёт объединение:

    - строка есть в JSON и есть участие — берётся JSON, он богаче;
    - участие есть, а строки нет (статус поставили из расхода) — строка
      достраивается и помечается `source: "STATUS"`, чтобы экран мог сказать,
      откуда человек взялся;
    - строка есть, а участия нет — остаётся как была. Молча выкидывать её
      значило бы стереть чужую работу из-за того, что мы поменяли источник.

    Департамент человека — КОРЕНЬ его поддерева, а не подразделение штатной
    единицы: человек числится в отделе, а раскладка адресована департаменту.
    """
    if not rows:
        return []

    from organization_management.apps.operations.models_status import (
        OpsStatusParticipation,
    )
    from organization_management.apps.operations.selectors import (
        DivisionTreeSelector,
        EmployeeSelector,
        StaffUnitSelector,
    )

    # Кто участвует в ЭТОМ мероприятии — один запрос по индексу
    # `idx_participation_event`; отменённые статусы не в счёт.
    participations = (
        OpsStatusParticipation.objects.filter(event_id=event.pk)
        .select_related("status")
        .filter(status__cancelled_at__isnull=True)
    )
    by_employee = {}
    for row in participations:
        by_employee.setdefault(int(row.status.employee_id), row)
    if not by_employee:
        return rows

    known = {
        str(member.get("employeeId"))
        for row in rows
        for member in row.get("members", [])
    }
    extra_ids = [eid for eid in by_employee if str(eid) not in known]
    if not extra_ids:
        return rows

    # Департамент каждого добавленного: поддерево строки раскладки.
    children_map = DivisionTreeSelector.children_map()
    subtree_of = {
        str(row.get("departmentId")): DivisionTreeSelector.subtree_ids(
            _as_division_id(row.get("departmentId")), children_map=children_map
        )
        for row in rows
        if row.get("departmentId") is not None
    }
    division_of = StaffUnitSelector.divisions_of(extra_ids)
    # Имя подразделения — ОДНИМ запросом. Первая версия оставляла его пустым,
    # и в карточке заявки у всех, кто попал в список статусом, в колонке
    # «Подразделение» стоял прочерк: экран знал id и не знал названия.
    from organization_management.apps.divisions.models import Division

    division_names = dict(
        Division.objects.filter(pk__in=set(division_of.values())).values_list(
            "pk", "name"
        )
    )
    # ФИО одним запросом: перебор по `_find_personnel` дал бы число запросов,
    # зависящее от числа людей, — ровно того раздел избегает везде.
    names = {
        employee_id: row.get("full_name", "")
        for employee_id, row in EmployeeSelector.denorm_for(extra_ids).items()
    }

    extra_by_department = {}
    for employee_id in extra_ids:
        division_id = division_of.get(employee_id)
        if division_id is None:
            continue
        for department_key, subtree in subtree_of.items():
            if division_id in subtree:
                participation = by_employee[employee_id]
                extra_by_department.setdefault(department_key, []).append(
                    {
                        "employeeId": str(employee_id),
                        "name": names.get(employee_id, ""),
                        "divisionId": str(division_id),
                        "divisionName": division_names.get(division_id, ""),
                        "addedAt": None,
                        "statusId": str(participation.status_id),
                        "kindCode": participation.kind_code,
                        "roleCode": participation.role_code,
                        # Откуда строка взялась: экран обязан отличать
                        # «штаб выделил» от «поставили статусом», иначе
                        # снятие обещало бы то, чего не может.
                        "source": "STATUS",
                    }
                )
                break

    if not extra_by_department:
        return rows
    return [
        {
            **row,
            "members": [
                *row.get("members", []),
                *extra_by_department.get(str(row.get("departmentId")), []),
            ],
        }
        for row in rows
    ]


def allocation_members_view(event):
    """Раскладка по департаментам ДЛЯ ЭКРАНА: люди сведены, прогресс посчитан.

    ПЕРЕВОРОТ НАПРАВЛЕНИЯ, которого просил заказчик (Plane №274, Ш-5). До того
    шага список департамента был ручным набором штаба: человек попадал в него
    только если штаб нажал «выделить». Начальник управления мог поставить
    человеку статус участия в своём расходе — и в списке ОМ он не появлялся,
    потому что список ничего не знал про статусы. Теперь источник — статус, а
    ручной набор стал одним из способов его поставить.

    Старый путь ЖИВЁТ, а не снимается: `add_allocation_member` по-прежнему
    пишет строку в `force_allocation` и ставит статус. Снятие JSON-хранилища —
    отдельный шаг после переезда читателей, как и с `force_requests`; здесь
    оно остаётся источником ВСЕГО, что статусом не описано: момент добавления
    и ссылка на статус для снятия.

    Правила сведения — в `_merge_status_members`; счёт «выделено N из M» по
    управлениям — в `_with_directorate_progress` (Plane №272, Ш-2).
    """
    rows = event.force_allocation or []
    merged = _with_directorate_progress(_merge_status_members(event, rows))
    # «Просрочено» считается здесь, а не хранится: это факт о ТЕКУЩЕМ моменте
    # (Plane №287). Момент один на весь ответ — иначе строки одного экрана
    # отвечали бы про разные секунды.
    now = Clock.now()
    return [{**row, "overdue": allocation_is_overdue(row, now=now)} for row in merged]


def _with_directorate_progress(rows):
    """«Выделено N из M» по каждому управлению (Plane №272, Ш-2).

    СЧИТАЕТСЯ НА ЧТЕНИИ, а не хранится — тем же правилом, что статус дня у
    состава (`force_roster_view`) и подразделение у назначения
    (`placement_assignments_view`): записанная копия соврала бы к утру. Человек
    переводится между управлениями мимо мероприятия, и число, посчитанное в
    момент выделения, назавтра описывало бы вчерашнюю структуру.

    Человек относится к управлению по ПОДДЕРЕВУ, а не по совпадению
    подразделения: он числится в отделе, а квота адресована управлению.
    Сравнение «в лоб» не нашло бы никого.

    Человек, чьё подразделение не лежит ни под одним управлением заявки, ни к
    кому не приписывается — и это не потеря: в departmentе он посчитан, а
    выдумывать ему управление значило бы записать его чужой квоте.
    """
    if not rows:
        return rows
    from organization_management.apps.operations.selectors import (
        DivisionTreeSelector,
        StaffUnitSelector,
    )

    has_directorates = any(row.get("directorates") for row in rows)
    if not has_directorates:
        return rows

    # 🔴 ПОДРАЗДЕЛЕНИЕ БЕРЁТСЯ ЖИВЬЁМ, А НЕ ИЗ СТРОКИ. В строке выделения
    # лежит `divisionId`, записанный В МОМЕНТ выделения, — это копия, и после
    # перевода человека она указывает на прежнее управление. Тогда «выделено»
    # осталось бы у того, кто человека уже не имеет, а новое управление
    # считало бы, что от него никого не выделили. Ровно ту же причину
    # `placement_assignments_view` называет у назначений: «перевод человека не
    # должен требовать правки чужих строк». Запись из строки остаётся
    # ЗАПАСНЫМ путём — у человека может не быть штатной единицы вовсе.
    member_ids = [
        int(member["employeeId"])
        for row in rows
        for member in (row.get("members") or [])
        if str(member.get("employeeId") or "").isdigit()
    ]
    live_division = StaffUnitSelector.divisions_of(member_ids) if member_ids else {}

    children_map = DivisionTreeSelector.children_map()
    result = []
    for row in rows:
        directorates = row.get("directorates") or []
        if not directorates:
            result.append(row)
            continue
        subtree_of = {
            str(item.get("divisionId")): DivisionTreeSelector.subtree_ids(
                _as_division_id(item.get("divisionId")), children_map=children_map
            )
            for item in directorates
        }
        assigned = {key: 0 for key in subtree_of}
        for member in row.get("members", []) or []:
            raw = member.get("employeeId")
            division_id = (
                live_division.get(int(raw))
                if str(raw or "").isdigit()
                else None
            )
            if division_id is None:
                division_id = _as_division_id(member.get("divisionId"))
            if division_id is None:
                continue
            for key, subtree in subtree_of.items():
                if division_id in subtree:
                    assigned[key] += 1
                    break
        result.append(
            {
                **row,
                "directorates": [
                    {
                        **item,
                        "need": int(item.get("need") or 0),
                        "assigned": assigned.get(str(item.get("divisionId")), 0),
                    }
                    for item in directorates
                ],
            }
        )
    return result


def department_requests_view(allowed_division_ids):
    """Заявки, адресованные департаментам актора (Plane №272, Ш-3).

    Обратный разрез цепочки: штаб смотрит «кому я раздал», департамент —
    «что просят у МЕНЯ». Поэтому и ручка своя, а не фильтр по списку ОМ:
    список отдаёт мероприятие ЦЕЛИКОМ (вместе со сведением людей и счётом по
    управлениям на каждое), и экран из пяти колонок платил бы за это на
    каждой строке.

    `allowed_division_ids is None` означает «область не сужена» — так ручка
    отвечает администратору и роли без области. Пустое множество означает
    обратное: видеть нечего, и ответ пуст. Разница существенная, и `None`
    здесь не «нет данных».

    Строки чужих департаментов не приезжают ВООБЩЕ: сузить их на клиенте
    значило бы прислать их браузеру и понадеяться, что он не покажет.
    """
    events = (
        OpsSecurityEvent.objects.exclude(force_allocation=[])
        .order_by("business_date", "code")
    )
    rows = []
    for event in events:
        for allocation in allocation_members_view(event):
            department_id = _as_division_id(allocation.get("departmentId"))
            if department_id is None:
                continue
            if allowed_division_ids is not None and department_id not in allowed_division_ids:
                continue
            members = allocation.get("members") or []
            rows.append(
                {
                    "eventId": str(event.pk),
                    "code": event.code,
                    "title": event.title,
                    "businessDate": event.business_date.isoformat(),
                    # Время САМОГО МЕРОПРИЯТИЯ. Отдельно от него едет `dueAt` —
                    # срок сдачи списка (Plane №287): раньше такого поля не
                    # было вовсе, и экран честно называл эту колонку «Дата ОМ»,
                    # чтобы не выдавать дату мероприятия за срок.
                    "eventTime": (
                        event.event_time.strftime("%H:%M")
                        if event.event_time is not None
                        else None
                    ),
                    "location": event.location or event.object_name,
                    "stage": event.stage,
                    "allocationId": allocation.get("id"),
                    "departmentId": str(department_id),
                    "departmentName": allocation.get("departmentName") or "",
                    "need": int(allocation.get("need") or 0),
                    "assigned": len(members),
                    "status": allocation.get("status") or _ALLOCATION_DRAFT,
                    # Срок сдачи списка и признак опоздания (Plane №287).
                    # `dueAt` — момент, `overdue` — ответ про ТЕКУЩИЙ момент,
                    # посчитанный сервером: считать его на клиенте значило бы
                    # доверить часам браузера решение «опоздал или нет».
                    "dueAt": allocation.get("dueAt"),
                    "overdue": bool(allocation.get("overdue")),
                    "submittedLate": bool(allocation.get("submittedLate")),
                }
            )
    return rows


def department_request_detail(allocation_id, allowed_division_ids):
    """ОДНА заявка департаменту целиком: управления и выделенные (Ш-4).

    Своя ручка, а не карточка мероприятия: карточка отдаёт раскладку ПО ВСЕМ
    департаментам, и ответственному за свой департамент приезжали бы чужие
    строки — вопрос не в том, покажет ли их экран, а в том, что они уже у него
    в браузере.

    404, а не 403, когда заявка есть, но чужая: существование чужой строки —
    не то, что стоит подтверждать перебором идентификаторов. Своей заявки нет
    — тот же 404 по той же причине.
    """
    for event in OpsSecurityEvent.objects.exclude(force_allocation=[]):
        for allocation in allocation_members_view(event):
            if allocation.get("id") != allocation_id:
                continue
            department_id = _as_division_id(allocation.get("departmentId"))
            if (
                allowed_division_ids is not None
                and department_id not in allowed_division_ids
            ):
                raise _not_found("Заявка департаменту не найдена.", allocation_id)
            return {
                "eventId": str(event.pk),
                "code": event.code,
                "title": event.title,
                "businessDate": event.business_date.isoformat(),
                "eventTime": (
                    event.event_time.strftime("%H:%M")
                    if event.event_time is not None
                    else None
                ),
                "location": event.location or event.object_name,
                "stage": event.stage,
                "allocation": allocation,
            }
    raise _not_found("Заявка департаменту не найдена.", allocation_id)


def force_collections_view():
    """Сборы глазами ШТАБА: сводка по МЕРОПРИЯТИЮ (Plane №271, Ш-1).

    Зеркало департаментского разреза (№272): тот отвечает на вопрос «что
    просят у меня», этот — «сколько я раздал и сколько мне вернули». Вопросы
    разные, поэтому и строка своя: у департамента она про ОДНУ заявку, здесь —
    про мероприятие целиком, со всеми департаментами сразу.

    ВСЁ СЧИТАЕТСЯ НА ЧТЕНИИ. «Собрано» — это люди, а люди приходят статусами
    (№274 Ш-5) и уходят переводами; записанное число соврало бы к утру тем же
    способом, что и «выделено» по управлению (№272 Ш-2).

    Сборы — это мероприятия, которым УЖЕ посчитали потребность: пока числа с
    рекогносцировки нет, раздавать нечего, и строка в списке штаба означала бы
    работу, которой ещё не существует.
    """
    events = OpsSecurityEvent.objects.exclude(stage=OpsSecurityEvent.Stage.CLOSED).order_by(
        "business_date", "code"
    )
    rows = []
    for event in events:
        need = force_demand_total(event)
        if need <= 0:
            continue
        allocations = allocation_members_view(event)
        gathered = sum(len(row.get("members") or []) for row in allocations)
        rows.append(
            {
                "eventId": str(event.pk),
                "code": event.code,
                "title": event.title,
                "businessDate": event.business_date.isoformat(),
                # Времени «срока сбора» у мероприятия нет ВООБЩЕ (Plane №287) —
                # отдаём время самого ОМ, а называет его экран своими словами.
                "eventTime": (
                    event.event_time.strftime("%H:%M")
                    if event.event_time is not None
                    else None
                ),
                "location": event.location or event.object_name,
                "stage": event.stage,
                "need": need,
                "allocated": sum(int(row.get("need") or 0) for row in allocations),
                "gathered": gathered,
                "departments": len(allocations),
                "collectionStatus": _collection_status(allocations, gathered),
                # Сколько заявок ПРОСРОЧЕНО (Plane №287). Штабу нужен не
                # список сроков, а ответ «есть ли отстающие»: сроки у каждой
                # заявки свои, и общий у мероприятия был бы выдумкой.
                "overdueCount": sum(
                    1 for row in allocations if row.get("overdue")
                ),
            }
        )
    return rows


def force_collection_detail(event_id):
    """Сбор ЦЕЛИКОМ: мероприятие, плитки и раскладка с людьми (Ш-2, №271).

    Своя ручка, а не карточка мероприятия: та отдаёт ОМ со всеми стадиями,
    маршрутом согласования, журналом и расстановкой — экрану сбора из этого
    нужна одна десятая, и платить за остальное на каждом открытии незачем.

    Плитки эталона считаются ЗДЕСЬ, а не на клиенте: «осталось собрать» — это
    правило («требуется минус собрано»), и второй счёт на клиенте разошёлся бы
    с сервером при первой же правке правила.
    """
    event = OpsSecurityEvent.objects.filter(pk=event_id).first()
    if event is None:
        raise _not_found("Мероприятие не найдено.", event_id)
    need = force_demand_total(event)
    allocations = allocation_members_view(event)
    gathered = sum(len(row.get("members") or []) for row in allocations)
    return {
        "eventId": str(event.pk),
        "code": event.code,
        "title": event.title,
        "businessDate": event.business_date.isoformat(),
        "eventTime": (
            event.event_time.strftime("%H:%M")
            if event.event_time is not None
            else None
        ),
        "location": event.location or event.object_name,
        "stage": event.stage,
        "need": need,
        "allocated": sum(int(row.get("need") or 0) for row in allocations),
        "gathered": gathered,
        # «Осталось собрать» не уходит в минус: перебор — это не отрицательный
        # остаток, а свой факт, и он виден по паре «собрано / требуется».
        "remaining": max(0, need - gathered),
        "collectionStatus": _collection_status(allocations, gathered),
        "allocations": allocations,
    }


def _collection_status(allocations, gathered):
    """Состояние сбора по МЕРОПРИЯТИЮ — выводится, а не хранится (Ш-3).

    Три состояния эталона заказчика:

    - `NEW` — раскладки нет вовсе: штаб ещё не решил, кому сколько;
    - `NOTIFIED` — разнарядка разослана ВСЕМ строкам раскладки. Именно всем, а
      не «хотя бы одной»: пока одному департаменту не сказали, разнарядка не
      разослана, и обратное читалось бы как «все предупреждены»;
    - `IN_PROGRESS` — люди пошли: есть хотя бы один выделенный.

    Порядок проверок обратный порядку жизни: «люди пошли» перекрывает
    «разослана», потому что описывает более позднее состояние.
    """
    if not allocations:
        return "NEW"
    if gathered > 0:
        return "IN_PROGRESS"
    if all(row.get("status") != _ALLOCATION_DRAFT for row in allocations):
        return "NOTIFIED"
    return "NEW"


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
                # Роль наряда: у строк, заведённых до №238, ключа нет вовсе —
                # клиенту незачем различать «роль не назначена» и «поля не
                # было», обе означают пустое место в бланке.
                "roleCode": row.get("roleCode") or None,
                # Секция бланка: у строк, заведённых до №242, ключа нет вовсе —
                # клиенту незачем различать «секция не назначена» и «поля не
                # было», обе означают пустое место в бланке.
                "sectionCode": row.get("sectionCode") or None,
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
        # СТАТУС ВЕДЁТ ЦЕПОЧКУ (Plane №274, Ш-5). До этого шага выделение
        # штабом писало только `source_ref`, и строка участия у него не
        # заводилась вовсе: бэкфилл Ш-3 перенёс то, что БЫЛО на момент
        # миграции, а всё выделенное после неё оставалось новой таблице
        # невидимым — 45 статусов за сутки. Департаментский список, который
        # теперь собирается из участий, потерял бы ровно этих людей.
        participations=[
            {
                "event_id": event.pk,
                "kind_code": _PARTICIPATION_KIND_BY_STATUS[ASSIGNMENT_STATUS_CODE],
            }
        ],
        # Участие поставила ЦЕПОЧКА, а не человек из каталога: вид выведен из
        # кода статуса, и сверять его со справочником значило бы позволить
        # выключенному справочному значению сломать выделение людей на ОМ.
        system_participations=True,
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


# Статус «Отказ» (Plane №391, `[СБС-21]`): «0» закрывает запрос. Отдельное
# значение, а не `SUBMITTED` с пустым списком: штаб обязан отличать «нам
# отказали» от «прислали пустой список» — второе сервер и не принимает.
_ALLOCATION_DECLINED = "DECLINED"


@transaction.atomic
def respond_allocation(event_id, allocation_id, *, allocating, comment, actor):
    """Ответ департамента на запрос штаба: «Выделяем: X · Комментарий»
    (Plane №391, `[СБС-21]`).

    Правила — из спецификации, а не выдуманы:

    - **Цифру ставит только ответственный, штаб читает.** Область — департамент
      строки раскладки (проверяет вьюха, как у оповещения и отправки).
    - **Ограничений нет: меньше, больше, 0.** Запрос штаба — пожелание, а не
      наряд (`[СБС-01]`); отказ здесь превратил бы форму в ультиматум.
    - **«0» закрывает запрос статусом «Отказ».** Ненулевая цифра после отказа
      его СНИМАЕТ — статус возвращается к тому, каким был бы без него
      (оповещено или ещё нет): отказ — решение, а решение можно передумать,
      пока список не ушёл.
    - **Редактируема до отправки списка.** После `SUBMITTED` штаб уже решает
      по присланному, и менять цифру под ним значило бы менять условия задним
      числом.
    - **Комментарий необязателен.** «Желательно пояснить» при цифре меньше
      запрошенной — подсказка экрана, не правило сервера.
    """
    event = lock_event(event_id)
    if event.stage not in _ALLOCATION_STAGES:
        raise DomainError(
            "INVALID_STAGE_TRANSITION",
            422,
            message=(
                "Отвечать на запрос можно после рекогносцировки и до "
                "согласования расстановки."
            ),
        )
    target = _find_allocation(event, allocation_id)
    if target.get("status") in ("SUBMITTED", "ACCEPTED"):
        raise DomainError(
            "ALLOCATION_ANSWER_LOCKED",
            422,
            message=(
                "Список уже у штаба — цифра «Выделяем» правится до отправки. "
                "Чтобы изменить её, отзовите список."
            ),
        )
    try:
        count = int(allocating)
    except (TypeError, ValueError):
        raise _validation({"allocating": ["Укажите целое число."]})
    if count < 0:
        raise _validation({"allocating": ["Число не может быть меньше нуля."]})

    # СВОЙ ключ, а не `comment`: тот — комментарий ШТАБА к строке раскладки
    # (приходит с `forces/allocation/` и пересохраняется им же). Пиши ответ
    # департамента туда — и штаб, пересохранив раскладку, стёр бы его
    # (поймано пробой `test_the_staff_resaving_the_split_keeps_the_department_answer`).
    patch = {
        "allocating": count,
        "answerComment": str(comment or "").strip(),
    }
    if count == 0:
        patch["status"] = _ALLOCATION_DECLINED
        patch["declinedAt"] = _now_iso()
    elif target.get("status") == _ALLOCATION_DECLINED:
        # Отказ снят: статус — по факту оповещения, а не «как было до отказа»
        # (этого сервер не помнит, и помнить не должен).
        patch["status"] = "NOTIFIED" if target.get("notifiedAt") else _ALLOCATION_DRAFT
        patch["declinedAt"] = None
    event = _update_allocation(event, allocation_id, patch)
    audit_service.record(
        actor=actor,
        action=audit_service.FORCE_ALLOCATION_SPLIT,
        entity_type=audit_service.ENTITY_SECURITY_EVENT,
        entity_id=event.pk,
        new_value={
            "code": event.code,
            "departmentName": target.get("departmentName"),
            "requested": target.get("need"),
            "allocating": count,
            "declined": count == 0,
            "comment": patch["answerComment"],
        },
    )
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
    # ОПОЗДАНИЕ НЕ ЗАПРЕЩАЕТ ОТПРАВКУ (Plane №287). Список нужен штабу и
    # позже срока: запрет означал бы, что опоздавший департамент вообще ничего
    # не может сообщить, а штаб остаётся без людей И без сведений. Опоздание
    # ЗАПИСЫВАЕТСЯ моментом отправки и сроком — по ним видно, кто сдал поздно.
    late = allocation_is_overdue(
        {**target, "status": "NOTIFIED"}, now=Clock.now()
    )
    event = _update_allocation(
        event,
        allocation_id,
        {"status": "SUBMITTED", "submittedAt": now, "submittedLate": late},
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


def resolve_protected_persons(raw_ids, field_errors, field="protectedPersonIds"):
    """Разобрать список лиц бюллетеня (Plane №188). Возвращает список записей.

    ГЛАВНОЕ — ПЕРВОЕ. Колонка «ОЛ» бланка бюллетеня одна, и кто-то обязан в неё
    попасть; выбирать его по алфавиту значило бы менять шапку документа от
    переименования человека. Поэтому главным становится первое лицо списка —
    то, которое назвали первым.

    ДУБЛИ СНИМАЮТСЯ МОЛЧА, а не отбиваются ошибкой: одно и то же лицо, выбранное
    дважды, — это оговорка ввода, а не заявление о двух разных людях. Порядок
    первого появления при этом сохраняется.

    Неизвестный идентификатор — ОШИБКА ПОЛЯ, а не пропуск: тихо выброшенное
    лицо человек заметит только по документу, в котором его нет.
    """
    seen = set()
    persons = []
    unknown = []
    for raw in raw_ids or []:
        value = str(raw or "").strip()
        if value == "" or value in seen:
            continue
        seen.add(value)
        person = (
            OpsProtectedPerson.objects.filter(pk=value, is_active=True).first()
            if value.isdigit()
            else None
        )
        if person is None:
            unknown.append(value)
        else:
            persons.append(person)
    if unknown:
        field_errors[field] = [
            "Охраняемое лицо не найдено в справочнике: " + ", ".join(unknown)
        ]
    return persons


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


def _validated_placement_role(role_code):
    """Код роли наряда: пусто либо ЖИВОЕ значение справочника (Plane №238).

    🔴 Строкой «как пришло» роль хранить нельзя: «водитель VIP» и «водитель
    ВИП» стали бы разными ролями, и бланк снова заполнялся бы наугад — ровно
    та беда, из-за которой справочник и заводился (№195, №237).

    Неактивная роль тоже отказ: её убрали из справочника сознательно, и тихо
    поставить её в новое назначение значило бы обойти это решение.
    """
    code = str(role_code or "").strip()
    if code == "":
        return None
    from organization_management.apps.operations.models import OpsDictionaryEntry

    exists = OpsDictionaryEntry.objects.filter(
        dictionary_code="PLACEMENT_ROLES", code=code, is_active=True
    ).exists()
    if not exists:
        raise _validation(
            {"roleCode": [f"Роли наряда «{code}» нет в справочнике или она снята."]}
        )
    return code


def _validated_placement_section(section_code):
    """Код секции бланка: пусто либо ЖИВОЕ значение справочника (Plane №242).

    ВТОРАЯ КООРДИНАТА МЕСТА. Роль отвечает «кем человек идёт», секция — «где»:
    «Көшпелі күзетінің жауаптысы» есть у восьми выездных охран подряд, и одной
    роли документу мало — он ставил первого назначенного в первую охрану наугад.

    Правила те же, что у роли, и по тем же доводам: строкой «как пришло»
    хранить нельзя (две записи одного раздела стали бы разными секциями), а
    снятая секция — отказ (её убрали из справочника сознательно).

    Пусто — законное состояние, а не ошибка: у расстановки, сделанной до №242,
    секции нет вовсе, и требовать её задним числом значило бы запретить правку
    старых мероприятий.
    """
    code = str(section_code or "").strip()
    if code == "":
        return None
    from organization_management.apps.operations.models import OpsDictionaryEntry

    exists = OpsDictionaryEntry.objects.filter(
        dictionary_code="PLACEMENT_SECTIONS", code=code, is_active=True
    ).exists()
    if not exists:
        raise _validation(
            {
                "sectionCode": [
                    f"Секции бланка «{code}» нет в справочнике или она снята."
                ]
            }
        )
    return code


@transaction.atomic
def assign_placement(
    event_id,
    *,
    post_id,
    employee_id,
    override,
    override_reason,
    role_code=None,
    section_code=None,
    deputy=None,
):
    event = lock_event(event_id)
    _require_placement_editable(event, post_id)
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
        # Роль наряда (Plane №238). Необязательна: расстановка без ролей — не
        # ошибка, а «ещё не назначено»; документ по такой строке места не
        # заполнит, и это честнее, чем поставить человека наугад.
        "roleCode": _validated_placement_role(role_code),
        # Секция бланка (Plane №242) — рядом с ролью и по тем же правилам.
        # Роль отвечает «кем», секция «где»: без неё восемь выездных охран
        # неотличимы, и документ заполнялся порядком назначения.
        "sectionCode": _validated_placement_section(section_code),
        "acknowledgedAt": None,
        # обоснование сохраняется только при реально возникшем предупреждении
        "ratingOverrideReason": None if rating_conflict is None else reason,
    }
    event.placement_assignments = [*event.placement_assignments, assignment]
    event.save(update_fields=["placement_assignments", "updated_at"])
    # Числа объекта — снимки, и правка расстановки их двигает (Plane №412).
    recompute_visit_needs(event)
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
    victim = next(
        (a for a in event.placement_assignments if a.get("id") == assignment_id),
        None,
    )
    if victim is not None:
        _require_placement_editable(event, victim.get("postId"))
    event.placement_assignments = [
        a for a in event.placement_assignments if a.get("id") != assignment_id
    ]
    event.save(update_fields=["placement_assignments", "updated_at"])
    # Числа объекта — снимки, и правка расстановки их двигает (Plane №412).
    recompute_visit_needs(event)
    _record_deputy_placement(
        event, deputy, {"operation": "UNASSIGN", "assignmentId": str(assignment_id)}
    )
    return event


@transaction.atomic
def remove_placement_post(event_id, post_id, *, deputy=None):
    """Снять ПУСТОЙ пост с расчёта на этапе «Расстановка» (Plane №259, Ш-1).

    Зачем отдельная операция, а не разрешение общей правки рекогносцировки на
    поздней стадии: правка рекогносцировки меняет весь расчёт — задачи,
    требования, минимальный рейтинг, численность — и на «Расстановке» это
    означало бы переписывание задним числом того, подо что уже собраны люди.
    Здесь нужно ровно одно точечное действие с понятными последствиями.

    Правило заказчика 28.08.2026, дословно: «Если на этапе расстановки к посту
    привязан человек то нельзя удалять пост, а если он пустой соответственно
    можно удалять этот пост с расстановки». Отсюда отказ по занятому посту, а
    не молчаливое снятие людей вместе с ним: при недоборе лишние посты как раз
    пустые, а снятие людей уничтожило бы работу расстановки без следа.

    Что пересчитывается и что НЕТ:
    - `force_need` и `demand_rows` считаются заново по оставшимся постам —
      это ДЕЙСТВУЮЩАЯ потребность, и пост, которого больше нет, её не создаёт;
    - `recon_force_request`, `force_requests` и `force_allocation` не трогаются
      вовсе: это запись о том, сколько ЗАПРОСИЛИ у штаба и как он это разделил.
      Переписать её значило бы задним числом сказать «мы просили меньше»;
    - `readiness_percent` не трогается: он выводится из СТАДИИ
      (`STAGE_READINESS`), а не из численности, — пересчёт здесь был бы вторым
      счётом того же факта.
    """
    event = lock_event(event_id)
    # Заморозка по ОБЪЕКТУ поста (`[СОГ-04]`, Plane №398): гвард стадии
    # мероприятия ниже не спасает у двух объектов — мероприятие стоит на
    # «Расстановке» наименьшим, пока сосед уже на согласовании.
    _require_placement_editable(event, post_id)
    _require_stage(
        event,
        "PLACEMENT",
        "Снять пост можно только на этапе «Расстановка».",
    )
    posts = event.recon_sector_posts or []
    post = next((p for p in posts if str(p.get("id")) == str(post_id)), None)
    if post is None:
        raise _not_found("Пост не найден.", post_id)

    placed = [
        a
        for a in (event.placement_assignments or [])
        if str(a.get("postId")) == str(post_id)
    ]
    if placed:
        # Отказ НАЗЫВАЕТ ЧИСЛО и что сделать: «нельзя» без этого читается как
        # поломка, а человеку нужно понять, что пост сначала освобождают.
        names = ", ".join(
            str(a.get("employeeName") or "—") for a in placed[:3]
        )
        tail = f" и ещё {len(placed) - 3}" if len(placed) > 3 else ""
        raise DomainError(
            "POST_HAS_ASSIGNMENTS",
            422,
            detail={"postId": str(post_id), "assigned": str(len(placed))},
            message=(
                f"На посту стоит {len(placed)} чел. ({names}{tail}) — "
                "сначала снимите их с поста, потом снимайте пост."
            ),
        )

    remaining = [p for p in posts if str(p.get("id")) != str(post_id)]
    event.recon_sector_posts = remaining
    # Строки потребности пересобираются ТЕМИ ЖЕ правилами, что и при
    # автопроходе после рекогносцировки: второй способ построить строку
    # разошёлся бы с первым ровно там, где расхождение труднее заметить.
    event.demand_rows = _demand_rows_of(remaining)
    event.force_need = sum(int(row["need"]) for row in event.demand_rows)
    event.save(
        update_fields=[
            "recon_sector_posts",
            "demand_rows",
            "force_need",
            "updated_at",
        ]
    )
    # Числа объекта — снимки, и правка расстановки их двигает (Plane №412).
    recompute_visit_needs(event)
    _record_deputy_placement(
        event,
        deputy,
        {
            "operation": "REMOVE_POST",
            "postId": str(post_id),
            "postName": str(post.get("post") or ""),
        },
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
    _require_placement_editable(event, target.get("postId"))
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
@transaction.atomic
def complete_placement(
    event_id, *, visit_object_id=None, override=False, override_reason=None,
    actor=None,
):
    """Завершить расстановку ОБЪЕКТА (`[РАС-06]`, Plane №396).

    Требование заказчика буквально: «активна при полной укомплектованности;
    иначе подтверждение „K постов без людей. Завершить с недобором?“ +
    комментарий... После завершения → этап 3, документ „Расстановка сил“
    версия 1 в статусе „Черновик“».

    Недобор — МЯГКИЙ конфликт (409, `overridable`), той же формы, что и обход
    предупреждения по рейтингу при назначении: клиент показывает диалог,
    человек пишет причину, повтор уходит с `override=True`. Комментарий
    ОБЯЗАТЕЛЕН — «завершили с недобором без объяснения» неисполнимо для
    штаба, который потом ищет недостающих людей.

    ПОЛНОЕ ОТСУТСТВИЕ ПОСТОВ override не снимает: «K постов без людей»
    подразумевает K > 0, а расстановка без единого поста — не недобор,
    а нечего согласовывать.
    """
    event = lock_event(event_id)
    visit = pick_visit_object(
        event,
        visit_object_id,
        no_objects=(
            "У мероприятия нет объектов посещения: добавьте объект — "
            "расстановка принадлежит ему, а не мероприятию."
        ),
        ambiguous=(
            "У мероприятия несколько объектов посещения — выберите, чью "
            "расстановку завершить."
        ),
    )
    _require_stage(
        event,
        "PLACEMENT",
        "Расстановку можно завершить только на этапе «Расстановка».",
    )
    posts = visit_object_posts(event, visit)
    if not posts:
        raise DomainError(
            "PLACEMENT_INCOMPLETE", 422, message="Не все посты укомплектованы."
        )
    assigned = {a.get("postId") for a in event.placement_assignments}
    unstaffed = [p for p in posts if p.get("id") not in assigned]
    if unstaffed:
        clean_reason = str(override_reason or "").strip()
        if not (override is True and clean_reason != ""):
            count = len(unstaffed)
            noun = "постов" if count != 1 else "пост"
            raise DomainError(
                "PLACEMENT_UNDERSTAFFED",
                409,
                detail={"unfilledCount": count},
                overridable=True,
                message=(
                    f"{count} {noun} без людей. Завершить с недобором?"
                ),
            )
        audit_service.record(
            actor=actor,
            action=audit_service.PLACEMENT_COMPLETED_WITH_SHORTAGE,
            entity_type=audit_service.ENTITY_SECURITY_EVENT,
            entity_id=event.pk,
            new_value={
                "visitObjectId": str(visit.pk),
                "unfilledCount": len(unstaffed),
                "comment": clean_reason,
            },
        )
    # ДОКУМЕНТ «РАССТАНОВКА СИЛ» ЗАВОДИТСЯ ВЕРСИЕЙ 1 ЗДЕСЬ, а не на первой
    # отправке согласующим: `[РАС-06]` требует «версия 1 в статусе Черновик»
    # сразу после завершения этапа, до какой-либо отправки. `send_for_approval`
    # (Ш-5) растит версию ДАЛЬШЕ, на N+1 при повторной отправке (`[ВОЗ-06]`) —
    # эти два места пишут разные переходы одного счётчика, а не спорят.
    # `max`, а не безусловная единица: повторное завершение после возврата
    # (объект уже вернулся на «Расстановку» — `[ВОЗ-…]`) не обязано откатывать
    # версию назад, если она успела вырасти отправками.
    if visit.document_version < 1:
        visit.document_version = 1
        visit.save(update_fields=["document_version", "updated_at"])
    # Строка истории версий (`[СОГ-04]`, Plane №398): черновик v1 — или
    # текущая версия, если объект уже ходил на согласование и вернулся.
    _ensure_document_version(event, visit, actor=actor)
    old_stage = event.stage
    advance_visits(event, "APPROVAL", visits=[visit])
    if event.stage != old_stage:
        record_transition(event, old_stage, event.stage)
    return event


# ── Версии документа «Расстановка сил» (`[СОГ-04]`, Plane №398) ──────────────
#
# Требование: «После согласования версия замораживается: правка невозможна;
# любое изменение = новая версия → повторное согласование. Все версии
# хранятся, видны в „Истории версий“; отменённые помечены».
#
# НОМЕР — по `[СОГ-01]`/`[ВОЗ-06]`: завершение расстановки заводит черновик v1;
# ПЕРВАЯ отправка делает его «на согласовании» с тем же номером; отзыв и
# повторная отправка того же состава номер не трогают; N+1 появляется только
# повторной отправкой ПОСЛЕ ВОЗВРАТА — это другой состав, под ним подписываются
# заново, и прежняя версия помечается отменённой (`superseded_at`), не стирая
# своего статуса. Это уточняет правило Ш-5 (№411), где номер рос на каждую
# отправку — см. Decisions за 03.09.2026.
#
# ЗАМОРОЗКА — по стадии ОБЪЕКТА: назначение, снятие и смена старшего сектора
# отбиваются, как только объект дошёл до «Согласования» и дальше. Так
# покрываются и «на согласовании» (`[СОГ-07]`: после отправки форма только для
# чтения), и «согласовано» (`[СОГ-04]`); возврат переводит объект на
# «Расстановку» и тем же правилом размораживает. Гвард ищет объект ПО ПОСТУ —
# у назначения адреса объекта нет, а пост свой объект знает.
#
# 🔴 Правило «до „Согласования“», а не «только на „Расстановке“» — НАМЕРЕННО.
# Первая версия запирала и «Рекогносцировку» с «Бюллетенем», и полный прогон
# дал 27 красных: старые пробы и сокращённые фикстуры расставляют людей до
# завершения осмотра. Спецификация замораживает ДОКУМЕНТ, а до отправки
# документа нет — запирать ранние стадии значило бы придумать правило, которого
# заказчик не писал (Decisions за 03.09.2026, №398).


def _visit_of_post(event, post_id):
    """Объект посещения, которому принадлежит пост; None — объектов нет."""
    visits = list(event.visit_objects.order_by("position", "pk"))
    if not visits:
        return None
    if len(visits) == 1:
        return visits[0]
    post = next(
        (p for p in (event.recon_sector_posts or []) if str(p.get("id")) == str(post_id)),
        None,
    )
    owner = str((post or {}).get("visitObjectId") or "")
    return next((v for v in visits if str(v.pk) == owner), None)


_FROZEN_FROM = _STAGE_ORDER.index("APPROVAL")


def _require_placement_editable(event, post_id):
    """Отказ, если расстановка объекта этого поста заморожена — объект на
    «Согласовании» или дальше."""
    visit = _visit_of_post(event, post_id)
    if visit is None or _stage_index(visit.stage) < _FROZEN_FROM:
        return
    raise DomainError(
        "PLACEMENT_FROZEN",
        422,
        detail={"visitObjectId": str(visit.pk), "stage": visit.stage},
        message=(
            "Расстановка объекта заморожена: документ на согласовании или "
            "согласован. Изменение состава — через возврат на доработку, "
            "новой версией документа."
        ),
    )


def _document_snapshot(event, visit):
    """Снимок того, что подписывают: посты объекта и назначения на них."""
    posts = visit_object_posts(event, visit)
    post_ids = {str(p.get("id")) for p in posts}
    return {
        "posts": posts,
        "assignments": [
            a for a in (event.placement_assignments or [])
            if str(a.get("postId")) in post_ids
        ],
    }


def _current_document_version(visit):
    return visit.document_versions.order_by("-number").first()


def _ensure_document_version(event, visit, *, actor=None):
    """Строка ТЕКУЩЕЙ версии; заводится, если её ещё нет.

    Объекты, чей `document_version` вырос до этой таблицы (№396/№411), строки
    не имеют — бэкфилла нет намеренно (см. миграцию 0073). Первый же переход
    заводит её из живого состава: история начинается честно, «с этого
    момента», а не реконструкцией.
    """
    current = _current_document_version(visit)
    if current is not None:
        return current
    number = max(int(visit.document_version or 0), 1)
    row = OpsPlacementDocumentVersion.objects.create(
        visit_object=visit,
        number=number,
        status=(
            "APPROVED" if visit.approval_status == "APPROVED"
            else "RETURNED" if visit.approval_status == "RETURNED"
            else "SUBMITTED" if visit.approval_snapshot
            else "DRAFT"
        ),
        signature=visit.approval_snapshot or placement_signature(event, visit),
        snapshot=_document_snapshot(event, visit),
        created_by=actor_display_name(actor) if actor is not None else "",
        sent_at=Clock.now() if visit.approval_snapshot else None,
    )
    if visit.document_version != number:
        visit.document_version = number
        visit.save(update_fields=["document_version", "updated_at"])
    return row


def _submit_document_version(event, visit, *, actor=None):
    """Отправка: черновик → «на согласовании» тем же номером; после возврата —
    новая версия N+1, прежняя помечена отменённой."""
    now = Clock.now()
    current = _ensure_document_version(event, visit, actor=actor)
    if current.status == "RETURNED":
        current.superseded_at = now
        current.save(update_fields=["superseded_at", "updated_at"])
        current = OpsPlacementDocumentVersion.objects.create(
            visit_object=visit,
            number=current.number + 1,
            status="SUBMITTED",
            signature=placement_signature(event, visit),
            snapshot=_document_snapshot(event, visit),
            created_by=actor_display_name(actor) if actor is not None else "",
            sent_at=now,
        )
        visit.document_version = current.number
        visit.save(update_fields=["document_version", "updated_at"])
        return current
    current.status = "SUBMITTED"
    current.sent_at = now
    current.signature = placement_signature(event, visit)
    current.snapshot = _document_snapshot(event, visit)
    current.save(
        update_fields=["status", "sent_at", "signature", "snapshot", "updated_at"]
    )
    return current


def _decide_document_version(event, visit, status, *, actor=None):
    current = _ensure_document_version(event, visit, actor=actor)
    current.status = status
    current.decided_at = Clock.now()
    current.save(update_fields=["status", "decided_at", "updated_at"])
    return current


# ── Согласование ────────────────────────────────────────────────────────────
#
# 🔴 СОГЛАСУЮТ ОБЪЕКТ ПОСЕЩЕНИЯ, А НЕ МЕРОПРИЯТИЕ (Plane №411, Ш-5 плана
# №385). Требование `[МД-04]`: «У объекта свои этапы 1–5 и свой документ
# „Расстановка сил“ с версиями». До этого шага маршрут, замечания и снимок
# состава были полями МЕРОПРИЯТИЯ: у ОМ с двумя объектами согласующий
# подписывался под общим списком, в котором посты двух разных объектов лежали
# вперемешку, а вернуть на доработку один объект было нельзя вовсе.
#
# Все мутации ниже принимают `visit_object_id` и пишут В ОБЪЕКТ. Поля
# `approval_*` у `OpsSecurityEvent` мутации больше НЕ ПИШУТ — кроме двух
# сводных (`approval_status`, `approval_comment`), по которым считается стадия
# мероприятия и которые снимает Ш-7. Читателям (сериализатор) отвечает
# `primary_visit_object`. Это и есть правило плана «старый адрес пишет в
# объект, а не рядом»: двух источников правды в промежутке не заводим.


def _approval_target(event, visit_object_id):
    """Объект посещения, чьё согласование правит операция."""
    return pick_visit_object(
        event,
        visit_object_id,
        no_objects=(
            "У мероприятия нет объектов посещения: добавьте объект — документ "
            "«Расстановка сил» и маршрут согласования принадлежат ему, а не "
            "мероприятию."
        ),
        ambiguous=(
            "У мероприятия несколько объектов посещения — выберите, "
            "согласование какого из них вы правите."
        ),
    )


# ── Замечание согласования (`[МД-07]`, Plane №386) ──────────────────────────
#
# Требование заказчика буквально: «текст, автор, дата, привязка (пост /
# сектор / общее), срочно (да/нет), статус (Открыто → Устранено | Не
# согласен), ответ старшего + дата, версия документа, в которой поставлено /
# закрыто». До этого шага замечание несло только текст и булеву «устранено» —
# бинарный переключатель не мог выразить «не согласен, вот почему», а версии
# документа замечание не помнило вовсе (её и не было до №396).
#
# ПРИВЯЗКА — ТОЛЬКО ПОСТ, СЕКТОРА НЕТ. У сектора в разделе нет собственного
# идентификатора: это строка `post.get("sector")`, и несколько постов делят
# одну и ту же строку. Заводить привязку по имени сектора значило бы держать
# ссылку, которая рвётся при переименовании сектора и не различает «этот
# сектор» от «сектор с таким же названием у другого объекта». Как только
# сектору понадобится собственная сущность — привязка расширяется, а не
# подменяется.
_REMARK_STATUSES = ("OPEN", "RESOLVED", "DISAGREED")


def _is_urgent(event, explicit):
    """Срочно — явно поставлено человеком ИЛИ автоматически (`[ВОЗ-02]`):
    до даты мероприятия остались не более суток. Порог не настраивается по
    ОМ (это часть спецификации, которую отдельная задача ещё не завела) —
    здесь ровно та часть правила, для которой уже есть данные.
    """
    if explicit is True:
        return True
    if event.business_date is None:
        return False
    return (event.business_date - Clock.today_local()).days <= 1


def new_remark(
    event, *, remark_id, approver_id, author, text, post_id, urgent,
    document_version, created_at,
):
    """Собрать (не сохранить) замечание в форме контракта."""
    return {
        "id": remark_id,
        "approverId": approver_id,
        "author": author,
        "createdAt": created_at,
        "text": text,
        # Пусто — «общее», не привязано к посту (`[МД-07]`).
        "postId": str(post_id) if post_id not in (None, "") else None,
        "urgent": _is_urgent(event, urgent),
        "status": "OPEN",
        "response": "",
        "respondedAt": None,
        # Версия документа, В КОТОРОЙ ПОСТАВЛЕНО. Закрывающая версия
        # проставляется решением (`resolve_remark`) — до него закрывать
        # нечего.
        "documentVersion": document_version,
        "resolvedInDocumentVersion": None,
    }


def _next_approver_number(route):
    numbers = []
    for item in route:
        raw = str(item.get("id", "")).rsplit("-", 1)[-1]
        if raw.isdigit():
            numbers.append(int(raw))
    return (max(numbers) + 1) if numbers else 1


def _sync_event_approval(event):
    """Свести согласование мероприятия по его объектам.

    Мост до Ш-6, который делает производными ВСЕ поля мероприятия. Здесь
    сведены два, от которых зависит стадия: пока хоть один объект возвращён —
    возвращено мероприятие (работа есть); согласовано — только когда
    согласованы все; иначе ожидание. Причина возврата берётся у последнего
    возвращённого объекта: она и есть то, что человек читает баннером.
    """
    visits = list(event.visit_objects.order_by("position", "pk"))
    if not visits:
        return
    returned = [v for v in visits if v.approval_status == "RETURNED"]
    if returned:
        status = "RETURNED"
        comment = returned[-1].approval_comment
    elif all(v.approval_status == "APPROVED" for v in visits):
        status = "APPROVED"
        comment = ""
    else:
        status = "PENDING"
        comment = ""
    if event.approval_status == status and event.approval_comment == comment:
        return
    event.approval_status = status
    event.approval_comment = comment
    event.save(update_fields=["approval_status", "approval_comment", "updated_at"])


@transaction.atomic
def add_approver(event_id, *, name, unit, position, visit_object_id=None):
    """Добавляет согласующего в конец маршрута ОБЪЕКТА.

    Порядок — позиция в списке: у согласования он значим (кто первый), и
    отдельного поля под номер не нужно, иначе появятся два источника правды.
    """
    event = lock_event(event_id)
    visit = _approval_target(event, visit_object_id)
    clean_name = str(name or "").strip()
    if clean_name == "":
        raise _validation({"name": ["Обязательное поле."]})
    route = list(visit.approval_route or [])
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
    visit.approval_route = route
    visit.save(update_fields=["approval_route", "updated_at"])
    return event


@transaction.atomic
def remove_approver(event_id, approver_id, *, visit_object_id=None):
    event = lock_event(event_id)
    visit = _approval_target(event, visit_object_id)
    route = [
        a for a in (visit.approval_route or []) if a.get("id") != approver_id
    ]
    if len(route) == len(visit.approval_route or []):
        raise _not_found("Согласующий не найден.", approver_id)
    visit.approval_route = route
    visit.save(update_fields=["approval_route", "updated_at"])
    return event


@transaction.atomic
def decide_approver(
    event_id, *, approver_id, decision, comment, visit_object_id=None,
    post_id=None, urgent=None,
):
    """Решение одного согласующего. Возврат требует причины — как и возврат
    расстановки: «вернул без объяснения» неисполнимо для исполнителя.

    `post_id`/`urgent` — привязка замечания (`[МД-07]`, Plane №386): пост или
    «общее» (не прислали), и признак срочности. Оба необязательны — решение
    согласующего может остаться общим по объекту.
    """
    event = lock_event(event_id)
    visit = _approval_target(event, visit_object_id)
    if decision not in ("APPROVED", "RETURNED"):
        raise _validation({"decision": ["Допустимо APPROVED или RETURNED."]})
    clean_comment = str(comment or "").strip()
    if decision == "RETURNED" and clean_comment == "":
        raise _validation({"comment": ["Укажите причину возврата."]})
    route = list(visit.approval_route or [])
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
    visit.approval_route = route
    fields = ["approval_route", "updated_at"]
    if decision == "RETURNED":
        # Возврат порождает ЗАМЕЧАНИЕ: решение согласующего живёт в его
        # строке, а работа по нему — в списке, который закрывают по одному.
        remarks = list(visit.approval_remarks or [])
        remarks.append(
            new_remark(
                event,
                remark_id=f"remark-{len(remarks) + 1}-{approver_id}",
                approver_id=approver_id,
                author=target.get("name", ""),
                text=clean_comment,
                post_id=post_id,
                urgent=urgent,
                document_version=visit.document_version,
                created_at=now,
            )
        )
        visit.approval_remarks = remarks
        fields.insert(1, "approval_remarks")
    visit.save(update_fields=fields)
    # РЕШЕНИЕ СОГЛАСУЮЩЕГО — ДЕЙСТВИЕ, а не запись в таблицу (`[СОГ-08]`,
    # Plane №399): «Вернуть» возвращает объект на доработку сразу (тем же
    # телом, что ручка `approval/return/`), а последняя подпись завершает
    # этап сама (`[СОГ-09]`). Отдельных кнопок для того же у согласующего нет
    # (`[СОГ-11]`) — иначе одно решение принималось бы в двух местах.
    if decision == "RETURNED":
        return _return_visit(event, visit, clean_comment)
    return _autocomplete_approval(event, visit)


def placement_signature(event, visit=None):
    """Подпись расстановки: что именно согласуют.

    Сортированная, потому что порядок назначений в списке — деталь хранения, а
    не факт о расстановке: перестановка тех же людей по тем же постам не
    является изменением, и «расстановка изменилась» на неё было бы ложной
    тревогой. В подпись входят пост и человек — ровно то, что подписывают.

    Объект назван — в подпись входят ТОЛЬКО назначения на его посты (Plane
    №411): иначе правка расстановки соседнего объекта сбрасывала бы чужое
    согласование, под которым ничего не менялось.
    """
    assignments = event.placement_assignments or []
    if visit is not None:
        post_ids = {
            str(p.get("id")) for p in visit_object_posts(event, visit)
        }
        assignments = [
            a for a in assignments if str(a.get("postId")) in post_ids
        ]
    pairs = sorted(
        f"{item.get('postId')}:{item.get('employeeId')}"
        for item in assignments
    )
    return ";".join(pairs)


def approval_is_stale(event, visit=None):
    """Расстановка изменилась ПОСЛЕ отправки на согласование.

    Пустой снимок — «не отправляли», а не «не изменилась»: до отправки
    сравнивать не с чем, и баннер о повторном согласовании там был бы шумом.

    Объект не назван — отвечает ПЕРВЫЙ объект мероприятия: поля мероприятия
    остаются его видом до Ш-7 (см. `primary_visit_object`). Объектов нет
    вовсе — сравнивать не с чем и ответ «не изменилась».
    """
    if visit is None:
        visit = primary_visit_object(event)
    if visit is None:
        return False
    if visit.approval_snapshot == "":
        return False
    return visit.approval_snapshot != placement_signature(event, visit)


@transaction.atomic
def send_for_approval(event_id, *, visit_object_id=None):
    """Отправить расстановку объекта согласующим.

    До отправки маршрут — это список людей, а не процесс: решать им нечего.
    Отправка фиксирует СНИМОК расстановки — тот состав, под которым они
    подпишутся, — и выдаёт документу объекта СЛЕДУЮЩИЙ НОМЕР ВЕРСИИ: версия
    это то, под чем подписываются, и растёт она отправкой, а не каждым
    движением человека по постам.
    """
    event = lock_event(event_id)
    visit = _approval_target(event, visit_object_id)
    _require_stage(
        event,
        "APPROVAL",
        "Отправить на согласование можно только на этапе «Согласование».",
    )
    route = list(visit.approval_route or [])
    if not route:
        raise DomainError("APPROVAL_ROUTE_EMPTY", 422, message=
            "Маршрут согласования пуст — добавьте хотя бы одного согласующего.",
        )
    scoped_assignments = placement_signature(event, visit)
    if scoped_assignments == "":
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
    visit.approval_route = route
    visit.approval_snapshot = scoped_assignments
    visit.save(update_fields=["approval_route", "approval_snapshot", "updated_at"])
    # Версия документа (`[СОГ-04]`, Plane №398): черновик становится «на
    # согласовании» тем же номером; после возврата — N+1. Указатель
    # `document_version` ведёт сама история.
    _submit_document_version(event, visit)
    return event


@transaction.atomic
def withdraw_from_approval(event_id, *, visit_object_id=None):
    """Отозвать с согласования.

    Уже принятые решения не отменяются: согласовавший согласовал, вернувший
    вернул — стирать чужое решение отзывом значило бы переписывать историю.
    Снимок тоже остаётся: отзыв не меняет расстановку. Номер версии тоже: она
    уже уходила людям, и «откатить» её значило бы выдать двум разным составам
    один номер.
    """
    event = lock_event(event_id)
    visit = _approval_target(event, visit_object_id)
    _require_stage(
        event,
        "APPROVAL",
        "Отозвать с согласования можно только на этапе «Согласование».",
    )
    route = list(visit.approval_route or [])
    for item in route:
        if item.get("status") == "PENDING":
            item["status"] = "NOT_SENT"
    visit.approval_route = route
    visit.save(update_fields=["approval_route", "updated_at"])
    return event


@transaction.atomic
def move_approver(event_id, approver_id, *, direction, visit_object_id=None):
    """Переставить согласующего в маршруте на позицию вверх или вниз."""
    event = lock_event(event_id)
    visit = _approval_target(event, visit_object_id)
    if direction not in ("UP", "DOWN"):
        raise _validation({"direction": ["Допустимо UP или DOWN."]})
    route = list(visit.approval_route or [])
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
        visit.approval_route = route
        visit.save(update_fields=["approval_route", "updated_at"])
    return event


@transaction.atomic
def resolve_remark(
    event_id, remark_id, *, decision, response=None, visit_object_id=None
):
    """Решить замечание (`[ВОЗ-04]`): «Устранено» — ответ необязателен;
    «Не согласен» — ОБЯЗАТЕЛЕН, иначе замечание превращается в отказ без
    объяснения, и согласующий не узнает, почему старший не исправил.

    Возврат к «Открыто» — той же ручкой, `decision="OPEN"`: снятое решение не
    должно требовать отдельного пути, симметрично отзыву согласования.
    """
    event = lock_event(event_id)
    visit = _approval_target(event, visit_object_id)
    if decision not in _REMARK_STATUSES:
        raise _validation(
            {"decision": [f"Допустимо: {', '.join(_REMARK_STATUSES)}."]}
        )
    clean_response = str(response or "").strip()
    if decision == "DISAGREED" and clean_response == "":
        raise _validation({"response": ["Укажите, почему вы не согласны."]})
    remarks = list(visit.approval_remarks or [])
    found = False
    for item in remarks:
        if item.get("id") == remark_id:
            item["status"] = decision
            if decision == "OPEN":
                item["response"] = ""
                item["respondedAt"] = None
                item["resolvedInDocumentVersion"] = None
            else:
                item["response"] = clean_response
                item["respondedAt"] = _now_iso()
                item["resolvedInDocumentVersion"] = visit.document_version
            found = True
            break
    if not found:
        raise _not_found("Замечание не найдено.", remark_id)
    visit.approval_remarks = remarks
    visit.save(update_fields=["approval_remarks", "updated_at"])
    # Ответ на последнее открытое замечание — тоже «последняя подпись»
    # (`[СОГ-09]`): если все уже согласовали и держало только оно, этап
    # завершается сам.
    return _autocomplete_approval(event, visit)


def _approve_visit(event, visit):
    """Согласование ОБЪЕКТА: проверки эталона и переход на «Ознакомление».

    Общее тело для ручки `approval/approve/` и для АВТОЗАВЕРШЕНИЯ последней
    подписью (`[СОГ-09]`, Plane №399) — правила одни, и держать их в двух
    местах значило бы разойтись при первой правке.
    """
    # Условия завершения этапа — из эталона (задача заказчика «ОМ-37.3»).
    # Каждое отвечает на свой вопрос, поэтому и текст у каждого свой: «не
    # получилось» без причины не подсказывает, что чинить.
    route = list(visit.approval_route or [])
    if not route:
        raise DomainError("APPROVAL_ROUTE_EMPTY", 422, message=
            "Маршрут согласования пуст — добавьте согласующих и отправьте им "
            "расстановку.",
        )
    if approval_is_stale(event, visit):
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
    if any(
        item.get("status") == "OPEN"
        for item in (visit.approval_remarks or [])
    ):
        # `[ВОЗ-05]`: блокирует только ОТКРЫТОЕ, без ответа — «Не согласен» с
        # объяснением не хуже «Устранено», и держать этап из-за несогласия,
        # на которое уже ответили, значило бы наказывать за честный ответ.
        raise DomainError("APPROVAL_REMARKS_OPEN", 422, message=
            "Есть замечания без ответа — ответьте на них перед завершением "
            "этапа.",
        )
    visit.approval_status = "APPROVED"
    visit.approval_comment = ""
    visit.save(
        update_fields=["approval_status", "approval_comment", "updated_at"]
    )
    _decide_document_version(event, visit, "APPROVED")
    _sync_event_approval(event)
    # МЕРОПРИЯТИЕ ИДЁТ ДАЛЬШЕ, КОГДА СОГЛАСОВАНЫ ВСЕ ЕГО ОБЪЕКТЫ. Утверждение
    # переводит на «Ознакомление» ЭТОТ объект; мероприятие берёт наименьшую
    # стадию своих объектов и потому ждёт последнего (Plane №412).
    old_stage = event.stage
    advance_visits(event, "ACKNOWLEDGEMENT", visits=[visit])
    if event.stage != old_stage:
        record_transition(event, old_stage, event.stage)
    # Рассылка о заступлении САМА (Plane №402, `[ОЗН-01]`) — тем же движением,
    # что и переход на «Ознакомление», и для ручки, и для автозавершения
    # последней подписью (№399): общее тело — одна точка рассылки.
    if event.stage == "ACKNOWLEDGEMENT":
        _autonotify_acknowledgement(event)
    return event


def _autonotify_acknowledgement(event):
    """Разослать уведомления о заступлении САМИМ, без клика (Plane №402,
    `[ОЗН-01]`).

    До этого шага рассылка ждала ручную кнопку на этапе «Ознакомление» —
    заступающие узнавали о назначении, только если кто-то не забыл нажать.
    Утверждение расстановки уже переводит объект на этот этап без отдельного
    клика (см. комментарий выше); рассылка идёт тем же движением, а не
    отдельным решением человека.

    НЕ ПАДАЕТ НАРУЖУ. Согласование — то, что действительно произошло;
    рассылка — его следствие, и сбой следствия не должен откатывать причину.
    `PLACEMENT_EMPTY` (никто не назначен) — законное состояние: расстановку
    можно согласовать пустой, если недобор принят как есть, и тогда уведомлять
    некого — это не ошибка, а факт. Ручная кнопка на этапе остаётся: повторно
    оповестить того, кто сменился после первой рассылки, всё ещё нужно руками.
    """
    from organization_management.apps.ops.acknowledgement_notify import (
        notify_acknowledgement,
    )

    try:
        notify_acknowledgement(event.pk)
    except DomainError:
        pass


def _approval_ready(visit):
    """Можно ли завершить согласование объекта БЕЗ отказа — для автозавершения.

    Те же условия, что в `_approve_visit`, но ответом «да/нет», а не отказом:
    автозавершение не имеет права падать — оно побочный эффект подписи или
    ответа на замечание, и его отказ сорвал бы само действие человека.
    """
    route = list(visit.approval_route or [])
    if not route or any(item.get("status") != "APPROVED" for item in route):
        return False
    if any(item.get("status") == "OPEN" for item in (visit.approval_remarks or [])):
        return False
    return True


def _autocomplete_approval(event, visit):
    """`[СОГ-09]`: «Этап завершается автоматически последней подписью» —
    кнопки «Завершить этап» у согласующего нет (`[СОГ-11]`).

    Зовётся после решения согласующего и после ответа на замечание: последним
    действием может оказаться и ответ старшего (все подписи уже есть, держало
    только открытое замечание). Устаревшая расстановка автозавершение не
    проходит — `_approve_visit` откажет, и отказ здесь ГЛОТАЕТСЯ намеренно:
    подпись состоялась, а этап дождётся повторной отправки.
    """
    if event.stage != "APPROVAL" or not _approval_ready(visit):
        return event
    try:
        return _approve_visit(event, visit)
    except DomainError:
        return event


@transaction.atomic
def approve_placement(event_id, *, visit_object_id=None):
    """Ручка `approval/approve/` — ручное завершение (админ, API). У
    согласующего на экране такой кнопки больше нет (`[СОГ-11]`): его действие —
    подпись в маршруте, а этап закрывается сам (`[СОГ-09]`)."""
    event = lock_event(event_id)
    visit = _approval_target(event, visit_object_id)
    _require_stage(
        event,
        "APPROVAL",
        "Согласовать расстановку можно только на этапе «Согласование».",
    )
    return _approve_visit(event, visit)


def _return_visit(event, visit, comment):
    """Возврат ОБЪЕКТА на доработку: статус, версия документа, стадия.

    Общее тело для ручки `approval/return/` и для решения согласующего
    «Вернуть» в маршруте (`[СОГ-08]`, Plane №399): возврат подписанта — это
    и есть возврат объекта, второй кнопки для того же действия у него нет.
    """
    # 🔴 ЗАМЕЧАНИЕ ЗДЕСЬ НЕ ЗАВОДИТСЯ, И ЭТО РЕШЕНИЕ, А НЕ НЕДОСМОТР (Plane
    # №386). Структурированные замечания заводит решение согласующего в
    # маршруте (`decide_approver`, RETURNED). Общая причина возврата живёт в
    # `approval_comment`; заведи она свою запись в `approval_remarks`, та
    # осталась бы «Открыто» навсегда — ответить на «общую причину» нечем.
    visit.approval_status = "RETURNED"
    visit.approval_comment = comment
    # МАРШРУТ ОБНУЛЯЕТСЯ, ВСЕ ПОДПИСИ СНЯТЫ (`[ВОЗ-03]`, Plane №400): подпись
    # под возвращённым составом ничего не говорит о следующем — при повторной
    # отправке маршрут проходится заново с первого подписанта (`[ВОЗ-07]`).
    # Снимаются ПОДПИСИ («Согласовано» → «Не отправлено», автоподпись «Без
    # замечаний» стирается). Строка ВЕРНУВШЕГО остаётся `RETURNED` с причиной:
    # возврат — не подпись, а решение, из-за которого всё и обнулилось; его
    # причина объясняет, что чинили, и `send_for_approval` бережёт её именно
    # по этому статусу при повторной отправке.
    route = list(visit.approval_route or [])
    for item in route:
        if item.get("status") in ("APPROVED", "PENDING"):
            item["status"] = "NOT_SENT"
            item["decidedAt"] = None
            if item.get("comment") == "Без замечаний":
                item["comment"] = ""
    visit.approval_route = route
    visit.save(
        update_fields=[
            "approval_status", "approval_comment", "approval_route", "updated_at",
        ]
    )
    _decide_document_version(event, visit, "RETURNED")
    _sync_event_approval(event)
    # Уведомление старшему объекта и замещающим (`[ВОЗ-03]`) — следствие
    # возврата, и его сбой не откатывает сам возврат: рассылка «не дошла»
    # — состояние адресатов (нет учётки), а не ошибка решения.
    open_remarks = [
        r for r in (visit.approval_remarks or []) if r.get("status") == "OPEN"
    ]
    try:
        from organization_management.apps.ops.placement_return_notify import (
            notify_placement_returned,
        )

        notify_placement_returned(
            event,
            visit,
            comment=comment,
            remarks_open=len(open_remarks),
            urgent=any(bool(r.get("urgent")) for r in open_remarks),
        )
    except (DomainError, ValueError):
        pass
    # ВОЗВРАТ ОДНОГО ОБЪЕКТА ВОЗВРАЩАЕТ МЕРОПРИЯТИЕ. Здесь правило обратное
    # утверждению, и намеренно: согласование ждёт всех, а работа находится по
    # одному. Отдельного «вернуть мероприятие» не нужно — наименьшая стадия
    # объектов делает это сама: вернувшийся объект и есть наименьший.
    old_stage = event.stage
    advance_visits(event, "PLACEMENT", visits=[visit])
    if event.stage != old_stage:
        record_transition(event, old_stage, event.stage)
    return event


@transaction.atomic
def return_placement(event_id, *, comment, visit_object_id=None):
    event = lock_event(event_id)
    visit = _approval_target(event, visit_object_id)
    comment = str(comment or "").strip()
    if comment == "":
        raise _validation({"comment": ["Укажите причину возврата."]})
    _require_stage(
        event,
        "APPROVAL",
        "Вернуть на доработку можно только на этапе «Согласование».",
    )
    return _return_visit(event, visit, comment)


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
        # Роль наряда НАСЛЕДУЕТСЯ (Plane №239): замена меняет человека, а не
        # место в бланке — «водитель VIP» остаётся водителем VIP. Потерять её
        # здесь значило бы оставить место в документе пустым ровно тогда, когда
        # замену и делают: в день мероприятия.
        "roleCode": outgoing.get("roleCode"),
        # Секция НАСЛЕДУЕТСЯ по тому же доводу, что и роль (Plane №242):
        # замена меняет человека, а не место в бланке — «Ұлан-батор» остаётся
        # «Ұлан-батором». Потерять её здесь значило бы оставить место пустым
        # ровно тогда, когда замену и делают: в день мероприятия.
        "sectionCode": outgoing.get("sectionCode"),
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
    # Обход админа двигает ВСЕ объекты разом (Plane №412): он переводит
    # карточку целиком, а «половину объектов вперёд» никто не просил — такая
    # выборочность была бы решением, которого администратор не принимал.
    for visit in event.visit_objects.all():
        visit.stage = stage
        # Выход из закрытия снимает штамп и у объекта: закрытый объект в живом
        # мероприятии — то же враньё, что и закрытое мероприятие.
        if old_stage == "CLOSED":
            visit.closed_at = None
        visit.save(update_fields=["stage", "closed_at", "updated_at"])
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


def _finalize_event_closure(event, *, actor, old_stage):
    """Закрыть МЕРОПРИЯТИЕ: штамп, готовность, переход, оценивание, аудит.

    Общее тело для ручного `close_event` и для АВТОЗАКРЫТИЯ последним объектом
    (`[ЗАК-12]`, Plane №404): «мероприятие закрывается автоматически, когда
    закрыты все его объекты; в реестре „Закрыто · 100%“». Два пути — одни
    следствия, иначе автозакрытие не открывало бы оценивание или не писало бы
    аудит.
    """
    event.stage = "CLOSED"
    event.readiness_percent = STAGE_READINESS["CLOSED"]
    if event.closed_at is None:
        event.closed_at = Clock.now()
    event.save(update_fields=["stage", "readiness_percent", "closed_at", "updated_at"])
    if old_stage != "CLOSED":
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


@transaction.atomic
def close_visit_object(event_id, visit_object_id, *, actor, comment=""):
    """Закрыть ОБЪЕКТ посещения (`[ЗАК-05]`, Plane №404).

    Спецификация: «Кнопка „Закрыть объект“. Подтверждение: „… После закрытия
    изменения невозможны“». Итоговый комментарий по объекту — `[ЗАК-04]`,
    необязателен. Оценки и инциденты (`[ЗАК-02]`/`[ЗАК-03]`) этот шаг не
    заводит — их карточек в очереди нет; подтверждение «оценено K из N» на
    экране появится вместе с ними.

    Последний закрытый объект закрывает МЕРОПРИЯТИЕ (`[ЗАК-12]`): стадия
    мероприятия — наименьшая среди объектов, и «Закрыто» у всех даёт
    «Закрыто» у него; финал закрытия — тот же, что у ручного `close_event`.
    """
    event = lock_event(event_id)
    visit = _visit_object_or_404(event, visit_object_id)
    _require_stage(
        event, "CONDUCT", "Закрыть объект можно только на этапе «Проведение»."
    )
    if visit.stage == "CLOSED":
        raise DomainError(
            "VISIT_OBJECT_ALREADY_CLOSED",
            422,
            message="Объект уже закрыт — изменения после закрытия невозможны.",
        )
    visit.stage = "CLOSED"
    visit.closed_at = Clock.now()
    visit.closing_comment = str(comment or "").strip()
    visit.save(update_fields=["stage", "closed_at", "closing_comment", "updated_at"])
    audit_service.record(
        actor=actor,
        action=audit_service.VISIT_OBJECT_CLOSED,
        entity_type=audit_service.ENTITY_SECURITY_EVENT,
        entity_id=event.pk,
        new_value={
            "visitObjectId": str(visit.pk),
            "objectName": visit.object_name,
            "code": event.code,
            "comment": visit.closing_comment,
        },
    )
    old_stage = event.stage
    recompute_event_stage(event)
    if event.stage == "CLOSED":
        # Стадия уже «Закрыто» по объектам — финал (штамп, переход,
        # оценивание, аудит) делает то же, что ручное закрытие.
        _finalize_event_closure(event, actor=actor, old_stage=old_stage)
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
    # Закрывается мероприятие — значит закрыты и все его объекты (Plane №412):
    # закрытое ОМ с объектом «на расстановке» показывало бы работу, которой
    # больше нет. Обратный путь — «все объекты закрыты → закрыто мероприятие»
    # — `close_visit_object` (`[ЗАК-12]`, №404).
    closed_at = Clock.now()
    for visit in event.visit_objects.all():
        if visit.stage != "CLOSED":
            visit.stage = "CLOSED"
            visit.closed_at = visit.closed_at or closed_at
            visit.save(update_fields=["stage", "closed_at", "updated_at"])
    event.closure_direction_summaries = [
        {
            "direction": item.get("direction"),
            "summary": str(item.get("summary", "")).strip(),
        }
        for item in summaries
    ]
    event.closed_at = closed_at
    event.save(update_fields=["closure_direction_summaries", "closed_at", "updated_at"])
    return _finalize_event_closure(event, actor=actor, old_stage=old_stage)
