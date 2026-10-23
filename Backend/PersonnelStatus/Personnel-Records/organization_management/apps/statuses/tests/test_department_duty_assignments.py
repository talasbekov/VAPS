"""Department status placements do not borrow the global dispatcher's roster."""
from datetime import timedelta

import pytest
from rest_framework.test import APIClient

from organization_management.apps.divisions.models import Division
from organization_management.apps.operations.models_duty_dispatch import OpsDutyDispatchConfig
from organization_management.apps.operations.status_types import StatusType
from organization_management.apps.operations.tests.test_bulk_status_api import client_for, make_employee
from organization_management.apps.ops.tests.test_duty_register_roster import (
    DAY, dispatch, duty, roster_catalog, roster_scene, status_placement,
)

pytestmark = pytest.mark.django_db
URL = "/api/statuses/statuses/duty-assignments/"


def client(name="department-reader", permissions=("status.view", "object.view"), scope=None):
    return client_for(name, "ROLE_" + name, permissions, scope)[0]


def read(scene, api=None, **changes):
    query = {"object_id": str(scene["obj"].pk), "date": DAY.isoformat(),
             "source": "employee_status", "department_id": str(scene["departments"][0].pk)}
    query.update(changes)
    return (api or client()).get(URL, {key: value for key, value in query.items() if value is not None})


def test_department_filter_includes_children_and_excludes_other_departments(roster_scene):
    scene = roster_scene
    first = status_placement(scene)
    child = Division.objects.create(name="Дочернее управление", division_type="directorate", parent=scene["departments"][0])
    nested_person = make_employee(child)
    nested = status_placement(scene, nested_person)
    status_placement(scene, scene["people"][1])
    response = read(scene)
    assert response.status_code == 200, response.data
    assert response.data["scope"] == {"source": "employee_status",
        "department_id": str(scene["departments"][0].pk), "department_name": "Первый"}
    assert {row["status_id"] for row in response.data["results"]} == {first.pk, nested.pk}
    for row in response.data["results"]:
        assert row["department_id"] == str(scene["departments"][0].pk)
        assert row["department_name"] == "Первый"
        assert row["placement"]["object_id"] == str(scene["obj"].pk)
        assert row["placement"]["post_id"] == str(scene["post"].pk)
        assert row["start_date"] == "2026-10-07"
        assert row["end_date"] == "2026-10-08"
        assert "start_at" not in row and "dispatch_assignment_id" not in row


def test_empty_department_keeps_scope_receipt(roster_scene):
    response = read(roster_scene)
    assert response.status_code == 200, response.data
    assert response.data == {"scope": {"source": "employee_status",
        "department_id": str(roster_scene["departments"][0].pk), "department_name": "Первый"}, "results": []}


@pytest.mark.parametrize("changes", [
    {"source": None}, {"department_id": None}, {"source": ""}, {"source": "dispatch"},
    {"source": "STATUS"}, {"department_id": ""}, {"department_id": "0"},
    {"department_id": "-1"}, {"department_id": "bad"}, {"department_id": "9" * 100},
    {"department_id": "9223372036854775808"}, {"department_id": "999999999"},
    {"object_id": None}, {"date": "2026-99-99"},
])
def test_malformed_or_partial_scoped_contract_is_rejected(roster_scene, changes):
    response = read(roster_scene, **changes)
    assert response.status_code == 400, response.data


def test_non_department_identifier_is_rejected(roster_scene):
    child = Division.objects.create(name="Управление", division_type="directorate", parent=roster_scene["departments"][0])
    assert read(roster_scene, department_id=str(child.pk)).status_code == 400


def test_scope_is_intersected_with_status_view_not_replaced_by_department(roster_scene):
    scene = roster_scene
    child = Division.objects.create(name="Разрешённое управление", division_type="directorate", parent=scene["departments"][0])
    person = make_employee(child)
    allowed = status_placement(scene, person)
    status_placement(scene)
    status_placement(scene, scene["people"][1])
    api = client(scope=child.pk)
    response = read(scene, api)
    assert response.status_code == 200, response.data
    assert [row["status_id"] for row in response.data["results"]] == [allowed.pk]
    assert read(scene, api, department_id=str(scene["departments"][1].pk)).data["results"] == []
    assert read(scene, api, employee_id=str(scene["people"][0].pk)).data["results"] == []


@pytest.mark.parametrize("permissions", [("status.view",), ("object.view",), ("duty.dispatch",), ("duty.view",)])
def test_scoped_roster_keeps_both_existing_read_permissions(roster_scene, permissions):
    response = read(roster_scene, client(permissions=permissions))
    assert response.status_code == 403


def test_employee_id_does_not_bypass_object_permission_in_scoped_contract(roster_scene):
    person = roster_scene["people"][0]
    status_placement(roster_scene)
    response = read(roster_scene, client(permissions=("status.view",)), employee_id=str(person.pk))
    assert response.status_code == 403


def test_anonymous_cannot_read_department_assignments(roster_scene):
    assert read(roster_scene, APIClient()).status_code in (401, 403)


def test_cancelled_inactive_and_overridden_statuses_do_not_place_people(roster_scene):
    scene = roster_scene
    department = scene["departments"][0]
    cancelled, inactive, overridden = [make_employee(department) for _ in range(3)]
    saved = status_placement(scene, cancelled)
    saved.state = "cancelled"
    saved.save(update_fields=["state"])
    status_placement(scene, inactive)
    inactive.is_active = False
    inactive.save(update_fields=["is_active"])
    status_placement(scene, overridden)
    duty(overridden, "SICK_LEAVE")
    response = read(scene)
    assert response.status_code == 200, response.data
    assert response.data["results"] == []


def test_same_day_higher_priority_duty_does_not_borrow_personnel_placement(roster_scene):
    scene = roster_scene
    status_placement(scene)
    # Even another ON_DUTY winner cannot borrow a different source's place.
    StatusType.objects.filter(code="GEV").update(priority=5)
    duty(scene["people"][0], "GEV", date_start=DAY - timedelta(days=1))
    response = read(scene)
    assert response.status_code == 200, response.data
    assert response.data["results"] == []


def test_dispatch_is_excluded_without_mutating_global_receiver(roster_scene):
    scene = roster_scene
    config = OpsDutyDispatchConfig.objects.create(singleton_key=1, receiver_department_id=scene["departments"][2].pk)
    assigned = dispatch(scene)
    response = read(scene)
    assert response.status_code == 200, response.data
    assert response.data["results"] == []
    config.refresh_from_db()
    assigned.refresh_from_db()
    assert config.receiver_department_id == scene["departments"][2].pk
    assert assigned.cancelled_at is None


def test_unscoped_contract_keeps_existing_response(roster_scene):
    scene = roster_scene
    saved = status_placement(scene)
    response = read(scene, source=None, department_id=None)
    assert response.status_code == 200, response.data
    assert set(response.data) == {"results"}
    assert [row["status_id"] for row in response.data["results"]] == [saved.pk]
    assert "department_id" not in response.data["results"][0]


def test_object_selection_matches_identifier_not_saved_label(roster_scene):
    scene = roster_scene
    status_placement(scene)
    response = read(scene, object_id="999999999")
    assert response.status_code == 200, response.data
    assert response.data["results"] == []
