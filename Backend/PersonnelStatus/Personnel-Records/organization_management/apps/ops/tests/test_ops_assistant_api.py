"""Chief task receipts execute through real JWT and existing domain policies."""
import uuid

import pytest
from rest_framework.test import APIClient
from rest_framework_simplejwt.tokens import AccessToken

from organization_management.apps.operations.models import RolePermission, UserRole
from organization_management.apps.operations.models_assistant import OpsAssistantReceipt, OpsAssistantTask
from organization_management.apps.operations.models_event import OpsSecurityEvent
from organization_management.apps.operations.models_notification import OpsNotification
from organization_management.apps.operations.tests.test_bulk_status_api import client_for
from organization_management.apps.ops.tests.test_ops_forces_gathering import event_on_demand, make_department, manager  # noqa: F401
from organization_management.apps.ops.tests.test_ops_security_events_api import make_object

pytestmark = pytest.mark.django_db
URL = "/api/ops/assistant/tasks/"


def jwt_actor(name, perms, scope=None):
    _, user = client_for(name, "AI_" + name.upper(), perms=perms, scope_division_id=scope)
    api = APIClient()
    api.credentials(HTTP_AUTHORIZATION="Bearer " + str(AccessToken.for_user(user)))
    return api, user


@pytest.fixture
def chief():
    return jwt_actor("chief", ("event.create", "event.view", "event.bulletin"))


def create_task(api, *, fields=None, key=None, message="Подготовь наряд"):
    response = api.post(URL, {"requestKey": key or str(uuid.uuid4()), "message": message, "fields": fields or {}}, format="json")
    return finish_interpretation(api, response)


def finish_interpretation(api, response):
    """Drive the durable worker then explicitly confirm through the real JWT API.

    These legacy scenario tests exercise the complete journey. Async persistence
    and the absence of automatic execution have separate dialogue regressions.
    """
    if response.status_code not in (200, 201) or response.data.get("processing", {}).get("state") != "queued":
        return response
    from organization_management.apps.ops.assistant.dialogue import process_task
    task = OpsAssistantTask.objects.get(pk=response.data["id"])
    process_task(str(task.pk), task.processing["generation"])
    result = api.get(URL + str(task.pk) + "/")
    if result.data["processing"]["state"] == "ready":
        result = api.post(URL + str(task.pk) + "/continue/", {"revision": result.data["revision"]}, format="json")
    if result.status_code == 200:
        result.status_code = response.status_code
    return result


def bulletin_fields(**extra):
    return {"title": "Учебная встреча", "businessDate": "2027-06-01", "kind": "INTERNAL", **extra}


def test_real_jwt_chief_creates_bulletin_and_receipt_without_fabricated_recon(chief):
    api, user = chief
    response = create_task(api, fields=bulletin_fields())
    assert response.status_code == 201, response.content
    data = response.json()
    assert data["status"] == "awaiting_recon"
    assert data["canContinue"] is False
    assert data["canEdit"] is True
    event = OpsSecurityEvent.objects.get(pk=data["event"]["id"])
    assert event.owner_actor_id == str(user.pk)
    assert event.stage == "BULLETIN"
    assert event.business_date_end is None and event.event_time is None
    assert not event.recon_force_requested_at
    receipt = OpsAssistantReceipt.objects.get(task_id=data["id"], operation_key="create_bulletin")
    assert receipt.executed_by == str(user.pk)
    assert receipt.result["eventId"] == str(event.pk)


def test_same_key_replays_original_result_and_other_payload_conflicts(chief):
    api, _ = chief
    key = str(uuid.uuid4())
    first = create_task(api, fields=bulletin_fields(), key=key)
    again = create_task(api, fields=bulletin_fields(), key=key)
    assert first.status_code == 201 and again.status_code == 200
    assert first.json()["id"] == again.json()["id"]
    assert first.json()["event"]["id"] == again.json()["event"]["id"]
    assert OpsSecurityEvent.objects.count() == 1
    changed = create_task(api, fields=bulletin_fields(title="Другая встреча"), key=key)
    assert changed.status_code == 409
    assert OpsSecurityEvent.objects.count() == 1


