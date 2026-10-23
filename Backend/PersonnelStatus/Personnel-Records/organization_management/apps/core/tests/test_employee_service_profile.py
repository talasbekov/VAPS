"""Personal inventory is explicit, scoped and never inferred from a duty post."""
from copy import deepcopy

import pytest

from organization_management.apps.employees.service_profile import normalize_profile
from organization_management.apps.statuses.tests.test_duty_assignments import scene, world, create, roster


def sample():
    return {
        "inventory": [{"category": "magazine", "name": "TEST-ITEM", "quantity": 0}],
        "skills": {"shooting": 3, "hand_to_hand": None, "physical_fitness": 5},
        "health": {"condition": "TEST-A", "chronic_conditions": None, "restrictions": ""},
        "height_cm": 180, "weight_kg": 80.5,
    }


def test_unknown_empty_and_zero_are_different():
    assert normalize_profile({})["inventory"] is None
    assert normalize_profile({"inventory": []})["inventory"] == []
    assert normalize_profile(sample()) == sample()
    assert normalize_profile({})["health"] == {
        "condition": None, "chronic_conditions": None, "restrictions": None,
    }


@pytest.mark.parametrize("quantity", ["2", True, -1, 1.5, 9007199254740992])
def test_inventory_rejects_ambiguous_quantities(quantity):
    data = sample()
    data["inventory"][0]["quantity"] = quantity
    with pytest.raises(ValueError):
        normalize_profile(data)


@pytest.mark.parametrize("patch", [
    {"skills": {"shooting": 0}}, {"skills": {"shooting": 6}},
    {"skills": {"shooting": "3"}}, {"skills": {"shooting": True}},
    {"height_cm": 0}, {"weight_kg": "80"}, {"weight_kg": float("nan")},
    {"health": {"condition": "x" * 2001}},
    {"inventory": [{"category": "unknown", "name": "TEST", "quantity": 1}]},
    {"inventory": [{"category": "weapon", "name": " ", "quantity": 1}]},
    {"inventory": [{"category": "other", "name": "TEST"}]},
    {"health": {"fitness_for_duty": "fit"}},
    {"health": {"condition": "TEST\u000b"}},
    {"inventory": [{"category": [], "name": "TEST", "quantity": 1}]},
    {"height_cm": 10 ** 400},
])
def test_invalid_profile_never_silently_becomes_a_valid_default(patch):
    with pytest.raises(ValueError):
        normalize_profile({**sample(), **patch})


@pytest.fixture
def people(db):
    from organization_management.apps.dictionaries.models import Position
    from organization_management.apps.divisions.models import Division
    from organization_management.apps.employees.models import Employee
    from organization_management.apps.staff_unit.models import StaffUnit
    divisions = [Division.objects.create(name=f"TEST-DIVISION-{i}") for i in range(2)]
    position = Position.objects.create(name="TEST-POSITION", code="PROFILE-TEST", level=1)
    employees = []
    for i, division in enumerate(divisions):
        employee = Employee.objects.create(personnel_number=f"PROFILE-{i}", first_name="TEST", last_name="TEST")
        StaffUnit.objects.create(employee=employee, division=division, position=position, index=i)
        employees.append(employee)
    return divisions, employees


def url(employee):
    return f"/api/core/service-employees/{employee.pk}/service-profile/"


@pytest.mark.django_db
def test_profile_round_trip_stale_revision_and_validation_are_atomic(people):
    from organization_management.apps.operations.tests.test_bulk_status_api import client_for
    _, employees = people
    api, _ = client_for("profile-editor", "PROFILE-EDITOR", ["personnel.view", "orgstructure.manage", "admin.roles"])
    initial = api.get(url(employees[0]))
    assert initial.status_code == 200
    assert initial.data["profile"]["updated_at"] is None
    assert initial.data["revision"] == 0
    assert initial.data["can_edit"] is True
    saved = api.put(url(employees[0]), {"revision": 0, "profile": sample()}, format="json")
    assert saved.status_code == 200
    assert saved.data["profile"]["health"]["condition"] == "TEST-A"
    assert saved.data["profile"]["updated_at"] is not None
    assert saved.data["revision"] == 1
    conflict = api.put(url(employees[0]), {"revision": 0, "profile": {}}, format="json")
    assert conflict.status_code == 409
    invalid = deepcopy(sample())
    invalid["inventory"][0]["quantity"] = -1
    assert api.put(url(employees[0]), {"revision": 1, "profile": invalid}, format="json").status_code == 400
    assert api.get(url(employees[0])).data == saved.data


