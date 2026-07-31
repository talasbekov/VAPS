"""Story 15.7a — GroupForceRequest: model smoke + DB-level constraint proof."""

import pytest
from django.db import IntegrityError, transaction

from apps.operations.events.models import Group, GroupForceRequest, SecurityEvent
from apps.operations.facilities.models import Object as FacilityObject

pytestmark = pytest.mark.django_db


def make_event(code="OBJ-FORCEREQ-1"):
    obj = FacilityObject.objects.create(code=code, name="Штаб", address="г. Кызылорда")
    return SecurityEvent.objects.create(object=obj, title="ОМ")


def make_group(code="DOGS"):
    return Group.objects.create(code=code, name="Кинология")


def test_db_table():
    assert GroupForceRequest._meta.db_table == "ops_group_force_requests"


def test_create_and_persist():
    event = make_event()
    group = make_group()
    row = GroupForceRequest.objects.create(event=event, group=group, requested_count=5)
    row.refresh_from_db()
    assert row.status == "NOT_SENT"
    assert row.allocated_count == 0
    assert row.requested_count == 5


def test_unique_together_event_group_rejects_duplicate():
    event = make_event("OBJ-FORCEREQ-2")
    group = make_group("DOGS2")
    GroupForceRequest.objects.create(event=event, group=group, requested_count=1)
    with pytest.raises(IntegrityError), transaction.atomic():
        GroupForceRequest.objects.create(event=event, group=group, requested_count=2)


def test_status_check_constraint_rejects_invalid_value():
    event = make_event("OBJ-FORCEREQ-3")
    group = make_group("DOGS3")
    row = GroupForceRequest.objects.create(event=event, group=group)
    with pytest.raises(IntegrityError), transaction.atomic():
        GroupForceRequest.objects.filter(pk=row.pk).update(status="NOT_A_REAL_STATUS")


def test_deleting_event_cascades():
    event = make_event("OBJ-FORCEREQ-4")
    group = make_group("DOGS4")
    GroupForceRequest.objects.create(event=event, group=group)
    event.delete()
    assert not GroupForceRequest.objects.exists()


def test_deleting_group_is_protected():
    event = make_event("OBJ-FORCEREQ-5")
    group = make_group("DOGS5")
    GroupForceRequest.objects.create(event=event, group=group)
    with pytest.raises(IntegrityError), transaction.atomic():
        group.delete()
