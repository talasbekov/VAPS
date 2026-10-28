import pytest
from django.contrib.auth.models import User
from rest_framework.test import APIClient
from organization_management.apps.divisions.models import Division
from organization_management.apps.operations.models import Permission, Role, RolePermission, UserRole

pytestmark = pytest.mark.django_db

def grant(user, code, permissions, scope=None):
    role = Role.objects.create(code=code, name=code)
    for code in permissions:
        permission, _ = Permission.objects.get_or_create(code=code, defaults={"name": code})
        RolePermission.objects.create(role_code=role, permission_code=permission)
    UserRole.objects.create(user_id=str(user.pk), role_code=role, scope_division_id=scope)
    return role

def setup():
    admin = User.objects.create_user(username="access-inspector")
    target = User.objects.create_user(username="access-target")
    grant(admin, "ACCESS_INSPECTOR", ["admin.roles"])
    client = APIClient(); client.force_authenticate(admin)
    return client, target

def test_access_snapshot_reports_scope_and_contributing_role():
    client, target = setup()
    division = Division.objects.create(name="Test unit", division_type="department")
    grant(target, "SCOPED_READER", ["status.view"], division.pk)
    response = client.get(f"/api/operations/accounts/{target.pk}/effective-access/")
    assert response.status_code == 200
    body = response.json()
    assert body["permissions"] == ["status.view"]
    assert body["globalPermissions"] == []
    assert body["grants"][0]["scopeDivisionId"] == division.pk
    assert body["grants"][0]["roleCode"] == "SCOPED_READER"
    assert body["grants"][0]["permissions"][0]["code"] == "status.view"

def test_inactive_role_and_permission_do_not_appear_as_effective():
    client, target = setup()
    role = grant(target, "REVOKED_READER", ["status.view"])
    role.is_active = False; role.save()
    response = client.get(f"/api/operations/accounts/{target.pk}/effective-access/")
    assert response.status_code == 200
    assert response.json()["permissions"] == []
    assert response.json()["grants"] == []

def test_scoped_administrator_cannot_inspect_other_accounts():
    target = User.objects.create_user(username="target")
    admin = User.objects.create_user(username="scoped-admin")
    division = Division.objects.create(name="Test scope", division_type="department")
    grant(admin, "SCOPED_ACCESS_ADMIN", ["admin.roles"], division.pk)
    client = APIClient(); client.force_authenticate(admin)
    assert client.get(f"/api/operations/accounts/{target.pk}/effective-access/").status_code == 403

def test_blocked_account_has_no_usable_permissions():
    client, target = setup()
    grant(target, "READER", ["status.view"])
    target.is_active=False; target.save()
    response=client.get(f"/api/operations/accounts/{target.pk}/effective-access/")
    assert response.status_code==200
    assert response.json()["isActive"] is False
    assert response.json()["permissions"]==[]

def test_snapshot_uses_one_time_for_temporary_grants(monkeypatch):
    from datetime import datetime, timedelta, timezone
    from organization_management.apps.operations.clock import Clock
    from organization_management.apps.operations.models import TemporaryDutyPermission
    from organization_management.apps.operations.account_access import account_effective_access
    _, target = setup()
    role = Role.objects.create(code="SNAP_TEMP", name="Temporary reader")
    permission, _ = Permission.objects.get_or_create(code="status.view", defaults={"name":"Read"})
    RolePermission.objects.create(role_code=role, permission_code=permission)
    before=datetime(2026,10,27,10,0,tzinfo=timezone.utc)
    TemporaryDutyPermission.objects.create(user_id=str(target.pk), duty_role_code=role.code,
        starts_at=before-timedelta(hours=1), ends_at=before+timedelta(seconds=1), is_active=True, created_by="test")
    calls=[]
    def moving_clock():
        calls.append(1)
        return before if len(calls)<=2 else before+timedelta(seconds=2)
    monkeypatch.setattr(Clock, "now", moving_clock)
    snapshot=account_effective_access(target)
    assert snapshot["permissions"]==["status.view"]
    assert snapshot["globalPermissions"]==["status.view"]
    assert snapshot["grants"][0]["sources"]==["temporary"]
    assert len(calls)==1


