"""«Обзор» показывает департамент, когда роль об этом просит (Plane №348).

Заказчик описал начальника управления так: «остальные модули на уровне своего
управления ЗА ИСКЛЮЧЕНИЕМ Обзор. Обзор на уровне департамента должно
показываться». Область у портальной роли ОДНА, поэтому исключение названо
признаком роли `overview_at_department`, и читает его РОВНО эта ручка.

Пробы держат три конца:
  1) роль с признаком получает департамент, а не своё управление — это и есть
     требование заказчика;
  2) роль БЕЗ признака получает ровно свою область: признак должен быть
     исключением, а не новым правилом для всех;
  3) статусы у той же учётки остаются на управлении — иначе исполнена вторая
     половина требования была бы ценой первой.
"""
from datetime import date

import pytest
from django.contrib.auth import get_user_model
from django.urls import reverse
from rest_framework.test import APIClient

from organization_management.apps.common.models import (
    Permission,
    Role,
    RolePermission,
    UserRole,
)
from organization_management.apps.dictionaries.models import Position
from organization_management.apps.divisions.models import Division
from organization_management.apps.employees.models import Employee
from organization_management.apps.staff_unit.models import StaffUnit

pytestmark = pytest.mark.django_db


@pytest.fixture
def tree():
    """Департамент с ДВУМЯ управлениями: иначе «департамент» и «управление»
    отличались бы только словом, а не числом штатных единиц."""
    position = Position.objects.create(name="Инспектор", code="ov-insp", level=8)
    org = Division.objects.create(
        name="Служба", code="ov-org",
        division_type=Division.DivisionType.ORGANIZATION,
    )
    department = Division.objects.create(
        name="Первый департамент", code="ov-dep",
        division_type=Division.DivisionType.DEPARTMENT, parent=org,
    )
    left = Division.objects.create(
        name="Первое управление", code="ov-left",
        division_type=Division.DivisionType.DIRECTORATE, parent=department,
    )
    right = Division.objects.create(
        name="Второе управление", code="ov-right",
        division_type=Division.DivisionType.DIRECTORATE, parent=department,
    )
    for seq, division in ((1, left), (2, left), (3, right)):
        employee = Employee.objects.create(
            personnel_number=f"ov-{seq:03d}",
            last_name=f"Сотрудник{seq}",
            first_name="Имя",
            birth_date=date(1990, 1, 1),
            hire_date=date(2020, 1, 1),
        )
        StaffUnit.objects.create(
            division=division, position=position, index=seq, employee=employee
        )
    return {"department": department, "left": left, "right": right}


def head_of(directorate, *, overview_at_department):
    role = Role.objects.create(
        code="HEAD_BASIC" if overview_at_department else "HEAD_PLAIN",
        name="Руководитель",
        requires_scope=True,
        overview_at_department=overview_at_department,
    )
    user = get_user_model().objects.create_user(username=role.code.lower())
    UserRole.objects.create(user=user, role=role, scope_division=directorate)
    return user


def overview(user):
    client = APIClient()
    client.force_authenticate(user=user)
    return client.get(reverse("division-statistics-list"))


def test_the_flagged_role_sees_the_whole_department(tree):
    response = overview(head_of(tree["left"], overview_at_department=True))

    assert response.status_code == 200, response.data
    assert response.data["scope_division"]["name"] == "Первый департамент"
    # Три штатные единицы — обе управления, а не только своё.
    assert response.data["summary"]["staff_units_count"] == 3


def test_without_the_flag_the_scope_is_untouched(tree):
    response = overview(head_of(tree["left"], overview_at_department=False))

    assert response.status_code == 200, response.data
    assert response.data["scope_division"]["name"] == "Первое управление"
    assert response.data["summary"]["staff_units_count"] == 2


def test_the_statuses_screen_stays_on_the_own_directorate(tree):
    """Вторая половина требования заказчика — та, которую легко потерять.

    Обзор поднялся до департамента, а «Статусы сотрудников» обязаны остаться на
    управлении: расширь область самой роли вместо признака — и эта проба
    покраснеет числом 3 вместо 2.
    """
    user = head_of(tree["left"], overview_at_department=True)
    # Ручка статусов закрыта кадровым правом (или правом раздела): без него
    # проба ответила бы 403 и ничего не сказала бы про ОБЛАСТЬ, ради которой
    # написана.
    permission = Permission.objects.create(
        code="view_staffing_table", name="Просмотр штатного расписания",
        category=Permission.Category.STAFFING,
    )
    RolePermission.objects.create(role=user.role_info.role, permission=permission)

    client = APIClient()
    client.force_authenticate(user=user)

    response = client.get(
        reverse("staffunit-directorate-management"),
        {"page": 1, "page_size": 1, "with_summary": "true"},
    )

    assert response.status_code == 200, response.data
    assert response.data["division"]["name"] == "Первое управление"
    assert response.data["summary"]["employees"] == 2
