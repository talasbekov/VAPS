"""Story 6.9 — parallel-run seed: nightly donor-vs-VAPS diff catch-up job.

Promotes the one-shot 1.8 ``strength_report --diff-baseline`` prototype into a
stateful background MODE: from its OWN watermark, chronologically day-by-day, it
computes the VAPS расход (``StrengthReportService.compute``), classifies each
discrepancy against a frozen donor baseline via the ready 1.8 classifier
(``apps.migration_legacy.donor_diff``), and PERSISTS the result — per-cell
``ParallelRunDiff`` rows + a per-day ``ParallelRunDay`` summary — plus a
consecutive-green-day count.

Mirrors the lagging-submission catch-up engine (Story 5.7b2) and the
status-effects engine: same lock → bootstrap → clock-behind → sanity → plan →
per-day-atomic control flow, with its OWN watermark key and advisory-lock key.
Beat-ready and Celery-free (Story 12.6 wraps it in a ``@shared_task``).

NON-BLOCKING by design (AC-5, unlike the gating 1.8 command): unclassified /
data-loss discrepancies are recorded as durable tickets (``is_blocking=True``
rows) and a per-day crash is recorded as a ``status="error"`` day, but neither
raises out of the loop nor fails a merge — parallel-run is a background mode,
not a CI gate. The exit criterion / owner-signed model-diff registry / green
dashboard are Story 7.8.

Isolation: the clock, watermark and advisory lock are reached only through the
``apps.core.clock`` / ``apps.core.watermark`` / ``apps.core.locks`` gateways.
``parallel_run`` is donor-parity infra (like ``migration_legacy``), so the
direct ``Division`` read for the code→id map is deliberate — no core selector
for it exists (mirror ``strength_report`` command).
"""

import json
import logging
from dataclasses import dataclass, field
from datetime import date, timedelta
from pathlib import Path

from django.db import transaction

from apps.core import watermark as watermark_gateway
from apps.core.clock import Clock, catchup_plan
from apps.core.locks import advisory_lock
from apps.core.models import Division
from apps.migration_legacy.donor_diff import (
    GATE_BLOCKING_CATEGORIES,
    diff_day,
    load_baseline,
)
from apps.operations.statuses.services import StrengthReportService
from apps.parallel_run.models import ParallelRunDay, ParallelRunDiff

logger = logging.getLogger(__name__)

# Watermark row key for THIS job — distinct from lagging «lagging_submissions»
# and status-effects «status_effects» (ARCH-DATA-022: each catch-up domain owns
# its own watermark).
WATERMARK_KEY = "parallel_run"

# Advisory-lock key for THIS job — a stable int ("VPRD" in ASCII), deliberately
# different from lagging 0x5641474C ("VAGL") and status-effects 0x56415053
# ("VAPS") so the jobs never block each other (named constant, not magic).
PARALLEL_RUN_LOCK_KEY = 0x56505244  # b"VPRD"

# Per-run batch cap + sanity ceiling (mirror of the lagging/status-effects
# engines): a huge backlog is processed in chunks; a gap beyond SANITY_DAYS is
# almost certainly a clock/seed bug — halt instead of grinding through it.
MAX_CATCHUP_DAYS = 31
SANITY_DAYS = 366

# Default frozen baseline = the SYNTHETIC donor sample (Д4): a real production
# donor freeze / ``make freeze-donor`` is Story 7.0/7.8 (prod access pending,
# A8 / spike 1.11). The path is overridable via ``--baseline`` / ``baseline_path``.
# ``parents``: .../apps/parallel_run/services/parallel_run_diff.py → parents[2] = apps.
DEFAULT_BASELINE_PATH = (
    Path(__file__).resolve().parents[2]
    / "migration_legacy"
    / "tests"
    / "fixtures"
    / "donor_baseline_sample.json"
)


@dataclass
class ParallelRunResult:
    """Outcome of one parallel-run diff pass (for the command / callers / tests)."""

    watermark_before: date | None
    watermark_after: date | None
    processed_days: list = field(default_factory=list)
    green_streak: int = 0
    skipped: bool = False  # another run held the advisory lock
    halted: bool = False
    halt_reason: str = ""


