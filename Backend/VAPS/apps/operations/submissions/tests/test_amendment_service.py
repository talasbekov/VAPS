"""Tests for amend_day — the amendment-flow service (Story 5.4a).

amend_day creates the next version (event=AMENDED) of an already-submitted day:
version = max+1, flip prior is_current BEFORE inserting the new current (immediate
partial-unique), fresh self-contained срез (5.3a builder), reason/sanction/
triggered_by_status_id. The prior version is preserved (snapshot not rewritten —
ARCH-DATA-021). Mirrors test_day_submission_service.py: data built directly, Clock
frozen via clock.override.

Out of scope (NOT tested here — other stories): the retro-edit enforcement hook /
inverse seam (5.4b), audit emission (5.9), permissions (5.8), sanction escalation
after расход release (forward-seam, E6).
"""

import itertools
import re
import uuid
from datetime import date, datetime, timedelta
from pathlib import Path
from zoneinfo import ZoneInfo

import pytest
from django.conf import settings
from django.db import IntegrityError

from apps.core import clock
from apps.core.exceptions import DomainError
from apps.core.models import Division, DivisionType, Employee, Organization
from apps.operations.statuses.models import EmployeeStatus
from apps.operations.submissions.models import DailySubmission
from apps.operations.submissions.selectors import DailySubmissionSelector
from apps.operations.submissions.services import amend_day, submit_day

pytestmark = pytest.mark.django_db

TZ = ZoneInfo(settings.VAPS_LOCAL_TIMEZONE)
TODAY = date(2026, 6, 4)
_iin = itertools.count(900)


