"""Story 19.1 (FR-32) — compute_plan_load()/compute_fact_load(): нагрузка
план/факт по календарным дням, единый источник для 19.2/19.3/19.4-19.6."""

import datetime
from decimal import Decimal
from zoneinfo import ZoneInfo

import pytest

from apps.operations.duties.models import DutyPlan, DutyShift
from apps.operations.events.models import (
    AssignmentVersion,
    PlacementAssignment,
    PlacementAssignmentActual,
    SecurityEvent,
)
from apps.operations.facilities.models import Object as FacilityObject
from apps.operations.facilities.models import Post
from apps.operations.load.selectors import compute_fact_load, compute_plan_load

pytestmark = pytest.mark.django_db

TZ = ZoneInfo("Asia/Qyzylorda")
EMPLOYEE = "11111111-1111-1111-1111-111111111111"
OTHER_EMPLOYEE = "22222222-2222-2222-2222-222222222222"


def local(*args):
    return datetime.datetime(*args, tzinfo=TZ)


def make_object(code):
    return FacilityObject.objects.create(code=code, name="Штаб", address="г. Кызылорда")


def make_duty_shift(obj, employee_id, starts_at, ends_at, cancelled_at=None):
    plan, _ = DutyPlan.objects.get_or_create(
        object=obj, year=starts_at.year, month=starts_at.month
    )
    return DutyShift.objects.create(
        plan=plan,
        employee_id=employee_id,
        starts_at=starts_at,
        ends_at=ends_at,
        cancelled_at=cancelled_at,
    )


def make_event(
    obj, status_code=SecurityEvent.StatusCode.IN_PROGRESS, starts_at=None, ends_at=None
):
    return SecurityEvent.objects.create(
        object=obj,
        title="ОМ",
        status_code=status_code,
        starts_at=starts_at,
        ends_at=ends_at,
    )


def make_assignment(event, employee_id, is_current=True):
    post = Post.objects.create(
        object=event.object, code=f"POST-{event.pk}", name="Пост"
    )
    version = AssignmentVersion.objects.create(
        event=event,
        status=AssignmentVersion.Status.APPROVED,
        version=1,
        is_current=is_current,
    )
    return PlacementAssignment.objects.create(
        version=version, employee_id=employee_id, post=post
    )


def make_actual(assignment, actual_start_at, actual_end_at):
    return PlacementAssignmentActual.objects.create(
        assignment=assignment,
        actual_start_at=actual_start_at,
        actual_end_at=actual_end_at,
        recorded_by="staff-1",
    )


# --- plan ---


def test_plan_shift_fully_inside_one_day():
    obj = make_object("OBJ-19-1-1")
    make_duty_shift(obj, EMPLOYEE, local(2026, 8, 4, 9, 0), local(2026, 8, 4, 17, 0))

    load = compute_plan_load(
        EMPLOYEE, datetime.date(2026, 8, 1), datetime.date(2026, 8, 31)
    )

    assert load == {datetime.date(2026, 8, 4): Decimal("8.00")}


def test_plan_shift_crosses_local_midnight_splits_across_two_days():
    obj = make_object("OBJ-19-1-2")
    make_duty_shift(obj, EMPLOYEE, local(2026, 8, 4, 20, 0), local(2026, 8, 5, 6, 0))

    load = compute_plan_load(
        EMPLOYEE, datetime.date(2026, 8, 1), datetime.date(2026, 8, 31)
    )

    assert load[datetime.date(2026, 8, 4)] == Decimal("4.00")
    assert load[datetime.date(2026, 8, 5)] == Decimal("6.00")
    assert sum(load.values()) == Decimal("10.00")


