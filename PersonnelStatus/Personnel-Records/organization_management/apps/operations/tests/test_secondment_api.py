"""Маршруты прикомандирования: откомандировать, запросить и подтвердить
возврат.

Вьюха тонкая, поэтому проверяется ровно её зона: гейт права, РАЗНЫЕ стороны
области видимости у трёх действий (откуда/откуда/куда), происхождение актора
и штатного подразделения, формы ответов и доставка отказов сервиса конвертом
раздела. Правила самой пары живут в сервисе и покрыты
test_secondment_service.py / test_secondment_return.py.
"""
from datetime import timedelta

import pytest
from rest_framework.test import APIClient

from organization_management.apps.divisions.models import Division
from organization_management.apps.operations import clock
from organization_management.apps.operations.models_status import (
    OpsEmployeeStatus,
    Secondment,
)
from organization_management.apps.operations.tests.test_bulk_status_api import (
    TODAY,
    client_for,
    make_employee,
)
from organization_management.apps.operations.tests.test_status_service import seed_types

pytestmark = pytest.mark.django_db

URL = "/api/operations/secondments/"


def detail_url(secondment_id, action):
    return f"{URL}{secondment_id}/{action}/"


@pytest.fixture
def types():
    seed_types()


@pytest.fixture
def home():
    return Division.objects.create(name="Управление 1")


@pytest.fixture
def host():
    return Division.objects.create(name="Управление 2")


def post(api, url, body=None):
    with clock.override(TODAY):
        return api.post(url, {} if body is None else body, format="json")


def create_body(employee, host_division, **overrides):
    body = {
        "employee_id": employee.id,
        "to_division_id": host_division.id,
        "date_start": TODAY.isoformat(),
        "date_end": (TODAY + timedelta(days=10)).isoformat(),
    }
    body.update(overrides)
    return body


def seed_pair(employee, host_division, admin=None):
    """Готовая пара через маршрут — так же, как её создаст клиент."""
    api = admin or client_for(f"sec-seed-{employee.id}", "ADMIN", ["*"])[0]
    response = post(api, URL, create_body(employee, host_division))
    assert response.status_code == 201, response.data
    return Secondment.objects.get(pk=response.data["id"])


# ── Гейт права ───────────────────────────────────────────────────────────

def assert_denied_by_gate(response):
    """403 ГЕЙТА права, а не области: оба 403, различает форма (гейт →
    {detail} DRF, область → конверт {error_code})."""
    assert response.status_code == 403
    assert response.data["detail"] == "PERMISSION_DENIED"
    assert "error_code" not in response.data


def test_anonymous_403(types, home, host):
    employee = make_employee(home)
    response = post(APIClient(), URL, create_body(employee, host))
    assert_denied_by_gate(response)
    assert not Secondment.objects.exists()


def test_reader_cannot_second(types, home, host):
    # Чтение статусов прикомандирования не открывает: это запись.
    api, _ = client_for("sec-viewer", "VIEWER", ["status.view"])
    employee = make_employee(home)
    response = post(api, URL, create_body(employee, host))
    assert_denied_by_gate(response)
    assert not Secondment.objects.exists()


@pytest.mark.parametrize("action", ["request-return", "confirm-return"])
def test_reader_cannot_move_the_handshake(types, home, host, action):
    admin, _ = client_for(f"sec-gate-admin-{action}", "ADMIN", ["*"])
    secondment = seed_pair(make_employee(home), host, admin=admin)
    api, _ = client_for(f"sec-gate-viewer-{action}", "VIEWER", ["status.view"])
    assert_denied_by_gate(post(api, detail_url(secondment.pk, action)))
    from_db = Secondment.objects.get(pk=secondment.pk)
    assert from_db.return_requested_at is None
    assert from_db.return_confirmed_at is None


# ── Откомандирование ─────────────────────────────────────────────────────

def test_create_returns_the_pair(types, home, host):
    api, user = client_for("sec-create", "ADMIN", ["*"])
    employee = make_employee(home)
    response = post(
        api, URL, create_body(employee, host, document_basis="Приказ №5")
    )
    assert response.status_code == 201
    assert response.data["employee_id"] == employee.id
    # Штатное подразделение пришло из штатной единицы, а не из тела запроса.
    assert response.data["from_division_id"] == home.id
    assert response.data["to_division_id"] == host.id
    assert response.data["document_basis"] == "Приказ №5"
    # Рукопожатие ещё не начиналось.
    assert response.data["return_requested_at"] is None
    assert response.data["return_confirmed_at"] is None
    # Кто откомандировал — из аутентификации.
    assert response.data["created_by"] == str(user.pk)
    # Ноги отданы идентификаторами и существуют.
    legs = OpsEmployeeStatus.objects.filter(
        pk__in=[response.data["out_status"], response.data["in_status"]]
    )
    assert {row.status_type_code for row in legs} == {"DETACHED", "ATTACHED"}


