"""Reviewed assistant actions use the same JWT, policies and durable receipts."""
import uuid

import pytest

from organization_management.apps.operations.models import UserRole
from organization_management.apps.operations.models_assistant import OpsAssistantTask, OpsAssistantReceipt
from organization_management.apps.operations.models_event import OpsSecurityEvent
from organization_management.apps.ops.tests.test_ops_assistant_api import (  # noqa: F401
    URL, bulletin_fields, chief, jwt_actor,
)
from organization_management.apps.ops.tests.test_ops_forces_gathering import (  # noqa: F401
    event_on_demand, make_department, manager,
)

pytestmark = pytest.mark.django_db


def preview(api, fields=None, **extra):
    return api.post(URL, {"requestKey": str(uuid.uuid4()), "fields": fields or {},
                          "reviewBeforeExecute": True, "interpret": False, **extra}, format="json")


def confirm(api, task):
    return api.post(URL + task["id"] + "/continue/", {
        "revision": task["revision"], "confirmationToken": task["confirmation"]["token"],
    }, format="json")


def test_complete_proposal_saves_only_task_and_exposes_review_capability(chief):
    api, _ = chief
    assert api.get(URL + "configuration/").json()["reviewBeforeExecute"] is True
    response = preview(api, bulletin_fields())
    assert response.status_code == 201, response.content
    task = response.json()
    assert task["reviewBeforeExecute"] is True
    assert task["status"] == "awaiting_confirmation"
    assert task["event"] is None and task["canContinue"] is False
    assert task["confirmation"]["operation"] == "create_bulletin"
    assert task["confirmation"]["canConfirm"] is True
    assert len(task["confirmation"]["token"]) == 64
    assert not OpsSecurityEvent.objects.exists()
    assert not OpsAssistantReceipt.objects.exists()


def test_only_explicit_confirmation_creates_once_and_replay_is_readonly(chief):
    api, user = chief
    task = preview(api, bulletin_fields()).json()
    idle = api.post(URL + task["id"] + "/continue/", {}, format="json")
    assert idle.status_code == 200
    assert not OpsSecurityEvent.objects.exists()
    first = confirm(api, task)
    assert first.status_code == 200, first.content
    assert first.json()["status"] == "awaiting_recon"
    assert first.json()["confirmation"] is None
    event = OpsSecurityEvent.objects.get()
    assert event.owner_actor_id == str(user.pk)
    again = confirm(api, task)
    assert again.status_code == 200, again.content
    assert again.json()["event"]["id"] == str(event.pk)
    assert OpsSecurityEvent.objects.count() == 1
    assert OpsAssistantReceipt.objects.count() == 1


def test_clarification_preserves_review_and_old_preview_cannot_execute(chief):
    api, _ = chief
    task = preview(api).json()
    assert task["status"] == "needs_information" and task["confirmation"] is None
    changed = api.post(URL + task["id"] + "/continue/", {
        "fields": bulletin_fields(), "revision": task["revision"],
    }, format="json")
    assert changed.status_code == 200, changed.content
    task = changed.json()
    assert task["reviewBeforeExecute"] is True
    assert task["confirmation"] and not OpsSecurityEvent.objects.exists()
    newer = api.post(URL + task["id"] + "/continue/", {
        "fields": {"title": "Уточнённая встреча"}, "revision": task["revision"],
    }, format="json").json()
    assert newer["confirmation"]["token"] != task["confirmation"]["token"]
    assert confirm(api, task).status_code == 409
    assert not OpsSecurityEvent.objects.exists()
    assert confirm(api, newer).status_code == 200
    assert OpsSecurityEvent.objects.get().title == "Уточнённая встреча"


@pytest.mark.parametrize("extra", [
    {"confirmationToken": "0" * 64},
    {"confirmationToken": "bad", "revision": 1},
    {"confirmationToken": True, "revision": 1},
    {"confirmationToken": "0" * 64, "revision": True},
])
def test_invalid_or_missing_confirmation_snapshot_never_writes(chief, extra):
    api, _ = chief
    task = preview(api, bulletin_fields()).json()
    response = api.post(URL + task["id"] + "/continue/", extra, format="json")
    assert response.status_code in (400, 409), response.content
    assert not OpsSecurityEvent.objects.exists()


