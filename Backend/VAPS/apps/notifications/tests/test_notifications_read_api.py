"""Story 5.7c — read-only notifications API (GET /api/notifications/?since=).

Proves: strict self-scope (recipient == actor_id — you never see another
recipient's rows), the ``_AnyAuthenticated`` gate (anon 403 / any actor 200),
the ``since`` cursor (STRICTLY greater — created_at > since), deterministic
``(-created_at, id)`` ordering + LimitOffset pagination, read-only surface
(405 on writes), 400 on a malformed ``since`` and the snake_case 7-field shape.

Postgres-backed. Auth via ``HTTP_X_USER_ID`` (XUserIdAuthentication sets
``request.actor_id``) — mirrors the audit read-API / rbac-matrix suites.

⚠️ ``Notification.created_at`` is ``auto_now_add`` (from TimeStampedModel), so
``create(created_at=...)`` is IGNORED — the helper plants the row then
``.update(created_at=...)`` (which bypasses auto_now_add) to control the cursor.
Rows for one recipient must differ in ``business_date`` (the one-per-day
UniqueConstraint is on ``(recipient, kind, business_date)``).
"""

from datetime import date, datetime, timedelta, timezone

import pytest
from django.urls import reverse
from rest_framework.test import APIClient

from apps.notifications.api.views import NotificationPagination
from apps.notifications.models import Notification
from apps.notifications.selectors import NotificationSelector

pytestmark = pytest.mark.django_db

_T = datetime(2026, 6, 5, 9, 0, tzinfo=timezone.utc)


def _list_url():
    return reverse("notification-list")


def _notif(recipient="alice", *, business_date=None, created_at=None, payload=None):
    """Plant a notification with a controllable ``created_at`` (auto_now_add trap)."""
    business_date = business_date or date(2026, 6, 1)
    n = Notification.objects.create(
        recipient=recipient,
        kind=Notification.Kind.SUBMISSION_LAGGING,
        business_date=business_date,
        payload=payload or {},
    )
    if created_at is not None:
        Notification.objects.filter(pk=n.pk).update(created_at=created_at)
        n.refresh_from_db()
    return n


def _client(actor="alice"):
    c = APIClient()
    if actor is not None:
        c.credentials(HTTP_X_USER_ID=actor)
    return c


# -- AC-3: gate = authentication (no RBAC code) -------------------------------


def test_gate_denies_anonymous():
    _notif(recipient="alice")
    resp = _client(actor=None).get(_list_url())
    assert resp.status_code == 403
    assert resp.data["error_code"] == "PERMISSION_DENIED"


def test_gate_denies_whitespace_actor_header():
    # A whitespace-only X-User-Id must equal a missing one: the auth layer
    # strips it, so the gate 403s — a truthy-but-blank actor_id would slip
    # past the truthiness gate into the selector's blank-guard → 500.
    resp = _client("   ").get(_list_url())
    assert resp.status_code == 403
    assert resp.data["error_code"] == "PERMISSION_DENIED"


def test_gate_allows_any_authenticated_even_when_empty():
    # No rows for this actor → still 200 (access is not gated on having any).
    resp = _client("nobody-has-rows").get(_list_url())
    assert resp.status_code == 200
    assert resp.data["count"] == 0


# -- AC-2: strict self-scope (the load-bearing access control) ----------------


def test_self_scope_returns_only_own_rows():
    mine = _notif(recipient="alice")
    _notif(recipient="bob")
    resp = _client("alice").get(_list_url())
    assert resp.status_code == 200
    assert resp.data["count"] == 1
    assert [r["id"] for r in resp.data["results"]] == [mine.id]
    assert all(r["recipient"] == "alice" for r in resp.data["results"])


def test_self_scope_cannot_be_widened_by_query():
    # bob's rows must never surface for alice, whatever she passes.
    _notif(recipient="bob")
    resp = _client("alice").get(_list_url(), {"recipient": "bob"})
    assert resp.status_code == 200
    assert resp.data["count"] == 0


# -- AC-4: since cursor is STRICTLY greater ------------------------------------


