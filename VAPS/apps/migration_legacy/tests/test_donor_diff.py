"""Unit tests for the pure donor diff classifier (no DB, gate).

Each test builds a StrengthReportResult (VAPS side) and a baseline row
(donor side) by hand so a single discrepancy lands on exactly one
CATEGORY_RULE. The catalog is aligned on the parallel-run canon
(architecture.md:311): timing / model / unclassified, with
``data/skipped_employee`` marked but NOT green-lighting the gate.
"""

from datetime import date

import pytest

from apps.migration_legacy.donor_diff import (
    BaselineRow,
    diff_day,
    load_baseline,
    render_diff,
)
from apps.operations.statuses.services import (
    REPORT_COLUMNS,
    DivisionReportRow,
    ReportTotals,
    StrengthReportResult,
)


def vaps_row(code, staff=0, list_total=0, vacancies=0, columns=None, attached=0):
    cols = {column: 0 for column in REPORT_COLUMNS}
    cols.update(columns or {})
    return DivisionReportRow(
        division_id=code,
        name=code,
        staff_total=staff,
        list_total=list_total,
        vacancies=vacancies,
        columns=cols,
        attached=attached,
    )


def vaps_result(rows, violations=None, warnings=None):
    totals = ReportTotals(0, 0, 0, {c: 0 for c in REPORT_COLUMNS}, 0)
    return StrengthReportResult(
        business_date=date(2026, 6, 4),
        rows=rows,
        totals=totals,
        violations=violations or [],
        warnings=warnings or [],
    )


def baseline(code, **donor):
    fields = {
        "division_code": code,
        "division_name": code,
        "staff_unit": 0,
        "in_service": 0,
        "vacation": 0,
        "sick_leave": 0,
        "business_trip": 0,
        "training": 0,
        "seconded_in": 0,
        "seconded_out": 0,
        "other_absence": 0,
    }
    fields.update(donor)
    return BaselineRow(**fields)


def id_map(*codes):
    return {code: code for code in codes}


def run(rows, baseline_rows, violations=None):
    result = vaps_result(rows, violations=violations)
    baseline_for_day = {b.division_code: b for b in baseline_rows}
    codes = {row.division_id: row.division_id for row in rows}
    return diff_day(result, baseline_for_day, codes)


def cats(diff):
    return {cell.category for cell in diff.cells}


class TestExactMatch:
    def test_identical_numbers_yield_no_diff(self):
        rows = [vaps_row("DEP1", staff=5, list_total=1, columns={"VACATION": 1})]
        base = [baseline("DEP1", staff_unit=5, vacation=1)]
        diff = run(rows, base)
        assert diff.cells == []
        assert diff.has_unclassified is False


class TestTiming:
    def test_half_open_end_on_boundary_day(self):
        # Donor (inclusive) still counts a just-ended vacation; VAPS
        # (half-open) moved the person to IN_SERVICE.
        rows = [vaps_row("DEP1", columns={"IN_SERVICE": 1})]
        base = [baseline("DEP1", vacation=1, in_service=0)]
        diff = run(rows, base)
        assert cats(diff) == {"timing/half_open_end"}
        assert diff.has_unclassified is False


class TestAggregatorInferred:
    def test_leave_by_report_folds_into_donor_in_service(self):
        # VAPS splits leave_by_report into VACATION; donor folds it into
        # inferred "В строю". Paired: VAPS VACATION +1 <-> donor IN_SERVICE +1.
        rows = [vaps_row("DEP1", columns={"VACATION": 1})]
        base = [baseline("DEP1", in_service=1, vacation=0)]
        diff = run(rows, base)
        assert cats(diff) == {"model/aggregator_inferred"}
        assert diff.has_unclassified is False

    def test_competition_folds_into_donor_in_service(self):
        rows = [vaps_row("DIR1", columns={"TRAINING": 1})]
        base = [baseline("DIR1", in_service=1, training=0)]
        diff = run(rows, base)
        assert cats(diff) == {"model/aggregator_inferred"}
        assert diff.has_unclassified is False

    def test_on_duty_folds_into_donor_in_service(self):
        # ON_DUTY has no donor column at all: the donor aggregator leaves
        # the person in inferred "В строю". Only the IN_SERVICE cell diffs.
        rows = [vaps_row("DIR1", columns={"ON_DUTY": 1})]
        base = [baseline("DIR1", in_service=1)]
        diff = run(rows, base)
        assert cats(diff) == {"model/aggregator_inferred"}
        assert diff.has_unclassified is False

    def test_after_duty_folds_into_donor_in_service(self):
        rows = [vaps_row("DIR1", columns={"AFTER_DUTY": 1})]
        base = [baseline("DIR1", in_service=1)]
        diff = run(rows, base)
        assert cats(diff) == {"model/aggregator_inferred"}
        assert diff.has_unclassified is False


class TestSingleWinner:
    def test_donor_double_count_loses_to_vaps_winner(self):
        # Donor counts the person in BOTH sick_leave and vacation; VAPS
        # picks the single winner (SICK, priority 10). The vacation loser
        # stays only on the donor side, with no IN_SERVICE compensation.
        rows = [vaps_row("DEP1", columns={"SICK": 1})]
        base = [baseline("DEP1", sick_leave=1, vacation=1)]
        diff = run(rows, base)
        assert cats(diff) == {"model/single_winner"}
        assert diff.has_unclassified is False


