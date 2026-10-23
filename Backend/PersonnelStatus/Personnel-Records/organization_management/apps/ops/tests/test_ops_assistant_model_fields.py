"""Model-only fields cannot change requests; explicit human deadlines remain valid."""
import json
from io import BytesIO

import pytest
from django.test import override_settings

from organization_management.apps.operations.models_assistant import OpsAssistantReceipt, OpsAssistantTask
from organization_management.apps.operations.models_event import OpsSecurityEvent
from organization_management.apps.ops.assistant import provider
from organization_management.apps.ops.tests.test_ops_assistant_api import URL, chief, create_task, jwt_actor
from organization_management.apps.ops.tests.test_ops_forces_gathering import event_on_demand, make_department, manager

pytestmark = pytest.mark.django_db
MODEL_DEADLINE = "2027-05-31T11:12:00+05:00"
MANUAL_DEADLINE = "2027-05-31T09:15:00+05:00"


def test_unrequested_model_deadline_never_reaches_task_or_sent_request(chief, manager, monkeypatch):
    base, need = event_on_demand(manager, business_date="2027-06-01")
    event = OpsSecurityEvent.objects.get(pk=base.rstrip("/").rsplit("/", 1)[-1])
    department = make_department("6 департамент")
    message = f"Для существующего ОМ {event.code} запроси {need} человек из шестого департамента."
    proposal = {
        "title": None, "businessDate": None, "kind": None,
        "objectName": None, "eventCode": event.code, "intent": "send",
        "allocations": [{"departmentName": department.name, "need": need, "dueAt": MODEL_DEADLINE}],
    }
    schema = provider.PROPOSAL_SCHEMA["properties"]["allocations"]["items"]
    assert schema["additionalProperties"] is False and "dueAt" not in schema["properties"]
    envelope = {"done_reason": "stop", "message": {"content": json.dumps(proposal)}}
    # Only model HTTP is replaced. Both grounding passes, credentials, manual
    # redispatch, domain writes and the receipt below execute normally.
    monkeypatch.setattr(provider, "urlopen", lambda *_a, **_kw: BytesIO(json.dumps(envelope).encode()))
    with override_settings(OPS_ASSISTANT_PROVIDER="ollama", OPS_ASSISTANT_OLLAMA_URL="http://127.0.0.1:11434"):
        created = create_task(chief[0], message=message)
    assert created.status_code == 201, created.data
    assert created.data["status"] == "awaiting_executor"
    task = OpsAssistantTask.objects.get(pk=created.data["id"])
    assert "dueAt" not in task.plan["allocations"][0]
    event.refresh_from_db()
    assert not event.force_allocation
    staff, user = jwt_actor("model_fields_staff", ("event.view", "forces.command"))
    sent = staff.post(URL + str(task.pk) + "/continue/", {}, format="json")
    assert sent.status_code == 200, sent.data
    event.refresh_from_db()
    allocation, = event.force_allocation
    assert allocation["departmentId"] == str(department.pk) and allocation["need"] == need
    assert allocation["sentAt"] and allocation["dueAt"] != MODEL_DEADLINE
    receipt = OpsAssistantReceipt.objects.get(task=task, operation_key="send_allocations")
    assert receipt.executed_by == str(user.pk)
    assert receipt.result["requests"][0]["id"] == allocation["id"]


def test_explicit_human_deadline_is_preserved_in_actual_request(chief, manager):
    base, need = event_on_demand(manager, business_date="2027-06-01")
    event = OpsSecurityEvent.objects.get(pk=base.rstrip("/").rsplit("/", 1)[-1])
    department = make_department("6 департамент")
    created = create_task(chief[0], fields={
        "eventId": str(event.pk), "intent": "send", "allocations": [
            {"departmentId": str(department.pk), "need": need, "dueAt": MANUAL_DEADLINE},
        ],
    })
    assert created.status_code == 201, created.data
    assert created.data["plan"]["allocations"][0]["dueAt"] == MANUAL_DEADLINE
    staff, _ = jwt_actor("human_deadline_staff", ("event.view", "forces.command"))
    sent = staff.post(URL + created.data["id"] + "/continue/", {}, format="json")
    assert sent.status_code == 200, sent.data
    event.refresh_from_db()
    assert event.force_allocation[0]["dueAt"] == MANUAL_DEADLINE
