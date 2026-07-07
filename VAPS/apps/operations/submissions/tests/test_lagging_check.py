"""Tests for the lagging-submission catch-up job (Story 5.7b2).

Exercises the SERVICE mechanics (watermark bootstrap without backfill, control-hour
gate, chronological catch-up over downtime, halt on clock-backwards / oversized
gap, batch cap) and the DOMAIN behaviour (laggards from tomorrow_block → recipient
resolution via resolve_many → grouped idempotent notify «одно на день»), plus the
beat-ready management command. Mirrors statuses/tests/test_catch_up.py.
"""

import itertools
import logging
from datetime import date, datetime, timedelta
from io import StringIO
from zoneinfo import ZoneInfo

import psycopg
import pytest
from django.conf import settings
from django.core.management import call_command
from django.core.management.base import CommandError
from django.db import connection

from apps.core import clock
from apps.core.models import Division, DivisionType, Organization, Watermark
from apps.notifications.models import Notification
from apps.operations.submissions.models import (
    DivisionNotifyRecipient,
    SubmissionControlSettings,
)
from apps.operations.submissions.services import submit_day
from apps.operations.submissions.services.lagging_check import (
    LAGGING_LOCK_KEY,
    MAX_CATCHUP_DAYS,
    WATERMARK_KEY,
    LaggingCheckResult,
    LaggingNotifyError,
    check_lagging_submissions,
)

pytestmark = pytest.mark.django_db

LOCAL = ZoneInfo(settings.VAPS_LOCAL_TIMEZONE)
DAY = date(2026, 6, 5)
_code = itertools.count(1)


# --- fixtures / helpers (mirror test_tomorrow_block) --------------------------


@pytest.fixture
def org_dt():
    org = Organization.objects.create(name="Орг", code="ORG-LC")
    dt = DivisionType.objects.get_or_create(
        code="department", defaults={"name": "department"}
    )[0]
    return org, dt


def make_division(org_dt):
    org, dt = org_dt
    c = f"LC-{next(_code)}"
    return Division.objects.create(organization=org, type_code=dt, name=c, code=c)


def set_required(division_ids):
    s = SubmissionControlSettings.objects.get_or_create(singleton_key=1)[0]
    s.required_division_ids = list(division_ids)
    s.save(update_fields=["required_division_ids"])


def set_default_recipient(recipient):
    s = SubmissionControlSettings.objects.get_or_create(singleton_key=1)[0]
    s.default_notify_recipient = recipient
    s.save(update_fields=["default_notify_recipient"])


def set_recipient(division_id, recipient):
    DivisionNotifyRecipient.objects.create(division_id=division_id, recipient=recipient)


def _submit(division, business_date):
    with clock.override(business_date):
        return submit_day(
            division_id=division.id, business_date=business_date, actor="op"
        )


def set_watermark(d):
    return Watermark.objects.create(key=WATERMARK_KEY, last_materialized_date=d)


def after_hour(d, hour=18):
    """Aware local datetime AFTER the default control hour (17:00)."""
    return datetime(d.year, d.month, d.day, hour, 0, tzinfo=LOCAL)


def before_hour(d, hour=8):
    """Aware local datetime BEFORE the default control hour (17:00)."""
    return datetime(d.year, d.month, d.day, hour, 0, tzinfo=LOCAL)


# --- AC-4/AC-5: laggard → notify resolved recipient with laggard-ids payload --


def test_laggard_notifies_resolved_recipient_with_payload(org_dt):
    a = make_division(org_dt)
    set_required([a.id])
    set_recipient(a.id, "boss")
    set_watermark(DAY - timedelta(days=1))
    with clock.override(after_hour(DAY)):
        result = check_lagging_submissions()
    note = Notification.objects.get(
        kind=Notification.Kind.SUBMISSION_LAGGING, business_date=DAY
    )
    assert note.recipient == "boss"
    assert note.payload == {"laggard_division_ids": [str(a.id)]}
    assert result.notified_count == 1
    assert Watermark.objects.get(key=WATERMARK_KEY).last_materialized_date == DAY


# --- AC-6: idempotency «одно на день» — two runs same day → one record --------


