"""Админ-API RBAC раздела ОМ: /api/operations/{roles,permissions,user-roles,
temporary-duty}/ (порт поверхности из Backend/VAPS).

Проверяются: единый гейт admin.roles на КАЖДОМ обслуживаемом действии,
запись через сервисы (а не напрямую в ORM из вьюхи), происхождение
идентичности из аутентификации, честные 400/404 вместо 500/ложного успеха.
"""
from datetime import timedelta

import pytest
from django.contrib.auth.models import User
from rest_framework.test import APIClient

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

ROLES_URL = "/api/operations/roles/"
PERMISSIONS_URL = "/api/operations/permissions/"
USER_ROLES_URL = "/api/operations/user-roles/"
TEMP_DUTY_URL = "/api/operations/temporary-duty/"


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


def client_for(username, role_code=None, perms=()):
    user = User.objects.create_user(username=username, password="x")
    if role_code is not None:
        seed_role(role_code, perms)
        RoleAdminService.assign_role(str(user.pk), role_code, actor="test")
    api = APIClient()
    api.force_authenticate(user)
    return api, user


@pytest.fixture
def admin_client(db):
    return client_for("rbac-admin", "ADMIN", ["*"])


@pytest.fixture
def plain_client(db):
    # DIVISION_OPERATOR держит права раздела, но НЕ admin.roles — тот самый
    # DENY-дискриминатор: без него зелёный тест не отличал бы гейт от его
    # отсутствия.
    return client_for("rbac-nobody", "DIVISION_OPERATOR", ["status.view"])


@pytest.mark.django_db
class TestGate:
    @pytest.mark.parametrize(
        "method,url",
        [
            ("get", ROLES_URL),
            ("get", PERMISSIONS_URL),
            ("get", USER_ROLES_URL),
            ("post", USER_ROLES_URL),
            ("get", TEMP_DUTY_URL),
            ("post", TEMP_DUTY_URL),
        ],
    )
    def test_without_admin_roles_denied(self, plain_client, method, url):
        api, _user = plain_client
        assert getattr(api, method)(url, {}, format="json").status_code == 403

    def test_detail_actions_denied(self, plain_client, admin_client):
        api, _user = plain_client
        admin_api, _admin = admin_client
        seed_role("VIEWER", ["status.view"])
        assignment = RoleAdminService.assign_role("42", "VIEWER", actor="test")
        grant = RoleAdminService.grant_temporary_duty(
            user_id="42",
            duty_role_code="HQ_DUTY",
            starts_at=Clock.now(),
            ends_at=Clock.now() + timedelta(hours=1),
            created_by="test",
        )
        assert api.get(f"{ROLES_URL}VIEWER/").status_code == 403
        assert api.delete(f"{USER_ROLES_URL}{assignment.id}/").status_code == 403
        assert api.post(f"{TEMP_DUTY_URL}{grant.id}/expire/").status_code == 403
        # Гейт закрыл действие, а не сломал маршрут: у админа тот же URL живой.
        assert admin_api.get(f"{ROLES_URL}VIEWER/").status_code == 200

    def test_anonymous_denied(self, db):
        assert APIClient().get(ROLES_URL).status_code == 403


@pytest.mark.django_db
class TestReferenceReads:
    def test_roles_and_permissions_listed_sorted(self, admin_client):
        api, _user = admin_client
        seed_role("VIEWER", ["status.view"])
        roles = api.get(ROLES_URL).json()["results"]
        assert [r["code"] for r in roles] == ["ADMIN", "VIEWER"]
        perms = api.get(PERMISSIONS_URL).json()["results"]
        assert [p["code"] for p in perms] == ["*", "status.view"]


