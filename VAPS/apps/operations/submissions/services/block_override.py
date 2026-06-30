"""Story 5.6b — record a legal override of the next-day lock.

A руководитель legally lifts the 5.6a block for a ``business_date`` with a
mandatory reason. The override is a visible accountability record (who/when/why);
the derive (``tomorrow_block``) consults it. No HTTP/422/permission-codes (API
5.8), no audit (5.9 emits ``TOMORROW_BLOCK_OVERRIDDEN``), no RBAC (право — на
API-слое).
"""

from django.db import IntegrityError, transaction

from apps.operations.submissions.models import TomorrowBlockOverride


def override_tomorrow_block(business_date, actor, reason) -> TomorrowBlockOverride:
    """Record a date-level override; raise ``ValueError`` on bad input or a duplicate.

    Both the «why» (``reason``) and the «who» (``actor``) are mandatory and
    non-blank — stored stripped (the DB also enforces non-blank as the last line).
    A second override for the same date is rejected as a clean ``ValueError`` (not
    a raw ``IntegrityError``): the ``create`` runs in its own ``transaction.atomic``
    so the ``UniqueConstraint`` violation rolls back only that savepoint and never
    poisons an enclosing transaction (the future API 5.8 request).
    """
    if not reason or not reason.strip():
        raise ValueError("override requires a non-empty reason")
    if not actor or not actor.strip():
        raise ValueError("override requires an actor")
    try:
        with transaction.atomic():
            return TomorrowBlockOverride.objects.create(
                business_date=business_date,
                overridden_by=actor.strip(),
                reason=reason.strip(),
            )
    except IntegrityError as exc:
        raise ValueError(f"override already exists for {business_date}") from exc
