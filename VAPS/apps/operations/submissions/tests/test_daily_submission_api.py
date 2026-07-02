"""Story 5.8a — API POST сдачи дня (POST /api/operations/daily-submissions/).

Proves the HTTP contract ONLY — the domain logic (late/event/snapshot/race) is
already proven at service level by test_day_submission_service (5.3b):

- coarse gate: RequirePermissionMixin {"create": daily_report.mark_update}
  (anon → 403, no code → 403, holder → passes);
- division scope: ensure_division_scope re-checks the code against the
  payload's division subtree via PermissionService → 403 on someone else's
  division, pass on own subtree / global role;
- form: division_id UUIDField + business_date DateField → 400 VALIDATION_ERROR
  (closes the business_date=None defer class for the submit path);
- pass-through of the service's DomainErrors: 404/409/422, §36 envelope;
- 201 nine-field projection WITHOUT snapshot; submitted_by == request.actor_id
  (ARCH-SEC-030 — payload identity fields are ignored).

Auth via HTTP_X_USER_ID (mirrors the audit/notifications API suites); roles are
seeded with seed_operations + direct UserRole rows (mirror
test_permission_scope); the Clock is pinned via clock.override so the
{today, today+1} submission window is deterministic.
"""

import uuid
from datetime import date, timedelta

import pytest
from django.core.management import call_command
from django.urls import reverse
from rest_framework.test import APIClient

from apps.core import clock
from apps.core.models import Division, DivisionType, Organization
from apps.operations.rbac.models import UserRole
from apps.operations.submissions.services import ensure_division_scope

pytestmark = pytest.mark.django_db

TODAY = date(2026, 6, 4)

PROJECTION_FIELDS = {
    "id",
    "division_id",
    "business_date",
    "version",
    "is_current",
    "event",
    "submitted_by",
    "submitted_at",
    "late",
}


@pytest.fixture(autouse=True)
def frozen_clock():
    with clock.override(TODAY):
        yield


@pytest.fixture
def tree():
    """seed_operations roles + a root→child subtree and an unrelated division."""
    call_command("seed_operations")
    org = Organization.objects.create(name="HQ", code="HQ-API")
    dt = DivisionType.objects.get_or_create(
        code="management", defaults={"name": "Управление"}
    )[0]
    root = Division.objects.create(
        organization=org, type_code=dt, name="root", code="R-API"
    )
    child = Division.objects.create(
        organization=org, type_code=dt, name="child", code="C-API", parent=root
    )
    other = Division.objects.create(
        organization=org, type_code=dt, name="other", code="O-API"
    )
    return root, child, other


@pytest.fixture
def scoped_op(tree):
    """DIVISION_OPERATOR (holds daily_report.mark_update) scoped to root."""
    root, _, _ = tree
    UserRole.objects.create(
        user_id="op-scoped", role_code_id="DIVISION_OPERATOR", scope_division_id=root.id
    )
    return "op-scoped"


@pytest.fixture
def global_op(tree):
    """DIVISION_OPERATOR with a global (unscoped) role."""
    UserRole.objects.create(
        user_id="op-global", role_code_id="DIVISION_OPERATOR", scope_division_id=None
    )
    return "op-global"


def _client(actor="op-global"):
    c = APIClient()
    if actor is not None:
        c.credentials(HTTP_X_USER_ID=actor)
    return c


def _url():
    return reverse("ops-daily-submission-list")


def _post(actor, division_id, business_date=TODAY, extra=None):
    payload = {"division_id": str(division_id), "business_date": str(business_date)}
    payload.update(extra or {})
    return _client(actor).post(_url(), payload, format="json")


# -- AC-1: endpoint mounted, POST-only ----------------------------------------


def test_get_is_405(global_op, tree):
    # list/detail arrive with 5.8c — until then GET must be 405, not 403/404.
    assert _client(global_op).get(_url()).status_code == 405


def test_anonymous_get_is_405(tree):
    # The mixin's early return for methods outside http_method_names answers
    # anon reads with 405 (method surface), not a misleading 403 (5.7c lesson).
    assert _client(actor=None).get(_url()).status_code == 405


@pytest.mark.parametrize("method", ["put", "patch", "delete"])
def test_other_write_verbs_405(global_op, tree, method):
    # AC-1 promises 405 for EVERY non-POST verb, not just GET (mirror of the
    # notifications suite pinning all four).
    assert getattr(_client(global_op), method)(_url()).status_code == 405


@pytest.mark.parametrize("method", ["put", "patch", "delete"])
def test_other_write_verbs_405_anonymous(tree, method):
    assert getattr(_client(actor=None), method)(_url()).status_code == 405


# -- AC-2: coarse permission gate ----------------------------------------------


def test_anonymous_post_403(tree):
    root, _, _ = tree
    resp = _post(None, root.id)
    assert resp.status_code == 403
    assert resp.data["error_code"] == "PERMISSION_DENIED"


def test_actor_without_code_403(tree):
    root, _, _ = tree
    resp = _post("nobody", root.id)  # no roles at all
    assert resp.status_code == 403
    assert resp.data["error_code"] == "PERMISSION_DENIED"


