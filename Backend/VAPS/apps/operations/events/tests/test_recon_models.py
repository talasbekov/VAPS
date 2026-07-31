"""Story 15.3a — SecurityEventChecklistItem/SecurityEventSectorPost: model
smoke + DB-level constraint proof (bulk_create/update() bypasses
full_clean(), so this is the only way to prove the CheckConstraint itself,
not just the Python-side choices validation). Mirrors Story 15.1's
test_models.py pattern."""

import pytest
from django.db import IntegrityError, transaction

from apps.operations.events.models import (
    SecurityEvent,
    SecurityEventChecklistItem,
    SecurityEventSectorPost,
)
from apps.operations.facilities.models import Object as FacilityObject

pytestmark = pytest.mark.django_db


def make_event(code="OBJ-RECON-1"):
    obj = FacilityObject.objects.create(code=code, name="Штаб", address="г. Кызылорда")
    return SecurityEvent.objects.create(object=obj, title="ОМ")


def test_checklist_item_db_table():
    assert (
        SecurityEventChecklistItem._meta.db_table
        == "ops_security_event_checklist_items"
    )


def test_sector_post_db_table():
    assert SecurityEventSectorPost._meta.db_table == "ops_security_event_sector_posts"


def test_checklist_item_result_nullable_and_persists():
    event = make_event("OBJ-RECON-2")
    item = SecurityEventChecklistItem.objects.create(
        event=event, label="Проверка периметра"
    )
    assert item.result is None
    item.result = "NEEDS_CHANGES"
    item.save(update_fields=["result"])
    item.refresh_from_db()
    assert item.result == "NEEDS_CHANGES"


def test_checklist_item_result_check_constraint_rejects_invalid_value():
    event = make_event("OBJ-RECON-3")
    item = SecurityEventChecklistItem.objects.create(event=event, label="Пункт")
    with pytest.raises(IntegrityError), transaction.atomic():
        SecurityEventChecklistItem.objects.filter(pk=item.pk).update(
            result="NOT_A_REAL_RESULT"
        )


def test_sector_post_result_check_constraint_rejects_invalid_value():
    event = make_event("OBJ-RECON-4")
    row = SecurityEventSectorPost.objects.create(
        event=event, sector="A", post="Пост 1", need=2
    )
    with pytest.raises(IntegrityError), transaction.atomic():
        SecurityEventSectorPost.objects.filter(pk=row.pk).update(
            result="NOT_A_REAL_RESULT"
        )


def test_deleting_event_cascades_to_checklist_and_sector_posts():
    event = make_event("OBJ-RECON-5")
    SecurityEventChecklistItem.objects.create(event=event, label="Пункт")
    SecurityEventSectorPost.objects.create(
        event=event, sector="A", post="Пост 1", need=1
    )
    event.delete()
    assert not SecurityEventChecklistItem.objects.exists()
    assert not SecurityEventSectorPost.objects.exists()
