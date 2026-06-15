"""Pure-core tests for the strength report (no DB).

Unmarked table tests run in the gate; ``@pytest.mark.property`` classes
run via ``pytest -m property`` (ci profile) and ``make test-full``.
"""

from datetime import date, timedelta

import pytest
from hypothesis import given
from hypothesis import strategies as st

from apps.operations.statuses.services.strength_report import (
    ATTACHED_CODE,
    REPORT_COLUMN_BY_CODE,
    REPORT_COLUMNS,
    STATUS_TYPE_PRIORITIES,
    derive_report,
    resolve_status,
)

D = date(2026, 6, 4)


def fact(code, start, end, employee_id="emp"):
    return {
        "employee_id": employee_id,
        "status_type_code": code,
        "date_start": start,
        "date_end": end,
    }


def around(code, days_before=2, days_after=2, employee_id="emp"):
    return fact(
        code,
        D - timedelta(days=days_before),
        D + timedelta(days=days_after),
        employee_id=employee_id,
    )


class TestResolveStatusTables:
    def test_fallback_empty_rows_is_in_service(self):
        # FR-9: a date without an interval IS "В строю".
        assert resolve_status([], D) == "IN_SERVICE"

    def test_rows_not_covering_date_fall_back_to_in_service(self):
        rows = [fact("VACATION", D + timedelta(days=1), D + timedelta(days=5))]
        assert resolve_status(rows, D) == "IN_SERVICE"

    def test_sick_leave_beats_event_assignment(self):
        # TASK-018b AC: "SICK > EVENT".
        rows = [around("EVENT_ASSIGNMENT"), around("SICK_LEAVE")]
        assert resolve_status(rows, D) == "SICK_LEAVE"

    def test_min_priority_wins_across_the_table(self):
        # Every code must lose to SICK_LEAVE (priority 10, the minimum).
        for code in STATUS_TYPE_PRIORITIES:
            if code == "SICK_LEAVE":
                continue
            assert resolve_status([around(code), around("SICK_LEAVE")], D) == (
                "SICK_LEAVE"
            )

    def test_duplicate_code_overlap_is_deterministic(self):
        # Same priority can only happen with the same code (the table has
        # distinct priorities): tie-break code ASC then date_start ASC keeps
        # min() stable; the winner code is the same either way.
        rows = [
            fact("VACATION", D - timedelta(days=1), D + timedelta(days=1)),
            fact("VACATION", D - timedelta(days=3), D + timedelta(days=3)),
        ]
        assert resolve_status(rows, D) == "VACATION"
        assert resolve_status(list(reversed(rows)), D) == "VACATION"

    def test_unknown_code_raises_value_error_with_code(self):
        with pytest.raises(ValueError, match="MYSTERY"):
            resolve_status([around("MYSTERY")], D)

    def test_one_day_interval_acts_exactly_on_its_day(self):
        rows = [fact("VACATION", D, D + timedelta(days=1))]
        assert resolve_status(rows, D) == "VACATION"
        assert resolve_status(rows, D + timedelta(days=1)) == "IN_SERVICE"
        assert resolve_status(rows, D - timedelta(days=1)) == "IN_SERVICE"

    def test_end_date_is_exclusive(self):
        # AC-2: a status with end=D does not act on D.
        rows = [fact("VACATION", date(2026, 6, 1), date(2026, 6, 15))]
        assert resolve_status(rows, date(2026, 6, 15)) == "IN_SERVICE"
        assert resolve_status(rows, date(2026, 6, 14)) == "VACATION"
        assert resolve_status(rows, date(2026, 6, 1)) == "VACATION"

    def test_priority_table_matches_column_table(self):
        assert set(STATUS_TYPE_PRIORITIES) == set(REPORT_COLUMN_BY_CODE)
        assert set(REPORT_COLUMN_BY_CODE.values()) - {ATTACHED_CODE} == set(
            REPORT_COLUMNS
        )


class TestDeriveReportTables:
    def test_attached_is_plus_n_outside_the_list(self):
        employees = {"d1": ["e1", "e2"]}
        rows = [around("ATTACHED", employee_id="e1")]
        result = derive_report(employees, rows, {"d1": 5}, D)
        (row,) = result.rows
        assert row.attached == 1
        assert row.list_total == 1
        assert sum(row.columns.values()) == 1
        assert row.columns["IN_SERVICE"] == 1
        assert row.vacancies == 4

    def test_missing_staffing_record_warns_and_staff_is_zero(self):
        result = derive_report({"d1": ["e1"]}, [], {}, D)
        (row,) = result.rows
        assert row.staff_total == 0
        assert result.warnings == [
            {"division_id": "d1", "reason": "no_staffing_record"}
        ]

    def test_staff_below_list_is_a_violation_not_a_raise(self):
        result = derive_report({"d1": ["e1", "e2"]}, [], {"d1": 1}, D)
        (row,) = result.rows
        assert row.vacancies == 0
        assert result.violations == [
            {
                "division_id": "d1",
                "reason": "staff_lt_list",
                "staff_total": 1,
                "list_total": 2,
            }
        ]

    def test_staff_equals_list_plus_vacancies(self):
        result = derive_report({"d1": ["e1"]}, [], {"d1": 3}, D)
        (row,) = result.rows
        assert (row.staff_total, row.list_total, row.vacancies) == (3, 1, 2)
        assert result.violations == []

    def test_division_with_slots_but_no_people_gets_a_row(self):
        result = derive_report({}, [], {"d1": 4}, D)
        (row,) = result.rows
        assert (row.staff_total, row.list_total, row.vacancies) == (4, 0, 4)

    def test_unknown_code_in_rows_propagates_value_error(self):
        with pytest.raises(ValueError, match="MYSTERY"):
            derive_report({"d1": ["e1"]}, [around("MYSTERY", employee_id="e1")], {}, D)

    def test_division_names_land_in_rows(self):
        result = derive_report(
            {"d1": ["e1"]}, [], {"d1": 1}, D, division_names={"d1": "Отдел"}
        )
        assert result.rows[0].name == "Отдел"

    def test_business_date_carried(self):
        assert derive_report({}, [], {}, D).business_date == D


