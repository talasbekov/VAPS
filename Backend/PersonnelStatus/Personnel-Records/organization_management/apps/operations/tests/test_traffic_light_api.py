"""GET /api/operations/traffic-light/tree/ — свод светофора наружу.

Зона вьюхи: гейт права, порядок гардов (область → существование), вывод
корня из области, дефолт даты по часам раздела и её эхо, сборка узла
(имя, родитель) и полный порядок. Сами цвета считает свод и покрывает
test_traffic_light_tree.py — здесь проверяется, что вьюха их не пересчитывает.
"""
from datetime import timedelta

import pytest
from django.db import connection
from django.test.utils import CaptureQueriesContext
from rest_framework.test import APIClient

from organization_management.apps.divisions.models import Division
from organization_management.apps.operations import clock
from organization_management.apps.operations.day_submission_service import submit_day
from organization_management.apps.operations.services import PermissionService
from organization_management.apps.operations.traffic_light import TrafficLightStatus
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

URL = "/api/operations/traffic-light/tree/"
READ_PERMS = ["status.view"]


@pytest.fixture
def tree():
    root = Division.objects.create(name="Управление")
    first = Division.objects.create(name="Отдел 1", parent=root)
    second = Division.objects.create(name="Отдел 2", parent=root)
    return root, first, second


def submit(division, business_date=TODAY):
    with clock.override(MORNING):
        return submit_day(
            division_id=division.id, business_date=business_date, actor="7"
        )


def get(api, **params):
    with clock.override(MORNING):
        return api.get(URL, params)


def nodes_by_id(response):
    return {node["division_id"]: node for node in response.data["nodes"]}


# ── Гейт права ───────────────────────────────────────────────────────────

def assert_denied_by_gate(response):
    assert response.status_code == 403
    assert response.data["detail"] == "PERMISSION_DENIED"
    assert "error_code" not in response.data


def test_anonymous_403(types, tree):
    assert_denied_by_gate(get(APIClient()))


def test_write_right_alone_does_not_open_the_tree(types, tree):
    api, _ = client_for("tl-writer", "WRITER", ["daily_report.mark_update"])
    assert_denied_by_gate(get(api))


def test_viewer_sees_the_tree(types, tree):
    root, *_ = tree
    api, _ = client_for("tl-viewer", "VIEWER", READ_PERMS)
    in_slot(root)
    response = get(api, root_division_id=root.id)
    assert response.status_code == 200
    assert nodes_by_id(response)[root.id]["status"] == TrafficLightStatus.RED.value


# ── Область и существование ──────────────────────────────────────────────

def test_foreign_root_is_403_envelope(types, tree):
    root, first, second = tree
    api, _ = client_for(
        "tl-scoped", "VIEWER", READ_PERMS, scope_division_id=first.id
    )
    response = get(api, root_division_id=second.id)
    assert response.status_code == 403
    assert response.data["error_code"] == "PERMISSION_DENIED"


def test_missing_root_is_404_envelope(types, tree):
    root, *_ = tree
    api, _ = client_for("tl-404", "ADMIN", ["*"])
    response = get(api, root_division_id=root.id + 10_000)
    assert response.status_code == 404
    assert response.data["error_code"] == "ENTITY_NOT_FOUND"


def test_scope_is_checked_before_existence(types, tree):
    # Иначе разница 404/403 работала бы оракулом существования для чужака.
    root, first, _ = tree
    api, _ = client_for(
        "tl-oracle", "VIEWER", READ_PERMS, scope_division_id=first.id
    )
    response = get(api, root_division_id=root.id + 10_000)
    assert response.status_code == 403
    assert response.data["error_code"] == "PERMISSION_DENIED"


# ── Корень из области ────────────────────────────────────────────────────

def test_root_defaults_to_the_actors_scope(types, tree):
    # Экран руководителя не обязан знать, какой у него корень.
    root, first, second = tree
    api, _ = client_for(
        "tl-default", "VIEWER", READ_PERMS, scope_division_id=first.id
    )
    in_slot(first)
    response = get(api)
    assert set(nodes_by_id(response)) == {first.id}


def test_global_grant_starts_from_the_top_of_the_tree(types, tree):
    root, first, second = tree
    api, _ = client_for("tl-global", "ADMIN", ["*"])
    response = get(api)
    assert set(nodes_by_id(response)) == {root.id, first.id, second.id}


def test_scope_resolves_to_the_minimal_set_of_roots(types, tree):
    """Корнями считаются узлы, чей родитель вне области.

    Ответ от этого не меняется (свод собирается в словарь, дубли схлопнулись
    бы молча) — меняется ЦЕНА: свод от каждого узла области означал бы
    полный пересчёт поддерева на каждый узел. Поэтому проверяется стоимость,
    сравнением с тем же ответом по явно заданному корню.
    """
    root, first, second = tree
    api, _ = client_for(
        "tl-nested", "VIEWER", READ_PERMS, scope_division_id=root.id
    )
    explicit_api, _ = client_for("tl-nested-admin", "ADMIN", ["*"])
    with CaptureQueriesContext(connection) as derived:
        from_scope = get(api)
    with CaptureQueriesContext(connection) as explicit:
        from_root = get(explicit_api, root_division_id=root.id)
    assert set(nodes_by_id(from_scope)) == set(nodes_by_id(from_root))
    assert len(derived.captured_queries) <= len(explicit.captured_queries) + 1


