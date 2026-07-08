"""Story 6.4 — чистый рендерер .pdf расхода (нередактируемая форма, FR-17).

Канон вёрстки — addendum §8, зеркало .docx 6.3: A4 landscape, kk-титул 16pt
жирным, 17-колоночная таблица (шапка и числа 12pt, списки членов 8pt),
строка ИТОГО жирным; ячейка статуса = количество + строки членов
(``_member_line`` из expense_docx, cap ``CELL_MAX_MEMBERS`` + ``… ещё N``),
ATTACHED — ``+N``. Ограничение plain-text ячейки fpdf2 — один размер шрифта
на ячейку: ячейка С членами набирается целиком 8pt (включая count), безчленные
числа — 12pt.

Шрифт — вендоренный **Liberation Serif** Regular+Bold из ``fonts/`` рядом с
модулем (SIL OFL 1.1, текст лицензии там же). НЕ «Times New Roman»: core-шрифты
fpdf2 — latin-1 (kk/ru-текст без TTF упадёт), а сам TNR — проприетарный шрифт
Microsoft, вендорить его .ttf в репо нельзя (Ловушка №4); Liberation Serif —
метрический аналог TNR (стандартная подмена fontconfig) с полным покрытием
kk-глифов (cmap-гвард — test_pdf_fonts.py). Константа ``FONT_NAME`` из
expense_docx к PDF сознательно НЕ применяется.

Генерация офлайн и нативная: без сети, без subprocess, без LibreOffice —
конверсия .docx→PDF через LibreOffice headless отклонена как тяжёлая системная
зависимость в air-gap контуре (Д5; fpdf2-рендер — 34ms/25KB, эмпирика
create-story). Чистая функция ``ExpenseDocumentData -> bytes``: без ORM,
wall-clock и записи на диск в НАШЕМ коде (единственное файловое чтение —
вендоренные TTF из ресурсов пакета; CreationDate в метаданных проставляет
сама библиотека — Д8); ``fpdf`` импортируется ЛЕНИВО. Рендерер НЕ считает и
НЕ пересортировывает: числа и порядок строк приходят готовыми от билдера.
"""

from pathlib import Path

from apps.documents.generators.expense_docx import (
    _DATE_FORMAT,
    _FIXED_HEAD,
    _TOTALS_LABEL,
    CELL_MAX_MEMBERS,
    DOCX_COLUMN_LABELS,
    DOCX_COLUMNS,
    MEMBER_SIZE_PT,
    TABLE_SIZE_PT,
    TITLE_SIZE_PT,
    _member_line,
)

_FONT_FAMILY = "Serif"
_FONTS_DIR = Path(__file__).resolve().parent / "fonts"

# Вертикальный шаг строки текста в таблице, мм. Дефолт fpdf2 (2×font_size ≈
# 8.5мм при 12pt) раздувает членские ячейки так, что строка таблицы перестаёт
# влезать в страницу — а строку fpdf2 между страницами НЕ разрывает
# (ValueError «too high»). 4мм ≈ одинарный интервал 12pt и просторный 8pt.
_LINE_HEIGHT_MM = 4
# Границы ширины колонки, мм: узкие — чисто числовые, широкие — членские
# (строка члена ~57мм при 8pt обязана влезать БЕЗ переноса, иначе cap-ячейка
# из 20 членов + хвост не помещается в страницу по высоте).
_MIN_COL_MM = 8
_MAX_COL_MM = 60
# Запас на внутренние поля ячейки (c_margin с двух сторон) при замере текста.
_CELL_PAD_MM = 2.5


def _status_cell_text(key, cell_data):
    """Текст статусной ячейки: count (ATTACHED — ``+N``) + строки членов с
    усечением cap + ``… ещё N`` — дубль closure ``fill_status_cell``
    (импортировать её нельзя, Ловушка №3)."""
    count_text = f"+{cell_data.count}" if key == "ATTACHED" else str(cell_data.count)
    shown = cell_data.members[:CELL_MAX_MEMBERS]
    lines = [_member_line(member) for member in shown]
    hidden = len(cell_data.members) - len(shown)
    if hidden > 0:
        lines.append(f"… ещё {hidden}")
    return "\n".join([count_text, *lines])


