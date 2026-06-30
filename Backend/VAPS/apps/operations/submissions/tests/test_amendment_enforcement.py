"""Tests for the amendment enforcement seam (Story 5.4b).

The handler (submissions) is registered into the statuses-owned hook slot at
AppConfig.ready(). A retro-edit covering a submitted day must trigger an amendment
(amend_day, 5.4a) per covered (division, day), atomically. Detection keys off
snapshot MEMBERSHIP (DailySubmissionSelector.covering — a JSONB containment query):
the submissions whose immutable roster contains the employee, regardless of the
employee's live edit-time division. Half-open [start,end); disjoint intervals skip
the gap (closes the min/max bounding-box defer).
"""

import itertools
import uuid
from datetime import date, datetime, timedelta
from zoneinfo import ZoneInfo

import pytest

from apps.core import clock
from apps.core.models import Division, DivisionType, Employee, Organization
from apps.operations.statuses import amendment_hook
from apps.operations.statuses.models import EmployeeStatus, StatusType
from apps.operations.statuses.services import resolve_pending_clarification
from apps.operations.submissions import amendment_enforcement
from apps.operations.submissions.amendment_enforcement import (
    enforce_amendment_on_retro_edit,
)
from apps.operations.submissions.models import DailySubmission
from apps.operations.submissions.selectors import DailySubmissionSelector
from apps.operations.submissions.services import submit_day

pytestmark = pytest.mark.django_db

UTC = ZoneInfo("UTC")
DAY = date(2026, 6, 5)
_iin = itertools.count(500)


@pytest.fixture
def division():
    org = Organization.objects.create(name="Орг", code="ORG-ENF")
    dtp = DivisionType.objects.get_or_create(
        code="department", defaults={"name": "department"}
    )[0]
    return Division.objects.create(
        organization=org, type_code=dtp, name="Отдел", code="ENF-A"
    )


def make_employee(division):
    n = next(_iin)
    return Employee.objects.create(
        iin=f"{n:012d}",
        full_name=f"Сотрудник {n}",
        rank_code="",
        position_code="",
        division=division,
        employment_status="WORKING",
    )


def _submission(division, business_date, roster_emp_ids, version=1, is_current=True):
    return DailySubmission.objects.create(
        division_id=division.id,
        business_date=business_date,
        version=version,
        is_current=is_current,
        event=DailySubmission.Event.CHANGED,
        submitted_by="seed",
        submitted_at=datetime(2026, 6, 1, tzinfo=UTC),
        snapshot={
            "schema_version": 1,
            "roster": [
                {"employee_id": str(eid), "full_name": "x", "rank": ""}
                for eid in roster_emp_ids
            ],
            "rows": [],
        },
    )


def _enforce(emp, intervals, reason="ретро-правка"):
    enforce_amendment_on_retro_edit(
        emp.id, intervals, actor="boss", reason=reason, triggered_by_status_id=777
    )


def _seed_types():
    StatusType.objects.create(
        code="PENDING_CLARIFICATION",
        name="Уточняется",
        is_hard_block=False,
        priority=990,
        report_column_code="PENDING",
    )
    StatusType.objects.create(
        code="STUDY",
        name="Учёба",
        is_hard_block=False,
        priority=32,
        report_column_code="TRAINING",
    )


def _day(n):
    return DAY + timedelta(days=n)


# --- AC-1/AC-4: covered day → amendment -------------------------------------


def test_covered_day_triggers_amendment(division):
    emp = make_employee(division)
    _submission(division, DAY, [emp.id])  # v1, emp in roster
    _enforce(emp, [(DAY, _day(1))])  # half-open covers DAY
    cur = DailySubmissionSelector.current_for(division.id, DAY)
    assert cur.version == 2
    assert cur.event == DailySubmission.Event.AMENDED
    assert cur.sanction == "ретро-правка"
    assert cur.triggered_by_status_id == 777


def test_uncovered_day_no_amendment(division):
    emp = make_employee(division)  # no submission for DAY
    _enforce(emp, [(DAY, _day(1))])
    assert (
        DailySubmission.objects.filter(
            division_id=division.id, business_date=DAY
        ).count()
        == 0
    )


def test_employee_not_in_roster_no_amendment(division):
    emp = make_employee(division)
    other = make_employee(division)
    _submission(division, DAY, [other.id])  # emp NOT in the snapshot roster
    _enforce(emp, [(DAY, _day(1))])
    assert DailySubmissionSelector.current_for(division.id, DAY).version == 1


def test_multiple_covered_days_each_amended(division):
    emp = make_employee(division)
    _submission(division, DAY, [emp.id])
    _submission(division, _day(1), [emp.id])
    _enforce(emp, [(DAY, _day(2))])  # covers DAY and DAY+1
    assert DailySubmissionSelector.current_for(division.id, DAY).version == 2
    assert DailySubmissionSelector.current_for(division.id, _day(1)).version == 2


# --- AC-3: interval-union (dedup, disjoint gap, half-open end) ---------------


def test_dedup_overlapping_intervals_one_amendment(division):
    emp = make_employee(division)
    _submission(division, DAY, [emp.id])
    # two overlapping intervals both covering DAY → exactly ONE amendment (v2, not v3)
    _enforce(emp, [(DAY, _day(2)), (DAY, _day(1))])
    assert DailySubmissionSelector.current_for(division.id, DAY).version == 2
    assert (
        DailySubmission.objects.filter(
            division_id=division.id, business_date=DAY
        ).count()
        == 2  # v1 + v2
    )


