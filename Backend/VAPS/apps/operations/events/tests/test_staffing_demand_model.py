"""Story 15.5a — SecurityEventStaffingDemand: model smoke + CASCADE proof."""

import pytest

from apps.operations.events.models import SecurityEvent, SecurityEventStaffingDemand
from apps.operations.facilities.models import Object as FacilityObject

pytestmark = pytest.mark.django_db


def make_event(code="OBJ-DEMAND-1"):
    obj = FacilityObject.objects.create(code=code, name="Штаб", address="г. Кызылорда")
    return SecurityEvent.objects.create(object=obj, title="ОМ")


def test_db_table():
    assert (
        SecurityEventStaffingDemand._meta.db_table
        == "ops_security_event_staffing_demands"
    )


def test_create_and_persist():
    event = make_event("OBJ-DEMAND-2")
    row = SecurityEventStaffingDemand.objects.create(
        event=event, sector="A", group="Кинология", need=3
    )
    row.refresh_from_db()
    assert row.sector == "A"
    assert row.group == "Кинология"
    assert row.need == 3


def test_deleting_event_cascades():
    event = make_event("OBJ-DEMAND-3")
    SecurityEventStaffingDemand.objects.create(event=event, sector="A", need=1)
    event.delete()
    assert not SecurityEventStaffingDemand.objects.exists()
