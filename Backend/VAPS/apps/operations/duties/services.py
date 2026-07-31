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

`approve_duty_plan()`/`cancel_duty_shift()`/`replan_duty_shift()` emit audit
rows (Story 14.12a) — HTTP layer/permission check remain 14.11's territory.

Story 14.12a: `AuditLog.entity_id` is a NOT NULL `UUIDField` (apps/audit/
models.py), but `DutyPlan`/`DutyShift` use plain integer PKs (14.5's own
docstring: not a deferred-FK reference table). `uuid.UUID(int=pk)`
deterministically embeds the integer into a valid UUID — the same technique
already sanctioned in this codebase for a different purpose (bulk_status_
service.py's `_BULK_SUMMARY_ENTITY_ID = uuid.UUID(int=0)` sentinel); here it
represents the REAL entity id, not a sentinel.
"""

import datetime
import uuid
from zoneinfo import ZoneInfo

from django.conf import settings
from django.db import transaction

from apps.audit.services import record
from apps.core.clock import Clock
from apps.core.exceptions import DomainError
from apps.operations.duties.models import DutyPlan, DutyShift
from apps.operations.statuses.conflict_matrix import ConflictSeverity, classify_pair
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


def approve_duty_plan(plan, *, actor):
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

    Story 14.12a: emits `DUTY_PLAN_APPROVED` only on a REAL DRAFT->APPROVED
    transition — a no-op re-approve (idempotent by design) leaves no
    duplicate audit trail for a status flip that didn't happen.

    Review (Edge Case Hunter, 14.12a): explicit non-empty `actor` guard,
    matching `cancel_duty_shift()`'s own — today `views.py::approve()` is
    the only caller and `require_permission()` already guarantees a
    non-empty `request.actor_id` before this runs, so this is defense-in-
    depth (symmetry with the sibling functions, not a live gap): without
    it, an empty actor would sail through the lock/status-flip/projection
    and only fail deep inside `record()`'s own `ValueError`, as a raw 500
    instead of a clean 400.
    """
    if not (actor or "").strip():
        raise DomainError("VALIDATION_ERROR", 400, message="actor обязателен.")
    with transaction.atomic():
        plan = DutyPlan.objects.select_for_update().get(pk=plan.pk)
        was_draft = plan.status_code != plan.StatusCode.APPROVED
        if was_draft:
            plan.status_code = plan.StatusCode.APPROVED
            plan.save(update_fields=["status_code", "updated_at"])
        # Review (Edge Case Hunter, 14.7): project_duty_shift() dereferences
        # shift.duty_type when set — select_related avoids an N+1 query per
        # shift for plans where most shifts carry a duty_type.
        for shift in plan.shifts.select_related("duty_type").all():
            project_duty_shift(shift)
        if was_draft:
            record(
                actor=actor,
                action="DUTY_PLAN_APPROVED",
                entity_type="duty_plan",
                entity_id=uuid.UUID(int=plan.pk),
                new_value={
                    "plan_id": plan.pk,
                    "object_id": plan.object_id,
                    "year": plan.year,
                    "month": plan.month,
                    "status_code": plan.status_code,
                },
            )
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
        # Story 14.12a: fires on EVERY real cancellation, including when
        # called internally by replan_duty_shift() below — the old shift
        # genuinely IS cancelled in the DB either way, so the audit trail
        # should show it either way. replan additionally emits its own
        # DUTY_SHIFT_REPLANNED after creating the new shift.
        record(
            actor=actor,
            action="DUTY_SHIFT_CANCELLED",
            entity_type="duty_shift",
            entity_id=uuid.UUID(int=shift.pk),
            reason=reason,
            new_value={
                "shift_id": shift.pk,
                "plan_id": shift.plan_id,
                "cancelled_by": actor,
            },
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
        # Review (Edge Case Hunter, 14.11e): use the RETURNED (locked,
        # re-fetched) shift, not the pre-lock instance passed in — mirrors
        # cancel_shift's own established idiom (views.py). Safe today either
        # way (cancel_duty_shift only mutates cancelled_at/by/reason, none of
        # which are in REPLANNABLE_FIELDS), but reading off the stale
        # pre-lock object is a latent trap if that invariant ever changes.
        shift = cancel_duty_shift(shift, actor=actor, reason=reason)

        values = {field: getattr(shift, field) for field in REPLANNABLE_FIELDS}
        values.update(new_fields)
        new_shift = DutyShift(plan=shift.plan, **values)
        new_shift.full_clean()
        new_shift.save()
        project_duty_shift(new_shift)

        # Story 14.12a: own audit row IN ADDITION TO cancel_duty_shift()'s
        # DUTY_SHIFT_CANCELLED (emitted above, inside the same call) — the
        # old-shift cancellation and the new-shift creation are both real,
        # distinct facts.
        record(
            actor=actor,
            action="DUTY_SHIFT_REPLANNED",
            entity_type="duty_shift",
            entity_id=uuid.UUID(int=new_shift.pk),
            reason=reason,
            old_value={"old_shift_id": shift.pk},
            new_value={"new_shift_id": new_shift.pk, "plan_id": new_shift.plan_id},
        )

    return new_shift


def validate_duty_plan(plan):
    """Story 14.11f: read-only conflict scan of a plan's (non-cancelled)
    shifts — no DB writes, no state transition. Narrow slice of the donor's
    full BR-DUTY-CONFLICT-001 checklist (assignments/workload/post-
    requirements have no supporting machinery yet — Story 16.3's territory);
    this checks only employee-availability overlap, reusing
    `conflict_matrix.classify_pair()` (3.4/14.8) — the same pure classifier
    `status_service._assert_no_conflict()` uses for manual statuses.

    Each shift is checked against two candidate sources of overlap:
    - other non-cancelled shifts of the SAME employee in THIS plan (no DB
      constraint enforces this — DutyShift isn't unique per employee/time);
    - existing live `EmployeeStatus` rows of the employee (hard-block
      statuses, or DUTY/REST_AFTER_DUTY projections from OTHER, already-
      approved plans), excluding rows ANY shift of THIS plan itself projects
      (relevant only if the plan is already APPROVED and re-validated —
      review, Blind Hunter: excluding only the current shift's own refs
      would leave a SIBLING shift's projection visible as a status-overlap
      candidate, double-reporting the exact same conflict the shift-vs-shift
      loop above already catches, once directly and once via its projection).

    Deliberately calls `classify_pair()` directly rather than
    `detect_conflicts()`: the latter's PLANNED/WARNING split exists to
    downgrade a not-yet-started SOFT conflict to a non-blocking warning for
    a *mutating* call (FR-10) — irrelevant here, since `validate` never
    blocks anything; every non-COMPATIBLE overlap is simply reported.
    """
    conflicts = []
    shifts = list(plan.shifts.filter(cancelled_at__isnull=True))
    plan_own_refs = [
        ref
        for s in shifts
        for ref in (f"DUTY:{s.pk}", f"REST_AFTER_DUTY:{s.pk}", f"BEFORE_DUTY:{s.pk}")
    ]
    for shift in shifts:
        shift_start, shift_end = _to_date_range(shift.starts_at, shift.ends_at)
        candidates = []
        for other in shifts:
            if other.pk == shift.pk or other.employee_id != shift.employee_id:
                continue
            if shift.starts_at < other.ends_at and shift.ends_at > other.starts_at:
                candidates.append(
                    {"status_type_code": "DUTY", "other_shift_id": other.pk}
                )

        overlapping_statuses = EmployeeStatus.objects.filter(
            employee_id=shift.employee_id,
            cancelled_at__isnull=True,
            date_start__lt=shift_end,
            date_end__gt=shift_start,
        ).exclude(source_ref__in=plan_own_refs)
        for status_type_code in overlapping_statuses.values_list(
            "status_type_code", flat=True
        ):
            candidates.append(
                {"status_type_code": status_type_code, "other_shift_id": None}
            )

        for candidate in candidates:
            other_type = candidate["status_type_code"]
            severity = classify_pair("DUTY", other_type)
            if severity is ConflictSeverity.COMPATIBLE:
                continue
            if candidate["other_shift_id"] is not None:
                message = (
                    f"Смена пересекается с другой сменой того же сотрудника "
                    f"(id={candidate['other_shift_id']})."
                )
            else:
                message = (
                    f"Смена пересекается со статусом {other_type} "
                    f"того же сотрудника."
                )
            conflicts.append(
                {
                    "shift_id": shift.pk,
                    "employee_id": shift.employee_id,
                    "conflict_code": f"OVERLAP_{other_type}",
                    "severity": severity.value,
                    "message": message,
                }
            )
    return conflicts
