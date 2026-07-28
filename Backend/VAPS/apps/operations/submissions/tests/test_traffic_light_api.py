"""Story 10.3a — API каскадного светофора (GET /api/operations/traffic-light/tree/).

Проверяет ТОЛЬКО HTTP-контракт: домен светофора уже доказан на уровне сервиса
(5.5a/5.5b, test_traffic_light.py + test_traffic_light_tree.py). Здесь —
ровно тот «новый код роута», которого в сервисе нет:

- грубый гейт RequirePermissionMixin {"tree": status.view} + GET-only surface;
- порядок гардов scope → exists → горизонт-422 (обратный порядок делает 404
  оракулом существования для чужака, а раннюю дату — маской 403);
- резолв корней из RBAC-скоупа, когда root_division_id опущен (корень =
  d ∈ visible, чей родитель НЕ в visible — visible_division_ids отдаёт
  РАЗВЁРНУТОЕ поддерево, не корни);
- дособирание name/parent_id из CoreDivisionTreeSelector с null-ing родителя
  вне ответа (ответ самодостаточен: ссылки в невидимый узел не бывает);
- паритет цвета/late с сервисом БАЙТ-В-БАЙТ (роут не пересчитывает).

⛔ Базовая фикстура ОБЯЗАНА сеять EmployeeStatus: report_data_horizon() над
деревом из одних Division отдаёт None, и assert_report_date_has_data вернул бы
422 на КАЖДОМ запросе сюиты (докстринг хелпера: «or an entirely empty system»).
Если «всё красное на ровном месте» — проверять это первым.
"""

import itertools
import uuid
from datetime import date, datetime, timedelta
from pathlib import Path
from zoneinfo import ZoneInfo

import pytest
import yaml
from django.conf import settings
from django.core.management import call_command
from django.db import connection
from django.test.utils import CaptureQueriesContext
from django.urls import reverse
from rest_framework.test import APIClient

from apps.core import clock
from apps.core.models import Division, DivisionType, Employee, Organization
from apps.core.selectors import CoreDivisionTreeSelector
from apps.operations.rbac.models import UserRole
from apps.operations.statuses.models import EmployeeStatus
from apps.operations.submissions.models import DailySubmission
from apps.operations.submissions.services import submit_day
from apps.operations.submissions.traffic_light import (
    TrafficLightStatus,
    traffic_light_tree,
)

pytestmark = pytest.mark.django_db

TZ = ZoneInfo(settings.VAPS_LOCAL_TIMEZONE)
UTC = ZoneInfo("UTC")
TODAY = date(2026, 7, 19)
TOMORROW = TODAY + timedelta(days=1)
# Внутри горизонта (2026-05-01 ≤ дата < TODAY) — «историческая», но валидная.
YESTERDAY = TODAY - timedelta(days=1)
# Раньше горизонта данных (самый ранний date_start статусов — 2026-05-01).
BEFORE_HORIZON = date(2026, 4, 1)

NODE_FIELDS = {"division_id", "name", "parent_id", "status", "late"}
# §36-конверт ошибок (apps/core/api/exception_handler.py:_envelope).
ENVELOPE_KEYS = {"error_code", "message", "details", "request_id", "timestamp"}

SCHEMA_YAML = Path(__file__).resolve().parents[4] / "schema.yaml"
TREE_PATH = "/api/operations/traffic-light/tree/"

_iin = itertools.count(7000)
_code = itertools.count(1)


@pytest.fixture(autouse=True)
def frozen_clock():
    with clock.override(TODAY):
        yield


@pytest.fixture
def org_dt():
    call_command("seed_operations")
    org = Organization.objects.create(name="Организация", code="ORG-TLA")
    dt = DivisionType.objects.get_or_create(
        code="department", defaults={"name": "Отдел"}
    )[0]
    return org, dt


def make_division(org_dt, name, parent=None):
    org, dt = org_dt
    return Division.objects.create(
        organization=org,
        type_code=dt,
        name=name,
        code=f"TLA-{next(_code)}",
        parent=parent,
    )


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


def make_status(employee, code="DUTY", date_start=date(2026, 5, 1)):
    return EmployeeStatus.objects.create(
        employee_id=employee.id,
        status_type_code=code,
        date_start=date_start,
        date_end=date(2026, 9, 1),
        source="USER",
    )


