"""Рендерер .pdf расхода — нередактируемая форма (порт зоны
apps/documents/generators/expense_pdf.py из Backend/VAPS).

ЧЕТВЁРТЫЙ ФОРМАТ, И У НЕГО СВОЙ ПОТРЕБИТЕЛЬ. .csv — числа для дальнейшего
счёта, .xlsx — лист для работы, .docx — страница под подпись, которую ещё правят.
.pdf — то, что УЖЕ не правят: его отправляют, печатают и подшивают, и получатель
видит ровно то, что отправитель отправил. Именно поэтому он не «ещё один
экспорт»: остальные три формы получатель может изменить, не оставив следа.

ОТЛИЧИЕ ОТ ИСТОЧНИКА — БИБЛИОТЕКА. Там fpdf2, здесь reportlab: он уже стоит в
зависимостях старого проекта и уже используется его отчётами. Тянуть вторую
библиотеку рисования PDF ради одного рендерера значило бы держать в контуре два
способа делать одно и то же, каждый со своими шрифтами и своими сюрпризами.

ШРИФТ ВЕНДОРЕН, А НЕ ВЗЯТ ИЗ СИСТЕМЫ, и это не перестраховка:

- встроенные шрифты PDF (Helvetica и прочие core-14) кириллицы НЕ СОДЕРЖАТ, и
  отказ этот особенно неприятен тем, что он ПОЛОВИНЧАТЫЙ: текстовый слой
  документа остаётся правильным — поиск находит слова, копирование выдаёт их
  верно, — а на бумаге и на экране вместо букв стоят пустые прямоугольники.
  Проверено прямой пробой: тот же документ на core-шрифте извлекается как
  «Управление кадров» и рисуется как «■■■■■■■■■■ ■■■■■■». Отсюда важное
  следствие для тестов — чтение текста обратно этот дефект НЕ ЛОВИТ, и
  единственный, кто его ловит, это проверка вложенного шрифта;
- системный путь /usr/share/fonts зависит от образа. Контур закрытый, образ
  собирают отдельно, и документ, который печатается на машине разработчика и
  падает на стенде, — худший из возможных исходов, потому что обнаружится он
  на стенде;
- «Times New Roman» здесь недоступен: шрифт проприетарный, класть его .ttf в
  репозиторий нельзя. Liberation Serif — метрический аналог TNR (стандартная
  подмена fontconfig) под открытой лицензией, и лицензия лежит рядом с ним.

Рендерер НИЧЕГО не считает и не пересортировывает: числа и порядок строк
приходят готовыми от билдера. reportlab импортируется ЛЕНИВО — раздел не должен
требовать библиотеку рисования, чтобы сдать день.
"""
from pathlib import Path

from organization_management.apps.operations.expense_layout import (
    TABLE_SIZE_PT,
    TITLE_SIZE_PT,
    TOTALS_LABEL,
    document_title,
    header_row,
    member_lines,
)

FONTS_DIR = Path(__file__).resolve().parent / "fonts"
# Имя семейства СВОЁ, а не «Times New Roman»: под чужим именем в метаданных
# документа стоял бы шрифт, которого в нём нет.
PDF_FONT_FAMILY = "LiberationSerif"
PDF_FONT_BOLD = "LiberationSerif-Bold"
# Состав печатается мельче числа — как и в .docx: у PDF-таблицы ячейка своя, и
# два размера в ней разрешены.
MEMBER_SIZE_PT = 8


def _register_fonts():
    """Зарегистрировать вендоренные начертания.

    Реестр шрифтов у reportlab ГЛОБАЛЬНЫЙ на процесс, поэтому регистрация идёт
    по требованию: первый документ её делает, остальные застают готовое. Это
    экономия разбора .ttf, а НЕ защита от поломки — повторная регистрация того
    же файла у reportlab безвредна (проверено прямой пробой: снятие проверки не
    ломает ни один тест). Писать здесь «иначе сломается» значило бы объяснять
    код угрозой, которой нет.
    """
    from reportlab.pdfbase import pdfmetrics
    from reportlab.pdfbase.ttfonts import TTFont

    registered = pdfmetrics.getRegisteredFontNames()
    if PDF_FONT_FAMILY not in registered:
        pdfmetrics.registerFont(
            TTFont(PDF_FONT_FAMILY, str(FONTS_DIR / "LiberationSerif-Regular.ttf"))
        )
    if PDF_FONT_BOLD not in registered:
        pdfmetrics.registerFont(
            TTFont(PDF_FONT_BOLD, str(FONTS_DIR / "LiberationSerif-Bold.ttf"))
        )


