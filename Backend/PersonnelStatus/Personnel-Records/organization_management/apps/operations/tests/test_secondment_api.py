"""Historical secondment reads retain RBAC, scope, filters and derived state.

New business mutations are retired; history fixtures use internal services.
"""
from datetime import timedelta

import pytest
from rest_framework.test import APIClient

from organization_management.apps.divisions.models import Division
from organization_management.apps.operations import clock
from organization_management.apps.operations.secondment_service import (
    initiate_secondment, request_return, confirm_return,
)
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
    """Historical fixture; the retired API never creates new pairs."""
    with clock.override(TODAY):
        return initiate_secondment(
            employee.id, to_division_id=host_division.id,
            date_start=TODAY, date_end=TODAY + timedelta(days=10),
            actor="historical-fixture",
        )


def historical_request_return(secondment):
    with clock.override(TODAY):
        request_return(secondment, actor="historical-fixture")


def historical_confirm_return(secondment):
    with clock.override(TODAY):
        confirm_return(secondment, actor="historical-fixture", reason="Historical return")


def assert_denied_by_gate(response):
    """403 ГЕЙТА права, а не области: оба 403, различает форма (гейт →
    {detail} DRF, область → конверт {error_code})."""
    assert response.status_code == 403
    assert response.data["detail"] == "PERMISSION_DENIED"
    assert "error_code" not in response.data


def test_anonymous_401(types, home, host):
    employee = make_employee(home)
    response = post(APIClient(), URL, create_body(employee, host))
    assert response.status_code == 401
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
    historical_request_return(secondment)
    assert get(api).data["results"][0]["state"] == "RETURN_REQUESTED"
    historical_confirm_return(secondment)
    assert get(api).data["results"][0]["state"] == "RETURNED"


def test_state_filter_matches_the_field(types, home, host):
    # Фильтр и поле в строке — один и тот же вывод: если бы они разошлись,
    # список по стадии возвращал бы строки с другой стадией внутри.
    api, _ = client_for("sec-list-filter", "ADMIN", ["*"])
    fresh = seed_pair(make_employee(home), host, admin=api)
    requested = seed_pair(make_employee(home), host, admin=api)
    returned = seed_pair(make_employee(home), host, admin=api)
    historical_request_return(requested)
    historical_request_return(returned)
    historical_confirm_return(returned)

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
