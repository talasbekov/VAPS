"""Real personnel report API/export regressions: scope, counts and boundaries."""
import csv
import io
from datetime import date, timedelta

import pytest
from django.contrib.auth.models import User
from django.db import connection
from django.test.utils import CaptureQueriesContext
from django.utils import timezone
from openpyxl import load_workbook
from rest_framework.test import APIClient

from organization_management.apps.dictionaries.models import Position, Rank
from organization_management.apps.divisions.models import Division
from organization_management.apps.employees.models import Employee
from organization_management.apps.operations import clock
from organization_management.apps.operations.models import Permission, Role, RolePermission, StatusType
from organization_management.apps.operations.models_status import OpsEmployeeStatus
from organization_management.apps.operations.services import RoleAdminService
from organization_management.apps.staff_unit.models import StaffUnit

TODAY = date(2026, 10, 8)
BASE = "/api/reports/reports/"
pytestmark = pytest.mark.django_db


def grant(user, code, division=None):
    role, _ = Role.objects.get_or_create(code=f"report-{user.pk}-{code}", defaults={"name": code})
    permission, _ = Permission.objects.get_or_create(code=code, defaults={"name": code})
    RolePermission.objects.get_or_create(role_code=role, permission_code=permission)
    RoleAdminService.assign_role(str(user.pk), role.code, division.pk if division else None, actor="test")


def client_for(*permissions, scope=None):
    user = User.objects.create(username=f"report-user-{User.objects.count()}")
    for code in permissions:
        grant(user, code, scope)
    api = APIClient()
    api.force_authenticate(user)
    return api, user


@pytest.fixture
def report_data():
    dept = Division.objects.create(name="Департамент А", code="REPORT_A", division_type="department")
    child = Division.objects.create(name="Отдел", code="REPORT_A1", parent=dept)
    other = Division.objects.create(name="Департамент Б", code="REPORT_B", division_type="department")
    position = Position.objects.create(name="=Назначенная должность", code="REPORT_POS", level=1, is_active=False)
    rank = Rank.objects.create(name="Звание из архива", code="REPORT_RANK", level=1, is_active=False)
    employee = Employee.objects.create(personnel_number="REPORT-001", external_id="import-person-1", last_name="Иванов", first_name="Иван", rank=rank, birth_date=None, hire_date=None)
    occupied = StaffUnit.objects.create(division=child, position=position, employee=employee, index=1, external_id="import-slot-1")
    empty = StaffUnit.objects.create(division=child, position=None, index=2)
    fired = Employee.objects.create(personnel_number="REPORT-002", last_name="Уволенный", employment_status="fired")
    StaffUnit.objects.create(division=child, employee=fired, index=3)
    outsider = Employee.objects.create(personnel_number="REPORT-003", last_name="Чужой")
    StaffUnit.objects.create(division=other, employee=outsider, index=1)
    for code, name, priority, column in [("IN_SERVICE", "В строю", 999, "IN_SERVICE"), ("VACATION", "Отпуск", 20, "VACATION"), ("DUTY", "Дежурство", 70, "ON_DUTY"), ("REPORT_CUSTOM", "Особое отсутствие", 5, "OTHER")]:
        StatusType.objects.update_or_create(code=code, defaults={"name": name, "priority": priority, "report_column_code": column, "counts_in_staff": True})
    return dict(dept=dept, child=child, other=other, employee=employee, outsider=outsider, occupied=occupied, empty=empty)


def fact(employee, code, start, end, **kwargs):
    return OpsEmployeeStatus.objects.create(employee_id=employee.pk, status_type_code=code, date_start=start, date_end=end, **kwargs)


@pytest.mark.parametrize("action", ["staffing", "absences"])
def test_anonymous_cannot_read_or_export(action, report_data):
    for query in ({}, {"export": "xlsx" if action == "staffing" else "csv"}):
        assert APIClient().get(f"{BASE}{action}/", query).status_code == 401


@pytest.mark.parametrize("action,right", [("staffing", "orgstructure.view"), ("absences", "status.view")])
def test_report_and_feature_rights_are_both_required(action, right, report_data):
    for permissions in [(right,), ("daily_report.generate",)]:
        api, _ = client_for(*permissions, scope=report_data["dept"])
        assert api.get(f"{BASE}{action}/").status_code == 403


