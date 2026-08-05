"""Story 19.4a (FR-37) — EmployeeStatusSelector.month_calendar(): bulk
per-day status for one employee over a whole month."""

import calendar
import uuid
from datetime import date

import pytest
from django.test.utils import CaptureQueriesContext
from django.db import connection

from apps.operations.statuses.models import EmployeeStatus
from apps.operations.statuses.selectors import EmployeeStatusSelector

pytestmark = pytest.mark.django_db


def test_status_covering_whole_month():
    emp = uuid.uuid4()
    EmployeeStatus.objects.create(
        employee_id=emp,
        status_type_code="VACATION",
        date_start=date(2026, 8, 1),
        date_end=date(2026, 9, 1),
    )

    calendar_map = EmployeeStatusSelector.month_calendar(emp, 2026, 8)

    assert all(code == "VACATION" for code in calendar_map.values())


def test_no_facts_defaults_to_in_service_every_day():
    emp = uuid.uuid4()

    calendar_map = EmployeeStatusSelector.month_calendar(emp, 2026, 8)

    assert all(code == "IN_SERVICE" for code in calendar_map.values())


def test_partial_month_status_leaves_rest_in_service():
    emp = uuid.uuid4()
    EmployeeStatus.objects.create(
        employee_id=emp,
        status_type_code="SICK_LEAVE",
        date_start=date(2026, 8, 10),
        date_end=date(2026, 8, 16),
    )

    calendar_map = EmployeeStatusSelector.month_calendar(emp, 2026, 8)

    for day in range(10, 16):
        assert calendar_map[date(2026, 8, day)] == "SICK_LEAVE"
    assert calendar_map[date(2026, 8, 1)] == "IN_SERVICE"
    assert calendar_map[date(2026, 8, 16)] == "IN_SERVICE"
    assert calendar_map[date(2026, 8, 31)] == "IN_SERVICE"


def test_fact_crossing_month_boundary_from_previous_month():
    emp = uuid.uuid4()
    EmployeeStatus.objects.create(
        employee_id=emp,
        status_type_code="COMMAND",
        date_start=date(2026, 7, 20),
        date_end=date(2026, 8, 5),
    )

    calendar_map = EmployeeStatusSelector.month_calendar(emp, 2026, 8)

    assert calendar_map[date(2026, 8, 1)] == "COMMAND"
    assert calendar_map[date(2026, 8, 4)] == "COMMAND"
    assert calendar_map[date(2026, 8, 5)] == "IN_SERVICE"


def test_two_competing_facts_lower_priority_wins():
    """SICK_LEAVE (hard, priority 10) outranks DUTY (soft, priority 70).
    Uses a hard+soft pair (not hard+hard) because `excl_hard_status_overlap`
    (ARCH-DATA-020) forbids two overlapping HARD statuses at the DB level —
    the tie-break this AC exercises is `resolve_status()`'s Python logic,
    not the DB constraint, so a DB-permitted overlapping pair is required."""
    emp = uuid.uuid4()
    EmployeeStatus.objects.create(
        employee_id=emp,
        status_type_code="DUTY",
        date_start=date(2026, 8, 1),
        date_end=date(2026, 8, 31),
    )
    EmployeeStatus.objects.create(
        employee_id=emp,
        status_type_code="SICK_LEAVE",
        date_start=date(2026, 8, 10),
        date_end=date(2026, 8, 12),
    )

    calendar_map = EmployeeStatusSelector.month_calendar(emp, 2026, 8)

    assert calendar_map[date(2026, 8, 10)] == "SICK_LEAVE"
    assert calendar_map[date(2026, 8, 11)] == "SICK_LEAVE"
    assert calendar_map[date(2026, 8, 9)] == "DUTY"


@pytest.mark.parametrize(
    "year,month",
    [(2026, 8), (2024, 2), (2026, 2)],  # leap Feb, non-leap Feb
)
def test_result_has_exactly_one_entry_per_calendar_day(year, month):
    emp = uuid.uuid4()

    calendar_map = EmployeeStatusSelector.month_calendar(emp, year, month)

    assert len(calendar_map) == calendar.monthrange(year, month)[1]


