"""GET /api/operations/traffic-light/{id}/ — светофор одного подразделения.

Зона вьюхи: гейт, порядок гардов, СВОЙ уровень (а не свод потомков), выдача
поимённого расхождения наружу, дефолт даты и перевод дефекта данных в
внятный отказ вместо 500.
"""
from datetime import timedelta

import pytest
from rest_framework.test import APIClient

from organization_management.apps.divisions.models import Division
from organization_management.apps.operations import clock
from organization_management.apps.operations.day_submission_service import submit_day
from organization_management.apps.operations.models_submission import (
    OpsDailySubmission,
)
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

BASE = "/api/operations/traffic-light/"
TREE_URL = f"{BASE}tree/"
READ_PERMS = ["status.view"]
EVENING = MORNING.replace(hour=13, minute=30)


@pytest.fixture
def tree():
    root = Division.objects.create(name="Управление")
    child = Division.objects.create(name="Отдел", parent=root)
    return root, child


def url(division_id):
    return f"{BASE}{division_id}/"


def submit(division, business_date=TODAY, at=MORNING):
    with clock.override(at):
        return submit_day(
            division_id=division.id, business_date=business_date, actor="7"
        )


def get(api, division_id, **params):
    with clock.override(MORNING):
        return api.get(url(division_id), params)


# ── Гейт и гарды ─────────────────────────────────────────────────────────

def test_anonymous_403(types, tree):
    root, _ = tree
    response = get(APIClient(), root.id)
    assert response.status_code == 403
    assert response.data["detail"] == "PERMISSION_DENIED"


def test_write_right_alone_does_not_open_the_node(types, tree):
    root, _ = tree
    api, _ = client_for("tld-writer", "WRITER", ["daily_report.correct"])
    assert get(api, root.id).status_code == 403


def test_foreign_division_is_403_envelope(types, tree):
    root, child = tree
    api, _ = client_for(
        "tld-scoped", "VIEWER", READ_PERMS, scope_division_id=child.id
    )
    response = get(api, root.id)
    assert response.status_code == 403
    assert response.data["error_code"] == "PERMISSION_DENIED"


@pytest.mark.parametrize("pk", ["не-число", "999999"])
def test_unknown_division_is_404_envelope(types, tree, pk):
    api, _ = client_for(f"tld-404-{pk}", "ADMIN", ["*"])
    response = get(api, pk)
    assert response.status_code == 404
    assert response.data["error_code"] == "ENTITY_NOT_FOUND"


def test_scope_is_checked_before_existence(types, tree):
    root, child = tree
    api, _ = client_for(
        "tld-oracle", "VIEWER", READ_PERMS, scope_division_id=child.id
    )
    response = get(api, root.id + 10_000)
    assert response.status_code == 403
    assert response.data["error_code"] == "PERMISSION_DENIED"


# ── Свой уровень, а не свод ──────────────────────────────────────────────

def test_the_node_answers_for_itself_not_for_its_children(types, tree):
    """Точечное чтение — СВОЙ уровень.

    В дереве родитель краснеет от несдавшего потомка; спрошенный поимённо, он
    обязан ответить за себя, иначе показывал бы чужую беду под своим именем.
    """
    root, child = tree
    in_slot(root)
    submit(root)
    in_slot(child)  # есть кого сдавать, не сдал
    api, _ = client_for("tld-own", "ADMIN", ["*"])
    own = get(api, root.id)
    assert own.data["status"] == TrafficLightStatus.GREEN.value
    with clock.override(MORNING):
        cascade = api.get(TREE_URL, {"root_division_id": root.id})
    rolled = {node["division_id"]: node for node in cascade.data["nodes"]}
    assert rolled[root.id]["status"] == TrafficLightStatus.RED.value


# ── Расхождение наружу ───────────────────────────────────────────────────

def test_drift_names_who_changed(types, tree):
    root, _ = tree
    employee = in_slot(root)
    submit(root)
    fact(employee, code="DUTY")
    api, _ = client_for("tld-drift", "ADMIN", ["*"])
    response = get(api, root.id)
    assert response.data["status"] == TrafficLightStatus.YELLOW.value
    assert response.data["drift"] == {
        "added": [],
        "removed": [],
        "changed": [
            {"employee_id": employee.id, "from": "IN_SERVICE", "to": "DUTY"}
        ],
        # Имена доклеивает ВЬЮХА (движок светофора остаётся на id):
        # дежурный в UI видит, кого проверять, без второго запроса.
        "names": {str(employee.id): str(employee)},
    }


