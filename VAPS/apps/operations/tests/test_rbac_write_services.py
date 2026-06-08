import datetime as dt

import pytest
from django.core.management import call_command
from django.utils import timezone

from apps.operations.models import TemporaryDutyPermission, UserRole
from apps.operations.services import RoleAdminService

pytestmark = pytest.mark.django_db


@pytest.fixture
def seeded():
    call_command("seed_operations")


def test_assign_role_creates_active_assignment(seeded):
    ur = RoleAdminService.assign_role("u1", "OMD", scope_division_id=None)
    assert ur.is_active is True
    assert UserRole.objects.filter(user_id="u1", role_code_id="OMD").count() == 1


def test_assign_role_is_idempotent_reactivates(seeded):
    RoleAdminService.assign_role("u1", "OMD")
    RoleAdminService.revoke_role("u1", "OMD")
    ur = RoleAdminService.assign_role("u1", "OMD")
    assert ur.is_active is True
    assert UserRole.objects.filter(user_id="u1", role_code_id="OMD").count() == 1


def test_revoke_role_deactivates(seeded):
    RoleAdminService.assign_role("u1", "OMD")
    RoleAdminService.revoke_role("u1", "OMD")
    assert UserRole.objects.get(user_id="u1", role_code_id="OMD").is_active is False


def test_grant_temporary_duty_creates_active_window(seeded):
    now = timezone.now()
    grant = RoleAdminService.grant_temporary_duty(
        user_id="u1", duty_role_code="OMD",
        starts_at=now, ends_at=now + dt.timedelta(hours=8), created_by="admin",
    )
    assert grant.is_active is True


def test_expire_temporary_duty_deactivates(seeded):
    now = timezone.now()
    grant = RoleAdminService.grant_temporary_duty(
        user_id="u1", duty_role_code="OMD",
        starts_at=now, ends_at=now + dt.timedelta(hours=8), created_by="admin",
    )
    RoleAdminService.expire_temporary_duty(grant.id)
    grant.refresh_from_db()
    assert grant.is_active is False
