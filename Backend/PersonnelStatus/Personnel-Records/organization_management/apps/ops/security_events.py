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
def create_event(*, title, object_id, business_date, business_date_end=None, actor):
    field_errors = {}
    title = str(title or "").strip()
    if title == "":
        field_errors["title"] = ["Обязательное поле."]
    object_id = str(object_id or "").strip()
    if object_id == "":
        field_errors["objectId"] = ["Обязательное поле."]
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
    security_object = None
    if not field_errors:
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
    # Номер — порядковый по реестру (порт мока: count+1). Гонку двух создателей
    # останавливает уникальность кода: проигравший получает конверт по
    # CONSTRAINT_ERROR_MAP, а не второй такой же номер.
    number = OpsSecurityEvent.objects.count() + 1
    binding = None
    applicable = resolve_applicable_version(security_object, parsed_date)
    if applicable is not None:
        binding = bind_passport_version(security_object, applicable, now)
    event = OpsSecurityEvent.objects.create(
        code=f"ОМ-{parsed_date.year}-{number}",
        title=title,
        security_object=security_object,
        object_name=security_object.name,
        passport_binding=binding,
        business_date=parsed_date,
        business_date_end=parsed_end,
        stage="BULLETIN",
        readiness_percent=STAGE_READINESS["BULLETIN"],
        force_need=0,
        conflicts_count=0,
        owner_name=actor,
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
    record_transition(event, None, "BULLETIN")
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
    if event.brief_description.strip() == "" or event.initial_tasks.strip() == "":
        raise DomainError("BULLETIN_INCOMPLETE", 422, message=
            "Заполните и сохраните описание и первичные задачи, прежде чем "
            "завершать этап.",
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
def update_recon(event_id, *, checklist, sector_posts):
    event = lock_event(event_id)
    checklist = checklist or []
    sector_posts = sector_posts or []
    field_errors = {}
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
    event.save(
        update_fields=["recon_checklist", "recon_sector_posts", "updated_at"]
    )
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


@transaction.atomic
def assign_placement(event_id, *, post_id, employee_id, override, override_reason):
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
    return event


@transaction.atomic
def unassign_placement(event_id, assignment_id):
    event = lock_event(event_id)
    event.placement_assignments = [
        a for a in event.placement_assignments if a.get("id") != assignment_id
    ]
    event.save(update_fields=["placement_assignments", "updated_at"])
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
