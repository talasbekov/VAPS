"""Story 5.7a — emit a notification (idempotent, on commit).

``notify()`` is the single write-primitive behind FR-13. It is deferred to
``transaction.on_commit`` so a rolled-back business transaction leaves no phantom
notification, and idempotent on ``(recipient, kind, business_date)`` via
``get_or_create`` — a repeat call (or a concurrent race) is a no-op, never a raw
``IntegrityError`` (``get_or_create`` absorbs the ``UniqueConstraint`` hit inside
its own savepoint, so it cannot poison the enclosing transaction).

Scope (5.7a): write-primitive only. Lagging detection / recipient resolution is
Story 5.7b; the read-API is 5.7c; WS delivery is E11.
"""

from django.db import transaction

from apps.notifications.models import Notification


def notify(recipient, kind, business_date, payload=None) -> None:
    """Idempotently emit a notification once the current transaction commits.

    «Одно уведомление на день»: the first call for a given
    ``(recipient, kind, business_date)`` creates the row (with ``payload``);
    later calls are no-ops (the first payload wins).
    """
    payload = payload or {}

    def _emit():
        Notification.objects.get_or_create(
            recipient=recipient,
            kind=kind,
            business_date=business_date,
            defaults={"payload": payload},
        )

    transaction.on_commit(_emit)
