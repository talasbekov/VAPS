"""Executable evidence for spike 3.13 — clock without NTP (core layer).

`spikes/3.13-clock-no-ntp/FINDINGS.md` catalogues eight clock-desync modes and
`RUNBOOK-clock.md` tells the contour admin what to do about each. Several of
those claims shipped as `code-traced` — read in the source, never executed, or
checked once by hand in a throwaway shell. This module makes them executable,
so a refactor that quietly invalidates the runbook fails the gate instead of
the pilot.

CHARACTERIZATION, NOT APPROVAL: nothing here asserts the behaviour is right,
only what it is, with the numbers the runbook leans on. No guard is introduced
(spike 3.13, AC-11) — the forward-bound guard is a finding, deferred to its own
story.

The runner-level modes live in
`apps/operations/statuses/tests/test_catchup_clock_drift.py`.
"""

import logging
from datetime import date, datetime, timedelta
from datetime import timezone as dt_timezone
from zoneinfo import ZoneInfo

import pytest
from django.utils import timezone

from apps.core import clock
from apps.core.clock import Clock, catchup_plan
from apps.core.models import Watermark
from apps.core.watermark import advance_watermark, bootstrap_watermark

CANONICAL_TZ = "Asia/Qyzylorda"
LOCAL_TZ = ZoneInfo(CANONICAL_TZ)
KEY = "status_effects"
DAY = date(2026, 3, 10)


def test_backward_halt_alert_is_structured_for_forensics(caplog):
    """RUNBOOK §4 row 4: the alert IS the incident record — pin its shape.

    The contour has no external alert channel (prd.md#L174), so «алерт» is one
    ERROR line and nothing else. `test_clock.py` asserts the message substring;
    the logger name and the `extra=` payload — the only machine-readable part,
    and the only thing that says *how far* the clock slipped — were verified
    once by hand and then left unguarded.
    """
    watermark, today = date(2026, 6, 10), date(2026, 6, 5)

    with caplog.at_level(logging.ERROR, logger="apps.core.clock"):
        assert catchup_plan(watermark=watermark, today=today) == []

    errors = [record for record in caplog.records if record.levelno == logging.ERROR]
    assert len(errors) == 1
    alert = errors[0]
    assert alert.name == "apps.core.clock"
    assert alert.getMessage() == "clock behind watermark: catch-up halted"
    assert alert.watermark == "2026-06-10"
    assert alert.today == "2026-06-05"


def test_drift_inside_the_day_never_moves_the_business_date():
    """FINDINGS mode (в): silent drift is harmless until it crosses midnight.

    The domain counts calendar days, not durations, so hours of accumulated
    error change nothing for as long as the local date holds.
    """
    for hour in (0, 6, 12, 18, 23):
        with clock.override(datetime(2026, 3, 10, hour, 0, tzinfo=LOCAL_TZ)):
            assert Clock.today_local() == DAY


def test_twenty_minutes_of_drift_before_midnight_flips_the_business_date():
    """FINDINGS mode (г) / RUNBOOK §1: minutes are enough, near the boundary.

    This is the whole reason the runbook's alarm threshold is closeness to
    midnight rather than the size of Δ. A drifting contour clock does not need
    a dramatic jump to materialize tomorrow on today's data.
    """
    before = datetime(2026, 3, 10, 23, 50, tzinfo=LOCAL_TZ)
    after = before + timedelta(minutes=20)

    with clock.override(before):
        assert Clock.today_local() == DAY
    with clock.override(after):
        assert Clock.today_local() == DAY + timedelta(days=1)


def test_the_same_twenty_minutes_at_noon_leaves_the_business_date_alone():
    """The negative half of the threshold rule: Δ on its own proves nothing."""
    noon = datetime(2026, 3, 10, 12, 0, tzinfo=LOCAL_TZ)

    with clock.override(noon):
        assert Clock.today_local() == DAY
    with clock.override(noon + timedelta(minutes=20)):
        assert Clock.today_local() == DAY


def test_clock_resolves_the_business_date_through_vaps_local_timezone(settings):
    """FINDINGS mode (е) — the canary's blind spot, made executable.

    `test_tzdata_canary.py` asserts `settings.TIME_ZONE`, but `Clock` reads
    `settings.VAPS_LOCAL_TIMEZONE` [clock.py#L24]. Today both say
    Asia/Qyzylorda. Below only the latter moves: the business date slips a full
    day while the canary's assertion still holds.
    """
    instant = datetime(2026, 3, 10, 19, 30, tzinfo=dt_timezone.utc)

    settings.VAPS_LOCAL_TIMEZONE = "UTC"
    with clock.override(instant):
        assert Clock.today_local() == DAY
    assert settings.TIME_ZONE == CANONICAL_TZ, "the canary never noticed"

    settings.VAPS_LOCAL_TIMEZONE = CANONICAL_TZ
    with clock.override(instant):
        # 19:30 UTC is already 00:30 of the next day at +05:00.
        assert Clock.today_local() == DAY + timedelta(days=1)


def test_vaps_local_timezone_is_pinned_to_the_canonical_zone(settings):
    """Closes the blind spot above: pin the setting `Clock` actually reads.

    A typo in `VAPS_LOCAL_TIMEZONE` alone would leave `test_tzdata_canary.py`
    green while every `business_date` in the system moved.
    """
    assert settings.VAPS_LOCAL_TIMEZONE == CANONICAL_TZ
    assert settings.TIME_ZONE == settings.VAPS_LOCAL_TIMEZONE
    assert LOCAL_TZ.utcoffset(datetime(2026, 3, 10, 12, 0)) == timedelta(hours=5)


@pytest.mark.django_db
def test_watermark_updated_at_is_written_by_the_os_clock_not_by_the_clock_service():
    """RUNBOOK §2: do not trust `updated_at` when reconstructing an incident.

    `updated_at = auto_now=True` [core/models.py#L433] makes Django call
    `django.utils.timezone.now()` on save — straight past `Clock`. The AST guard
    `test_no_wall_clock_reads_in_domain_layers` cannot see it, because
    `auto_now` is a keyword argument and not a call. So on a skewed contour the
    column is skewed along with the OS, and the business date is the only
    trustworthy column in the row.

    Characterization of today's behaviour, not an endorsement of it
    (deferred-work.md, spike 3.13).
    """
    bootstrap_watermark(KEY, on=DAY)

    with clock.override(date(1999, 1, 1)):
        advance_watermark(KEY, to=DAY + timedelta(days=1))

    row = Watermark.objects.get(key=KEY)
    assert row.last_materialized_date == DAY + timedelta(days=1)
    assert row.updated_at.year != 1999, "auto_now ignored the frozen Clock"
    assert abs(row.updated_at - timezone.now()) < timedelta(minutes=5)
