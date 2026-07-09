import ast
import logging
import threading
from datetime import date, timedelta
from io import StringIO
from pathlib import Path

import pytest
from django.core.management import call_command
from django.core.management.base import CommandError
from django.db import connection, connections
from django.test.utils import CaptureQueriesContext

from apps.core import clock
from apps.core.watermark import _lock_id, bootstrap_watermark, read_watermark
from apps.operations.statuses import effects as effects_module
from apps.operations.statuses import tasks
from apps.operations.statuses.tasks import (
    CATCHUP_MAX_DAYS,
    WATERMARK_KEY,
    run_status_effects_catchup,
)

TODAY = date(2026, 3, 10)
WAIT = 10  # seconds; generous upper bound so a dead thread fails fast, not hangs

WRITE_STATEMENTS = ("INSERT", "UPDATE", "DELETE", "TRUNCATE")


@pytest.fixture
def effects(monkeypatch):
    """Spy on the effect seam: record every business date the runner materializes."""
    calls: list[date] = []
    monkeypatch.setattr(tasks, "materialize_day_effects", calls.append)
    return calls


@pytest.fixture
def other_session():
    """A second, real database session — a rival beat tick without the threads.

    Advisory locks are re-entrant within one session, so a rival modelled on the
    test's own connection would take the lock and prove nothing. Closing the
    connection releases whatever advisory locks it still holds.
    """
    conn = connections.create_connection("default")
    try:
        yield conn
    finally:
        conn.close()


def _take_lock(conn, name: str) -> bool:
    with conn.cursor() as cursor:
        cursor.execute("SELECT pg_try_advisory_lock(%s)", [_lock_id(name)])
        return cursor.fetchone()[0]


def _write_statements(captured) -> list[str]:
    return [
        query["sql"]
        for query in captured.captured_queries
        if query["sql"].lstrip().upper().startswith(WRITE_STATEMENTS)
    ]


def test_effect_seams_are_no_ops_until_e4_and_e5():
    # AC-9: AuditLog is Epic 4, notifications are Epic 5. Until then the seams
    # exist to be called, and to return nothing.
    assert effects_module.record_catchup_audit(TODAY) is None
    assert effects_module.emit_catchup_notifications(TODAY) is None
    assert effects_module.materialize_day_effects(TODAY) is None


def test_materialize_day_effects_calls_both_seams(monkeypatch):
    # Every runner test spies on `tasks.materialize_day_effects`, so the seam's
    # own wiring is never exercised: dropping either call would stay green.
    seen: list[tuple[str, date]] = []
    monkeypatch.setattr(
        effects_module, "record_catchup_audit", lambda day: seen.append(("audit", day))
    )
    monkeypatch.setattr(
        effects_module,
        "emit_catchup_notifications",
        lambda day: seen.append(("notify", day)),
    )

    effects_module.materialize_day_effects(TODAY)

    assert seen == [("audit", TODAY), ("notify", TODAY)]


@pytest.mark.django_db
def test_effect_seams_touch_no_database():
    # AC-9: no AuditLog row, no notification, no materialization table (E5 owns
    # «версия сдачи»). Idempotency is carried by the watermark, not a dedup key.
    with CaptureQueriesContext(connection) as captured:
        effects_module.materialize_day_effects(TODAY)

    assert captured.captured_queries == []


@pytest.mark.django_db
def test_real_run_writes_nothing_but_the_watermark():
    # The real effects module, unpatched: the only end-to-end run in the suite.
    # ARCH-DATA-022 (#L298) forbids a task that mutates status state — lifecycle
    # is derived from [date_start, date_end) — so `core_watermarks` is the sole
    # table this runner may write.
    bootstrap_watermark(WATERMARK_KEY, on=TODAY - timedelta(days=2))
    with CaptureQueriesContext(connection) as captured:
        with clock.override(TODAY):
            result = run_status_effects_catchup()

    assert result.status == "ok"
    assert result.processed == [TODAY - timedelta(days=1), TODAY]

    writes = _write_statements(captured)
    assert writes, "sanity: advancing the watermark must issue an UPDATE"
    assert all("core_watermarks" in sql for sql in writes), writes


def test_runner_reads_the_wall_clock_exactly_once():
    # ARCH-DATA-022 #L300: Clock is the single wall-clock read point, and the
    # runner reads it once — below that line the business date is a parameter.
    # The AST guard in core/tests/test_isolation.py does not cover tasks.py.
    tree = ast.parse(Path(tasks.__file__).read_text(encoding="utf-8"))
    calls = [
        ast.unparse(node.func) for node in ast.walk(tree) if isinstance(node, ast.Call)
    ]

    assert calls.count("Clock.today_local") == 1
    forbidden = {"timezone.now", "datetime.now", "date.today", "now"}
    assert not set(calls) & forbidden, set(calls) & forbidden