def test_an_empty_scope_returns_nothing_not_everything(types, tree, monkeypatch):
    """Пустая область — это «не видно ничего», а не «видно всё».

    Ветка недостижима за грубым гейтом (у актора без грантов нет и права), и
    именно поэтому опечатка `if not visible` вместо `is None` жила бы
    незамеченной, отдавая всё дерево тому, кому не выдано ничего. Область
    подменяется напрямую — иначе проверять нечем.
    """
    root, *_ = tree
    api, _ = client_for("tl-empty-scope", "VIEWER", READ_PERMS)
    monkeypatch.setattr(
        PermissionService, "visible_division_ids", staticmethod(lambda *a, **k: set())
    )
    response = get(api)
    assert response.status_code == 200
    assert response.data["nodes"] == []


# ── Сборка узла ──────────────────────────────────────────────────────────

def test_node_carries_name_and_parent(types, tree):
    root, first, second = tree
    api, _ = client_for("tl-node", "ADMIN", ["*"])
    response = get(api, root_division_id=root.id)
    nodes = nodes_by_id(response)
    assert nodes[first.id]["name"] == "Отдел 1"
    assert nodes[first.id]["parent_id"] == root.id
    # Родитель корня в ответ не попал — ссылки на него быть не должно.
    assert nodes[root.id]["parent_id"] is None


def test_parent_outside_the_answer_is_null(types, tree):
    root, first, _ = tree
    api, _ = client_for("tl-parent", "ADMIN", ["*"])
    response = get(api, root_division_id=first.id)
    assert nodes_by_id(response)[first.id]["parent_id"] is None


def test_nodes_are_ordered_by_name_then_id(types):
    # Три узла и повтор имени: на двух «порядок задаёт сервер» доказать нечем.
    root = Division.objects.create(name="Б")
    same_a = Division.objects.create(name="А", parent=root)
    same_b = Division.objects.create(name="А", parent=same_a)
    api, _ = client_for("tl-order", "ADMIN", ["*"])
    response = get(api, root_division_id=root.id)
    assert [node["division_id"] for node in response.data["nodes"]] == [
        same_a.id,
        same_b.id,
        root.id,
    ]


def test_view_does_not_recompute_the_colour(types, tree):
    root, first, second = tree
    api, _ = client_for("tl-colour", "ADMIN", ["*"])
    employee = in_slot(first)
    submit(first)
    fact(employee, code="DUTY")
    in_slot(second)
    nodes = nodes_by_id(get(api, root_division_id=root.id))
    assert nodes[first.id]["status"] == TrafficLightStatus.YELLOW.value
    assert nodes[second.id]["status"] == TrafficLightStatus.RED.value
    assert nodes[root.id]["status"] == TrafficLightStatus.RED.value
    assert nodes[root.id]["late"] is False


# ── Дата ─────────────────────────────────────────────────────────────────

def test_date_defaults_to_today_and_comes_back_as_an_echo(types, tree):
    # Сервер считает по своим часам, экран — по браузеру; на границе суток
    # «сегодня» у них разное, поэтому дата возвращается явно.
    root, *_ = tree
    api, _ = client_for("tl-today", "ADMIN", ["*"])
    response = get(api, root_division_id=root.id)
    assert response.data["business_date"] == TODAY.isoformat()


def test_tomorrow_is_a_legitimate_question(types, tree):
    # Сдача «на завтра» — штатный режим раздела, и запрет будущей даты
    # (как в источнике) закрыл бы просмотр завтрашней готовности.
    root, *_ = tree
    api, _ = client_for("tl-tomorrow", "ADMIN", ["*"])
    tomorrow = TODAY + timedelta(days=1)
    in_slot(root)
    submit(root, business_date=tomorrow)
    response = get(api, root_division_id=root.id, business_date=tomorrow.isoformat())
    assert response.data["business_date"] == tomorrow.isoformat()
    assert (
        nodes_by_id(response)[root.id]["status"] == TrafficLightStatus.GREEN.value
    )


def test_a_day_before_any_submission_is_red_not_green(types, tree):
    # Ловушка источника: на доисторической дате победители выводятся как «в
    # строю» и цвет мог бы оказаться зелёным. Здесь сдачи за тот день нет, а
    # значит цвет красный — отдельный гард «начала данных» не нужен.
    root, *_ = tree
    api, _ = client_for("tl-early", "ADMIN", ["*"])
    in_slot(root)
    submit(root)
    response = get(
        api,
        root_division_id=root.id,
        business_date=(TODAY - timedelta(days=365)).isoformat(),
    )
    assert nodes_by_id(response)[root.id]["status"] == TrafficLightStatus.RED.value


@pytest.mark.parametrize(
    "params, field",
    [
        ({"business_date": "вчера"}, "business_date"),
        ({"root_division_id": "первое"}, "root_division_id"),
    ],
)
def test_broken_params_are_400(types, tree, params, field):
    api, _ = client_for(f"tl-bad-{field}", "ADMIN", ["*"])
    response = get(api, **params)
    assert response.status_code == 400
    assert field in response.data


# ── Поверхность ──────────────────────────────────────────────────────────

@pytest.mark.parametrize("method", ["post", "put", "patch", "delete"])
def test_the_tree_is_read_only(types, tree, method):
    api, _ = client_for(f"tl-method-{method}", "ADMIN", ["*"])
    with clock.override(MORNING):
        response = getattr(api, method)(URL, {}, format="json")
    assert response.status_code == 405
