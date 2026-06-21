"""Strength report core: status resolution + division aggregation.

The module level is pure stdlib (no ORM, no Django): property tests run
without a database, and E6 will feed the same ``derive_report`` from JSONB
snapshots (ARCH-DATA-021: расход = derive(снапшот, дата)). The only ORM
code is ``StrengthReportService``, which imports the selectors inside the
method — that also breaks the selectors <-> services import cycle.
"""

from dataclasses import dataclass
from datetime import date

# Literal carry-over of the DB-OPS-003 seed (priority / report column);
# must stay in sync with the StatusType rows — the seed test in story 2.2
# cross-checks both tables (same contract as HARD_STATUS_TYPE_CODES).
# OTHER_ABSENCE (38/OTHER) is included in the StatusType seed (story 2.2).
STATUS_TYPE_PRIORITIES = {
    "SICK_LEAVE": 10,
    "LEAVE_BY_REPORT": 15,
    "VACATION": 20,
    "COMMAND": 30,
    "STUDY": 32,
    "COMPETITION": 34,
    "CONFERENCE": 36,
    "OTHER_ABSENCE": 38,
    "DETACHED": 40,
    "ATTACHED": 50,
    "REST_AFTER_DUTY": 60,
    "BEFORE_DUTY": 65,
    "DUTY": 70,
    "GEV": 75,
    "EVENT_ASSIGNMENT": 80,
    "IN_SERVICE": 999,
}

REPORT_COLUMN_BY_CODE = {
    "SICK_LEAVE": "SICK",
    "LEAVE_BY_REPORT": "VACATION",
    "VACATION": "VACATION",
    "COMMAND": "COMMAND",
    "STUDY": "TRAINING",
    "COMPETITION": "TRAINING",
    "CONFERENCE": "TRAINING",
    "OTHER_ABSENCE": "OTHER",
    "DETACHED": "DETACHED",
    "ATTACHED": "ATTACHED",
    "REST_AFTER_DUTY": "AFTER_DUTY",
    "BEFORE_DUTY": "BEFORE_DUTY",
    "DUTY": "ON_DUTY",
    "GEV": "ON_DUTY",
    "EVENT_ASSIGNMENT": "IN_SERVICE",
    "IN_SERVICE": "IN_SERVICE",
}

# The only code with counts_in_staff=false (DB-OPS-003 / BR-002 п.6): its
# bearer is reported as "+N" and stays OUT of the list and column totals.
ATTACHED_CODE = "ATTACHED"

# Fixed column order for report rows (everything except ATTACHED).
REPORT_COLUMNS = (
    "SICK",
    "VACATION",
    "COMMAND",
    "TRAINING",
    "OTHER",
    "DETACHED",
    "AFTER_DUTY",
    "BEFORE_DUTY",
    "ON_DUTY",
    "IN_SERVICE",
)


def resolve_status(rows, on_date):
    """BR-001 winner code for one employee's live interval facts on a date.

    A fact acts iff ``date_start <= on_date < date_end`` (half-open, AC-2);
    winner = min priority, tie-break status_type_code ASC then date_start
    ASC; no acting fact -> "IN_SERVICE" (FR-9). Rows are mappings with
    status_type_code/date_start/date_end; cancelled facts must already be
    filtered out by the caller (the selector's contract).
    """
    active = []
    for row in rows:
        code = row["status_type_code"]
        if code not in STATUS_TYPE_PRIORITIES:
            # STOP semantics on data: until the FK of 2.2 the column is free
            # text written only by controlled literals — an unknown code is
            # a programming error, and a silent OTHER would mask it.
            raise ValueError(f"unknown status_type_code: {code!r}")
        if row["date_start"] <= on_date < row["date_end"]:
            active.append(row)
    if not active:
        return "IN_SERVICE"
    winner = min(
        active,
        key=lambda r: (
            STATUS_TYPE_PRIORITIES[r["status_type_code"]],
            r["status_type_code"],
            r["date_start"],
        ),
    )
    return winner["status_type_code"]


@dataclass(frozen=True)
class DivisionReportRow:
    division_id: object
    name: str
    staff_total: int
    list_total: int
    vacancies: int
    columns: dict
    attached: int


@dataclass(frozen=True)
class ReportTotals:
    staff_total: int
    list_total: int
    vacancies: int
    columns: dict
    attached: int


@dataclass(frozen=True)
class StrengthReportResult:
    business_date: date
    rows: list
    totals: ReportTotals
    violations: list
    warnings: list


