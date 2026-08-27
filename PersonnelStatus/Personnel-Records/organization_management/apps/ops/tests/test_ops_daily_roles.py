"""Суточный расход ПО РОЛЯМ (сценарий заказчика, Plane №243).

ЗАЧЕМ ОТДЕЛЬНЫМ ФАЙЛОМ. Цепочку расхода легко пройти администратором: у него
«*», и любой гейт для него зелёный. Сценарий же описан РОЛЯМИ — начальник
управления, ответственный департамента, оперативный дежурный, — и вопрос не
«проходима ли цепочка», а «каждый ли делает СВОЁ и только своё».

Что стерегут пробы:
* начальник управления СОСТАВЛЯЕТ расход своего управления (до Plane №243 не
  мог: у роли не было `status.manage`, и ручка отвечала 403 — роль умела
  сдать день, но не заполнить его);
* чужого сотрудника он не трогает, чужой день не сдаёт;
* ответственный департамента и оперативный дежурный ЧИТАЮТ расход (тоже не
  могли: `status.view` у их ролей не было вовсе);
* область видимости решает, кто сколько видит: у дежурного вся организация, у
  начальника управления — его поддерево.
"""
import datetime as dt

import pytest

from organization_management.apps.divisions.models import Division
from organization_management.apps.operations.clock import Clock
# `client_for` со ОБЛАСТЬЮ и `make_employee` со штатным слотом — обычные
# функции соседнего файла проб, а не фикстуры: импортируются и зовутся.
from organization_management.apps.operations.tests.test_strength_report import (  # noqa: F401
    client_for,
    make_employee,
    seeded_catalog,  # фикстура справочника видов статусов — нужна расходу
)

pytestmark = pytest.mark.django_db

BULK = "/api/ops/daily/statuses-bulk/"
SUBMISSIONS = "/api/ops/daily/daily-submissions/"
DIVISIONS = "/api/ops/daily/divisions/"
STRENGTH = "/api/operations/strength-report/"

# Даты берутся от ЧАСОВ РАЗДЕЛА, а не зашиты числом: у сдачи дня есть окно
# («сегодня либо завтра», код отказа BUSINESS_DATE_OUT_OF_WINDOW), и
# зашитая дата рано или поздно выпадает из него — проба покраснела бы на
# календаре, а не на разграничении, которое стережёт.
TOMORROW = Clock.today_local() + dt.timedelta(days=1)
DAY_AFTER = TOMORROW + dt.timedelta(days=1)


@pytest.fixture
def structure():
    """Департамент с двумя управлениями и по человеку в каждом.

    Два управления обязательны: на одном «своё» неотличимо от «любое».
    """
    department = Division.objects.create(
        name="Первый департамент",
        code="DEP-PROBE",
        division_type=Division.DivisionType.DEPARTMENT,
    )
    mine = Division.objects.create(
        name="Первое управление",
        code="DIR-PROBE-1",
        division_type=Division.DivisionType.DIRECTORATE,
        parent=department,
    )
    other = Division.objects.create(
        name="Второе управление",
        code="DIR-PROBE-2",
        division_type=Division.DivisionType.DIRECTORATE,
        parent=department,
    )
    return department, mine, other


def _employee(division, last_name):
    """Человек В ПОДРАЗДЕЛЕНИИ.

    Связь идёт через ШТАТНЫЙ СЛОТ (`StaffUnit`), а не полем карточки: прямой
    ссылки «сотрудник → подразделение» у модели нет вовсе, и человек стоит в
    управлении ровно постольку, поскольку занимает там слот.
    """
    return make_employee(division, last_name=last_name)


def _row(employee, code="DUTY"):
    return {
        "employee_id": employee.pk,
        "status_type_code": code,
        "date_start": TOMORROW.isoformat(),
        # Интервал ПОЛУОТКРЫТЫЙ: date_end равный date_start сервер отбивает
        # как пустой, и «один день» — это завтра по послезавтра.
        "date_end": DAY_AFTER.isoformat(),
    }


def test_the_head_of_a_directorate_fills_tomorrow_for_his_own_people(
    seeded_catalog, structure
):
    """Начальник управления составляет расход своего управления.

    Красная на мутации: отними у роли `status.manage` (миграция 0056) — ручка
    ответит 403, и роль снова сможет сдать день, но не заполнить его.
    """
    _department, mine, _other = structure
    person = _employee(mine, "Токтаров")
    api, _ = client_for(
        "head-mine", "DIVISION_OPERATOR", perms=("status.view", "status.manage"),
        scope_division_id=mine.pk,
    )

    response = api.post(
        BULK,
        {"business_date": TOMORROW.isoformat(), "rows": [_row(person)]},
        format="json",
    )

    assert response.status_code == 201, response.data
    assert response.data["created"] == 1


def test_he_does_not_touch_a_person_from_another_directorate(seeded_catalog, structure):
    """Чужой сотрудник — отказ ПРАВА, а не молчаливый пропуск строки.

    Молча пропущенная строка означала бы, что расход соседа «как-то не
    заполнился», и искать причину человек пошёл бы в данные, а не в доступ.
    """
    _department, mine, other = structure
    stranger = _employee(other, "Абенов")
    api, _ = client_for(
        "head-mine-2", "DIVISION_OPERATOR", perms=("status.view", "status.manage"),
        scope_division_id=mine.pk,
    )

    response = api.post(
        BULK,
        {"business_date": TOMORROW.isoformat(), "rows": [_row(stranger)]},
        format="json",
    )

    assert response.status_code == 403
    # Форма отказа у ручек раздела — конверт с кодом; у DRF-гейта — `detail`.
    # Пробе важно, что названа ПРИЧИНА, а не какой конверт её принёс.
    body = response.data
    assert "PERMISSION_DENIED" in (
        body.get("detail") or body.get("error_code") or ""
    ), body