@pytest.fixture
def division():
    org = Organization.objects.create(name="Орг", code="ORG-AMD")
    dtp = DivisionType.objects.get_or_create(
        code="department", defaults={"name": "department"}
    )[0]
    return Division.objects.create(
        organization=org, type_code=dtp, name="Отдел", code="AMD-A"
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


def _direct_v1(division, business_date, snapshot=None):
    """A directly-built current v1 (lets tests amend a PAST date submit_day forbids)."""
    return DailySubmission.objects.create(
        division_id=division.id,
        business_date=business_date,
        version=1,
        is_current=True,
        event=DailySubmission.Event.CHANGED,
        submitted_by="seed",
        submitted_at=datetime(2026, 6, 1, tzinfo=ZoneInfo("UTC")),
        snapshot=snapshot
        if snapshot is not None
        else {"schema_version": 1, "roster": [], "rows": []},
    )


def _current(division, business_date):
    return DailySubmissionSelector.current_for(division.id, business_date)


def _amend(division, business_date, **over):
    kwargs = {
        "division_id": division.id,
        "business_date": business_date,
        "actor": "boss-1",
        "reason": "уточнение госпиталя со вторника",
        "sanction": "приказ-12",
    }
    kwargs.update(over)
    return amend_day(**kwargs)


# --- AC-1 create v2 ---------------------------------------------------------


def test_amend_creates_v2_current_amended(division):
    make_employee(division)
    with clock.override(TODAY):
        v1 = submit_day(division_id=division.id, business_date=TODAY, actor="op")
        v2 = _amend(division, TODAY)
    assert v2.version == 2
    assert v2.is_current is True
    assert v2.event == DailySubmission.Event.AMENDED
    assert v2.reason == "уточнение госпиталя со вторника"
    assert v2.sanction == "приказ-12"
    assert v2.submitted_by == "boss-1"
    # exactly one current after amend (flip-before-insert held).
    assert (
        DailySubmission.objects.filter(
            division_id=division.id, business_date=TODAY, is_current=True
        ).count()
        == 1
    )
    v1.refresh_from_db()
    assert v1.is_current is False


def test_amend_preserves_v1_snapshot(division):
    emp = make_employee(division)
    make_status(emp, "DUTY", date(2026, 5, 1), date(2026, 7, 1))
    with clock.override(TODAY):
        v1 = submit_day(division_id=division.id, business_date=TODAY, actor="op")
        v1_snapshot = v1.snapshot
        _amend(division, TODAY)
    v1.refresh_from_db()
    # v1 row still exists, demoted, snapshot byte-for-byte unchanged (immutable).
    assert v1.version == 1
    assert v1.is_current is False
    assert v1.snapshot == v1_snapshot


def test_amend_rebuilds_snapshot_from_corrected_state(division):
    emp = make_employee(division)
    with clock.override(TODAY):
        v1 = submit_day(division_id=division.id, business_date=TODAY, actor="op")
        assert v1.snapshot["rows"] == []  # no status yet
        # retro-add a status covering TODAY, then amend → v2 re-snapshots it.
        make_status(emp, "DUTY", date(2026, 5, 1), date(2026, 7, 1))
        v2 = _amend(division, TODAY)
    codes = [r["status_type_code"] for r in v2.snapshot["rows"]]
    assert codes == ["DUTY"]


# --- AC-2 chain v3 ----------------------------------------------------------


def test_amend_chain_to_v3(division):
    make_employee(division)
    with clock.override(TODAY):
        submit_day(division_id=division.id, business_date=TODAY, actor="op")
        _amend(division, TODAY)  # v2
        v3 = _amend(division, TODAY)  # amendment of an amendment
    assert v3.version == 3
    versions = sorted(
        DailySubmission.objects.filter(
            division_id=division.id, business_date=TODAY
        ).values_list("version", flat=True)
    )
    assert versions == [1, 2, 3]  # chain traceable ≥2 links
    assert (
        DailySubmission.objects.filter(
            division_id=division.id, business_date=TODAY, is_current=True
        ).count()
        == 1
    )
    assert _current(division, TODAY).version == 3


# --- AC-4 precondition / window bypass --------------------------------------


def test_amend_without_submission_raises_422(division):
    with clock.override(TODAY):
        with pytest.raises(DomainError) as ei:
            _amend(division, TODAY)
    assert ei.value.code == "NO_SUBMISSION_TO_AMEND"
    assert ei.value.http_status == 422
    # no side effect: nothing created.
    assert DailySubmission.objects.filter(division_id=division.id).count() == 0


def test_amend_bypasses_submission_window(division):
    # A past date submit_day rejects (BUSINESS_DATE_OUT_OF_WINDOW); amendment of an
    # already-submitted past day must succeed — that is the whole point.
    past = TODAY - timedelta(days=10)
    _direct_v1(division, past)
    with clock.override(TODAY):
        v2 = _amend(division, past)
    assert v2.version == 2
    assert v2.business_date == past
    assert v2.event == DailySubmission.Event.AMENDED


# --- guards -----------------------------------------------------------------


def test_amend_blank_actor_raises_400(division):
    _direct_v1(division, TODAY)
    with clock.override(TODAY):
        with pytest.raises(DomainError) as ei:
            _amend(division, TODAY, actor="   ")
    assert ei.value.http_status == 400


def test_amend_blank_reason_raises_400(division):
    _direct_v1(division, TODAY)
    with clock.override(TODAY):
        with pytest.raises(DomainError) as ei:
            _amend(division, TODAY, reason="  ")
    assert ei.value.http_status == 400


def test_amend_blank_sanction_raises_400(division):
    _direct_v1(division, TODAY)
    with clock.override(TODAY):
        with pytest.raises(DomainError) as ei:
            _amend(division, TODAY, sanction="")
    assert ei.value.http_status == 400


def test_amend_nonexistent_division_raises_404(division):
    ghost = uuid.uuid4()
    with clock.override(TODAY):
        with pytest.raises(DomainError) as ei:
            amend_day(
                division_id=ghost,
                business_date=TODAY,
                actor="op",
                reason="r",
                sanction="s",
            )
    assert ei.value.code == "ENTITY_NOT_FOUND"
    assert ei.value.http_status == 404


# --- triggered_by_status_id + late ------------------------------------------


def test_amend_stores_triggered_by_status_id(division):
    emp = make_employee(division)
    st = make_status(emp, "DUTY", date(2026, 5, 1), date(2026, 7, 1))
    _direct_v1(division, TODAY)
    with clock.override(TODAY):
        v2 = _amend(division, TODAY, triggered_by_status_id=st.id)
    assert v2.triggered_by_status_id == st.id


def test_amend_triggered_by_status_id_optional(division):
    # Manual amendment without a specific status trigger → NULL.
    _direct_v1(division, TODAY)
    with clock.override(TODAY):
        v2 = _amend(division, TODAY)
    assert v2.triggered_by_status_id is None


def test_amend_late_always_false_even_after_control_hour(division):
    # Lateness is meaningful for the FIRST submission (after 17:00), not for an
    # amendment (Решение №5): amend at 23:00 still late=False.
    _direct_v1(division, TODAY)
    with clock.override(datetime(2026, 6, 4, 23, 0, tzinfo=TZ)):
        v2 = _amend(division, TODAY)
    assert v2.late is False


# --- selector ---------------------------------------------------------------


def test_selector_latest_for_returns_max_version(division):
    assert DailySubmissionSelector.latest_for(division.id, TODAY) is None
    _direct_v1(division, TODAY)
    with clock.override(TODAY):
        _amend(division, TODAY)  # v2
    latest = DailySubmissionSelector.latest_for(division.id, TODAY)
    assert latest.version == 2


def test_selector_latest_for_finds_head_with_zero_current(division):
    # «ноль текущих» edge: a day whose only version is non-current still has a
    # chain head — latest_for finds it (current_for would return None).
    DailySubmission.objects.create(
        division_id=division.id,
        business_date=TODAY,
        version=1,
        is_current=False,
        event=DailySubmission.Event.CHANGED,
        submitted_by="seed",
        submitted_at=datetime(2026, 6, 1, tzinfo=ZoneInfo("UTC")),
        snapshot={"schema_version": 1, "roster": [], "rows": []},
    )
    assert DailySubmissionSelector.current_for(division.id, TODAY) is None
    assert DailySubmissionSelector.latest_for(division.id, TODAY).version == 1


# --- concurrency backstop / zero-current / empty-roster (review проход 1) ----


def test_concurrent_version_collision_hits_constraint_backstop(division, monkeypatch):
    # Deterministic stand-in for the concurrent-amend race (concurrency tests are
    # deferred, ARCH-DEFERRED-044): force latest_for to return a STALE version
    # (the select_for_update LIMIT-1 race) while a v2 already exists. amend computes
    # version=2 → collides on unique_daily_submission_version → IntegrityError; the
    # nested savepoint rolls back the flip, so the prior current row survives.
    v1 = _direct_v1(division, TODAY)  # version=1, current
    DailySubmission.objects.create(  # a v2 committed by a "concurrent" TxA
        division_id=division.id,
        business_date=TODAY,
        version=2,
        is_current=False,
        event=DailySubmission.Event.AMENDED,
        reason="конкурент",
        sanction="приказ-9",
        submitted_by="other",
        submitted_at=datetime(2026, 6, 1, tzinfo=ZoneInfo("UTC")),
        snapshot={"schema_version": 1, "roster": [], "rows": []},
    )
    monkeypatch.setattr(
        DailySubmissionSelector,
        "latest_for",
        lambda division_id, business_date, lock=False: v1,
    )
    with clock.override(TODAY):
        with pytest.raises(IntegrityError):
            _amend(division, TODAY)  # version=1+1=2 collides with the existing v2
    v1.refresh_from_db()
    assert v1.is_current is True  # savepoint rolled the flip back
    assert (
        DailySubmission.objects.filter(
            division_id=division.id, business_date=TODAY
        ).count()
        == 2  # no v3 created
    )


def test_amend_on_zero_current_day_creates_current(division):
    # «ноль текущих»: a day whose only version is non-current → amend creates a new
    # current (flip matches 0 rows, insert is_current=True), version=max+1.
    DailySubmission.objects.create(
        division_id=division.id,
        business_date=TODAY,
        version=1,
        is_current=False,
        event=DailySubmission.Event.CHANGED,
        submitted_by="seed",
        submitted_at=datetime(2026, 6, 1, tzinfo=ZoneInfo("UTC")),
        snapshot={"schema_version": 1, "roster": [], "rows": []},
    )
    with clock.override(TODAY):
        v2 = _amend(division, TODAY)
    assert v2.version == 2
    assert v2.is_current is True
    assert (
        DailySubmission.objects.filter(
            division_id=division.id, business_date=TODAY, is_current=True
        ).count()
        == 1
    )


def test_amend_empty_roster_division(division):
    # Division with no employees → v2 snapshot {roster:[], rows:[]} (valid amend,
    # mirrors submit_day empty-division). Re-snapshot of corrected state can be empty.
    _direct_v1(division, TODAY)
    with clock.override(TODAY):
        v2 = _amend(division, TODAY)
    assert v2.snapshot == {"schema_version": 1, "roster": [], "rows": []}
    assert v2.event == DailySubmission.Event.AMENDED


# --- closed world: new code in registry -------------------------------------


def test_no_submission_to_amend_code_in_registry():
    path = Path(settings.BASE_DIR).parent.parent / "docs/registries/error-codes.yaml"
    text = path.read_text(encoding="utf-8")
    block = re.search(r"^  NO_SUBMISSION_TO_AMEND:\n((?:    .*\n)+)", text, re.M)
    assert block, "NO_SUBMISSION_TO_AMEND missing from error-codes.yaml"
    assert "http_status: 422" in block.group(1)
