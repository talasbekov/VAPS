"""Процесс 1 «Ежедневный расход» ЦЕЛИКОМ, ролями (Plane №259, Ш-3).

ЗАЧЕМ ОТДЕЛЬНЫМ ФАЙЛОМ. Соседний `test_ops_daily_roles` стережёт РАЗГРАНИЧЕНИЕ:
кто что может и чего не может. Здесь проверяется другое — что четыре шага
заказчика складываются в ОДНУ работающую цепочку:

  1. начальник управления ставит статусы на завтра, среди них «Участие на ОМ»
     с делением на боевую группу и физический наряд;
  2. отправляет расход — сдаёт день своего управления;
  3. ответственный по департаменту сводит управления в расход департамента;
  4. оперативный дежурный сводит департаменты в расход организации.

Каждый шаг делает СВОЯ роль. Пройти цепочку админом («*») бессмысленно: у него
проходит любой гейт, и такая проба зеленела бы даже на сломанных правах —
ровно то, что и обнаружилось заходом №243, когда начальник управления не мог
заполнить свой же расход.

🔴 Проба стережёт ещё и СВЯЗЬ ЭШЕЛОНОВ, а не только «каждый шаг ответил 201»:
сводка департамента обязана ссылаться на сдачу управления (пины `sources`), а
сводка организации — на сводку департамента. Без этого «сводка» была бы просто
четвёртой независимой сдачей, и число в ней ничего не говорило бы о детях.
"""
import datetime as dt

import pytest

from organization_management.apps.divisions.models import Division
from organization_management.apps.operations.clock import Clock
from organization_management.apps.operations.models_submission import (
    OpsDailySubmission,
)
from organization_management.apps.operations.tests.test_strength_report import (  # noqa: F401
    client_for,
    make_employee,
    seeded_catalog,
)

pytestmark = pytest.mark.django_db

BULK = "/api/ops/daily/statuses-bulk/"
SUBMISSIONS = "/api/ops/daily/daily-submissions/"
SUMMARIES = "/api/operations/daily-summaries/"

TOMORROW = Clock.today_local() + dt.timedelta(days=1)
DAY_AFTER = TOMORROW + dt.timedelta(days=1)

#: Чем начальник управления наполняет день в этой пробе. ДВА ОБЫЧНЫХ КОДА, а
#: не виды участия в ОМ, и это правка по существу, а не подгон под новый вывод
#: (Plane №663).
#:
#: Раньше здесь стояли `EVENT_ASSIGNMENT` и `EVENT_ASSIGNMENT_GROUP` — оба
#: погашены слиянием №486 (миграция 0091, `is_active=False`), и проба заводила
#: их себе сама: цепочка проверялась на статусах, которых в живой системе
#: больше нет. С №663 их наследник `IN_EVENT` пачкой не ставится вовсе —
#: ручное участие обязано называть мероприятие (№737), а массовый путь участий
#: не принимает. Предмет пробы — ЧЕТЫРЕ РОЛИ И ЭШЕЛОН СВОДОК, а не вид статуса:
#: чем наполнен день, ей безразлично. Сам запрет закреплён отдельной пробой
#: ниже — он не потерян, а назван вслух.
FIRST_CODE = "DUTY"
SECOND_CODE = "VACATION"
#: Слитый код участия (№486) — им проверяется отказ массового пути.
IN_EVENT = "IN_EVENT"


@pytest.fixture
def org():
    """Организация → департамент → два управления, по человеку в каждом.

    Два управления обязательны: сводка департамента, собранная из ОДНОГО
    ребёнка, неотличима от сдачи самого ребёнка.
    """
    organization = Division.objects.create(
        name="Организация",
        code="ORG-CHAIN",
        division_type=Division.DivisionType.ORGANIZATION,
    )
    department = Division.objects.create(
        name="Департамент 2",
        code="DEP-CHAIN",
        division_type=Division.DivisionType.DEPARTMENT,
        parent=organization,
    )
    first = Division.objects.create(
        name="Первое управление",
        code="DIR-CHAIN-1",
        division_type=Division.DivisionType.DIRECTORATE,
        parent=department,
    )
    second = Division.objects.create(
        name="Второе управление",
        code="DIR-CHAIN-2",
        division_type=Division.DivisionType.DIRECTORATE,
        parent=department,
    )
    return organization, department, first, second


