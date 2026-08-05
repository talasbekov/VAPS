"""Story 15.2b: `issue_bulletin()` — DRAFT->BULLETIN transition for
`SecurityEvent` (FR-21).

Deliberately STRICT, unlike `apps.operations.duties.services
.approve_duty_plan()` (permissive — any non-APPROVED status is treated as
"draft" and flipped): `BULLETIN` is the first step in `SecurityEvent`'s
10-state LINEAR lifecycle (15.1's enum), not a re-reachable terminal state
like `DutyPlan.APPROVED`. A call from any status other than DRAFT/BULLETIN
(e.g. RECON+) is a real state conflict, not a no-op — raises
INVALID_LIFECYCLE_TRANSITION (422), the same registry code
`cancel_duty_shift()` already uses for an equivalent "wrong state for this
transition" conflict.

Idempotent on DRAFT->BULLETIN specifically: a replay call while already
BULLETIN is a no-op (200, no duplicate audit row) — mirrors
`approve_duty_plan()`'s `was_draft`-guard shape.
"""

import datetime
import hashlib
import json
import uuid
from decimal import Decimal
from zoneinfo import ZoneInfo

from django.conf import settings
from django.core.exceptions import ObjectDoesNotExist
from django.db import transaction
from django.db.models import Q

from apps.audit.services import record
from apps.core.clock import Clock
from apps.core.exceptions import DomainError
from apps.core.selectors import CoreEmployeeSelector
from apps.notifications.models import Notification
from apps.notifications.services import notify
from apps.operations.events.models import (
    AssignmentVersion,
    Group,
    GroupForceRequest,
    JournalEntry,
    PlacementAssignment,
    PlacementAssignmentActual,
    SecurityEvent,
    SecurityEventChecklistItem,
    SecurityEventClosureSummary,
    SecurityEventSectorPost,
    SecurityEventStaffingDemand,
    ServiceHours,
)
from apps.operations.duties.services import _to_date_range
from apps.operations.events.selectors import find_replacement_candidates
from apps.operations.facilities.models import Post
from apps.operations.rbac.models import UserRole
from apps.operations.statuses.models import EmployeeStatus


def issue_bulletin(event, *, actor):
    if not (actor or "").strip():
        raise DomainError("VALIDATION_ERROR", 400, message="actor обязателен.")
    with transaction.atomic():
        event = SecurityEvent.objects.select_for_update().get(pk=event.pk)
        if event.status_code == SecurityEvent.StatusCode.BULLETIN:
            return event
        if event.status_code != SecurityEvent.StatusCode.DRAFT:
            raise DomainError(
                "INVALID_LIFECYCLE_TRANSITION",
                422,
                message="Бюллетень можно выпустить только из статуса DRAFT.",
            )
        event.status_code = SecurityEvent.StatusCode.BULLETIN
        event.save(update_fields=["status_code", "updated_at"])
        record(
            actor=actor,
            action="SECURITY_EVENT_BULLETIN_ISSUED",
            entity_type="security_event",
            entity_id=uuid.UUID(int=event.pk),
            new_value={"event_id": event.pk, "status_code": event.status_code},
        )
    return event


def replace_checklist_items(event, rows):
    """Story 15.3b: replace-all-rows for `event.checklist_items` — a full
    form submission, not an incremental CRUD (no donor spec confirms
    per-row editing; replace-all avoids orphaned rows from a prior partial
    attempt).

    Review (Edge Case Hunter): `select_for_update()` on the parent
    `SecurityEvent` row, mirroring `issue_bulletin()` — without it, two
    concurrent PUTs both see the pre-delete row set as absent under
    READ COMMITTED (neither's DELETE conflicts with the other), and both
    commit their own `bulk_create()`, leaving the UNION of both writers'
    rows instead of one clean replace (reproduced: 10 rows survived from
    two 5-row concurrent PUTs). The lock serializes concurrent replaces
    onto the same event, closing the window.
    """
    with transaction.atomic():
        SecurityEvent.objects.select_for_update().get(pk=event.pk)
        event.checklist_items.all().delete()
        items = [SecurityEventChecklistItem(event=event, **row) for row in rows]
        SecurityEventChecklistItem.objects.bulk_create(items)
    return list(event.checklist_items.all())


def replace_sector_posts(event, rows):
    """Story 15.3b: replace-all-rows for `event.sector_posts` — same
    semantics (including the `select_for_update()` fix) as
    `replace_checklist_items()`."""
    with transaction.atomic():
        SecurityEvent.objects.select_for_update().get(pk=event.pk)
        event.sector_posts.all().delete()
        posts = [SecurityEventSectorPost(event=event, **row) for row in rows]
        SecurityEventSectorPost.objects.bulk_create(posts)
    return list(event.sector_posts.all())


def confirm_recon(event, *, actor):
    """Story 15.3c: BULLETIN->RECON transition, gated by dual control — no
    precedent anywhere in this codebase, synthesized from scratch. Two
    DISTINCT actors must call this. First call records
    `recon_first_confirmed_by/_at` and returns `pending=True` (caller
    returns 202). Second call from a DIFFERENT actor completes the
    transition, clears the confirmation fields (consumed), audits, and
    returns `pending=False`. The SAME actor calling twice is rejected (422)
    — dual control's entire point is a SECOND, independent confirmer.
    Idempotent replay on already-RECON also returns `pending=False` (200,
    no-op, no duplicate audit) — distinct from "first confirmation
    recorded", which the caller must NOT treat as a completed 200.

    Strict BULLETIN-only source, symmetric with `issue_bulletin()`'s
    DRAFT-only gate: RECON is the next linear step after BULLETIN.

    Returns `(event, pending)` — NOT a plain bool of "did it transition
    just now", since both "already RECON" and "second confirmation just
    completed it" must map to the caller's 200, while only "first
    confirmation recorded" maps to 202.
    """
    if not (actor or "").strip():
        raise DomainError("VALIDATION_ERROR", 400, message="actor обязателен.")
    with transaction.atomic():
        event = SecurityEvent.objects.select_for_update().get(pk=event.pk)
        if event.status_code == SecurityEvent.StatusCode.RECON:
            return event, False
        if event.status_code != SecurityEvent.StatusCode.BULLETIN:
            raise DomainError(
                "INVALID_LIFECYCLE_TRANSITION",
                422,
                message="Рекогносцировку можно подтвердить только из статуса BULLETIN.",
            )
        if not event.recon_first_confirmed_by:
            event.recon_first_confirmed_by = actor
            event.recon_first_confirmed_at = Clock.now()
            event.save(
                update_fields=[
                    "recon_first_confirmed_by",
                    "recon_first_confirmed_at",
                    "updated_at",
                ]
            )
            return event, True
        if event.recon_first_confirmed_by == actor:
            raise DomainError(
                "INVALID_LIFECYCLE_TRANSITION",
                422,
                message="Второе подтверждение должно быть от ДРУГОГО актора "
                "(двойной контроль).",
            )
        first_confirmed_by = event.recon_first_confirmed_by
        event.status_code = SecurityEvent.StatusCode.RECON
        event.recon_first_confirmed_by = ""
        event.recon_first_confirmed_at = None
        event.save(
            update_fields=[
                "status_code",
                "recon_first_confirmed_by",
                "recon_first_confirmed_at",
                "updated_at",
            ]
        )
        record(
            actor=actor,
            action="SECURITY_EVENT_RECON_CONFIRMED",
            entity_type="security_event",
            entity_id=uuid.UUID(int=event.pk),
            new_value={
                "event_id": event.pk,
                "status_code": event.status_code,
                "first_confirmed_by": first_confirmed_by,
                "second_confirmed_by": actor,
            },
        )
    return event, False


def replace_staffing_demand(event, rows):
    """Story 15.5b: replace-all-rows for `event.staffing_demands` — same
    semantics as `replace_checklist_items()`/`replace_sector_posts()`
    (15.3b), `select_for_update()` applied from the start (that lesson was
    already learned in 15.3b's review, not re-discovered here)."""
    with transaction.atomic():
        SecurityEvent.objects.select_for_update().get(pk=event.pk)
        event.staffing_demands.all().delete()
        demands = [SecurityEventStaffingDemand(event=event, **row) for row in rows]
        SecurityEventStaffingDemand.objects.bulk_create(demands)
    return list(event.staffing_demands.all())


def approve_staffing_demand(event, *, actor):
    """Story 15.5c: RECON->DEMAND transition, single-actor gate — literal
    template of `issue_bulletin()`. NOT dual control: FR-23, unlike FR-22,
    doesn't mention it, so this deliberately does NOT reuse
    `confirm_recon()`'s two-actor pattern."""
    if not (actor or "").strip():
        raise DomainError("VALIDATION_ERROR", 400, message="actor обязателен.")
    with transaction.atomic():
        event = SecurityEvent.objects.select_for_update().get(pk=event.pk)
        if event.status_code == SecurityEvent.StatusCode.DEMAND:
            return event
        if event.status_code != SecurityEvent.StatusCode.RECON:
            raise DomainError(
                "INVALID_LIFECYCLE_TRANSITION",
                422,
                message="Потребность можно утвердить только из статуса RECON.",
            )
        event.status_code = SecurityEvent.StatusCode.DEMAND
        event.save(update_fields=["status_code", "updated_at"])
        record(
            actor=actor,
            action="SECURITY_EVENT_DEMAND_APPROVED",
            entity_type="security_event",
            entity_id=uuid.UUID(int=event.pk),
            new_value={
                "event_id": event.pk,
                "status_code": event.status_code,
                "staffing_demand": [
                    {
                        "sector": d.sector,
                        "task": d.task,
                        "shift": d.shift,
                        "need": d.need,
                        "group": d.group,
                    }
                    for d in event.staffing_demands.all()
                ],
            },
        )
    return event


def generate_force_requests(event, *, actor):
    """Story 15.7b: aggregate `event.staffing_demands` by group-name into
    `GroupForceRequest` rows and dispatch (status=SENT) in one action — no
    spec text anywhere distinguishes "generate" from "send" as separate
    operator actions (only an indirect frontend-comment citation of the
    donor HTML says "requests will be formed automatically"), so this
    deliberately does NOT split them into two endpoints.

    Strict DEMAND-only gate — Potребность must be approved (15.5c) first.
    Text->reference matching against `StaffingDemand.group` (still free
    text, 15.5a) is STRICT: no fuzzy matching, no auto-creating new Group
    rows from typos. Unmatched text is reported back, never silently
    dropped or a 500.

    Idempotent regenerate: existing rows are updated (requested_count
    only) via `update_or_create`'s `defaults`, which deliberately does
    NOT include `status`/`allocated_count` — a second call after 15.8's
    broker has started allocating must not reset that progress back to
    NOT_SENT/0.

    Review (Edge Case Hunter): a group dropped entirely from the current
    `staffing_demands` (e.g. a `replace_staffing_demand()` PUT removed its
    rows) leaves its prior `GroupForceRequest` row untouched — deliberately
    NOT auto-deleted/cancelled (no spec states whether an already-dispatched
    request should silently vanish just because a later plan edit stopped
    mentioning it; auto-removing could un-request forces already in
    transit). Reported back as `stale_groups` instead, so the operator sees
    it rather than it silently lingering unexplained — same transparency
    principle as `unmatched_groups`.
    """
    if not (actor or "").strip():
        raise DomainError("VALIDATION_ERROR", 400, message="actor обязателен.")
    with transaction.atomic():
        event = SecurityEvent.objects.select_for_update().get(pk=event.pk)
        if event.status_code != SecurityEvent.StatusCode.DEMAND:
            raise DomainError(
                "INVALID_LIFECYCLE_TRANSITION",
                422,
                message="Запросы Группам можно сгенерировать только из статуса DEMAND.",
            )
        totals = {}
        for demand in event.staffing_demands.all():
            totals[demand.group] = totals.get(demand.group, 0) + demand.need
        active_groups = {g.name: g for g in Group.objects.filter(is_active=True)}
        unmatched_groups = []
        requests = []
        for group_name, total_need in totals.items():
            group = active_groups.get(group_name)
            if group is None:
                unmatched_groups.append(group_name)
                continue
            request, created = GroupForceRequest.objects.update_or_create(
                event=event,
                group=group,
                defaults={"requested_count": total_need},
            )
            if created:
                request.status = GroupForceRequest.Status.SENT
                request.save(update_fields=["status", "updated_at"])
            requests.append(request)
        stale_groups = [
            existing.group.name
            for existing in event.force_requests.select_related("group").all()
            if existing.group.name not in totals
        ]
        record(
            actor=actor,
            action="SECURITY_EVENT_FORCE_REQUESTS_GENERATED",
            entity_type="security_event",
            entity_id=uuid.UUID(int=event.pk),
            new_value={
                "event_id": event.pk,
                "requested_groups": list(totals.keys()),
                "unmatched_groups": unmatched_groups,
                "stale_groups": stale_groups,
            },
        )
    return list(event.force_requests.all()), unmatched_groups, stale_groups


