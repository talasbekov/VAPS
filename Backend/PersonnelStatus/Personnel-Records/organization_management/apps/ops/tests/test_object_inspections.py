"""Object inspections are independent dated records, never passport freshness."""
import pytest
from django.contrib.auth import get_user_model
from organization_management.apps.operations.tests.test_bulk_status_api import client_for
from organization_management.apps.ops.tests.test_ops_objects_passport_api import make_object
from organization_management.apps.operations.models_audit import OpsAuditLog

pytestmark = pytest.mark.django_db
URL = "/api/ops/object-inspections/"


def test_inspection_schema_declares_required_object_and_optional_page(client):
    schema = client.get("/api/schema/?format=json").json()
    operation = schema["paths"][URL]["get"]
    parameters = {entry["name"]: entry for entry in operation.get("parameters", []) if entry["in"] == "query"}
    assert "objectId" in parameters, "List requires objectId and generated clients must be able to supply it."
    assert parameters["objectId"]["required"] is True
    assert parameters["objectId"]["schema"]["type"] == "string"
    assert parameters["page"].get("required", False) is False
    assert parameters["page"]["schema"]["type"] == "integer"
    assignees = schema["paths"][URL + "assignees/"]["get"]
    search = next(entry for entry in assignees["parameters"] if entry["name"] == "q")
    assert search.get("required", False) is False


@pytest.fixture
def context():
    api, user = client_for("inspector", "INSPECTOR", perms=("object.view", "object.manage"))
    obj = make_object("INSP", "Объект проверки")
    return api, user, obj


def draft(obj, **kwargs):
    return {"objectId": str(obj.pk), "inspectedOn": "2026-10-20", "requestKey": "request-1",
            "items": [{"id": "q1", "question": "Документы сверены?", "answer": "yes",
                       "finding": "", "responsibleUsername": "", "dueOn": None}], **kwargs}


def create(context, **kwargs):
    api, _, obj = context
    response = api.post(URL, draft(obj, **kwargs), format="json")
    assert response.status_code == 201, response.content
    return response.json()


def test_create_retries_preserve_actor_and_no_duplicate(context):
    api, user, obj = context
    row = create(context)
    assert row["reviewer"]["id"] == str(user.pk)
    assert row["state"] == "draft"
    response = api.post(URL, draft(obj), format="json")
    assert response.status_code == 200
    assert response.json()["id"] == row["id"]
    assert api.get(URL, {"objectId": obj.pk}).json()["count"] == 1
    altered = draft(obj, inspectedOn="2026-10-19")
    assert api.post(URL, altered, format="json").status_code == 409


def test_read_only_and_scoped_users_fail_closed(context):
    api, user, obj = context
    row = create(context)
    reader, _ = client_for("inspection-reader", "INSPECTION_READ", perms=("object.view",))
    assert reader.get(URL, {"objectId": obj.pk}).status_code == 200
    assert reader.post(URL, draft(obj), format="json").status_code == 403
    assert reader.post(f'{URL}{row["id"]}/complete/', {"revision": 1}, format="json").status_code == 403
    scoped, _ = client_for("scoped-inspector", "SCOPED_INSPECTOR", perms=("object.view", "object.manage"), scope_division_id=12345)
    assert scoped.get(URL, {"objectId": obj.pk}).status_code == 403
    assert scoped.post(URL, draft(obj), format="json").status_code == 403


def test_complete_locks_answers_and_resolution_is_audited(context):
    api, user, obj = context
    item = {"id": "q1", "question": "Документы сверены?", "answer": "no",
            "finding": "Требуется актуализация", "responsibleUsername": user.username, "dueOn": "2026-11-01"}
    row = create(context, items=[item])
    url = f'{URL}{row["id"]}/'
    done = api.post(url + "complete/", {"revision": row["revision"]}, format="json")
    assert done.status_code == 200, done.content
    assert done.json()["state"] == "completed"
    assert done.json()["openFindings"] == 1
    assert api.patch(url, {"revision": 2, "inspectedOn": "2026-10-20", "items": [item]}, format="json").status_code == 409
    resolved = api.post(url + "resolve/", {"revision": 2, "itemId": "q1", "resolution": "Документы актуализированы"}, format="json")
    assert resolved.status_code == 200, resolved.content
    assert resolved.json()["openFindings"] == 0
    assert resolved.json()["items"][0]["resolvedBy"]["id"] == str(user.pk)
    assert resolved.json()["items"][0]["resolvedAt"]
    assert OpsAuditLog.objects.filter(entity_type="security_object", entity_id=obj.pk, action="OBJECT_INSPECTION_FINDING_RESOLVED").exists()


