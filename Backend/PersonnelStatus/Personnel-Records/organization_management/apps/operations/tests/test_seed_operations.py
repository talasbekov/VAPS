"""Сид ролей и прав раздела: что он заводит и КОМУ что достаётся.

Команда не гонялась ни одним тестом — 0% покрытия при 99% у остального
раздела. Это ровно тот класс, что дал два дефекта подряд: сид заводит мир, на
котором раздел работает в бою, а проверяют раздел на фикстурах, которые с сидом
расходятся (срез 137 — непомеченная заглушка, срез 138 — флаг ограничения).

Здесь два разных вида проверок, и путать их нельзя:

- МЕХАНИКА: сид идемпотентен, роль без прав не остаётся, право, выданное роли,
  существует. Это про команду и её можно чинить;
- ПОЛИТИКА: кому какое право досталось. Раскладка портирована из источника
  ДОСЛОВНО, менять её здесь я не вправе — но она обязана быть ВИДНОЙ.
  Закреплённая политика перестаёт быть случайностью: захочет кто-то её
  изменить — увидит, что меняет, и напишет почему.

САМОЕ ЗАМЕТНОЕ СЛЕДСТВИЕ РАСКЛАДКИ вынесено в отдельный тест: «Оператор
подразделения» НЕ имеет status.manage, то есть по сиду не может завести ни
одного статуса — только сдать и поправить день, собранный чужими руками.
Заводить статусы могут ADMIN (через «*») и INTEGRATION_USER. Так в источнике;
здесь это не приговор, а зафиксированный факт для того, кто будет решать.
"""
import pytest
from django.contrib.auth.models import User
from django.core.management import call_command
from django.core.management.base import CommandError

from organization_management.apps.operations.management.commands.seed_operations import (  # noqa: E501
    PERMISSIONS,
    ROLE_PERMISSIONS,
    ROLES,
)
from organization_management.apps.operations.models import (
    Permission,
    Role,
    RolePermission,
    UserRole,
)

pytestmark = pytest.mark.django_db


@pytest.fixture
def seeded():
    call_command("seed_operations")


def granted(role_code):
    return set(
        RolePermission.objects.filter(role_code_id=role_code).values_list(
            "permission_code_id", flat=True
        )
    )


def holders(permission_code):
    """Роли, которым право досталось НАПРЯМУЮ (без учёта «*»)."""
    return set(
        RolePermission.objects.filter(permission_code_id=permission_code).values_list(
            "role_code_id", flat=True
        )
    )


# ── Механика ─────────────────────────────────────────────────────────────


def test_the_seed_creates_the_whole_catalog(seeded):
    assert Permission.objects.count() == len(PERMISSIONS)
    assert Role.objects.count() == len(ROLES)


def test_the_seed_is_idempotent(seeded):
    """Сид гоняют при каждом развёртывании; второй прогон не должен ни
    задваивать строки, ни падать."""
    before = (
        Permission.objects.count(),
        Role.objects.count(),
        RolePermission.objects.count(),
    )

    call_command("seed_operations")

    assert (
        Permission.objects.count(),
        Role.objects.count(),
        RolePermission.objects.count(),
    ) == before


def test_the_seed_resyncs_a_renamed_permission(seeded):
    """Канон пересинхронизируется из кода: правка названия в справочнике не
    должна пережить следующий сид, иначе два стенда разъедутся подписями."""
    Permission.objects.filter(code="audit.view").update(name="Переименовано вручную")

    call_command("seed_operations")

    assert Permission.objects.get(code="audit.view").name == "Просмотр аудита"


def test_no_role_is_left_without_permissions(seeded):
    """Роль без единого права не даёт держателю НИЧЕГО, и завести её — то же,
    что забыть про неё. Такая роль в списке — почти всегда недописанная
    раскладка, а не решение."""
    empty = sorted(code for code, _ in ROLES if not granted(code))

    assert empty == []


def test_every_granted_permission_exists_in_the_catalog():
    """Опечатка в раскладке уронила бы сид ссылочной целостностью — но только
    при запуске, а запускали его в бою. Проверяется на данных команды, до
    всякой базы."""
    known = {code for code, _ in PERMISSIONS}
    unknown = sorted(
        {code for codes in ROLE_PERMISSIONS.values() for code in codes} - known
    )

    assert unknown == []


def test_every_role_in_the_layout_exists_in_the_catalog():
    known = {code for code, _ in ROLES}

    assert sorted(set(ROLE_PERMISSIONS) - known) == []