def test_home_division_from_body_is_ignored(types, home, host):
    # Присланное «откуда» не принимается: источник пары нельзя назначить.
    api, _ = client_for("sec-from-body", "ADMIN", ["*"])
    employee = make_employee(home)
    other = Division.objects.create(name="Управление 3")
    response = post(
        api,
        URL,
        create_body(employee, host, from_division_id=other.id, created_by="999"),
    )
    assert response.status_code == 201
    assert response.data["from_division_id"] == home.id
    assert response.data["created_by"] != "999"


@pytest.mark.parametrize(
    "missing", ["employee_id", "to_division_id", "date_start", "date_end"]
)
def test_missing_field_400(types, home, host, missing):
    api, _ = client_for(f"sec-missing-{missing}", "ADMIN", ["*"])
    body = create_body(make_employee(home), host)
    body.pop(missing)
    response = post(api, URL, body)
    assert response.status_code == 400
    assert missing in response.data


def test_same_division_400_envelope(types, home, host):
    api, _ = client_for("sec-same", "ADMIN", ["*"])
    employee = make_employee(home)
    response = post(api, URL, create_body(employee, home))
    assert response.status_code == 400
    assert response.data["error_code"] == "VALIDATION_ERROR"


def test_missing_host_division_404_envelope(types, home, host):
    api, _ = client_for("sec-nohost", "ADMIN", ["*"])
    employee = make_employee(home)
    body = create_body(employee, host)
    body["to_division_id"] = 999999
    response = post(api, URL, body)
    assert response.status_code == 404
    assert response.data["error_code"] == "ENTITY_NOT_FOUND"


def test_hard_overlap_422_envelope(types, home, host):
    api, _ = client_for("sec-hard", "ADMIN", ["*"])
    employee = make_employee(home)
    OpsEmployeeStatus.objects.create(
        employee_id=employee.id,
        status_type_code="VACATION",
        date_start=TODAY,
        date_end=TODAY + timedelta(days=3),
        source=OpsEmployeeStatus.Source.USER,
        created_by="seed",
    )
    response = post(api, URL, create_body(employee, host))
    assert response.status_code == 422
    assert response.data["error_code"] == "OVERLAPPING_HARD_STATUS"
    assert not Secondment.objects.exists()


def test_second_secondment_403_envelope(types, home, host):
    # Уже откомандированного нельзя откомандировать снова — отказ сервиса
    # доезжает конвертом, а не {detail} гейта.
    api, _ = client_for("sec-twice", "ADMIN", ["*"])
    employee = make_employee(home)
    seed_pair(employee, host, admin=api)
    third = Division.objects.create(name="Управление 3")
    response = post(api, URL, create_body(employee, third))
    assert response.status_code == 403
    assert response.data["error_code"] == "PERMISSION_DENIED"
    assert Secondment.objects.count() == 1


# ── Стороны рукопожатия ──────────────────────────────────────────────────

def test_home_operator_seconds_and_requests(types, home, host):
    # Штатный оператор: откомандировывает своего и запрашивает возврат.
    api, _ = client_for(
        "sec-home", "OPERATOR", ["status.manage"], scope_division_id=home.id
    )
    employee = make_employee(home)
    created = post(api, URL, create_body(employee, host))
    assert created.status_code == 201
    response = post(api, detail_url(created.data["id"], "request-return"))
    assert response.status_code == 200
    assert response.data["return_requested_at"] is not None


def test_home_operator_cannot_confirm(types, home, host):
    # Подтверждает ПРИНИМАЮЩАЯ сторона: иначе штатный оператор проводил бы
    # рукопожатие сам с собой, и подтверждение ничего не подтверждало бы.
    api, _ = client_for(
        "sec-home-confirm", "OPERATOR", ["status.manage"], scope_division_id=home.id
    )
    employee = make_employee(home)
    secondment = seed_pair(employee, host)
    post(api, detail_url(secondment.pk, "request-return"))
    response = post(api, detail_url(secondment.pk, "confirm-return"))
    assert response.status_code == 403
    assert response.data["error_code"] == "PERMISSION_DENIED"
    assert Secondment.objects.get(pk=secondment.pk).return_confirmed_at is None


