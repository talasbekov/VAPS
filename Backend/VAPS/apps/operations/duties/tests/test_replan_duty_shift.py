"""Story 14.9b — replan_duty_shift() (cancel-old + create-new orchestrator)."""

import datetime
import uuid
from zoneinfo import ZoneInfo

import pytest
from django.core.exceptions import ValidationError

from apps.core import clock
from apps.core.exceptions import DomainError
from apps.operations.duties.models import DutyPlan, DutyShift
from apps.operations.duties.services import project_duty_shift, replan_duty_shift
from apps.operations.facilities.models import Object as FacilityObject
from apps.operations.facilities.models import Post
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


def make_object(code="OBJ-RPL-1"):
    return FacilityObject.objects.create(
        code=code, name="Штаб", address="г. Кызылорда, ул. 1"
    )


def make_plan(obj, year=2026, month=8, **kwargs):
    return DutyPlan.objects.create(object=obj, year=year, month=month, **kwargs)


def make_shift(plan, starts_at, ends_at, **kwargs):
    kwargs.setdefault("employee_id", uuid.uuid4())
    return DutyShift.objects.create(
        plan=plan, starts_at=starts_at, ends_at=ends_at, **kwargs
    )


def test_replan_duty_shift_cancels_old_and_projects_new(status_types):
    obj = make_object("OBJ-RPL-2")
    plan = make_plan(obj)
    old_shift = make_shift(
        plan,
        datetime.datetime(2026, 9, 1, 8, 0, tzinfo=LOCAL_TZ),
        datetime.datetime(2026, 9, 1, 20, 0, tzinfo=LOCAL_TZ),
    )
    project_duty_shift(old_shift)

    new_starts = datetime.datetime(2026, 9, 2, 8, 0, tzinfo=LOCAL_TZ)
    new_ends = datetime.datetime(2026, 9, 2, 20, 0, tzinfo=LOCAL_TZ)

    with clock.override(datetime.date(2026, 8, 1)):
        new_shift = replan_duty_shift(
            old_shift,
            actor="operator",
            reason="Перенос на другой день",
            starts_at=new_starts,
            ends_at=new_ends,
        )

    old_shift.refresh_from_db()
    assert old_shift.cancelled_at is not None
    assert not EmployeeStatus.objects.filter(source_ref=f"DUTY:{old_shift.pk}").exists()

    assert new_shift.pk != old_shift.pk
    assert new_shift.plan_id == plan.pk
    assert new_shift.starts_at == new_starts
    assert new_shift.ends_at == new_ends
    assert EmployeeStatus.objects.filter(source_ref=f"DUTY:{new_shift.pk}").exists()
    assert EmployeeStatus.objects.filter(
        source_ref=f"REST_AFTER_DUTY:{new_shift.pk}"
    ).exists()


def test_replan_duty_shift_inherits_unspecified_fields(status_types):
    obj = make_object("OBJ-RPL-3")
    plan = make_plan(obj)
    post = Post.objects.create(object=obj, code="P-1", name="КПП-1")
    old_shift = make_shift(
        plan,
        datetime.datetime(2026, 9, 1, 8, 0, tzinfo=LOCAL_TZ),
        datetime.datetime(2026, 9, 1, 20, 0, tzinfo=LOCAL_TZ),
        post=post,
        duty_role_code="SENIOR",
        notes="Особые указания",
    )

    with clock.override(datetime.date(2026, 8, 1)):
        new_shift = replan_duty_shift(
            old_shift,
            actor="operator",
            reason="Перенос времени",
            starts_at=datetime.datetime(2026, 9, 1, 9, 0, tzinfo=LOCAL_TZ),
            ends_at=datetime.datetime(2026, 9, 1, 21, 0, tzinfo=LOCAL_TZ),
        )

    assert new_shift.employee_id == old_shift.employee_id
    assert new_shift.post_id == post.pk
    assert new_shift.duty_role_code == "SENIOR"
    assert new_shift.notes == "Особые указания"


