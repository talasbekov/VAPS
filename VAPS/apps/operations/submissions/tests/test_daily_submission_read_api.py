"""Story 5.8c — API чтения сдач (GET /api/operations/daily-submissions/ + /{id}/).

Proves the HTTP read contract ONLY — the submission/amendment domain is
already proven at service level (5.3b/5.4a):

- coarse gate: RequirePermissionMixin {"list"/"retrieve": daily_report
  .mark_update} — the read permission is mark_update BY DECISION (epics
  2026-07-02): no daily_report.view code exists; ORGD/OMD hold generate,
  not mark_update, so leadership reads arrive with the tree screen (10.4);
- list visibility (canon architecture.md#L451): the selector takes the actor
  first and narrows to the union of role subtrees itself — out-of-scope rows
  are simply ABSENT (200 with fewer rows), never a 403;
- list contract: {count, next, previous, results} envelope, LimitOffset
  50/200, ordering -business_date/-version/id, NINE-field items WITHOUT the
  heavy snapshot; optional equality filters division_id/business_date with
  garbage → 400 VALIDATION_ERROR;
- detail contract: pk resolves via DailySubmissionSelector.by_id (hardened
  by the 5.8b review — canonical ASCII digits only), then the division scope
  re-check → 403 with the server-resolved division_id (the trade-off accepted
  at the 5.8b review — see test_foreign_division_403 in the amend suite);
  the response is the THIRTEEN-field detail projection including snapshot —
  detail is the only HTTP channel for it (Д1);
- retrieve returns the REQUESTED version, not the chain head — the deliberate
  contrast with amend's chain semantics (Д1 5.8b), pinned by the stale-pk test.

Fixtures are this suite's own copies of the 5.8a/b ones (conftest extraction
is a separate hygiene task, deliberately not done here).
"""

from datetime import date, timedelta

import pytest
from django.core.management import call_command
from django.urls import reverse
from rest_framework.test import APIClient

from rest_framework.request import Request
from rest_framework.test import APIRequestFactory

from apps.core import clock
from apps.core.clock import Clock
from apps.core.models import Division, DivisionType, Organization
from apps.operations.rbac.models import TemporaryDutyPermission, UserRole
from apps.operations.services import PermissionService
from apps.operations.submissions.api.views import DailySubmissionPagination
from apps.operations.submissions.services import amend_day, submit_day

pytestmark = pytest.mark.django_db

TODAY = date(2026, 6, 4)
TOMORROW = TODAY + timedelta(days=1)

