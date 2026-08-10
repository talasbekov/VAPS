"""Состав в печатной форме идёт по канону порядка.

До этого среза люди в ячейке шли в порядке employee_id — то есть в порядке
появления строк в базе: старший по должности стоял между рядовыми потому, что его
завели позже. Для читателя это отсутствие порядка.

Проверяется на ДАННЫХ, где порядок канона расходится с порядком базы: совпади они
— тест не отличал бы одно от другого.
"""
from datetime import date

import pytest

from organization_management.apps.operations.expense_document import (
    build_expense_document,
)
from organization_management.apps.operations.expense_layout import member_lines
from organization_management.apps.operations.strength_report import StatusCatalog

DAY = date(2026, 8, 4)


@pytest.fixture
def catalog():
    return StatusCatalog.from_rows(
        [
            {
                "code": "IN_SERVICE",
                "priority": 999,
                "report_column_code": "IN_SERVICE",
                "counts_in_staff": True,
            },
            {
                "code": "DUTY",
                "priority": 10,
                "report_column_code": "ON_DUTY",
                "counts_in_staff": True,
            },
        ]
    )


def member(employee_id, full_name, level=None):
    return {
        "employee_id": employee_id,
        "full_name": full_name,
        "rank": "капитан",
        "position_level": level,
    }


def fact(employee_id):
    return {
        "employee_id": employee_id,
        "status_type_code": "DUTY",
        "date_start": DAY.isoformat(),
        "date_end": date(2026, 8, 10).isoformat(),
        "source": "USER",
    }


def document(catalog, roster):
    return build_expense_document(
        {"roster": roster, "rows": [fact(m["employee_id"]) for m in roster]},
        DAY,
        catalog=catalog,
        division_title="Управление",
        staff_total=10,
        vacancies=0,
        attached=0,
    )


def printed_names(data):
    (row,) = data.rows
    cell = row.cells["ON_DUTY"]
    return [m.full_name for m in cell.members]


def test_the_cell_lists_people_by_position_and_not_by_row_id(catalog):
    """Несущий тест: порядок базы и порядок канона здесь ПРОТИВОПОЛОЖНЫ."""
    roster = [
        member(1, "Абрамов", level=90),
        member(2, "Яковлев", level=10),
    ]

    assert printed_names(document(catalog, roster)) == ["Яковлев", "Абрамов"]


def test_people_of_one_level_go_alphabetically(catalog):
    roster = [
        member(1, "Яковлев", level=10),
        member(2, "Абрамов", level=10),
        member(3, "Мельник", level=10),
    ]

    assert printed_names(document(catalog, roster)) == [
        "Абрамов",
        "Мельник",
        "Яковлев",
    ]


def test_a_person_without_a_position_sinks_to_the_end(catalog):
    """Снимки, собранные до расширения схемы, уровня не несут вовсе — и
    документ по ним обязан собираться, ставя таких людей в конец."""
    roster = [
        member(1, "Абрамов"),
        member(2, "Яковлев", level=10),
    ]

    assert printed_names(document(catalog, roster)) == ["Яковлев", "Абрамов"]


def test_an_old_snapshot_without_the_field_at_all_still_builds(catalog):
    """Именно ОТСУТСТВИЕ ключа, а не None: старая раскладка поля не знала."""
    roster = [
        {"employee_id": 1, "full_name": "Абрамов", "rank": ""},
        {"employee_id": 2, "full_name": "Яковлев", "rank": ""},
    ]

    assert printed_names(document(catalog, roster)) == ["Абрамов", "Яковлев"]


def test_the_order_survives_the_truncation_of_a_long_cell(catalog):
    """Усечение режет ХВОСТ канонического порядка, а не случайных людей.

    Иначе в документе оставались бы двадцать произвольных фамилий, и «показаны
    первые двадцать» означало бы «первые двадцать по номеру строки в базе».
    """
    roster = [member(i, f"Сотрудник{i:02d}", level=100 - i) for i in range(1, 26)]

    printed = member_lines(document(catalog, roster).rows[0].cells["ON_DUTY"].members)

    # Старший по должности — с наибольшим i (уровень 100-i наименьший).
    assert printed[0].startswith("капитан Сотрудник25")
    assert "ещё 5" in printed[-1]


def test_the_document_is_stable_when_the_snapshot_order_changes(catalog):
    """Снимок мог быть записан в любом порядке; документ обязан выйти одним и
    тем же — его сравнивают со вчерашним."""
    roster = [
        member(1, "Иванов", level=10),
        member(2, "Иванов", level=10),
        member(3, "Абрамов", level=10),
    ]

    straight = printed_names(document(catalog, roster))
    reversed_ = printed_names(document(catalog, list(reversed(roster))))

    assert straight == reversed_
