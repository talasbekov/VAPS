"""Personnel lists follow position hierarchy and preserve actual slot divisions."""
from datetime import date, timedelta

import pytest
from django.contrib.auth import get_user_model
from django.db import connection
from django.test.utils import CaptureQueriesContext
from django.urls import reverse
from django.utils import timezone
from rest_framework.test import APIClient

from organization_management.apps.dictionaries.models import Position
from organization_management.apps.divisions.models import Division
from organization_management.apps.employees.models import Employee
from organization_management.apps.staff_unit.models import StaffUnit
from organization_management.apps.statuses.models import EmployeeStatus


pytestmark = pytest.mark.django_db


@pytest.fixture
def roster():
    root = Division.objects.create(name="Служба", code="hier-root", division_type="organization")
    department = Division.objects.create(
        name="Департамент", code="hier-dept", division_type="department", parent=root,
    )
    first = Division.objects.create(
        name="Управление", code="hier-dir-1", division_type="directorate", parent=department,
    )
    other_department = Division.objects.create(
        name="Другой департамент", code="hier-dept-2", division_type="department", parent=root,
    )
    second = Division.objects.create(
        name="Управление", code="hier-dir-2", division_type="directorate", parent=other_department,
    )
    section = Division.objects.create(
        name="Первый отдел", code="hier-section", division_type="division", parent=first,
    )
    nested = Division.objects.create(
        name="Группа", code="hier-nested", division_type="division", parent=section,
    )
    inspector = Position.objects.create(name="Инспектор", code="hier-insp", level=8)
    deputy = Position.objects.create(name="Заместитель", code="hier-deputy", level=2)
    chief = Position.objects.create(name="Начальник", code="hier-chief", level=1)

    def slot(position, index, division=section, import_order=None):
        employee = Employee.objects.create(
            personnel_number=f"hier-{index}", last_name=f"Сотрудник{index}",
            first_name="Имя", middle_name="Отчество", birth_date=date(1990, 1, 1),
            hire_date=None,
        )
        return StaffUnit.objects.create(
            division=division, position=position, index=index, employee=employee,
            import_order=import_order, external_id=f"import-hier-{index}" if import_order else None,
        )

    # Create in the reverse order; FK/tree creation order cannot satisfy this fixture.
    late_import = slot(inspector, 4, import_order=20)
    early_import = slot(inspector, 5, import_order=10)
    late_native = slot(inspector, 9, division=second)
    early_native = slot(inspector, 7, division=nested)
    deputy_unit = slot(deputy, 2)
    chief_unit = slot(chief, 3, division=first)
    unclassified = slot(None, 1, division=department)
    return {
        "department": department, "first": first, "second": second,
        "section": section, "nested": nested, "chief": chief_unit,
        "early_native": early_native, "unclassified": unclassified,
        "expected": [chief_unit, deputy_unit, early_import, late_import, early_native, late_native, unclassified],
    }


@pytest.fixture
def client():
    api = APIClient()
    api.force_authenticate(get_user_model().objects.create_superuser(username="hierarchy-admin"))
    return api


def rows(client, query=""):
    response = client.get(reverse("staffunit-directorate-management") + query)
    assert response.status_code == 200, response.data
    return response.data["staff_units"]


def test_position_order_applies_before_pagination_and_preserves_imports(client, roster):
    actual = [row for page in range(1, 5) for row in rows(client, f"?page={page}&page_size=2")]
    assert [row["id"] for row in actual] == [unit.pk for unit in roster["expected"]]
    imported = roster["expected"][2]
    imported.refresh_from_db()
    assert imported.external_id == "import-hier-5"
    assert imported.import_order == 10
    assert imported.employee.hire_date is None


def test_ancestor_metadata_groups_direct_and_nested_staff_without_replacing_division(client, roster):
    actual = {row["id"]: row for row in rows(client)}
    direct = actual[roster["chief"].pk]
    nested = actual[roster["early_native"].pk]
    assert direct["directorate_id"] == nested["directorate_id"] == roster["first"].pk
    assert direct["directorate_name"] == nested["directorate_name"] == "Управление"
    assert nested["department_id"] == roster["department"].pk
    assert nested["department_name"] == "Департамент"
    assert nested["division"] == {"id": roster["nested"].pk, "name": "Группа"}
    assert nested["employee"]["middle_name"] == "Отчество"
    other = actual[roster["expected"][5].pk]
    assert other["directorate_name"] == nested["directorate_name"]
    assert other["directorate_id"] != nested["directorate_id"]
    assert actual[roster["unclassified"].pk]["directorate_id"] is None


def test_directorate_filter_includes_descendants_and_keeps_exact_division_filter(client, roster):
    selected = rows(client, f"?directorate_id={roster['first'].pk}")
    assert {row["id"] for row in selected} == {unit.pk for unit in roster["expected"][:5]}
    exact = rows(client, f"?division_id={roster['section'].pk}")
    assert {row["division"]["id"] for row in exact} == {roster["section"].pk}


def test_ancestor_lookup_does_not_add_queries_per_employee(client, roster):
    with CaptureQueriesContext(connection) as single:
        first = rows(client, "?page=1&page_size=1")
    with CaptureQueriesContext(connection) as whole:
        all_rows = rows(client, "?page=1&page_size=20")
    assert len(all_rows) == 7
    assert first[0]["department_id"] == roster["department"].pk
    assert len(whole) <= len(single)


@pytest.mark.parametrize("status_type", [
    EmployeeStatus.StatusType.VACATION,
    EmployeeStatus.StatusType.BUSINESS_TRIP,
    EmployeeStatus.StatusType.SICK_LEAVE,
])
def test_current_status_retains_destination_for_editing(client, roster, status_type):
    today = timezone.localdate()
    EmployeeStatus.objects.create(
        employee=roster["chief"].employee, status_type=status_type,
        start_date=today, end_date=today + timedelta(days=2),
        state=EmployeeStatus.StatusState.ACTIVE, location="Астана",
        created_by=get_user_model().objects.get(username="hierarchy-admin"),
    )
    current = next(row for row in rows(client) if row["id"] == roster["chief"].pk)
    assert current["employee"]["current_status"]["location"] == "Астана"


@pytest.mark.parametrize("value", ["not-a-number", "0", "-1"])
def test_invalid_directorate_filter_is_rejected(client, value):
    response = client.get(reverse("staffunit-directorate-management"), {"directorate_id": value})
    assert response.status_code == 400
    assert "directorate_id" in response.data
