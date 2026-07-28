"""QA-слой Story 10.10 — тесты фикстуры ``seed_e2e_expense_chain``.

**Зачем этот файл существует.** Живой сценарий цепочки
(``frontend/e2e-live/expense-chain-live.spec.ts``) запускается ТОЛЬКО вручную:
``npm run test:e2e:live`` требует docker, Postgres, uvicorn и браузер, не входит
ни в ``make gate``, ни в ``npm run gate``, а CI в проекте нет. Гниёт такой сьют
не сам по себе, а через ФИКСТУРУ: сид зависит от чужой семантики
(``strength_report``, ``expense_read_service``, ``day_submission_service``,
``ROLE_PERMISSIONS``), и любое изменение там ломает его молча. Эти тесты
переносят контракт фикстуры в ``make gate`` — сид ломается, краснеет гейт, а не
чей-то ручной прогон через месяц. Тот же довод, что у соседнего
``test_seed_e2e_lagging.py`` (11.6).

**Что проверяется — контракт, а не реализация.** Несущее утверждение сида:
«после меня один ADMIN-актор проходит bulk → сдачу → светофор → расход, на любом
по счёту прогоне и при любом времени суток». Каждый тест ниже закрывает ровно
одно звено, отсутствие которого валит цепочку МОЛЧА или НЕ НА ТОМ ШАГЕ:

* слот штата — единственное звено, чьё отсутствие видно только на ПОСЛЕДНЕМ шаге
  (422 ``REPORT_NOT_CONVERGENT``), когда три предыдущих уже зелёные;
* якорь горизонта данных — его отсутствие валит СВЕТОФОР, то есть шаг раньше
  того, о котором подумает автор теста;
* уборка на входе — её отсутствие видно только на ВТОРОМ прогоне (два 409);
* сброс singleton'а — протечка из ``seed_e2e_lagging`` в ту же БД ``vaps``.

**Почему обычный ``django_db``, а не ``transaction=True``.** Здесь проверяется
СОСТОЯНИЕ БД после сида, а не поведение ``on_commit``. Под rollback-транзакцией
мутация migration-seeded ``SubmissionControlSettings`` откатывается — ровно как
у ``test_seed_e2e_lagging.py``.

Данные сеются НАПРЯМУЮ: ``factory_boy`` в проекте нет и не заводится.
"""

import re
from datetime import date, datetime, timedelta
from io import StringIO
from zoneinfo import ZoneInfo

import pytest
from django.conf import settings
from django.core.management import call_command
from django.core.management.base import CommandError
from django.urls import reverse
from rest_framework.test import APIClient

from apps.core import clock
from apps.core.models import (
    Division,
    DivisionHistoricalSlot,
    Employee,
    EmployeeDivisionHistory,
)
from apps.core.selectors import local_midnight
from apps.documents.models import EXPENSE_DOC_TYPE, Attachment, IssuedDocument
from apps.migration_legacy.management.commands.seed_e2e_expense_chain import (
    DEFAULT_ACTOR,
    E2E_CHAIN_DIVISION_ID,
)
from apps.operations.rbac.models import UserRole
from apps.operations.statuses.models import EmployeeStatus, StatusType
from apps.operations.submissions.models import (
    DailySubmission,
    SubmissionControlSettings,
)
from apps.operations.submissions.services.expense_read_service import (
    assert_report_date_has_data,
    report_data_horizon,
)
from apps.operations.submissions.traffic_light import TrafficLightStatus

pytestmark = pytest.mark.django_db

DAY = date(2026, 7, 20)


def at(day, hour):
    """Aware момент внутри дня по СЕРВЕРНОЙ зоне (Asia/Qyzylorda)."""
    return datetime(
        day.year,
        day.month,
        day.day,
        hour,
        tzinfo=ZoneInfo(settings.VAPS_LOCAL_TIMEZONE),
    )


def run_seed(**options):
    out = StringIO()
    call_command("seed_e2e_expense_chain", stdout=out, **options)
    return out.getvalue()


def parsed(out):
    """Разбор машинно-читаемого вывода — тем же контрактом, что у спеки."""
    return {
        key: re.search(rf"^E2E_{key}=(.+)$", out, re.M).group(1)
        for key in ("DAY", "DIVISION", "ACTOR", "EMPLOYEES")
    }


def test_the_machine_readable_output_carries_the_whole_handoff():
    """Четыре строки вывода — ЕДИНСТВЕННЫЙ канал передачи в спеку.

    Спека не имеет права вычислять дату в JS (``new Date()`` и родня): браузер
    и сервер считают «сегодня» независимо, и в 00:0х по Кызылорде прогон молча
    уехал бы на сутки. Поэтому формат фиксируется тестом, а не соглашением.
    """
    with clock.override(at(DAY, 12)):
        values = parsed(run_seed())

    assert values["DAY"] == DAY.isoformat()
    assert re.fullmatch(r"\d{4}-\d{2}-\d{2}", values["DAY"])
    assert values["DIVISION"] == str(E2E_CHAIN_DIVISION_ID)
    assert values["ACTOR"] == "e2e-chain-operator"
    assert values["EMPLOYEES"] == "3"


