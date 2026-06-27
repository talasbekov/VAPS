"""Story 4.5 — read-side selector for the audit log (FR-36).

The read path lives INSIDE ``apps/audit`` (4.3 AC-4): the AST write-boundary ban
forbids importing ``apps.audit.models`` from OUTSIDE the app, so the read
selector is an audit resident. Per the layer contract (architecture.md
§Layer Contract) the selector is the single read channel — it owns filtering and
deterministic ordering; the ViewSet stays thin and never queries the model.
"""

from apps.audit.models import AuditLog


class AuditLogSelector:
    """Filtered, deterministically-ordered reads over ``audit_logs``."""

    @staticmethod
    def list(
        actor,
        *,
        entity_type=None,
        entity_id=None,
        actor_user_id=None,
        action=None,
        created_from=None,
        created_to=None,
    ):
        """Return audit rows matching the AND-combined filters (only the ones
        supplied are applied).

        ``actor`` is the requesting user id, accepted first per the layer
        contract (architecture.md#L451). The audit permission ``audit.view`` is
        flat — architecture is silent on division-scope (реш. №3) — so the
        selector does NOT narrow visibility by actor: an ``audit.view`` holder
        sees the whole journal. ``actor`` is kept for forward compatibility.

        ``created_from``/``created_to`` form a half-open ``[from, to)`` window
        (consistent with the calendar ``[start, end)`` convention of E3).

        Ordering is ``(-created_at, id)``: ``created_at`` DESC with ``id`` as the
        MANDATORY tie-breaker — bulk audit (4.4) writes N rows with a single
        ``Clock.now()``, so equal ``created_at`` is real; without ``id`` a
        LimitOffset page silently drops/duplicates rows (architecture.md#L427).
        """
        qs = AuditLog.objects.all()
        if entity_type is not None:
            qs = qs.filter(entity_type=entity_type)
        if entity_id is not None:
            qs = qs.filter(entity_id=entity_id)
        if actor_user_id is not None:
            qs = qs.filter(actor_user_id=actor_user_id)
        if action is not None:
            qs = qs.filter(action=action)
        if created_from is not None:
            qs = qs.filter(created_at__gte=created_from)
        if created_to is not None:
            qs = qs.filter(created_at__lt=created_to)
        return qs.order_by("-created_at", "id")

    @staticmethod
    def get(actor, pk):
        """Single audit row by pk (retrieve). The ``.get`` lives HERE, not in the
        view (architecture.md#L451 — no ``get_object_or_404`` in the view). Raises
        ``AuditLog.DoesNotExist`` for a missing row (the view maps it to 404)."""
        return AuditLog.objects.get(pk=pk)