def allocate_force_request(request, *, actor, allocated_count, comment=None):
    """Story 15.8: broker sets `allocated_count` on a `GroupForceRequest`,
    deriving `status` from the count vs `requested_count` — quantitative
    allocation only (no per-employee tracking; matches both 15.7a's model
    shape and the frontend prototype's `UpdateForceAllocationRequest`,
    soft signal).

    Deliberately NOT gated on the request's current status (no spec rules
    out re-adjusting an already-ALLOCATED request) and does NOT transition
    `SecurityEvent.status_code` to BROKERAGE — no backend evidence pins
    that as this call's trigger (see the story's Scope Decision); left an
    open question for a future story.
    """
    if not (actor or "").strip():
        raise DomainError("VALIDATION_ERROR", 400, message="actor обязателен.")
    with transaction.atomic():
        request = GroupForceRequest.objects.select_for_update().get(pk=request.pk)
        if allocated_count > request.requested_count:
            raise DomainError(
                "VALIDATION_ERROR",
                400,
                message="allocated_count не может превышать requested_count.",
                detail={"allocated_count": "Превышает запрошенное количество."},
            )
        count_unchanged = allocated_count == request.allocated_count
        comment_unchanged = comment is None or comment == request.comment
        if count_unchanged and comment_unchanged:
            return request
        if allocated_count == 0:
            new_status = GroupForceRequest.Status.SENT
        elif allocated_count >= request.requested_count:
            new_status = GroupForceRequest.Status.ALLOCATED
        else:
            new_status = GroupForceRequest.Status.PARTIALLY_ALLOCATED
        old_count, old_status = request.allocated_count, request.status
        request.allocated_count = allocated_count
        request.status = new_status
        update_fields = ["allocated_count", "status", "updated_at"]
        if comment is not None:
            request.comment = comment
            update_fields.append("comment")
        request.save(update_fields=update_fields)
        record(
            actor=actor,
            action="GROUP_FORCE_REQUEST_ALLOCATED",
            entity_type="group_force_request",
            entity_id=uuid.UUID(int=request.pk),
            old_value={"allocated_count": old_count, "status": old_status},
            new_value={"allocated_count": allocated_count, "status": new_status},
        )
    return request


def escalate_stale_force_requests():
    """Story 15.10 (FR-42): find `GroupForceRequest` rows stuck in
    SENT/PARTIALLY_ALLOCATED (never ALLOCATED, never a no-op NOT_SENT
    draft) for longer than `VAPS_FORCE_REQUEST_ESCALATION_DAYS` (PROVISIONAL
    — architecture.md:278,675 marks the real threshold an open question to
    the customer, not yet answered — corrected by review from an earlier,
    inaccurate "STOP-marker" citation), mark each `escalated_at` (per-row
    idempotency — a repeat catch-up run skips already-marked rows, no
    external watermark needed for this non-daily-batch check), and notify.

    Recipients are `brokerage.manage` holders — a deliberate simplification
    of FR-42's full "управление → зам → рук. департамента" vertical, which
    has no confirmed selector/data in this domain (unlike FR-13's
    purpose-built `NotifyRecipientSelector`). Review flagged this
    explicitly: `brokerage.manage` is the SAME role that performs
    allocation (15.8/15.9), so notifying it is a reminder to the
    non-acting role, not an escalation to a superior — FR-42's literal
    text is not met, only its story-local AC. Left as-is (see story's Out
    of Scope) pending real org-hierarchy data; not invented here. Grouped
    into ONE digest `notify()` call per recipient per day (matches
    `notify()`'s own `(recipient, kind, business_date)` one-per-day
    uniqueness — a per-row notification would collide/be dropped for a
    recipient with 2+ stale requests on the same day). A SECOND same-day
    batch merges its entries into the existing day's row directly (see
    below) rather than calling `notify()` again, which would otherwise
    silently no-op per `notify()`'s own "first payload wins" contract.

    The `"*"` (ADMIN) wildcard is included alongside `brokerage.manage` in
    recipient resolution — the same idiom used elsewhere in this codebase
    (`test_rbac_matrix.py`'s `_holders()`) — so any active ADMIN `UserRole`
    also receives this digest.

    Beat-ready, NOT Celery — same split as `check_lagging_submissions`
    (5.7b2): this function has zero Celery imports/dependencies; a future
    story wraps it in a `@shared_task` and registers the beat schedule.

    Returns the list of newly-escalated `GroupForceRequest` rows.
    """
    threshold = Clock.now() - datetime.timedelta(
        days=settings.VAPS_FORCE_REQUEST_ESCALATION_DAYS
    )
    stale = list(
        GroupForceRequest.objects.filter(
            Q(status=GroupForceRequest.Status.SENT)
            | Q(status=GroupForceRequest.Status.PARTIALLY_ALLOCATED),
            escalated_at__isnull=True,
            updated_at__lt=threshold,
        ).select_related("event", "group")
    )
    if not stale:
        return []
    recipients = list(
        UserRole.objects.filter(
            is_active=True,
            role_code__role_permissions__permission_code_id__in=[
                "brokerage.manage",
                "*",
            ],
        )
        .values_list("user_id", flat=True)
        .distinct()
    )
    now = Clock.now()
    today = Clock.today_local()
    with transaction.atomic():
        for request in stale:
            request.escalated_at = now
        GroupForceRequest.objects.bulk_update(stale, ["escalated_at"])
        new_entries = [
            {
                "request_id": r.pk,
                "event_id": r.event_id,
                "group_code": r.group_id,
                "status": r.status,
            }
            for r in stale
        ]
        for recipient in recipients:
            # `notify()`'s `(recipient, kind, business_date)` uniqueness means
            # a SECOND same-day batch (a newly-stale row surfacing after an
            # earlier run already escalated others today) would otherwise
            # no-op — "first payload wins" (notify()'s own contract) would
            # silently drop this batch's entries from the recipient-visible
            # digest even though the row itself is correctly marked
            # escalated_at (Edge Case Hunter finding, story 15.10 review).
            # Locked update-in-place merges into the SAME day's row instead
            # of relying on notify()'s create-only path.
            existing = (
                Notification.objects.select_for_update()
                .filter(
                    recipient=recipient,
                    kind="GROUP_FORCE_REQUEST_ESCALATED",
                    business_date=today,
                )
                .first()
            )
            if existing is not None:
                existing.payload = {
                    "escalated": existing.payload.get("escalated", []) + new_entries
                }
                existing.save(update_fields=["payload"])
            else:
                notify(
                    recipient=recipient,
                    kind="GROUP_FORCE_REQUEST_ESCALATED",
                    business_date=today,
                    payload={"escalated": new_entries},
                )
        record(
            actor="SYSTEM",
            action="GROUP_FORCE_REQUEST_ESCALATED",
            entity_type="group_force_request",
            # A batch run escalates N rows in one call — no single row is
            # "the" entity. Same sentinel pattern as bulk_status_service
            # .py's _BULK_SUMMARY_ENTITY_ID (a deterministic all-zero UUID,
            # not a real row's identity) for a batch-summary audit row.
            entity_id=uuid.UUID(int=0),
            new_value={
                "escalated_request_ids": [r.pk for r in stale],
                "recipients": recipients,
            },
        )
    return stale


def form_draft_placement(event, *, actor):
    """Story 16.2 (FR-26): auto-form a DRAFT `AssignmentVersion` from an
    event's `SecurityEventDirectAssignment` rows (физнаряд, 15.9) — the
    ONLY Epic 15 structure carrying real named `employee_id`s.
    `GroupForceRequest`'s `allocated_count` is a bare headcount with no
    roster anywhere in the codebase and is deliberately NOT a source here
    (research-confirmed premise gap, story's Scope Decision) — a future
    story fills those in manually once a roster model exists, if ever.

    Post resolution is best-effort by `(event.object, sector_post.post)`
    matching `facilities.Post`'s `(object, code)` — the ONLY link between
    `SecurityEventSectorPost`'s free-text demand label and a real `Post`
    row, since no FK connects them today. A direct assignment whose post
    text doesn't resolve lands in `unmatched` (same transparency principle
    as `generate_force_requests()`'s `unmatched_groups`, 15.7b) — never
    silently dropped, never auto-created.

    One call = one NEW draft version. A second call while a current
    version already exists (any status) is a real conflict, not a no-op —
    `AssignmentVersion`'s own `unique_assignment_version_current`
    (16.1) would raise a raw `IntegrityError`; guarded here first so the
    caller sees `PLACEMENT_DRAFT_ALREADY_EXISTS` (409) instead.
    """
    if not (actor or "").strip():
        raise DomainError("VALIDATION_ERROR", 400, message="actor обязателен.")
    with transaction.atomic():
        event = SecurityEvent.objects.select_for_update().get(pk=event.pk)
        if AssignmentVersion.objects.filter(event=event, is_current=True).exists():
            raise DomainError(
                "PLACEMENT_DRAFT_ALREADY_EXISTS",
                409,
                message="У события уже есть текущая версия Расстановки.",
            )
        version = AssignmentVersion.objects.create(
            event=event, status=AssignmentVersion.Status.DRAFT, created_by=actor.strip()
        )
        posts_by_code = {
            post.code: post for post in Post.objects.filter(object=event.object)
        }
        unmatched = []
        created_assignments = []
        for direct in event.direct_assignments.select_related("sector_post"):
            post = posts_by_code.get(direct.sector_post.post)
            if post is None:
                unmatched.append(
                    {
                        "employee_id": str(direct.employee_id),
                        "post_text": direct.sector_post.post,
                    }
                )
                continue
            # Review note (Blind Hunter/Edge Case Hunter): `full_clean()`
            # here can ONLY ever raise for `post.object_id != version.event
            # .object_id` today, because `posts_by_code` is built strictly
            # from `Post.objects.filter(object=event.object)` — the
            # cross-object clean() guard is structurally unreachable from
            # this resolution path. Left UNCAUGHT deliberately: a future
            # widening of the resolution surface (16.3+) that DOES let a
            # ValidationError fire here would abort the WHOLE draft
            # (transaction.atomic rolls back already-matched rows too),
            # unlike the Post-resolution miss above (which lands in
            # `unmatched`, never blocking). Whether that all-or-nothing
            # blast radius is the right failure mode once reachable is an
            # open design question for whichever story widens this — not
            # decided here, since nothing today can actually trigger it.
            assignment = PlacementAssignment(
                version=version, employee_id=direct.employee_id, post=post
            )
            assignment.full_clean()
            assignment.save()
            created_assignments.append(assignment)
        record(
            actor=actor,
            action="PLACEMENT_DRAFT_FORMED",
            entity_type="assignment_version",
            entity_id=uuid.UUID(int=version.pk),
            new_value={
                "event_id": event.pk,
                "matched_count": len(created_assignments),
                "unmatched_count": len(unmatched),
                "unmatched": unmatched,
            },
        )
    return version, created_assignments, unmatched


