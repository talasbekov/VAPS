"""Duty placement is an atomic, scoped annotation of a personnel status."""
from datetime import timedelta

import pytest
from django.utils import timezone

from organization_management.apps.operations.models_object import (
    OpsSecurityObject, OpsObjectSector, OpsSecurityPost,
)
from organization_management.apps.operations.status_types import StatusType
from organization_management.apps.statuses.models import EmployeeStatus
from organization_management.apps.statuses.tests.test_status_writes_require_status_manage import (
    world, _client,
)

pytestmark = pytest.mark.django_db
URL = "/api/statuses/statuses/"


@pytest.fixture
def scene(world):
    StatusType.objects.update_or_create(code="DUTY", defaults={
        "name": "На дежурстве", "legacy_code": "on_duty", "priority": 30,
        "report_column_code": "ABSENT", "is_active": True,
    })
    obj = OpsSecurityObject.objects.create(name="Объект", code="duty-object", object_type="building",
        region="Регион", address="Адрес", object_state="ACTIVE", passport_state="RED", ownership="OWN")
    sector = OpsObjectSector.objects.create(security_object=obj, name="Сектор", position=1)
    post = OpsSecurityPost.objects.create(sector=sector, name="Пост", position=1)
    return {**world, "object": obj, "sector": sector, "post": post,
        "api": _client("duty-head", ("status.manage", "status.view", "object.view"), world["own"].pk)}


def payload(scene, *, employee="own", start=0, end=3, **extra):
    today = timezone.localdate()
    return {"employee": scene["people"][employee].pk, "status_type": "on_duty",
        "start_date": (today + timedelta(days=start)).isoformat(),
        "end_date": (today + timedelta(days=end)).isoformat(),
        "duty_assignment": {"kind": "POST", "object_id": str(scene["object"].pk), "post_id": str(scene["post"].pk)}, **extra}


def create(scene, **kwargs):
    response = scene["api"].post(URL, payload(scene, **kwargs), format="json")
    assert response.status_code == 201, response.data
    return response.data


def roster(scene, api=None, **query):
    return (api or scene["api"]).get(URL + "duty-assignments/", {
        "object_id": scene["object"].pk, "date": timezone.localdate().isoformat(), **query})


@pytest.mark.parametrize("code", ["on_duty", "DUTY"])
def test_create_and_independent_reader_receive_server_placement(scene, code):
    row = create(scene, status_type=code)
    placement = row.get("duty_assignment")
    assert placement == {"kind": "POST", "object_id": str(scene["object"].pk), "object_name": "Объект",
        "post_id": str(scene["post"].pk), "post_name": "Пост", "sector_name": "Сектор", "group_id": None, "group_name": None}
    other = _client("duty-other", ("status.view", "object.view"), scene["own"].pk)
    response = roster(scene, api=other)
    assert response.status_code == 200, response.data
    assert len(response.data["results"]) == 1
    result = response.data["results"][0]
    assert result["status_id"] == row["id"]
    assert result["employee_id"] == scene["people"]["own"].pk
    assert result["employee_name"] == "Сотрудник1 Имя"
    assert result["placement"] == placement
    assert result["start_date"] == row["start_date"]
    assert result["end_date"] == row["end_date"]


@pytest.mark.parametrize("change", [
    {"kind": "POST", "object_id": "999999999", "post_id": "1"},
    {"kind": "POST", "object_id": "object", "post_id": "1"},
    {"kind": "GROUP", "object_id": "SELF", "group_id": "invented"},
    {"kind": "POST", "object_id": "SELF", "post_id": "999999999"},
    {"kind": "POST", "object_id": "SELF"},
    {"kind": "GROUP", "object_id": "SELF", "group_id": "duty-group-1", "post_id": "1"},
    [], "invalid", {},
])
def test_invalid_metadata_rejected_before_existing_status_changes(scene, change):
    employee = scene["people"]["own"]
    before = list(employee.statuses.values("id", "state", "actual_end_date"))
    if isinstance(change, dict):
        change = {key: str(scene["object"].pk) if value == "SELF" else value for key, value in change.items()}
    response = scene["api"].post(URL, payload(scene, duty_assignment=change), format="json")
    assert response.status_code == 400, response.data
    assert list(employee.statuses.values("id", "state", "actual_end_date")) == before


def test_post_from_another_object_is_rejected(scene):
    second = OpsSecurityObject.objects.create(name="Другой", code="duty-other-object", object_type="building",
        region="Регион", address="Адрес", object_state="ACTIVE", passport_state="RED", ownership="OWN")
    response = scene["api"].post(URL, payload(scene, duty_assignment={"kind": "POST", "object_id": str(second.pk), "post_id": str(scene["post"].pk)}), format="json")
    assert response.status_code == 400