class TestOverstaffed:
    def test_staff_lt_list_violation_is_model_overstaffed(self):
        rows = [vaps_row("DEP1", staff=1, list_total=2, columns={"IN_SERVICE": 2})]
        violations = [
            {
                "division_id": "DEP1",
                "reason": "staff_lt_list",
                "staff_total": 1,
                "list_total": 2,
            }
        ]
        base = [baseline("DEP1", staff_unit=1, in_service=2)]
        diff = run(rows, base, violations=violations)
        assert "model/overstaffed" in cats(diff)
        assert diff.has_unclassified is False


class TestDataLossAndUnclassified:
    def test_skipped_employee_marked_but_blocks_gate(self):
        # Donor has 2 more working people in "В строю" than VAPS (VAPS
        # dropped the rows at import): donor surplus with no fold to explain
        # it -> data/skipped_employee, and it MUST block the gate.
        rows = [vaps_row("DEP1", columns={"IN_SERVICE": 0})]
        base = [baseline("DEP1", in_service=2)]
        diff = run(rows, base)
        assert cats(diff) == {"data/skipped_employee"}
        assert diff.has_unclassified is True

    def test_arbitrary_unexplained_surplus_is_unclassified(self):
        # VAPS has more in a 1:1 column (SICK) with no structural reason:
        # the catalog must NOT invent a category.
        rows = [vaps_row("DEP1", columns={"SICK": 3})]
        base = [baseline("DEP1", sick_leave=1)]
        diff = run(rows, base)
        assert cats(diff) == {"unclassified"}
        assert diff.has_unclassified is True


class TestAlignmentByCode:
    def test_missing_vaps_side_is_zeros_baseline_only_code_emitted(self):
        # A baseline code with no VAPS Division (collapsed/skipped) must be
        # emitted with the VAPS side = 0, not silently swallowed.
        rows = [vaps_row("DEP1", columns={"VACATION": 1})]
        base = [
            baseline("DEP1", vacation=1),
            baseline("GHOST", in_service=3),
        ]
        diff = run(rows, base)
        ghost = [c for c in diff.cells if c.division_code == "GHOST"]
        assert ghost  # not swallowed
        assert all(c.vaps == 0 for c in ghost)
        assert diff.has_unclassified is True

    def test_vaps_only_code_diffs_against_zero_donor(self):
        rows = [vaps_row("ONLY", columns={"SICK": 1})]
        base = []  # no baseline row for ONLY
        diff = run(rows, base)
        assert any(c.division_code == "ONLY" for c in diff.cells)


class TestNonComparableColumns:
    def test_list_total_and_vacancies_are_not_diffed(self):
        # Donor emits no list_total/vacancies; comparing them would be a
        # false unclassified flood. The VAPS list/vacancies differ wildly
        # here but must produce NO cell.
        rows = [vaps_row("DEP1", staff=5, list_total=5, vacancies=99,
                          columns={"VACATION": 5})]
        base = [baseline("DEP1", staff_unit=5, vacation=5)]
        diff = run(rows, base)
        columns_seen = {c.column for c in diff.cells}
        assert "list_total" not in columns_seen
        assert "vacancies" not in columns_seen
        assert diff.cells == []


class TestLoadBaseline:
    def _envelope(self, *day_blocks):
        return {"days": list(day_blocks)}

    def _day(self, iso, rows):
        return {"date": iso, "rows": rows}

    def _row(self, code, **donor):
        fields = {
            "division_code": code,
            "division_name": code,
            "staff_unit": 0,
            "in_service": 0,
            "vacation": 0,
            "sick_leave": 0,
            "business_trip": 0,
            "training": 0,
            "seconded_in": 0,
            "seconded_out": 0,
            "other_absence": 0,
        }
        fields.update(donor)
        return fields

    def test_multi_day_envelope_parses_to_date_code_map(self):
        data = self._envelope(
            self._day("2026-06-04", [self._row("DEP1", vacation=1)]),
            self._day("2026-06-05", [self._row("DEP1", in_service=2)]),
        )
        parsed = load_baseline(data)
        assert set(parsed) == {date(2026, 6, 4), date(2026, 6, 5)}
        assert parsed[date(2026, 6, 4)]["DEP1"].vacation == 1
        assert parsed[date(2026, 6, 5)]["DEP1"].in_service == 2

    def test_invalid_schema_raises_value_error(self):
        with pytest.raises(ValueError):
            load_baseline({"not_days": []})

    def test_duplicate_division_code_in_a_day_raises(self):
        data = self._envelope(
            self._day("2026-06-04", [self._row("DEP1"), self._row("DEP1")])
        )
        with pytest.raises(ValueError):
            load_baseline(data)


class TestRenderDiff:
    def test_unclassified_block_present_when_blocked(self):
        rows = [vaps_row("DEP1", columns={"IN_SERVICE": 0})]
        base = [baseline("DEP1", in_service=2)]
        diff = run(rows, base)
        text = render_diff(diff)
        assert "UNCLASSIFIED" in text
        assert "DEP1" in text

    def test_unclassified_block_says_none_when_clean(self):
        rows = [vaps_row("DEP1", columns={"VACATION": 1})]
        base = [baseline("DEP1", in_service=1)]  # aggregator_inferred only
        diff = run(rows, base)
        text = render_diff(diff)
        assert "UNCLASSIFIED" in text
        assert "model/aggregator_inferred" in text