def test_the_seeded_day_is_the_server_business_date_at_any_hour():
    """День берётся из ``Clock``, а не из UTC-календаря.

    В 00:00 по Asia/Qyzylorda (UTC+5) UTC-дата — ВЧЕРАШНЯЯ. Реализация,
    посчитавшая день через ``datetime.utcnow().date()``, прошла бы дневной
    прогон и молча уехала на сутки ночью. Это ровно тот класс, который в
    10.5/10.7/10.9 трижды оставлял сьюты зелёными на машине в +05
    ([[feedback_vaps_date_guard_needs_negative_tz]]).
    """
    for hour in (0, 23):
        with clock.override(at(DAY, hour)):
            values = parsed(run_seed())

        assert values["DAY"] == DAY.isoformat(), (
            f"в {hour}:00 по {settings.VAPS_LOCAL_TIMEZONE} сид напечатал "
            f"{values['DAY']!r} вместо {DAY.isoformat()!r} — день считается "
            "не через Clock"
        )


def test_a_cyrillic_actor_is_rejected_before_the_network():
    """Кириллица в ``--actor`` отклоняется идентифицирующим заголовком ещё до сети
    (находка 11.3). Валиться обязан сид, а не браузер «пустым экраном»."""
    with pytest.raises(CommandError, match="не ASCII"):
        run_seed(actor="оператор-цепочки")


def test_a_repeat_run_leaves_exactly_the_same_state():
    """Идемпотентность — уборка на ВХОДЕ (канон ``seed_e2e_lagging``).

    Без неё второй прогон подряд получает 409 ``DAY_ALREADY_SUBMITTED``
    (day_submission_service.py:143-151) и 409 ``DOCUMENT_ALREADY_ISSUED``
    (document_release_service.py:263-276), а AC-9 требует ровно двух прогонов.

    🔴 Проверяется не «не упало», а РАВЕНСТВО состояния: ``Organization.code``
    и ``Employee.iin`` unique, ``Division`` — ``UniqueConstraint(organization,
    code)``, и ни одна из этих таблиц в уборку не входит. Прямой ``create``
    вместо ``update_or_create`` дал бы здесь ``IntegrityError``.
    """
    with clock.override(at(DAY, 12)):
        first = parsed(run_seed())
        state_after_first = _state()

        second = parsed(run_seed())
        state_after_second = _state()

    assert first == second
    assert state_after_first == state_after_second


def _state():
    """Снимок наблюдаемого состояния фикстуры — для сверки двух прогонов."""
    return {
        "divisions": Division.objects.filter(id=E2E_CHAIN_DIVISION_ID).count(),
        "employees": Employee.objects.filter(division_id=E2E_CHAIN_DIVISION_ID).count(),
        "slots": DivisionHistoricalSlot.objects.filter(
            division_id=E2E_CHAIN_DIVISION_ID
        ).count(),
        "history": EmployeeDivisionHistory.objects.filter(
            division_id=E2E_CHAIN_DIVISION_ID
        ).count(),
        "roles": UserRole.objects.filter(user_id="e2e-chain-operator").count(),
    }


def test_the_staffing_slot_covers_the_day_and_stays_single_across_runs():
    """🔴 Звено, отсутствие которого валит ТОЛЬКО последний шаг цепочки.

    Без ``DivisionHistoricalSlot`` ``staff_map`` пуст → warning
    ``no_staffing_record`` (statuses/services/strength_report.py:174-179) → 422
    ``REPORT_NOT_CONVERGENT``, потому что выпуск отменяют И warnings, И
    violations (document_release_service.py:230-239). Bulk, сдача и светофор
    при этом проходят — половинчатая фикстура выглядит рабочей три шага из
    четырёх.

    ⚠️ У модели НЕТ ни одного unique-constraint: повторный ``create`` копил бы
    строки, и ``allocated_slots_on`` (BR-002) выбрал бы произвольную. Отсюда
    ассерт «после ДВУХ прогонов слот ровно один».
    """
    employees = 3
    with clock.override(at(DAY, 12)):
        run_seed(employees=employees)
        run_seed(employees=employees)

    slots = list(
        DivisionHistoricalSlot.objects.filter(division_id=E2E_CHAIN_DIVISION_ID)
    )
    assert len(slots) == 1, (
        f"после двух прогонов слотов {len(slots)}: уборка на входе не сносит "
        "DivisionHistoricalSlot, а unique-constraint у модели нет"
    )

    slot = slots[0]
    # Запас, а не равенство: violation `staff_lt_list` рождается при
    # allocated_slots < list_total (strength_report.py:187-197).
    assert slot.allocated_slots >= employees
    # BR-002: слот действует при valid_from <= T AND (valid_to IS NULL OR
    # valid_to > T) — core/selectors.py:243-266.
    assert slot.valid_from <= local_midnight(DAY)
    assert slot.valid_to is None


