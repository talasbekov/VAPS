"""Global RBAC administration needs an unscoped administrative grant.

All fixtures are confined to pytest's rolled-back database. Public API requests
use real Role/RolePermission/UserRole/TemporaryDutyPermission records and real
permission resolution; force_authenticate only supplies request identity, as in
the existing RBAC API tests. No permission helper is mocked.
"""
from datetime import datetime, timedelta, timezone

import pytest
from django.contrib.auth.models import User
from rest_framework.test import APIClient

from organization_management.apps.divisions.models import Division
from organization_management.apps.employees.models import Employee
from organization_management.apps.operations import clock
from organization_management.apps.operations.models import (
    Permission,
    Role,
    RolePermission,
    TemporaryDutyPermission,
    UserRole,
)
from organization_management.apps.operations.services import PermissionService, RoleAdminService
from organization_management.apps.staff_unit.models import StaffUnit


pytestmark = pytest.mark.django_db
NOW = datetime(2026, 10, 8, 8, 0, tzinfo=timezone.utc)
ROOT = "/api/operations/"
DENIED_MODES = (
    "scoped-wildcard",
    "scoped-admin-roles",
    "scoped-wildcard-global-reader",
)
GLOBAL_MODES = (
    "global-admin-roles",
    "global-wildcard",
    "scoped-wildcard-global-admin-roles",
)
READS = (
    "roles",
    "permissions",
    "accounts",
    "user-roles",
    "temporary-duty",
    "employee-options",
    "access-catalog",
)
WRITES = (
    "role-create",
    "role-update",
    "permission-create",
    "permission-update",
    "role-permissions",
    "user-role-revoke",
    "account-create",
    "account-update",
    "account-reset-password",
    "duty-grant",
    "duty-expire",
    # Last: a permitted self-grant must not supply the authority under test
    # to any of the preceding writes in the positive integration case.
    "self-grant-global-admin",
)


@pytest.fixture(autouse=True)
def fixed_clock():
    with clock.override(NOW):
        yield


def _permission(code):
    permission, _ = Permission.objects.get_or_create(code=code, defaults={"name": code})
    return permission


def _role(code, codes):
    role, _ = Role.objects.get_or_create(code=code, defaults={"name": code})
    # This owns only test-database catalogue links, including canonical ADMIN
    # and the legal HQ_DUTY role. Migration seed rights cannot alter expectations.
    RolePermission.objects.filter(role_code=role).delete()
    role.is_active = True
    role.save(update_fields=["is_active"])
    for permission_code in codes:
        RolePermission.objects.create(role_code=role, permission_code=_permission(permission_code))
    assert set(role.role_permissions.values_list("permission_code_id", flat=True)) == set(codes)
    return role


def _client(username):
    user = User.objects.create_user(username=username, password=None)
    assert not user.is_staff and not user.is_superuser
    api = APIClient()
    api.force_authenticate(user)
    return api, user


def _attach_employee(user, division=None):
    employee = Employee.objects.create(
        personnel_number=f"GA{user.pk}", last_name="Scope", first_name=user.username,
        user=user,
    )
    if division is not None:
        StaffUnit.objects.create(division=division, employee=employee, index=employee.pk)
        assert employee.staff_unit.division_id == division.pk
    return employee


@pytest.fixture
def world():
    organization = Division.objects.create(
        name="Global access organization", code="ga-org",
        division_type=Division.DivisionType.ORGANIZATION,
    )
    department = Division.objects.create(
        name="Granted department", code="ga-own", parent=organization,
        division_type=Division.DivisionType.DEPARTMENT,
    )
    own = Division.objects.create(
        name="Granted directorate", code="ga-own-unit", parent=department,
        division_type=Division.DivisionType.DIRECTORATE,
    )
    foreign_department = Division.objects.create(
        name="Foreign department", code="ga-foreign", parent=organization,
        division_type=Division.DivisionType.DEPARTMENT,
    )
    foreign = Division.objects.create(
        name="Foreign directorate", code="ga-foreign-unit", parent=foreign_department,
        division_type=Division.DivisionType.DIRECTORATE,
    )
    _role("ADMIN", ["*"])
    _role("HQ_DUTY", ["duty.view"])
    managed_role = _role("GA_MANAGED", ["object.view"])
    managed_permission = _permission("ga.managed")
    _permission("admin.roles")
    _target_api, target = _client("ga-target")
    employee = _attach_employee(target, foreign)
    grant = RoleAdminService.assign_role(str(target.pk), managed_role.code, None, actor="fixture")
    duty = RoleAdminService.grant_temporary_duty(
        user_id=str(target.pk), duty_role_code="HQ_DUTY", scope_division_id=None,
        starts_at=NOW - timedelta(hours=1), ends_at=NOW + timedelta(hours=1),
        created_by="fixture",
    )
    return {
        "department": department, "own": own, "foreign": foreign,
        "target": target, "employee": employee, "role": managed_role,
        "permission": managed_permission, "grant": grant, "duty": duty,
    }


