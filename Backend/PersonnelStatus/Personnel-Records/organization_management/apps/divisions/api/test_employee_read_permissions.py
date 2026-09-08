"""RBAC-граница legacy action employees (Plane №1034).

Action отдаёт кадровую карточку с IIN и личными
контактами, поэтому одного факта входа недостаточно:
нужны `personnel.view` и область этого гранта.
"""

import pytest

from organization_management.apps.dictionaries.models import Position
from organization_management.apps.divisions.models import Division
from organization_management.apps.employees.models import Employee
from organization_management.apps.operations.tests.test_bulk_status_api import (
    client_for,
)
from organization_management.apps.staff_unit.models import StaffUnit

pytestmark = pytest.mark.django_db

URL = "/api/divisions/divisions/"


@pytest.fixture
def personnel_tree():
    root = Division.objects.create(
        name="Организация", code="DIV-EMP-ROOT",
        division_type=Division.DivisionType.ORGANIZATION,
    )
    own = Division.objects.create(
        name="Свой департамент", code="DIV-EMP-OWN",
        division_type=Division.DivisionType.DEPARTMENT, parent=root,
    )
    own_child = Division.objects.create(
        name="Своё управление", code="DIV-EMP-CHILD",
        division_type=Division.DivisionType.DIRECTORATE, parent=own,
    )
    foreign = Division.objects.create(
        name="Чужой департамент", code="DIV-EMP-FOREIGN",
        division_type=Division.DivisionType.DEPARTMENT, parent=root,
    )
    position = Position.objects.create(
        name="Инспектор", code="DIV-EMP-POS", level=1,
    )
    people = {}
    for index, (key, division) in enumerate(
        (("own", own_child), ("foreign", foreign)), start=1
    ):
        employee = Employee.objects.create(
            personnel_number=f"DIV-EMP-{index}",
            last_name=f"Сотрудник-{key}", first_name="Имя",
            iin=f"1234567890{index:02d}",
            personal_email=f"{key}@example.test",
        )
        StaffUnit.objects.create(
            division=division, position=position, employee=employee, index=1,
        )
        people[key] = employee
    return {
        "own": own, "own_child": own_child, "foreign": foreign,
        "people": people,
    }


def employee_url(division_id):
    return f"{URL}{division_id}/employees/"


def test_authenticated_user_without_personnel_view_is_refused(personnel_tree):
    api, _ = client_for("division-employees-no-right")

    existing = api.get(employee_url(personnel_tree["own_child"].pk))
    missing = api.get(employee_url(999_999_999))

    assert existing.status_code == 403, existing.content
    assert missing.status_code == 403, missing.content
    assert existing.json() == missing.json()


def test_scoped_reader_sees_employees_only_in_its_subtree(personnel_tree):
    api, _ = client_for(
        "division-employees-scoped", "DIVISION_EMPLOYEES_SCOPED",
        ["personnel.view"], personnel_tree["own"].pk,
    )

    own = api.get(employee_url(personnel_tree["own_child"].pk))
    foreign = api.get(employee_url(personnel_tree["foreign"].pk))
    missing = api.get(employee_url(999_999_999))

    assert own.status_code == 200, own.content
    assert [row["id"] for row in own.json()] == [personnel_tree["people"]["own"].pk]
    # Существует ли чужой division, ответ не раскрывает.
    assert foreign.status_code == missing.status_code == 404
    assert foreign.json() == missing.json()


def test_unscoped_reader_can_read_any_division(personnel_tree):
    api, _ = client_for(
        "division-employees-global", "DIVISION_EMPLOYEES_GLOBAL",
        ["personnel.view"], None,
    )

    response = api.get(employee_url(personnel_tree["foreign"].pk))

    assert response.status_code == 200, response.content
    assert [row["id"] for row in response.json()] == [
        personnel_tree["people"]["foreign"].pk
    ]
    assert response.json()[0]["iin"] == personnel_tree["people"]["foreign"].iin
