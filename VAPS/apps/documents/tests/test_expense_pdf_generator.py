"""Тесты чистого рендерера .pdf расхода (Story 6.4, AC-1/4/6).

БЕЗ ``django_db``: рендерер — чистая функция (datacls-вход → bytes), парсим
обратно ``pypdf.PdfReader``. PDF-байты недетерминированы (CreationDate
библиотеки — Ловушка №6), потому тесты ПАРСЯТ, а не диффают. Пробы текста —
по НОРМАЛИЗОВАННОМУ тексту (``"".join(text.split())``): extract_text вставляет
переносы внутри титула и узких колонок шапки (Ловушка №7). Числа фикстуры —
уникальные трёхзначные ВНЕ диапазонов дат/№/титула: presence == mapping.
"""

import re
from datetime import date
from io import BytesIO

import pytest
from pypdf import PdfReader

from apps.documents.generators import (
    CELL_MAX_MEMBERS,
    DOCX_COLUMN_LABELS,
    DOCX_COLUMNS,
    ExpenseCell,
    ExpenseCellMember,
    ExpenseDocumentData,
    ExpenseRow,
    ExpenseTotals,
    generate_expense_pdf,
)

D = date(2026, 7, 8)


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
    """Фикстура с уникальными трёхзначными числами (анти-C2: не пересекаются
    с фрагментами дат 01/07/10/2026/08, № строк и датой титула)."""
    if rows is None:
        rows = [
            ExpenseRow(
                name="1-е управление",
                staff_total=431,
                list_total=352,
                vacancies=179,
                cells=_cells(
                    IN_SERVICE=ExpenseCell(count=241, members=()),
                    TRAINING=ExpenseCell(
                        count=122,
                        members=(
                            _member(full_name="Петров Пётр"),
                            _member(rank="майор", full_name="Сидоров Сидор"),
                        ),
                    ),
                ),
                attached=ExpenseCell(count=573, members=(_member(),)),
            )
        ]
    if totals is None:
        totals = _totals(
            staff_total=644,
            list_total=538,
            vacancies=196,
            attached=468,
            columns={"IN_SERVICE": 317, "TRAINING": 122},
        )
    return ExpenseDocumentData(
        division_title=division_title, business_date=D, rows=rows, totals=totals
    )


def _extracted(data):
    result = generate_expense_pdf(data)
    assert isinstance(result, bytes)
    assert result[:5] == b"%PDF-"
    reader = PdfReader(BytesIO(result))
    return reader, "\n".join(page.extract_text() for page in reader.pages)


def test_bytes_roundtrip_and_a4_landscape_mediabox():
    reader, _ = _extracted(_data())
    page = reader.pages[0]
    # fpdf2 даёт 841.89×595.28 pt — точный assert упадёт (Ловушка №9).
    assert round(float(page.mediabox.width)) == 842
    assert round(float(page.mediabox.height)) == 595


def test_title_kk_substrings_present():
    _, text = _extracted(_data())
    normalized = "".join(text.split())
    assert "ҚҰРАМЫНЫҢ" in normalized
    assert "ЖЫЛҒЫ" in normalized
    assert "1-еуправление" in normalized  # division_title
    assert "08.07.2026" in normalized  # дата титула


def test_header_labels_present_normalized():
    _, text = _extracted(_data())
    normalized = "".join(text.split())
    for label in ("№", "Управление", "По штату", "По списку", "Вакансии"):
        assert "".join(label.split()) in normalized, label
    for label in DOCX_COLUMN_LABELS.values():
        # Узкие колонки переносят даже внутри слова — нормализация убирает
        # переносы, проба идёт по форме лейбла без пробелов.
        assert "".join(label.split()) in normalized, label


def test_every_unique_fixture_number_is_a_token():
    _, text = _extracted(_data())
    tokens = set(re.split(r"\D+", text))
    for number in ("431", "352", "179", "241", "122", "644", "538", "196", "317"):
        assert number in tokens, number


def test_attached_plus_n_and_totals_label_present():
    _, text = _extracted(_data())
    normalized = "".join(text.split())
    assert "+573" in normalized
    assert "+468" in normalized  # ИТОГО: ATTACHED тоже «+N»
    assert "ИТОГО" in normalized


def test_member_lines_present_and_empty_cells_only_number():
    _, text = _extracted(_data())
    normalized = "".join(text.split())
    assert "ПетровПётр" in normalized
    assert "СидоровСидор" in normalized
    assert "01.07.2026–10.07.2026" in normalized
    # Безчленные ячейки не тянут за собой членских строк: члены во всей
    # фикстуре ровно трое.
    assert normalized.count("Иванов") == 1
    assert normalized.count("Петров") == 1
    assert normalized.count("Сидоров") == 1


