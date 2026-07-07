"""Tests for division_traffic_light — the per-division светофор (Story 5.5a).

drift = diff(derive(снапшот), derive(live)) at the level of DERIVED WINNERS
(resolve_status), not raw facts: GREEN = snapshot agrees with live, YELLOW =
drift (with per-employee details), RED = no current submission. A change that
moves no winner (lower-priority fact under the winner, a rename) stays GREEN —
the расход is held by the snapshot by design (ARCH-DATA-021 L291). Data is built
directly; real snapshots come from submit_day (5.3b) so the str/UUID key
normalisation and ISO-date parsing are exercised end-to-end.
"""

import itertools
from datetime import date, datetime, timedelta
from zoneinfo import ZoneInfo

import pytest
from django.conf import settings

from apps.core import clock
from apps.core.models import (
    Division,
    DivisionType,
    Employee,
    EmployeeDivisionHistory,
    Organization,
)
from apps.operations.statuses.models import EmployeeStatus, StatusType
from apps.operations.statuses.services import resolve_pending_clarification
from apps.operations.submissions.selectors import DailySubmissionSelector
from apps.operations.submissions.services import submit_day
from apps.operations.submissions.traffic_light import (
    TrafficLightStatus,
    _snapshot_winners,
    division_traffic_light,
)

pytestmark = pytest.mark.django_db

TZ = ZoneInfo(settings.VAPS_LOCAL_TIMEZONE)
UTC = ZoneInfo("UTC")
DAY = date(2026, 6, 5)
_iin = itertools.count(900)


