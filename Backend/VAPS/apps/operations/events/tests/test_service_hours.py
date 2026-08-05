"""Story 18.4 (FR-32) — compute_service_hours(): Налёт часов день/ночь
derived from PlacementAssignmentActual (18.3). Night = 22:00-06:00
Asia/Qyzylorda (PROVISIONAL, no coefficient registry yet — Epic 19)."""

import datetime
from decimal import Decimal
from zoneinfo import ZoneInfo

import pytest

from apps.audit.models import AuditLog
from apps.core.exceptions import DomainError
from apps.operations.events.models import (
    AssignmentVersion,
    PlacementAssignment,
    PlacementAssignmentActual,
    SecurityEvent,
    ServiceHours,
)
from apps.operations.events.services import compute_service_hours
from apps.operations.facilities.models import Object as FacilityObject
from apps.operations.facilities.models import Post

pytestmark = pytest.mark.django_db

TZ = ZoneInfo("Asia/Qyzylorda")


def local(*args):
    return datetime.datetime(*args, tzinfo=TZ)


def make_event(code, status_code=SecurityEvent.StatusCode.CLOSED):
    obj = FacilityObject.objects.create(code=code, name="Штаб", address="г. Кызылорда")
    return SecurityEvent.objects.create(object=obj, title="ОМ", status_code=status_code)


def make_actual(event, actual_start_at, actual_end_at, is_current=True):
    post = Post.objects.create(object=event.object, code="POST-1", name="Пост")
    version = AssignmentVersion.objects.create(
        event=event,
        status=AssignmentVersion.Status.APPROVED,
        version=1,
        is_current=is_current,
    )
    assignment = PlacementAssignment.objects.create(
        version=version, employee_id="11111111-1111-1111-1111-111111111111", post=post
    )
    return PlacementAssignmentActual.objects.create(
        assignment=assignment,
        actual_start_at=actual_start_at,
        actual_end_at=actual_end_at,
        recorded_by="staff-1",
    )


def test_fully_daytime_interval():
    event = make_event("OBJ-SH-1")
    actual = make_actual(event, local(2026, 8, 4, 9, 0), local(2026, 8, 4, 17, 0))

    hours = compute_service_hours(actual, actor="staff-1")

    assert hours.day_hours == Decimal("8.00")
    assert hours.night_hours == Decimal("0.00")
    assert AuditLog.objects.filter(action="SERVICE_HOURS_COMPUTED").exists()


def test_fully_nighttime_interval_crosses_midnight():
    event = make_event("OBJ-SH-2")
    actual = make_actual(event, local(2026, 8, 4, 23, 0), local(2026, 8, 5, 5, 0))

    hours = compute_service_hours(actual, actor="staff-1")

    assert hours.day_hours == Decimal("0.00")
    assert hours.night_hours == Decimal("6.00")


def test_interval_crosses_both_boundaries():
    event = make_event("OBJ-SH-3")
    actual = make_actual(event, local(2026, 8, 4, 20, 0), local(2026, 8, 5, 8, 0))

    hours = compute_service_hours(actual, actor="staff-1")

    assert hours.day_hours == Decimal("4.00")
    assert hours.night_hours == Decimal("8.00")
    assert hours.day_hours + hours.night_hours == Decimal("12.00")


def test_multi_day_interval():
    event = make_event("OBJ-SH-4")
    # 09:00 Aug 4 -> 09:00 Aug 6 = 48h total: 2 full days (16h day + 8h
    # night each) + boundary math folds identically since it's an exact
    # multiple of 24h starting mid-day.
    actual = make_actual(event, local(2026, 8, 4, 9, 0), local(2026, 8, 6, 9, 0))

    hours = compute_service_hours(actual, actor="staff-1")

    assert hours.day_hours + hours.night_hours == Decimal("48.00")
    assert hours.day_hours == Decimal("32.00")
    assert hours.night_hours == Decimal("16.00")


def test_upsert_recomputes_not_duplicates():
    event = make_event("OBJ-SH-5")
    actual = make_actual(event, local(2026, 8, 4, 9, 0), local(2026, 8, 4, 17, 0))
    compute_service_hours(actual, actor="staff-1")

    actual.actual_end_at = local(2026, 8, 4, 21, 0)
    actual.save(update_fields=["actual_end_at"])
    hours = compute_service_hours(actual, actor="staff-2")

    assert ServiceHours.objects.filter(actual=actual).count() == 1
    assert hours.day_hours == Decimal("12.00")


def test_rejected_when_not_current():
    event = make_event("OBJ-SH-6")
    actual = make_actual(
        event, local(2026, 8, 4, 9, 0), local(2026, 8, 4, 17, 0), is_current=False
    )

    with pytest.raises(DomainError) as exc_info:
        compute_service_hours(actual, actor="staff-1")

    assert exc_info.value.http_status == 422


def test_rejected_when_event_not_closed():
    event = make_event("OBJ-SH-7", status_code=SecurityEvent.StatusCode.IN_PROGRESS)
    actual = make_actual(event, local(2026, 8, 4, 9, 0), local(2026, 8, 4, 17, 0))

    with pytest.raises(DomainError) as exc_info:
        compute_service_hours(actual, actor="staff-1")

    assert exc_info.value.http_status == 422