def _pins(submission_id):
    """Пины сводки: [{division_id, submission_id, version}].

    Пин — не ссылка «посмотреть сейчас», а заявление «я собрана ИЗ ВОТ ЭТИХ
    версий»; именно он и отличает сводку от обычной сдачи.
    """
    row = OpsDailySubmission.objects.get(pk=submission_id)
    return row.snapshot.get("sources", [])


def _row(employee, code):
    return {
        "employee_id": employee.pk,
        "status_type_code": code,
        "date_start": TOMORROW.isoformat(),
        # Интервал ПОЛУОТКРЫТЫЙ: `date_end == date_start` сервер отбивает как
        # пустой, и «один день» — это завтра по послезавтра.
        "date_end": DAY_AFTER.isoformat(),
    }


def test_the_expense_travels_from_a_directorate_to_the_organization(
    seeded_catalog, org  # noqa: F811
):
    """Четыре шага заказчика, четыре роли, одна цепочка."""
    organization, department, first, second = org
    on_duty = make_employee(first, last_name="Токтаров")
    on_leave = make_employee(first, last_name="Абенов")
    neighbour = make_employee(second, last_name="Оспанова")

    # ── Шаг 1. Начальник управления ставит статусы на завтра ─────────────
    head_first, _ = client_for(
        "chain-head-1",
        "DIVISION_OPERATOR",
        perms=("status.view", "status.manage", "daily_report.mark_update"),
        scope_division_id=first.pk,
    )
    filled = head_first.post(
        BULK,
        {
            "business_date": TOMORROW.isoformat(),
            "rows": [_row(on_duty, FIRST_CODE), _row(on_leave, SECOND_CODE)],
        },
        format="json",
    )
    assert filled.status_code == 201, filled.data
    # Обе строки заводятся ОДНИМ действием: начальник управления наполняет день
    # пачкой, а не по человеку.
    assert filled.data["created"] == 2, filled.data

    # ── Шаг 2. Управление сдаёт день ────────────────────────────────────
    handed = head_first.post(
        SUBMISSIONS,
        {"division_id": first.pk, "business_date": TOMORROW.isoformat()},
        format="json",
    )
    assert handed.status_code == 201, handed.data
    first_submission_id = handed.data["id"]

    # Второе управление тоже сдаёт: сводка департамента не собирается, пока
    # сдали не все (код отказа несёт список отстающих).
    head_second, _ = client_for(
        "chain-head-2",
        "DIVISION_OPERATOR_2",
        perms=("status.view", "status.manage", "daily_report.mark_update"),
        scope_division_id=second.pk,
    )
    head_second.post(
        BULK,
        {"business_date": TOMORROW.isoformat(), "rows": [_row(neighbour, "DUTY")]},
        format="json",
    )
    second_handed = head_second.post(
        SUBMISSIONS,
        {"division_id": second.pk, "business_date": TOMORROW.isoformat()},
        format="json",
    )
    assert second_handed.status_code == 201, second_handed.data

    # ── Шаг 3. Ответственный сводит департамент ─────────────────────────
    officer, _ = client_for(
        "chain-department",
        "DEPARTMENT_OFFICER",
        perms=("status.view", "daily_report.generate"),
        scope_division_id=department.pk,
    )
    dep_summary = officer.post(
        SUMMARIES,
        {"division_id": department.pk, "business_date": TOMORROW.isoformat()},
        format="json",
    )
    assert dep_summary.status_code == 201, dep_summary.data

    # СВЯЗЬ, а не просто «201»: сводка обязана ссылаться на сдачи детей.
    #
    # Пины читаются ИЗ МОДЕЛИ: наружу снимок не отдаётся намеренно (он весит
    # сотни килобайт на подразделение), и проба смотрит туда, где он живёт.
    sources = _pins(dep_summary.data["id"])
    pinned = {int(pin["division_id"]) for pin in sources}
    assert pinned == {first.pk, second.pk}, sources
    assert any(
        pin["submission_id"] == first_submission_id for pin in sources
    ), "сводка департамента не ссылается на сдачу первого управления"

    # ── Шаг 4. Оперативный дежурный сводит организацию ──────────────────
    duty_officer, _ = client_for(
        "chain-duty",
        "DUTY_OFFICER",
        perms=("status.view", "daily_report.generate"),
        scope_division_id=organization.pk,
    )
    org_summary = duty_officer.post(
        SUMMARIES,
        {"division_id": organization.pk, "business_date": TOMORROW.isoformat()},
        format="json",
    )
    assert org_summary.status_code == 201, org_summary.data
    org_sources = _pins(org_summary.data["id"])
    assert {int(pin["division_id"]) for pin in org_sources} == {department.pk}, (
        "сводка организации собрана не из сводки департамента — эшелон потерян"
    )
    assert any(
        pin["submission_id"] == dep_summary.data["id"] for pin in org_sources
    ), "сводка организации ссылается на другую версию сводки департамента"


