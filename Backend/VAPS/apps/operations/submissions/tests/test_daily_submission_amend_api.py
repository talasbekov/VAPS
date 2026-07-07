"""Story 5.8b — API amend сдачи (POST /api/operations/daily-submissions/{id}/amend/).

Proves the HTTP contract ONLY — the amendment domain (re-snapshot, flip,
version lock, the 409 race) is already proven at service level by
test_amendment_service (5.4a, 32 tests with 5.4b):

- coarse gate: RequirePermissionMixin {"amend": daily_report.correct}
  (anon → 403, role without the code → 403, holder → passes);
- division scope: ensure_division_scope re-checks the code against the
  RESOLVED submission's division subtree → 403 on someone else's division;
- form: reason (TextField — no max_length) + sanction (max_length=255, the
  model's CharField(255) — an unbounded value would be a DataError → 500)
  → 400 VALIDATION_ERROR; system fields in the payload are ignored
  (ARCH-SEC-030 + the 5.4b provenance ref triggered_by_status_id);
- pk resolution via DailySubmissionSelector.by_id → 404 ENTITY_NOT_FOUND,
  §36 envelope;
- 201 nine-field projection (reuse of the 5.8a serializer) + chain semantics:
  a stale-version pk amends the SAME chain (amend_day takes latest_for).

NO test for 422 NO_SUBMISSION_TO_AMEND: it is UNREACHABLE through this
endpoint — an existing pk implies the chain exists, so latest_for is never
empty. The code stays service-level (5.4a); a «test for every code» here
would assert nothing (5.7c lesson: no vacuous tests).

Fixtures are this suite's own copies of the 5.8a ones (moving them to a
conftest is a separate hygiene task, deliberately not done here).
"""

from datetime import date

import pytest
from django.core.management import call_command
from django.urls import reverse
from rest_framework.test import APIClient

from apps.core import clock
from apps.core.models import Division, DivisionType, Organization
from apps.operations.rbac.models import UserRole
from apps.operations.submissions.models import DailySubmission
from apps.operations.submissions.services import submit_day

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
    # amend_day applies no date window — the pin only makes the submit_day
    # precondition ({today, today+1}) deterministic.
    with clock.override(TODAY):
        yield


@pytest.fixture
def tree():
    """seed_operations roles + a root→child subtree and an unrelated division."""
    call_command("seed_operations")
    org = Organization.objects.create(name="HQ", code="HQ-AMD")
    dt = DivisionType.objects.get_or_create(
        code="management", defaults={"name": "Управление"}
    )[0]
    root = Division.objects.create(
        organization=org, type_code=dt, name="root", code="R-AMD"
    )
    child = Division.objects.create(
        organization=org, type_code=dt, name="child", code="C-AMD", parent=root
    )
    other = Division.objects.create(
        organization=org, type_code=dt, name="other", code="O-AMD"
    )
    return root, child, other


@pytest.fixture
def scoped_op(tree):
    """DIVISION_OPERATOR (holds daily_report.correct) scoped to root."""
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
    """VIEWER — has a role (status.view), NOT daily_report.correct: the
    «есть роль, нет кода» discriminator for the coarse gate."""
    UserRole.objects.create(
        user_id="viewer", role_code_id="VIEWER", scope_division_id=None
    )
    return "viewer"


def _client(actor="op-global"):
    c = APIClient()
    if actor is not None:
        c.credentials(HTTP_X_USER_ID=actor)
    return c


def _url(pk):
    return reverse("ops-daily-submission-amend", kwargs={"pk": str(pk)})


def _submitted(division):
    """A submitted day to amend — via the submit_day SERVICE (faster than the
    5.8a endpoint and independent of its contract)."""
    return submit_day(division_id=division.id, business_date=TODAY, actor="seed-op")


def _amend(actor, pk, extra=None):
    payload = {"reason": "уточнение состава", "sanction": "замечание"}
    payload.update(extra or {})
    return _client(actor).post(_url(pk), payload, format="json")


# -- AC-1: route mounted, POST-only ---------------------------------------------


@pytest.mark.parametrize("method", ["get", "head", "put", "patch", "delete"])
def test_non_post_verbs_405(global_op, tree, method):
    # AC-1 pins EVERY non-POST verb, authed AND anon (5.8a review lesson #1);
    # head added by review 5.8b — it is outside http_method_names too.
    root, _, _ = tree
    submission = _submitted(root)
    assert getattr(_client(global_op), method)(_url(submission.pk)).status_code == 405


@pytest.mark.parametrize("method", ["get", "head", "put", "patch", "delete"])
def test_non_post_verbs_405_anonymous(tree, method):
    root, _, _ = tree
    submission = _submitted(root)
    assert getattr(_client(actor=None), method)(_url(submission.pk)).status_code == 405


