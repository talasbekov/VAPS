"""Story 19.5a (FR-37) — EmployeeStatusSelector.division_month_calendar():
bulk per-day status for MULTIPLE employees over a whole month, one query
regardless of how many employee_ids are passed."""

import uuid
from datetime import date

import pytest
from django.db import connection
from django.test.utils import CaptureQueriesContext

from apps.operations.statuses.models import EmployeeStatus
from apps.operations.statuses.selectors import EmployeeStatusSelector

pytestmark = pytest.mark.django_db


def test_every_requested_employee_present_as_a_key():
    emp1, emp2, emp3 = uuid.uuid4(), uuid.uuid4(), uuid.uuid4()
    EmployeeStatus.objects.create(
        employee_id=emp1,
        status_type_code="VACATION",
        date_start=date(2026, 8, 1),
        date_end=date(2026, 8, 5),
    )

    result = EmployeeStatusSelector.division_month_calendar([emp1, emp2, emp3], 2026, 8)

    assert set(result.keys()) == {emp1, emp2, emp3}


def test_employee_with_no_facts_gets_all_in_service():
    emp = uuid.uuid4()

    result = EmployeeStatusSelector.division_month_calendar([emp], 2026, 8)

    assert all(code == "IN_SERVICE" for code in result[emp].values())
    assert len(result[emp]) == 31


def test_two_employees_facts_do_not_cross_contaminate():
    emp1, emp2 = uuid.uuid4(), uuid.uuid4()
    EmployeeStatus.objects.create(
        employee_id=emp1,
        status_type_code="VACATION",
        date_start=date(2026, 8, 5),
        date_end=date(2026, 8, 10),
    )
    EmployeeStatus.objects.create(
        employee_id=emp2,
        status_type_code="SICK_LEAVE",
        date_start=date(2026, 8, 15),
        date_end=date(2026, 8, 20),
    )

    result = EmployeeStatusSelector.division_month_calendar([emp1, emp2], 2026, 8)

    assert result[emp1][date(2026, 8, 5)] == "VACATION"
    assert result[emp1][date(2026, 8, 15)] == "IN_SERVICE"
    assert result[emp2][date(2026, 8, 15)] == "SICK_LEAVE"
    assert result[emp2][date(2026, 8, 5)] == "IN_SERVICE"


def test_empty_employee_list_returns_empty_dict():
    result = EmployeeStatusSelector.division_month_calendar([], 2026, 8)

    assert result == {}


def test_accepts_a_generator_not_just_a_list():
    """review (Blind Hunter): employee_ids is consumed twice internally
    (queryset filter, then the result dict comprehension) — a generator
    would be exhausted after the first pass and silently return {}."""
    emp1, emp2 = uuid.uuid4(), uuid.uuid4()

    result = EmployeeStatusSelector.division_month_calendar(
        (e for e in (emp1, emp2)), 2026, 8
    )

    assert set(result.keys()) == {emp1, emp2}


def test_fact_crossing_month_boundary_handled_per_employee():
    emp1, emp2 = uuid.uuid4(), uuid.uuid4()
    EmployeeStatus.objects.create(
        employee_id=emp1,
        status_type_code="COMMAND",
        date_start=date(2026, 7, 20),
        date_end=date(2026, 8, 5),
    )
    EmployeeStatus.objects.create(
        employee_id=emp2,
        status_type_code="COMMAND",
        date_start=date(2026, 8, 28),
        date_end=date(2026, 9, 3),
    )

    result = EmployeeStatusSelector.division_month_calendar([emp1, emp2], 2026, 8)

    assert result[emp1][date(2026, 8, 1)] == "COMMAND"
    assert result[emp1][date(2026, 8, 5)] == "IN_SERVICE"
    assert result[emp2][date(2026, 8, 28)] == "COMMAND"
    assert result[emp2][date(2026, 8, 31)] == "COMMAND"


def test_single_bulk_query_regardless_of_employee_count():
    employee_ids = [uuid.uuid4() for _ in range(25)]
    EmployeeStatus.objects.create(
        employee_id=employee_ids[0],
        status_type_code="DUTY",
        date_start=date(2026, 8, 5),
        date_end=date(2026, 8, 6),
    )

    with CaptureQueriesContext(connection) as ctx:
        EmployeeStatusSelector.division_month_calendar(employee_ids, 2026, 8)

    assert len(ctx.captured_queries) == 1
