"""Screen access is independent of data reads; migrations preserve custom grants."""
from importlib import import_module, util

import pytest
from django.apps import apps
from django.core.management import call_command

from organization_management.apps.operations.management.commands.seed_operations import (
    PERMISSIONS, ROLE_PERMISSIONS,
)
from organization_management.apps.operations.models import Permission, Role, RolePermission, UserRole
from organization_management.apps.operations.services import PermissionService

pytestmark = pytest.mark.django_db
WORKSPACE = "status.workspace"
TWIN = "digital_twin.read"
READER = "DIGITAL_TWIN_READER"
MIGRATION = "organization_management.apps.operations.migrations.0144_workspace_and_digital_twin_access"


def migration():
    assert util.find_spec(MIGRATION) is not None, "The additive access migration is missing"
    return import_module(MIGRATION)


def grant(role, code):
    Role.objects.get_or_create(code=role, defaults={"name": role})
    Permission.objects.get_or_create(code=code, defaults={"name": code})
    RolePermission.objects.get_or_create(role_code_id=role, permission_code_id=code)


def test_seed_workspace_is_separate_from_status_reading():
    assert WORKSPACE in dict(PERMISSIONS)
    for code, permissions in ROLE_PERMISSIONS.items():
        expected = "status.view" in permissions and code not in {"DUTY_OFFICER", "INTEGRATION_USER"}
        assert (WORKSPACE in permissions) == expected, code
    assert {"status.view", "status.manage_root", "service_summary.view"} <= set(ROLE_PERMISSIONS["DUTY_OFFICER"])


def test_seed_technical_reader_has_no_personnel_or_write_grants():
    assert TWIN in dict(PERMISSIONS)
    assert ROLE_PERMISSIONS.get(READER) == [TWIN]
    assert TWIN not in ROLE_PERMISSIONS["INTEGRATION_USER"]


def test_migration_is_additive_idempotent_and_backfills_custom_readers():
    grant("CUSTOM_READER", "status.view")
    grant("DUTY_OFFICER", "status.view")
    grant("INTEGRATION_USER", "status.view")
    grant("CUSTOM_READER", "custom.retained")
    UserRole.objects.create(user_id="custom-actor", role_code_id="CUSTOM_READER", scope_division_id=123, is_active=False)
    RolePermission.objects.filter(role_code_id__in=["DUTY_OFFICER", "INTEGRATION_USER"], permission_code_id=WORKSPACE).delete()
    before_roles = list(UserRole.objects.order_by("pk").values())
    before_grants = set(RolePermission.objects.values_list("role_code_id", "permission_code_id"))
    operation = migration().add_workspaces_and_integration
    operation(apps, None)
    after_grants = set(RolePermission.objects.values_list("role_code_id", "permission_code_id"))
    assert before_grants <= after_grants
    assert ("CUSTOM_READER", WORKSPACE) in after_grants
    assert ("DUTY_OFFICER", WORKSPACE) not in after_grants
    assert ("INTEGRATION_USER", WORKSPACE) not in after_grants
    assert (READER, TWIN) in after_grants
    assert list(UserRole.objects.order_by("pk").values()) == before_roles
    operation(apps, None)
    assert set(RolePermission.objects.values_list("role_code_id", "permission_code_id")) == after_grants


def test_explicit_workspace_grant_and_mixed_roles_remain_effective():
    grant("DUTY_OFFICER", "status.view")
    grant("DUTY_OFFICER", WORKSPACE)
    grant("EXTRA_SCREEN", WORKSPACE)
    UserRole.objects.create(user_id="mixed-actor", role_code_id="DUTY_OFFICER")
    UserRole.objects.create(user_id="mixed-actor", role_code_id="EXTRA_SCREEN")
    migration().add_workspaces_and_integration(apps, None)
    assert WORKSPACE in PermissionService.effective_permissions("mixed-actor")
    assert RolePermission.objects.filter(role_code_id="DUTY_OFFICER", permission_code_id=WORKSPACE).exists()


def test_seed_repeat_preserves_custom_grants_and_user_assignments():
    grant("CUSTOM_READER", "status.view")
    grant("CUSTOM_READER", "custom.retained")
    UserRole.objects.create(user_id="persisted-assignment", role_code_id="CUSTOM_READER", scope_division_id=123)
    before = list(UserRole.objects.order_by("pk").values())
    call_command("seed_operations", verbosity=0)
    call_command("seed_operations", verbosity=0)
    assert list(UserRole.objects.order_by("pk").values()) == before
    assert RolePermission.objects.filter(role_code_id="CUSTOM_READER", permission_code_id="custom.retained").exists()
    assert set(RolePermission.objects.filter(role_code_id=READER).values_list("permission_code_id", flat=True)) == {TWIN}
