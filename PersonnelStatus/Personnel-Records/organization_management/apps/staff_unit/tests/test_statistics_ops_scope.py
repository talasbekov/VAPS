"""Статистика штата считается и по области РАЗДЕЛА (Plane №339).

Обход всех 28 ролевых учёток 30.08.2026 показал: `GET /api/staff_unit/
statistics/` отвечал 400 «Не удалось определить область видимости
пользователя» КАЖДОЙ из них — и делал это на ПЯТИ экранах (`/dashboard`,
`/employees` обоих видов, `/statuses`, `/organization`), то есть 140 отказов за
один обход. Экран организации при этом рисовался и про отказ молчал: числа
просто отсутствовали.

Корень тот же, что у №325: кадровый резолвер читает `role_info`, а у ролевой
учётки раздела кадровая роль ROLE_1 и области у неё нет. Решение заказчика по
№325 («роль раздела даёт кадровый доступ») применено здесь последовательно.

Пробы держат три конца: право раздела даёт СВОЮ область (а не всё дерево),
кадровому пользователю ничего не изменилось, и учётка без обоих прав
по-прежнему получает отказ.
"""
from datetime import date

import pytest
from django.contrib.auth import get_user_model
from django.urls import reverse
from rest_framework.test import APIClient

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

URL_NAME = "division-statistics-list"


@pytest.fixture
def tree():
    position = Position.objects.create(name="Инспектор", code="stat-insp", level=8)
    org = Division.objects.create(
        name="Служба", code="stat-org",
        division_type=Division.DivisionType.ORGANIZATION,
    )
    department = Division.objects.create(
        name="Департамент", code="stat-dep",
        division_type=Division.DivisionType.DEPARTMENT, parent=org,
    )
    left = Division.objects.create(
        name="Первое управление", code="stat-left",
        division_type=Division.DivisionType.DIRECTORATE, parent=department,
    )
    right = Division.objects.create(
        name="Второе управление", code="stat-right",
        division_type=Division.DivisionType.DIRECTORATE, parent=org,
    )
    for seq, division in ((1, left), (2, left), (3, right)):
        employee = Employee.objects.create(
            personnel_number=f"stat-{seq:03d}",
            last_name=f"Штатов{seq}", first_name="Имя",
            birth_date=date(1990, 1, 1), hire_date=date(2020, 1, 1),
        )
        StaffUnit.objects.create(
            division=division, position=position, index=seq, employee=employee
        )
    return {"org": org, "department": department, "left": left, "right": right}


def ops_user(username, permissions, scope_division=None):
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


def test_status_view_gives_its_own_scope(tree):
    """Область — та, что дала роль раздела, а не всё дерево."""
    user = ops_user("stat-status", ["status.view"], scope_division=tree["department"])

    response = ask(user)

    assert response.status_code == 200, response.data
    # В департаменте одно управление и двое людей; третий стоит вне его.
    assert response.data["summary"]["staff_units_count"] == 2
    assert response.data["summary"]["employees_count"] == 2


def test_orgstructure_view_opens_it_too(tree):
    """Ручку зовёт и экран организации: требовать от его читателя право на
    СТАТУСЫ значило бы закрыть ему счётчики его же дерева."""
    user = ops_user("stat-org", ["orgstructure.view"], scope_division=tree["org"])

    response = ask(user)

    assert response.status_code == 200, response.data
    assert response.data["summary"]["staff_units_count"] == 3


def test_scope_of_several_subtrees_names_no_single_node(tree):
    """Область из нескольких поддеревьев ОДНИМ узлом не называется.

    Назвать её первым попавшимся подразделением значило бы соврать — тот же
    довод, что у `division` в ручке `directorate` после №304.
    """
    user = ops_user("stat-two", ["status.view"], scope_division=tree["left"])
    RoleAdminService.assign_role(
        str(user.pk), f"ROLE-stat-two", tree["right"].id, actor="test"
    )

    response = ask(user)

    assert response.status_code == 200, response.data
    assert response.data["scope_division"] is None
    assert response.data["summary"]["staff_units_count"] == 3


def test_without_either_permission_it_still_refuses(tree):
    """Расширение не превратилось в «пускать всех»."""
    user = ops_user("stat-none", ["object.view"], scope_division=tree["org"])

    response = ask(user)

    assert response.status_code == 400, response.data


def test_a_personnel_role_gives_no_scope_at_all(tree):
    """Кадровая роль области БОЛЬШЕ НЕ ДАЁТ (Plane №352, Ш-2).

    🔴 ПРЕДМЕТ ПРОБЫ ПЕРЕВЁРНУТ ОСОЗНАННО. Она держала обратное — «кадровому
    пользователю область считает прежний резолвер» — и была права, пока
    резолверов было два. Заказчик потребовал искоренить старое; кадровый путь
    знал наизусть коды ROLE_3/6/7 и не знал ни одной из семи его ролей, то
    есть его учётки получали либо чужую область, либо никакой.

    Конец держать всё равно надо: мутация «вернуть кадровый резолвер первым»
    вернула бы область людям, которым раздел её не давал, и статистика начала
    бы считать чужие подразделения. Проверяется ОТКАЗ, а не ноль: 400 говорит
    «области нет», а нули сказали бы «область есть и она пуста» — это разные
    вещи, и №329 их как раз научился различать.
    """
    # 🔴 КАДРОВУЮ РОЛЬ ЗАВЕСТИ БОЛЬШЕ НЕЧЕМ (Plane №352, Ш-6): её каталог
    # снесён. Раньше проба выдавала `ROLE_7` с областью на департамент и
    # проверяла, что область эта НЕ считается. Теперь у человека просто нет
    # грантов раздела — и это ровно тот случай, ради которого проба и
    # написана: сотрудник есть, подразделение у него есть, а области нет.
    user = get_user_model().objects.create_user(username="stat-legacy")
    employee = Employee.objects.get(personnel_number="stat-001")
    employee.user = user
    employee.save(update_fields=["user"])

    response = ask(user)

    assert response.status_code == 400, response.data
