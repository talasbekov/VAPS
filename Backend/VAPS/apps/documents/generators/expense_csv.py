"""Story 6.4 — чистый рендерер .csv расхода (числовая форма, Д4).

CSV — машиночитаемая таблица: титул (одно поле), та же 17-колоночная шапка,
строки данных, последняя строка — ИТОГО. Раскладка data-строки зеркалит docx:
«№» — int с 1, «Управление» — имя строки (ЕДИНСТВЕННАЯ текстовая ячейка
данных), далее Штат/Список/Вакансии и 12 статусных колонок — ТОЛЬКО
count-числа. Списки членов НЕ выгружаются, ATTACHED — целое N БЕЗ «+»
(члены и «+N» — прерогатива документных форм .docx/.xlsx/.pdf). Строка
ИТОГО: «№» — пустое поле, лейбл «ИТОГО» — в колонке «Управление», далее
числа (зеркало ``generate_expense_docx``).

Диалект (Д4, Q4/Q6): разделитель ``;``, кодировка **utf-8-sig** (BOM —
Excel ru-локали открывает двойным кликом), терминатор строк CRLF (дефолт
``csv.writer``). Чистая функция ``ExpenseDocumentData -> bytes``: stdlib
``csv`` поверх ``io.StringIO`` — без ORM, wall-clock, сети и диска; рендерер
НЕ считает и НЕ пересортировывает (числа приходят готовыми от билдера).
"""

import csv
import io

from apps.documents.generators.expense_docx import (
    _DATE_FORMAT,
    _FIXED_HEAD,
    _TOTALS_LABEL,
    DOCX_COLUMN_LABELS,
    DOCX_COLUMNS,
)


def generate_expense_csv(data):
    """``ExpenseDocumentData`` → байты .csv (utf-8-sig, ``;``, CRLF)."""
    buffer = io.StringIO()
    writer = csv.writer(buffer, delimiter=";")

    writer.writerow(
        [
            f"{data.division_title} ЖЕКЕ ҚҰРАМЫНЫҢ САПТЫҚ ТІЗІМІ "
            f"{data.business_date.strftime(_DATE_FORMAT)} ЖЫЛҒЫ"
        ]
    )
    writer.writerow(
        list(_FIXED_HEAD) + [DOCX_COLUMN_LABELS[key] for key in DOCX_COLUMNS]
    )

    for number, row in enumerate(data.rows, start=1):
        record = [number, row.name, row.staff_total, row.list_total, row.vacancies]
        for key in DOCX_COLUMNS:
            cell_data = row.attached if key == "ATTACHED" else row.cells[key]
            record.append(cell_data.count)
        writer.writerow(record)

    totals = data.totals
    totals_record = [
        "",
        _TOTALS_LABEL,
        totals.staff_total,
        totals.list_total,
        totals.vacancies,
    ]
    for key in DOCX_COLUMNS:
        if key == "ATTACHED":
            totals_record.append(totals.attached)
        else:
            totals_record.append(totals.columns[key])
    writer.writerow(totals_record)

    return buffer.getvalue().encode("utf-8-sig")