def test_bulk_path_refuses_participation_status(seeded_catalog, org):  # noqa: F811
    """«Участие в ОМ» массовой ручкой не ставится (Plane №663).

    Ровно тот вызов, которым находка ревью обходила правило: POST на
    `/api/ops/daily/statuses-bulk/` с кодом участия, ТЕМ ЖЕ правом
    `status.manage`, которым одиночная ручка отвечает 422. Проба стоит на
    HTTP-границе намеренно: в карточке названа именно она, а сервисный уровень
    закреплён своей пробой в `apps/operations`.
    """
    from organization_management.apps.operations.status_types import StatusType

    _organization, _department, first, _second = org
    StatusType.objects.get_or_create(
        code=IN_EVENT,
        defaults={
            "code": IN_EVENT,
            "name": "Участие в ОМ",
            "priority": 80,
            # Участие человека из строя не выводит (решение Plane №169).
            "report_column_code": "IN_SERVICE",
            "counts_in_staff": True,
        },
    )
    employee = make_employee(first, last_name="Сериков")
    head, _ = client_for(
        "chain-head-bulk",
        "DIVISION_OPERATOR_BULK",
        perms=("status.view", "status.manage"),
        scope_division_id=first.pk,
    )

    refused = head.post(
        BULK,
        {
            "business_date": TOMORROW.isoformat(),
            "rows": [_row(employee, IN_EVENT)],
        },
        format="json",
    )

    assert refused.status_code == 422, refused.data
    assert refused.data["error_code"] == "PARTICIPATION_EVENT_REQUIRED"
    # Отказ ПОСТРОЧНЫЙ и называет своего сотрудника: в пачке из десяти строк
    # человеку нужно знать, какая именно не прошла.
    row = refused.data["details"]["rows"][0]
    assert row["employee_id"] == str(employee.pk)
    assert row["code"] == "PARTICIPATION_EVENT_REQUIRED"
    # Обычный статус той же ручкой проходит — запрет не запер массовый путь.
    ok = head.post(
        BULK,
        {
            "business_date": TOMORROW.isoformat(),
            "rows": [_row(employee, FIRST_CODE)],
        },
        format="json",
    )
    assert ok.status_code == 201, ok.data


def test_the_department_summary_waits_for_every_directorate(seeded_catalog, org):
    """Недосдавший ребёнок ОТБИВАЕТ сводку и НАЗЫВАЕТСЯ.

    Иначе ответственный получил бы сводку по половине департамента и не узнал
    бы об этом: число в ней выглядело бы законным.
    """
    _organization, department, first, second = org
    make_employee(first, last_name="Токтаров")
    make_employee(second, last_name="Оспанова")

    head, _ = client_for(
        "chain-partial-head",
        "DIVISION_OPERATOR_3",
        perms=("status.view", "status.manage", "daily_report.mark_update"),
        scope_division_id=first.pk,
    )
    handed = head.post(
        SUBMISSIONS,
        {"division_id": first.pk, "business_date": TOMORROW.isoformat()},
        format="json",
    )
    assert handed.status_code == 201, handed.data

    officer, _ = client_for(
        "chain-partial-officer",
        "DEPARTMENT_OFFICER_2",
        perms=("status.view", "daily_report.generate"),
        scope_division_id=department.pk,
    )
    response = officer.post(
        SUMMARIES,
        {"division_id": department.pk, "business_date": TOMORROW.isoformat()},
        format="json",
    )

    assert response.status_code == 422, response.data
    # Отстающий НАЗВАН: «не все сдали» без имени заставляет искать его руками.
    assert str(second.pk) in str(response.data), response.data
