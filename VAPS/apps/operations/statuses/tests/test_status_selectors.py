"""Tests for EmployeeStatusSelector.snapshot_facts_on (Story 5.3a).

The DailySubmission snapshot row needs status_id (pk) and source, which
overlapping_on omits; snapshot_facts_on adds them on the same predicate
(cancelled_at IS NULL + period contains the date). overlapping_on must stay
untouched — strength_report rides it.
"""

import uuid
from datetime import date

import pytest
from django.utils import timezone

from django.core.management import call_command

from apps.operations.statuses.models import EmployeeStatus
from apps.operations.statuses.selectors import (
    EmployeeStatusSelector,
    StatusTypeSelector,
)

pytestmark = pytest.mark.django_db


def test_snapshot_facts_on_returns_id_and_source():
    emp = uuid.uuid4()
    st = EmployeeStatus.objects.create(
        employee_id=emp,
        status_type_code="DUTY",
        date_start=date(2026, 6, 1),
        date_end=date(2026, 6, 10),
        source="USER",
    )
    facts = EmployeeStatusSelector.snapshot_facts_on(date(2026, 6, 4), [emp])
    assert len(facts) == 1
    fact = facts[0]
    assert fact["id"] == st.id
    assert fact["employee_id"] == emp
    assert fact["status_type_code"] == "DUTY"
    assert fact["date_start"] == date(2026, 6, 1)
    assert fact["date_end"] == date(2026, 6, 10)
    assert fact["source"] == "USER"


def test_snapshot_facts_on_adds_what_overlapping_on_omits():
    # The reason snapshot_facts_on exists: overlapping_on drops id + source.
    emp = uuid.uuid4()
    EmployeeStatus.objects.create(
        employee_id=emp,
        status_type_code="DUTY",
        date_start=date(2026, 6, 1),
        date_end=date(2026, 6, 10),
        source="USER",
    )
    over = EmployeeStatusSelector.overlapping_on(date(2026, 6, 4), [emp])[0]
    snap = EmployeeStatusSelector.snapshot_facts_on(date(2026, 6, 4), [emp])[0]
    assert "id" not in over and "source" not in over
    assert "id" in snap and "source" in snap


def test_snapshot_facts_on_excludes_cancelled():
    emp = uuid.uuid4()
    EmployeeStatus.objects.create(
        employee_id=emp,
        status_type_code="DUTY",
        date_start=date(2026, 6, 1),
        date_end=date(2026, 6, 10),
        source="USER",
        cancelled_at=timezone.now(),
    )
    assert EmployeeStatusSelector.snapshot_facts_on(date(2026, 6, 4), [emp]) == []


def test_snapshot_facts_on_half_open_boundary():
    # [date_start, date_end): the fact does NOT act on date_end (ARCH-DATA-023).
    emp = uuid.uuid4()
    EmployeeStatus.objects.create(
        employee_id=emp,
        status_type_code="DUTY",
        date_start=date(2026, 6, 1),
        date_end=date(2026, 6, 4),
        source="USER",
    )
    assert EmployeeStatusSelector.snapshot_facts_on(date(2026, 6, 4), [emp]) == []
    assert len(EmployeeStatusSelector.snapshot_facts_on(date(2026, 6, 3), [emp])) == 1


def test_snapshot_facts_on_scopes_to_employee_ids():
    keep, other = uuid.uuid4(), uuid.uuid4()
    for emp in (keep, other):
        EmployeeStatus.objects.create(
            employee_id=emp,
            status_type_code="VACATION",
            date_start=date(2026, 6, 1),
            date_end=date(2026, 6, 10),
            source="USER",
        )
    facts = EmployeeStatusSelector.snapshot_facts_on(date(2026, 6, 4), [keep])
    assert [f["employee_id"] for f in facts] == [keep]


# --- StatusTypeSelector (Story 10.8) ----------------------------------------


def test_names_map_returns_the_seeded_catalog():
    """Вакуум-гвард нового селектора: пустой словарь не должен быть успехом."""
    call_command("seed_statuses")
    names = StatusTypeSelector.names_map()
    assert names
    assert names["IN_SERVICE"] == "В строю"
    assert names["SICK_LEAVE"]


def test_names_map_is_empty_without_the_seed():
    # Знаменатель гварда выше: словарь непуст ИМЕННО из-за посева, а не
    # потому, что селектор возвращает что-то само по себе.
    assert StatusTypeSelector.names_map() == {}
