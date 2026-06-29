"""Story 2.5 — dismissal status-close + cross-context orchestrator.

Lives in operations because core ↛ operations (ARCH-004): operations may
call core, never the reverse. The orchestrator composes the core dismissal
(archive card + close division interval + free slot → Vacancy) with the
operations-side status truncation, atomically.
"""

from django.core.exceptions import ValidationError
from django.db import transaction

from apps.audit.services import record
from apps.core.clock import Clock
from apps.core.services import dismiss_employee as _dismiss_core
from apps.operations.statuses.models import EmployeeStatus, Secondment


def _employee_snapshot(employee):
    """JSON-safe snapshot of an Employee for the EMPLOYEE_DISMISSED audit event
    (story 4.7) — mirrors ``status_service._status_snapshot``: ``entity_id`` of the
    audit row is ``employee.id`` (UUID); ``date``/``datetime`` → str/isoformat for a
    stable, readable before/after diff."""
    return {
        "employee_id": str(employee.id),
        "employment_status": employee.employment_status,
        "is_active": employee.is_active,
        "dismissal_date": (
            str(employee.dismissal_date) if employee.dismissal_date else None
        ),
        "separated_at": (
            employee.separated_at.isoformat() if employee.separated_at else None
        ),
    }


@transaction.atomic
def close_active_statuses_on(employee_id, *, on_date, actor: str) -> int:
    """Truncate an employee's active statuses spanning D to end on D (AC-2).

    An active (``cancelled_at IS NULL``) status whose interval spans D
    (``date_start < D < date_end``) is shortened to ``date_end = D``
    (half-open → active through D-1). Statuses starting on/after D
    (``date_start >= D``) are left to the status-lifecycle machinery
    (cancel + by/reason — story 3.6); truncating them to D would violate
    ``date_start < date_end``. The UPDATE only SHRINKS the period, so the
    hard-status ExclusionConstraint cannot be newly violated.

    Returns the number of statuses truncated. ``actor`` is required (the
    "always a real identity" convention); the structured fixation trail
    (truncated_by/reason) is story 3.6 — no column for it yet.
    """
    if not actor or not actor.strip():
        raise ValidationError("actor must be a non-empty string")
    statuses = EmployeeStatus.objects.select_for_update().filter(
        employee_id=employee_id,
        cancelled_at__isnull=True,
        date_start__lt=on_date,
        date_end__gt=on_date,
    )
    closed = 0
    for status in statuses:
        status.date_end = on_date
        status.full_clean()
        status.save(update_fields=["date_end", "updated_at"])
        closed += 1
    return closed


@transaction.atomic
def dismiss_employee(employee, *, date, reason=None, actor: str) -> dict:
    """Full cross-context dismissal (story 2.5, Shape B), atomic.

    core dismiss_employee (archive + interval + slot→Vacancy) then truncate
    active statuses. Story 3.11 (FR-15): a dismissed employee mid-secondment has
    BOTH legs truncated by close_active_statuses_on above; here we stamp the live
    Secondment closed (append-once confirmed fact) so pair-state stays coherent
    with its now-dead legs — a system close, no operator request/confirm.
    """
    # Snapshot the WORKING card before any mutation. _dismiss_core re-fetches the
    # employee via select_for_update and mutates THAT instance, so the passed-in
    # `employee` stays stale (WORKING) in memory — take the returned instance for
    # the after-snapshot (story 4.7).
    before = _employee_snapshot(employee)
    core_emp = _dismiss_core(employee, date=date, reason=reason, actor=actor)
    closed = close_active_statuses_on(employee.id, on_date=date, actor=actor)
    secondments_closed = 0
    for sec in Secondment.objects.select_for_update().filter(
        employee_id=employee.id, return_confirmed_at__isnull=True
    ):
        # close_active_statuses_on above truncated only spanning ACTIVE legs
        # (date_start < D < date_end); a not-yet-started leg (date_start >= D,
        # i.e. PLANNED or same-day-start) is left live. Append-once cancel it so
        # the closed pair never references a live leg.
        for leg in (sec.out_status, sec.in_status):
            if leg.cancelled_at is None and leg.date_start >= date:
                leg.cancelled_at = Clock.now()
                leg.cancelled_by = actor
                leg.cancelled_reason = "увольнение сотрудника"
                leg.save(
                    update_fields=[
                        "cancelled_at",
                        "cancelled_by",
                        "cancelled_reason",
                        "updated_at",
                    ]
                )
        sec.return_confirmed_at = Clock.now()
        sec.return_confirmed_by = actor
        sec.save(
            update_fields=[
                "return_confirmed_at",
                "return_confirmed_by",
                "updated_at",
            ]
        )
        secondments_closed += 1
    # ONE composite event for the whole dismissal (mirror of SECONDMENT_RETURNED,
    # 4.4): the truncated statuses / cancelled legs go through direct .save(), not
    # the lifecycle helpers, so they emit NO per-row events — their counts ride in
    # new_value. Written in this @transaction.atomic → rolls back if the dismissal does.
    record(
        actor=actor,
        action="EMPLOYEE_DISMISSED",
        entity_type="employee",
        entity_id=employee.id,
        old_value=before,
        new_value={
            **_employee_snapshot(core_emp),
            "statuses_truncated": closed,
            "secondments_closed": secondments_closed,
        },
        reason=reason or "",  # основание приказа (восстановимость «почему уволен»)
    )
    return {
        "employee_id": employee.id,
        "statuses_closed": closed,
        "secondments_closed": secondments_closed,
    }
