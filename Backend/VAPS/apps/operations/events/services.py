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

import uuid

from django.db import transaction

from apps.audit.services import record
from apps.core.clock import Clock
from apps.core.exceptions import DomainError
from apps.operations.events.models import (
    SecurityEvent,
    SecurityEventChecklistItem,
    SecurityEventSectorPost,
)


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
