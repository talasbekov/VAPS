"""Story 10.8 — чистый рендерер личного экспорта сдачи («щит») в .xlsx.

Вход — объект ``DailySubmission`` DUCK-TYPED: изоляция documents
(test_isolation: ``apps.operations.*`` запрещён везде) не позволяет
импортировать модель, поэтому контракт держится на атрибутах —
``division_id``, ``business_date``, ``submitted_by``, ``submitted_at``,
``version``, ``event``, ``snapshot`` (форма 5.2: ``{schema_version, roster,
rows}``). Стрелка зависимости остаётся «documents ← operations»: view 10.8
передаёт сюда уже загруженную сдачу.

Рендерер — ЧИСТАЯ функция «объект → bytes»: без ORM, без wall-clock, без
сети и записи на диск; ``openpyxl`` импортируется ЛЕНИВО внутри функции
(зеркало ``generate_expense_xlsx`` 6.4). JOIN roster×rows — по словарю
снапшота (``employee_id``), НЕ по live-данным: экспорт воспроизводит
заявление-на-момент-T (иммутабельность 5.10).

Раскладка листа (лист = ISO-дата бизнес-дня, зеркало 6.4):

* строки 1..6 — заголовочный блок «метка | значение»: подразделение, дата,
  кто сдал, время сдачи (isoformat), версия (числом), событие;
* строка 8 — шапка таблицы (6 колонок);
* строки 9.. — по строке на (сотрудник × действующий статус); сотрудник без
  статусов остаётся одной строкой с пустыми статусными ячейками
  (denominator «В строю» — семантика снапшота 5.2); rows-запись без
  roster-пары игнорируется (снапшот 5.3a такого не строит — backstop).
"""

import io

from apps.documents.generators.expense_docx import FONT_NAME, TABLE_SIZE_PT

_HEADER_LABELS = (
    "Подразделение",
    "Дата",
    "Сдал",
    "Время сдачи",
    "Версия",
    "Событие",
)
_TABLE_HEAD = ("Сотрудник", "ФИО", "Звание", "Статус", "С", "По")
_TABLE_HEADER_ROW = len(_HEADER_LABELS) + 2  # пустая строка-разделитель
_SUPPORTED_SCHEMA_VERSION = 1


def _write_cell(sheet, row, column, value, font):
    """Записать ячейку, принудив строки-«формулы» к текстовому типу.

    openpyxl инферит ``data_type='f'`` для любой строки, начинающейся с
    ``=``, и ``'e'`` для Excel error-кодов («#REF!» и т.п.). ФИО/звание/
    submitted_by — пользовательский ввод (кадровые данные, identity-заголовок):
    сотрудник с именем ``=HYPERLINK(...)`` превратил бы «личный щит» в файл
    с живой формулой (CWE-1236). Коэрсия к ``'s'`` сохраняет значение
    байт-в-байт, но пишет его строкой — формула не исполняется.
    """
    cell = sheet.cell(row=row, column=column, value=value)
    if cell.data_type in ("f", "e"):
        cell.data_type = "s"
    cell.font = font
    return cell


def generate_submission_export_xlsx(submission) -> bytes:
    """Duck-typed ``DailySubmission`` → байты личного .xlsx-экспорта.

    Ленивая загрузка openpyxl — зеркало ``generate_expense_xlsx``.
    """
    from openpyxl import Workbook
    from openpyxl.styles import Font

    plain = Font(name=FONT_NAME, size=TABLE_SIZE_PT)
    bold = Font(name=FONT_NAME, size=TABLE_SIZE_PT, bold=True)

    snapshot = submission.snapshot or {}
    # Пин контракта v1 (форма 5.2): экспорт читает ИСТОРИЧЕСКИЕ иммутабельные
    # снапшоты — будущая v2 с переименованными ключами обязана падать громко
    # (ValueError), а не рендерить «щит» молча криво или KeyError'ом.
    schema_version = snapshot.get("schema_version", _SUPPORTED_SCHEMA_VERSION)
    if schema_version != _SUPPORTED_SCHEMA_VERSION:
        raise ValueError(
            f"unsupported snapshot schema_version {schema_version!r}; "
            f"renderer pins v{_SUPPORTED_SCHEMA_VERSION}"
        )

    workbook = Workbook()
    sheet = workbook.active
    sheet.title = submission.business_date.isoformat()

    header_values = (
        str(submission.division_id),
        submission.business_date.isoformat(),
        submission.submitted_by,
        submission.submitted_at.isoformat(),
        submission.version,
        submission.event,
    )
    for row, (label, value) in enumerate(zip(_HEADER_LABELS, header_values), start=1):
        _write_cell(sheet, row, 1, label, bold)
        _write_cell(sheet, row, 2, value, plain)

    for column, label in enumerate(_TABLE_HEAD, start=1):
        _write_cell(sheet, _TABLE_HEADER_ROW, column, label, bold)

    statuses_by_employee = {}
    for status_row in snapshot.get("rows", []):
        statuses_by_employee.setdefault(status_row["employee_id"], []).append(
            status_row
        )

    sheet_row = _TABLE_HEADER_ROW + 1
    for entry in snapshot.get("roster", []):
        employee_id = entry["employee_id"]
        # Сотрудник без статусов — одна denominator-строка с пустым статусом.
        for status_row in statuses_by_employee.get(employee_id, [None]):
            values = [
                employee_id,
                entry.get("full_name", ""),
                entry.get("rank", ""),
            ]
            if status_row is None:
                values += [None, None, None]
            else:
                values += [
                    status_row["status_type_code"],
                    status_row["date_start"],
                    status_row["date_end"],
                ]
            for column, value in enumerate(values, start=1):
                _write_cell(sheet, sheet_row, column, value, plain)
            sheet_row += 1

    buffer = io.BytesIO()
    workbook.save(buffer)
    return buffer.getvalue()
