"""Документ сводного расхода: строки детей из ЗАПИНЕННЫХ версий и итог-сумма.

Главное здесь — что документ показывает то, из чего сводка сложена, а не то,
что стало потом: возьми он текущие сдачи, протухшая сводка печаталась бы
свежим документом, и расхождение исчезало бы ровно там, где его подписывают.
"""
import pytest

from organization_management.apps.divisions.models import Division
from organization_management.apps.operations import clock
from organization_management.apps.operations.day_submission_service import (
    amend_day,
    submit_day,
)
from organization_management.apps.operations.exceptions import DomainError
from organization_management.apps.operations.expense_release import (
    build_summary_expense_document,
)
from organization_management.apps.operations.models_status import OpsEmployeeStatus
from organization_management.apps.operations.summary_service import assemble_summary
from organization_management.apps.operations.tests.test_day_submission_service import (
    MORNING,
    TODAY,
    fact,
    in_slot,
)
from organization_management.apps.operations.tests.test_traffic_light import types  # noqa: F401

pytestmark = pytest.mark.django_db

ACTOR = "7"


@pytest.fixture
def tree():
    root = Division.objects.create(name="Управление")
    left = Division.objects.create(name="Первый отдел", parent=root)
    right = Division.objects.create(name="Второй отдел", parent=root)
    return root, left, right


def submit(division):
    with clock.override(MORNING):
        return submit_day(
            division_id=division.id, business_date=TODAY, actor=ACTOR
        )


def amend(division):
    with clock.override(MORNING):
        return amend_day(
            division_id=division.id,
            business_date=TODAY,
            actor=ACTOR,
            reason="ошибка",
            sanction="замечание",
        )


def assemble(root):
    with clock.override(MORNING):
        return assemble_summary(
            division_id=root.id, business_date=TODAY, actor=ACTOR
        )


def build(root):
    return build_summary_expense_document(root.id, TODAY)


def counts_of(row):
    return {column: cell.count for column, cell in row.cells.items()}


# ── Строки ───────────────────────────────────────────────────────────────


def test_a_row_per_division_with_the_parent_first(types, tree):
    root, left, right = tree
    in_slot(root)
    in_slot(left)
    in_slot(right)
    submit(left)
    submit(right)
    assemble(root)

    data = build(root)

    assert [row.name for row in data.rows] == [
        "Управление",
        "Первый отдел",
        "Второй отдел",
    ]


def test_each_row_carries_its_own_numbers(types, tree):
    root, left, right = tree
    in_slot(root)
    on_duty = in_slot(left)
    fact(on_duty, code="DUTY")
    in_slot(right)
    submit(left)
    submit(right)
    assemble(root)

    data = build(root)

    assert counts_of(data.rows[1])["DUTY"] == 1
    assert counts_of(data.rows[2])["DUTY"] == 0


def test_the_totals_are_the_sum_of_the_rows(types, tree):
    """Итог — сумма напечатанного, а не независимый пересчёт.

    Пересчёт сошёлся бы со строками только пока никто не ошибся, а сходиться
    он обязан всегда: под ним подписываются.
    """
    root, left, right = tree
    in_slot(root)
    in_slot(left)
    in_slot(right)
    submit(left)
    submit(right)
    assemble(root)

    data = build(root)

    assert data.totals.list_total == sum(row.list_total for row in data.rows)
    assert data.totals.staff_total == sum(row.staff_total for row in data.rows)
    for column in data.columns:
        assert data.totals.columns[column] == sum(
            row.cells[column].count for row in data.rows
        )


# ── Из чего собран документ ──────────────────────────────────────────────


def test_the_document_shows_the_pinned_version_not_the_current_one(types, tree):
    """Протухшая сводка не смеет печататься свежим документом."""
    root, left, right = tree
    in_slot(root)
    employee = in_slot(left)
    fact(employee, code="DUTY")
    in_slot(right)
    submit(left)
    submit(right)
    assemble(root)

    # Ребёнок исправил свой день ПОСЛЕ сборки сводки.
    OpsEmployeeStatus.objects.filter(employee_id=employee.id).update(
        status_type_code="VACATION"
    )
    amend(left)

    data = build(root)

    # В документе — то, что было запинено: дежурство, а не отпуск.
    assert counts_of(data.rows[1])["DUTY"] == 1
    assert counts_of(data.rows[1])["VACATION"] == 0


def test_a_live_edit_without_an_amendment_changes_nothing(types, tree):
    root, left, right = tree
    in_slot(root)
    employee = in_slot(left)
    fact(employee, code="DUTY")
    in_slot(right)
    submit(left)
    submit(right)
    assemble(root)
    before = counts_of(build(root).rows[1])

    OpsEmployeeStatus.objects.filter(employee_id=employee.id).update(
        status_type_code="VACATION"
    )

    assert counts_of(build(root).rows[1]) == before
    assert before["DUTY"] == 1


# ── Гарды ────────────────────────────────────────────────────────────────


def test_a_day_without_a_summary_is_404(types, tree):
    root, _, _ = tree

    with pytest.raises(DomainError) as exc:
        build(root)

    assert exc.value.code == "DAY_NOT_SUBMITTED"
    assert exc.value.http_status == 404


def test_a_plain_submission_is_not_a_summary(types, tree):
    """У обычной сдачи нет заявления о версиях детей.

    Напечатать её сводным документом значило бы выдать за консолидацию то,
    что ею не является.
    """
    _, left, _ = tree
    in_slot(left)
    submit(left)

    with pytest.raises(DomainError) as exc:
        build_summary_expense_document(left.id, TODAY)

    assert exc.value.http_status == 400
