"""Story 15.6 — `GET /api/operations/groups` behavioral tests."""

import pytest
from django.core.management import call_command
from django.urls import reverse
from rest_framework.test import APIClient

from apps.operations.events.models import Group
from apps.operations.rbac.models import Role, RolePermission, UserRole

pytestmark = pytest.mark.django_db


def _client(actor):
    c = APIClient()
    c.credentials(HTTP_X_USER_ID=actor)
    return c


@pytest.fixture
def seeded(db):
    call_command("seed_operations")


@pytest.fixture
def event_manager_client(seeded):
    role = Role.objects.create(code="TEST_EVENT_MANAGER_GROUPS", name="Test")
    RolePermission.objects.create(role_code=role, permission_code_id="event.manage")
    UserRole.objects.create(user_id="group-reader", role_code=role)
    return _client("group-reader")


def test_list_returns_only_active_sorted(event_manager_client):
    Group.objects.create(code="B", name="B", sort_order=2)
    Group.objects.create(code="A", name="A", sort_order=1)
    Group.objects.create(code="C", name="C", sort_order=3, is_active=False)
    resp = event_manager_client.get(reverse("ops-group-list"))
    assert resp.status_code == 200
    codes = [row["code"] for row in resp.data]
    assert codes == ["A", "B"]


def test_list_without_permission_is_403(seeded):
    resp = _client("nobody").get(reverse("ops-group-list"))
    assert resp.status_code == 403
