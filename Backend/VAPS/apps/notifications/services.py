"""Story 5.7a — emit a notification (idempotent, in the caller's transaction).

``notify()`` is the single write-primitive behind FR-13. It writes synchronously
inside the caller's transaction (Review D1 → variant B): the row is visible at
once, ``notify()`` returns it, and a rolled-back business transaction takes the
notification with it (no phantom — via the insert's own rollback, not a discarded
commit hook). Idempotent on ``(recipient, kind, business_date)`` via
``get_or_create`` — a repeat call (or a concurrent race) is a no-op, never a raw
``IntegrityError`` (``get_or_create`` absorbs the ``UniqueConstraint`` hit inside
its own savepoint, so it never poisons the enclosing transaction — lesson 5.6b).

Emission is a non-fatal side-channel (Review D2): a blank ``recipient`` is a
programming error and raises loudly, but any infrastructure failure (DB down,
serialization) is logged and swallowed so a notification never breaks an
already-valid business operation.

Scope (5.7a): write-primitive only. Lagging detection / recipient resolution is
Story 5.7b; the read-API is 5.7c; WS delivery is E11.
"""

import logging

from apps.notifications.models import Notification

logger = logging.getLogger(__name__)


def notify(recipient, kind, business_date, payload=None) -> Notification | None:
    """Idempotently emit a notification inside the caller's transaction.

    «Одно уведомление на день»: the first call for a given
    ``(recipient, kind, business_date)`` creates the row (with ``payload``);
    later calls are no-ops (the first payload wins). ``recipient`` is stripped so
    whitespace variants cannot defeat the one-per-day key (lesson 5.6b). Returns
    the row (created or existing), or ``None`` if emission failed (logged,
    non-fatal). Raises ``ValueError`` on a blank recipient (caller bug).
    """
    if not recipient or not recipient.strip():
        raise ValueError("notify requires a recipient")
    recipient = recipient.strip()
    payload = payload or {}

    try:
        notification, _ = Notification.objects.get_or_create(
            recipient=recipient,
            kind=kind,
            business_date=business_date,
            defaults={"payload": payload},
        )
        return notification
    except Exception:
        # Side-channel (FR-13) must never break an already-valid business op:
        # get_or_create's savepoint already absorbs the duplicate/race
        # IntegrityError (5.6b); anything else (DB down, serialization) is logged
        # and swallowed rather than propagated.
        logger.exception(
            "notify() failed for recipient=%r kind=%r business_date=%r",
            recipient,
            kind,
            business_date,
        )
        return None