def test_incomplete_or_invalid_findings_cannot_complete(context):
    api, user, obj = context
    row = create(context, items=[{"id": "q1", "question": "Проверка", "answer": "no", "finding": "", "responsibleUsername": "", "dueOn": None}])
    assert api.post(f'{URL}{row["id"]}/complete/', {"revision": 1}, format="json").status_code == 400


@pytest.mark.parametrize("operation", ["save", "complete", "resolve"])
def test_permission_revoked_while_waiting_for_inspection_lock_denies_write(context, monkeypatch, operation):
    from django.db.models.query import QuerySet
    from organization_management.apps.operations.models import UserRole
    from organization_management.apps.operations.models_object_inspection import OpsObjectInspection
    api, user, obj = context
    item = {"id": "q1", "question": "Проверка", "answer": "no", "finding": "Замечание",
            "responsibleUsername": user.username, "dueOn": "2026-11-01"}
    row = create(context, items=[item])
    url = f'{URL}{row["id"]}/'
    if operation == "resolve":
        row = api.post(url + "complete/", {"revision": 1}, format="json").json()
    before = OpsObjectInspection.objects.get(pk=row["id"])
    before_values = (before.revision, before.inspected_on, before.items, before.completed_at)
    audit_count = OpsAuditLog.objects.count()
    first = QuerySet.first
    observed = []
    def first_after_wait(queryset):
        result = first(queryset)
        if queryset.model is OpsObjectInspection and queryset.query.select_for_update:
            observed.append(True)
            UserRole.objects.filter(user_id=str(user.pk)).update(is_active=False)
        return result
    monkeypatch.setattr(QuerySet, "first", first_after_wait)
    if operation == "save":
        response = api.patch(url, {"revision": row["revision"], "inspectedOn": "2026-10-19", "items": [item]}, format="json")
    else:
        body = {"revision": row["revision"]}
        if operation == "resolve":
            body.update(itemId="q1", resolution="Устранено")
        response = api.post(url + operation + "/", body, format="json")
    assert observed, "The revocation must happen after the locking query, not before the HTTP gate."
    assert response.status_code == 403, response.content
    after = OpsObjectInspection.objects.get(pk=row["id"])
    assert (after.revision, after.inspected_on, after.items, after.completed_at) == before_values
    assert OpsAuditLog.objects.count() == audit_count


def test_permission_revoked_during_create_validation_prevents_record(context, monkeypatch):
    from organization_management.apps.operations.models import UserRole
    from organization_management.apps.operations.models_object_inspection import OpsObjectInspection
    from organization_management.apps.ops import object_inspections
    api, user, obj = context
    validate = object_inspections.validated_document
    def validate_after_revocation(data):
        value = validate(data)
        UserRole.objects.filter(user_id=str(user.pk)).update(is_active=False)
        return value
    monkeypatch.setattr(object_inspections, "validated_document", validate_after_revocation)
    response = api.post(URL, draft(obj), format="json")
    assert response.status_code == 403, response.content
    assert not OpsObjectInspection.objects.exists()


def test_permission_revoked_during_create_insert_rolls_back_record(context, monkeypatch):
    from django.db.models.query import QuerySet
    from organization_management.apps.operations.models import UserRole
    from organization_management.apps.operations.models_object_inspection import OpsObjectInspection
    api, user, obj = context
    get_or_create = QuerySet.get_or_create
    def insert_then_revoke(queryset, *args, **kwargs):
        result = get_or_create(queryset, *args, **kwargs)
        if queryset.model is OpsObjectInspection:
            UserRole.objects.filter(user_id=str(user.pk)).update(is_active=False)
        return result
    monkeypatch.setattr(QuerySet, "get_or_create", insert_then_revoke)
    response = api.post(URL, draft(obj), format="json")
    assert response.status_code == 403, response.content
    assert not OpsObjectInspection.objects.exists()
    assert not OpsAuditLog.objects.filter(action="OBJECT_INSPECTION_SAVED").exists()



