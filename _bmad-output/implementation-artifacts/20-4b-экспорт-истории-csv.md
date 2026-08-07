---
baseline_commit: b25df8c6
---

# Story 20.4b: Экспорт истории переводов — CSV (билдер)

Status: done

## Story

As a **держатель права экспорта** (руководитель/кадровик),
I want **получить `.csv` со списком переводов сотрудников между подразделениями (кто/откуда/куда/когда)**,
so that **FR-40's «экспорт... историй...» закрыт для второй из трёх сущностей, тем же узким вертикальным срезом, что 20.4a закрыла для сотрудников**.

## Scope Decision — ПРОЧИТАТЬ ПЕРВЫМ (второй срез матрицы 3×2, узкий и УЖЕ БЕЗ маскирования)

**Ключевая находка (research-агент)**: `EmployeeDivisionHistory` (`apps/core/models.py:254-279`) несёт ТОЛЬКО `employee` (FK), `division` (FK), `starts_at`/`ends_at` (datetime), `source` (str) — НИ ОДНОГО поля, которое `mask_employee_data()`/`SensitiveFieldPolicy` вообще знает (ИИН и прочие чувствительные поля живут на `Employee`, не на строке истории). **Эта стори НЕ маскирует ничего** — билдер принимает уже собранные строки, каждая содержит `employee_id`, `employee_full_name` (человекочитаемо, не голый UUID — тот же принцип, что 20.2c/20.3c's UUID→имя резолюция на фронте, но здесь на бэке при построении строки), `division_id`, `division_name`, `starts_at`, `ends_at` (может быть `None` — текущий, незакрытый перевод), `source`.

- **`build_history_csv(rows, *) -> bytes`** — в `apps/core/exports/history_csv.py` (новый модуль, тот же package `apps.core.exports`, структурный образец `employee_csv.py`). **БЕЗ `user_permissions`-параметра** (в отличие от 20.4a) — нет чувствительных полей, гейтинг «кто может экспортировать» — API-слой (не эта стори, тот же принцип, что 20.4a).
- **Formula-injection защита (CWE-1236) — ПЕРЕИСПОЛЬЗУЕТСЯ, не изобретается заново**: 20.4a's `_sanitize_cell()`/`_FORMULA_TRIGGER_CHARS` (`apps/core/exports/employee_csv.py:29-35`) СЕЙЧАС инлайнены только в этом модуле (research-агент подтвердил — не извлечены в переиспользуемый хелпер). Эта стори ИЗВЛЕКАЕТ их в `apps/core/exports/_csv_safety.py` (новый общий модуль package `apps.core.exports`) и переключает И `employee_csv.py`, И новый `history_csv.py` на него — тот же принцип, что «дублирование мелких хелперов через копию» ЗАПРЕЩЕНО, когда переиспользование в ОДНОМ package дёшево и безопасно (не межфичевой/межсубдоменный импорт, всё внутри `apps.core.exports`). `full_name` в истории (через `employee_full_name`) — тот же риск инъекции, что в 20.4a, обязательно применить защиту.
- **Пустой `ends_at` (текущий перевод, ещё не закрыт)** — CSV-ячейка пустая строка, НЕ `None`/`"None"` (честная пустота, не строковый артефакт Python).
- **Построение `rows` (селектор/JOIN employee+division) — ВНЕ СКОУПА этой стори** (тот же принцип, что 20.4a: «построение списка сотрудников — ответственность вызывающего кода», здесь симметрично — будущий 20.4-API-слой строит `rows` через `select_related`/`values()`, эта стори принимает УЖЕ ГОТОВЫЕ построчные `dict`).
- **Out of scope**: API/эндпоинт HTTP-слоя; маскирование (нет чувствительных полей); экспорт аудита (20.4c); XLSX-версии (20.4d/e/f); построение `rows` (селектор с JOIN — будущая стори при явном запросе).

## Acceptance Criteria

1. **AC-1.** CSV содержит строку-заголовок с именами колонок (`employee_id`, `employee_full_name`, `division_id`, `division_name`, `starts_at`, `ends_at`, `source`).
2. **AC-2.** Строка с непустым `ends_at` → CSV содержит ISO-подобное представление даты/времени в обеих колонках `starts_at`/`ends_at`.
3. **AC-3.** Строка с `ends_at=None` (текущий, незакрытый перевод) → CSV содержит ПУСТУЮ ячейку в колонке `ends_at`, не `"None"`/`"none"`.
4. **AC-4.** Пустой список `rows=[]` → CSV только с заголовком, без строк данных, без исключения.
5. **AC-5.** `employee_full_name`, начинающееся с `=`/`+`/`-`/`@` (formula-injection паттерн) → защищено ведущим апострофом (тот же CWE-1236-хелпер, что 20.4a, теперь общий).
6. **AC-6.** `employee_full_name`, содержащее запятую/кавычку → корректно CSV-экранировано (round-trip через `csv.reader` восстанавливает исходное значение).
7. **AC-7.** Регрессия: `employee_csv.py`'s существующие тесты (20.4a, включая formula-injection-тесты) проходят БЕЗ ПРАВОК после извлечения общего хелпера в `_csv_safety.py`.
8. **AC-8.** `make gate` (Backend/VAPS) зелёный.

## Out of Scope

- API/эндпоинт HTTP-слоя.
- Маскирование (в строках истории нет чувствительных полей).
- Экспорт «аудита» (`AuditLog`, 20.4c — payload-редакция не решена этой стори).
- XLSX-версии (20.4d/e/f).
- Построение `rows` (JOIN `EmployeeDivisionHistory`+`Employee`+`Division`, будущая стори при явном запросе).

## Tasks / Subtasks

- [x] Task 1 — `apps/core/exports/_csv_safety.py` (новый файл): извлечь `_sanitize_cell()`/`_FORMULA_TRIGGER_CHARS` из `employee_csv.py` без изменения поведения.
- [x] Task 2 — `apps/core/exports/employee_csv.py`: переключить на импорт из `_csv_safety.py`, удалить дублирующий инлайн (регрессия: существующие тесты не трогать, они обязаны пройти как есть).
- [x] Task 3 — `apps/core/exports/history_csv.py` (новый файл): `build_history_csv(rows) -> bytes`, использует общий `_csv_safety.py`.
- [x] Task 4 — Тесты (AC 1-7): `apps/core/tests/test_history_csv_export.py` (новый) + прогон `apps/core/tests/test_employee_csv_export.py` без правок (регрессия AC-7).
- [x] Task 5 — `make gate` (Backend/VAPS).

## Dev Notes

- `apps/core/models.py:254-279` (`EmployeeDivisionHistory`) — `employee` (FK CASCADE), `division` (FK PROTECT), `starts_at` (обязателен), `ends_at` (nullable), `source` (str, default `"MANUAL"`). НЕТ полей, которые знает `SensitiveFieldPolicy`.
- `apps/core/exports/employee_csv.py:1-67` (Story 20.4a, ПОСЛЕ ревью-патча CWE-1236) — СТРУКТУРНЫЙ ОБРАЗЕЦ ЦЕЛОГО МОДУЛЯ: `io.StringIO()`+`csv.DictWriter`, `.getvalue().encode("utf-8")` → `bytes`. `_sanitize_cell()`/`_FORMULA_TRIGGER_CHARS` (строки 29-35) — извлечь БУКВАЛЬНО, без изменения логики, в `_csv_safety.py`.
- `apps/core/selectors.py:453-568` (`HistoricalEmployeeSelector`) — существующие методы (`division_at`, `earliest_history_start`, `roster_on`, `roster_reconciliation`) НЕ дают построчных dict для экспорта (single-lookup/aggregate/группировка, не построчный список) — эта стори НЕ добавляет новый метод сюда (селектор — вне скоупа, будущая стори).
- `apps/migration_legacy/management/commands/seed_e2e_expense_chain.py` — СТРУКТУРНЫЙ ОБРАЗЕЦ посева `EmployeeDivisionHistory` через `bulk_create` (без factory_boy, established convention проекта).
- Кодировка: `.encode("utf-8")` (тот же выбор, что 20.4a — BOM/Excel-совместимость кириллицы осознанно НЕ добавляется превентивно).

### References

- [Source: _bmad-output/implementation-artifacts/20-4a-экспорт-сотрудников-csv.md] — прецедент «чистого рендерера» data→bytes, CWE-1236-хелпер (ДО извлечения в общий модуль).
- [Source: Backend/VAPS/apps/core/models.py#L254-279] — `EmployeeDivisionHistory`, поля.
- [Source: Backend/VAPS/apps/core/selectors.py#L453-568] — `HistoricalEmployeeSelector`, существующие методы (ни один не подходит построчно).
- [Source: Backend/VAPS/apps/core/exports/employee_csv.py] — структурный образец модуля, formula-injection хелпер для извлечения.

## Dev Agent Record

### Agent Model Used

claude-sonnet-5

### Debug Log References

- CWE-1236-хелпер извлечён в `_csv_safety.py` буквально (переименован `_sanitize_cell`/`_FORMULA_TRIGGER_CHARS` → публичные `sanitize_cell`/`FORMULA_TRIGGER_CHARS`, т.к. используется из другого модуля package — приватные с ведущим `_` не предназначены для межмодульного импорта внутри одного package). `employee_csv.py`'s существующие тесты не тронуты и прошли без правок.
- `make gate` (Backend/VAPS) — зелёный: 4445 passed, 0 regressions, `makemigrations --check` чист (новый Python-модуль, не модель).
- Ревью (3 слоя, Blind Hunter + Edge Case Hunter + Acceptance Auditor): Acceptance Auditor подтвердил все 8 AC SATISFIED (прямой трейс логики + тесты), извлечение хелпера — байт-в-байт идентично оригиналу (Edge Case Hunter сверил построчно с коммитом 20.4a). 2 patch применены: (1) `_csv_safety.py` переименован в `csv_safety.py` — ведущее подчёркивание сигнализирует «не импортируй извне», но модуль ЯВНО designed для межмодульного импорта внутри package (Blind Hunter); (2) Edge Case Hunter нашёл реальную «мину» — сырой `datetime`, переданный будущим вызывающим кодом БЕЗ `.isoformat()`, дал бы `str(datetime)`'s пробел-разделитель вместо `T` и непостоянную ширину микросекунд; добавлена явная ISO-нормализация (`_cell()`-хелпер) + regression-тест. `make gate` после патчей — 4446 passed (+1). Остальное dismiss (BOM/Excel-кодировка — established решение 20.4a, не новый разрыв; неполный набор formula-trigger символов (без tab/CR) — тот же class, что уже принят 20.4a, «текстбук четыре» осознанно; отсутствие guard на non-dict `rows` — тот же паттерн, что `employee_csv.py` уже не имеет).

### Completion Notes List

- AC-1..AC-8 реализованы. `build_history_csv(rows) -> bytes` — БЕЗ маскирования (в `EmployeeDivisionHistory` нет чувствительных полей, подтверждено research-агентом при create-story).
- CWE-1236-хелпер (formula-injection) вынесен из `employee_csv.py` в общий `csv_safety.py`, оба билдера теперь используют один и тот же код — не дублирование.
- `ends_at=None` (текущий, незакрытый перевод) рендерится пустой ячейкой, не строкой `"None"` — явный тест.
- Ревью-патчи: модуль переименован `_csv_safety.py`→`csv_safety.py`, добавлена ISO-нормализация сырого `datetime` (защита от будущего дрейфа формата).
- Регрессия: `test_employee_csv_export.py` (20.4a) прошёл БЕЗ ПРАВОК после рефакторинга общего хелпера.

### File List

- `Backend/VAPS/apps/core/exports/csv_safety.py` (new, ревью-патч переименован из `_csv_safety.py`)
- `Backend/VAPS/apps/core/exports/employee_csv.py` (modified — переключён на `csv_safety.py`)
- `Backend/VAPS/apps/core/exports/history_csv.py` (new, изменён ревью — ISO-нормализация `datetime`)
- `Backend/VAPS/apps/core/tests/test_history_csv_export.py` (new, изменён ревью — тест `datetime`-коэрции)

## Change Log

| Дата | Изменение |
|---|---|
| 2026-08-07 | Story создана (create-story). Второй срез FR-40's матрицы 3×2 (история×CSV). Research-агент подтвердил: НЕТ чувствительных полей в `EmployeeDivisionHistory` (маскирование не нужно), НЕТ существующего построчного селектора (построение `rows` — вне скоупа, как и в 20.4a), CWE-1236-хелпер сейчас инлайнен только в `employee_csv.py` — извлекается в общий `_csv_safety.py`. |
| 2026-08-07 | Dev-story: `_csv_safety.py` (общий хелпер) + `employee_csv.py` переключён на него + `history_csv.py` (`build_history_csv`) + 6 тестов. `make gate` (Backend/VAPS) — 4445 passed, 0 regressions. Status → review. |
| 2026-08-07 | Ревью-патчи: `_csv_safety.py`→`csv_safety.py` (не приватный модуль), ISO-нормализация сырого `datetime` в `build_history_csv`. `make gate` — 4446 passed, 0 regressions. Status → done. |
