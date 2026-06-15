"""Temporal core (ARCH-DATA-022/023).

Clock is the single legitimate wall-clock read point in the project; tests
substitute time via override(). catchup_plan is pure date math: the
materialization plan = f(watermark, today), no ORM, no IO.
"""

import logging
from contextlib import contextmanager
from contextvars import ContextVar
from datetime import date, datetime, timedelta
from datetime import timezone as dt_timezone
from zoneinfo import ZoneInfo

from django.conf import settings
from django.utils import timezone

logger = logging.getLogger(__name__)

_override: ContextVar[datetime | None] = ContextVar("clock_override", default=None)


def _local_tz() -> ZoneInfo:
    return ZoneInfo(settings.VAPS_LOCAL_TIMEZONE)


class Clock:
    @staticmethod
    def now() -> datetime:
        """Aware UTC datetime; honors an active override()."""
        frozen = _override.get()
        if frozen is not None:
            return frozen
        # The ONLY legitimate wall-clock read in the whole project.
        return timezone.now()

    @classmethod
    def today_local(cls) -> date:
        """Current business date: calendar day at midnight Asia/Qyzylorda."""
        return cls.now().astimezone(_local_tz()).date()


@contextmanager
def override(value: date | datetime):
    """Freeze Clock to `value` within the context (nestable, exception-safe).

    Accepts a date (today_local() returns it; now() is that local midnight in
    UTC) or an aware datetime. Naive datetime is rejected: "which timezone?"
    is exactly the ambiguity Clock exists to eliminate.
    """
    # datetime subclasses date — check it first.
    if isinstance(value, datetime):
        if value.utcoffset() is None:
            raise TypeError("clock.override() requires an aware datetime, got naive")
        # Same instant, normalized so now() keeps its "aware UTC" contract.
        frozen = value.astimezone(dt_timezone.utc)
    elif isinstance(value, date):
        local_midnight = datetime(
            value.year, value.month, value.day, tzinfo=_local_tz()
        )
        frozen = local_midnight.astimezone(dt_timezone.utc)
    else:
        raise TypeError(
            f"clock.override() accepts date or aware datetime, got {type(value)!r}"
        )
    token = _override.set(frozen)
    try:
        yield
    finally:
        _override.reset(token)


def catchup_plan(*, watermark: date | None, today: date) -> list[date]:
    """Pure materialization plan: dates (watermark, today], chronological.

    today < watermark means the wall clock went backwards — catch-up stops
    with an alert (spike 3.13 contract). watermark=None means materialization
    was never bootstrapped (consumer's responsibility, Story 3.12) — no alert.
    """
    # datetime IS-A date: passing Clock.now() would truncate the partial day
    # and leak datetimes into the plan — reject the ambiguity loudly.
    if type(today) is not date:
        raise TypeError(f"catchup_plan() takes plain dates, got today={type(today)!r}")
    if watermark is not None and type(watermark) is not date:
        raise TypeError(
            f"catchup_plan() takes plain dates, got watermark={type(watermark)!r}"
        )
    if watermark is None:
        return []
    if today < watermark:
        logger.error(
            "clock behind watermark: catch-up halted",
            extra={"watermark": watermark.isoformat(), "today": today.isoformat()},
        )
        return []
    days = (today - watermark).days
    return [watermark + timedelta(days=offset) for offset in range(1, days + 1)]
