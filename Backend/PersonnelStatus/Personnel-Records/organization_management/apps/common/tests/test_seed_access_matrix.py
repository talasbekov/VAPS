"""Восемь учёток матрицы доступа — по СПИСКУ МОДУЛЕЙ заказчика (№348, №382).

Заказчик описал персон тем, что видно в меню, и проверять будет тем же. Поэтому
пробы говорят его словами, а не «у роли столько-то прав»:

  1) учёток восемь, у каждой есть роль РАЗДЕЛА — и НИ У ОДНОЙ нет портальной
     (Plane №352, Ш-5): система прав осталась одна, и выдача портальной роли
     означала бы учётку, заведённую по правилам, которых больше нет;
  2) второй департамент отличается от остальных ровно тем, чем сказано:
     мероприятия ему открыты, прочим — нет;
  3) «Категории ОМ на уровне Организации» — это ВТОРОЙ грант с пустой областью,
     а не расширение первого: расширь первый — и статусы уедут на всю
     организацию вместе с мероприятиями;
  4) повтор команды не плодит учёток и приводит гранты к заданным;
  5) «Обзор на уровне департамента» у начальника управления — это ВТОРОЙ грант
     с одним правом, а не расширение первого (Ш-5).
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

PASSWORD = "матрица-доступа-31-08"


@pytest.fixture
def stand():
    """Два департамента с управлениями и людьми — минимум, на котором задание
    заказчика вообще выразимо: он делит персон на «второй департамент» и
    «любой другой»."""
    call_command("seed_operations")
    # Портальных ролей фикстура больше не заводит: команда их не спрашивает
    # (Ш-5). Раньше здесь создавалась `ROLE_4` — без неё персона
    # «Администратор» падала на проверке справочника портальных ролей.

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


def test_the_eight_accounts_are_complete(stand):
    call_command("seed_access_matrix", "--password", PASSWORD)

    usernames = set(
        User.objects.filter(username__startswith="acc_").values_list("username", flat=True)
    )
    assert usernames == {
        "acc_employee", "acc_dir_head", "acc_dir_head_d2", "acc_dept_head",
        "acc_dept_head_d2", "acc_forces_officer", "acc_employee_d2", "acc_admin",
    }
    for username in usernames:
        user = User.objects.get(username=username)
        assert grants(username), f"{username} без роли раздела не покажет ни один экран ОМ"
        assert user.check_password(PASSWORD)


def test_the_portal_role_catalog_is_gone():
    """Портальной роли нет НЕ У ПЕРСОН, А В ПРОЕКТЕ ВООБЩЕ (Ш-6).

    До Ш-6 здесь стояло «персона не получила портальную роль»: модель ещё
    существовала, и выдать её было чем. Модели больше нет — утверждение о
    персонах стало тавтологией и ничего бы не стерегло. Стережём то, что
    осталось стеречь: возврат самой модели (а с ней и всей снятой системы)
    краснит эту пробу.
    """
    from django.apps import apps

    for model_name in ("Role", "Permission", "RolePermission", "UserRole"):
        with pytest.raises(LookupError):
            apps.get_model("common", model_name)


def test_only_the_second_department_sees_the_events(stand):
    call_command("seed_access_matrix", "--password", PASSWORD)

    # Реестр ОМ, Командный центр и Транспорт ГОН — одно право на три модуля.
    for username in (
        "acc_dir_head_d2", "acc_dept_head_d2", "acc_employee_d2", "acc_admin",
    ):
        assert "event.view" in modules(username) or "*" in modules(username)
    for username in ("acc_employee", "acc_dir_head", "acc_dept_head", "acc_forces_officer"):
        assert "event.view" not in modules(username), (
            f"{username} увидит Реестр ОМ, который заказчик назвал недоступным"
        )


def test_the_events_scope_is_the_whole_organisation_but_the_statuses_are_not(stand):
    call_command("seed_access_matrix", "--password", PASSWORD)

    directorate = Division.objects.get(code="am-second-dir")
    department = Division.objects.get(code="am-second")
    assert grants("acc_dir_head_d2") == {
        ("HEAD_OPS_UNIT", directorate.id),
        # Пустая область = вся организация: «Категории ОМ на уровне Организации».
        ("OM_CATEGORY_ORG", None),
        # Третья область — департамент, и только под «Обзор» (Ш-5).
        ("OVERVIEW_DEPARTMENT", department.id),
    }


def test_only_the_department_head_commands_the_placement_everywhere(stand):
    """Штабные обходы — у начальника ДЕПАРТАМЕНТА, и больше ни у кого (№601).

    Решение заказчика 06.09.2026. Профиль `HEAD_OPS_UNIT` носят ОБЕ персоны
    второго департамента, различаясь только областью гранта, а права
    `placement.command`, `gvo.manage` и `event.stage_override` область не
    спрашивают: они снимают проверку «своё ли это мероприятие». Пока они
    лежали в профиле, начальник УПРАВЛЕНИЯ расставлял людей по всей
    организации, хотя `[РАС-08]` отдаёт «всё» штабу.

    🔴 Проба спрашивает ГРАНТЫ, а не набор прав: расхождение было именно в
    том, кому роль досталась. Выдай `OPS_STAFF_COMMAND` второй персоне — и
    покраснеет вторая половина, а не первая.
    """
    call_command("seed_access_matrix", "--password", PASSWORD)

    department = Division.objects.get(code="am-second")
    assert grants("acc_dept_head_d2") == {
        ("HEAD_OPS_UNIT", department.id),
        ("OM_CATEGORY_ORG", None),
        # Область «вся организация» — ровно то, что право и означает.
        ("OPS_STAFF_COMMAND", None),
    }
    assert RoleAdminService.role_permission_codes("OPS_STAFF_COMMAND") == [
        "event.stage_override", "gvo.manage", "placement.command",
    ]
    assert not any(
        code == "OPS_STAFF_COMMAND" for code, _ in grants("acc_dir_head_d2")
    ), "начальник управления снова командует расстановкой по всей организации"


def test_the_system_section_is_closed_to_everyone_but_the_admin(stand):
    call_command("seed_access_matrix", "--password", PASSWORD)

    system = {"dictionary.view", "settings.view", "admin.roles", "audit.view"}
    for username in (
        "acc_employee", "acc_dir_head", "acc_dir_head_d2",
        "acc_dept_head", "acc_dept_head_d2", "acc_forces_officer",
        "acc_employee_d2",
    ):
        assert modules(username) & system == set(), f"{username} видит «Систему»"
    assert "*" in modules("acc_admin")


def test_the_overview_is_widened_by_a_second_grant_and_nothing_else(stand):
    """«Обзор на уровне департамента» — вторым грантом, с ОДНИМ правом.

    Заказчик про начальника управления: «остальные модули на уровне своего
    управления ЗА ИСКЛЮЧЕНИЕМ Обзор. Обзор на уровне департамента должно
    показываться». До Ш-5 это делал признак `overview_at_department` у
    портальной роли; роль снята, и без гранта «Обзор» молча схлопнулся бы до
    управления.

    🔴 Проба стережёт и ОБРАТНОЕ — что грант не расширил ничего сверх обзора.
    Допиши в роль `OVERVIEW_DEPARTMENT` второе право, и оно приедет на
    ДЕПАРТАМЕНТ вместе с ней: статусы, которые заказчик оставил на управлении,
    тихо разъедутся на весь департамент.
    """
    call_command("seed_access_matrix", "--password", PASSWORD)

    department = Division.objects.get(code="am-first")
    directorate = Division.objects.get(code="am-first-dir")
    assert grants("acc_dir_head") == {
        ("HEAD_DIRECTORATE_LINE", directorate.id),
        ("OVERVIEW_DEPARTMENT", department.id),
    }
    assert RoleAdminService.role_permission_codes("OVERVIEW_DEPARTMENT") == [
        "orgstructure.view"
    ]

    # У начальника ДЕПАРТАМЕНТА второго гранта нет: он и так работает на этом
    # уровне, и третья строка означала бы права сверх профиля.
    assert not any(
        code == "OVERVIEW_DEPARTMENT" for code, _ in grants("acc_dept_head_d2")
    )


def test_the_overview_of_the_second_department_stops_at_its_department(stand):
    """«Обзор» начальника управления второго департамента — департамент, а не
    вся служба (Plane №372).

    Заказчик про эту персону: «Категории ОМ на уровне Организации, остальное на
    уровне своего управления, за исключением Обзор — на уровне департамента».
    «Обзор» считается по области права `orgstructure.view`, и роль-добавка
    `OM_CATEGORY_ORG` выдаётся с областью «вся организация»: пока она несла это
    право, третий грант перебивал второй, и человек видел всю службу — 442
    штатные единицы вместо 197 (замер по стенду 31.08.2026).

    Проба спрашивает ОБЛАСТЬ, а не набор прав: расхождение было именно в ней.
    """
    from organization_management.apps.operations.services import PermissionService

    call_command("seed_access_matrix", "--password", PASSWORD)
    user = User.objects.get(username="acc_dir_head_d2")
    department = Division.objects.get(code="am-second")
    directorate = Division.objects.get(code="am-second-dir")

    visible = PermissionService.visible_division_ids(str(user.pk), "orgstructure.view")

    # None означало бы «видит всё дерево» — ровно та широта, из-за которой
    # заведена карточка.
    assert visible is not None, "«Обзор» открыт на всю организацию"
    assert department.id in visible and directorate.id in visible
    assert Division.objects.get(code="am-first").id not in visible
    # Мероприятия при этом остаются на всей организации: их область даёт то же
    # роль-добавка, и починка не должна была её сузить.
    assert PermissionService.visible_division_ids(str(user.pk), "event.view") is None


def test_a_repeat_run_neither_multiplies_nor_widens(stand):
    call_command("seed_access_matrix", "--password", PASSWORD)
    before = grants("acc_dept_head_d2")

    call_command("seed_access_matrix", "--password", PASSWORD)

    assert User.objects.filter(username__startswith="acc_").count() == 8
    assert grants("acc_dept_head_d2") == before


def test_a_missing_password_is_a_loud_refusal(stand, monkeypatch):
    monkeypatch.delenv("ACCESS_MATRIX_PASSWORD", raising=False)

    with pytest.raises(CommandError) as error:
        call_command("seed_access_matrix")

    assert "Пароль не задан" in str(error.value)
    assert not User.objects.filter(username__startswith="acc_").exists()
