"""GET /api/operations/statuses/ и /{id}/ — маршруты чтения статусов.

Зона ответственности вьюхи: гейт права (чтение — status.view, НЕ status.manage),
область видимости, фильтры, порядок и страничная выдача. Правила домена
(состояние, конфликты, отмена) живут в сервисе и покрыты test_status_service.py.

Обвязка (роль, клиент, сотрудник со штатной единицей) переиспользуется из
маршрутного теста пачки — общая для всех маршрутов статусов.
"""
from datetime import timedelta

import pytest
from rest_framework.test import APIClient

from organization_management.apps.divisions.models import Division
from organization_management.apps.operations import clock
from organization_management.apps.operations.clock import Clock
from organization_management.apps.operations.models_status import OpsEmployeeStatus
from organization_management.apps.operations.tests.test_bulk_status_api import (
    TODAY,
    client_for,
    division,  # noqa: F401 — фикстура pytest, используется по имени аргумента
    make_employee,
    types,  # noqa: F401 — фикстура pytest
)

pytestmark = pytest.mark.django_db

URL = "/api/operations/statuses/"


def detail_url(status_id):
    return f"{URL}{status_id}/"


def make_status(employee, **overrides):
    """Строка по умолчанию ЖИВАЯ на TODAY (полуинтервал [TODAY, TODAY+2)).

    Сдвиг одного date_start тянет за собой окончание: иначе пара
    (новое начало, старое окончание) сложилась бы в перевёрнутый интервал и
    упала бы на ограничении БД, а не проверила бы то, ради чего сдвигалась.
    """
    start = overrides.get("date_start", TODAY)
    fields = {
        "employee_id": employee.id,
        "status_type_code": "DUTY",
        "date_start": start,
        "date_end": start + timedelta(days=2),
        "source": OpsEmployeeStatus.Source.USER,
        "created_by": "seed",
    }
    fields.update(overrides)
    return OpsEmployeeStatus.objects.create(**fields)


def get(api, url=URL, **params):
    with clock.override(TODAY):
        return api.get(url, params)


def ids_of(response):
    return [row["id"] for row in response.data["results"]]


# ── Гейт права ───────────────────────────────────────────────────────────

def assert_denied_by_gate(response):
    """403 ГЕЙТА права, а не области видимости: оба 403, различает форма
    (гейт → {detail} DRF, область строки → конверт {error_code})."""
    assert response.status_code == 403
    assert response.data["detail"] == "PERMISSION_DENIED"
    assert "error_code" not in response.data


def test_anonymous_403(types, division):
    assert_denied_by_gate(get(APIClient()))


def test_without_status_view_403(types, division):
    # Право записи чтения не открывает: гейты у них разные, и роль,
    # выданная «на всякий случай» под правку, не превращается в доступ к
    # журналу.
    api, _ = client_for("lst-writer", "OPERATOR", ["status.manage"])
    assert_denied_by_gate(get(api))


def test_reader_without_manage_reads(types, division):
    # Обратная сторона: чистый читатель список ВИДИТ — иначе отказ выше
    # неотличим от «читать нельзя никому».
    api, _ = client_for("lst-reader", "VIEWER", ["status.view"])
    make_status(make_employee(division))
    response = get(api)
    assert response.status_code == 200
    assert response.data["count"] == 1


# ── Форма ответа ─────────────────────────────────────────────────────────

def test_row_shape(types, division):
    api, _ = client_for("lst-shape", "ADMIN", ["*"])
    status_row = make_status(make_employee(division), comment="в наряде")
    response = get(api)
    assert response.status_code == 200
    (row,) = response.data["results"]
    assert row["id"] == status_row.pk
    assert row["employee_id"] == status_row.employee_id
    assert row["status_type_code"] == "DUTY"
    assert row["comment"] == "в наряде"
    # Состояние выводится сервером на бизнес-дату, а не считается клиентом.
    assert row["state"] == "ACTIVE"


def test_pagination_envelope(types, division):
    api, _ = client_for("lst-page", "ADMIN", ["*"])
    employee = make_employee(division)
    for shift in range(3):
        make_status(employee, date_start=TODAY + timedelta(days=shift * 10))
    response = get(api, limit=1)
    assert response.status_code == 200
    # Полное число строк известно клиенту, страница — одна строка.
    assert response.data["count"] == 3
    assert len(response.data["results"]) == 1
    assert response.data["next"] is not None


def test_order_is_set_by_server(types, division):
    # Три строки, чтобы порядок был проверяемым: на двух «свежие первыми»
    # совпало бы со случайной выдачей БД. Порядок посева и порядок id НЕ
    # совпадают с ожидаемым ответом.
    api, _ = client_for("lst-order", "ADMIN", ["*"])
    employee = make_employee(division)
    middle = make_status(employee, date_start=TODAY + timedelta(days=10))
    oldest = make_status(employee, date_start=TODAY - timedelta(days=10))
    newest = make_status(employee, date_start=TODAY + timedelta(days=20))
    response = get(api)
    assert ids_of(response) == [newest.pk, middle.pk, oldest.pk]