def test_single_bulk_query():
    emp = uuid.uuid4()
    EmployeeStatus.objects.create(
        employee_id=emp,
        status_type_code="DUTY",
        date_start=date(2026, 8, 5),
        date_end=date(2026, 8, 6),
    )

    with CaptureQueriesContext(connection) as ctx:
        EmployeeStatusSelector.month_calendar(emp, 2026, 8)

    assert len(ctx.captured_queries) == 1


def test_fact_ending_exactly_at_month_start_excluded():
    """review (Blind Hunter + Edge Case Hunter): symmetric boundary to
    test_fact_crossing_month_boundary_from_previous_month — a fact whose
    date_end is exactly month_start must NOT bleed into day 1."""
    emp = uuid.uuid4()
    EmployeeStatus.objects.create(
        employee_id=emp,
        status_type_code="COMMAND",
        date_start=date(2026, 7, 25),
        date_end=date(2026, 8, 1),
    )

    calendar_map = EmployeeStatusSelector.month_calendar(emp, 2026, 8)

    assert calendar_map[date(2026, 8, 1)] == "IN_SERVICE"


def test_fact_starting_exactly_at_month_end_excluded():
    """review (Edge Case Hunter): a fact starting the day AFTER the
    queried month ends must not leak into the month's last day — proves
    the SQL period__overlap boundary and resolve_status's per-day
    half-open check agree."""
    emp = uuid.uuid4()
    EmployeeStatus.objects.create(
        employee_id=emp,
        status_type_code="COMMAND",
        date_start=date(2026, 9, 1),
        date_end=date(2026, 9, 5),
    )

    calendar_map = EmployeeStatusSelector.month_calendar(emp, 2026, 8)

    assert calendar_map[date(2026, 8, 31)] == "IN_SERVICE"


def test_cancelled_fact_excluded():
    emp = uuid.uuid4()
    status = EmployeeStatus.objects.create(
        employee_id=emp,
        status_type_code="VACATION",
        date_start=date(2026, 8, 1),
        date_end=date(2026, 8, 31),
    )
    status.cancelled_at = status.created_at
    status.cancelled_by = "tester"
    status.save(update_fields=["cancelled_at", "cancelled_by"])

    calendar_map = EmployeeStatusSelector.month_calendar(emp, 2026, 8)

    assert all(code == "IN_SERVICE" for code in calendar_map.values())


def test_facts_for_other_employee_do_not_leak():
    emp = uuid.uuid4()
    other = uuid.uuid4()
    EmployeeStatus.objects.create(
        employee_id=other,
        status_type_code="VACATION",
        date_start=date(2026, 8, 1),
        date_end=date(2026, 8, 31),
    )

    calendar_map = EmployeeStatusSelector.month_calendar(emp, 2026, 8)

    assert all(code == "IN_SERVICE" for code in calendar_map.values())


def test_two_non_overlapping_facts_leave_gap_as_in_service():
    emp = uuid.uuid4()
    EmployeeStatus.objects.create(
        employee_id=emp,
        status_type_code="VACATION",
        date_start=date(2026, 8, 1),
        date_end=date(2026, 8, 6),
    )
    EmployeeStatus.objects.create(
        employee_id=emp,
        status_type_code="COMMAND",
        date_start=date(2026, 8, 20),
        date_end=date(2026, 8, 25),
    )

    calendar_map = EmployeeStatusSelector.month_calendar(emp, 2026, 8)

    assert calendar_map[date(2026, 8, 3)] == "VACATION"
    assert calendar_map[date(2026, 8, 22)] == "COMMAND"
    assert calendar_map[date(2026, 8, 10)] == "IN_SERVICE"


def test_invalid_month_raises_clear_error():
    emp = uuid.uuid4()

    with pytest.raises(ValueError):
        EmployeeStatusSelector.month_calendar(emp, 2026, 13)

    with pytest.raises(ValueError):
        EmployeeStatusSelector.month_calendar(emp, 2026, 0)
