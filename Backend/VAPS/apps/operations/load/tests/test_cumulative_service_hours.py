"""Story 19.6a (FR-32/FR-3): compute_cumulative_service_hours() — накопительный
Налёт часов (день/ночь/всего) по сотруднику для будущей карточки (19.6b/c)."""

import datetime
from decimal import Decimal
from zoneinfo import ZoneInfo

import pytest
from django.test.utils import CaptureQueriesContext
from django.db import connection

from apps.operations.events.models import (
    AssignmentVersion,
    PlacementAssignment,
    PlacementAssignmentActual,
    SecurityEvent,
    ServiceHours,
)
from apps.operations.facilities.models import Object as FacilityObject
from apps.operations.facilities.models import Post
from apps.operations.load.selectors import compute_cumulative_service_hours

pytestmark = pytest.mark.django_db

TZ = ZoneInfo("Asia/Qyzylorda")
EMPLOYEE = "11111111-1111-1111-1111-111111111111"
OTHER_EMPLOYEE = "22222222-2222-2222-2222-222222222222"


def local(*args):
    return datetime.datetime(*args, tzinfo=TZ)


def make_object(code):
    return FacilityObject.objects.create(code=code, name="Штаб", address="г. Кызылорда")


def make_event(obj, status_code=SecurityEvent.StatusCode.CLOSED):
    return SecurityEvent.objects.create(
        object=obj,
        title="ОМ",
        status_code=status_code,
        starts_at=local(2026, 8, 1, 0, 0),
        ends_at=local(2026, 8, 2, 0, 0),
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


def make_service_hours(assignment, day_hours, night_hours, computed_at=None):
    actual = PlacementAssignmentActual.objects.create(
        assignment=assignment,
        actual_start_at=local(2026, 8, 1, 9, 0),
        actual_end_at=local(2026, 8, 1, 17, 0),
        recorded_by="staff-1",
    )
    return ServiceHours.objects.create(
        actual=actual,
        day_hours=Decimal(day_hours),
        night_hours=Decimal(night_hours),
        computed_at=computed_at or local(2026, 8, 2, 8, 0),
    )


def test_sums_across_multiple_service_hours_rows():
    obj = make_object("OBJ-19-6-1")
    event1 = make_event(obj)
    event2 = make_event(obj)
    make_service_hours(make_assignment(event1, EMPLOYEE), "8", "2")
    make_service_hours(make_assignment(event2, EMPLOYEE), "3", "5")

    result = compute_cumulative_service_hours(EMPLOYEE)

    assert result == {
        "day_hours": Decimal("11.00"),
        "night_hours": Decimal("7.00"),
        "total_hours": Decimal("18.00"),
    }


def test_employee_without_service_hours_returns_zeros():
    result = compute_cumulative_service_hours(EMPLOYEE)

    assert result == {
        "day_hours": Decimal("0.00"),
        "night_hours": Decimal("0.00"),
        "total_hours": Decimal("0.00"),
    }


def test_excludes_non_current_assignment_version():
    obj = make_object("OBJ-19-6-2")
    event = make_event(obj)
    make_service_hours(make_assignment(event, EMPLOYEE, is_current=False), "8", "2")

    result = compute_cumulative_service_hours(EMPLOYEE)

    assert result == {
        "day_hours": Decimal("0.00"),
        "night_hours": Decimal("0.00"),
        "total_hours": Decimal("0.00"),
    }


def test_excludes_event_not_closed():
    obj = make_object("OBJ-19-6-3")
    event = make_event(obj, status_code=SecurityEvent.StatusCode.IN_PROGRESS)
    make_service_hours(make_assignment(event, EMPLOYEE), "8", "2")

    result = compute_cumulative_service_hours(EMPLOYEE)

    assert result == {
        "day_hours": Decimal("0.00"),
        "night_hours": Decimal("0.00"),
        "total_hours": Decimal("0.00"),
    }


def test_isolates_between_employees():
    obj = make_object("OBJ-19-6-4")
    event_a = make_event(obj)
    event_b = make_event(obj)
    make_service_hours(make_assignment(event_a, EMPLOYEE), "8", "2")
    make_service_hours(make_assignment(event_b, OTHER_EMPLOYEE), "1", "1")

    result = compute_cumulative_service_hours(EMPLOYEE)

    assert result == {
        "day_hours": Decimal("8.00"),
        "night_hours": Decimal("2.00"),
        "total_hours": Decimal("10.00"),
    }


def test_single_query_regardless_of_row_count():
    obj = make_object("OBJ-19-6-5")
    for _ in range(5):
        event = make_event(obj)
        make_service_hours(make_assignment(event, EMPLOYEE), "1", "1")

    with CaptureQueriesContext(connection) as ctx:
        compute_cumulative_service_hours(EMPLOYEE)

    assert len(ctx.captured_queries) == 1