def derive_report(employees, status_rows, staff_map, on_date, division_names=None):
    """Aggregate per-division strength columns with convergence formulas.

    ``employees``: division_id -> [employee_id] (the WORKING headcount);
    ``status_rows``: live interval facts with employee_id; ``staff_map``:
    division_id -> allocated slots. Convergence (AC-1, Решение №6): the
    programmatic invariant Σ columns == Список is held by construction and
    raises on violation; Штат < Список is a finding about the DATA — it
    goes to ``violations`` and the report still comes out.
    """
    names = division_names or {}
    rows_by_employee = {}
    for row in status_rows:
        rows_by_employee.setdefault(row["employee_id"], []).append(row)

    report_rows, violations, warnings = [], [], []
    totals_columns = {column: 0 for column in REPORT_COLUMNS}
    totals_staff = totals_list = totals_vacancies = totals_attached = 0

    division_ids = set(employees) | set(staff_map)
    for division_id in sorted(division_ids, key=lambda d: (names.get(d, ""), str(d))):
        columns = {column: 0 for column in REPORT_COLUMNS}
        attached = 0
        members = employees.get(division_id, ())
        for employee_id in members:
            winner = resolve_status(rows_by_employee.get(employee_id, ()), on_date)
            if winner == ATTACHED_CODE:
                attached += 1
            else:
                columns[REPORT_COLUMN_BY_CODE[winner]] += 1

        list_total = len(members) - attached
        staff_total = staff_map.get(division_id)
        if staff_total is None:
            # BR-002.1: no staffing record is a warning, never a crash.
            staff_total = 0
            warnings.append(
                {"division_id": division_id, "reason": "no_staffing_record"}
            )
        vacancies = max(0, staff_total - list_total)

        if sum(columns.values()) != list_total:
            raise AssertionError(
                f"strength report broke Σ columns == Список for {division_id}: "
                f"{sum(columns.values())} != {list_total}"
            )
        if staff_total < list_total:
            # Infeasible by data (overstaffed/donor dirt): a finding for
            # the 1.8 diff, the report must still come out.
            violations.append(
                {
                    "division_id": division_id,
                    "reason": "staff_lt_list",
                    "staff_total": staff_total,
                    "list_total": list_total,
                }
            )
        elif staff_total != list_total + vacancies:
            raise AssertionError(
                f"strength report broke Штат == Список + Вакансии for "
                f"{division_id}: {staff_total} != {list_total} + {vacancies}"
            )

        report_rows.append(
            DivisionReportRow(
                division_id=division_id,
                name=names.get(division_id, ""),
                staff_total=staff_total,
                list_total=list_total,
                vacancies=vacancies,
                columns=columns,
                attached=attached,
            )
        )
        for column, count in columns.items():
            totals_columns[column] += count
        totals_staff += staff_total
        totals_list += list_total
        totals_vacancies += vacancies
        totals_attached += attached

    # ARCH-DATA-025: convergence is global — re-assert on the totals.
    if sum(totals_columns.values()) != totals_list:
        raise AssertionError(
            "strength report broke Σ columns == Список on totals: "
            f"{sum(totals_columns.values())} != {totals_list}"
        )
    if not violations and totals_staff != totals_list + totals_vacancies:
        raise AssertionError(
            "strength report broke Штат == Список + Вакансии on totals: "
            f"{totals_staff} != {totals_list} + {totals_vacancies}"
        )

    return StrengthReportResult(
        business_date=on_date,
        rows=report_rows,
        totals=ReportTotals(
            staff_total=totals_staff,
            list_total=totals_list,
            vacancies=totals_vacancies,
            columns=totals_columns,
            attached=totals_attached,
        ),
        violations=violations,
        warnings=warnings,
    )


class StrengthReportService:
    """ORM wrapper: selectors (one bulk query per entity) -> derive_report.

    MUST NOT take request/actor (no API until 1.8+; RBAC narrowing arrives
    with the API stories — the "list selector takes actor" rule is about
    API visibility, not internal derive selectors), write to the DB, or
    read the Clock: business_date is an explicit argument all the way down
    (ARCH-DATA-022).
    """

    @staticmethod
    def compute(business_date, division_id=None):
        # Function-level imports keep the module level pure (property tests
        # without Django) and break the selectors <-> services cycle.
        from apps.core.selectors import (
            CoreDivisionTreeSelector,
            CoreEmployeeSelector,
            CoreStaffingSelector,
        )
        from apps.operations.statuses.selectors import EmployeeStatusSelector

        division_ids = None
        if division_id is not None:
            division_ids = CoreDivisionTreeSelector.subtree_ids(division_id)
        employees = CoreEmployeeSelector.working_by_division(division_ids)
        staff_map = CoreStaffingSelector.allocated_slots_on(
            business_date, division_ids
        )
        if division_ids is None:
            # Whole DB: period__contains already rides the GiST index and
            # scopes to the date; a full employee_ids IN(...) list is
            # redundant (derive_report ignores non-member rows) and only
            # pessimizes the planner (review C17 2026-06-15).
            status_rows = EmployeeStatusSelector.overlapping_on(business_date)
        else:
            employee_ids = [eid for ids in employees.values() for eid in ids]
            status_rows = EmployeeStatusSelector.overlapping_on(
                business_date, employee_ids=employee_ids
            )
        names = CoreDivisionTreeSelector.divisions_map(
            set(employees) | set(staff_map)
        )
        return derive_report(
            employees, status_rows, staff_map, business_date, division_names=names
        )