@pytest.mark.django_db
def test_empty_table_bootstraps_at_today_and_materializes_nothing(effects):
    # AC-3: on a fresh DB there is no effect history to replay backwards.
    with clock.override(TODAY):
        result = run_status_effects_catchup()

    assert result.status == "bootstrapped"
    assert result.processed == []
    assert effects == []
    assert read_watermark(WATERMARK_KEY) == TODAY


@pytest.mark.django_db
def test_three_day_outage_is_replayed_chronologically(effects):
    # AC-4 verbatim: watermark = today-3 -> (watermark, today] ascending.
    bootstrap_watermark(WATERMARK_KEY, on=TODAY - timedelta(days=3))
    with clock.override(TODAY):
        result = run_status_effects_catchup()

    expected = [TODAY - timedelta(days=2), TODAY - timedelta(days=1), TODAY]
    assert result.status == "ok"
    assert result.processed == expected
    assert result.remaining == 0
    assert effects == expected
    assert read_watermark(WATERMARK_KEY) == TODAY


@pytest.mark.django_db
def test_failure_mid_plan_leaves_watermark_on_last_good_day_and_resumes(monkeypatch):
    # AC-4: one transaction per day. A blow-up on day K must leave the watermark
    # at K-1 — days < K are never replayed, and the next run picks up at K.
    start = TODAY - timedelta(days=3)
    bootstrap_watermark(WATERMARK_KEY, on=start)
    day_one, day_two, day_three = (start + timedelta(days=n) for n in (1, 2, 3))

    attempted: list[date] = []

    def exploding(business_date):
        attempted.append(business_date)
        if business_date == day_two:
            raise RuntimeError("effect exploded on day two")

    monkeypatch.setattr(tasks, "materialize_day_effects", exploding)
    with pytest.raises(RuntimeError, match="day two"):
        with clock.override(TODAY):
            run_status_effects_catchup()

    assert attempted == [day_one, day_two]
    assert read_watermark(WATERMARK_KEY) == day_one

    resumed: list[date] = []
    monkeypatch.setattr(tasks, "materialize_day_effects", resumed.append)
    with clock.override(TODAY):
        result = run_status_effects_catchup()

    assert resumed == [day_two, day_three]
    assert result.status == "ok"
    assert read_watermark(WATERMARK_KEY) == TODAY


@pytest.mark.django_db
def test_plan_longer_than_cap_is_chunked_and_warns(effects, caplog):
    # AC-5: a legitimate long outage catches up unattended, so the cap chunks
    # rather than hard-stops; an absurd watermark shows up as a repeat WARNING.
    start = TODAY - timedelta(days=500)
    bootstrap_watermark(WATERMARK_KEY, on=start)
    with caplog.at_level(logging.WARNING, logger="apps.operations.statuses.tasks"):
        with clock.override(TODAY):
            result = run_status_effects_catchup()

    assert result.status == "ok"
    assert CATCHUP_MAX_DAYS == 400
    assert len(result.processed) == CATCHUP_MAX_DAYS
    assert result.remaining == 100
    assert result.processed[0] == start + timedelta(days=1)
    assert result.processed[-1] == start + timedelta(days=CATCHUP_MAX_DAYS)
    assert effects == result.processed
    assert read_watermark(WATERMARK_KEY) == start + timedelta(days=CATCHUP_MAX_DAYS)

    warnings = [r for r in caplog.records if r.levelno == logging.WARNING]
    assert len(warnings) == 1
    assert "100" in warnings[0].getMessage()


@pytest.mark.django_db
def test_plan_exactly_at_the_cap_is_not_truncated_and_does_not_warn(
    effects, caplog, monkeypatch
):
    # Boundary of `remaining = max(0, len(plan) - CAP)`. At len == CAP the run is
    # complete: a WARNING here would cry wolf on every legitimate long outage,
    # and a truncation would silently drop the last day. The real 400 is pinned
    # by test_plan_longer_than_cap_is_chunked_and_warns; the arithmetic is not.
    monkeypatch.setattr(tasks, "CATCHUP_MAX_DAYS", 3)
    bootstrap_watermark(WATERMARK_KEY, on=TODAY - timedelta(days=3))

    with caplog.at_level(logging.WARNING, logger="apps.operations.statuses.tasks"):
        with clock.override(TODAY):
            result = run_status_effects_catchup()

    assert result.status == "ok"
    assert result.remaining == 0
    assert len(result.processed) == 3
    assert result.processed[-1] == TODAY
    assert read_watermark(WATERMARK_KEY) == TODAY
    assert [r for r in caplog.records if r.levelno == logging.WARNING] == []