def _post_requirement_conflicts(post, profile):
    """Story 16.3c (FR-25): compare *post*'s requirements against an
    employee's `operational_profile_for()` snapshot. Returns a list of
    `conflict_codes` (never raises) — `Post.requirements` is completely
    unvalidated JSON (14.1's own deferred decision, this function's whole
    reason to exist), so every lookup is defensive: a missing key or a
    value of the wrong type SKIPS that specific check rather than
    crashing the whole conflict scan. A `None` profile field (employee
    exists but has no `EmployeeOperationalProfile`/that field is unset)
    is likewise treated as "unknown" — skip, never a mismatch.

    `min_rank_index`/`max_rank_index` compare against the employee's OWN
    `rank_index` («звание»), never `Position.rank_index` (a different
    axis, the DUTY/job-position's level, not the person's rank) — the
    registry's own conflict-code descriptions name «звание» and
    «должность» as two separate checks.
    """
    requirements = post.requirements if isinstance(post.requirements, dict) else {}
    codes = []

    min_height_cm = requirements.get("min_height_cm")
    height_cm = profile.get("height_cm")
    if (
        isinstance(min_height_cm, (int, float))
        and height_cm is not None
        and height_cm < min_height_cm
    ):
        codes.append("POST_REQUIREMENT_MISMATCH_CONFLICT")

    required_gender = requirements.get("gender")
    gender = profile.get("gender")
    if (
        isinstance(required_gender, str)
        and required_gender
        and gender is not None
        and gender != required_gender
    ):
        codes.append("POST_REQUIREMENT_MISMATCH_CONFLICT")

    rank_index = profile.get("rank_index")
    min_rank_index = requirements.get("min_rank_index")
    if (
        isinstance(min_rank_index, (int, float))
        and rank_index is not None
        and rank_index < min_rank_index
    ):
        codes.append("POST_REQUIREMENT_MISMATCH_CONFLICT")

    max_rank_index = requirements.get("max_rank_index")
    # PROVISIONAL default: permissive (overqualification allowed) unless
    # the requirements JSON explicitly opts into the restriction — matches
    # error-codes.yaml's own "...при allow_overqualification=false"
    # phrasing (an opt-in restriction, not an opt-out).
    #
    # Review finding (Edge Case Hunter, live-confirmed): `Post.requirements`
    # is unvalidated client JSON — `allow_overqualification: 0` (int, not
    # bool `false`) previously slipped past an `is False` identity check
    # (`0 is False` is False in Python) and was silently treated as
    # permissive. `in (False, 0)` catches both without touching the
    # permissive default for any other truthy/absent value.
    allow_overqualification = requirements.get("allow_overqualification", True)
    if (
        isinstance(max_rank_index, (int, float))
        and rank_index is not None
        and rank_index > max_rank_index
        and allow_overqualification in (False, 0)
    ):
        codes.append("OVERQUALIFICATION_DETECTED")

    required_position_codes = requirements.get("required_position_codes")
    position_code = profile.get("position_code")
    if (
        isinstance(required_position_codes, list)
        and required_position_codes
        and position_code is not None
        and position_code not in required_position_codes
    ):
        codes.append("POST_REQUIREMENT_MISMATCH_CONFLICT")

    # requires_weapon/requires_special_equipment/requires_uniform are
    # plain Post columns, NOT part of the requirements JSON.
    permit_checks = (
        (post.requires_weapon, profile.get("has_weapon_permit")),
        (post.requires_special_equipment, profile.get("has_special_equipment")),
        (post.requires_uniform, profile.get("has_uniform_issued")),
    )
    for required, has_it in permit_checks:
        if required and has_it is False:
            codes.append("POST_REQUIREMENT_MISMATCH_CONFLICT")

    return codes


def _workload_conflicts(
    assignment, event, event_start, event_end, other_current_assignments
):
    """Story 16.3d (FR-25, part 4/4): 3-consecutive-day overload check
    (`WORKLOAD_EXCEEDED_CONFLICT`, BR-006: "3 дня подряд: total_hours +
    новые > 8.0").

    Scope (see story's Scope Decision for the full rationale): `total_hours`
    is summed ONLY from OTHER current `PlacementAssignment` rows of this
    employee (the Расстановка domain) — `DutyShift`/Дежурства is NOT a
    source here, since the only Duty-side signal reachable without a new,
    unestablished convention (filtering by `DutyPlan.status_code`) is the
    `EmployeeStatus` `DUTY` projection, which carries calendar-DATE
    granularity only (`_to_date_range()`), not the precise hours this
    8.0-hour threshold needs. Full Дежурства+ОМ workload is FR-32/Epic 19's
    territory, not this assignment-time SOFT-conflict check.

    Event-level hour granularity, same approximation
    `detect_placement_conflicts()` already uses for double-assignment
    (16.3a/16.3b): an event's full duration counts toward EVERY calendar
    day its `[date_start, date_end)` window touches, not split
    proportionally.

    Window is `[D-1, D, D+1]` where `D` = *event*'s own calendar start date
    (`event_start`, already computed by the caller via `_to_date_range()`).
    Flags the conflict only if ALL THREE days' `total_hours` (other current
    assignments' events touching that day, plus *event*'s own hours on the
    days it touches) exceed 8.0 — a single overloaded day is not enough.

    `other_current_assignments` is the caller's already-fetched, per-batch
    query (`version__is_current=True`, `employee_id__in=...`,
    `.exclude(version_id=version.pk)`) — reused, not re-queried. Rows are
    deduped by event id so a duplicate current-assignment referencing the
    SAME event (or an intra-version duplicate, which never appears in this
    excluded-current-version queryset at all) never double-counts that
    event's hours.
    """
    other_events = {}
    for other in other_current_assignments:
        if other.employee_id != assignment.employee_id:
            continue
        other_event = other.version.event
        if not (other_event.starts_at and other_event.ends_at):
            continue
        other_events[other_event.pk] = other_event

    def _hours(ev):
        return (ev.ends_at - ev.starts_at).total_seconds() / 3600

    window = [event_start + datetime.timedelta(days=offset) for offset in (-1, 0, 1)]
    for day in window:
        total_hours = 0.0
        for other_event in other_events.values():
            other_start, other_end = _to_date_range(
                other_event.starts_at, other_event.ends_at
            )
            if other_start <= day < other_end:
                total_hours += _hours(other_event)
        if event_start <= day < event_end:
            total_hours += _hours(event)
        if total_hours <= 8.0:
            return []

    return ["WORKLOAD_EXCEEDED_CONFLICT"]


def detect_placement_conflicts(version):
    """Story 16.3b (FR-25, part 2/4): double-assignment + rest-violation
    conflict scan for *version*'s `PlacementAssignment` rows.

    Read+recompute, NOT blocking (that's 16.4's approval-workflow
    territory) and NOT audited (a read-only recompute that may be called
    often — same convention as `validate_duty_plan()`, 14.11f, whose own
    docstring names this exact scope as "Story 16.3's territory", reused
    literally here). Full recompute every call — `conflict_severity`/
    `conflict_codes` are OVERWRITTEN, not accumulated, so a row whose
    conflict is resolved (e.g. the other version stopped being current)
    is correctly cleared back to blank/`[]`, not left stuck.

    Both conflict types are fixed-SOFT: `docs/registries/error-codes.yaml`'s
    `conflict_codes` registry nests `DOUBLE_ASSIGNMENT_CONFLICT`/
    `REST_VIOLATION_CONFLICT` ONLY under `SOFT_CONFLICT_DETECTED` — no HARD
    variant exists at the assignment level (FR-11's hard-block mechanism is
    a status-level concern, not invoked here; a generic "overlaps ANY
    hard-block status" check would be broader than this story's own title
    and isn't built here).

    Double-assignment has TWO independent sources, both checked (review
    finding, Blind Hunter — the first cut only checked the cross-version
    source, leaving a same-version duplicate structurally invisible since
    `.exclude(version_id=version.pk)` drops the whole current version,
    including any OTHER row in it):
    (a) intra-version — the SAME `employee_id` appears on 2+ rows of THIS
        version (e.g. `form_draft_placement()`, 16.2, copies
        `SecurityEventDirectAssignment` rows 1:1 with no employee dedup,
        and that model's own docstring states it deliberately carries no
        uniqueness guard). Unambiguous — both rows are the SAME event, no
        schedule needed to know they clash.
    (b) cross-version — the SAME `employee_id` in another CURRENT version
        whose event's `[starts_at, ends_at)` overlaps this version's event
        window (16.3a's flagged v1 approximation: event granularity, not
        per-assignment). Either side missing a schedule makes the overlap
        UNDETERMINABLE — such pairs are skipped, never treated as
        conflict-free NOR conflicted (no invented assumption from absent
        data).

    Rest-violation reuses `duties.services._to_date_range()` verbatim (the
    same review-hardened local-timezone conversion `validate_duty_plan()`
    uses) rather than re-deriving calendar dates from a UTC-stored
    DateTimeField, which would silently misplace an overnight event.

    Story 16.3c: also checks post-requirement mismatch, in the SAME pass
    (appending into the SAME `codes` list before the one write) — a
    second, independent full-recompute function would silently erase this
    function's earlier findings on its own `.update()` call, with no
    guaranteed ordering between the two. `Post.requirements` is read
    defensively via `_post_requirement_conflicts()` (completely
    unvalidated JSON, 14.1's own deferred decision) — a missing/
    wrong-typed key skips that specific check rather than raising.

    Story 16.3d: also checks 3-consecutive-day overload (same SAME-pass
    principle), via `_workload_conflicts()` — see that function's
    docstring for the `total_hours` source and window scoping.

    Returns the list of `PlacementAssignment` rows touched (all rows in
    the version, since every row is recomputed).
    """
    assignments = list(version.assignments.select_related("version__event", "post"))
    event = version.event
    event_has_schedule = bool(event.starts_at and event.ends_at)

    employee_ids = [a.employee_id for a in assignments]
    intra_version_duplicates = {
        employee_id
        for employee_id in employee_ids
        if employee_ids.count(employee_id) > 1
    }

    other_current_assignments = list(
        PlacementAssignment.objects.filter(
            version__is_current=True,
            employee_id__in=set(employee_ids),
        )
        .exclude(version_id=version.pk)
        .select_related("version__event")
    )

    if event_has_schedule:
        event_start, event_end = _to_date_range(event.starts_at, event.ends_at)

    operational_profiles = CoreEmployeeSelector.operational_profile_for(
        set(employee_ids)
    )

    touched = []
    for assignment in assignments:
        codes = []

        if assignment.employee_id in intra_version_duplicates:
            codes.append("DOUBLE_ASSIGNMENT_CONFLICT")

        if event_has_schedule:
            if "DOUBLE_ASSIGNMENT_CONFLICT" not in codes:
                for other in other_current_assignments:
                    if other.employee_id != assignment.employee_id:
                        continue
                    other_event = other.version.event
                    if not (other_event.starts_at and other_event.ends_at):
                        continue
                    if (
                        event.starts_at < other_event.ends_at
                        and event.ends_at > other_event.starts_at
                    ):
                        codes.append("DOUBLE_ASSIGNMENT_CONFLICT")
                        break

            has_rest_conflict = EmployeeStatus.objects.filter(
                employee_id=assignment.employee_id,
                status_type_code="REST_AFTER_DUTY",
                cancelled_at__isnull=True,
                date_start__lt=event_end,
                date_end__gt=event_start,
            ).exists()
            if has_rest_conflict:
                codes.append("REST_VIOLATION_CONFLICT")

            codes.extend(
                _workload_conflicts(
                    assignment, event, event_start, event_end, other_current_assignments
                )
            )

        profile = operational_profiles.get(assignment.employee_id)
        if profile is not None:
            codes.extend(_post_requirement_conflicts(assignment.post, profile))

        severity = PlacementAssignment.ConflictSeverity.SOFT if codes else ""
        PlacementAssignment.objects.filter(pk=assignment.pk).update(
            conflict_severity=severity, conflict_codes=codes
        )
        assignment.conflict_severity = severity
        assignment.conflict_codes = codes
        touched.append(assignment)

    return touched


