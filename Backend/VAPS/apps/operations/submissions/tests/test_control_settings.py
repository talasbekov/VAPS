import uuid
from datetime import time

import pytest
from django.db import IntegrityError, transaction

from apps.operations.submissions.models import SubmissionControlSettings
from apps.operations.submissions.selectors import (
    SubmissionControlSettingsSelector,
)

pytestmark = pytest.mark.django_db


def test_default_row_seeded_by_migration():
    # Review DN-1: the singleton exists at rest (migration 0001 seed), without
    # any selector call writing it.
    row = SubmissionControlSettings.objects.get(singleton_key=1)
    assert row.control_hour == time(17, 0)
    assert row.required_division_ids == []
    assert row.created_by == "system"


def test_default_control_hour_and_empty_required():
    # AC-2: selector returns the 17:00 default.
    assert SubmissionControlSettingsSelector.control_hour() == time(17, 0)
    assert SubmissionControlSettingsSelector.required_division_ids() == []


def test_singleton_key_must_be_one():
    # Review P-1: CheckConstraint pins the key to 1 — a key != 1 is rejected.
    with pytest.raises(IntegrityError):
        with transaction.atomic():
            SubmissionControlSettings.objects.create(singleton_key=2)


def test_selector_is_idempotent_singleton():
    first = SubmissionControlSettingsSelector.get()
    second = SubmissionControlSettingsSelector.get()
    assert first.pk == second.pk
    assert SubmissionControlSettings.objects.count() == 1


def test_second_row_violates_singleton():
    SubmissionControlSettingsSelector.get()  # materialise the first row
    # AC-1: the unique singleton_key forbids a second settings row.
    with pytest.raises(IntegrityError):
        with transaction.atomic():
            SubmissionControlSettings.objects.create(singleton_key=1)


def test_required_division_ids_roundtrip():
    # AC-2/AC-3: three required-division UUIDs are stored and read back.
    ids = [uuid.uuid4() for _ in range(3)]
    settings_row = SubmissionControlSettingsSelector.get()
    settings_row.required_division_ids = ids
    settings_row.save()
    assert SubmissionControlSettingsSelector.required_division_ids() == ids


def test_control_hour_is_configurable():
    settings_row = SubmissionControlSettingsSelector.get()
    settings_row.control_hour = time(9, 0)
    settings_row.save()
    assert SubmissionControlSettingsSelector.control_hour() == time(9, 0)


# ═══ Story 13.5a — alert_hour / alert_threshold_pct ═══


def test_default_alert_hour_and_threshold():
    # AC-1: 15:30/50% defaults ("половина к 15:30", epics.md#L1386).
    assert SubmissionControlSettingsSelector.alert_hour() == time(15, 30)
    assert SubmissionControlSettingsSelector.alert_threshold_pct() == 50


def test_alert_hour_and_threshold_are_configurable():
    settings_row = SubmissionControlSettingsSelector.get()
    settings_row.alert_hour = time(12, 0)
    settings_row.alert_threshold_pct = 75
    settings_row.save()
    assert SubmissionControlSettingsSelector.alert_hour() == time(12, 0)
    assert SubmissionControlSettingsSelector.alert_threshold_pct() == 75


@pytest.mark.parametrize("bad_pct", [0, -1, 101, 1000])
def test_alert_threshold_pct_out_of_range_rejected_by_db(bad_pct):
    # AC-2: DB CheckConstraint, not application validation — .objects.create()
    # skips full_clean(), so this must be a real IntegrityError, not a ValueError.
    # The migration-seeded singleton_key=1 row is deleted first so the failure
    # is provably the range constraint, not the singleton uniqueness constraint
    # (mirror test_second_row_violates_singleton's isolation concern).
    SubmissionControlSettings.objects.all().delete()
    with pytest.raises(IntegrityError):
        with transaction.atomic():
            SubmissionControlSettings.objects.create(
                singleton_key=1, alert_threshold_pct=bad_pct
            )


@pytest.mark.parametrize("good_pct", [1, 50, 100])
def test_alert_threshold_pct_boundary_values_accepted(good_pct):
    settings_row = SubmissionControlSettingsSelector.get()
    settings_row.alert_threshold_pct = good_pct
    settings_row.save()
    assert SubmissionControlSettingsSelector.alert_threshold_pct() == good_pct