LIST_FIELDS = {
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
DETAIL_FIELDS = LIST_FIELDS | {
    "snapshot",
    "reason",
    "sanction",
    "triggered_by_status_id",
}
ENVELOPE = {"count", "next", "previous", "results"}


@pytest.fixture(autouse=True)
def frozen_clock():
    # Reads apply no date window — the pin only makes the submit_day
    # precondition ({today, today+1}) and temp-duty resolution deterministic.
    with clock.override(TODAY):
        yield


@pytest.fixture
def tree():
    """seed_operations roles + a root→child subtree and an unrelated division."""
    call_command("seed_operations")
    org = Organization.objects.create(name="HQ", code="HQ-RD")
    dt = DivisionType.objects.get_or_create(
        code="management", defaults={"name": "Управление"}
    )[0]
    root = Division.objects.create(
        organization=org, type_code=dt, name="root", code="R-RD"
    )
    child = Division.objects.create(
        organization=org, type_code=dt, name="child", code="C-RD", parent=root
    )
    other = Division.objects.create(
        organization=org, type_code=dt, name="other", code="O-RD"
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
def child_scoped_op(tree):
    """DIVISION_OPERATOR scoped to the CHILD — the upward-direction probe."""
    _, child, _ = tree
    UserRole.objects.create(
        user_id="op-child", role_code_id="DIVISION_OPERATOR", scope_division_id=child.id
    )
    return "op-child"


@pytest.fixture
def global_op(tree):
    """DIVISION_OPERATOR with a global (unscoped) role."""
    UserRole.objects.create(
        user_id="op-global", role_code_id="DIVISION_OPERATOR", scope_division_id=None
    )
    return "op-global"


@pytest.fixture
def viewer(tree):
    """VIEWER — has a role (status.view), NOT mark_update: gate discriminator."""
    UserRole.objects.create(
        user_id="viewer", role_code_id="VIEWER", scope_division_id=None
    )
    return "viewer"


@pytest.fixture
def orgd(tree):
    """ORGD — holds daily_report.generate, NOT mark_update: reads are gated on
    mark_update BY DECISION (epics 2026-07-02); leadership reads arrive with
    the tree screen (10.4)."""
    UserRole.objects.create(user_id="orgd", role_code_id="ORGD", scope_division_id=None)
    return "orgd"


def _client(actor="op-global"):
    c = APIClient()
    if actor is not None:
        c.credentials(HTTP_X_USER_ID=actor)
    return c


def _list_url():
    return reverse("ops-daily-submission-list")


def _detail_url(pk):
    return reverse("ops-daily-submission-detail", kwargs={"pk": str(pk)})


def _submitted(division, business_date=TODAY):
    """A submitted day — via the submit_day SERVICE (faster than the 5.8a
    endpoint and independent of its contract)."""
    return submit_day(
        division_id=division.id, business_date=business_date, actor="seed-op"
    )


def _amended(division, business_date=TODAY):
    return amend_day(
        division_id=division.id,
        business_date=business_date,
        actor="seed-op",
        reason="уточнение состава",
        sanction="замечание",
    )


def _list(actor, **params):
    return _client(actor).get(_list_url(), params)


def _detail(actor, pk):
    return _client(actor).get(_detail_url(pk))


# -- AC-1: routes served, write verbs still 405 -------------------------------------


@pytest.mark.parametrize("method", ["put", "patch", "delete"])
def test_write_verbs_405_on_collection(global_op, tree, method):
    assert getattr(_client(global_op), method)(_list_url()).status_code == 405


@pytest.mark.parametrize("method", ["put", "patch", "delete"])
def test_write_verbs_405_on_detail(global_op, tree, method):
    root, _, _ = tree
    submission = _submitted(root)
    url = _detail_url(submission.pk)
    assert getattr(_client(global_op), method)(url).status_code == 405


@pytest.mark.parametrize("method", ["put", "patch", "delete"])
def test_write_verbs_405_on_detail_anonymous(tree, method):
    root, _, _ = tree
    submission = _submitted(root)
    url = _detail_url(submission.pk)
    assert getattr(_client(actor=None), method)(url).status_code == 405


# -- AC-2: coarse permission gate ----------------------------------------------------


def test_list_anonymous_403(tree):
    resp = _list(None)
    assert resp.status_code == 403
    assert resp.data["error_code"] == "PERMISSION_DENIED"


def test_detail_anonymous_403(tree):
    root, _, _ = tree
    submission = _submitted(root)
    resp = _detail(None, submission.pk)
    assert resp.status_code == 403
    assert resp.data["error_code"] == "PERMISSION_DENIED"


@pytest.mark.parametrize("fixture_name", ["viewer", "orgd"])
def test_actor_without_mark_update_403(request, tree, fixture_name):
    # VIEWER (status.view) and ORGD (daily_report.generate) both have roles but
    # not the read code — reads are mark_update by decision, not view/generate.
    actor = request.getfixturevalue(fixture_name)
    root, _, _ = tree
    submission = _submitted(root)
    assert _list(actor).status_code == 403
    assert _detail(actor, submission.pk).status_code == 403


# -- AC-3: actor-scoped visibility (canon L451) --------------------------------------


def test_scoped_sees_own_subtree_only(scoped_op, tree):
    # Out-of-scope rows are ABSENT, not a 403 — the list never errors on scope.
    root, child, other = tree
    s_root = _submitted(root)
    s_child = _submitted(child)
    _submitted(other)
    resp = _list(scoped_op)
    assert resp.status_code == 200
    ids = {row["id"] for row in resp.data["results"]}
    assert ids == {s_root.pk, s_child.pk}


def test_child_scoped_does_not_see_parent(child_scoped_op, tree):
    # Upward direction: visibility must not climb the tree (review-5.8b lesson).
    root, child, _ = tree
    _submitted(root)
    s_child = _submitted(child)
    resp = _list(child_scoped_op)
    assert resp.status_code == 200
    ids = {row["id"] for row in resp.data["results"]}
    assert ids == {s_child.pk}


def test_global_role_sees_all(global_op, tree):
    root, child, other = tree
    created = {_submitted(d).pk for d in (root, child, other)}
    resp = _list(global_op)
    assert resp.status_code == 200
    assert {row["id"] for row in resp.data["results"]} == created


# -- AC-4: list contract — envelope, projection, ordering, filters, pagination -------


def test_list_envelope_and_nine_fields_without_snapshot(global_op, tree):
    root, _, _ = tree
    _submitted(root)
    resp = _list(global_op)
    assert resp.status_code == 200
    assert set(resp.data) == ENVELOPE
    assert resp.data["count"] == 1
    row = resp.data["results"][0]
    assert set(row) == LIST_FIELDS  # no snapshot, no amend fields — weight guard


def test_list_ordering_business_date_version_id(global_op, tree):
    # -business_date first, then -version, id as the final tie-breaker (L427).
    # TOMORROW is inside submit_day's {today, today+1} window — the only way
    # to get a second business date without touching the clock.
    root, child, _ = tree
    v1 = _submitted(root)
    v2 = _amended(root)
    same_day = _submitted(child)  # same date+version as v1 → id decides
    tomorrow = _submitted(root, business_date=TOMORROW)
    resp = _list(global_op)
    ordered = [row["id"] for row in resp.data["results"]]
    assert ordered == [tomorrow.pk, v2.pk, v1.pk, same_day.pk]


def test_list_filters_division_and_date_return_full_history(global_op, tree):
    # The chain filter is the point of list: BOTH versions, stale one included.
    root, _, other = tree
    v1 = _submitted(root)
    v2 = _amended(root)
    _submitted(other)
    resp = _list(global_op, division_id=str(root.id), business_date=str(TODAY))
    assert resp.status_code == 200
    assert resp.data["count"] == 2
    by_id = {row["id"]: row for row in resp.data["results"]}
    assert set(by_id) == {v1.pk, v2.pk}
    assert by_id[v1.pk]["is_current"] is False
    assert by_id[v2.pk]["is_current"] is True


@pytest.mark.parametrize(
    "params",
    [
        {"division_id": "abc"},
        {"division_id": "12345"},
        {"business_date": "мусор"},
        {"business_date": "2026-13-99"},
    ],
)
def test_list_garbage_filters_400(global_op, tree, params):
    resp = _list(global_op, **params)
    assert resp.status_code == 400
    assert resp.data["error_code"] == "VALIDATION_ERROR"


def test_pagination_limits_and_next_link(global_op, tree):
    # Class attrs pin the 50/200 canon (behaviour over 200 rows is DRF's own);
    # the ?limit=1 round-trip proves the paginator is actually wired in.
    assert DailySubmissionPagination.default_limit == 50
    assert DailySubmissionPagination.max_limit == 200
    root, child, _ = tree
    _submitted(root)
    _submitted(child)
    resp = _list(global_op, limit=1)
    assert resp.data["count"] == 2
    assert len(resp.data["results"]) == 1
    assert resp.data["next"] is not None


# -- AC-5: detail contract ------------------------------------------------------------


def test_detail_200_thirteen_fields_v1(global_op, tree):
    root, _, _ = tree
    submission = _submitted(root)
    resp = _detail(global_op, submission.pk)
    assert resp.status_code == 200
    assert set(resp.data) == DETAIL_FIELDS
    assert resp.data["snapshot"] == submission.snapshot  # the only HTTP channel
    assert resp.data["reason"] == ""
    assert resp.data["sanction"] == ""
    assert resp.data["triggered_by_status_id"] is None


def test_detail_amended_version_carries_amend_fields(global_op, tree):
    root, _, _ = tree
    _submitted(root)
    v2 = _amended(root)
    resp = _detail(global_op, v2.pk)
    assert resp.status_code == 200
    assert resp.data["version"] == 2
    assert resp.data["reason"] == "уточнение состава"
    assert resp.data["sanction"] == "замечание"


def test_detail_stale_pk_returns_that_version_not_head(global_op, tree):
    # Deliberate contrast with amend (Д1 5.8b: pk identifies the CHAIN there).
    # retrieve is a point read: the superseded v1 row itself, not latest_for.
    root, _, _ = tree
    v1 = _submitted(root)
    _amended(root)
    resp = _detail(global_op, v1.pk)
    assert resp.status_code == 200
    assert resp.data["id"] == v1.pk
    assert resp.data["version"] == 1
    assert resp.data["is_current"] is False


def test_detail_foreign_division_403(scoped_op, tree):
    # Same server-resolved division_id in details as amend — the trade-off is
    # accepted (5.8b review, opt. A); see the amend suite for the rationale.
    _, _, other = tree
    submission = _submitted(other)
    resp = _detail(scoped_op, submission.pk)
    assert resp.status_code == 403
    assert resp.data["error_code"] == "PERMISSION_DENIED"
    assert resp.data["details"] == {"division_id": str(other.id)}


def test_detail_phantom_pk_404_and_envelope(global_op, tree):
    resp = _detail(global_op, 999999)
    assert resp.status_code == 404
    assert resp.data["error_code"] == "ENTITY_NOT_FOUND"
    assert resp.data["details"] == {"submission_id": "999999"}
    # §36 envelope shape (single error-shaping point — the unified handler).
    assert set(resp.data) == {
        "error_code",
        "message",
        "details",
        "request_id",
        "timestamp",
    }


def test_detail_non_integer_pk_404(global_op, tree):
    # One pin that retrieve rides the hardened by_id (5.8b review) — the full
    # alias/garbage matrix is owned by the amend suite, not re-proven here.
    resp = _detail(global_op, "abc")
    assert resp.status_code == 404
    assert resp.data["error_code"] == "ENTITY_NOT_FOUND"


# -- Review 5.8c: grant sources of visibility (duty / wildcard / union) --------------


def _duty(user_id, scope_division_id):
    """An ACTIVE temporary duty carrying DIVISION_OPERATOR for the frozen now."""
    now = Clock.now()
    TemporaryDutyPermission.objects.create(
        user_id=user_id,
        duty_role_code="DIVISION_OPERATOR",
        starts_at=now - timedelta(hours=1),
        ends_at=now + timedelta(hours=1),
        created_by="seed",
        scope_division_id=scope_division_id,
    )


def test_duty_scoped_grant_sees_subtree(tree):
    # The second grant source: an active temp-duty scoped to child grants the
    # same subtree visibility a role would — list AND detail agree.
    root, child, _ = tree
    _submitted(root)
    s_child = _submitted(child)
    _duty("duty-op", child.id)
    resp = _list("duty-op")
    assert resp.status_code == 200
    assert {row["id"] for row in resp.data["results"]} == {s_child.pk}
    assert _detail("duty-op", s_child.pk).status_code == 200


def test_duty_unscoped_grant_sees_all(tree):
    # Unscoped duty == unscoped role for its window: global visibility —
    # mirrors has_permission, where scope None passes any division check.
    root, _, other = tree
    created = {_submitted(root).pk, _submitted(other).pk}
    _duty("duty-global", None)
    resp = _list("duty-global")
    assert resp.status_code == 200
    assert {row["id"] for row in resp.data["results"]} == created


def test_admin_wildcard_sees_all(tree):
    # ADMIN holds "*", not mark_update — the wildcard leg of the holding query.
    root, _, other = tree
    created = {_submitted(root).pk, _submitted(other).pk}
    UserRole.objects.create(
        user_id="admin-op", role_code_id="ADMIN", scope_division_id=None
    )
    resp = _list("admin-op")
    assert resp.status_code == 200
    assert {row["id"] for row in resp.data["results"]} == created
    assert _detail("admin-op", sorted(created)[0]).status_code == 200


def test_union_of_two_scoped_roles(tree):
    # Two scoped grants union their subtrees — neither swallows the other.
    root, child, other = tree
    _submitted(root)
    s_child = _submitted(child)
    s_other = _submitted(other)
    for scope in (child.id, other.id):
        UserRole.objects.create(
            user_id="two-roles",
            role_code_id="DIVISION_OPERATOR",
            scope_division_id=scope,
        )
    resp = _list("two-roles")
    assert {row["id"] for row in resp.data["results"]} == {s_child.pk, s_other.pk}


def test_visible_division_ids_single_tree_scan(django_assert_num_queries, tree):
    # 2 scoped-гранта → РОВНО 4 запроса: роли + duties + RolePermission + ОДИН
    # children_map full-scan (не скан на каждый грант — review 5.8c, Ловушка №4).
    _, child, other = tree
    for scope in (child.id, other.id):
        UserRole.objects.create(
            user_id="two-scan",
            role_code_id="DIVISION_OPERATOR",
            scope_division_id=scope,
        )
    with django_assert_num_queries(4):
        result = PermissionService.visible_division_ids(
            "two-scan", "daily_report.mark_update"
        )
    assert result == {child.id, other.id}


# -- Review 5.8c: point-check ↔ visibility parity and filter/scope interplay ---------


def test_scoped_detail_of_child_200(scoped_op, tree):
    # Parity pin: the retrieve point-check descends the same subtree the list
    # visibility does — a row visible in list opens on detail.
    _, child, _ = tree
    s_child = _submitted(child)
    resp = _detail(scoped_op, s_child.pk)
    assert resp.status_code == 200
    assert resp.data["id"] == s_child.pk


def test_scoped_foreign_division_filter_empty_200(scoped_op, tree):
    # Filter by someone else's division intersects with visibility → a quiet
    # empty 200 (list never errors on scope) — the deliberate contrast with
    # the detail 403 on the very same row.
    _, _, other = tree
    _submitted(other)
    resp = _list(scoped_op, division_id=str(other.id))
    assert resp.status_code == 200
    assert resp.data["count"] == 0


# -- Review 5.8c: method surface and pagination cap ----------------------------------


@pytest.mark.parametrize("method", ["put", "patch", "delete"])
def test_write_verbs_405_on_collection_anonymous(tree, method):
    assert getattr(_client(actor=None), method)(_list_url()).status_code == 405


def test_post_405_on_detail(global_op, tree):
    # The one authenticated path through the mixin's action=None branch on
    # this ViewSet: POST is served globally but unmapped on the detail route.
    root, _, _ = tree
    s = _submitted(root)
    resp = _client(global_op).post(_detail_url(s.pk), {}, format="json")
    assert resp.status_code == 405


def test_head_405_on_collection_and_detail(global_op, tree):
    # "No head": HEAD stays outside http_method_names on the read surface too.
    root, _, _ = tree
    s = _submitted(root)
    assert _client(global_op).head(_list_url()).status_code == 405
    assert _client(global_op).head(_detail_url(s.pk)).status_code == 405


def test_pagination_cap_enforced_at_request_level(tree):
    # Канон-пин 4.5: get_limit режет ?limit=5000 до max_limit=200 (поведение,
    # не только class-атрибуты).
    request = Request(APIRequestFactory().get("/", {"limit": "5000"}))
    assert DailySubmissionPagination().get_limit(request) == 200


def test_detail_leading_zero_pk_404(global_op, tree):
    # review 5.8c: "0<pk>" ≡ "<pk>" for int() — a leading-zero alias must be
    # absorbed as not-found, same class as "+pk" (canonical spelling only).
    root, _, _ = tree
    s = _submitted(root)
    resp = _detail(global_op, f"0{s.pk}")
    assert resp.status_code == 404
    assert resp.data["error_code"] == "ENTITY_NOT_FOUND"
