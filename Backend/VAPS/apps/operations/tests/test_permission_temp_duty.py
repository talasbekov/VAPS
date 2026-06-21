import datetime as dt

import pytest
from django.core.management import call_command
from django.utils import timezone

from apps.operations.rbac.models import Role, TemporaryDutyPermission
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
