"""Story 20.4b (FR-40): чистый рендерер истории переводов сотрудников
между подразделениями в `.csv`. БЕЗ маскирования — `EmployeeDivisionHistory`
несёт только FK (`employee`/`division`) и даты, ни одно поле не известно
`SensitiveFieldPolicy` (нет ИИН/чувствительных полей на строке истории).
Тот же принцип «чистого рендерера data->bytes», что `employee_csv.py`
(20.4a) — здесь БЕЗ единственного допустимого запроса той стори (нет
политик масок, значит нет и запроса)."""

import csv
import datetime
import io

from apps.core.exports.csv_safety import sanitize_cell

HISTORY_CSV_COLUMNS = (
    "employee_id",
    "employee_full_name",
    "division_id",
    "division_name",
    "starts_at",
    "ends_at",
    "source",
)


def _cell(value):
    """Ревью 20.4b (Edge Case Hunter): `starts_at`/`ends_at` могут прийти
    как сырой `datetime` (будущий вызывающий код может забыть
    `.isoformat()`) — `str(datetime)` даёт пробел вместо `T` и
    непостоянную ширину микросекунд. Явная ISO-нормализация здесь —
    защита от этого класса дрейфа формата, не полагаемся на то, что
    вызывающий код всегда предварительно строкует."""
    if isinstance(value, datetime.date):  # datetime.datetime is a subclass
        return value.isoformat()
    if value is None:
        return ""
    return value


def build_history_csv(rows) -> bytes:
    """`rows` — список УЖЕ загруженных построчных `dict` (JOIN
    `EmployeeDivisionHistory`+`Employee`+`Division` — ответственность
    вызывающего кода, не эта функция). `ends_at=None` (текущий,
    незакрытый перевод) рендерится как ПУСТАЯ ячейка, не строка
    `"None"`."""
    buffer = io.StringIO()
    writer = csv.DictWriter(buffer, fieldnames=HISTORY_CSV_COLUMNS)
    writer.writeheader()
    for row in rows:
        writer.writerow(
            {
                column: sanitize_cell(_cell(row.get(column)))
                for column in HISTORY_CSV_COLUMNS
            }
        )

    return buffer.getvalue().encode("utf-8")
