"""Aggregate permissions must not imply an unscoped wildcard.

All records below belong to pytest's rolled-back test database. Authentication
uses the same APIClient.force_authenticate boundary as test_rbac.py; permission
resolution, public writes and temporary-duty windows use real application code.
"""
from datetime import datetime, timedelta, timezone

import pytest
from django.contrib.auth.models import User
from rest_framework.test import APIClient

from organization_management.apps.divisions.models import Division
from organization_management.apps.operations import clock
from organization_management.apps.operations.models import (
    Permission,
    Role,
    RolePermission,
    TemporaryDutyPermission,
)
from organization_management.apps.operations.services import PermissionService, RoleAdminService


pytestmark = pytest.mark.django_db
MY_PERMISSIONS_URL = "/api/operations/my-permissions/"
TEMPORARY_DUTY_URL = "/api/operations/temporary-duty/"
NOW = datetime(2026, 10, 8, 7, 0, tzinfo=timezone.utc)


def _role(code, permission_codes):
    role, _ = Role.objects.get_or_create(code=code, defaults={"name": code})
    for code in permission_codes:
        permission, _ = Permission.objects.get_or_create(code=code, defaults={"name": code})
        RolePermission.objects.get_or_create(role_code=role, permission_code=permission)
    # A reused catalogue must not silently add rights to this test's subject.
    assert set(role.role_permissions.values_list("permission_code_id", flat=True)) == set(permission_codes)
    return role


def _client(username):
    user = User.objects.create_user(username=username, password="test-only")
    api = APIClient()
    api.force_authenticate(user)
    return api, user


def _administrator():
    api, user = _client("my-global-admin")
    role = _role("MP_GLOBAL_TEST_ADMIN", ["admin.roles"])
    RoleAdminService.assign_role(str(user.pk), role.code, None, actor="test")
    return api, user


def _read(api, division_id=None):
    params = {} if division_id is None else {"division_id": division_id}
    response = api.get(MY_PERMISSIONS_URL, params)
    assert response.status_code == 200, response.content
    return response.json()


@pytest.fixture
def tree():
    org = Division.objects.create(
        name="MP организация", code="mp-global-org",
        division_type=Division.DivisionType.ORGANIZATION,
    )
    department = Division.objects.create(
        name="MP свой департамент", code="mp-global-department", parent=org,
        division_type=Division.DivisionType.DEPARTMENT,
    )
    directorate = Division.objects.create(
        name="MP управление", code="mp-global-directorate", parent=department,
        division_type=Division.DivisionType.DIRECTORATE,
    )
    unit = Division.objects.create(
        name="MP отдел", code="mp-global-unit", parent=directorate,
        division_type=Division.DivisionType.DIVISION,
    )
    foreign = Division.objects.create(
        name="MP чужой департамент", code="mp-global-foreign", parent=org,
        division_type=Division.DivisionType.DEPARTMENT,
    )
    return {
        "department": department, "directorate": directorate, "unit": unit,
        "foreign": foreign,
        "subtree": {department.pk, directorate.pk, unit.pk},
    }


@pytest.mark.parametrize("unscoped", [True, False], ids=["global-custom-wildcard", "scoped-custom-wildcard"])
def test_public_wildcard_change_distinguishes_global_from_aggregate(tree, unscoped):
    api, user = _client("my-global-subject")
    actor_id = str(user.pk)
    custom = _role("MP_CUSTOM_WILDCARD", [])
    reader = _role("MP_GLOBAL_OBJECT_READER", ["object.view"])
    scope = None if unscoped else tree["department"].pk
    RoleAdminService.assign_role(actor_id, custom.code, scope, actor="test")
    RoleAdminService.assign_role(actor_id, reader.code, None, actor="test")

    before = _read(api)
    assert before["permissions"] == ["object.view"]
    assert before["global_permissions"] == ["object.view"]
    assert PermissionService.visible_division_ids(actor_id, "status.view") == set()

    # This is legal through the public role-admin API. The recipient's scope
    # stays unchanged when '*' is added to its already assigned custom role.
    admin, _ = _administrator()
    Permission.objects.get_or_create(code="*", defaults={"name": "Все права"})
    changed = admin.post(
        f"/api/operations/roles/{custom.code}/permissions/",
        {"add": ["*"], "remove": []}, format="json",
    )
    assert changed.status_code == 200, changed.content
    assert changed.json()["permissions"] == ["*"]

    expected_global = ["*", "object.view"] if unscoped else ["object.view"]
    aggregate = _read(api)
    assert aggregate["permissions"] == ["*", "object.view"]
    assert aggregate["global_permissions"] == expected_global
    assert {(row["code"], row["scope_division_id"]) for row in aggregate["roles"]} == {
        (custom.code, scope), (reader.code, None),
    }
    assert PermissionService.unscoped_permissions(actor_id) == set(expected_global)
    visible = PermissionService.visible_division_ids(actor_id, "status.view")
    if unscoped:
        assert visible is None
    else:
        assert visible == tree["subtree"]

    inside = _read(api, tree["unit"].pk)
    foreign = _read(api, tree["foreign"].pk)
    assert inside["permissions"] == ["*", "object.view"]
    assert foreign["permissions"] == (["*", "object.view"] if unscoped else ["object.view"])
    assert inside["global_permissions"] == foreign["global_permissions"] == expected_global
    assert inside["roles"] == foreign["roles"] == aggregate["roles"]
    assert PermissionService.has_permission(actor_id, "status.view", tree["foreign"].pk) is unscoped


