"""Story 14.6/14.7/14.9a/14.9b: OM_AUTO projection service (BR-017 —
DUTY/REST_AFTER_DUTY; BR-DUTY-TYPE-003 — BEFORE_DUTY) + cancel + replan.

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
from django.db import transaction

from apps.core.clock import Clock
from apps.core.exceptions import DomainError
from apps.operations.duties.models import DutyPlan, DutyShift
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

    Review (Edge Case Hunter, 14.11c): a cancelled shift (14.9a) must never
    be (re-)projected — `approve_duty_plan()` re-approving a plan after one
    of its shifts was cancelled would otherwise silently resurrect the
    exact `EmployeeStatus` rows `cancel_duty_shift()` deleted, undoing the
    cancellation. Guarded HERE (not just in the caller) so every present
    and future caller of this function is protected, not only
    `approve_duty_plan()`.
    """
    if shift.cancelled_at is not None:
        return
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

    Review (Edge Case Hunter, 14.11c): wrapped in `transaction.atomic()` +
    `select_for_update()` on the plan row, matching `cancel_duty_shift()`/
    `replan_duty_shift()`'s own pattern — this endpoint is now reachable
    over HTTP (14.11c), where two overlapping requests for the same plan
    are a real possibility (double-click, client retry-on-timeout), not
    just a sequential test/script call. `EmployeeStatus.source_ref` has no
    DB-level unique constraint (that belongs to a different app/epic), so
    `get_or_create()` alone is not race-safe; the lock serializes
    concurrent approvers of the SAME plan onto the same execution, closing
    the window without touching `EmployeeStatus`'s schema.
    """
    with transaction.atomic():
        plan = DutyPlan.objects.select_for_update().get(pk=plan.pk)
        if plan.status_code != plan.StatusCode.APPROVED:
            plan.status_code = plan.StatusCode.APPROVED
            plan.save(update_fields=["status_code", "updated_at"])
        # Review (Edge Case Hunter, 14.7): project_duty_shift() dereferences
        # shift.duty_type when set — select_related avoids an N+1 query per
        # shift for plans where most shifts carry a duty_type.
        for shift in plan.shifts.select_related("duty_type").all():
            project_duty_shift(shift)
    return plan


def cancel_duty_shift(shift, *, actor, reason):
    """Story 14.9a: cancel a duty shift — removes its projected `DUTY`/
    `REST_AFTER_DUTY`/`BEFORE_DUTY` `EmployeeStatus` rows outright (they are
    derivative data, not an append-once fact — the shift itself is the
    source of truth) and records an append-once cancel fact on `DutyShift`
    (mirrors `EmployeeStatus`'s own cancelled_at/by/reason shape).

    Does NOT go through `status_service.cancel_status()`: `EmployeeStatus
    .assert_user_editable()` unconditionally rejects any non-USER row, not
    a state gate — the only architecturally consistent path is a direct
    OM_AUTO write, same as `project_duty_shift()`.
    """
    if not (actor or "").strip():
        raise DomainError("VALIDATION_ERROR", 400, message="actor обязателен.")
    if not (reason or "").strip():
        raise DomainError(
            "VALIDATION_ERROR",
            400,
            detail={"field": "reason"},
            message="При отмене дежурства обязательна непустая причина.",
        )

    # Review (Blind Hunter/Edge Case Hunter, independently confirmed): the
    # delete + save must commit or roll back together — mirrors every
    # comparable lifecycle mutation in status_service.py (create_status/
    # cancel_status/update_status, all @transaction.atomic). Without this,
    # a failure between the two statements could delete the projected
    # statuses while leaving the shift not marked cancelled.
    #
    # Review (Edge Case Hunter, 14.11d): re-fetch under select_for_update()
    # and re-check the lifecycle guards against the LOCKED row — mirrors
    # approve_duty_plan()'s same fix (14.11c). Without this, two concurrent
    # cancel calls (now HTTP-reachable) could both read cancelled_at=None
    # before either commits, and the second save() would silently
    # overwrite the first's cancel facts instead of raising 422.
    with transaction.atomic():
        shift = DutyShift.objects.select_for_update().get(pk=shift.pk)
        if shift.cancelled_at is not None:
            raise DomainError(
                "INVALID_LIFECYCLE_TRANSITION",
                422,
                message="Дежурство уже отменено.",
            )
        local_tz = ZoneInfo(settings.VAPS_LOCAL_TIMEZONE)
        shift_start_date = shift.starts_at.astimezone(local_tz).date()
        if shift_start_date <= Clock.today_local():
            raise DomainError(
                "INVALID_LIFECYCLE_TRANSITION",
                422,
                message="Нельзя отменить уже начавшееся или прошедшее дежурство.",
            )

        EmployeeStatus.objects.filter(
            source_ref__in=[
                f"DUTY:{shift.pk}",
                f"REST_AFTER_DUTY:{shift.pk}",
                f"BEFORE_DUTY:{shift.pk}",
            ],
            source=EmployeeStatus.Source.OM_AUTO,
        ).delete()

        shift.cancelled_at = Clock.now()
        shift.cancelled_by = actor
        shift.cancelled_reason = reason
        shift.save(
            update_fields=[
                "cancelled_at",
                "cancelled_by",
                "cancelled_reason",
                "updated_at",
            ]
        )
    return shift


REPLANNABLE_FIELDS = (
    "employee_id",
    "post",
    "duty_type",
    "duty_role_code",
    "notes",
    "starts_at",
    "ends_at",
)


def replan_duty_shift(shift, *, actor, reason, **new_fields):
    """Story 14.9b: replan a duty shift — cancel the OLD shift (14.9a's
    `cancel_duty_shift`, reusing its actor/reason/already-cancelled/
    already-started guards verbatim, not duplicated here) and create a NEW
    `DutyShift` in the SAME plan with `new_fields` applied over the old
    shift's values, then project it (`project_duty_shift`). Returns the
    new shift.

    Not an in-place edit: `project_duty_shift()`'s `get_or_create` never
    updates an existing `EmployeeStatus` row, so editing `starts_at`/
    `ends_at` in place would leave stale projected dates (the exact class
    of bug reviews caught in 14.6/14.7) — and 14.9a already established an
    append-once/immutable-history pattern for cancellation that an
    in-place edit would break.

    `new_fields` is a closed whitelist (`REPLANNABLE_FIELDS`) — `plan` is
    deliberately excluded, replan stays within the same `DutyPlan` (moving
    a shift across plans/months is a separate, unscoped concern).
    """
    unknown = set(new_fields) - set(REPLANNABLE_FIELDS)
    if unknown:
        raise DomainError(
            "VALIDATION_ERROR",
            400,
            detail={"fields": sorted(unknown)},
            message=f"Недопустимые поля перепланирования: {sorted(unknown)}.",
        )

    with transaction.atomic():
        cancel_duty_shift(shift, actor=actor, reason=reason)

        values = {field: getattr(shift, field) for field in REPLANNABLE_FIELDS}
        values.update(new_fields)
        new_shift = DutyShift(plan=shift.plan, **values)
        new_shift.full_clean()
        new_shift.save()
        project_duty_shift(new_shift)

    return new_shift