def test_the_data_horizon_is_non_empty_right_after_the_seed():
    """🔴 Якорь горизонта: без него светофор 422-ит ДО всякой сдачи.

    ``assert_report_date_has_data`` (expense_read_service.py:31-74) считает
    горизонт как ``min(earliest EmployeeStatus.date_start, earliest
    EmployeeDivisionHistory.starts_at)`` и при ``None`` БЕЗУСЛОВНО отдаёт 422
    ``REPORT_NO_DATA_FOR_DATE``. Вызывается И светофором
    (submissions/api/views.py:596), И выпуском расхода (:306).

    Сид стирает ``EmployeeStatus`` на входе → на свежей БД сразу после сида
    статусная половина горизонта ПУСТА. Держать горизонт обязана вторая
    половина — ``EmployeeDivisionHistory``. Без неё падает ШАГ 4 цепочки, а не
    шаг 7, и отладка уходит не туда.
    """
    with clock.override(at(DAY, 12)):
        run_seed()

    horizon = report_data_horizon()
    assert horizon is not None, (
        "горизонт данных пуст сразу после сида — EmployeeDivisionHistory не "
        "записан, светофор отдаст 422 REPORT_NO_DATA_FOR_DATE ещё до сдачи"
    )
    assert horizon <= DAY
    # Прямая проверка того, что зовут обе ручки цепочки.
    assert_report_date_has_data(business_date=DAY)


def test_the_history_anchor_puts_employees_in_the_division_on_the_day():
    """История — не только якорь горизонта, но и НАСТОЯЩИЙ путь ``roster_on``.

    Без покрывающего интервала состав берётся фолбэком BR-CORE-HISTORY-003 (по
    текущему ``Employee.division``), и цепочка проверяла бы фолбэк вместо
    штатного пути.
    """
    with clock.override(at(DAY, 12)):
        run_seed(employees=3)

    rows = EmployeeDivisionHistory.objects.filter(division_id=E2E_CHAIN_DIVISION_ID)
    assert rows.count() == 3
    for row in rows:
        assert row.starts_at <= local_midnight(DAY)
        assert row.ends_at is None


def test_the_actor_gets_a_global_admin_role():
    """Цепочка гейтится семью правами, и ни одна не-ADMIN роль их не покрывает
    (таблица AC-3). ``scope_division_id=NULL`` = глобальный скоуп."""
    with clock.override(at(DAY, 12)):
        run_seed()

    roles = list(UserRole.objects.filter(user_id="e2e-chain-operator"))
    assert len(roles) == 1
    assert roles[0].role_code_id == "ADMIN"
    assert roles[0].scope_division_id is None
    assert roles[0].is_active is True


def test_stale_roles_of_the_actor_do_not_survive_a_rerun():
    """🔴 НАХОДКА КРАСНОЙ ПРОБЫ №5, перенесённая в гейт.

    Первая редакция сида делала только ``update_or_create`` роли. Роли актора
    при этом НАКАПЛИВАЛИСЬ: мутация «выдать DIVISION_OPERATOR вместо ADMIN»
    оставляла живой прогон ЗЕЛЁНЫМ, потому что ADMIN-строка от предыдущего
    прогона никуда не девалась и права объединялись в полный набор. Проба,
    которую фикстура гасит собственной историей, — вакуумна.

    Здесь чужая роль заводится ЯВНО перед сидом: после сида у актора обязана
    остаться ровно одна строка, и это ADMIN. Иначе RBAC-состояние фикстуры —
    функция истории прогонов, а не аргументов команды.
    """
    UserRole.objects.create(
        user_id="e2e-chain-operator",
        role_code_id="DIVISION_OPERATOR",
        scope_division_id=None,
        is_active=True,
    )

    with clock.override(at(DAY, 12)):
        run_seed()

    roles = list(UserRole.objects.filter(user_id="e2e-chain-operator"))
    assert [role.role_code_id for role in roles] == ["ADMIN"], (
        "у актора остались посторонние роли — права объединятся, и любая "
        "проба на нехватку прав станет вакуумной"
    )


def test_the_multi_actor_roles_are_real_and_scoped_to_the_division():
    """Story 10.10a — два ДОПОЛНИТЕЛЬНЫХ актора, каждый со scoped-грантом на
    E2E_CHAIN_DIVISION_ID (не global, в отличие от ADMIN): реалистичный
    оператор/орг.дежурный видит СВОЁ подразделение, не всё дерево."""
    with clock.override(at(DAY, 12)):
        run_seed()

    operator_roles = list(UserRole.objects.filter(user_id="e2e-chain-operator-div"))
    assert len(operator_roles) == 1
    assert operator_roles[0].role_code_id == "DIVISION_OPERATOR"
    assert operator_roles[0].scope_division_id == E2E_CHAIN_DIVISION_ID
    assert operator_roles[0].is_active is True

    issuer_roles = list(UserRole.objects.filter(user_id="e2e-chain-issuer-orgd"))
    assert len(issuer_roles) == 1
    assert issuer_roles[0].role_code_id == "ORGD"
    assert issuer_roles[0].scope_division_id == E2E_CHAIN_DIVISION_ID
    assert issuer_roles[0].is_active is True


