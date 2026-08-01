"""Story 16.3c — `CoreEmployeeSelector.operational_profile_for()` tests
(FR-25's post-requirement conflict check reads this)."""

import pytest

from apps.core.models import (
    Division,
    DivisionType,
    Employee,
    EmployeeOperationalProfile,
    Organization,
)
from apps.core.selectors import CoreEmployeeSelector

pytestmark = pytest.mark.django_db


@pytest.fixture
def division():
    org = Organization.objects.create(name="OP", code="OP")
    dtp = DivisionType.objects.create(code="op-dept", name="Отдел")
    return Division.objects.create(
        organization=org, type_code=dtp, name="OP", code="OP"
    )


def make_employee(
    division, iin, rank_index=3, position_code="GUARD", gender="M", height_cm=180
):
    return Employee.objects.create(
        iin=iin,
        full_name="Иванов",
        rank_code="CAPT",
        rank_index=rank_index,
        position_code=position_code,
        gender=gender,
        height_cm=height_cm,
        division=division,
    )


def test_returns_profile_fields_when_row_exists(division):
    emp = make_employee(division, "900101300501")
    EmployeeOperationalProfile.objects.create(
        employee=emp,
        has_weapon_permit=True,
        has_uniform_issued=True,
        has_special_equipment=False,
    )

    result = CoreEmployeeSelector.operational_profile_for([emp.id])

    assert result[emp.id] == {
        "rank_index": 3,
        "position_code": "GUARD",
        "gender": "M",
        "height_cm": 180,
        "has_weapon_permit": True,
        "has_uniform_issued": True,
        "has_special_equipment": False,
    }


def test_missing_operational_profile_row_returns_none_booleans(division):
    emp = make_employee(division, "900101300502")

    result = CoreEmployeeSelector.operational_profile_for([emp.id])

    assert result[emp.id]["rank_index"] == 3
    assert result[emp.id]["has_weapon_permit"] is None
    assert result[emp.id]["has_uniform_issued"] is None
    assert result[emp.id]["has_special_equipment"] is None


def test_empty_input_returns_empty_dict():
    assert CoreEmployeeSelector.operational_profile_for([]) == {}


def test_batch_query_covers_multiple_employees(division):
    emp1 = make_employee(division, "900101300503")
    emp2 = make_employee(division, "900101300504", rank_index=7)
    EmployeeOperationalProfile.objects.create(employee=emp1, has_weapon_permit=True)

    result = CoreEmployeeSelector.operational_profile_for([emp1.id, emp2.id])

    assert result[emp1.id]["has_weapon_permit"] is True
    assert result[emp2.id]["has_weapon_permit"] is None
    assert result[emp2.id]["rank_index"] == 7
