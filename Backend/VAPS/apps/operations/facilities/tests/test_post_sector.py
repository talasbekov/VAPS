"""Story 14.2 — Sector + Post models."""

import pytest
from django.core.exceptions import ValidationError
from django.db import IntegrityError, transaction

from apps.operations.facilities.models import Object, Post, Sector

pytestmark = pytest.mark.django_db


def make_object(code="OBJ-PS-1"):
    return Object.objects.create(code=code, name="Штаб", address="г. Кызылорда, ул. 1")


def test_sector_and_post_created():
    obj = make_object()
    sector = Sector.objects.create(object=obj, name="Периметр")
    post = Post.objects.create(object=obj, sector=sector, code="P-1", name="КПП-1")
    assert post.object == obj
    assert post.sector == sector
    assert post.post_type_code == "FIXED"
    assert post.max_service_minutes == 480


def test_sector_name_unique_per_object():
    obj = make_object("OBJ-PS-2")
    Sector.objects.create(object=obj, name="Периметр")
    with pytest.raises(IntegrityError):
        with transaction.atomic():
            Sector.objects.create(object=obj, name="Периметр")


def test_sector_name_can_repeat_across_objects():
    obj_a = make_object("OBJ-PS-3A")
    obj_b = make_object("OBJ-PS-3B")
    Sector.objects.create(object=obj_a, name="Периметр")
    # Same name, different object — the uniqueness is scoped by object.
    Sector.objects.create(object=obj_b, name="Периметр")
    assert Sector.objects.filter(name="Периметр").count() == 2


def test_post_code_unique_per_object():
    obj = make_object("OBJ-PS-4")
    Post.objects.create(object=obj, code="P-1", name="КПП-1")
    with pytest.raises(IntegrityError):
        with transaction.atomic():
            Post.objects.create(object=obj, code="P-1", name="КПП-1 дубль")


def test_post_without_sector_is_allowed():
    obj = make_object("OBJ-PS-5")
    post = Post.objects.create(object=obj, code="P-1", name="КПП-1")
    assert post.sector is None


def test_deleting_sector_sets_post_sector_to_null_not_deleting_post():
    obj = make_object("OBJ-PS-6")
    sector = Sector.objects.create(object=obj, name="Периметр")
    post = Post.objects.create(object=obj, sector=sector, code="P-1", name="КПП-1")

    sector.delete()

    post.refresh_from_db()
    assert post.sector_id is None
    assert Post.objects.filter(pk=post.pk).exists()


def test_deleting_object_cascades_to_sector_and_post():
    obj = make_object("OBJ-PS-7")
    sector = Sector.objects.create(object=obj, name="Периметр")
    post = Post.objects.create(object=obj, sector=sector, code="P-1", name="КПП-1")

    obj.delete()

    assert not Sector.objects.filter(pk=sector.pk).exists()
    assert not Post.objects.filter(pk=post.pk).exists()


@pytest.mark.parametrize("bad_minutes", [0, 29, 1441, 5000])
def test_max_service_minutes_out_of_range_rejected_by_db(bad_minutes):
    # AC-4: DB CheckConstraint, not just PositiveIntegerField(>0) —
    # .objects.create() skips full_clean().
    obj = make_object("OBJ-PS-8")
    with pytest.raises(IntegrityError):
        with transaction.atomic():
            Post.objects.create(
                object=obj,
                code="P-1",
                name="КПП-1",
                max_service_minutes=bad_minutes,
            )


@pytest.mark.parametrize("good_minutes", [30, 480, 1440])
def test_max_service_minutes_boundary_values_accepted(good_minutes):
    obj = make_object(f"OBJ-PS-9-{good_minutes}")
    post = Post.objects.create(
        object=obj, code="P-1", name="КПП-1", max_service_minutes=good_minutes
    )
    assert post.max_service_minutes == good_minutes


def test_post_extension_fields_default_correctly():
    # DB-OPS-016: is_outdoor/max_continuous_minutes default to NULL (no
    # donor DEFAULT); requires_weapon/requires_special_equipment default
    # False, requires_uniform defaults True (donor gives explicit defaults).
    obj = make_object("OBJ-PS-10")
    post = Post.objects.create(object=obj, code="P-1", name="КПП-1")
    assert post.is_outdoor is None
    assert post.max_continuous_minutes is None
    assert post.min_rating is None
    assert post.requires_weapon is False
    assert post.requires_special_equipment is False
    assert post.requires_uniform is True


def test_requirements_json_stored_without_schema_validation():
    # Scope Decision: requirements is stored as-is, no nested-schema check.
    obj = make_object("OBJ-PS-11")
    payload = {
        "schema_version": 1,
        "min_height_cm": 175,
        "gender": "M",
        "min_rank_index": None,
        "max_rank_index": None,
        "required_position_codes": ["GUARD"],
        "allow_overqualification": True,
        "unexpected_extra_key": "not validated",
    }
    post = Post.objects.create(
        object=obj, code="P-1", name="КПП-1", requirements=payload
    )
    post.refresh_from_db()
    assert post.requirements == payload


def test_sector_sort_order_defaults_to_zero():
    obj = make_object("OBJ-PS-12")
    sector = Sector.objects.create(object=obj, name="Периметр")
    assert sector.sort_order == 0


def test_sector_from_a_different_object_rejected_by_clean():
    # Review (Blind Hunter/Edge Case Hunter, independently confirmed): no DB
    # CheckConstraint can compare Post.object_id against Sector.object_id
    # (different tables) — full_clean() is the enforcement layer.
    obj_a = make_object("OBJ-PS-13A")
    obj_b = make_object("OBJ-PS-13B")
    sector_b = Sector.objects.create(object=obj_b, name="Периметр")

    post = Post(object=obj_a, sector=sector_b, code="P-1", name="КПП-1")
    with pytest.raises(ValidationError):
        post.full_clean()


def test_sector_from_the_same_object_passes_clean():
    obj = make_object("OBJ-PS-14")
    sector = Sector.objects.create(object=obj, name="Периметр")
    post = Post(object=obj, sector=sector, code="P-1", name="КПП-1")
    post.full_clean()  # must not raise
