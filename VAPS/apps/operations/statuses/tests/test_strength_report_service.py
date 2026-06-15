"""Integration tests: selectors + StrengthReportService on Postgres."""

import itertools
from datetime import date, datetime, timezone as dt_timezone

import pytest

from apps.core.models import (
    Division,
    DivisionHistoricalSlot,
    DivisionType,
    Employee,
    Organization,
)
from apps.core.selectors import local_midnight
from apps.operations.statuses.models import EmployeeStatus
from apps.operations.statuses.selectors import EmployeeStatusSelector
from apps.operations.statuses.services import StrengthReportService

pytestmark = pytest.mark.django_db

D = date(2026, 6, 4)

_iin_seq = itertools.count(100)


@pytest.fixture
def org():
    return Organization.objects.create(name="Орг", code="ORG-SR")


@pytest.fixture
def division(org):
    return make_division(org, "Отдел А", "SR-A")


def make_division(org, name, code, parent=None):
    division_type, _ = DivisionType.objects.get_or_create(
        code="department", defaults={"name": "department"}
    )
    return Division.objects.create(
        organization=org, type_code=division_type, name=name, code=code, parent=parent
    )


def make_employee(division, employment_status="WORKING"):
    n = next(_iin_seq)
    return Employee.objects.create(
        iin=f"{n:012d}",
        full_name=f"Сотрудник {n}",
        rank_code="",
        position_code="",
        division=division,
        employment_status=employment_status,
    )


def make_status(employee, code, date_start, date_end, cancelled_at=None):
    return EmployeeStatus.objects.create(
        employee_id=employee.id,
        status_type_code=code,
        date_start=date_start,
        date_end=date_end,
        cancelled_at=cancelled_at,
    )


def make_slot(division, slots, valid_from_date=date(2026, 6, 1), valid_to=None):
    return DivisionHistoricalSlot.objects.create(
        division=division,
        allocated_slots=slots,
        valid_from=local_midnight(valid_from_date),
        valid_to=valid_to,
    )


def row_for(result, division):
    return next(r for r in result.rows if r.division_id == division.id)


