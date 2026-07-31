"""Story 14.10 — EmployeeOperationalProfile (FR-3 operational card block)."""

import datetime

import pytest
from django.db import IntegrityError, transaction
from django.db.models import ProtectedError

from apps.core.models import (
    Division,
    DivisionType,
    Employee,
    EmployeeOperationalProfile,
    Organization,
)

pytestmark = pytest.mark.django_db

_IIN = iter(f"9001016{n:05d}" for n in range(1, 9999))


@pytest.fixture
def division():
    org = Organization.objects.create(name="Главк", code="HQ")
    dt = DivisionType.objects.create(code="management", name="Управление")
    return Division.objects.create(
        organization=org, type_code=dt, name="УВД", code="UVD"
    )


def make_employee(division, **kw):
    return Employee.objects.create(
        iin=next(_IIN),
        full_name="Т",
        rank_code="MAJOR",
        position_code="OPER",
        division=division,
        **kw,
    )


def test_created_with_defaults(division):
    emp = make_employee(division)
    profile = EmployeeOperationalProfile.objects.create(employee=emp)
    assert profile.weight_kg is None
    assert profile.clearance_level == ""
    assert profile.has_weapon_permit is False
    assert profile.weapon_permit_expires_at is None
    assert profile.has_uniform_issued is False
    assert profile.has_special_equipment is False
    assert profile.known_object_codes == []


def test_all_fields_stored(division):
    emp = make_employee(division)
    profile = EmployeeOperationalProfile.objects.create(
        employee=emp,
        weight_kg=80,
        clearance_level="SECRET",
        has_weapon_permit=True,
        weapon_permit_expires_at=datetime.date(2027, 1, 1),
        has_uniform_issued=True,
        has_special_equipment=True,
        known_object_codes=["OBJ-1", "OBJ-2"],
    )
    profile.refresh_from_db()
    assert profile.weight_kg == 80
    assert profile.clearance_level == "SECRET"
    assert profile.weapon_permit_expires_at == datetime.date(2027, 1, 1)
    assert profile.known_object_codes == ["OBJ-1", "OBJ-2"]


def test_weapon_permit_expiry_without_permit_rejected_by_db(division):
    emp = make_employee(division)
    with pytest.raises(IntegrityError):
        with transaction.atomic():
            EmployeeOperationalProfile.objects.create(
                employee=emp,
                has_weapon_permit=False,
                weapon_permit_expires_at=datetime.date(2027, 1, 1),
            )


def test_weapon_permit_expiry_with_permit_accepted(division):
    emp = make_employee(division)
    profile = EmployeeOperationalProfile.objects.create(
        employee=emp,
        has_weapon_permit=True,
        weapon_permit_expires_at=datetime.date(2027, 1, 1),
    )
    assert profile.weapon_permit_expires_at == datetime.date(2027, 1, 1)


def test_no_expiry_without_permit_accepted(division):
    emp = make_employee(division)
    profile = EmployeeOperationalProfile.objects.create(
        employee=emp, has_weapon_permit=False
    )
    assert profile.weapon_permit_expires_at is None


def test_second_profile_for_same_employee_rejected_by_db(division):
    emp = make_employee(division)
    EmployeeOperationalProfile.objects.create(employee=emp)
    with pytest.raises(IntegrityError):
        with transaction.atomic():
            EmployeeOperationalProfile.objects.create(employee=emp)


def test_deleting_employee_with_live_profile_is_protected(division):
    emp = make_employee(division)
    EmployeeOperationalProfile.objects.create(employee=emp)
    with pytest.raises(ProtectedError):
        emp.delete()
