"""Story 20.4a (FR-40): чистый рендерер списка сотрудников в `.csv`, с
маскированием чувствительных полей (ИИН) через уже существующий
`mask_employee_data()`. Единственный ORM-запрос — политики масок
(`SensitiveFieldPolicy`), ОДИН на весь вызов, не на строку (NFR-4, запрет
COUNT-в-цикле) — тот же принцип, что `expense_xlsx.py`'s «чистый рендерер
data->bytes», но с одним допустимым bulk-запросом внутри."""

import csv
import io

from apps.core.models import SensitiveFieldPolicy
from apps.core.services import mask_employee_data

EMPLOYEE_CSV_COLUMNS = (
    "iin",
    "full_name",
    "rank_code",
    "position_code",
    "division_id",
    "employment_status",
)

# Review (Blind Hunter + Edge Case Hunter, независимо совпали, CWE-1236):
# free-text поля (напр. full_name — собран из last_name/first_name/
# middle_name, апп/core/models.py, без ограничения символов) могут начинаться
# с `=`/`+`/`-`/`@` — Excel/LibreOffice трактует такую ячейку как формулу при
# открытии CSV. Ведущий апостроф — стандартная OWASP-митигация (ячейка
# читается как текст, не исполняется).
_FORMULA_TRIGGER_CHARS = ("=", "+", "-", "@")


def _sanitize_cell(value):
    if isinstance(value, str) and value.startswith(_FORMULA_TRIGGER_CHARS):
        return "'" + value
    return value


def build_employees_csv(rows, *, user_permissions) -> bytes:
    """`rows` — список УЖЕ загруженных построчных `dict` (построение
    списка сотрудников — ответственность вызывающего кода, не эта
    функция). Возвращает `.csv`-байты (UTF-8), заголовок + одна строка на
    сотрудника, чувствительные поля замаскированы по `user_permissions`.

    `policies` передаётся в `mask_employee_data()` ОДИН РАЗ, УЖЕ
    материализованным `list` (не `QuerySet`) — список поддерживает
    повторную итерацию по каждой строке без доп. запросов; сырой
    (неисполненный) `QuerySet`, переданный сюда, теряет это свойство и
    перезапрашивается на каждый вызов, сводя на нет весь смысл параметра
    (NFR-4)."""
    policies = list(SensitiveFieldPolicy.objects.filter(is_active=True))

    buffer = io.StringIO()
    writer = csv.DictWriter(buffer, fieldnames=EMPLOYEE_CSV_COLUMNS)
    writer.writeheader()
    for row in rows:
        masked = mask_employee_data(
            row, user_permissions=user_permissions, policies=policies
        )
        writer.writerow(
            {
                column: _sanitize_cell(masked.get(column))
                for column in EMPLOYEE_CSV_COLUMNS
            }
        )

    return buffer.getvalue().encode("utf-8")