@pytest.fixture
def division():
    org = Organization.objects.create(name="Орг", code="ORG-TL")
    dtp = DivisionType.objects.get_or_create(
        code="department", defaults={"name": "department"}
    )[0]
    return Division.objects.create(
        organization=org, type_code=dtp, name="Отдел", code="TL-A"
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


def make_status(emp, code, date_start, date_end):
    return EmployeeStatus.objects.create(
        employee_id=emp.id,
        status_type_code=code,
        date_start=date_start,
        date_end=date_end,
        source="USER",
    )


def _aware(day, hour, minute):
    return datetime(day.year, day.month, day.day, hour, minute, tzinfo=TZ)


def _submit(division, business_date=DAY, override=None):
    with clock.override(override or business_date):
        return submit_day(
            division_id=division.id, business_date=business_date, actor="op"
        )


# --- AC-1: GREEN — submitted and matches ------------------------------------


def test_green_when_submission_matches_live(division):
    emp = make_employee(division)
    make_status(emp, "DUTY", date(2026, 5, 1), date(2026, 7, 1))
    sub = _submit(division)
    tl = division_traffic_light(division.id, DAY)
    assert tl.status == TrafficLightStatus.GREEN
    assert tl.late == sub.late
    assert tl.drift is None


def test_green_employee_without_facts_is_in_service_both_sides(division):
    make_employee(division)  # no status → IN_SERVICE on snapshot AND live
    _submit(division)
    tl = division_traffic_light(division.id, DAY)
    assert tl.status == TrafficLightStatus.GREEN
    assert tl.drift is None


def test_green_empty_division_when_submitted(division):
    _submit(division)  # roster=[] — a valid empty submission (5.3b)
    tl = division_traffic_light(division.id, DAY)
    assert tl.status == TrafficLightStatus.GREEN


# --- AC-3: RED — not submitted ----------------------------------------------


def test_red_when_no_submission(division):
    make_employee(division)
    tl = division_traffic_light(division.id, DAY)
    assert tl.status == TrafficLightStatus.RED
    assert tl.late is False
    assert tl.drift is None


def test_red_empty_division_without_submission(division):
    # пустой ростер + нет сдачи → RED (Q3 default; neutral отдан каскаду 5.5b)
    tl = division_traffic_light(division.id, DAY)
    assert tl.status == TrafficLightStatus.RED


# --- AC-4: late RED → GREEN with marker --------------------------------------


def test_late_submission_matches_is_green_with_late_marker(division):
    emp = make_employee(division)
    make_status(emp, "DUTY", date(2026, 5, 1), date(2026, 7, 1))
    sub = _submit(division, override=_aware(DAY, 17, 30))  # after 17:00 → late
    assert sub.late is True
    tl = division_traffic_light(division.id, DAY)
    assert tl.status == TrafficLightStatus.GREEN
    assert tl.late is True


# --- AC-2: YELLOW — winner changed (new interval) ----------------------------


def test_yellow_when_new_interval_changes_winner(division):
    emp = make_employee(division)
    _submit(division)  # snapshot winner = IN_SERVICE (no facts)
    make_status(emp, "DUTY", date(2026, 5, 1), date(2026, 7, 1))  # live → DUTY
    tl = division_traffic_light(division.id, DAY)
    assert tl.status == TrafficLightStatus.YELLOW
    assert tl.drift["changed"] == [
        {"employee_id": str(emp.id), "from": "IN_SERVICE", "to": "DUTY"}
    ]
    assert tl.drift["added"] == [] and tl.drift["removed"] == []


# --- AC-2/AC-5: YELLOW — roster drift ----------------------------------------


def test_yellow_when_newcomer_joins_live_roster(division):
    make_employee(division)
    _submit(division)  # snapshot roster = [emp]
    newcomer = make_employee(division)  # live roster now has a second member
    tl = division_traffic_light(division.id, DAY)
    assert tl.status == TrafficLightStatus.YELLOW
    assert tl.drift["added"] == [str(newcomer.id)]


def test_yellow_retroactive_transfer_drifts_source_division(division):
    # перевод задним числом после сдачи: drift у сдавшего A, live корректен у B.
    other = Division.objects.create(
        organization=division.organization,
        type_code=division.type_code,
        name="Отдел-B",
        code="TL-B",
    )
    emp = make_employee(division)  # in A at submit time
    _submit(division)  # A's snapshot freezes emp in the roster
    # retroactive move to B covering DAY → A's live roster loses emp
    EmployeeDivisionHistory.objects.create(
        employee=emp,
        division=other,
        starts_at=datetime(2026, 1, 1, tzinfo=UTC),
        ends_at=None,
        source="MANUAL",
    )
    tl_a = division_traffic_light(division.id, DAY)
    assert tl_a.status == TrafficLightStatus.YELLOW
    assert tl_a.drift["removed"] == [str(emp.id)]
    # B never submitted its day → RED (its live is correct, just unsubmitted)
    tl_b = division_traffic_light(other.id, DAY)
    assert tl_b.status == TrafficLightStatus.RED


# --- AC-6: drift is derive-level, not raw-fact -------------------------------


def test_green_when_change_does_not_move_winner(division):
    emp = make_employee(division)
    make_status(emp, "DUTY", date(2026, 5, 1), date(2026, 7, 1))  # winner DUTY (70)
    _submit(division)
    # add a LOWER-priority fact under the winner — derive winner stays DUTY
    make_status(emp, "EVENT_ASSIGNMENT", date(2026, 5, 1), date(2026, 7, 1))  # 80
    tl = division_traffic_light(division.id, DAY)
    assert tl.status == TrafficLightStatus.GREEN
    assert tl.drift is None


def test_green_when_only_denorm_label_changes(division):
    emp = make_employee(division)
    make_status(emp, "DUTY", date(2026, 5, 1), date(2026, 7, 1))
    _submit(division)
    emp.full_name = (
        "Переименован"  # snapshot froze the old name; светофор ignores names
    )
    emp.save(update_fields=["full_name"])
    tl = division_traffic_light(division.id, DAY)
    assert tl.status == TrafficLightStatus.GREEN


def test_green_when_fact_recreated_with_new_status_id(division):
    # AC-6 third sub-case: cancel a fact and recreate an IDENTICAL one (same type
    # and dates) with a NEW status_id → derive winner unchanged → GREEN. The drift
    # is derive-level; _snapshot_winners never reads status_id, so the row's pk
    # churn must not register as drift.
    emp = make_employee(division)
    orig = make_status(emp, "DUTY", date(2026, 5, 1), date(2026, 7, 1))
    _submit(division)  # snapshot froze orig (DUTY, status_id=orig.id)
    orig.cancelled_at = datetime(2026, 6, 6, tzinfo=UTC)
    orig.save(update_fields=["cancelled_at"])
    new = make_status(emp, "DUTY", date(2026, 5, 1), date(2026, 7, 1))
    assert new.id != orig.id  # genuinely a different pk
    tl = division_traffic_light(division.id, DAY)
    assert tl.status == TrafficLightStatus.GREEN
    assert tl.drift is None


# --- AC-7: snapshot adapter — ISO dates + half-open + roster denominator ------


def test_snapshot_winners_parses_iso_and_honours_half_open():
    snap = {
        "schema_version": 1,
        "roster": [
            {"employee_id": "e1", "full_name": "x", "rank": ""},
            {"employee_id": "e2", "full_name": "y", "rank": ""},  # no rows → IN_SERVICE
        ],
        "rows": [
            {
                "employee_id": "e1",
                "status_type_code": "DUTY",
                "status_id": 1,
                "date_start": "2026-06-01",
                "date_end": "2026-06-05",
                "source": "USER",
            }
        ],
    }
    # business_date == date_end → DUTY does NOT act (half-open) → IN_SERVICE
    assert _snapshot_winners(snap, date(2026, 6, 5)) == {
        "e1": "IN_SERVICE",
        "e2": "IN_SERVICE",
    }
    # business_date inside [start, end) → DUTY; e2 (no rows) stays IN_SERVICE
    assert _snapshot_winners(snap, date(2026, 6, 4)) == {
        "e1": "DUTY",
        "e2": "IN_SERVICE",
    }


# --- integration: self-heal (amended) vs safety-net (unamended) --------------


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


def test_amended_path_self_heals_to_green(division):
    # resolve_pending_clarification auto-amends the covered submission (5.4b) →
    # the v2 snapshot reflects the resolved status → светофор GREEN (no drift).
    _seed_types()
    emp = make_employee(division)
    pending = EmployeeStatus.objects.create(
        employee_id=emp.id,
        status_type_code="PENDING_CLARIFICATION",
        date_start=DAY,
        date_end=DAY + timedelta(days=5),
        source="USER",
    )
    with clock.override(DAY):
        submit_day(division_id=division.id, business_date=DAY, actor="op")
        # before resolve: snapshot == live (both PENDING) → GREEN
        assert (
            division_traffic_light(division.id, DAY).status == TrafficLightStatus.GREEN
        )
        resolve_pending_clarification(
            pending,
            resolved_type_code="STUDY",
            date_start=DAY,
            date_end=DAY + timedelta(days=5),
            actor="op",
            reason="учёба",
        )
    assert DailySubmissionSelector.current_for(division.id, DAY).version == 2  # amended
    # v2 snapshot (STUDY) == live (STUDY) → self-healed to GREEN
    assert division_traffic_light(division.id, DAY).status == TrafficLightStatus.GREEN


def test_unamended_drift_is_yellow_safety_net(division):
    # A path that does NOT auto-amend (a direct status create) drifts silently —
    # the светофор is the safety-net that surfaces it as YELLOW.
    emp = make_employee(division)
    _submit(division)  # snapshot winner = IN_SERVICE
    make_status(emp, "SICK_LEAVE", date(2026, 5, 1), date(2026, 7, 1))  # no amendment
    tl = division_traffic_light(division.id, DAY)
    assert tl.status == TrafficLightStatus.YELLOW
    assert tl.drift["changed"] == [
        {"employee_id": str(emp.id), "from": "IN_SERVICE", "to": "SICK_LEAVE"}
    ]


# --- robustness: str/UUID key normalisation ----------------------------------


def test_str_division_id_is_accepted(division):
    emp = make_employee(division)
    make_status(emp, "DUTY", date(2026, 5, 1), date(2026, 7, 1))
    _submit(division)
    # a str division_id must behave identically (uuid coercion) — and the
    # str(snapshot) vs UUID(live) employee keys must reconcile (else false drift)
    tl = division_traffic_light(str(division.id), DAY)
    assert tl.status == TrafficLightStatus.GREEN
    assert tl.drift is None
