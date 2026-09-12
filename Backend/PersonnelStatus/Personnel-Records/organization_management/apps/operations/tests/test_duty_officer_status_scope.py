"""`DUTY_OFFICER` и `status.manage_root` — статусы ТОЛЬКО «Руководству Службы»
(Plane №1223, решение заказчика 12.09.2026, RAW/README §23 `[РАСХ-РШ-07]`).

Право у роли проверяет `test_seed_operations.py` (пин держателей); здесь —
поведение РЕАЛЬНОЙ раскладки на живых ручках: сеется настоящий сид
(`seed_operations`), дежурный получает роль без области (как на стенде и у
`o_sagynbek`), и:
  • сотрудник, прикреплённый к корню организации напрямую, — 201/200;
  • сотрудник внутри департамента — 403 ОБЛАСТИ (`PERMISSION_DENIED`), не
    гейта: право у роли есть, а область — ровно корень.
Область считается тем же множеством `division_id`, что и у `status.manage`:
корень попадает в разрешённые, а сотрудники департаментов носят `division_id`
своего департамента — дерево не обходится, особых случаев нет.
"""
from datetime import date, timedelta

import pytest
from django.contrib.auth.models import User
from django.core.management import call_command
from rest_framework.test import APIClient

from organization_management.apps.divisions.models import Division
from organization_management.apps.employees.models import Employee
from organization_management.apps.operations import clock
from organization_management.apps.operations.models_status import OpsEmployeeStatus
from organization_management.apps.operations.services import RoleAdminService
from organization_management.apps.operations.tests.test_bulk_status_api import (
    BULK_URL,
    TODAY,
    payload,
    types,  # noqa: F401 — фикстура pytest
)
from organization_management.apps.staff_unit.models import StaffUnit

pytestmark = pytest.mark.django_db

ROLE = "DUTY_OFFICER"
STATUSES_URL = "/api/operations/statuses/"


@pytest.fixture
def seeded():
    call_command("seed_operations")


@pytest.fixture
def org():
    root = Division.objects.create(
        name="Служба", division_type=Division.DivisionType.ORGANIZATION
    )
    department = Division.objects.create(
        name="Департамент А", division_type=Division.DivisionType.DEPARTMENT, parent=root
    )
    directorate = Division.objects.create(
        name="Управление А1", division_type=Division.DivisionType.DIRECTORATE, parent=department
    )
    return root, department, directorate


def make_employee(division):
    seq = Employee.objects.count() + 1
    employee = Employee.objects.create(
        first_name="Пётр",
        last_name="Петров",
        personnel_number=f"D{seq:05d}",
        iin=f"{seq:012d}",
        hire_date=date(2020, 1, 1),
    )
    StaffUnit.objects.create(division=division, employee=employee, index=seq)
    return employee


def duty_client():
    user = User.objects.create_user(username="duty-officer-root", password="x")
    RoleAdminService.assign_role(str(user.pk), ROLE, None, actor="test")
    api = APIClient()
    api.force_authenticate(user)
    return api


def post(api, url, body):
    with clock.override(TODAY):
        return api.post(url, body, format="json")


def test_bulk_for_the_service_leadership_succeeds(seeded, types, org):
    root, _, _ = org
    api = duty_client()
    employee = make_employee(root)
    response = post(api, BULK_URL, payload(employee))
    assert response.status_code == 201, response.data
    assert OpsEmployeeStatus.objects.filter(employee_id=employee.id).exists()


def test_bulk_for_a_department_employee_is_403_by_scope(seeded, types, org):
    _, department, _ = org
    api = duty_client()
    employee = make_employee(department)
    response = post(api, BULK_URL, payload(employee))
    assert response.status_code == 403
    assert response.data["error_code"] == "PERMISSION_DENIED"
    assert not OpsEmployeeStatus.objects.filter(employee_id=employee.id).exists()


def test_bulk_for_a_directorate_employee_is_403_by_scope(seeded, types, org):
    _, _, directorate = org
    api = duty_client()
    employee = make_employee(directorate)
    response = post(api, BULK_URL, payload(employee))
    assert response.status_code == 403
    assert response.data["error_code"] == "PERMISSION_DENIED"


def test_create_for_the_service_leadership_succeeds(seeded, types, org):
    root, _, _ = org
    api = duty_client()
    employee = make_employee(root)
    body = {
        "employee_id": employee.id,
        "status_type_code": "DUTY",
        "date_start": (TODAY + timedelta(days=1)).isoformat(),
        "date_end": (TODAY + timedelta(days=2)).isoformat(),
    }
    response = post(api, STATUSES_URL, body)
    assert response.status_code == 201, response.data


def test_create_for_a_department_employee_is_403_by_scope(seeded, types, org):
    _, department, _ = org
    api = duty_client()
    employee = make_employee(department)
    body = {
        "employee_id": employee.id,
        "status_type_code": "DUTY",
        "date_start": (TODAY + timedelta(days=1)).isoformat(),
        "date_end": (TODAY + timedelta(days=2)).isoformat(),
    }
    response = post(api, STATUSES_URL, body)
    assert response.status_code == 403
    assert response.data["error_code"] == "PERMISSION_DENIED"


def test_a_mixed_bulk_is_refused_whole(seeded, types, org):
    """Пачка «руководство + департамент» не проходит наполовину: сервис
    проверяет построчно и отказывает целиком, как и для любой области."""
    root, department, _ = org
    api = duty_client()
    leader = make_employee(root)
    inner = make_employee(department)
    response = post(api, BULK_URL, payload(leader, inner))
    assert response.status_code == 403
    assert response.data["details"]["employee_ids"] == [str(inner.id)]
    assert not OpsEmployeeStatus.objects.filter(employee_id=leader.id).exists()


def test_the_root_is_the_organization_not_any_parentless_division(seeded, types, org):
    """Корень — подразделение типа «организация» без родителя, а не «первое
    без родителя»: тестовые деревья заводят департаменты без родителя, и
    выбор «любого корневого» открыл бы дежурному чужой департамент."""
    root, _, _ = org
    stray = Division.objects.create(
        name="Департамент без родителя", division_type=Division.DivisionType.DEPARTMENT
    )
    api = duty_client()
    employee = make_employee(stray)
    response = post(api, BULK_URL, payload(employee))
    assert response.status_code == 403
    assert response.data["error_code"] == "PERMISSION_DENIED"
