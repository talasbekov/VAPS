"""POST /api/operations/statuses/bulk/ — маршрут массового создания статусов.

Вьюха тонкая, поэтому здесь проверяется ровно её зона ответственности:
гейт права, происхождение области видимости (из RBAC, а не из тела запроса),
происхождение актора (из аутентификации), форма 201 и то, что ошибки сервиса
доезжают до клиента конвертом раздела, а не 500-й.
"""
from datetime import date, timedelta

import pytest
from django.contrib.auth.models import User
from rest_framework.test import APIClient

from organization_management.apps.divisions.models import Division
from organization_management.apps.employees.models import Employee
from organization_management.apps.operations import clock
from organization_management.apps.operations.models import (
    Permission,
    Role,
    RolePermission,
    StatusType,
)
from organization_management.apps.operations.models_status import OpsEmployeeStatus
from organization_management.apps.operations.services import RoleAdminService
from organization_management.apps.staff_unit.models import StaffUnit

pytestmark = pytest.mark.django_db

BULK_URL = "/api/operations/statuses/bulk/"
TODAY = date(2026, 8, 4)


def seed_role(code, perms):
    role, _ = Role.objects.get_or_create(code=code, defaults={"name": code})
    for perm in perms:
        permission, _ = Permission.objects.get_or_create(
            code=perm, defaults={"name": perm}
        )
        RolePermission.objects.get_or_create(role_code=role, permission_code=permission)
    return role


def client_for(username, role_code=None, perms=(), scope_division_id=None):
    user = User.objects.create_user(username=username, password="x")
    if role_code is not None:
        seed_role(role_code, perms)
        RoleAdminService.assign_role(
            str(user.pk), role_code, scope_division_id, actor="test"
        )
    api = APIClient()
    api.force_authenticate(user)
    return api, user


@pytest.fixture
def types():
    """Справочник + выводимое «в строю».

    IN_SERVICE — не украшение фикстуры: со схемы снимка 3 билдер отказывается
    собирать день, справочнику которого некуда положить тех, у кого статуса
    нет. Прод заводит этот тип первым (seed_status_types), и фикстура без него
    описывала мир, которого не бывает.
    """
    for code, hard in [("DUTY", False), ("VACATION", True), ("STUDY", False)]:
        StatusType.objects.get_or_create(
            code=code,
            defaults={
                "name": code,
                "priority": 10,
                "report_column_code": "X",
                "is_hard_block": hard,
            },
        )
    StatusType.objects.get_or_create(
        code="IN_SERVICE",
        defaults={
            "name": "В строю",
            "priority": 999,
            "report_column_code": "IN_SERVICE",
        },
    )


@pytest.fixture
def division():
    return Division.objects.create(name="Управление 1")


def make_employee(division=None):
    seq = Employee.objects.count() + 1
    employee = Employee.objects.create(
        first_name="Иван",
        last_name="Иванов",
        personnel_number=f"P{seq:05d}",
        iin=f"{seq:012d}",
        hire_date=date(2020, 1, 1),
    )
    if division is not None:
        StaffUnit.objects.create(division=division, employee=employee, index=seq)
    return employee


def payload(*employees, code="DUTY", start=TODAY, end=TODAY + timedelta(days=2)):
    return {
        "business_date": TODAY.isoformat(),
        "rows": [
            {
                "employee_id": e.id,
                "status_type_code": code,
                "date_start": start.isoformat(),
                "date_end": end.isoformat(),
            }
            for e in employees
        ],
    }


def post(api, body):
    with clock.override(TODAY):
        return api.post(BULK_URL, body, format="json")


# ── Гейт права ───────────────────────────────────────────────────────────

def assert_denied_by_gate(response):
    """403 именно ГЕЙТА права, а не построчной области видимости.

    Оба отказа — 403, и без различения тест гейта зеленел бы от отказа
    сервиса по scope. Различает форма: гейт поднимает PermissionDenied DRF
    (обработчик раздела чужие исключения не переформатирует → ключ detail),
    сервис поднимает DomainError → конверт с error_code.
    """
    assert response.status_code == 403
    assert response.data["detail"] == "PERMISSION_DENIED"
    assert "error_code" not in response.data


def test_anonymous_403(types, division):
    employee = make_employee(division)
    response = post(APIClient(), payload(employee))
    assert_denied_by_gate(response)
    assert OpsEmployeeStatus.objects.count() == 0


def test_without_status_manage_403(types, division):
    # У роли есть ЧТЕНИЕ статусов, но не запись — сосед по префиксу не должен
    # открывать пачку.
    api, _ = client_for("viewer", "VIEWER", ["status.view"])
    employee = make_employee(division)
    response = post(api, payload(employee))
    assert_denied_by_gate(response)
    assert OpsEmployeeStatus.objects.count() == 0


def test_get_is_not_served(types, division):
    api, _ = client_for("op-get", "ADMIN", ["*"])
    # Поверхность только POST: чтение статусов этим срезом не открыто, и
    # промах метода обязан быть 405, а не дезориентирующим 403.
    assert api.get(BULK_URL).status_code == 405


# ── Успешный путь и происхождение области ────────────────────────────────

