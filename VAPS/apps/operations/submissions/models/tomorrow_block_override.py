from django.db import models

from apps.operations.models import TimeStampedModel


class TomorrowBlockOverride(TimeStampedModel):
    """Legal override of the next-day lock (Story 5.6b).

    One record per ``business_date`` legally permits расход formation for
    «tomorrow» despite outstanding required-division laggards (5.6a). The override
    is *visible* — it carries who (``overridden_by``), when (``created_at`` from
    ``TimeStampedModel``) and why (``reason``, non-empty). FR-18: «расход
    формируется + Override-запись».

    Date-level, not per-division: the 5.6a block is org-wide (any laggard blocks),
    so one override unblocks the whole date. Flat references only (ARCH-003 — no FK
    into ``core``); ``overridden_by`` is a plain string id, mirroring
    ``DailySubmission.submitted_by`` (a required domain actor distinct from the
    base's optional ``created_by``).

    Scope (5.6b): persistence + the derive consultation. No audit
    (``TOMORROW_BLOCK_OVERRIDDEN`` is Story 5.9), no API/422/RBAC (5.8), no
    revocation. Not an Admin reference table — a business record, so it is NOT
    registered in Admin.
    """

    business_date = models.DateField()
    # Non-blank by DB CheckConstraint (rejects "" AND whitespace-only): «легальный
    # обход С ПРИЧИНОЙ». ``.create()`` bypasses full_clean, so the invariant truly
    # lives on the DB, not only in the service guard.
    reason = models.TextField()
    # Accountability: a legal override must carry a real «who» — non-blank,
    # DB-enforced, mirroring ``reason``.
    overridden_by = models.CharField(max_length=100)

    class Meta:
        db_table = "ops_tomorrow_block_overrides"
        constraints = [
            models.CheckConstraint(
                condition=~models.Q(reason__regex=r"^\s*$"),
                name="ck_tomorrow_block_override_reason_not_blank",
            ),
            models.CheckConstraint(
                condition=~models.Q(overridden_by__regex=r"^\s*$"),
                name="ck_tomorrow_block_override_actor_not_blank",
            ),
            # Date-level: exactly one active override per business_date.
            models.UniqueConstraint(
                fields=["business_date"],
                name="uq_tomorrow_block_override_date",
            ),
        ]
        verbose_name = "Обход блокировки на завтра"
        verbose_name_plural = "Обходы блокировки на завтра"

    def __str__(self):
        return f"override {self.business_date} by {self.overridden_by}"