def _submit(division, business_date=TODAY):
    with clock.override(business_date):
        return submit_day(
            division_id=division.id, business_date=business_date, actor="op"
        )


def _green_leaf(org_dt, parent, name):
    """Сдан + снапшот сходится с live → GREEN."""
    leaf = make_division(org_dt, name, parent=parent)
    make_status(make_employee(leaf))
    _submit(leaf)
    return leaf


def _client(user_id=None):
    client = APIClient()
    if user_id is not None:
        client.credentials(HTTP_X_USER_ID=user_id)
    return client


def _grant(user_id, role="DIVISION_OPERATOR", scope=None):
    UserRole.objects.create(
        user_id=user_id,
        role_code_id=role,
        scope_division_id=scope.id if scope is not None else None,
    )
    return user_id


def url():
    """URL — ТОЛЬКО через reverse: литерал молча переживёт переименование."""
    return reverse("ops-traffic-light-tree")


@pytest.fixture
def tree(org_dt):
    """top → mid → {green, red}; отдельная верхнеуровневая ветка other.

    ``top`` существует, но НЕ попадает в ответ при запросе с корнем ``mid`` —
    это и есть фикстура AC-3 (parent_id корня обязан быть null).
    """
    top = make_division(org_dt, "Верх")
    mid = make_division(org_dt, "Штаб", parent=top)
    green = _green_leaf(org_dt, mid, "Отдел А")
    red = make_division(org_dt, "Отдел Б", parent=mid)
    make_employee(red)  # ростер есть, сдачи нет → RED
    other = make_division(org_dt, "Чужое")
    make_status(make_employee(other))
    return {"top": top, "mid": mid, "green": green, "red": red, "other": other}


@pytest.fixture
def scoped_actor(tree):
    """DIVISION_OPERATOR (держит status.view) со скоупом на mid."""
    return _grant("op-mid", scope=tree["mid"])


@pytest.fixture
def global_actor(tree):
    """ADMIN — wildcard `*` ⇒ visible_division_ids → None (глобально)."""
    return _grant("admin-global", role="ADMIN")


# --- AC-1: happy path → 200, плоский список ----------------------------------


def test_happy_path_returns_flat_subtree(tree, scoped_actor):
    response = _client(scoped_actor).get(
        url(), {"root_division_id": str(tree["mid"].id), "business_date": TODAY}
    )
    assert response.status_code == 200, response.data
    body = response.json()
    assert body["business_date"] == TODAY.isoformat()
    ids = {node["division_id"] for node in body["nodes"]}
    # РОВНО поддерево mid — ни top, ни other.
    assert ids == {str(tree[key].id) for key in ("mid", "green", "red")}
    for node in body["nodes"]:
        assert set(node) == NODE_FIELDS
        assert isinstance(node["division_id"], str)
        assert isinstance(node["late"], bool)
        assert node["status"] in set(TrafficLightStatus.values)


def test_nodes_are_sorted_by_name_then_id(tree, scoped_actor):
    response = _client(scoped_actor).get(
        url(), {"root_division_id": str(tree["mid"].id)}
    )
    nodes = response.json()["nodes"]
    assert nodes == sorted(nodes, key=lambda n: (n["name"], n["division_id"]))
    assert [n["name"] for n in nodes] == ["Отдел А", "Отдел Б", "Штаб"]


