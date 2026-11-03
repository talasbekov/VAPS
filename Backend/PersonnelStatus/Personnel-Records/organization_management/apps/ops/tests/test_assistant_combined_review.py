"""Persistent task processing cannot discard the dock's explicit review boundary."""
import uuid

import pytest

from organization_management.apps.operations.models import Permission, RolePermission, UserRole
from organization_management.apps.operations.models_assistant import OpsAssistantTask
from organization_management.apps.operations.models_event import OpsSecurityEvent
from organization_management.apps.ops.assistant import provider
from organization_management.apps.ops.assistant.dialogue import process_task
from organization_management.apps.ops.tests.test_ops_assistant_api import chief, jwt_actor, URL  # noqa: F401
from organization_management.apps.ops.tests.test_ops_assistant_dialogue import start
from organization_management.apps.ops.tests.test_ops_assistant_confirmation import confirm, event_on_demand, make_department, manager  # noqa: F401
from organization_management.apps.ops.tests.test_assistant_briefing_execution import ready_task, object_fact, proceed
from organization_management.apps.ops.tests.test_ops_security_events_api import make_object

pytestmark = pytest.mark.django_db


def finish(task_id):
    task = OpsAssistantTask.objects.get(pk=task_id)
    process_task(str(task.pk), task.processing["generation"])


def test_review_survives_worker_followup_and_invalidates_old_consent(chief, monkeypatch):
    api, _ = chief
    monkeypatch.setattr(provider, "interpret", lambda *args, **kwargs: {
        "title": "Встреча", "businessDate": "2027-06-01", "kind": "INTERNAL",
    })
    task = start(api, reviewBeforeExecute=True).json()
    assert task["processing"]["state"] == "queued" and task["confirmation"] is None
    finish(task["id"])
    task = api.get(URL + task["id"] + "/").json()
    assert task["reviewBeforeExecute"] is True
    assert task["confirmation"]["operation"] == "create_bulletin"
    assert task["canContinue"] is False and not OpsSecurityEvent.objects.exists()
    response = api.post(URL + task["id"] + "/messages/", {
        "message": "Нужно 12 человек", "revision": task["revision"], "requestKey": str(uuid.uuid4()),
    }, format="json")
    assert response.status_code == 202
    finish(task["id"])
    updated = api.get(URL + task["id"] + "/").json()
    assert updated["reviewBeforeExecute"] is True
    assert confirm(api, task).status_code == 409
    assert not OpsSecurityEvent.objects.exists()
    assert confirm(api, updated).status_code == 200
    assert OpsSecurityEvent.objects.count() == 1
    assert confirm(api, updated).status_code == 200
    assert OpsSecurityEvent.objects.count() == 1


def test_retry_keeps_review_and_never_executes_the_recovered_task(chief, monkeypatch):
    api, _ = chief
    def unavailable(*args, **kwargs):
        raise provider.ProviderUnavailable("Учебная модель недоступна")
    monkeypatch.setattr(provider, "interpret", unavailable)
    task = start(api, reviewBeforeExecute=True).json()
    finish(task["id"])
    failed = api.get(URL + task["id"] + "/").json()
    assert failed["processing"]["state"] == "failed" and failed["confirmation"] is None
    assert api.post(URL + task["id"] + "/retry/", {
        "revision": failed["revision"], "requestKey": str(uuid.uuid4()),
    }, format="json").status_code == 202
    monkeypatch.setattr(provider, "interpret", lambda *args, **kwargs: {
        "title": "Встреча", "businessDate": "2027-06-01", "kind": "INTERNAL",
    })
    finish(task["id"])
    updated = api.get(URL + task["id"] + "/").json()
    assert updated["processing"]["state"] == "ready"
    assert updated["reviewBeforeExecute"] is True and updated["confirmation"]
    assert not OpsSecurityEvent.objects.exists()


