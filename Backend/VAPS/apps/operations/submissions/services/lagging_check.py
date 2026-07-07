"""Story 5.7b2 — catch-up detection of lagging submissions (FR-13, ARCH-DATA-022).

A scheduled catch-up job (management command + this framework-agnostic service):
from its OWN watermark, chronologically day-by-day, once a day's control hour has
passed, it takes the required divisions that have NOT submitted (``tomorrow_block
(D).laggards``, Story 5.6a), resolves WHO to notify (``NotifyRecipientSelector.
resolve_many``, Story 5.7b1: per-division reference table → global fallback),
groups the laggards by recipient and emits one idempotent ``notify()`` «одно на
день» per recipient (Story 5.7a). It survives downtime (run-on-availability, NOT
Celery — the beat wrapper is Story 12.6).

Mirrors the status-effects engine (``apps.operations.statuses.services.catch_up``):
same lock → bootstrap → halt → sanity → plan → per-day-atomic control-flow, but
with its OWN watermark key and advisory-lock key (never the status-effects ones)
and an extra control-hour gate — a day is checked only AFTER its control hour, so
the watermark never jumps past today before the deadline (else premature laggards
+ a lost day).

Isolation (ARCH-004): the wall clock, the watermark and the lock are reached only
through the ``apps.core.clock`` / ``apps.core.watermark`` / ``apps.core.locks``
gateways — never ``apps.core.models`` (submissions ``test_isolation`` guards this).
Cross-context ids stay flat (ARCH-003): ``payload`` carries division ids as strings.

Scope (5.7b2): detection + notify only. NOT the recipient reference table (5.7b1),
NOT the read-API (5.7c), NOT WS delivery (11.2), NOT Celery/beat registration
(12.1/12.6). No new migration (the watermark row is keyed/generic, notify's model
and the recipient reference table already exist).
"""

import logging
from collections import defaultdict
from dataclasses import dataclass, field
from datetime import date, timedelta
from zoneinfo import ZoneInfo

from django.conf import settings
from django.db import transaction

from apps.core import watermark as watermark_gateway
from apps.core.clock import Clock, catchup_plan
from apps.core.locks import advisory_lock
from apps.notifications.models import Notification
from apps.notifications.services import notify
from apps.operations.submissions.selectors import (
    NotifyRecipientSelector,
    SubmissionControlSettingsSelector,
)
from apps.operations.submissions.tomorrow_block import tomorrow_block

logger = logging.getLogger(__name__)

# Watermark row key for THIS job — distinct from status-effects «status_effects»
# (ARCH-DATA-022: each catch-up domain owns its own watermark).
WATERMARK_KEY = "lagging_submissions"

# Advisory-lock key for THIS job — a stable int ("VAGL" in ASCII), deliberately
# different from the status-effects 0x56415053 so the two jobs never block each
# other (a named constant, not a magic number).
LAGGING_LOCK_KEY = 0x5641474C  # b"VAGL"

# Per-run batch cap + sanity ceiling, mirror of catch_up: a huge backlog is
# processed in chunks of at most MAX_CATCHUP_DAYS (the next idempotent run
# resumes); a gap beyond SANITY_DAYS is almost certainly a clock/seed bug —
# halt + alert instead of grinding through it.
MAX_CATCHUP_DAYS = 31
SANITY_DAYS = 366


class LaggingNotifyError(RuntimeError):
    """A ``notify()`` emission failed mid-catch-up.

    Raised so the day's ``transaction.atomic()`` rolls back and the watermark
    stays on N-1 — the next (idempotent) run retries the day rather than the
    watermark silently jumping past a notice that never persisted. Mirror
    ``catch_up``: a materializer's failure propagates for the same reason.
    """


@dataclass
class LaggingCheckResult:
    """Outcome of one lagging-check pass (for the command / callers / tests)."""

    watermark_before: date | None
    watermark_after: date | None
    processed_days: list[date] = field(default_factory=list)
    notified_count: int = 0
    halted: bool = False
    halt_reason: str = ""
    skipped: bool = False  # another run held the advisory lock


