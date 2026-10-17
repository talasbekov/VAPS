"""Validate exact-division filters before passing user input to the ORM."""
import pytest

from organization_management.apps.divisions.models import Division
from organization_management.apps.operations.tests.test_bulk_status_api import client_for, make_employee


pytestmark = pytest.mark.django_db
URL = "/api/staff_unit/staff-units/directorate/"


@pytest.fixture
def staff_scope():
    department = Division.objects.create(name="Department", division_type="department")
    first = Division.objects.create(name="First unit", division_type="directorate", parent=department)
    second = Division.objects.create(name="Second unit", division_type="directorate", parent=department)
    people = [make_employee(first), make_employee(second)]
    api, _ = client_for("staff-validation-reader", "STAFF_VALIDATION_READER", ["status.view"], department.pk)
    return api, first, second, people


@pytest.mark.parametrize("value", ["bad", "1.5", "0", "-1", " "])
def test_invalid_division_filter_returns_400_instead_of_an_orm_error(staff_scope, value):
    api, _, _, _ = staff_scope
    response = api.get(URL, {"division_id": value})
    assert response.status_code == 400
    assert "division_id" in response.json()


def test_valid_division_remains_an_exact_filter_inside_existing_scope(staff_scope):
    api, first, second, people = staff_scope
    response = api.get(URL, {"division_id": first.pk})
    assert response.status_code == 200, response.data
    rows = response.json()["staff_units"]
    assert [row["employee"]["id"] for row in rows] == [people[0].pk]
    assert {row["division"]["id"] for row in rows} == {first.pk}
    assert second.pk not in {row["division"]["id"] for row in rows}


def test_foreign_division_filter_does_not_expand_scope(staff_scope):
    api, _, _, _ = staff_scope
    outside = Division.objects.create(name="Outside unit", division_type="directorate")
    make_employee(outside)
    response = api.get(URL, {"division_id": outside.pk})
    assert response.status_code == 200, response.data
    assert response.json()["staff_units"] == []