@pytest.mark.django_db
class TestUserRoleWrites:
    def test_assign_grants_permissions(self, admin_client):
        api, _admin = admin_client
        seed_role("VIEWER", ["status.view"])
        response = api.post(
            USER_ROLES_URL, {"user_id": "42", "role_code": "VIEWER"}, format="json"
        )
        assert response.status_code == 201
        assert response.json()["role_code"] == "VIEWER"
        assert PermissionService.effective_permissions("42") == {"status.view"}

    def test_actor_comes_from_auth_not_body(self, admin_client):
        api, admin = admin_client
        seed_role("VIEWER", ["status.view"])
        api.post(
            USER_ROLES_URL,
            {"user_id": "42", "role_code": "VIEWER", "created_by": "подделка"},
            format="json",
        )
        assert UserRole.objects.get(user_id="42").created_by == str(admin.pk)

    def test_scope_is_stored(self, admin_client):
        api, _admin = admin_client
        seed_role("VIEWER", ["status.view"])
        response = api.post(
            USER_ROLES_URL,
            {"user_id": "42", "role_code": "VIEWER", "scope_division_id": 7},
            format="json",
        )
        assert response.status_code == 201
        assert UserRole.objects.get(user_id="42").scope_division_id == 7

    def test_missing_field_is_400_not_500(self, admin_client):
        api, _admin = admin_client
        assert api.post(USER_ROLES_URL, {"user_id": "42"}, format="json").status_code == 400

    def test_unknown_role_is_400(self, admin_client):
        api, _admin = admin_client
        response = api.post(
            USER_ROLES_URL, {"user_id": "42", "role_code": "НЕТ"}, format="json"
        )
        assert response.status_code == 400

    def test_list_filters_by_user(self, admin_client):
        api, _admin = admin_client
        seed_role("VIEWER", ["status.view"])
        RoleAdminService.assign_role("42", "VIEWER", actor="test")
        RoleAdminService.assign_role("43", "VIEWER", actor="test")
        results = api.get(USER_ROLES_URL, {"user_id": "42"}).json()["results"]
        assert [r["user_id"] for r in results] == ["42"]

    def test_revoke_drops_permissions_and_keeps_row(self, admin_client):
        api, _admin = admin_client
        seed_role("VIEWER", ["status.view"])
        assignment = RoleAdminService.assign_role("42", "VIEWER", actor="test")
        assert api.delete(f"{USER_ROLES_URL}{assignment.id}/").status_code == 204
        assert PermissionService.effective_permissions("42") == set()
        # Отзыв — деактивация, не удаление: история назначений остаётся.
        assignment.refresh_from_db()
        assert assignment.is_active is False

    def test_revoke_unknown_is_404(self, admin_client):
        api, _admin = admin_client
        assert api.delete(f"{USER_ROLES_URL}999999/").status_code == 404


@pytest.mark.django_db
class TestTemporaryDutyWrites:
    def _payload(self, **overrides):
        now = Clock.now()
        payload = {
            "user_id": "42",
            "duty_role_code": "HQ_DUTY",
            "starts_at": (now - timedelta(hours=1)).isoformat(),
            "ends_at": (now + timedelta(hours=1)).isoformat(),
        }
        payload.update(overrides)
        return payload

    def test_grant_is_effective_within_window(self, admin_client):
        api, admin = admin_client
        seed_role("HQ_DUTY", ["duty.manage"])
        response = api.post(TEMP_DUTY_URL, self._payload(), format="json")
        assert response.status_code == 201
        assert PermissionService.has_permission("42", "duty.manage")
        # created_by — из аутентификации.
        assert TemporaryDutyPermission.objects.get(user_id="42").created_by == str(
            admin.pk
        )

    def test_created_by_from_body_ignored(self, admin_client):
        api, admin = admin_client
        seed_role("HQ_DUTY", ["duty.manage"])
        api.post(TEMP_DUTY_URL, self._payload(created_by="подделка"), format="json")
        assert TemporaryDutyPermission.objects.get(user_id="42").created_by == str(
            admin.pk
        )

    def test_reversed_window_is_400(self, admin_client):
        api, _admin = admin_client
        now = Clock.now()
        response = api.post(
            TEMP_DUTY_URL,
            self._payload(
                starts_at=(now + timedelta(hours=1)).isoformat(),
                ends_at=now.isoformat(),
            ),
            format="json",
        )
        assert response.status_code == 400

    def test_unknown_duty_role_is_400(self, admin_client):
        api, _admin = admin_client
        response = api.post(
            TEMP_DUTY_URL, self._payload(duty_role_code="НЕТ"), format="json"
        )
        assert response.status_code == 400

    def test_expire_revokes(self, admin_client):
        api, _admin = admin_client
        seed_role("HQ_DUTY", ["duty.manage"])
        grant_id = api.post(TEMP_DUTY_URL, self._payload(), format="json").json()["id"]
        assert api.post(f"{TEMP_DUTY_URL}{grant_id}/expire/").status_code == 200
        assert not PermissionService.has_permission("42", "duty.manage")

    def test_expire_unknown_is_404(self, admin_client):
        # Ложный успех на несуществующем гранте скрывал бы опечатку в id.
        api, _admin = admin_client
        assert api.post(f"{TEMP_DUTY_URL}999999/expire/").status_code == 404

    def test_list_newest_first(self, admin_client):
        api, _admin = admin_client
        now = Clock.now()
        for offset in (3, 1, 2):
            RoleAdminService.grant_temporary_duty(
                user_id="42",
                duty_role_code="HQ_DUTY",
                starts_at=now - timedelta(hours=offset),
                ends_at=now + timedelta(hours=1),
                created_by="test",
            )
        results = api.get(TEMP_DUTY_URL).json()["results"]
        starts = [row["starts_at"] for row in results]
        assert starts == sorted(starts, reverse=True)


