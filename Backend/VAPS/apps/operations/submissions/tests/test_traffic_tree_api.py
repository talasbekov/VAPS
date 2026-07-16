"""Story 10.4 — GET traffic-tree (/api/operations/daily-submissions/traffic-tree/).

REST-роут «светофор-дерева» поверх готового каскада 5.5b: RBAC-видимость актора
(``visible_division_ids`` под ``status.view``) выводит корни леса, forest-обёртка
считает ``status``/``late`` байт-в-байт с ``traffic_light_tree``, роут дособирает
``name``/``parent_id`` из core-справочника. Проверяется HTTP-контракт:

- AC-1: плоский список nodes ровно по поддереву scoped-актора, поля узла,
  ``parent_id = null`` у корня видимой области, порядок ``(name, division_id)``;
- AC-2: паритет с ``traffic_light_tree`` — RED-каскад несданного листа, YELLOW
  drift, NEUTRAL пустого подразделения, late OR вверх;
- AC-3: глобальный грант → все подразделения, корни = top-level;
- AC-4: чужое поддерево отсутствует; без ``status.view`` → 403; грант с пустой
  (фантомной) видимостью → 200 ``nodes: []`` (Д5-канон 5.8c), не 403;
- AC-5: 400 мусорная/отсутствующая дата; 422 REPORT_NO_DATA_FOR_DATE до
  горизонта данных; будущая дата НЕ блокируется (честный RED-лес);
- AC-6: NFR-пин — число запросов константно по (N подразделений, K корней);
- unit: ``traffic_light_forest`` — union корней, паритет per-root, folding-гвард.

Auth via HTTP_X_USER_ID (канон 5.8-сюит); роли — seed_operations + прямые
UserRole; Clock запинен clock.override.
"""

import uuid
from datetime import date, timedelta

import pytest
from django.core.management import call_command
from django.db import connection
from django.test.utils import CaptureQueriesContext
from django.urls import reverse
from rest_framework.test import APIClient

from apps.core import clock
from apps.core.models import (
    Division,
    DivisionType,
    Employee,
    Organization,
)
from apps.operations.rbac.models import UserRole
from apps.operations.statuses.models import EmployeeStatus
from apps.operations.submissions.models import DailySubmission
from apps.operations.submissions.services import submit_day
from apps.operations.submissions.traffic_light import (
    TrafficLightStatus,
    traffic_light_forest,
    traffic_light_tree,
)

pytestmark = pytest.mark.django_db

TODAY = date(2026, 6, 4)
HORIZON_START = date(2026, 5, 1)  # earliest status fact → report_data_horizon

NODE_FIELDS = {"division_id", "name", "parent_id", "status", "late"}


@pytest.fixture(autouse=True)
def frozen_clock():
    with clock.override(TODAY):
        yield


@pytest.fixture
def forest():
    """seed_operations roles + два top-level дерева.

    rootA («alpha») → childA1 («beta», сотрудник) → grandA («delta»),
                    → childA2 («gamma», пустое);
    rootB («omega») → childB («sigma», сотрудник).

    Сотрудник childA1 несёт ранний статус-факт: report_data_horizon =
    HORIZON_START — иначе пустой системе ЛЮБАЯ дата даёт 422 (6.10a).
    """
    call_command("seed_operations")
    org = Organization.objects.create(name="HQ", code="HQ-TT")
    dt = DivisionType.objects.get_or_create(
        code="management", defaults={"name": "Управление"}
    )[0]

    def div(name, code, parent=None):
        return Division.objects.create(
            organization=org, type_code=dt, name=name, code=code, parent=parent
        )

    root_a = div("alpha", "TT-A")
    child_a1 = div("beta", "TT-A1", parent=root_a)
    child_a2 = div("gamma", "TT-A2", parent=root_a)
    grand_a = div("delta", "TT-A1G", parent=child_a1)
    root_b = div("omega", "TT-B")
    child_b = div("sigma", "TT-B1", parent=root_b)

    emp_a1 = make_employee(child_a1)
    make_status(emp_a1, "DUTY", HORIZON_START, date(2026, 7, 1))
    make_employee(child_b)
    return {
        "org": org,
        "dt": dt,
        "root_a": root_a,
        "child_a1": child_a1,
        "child_a2": child_a2,
        "grand_a": grand_a,
        "root_b": root_b,
        "child_b": child_b,
        "emp_a1": emp_a1,
    }