def test_all_five_statuses_are_reachable(org_dt):
    """GREEN/YELLOW/RED/NEUTRAL/UNKNOWN — все пять живут в одном ответе."""
    root = make_division(org_dt, "Корень")
    _green_leaf(org_dt, root, "Зелёный")

    yellow = make_division(org_dt, "Жёлтый", parent=root)
    ey = make_employee(yellow)
    _submit(yellow)  # снапшот: winner = IN_SERVICE
    make_status(ey)  # live разъехался → YELLOW

    red = make_division(org_dt, "Красный", parent=root)
    make_employee(red)  # ростер без сдачи → RED

    make_division(org_dt, "Нейтральный", parent=root)  # ни людей, ни сдачи

    unknown = make_division(org_dt, "Неопределённый", parent=root)
    emp = make_employee(unknown)
    DailySubmission.objects.create(
        division_id=unknown.id,
        business_date=TODAY,
        version=1,
        is_current=True,
        event="CONFIRMED_NO_CHANGES",
        submitted_by="op",
        submitted_at=datetime(2026, 7, 19, 12, 0, tzinfo=UTC),
        late=False,
        snapshot={
            "schema_version": 1,
            "roster": [{"employee_id": str(emp.id), "full_name": "x", "rank": ""}],
            "rows": [
                {
                    "employee_id": str(emp.id),
                    "status_type_code": "BOGUS_CODE",
                    "status_id": 1,
                    "date_start": "2026-07-01",
                    "date_end": "2026-08-01",
                    "source": "USER",
                }
            ],
        },
    )
    actor = _grant("op-all-colours", scope=root)
    body = _client(actor).get(url(), {"root_division_id": str(root.id)}).json()
    by_name = {node["name"]: node["status"] for node in body["nodes"]}
    assert by_name["Зелёный"] == TrafficLightStatus.GREEN
    assert by_name["Жёлтый"] == TrafficLightStatus.YELLOW
    assert by_name["Красный"] == TrafficLightStatus.RED
    assert by_name["Нейтральный"] == TrafficLightStatus.NEUTRAL
    assert by_name["Неопределённый"] == TrafficLightStatus.UNKNOWN
    # Корень свернулся в худший цвет (UNKNOWN) — все пять значений живы.
    assert set(by_name.values()) == set(TrafficLightStatus.values)


# --- AC-2: цвет и late — байт-в-байт из сервиса -------------------------------


def test_colours_match_service_byte_for_byte(tree, scoped_actor):
    service = traffic_light_tree(tree["mid"].id, TODAY)
    body = (
        _client(scoped_actor)
        .get(url(), {"root_division_id": str(tree["mid"].id)})
        .json()
    )
    # Анти-вакуум: сравнение МНОЖЕСТВ первым — пустой ответ не пройдёт паритет.
    assert {node["division_id"] for node in body["nodes"]} == {
        str(key) for key in service
    }
    assert len(body["nodes"]) >= 3
    for node in body["nodes"]:
        cascade = service[uuid.UUID(node["division_id"])]
        assert node["status"] == cascade.status
        assert node["late"] == cascade.late


def test_late_is_carried_from_the_service(org_dt):
    root = make_division(org_dt, "Опоздавший корень")
    leaf = make_division(org_dt, "Опоздавший лист", parent=root)
    make_status(make_employee(leaf))
    with clock.override(datetime(2026, 7, 19, 17, 30, tzinfo=TZ)):
        submitted = submit_day(division_id=leaf.id, business_date=TODAY, actor="op")
    assert submitted.late is True
    actor = _grant("op-late", scope=root)
    body = _client(actor).get(url(), {"root_division_id": str(root.id)}).json()
    assert all(node["late"] is True for node in body["nodes"])  # OR вверх по дереву


# --- AC-3: name/parent_id дособраны из tree-селектора ------------------------


def test_parent_outside_the_response_is_nulled(tree, scoped_actor):
    body = (
        _client(scoped_actor)
        .get(url(), {"root_division_id": str(tree["mid"].id)})
        .json()
    )
    by_id = {node["division_id"]: node for node in body["nodes"]}
    mid, green = str(tree["mid"].id), str(tree["green"].id)
    # У mid родитель (top) СУЩЕСТВУЕТ, но его нет в ответе → null.
    assert tree["mid"].parent_id == tree["top"].id
    assert by_id[mid]["parent_id"] is None
    # У ребёнка родитель в ответе → настоящая ссылка.
    assert by_id[green]["parent_id"] == mid
    assert by_id[mid]["name"] == "Штаб"


def test_no_node_points_at_an_absent_parent(tree, global_actor):
    body = _client(global_actor).get(url()).json()
    ids = {node["division_id"] for node in body["nodes"]}
    for node in body["nodes"]:
        assert node["parent_id"] is None or node["parent_id"] in ids


def test_division_missing_from_names_map_keeps_the_node(
    tree, scoped_actor, monkeypatch
):
    """Гонка удаления: имени нет — узел остаётся с name="" (терять RED хуже)."""
    from apps.operations.submissions.api import views as views_module

    original = views_module.CoreDivisionTreeSelector.divisions_map
    green_id = tree["green"].id

    def _without_green(division_ids=None):
        names = original(division_ids)
        names.pop(green_id, None)
        return names

    monkeypatch.setattr(
        views_module.CoreDivisionTreeSelector, "divisions_map", _without_green
    )
    body = (
        _client(scoped_actor)
        .get(url(), {"root_division_id": str(tree["mid"].id)})
        .json()
    )
    by_id = {node["division_id"]: node for node in body["nodes"]}
    assert str(green_id) in by_id
    assert by_id[str(green_id)]["name"] == ""


