"""`FORCES_GATHERING_OFFICER` и `status.manage` со scope департамента (Plane
№991, задача заказчика — основная проходка ежедневного расхода).

Право у роли проверяет `test_seed_operations.py` (пин держателей записи);
здесь — поведение РЕАЛЬНОЙ раскладки на живой ручке: сеется настоящий сид
(`seed_operations`), а не рукописный набор прав, чтобы проба ловила разъезд
сида и ручки, а не только своей же фикстуры. Своя область — 201, чужой
департамент — 403 области (не гейта права): именно это назвала задача
«сервер отбивает соседний департамент».
"""
from datetime import date

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

ROLE = "FORCES_GATHERING_OFFICER"


@pytest.fixture
def seeded():
    call_command("seed_operations")


@pytest.fixture
def departments():
    own = Division.objects.create(
        name="Департамент А", division_type=Division.DivisionType.DEPARTMENT
    )
    other = Division.objects.create(
        name="Департамент Б", division_type=Division.DivisionType.DEPARTMENT
    )
    return own, other


def make_employee(division):
    seq = Employee.objects.count() + 1
    employee = Employee.objects.create(
        first_name="Иван",
        last_name="Иванов",
        personnel_number=f"P{seq:05d}",
        iin=f"{seq:012d}",
        hire_date=date(2020, 1, 1),
    )
    StaffUnit.objects.create(division=division, employee=employee, index=seq)
    return employee


def client_scoped_to(division_id):
    user = User.objects.create_user(username=f"fgo-{division_id}", password="x")
    RoleAdminService.assign_role(str(user.pk), ROLE, division_id, actor="test")
    api = APIClient()
    api.force_authenticate(user)
    return api


def post(api, body):
    with clock.override(TODAY):
        return api.post(BULK_URL, body, format="json")


def test_own_department_status_manage_succeeds(seeded, types, departments):
    own, _ = departments
    api = client_scoped_to(own.id)
    employee = make_employee(own)
    response = post(api, payload(employee))
    assert response.status_code == 201, response.data
    assert OpsEmployeeStatus.objects.filter(employee_id=employee.id).exists()


def test_foreign_department_status_manage_403_by_scope(seeded, types, departments):
    own, other = departments
    api = client_scoped_to(own.id)
    foreign = make_employee(other)
    response = post(api, payload(foreign))
    assert response.status_code == 403
    assert response.data["error_code"] == "PERMISSION_DENIED"
    assert not OpsEmployeeStatus.objects.filter(employee_id=foreign.id).exists()


def test_seed_role_accounts_assigns_department_not_wildcard(seeded, departments):
    """Демо-учётка роли получает scope департамента, а не всю организацию.

    Прежде роли не было в `SCOPED_ROLES`: `seed_role_accounts` выдавал ей
    безскоуповый грант. RED-путь этого теста — легаси-строка ИМЕННО с таким
    грантом, заведённая ДО правки (так на уже прогнанном стенде и было);
    команда обязана снять её и оставить ровно одну активную — со scope.
    """
    from organization_management.apps.operations.management.commands import (
        seed_role_accounts as cmd_module,
    )
    from organization_management.apps.operations.models import Role as OpsRole
    from organization_management.apps.operations.models import UserRole

    role = OpsRole.objects.get(code=ROLE)
    username = f"{cmd_module.USERNAME_PREFIX}{role.code.lower()}"
    user = User.objects.create_user(username=username)
    RoleAdminService.assign_role(str(user.pk), ROLE, None, actor="legacy")

    call_command("seed_role_accounts", password="x")

    active = UserRole.objects.filter(
        user_id=str(user.pk), role_code_id=ROLE, is_active=True
    )
    assert active.count() == 1, "должна остаться РОВНО одна активная строка"
    scope = active.get().scope_division_id
    assert scope is not None, "безскоуповый (org-wide) грант не должен уцелеть"
    assert (
        Division.objects.get(pk=scope).division_type
        == Division.DivisionType.DEPARTMENT
    )
