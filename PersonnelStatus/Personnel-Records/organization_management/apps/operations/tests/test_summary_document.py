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


# ── Дети сданы при РАЗНЫХ справочниках ───────────────────────────────────

# Со схемы снимка 3 каждый сданный день считается своим ЗАМОРОЖЕННЫМ
# справочником, а сводка склеивает дни разных подразделений. Переименуй
# администратор колонку между двумя сдачами — и один ребёнок принесёт строку со
# старым именем колонки, другой с новым.
#
# До этого среза на таком дне падал ВЕСЬ сводный документ (KeyError по имени
# колонки, которого нет в чужой строке): родитель не мог напечатать день вообще
# — ровно та поломка, которую срез 134 закрывал у дневного документа, только
# приехавшая с другой стороны.


def submit_children_across_a_rename(left, right):
    """Левый сдан ДО переименования колонки, правый — ПОСЛЕ."""
    from organization_management.apps.operations.status_types import StatusType

    fact(in_slot(left, last_name="Левый"), code="DUTY")
    fact(in_slot(right, last_name="Правый"), code="DUTY")
    submit(left)
    StatusType.objects.filter(code="DUTY").update(report_column_code="НОВАЯ")
    submit(right)


def test_a_summary_across_a_column_rename_still_builds(types, tree):  # noqa: F811
    """Несущий тест: документ обязан выйти, а не упасть."""
    root, left, right = tree
    in_slot(root)
    submit_children_across_a_rename(left, right)
    assemble(root)

    data = build(root)

    assert len(data.rows) == 3


def test_both_column_eras_are_in_the_header(types, tree):  # noqa: F811
    """Слить старую колонку с новой было бы хуже падения: числа сошлись бы под
    именем, которого один из дней не подписывал."""
    root, left, right = tree
    in_slot(root)
    submit_children_across_a_rename(left, right)
    assemble(root)

    data = build(root)

    assert {"DUTY", "НОВАЯ"} <= set(data.columns)


def test_each_child_keeps_its_own_column(types, tree):  # noqa: F811
    """Человек, сданный под старым именем колонки, там и остаётся."""
    root, left, right = tree
    in_slot(root)
    submit_children_across_a_rename(left, right)
    assemble(root)

    rows = {row.name: counts_of(row) for row in build(root).rows}

    assert rows["Первый отдел"]["DUTY"] == 1
    assert rows["Первый отдел"]["НОВАЯ"] == 0
    assert rows["Второй отдел"]["НОВАЯ"] == 1
    assert rows["Второй отдел"]["DUTY"] == 0


def test_every_row_covers_every_column_of_the_header(types, tree):  # noqa: F811
    """Рендереры (docx/xlsx/pdf) индексируют ячейку по колонке шапки НАПРЯМУЮ.

    Строка без ячейки уронила бы каждый из трёх — и падение случилось бы уже
    на выпуске файла, а не при сборке данных.
    """
    root, left, right = tree
    in_slot(root)
    submit_children_across_a_rename(left, right)
    assemble(root)

    data = build(root)

    for row in data.rows:
        assert set(row.cells) == set(data.columns)


def test_the_totals_still_sum_the_rows_across_eras(types, tree):  # noqa: F811
    """Итог обязан сойтись со слагаемыми и здесь — иначе подписанная сводка
    расходится сама с собой."""
    root, left, right = tree
    in_slot(root)
    submit_children_across_a_rename(left, right)
    assemble(root)

    data = build(root)

    for column, total in data.totals.columns.items():
        assert total == sum(row.cells[column].count for row in data.rows)
    assert data.totals.columns["DUTY"] == 1
    assert data.totals.columns["НОВАЯ"] == 1


def test_the_live_order_stays_a_prefix_and_extras_follow(types, tree):  # noqa: F811
    """Шапка сводки — это порядок СТОЛБЦОВ в подписанном документе.

    Объединение не смеет перетасовать привычный порядок: колонки живого
    справочника идут первыми и в своём порядке, а колонки ушедших эпох
    дописываются В КОНЕЦ. Иначе документ за день с переименованием выглядел бы
    перестроенным целиком, и сверять его с вчерашним пришлось бы по названиям,
    а не по местам.
    """
    from organization_management.apps.operations.selectors import StatusTypeSelector
    from organization_management.apps.operations.strength_report import StatusCatalog

    root, left, right = tree
    in_slot(root)
    submit_children_across_a_rename(left, right)
    assemble(root)

    live = list(
        StatusCatalog.from_rows(StatusTypeSelector.catalog_rows()).columns_in_order()
    )
    columns = list(build(root).columns)

    assert columns[: len(live)] == live
    assert columns[len(live) :] == ["DUTY"]


def test_the_header_does_not_depend_on_dictionary_order(types, tree):  # noqa: F811
    """Две сборки одного дня обязаны дать один документ — его сравнивают с
    предыдущим глазами."""
    root, left, right = tree
    in_slot(root)
    submit_children_across_a_rename(left, right)
    assemble(root)

    assert build(root).columns == build(root).columns


# ── Название подразделения заморожено вместе с днём ──────────────────────


def test_a_renamed_child_keeps_its_name_in_an_assembled_summary(types, tree):  # noqa: F811
    """Сводка склеивает ЧУЖИЕ дни, и переименование одного из подразделений не
    смеет переписать строку в уже собранной сводке."""
    root, first, second = tree
    in_slot(root)
    in_slot(first)
    in_slot(second)
    submit(first)
    submit(second)
    assemble(root)
    before = [row.name for row in build(root).rows]

    Division.objects.filter(pk=first.pk).update(name="Переименованный отдел")

    assert [row.name for row in build(root).rows] == before
    assert "Первый отдел" in before


def test_the_summary_header_is_frozen_too(types, tree):  # noqa: F811
    """Шапка сводки — имя РОДИТЕЛЯ, и оно из его же снимка."""
    root, first, second = tree
    in_slot(root)
    in_slot(first)
    in_slot(second)
    submit(first)
    submit(second)
    assemble(root)

    Division.objects.filter(pk=root.pk).update(name="Другое управление")

    assert build(root).division_title == "Управление"