def test_host_operator_confirms(types, home, host):
    api, _ = client_for(
        "sec-host", "OPERATOR", ["status.manage"], scope_division_id=host.id
    )
    employee = make_employee(home)
    secondment = seed_pair(employee, host)
    admin, _ = client_for("sec-host-requester", "ADMIN", ["*"])
    post(admin, detail_url(secondment.pk, "request-return"))
    response = post(api, detail_url(secondment.pk, "confirm-return"))
    assert response.status_code == 200
    assert response.data["return_confirmed_at"] is not None


def test_host_operator_cannot_request(types, home, host):
    # Обратная сторона: возврат запрашивает тот, КОМУ человека вернут.
    api, _ = client_for(
        "sec-host-request", "OPERATOR", ["status.manage"], scope_division_id=host.id
    )
    secondment = seed_pair(make_employee(home), host)
    response = post(api, detail_url(secondment.pk, "request-return"))
    assert response.status_code == 403
    assert response.data["error_code"] == "PERMISSION_DENIED"
    assert Secondment.objects.get(pk=secondment.pk).return_requested_at is None


def test_foreign_operator_cannot_second(types, home, host):
    other = Division.objects.create(name="Управление 3")
    api, _ = client_for(
        "sec-foreign", "OPERATOR", ["status.manage"], scope_division_id=other.id
    )
    employee = make_employee(home)
    response = post(api, URL, create_body(employee, host))
    assert response.status_code == 403
    assert response.data["error_code"] == "PERMISSION_DENIED"
    assert not Secondment.objects.exists()


def test_employee_without_staff_unit_403_for_scoped(types, home, host):
    # Сотрудник без штатной единицы не принадлежит ничьей области.
    api, _ = client_for(
        "sec-noslot", "OPERATOR", ["status.manage"], scope_division_id=home.id
    )
    employee = make_employee(None)
    response = post(api, URL, create_body(employee, host))
    assert response.status_code == 403
    assert response.data["error_code"] == "PERMISSION_DENIED"


def test_employee_without_staff_unit_422_for_wildcard(types, home, host):
    # У безскоупового актора области нет вовсе — его отклоняет уже сервис,
    # и по ДРУГОЙ причине: штатное подразделение неизвестно.
    api, _ = client_for("sec-noslot-admin", "ADMIN", ["*"])
    employee = make_employee(None)
    response = post(api, URL, create_body(employee, host))
    assert response.status_code == 422
    assert response.data["error_code"] == "VALIDATION_ERROR"


# ── Возврат ──────────────────────────────────────────────────────────────

def test_confirm_closes_the_pair(types, home, host):
    api, user = client_for("sec-confirm", "ADMIN", ["*"])
    employee = make_employee(home)
    secondment = seed_pair(employee, host, admin=api)
    post(api, detail_url(secondment.pk, "request-return"))
    response = post(api, detail_url(secondment.pk, "confirm-return"))
    assert response.status_code == 200
    assert response.data["return_confirmed_by"] == str(user.pk)
    # Обе ноги заканчиваются завтра: возврат вступает в силу со следующего дня.
    for leg in OpsEmployeeStatus.objects.filter(
        pk__in=[secondment.out_status_id, secondment.in_status_id]
    ):
        assert leg.date_end == TODAY + timedelta(days=1)


def test_confirm_without_request_422_envelope(types, home, host):
    api, _ = client_for("sec-noreq", "ADMIN", ["*"])
    secondment = seed_pair(make_employee(home), host, admin=api)
    response = post(api, detail_url(secondment.pk, "confirm-return"))
    assert response.status_code == 422
    assert response.data["error_code"] == "INVALID_LIFECYCLE_TRANSITION"


def test_double_request_422_envelope(types, home, host):
    api, _ = client_for("sec-doublereq", "ADMIN", ["*"])
    secondment = seed_pair(make_employee(home), host, admin=api)
    assert post(api, detail_url(secondment.pk, "request-return")).status_code == 200
    response = post(api, detail_url(secondment.pk, "request-return"))
    assert response.status_code == 422
    assert response.data["error_code"] == "INVALID_LIFECYCLE_TRANSITION"


def test_confirm_reason_reaches_cancelled_legs(types, home, host):
    # Не начавшаяся пара отменяется, и присланная причина уходит в её факты.
    api, _ = client_for("sec-reason", "ADMIN", ["*"])
    employee = make_employee(home)
    response = post(
        api,
        URL,
        create_body(
            employee,
            host,
            date_start=(TODAY + timedelta(days=5)).isoformat(),
            date_end=(TODAY + timedelta(days=9)).isoformat(),
        ),
    )
    secondment = Secondment.objects.get(pk=response.data["id"])
    post(api, detail_url(secondment.pk, "request-return"))
    assert (
        post(
            api,
            detail_url(secondment.pk, "confirm-return"),
            {"reason": "приказ отозван"},
        ).status_code
        == 200
    )
    for leg in OpsEmployeeStatus.objects.filter(
        pk__in=[secondment.out_status_id, secondment.in_status_id]
    ):
        assert leg.cancelled_reason == "приказ отозван"


