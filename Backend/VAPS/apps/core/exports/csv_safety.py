"""Story 20.4b: CWE-1236 (CSV formula injection) хелпер, извлечённый ИЗ
`employee_csv.py` (20.4a's ревью-патч, инлайнен только там) в общий модуль
`apps.core.exports` — переиспользуется каждым CSV-билдером этого package
(история, аудит...) без дублирования логики.

Ревью 20.4b: БЕЗ ведущего `_` в имени файла (было `_csv_safety.py`) —
модуль ЯВНО предназначен для межмодульного импорта внутри package, ведущее
подчёркивание сигнализировало бы обратное ("не импортируй меня извне").

Story 20.4c: `normalize_value()` — извлечён из `history_csv.py`'s `_cell()`
(ревью 20.4b) сюда же, третий CSV-билдер (`audit_csv.py`) тоже пишет
`datetime`-поле (`created_at`) — та же нормализация нужна там."""

import datetime

# Free-text поля (напр. `full_name`) могут начинаться с `=`/`+`/`-`/`@` —
# Excel/LibreOffice трактует такую ячейку как формулу при открытии CSV.
# Ведущий апостроф — стандартная OWASP-митигация (ячейка читается как
# текст, не исполняется).
FORMULA_TRIGGER_CHARS = ("=", "+", "-", "@")


def sanitize_cell(value):
    if isinstance(value, str) and value.startswith(FORMULA_TRIGGER_CHARS):
        return "'" + value
    return value


def normalize_value(value):
    """`None` → пустая ячейка (не строка `"None"`); `datetime`/`date` →
    ISO-8601 (не `str(datetime)`'s пробел-разделитель/непостоянная ширина
    микросекунд, ревью 20.4b). Остальные значения — как есть."""
    if isinstance(value, datetime.date):  # datetime.datetime is a subclass
        return value.isoformat()
    if value is None:
        return ""
    return value
