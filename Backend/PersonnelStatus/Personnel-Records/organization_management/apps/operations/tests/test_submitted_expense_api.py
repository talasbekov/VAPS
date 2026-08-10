"""GET /api/operations/strength-report/submitted/ — расход сданного дня.

Зона вьюхи, а не расчёта (числа покрыты test_submitted_expense.py): гейт,
порядок гардов, обязательность подразделения, различение двух «не найдено»
(нет подразделения / день не сдан), перевод дефекта данных в внятный отказ и
форма ответа, в которой `columns` значит то же самое, что у живого расхода.
"""
from datetime import timedelta

import pytest
from rest_framework.test import APIClient

from organization_management.apps.divisions.models import Division
from organization_management.apps.operations import clock
from organization_management.apps.operations.day_submission_service import (
    amend_day,
    submit_day,
)
from organization_management.apps.operations.models_submission import (
    OpsDailySubmission,
)
from organization_management.apps.operations.tests.test_bulk_status_api import (
    client_for,
)
from organization_management.apps.operations.tests.test_day_submission_service import (
    MORNING,
    TODAY,
    fact,
    in_slot,
)
from organization_management.apps.operations.tests.test_traffic_light import types  # noqa: F401

pytestmark = pytest.mark.django_db

URL = "/api/operations/strength-report/submitted/"
LIVE_URL = "/api/operations/strength-report/"
READ_PERMS = ["status.view"]
ACTOR = "7"
EVENING = MORNING.replace(hour=13, minute=30)


@pytest.fixture
def tree():
    root = Division.objects.create(name="Управление")
    child = Division.objects.create(name="Отдел", parent=root)
    return root, child


def submit(division, business_date=TODAY, at=MORNING):
    with clock.override(at):
        return submit_day(
            division_id=division.id, business_date=business_date, actor=ACTOR
        )


def amend(division, business_date=TODAY):
    with clock.override(MORNING):
        return amend_day(
            division_id=division.id,
            business_date=business_date,
            actor=ACTOR,
            reason="ошибка",
            sanction="замечание",
        )


def get(api, division_id=None, **params):
    if division_id is not None:
        params.setdefault("division_id", division_id)
    with clock.override(MORNING):
        return api.get(URL, params)


def admin(name):
    api, _ = client_for(name, "ADMIN", ["*"])
    return api


# ── Гейт и гарды ─────────────────────────────────────────────────────────

def test_anonymous_403(types, tree):
    root, _ = tree
    response = get(APIClient(), root.id)
    assert response.status_code == 403
    assert response.data["detail"] == "PERMISSION_DENIED"


def test_write_right_alone_does_not_open_the_expense(types, tree):
    # Право сдавать день не есть право читать сданное: гейт чтения свой.
    root, _ = tree
    api, _ = client_for("se-writer", "WRITER", ["daily_report.mark_update"])
    response = get(api, root.id)
    assert response.status_code == 403
    assert response.data["detail"] == "PERMISSION_DENIED"


def test_foreign_division_is_403_envelope(types, tree):
    # Форма отказа по ОБЛАСТИ — конверт, отказа гейта — DRF-detail; без
    # различения тест одного зеленел бы от другого.
    root, child = tree
    api, _ = client_for(
        "se-scoped", "VIEWER", READ_PERMS, scope_division_id=child.id
    )
    in_slot(root)
    submit(root)
    response = get(api, root.id)
    assert response.status_code == 403
    assert response.data["error_code"] == "PERMISSION_DENIED"


def test_scope_is_checked_before_existence(types, tree):
    root, child = tree
    api, _ = client_for(
        "se-oracle", "VIEWER", READ_PERMS, scope_division_id=child.id
    )
    response = get(api, root.id + 10_000)
    # 404 раньше области сделал бы отказ оракулом существования подразделений.
    assert response.status_code == 403
    assert response.data["error_code"] == "PERMISSION_DENIED"


def test_own_division_is_served_to_a_scoped_reader(types, tree):
    root, child = tree
    in_slot(child)
    submit(child)
    api, _ = client_for(
        "se-scoped-ok", "VIEWER", READ_PERMS, scope_division_id=child.id
    )
    response = get(api, child.id)
    assert response.status_code == 200
    assert response.data["division_id"] == child.id
    assert root.id


# ── Форма запроса ────────────────────────────────────────────────────────

def test_division_is_required(types, tree):
    """Подразделение обязательно: снимка поддерева не существует.

    Умолчание «вся область актора», как у живого расхода, дало бы сумму
    разных заявлений, часть которых не сделана вовсе.
    """
    response = get(admin("se-nodiv"))
    assert response.status_code == 400
    assert "division_id" in response.data