def test_staffing_preview_and_full_excel_preserve_assigned_values(report_data):
    api, _ = client_for("daily_report.generate", "orgstructure.view", scope=report_data["dept"])
    response = api.get(f"{BASE}staffing/", {"page_size": 1})
    assert response.status_code == 200
    assert response.data["count"] == 3
    assert response.data["totals"] == {"staff_total": 3, "occupied": 1, "vacancies": 2, "dismissed_in_slot": 1}
    row = response.data["rows"][0]
    assert row["staff_unit_id"] == report_data["occupied"].pk
    assert row["employee_name"] == "Иванов Иван"
    assert row["position"] == "=Назначенная должность"
    assert row["rank"] == "Звание из архива"
    assert row["hire_date"] is None
    assert row["ancestors"] == ["Департамент А"]
    exported = api.get(f"{BASE}staffing/", {"page_size": 1, "export": "xlsx"})
    assert exported.status_code == 200
    workbook = load_workbook(io.BytesIO(exported.content))
    rows = list(workbook.active.values)
    assert len(rows) == 4  # header + all three slots, independent of preview page
    assert "Чужой" not in str(rows)
    assert "Занят уволенным" in str(rows)
    cell = next(cell for row in workbook.active for cell in row if cell.value == "=Назначенная должность")
    assert cell.data_type == "s"  # dictionary text must never become a formula
    assert report_data["employee"].external_id == "import-person-1"


@pytest.mark.parametrize("action,right", [("staffing", "orgstructure.view"), ("absences", "status.view")])
def test_foreign_division_and_invalid_filters_are_explicit(action, right, report_data):
    api, _ = client_for("daily_report.generate", right, scope=report_data["dept"])
    url = f"{BASE}{action}/"
    assert api.get(url, {"division_id": report_data["other"].pk}).status_code == 403
    assert api.get(url, {"division_id": "bad"}).status_code == 400
    assert api.get(url, {"division_id": 9999999}).status_code == 404
    assert api.get(url, {"export": "pdf"}).status_code == 400
    assert api.get(url, {"page": 0}).status_code == 400
    assert api.get(url, {"page": "9999999999999999999999999999"}).status_code == 400


def test_scope_is_intersection_of_report_and_feature_grants(report_data):
    api, user = client_for("daily_report.generate", scope=report_data["child"])
    grant(user, "orgstructure.view", report_data["dept"])
    result = api.get(f"{BASE}staffing/")
    assert result.status_code == 200
    assert [row["id"] for row in result.data["divisions"]] == [report_data["child"].pk]
    assert {row["division_id"] for row in result.data["rows"]} == {report_data["child"].pk}
    assert api.get(f"{BASE}staffing/", {"division_id": report_data["dept"].pk}).status_code == 403


def test_absences_count_winner_person_days_clip_and_cancel(report_data):
    employee = report_data["employee"]
    fact(employee, "VACATION", date(2026, 10, 1), date(2026, 10, 6))
    fact(employee, "REPORT_CUSTOM", date(2026, 10, 3), date(2026, 10, 5))
    fact(employee, "DUTY", date(2026, 10, 6), date(2026, 10, 8))
    fact(employee, "REPORT_CUSTOM", date(2026, 10, 6), date(2026, 10, 7), cancelled_at=timezone.now())
    fact(report_data["outsider"], "VACATION", date(2026, 10, 1), date(2026, 10, 8))
    StatusType.objects.filter(code="REPORT_CUSTOM").update(is_active=False)
    api, _ = client_for("daily_report.generate", "status.view", scope=report_data["dept"])
    query = {"date_from": "2026-10-02", "date_to": "2026-10-07"}
    with clock.override(TODAY):
        response = api.get(f"{BASE}absences/", query)
        exported = api.get(f"{BASE}absences/", {**query, "export": "csv"})
    assert response.status_code == 200
    assert response.data["totals"] == {"person_days": 4, "unique_people": 1}
    assert {row["code"]: (row["person_days"], row["unique_people"]) for row in response.data["rows"]} == {"VACATION": (2, 1), "REPORT_CUSTOM": (2, 1)}
    assert response.data["basis"] == "current_staffing"
    assert response.data["date_to"] == "2026-10-07"
    csv_rows = list(csv.reader(io.StringIO(exported.content.decode("utf-8-sig")), delimiter=";"))
    assert len(csv_rows) == 3
    assert "Особое отсутствие" in str(csv_rows)
    assert "Чужой" not in str(csv_rows)


