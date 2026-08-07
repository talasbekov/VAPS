---
baseline_commit: a57cca45
---

# Story 20.4d: Экспорт трёх сущностей — XLSX (билдеры)

Status: done

## Story

As a **держатель права экспорта** (руководитель/кадровик),
I want **получить `.xlsx`-версии экспорта сотрудников/истории/аудита (те же данные, что CSV, в формате Excel)**,
so that **FR-40's «...csv/xlsx...» закрыт полностью — оба формата для всех трёх сущностей, последний срез матрицы 3×2**.

## Scope Decision — ПРОЧИТАТЬ ПЕРВЫМ (последний срез матрицы, три билдера в одной узкой стори)

**Почему ОДНА стори на три сущности (в отличие от 20.4a/b/c, где каждая сущность — отдельная стори)**: XLSX-версии — МЕХАНИЧЕСКОЕ зеркалирование уже решённых CSV-билдеров (те же колонки, та же маскировка/редакция, тот же allowlist для аудита) — здесь НЕТ новых доменных решений (маскирование уже решено 20.4a, payload-редакция уже решена 20.4c), только смена формата рендера. Три почти идентичных 20-строчных функции — не три отдельных «ответственности» по духу CLAUDE.md decomposition (одна ответственность: «те же три экспорта, другой формат файла»), в отличие от 20.4a/b/c, где каждая сущность несла СВОЁ доменное решение (маскирование/редакция/allowlist).

- **`build_employees_xlsx(rows, *, user_permissions) -> bytes`**, `build_history_xlsx(rows) -> bytes`, `build_audit_xlsx(rows) -> bytes`** — три новых модуля/функции в `apps/core/exports/` (`employee_xlsx.py`, `history_xlsx.py`, `audit_xlsx.py`), СИГНАТУРЫ ЗЕРКАЛЯТ существующие CSV-билдеры буквально (те же параметры, та же маскировка/редакция/allowlist-логика — НЕ переизобретается).
- **`openpyxl`** (`Workbook()`, `sheet.cell(row, column, value=...)`, `io.BytesIO()`+`workbook.save(buffer)`+`.getvalue()`) — УЖЕ зависимость проекта (`pyproject.toml`, `openpyxl>=3,<4`, Story 1.8), прецедент использования — `apps/documents/generators/expense_xlsx.py`. Заголовок — первая строка, жирным (`Font(bold=True)`), тот же минимальный стиль, что уже устоялся.
- **КРИТИЧНО (research-агент нашёл реальный пробел в СУЩЕСТВУЮЩЕМ коде, не вносим его сюда)**: `expense_xlsx.py`/`personal_export.py` (существующие xlsx-генераторы) НЕ применяют CWE-1236-защиту (`sanitize_cell`) — сходят с рук, т.к. пишут только структурные/предварительно очищенные данные. **Эта стори ОБЯЗАНА применить `sanitize_cell()`/`normalize_value()` из `csv_safety.py` к каждой ячейке** (те же хелперы, что CSV-билдеры, formula-injection одинаково актуальна для `.xlsx`, открытого в Excel/LibreOffice — тот же риск, не переизобретаем защиту, переиспользуем существующую). Пробел в `expense_xlsx.py`/`personal_export.py` — НЕ трогается этой стори (другие модули, другой контекст, вне скоупа — задокументировать в deferred-work.md, не чинить втихую).
- **Маскирование (сотрудники)**: `build_employees_xlsx` вызывает `mask_employee_data(row, user_permissions=..., policies=...)` — БУКВАЛЬНО та же логика, что `build_employees_csv` (20.4a), ОДИН запрос `SensitiveFieldPolicy` снаружи цикла (NFR-4).
- **Redaction (аудит)**: `build_audit_xlsx` использует ТОТ ЖЕ `AUDIT_CSV_COLUMNS`-подобный allowlist (свой `AUDIT_XLSX_COLUMNS`, идентичный набор — 8 полей, БЕЗ `old_value`/`new_value`/`reason`) — та же дисциплина, тот же тросик-тест (`old_value`/`new_value` никогда не в наборе колонок).
- **Out of scope**: API/эндпоинт HTTP-слоя (все 6 срезов матрицы — только билдеры, HTTP-слой целиком — будущая стори при явном запросе); стилизация сверх минимума (жирный заголовок — не цветные ячейки/условное форматирование/графики); правка существующих `expense_xlsx.py`/`personal_export.py` (их собственный CWE-1236-пробел — задокументирован в deferred-work.md, не эта стори); построение `rows` (селекторы — вне скоупа, тот же принцип, что все три CSV-стори).