@pytest.fixture
def viewer_a(forest):
    """VIEWER (держит status.view), scoped на rootA."""
    UserRole.objects.create(
        user_id="viewer-a",
        role_code_id="VIEWER",
        scope_division_id=forest["root_a"].id,
    )
    return "viewer-a"


@pytest.fixture
def viewer_global(forest):
    """VIEWER с глобальной (безскоуповой) ролью."""
    UserRole.objects.create(
        user_id="viewer-global", role_code_id="VIEWER", scope_division_id=None
    )
    return "viewer-global"


_iin = iter(range(810_000, 900_000))


def make_employee(division):
    n = next(_iin)
    return Employee.objects.create(
        iin=f"{n:012d}",
        full_name=f"Сотрудник {n}",
        rank_code="",
        position_code="",
        division=division,
        employment_status="WORKING",
    )


def make_status(emp, code, date_start, date_end):
    return EmployeeStatus.objects.create(
        employee_id=emp.id,
        status_type_code=code,
        date_start=date_start,
        date_end=date_end,
        source="USER",
    )


def _submit(division, business_date=TODAY):
    with clock.override(business_date):
        return submit_day(
            division_id=division.id, business_date=business_date, actor="op"
        )


def _client(actor):
    c = APIClient()
    if actor is not None:
        c.credentials(HTTP_X_USER_ID=actor)
    return c


def _get(actor, business_date=TODAY):
    params = {}
    if business_date is not None:
        params["business_date"] = str(business_date)
    return _client(actor).get(reverse("ops-daily-submission-traffic-tree"), params)


def _by_id(payload):
    return {node["division_id"]: node for node in payload["nodes"]}


# -- AC-1: контракт роута --------------------------------------------------------


def test_contract_scoped_subtree_shape_and_order(viewer_a, forest):
    """Поддерево A целиком, поля узла, parent_id корня = null, порядок (name, id)."""
    response = _get(viewer_a)
    assert response.status_code == 200
    nodes = response.json()["nodes"]
    by_id = {node["division_id"]: node for node in nodes}
    expected_ids = {
        str(forest[key].id) for key in ("root_a", "child_a1", "child_a2", "grand_a")
    }
    assert set(by_id) == expected_ids
    for node in nodes:
        assert set(node) == NODE_FIELDS
    root_node = by_id[str(forest["root_a"].id)]
    assert root_node["parent_id"] is None  # корень видимой области
    assert by_id[str(forest["child_a1"].id)]["parent_id"] == str(forest["root_a"].id)
    assert by_id[str(forest["grand_a"].id)]["parent_id"] == str(forest["child_a1"].id)
    # Детерминированная сортировка (name, division_id) — зеркало day-state.
    assert nodes == sorted(nodes, key=lambda node: (node["name"], node["division_id"]))
    assert root_node["name"] == "alpha"


# -- AC-2: паритет с 5.5b --------------------------------------------------------


def test_parity_with_traffic_light_tree(viewer_a, forest):
    """status/late каждого узла == traffic_light_tree(A) байт-в-байт.

    Состояние: childA1 сдан с drift (YELLOW, late=True вручную), grandA и
    childA2 пусты без сдачи (NEUTRAL), rootA не сдан со своим сотрудником (RED
    own) → каскад RED у корня, late OR-ится вверх.
    """
    make_employee(forest["root_a"])  # rootA own-roster непуст → RED без сдачи
    submission = _submit(forest["child_a1"])
    # drift: derived-победитель уехал ПОСЛЕ сдачи → YELLOW
    make_status(forest["emp_a1"], "SICK_LEAVE", date(2026, 6, 1), date(2026, 6, 20))
    # late листа — прямой update (контрольный час в тесте не воспроизводим)
    DailySubmission.objects.filter(pk=submission.pk).update(late=True)

    expected = traffic_light_tree(forest["root_a"].id, TODAY)
    rows = _by_id(_get(viewer_a).json())
    assert set(rows) == {str(did) for did in expected}
    for did, light in expected.items():
        assert rows[str(did)]["status"] == light.status
        assert rows[str(did)]["late"] == light.late
    # Смысловые якоря (не только паритет с самим собой):
    assert rows[str(forest["child_a1"].id)]["status"] == "YELLOW"
    assert rows[str(forest["child_a1"].id)]["late"] is True
    assert rows[str(forest["child_a2"].id)]["status"] == "NEUTRAL"
    assert rows[str(forest["root_a"].id)]["status"] == "RED"  # worst вверх
    assert rows[str(forest["root_a"].id)]["late"] is True  # OR вверх


