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
from django.db.models import Sum

from apps.operations.duties.models import DutyShift
from apps.operations.events.models import (
    PlacementAssignment,
    PlacementAssignmentActual,
    SecurityEvent,
    ServiceHours,
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


def detect_overload_days(day_hours, *, threshold_hours=Decimal("8")):
    """Story 19.2 (FR-32, агрегатная половина): дни, входящие в серию
    ИЗ БОЛЕЕ ЧЕМ 3 подряд идущих календарных дней, каждый из которых
    `>= threshold_hours`. Ровно 3 дня подряд — НЕ перегрузка («свыше
    3», не «от 3»). Чистая функция над результатом `compute_plan_load()`/
    `compute_fact_load()` (или любым другим `Dict[date, Decimal]`) — не
    делает запросов к БД.

    `day_hours` — sparse dict (19.1: только дни с ненулевой активностью,
    отсутствующий ключ ≠ 0, а разрыв последовательности) — отсутствующий
    день трактуется так же, как явный `< threshold_hours`: обрывает
    накапливаемую серию."""
    qualifying_days = sorted(
        day for day, hours in day_hours.items() if hours >= threshold_hours
    )

    overloaded = []
    run = []
    for day in qualifying_days:
        if run and day - run[-1] != datetime.timedelta(days=1):
            if len(run) > 3:
                overloaded.extend(run)
            run = []
        run.append(day)
    if len(run) > 3:
        overloaded.extend(run)

    return overloaded


def compute_fact_load_bulk(employee_ids, start_date, end_date):
    """Story 20.3a (FR-32, bulk-версия `compute_fact_load`, 19.1): ОДИН
    запрос на ВСЕХ переданных сотрудников СРАЗУ (`employee_id__in=...`),
    не N+1 вызовов `compute_fact_load()` в цикле — тот же приём, что
    `division_month_calendar()` (19.5a) для `month_calendar()`. Группировка
    построчного результата ПО `employee_id` — чистый Python, без доп.
    запросов. Каждый переданный `employee_id` присутствует в результате
    как ключ (тот же объект, что во входном списке), даже без единого
    факта за период (пустой `{}`).

    Группировка ключуется по `str(employee_id)` внутри, не по самому
    объекту: `PlacementAssignment.employee_id` — плоский `UUIDField`
    (ARCH-002/003), ORM возвращает `uuid.UUID`-инстансы через
    `.select_related`, а вызывающий код может передать `employee_ids`
    строками (тот же тип, что везде в тестовых фикстурах) — `str`/`UUID`
    той же логической сущности не равны как dict-ключи Python."""
    employee_ids = list(employee_ids)
    if not employee_ids:
        return {}

    totals_by_employee = {str(employee_id): {} for employee_id in employee_ids}

    actuals = (
        PlacementAssignmentActual.objects.filter(
            assignment__employee_id__in=employee_ids,
            assignment__version__is_current=True,
            assignment__version__event__status_code=SecurityEvent.StatusCode.CLOSED,
        )
        .select_related("assignment")
        .only("actual_start_at", "actual_end_at", "assignment")
    )
    for actual in actuals:
        _merge(
            totals_by_employee[str(actual.assignment.employee_id)],
            _clip_to_range(
                _split_hours_by_local_day(actual.actual_start_at, actual.actual_end_at),
                start_date,
                end_date,
            ),
        )

    return {
        employee_id: {
            day: hours.quantize(Decimal("0.01"))
            for day, hours in totals_by_employee[str(employee_id)].items()
        }
        for employee_id in employee_ids
    }


def compute_fact_load(employee_id, start_date, end_date):
    """FR-32/FR-43 факт-половина: сумма часов из опроса
    (`PlacementAssignmentActual`, 18.3) по календарным дням, ТОЛЬКО для
    назначений текущей версии, чьё событие `CLOSED` — тот же двойной
    гейт, что 18.3/18.4 (факт без утверждённого/закрытого события не
    существует по построению этих моделей). Режет СЫРОЙ интервал факта,
    не читает `ServiceHours` (18.4) — та хранит одну сумму на весь факт,
    без разбивки по дням. Тонкая обёртка над `compute_fact_load_bulk()`
    (20.3a) — не дублирует запрос-логику."""
    return compute_fact_load_bulk([employee_id], start_date, end_date)[employee_id]


def compute_overload_summary(
    employee_ids, start_date, end_date, *, threshold_hours=Decimal("8")
):
    """Story 20.3a (FR-32): дни перегрузки (19.2's `detect_overload_days`)
    ДЛЯ СПИСКА сотрудников, вычисленные из bulk-факта (`compute_fact_load_
    bulk`, ОДИН запрос). `detect_overload_days()` — чистая функция, вызов
    по-сотруднику в Python-цикле НЕ добавляет запросов к БД. Каждый
    переданный `employee_id` присутствует в результате (пустой список,
    если не перегружен)."""
    fact_by_employee = compute_fact_load_bulk(employee_ids, start_date, end_date)
    return {
        employee_id: detect_overload_days(day_hours, threshold_hours=threshold_hours)
        for employee_id, day_hours in fact_by_employee.items()
    }


def compute_cumulative_service_hours(employee_id):
    """Story 19.6a (FR-32/FR-3): накопительный Налёт часов сотрудника —
    ОДИН агрегатный запрос по уже вычисленным `ServiceHours` (18.4), не
    построчная выборка + сложение в Python. Тот же двойной гейт, что
    `compute_fact_load()`: `ServiceHours`, чьё назначение впоследствии
    заменено (`is_current=False`) или чьё событие не `CLOSED`, не
    учитывается — версия/статус могли смениться ПОСЛЕ вычисления
    `ServiceHours`, гейт перепроверяется на чтение. Отсутствие данных →
    нули, не `None`/исключение (карточка не различает «нет данных» и
    «нулевой налёт»)."""
    aggregate = ServiceHours.objects.filter(
        actual__assignment__employee_id=employee_id,
        actual__assignment__version__is_current=True,
        actual__assignment__version__event__status_code=SecurityEvent.StatusCode.CLOSED,
    ).aggregate(day=Sum("day_hours"), night=Sum("night_hours"))

    # Не `.quantize()` как соседние `compute_plan_load`/`compute_fact_load`
    # (эти режут по дням из СЫРЫХ интервалов, накапливая произвольную
    # точность) — тут `Sum()` уже суммирует поля с фиксированным
    # `decimal_places=2`, точность сохраняется без округления.
    day_hours = aggregate["day"] or Decimal("0.00")
    night_hours = aggregate["night"] or Decimal("0.00")

    return {
        "day_hours": day_hours,
        "night_hours": night_hours,
        "total_hours": day_hours + night_hours,
    }
