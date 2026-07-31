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
import uuid

from django.conf import settings
from django.db import transaction
from django.db.models import Q

from apps.audit.services import record
from apps.core.clock import Clock
from apps.core.exceptions import DomainError
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
from apps.operations.facilities.models import Post
from apps.operations.rbac.models import UserRole


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
            event=event, status=AssignmentVersion.Status.DRAFT
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