@pytest.mark.django_db
def test_read_scope_does_not_grant_edit_or_cross_division_read(people):
    from organization_management.apps.operations.tests.test_bulk_status_api import client_for
    divisions, employees = people
    api, _ = client_for("profile-reader", "PROFILE-READER", ["personnel.view"], divisions[0].pk)
    assert api.get(url(employees[0])).data["can_edit"] is False
    assert api.put(url(employees[0]), {"revision": 0, "profile": sample()}, format="json").status_code == 403
    assert api.get(url(employees[1])).status_code == 404
    api, user = client_for("profile-self")
    employees[0].user = user
    employees[0].save(update_fields=["user"])
    assert api.get(url(employees[0])).status_code == 200
    assert api.put(url(employees[0]), {"revision": 0, "profile": sample()}, format="json").status_code == 403


@pytest.mark.django_db
def test_global_read_with_local_edit_cannot_write_foreign_employee(people):
    from organization_management.apps.operations.tests.test_bulk_status_api import client_for
    from organization_management.apps.operations.models import Permission, Role, RolePermission
    from organization_management.apps.operations.services import RoleAdminService
    divisions, employees = people
    api, user = client_for("profile-local-editor", "PROFILE-LOCAL", ["orgstructure.manage", "admin.roles"], divisions[0].pk)
    role = Role.objects.create(code="PROFILE-GLOBAL-READ", name="TEST")
    permission, _ = Permission.objects.get_or_create(code="personnel.view", defaults={"name": "TEST"})
    RolePermission.objects.create(role_code=role, permission_code=permission)
    RoleAdminService.assign_role(str(user.pk), role.code, None, actor="test")
    assert api.get(url(employees[0])).data["can_edit"] is True
    assert api.get(url(employees[1])).data["can_edit"] is False
    assert api.put(url(employees[1]), {"revision": 0, "profile": sample()}, format="json").status_code == 403


@pytest.mark.django_db
def test_export_keeps_assignments_but_requires_employee_read_scope(people):
    from rest_framework.test import APIRequestFactory, force_authenticate
    from rest_framework.request import Request
    from organization_management.apps.operations.tests.test_bulk_status_api import client_for
    from organization_management.apps.employees.models import EmployeeServiceProfile
    from organization_management.apps.core.api.employee_service_profile import attach_service_profiles
    divisions, employees = people
    EmployeeServiceProfile.objects.create(employee=employees[0], data=sample(), revision=1)
    EmployeeServiceProfile.objects.create(employee=employees[1], data={**sample(), "height_cm": 190}, revision=1)
    _, user = client_for("profile-export-reader", "PROFILE-EXPORT", ["personnel.view"], divisions[0].pk)
    raw = APIRequestFactory().get("/")
    force_authenticate(raw, user=user)
    request = Request(raw)
    rows = [{"employee_id": e.pk, "placement": {"post": "TEST"}} for e in employees]
    result = attach_service_profiles(request, rows)
    assert len(result) == 2
    assert result[0]["service_profile"]["height_cm"] == 180
    assert result[1]["service_profile"] is None
    _, user = client_for("profile-status-only", "PROFILE-STATUS", ["status.view", "object.view"])
    raw = APIRequestFactory().get("/")
    force_authenticate(raw, user=user)
    assert all(row["service_profile"] is None for row in attach_service_profiles(Request(raw), rows))


@pytest.mark.django_db
def test_duty_endpoint_adds_profile_only_for_personnel_reader(scene):
    from organization_management.apps.employees.models import EmployeeServiceProfile
    from organization_management.apps.operations.tests.test_bulk_status_api import client_for
    create(scene)
    employee = scene["people"]["own"]
    EmployeeServiceProfile.objects.create(employee=employee, data=sample(), revision=1)
    limited = roster(scene)
    assert limited.status_code == 200
    assert limited.data["results"][0]["service_profile"] is None
    api, _ = client_for("profile-duty-reader", "PROFILE-DUTY-READER",
                        ["personnel.view", "status.view", "object.view"], scene["own"].pk)
    result = roster(scene, api=api)
    assert result.status_code == 200
    assert result.data["results"][0]["employee_id"] == employee.pk
    assert result.data["results"][0]["service_profile"]["inventory"] == sample()["inventory"]


@pytest.mark.django_db
@pytest.mark.parametrize("patch", [
    {"inventory": [{"category": {}, "name": "TEST", "quantity": 1}]},
    {"height_cm": 10 ** 400},
    {"health": {"condition": "TEST\u0000"}},
    {"health": {"condition": "TEST\u000b"}},
])
def test_malformed_json_values_are_400_not_server_errors(people, patch):
    from organization_management.apps.operations.tests.test_bulk_status_api import client_for
    _, employees = people
    api, _ = client_for("profile-bad-json", "PROFILE-BAD-JSON", ["personnel.view", "orgstructure.manage", "admin.roles"])
    response = api.put(url(employees[0]), {"revision": 0, "profile": {**sample(), **patch}}, format="json")
    assert response.status_code == 400
    assert "TEST" not in str(response.data)
    assert api.get(url(employees[0])).data["revision"] == 0
