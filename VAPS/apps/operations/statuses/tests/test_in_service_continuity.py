"""Story 3.7 — verification: «В строю» default + continuity AC-pins.

The derived-default engine and the totality/continuity PROPERTIES are already
delivered by story 1.7: ``strength_report.resolve_status`` returns IN_SERVICE
when no fact acts on the date (FR-9), and the property suite in
``test_strength_report_properties.py`` proves totality + continuity:
``test_exactly_one_derived_status_per_employee`` (Σcolumns + attached ==
headcount), ``test_day_conservation_law`` (column sums over [D..D+k) ==
headcount × k — every employee accounted for on every date),
``test_one_day_interval_acts_exactly_on_its_day`` (D+1 → IN_SERVICE),
``test_end_date_is_exclusive``.

3.7 changes NO engine code. It pins the exact 3.7 AC phrasing on the thin
uncovered delta:
  - AC-2: FR-9 handoff "auto-return to the next PLANNED, else В строю" (unit).
  - AC-1: DB-level auto-return is a pure derived read — ZERO new rows.
  - AC-3: DB-level totality — exactly one code per date; cancelled row ignored.
"""

import itertools
from datetime import date, datetime, timedelta
from datetime import timezone as dt_timezone

import pytest

from apps.core.models import Division, DivisionType, Employee, Organization
from apps.operations.statuses.models import EmployeeStatus
from apps.operations.statuses.selectors import EmployeeStatusSelector
from apps.operations.statuses.services.strength_report import resolve_status

D = date(2026, 6, 4)


# --- AC-2: FR-9 handoff (unit, pure resolve_status, no DB) -------------------


def _row(code, start, end):
    return {"status_type_code": code, "date_start": start, "date_end": end}


def test_auto_return_to_next_planned_when_adjacent():
    # A ends on D (end exclusive); B starts on D → on D the next ELIGIBLE status
    # takes over, NOT IN_SERVICE (FR-9 handover). `resolve_status` is
    # lifecycle-blind (picks the min-priority acting fact); successor-ELIGIBILITY
    # — that a cancelled successor does NOT hand over — is pinned at the DB layer
    # in test_cancelled_successor_falls_back_to_in_service.
    rows = [
        _row("VACATION", D - timedelta(days=3), D),
        _row("STUDY", D, D + timedelta(days=3)),
    ]
    assert resolve_status(rows, D - timedelta(days=1)) == "VACATION"
    assert resolve_status(rows, D) == "STUDY"


def test_gap_between_statuses_is_in_service():
    # A ends on D; the next status starts only on D+2 → D and D+1 are «В строю»,
    # then D+2 hands over. FR-9 "иначе В строю" for the gap.
    rows = [
        _row("VACATION", D - timedelta(days=3), D),
        _row("STUDY", D + timedelta(days=2), D + timedelta(days=5)),
    ]
    assert resolve_status(rows, D) == "IN_SERVICE"
    assert resolve_status(rows, D + timedelta(days=1)) == "IN_SERVICE"
    assert resolve_status(rows, D + timedelta(days=2)) == "STUDY"


# --- AC-1 / AC-3: DB-level (Postgres) ----------------------------------------

_iin = itertools.count(700)


@pytest.fixture
def emp(db):
    org = Organization.objects.create(name="HQ", code="HQ-37")
    dtp = DivisionType.objects.create(code="dep37", name="Отдел")
    div = Division.objects.create(
        organization=org, type_code=dtp, name="D", code="D37"
    )
    return Employee.objects.create(
        iin=f"{next(_iin):012d}", full_name="T", rank_code="",
        position_code="", division=div,
    )


@pytest.mark.django_db
def test_auto_return_needs_no_db_record(emp):
    # The only status ended (end == D, exclusive → last acting day was D-1).
    EmployeeStatus.objects.create(
        employee_id=emp.id, status_type_code="VACATION",
        date_start=D - timedelta(days=5), date_end=D,
    )
    before = EmployeeStatus.objects.count()
    # Derived read on D: «В строю», and the read is pure — no mutator/INSERT.
    assert EmployeeStatusSelector.status_on(emp.id, D) == "IN_SERVICE"
    assert EmployeeStatus.objects.count() == before


@pytest.mark.django_db
def test_db_totality_one_code_per_date(emp):
    # Two overlapping SOFT statuses (no hard-exclusion constraint): exactly one
    # winner per date. A cancelled SICK_LEAVE (priority 10) must be ignored —
    # otherwise it would win every day it spans.
    EmployeeStatus.objects.create(
        employee_id=emp.id, status_type_code="STUDY",
        date_start=D - timedelta(days=2), date_end=D + timedelta(days=3),
    )
    EmployeeStatus.objects.create(
        employee_id=emp.id, status_type_code="CONFERENCE",
        date_start=D - timedelta(days=1), date_end=D + timedelta(days=2),
    )
    EmployeeStatus.objects.create(
        employee_id=emp.id, status_type_code="SICK_LEAVE",
        date_start=D - timedelta(days=2), date_end=D + timedelta(days=3),
        cancelled_at=datetime(2026, 6, 1, tzinfo=dt_timezone.utc),
    )
    got = {
        n: EmployeeStatusSelector.status_on(emp.id, D + timedelta(days=n))
        for n in range(-2, 4)
    }
    assert got == {
        -2: "STUDY",       # cancelled SICK_LEAVE ignored (else it would win)
        -1: "STUDY",       # STUDY(32) beats CONFERENCE(36)
        0: "STUDY",
        1: "STUDY",
        2: "STUDY",        # CONFERENCE ended on D+2 (exclusive)
        3: "IN_SERVICE",   # nothing acts → «В строю» (totality default)
    }


@pytest.mark.django_db
def test_cancelled_successor_falls_back_to_in_service(emp):
    # FR-9 "иначе В строю", successor-eligibility: a successor status EXISTS
    # right after A ends, but it is CANCELLED → it must NOT hand over; the dates
    # it would have covered resolve to IN_SERVICE, not its code. (AC-3's
    # cancelled row proves CONCURRENT ignore; this proves SUCCESSOR ignore.)
    EmployeeStatus.objects.create(
        employee_id=emp.id, status_type_code="VACATION",
        date_start=D - timedelta(days=3), date_end=D,  # ends on D (exclusive)
    )
    EmployeeStatus.objects.create(
        employee_id=emp.id, status_type_code="STUDY",
        date_start=D, date_end=D + timedelta(days=3),  # would take over on D…
        cancelled_at=datetime(2026, 6, 1, tzinfo=dt_timezone.utc),  # …but cancelled
    )
    # Without the cancelled filter STUDY would win on D and D+1; filtered → «В строю».
    assert EmployeeStatusSelector.status_on(emp.id, D) == "IN_SERVICE"
    assert (
        EmployeeStatusSelector.status_on(emp.id, D + timedelta(days=1))
        == "IN_SERVICE"
    )
