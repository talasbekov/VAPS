"""Story 20.4b (FR-40): чистый рендерер истории переводов сотрудников
между подразделениями в `.csv`. БЕЗ маскирования — `EmployeeDivisionHistory`
несёт только FK (`employee`/`division`) и даты, ни одно поле не известно
`SensitiveFieldPolicy` (нет ИИН/чувствительных полей на строке истории).
Тот же принцип «чистого рендерера data->bytes», что `employee_csv.py`
(20.4a) — здесь БЕЗ единственного допустимого запроса той стори (нет
политик масок, значит нет и запроса)."""

import csv
import io

from apps.core.exports.csv_safety import normalize_value, sanitize_cell

HISTORY_CSV_COLUMNS = (
    "employee_id",
    "employee_full_name",
    "division_id",
    "division_name",
    "starts_at",
    "ends_at",
    "source",
)


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
                column: sanitize_cell(normalize_value(row.get(column)))
                for column in HISTORY_CSV_COLUMNS
            }
        )

    return buffer.getvalue().encode("utf-8")