def test_group_labels_come_from_server_and_null_preserves_old_clients(scene):
    row = create(scene, duty_assignment={"kind": "GROUP", "object_id": str(scene["object"].pk), "group_id": "duty-group-1", "group_name": "FORGED", "object_name": "FORGED"})
    assert row.get("duty_assignment", {}).get("group_name") == "Группа №1"
    assert row["duty_assignment"]["object_name"] == "Объект"
    assert row["duty_assignment"]["post_id"] is None
    data = payload(scene)
    data.pop("duty_assignment")
    response = scene["api"].post(URL, data, format="json")
    assert response.status_code == 201, response.data
    assert response.data.get("duty_assignment") is None
    assert roster(scene).data["results"] == []


@pytest.mark.parametrize("permissions", [("object.view",), ("status.view",)])
def test_object_roster_reader_requires_both_permissions(scene, permissions):
    create(scene)
    api = _client("duty-denied", permissions, scene["own"].pk)
    assert roster(scene, api=api).status_code == 403


def test_employee_reader_needs_only_scoped_status_permission(scene):
    row = create(scene)
    api = _client("duty-status-only", ("status.view",), scene["own"].pk)
    query = {"employee_id": row["employee"], "date": row["start_date"]}
    response = api.get(URL + "duty-assignments/", query)
    assert response.status_code == 200, response.data
    assert [item["status_id"] for item in response.data["results"]] == [row["id"]]
    query["object_id"] = scene["object"].pk
    assert [item["status_id"] for item in api.get(URL + "duty-assignments/", query).data["results"]] == [row["id"]]
    query["employee_id"] = scene["people"]["foreign"].pk
    assert api.get(URL + "duty-assignments/", query).data["results"] == []


def test_reader_and_writer_respect_employee_scope(scene):
    create(scene)
    denied = scene["api"].post(URL, payload(scene, employee="foreign"), format="json")
    assert denied.status_code == 403
    api = _client("duty-foreign", ("status.view", "object.view"), scene["foreign"].pk)
    response = roster(scene, api=api)
    assert response.status_code == 200
    assert response.data["results"] == []
    assert roster(scene, api=api, employee_id=scene["people"]["own"].pk).data["results"] == []


def test_date_history_end_and_future_replacement_follow_status_rows(scene):
    row = create(scene, start=-2, end=3)
    future = create(scene, start=6, end=8)
    assert [item["status_id"] for item in roster(scene).data["results"]] == [row["id"]]
    status = EmployeeStatus.objects.get(pk=row["id"])
    status.terminate_early(timezone.localdate(), "Завершён")
    assert [item["status_id"] for item in roster(scene).data["results"]] == [row["id"]]
    tomorrow = (timezone.localdate() + timedelta(days=1)).isoformat()
    assert roster(scene, date=tomorrow).data["results"] == []
    assert [item["status_id"] for item in roster(scene, date=future["start_date"]).data["results"]] == [future["id"]]


def test_patch_keeps_historical_names_after_passport_replacement_and_type_change_clears(scene):
    row = create(scene, start=5, end=8)
    scene["sector"].delete()
    response = scene["api"].patch(f'{URL}{row["id"]}/', {"comment": "updated"}, format="json")
    assert response.status_code == 200, response.data
    assert response.data.get("duty_assignment", {}).get("post_name") == "Пост"
    response = scene["api"].patch(f'{URL}{row["id"]}/', {"status_type": "vacation"}, format="json")
    assert response.status_code == 200, response.data
    assert response.data["duty_assignment"] is None
    assert roster(scene, date=row["start_date"]).data["results"] == []


def test_non_duty_metadata_is_rejected_on_create_and_patch(scene):
    data = payload(scene, status_type="vacation")
    assert scene["api"].post(URL, data, format="json").status_code == 400
    row = create(scene, start=5, end=8, status_type="vacation", duty_assignment=None)
    assert scene["api"].patch(f'{URL}{row["id"]}/', {"duty_assignment": payload(scene)["duty_assignment"]}, format="json").status_code == 400


def test_employee_lookup_and_invalid_query(scene):
    row = create(scene)
    response = scene["api"].get(URL + "duty-assignments/", {"employee_id": row["employee"], "date": row["start_date"]})
    assert response.status_code == 200, response.data
    assert response.data["results"][0]["status_id"] == row["id"]
    for query in ({}, {"object_id": "bad", "date": row["start_date"]}, {"object_id": scene["object"].pk, "date": "bad"}, {"date": row["start_date"]}):
        assert scene["api"].get(URL + "duty-assignments/", query).status_code == 400


