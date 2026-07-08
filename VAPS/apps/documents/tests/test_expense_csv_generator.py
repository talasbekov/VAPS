"""Тесты чистого рендерера .csv расхода (Story 6.4, AC-1/3/6).

БЕЗ ``django_db``: рендерер — чистая функция (datacls-вход → bytes), парсим
обратно stdlib ``csv.reader``. CSV — числовая форма (Д4): члены ячеек НЕ
выгружаются, ATTACHED — int без «+»; диалект ``;`` + utf-8-sig + CRLF
(Excel ru-локали открывает двойным кликом).
"""

import csv
from datetime import date
from io import StringIO

import pytest

from apps.documents.generators import (
    DOCX_COLUMN_LABELS,
    DOCX_COLUMNS,
    ExpenseCell,
    ExpenseCellMember,
    ExpenseDocumentData,
    ExpenseRow,
    ExpenseTotals,
    generate_expense_csv,
)

D = date(2026, 7, 8)

# Раскладка полей data-строки: № | Управление | По штату | По списку |
# Вакансии | 12 колонок DOCX_COLUMNS (0-based индексы полей csv-строки).
_FIXED_HEAD = ("№", "Управление", "По штату", "По списку", "Вакансии")


def _col(key):
    return len(_FIXED_HEAD) + DOCX_COLUMNS.index(key)


def _member(rank="капитан", full_name="Иванов Иван"):
    return ExpenseCellMember(
        rank=rank,
        full_name=full_name,
        date_start=date(2026, 7, 1),
        date_end=date(2026, 7, 10),
    )


def _cells(**counts):
    cells = {}
    for key in DOCX_COLUMNS:
        if key == "ATTACHED":
            continue
        cells[key] = counts.get(key, ExpenseCell(count=0, members=()))
    return cells


def _totals(**overrides):
    columns = {key: 0 for key in DOCX_COLUMNS if key != "ATTACHED"}
    columns.update(overrides.pop("columns", {}))
    defaults = {"staff_total": 10, "list_total": 8, "vacancies": 2, "attached": 1}
    defaults.update(overrides)
    return ExpenseTotals(columns=columns, **defaults)


def _data(rows=None, totals=None, division_title="1-е управление"):
    if rows is None:
        rows = [
            ExpenseRow(
                name="1-е управление",
                staff_total=10,
                list_total=8,
                vacancies=2,
                cells=_cells(
                    IN_SERVICE=ExpenseCell(count=4, members=()),
                    TRAINING=ExpenseCell(
                        count=2,
                        members=(
                            _member(full_name="Петров Пётр"),
                            _member(rank="майор", full_name="Сидоров Сидор"),
                        ),
                    ),
                ),
                attached=ExpenseCell(count=1, members=(_member(),)),
            )
        ]
    if totals is None:
        totals = _totals(columns={"IN_SERVICE": 4, "TRAINING": 2})
    return ExpenseDocumentData(
        division_title=division_title, business_date=D, rows=rows, totals=totals
    )


def _parsed(data):
    raw = generate_expense_csv(data)
    assert isinstance(raw, bytes)
    return list(csv.reader(StringIO(raw.decode("utf-8-sig")), delimiter=";"))


def test_bytes_start_with_bom_and_crlf_line_terminator():
    raw = generate_expense_csv(_data())
    assert raw[:3] == b"\xef\xbb\xbf"  # utf-8-sig BOM — Excel-friendly
    body = raw.decode("utf-8-sig")
    assert "\r\n" in body
    # Терминатор ТОЛЬКО CRLF: голых \n (вне пары \r\n) нет.
    assert body.replace("\r\n", "").count("\n") == 0


def test_title_is_first_row_single_field():
    rows = _parsed(_data())
    assert rows[0] == ["1-е управление ЖЕКЕ ҚҰРАМЫНЫҢ САПТЫҚ ТІЗІМІ 08.07.2026 ЖЫЛҒЫ"]


def test_header_is_second_row_17_columns_literal():
    rows = _parsed(_data())
    assert rows[1] == list(_FIXED_HEAD) + [
        DOCX_COLUMN_LABELS[key] for key in DOCX_COLUMNS
    ]
    assert rows[1] == [
        "№",
        "Управление",
        "По штату",
        "По списку",
        "Вакансии",
        "В строю",
        "На дежурстве",
        "После дежурства",
        "В командировке",
        "Учёба/соревнования/конференция",
        "В отпуске",
        "На больничном",
        "Прикомандирован",
        "Откомандирован",
        "Перед дежурством",
        "Иное",
        "Уточняется",
    ]


