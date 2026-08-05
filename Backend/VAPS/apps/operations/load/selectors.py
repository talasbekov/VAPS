"""Story 19.1 (FR-32): нагрузка сотрудника план/факт с разбивкой по
календарным дням — единый источник для агрегатного перегрузка-детектора
(19.2), справочника коэффициентов (19.3), календарей (19.4/19.5) и
карточки сотрудника (19.6). Ничего не материализуется — обе функции
вычисляют сумму на лету из уже существующих таблиц (`DutyShift`,
`PlacementAssignment`+`SecurityEvent`, `PlacementAssignmentActual`).

`_split_hours_by_local_day()` — своя чистая функция нарезки интервала,
НЕ переиспользует `apps.operations.events.services._split_day_night_hours`
(18.4): та режет по границе 22:00/06:00 местного времени (день/ночь
смена), эта режет по местной ПОЛУНОЧИ (календарный день) — разные
границы для разных целей, а ведущее подчёркивание чужого модуля — тот же
приватный-импорт анти-паттерн, что отмечен в 18.4's Dev Notes.
"""

import datetime
from decimal import Decimal
from zoneinfo import ZoneInfo

from django.conf import settings

from apps.operations.duties.models import DutyShift
from apps.operations.events.models import (
    PlacementAssignment,
    PlacementAssignmentActual,
    SecurityEvent,
)


def _split_hours_by_local_day(start_at, end_at):
    """Чистая функция: делит `[start_at, end_at)` (aware datetime, любая
    tz) на часы по КАЖДОМУ пересечённому календарному дню в местном
    времени (`settings.VAPS_LOCAL_TIMEZONE`). Возвращает
    `Dict[datetime.date, Decimal]` (НЕ округлённый — округление до сотых
    применяется один раз, после слияния ВСЕХ источников за период, а не
    здесь: раздельное округление каждого куска перед суммированием
    (review-находка, тот же класс проблемы, что 18.4's day/night-сумма)
    может разойтись с округлённой суммой полной длительности на сотые.

    Вырожденный/инвертированный интервал (`end_at <= start_at`) — ОДНА
    плохая строка (`DutyShift`/`SecurityEvent`, ни одна из них не несёт
    `start < end` DB CHECK, в отличие от `PlacementAssignmentActual`) не
    должна ронять весь агрегат по сотруднику — трактуется как 0 часов
    (review-находка, Blind Hunter + Edge Case Hunter независимо)."""
    if end_at <= start_at:
        return {}

    tz = ZoneInfo(settings.VAPS_LOCAL_TIMEZONE)
    current = start_at.astimezone(tz)
    end_local = end_at.astimezone(tz)

    result = {}
    while current < end_local:
        day_start = current.replace(hour=0, minute=0, second=0, microsecond=0)
        next_midnight = day_start + datetime.timedelta(days=1)
        segment_end = min(next_midnight, end_local)
        duration_hours = Decimal(str((segment_end - current).total_seconds())) / 3600
        day = current.date()
        result[day] = result.get(day, Decimal(0)) + duration_hours
        current = segment_end

    return result


def _clip_to_range(day_hours, start_date, end_date):
    """Отбрасывает дни вне `[start_date, end_date]` (оба местные
    `date`, включительно)."""
    return {
        day: hours for day, hours in day_hours.items() if start_date <= day <= end_date
    }


def _merge(target, source):
    for day, hours in source.items():
        target[day] = target.get(day, Decimal(0)) + hours


def compute_plan_load(employee_id, start_date, end_date):
    """FR-32 план-половина: сумма часов Дежурств (14.5) и текущих
    назначений ОМ (16.1, интервал берётся из `SecurityEvent.starts_at/
    ends_at` — `PlacementAssignment` не несёт своего времени, 16.3a) по
    календарным дням `[start_date, end_date]`. Отменённые смены
    (`cancelled_at`), неактуальные версии (`is_current=False`),
    отменённые события (`CANCELLED`) и назначения без заданного
    интервала (`starts_at`/`ends_at` NULL) исключаются."""
    totals = {}

    shifts = DutyShift.objects.filter(
        employee_id=employee_id,
        cancelled_at__isnull=True,
    ).only("starts_at", "ends_at")
    for shift in shifts:
        _merge(
            totals,
            _clip_to_range(
                _split_hours_by_local_day(shift.starts_at, shift.ends_at),
                start_date,
                end_date,
            ),
        )

    assignments = (
        PlacementAssignment.objects.filter(
            employee_id=employee_id,
            version__is_current=True,
        )
        .exclude(version__event__status_code=SecurityEvent.StatusCode.CANCELLED)
        .select_related("version__event")
    )
    for assignment in assignments:
        event = assignment.version.event
        if event.starts_at is None or event.ends_at is None:
            continue
        _merge(
            totals,
            _clip_to_range(
                _split_hours_by_local_day(event.starts_at, event.ends_at),
                start_date,
                end_date,
            ),
        )

    return {day: hours.quantize(Decimal("0.01")) for day, hours in totals.items()}


def compute_fact_load(employee_id, start_date, end_date):
    """FR-32/FR-43 факт-половина: сумма часов из опроса
    (`PlacementAssignmentActual`, 18.3) по календарным дням, ТОЛЬКО для
    назначений текущей версии, чьё событие `CLOSED` — тот же двойной
    гейт, что 18.3/18.4 (факт без утверждённого/закрытого события не
    существует по построению этих моделей). Режет СЫРОЙ интервал факта,
    не читает `ServiceHours` (18.4) — та хранит одну сумму на весь факт,
    без разбивки по дням."""
    totals = {}

    actuals = (
        PlacementAssignmentActual.objects.filter(
            assignment__employee_id=employee_id,
            assignment__version__is_current=True,
            assignment__version__event__status_code=SecurityEvent.StatusCode.CLOSED,
        )
        .select_related("assignment")
        .only("actual_start_at", "actual_end_at", "assignment")
    )
    for actual in actuals:
        _merge(
            totals,
            _clip_to_range(
                _split_hours_by_local_day(actual.actual_start_at, actual.actual_end_at),
                start_date,
                end_date,
            ),
        )

    return {day: hours.quantize(Decimal("0.01")) for day, hours in totals.items()}