def test_scoped_operator_creates_rows(types, division):
    api, user = client_for(
        "op", "DIVISION_OPERATOR", ["status.manage"], scope_division_id=division.id
    )
    employees = [make_employee(division) for _ in range(2)]
    response = post(api, payload(*employees))
    assert response.status_code == 201
    assert response.data == {"created": 2}
    assert OpsEmployeeStatus.objects.count() == 2
    # Актор — из аутентификации: в теле запроса его нет вообще.
    assert {s.created_by for s in OpsEmployeeStatus.objects.all()} == {str(user.pk)}


def test_wildcard_actor_gets_all_divisions(types, division):
    # Безскоуповый грант резолвится в МНОЖЕСТВО всех подразделений: None
    # уронил бы сервис TypeError'ом на `divisions.get(eid) not in allowed`.
    api, _ = client_for("root", "ADMIN", ["*"])
    other = Division.objects.create(name="Управление 2")
    employees = [make_employee(division), make_employee(other)]
    response = post(api, payload(*employees))
    assert response.status_code == 201
    assert response.data["created"] == 2


def test_scope_comes_from_rbac_not_body(types, division):
    # Область оператора — только своё подразделение; сотрудник соседнего
    # закрыт, даже если клиент попробует расширить её через тело запроса.
    api, _ = client_for(
        "op-scoped",
        "DIVISION_OPERATOR",
        ["status.manage"],
        scope_division_id=division.id,
    )
    other = Division.objects.create(name="Управление 2")
    foreign = make_employee(other)
    body = payload(foreign)
    body["allowed_division_ids"] = [other.id]
    body["division_id"] = other.id
    response = post(api, body)
    assert response.status_code == 403
    assert response.data["error_code"] == "PERMISSION_DENIED"
    assert OpsEmployeeStatus.objects.count() == 0


def test_subtree_of_scope_is_visible(types, division):
    # Область — ПОДДЕРЕВО гранта: сотрудник дочернего подразделения доступен.
    child = Division.objects.create(name="Отдел 1", parent=division)
    api, _ = client_for(
        "op-tree",
        "DIVISION_OPERATOR",
        ["status.manage"],
        scope_division_id=division.id,
    )
    response = post(api, payload(make_employee(child)))
    assert response.status_code == 201


# ── Валидация тела запроса (400 ДО сервиса) ──────────────────────────────

def test_missing_row_key_400(types, division):
    api, _ = client_for("op-400", "ADMIN", ["*"])
    body = payload(make_employee(division))
    del body["rows"][0]["date_end"]
    response = post(api, body)
    assert response.status_code == 400
    assert OpsEmployeeStatus.objects.count() == 0


def test_empty_rows_400(types, division):
    api, _ = client_for("op-empty", "ADMIN", ["*"])
    response = post(api, {"business_date": TODAY.isoformat(), "rows": []})
    assert response.status_code == 400


def test_missing_business_date_400(types, division):
    api, _ = client_for("op-nodate", "ADMIN", ["*"])
    body = payload(make_employee(division))
    del body["business_date"]
    response = post(api, body)
    assert response.status_code == 400
    assert OpsEmployeeStatus.objects.count() == 0


def test_rows_cap_400(types, division):
    api, _ = client_for("op-cap", "ADMIN", ["*"])
    employee = make_employee(division)
    body = payload(employee)
    body["rows"] = body["rows"] * 1001
    response = post(api, body)
    assert response.status_code == 400
    assert OpsEmployeeStatus.objects.count() == 0


# ── Ошибки сервиса доезжают конвертом ────────────────────────────────────

def test_hard_conflict_422_envelope(types, division):
    api, _ = client_for("op-hard", "ADMIN", ["*"])
    employee = make_employee(division)
    OpsEmployeeStatus.objects.create(
        employee_id=employee.id,
        status_type_code="VACATION",
        date_start=TODAY,
        date_end=TODAY + timedelta(days=5),
    )
    response = post(api, payload(employee, code="VACATION"))
    assert response.status_code == 422
    assert response.data["error_code"] == "OVERLAPPING_HARD_STATUS"
    assert response.data["details"]["rows"][0]["code"] == "OVERLAPPING_HARD_STATUS"


def test_soft_conflict_409_is_not_advertised_overridable(types, division):
    api, _ = client_for("op-soft", "ADMIN", ["*"])
    employee = make_employee(division)
    OpsEmployeeStatus.objects.create(
        employee_id=employee.id,
        status_type_code="STUDY",
        date_start=TODAY,
        date_end=TODAY + timedelta(days=5),
    )
    response = post(api, payload(employee))
    assert response.status_code == 409
    assert response.data["error_code"] == "STATUS_OVERLAP_WARNING"
    # Строка пачки помечена обходимой в detail.rows[], но САМ конверт — нет:
    # у массового пути обхода не существует (override в него не портирован),
    # и предлагать клиенту кнопку «всё равно сохранить» было бы враньём.
    # Оператор разводит такие строки поштучно через одиночный create_status.
    assert "overridable" not in response.data
    assert response.data["details"]["rows"][0]["code"] == "STATUS_OVERLAP_WARNING"
    assert OpsEmployeeStatus.objects.count() == 1


def test_unknown_employee_404_envelope(types, division):
    api, _ = client_for("op-404", "ADMIN", ["*"])
    body = payload(make_employee(division))
    body["rows"][0]["employee_id"] = 999999
    response = post(api, body)
    assert response.status_code == 404
    assert response.data["error_code"] == "ENTITY_NOT_FOUND"