def _actor(world, mode, *, placement="foreign", username="ga-subject"):
    api, user = _client(username)
    division = None if placement == "unlinked" else world[placement]
    _attach_employee(user, division)
    if mode.startswith("scoped-"):
        codes = ["admin.roles"] if mode == "scoped-admin-roles" else ["*"]
        role = _role(f"GA_SCOPED_{user.pk}", codes)
        RoleAdminService.assign_role(str(user.pk), role.code, world["department"].pk, actor="fixture")
    if mode in ("global-admin-roles", "scoped-wildcard-global-admin-roles"):
        role = _role(f"GA_GLOBAL_ADMIN_{user.pk}", ["admin.roles"])
        RoleAdminService.assign_role(str(user.pk), role.code, None, actor="fixture")
    elif mode == "global-wildcard":
        role = _role(f"GA_GLOBAL_STAR_{user.pk}", ["*"])
        RoleAdminService.assign_role(str(user.pk), role.code, None, actor="fixture")
    elif mode == "scoped-wildcard-global-reader":
        role = _role(f"GA_GLOBAL_READER_{user.pk}", ["object.view"])
        RoleAdminService.assign_role(str(user.pk), role.code, None, actor="fixture")
    else:
        assert mode in DENIED_MODES
    global_codes = PermissionService.unscoped_permissions(str(user.pk))
    if mode in DENIED_MODES:
        assert "*" not in global_codes and "admin.roles" not in global_codes
        assert PermissionService.effective_permissions(str(user.pk)) & {"*", "admin.roles"}
    else:
        assert global_codes & {"*", "admin.roles"}
    world["actor"] = user
    return api, user


def _state():
    # Include password hashes, account flags, catalogue rows, all assignment
    # fields and employee/account bindings. A 403 after a partial write is RED.
    return {
        name: list(model.objects.order_by(model._meta.pk.name).values())
        for name, model in (
            ("roles", Role), ("permissions", Permission),
            ("role_permissions", RolePermission), ("user_roles", UserRole),
            ("temporary_duties", TemporaryDutyPermission), ("accounts", User),
            ("employees", Employee), ("staff_units", StaffUnit),
        )
    }


def _read_probe(world, resource):
    if resource == "employee-options":
        return f"{ROOT}accounts/employee-options/", {"search": world["employee"].personnel_number}
    if resource == "access-catalog":
        return "/api/ops/access-catalog/", {"search": "admin.roles"}
    if resource == "roles":
        return f"{ROOT}roles/", {"search": world["role"].code}
    if resource == "permissions":
        return f"{ROOT}permissions/", {"search": world["permission"].code}
    if resource == "accounts":
        return f"{ROOT}accounts/", {"search": world["target"].username}
    return f"{ROOT}{resource}/", {"user_id": str(world["target"].pk)}


def _assert_read(world, resource, response):
    rows = response.json()["results"]
    assert rows, (resource, response.content)
    if resource == "roles":
        assert any(row["code"] == world["role"].code for row in rows)
    elif resource == "permissions":
        assert any(row["code"] == world["permission"].code for row in rows)
    elif resource == "accounts":
        assert any(row["id"] == world["target"].pk and row["employee_id"] == world["employee"].pk for row in rows)
    elif resource == "user-roles":
        assert any(row["id"] == world["grant"].pk and row["user_id"] == str(world["target"].pk) for row in rows)
    elif resource == "temporary-duty":
        assert any(row["id"] == world["duty"].pk and row["user_id"] == str(world["target"].pk) for row in rows)
    elif resource == "employee-options":
        assert any(row["id"] == world["employee"].pk for row in rows)
    else:
        administrative = next(row for row in rows if row["code"] == "admin.roles")
        routes = {(row["method"], row["path"]) for row in administrative["functions"]}
        # The new helper must remain discoverable by the access-catalog AST
        # reader; a 200 with its management routes silently missing is RED.
        assert ("GET", f"{ROOT}roles/") in routes
        assert ("POST", f"{ROOT}user-roles/") in routes
        assert ("POST", f"{ROOT}roles/<pk>/permissions/") in routes