def test_stale_multi_actor_roles_do_not_survive_a_rerun():
    """Тот же класс пробы, что `test_stale_roles_of_the_actor_do_not_survive_a_rerun`
    (красная проба №5, 10.10), перенесённый на два новых актора 10.10a."""
    UserRole.objects.create(
        user_id="e2e-chain-operator-div",
        role_code_id="ADMIN",
        scope_division_id=None,
        is_active=True,
    )
    UserRole.objects.create(
        user_id="e2e-chain-issuer-orgd",
        role_code_id="ADMIN",
        scope_division_id=None,
        is_active=True,
    )

    with clock.override(at(DAY, 12)):
        run_seed()

    operator_roles = list(UserRole.objects.filter(user_id="e2e-chain-operator-div"))
    assert [role.role_code_id for role in operator_roles] == ["DIVISION_OPERATOR"]

    issuer_roles = list(UserRole.objects.filter(user_id="e2e-chain-issuer-orgd"))
    assert [role.role_code_id for role in issuer_roles] == ["ORGD"]


def test_the_multi_actor_roles_survive_a_second_seed_run():
    """Повторный прогон — ровно одна строка на каждого нового актора, не две
    (та же идемпотентность, что `test_a_repeat_run_leaves_exactly_the_same_state`)."""
    with clock.override(at(DAY, 12)):
        run_seed()
        run_seed()

    assert UserRole.objects.filter(user_id="e2e-chain-operator-div").count() == 1
    assert UserRole.objects.filter(user_id="e2e-chain-issuer-orgd").count() == 1


def test_the_multi_actor_output_carries_both_new_actors():
    """Story 10.10a AC-2 — команда печатает E2E_OPERATOR_ACTOR/E2E_ISSUER_ACTOR
    машинно-читаемо, тем же паттерном, что четыре существующие переменные."""
    with clock.override(at(DAY, 12)):
        out = run_seed()

    assert re.search(r"^E2E_OPERATOR_ACTOR=e2e-chain-operator-div$", out, re.MULTILINE)
    assert re.search(r"^E2E_ISSUER_ACTOR=e2e-chain-issuer-orgd$", out, re.MULTILINE)


def test_the_control_settings_leak_from_the_lagging_fixture_is_reset():
    """Защита от протечки singleton'а между живыми сьютами.

    ``seed_e2e_lagging`` (11.6) оставляет ``required_division_ids=[<его UUID>]``
    и ``control_hour=00:00`` в ТОЙ ЖЕ БД ``vaps``. Непустой список «необходимых
    управлений» даёт ``TOMORROW_BLOCKED`` на чужой несдаче, а нулевой
    контрольный час — вечное ``late=True``.

    Протечка воспроизводится НАСТОЯЩИМ соседним сидом, а не ручной записью:
    так тест ломается, если 11.6 сменит форму протечки.
    """
    call_command("seed_e2e_lagging", stdout=StringIO())
    leaked = SubmissionControlSettings.objects.get(singleton_key=1)
    assert leaked.required_division_ids, "предпосылка теста не воспроизвелась"

    with clock.override(at(DAY, 12)):
        run_seed()

    settings_row = SubmissionControlSettings.objects.get(singleton_key=1)
    assert settings_row.required_division_ids == []
    assert settings_row.control_hour.hour == 23


def test_an_oversized_employee_count_is_rejected_loudly():
    """Фикстура несёт ограниченный набор различимых ФИО — молча зациклиться на
    них значило бы получить ``IntegrityError`` по unique ``iin`` в середине."""
    with (
        pytest.raises(CommandError, match="различимых ФИО"),
        clock.override(at(DAY, 12)),
    ):
        run_seed(employees=99)


def test_the_division_is_a_childless_root():
    """Светофор катит статус ВВЕРХ по дереву (traffic_light.py:328): один
    несдавший потомок с непустым составом покрасил бы фикстурное подразделение
    RED, и «зелёный после сдачи» стал бы недостижим не по вине цепочки."""
    with clock.override(at(DAY, 12)):
        run_seed()

    division = Division.objects.get(id=E2E_CHAIN_DIVISION_ID)
    assert division.parent_id is None
    assert division.is_active is True
    assert not Division.objects.filter(parent_id=division.id).exists()


def test_the_roster_predicates_are_both_satisfied():
    """``roster_on``/``working_by_division`` фильтруют по ``employment_status=
    WORKING`` И ``is_active=True`` (core/selectors.py:221-226, :344-348) — оба
    предиката несущие, и ``hire_date`` обязан быть раньше дня."""
    with clock.override(at(DAY, 12)):
        run_seed(employees=3)

    employees = list(Employee.objects.filter(division_id=E2E_CHAIN_DIVISION_ID))
    assert len(employees) == 3
    for employee in employees:
        assert employee.employment_status == Employee.EmploymentStatus.WORKING
        assert employee.is_active is True
        assert employee.is_attached_force is False
        assert employee.hire_date < DAY
        assert re.fullmatch(r"\d{12}", employee.iin)
        # Ранг обязан резолвиться по справочнику seed_core: выдуманный код дал
        # бы пустое звание в снапшоте сдачи (denorm_for, selectors.py:194-217).
        assert employee.rank_code == "CPT"