def test_drift_is_null_when_nothing_diverged(types, tree):
    root, _ = tree
    in_slot(root)
    submit(root)
    api, _ = client_for("tld-nodrift", "ADMIN", ["*"])
    response = get(api, root.id)
    assert response.data["status"] == TrafficLightStatus.GREEN.value
    assert response.data["drift"] is None


def test_red_carries_no_drift(types, tree):
    # Сравнивать не с чем: сдачи нет, и список «кто разошёлся» был бы вымыслом.
    root, _ = tree
    in_slot(root)
    api, _ = client_for("tld-red", "ADMIN", ["*"])
    response = get(api, root.id)
    assert response.data["status"] == TrafficLightStatus.RED.value
    assert response.data["drift"] is None


def test_late_comes_through(types, tree):
    root, _ = tree
    in_slot(root)
    submit(root, at=EVENING)
    api, _ = client_for("tld-late", "ADMIN", ["*"])
    response = get(api, root.id)
    assert response.data["late"] is True
    assert response.data["status"] == TrafficLightStatus.GREEN.value


# ── Дата ─────────────────────────────────────────────────────────────────

def test_date_defaults_to_today_and_echoes(types, tree):
    root, _ = tree
    api, _ = client_for("tld-today", "ADMIN", ["*"])
    response = get(api, root.id)
    assert response.data["business_date"] == TODAY.isoformat()
    assert response.data["division_id"] == root.id


def test_another_day_is_answered_for_that_day(types, tree):
    root, _ = tree
    tomorrow = TODAY + timedelta(days=1)
    in_slot(root)
    submit(root, business_date=tomorrow)
    api, _ = client_for("tld-tomorrow", "ADMIN", ["*"])
    today_answer = get(api, root.id)
    tomorrow_answer = get(api, root.id, business_date=tomorrow.isoformat())
    assert today_answer.data["status"] == TrafficLightStatus.RED.value
    assert tomorrow_answer.data["status"] == TrafficLightStatus.GREEN.value
    assert tomorrow_answer.data["business_date"] == tomorrow.isoformat()


def test_broken_date_is_400(types, tree):
    root, _ = tree
    api, _ = client_for("tld-date", "ADMIN", ["*"])
    response = get(api, root.id, business_date="вчера")
    assert response.status_code == 400
    assert "business_date" in response.data


# ── Дефект данных ────────────────────────────────────────────────────────

def test_unresolvable_code_is_422_not_500(types, tree):
    """Код вне справочника — дефект ДАННЫХ, и ответ обязан это сказать.

    500 сообщил бы «сломался сервер», а цвет UNKNOWN (как в своде) выдал бы
    поломку за состояние подразделения.
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
    api, _ = client_for("tld-broken", "ADMIN", ["*"])
    response = get(api, root.id)
    assert response.status_code == 422
    assert response.data["error_code"] == "UNRESOLVABLE_STATUS_TYPE"


def test_the_same_broken_node_stays_unknown_in_the_tree(types, tree):
    # Асимметрия сознательная: в дереве одна сломанная ветка не должна
    # прятать остальные, поэтому там цвет, а здесь отказ.
    root, child = tree
    employee = in_slot(root)
    in_slot(child)
    submit(root)
    submit(child)
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
    api, _ = client_for("tld-broken-tree", "ADMIN", ["*"])
    with clock.override(MORNING):
        cascade = api.get(TREE_URL, {"root_division_id": root.id})
    nodes = {node["division_id"]: node for node in cascade.data["nodes"]}
    assert cascade.status_code == 200
    assert nodes[root.id]["status"] == TrafficLightStatus.UNKNOWN.value
    assert nodes[child.id]["status"] == TrafficLightStatus.GREEN.value


# ── Поверхность ──────────────────────────────────────────────────────────

@pytest.mark.parametrize("method", ["post", "put", "patch", "delete"])
def test_the_node_is_read_only(types, tree, method):
    root, _ = tree
    api, _ = client_for(f"tld-method-{method}", "ADMIN", ["*"])
    with clock.override(MORNING):
        response = getattr(api, method)(url(root.id), {}, format="json")
    assert response.status_code == 405