def test_missing_information_or_model_outage_saves_task_without_business_mutation(chief, settings):
    settings.OPS_ASSISTANT_PROVIDER = "disabled"
    response = create_task(chief[0])
    assert response.status_code == 201
    data = response.json()
    assert data["status"] == "needs_information"
    assert {q["field"] for q in data["questions"]} >= {"title", "businessDate", "kind"}
    assert data["interpretationNotice"]
    assert not OpsSecurityEvent.objects.exists()


def test_no_authority_and_identity_spoofing_never_create_records(chief):
    stranger, _ = jwt_actor("stranger", ("status.view",))
    assert create_task(stranger, fields=bulletin_fields()).status_code == 403
    assert create_task(chief[0], fields=bulletin_fields(actor="admin")).status_code == 400
    assert not OpsAssistantTask.objects.exists()
    assert not OpsSecurityEvent.objects.exists()


def test_only_initiator_and_global_headquarters_can_read_delegated_task(chief):
    department = make_department()
    fields = bulletin_fields(intent="send", allocations=[{"departmentId": str(department.pk), "need": 2}])
    created = create_task(chief[0], fields=fields).json()
    url = URL + created["id"] + "/"
    other, _ = jwt_actor("other", ("event.create", "event.view"))
    scoped, _ = jwt_actor("scoped", ("event.view", "forces.command"), department.pk)
    headquarters, _ = jwt_actor("staff", ("event.view", "forces.command"))
    assert other.get(url).status_code == 404
    assert scoped.get(url).status_code == 404
    assert headquarters.get(url).status_code == 200
    assert [task["id"] for task in headquarters.get(URL).json()["results"]] == [created["id"]]
    assert scoped.get(URL).json()["results"] == []


def test_revoked_permission_is_checked_again_before_continuation(chief):
    api, user = chief
    task = create_task(api).json()
    UserRole.objects.filter(user_id=str(user.pk)).update(is_active=False)
    response = api.post(URL + task["id"] + "/continue/", {"fields": bulletin_fields()}, format="json")
    assert response.status_code == 403
    assert not OpsSecurityEvent.objects.exists()


def test_chief_to_actual_staff_sends_one_existing_request_and_records_both_actors(chief, manager):  # noqa: F811
    base, need = event_on_demand(manager, business_date="2027-06-01")
    event_id = base.rstrip("/").rsplit("/", 1)[-1]
    department = make_department()
    jwt_actor("recipient", ("forces.allocate",), department.pk)
    fields = {"eventId": event_id, "intent": "send", "allocations": [{"departmentId": str(department.pk), "need": need}]}
    response = create_task(chief[0], fields=fields)
    assert response.status_code == 201, response.content
    data = response.json()
    assert data["status"] == "awaiting_executor"
    assert data["canContinue"] is False
    event = OpsSecurityEvent.objects.get(pk=event_id)
    assert not event.force_allocation
    staff, staff_user = jwt_actor("executor", ("event.view", "forces.command"))
    assert staff.get(URL + data["id"] + "/").json()["canContinue"] is True
    completed = staff.post(URL + data["id"] + "/continue/", {}, format="json")
    assert completed.status_code == 200, completed.content
    assert completed.json()["status"] == "awaiting_department_responses"
    assert completed.json()["canContinue"] is False
    event.refresh_from_db()
    assert len(event.force_allocation) == 1
    allocation = event.force_allocation[0]
    assert allocation["sentAt"]
    receipt = OpsAssistantReceipt.objects.get(task_id=data["id"], operation_key="send_allocations")
    assert receipt.executed_by == str(staff_user.pk)
    assert receipt.task.initiated_by == str(chief[1].pk)
    assert receipt.result["requests"][0]["id"] == allocation["id"]
    assert receipt.result["delivery"]["notifiedOfficers"] >= 1
    before = OpsNotification.objects.count()
    repeated = staff.post(URL + data["id"] + "/continue/", {}, format="json")
    assert repeated.status_code == 200
    event.refresh_from_db()
    assert len(event.force_allocation) == 1
    assert event.force_allocation[0]["id"] == allocation["id"]
    assert OpsNotification.objects.count() == before