def test_a_shrinking_roster_does_not_leave_orphans():
    """Смена ``--employees`` между прогонами не оставляет прошлый состав.

    Уборка ходит по ПОДРАЗДЕЛЕНИЮ, а не по фиксированному списку ИИН — иначе
    прогон с ``--employees 3`` после ``--employees 5`` оставил бы двух лишних
    в списочном составе, и сверка чисел AC-8.3 упала бы на ровном месте.
    """
    with clock.override(at(DAY, 12)):
        run_seed(employees=5)
        assert Employee.objects.filter(division_id=E2E_CHAIN_DIVISION_ID).count() == 5

        run_seed(employees=3)

    assert Employee.objects.filter(division_id=E2E_CHAIN_DIVISION_ID).count() == 3


def test_an_empty_roster_is_rejected_loudly():
    """``--employees 0``: подразделение с пустым составом светофор красит
    NEUTRAL (traffic_light.py:266-271), а не RED/GREEN — цепочка прошла бы «до
    конца», ничего не доказав. Отказ обязан быть громким, а не молчаливым
    зелёным прогоном ни о чём."""
    with (
        pytest.raises(CommandError, match="состав не может быть пустым"),
        clock.override(at(DAY, 12)),
    ):
        run_seed(employees=0)


def test_an_explicit_day_wins_over_the_clock():
    """``--day`` — часть контракта команды, и он ОБЯЗАН перебивать ``Clock``.

    Аргумент существует ради ручной отладки живого сьюта (прогнать цепочку на
    вчерашнем дне и посмотреть, где она встанет). Молча игнорируемый ``--day``
    дал бы отладку, которая «работает», проверяя совсем другой день.
    """
    explicit = DAY - timedelta(days=3)
    with clock.override(at(DAY, 12)):
        values = parsed(run_seed(day=explicit.isoformat()))

    assert values["DAY"] == explicit.isoformat()


def test_a_malformed_day_is_rejected_loudly():
    """Мусор в ``--day`` валится ``CommandError``, а не ``ValueError`` из
    середины сида: половина фикстуры уже была бы записана."""
    with (
        pytest.raises(CommandError, match="ожидается YYYY-MM-DD"),
        clock.override(at(DAY, 12)),
    ):
        run_seed(day="20.07.2026")


def test_the_status_code_the_live_spec_types_stays_usable():
    """🔴 КРОСС-ЯЗЫКОВОЙ ПИН: ``DUTY`` из живой спеки — не «любой не-дефолтный».

    ``frontend/e2e-live/expense-chain-live.spec.ts:52`` выбирает в гриде именно
    ``DUTY``, и выбор гейтится ТРЕМЯ запретами: ``IN_SERVICE`` (нулевая дельта —
    все строки стартуют в нём), ``ATTACHED`` (выпадает из ``list_total``,
    strength_report.py:167-172 → ломает сверку чисел AC-8.3), ``DETACHED``
    (делает сотрудника нередактируемым, FR-16 → 403 на следующем bulk'е).

    Живая спека не входит НИ В ОДИН гейт (``npm run gate`` и ``make gate``
    Playwright не запускают, ``npx playwright test`` смотрит только в ``e2e/``),
    поэтому переименование или деактивация ``DUTY`` в справочнике сгноила бы её
    молча — до чьего-то ручного прогона через месяц. Этот тест переносит выбор
    спеки в ``make gate``: справочник поехал — краснеет гейт.
    """
    call_command("seed_statuses", verbosity=0)

    duty = StatusType.objects.filter(code="DUTY").first()
    assert duty is not None, (
        "кода DUTY больше нет в справочнике, а живая спека цепочки печатает "
        "его в гриде (expense-chain-live.spec.ts:52) — она сгниёт молча"
    )
    assert duty.is_active is True
    assert duty.code != "IN_SERVICE"
    assert duty.counts_in_staff is True, (
        "DUTY перестал считаться в штате — сверка list_total == E2E_EMPLOYEES "
        "(AC-8.3) сломается, как сломал бы её ATTACHED"
    )
    assert duty.counts_in_list is True
    assert duty.restricts_editing is False, (
        "DUTY стал ограничивать редактирование, как DETACHED — повторный "
        "прогон живой спеки получит 403 на bulk'е"
    )


# ─────────────────────────────── ЦЕПОЧКА ЦЕЛИКОМ, СЕРВЕРНАЯ ПОЛОВИНА (QA-добор)
#
# 🔴 ЗАЧЕМ ЭТОТ БЛОК. Шапка файла объявляет несущее утверждение фикстуры:
# «после меня один ADMIN-актор проходит bulk → сдачу → светофор → расход, на
# любом по счёту прогоне». Тесты выше проверяют ЗВЕНЬЯ этого утверждения
# (слот есть, горизонт непуст, роль одна) — но САМО утверждение не проверял
# никто: единственный его потребитель, `frontend/e2e-live/
# expense-chain-live.spec.ts`, требует docker + браузер и запускается ТОЛЬКО
# руками. То есть ровно тот класс дыры, который QA-эвристика проекта называет
# первым: «цепочка целиком не гоняется — всё держится на фейках и звеньях».
#
# Здесь цепочка гоняется ТЕМИ ЖЕ ЧЕТЫРЬМЯ РУЧКАМИ, что кликает живая спека, но
# через APIClient — без docker, без браузера, внутри `make gate`. Браузерную
# половину (грид, сайдбар, событие скачивания, атрибуция зелёного) это не
# заменяет и не пытается: она остаётся за живой спекой. Заменяет оно другое —
# молчаливое гниение фикстуры и её уборки.


