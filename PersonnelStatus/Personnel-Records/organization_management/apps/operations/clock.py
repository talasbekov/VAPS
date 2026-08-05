"""Временнóе ядро раздела ОМ (порт apps/core/clock.py из Backend/VAPS).

Clock — единственная легитимная точка чтения настенных часов в разделе;
тесты подменяют время через override(). catchup_plan — чистая датная
математика: план материализации = f(watermark, today), без ORM и IO.

Отличие от источника: локальная зона берётся из OPS_LOCAL_TIMEZONE с
фолбэком на TIME_ZONE проекта (в источнике — обязательный
VAPS_LOCAL_TIMEZONE).
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
    return ZoneInfo(getattr(settings, "OPS_LOCAL_TIMEZONE", settings.TIME_ZONE))


class Clock:
    @staticmethod
    def now() -> datetime:
        """Aware-UTC datetime; учитывает активный override()."""
        frozen = _override.get()
        if frozen is not None:
            return frozen
        # Единственная легитимная точка чтения настенных часов раздела.
        return timezone.now()

    @classmethod
    def local_now(cls) -> datetime:
        """Тот же момент в локальной зоне раздела.

        Нужен там, где сравнивается ВРЕМЯ СУТОК (контрольный час), а не дата:
        `now()` отдаёт UTC, и сравнение его времени с местным дедлайном
        расходилось бы ровно на смещение зоны.
        """
        return cls.now().astimezone(_local_tz())

    @classmethod
    def today_local(cls) -> date:
        """Текущая бизнес-дата: календарный день в локальной зоне."""
        return cls.local_now().date()


@contextmanager
def override(value: date | datetime):
    """Заморозить Clock на `value` внутри контекста (вложимо, exception-safe).

    Принимает date (today_local() вернёт её; now() — её локальную полночь в
    UTC) или aware-datetime. Наивный datetime отвергается: «в какой зоне?» —
    ровно та неоднозначность, ради устранения которой Clock существует.
    """
    # datetime — подкласс date, проверяем его первым.
    if isinstance(value, datetime):
        if value.utcoffset() is None:
            raise TypeError("clock.override() requires an aware datetime, got naive")
        # Тот же момент, нормализованный: now() сохраняет контракт «aware UTC».
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
    """Чистый план материализации: даты (watermark, today], хронологически.

    today < watermark значит, что часы пошли назад — догон останавливается
    с алертом. watermark=None — материализация не бутстрапилась (забота
    потребителя) — без алерта.
    """
    # datetime IS-A date: Clock.now() срезал бы неполный день и протащил
    # datetime в план — отвергаем неоднозначность громко.
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