def submit_assignment_version(version, *, actor):
    """Story 16.4 (FR-26): `DRAFT`->`SUBMITTED`. Idempotent replay on
    already-`SUBMITTED` (no-op, no duplicate audit) — same shape as
    `issue_bulletin()`. Strict `DRAFT`-only source; any other status is a
    real state conflict (`INVALID_LIFECYCLE_TRANSITION`, 422), reusing the
    generic registry code already established across 15.2b/15.3c for the
    same class of guard.
    """
    if not (actor or "").strip():
        raise DomainError("VALIDATION_ERROR", 400, message="actor обязателен.")
    with transaction.atomic():
        version = AssignmentVersion.objects.select_for_update().get(pk=version.pk)
        if version.status == AssignmentVersion.Status.SUBMITTED:
            return version
        if version.status != AssignmentVersion.Status.DRAFT:
            raise DomainError(
                "INVALID_LIFECYCLE_TRANSITION",
                422,
                message="Подать на согласование можно только черновик.",
            )
        version.status = AssignmentVersion.Status.SUBMITTED
        version.save(update_fields=["status", "updated_at"])
        record(
            actor=actor,
            action="ASSIGNMENT_VERSION_SUBMITTED",
            entity_type="assignment_version",
            entity_id=uuid.UUID(int=version.pk),
            new_value={"event_id": version.event_id, "status": version.status},
        )
        _notify_assignment_submitted(version)
    return version


def _notify_assignment_submitted(version):
    """Story 16.6d (FR-27): notify every `assignment.approve`/`"*"` holder
    on `submit_assignment_version()`'s real DRAFT->SUBMITTED transition.
    Literal reuse of `escalate_stale_force_requests()`'s (15.10) role×
    permission resolution idiom — not a per-event selector, a role-wide
    one, since "who can approve" isn't scoped to this event.
    """
    recipients = (
        UserRole.objects.filter(
            is_active=True,
            role_code__role_permissions__permission_code_id__in=[
                "assignment.approve",
                "*",
            ],
        )
        .values_list("user_id", flat=True)
        .distinct()
    )
    business_date = Clock.today_local()
    payload = {"event_id": version.event_id, "version_id": version.pk}
    for recipient in recipients:
        notify(
            recipient, Notification.Kind.ASSIGNMENT_SUBMITTED, business_date, payload
        )


def return_assignment_version(version, *, actor, reason):
    """Story 16.4 (FR-26): `SUBMITTED`->`RETURNED` — NOT an in-place
    mutation (`AssignmentVersion`'s own docstring, 16.1, states versions
    are immutable per `DailySubmission`'s pattern). `RETURNED` is a
    terminal lifecycle status on the CURRENT row (flipping `status` is a
    lifecycle fact, not editing the row's assignment content); the row
    then flips `is_current=False` and a NEW `DRAFT` row (`version+1`) is
    INSERTED, copying every `PlacementAssignment` of the returned version
    so the planner revises a real starting point, not a blank slate.
    Literal reuse of `amend_day()`'s (`apps.operations.submissions`)
    flip-before-insert ordering: the partial-unique `is_current` guard
    would reject inserting the new current row before the old one clears.

    `reason` is required non-blank — same "material change needs
    justification" convention as `amend_day()`'s own `reason`/`sanction`
    guard, not invented fresh here.
    """
    if not (actor or "").strip():
        raise DomainError("VALIDATION_ERROR", 400, message="actor обязателен.")
    if not (reason or "").strip():
        raise DomainError(
            "VALIDATION_ERROR",
            400,
            detail={"field": "reason"},
            message="Причина возврата обязательна.",
        )
    reason = reason.strip()
    with transaction.atomic():
        version = AssignmentVersion.objects.select_for_update().get(pk=version.pk)
        if version.status != AssignmentVersion.Status.SUBMITTED:
            raise DomainError(
                "INVALID_LIFECYCLE_TRANSITION",
                422,
                message="Вернуть на доработку можно только поданную версию.",
            )
        version.status = AssignmentVersion.Status.RETURNED
        version.is_current = False
        version.save(update_fields=["status", "is_current", "updated_at"])

        new_version = AssignmentVersion.objects.create(
            event=version.event,
            status=AssignmentVersion.Status.DRAFT,
            version=version.version + 1,
            is_current=True,
        )
        PlacementAssignment.objects.bulk_create(
            [
                PlacementAssignment(
                    version=new_version,
                    employee_id=a.employee_id,
                    post_id=a.post_id,
                )
                for a in version.assignments.all()
            ]
        )
        record(
            actor=actor,
            action="ASSIGNMENT_VERSION_RETURNED",
            entity_type="assignment_version",
            entity_id=uuid.UUID(int=version.pk),
            new_value={
                "event_id": version.event_id,
                "reason": reason,
                "new_draft_version_id": new_version.pk,
            },
        )
        _notify_assignment_returned(version)
    return version, new_version


def _notify_assignment_returned(version):
    """Story 16.6d (FR-27): notify the version's `created_by` (skipped if
    blank — "no data = skip", same convention as `_notify_assignment_
    approved()`, 16.6a) and the event's senior on
    `return_assignment_version()`'s real (and only-ever) SUBMITTED->
    RETURNED transition.
    """
    event = version.event
    employee_ids = set()
    if event.senior_employee_id:
        employee_ids.add(event.senior_employee_id)
    user_ids = CoreEmployeeSelector.user_ids_for(employee_ids) if employee_ids else {}
    recipients = set(user_ids.values())
    if version.created_by:
        recipients.add(version.created_by)
    if not recipients:
        return

    business_date = Clock.today_local()
    payload = {"event_id": event.pk, "version_id": version.pk}
    for recipient in recipients:
        notify(recipient, Notification.Kind.ASSIGNMENT_RETURNED, business_date, payload)


def project_placement_assignment(assignment, event):
    """Story 16.5: project one `PlacementAssignment` into an
    `EmployeeStatus` row (`EVENT_ASSIGNMENT`, `source=OM_AUTO`) — literal
    analogue of `apps.operations.duties.services.project_duty_shift()`
    (14.9a/BR-017), moved into the Расстановка domain. Idempotent by
    `source_ref` (`get_or_create()`, same shape as `project_duty_shift()`).

    `event` is passed explicitly (the caller's already-loaded
    `version.event`) rather than dereferenced via `assignment.version.event`
    — `PlacementAssignment` doesn't select_related `version__event`, so
    resolving it per-row here would cost one query per assignment.

    `EVENT_ASSIGNMENT` is already seeded (`seed_statuses.py`) and NOT in
    `HARD_BLOCK_CODES` — SOFT, outside `EmployeeStatus`'s
    `excl_hard_status_overlap` exclusion constraint, so no DB-level overlap
    rejection is possible here; conflicts are already gated earlier by
    `detect_placement_conflicts()` inside `approve_assignment_version()`.

    No-op (returns without writing) when the event has no schedule
    (`starts_at`/`ends_at` unset) — event-level granularity, same "no
    data = skip, not invented" convention 16.3a-d already establish for
    this same event/assignment pair.
    """
    if not (event.starts_at and event.ends_at):
        return
    date_start, date_end = _to_date_range(event.starts_at, event.ends_at)
    EmployeeStatus.objects.get_or_create(
        source_ref=f"EVENT_ASSIGNMENT:{assignment.pk}",
        defaults={
            "employee_id": assignment.employee_id,
            "status_type_code": "EVENT_ASSIGNMENT",
            "date_start": date_start,
            "date_end": date_end,
            "source": EmployeeStatus.Source.OM_AUTO,
        },
    )


def _notify_assignment_approved(version):
    """Story 16.6a (FR-27): fire `Notification.Kind.ASSIGNMENT_APPROVED`
    for every assigned participant and the event's senior, on
    `approve_assignment_version()`'s real transition (called alongside
    16.5's `project_placement_assignment()` loop, same conditions).

    `notify()`'s `recipient` is a flat external-auth actor id, never an
    `Employee` UUID — `CoreEmployeeSelector.user_ids_for()` bridges
    `PlacementAssignment.employee_id`/`SecurityEvent.senior_employee_id`
    to a `recipient` string via `UserEmployeeBinding`. An employee with no
    bound account is simply absent from that dict — no notification for
    them, not an error (same "no data = skip" convention this whole
    domain already establishes).

    One `notify()` call per UNIQUE recipient (a `set`, not a loop over
    `PlacementAssignment` rows) — an employee assigned to 2+ posts in this
    version (16.3b's intra-version duplicate) gets exactly one
    notification, matching `notify()`'s own `(recipient, kind,
    business_date)` "one per day" contract rather than relying on it to
    silently dedupe repeat calls.
    """
    employee_ids = set(version.assignments.values_list("employee_id", flat=True))
    event = version.event
    if event.senior_employee_id:
        employee_ids.add(event.senior_employee_id)
    if not employee_ids:
        return

    user_ids = CoreEmployeeSelector.user_ids_for(employee_ids)
    business_date = Clock.today_local()
    payload = {"event_id": event.pk, "version_id": version.pk}
    for user_id in set(user_ids.values()):
        notify(
            recipient=user_id,
            kind=Notification.Kind.ASSIGNMENT_APPROVED,
            business_date=business_date,
            payload=payload,
        )


def approve_assignment_version(version, *, actor, override=False, override_reason=""):
    """Story 16.4 (FR-26): `SUBMITTED`->`APPROVED`, single approver
    (literal reuse of `approve_duty_plan()`'s idempotent single-actor
    shape — NOT 15.3c's dual-control, a bespoke pattern the epics.md text
    itself never asks 16.4 to repeat: this story is explicitly
    "one-approver").

    Re-runs `detect_placement_conflicts()` FRESH before checking (never
    trusts a possibly-stale prior recompute — the draft could have been
    edited since the last scan). Both 16.3b's and 16.3c's conflict types
    are fixed-SOFT (`error-codes.yaml`'s `SOFT_CONFLICT_DETECTED`,
    overridable) — reuses the SAME `override`/`override_reason` guard
    shape as `apps.operations.statuses.services.status_service`, not a
    bespoke gate for this app.

    On a real transition, computes `signature_hash` — a plain
    `hashlib.sha256()` digest of the version's `(employee_id, post_id)`
    pairs, ordered by `id` for determinism. This is the "hash-ready
    заглушка ЭЦП": architecture.md itself defers REAL digital signing to
    MVP-2 — no PKI/external signing call belongs here.

    Review note (Edge Case Hunter, live-confirmed): the digest is
    content-only — no `version.pk`/`event_id`/`actor`/timestamp is mixed
    in — so two DIFFERENT approvals (different versions, different
    events, different approvers) of assignment sets that happen to share
    the same `(employee_id, post_id)` pairs produce the IDENTICAL hash.
    This matches the stub's stated scope literally (a content digest, not
    an approval-event signature) and isn't a defect against it — but
    whichever story wires real ЭЦП (MVP-2) will need a richer signed
    payload than this stub's bare content hash.

    Story 16.5: also projects `EVENT_ASSIGNMENT` `EmployeeStatus` rows for
    every participant on this REAL transition — see
    `project_placement_assignment()`'s own docstring.

    Story 16.6a: also notifies assigned employees + event senior — see
    `_notify_assignment_approved()`'s own docstring.
    """
    if not (actor or "").strip():
        raise DomainError("VALIDATION_ERROR", 400, message="actor обязателен.")
    if override and not (override_reason or "").strip():
        raise DomainError(
            "VALIDATION_ERROR",
            400,
            detail={"field": "override_reason"},
            message="override_reason обязателен при override=True.",
        )
    with transaction.atomic():
        version = AssignmentVersion.objects.select_for_update().get(pk=version.pk)
        if version.status == AssignmentVersion.Status.APPROVED:
            return version
        if version.status != AssignmentVersion.Status.SUBMITTED:
            raise DomainError(
                "INVALID_LIFECYCLE_TRANSITION",
                422,
                message="Утвердить можно только поданную на согласование версию.",
            )

        detect_placement_conflicts(version)
        has_conflicts = version.assignments.exclude(conflict_severity="").exists()
        if has_conflicts and not (override and (override_reason or "").strip()):
            raise DomainError(
                "SOFT_CONFLICT_DETECTED",
                409,
                overridable=True,
                message="В версии есть непросмотренные конфликты назначений.",
            )

        pairs = list(
            version.assignments.order_by("id").values_list("employee_id", "post_id")
        )
        digest_input = json.dumps(
            [[str(employee_id), post_id] for employee_id, post_id in pairs],
            separators=(",", ":"),
        )
        signature_hash = hashlib.sha256(digest_input.encode("utf-8")).hexdigest()

        # Story 16.5: project EVENT_ASSIGNMENT status for every participant
        # of this version, ONLY on this real SUBMITTED->APPROVED transition
        # (the idempotent-replay early-return above already exited before
        # this point for an already-APPROVED version).
        for assignment in version.assignments.all():
            project_placement_assignment(assignment, version.event)

        # Story 16.6a: notify assigned employees + event senior — same
        # real-transition-only condition as the projection loop above.
        _notify_assignment_approved(version)

        version.status = AssignmentVersion.Status.APPROVED
        version.signature_hash = signature_hash
        version.save(update_fields=["status", "signature_hash", "updated_at"])
        record(
            actor=actor,
            action="ASSIGNMENT_VERSION_APPROVED",
            entity_type="assignment_version",
            entity_id=uuid.UUID(int=version.pk),
            new_value={
                "event_id": version.event_id,
                "signature_hash": signature_hash,
                "override": override,
                "override_reason": override_reason if override else "",
            },
        )
    return version


