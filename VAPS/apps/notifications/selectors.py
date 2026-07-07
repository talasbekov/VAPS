"""Story 5.7c — read-side selector for notifications (FR-13 delivery surface).

The read path lives INSIDE ``apps/notifications`` (layer contract,
architecture.md#L451 — the selector is the single read channel; the ViewSet
stays thin). Unlike ``AuditLogSelector`` (a flat journal — an ``audit.view``
holder sees everything), notifications are PERSONAL: ``list`` filters
``recipient == actor`` UNCONDITIONALLY, so a caller can only ever read their own
rows. That recipient filter — not an RBAC code — is the access control
(реш. 5.7c: any-auth + self-scope).
"""

from apps.notifications.models import Notification


class NotificationSelector:
    """Self-scoped, deterministically-ordered reads over ``notifications``."""

    @staticmethod
    def list(actor, *, since=None):
        """Return the caller's own notifications, newest first.

        ``actor`` is the requesting user id (``request.actor_id``); it is applied
        as an UNCONDITIONAL ``recipient=`` filter — the single guard that makes
        another recipient's rows unreachable. ``since`` (optional) is a STRICT
        lower bound on ``created_at`` (``created_at > since``, реш. 5.7c Q2): a
        polling cursor returning only rows newer than the last one already seen.

        Ordering is ``(-created_at, id)``: newest first with ``id`` as the
        MANDATORY tie-breaker — without it a LimitOffset page can silently
        drop/duplicate rows sharing a ``created_at`` (architecture.md#L427).

        A blank/None/non-string ``actor`` raises ``ValueError`` — a caller bug
        (mirror of ``notify()``'s blank-recipient guard): failing loud beats
        silently returning an empty queryset for a load-bearing access filter.
        Unreachable via HTTP — the auth layer strips the header and the view
        gate 403s a missing actor_id first.
        """
        if not isinstance(actor, str) or not actor.strip():
            raise ValueError("NotificationSelector.list requires an actor")
        qs = Notification.objects.filter(recipient=actor)
        if since is not None:
            qs = qs.filter(created_at__gt=since)
        return qs.order_by("-created_at", "id")
