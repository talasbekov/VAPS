"""Executable evidence for spike 3.13 — clock without NTP (runner layer).

Companion to `apps/core/tests/test_clock_drift_characterization.py`. Here the
catch-up runner meets a lying clock. `spikes/3.13-clock-no-ntp/FINDINGS.md`
describes modes (б), (г), (д) and (з) in prose, and the load-bearing arithmetic
of the forward jump — the cap chunks the plan, it does not stop it — shipped
`code-traced`: the number nobody had run.

CHARACTERIZATION, NOT APPROVAL. No guard is introduced (spike 3.13, AC-11):
these tests pin the unguarded behaviour so that the future forward-bound-guard
story has a red/green anchor to invert.

`test_catchup_materialization.py` stays exactly as story 3.12 and AC-6 left it,
with its single characterization test. Everything here is the QA pass on top.
"""

import logging
import math
from datetime import date, datetime, timedelta
from zoneinfo import ZoneInfo

import pytest

from apps.core import clock
from apps.core.watermark import bootstrap_watermark, read_watermark
from apps.operations.statuses import tasks
from apps.operations.statuses.tasks import WATERMARK_KEY, run_status_effects_catchup

LOCAL_TZ = ZoneInfo("Asia/Qyzylorda")
TODAY = date(2026, 3, 10)
TOMORROW = TODAY + timedelta(days=1)

# A drain that never converges must fail the test, not hang the gate.
RUNAWAY_RUNS = 10


@pytest.fixture
def effects(monkeypatch):
    """Spy on the effect seam: every business date the runner materializes."""
    calls: list[date] = []
    monkeypatch.setattr(tasks, "materialize_day_effects", calls.append)
    return calls


@pytest.mark.django_db
def test_sub_daily_backward_shift_inside_one_day_is_a_noop_not_a_halt(effects, caplog):
    """FINDINGS mode (з): the halt compares dates, not instants.

    Nudging the clock back 80 minutes without crossing midnight leaves
    `today == watermark`, so the run is an ordinary no-op and no alert fires.
    This is what makes RUNBOOK §2's «малым шагом с пересверкой» safe advice:
    a correction that stays inside the local day cannot poison anything.
    """
    bootstrap_watermark(WATERMARK_KEY, on=TODAY)
    late_evening = datetime(2026, 3, 10, 23, 50, tzinfo=LOCAL_TZ)
    nudged_back = late_evening - timedelta(minutes=80)  # 22:30, same local day

    with caplog.at_level(logging.ERROR, logger="apps.core.clock"):
        with clock.override(late_evening):
            first = run_status_effects_catchup()
        with clock.override(nudged_back):
            second = run_status_effects_catchup()

    assert first.status == "noop"
    assert second.status == "noop", "a backwards instant is not a backwards date"
    assert effects == []
    assert read_watermark(WATERMARK_KEY) == TODAY
    assert [r for r in caplog.records if r.levelno >= logging.ERROR] == []


@pytest.mark.django_db
def test_drift_across_midnight_materializes_tomorrow_and_poisons_the_watermark(effects):
    """FINDINGS mode (г): twenty minutes of drift, one day of damage.

    At 00:10 local the runner believes the business day is the 11th, while the
    real day is still the 10th. It materializes the 11th on the 10th's data and
    drags the watermark with it. `CATCHUP_MAX_DAYS` never enters the picture:
    the plan is one day long.
    """
    bootstrap_watermark(WATERMARK_KEY, on=TODAY)
    just_past_midnight = datetime(2026, 3, 11, 0, 10, tzinfo=LOCAL_TZ)

    with clock.override(just_past_midnight):
        result = run_status_effects_catchup()

    assert result.status == "ok", "no forward-bound guard exists (spike 3.13)"
    assert result.processed == [TOMORROW]
    assert effects == [TOMORROW], "an effect fired for a day that has not happened"
    assert read_watermark(WATERMARK_KEY) == TOMORROW


@pytest.mark.django_db
def test_poisoned_watermark_halts_until_real_time_catches_up_then_noops(
    effects, caplog
):
    """FINDINGS mode (д): the halt is the protection, and it is also the cost.

    Once the watermark sits a day ahead, correcting the clock back to the real
    day gives `today < watermark` — the runner halts and stays halted. It does
    not recover by re-running: it recovers when real time reaches the poisoned
    day, and then only as a silent no-op, because the watermark is monotonic
    [watermark.py#L93-L97] and that day is already marked materialized. The
    "future" day computed on stale data is never replayed.
    """
    bootstrap_watermark(WATERMARK_KEY, on=TOMORROW)  # poisoned one day ahead

    with caplog.at_level(logging.ERROR, logger="apps.core.clock"):
        with clock.override(TODAY):
            halted = run_status_effects_catchup()
        with clock.override(TOMORROW):  # real time reaches the poisoned day
            recovered = run_status_effects_catchup()

    assert halted.status == "halted"
    assert recovered.status == "noop", "the day is spent, not replayed"
    assert effects == []
    assert read_watermark(WATERMARK_KEY) == TOMORROW

    errors = [r for r in caplog.records if r.levelno == logging.ERROR]
    assert len(errors) == 1, "only the halted run alerts; recovery is silent"
    assert errors[0].getMessage() == "clock behind watermark: catch-up halted"


@pytest.mark.django_db
def test_forward_jump_beyond_the_cap_drains_over_ceil_n_over_cap_runs(
    effects, caplog, monkeypatch
):
    """FINDINGS blast radius, item 3 — the main finding of this branch, in numbers.

    `CATCHUP_MAX_DAYS` is a chunk, not a hard stop (story 3.12, decision C), so
    a clock that jumped `N` days forward does not merely lose one chunk of
    future: successive runs keep going until every one of the `N` unlived days
    is materialized, in exactly `⌈N / CAP⌉` runs, with zero halts and zero
    errors. That is the price of the decision, and the reason the runbook
    exists.

    The real 400 is pinned by `test_plan_longer_than_cap_is_chunked_and_warns`;
    here the cap is shrunk so the arithmetic runs in milliseconds. The run count
    is not dictated to the runner — it is counted and then checked against the
    formula the findings document promises.
    """
    cap, jump = 2, 5
    monkeypatch.setattr(tasks, "CATCHUP_MAX_DAYS", cap)
    bootstrap_watermark(WATERMARK_KEY, on=TODAY)
    jumped = TODAY + timedelta(days=jump)

    runs = []
    with caplog.at_level(logging.WARNING, logger="apps.operations.statuses.tasks"):
        with clock.override(jumped):
            while True:
                result = run_status_effects_catchup()
                if result.status == "noop":
                    break
                runs.append(result)
                assert len(runs) <= RUNAWAY_RUNS, "catch-up never drained"

    assert len(runs) == math.ceil(jump / cap)
    assert [r.status for r in runs] == ["ok", "ok", "ok"], "chunked, never halted"
    assert [len(r.processed) for r in runs] == [2, 2, 1]
    assert [r.remaining for r in runs] == [3, 1, 0]

    unlived_days = [TODAY + timedelta(days=n) for n in range(1, jump + 1)]
    assert effects == unlived_days
    assert len(set(effects)) == jump, "a future day was materialized twice"
    assert read_watermark(WATERMARK_KEY) == jumped

    warnings = [r for r in caplog.records if r.levelno == logging.WARNING]
    assert len(warnings) == sum(1 for r in runs if r.remaining), "capped runs warn"
    assert [r for r in caplog.records if r.levelno >= logging.ERROR] == []
