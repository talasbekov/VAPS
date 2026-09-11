"""The imported links and nullable facts are visible through the portal API."""

from io import StringIO

import pytest
from django.core.management import call_command
from openpyxl import Workbook

from organization_management.apps.core.api.service_employees import (
    EmployeeDirectoryDetail,
)
from organization_management.apps.core.tests.test_core_employees_api import reader
from organization_management.apps.employees.models import Employee
from organization_management.apps.staff_unit.roster_xlsx import HEADERS
from organization_management.apps.staff_unit.tests.test_roster_xlsx import sample

pytestmark = pytest.mark.django_db


def test_portal_reads_imported_employee_with_actual_links(tmp_path):
    book = Workbook()
    book.active.append(list(HEADERS))
    book.active.append(sample())
    path = tmp_path / "acceptance.xlsx"
    book.save(path)
    call_command("import_staffing_xlsx", str(path), apply=True, stdout=StringIO())
    employee = Employee.objects.get(external_id="42")
    api, _ = reader("import-api-reader")
    response = api.get(f"/api/core/employees/{employee.pk}/")
    assert response.status_code == 200
    data = response.json()
    assert data["external_id"] == "42"
    assert data["position_code"] == "P1"
    assert data["rank_code"] == "R1"
    assert data["division"] == employee.staff_unit.division_id
    assert (
        data["birth_date"] is None
        and data["hire_date"] is None
        and data["gender"] is None
    )

    response = api.get(f"/api/core/service-employees/{employee.pk}/")
    assert response.status_code == 200
    assert response.json()["id"] == employee.pk
    assert response.json()["hire_date"] is None


def test_service_employee_detail_schema_allows_unknown_hire_date():
    assert EmployeeDirectoryDetail().fields["hire_date"].allow_null
