"""Story 14.5 — DutyPlan + DutyShift models."""

import datetime
import uuid

import pytest
from django.core.exceptions import ValidationError
from django.db import IntegrityError, transaction

from apps.operations.duties.models import DutyPlan, DutyShift
from apps.operations.facilities.models import DutyType, Object, Post

pytestmark = pytest.mark.django_db


def make_object(code="OBJ-DP-1"):
    return Object.objects.create(code=code, name="Штаб", address="г. Кызылорда, ул. 1")


def make_plan(obj, year=2026, month=8, **kwargs):
    return DutyPlan.objects.create(object=obj, year=year, month=month, **kwargs)


def test_duty_plan_created_with_defaults():
    obj = make_object()
    plan = make_plan(obj)
    assert plan.status_code == "DRAFT"


def test_duty_plan_unique_per_object_year_month():
    obj = make_object("OBJ-DP-2")
    make_plan(obj, year=2026, month=8)
    with pytest.raises(IntegrityError):
        with transaction.atomic():
            make_plan(obj, year=2026, month=8)


def test_duty_plan_same_object_different_month_allowed():
    obj = make_object("OBJ-DP-3")
    make_plan(obj, year=2026, month=8)
    make_plan(obj, year=2026, month=9)
    assert DutyPlan.objects.filter(object=obj).count() == 2


@pytest.mark.parametrize("bad_year", [2025, 2101, 0])
def test_duty_plan_year_out_of_range_rejected_by_db(bad_year):
    obj = make_object(f"OBJ-DP-4-{bad_year}")
    with pytest.raises(IntegrityError):
        with transaction.atomic():
            make_plan(obj, year=bad_year, month=8)


@pytest.mark.parametrize("bad_month", [0, 13, -1])
def test_duty_plan_month_out_of_range_rejected_by_db(bad_month):
    obj = make_object(f"OBJ-DP-5-{bad_month}")
    with pytest.raises(IntegrityError):
        with transaction.atomic():
            make_plan(obj, year=2026, month=bad_month)


def test_duty_plan_status_code_invalid_rejected_by_db():
    obj = make_object("OBJ-DP-6")
    with pytest.raises(IntegrityError):
        with transaction.atomic():
            make_plan(obj, status_code="BOGUS")


def test_duty_plan_status_code_approved_accepted():
    obj = make_object("OBJ-DP-7")
    plan = make_plan(obj, status_code="APPROVED")
    assert plan.status_code == "APPROVED"


def test_deleting_object_cascades_to_duty_plan():
    obj = make_object("OBJ-DP-8")
    plan = make_plan(obj)

    obj.delete()

    assert not DutyPlan.objects.filter(pk=plan.pk).exists()


def make_shift(plan, **kwargs):
    defaults = {
        "employee_id": uuid.uuid4(),
        "starts_at": datetime.datetime(2026, 8, 1, 8, 0, tzinfo=datetime.timezone.utc),
        "ends_at": datetime.datetime(2026, 8, 1, 20, 0, tzinfo=datetime.timezone.utc),
    }
    defaults.update(kwargs)
    return DutyShift.objects.create(plan=plan, **defaults)


def test_duty_shift_created_without_post_or_duty_type():
    obj = make_object("OBJ-DP-9")
    plan = make_plan(obj)
    shift = make_shift(plan)
    assert shift.post is None
    assert shift.duty_type is None


def test_duty_shift_with_post_and_duty_type():
    obj = make_object("OBJ-DP-10")
    plan = make_plan(obj)
    post = Post.objects.create(object=obj, code="P-1", name="КПП-1")
    duty_type = DutyType.objects.create(object=obj, code="DAY", name="Дневное")
    shift = make_shift(plan, post=post, duty_type=duty_type, duty_role_code="SENIOR")
    assert shift.post == post
    assert shift.duty_type == duty_type
    assert shift.duty_role_code == "SENIOR"


def test_deleting_duty_plan_cascades_to_shift():
    obj = make_object("OBJ-DP-11")
    plan = make_plan(obj)
    shift = make_shift(plan)

    plan.delete()

    assert not DutyShift.objects.filter(pk=shift.pk).exists()


def test_deleting_post_with_live_shift_is_protected():
    obj = make_object("OBJ-DP-12")
    plan = make_plan(obj)
    post = Post.objects.create(object=obj, code="P-1", name="КПП-1")
    make_shift(plan, post=post)

    with pytest.raises(IntegrityError):
        with transaction.atomic():
            post.delete()


def test_deleting_duty_type_with_live_shift_is_protected():
    obj = make_object("OBJ-DP-13")
    plan = make_plan(obj)
    duty_type = DutyType.objects.create(object=obj, code="DAY", name="Дневное")
    make_shift(plan, duty_type=duty_type)

    with pytest.raises(IntegrityError):
        with transaction.atomic():
            duty_type.delete()


