from uuid import uuid4

import pytest

from organization_management.apps.operations.models import UserRole
from organization_management.apps.operations.models_audit import OpsAuditLog
from organization_management.apps.operations.models_duty_log import OpsDutyLogEntry
from organization_management.apps.ops.tests.service_duty_support import REGISTER, duty_log_scene, log_payload

pytestmark = pytest.mark.django_db


def recovery(client, nonce):
    return client.get(REGISTER + f"requests/{nonce}/")


def test_creation_result_lookup_is_owned_by_actor_and_does_not_write(duty_log_scene):
    scene = duty_log_scene
    payload = log_payload(scene)
    created = scene["manager"].post(REGISTER, payload, format="json")
    assert created.status_code == 201, created.data
    before = (OpsDutyLogEntry.objects.count(), OpsAuditLog.objects.count())
    found = recovery(scene["manager"], payload["client_request_id"])
    assert found.status_code == 200, found.data
    assert found.data["saved"] is True
    assert found.data["record"]["id"] == created.data["id"]
    foreign = recovery(scene["wrong"], payload["client_request_id"])
    assert foreign.status_code == 200, foreign.data
    assert foreign.data == {"saved": False, "closed": False, "record": None}
    assert recovery(scene["manager"], uuid4()).data == {"saved": False, "closed": False, "record": None}
    assert before == (OpsDutyLogEntry.objects.count(), OpsAuditLog.objects.count())


def test_recovery_can_find_a_saved_record_after_employee_deactivation(duty_log_scene):
    scene = duty_log_scene
    payload = log_payload(scene)
    created = scene["manager"].post(REGISTER, payload, format="json")
    assert created.status_code == 201, created.data
    person = scene["people"][0]
    person.is_active = False
    person.save(update_fields=["is_active"])
    assert recovery(scene["manager"], payload["client_request_id"]).data["record"]["id"] == created.data["id"]


def test_creation_recovery_confirms_own_result_without_disclosing_a_revoked_scope(duty_log_scene):
    scene = duty_log_scene
    payload = log_payload(scene)
    created = scene["manager"].post(REGISTER, payload, format="json")
    assert created.status_code == 201, created.data
    UserRole.objects.filter(user_id=str(scene["user"].pk)).update(scope_division_id=scene["other"].pk)
    found = recovery(scene["manager"], payload["client_request_id"])
    assert found.status_code == 200, found.data
    assert found.data == {"saved": True, "closed": False, "record": None}


def test_recovery_rejects_malformed_uuid(duty_log_scene):
    response = recovery(duty_log_scene["manager"], "invalid-identifier")
    assert response.status_code in (400, 404), response.data
