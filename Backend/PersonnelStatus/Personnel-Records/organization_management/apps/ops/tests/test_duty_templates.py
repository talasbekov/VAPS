from uuid import uuid4

import pytest

from organization_management.apps.divisions.models import Division
from organization_management.apps.operations.duty_kinds import SERVICE_DUTY_KINDS
from organization_management.apps.operations.models_settings import OpsDictionaryEntry
from organization_management.apps.operations.tests.test_bulk_status_api import client_for

pytestmark = pytest.mark.django_db
URL = "/api/ops/duty-templates/"


@pytest.fixture
def scene():
    a = Division.objects.create(name="Templates A")
    b = Division.objects.create(name="Templates B")
    OpsDictionaryEntry.objects.get_or_create(dictionary_code=SERVICE_DUTY_KINDS, code="TEMPLATE_TEST", defaults={"label": "Test duty", "is_active": True})
    first, _ = client_for("template_owner", "TEMPLATE_A", ("duty.manage",), scope_division_id=a.pk)
    colleague, _ = client_for("template_colleague", "TEMPLATE_COLLEAGUE", ("duty.manage",), scope_division_id=a.pk)
    foreign, _ = client_for("template_foreign", "TEMPLATE_B", ("duty.manage",), scope_division_id=b.pk)
    reader, _ = client_for("template_reader", "TEMPLATE_READER", ("duty.view",), scope_division_id=a.pk)
    return first, colleague, foreign, reader, a, b


def payload(**patch):
    return {"id": str(uuid4()), "expected_revision": 0, "owner_division_id": None,
            "name": "Night", "kind": "TEMPLATE_TEST", "start_time": "20:00", "duration_minutes": 720,
            "location_label": "Object", "document_basis": "Order", "note": "", **patch}


def test_personal_template_is_private_and_retry_is_idempotent(scene):
    body = payload()
    created = scene[0].post(URL, body, format="json")
    assert created.status_code == 201, created.content
    assert scene[0].post(URL, body, format="json").status_code == 200
    assert len(scene[0].get(URL).json()["results"]) == 1
    assert scene[1].get(URL).json()["results"] == []
    assert scene[1].get(URL + body["id"] + "/").status_code == 404
    assert scene[2].get(URL).json()["results"] == []


def test_shared_template_scope_and_reader_permissions(scene):
    body = payload(owner_division_id=scene[4].pk)
    assert scene[0].post(URL, body, format="json").status_code == 201
    assert scene[1].get(URL).json()["results"][0]["can_manage"] is True
    assert scene[3].get(URL).json()["results"][0]["can_manage"] is False
    assert scene[2].get(URL).json()["results"] == []
    assert scene[2].get(URL + body["id"] + "/").status_code == 404
    assert scene[3].post(URL, payload(), format="json").status_code == 403
    assert scene[2].post(URL, payload(owner_division_id=scene[4].pk), format="json").status_code == 403


def test_update_checks_revision_and_immutable_scope(scene):
    body = payload(owner_division_id=scene[4].pk)
    assert scene[0].post(URL, body, format="json").status_code == 201
    endpoint = URL + body["id"] + "/"
    updated = {**body, "expected_revision": 1, "name": "Morning", "start_time": "08:00"}
    assert scene[1].put(endpoint, updated, format="json").status_code == 200
    assert scene[0].put(endpoint, updated, format="json").status_code == 409
    assert scene[0].put(endpoint, {**updated, "expected_revision": 2, "owner_division_id": None}, format="json").status_code == 400
    assert scene[2].put(endpoint, {**updated, "expected_revision": 2}, format="json").status_code == 404


def test_delete_is_versioned_and_create_retry_does_not_resurrect(scene):
    body = payload()
    assert scene[0].post(URL, body, format="json").status_code == 201
    endpoint = URL + body["id"] + "/"
    assert scene[0].delete(endpoint, {"expected_revision": 0}, format="json").status_code == 409
    assert scene[0].delete(endpoint, {"expected_revision": 1}, format="json").status_code == 204
    assert scene[0].get(URL).json()["results"] == []
    assert scene[0].post(URL, body, format="json").status_code == 409


@pytest.mark.parametrize("patch", [{"duration_minutes": True}, {"duration_minutes": 0}, {"start_time": "25:00"}, {"owner_division_id": True}, {"name": " "}, {"name": "\ufdfa" * 120}, {"employee_id": 1}, {"expected_revision": True}, {"kind": "MISSING"}])
def test_invalid_template_rejected(scene, patch):
    assert scene[0].post(URL, payload(**patch), format="json").status_code in (400, 422)
    assert scene[0].get(URL).json()["results"] == []


def test_duplicate_name_does_not_replace_existing_template(scene):
    assert scene[0].post(URL, payload(), format="json").status_code == 201
    assert scene[0].post(URL, payload(name=" night "), format="json").status_code == 409
    assert scene[1].post(URL, payload(), format="json").status_code == 201


def test_inactive_shared_division_is_not_offered_for_creation(scene):
    scene[4].is_active = False
    scene[4].save(update_fields=["is_active"])
    assert scene[0].get(URL).json()["owner_choices"] == []
    assert scene[0].post(URL, payload(owner_division_id=scene[4].pk), format="json").status_code == 400