def test_staff_cannot_create_a_chiefs_bulletin_using_the_chiefs_authority(chief):
    task = create_task(chief[0]).json()
    staff, _ = jwt_actor("readerstaff", ("event.view", "forces.command"))
    # Task is not delegated yet and executor cannot supply facts as another actor.
    response = staff.post(URL + task["id"] + "/continue/", {"fields": bulletin_fields()}, format="json")
    assert response.status_code == 404
    assert not OpsSecurityEvent.objects.exists()


def test_receipt_failure_rolls_back_business_write(chief, monkeypatch):
    def fail(*_args, **_kwargs):
        raise RuntimeError("receipt unavailable")
    monkeypatch.setattr(OpsAssistantReceipt.objects, "create", fail)
    with pytest.raises(RuntimeError, match="receipt unavailable"):
        create_task(chief[0], fields=bulletin_fields())
    assert not OpsSecurityEvent.objects.exists()
    assert not OpsAssistantReceipt.objects.exists()


def test_manual_fields_can_resume_missing_information_and_stale_revision_conflicts(chief):
    task = create_task(chief[0]).json()
    url = URL + task["id"] + "/continue/"
    response = chief[0].post(url, {"revision": task["revision"], "fields": bulletin_fields()}, format="json")
    assert response.status_code == 200, response.content
    assert response.json()["event"]
    replay = chief[0].post(url, {"revision": task["revision"], "fields": bulletin_fields()}, format="json")
    assert replay.status_code == 200
    assert replay.json()["event"]["id"] == response.json()["event"]["id"]
    conflict = chief[0].post(url, {"revision": task["revision"], "fields": bulletin_fields(title="Повтор")}, format="json")
    assert conflict.status_code == 409
    assert OpsSecurityEvent.objects.count() == 1


def test_linked_task_target_cannot_be_replaced_while_sending_to_old_event(chief, manager):  # noqa: F811
    first, _ = event_on_demand(manager, business_date="2027-06-01")
    second = manager.post("/api/ops/security-events/", bulletin_fields(title="Другое ОМ"), format="json").json()
    event_id = first.rstrip("/").rsplit("/", 1)[-1]
    task = create_task(chief[0], fields={"eventId": event_id}).json()
    changed = chief[0].post(URL + task["id"] + "/continue/", {"fields": {"eventId": second["id"]}}, format="json")
    assert changed.status_code == 409
    assert OpsAssistantTask.objects.get(pk=task["id"]).event_id == int(event_id)


def test_ambiguous_object_stays_unresolved_after_partial_fact_update(chief, monkeypatch):
    make_object(code="AI-DUP-A", name="Аккорда")
    make_object(code="AI-DUP-B", name="Аккорда")
    from organization_management.apps.ops.assistant import provider
    monkeypatch.setattr(provider, "interpret", lambda _, **kwargs: {**bulletin_fields(), "objectName": "Аккорда"})
    task = create_task(chief[0], message="Подготовь внутреннее мероприятие «Учебная встреча»01.06.2027 на объекте Аккорда").json()
    assert task["status"] == "needs_information"
    updated = chief[0].post(URL + task["id"] + "/continue/", {"fields": {"eventTime": "08:00"}}, format="json")
    assert updated.status_code == 200
    assert updated.json()["status"] == "needs_information"
    assert any(q["field"] == "objectId" for q in updated.json()["questions"])
    assert not OpsSecurityEvent.objects.exists()


def test_explicit_department_id_disambiguates_equal_names(chief):
    first = make_department("Департамент одинаковый")
    make_department("Департамент одинаковый")
    task = create_task(chief[0], fields=bulletin_fields(allocations=[{"departmentId": str(first.pk), "need": 2}])).json()
    assert task["status"] == "awaiting_recon"
    assert task["plan"]["allocations"][0]["departmentId"] == str(first.pk)


def test_unrelated_draft_requests_are_preserved_and_never_sent_implicitly(chief, manager):  # noqa: F811
    base, need = event_on_demand(manager, business_date="2027-06-01")
    event_id = base.rstrip("/").rsplit("/", 1)[-1]
    existing, requested = make_department("Департамент черновик"), make_department("Департамент запрошенный")
    draft = manager.post(base + "forces/allocation/", {"rows": [{"departmentId": str(existing.pk), "need": 1}], "draft": True}, format="json")
    assert draft.status_code == 200
    task = create_task(chief[0], fields={"eventId": event_id, "intent": "send", "allocations": [{"departmentId": str(requested.pk), "need": need}]}).json()
    staff, _ = jwt_actor("draftstaff", ("event.view", "forces.command"))
    result = staff.post(URL + task["id"] + "/continue/", {}, format="json")
    assert result.status_code == 400
    event = OpsSecurityEvent.objects.get(pk=event_id)
    assert len(event.force_allocation) == 1
    assert not event.force_allocation[0].get("sentAt")