def test_stale_revision_cannot_overwrite_or_complete(context):
    api, user, obj = context
    row = create(context)
    url = f'{URL}{row["id"]}/'
    patch = {"revision": 1, "inspectedOn": "2026-10-19", "items": row["items"]}
    # The write contract never accepts server-owned resolution/identity fields.
    patch["items"] = draft(obj)["items"]
    assert api.patch(url, patch, format="json").status_code == 200
    assert api.patch(url, patch, format="json").status_code == 409
    assert api.post(url + "complete/", {"revision": 1}, format="json").status_code == 409


@pytest.mark.parametrize("changes", [
    {"inspectedOn": "2026-02-30"}, {"inspectedOn": "2099-01-01"},
    {"items": [{"id": "q1", "question": "Проверка", "answer": "no", "finding": "Ошибка", "responsibleUsername": "absent", "dueOn": "2026-11-01"}]},
    {"reviewer": {"id": "9"}}, {"items": [{"id": "q1", "question": "Проверка", "answer": "yes", "resolvedAt": "2026-01-01"}]},
])
def test_invalid_or_forged_input_rejected(context, changes):
    api, user, obj = context
    assert api.post(URL, draft(obj, **changes), format="json").status_code == 400


def test_inactive_assignee_rejected(context):
    api, user, obj = context
    get_user_model().objects.create_user(username="inactive-inspector", is_active=False)
    item = {"id": "q1", "question": "Проверка", "answer": "no", "finding": "Ошибка",
            "responsibleUsername": "inactive-inspector", "dueOn": "2026-11-01"}
    assert api.post(URL, draft(obj, items=[item]), format="json").status_code == 400


def test_empty_draft_allowed_but_completion_requires_answer(context):
    api, _, _ = context
    row = create(context, items=[])
    assert api.post(f'{URL}{row["id"]}/complete/', {"revision": row["revision"]}, format="json").status_code == 400


def test_listing_requires_object_and_is_paginated(context):
    api, user, obj = context
    create(context)
    assert api.get(URL).status_code == 400
    data = api.get(URL, {"objectId": obj.pk}).json()
    assert data["count"] == 1 and data["page"] == 1 and data["hasNext"] is False
    assert data["today"] and data["canManage"] is True


def test_invalid_record_ids_fail_as_not_found(context):
    api, _, _ = context
    for pk in ("invalid", "99999999999999999999999999999999999999"):
        assert api.get(f"{URL}{pk}/").status_code == 404
        assert api.post(f"{URL}{pk}/complete/", {"revision": 1}, format="json").status_code == 404


def test_draft_cannot_resolve_and_repeat_resolution_conflicts(context):
    api, user, obj = context
    item = {"id": "q1", "question": "Проверка", "answer": "no", "finding": "Замечание", "responsibleUsername": user.username, "dueOn": "2026-11-01"}
    row = create(context, items=[item])
    url = f'{URL}{row["id"]}/'
    assert api.post(url + "resolve/", {"revision": 1, "itemId": "q1", "resolution": "Сделано"}, format="json").status_code == 409
    assert api.post(url + "complete/", {"revision": 1}, format="json").status_code == 200
    assert api.post(url + "resolve/", {"revision": 2, "itemId": "q1", "resolution": " "}, format="json").status_code == 400
    assert api.post(url + "resolve/", {"revision": 2, "itemId": "q1", "resolution": "Сделано"}, format="json").status_code == 200
    assert api.post(url + "resolve/", {"revision": 3, "itemId": "q1", "resolution": "Сделано ещё раз"}, format="json").status_code == 409


def test_due_date_duplicate_ids_and_inactive_responsible_on_complete(context):
    api, user, obj = context
    item = {"id": "q1", "question": "Проверка", "answer": "no", "finding": "Замечание", "responsibleUsername": user.username, "dueOn": "2026-10-01"}
    assert api.post(URL, draft(obj, items=[item]), format="json").status_code == 400
    item["dueOn"] = "2026-11-01"
    assert api.post(URL, draft(obj, items=[item, item]), format="json").status_code == 400
    assignee = get_user_model().objects.create_user(username="responsible-inspector")
    item["responsibleUsername"] = assignee.username
    row = create(context, items=[item])
    assignee.is_active = False
    assignee.save(update_fields=["is_active"])
    assert api.post(f'{URL}{row["id"]}/complete/', {"revision": 1}, format="json").status_code == 400

