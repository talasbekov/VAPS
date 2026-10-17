"""A failed batch row cannot shift or roll back another employee/slot pair."""
import pytest

from organization_management.apps.dictionaries.models import Position
from organization_management.apps.employees.models import Employee
from organization_management.apps.staff_unit.models import StaffUnit
from organization_management.apps.staff_unit.tests.test_directorate_validation import staffing

pytestmark = pytest.mark.django_db
URL = "/api/staff_unit/staff-units/directorate/"


def employee(iin, first_name="New"):
    return {"first_name": first_name, "last_name": "Batch", "iin": iin}


def test_invalid_employee_does_not_shift_the_next_slot(staffing):
    api, own, _, _, unit = staffing
    second_position = Position.objects.create(code="BATCH-SECOND", name="Second", level=11)
    response = api.post(URL, {
        "employees": [employee("invalid"), employee("123456789020")],
        "staff_units": [{"division": own.pk, "position": unit.position_id},
                        {"division": own.pk, "position": second_position.pk}],
    }, format="json")
    created = Employee.objects.get(iin="123456789020")
    assert StaffUnit.objects.get(employee=created).position_id == second_position.pk
    assert [row["id"] for row in response.json()["created"]["employees"]] == [created.pk]
    assert response.json()["success"] is True
    assert response.json()["errors"][0]["index"] == 0



def test_failed_slot_only_rolls_back_its_paired_employee(staffing):
    api, own, other, _, unit = staffing
    response = api.post(URL, {
        "employees": [employee("123456789021"), employee("123456789022")],
        "staff_units": [{"division": other.pk, "position": unit.position_id},
                        {"division": own.pk, "position": unit.position_id}],
    }, format="json")
    assert not Employee.objects.filter(iin="123456789021").exists()
    created = Employee.objects.get(iin="123456789022")
    assert StaffUnit.objects.get(employee=created).division_id == own.pk
    assert [row["id"] for row in response.json()["created"]["employees"]] == [created.pk]
    assert response.json()["errors"][0]["index"] == 0


def test_atomic_creation_reports_no_committed_rows(staffing):
    api, own, other, _, unit = staffing
    response = api.post(URL, {
        "atomic": True,
        "employees": [employee("123456789023"), employee("123456789024")],
        "staff_units": [{"division": own.pk, "position": unit.position_id},
                        {"division": other.pk, "position": unit.position_id}],
    }, format="json")
    assert not Employee.objects.filter(iin__in=["123456789023", "123456789024"]).exists()
    assert response.json()["success"] is False
    assert response.json()["rolled_back"] is True
    assert response.json()["created"] == {"employees": [], "staff_units": []}


def test_atomic_update_reports_zero_committed_counts(staffing):
    api, _, _, person, _ = staffing
    response = api.patch(URL, {"atomic": True, "employees": [
        {"id": person.pk, "first_name": "Changed"}, {"id": person.pk, "iin": "invalid"},
    ]}, format="json")
    person.refresh_from_db()
    assert person.first_name == "First"
    assert response.json()["updated"] == {"staff_units": 0, "employees": 0, "statuses": 0}
    assert response.json()["success"] is False
    assert response.json()["rolled_back"] is True


def test_integrity_error_in_one_pair_does_not_poison_the_next(staffing, monkeypatch):
    api, own, _, existing, unit = staffing
    original = StaffUnit.save

    def fail_first(self, *args, **kwargs):
        if self.employee.iin == "123456789025":
            Employee.objects.create(personnel_number=existing.personnel_number, first_name="Duplicate", last_name="Test")
        return original(self, *args, **kwargs)

    monkeypatch.setattr(StaffUnit, "save", fail_first)
    response = api.post(URL, {
        "employees": [employee("123456789025"), employee("123456789026")],
        "staff_units": [{"division": own.pk, "position": unit.position_id},
                        {"division": own.pk, "position": unit.position_id}],
    }, format="json")
    assert not Employee.objects.filter(iin="123456789025").exists()
    created = Employee.objects.get(iin="123456789026")
    assert StaffUnit.objects.filter(employee=created).exists()
    assert response.json()["success"] is True
    assert response.json()["errors"][0]["index"] == 0


def test_partial_update_success_reflects_committed_rows(staffing):
    api, _, _, person, _ = staffing
    response = api.patch(URL, {"employees": [
        {"id": person.pk, "first_name": "Changed"}, {"id": person.pk, "iin": "invalid"},
    ]}, format="json")
    person.refresh_from_db()
    assert person.first_name == "Changed"
    assert response.json()["success"] is True
    assert response.json()["rolled_back"] is False
    assert response.json()["updated"]["employees"] == 1
    assert response.json()["errors"][0]["index"] == 1


@pytest.mark.parametrize("section", ["employees", "staff_units", "employee_statuses"])
def test_malformed_sections_are_refused_before_writing(staffing, section):
    api, _, _, _, _ = staffing
    response = api.patch(URL, {section: {"id": 1}}, format="json")
    assert response.status_code == 400


def test_numeric_personnel_number_allocation_is_not_lexical(staffing):
    api, _, _, _, _ = staffing
    Employee.objects.create(personnel_number="9", first_name="Nine", last_name="Test")
    Employee.objects.create(personnel_number="10", first_name="Ten", last_name="Test")
    response = api.post(URL, {"employees": [employee("123456789027")]}, format="json")
    assert not response.json()["errors"]
    assert Employee.objects.get(iin="123456789027").personnel_number == "000011"