CHAIN_URL_TREE = "ops-traffic-light-tree"


@pytest.fixture
def chain_storage(settings, tmp_path):
    """Байты выпуска — во временный каталог, отдача — ``FileResponse``.

    ``VAPS_XACCEL_ENABLED=False`` здесь по той же причине, по которой стори
    добавляет ``VAPS_XACCEL_ENABLED: '0'`` в ``LIVE_ENV``: под дефолтной
    единицей ``AttachmentViewSet.download`` отвечает 200 с ПУСТЫМ телом и
    заголовком ``X-Accel-Redirect``, исполнять который здесь некому.
    """
    settings.VAPS_PRIVATE_STORAGE_ROOT = tmp_path
    settings.VAPS_XACCEL_ENABLED = False
    return tmp_path


def chain_client(actor=DEFAULT_ACTOR):
    """Тот же шов аутентификации, что у браузера: идентифицирующий заголовок."""
    client = APIClient()
    client.credentials(HTTP_X_USER_ID=actor)
    return client


def _tree_node(client, day):
    """Узел фикстурного подразделения в дереве готовности."""
    response = client.get(
        reverse(CHAIN_URL_TREE),
        {
            "root_division_id": str(E2E_CHAIN_DIVISION_ID),
            "business_date": day.isoformat(),
        },
    )
    assert response.status_code == 200, (
        f"дерево готовности отдало {response.status_code}: {response.data}"
    )
    nodes = {node["division_id"]: node for node in response.json()["nodes"]}
    assert str(E2E_CHAIN_DIVISION_ID) in nodes, (
        "фикстурного подразделения нет в дереве готовности — светофор "
        "показал бы пустой экран, а не цвет"
    )
    return nodes[str(E2E_CHAIN_DIVISION_ID)]


def walk_the_chain(client, day, employees_count):
    """Прогон цепочки ТЕМИ ЖЕ ручками и в ТОМ ЖЕ порядке, что живая спека.

    🔴 Порядок bulk → сдача → светофор несущий, а не стилистический: запись
    статусов ПОСЛЕ сдачи двигает победителя, и ``_diff_winners`` честно красит
    узел YELLOW (traffic_light.py:279-287). Зелёным заканчивается ровно один
    порядок.

    Возвращает тело выпуска — вызывающий вправе сверить номер исходящего.
    """
    employee_ids = list(
        Employee.objects.filter(division_id=E2E_CHAIN_DIVISION_ID)
        .order_by("iin")
        .values_list("id", flat=True)
    )
    assert len(employee_ids) == employees_count

    # ШАГ 1 — массовое обновление. Интервал полуоткрытый: один день = [D, D+1)
    # (ARCH-DATA-023), ровно как его собирает грид (DailyUpdatePage.tsx:272-275).
    bulk = client.post(
        reverse("ops-status-bulk"),
        {
            "business_date": day.isoformat(),
            "rows": [
                {
                    "employee_id": str(employee_ids[0]),
                    "status_type_code": "DUTY",
                    "date_start": day.isoformat(),
                    "date_end": (day + timedelta(days=1)).isoformat(),
                }
            ],
        },
        format="json",
    )
    assert bulk.status_code == 201, (
        f"массовое обновление отдало {bulk.status_code}: {bulk.data}"
    )
    assert bulk.data == {"created": 1}

    # ШАГ 2 — светофор ДО сдачи: RED, иначе «стало зелёным» нечем отличить от
    # «было зелёным» (AC-7а живой спеки, здесь тот же факт на сервере).
    before = _tree_node(client, day)
    assert before["status"] == TrafficLightStatus.RED, (
        f"до сдачи узел {before['status']}, а не RED — зелёный после сдачи "
        "перестанет что-либо доказывать"
    )

    # ШАГ 3 — сдача дня.
    submission = client.post(
        reverse("ops-daily-submission-list"),
        {"division_id": str(E2E_CHAIN_DIVISION_ID), "business_date": day.isoformat()},
        format="json",
    )
    assert submission.status_code == 201, (
        f"сдача дня отдала {submission.status_code}: {submission.data} — на "
        "втором прогоне это 409 DAY_ALREADY_SUBMITTED, то есть уборка сида "
        "не снесла прошлую сдачу"
    )

    # ШАГ 4 — светофор ПОСЛЕ сдачи: GREEN, и только он. YELLOW («расход
    # разошёлся») означал бы, что статусы легли не до сдачи.
    after = _tree_node(client, day)
    assert after["status"] == TrafficLightStatus.GREEN, (
        f"после сдачи узел {after['status']}, а не GREEN"
    )

    # ШАГ 5 — выпуск расхода. Здесь и только здесь всплывает отсутствие
    # DivisionHistoricalSlot: 422 REPORT_NOT_CONVERGENT при трёх зелёных шагах.
    issued = client.post(
        reverse("ops-expense-report-list"),
        {"division_id": str(E2E_CHAIN_DIVISION_ID), "business_date": day.isoformat()},
        format="json",
    )
    assert issued.status_code == 201, (
        f"выпуск расхода отдал {issued.status_code}: {issued.data} — 422 "
        "REPORT_NOT_CONVERGENT значит дыру в фикстуре (слот штата), 409 "
        "DOCUMENT_ALREADY_ISSUED — что уборка не снесла прошлый выпуск"
    )
    assert issued.data["doc_type"] == EXPENSE_DOC_TYPE

    # ШАГ 6 — скачивание. Ассертим БАЙТЫ, а не факт 200: пустое тело — ровно
    # тот отказ, который даёт X-Accel-Redirect без nginx.
    download = client.get(
        reverse(
            "documents-attachment-download",
            kwargs={"pk": str(issued.data["attachment_id"])},
        )
    )
    assert download.status_code == 200
    payload = b"".join(download.streaming_content)
    assert len(payload) > 0, "файл пустой — отдача ушла не по ветке FileResponse"
    # .docx это ZIP: локальная сигнатура заголовка — PK\x03\x04.
    assert payload[:4] == b"PK\x03\x04", f"первые байты {payload[:4]!r} — это не .docx"

    # ШАГ 7 — «числа сходятся»: тот же источник, что у живой спеки (JSON-
    # поверхности тела расхода в проекте нет — её адрес 10.7a).
    period = client.get(
        reverse("ops-expense-report-period"),
        {
            "division_id": str(E2E_CHAIN_DIVISION_ID),
            "date_from": day.isoformat(),
            "date_to": day.isoformat(),
        },
    )
    assert period.status_code == 200
    pages = period.data["pages"]
    assert len(pages) == 1, f"на однодневный диапазон пришло {len(pages)} страниц"
    assert pages[0]["totals"]["list_total"] == employees_count, (
        "списочный состав в источнике данных расхода разошёлся с засеянным"
    )
    return issued.data


