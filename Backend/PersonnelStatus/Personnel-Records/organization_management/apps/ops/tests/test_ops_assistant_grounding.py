"""Actual-JWT regressions for final assistant review findings."""
import uuid

import pytest

from organization_management.apps.operations.models_assistant import OpsAssistantReceipt, OpsAssistantTask
from organization_management.apps.operations.models_event import OpsSecurityEvent
from organization_management.apps.ops.assistant import planning, provider
from organization_management.apps.ops.tests.test_ops_assistant_api import (
    URL, bulletin_fields, chief, create_task, jwt_actor,
)
from organization_management.apps.ops.tests.test_ops_forces_gathering import (
    event_on_demand, make_department, manager,
)

pytestmark = pytest.mark.django_db


def test_a_word_inside_the_named_title_is_not_a_reference_to_an_existing_event(chief, monkeypatch):
    proposal = {**bulletin_fields(title="Учебная проверка initial"), "eventCode": "initial"}
    monkeypatch.setattr(provider, "interpret", lambda _: proposal)
    response = create_task(chief[0], message="Подготовь внутреннее мероприятие «Учебная проверка initial»01.06.2027")
    assert response.status_code == 201, response.content
    assert response.json()["status"] == "awaiting_recon"
    assert response.json()["event"]


@pytest.mark.parametrize("mismatch", ["recipient", "counts", "partial"])
def test_model_must_ground_the_whole_department_quantity_proposal(manager, monkeypatch, mismatch):
    base, _ = event_on_demand(manager, business_date="2027-06-01")
    event_id = base.rstrip("/").rsplit("/", 1)[-1]
    second = make_department("Второй департамент")
    sixth = make_department("Шестой департамент")
    ninth = make_department("Девятый департамент")
    if mismatch == "recipient":
        message = "Запроси 4 человека во втором департаменте"
        rows = [{"departmentName": sixth.name, "need": 4}]
    elif mismatch == "counts":
        message = "Запроси во втором департаменте 4, в шестом 6"
        rows = [{"departmentName": second.name, "need": 6}, {"departmentName": sixth.name, "need": 4}]
    else:
        message = "Запроси во втором департаменте 4, в шестом 6"
        rows = [{"departmentName": second.name, "need": 4}, {"departmentName": ninth.name, "need": 6}]
    monkeypatch.setattr(provider, "interpret", lambda _: {"intent": "send", "allocations": rows})
    staff, _ = jwt_actor("ground_staff", ("event.view", "forces.command"))
    response = staff.post(URL, {"requestKey": str(uuid.uuid4()), "message": message, "fields": {"eventId": event_id}, "interpret": True}, format="json")
    assert response.status_code == 201, response.content
    data = response.json()
    assert data["status"] == "needs_information"
    assert data["plan"]["allocations"] == []
    assert any(question["field"] == "allocations" for question in data["questions"])
    event = OpsSecurityEvent.objects.get(pk=event_id)
    assert not event.force_allocation
    assert not OpsAssistantReceipt.objects.filter(task_id=data["id"], operation_key="send_allocations").exists()


def test_directly_grounded_pairs_send_with_real_jwt(manager, monkeypatch):
    base, _ = event_on_demand(manager, business_date="2027-06-01")
    event_id = base.rstrip("/").rsplit("/", 1)[-1]
    second = make_department("Второй департамент")
    sixth = make_department("Шестой департамент")
    monkeypatch.setattr(provider, "interpret", lambda _: {"intent": "send", "allocations": [
        {"departmentName": second.name, "need": 4}, {"departmentName": sixth.name, "need": 6},
    ]})
    staff, _ = jwt_actor("ground_valid", ("event.view", "forces.command"))
    response = staff.post(URL, {"requestKey": str(uuid.uuid4()), "message": "Запроси во втором департаменте 4, в шестом 6", "fields": {"eventId": event_id}, "interpret": True}, format="json")
    assert response.status_code == 201, response.content
    assert response.json()["status"] == "awaiting_department_responses"
    event = OpsSecurityEvent.objects.get(pk=event_id)
    assert {(str(row["departmentId"]), row["need"]) for row in event.force_allocation} == {(str(second.pk), 4), (str(sixth.pk), 6)}
    assert all(row.get("sentAt") for row in event.force_allocation)


def test_event_code_is_a_complete_identity_not_a_prefix(manager, monkeypatch):
    base, _ = event_on_demand(manager, business_date="2027-06-01")
    short = OpsSecurityEvent.objects.get(pk=base.rstrip("/").rsplit("/", 1)[-1])
    other = manager.post("/api/ops/security-events/", bulletin_fields(title="Длинный код"), format="json")
    assert other.status_code == 201
    longer = OpsSecurityEvent.objects.get(pk=other.json()["id"])
    short.code, longer.code = "ОМ-2028-1", "ОМ-2028-12"
    short.save(update_fields=["code"])
    longer.save(update_fields=["code"])
    department = make_department("Второй департамент")
    monkeypatch.setattr(provider, "interpret", lambda _: {"eventCode": short.code, "intent": "send", "allocations": [{"departmentName": department.name, "need": 4}]})
    staff, _ = jwt_actor("prefix_staff", ("event.view", "forces.command"))
    response = staff.post(URL, {"requestKey": str(uuid.uuid4()), "message": "По ОМ-2028-12 запроси 4 человека во втором департаменте"}, format="json")
    assert response.status_code == 201, response.content
    data = response.json()
    assert data["status"] == "needs_information"
    assert data["event"] is None
    assert OpsAssistantTask.objects.get(pk=data["id"]).event_id is None
    short.refresh_from_db()
    longer.refresh_from_db()
    assert not short.force_allocation and not longer.force_allocation


def test_older_outstanding_task_remains_reachable_by_paginated_staff_queue(chief):
    actor_id = str(chief[1].pk)
    records = [OpsAssistantTask.objects.create(initiated_by=actor_id, request_key=str(uuid.uuid4()), request_hash="hash", message="Проверка", plan={}, delegated=True) for _ in range(28)]
    staff, _ = jwt_actor("queue_staff", ("event.view", "forces.command"))
    first = staff.get(URL).json()
    assert first["page"] == 1 and first["pageCount"] == 2 and first["total"] == 28
    assert len(first["results"]) == 25
    assert first["nextPage"] == 2 and first["previousPage"] is None
    second = staff.get(URL, {"page": 2}).json()
    assert len(second["results"]) == 3
    assert second["nextPage"] is None and second["previousPage"] == 1
    assert str(records[0].pk) in {row["id"] for row in second["results"]}
    assert not ({row["id"] for row in first["results"]} & {row["id"] for row in second["results"]})
    clamped = staff.get(URL, {"page": 99}).json()
    assert clamped["page"] == 2
    outsider, _ = jwt_actor("queue_other", ("event.create", "event.view"))
    empty = outsider.get(URL).json()
    assert empty["results"] == [] and empty["total"] == 0 and empty["pageCount"] == 1


@pytest.mark.parametrize("page", ["abc", "0", "-1", "1.5"])
def test_invalid_queue_page_is_a_field_error(chief, page):
    response = chief[0].get(URL, {"page": page})
    assert response.status_code == 400


def test_prepared_manual_request_without_send_intent_has_no_automatic_next_action(chief, manager):
    base, _ = event_on_demand(manager, business_date="2027-06-01")
    task = create_task(chief[0], fields={"eventId": base.rstrip("/").rsplit("/", 1)[-1]}).json()
    assert task["status"] == "prepared"
    assert task["canContinue"] is False
    assert task["canEdit"] is True
