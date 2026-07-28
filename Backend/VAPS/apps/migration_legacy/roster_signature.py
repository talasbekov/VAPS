"""Story 7.9 — подпись сверки: append-only, actor required (audit trail)."""

from django.db import transaction

from apps.audit.services import record
from apps.core.clock import Clock
from apps.migration_legacy.models import RosterReconciliationSignature


@transaction.atomic
def record_signature(division_id, business_date, *, actor, discrepancy_count, notes=""):
    if not actor:
        raise ValueError("record_signature требует непустой actor (audit trail)")
    if discrepancy_count < 0:
        raise ValueError("discrepancy_count не может быть отрицательным")

    now = Clock.now()
    signature = RosterReconciliationSignature.objects.create(
        division_id=division_id,
        business_date=business_date,
        signed_by=actor,
        signed_at=now,
        discrepancy_count=discrepancy_count,
        notes=notes,
    )
    record(
        actor=actor,
        action="ROSTER_RECONCILIATION_SIGNED",
        entity_type="roster_reconciliation",
        entity_id=division_id,
        reason=notes,
    )
    return signature


def latest_signature(division_id, business_date=None):
    qs = RosterReconciliationSignature.objects.filter(division_id=division_id)
    if business_date is not None:
        qs = qs.filter(business_date=business_date)
    return qs.order_by("-signed_at").first()