@pytest.mark.parametrize("action", ["request-return", "confirm-return"])
def test_missing_secondment_404_envelope(types, home, host, action):
    api, _ = client_for(f"sec-404-{action}", "ADMIN", ["*"])
    response = post(api, detail_url(999999, action))
    assert response.status_code == 404
    assert response.data["error_code"] == "ENTITY_NOT_FOUND"


@pytest.mark.parametrize("action", ["request-return", "confirm-return"])
def test_garbage_id_404_envelope(types, home, host, action):
    api, _ = client_for(f"sec-garbage-{action}", "ADMIN", ["*"])
    response = post(api, detail_url("abc", action))
    assert response.status_code == 404
    assert response.data["error_code"] == "ENTITY_NOT_FOUND"


# ── Поверхность метода ───────────────────────────────────────────────────

@pytest.mark.parametrize("method", ["put", "patch", "delete"])
def test_write_methods_are_not_served(types, home, host, method):
    # Пару не переписывают и не удаляют: её единственная законная «правка» —
    # возврат отдельным действием. 405, а не дезориентирующий 403.
    api, _ = client_for(f"sec-method-{method}", "ADMIN", ["*"])
    secondment = seed_pair(make_employee(home), host, admin=api)
    with clock.override(TODAY):
        collection = getattr(api, method)(URL, {}, format="json")
        detail = getattr(api, method)(f"{URL}{secondment.pk}/", {}, format="json")
    assert collection.status_code == 405
    assert detail.status_code == 405


# ── Чтение пар ───────────────────────────────────────────────────────────

def ids_of(response):
    return [row["id"] for row in response.data["results"]]


def get(api, url=URL, **params):
    with clock.override(TODAY):
        return api.get(url, params)


def test_list_requires_status_view(types, home, host):
    # Право ЗАПИСИ пар их чтения не открывает: гейты разные.
    api, _ = client_for("sec-list-writer", "OPERATOR", ["status.manage"])
    assert_denied_by_gate(get(api))


def test_list_returns_pairs_with_derived_state(types, home, host):
    admin, _ = client_for("sec-list", "ADMIN", ["*"])
    reader, _ = client_for("sec-list-reader", "VIEWER", ["status.view"])
    secondment = seed_pair(make_employee(home), host, admin=admin)
    response = get(reader)
    assert response.status_code == 200
    (row,) = response.data["results"]
    assert row["id"] == secondment.pk
    assert row["from_division_id"] == home.id
    assert row["to_division_id"] == host.id
    # Стадию выводит сервер, клиенту незачем повторять этот вывод.
    assert row["state"] == "INITIATED"


def test_state_advances_with_the_handshake(types, home, host):
    api, _ = client_for("sec-list-state", "ADMIN", ["*"])
    secondment = seed_pair(make_employee(home), host, admin=api)
    post(api, detail_url(secondment.pk, "request-return"))
    assert get(api).data["results"][0]["state"] == "RETURN_REQUESTED"
    post(api, detail_url(secondment.pk, "confirm-return"))
    assert get(api).data["results"][0]["state"] == "RETURNED"


def test_state_filter_matches_the_field(types, home, host):
    # Фильтр и поле в строке — один и тот же вывод: если бы они разошлись,
    # список по стадии возвращал бы строки с другой стадией внутри.
    api, _ = client_for("sec-list-filter", "ADMIN", ["*"])
    fresh = seed_pair(make_employee(home), host, admin=api)
    requested = seed_pair(make_employee(home), host, admin=api)
    returned = seed_pair(make_employee(home), host, admin=api)
    post(api, detail_url(requested.pk, "request-return"))
    post(api, detail_url(returned.pk, "request-return"))
    post(api, detail_url(returned.pk, "confirm-return"))

    expected = {
        "INITIATED": fresh.pk,
        "RETURN_REQUESTED": requested.pk,
        "RETURNED": returned.pk,
    }
    for state, pk in expected.items():
        response = get(api, state=state)
        assert ids_of(response) == [pk], state
        assert response.data["results"][0]["state"] == state


def test_unknown_state_400(types, home, host):
    api, _ = client_for("sec-list-badstate", "ADMIN", ["*"])
    response = get(api, state="ВЕРНУЛСЯ")
    assert response.status_code == 400
    assert "state" in response.data