@pytest.mark.parametrize(
    "state,start_hours,end_hours",
    [("active", -1, 1), ("expired", -2, -1), ("future", 1, 2), ("revoked", -1, 1)],
    ids=["active-global-duty", "expired-global-duty", "future-global-duty", "revoked-global-duty"],
)
def test_global_temporary_wildcard_respects_window_and_revocation(tree, state, start_hours, end_hours):
    api, user = _client("my-global-duty-subject")
    actor_id = str(user.pk)
    scoped = _role("MP_SCOPED_STATUS_READER", ["status.view"])
    reader = _role("MP_GLOBAL_OBJECT_READER", ["object.view"])
    RoleAdminService.assign_role(actor_id, scoped.code, tree["department"].pk, actor="test")
    RoleAdminService.assign_role(actor_id, reader.code, None, actor="test")

    # HQ_DUTY is an actual supported TemporaryDutyPermission choice. Its
    # wildcard is held only by a temporary grant, never a permanent UserRole.
    # Own a fixed catalogue inside this rolled-back pytest transaction, even
    # if migrations or a future fixture already populated this legal role.
    RolePermission.objects.filter(role_code_id="HQ_DUTY").delete()
    duty_role = _role("HQ_DUTY", ["*"])
    admin, administrator = _administrator()
    with clock.override(NOW):
        created = admin.post(TEMPORARY_DUTY_URL, {
            "user_id": actor_id, "duty_role_code": duty_role.code,
            "scope_division_id": None,
            "starts_at": (NOW + timedelta(hours=start_hours)).isoformat(),
            "ends_at": (NOW + timedelta(hours=end_hours)).isoformat(),
        }, format="json")
        assert created.status_code == 201, created.content
        grant = TemporaryDutyPermission.objects.get(pk=created.json()["id"])
        assert grant.user_id == actor_id
        assert grant.created_by == str(administrator.pk)
        assert grant.scope_division_id is None
        assert grant.duty_role_code == "HQ_DUTY"
        assert grant.is_active is True
        if state == "revoked":
            revoked = admin.post(f"{TEMPORARY_DUTY_URL}{grant.pk}/expire/")
            assert revoked.status_code == 200, revoked.content
            grant.refresh_from_db()
            assert grant.is_active is False

        active = state == "active"
        expected_global = ["*", "object.view"] if active else ["object.view"]
        own = _read(api)
        foreign = _read(api, tree["foreign"].pk)
        assert own["permissions"] == (["*", "object.view", "status.view"] if active else ["object.view", "status.view"])
        assert foreign["permissions"] == (["*", "object.view"] if active else ["object.view"])
        assert own["global_permissions"] == foreign["global_permissions"] == expected_global
        # The roles response lists permanent assignments, so clients cannot
        # recover the temporary global wildcard by searching that list.
        assert {(row["code"], row["scope_division_id"]) for row in own["roles"]} == {
            (scoped.code, tree["department"].pk), (reader.code, None),
        }
        assert foreign["roles"] == own["roles"]
        assert PermissionService.unscoped_permissions(actor_id) == set(expected_global)
        visible = PermissionService.visible_division_ids(actor_id, "status.view")
        if active:
            assert visible is None
        else:
            assert visible == tree["subtree"]
        assert PermissionService.has_permission(actor_id, "status.view", tree["foreign"].pk) is active


def test_schema_describes_global_permissions_as_a_required_string_list():
    from drf_spectacular.generators import SchemaGenerator

    schema = SchemaGenerator().get_schema(request=None, public=True)
    success = schema["paths"][MY_PERMISSIONS_URL]["get"]["responses"]["200"]
    body_ref = success["content"]["application/json"]["schema"]
    assert body_ref == {"$ref": "#/components/schemas/MyPermissionsResponse"}
    body = schema["components"]["schemas"]["MyPermissionsResponse"]
    assert body["type"] == "object"
    assert set(body["properties"]) == {
        "permissions", "global_permissions", "roles", "status_manage_division_ids", "duty_register_scope",
    }
    assert "global_permissions" in body["required"]
    global_codes = body["properties"]["global_permissions"]
    assert global_codes["type"] == "array"
    assert global_codes["items"]["type"] == "string"
    assert "status_manage_division_ids" in body["required"]
    status_scope = body["properties"]["status_manage_division_ids"]
    assert status_scope["type"] == "array"
    assert status_scope["items"]["type"] == "integer"
    assert status_scope["nullable"] is True
    assert "duty_register_scope" in body["required"]
    assert body["properties"]["duty_register_scope"]["type"] == "object"
