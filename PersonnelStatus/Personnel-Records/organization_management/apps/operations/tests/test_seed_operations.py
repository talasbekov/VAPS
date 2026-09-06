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
    # `status.manage` держат ДВОЕ с 28.08.2026 (Plane №243): интеграционная
    # учётка и начальник управления. Второго добавил СЦЕНАРИЙ ЗАКАЗЧИКА,
    # дословно: «начальники управления ежедневно составляют за день вперёд
    # расход по личному составу своего управления… каждому сотруднику
    # проставляют статусы». До этого роль умела сдать день, но не заполнить
    # его: ручка расхода отвечала ей 403 (проверено на живом стенде).
    # РАСКЛАДКА ПЕРЕПИСАНА 28.08.2026 под принятую заказчиком модель ролей
    # (Plane №266/№267): роли названы должностями, а не словами старой
    # системы. Прежние держатели — DIVISION_OPERATOR, OMD, ORGD — переехали в
    # DIRECTORATE_HEAD, DEPARTMENT_EXPENSE_OFFICER и DUTY_OFFICER; пин
    # обновлён вместе с ними, а не подогнан под вывод.
    # ДЕРЖАТЕЛЕЙ СТАЛО ПЯТЬ 31.08.2026 (Plane №348). Заказчик описал профили
    # руководителей, и у каждого статусы своего подразделения правятся: это и
    # есть его слова «остальные модули на уровне своего управления». Пин
    # расширен ПОИМЕННО, а не ослаблен до `>=`: список держателей записи —
    # ровно то место, где лишняя роль обязана быть замечена.
    assert holders("status.manage") == {
        "INTEGRATION_USER",
        "DIRECTORATE_HEAD",
        "HEAD_DIRECTORATE_LINE",
        "HEAD_DEPARTMENT_LINE",
        "HEAD_OPS_UNIT",
    }
    assert holders("daily_report.mark_update") == {"DIRECTORATE_HEAD"}
    assert holders("daily_report.correct") == {"DIRECTORATE_HEAD"}
    assert holders("daily_report.override_block") == {"DUTY_OFFICER"}
    assert holders("audit.view") == {"SECURITY_ADMIN", "AUDITOR"}
    # Раздача ролей — у своей роли, а не только через «*»: это и есть смысл
    # SECURITY_ADMIN.
    assert holders("admin.roles") == {"SECURITY_ADMIN"}
    # Решение согласующего разведено с ведением мероприятия (решение
    # заказчика №267): подпись и возврат держит утверждающий — и, с №401
    # (`[СОГ-12]`), штаб второго департамента: спецификация называет
    # согласующими `acc_dept_head_d2` / `acc_dir_head_d2`, обе персоны носят
    # `HEAD_OPS_UNIT`. Пин поднят осознанно; `event.manage` у штаба по-прежнему
    # нет — подписывающий расстановку не правит.
    assert holders("assignment.approve") == {"EVENT_APPROVER", "HEAD_OPS_UNIT"}
    assert holders("assignment.return") == {"EVENT_APPROVER", "HEAD_OPS_UNIT"}
    assert holders("event.manage") == {"EVENT_OFFICER"}
    # Заведение карточки ОМ и заполнение бюллетеня — СВОИ права (Plane №382).
    # Держателей по двое, и это ровно смысл разделения: ведущий мероприятие
    # умеет то же, что вчера, а рядовой сотрудник второго департамента умеет
    # ТОЛЬКО завести и заполнить бюллетень. Вернуть `event.manage` восьмой
    # персоне — значит покраснить эту строку и следующую пробу.
    # …и штаб второго департамента (`[БЛН-10]`, Plane №421) — пин поднят
    # осознанно: спецификация называет создателями бюллетеня `acc_employee_d2`,
    # штаб и админа.
    assert holders("event.create") == {"EVENT_OFFICER", "EMPLOYEE_OPS_D2", "HEAD_OPS_UNIT"}
    assert holders("event.bulletin") == {"EVENT_OFFICER", "EMPLOYEE_OPS_D2", "HEAD_OPS_UNIT"}
    # Расстановка на любом объекте — только штаб (`[РАС-08]`, №421), и с
    # №601 (решение заказчика 06.09.2026) «штаб» это РОЛЬ-ДОБАВКА, а не
    # профиль второго департамента. Профиль носят обе персоны — начальник
    # департамента и начальник его управления, — а это право область гранта
    # не спрашивает вовсе: пока оно лежало в профиле, начальник управления
    # командовал расстановкой по всей организации. Пин перенацелен на новую
    # роль осознанно и стережёт ОБЕ стороны переезда: право появилось у
    # добавки И пропало у профиля.
    assert holders("placement.command") == {"OPS_STAFF_COMMAND"}
    # Два соседних обхода уехали туда же и той же причиной. `gvo.manage`
    # остаётся и у `GVO_LEAD`: старший ГВО правит сводку СВОЕГО мероприятия.
    assert holders("gvo.manage") == {"GVO_LEAD", "OPS_STAFF_COMMAND"}
    assert holders("event.stage_override") == {"OPS_STAFF_COMMAND"}
    # Персональная детализация и выгрузка со скрытыми полями — «пока только
    # администратор» (решение №267), то есть ни одной роли, кроме «*».
    assert holders("analytics.personal_detail") == set()
    assert holders("report.export_sensitive") == set()