# ── Plane №36, шаг «П-2»: справочник прав дорос до записи и поиска ──────────


@pytest.mark.django_db
def test_permissions_search_looks_at_code_name_and_description():
    """Поиск идёт НА СЕРВЕР и смотрит на всё, что видно в строке списка."""
    admin, _ = client_for("perm-admin", "ADMIN", perms=("admin.roles",))
    Permission.objects.create(
        code="reports.export", name="Выгрузка отчётов", description="в Excel"
    )
    Permission.objects.create(code="event.view", name="Просмотр мероприятий")

    by_code = admin.get(f"{PERMISSIONS_URL}?search=reports").json()["results"]
    by_name = admin.get(f"{PERMISSIONS_URL}?search=Выгрузка").json()["results"]
    by_description = admin.get(f"{PERMISSIONS_URL}?search=Excel").json()["results"]
    everything = admin.get(PERMISSIONS_URL).json()["results"]

    assert [row["code"] for row in by_code] == ["reports.export"]
    assert [row["code"] for row in by_name] == ["reports.export"]
    assert [row["code"] for row in by_description] == ["reports.export"]
    # Сторож: без поиска строк БОЛЬШЕ — иначе проба не отличала бы фильтр от
    # его отсутствия.
    assert len(everything) > len(by_code)


@pytest.mark.django_db
def test_permission_is_created_and_leaves_a_trace():
    """Заведение права — именное решение: в журнале есть строка с кодом."""
    from organization_management.apps.operations.models_audit import OpsAuditLog

    admin, user = client_for("perm-author", "ADMIN", perms=("admin.roles",))

    response = admin.post(
        PERMISSIONS_URL,
        {"code": "reports.export", "name": "Выгрузка отчётов", "is_active": True},
        format="json",
    )

    assert response.status_code == 201
    assert Permission.objects.filter(code="reports.export").exists()
    entry = OpsAuditLog.objects.get(action="ACCESS_PERMISSION_SAVED")
    # Ключ строки — КОД, а не число: у права числового идентификатора нет.
    assert entry.entity_key == "reports.export"
    assert entry.entity_id is None
    assert entry.old_value is None
    assert entry.actor_user_id == str(user.pk)


@pytest.mark.django_db
def test_permission_edit_keeps_the_previous_value_in_the_trace():
    """Правка кладёт прежнее значение рядом с новым."""
    from organization_management.apps.operations.models_audit import OpsAuditLog

    admin, _ = client_for("perm-editor", "ADMIN", perms=("admin.roles",))
    Permission.objects.create(code="reports.export", name="Старое имя")

    admin.patch(
        f"{PERMISSIONS_URL}reports.export/",
        {"name": "Выгрузка отчётов", "is_active": False},
        format="json",
    )

    entry = OpsAuditLog.objects.filter(action="ACCESS_PERMISSION_SAVED").latest("id")
    assert entry.old_value["name"] == "Старое имя"
    assert entry.new_value["name"] == "Выгрузка отчётов"
    assert Permission.objects.get(code="reports.export").is_active is False


@pytest.mark.django_db
def test_permission_cannot_be_deleted():
    """Удаления нет: код права стоит в гейтах живых ручек."""
    admin, _ = client_for("perm-remover", "ADMIN", perms=("admin.roles",))
    Permission.objects.create(code="reports.export", name="Выгрузка отчётов")

    response = admin.delete(f"{PERMISSIONS_URL}reports.export/")

    assert response.status_code == 405
    assert Permission.objects.filter(code="reports.export").exists()


@pytest.mark.django_db
def test_writing_permissions_is_closed_to_those_who_do_not_manage_access():
    """Заводить права может только тот, кто управляет доступом."""
    stranger, _ = client_for("perm-stranger", "READER", perms=("event.view",))

    response = stranger.post(
        PERMISSIONS_URL, {"code": "sneaky", "name": "Тихо"}, format="json"
    )

    assert response.status_code == 403
    assert not Permission.objects.filter(code="sneaky").exists()


