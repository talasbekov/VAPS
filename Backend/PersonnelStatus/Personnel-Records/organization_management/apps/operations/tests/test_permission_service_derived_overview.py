"""Обзор по департаменту производится из роли начальника управления (Plane №1201).

Заказчик завёл учётки в закрытой сети руками — по одной роли на человека —
и «Обзор» начальника управления схлопнулся до управления: второй грант
`OVERVIEW_DEPARTMENT` руками не воспроизводится. Договор теперь такой: грант
роли из `PermissionService.OVERVIEW_AT_DEPARTMENT_ROLES` на управление (или
отдел) сам порождает грант `OVERVIEW_DEPARTMENT` на ближайший департамент.
Порождается именно РОЛЬ-ДОБАВКА, а не расширение области профиля: у неё одно
право (`orgstructure.view`), и статусы на департамент не уезжают.
"""
import pytest
from django.contrib.auth import get_user_model

from organization_management.apps.divisions.models import Division
from organization_management.apps.operations.models import (
    Permission,
    Role,
    RolePermission,
)
from organization_management.apps.operations.services import (
    PermissionService,
    RoleAdminService,
)

pytestmark = pytest.mark.django_db


@pytest.fixture
def tree():
    org = Division.objects.create(
        name="Служба", code="dv-org", division_type=Division.DivisionType.ORGANIZATION
    )
    department = Division.objects.create(
        name="Первый департамент", code="dv-dep",
        division_type=Division.DivisionType.DEPARTMENT, parent=org,
    )
    directorate = Division.objects.create(
        name="Первое управление", code="dv-dir",
        division_type=Division.DivisionType.DIRECTORATE, parent=department,
    )
    unit = Division.objects.create(
        name="Первый отдел", code="dv-unit",
        division_type=Division.DivisionType.DIVISION, parent=directorate,
    )
    other = Division.objects.create(
        name="Второе управление", code="dv-other",
        division_type=Division.DivisionType.DIRECTORATE, parent=department,
    )
    return {
        "org": org, "department": department, "directorate": directorate,
        "unit": unit, "other": other,
    }


def _role(code, permissions):
    role, _ = Role.objects.get_or_create(code=code, defaults={"name": code})
    for perm_code in permissions:
        permission, _ = Permission.objects.get_or_create(
            code=perm_code, defaults={"name": perm_code}
        )
        RolePermission.objects.get_or_create(role_code=role, permission_code=permission)
    return role


@pytest.fixture
def catalogue():
    _role("HEAD_DIRECTORATE_LINE", ["status.view", "status.manage", "orgstructure.view"])
    _role("HEAD_OPS_UNIT", ["status.view", "status.manage", "orgstructure.view"])
    _role("OVERVIEW_DEPARTMENT", ["orgstructure.view"])
    _role("EMPLOYEE", ["status.view"])


def _user(name):
    user = get_user_model().objects.create_user(username=name)
    return str(user.pk)


@pytest.mark.parametrize("role_code", ["HEAD_DIRECTORATE_LINE", "HEAD_OPS_UNIT"])
def test_a_directorate_grant_derives_the_department_overview(tree, catalogue, role_code):
    user_id = _user(f"u-{role_code}")
    RoleAdminService.assign_role(user_id, role_code, tree["directorate"].id, actor="t")

    overview = PermissionService.visible_division_ids(user_id, "orgstructure.view")
    statuses = PermissionService.visible_division_ids(user_id, "status.manage")

    assert tree["other"].id in overview, "обзор обязан накрыть соседнее управление департамента"
    assert tree["department"].id in overview
    assert tree["org"].id not in overview, "выше департамента обзор не поднимается"
    assert statuses == {tree["directorate"].id, tree["unit"].id}, (
        "статусы остались на управлении — производится только роль-добавка"
    )


def test_a_department_grant_derives_nothing_extra(tree, catalogue):
    user_id = _user("u-dept")
    RoleAdminService.assign_role(user_id, "HEAD_OPS_UNIT", tree["department"].id, actor="t")

    overview = PermissionService.visible_division_ids(user_id, "orgstructure.view")

    assert tree["org"].id not in overview
    assert tree["department"].id in overview


def test_other_roles_are_not_derived(tree, catalogue):
    user_id = _user("u-emp")
    RoleAdminService.assign_role(user_id, "EMPLOYEE", tree["directorate"].id, actor="t")

    assert PermissionService.visible_division_ids(user_id, "orgstructure.view") == set()
    assert "orgstructure.view" not in PermissionService.effective_permissions(user_id)


def test_the_derived_grant_is_visible_to_effective_permissions_at_the_department(tree, catalogue):
    user_id = _user("u-eff")
    RoleAdminService.assign_role(
        user_id, "HEAD_DIRECTORATE_LINE", tree["directorate"].id, actor="t"
    )

    at_department = PermissionService.effective_permissions(
        user_id, division_id=tree["department"].id
    )
    assert "orgstructure.view" in at_department
    assert "status.manage" not in at_department


def test_a_grant_without_scope_derives_nothing(tree, catalogue):
    user_id = _user("u-global")
    RoleAdminService.assign_role(user_id, "HEAD_DIRECTORATE_LINE", None, actor="t")

    assert PermissionService.visible_division_ids(user_id, "orgstructure.view") is None
