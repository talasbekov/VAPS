"""Story 16.3a — `SecurityEvent.starts_at`/`ends_at`: FR-25 conflict-detector
prerequisite (nullable retrofit onto Epic 15's model + full_clean()-only
ordering guard)."""

import datetime

import pytest
from django.core.exceptions import ValidationError
from django.utils import timezone

from apps.operations.events.models import SecurityEvent
from apps.operations.facilities.models import Object as FacilityObject

pytestmark = pytest.mark.django_db


def make_object(code="OBJ-SCHED-1"):
    return FacilityObject.objects.create(code=code, name="Штаб", address="г. Кызылорда")


def test_create_without_schedule_fields_is_still_valid():
    event = SecurityEvent.objects.create(object=make_object(), title="ОМ")
    assert event.starts_at is None
    assert event.ends_at is None
    event.full_clean(exclude=["object"])  # must not raise


def test_valid_interval_passes_full_clean():
    now = timezone.now()
    event = SecurityEvent(
        object=make_object("OBJ-SCHED-2"),
        title="ОМ",
        starts_at=now,
        ends_at=now + datetime.timedelta(hours=8),
    )
    event.full_clean(exclude=["object"])  # must not raise


def test_starts_at_after_ends_at_is_rejected():
    now = timezone.now()
    event = SecurityEvent(
        object=make_object("OBJ-SCHED-3"),
        title="ОМ",
        starts_at=now + datetime.timedelta(hours=8),
        ends_at=now,
    )
    with pytest.raises(ValidationError):
        event.full_clean(exclude=["object"])


def test_starts_at_equal_ends_at_is_rejected():
    now = timezone.now()
    event = SecurityEvent(
        object=make_object("OBJ-SCHED-4"),
        title="ОМ",
        starts_at=now,
        ends_at=now,
    )
    with pytest.raises(ValidationError):
        event.full_clean(exclude=["object"])


def test_only_starts_at_set_does_not_raise():
    event = SecurityEvent(
        object=make_object("OBJ-SCHED-5"), title="ОМ", starts_at=timezone.now()
    )
    event.full_clean(exclude=["object"])  # must not raise — no pair to compare


def test_only_ends_at_set_does_not_raise():
    event = SecurityEvent(
        object=make_object("OBJ-SCHED-6"), title="ОМ", ends_at=timezone.now()
    )
    event.full_clean(exclude=["object"])  # must not raise — no pair to compare