def test_absences_defaults_to_last_thirty_factual_days(report_data):
    api, _ = client_for("daily_report.generate", "status.view", scope=report_data["dept"])
    with clock.override(TODAY):
        result = api.get(f"{BASE}absences/")
    assert result.status_code == 200
    assert result.data["date_from"] == "2026-09-09"
    assert result.data["date_to"] == "2026-10-08"
    assert result.data["rows"] == []


def test_absences_unique_people_are_not_sum_of_type_counts(report_data):
    employee = report_data["employee"]
    fact(employee, "VACATION", date(2026, 10, 1), date(2026, 10, 3))
    fact(employee, "REPORT_CUSTOM", date(2026, 10, 3), date(2026, 10, 5))
    second = Employee.objects.create(personnel_number="REPORT-004", last_name="Петров")
    StaffUnit.objects.create(division=report_data["child"], employee=second, index=4)
    fact(second, "VACATION", date(2026, 10, 1), date(2026, 10, 2))
    api, _ = client_for("daily_report.generate", "status.view", scope=report_data["dept"])
    with clock.override(TODAY):
        result = api.get(f"{BASE}absences/", {"date_from": "2026-10-01", "date_to": "2026-10-04", "page_size": 1})
        exported = api.get(f"{BASE}absences/", {"date_from": "2026-10-01", "date_to": "2026-10-04", "page_size": 1, "export": "csv"})
    assert result.status_code == 200
    assert result.data["count"] == 2
    assert len(result.data["rows"]) == 1
    assert result.data["totals"] == {"person_days": 5, "unique_people": 2}
    assert len(list(csv.reader(io.StringIO(exported.content.decode("utf-8-sig")), delimiter=";"))) == 3


@pytest.mark.parametrize("code,flags", [("REPORT_PENDING", {"is_placeholder": True}), ("REPORT_OFFLIST", {"counts_in_staff": False})])
def test_placeholder_and_off_list_are_not_staff_absences(code, flags, report_data):
    StatusType.objects.update_or_create(code=code, defaults={"name": "Вне списка / уточняется", "priority": 990, "report_column_code": "REPORT_OTHER", **flags})
    fact(report_data["employee"], code, TODAY - timedelta(days=1), TODAY + timedelta(days=1))
    api, _ = client_for("daily_report.generate", "status.view", scope=report_data["dept"])
    with clock.override(TODAY):
        result = api.get(f"{BASE}absences/")
    assert result.status_code == 200
    assert result.data["totals"] == {"person_days": 0, "unique_people": 0}
    assert result.data["rows"] == []


@pytest.mark.parametrize("query", [
    {"date_from": "bad"}, {"date_from": "2026-10-08", "date_to": "2026-10-01"},
    {"date_to": "2026-10-09"}, {"date_from": "2025-01-01"}, {"date_to": "0001-01-01"},
])
def test_absences_reject_invalid_future_and_unbounded_periods(query, report_data):
    api, _ = client_for("daily_report.generate", "status.view", scope=report_data["dept"])
    with clock.override(TODAY):
        assert api.get(f"{BASE}absences/", query).status_code == 400


def test_absences_queries_do_not_scale_with_days_or_employees(report_data):
    api, _ = client_for("daily_report.generate", "status.view", scope=report_data["dept"])
    fact(report_data["employee"], "VACATION", TODAY - timedelta(days=365), TODAY + timedelta(days=1))
    with clock.override(TODAY):
        api.get(f"{BASE}absences/")  # warm actor/cache initialization
        with CaptureQueriesContext(connection) as short:
            result = api.get(f"{BASE}absences/", {"date_from": TODAY.isoformat()})
        with CaptureQueriesContext(connection) as long:
            full = api.get(f"{BASE}absences/", {"date_from": "2025-10-08"})
    assert result.status_code == full.status_code == 200
    assert full.data["totals"]["person_days"] == 366
    assert len(long) <= len(short) + 1
    assert len(long) < 30
