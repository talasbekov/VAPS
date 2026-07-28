"""Story 7.9 — сверка списков с реальностью: подпись владельца расхода.

``RosterReconciliationSignature`` is append-only, NOT unique on
(division_id, business_date): AC-1's "исправляются... с follow-up сверкой"
literally describes a reconcile → correct → RE-reconcile cycle, so a second
sign-off on the same pair after corrections is a NEW row, not an overwrite.
``division_id`` is a flat UUID (ARCH-003 style cross-context reference), not
an FK — ``apps.migration_legacy`` already imports ``apps.core.models``
directly elsewhere (Story 7.2/7.3), but a signature row referencing a
Division shouldn't hard-lock migration_legacy's schema to core's FK graph.
"""

from django.db import models


class RosterReconciliationSignature(models.Model):
    division_id = models.UUIDField()
    business_date = models.DateField()
    signed_by = models.CharField(max_length=100)
    signed_at = models.DateTimeField()
    discrepancy_count = models.IntegerField()
    notes = models.CharField(max_length=1000, blank=True, default="")

    class Meta:
        db_table = "migration_legacy_roster_reconciliation_signature"
        indexes = [
            models.Index(fields=["division_id", "business_date", "signed_at"]),
        ]
        constraints = [
            models.CheckConstraint(
                condition=models.Q(discrepancy_count__gte=0),
                name="chk_roster_reconciliation_discrepancy_count_non_negative",
            ),
        ]
