import datetime as dt
import uuid

import pytest
from django.core.management import call_command
from django.utils import timezone
from rest_framework.test import APIClient

from apps.audit.models import AuditLog
from apps.operations.rbac.models import TemporaryDutyPermission, UserRole

pytestmark = pytest.mark.django_db


@pytest.fixture
def admin_client():
    call_command("seed_operations")
    UserRole.objects.create(user_id="admin-1", role_code_id="ADMIN")
    client = APIClient()
    client.credentials(HTTP_X_USER_ID="admin-1")
    return client


def test_grant_temporary_duty(admin_client):
    now = timezone.now()
    resp = admin_client.post(
        "/api/operations/temporary-duty/",
        {
            "user_id": "duty-1", "duty_role_code": "OMD",
            "starts_at": now.isoformat(),
            "ends_at": (now + dt.timedelta(hours=8)).isoformat(),
            "created_by": "admin-1",
        },
        format="json",
    )
    assert resp.status_code == 201
    assert TemporaryDutyPermission.objects.filter(
        user_id="duty-1", is_active=True
    ).exists()


def test_expire_temporary_duty(admin_client):
    now = timezone.now()
    grant = TemporaryDutyPermission.objects.create(
        user_id="duty-1", duty_role_code="OMD",
        starts_at=now, ends_at=now + dt.timedelta(hours=8), created_by="admin-1",
    )
    resp = admin_client.post(f"/api/operations/temporary-duty/{grant.id}/expire/")
    assert resp.status_code == 200
    grant.refresh_from_db()
    assert grant.is_active is False


def test_temp_duty_grant_emits_audit_row(admin_client):
    now = timezone.now()
    resp = admin_client.post(
        "/api/operations/temporary-duty/",
        {
            "user_id": "duty-1", "duty_role_code": "OMD",
            "starts_at": now.isoformat(),
            "ends_at": (now + dt.timedelta(hours=8)).isoformat(),
            "created_by": "admin-1",
        },
        format="json",
    )
    grant_id = resp.json()["id"]
    log = AuditLog.objects.get(action="TEMP_DUTY_GRANTED")
    assert log.actor_user_id == "admin-1"
    assert log.entity_id == uuid.UUID(int=grant_id)
    assert log.new_value["user_id"] == "duty-1"
    assert log.new_value["duty_role_code"] == "OMD"


def test_temp_duty_expire_emits_audit_row(admin_client):
    now = timezone.now()
    grant = TemporaryDutyPermission.objects.create(
        user_id="duty-1", duty_role_code="OMD",
        starts_at=now, ends_at=now + dt.timedelta(hours=8), created_by="admin-1",
    )
    resp = admin_client.post(f"/api/operations/temporary-duty/{grant.id}/expire/")
    assert resp.status_code == 200
    log = AuditLog.objects.get(action="TEMP_DUTY_EXPIRED")
    assert log.actor_user_id == "admin-1"
    assert log.entity_id == uuid.UUID(int=grant.id)


def test_temp_duty_repeat_expire_does_not_duplicate_audit(admin_client):
    now = timezone.now()
    grant = TemporaryDutyPermission.objects.create(
        user_id="duty-1", duty_role_code="OMD",
        starts_at=now, ends_at=now + dt.timedelta(hours=8), created_by="admin-1",
    )
    admin_client.post(f"/api/operations/temporary-duty/{grant.id}/expire/")
    admin_client.post(f"/api/operations/temporary-duty/{grant.id}/expire/")
    assert AuditLog.objects.filter(action="TEMP_DUTY_EXPIRED").count() == 1


def test_temp_duty_list_does_not_emit_audit_row(admin_client):
    admin_client.get("/api/operations/temporary-duty/")
    assert not AuditLog.objects.filter(
        action__in=["TEMP_DUTY_GRANTED", "TEMP_DUTY_EXPIRED"]
    ).exists()


def test_my_permissions_reflects_role_and_duty(admin_client):
    # admin-1 holds ADMIN -> wildcard present in effective set.
    resp = admin_client.get("/api/operations/my-permissions/")
    assert resp.status_code == 200
    assert "*" in resp.json()["permissions"]


def test_my_permissions_denied_without_user_id():
    call_command("seed_operations")
    client = APIClient()
    resp = client.get("/api/operations/my-permissions/")
    assert resp.status_code == 403