def test_deleted_event_does_not_make_task_list_crash_or_recreate_it(chief):
    task = create_task(chief[0], fields=bulletin_fields()).json()
    OpsSecurityEvent.objects.get(pk=task["event"]["id"]).delete()
    listed = chief[0].get(URL)
    assert listed.status_code == 200
    assert listed.json()["results"][0]["status"] == "event_unavailable"
    continued = chief[0].post(URL + task["id"] + "/continue/", {}, format="json")
    assert continued.status_code == 400
    assert not OpsSecurityEvent.objects.exists()


def test_text_interpretation_can_use_an_explicit_existing_event_context(chief, manager, monkeypatch):  # noqa: F811
    base, need = event_on_demand(manager, business_date="2027-06-01")
    event_id = base.rstrip("/").rsplit("/", 1)[-1]
    department = make_department("Шестой департамент")
    from organization_management.apps.ops.assistant import provider
    monkeypatch.setattr(provider, "interpret", lambda _, **kwargs: {"intent": "send", "allocations": [{"departmentName": department.name, "need": need}]})
    response = chief[0].post(URL, {"requestKey": str(uuid.uuid4()), "message": f"Запроси в шестом департаменте{need} человека", "interpret": True, "fields": {"eventId": event_id}}, format="json")
    response = finish_interpretation(chief[0], response)
    assert response.status_code == 201, response.content
    assert response.json()["status"] == "awaiting_executor"
    assert response.json()["plan"]["allocations"][0]["departmentId"] == str(department.pk)


def test_mistyped_event_id_keeps_a_recoverable_unbound_task_and_corrects_it_without_duplicates(chief):
    api, user = chief
    existing = api.post("/api/ops/security-events/", bulletin_fields(), format="json")
    assert existing.status_code == 201, existing.data
    event_id = existing.json()["id"]
    missing_id = str(int(event_id) + 99999999)
    assert not OpsSecurityEvent.objects.filter(pk=missing_id).exists()
    key = str(uuid.uuid4())

    failed = create_task(api, key=key, fields={"eventId": missing_id, "intent": "prepare"})

    assert failed.status_code == 404, failed.data
    saved = OpsAssistantTask.objects.get(initiated_by=str(user.pk), request_key=key)
    assert saved.event_id is None and not saved.receipts.exists()
    listed = api.get(URL)
    assert listed.status_code == 200, listed.data
    queued = next(row for row in listed.json()["results"] if row["id"] == str(saved.pk))
    assert queued["event"] is None and queued["status"] == "event_unavailable"
    assert queued["canEdit"] is True and queued["canContinue"] is False
    detail = api.get(URL + str(saved.pk) + "/")
    assert detail.status_code == 200 and detail.json()["canEdit"] is True
    body = {"revision": detail.json()["revision"], "fields": {"eventId": str(event_id)}}

    corrected = api.post(URL + str(saved.pk) + "/continue/", body, format="json")
    replay = api.post(URL + str(saved.pk) + "/continue/", body, format="json")

    assert corrected.status_code == replay.status_code == 200, (corrected.data, replay.data)
    assert corrected.json()["id"] == replay.json()["id"] == str(saved.pk)
    assert str(corrected.json()["event"]["id"]) == str(event_id)
    saved.refresh_from_db()
    assert str(saved.event_id) == str(event_id)
    assert saved.initiated_by == str(user.pk)
    assert OpsAssistantTask.objects.count() == OpsSecurityEvent.objects.count() == 1
    assert not OpsAssistantReceipt.objects.exists()


