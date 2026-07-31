import pytest
from django.db import IntegrityError, transaction

from apps.operations.facilities.models import Object, ObjectPassport

pytestmark = pytest.mark.django_db


def make_object(code="OBJ-1"):
    return Object.objects.create(code=code, name="Штаб", address="г. Кызылорда, ул. 1")


def test_object_and_passport_created():
    obj = make_object()
    passport = ObjectPassport.objects.create(
        object=obj, vulnerable_places="слепая зона у восточного входа"
    )
    assert obj.passport == passport
    assert passport.completeness_status == ObjectPassport.CompletenessStatus.RED


def test_object_code_unique():
    make_object("OBJ-DUP")
    with pytest.raises(IntegrityError):
        with transaction.atomic():
            make_object("OBJ-DUP")


def test_passport_is_one_to_one_per_object():
    obj = make_object()
    ObjectPassport.objects.create(object=obj)
    with pytest.raises(IntegrityError):
        with transaction.atomic():
            ObjectPassport.objects.create(object=obj)


@pytest.mark.parametrize("bad_status", ["", "PURPLE", "red", "green "])
def test_completeness_status_out_of_range_rejected_by_db(bad_status):
    # AC-6: DB CheckConstraint, not application validation —
    # .objects.create() skips full_clean().
    obj = make_object()
    with pytest.raises(IntegrityError):
        with transaction.atomic():
            ObjectPassport.objects.create(object=obj, completeness_status=bad_status)


@pytest.mark.parametrize("good_status", ["RED", "YELLOW", "GREEN"])
def test_completeness_status_valid_values_accepted(good_status):
    obj = make_object()
    passport = ObjectPassport.objects.create(
        object=obj, completeness_status=good_status
    )
    assert passport.completeness_status == good_status


def test_structural_jsonb_fields_default_to_empty_list():
    obj = make_object()
    passport = ObjectPassport.objects.create(object=obj)
    assert passport.access_routes == []
    assert passport.cameras == []


@pytest.mark.parametrize(
    "latitude,longitude",
    [(-90.000001, 0), (90.000001, 0), (0, -180.000001), (0, 180.000001)],
)
def test_object_lat_long_out_of_range_rejected_by_db(latitude, longitude):
    # Review (Blind Hunter/Edge Case Hunter): DB CheckConstraint, not just
    # DecimalField bounds — .objects.create() skips full_clean().
    with pytest.raises(IntegrityError):
        with transaction.atomic():
            Object.objects.create(
                code="OBJ-LATLONG",
                name="x",
                address="x",
                latitude=latitude,
                longitude=longitude,
            )


@pytest.mark.parametrize(
    "latitude,longitude", [(-90, -180), (90, 180), (0, 0), (None, None)]
)
def test_object_lat_long_boundary_and_null_values_accepted(latitude, longitude):
    obj = Object.objects.create(
        code=f"OBJ-OK-{latitude}-{longitude}",
        name="x",
        address="x",
        latitude=latitude,
        longitude=longitude,
    )
    obj.refresh_from_db()
    assert obj.latitude == (None if latitude is None else latitude)
    assert obj.longitude == (None if longitude is None else longitude)


def test_deleting_object_with_passport_is_protected_not_cascaded():
    # Review (Edge Case Hunter): Object.is_active signals the deactivation
    # path is a flag flip, not a hard delete — PROTECT, not CASCADE.
    from django.db.models import ProtectedError

    obj = make_object("OBJ-PROTECTED")
    ObjectPassport.objects.create(object=obj)
    with pytest.raises(ProtectedError):
        obj.delete()
    assert Object.objects.filter(code="OBJ-PROTECTED").exists()


def test_importance_level_code_is_plain_field_not_fk():
    # Scope Decision: importance_level_code is a plain CharField until
    # ops_event_levels (Epic 15) exists — any string is accepted, no FK
    # validation.
    obj = Object.objects.create(
        code="OBJ-2",
        name="Пост",
        address="адрес",
        importance_level_code="anything-goes-for-now",
    )
    obj.refresh_from_db()
    assert obj.importance_level_code == "anything-goes-for-now"
