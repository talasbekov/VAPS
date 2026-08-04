"""Справочник типов статусов и МОСТ к словарю старой системы.

Главный инвариант переезда: каждый код старой системы имеет ровно одну
каноническую пару. Пока модель статусов не выбрана, этот тест — то, что не
даст двум словарям разъехаться молча.
"""
import pytest
from django.contrib.auth.models import User
from django.core.management import call_command
from rest_framework.test import APIClient

from organization_management.apps.operations.management.commands.seed_status_types import (  # noqa: E501
    HARD_BLOCK_CODES,
    LEGACY_CODE_BY_CODE,
    STATUS_TYPES,
)
from organization_management.apps.operations.models import (
    Permission,
    Role,
    RolePermission,
    StatusType,
)
from organization_management.apps.operations.services import RoleAdminService
from organization_management.apps.statuses.models import EmployeeStatus

STATUS_TYPES_URL = "/api/operations/status-types/"


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


def client_for(username, role_code, perms):
    user = User.objects.create_user(username=username, password="x")
    seed_role(role_code, perms)
    RoleAdminService.assign_role(str(user.pk), role_code, actor="test")
    api = APIClient()
    api.force_authenticate(user)
    return api


def test_legacy_bridge_covers_old_choices():
    # Ни одно значение старого словаря не должно остаться без канонической
    # пары — иначе перенос данных потерял бы строки.
    old_codes = {value for value, _label in EmployeeStatus.StatusType.choices}
    assert old_codes == set(LEGACY_CODE_BY_CODE.values())


def test_legacy_bridge_is_injective():
    # Два канонических типа на один старый код сделали бы перенос
    # неоднозначным (в БД это же стережёт unique на legacy_code).
    assert len(set(LEGACY_CODE_BY_CODE.values())) == len(LEGACY_CODE_BY_CODE)


def test_legacy_bridge_keys_exist_in_catalog():
    catalog_codes = {code for code, *_rest in STATUS_TYPES}
    assert set(LEGACY_CODE_BY_CODE) <= catalog_codes


@pytest.mark.django_db
class TestSeed:
    def test_seed_is_idempotent(self):
        call_command("seed_status_types")
        first = StatusType.objects.count()
        call_command("seed_status_types")
        assert StatusType.objects.count() == first == len(STATUS_TYPES)

    def test_hard_block_flags_match_canon(self):
        call_command("seed_status_types")
        hard = set(
            StatusType.objects.filter(is_hard_block=True).values_list(
                "code", flat=True
            )
        )
        assert hard == HARD_BLOCK_CODES

    def test_operator_owned_fields_not_resynced(self):
        call_command("seed_status_types")
        StatusType.objects.filter(code="VACATION").update(
            color="#ff0000", is_active=False
        )
        call_command("seed_status_types")
        vacation = StatusType.objects.get(code="VACATION")
        # Канон пересинхронизирован, операторские поля — нет.
        assert vacation.name == "В отпуске"
        assert vacation.color == "#ff0000"
        assert vacation.is_active is False

    def test_legacy_codes_seeded(self):
        call_command("seed_status_types")
        assert StatusType.objects.get(code="COMMAND").legacy_code == "business_trip"
        # Тип, которого в старом словаре не было, честно без пары.
        assert StatusType.objects.get(code="GEV").legacy_code is None

    def test_ordering_is_by_priority(self):
        call_command("seed_status_types")
        codes = list(StatusType.objects.values_list("code", flat=True))
        assert codes[0] == "SICK_LEAVE"
        assert codes[-1] == "IN_SERVICE"


@pytest.mark.django_db
class TestStatusTypeApi:
    def test_requires_status_view(self):
        # Роль без status.view: закрыто (DENY-дискриминатор).
        api = client_for("no-status", "APPROVER", ["assignment.approve"])
        assert api.get(STATUS_TYPES_URL).status_code == 403

    def test_reader_sees_catalog_with_bridge(self):
        call_command("seed_status_types")
        api = client_for("status-reader", "VIEWER", ["status.view"])
        response = api.get(STATUS_TYPES_URL, {"limit": 100})
        assert response.status_code == 200
        rows = {row["code"]: row for row in response.json()["results"]}
        assert rows["COMMAND"]["legacy_code"] == "business_trip"
        assert rows["SICK_LEAVE"]["is_hard_block"] is True
        assert rows["IN_SERVICE"]["is_hard_block"] is False

    def test_write_is_closed(self):
        api = client_for("status-writer", "ADMIN", ["*"])
        # Каталог правится сидом: даже wildcard не открывает запись.
        assert api.post(STATUS_TYPES_URL, {}, format="json").status_code == 405