def test_pending_multiobject_changes_require_new_explicit_consent_after_rights_are_granted():
    api, user = jwt_actor("review-briefing-author", ("event.create", "event.view", "catalog.view"))
    first = make_object(code="REVIEW-A", name="Учебный объект А")
    second = make_object(code="REVIEW-B", name="Учебный объект Б")
    saved = ready_task(user, [object_fact(first), object_fact(second)])
    saved.plan["_reviewBeforeExecute"] = True
    saved.save(update_fields=["plan"])
    task = api.get(URL + str(saved.pk) + "/").json()
    response = confirm(api, task)
    assert response.status_code == 200, response.content
    saved.refresh_from_db()
    assert saved.event.visit_objects.count() == 1
    role = UserRole.objects.get(user_id=str(user.pk)).role_code
    Permission.objects.get_or_create(code="event.manage", defaults={"name": "Управление ОМ"})
    RolePermission.objects.get_or_create(role_code=role, permission_code_id="event.manage")
    idle = proceed(api, saved)
    assert idle.status_code == 200, idle.content
    assert saved.event.visit_objects.count() == 1
    reviewed = api.get(URL + str(saved.pk) + "/").json()
    assert reviewed["confirmation"]["operation"] == "apply_briefing"
    assert confirm(api, reviewed).status_code == 200
    assert saved.event.visit_objects.count() == 2
    assert confirm(api, reviewed).status_code == 200
    assert saved.event.visit_objects.count() == 2


@pytest.mark.parametrize("target", ["eventId", "eventCode"])
def test_async_existing_target_is_reviewed_before_send_and_replay_is_readonly(manager, monkeypatch, target):
    base, need = event_on_demand(manager, business_date="2027-06-01")
    event = OpsSecurityEvent.objects.get(pk=base.rstrip('/').rsplit('/', 1)[-1])
    department = make_department()
    api, _ = jwt_actor("async-existing-" + target, ("event.view", "forces.command"))
    fields = {"intent": "send", "allocations": [{"departmentId": str(department.pk), "need": need}]}
    if target == "eventId":
        fields["eventId"] = str(event.pk)
    monkeypatch.setattr(provider, "interpret", lambda *args, **kwargs: {"eventCode": event.code} if target == "eventCode" else {})
    task = start(api, message=f"Отправь запросы по ОМ {event.code}", fields=fields, reviewBeforeExecute=True).json()
    finish(task["id"])
    saved = OpsAssistantTask.objects.get(pk=task["id"])
    before = (saved.event_id, saved.plan.copy(), saved.revision)
    reviewed = api.get(URL + task["id"] + "/").json()
    assert reviewed["processing"]["state"] == "ready" and not reviewed["questions"], reviewed
    assert reviewed["event"] and reviewed["event"]["id"] == str(event.pk), reviewed
    assert reviewed["confirmation"]["operation"] == "send_allocations", reviewed
    saved.refresh_from_db()
    assert (saved.event_id, saved.plan, saved.revision) == before, "GET preview must not persist a target link or rewrite the plan"
    event.refresh_from_db()
    assert not event.force_allocation and not saved.receipts.exists()
    result = confirm(api, reviewed)
    assert result.status_code == 200, result.content
    event.refresh_from_db()
    assert len(event.force_allocation) == 1 and event.force_allocation[0]["sentAt"]
    assert confirm(api, reviewed).status_code == 200
    assert saved.receipts.count() == 1 and OpsSecurityEvent.objects.count() == 1


