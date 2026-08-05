"""Свод светофора по дереву: худший цвет наверх, стоимость не растёт с деревом.

Проверяется не только «какой цвет у корня», но и то, что свод НЕ портит
собственное состояние узлов (лист остаётся собой), поднимает опоздание,
изолирует сломанный узел и не обходит дерево поимённо.
"""
from datetime import timedelta

import pytest
from django.db import connection
from django.test.utils import CaptureQueriesContext

from organization_management.apps.divisions.models import Division
from organization_management.apps.operations import clock
from organization_management.apps.operations.day_submission_service import submit_day
from organization_management.apps.operations.models_submission import (
    OpsDailySubmission,
)
from organization_management.apps.operations.traffic_light import (
    TrafficLightStatus,
    division_traffic_light,
    traffic_light_tree,
)
from organization_management.apps.operations.tests.test_day_submission_service import (
    MORNING,
    TODAY,
    fact,
    in_slot,
)
from organization_management.apps.operations.tests.test_traffic_light import types  # noqa: F401

pytestmark = pytest.mark.django_db

ACTOR = "7"
EVENING = MORNING.replace(hour=13, minute=30)  # 18:30 местного — после контроля


@pytest.fixture
def tree():
    """Управление → два отдела, у второго свой подотдел."""
    root = Division.objects.create(name="Управление")
    first = Division.objects.create(name="Отдел 1", parent=root)
    second = Division.objects.create(name="Отдел 2", parent=root)
    deep = Division.objects.create(name="Отделение", parent=second)
    return root, first, second, deep


def submit(division, business_date=TODAY, at=MORNING):
    with clock.override(at):
        return submit_day(
            division_id=division.id, business_date=business_date, actor=ACTOR
        )


def tree_light(root, business_date=TODAY):
    return traffic_light_tree(root.id, business_date)


class TestRollUp:
    def test_all_green_stays_green(self, types, tree):
        root, first, second, deep = tree
        for division in tree:
            in_slot(division)
            submit(division)
        result = tree_light(root)
        assert set(result) == {node.id for node in tree}
        assert all(
            state.status == TrafficLightStatus.GREEN.value
            for state in result.values()
        )

    def test_one_red_leaf_reddens_every_ancestor(self, types, tree):
        root, first, second, deep = tree
        for division in (root, first, second):
            in_slot(division)
            submit(division)
        in_slot(deep)  # есть кого сдавать, но не сдали
        result = tree_light(root)
        assert result[deep.id].status == TrafficLightStatus.RED.value
        assert result[second.id].status == TrafficLightStatus.RED.value
        assert result[root.id].status == TrafficLightStatus.RED.value
        # Соседняя ветка не окрашивается чужой бедой.
        assert result[first.id].status == TrafficLightStatus.GREEN.value

    def test_red_outweighs_yellow(self, types, tree):
        root, first, second, deep = tree
        for division in tree:
            in_slot(division)
            submit(division)
        fact(in_slot(first), code="DUTY")  # жёлтый: новый человек и факт
        in_slot(deep)
        OpsDailySubmission.objects.filter(division_id=deep.id).delete()
        result = tree_light(root)
        assert result[first.id].status == TrafficLightStatus.YELLOW.value
        assert result[deep.id].status == TrafficLightStatus.RED.value
        assert result[root.id].status == TrafficLightStatus.RED.value

    def test_yellow_outweighs_green(self, types, tree):
        root, first, second, deep = tree
        for division in tree:
            in_slot(division)
            submit(division)
        fact(in_slot(deep), code="DUTY")
        result = tree_light(root)
        assert result[deep.id].status == TrafficLightStatus.YELLOW.value
        assert result[root.id].status == TrafficLightStatus.YELLOW.value

    def test_empty_subtree_is_neutral_and_does_not_redden(self, types, tree):
        root, first, second, deep = tree
        in_slot(root)
        submit(root)
        # Отделы без людей: сдавать некого — предъявлять нечего.
        result = tree_light(root)
        assert result[first.id].status == TrafficLightStatus.NEUTRAL.value
        assert result[root.id].status == TrafficLightStatus.GREEN.value

    def test_a_displaced_version_is_not_a_submission(self, types, tree):
        # Свод спрашивает ДЕЙСТВУЮЩУЮ версию: вытесненная не отменяет того,
        # что день сейчас не сдан, и узел обязан остаться красным.
        root, first, *_ = tree
        in_slot(root)
        in_slot(first)
        submit(root)
        submit(first)
        OpsDailySubmission.objects.filter(division_id=first.id).update(
            is_current=False
        )
        result = tree_light(root)
        assert result[first.id].status == TrafficLightStatus.RED.value
        assert result[root.id].status == TrafficLightStatus.RED.value

    def test_neutral_alone_stays_neutral(self, types, tree):
        root, *_ = tree
        assert tree_light(root)[root.id].status == TrafficLightStatus.NEUTRAL.value