def test_replan_duty_shift_rejects_already_cancelled_shift(status_types):
    obj = make_object("OBJ-RPL-4")
    plan = make_plan(obj)
    shift = make_shift(
        plan,
        datetime.datetime(2026, 9, 1, 8, 0, tzinfo=LOCAL_TZ),
        datetime.datetime(2026, 9, 1, 20, 0, tzinfo=LOCAL_TZ),
    )

    with clock.override(datetime.date(2026, 8, 1)):
        from apps.operations.duties.services import cancel_duty_shift

        cancel_duty_shift(shift, actor="operator", reason="Отмена")

        with pytest.raises(DomainError) as exc_info:
            replan_duty_shift(
                shift,
                actor="operator",
                reason="Перепланировать отменённую",
                starts_at=datetime.datetime(2026, 9, 2, 8, 0, tzinfo=LOCAL_TZ),
                ends_at=datetime.datetime(2026, 9, 2, 20, 0, tzinfo=LOCAL_TZ),
            )
    assert exc_info.value.code == "INVALID_LIFECYCLE_TRANSITION"
    assert DutyShift.objects.filter(plan=plan).count() == 1


def test_replan_duty_shift_rejects_already_started_shift(status_types):
    obj = make_object("OBJ-RPL-5")
    plan = make_plan(obj)
    shift = make_shift(
        plan,
        datetime.datetime(2026, 8, 1, 8, 0, tzinfo=LOCAL_TZ),
        datetime.datetime(2026, 8, 1, 20, 0, tzinfo=LOCAL_TZ),
    )
    project_duty_shift(shift)

    with clock.override(datetime.date(2026, 8, 1)):
        with pytest.raises(DomainError) as exc_info:
            replan_duty_shift(
                shift,
                actor="operator",
                reason="Слишком поздно",
                starts_at=datetime.datetime(2026, 9, 1, 8, 0, tzinfo=LOCAL_TZ),
                ends_at=datetime.datetime(2026, 9, 1, 20, 0, tzinfo=LOCAL_TZ),
            )
    assert exc_info.value.code == "INVALID_LIFECYCLE_TRANSITION"
    shift.refresh_from_db()
    assert shift.cancelled_at is None
    assert DutyShift.objects.filter(plan=plan).count() == 1
    assert EmployeeStatus.objects.filter(source_ref=f"DUTY:{shift.pk}").exists()


def test_replan_duty_shift_incompatible_post_rolls_back_old_shift_cancel(status_types):
    obj_a = make_object("OBJ-RPL-6A")
    obj_b = make_object("OBJ-RPL-6B")
    plan = make_plan(obj_a)
    shift = make_shift(
        plan,
        datetime.datetime(2026, 9, 1, 8, 0, tzinfo=LOCAL_TZ),
        datetime.datetime(2026, 9, 1, 20, 0, tzinfo=LOCAL_TZ),
    )
    post_b = Post.objects.create(object=obj_b, code="P-1", name="КПП-1")

    with clock.override(datetime.date(2026, 8, 1)):
        with pytest.raises(ValidationError):
            replan_duty_shift(
                shift,
                actor="operator",
                reason="Смена поста",
                post=post_b,
                starts_at=datetime.datetime(2026, 9, 2, 8, 0, tzinfo=LOCAL_TZ),
                ends_at=datetime.datetime(2026, 9, 2, 20, 0, tzinfo=LOCAL_TZ),
            )

    shift.refresh_from_db()
    assert shift.cancelled_at is None
    assert DutyShift.objects.filter(plan=plan).count() == 1


def test_replan_duty_shift_rejects_unknown_field(status_types):
    obj = make_object("OBJ-RPL-7")
    plan = make_plan(obj)
    shift = make_shift(
        plan,
        datetime.datetime(2026, 9, 1, 8, 0, tzinfo=LOCAL_TZ),
        datetime.datetime(2026, 9, 1, 20, 0, tzinfo=LOCAL_TZ),
    )

    with clock.override(datetime.date(2026, 8, 1)):
        with pytest.raises(DomainError) as exc_info:
            replan_duty_shift(
                shift, actor="operator", reason="Отмена", plan=make_plan(obj, month=9)
            )
    assert exc_info.value.code == "VALIDATION_ERROR"
    assert exc_info.value.http_status == 400
    shift.refresh_from_db()
    assert shift.cancelled_at is None
