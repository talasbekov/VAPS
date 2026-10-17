"""Bulk staffing writes obey dictionary lifecycle and the granted division scope."""
import pytest

from organization_management.apps.dictionaries.models import Position, Rank
from organization_management.apps.divisions.models import Division
from organization_management.apps.employees.models import Employee
from organization_management.apps.operations.tests.support import client_for
from organization_management.apps.staff_unit.models import StaffUnit

pytestmark = pytest.mark.django_db
URL = "/api/staff_unit/staff-units/directorate/"


@pytest.fixture
def staffing():
    own = Division.objects.create(name="Own", code="BULK-OWN")
    other = Division.objects.create(name="Other", code="BULK-OTHER")
    position = Position.objects.create(code="BULK-P", name="Position", level=10)
    rank = Rank.objects.create(code="BULK-R", name="Rank", level=10)
    employee = Employee.objects.create(personnel_number="BULK1", first_name="First",
                                       last_name="Last", iin="123456789012", rank=rank)
    unit = StaffUnit.objects.create(division=own, position=position, employee=employee, index=1)
    api, _ = client_for("bulk_manager", "BULK_MANAGER", ["orgstructure.manage", "admin.roles"], own.pk)
    return api, own, other, employee, unit


def test_bulk_update_refuses_invalid_iin_and_preserves_employee(staffing):
    api, _, _, employee, _ = staffing
    response = api.patch(URL, {"employees": [{"id": employee.pk, "iin": "abc"}]}, format="json")
    assert response.status_code == 200, response.content
    assert response.json().get("errors"), response.json()
    employee.refresh_from_db()
    assert employee.iin == "123456789012"


@pytest.mark.parametrize("kind", ["rank", "position"])
def test_bulk_update_refuses_new_inactive_dictionary_value(staffing, kind):
    api, _, _, employee, unit = staffing
    model = Rank if kind == "rank" else Position
    inactive = model.objects.create(code=f"BULK-INACTIVE-{kind}", name="Inactive", level=20, is_active=False)
    obj, section = (employee, "employees") if kind == "rank" else (unit, "staff_units")
    old_id = getattr(obj, f"{kind}_id")
    response = api.patch(URL, {section: [{"id": obj.pk, kind: inactive.pk}]}, format="json")
    assert response.status_code == 200, response.content
    assert response.json().get("errors"), response.json()
    obj.refresh_from_db()
    assert getattr(obj, f"{kind}_id") == old_id


@pytest.mark.parametrize("kind", ["rank", "position"])
def test_bulk_update_keeps_current_inactive_dictionary_value(staffing, kind):
    api, _, _, employee, unit = staffing
    obj, section = (employee, "employees") if kind == "rank" else (unit, "staff_units")
    row = getattr(obj, kind)
    row.is_active = False
    row.save(update_fields=["is_active"])
    payload = {"id": obj.pk, kind: row.pk}
    payload.update({"first_name": "Changed"} if kind == "rank" else {"index": 2})
    response = api.patch(URL, {section: [payload]}, format="json")
    assert response.status_code == 200, response.content
    assert not response.json().get("errors"), response.json()
    obj.refresh_from_db()
    assert obj.first_name == "Changed" if kind == "rank" else obj.index == 2


def test_bulk_create_refuses_inactive_rank_before_creating_employee(staffing):
    api, _, _, _, _ = staffing
    inactive = Rank.objects.create(code="BULK-CREATE-R", name="Inactive", level=20, is_active=False)
    response = api.post(URL, {"employees": [{"first_name": "New", "last_name": "Employee",
                                            "iin": "123456789013", "rank": inactive.pk}]}, format="json")
    assert response.status_code == 201, response.content
    assert response.json().get("errors"), response.json()
    assert not Employee.objects.filter(iin="123456789013").exists()


def test_bulk_create_refuses_inactive_position(staffing):
    api, own, _, _, _ = staffing
    employee = Employee.objects.create(personnel_number="BULK-UNASSIGNED", first_name="New",
                                       last_name="Employee", iin="123456789015")
    inactive = Position.objects.create(code="BULK-CREATE-P", name="Inactive", level=20, is_active=False)
    response = api.post(URL, {"staff_units": [{"division": own.pk, "position": inactive.pk,
                                              "iin": employee.iin}]}, format="json")
    assert response.status_code == 201, response.content
    assert response.json().get("errors"), response.json()
    assert not StaffUnit.objects.filter(position=inactive).exists()


def test_bulk_update_refuses_employee_outside_scope(staffing):
    api, _, other, _, _ = staffing
    employee = Employee.objects.create(personnel_number="BULK-OUT", first_name="Outside", last_name="Scope")
    StaffUnit.objects.create(division=other, employee=employee, index=1)
    response = api.patch(URL, {"employees": [{"id": employee.pk, "first_name": "Changed"}]}, format="json")
    assert response.status_code == 200, response.content
    assert response.json().get("errors"), response.json()
    employee.refresh_from_db()
    assert employee.first_name == "Outside"


def test_bulk_create_accepts_active_rank_and_position(staffing):
    api, own, _, employee, unit = staffing
    response = api.post(URL, {
        "employees": [{"first_name": "New", "last_name": "Employee",
                       "iin": "123456789016", "rank": employee.rank_id}],
        "staff_units": [{"division": own.pk, "position": unit.position_id}],
    }, format="json")
    assert response.status_code == 201, response.content
    assert not response.json().get("errors"), response.json()
    created = Employee.objects.get(iin="123456789016")
    assert StaffUnit.objects.get(employee=created).position_id == unit.position_id


def test_bulk_update_refuses_moving_slot_outside_scope(staffing):
    api, own, other, _, unit = staffing
    response = api.patch(URL, {"staff_units": [{"id": unit.pk, "division": other.pk}]}, format="json")
    assert response.status_code == 200, response.content
    assert response.json().get("errors"), response.json()
    unit.refresh_from_db()
    assert unit.division_id == own.pk


def test_bulk_update_can_clear_rank(staffing):
    api, _, _, employee, _ = staffing
    response = api.patch(URL, {"employees": [{"id": employee.pk, "rank": None}]}, format="json")
    assert response.status_code == 200, response.content
    assert not response.json().get("errors"), response.json()
    employee.refresh_from_db()
    assert employee.rank_id is None


def test_bulk_employee_creation_still_requires_account_admin_permission(staffing):
    _, own, _, _, _ = staffing
    api, _ = client_for("bulk_no_admin", "BULK_NO_ADMIN", ["orgstructure.manage"], own.pk)
    response = api.post(URL, {"employees": [{"first_name": "Denied", "last_name": "Employee",
                                            "iin": "123456789017"}]}, format="json")
    assert response.status_code == 403, response.content
    assert not Employee.objects.filter(iin="123456789017").exists()
