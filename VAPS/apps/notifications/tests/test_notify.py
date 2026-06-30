"""Tests for the notification primitive (Story 5.7a).

The Notification model (one-per-day via UniqueConstraint) and the idempotent,
on-commit notify() service. No lagging detection (5.7b), no API (5.7c), no WS
delivery (E11). on_commit callbacks only fire under
``django_capture_on_commit_callbacks`` (the django_db test transaction never
really commits).
"""

from datetime import date

import pytest
from django.db import IntegrityError, transaction

from apps.notifications.models import Notification
from apps.notifications.services import notify

pytestmark = pytest.mark.django_db

DAY = date(2026, 6, 5)
KIND = Notification.Kind.SUBMISSION_LAGGING


# --- model: one notification per (recipient, kind, business_date) -------------


def test_one_notification_per_recipient_kind_date():
    Notification.objects.create(recipient="boss", kind=KIND, business_date=DAY)
    with pytest.raises(IntegrityError):
        with transaction.atomic():
            Notification.objects.create(recipient="boss", kind=KIND, business_date=DAY)


# --- notify(): emits on commit -----------------------------------------------


def test_notify_creates_on_commit(django_capture_on_commit_callbacks):
    with django_capture_on_commit_callbacks(execute=True):
        notify("boss", KIND, DAY, payload={"laggard_division_ids": ["x"]})
    rec = Notification.objects.get(recipient="boss", kind=KIND, business_date=DAY)
    assert rec.payload == {"laggard_division_ids": ["x"]}
    assert rec.created_at is not None
    assert rec.read_at is None


def test_notify_default_payload_is_empty_dict(django_capture_on_commit_callbacks):
    with django_capture_on_commit_callbacks(execute=True):
        notify("boss", KIND, DAY)
    assert Notification.objects.get(recipient="boss").payload == {}


# --- notify(): idempotent «одно на день», no raw IntegrityError, no poison ----


def test_notify_is_idempotent_one_per_day(django_capture_on_commit_callbacks):
    with django_capture_on_commit_callbacks(execute=True):
        notify("boss", KIND, DAY, payload={"n": 1})
        notify("boss", KIND, DAY, payload={"n": 2})  # same key → no duplicate
    qs = Notification.objects.filter(recipient="boss", kind=KIND, business_date=DAY)
    assert qs.count() == 1
    assert qs.get().payload == {"n": 1}  # first wins (get_or_create), no exception


def test_notify_distinct_keys_create_separate_rows(django_capture_on_commit_callbacks):
    with django_capture_on_commit_callbacks(execute=True):
        notify("boss", KIND, DAY)
        notify("boss2", KIND, DAY)  # different recipient
        notify("boss", KIND, date(2026, 6, 6))  # different date
    assert Notification.objects.count() == 3


# --- notify(): on_commit means a rolled-back business txn leaves no phantom ----


def test_notify_not_emitted_on_rollback(django_capture_on_commit_callbacks):
    with django_capture_on_commit_callbacks(execute=True):
        try:
            with transaction.atomic():
                notify("boss", KIND, DAY)
                raise RuntimeError("business txn fails after notify")
        except RuntimeError:
            pass
    assert Notification.objects.count() == 0
