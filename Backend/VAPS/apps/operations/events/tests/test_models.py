"""Story 15.1 — SecurityEvent model: DB-level constraint proof (bulk_create
bypasses full_clean(), so this is the only way to prove the CheckConstraint
itself, not just the Python-side choices validation)."""

import pytest
from django.db import IntegrityError, transaction

from apps.operations.events.models import SecurityEvent
from apps.operations.facilities.models import Object as FacilityObject

pytestmark = pytest.mark.django_db


def make_object(code="OBJ-EVT-1"):
    return FacilityObject.objects.create(code=code, name="Штаб", address="г. Кызылорда")


def test_status_code_check_constraint_rejects_invalid_value():
    # bulk_create()/queryset.update() bypass full_clean() — the ONLY thing
    # standing between an invalid status_code and the row is the DB-level
    # CheckConstraint itself, proven here directly (not the Python choices
    # validation, which a raw UPDATE never goes through).
    obj = make_object()
    event = SecurityEvent.objects.create(object=obj, title="ОМ №1", status_code="DRAFT")
    with pytest.raises(IntegrityError), transaction.atomic():
        SecurityEvent.objects.filter(pk=event.pk).update(status_code="NOT_A_REAL_STATUS")


def test_object_protected_from_deletion_when_referenced():
    obj = make_object("OBJ-EVT-2")
    SecurityEvent.objects.create(object=obj, title="ОМ №3")
    with pytest.raises(IntegrityError), transaction.atomic():
        obj.delete()