def test_prebulletin_object_null_clears_selection_but_omission_preserves_it(chief):
    api, _ = chief
    obj = make_object(code="AI-RECOVERY-OBJECT", name="Учебный объект для уточнения")
    for explicit_clear in (True, False):
        before = OpsSecurityEvent.objects.count()
        created = create_task(api, fields={
            "title": "Уточнение объекта", "businessDate": "2027-06-01", "objectId": str(obj.pk),
        })
        assert created.status_code == 201, created.data
        task = created.json()
        assert task["status"] == "needs_information" and task["event"] is None
        assert any(row["field"] == "kind" for row in task["questions"])
        assert OpsSecurityEvent.objects.count() == before
        fields = {"kind": "INTERNAL", **({"objectId": None} if explicit_clear else {})}

        corrected = api.post(URL + task["id"] + "/continue/", {
            "revision": task["revision"], "fields": fields,
        }, format="json")

        assert corrected.status_code == 200, corrected.data
        data = corrected.json()
        assert data["status"] == "awaiting_recon"
        assert not any(row["field"] == "objectId" for row in data["questions"])
        event = OpsSecurityEvent.objects.get(pk=data["event"]["id"])
        assert event.security_object_id == (None if explicit_clear else obj.pk)
        assert data["plan"]["objectId"] == (None if explicit_clear else str(obj.pk))
        assert data["plan"]["objectName"] == (None if explicit_clear else obj.name)
        assert OpsSecurityEvent.objects.count() == before + 1


def test_bound_event_read_denial_revokes_correction_and_retains_its_existing_target(chief):
    api, _ = chief
    created = create_task(api, fields=bulletin_fields())
    assert created.status_code == 201, created.data
    task_id, event_id = created.json()["id"], created.json()["event"]["id"]
    RolePermission.objects.filter(role_code_id="AI_CHIEF", permission_code_id="event.view").delete()

    detail = api.get(URL + task_id + "/")

    assert detail.status_code == 200, detail.data
    assert detail.json()["status"] == "event_unavailable"
    assert detail.json()["canEdit"] is False and detail.json()["canContinue"] is False
    assert detail.json()["event"] is None and detail.json()["receipts"] == []
    refused = api.post(URL + task_id + "/continue/", {"fields": {"intent": "prepare"}}, format="json")
    assert refused.status_code == 403, refused.data
    saved = OpsAssistantTask.objects.get(pk=task_id)
    assert str(saved.event_id) == str(event_id)
    assert saved.revision == created.json()["revision"]
    assert OpsAssistantTask.objects.count() == OpsSecurityEvent.objects.count() == 1
    assert OpsAssistantReceipt.objects.count() == 1


@pytest.mark.parametrize("provider_available", [True, False])
def test_initial_interpret_preserves_explicit_catalog_date_total_even_when_provider_omits_them(chief, monkeypatch, provider_available):
    from datetime import date
    from organization_management.apps.operations import clock
    from organization_management.apps.ops.assistant import provider
    name = "Стенд: объект с готовым паспортом"
    obj = make_object(code="AI-TEXT-FULL", name=name)
    def interpret(_message, **kwargs):
        if not provider_available:
            raise provider.ProviderUnavailable("Модель недоступна; уточните поля.")
        return {"objectName": "Стенд"}
    monkeypatch.setattr(provider, "interpret", interpret)
    with clock.override(date(2026, 10, 22)):
        response = create_task(chief[0], message=f"собери наряд на объект {name} на 23 число 200 человек\n")
    assert response.status_code == 201, response.data
    data = response.json()
    assert data["plan"]["objectId"] == str(obj.pk) and data["plan"]["objectName"] == name
    assert data["plan"]["businessDate"] == "2026-10-23" and data["plan"]["personnelTotal"] == 200
    assert data["plan"]["allocations"] == [] and data["event"] is None
    assert {row["field"] for row in data["questions"]} == {"title", "kind"}
    assert bool(data["interpretationNotice"]) is (not provider_available)
    assert not OpsSecurityEvent.objects.exists() and not OpsAssistantReceipt.objects.exists()


