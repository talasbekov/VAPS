"""«Расход дня» раздела ОМ (/api/ops/daily/*) — тонкие адаптеры.

Проверяется зона ответственности адаптера, а не правила сервисов (те покрыты
своими тестами): форма контракта клиента (строковые id, конверт списка, все
версии дня), делегация в живые bulk_status_service / day_submission_service
(атомарный отказ с details.rows, окно сдачи, поправка) и общие гарды области
(чужое подразделение — 403, а не пустой ответ).
"""
from datetime import date, timedelta

import pytest

from organization_management.apps.divisions.models import Division
from organization_management.apps.operations import clock
from organization_management.apps.operations.models import StatusType
from organization_management.apps.operations.models_status import (
    OpsEmployeeStatus,
)
from organization_management.apps.operations.tests.test_bulk_status_api import (
    client_for,
    make_employee,
)

pytestmark = pytest.mark.django_db

DIVISIONS = "/api/ops/daily/divisions/"
EMPLOYEES = "/api/ops/daily/employees/"
BULK = "/api/ops/daily/statuses-bulk/"
SUBMISSIONS = "/api/ops/daily/daily-submissions/"
TODAY = date(2026, 8, 4)


@pytest.fixture
def division(db):
    return Division.objects.create(name="Управление 1")


@pytest.fixture
def duty_type(db):
    return StatusType.objects.create(
        code="DUTY",
        name="Наряд",
        priority=10,
        report_column_code="X",
        is_hard_block=False,
    )


@pytest.fixture
def in_service(db):
    # Снимок сдачи отказывается собираться без выводимого «в строю» —
    # прод заводит этот тип первым (see seed_status_types).
    return StatusType.objects.create(
        code="IN_SERVICE",
        name="В строю",
        priority=1,
        report_column_code="S",
        is_hard_block=False,
    )


@pytest.fixture
def operator(division):
    api, _ = client_for(
        "daily-operator",
        "DAILY_OP",
        perms=(
            "status.view", "status.manage",
            "daily_report.mark_update", "daily_report.correct",
        ),
    )
    return api


@pytest.fixture
def scoped_viewer(division):
    other = Division.objects.create(name="Управление 2")
    api, _ = client_for(
        "daily-scoped", "DAILY_SCOPED", perms=("status.view",),
        scope_division_id=other.pk,
    )
    return api


def test_divisions_are_scoped_and_stringly_typed(operator, scoped_viewer, division):
    rows = operator.get(DIVISIONS).json()["results"]
    # Путь до подразделения приехал вместе с именем (Plane №235) — пин формы
    # правится осознанно: у корневого подразделения предков нет.
    assert {"id": str(division.pk), "name": division.name, "ancestors": []} in rows
    # Скоупованный видит только своё поддерево.
    scoped_rows = scoped_viewer.get(DIVISIONS).json()["results"]
    assert all(row["name"] != division.name for row in scoped_rows)
    assert len(scoped_rows) == 1


def test_employees_of_division_contract_shape(operator, division):
    employee = make_employee(division)
    payload = operator.get(f"{EMPLOYEES}?division_id={division.pk}").json()
    assert payload["results"] == [
        {
            "id": str(employee.pk),
            "full_name": "Иванов И.",
            "rank_code": "",
        }
    ]
    assert payload["count"] == 1


def test_employees_foreign_division_is_403(scoped_viewer, division):
    assert (
        scoped_viewer.get(f"{EMPLOYEES}?division_id={division.pk}").status_code
        == 403
    )


def test_bulk_delegates_and_is_atomic(operator, division, duty_type):
    good = make_employee(division)
    with clock.override(TODAY):
        response = operator.post(
            BULK,
            {
                "business_date": TODAY.isoformat(),
                "rows": [
                    {
                        "employee_id": good.pk,
                        "status_type_code": "DUTY",
                        "date_start": TODAY.isoformat(),
                        "date_end": (TODAY + timedelta(days=1)).isoformat(),
                    },
                    {
                        "employee_id": good.pk + 0,  # тот же сотрудник ниже
                        "status_type_code": "NO_SUCH",
                        "date_start": TODAY.isoformat(),
                        "date_end": (TODAY + timedelta(days=1)).isoformat(),
                    },
                ],
            },
            format="json",
        )
    # Дубль сотрудника — 400 формы ДО построчной работы; ничего не записано.
    assert response.status_code == 400
    assert OpsEmployeeStatus.objects.count() == 0

    other = make_employee(division)
    with clock.override(TODAY):
        rejected = operator.post(
            BULK,
            {
                "business_date": TODAY.isoformat(),
                "rows": [
                    {
                        "employee_id": good.pk,
                        "status_type_code": "DUTY",
                        "date_start": TODAY.isoformat(),
                        "date_end": (TODAY + timedelta(days=1)).isoformat(),
                    },
                    {
                        "employee_id": other.pk,
                        "status_type_code": "NO_SUCH",
                        "date_start": TODAY.isoformat(),
                        "date_end": (TODAY + timedelta(days=1)).isoformat(),
                    },
                ],
            },
            format="json",
        )
    # Одна плохая строка валит пачку ЦЕЛИКОМ, отказ построчный.
    assert rejected.status_code == 422
    body = rejected.json()
    rows = body["details"]["rows"]
    assert [row["employee_id"] for row in rows] == [str(other.pk)]
    assert rows[0]["code"] == "INVALID_STATUS_TYPE"
    assert OpsEmployeeStatus.objects.count() == 0

    with clock.override(TODAY):
        created = operator.post(
            BULK,
            {
                "business_date": TODAY.isoformat(),
                "rows": [
                    {
                        "employee_id": good.pk,
                        "status_type_code": "DUTY",
                        "date_start": TODAY.isoformat(),
                        "date_end": (TODAY + timedelta(days=1)).isoformat(),
                    }
                ],
            },
            format="json",
        )
    assert created.status_code == 201
    assert created.json() == {"created": 1}
    assert OpsEmployeeStatus.objects.count() == 1


