"""Story 7.9/AC-1 — подпись сверки: append-only, actor required, audit trail."""

import uuid
from datetime import date

import pytest

from apps.audit.models import AuditLog
from apps.migration_legacy.models import RosterReconciliationSignature
from apps.migration_legacy.roster_signature import latest_signature, record_signature

pytestmark = pytest.mark.django_db

DIVISION_ID = uuid.uuid4()
ON_DATE = date(2026, 6, 4)


def test_record_signature_writes_row_and_audit():
    signature = record_signature(
        DIVISION_ID, ON_DATE, actor="bratan", discrepancy_count=3, notes="3 расхождения"
    )

    assert signature.division_id == DIVISION_ID
    assert signature.discrepancy_count == 3
    assert AuditLog.objects.filter(
        action="ROSTER_RECONCILIATION_SIGNED",
        entity_type="roster_reconciliation",
        entity_id=DIVISION_ID,
        actor_user_id="bratan",
    ).exists()


def test_record_signature_requires_actor():
    with pytest.raises(ValueError, match="actor"):
        record_signature(DIVISION_ID, ON_DATE, actor="", discrepancy_count=0)


def test_record_signature_rejects_negative_discrepancy_count():
    with pytest.raises(ValueError, match="отрицательным"):
        record_signature(DIVISION_ID, ON_DATE, actor="bratan", discrepancy_count=-1)


def test_repeat_signature_creates_second_row_not_overwrite():
    """AC-1 follow-up: вторая сверка той же пары после исправлений —
    НОВАЯ строка, первая остаётся видна."""
    record_signature(DIVISION_ID, ON_DATE, actor="bratan", discrepancy_count=3)
    record_signature(DIVISION_ID, ON_DATE, actor="bratan", discrepancy_count=0)

    assert (
        RosterReconciliationSignature.objects.filter(
            division_id=DIVISION_ID, business_date=ON_DATE
        ).count()
        == 2
    )


def test_latest_signature_returns_most_recent_by_signed_at_not_insertion():
    first = record_signature(DIVISION_ID, ON_DATE, actor="bratan", discrepancy_count=3)
    second = record_signature(DIVISION_ID, ON_DATE, actor="bratan", discrepancy_count=0)

    latest = latest_signature(DIVISION_ID, ON_DATE)

    assert latest.id == second.id
    assert latest.signed_at >= first.signed_at


def test_latest_signature_none_when_never_signed():
    assert latest_signature(DIVISION_ID, ON_DATE) is None


def test_latest_signature_without_date_scopes_to_whole_division():
    other_date = date(2026, 6, 5)
    record_signature(DIVISION_ID, ON_DATE, actor="bratan", discrepancy_count=1)
    latest_row = record_signature(
        DIVISION_ID, other_date, actor="bratan", discrepancy_count=0
    )

    result = latest_signature(DIVISION_ID)

    assert result.id == latest_row.id
