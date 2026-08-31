"""Штатка и вакансии живут на правах РАЗДЕЛА, а не на кадровых ролях
(Plane №352, Ш-3).

Что было. `common/rbac.py` был вторым каталогом ролей: право он искал в
`common.Role`, а область считал ветками «если ROLE_3 — подняться до
управления, если ROLE_6 — вернуть отдел как есть». Ни одного из этих кодов
среди семи ролей заказчика нет, поэтому его учётки получали либо чужую
область, либо `return False` — «права выданы, а ничего не видно».

Пробы держат четыре конца, каждый из которых мутацией проверяется порознь:
  1) право `orgstructure.manage` открывает правку штатной единицы, а область
     правки — область ГРАНТА этого права;
  2) чужое подразделение закрыто, даже когда право есть;
  3) читающего права (`orgstructure.view`) на правку НЕ хватает — иначе
     «просмотр» открывал бы запись;
  4) кадровая роль с тем же именем права больше не открывает НИЧЕГО: старый
     каталог не читается.
"""
import pytest
from django.contrib.auth import get_user_model

from organization_management.apps.common.rbac import (
    check_permission,
    get_user_scope_queryset,
)
from organization_management.apps.dictionaries.models import Position
from organization_management.apps.divisions.models import Division
from organization_management.apps.operations.models import (
    Permission,
    Role,
    RolePermission,
)
from organization_management.apps.operations.services import RoleAdminService
from organization_management.apps.staff_unit.models import StaffUnit

pytestmark = pytest.mark.django_db


@pytest.fixture
def tree():
    """Департамент с двумя управлениями и штатной единицей в каждом."""
    position = Position.objects.create(name="Инспектор", code="sh3-insp", level=8)
    org = Division.objects.create(
        name="Служба", code="sh3-org",
        division_type=Division.DivisionType.ORGANIZATION,
    )
    department = Division.objects.create(
        name="Департамент", code="sh3-dep",
        division_type=Division.DivisionType.DEPARTMENT, parent=org,
    )
    left = Division.objects.create(
        name="Первое управление", code="sh3-left",
        division_type=Division.DivisionType.DIRECTORATE, parent=department,
    )
    right = Division.objects.create(
        name="Второе управление", code="sh3-right",
        division_type=Division.DivisionType.DIRECTORATE, parent=department,
    )
    units = {
        key: StaffUnit.objects.create(
            division=division, position=position, index=index
        )
        for index, (key, division) in enumerate((("left", left), ("right", right)), 1)
    }
    return {
        "department": department, "left": left, "right": right, "units": units,
    }


def ops_user(username, permissions, scope_division):
    """Учётка с ролью РАЗДЕЛА и областью гранта."""
    user = get_user_model().objects.create_user(username=username)
    role, _ = Role.objects.get_or_create(
        code=f"ROLE-{username}", defaults={"name": username}
    )
    for code in permissions:
        permission, _ = Permission.objects.get_or_create(
            code=code, defaults={"name": code}
        )
        RolePermission.objects.get_or_create(
            role_code=role, permission_code=permission
        )
    RoleAdminService.assign_role(
        str(user.pk),
        role.code,
        None if scope_division is None else scope_division.id,
        actor="test",
    )
    return user


def test_the_section_permission_opens_editing_inside_its_own_scope(tree):
    user = ops_user(
        "sh3-chief", ["orgstructure.manage"], scope_division=tree["left"]
    )

    assert check_permission(user, "edit_staffing_position", tree["units"]["left"])


def test_a_foreign_division_stays_closed_even_with_the_permission(tree):
    """Право есть, область — нет. Ровно это и означает «чьё»."""
    user = ops_user(
        "sh3-neighbour", ["orgstructure.manage"], scope_division=tree["left"]
    )

    assert not check_permission(
        user, "edit_staffing_position", tree["units"]["right"]
    )


def test_a_scope_on_the_department_covers_its_directorates(tree):
    """Грант на департамент накрывает управления под ним.

    Без этого начальник департамента правил бы только строку самого
    департамента, в которой штатных единиц не бывает вовсе.
    """
    user = ops_user(
        "sh3-dep-head", ["orgstructure.manage"], scope_division=tree["department"]
    )

    assert check_permission(user, "edit_staffing_position", tree["units"]["left"])
    assert check_permission(user, "edit_staffing_position", tree["units"]["right"])


def test_reading_permission_is_not_enough_to_write(tree):
    """`orgstructure.view` — просмотр. Если бы его хватало на правку, раздача
    «дать посмотреть штатку» молча выдавала бы право её менять."""
    user = ops_user(
        "sh3-reader", ["orgstructure.view"], scope_division=tree["department"]
    )

    assert check_permission(user, "view_staffing_table")
    assert not check_permission(user, "edit_staffing_position", tree["units"]["left"])
    assert not check_permission(user, "create_vacancy")


def test_the_legacy_role_catalog_is_gone(tree):
    """Старый каталог не «не читается», а НЕ СУЩЕСТВУЕТ (Plane №352, Ш-6).

    До Ш-6 проба заводила `common.Role` с правом `edit_staffing_position` и
    проверяла, что оно ничего не даёт. Модели больше нет — заводить нечего, и
    прежняя проверка стала бы тавтологией. Стережём возврат самих моделей:
    вернуть их — значит вернуть второй каталог прав, ради сноса которого
    делались шесть шагов.
    """
    from django.apps import apps

    for model_name in ("Role", "Permission", "RolePermission", "UserRole"):
        with pytest.raises(LookupError):
            apps.get_model("common", model_name)


def test_an_unknown_permission_name_is_refused(tree):
    """Имени нет в карте — отказ. Иначе опечатка в `permission_map` открывала
    бы действие всем подряд."""
    user = ops_user(
        "sh3-typo", ["orgstructure.manage"], scope_division=tree["department"]
    )

    assert not check_permission(user, "edit_staffing_positon")


def test_the_list_is_narrowed_to_the_scope_of_the_reading_permission(tree):
    """Список и точечная проверка обязаны отвечать одинаково."""
    user = ops_user(
        "sh3-list", ["orgstructure.view"], scope_division=tree["left"]
    )

    visible = get_user_scope_queryset(user, StaffUnit)

    assert [unit.id for unit in visible] == [tree["units"]["left"].id]


def test_a_grant_without_a_scope_covers_the_whole_tree(tree):
    user = ops_user("sh3-global", ["orgstructure.view"], scope_division=None)

    visible = get_user_scope_queryset(user, StaffUnit)

    assert {unit.id for unit in visible} == {
        tree["units"]["left"].id, tree["units"]["right"].id
    }


def test_a_user_without_any_grant_sees_nothing(tree):
    user = get_user_model().objects.create_user(username="sh3-nobody")

    assert not get_user_scope_queryset(user, StaffUnit).exists()
    assert not check_permission(user, "view_staffing_table")
