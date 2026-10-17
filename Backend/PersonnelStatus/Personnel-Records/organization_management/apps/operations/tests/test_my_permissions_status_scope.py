"""Status actions must use their own write grant, not a broader read grant."""
import pytest

from organization_management.apps.operations.models import UserRole
from organization_management.apps.operations.services import RoleAdminService
from organization_management.apps.operations.tests.test_my_permissions_global_scopes import (
    _client, _read, _role, tree,
)

pytestmark = pytest.mark.django_db


@pytest.mark.parametrize("write_permission", ["status.manage", "*"])
def test_scoped_write_grant_does_not_inherit_global_read_scope(tree, write_permission):
    api, user = _client("status-scope-composite")
    reader = _role("STATUS_SCOPE_READER", ["status.view"])
    writer = _role("STATUS_SCOPE_WRITER", [write_permission])
    RoleAdminService.assign_role(str(user.pk), reader.code, None, actor="test")
    RoleAdminService.assign_role(str(user.pk), writer.code, tree["department"].pk, actor="test")

    response = _read(api)
    assert response["status_manage_division_ids"] == sorted(tree["subtree"])
    assert tree["foreign"].pk not in response["status_manage_division_ids"]
    # A contextual menu query must not change the actor's complete write scope.
    assert _read(api, tree["foreign"].pk)["status_manage_division_ids"] == response["status_manage_division_ids"]


@pytest.mark.parametrize("write_permission", ["status.manage", "*"])
def test_unscoped_status_writer_explicitly_reports_global_scope(tree, write_permission):
    api, user = _client("status-scope-global")
    role = _role("STATUS_SCOPE_GLOBAL", [write_permission])
    RoleAdminService.assign_role(str(user.pk), role.code, None, actor="test")
    assert _read(api)["status_manage_division_ids"] is None


@pytest.mark.parametrize("permissions", [[], ["status.view"], ["status.manage_root"]])
def test_unrelated_permissions_do_not_open_personnel_status_write_scope(tree, permissions):
    api, user = _client("status-scope-readonly")
    role = _role("STATUS_SCOPE_NOT_WRITER", permissions)
    RoleAdminService.assign_role(str(user.pk), role.code, None, actor="test")
    # manage_root is a separate operations action, not the personnel write API.
    assert _read(api)["status_manage_division_ids"] == []


def test_status_scope_updates_after_grant_revocation(tree):
    api, user = _client("status-scope-revoked")
    role = _role("STATUS_SCOPE_REVOKABLE", ["status.manage"])
    grant = RoleAdminService.assign_role(str(user.pk), role.code, tree["department"].pk, actor="test")
    assert _read(api)["status_manage_division_ids"] == sorted(tree["subtree"])
    UserRole.objects.filter(pk=grant.pk).update(is_active=False)
    assert _read(api)["status_manage_division_ids"] == []


def test_separate_custom_write_grants_are_unioned(tree):
    api, user = _client("status-scope-union")
    role = _role("STATUS_SCOPE_UNION", ["status.manage"])
    for key in ("directorate", "foreign"):
        RoleAdminService.assign_role(str(user.pk), role.code, tree[key].pk, actor="test")
    assert _read(api)["status_manage_division_ids"] == sorted(
        [tree["directorate"].pk, tree["unit"].pk, tree["foreign"].pk]
    )
