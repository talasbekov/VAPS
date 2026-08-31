"""«Обзор» шире, чем статусы, — и это выражается ВТОРЫМ ГРАНТОМ (№348 → №352).

Заказчик про начальника управления: «остальные модули на уровне своего
управления ЗА ИСКЛЮЧЕНИЕМ Обзор. Обзор на уровне департамента должно
показываться.»

🔴 КАК ЭТО БЫЛО СДЕЛАНО СНАЧАЛА И ПОЧЕМУ ПЕРЕДЕЛАНО. В №348 у портальной роли
завели признак `overview_at_department`, и ручка статистики поднималась от
области роли к её департаменту. Признак был костылём вокруг того, что у
ПОРТАЛЬНОЙ роли область ОДНА. В №352 портальный путь снят целиком, а у роли
РАЗДЕЛА грантов сколько угодно, и требование заказчика выражается прямо:

    `orgstructure.view` с областью «департамент» + `status.view` с областью
    «управление».

Костыль снят вместе с моделью, которая его носила. Пробы держат тот же смысл,
что и раньше, — только теперь на настоящем механизме:

  1) Обзор показывает департамент — первая половина требования;
  2) статусы остаются на управлении — вторая половина, которую легко потерять,
     расширив область целиком;
  3) без второго гранта Обзор равен области первого — то есть широту даёт
     именно грант, а не какое-нибудь «подняться повыше на всякий случай».
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
    Permission as OpsPermission,
    Role as OpsRole,
    RolePermission as OpsRolePermission,
)
from organization_management.apps.operations.services import RoleAdminService
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


def grant(user, role_code, permissions, scope_division):
    role, _ = OpsRole.objects.get_or_create(
        code=role_code, defaults={"name": role_code}
    )
    for code in permissions:
        permission, _ = OpsPermission.objects.get_or_create(
            code=code, defaults={"name": code}
        )
        OpsRolePermission.objects.get_or_create(
            role_code=role, permission_code=permission
        )
    RoleAdminService.assign_role(
        str(user.pk), role.code, scope_division.id, actor="test"
    )


def head_of(tree, *, overview_at_department):
    """Начальник управления: статусы своего управления, обзор — по решению."""
    user = get_user_model().objects.create_user(
        username=f"head-{'dep' if overview_at_department else 'dir'}"
    )
    grant(user, "OV_DIR_HEAD", ["status.view", "orgstructure.view"], tree["left"])
    if overview_at_department:
        # ВТОРОЙ грант — ровно та строка задания заказчика. Право одно
        # (`orgstructure.view`), область шире; статусы им не расширяются.
        grant(user, "OV_OVERVIEW_DEP", ["orgstructure.view"], tree["department"])
    return user


def overview(user):
    client = APIClient()
    client.force_authenticate(user=user)
    return client.get(reverse("division-statistics-list"))


def test_the_second_grant_widens_the_overview_to_the_department(tree):
    response = overview(head_of(tree, overview_at_department=True))

    assert response.status_code == 200, response.data
    # Три штатные единицы — оба управления, а не только своё.
    assert response.data["summary"]["staff_units_count"] == 3


def test_without_the_second_grant_the_overview_stays_on_the_directorate(tree):
    response = overview(head_of(tree, overview_at_department=False))

    assert response.status_code == 200, response.data
    assert response.data["summary"]["staff_units_count"] == 2
    assert response.data["scope_division"]["name"] == "Первое управление"


def test_the_statuses_screen_stays_on_the_own_directorate(tree):
    """Вторая половина требования — та, которую легко потерять.

    Обзор поднялся до департамента, а «Статусы сотрудников» обязаны остаться
    на управлении: расширь область ПЕРВОГО гранта вместо добавления второго —
    и эта проба покраснеет числом 3 вместо 2.
    """
    user = head_of(tree, overview_at_department=True)
    client = APIClient()
    client.force_authenticate(user=user)

    response = client.get(
        reverse("staffunit-directorate-management"),
        {"page": 1, "page_size": 1, "with_summary": "true"},
    )

    assert response.status_code == 200, response.data
    assert response.data["division"]["name"] == "Первое управление"
    assert response.data["summary"]["employees"] == 2
