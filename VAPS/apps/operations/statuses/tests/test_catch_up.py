"""Story 3.12 — catch-up materialization engine (FR-41 core, ARCH-DATA-022).

Tests the ENGINE mechanics through an injected fake materializer (the real
effect registry is empty until E4/5.7 plug in): chronological per-day
materialization, separate per-day transactions, session-level advisory-lock
mutual exclusion, idempotent re-run, halt on clock-backwards / oversized gap,
watermark bootstrap, and the batch cap that closes the 1.3 review deferral.
"""

from datetime import date, timedelta

import psycopg
import pytest
from django.db import connection

from apps.core import clock
from apps.core.models import Watermark
from apps.operations.statuses.services import catch_up
from apps.operations.statuses.services.catch_up import materialize_status_effects

pytestmark = pytest.mark.django_db


def _recorder():
    """A fake per-day effect materializer that records its business_date arg."""
    calls = []

    def rec(*, business_date):
        calls.append(business_date)

    return rec, calls


def _set_watermark(d):
    return Watermark.objects.create(
        key=catch_up.WATERMARK_KEY, last_materialized_date=d
    )


# -- AC-1 / AC-7: chronological per-day, watermark advances, business_date param


def test_catch_up_processes_gap_chronologically():
    _set_watermark(date(2026, 6, 1))
    rec, calls = _recorder()
    result = materialize_status_effects(today=date(2026, 6, 4), materializers=[rec])
    # exactly the gap (watermark, today], ascending — proves business_date is the
    # day param, not Clock (AC-7).
    assert calls == [date(2026, 6, 2), date(2026, 6, 3), date(2026, 6, 4)]
    assert result.processed_days == calls
    assert result.watermark_after == date(2026, 6, 4)
    assert Watermark.objects.get(
        key=catch_up.WATERMARK_KEY
    ).last_materialized_date == date(2026, 6, 4)


# -- AC-3: idempotent no-op when today == watermark ---------------------------


def test_catch_up_same_day_is_idempotent_noop():
    _set_watermark(date(2026, 6, 4))
    rec, calls = _recorder()
    result = materialize_status_effects(today=date(2026, 6, 4), materializers=[rec])
    assert calls == []
    assert result.processed_days == []
    assert result.halted is False
    assert Watermark.objects.get(
        key=catch_up.WATERMARK_KEY
    ).last_materialized_date == date(2026, 6, 4)


# -- AC-4: today < watermark → halt + alert, no write, no watermark rollback ---


def test_catch_up_halts_when_clock_behind_watermark(caplog):
    _set_watermark(date(2026, 6, 10))
    rec, calls = _recorder()
    import logging

    with caplog.at_level(logging.ERROR):
        result = materialize_status_effects(today=date(2026, 6, 5), materializers=[rec])
    assert result.halted is True
    assert result.halt_reason == "clock_behind_watermark"
    assert calls == []
    # watermark NOT rolled back / advanced
    assert Watermark.objects.get(
        key=catch_up.WATERMARK_KEY
    ).last_materialized_date == date(2026, 6, 10)
    assert any("behind watermark" in r.message for r in caplog.records)


def test_catch_up_empty_plan_does_not_mask_halt():
    # Regression guard: catchup_plan() returns [] for BOTH today==watermark and
    # today<watermark. The engine must distinguish them by the explicit
    # comparison, not by the empty plan — else clock-backwards silently no-ops.
    _set_watermark(date(2026, 6, 10))
    result = materialize_status_effects(today=date(2026, 6, 9))
    assert result.halted is True  # NOT a silent no-op


# -- AC-5: first run bootstraps watermark = today, no retroactive backfill -----


def test_catch_up_bootstraps_watermark_without_backfill():
    assert not Watermark.objects.filter(key=catch_up.WATERMARK_KEY).exists()
    rec, calls = _recorder()
    result = materialize_status_effects(today=date(2026, 6, 20), materializers=[rec])
    assert calls == []  # nothing materialized retroactively
    assert result.processed_days == []
    wm = Watermark.objects.get(key=catch_up.WATERMARK_KEY)
    assert wm.last_materialized_date == date(2026, 6, 20)


# -- AC-6: batch cap on large gap + sanity-ceiling halt ------------------------


def test_catch_up_caps_large_gap_to_one_batch():
    start = date(2026, 1, 1)
    _set_watermark(start)
    today = start + timedelta(days=catch_up.MAX_CATCHUP_DAYS + 10)  # gap > cap
    rec, calls = _recorder()
    result = materialize_status_effects(today=today, materializers=[rec])
    # exactly MAX_CATCHUP_DAYS processed this run; watermark advanced
    # incrementally; remainder is left for the next (idempotent) run.
    assert len(calls) == catch_up.MAX_CATCHUP_DAYS
    assert calls[0] == start + timedelta(days=1)
    expected_after = start + timedelta(days=catch_up.MAX_CATCHUP_DAYS)
    assert result.watermark_after == expected_after
    assert (
        Watermark.objects.get(key=catch_up.WATERMARK_KEY).last_materialized_date
        == expected_after
    )


def test_catch_up_halts_on_gap_beyond_sanity():
    start = date(2024, 1, 1)
    _set_watermark(start)
    today = start + timedelta(days=catch_up.CATCHUP_SANITY_DAYS + 5)
    rec, calls = _recorder()
    result = materialize_status_effects(today=today, materializers=[rec])
    assert result.halted is True
    assert result.halt_reason == "gap_exceeds_sanity"
    assert calls == []
    assert (
        Watermark.objects.get(key=catch_up.WATERMARK_KEY).last_materialized_date
        == start
    )  # untouched