def _write_probe(world, action):
    target_id = world["target"].pk
    probes = {
        "role-create": ("post", f"{ROOT}roles/", {"code": "GA_CREATED", "name": "Created role"}, 201),
        "role-update": ("patch", f"{ROOT}roles/{world['role'].code}/", {"name": "Changed role", "is_active": False}, 200),
        "permission-create": ("post", f"{ROOT}permissions/", {"code": "ga.created", "name": "Created permission"}, 201),
        "permission-update": ("patch", f"{ROOT}permissions/{world['permission'].code}/", {"name": "Changed permission", "is_active": False}, 200),
        "role-permissions": ("post", f"{ROOT}roles/{world['role'].code}/permissions/", {"add": ["*"], "remove": ["object.view"]}, 200),
        "user-role-revoke": ("delete", f"{ROOT}user-roles/{world['grant'].pk}/", {}, 204),
        "account-create": ("post", f"{ROOT}accounts/", {"username": "ga-created-account", "first_name": "Created"}, 201),
        "account-update": ("patch", f"{ROOT}accounts/{target_id}/", {"first_name": "Changed account", "is_active": False}, 200),
        "account-reset-password": ("post", f"{ROOT}accounts/{target_id}/reset-password/", {}, 200),
        "duty-grant": ("post", f"{ROOT}temporary-duty/", {
            "user_id": str(target_id), "duty_role_code": "HQ_DUTY", "scope_division_id": None,
            "starts_at": (NOW + timedelta(hours=2)).isoformat(),
            "ends_at": (NOW + timedelta(hours=3)).isoformat(),
        }, 201),
        "duty-expire": ("post", f"{ROOT}temporary-duty/{world['duty'].pk}/expire/", {}, 200),
        "self-grant-global-admin": ("post", f"{ROOT}user-roles/", {
            "user_id": str(world["actor"].pk), "role_code": "ADMIN", "scope_division_id": None,
        }, 201),
    }
    return probes[action]


def _assert_write(world, action, response):
    if action == "role-create":
        assert Role.objects.get(pk="GA_CREATED").name == "Created role"
    elif action == "role-update":
        world["role"].refresh_from_db()
        assert world["role"].name == "Changed role" and not world["role"].is_active
    elif action == "permission-create":
        assert Permission.objects.get(pk="ga.created").name == "Created permission"
    elif action == "permission-update":
        world["permission"].refresh_from_db()
        assert world["permission"].name == "Changed permission" and not world["permission"].is_active
    elif action == "role-permissions":
        assert set(RolePermission.objects.filter(role_code=world["role"]).values_list("permission_code_id", flat=True)) == {"*"}
        assert response.json()["permissions"] == ["*"]
    elif action == "user-role-revoke":
        world["grant"].refresh_from_db()
        assert not world["grant"].is_active
    elif action == "account-create":
        created = User.objects.get(username="ga-created-account")
        assert created.pk == response.json()["id"] and created.first_name == "Created"
        assert created.check_password(response.json()["temporary_password"])
    elif action == "account-update":
        world["target"].refresh_from_db()
        assert world["target"].first_name == "Changed account" and not world["target"].is_active
    elif action == "account-reset-password":
        world["target"].refresh_from_db()
        assert world["target"].check_password(response.json()["temporary_password"])
    elif action == "duty-grant":
        created = TemporaryDutyPermission.objects.get(pk=response.json()["id"])
        assert created.user_id == str(world["target"].pk) and created.scope_division_id is None
        assert created.duty_role_code == "HQ_DUTY" and created.is_active
        assert created.created_by == str(world["actor"].pk)
    elif action == "duty-expire":
        world["duty"].refresh_from_db()
        assert not world["duty"].is_active
    else:
        created = UserRole.objects.get(pk=response.json()["id"])
        assert created.user_id == str(world["actor"].pk) and created.role_code_id == "ADMIN"
        assert created.scope_division_id is None and created.is_active
        assert "*" in PermissionService.unscoped_permissions(str(world["actor"].pk))