## Acceptance Criteria

1. **AC-1.** `build_employees_xlsx`/`build_history_xlsx`/`build_audit_xlsx` возвращают валидные `.xlsx`-байты, открываемые `openpyxl.load_workbook(io.BytesIO(...))` без исключения.
2. **AC-2.** Каждый workbook содержит заголовочную строку с ИМЕНАМИ колонок, идентичными соответствующему CSV-билдеру (`EMPLOYEE_CSV_COLUMNS`/`HISTORY_CSV_COLUMNS`/`AUDIT_CSV_COLUMNS`), заголовок — жирным шрифтом.
3. **AC-3 (сотрудники).** ИИН маскируется/показывается по `user_permissions` — идентично AC-1/AC-2 20.4a (те же два теста, портированные на xlsx-чтение).
4. **AC-4 (аудит).** `old_value`/`new_value`, даже намеренно подложенные в `row`-dict, НЕ появляются НИ В ОДНОЙ ячейке workbook (тот же allowlist-тест, что 20.4c, портированный на xlsx-чтение).
5. **AC-5.** Формула-инъекция (`=`/`+`/`-`/`@`-префикс) в любой строковой ячейке любого из трёх билдеров → защищена ведущим апострофом (переиспользован `sanitize_cell()`).
6. **AC-6.** Пустой список `rows=[]` → workbook только с заголовком, без строк данных, без исключения (для всех трёх билдеров).
7. **AC-7.** `datetime`-поля (`starts_at`/`ends_at`/`created_at`) нормализуются тем же `normalize_value()`, что CSV-версии.
8. **AC-8.** Регрессия: ВСЕ существующие тесты CSV-билдеров (20.4a/b/c) проходят БЕЗ ПРАВОК.
9. **AC-9.** `make gate` (Backend/VAPS) зелёный.

## Out of Scope

- API/эндпоинт HTTP-слоя (все 6 срезов).
- Продвинутая стилизация (условное форматирование, графики, цвета — жирный заголовок, не более).
- Правка `expense_xlsx.py`/`personal_export.py`'s собственного CWE-1236-пробела (задокументировано, не эта стори).
- Построение `rows` (селекторы, вне скоупа, тот же принцип, что 20.4a/b/c).

## Tasks / Subtasks

- [x] Task 1 — `apps/core/exports/employee_xlsx.py` (новый): `build_employees_xlsx(rows, *, user_permissions) -> bytes` — зеркалит `employee_csv.py`, `openpyxl`+`sanitize_cell`.
- [x] Task 2 — `apps/core/exports/history_xlsx.py` (новый): `build_history_xlsx(rows) -> bytes` — зеркалит `history_csv.py`.
- [x] Task 3 — `apps/core/exports/audit_xlsx.py` (новый): `build_audit_xlsx(rows) -> bytes` — зеркалит `audit_csv.py`, allowlist + тросик-тест.
- [x] Task 4 — Тесты (AC 1-9): `apps/core/tests/test_employee_xlsx_export.py`/`test_history_xlsx_export.py`/`test_audit_xlsx_export.py` (новые, портированные с CSV-эквивалентов на `openpyxl.load_workbook`-чтение) + прогон ВСЕХ существующих CSV-тестов без правок (регрессия AC-8).
- [x] Task 5 — `make gate` (Backend/VAPS).

