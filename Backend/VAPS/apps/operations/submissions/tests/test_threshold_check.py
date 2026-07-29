"""Tests for the intraday submission-threshold alert (Story 13.5b).

Mirrors test_lagging_check.py's fixture style (its own make_division/
set_required/set_default_recipient/_submit helpers — test files in this
package are self-contained, not sharing a helper module) but WITHOUT any
watermark/lock setup: this service has neither (see threshold_check.py's
module docstring for why).
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
from apps.operations.submissions.services.threshold_check import (
    check_submission_threshold,
)

pytestmark = pytest.mark.django_db

LOCAL = ZoneInfo(settings.VAPS_LOCAL_TIMEZONE)
DAY = date(2026, 6, 5)
_code = itertools.count(1)


@pytest.fixture
def org_dt():
    org = Organization.objects.create(name="Орг", code="ORG-TC")
    dt = DivisionType.objects.get_or_create(
        code="department", defaults={"name": "department"}
    )[0]
    return org, dt


def make_division(org_dt):
    org, dt = org_dt
    c = f"TC-{next(_code)}"
    return Division.objects.create(organization=org, type_code=dt, name=c, code=c)


def set_required(division_ids):
    s = SubmissionControlSettings.objects.get_or_create(singleton_key=1)[0]
    s.required_division_ids = list(division_ids)
    s.save(update_fields=["required_division_ids"])


def set_default_recipient(recipient):
    s = SubmissionControlSettings.objects.get_or_create(singleton_key=1)[0]
    s.default_notify_recipient = recipient
    s.save(update_fields=["default_notify_recipient"])


def set_alert(hour, threshold_pct):
    s = SubmissionControlSettings.objects.get_or_create(singleton_key=1)[0]
    s.alert_hour = hour
    s.alert_threshold_pct = threshold_pct
    s.save(update_fields=["alert_hour", "alert_threshold_pct"])


def _submit(division, business_date):
    with clock.override(business_date):
        return submit_day(
            division_id=division.id, business_date=business_date, actor="op"
        )


def after_hour(d, hour=16):
    """Aware local datetime AFTER the default alert_hour (15:30)."""
    return datetime(d.year, d.month, d.day, hour, 0, tzinfo=LOCAL)


def before_hour(d, hour=8):
    """Aware local datetime BEFORE the default alert_hour (15:30)."""
    return datetime(d.year, d.month, d.day, hour, 0, tzinfo=LOCAL)


def test_below_threshold_after_alert_hour_fires_once(org_dt):
    # AC-1: 1-of-4 submitted (25%) < 50% default threshold, past 15:30 → alert.
    divisions = [make_division(org_dt) for _ in range(4)]
    set_required([d.id for d in divisions])
    set_default_recipient("dev-1")
    _submit(divisions[0], DAY)

    with clock.override(after_hour(DAY)):
        check_submission_threshold()

    notes = Notification.objects.filter(
        kind=Notification.Kind.SUBMISSION_THRESHOLD_ALERT
    )
    assert notes.count() == 1
    note = notes.get()
    assert note.recipient == "dev-1"
    assert note.business_date == DAY
    assert note.payload == {
        "required_count": 4,
        "submitted_count": 1,
        "threshold_pct": 50,
    }


def test_before_alert_hour_no_alert_even_if_below_threshold(org_dt):
    # AC-3: same shortfall as above, but BEFORE alert_hour — must stay silent.
    divisions = [make_division(org_dt) for _ in range(4)]
    set_required([d.id for d in divisions])
    set_default_recipient("dev-1")

    with clock.override(before_hour(DAY)):
        check_submission_threshold()

    assert not Notification.objects.filter(
        kind=Notification.Kind.SUBMISSION_THRESHOLD_ALERT
    ).exists()


def test_at_or_above_threshold_after_alert_hour_no_alert(org_dt):
    divisions = [make_division(org_dt) for _ in range(2)]
    set_required([d.id for d in divisions])
    set_default_recipient("dev-1")
    _submit(divisions[0], DAY)
    _submit(divisions[1], DAY)

    with clock.override(after_hour(DAY)):
        check_submission_threshold()

    assert not Notification.objects.filter(
        kind=Notification.Kind.SUBMISSION_THRESHOLD_ALERT
    ).exists()


def test_empty_required_division_ids_no_alert(org_dt):
    # AC-2: nothing required → nothing can be "behind" (no 0-of-0 alert).
    set_required([])
    set_default_recipient("dev-1")

    with clock.override(after_hour(DAY)):
        check_submission_threshold()

    assert not Notification.objects.filter(
        kind=Notification.Kind.SUBMISSION_THRESHOLD_ALERT
    ).exists()


def test_blank_default_recipient_logs_and_skips(org_dt, caplog):
    # AC-5: notify() would raise ValueError on a blank recipient — the
    # service must gate before calling it, not let the exception escape.
    divisions = [make_division(org_dt) for _ in range(2)]
    set_required([d.id for d in divisions])
    set_default_recipient("")

    with clock.override(after_hour(DAY)):
        check_submission_threshold()  # must not raise

    assert not Notification.objects.filter(
        kind=Notification.Kind.SUBMISSION_THRESHOLD_ALERT
    ).exists()
    assert "no default_notify_recipient" in caplog.text


def test_repeat_call_same_day_is_a_no_op(org_dt):
    # AC-4: idempotency comes from notify()'s own get_or_create — a second
    # call after the alert already fired must not create a second row.
    divisions = [make_division(org_dt) for _ in range(4)]
    set_required([d.id for d in divisions])
    set_default_recipient("dev-1")
    _submit(divisions[0], DAY)

    with clock.override(after_hour(DAY)):
        check_submission_threshold()
        check_submission_threshold()
        check_submission_threshold()

    assert (
        Notification.objects.filter(
            kind=Notification.Kind.SUBMISSION_THRESHOLD_ALERT
        ).count()
        == 1
    )


def test_configurable_alert_hour_and_threshold_are_honored(org_dt):
    # AC-1/AC-3 together: a non-default alert_hour/threshold_pct is read from
    # settings, not hardcoded 15:30/50.
    divisions = [make_division(org_dt) for _ in range(4)]
    set_required([d.id for d in divisions])
    set_default_recipient("dev-1")
    set_alert(hour=datetime(2000, 1, 1, 9, 0).time(), threshold_pct=90)
    _submit(divisions[0], DAY)
    _submit(divisions[1], DAY)
    _submit(divisions[2], DAY)
    # 3-of-4 = 75% < 90% configured threshold, and past the configured 09:00.

    with clock.override(datetime(DAY.year, DAY.month, DAY.day, 10, 0, tzinfo=LOCAL)):
        check_submission_threshold()

    assert Notification.objects.filter(
        kind=Notification.Kind.SUBMISSION_THRESHOLD_ALERT
    ).exists()