@pytest.mark.django_db
def test_capped_plan_drains_over_successive_runs_without_replaying_a_day(
    effects, caplog, monkeypatch
):
    # AC-5 is chunking, NOT a hard stop: the leftovers are picked up unattended
    # by the next tick, and the chunk boundary must not re-materialize its day.
    monkeypatch.setattr(tasks, "CATCHUP_MAX_DAYS", 3)
    start = TODAY - timedelta(days=4)
    bootstrap_watermark(WATERMARK_KEY, on=start)

    with caplog.at_level(logging.WARNING, logger="apps.operations.statuses.tasks"):
        with clock.override(TODAY):
            first = run_status_effects_catchup()
            second = run_status_effects_catchup()

    assert first.status == "ok"
    assert first.remaining == 1
    assert first.processed == [start + timedelta(days=n) for n in (1, 2, 3)]

    assert second.status == "ok"
    assert second.remaining == 0
    assert second.processed == [TODAY]
    assert read_watermark(WATERMARK_KEY) == TODAY

    every_day = [start + timedelta(days=n) for n in (1, 2, 3, 4)]
    assert effects == every_day
    assert len(set(effects)) == len(effects), "a day was materialized twice"

    warnings = [r for r in caplog.records if r.levelno == logging.WARNING]
    assert len(warnings) == 1, "only the capped run warns; the draining one is clean"


@pytest.mark.django_db
def test_clock_behind_watermark_halts_and_alerts(effects, caplog):
    # AC-6: the wall clock went backwards (spike 3.13 contract). Nothing moves.
    future = TODAY + timedelta(days=5)
    bootstrap_watermark(WATERMARK_KEY, on=future)
    with caplog.at_level(logging.ERROR, logger="apps.core.clock"):
        with clock.override(TODAY):
            result = run_status_effects_catchup()

    assert result.status == "halted"
    assert result.processed == []
    assert effects == []
    assert read_watermark(WATERMARK_KEY) == future

    # catchup_plan owns the alert, so the runner must call it before halting.
    errors = [r for r in caplog.records if r.levelno == logging.ERROR]
    assert len(errors) == 1
    assert "clock behind watermark: catch-up halted" in errors[0].getMessage()


@pytest.mark.django_db
def test_second_sequential_run_on_the_same_day_is_a_noop(effects):
    # AC-7: idempotency is carried by the monotonic watermark, not a dedup key.
    bootstrap_watermark(WATERMARK_KEY, on=TODAY - timedelta(days=2))
    with clock.override(TODAY):
        first = run_status_effects_catchup()
        second = run_status_effects_catchup()

    assert first.status == "ok"
    assert second.status == "noop"
    assert second.processed == []
    assert effects == [TODAY - timedelta(days=1), TODAY]
    assert read_watermark(WATERMARK_KEY) == TODAY


@pytest.mark.django_db
def test_rival_session_holding_the_lock_makes_the_run_a_silent_noop(
    effects, caplog, other_session
):
    # AC-8 without threads, so the gate actually runs it: the threaded test below
    # carries the `concurrency` marker and `make gate` deselects it, which left
    # the whole `status="locked"` path unguarded on every green gate.
    watermark = TODAY - timedelta(days=1)
    bootstrap_watermark(WATERMARK_KEY, on=watermark)
    assert _take_lock(other_session, WATERMARK_KEY) is True

    with caplog.at_level(logging.INFO, logger="apps.operations.statuses.tasks"):
        with clock.override(TODAY):
            result = run_status_effects_catchup()

    assert result.status == "locked"
    assert result.processed == []
    assert effects == [], "the loser must not materialize anything"
    assert read_watermark(WATERMARK_KEY) == watermark
    assert any(
        "another run holds the lock" in record.getMessage() for record in caplog.records
    ), "a skipped tick must say so (architecture.md#L469)"


