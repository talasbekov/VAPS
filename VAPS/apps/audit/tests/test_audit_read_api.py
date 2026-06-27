"""Story 4.5 — read-only audit API (GET /api/audit/logs/), FR-36.

Proves: filters (object/actor/action/period), deterministic ``(-created_at, id)``
ordering + LimitOffset pagination, the ``audit.view`` gate (403/200), read-only
surface (405 on write verbs), 400 on malformed filters, the snake_case response
shape, and retrieve. Postgres-backed; RBAC via the REAL seed (``seed_operations``),
not factory copies — mirrors the rbac-matrix suite.
"""

import uuid
from datetime import datetime, timezone

import pytest
from django.core.management import call_command
from django.urls import reverse
from rest_framework.test import APIClient

from apps.audit.api.views import AuditLogPagination
from apps.audit.models import AuditLog
from apps.operations.rbac.models import UserRole

pytestmark = pytest.mark.django_db

_T = datetime(2026, 6, 5, 9, 0, tzinfo=timezone.utc)


def _list_url():
    return reverse("audit-log-list")


def _detail_url(pk):
    return reverse("audit-log-detail", kwargs={"pk": str(pk)})


def _log(**kw):
    """Plant an audit row directly (``created_at`` has no DB default)."""
    defaults = dict(
        actor_user_id="op-1",
        action="STATUS_CREATED",
        entity_type="employee_status",
        entity_id=uuid.uuid4(),
        old_value=None,
        new_value={"status_id": 1},
        reason="",
        request_id="",
        ip_address="127.0.0.1",
        user_agent="",
        created_at=_T,
    )
    defaults.update(kw)
    return AuditLog.objects.create(**defaults)


@pytest.fixture
def client_orgd(db):
    call_command("seed_operations")
    UserRole.objects.create(user_id="auditor", role_code_id="ORGD")  # holds audit.view
    c = APIClient()
    c.credentials(HTTP_X_USER_ID="auditor")
    return c


@pytest.fixture
def client_noperm(db):
    call_command("seed_operations")
    UserRole.objects.create(user_id="omd-user", role_code_id="OMD")  # no audit.view
    c = APIClient()
    c.credentials(HTTP_X_USER_ID="omd-user")
    return c


# -- AC-6: gate ---------------------------------------------------------------


def test_gate_denies_without_permission(client_noperm):
    resp = client_noperm.get(_list_url())
    assert resp.status_code == 403
    assert resp.data["error_code"] == "PERMISSION_DENIED"


def test_gate_denies_anonymous(db):
    assert APIClient().get(_list_url()).status_code == 403


def test_gate_allows_audit_view(client_orgd):
    _log()
    assert client_orgd.get(_list_url()).status_code == 200


# -- AC-1: filter by object (entity_type + entity_id = employee UUID) ----------


def test_filter_by_object(client_orgd):
    emp, other = uuid.uuid4(), uuid.uuid4()
    _log(entity_type="employee_status", entity_id=emp)
    _log(entity_type="employee_status", entity_id=other)
    _log(entity_type="secondment", entity_id=emp)
    resp = client_orgd.get(
        _list_url(), {"entity_type": "employee_status", "entity_id": str(emp)}
    )
    assert resp.status_code == 200
    assert resp.data["count"] == 1
    assert {r["entity_id"] for r in resp.data["results"]} == {str(emp)}


# -- AC-2: filter by actor ----------------------------------------------------


def test_filter_by_actor(client_orgd):
    _log(actor_user_id="alice")
    _log(actor_user_id="bob")
    resp = client_orgd.get(_list_url(), {"actor": "alice"})
    assert resp.data["count"] == 1
    assert resp.data["results"][0]["actor_user_id"] == "alice"


# -- AC-3: filter by action ---------------------------------------------------


def test_filter_by_action(client_orgd):
    _log(action="STATUS_CREATED")
    _log(action="STATUS_CANCELLED")
    resp = client_orgd.get(_list_url(), {"action": "STATUS_CANCELLED"})
    assert resp.data["count"] == 1
    assert resp.data["results"][0]["action"] == "STATUS_CANCELLED"


def test_filter_unknown_action_is_empty(client_orgd):
    _log(action="STATUS_CREATED")
    resp = client_orgd.get(_list_url(), {"action": "NOT_A_REAL_CODE"})
    assert resp.status_code == 200
    assert resp.data["count"] == 0


# -- AC-4: half-open [created_from, created_to) period -------------------------


