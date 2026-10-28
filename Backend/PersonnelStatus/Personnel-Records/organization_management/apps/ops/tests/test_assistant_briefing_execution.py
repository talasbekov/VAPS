"""Multi-object continuation keeps the original actor and normal API policies."""
import uuid

import pytest

from organization_management.apps.operations.models_assistant import OpsAssistantTask
from organization_management.apps.operations.models_event import OpsSecurityEvent
from organization_management.apps.operations.models_gvo import OpsProtectedPerson
from organization_management.apps.ops.tests.test_ops_assistant_api import jwt_actor, URL
from organization_management.apps.ops.tests.test_ops_security_events_api import make_object, make_employee

pytestmark = pytest.mark.django_db


def ready_task(user, objects, persons=None, *, kind="INTERNAL"):
    return OpsAssistantTask.objects.create(
        initiated_by=str(user.pk), request_key=str(uuid.uuid4()), request_hash="a" * 64,
        message="Подготовь многообъектный бюллетень", processing={"state": "ready"},
        plan={"title": "Встреча", "businessDate": "2026-10-25", "kind": kind,
              "intent": "prepare", "allocations": [], "questions": [],
              "briefing": {"objects": objects, "protectedPersons": persons or [], "issues": []}},
    )


def object_fact(obj, chief=None):
    return {"name": obj.name, "objectId": str(obj.pk), "chiefName": None,
            "chiefEmployeeId": str(chief.pk) if chief else None,
            "sectorCount": None, "sectors": [], "personnelNeed": None,
            "needStatus": "unknown", "checklistChecked": None}


def proceed(api, task):
    return api.post(URL + str(task.pk) + "/continue/", {}, format="json")


def test_multiobject_bulletin_keeps_people_chiefs_actor_and_receipts_on_repeat():
    api, user = jwt_actor("multi-manager", ("event.create", "event.manage", "event.view", "catalog.view"))
    first, second = make_object(code="M-A", name="Аккорда"), make_object(code="M-B", name="Тарлан")
    chief_a, chief_b = make_employee("Мейрам", "Еламан"), make_employee("Мусахан", "Улан")
    person = OpsProtectedPerson.objects.create(name="ОЛ 800", callsign="800", category="OURS")
    task = ready_task(user, [object_fact(first, chief_a), object_fact(second, chief_b)],
                      [{"code": "800", "personId": str(person.pk)}])
    response = proceed(api, task)
    assert response.status_code == 200, response.content
    task.refresh_from_db()
    event = task.event
    assert event.owner_actor_id == str(user.pk)
    assert set(event.visit_objects.values_list("security_object_id", flat=True)) == {first.pk, second.pk}
    assert set(event.visit_objects.values_list("chief_employee_id", flat=True)) == {chief_a.pk, chief_b.pk}
    assert list(event.protected_persons.values_list("pk", flat=True)) == [person.pk]
    receipts = list(task.receipts.values_list("operation_key", "executed_by"))
    assert receipts and {actor for _, actor in receipts} == {str(user.pk)}
    assert proceed(api, task).status_code == 200
    assert OpsSecurityEvent.objects.count() == 1
    assert event.visit_objects.count() == 2
    assert list(task.receipts.values_list("operation_key", "executed_by")) == receipts


def test_foreign_person_explicit_creation_is_receipted_and_never_repeated():
    api, user = jwt_actor("foreign-author", ("event.create", "event.manage", "event.view", "catalog.view"))
    obj = make_object(code="F-A", name="Ритц-Карлтон")
    person = {"name": "Шавкат Мирзеев", "country": "Узбекистан", "createIfMissing": True, "personId": None}
    task = ready_task(user, [object_fact(obj)], [person], kind="FOREIGN")
    response = proceed(api, task)
    assert response.status_code == 200, response.content
    created = OpsProtectedPerson.objects.get(name="Шавкат Мирзеев", country="Узбекистан", category="FOREIGN")
    task.refresh_from_db()
    assert task.event.protected_persons.filter(pk=created.pk).exists()
    assert task.receipts.filter(operation_key__startswith="briefing:person:").count() == 1
    assert proceed(api, task).status_code == 200
    assert OpsProtectedPerson.objects.filter(name=created.name).count() == 1


