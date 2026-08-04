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

from django.conf import settings
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
    PlacementAssignment,
    SecurityEvent,
    SecurityEventChecklistItem,
    SecurityEventSectorPost,
    SecurityEventStaffingDemand,
)
from apps.operations.duties.services import _to_date_range
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