# ── Отменённые строки ────────────────────────────────────────────────────

def test_cancelled_hidden_by_default(types, division):
    api, _ = client_for("lst-cancelled", "ADMIN", ["*"])
    employee = make_employee(division)
    live = make_status(employee)
    make_status(employee, cancelled_at=Clock.now(), cancelled_reason="приказ отменён")
    response = get(api)
    assert ids_of(response) == [live.pk]


def test_include_cancelled_shows_both(types, division):
    api, _ = client_for("lst-cancelled-on", "ADMIN", ["*"])
    employee = make_employee(division)
    live = make_status(employee)
    cancelled = make_status(employee, cancelled_at=Clock.now())
    response = get(api, include_cancelled="true")
    assert set(ids_of(response)) == {live.pk, cancelled.pk}
    states = {row["id"]: row["state"] for row in response.data["results"]}
    assert states[cancelled.pk] == "CANCELLED"


# ── Фильтры ──────────────────────────────────────────────────────────────

def test_business_date_keeps_live_rows_only(types, division):
    api, _ = client_for("lst-date", "ADMIN", ["*"])
    employee = make_employee(division)
    live = make_status(employee)
    future = make_status(
        employee,
        date_start=TODAY + timedelta(days=3),
        date_end=TODAY + timedelta(days=5),
    )
    response = get(api, business_date=TODAY.isoformat())
    assert ids_of(response) == [live.pk]
    # Без параметра журнал полный — иначе фильтр выше зеленел бы от того, что
    # будущей строки не видно вообще.
    assert set(ids_of(get(api))) == {live.pk, future.pk}


def test_business_date_is_half_open(types, division):
    # День окончания в интервал НЕ входит: [date_start, date_end). Строка,
    # кончившаяся сегодня, сегодня уже не действует.
    api, _ = client_for("lst-halfopen", "ADMIN", ["*"])
    employee = make_employee(division)
    make_status(employee, date_start=TODAY - timedelta(days=2), date_end=TODAY)
    response = get(api, business_date=TODAY.isoformat())
    assert response.data["count"] == 0


def test_employee_id_filter(types, division):
    api, _ = client_for("lst-emp", "ADMIN", ["*"])
    mine = make_status(make_employee(division))
    make_status(make_employee(division))
    response = get(api, employee_id=mine.employee_id)
    assert ids_of(response) == [mine.pk]


def test_status_type_code_filter(types, division):
    api, _ = client_for("lst-type", "ADMIN", ["*"])
    employee = make_employee(division)
    duty = make_status(employee)
    make_status(employee, status_type_code="STUDY")
    response = get(api, status_type_code="DUTY")
    assert ids_of(response) == [duty.pk]


@pytest.mark.parametrize(
    "params",
    [
        {"business_date": "не-дата"},
        {"employee_id": "abc"},
        {"division_id": "abc"},
        {"include_cancelled": "yes"},
    ],
)
def test_garbage_param_400(types, division, params):
    # Нечитаемый параметр — честный 400 с указанием поля, а не молчаливое
    # игнорирование: тихо отброшенный фильтр вернул бы клиенту НЕ то, что он
    # просил, под видом успеха.
    api, _ = client_for(f"lst-garbage-{next(iter(params))}", "ADMIN", ["*"])
    response = get(api, **params)
    assert response.status_code == 400
    assert next(iter(params)) in response.data


# ── Область видимости ────────────────────────────────────────────────────

def test_scoped_operator_sees_only_own_division(types, division):
    other = Division.objects.create(name="Управление 2")
    api, _ = client_for(
        "lst-scoped", "VIEWER", ["status.view"], scope_division_id=division.id
    )
    mine = make_status(make_employee(division))
    foreign = make_status(make_employee(other))
    response = get(api)
    assert ids_of(response) == [mine.pk]
    # Чужая строка существует и видна безскоуповому — отсутствие выше это
    # область видимости, а не пустая выборка.
    admin, _ = client_for("lst-scoped-admin", "ADMIN", ["*"])
    assert foreign.pk in ids_of(get(admin))


def test_scope_covers_subtree(types, division):
    # Область — ПОДДЕРЕВО, а не один узел. Чужая строка в посеве обязательна:
    # без неё тест зеленел бы и при полностью отключённом фильтре области.
    child = Division.objects.create(name="Отдел 1", parent=division)
    other = Division.objects.create(name="Управление 2")
    api, _ = client_for(
        "lst-subtree", "VIEWER", ["status.view"], scope_division_id=division.id
    )
    below = make_status(make_employee(child))
    make_status(make_employee(other))
    assert ids_of(get(api)) == [below.pk]


