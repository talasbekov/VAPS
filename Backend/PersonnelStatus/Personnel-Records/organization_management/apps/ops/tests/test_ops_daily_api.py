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
from organization_management.apps.operations.services import RoleAdminService
from organization_management.apps.operations.tests.test_bulk_status_api import (
    client_for,
    make_employee,
    seed_role,
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
def scoped_division(db):
    """Подразделение, которое видит скоупованный зритель.

    Отдельной фикстурой, а не внутри `scoped_viewer` (Plane №376): пробам
    списка подразделений нужно и само подразделение — чтобы проверить, что
    чужое в списке закрывает ответ целиком.
    """
    return Division.objects.create(name="Управление 2")


@pytest.fixture
def scoped_viewer(division, scoped_division):
    api, _ = client_for(
        "daily-scoped", "DAILY_SCOPED", perms=("status.view",),
        scope_division_id=scoped_division.pk,
    )
    return api


def test_divisions_are_scoped_and_stringly_typed(operator, scoped_viewer, division):
    rows = operator.get(DIVISIONS).json()["results"]
    # Путь до подразделения приехал вместе с именем (Plane №235) — пин формы
    # правится осознанно: у корневого подразделения предков нет.
    #
    # Пин расширен в Plane №295: строка несёт ещё право сдачи и момент
    # последней сдачи. Правится ОСОЗНАННО и полным сравнением, а не «ключ
    # присутствует»: форма контракта клиента — предмет этой пробы, и молчаливо
    # выросшая строка означала бы, что фронт читает поле, которого никто не
    # обещал. У оператора право сдачи без области — сдаёт за любое видимое.
    assert {
        "id": str(division.pk),
        "name": division.name,
        "ancestors": [],
        "can_submit": True,
        "last_submitted_at": None,
        # Тип узла добавлен в Plane №307 — тем же расширением, что и поля
        # выше: читателю нужен УРОВЕНЬ, а «нет предков» опознаёт департамент
        # неверно (у организации предков тоже нет).
        "division_type": Division.DivisionType.ORGANIZATION,
    } in rows
    # Скоупованный видит только своё поддерево.
    scoped_rows = scoped_viewer.get(DIVISIONS).json()["results"]
    assert all(row["name"] != division.name for row in scoped_rows)
    assert len(scoped_rows) == 1


def test_divisions_tell_apart_who_the_actor_submits_for(division):
    """`can_submit` считается по области права СДАЧИ, а не чтения (Plane №295).

    Зачем поле вообще: экран расхода не раскрывает список НЕсданного
    управления сводящему за департамент, но обязан раскрыть его САМОМУ
    начальнику управления — иначе тому негде проставить статусы и цепочка не
    стартует. Отличить одного от другого можно только областью права сдачи.

    Красная на мутации: считать поле по области ЧТЕНИЯ (или ставить True
    всем) — у актора читается ВСЁ дерево, и чужое управление тоже станет
    «своим».
    """
    other = Division.objects.create(name="Управление 2")
    # Чтение — без области (всё дерево), сдача — только за «Управление 1».
    api, user = client_for("daily-head", "DAILY_READ_ALL", perms=("status.view",))
    seed_role("DAILY_SUBMIT_MINE", ("daily_report.mark_update",))
    RoleAdminService.assign_role(
        str(user.pk), "DAILY_SUBMIT_MINE", division.pk, actor="test"
    )

    rows = {row["name"]: row for row in api.get(DIVISIONS).json()["results"]}

    assert set(rows) == {division.name, other.name}, "читаться должны оба"
    assert rows[division.name]["can_submit"] is True
    assert rows[other.name]["can_submit"] is False


def test_divisions_carry_the_moment_of_the_last_submission(
    operator, division, in_service
):
    """`last_submitted_at` — момент ПОСЛЕДНЕЙ сдачи любого дня (Plane №295).

    Свёрнутой строке несданного управления этого не заменить состоянием дня:
    «не сдан» без даты не отличает «сдавали вчера, сегодня ещё нет» от «не
    сдавали ни разу», а сводящему нужно ровно это — понять, кого торопить.

    Красная на мутации: отдавать момент сдачи ТЕКУЩЕГО дня (тогда после
    перехода на следующий день поле снова None, хотя сдача была) или не
    отдавать поле вовсе.
    """
    make_employee(division)

    def moment_of(name):
        rows = operator.get(DIVISIONS).json()["results"]
        return next(row for row in rows if row["name"] == name)["last_submitted_at"]

    assert moment_of(division.name) is None, "сдач не было — и момента нет"

    with clock.override(TODAY):
        submitted = operator.post(
            SUBMISSIONS,
            {"division_id": division.pk, "business_date": TODAY.isoformat()},
            format="json",
        )
    assert submitted.status_code == 201, submitted.data

    # Спрашиваем СЛЕДУЮЩИМ днём: поле обязано помнить сдачу и тогда, когда
    # «сегодня» уже другое — именно в этом состоянии его читает экран.
    with clock.override(TODAY + timedelta(days=1)):
        assert moment_of(division.name) == submitted.json()["submitted_at"]


def test_divisions_tell_the_type_of_the_node(operator, division):
    """Тип узла приезжает строкой (Plane №307).

    Зачем: «департамент» нельзя опознать по «нет предков» — у корневой
    ОРГАНИЗАЦИИ предков тоже нет, `ancestors_of` выбрасывает её из пути
    осознанно. Ровно на этом сломалась проба сборов сил, когда порядок строк
    стал обходом дерева (№296) и первой без предков встала организация.

    Красная на мутации: убрать поле или отдавать его только листам.
    """
    department = Division.objects.create(
        name="Департамент проб", code="dt-dep",
        division_type=Division.DivisionType.DEPARTMENT, parent=division,
    )

    rows = {row["name"]: row for row in operator.get(DIVISIONS).json()["results"]}

    # Оба узла БЕЗ предков в терминах `ancestors` — и именно поэтому тип
    # обязан их различать.
    assert rows[division.name]["ancestors"] == []
    assert rows[department.name]["ancestors"] == []
    assert rows[division.name]["division_type"] == Division.DivisionType.ORGANIZATION
    assert rows[department.name]["division_type"] == Division.DivisionType.DEPARTMENT


def test_divisions_come_in_tree_order_not_alphabetically(operator, division):
    """Строки идут ОБХОДОМ ДЕРЕВА, а не по алфавиту имён (Plane №296).

    Заказчик просит «поочерёдно управления со списками». Алфавит рвёт эту
    очередь дважды: «Второе управление» встаёт впереди «Первого», а
    управления разных департаментов перемешиваются между собой.

    Фикстура нарочно сделана так, что алфавит и дерево дают РАЗНЫЙ ответ:
    в первом департаменте заведены «Первое» и «Второе», во втором — тоже.
    По алфавиту вышло бы «Второе (Д1), Второе (Д2), Первое (Д1), Первое
    (Д2)»; по дереву — «Первое (Д1), Второе (Д1), Первое (Д2), Второе (Д2)».

    Красная на мутации: вернуть `sorted(names.items(), key=lambda kv: kv[1])`.
    """
    first_dep = Division.objects.create(
        name="Первый департамент", code="to-dep-1",
        division_type=Division.DivisionType.DEPARTMENT, parent=division, order=1,
    )
    second_dep = Division.objects.create(
        name="Второй департамент", code="to-dep-2",
        division_type=Division.DivisionType.DEPARTMENT, parent=division, order=2,
    )
    for index, parent in enumerate((first_dep, second_dep), start=1):
        for order, name in ((1, "Первое управление"), (2, "Второе управление")):
            Division.objects.create(
                name=name, code=f"to-dir-{index}-{order}",
                division_type=Division.DivisionType.DIRECTORATE,
                parent=parent, order=order,
            )

    rows = operator.get(DIVISIONS).json()["results"]
    directorates = [
        (row["name"], tuple(row["ancestors"]))
        for row in rows
        if row["name"].endswith("управление")
    ]

    assert directorates == [
        ("Первое управление", ("Первый департамент",)),
        ("Второе управление", ("Первый департамент",)),
        ("Первое управление", ("Второй департамент",)),
        ("Второе управление", ("Второй департамент",)),
    ]


def test_employees_of_division_contract_shape(operator, division):
    employee = make_employee(division)
    payload = operator.get(f"{EMPLOYEES}?division_id={division.pk}").json()
    assert payload["results"] == [
        {
            "id": str(employee.pk),
            "full_name": "Иванов И.",
            "rank_code": "",
            # Подразделение строки (Plane №376): без него общий ответ по
            # нескольким подразделениям нельзя разложить обратно.
            "division_id": division.pk,
        }
    ]
    assert payload["count"] == 1


def test_employees_of_several_divisions_come_in_one_answer(operator, division):
    """Состав нескольких подразделений отдаётся ОДНИМ ответом (Plane №376).

    Ради этого и заведён повторяемый параметр: экран «Сотрудники» спрашивал
    состав подразделение за подразделением и делал 51 запрос на одно открытие.
    """
    other = Division.objects.create(name="Управление 3")
    first = make_employee(division)
    second = make_employee(other)

    payload = operator.get(
        f"{EMPLOYEES}?division_id={division.pk}&division_id={other.pk}"
    ).json()

    assert payload["count"] == 2
    assert {row["id"] for row in payload["results"]} == {
        str(first.pk),
        str(second.pk),
    }
    # Каждая строка знает СВОЁ подразделение — иначе разложить ответ нечем.
    by_id = {row["id"]: row["division_id"] for row in payload["results"]}
    assert by_id[str(first.pk)] == division.pk
    assert by_id[str(second.pk)] == other.pk


def test_repeated_division_id_neither_doubles_people_nor_widens(operator, division):
    """Повтор одного и того же id в адресе не удваивает людей."""
    make_employee(division)
    payload = operator.get(
        f"{EMPLOYEES}?division_id={division.pk}&division_id={division.pk}"
    ).json()
    assert payload["count"] == 1


def test_foreign_division_in_the_list_is_403_and_nothing_leaks(
    scoped_viewer, division, scoped_division
):
    """Чужое подразделение В СПИСКЕ закрывает ВЕСЬ ответ.

    Проверять область только у первого названного значило бы отдать чужой
    состав тому, кто дописал его вторым параметром к своему.
    """
    foreign = make_employee(division)
    make_employee(scoped_division)

    response = scoped_viewer.get(
        f"{EMPLOYEES}?division_id={scoped_division.pk}&division_id={division.pk}"
    )

    assert response.status_code == 403
    # Ни строки чужого состава в теле отказа: 403 должен закрывать ответ, а не
    # приходить рядом с данными.
    assert str(foreign.pk) not in response.content.decode()


def test_division_id_must_be_a_number(operator):
    assert operator.get(f"{EMPLOYEES}?division_id=abc").status_code == 400


def test_too_many_divisions_at_once_is_400(operator, division):
    ids = "&".join(f"division_id={n}" for n in range(1, 202))
    assert operator.get(f"{EMPLOYEES}?{ids}").status_code == 400


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