def test_two_runs_same_day_produce_one_notification(org_dt):
    a = make_division(org_dt)
    set_required([a.id])
    set_recipient(a.id, "boss")
    set_watermark(DAY - timedelta(days=1))
    with clock.override(after_hour(DAY)):
        check_lagging_submissions()
        check_lagging_submissions()
    assert (
        Notification.objects.filter(
            business_date=DAY, kind=Notification.Kind.SUBMISSION_LAGGING
        ).count()
        == 1
    )


# --- AC-4: all required submitted → no laggards → no notification -------------


def test_no_notification_when_all_required_submitted(org_dt):
    a = make_division(org_dt)
    set_required([a.id])
    set_recipient(a.id, "boss")
    _submit(a, DAY)
    set_watermark(DAY - timedelta(days=1))
    with clock.override(after_hour(DAY)):
        result = check_lagging_submissions()
    assert Notification.objects.count() == 0
    assert result.notified_count == 0
    assert Watermark.objects.get(key=WATERMARK_KEY).last_materialized_date == DAY


# --- AC-3: control-hour gate --------------------------------------------------


def test_before_control_hour_day_not_checked_and_watermark_holds(org_dt):
    a = make_division(org_dt)
    set_required([a.id])
    set_recipient(a.id, "boss")
    set_watermark(DAY - timedelta(days=1))
    with clock.override(before_hour(DAY)):  # 08:00 local < 17:00 → today not due
        result = check_lagging_submissions()
    assert Notification.objects.count() == 0
    assert result.processed_days == []
    # watermark must NOT advance onto today before its control hour (else the day
    # is lost) and must NOT falsely halt.
    assert result.halted is False
    assert Watermark.objects.get(
        key=WATERMARK_KEY
    ).last_materialized_date == DAY - timedelta(days=1)


def test_after_control_hour_day_is_checked(org_dt):
    a = make_division(org_dt)
    set_required([a.id])
    set_recipient(a.id, "boss")
    set_watermark(DAY - timedelta(days=1))
    with clock.override(after_hour(DAY)):
        result = check_lagging_submissions()
    assert result.processed_days == [DAY]
    assert Notification.objects.filter(business_date=DAY).count() == 1


# --- AC-2: catch-up over downtime — chronological, watermark = last day -------


def test_catch_up_processes_missed_days_chronologically(org_dt):
    a = make_division(org_dt)
    set_required([a.id])
    set_recipient(a.id, "boss")
    start = DAY - timedelta(days=3)
    set_watermark(start)
    with clock.override(after_hour(DAY)):
        result = check_lagging_submissions()
    assert result.processed_days == [start + timedelta(days=i) for i in range(1, 4)]
    assert Watermark.objects.get(key=WATERMARK_KEY).last_materialized_date == DAY
    # one notice per missed day (each is its own business_date)
    assert (
        Notification.objects.filter(kind=Notification.Kind.SUBMISSION_LAGGING).count()
        == 3
    )


# --- AC-2/AC-6: first run bootstraps watermark = yesterday, no backfill -------


def test_first_run_bootstraps_watermark_without_backfill(org_dt):
    a = make_division(org_dt)
    set_required([a.id])
    set_recipient(a.id, "boss")
    assert not Watermark.objects.filter(key=WATERMARK_KEY).exists()
    with clock.override(after_hour(DAY)):
        result = check_lagging_submissions()
    assert Notification.objects.count() == 0  # nothing checked retroactively
    assert result.processed_days == []
    wm = Watermark.objects.get(key=WATERMARK_KEY)
    assert wm.last_materialized_date == DAY - timedelta(days=1)


# --- AC-7: clock behind watermark → halt + ERROR, watermark untouched ---------


def test_halts_when_clock_behind_watermark(org_dt, caplog):
    ahead = DAY + timedelta(days=5)
    set_watermark(ahead)
    with clock.override(after_hour(DAY)):
        with caplog.at_level(logging.ERROR):
            result = check_lagging_submissions()
    assert result.halted is True
    assert result.halt_reason == "clock_behind_watermark"
    assert Watermark.objects.get(key=WATERMARK_KEY).last_materialized_date == ahead
    assert any("behind watermark" in r.message for r in caplog.records)