def test_structured_write_requires_object_permission_but_old_clients_and_lifecycle_do_not(scene):
    api = _client("duty-no-object", ("status.manage", "status.view"), scene["own"].pk)
    assert api.post(URL, payload(scene), format="json").status_code == 403
    row = create(scene, start=5, end=8)
    assert api.patch(f'{URL}{row["id"]}/', {"duty_assignment": payload(scene)["duty_assignment"]}, format="json").status_code == 403
    response = api.patch(f'{URL}{row["id"]}/', {"comment": "changed without object permission"}, format="json")
    assert response.status_code == 200, response.data
    assert response.data["duty_assignment"] is None
    assert EmployeeStatus.objects.get(pk=row["id"]).duty_assignment == row["duty_assignment"]
    data = payload(scene, start=0, end=2)
    data.pop("duty_assignment")
    assert api.post(URL, data, format="json").status_code == 201
    assert api.post(f'{URL}{row["id"]}/cancel/', {"reason": "Отмена"}, format="json").status_code == 200


def test_readers_cannot_write_placement_and_unstaffed_employee_is_hidden(scene):
    viewer = _client("duty-readonly", ("status.view", "object.view"), scene["own"].pk)
    assert viewer.post(URL, payload(scene), format="json").status_code == 403
    create(scene)
    scene["people"]["own"].staff_unit.delete()
    assert roster(scene).data["results"] == []
    assert scene["api"].post(URL, payload(scene), format="json").status_code == 403


@pytest.mark.parametrize("change", [{"start_date": None}, {"end_date": None}, {"end_date": "2000-01-01"}])
def test_placement_requires_a_valid_period_on_create_and_patch(scene, change):
    assert scene["api"].post(URL, payload(scene, **change), format="json").status_code == 400
    row = create(scene, start=5, end=8)
    assert scene["api"].patch(f'{URL}{row["id"]}/', change, format="json").status_code == 400


def test_extend_cancel_and_explicit_clear_do_not_leave_stale_roster(scene):
    row = create(scene, end=1)
    extra_date = (timezone.localdate() + timedelta(days=3)).isoformat()
    assert roster(scene, date=extra_date).data["results"] == []
    response = scene["api"].post(f'{URL}{row["id"]}/extend/', {"new_end_date": extra_date}, format="json")
    assert response.status_code == 200, response.data
    assert roster(scene, date=extra_date).data["results"][0]["status_id"] == row["id"]
    future = create(scene, start=5, end=8)
    response = scene["api"].patch(f'{URL}{future["id"]}/', {"duty_assignment": None}, format="json")
    assert response.status_code == 200, response.data
    assert roster(scene, date=future["start_date"]).data["results"] == []
    future = create(scene, start=10, end=12)
    assert scene["api"].post(f'{URL}{future["id"]}/cancel/', {"reason": "Отмена"}, format="json").status_code == 200
    assert roster(scene, date=future["start_date"]).data["results"] == []


def test_same_day_replacement_cancels_previous_placement(scene):
    first = create(scene)
    second = create(scene, duty_assignment={"kind": "GROUP", "object_id": str(scene["object"].pk), "group_id": "duty-group-reserve"})
    assert EmployeeStatus.objects.get(pk=first["id"]).state == "cancelled"
    assert [item["status_id"] for item in roster(scene).data["results"]] == [second["id"]]


def test_generic_serializer_cannot_bypass_validation_and_put_remains_unsupported(scene):
    from organization_management.apps.statuses.api.serializers import EmployeeStatusSerializer
    row = create(scene, start=5, end=8)
    instance = EmployeeStatus.objects.get(pk=row["id"])
    bad = EmployeeStatusSerializer(instance, data={"status_type": "vacation", "duty_assignment": row["duty_assignment"]}, partial=True)
    assert not bad.is_valid()
    clean = EmployeeStatusSerializer(instance, data={"status_type": "vacation"}, partial=True)
    assert clean.is_valid(), clean.errors
    assert clean.save().duty_assignment is None
    assert scene["api"].put(f'{URL}{row["id"]}/', payload(scene), format="json").status_code == 405


def test_service_validation_precedes_status_changes(scene):
    from django.core.exceptions import ValidationError
    from organization_management.apps.statuses.application.services import StatusApplicationService
    first = create(scene)
    with pytest.raises(ValidationError):
        StatusApplicationService().create_status(employee_id=scene["people"]["own"].pk,
            status_type="on_duty", start_date=timezone.localdate(), end_date=timezone.localdate(),
            duty_assignment={"kind": "GROUP", "object_id": "999999999", "group_id": "duty-group-1"})
    assert EmployeeStatus.objects.get(pk=first["id"]).state == "active"