def test_plan_duty_and_event_on_same_day_sum():
    obj = make_object("OBJ-19-1-3")
    make_duty_shift(obj, EMPLOYEE, local(2026, 8, 4, 6, 0), local(2026, 8, 4, 10, 0))
    event = make_event(
        obj,
        status_code=SecurityEvent.StatusCode.APPROVED,
        starts_at=local(2026, 8, 4, 12, 0),
        ends_at=local(2026, 8, 4, 15, 0),
    )
    make_assignment(event, EMPLOYEE)

    load = compute_plan_load(
        EMPLOYEE, datetime.date(2026, 8, 1), datetime.date(2026, 8, 31)
    )

    assert load == {datetime.date(2026, 8, 4): Decimal("7.00")}


def test_plan_excludes_non_current_version_and_cancelled_event_and_null_interval():
    obj = make_object("OBJ-19-1-4")

    stale_event = make_event(
        obj,
        status_code=SecurityEvent.StatusCode.APPROVED,
        starts_at=local(2026, 8, 4, 9, 0),
        ends_at=local(2026, 8, 4, 17, 0),
    )
    make_assignment(stale_event, EMPLOYEE, is_current=False)

    cancelled_event = make_event(
        obj,
        status_code=SecurityEvent.StatusCode.CANCELLED,
        starts_at=local(2026, 8, 5, 9, 0),
        ends_at=local(2026, 8, 5, 17, 0),
    )
    make_assignment(cancelled_event, EMPLOYEE)

    no_window_event = make_event(obj, status_code=SecurityEvent.StatusCode.PLACEMENT)
    make_assignment(no_window_event, EMPLOYEE)

    load = compute_plan_load(
        EMPLOYEE, datetime.date(2026, 8, 1), datetime.date(2026, 8, 31)
    )

    assert load == {}


def test_plan_excludes_cancelled_shift():
    obj = make_object("OBJ-19-1-5")
    make_duty_shift(
        obj,
        EMPLOYEE,
        local(2026, 8, 4, 9, 0),
        local(2026, 8, 4, 17, 0),
        cancelled_at=local(2026, 8, 3, 10, 0),
    )

    load = compute_plan_load(
        EMPLOYEE, datetime.date(2026, 8, 1), datetime.date(2026, 8, 31)
    )

    assert load == {}


def test_plan_range_clips_partial_overlap_and_drops_out_of_range():
    obj = make_object("OBJ-19-1-6")
    # Fully outside the requested range.
    make_duty_shift(obj, EMPLOYEE, local(2026, 7, 1, 9, 0), local(2026, 7, 1, 17, 0))
    # Crosses the range boundary — only Aug 1's portion should count.
    make_duty_shift(obj, EMPLOYEE, local(2026, 7, 31, 20, 0), local(2026, 8, 1, 4, 0))

    load = compute_plan_load(
        EMPLOYEE, datetime.date(2026, 8, 1), datetime.date(2026, 8, 31)
    )

    assert load == {datetime.date(2026, 8, 1): Decimal("4.00")}


def test_plan_returns_empty_dict_for_employee_with_no_records():
    load = compute_plan_load(
        OTHER_EMPLOYEE, datetime.date(2026, 8, 1), datetime.date(2026, 8, 31)
    )

    assert load == {}


def test_plan_ignores_degenerate_event_window_without_raising():
    """review (Blind Hunter + Edge Case Hunter, независимо совпали):
    `SecurityEvent.starts_at/ends_at` — nullable, БЕЗ DB CheckConstraint
    (в отличие от `DutyShift`, у которой есть `ck_duty_shift_starts_before_ends`)
    — только `full_clean()`-путь гарантирует `starts_at < ends_at`, а
    `.objects.create()` его не вызывает. Инвертированное/нулевое окно на
    ОДНОМ событии не должно ронять весь агрегат по сотруднику."""
    obj = make_object("OBJ-19-1-10")
    degenerate_event = make_event(
        obj,
        status_code=SecurityEvent.StatusCode.APPROVED,
        starts_at=local(2026, 8, 4, 17, 0),
        ends_at=local(2026, 8, 4, 9, 0),  # inverted
    )
    make_assignment(degenerate_event, EMPLOYEE)
    make_duty_shift(obj, EMPLOYEE, local(2026, 8, 5, 9, 0), local(2026, 8, 5, 10, 0))

    load = compute_plan_load(
        EMPLOYEE, datetime.date(2026, 8, 1), datetime.date(2026, 8, 31)
    )

    assert load == {datetime.date(2026, 8, 5): Decimal("1.00")}