@pytest.mark.parametrize(
    "override, field",
    [
        ({"division_id": "abc"}, "division_id"),
        ({"business_date": "вчера"}, "business_date"),
    ],
)
def test_unreadable_param_is_400(types, tree, override, field):
    root, _ = tree
    params = {"division_id": root.id, "business_date": TODAY.isoformat()}
    params.update(override)
    response = get(admin(f"se-bad-{field}"), **params)
    assert response.status_code == 400
    assert field in response.data


# ── Два разных «не найдено» ──────────────────────────────────────────────

def test_unsubmitted_day_and_unknown_division_are_told_apart(types, tree):
    """Разные новости — разные коды.

    Под одним ENTITY_NOT_FOUND клиент не отличил бы опечатку в id от дня, по
    которому просто не сдавали, и переспрашивал бы не то.
    """
    root, _ = tree
    in_slot(root)  # есть кого сдавать, но не сдавали
    api = admin("se-404")
    unsubmitted = get(api, root.id)
    unknown = get(api, root.id + 10_000)
    assert unsubmitted.status_code == unknown.status_code == 404
    assert unsubmitted.data["error_code"] == "DAY_NOT_SUBMITTED"
    assert unknown.data["error_code"] == "ENTITY_NOT_FOUND"


def test_a_displaced_version_alone_is_not_an_expense(types, tree):
    # Снятая с текущих версия — история, а не расход: день снова не сдан.
    root, _ = tree
    in_slot(root)
    submit(root)
    OpsDailySubmission.objects.update(is_current=False)
    response = get(admin("se-displaced"), root.id)
    assert response.status_code == 404
    assert response.data["error_code"] == "DAY_NOT_SUBMITTED"


def test_unresolvable_code_is_422_not_500(types, tree):
    """Код вне справочника — дефект ДАННЫХ, и ответ обязан это сказать.

    500 сообщил бы «сломался сервер», а нули в колонках выдали бы поломку за
    пустой день. Тот же перевод, что у точечного светофора.
    """
    root, _ = tree
    employee = in_slot(root)
    submit(root)
    submission = OpsDailySubmission.objects.get(division_id=root.id)
    submission.snapshot = {
        "schema_version": 1,
        "roster": [{"employee_id": employee.id, "full_name": "И", "rank": ""}],
        "rows": [
            {
                "employee_id": employee.id,
                "status_type_code": "НЕТ_ТАКОГО",
                "status_id": 1,
                "date_start": TODAY.isoformat(),
                "date_end": (TODAY + timedelta(days=1)).isoformat(),
                "source": "USER",
            }
        ],
    }
    submission.save(update_fields=["snapshot"])
    response = get(admin("se-broken"), root.id)
    assert response.status_code == 422
    assert response.data["error_code"] == "UNRESOLVABLE_STATUS_TYPE"


# ── Числа и форма ответа ─────────────────────────────────────────────────

def test_the_snapshot_numbers_reach_the_client(types, tree):
    root, _ = tree
    on_duty = in_slot(root)
    fact(on_duty, code="DUTY")
    in_slot(root)
    submit(root)
    response = get(admin("se-numbers"), root.id)
    assert response.status_code == 200
    assert response.data["list_total"] == 2
    assert response.data["off_list"] == 0
    assert response.data["counts"]["DUTY"] == 1
    assert response.data["counts"]["IN_SERVICE"] == 1


def test_columns_is_the_order_and_matches_the_live_report(types, tree):
    """`columns` значит одно и то же на обоих маршрутах расхода — ПОРЯДОК.

    Числа лежат в `counts`. Порядок задаёт справочник (по приоритету), а не
    алфавит и не порядок вставки в словарь, поэтому он сверяется с живым
    расходом того же дня: два экрана одного раздела обязаны показывать
    колонки в одинаковой последовательности.
    """
    root, _ = tree
    in_slot(root)
    submit(root)
    api = admin("se-columns")
    response = get(api, root.id)
    with clock.override(MORNING):
        live = api.get(LIVE_URL, {"division_id": root.id})
    assert response.data["columns"] == live.data["columns"]
    assert response.data["columns"] == ["X", "VACATION", "DUTY", "STUDY", "IN_SERVICE"]
    assert set(response.data["counts"]) == set(response.data["columns"])


def test_the_submitted_numbers_do_not_move_after_live_edits(types, tree):
    """Главное свойство маршрута: подпись под числами что-то значит.

    Сравнение с живым расходом в том же тесте доказывает, что числа не
    совпали случайно, — живой к этому моменту уже другой.
    """
    root, _ = tree
    employee = in_slot(root)
    submit(root)
    api = admin("se-frozen")
    before = get(api, root.id).data
    fact(employee, code="DUTY")
    in_slot(root)
    after = get(api, root.id).data
    assert after == before
    with clock.override(MORNING):
        live = api.get(LIVE_URL, {"division_id": root.id})
    assert live.data["rows"][0]["columns"]["DUTY"] == 1
    assert live.data["rows"][0]["list_total"] == 2