def test_confirmation_cannot_change_fields_in_same_request(chief):
    api, _ = chief
    task = preview(api, bulletin_fields()).json()
    response = api.post(URL + task["id"] + "/continue/", {
        "confirmationToken": task["confirmation"]["token"], "revision": task["revision"],
        "fields": {"title": "Подмена"},
    }, format="json")
    assert response.status_code == 400
    assert not OpsSecurityEvent.objects.exists()


def test_revoked_and_other_actor_cannot_confirm(chief):
    api, user = chief
    task = preview(api, bulletin_fields()).json()
    other, _ = jwt_actor("other-reviewer", ("event.create", "event.view", "event.bulletin"))
    assert confirm(other, task).status_code == 404
    UserRole.objects.filter(user_id=str(user.pk)).update(is_active=False)
    assert confirm(api, task).status_code == 403
    assert not OpsSecurityEvent.objects.exists()


def test_model_outage_keeps_manual_recovery_behind_confirmation(chief, settings):
    settings.OPS_ASSISTANT_PROVIDER = "disabled"
    api, _ = chief
    task = preview(api, message="Подготовь наряд", interpret=True).json()
    assert task["interpretationNotice"] and task["confirmation"] is None
    updated = api.post(URL + task["id"] + "/continue/", {
        "fields": bulletin_fields(), "revision": task["revision"],
    }, format="json").json()
    assert updated["confirmation"] and not OpsSecurityEvent.objects.exists()
    assert confirm(api, updated).status_code == 200


def test_review_flag_must_be_boolean_and_legacy_create_is_preserved(chief):
    api, _ = chief
    assert preview(api, bulletin_fields(), reviewBeforeExecute="true").status_code == 400
    response = preview(api, bulletin_fields(), reviewBeforeExecute=False)
    assert response.status_code == 201, response.content
    assert response.json()["event"] and response.json()["confirmation"] is None
    assert OpsSecurityEvent.objects.count() == 1


def test_send_waits_for_current_staff_confirmation_and_changed_event_invalidates_it(manager):
    base, need = event_on_demand(manager, business_date="2027-06-01")
    event_id = base.rstrip("/").rsplit("/", 1)[-1]
    department = make_department()
    staff, _ = jwt_actor("review-staff", ("event.view", "forces.command"))
    task = preview(staff, {"eventId": event_id, "intent": "send", "allocations": [
        {"departmentId": str(department.pk), "need": need},
    ]}).json()
    assert task["confirmation"]["operation"] == "send_allocations"
    event = OpsSecurityEvent.objects.get(pk=event_id)
    assert not event.force_allocation
    event.title = "Обновлённое мероприятие"
    event.save(update_fields=["title"])
    assert confirm(staff, task).status_code == 409
    event.refresh_from_db()
    assert not event.force_allocation
    current = staff.get(URL + task["id"] + "/").json()
    sent = confirm(staff, current)
    assert sent.status_code == 200, sent.content
    assert sent.json()["confirmation"] is None
    event.refresh_from_db()
    assert len(event.force_allocation) == 1 and event.force_allocation[0]["sentAt"]
    assert confirm(staff, current).status_code == 200
    assert OpsAssistantReceipt.objects.filter(task_id=task["id"]).count() == 1


def test_create_confirmation_replay_never_sends_later_requests(chief, manager):
    department = make_department()
    # A headquarters actor can also create an event through its existing permission.
    api, _ = jwt_actor("review-chief-staff", ("event.view", "event.create", "event.bulletin", "forces.command"))
    task = preview(api, bulletin_fields(intent="send", allocations=[
        {"departmentId": str(department.pk), "need": 2},
    ])).json()
    created = confirm(api, task)
    assert created.status_code == 200, created.content
    base, _ = event_on_demand(manager, business_date="2027-06-01")
    ready = OpsSecurityEvent.objects.get(pk=base.rstrip("/").rsplit("/", 1)[-1])
    saved = OpsAssistantTask.objects.get(pk=task["id"])
    # Isolate replay behavior when a later action becomes possible.
    saved.event = ready
    saved.plan["eventId"] = str(ready.pk)
    saved.save(update_fields=["event", "plan"])
    replay = confirm(api, task)
    assert replay.status_code == 200, replay.content
    ready.refresh_from_db()
    assert not ready.force_allocation
    assert OpsAssistantReceipt.objects.filter(task_id=task["id"]).count() == 1