def test_truncation_tail_over_cap_members():
    members = tuple(
        _member(full_name=f"Сотрудник{n:02d}") for n in range(CELL_MAX_MEMBERS + 1)
    )
    row = ExpenseRow(
        name="Отдел",
        staff_total=431,
        list_total=352,
        vacancies=179,
        cells=_cells(ON_DUTY=ExpenseCell(count=len(members), members=members)),
        attached=ExpenseCell(count=0, members=()),
    )
    _, text = _extracted(_data(rows=[row], totals=_totals()))
    normalized = "".join(text.split())
    assert "…ещё1" in normalized
    assert f"Сотрудник{CELL_MAX_MEMBERS - 1:02d}" in normalized  # последний видимый
    assert f"Сотрудник{CELL_MAX_MEMBERS:02d}" not in normalized  # 21-й усечён


def test_rows_rendered_in_given_order():
    rows = [
        ExpenseRow(
            name=name,
            staff_total=staff,
            list_total=1,
            vacancies=0,
            cells=_cells(IN_SERVICE=ExpenseCell(count=1, members=())),
            attached=ExpenseCell(count=0, members=()),
        )
        # нарочно НЕ по алфавиту; уникальные трёхзначные маркеры порядка
        for name, staff in (("Яблоко", 314), ("Абрикос", 728))
    ]
    _, text = _extracted(_data(rows=rows, totals=_totals()))
    # Позиции маркеров в сыром тексте: fpdf2 кладёт строки сверху вниз,
    # extract_text отдаёт их в порядке чтения (эмпирика спайка).
    assert text.index("314") < text.index("728")
    assert text.index("Яблоко") < text.index("Абрикос")


def test_multipage_document_breaks_pages_keeps_numbers_and_repeats_header():
    # Многострочный документ (свод — потребитель 6.5/6.10) рвётся на страницы
    # штатно: ни одного потерянного числа, порядок строк сквозь разрыв
    # сохранён, шапка автоповторяется (Ловушка №9), ValueError «row too high»
    # не всплывает на однострочных ячейках.
    markers = [101 + n for n in range(60)]  # уникальные трёхзначные (анти-C2)
    rows = [
        ExpenseRow(
            name=f"Строка {n:02d}",
            staff_total=marker,
            list_total=1,
            vacancies=0,
            cells=_cells(IN_SERVICE=ExpenseCell(count=1, members=())),
            attached=ExpenseCell(count=0, members=()),
        )
        for n, marker in enumerate(markers, start=1)
    ]
    reader, text = _extracted(_data(rows=rows, totals=_totals()))
    assert len(reader.pages) >= 2
    tokens = set(re.split(r"\D+", text))
    missing = [marker for marker in markers if str(marker) not in tokens]
    assert missing == []
    # Порядок сквозь разрыв страницы: страницы склеены в порядке чтения.
    assert text.index("101") < text.index("130") < text.index("160")
    # Шапка повторена на каждой странице после разрыва.
    for page in reader.pages[1:]:
        assert "Управление" in "".join(page.extract_text().split())
    # ИТОГО — на последней странице, после всех строк данных.
    assert "ИТОГО" in "".join(reader.pages[-1].extract_text().split())


def test_zero_rows_renders_header_and_totals_only():
    # Row-агностичность (Д11, зеркало QA-судьи 6.3 по docx): 0 строк →
    # титул + шапка + ИТОГО без падения; опора контракта для свода 6.5.
    reader, text = _extracted(_data(rows=[], totals=_totals()))
    assert len(reader.pages) == 1
    normalized = "".join(text.split())
    assert "ИТОГО" in normalized
    assert "+1" in normalized  # ATTACHED строки ИТОГО (_totals: attached=1)


def test_missing_status_key_raises_loudly_stop_semantics():
    # STOP-семантика (AC-1): неполный контракт (ячейка колонки пропала) роняет
    # рендерер KeyError'ом, а не рисует таблицу с молчаливой дырой.
    cells = _cells()
    del cells["SICK"]
    row = ExpenseRow(
        name="Отдел",
        staff_total=431,
        list_total=352,
        vacancies=179,
        cells=cells,
        attached=ExpenseCell(count=0, members=()),
    )
    with pytest.raises(KeyError):
        generate_expense_pdf(_data(rows=[row], totals=_totals()))