# --- property layer (hypothesis): runs via -m property / make test-full ---

CODES = sorted(STATUS_TYPE_PRIORITIES)
CODES_NO_ATTACHED = [c for c in CODES if c != ATTACHED_CODE]


@st.composite
def worlds(draw, codes=tuple(CODES)):
    """Employees over 1-3 divisions + raw facts (with a cancelled flag,
    filtered out before the core — the selector's contract) + staff_map
    with gaps and understaffed values."""
    n_divisions = draw(st.integers(1, 3))
    divisions = [f"div{i}" for i in range(n_divisions)]
    employees = {}
    facts = []
    for i in range(draw(st.integers(0, 8))):
        emp = f"emp{i}"
        division = divisions[draw(st.integers(0, n_divisions - 1))]
        employees.setdefault(division, []).append(emp)
        for _ in range(draw(st.integers(0, 4))):
            start = D + timedelta(days=draw(st.integers(-5, 3)))
            end = start + timedelta(days=draw(st.integers(1, 6)))
            facts.append(
                {
                    "employee_id": emp,
                    "status_type_code": draw(st.sampled_from(codes)),
                    "date_start": start,
                    "date_end": end,
                    "cancelled": draw(st.booleans()),
                }
            )
    staff_map = {
        div: draw(st.integers(0, 10)) for div in divisions if draw(st.booleans())
    }
    return employees, facts, staff_map


def live(facts):
    return [f for f in facts if not f["cancelled"]]


def headcount(employees):
    return sum(len(ids) for ids in employees.values())


@pytest.mark.property
class TestStrengthReportProperties:
    @given(worlds())
    def test_exactly_one_derived_status_per_employee(self, world):
        # AC-3 invariant (а): nobody lost, nobody counted twice.
        employees, facts, staff_map = world
        result = derive_report(employees, live(facts), staff_map, D)
        for row in result.rows:
            n = len(employees.get(row.division_id, []))
            assert sum(row.columns.values()) + row.attached == n
        totals = result.totals
        assert sum(totals.columns.values()) + totals.attached == headcount(employees)

    @given(worlds())
    def test_column_sums_equal_list_total(self, world):
        # Invariant (б): Σ columns without ATTACHED == Список, rows + totals.
        employees, facts, staff_map = world
        result = derive_report(employees, live(facts), staff_map, D)
        for row in result.rows:
            assert sum(row.columns.values()) == row.list_total
        assert sum(result.totals.columns.values()) == result.totals.list_total

    @given(worlds())
    def test_staff_equals_list_plus_vacancies_outside_violations(self, world):
        # Invariant (в).
        employees, facts, staff_map = world
        result = derive_report(employees, live(facts), staff_map, D)
        violating = {v["division_id"] for v in result.violations}
        for row in result.rows:
            if row.division_id not in violating:
                assert row.staff_total == row.list_total + row.vacancies
        if not violating:
            totals = result.totals
            assert totals.staff_total == totals.list_total + totals.vacancies

    @given(worlds(), st.data())
    def test_half_openness_facts_ending_on_d_are_invisible(self, world, data):
        # AC-2 invariant (г): a fact with date_end == D never changes D.
        employees, facts, staff_map = world
        result = derive_report(employees, live(facts), staff_map, D)
        extra = []
        for ids in employees.values():
            for emp in ids:
                if data.draw(st.booleans()):
                    extra.append(
                        fact(
                            data.draw(st.sampled_from(CODES)),
                            D - timedelta(days=data.draw(st.integers(1, 5))),
                            D,
                            employee_id=emp,
                        )
                    )
        with_edge = derive_report(employees, live(facts) + extra, staff_map, D)
        assert with_edge == result

    @given(worlds(codes=tuple(CODES_NO_ATTACHED)), st.integers(2, 4))
    def test_day_conservation_law(self, world, k):
        # AC-3 invariant (д): without ATTACHED the list is constant, so the
        # column sums over a [D..D+k) window add up to Список × k.
        employees, facts, staff_map = world
        total = 0
        for offset in range(k):
            result = derive_report(
                employees, live(facts), staff_map, D + timedelta(days=offset)
            )
            total += sum(result.totals.columns.values())
        assert total == headcount(employees) * k

    @given(worlds(), st.randoms())
    def test_input_permutation_does_not_change_result(self, world, rnd):
        # Invariant (е): determinism.
        employees, facts, staff_map = world
        result = derive_report(employees, live(facts), staff_map, D)
        shuffled_facts = live(facts)
        rnd.shuffle(shuffled_facts)
        shuffled_employees = {
            div: list(reversed(ids))
            for div, ids in sorted(employees.items(), reverse=True)
        }
        shuffled_staff = dict(sorted(staff_map.items(), reverse=True))
        permuted = derive_report(shuffled_employees, shuffled_facts, shuffled_staff, D)
        assert permuted == result
