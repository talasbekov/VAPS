"""Durable dialogue, out-of-request interpretation and guarded continuation."""
import uuid

import pytest

from organization_management.apps.operations.models_assistant import OpsAssistantTask
from organization_management.apps.operations.models_event import OpsSecurityEvent
from organization_management.apps.ops.assistant import provider
from organization_management.apps.ops.tests.test_ops_assistant_api import chief, jwt_actor, URL, manager  # noqa: F401

pytestmark = pytest.mark.django_db


def start(api, **extra):
    return api.post(URL, {"requestKey": str(uuid.uuid4()), "message": "Подготовь внутреннее мероприятие «Встреча» 01.06.2027", "interpret": True, **extra}, format="json")


def test_initial_message_is_saved_before_model_and_never_creates_event(chief, monkeypatch):
    def interpret(text, **kwargs):
        task = OpsAssistantTask.objects.get()
        assert task.messages.filter(role="user", text=text).exists()
        assert task.processing["state"] == "running"
        return {"title": "Встреча", "businessDate": "2027-06-01", "kind": "INTERNAL"}
    monkeypatch.setattr(provider, "interpret", interpret)
    response = start(chief[0])
    assert response.status_code == 201
    data = response.json()
    assert data["processing"]["state"] == "queued"
    assert data["messages"][0]["text"].startswith("Подготовь")
    from organization_management.apps.ops.assistant.dialogue import process_task
    task = OpsAssistantTask.objects.get()
    process_task(str(task.pk), task.processing["generation"])
    data = chief[0].get(URL + str(task.pk) + "/").json()
    assert data["processing"]["state"] == "ready"
    assert data["canContinue"] is True
    assert not OpsSecurityEvent.objects.exists()
    result = chief[0].post(URL + str(task.pk) + "/continue/", {"revision": data["revision"]}, format="json")
    assert result.status_code == 200
    assert OpsSecurityEvent.objects.count() == 1


def test_second_message_keeps_task_date_and_title_and_duplicate_key(chief, monkeypatch):
    monkeypatch.setattr(provider, "interpret", lambda text, **kw: {"title": "Встреча", "businessDate": "2027-06-01", "kind": "INTERNAL"} if "Встреча" in text else {"personnelTotal": 12})
    task = start(chief[0]).json()
    from organization_management.apps.ops.assistant.dialogue import process_task
    saved = OpsAssistantTask.objects.get(pk=task["id"])
    process_task(task["id"], saved.processing["generation"])
    current = chief[0].get(URL + task["id"] + "/").json()
    body = {"requestKey": str(uuid.uuid4()), "message": "Нужно 12 человек", "revision": current["revision"]}
    url = URL + task["id"] + "/messages/"
    response = chief[0].post(url, body, format="json")
    assert response.status_code == 202
    assert chief[0].post(url, body, format="json").status_code == 200
    assert chief[0].post(url, {**body, "message": "Нужно 14 человек"}, format="json").status_code == 409
    saved.refresh_from_db()
    process_task(task["id"], saved.processing["generation"])
    result = chief[0].get(URL + task["id"] + "/").json()
    assert result["plan"]["title"] == "Встреча"
    assert result["plan"]["businessDate"] == "2027-06-01"
    assert result["plan"]["personnelTotal"] == 12
    assert len([m for m in result["messages"] if m["role"] == "user"]) == 2
    assert not OpsSecurityEvent.objects.exists()


def test_foreign_task_message_and_stale_revision_are_denied(chief):
    data = start(chief[0]).json()
    other, _ = jwt_actor("dialogue_other", ("event.create", "event.view"))
    url = URL + data["id"] + "/messages/"
    body = {"requestKey": str(uuid.uuid4()), "message": "Нужно 12 человек", "revision": data["revision"]}
    assert other.post(url, body, format="json").status_code == 404
    assert chief[0].post(url, {**body, "revision": 0}, format="json").status_code == 409


