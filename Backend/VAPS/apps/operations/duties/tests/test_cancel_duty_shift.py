"""Story 14.9a — cancel_duty_shift() (removes OM_AUTO projection, append-once
cancel facts on DutyShift)."""

import datetime
from zoneinfo import ZoneInfo

import pytest

from apps.core import clock
from apps.core.exceptions import DomainError
from apps.operations.duties.models import DutyPlan, DutyShift
from apps.operations.duties.services import cancel_duty_shift, project_duty_shift
from apps.operations.facilities.models import DutyType, Object as FacilityObject
from apps.operations.statuses.models import EmployeeStatus, StatusType

pytestmark = pytest.mark.django_db

LOCAL_TZ = ZoneInfo("Asia/Qyzylorda")


@pytest.fixture
def status_types(db):
    StatusType.objects.create(
        code="DUTY",
        name="На дежурстве",
        is_hard_block=False,
        priority=70,
        report_column_code="ON_DUTY",
    )
    StatusType.objects.create(
        code="REST_AFTER_DUTY",
        name="После дежурства",
        is_hard_block=False,
        priority=60,
        report_column_code="AFTER_DUTY",
    )
    StatusType.objects.create(
        code="BEFORE_DUTY",
        name="Перед дежурством",
        is_hard_block=False,
        priority=65,
        report_column_code="BEFORE_DUTY",
    )


def make_object(code="OBJ-CDS-1"):
    return FacilityObject.objects.create(
        code=code, name="Штаб", address="г. Кызылорда, ул. 1"
    )


def make_plan(obj, year=2026, month=8, **kwargs):
    return DutyPlan.objects.create(object=obj, year=year, month=month, **kwargs)


def make_shift(plan, starts_at, ends_at, **kwargs):
    import uuid

    return DutyShift.objects.create(
        plan=plan,
        employee_id=uuid.uuid4(),
        starts_at=starts_at,
        ends_at=ends_at,
        **kwargs,
    )


def test_cancel_duty_shift_removes_projected_statuses_and_marks_shift(status_types):
    obj = make_object("OBJ-CDS-2")
    plan = make_plan(obj)
    shift = make_shift(
        plan,
        datetime.datetime(2026, 9, 1, 8, 0, tzinfo=LOCAL_TZ),
        datetime.datetime(2026, 9, 1, 20, 0, tzinfo=LOCAL_TZ),
    )
    project_duty_shift(shift)
    assert EmployeeStatus.objects.filter(source_ref=f"DUTY:{shift.pk}").exists()
    assert EmployeeStatus.objects.filter(
        source_ref=f"REST_AFTER_DUTY:{shift.pk}"
    ).exists()

    with clock.override(datetime.date(2026, 8, 1)):
        cancel_duty_shift(shift, actor="operator", reason="Плановое сокращение")

    assert not EmployeeStatus.objects.filter(source_ref=f"DUTY:{shift.pk}").exists()
    assert not EmployeeStatus.objects.filter(
        source_ref=f"REST_AFTER_DUTY:{shift.pk}"
    ).exists()
    shift.refresh_from_db()
    assert shift.cancelled_at is not None
    assert shift.cancelled_by == "operator"
    assert shift.cancelled_reason == "Плановое сокращение"


def test_cancel_duty_shift_removes_before_duty_when_present(status_types):
    obj = make_object("OBJ-CDS-3")
    plan = make_plan(obj)
    duty_type = DutyType.objects.create(
        object=obj, code="DAY", name="Дневное", before_duty_minutes=60
    )
    shift = make_shift(
        plan,
        datetime.datetime(2026, 9, 1, 8, 0, tzinfo=LOCAL_TZ),
        datetime.datetime(2026, 9, 1, 20, 0, tzinfo=LOCAL_TZ),
        duty_type=duty_type,
    )
    project_duty_shift(shift)
    assert EmployeeStatus.objects.filter(source_ref=f"BEFORE_DUTY:{shift.pk}").exists()

    with clock.override(datetime.date(2026, 8, 1)):
        cancel_duty_shift(shift, actor="operator", reason="Отмена")

    assert not EmployeeStatus.objects.filter(
        source_ref=f"BEFORE_DUTY:{shift.pk}"
    ).exists()