def test_filter_by_period_half_open(client_orgd):
    d4 = datetime(2026, 6, 4, 9, 0, tzinfo=timezone.utc)
    d5 = datetime(2026, 6, 5, 9, 0, tzinfo=timezone.utc)
    d6 = datetime(2026, 6, 6, 9, 0, tzinfo=timezone.utc)
    _log(created_at=d4)
    r5 = _log(created_at=d5)
    _log(created_at=d6)
    resp = client_orgd.get(
        _list_url(), {"created_from": d5.isoformat(), "created_to": d6.isoformat()}
    )
    # [d5, d6): d5 included, d6 excluded, d4 excluded
    assert {r["id"] for r in resp.data["results"]} == {str(r5.id)}


def test_bad_entity_id_is_400(client_orgd):
    resp = client_orgd.get(_list_url(), {"entity_id": "not-a-uuid"})
    assert resp.status_code == 400
    assert resp.data["error_code"] == "VALIDATION_ERROR"


def test_bad_date_is_400(client_orgd):
    resp = client_orgd.get(_list_url(), {"created_from": "notadate"})
    assert resp.status_code == 400
    assert resp.data["error_code"] == "VALIDATION_ERROR"


# -- AC-5: deterministic ordering + LimitOffset pagination --------------------


def test_pagination_envelope_and_determinism_on_equal_created_at(client_orgd):
    # 5 rows sharing the SAME created_at — `id` is the load-bearing tie-breaker.
    for _ in range(5):
        _log(created_at=_T)
    p1 = client_orgd.get(_list_url(), {"limit": 2, "offset": 0}).data
    p2 = client_orgd.get(_list_url(), {"limit": 2, "offset": 2}).data
    p3 = client_orgd.get(_list_url(), {"limit": 2, "offset": 4}).data
    assert p1["count"] == 5
    assert set(p1) == {"count", "next", "previous", "results"}
    ids = [r["id"] for r in p1["results"]]
    ids += [r["id"] for r in p2["results"]]
    ids += [r["id"] for r in p3["results"]]
    assert len(ids) == 5  # 2 + 2 + 1
    assert len(set(ids)) == 5  # no loss, no duplication across pages


def test_ordering_newest_first(client_orgd):
    old = _log(created_at=datetime(2026, 6, 1, 9, 0, tzinfo=timezone.utc))
    new = _log(created_at=datetime(2026, 6, 10, 9, 0, tzinfo=timezone.utc))
    results = client_orgd.get(_list_url()).data["results"]
    assert results[0]["id"] == str(new.id)
    assert results[-1]["id"] == str(old.id)


def test_pagination_caps_limit_and_defaults():
    from rest_framework.request import Request
    from rest_framework.test import APIRequestFactory

    paginator = AuditLogPagination()
    over = Request(APIRequestFactory().get("/", {"limit": "5000"}))
    assert paginator.get_limit(over) == 200  # capped at max_limit, not 5000
    default = Request(APIRequestFactory().get("/"))
    assert paginator.get_limit(default) == 50  # default_limit when omitted


# -- AC-7: read-only — write verbs → 405 -------------------------------------


@pytest.mark.parametrize("method", ["post", "put", "patch", "delete"])
def test_write_verbs_not_allowed(client_orgd, method):
    assert getattr(client_orgd, method)(_list_url()).status_code == 405


# -- AC-8: response shape (12 fields, snake_case) -----------------------------


def test_response_shape(client_orgd):
    _log()
    results = client_orgd.get(_list_url()).data["results"]
    assert set(results[0]) == {
        "id",
        "actor_user_id",
        "action",
        "entity_type",
        "entity_id",
        "old_value",
        "new_value",
        "reason",
        "request_id",
        "ip_address",
        "user_agent",
        "created_at",
    }


# -- retrieve (реш. №2) -------------------------------------------------------


def test_retrieve_returns_row(client_orgd):
    row = _log(action="STATUS_EXTENDED")
    resp = client_orgd.get(_detail_url(row.id))
    assert resp.status_code == 200
    assert resp.data["id"] == str(row.id)
    assert resp.data["action"] == "STATUS_EXTENDED"


def test_retrieve_unknown_is_404(client_orgd):
    resp = client_orgd.get(_detail_url(uuid.uuid4()))
    assert resp.status_code == 404
    assert resp.data["error_code"] == "ENTITY_NOT_FOUND"


def test_retrieve_malformed_pk_is_404(client_orgd):
    # A non-UUID path segment must degrade to 404, NOT 500: the UUID id column
    # raises a coercion error that slips past the DoesNotExist guard.
    resp = client_orgd.get("/api/audit/logs/not-a-uuid/")
    assert resp.status_code == 404
    assert resp.data["error_code"] == "ENTITY_NOT_FOUND"


def test_retrieve_gate_denies_without_permission(client_noperm):
    row = _log()
    assert client_noperm.get(_detail_url(row.id)).status_code == 403
