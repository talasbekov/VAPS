"""Story 2.5 — dismissal status-close + cross-context orchestrator.

Lives in operations because core ↛ operations (ARCH-004): operations may
call core, never the reverse. The orchestrator composes the core dismissal
(archive card + close division interval + free slot → Vacancy) with the
operations-side status truncation, atomically.
"""

from django.core.exceptions import ValidationError
from django.db import transaction

from apps.core.services import dismiss_employee as _dismiss_core
from apps.operations.statuses.models import EmployeeStatus


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
    active statuses. Forward-hook (AC-3): synchronous close of PAIRED
    secondment statuses at the receiving division is deferred to 3.10/3.11
    — no secondment-pair model exists yet to traverse.
    """
    _dismiss_core(employee, date=date, reason=reason, actor=actor)
    closed = close_active_statuses_on(employee.id, on_date=date, actor=actor)
    return {"employee_id": employee.id, "statuses_closed": closed}