def test_creator_does_not_gain_object_management_or_certify_recon():
    api, user = jwt_actor("ordinary-author", ("event.create", "event.view", "catalog.view"))
    first, second = make_object(code="P-A", name="Аккорда"), make_object(code="P-B", name="Тарлан")
    chief = make_employee("Мейрам", "Еламан")
    facts = [object_fact(first, chief), object_fact(second)]
    facts[0]["checklistChecked"] = True
    task = ready_task(user, facts)
    response = proceed(api, task)
    assert response.status_code == 200, response.content
    task.refresh_from_db()
    assert task.event.visit_objects.count() == 1
    assert task.event.visit_objects.get().chief_employee_id is None
    assert not task.event.recon_sector_posts
    assert not task.event.recon_force_requested_at
    pending = response.json()["plan"]["briefingPending"]
    assert {row["action"] for row in pending} >= {"visit_object_add", "visit_object_chief"}
    assert response.json()["plan"]["briefing"]["objects"][0]["checklistChecked"] is True


def test_object_details_do_not_silently_apply_to_an_existing_unrelated_event():
    api, user = jwt_actor("existing-manager", ("event.create", "event.manage", "event.view", "catalog.view"))
    obj = make_object(code="EX-A", name="Аккорда")
    task = ready_task(user, [object_fact(obj)])
    existing = api.post("/api/ops/security-events/", {"title": "Встреча", "kind": "INTERNAL", "businessDate": "2026-10-25"}, format="json")
    task.plan["eventId"] = existing.json()["id"]
    task.save(update_fields=["plan"])
    response = proceed(api, task)
    assert response.status_code == 200, response.content
    task.refresh_from_db()
    assert not task.event.visit_objects.exists()
    assert response.json()["plan"]["briefingPending"]


def test_authorized_recon_draft_keeps_subpost_parent_and_does_not_publish():
    api, user = jwt_actor("recon-author", ("event.create", "event.manage", "event.view", "catalog.view", "event.stage_override"))
    obj, chief = make_object(code="R-A", name="Аккорда"), make_employee("Мейрам", "Еламан")
    fact = object_fact(obj, chief)
    fact.update({"sectorCount": 1, "sectors": [{"number": 1, "postCount": 1,
        "posts": [{"number": 1, "need": 1, "subpostCount": 1, "subposts": [{"number": 1, "need": 1}]}]}],
        "personnelNeed": 2, "needStatus": "known", "checklistChecked": True,
        "checklistResults": [{"id": f"checklist-{index}", "state": "NORMAL", "comment": ""} for index in range(5)]})
    task = ready_task(user, [fact])
    response = proceed(api, task)
    assert response.status_code == 200, response.content
    task.refresh_from_db()
    visit = task.event.visit_objects.get()
    assert visit.recon_force_request == 2 and visit.stage == "RECON"
    assert not task.event.recon_force_requested_at
    parent, child = task.event.recon_sector_posts
    assert child["parentPostId"] == parent["id"]
    assert {parent["visitObjectId"], child["visitObjectId"]} == {str(visit.pk)}
    assert all(row["state"] == "NORMAL" for row in visit.recon_checklist)
    assert proceed(api, task).status_code == 200
    task.event.refresh_from_db()
    assert task.event.recon_sector_posts == [parent, child]


def test_resolver_uses_person_code_not_numeric_primary_key_and_unique_chief_name():
    from organization_management.apps.ops.assistant.briefing_execution import resolve_briefing_references
    _, user = jwt_actor("resolve-author", ("event.create", "catalog.view"))
    expected = OpsProtectedPerson.objects.create(name="Нужное лицо", category="OURS", callsign="800")
    OpsProtectedPerson.objects.create(pk=800, name="Другое лицо", category="OURS", callsign="900")
    chief = make_employee("Мусахан", "Улан")
    clean, questions = resolve_briefing_references({"objects": [{"name": "Тарлан", "chiefName": "Улан Мусахан"}],
        "protectedPersons": [{"code": "800"}]}, actor_id=str(user.pk))
    assert not questions
    assert clean["protectedPersons"][0]["personId"] == str(expected.pk)
    assert clean["objects"][0]["chiefEmployeeId"] == str(chief.pk)
    make_employee("Мусахан", "Улан")
    clean, questions = resolve_briefing_references({"objects": [{"name": "Тарлан", "chiefName": "Улан Мусахан"}],
        "protectedPersons": []}, actor_id=str(user.pk))
    assert questions and not clean["objects"][0].get("chiefEmployeeId")


def test_resolver_does_not_keep_an_old_chief_id_after_a_name_correction():
    from organization_management.apps.ops.assistant.briefing_execution import resolve_briefing_references
    _, user = jwt_actor("correct-author", ("event.create",))
    old, new = make_employee("Мейрам", "Еламан"), make_employee("Мусахан", "Улан")
    clean, questions = resolve_briefing_references({"objects": [{"name": "Тарлан", "chiefName": "Улан Мусахан", "chiefEmployeeId": str(old.pk)}],
        "protectedPersons": []}, actor_id=str(user.pk))
    assert not questions
    assert clean["objects"][0]["chiefEmployeeId"] == str(new.pk)