def test_halts_on_gap_beyond_sanity(org_dt):
    start = DAY - timedelta(days=400)  # gap 400 > SANITY_DAYS (366)
    set_watermark(start)
    with clock.override(after_hour(DAY)):
        result = check_lagging_submissions()
    assert result.halted is True
    assert result.halt_reason == "gap_exceeds_sanity"
    assert Watermark.objects.get(key=WATERMARK_KEY).last_materialized_date == start


def test_large_gap_capped_to_one_batch(org_dt):
    a = make_division(org_dt)
    set_required([a.id])
    set_default_recipient("duty")
    start = DAY - timedelta(days=50)  # 50 > MAX_CATCHUP_DAYS (31), < SANITY (366)
    set_watermark(start)
    with clock.override(after_hour(DAY)):
        result = check_lagging_submissions()
    assert len(result.processed_days) == MAX_CATCHUP_DAYS
    assert result.watermark_after == start + timedelta(days=MAX_CATCHUP_DAYS)


# --- AC-5: recipient resolution (specific → fallback → warn+skip) -------------


def test_specific_recipient_wins_and_unmapped_falls_back(org_dt):
    a = make_division(org_dt)
    b = make_division(org_dt)
    set_required([a.id, b.id])
    set_recipient(a.id, "own_a")
    set_default_recipient("duty")
    set_watermark(DAY - timedelta(days=1))
    with clock.override(after_hour(DAY)):
        check_lagging_submissions()
    assert Notification.objects.get(recipient="own_a", business_date=DAY).payload == {
        "laggard_division_ids": [str(a.id)]
    }
    assert Notification.objects.get(recipient="duty", business_date=DAY).payload == {
        "laggard_division_ids": [str(b.id)]
    }


def test_orphan_without_recipient_is_warned_and_skipped(org_dt, caplog):
    a = make_division(org_dt)
    set_required([a.id])
    set_default_recipient("")  # no specific record AND empty fallback
    set_watermark(DAY - timedelta(days=1))
    with clock.override(after_hour(DAY)):
        with caplog.at_level(logging.WARNING):
            result = check_lagging_submissions()
    assert Notification.objects.count() == 0  # nobody to notify, but no crash
    assert result.notified_count == 0
    assert any("no configured recipient" in r.message for r in caplog.records)
    # the day is still processed — the watermark advances past it
    assert Watermark.objects.get(key=WATERMARK_KEY).last_materialized_date == DAY


# --- AC-5: grouping — one recipient for 2 laggards → single notification ------


def test_grouping_one_recipient_two_divisions_single_notification(org_dt):
    a = make_division(org_dt)
    b = make_division(org_dt)
    set_required([a.id, b.id])
    set_default_recipient("duty")  # both resolve to the same duty recipient
    set_watermark(DAY - timedelta(days=1))
    with clock.override(after_hour(DAY)):
        result = check_lagging_submissions()
    notes = Notification.objects.filter(business_date=DAY)
    assert notes.count() == 1
    note = notes.get()
    assert note.recipient == "duty"
    assert set(note.payload["laggard_division_ids"]) == {str(a.id), str(b.id)}
    assert result.notified_count == 1


# --- AC-2: advisory-lock mutual exclusion → skip, no double-notify ------------


@pytest.mark.concurrency
def test_skips_when_another_run_holds_lock(org_dt):
    a = make_division(org_dt)
    set_required([a.id])
    set_recipient(a.id, "boss")
    set_watermark(DAY - timedelta(days=1))
    conn2 = psycopg.connect(**connection.get_connection_params())
    conn2.autocommit = True
    try:
        with conn2.cursor() as c:
            c.execute("SELECT pg_advisory_lock(%s)", (LAGGING_LOCK_KEY,))
        with clock.override(after_hour(DAY)):
            result = check_lagging_submissions()
        assert result.skipped is True
        assert Notification.objects.count() == 0  # no double-notify
        assert Watermark.objects.get(
            key=WATERMARK_KEY
        ).last_materialized_date == DAY - timedelta(days=1)
    finally:
        with conn2.cursor() as c:
            c.execute("SELECT pg_advisory_unlock(%s)", (LAGGING_LOCK_KEY,))
        conn2.close()


# --- AC-1/AC-7: management command entrypoint (beat-ready, no Celery) ---------