# (test_detail_route_absent_404 removed by 5.8c: the retrieve route now exists;
# the detail contract is owned by test_daily_submission_read_api.)


# -- AC-2: coarse permission gate -------------------------------------------------


def test_anonymous_post_403(tree):
    root, _, _ = tree
    submission = _submitted(root)
    resp = _amend(None, submission.pk)
    assert resp.status_code == 403
    assert resp.data["error_code"] == "PERMISSION_DENIED"


def test_actor_without_correct_403(viewer, tree):
    root, _, _ = tree
    submission = _submitted(root)
    resp = _amend(viewer, submission.pk)
    assert resp.status_code == 403
    assert resp.data["error_code"] == "PERMISSION_DENIED"


# -- AC-3: division scope (the load-bearing 403) -----------------------------------


def test_foreign_division_403(scoped_op, tree):
    # details carries the SERVER-resolved division_id of someone else's
    # submission (unlike 5.8a, where it echoed client input). Together with pk
    # enumerability (test_nonexistent_pk_404_for_scoped_holder_too) this is an
    # accepted trade-off (review 5.8b): closed contour, in-org division_id is
    # not a secret, and 403 diagnosability wins over hiding the division.
    _, _, other = tree
    submission = _submitted(other)
    resp = _amend(scoped_op, submission.pk)
    assert resp.status_code == 403
    assert resp.data["error_code"] == "PERMISSION_DENIED"
    assert resp.data["details"] == {"division_id": str(other.id)}


def test_parent_division_403_for_child_scoped(child_scoped_op, tree):
    # Upward direction: scope must not climb the tree — a child-scoped holder
    # amending the PARENT's submission is the mirror of the subtree-allow case
    # (review 5.8b: the only DENY probe before was an unrelated division).
    root, _, _ = tree
    submission = _submitted(root)
    resp = _amend(child_scoped_op, submission.pk)
    assert resp.status_code == 403
    assert resp.data["error_code"] == "PERMISSION_DENIED"
    assert resp.data["details"] == {"division_id": str(root.id)}


def test_own_division_itself_201(scoped_op, tree):
    root, _, _ = tree
    submission = _submitted(root)
    assert _amend(scoped_op, submission.pk).status_code == 201


def test_own_subtree_division_201(scoped_op, tree):
    _, child, _ = tree
    submission = _submitted(child)
    assert _amend(scoped_op, submission.pk).status_code == 201


def test_global_role_any_division_201(global_op, tree):
    _, _, other = tree
    submission = _submitted(other)
    assert _amend(global_op, submission.pk).status_code == 201


# -- AC-4: form validation (400) + system fields ignored ---------------------------


@pytest.mark.parametrize(
    "payload",
    [
        {"sanction": "замечание"},  # reason missing
        {"reason": "", "sanction": "замечание"},
        {"reason": "   ", "sanction": "замечание"},  # trim → "" → allow_blank
        {"reason": "уточнение"},  # sanction missing
        {"reason": "уточнение", "sanction": ""},
        {"reason": "уточнение", "sanction": "   "},
        # 256 > model CharField(255): without max_length on the form this would
        # reach Postgres as a DataError → 500 (5.8a whitespace-500 class).
        {"reason": "уточнение", "sanction": "s" * 256},
        # review 5.8b: JSON null and nested types must be a 400, not a 500.
        {"reason": None, "sanction": "замечание"},  # allow_null=False
        {"reason": ["уточнение"], "sanction": "замечание"},  # not a string
        {"reason": {"text": "уточнение"}, "sanction": "замечание"},
    ],
)
def test_bad_form_400(global_op, tree, payload):
    root, _, _ = tree
    submission = _submitted(root)
    resp = _client(global_op).post(_url(submission.pk), payload, format="json")
    assert resp.status_code == 400
    assert resp.data["error_code"] == "VALIDATION_ERROR"


def test_non_dict_payload_400(global_op, tree):
    # review 5.8b: a JSON array body fails the serializer's dict expectation —
    # 400 VALIDATION_ERROR through the unified handler, never a 500.
    root, _, _ = tree
    submission = _submitted(root)
    resp = _client(global_op).post(_url(submission.pk), ["уточнение"], format="json")
    assert resp.status_code == 400
    assert resp.data["error_code"] == "VALIDATION_ERROR"


def test_sanction_at_model_limit_201(global_op, tree):
    # review 5.8b: the positive boundary — exactly 255 (the model CharField
    # limit) passes; pairs with the 256 rejection in test_bad_form_400.
    root, _, _ = tree
    submission = _submitted(root)
    assert _amend(global_op, submission.pk, {"sanction": "s" * 255}).status_code == 201


