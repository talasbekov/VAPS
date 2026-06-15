import datetime as dt

import pytest
from django.core.exceptions import ValidationError
from django.utils import timezone

from apps.core.models import (
    Division, DivisionType, Organization, Position, StaffingSlot,
)

pytestmark = pytest.mark.django_db


@pytest.fixture
def division_and_position():
    org = Organization.objects.create(name="HQ", code="HQ")
    dtp = DivisionType.objects.create(code="management", name="Управление")
    div = Division.objects.create(organization=org, type_code=dtp, name="D", code="D")
    pos = Position.objects.create(code="OPER", name="Опер", level=4)
    return div, pos


def test_create_slot_with_parent(division_and_position):
    div, pos = division_and_position
    parent = StaffingSlot.objects.create(
        division=div, position_code=pos, slot_number="1", valid_from=timezone.now()
    )
    child = StaffingSlot.objects.create(
        division=div, position_code=pos, slot_number="2",
        parent_slot=parent, valid_from=timezone.now(),
    )
    assert child.parent_slot_id == parent.id


def test_valid_to_before_from_rejected(division_and_position):
    div, pos = division_and_position
    now = timezone.now()
    s = StaffingSlot(
        division=div,
        position_code=pos,
        valid_from=now,
        valid_to=now - dt.timedelta(days=1),
    )
    with pytest.raises(ValidationError):
        s.full_clean()
