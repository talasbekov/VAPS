"""Story 3.12 — catch-up materialization engine (FR-41 core, ARCH-DATA-022).

Derived-first: the acting status is COMPUTED from intervals + business_date
(story 1.7). This engine only materializes the SIDE EFFECTS of transitions
(audit E4, notifications 5.7, secondment auto-return) idempotently after any
downtime. catch-up = pure function of the watermark (``apps.core.clock.
catchup_plan``): chronological, day-by-day, each day in its OWN transaction,
under a session-level advisory lock so a concurrent / double run cannot
double-apply.

Today the effect registry ``EFFECT_MATERIALIZERS`` is EMPTY (seam): the engine
advances the watermark and fires nothing. E4 (audit), 5.7 (notifications) and
auto-return register their per-day materializers here later. Each materializer
MUST be idempotent (``unique(entity, business_date, …) + upsert``) and MUST NOT
raise an HTTP ``DomainError`` — this is a background run, not a request.

Beat-ready, but framework-agnostic: callable as a service and via the
``materialize_status_effects`` management command. The Celery ``@shared_task``
wrapper, the Celery app and the beat schedule live in Story 12.1/12.6 — Celery
is NOT imported and NOT added as a dependency here.
"""

import logging
from dataclasses import dataclass, field
from datetime import date

from django.db import transaction

from apps.core import watermark as watermark_gateway
from apps.core.clock import Clock, catchup_plan
from apps.core.locks import advisory_lock

logger = logging.getLogger(__name__)

# Watermark row key for this engine (ARCH-DATA-022 «status_effects»).
WATERMARK_KEY = "status_effects"

# Fixed advisory-lock key — mutual exclusion of THIS task only. Arbitrary but
# stable int ("VAPS" in ASCII); a named constant, not a magic number.
STATUS_EFFECTS_LOCK_KEY = 0x56415053  # b"VAPS"

# Per-run batch cap: a huge backlog (watermark far behind, e.g. a bad seed) is
# processed in chunks of at most MAX_CATCHUP_DAYS so one run cannot grind
# thousands of days; the watermark advances incrementally and the next run
# resumes (the engine is idempotent). A gap beyond CATCHUP_SANITY_DAYS is almost
# certainly a clock/seed bug — halt + alert instead of materializing it.
# (Closes the 1.3 review deferral «catchup_plan неограничен».)
MAX_CATCHUP_DAYS = 31
CATCHUP_SANITY_DAYS = 366

# Registry of per-day effect materializers. EMPTY today (seam): E4 audit, 5.7
# notifications and secondment auto-return append here. Contract per entry:
#   mat(*, business_date: date) -> None   — idempotent, raises no DomainError.
EFFECT_MATERIALIZERS = ()


@dataclass
class CatchUpResult:
    """Outcome of one catch-up pass (for the command / callers / tests)."""

    watermark_before: date | None
    watermark_after: date | None
    processed_days: list[date] = field(default_factory=list)
    halted: bool = False
    halt_reason: str = ""
    skipped: bool = False  # another run held the advisory lock


def _materialize_day(*, business_date, materializers):
    """Run every registered effect materializer for one business date."""
    for mat in materializers:
        mat(business_date=business_date)


def materialize_status_effects(*, today=None, materializers=None):
    """Run one idempotent, concurrency-safe catch-up pass; return CatchUpResult.

    ``today`` defaults to ``Clock.today_local()`` (the only legitimate wall-clock
    read; in a real beat run ``clock.override`` does NOT apply — it is a
    ContextVar that does not cross into the worker, ARCH-DATA-022). ``today`` is
    a plain ``date`` and is passed to materializers as ``business_date``.
    ``materializers`` defaults to the (empty) ``EFFECT_MATERIALIZERS`` registry;
    tests inject a fake recorder.

    MUST run OUTSIDE an enclosing transaction (autocommit): the per-day
    ``transaction.atomic()`` must be a real COMMIT for the day-by-day
    durability/resumability of AC-1. Called inside an open transaction
    (``ATOMIC_REQUESTS``, an outer ``atomic()``) each day becomes a SAVEPOINT
    and an outer rollback erases all progress. The mgmt command and a Celery
    task (12.1) both run without an enclosing transaction — keep it that way.
    """
    if today is None:
        today = Clock.today_local()
    if type(today) is not date:
        raise TypeError(f"today must be a plain date, got {type(today)!r}")
    if materializers is None:
        materializers = EFFECT_MATERIALIZERS

    with advisory_lock(STATUS_EFFECTS_LOCK_KEY, blocking=False) as acquired:
        if not acquired:
            # Another run holds the lock — skip silently (no double-apply, AC-2).
            logger.info("status-effects catch-up already running; skipping")
            return CatchUpResult(
                watermark_before=None, watermark_after=None, skipped=True
            )

        # Bootstrap under the lock (snuffs the first-run unique-key race): a
        # missing watermark means «never materialized» → start from today, NO
        # retroactive backfill (effects begin at go-live, AC-5).
        before, created = watermark_gateway.get_or_bootstrap(
            WATERMARK_KEY, default_date=today
        )
        if created:
            return CatchUpResult(watermark_before=None, watermark_after=today)

        # Halt detection MUST be explicit: catchup_plan() returns [] for BOTH
        # today==watermark (normal idempotent no-op, AC-3) AND today<watermark
        # (clock went back, AC-4). Only this comparison tells them apart — an
        # empty plan alone would silently no-op a clock-backwards run.
        if today < before:
            logger.error(
                "clock behind watermark: catch-up halted",
                extra={"watermark": before.isoformat(), "today": today.isoformat()},
            )
            return CatchUpResult(
                watermark_before=before,
                watermark_after=before,
                halted=True,
                halt_reason="clock_behind_watermark",
            )

        gap = (today - before).days
        if gap > CATCHUP_SANITY_DAYS:
            logger.error(
                "catch-up gap beyond sanity ceiling: halted",
                extra={
                    "gap_days": gap,
                    "watermark": before.isoformat(),
                    "today": today.isoformat(),
                },
            )
            return CatchUpResult(
                watermark_before=before,
                watermark_after=before,
                halted=True,
                halt_reason="gap_exceeds_sanity",
            )

        # Batch cap: process at most MAX_CATCHUP_DAYS this run; the remainder is
        # picked up by the next (idempotent) run.
        plan = catchup_plan(watermark=before, today=today)[:MAX_CATCHUP_DAYS]

        processed = []
        for day in plan:
            # One transaction PER DAY (AC-1): a failure on day N rolls back only
            # day N and leaves the watermark on day N-1. The materializer error
            # propagates (the run stops on that day); the beat runtime retries.
            with transaction.atomic():
                _materialize_day(business_date=day, materializers=materializers)
                watermark_gateway.advance(WATERMARK_KEY, to_date=day)
            processed.append(day)

        after = processed[-1] if processed else before
        return CatchUpResult(
            watermark_before=before, watermark_after=after, processed_days=processed
        )
