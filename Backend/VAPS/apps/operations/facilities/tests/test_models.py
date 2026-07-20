"""Model/constraint tests for Facility + FacilityPassport (Story 14.1).

Every chk_*/uq_* constraint gets a transactional red probe: the INSERT must be
rejected by the DATABASE, not by Python-side validation (the DB is the last
owner of these invariants — see the daily_submission canon). Data is seeded
directly (no factory_boy in this project).
"""

import pytest
from django.db import IntegrityError, transaction

from apps.operations.facilities.models import (
    Facility,
    FacilityPassport,
    FacilityPassportHistory,
)

pytestmark = pytest.mark.django_db


def _facility(**overrides):
    fields = {
        "code": "OBJ-1",
        "name": "Резиденция",
        "address": "г. Астана, ул. Первая, 1",
    }
    fields.update(overrides)
    return Facility.objects.create(**fields)


def _expect_integrity_error(constraint_name, **overrides):
    with pytest.raises(IntegrityError) as excinfo:
        with transaction.atomic():
            _facility(**overrides)
    assert constraint_name in str(excinfo.value)


# --- Facility constraints ----------------------------------------------------


def test_create_minimal_facility_defaults():
    facility = _facility()
    assert facility.is_active is True
    assert facility.latitude is None
    assert facility.importance_level_code is None


def test_duplicate_code_rejected_by_db():
    _facility()
    with pytest.raises(IntegrityError) as excinfo:
        with transaction.atomic():
            _facility(name="Другой объект")
    assert "uq_facility_code" in str(excinfo.value)


def test_blank_code_rejected():
    _expect_integrity_error("chk_facility_code_not_blank", code="   ")


def test_blank_name_rejected():
    _expect_integrity_error("chk_facility_name_not_blank", name=" \t ")


def test_blank_address_rejected():
    _expect_integrity_error("chk_facility_address_not_blank", address="  ")


@pytest.mark.parametrize("latitude", ["90.000001", "-90.000001"])
def test_latitude_out_of_range_rejected(latitude):
    _expect_integrity_error("chk_facility_lat_range", latitude=latitude)


@pytest.mark.parametrize("longitude", ["180.000001", "-180.000001"])
def test_longitude_out_of_range_rejected(longitude):
    _expect_integrity_error("chk_facility_lon_range", longitude=longitude)


@pytest.mark.parametrize(
    ("latitude", "longitude"),
    [("90", "-180"), ("-90", "180")],
)
def test_all_four_boundary_coordinates_accepted(latitude, longitude):
    # Both poles and both antimeridian signs: a gt/lt slip on either side of
    # the constraint would reject a legitimate boundary and stay green
    # under one-sided probes.
    facility = _facility(latitude=latitude, longitude=longitude)
    assert facility.pk is not None


def test_duplicate_code_case_insensitive():
    # Lower("code") unique: 'obj-1' after 'OBJ-1' is the same facility.
    _facility()
    with pytest.raises(IntegrityError) as excinfo:
        with transaction.atomic():
            _facility(code="obj-1", name="Дубль в нижнем регистре")
    assert "uq_facility_code" in str(excinfo.value)


# --- FacilityPassport constraints -------------------------------------------


def test_passport_completeness_default_red():
    passport = FacilityPassport.objects.create(facility=_facility())
    assert passport.completeness_status == FacilityPassport.Completeness.RED
    assert passport.access_routes == []
    assert passport.cameras == []


def test_passport_unknown_completeness_rejected_by_db():
    facility = _facility()
    with pytest.raises(IntegrityError) as excinfo:
        with transaction.atomic():
            FacilityPassport.objects.create(
                facility=facility, completeness_status="PURPLE"
            )
    assert "chk_facility_passport_completeness" in str(excinfo.value)


def test_completeness_check_covers_choices():
    # Drift-guard (canon chk_daily_submission_event): the DB CheckConstraint
    # must list exactly Completeness.values — a new choice member added without
    # updating the constraint reddens here.
    for i, value in enumerate(FacilityPassport.Completeness.values):
        passport = FacilityPassport.objects.create(
            facility=_facility(code=f"OBJ-CHK-{i}"),
            completeness_status=value,
        )
        assert passport.completeness_status == value


def test_passport_is_one_to_one():
    facility = _facility()
    FacilityPassport.objects.create(facility=facility)
    with pytest.raises(IntegrityError):
        with transaction.atomic():
            FacilityPassport.objects.create(facility=facility)


# --- Cascade and history -----------------------------------------------------


def test_deleting_facility_cascades_to_passport_and_history():
    # Donor contract (DB-OPS-014/015): passport and history ride the facility.
    # Services expose no delete path (soft-delete only) — this pins the FK
    # topology itself, via raw ORM delete.
    facility = _facility()
    passport = FacilityPassport.objects.create(facility=facility)
    FacilityPassportHistory.objects.create(
        passport=passport,
        changed_by="user-1",
        changed_at="2026-07-20T10:00:00+00:00",
        old_value=None,
        new_value={"vulnerable_places": "тёмный двор"},
    )
    facility.delete()
    assert FacilityPassport.objects.count() == 0
    assert FacilityPassportHistory.objects.count() == 0
