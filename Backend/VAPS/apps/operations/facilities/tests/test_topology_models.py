"""Model/constraint tests for Sector + Post + PostType (14.2, AC-5).

Every constraint gets a transactional red probe at BOTH boundaries (14.1
coordinate lesson: one-sided probes let gt/lt slips stay green).
"""

import pytest
from django.db import IntegrityError, transaction

from apps.operations.facilities.models import (
    Facility,
    Post,
    PostType,
    Sector,
)

pytestmark = pytest.mark.django_db


@pytest.fixture
def facility():
    return Facility.objects.create(code="OBJ-1", name="Резиденция", address="а")


@pytest.fixture
def fixed_type():
    return PostType.objects.get_or_create(code="FIXED", defaults={"name": "Пост"})[0]


def _post(facility, fixed_type, **overrides):
    fields = {
        "facility": facility,
        "code": "P-1",
        "name": "Пост №1",
        "post_type": fixed_type,
    }
    fields.update(overrides)
    return Post.objects.create(**fields)


# --- Sector ------------------------------------------------------------------


def test_sector_defaults(facility):
    sector = Sector.objects.create(facility=facility, name="Периметр")
    assert sector.sort_order == 0
    assert sector.is_active is True


def test_sector_name_unique_per_facility_case_insensitive(facility):
    Sector.objects.create(facility=facility, name="Периметр")
    with pytest.raises(IntegrityError) as excinfo:
        with transaction.atomic():
            Sector.objects.create(facility=facility, name="ПЕРИМЕТР")
    assert "uq_sector_facility_name" in str(excinfo.value)


def test_partial_unique_frees_name_of_inactive_sector(facility):
    # uq_* — partial (is_active=True): неактивная строка не скваттит имя.
    Sector.objects.create(facility=facility, name="Периметр", is_active=False)
    assert Sector.objects.create(facility=facility, name="Периметр").pk


def test_same_sector_name_on_other_facility_allowed(facility):
    other = Facility.objects.create(code="OBJ-2", name="Другой", address="б")
    Sector.objects.create(facility=facility, name="Периметр")
    sector = Sector.objects.create(facility=other, name="Периметр")
    assert sector.pk is not None


def test_sector_blank_name_rejected(facility):
    with pytest.raises(IntegrityError) as excinfo:
        with transaction.atomic():
            Sector.objects.create(facility=facility, name="   ")
    assert "chk_sector_name_not_blank" in str(excinfo.value)


def test_sector_negative_sort_order_rejected(facility):
    with pytest.raises(IntegrityError) as excinfo:
        with transaction.atomic():
            Sector.objects.create(facility=facility, name="С", sort_order=-1)
    assert "chk_sector_sort_order_min" in str(excinfo.value)


def test_sector_zero_sort_order_accepted(facility):
    assert Sector.objects.create(facility=facility, name="С", sort_order=0).pk


# --- Post --------------------------------------------------------------------


def test_post_defaults(facility, fixed_type):
    post = _post(facility, fixed_type)
    assert post.max_service_minutes == 480
    assert post.requirements == {"schema_version": 1}
    assert post.requires_uniform is True
    assert post.requires_weapon is False
    assert post.is_outdoor is None
    assert post.sector is None


def test_post_code_unique_per_facility_case_insensitive(facility, fixed_type):
    _post(facility, fixed_type)
    with pytest.raises(IntegrityError) as excinfo:
        with transaction.atomic():
            _post(facility, fixed_type, code="p-1", name="Дубль")
    assert "uq_post_facility_code" in str(excinfo.value)


def test_same_post_code_on_other_facility_allowed(facility, fixed_type):
    other = Facility.objects.create(code="OBJ-2", name="Другой", address="б")
    _post(facility, fixed_type)
    assert _post(other, fixed_type).pk is not None


@pytest.mark.parametrize("minutes", [29, 1441])
def test_post_service_minutes_out_of_range_rejected(facility, fixed_type, minutes):
    with pytest.raises(IntegrityError) as excinfo:
        with transaction.atomic():
            _post(facility, fixed_type, max_service_minutes=minutes)
    assert "chk_post_service_minutes_range" in str(excinfo.value)


@pytest.mark.parametrize("minutes", [30, 1440])
def test_post_service_minutes_boundaries_accepted(facility, fixed_type, minutes):
    assert _post(facility, fixed_type, max_service_minutes=minutes).pk


@pytest.mark.parametrize("minutes", [0, -5])
def test_post_continuous_minutes_floor_rejected(facility, fixed_type, minutes):
    with pytest.raises(IntegrityError) as excinfo:
        with transaction.atomic():
            _post(facility, fixed_type, max_continuous_minutes=minutes)
    assert "chk_post_continuous_minutes_min" in str(excinfo.value)


def test_post_continuous_minutes_one_and_null_accepted(facility, fixed_type):
    assert _post(facility, fixed_type, max_continuous_minutes=1).pk
    assert _post(
        facility, fixed_type, code="P-2", max_continuous_minutes=None
    ).pk


def test_post_negative_rating_rejected(facility, fixed_type):
    with pytest.raises(IntegrityError) as excinfo:
        with transaction.atomic():
            _post(facility, fixed_type, min_rating="-0.1")
    assert "chk_post_min_rating_min" in str(excinfo.value)


def test_post_zero_rating_accepted(facility, fixed_type):
    assert _post(facility, fixed_type, min_rating="0").pk


@pytest.mark.parametrize(
    ("field", "constraint"),
    [("code", "chk_post_code_not_blank"), ("name", "chk_post_name_not_blank")],
)
def test_post_blank_identity_rejected(facility, fixed_type, field, constraint):
    with pytest.raises(IntegrityError) as excinfo:
        with transaction.atomic():
            _post(facility, fixed_type, **{field: " \t "})
    assert constraint in str(excinfo.value)


def test_post_type_protected_from_delete(facility, fixed_type):
    from django.db.models import ProtectedError

    _post(facility, fixed_type)
    with pytest.raises(ProtectedError):
        fixed_type.delete()


def test_deleting_facility_cascades_to_topology(facility, fixed_type):
    sector = Sector.objects.create(facility=facility, name="Периметр")
    _post(facility, fixed_type, sector=sector)
    facility.delete()
    assert Sector.objects.count() == 0
    assert Post.objects.count() == 0


def test_deleting_sector_sets_post_sector_null(facility, fixed_type):
    # DB-level SET_NULL (donor contract); the SERVICE path never deletes —
    # deactivate_sector unties via UPDATE (Д6) — this pins the FK topology.
    sector = Sector.objects.create(facility=facility, name="Периметр")
    post = _post(facility, fixed_type, sector=sector)
    sector.delete()
    post.refresh_from_db()
    assert post.sector is None