# -- AC-3: division scope (the load-bearing 403) --------------------------------


def test_foreign_division_403(scoped_op, tree):
    _, _, other = tree
    resp = _post(scoped_op, other.id)
    assert resp.status_code == 403
    assert resp.data["error_code"] == "PERMISSION_DENIED"
    assert resp.data["details"] == {"division_id": str(other.id)}


def test_own_division_itself_201(scoped_op, tree):
    # The scope root itself, not only descendants — the most common real
    # request: an operator submitting their own division.
    root, _, _ = tree
    assert _post(scoped_op, root.id).status_code == 201


def test_own_subtree_division_201(scoped_op, tree):
    _, child, _ = tree
    assert _post(scoped_op, child.id).status_code == 201


def test_global_role_any_division_201(global_op, tree):
    _, _, other = tree
    assert _post(global_op, other.id).status_code == 201


# -- AC-4: form validation (400) + ARCH-SEC-030 ---------------------------------


@pytest.mark.parametrize(
    "payload",
    [
        {"business_date": str(TODAY)},  # division_id missing
        {"division_id": "not-a-uuid", "business_date": str(TODAY)},
        {"division_id": str(uuid.uuid4())},  # business_date missing
        {"division_id": str(uuid.uuid4()), "business_date": "2026-13-99"},
    ],
)
def test_bad_form_400(global_op, tree, payload):
    resp = _client(global_op).post(_url(), payload, format="json")
    assert resp.status_code == 400
    assert resp.data["error_code"] == "VALIDATION_ERROR"


def test_payload_identity_fields_ignored(global_op, tree):
    root, _, _ = tree
    resp = _post(global_op, root.id, extra={"submitted_by": "evil", "actor": "evil"})
    assert resp.status_code == 201
    assert resp.data["submitted_by"] == global_op


# -- AC-5: service DomainErrors pass through the unified handler ----------------


def test_nonexistent_division_404(global_op, tree):
    resp = _post(global_op, uuid.uuid4())
    assert resp.status_code == 404
    assert resp.data["error_code"] == "ENTITY_NOT_FOUND"


def test_scoped_actor_nonexistent_division_403(scoped_op, tree):
    # Fail-closed: the scope gate runs BEFORE submit_day's existence check, so
    # a scoped role gets 403 for a phantom UUID (it is in no subtree) — the
    # existence-revealing 404 above is reachable only for global roles.
    resp = _post(scoped_op, uuid.uuid4())
    assert resp.status_code == 403
    assert resp.data["error_code"] == "PERMISSION_DENIED"


def test_duplicate_day_409(global_op, tree):
    root, _, _ = tree
    assert _post(global_op, root.id).status_code == 201
    resp = _post(global_op, root.id)
    assert resp.status_code == 409
    assert resp.data["error_code"] == "DAY_ALREADY_SUBMITTED"


def test_tomorrow_window_upper_bound_201(global_op, tree):
    # The {today, today+1} window's UPPER bound through the API parse path —
    # the 422 test below pins only the lower one.
    root, _, _ = tree
    resp = _post(global_op, root.id, business_date=TODAY + timedelta(days=1))
    assert resp.status_code == 201


def test_out_of_window_422_and_envelope(global_op, tree):
    root, _, _ = tree
    resp = _post(global_op, root.id, business_date=TODAY - timedelta(days=1))
    assert resp.status_code == 422
    assert resp.data["error_code"] == "BUSINESS_DATE_OUT_OF_WINDOW"
    # §36 envelope shape (single error-shaping point — the unified handler).
    assert set(resp.data) == {
        "error_code",
        "message",
        "details",
        "request_id",
        "timestamp",
    }


# -- AC-6: 201 projection -------------------------------------------------------


def test_create_201_shape(global_op, tree):
    root, _, _ = tree
    resp = _post(global_op, root.id)
    assert resp.status_code == 201
    assert set(resp.data) == PROJECTION_FIELDS  # no snapshot, no amend fields
    assert resp.data["division_id"] == str(root.id)
    assert resp.data["business_date"] == str(TODAY)
    assert resp.data["version"] == 1
    assert resp.data["is_current"] is True
    assert resp.data["submitted_by"] == global_op


# -- scope-gate hardening: blank/str division is a caller bug -------------------


@pytest.mark.parametrize("division_id", [None, ""])
def test_scope_gate_rejects_blank_division(division_id):
    # _scope_matches(None) passes for ANY scoped role and "" still passes for
    # global ones — a blank division would be a silent hole, so the guard
    # fails loud (mirror of the notifications selector's blank-actor guard).
    with pytest.raises(ValueError):
        ensure_division_scope("op-global", "daily_report.mark_update", division_id)


def test_scope_gate_accepts_str_uuid(scoped_op, tree):
    # Subtree membership is type-sensitive (a set of UUIDs) — the guard
    # normalizes a str division_id instead of silently 403ing scoped roles.
    root, _, _ = tree
    ensure_division_scope(scoped_op, "daily_report.mark_update", str(root.id))
