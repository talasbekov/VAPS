import pytest
from django.core.management import call_command

from apps.operations.models import UserRole
from apps.operations.services import PermissionService

pytestmark = pytest.mark.django_db


@pytest.fixture
def seeded():
    call_command("seed_operations")


def test_admin_has_any_permission_via_wildcard(seeded):
    UserRole.objects.create(user_id="admin-1", role_code_id="ADMIN")
    assert PermissionService.has_permission("admin-1", "assignment.create") is True
    assert PermissionService.has_permission("admin-1", "anything.at.all") is True


def test_granted_permission_returns_true(seeded):
    UserRole.objects.create(user_id="omd-1", role_code_id="OMD")
    assert PermissionService.has_permission("omd-1", "assignment.create") is True


def test_ungranted_permission_returns_false(seeded):
    UserRole.objects.create(user_id="omd-1", role_code_id="OMD")
    assert PermissionService.has_permission("omd-1", "audit.view") is False


def test_no_roles_returns_false(seeded):
    assert PermissionService.has_permission("ghost", "status.view") is False


def test_inactive_role_does_not_grant(seeded):
    UserRole.objects.create(user_id="omd-1", role_code_id="OMD", is_active=False)
    assert PermissionService.has_permission("omd-1", "assignment.create") is False