def test_disjoint_intervals_skip_gap_day(division):
    emp = make_employee(division)
    gap = _day(2)
    _submission(division, gap, [emp.id])  # submission ON the gap day
    # disjoint [DAY, DAY+1) and [DAY+4, DAY+5): the gap day (DAY+2) is NOT covered —
    # a min/max bounding box WOULD have amended it.
    _enforce(emp, [(DAY, _day(1)), (_day(4), _day(5))])
    assert DailySubmissionSelector.current_for(division.id, gap).version == 1


def test_half_open_end_day_not_covered(division):
    emp = make_employee(division)
    end = _day(3)
    _submission(division, end, [emp.id])  # submission ON the end day
    _enforce(emp, [(DAY, end)])  # [DAY, end) — end EXCLUDED
    assert DailySubmissionSelector.current_for(division.id, end).version == 1


# --- AC-2: inverse seam (no-op contract + registration) ---------------------


def test_hook_no_op_when_no_handler(monkeypatch):
    # The pre-E5 contract survives: with no handler registered the dispatcher is a
    # no-op (returns None, no side effect) — статусы продолжают звать seam безопасно.
    monkeypatch.setattr(amendment_hook, "_handler", None)
    result = amendment_hook.mark_days_for_amendment(
        uuid.uuid4(), [(DAY, _day(1))], actor="x", reason="r"
    )
    assert result is None


def test_handler_registered_at_ready():
    # AppConfig.ready() wired the submissions handler into the statuses slot.
    assert amendment_hook._handler is enforce_amendment_on_retro_edit


# --- AC-1: integration through resolve_pending_clarification ----------------


def test_resolve_pending_amends_covered_submission(division):
    _seed_types()
    emp = make_employee(division)
    pending = EmployeeStatus.objects.create(
        employee_id=emp.id,
        status_type_code="PENDING_CLARIFICATION",
        date_start=DAY,
        date_end=_day(5),
        source="USER",
    )
    _submission(division, DAY, [emp.id])  # DAY is covered
    resolve_pending_clarification(
        pending,
        resolved_type_code="STUDY",
        date_start=DAY,
        date_end=_day(5),
        actor="op",
        reason="учёба",
    )
    cur = DailySubmissionSelector.current_for(division.id, DAY)
    assert cur.version == 2
    assert cur.event == DailySubmission.Event.AMENDED
    assert cur.sanction == "учёба"  # retro-edit reason is the sanction (Q1)


def test_amendment_failure_rolls_back_retro_edit(division, monkeypatch):
    # «Правка без amendment невозможна»: if amend_day raises, the whole retro-edit
    # rolls back — the PENDING is NOT closed and no resolved status is created.
    _seed_types()
    emp = make_employee(division)
    pending = EmployeeStatus.objects.create(
        employee_id=emp.id,
        status_type_code="PENDING_CLARIFICATION",
        date_start=DAY,
        date_end=_day(5),
        source="USER",
    )
    _submission(division, DAY, [emp.id])

    def boom(*args, **kwargs):
        raise RuntimeError("amend boom")

    monkeypatch.setattr(amendment_enforcement, "amend_day", boom)
    with pytest.raises(RuntimeError):
        resolve_pending_clarification(
            pending,
            resolved_type_code="STUDY",
            date_start=DAY,
            date_end=_day(5),
            actor="op",
            reason="учёба",
        )
    pending.refresh_from_db()
    assert pending.cancelled_at is None  # retro-edit rolled back
    assert not EmployeeStatus.objects.filter(
        employee_id=emp.id, status_type_code="STUDY"
    ).exists()


# --- review проход 1: real snapshot + division-change robustness -------------


def test_real_submit_day_snapshot_is_amended(division):
    # End-to-end against the REAL 5.3b snapshot (built by submit_day via roster_on),
    # not a hand-fabricated one — proves the membership query matches the actual
    # roster format (employee_id as str), so detection can't silently drift.
    emp = make_employee(division)
    today = date(2026, 6, 4)
    with clock.override(today):
        submit_day(division_id=division.id, business_date=today, actor="op")
        assert str(emp.id) in {
            r["employee_id"]
            for r in DailySubmissionSelector.current_for(division.id, today).snapshot[
                "roster"
            ]
        }
        enforce_amendment_on_retro_edit(
            emp.id,
            [(today, today + timedelta(days=1))],
            actor="boss",
            reason="ретро",
            triggered_by_status_id=5,
        )
    cur = DailySubmissionSelector.current_for(division.id, today)
    assert cur.version == 2
    assert cur.event == DailySubmission.Event.AMENDED


def test_division_change_after_submission_still_amends(division):
    # The membership fix (review HIGH): emp is submitted while in division X, then
    # MOVED to division Y. Detection by snapshot membership still finds X's frozen
    # submission — the old division_at approach would resolve the live Y and MISS X
    # (the «две правды» the invariant forbids).
    other = Division.objects.create(
        organization=division.organization,
        type_code=division.type_code,
        name="Отдел-Y",
        code="ENF-Y",
    )
    emp = make_employee(division)
    _submission(division, DAY, [emp.id])  # submitted while emp ∈ division X
    emp.division = other  # live state now diverges from the frozen snapshot
    emp.save(update_fields=["division"])
    _enforce(emp, [(DAY, _day(1))])
    # X's submission (frozen roster holds emp) is amended despite the live move to Y.
    assert DailySubmissionSelector.current_for(division.id, DAY).version == 2
