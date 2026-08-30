"""Роль РАЗДЕЛА открывает кадровые экраны расхода (Plane №325).

Что было. Ручка `staff-units/directorate/` — единственный источник экранов
«Ежедневный расход» и «Управление статусами» — пускала только кадровые роли
ROLE_3/6/7. Из 38 учёток стенда цикл проходили ЧЕТЫРЕ; не проходила ни одна
роль раздела ОМ, включая `role_department_expense_officer` («ответственный за
расход департамента») и `role_division_operator`, который по замыслу и
проставляет статусы. Два каталога ролей — кадровый (`common.UserRole`) и
раздела (`operations.UserRole`) — не связаны, и цикл жил целиком в первом.

Решение заказчика 30.08.2026: роль раздела ДАЁТ кадровый доступ. Отвергнуты
«выдавать кадровую роль при заведении учётки» и «снять роли раздела с этого
пути».

Пробы держат три конца:
  1) право раздела `status.view` открывает ручку — и открывает ОБЛАСТЬ этого
     права, а не личную комнату сотрудника;
  2) без `status.view` по-прежнему 403 — расширение не превратилось в «пускать
     всех»;
  3) кадровому ROLE_6 ничего не изменилось: его область считает прежний
     резолвер, а не резолвер раздела.
"""
from datetime import date

import pytest
from django.contrib.auth import get_user_model
from django.urls import reverse
from rest_framework.test import APIClient

from organization_management.apps.common.models import (
    Permission as LegacyPermission,
    Role as LegacyRole,
    RolePermission as LegacyRolePermission,
    UserRole as LegacyUserRole,
)
from organization_management.apps.dictionaries.models import Position
from organization_management.apps.divisions.models import Division
from organization_management.apps.employees.models import Employee
from organization_management.apps.operations.models import (
    Permission,
    Role,
    RolePermission,
)
from organization_management.apps.operations.services import RoleAdminService
from organization_management.apps.staff_unit.models import StaffUnit

pytestmark = pytest.mark.django_db

URL_NAME = "staffunit-directorate-management"


@pytest.fixture
def tree():
    """Организация → департамент → управление, с людьми в каждом управлении.

    Два управления нужны затем, чтобы «область департамента» отличалась от
    «области одного управления» видимым числом, а не только формально.
    """
    position = Position.objects.create(name="Инспектор", code="ops-insp", level=8)
    org = Division.objects.create(
        name="Служба", code="ops-org",
        division_type=Division.DivisionType.ORGANIZATION,
    )
    department = Division.objects.create(
        name="Департамент", code="ops-dep",
        division_type=Division.DivisionType.DEPARTMENT, parent=org,
    )
    left = Division.objects.create(
        name="Первое управление", code="ops-left",
        division_type=Division.DivisionType.DIRECTORATE, parent=department,
    )
    right = Division.objects.create(
        name="Второе управление", code="ops-right",
        division_type=Division.DivisionType.DIRECTORATE, parent=department,
    )
    for seq, division in ((1, left), (2, left), (3, right)):
        employee = Employee.objects.create(
            personnel_number=f"ops-{seq:03d}",
            last_name=f"Сотрудник{seq}",
            first_name="Имя",
            birth_date=date(1990, 1, 1),
            hire_date=date(2020, 1, 1),
        )
        StaffUnit.objects.create(
            division=division, position=position, index=seq, employee=employee
        )
    return {"org": org, "department": department, "left": left, "right": right}


def ops_user(username, permissions, scope_division=None):
    """Учётка с ролью РАЗДЕЛА и без кадровой роли ROLE_3/6/7.

    Кадровой роли нет вовсе — ровно как у стендовых `role_*`, где она ROLE_1
    «Просмотр организации» и к расходу отношения не имеет.
    """
    user = get_user_model().objects.create_user(username=username)
    role, _ = Role.objects.get_or_create(code=f"ROLE-{username}", defaults={"name": username})
    for code in permissions:
        permission, _ = Permission.objects.get_or_create(code=code, defaults={"name": code})
        RolePermission.objects.get_or_create(role_code=role, permission_code=permission)
    RoleAdminService.assign_role(
        str(user.pk),
        role.code,
        None if scope_division is None else scope_division.id,
        actor="test",
    )
    return user


def ask(user):
    client = APIClient()
    client.force_authenticate(user=user)
    return client.get(reverse(URL_NAME))


def division_names(payload):
    return {
        unit["division"]["name"]
        for unit in payload["staff_units"]
        if unit["division"]
    }


def test_ops_permission_opens_the_handle_within_its_own_scope(tree):
    user = ops_user("ops-dep-officer", ["status.view"], scope_division=tree["left"])

    response = ask(user)

    assert response.status_code == 200, response.data
    assert division_names(response.data) == {"Первое управление"}, (
        "область взята не у роли раздела: учётка видит чужие управления"
    )


def test_scope_of_a_department_covers_its_directorates(tree):
    """Область на департамент накрывает управления под ним, а не только его сам.

    Без этого «ответственный за расход департамента» открыл бы экран и увидел
    одну строку самого департамента — то есть пустой расход.
    """
    user = ops_user("ops-whole-dep", ["status.view"], scope_division=tree["department"])

    response = ask(user)

    assert response.status_code == 200, response.data
    assert division_names(response.data) == {"Первое управление", "Второе управление"}


def test_permission_without_scope_covers_the_whole_tree(tree):
    user = ops_user("ops-global", ["status.view"], scope_division=None)

    response = ask(user)

    assert response.status_code == 200, response.data
    assert division_names(response.data) == {"Первое управление", "Второе управление"}


def test_a_section_role_without_status_view_is_still_refused(tree):
    """Расширение не превратилось в «пускать всех»: чужое право не открывает."""
    user = ops_user("ops-reader", ["object.view"], scope_division=tree["department"])

    response = ask(user)

    assert response.status_code == 403, response.data


def test_no_role_at_all_is_still_refused(tree):
    user = get_user_model().objects.create_user(username="ops-nobody")

    response = ask(user)

    assert response.status_code == 403, response.data


def test_a_personnel_role_keeps_its_own_resolver(tree):
    """ROLE_6 считает область прежним кадровым путём, а не путём раздела.

    Мутация «пускать всех через резолвер раздела» прошла бы пробы выше и тихо
    сменила бы область кадровым начальникам — этот конец и держит проба.
    """
    user = get_user_model().objects.create_user(username="ops-legacy-chief")
    role = LegacyRole.objects.create(code="ROLE_6", name="Начальник отдела")
    permission = LegacyPermission.objects.create(
        code="view_staffing_table", name="Просмотр штатного расписания"
    )
    LegacyRolePermission.objects.create(role=role, permission=permission)
    employee = Employee.objects.get(personnel_number="ops-003")
    employee.user = user
    employee.save(update_fields=["user"])
    LegacyUserRole.objects.create(user=user, role=role)

    response = ask(user)

    assert response.status_code == 200, response.data
    assert division_names(response.data) == {"Второе управление"}, (
        "область кадрового начальника поехала: её посчитал резолвер раздела"
    )