def test_red_leaf_cascades_to_root(viewer_a, forest):
    """Несданный лист с ростером → RED у листа И у корня (worst-colour)."""
    rows = _by_id(_get(viewer_a).json())
    assert rows[str(forest["child_a1"].id)]["status"] == "RED"
    assert rows[str(forest["root_a"].id)]["status"] == "RED"


# -- AC-3: глобальная видимость --------------------------------------------------


def test_global_grant_sees_all_top_level_roots(viewer_global, forest):
    """Глобальный грант → ВСЕ подразделения; корни = top-level (parent_id null)."""
    rows = _by_id(_get(viewer_global).json())
    for key in ("root_a", "child_a1", "child_a2", "grand_a", "root_b", "child_b"):
        assert str(forest[key].id) in rows
    assert rows[str(forest["root_a"].id)]["parent_id"] is None
    assert rows[str(forest["root_b"].id)]["parent_id"] is None
    assert rows[str(forest["child_b"].id)]["parent_id"] == str(forest["root_b"].id)


# -- AC-4: RBAC-скоуп ------------------------------------------------------------


def test_scoped_actor_never_sees_foreign_subtree(viewer_a, forest):
    """Ненулевой дискриминатор: соседнее дерево B посеяно и отсутствует."""
    rows = _by_id(_get(viewer_a).json())
    assert str(forest["root_b"].id) not in rows
    assert str(forest["child_b"].id) not in rows


def test_actor_without_status_view_403(forest):
    """ORGD держит daily_report.generate, НЕ status.view → 403 (Q-RBAC, Д)."""
    UserRole.objects.create(user_id="orgd-tt", role_code_id="ORGD")
    response = _get("orgd-tt")
    assert response.status_code == 403
    assert response.json()["error_code"] == "PERMISSION_DENIED"


def test_anonymous_403(forest):
    assert _get(None).status_code == 403


def test_grant_with_empty_visibility_200_empty_nodes(forest):
    """Грант есть, но видимость пуста (scope — фантомный UUID: подразделение
    удалено после выдачи) → 200 nodes: [] (Д5-канон 5.8c), не 403 и не 500."""
    UserRole.objects.create(
        user_id="viewer-phantom",
        role_code_id="VIEWER",
        scope_division_id=uuid.uuid4(),
    )
    response = _get("viewer-phantom")
    assert response.status_code == 200
    assert response.json() == {"nodes": []}


# -- AC-5: гейты входа -----------------------------------------------------------


def test_missing_date_400(viewer_a):
    response = _get(viewer_a, business_date=None)
    assert response.status_code == 400
    assert response.json()["error_code"] == "VALIDATION_ERROR"


def test_garbage_date_400(viewer_a):
    response = _get(viewer_a, business_date="не-дата")
    assert response.status_code == 400
    assert response.json()["error_code"] == "VALIDATION_ERROR"


def test_date_before_data_horizon_422(viewer_a):
    """Дата до горизонта данных → 422, а не ложно-зелёный/нейтральный лес (P6)."""
    response = _get(viewer_a, business_date=HORIZON_START - timedelta(days=1))
    assert response.status_code == 422
    assert response.json()["error_code"] == "REPORT_NO_DATA_FOR_DATE"