def check_lagging_submissions(*, today=None) -> LaggingCheckResult:
    """Run one idempotent, concurrency-safe lagging-check pass; return the result.

    ``today`` defaults to ``Clock.today_local()`` (the only legitimate wall-clock
    read). MUST run OUTSIDE an enclosing transaction (autocommit): the per-day
    ``transaction.atomic()`` must be a real COMMIT so a notification row and the
    watermark advance for a day are durable together and an outer rollback cannot
    erase progress (mirror catch_up). The management command (and the Celery task,
    12.6) both run without an enclosing transaction — keep it that way.
    """
    real_today = today if today is not None else Clock.today_local()
    if type(real_today) is not date:
        raise TypeError(f"today must be a plain date, got {type(real_today)!r}")

    with advisory_lock(LAGGING_LOCK_KEY, blocking=False) as acquired:
        if not acquired:
            # Another run holds the lock — skip silently (no double-notify).
            logger.info("lagging-submission catch-up already running; skipping")
            return LaggingCheckResult(
                watermark_before=None, watermark_after=None, skipped=True
            )

        # Bootstrap under the lock: a missing watermark means «never checked» →
        # start from yesterday (Д6), NO retroactive backfill of history. Yesterday
        # (not today) so the first real day still gets checked after its control
        # hour. Anchored to the REAL wall clock, NOT the ``today`` param: a manual
        # ``--today <past>`` FIRST run must not bootstrap the watermark backwards
        # (the sanity ceiling would then wedge every later real run — review 2).
        before, created = watermark_gateway.get_or_bootstrap(
            WATERMARK_KEY, default_date=Clock.today_local() - timedelta(days=1)
        )
        if created:
            return LaggingCheckResult(watermark_before=None, watermark_after=before)

        # Clock went backwards (real_today, NOT check_through — the hour gate must
        # not manufacture a false «behind watermark» alert): halt, leave the
        # watermark, surface loudly.
        if real_today < before:
            logger.error(
                "clock behind watermark: lagging-check halted",
                extra={
                    "watermark": before.isoformat(),
                    "today": real_today.isoformat(),
                },
            )
            return LaggingCheckResult(
                watermark_before=before,
                watermark_after=before,
                halted=True,
                halt_reason="clock_behind_watermark",
            )

        gap = (real_today - before).days
        if gap > SANITY_DAYS:
            logger.error(
                "lagging-check gap beyond sanity ceiling: halted",
                extra={
                    "gap_days": gap,
                    "watermark": before.isoformat(),
                    "today": real_today.isoformat(),
                },
            )
            return LaggingCheckResult(
                watermark_before=before,
                watermark_after=before,
                halted=True,
                halt_reason="gap_exceeds_sanity",
            )

        # Control-hour gate (Д4/Д5): today is checkable only after its control
        # hour; before that the horizon is yesterday, so the watermark never jumps
        # onto today prematurely. tomorrow_block itself does NOT read control_hour
        # (mirror _is_late).
        control_hour = SubmissionControlSettingsSelector.control_hour()
        local_now = Clock.now().astimezone(ZoneInfo(settings.VAPS_LOCAL_TIMEZONE))
        check_through = (
            real_today
            if local_now.time() > control_hour
            else real_today - timedelta(days=1)
        )
        if check_through < before:
            # Before today's control hour with the watermark already caught up:
            # nothing new. Return a no-op WITHOUT calling catchup_plan(today <
            # watermark), which would log a false «behind watermark» error.
            return LaggingCheckResult(watermark_before=before, watermark_after=before)

        plan = catchup_plan(watermark=before, today=check_through)[:MAX_CATCHUP_DAYS]

        processed = []
        notified = 0
        for day in plan:
            # One transaction PER DAY: the notification row(s) and the watermark
            # advance commit together (reinforces «одно на день»); a failure on day
            # N rolls back only day N and leaves the watermark on N-1.
            with transaction.atomic():
                notified += _emit_lagging(day)
                watermark_gateway.advance(WATERMARK_KEY, to_date=day)
            processed.append(day)

        after = processed[-1] if processed else before
        return LaggingCheckResult(
            watermark_before=before,
            watermark_after=after,
            processed_days=processed,
            notified_count=notified,
        )


def _emit_lagging(day) -> int:
    """Notify the recipients of the divisions lagging on ``day``; return the count
    of notices actually persisted.

    Laggards come from ``tomorrow_block`` (5.6a, bulk). Recipients are resolved in
    ONE ``resolve_many`` call (5.7b1, bulk — never per-division in a loop, NFR-4),
    then laggards are grouped by recipient → one ``notify()`` per recipient. A
    laggard with no resolved recipient (no per-division record AND empty global
    fallback) is logged and skipped (Q1b: does not happen once a duty is set). A
    ``notify()`` that FAILS (returns ``None`` — an infra error swallowed by 5.7a's
    non-fatal contract) raises ``LaggingNotifyError`` so the caller's per-day atomic
    rolls back and the watermark holds on N-1 for an idempotent retry (review 1).
    """
    laggards = tomorrow_block(day).laggards
    if not laggards:
        return 0
    recipients = NotifyRecipientSelector.resolve_many(laggards)
    by_recipient = defaultdict(list)
    for division_id in laggards:
        recipient = recipients.get(division_id)
        if not recipient:
            logger.warning(
                "lagging division has no configured recipient",
                extra={"division_id": str(division_id), "business_date": str(day)},
            )
            continue
        by_recipient[recipient].append(division_id)
    notified = 0
    for recipient, division_ids in by_recipient.items():
        row = notify(
            recipient,
            Notification.Kind.SUBMISSION_LAGGING,
            day,
            payload={"laggard_division_ids": [str(x) for x in division_ids]},
        )
        if row is None:
            # notify() is non-fatal by design (5.7a): an infra failure is logged and
            # swallowed (returns None) so a notification never breaks a business op.
            # But HERE notify IS the operation, paired with the watermark advance in
            # ONE per-day atomic — a swallowed failure would let the watermark jump
            # past a day whose notice never persisted (idempotency-by-watermark →
            # lost forever), breaking this module's own «watermark holds on N-1»
            # contract. Propagate so the day rolls back and the next run retries
            # (mirror catch_up: a materializer's failure propagates for this reason).
            raise LaggingNotifyError(
                f"notify() failed for recipient={recipient!r} on {day}"
            )
        notified += 1
    return notified