def _column_widths(pdf, data):
    """Относительные ширины 17 колонок по естественной ширине КОНТЕНТА
    (числа/имена 12pt, строки членов 8pt), clamp [``_MIN_COL_MM``,
    ``_MAX_COL_MM``] — fpdf2 нормализует значения как доли. Шапка ширину
    сознательно НЕ диктует: лейблы в узких колонках переносятся, пробы
    тестов идут по нормализованному тексту (Ловушка №7)."""
    widths = [0.0] * (len(_FIXED_HEAD) + len(DOCX_COLUMNS))

    def demand(index, text):
        widths[index] = max(widths[index], pdf.get_string_width(str(text)))

    totals = data.totals
    pdf.set_font(_FONT_FAMILY, style="B", size=TABLE_SIZE_PT)
    demand(1, _TOTALS_LABEL)
    for column, value in enumerate(
        (totals.staff_total, totals.list_total, totals.vacancies), start=2
    ):
        demand(column, value)
    for offset, key in enumerate(DOCX_COLUMNS, start=len(_FIXED_HEAD)):
        demand(
            offset, f"+{totals.attached}" if key == "ATTACHED" else totals.columns[key]
        )

    pdf.set_font(_FONT_FAMILY, style="", size=TABLE_SIZE_PT)
    for number, row in enumerate(data.rows, start=1):
        demand(0, number)
        demand(1, row.name)
        for column, value in enumerate(
            (row.staff_total, row.list_total, row.vacancies), start=2
        ):
            demand(column, value)
        for offset, key in enumerate(DOCX_COLUMNS, start=len(_FIXED_HEAD)):
            cell_data = row.attached if key == "ATTACHED" else row.cells[key]
            demand(
                offset,
                f"+{cell_data.count}" if key == "ATTACHED" else cell_data.count,
            )

    pdf.set_font(_FONT_FAMILY, style="", size=MEMBER_SIZE_PT)
    for row in data.rows:
        for offset, key in enumerate(DOCX_COLUMNS, start=len(_FIXED_HEAD)):
            cell_data = row.attached if key == "ATTACHED" else row.cells[key]
            for member in cell_data.members[:CELL_MAX_MEMBERS]:
                demand(offset, _member_line(member))

    return tuple(
        min(max(width + _CELL_PAD_MM, _MIN_COL_MM), _MAX_COL_MM) for width in widths
    )


def generate_expense_pdf(data):
    """``ExpenseDocumentData`` → байты официального .pdf (канон §8).

    Ленивая загрузка fpdf — зеркало ``generate_expense_docx``. Ограничение
    fpdf2: строка таблицы не разрывается между страницами — экстремальный
    документ (многие колонки по 20 членов разом) может не влезть по высоте и
    падает громким ``ValueError`` (STOP-семантика, не тихая порча вёрстки).
    """
    from fpdf import FPDF
    from fpdf.fonts import FontFace

    pdf = FPDF(orientation="landscape", format="A4")
    # add_font — ДО set_font; отдельно Regular ("") и Bold ("B"); параметр
    # ``uni`` устарел и не передаётся (Ловушка №9).
    pdf.add_font(
        _FONT_FAMILY, style="", fname=str(_FONTS_DIR / "LiberationSerif-Regular.ttf")
    )
    pdf.add_font(
        _FONT_FAMILY, style="B", fname=str(_FONTS_DIR / "LiberationSerif-Bold.ttf")
    )
    pdf.add_page()

    pdf.set_font(_FONT_FAMILY, style="B", size=TITLE_SIZE_PT)
    pdf.multi_cell(
        w=0,
        text=(
            f"{data.division_title} ЖЕКЕ ҚҰРАМЫНЫҢ САПТЫҚ ТІЗІМІ "
            f"{data.business_date.strftime(_DATE_FORMAT)} ЖЫЛҒЫ"
        ),
    )
    pdf.ln(2)

    col_widths = _column_widths(pdf, data)
    pdf.set_font(_FONT_FAMILY, style="", size=TABLE_SIZE_PT)
    header = _FIXED_HEAD + tuple(DOCX_COLUMN_LABELS[key] for key in DOCX_COLUMNS)
    with pdf.table(
        first_row_as_headings=True,
        headings_style=FontFace(emphasis="BOLD"),
        col_widths=col_widths,
        line_height=_LINE_HEIGHT_MM,
    ) as table:
        heading = table.row()
        for label in header:
            heading.cell(label)

        for number, row in enumerate(data.rows, start=1):
            body = table.row()
            for text in (
                str(number),
                row.name,
                str(row.staff_total),
                str(row.list_total),
                str(row.vacancies),
            ):
                body.cell(text)
            for key in DOCX_COLUMNS:
                cell_data = row.attached if key == "ATTACHED" else row.cells[key]
                if cell_data.members:
                    # Смена размера посреди строки таблицы: set_font_size
                    # ПЕРЕД cell (эмпирика спайка, Ловушка №9).
                    pdf.set_font_size(MEMBER_SIZE_PT)
                    body.cell(_status_cell_text(key, cell_data))
                    pdf.set_font_size(TABLE_SIZE_PT)
                else:
                    body.cell(_status_cell_text(key, cell_data))

        # Bold строки ИТОГО — set_font(style="B") ПЕРЕД table.row()
        # (приём спайка, Ловушка №9).
        pdf.set_font(_FONT_FAMILY, style="B", size=TABLE_SIZE_PT)
        totals = data.totals
        totals_row = table.row()
        for text in (
            "",
            _TOTALS_LABEL,
            str(totals.staff_total),
            str(totals.list_total),
            str(totals.vacancies),
        ):
            totals_row.cell(text)
        for key in DOCX_COLUMNS:
            if key == "ATTACHED":
                totals_row.cell(f"+{totals.attached}")
            else:
                totals_row.cell(str(totals.columns[key]))

    return bytes(pdf.output())