def acknowledge_placement_assignment(assignment, *, actor):
    """Story 16.6b (FR-27): mark `PlacementAssignment.acknowledged_at` —
    the employee's one-time confirmation they've seen their assignment
    (16.1's stub field, "заполняется Story 16.6's сервисом").

    Only `acknowledged_at` is written — no `acknowledged_by` column
    exists (16.1 never designed one: the "who" here is never ambiguous,
    it's always `assignment.employee_id`, unlike `cancelled_by` which
    can differ from the row's own subject). Identity of `actor` against
    `assignment.employee_id` is NOT checked — the same convention
    `submit_assignment_version()`/`return_assignment_version()`/
    `approve_assignment_version()` (16.4) already establish (no
    service-level role/identity check, only non-blank `actor`); that
    verification is 16.8's API/permissions layer, not invented here
    (same conclusion as 16.6a's Scope Decision on the missing "approver"
    permission code).

    Only reachable for a `PlacementAssignment` whose `version.status` is
    `APPROVED` — acknowledging is meaningless before approval (nothing
    was projected/notified yet, 16.5/16.6a). Any other status raises
    `INVALID_LIFECYCLE_TRANSITION` (422), the same registry code
    `submit_assignment_version()`/`approve_assignment_version()` already
    use for "wrong state for this transition" — not a new code.

    Idempotent: a replay call on an already-acknowledged row is a no-op
    (200, `acknowledged_at` keeps its FIRST value, no duplicate audit
    row) — "first ack wins", the same idempotent-replay shape as
    `submit_assignment_version()`.
    """
    if not (actor or "").strip():
        raise DomainError("VALIDATION_ERROR", 400, message="actor обязателен.")
    with transaction.atomic():
        assignment = PlacementAssignment.objects.select_for_update().get(
            pk=assignment.pk
        )
        if assignment.acknowledged_at is not None:
            return assignment
        if assignment.version.status != AssignmentVersion.Status.APPROVED:
            raise DomainError(
                "INVALID_LIFECYCLE_TRANSITION",
                422,
                message="Отметить ознакомление можно только для утверждённого "
                "назначения.",
            )
        assignment.acknowledged_at = Clock.now()
        assignment.save(update_fields=["acknowledged_at", "updated_at"])
        record(
            actor=actor,
            action="PLACEMENT_ASSIGNMENT_ACKNOWLEDGED",
            entity_type="placement_assignment",
            entity_id=uuid.UUID(int=assignment.pk),
            new_value={
                "assignment_id": assignment.pk,
                "employee_id": str(assignment.employee_id),
                "acknowledged_at": assignment.acknowledged_at.isoformat(),
            },
        )
    return assignment


def escalate_missing_acknowledgements():
    """Story 16.6c (FR-27): find `PlacementAssignment` rows of a CURRENT
    `APPROVED` version whose employee has NOT acknowledged
    (`acknowledged_at IS NULL`) and whose event starts within
    `VAPS_ACK_ESCALATION_HOURS_BEFORE_EVENT` hours (PROVISIONAL — no
    threshold is fixed in architecture.md), mark each `ack_escalated_at`
    (per-row watermark — a repeat run skips already-escalated rows, same
    idempotency shape as `GroupForceRequest.escalated_at`, 15.10), and
    notify the event's senior.

    Literal analogue of `escalate_stale_force_requests()` (15.10) — same
    structure (batch mark, digest per recipient per day, same-day merge
    to avoid `notify()`'s "first payload wins" from dropping a second
    same-day batch's entries), differing only in HOW the recipient is
    resolved: not a role/permission_code_id lookup, but
    `event.senior_employee_id` -> `user_id` via 16.6a's
    `CoreEmployeeSelector.user_ids_for()` (per-event, not per-role).

    Only events that HAVEN'T started yet (`starts_at > now`) are
    considered — escalating "close to start" for an event already
    underway/past is meaningless.

    A row with no resolvable recipient (no `senior_employee_id`, or no
    bound `UserEmployeeBinding`) is STILL marked `ack_escalated_at` —
    batch idempotency doesn't depend on notification success, same "no
    data = skip the notify, not the watermark" split already established
    (16.6a's per-recipient skip is at the notify layer, not the mark
    layer here, since marking is per-row while notifying is per-event).

    Beat-ready, NOT Celery — same split as `escalate_stale_force_
    requests()`: zero Celery imports/dependencies; a future story wraps
    this in a `@shared_task` and registers the beat schedule.

    Returns the list of newly-escalated `PlacementAssignment` rows.
    """
    now = Clock.now()
    threshold = now + datetime.timedelta(
        hours=settings.VAPS_ACK_ESCALATION_HOURS_BEFORE_EVENT
    )
    stale = list(
        PlacementAssignment.objects.filter(
            version__status=AssignmentVersion.Status.APPROVED,
            version__is_current=True,
            acknowledged_at__isnull=True,
            ack_escalated_at__isnull=True,
            version__event__starts_at__isnull=False,
            version__event__starts_at__gt=now,
            version__event__starts_at__lte=threshold,
        ).select_related("version__event")
    )
    if not stale:
        return []

    senior_ids = {
        a.version.event.senior_employee_id
        for a in stale
        if a.version.event.senior_employee_id
    }
    user_ids = CoreEmployeeSelector.user_ids_for(senior_ids) if senior_ids else {}

    today = Clock.today_local()
    with transaction.atomic():
        for assignment in stale:
            assignment.ack_escalated_at = now
        PlacementAssignment.objects.bulk_update(stale, ["ack_escalated_at"])

        by_event = {}
        for assignment in stale:
            by_event.setdefault(assignment.version.event, []).append(assignment)

        for event, assignments in by_event.items():
            senior_employee_id = event.senior_employee_id
            recipient = user_ids.get(senior_employee_id) if senior_employee_id else None
            if not recipient:
                continue
            new_entries = [
                {
                    "assignment_id": a.pk,
                    "employee_id": str(a.employee_id),
                    "event_id": event.pk,
                }
                for a in assignments
            ]
            existing = (
                Notification.objects.select_for_update()
                .filter(
                    recipient=recipient,
                    kind=Notification.Kind.ACK_MISSING_ESCALATION,
                    business_date=today,
                )
                .first()
            )
            if existing is not None:
                existing.payload = {
                    "escalated": existing.payload.get("escalated", []) + new_entries
                }
                existing.save(update_fields=["payload"])
            else:
                notify(
                    recipient=recipient,
                    kind=Notification.Kind.ACK_MISSING_ESCALATION,
                    business_date=today,
                    payload={"escalated": new_entries},
                )
        record(
            actor="SYSTEM",
            action="PLACEMENT_ACKNOWLEDGEMENT_ESCALATED",
            entity_type="placement_assignment",
            # Batch run escalates N rows in one call — no single row is
            # "the" entity, same batch-summary sentinel as
            # escalate_stale_force_requests()' own record() call.
            entity_id=uuid.UUID(int=0),
            new_value={
                "escalated_assignment_ids": [a.pk for a in stale],
            },
        )
    return stale


def send_ack_reminders():
    """Story 16.6e (FR-27): remind the ASSIGNED EMPLOYEE themselves (not
    the senior — that's `escalate_missing_acknowledgements()`, 16.6c) to
    acknowledge, while `acknowledged_at` stays null and the event is
    within `VAPS_ACK_REMINDER_DAYS_BEFORE_EVENT` days of starting.

    Deliberately narrowed from `ws-message-types.yaml::ACK_REQUIRED`'s
    literal "every 2h until ack" cadence to "once per business_date" —
    `notify()`'s own `(recipient, kind, business_date)` contract IS the
    recurrence mechanism here: a fresh `business_date` on the NEXT day's
    batch run naturally re-fires the reminder for a still-unacknowledged
    row, with NO watermark field needed (unlike `ack_escalated_at`,
    16.6c's one-time escalation fact — a permanent flag here would
    silently kill the reminder after its first day, defeating "until
    ack"). Independent of 16.6c's escalation: a row with
    `ack_escalated_at` already set still gets reminded here if still
    unacknowledged.

    One `notify()` call per UNIQUE recipient (same set-based dedup as
    16.6a's `_notify_assignment_approved()`) — an employee with 2+
    unacknowledged assignments gets exactly one reminder per day.

    Beat-ready, NOT Celery — same split as `escalate_stale_force_
    requests()`/`escalate_missing_acknowledgements()`.

    Returns the list of `PlacementAssignment` rows a reminder was
    computed for (regardless of whether a recipient was resolvable).
    """
    now = Clock.now()
    threshold = now + datetime.timedelta(
        days=settings.VAPS_ACK_REMINDER_DAYS_BEFORE_EVENT
    )
    pending = list(
        PlacementAssignment.objects.filter(
            version__status=AssignmentVersion.Status.APPROVED,
            version__is_current=True,
            acknowledged_at__isnull=True,
            version__event__starts_at__isnull=False,
            version__event__starts_at__gt=now,
            version__event__starts_at__lte=threshold,
        )
    )
    if not pending:
        return []

    employee_ids = {a.employee_id for a in pending}
    user_ids = CoreEmployeeSelector.user_ids_for(employee_ids)

    today = Clock.today_local()
    with transaction.atomic():
        for recipient in set(user_ids.values()):
            notify(
                recipient=recipient,
                kind=Notification.Kind.ACK_REQUIRED,
                business_date=today,
                payload={},
            )
        record(
            actor="SYSTEM",
            action="PLACEMENT_ACK_REMINDER_SENT",
            entity_type="placement_assignment",
            entity_id=uuid.UUID(int=0),
            new_value={
                "reminded_assignment_ids": [a.pk for a in pending],
            },
        )
    return pending


