"""Tests for submit_day — the day-submission service (Story 5.3b).

submit_day is the first writer of DailySubmission rows: window-422 / duplicate-409
/ diff-event (CONFIRMED_NO_CHANGES vs CHANGED against the previous day's snapshot)
/ late / atomic create, on top of 5.3a's build_division_snapshot. Data is built
directly (no factory_boy); the Clock is frozen via clock.override (a date → local
midnight, an aware datetime → that instant) — that pins the 17:00 late boundary.
"""

import itertools
import uuid
from datetime import date, datetime, timedelta
from zoneinfo import ZoneInfo

import pytest
from django.conf import settings

from apps.core import clock
from apps.core.clock import Clock
from apps.core.exceptions import DomainError
from apps.core.models import Division, DivisionType, Employee, Organization
from apps.operations.statuses.models import EmployeeStatus
from apps.operations.submissions.models import DailySubmission
from apps.operations.submissions.selectors import DailySubmissionSelector
from apps.operations.submissions.services import submit_day
from apps.operations.submissions.services.snapshot import build_division_snapshot

pytestmark = pytest.mark.django_db

TZ = ZoneInfo(settings.VAPS_LOCAL_TIMEZONE)
TODAY = date(2026, 6, 4)
_iin = itertools.count(700)


@pytest.fixture
def division():
    org = Organization.objects.create(name="Орг", code="ORG-SUB")
    dtp = DivisionType.objects.get_or_create(
        code="department", defaults={"name": "department"}
    )[0]
    return Division.objects.create(
        organization=org, type_code=dtp, name="Отдел", code="SUB-A"
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


def _prior(division, business_date, snapshot):
    """A directly-built prior is_current submission (diff baseline)."""
    return DailySubmission.objects.create(
        division_id=division.id,
        business_date=business_date,
        version=1,
        is_current=True,
        event=DailySubmission.Event.CHANGED,
        submitted_by="seed",
        submitted_at=datetime(2026, 6, 1, tzinfo=ZoneInfo("UTC")),
        snapshot=snapshot,
    )


# --- happy path -------------------------------------------------------------


def test_happy_path_creates_current_v1(division):
    emp = make_employee(division)
    make_status(emp, "DUTY", date(2026, 5, 1), date(2026, 7, 1))
    with clock.override(TODAY):  # local midnight → not late
        sub = submit_day(division_id=division.id, business_date=TODAY, actor="op-1")
        assert sub.submitted_at == Clock.now()
    assert sub.version == 1
    assert sub.is_current is True
    assert sub.submitted_by == "op-1"
    assert sub.late is False
    assert sub.event == DailySubmission.Event.CHANGED  # first submission
    assert [r["employee_id"] for r in sub.snapshot["roster"]] == [str(emp.id)]


# --- AC-1 duplicate ---------------------------------------------------------


def test_duplicate_same_day_raises_409(division):
    make_employee(division)
    with clock.override(TODAY):
        submit_day(division_id=division.id, business_date=TODAY, actor="op")
        with pytest.raises(DomainError) as ei:
            submit_day(division_id=division.id, business_date=TODAY, actor="op")
    assert ei.value.code == "DAY_ALREADY_SUBMITTED"
    assert ei.value.http_status == 409
    # no side effect: still exactly one row for the day.
    assert (
        DailySubmission.objects.filter(
            division_id=division.id, business_date=TODAY
        ).count()
        == 1
    )


# --- AC-2 window ------------------------------------------------------------


def test_window_today_and_tomorrow_ok(division):
    with clock.override(TODAY):
        submit_day(division_id=division.id, business_date=TODAY, actor="op")
        submit_day(
            division_id=division.id,
            business_date=TODAY + timedelta(days=1),
            actor="op",
        )
    assert DailySubmission.objects.filter(division_id=division.id).count() == 2


def test_past_date_rejected_422(division):
    with clock.override(TODAY):
        with pytest.raises(DomainError) as ei:
            submit_day(
                division_id=division.id,
                business_date=TODAY - timedelta(days=1),
                actor="op",
            )
    assert ei.value.code == "BUSINESS_DATE_OUT_OF_WINDOW"
    assert ei.value.http_status == 422


def test_far_future_rejected_422(division):
    with clock.override(TODAY):
        with pytest.raises(DomainError) as ei:
            submit_day(
                division_id=division.id,
                business_date=TODAY + timedelta(days=5),
                actor="op",
            )
    assert ei.value.code == "BUSINESS_DATE_OUT_OF_WINDOW"


# --- AC-3 late boundary -----------------------------------------------------


def test_late_false_before_control_hour(division):
    with clock.override(_aware(TODAY, 16, 59)):
        sub = submit_day(division_id=division.id, business_date=TODAY, actor="op")
    assert sub.late is False


def test_late_true_after_control_hour(division):
    with clock.override(_aware(TODAY, 17, 1)):
        sub = submit_day(division_id=division.id, business_date=TODAY, actor="op")
    assert sub.late is True


def test_late_false_exactly_at_control_hour(division):
    # «после 17:00» → strictly after; at exactly 17:00 it is NOT late.
    with clock.override(_aware(TODAY, 17, 0)):
        sub = submit_day(division_id=division.id, business_date=TODAY, actor="op")
    assert sub.late is False


# --- AC-4 diff event --------------------------------------------------------


def test_first_submission_event_is_changed(division):
    make_employee(division)
    with clock.override(TODAY):
        sub = submit_day(division_id=division.id, business_date=TODAY, actor="op")
    assert sub.event == DailySubmission.Event.CHANGED


def test_no_change_event_is_confirmed(division):
    emp = make_employee(division)
    make_status(emp, "DUTY", date(2026, 5, 1), date(2026, 7, 1))
    # prior is_current submission whose snapshot CONTENT equals today's срез
    # (same build) → diff finds no change → CONFIRMED_NO_CHANGES.
    _prior(
        division, TODAY - timedelta(days=1), build_division_snapshot(division.id, TODAY)
    )
    with clock.override(TODAY):
        sub = submit_day(division_id=division.id, business_date=TODAY, actor="op")
    assert sub.event == DailySubmission.Event.CONFIRMED_NO_CHANGES


def test_changed_event_when_facts_differ(division):
    emp = make_employee(division)
    make_status(emp, "DUTY", date(2026, 5, 1), date(2026, 7, 1))
    # prior with a DIFFERENT (empty) snapshot → today has facts → CHANGED.
    _prior(
        division,
        TODAY - timedelta(days=1),
        {"schema_version": 1, "roster": [], "rows": []},
    )
    with clock.override(TODAY):
        sub = submit_day(division_id=division.id, business_date=TODAY, actor="op")
    assert sub.event == DailySubmission.Event.CHANGED


# --- AC-5 empty division ----------------------------------------------------


def test_empty_division_is_valid(division):
    with clock.override(TODAY):
        sub = submit_day(division_id=division.id, business_date=TODAY, actor="op")
    assert sub.snapshot == {"schema_version": 1, "roster": [], "rows": []}
    assert sub.event == DailySubmission.Event.CHANGED


# --- actor guard ------------------------------------------------------------


def test_blank_actor_raises_400(division):
    with clock.override(TODAY):
        with pytest.raises(DomainError) as ei:
            submit_day(division_id=division.id, business_date=TODAY, actor="   ")
    assert ei.value.http_status == 400


# --- selector ---------------------------------------------------------------


def test_selector_current_for(division):
    assert DailySubmissionSelector.current_for(division.id, TODAY) is None
    with clock.override(TODAY):
        sub = submit_day(division_id=division.id, business_date=TODAY, actor="op")
    assert DailySubmissionSelector.current_for(division.id, TODAY) == sub


def test_selector_previous_for_picks_most_recent_prior(division):
    empty = {"schema_version": 1, "roster": [], "rows": []}
    _prior(division, TODAY - timedelta(days=2), empty)
    _prior(division, TODAY - timedelta(days=1), empty)
    prev = DailySubmissionSelector.previous_for(division.id, TODAY)
    assert prev.business_date == TODAY - timedelta(days=1)


# --- existence gate (review D2: 404 BEFORE build) ---------------------------


def test_nonexistent_division_raises_404(division):
    """Валидный, но фантомный UUID → 404 ENTITY_NOT_FOUND, никакой пустой сдачи
    для несуществующего подразделения (иначе фантом неотличим от пустого)."""
    ghost = uuid.uuid4()
    with clock.override(TODAY):
        with pytest.raises(DomainError) as ei:
            submit_day(division_id=ghost, business_date=TODAY, actor="op")
    assert ei.value.code == "ENTITY_NOT_FOUND"
    assert ei.value.http_status == 404
    assert DailySubmission.objects.filter(division_id=ghost).count() == 0


# --- AC-6 atomicity (review P2) ---------------------------------------------


def test_atomic_rollback_leaves_no_row(division, monkeypatch):
    """Сбой ПОСЛЕ реального INSERT откатывает строку: срез+создание в одной txn
    (@transaction.atomic + savepoint) → фантом-строки не остаётся."""
    orig_create = DailySubmission.objects.create

    def insert_then_boom(*args, **kwargs):
        orig_create(*args, **kwargs)  # real INSERT inside the atomic block
        raise RuntimeError("boom after insert")

    monkeypatch.setattr(DailySubmission.objects, "create", insert_then_boom)
    with clock.override(TODAY):
        with pytest.raises(RuntimeError):
            submit_day(division_id=division.id, business_date=TODAY, actor="op")
    assert (
        DailySubmission.objects.filter(
            division_id=division.id, business_date=TODAY
        ).count()
        == 0
    )


# --- AC-2 explicit window_dates (review P3) ---------------------------------


def test_explicit_window_dates_override_default(division):
    """Явный window_dates переопределяет default {today, tomorrow}: дата ВНЕ
    дефолта принимается, а today (в дефолте) — отвергается, если не в окне."""
    custom = [TODAY + timedelta(days=3)]
    with clock.override(TODAY):
        sub = submit_day(
            division_id=division.id,
            business_date=TODAY + timedelta(days=3),
            actor="op",
            window_dates=custom,
        )
        assert sub.business_date == TODAY + timedelta(days=3)
        with pytest.raises(DomainError) as ei:
            submit_day(
                division_id=division.id,
                business_date=TODAY,
                actor="op",
                window_dates=custom,
            )
    assert ei.value.code == "BUSINESS_DATE_OUT_OF_WINDOW"