def test_since_is_strictly_greater():
    t1 = _T
    t2 = _T + timedelta(hours=1)
    t3 = _T + timedelta(hours=2)
    _notif(business_date=date(2026, 6, 1), created_at=t1)
    _notif(business_date=date(2026, 6, 2), created_at=t2)
    n3 = _notif(business_date=date(2026, 6, 3), created_at=t3)
    resp = _client("alice").get(_list_url(), {"since": t2.isoformat()})
    # created_at > t2 → only t3; t2 (boundary) and t1 excluded.
    assert [r["id"] for r in resp.data["results"]] == [n3.id]


def test_since_omitted_returns_all_own():
    _notif(business_date=date(2026, 6, 1), created_at=_T)
    _notif(business_date=date(2026, 6, 2), created_at=_T + timedelta(hours=1))
    resp = _client("alice").get(_list_url())
    assert resp.data["count"] == 2


def test_bad_since_is_400():
    resp = _client("alice").get(_list_url(), {"since": "notadate"})
    assert resp.status_code == 400
    assert resp.data["error_code"] == "VALIDATION_ERROR"


# -- AC-5: ordering + LimitOffset pagination ----------------------------------


def test_ordering_newest_first():
    old = _notif(business_date=date(2026, 6, 1), created_at=_T)
    new = _notif(business_date=date(2026, 6, 2), created_at=_T + timedelta(days=5))
    results = _client("alice").get(_list_url()).data["results"]
    assert results[0]["id"] == new.id
    assert results[-1]["id"] == old.id


def test_pagination_envelope_and_determinism_on_equal_created_at():
    # 5 rows sharing the SAME created_at (distinct business_date to satisfy the
    # one-per-day key) — `id` is the load-bearing tie-breaker.
    for i in range(5):
        _notif(business_date=date(2026, 6, 1) + timedelta(days=i), created_at=_T)
    c = _client("alice")
    p1 = c.get(_list_url(), {"limit": 2, "offset": 0}).data
    p2 = c.get(_list_url(), {"limit": 2, "offset": 2}).data
    p3 = c.get(_list_url(), {"limit": 2, "offset": 4}).data
    assert p1["count"] == 5
    assert set(p1) == {"count", "next", "previous", "results"}
    ids = [r["id"] for r in p1["results"] + p2["results"] + p3["results"]]
    assert len(ids) == 5 and len(set(ids)) == 5  # no loss, no duplication


def test_pagination_caps_limit_and_defaults():
    from rest_framework.request import Request
    from rest_framework.test import APIRequestFactory

    paginator = NotificationPagination()
    over = Request(APIRequestFactory().get("/", {"limit": "5000"}))
    assert paginator.get_limit(over) == 200  # capped at max_limit
    default = Request(APIRequestFactory().get("/"))
    assert paginator.get_limit(default) == 50  # default when omitted


# -- AC-7: read-only — write verbs → 405 --------------------------------------


@pytest.mark.parametrize("method", ["post", "put", "patch", "delete"])
def test_write_verbs_not_allowed(method):
    assert getattr(_client("alice"), method)(_list_url()).status_code == 405


@pytest.mark.parametrize("method", ["post", "put", "patch", "delete"])
def test_write_verbs_not_allowed_for_anonymous(method):
    # Pins the gate's early return for methods outside http_method_names: an
    # anonymous write is answered 405 (method check precedes the auth gate by
    # design — the method surface is public via open OPTIONS anyway), not 403.
    assert getattr(_client(actor=None), method)(_list_url()).status_code == 405


# -- selector hardening: blank actor is a caller bug ---------------------------


@pytest.mark.parametrize("actor", [None, "", "   ", 42])
def test_selector_rejects_blank_actor(actor):
    # Mirror of notify()'s blank-recipient guard: the recipient filter is the
    # load-bearing access control — a blank (or non-string) actor must fail
    # loud with the designed ValueError, not return an empty queryset (or an
    # accidental AttributeError) that masks a caller bug.
    with pytest.raises(ValueError):
        NotificationSelector.list(actor)


# -- AC-6: response shape (7 fields, snake_case) ------------------------------


def test_response_shape():
    _notif(recipient="alice", payload={"laggard_division_ids": ["d1"]})
    results = _client("alice").get(_list_url()).data["results"]
    assert set(results[0]) == {
        "id",
        "recipient",
        "kind",
        "business_date",
        "payload",
        "read_at",
        "created_at",
    }
