import datetime as dt

import pytest
from django.utils import timezone

from apps.core.models import (
    Division, DivisionType, Employee, EmployeeStaffingAssignment,
    Organization, Position, StaffingSlot, Vacancy,
)
from apps.core.services import compute_free_slots

pytestmark = pytest.mark.django_db


@pytest.fixture
def division():
    org = Organization.objects.create(name="HQ", code="HQ")
    dtp = DivisionType.objects.create(code="management", name="Управление")
    pos = Position.objects.create(code="OPER", name="Опер")
    div = Division.objects.create(organization=org, type_code=dtp, name="D", code="D")
    return div, pos


def test_vacancy_status_default_open(division):
    div, pos = division
    slot = StaffingSlot.objects.create(division=div, position_code=pos, valid_from=timezone.now())
    v = Vacancy.objects.create(staffing_slot=slot, opened_at=timezone.now())
    assert v.status_code == "OPEN"


def test_compute_free_slots_excludes_occupied(division):
    div, pos = division
    past = timezone.now() - dt.timedelta(days=30)
    free_slot = StaffingSlot.objects.create(division=div, position_code=pos, valid_from=past)
    busy_slot = StaffingSlot.objects.create(division=div, position_code=pos, valid_from=past)
    emp = Employee.objects.create(
        iin="900101300600", full_name="X", rank_code="MAJOR", position_code="OPER", division=div
    )
    EmployeeStaffingAssignment.objects.create(
        employee=emp, staffing_slot=busy_slot, starts_at=past
    )
    free = compute_free_slots(div.id, on_date=timezone.now())
    free_ids = {s.id for s in free}
    assert free_slot.id in free_ids
    assert busy_slot.id not in free_ids
