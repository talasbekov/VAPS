"""Story 5.6b — record a legal override of the next-day lock.

A руководитель legally lifts the 5.6a block for a ``business_date`` with a
mandatory reason. The override is a visible accountability record (who/when/why);
the derive (``tomorrow_block``) consults it. No HTTP/422/permission-codes (API
5.8), no RBAC (право — на API-слое). Audit: ``TOMORROW_BLOCK_OVERRIDDEN``
through the single ``record()`` (5.9, canon 4.4).
"""

import uuid
from datetime import date

from django.db import IntegrityError, transaction

from apps.audit.services import record
from apps.operations.submissions.models import TomorrowBlockOverride

# Deterministic namespace for the override's audit entity_id (story 5.9, Д1):
# TomorrowBlockOverride carries no UUID of its own (int PK, no FK), while
# AuditLog.entity_id is a NOT NULL UUIDField. uuid5 over the business_date keeps
# the canon intact WITHOUT a migration and gives the date a stable entity axis —
# future same-date events (e.g. a revocation) would share the entity_id and
# idx_audit_entity stays useful; the int PK rides in new_value.
_AUDIT_ENTITY_NS = uuid.uuid5(uuid.NAMESPACE_URL, "vaps:tomorrow-block-override")


@transaction.atomic
def override_tomorrow_block(business_date, actor, reason) -> TomorrowBlockOverride:
    """Record a date-level override; raise ``ValueError`` on bad input or a duplicate.

    Both the «why» (``reason``) and the «who» (``actor``) are mandatory and
    non-blank — stored stripped (the DB also enforces non-blank as the last line).
    A second override for the same date is rejected as a clean ``ValueError`` (not
    a raw ``IntegrityError``): the ``create`` runs in a nested ``transaction.atomic``
    so the ``UniqueConstraint`` violation rolls back only that savepoint and never
    poisons an enclosing transaction (the enclosing API request — override-API is
    story 6.10). The OUTER ``@transaction.atomic`` (5.9) keeps the mutation and its
    audit row in ONE transaction; the duplicate path raises before ``record`` is
    reached.
    """
    # Plain date ONLY (mirror of clock.catchup_plan): datetime IS-A date and a
    # str/None would reach the DB via lookup coercion or blow up later, but all
    # of them would silently derive a DIFFERENT uuid5 entity_id and a non-ISO
    # payload date — the per-date audit axis must be canonical (code-review п2).
    if type(business_date) is not date:
        raise ValueError(
            f"override requires a plain date business_date, got {type(business_date)!r}"
        )
    if not reason or not reason.strip():
        raise ValueError("override requires a non-empty reason")
    if not actor or not actor.strip():
        raise ValueError("override requires an actor")
    try:
        with transaction.atomic():
            override = TomorrowBlockOverride.objects.create(
                business_date=business_date,
                overridden_by=actor.strip(),
                reason=reason.strip(),
            )
    except IntegrityError as exc:
        raise ValueError(f"override already exists for {business_date}") from exc
    record(
        actor=actor.strip(),
        action="TOMORROW_BLOCK_OVERRIDDEN",
        entity_type="tomorrow_block_override",
        entity_id=uuid.uuid5(_AUDIT_ENTITY_NS, str(business_date)),
        old_value=None,
        new_value={
            "override_id": override.pk,
            "business_date": str(business_date),
            "overridden_by": override.overridden_by,
            "reason": override.reason,
        },
        reason=reason.strip(),
    )
    return override