def test_the_current_version_is_served_after_an_amendment(types, tree):
    root, _ = tree
    employee = in_slot(root)
    submit(root)
    fact(employee, code="DUTY")
    amend(root)
    response = get(admin("se-amended"), root.id)
    assert response.data["version"] == 2
    assert response.data["counts"]["DUTY"] == 1


def test_the_passport_of_the_version_travels_with_the_numbers(types, tree):
    # Два читателя одного дня обязаны понимать, ту ли версию они видят.
    root, _ = tree
    in_slot(root)
    submission = submit(root, at=EVENING)
    response = get(admin("se-passport"), root.id)
    assert response.data["version"] == submission.version
    assert response.data["submitted_at"] == submission.submitted_at.isoformat()
    assert response.data["late"] is True


def test_the_response_carries_no_live_only_fields(types, tree):
    """Полей МЕНЬШЕ, чем у живого расхода, и это честность.

    Снимок не хранит штат, вакансии и приданных; подмешать их живыми значило
    бы выдать наполовину сегодняшние числа за сданные вчера.
    """
    root, _ = tree
    in_slot(root)
    submit(root)
    response = get(admin("se-fields"), root.id)
    assert set(response.data) == {
        "division_id", "business_date", "version", "submitted_at", "late",
        "columns", "list_total", "off_list", "counts",
    }


# ── Дата ─────────────────────────────────────────────────────────────────

def test_date_defaults_to_today_and_echoes(types, tree):
    root, _ = tree
    in_slot(root)
    submit(root)
    response = get(admin("se-today"), root.id)
    assert response.data["business_date"] == TODAY.isoformat()


def test_another_day_is_answered_for_that_day(types, tree):
    root, _ = tree
    tomorrow = TODAY + timedelta(days=1)
    in_slot(root)
    submit(root, business_date=tomorrow)
    api = admin("se-tomorrow")
    assert get(api, root.id).status_code == 404
    answer = get(api, root.id, business_date=tomorrow.isoformat())
    assert answer.status_code == 200
    assert answer.data["business_date"] == tomorrow.isoformat()


# ── Поверхность ──────────────────────────────────────────────────────────

@pytest.mark.parametrize("method", ["post", "put", "patch", "delete"])
def test_the_route_is_read_only(types, tree, method):
    root, _ = tree
    with clock.override(MORNING):
        response = getattr(admin(f"se-method-{method}"), method)(
            URL, {}, format="json"
        )
    assert response.status_code == 405


def test_the_live_report_still_answers(types, tree):
    # Регресс соседнего действия: новый url_path не должен перехватывать
    # корень маршрута расхода.
    root, _ = tree
    in_slot(root)
    with clock.override(MORNING):
        response = admin("se-live").get(LIVE_URL, {"division_id": root.id})
    assert response.status_code == 200
    assert response.data["rows"][0]["division_id"] == root.id


# ── Схема ────────────────────────────────────────────────────────────────

def test_schema_describes_an_object_and_only_get():
    """Схема обещает ровно то, что сервер отдаёт.

    ⚠️ many=False на классе ответа тут НЕ несущий: его снятие оставляет пробу
    зелёной, потому что list-эвристику spectacular включает по ИМЕНИ действия,
    а это действие зовётся `submitted`. Обёртка оставлена ради единообразия с
    соседними ответами того же файла, где она обязательна (там действие
    называется `list`), и этот тест её не сторожит. Сторожит он другое:
    страничным массивом ответ не описан, набор полей совпадает с отданным, и
    обязательность division_id доехала до контракта — генератор клиента иначе
    выпустил бы вызов без параметра, на который сервер отвечает 400.
    """
    from drf_spectacular.generators import SchemaGenerator

    schema = SchemaGenerator().get_schema(request=None, public=True)
    path = schema["paths"]["/api/operations/strength-report/submitted/"]
    assert list(path) == ["get"]
    body = path["get"]["responses"]["200"]["content"]["application/json"]
    assert body["schema"] == {"$ref": "#/components/schemas/SubmittedExpenseResponse"}
    shape = schema["components"]["schemas"]["SubmittedExpenseResponse"]
    assert shape["type"] == "object"
    assert set(shape["properties"]) == {
        "division_id", "business_date", "version", "submitted_at", "late",
        "columns", "list_total", "off_list", "counts",
    }
    required = [
        parameter
        for parameter in path["get"]["parameters"]
        if parameter["name"] == "division_id"
    ]
    assert required and required[0]["required"] is True