def test_failure_retry_does_not_duplicate_message_or_allow_stale_worker(chief, monkeypatch):
    data = start(chief[0]).json()
    from organization_management.apps.ops.assistant.dialogue import process_task
    task = OpsAssistantTask.objects.get(pk=data["id"])
    generation = task.processing["generation"]
    def failed(*args, **kwargs):
        raise provider.ProviderUnavailable("Модель недоступна")
    monkeypatch.setattr(provider, "interpret", failed)
    process_task(data["id"], generation)
    current = chief[0].get(URL + data["id"] + "/").json()
    assert current["processing"]["state"] == "failed"
    assert current["processing"]["retryable"] is True
    assert chief[0].post(URL + data["id"] + "/continue/", {"revision": current["revision"]}, format="json").status_code == 409
    body = {"requestKey": str(uuid.uuid4()), "revision": current["revision"]}
    url = URL + data["id"] + "/retry/"
    assert chief[0].post(url, body, format="json").status_code == 202
    assert chief[0].post(url, body, format="json").status_code == 200
    process_task(data["id"], generation)
    task.refresh_from_db()
    assert task.processing["state"] == "queued"
    monkeypatch.setattr(provider, "interpret", lambda *a, **kw: {"title": "Встреча", "businessDate": "2027-06-01", "kind": "INTERNAL"})
    process_task(data["id"], task.processing["generation"])
    task.refresh_from_db()
    assert task.processing["state"] == "ready"
    assert task.messages.filter(role="user").count() == 1
    assert not OpsSecurityEvent.objects.exists()


def test_explicit_total_conflict_blocks_even_structured_continue(chief):
    from organization_management.apps.ops.tests.test_ops_assistant_api import bulletin_fields, make_department
    department = make_department()
    data = start(chief[0], interpret=False, fields=bulletin_fields(personnelTotal=12, allocations=[{"departmentId": str(department.pk), "need": 15}])).json()
    assert any(q["field"] == "personnelTotal" for q in data["questions"])
    assert not data["canContinue"]
    assert not OpsSecurityEvent.objects.exists()


def test_disabled_account_worker_does_not_call_model(chief, monkeypatch):
    data = start(chief[0]).json()
    user = chief[1]
    user.is_active = False
    user.save(update_fields=["is_active"])
    def forbidden(*args, **kwargs):
        pytest.fail("revoked account reached model")
    monkeypatch.setattr(provider, "interpret", forbidden)
    from organization_management.apps.ops.assistant.dialogue import process_task
    task = OpsAssistantTask.objects.get(pk=data["id"])
    process_task(data["id"], task.processing["generation"])
    task.refresh_from_db()
    assert task.processing["state"] == "failed"
    assert not OpsSecurityEvent.objects.exists()


def run_worker(api, task_id):
    from organization_management.apps.ops.assistant.dialogue import process_task
    task = OpsAssistantTask.objects.get(pk=task_id)
    process_task(task_id, task.processing["generation"])
    return api.get(URL + task_id + "/").json()


def say(api, task, message):
    result = api.post(URL + task["id"] + "/messages/", {"message": message, "requestKey": str(uuid.uuid4()), "revision": task["revision"]}, format="json")
    assert result.status_code == 202, result.content
    return run_worker(api, task["id"])


def test_five_turns_correct_total_and_one_department_preserving_context(chief, monkeypatch):
    from organization_management.apps.ops.tests.test_ops_assistant_api import make_department, make_object
    second, sixth = make_department("Второй департамент"), make_department("Шестой департамент")
    obj = make_object(code="DIALOGUE", name="Аккорда")
    def interpret(text, **kwargs):
        if "Встреча" in text:
            return {"title": "Встреча", "kind": "INTERNAL", "allocations": [{"departmentName": second.name, "need": 80}, {"departmentName": sixth.name, "need": 120}]}
        return {}
    monkeypatch.setattr(provider, "interpret", interpret)
    task = start(chief[0], message="На Аккорду 30 октября 2026 нужно 200 человек").json()
    task = run_worker(chief[0], task["id"])
    task = say(chief[0], task, "Внутреннее мероприятие «Встреча». Второй департамент 80, шестой 120")
    assert task["plan"]["personnelTotal"] == 200
    assert len(task["plan"]["allocations"]) == 2
    task = say(chief[0], task, "Всего нужно 180")
    assert any(q["field"] == "personnelTotal" for q in task["questions"])
    assert not task["canContinue"]
    task = say(chief[0], task, "У шестого оставь 100")
    assert {row["departmentId"]: row["need"] for row in task["plan"]["allocations"]} == {str(second.pk): 80, str(sixth.pk): 100}
    task = say(chief[0], task, "Проверь сведения")
    assert task["plan"]["businessDate"] == "2026-10-30"
    assert task["plan"]["objectId"] == str(obj.pk)
    assert not task["questions"]
    assert task["canContinue"]
    assert len([m for m in task["messages"] if m["role"] == "user"]) == 5
    assert not OpsSecurityEvent.objects.exists()


