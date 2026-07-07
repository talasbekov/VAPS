"""Tests for the notification primitive (Story 5.7a).

The Notification model (one-per-day via UniqueConstraint, kind via CheckConstraint)
and the idempotent, in-transaction notify() service (Review D1 → variant B:
synchronous, visible at once, rolled back with the caller's transaction). No
lagging detection (5.7b), no API (5.7c), no WS delivery (E11).
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


# --- model: kind CheckConstraint (Review P1) ----------------------------------


def test_kind_check_covers_kind_choices():
    # Drift-guard (зеркало test_event_check_covers_event_choices): the DB
    # CheckConstraint must list exactly Kind.values. A new Kind member added
    # without updating chk_notification_kind trips the constraint here → reddens.
    for value in Notification.Kind.values:
        row = Notification.objects.create(
            recipient="boss", kind=value, business_date=DAY
        )
        assert row.kind == value


def test_kind_check_rejects_unknown_kind():
    # CharField.choices is not enforced on create(); the DB CheckConstraint is.
    with pytest.raises(IntegrityError):
        with transaction.atomic():
            Notification.objects.create(
                recipient="boss", kind="GARBAGE_KIND", business_date=DAY
            )


# --- notify(): variant B — synchronous, visible inside the caller's txn -------


def test_notify_visible_within_caller_transaction():
    # Discriminating for variant B (Review D1/P3): the row is visible BEFORE the
    # caller's transaction commits, and notify() returns it. Under variant A
    # (transaction.on_commit) both assertions would fail — the callback would not
    # run inside the atomic and notify() would return None.
    with transaction.atomic():
        rec = notify("boss", KIND, DAY, payload={"laggard_division_ids": ["x"]})
        assert rec is not None
        assert rec.payload == {"laggard_division_ids": ["x"]}
        assert rec.read_at is None
        assert Notification.objects.filter(
            recipient="boss", kind=KIND, business_date=DAY
        ).exists()


def test_notify_default_payload_is_empty_dict():
    rec = notify("boss", KIND, DAY)
    assert rec.payload == {}


# --- notify(): idempotent «одно на день», no raw IntegrityError, no poison ----


def test_notify_is_idempotent_one_per_day():
    notify("boss", KIND, DAY, payload={"n": 1})
    notify("boss", KIND, DAY, payload={"n": 2})  # same key → no duplicate
    qs = Notification.objects.filter(recipient="boss", kind=KIND, business_date=DAY)
    assert qs.count() == 1
    assert qs.get().payload == {"n": 1}  # first wins (get_or_create), no exception
    # the enclosing transaction is still usable after the absorbed duplicate
    assert Notification.objects.exists()


def test_notify_distinct_keys_create_separate_rows():
    notify("boss", KIND, DAY)
    notify("boss2", KIND, DAY)  # different recipient
    notify("boss", KIND, date(2026, 6, 6))  # different date
    assert Notification.objects.count() == 3


# --- notify(): recipient hygiene (Review P2) ----------------------------------


def test_notify_strips_recipient_so_whitespace_cannot_defeat_key():
    notify("boss", KIND, DAY)
    notify("  boss  ", KIND, DAY)  # same recipient after strip → no duplicate
    assert (
        Notification.objects.filter(kind=KIND, business_date=DAY).count() == 1
    )


@pytest.mark.parametrize("bad", ["", "   ", None])
def test_notify_rejects_blank_recipient(bad):
    with pytest.raises(ValueError):
        notify(bad, KIND, DAY)


# --- notify(): a rolled-back business txn leaves no phantom -------------------


def test_notify_not_emitted_on_rollback():
    # Variant B keeps the "no phantom" guarantee via the insert's own rollback:
    # the synchronous create lives in the caller's atomic, so its failure removes
    # the row along with the business change.
    try:
        with transaction.atomic():
            notify("boss", KIND, DAY)
            raise RuntimeError("business txn fails after notify")
    except RuntimeError:
        pass
    assert Notification.objects.count() == 0