def test_duty_shift_starts_after_ends_rejected_by_db():
    obj = make_object("OBJ-DP-14")
    plan = make_plan(obj)
    with pytest.raises(IntegrityError):
        with transaction.atomic():
            make_shift(
                plan,
                starts_at=datetime.datetime(
                    2026, 8, 1, 20, 0, tzinfo=datetime.timezone.utc
                ),
                ends_at=datetime.datetime(
                    2026, 8, 1, 8, 0, tzinfo=datetime.timezone.utc
                ),
            )


def test_duty_shift_starts_equal_ends_rejected_by_db():
    obj = make_object("OBJ-DP-15")
    plan = make_plan(obj)
    same = datetime.datetime(2026, 8, 1, 8, 0, tzinfo=datetime.timezone.utc)
    with pytest.raises(IntegrityError):
        with transaction.atomic():
            make_shift(plan, starts_at=same, ends_at=same)


def test_duty_shift_post_from_a_different_object_rejected_by_clean():
    # Same class of cross-FK gap as Post.clean() (14.2)/ChecklistOverride.clean()
    # (14.3): plan.object_id and post.object_id can diverge — no DB
    # CheckConstraint can compare across the two tables.
    obj_a = make_object("OBJ-DP-16A")
    obj_b = make_object("OBJ-DP-16B")
    plan = make_plan(obj_a)
    post_b = Post.objects.create(object=obj_b, code="P-1", name="КПП-1")

    shift = DutyShift(
        plan=plan,
        post=post_b,
        employee_id=uuid.uuid4(),
        starts_at=datetime.datetime(2026, 8, 1, 8, 0, tzinfo=datetime.timezone.utc),
        ends_at=datetime.datetime(2026, 8, 1, 20, 0, tzinfo=datetime.timezone.utc),
    )
    with pytest.raises(ValidationError):
        shift.full_clean()


def test_duty_shift_post_from_the_same_object_passes_clean():
    obj = make_object("OBJ-DP-17")
    plan = make_plan(obj)
    post = Post.objects.create(object=obj, code="P-1", name="КПП-1")

    shift = DutyShift(
        plan=plan,
        post=post,
        employee_id=uuid.uuid4(),
        starts_at=datetime.datetime(2026, 8, 1, 8, 0, tzinfo=datetime.timezone.utc),
        ends_at=datetime.datetime(2026, 8, 1, 20, 0, tzinfo=datetime.timezone.utc),
    )
    shift.full_clean()  # must not raise


def test_duty_shift_without_post_passes_clean():
    obj = make_object("OBJ-DP-18")
    plan = make_plan(obj)

    shift = DutyShift(
        plan=plan,
        employee_id=uuid.uuid4(),
        starts_at=datetime.datetime(2026, 8, 1, 8, 0, tzinfo=datetime.timezone.utc),
        ends_at=datetime.datetime(2026, 8, 1, 20, 0, tzinfo=datetime.timezone.utc),
    )
    shift.full_clean()  # must not raise


def test_duty_shift_duty_type_from_a_different_object_rejected_by_clean():
    # Review (Blind Hunter/Edge Case Hunter, independently confirmed):
    # DutyType is per-object (same shape as Post) — the clean() guard
    # originally only covered post, silently leaving this identical gap
    # unguarded for duty_type.
    obj_a = make_object("OBJ-DP-19A")
    obj_b = make_object("OBJ-DP-19B")
    plan = make_plan(obj_a)
    duty_type_b = DutyType.objects.create(object=obj_b, code="DAY", name="Дневное")

    shift = DutyShift(
        plan=plan,
        duty_type=duty_type_b,
        employee_id=uuid.uuid4(),
        starts_at=datetime.datetime(2026, 8, 1, 8, 0, tzinfo=datetime.timezone.utc),
        ends_at=datetime.datetime(2026, 8, 1, 20, 0, tzinfo=datetime.timezone.utc),
    )
    with pytest.raises(ValidationError):
        shift.full_clean()


def test_duty_shift_duty_type_from_the_same_object_passes_clean():
    obj = make_object("OBJ-DP-20")
    plan = make_plan(obj)
    duty_type = DutyType.objects.create(object=obj, code="DAY", name="Дневное")

    shift = DutyShift(
        plan=plan,
        duty_type=duty_type,
        employee_id=uuid.uuid4(),
        starts_at=datetime.datetime(2026, 8, 1, 8, 0, tzinfo=datetime.timezone.utc),
        ends_at=datetime.datetime(2026, 8, 1, 20, 0, tzinfo=datetime.timezone.utc),
    )
    shift.full_clean()  # must not raise
