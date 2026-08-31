"""Семь учёток матрицы доступа — по СПИСКУ МОДУЛЕЙ заказчика (Plane №348).

Заказчик описал персон тем, что видно в меню, и проверять будет тем же. Поэтому
пробы говорят его словами, а не «у роли столько-то прав»:

  1) учёток семь, у каждой есть портальная роль и роль раздела — иначе персона
     заведена наполовину и половину модулей не покажет вовсе;
  2) второй департамент отличается от остальных ровно тем, чем сказано:
     мероприятия ему открыты, прочим — нет;
  3) «Категории ОМ на уровне Организации» — это ВТОРОЙ грант с пустой областью,
     а не расширение первого: расширь первый — и статусы уедут на всю
     организацию вместе с мероприятиями;
  4) повтор команды не плодит учёток и приводит гранты к заданным.
"""
from datetime import date

import pytest
from django.contrib.auth.models import User
from django.core.management import call_command
from django.core.management.base import CommandError

from organization_management.apps.common.models import Role as PortalRole
from organization_management.apps.common.models import UserRole as PortalUserRole
from organization_management.apps.dictionaries.models import Position
from organization_management.apps.divisions.models import Division
from organization_management.apps.employees.models import Employee
from organization_management.apps.operations.models import UserRole as OpsUserRole
from organization_management.apps.operations.services import RoleAdminService
from organization_management.apps.staff_unit.models import StaffUnit

pytestmark = pytest.mark.django_db

PASSWORD = "матрица-доступа-31-08"


@pytest.fixture
def stand():
    """Два департамента с управлениями и людьми — минимум, на котором задание
    заказчика вообще выразимо: он делит персон на «второй департамент» и
    «любой другой»."""
    call_command("seed_operations")
    PortalRole.objects.create(code="ROLE_4", name="Администратор системы", requires_scope=False)

    position = Position.objects.create(name="Инспектор", code="am-insp", level=8)
    org = Division.objects.create(
        name="Служба", code="am-org", division_type=Division.DivisionType.ORGANIZATION
    )
    seq = 0
    for tag, name in (("first", "Первый департамент"), ("second", "Второй департамент")):
        department = Division.objects.create(
            name=name, code=f"am-{tag}",
            division_type=Division.DivisionType.DEPARTMENT, parent=org,
        )
        directorate = Division.objects.create(
            name="Первое управление", code=f"am-{tag}-dir",
            division_type=Division.DivisionType.DIRECTORATE, parent=department,
        )
        for _ in range(2):
            seq += 1
            employee = Employee.objects.create(
                personnel_number=f"am-{seq:03d}", last_name=f"Сотрудник{seq}",
                first_name="Имя", birth_date=date(1990, 1, 1), hire_date=date(2020, 1, 1),
            )
            StaffUnit.objects.create(
                division=directorate, position=position, index=seq, employee=employee
            )


def grants(username):
    user = User.objects.get(username=username)
    return {
        (row.role_code_id, row.scope_division_id)
        for row in OpsUserRole.objects.filter(user_id=str(user.pk), is_active=True)
    }


def modules(username):
    """Права, которые персона получает СУММОЙ своих грантов, без учёта области.

    Именно так их и видит меню: пункт либо есть, либо нет, а область решает,
    сколько строк под ним.
    """
    user = User.objects.get(username=username)
    return {
        code
        for row in OpsUserRole.objects.filter(user_id=str(user.pk), is_active=True)
        for code in RoleAdminService.role_permission_codes(row.role_code_id)
    }


def test_the_seven_accounts_are_complete(stand):
    call_command("seed_access_matrix", "--password", PASSWORD)

    usernames = set(
        User.objects.filter(username__startswith="acc_").values_list("username", flat=True)
    )
    assert usernames == {
        "acc_employee", "acc_dir_head", "acc_dir_head_d2", "acc_dept_head",
        "acc_dept_head_d2", "acc_forces_officer", "acc_admin",
    }
    for username in usernames:
        user = User.objects.get(username=username)
        assert PortalUserRole.objects.filter(user=user).exists(), (
            f"{username} без портальной роли не покажет ни «Обзор», ни «Статусы»"
        )
        assert grants(username), f"{username} без роли раздела не покажет ни один экран ОМ"
        assert user.check_password(PASSWORD)


def test_only_the_second_department_sees_the_events(stand):
    call_command("seed_access_matrix", "--password", PASSWORD)

    # Реестр ОМ, Командный центр и Транспорт ГОН — одно право на три модуля.
    for username in ("acc_dir_head_d2", "acc_dept_head_d2", "acc_admin"):
        assert "event.view" in modules(username) or "*" in modules(username)
    for username in ("acc_employee", "acc_dir_head", "acc_dept_head", "acc_forces_officer"):
        assert "event.view" not in modules(username), (
            f"{username} увидит Реестр ОМ, который заказчик назвал недоступным"
        )


def test_the_events_scope_is_the_whole_organisation_but_the_statuses_are_not(stand):
    call_command("seed_access_matrix", "--password", PASSWORD)

    directorate = Division.objects.get(code="am-second-dir")
    assert grants("acc_dir_head_d2") == {
        ("HEAD_OPS_UNIT", directorate.id),
        # Пустая область = вся организация: «Категории ОМ на уровне Организации».
        ("OM_CATEGORY_ORG", None),
    }


def test_the_system_section_is_closed_to_everyone_but_the_admin(stand):
    call_command("seed_access_matrix", "--password", PASSWORD)

    system = {"dictionary.view", "settings.view", "admin.roles", "audit.view"}
    for username in (
        "acc_employee", "acc_dir_head", "acc_dir_head_d2",
        "acc_dept_head", "acc_dept_head_d2", "acc_forces_officer",
    ):
        assert modules(username) & system == set(), f"{username} видит «Систему»"
    assert "*" in modules("acc_admin")


def test_a_repeat_run_neither_multiplies_nor_widens(stand):
    call_command("seed_access_matrix", "--password", PASSWORD)
    before = grants("acc_dept_head_d2")

    call_command("seed_access_matrix", "--password", PASSWORD)

    assert User.objects.filter(username__startswith="acc_").count() == 7
    assert grants("acc_dept_head_d2") == before


def test_a_missing_password_is_a_loud_refusal(stand, monkeypatch):
    monkeypatch.delenv("ACCESS_MATRIX_PASSWORD", raising=False)

    with pytest.raises(CommandError) as error:
        call_command("seed_access_matrix")

    assert "Пароль не задан" in str(error.value)
    assert not User.objects.filter(username__startswith="acc_").exists()