class TestOwnStateMatchesThePointQuery:
    def test_leaf_colour_equals_the_point_answer(self, types, tree):
        root, first, second, deep = tree
        in_slot(root)
        submit(root)
        employee = in_slot(first)
        submit(first)
        fact(employee, code="DUTY")
        in_slot(second)
        result = tree_light(root)
        for division in (first, second):
            assert (
                result[division.id].status
                == division_traffic_light(division.id, TODAY).status
            ), division.name

    def test_a_neutral_leaf_matches_the_point_answer(self, types, tree):
        # Одно правило на оба пути: узел без людей серый и там, и там.
        root, first, *_ = tree
        result = tree_light(root)
        assert result[first.id].status == TrafficLightStatus.NEUTRAL.value
        assert (
            division_traffic_light(first.id, TODAY).status
            == TrafficLightStatus.NEUTRAL.value
        )


class TestLate:
    def test_late_rises_from_any_depth(self, types, tree):
        root, first, second, deep = tree
        for division in tree:
            in_slot(division)
        for division in (root, first, second):
            submit(division)
        submit(deep, at=EVENING)
        result = tree_light(root)
        assert result[deep.id].late is True
        assert result[second.id].late is True
        assert result[root.id].late is True
        # Ветка без опоздавших остаётся без отметки.
        assert result[first.id].late is False

    def test_late_does_not_change_the_colour(self, types, tree):
        root, *_ = tree
        in_slot(root)
        submit(root, at=EVENING)
        state = tree_light(root)[root.id]
        assert state.late is True
        assert state.status == TrafficLightStatus.GREEN.value


class TestBrokenNodeIsIsolated:
    def test_unknown_type_paints_only_its_own_node(self, types, tree):
        root, first, second, deep = tree
        for division in tree:
            in_slot(division)
            submit(division)
        broken = OpsDailySubmission.objects.get(division_id=first.id)
        broken.snapshot = {
            "schema_version": 1,
            "roster": [{"employee_id": 1, "full_name": "И", "rank": ""}],
            "rows": [
                {
                    "employee_id": 1,
                    "status_type_code": "НЕТ_ТАКОГО",
                    "status_id": 1,
                    "date_start": TODAY.isoformat(),
                    "date_end": (TODAY + timedelta(days=1)).isoformat(),
                    "source": "USER",
                }
            ],
        }
        broken.save(update_fields=["snapshot"])
        result = tree_light(root)
        assert result[first.id].status == TrafficLightStatus.UNKNOWN.value
        # Остальное дерево посчиталось.
        assert result[second.id].status == TrafficLightStatus.GREEN.value
        assert result[deep.id].status == TrafficLightStatus.GREEN.value

    def test_unknown_outweighs_red(self, types, tree):
        # «Не знаю» честнее, чем спокойный цвет, и честнее, чем занижение до
        # красного: сломанный узел обязан оставаться заметным.
        root, first, second, deep = tree
        member = None
        for division in tree:
            employee = in_slot(division)
            if division is first:
                member = employee
        submit(first)
        broken = OpsDailySubmission.objects.get(division_id=first.id)
        broken.snapshot = {
            "schema_version": 1,
            "roster": [{"employee_id": member.id, "full_name": "И", "rank": ""}],
            "rows": [
                {
                    "employee_id": member.id,
                    "status_type_code": "НЕТ_ТАКОГО",
                    "status_id": 1,
                    "date_start": TODAY.isoformat(),
                    "date_end": (TODAY + timedelta(days=1)).isoformat(),
                    "source": "USER",
                }
            ],
        }
        broken.save(update_fields=["snapshot"])
        # Соседи красные (не сдавали), сломанный — UNKNOWN, и он побеждает.
        result = tree_light(root)
        assert result[second.id].status == TrafficLightStatus.RED.value
        assert result[root.id].status == TrafficLightStatus.UNKNOWN.value


class TestScopeAndCost:
    def test_only_the_requested_subtree_is_returned(self, types, tree):
        root, first, second, deep = tree
        stranger = Division.objects.create(name="Чужое управление")
        in_slot(stranger)
        result = tree_light(second)
        assert set(result) == {second.id, deep.id}
        assert stranger.id not in result

    def test_query_count_does_not_grow_with_the_tree(self, types, tree):
        root, first, second, deep = tree
        for division in tree:
            in_slot(division)
            submit(division)
        with CaptureQueriesContext(connection) as small:
            tree_light(root)
        for index in range(8):
            extra = Division.objects.create(name=f"Доп {index}", parent=root)
            in_slot(extra)
            submit(extra)
        with CaptureQueriesContext(connection) as big:
            tree_light(root)
        # Сравниваются ДВА размера дерева: поимённый обход дал бы рост.
        assert len(big.captured_queries) == len(small.captured_queries)


class TestBrokenTree:
    def test_a_parent_cycle_does_not_hang_the_fold(self, types, tree):
        # У Division.parent нет запрета циклов, и сохранённая петля не должна
        # уводить свёртку в бесконечную рекурсию.
        root, first, second, deep = tree
        Division.objects.filter(pk=root.pk).update(parent_id=first.pk)
        in_slot(root)
        result = traffic_light_tree(root.id, TODAY)
        assert root.id in result
