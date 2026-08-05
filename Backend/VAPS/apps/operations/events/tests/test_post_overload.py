"""Story 18.5 (FR-32's «превышение лимита Поста» half) —
flag_post_overload(): per-instance comparison of ServiceHours (18.4)
against Post.max_service_minutes (14.2). Boundary is strictly-greater
(exactly-at-limit is NOT overloaded)."""

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
from apps.operations.events.services import compute_service_hours, flag_post_overload
from apps.operations.facilities.models import Object as FacilityObject
from apps.operations.facilities.models import Post

pytestmark = pytest.mark.django_db

TZ = ZoneInfo("Asia/Qyzylorda")


def local(*args):
    return datetime.datetime(*args, tzinfo=TZ)


def make_event(code, status_code=SecurityEvent.StatusCode.CLOSED):
    obj = FacilityObject.objects.create(code=code, name="Штаб", address="г. Кызылорда")
    return SecurityEvent.objects.create(object=obj, title="ОМ", status_code=status_code)


def make_actual(
    event,
    actual_start_at,
    actual_end_at,
    is_current=True,
    max_service_minutes=480,
):
    post = Post.objects.create(
        object=event.object,
        code="POST-1",
        name="Пост",
        max_service_minutes=max_service_minutes,
    )
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


def test_within_limit_not_overloaded():
    event = make_event("OBJ-OV-1")
    actual = make_actual(
        event,
        local(2026, 8, 4, 9, 0),
        local(2026, 8, 4, 16, 0),
        max_service_minutes=480,
    )
    hours = compute_service_hours(actual, actor="staff-1")

    flagged = flag_post_overload(hours, actor="staff-1")

    assert flagged.is_overloaded is False
    assert flagged.overload_minutes == Decimal("0.00")
    assert AuditLog.objects.filter(action="POST_OVERLOAD_FLAGGED").exists()


def test_over_limit_flags_overloaded_with_exact_excess():
    event = make_event("OBJ-OV-2")
    actual = make_actual(
        event,
        local(2026, 8, 4, 9, 0),
        local(2026, 8, 4, 17, 0),
        max_service_minutes=360,
    )
    hours = compute_service_hours(actual, actor="staff-1")

    flagged = flag_post_overload(hours, actor="staff-1")

    assert flagged.is_overloaded is True
    assert flagged.overload_minutes == Decimal("120.00")


def test_exactly_at_limit_not_overloaded():
    event = make_event("OBJ-OV-3")
    actual = make_actual(
        event,
        local(2026, 8, 4, 9, 0),
        local(2026, 8, 4, 17, 0),
        max_service_minutes=480,
    )
    hours = compute_service_hours(actual, actor="staff-1")

    flagged = flag_post_overload(hours, actor="staff-1")

    assert flagged.is_overloaded is False
    assert flagged.overload_minutes == Decimal("0.00")


def test_upsert_recomputes_not_duplicates():
    event = make_event("OBJ-OV-4")
    actual = make_actual(
        event,
        local(2026, 8, 4, 9, 0),
        local(2026, 8, 4, 17, 0),
        max_service_minutes=360,
    )
    hours = compute_service_hours(actual, actor="staff-1")
    flag_post_overload(hours, actor="staff-1")

    actual.actual_end_at = local(2026, 8, 4, 12, 0)
    actual.save(update_fields=["actual_end_at"])
    hours = compute_service_hours(actual, actor="staff-1")
    flagged = flag_post_overload(hours, actor="staff-2")

    assert ServiceHours.objects.filter(actual=actual).count() == 1
    assert flagged.is_overloaded is False
    assert flagged.overload_minutes == Decimal("0.00")


def test_rejected_when_not_current():
    event = make_event("OBJ-OV-5")
    actual = make_actual(
        event,
        local(2026, 8, 4, 9, 0),
        local(2026, 8, 4, 17, 0),
        is_current=False,
        max_service_minutes=360,
    )
    hours = ServiceHours.objects.create(
        actual=actual,
        day_hours=Decimal("8.00"),
        night_hours=Decimal("0.00"),
        computed_at=local(2026, 8, 4, 17, 0),
    )

    with pytest.raises(DomainError) as exc_info:
        flag_post_overload(hours, actor="staff-1")

    assert exc_info.value.http_status == 422


def test_rejected_when_event_not_closed():
    event = make_event("OBJ-OV-6", status_code=SecurityEvent.StatusCode.IN_PROGRESS)
    actual = make_actual(
        event,
        local(2026, 8, 4, 9, 0),
        local(2026, 8, 4, 17, 0),
        max_service_minutes=360,
    )
    hours = ServiceHours.objects.create(
        actual=actual,
        day_hours=Decimal("8.00"),
        night_hours=Decimal("0.00"),
        computed_at=local(2026, 8, 4, 17, 0),
    )

    with pytest.raises(DomainError) as exc_info:
        flag_post_overload(hours, actor="staff-1")

    assert exc_info.value.http_status == 422


def test_limit_change_between_calls_reflected_on_recall():
    """AC-6: flag_post_overload() reads Post.max_service_minutes fresh on
    each call — it must not cache the limit on ServiceHours."""
    event = make_event("OBJ-OV-7")
    actual = make_actual(
        event,
        local(2026, 8, 4, 9, 0),
        local(2026, 8, 4, 17, 0),
        max_service_minutes=480,
    )
    hours = compute_service_hours(actual, actor="staff-1")
    first = flag_post_overload(hours, actor="staff-1")
    assert first.is_overloaded is False

    post = actual.assignment.post
    post.max_service_minutes = 360
    post.save(update_fields=["max_service_minutes"])

    second = flag_post_overload(hours, actor="staff-1")

    assert second.is_overloaded is True
    assert second.overload_minutes == Decimal("120.00")

