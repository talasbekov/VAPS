"""Story 14.4 — DutyType (per-object duty-type reference)."""

import pytest
from django.db import IntegrityError, transaction

from apps.operations.facilities.models import DutyType, Object

pytestmark = pytest.mark.django_db


def make_object(code="OBJ-DT-1"):
    return Object.objects.create(code=code, name="Штаб", address="г. Кызылорда, ул. 1")


def test_duty_type_created_with_defaults():
    obj = make_object()
    duty_type = DutyType.objects.create(object=obj, code="DAY", name="Дневное")
    assert duty_type.rest_after_minutes == 1440
    assert duty_type.before_duty_minutes == 0
    assert duty_type.requires_reconnaissance is False
    assert duty_type.is_active is True
    assert duty_type.default_duration_minutes is None


def test_code_unique_per_object():
    obj = make_object("OBJ-DT-2")
    DutyType.objects.create(object=obj, code="DAY", name="Дневное")
    with pytest.raises(IntegrityError):
        with transaction.atomic():
            DutyType.objects.create(object=obj, code="DAY", name="Дубль")


def test_code_can_repeat_across_objects():
    obj_a = make_object("OBJ-DT-3A")
    obj_b = make_object("OBJ-DT-3B")
    DutyType.objects.create(object=obj_a, code="DAY", name="Дневное")
    DutyType.objects.create(object=obj_b, code="DAY", name="Дневное")
    assert DutyType.objects.filter(code="DAY").count() == 2


def test_deleting_object_cascades_to_duty_type():
    obj = make_object("OBJ-DT-4")
    duty_type = DutyType.objects.create(object=obj, code="DAY", name="Дневное")

    obj.delete()

    assert not DutyType.objects.filter(pk=duty_type.pk).exists()


@pytest.mark.parametrize("bad_value", [0])
def test_default_duration_minutes_zero_rejected_by_db(bad_value):
    # AC-3: donor's CHECK is strictly > 0 — 0 passes PositiveIntegerField's
    # own implicit >=0 guard, so this proves the NAMED constraint, not the
    # field type's own floor.
    obj = make_object("OBJ-DT-5")
    with pytest.raises(IntegrityError):
        with transaction.atomic():
            DutyType.objects.create(
                object=obj,
                code="DAY",
                name="Дневное",
                default_duration_minutes=bad_value,
            )


def test_default_duration_minutes_null_accepted():
    obj = make_object("OBJ-DT-6")
    duty_type = DutyType.objects.create(
        object=obj, code="DAY", name="Дневное", default_duration_minutes=None
    )
    assert duty_type.default_duration_minutes is None


def test_default_duration_minutes_positive_accepted():
    obj = make_object("OBJ-DT-7")
    duty_type = DutyType.objects.create(
        object=obj, code="DAY", name="Дневное", default_duration_minutes=480
    )
    assert duty_type.default_duration_minutes == 480


def test_rest_after_and_before_duty_minutes_configurable():
    obj = make_object("OBJ-DT-8")
    duty_type = DutyType.objects.create(
        object=obj,
        code="NIGHT",
        name="Ночное",
        rest_after_minutes=2880,
        before_duty_minutes=30,
    )
    assert duty_type.rest_after_minutes == 2880
    assert duty_type.before_duty_minutes == 30


@pytest.mark.parametrize("field", ["rest_after_minutes", "before_duty_minutes"])
def test_rest_after_and_before_duty_minutes_negative_rejected_by_db(field):
    # Review (Edge Case Hunter): the design decision NOT to add a redundant
    # named >=0 CheckConstraint here relies on PositiveIntegerField's own
    # implicit DB-level guard (confirmed by Acceptance Auditor's empirical
    # probe and Edge Case Hunter's Django-source read) — this test makes
    # that reliance verifiable in-suite, not just documented in a comment.
    obj = make_object(f"OBJ-DT-9-{field}")
    with pytest.raises(IntegrityError):
        with transaction.atomic():
            DutyType.objects.create(
                object=obj, code="DAY", name="Дневное", **{field: -1}
            )
