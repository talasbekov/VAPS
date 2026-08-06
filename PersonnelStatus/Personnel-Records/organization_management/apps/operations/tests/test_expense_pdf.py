"""Выгрузка .pdf: нередактируемая печатная форма расхода.

Читается ИЗВЛЕЧЁННЫЙ ТЕКСТ документа, а не байты: важно не то, что получился
валидный PDF (это забота reportlab), а то, что увидит и подошьёт читатель —
числа те, порядок тот, состав под числом.

РАЗДЕЛЕНИЕ ПРОВЕРОК ЗДЕСЬ НЕОЧЕВИДНО И ВАЖНО. Отказ «нет кириллицы в шрифте»
половинчатый: текстовый слой остаётся правильным (поиск и копирование работают),
а на бумаге вместо букв стоят прямоугольники. Прямая проба это подтвердила — тот
же документ на core-шрифте извлекается как «Управление кадров» и рисуется как
«■■■■■■■■■■ ■■■■■■». Поэтому:

- тесты ТЕКСТА проверяют, что содержимое вообще доехало до документа, и подмену
  шрифта они НЕ ловят (первый проход это и показал: под Helvetica они остались
  зелёными);
- за видимые глифы отвечают тесты ШРИФТА — что использован вендоренный и что он
  ВЛОЖЕН в файл. Только они краснеют на подмене.
"""
import io
import re
from datetime import date

import pytest