def test_cancel_duty_shift_without_before_duty_still_succeeds(status_types):
    # AC-5: no duty_type → no BEFORE_DUTY row ever existed; cancel must
    # still succeed cleanly for DUTY/REST_AFTER_DUTY.
    obj = make_object("OBJ-CDS-4")
    plan = make_plan(obj)
    shift = make_shift(
        plan,
        datetime.datetime(2026, 9, 1, 8, 0, tzinfo=LOCAL_TZ),
        datetime.datetime(2026, 9, 1, 20, 0, tzinfo=LOCAL_TZ),
    )
    project_duty_shift(shift)

    with clock.override(datetime.date(2026, 8, 1)):
        cancel_duty_shift(shift, actor="operator", reason="Отмена")

    shift.refresh_from_db()
    assert shift.cancelled_at is not None


def test_cancel_duty_shift_requires_actor(status_types):
    obj = make_object("OBJ-CDS-5")
    plan = make_plan(obj)
    shift = make_shift(
        plan,
        datetime.datetime(2026, 9, 1, 8, 0, tzinfo=LOCAL_TZ),
        datetime.datetime(2026, 9, 1, 20, 0, tzinfo=LOCAL_TZ),
    )

    with clock.override(datetime.date(2026, 8, 1)):
        with pytest.raises(DomainError) as exc_info:
            cancel_duty_shift(shift, actor="", reason="Отмена")
    assert exc_info.value.code == "VALIDATION_ERROR"
    assert exc_info.value.http_status == 400


def test_cancel_duty_shift_requires_reason(status_types):
    obj = make_object("OBJ-CDS-6")
    plan = make_plan(obj)
    shift = make_shift(
        plan,
        datetime.datetime(2026, 9, 1, 8, 0, tzinfo=LOCAL_TZ),
        datetime.datetime(2026, 9, 1, 20, 0, tzinfo=LOCAL_TZ),
    )

    with clock.override(datetime.date(2026, 8, 1)):
        with pytest.raises(DomainError) as exc_info:
            cancel_duty_shift(shift, actor="operator", reason="   ")
    assert exc_info.value.code == "VALIDATION_ERROR"
    assert exc_info.value.http_status == 400


def test_cancel_duty_shift_rejects_already_started_shift(status_types):
    obj = make_object("OBJ-CDS-7")
    plan = make_plan(obj)
    shift = make_shift(
        plan,
        datetime.datetime(2026, 8, 1, 8, 0, tzinfo=LOCAL_TZ),
        datetime.datetime(2026, 8, 1, 20, 0, tzinfo=LOCAL_TZ),
    )
    project_duty_shift(shift)

    with clock.override(datetime.date(2026, 8, 1)):
        with pytest.raises(DomainError) as exc_info:
            cancel_duty_shift(shift, actor="operator", reason="Слишком поздно")

    assert exc_info.value.code == "INVALID_LIFECYCLE_TRANSITION"
    assert exc_info.value.http_status == 422
    shift.refresh_from_db()
    assert shift.cancelled_at is None
    assert EmployeeStatus.objects.filter(source_ref=f"DUTY:{shift.pk}").exists()


def test_cancel_duty_shift_rejects_already_cancelled_shift(status_types):
    obj = make_object("OBJ-CDS-8")
    plan = make_plan(obj)
    shift = make_shift(
        plan,
        datetime.datetime(2026, 9, 1, 8, 0, tzinfo=LOCAL_TZ),
        datetime.datetime(2026, 9, 1, 20, 0, tzinfo=LOCAL_TZ),
    )
    project_duty_shift(shift)

    with clock.override(datetime.date(2026, 8, 1)):
        cancel_duty_shift(shift, actor="operator", reason="Отмена")

        with pytest.raises(DomainError) as exc_info:
            cancel_duty_shift(shift, actor="operator", reason="Повторная отмена")
    assert exc_info.value.code == "INVALID_LIFECYCLE_TRANSITION"
    assert exc_info.value.http_status == 422
