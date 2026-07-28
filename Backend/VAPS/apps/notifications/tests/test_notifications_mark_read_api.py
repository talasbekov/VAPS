"""Story 11.4a — mark-read API (POST /api/notifications/{id}/read/).

Proves: the endpoint actually writes ``read_at`` (via ``Clock``, not a bare
wall-clock read), self-scope ownership (recipient == actor_id — a foreign
notification is 403 and untouched), 404-before-403 ordering for a phantom id
(mirrors ``DailySubmissionViewSet.amend``), and idempotency (a second call on
an already-read row does not move ``read_at``).

Postgres-backed. Auth via ``HTTP_X_USER_ID`` (mirrors
test_notifications_read_api.py / rbac-matrix suites).
"""

from datetime import date, datetime, timezone

import pytest
from django.urls import reverse
from rest_framework.test import APIClient

from apps.core import clock
from apps.notifications.models import Notification

pytestmark = pytest.mark.django_db

_T = datetime(2026, 6, 5, 9, 0, tzinfo=timezone.utc)


def _mark_read_url(notification_id):
    return reverse("notification-mark-read", kwargs={"pk": notification_id})


def _notif(recipient="alice", *, business_date=None, read_at=None):
    business_date = business_date or date(2026, 6, 1)
    n = Notification.objects.create(
        recipient=recipient,
        kind=Notification.Kind.SUBMISSION_LAGGING,
        business_date=business_date,
    )
    if read_at is not None:
        Notification.objects.filter(pk=n.pk).update(read_at=read_at)
        n.refresh_from_db()
    return n


def _client(actor="alice"):
    c = APIClient()
    if actor is not None:
        c.credentials(HTTP_X_USER_ID=actor)
    return c


def test_mark_read_sets_read_at():
    n = _notif(recipient="alice")
    assert n.read_at is None
    with clock.override(_T):
        resp = _client("alice").post(_mark_read_url(n.id))
    assert resp.status_code == 200
    n.refresh_from_db()
    assert n.read_at == _T
    assert resp.data["read_at"] is not None
    assert resp.data["id"] == n.id


def test_mark_read_is_idempotent():
    n = _notif(recipient="alice")
    with clock.override(_T):
        _client("alice").post(_mark_read_url(n.id))
    n.refresh_from_db()
    first_read_at = n.read_at

    later = datetime(2026, 6, 6, 9, 0, tzinfo=timezone.utc)
    with clock.override(later):
        resp = _client("alice").post(_mark_read_url(n.id))
    assert resp.status_code == 200
    n.refresh_from_db()
    # Second call must NOT move read_at forward — the first read wins.
    assert n.read_at == first_read_at
    assert n.read_at != later


def test_mark_read_rejects_foreign_notification():
    n = _notif(recipient="alice")
    resp = _client("bob").post(_mark_read_url(n.id))
    assert resp.status_code == 403
    assert resp.data["error_code"] == "PERMISSION_DENIED"
    n.refresh_from_db()
    assert n.read_at is None


def test_mark_read_404_for_missing_id():
    resp = _client("alice").post(_mark_read_url(999_999))
    assert resp.status_code == 404
    assert resp.data["error_code"] == "ENTITY_NOT_FOUND"


def test_mark_read_404_for_missing_id_even_for_a_stranger():
    # Existence, not ownership, is the FIRST question — a phantom id is 404
    # to any caller, never a 403 that would leak whether the id exists.
    resp = _client("nobody-in-particular").post(_mark_read_url(999_999))
    assert resp.status_code == 404


def test_mark_read_requires_authentication():
    n = _notif(recipient="alice")
    resp = _client(actor=None).post(_mark_read_url(n.id))
    assert resp.status_code == 403
    assert resp.data["error_code"] == "PERMISSION_DENIED"
    n.refresh_from_db()
    assert n.read_at is None