@pytest.mark.parametrize("target", ["eventId", "eventCode"])
def test_async_existing_preview_rechecks_withdrawn_event_read_right(manager, monkeypatch, target):
    base, need = event_on_demand(manager, business_date="2027-06-01")
    event = OpsSecurityEvent.objects.get(pk=base.rstrip('/').rsplit('/', 1)[-1])
    department = make_department()
    api, user = jwt_actor("revoked-existing-" + target, ("event.view", "forces.command"))
    fields = {"intent": "send", "allocations": [{"departmentId": str(department.pk), "need": need}]}
    if target == "eventId": fields["eventId"] = str(event.pk)
    monkeypatch.setattr(provider, "interpret", lambda *args, **kwargs: {"eventCode": event.code} if target == "eventCode" else {})
    task = start(api, message=f"Отправь запросы по ОМ {event.code}", fields=fields, reviewBeforeExecute=True).json()
    finish(task["id"])
    role = UserRole.objects.get(user_id=str(user.pk)).role_code
    RolePermission.objects.filter(role_code=role, permission_code_id="event.view").delete()
    reviewed = api.get(URL + task["id"] + "/").json()
    assert reviewed["status"] == "event_unavailable" and reviewed["event"] is None, reviewed
    assert reviewed["confirmation"] is None and not reviewed["canContinue"] and not reviewed["canMessage"]
    event.refresh_from_db()
    assert not event.force_allocation and not OpsAssistantTask.objects.get(pk=task["id"]).receipts.exists()


def test_unresolved_spoken_event_code_never_offers_creation_consent(chief, monkeypatch):
    api, _ = chief
    monkeypatch.setattr(provider, "interpret", lambda *args, **kwargs: {"eventCode": "OM-404"})
    task = start(api, message="Подготовь ОМ OM-404", reviewBeforeExecute=True).json()
    finish(task["id"])
    reviewed = api.get(URL + task["id"] + "/").json()
    assert reviewed["event"] is None and reviewed["confirmation"] is None, reviewed
    assert not reviewed["canContinue"] and not OpsSecurityEvent.objects.exists()


@pytest.mark.parametrize("target", ["eventId", "eventCode"])
def test_async_handoff_exposes_existing_task_to_headquarters_only_after_author_post(manager, monkeypatch, target):
    base, need = event_on_demand(manager, business_date="2027-06-01")
    event = OpsSecurityEvent.objects.get(pk=base.rstrip('/').rsplit('/', 1)[-1])
    department = make_department()
    author, _ = jwt_actor("handoff-author-" + target, ("event.view", "event.create", "event.bulletin"))
    staff, _ = jwt_actor("handoff-staff-" + target, ("event.view", "forces.command"))
    fields = {"intent": "send", "allocations": [{"departmentId": str(department.pk), "need": need}]}
    if target == "eventId": fields["eventId"] = str(event.pk)
    monkeypatch.setattr(provider, "interpret", lambda *args, **kwargs: {"eventCode": event.code} if target == "eventCode" else {})
    task = start(author, message=f"Отправь запросы по ОМ {event.code}", fields=fields, reviewBeforeExecute=True).json()
    finish(task["id"])
    preview = author.get(URL + task["id"] + "/").json()
    assert preview.get("canHandoff") is True and preview["canContinue"] is True, preview
    assert staff.get(URL + task["id"] + "/").status_code == 404
    assert not OpsAssistantTask.objects.get(pk=task["id"]).delegated
    response = author.post(URL + task["id"] + "/continue/", {"revision": preview["revision"]}, format="json")
    assert response.status_code == 200, response.content
    assert response.json()["delegated"] and not response.json().get("canHandoff")
    event.refresh_from_db()
    assert not event.force_allocation and not OpsAssistantTask.objects.get(pk=task["id"]).receipts.exists()
    visible = staff.get(URL).json()["results"]
    assert [row["id"] for row in visible] == [task["id"]]
    reviewed = staff.get(URL + task["id"] + "/").json()
    assert reviewed["confirmation"]["operation"] == "send_allocations" and reviewed["confirmation"]["canConfirm"]
    assert confirm(author, reviewed).status_code == 409
    assert confirm(staff, reviewed).status_code == 200
    event.refresh_from_db()
    assert len(event.force_allocation) == 1 and event.force_allocation[0]["sentAt"]
    assert confirm(staff, reviewed).status_code == 200
    assert OpsAssistantTask.objects.get(pk=task["id"]).receipts.count() == 1