def create_journal_entry(
    event,
    *,
    actor,
    entry_type,
    text,
    post=None,
    participant_ids=None,
    photo_attachment_id=None,
):
    """Story 17.1/17.2 (FR-29): журнал штаба — инструктаж/указания/
    инциденты в режиме проведения. Guard-порядок буквально повторяет
    `issue_bulletin()`: actor -> lifecycle -> mutation -> audit, внутри
    одной транзакции.

    `post`/`participant_ids`/`photo_attachment_id` — Story 17.2, только
    для `entry_type=INCIDENT`; `post` обязателен (AC-2), остальные два —
    нет. Для `BRIEFING`/`DIRECTIVE` эти параметры игнорируются, даже если
    переданы — не ошибка, просто не пишутся (тот же принцип, что
    CheckConstraint требует `post IS NULL` для не-INCIDENT).
    """
    if not (actor or "").strip():
        raise DomainError("VALIDATION_ERROR", 400, message="actor обязателен.")
    # created_by (TimeStampedModel) — CharField(max_length=100); отклоняем
    # ДО транзакции, а не даём БД оборвать вставку IntegrityError'ом
    # (review, Edge Case Hunter).
    if len(actor.strip()) > 100:
        raise DomainError(
            "VALIDATION_ERROR", 400, message="actor длиннее 100 символов."
        )
    if entry_type not in JournalEntry.EntryType.values:
        raise DomainError(
            "VALIDATION_ERROR",
            400,
            message=(
                "Недопустимый entry_type для журнала штаба: "
                f"{entry_type!r} (допустимо {JournalEntry.EntryType.values})."
            ),
        )
    if not (text or "").strip():
        # Пустая/whitespace-only запись в append-only журнал бессмысленна и
        # неисправима постфактум (review, Blind Hunter + Edge Case Hunter —
        # оба независимо нашли этот пробел).
        raise DomainError("VALIDATION_ERROR", 400, message="text обязателен.")
    is_incident = entry_type == JournalEntry.EntryType.INCIDENT
    if is_incident and post is None:
        raise DomainError(
            "VALIDATION_ERROR",
            400,
            message="post обязателен для entry_type=INCIDENT.",
        )
    if is_incident and post.object_id != event.object_id:
        # review (Blind Hunter + Edge Case Hunter, независимо совпали):
        # буквальный образец PlacementAssignment.clean() (16.x) — пост
        # обязан принадлежать тому же объекту, что событие.
        raise DomainError(
            "VALIDATION_ERROR",
            400,
            message="post должен принадлежать тому же объекту, что и событие.",
        )
    with transaction.atomic():
        event = SecurityEvent.objects.select_for_update().get(pk=event.pk)
        if event.status_code != SecurityEvent.StatusCode.IN_PROGRESS:
            raise DomainError(
                "INVALID_LIFECYCLE_TRANSITION",
                422,
                message=(
                    "Запись в журнал штаба доступна только в режиме "
                    "проведения (IN_PROGRESS)."
                ),
            )
        entry = JournalEntry.objects.create(
            event=event,
            entry_type=entry_type,
            text=text,
            created_by=actor.strip(),
            post=post if is_incident else None,
            # JSONField не сериализует uuid.UUID напрямую — строкуем на
            # запись; JournalEntrySelector.incidents_for_participant()
            # строкует employee_id тем же способом при чтении.
            participant_ids=(
                [str(p) for p in (participant_ids or [])] if is_incident else []
            ),
            photo_attachment_id=photo_attachment_id if is_incident else None,
        )
        record(
            actor=actor,
            action="JOURNAL_ENTRY_CREATED",
            entity_type="security_event",
            entity_id=uuid.UUID(int=event.pk),
            new_value={"entry_id": entry.pk, "entry_type": entry.entry_type},
        )
    return entry


def _require_text(value, field):
    """Непустой (после strip) обязательный атрибут amendment → иначе 400.

    Буквальный перенос `apps.operations.submissions.services
    .amendment_service._require_text()` — тот же паттерн, чужой модуль
    (`submissions`) не импортируется через границу приложений (ARCH-003-
    родственный принцип: сервисный хелпер копируется, не шарится через
    cross-app import).
    """
    if not value or not value.strip():
        raise DomainError(
            "VALIDATION_ERROR", 400, message=f"{field} обязателен для amendment."
        )


def _notify_replacement(old_version, new_version):
    """Story 17.6 (FR-28/FR-31): fire `Notification.Kind.REPLACEMENT_CREATED`
    for every employee present in `old_version` but absent from
    `new_version` — «снятый»/«заменённый», no distinction between the two
    (17.3 allows both a straight replacement and a plain vacancy; either
    way the removed employee is notified the same way) — plus
    `event.senior_employee_id`, if set (registry: "senior/affected
    users"). Буквальный образец `_notify_assignment_approved()`'s (16.6a)
    bridging-идиомы: `CoreEmployeeSelector.user_ids_for()` +
    `set(...values())`-дедуп, ОДИН `notify()` на уникального получателя,
    не на строку.

    Fires for BOTH direct `amend_assignment_version()` callers AND
    `cascade_replace_departed()` (17.5, which delegates its whole
    mutation here) — no 17.5-specific code needed.
    """
    old_employee_ids = set(
        old_version.assignments.values_list("employee_id", flat=True)
    )
    new_employee_ids = set(
        new_version.assignments.values_list("employee_id", flat=True)
    )
    removed_employee_ids = old_employee_ids - new_employee_ids
    if not removed_employee_ids:
        return

    event = new_version.event
    if event.senior_employee_id:
        removed_employee_ids = removed_employee_ids | {event.senior_employee_id}

    user_ids = CoreEmployeeSelector.user_ids_for(removed_employee_ids)
    business_date = Clock.today_local()
    payload = {"event_id": event.pk, "version_id": new_version.pk}
    for user_id in set(user_ids.values()):
        notify(
            recipient=user_id,
            kind=Notification.Kind.REPLACEMENT_CREATED,
            business_date=business_date,
            payload=payload,
        )


def amend_assignment_version(version, *, actor, reason, sanction, assignments):
    """Story 17.3 (FR-28): оперативное изменение Расстановки ПОСЛЕ
    утверждения — только с санкцией. Создаёт НОВУЮ версию сразу
    `APPROVED` (не под-цикл submit/approve — `sanction` САМА ЕСТЬ
    авторизация, буквальный образец `DailySubmission.amend_day()`'s
    `AMENDED`-паттерна).

    `assignments` — ПОЛНЫЙ новый состав версии (список dict'ов
    `{"employee_id", "post", "is_unplanned"?, "source_division_id"?,
    "source_duty_shift_id"?}`, последние три — опциональны, Story 17.4),
    не diff/patch; 17.4/17.5 решают, КАК его построить (снятие/замена
    конкретного человека, допнаряд-маркировка), эта стори просто
    версионирует готовый список.

    Конфликты (`detect_placement_conflicts()`, 16.3) считаются и
    ЗАПИСЫВАЮТСЯ на новую версию, но НЕ блокируют создание — все
    конфликты в этой кодовой базе fixed-SOFT, а `sanction` уже есть
    безусловная авторизация (Scope Decision — второй override-гейт
    поверх санкции был бы избыточен).

    НЕ вызывает 16.5's `project_placement_assignment()`/16.6a's
    `_notify_assignment_approved()` — те специфичны обычному approve-
    циклу; 17.4/17.5/17.6 решают точечно, кого проецировать/уведомлять
    после конкретного типа изменения.
    """
    if not (actor or "").strip():
        raise DomainError("VALIDATION_ERROR", 400, message="actor обязателен.")
    _require_text(reason, "reason")
    _require_text(sanction, "sanction")
    reason, sanction = reason.strip(), sanction.strip()

    with transaction.atomic():
        version = AssignmentVersion.objects.select_for_update().get(pk=version.pk)
        if (
            not version.is_current
            or version.status != AssignmentVersion.Status.APPROVED
        ):
            raise DomainError(
                "INVALID_LIFECYCLE_TRANSITION",
                422,
                message=(
                    "Оперативное изменение возможно только для текущей "
                    "утверждённой версии."
                ),
            )
        event = SecurityEvent.objects.select_for_update().get(pk=version.event_id)
        if event.status_code != SecurityEvent.StatusCode.IN_PROGRESS:
            raise DomainError(
                "INVALID_LIFECYCLE_TRANSITION",
                422,
                message=(
                    "Оперативное изменение доступно только в режиме "
                    "проведения (IN_PROGRESS)."
                ),
            )
        for spec in assignments:
            if "employee_id" not in spec:
                # review (Blind Hunter + Edge Case Hunter, независимо
                # совпали): raw spec["employee_id"] в bulk_create падал бы
                # KeyError, не DomainError, на пропущенном ключе.
                raise DomainError(
                    "VALIDATION_ERROR", 400, message="employee_id обязателен."
                )
            post = spec.get("post")
            if post is None or post.object_id != event.object_id:
                # review (Edge Case Hunter): post=None must raise a domain
                # error, not AttributeError. review-прецедент 17.2 (Blind
                # Hunter + Edge Case Hunter): пост обязан принадлежать тому
                # же объекту, что событие.
                raise DomainError(
                    "VALIDATION_ERROR",
                    400,
                    message=(
                        "post должен принадлежать тому же объекту, что и событие."
                    ),
                )
            source_division_id = spec.get("source_division_id")
            source_duty_shift_id = spec.get("source_duty_shift_id")
            has_source = (
                source_division_id is not None or source_duty_shift_id is not None
            )
            if spec.get("is_unplanned") and not has_source:
                # Story 17.4 (FR-28): сервис отбивает пустой источник
                # раньше DB-CheckConstraint — тот же приём, что
                # `_require_text()` (backstop, не единственная линия
                # защиты). `is not None`, не truthy — симметрично с DB
                # констрейнта `__isnull=False` (review, Blind Hunter:
                # truthy отбросил бы source_duty_shift_id=0 как «нет
                # источника», хотя DB его бы приняла).
                raise DomainError(
                    "VALIDATION_ERROR",
                    400,
                    message=(
                        "Допнаряд (is_unplanned=True) требует source_division_id "
                        "или source_duty_shift_id."
                    ),
                )
            if not spec.get("is_unplanned") and has_source:
                # review (Blind Hunter): обратное направление того же
                # констрейнта — планового назначения с источником не
                # существовало ни в одном service-level guard'е, отдавая
                # его сырому IntegrityError вместо DomainError.
                raise DomainError(
                    "VALIDATION_ERROR",
                    400,
                    message=(
                        "source_division_id/source_duty_shift_id допустимы только "
                        "при is_unplanned=True."
                    ),
                )

        # Flip-before-insert внутри ВЛОЖЕННОГО savepoint — буквальный образец
        # `amend_day()`'s комментария (review, Edge Case Hunter): конкурентная
        # гонка на unique_assignment_version_number/_current срывает
        # IntegrityError ЗДЕСЬ, не отравляя объемлющую транзакцию вызывающего
        # (DRF-хендлер маппит IntegrityError в 409 снаружи, тот же canon, что
        # `amend_day()`'s CONSTRAINT_ERROR_MAP-комментарий).
        with transaction.atomic():
            version.is_current = False
            version.save(update_fields=["is_current", "updated_at"])

            new_version = AssignmentVersion.objects.create(
                event=event,
                status=AssignmentVersion.Status.APPROVED,
                version=version.version + 1,
                is_current=True,
                is_amendment=True,
                reason=reason,
                sanction=sanction,
                created_by=actor.strip(),
            )
            # Story 17.4: assignments — список dict'ов, обратная
            # совместимость с 17.3-вызовами без допнаряд-ключей через
            # .get(key, default), не [key] (KeyError на старой форме).
            PlacementAssignment.objects.bulk_create(
                [
                    PlacementAssignment(
                        version=new_version,
                        employee_id=spec["employee_id"],
                        post=spec["post"],
                        is_unplanned=spec.get("is_unplanned", False),
                        source_division_id=spec.get("source_division_id"),
                        source_duty_shift_id=spec.get("source_duty_shift_id"),
                    )
                    for spec in assignments
                ]
            )
        detect_placement_conflicts(new_version)

        pairs = list(
            new_version.assignments.order_by("id").values_list("employee_id", "post_id")
        )
        digest_input = json.dumps(
            [[str(employee_id), post_id] for employee_id, post_id in pairs],
            separators=(",", ":"),
        )
        new_version.signature_hash = hashlib.sha256(
            digest_input.encode("utf-8")
        ).hexdigest()
        new_version.save(update_fields=["signature_hash", "updated_at"])

        _notify_replacement(version, new_version)

        record(
            actor=actor,
            action="ASSIGNMENT_VERSION_AMENDED",
            entity_type="assignment_version",
            entity_id=uuid.UUID(int=new_version.pk),
            old_value={"old_version_id": version.pk},
            new_value={
                "new_version_id": new_version.pk,
                "reason": reason,
                "sanction": sanction,
            },
        )
    return new_version


