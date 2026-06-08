import pytest
from django.core.management import call_command
from rest_framework.test import APIClient

from apps.operations.models import UserRole

pytestmark = pytest.mark.django_db


@pytest.fixture
def admin_client():
    call_command("seed_operations")
    UserRole.objects.create(user_id="admin-1", role_code_id="ADMIN")
    client = APIClient()
    client.credentials(HTTP_X_USER_ID="admin-1")
    return client


def test_list_roles_requires_admin():
    call_command("seed_operations")
    client = APIClient()
    client.credentials(HTTP_X_USER_ID="nobody")
    resp = client.get("/api/operations/roles/")
    assert resp.status_code == 403


def test_list_roles_returns_seeded(admin_client):
    resp = admin_client.get("/api/operations/roles/")
    assert resp.status_code == 200
    codes = {r["code"] for r in resp.json()["results"]}
    assert "ADMIN" in codes and "OMD" in codes


def test_list_permissions_returns_seeded(admin_client):
    resp = admin_client.get("/api/operations/permissions/")
    assert resp.status_code == 200
    codes = {p["code"] for p in resp.json()["results"]}
    assert "assignment.create" in codes
