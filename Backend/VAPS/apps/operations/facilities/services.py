"""Story 15.4: `update_passport_for_event()` — ObjectPassport update, gated
to a SecurityEvent's RECON window (FR-22).

First API ObjectPassport gets (14.1 was models + migration only). Scoped
narrowly to the recon-completion checkpoint, not a general passport CRUD —
see the story's Scope Decision for why "before the ОМ starts" was
synthesized as "while the event is in RECON" (after 15.3c's dual control,
before the event advances further).

`events` calling into `facilities` is the same cross-subdomain pattern
already sanctioned for `duties`→`facilities` (Story 14.5) — ARCH-003 only
forbids `operations` importing `apps.core.models` directly, not one
operations subdomain importing another.
"""

import uuid

from django.db import transaction

from apps.audit.services import record
from apps.core.clock import Clock
from apps.core.exceptions import DomainError
from apps.operations.facilities.models import ObjectPassport


def update_passport_for_event(event, *, actor, fields):
    """Partial-update the `ObjectPassport` for `event.object`, stamping
    `last_verified_by`/`last_verified_at`. Strict RECON-only gate — the
    story's title says "before the ОМ starts", i.e. after recon completes
    (15.3c) but before the event advances to DEMAND/BROKERAGE/PLACEMENT+.
    """
    if not (actor or "").strip():
        raise DomainError("VALIDATION_ERROR", 400, message="actor обязателен.")
    # events.models.SecurityEvent.StatusCode.RECON — imported lazily to
    # avoid a facilities->events import at module load (facilities has no
    # existing dependency on events; events already depends on facilities
    # via its Object FK, so the reverse direction stays a one-way edge).
    from apps.operations.events.models import SecurityEvent

    if event.status_code != SecurityEvent.StatusCode.RECON:
        raise DomainError(
            "INVALID_LIFECYCLE_TRANSITION",
            422,
            message="Паспорт можно обновить только пока ОМ в статусе RECON.",
        )
    with transaction.atomic():
        passport, _ = ObjectPassport.objects.select_for_update().get_or_create(
            object=event.object
        )
        for field, value in fields.items():
            setattr(passport, field, value)
        passport.last_verified_by = actor
        passport.last_verified_at = Clock.now()
        passport.save(
            update_fields=[
                *fields.keys(),
                "last_verified_by",
                "last_verified_at",
                "updated_at",
            ]
        )
        record(
            actor=actor,
            action="OBJECT_PASSPORT_UPDATED",
            entity_type="object_passport",
            entity_id=uuid.UUID(int=passport.pk),
            new_value={
                "passport_id": passport.pk,
                "object_id": passport.object_id,
                "security_event_id": event.pk,
                "fields": list(fields.keys()),
            },
        )
    return passport