def test_command_runs_and_advances_watermark(org_dt):
    a = make_division(org_dt)
    set_required([a.id])
    set_recipient(a.id, "boss")
    set_watermark(DAY - timedelta(days=1))
    out = StringIO()
    with clock.override(after_hour(DAY)):
        call_command("check_lagging_submissions", stdout=out)
    assert "lagging-check ok" in out.getvalue()
    assert Watermark.objects.get(key=WATERMARK_KEY).last_materialized_date == DAY


def test_command_halt_raises_commanderror(org_dt):
    ahead = DAY + timedelta(days=5)
    set_watermark(ahead)
    with clock.override(after_hour(DAY)):
        with pytest.raises(CommandError):
            call_command("check_lagging_submissions")
    assert Watermark.objects.get(key=WATERMARK_KEY).last_materialized_date == ahead


def test_command_rejects_malformed_today():
    with pytest.raises(CommandError):
        call_command("check_lagging_submissions", "--today", "not-a-date")


def test_command_rejects_future_today(org_dt):
    with clock.override(after_hour(DAY)):
        with pytest.raises(CommandError):
            call_command("check_lagging_submissions", "--today", "2099-12-31")
    # guard fires before the engine → no watermark row created
    assert not Watermark.objects.filter(key=WATERMARK_KEY).exists()


# --- result type sanity ------------------------------------------------------


def test_result_is_lagging_check_result(org_dt):
    set_watermark(DAY - timedelta(days=1))
    with clock.override(after_hour(DAY)):
        result = check_lagging_submissions()
    assert isinstance(result, LaggingCheckResult)


# --- review ①: notify() failure holds the watermark on N-1 (no lost notice) --

NOTIFY_PATH = "apps.operations.submissions.services.lagging_check.notify"


def test_notify_failure_raises_and_holds_watermark_on_n_minus_1(org_dt, monkeypatch):
    """A swallowed ``notify()`` infra failure (returns None) must NOT let the
    watermark advance past a day whose notice never persisted: the day's atomic
    rolls back, ``LaggingNotifyError`` propagates, the watermark holds on N-1, and
    the next (idempotent) run retries. Mirror ``catch_up`` failure-propagation."""
    a = make_division(org_dt)
    set_required([a.id])
    set_recipient(a.id, "boss")
    set_watermark(DAY - timedelta(days=1))
    # 5.7a non-fatal contract: an infra failure is logged + swallowed → None.
    monkeypatch.setattr(NOTIFY_PATH, lambda *a, **k: None)
    with clock.override(after_hour(DAY)):
        with pytest.raises(LaggingNotifyError):
            check_lagging_submissions()
    # watermark did NOT advance onto the failed day; nothing phantom-persisted.
    assert Watermark.objects.get(
        key=WATERMARK_KEY
    ).last_materialized_date == DAY - timedelta(days=1)
    assert Notification.objects.count() == 0


def test_notify_failure_mid_catchup_keeps_prior_committed_days(org_dt, monkeypatch):
    """Per-day atomics: a notify() failure on day N rolls back ONLY day N (and
    aborts the rest), leaving the days already committed before it — and their
    watermark advance — intact."""
    from apps.notifications.services import notify as real_notify

    a = make_division(org_dt)
    set_required([a.id])
    set_recipient(a.id, "boss")
    start = DAY - timedelta(days=3)
    fail_day = DAY - timedelta(
        days=1
    )  # plan: DAY-2 (ok), DAY-1 (fail), DAY (unreached)
    set_watermark(start)

    def flaky_notify(recipient, kind, business_date, payload=None):
        if business_date == fail_day:
            return None  # swallowed infra failure only on this day
        return real_notify(recipient, kind, business_date, payload=payload)

    monkeypatch.setattr(NOTIFY_PATH, flaky_notify)
    with clock.override(after_hour(DAY)):
        with pytest.raises(LaggingNotifyError):
            check_lagging_submissions()
    # DAY-2 committed in its own atomic; the failing day + everything after held.
    assert Watermark.objects.get(
        key=WATERMARK_KEY
    ).last_materialized_date == DAY - timedelta(days=2)
    assert (
        Notification.objects.filter(business_date=DAY - timedelta(days=2)).count() == 1
    )
    assert Notification.objects.filter(business_date=fail_day).count() == 0
    assert Notification.objects.filter(business_date=DAY).count() == 0
