"""Story 13.1a — HTTP surface for BugReport: create is open to ANY
authenticated user (cost ~0, no RBAC code needed), list/retrieve are gated
behind the ``bugreports.view`` permission code (granted only to the
DEVELOPER role, seed_operations.py) — proving anonymity-from-management is
real, not just documented: a plain authenticated user with no roles at all
can create but cannot list; DEVELOPER can list.
"""

import pytest
from django.core.management import call_command
from django.urls import reverse
from rest_framework.test import APIClient

from apps.operations.bugreports.models import BugReport
from apps.operations.rbac.models import UserRole

pytestmark = pytest.mark.django_db


def _client(actor):
    c = APIClient()
    c.credentials(HTTP_X_USER_ID=actor)
    return c


@pytest.fixture
def seeded():
    call_command("seed_operations")


def test_any_authenticated_user_can_create_a_report_without_any_role(seeded):
    client = _client("no-role-operator")
    resp = client.post(
        reverse("bugreport-list"),
        {
            "screen_path": "/daily-update",
            "app_version": "1.2.3",
            "build_sha": "abc123",
            "last_request_ids": ["req-1", "req-2"],
            "description": "Кнопка «Сдать день» не реагирует на клик.",
        },
        format="json",
    )
    assert resp.status_code == 201, resp.data
    assert resp.data["user_id"] == "no-role-operator"
    assert BugReport.objects.filter(user_id="no-role-operator").exists()


def test_unauthenticated_create_is_rejected(seeded):
    client = APIClient()  # no X-User-Id header at all
    resp = client.post(
        reverse("bugreport-list"),
        {"screen_path": "/x", "description": "y"},
        format="json",
    )
    assert resp.status_code == 403


def test_list_without_bugreports_view_permission_is_forbidden(seeded):
    reporter = _client("plain-operator")
    reporter.post(
        reverse("bugreport-list"),
        {"screen_path": "/x", "description": "y"},
        format="json",
    )
    # Same actor, no role granted at all — cannot see their own report either
    # (anonymity from everyone but the developer, per the story's letter).
    resp = reporter.get(reverse("bugreport-list"))
    assert resp.status_code == 403


def test_developer_role_can_list_reports(seeded):
    reporter = _client("plain-operator-2")
    reporter.post(
        reverse("bugreport-list"),
        {"screen_path": "/x", "description": "видит только разработчик"},
        format="json",
    )
    UserRole.objects.create(user_id="the-dev", role_code_id="DEVELOPER")
    dev_client = _client("the-dev")
    resp = dev_client.get(reverse("bugreport-list"))
    assert resp.status_code == 200
    # Paginated envelope (review: Blind Hunter — list() was unbounded before
    # this fix), not a bare list — {count, next, previous, results}.
    assert "results" in resp.data
    assert any(
        r["description"] == "видит только разработчик" for r in resp.data["results"]
    )


def test_ordinary_role_without_bugreports_view_stays_forbidden(seeded):
    # A real role (ORGD — leadership-adjacent) must NOT see reports by
    # default: anonymity from management is the whole point of AC-3.
    UserRole.objects.create(user_id="orgd-lead", role_code_id="ORGD")
    resp = _client("orgd-lead").get(reverse("bugreport-list"))
    assert resp.status_code == 403


def test_developer_can_retrieve_a_single_report_by_id(seeded):
    # Review (Edge Case Hunter): retrieve() had zero direct test coverage
    # before this fix — only indirect 403-path coverage via test_rbac_matrix.
    reporter = _client("plain-operator-3")
    created = reporter.post(
        reverse("bugreport-list"),
        {"screen_path": "/y", "description": "детальный просмотр"},
        format="json",
    )
    UserRole.objects.create(user_id="the-dev-2", role_code_id="DEVELOPER")
    dev_client = _client("the-dev-2")
    resp = dev_client.get(
        reverse("bugreport-detail", kwargs={"pk": created.data["id"]})
    )
    assert resp.status_code == 200
    assert resp.data["description"] == "детальный просмотр"


def test_retrieve_of_missing_id_is_404_for_a_developer(seeded):
    UserRole.objects.create(user_id="the-dev-3", role_code_id="DEVELOPER")
    resp = _client("the-dev-3").get(reverse("bugreport-detail", kwargs={"pk": 999999}))
    assert resp.status_code == 404
