"""Этап «Ознакомление» — напоминания и завершение с подтверждением
(Plane №432, `[ОЗН-03]` `[ОЗН-04]`, Ш-16 плана P2).

Отдельный модуль рядом с `acknowledgement_notify` (рассылка при открытии
этапа, №402): напоминание — та же нотификация, но адресная и по требованию
старшего; завершение с недобором — решение старшего с комментарием, которое
пишется в журнал мутаций, а не молчаливый обход гварда.
"""
from django.db import transaction

from organization_management.apps.operations import audit_service, notify_service
from organization_management.apps.operations.exceptions import DomainError
from organization_management.apps.ops.acknowledgement_notify import (
    KIND,
    _division_of,
    _employee_users,
    _supervisor_users,
)
from organization_management.apps.ops.security_events import (
    _advance,
    _now_iso,
    _require_stage,
    lock_event,
)


def _pending(event):
    """Не подтвердившие: без отметки и без отказа. Отказавшийся — не
    «ожидает», ему напоминать нечего, его заменяют."""
    return [
        a
        for a in (event.placement_assignments or [])
        if a.get("acknowledgedAt") is None and a.get("declinedAt") is None
    ]


def _payload(event, reminder=True):
    return {
        "eventId": str(event.pk),
        "eventCode": event.code,
        "eventTitle": event.title,
        "businessDate": event.business_date.isoformat(),
        "objectName": event.object_name,
        "reminder": reminder,
    }


def _send(event, assignments):
    employee_ids = [str(a.get("employeeId")) for a in assignments if a.get("employeeId") is not None]
    users = _employee_users(employee_ids)
    divisions = _division_of(employee_ids)
    supervisors = _supervisor_users(set(divisions.values()))
    payload = _payload(event)
    sent, unlinked = set(), []
    for employee_id in employee_ids:
        user_id = users.get(employee_id)
        if user_id is None:
            unlinked.append(employee_id)
            continue
        notify_service.notify(user_id, KIND, event.business_date, payload)
        sent.add(user_id)
    for user_id in supervisors - sent:
        notify_service.notify(
            user_id, KIND, event.business_date, {**payload, "asSupervisor": True}
        )
    return {
        "employees": len(sent),
        "supervisors": len(supervisors - sent),
        "unlinkedEmployeeIds": unlinked,
        "remindedAssignmentIds": [str(a.get("id")) for a in assignments],
    }


@transaction.atomic
def remind_assignment(event_id, assignment_id):
    """«Напомнить» одному: назначенному и его руководителям."""
    event = lock_event(event_id)
    _require_stage(event, "ACKNOWLEDGEMENT", "Напоминания уходят на этапе «Ознакомление».")
    row = next(
        (a for a in (event.placement_assignments or []) if str(a.get("id")) == str(assignment_id)),
        None,
    )
    if row is None:
        raise DomainError("ENTITY_NOT_FOUND", 404, detail={"id": str(assignment_id)}, message="Назначение не найдено.")
    if row.get("acknowledgedAt") is not None:
        raise DomainError("ALREADY_ACKNOWLEDGED", 422, message="Сотрудник уже подтвердил ознакомление — напоминать нечего.")
    report = _send(event, [row])
    _mark_reminded(event, [row])
    return report


@transaction.atomic
def remind_pending(event_id):
    """«Напомнить всем, кто не подтвердил»."""
    event = lock_event(event_id)
    _require_stage(event, "ACKNOWLEDGEMENT", "Напоминания уходят на этапе «Ознакомление».")
    pending = _pending(event)
    if not pending:
        raise DomainError("NOTHING_TO_REMIND", 422, message="Все назначенные уже подтвердили — напоминать некому.")
    report = _send(event, pending)
    _mark_reminded(event, pending)
    return report


def _mark_reminded(event, rows):
    """Момент последнего напоминания — в строке назначения: старший видит,
    что уже напоминал, и когда."""
    ids = {str(a.get("id")) for a in rows}
    now = _now_iso()
    event.placement_assignments = [
        {**a, "remindedAt": now} if str(a.get("id")) in ids else a
        for a in (event.placement_assignments or [])
    ]
    event.save(update_fields=["placement_assignments", "updated_at"])


@transaction.atomic
def complete(event_id, *, force=False, comment="", actor=None):
    """«Завершить ознакомление». Подтвердили все — переход; нет — только с
    явным `force` и комментарием старшего, и это ложится в журнал мутаций
    вместе с числом неподтвердивших (`[ОЗН-04]`)."""
    event = lock_event(event_id)
    _require_stage(event, "ACKNOWLEDGEMENT", "Ознакомление можно завершить только на этапе «Ознакомление».")
    unconfirmed = [
        a for a in (event.placement_assignments or []) if a.get("acknowledgedAt") is None
    ]
    if unconfirmed and not force:
        raise DomainError(
            "ACKNOWLEDGEMENT_INCOMPLETE", 422,
            detail={"unconfirmed": len(unconfirmed)},
            message="Не все назначенные сотрудники подтвердили ознакомление.",
        )
    text = str(comment or "").strip()
    if unconfirmed and not text:
        raise DomainError(
            "VALIDATION_ERROR", 400,
            detail={"comment": ["Укажите, почему этап завершается без подтверждения всех."]},
            message="Проверьте заполнение формы.",
        )
    # Актор доезжает до открытия оценивания (Plane №642): задания оценщика
    # адресуются учётной записи, и заведённые «ничьими» не попадали в очередь
    # ни к кому — а заводятся они ровно здесь, входом в этап 5.
    event = _advance(event, "CONDUCT", actor=actor)
    if unconfirmed:
        audit_service.record(
            actor=actor,
            action=audit_service.SECURITY_EVENT_ACKNOWLEDGEMENT_FORCED,
            entity_type=audit_service.ENTITY_SECURITY_EVENT,
            entity_id=event.pk,
            old_value={"stage": "ACKNOWLEDGEMENT", "unconfirmed": len(unconfirmed)},
            new_value={"stage": "CONDUCT", "comment": text},
        )
    return event
