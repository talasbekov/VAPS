"""Story 14.6: OM_AUTO projection service (BR-017 — DUTY/REST_AFTER_DUTY).

Deliberately does NOT reuse `apps.operations.statuses.services.status_service
.create_status()`: that function forces `source=USER` (its own docstring:
"projection-owned rows are written by operations, never here") and runs
employee hire/dismissal-boundary + conflict validations BR-017 does not ask
for. This module is the single OM_AUTO writer — it constructs `EmployeeStatus`
rows directly, idempotent by `source_ref`.

`duties` importing `apps.operations.statuses` is sanctioned: ARCH-003 only
forbids `operations` importing `apps.core.models` directly
(`apps/operations/tests/test_isolation.py`), and there is no guard against
one operations subdomain importing another (same class as `duties`'s
existing FK into `facilities`, story 14.5).

`approve_duty_plan()` is a plain domain transition — no HTTP layer,
permission check, or audit logging. Those are 14.11's territory.
"""

import datetime

from apps.operations.statuses.models import EmployeeStatus

REST_AFTER_DUTY_HOURS = 24


def _to_date_range(starts_at, ends_at):
    """Convert a half-open datetime interval to a half-open calendar-date
    interval `[date_start, date_end)` (ARCH-DATA-023).

    A single-day interval `[D, D+1)` is valid (status_service's own
    `_validate_interval` comment). `ends_at` lands on the NEXT calendar day
    unless it falls exactly on midnight (i.e. the interval doesn't actually
    touch that day).
    """
    date_start = starts_at.date()
    if ends_at.time() == datetime.time(0, 0):
        date_end = ends_at.date()
    else:
        date_end = ends_at.date() + datetime.timedelta(days=1)
    return date_start, date_end


def project_duty_shift(shift):
    """BR-017: project one `DutyShift` into DUTY + REST_AFTER_DUTY
    `EmployeeStatus` rows, source=OM_AUTO, idempotent by `source_ref`.
    """
    duty_start, duty_end = _to_date_range(shift.starts_at, shift.ends_at)
    EmployeeStatus.objects.get_or_create(
        source_ref=f"DUTY:{shift.pk}",
        defaults={
            "employee_id": shift.employee_id,
            "status_type_code": "DUTY",
            "date_start": duty_start,
            "date_end": duty_end,
            "source": EmployeeStatus.Source.OM_AUTO,
        },
    )

    rest_starts_at = shift.ends_at
    rest_ends_at = shift.ends_at + datetime.timedelta(hours=REST_AFTER_DUTY_HOURS)
    rest_start, rest_end = _to_date_range(rest_starts_at, rest_ends_at)
    EmployeeStatus.objects.get_or_create(
        source_ref=f"REST_AFTER_DUTY:{shift.pk}",
        defaults={
            "employee_id": shift.employee_id,
            "status_type_code": "REST_AFTER_DUTY",
            "date_start": rest_start,
            "date_end": rest_end,
            "source": EmployeeStatus.Source.OM_AUTO,
        },
    )


def approve_duty_plan(plan):
    """BR-017: DRAFT->APPROVED transition + projection of every shift in the
    plan. Idempotent — re-approving an already-APPROVED plan is a no-op for
    the status_code flip; `project_duty_shift()`'s own idempotency covers
    re-running the projection.
    """
    if plan.status_code != plan.StatusCode.APPROVED:
        plan.status_code = plan.StatusCode.APPROVED
        plan.save(update_fields=["status_code", "updated_at"])
    for shift in plan.shifts.all():
        project_duty_shift(shift)
