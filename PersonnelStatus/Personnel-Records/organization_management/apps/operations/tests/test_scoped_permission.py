"""Проверка права С ОБЛАСТЬЮ (Plane №74, шаг «Р-2»).

Заказчик просил разграничить цепочку сбора сил не только по действиям, но и по
подразделениям: «ответственный за выделение сотрудников В СВОЁМ департаменте
(не в чужом)», «начальник управления, и только по своему управлению».
Обычный `require_permission` на этот вопрос не отвечает — он спрашивает, есть
ли право вообще.

Пробы стерегут ровно разницу: своя область проходит, чужая — нет, дочернее
управление своего департамента — проходит (иначе область департамента не имела
бы смысла), а роль БЕЗ области остаётся всесильной, как и была.
"""
import pytest
from django.contrib.auth.models import User
from rest_framework.exceptions import PermissionDenied
from rest_framework.test import APIRequestFactory

from organization_management.apps.divisions.models import Division
from organization_management.apps.operations.api.permissions import (
    require_permission,
    require_scoped_permission,
)
from organization_management.apps.operations.models import (
    Permission,
    Role,
    RolePermission,
)
from organization_management.apps.operations.services import RoleAdminService

pytestmark = pytest.mark.django_db

CODE = "forces.allocate"


def seed_role(role_code, codes):
    Role.objects.get_or_create(code=role_code, defaults={"name": role_code})
    for code in codes:
        Permission.objects.get_or_create(code=code, defaults={"name": code})
        RolePermission.objects.get_or_create(
            role_code_id=role_code, permission_code_id=code
        )


def request_of(user):
    request = APIRequestFactory().get("/")
    request.user = user
    return request


def actor_with(username, role_code, codes, scope_division_id=None):
    user = User.objects.create_user(username=username, password="x")
    seed_role(role_code, codes)
    RoleAdminService.assign_role(
        str(user.pk), role_code, scope_division_id, actor="test"
    )
    return request_of(user)


@pytest.fixture
def departments():
    own = Division.objects.create(
        name="Департамент А", division_type=Division.DivisionType.DEPARTMENT
    )
    other = Division.objects.create(
        name="Департамент Б", division_type=Division.DivisionType.DEPARTMENT
    )
    directorate = Division.objects.create(
        name="Управление А-1",
        division_type=Division.DivisionType.DIRECTORATE,
        parent=own,
    )
    return own, other, directorate


def test_own_department_passes(departments):
    own, _, _ = departments
    request = actor_with("scoped-own", "DEPT_LEAD", [CODE], own.pk)

    require_scoped_permission(request, CODE, own.pk)


def test_foreign_department_is_refused(departments):
    own, other, _ = departments
    request = actor_with("scoped-foreign", "DEPT_LEAD", [CODE], own.pk)

    with pytest.raises(PermissionDenied):
        require_scoped_permission(request, CODE, other.pk)


def test_directorate_of_own_department_passes(departments):
    """Область департамента покрывает его управления — иначе она бессмысленна:
    выделяют людей именно управления, а отвечает за это департамент."""
    own, _, directorate = departments
    request = actor_with("scoped-child", "DEPT_LEAD", [CODE], own.pk)

    require_scoped_permission(request, CODE, directorate.pk)


def test_role_without_scope_still_passes_anywhere(departments):
    """Роль, выданная БЕЗ области, не сужается: такие роли ведут цепочку
    сегодня, и запереть их значило бы сломать работающее."""
    _, other, _ = departments
    request = actor_with("unscoped", "GLOBAL_LEAD", [CODE])

    require_scoped_permission(request, CODE, other.pk)


def test_wildcard_passes_any_scope(departments):
    _, other, _ = departments
    request = actor_with("admin-any", "ADMIN", ["*"], None)

    require_scoped_permission(request, CODE, other.pk)


def test_missing_permission_is_refused_even_in_own_scope(departments):
    """Область НЕ выдаёт права: у кого кода нет — тому и своё подразделение
    не помогает."""
    own, _, _ = departments
    request = actor_with("scoped-noperm", "DEPT_LEAD", ["status.view"], own.pk)

    with pytest.raises(PermissionDenied):
        require_scoped_permission(request, CODE, own.pk)


def test_unset_scope_is_refused_for_a_scoped_role(departments):
    """Область не установлена, а роль выдана С областью — ОТКАЗ.

    Это главная проба шага. Идентификатор сотрудника приходит ИЗ ТЕЛА
    ЗАПРОСА, и человек без штатной единицы даёт область `None`. Пропусти его
    проверка — и роль с областью «Департамент А» выделяла бы кого угодно,
    подобрав «удобного» человека: ровно та граница, ради которой задача и
    ставилась, обходилась бы телом запроса.
    """
    own, _, _ = departments
    scoped = actor_with("unset-scope", "DEPT_LEAD", [CODE], own.pk)

    with pytest.raises(PermissionDenied):
        require_scoped_permission(scoped, CODE, None)


def test_unset_scope_passes_for_a_role_given_without_scope(departments):
    """Роль БЕЗ области неразрешимой областью не сужается: сузить её нечем ни
    в одном подразделении, и отказ запер бы ровно тех, кто ведёт цепочку
    сегодня, ничего не защитив."""
    request = actor_with("unset-scope-global", "GLOBAL_LEAD", [CODE])

    require_scoped_permission(request, CODE, None)


def test_unscoped_role_passes_any_division(departments):
    own, _, _ = departments
    request = actor_with("global-anywhere", "GLOBAL_LEAD2", [CODE])

    require_scoped_permission(request, CODE, own.pk)


def test_unset_scope_does_not_stop_the_admin():
    request = actor_with("unset-scope-admin", "ADMIN", ["*"])

    require_scoped_permission(request, CODE, None)


def test_anonymous_is_refused():
    from django.contrib.auth.models import AnonymousUser

    request = request_of(AnonymousUser())

    with pytest.raises(PermissionDenied):
        require_scoped_permission(request, CODE, None)
    with pytest.raises(PermissionDenied):
        require_permission(request, CODE)
