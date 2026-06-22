"""Story 2.4 — date-versioned roster selector (Список знаменатель расхода).

DB tests (Postgres via the gate — the schema carries the EmployeeStatus
EXCLUDE constraint, so django_db needs Postgres). The AC-3 reconciliation
invariant is property-tested on the PURE ``_resolve_roster`` helper in
``test_roster_merge_properties.py`` (no DB), mirroring ``derive_report``.
"""

import datetime as dt

import pytest

from apps.core.models import (
    Division,
    DivisionType,
    Employee,
    EmployeeDivisionHistory,
    Organization,
)
from apps.core.selectors import HistoricalEmployeeSelector, local_midnight
from apps.core.services import assign_employee_division

pytestmark = pytest.mark.django_db


def _emp(iin, division, *, status=Employee.EmploymentStatus.WORKING, active=True):
    return Employee.objects.create(
        iin=iin,
        full_name=f"Emp {iin}",
        rank_code="MAJOR",
        position_code="OPER",
        division=division,
        employment_status=status,
        is_active=active,
    )


@pytest.fixture
def tree():
    org = Organization.objects.create(name="HQ", code="HQ")
    dtp = DivisionType.objects.create(code="management", name="Управление")
    root = Division.objects.create(organization=org, type_code=dtp, name="R", code="R")
    a = Division.objects.create(
        organization=org, type_code=dtp, name="A", code="A", parent=root
    )
    b = Division.objects.create(
        organization=org, type_code=dtp, name="B", code="B", parent=root
    )
    return org, dtp, root, a, b


# --- AC-1: interval-based membership across a transfer --------------------


def test_roster_reflects_transfer_on_the_move_date(tree):
    _, _, _, a, b = tree
    emp = _emp("900101300200", a)
    t_a = local_midnight(dt.date(2026, 6, 1))
    t_move = local_midnight(dt.date(2026, 6, 10))
    assign_employee_division(emp, a, starts_at=t_a, actor="test")
    assign_employee_division(emp, b, starts_at=t_move, actor="test")

    on_09 = HistoricalEmployeeSelector.roster_on(dt.date(2026, 6, 9))
    on_10 = HistoricalEmployeeSelector.roster_on(dt.date(2026, 6, 10))

    # 09.06 → only in A (half-open: B starts 10.06)
    assert emp.id in on_09.get(a.id, [])
    assert emp.id not in on_09.get(b.id, [])
    # 10.06 → only in B (A interval ends_at == 10.06, exclusive)
    assert emp.id in on_10.get(b.id, [])
    assert emp.id not in on_10.get(a.id, [])


# --- AC-4: fallback to current division when no history (the pilot path) --


def test_roster_falls_back_to_current_division_without_history(tree):
    _, _, _, a, _ = tree
    emp = _emp("900101300201", a)  # no EmployeeDivisionHistory rows (как импорт 1.6)
    roster = HistoricalEmployeeSelector.roster_on(dt.date(2026, 6, 9))
    assert roster.get(a.id) == [emp.id]


# --- AC-2: hire/dismissal (employment) bounds membership -----------------


def test_roster_excludes_non_working_and_inactive(tree):
    _, _, _, a, _ = tree
    working = _emp("900101300202", a)
    _emp("900101300203", a, status=Employee.EmploymentStatus.FIRED)
    _emp("900101300204", a, status=Employee.EmploymentStatus.ARCHIVED)
    _emp("900101300205", a, active=False)
    roster = HistoricalEmployeeSelector.roster_on(dt.date(2026, 6, 9))
    assert roster.get(a.id) == [working.id]


def test_fired_employee_history_does_not_resurrect(tree):
    _, _, _, a, b = tree
    emp = _emp("900101300206", b, status=Employee.EmploymentStatus.FIRED)
    # even with a covering history interval into A, a FIRED employee is out
    EmployeeDivisionHistory.objects.create(
        employee=emp, division=a, starts_at=local_midnight(dt.date(2026, 6, 1))
    )
    roster = HistoricalEmployeeSelector.roster_on(dt.date(2026, 6, 9))
    assert emp.id not in roster.get(a.id, [])
    assert emp.id not in roster.get(b.id, [])


# --- overlap robustness: max starts_at wins (no DB exclusion constraint) --


