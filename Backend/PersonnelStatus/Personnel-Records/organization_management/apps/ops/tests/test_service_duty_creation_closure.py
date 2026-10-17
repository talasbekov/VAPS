"""A lost create response must not trap the operator or permit a late duplicate."""
import pytest

from organization_management.apps.operations.models_duty_log import OpsDutyLogEntry
from organization_management.apps.operations.models_settings import OpsDictionaryEntry
from organization_management.apps.operations.models import UserRole
from organization_management.apps.operations.services import RoleAdminService
from organization_management.apps.ops.tests.service_duty_support import REGISTER, duty_log_scene, log_payload

pytestmark = pytest.mark.django_db


def request_path(body):
    return REGISTER + "requests/" + body["client_request_id"] + "/"


def test_closing_unknown_attempt_is_durable_idempotent_and_blocks_late_post(duty_log_scene):
    scene = duty_log_scene
    body = log_payload(scene)
    url = request_path(body)
    for _ in range(2):
        response = scene["manager"].post(url + "close/", {}, format="json")
        assert response.status_code == 200, response.data
        assert response.data == {"saved": False, "closed": True, "record": None}
    assert scene["manager"].get(url).data == {"saved": False, "closed": True, "record": None}
    late = scene["manager"].post(REGISTER, body, format="json")
    assert late.status_code == 409
    assert late.data["error_code"] == "DUTY_CREATION_CLOSED"
    assert OpsDutyLogEntry.objects.count() == 0
    newer = scene["manager"].post(REGISTER, log_payload(scene), format="json")
    assert newer.status_code == 201


def test_close_returns_existing_saved_record_without_cancelling_it(duty_log_scene):
    scene = duty_log_scene
    body = log_payload(scene)
    saved = scene["manager"].post(REGISTER, body, format="json")
    for _ in range(2):
        response = scene["manager"].post(request_path(body) + "close/", {}, format="json")
        assert response.status_code == 200
        assert response.data["saved"] is True and response.data["closed"] is False
        assert response.data["record"]["id"] == saved.data["id"]
        assert response.data["record"]["state"] == "PLANNED"
    assert OpsDutyLogEntry.objects.count() == 1
    assert scene["manager"].post(REGISTER, body, format="json").status_code == 200


def test_foreign_closure_neither_reveals_nor_blocks_another_authors_nonce(duty_log_scene):
    scene = duty_log_scene
    body = log_payload(scene)
    url = request_path(body)
    foreign = scene["wrong"].post(url + "close/", {}, format="json")
    assert foreign.status_code == 200
    assert foreign.data == {"saved": False, "closed": True, "record": None}
    saved = scene["manager"].post(REGISTER, body, format="json")
    assert saved.status_code == 201
    assert scene["wrong"].get(url).data == foreign.data
    assert scene["wrong"].post(url + "close/", {}, format="json").data == foreign.data
    assert scene["manager"].get(url).data["record"]["id"] == saved.data["id"]


def test_read_only_creator_can_close_after_kind_and_person_become_unavailable(duty_log_scene):
    scene = duty_log_scene
    body = log_payload(scene)
    scene["people"][0].is_active = False
    scene["people"][0].save(update_fields=["is_active"])
    OpsDictionaryEntry.objects.filter(dictionary_code="SERVICE_DUTY_KINDS", code="GBR").update(is_active=False)
    UserRole.objects.filter(user_id=str(scene["user"].pk), role_code_id="LOG_MANAGER").update(is_active=False)
    RoleAdminService.assign_role(str(scene["user"].pk), "LOG_READER", scene["first"].pk, actor="test")
    response = scene["manager"].post(request_path(body) + "close/", {}, format="json")
    assert response.status_code == 200
    assert response.data == {"saved": False, "closed": True, "record": None}


def test_saved_confirmation_hides_record_after_historical_scope_was_revoked(duty_log_scene):
    scene = duty_log_scene
    body = log_payload(scene)
    assert scene["manager"].post(REGISTER, body, format="json").status_code == 201
    UserRole.objects.filter(user_id=str(scene["user"].pk), role_code_id="LOG_MANAGER").update(is_active=False)
    RoleAdminService.assign_role(str(scene["user"].pk), "LOG_READER", scene["other"].pk, actor="test")
    response = scene["manager"].post(request_path(body) + "close/", {}, format="json")
    assert response.status_code == 200
    assert response.data == {"saved": True, "closed": False, "record": None}


def test_unknown_nonce_lookup_distinguishes_not_found_from_closed(duty_log_scene):
    body = log_payload(duty_log_scene)
    response = duty_log_scene["manager"].get(request_path(body))
    assert response.status_code == 200
    assert response.data == {"saved": False, "closed": False, "record": None}