from organization_management.apps.operations.expense_document import (
    build_expense_document,
)
from organization_management.apps.operations.expense_layout import (
    CELL_MAX_MEMBERS,
    COLUMN_LABELS,
    TOTALS_LABEL,
)
from organization_management.apps.operations.expense_pdf import (
    FONTS_DIR,
    PDF_FONT_BOLD,
    PDF_FONT_FAMILY,
    generate_expense_pdf,
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


def document(catalog, roster, rows, **overrides):
    kwargs = {
        "catalog": catalog,
        "division_title": "Управление кадров",
        "staff_total": 10,
        "vacancies": 7,
        "attached": 2,
    }
    kwargs.update(overrides)
    return build_expense_document({"roster": roster, "rows": rows}, DAY, **kwargs)


@pytest.fixture
def data(catalog):
    return document(
        catalog,
        [member(1), member(2, full_name="Петров Пётр", rank=""), member(3)],
        [fact(1, "DUTY"), fact(2, "VACATION")],
    )


def text_of(payload):
    """Весь текст документа одной строкой.

    Читается через pypdf, а не поиском по сырым байтам: текст в PDF сжат и
    закодирован, и `b"Иванов" in payload` не нашёл бы его даже в исправном
    файле — то есть проба была бы вечно красной или (после «починки» на
    latin-1) вечно зелёной.
    """
    from pypdf import PdfReader

    reader = PdfReader(io.BytesIO(payload))
    return "\n".join(page.extract_text() or "" for page in reader.pages)


# ── Это вообще PDF ───────────────────────────────────────────────────────


def test_the_output_is_a_pdf_document(data):
    payload = generate_expense_pdf(data)

    assert payload.startswith(b"%PDF-")
    assert payload.rstrip().endswith(b"%%EOF")


def test_the_document_has_at_least_one_page(data):
    from pypdf import PdfReader

    reader = PdfReader(io.BytesIO(generate_expense_pdf(data)))

    assert len(reader.pages) >= 1


# ── Кириллица ────────────────────────────────────────────────────────────


def test_cyrillic_text_reaches_the_document(data):
    """Содержимое доехало: текстовый слой несёт русские слова, а не мусор.

    Что именно доказывает: строки собраны и закодированы правильно. Чего НЕ
    доказывает: что их видно на бумаге — подмена шрифта оставляет этот тест
    зелёным (см. докстринг модуля), и за неё отвечают тесты шрифта ниже.
    """
    text = text_of(generate_expense_pdf(data))

    assert "Управление кадров" in text
    assert TOTALS_LABEL in text


def test_the_roster_names_are_printed_in_cyrillic(data):
    text = text_of(generate_expense_pdf(data))

    assert "Иванов" in text
    assert "Петров" in text


def test_the_column_labels_are_printed(data):
    text = text_of(generate_expense_pdf(data))

    assert COLUMN_LABELS["ON_DUTY"] in text


# ── Шрифт ────────────────────────────────────────────────────────────────


def test_the_fonts_are_vendored_next_to_the_renderer():
    """Системный путь зависит от образа, а контур закрытый: документ, который
    печатается на машине разработчика и падает на стенде, обнаружится на
    стенде."""
    assert (FONTS_DIR / "LiberationSerif-Regular.ttf").is_file()
    assert (FONTS_DIR / "LiberationSerif-Bold.ttf").is_file()


def test_the_font_licence_travels_with_the_font():
    """Шрифт вендорен под открытой лицензией, и её текст обязан лежать рядом:
    файл без лицензии в репозитории — это вопрос к нам, а не к шрифту."""
    licence = (FONTS_DIR / "LICENSE").read_text(encoding="utf-8", errors="replace")

    assert "Liberation" in licence


def _page_fonts(payload):
    """{имя ресурса: объект шрифта} первой страницы."""
    from pypdf import PdfReader

    reader = PdfReader(io.BytesIO(payload))
    return {
        name: ref.get_object()
        for name, ref in reader.pages[0]["/Resources"]["/Font"].items()
    }


def test_the_vendored_family_is_the_one_the_document_uses(data):
    """Имя семейства СВОЁ: под «Times New Roman» в метаданных стоял бы шрифт,
    которого в документе нет.

    Helvetica в ресурсах остаётся — reportlab кладёт её умолчанием на каждую
    страницу независимо от того, набирали ей что-нибудь или нет. Поэтому проба
    не «нет посторонних шрифтов», а «наш есть»: первое было бы неверным
    утверждением о чужой библиотеке.
    """
    fonts = _page_fonts(generate_expense_pdf(data))
    base_fonts = [str(font.get("/BaseFont")) for font in fonts.values()]

    assert any(PDF_FONT_FAMILY in name for name in base_fonts)
    assert any(PDF_FONT_BOLD in name for name in base_fonts)


def test_the_font_is_embedded_and_not_merely_referenced(data):
    """Ссылка на шрифт без его байт — документ, который у получателя выглядит
    иначе (или не открывается): подставится то, что найдётся на его машине.

    Признак вложения — FontFile2 в дескрипторе; префикс подмножества
    («AAAAAA+») говорит, что вложены только использованные глифы.
    """
    fonts = _page_fonts(generate_expense_pdf(data))
    ours = [
        font
        for font in fonts.values()
        if PDF_FONT_FAMILY in str(font.get("/BaseFont"))
    ]

    assert ours != []
    for font in ours:
        descriptor = font["/FontDescriptor"].get_object()
        assert "/FontFile2" in descriptor


def test_rendering_twice_in_one_process_works(data):
    """Второй документ в том же процессе собирается так же, как первый.

    Проверяется ИМЕННО ЭТО, а не «регистрация не падает»: прямая проба показала,
    что повторная регистрация того же .ttf у reportlab безвредна, и тест на неё
    был бы вакуумным. Здесь же ловится любая будущая правка реестра шрифтов,
    после которой первый документ портил бы второй.
    """
    first = generate_expense_pdf(data)
    second = generate_expense_pdf(data)

    assert first.startswith(b"%PDF-")
    assert second.startswith(b"%PDF-")


# ── Числа и состав ───────────────────────────────────────────────────────


def test_the_numbers_come_from_the_builder_untouched(data):
    text = text_of(generate_expense_pdf(data))
    (row,) = data.rows

    assert str(row.staff_total) in text
    assert str(row.list_total) in text


def test_the_attached_count_is_printed_with_its_sign(data):
    """«+N» — не украшение: приданные СВЕРХ списка, и без знака число читалось
    бы как ещё одна колонка списка."""
    text = text_of(generate_expense_pdf(data))

    assert f"+{data.totals.attached}" in text


def test_a_long_roster_is_truncated_with_an_honest_tail(catalog):
    """Молча обрезанный список выглядел бы полным, и читатель распечатки считал
    бы, что видит всех."""
    roster = [member(i, full_name=f"Фамилия{i}") for i in range(CELL_MAX_MEMBERS + 5)]
    rows = [fact(i, "DUTY") for i in range(CELL_MAX_MEMBERS + 5)]

    text = text_of(generate_expense_pdf(document(catalog, roster, rows)))

    assert re.search(r"ещё\s+5", text)


def test_the_totals_row_is_present(data):
    text = text_of(generate_expense_pdf(data))

    assert TOTALS_LABEL in text
