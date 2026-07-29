"""Tests for the daily "pilot pulse" digest (Story 13.5c).

Mirrors test_threshold_check.py's fixture style (its own make_division/
set_required/set_default_recipient/_submit helpers — self-contained, not
shared across test files in this package).
"""

import itertools
from datetime import date, datetime
from zoneinfo import ZoneInfo

import pytest
from django.conf import settings

from apps.core import clock
from apps.core.models import Division, DivisionType, Organization
from apps.notifications.models import Notification
from apps.operations.submissions.models import SubmissionControlSettings
from apps.operations.submissions.services import submit_day
from apps.operations.submissions.services.pilot_pulse import pilot_pulse_digest

pytestmark = pytest.mark.django_db

LOCAL = ZoneInfo(settings.VAPS_LOCAL_TIMEZONE)
DAY = date(2026, 6, 5)
_code = itertools.count(1)


@pytest.fixture
def org_dt():
    org = Organization.objects.create(name="Орг", code="ORG-PP")
    dt = DivisionType.objects.get_or_create(
        code="department", defaults={"name": "department"}
    )[0]
    return org, dt


def make_division(org_dt):
    org, dt = org_dt
    c = f"PP-{next(_code)}"
    return Division.objects.create(organization=org, type_code=dt, name=c, code=c)


def set_required(division_ids):
    s = SubmissionControlSettings.objects.get_or_create(singleton_key=1)[0]
    s.required_division_ids = list(division_ids)
    s.save(update_fields=["required_division_ids"])


def set_default_recipient(recipient):
    s = SubmissionControlSettings.objects.get_or_create(singleton_key=1)[0]
    s.default_notify_recipient = recipient
    s.save(update_fields=["default_notify_recipient"])


def _submit(division, business_date, actor="op"):
    with clock.override(business_date):
        return submit_day(
            division_id=division.id, business_date=business_date, actor=actor
        )


def after_cutoff(d, hour=21):
    """Aware local datetime AFTER the pulse's 20:00 cutoff."""
    return datetime(d.year, d.month, d.day, hour, 0, tzinfo=LOCAL)


def before_cutoff(d, hour=10):
    """Aware local datetime BEFORE the pulse's 20:00 cutoff."""
    return datetime(d.year, d.month, d.day, hour, 0, tzinfo=LOCAL)


def _digest():
    return Notification.objects.get(kind=Notification.Kind.PILOT_PULSE_DIGEST)


def test_before_cutoff_no_digest(org_dt):
    divisions = [make_division(org_dt) for _ in range(2)]
    set_required([d.id for d in divisions])
    set_default_recipient("dev-1")
    _submit(divisions[0], DAY)

    with clock.override(before_cutoff(DAY)):
        pilot_pulse_digest()

    assert not Notification.objects.filter(
        kind=Notification.Kind.PILOT_PULSE_DIGEST
    ).exists()


def test_after_cutoff_with_submissions_reports_counts_not_silent(org_dt):
    divisions = [make_division(org_dt) for _ in range(3)]
    set_required([d.id for d in divisions])
    set_default_recipient("dev-1")
    _submit(divisions[0], DAY, actor="op-a")
    _submit(divisions[1], DAY, actor="op-b")

    with clock.override(after_cutoff(DAY)):
        pilot_pulse_digest()

    note = _digest()
    assert note.recipient == "dev-1"
    assert note.business_date == DAY
    assert note.payload == {
        "required_count": 3,
        "submitted_count": 2,
        "active_user_count": 2,
        "silent_day": False,
    }


def test_active_user_count_counts_distinct_submitters_not_rows(org_dt):
    # Two divisions submitted by the SAME operator → 1 active user, 2 subs.
    divisions = [make_division(org_dt) for _ in range(2)]
    set_required([d.id for d in divisions])
    set_default_recipient("dev-1")
    _submit(divisions[0], DAY, actor="op-shared")
    _submit(divisions[1], DAY, actor="op-shared")

    with clock.override(after_cutoff(DAY)):
        pilot_pulse_digest()

    note = _digest()
    assert note.payload["submitted_count"] == 2
    assert note.payload["active_user_count"] == 1


def test_zero_submissions_marks_silent_day_same_business_date(org_dt):
    divisions = [make_division(org_dt) for _ in range(2)]
    set_required([d.id for d in divisions])
    set_default_recipient("dev-1")

    with clock.override(after_cutoff(DAY)):
        pilot_pulse_digest()

    note = _digest()
    assert note.business_date == DAY  # AC-2: alarm the SAME day, not next
    assert note.payload["silent_day"] is True
    assert note.payload["submitted_count"] == 0


def test_empty_required_division_ids_still_emits_from_all_submissions(org_dt):
    # AC-1/Dev Notes: unlike 13.5b, an empty required list must NOT silence
    # the pulse — it falls back to ALL current submissions of the day.
    divisions = [make_division(org_dt) for _ in range(2)]
    set_required([])
    set_default_recipient("dev-1")
    _submit(divisions[0], DAY, actor="op-a")

    with clock.override(after_cutoff(DAY)):
        pilot_pulse_digest()

    note = _digest()
    assert note.payload == {
        "required_count": 0,
        "submitted_count": 1,
        "active_user_count": 1,
        "silent_day": False,
    }


def test_empty_required_and_zero_submissions_still_silent_day(org_dt):
    set_required([])
    set_default_recipient("dev-1")

    with clock.override(after_cutoff(DAY)):
        pilot_pulse_digest()

    note = _digest()
    assert note.payload == {
        "required_count": 0,
        "submitted_count": 0,
        "active_user_count": 0,
        "silent_day": True,
    }


def test_blank_default_recipient_logs_and_skips(org_dt, caplog):
    divisions = [make_division(org_dt) for _ in range(2)]
    set_required([d.id for d in divisions])
    set_default_recipient("")

    with clock.override(after_cutoff(DAY)):
        pilot_pulse_digest()  # must not raise

    assert not Notification.objects.filter(
        kind=Notification.Kind.PILOT_PULSE_DIGEST
    ).exists()
    assert "no default_notify_recipient" in caplog.text


def test_repeat_call_same_day_is_a_no_op(org_dt):
    divisions = [make_division(org_dt) for _ in range(2)]
    set_required([d.id for d in divisions])
    set_default_recipient("dev-1")
    _submit(divisions[0], DAY)

    with clock.override(after_cutoff(DAY)):
        pilot_pulse_digest()
        pilot_pulse_digest()
        pilot_pulse_digest()

    assert (
        Notification.objects.filter(
            kind=Notification.Kind.PILOT_PULSE_DIGEST
        ).count()
        == 1
    )