def run_parallel_run_diff(*, today=None, baseline_path=None) -> ParallelRunResult:
    """Run one idempotent, concurrency-safe, NON-BLOCKING parallel-run diff pass.

    ``today`` defaults to ``Clock.today_local()`` (the only legitimate wall-clock
    read). SHOULD run OUTSIDE an enclosing transaction (autocommit): the per-day
    ``transaction.atomic()`` must be a real COMMIT so a day's diff rows and its
    watermark advance are durable together and an outer rollback cannot erase
    progress (mirror the lagging engine). The command and the Celery task (12.6)
    both run without an enclosing transaction — keep it that way.
    """
    real_today = today if today is not None else Clock.today_local()
    if type(real_today) is not date:
        raise TypeError(f"today must be a plain date, got {type(real_today)!r}")

    baseline = load_baseline(_read_baseline(baseline_path))
    code_by_division_id = dict(Division.objects.values_list("id", "code"))

    with advisory_lock(PARALLEL_RUN_LOCK_KEY, blocking=False) as acquired:
        if not acquired:
            # Another run holds the lock — skip silently (no double work).
            logger.info("parallel-run diff already running; skipping")
            return ParallelRunResult(
                watermark_before=None, watermark_after=None, skipped=True
            )

        # Bootstrap under the lock: a missing watermark means «never run» → start
        # from yesterday (NO retroactive backfill of history). Anchored to the
        # REAL wall clock, NOT the ``today`` param, so a manual ``--today <past>``
        # first run cannot seed the watermark backwards (mirror the lagging fix).
        before, created = watermark_gateway.get_or_bootstrap(
            WATERMARK_KEY, default_date=Clock.today_local() - timedelta(days=1)
        )
        if created:
            return ParallelRunResult(
                watermark_before=None,
                watermark_after=before,
                green_streak=_green_streak(),
            )

        # Clock went backwards: halt, leave the watermark, surface loudly. Halt is
        # non-blocking here (the command reports it, exit 0) — parallel-run is a
        # background mode, not a CI gate.
        if real_today < before:
            logger.error(
                "clock behind watermark: parallel-run halted",
                extra={
                    "watermark": before.isoformat(),
                    "today": real_today.isoformat(),
                },
            )
            return ParallelRunResult(
                watermark_before=before,
                watermark_after=before,
                halted=True,
                halt_reason="clock_behind_watermark",
                green_streak=_green_streak(),
            )

        gap = (real_today - before).days
        if gap > SANITY_DAYS:
            logger.error(
                "parallel-run gap beyond sanity ceiling: halted",
                extra={
                    "gap_days": gap,
                    "watermark": before.isoformat(),
                    "today": real_today.isoformat(),
                },
            )
            return ParallelRunResult(
                watermark_before=before,
                watermark_after=before,
                halted=True,
                halt_reason="gap_exceeds_sanity",
                green_streak=_green_streak(),
            )

        plan = catchup_plan(watermark=before, today=real_today)[:MAX_CATCHUP_DAYS]

        processed = []
        for day in plan:
            try:
                # One transaction PER DAY: the diff rows and the watermark advance
                # commit together; a crash rolls back only this day's atomic.
                with transaction.atomic():
                    _run_one(day, baseline, code_by_division_id)
                    watermark_gateway.advance(WATERMARK_KEY, to_date=day)
            except Exception:
                # NON-BLOCKING (AC-5): a per-day crash is a durable ticket
                # (status="error"), NOT a merge blocker and NOT a reason to drop
                # the remaining dates. Advance the watermark so the run makes
                # steady progress (robust retry policy is Story 7.8).
                logger.exception(
                    "parallel-run diff failed on %s (recorded, non-blocking)", day
                )
                with transaction.atomic():
                    _record_error_day(day)
                    watermark_gateway.advance(WATERMARK_KEY, to_date=day)
            processed.append(day)

        after = processed[-1] if processed else before
        return ParallelRunResult(
            watermark_before=before,
            watermark_after=after,
            processed_days=processed,
            green_streak=_green_streak(),
        )


def _run_one(day, baseline, code_by_division_id):
    """Diff + persist ONE business date. Idempotent (replaces the day's rows)."""
    baseline_for_day = baseline.get(day)
    if baseline_for_day is None:
        # No frozen donor data for this date — record the fact so the watermark
        # advances and the date is not replayed forever (E4), without a false diff.
        ParallelRunDiff.objects.filter(run_date=day).delete()
        ParallelRunDay.objects.update_or_create(
            run_date=day,
            defaults={
                "status": ParallelRunDay.STATUS_NO_BASELINE,
                "blocking_count": 0,
                "total_diffs": 0,
            },
        )
        return

    vaps = StrengthReportService.compute(business_date=day)
    diff = diff_day(vaps, baseline_for_day, code_by_division_id)

    # Idempotent upsert: drop the day's prior rows, then insert the current cells.
    ParallelRunDiff.objects.filter(run_date=day).delete()
    rows = [
        ParallelRunDiff(
            run_date=day,
            division_code=cell.division_code,
            column_code=cell.column,
            donor_value=cell.donor,
            vaps_value=cell.vaps,
            delta=cell.delta,
            category=cell.category,
            is_blocking=cell.category in GATE_BLOCKING_CATEGORIES,
            pending_signature=cell.category.startswith("model/"),
        )
        for cell in diff.cells
    ]
    ParallelRunDiff.objects.bulk_create(rows)

    blocking_count = sum(1 for row in rows if row.is_blocking)
    ParallelRunDay.objects.update_or_create(
        run_date=day,
        defaults={
            "status": ParallelRunDay.STATUS_OK,
            "blocking_count": blocking_count,
            "total_diffs": len(rows),
        },
    )


def _record_error_day(day):
    """Record a crashed date as a durable ticket (status="error"), no diff rows."""
    ParallelRunDiff.objects.filter(run_date=day).delete()
    ParallelRunDay.objects.update_or_create(
        run_date=day,
        defaults={
            "status": ParallelRunDay.STATUS_ERROR,
            "blocking_count": 0,
            "total_diffs": 0,
        },
    )


def _green_streak() -> int:
    """Consecutive most-recent business dates that are clean (status="ok",
    zero blocking cells). The first non-green day (blocking, no_baseline or
    error) ends the streak — the numeric basis for the 7.8 exit criterion.
    """
    streak = 0
    for day in ParallelRunDay.objects.order_by("-run_date").iterator():
        if day.status == ParallelRunDay.STATUS_OK and day.blocking_count == 0:
            streak += 1
        else:
            break
    return streak


def _read_baseline(baseline_path):
    path = Path(baseline_path) if baseline_path else DEFAULT_BASELINE_PATH
    with open(path, encoding="utf-8") as handle:
        return json.load(handle)
