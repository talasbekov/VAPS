import datetime as dt

import pytest
from django.core.management import call_command
from django.utils import timezone

from apps.operations.rbac.models import Role, TemporaryDutyPermission, UserRole
from apps.operations.services import PermissionService

pytestmark = pytest.mark.django_db


@pytest.fixture
def omd_duty_role():
    call_command("seed_operations")
    # Ensure an OMD role with a known permission exists (seeded), and a duty maps to it.
    return Role.objects.get(code="OMD")


def test_active_temp_duty_grants_role_permissions(omd_duty_role):
    now = timezone.now()
    TemporaryDutyPermission.objects.create(
        user_id="duty-1", duty_role_code="OMD",
        starts_at=now - dt.timedelta(hours=1), ends_at=now + dt.timedelta(hours=1),
        created_by="admin",
    )
    assert PermissionService.has_permission("duty-1", "assignment.create") is True


def test_expired_temp_duty_does_not_grant(omd_duty_role):
    now = timezone.now()
    TemporaryDutyPermission.objects.create(
        user_id="duty-1", duty_role_code="OMD",
        starts_at=now - dt.timedelta(hours=3), ends_at=now - dt.timedelta(hours=1),
        created_by="admin",
    )
    assert PermissionService.has_permission("duty-1", "assignment.create") is False


def test_future_temp_duty_does_not_grant(omd_duty_role):
    now = timezone.now()
    TemporaryDutyPermission.objects.create(
        user_id="duty-1", duty_role_code="OMD",
        starts_at=now + dt.timedelta(hours=1), ends_at=now + dt.timedelta(hours=3),
        created_by="admin",
    )
    assert PermissionService.has_permission("duty-1", "assignment.create") is False


def test_inactive_temp_duty_does_not_grant(omd_duty_role):
    now = timezone.now()
    TemporaryDutyPermission.objects.create(
        user_id="duty-1", duty_role_code="OMD", is_active=False,
        starts_at=now - dt.timedelta(hours=1), ends_at=now + dt.timedelta(hours=1),
        created_by="admin",
    )
    assert PermissionService.has_permission("duty-1", "assignment.create") is False


# Story 15.11b (FR-34, "ОРГД read-only"): a temporary ORGD duty grant must
# NOT carry the permanent ORGD role's mutating permissions.
@pytest.fixture
def orgd_duty_role():
    call_command("seed_operations")
    return Role.objects.get(code="ORGD")


def test_orgd_duty_only_grants_view_permissions(orgd_duty_role):
    now = timezone.now()
    TemporaryDutyPermission.objects.create(
        user_id="duty-orgd", duty_role_code="ORGD",
        starts_at=now - dt.timedelta(hours=1), ends_at=now + dt.timedelta(hours=1),
        created_by="admin",
    )
    perms = PermissionService.effective_permissions("duty-orgd")
    # ROLE_PERMISSIONS["ORGD"] = audit.view, daily_report.generate,
    # daily_report.override_block, personnel.view, personnel.edit,
    # orgstructure.view, orgstructure.manage, document.upload, document.view
    # — only the .view-suffixed subset survives the duty-only read-only filter.
    assert perms == {
        "audit.view", "personnel.view", "orgstructure.view", "document.view"
    }


def test_orgd_duty_denies_mutating_permission(orgd_duty_role):
    now = timezone.now()
    TemporaryDutyPermission.objects.create(
        user_id="duty-orgd", duty_role_code="ORGD",
        starts_at=now - dt.timedelta(hours=1), ends_at=now + dt.timedelta(hours=1),
        created_by="admin",
    )
    assert PermissionService.has_permission("duty-orgd", "personnel.edit") is False
    assert PermissionService.has_permission("duty-orgd", "orgstructure.manage") is False
    assert PermissionService.has_permission("duty-orgd", "document.upload") is False
    assert PermissionService.has_permission("duty-orgd", "personnel.view") is True


def test_permanent_orgd_role_keeps_full_permissions(orgd_duty_role):
    UserRole.objects.create(user_id="staff-orgd", role_code_id="ORGD")
    assert PermissionService.has_permission("staff-orgd", "personnel.edit") is True
    assert PermissionService.has_permission("staff-orgd", "orgstructure.manage") is True


def test_permanent_and_duty_orgd_together_keeps_full_permissions(orgd_duty_role):
    now = timezone.now()
    UserRole.objects.create(user_id="dual-orgd", role_code_id="ORGD")
    TemporaryDutyPermission.objects.create(
        user_id="dual-orgd", duty_role_code="ORGD",
        starts_at=now - dt.timedelta(hours=1), ends_at=now + dt.timedelta(hours=1),
        created_by="admin",
    )
    assert PermissionService.has_permission("dual-orgd", "personnel.edit") is True


def test_omd_duty_unaffected_by_orgd_read_only_filter(omd_duty_role):
    now = timezone.now()
    TemporaryDutyPermission.objects.create(
        user_id="duty-omd", duty_role_code="OMD",
        starts_at=now - dt.timedelta(hours=1), ends_at=now + dt.timedelta(hours=1),
        created_by="admin",
    )
    assert PermissionService.has_permission("duty-omd", "assignment.create") is True
    assert PermissionService.has_permission("duty-omd", "brokerage.manage") is True


def test_orgd_duty_visible_division_ids_excludes_mutating_scope(orgd_duty_role):
    import uuid as uuid_module

    now = timezone.now()
    division_id = uuid_module.uuid4()
    TemporaryDutyPermission.objects.create(
        user_id="duty-orgd", duty_role_code="ORGD", scope_division_id=division_id,
        starts_at=now - dt.timedelta(hours=1), ends_at=now + dt.timedelta(hours=1),
        created_by="admin",
    )
    denied = PermissionService.visible_division_ids("duty-orgd", "personnel.edit")
    assert denied == set()
    allowed = PermissionService.visible_division_ids("duty-orgd", "personnel.view")
    assert allowed == {division_id}
