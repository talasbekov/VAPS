import datetime as dt

import pytest
from django.core.exceptions import ValidationError
from django.utils import timezone

from apps.core.models import (
    Division, DivisionType, Employee, EmployeeStaffingAssignment,
    Organization, Position, StaffingSlot,
)

pytestmark = pytest.mark.django_db


@pytest.fixture
def slot_and_employee():
    org = Organization.objects.create(name="HQ", code="HQ")
    dtp = DivisionType.objects.create(code="management", name="Управление")
    div = Division.objects.create(organization=org, type_code=dtp, name="D", code="D")
    pos = Position.objects.create(code="OPER", name="Опер")
    slot = StaffingSlot.objects.create(division=div, position_code=pos, valid_from=timezone.now())
    emp = Employee.objects.create(
        iin="900101300500", full_name="X", rank_code="MAJOR", position_code="OPER", division=div
    )
    return slot, emp


def test_create_assignment(slot_and_employee):
    slot, emp = slot_and_employee
    a = EmployeeStaffingAssignment.objects.create(
        employee=emp, staffing_slot=slot, starts_at=timezone.now()
    )
    assert a.ends_at is None


def test_starts_after_ends_rejected(slot_and_employee):
    slot, emp = slot_and_employee
    now = timezone.now()
    a = EmployeeStaffingAssignment(
        employee=emp, staffing_slot=slot, starts_at=now, ends_at=now - dt.timedelta(days=1)
    )
    with pytest.raises(ValidationError):
        a.full_clean()