# ── Политика: кому что досталось ─────────────────────────────────────────


def test_the_write_permissions_have_exactly_these_holders(seeded):
    """Раскладка ЗАПИСИ закреплена буквально.

    Это три разных полномочия, и раздел различает их намеренно: завести статус,
    сдать день и переписать сданное — разные действия с разной ценой ошибки.
    """
    assert holders("status.manage") == {"INTEGRATION_USER"}
    assert holders("daily_report.mark_update") == {"DIVISION_OPERATOR"}
    assert holders("daily_report.correct") == {"DIVISION_OPERATOR"}
    assert holders("daily_report.override_block") == {"OMD", "ORGD"}
    assert holders("audit.view") == {"ORGD"}
    assert holders("admin.roles") == set()  # только через «*»


def test_the_division_operator_cannot_create_a_single_status(seeded):
    """САМОЕ ЗАМЕТНОЕ СЛЕДСТВИЕ РАСКЛАДКИ, и оно неочевидно.

    Роль называется «Оператор подразделения», но записи статусов у неё нет: она
    сдаёт и правит день, собранный чужими руками. Так в источнике — раскладка
    портирована дословно, — и тест не приговор, а зафиксированный факт: решать,
    верно ли это, не мне.

    Проверяется вместе с тем, ЧТО у роли есть, — иначе тест читался бы как «у
    неё нет прав вообще».
    """
    own = granted("DIVISION_OPERATOR")

    assert "status.manage" not in own
    assert "*" not in own
    assert {"daily_report.mark_update", "daily_report.correct", "status.view"} <= own


def test_only_the_admin_holds_the_wildcard(seeded):
    """«*» открывает всё, включая управление ролями. Вторая роль с ним
    означала бы вторую точку, из которой раздают полномочия."""
    assert holders("*") == {"ADMIN"}


def test_the_viewer_holds_nothing_that_writes(seeded):
    """Наблюдатель обязан оставаться наблюдателем: любое право записи у него —
    это уже не наблюдение."""
    writes = {
        "*",
        "status.manage",
        "daily_report.mark_update",
        "daily_report.correct",
        "daily_report.override_block",
        "admin.roles",
    }

    assert granted("VIEWER") & writes == set()


def test_every_permission_the_section_requires_is_seeded(seeded):
    """Право, которое код ТРЕБУЕТ, но сид не заводит, не может держать никто:
    гейт закрылся бы навсегда, а выглядело бы это как «нет доступа»."""
    from organization_management.apps.operations.api import views

    required = {
        views._READ_STATUS_PERMISSION,
        views._BULK_STATUS_PERMISSION,
        views._SUBMIT_DAY_PERMISSION,
        views._AMEND_DAY_PERMISSION,
        views._AUDIT_PERMISSION,
    }
    seeded_codes = set(Permission.objects.values_list("code", flat=True))

    assert required <= seeded_codes, sorted(required - seeded_codes)


# ── Назначение ролей учёткам ─────────────────────────────────────────────


def test_assign_gives_the_user_the_role(seeded):
    user = User.objects.create_user(username="operator", password="x")

    call_command("seed_operations", assign=[f"{user.username}:DIVISION_OPERATOR"])

    assignment = UserRole.objects.get(user_id=str(user.pk))
    assert assignment.role_code_id == "DIVISION_OPERATOR"
    assert assignment.scope_division_id is None


def test_assign_carries_the_scope(seeded):
    from organization_management.apps.divisions.models import Division

    user = User.objects.create_user(username="scoped", password="x")
    division = Division.objects.create(name="Управление 1")

    call_command(
        "seed_operations", assign=[f"{user.username}:DIVISION_OPERATOR:{division.id}"]
    )

    assert UserRole.objects.get(user_id=str(user.pk)).scope_division_id == division.id


def test_an_unknown_user_is_a_loud_refusal(seeded):
    """Молча пропустить назначение значило бы развернуть стенд, на котором
    никто ничего не может, и выяснить это уже при входе."""
    with pytest.raises(CommandError):
        call_command("seed_operations", assign=["нет-такого:ADMIN"])


@pytest.mark.parametrize("spec", ["одно", "a:b:c:d"])
def test_a_malformed_assignment_is_a_loud_refusal(seeded, spec):
    with pytest.raises(CommandError):
        call_command("seed_operations", assign=[spec])


def test_the_seed_without_assignments_grants_nobody(seeded):
    """Иначе тесты назначения не отличали бы «команда назначила» от «сид сам
    кому-то что-то выдал»."""
    assert UserRole.objects.count() == 0
