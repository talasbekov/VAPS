"""Выгрузка .csv: диалект, раскладка и то, чего в ней нет.

Диалект проверяется по БАЙТАМ, а не по разобранной таблице: BOM, `;` и CRLF
существуют ради Excel в ru-локали, и разбор своим же csv-модулем подтвердил бы
только то, что мы согласны сами с собой.
"""
from datetime import date

import pytest

from organization_management.apps.operations.expense_csv import generate_expense_csv
from organization_management.apps.operations.expense_document import (
    build_expense_document,
)
from organization_management.apps.operations.expense_layout import (
    COLUMN_LABELS,
    TOTALS_LABEL,
)
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
            {
                "code": "VACATION",
                "priority": 30,
                "report_column_code": "VACATION",
                "counts_in_staff": True,
            },
        ]
    )


def member(employee_id, full_name="Иванов Иван", rank="капитан"):
    return {"employee_id": employee_id, "full_name": full_name, "rank": rank}


def fact(employee_id, code):
    return {
        "employee_id": employee_id,
        "status_type_code": code,
        "date_start": DAY.isoformat(),
        "date_end": date(2026, 8, 10).isoformat(),
        "source": "USER",
    }


@pytest.fixture
def data(catalog):
    snapshot = {
        "roster": [member(1), member(2, full_name="Петров Пётр"), member(3)],
        "rows": [fact(1, "DUTY"), fact(2, "VACATION")],
    }
    return build_expense_document(
        snapshot,
        DAY,
        catalog=catalog,
        division_title="Управление кадров",
        staff_total=10,
        vacancies=7,
        attached=2,
    )


def rows_of(blob):
    text = blob.decode("utf-8-sig")
    return [line.split(";") for line in text.split("\r\n") if line]


# ── Диалект ──────────────────────────────────────────────────────────────


def test_the_file_starts_with_a_bom(data):
    """Без BOM Excel в ru-локали открывает кириллицу мусором."""
    assert generate_expense_csv(data).startswith(b"\xef\xbb\xbf")


def test_the_delimiter_is_a_semicolon(data):
    blob = generate_expense_csv(data).decode("utf-8-sig")

    assert ";" in blob.splitlines()[1]
    assert "\t" not in blob


def test_lines_end_with_crlf(data):
    assert b"\r\n" in generate_expense_csv(data)


def test_the_content_is_utf8(data):
    blob = generate_expense_csv(data)

    assert "Управление кадров" in blob.decode("utf-8-sig")


# ── Раскладка ────────────────────────────────────────────────────────────


def test_the_title_names_the_division_and_the_date(data):
    title = rows_of(generate_expense_csv(data))[0][0]

    assert "Управление кадров" in title
    assert "04.08.2026" in title


def test_the_header_follows_the_catalog_order_with_labels(data):
    header = rows_of(generate_expense_csv(data))[1]

    assert header[:5] == ["№", "Управление", "По штату", "По списку", "Вакансии"]
    assert header[5:] == [
        COLUMN_LABELS["ON_DUTY"],
        COLUMN_LABELS["VACATION"],
        COLUMN_LABELS["IN_SERVICE"],
        "Придано (+N)",
    ]


def test_an_unknown_column_is_printed_by_its_code():
    """Подпись незнакомой колонке не выдумывается.

    Пустая ячейка шапки скрыла бы от читателя, что колонка вообще есть.
    """
    catalog = StatusCatalog.from_rows(
        [
            {
                "code": "IN_SERVICE",
                "priority": 999,
                "report_column_code": "IN_SERVICE",
                "counts_in_staff": True,
            },
            {
                "code": "CUSTOM",
                "priority": 5,
                "report_column_code": "CUSTOM_COLUMN",
                "counts_in_staff": True,
            },
        ]
    )
    data = build_expense_document(
        {"roster": [], "rows": []},
        DAY,
        catalog=catalog,
        division_title="Управление",
        staff_total=0,
        vacancies=0,
    )

    assert "CUSTOM_COLUMN" in rows_of(generate_expense_csv(data))[1]


def test_the_data_row_carries_the_numbers(data):
    row = rows_of(generate_expense_csv(data))[2]

    assert row[0] == "1"
    assert row[1] == "Управление кадров"
    assert row[2:5] == ["10", "3", "7"]  # штат, список, вакансии
    assert row[5:] == ["1", "1", "1", "2"]  # дежурство, отпуск, в строю, придано


def test_the_totals_row_has_no_number_and_carries_the_label(data):
    totals = rows_of(generate_expense_csv(data))[-1]

    assert totals[0] == ""
    assert totals[1] == TOTALS_LABEL
    assert totals[2:5] == ["10", "3", "7"]
    assert totals[-1] == "2"


# ── Чего в машиночитаемой форме нет ──────────────────────────────────────


def test_the_csv_carries_no_member_names(data):
    """CSV — таблица чисел.

    Ячейка с двадцатью фамилиями не откроется ни одним потребителем CSV так,
    как он ожидает; поимённый состав живёт в документных формах.
    """
    blob = generate_expense_csv(data).decode("utf-8-sig")

    assert "Петров" not in blob
    assert "Иванов" not in blob


def test_the_renderer_does_not_reorder_or_recount(data):
    """Числа приходят готовыми: рендерер повторяет их, а не считает.

    Второй счёт над теми же данными разошёлся бы с первым на редком случае —
    и именно в подписанном документе.
    """
    row = rows_of(generate_expense_csv(data))[2]
    expected = [str(data.rows[0].cells[column].count) for column in data.columns]

    assert row[5:-1] == expected