def test_broker_failure_keeps_message_and_manual_fields_can_recover(chief, monkeypatch, django_capture_on_commit_callbacks):
    from organization_management.apps.operations.tasks import interpret_assistant_task
    from organization_management.apps.ops.tests.test_ops_assistant_api import bulletin_fields
    def unavailable(*args, **kwargs):
        raise RuntimeError("sensitive transport text")
    monkeypatch.setattr(interpret_assistant_task, "apply_async", unavailable)
    with django_capture_on_commit_callbacks(execute=True):
        response = start(chief[0])
    task = chief[0].get(URL + response.json()["id"] + "/").json()
    assert task["processing"]["state"] == "failed"
    assert "sensitive" not in str(task)
    assert len(task["messages"]) == 1
    result = chief[0].post(URL + task["id"] + "/continue/", {"fields": bulletin_fields(), "revision": task["revision"]}, format="json")
    assert result.status_code == 200, result.content
    assert result.json()["processing"]["state"] == "ready"
    assert OpsSecurityEvent.objects.count() == 1


def test_permission_revocation_during_call_discards_result(chief, monkeypatch):
    from organization_management.apps.operations.models import UserRole
    task = start(chief[0]).json()
    def revoked(*args, **kwargs):
        UserRole.objects.filter(user_id=str(chief[1].pk)).update(is_active=False)
        return {"title": "Встреча", "businessDate": "2027-06-01", "kind": "INTERNAL"}
    monkeypatch.setattr(provider, "interpret", revoked)
    from organization_management.apps.ops.assistant.dialogue import process_task
    saved = OpsAssistantTask.objects.get(pk=task["id"])
    process_task(task["id"], saved.processing["generation"])
    saved.refresh_from_db()
    assert saved.processing["state"] == "failed"
    assert saved.plan.get("title") is None


def test_correction_of_created_event_stays_blocked_after_unrelated_manual_fields(chief, monkeypatch):
    from organization_management.apps.ops.tests.test_ops_assistant_api import bulletin_fields, create_task
    task = create_task(chief[0], fields=bulletin_fields()).json()
    monkeypatch.setattr(provider, "interpret", lambda *a, **kw: {"businessDate": "2027-06-02"})
    task = say(chief[0], task, "Перенеси дату на 02.06.2027")
    assert any(q["field"] == "event" for q in task["questions"])
    result = chief[0].post(URL + task["id"] + "/continue/", {"fields": {"personnelTotal": 20}}, format="json")
    assert result.status_code == 200
    assert any(q["field"] == "event" for q in result.json()["questions"])
    assert OpsSecurityEvent.objects.get().business_date.isoformat() == "2027-06-01"


@pytest.mark.parametrize("text,total,review", [
    ("Всего 180, шестой департамент 100 человек", 180, False),
    ("Всего 180, нужно 200 человек", None, True),
    ("Всего 180 человек", 180, False),
    ("Всего 0", None, True),
])
def test_explicit_total_is_not_lost_or_overridden_by_another_people_count(text, total, review):
    from organization_management.apps.ops.assistant.planning import _personnel_total_evidence
    assert _personnel_total_evidence(text) == (total, review)


@pytest.mark.parametrize("state", ["queued", "running"])
def test_expired_job_retries_and_old_worker_cannot_replace_new_generation(chief, monkeypatch, state):
    from datetime import timedelta
    from django.utils import timezone
    from organization_management.apps.ops.assistant.dialogue import process_task, fail_task
    data = start(chief[0]).json()
    task = OpsAssistantTask.objects.get(pk=data["id"])
    old_generation = task.processing["generation"]
    task.processing = {**task.processing, "state": state, "queuedAt": (timezone.now() - timedelta(minutes=4)).isoformat()}
    task.save(update_fields=["processing"])
    current = chief[0].get(URL + data["id"] + "/").json()
    assert current["processing"]["retryable"]
    response = chief[0].post(URL + data["id"] + "/retry/", {"requestKey": str(uuid.uuid4()), "revision": current["revision"]}, format="json")
    assert response.status_code == 202
    fail_task(data["id"], old_generation, "late broker failure")
    process_task(data["id"], old_generation)
    task.refresh_from_db()
    assert task.processing["state"] == "queued"
    assert task.processing["generation"] != old_generation
    monkeypatch.setattr(provider, "interpret", lambda *a, **kw: {})
    result = run_worker(chief[0], data["id"])
    assert result["processing"]["state"] == "ready"
    assert len([m for m in result["messages"] if m["role"] == "user"]) == 1