def cascade_replace_departed(
    version,
    *,
    actor,
    departed_employee_id,
    reason,
    sanction,
    manual_replacement_employee_id=None,
):
    """Story 17.5 (FR-31): каскадная замена выбывшего — автоматическое
    предложение следующего по штатной цепочке внутри управления (Tier 1,
    `find_replacement_candidates()` на собственном подразделении
    выбывшего), при отсутствии — департамент (Tier 2, родительское
    подразделение, ОДИН уровень вверх — PROVISIONAL, см. Story 17.5's
    Scope Decision), при `manual_replacement_employee_id` — авто-поиск
    пропускается целиком (ручной выбор приоритетнее).

    При отсутствии кандидата на ВСЕХ уровнях — `DomainError` +
    `ASSIGNMENT_REPLACEMENT_ESCALATED`-аудит, `amend_assignment_version()`
    НЕ вызывается («система пассивна», тот же принцип, что
    `SecurityEventDirectAssignment`, 15.9).

    Строится НА `amend_assignment_version()` (17.3) — собирает полный
    `assignments`-список (копия текущих строк, кроме постов выбывшего),
    делегирует всю мутацию/аудит успешной замены туда.
    """
    if not (actor or "").strip():
        raise DomainError("VALIDATION_ERROR", 400, message="actor обязателен.")
    if (
        manual_replacement_employee_id is not None
        and manual_replacement_employee_id == departed_employee_id
    ):
        # review (Edge Case Hunter): выбывший «сам себе замена» — не
        # ошибка Django, но бессмысленный no-op, отклоняем явно.
        raise DomainError(
            "VALIDATION_ERROR",
            400,
            message="Замена не может совпадать с выбывшим сотрудником.",
        )
    departed_posts = list(
        PlacementAssignment.objects.filter(
            version=version, employee_id=departed_employee_id
        )
    )
    if not departed_posts:
        raise DomainError(
            "VALIDATION_ERROR",
            400,
            message="Выбывший сотрудник не держит ни одного поста в этой версии.",
        )
    other_rows = list(
        PlacementAssignment.objects.filter(version=version).exclude(
            employee_id=departed_employee_id
        )
    )
    already_assigned = {row.employee_id for row in other_rows}
    if (
        manual_replacement_employee_id is not None
        and manual_replacement_employee_id in already_assigned
    ):
        # review (Blind Hunter + Edge Case Hunter, независимо совпали):
        # ручной путь не проверял already_assigned вообще — двойное
        # назначение молча проходило бы как SOFT-конфликт вместо отказа.
        raise DomainError(
            "VALIDATION_ERROR",
            400,
            message="Замена уже назначена на другой пост в этой версии.",
        )
    try:
        manual_replacement = (
            CoreEmployeeSelector.get(manual_replacement_employee_id)
            if manual_replacement_employee_id is not None
            else None
        )
        departed_employee = CoreEmployeeSelector.get(departed_employee_id)
    except ObjectDoesNotExist:
        # review (Edge Case Hunter): CoreEmployeeSelector.get() пробрасывал
        # сырой DoesNotExist вместо DomainError.
        raise DomainError(
            "VALIDATION_ERROR", 400, message="Сотрудник не найден."
        ) from None
    on_date = Clock.today_local()
    replacements = {}
    for departed_post in departed_posts:
        if manual_replacement_employee_id is not None:
            if manual_replacement_employee_id in replacements.values():
                # review (Blind Hunter + Edge Case Hunter, независимо
                # совпали): один ручной кандидат не может закрыть НЕСКОЛЬКО
                # постов выбывшего за один вызов — молчаливое двойное
                # назначение.
                raise DomainError(
                    "VALIDATION_ERROR",
                    400,
                    message=(
                        "Один ручной кандидат не может заменить несколько "
                        "постов выбывшего за один вызов."
                    ),
                )
            replacement = manual_replacement
        else:
            exclude_ids = (
                already_assigned | {departed_employee_id} | set(replacements.values())
            )
            candidates = find_replacement_candidates(
                departed_employee.division_id, on_date, exclude_ids
            )
            if not candidates and departed_employee.division.parent_id:
                candidates = find_replacement_candidates(
                    departed_employee.division.parent_id, on_date, exclude_ids
                )
            if not candidates:
                record(
                    actor=actor,
                    action="ASSIGNMENT_REPLACEMENT_ESCALATED",
                    entity_type="assignment_version",
                    entity_id=uuid.UUID(int=version.pk),
                    new_value={
                        "departed_employee_id": str(departed_employee_id),
                        "post_id": departed_post.post_id,
                    },
                )
                raise DomainError(
                    "REPLACEMENT_NOT_FOUND",
                    409,
                    message=(
                        "Замена не найдена ни в управлении, ни в департаменте "
                        "— эскалация зафиксирована в аудите."
                    ),
                )
            replacement = candidates[0]
        replacements[departed_post.pk] = replacement.id

    replacement_employees = (
        {manual_replacement.id: manual_replacement}
        if manual_replacement_employee_id is not None
        else {}
    )
    assignments = []
    for row in other_rows:
        # review (Blind Hunter): провенанс существующих строк (допнаряд-
        # поля, 17.4) сохраняется, не отбрасывается на каждый amendment.
        assignments.append(
            {
                "employee_id": row.employee_id,
                "post": row.post,
                "is_unplanned": row.is_unplanned,
                "source_division_id": row.source_division_id,
                "source_duty_shift_id": row.source_duty_shift_id,
            }
        )
    for departed_post in departed_posts:
        replacement_id = replacements[departed_post.pk]
        # source_division_id — «откуда» кандидат (его СОБСТВЕННОЕ
        # подразделение), не подразделение выбывшего/события; одинаково
        # для авто и ручного пути. Переиспользуем уже полученный объект
        # там, где он есть (ручной путь) вместо повторного запроса.
        replacement_employee = replacement_employees.get(
            replacement_id
        ) or CoreEmployeeSelector.get(replacement_id)
        assignments.append(
            {
                "employee_id": replacement_id,
                "post": departed_post.post,
                "is_unplanned": True,
                "source_division_id": replacement_employee.division_id,
            }
        )

    return amend_assignment_version(
        version,
        actor=actor,
        reason=reason,
        sanction=sanction,
        assignments=assignments,
    )


def start_security_event(event, *, actor):
    """Story 18.1 (research находка): APPROVED->IN_PROGRESS — недостающее
    звено между 16.x's Расстановка (approve_assignment_version()) и Epic
    17's журнал/оперативное изменение (оба гейтят
    `event.status_code == IN_PROGRESS`, но ничто в кодовой базе не
    выставляло его до этой стори). Буквальный образец
    `approve_staffing_demand()`'s single-actor idempotent-on-target
    паттерна."""
    if not (actor or "").strip():
        raise DomainError("VALIDATION_ERROR", 400, message="actor обязателен.")
    with transaction.atomic():
        event = SecurityEvent.objects.select_for_update().get(pk=event.pk)
        if event.status_code == SecurityEvent.StatusCode.IN_PROGRESS:
            return event
        if event.status_code != SecurityEvent.StatusCode.APPROVED:
            raise DomainError(
                "INVALID_LIFECYCLE_TRANSITION",
                422,
                message="Проведение можно начать только из статуса APPROVED.",
            )
        event.status_code = SecurityEvent.StatusCode.IN_PROGRESS
        event.save(update_fields=["status_code", "updated_at"])
        record(
            actor=actor,
            action="SECURITY_EVENT_STARTED",
            entity_type="security_event",
            entity_id=uuid.UUID(int=event.pk),
            new_value={"event_id": event.pk, "status_code": event.status_code},
        )
    return event


def close_security_event(event, *, actor, summaries):
    """Story 18.1 (FR-30): IN_PROGRESS->CLOSED — требует итог по КАЖДОМУ
    направлению (`SecurityEventSectorPost.sector`, дистинкт). `summaries`
    — список dict'ов `{"sector", "summary"}`, ПОЛНОЕ покрытие, не diff
    (тот же принцип, что `amend_assignment_version()`'s `assignments` —
    upsert готового набора).

    НЕ идемпотентно на уже-CLOSED — review-исправление (Acceptance
    Auditor): исходная докстринг-формулировка ошибочно называла
    `issue_bulletin()` прецедентом «строгого NOT-idempotent» перехода —
    на самом деле `issue_bulletin()` (как и `approve_staffing_demand()`)
    idempotent-on-target (`if event.status_code == BULLETIN: return
    event`). Строгая не-идемпотентность здесь — НОВОЕ, осознанное решение
    для ЭТОЙ стори (закрытие терминально: повторный вызов на уже-CLOSED —
    реальный конфликт состояния, не replay-safe действие), а не
    заимствованный прецедент."""
    if not (actor or "").strip():
        raise DomainError("VALIDATION_ERROR", 400, message="actor обязателен.")
    with transaction.atomic():
        event = SecurityEvent.objects.select_for_update().get(pk=event.pk)
        if event.status_code != SecurityEvent.StatusCode.IN_PROGRESS:
            raise DomainError(
                "INVALID_LIFECYCLE_TRANSITION",
                422,
                message="Закрыть можно только событие в статусе IN_PROGRESS.",
            )
        required_sectors = set(
            event.sector_posts.values_list("sector", flat=True).distinct()
        )
        given_sectors = set()
        for spec in summaries:
            sector = spec.get("sector")
            if not (sector or "").strip():
                raise DomainError("VALIDATION_ERROR", 400, message="sector обязателен.")
            summary = spec.get("summary")
            if not summary or not summary.strip():
                # review (Blind Hunter + Acceptance Auditor): _require_text()'s
                # hardcoded message ("обязателен для amendment.") is copied
                # from a different call site (amend_assignment_version) and
                # is nonsensical here — inline check instead of reusing it.
                raise DomainError(
                    "VALIDATION_ERROR", 400, message="summary обязателен."
                )
            if sector in given_sectors:
                # review (Blind Hunter + Edge Case Hunter, независимо
                # совпали): дубликат сектора в одном payload молча
                # перезаписывался бы update_or_create — отклоняем явно,
                # тот же принцип, что дубликат-employee_id-гарды
                # cascade_replace_departed() (17.5).
                raise DomainError(
                    "VALIDATION_ERROR",
                    400,
                    message="Направление указано в summaries более одного раза.",
                    detail={"duplicate_sector": sector},
                )
            given_sectors.add(sector)
        missing = required_sectors - given_sectors
        if missing:
            raise DomainError(
                "VALIDATION_ERROR",
                400,
                message="Итоги обязательны по каждому направлению.",
                detail={"missing_sectors": sorted(missing)},
            )
        unknown = given_sectors - required_sectors
        if unknown:
            # review (Blind Hunter + Edge Case Hunter, независимо совпали):
            # sector, которого нет ни у одной sector_posts-строки события,
            # молча упсертился бы как мусорная строка — Dev Notes этой
            # стори явно обещали эту проверку, реализация её не несла.
            raise DomainError(
                "VALIDATION_ERROR",
                400,
                message="Направление не относится к этому событию.",
                detail={"unknown_sectors": sorted(unknown)},
            )
        for spec in summaries:
            SecurityEventClosureSummary.objects.update_or_create(
                event=event,
                sector=spec["sector"],
                defaults={"summary": spec["summary"].strip()},
            )
        event.status_code = SecurityEvent.StatusCode.CLOSED
        event.save(update_fields=["status_code", "updated_at"])
        record(
            actor=actor,
            action="SECURITY_EVENT_CLOSED",
            entity_type="security_event",
            entity_id=uuid.UUID(int=event.pk),
            new_value={
                "event_id": event.pk,
                "status_code": event.status_code,
                "closure_summaries": [
                    {"sector": s.sector, "summary": s.summary}
                    for s in event.closure_summaries.all()
                ],
            },
        )
    return event


