import pytest
from django.core.management import call_command

from apps.operations.statuses.models import HARD_STATUS_TYPE_CODES, StatusType
from apps.operations.statuses.services.strength_report import (
    ATTACHED_CODE,
    REPORT_COLUMN_BY_CODE,
    STATUS_TYPE_PRIORITIES,
)

pytestmark = pytest.mark.django_db

EXPECTED_COUNT = 17
# Story 3.9: PENDING_CLARIFICATION is now a first-class strength_report column
# (its own «уточняется» row), so the catalog matches the constants exactly.
EXTRA_BEYOND_STRENGTH_REPORT: set = set()


def _seed():
    call_command("seed_statuses")


def test_seed_creates_all_types():
    _seed()
    assert StatusType.objects.count() == EXPECTED_COUNT
    codes = set(StatusType.objects.values_list("code", flat=True))
    # AC-4: catalog == strength_report constants + the pending type.
    assert codes == set(STATUS_TYPE_PRIORITIES) | EXTRA_BEYOND_STRENGTH_REPORT
    assert codes == set(REPORT_COLUMN_BY_CODE) | EXTRA_BEYOND_STRENGTH_REPORT


def test_seed_is_idempotent():
    _seed()
    _seed()
    assert StatusType.objects.count() == EXPECTED_COUNT


def test_reseed_preserves_operator_edits_but_resyncs_canon():
    # Story 2.12 / deferred #L174: once StatusType is Admin-editable (2.11), the
    # operator-owned fields (is_active, color) must survive a re-seed
    # (create_defaults), while canon fields stay re-synced from STATUS_TYPES
    # (defaults) so the operator cannot fork the catalog.
    _seed()
    row = StatusType.objects.get(code="IN_SERVICE")
    row.is_active = False  # operator deactivates via Admin
    row.color = "#abc123"  # operator sets a palette value via Admin
    row.name = "ОПЕРАТОРСКИЙ МУСОР"  # canon field — must be overwritten on re-seed
    row.save()

    _seed()  # nightly re-seed

    row.refresh_from_db()
    assert row.is_active is False  # operator edit survives
    assert row.color == "#abc123"  # operator edit survives
    assert row.name == "В строю"  # canon re-synced from code


def test_exactly_four_hard_blocks_match_constant():
    _seed()
    hard = set(
        StatusType.objects.filter(is_hard_block=True).values_list("code", flat=True)
    )
    # AC-3: hard set is exactly the codes employee_status guards.
    assert hard == set(HARD_STATUS_TYPE_CODES)
    assert len(hard) == 4


def test_priorities_and_columns_match_strength_report():
    _seed()
    for st in StatusType.objects.exclude(code__in=EXTRA_BEYOND_STRENGTH_REPORT):
        assert st.priority == STATUS_TYPE_PRIORITIES[st.code]
        assert st.report_column_code == REPORT_COLUMN_BY_CODE[st.code]


def test_counts_in_staff_false_only_for_attached():
    _seed()
    not_in_staff = set(
        StatusType.objects.filter(counts_in_staff=False).values_list("code", flat=True)
    )
    assert not_in_staff == {ATTACHED_CODE}


def test_restricts_editing_only_for_detached():
    _seed()
    restricting = set(
        StatusType.objects.filter(restricts_editing=True).values_list("code", flat=True)
    )
    assert restricting == {"DETACHED"}


def test_is_ku_owned_matches_db_ops_003():
    _seed()
    ku_owned = set(
        StatusType.objects.filter(is_ku_owned=True).values_list("code", flat=True)
    )
    # DB-OPS-003: KU owns the absence catalog; operational statuses are
    # system-owned. Independent expectation guards the seed's KU_OWNED_CODES set.
    assert ku_owned == {
        "SICK_LEAVE",
        "LEAVE_BY_REPORT",
        "VACATION",
        "COMMAND",
        "STUDY",
        "COMPETITION",
        "CONFERENCE",
        "OTHER_ABSENCE",
        "DETACHED",
        "ATTACHED",
    }


def test_pending_clarification_values():
    _seed()
    pending = StatusType.objects.get(code="PENDING_CLARIFICATION")
    # Story 3.9 (Решение №1): own расход column "PENDING"; priority 990 keeps it
    # below every real fact but above derived «В строю»; soft; counts in list.
    assert pending.priority == 990
    assert pending.report_column_code == "PENDING"
    assert pending.is_hard_block is False
    assert pending.counts_in_staff is True
    assert pending.counts_in_list is True
