"""Рендерер .csv расхода (порт apps/documents/generators/expense_csv.py из
Backend/VAPS).

CSV — МАШИНОЧИТАЕМАЯ форма: только числа, без поимённого состава. Состав —
прерогатива документных форм (.xlsx/.docx), а таблица, в ячейке которой лежит
двадцать строк с фамилиями, не открывается ни одним потребителем CSV так, как
он ожидает.

Диалект донора сохранён дословно: разделитель `;`, кодировка utf-8-sig (BOM —
иначе Excel в ru-локали открывает кириллицу мусором по двойному клику),
терминатор CRLF (умолчание csv). Каждый из трёх — не украшение: без любого
файл открывается неверно у того самого пользователя, ради которого выгрузка и
делается.

Рендерер НИЧЕГО не считает и не пересортировывает: числа приходят готовыми от
билдера. Чистая функция ExpenseDocumentData → bytes.
"""
import csv
import io

from organization_management.apps.operations.expense_layout import (
    TOTALS_LABEL,
    document_title,
    header_row,
)


def generate_expense_csv(data):
    """Данные документа → байты .csv."""
    buffer = io.StringIO()
    writer = csv.writer(buffer, delimiter=";")

    writer.writerow([document_title(data)])
    writer.writerow(header_row(data.columns))

    for number, row in enumerate(data.rows, start=1):
        record = [number, row.name, row.staff_total, row.list_total, row.vacancies]
        record.extend(row.cells[column].count for column in data.columns)
        record.append(row.attached.count)
        writer.writerow(record)

    totals = data.totals
    # У итога нет номера и нет имени подразделения: лейбл встаёт в колонку
    # «Управление», а «№» остаётся пустым — так строку итога не спутать с
    # данными ни глазом, ни разбором.
    record = [
        "",
        TOTALS_LABEL,
        totals.staff_total,
        totals.list_total,
        totals.vacancies,
    ]
    record.extend(totals.columns[column] for column in data.columns)
    record.append(totals.attached)
    writer.writerow(record)

    return buffer.getvalue().encode("utf-8-sig")