def test_employee_without_staff_unit_invisible_to_scoped(types, division):
    api, _ = client_for(
        "lst-noslot", "VIEWER", ["status.view"], scope_division_id=division.id
    )
    orphan = make_status(make_employee(None))
    assert ids_of(get(api)) == []
    # Безскоуповый её видит: строка не «пропала», она вне области.
    admin, _ = client_for("lst-noslot-admin", "ADMIN", ["*"])
    assert orphan.pk in ids_of(get(admin))


def test_foreign_division_id_403(types, division):
    other = Division.objects.create(name="Управление 2")
    api, _ = client_for(
        "lst-foreign", "VIEWER", ["status.view"], scope_division_id=division.id
    )
    make_status(make_employee(other))
    response = get(api, division_id=other.id)
    # Отказ, а не пустой список: пустой список неотличим от «там никого нет».
    assert_denied_by_gate(response)


def test_own_division_id_filters(types, division):
    other = Division.objects.create(name="Управление 2")
    api, _ = client_for("lst-divfilter", "ADMIN", ["*"])
    mine = make_status(make_employee(division))
    make_status(make_employee(other))
    response = get(api, division_id=division.id)
    assert ids_of(response) == [mine.pk]


# ── Одиночное чтение ─────────────────────────────────────────────────────

def test_retrieve_returns_row(types, division):
    api, _ = client_for("rtv-ok", "VIEWER", ["status.view"])
    status_row = make_status(make_employee(division), document_basis="Приказ №1")
    response = get(api, detail_url(status_row.pk))
    assert response.status_code == 200
    assert response.data["id"] == status_row.pk
    assert response.data["document_basis"] == "Приказ №1"
    assert response.data["state"] == "ACTIVE"


def test_retrieve_cancelled_row_200(types, division):
    # Список отменённые прячет, прямой адрес — нет: клиент спросил именно эту
    # строку, и 404 на существующий факт был бы ложью.
    api, _ = client_for("rtv-cancelled", "ADMIN", ["*"])
    status_row = make_status(make_employee(division), cancelled_at=Clock.now())
    response = get(api, detail_url(status_row.pk))
    assert response.status_code == 200
    assert response.data["state"] == "CANCELLED"


def test_retrieve_scoped_reader_own_division_200(types, division):
    # Читатель БЕЗ права записи получает свою строку: область одиночного
    # чтения считается под status.view, а не под status.manage.
    api, _ = client_for(
        "rtv-scoped", "VIEWER", ["status.view"], scope_division_id=division.id
    )
    status_row = make_status(make_employee(division))
    assert get(api, detail_url(status_row.pk)).status_code == 200


def test_retrieve_foreign_division_403_envelope(types, division):
    other = Division.objects.create(name="Управление 2")
    api, _ = client_for(
        "rtv-foreign", "VIEWER", ["status.view"], scope_division_id=division.id
    )
    status_row = make_status(make_employee(other))
    response = get(api, detail_url(status_row.pk))
    # Конверт области, а не {detail} гейта: право на чтение у оператора ЕСТЬ.
    assert response.status_code == 403
    assert response.data["error_code"] == "PERMISSION_DENIED"


def test_retrieve_missing_404_envelope(types, division):
    api, _ = client_for("rtv-404", "ADMIN", ["*"])
    response = get(api, detail_url(999999))
    assert response.status_code == 404
    assert response.data["error_code"] == "ENTITY_NOT_FOUND"


def test_retrieve_garbage_id_404_envelope(types, division):
    api, _ = client_for("rtv-garbage", "ADMIN", ["*"])
    response = get(api, detail_url("abc"))
    assert response.status_code == 404
    assert response.data["error_code"] == "ENTITY_NOT_FOUND"


# ── Поверхность метода ───────────────────────────────────────────────────

def test_collection_post_is_served_and_validates_its_body(types, division):
    """POST на корень списка теперь ОБСЛУЖИВАЕТСЯ — это создание одного статуса.

    Раньше здесь стоял 405 с пояснением «создание — только пачкой». Это
    противоречило самой пачке: её докстринг отправляет оператора разводить
    мягкие пересечения «поштучно через create_status», а обхода у пачки нет и
    маршрута к одиночному созданию не существовало — оператор упирался в тупик и
    не мог записать статус вообще никак. Противоречие снято в пользу того, чтобы
    работу можно было доделать (срез 123).

    Пустое тело при этом — отказ ФОРМЫ (400), а не 405: маршрут есть, не хватает
    полей.
    """
    api, _ = client_for("lst-post", "ADMIN", ["*"])
    with clock.override(TODAY):
        response = api.post(URL, {}, format="json")
    assert response.status_code == 400


def test_detail_delete_is_not_served(types, division):
    api, _ = client_for("lst-delete", "ADMIN", ["*"])
    status_row = make_status(make_employee(division))
    with clock.override(TODAY):
        response = api.delete(detail_url(status_row.pk))
    assert response.status_code == 405