@pytest.mark.django_db
def test_advisory_lock_is_released_after_the_runner_raises(monkeypatch, other_session):
    # A leaked session lock would wedge every future beat tick at "locked". The
    # question has to be put to a *rival* session: re-taking it on our own
    # connection succeeds even when it leaked, because advisory locks are
    # re-entrant within a session.
    bootstrap_watermark(WATERMARK_KEY, on=TODAY - timedelta(days=1))

    def exploding(business_date):
        raise RuntimeError("effect exploded")

    monkeypatch.setattr(tasks, "materialize_day_effects", exploding)
    with pytest.raises(RuntimeError, match="effect exploded"):
        with clock.override(TODAY):
            run_status_effects_catchup()

    assert _take_lock(other_session, WATERMARK_KEY) is True


@pytest.mark.concurrency
@pytest.mark.django_db(transaction=True)
def test_concurrent_run_is_locked_out_and_effects_fire_once(monkeypatch):
    # AC-8: two runners, two CONNECTIONS. Advisory locks are re-entrant within a
    # session, so a single-connection test would be falsely green.
    bootstrap_watermark(WATERMARK_KEY, on=TODAY - timedelta(days=1))

    holder_inside = threading.Event()
    loser_done = threading.Event()
    calls: list[tuple[str, date]] = []
    results: dict[str, object] = {}
    unexpected: list[str] = []

    def effect(business_date):
        calls.append((threading.current_thread().name, business_date))
        if threading.current_thread().name == "holder":
            # Pin the advisory lock open across the whole of the loser's attempt.
            holder_inside.set()
            if not loser_done.wait(timeout=WAIT):
                raise RuntimeError("loser never finished its attempt")

    monkeypatch.setattr(tasks, "materialize_day_effects", effect)

    def holder():
        try:
            # clock.override() is a ContextVar — it does not cross the thread
            # boundary (deferred-work.md#L20), so each thread sets its own.
            with clock.override(TODAY):
                results["holder"] = run_status_effects_catchup()
        except Exception as exc:  # noqa: BLE001 — record, don't lose the cause
            unexpected.append(f"holder: {type(exc).__name__}: {exc}")
        finally:
            holder_inside.set()  # never leave the loser waiting
            connection.close()

    def loser():
        try:
            if not holder_inside.wait(timeout=WAIT):
                raise RuntimeError("holder never entered its lock")
            with clock.override(TODAY):
                results["loser"] = run_status_effects_catchup()
        except Exception as exc:  # noqa: BLE001 — record, don't lose the cause
            unexpected.append(f"loser: {type(exc).__name__}: {exc}")
        finally:
            loser_done.set()  # never leave the holder waiting
            connection.close()

    threads = [
        threading.Thread(target=holder, name="holder"),
        threading.Thread(target=loser, name="loser"),
    ]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join(timeout=WAIT * 3)
        assert not thread.is_alive(), "thread hung past the deadline"

    assert unexpected == [], f"unexpected thread errors: {unexpected}"
    assert results["holder"].status == "ok"
    assert results["loser"].status == "locked"
    assert results["loser"].processed == []
    assert calls == [("holder", TODAY)]
    assert read_watermark(WATERMARK_KEY) == TODAY


@pytest.mark.django_db
def test_management_command_runs_the_catchup_and_reports_its_outcome(effects):
    # AC-9: the executable entry point (no Celery in this project yet).
    bootstrap_watermark(WATERMARK_KEY, on=TODAY - timedelta(days=1))
    out = StringIO()
    with clock.override(TODAY):
        call_command("catchup_status_effects", stdout=out)

    printed = out.getvalue()
    assert "status=ok" in printed
    assert "days=1" in printed
    assert effects == [TODAY]


@pytest.mark.django_db
def test_management_command_exits_nonzero_when_halted(effects):
    # AC-6 at the entry point: a backwards clock must not exit 0 into a cron log.
    bootstrap_watermark(WATERMARK_KEY, on=TODAY + timedelta(days=5))
    with pytest.raises(CommandError, match="halted"):
        with clock.override(TODAY):
            call_command("catchup_status_effects")

    assert effects == []


@pytest.mark.django_db
def test_management_command_reports_the_days_left_after_a_capped_run(
    effects, monkeypatch
):
    # AC-5 at the entry point: an operator watching a cron log needs the backlog
    # size, otherwise a capped run is indistinguishable from a complete one.
    monkeypatch.setattr(tasks, "CATCHUP_MAX_DAYS", 1)
    bootstrap_watermark(WATERMARK_KEY, on=TODAY - timedelta(days=3))
    out = StringIO()
    with clock.override(TODAY):
        call_command("catchup_status_effects", stdout=out)

    printed = out.getvalue()
    assert "status=ok" in printed
    assert "days=1" in printed
    assert "remaining=2" in printed