def test_plan_quantizes_once_after_merging_all_sources_not_per_source():
    """review (Blind Hunter): округление каждого источника ПО ОТДЕЛЬНОСТИ
    перед суммированием могло разойтись с округлением суммы. Два 20-минутных
    куска (1/3 часа каждый, периодическая дробь) с разных источников в один
    день: раздельное округление даёт 0.33+0.33=0.66, округление суммы ЦЕЛИКОМ
    даёт правильные 0.67."""
    obj = make_object("OBJ-19-1-11")
    make_duty_shift(obj, EMPLOYEE, local(2026, 8, 4, 9, 0), local(2026, 8, 4, 9, 20))
    event = make_event(
        obj,
        status_code=SecurityEvent.StatusCode.APPROVED,
        starts_at=local(2026, 8, 4, 9, 20),
        ends_at=local(2026, 8, 4, 9, 40),
    )
    make_assignment(event, EMPLOYEE)

    load = compute_plan_load(
        EMPLOYEE, datetime.date(2026, 8, 1), datetime.date(2026, 8, 31)
    )

    assert load == {datetime.date(2026, 8, 4): Decimal("0.67")}


# --- fact ---


def test_fact_load_splits_multi_day_actual_by_calendar_day():
    obj = make_object("OBJ-19-1-7")
    event = make_event(obj, status_code=SecurityEvent.StatusCode.CLOSED)
    assignment = make_assignment(event, EMPLOYEE)
    make_actual(assignment, local(2026, 8, 4, 20, 0), local(2026, 8, 6, 4, 0))

    load = compute_fact_load(
        EMPLOYEE, datetime.date(2026, 8, 1), datetime.date(2026, 8, 31)
    )

    assert load[datetime.date(2026, 8, 4)] == Decimal("4.00")
    assert load[datetime.date(2026, 8, 5)] == Decimal("24.00")
    assert load[datetime.date(2026, 8, 6)] == Decimal("4.00")
    assert sum(load.values()) == Decimal("32.00")


def test_fact_excludes_non_current_version_or_event_not_closed():
    obj = make_object("OBJ-19-1-8")

    stale_event = make_event(obj, status_code=SecurityEvent.StatusCode.CLOSED)
    stale_assignment = make_assignment(stale_event, EMPLOYEE, is_current=False)
    make_actual(stale_assignment, local(2026, 8, 4, 9, 0), local(2026, 8, 4, 17, 0))

    open_event = make_event(obj, status_code=SecurityEvent.StatusCode.IN_PROGRESS)
    open_assignment = make_assignment(open_event, EMPLOYEE)
    make_actual(open_assignment, local(2026, 8, 5, 9, 0), local(2026, 8, 5, 17, 0))

    load = compute_fact_load(
        EMPLOYEE, datetime.date(2026, 8, 1), datetime.date(2026, 8, 31)
    )

    assert load == {}


def test_fact_range_clips_partial_overlap():
    obj = make_object("OBJ-19-1-9")
    event = make_event(obj, status_code=SecurityEvent.StatusCode.CLOSED)
    assignment = make_assignment(event, EMPLOYEE)
    make_actual(assignment, local(2026, 7, 31, 20, 0), local(2026, 8, 1, 4, 0))

    load = compute_fact_load(
        EMPLOYEE, datetime.date(2026, 8, 1), datetime.date(2026, 8, 31)
    )

    assert load == {datetime.date(2026, 8, 1): Decimal("4.00")}


def test_fact_returns_empty_dict_for_employee_with_no_records():
    load = compute_fact_load(
        OTHER_EMPLOYEE, datetime.date(2026, 8, 1), datetime.date(2026, 8, 31)
    )

    assert load == {}