def test_the_directorate_head_fills_the_day_and_submits_it(seeded):
    """Роль «Оператор подразделения» ведёт день ЦЕЛИКОМ: заполняет и сдаёт.

    ИСТОРИЯ ПИНА, чтобы правку не приняли за подгон. Раскладка была
    портирована из источника дословно, и записи статусов у роли не было: она
    сдавала день, собранный чужими руками. Тут же стоял тест
    `..._cannot_create_a_single_status` с оговоркой «решать, верно ли это, не
    мне». 28.08.2026 заказчик решил — сценарием, дословно: «начальники
    управления ежедневно составляют за день вперёд расход по личному составу
    своего управления (здесь начальники управления каждому сотруднику
    проставляют статусы) и отправляют ответственному сотруднику».

    Отсюда `status.manage` у роли (Plane №243, миграция 0056). Прежний тест не
    удалён, а ПЕРЕВЁРНУТ: удалённый пин молча теряет и вопрос, и ответ.

    «*» роли по-прежнему не полагается: составлять расход своего управления —
    не то же самое, что мочь всё.
    """
    own = granted("DIRECTORATE_HEAD")

    assert "status.manage" in own
    assert "*" not in own
    assert {"daily_report.mark_update", "daily_report.correct", "status.view"} <= own


def test_the_customer_profiles_see_exactly_the_modules_he_named(seeded):
    """Семь профилей Plane №348 — по СПИСКУ МОДУЛЕЙ, а не по списку прав.

    Заказчик описывал роли тем, что видно в меню, и проверять будет тем же.
    Поэтому проба говорит его словами: три модуля — Реестр ОМ, Командный центр
    и Транспорт ГОН — закрыты ОДНИМ правом `event.view`, и в описании они
    перечислены всегда вместе. Если кто-то вернёт `event.view` в общий набор
    чтения, начальник управления линейного департамента увидит Реестр ОМ —
    ровно то, что заказчик назвал недоступным.
    """
    # Реестр ОМ / Командный центр / Транспорт ГОН — только у второго департамента.
    assert "event.view" not in granted("HEAD_DIRECTORATE_LINE")
    assert "event.view" not in granted("HEAD_DEPARTMENT_LINE")
    assert "event.view" not in granted("FORCES_GATHERING_OFFICER")
    assert "event.view" in granted("HEAD_OPS_UNIT")

    # Аналитика службы: нет у начальника управления и у второго департамента,
    # есть у начальника линейного департамента и у ответственного за сбор сил.
    assert "analytics.view" not in granted("HEAD_DIRECTORATE_LINE")
    assert "analytics.view" not in granted("HEAD_OPS_UNIT")
    assert {"analytics.view"} <= granted("HEAD_DEPARTMENT_LINE")
    assert {"analytics.view"} <= granted("FORCES_GATHERING_OFFICER")

    # Отчёты по ОМ (`report.generate`) — только у второго департамента.
    assert holders("report.generate") >= {"HEAD_OPS_UNIT"}
    assert "report.generate" not in granted("HEAD_DIRECTORATE_LINE")
    assert "report.generate" not in granted("HEAD_DEPARTMENT_LINE")
    assert "report.generate" not in granted("FORCES_GATHERING_OFFICER")

    # Сбор сил ведёт ровно один из семи профилей.
    assert "forces.command" in granted("FORCES_GATHERING_OFFICER")
    for code in ("HEAD_DIRECTORATE_LINE", "HEAD_DEPARTMENT_LINE", "HEAD_OPS_UNIT"):
        assert not {"forces.command", "forces.allocate", "forces.select"} & granted(code)

    # «Система» закрыта у всех шести неадминистраторских профилей.
    system = {"dictionary.view", "settings.view", "admin.roles", "audit.view"}
    for code in (
        "EMPLOYEE",
        "HEAD_DIRECTORATE_LINE",
        "HEAD_DEPARTMENT_LINE",
        "HEAD_OPS_UNIT",
        "FORCES_GATHERING_OFFICER",
    ):
        assert system & granted(code) == set()