class TestGlobalRbacReads:
    @pytest.mark.parametrize("mode", DENIED_MODES)
    @pytest.mark.parametrize("resource", READS)
    def test_scoped_administration_cannot_read_global_rbac(self, world, mode, resource):
        # Even the actor's own staff division is inside the scoped grant;
        # these global surfaces must not turn into an employee-scope gate.
        api, _ = _actor(world, mode, placement="own")
        before = _state()
        url, params = _read_probe(world, resource)
        response = api.get(url, params)
        assert response.status_code == 403, response.content
        assert _state() == before

    @pytest.mark.parametrize("mode", GLOBAL_MODES)
    def test_unscoped_administration_can_read_each_global_surface(self, world, mode):
        api, _ = _actor(world, mode)
        before = _state()
        for resource in READS:
            url, params = _read_probe(world, resource)
            response = api.get(url, params)
            assert response.status_code == 200, (resource, response.content)
            _assert_read(world, resource, response)
        assert _state() == before


class TestGlobalRbacWrites:
    @pytest.mark.parametrize("mode", DENIED_MODES)
    @pytest.mark.parametrize("action", WRITES)
    def test_denied_write_changes_no_rbac_or_account_state(self, world, mode, action):
        api, _ = _actor(world, mode, placement="own")
        before = _state()
        method, url, payload, _expected = _write_probe(world, action)
        response = getattr(api, method)(url, payload, format="json")
        assert response.status_code == 403, response.content
        assert _state() == before

    @pytest.mark.parametrize("mode", GLOBAL_MODES)
    def test_global_administration_can_persist_each_public_write(self, world, mode):
        api, _ = _actor(world, mode)
        for action in WRITES:
            method, url, payload, expected = _write_probe(world, action)
            response = getattr(api, method)(url, payload, format="json")
            assert response.status_code == expected, (action, response.content)
            _assert_write(world, action, response)


class TestPersonnelAssociationDoesNotDefineGlobalAuthority:
    @pytest.mark.parametrize("mode", ["global-admin-roles", "global-wildcard"])
    @pytest.mark.parametrize("placement", ["own", "foreign", "unlinked"])
    def test_unscoped_authority_is_independent_of_staff_division(self, world, mode, placement):
        api, _ = _actor(world, mode, placement=placement)
        response = api.get(f"{ROOT}accounts/{world['target'].pk}/")
        assert response.status_code == 200, response.content
        assert response.json()["id"] == world["target"].pk
        assert response.json()["employee_id"] == world["employee"].pk


class TestPublicWildcardSelfEscalation:
    @pytest.mark.parametrize("unrelated_global_reader", [False, True], ids=["scoped-only", "mixed-unrelated-global"])
    def test_public_catalog_wildcard_addition_does_not_allow_global_self_grant(self, world, unrelated_global_reader):
        api, subject = _client("ga-escalation-subject")
        _attach_employee(subject, world["own"])
        role = _role("GA_LATER_WILDCARD", [])
        scoped = RoleAdminService.assign_role(str(subject.pk), role.code, world["department"].pk, actor="fixture")
        if unrelated_global_reader:
            reader = _role("GA_UNRELATED_READER", ["object.view"])
            RoleAdminService.assign_role(str(subject.pk), reader.code, None, actor="fixture")
        trusted, _ = _actor(world, "global-admin-roles", username="ga-trusted")
        edited = trusted.post(f"{ROOT}roles/{role.code}/permissions/", {"add": ["*"]}, format="json")
        assert edited.status_code == 200, edited.content
        assert edited.json()["permissions"] == ["*"]
        scoped.refresh_from_db()
        assert scoped.scope_division_id == world["department"].pk and scoped.is_active
        expected_global = {"object.view"} if unrelated_global_reader else set()
        assert PermissionService.unscoped_permissions(str(subject.pk)) == expected_global
        assert PermissionService.effective_permissions(str(subject.pk)) == expected_global | {"*"}
        before = _state()
        response = api.post(f"{ROOT}user-roles/", {
            "user_id": str(subject.pk), "role_code": "ADMIN", "scope_division_id": None,
        }, format="json")
        assert response.status_code == 403, response.content
        assert _state() == before
        assert PermissionService.unscoped_permissions(str(subject.pk)) == expected_global


