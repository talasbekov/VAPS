import datetime as dt

import pytest
from django.core.exceptions import ValidationError
from django.core.management import call_command
from django.utils import timezone
from rest_framework.test import APIClient

from apps.operations.rbac.models import TemporaryDutyPermission, UserRole
from apps.operations.services import RoleAdminService

pytestmark = pytest.mark.django_db


@pytest.fixture
def seeded():
    call_command("seed_operations")


def test_assign_role_fills_created_by(seeded):
    ur = RoleAdminService.assign_role("u1", "OMD", actor="admin-9")
    assert ur.created_by == "admin-9"
    ur.refresh_from_db()
    assert ur.created_by == "admin-9"


def test_assign_role_rejects_blank_actor(seeded):
    # Blank actor must not masquerade as an identity (NULL = honestly
    # actorless; "" would make that ambiguous).
    with pytest.raises(ValidationError):
        RoleAdminService.assign_role("u1", "OMD", actor="")
    with pytest.raises(ValidationError):
        RoleAdminService.assign_role("u1", "OMD", actor="  ")


def test_reactivation_keeps_original_creator(seeded):
    # created_by is append-once: who created the ROW, reactivation by another
    # actor must not rewrite it (create_defaults semantics).
    first = RoleAdminService.assign_role("u1", "OMD", actor="admin-1")
    RoleAdminService.revoke_role("u1", "OMD")
    second = RoleAdminService.assign_role("u1", "OMD", actor="admin-2")
    assert second.id == first.id  # same row reactivated, not a new one
    assert second.is_active is True
    assert second.created_by == "admin-1"


def test_temp_duty_created_by_taken_from_auth_not_payload(seeded):
    # ARCH-SEC-030 (spirit): identity comes from the auth contract only;
    # a client-supplied created_by must be ignored.
    UserRole.objects.create(user_id="admin-1", role_code_id="ADMIN")
    client = APIClient()
    client.credentials(HTTP_X_USER_ID="admin-1")
    now = timezone.now()
    resp = client.post(
        "/api/operations/temporary-duty/",
        {
            "user_id": "duty-1", "duty_role_code": "OMD",
            "starts_at": now.isoformat(),
            "ends_at": (now + dt.timedelta(hours=8)).isoformat(),
            "created_by": "evil",
        },
        format="json",
    )
    assert resp.status_code == 201
    grant = TemporaryDutyPermission.objects.get(user_id="duty-1")
    assert grant.created_by == "admin-1"
