"""Independent review reproducers: real JWT/domain writes, no product changes."""
import json
from io import BytesIO

import pytest
from django.test import override_settings

from organization_management.apps.operations.models import RolePermission
from organization_management.apps.operations.models_assistant import OpsAssistantReceipt
from organization_management.apps.operations.models_event import OpsSecurityEvent
from organization_management.apps.ops.assistant import provider
from organization_management.apps.ops.tests.test_ops_assistant_api import (
    URL, bulletin_fields, chief, create_task, jwt_actor,
)
from organization_management.apps.ops.tests.test_ops_forces_gathering import (
    event_on_demand, make_department, manager,
)


@pytest.mark.django_db
def test_assistant_preserves_frozen_group_demand_ids_when_sending_another_department(chief, manager):
    base, total = event_on_demand(manager, business_date="2027-06-01")
    event_id = base.rstrip("/").rsplit("/", 1)[-1]
    event = OpsSecurityEvent.objects.get(pk=event_id)
    visit_id = str(event.visit_objects.first().pk)
    event.demand_rows.append({
        "id": "review-group-screening", "sourcePostId": "review-group-post",
        "visitObjectId": visit_id, "sector": "КПП", "task": "Досмотр",
        "place": "КПП", "shift": "09:00–18:00", "need": 2,
        "kindCode": "SCREENING_GROUP", "specification": "Группа досмотра",
        "requirements": "", "comment": "",
    })
    event.save(update_fields=["demand_rows"])
    existing = make_department("Департамент уже запрошенный")
    requested = make_department("Департамент новой задачи")
    original = manager.post(base + "forces/allocation/", {"rows": [{
        "departmentId": str(existing.pk), "need": total,
        "groupDemandIds": ["review-group-screening"],
    }]}, format="json")
    assert original.status_code == 200, original.data
    original_id = original.json()["forceAllocation"][0]["id"]
    task = create_task(chief[0], fields={"eventId": event_id, "intent": "send", "allocations": [
        {"departmentId": str(requested.pk), "need": 2},
    ]}).json()
    staff, _ = jwt_actor("review_group_staff", ("event.view", "forces.command"))

    response = staff.post(URL + task["id"] + "/continue/", {}, format="json")

    assert response.status_code == 200, response.data
    event.refresh_from_db()
    assert len(event.force_allocation) == 2
    kept = next(row for row in event.force_allocation if row["id"] == original_id)
    assert [row["id"] for row in kept["groupDemands"]] == ["review-group-screening"]


@pytest.mark.django_db
def test_task_list_handles_a_linked_event_whose_read_permission_was_revoked(chief):
    api, _user = chief
    created = create_task(api, fields=bulletin_fields())
    assert created.status_code == 201, created.data
    RolePermission.objects.filter(role_code_id="AI_CHIEF", permission_code_id="event.view").delete()
    api.raise_request_exception = False

    response = api.get(URL)

    assert response.status_code == 200
    assert any(task["id"] == created.json()["id"] for task in response.json()["results"])
    assert OpsSecurityEvent.objects.count() == 1


@pytest.mark.django_db
def test_schema_valid_model_hallucination_cannot_turn_prepare_text_into_an_existing_event_send(manager, monkeypatch):
    base, _need = event_on_demand(manager, business_date="2027-06-01")
    event = OpsSecurityEvent.objects.get(pk=base.rstrip("/").rsplit("/", 1)[-1])
    department = make_department("Шестой департамент")
    staff, _ = jwt_actor("review_model_staff", ("event.view", "forces.command"))
    # The external dependency returns schema-valid but unsupported facts/intent.
    # Real authorization, event lookup and mutation remain untouched.
    monkeypatch.setattr(provider, "interpret", lambda _, **kwargs: {
        "eventCode": event.code, "intent": "send",
        "allocations": [{"departmentName": department.name, "need": 2}],
    })

    response = create_task(staff, message="Подготовь варианты наряда; пока никому не отправляй.")

    assert response.status_code in (200, 201, 400), response.data
    event.refresh_from_db()
    assert event.force_allocation == [], "model-only event code and send intent performed a real send"
    assert not OpsAssistantReceipt.objects.filter(operation_key="send_allocations").exists()


@pytest.mark.django_db
def test_advanced_event_does_not_complete_a_new_unsent_task(chief, manager):
    base, _need = event_on_demand(manager, business_date="2027-06-01")
    event_id = base.rstrip("/").rsplit("/", 1)[-1]
    # A current event snapshot can already be past staffing when a new task
    # requests additional departments. The new task itself has done no send.
    OpsSecurityEvent.objects.filter(pk=event_id).update(stage="ACKNOWLEDGEMENT")
    department = make_department("Департамент дополнительной задачи")

    response = create_task(chief[0], fields={"eventId": event_id, "intent": "send", "allocations": [
        {"departmentId": str(department.pk), "need": 2},
    ]})

    assert response.status_code == 201, response.data
    assert not OpsAssistantReceipt.objects.filter(operation_key="send_allocations").exists()
    assert response.json()["status"] != "completed", "event stage is not proof that this task's requests were sent"


@override_settings(OPS_ASSISTANT_PROVIDER="ollama", OPS_ASSISTANT_OLLAMA_URL="http://127.0.0.1:11434")
@pytest.mark.parametrize("envelope", [[], None])
@pytest.mark.django_db
def test_non_object_provider_envelope_becomes_a_recoverable_provider_error(monkeypatch, envelope):
    monkeypatch.setattr(provider, "urlopen", lambda *_args, **_kwargs: BytesIO(json.dumps(envelope).encode()))

    with pytest.raises(provider.ProviderUnavailable):
        provider.interpret("Подготовь варианты наряда")
