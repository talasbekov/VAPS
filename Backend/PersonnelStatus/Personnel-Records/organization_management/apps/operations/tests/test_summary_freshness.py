"""Свежесть сводки: три оси протухания и то, что чтение ничего не пишет.

Оси различаются намеренно — они требуют разного: поправил ребёнок
(пересобрать), у ребёнка не осталось действующей версии (разбираться с
ребёнком), появился обязанный ребёнок вне пинов (он должен сдать). Поэтому
проверяется не только «протухла», но и КАКОЙ ОСЬЮ.
"""
import pytest
from django.db import connection
from django.test.utils import CaptureQueriesContext

from organization_management.apps.divisions.models import Division
from organization_management.apps.operations import clock
from organization_management.apps.operations.day_submission_service import (
    amend_day,
    submit_day,
)
from organization_management.apps.operations.models_audit import OpsAuditLog
from organization_management.apps.operations.models_submission import (
    OpsDailySubmission,
)
from organization_management.apps.operations.summary_service import (
    FRESH,
    STALE,
    assemble_summary,
    summary_freshness,
)
from organization_management.apps.operations.tests.test_day_submission_service import (
    MORNING,
    TODAY,
    in_slot,
)
from organization_management.apps.operations.tests.test_status_service import seed_types

pytestmark = pytest.mark.django_db

ACTOR = "7"


@pytest.fixture
def types():
    seed_types()


@pytest.fixture
def tree():
    root = Division.objects.create(name="Управление")
    left = Division.objects.create(name="Первый отдел", parent=root)
    right = Division.objects.create(name="Второй отдел", parent=root)
    in_slot(left, iin="780000000001")
    in_slot(right, iin="780000000002")
    return root, left, right


def submit(division, business_date=TODAY):
    with clock.override(MORNING):
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


def assembled(tree_fixture):
    root, left, right = tree_fixture
    submit(left)
    submit(right)
    with clock.override(MORNING):
        return assemble_summary(
            division_id=root.id, business_date=TODAY, actor=ACTOR
        )


# ── Свежая ───────────────────────────────────────────────────────────────


def test_a_just_assembled_summary_is_fresh(types, tree):
    root, _, _ = tree
    assembled(tree)

    state = summary_freshness(root.id, TODAY)

    assert state.status == FRESH
    assert (state.superseded, state.missing, state.unpinned) == ([], [], [])


def test_there_is_no_freshness_where_there_is_no_summary(types, tree):
    root, _, _ = tree

    assert summary_freshness(root.id, TODAY) is None


def test_a_plain_submission_is_not_a_summary(types, tree):
    """Про обычную сдачу вопрос свежести не имеет смысла.

    Ответить на него FRESH значило бы объявить свежей сводку, которой не
    существует.
    """
    _, left, _ = tree
    submit(left)

    assert summary_freshness(left.id, TODAY) is None


# ── Ось «поправил ребёнок» ───────────────────────────────────────────────


def test_an_amended_child_makes_the_summary_stale(types, tree):
    root, left, _ = tree
    assembled(tree)

    amend(left)

    state = summary_freshness(root.id, TODAY)
    assert state.status == STALE
    assert state.superseded == [
        {"division_id": left.id, "pinned_version": 1, "current_version": 2}
    ]
    assert (state.missing, state.unpinned) == ([], [])


# ── Ось «не осталось действующей версии» ─────────────────────────────────


def test_a_child_without_a_current_version_is_missing(types, tree):
    """Вырожденное «ноль текущих» — не то же, что поправка.

    Пересборка тут не поможет: пересобирать не из чего, и разбираться надо
    с ребёнком.
    """
    root, left, _ = tree
    assembled(tree)
    OpsDailySubmission.objects.filter(division_id=left.id).update(is_current=False)

    state = summary_freshness(root.id, TODAY)

    assert state.status == STALE
    assert state.missing == [{"division_id": left.id, "pinned_version": 1}]
    assert state.superseded == []


# ── Ось «появился обязанный ребёнок» ─────────────────────────────────────


def test_a_new_required_child_outside_the_pins_is_unpinned(types, tree):
    root, _, _ = tree
    assembled(tree)

    newcomer = Division.objects.create(name="Новый отдел", parent=root)
    in_slot(newcomer, iin="780000000003")

    state = summary_freshness(root.id, TODAY)

    assert state.status == STALE
    assert state.unpinned == [newcomer.id]
    assert (state.superseded, state.missing) == ([], [])


def test_a_new_empty_child_does_not_make_the_summary_stale(types, tree):
    """Ребёнку, у которого некому сдавать, нечего консолидировать.

    Иначе заведение пустой ветки протухало бы все сводки дня разом.
    """
    root, _, _ = tree
    assembled(tree)

    Division.objects.create(name="Пустая ветка", parent=root)

    assert summary_freshness(root.id, TODAY).status == FRESH


# ── Свойства чтения ──────────────────────────────────────────────────────


def test_reading_freshness_writes_nothing(types, tree):
    root, left, _ = tree
    summary = assembled(tree)
    amend(left)
    before_snapshot = OpsDailySubmission.objects.get(pk=summary.pk).snapshot
    audit_before = OpsAuditLog.objects.count()
    rows_before = OpsDailySubmission.objects.count()

    summary_freshness(root.id, TODAY)

    assert OpsDailySubmission.objects.get(pk=summary.pk).snapshot == before_snapshot
    assert OpsDailySubmission.objects.count() == rows_before
    assert OpsAuditLog.objects.count() == audit_before


def test_the_query_count_does_not_grow_with_the_number_of_children(types, tree):
    root, _, _ = tree
    assembled(tree)
    with CaptureQueriesContext(connection) as small:
        summary_freshness(root.id, TODAY)

    for index in range(4):
        extra = Division.objects.create(name=f"Отдел {index}", parent=root)
        in_slot(extra, iin=f"78000000010{index}")
        submit(extra)
    with CaptureQueriesContext(connection) as big:
        summary_freshness(root.id, TODAY)

    assert len(small) == len(big), (
        f"запрос на ребёнка: {len(small)} против {len(big)}"
    )


def test_the_divergences_follow_the_pin_order(types, tree):
    """Порядок расхождений стабилен: он наследует порядок пинов снимка."""
    root, left, right = tree
    assembled(tree)
    amend(right)
    amend(left)

    state = summary_freshness(root.id, TODAY)

    assert [row["division_id"] for row in state.superseded] == sorted(
        [left.id, right.id]
    )