class TestAccessAdminSelfRevocation:
    @pytest.mark.parametrize("spare_permission", ["admin.roles", "*"])
    def test_scoped_spare_cannot_replace_last_global_administrative_grant(self, world, spare_permission):
        api, subject = _actor(world, "global-admin-roles")
        primary = UserRole.objects.get(user_id=str(subject.pk), scope_division_id=None)
        role = _role("GA_SCOPED_SPARE", [spare_permission])
        RoleAdminService.assign_role(str(subject.pk), role.code, world["department"].pk, actor="fixture")
        before = _state()
        response = api.delete(f"{ROOT}user-roles/{primary.pk}/")
        assert response.status_code == 422, response.content
        assert response.json()["error_code"] == "LAST_ACCESS_ADMIN_ROLE"
        assert _state() == before
        assert PermissionService.unscoped_permissions(str(subject.pk)) == {"admin.roles"}

    @pytest.mark.parametrize("spare_permission", ["admin.roles", "*"])
    def test_another_global_grant_allows_own_role_revocation(self, world, spare_permission):
        api, subject = _actor(world, "global-admin-roles")
        primary = UserRole.objects.get(user_id=str(subject.pk), scope_division_id=None)
        role = _role("GA_GLOBAL_SPARE", [spare_permission])
        spare = RoleAdminService.assign_role(str(subject.pk), role.code, None, actor="fixture")
        response = api.delete(f"{ROOT}user-roles/{primary.pk}/")
        assert response.status_code == 204, response.content
        primary.refresh_from_db()
        spare.refresh_from_db()
        assert not primary.is_active and spare.is_active
        assert PermissionService.unscoped_permissions(str(subject.pk)) == {spare_permission}
        assert api.get(f"{ROOT}roles/").status_code == 200


class TestTemporaryDutyGlobalAdministration:
    @pytest.mark.parametrize("permission_code", ["admin.roles", "*"])
    @pytest.mark.parametrize("state,start_hours,end_hours", [
        ("active", -1, 1), ("expired", -2, -1),
        ("future", 1, 2), ("revoked", -1, 1),
    ])
    def test_only_active_unscoped_duty_authorizes_global_rbac(self, world, permission_code, state, start_hours, end_hours):
        api, subject = _actor(world, "scoped-wildcard-global-reader")
        _role("HQ_DUTY", [permission_code])
        duty = RoleAdminService.grant_temporary_duty(
            user_id=str(subject.pk), duty_role_code="HQ_DUTY", scope_division_id=None,
            starts_at=NOW + timedelta(hours=start_hours), ends_at=NOW + timedelta(hours=end_hours),
            created_by="fixture",
        )
        if state == "revoked":
            RoleAdminService.expire_temporary_duty(duty.pk)
        before = _state()
        response = api.get(f"{ROOT}roles/")
        assert response.status_code == (200 if state == "active" else 403), response.content
        created = api.post(f"{ROOT}roles/", {"code": "GA_DUTY_CREATED", "name": "Duty-created role"}, format="json")
        assert created.status_code == (201 if state == "active" else 403), created.content
        if state == "active":
            assert Role.objects.get(pk="GA_DUTY_CREATED").name == "Duty-created role"
        else:
            assert _state() == before

    @pytest.mark.parametrize("permission_code", ["admin.roles", "*"])
    def test_active_scoped_duty_does_not_authorize_global_rbac(self, world, permission_code):
        api, subject = _actor(world, "scoped-wildcard-global-reader", placement="own")
        _role("HQ_DUTY", [permission_code])
        RoleAdminService.grant_temporary_duty(
            user_id=str(subject.pk), duty_role_code="HQ_DUTY", scope_division_id=world["department"].pk,
            starts_at=NOW - timedelta(hours=1), ends_at=NOW + timedelta(hours=1),
            created_by="fixture",
        )
        before = _state()
        assert api.get(f"{ROOT}roles/").status_code == 403
        response = api.post(f"{ROOT}user-roles/", {
            "user_id": str(subject.pk), "role_code": "ADMIN", "scope_division_id": None,
        }, format="json")
        assert response.status_code == 403, response.content
        assert _state() == before