@pytest.mark.parametrize("provider_available", [True, False])
def test_initial_task_keeps_named_month_and_declined_object_when_model_fails(chief, monkeypatch, provider_available):
    from datetime import date
    from organization_management.apps.operations import clock
    from organization_management.apps.ops.assistant import provider
    obj = make_object(code="AI-NATURAL-DATE", name="Аккорда")
    def interpret(_message, **kwargs):
        if not provider_available:
            raise provider.ProviderUnavailable("Модель недоступна; уточните поля.")
        return {"objectName": "Аккорда", "businessDate": "2026-10-23"}
    monkeypatch.setattr(provider, "interpret", interpret)
    with clock.override(date(2026, 10, 22)):
        response = create_task(chief[0], message="наряд на Аккорду на 23 октября 200 человек\n")
    assert response.status_code == 201, response.data
    task = response.json()
    assert task["plan"]["objectId"] == str(obj.pk)
    assert task["plan"]["objectName"] == "Аккорда"
    assert task["plan"]["businessDate"] == "2026-10-23"
    assert task["plan"]["personnelTotal"] == 200
    assert {row["field"] for row in task["questions"]} == {"title", "kind"}
    assert bool(task["interpretationNotice"]) is (not provider_available)
    assert task["event"] is None and task["receipts"] == []
    assert not OpsSecurityEvent.objects.exists() and not OpsAssistantReceipt.objects.exists()


def test_completion_does_not_expose_the_object_catalog_to_forces_command_only(monkeypatch):
    from organization_management.apps.ops.assistant import provider
    api, _ = jwt_actor("catalogstaff", ("forces.command", "event.view"))
    name = "Каталожный объект для полного совпадения"
    make_object(code="AI-TEXT-HIDDEN", name=name)
    monkeypatch.setattr(provider, "interpret", lambda _, **kwargs: {})
    assert api.get(URL + "catalogs/").json()["objects"] == []
    response = create_task(api, message=f"Наряд на объект {name} на 23 число 200 человек")
    assert response.status_code == 201, response.data
    assert response.json()["plan"]["objectId"] is None
    assert response.json()["plan"]["objectName"] is None


def test_manual_total_can_be_changed_and_cleared_without_reextracting_or_changing_demand(chief, monkeypatch):
    from organization_management.apps.ops.assistant import provider
    monkeypatch.setattr(provider, "interpret", lambda _, **kwargs: pytest.fail("manual task must not interpret"))
    task = create_task(chief[0], fields=bulletin_fields(personnelTotal=200), message="На 23 число 200 человек").json()
    assert task["plan"]["personnelTotal"] == 200 and task["event"]
    assert task["event"]["forceDemandTotal"] != 200
    url = URL + task["id"] + "/continue/"
    for value in (150, None):
        updated = chief[0].post(url, {"fields": {"personnelTotal": value}}, format="json")
        assert updated.status_code == 200, updated.data
        assert updated.json()["plan"]["personnelTotal"] == value
        assert updated.json()["event"] == task["event"]
    again = chief[0].post(url, {}, format="json")
    assert again.status_code == 200 and again.json()["plan"]["personnelTotal"] is None
    assert OpsSecurityEvent.objects.count() == OpsAssistantReceipt.objects.count() == 1


@pytest.mark.parametrize("value", [True, 1.5, "200", 0, -1, 100001])
def test_manual_invalid_total_is_rejected_before_saving_a_task(chief, value):
    response = create_task(chief[0], fields={"personnelTotal": value})
    assert response.status_code == 400
    assert not OpsAssistantTask.objects.exists() and not OpsSecurityEvent.objects.exists()


def test_total_is_immutable_after_dispatch_but_never_replaces_published_recon_demand(chief, manager):  # noqa: F811
    base, need = event_on_demand(manager, business_date="2027-06-01")
    event_id = base.rstrip("/").rsplit("/", 1)[-1]
    department = make_department()
    jwt_actor("totalrecipient", ("forces.allocate",), department.pk)
    task = create_task(chief[0], fields={"eventId": event_id, "intent": "send", "personnelTotal": 200,
        "allocations": [{"departmentId": str(department.pk), "need": 200}]}).json()
    staff, _ = jwt_actor("totalexecutor", ("event.view", "forces.command"))
    sent = staff.post(URL + task["id"] + "/continue/", {}, format="json")
    assert sent.status_code == 200, sent.data
    assert sent.json()["plan"]["personnelTotal"] == 200
    assert sent.json()["event"]["forceDemandTotal"] == need and need != 200
    event = OpsSecurityEvent.objects.get(pk=event_id)
    before = event.force_allocation
    for value in (201, None):
        refused = chief[0].post(URL + task["id"] + "/continue/", {"fields": {"personnelTotal": value}}, format="json")
        assert refused.status_code == 409, refused.data
    event.refresh_from_db()
    assert event.force_allocation == before
    assert chief[0].get(URL + task["id"] + "/").json()["plan"]["personnelTotal"] == 200