class TestStrengthReportService:
    def test_fallback_in_service_without_statuses(self, division):
        make_employee(division)
        make_slot(division, 1)
        result = StrengthReportService.compute(D)
        row = row_for(result, division)
        assert row.columns["IN_SERVICE"] == 1
        assert (row.staff_total, row.list_total, row.vacancies) == (1, 1, 0)
        assert result.violations == [] and result.warnings == []

    def test_vacation_in_window_lands_in_vacation_column(self, division):
        emp = make_employee(division)
        make_slot(division, 1)
        make_status(emp, "VACATION", date(2026, 6, 2), date(2026, 6, 6))
        row = row_for(StrengthReportService.compute(D), division)
        assert row.columns["VACATION"] == 1
        assert row.columns["IN_SERVICE"] == 0

    def test_attached_is_plus_n_outside_the_list(self, division):
        emp = make_employee(division)
        make_employee(division)
        make_slot(division, 2)
        make_status(emp, "ATTACHED", date(2026, 6, 1), date(2026, 6, 10))
        row = row_for(StrengthReportService.compute(D), division)
        assert row.attached == 1
        assert row.list_total == 1
        assert sum(row.columns.values()) == 1
        assert row.vacancies == 1

    def test_status_ending_on_d_does_not_act_on_d(self, division):
        emp = make_employee(division)
        make_slot(division, 1)
        make_status(emp, "VACATION", date(2026, 6, 1), D)
        row = row_for(StrengthReportService.compute(D), division)
        assert row.columns["IN_SERVICE"] == 1
        assert row.columns["VACATION"] == 0

    def test_cancelled_status_is_invisible(self, division):
        emp = make_employee(division)
        make_slot(division, 1)
        make_status(
            emp,
            "VACATION",
            date(2026, 6, 2),
            date(2026, 6, 6),
            cancelled_at=datetime(2026, 6, 1, 9, 0, tzinfo=dt_timezone.utc),
        )
        row = row_for(StrengthReportService.compute(D), division)
        assert row.columns["IN_SERVICE"] == 1
        assert EmployeeStatusSelector.status_on(emp.id, D) == "IN_SERVICE"

    def test_missing_staffing_record_warns(self, division):
        make_employee(division)
        result = StrengthReportService.compute(D)
        row = row_for(result, division)
        assert row.staff_total == 0
        assert result.warnings == [
            {"division_id": division.id, "reason": "no_staffing_record"}
        ]

    def test_overstaffed_division_goes_to_violations(self, division):
        make_employee(division)
        make_employee(division)
        make_slot(division, 1)
        result = StrengthReportService.compute(D)
        row = row_for(result, division)
        assert row.vacancies == 0
        assert result.violations == [
            {
                "division_id": division.id,
                "reason": "staff_lt_list",
                "staff_total": 1,
                "list_total": 2,
            }
        ]

    def test_fired_employee_not_in_the_list(self, division):
        make_employee(division)
        make_employee(division, employment_status="FIRED")
        make_slot(division, 2)
        row = row_for(StrengthReportService.compute(D), division)
        assert row.list_total == 1
        assert row.vacancies == 1

    def test_status_on_matches_aggregate_column(self, division):
        on_vacation = make_employee(division)
        in_service = make_employee(division)
        make_slot(division, 2)
        make_status(on_vacation, "VACATION", date(2026, 6, 2), date(2026, 6, 6))
        row = row_for(StrengthReportService.compute(D), division)
        assert row.columns["VACATION"] == 1
        assert row.columns["IN_SERVICE"] == 1
        assert EmployeeStatusSelector.status_on(on_vacation.id, D) == "VACATION"
        assert EmployeeStatusSelector.status_on(in_service.id, D) == "IN_SERVICE"

    def test_latest_timeline_row_wins(self, division):
        # Решение №5: several matching slot rows -> max valid_from.
        make_employee(division)
        make_slot(division, 7, valid_from_date=date(2026, 5, 1))
        make_slot(division, 3, valid_from_date=date(2026, 6, 1))
        row = row_for(StrengthReportService.compute(D), division)
        assert row.staff_total == 3

    def test_slot_valid_from_after_date_ignored(self, division):
        make_employee(division)
        make_slot(division, 9, valid_from_date=date(2026, 6, 10))
        result = StrengthReportService.compute(D)
        assert row_for(result, division).staff_total == 0
        assert result.warnings[0]["reason"] == "no_staffing_record"

    def test_slot_valid_to_equal_local_midnight_excluded_on_d(self, division):
        # C26: BR-002 upper bound is strict (valid_to > T); a slot expiring
        # AT local_midnight(D) is invisible on D — exercised against real
        # Postgres timestamptz, not just Python reasoning.
        make_employee(division)
        make_slot(
            division, 5, valid_from_date=date(2026, 5, 1), valid_to=local_midnight(D)
        )
        result = StrengthReportService.compute(D)
        assert row_for(result, division).staff_total == 0
        assert result.warnings[0]["reason"] == "no_staffing_record"

    def test_slot_valid_to_next_midnight_still_counts_on_d(self, division):
        # C26: a slot whose valid_to is local_midnight(D+1) is still live on
        # D (T < valid_to) — the other side of the half-open valid_to edge.
        make_employee(division)
        make_slot(
            division,
            5,
            valid_from_date=date(2026, 5, 1),
            valid_to=local_midnight(date(2026, 6, 5)),
        )
        row = row_for(StrengthReportService.compute(D), division)
        assert row.staff_total == 5
        assert (row.list_total, row.vacancies) == (1, 4)

    def test_division_names_in_rows(self, division):
        make_employee(division)
        make_slot(division, 1)
        assert row_for(StrengthReportService.compute(D), division).name == "Отдел А"

    def test_division_id_scopes_to_subtree(self, org, division):
        child = make_division(org, "Отдел Б", "SR-B", parent=division)
        other = make_division(org, "Чужой", "SR-C")
        for d in (division, child, other):
            make_employee(d)
            make_slot(d, 1)
        result = StrengthReportService.compute(D, division_id=division.id)
        assert {r.division_id for r in result.rows} == {division.id, child.id}

    def test_bulk_one_query_per_entity(self, division, django_assert_num_queries):
        # NFR: employees + slots + statuses + names — and nothing per item.
        for _ in range(5):
            emp = make_employee(division)
            make_status(emp, "VACATION", date(2026, 6, 2), date(2026, 6, 6))
        make_slot(division, 5)
        with django_assert_num_queries(4):
            result = StrengthReportService.compute(D)
        assert row_for(result, division).columns["VACATION"] == 5

    def test_bulk_query_count_constant_across_divisions(
        self, org, division, django_assert_num_queries
    ):
        # C19: a single-division fixture cannot detect a per-division N+1
        # (it would still total 4). Spread entities across 3 divisions so
        # the constant 4-query count under varying division cardinality is
        # what is actually pinned.
        second = make_division(org, "Отдел Б", "SR-B")
        third = make_division(org, "Отдел В", "SR-D")
        for d in (division, second, third):
            for _ in range(2):
                emp = make_employee(d)
                make_status(emp, "VACATION", date(2026, 6, 2), date(2026, 6, 6))
            make_slot(d, 2)
        with django_assert_num_queries(4):
            result = StrengthReportService.compute(D)
        assert sum(r.columns["VACATION"] for r in result.rows) == 6


class TestEmployeeStatusSelector:
    def test_overlapping_on_filters_by_employee_ids(self, division):
        emp1, emp2 = make_employee(division), make_employee(division)
        make_status(emp1, "VACATION", date(2026, 6, 2), date(2026, 6, 6))
        make_status(emp2, "STUDY", date(2026, 6, 2), date(2026, 6, 6))
        rows = EmployeeStatusSelector.overlapping_on(D, employee_ids=[emp1.id])
        assert [r["employee_id"] for r in rows] == [emp1.id]

    def test_overlapping_on_empty_ids_returns_nothing(self, division):
        emp = make_employee(division)
        make_status(emp, "VACATION", date(2026, 6, 2), date(2026, 6, 6))
        assert EmployeeStatusSelector.overlapping_on(D, employee_ids=[]) == []