def test_employee_filter(types, home, host):
    api, _ = client_for("sec-list-emp", "ADMIN", ["*"])
    mine = seed_pair(make_employee(home), host, admin=api)
    seed_pair(make_employee(home), host, admin=api)
    response = get(api, employee_id=mine.employee_id)
    assert ids_of(response) == [mine.pk]


def test_order_is_set_by_server(types, home, host):
    # Три пары: на двух «свежие первыми» совпало бы со случайной выдачей БД.
    api, _ = client_for("sec-list-order", "ADMIN", ["*"])
    first = seed_pair(make_employee(home), host, admin=api)
    second = seed_pair(make_employee(home), host, admin=api)
    third = seed_pair(make_employee(home), host, admin=api)
    assert ids_of(get(api)) == [third.pk, second.pk, first.pk]


def test_pair_is_visible_to_both_sides(types, home, host):
    # У откомандирования два участника: и штатное, и принимающее видят пару
    # целиком. Чужая пара при этом не видна ни одному из них.
    admin, _ = client_for("sec-sides-admin", "ADMIN", ["*"])
    secondment = seed_pair(make_employee(home), host, admin=admin)
    outsider_a = Division.objects.create(name="Управление 3")
    outsider_b = Division.objects.create(name="Управление 4")
    foreign = seed_pair(make_employee(outsider_a), outsider_b, admin=admin)

    for name, division in (("home", home), ("host", host)):
        api, _ = client_for(
            f"sec-sides-{name}", "VIEWER", ["status.view"], scope_division_id=division.id
        )
        assert ids_of(get(api)) == [secondment.pk]
        assert foreign.pk not in ids_of(get(api))


def test_outsider_sees_nothing(types, home, host):
    admin, _ = client_for("sec-out-admin", "ADMIN", ["*"])
    secondment = seed_pair(make_employee(home), host, admin=admin)
    other = Division.objects.create(name="Управление 3")
    api, _ = client_for(
        "sec-out", "VIEWER", ["status.view"], scope_division_id=other.id
    )
    assert ids_of(get(api)) == []
    # Пара существует и видна безскоуповому — отсутствие выше это область.
    assert secondment.pk in ids_of(get(admin))


def test_division_filter_covers_both_sides(types, home, host):
    api, _ = client_for("sec-divfilter", "ADMIN", ["*"])
    secondment = seed_pair(make_employee(home), host, admin=api)
    other = Division.objects.create(name="Управление 3")
    seed_pair(make_employee(other), Division.objects.create(name="У4"), admin=api)
    # Пара находится и по стороне «откуда», и по стороне «куда».
    assert ids_of(get(api, division_id=home.id)) == [secondment.pk]
    assert ids_of(get(api, division_id=host.id)) == [secondment.pk]


def test_foreign_division_filter_403(types, home, host):
    other = Division.objects.create(name="Управление 3")
    api, _ = client_for(
        "sec-divforeign", "VIEWER", ["status.view"], scope_division_id=home.id
    )
    response = get(api, division_id=other.id)
    assert_denied_by_gate(response)


def test_retrieve_returns_the_pair(types, home, host):
    admin, _ = client_for("sec-rtv-admin", "ADMIN", ["*"])
    secondment = seed_pair(make_employee(home), host, admin=admin)
    api, _ = client_for(
        "sec-rtv", "VIEWER", ["status.view"], scope_division_id=host.id
    )
    response = get(api, f"{URL}{secondment.pk}/")
    assert response.status_code == 200
    assert response.data["id"] == secondment.pk
    assert response.data["state"] == "INITIATED"


def test_retrieve_outsider_403_envelope(types, home, host):
    admin, _ = client_for("sec-rtv-out-admin", "ADMIN", ["*"])
    secondment = seed_pair(make_employee(home), host, admin=admin)
    other = Division.objects.create(name="Управление 3")
    api, _ = client_for(
        "sec-rtv-out", "VIEWER", ["status.view"], scope_division_id=other.id
    )
    response = get(api, f"{URL}{secondment.pk}/")
    # Конверт области, а не {detail} гейта: право на чтение у оператора ЕСТЬ.
    assert response.status_code == 403
    assert response.data["error_code"] == "PERMISSION_DENIED"


@pytest.mark.parametrize("pk", [999999, "abc"])
def test_retrieve_missing_404_envelope(types, home, host, pk):
    api, _ = client_for(f"sec-rtv-404-{pk}", "ADMIN", ["*"])
    response = get(api, f"{URL}{pk}/")
    assert response.status_code == 404
    assert response.data["error_code"] == "ENTITY_NOT_FOUND"