def test_manual_field_overrides_initial_completion_and_clearing_does_not_refill_from_message(chief, monkeypatch):
    from organization_management.apps.ops.assistant import provider
    monkeypatch.setattr(provider, "interpret", lambda _, **kwargs: {})
    response = chief[0].post(URL, {"requestKey": str(uuid.uuid4()), "message": "Нужно 200 человек", "interpret": True,
        "fields": {"personnelTotal": 150}}, format="json")
    response = finish_interpretation(chief[0], response)
    assert response.status_code == 201, response.data
    task = response.json()
    assert task["plan"]["personnelTotal"] == 150
    monkeypatch.setattr(provider, "interpret", lambda _, **kwargs: pytest.fail("continue must not interpret"))
    cleared = chief[0].post(URL + task["id"] + "/continue/", {"fields": {"personnelTotal": None}}, format="json")
    assert cleared.status_code == 200 and cleared.json()["plan"]["personnelTotal"] is None


@pytest.mark.parametrize("message", ["Запроси всего 200 или 300 человек", "Нужно не 200 человек", "Нужно 200 человек, нужно 300 человек"])
@pytest.mark.parametrize("choice", [200, None])
def test_ambiguous_total_blocks_ready_event_dispatch_until_explicit_manual_choice(manager, monkeypatch, choice, message):  # noqa: F811
    from organization_management.apps.ops.assistant import provider
    base, need = event_on_demand(manager, business_date="2027-06-01")
    event_id = base.rstrip("/").rsplit("/", 1)[-1]
    department = make_department()
    api, _ = jwt_actor("totalreviewstaff", ("event.view", "forces.command"))
    monkeypatch.setattr(provider, "interpret", lambda _, **kwargs: {})
    created = api.post(URL, {"requestKey": str(uuid.uuid4()), "message": message, "interpret": True,
        "fields": {"eventId": event_id, "intent": "send", "allocations": [{"departmentId": str(department.pk), "need": need}]}}, format="json")
    created = finish_interpretation(api, created)
    assert created.status_code == 201, created.data
    task = created.json()
    assert task["status"] == "needs_information" and not task["canContinue"]
    assert [row["field"] for row in task["questions"]] == ["personnelTotal"]
    assert not OpsSecurityEvent.objects.get(pk=event_id).force_allocation
    monkeypatch.setattr(provider, "interpret", lambda _, **kwargs: pytest.fail("continue must not interpret"))
    url = URL + task["id"] + "/continue/"
    for fields in ({}, {"intent": "send"}):
        still = api.post(url, {"fields": fields}, format="json")
        assert still.status_code == 200 and still.json()["status"] == "needs_information"
        assert not OpsSecurityEvent.objects.get(pk=event_id).force_allocation
    corrected = api.post(url, {"fields": {"personnelTotal": choice, "allocations": [{"departmentId": str(department.pk), "need": choice or need}]}}, format="json")
    assert corrected.status_code == 200, corrected.data
    assert corrected.json()["plan"]["personnelTotal"] == choice
    assert not corrected.json()["questions"]
    assert len(OpsSecurityEvent.objects.get(pk=event_id).force_allocation) == 1


@pytest.mark.parametrize("choice", [200, None])
def test_explicit_human_total_or_clear_wins_over_ambiguous_initial_text(chief, monkeypatch, choice):
    from organization_management.apps.ops.assistant import provider
    monkeypatch.setattr(provider, "interpret", lambda _, **kwargs: {})
    response = chief[0].post(URL, {"requestKey": str(uuid.uuid4()), "message": "Всего 200 или 300 человек", "interpret": True,
        "fields": {"personnelTotal": choice}}, format="json")
    response = finish_interpretation(chief[0], response)
    assert response.status_code == 201, response.data
    assert response.json()["plan"]["personnelTotal"] == choice
    assert not any(row["field"] == "personnelTotal" for row in response.json()["questions"])