def test_payload_system_fields_ignored(global_op, tree):
    # ARCH-SEC-030: identity only from request.actor_id; triggered_by_status_id
    # is the 5.4b hook's provenance ref — accepting it would let a client write
    # arbitrary EmployeeStatus references (a false provenance chain).
    root, _, _ = tree
    submission = _submitted(root)
    resp = _amend(
        global_op,
        submission.pk,
        extra={"submitted_by": "evil", "actor": "evil", "triggered_by_status_id": 777},
    )
    assert resp.status_code == 201
    created = DailySubmission.objects.get(pk=resp.data["id"])
    assert created.submitted_by == global_op
    assert created.triggered_by_status_id is None


# -- AC-5: pk resolution → 404, §36 envelope ---------------------------------------


def test_nonexistent_pk_404_and_envelope(global_op, tree):
    resp = _amend(global_op, 999999)
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


def test_nonexistent_pk_404_for_scoped_holder_too(scoped_op, tree):
    # Deliberate contrast with 5.8a's fail-closed phantom-division 403: here the
    # pk resolves BEFORE the scope gate (no division to scope against yet), so
    # ANY holder gets 404 — submission existence by integer pk is enumerable.
    # A conscious REST trade-off: pks carry no secret (division access is still
    # gated), and resolving first keeps 404/403 semantics honest.
    resp = _amend(scoped_op, 999999)
    assert resp.status_code == 404
    assert resp.data["error_code"] == "ENTITY_NOT_FOUND"


def test_non_integer_pk_404(global_op, tree):
    # The router's pk pattern admits non-integers; by_id absorbs them as
    # «not found» instead of leaking a ValueError → 500 (the 5.8a review's
    # boundary-lets-garbage-through class).
    resp = _amend(global_op, "abc")
    assert resp.status_code == 404
    assert resp.data["error_code"] == "ENTITY_NOT_FOUND"


@pytest.mark.parametrize("pk", ["-1", "0", "9" * 30])
def test_out_of_range_pk_404(global_op, tree, pk):
    # review 5.8b: negative pks die on the by_id digits guard; the 30-digit one
    # overflows int8 and lives on Django's EmptyResultSet — pinned here so a
    # framework change can't silently reintroduce the garbage → 500 class.
    resp = _amend(global_op, pk)
    assert resp.status_code == 404
    assert resp.data["error_code"] == "ENTITY_NOT_FOUND"


def test_alias_pk_spellings_404(global_op, tree):
    # review 5.8b: bare int() would resolve "+<pk>", " <pk> " and arabic-indic
    # digits to the SAME row — write aliases forking one resource across many
    # URLs (logs/audit identity). by_id admits canonical ASCII digits only.
    root, _, _ = tree
    submission = _submitted(root)
    arabic = str(submission.pk).translate(str.maketrans("0123456789", "٠١٢٣٤٥٦٧٨٩"))
    for alias in (f"+{submission.pk}", f" {submission.pk} ", arabic):
        resp = _amend(global_op, alias)
        assert resp.status_code == 404, repr(alias)
        assert resp.data["error_code"] == "ENTITY_NOT_FOUND"


# -- AC-6: 201 projection + chain semantics ----------------------------------------


def test_amend_201_shape(global_op, tree):
    root, _, _ = tree
    submission = _submitted(root)
    resp = _amend(global_op, submission.pk)
    assert resp.status_code == 201
    assert set(resp.data) == PROJECTION_FIELDS  # no snapshot, no amend fields
    assert resp.data["division_id"] == str(root.id)
    assert resp.data["business_date"] == str(TODAY)
    assert resp.data["version"] == 2
    assert resp.data["event"] == "AMENDED"
    assert resp.data["is_current"] is True
    assert resp.data["late"] is False  # always, per 5.4a Решение №5
    assert resp.data["submitted_by"] == global_op


def test_stale_version_pk_amends_same_chain(global_op, tree):
    # Д1 (chain semantics): {id} identifies the chain (division_id,
    # business_date), NOT the head — amend_day takes latest_for itself. A
    # reference to the superseded v1 must produce v3, not a second chain.
    root, _, _ = tree
    v1 = _submitted(root)
    assert _amend(global_op, v1.pk).status_code == 201  # v2, v1 now stale
    resp = _amend(global_op, v1.pk)
    assert resp.status_code == 201
    assert resp.data["version"] == 3
    assert resp.data["is_current"] is True
    chain = DailySubmission.objects.filter(division_id=root.id, business_date=TODAY)
    assert chain.count() == 3
    assert chain.filter(is_current=True).count() == 1
