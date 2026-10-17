from datetime import timedelta

import pytest

from organization_management.apps.operations.clock import override
from organization_management.apps.operations.models import TemporaryDutyPermission
from organization_management.apps.ops.tests.service_duty_support import NOW, duty_log_scene

pytestmark = pytest.mark.django_db


@pytest.mark.parametrize("global_grant", [False, True])
def test_scope_signature_changes_when_a_temporary_read_grant_expires(duty_log_scene, global_grant):
    scene = duty_log_scene
    client = scene["reader"]
    actor = client.handler._force_user
    TemporaryDutyPermission.objects.create(
        user_id=str(actor.pk), duty_role_code="LOG_READER",
        scope_division_id=None if global_grant else scene["other"].pk,
        starts_at=NOW - timedelta(hours=1), ends_at=NOW + timedelta(seconds=1),
        created_by=str(scene["user"].pk),
    )
    before = client.get("/api/operations/my-permissions/")
    assert before.status_code == 200, before.data
    with override(NOW + timedelta(seconds=2)):
        after = client.get("/api/operations/my-permissions/")
    assert after.status_code == 200, after.data
    assert before.data["permissions"] == after.data["permissions"]
    assert before.data["roles"] == after.data["roles"]
    assert before.data["status_manage_division_ids"] == after.data["status_manage_division_ids"]
    if not global_grant:
        assert before.data["global_permissions"] == after.data["global_permissions"]
    expected = None if global_grant else sorted([scene["first"].pk, scene["other"].pk])
    assert before.data["duty_register_scope"]["read"] == expected
    assert after.data["duty_register_scope"]["read"] == [scene["first"].pk]
    assert after.data["duty_register_scope"]["write"] == []
    assert after.data["duty_register_scope"]["dispatch"] == []