# --- AC-4: root_division_id необязателен → скоуп-корни актора ----------------


def test_default_roots_come_from_the_actor_scope(tree, scoped_actor):
    body = _client(scoped_actor).get(url()).json()
    ids = {node["division_id"] for node in body["nodes"]}
    assert ids == {str(tree[key].id) for key in ("mid", "green", "red")}
    by_id = {node["division_id"]: node for node in body["nodes"]}
    # Скоуп-узел идёт корнем ответа, хотя в БД у него есть родитель.
    assert by_id[str(tree["mid"].id)]["parent_id"] is None


def test_global_actor_gets_every_top_level_subtree(tree, global_actor):
    body = _client(global_actor).get(url()).json()
    ids = {node["division_id"] for node in body["nodes"]}
    assert ids == {str(tree[key].id) for key in tree}
    by_id = {node["division_id"]: node for node in body["nodes"]}
    assert by_id[str(tree["top"].id)]["parent_id"] is None
    assert by_id[str(tree["other"].id)]["parent_id"] is None


def test_disjoint_grants_are_unioned_without_duplicates(tree):
    actor = _grant("op-two", scope=tree["green"])
    _grant(actor, scope=tree["other"])
    body = _client(actor).get(url()).json()
    ids = [node["division_id"] for node in body["nodes"]]
    assert sorted(ids) == sorted({str(tree["green"].id), str(tree["other"].id)})
    assert len(ids) == len(set(ids))


def test_nested_grants_do_not_duplicate_nodes(tree):
    actor = _grant("op-nested", scope=tree["mid"])
    _grant(actor, scope=tree["green"])  # потомок уже покрытого гранта
    body = _client(actor).get(url()).json()
    ids = [node["division_id"] for node in body["nodes"]]
    assert len(ids) == len(set(ids))
    assert set(ids) == {str(tree[key].id) for key in ("mid", "green", "red")}


# --- AC-5/AC-6: порядок гардов scope → exists → дата -------------------------


def test_foreign_root_is_403(tree, scoped_actor):
    response = _client(scoped_actor).get(
        url(), {"root_division_id": str(tree["other"].id)}
    )
    assert response.status_code == 403
    body = response.json()
    assert body["error_code"] == "PERMISSION_DENIED"
    assert body["details"]["division_id"] == str(tree["other"].id)


def test_phantom_root_is_404_for_a_global_actor(tree, global_actor):
    phantom = uuid.uuid4()
    response = _client(global_actor).get(url(), {"root_division_id": str(phantom)})
    assert response.status_code == 404
    body = response.json()
    assert body["error_code"] == "ENTITY_NOT_FOUND"
    assert body["details"]["division_id"] == str(phantom)


def test_phantom_root_is_403_not_404_for_a_stranger(tree, scoped_actor):
    """404 не должен быть оракулом существования для чужака."""
    response = _client(scoped_actor).get(url(), {"root_division_id": str(uuid.uuid4())})
    assert response.status_code == 403


def test_scope_guard_wins_over_the_data_horizon(tree, scoped_actor):
    """Порядок гардов: чужой корень + ранняя дата → 403, НЕ 422.

    Обратный порядок сделал бы красную пробу «снять ensure_division_scope»
    вакуумной — тест упёрся бы в 422 раньше, чем в снятый гард.
    """
    response = _client(scoped_actor).get(
        url(),
        {
            "root_division_id": str(tree["other"].id),
            "business_date": BEFORE_HORIZON.isoformat(),
        },
    )
    assert response.status_code == 403


def test_exists_guard_wins_over_the_data_horizon(tree, global_actor):
    response = _client(global_actor).get(
        url(),
        {
            "root_division_id": str(uuid.uuid4()),
            "business_date": BEFORE_HORIZON.isoformat(),
        },
    )
    assert response.status_code == 404


# --- AC-7: дата до начала данных → 422 ---------------------------------------


