"""Учётки закрытой сети на стенде (Plane №1202) — словами снимка заказчика.

  1) логины — те, что на снимке админки закрытой сети, плюс дежурный
     `o_sagynbek`; фамилия учётки — ярлык персоны, как на снимке;
  2) роли и области — ровно те же, что у персоны матрицы `acc_*`: второй
     правды о персонах команда не заводит;
  3) дежурный — `DUTY_OFFICER` на всю организацию, статусы не правит;
  4) единый пароль ставится всем, включая рабочие учётки стенда;
  5) повтор команды не плодит учёток и приводит гранты к заданным.
"""
from datetime import date

import pytest
from django.contrib.auth.models import User
from django.core.management import call_command
from django.core.management.base import CommandError

from organization_management.apps.dictionaries.models import Position
from organization_management.apps.divisions.models import Division
from organization_management.apps.employees.models import Employee
from organization_management.apps.operations.models import UserRole as OpsUserRole
from organization_management.apps.operations.services import RoleAdminService
from organization_management.apps.staff_unit.models import StaffUnit

pytestmark = pytest.mark.django_db

PASSWORD = "единый-пароль-закрытой-сети"

LAN_TO_MATRIX = {
    "y_talasbekov": "acc_employee",
    "n_meldebekov": "acc_dir_head",
    "k_baglanov": "acc_dir_head_d2",
    "a_esmagambetov": "acc_dept_head",
    "m_turmagambetov": "acc_dept_head_d2",
    "a_raiymzhanov": "acc_forces_officer",
    "u_musakhan": "acc_employee_d2",
    "y_meiram": "acc_ops_staff",
}


@pytest.fixture
def stand():
    call_command("seed_operations")
    position = Position.objects.create(name="Инспектор", code="lan-insp", level=8)
    org = Division.objects.create(
        name="Служба", code="lan-org", division_type=Division.DivisionType.ORGANIZATION
    )
    seq = 0
    for tag, name in (("first", "Первый департамент"), ("second", "Второй департамент")):
        department = Division.objects.create(
            name=name, code=f"lan-{tag}",
            division_type=Division.DivisionType.DEPARTMENT, parent=org,
        )
        directorate = Division.objects.create(
            name="Первое управление", code=f"lan-{tag}-dir",
            division_type=Division.DivisionType.DIRECTORATE, parent=department,
        )
        for _ in range(4):
            seq += 1
            employee = Employee.objects.create(
                personnel_number=f"lan-{seq:03d}", last_name=f"Сотрудник{seq}",
                first_name="Имя", birth_date=date(1990, 1, 1), hire_date=date(2020, 1, 1),
            )
            StaffUnit.objects.create(
                division=directorate, position=position, index=seq, employee=employee
            )
    for login in ("admin", "erda", "observer"):
        User.objects.create_user(username=login, password="старый")


def grants(username):
    user = User.objects.get(username=username)
    return {
        (row.role_code_id, row.scope_division_id)
        for row in OpsUserRole.objects.filter(user_id=str(user.pk), is_active=True)
    }


def test_the_password_is_required():
    with pytest.raises(CommandError):
        call_command("seed_lan_accounts")


def test_the_accounts_mirror_the_customer_screenshot(stand):
    call_command("seed_lan_accounts", "--password", PASSWORD)

    expected = set(LAN_TO_MATRIX) | {
        "acc_admin", "o_sagynbek", "a_rakhymzhanov", "d_levchenko",
    }
    assert expected <= set(User.objects.values_list("username", flat=True))
    for login in expected | {"admin", "erda", "observer"}:
        assert User.objects.get(username=login).check_password(PASSWORD), login
    assert User.objects.get(username="a_esmagambetov").last_name == "Начальник департамента (не второй)"
    assert User.objects.get(username="y_meiram").last_name == "Штаб второго департамента"
    assert User.objects.get(username="a_rakhymzhanov").last_name == ""
    assert grants("a_rakhymzhanov") == set(), "роль безымянной учётке заказчик не называл"


def test_roles_and_scopes_equal_the_matrix_personas(stand):
    call_command("seed_access_matrix", "--password", "матрица")
    call_command("seed_lan_accounts", "--password", PASSWORD)

    for lan, matrix in LAN_TO_MATRIX.items():
        assert grants(lan) == grants(matrix), f"{lan} разошёлся с {matrix}"
    assert grants("acc_admin") == {("ADMIN", None)}


def test_the_duty_officer_consolidates_but_does_not_edit_statuses(stand):
    call_command("seed_lan_accounts", "--password", PASSWORD)

    assert grants("o_sagynbek") == {("DUTY_OFFICER", None)}
    codes = set(RoleAdminService.role_permission_codes("DUTY_OFFICER"))
    assert "daily_report.generate" in codes
    assert "status.manage" not in codes, "дежурный статусы не правит (`[РАСХ-ПЛН-05]`)"


def test_the_line_heads_can_submit_the_day(stand):
    """Смысл поручения: начальник управления сдаёт день (Plane №1202)."""
    call_command("seed_lan_accounts", "--password", PASSWORD)

    for login in ("n_meldebekov", "k_baglanov"):
        codes = {
            code
            for role_code, _ in grants(login)
            for code in RoleAdminService.role_permission_codes(role_code)
        }
        assert "daily_report.mark_update" in codes, f"{login} не сможет нажать «Сдать день»"


def test_the_command_is_idempotent_and_reconciles_grants(stand):
    call_command("seed_lan_accounts", "--password", PASSWORD)
    before = User.objects.count()
    user = User.objects.get(username="y_talasbekov")
    RoleAdminService.assign_role(str(user.pk), "ADMIN", None, actor="test")

    call_command("seed_lan_accounts", "--password", PASSWORD)

    assert User.objects.count() == before
    assert ("ADMIN", None) not in grants("y_talasbekov"), "лишний грант не снят"
