import datetime as dt

import pytest
from django.core.exceptions import ValidationError
from django.utils import timezone

from apps.core.models import (
    Division, DivisionType, DivisionHistoricalSlot, Organization,
)

pytestmark = pytest.mark.django_db


@pytest.fixture
def division():
    org = Organization.objects.create(name="HQ", code="HQ")
    dtp = DivisionType.objects.create(code="management", name="Управление")
    return Division.objects.create(organization=org, type_code=dtp, name="D", code="D")


def test_create_slot_open_interval(division):
    s = DivisionHistoricalSlot.objects.create(
        division=division, allocated_slots=10, valid_from=timezone.now()
    )
    assert s.valid_to is None


def test_negative_allocated_rejected(division):
    s = DivisionHistoricalSlot(
        division=division, allocated_slots=-1, valid_from=timezone.now()
    )
    with pytest.raises(ValidationError):
        s.full_clean()


def test_valid_to_before_from_rejected(division):
    now = timezone.now()
    s = DivisionHistoricalSlot(
        division=division, allocated_slots=1, valid_from=now, valid_to=now - dt.timedelta(days=1)
    )
    with pytest.raises(ValidationError):
        s.full_clean()
