"""Workspace entitlement is independent of role names and never expands scope."""
import pytest
from django.contrib.auth.models import User
from rest_framework.test import APIClient
from organization_management.apps.divisions.models import Division
from organization_management.apps.operations.models import Permission, Role, RolePermission, UserRole

pytestmark = pytest.mark.django_db
URL = "/api/operations/service-summary-context/"


def test_workspace_permission_catalog_names_the_context_endpoint():
    from organization_management.apps.ops.access_catalog import catalog
    rows = catalog()["service_summary.view"]
    assert any(row["path"] == URL and row["method"] == "GET" and row["kind"] == "gate" for row in rows)


def client(grants, role="CUSTOM_SUMMARY"):
    user = User.objects.create_user(username="summary-context")
    for index, (code, scope) in enumerate(grants):
        role_code = role if len(grants) == 1 else f"{role}_{index}"
        Role.objects.get_or_create(code=role_code, defaults={"name": role_code})
        Permission.objects.get_or_create(code=code, defaults={"name": code})
        RolePermission.objects.get_or_create(role_code_id=role_code, permission_code_id=code)
        UserRole.objects.create(user_id=str(user.pk), role_code_id=role_code, scope_division_id=scope)
    api = APIClient()
    api.force_authenticate(user)
    return api


@pytest.fixture
def root():
    Division.objects.create(name="Detached", division_type="department")
    return Division.objects.create(name="Service", division_type="organization")


@pytest.mark.parametrize("codes", [[], ["status.view"], ["service_summary.view"]])
def test_both_permissions_are_required_even_for_technical_role(root, codes):
    api = client([(code, None) for code in codes], role="DUTY_OFFICER")
    assert api.get(URL).status_code == 403


@pytest.mark.parametrize("scoped", [False, True])
def test_custom_permission_grants_open_canonical_workspace(root, scoped):
    scope = root.pk if scoped else None
    response = client([("status.view", scope), ("service_summary.view", scope)]).get(URL)
    assert response.status_code == 200
    assert response.json() == {"root_division_id": root.pk, "root_name": "Service", "can_generate_root_summary": False}


@pytest.mark.parametrize("restricted", ["status.view", "service_summary.view"])
def test_either_scope_excluding_organization_root_is_rejected(root, restricted):
    department = Division.objects.create(name="Department", division_type="department", parent=root)
    grants = [(code, department.pk if code == restricted else root.pk) for code in ["status.view", "service_summary.view"]]
    response = client(grants).get(URL)
    assert response.status_code == 403
    assert response.json()["error_code"] == "PERMISSION_DENIED"


def test_unscoped_wildcard_keeps_access(root):
    assert client([("*", None)]).get(URL).status_code == 200


def test_scoped_wildcard_cannot_open_organization_workspace(root):
    department = Division.objects.create(name="Department", division_type="department", parent=root)
    assert client([("*", department.pk)]).get(URL).status_code == 403


def test_missing_organization_root_is_not_replaced_with_department():
    Division.objects.create(name="Department", division_type="department")
    assert client([("*", None)]).get(URL).status_code == 409


@pytest.mark.parametrize("grant", ["missing", "department", "root", "global", "department_wildcard", "root_wildcard", "global_wildcard"])
def test_root_action_capability_requires_generation_permission_at_root(root, grant):
    department = Division.objects.create(name="Department", division_type="department", parent=root)
    grants = [("status.view", None), ("service_summary.view", None)]
    if grant != "missing":
        code = "*" if "wildcard" in grant else "daily_report.generate"
        scope = department.pk if grant.startswith("department") else root.pk if grant.startswith("root") else None
        grants.append((code, scope))
    response = client(grants).get(URL)
    assert response.status_code == 200
    assert response.json()["can_generate_root_summary"] is (grant not in {"missing", "department", "department_wildcard"})


@pytest.mark.parametrize("change", ["remove_permission", "narrow_scope"])
def test_revoked_generation_grant_keeps_read_access_but_removes_actions(root, change):
    api = client([("status.view", None), ("service_summary.view", None), ("daily_report.generate", root.pk)])
    assert api.get(URL).json()["can_generate_root_summary"] is True
    if change == "remove_permission":
        RolePermission.objects.filter(permission_code_id="daily_report.generate").delete()
    else:
        department = Division.objects.create(name="Department", division_type="department", parent=root)
        UserRole.objects.filter(role_code_id="CUSTOM_SUMMARY_2").update(scope_division_id=department.pk)
    response = api.get(URL)
    assert response.status_code == 200
    assert response.json()["can_generate_root_summary"] is False


def test_additive_migration_preserves_assignments_and_grants_only_duty_role():
    from importlib import import_module
    from django.apps import apps
    migration = import_module("organization_management.apps.operations.migrations.0135_service_summary_view_permission")
    for code in ["DUTY_OFFICER", "DEPARTMENT_EXPENSE_OFFICER", "CUSTOM_READER"]:
        Role.objects.get_or_create(code=code, defaults={"name": code})
    before = list(UserRole.objects.values())
    migration.grant_existing_duty_role(apps, None)
    migration.grant_existing_duty_role(apps, None)
    assert set(RolePermission.objects.filter(permission_code_id="service_summary.view").values_list("role_code_id", flat=True)) == {"DUTY_OFFICER"}
    assert list(UserRole.objects.values()) == before


def test_seed_preserves_duty_workspace_access_without_granting_department_role():
    from django.core.management import call_command
    call_command("seed_operations")
    assert set(RolePermission.objects.filter(permission_code_id="service_summary.view").values_list("role_code_id", flat=True)) == {"DUTY_OFFICER"}


def test_migration_forward_and_reverse_preserve_custom_grants_and_assignments(root):
    from importlib import import_module
    from django.apps import apps
    migration = import_module("organization_management.apps.operations.migrations.0135_service_summary_view_permission")
    client([("service_summary.view", root.pk)], role="CUSTOM_READER")
    Role.objects.get_or_create(code="DUTY_OFFICER", defaults={"name": "Duty"})
    before = list(UserRole.objects.values())
    migration.grant_existing_duty_role(apps, None)
    migration.grant_existing_duty_role(apps, None)
    migration.Migration.operations[0].reverse_code(apps, None)
    assert set(RolePermission.objects.filter(permission_code_id="service_summary.view").values_list("role_code_id", flat=True)) == {"DUTY_OFFICER", "CUSTOM_READER"}
    assert list(UserRole.objects.values()) == before
