"""Тесты RBAC раздела ОМ (порт из Backend/VAPS: rbac/tests/test_app.py по
духу + сервисные проверки; адаптация — старый проект: int-pk дерева,
SimpleJWT-идентичность, без superuser-шортката).
"""
from datetime import timedelta

import pytest
from django.conf import settings
from django.contrib.auth.models import User

from organization_management.apps.divisions.models import Division
from organization_management.apps.operations import clock
from organization_management.apps.operations.clock import Clock
from organization_management.apps.operations.models import (
    Permission,
    Role,
    RolePermission,
    TemporaryDutyPermission,
    UserRole,
)
from organization_management.apps.operations.services import (
    PermissionService,
    RoleAdminService,
)

EXPECTED_DB_TABLES = [
    (Role, "ops_roles"),
    (Permission, "ops_permissions"),
    (UserRole, "ops_user_roles"),
    (RolePermission, "ops_role_permissions"),
    (TemporaryDutyPermission, "ops_temporary_duty_permissions"),
]


def test_operations_app_installed():
    assert "organization_management.apps.operations" in settings.INSTALLED_APPS


@pytest.mark.parametrize("model,table", EXPECTED_DB_TABLES)
def test_rbac_db_table_matches_source(model, table):
    # Имена таблиц тождественны Backend/VAPS — будущий перенос данных
    # старый↔новый не потребует переименований.
    assert model._meta.db_table == table


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


@pytest.mark.django_db
class TestPermissionService:
    def test_no_grants_no_permissions(self):
        assert PermissionService.effective_permissions("77") == set()
        assert not PermissionService.has_permission("77", "status.view")

    def test_role_grant_yields_codes(self):
        seed_role("VIEWER", ["status.view"])
        RoleAdminService.assign_role("77", "VIEWER", actor="test")
        assert PermissionService.effective_permissions("77") == {"status.view"}

    def test_wildcard_short_circuits(self):
        seed_role("ADMIN", ["*"])
        RoleAdminService.assign_role("77", "ADMIN", actor="test")
        assert PermissionService.has_permission("77", "anything.at.all")

    def test_revoked_role_gone(self):
        seed_role("VIEWER", ["status.view"])
        RoleAdminService.assign_role("77", "VIEWER", actor="test")
        RoleAdminService.revoke_role("77", "VIEWER", actor="test")
        assert PermissionService.effective_permissions("77") == set()

    def test_scope_narrows_division_checks(self):
        root = Division.objects.create(name="Организация", code="root")
        dep = Division.objects.create(name="Департамент", code="dep", parent=root)
        other = Division.objects.create(name="Чужой", code="other", parent=root)
        seed_role("VIEWER", ["status.view"])
        RoleAdminService.assign_role("77", "VIEWER", dep.id, actor="test")
        # Внутри поддерева scope — да; в чужом — нет; глобальная проверка
        # (division_id=None) проходит: scope сужает только division-специфику.
        assert PermissionService.has_permission("77", "status.view", dep.id)
        assert not PermissionService.has_permission("77", "status.view", other.id)
        assert PermissionService.has_permission("77", "status.view", None)

    def test_temporary_duty_window(self):
        seed_role("HQ_DUTY", ["duty.manage"])
        now = Clock.now()
        RoleAdminService.grant_temporary_duty(
            user_id="77",
            duty_role_code="HQ_DUTY",
            starts_at=now - timedelta(hours=1),
            ends_at=now + timedelta(hours=1),
            created_by="test",
        )
        assert PermissionService.has_permission("77", "duty.manage")
        # За пределами окна грант мёртв.
        with clock.override(now + timedelta(hours=2)):
            assert not PermissionService.has_permission("77", "duty.manage")

    def test_visible_division_ids(self):
        root = Division.objects.create(name="Организация", code="root")
        dep = Division.objects.create(name="Департамент", code="dep", parent=root)
        child = Division.objects.create(name="Отдел", code="child", parent=dep)
        Division.objects.create(name="Чужой", code="other", parent=root)
        seed_role("VIEWER", ["status.view"])
        RoleAdminService.assign_role("77", "VIEWER", dep.id, actor="test")
        visible = PermissionService.visible_division_ids("77", "status.view")
        assert visible == {dep.id, child.id}
        # Безскоуповый грант → глобальная видимость (None).
        RoleAdminService.assign_role("77", "VIEWER", None, actor="test")
        assert PermissionService.visible_division_ids("77", "status.view") is None
        # Код без грантов → пусто (fail-closed).
        assert PermissionService.visible_division_ids("77", "duty.manage") == set()


