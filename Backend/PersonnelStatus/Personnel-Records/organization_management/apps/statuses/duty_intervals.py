"""Exact exits annotate a daily personnel placement; unknown hours stay unknown."""
import re
from datetime import date, datetime, time, timedelta, timezone
from zoneinfo import ZoneInfo

from django.core.exceptions import ValidationError

TIME_ZONE = "Asia/Almaty"
ASTANA = ZoneInfo(TIME_ZONE)
MAX_INTERVALS = 256
_STAMP = re.compile(r"[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(?:\.[0-9]{1,6})?(?:Z|[+-][0-9]{2}:[0-9]{2})", re.ASCII)


def invalid(message):
    raise ValidationError({"duty_assignment": message})


def _instant(value):
    if not isinstance(value, str) or not _STAMP.fullmatch(value):
        invalid("Для выхода укажите полные дату и время с часовым поясом.")
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00")).astimezone(timezone.utc)
    except (ValueError, OverflowError):
        invalid("Время выхода содержит несуществующую дату или неверные часы.")
    if parsed.microsecond % 1000:
        invalid("Точность времени выхода не должна превышать миллисекунды.")
    return parsed


def _bounds(start_date, end_date):
    lower = datetime.combine(start_date, time.min, ASTANA).astimezone(timezone.utc)
    upper = (datetime.combine(end_date + timedelta(days=1), time.min, ASTANA)
             if end_date < date.max else datetime.max.replace(tzinfo=ASTANA))
    return lower, upper.astimezone(timezone.utc)


def _stamp(value):
    return value.astimezone(ASTANA).isoformat()


def normalize_schedule(raw, start_date, end_date, *, previous=None):
    """Old clients may omit hours; an explicit list replaces the entire schedule."""
    if "intervals" not in raw:
        if not isinstance(previous, dict) or "intervals" not in previous:
            return {}
        raw = previous
    intervals = raw["intervals"]
    if not isinstance(intervals, list) or len(intervals) > MAX_INTERVALS:
        invalid(f"Выходы должны быть списком, не более {MAX_INTERVALS} интервалов.")
    if raw.get("time_zone", TIME_ZONE) != TIME_ZONE:
        invalid("Часы выходов задаются по времени Астаны (Asia/Almaty).")
    lower, upper = _bounds(start_date, end_date)
    parsed = []
    for index, item in enumerate(intervals, start=1):
        if not isinstance(item, dict):
            invalid(f"Выход {index}: укажите начало и окончание.")
        start, end = _instant(item.get("start_at")), _instant(item.get("end_at"))
        if start >= end:
            invalid(f"Выход {index}: окончание должно быть позже начала. Для ночного выхода укажите следующую дату.")
        if start < lower or end > upper:
            invalid(f"Выход {index} находится вне периода статуса. Исправьте даты статуса или время выхода.")
        parsed.append((start, end))
    parsed.sort()
    if any(current[0] < prior[1] for prior, current in zip(parsed, parsed[1:])):
        invalid("Выходы одного сотрудника пересекаются по времени. Исправьте пересечение.")
    return {"time_zone": TIME_ZONE, "intervals": [
        {"start_at": _stamp(start), "end_at": _stamp(end)} for start, end in parsed]}


def placement_for_roster(placement, start_date, end_date):
    """Early termination limits read coverage without destroying the saved plan."""
    if "intervals" not in placement:
        return placement
    lower, upper = _bounds(start_date, end_date)
    intervals = []
    for item in placement["intervals"]:
        start, end = max(_instant(item["start_at"]), lower), min(_instant(item["end_at"]), upper)
        if start < end:
            intervals.append({"start_at": _stamp(start), "end_at": _stamp(end)})
    return {**placement, "intervals": intervals}


def scheduled_on_date(placement, day):
    """Daily headcounts include an exact placement only if an exit touches that day."""
    if "intervals" not in placement:
        return True
    lower, upper = _bounds(day, day)
    return any(_instant(item["start_at"]) < upper and _instant(item["end_at"]) > lower
               for item in placement["intervals"])
