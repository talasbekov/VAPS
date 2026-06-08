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


def test_assign_role(admin_client):
    resp = admin_client.post(
        "/api/operations/user-roles/",
        {"user_id": "u9", "role_code": "OMD"}, format="json",
    )
    assert resp.status_code == 201
    assert UserRole.objects.filter(user_id="u9", role_code_id="OMD", is_active=True).exists()


def test_list_user_roles_filtered_by_user(admin_client):
    admin_client.post(
        "/api/operations/user-roles/", {"user_id": "u9", "role_code": "OMD"}, format="json"
    )
    resp = admin_client.get("/api/operations/user-roles/?user_id=u9")
    assert resp.status_code == 200
    rows = resp.json()["results"]
    assert all(r["user_id"] == "u9" for r in rows)
    assert len(rows) == 1


def test_revoke_role(admin_client):
    admin_client.post(
        "/api/operations/user-roles/", {"user_id": "u9", "role_code": "OMD"}, format="json"
    )
    ur = UserRole.objects.get(user_id="u9", role_code_id="OMD")
    resp = admin_client.delete(f"/api/operations/user-roles/{ur.id}/")
    assert resp.status_code == 204
    ur.refresh_from_db()
    assert ur.is_active is False


def test_assign_requires_admin():
    call_command("seed_operations")
    client = APIClient()
    client.credentials(HTTP_X_USER_ID="nobody")
    resp = client.post(
        "/api/operations/user-roles/", {"user_id": "u9", "role_code": "OMD"}, format="json"
    )
    assert resp.status_code == 403
