import pytest
from django.core.management import call_command

from apps.operations.rbac.models import Permission, Role, RolePermission

pytestmark = pytest.mark.django_db


def test_seed_creates_all_roles():
    call_command("seed_operations")
    codes = set(Role.objects.values_list("code", flat=True))
    assert codes == {
        "ADMIN",
        "ORGD",
        "OMD",
        "SENIOR_COORDINATOR",
        "APPROVER",
        "DIVISION_OPERATOR",
        "VIEWER",
        "INTEGRATION_USER",
        "DEVELOPER",  # Story 13.1a — bugreports.view holder
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
        RolePermission.objects.filter(role_code="OMD").values_list(
            "permission_code", flat=True
        )
    )
    assert omd_perms == {
        "assignment.create",
        "assignment.delete",
        "assignment.submit",
        "daily_report.generate",
        "daily_report.override_block",
        "brokerage.manage",
        # core API perms (story 2.13, provisional): OMD needs roster visibility.
        "personnel.view",
        "orgstructure.view",
    }


def test_orgd_holds_override_block():
    # Review 6.10b 2026-07-13: ORGD's grant of the new right was unpinned —
    # only OMD was asserted; a seed regression would have passed silently.
    call_command("seed_operations")
    orgd_perms = set(
        RolePermission.objects.filter(role_code="ORGD").values_list(
            "permission_code", flat=True
        )
    )
    assert "daily_report.override_block" in orgd_perms
    assert len(orgd_perms) == 9


def test_seed_is_idempotent():
    call_command("seed_operations")
    call_command("seed_operations")
    assert Role.objects.count() == 9  # Story 13.1a added DEVELOPER
    assert RolePermission.objects.filter(role_code="OMD").count() == 8
    assert RolePermission.objects.filter(role_code="ORGD").count() == 9