def test_bulletin_only_role_can_read_plan_but_does_not_offer_event_creation():
    api, user = jwt_actor("bulletin-only-execution", ("event.bulletin",))
    task = ready_task(user, [])
    response = api.get(URL + str(task.pk) + "/")
    assert response.status_code == 200, response.content
    assert response.json()["canMessage"] is True
    assert response.json()["canContinue"] is False
    assert "создан" in response.json()["interpretationNotice"].lower()
    assert not OpsSecurityEvent.objects.exists()


def test_recon_receipt_does_not_treat_a_later_manual_change_as_its_own_result():
    api, user = jwt_actor("recon-changed", ("event.create", "event.manage", "event.view", "catalog.view", "event.stage_override"))
    obj, chief = make_object(code="RC-A", name="Аккорда"), make_employee("Мейрам", "Еламан")
    fact = object_fact(obj, chief)
    fact["sectors"] = [{"number": 1, "posts": [{"number": 1, "need": 1, "subpostCount": 0}]}]
    task = ready_task(user, [fact])
    assert proceed(api, task).status_code == 200
    task.refresh_from_db()
    event = task.event
    event.recon_sector_posts[0]["need"] = 2
    event.save(update_fields=["recon_sector_posts"])
    assert proceed(api, task).status_code == 409
    event.refresh_from_db()
    assert event.recon_sector_posts[0]["need"] == 2


def test_pending_object_can_continue_after_appropriate_permission_is_granted():
    from organization_management.apps.operations.models import Permission, RolePermission, UserRole
    api, user = jwt_actor("pending-author", ("event.create", "event.view", "catalog.view"))
    first, second = make_object(code="PA-A", name="Аккорда"), make_object(code="PA-B", name="Тарлан")
    task = ready_task(user, [object_fact(first), object_fact(second)])
    response = proceed(api, task)
    assert response.status_code == 200
    assert response.json()["canContinue"] is False
    Permission.objects.get_or_create(code="event.manage", defaults={"name": "Ведение ОМ"})
    role_id = UserRole.objects.get(user_id=str(user.pk)).role_code_id
    RolePermission.objects.create(role_code_id=role_id, permission_code_id="event.manage")
    refreshed = api.get(URL + str(task.pk) + "/")
    assert refreshed.json()["canContinue"] is True
    assert proceed(api, task).status_code == 200
    task.refresh_from_db()
    assert task.event.visit_objects.count() == 2


@pytest.mark.parametrize("ids", [["unknown-checklist-item"], ["checklist-0", "checklist-0"]])
def test_unknown_or_duplicate_checklist_results_stop_before_any_business_creation(ids):
    api, user = jwt_actor("invalid-checklist", ("event.create", "event.manage", "event.view", "catalog.view", "event.stage_override"))
    obj = make_object(code="IC-A", name="Аккорда")
    fact = object_fact(obj)
    fact["checklistResults"] = [{"id": item, "state": "NORMAL", "comment": ""} for item in ids]
    task = ready_task(user, [fact])
    response = proceed(api, task)
    assert response.status_code == 200, response.content
    assert response.json()["questions"]
    task.refresh_from_db()
    assert task.event_id is None and not task.receipts.exists()


def test_replay_never_restores_the_first_visit_removed_manually():
    api, user = jwt_actor("removed-first", ("event.create", "event.manage", "event.view", "catalog.view"))
    first, second = make_object(code="RF-A", name="Аккорда"), make_object(code="RF-B", name="Тарлан")
    task = ready_task(user, [object_fact(first), object_fact(second)])
    assert proceed(api, task).status_code == 200
    task.refresh_from_db()
    removed = task.event.visit_objects.get(security_object=first)
    deleted = api.delete(f"/api/ops/security-events/{task.event_id}/visit-objects/{removed.pk}/")
    assert deleted.status_code == 200, deleted.content
    assert proceed(api, task).status_code == 409
    assert list(task.event.visit_objects.values_list("security_object_id", flat=True)) == [second.pk]


def test_foreign_creation_intent_does_not_reuse_a_same_named_domestic_person():
    from organization_management.apps.ops.assistant.briefing_execution import resolve_briefing_references
    _, user = jwt_actor("foreign-category", ("event.create", "catalog.view"))
    OpsProtectedPerson.objects.create(name="Совпадающее имя", country="Узбекистан", category="OURS")
    clean, questions = resolve_briefing_references({"objects": [], "protectedPersons": [{
        "name": "Совпадающее имя", "country": "Узбекистан", "createIfMissing": True}]}, actor_id=str(user.pk))
    assert questions
    assert not clean["protectedPersons"][0].get("personId")
    assert OpsProtectedPerson.objects.count() == 1