def test_overlapping_intervals_latest_start_wins(tree):
    _, _, _, a, b = tree
    emp = _emp("900101300207", a)
    EmployeeDivisionHistory.objects.create(
        employee=emp, division=a, starts_at=local_midnight(dt.date(2026, 6, 1))
    )
    EmployeeDivisionHistory.objects.create(
        employee=emp, division=b, starts_at=local_midnight(dt.date(2026, 6, 5))
    )
    roster = HistoricalEmployeeSelector.roster_on(dt.date(2026, 6, 9))
    assert emp.id in roster.get(b.id, [])
    assert emp.id not in roster.get(a.id, [])


def test_equal_starts_resolve_deterministically(tree):
    # No DB exclusion constraint → equal-starts overlap is possible (E7
    # backfill / manual data). Tie-break (starts_at, division_id) must pick a
    # STABLE division regardless of row order: the расход denominator must not
    # flip between runs.
    _, _, _, a, b = tree
    emp = _emp("900101300214", a)
    same_start = local_midnight(dt.date(2026, 6, 1))
    EmployeeDivisionHistory.objects.create(
        employee=emp, division=a, starts_at=same_start
    )
    EmployeeDivisionHistory.objects.create(
        employee=emp, division=b, starts_at=same_start
    )
    winner_id, loser_id = max(a.id, b.id), min(a.id, b.id)
    r1 = HistoricalEmployeeSelector.roster_on(dt.date(2026, 6, 9))
    r2 = HistoricalEmployeeSelector.roster_on(dt.date(2026, 6, 9))
    assert emp.id in r1.get(winner_id, [])
    assert emp.id not in r1.get(loser_id, [])
    assert r1 == r2  # deterministic across runs


# --- subtree scoping ------------------------------------------------------


def test_roster_scopes_to_division_ids(tree):
    _, _, _, a, b = tree
    ea = _emp("900101300208", a)
    _emp("900101300209", b)
    roster = HistoricalEmployeeSelector.roster_on(dt.date(2026, 6, 9), {a.id})
    assert set(roster) == {a.id}
    assert roster[a.id] == [ea.id]


def test_scoped_roster_uses_historical_not_current_division(tree):
    # Versioning: scoping filters on the RESOLVED (date) division, not the
    # current one. A mover whose CURRENT division is in scope but who was
    # elsewhere on the date is dropped; scoping to the historical division
    # pulls them in even though their current division differs.
    _, _, _, a, b = tree
    mover = _emp("900101300215", a)
    assign_employee_division(
        mover, b, starts_at=local_midnight(dt.date(2026, 6, 1)), actor="test"
    )
    assign_employee_division(
        mover, a, starts_at=local_midnight(dt.date(2026, 6, 20)), actor="test"
    )
    mover.refresh_from_db()
    assert mover.division_id == a.id  # current = A (after the 20.06 move)
    # on 09.06 the mover was historically in B
    scoped_a = HistoricalEmployeeSelector.roster_on(dt.date(2026, 6, 9), {a.id})
    scoped_b = HistoricalEmployeeSelector.roster_on(dt.date(2026, 6, 9), {b.id})
    assert mover.id not in scoped_a.get(a.id, [])  # current=A in scope, but hist=B
    assert mover.id in scoped_b.get(b.id, [])  # historical division pulls in


# --- AC-3: global reconciliation holds (Σ roster == active) ---------------


def test_reconciliation_holds_with_moves_and_fired(tree):
    _, _, _, a, b = tree
    e1 = _emp("900101300210", a)
    e2 = _emp("900101300211", b)
    mover = _emp("900101300212", a)
    assign_employee_division(
        mover, a, starts_at=local_midnight(dt.date(2026, 6, 1)), actor="test"
    )
    assign_employee_division(
        mover, b, starts_at=local_midnight(dt.date(2026, 6, 5)), actor="test"
    )
    _emp("900101300213", a, status=Employee.EmploymentStatus.FIRED)  # excluded

    rec = HistoricalEmployeeSelector.roster_reconciliation(dt.date(2026, 6, 9))
    assert rec["expected"] == 3  # e1, e2, mover (working & active)
    assert rec["actual"] == 3
    assert rec["missing_employee_ids"] == []

    roster = HistoricalEmployeeSelector.roster_on(dt.date(2026, 6, 9))
    placed = sorted(eid for ids in roster.values() for eid in ids)
    assert placed == sorted([e1.id, e2.id, mover.id])
    # mover resolved to B on 09.06 (interval B started 05.06)
    assert mover.id in roster.get(b.id, [])
