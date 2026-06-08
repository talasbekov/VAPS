import pytest
from django.core.management import call_command

from apps.operations.models import Permission, Role, RolePermission

pytestmark = pytest.mark.django_db


def test_seed_creates_all_roles():
    call_command("seed_operations")
    codes = set(Role.objects.values_list("code", flat=True))
    assert codes == {
        "ADMIN", "ORGD", "OMD", "SENIOR_COORDINATOR", "APPROVER",
        "DIVISION_OPERATOR", "VIEWER", "INTEGRATION_USER",
    }


def test_seed_creates_permissions_including_wildcard():
    call_command("seed_operations")
    codes = set(Permission.objects.values_list("code", flat=True))
    assert "*" in codes
    assert {"admin.roles", "assignment.create", "audit.view", "status.view"} <= codes


def test_admin_is_bound_to_wildcard():
    call_command("seed_operations")
    assert RolePermission.objects.filter(
        role_code="ADMIN", permission_code="*"
    ).exists()


def test_omd_matrix():
    call_command("seed_operations")
    omd_perms = set(
        RolePermission.objects.filter(role_code="OMD")
        .values_list("permission_code", flat=True)
    )
    assert omd_perms == {
        "assignment.create", "assignment.delete", "assignment.submit",
        "daily_report.generate", "brokerage.manage",
    }


def test_seed_is_idempotent():
    call_command("seed_operations")
    call_command("seed_operations")
    assert Role.objects.count() == 8
    assert RolePermission.objects.filter(role_code="OMD").count() == 5