def test_the_second_department_employee_reads_everything_and_writes_a_bulletin(seeded):
    """Восьмая персона (Plane №382) — словами заказчика, а не списком прав.

    «Права обычного сотрудника и еще все что касается ОМ тоже видны, но без
    возможности редактирования или удаление. Но у него должна быть возможность
    создавать бюллетень.»

    Проба стережёт обе половины требования сразу: расширение набора чтением
    она пропустит, а появление ЛЮБОГО права записи мероприятия — нет.
    """
    codes = granted("EMPLOYEE_OPS_D2")

    # Раздел ОМ виден целиком: реестр и командный центр, каталоги, аналитика
    # ОМ, отчёты по ОМ, объекты.
    assert {
        "event.view", "catalog.view", "analytics.operations",
        "report.generate", "object.view",
    } <= codes
    # Права обычного сотрудника — на месте.
    assert {"status.view", "document.view", "feedback.view", "feedback.create"} <= codes
    # Бюллетень — единственное, что персона пишет.
    assert {"event.create", "event.bulletin"} <= codes

    # 🔴 НИ ОДНОГО ПРАВА ПРАВКИ. Список поимённый, а не «нет event.manage»:
    # заказчик запретил редактирование и удаление целиком, и любое из этих
    # прав вернуло бы их с другой стороны.
    assert not codes & {
        "event.manage", "event.delete", "event.stage_override", "gvo.manage",
        # `placement.command` рядом с `placement.manage` (Plane №603): пин был
        # поимённым, а более СИЛЬНОЕ право (расстановка на любом объекте, а не
        # только на своём) в перечне отсутствовало.
        # 🔴 ОБОСНОВАНИЕ БЫЛО СИЛЬНЕЕ ФАКТА (уточнено ревью №825). Здесь
        # стояло «выдача его этой персоне оставила бы весь набор зелёным» —
        # неправда: пин держателей выше (`holders("placement.command") ==
        # {"HEAD_OPS_UNIT"}`) покраснел бы от любой выдачи. Правда скромнее и
        # всё равно стоит правки: сторож был ОДИН, а теперь мутация «выдать
        # `placement.command` персоне `EMPLOYEE_OPS_D2`» краснит две пробы —
        # и ту, что перечисляет держателей, и эту, что читает набор персоны.
        "placement.manage", "placement.command",
        "assignment.approve", "assignment.return",
        "status.manage", "object.manage", "orgstructure.manage",
        "forces.command", "forces.allocate", "forces.select",
    }
    # Обзор и кадровый реестр персоне не открываются: она рядовой сотрудник,
    # и у профиля `EMPLOYEE` их тоже нет.
    assert not codes & {"orgstructure.view", "personnel.view"}
    # «Система» закрыта, как и у семи прежних профилей.
    assert not codes & {"dictionary.view", "settings.view", "admin.roles", "audit.view"}


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


def test_reading_the_section_is_wide_and_leading_it_is_narrow(seeded):
    """Единственная сеяная персона, на которой видно, что гейты раздела ОМ
    работают.

    У ADMIN «*» проходит любую проверку, у остальных ролей не проходит ни
    одна — обе крайности одинаково зелены и при сломанном RBAC (так и было,
    пока права рисовал мок с wildcard, см. docs/api-gaps.md §9-12). Отличает
    рабочий гейт от отсутствующего только частичная раскладка: объекты и план
    дежурств есть, реестр ОМ — нет.

    Пустой `holders("event.view")` держит вторую половину утверждения: право
    на реестр ОМ не досталось никому напрямую, поэтому «закрыто» на этой
    персоне — не совпадение раскладки.
    """
    # OPS_READER СНЯТ 28.08.2026: он заводился временной персоной, «на которой
    # видно, что гейты раздела работают», и его место заняли базовые чтения
    # рабочих ролей. Утверждение про гейты держится теперь на настоящих
    # ролях: чтение раздела есть у многих, а ведение — ровно у одной.
    assert holders("event.view") >= {"EVENT_OFFICER", "PATROL_LEAD", "AUDITOR"}
    assert "EMPLOYEE" not in holders("event.view")


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

    call_command("seed_operations", assign=[f"{user.username}:DIRECTORATE_HEAD"])

    assignment = UserRole.objects.get(user_id=str(user.pk))
    assert assignment.role_code_id == "DIRECTORATE_HEAD"
    assert assignment.scope_division_id is None


def test_assign_carries_the_scope(seeded):
    from organization_management.apps.divisions.models import Division

    user = User.objects.create_user(username="scoped", password="x")
    division = Division.objects.create(name="Управление 1")

    call_command(
        "seed_operations", assign=[f"{user.username}:DIRECTORATE_HEAD:{division.id}"]
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