def test_date_before_the_data_horizon_is_422(tree, scoped_actor):
    response = _client(scoped_actor).get(
        url(),
        {
            "root_division_id": str(tree["mid"].id),
            "business_date": BEFORE_HORIZON.isoformat(),
        },
    )
    assert response.status_code == 422
    assert response.json()["error_code"] == "REPORT_NO_DATA_FOR_DATE"


# --- AC-8: валидация входа → 400 ---------------------------------------------


def test_non_uuid_root_is_400(tree, scoped_actor):
    response = _client(scoped_actor).get(url(), {"root_division_id": "не-uuid"})
    assert response.status_code == 400
    assert response.json()["error_code"] == "VALIDATION_ERROR"


def test_non_iso_date_is_400(tree, scoped_actor):
    response = _client(scoped_actor).get(url(), {"business_date": "19-07-2026"})
    assert response.status_code == 400
    assert response.json()["error_code"] == "VALIDATION_ERROR"


def test_future_date_is_400(tree, scoped_actor):
    response = _client(scoped_actor).get(url(), {"business_date": TOMORROW.isoformat()})
    assert response.status_code == 400
    body = response.json()
    assert body["error_code"] == "VALIDATION_ERROR"
    assert body["details"]["business_date"] == TOMORROW.isoformat()


def test_omitted_date_echoes_the_server_today(tree, scoped_actor):
    body = _client(scoped_actor).get(url()).json()
    assert body["business_date"] == TODAY.isoformat()


# --- AC-9: грубый гейт права + поверхность роута -----------------------------


def test_anonymous_is_403(tree):
    assert _client().get(url()).status_code == 403


def test_actor_without_status_view_is_403(tree):
    """ORGD держит generate/audit.view, но НЕ status.view."""
    actor = _grant("orgd-user", role="ORGD")
    assert _client(actor).get(url()).status_code == 403


def test_wildcard_admin_passes_the_coarse_gate(tree, global_actor):
    assert _client(global_actor).get(url()).status_code == 200


@pytest.mark.parametrize("method", ["post", "put", "patch", "delete", "head"])
def test_write_verbs_and_head_are_405(tree, scoped_actor, method):
    response = getattr(_client(scoped_actor), method)(url())
    assert response.status_code == 405, method


# --- AC-13: NFR-4 — число запросов не зависит от размера поддерева -----------


def test_query_count_is_invariant_to_subtree_size(org_dt, django_assert_num_queries):
    root1 = make_division(org_dt, "Один")
    make_status(make_employee(root1))
    _submit(root1)

    root5 = make_division(org_dt, "Пять")
    make_status(make_employee(root5))
    _submit(root5)
    for i in range(4):
        _green_leaf(org_dt, root5, f"Лист {i}")

    actor = _grant("op-nfr", role="ADMIN")
    client = _client(actor)
    client.get(url(), {"root_division_id": str(root1.id)})  # прогрев

    with CaptureQueriesContext(connection) as captured:
        response1 = client.get(url(), {"root_division_id": str(root1.id)})
    assert response1.status_code == 200
    assert len(response1.json()["nodes"]) == 1

    with django_assert_num_queries(len(captured)):
        response5 = client.get(url(), {"root_division_id": str(root5.id)})
    assert response5.status_code == 200
    assert len(response5.json()["nodes"]) == 5


# =============================================================================
# QA-добор (qa-generate-e2e-tests, 2026-07-19) — дыры, которые сюита выше
# оставляла зелёными. Каждый блок ниже краснеет на конкретной мутации роута;
# мутации перечислены в шапке блока.
# =============================================================================

# --- AC-1/AC-2: business_date действительно доходит до сервиса ----------------
# ДЫРА: КАЖДЫЙ 2xx-тест выше резолвится в TODAY (либо параметр опущен, либо
# передан TODAY), поэтому мутация `traffic_light_tree(root, Clock.today_local())`
# — то есть роут ИГНОРИРУЕТ запрошенную дату и всегда считает сегодняшний
# светофор — оставалась ЗЕЛЁНОЙ на всей сюите. Эхо-тест её тоже не ловит: эхо
# берётся из формы, а не из аргумента вызова каскада.


