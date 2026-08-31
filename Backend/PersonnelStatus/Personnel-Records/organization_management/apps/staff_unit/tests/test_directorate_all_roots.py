"""Суперпользователь видит ВСЕ деревья оргструктуры, а не первое (Plane №304).

Дефект нашёлся как расхождение двух чисел на одном экране: шапка `/statuses`
показывала «Всего сотрудников 436», сводка календаря — 440. Разными оказались
не подсчёты, а ОБЛАСТИ: `_get_user_own_division` отдавала суперпользователю
`Division.objects.filter(level=0).first()`, и слово «first» решало судьбу целой
ветки — корней в базе несколько, а видел он один. Четверо из второго корня не
показывались в таблице штатки ВОВСЕ, и никакая подпись этого не объясняла.

Проба держит три следствия:
  1) состав считается по всем корням (мутация «вернуть `.first()`» — красная);
  2) строки второго корня действительно приходят в ответе, а не только в счёте;
  3) поле `division` при нескольких корнях — `null`: одного подразделения,
     описывающего такую область, не существует, а прежний ответ утверждал, что
     это первый корень, и диалог статусов писал его в `related_division`.

Обычному пользователю область НЕ расширена — это стережёт четвёртая проба:
иначе «показать всё» прошло бы первые три и тихо сняло бы разграничение.
"""
from datetime import date

import pytest
from django.contrib.auth import get_user_model
from django.urls import reverse
from rest_framework.test import APIClient

from organization_management.apps.dictionaries.models import Position
from organization_management.apps.divisions.models import Division
from organization_management.apps.employees.models import Employee
from organization_management.apps.staff_unit.models import StaffUnit

pytestmark = pytest.mark.django_db

URL_NAME = "staffunit-directorate-management"


def person(seq, division, position):
    employee = Employee.objects.create(
        personnel_number=f"roots-{seq:03d}",
        last_name=f"Корневой{seq:02d}",
        first_name="Имя",
        birth_date=date(1990, 1, 1),
        hire_date=date(2020, 1, 1),
    )
    StaffUnit.objects.create(
        division=division, position=position, index=seq, employee=employee
    )
    return employee


@pytest.fixture
def two_trees():
    """ДВА корня, как на стенде: «Служба» и отдельное «Управление (стенд)».

    Второе дерево маленькое намеренно: разница в счёте (4 из 440 на стенде)
    должна быть заметной для ассерта и незаметной для глаза — именно поэтому
    дефект и прожил незамеченным.
    """
    position = Position.objects.create(name="Инспектор", code="roots-insp", level=8)
    main = Division.objects.create(
        name="Служба", code="roots-main",
        division_type=Division.DivisionType.ORGANIZATION,
    )
    branch = Division.objects.create(
        name="Первый отдел", code="roots-branch",
        division_type=Division.DivisionType.DIVISION, parent=main,
    )
    aside = Division.objects.create(
        name="Управление (стенд)", code="roots-aside",
        division_type=Division.DivisionType.ORGANIZATION,
    )
    return {
        "main": main,
        "branch": branch,
        "aside": aside,
        "in_main": [person(seq, branch, position) for seq in range(1, 6)],
        "in_aside": [person(seq, aside, position) for seq in range(6, 8)],
        "position": position,
    }


def ask(user, query=""):
    client = APIClient()
    client.force_authenticate(user=user)
    response = client.get(reverse(URL_NAME) + query)
    assert response.status_code == 200, response.data
    return response.data


@pytest.fixture
def admin():
    return get_user_model().objects.create_superuser(username="roots-admin")


def test_superuser_counts_every_tree(admin, two_trees):
    payload = ask(admin, "?with_summary=1")

    assert payload["summary"]["employees"] == 7, (
        "состав посчитан по одному корню: пятеро из «Службы» есть, двоих из "
        "второго дерева ручка не видит"
    )
    assert payload["matched_count"] == 7


def test_rows_of_the_second_tree_are_returned(admin, two_trees):
    payload = ask(admin)

    names = {
        unit["division"]["name"] for unit in payload["staff_units"] if unit["division"]
    }
    assert "Управление (стенд)" in names, "строки второго корня в ответ не попали"


def test_division_is_null_when_the_scope_spans_several_trees(admin, two_trees):
    payload = ask(admin)

    assert payload["division"] is None, (
        "ответ называет одним подразделением область, охватывающую несколько "
        "деревьев — именно так первый корень попадал в related_division"
    )


def test_division_is_the_root_when_there_is_only_one(admin, two_trees):
    """Один корень — поле осталось прежним: `null` не подменяет собой ответ."""
    Division.objects.filter(pk=two_trees["aside"].pk).delete()

    payload = ask(admin)

    assert payload["division"] is not None
    assert payload["division"]["name"] == "Служба"


def _grant_section_role(user, scope_division_id):
    """Роль РАЗДЕЛА с правом чтения статусов и областью одного подразделения.

    Ручку стережёт право `status.view`: без него проба отвечала бы 403, то есть
    молчала бы о том, что должна проверять.
    """
    from organization_management.apps.operations.models import (
        Permission as OpsPermission,
        Role as OpsRole,
        RolePermission as OpsRolePermission,
    )
    from organization_management.apps.operations.services import RoleAdminService

    role, _ = OpsRole.objects.get_or_create(
        code=f"ROOTS-{user.username}", defaults={"name": user.username}
    )
    permission, _ = OpsPermission.objects.get_or_create(
        code="status.view", defaults={"name": "Просмотр статусов"}
    )
    OpsRolePermission.objects.get_or_create(role_code=role, permission_code=permission)
    RoleAdminService.assign_role(
        str(user.pk), role.code, scope_division_id, actor="test"
    )


def test_ordinary_user_still_sees_only_his_own_subtree(two_trees):
    """Разграничение НЕ снято: расширение касается только суперпользователя.

    🔴 ПЕРЕПИСАНО В Plane №352 (Ш-2), и предмет пробы при этом НЕ подменён.
    Раньше область обычного пользователя считал кадровый резолвер по коду роли
    (ROLE_6 → «свой отдел»). Кадровый путь снят целиком: заказчик потребовал
    работать по семи своим ролям, а они живут в каталоге раздела. Теперь
    ограничение выражается ОБЛАСТЬЮ ГРАНТА — и проба держит ровно тот же
    конец: человек, которому выдали право на своё подразделение, чужого не
    видит. Мутация «отдать грант без области» (в разделе это значит «без
    ограничения») красит её немедленно.
    """
    user = get_user_model().objects.create_user(username="roots-plain")
    employee = two_trees["in_main"][0]
    employee.user = user
    employee.save(update_fields=["user"])

    _grant_section_role(user, employee.staff_unit.division_id)

    payload = ask(user)

    names = {
        unit["division"]["name"] for unit in payload["staff_units"] if unit["division"]
    }
    assert names == {"Первый отдел"}, f"обычный пользователь видит лишнее: {names}"