def test_archived_objects_reject_new_placement_but_keep_existing_history(scene):
    row = create(scene, start=5, end=8)
    scene["object"].object_state = "ARCHIVED"
    scene["object"].save()
    assert scene["api"].post(URL, payload(scene), format="json").status_code == 400
    response = scene["api"].patch(f'{URL}{row["id"]}/', {"comment": "retained"}, format="json")
    assert response.status_code == 200
    assert roster(scene, date=row["start_date"]).data["results"][0]["placement"] == row["duty_assignment"]


def test_oversized_identifier_is_a_validation_error(scene):
    # Reject before Python's integer-string limit and PostgreSQL bigint parsing.
    malformed = "9" * 5000
    response = roster(scene, object_id=malformed)
    assert response.status_code == 400


def test_location_and_projection_use_trusted_placement_on_create_and_patch(scene):
    from organization_management.apps.operations.models_status import OpsEmployeeStatus
    row = create(scene, start=5, end=8, location="FORGED")
    assert row["location"] == "Объект · Пост"
    projection = OpsEmployeeStatus.objects.get(source_ref=f'personnel:{row["id"]}', cancelled_at__isnull=True)
    assert projection.status_type_code == "DUTY"
    assert projection.date_start.isoformat() == row["start_date"]
    response = scene["api"].patch(f'{URL}{row["id"]}/', {"duty_assignment": {
        "kind": "GROUP", "object_id": str(scene["object"].pk), "group_id": "duty-group-2"}, "location": "FORGED"}, format="json")
    assert response.status_code == 200, response.data
    assert response.data["location"] == "Объект · Группа №2"
    projection.refresh_from_db()
    assert projection.status_type_code == "DUTY"
    assert projection.date_start.isoformat() == row["start_date"]
    response = scene["api"].patch(f'{URL}{row["id"]}/', {"location": "FORGED AGAIN"}, format="json")
    assert response.status_code == 200
    assert response.data["location"] == "Объект · Группа №2"


def test_long_structured_labels_are_truncated_only_in_legacy_location(scene):
    scene["object"].name = "О" * 240
    scene["object"].save()
    scene["post"].name = "П" * 100
    scene["post"].save()
    row = create(scene, location="untrusted" * 100)
    assert row["location"] == ("О" * 240 + " · " + "П" * 100)[:255]
    assert row["duty_assignment"]["post_name"] == "П" * 100


def test_legacy_custom_location_is_unchanged_without_metadata(scene):
    row = create(scene, duty_assignment=None, location="Комната 123")
    assert row["location"] == "Комната 123"


@pytest.mark.parametrize("route", ["list", "retrieve", "planned", "history"])
def test_ordinary_status_reads_redact_placement_without_object_permission(scene, route):
    row = create(scene, start=-8, end=-5) if route == "history" else create(scene, start=5, end=8)
    api = _client("duty-status-reader", ("status.view",), scene["own"].pk)
    if route == "retrieve":
        response = api.get(f'{URL}{row["id"]}/')
        rows = [response.data]
    else:
        response = api.get(URL if route == "list" else f"{URL}{route}/", {
            "employee" if route == "list" else "employee_id": row["employee"]})
        rows = response.data.get("results", []) if isinstance(response.data, dict) else response.data
        if route == "planned":
            rows = response.data["planned"]
    assert response.status_code == 200, response.data
    matching = [item for item in rows if item["id"] == row["id"]]
    assert len(matching) == 1
    assert matching[0]["duty_assignment"] is None
    assert matching[0]["location"] == row["location"]
    assert EmployeeStatus.objects.get(pk=row["id"]).duty_assignment == row["duty_assignment"]


def test_admin_ordinary_status_response_keeps_placement(scene):
    row = create(scene, start=5, end=8)
    api = _client("duty-admin", ("*",), None)
    response = api.get(f'{URL}{row["id"]}/')
    assert response.status_code == 200
    assert response.data["duty_assignment"] == row["duty_assignment"]


def test_serializer_without_request_redacts_output_but_keeps_internal_validation_writable(scene):
    from organization_management.apps.statuses.api.serializers import EmployeeStatusSerializer
    row = create(scene, start=5, end=8)
    instance = EmployeeStatus.objects.get(pk=row["id"])
    assert EmployeeStatusSerializer(instance).data["duty_assignment"] is None
    serializer = EmployeeStatusSerializer(instance, data={"duty_assignment": {
        "kind": "GROUP", "object_id": str(scene["object"].pk), "group_id": "duty-group-3"}}, partial=True)
    assert serializer.is_valid(), serializer.errors
    serializer.save()
    assert serializer.data["duty_assignment"] is None
    instance.refresh_from_db()
    assert instance.duty_assignment["group_name"] == "Группа №3"