# ── Plane №36, шаг «П-3»: справочник ролей дорос до записи и состава прав ───


@pytest.mark.django_db
def test_roles_search_looks_at_code_name_and_description():
    """Поиск по ролям идёт НА СЕРВЕР и смотрит на всё, что видно в строке."""
    admin, _ = client_for("role-admin", "ADMIN", perms=("admin.roles",))
    Role.objects.create(
        code="ARCHIVIST", name="Архивариус", description="ведёт бумажный архив"
    )
    Role.objects.create(code="READER", name="Читатель")

    by_code = admin.get(f"{ROLES_URL}?search=ARCHIV").json()["results"]
    by_name = admin.get(f"{ROLES_URL}?search=Архивариус").json()["results"]
    by_description = admin.get(f"{ROLES_URL}?search=бумажный").json()["results"]
    everything = admin.get(ROLES_URL).json()["results"]

    assert [row["code"] for row in by_code] == ["ARCHIVIST"]
    assert [row["code"] for row in by_name] == ["ARCHIVIST"]
    assert [row["code"] for row in by_description] == ["ARCHIVIST"]
    # Сторож: без поиска строк БОЛЬШЕ — иначе проба не отличала бы фильтр от
    # его отсутствия.
    assert len(everything) > len(by_code)


@pytest.mark.django_db
def test_role_list_carries_its_permissions():
    """Реестр отвечает не только «как называется», но и «что открывает»."""
    admin, _ = client_for("role-reader", "ADMIN", perms=("admin.roles",))
    seed_role("ARCHIVIST", ["document.view", "document.export"])

    row = next(
        r
        for r in admin.get(ROLES_URL).json()["results"]
        if r["code"] == "ARCHIVIST"
    )

    assert row["permissions"] == ["document.export", "document.view"]


@pytest.mark.django_db
def test_role_is_created_without_permissions_and_leaves_a_trace():
    """Роль-заготовка без прав допустима; заведение — именное решение."""
    from organization_management.apps.operations.models_audit import OpsAuditLog

    admin, user = client_for("role-author", "ADMIN", perms=("admin.roles",))

    response = admin.post(
        ROLES_URL,
        {"code": "ARCHIVIST", "name": "Архивариус", "is_active": True},
        format="json",
    )

    assert response.status_code == 201
    assert response.json()["permissions"] == []
    assert Role.objects.filter(code="ARCHIVIST").exists()
    entry = OpsAuditLog.objects.get(action="ACCESS_ROLE_SAVED")
    # Ключ строки — КОД, а не число: у роли числового идентификатора нет.
    assert entry.entity_key == "ARCHIVIST"
    assert entry.entity_id is None
    assert entry.old_value is None
    assert entry.actor_user_id == str(user.pk)


@pytest.mark.django_db
def test_role_edit_keeps_the_previous_value_in_the_trace():
    admin, _ = client_for("role-editor", "ADMIN", perms=("admin.roles",))
    Role.objects.create(code="ARCHIVIST", name="Старое имя")

    admin.patch(
        f"{ROLES_URL}ARCHIVIST/",
        {"name": "Архивариус", "is_active": False},
        format="json",
    )

    from organization_management.apps.operations.models_audit import OpsAuditLog

    entry = OpsAuditLog.objects.filter(action="ACCESS_ROLE_SAVED").latest("id")
    assert entry.old_value["name"] == "Старое имя"
    assert entry.new_value["name"] == "Архивариус"
    assert Role.objects.get(code="ARCHIVIST").is_active is False


@pytest.mark.django_db
def test_role_cannot_be_deleted():
    """Удаления нет: код роли стоит в назначениях, роль деактивируется."""
    admin, _ = client_for("role-remover", "ADMIN", perms=("admin.roles",))
    Role.objects.create(code="ARCHIVIST", name="Архивариус")

    response = admin.delete(f"{ROLES_URL}ARCHIVIST/")

    assert response.status_code == 405
    assert Role.objects.filter(code="ARCHIVIST").exists()