# -- AC-1 atomicity: materializer fails on day 2 → day 1 committed, day 3 untouched


def test_catch_up_partial_failure_keeps_watermark_at_last_success():
    start = date(2026, 6, 1)
    _set_watermark(start)
    boom_day = date(2026, 6, 3)
    seen = []

    def rec(*, business_date):
        seen.append(business_date)
        if business_date == boom_day:
            raise RuntimeError("materializer boom")

    with pytest.raises(RuntimeError):
        materialize_status_effects(today=date(2026, 6, 4), materializers=[rec])
    # day 1 (Jun 2) committed in its own txn; day 2 (Jun 3) rolled back; day 3
    # (Jun 4) never reached.
    assert seen == [date(2026, 6, 2), date(2026, 6, 3)]
    assert Watermark.objects.get(
        key=catch_up.WATERMARK_KEY
    ).last_materialized_date == date(2026, 6, 2)


# -- AC-2: advisory-lock mutual exclusion across sessions ---------------------


@pytest.mark.concurrency
def test_advisory_lock_is_cross_session_mutual_exclusion():
    from apps.core.locks import advisory_lock

    key = catch_up.STATUS_EFFECTS_LOCK_KEY
    conn2 = psycopg.connect(**connection.get_connection_params())
    conn2.autocommit = True
    try:
        with conn2.cursor() as c:
            c.execute("SELECT pg_advisory_lock(%s)", (key,))
        # another session holds the lock → non-blocking acquire must fail
        with advisory_lock(key, blocking=False) as acquired:
            assert acquired is False
    finally:
        with conn2.cursor() as c:
            c.execute("SELECT pg_advisory_unlock(%s)", (key,))
        conn2.close()


@pytest.mark.concurrency
def test_catch_up_skips_when_another_run_holds_lock():
    _set_watermark(date(2026, 6, 1))
    rec, calls = _recorder()
    key = catch_up.STATUS_EFFECTS_LOCK_KEY
    conn2 = psycopg.connect(**connection.get_connection_params())
    conn2.autocommit = True
    try:
        with conn2.cursor() as c:
            c.execute("SELECT pg_advisory_lock(%s)", (key,))
        result = materialize_status_effects(today=date(2026, 6, 4), materializers=[rec])
        assert result.skipped is True
        assert calls == []  # no double materialization
        # watermark untouched by the skipped run
        assert Watermark.objects.get(
            key=catch_up.WATERMARK_KEY
        ).last_materialized_date == date(2026, 6, 1)
    finally:
        with conn2.cursor() as c:
            c.execute("SELECT pg_advisory_unlock(%s)", (key,))
        conn2.close()


# -- AC-8: default materializers come from the (empty) registry; Clock default -


def test_catch_up_uses_empty_registry_by_default():
    # No materializers arg → engine falls back to EFFECT_MATERIALIZERS (empty
    # today): a gap advances the watermark and fires zero effects.
    assert catch_up.EFFECT_MATERIALIZERS == ()
    _set_watermark(date(2026, 6, 1))
    result = materialize_status_effects(today=date(2026, 6, 3))
    assert result.processed_days == [date(2026, 6, 2), date(2026, 6, 3)]
    assert result.watermark_after == date(2026, 6, 3)


def test_catch_up_today_defaults_to_clock():
    _set_watermark(date(2026, 6, 1))
    rec, calls = _recorder()
    with clock.override(date(2026, 6, 3)):
        result = materialize_status_effects(materializers=[rec])
    assert calls == [date(2026, 6, 2), date(2026, 6, 3)]
    assert result.watermark_after == date(2026, 6, 3)


# -- AC-8: management command entrypoint (beat-ready, no Celery) ---------------


def test_command_runs_and_advances_watermark():
    from io import StringIO

    from django.core.management import call_command

    _set_watermark(date(2026, 6, 1))
    out = StringIO()
    call_command("materialize_status_effects", "--today", "2026-06-03", stdout=out)
    assert "catch-up ok" in out.getvalue()
    assert Watermark.objects.get(
        key=catch_up.WATERMARK_KEY
    ).last_materialized_date == date(2026, 6, 3)


def test_command_halt_raises_commanderror():
    from django.core.management import call_command
    from django.core.management.base import CommandError

    _set_watermark(date(2026, 6, 10))
    with pytest.raises(CommandError):
        call_command("materialize_status_effects", "--today", "2026-06-05")
    # watermark untouched by the halted run
    assert Watermark.objects.get(
        key=catch_up.WATERMARK_KEY
    ).last_materialized_date == date(2026, 6, 10)


# -- review patches: --today input guards (clean CommandError, not traceback) --


def test_command_rejects_malformed_today():
    from django.core.management import call_command
    from django.core.management.base import CommandError

    with pytest.raises(CommandError):
        call_command("materialize_status_effects", "--today", "not-a-date")


def test_command_rejects_future_today():
    # A future --today would poison the watermark forward of real time → every
    # later real run halts clock_behind_watermark. The command must reject it.
    from django.core.management import call_command
    from django.core.management.base import CommandError

    with clock.override(date(2026, 6, 26)):
        with pytest.raises(CommandError):
            call_command("materialize_status_effects", "--today", "2026-12-31")
    # guard fires before the engine → no watermark row created
    assert not Watermark.objects.filter(key=catch_up.WATERMARK_KEY).exists()
