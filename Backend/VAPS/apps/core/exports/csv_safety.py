"""Story 20.4b: CWE-1236 (CSV formula injection) хелпер, извлечённый ИЗ
`employee_csv.py` (20.4a's ревью-патч, инлайнен только там) в общий модуль
`apps.core.exports` — переиспользуется каждым CSV-билдером этого package
(история, аудит...) без дублирования логики.

Ревью 20.4b: БЕЗ ведущего `_` в имени файла (было `_csv_safety.py`) —
модуль ЯВНО предназначен для межмодульного импорта внутри package, ведущее
подчёркивание сигнализировало бы обратное ("не импортируй меня извне")."""

# Free-text поля (напр. `full_name`) могут начинаться с `=`/`+`/`-`/`@` —
# Excel/LibreOffice трактует такую ячейку как формулу при открытии CSV.
# Ведущий апостроф — стандартная OWASP-митигация (ячейка читается как
# текст, не исполняется).
FORMULA_TRIGGER_CHARS = ("=", "+", "-", "@")


def sanitize_cell(value):
    if isinstance(value, str) and value.startswith(FORMULA_TRIGGER_CHARS):
        return "'" + value
    return value