def record_assignment_actual_time(assignment, *, actor, actual_start_at, actual_end_at):
    """Story 18.3 (FR-43): «опрос по итогам» — фактическое время ОДНОГО
    назначения, записываемое ПОСЛЕ закрытия события (основа для Налёта
    часов, 18.4 — не построена здесь). Upsert — буквальный образец
    `close_security_event()`'s `SecurityEventClosureSummary`-паттерна
    (18.1): повторный вызов ИСПРАВЛЯЕТ факт, не создаёт вторую строку.

    Гейт на `is_current` (не только `status_code == CLOSED`) — факт
    имеет смысл только для АКТУАЛЬНОЙ версии Расстановки; устаревшая
    версия (returned/replaced) не участвует в Налёте часов."""
    if not (actor or "").strip():
        raise DomainError("VALIDATION_ERROR", 400, message="actor обязателен.")
    if actual_start_at is None or actual_end_at is None:
        raise DomainError(
            "VALIDATION_ERROR",
            400,
            message="actual_start_at и actual_end_at обязательны.",
        )
    if actual_start_at >= actual_end_at:
        raise DomainError(
            "VALIDATION_ERROR",
            400,
            message="actual_start_at должен быть раньше actual_end_at.",
        )
    with transaction.atomic():
        # review (Blind Hunter + Edge Case Hunter + Acceptance Auditor,
        # независимо совпали): select_for_update() отсутствовал, хотя Dev
        # Notes явно цитировали close_security_event() (18.1) как образец
        # структуры — там лок ЕСТЬ. Добавлено, чтобы докстринг-claim о
        # «буквальном образце» стал правдой.
        assignment = (
            PlacementAssignment.objects.select_for_update()
            .select_related("version", "version__event")
            .get(pk=assignment.pk)
        )
        version = assignment.version
        if not version.is_current:
            raise DomainError(
                "INVALID_LIFECYCLE_TRANSITION",
                422,
                message="Факт можно записать только для актуальной версии Расстановки.",
            )
        if version.event.status_code != SecurityEvent.StatusCode.CLOSED:
            raise DomainError(
                "INVALID_LIFECYCLE_TRANSITION",
                422,
                message="Факт можно записать только после закрытия события.",
            )
        # review (Blind Hunter): audit-registry description явно обещает
        # "Эмитится... включая исправление", но old_value не писался —
        # исправление факта без следа ПРЕЖНЕГО значения подрывает саму
        # цель аудита (буквальный образец GroupForceRequest's
        # old_value-паттерна, allocate_force_request()).
        existing = PlacementAssignmentActual.objects.filter(
            assignment=assignment
        ).first()
        old_value = (
            {
                "actual_start_at": existing.actual_start_at.isoformat(),
                "actual_end_at": existing.actual_end_at.isoformat(),
            }
            if existing
            else None
        )
        actual, _ = PlacementAssignmentActual.objects.update_or_create(
            assignment=assignment,
            defaults={
                "actual_start_at": actual_start_at,
                "actual_end_at": actual_end_at,
                "recorded_by": actor.strip(),
            },
        )
        record(
            actor=actor,
            action="ASSIGNMENT_ACTUAL_TIME_RECORDED",
            entity_type="placement_assignment_actual",
            entity_id=uuid.UUID(int=actual.pk),
            old_value=old_value,
            new_value={
                "assignment_id": assignment.pk,
                "actual_start_at": actual.actual_start_at.isoformat(),
                "actual_end_at": actual.actual_end_at.isoformat(),
            },
        )
    return actual


_NIGHT_START_HOUR = 22  # PROVISIONAL (18.4) — 22:00 local, до Epic 19's справочника.
_NIGHT_END_HOUR = 6  # PROVISIONAL (18.4) — 06:00 local.


def _next_day_night_boundary(current, tz):
    """Story 18.4 review-fix (Blind Hunter + Edge Case Hunter + Acceptance
    Auditor, независимо совпали): исходная версия вычисляла `is_night` и
    `boundary` ДВУМЯ раздельными сравнениями `current.hour` — мутационная
    проба Acceptance Auditor на ОДНОЙ из них воспроизвела БЕСКОНЕЧНЫЙ ЦИКЛ
    (не просто неверный результат) внутри `select_for_update()`-лока. Эта
    функция — ЕДИНАЯ точка решения: возвращает `(is_night, boundary)` для
    сегмента, начинающегося в `current`, одним набором сравнений — десинк
    структурно невозможен."""
    local_date = current.date()
    day_start = datetime.datetime.combine(
        local_date, datetime.time(_NIGHT_END_HOUR), tzinfo=tz
    )
    night_start = datetime.datetime.combine(
        local_date, datetime.time(_NIGHT_START_HOUR), tzinfo=tz
    )
    if current < day_start:
        return True, day_start
    if current < night_start:
        return False, night_start
    return True, day_start + datetime.timedelta(days=1)


def _split_day_night_hours(start_at, end_at):
    """Story 18.4 (FR-32): чистая функция — делит `[start_at, end_at)`
    (aware UTC) на дневные/ночные часы по МЕСТНОЙ границе 22:00–06:00
    (`settings.VAPS_LOCAL_TIMEZONE`). Итеративно режет по каждой
    day/night-границе местного времени (`_next_day_night_boundary()`) —
    корректно для интервалов, пересекающих ПОЛНОЧЬ и МНОГО дней подряд.
    Возвращает `(day_hours: Decimal, night_hours: Decimal)`, сумма ВСЕГДА
    равна округлённой длительности интервала (review-fix: раздельное
    округление day/night могло разойтись с суммой на сотые — здесь
    `night_hours` — остаток от целого, не независимое округление).
    """
    if end_at <= start_at:
        raise ValueError("end_at должен быть позже start_at.")
    tz = ZoneInfo(settings.VAPS_LOCAL_TIMEZONE)
    current = start_at.astimezone(tz)
    end_local = end_at.astimezone(tz)
    day_seconds = Decimal(0)
    total_seconds = Decimal(str((end_local - current).total_seconds()))
    while current < end_local:
        is_night, boundary = _next_day_night_boundary(current, tz)
        segment_end = min(boundary, end_local)
        duration = Decimal(str((segment_end - current).total_seconds()))
        if not is_night:
            day_seconds += duration
        current = segment_end
    total_hours = (total_seconds / 3600).quantize(Decimal("0.01"))
    day_hours = (day_seconds / 3600).quantize(Decimal("0.01"))
    night_hours = total_hours - day_hours
    return day_hours, night_hours


def compute_service_hours(actual, *, actor):
    """Story 18.4 (FR-32): Налёт часов день/ночь из `PlacementAssignmentActual`
    (18.3) — явный вызов, НЕ авто-триггер из `record_assignment_actual_time()`
    (та же развязка, что 18.1/18.2's закрытие vs архив). Тот же двойной
    гейт, что 18.3 (`is_current` + `event.status_code == CLOSED`) —
    ServiceHours без валидного факта бессмысленен."""
    if not (actor or "").strip():
        raise DomainError("VALIDATION_ERROR", 400, message="actor обязателен.")
    with transaction.atomic():
        actual = (
            PlacementAssignmentActual.objects.select_for_update()
            .select_related("assignment__version", "assignment__version__event")
            .get(pk=actual.pk)
        )
        version = actual.assignment.version
        if not version.is_current:
            raise DomainError(
                "INVALID_LIFECYCLE_TRANSITION",
                422,
                message="Налёт часов можно вычислить только для актуальной версии.",
            )
        if version.event.status_code != SecurityEvent.StatusCode.CLOSED:
            raise DomainError(
                "INVALID_LIFECYCLE_TRANSITION",
                422,
                message="Налёт часов можно вычислить только после закрытия события.",
            )
        day_hours, night_hours = _split_day_night_hours(
            actual.actual_start_at, actual.actual_end_at
        )
        # review (Acceptance Auditor): 18.3's sibling function captures
        # old_value on recompute — этот вызов раньше не делал этого,
        # асимметрия без обоснования устранена ради того же audit-trail.
        existing_hours = ServiceHours.objects.filter(actual=actual).first()
        old_value = (
            {
                "day_hours": str(existing_hours.day_hours),
                "night_hours": str(existing_hours.night_hours),
            }
            if existing_hours
            else None
        )
        hours, _ = ServiceHours.objects.update_or_create(
            actual=actual,
            defaults={
                "day_hours": day_hours,
                "night_hours": night_hours,
                "computed_at": Clock.now(),
            },
        )
        record(
            actor=actor,
            action="SERVICE_HOURS_COMPUTED",
            entity_type="service_hours",
            entity_id=uuid.UUID(int=hours.pk),
            old_value=old_value,
            new_value={
                "actual_id": actual.pk,
                "day_hours": str(hours.day_hours),
                "night_hours": str(hours.night_hours),
            },
        )
    return hours


def flag_post_overload(service_hours, *, actor):
    """Story 18.5 (FR-32's «превышение лимита Поста» half): сравнивает
    `ServiceHours.day_hours+night_hours` (18.4) с `Post.max_service_minutes`
    (14.2) через `service_hours.actual.assignment.post` — явный вызов, НЕ
    авто-триггер из `compute_service_hours()` (тот же принцип разделения,
    что 18.1/18.2's закрытие vs архив). Тот же двойной гейт, что 18.3/18.4
    (`is_current` + `event.status_code == CLOSED`). Граница — строго
    больше лимита (`>`), не `>=`: факт ровно на лимите — не перегрузка."""
    if not (actor or "").strip():
        raise DomainError("VALIDATION_ERROR", 400, message="actor обязателен.")
    with transaction.atomic():
        service_hours = (
            ServiceHours.objects.select_for_update()
            .select_related(
                "actual__assignment__post",
                "actual__assignment__version",
                "actual__assignment__version__event",
            )
            .get(pk=service_hours.pk)
        )
        version = service_hours.actual.assignment.version
        if not version.is_current:
            raise DomainError(
                "INVALID_LIFECYCLE_TRANSITION",
                422,
                message="Перегрузку можно отметить только для актуальной версии.",
            )
        if version.event.status_code != SecurityEvent.StatusCode.CLOSED:
            raise DomainError(
                "INVALID_LIFECYCLE_TRANSITION",
                422,
                message="Перегрузку можно отметить только после закрытия события.",
            )
        post = service_hours.actual.assignment.post
        total_minutes = (service_hours.day_hours + service_hours.night_hours) * 60
        limit_minutes = Decimal(post.max_service_minutes)
        is_overloaded = total_minutes > limit_minutes
        overload_minutes = (
            (total_minutes - limit_minutes) if is_overloaded else Decimal("0.00")
        )
        old_value = {
            "is_overloaded": service_hours.is_overloaded,
            "overload_minutes": str(service_hours.overload_minutes),
        }
        service_hours.is_overloaded = is_overloaded
        service_hours.overload_minutes = overload_minutes
        service_hours.save(update_fields=["is_overloaded", "overload_minutes"])
        record(
            actor=actor,
            action="POST_OVERLOAD_FLAGGED",
            entity_type="service_hours",
            entity_id=uuid.UUID(int=service_hours.pk),
            old_value=old_value,
            new_value={
                "is_overloaded": service_hours.is_overloaded,
                "overload_minutes": str(service_hours.overload_minutes),
                "post_max_service_minutes": post.max_service_minutes,
            },
        )
    return service_hours
