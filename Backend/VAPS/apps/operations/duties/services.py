"""Story 14.6/14.7: OM_AUTO projection service (BR-017 — DUTY/REST_AFTER_DUTY;
BR-DUTY-TYPE-003 — BEFORE_DUTY).

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
from zoneinfo import ZoneInfo

from django.conf import settings

from apps.operations.statuses.models import EmployeeStatus

REST_AFTER_DUTY_HOURS = 24


def _to_date_range(starts_at, ends_at):
    """Convert a half-open datetime interval to a half-open calendar-date
    interval `[date_start, date_end)` (ARCH-DATA-023).

    Review (Edge Case Hunter): calendar dates must be derived in the
    project's local business timezone, same as `Clock.today_local()`
    (`apps.core.clock`) — never straight off a UTC-stored DateTimeField's
    `.date()`/`.time()`. A shift stored as e.g. local 00:30-08:30
    Asia/Qyzylorda (+05) is 19:30-03:30 UTC; reading `.date()` on the raw
    UTC value would silently put the projected status on the wrong
    calendar day whenever the shift crosses the UTC day boundary.

    A single-day interval `[D, D+1)` is valid (status_service's own
    `_validate_interval` comment). `ends_at` lands on the NEXT calendar day
    unless it falls exactly on local midnight (i.e. the interval doesn't
    actually touch that day).
    """
    local_tz = ZoneInfo(settings.VAPS_LOCAL_TIMEZONE)
    local_start = starts_at.astimezone(local_tz)
    local_end = ends_at.astimezone(local_tz)
    date_start = local_start.date()
    if local_end.time() == datetime.time(0, 0):
        date_end = local_end.date()
    else:
        date_end = local_end.date() + datetime.timedelta(days=1)
    return date_start, date_end


def project_duty_shift(shift):
    """BR-017/BR-DUTY-TYPE-003: project one `DutyShift` into DUTY +
    REST_AFTER_DUTY (+ BEFORE_DUTY when applicable) `EmployeeStatus` rows,
    source=OM_AUTO, idempotent by `source_ref`.
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

    # Story 14.7 / BR-DUTY-TYPE-003: "before_duty_minutes > 0 creates
    # BEFORE_DUTY projection" — donor reserves this "until customer
    # decision" (OQ-010); customer confirmed building it in MVP at 14.7's
    # create-story. Symmetric to REST_AFTER_DUTY: starts before_duty_minutes
    # before the shift, ends at the shift's own start.
    if shift.duty_type_id and shift.duty_type.before_duty_minutes > 0:
        before_starts_at = shift.starts_at - datetime.timedelta(
            minutes=shift.duty_type.before_duty_minutes
        )
        before_ends_at = shift.starts_at
        before_start, before_end = _to_date_range(before_starts_at, before_ends_at)
        EmployeeStatus.objects.get_or_create(
            source_ref=f"BEFORE_DUTY:{shift.pk}",
            defaults={
                "employee_id": shift.employee_id,
                "status_type_code": "BEFORE_DUTY",
                "date_start": before_start,
                "date_end": before_end,
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
    # Review (Edge Case Hunter, 14.7): project_duty_shift() dereferences
    # shift.duty_type when set — select_related avoids an N+1 query per
    # shift for plans where most shifts carry a duty_type.
    for shift in plan.shifts.select_related("duty_type").all():
        project_duty_shift(shift)
