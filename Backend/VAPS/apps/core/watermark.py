"""Watermark gateway (ARCH-DATA-022) — materialization bookkeeping.

The core-owned access point for the ``Watermark`` model, so other contexts
(e.g. ``apps.operations`` status-effects catch-up, Story 3.12) never import
``apps.core.models`` directly (ARCH-004 isolation). Pure data access — the
catch-up POLICY (plan, locking, batching) lives in the consuming engine; the
date math stays in ``apps.core.clock.catchup_plan``.
"""

from apps.core.models import Watermark


def get_or_bootstrap(key, *, default_date):
    """Return ``(last_materialized_date, created)`` for the watermark ``key``.

    A missing watermark is created at ``default_date`` — the model has no
    NOW()-default; bootstrapping is the consumer's responsibility. ``created``
    is ``True`` only on that first creation (the caller treats it as «fresh
    deploy, no retroactive backfill»).
    """
    wm, created = Watermark.objects.get_or_create(
        key=key, defaults={"last_materialized_date": default_date}
    )
    return wm.last_materialized_date, created


def advance(key, *, to_date):
    """Move the watermark ``key`` forward to ``to_date`` (refreshes updated_at)."""
    wm = Watermark.objects.get(key=key)
    wm.last_materialized_date = to_date
    wm.save(update_fields=["last_materialized_date", "updated_at"])