def test_data_row_layout_name_present_and_numbers_parse_int():
    rows = _parsed(_data())
    body = rows[2]
    assert len(body) == 17
    assert body[0] == "1"
    assert body[1] == "1-е управление"  # анти-C1: имя подразделения обязано быть
    # Все поля, кроме «Управление», — целые числа (int() не бросает).
    numeric = [field for index, field in enumerate(body) if index != 1]
    assert [int(field) for field in numeric] == [
        1,
        10,
        8,
        2,
        4,
        0,
        0,
        0,
        2,
        0,
        0,
        1,
        0,
        0,
        0,
        0,
    ]


def test_attached_is_plain_int_without_plus_and_without_members():
    rows = _parsed(_data())
    assert rows[2][_col("ATTACHED")] == "1"  # машиночитаемость: без «+»
    flat = ";".join(";".join(row) for row in rows)
    assert "+" not in flat
    assert "Иванов" not in flat  # членских строк нет нигде (Д4)
    assert "Петров" not in flat
    assert "…" not in flat


def test_totals_is_last_row_number_empty_label_in_division_column():
    rows = _parsed(_data())
    totals = rows[-1]
    assert len(rows) == 4  # титул + шапка + 1 строка данных + ИТОГО
    assert totals[0] == ""  # «№» — пустое поле
    assert totals[1] == "ИТОГО"  # анти-C1: лейбл в колонке «Управление»
    assert [int(field) for field in totals[2:]] == [
        10,
        8,
        2,
        4,
        0,
        0,
        0,
        2,
        0,
        0,
        1,
        0,
        0,
        0,
        0,
    ]


def test_rows_rendered_in_given_order_without_resort():
    rows_input = [
        ExpenseRow(
            name=name,
            staff_total=1,
            list_total=1,
            vacancies=0,
            cells=_cells(IN_SERVICE=ExpenseCell(count=1, members=())),
            attached=ExpenseCell(count=0, members=()),
        )
        for name in ("Яблоко", "Абрикос")  # нарочно НЕ по алфавиту
    ]
    rows = _parsed(_data(rows=rows_input, totals=_totals()))
    assert [rows[2][0], rows[2][1]] == ["1", "Яблоко"]
    assert [rows[3][0], rows[3][1]] == ["2", "Абрикос"]


def test_delimiter_and_quotes_in_names_roundtrip_escaped():
    # Имя с «;» и кавычками обязано экранироваться csv.writer'ом и
    # round-trip'иться reader'ом без сдвига колонок (гвард от замены
    # csv.writer наивным ";".join при рефакторинге).
    tricky_name = 'Отдел "Юг"; резерв'
    rows_input = [
        ExpenseRow(
            name=tricky_name,
            staff_total=1,
            list_total=1,
            vacancies=0,
            cells=_cells(IN_SERVICE=ExpenseCell(count=1, members=())),
            attached=ExpenseCell(count=0, members=()),
        )
    ]
    rows = _parsed(
        _data(rows=rows_input, totals=_totals(), division_title="Штаб; Центр")
    )
    # Титул с «;» — по-прежнему ОДНО поле первой строки.
    assert rows[0] == ["Штаб; Центр ЖЕКЕ ҚҰРАМЫНЫҢ САПТЫҚ ТІЗІМІ 08.07.2026 ЖЫЛҒЫ"]
    body = rows[2]
    assert len(body) == 17  # «;» внутри имени не размножил поля
    assert body[1] == tricky_name


def test_zero_rows_renders_header_and_totals_only():
    # Row-агностичность (Д11, зеркало QA-судьи 6.3 по docx): 0 строк →
    # титул + шапка + ИТОГО без падения; опора контракта для свода 6.5.
    rows = _parsed(_data(rows=[], totals=_totals()))
    assert len(rows) == 3  # титул + шапка + ИТОГО
    assert rows[-1][0] == ""
    assert rows[-1][1] == "ИТОГО"


def test_missing_status_key_raises_loudly_stop_semantics():
    # STOP-семантика (AC-1): неполный контракт (ячейка колонки пропала) роняет
    # рендерер KeyError'ом, а не выгружает строку с молчаливой дырой.
    cells = _cells()
    del cells["SICK"]
    row = ExpenseRow(
        name="Отдел",
        staff_total=1,
        list_total=1,
        vacancies=0,
        cells=cells,
        attached=ExpenseCell(count=0, members=()),
    )
    with pytest.raises(KeyError):
        generate_expense_csv(_data(rows=[row], totals=_totals()))