def test_he_submits_his_own_day_and_not_the_neighbours(seeded_catalog, structure):
    """Сдать можно СВОЁ управление; чужое — отказ с названной причиной."""
    _department, mine, other = structure
    api, _ = client_for(
        "head-submit", "DIVISION_OPERATOR",
        perms=("status.view", "status.manage", "daily_report.mark_update"),
        scope_division_id=mine.pk,
    )

    own = api.post(
        SUBMISSIONS,
        {"division_id": str(mine.pk), "business_date": TOMORROW.isoformat()},
        format="json",
    )
    foreign = api.post(
        SUBMISSIONS,
        {"division_id": str(other.pk), "business_date": TOMORROW.isoformat()},
        format="json",
    )

    assert own.status_code == 201, own.data
    assert foreign.status_code == 403
    assert foreign.data["error_code"] == "PERMISSION_DENIED"


def test_the_department_officer_reads_the_expense_of_his_department(
    seeded_catalog, structure
):
    """Ответственный департамента ЧИТАЕТ сдачи, но не проставляет статусы.

    Красная на мутации: отними у роли `status.view` (миграция 0056) — список
    сдач ответит 403, и сводить расход за департамент станет некому.
    """
    department, mine, _other = structure
    head, _ = client_for(
        "head-for-dep", "DIVISION_OPERATOR",
        perms=("status.view", "status.manage", "daily_report.mark_update"),
        scope_division_id=mine.pk,
    )
    head.post(
        SUBMISSIONS,
        {"division_id": str(mine.pk), "business_date": TOMORROW.isoformat()},
        format="json",
    )
    officer, _ = client_for(
        "dep-officer", "OMD", perms=("status.view",), scope_division_id=department.pk
    )

    listed = officer.get(f"{SUBMISSIONS}?business_date={TOMORROW.isoformat()}")
    person = _employee(mine, "Жаксылыков")
    writing = officer.post(
        BULK,
        {"business_date": TOMORROW.isoformat(), "rows": [_row(person)]},
        format="json",
    )

    assert listed.status_code == 200
    assert listed.data["count"] == 1
    # Читать — да, проставлять — нет: расход заполняет начальник управления.
    assert writing.status_code == 403


def test_the_duty_officer_sees_the_whole_organisation(seeded_catalog, structure):
    """Оперативный дежурный сводит расход ПО ВСЕЙ организации, а начальник
    управления — только по своему поддереву.

    Обе половины в одной пробе намеренно: «дежурный видит всё» без второй
    половины зелено и у сломанного разграничения.
    """
    _department, mine, _other = structure
    _employee(mine, "Оспанова")
    # Во ВТОРОМ управлении тоже есть человек: в отчёт попадают подразделения
    # со штатом, и без него «вся организация» свелась бы к одной строке — то
    # есть к тому же, что видит начальник управления, и сравнивать было бы
    # нечего.
    _employee(_other, "Байжанов")
    duty, _ = client_for("duty-officer", "ORGD", perms=("status.view",))
    head, _ = client_for(
        "head-scope", "DIVISION_OPERATOR", perms=("status.view",),
        scope_division_id=mine.pk,
    )

    whole = duty.get(f"{STRENGTH}?business_date={TOMORROW.isoformat()}")
    part = head.get(f"{STRENGTH}?business_date={TOMORROW.isoformat()}")

    assert whole.status_code == 200
    assert part.status_code == 200
    assert len(whole.data["rows"]) > len(part.data["rows"]), (
        "дежурный обязан видеть больше подразделений, чем начальник одного "
        "управления — иначе область видимости не разграничивает"
    )


# ── Раскладка прав по ролям (Plane №243) ────────────────────────────────────


@pytest.mark.parametrize(
    "role_code,permission_code,why",
    [
        (
            "DIVISION_OPERATOR",
            "status.manage",
            "начальник управления СОСТАВЛЯЕТ расход, а не только сдаёт его",
        ),
        (
            "OMD",
            "status.view",
            "ответственный департамента сводит расход за департамент",
        ),
        (
            "ORGD",
            "status.view",
            "оперативный дежурный сводит расход за всю организацию",
        ),
    ],
)
def test_the_role_carries_the_permission_its_job_needs(
    role_code, permission_code, why
):
    """Право есть У САМОЙ РОЛИ, а не выдано пробой.

    Пробы выше зовут `client_for(..., perms=...)` и раздают права сами — они
    стерегут ОБЛАСТЬ видимости, но к раскладке ролей равнодушны и остались бы
    зелёными, даже если роль лишить права вовсе. Эта проба смотрит в БД: там
    строки, которые кладёт миграция 0056, и именно они решают, сможет ли
    живой человек сделать свою работу.

    Справочник ролей наполняет `seed_operations` — его и зовём: на чистой
    базе миграция 0056 ничего не раздаёт (ролей ещё нет, и раздавать некому),
    она чинит УЖЕ РАБОТАЮЩИЕ стенды. Проверять надо оба пути, а сходятся они
    в одном месте — строках RolePermission.

    Красная на мутации: убери право из раскладки `seed_operations` — падает
    ровно эта проба.
    """
    from django.core.management import call_command

    from organization_management.apps.operations.models import RolePermission

    call_command("seed_operations", verbosity=0)

    granted = RolePermission.objects.filter(
        role_code_id=role_code, permission_code_id=permission_code
    ).exists()

    assert granted, f"у роли {role_code} нет права {permission_code}: {why}"
