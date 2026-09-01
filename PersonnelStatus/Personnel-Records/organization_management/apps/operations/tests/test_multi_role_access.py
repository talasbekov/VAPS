"""Несколько ролей у одного человека и роль, собранная админом из прав.

Plane №353. Заказчик потребовал двух вещей от раздела «Система»: человеку
можно выдать НЕ ОДНУ роль, а несколько, и администратор может собрать новую
роль из прав. Обе возможности в системе были — модель `UserRole` держит
назначения списком, у роли есть создание и правка состава, — но ни одна проба
не стерегла ГЛАВНОГО следствия: права нескольких ролей СКЛАДЫВАЮТСЯ, а снятие
одной роли не уносит права остальных.

Проба падает на мутации, ради которой написана: если резолюция прав возьмёт
первое назначение вместо всех, второй ассерт каждого теста краснеет.

Идентификатор адресата — за диапазоном последовательности пользователей, по
той же причине, что в `test_rbac_admin_api`: малое число однажды совпало с pk
настоящей учётки соседней пробы.
"""
import pytest
from django.contrib.auth.models import User
from rest_framework.test import APIClient

from organization_management.apps.divisions.models import Division
from organization_management.apps.operations.models import Permission, Role, RolePermission
from organization_management.apps.operations.services import (
    PermissionService,
    RoleAdminService,
)

TARGET_USER = "900353"
ROLES_URL = "/api/operations/roles/"
USER_ROLES_URL = "/api/operations/user-roles/"


def seed_role(code, perms):
    role, _ = Role.objects.get_or_create(code=code, defaults={"name": code})
    for perm in perms:
        permission, _ = Permission.objects.get_or_create(
            code=perm, defaults={"name": perm}
        )
        RolePermission.objects.get_or_create(
            role_code=role, permission_code=permission
        )
    return role


def admin_client(username):
    user = User.objects.create_user(username=username, password="x")
    seed_role("ADMIN", ["*"])
    RoleAdminService.assign_role(str(user.pk), "ADMIN", actor="test")
    api = APIClient()
    api.force_authenticate(user)
    return api, user


@pytest.mark.django_db
def test_two_roles_add_up_their_permissions():
    """Две роли — сумма прав, а не права первой из них."""
    seed_role("READER_353", ["object.view"])
    seed_role("KEEPER_353", ["dictionary.manage"])

    RoleAdminService.assign_role(TARGET_USER, "READER_353", actor="test")
    assert PermissionService.effective_permissions(TARGET_USER) == {"object.view"}

    RoleAdminService.assign_role(TARGET_USER, "KEEPER_353", actor="test")
    assert PermissionService.effective_permissions(TARGET_USER) == {
        "object.view",
        "dictionary.manage",
    }


@pytest.mark.django_db
def test_revoking_one_role_keeps_the_other():
    """Снятие одной роли не уносит права второй."""
    seed_role("READER_353", ["object.view"])
    seed_role("KEEPER_353", ["dictionary.manage"])
    RoleAdminService.assign_role(TARGET_USER, "READER_353", actor="test")
    RoleAdminService.assign_role(TARGET_USER, "KEEPER_353", actor="test")

    RoleAdminService.revoke_role(TARGET_USER, "KEEPER_353", actor="test")

    assert PermissionService.effective_permissions(TARGET_USER) == {"object.view"}


@pytest.mark.django_db
def test_scope_of_one_role_does_not_narrow_the_other():
    """Область считается у КАЖДОГО гранта своя.

    Роль с областью департамента действует в нём и не действует в чужом;
    безобластная роль второго гранта при этом работает везде — иначе
    «несколько ролей» означало бы «самая узкая область на всех».
    """
    root = Division.objects.create(name="Организация", code="root-353")
    dep = Division.objects.create(name="Департамент", code="dep-353", parent=root)
    other = Division.objects.create(name="Чужой", code="other-353", parent=root)
    seed_role("READER_353", ["object.view"])
    seed_role("KEEPER_353", ["dictionary.manage"])

    RoleAdminService.assign_role(TARGET_USER, "READER_353", actor="test")
    RoleAdminService.assign_role(TARGET_USER, "KEEPER_353", dep.id, actor="test")

    assert PermissionService.has_permission(TARGET_USER, "dictionary.manage", dep.id)
    assert not PermissionService.has_permission(
        TARGET_USER, "dictionary.manage", other.id
    )
    # Безобластная роль от чужой области не страдает.
    assert PermissionService.has_permission(TARGET_USER, "object.view", other.id)


@pytest.mark.django_db
def test_role_built_by_admin_works_the_moment_it_is_granted():
    """Сквозной путь заказчика: роль собрана из прав и сразу даёт доступ.

    Ровно то, что администратор делает руками на двух экранах раздела
    «Система»: завёл роль, набрал ей права, выдал человеку. Проверяется не
    запись в справочнике, а ЖИВОЙ доступ носителя — включая то, что права
    новой роли ложатся ПОВЕРХ уже имевшейся.
    """
    api, _admin = admin_client("role-builder-353")
    Permission.objects.get_or_create(
        code="dictionary.manage", defaults={"name": "Ведение справочников"}
    )
    seed_role("READER_353", ["object.view"])
    RoleAdminService.assign_role(TARGET_USER, "READER_353", actor="test")

    assert (
        api.post(
            ROLES_URL,
            {"code": "CUSTOM_353", "name": "Своя роль администратора"},
            format="json",
        ).status_code
        == 201
    )
    assert (
        api.post(
            f"{ROLES_URL}CUSTOM_353/permissions/",
            {"add": ["dictionary.manage"]},
            format="json",
        ).status_code
        == 200
    )
    assert (
        api.post(
            USER_ROLES_URL,
            {"user_id": TARGET_USER, "role_code": "CUSTOM_353"},
            format="json",
        ).status_code
        == 201
    )

    assert PermissionService.effective_permissions(TARGET_USER) == {
        "object.view",
        "dictionary.manage",
    }


@pytest.mark.django_db
def test_my_permissions_names_every_role_of_the_actor():
    """Ручка `my-permissions` отдаёт ВСЕ роли актора, а не первую.

    Ею подписан профиль в шапке: пока ответ несёт одну роль, человек с двумя
    не может узнать, под какими правами он работает.
    """
    user = User.objects.create_user(username="multi-role-353", password="x")
    dep = Division.objects.create(name="Департамент", code="dep-353-me")
    seed_role("READER_353", ["object.view"])
    seed_role("KEEPER_353", ["dictionary.manage"])
    RoleAdminService.assign_role(str(user.pk), "READER_353", actor="test")
    RoleAdminService.assign_role(str(user.pk), "KEEPER_353", dep.id, actor="test")
    api = APIClient()
    api.force_authenticate(user)

    body = api.get("/api/operations/my-permissions/").json()

    assert sorted(body["permissions"]) == ["dictionary.manage", "object.view"]
    assert sorted(role["code"] for role in body["roles"]) == [
        "KEEPER_353",
        "READER_353",
    ]
    # Область названа именем подразделения: id ничего не говорит человеку.
    scoped = next(role for role in body["roles"] if role["code"] == "KEEPER_353")
    assert scoped["scope_division_name"] == "Департамент"