def test_the_seeded_fixture_actually_carries_the_whole_chain(chain_storage):
    """🔴 НЕСУЩЕЕ УТВЕРЖДЕНИЕ ФИКСТУРЫ, проверенное целиком, а не по звеньям.

    Всё, что сид обещает, обещано ради ОДНОГО факта: после него актор проходит
    bulk → сдачу → светофор → расход и получает валидный файл. Звенья по
    отдельности уже закрыты тестами выше; здесь они собираются в цепочку —
    именно так, как их собирает живая спека, и именно тем актором и той датой,
    которые сид печатает в stdout.

    Что ловит этот тест и не ловят звеньевые: любую пару, которая по
    отдельности выглядит корректно, а вместе не сходится — роль без нужного
    права, слот с недостаточным запасом, день вне окна сдачи, состав, в
    котором `list_total` не равен `--employees`.
    """
    with clock.override(at(DAY, 12)):
        values = parsed(run_seed())
        day = date.fromisoformat(values["DAY"])
        employees = int(values["EMPLOYEES"])

        issued = walk_the_chain(chain_client(values["ACTOR"]), day, employees)

    # Имя файла собирается из дня и номера исходящего — той же формой, что
    # ассертит живая спека регуляркой (литеральный номер = красный второй
    # прогон: счётчик DocumentSequence сквозной и уборкой не сбрасывается).
    assert issued["business_date"] == day.isoformat()
    assert issued["number"] >= 1


def test_the_whole_chain_survives_a_second_seed(chain_storage):
    """🔴 ИДЕМПОТЕНТНОСТЬ, ДОКАЗАННАЯ ПОВТОРНЫМ ПРОХОДОМ, а не счётчиком строк.

    AC-9 требует прогнать живой сьют ДВАЖДЫ подряд. Проверить это счётчиками
    строк нельзя: тест «состояние после первого == после второго» ничего не
    говорит о таблицах, которые в первом прогоне ПУСТЫ. А пусты там ровно те
    четыре, ради которых уборка и написана — ``DailySubmission``,
    ``EmployeeStatus``, ``IssuedDocument``, ``Attachment``.

    Поэтому доказательство здесь — второй ПОЛНЫЙ проход цепочки. Убери из
    ``_cleanup`` любую из четырёх строк, и он покраснеет там, где отказ и
    случился бы вживую: 409 ``DAY_ALREADY_SUBMITTED``, 409
    ``DOCUMENT_ALREADY_ISSUED``, пересечение статусов на bulk'е.
    """
    with clock.override(at(DAY, 12)):
        first_values = parsed(run_seed())
        first = walk_the_chain(
            chain_client(first_values["ACTOR"]),
            date.fromisoformat(first_values["DAY"]),
            int(first_values["EMPLOYEES"]),
        )

        second_values = parsed(run_seed())
        second = walk_the_chain(
            chain_client(second_values["ACTOR"]),
            date.fromisoformat(second_values["DAY"]),
            int(second_values["EMPLOYEES"]),
        )

    assert first_values == second_values
    # Номер исходящего СКВОЗНОЙ: уборка его не сбрасывает и не должна. Отсюда
    # требование живой спеки ассертить имя файла регуляркой, а не литералом.
    assert second["number"] > first["number"], (
        "номер исходящего не вырос между прогонами — счётчик DocumentSequence "
        "кто-то сбросил, и ассерт имени файла регуляркой потерял смысл"
    )