def test_submission_lifecycle_in_client_shape(operator, division, in_service):
    make_employee(division)
    with clock.override(TODAY):
        created = operator.post(
            SUBMISSIONS,
            {
                "division_id": division.pk,
                "business_date": TODAY.isoformat(),
            },
            format="json",
        )
        assert created.status_code == 201
        body = created.json()
        # Форма контракта клиента: division_id — СТРОКА, подпись — username.
        assert body["division_id"] == str(division.pk)
        assert body["version"] == 1
        assert body["is_current"] is True
        assert body["submitted_by"] == "daily-operator"

        duplicate = operator.post(
            SUBMISSIONS,
            {
                "division_id": division.pk,
                "business_date": TODAY.isoformat(),
            },
            format="json",
        )
        assert duplicate.status_code == 409
        assert duplicate.json()["error_code"] == "DAY_ALREADY_SUBMITTED"

        out_of_window = operator.post(
            SUBMISSIONS,
            {
                "division_id": division.pk,
                "business_date": (TODAY - timedelta(days=3)).isoformat(),
            },
            format="json",
        )
        assert out_of_window.status_code == 422
        assert (
            out_of_window.json()["error_code"] == "BUSINESS_DATE_OUT_OF_WINDOW"
        )
        # Окно называет РАЗРЕШЁННЫЕ даты в ответе — истина сервера.
        assert TODAY.isoformat() in out_of_window.json()["details"]["allowed"]

        amended = operator.post(
            f"{SUBMISSIONS}{body['id']}/amend/",
            {"reason": "Уточнение состава", "sanction": "Замечание"},
            format="json",
        )
        assert amended.status_code == 201
        assert amended.json()["version"] == 2
        assert amended.json()["event"] == "AMENDED"

        # Список несёт ВСЕ версии дня: историю решает экран по is_current.
        listed = operator.get(
            f"{SUBMISSIONS}?division_id={division.pk}"
            f"&business_date={TODAY.isoformat()}"
        ).json()
        assert [row["version"] for row in listed["results"]] == [2, 1]
        assert [row["is_current"] for row in listed["results"]] == [
            True, False,
        ]
        assert all(
            row["division_id"] == str(division.pk)
            for row in listed["results"]
        )


def test_submissions_list_foreign_division_403(scoped_viewer, division):
    response = scoped_viewer.get(f"{SUBMISSIONS}?division_id={division.pk}")
    assert response.status_code == 403


def test_amend_missing_reason_is_400(operator, division, in_service):
    make_employee(division)
    with clock.override(TODAY):
        created = operator.post(
            SUBMISSIONS,
            {
                "division_id": division.pk,
                "business_date": TODAY.isoformat(),
            },
            format="json",
        ).json()
        response = operator.post(
            f"{SUBMISSIONS}{created['id']}/amend/",
            {"reason": "   ", "sanction": "Замечание"},
            format="json",
        )
    assert response.status_code == 400


@pytest.mark.django_db
def test_divisions_carry_the_way_to_them(operator, division):
    """Имена подразделений уникальны только внутри родителя (Plane №235).

    🔴 На реальной структуре «Второе сквозное управление» есть в каждом
    департаменте, и экран расхода показывал три одинаковые строки подряд — а
    по ним человек решает, чей день сдавать. Проба заводит ДВА одноимённых
    подразделения в разных родителях: без этого «путь доехал» не отличить от
    «путь совпал».
    """
    first_parent = Division.objects.create(
        name="Первый департамент", code="dw-dep-1",
        division_type=Division.DivisionType.DEPARTMENT, parent=division,
    )
    second_parent = Division.objects.create(
        name="Второй департамент", code="dw-dep-2",
        division_type=Division.DivisionType.DEPARTMENT, parent=division,
    )
    for index, parent in enumerate((first_parent, second_parent), start=1):
        Division.objects.create(
            name="Второе сквозное управление", code=f"dw-dir-{index}",
            division_type=Division.DivisionType.DIRECTORATE, parent=parent,
        )

    rows = operator.get(DIVISIONS).json()["results"]
    twins = [row for row in rows if row["name"] == "Второе сквозное управление"]

    assert len(twins) == 2, "фикстура не развела одноимённые подразделения"
    assert sorted(tuple(row["ancestors"]) for row in twins) == [
        ("Второй департамент",),
        ("Первый департамент",),
    ]