def _cell_text(cell):
    """Текст статусной ячейки: число, под ним состав.

    Состав тот же и в том же усечении, что в прочих документных формах, —
    берётся общим `member_lines`. Свой обход состава здесь разошёлся бы с ними
    ровно в тот день, когда правило усечения поменяют.
    """
    if not cell.members:
        return str(cell.count)
    return "\n".join([str(cell.count), *member_lines(cell.members)])


def generate_expense_pdf(data):
    """Данные документа → байты .pdf."""
    import io

    from reportlab.lib import colors
    from reportlab.lib.pagesizes import A4, landscape
    from reportlab.lib.styles import ParagraphStyle
    from reportlab.lib.units import mm
    from reportlab.platypus import (
        Paragraph,
        SimpleDocTemplate,
        Spacer,
        Table,
        TableStyle,
    )

    _register_fonts()

    title_style = ParagraphStyle(
        "ExpenseTitle",
        fontName=PDF_FONT_BOLD,
        fontSize=TITLE_SIZE_PT,
        leading=TITLE_SIZE_PT * 1.2,
        alignment=1,
    )
    cell_style = ParagraphStyle(
        "ExpenseCell",
        fontName=PDF_FONT_FAMILY,
        fontSize=TABLE_SIZE_PT,
        leading=TABLE_SIZE_PT * 1.1,
    )
    member_style = ParagraphStyle(
        "ExpenseMembers",
        fontName=PDF_FONT_FAMILY,
        fontSize=MEMBER_SIZE_PT,
        leading=MEMBER_SIZE_PT * 1.15,
    )

    def para(text, style=cell_style):
        # Абзацем, а не голой строкой: длинный состав обязан переноситься
        # внутри ячейки, иначе таблица уезжает за край листа и часть колонок
        # просто не печатается — молча.
        return Paragraph(
            str(text).replace("&", "&amp;").replace("<", "&lt;").replace("\n", "<br/>"),
            style,
        )

    # Шапка — ОБЩАЯ с прочими формами: свой её сбор здесь разошёлся бы с ними
    # ровно тогда, когда в справочник добавят колонку.
    table_rows = [[para(text) for text in header_row(data.columns)]]

    for number, row in enumerate(data.rows, start=1):
        record = [
            para(number),
            para(row.name),
            para(row.staff_total),
            para(row.list_total),
            para(row.vacancies),
        ]
        record.extend(
            para(
                _cell_text(row.cells[column]),
                member_style if row.cells[column].members else cell_style,
            )
            for column in data.columns
        )
        record.append(para(f"+{row.attached.count}"))
        table_rows.append(record)

    totals = data.totals
    # У итога нет номера и нет имени подразделения — как и в прочих формах:
    # лейбл встаёт в колонку «Управление», «№» остаётся пустым.
    totals_row = [
        para(""),
        para(TOTALS_LABEL),
        para(totals.staff_total),
        para(totals.list_total),
        para(totals.vacancies),
    ]
    totals_row.extend(para(totals.columns[column]) for column in data.columns)
    totals_row.append(para(f"+{totals.attached}"))
    table_rows.append(totals_row)

    buffer = io.BytesIO()
    document = SimpleDocTemplate(
        buffer,
        pagesize=landscape(A4),
        leftMargin=10 * mm,
        rightMargin=10 * mm,
        topMargin=10 * mm,
        bottomMargin=10 * mm,
        title=document_title(data),
    )
    table = Table(table_rows, repeatRows=1)
    table.setStyle(
        TableStyle(
            [
                ("GRID", (0, 0), (-1, -1), 0.5, colors.black),
                ("VALIGN", (0, 0), (-1, -1), "TOP"),
                # Шапка повторяется на каждой странице (repeatRows): таблица
                # длиннее листа иначе продолжалась бы столбцами без названий.
                ("FONTNAME", (0, 0), (-1, 0), PDF_FONT_BOLD),
                ("FONTNAME", (0, -1), (-1, -1), PDF_FONT_BOLD),
            ]
        )
    )
    document.build([para(document_title(data), title_style), Spacer(1, 4 * mm), table])
    return buffer.getvalue()
