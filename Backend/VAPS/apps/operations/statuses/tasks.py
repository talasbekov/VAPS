"""Story 3.12 — catch-up runner for status effect materialization (FR-41 core).

A plain callable, NOT a Celery task: the project has no Celery, no broker and no
worker/beat containers yet — those land in E12 (deploy). The module name follows
architecture.md#L522 so the future autodiscover finds it unchanged. Today's entry
point is ``manage.py catchup_status_effects``.

The runner is a consumer of ``catchup_plan`` (pure date math, story 1.3): it
holds an advisory lock for the whole run, walks the plan chronologically, and
commits one day per transaction, advancing the watermark in that same
transaction. A crash on day K therefore leaves the watermark at K-1 and the next
run resumes at K — no day is ever materialized twice.

MUST NOT import ``apps.core.models`` (ARCH-004,
test_operations_does_not_import_core_models): all ``core_watermarks`` I/O goes
through ``apps.core.watermark``.
"""

import logging
from dataclasses import dataclass, field
from datetime import date

from django.db import transaction

from apps.core.clock import Clock, catchup_plan
from apps.core.watermark import (
    advance_watermark,
    advisory_lock,
    bootstrap_watermark,
    read_watermark,
)
from apps.operations.statuses.effects import materialize_day_effects

logger = logging.getLogger(__name__)

WATERMARK_KEY = "status_effects"

# Chunk, don't hard-stop: a legitimate long outage must catch up unattended, so
# the leftovers are picked up by the next tick. An absurd watermark (an ancient
# backup, a fat-finger 1970 seed) then surfaces as a repeating WARNING instead of
# twenty thousand transactions inside a single tick.
CATCHUP_MAX_DAYS = 400


@dataclass(frozen=True)
class CatchupResult:
    """Outcome of one catch-up run.

    ``status`` is one of: ``locked`` (another runner holds the lock),
    ``bootstrapped`` (watermark created, nothing to replay), ``halted`` (the wall
    clock went backwards), ``noop`` (already up to date), ``ok`` (days replayed).
    """

    status: str
    processed: list[date] = field(default_factory=list)
    remaining: int = 0


def run_status_effects_catchup() -> CatchupResult:
    """Materialize every business day from the watermark up to today, once."""
    with advisory_lock(WATERMARK_KEY) as acquired:
        if not acquired:
            # Another runner is mid-plan. Exit silently (architecture.md#L469) —
            # queueing beat ticks behind it would just pile up duplicates.
            logger.info("catch-up skipped: another run holds the lock")
            return CatchupResult(status="locked")

        # The single wall-clock read of the whole run; below this line the
        # business date is a parameter (ARCH-DATA-022).
        today = Clock.today_local()
        watermark = read_watermark(WATERMARK_KEY)

        if watermark is None:
            # Fresh DB: there is no effect history to replay backwards. The
            # create is safe under the lock, so no first-write race.
            on = bootstrap_watermark(WATERMARK_KEY, on=today)
            logger.info("watermark bootstrapped at %s", on.isoformat())
            return CatchupResult(status="bootstrapped")

        # Called BEFORE the halt check on purpose: catchup_plan owns the
        # "clock behind watermark" ERROR alert (story 1.3 contract).
        plan = catchup_plan(watermark=watermark, today=today)

        # catchup_plan returns [] for three different reasons (today < watermark,
        # today == watermark, watermark is None), so an empty plan cannot tell a
        # halt from an ordinary no-op. Compare the dates ourselves.
        if today < watermark:
            return CatchupResult(status="halted")
        if not plan:
            return CatchupResult(status="noop")

        remaining = max(0, len(plan) - CATCHUP_MAX_DAYS)
        if remaining:
            plan = plan[:CATCHUP_MAX_DAYS]
            logger.warning(
                "catch-up plan capped at %s days; %s day(s) remaining",
                CATCHUP_MAX_DAYS,
                remaining,
            )

        processed: list[date] = []
        for day in plan:
            # One transaction per day, watermark moved inside it: the day and the
            # proof that it ran commit together or not at all.
            with transaction.atomic():
                materialize_day_effects(day)
                advance_watermark(WATERMARK_KEY, to=day)
            processed.append(day)

        return CatchupResult(status="ok", processed=processed, remaining=remaining)