def test_business_date_reaches_the_service(org_dt):
    """Вчера тот же узел ещё RED: дата запроса не подменяется сегодняшней."""
    root = make_division(org_dt, "Историческая ветка")
    make_status(make_employee(root))
    _submit(root)  # сдача существует ТОЛЬКО за TODAY
    actor = _grant("op-history", scope=root)
    client = _client(actor)

    today_body = client.get(url(), {"root_division_id": str(root.id)}).json()
    assert today_body["nodes"][0]["status"] == TrafficLightStatus.GREEN

    response = client.get(
        url(),
        {
            "root_division_id": str(root.id),
            "business_date": YESTERDAY.isoformat(),
        },
    )
    assert response.status_code == 200, response.data
    body = response.json()
    assert body["business_date"] == YESTERDAY.isoformat()
    assert body["nodes"][0]["status"] == TrafficLightStatus.RED
    # Паритет на исторической дате — цвет пришёл из сервиса, а не из ветвления
    # роута: сервис на той же дате обязан дать то же самое.
    service = traffic_light_tree(root.id, YESTERDAY)
    assert body["nodes"][0]["status"] == service[root.id].status


def test_historical_date_is_echoed_not_silently_replaced(tree, scoped_actor):
    """Эхо == запрошенной дате, а не Clock.today_local()."""
    body = (
        _client(scoped_actor)
        .get(
            url(),
            {
                "root_division_id": str(tree["mid"].id),
                "business_date": YESTERDAY.isoformat(),
            },
        )
        .json()
    )
    assert body["business_date"] == YESTERDAY.isoformat() != TODAY.isoformat()


# --- AC-1: детерминированный порядок — тай-брейк по division_id --------------
# ДЫРА: у всех фикстур выше имена подразделений РАЗЛИЧНЫ, поэтому вторая
# компонента ключа сортировки (`str(division_id)`) не проверялась ни одним
# тестом — мутация `key=lambda node: node["name"]` оставалась зелёной.


def test_equal_names_are_ordered_by_division_id(org_dt):
    root = make_division(org_dt, "Корень тай-брейка")
    make_status(make_employee(root))
    twins = [make_division(org_dt, "Одинаковое имя", parent=root) for _ in range(2)]
    actor = _grant("op-tiebreak", scope=root)
    nodes = (
        _client(actor).get(url(), {"root_division_id": str(root.id)}).json()["nodes"]
    )
    ordered = [n["division_id"] for n in nodes if n["name"] == "Одинаковое имя"]
    assert len(ordered) == 2, ordered  # анти-вакуум: тай-брейк есть что ломать
    assert ordered == sorted(str(d.id) for d in twins)


# --- AC-1: типы полей — JSON-примитивы ДО рендера -----------------------------
# ДЫРА: happy-path проверял тип только у `division_id` и `late`; `parent_id`
# мог уехать UUID-объектом незамеченным.
# ⚠️ Проверять ЭТО по `response.json()` — вакуум: `JSONEncoder` DRF сам
# приводит UUID к строке (probe: мутация `str(parent_id)` → `parent_id`
# оставила такой ассерт ЗЕЛЁНЫМ). Тип роута виден только в `response.data`,
# до рендера; wire-форма проверяется отдельно и служит контрактом для 10.4.


def test_node_field_types_are_json_primitives(tree, scoped_actor):
    response = _client(scoped_actor).get(
        url(), {"root_division_id": str(tree["mid"].id)}
    )
    # (а) до рендера: роут обязан класть в тело уже приведённые примитивы.
    raw_nodes = response.data["nodes"]
    assert raw_nodes  # анти-вакуум: пустой список пройдёт любой цикл ниже
    for node in raw_nodes:
        assert type(node["division_id"]) is str, node
        assert type(node["name"]) is str, node
        assert node["parent_id"] is None or type(node["parent_id"]) is str, node
        assert type(node["late"]) is bool, node
    # (б) на проводе: та же форма после сериализации — её потребляет 10.4.
    nodes = response.json()["nodes"]
    for node in nodes:
        assert node["status"] in set(TrafficLightStatus.values)
    # Анти-вакуум: непустой parent_id в выборке есть — null-ветка не единственная.
    assert any(node["parent_id"] is not None for node in nodes)


# --- AC-2: late=False не вакуумен --------------------------------------------
# ДЫРА: единственный late-тест утверждал `all(late is True)`; мутация
# `"late": True` (константа вместо поля каскада) оставалась зелёной, потому
# что ни один тест не требовал False.