@pytest.mark.django_db
def test_role_composition_changes_and_is_named_in_the_trace():
    """Состав меняется одним обращением, а в журнале назван поимённо."""
    from organization_management.apps.operations.models_audit import OpsAuditLog

    admin, user = client_for("role-composer", "ADMIN", perms=("admin.roles",))
    seed_role("ARCHIVIST", ["document.view"])
    Permission.objects.create(code="document.export", name="Выгрузка документов")
    RoleAdminService.assign_role("42", "ARCHIVIST", actor="test")

    response = admin.post(
        f"{ROLES_URL}ARCHIVIST/permissions/",
        {"add": ["document.export"], "remove": ["document.view"]},
        format="json",
    )

    assert response.status_code == 200
    assert response.json()["permissions"] == ["document.export"]
    # Состав — не запись в справочнике, а живой доступ: у назначенного
    # человека права меняются тем же движением.
    assert PermissionService.effective_permissions("42") == {"document.export"}
    entry = OpsAuditLog.objects.get(action="ACCESS_ROLE_PERMISSIONS_CHANGED")
    assert entry.entity_key == "ARCHIVIST"
    assert entry.old_value["permissions"] == ["document.view"]
    assert entry.new_value["permissions"] == ["document.export"]
    assert entry.actor_user_id == str(user.pk)


@pytest.mark.django_db
def test_repeated_grant_neither_doubles_nor_lies_in_the_trace():
    """Повтор ничего не меняет — и строки о перемене не пишет."""
    from organization_management.apps.operations.models_audit import OpsAuditLog

    admin, _ = client_for("role-repeater", "ADMIN", perms=("admin.roles",))
    seed_role("ARCHIVIST", ["document.view"])

    response = admin.post(
        f"{ROLES_URL}ARCHIVIST/permissions/",
        {"add": ["document.view"]},
        format="json",
    )

    assert response.status_code == 200
    assert response.json()["permissions"] == ["document.view"]
    assert (
        RolePermission.objects.filter(
            role_code_id="ARCHIVIST", permission_code_id="document.view"
        ).count()
        == 1
    )
    assert not OpsAuditLog.objects.filter(
        action="ACCESS_ROLE_PERMISSIONS_CHANGED"
    ).exists()


@pytest.mark.django_db
def test_unknown_permission_is_400_and_changes_nothing():
    """Право, которого нет в справочнике, роли не выдаётся."""
    admin, _ = client_for("role-typo", "ADMIN", perms=("admin.roles",))
    seed_role("ARCHIVIST", ["document.view"])

    response = admin.post(
        f"{ROLES_URL}ARCHIVIST/permissions/",
        {"add": ["docment.export"], "remove": ["document.view"]},
        format="json",
    )

    assert response.status_code == 400
    # Отбитый запрос не выполнен ЧАСТИЧНО: снятие тоже не произошло.
    assert RoleAdminService.role_permission_codes("ARCHIVIST") == ["document.view"]


@pytest.mark.django_db
def test_same_permission_in_add_and_remove_is_400():
    """Противоречивый запрос — ошибка формы, а не выбор за отправителя."""
    admin, _ = client_for("role-contradiction", "ADMIN", perms=("admin.roles",))
    seed_role("ARCHIVIST", ["document.view"])

    response = admin.post(
        f"{ROLES_URL}ARCHIVIST/permissions/",
        {"add": ["document.view"], "remove": ["document.view"]},
        format="json",
    )

    assert response.status_code == 400
    assert RoleAdminService.role_permission_codes("ARCHIVIST") == ["document.view"]


@pytest.mark.django_db
def test_empty_composition_request_is_400():
    """Пустое обращение молча «успешным» не считается."""
    admin, _ = client_for("role-empty", "ADMIN", perms=("admin.roles",))
    seed_role("ARCHIVIST", ["document.view"])

    assert (
        admin.post(
            f"{ROLES_URL}ARCHIVIST/permissions/", {}, format="json"
        ).status_code
        == 400
    )


@pytest.mark.django_db
def test_writing_roles_is_closed_to_those_who_do_not_manage_access():
    """Заводить роли и править их состав может только управляющий доступом."""
    stranger, _ = client_for("role-stranger", "READER", perms=("event.view",))
    seed_role("ARCHIVIST", ["document.view"])

    created = stranger.post(
        ROLES_URL, {"code": "SNEAKY", "name": "Тихо"}, format="json"
    )
    composed = stranger.post(
        f"{ROLES_URL}ARCHIVIST/permissions/",
        {"add": ["event.view"]},
        format="json",
    )

    assert created.status_code == 403
    assert composed.status_code == 403
    assert not Role.objects.filter(code="SNEAKY").exists()
    assert RoleAdminService.role_permission_codes("ARCHIVIST") == ["document.view"]
