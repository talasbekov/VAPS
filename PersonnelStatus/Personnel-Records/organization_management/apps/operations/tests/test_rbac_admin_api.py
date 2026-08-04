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