def test_late_is_false_for_an_on_time_submission(tree, scoped_actor):
    body = (
        _client(scoped_actor)
        .get(url(), {"root_division_id": str(tree["green"].id)})
        .json()
    )
    assert [node["late"] for node in body["nodes"]] == [False]


# --- AC-4: паритет на ветке дефолт-корней ------------------------------------
# ДЫРА: паритет с сервисом (AC-2) проверялся ТОЛЬКО на пути с явным
# root_division_id. Ветка резолва корней из RBAC сверялась по множеству id, но
# НЕ по цвету/late — то есть на ней инвариант «роут не пересчитывает светофор»
# был не покрыт вовсе. Анти-вакуум — сравнение множеств первым + len >= 5.


def test_default_roots_path_matches_the_service(tree, global_actor):
    body = _client(global_actor).get(url()).json()
    service: dict = {}
    for root in CoreDivisionTreeSelector.children_map().get(None, []):
        service.update(traffic_light_tree(root, TODAY))
    assert {node["division_id"] for node in body["nodes"]} == {
        str(key) for key in service
    }
    assert len(body["nodes"]) >= 5  # анти-вакуум: пустой ответ не «сойдётся»
    for node in body["nodes"]:
        cascade = service[uuid.UUID(node["division_id"])]
        assert (node["status"], node["late"]) == (cascade.status, cascade.late)


# --- AC-4: объединение грантов раскрывает ПОДДЕРЕВЬЯ, а не только сами узлы ---
# ДЫРА: тест объединения давал два гранта на ЛИСТЬЯ (green/other), у которых
# поддерево совпадает с самим узлом — «объединили поддеревья» и «объединили
# сами гранты» были в нём НЕРАЗЛИЧИМЫ. Probe: проекция только корней
# (`merged[root] = traffic_light_tree(root, business_date)[root]`) оставляет
# листовой тест ЗЕЛЁНЫМ и краснит этот. Гранты здесь — внутренние узлы.


def test_union_of_grants_expands_each_full_subtree(org_dt, tree):
    other_child = make_division(org_dt, "Чужой лист", parent=tree["other"])
    make_status(make_employee(other_child))
    actor = _grant("op-union", scope=tree["mid"])
    _grant(actor, scope=tree["other"])

    body = _client(actor).get(url()).json()
    ids = [node["division_id"] for node in body["nodes"]]
    assert len(ids) == len(set(ids))
    assert set(ids) == {
        str(tree[key].id) for key in ("mid", "green", "red", "other")
    } | {str(other_child.id)}
    by_id = {node["division_id"]: node for node in body["nodes"]}
    # Оба скоуп-узла — корни ответа; потомок второго гранта ссылается на него.
    assert by_id[str(tree["mid"].id)]["parent_id"] is None
    assert by_id[str(tree["other"].id)]["parent_id"] is None
    assert by_id[str(other_child.id)]["parent_id"] == str(tree["other"].id)


# --- AC-5/AC-9: §36-конверт и поверхность OPTIONS -----------------------------
# ДЫРА: deny-тесты сверяли только error_code/details — недостающий request_id
# или timestamp (контракт §36) прошёл бы незамеченным. OPTIONS числится в
# http_method_names, но ни один тест не проверял, что он не отдаёт описание
# роута анониму.


def test_error_envelope_is_the_section36_shape(tree, scoped_actor):
    response = _client(scoped_actor).get(
        url(), {"root_division_id": str(tree["other"].id)}
    )
    assert response.status_code == 403
    body = response.json()
    assert set(body) == ENVELOPE_KEYS
    assert body["message"]
    assert body["timestamp"]


def test_options_returns_metadata_only_never_business_data(tree):
    """OPTIONS анониму — 200 с МЕТАданными, но НИ ОДНОГО узла светофора.

    200 здесь — осознанный канон проекта, не дыра: ``RequirePermissionMixin.
    initial`` пропускает ``action == "metadata"`` намеренно («OPTIONS metadata
    / CORS preflight → self-documenting 200 вместо вводящего в заблуждение
    403», permissions.py:42-48). Тест пиньит границу этого исключения: если
    OPTIONS когда-нибудь провалится в сам ``tree``, ответ понесёт данные — и
    вот ЭТО уже утечка мимо status.view.
    """
    response = _client().options(url())
    assert response.status_code == 200
    assert set(response.data) & {"nodes", "business_date"} == set(), response.data