@pytest.mark.django_db
class TestMyPermissionsApi:
    URL = "/api/operations/my-permissions/"

    # Проектная аутентификация — SimpleJWT; force_authenticate ставит
    # пользователя в обход выпуска токена (идентичность не предмет тестов).
    def _client(self, username="ops-user"):
        from rest_framework.test import APIClient

        user = User.objects.create_user(username=username, password="x")
        api_client = APIClient()
        api_client.force_authenticate(user)
        return api_client, user

    def test_anonymous_denied(self, client):
        assert client.get(self.URL).status_code == 403

    def test_returns_sorted_codes(self):
        api_client, user = self._client()
        seed_role("VIEWER", ["status.view", "personnel.view"])
        RoleAdminService.assign_role(str(user.pk), "VIEWER", actor="test")
        response = api_client.get(self.URL)
        assert response.status_code == 200
        # 🔴 ПИН ПРАВЛЕН ОСОЗНАННО (Plane №325). Пин был на ВЕСЬ ответ, и
        # добавление поля `roles` его сломало — правильно сломало: пин на
        # целое тело и стережёт «состав ответа не меняется молча». Поле
        # добавлено рядом с правами и НАЗВАНО здесь же: права отвечают «что
        # мне можно», роль — «кто я здесь», и шапка портала печатала кадровую
        # роль учётке, работающей под ролью раздела.
        assert response.json() == {
            "permissions": ["personnel.view", "status.view"],
            "roles": [
                {
                    "code": "VIEWER",
                    "name": "VIEWER",
                    "scope_division_id": None,
                    "scope_division_name": None,
                }
            ],
        }

    def test_superuser_without_role_has_nothing(self):
        # Роли и права — как в новой системе: флаг Django не даёт wildcard,
        # только назначение роли ADMIN.
        from rest_framework.test import APIClient

        admin = User.objects.create_superuser("root", "r@x", "x")
        api_client = APIClient()
        api_client.force_authenticate(admin)
        response = api_client.get(self.URL)
        assert response.status_code == 200
        # Пин правлен вместе с соседним (Plane №325): ролей раздела у
        # суперпользователя без назначения тоже нет — пусто, а не отсутствие
        # поля. Читателю нужен предсказуемый список, а не «иногда ключа нет».
        assert response.json() == {"permissions": [], "roles": []}

    def test_division_id_must_be_int(self):
        api_client, _user = self._client()
        assert api_client.get(self.URL, {"division_id": "abc"}).status_code == 400


@pytest.mark.django_db
class TestRolesHoldingContract:
    """Общий договор «какие роли держат право» (Plane №880).

    🔴 ЗАЧЕМ ПРОБЫ У ОДНОСТРОЧНОГО ЗАПРОСА. Договор заведён, чтобы этот
    вопрос перестал жить копиями: его задают рассылка запроса сил, отбор
    штаба и рассылка ознакомления, а раньше каждый спрашивал сам. У копий
    была ровно одна тонкость, которую легко потерять при переписывании, —
    wildcard: роль с «*» держит любое право, и без него ADMIN тихо выпадает
    из ВСЕХ рассылок сразу. Замерено: без этих проб мутация «убрать WILDCARD
    из договора» оставалась ЗЕЛЁНОЙ на всех 39 пробах трёх модулей-читателей.
    """

    @staticmethod
    def _role_with(code, permission_code):
        role, _ = Role.objects.get_or_create(code=code, defaults={"name": code})
        permission, _ = Permission.objects.get_or_create(
            code=permission_code, defaults={"name": permission_code}
        )
        RolePermission.objects.get_or_create(role_code=role, permission_code=permission)
        return role

    def test_a_role_with_the_right_is_returned(self):
        self._role_with("RH_HOLDER", "rh.probe")
        self._role_with("RH_OTHER", "rh.another")
        assert PermissionService.roles_holding("rh.probe") == {"RH_HOLDER"}

    def test_the_wildcard_role_holds_every_right(self):
        """Мутация: убрать `WILDCARD` из договора — ADMIN выпадет из рассылок.

        Тихо и сразу из всех: получатель просто перестанет приходить, а
        отчёт скажет «уведомлено 0» без единой ошибки.
        """
        self._role_with("RH_ADMIN", "*")
        assert "RH_ADMIN" in PermissionService.roles_holding("rh.probe")
        assert "RH_ADMIN" in PermissionService.roles_holding("rh.never.granted.to.anyone")

    def test_nobody_holding_it_is_an_empty_set_not_everybody(self):
        """Права не держит никто — пусто, а не «все».

        Читатели на этом строят fail-closed: пустой набор ролей означает
        «рассылать некому». Верни сюда `None` или полный список — и рассылка
        поимённого состава ушла бы всем подряд.
        """
        self._role_with("RH_HOLDER", "rh.probe")
        assert PermissionService.roles_holding("rh.absent") == set()