def test_result_from_running_worker_is_discarded_after_retry_claim(chief, monkeypatch):
    from datetime import timedelta
    from django.utils import timezone
    task = start(chief[0]).json()
    def delayed(*args, **kwargs):
        saved = OpsAssistantTask.objects.get(pk=task["id"])
        saved.processing = {**saved.processing, "startedAt": (timezone.now() - timedelta(minutes=4)).isoformat()}
        saved.save(update_fields=["processing"])
        response = chief[0].post(URL + task["id"] + "/retry/", {"requestKey": str(uuid.uuid4()), "revision": saved.revision}, format="json")
        assert response.status_code == 202
        return {"title": "Встреча", "businessDate": "2027-06-01", "kind": "INTERNAL"}
    monkeypatch.setattr(provider, "interpret", delayed)
    result = run_worker(chief[0], task["id"])
    assert result["processing"]["state"] == "queued"
    assert result["plan"]["title"] is None
    assert not [m for m in result["messages"] if m["role"] == "assistant"]


def test_context_is_passed_to_model_but_only_latest_grounded_changes_apply(chief, monkeypatch):
    from organization_management.apps.ops.tests.test_ops_assistant_api import bulletin_fields, create_task
    task = create_task(chief[0], fields={"businessDate": "2027-06-01", "personnelTotal": 30}).json()
    def interpret(message, *, context):
        assert context["proposal"]["businessDate"] == "2027-06-01"
        assert context["messages"] == ["Подготовь наряд"]
        return {**bulletin_fields(title="Invented title"), "personnelTotal": 12}
    monkeypatch.setattr(provider, "interpret", interpret)
    result = say(chief[0], task, "Нужно 12 человек")
    assert result["plan"]["businessDate"] == "2027-06-01"
    assert result["plan"]["personnelTotal"] == 12
    assert result["plan"]["title"] is None
    assert not OpsSecurityEvent.objects.exists()


def test_history_limit_preserves_accepted_plan_and_all_messages(chief):
    from organization_management.apps.ops.assistant.dialogue import MAX_MESSAGES
    from organization_management.apps.operations.models_assistant import OpsAssistantMessage
    from organization_management.apps.ops.tests.test_ops_assistant_api import create_task
    task = create_task(chief[0], fields={"personnelTotal": 12}).json()
    saved = OpsAssistantTask.objects.get(pk=task["id"])
    OpsAssistantMessage.objects.bulk_create([OpsAssistantMessage(task=saved, role="user", text="Уточнение", request_key=str(uuid.uuid4())) for _ in range(MAX_MESSAGES - 1)])
    current = chief[0].get(URL + task["id"] + "/").json()
    assert current["canMessage"] is False
    response = chief[0].post(URL + task["id"] + "/messages/", {"requestKey": str(uuid.uuid4()), "revision": current["revision"], "message": "Ещё"}, format="json")
    assert response.status_code == 400
    saved.refresh_from_db()
    assert saved.plan["personnelTotal"] == 12
    assert saved.messages.filter(role="user").count() == MAX_MESSAGES


def test_committed_request_snapshot_uses_last_confirmed_allocation(chief, manager, monkeypatch):
    from organization_management.apps.ops.tests.test_ops_assistant_api import create_task, event_on_demand, make_department
    base, need = event_on_demand(manager, business_date="2027-06-01")
    event_id = base.rstrip("/").rsplit("/", 1)[-1]
    department = make_department("Шестой департамент")
    task = create_task(chief[0], fields={"eventId": event_id, "intent": "send", "personnelTotal": need,
        "allocations": [{"departmentId": str(department.pk), "need": need}]}).json()
    monkeypatch.setattr(provider, "interpret", lambda *a, **kw: {"allocations": [{"departmentName": department.name, "need": need + 1}]})
    task = say(chief[0], task, f"Всего нужно {need + 1}. Шестой департамент {need + 1}")
    assert not task["questions"]
    staff, _ = jwt_actor("dialogue_dispatcher", ("forces.command", "event.view"))
    response = staff.post(URL + task["id"] + "/continue/", {"revision": task["revision"]}, format="json")
    assert response.status_code == 200, response.content
    assert response.json()["receipts"][-1]["operation"] == "send_allocations"
    monkeypatch.setattr(provider, "interpret", lambda *a, **kw: {})
    task = say(chief[0], response.json(), "Проверь сведения")
    assert not task["questions"]
    event = OpsSecurityEvent.objects.get(pk=event_id)
    assert event.force_allocation[0]["need"] == need + 1