# --- AC-12: схема НЕСЁТ ПОЛЯ (автоматизация grep-гейта Task 6) ----------------
# ДЫРА: гейт AC-12 был РУЧНЫМ grep'ом в Task 6 — ни один тест не падал, если
# узел объявят `DictField`'ом и schema.d.ts выродится в
# `{[key: string]: unknown}[]` (живой антипример — ExpensePeriodResponse).
# test_schema_drift.py ловит только рассинхрон committed/fresh: после `make
# schema` деградация типов уехала бы в артефакт ЗЕЛЁНОЙ. Здесь — контракт на
# сам committed-артефакт; фронт-половина (schema.yaml → schema.d.ts) закрыта
# побайтовым scripts/schema-check.mjs, поэтому цепочка до 10.4 замкнута.


@pytest.fixture(scope="module")
def committed_schema():
    assert SCHEMA_YAML.exists(), f"{SCHEMA_YAML} отсутствует — run: make schema"
    document = yaml.safe_load(SCHEMA_YAML.read_text(encoding="utf-8"))
    assert document, "schema.yaml пуст — вакуумный ассерт недопустим"
    return document


def test_schema_exposes_the_traffic_light_path(committed_schema):
    """Литерал `traffic-light` в пути — исполняемый гейт AC-0 стори 10.4."""
    assert TREE_PATH in committed_schema["paths"], sorted(
        p for p in committed_schema["paths"] if "traffic" in p
    )
    operation = committed_schema["paths"][TREE_PATH]
    assert set(operation) == {"get"}, "поверхность роута — только GET"


def test_schema_node_carries_five_typed_fields(committed_schema):
    """AC-12: пять ИМЕНОВАННЫХ типизированных полей, не free-form словарь."""
    schemas = committed_schema["components"]["schemas"]
    node = schemas["TrafficLightNode"]
    properties = node["properties"]
    assert set(properties) == NODE_FIELDS
    assert set(node["required"]) == NODE_FIELDS
    # Антипример 10.1c: `{[key: string]: unknown}` рождается из free-form схемы.
    assert not node.get("additionalProperties")
    assert properties["division_id"] == {"type": "string", "format": "uuid"}
    assert properties["name"]["type"] == "string"
    assert properties["parent_id"]["format"] == "uuid"
    assert properties["parent_id"]["nullable"] is True
    assert properties["late"]["type"] == "boolean"
    # Story 10.3c: division-роут ввёл ВТОРОЙ "status"-field с тем же choice
    # set — spectacular слил бы их под авто-хэшированным именем без
    # ENUM_NAME_OVERRIDES (settings.py); имя теперь стабильное и общее.
    assert properties["status"]["$ref"].endswith("/TrafficLightStatusEnum")

    # Ответ действительно ссылается на этот узел, а не на анонимный объект.
    response = committed_schema["paths"][TREE_PATH]["get"]["responses"]["200"]
    body_ref = response["content"]["application/json"]["schema"]["$ref"]
    assert body_ref.endswith("/TrafficLightTreeResponse")
    tree_response = schemas["TrafficLightTreeResponse"]["properties"]
    assert tree_response["business_date"]["format"] == "date"
    assert tree_response["nodes"]["items"]["$ref"].endswith("/TrafficLightNode")


def test_schema_status_enum_matches_the_service(committed_schema):
    """Схема не расходится с TrafficLightStatus — 10.4 типизирует цвет по ней."""
    enum = committed_schema["components"]["schemas"]["TrafficLightStatusEnum"]["enum"]
    assert enum == list(TrafficLightStatus.values)


def test_schema_query_params_are_documented_and_optional(committed_schema):
    parameters = {
        parameter["name"]: parameter
        for parameter in committed_schema["paths"][TREE_PATH]["get"]["parameters"]
    }
    assert set(parameters) == {"root_division_id", "business_date"}
    assert all(p["in"] == "query" for p in parameters.values())
    # Оба необязательны — иначе экран 10.4 обязан знать «какой у меня корень».
    assert not any(p.get("required") for p in parameters.values())
    assert parameters["root_division_id"]["schema"]["format"] == "uuid"
    assert parameters["business_date"]["schema"]["format"] == "date"