def test_the_cleanup_wipes_exactly_the_tables_that_produce_409(chain_storage):
    """Прямой ассерт на четыре таблицы уборки — по следам полного прохода.

    Тест выше ловит их отсутствие поведением (409-и), этот — состоянием, и
    называет виновника поимённо, не заставляя читать error_code из ответа.
    """
    with clock.override(at(DAY, 12)):
        values = parsed(run_seed())
        walk_the_chain(
            chain_client(values["ACTOR"]),
            date.fromisoformat(values["DAY"]),
            int(values["EMPLOYEES"]),
        )

        employee_ids = list(
            Employee.objects.filter(division_id=E2E_CHAIN_DIVISION_ID).values_list(
                "id", flat=True
            )
        )
        assert DailySubmission.objects.filter(
            division_id=E2E_CHAIN_DIVISION_ID
        ).exists()
        assert EmployeeStatus.objects.filter(employee_id__in=employee_ids).exists()
        # Идентификаторы байтов снимаются ДО уборки: после неё выпусков нет, и
        # запрос «вложения удалённых выпусков» вернул бы пустоту при ЛЮБОЙ
        # реализации — ассерт был бы вакуумен by construction.
        attachment_ids = list(
            IssuedDocument.objects.filter(
                division_id=E2E_CHAIN_DIVISION_ID
            ).values_list("attachment_id", flat=True)
        )
        assert attachment_ids

        run_seed()

    assert not DailySubmission.objects.filter(
        division_id=E2E_CHAIN_DIVISION_ID
    ).exists(), (
        "сдача пережила уборку — второй прогон получит 409 DAY_ALREADY_SUBMITTED"
    )
    assert not EmployeeStatus.objects.filter(employee_id__in=employee_ids).exists(), (
        "статусы пережили уборку — bulk второго прогона даст пересечение"
    )
    assert not IssuedDocument.objects.filter(
        division_id=E2E_CHAIN_DIVISION_ID
    ).exists(), (
        "выпуск пережил уборку — второй прогон получит 409 DOCUMENT_ALREADY_ISSUED"
    )
    assert not Attachment.objects.filter(id__in=attachment_ids).exists(), (
        "байты выпуска пережили уборку: строка выпуска снесена, а Attachment "
        "нет — PROTECT не даст удалить её следующим прогоном"
    )


def test_the_cleanup_unwinds_a_superseding_document_chain():
    """🔴 ПОРЯДОК УБОРКИ НЕСУЩИЙ, и держится он на PROTECT, а не на вкусе.

    ``IssuedDocument.attachment`` — PROTECT, ``supersedes`` — self-PROTECT
    (documents/models.py:181-186). Уборка обязана снимать выпуски от НОВЫХ к
    старым и только потом трогать ``Attachment``; любой другой порядок даёт
    ``ProtectedError`` и валит сид целиком.

    Одиночный выпуск (его создаёт полный проход цепочки) эту ветку НЕ трогает:
    цепь ``supersedes`` появляется только после amendment'а. Поэтому она
    заводится здесь напрямую — иначе самый хрупкий инвариант уборки не
    исполнялся бы ни одним тестом.
    """
    with clock.override(at(DAY, 12)):
        run_seed()

    older = _issued_document(number=9001, status=IssuedDocument.Status.SUPERSEDED)
    _issued_document(
        number=9002,
        status=IssuedDocument.Status.ISSUED,
        supersedes=older,
        reason="исправление сдачи",
    )

    with clock.override(at(DAY, 12)):
        run_seed()  # ProtectedError здесь = порядок уборки сломан

    assert not IssuedDocument.objects.filter(division_id=E2E_CHAIN_DIVISION_ID).exists()


def _issued_document(*, number, status, supersedes=None, reason=""):
    """Выпуск с настоящим ``Attachment`` — минимальный валидный по DB-чекам."""
    attachment = Attachment.objects.create(
        original_name=f"расход_{DAY.isoformat()}_исх-{number}.docx",
        content_type=(
            "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
        ),
        size=1,
        sha256="0" * 64,
    )
    return IssuedDocument.objects.create(
        doc_type=EXPENSE_DOC_TYPE,
        number=number,
        year=DAY.year,
        business_date=DAY,
        division_id=E2E_CHAIN_DIVISION_ID,
        submission_id=1,
        submission_version=1,
        attachment=attachment,
        supersedes=supersedes,
        status=status,
        reason=reason,
    )