## Dev Notes

- `apps/documents/generators/expense_xlsx.py:63-125` — СТРУКТУРНЫЙ ОБРАЗЕЦ openpyxl-паттерна: `from openpyxl import Workbook`+`from openpyxl.styles import Font` (ленивый импорт внутри функции), `workbook.active`, `sheet.cell(row, column, value=...)`, `io.BytesIO()`+`workbook.save(buffer)`+`buffer.getvalue()` (буфер УЖЕ бинарный, `.encode()` не нужен, в отличие от CSV).
- `pyproject.toml:12` — `openpyxl>=3,<4` УЖЕ зависимость (Story 1.8, «pure-Python, без C-расширений, air-gap friendly»), новую зависимость НЕ добавляем.
- `apps/core/exports/csv_safety.py` (`sanitize_cell`/`normalize_value`) — ПЕРЕИСПОЛЬЗУЕТСЯ буквально, те же хелперы для xlsx-ячеек (research-агент подтвердил: openpyxl НЕ авто-экранирует formula-trigger символы, `sanitize_cell` обязателен).
- `apps/documents/tests/test_expense_xlsx_generator.py:102-105` — СТРУКТУРНЫЙ ОБРАЗЕЦ теста: `load_workbook(BytesIO(result))` → `workbook.active` → `sheet.cell(row=r, column=c).value` для чтения обратно.
- `apps/core/exports/employee_csv.py`/`history_csv.py`/`audit_csv.py` — существующие CSV-билдеры, ЗЕРКАЛИТЬ буквально (та же маскировка/редакция/allowlist, только рендер в xlsx вместо csv).
- **Важно**: `expense_xlsx.py`/`personal_export.py` НЕ применяют `sanitize_cell()` — это ИХ пробел (established, не вносится этой стори, задокументировать в deferred-work.md, не чинить их код без запроса).

### References

- [Source: _bmad-output/implementation-artifacts/20-4a-экспорт-сотрудников-csv.md] — маскирование, зеркалить логику.
- [Source: _bmad-output/implementation-artifacts/20-4c-экспорт-аудита-csv.md] — allowlist/redaction, зеркалить логику.
- [Source: Backend/VAPS/apps/documents/generators/expense_xlsx.py] — openpyxl структурный образец.
- [Source: Backend/VAPS/apps/core/exports/csv_safety.py] — переиспользуемые хелперы.

## Dev Agent Record

### Agent Model Used

claude-sonnet-5

### Debug Log References

- `make gate` (Backend/VAPS) — зелёный на первом прогоне: 4479 passed, 0 regressions, `makemigrations --check` чист (три новых Python-модуля, не модели).
- Три xlsx-билдера буквально зеркалят соответствующие CSV-билдеры (маскировка/redaction/allowlist без изменений), рендер — `openpyxl.Workbook()` вместо `csv.DictWriter`. `sanitize_cell()`/`normalize_value()` из `csv_safety.py` применены ко всем ячейкам явно (существующие `expense_xlsx.py`/`personal_export.py` этого не делают — их отдельный, не патченный этой стори, пробел).
- Ревью (3 слоя, Blind Hunter + Edge Case Hunter + Acceptance Auditor — последняя стори FR-40's полной матрицы): Acceptance Auditor подтвердил все 9 AC SATISFIED (импорт колонок из CSV-констант, не перетипизация — дрейф невозможен по конструкции) + нашёл реальный DoD-пробел — Dev Notes ОБЕЩАЛИ задокументировать чужой CWE-1236-пробел в deferred-work.md, но фактически это не было сделано (только в story-файле). Edge Case Hunter независимо подтвердил: NFR-4 N+1-дисциплина сохранена, allowlist-импорт без дрейфа, но нашёл реальный пробел покрытия — единственный слайс (сотрудники) потерял `test_special_characters_round_trip` при переносе с CSV. 4 patch применены: (1) добавлен пропущенный round-trip тест; (2) Blind Hunter нашёл методологически вакуумный тест (`test_single_query_regardless_of_row_count` доказывал только N=10) — параметризован по 0/1/10; (3) все три workbook получили осмысленный `sheet.title` (были дефолтным «Sheet») + тесты; (4) запись в deferred-work.md добавлена, закрывая обещание Dev Notes. `make gate` после патчей — 4485 passed (+6). Остальное dismiss (openpyxl formula-injection защита работает корректно тем же механизмом ведущего апострофа, что CSV — не «повезло»; отсутствие `workbook.close()`/column-width/freeze-pane — cosmetic, established convention; повторный локальный импорт `openpyxl` в каждом файле — established convention, зеркалит `expense_xlsx.py`'s собственный паттерн).