def test_future_date_not_blocked_honest_red_forest(viewer_a, forest):
    """Будущая дата легальна (прецедент day-state): завтра = честный RED-лес."""
    response = _get(viewer_a, business_date=TODAY + timedelta(days=1))
    assert response.status_code == 200
    rows = _by_id(response.json())
    assert rows[str(forest["child_a1"].id)]["status"] == "RED"


# -- AC-6: NFR-пин — константа запросов ------------------------------------------


def test_query_count_constant_in_divisions_and_roots(viewer_global, forest):
    """Число SQL-запросов не растёт ни по N подразделений, ни по K корней.

    Малое состояние: 6 подразделений / 2 top-level корня. Большое: +2 корня и
    +7 подразделений (итого 15/4), часть — со сдачами. Паттерн — один
    children_map + один roster_on + один overlapping_on + один current_for_many
    на ВЕСЬ лес (никогда per-root traffic_light_tree в цикле).
    """
    _submit(forest["child_a1"])
    response = _get(viewer_global)
    assert response.status_code == 200
    with CaptureQueriesContext(connection) as ctx_small:
        _get(viewer_global)

    org, dt = forest["org"], forest["dt"]
    for i in range(2):
        extra_root = Division.objects.create(
            organization=org, type_code=dt, name=f"xroot{i}", code=f"TT-XR{i}"
        )
        make_employee(extra_root)
        _submit(extra_root)
        for j in range(2):
            Division.objects.create(
                organization=org,
                type_code=dt,
                name=f"xchild{i}{j}",
                code=f"TT-XC{i}{j}",
                parent=extra_root,
            )
    for i in range(3):
        Division.objects.create(
            organization=org, type_code=dt, name=f"xflat{i}", code=f"TT-XF{i}"
        )
    with CaptureQueriesContext(connection) as ctx_big:
        response = _get(viewer_global)
    assert response.status_code == 200
    assert len(ctx_big) == len(ctx_small), (
        f"NFR-4: {len(ctx_small)} запросов на малом лесу, "
        f"{len(ctx_big)} на большом — эндпоинт растёт по состоянию"
    )


# -- unit: traffic_light_forest --------------------------------------------------


def test_forest_parity_with_per_root_trees(forest):
    """forest(двух корней) == merge(traffic_light_tree по каждому корню)."""
    make_employee(forest["root_a"])
    _submit(forest["child_a1"])
    result = traffic_light_forest([forest["root_a"].id, forest["root_b"].id], TODAY)
    expected = {
        **traffic_light_tree(forest["root_a"].id, TODAY),
        **traffic_light_tree(forest["root_b"].id, TODAY),
    }
    assert result == expected


def test_forest_union_covers_all_roots_nodes(forest):
    result = traffic_light_forest([forest["root_a"].id, forest["root_b"].id], TODAY)
    expected_ids = {
        forest[key].id
        for key in ("root_a", "child_a1", "child_a2", "grand_a", "root_b", "child_b")
    }
    assert set(result) == expected_ids


def test_forest_empty_roots_empty_result(forest):
    assert traffic_light_forest([], TODAY) == {}


def test_forest_bulk_queries_constant_in_root_count(forest):
    """NFR-инвариант обёртки: 2 корня стоят столько же запросов, сколько 1."""
    with CaptureQueriesContext(connection) as ctx_one:
        traffic_light_forest([forest["root_a"].id], TODAY)
    with CaptureQueriesContext(connection) as ctx_two:
        traffic_light_forest([forest["root_a"].id, forest["root_b"].id], TODAY)
    assert len(ctx_two) == len(ctx_one)


def test_forest_self_parent_cycle_does_not_recurse_forever(forest):
    """Folding-гвард 5.5b жив в forest-пути (битый self-parent не валит вызов)."""
    loop = Division.objects.create(
        organization=forest["org"],
        type_code=forest["dt"],
        name="loop",
        code="TT-LOOP",
    )
    Division.objects.filter(pk=loop.pk).update(parent=loop.pk)
    result = traffic_light_forest([loop.id], TODAY)
    assert result[loop.id].status == TrafficLightStatus.NEUTRAL
