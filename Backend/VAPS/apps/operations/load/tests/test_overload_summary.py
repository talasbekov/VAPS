"""Story 20.3a (FR-32): compute_fact_load_bulk()/compute_overload_summary()
— bulk-версия 19.1's compute_fact_load() + композиция с 19.2's
detect_overload_days(), для будущего дашборда перегрузки (Epic 20)."""

import datetime
import uuid
from decimal import Decimal
from zoneinfo import ZoneInfo

import pytest
from django.db import connection
from django.test.utils import CaptureQueriesContext

from apps.operations.events.models import (
    AssignmentVersion,
    PlacementAssignment,
    PlacementAssignmentActual,
    SecurityEvent,
)
from apps.operations.facilities.models import Object as FacilityObject
from apps.operations.facilities.models import Post
from apps.operations.load.selectors import (
    compute_fact_load_bulk,
    compute_overload_summary,
)

pytestmark = pytest.mark.django_db

TZ = ZoneInfo("Asia/Qyzylorda")
EMPLOYEE_A = "11111111-1111-1111-1111-111111111111"
EMPLOYEE_B = "22222222-2222-2222-2222-222222222222"


def local(*args):
    return datetime.datetime(*args, tzinfo=TZ)


def make_object(code):
    return FacilityObject.objects.create(code=code, name="Штаб", address="г. Кызылорда")


def make_event(obj, status_code=SecurityEvent.StatusCode.CLOSED):
    return SecurityEvent.objects.create(object=obj, title="ОМ", status_code=status_code)


def make_assignment(event, employee_id, is_current=True):
    post = Post.objects.create(
        object=event.object, code=f"POST-{event.pk}-{employee_id}", name="Пост"
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


def make_full_day(obj, employee_id, day):
    event = make_event(obj)
    assignment = make_assignment(event, employee_id)
    make_actual(
        assignment,
        local(day.year, day.month, day.day, 8, 0),
        local(day.year, day.month, day.day, 20, 0),
    )


# --- compute_fact_load_bulk ---


def test_bulk_empty_input_no_query():
    with CaptureQueriesContext(connection) as ctx:
        result = compute_fact_load_bulk(
            [], datetime.date(2026, 8, 1), datetime.date(2026, 8, 31)
        )

    assert result == {}
    assert len(ctx.captured_queries) == 0


def test_bulk_each_employee_present_as_key():
    result = compute_fact_load_bulk(
        [EMPLOYEE_A, EMPLOYEE_B], datetime.date(2026, 8, 1), datetime.date(2026, 8, 31)
    )

    assert result == {EMPLOYEE_A: {}, EMPLOYEE_B: {}}


def test_bulk_isolates_between_employees():
    obj = make_object("OBJ-20-3-2")
    event_a = make_event(obj)
    event_b = make_event(obj)
    make_actual(
        make_assignment(event_a, EMPLOYEE_A),
        local(2026, 8, 3, 9, 0),
        local(2026, 8, 3, 17, 0),
    )
    make_actual(
        make_assignment(event_b, EMPLOYEE_B),
        local(2026, 8, 3, 10, 0),
        local(2026, 8, 3, 14, 0),
    )

    result = compute_fact_load_bulk(
        [EMPLOYEE_A, EMPLOYEE_B], datetime.date(2026, 8, 1), datetime.date(2026, 8, 31)
    )

    assert result[EMPLOYEE_A] == {datetime.date(2026, 8, 3): Decimal("8.00")}
    assert result[EMPLOYEE_B] == {datetime.date(2026, 8, 3): Decimal("4.00")}


def test_bulk_accepts_uuid_object_input():
    # Review (Blind Hunter + Edge Case Hunter): все прочие тесты передают
    # employee_id строкой — этот тест закрывает пробел на случай, если
    # будущий 20.3b (API-слой) передаст `uuid.UUID`-объект (например, из
    # DRF `UUIDField`), а не строку.
    obj = make_object("OBJ-20-3-7")
    employee_uuid = uuid.UUID(EMPLOYEE_A)
    make_actual(
        make_assignment(make_event(obj), employee_uuid),
        local(2026, 8, 3, 9, 0),
        local(2026, 8, 3, 17, 0),
    )

    result = compute_fact_load_bulk(
        [employee_uuid], datetime.date(2026, 8, 1), datetime.date(2026, 8, 31)
    )

    assert result == {employee_uuid: {datetime.date(2026, 8, 3): Decimal("8.00")}}


def test_bulk_single_query_regardless_of_employee_count():
    obj = make_object("OBJ-20-3-3")
    for eid in (EMPLOYEE_A, EMPLOYEE_B):
        make_actual(
            make_assignment(make_event(obj), eid),
            local(2026, 8, 3, 9, 0),
            local(2026, 8, 3, 17, 0),
        )

    with CaptureQueriesContext(connection) as ctx:
        compute_fact_load_bulk(
            [EMPLOYEE_A, EMPLOYEE_B],
            datetime.date(2026, 8, 1),
            datetime.date(2026, 8, 31),
        )

    assert len(ctx.captured_queries) == 1


# --- compute_overload_summary ---


def test_overload_summary_each_employee_present():
    result = compute_overload_summary(
        [EMPLOYEE_A, EMPLOYEE_B], datetime.date(2026, 8, 1), datetime.date(2026, 8, 31)
    )

    assert result == {EMPLOYEE_A: [], EMPLOYEE_B: []}


def test_overload_summary_flags_qualifying_series():
    obj = make_object("OBJ-20-3-4")
    for offset in range(4):
        day = datetime.date(2026, 8, 3) + datetime.timedelta(days=offset)
        make_full_day(obj, EMPLOYEE_A, day)

    result = compute_overload_summary(
        [EMPLOYEE_A], datetime.date(2026, 8, 1), datetime.date(2026, 8, 31)
    )

    assert result[EMPLOYEE_A] == [
        datetime.date(2026, 8, 3),
        datetime.date(2026, 8, 4),
        datetime.date(2026, 8, 5),
        datetime.date(2026, 8, 6),
    ]


def test_overload_summary_isolates_between_employees():
    obj = make_object("OBJ-20-3-5")
    for offset in range(4):
        day = datetime.date(2026, 8, 3) + datetime.timedelta(days=offset)
        make_full_day(obj, EMPLOYEE_A, day)
    # EMPLOYEE_B: только один день, не квалифицируется.
    make_full_day(obj, EMPLOYEE_B, datetime.date(2026, 8, 3))

    result = compute_overload_summary(
        [EMPLOYEE_A, EMPLOYEE_B], datetime.date(2026, 8, 1), datetime.date(2026, 8, 31)
    )

    assert len(result[EMPLOYEE_A]) == 4
    assert result[EMPLOYEE_B] == []


def test_overload_summary_custom_threshold():
    obj = make_object("OBJ-20-3-6")
    for offset in range(4):
        day = datetime.date(2026, 8, 3) + datetime.timedelta(days=offset)
        event = make_event(obj)
        assignment = make_assignment(event, EMPLOYEE_A)
        make_actual(
            assignment,
            local(day.year, day.month, day.day, 8, 0),
            local(day.year, day.month, day.day, 14, 0),
        )

    result = compute_overload_summary(
        [EMPLOYEE_A],
        datetime.date(2026, 8, 1),
        datetime.date(2026, 8, 31),
        threshold_hours=Decimal("6"),
    )

    assert len(result[EMPLOYEE_A]) == 4