### Completion Notes List

- AC-1..AC-9 реализованы. `build_employees_xlsx`/`build_history_xlsx`/`build_audit_xlsx` — три модуля, механическое зеркалирование существующих CSV-билдеров (та же маскировка/redaction/allowlist, только формат вывода).
- Заголовок — жирным шрифтом (`openpyxl.styles.Font(bold=True)`), тот же минимальный стиль, что `expense_xlsx.py`.
- Formula-injection защита (`sanitize_cell`) применена явно ко всем ячейкам всех трёх билдеров — CWE-1236 одинаково актуальна для `.xlsx`.
- Регрессия: ВСЕ существующие CSV-тесты (20.4a/b/c) прошли без правок.
- Ревью-патчи: пропущенный round-trip тест (сотрудники), параметризован query-count тест (0/1/10), осмысленные `sheet.title` для всех трёх workbook, запись в deferred-work.md.

### File List

- `Backend/VAPS/apps/core/exports/employee_xlsx.py` (new, изменён ревью — `sheet.title`)
- `Backend/VAPS/apps/core/exports/history_xlsx.py` (new, изменён ревью — `sheet.title`)
- `Backend/VAPS/apps/core/exports/audit_xlsx.py` (new, изменён ревью — `sheet.title`)
- `Backend/VAPS/apps/core/tests/test_employee_xlsx_export.py` (new, изменён ревью — round-trip тест, параметризация, title-тест)
- `Backend/VAPS/apps/core/tests/test_history_xlsx_export.py` (new, изменён ревью — title-тест)
- `Backend/VAPS/apps/core/tests/test_audit_xlsx_export.py` (new, изменён ревью — title-тест)

## Change Log

| Дата | Изменение |
|---|---|
| 2026-08-07 | Story создана (create-story). Последний срез FR-40's матрицы 3×2 — три XLSX-билдера в одной стори (механическое зеркалирование уже решённых CSV-билдеров, не новые доменные решения). Research-агент нашёл реальный пробел в СУЩЕСТВУЮЩИХ xlsx-генераторах (`expense_xlsx.py`/`personal_export.py` не применяют CWE-1236-защиту) — эта стори применяет защиту к СВОИМ трём билдерам, чужой пробел документируется отдельно, не чинится втихую. |
| 2026-08-07 | Dev-story: три xlsx-билдера (`employee_xlsx.py`/`history_xlsx.py`/`audit_xlsx.py`) + 26 тестов, портированных с CSV-эквивалентов. `make gate` (Backend/VAPS) — 4479 passed, 0 regressions, зелёный с первого прогона. Status → review. |
| 2026-08-07 | Ревью-патчи: пропущенный round-trip тест, параметризация query-count теста, осмысленные `sheet.title`, deferred-work.md запись. `make gate` — 4485 passed, 0 regressions. Status → done. Закрывает FR-40's полную матрицу экспорта 3×2 — Epic 20's 20.4-серия завершена. |