@pytest.mark.django_db(transaction=True)
def test_concurrent_event_change_cannot_execute_a_stale_confirmation(manager):
    """An event edited while confirmation is in flight requires a fresh review."""
    from concurrent.futures import ThreadPoolExecutor
    from threading import Event
    from django.db import connection, connections, transaction

    base, need = event_on_demand(manager, business_date="2027-06-01")
    event_id = base.rstrip("/").rsplit("/", 1)[-1]
    department = make_department()
    staff, _ = jwt_actor("concurrent-review-staff", ("event.view", "forces.command"))
    task = preview(staff, {"eventId": event_id, "intent": "send", "allocations": [
        {"departmentId": str(department.pk), "need": need},
    ]}).json()
    attempted_lock = Event()

    def run_confirmation():
        def observe(execute, sql, params, many, context):
            if "FOR UPDATE" in sql and "ops_security_events" in sql:
                attempted_lock.set()
            return execute(sql, params, many, context)
        try:
            with connection.execute_wrapper(observe):
                return confirm(staff, task).status_code
        finally:
            connections.close_all()

    with ThreadPoolExecutor(max_workers=1) as pool:
        with transaction.atomic():
            event = OpsSecurityEvent.objects.select_for_update().get(pk=event_id)
            event.title = "Изменено во время подтверждения"
            event.save(update_fields=["title"])
            pending = pool.submit(run_confirmation)
            attempted_lock.wait(timeout=3)
        assert pending.result(timeout=10) == 409
    event.refresh_from_db()
    assert not event.force_allocation


@pytest.mark.parametrize("metadata", ["groups", "dueAt", "comment", "unrelated"])
def test_hidden_draft_conditions_require_full_review_in_existing_collection(manager, metadata):
    from copy import deepcopy
    base, need = event_on_demand(manager, business_date="2027-06-01")
    event_id = base.rstrip("/").rsplit("/", 1)[-1]
    event = OpsSecurityEvent.objects.get(pk=event_id)
    department = make_department()
    row = {"departmentId": str(department.pk), "need": need}
    if metadata == "groups":
        event.demand_rows.append({
            "id": "confirmation-group", "sourcePostId": "confirmation-group-post",
            "visitObjectId": str(event.visit_objects.first().pk), "sector": "КПП", "task": "Досмотр",
            "place": "КПП", "shift": "09:00–18:00", "need": 2,
            "kindCode": "SCREENING_GROUP", "specification": "Группа досмотра", "requirements": "", "comment": "",
        })
        event.save(update_fields=["demand_rows"])
        row["groupDemandIds"] = ["confirmation-group"]
    if metadata == "dueAt":
        row["dueAt"] = "2027-06-01T08:00:00+05:00"
    if metadata == "comment":
        row["comment"] = "Дополнительное условие для департамента"
    response = manager.post(base + "forces/allocation/", {"rows": [row], "draft": True}, format="json")
    assert response.status_code == 200, response.data
    event.refresh_from_db()
    before = deepcopy(event.force_allocation)
    requested = make_department("Другой департамент") if metadata == "unrelated" else department
    staff, _ = jwt_actor("hidden-condition-staff", ("event.view", "forces.command"))
    task = preview(staff, {"eventId": event_id, "intent": "send", "allocations": [
        {"departmentId": str(requested.pk), "need": need},
    ]}).json()
    assert task["confirmation"]["canConfirm"] is False
    assert task["confirmation"]["token"] is None
    assert "сборе сил" in task["confirmation"]["blockedReason"]
    denied = staff.post(URL + task["id"] + "/continue/", {
        "confirmationToken": "0" * 64, "revision": task["revision"],
    }, format="json")
    assert denied.status_code == 409
    event.refresh_from_db()
    assert event.force_allocation == before
    assert not OpsAssistantReceipt.objects.filter(task_id=task["id"]).exists()