def test_count_correction_preserves_manually_entered_department_deadline(chief, monkeypatch):
    from organization_management.apps.ops.tests.test_ops_assistant_api import create_task, make_department
    department = make_department("Шестой департамент")
    task = create_task(chief[0], fields={"allocations": [{"departmentId": str(department.pk), "need": 100, "dueAt": "2027-05-31T09:15:00+05:00"}]}).json()
    monkeypatch.setattr(provider, "interpret", lambda *a, **kw: {})
    task = say(chief[0], task, "У шестого оставь 80")
    assert task["plan"]["allocations"][0]["need"] == 80
    assert task["plan"]["allocations"][0]["dueAt"] == "2027-05-31T09:15:00+05:00"


@pytest.mark.parametrize("retry", [False, True])
def test_relative_date_is_anchored_to_message_acceptance_across_midnight(chief, monkeypatch, retry):
    from datetime import date, timedelta
    from organization_management.apps.operations import clock
    with clock.override(date(2026, 10, 30)):
        task = start(chief[0], message="Подготовь внутреннее мероприятие «Встреча» завтра").json()
        if retry:
            def unavailable(*args, **kwargs):
                raise provider.ProviderUnavailable("Модель недоступна")
            monkeypatch.setattr(provider, "interpret", unavailable)
            task = run_worker(chief[0], task["id"])
            assert task["processing"]["state"] == "failed"
    def interpret(*args, **kwargs):
        return {"title": "Встреча", "kind": "INTERNAL", "businessDate": (clock.Clock.today_local() + timedelta(days=1)).isoformat()}
    monkeypatch.setattr(provider, "interpret", interpret)
    with clock.override(date(2026, 10, 31)):
        if retry:
            response = chief[0].post(URL + task["id"] + "/retry/", {"requestKey": str(uuid.uuid4()), "revision": task["revision"]}, format="json")
            assert response.status_code == 202
        task = run_worker(chief[0], task["id"])
    assert task["plan"]["businessDate"] == "2026-10-31"
    with clock.override(date(2026, 11, 1)):
        task = say(chief[0], task, "Теперь нужно завтра")
    assert task["plan"]["businessDate"] == "2026-11-02"


@pytest.mark.parametrize("expires_during_call", [False, True])
def test_reference_clock_never_extends_expired_temporary_authority(chief, monkeypatch, expires_during_call):
    from datetime import date, datetime, timezone
    from organization_management.apps.operations import clock
    from organization_management.apps.operations.models import TemporaryDutyPermission, UserRole
    from organization_management.apps.ops.assistant.dialogue import process_task
    with clock.override(date(2026, 10, 30)):
        task = start(chief[0]).json()
    assignment = UserRole.objects.get(user_id=str(chief[1].pk))
    assignment.is_active = False
    assignment.save(update_fields=["is_active"])
    grant = TemporaryDutyPermission.objects.create(user_id=str(chief[1].pk), duty_role_code=assignment.role_code_id,
        starts_at=datetime(2026, 10, 29, tzinfo=timezone.utc),
        ends_at=datetime(2026, 11, 1, tzinfo=timezone.utc) if expires_during_call else datetime(2026, 10, 30, 12, tzinfo=timezone.utc), created_by="test")
    def interpret(*args, **kwargs):
        if not expires_during_call:
            pytest.fail("expired temporary authority reached model")
        grant.ends_at = datetime(2026, 10, 30, 12, tzinfo=timezone.utc)
        grant.save(update_fields=["ends_at"])
        return {"title": "Встреча", "businessDate": "2027-06-01", "kind": "INTERNAL"}
    monkeypatch.setattr(provider, "interpret", interpret)
    saved = OpsAssistantTask.objects.get(pk=task["id"])
    with clock.override(date(2026, 10, 31)):
        process_task(task["id"], saved.processing["generation"])
    saved.refresh_from_db()
    grant.refresh_from_db()
    assert grant.ends_at == datetime(2026, 10, 30, 12, tzinfo=timezone.utc)
    assert saved.processing["state"] == "failed"
    assert saved.plan.get("title") is None
    assert not OpsSecurityEvent.objects.exists()
