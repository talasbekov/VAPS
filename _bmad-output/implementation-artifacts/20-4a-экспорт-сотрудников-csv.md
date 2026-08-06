---
baseline_commit: 461bc22
---

# Story 20.4a: Экспорт сотрудников — CSV с маскированием (билдер)

Status: done

## Story

As a **держатель права экспорта** (руководитель/кадровик),
I want **получить `.csv` со списком сотрудников, где чувствительные поля (ИИН) замаскированы по моим правам**,
so that **FR-40's «экспорт сотрудников... с маскированием» закрыт хотя бы для одной сущности (сотрудники) и одного формата (CSV), без риска утечки ИИН тем, у кого нет права его видеть**.

## Scope Decision

- **Разбор FR-40**: «Экспорт сотрудников/историй/аудита .csv/.xlsx с маскированием» — ТРИ сущности (сотрудники/история/аудит) × ДВА формата (csv/xlsx) = потенциально 6 комбинаций. Эта стори — ТОЛЬКО «сотрудники» × ТОЛЬКО «csv» (тот же принцип декомпозиции, что везде в этом эпике — начинать с одного узкого вертикального среза, не с всей матрицы сразу). «Историй переводов» (`EmployeeDivisionHistory`) и «аудита» (`AuditLog`, который УЖЕ имеет прецедент осознанного НЕ-экспорта payload'а — `apps/audit/diagnostics_export.py`'s `_audit_log_payload()` намеренно опускает `old_value`/`new_value`, не сканирует JSON на PII) — БУДУЩИЕ стори (20.4b/20.4c) при явном запросе. XLSX-версия (`.xlsx`) — тоже будущая стори (20.4d), если понадобится (openpyxl уже используется проектом, `apps/documents/generators/expense_xlsx.py`, но эта стори — только CSV, stdlib, без новой зависимости).
- **Переиспользует `mask_employee_data()`** (`apps/core/services.py`, УЖЕ существует, DB-driven `SensitiveFieldPolicy`) — НЕ переизобретает маскирование, буквально та же функция, что уже красит IIN в API employee-detail. НЕ строится новый механизм маскирования для экспорта.
- **КРИТИЧНО (NFR-4, запрет COUNT-в-цикле)**: `mask_employee_data(data, *, user_permissions)` делает СВОЙ запрос `SensitiveFieldPolicy.objects.filter(is_active=True)` ВНУТРИ каждого вызова — вызов в цикле по N сотрудникам дал бы N запросов к `SensitiveFieldPolicy` (тот самый анти-паттерн, что NFR-4 явно запрещает). Эта стори РАСШИРЯЕТ `mask_employee_data()` НОВЫМ optional keyword-параметром `policies=None` (обратная совместимость: `None` → старое поведение, свой запрос внутри; ЯВНО переданный pre-fetched список/queryset → используется БЕЗ повторного запроса) — существующие вызовы (API employee-detail, `test_masking.py`) НЕ ломаются, работают КАК РАНЬШЕ. Билдер экспорта делает ОДИН запрос `SensitiveFieldPolicy` СНАРУЖИ цикла, передаёт его в каждый вызов `mask_employee_data(row, user_permissions=..., policies=policies)`.
- **`build_employees_csv(rows, *, user_permissions) -> bytes`** — в `apps/core/exports/employee_csv.py` (новый модуль, package `apps.core.exports` — параллель `apps.documents.generators`, тот же принцип «чистый рендерер данные→bytes»). Принимает УЖЕ ЗАГРУЖЕННЫЕ построчные `dict` (тот же принцип, что 19.5a/20.2a: «принимает уже ограниченный список, не строит выборку сам») — построение списка сотрудников (через `CoreEmployeeSelector`) — ответственность ВЫЗЫВАЮЩЕГО кода (будущий 20.4-API-слой), не этой стори. Единственный внутренний запрос БИЛДЕРА — тот самый ОДИН запрос `SensitiveFieldPolicy` (не к `Employee`).
- **Экспортируемые колонки**: `iin` (маскируемое, PARTIAL_MASK/FULL_HIDE по политике), `full_name`, `rank_code`, `position_code`, `division_id`, `employment_status` — минимальный набор, буквально те поля `Employee`, что уже фигурируют в существующих denorm/export путях (`CoreEmployeeSelector.denorm_for()`), без придумывания новых полей.
- **stdlib `csv`**, не `openpyxl`/сторонняя библиотека — CSV не требует зависимости, `io.StringIO`+`csv.writer` с корректным экранированием (запятые/кавычки/переносы строк в `full_name` — кириллица, ФИО может содержать дефис/пробелы, но `csv`-модуль сам экранирует спецсимволы штатно).
- **Out of scope**: API/эндпоинт HTTP-слоя (20.4-API); экспорт «историй переводов» (20.4b); экспорт «аудита» (20.4c, есть нерешённый вопрос редакции payload — не эта стори); XLSX-версия (20.4d); построение списка сотрудников (`CoreEmployeeSelector`, переиспользуется, не строится заново); RBAC-гейтинг «кто может экспортировать» (API-слой, не билдер).

## Acceptance Criteria

1. **AC-1.** `SensitiveFieldPolicy(field_code="iin", permission_code="employee.sensitive.view", mask_strategy="PARTIAL_MASK")`, `user_permissions=set()` (нет права) → CSV содержит замаскированный ИИН (не оканчивается на реальные последние 4 цифры... точнее — ОКАНЧИВАЕТСЯ на последние 4, но ведущие символы заменены на `*`, тот же формат, что `_partial_mask()`).
2. **AC-2.** Тот же `user_permissions={"employee.sensitive.view"}` → CSV содержит РЕАЛЬНЫЙ ИИН (не замаскирован).
3. **AC-3.** CSV содержит строку-заголовок с ИМЕНАМИ колонок (`iin`, `full_name`, `rank_code`, `position_code`, `division_id`, `employment_status`).
4. **AC-4.** Пустой список `rows=[]` → CSV только с заголовком, без строк данных, без исключения.
5. **AC-5.** `full_name`, содержащее запятую/кавычку (напр. `Иванов, Иван "Ваня"`) → корректно CSV-экранировано (round-trip через `csv.reader` восстанавливает ИСХОДНОЕ значение).
6. **AC-6.** Билдер делает РОВНО ОДИН запрос (`SensitiveFieldPolicy`) НЕЗАВИСИМО от числа строк в `rows` (`assertNumQueries(1)`/`CaptureQueriesContext`) — доказывает отсутствие N+1.
7. **AC-7.** `mask_employee_data(data, user_permissions=..., policies=<pre-fetched>)` — при явно переданном `policies` НЕ делает собственного запроса к `SensitiveFieldPolicy` (регрессия: существующие вызовы БЕЗ `policies` — поведение и число запросов НЕ изменились, `test_masking.py` проходит без правок).
8. **AC-8.** `make gate` (Backend/VAPS) зелёный.

## Out of Scope

- API/эндпоинт HTTP-слоя.
- Экспорт «историй переводов» (`EmployeeDivisionHistory`, 20.4b).
- Экспорт «аудита» (`AuditLog`, 20.4c — payload-редакция не решена этой стори).
- XLSX-версия (20.4d).
- Построение списка сотрудников (переиспользует `CoreEmployeeSelector`).
- RBAC-гейтинг доступа к экспорту (API-слой).

## Tasks / Subtasks

- [x] Task 1 — `apps/core/services.py`: `mask_employee_data(data, *, user_permissions, policies=None)` — новый optional-параметр, обратная совместимость сохранена.
- [x] Task 2 — `apps/core/exports/employee_csv.py` (новый модуль): `build_employees_csv(rows, *, user_permissions) -> bytes`.
- [x] Task 3 — Тесты (AC 1-7): `apps/core/tests/test_masking.py` (регрессия без правок), `apps/core/tests/test_employee_csv_export.py` (новый).
- [x] Task 4 — `make gate` (Backend/VAPS).

## Dev Notes

- `apps/core/services.py:150-176` (`mask_employee_data`, существующий) — `policies = SensitiveFieldPolicy.objects.filter(is_active=True)` СЕЙЧАС всегда запрашивает сама. Рефакторинг: `def mask_employee_data(data, *, user_permissions, policies=None): if policies is None: policies = SensitiveFieldPolicy.objects.filter(is_active=True)` — остальное тело БЕЗ изменений.
- `apps/core/tests/test_masking.py` — СТРУКТУРНЫЙ образец фикстур (`SensitiveFieldPolicy.objects.create(field_code="iin", permission_code="employee.sensitive.view", mask_strategy="PARTIAL_MASK")`). Регрессионный тест: убедиться, что ВСЕ существующие тесты в этом файле проходят БЕЗ ПРАВОК (AC-7).
- `apps/core/services.py:149-153` (`_partial_mask`) — формат маски: `"*" * (len(text) - 4) + text[-4:]` — используется ВНУТРИ `mask_employee_data`, эта стори её не трогает, только проверяет итоговый CSV-вывод содержит РЕЗУЛЬТАТ этой функции.
- `apps/documents/generators/expense_xlsx.py` — СТРУКТУРНЫЙ ОБРАЗЕЦ «чистого рендерера»: `data -> bytes`, без ORM внутри (кроме единственного допустимого запроса политик масок в этой стори — по духу «один bulk-запрос», не многие). `io.StringIO()`+`csv.writer(...)`, затем `.getvalue().encode("utf-8")` → `bytes` (тот же тип возврата, что `generate_expense_xlsx`).
- Порядок применения маски: для каждой строки `rows` — `mask_employee_data(row, user_permissions=user_permissions, policies=policies)` (уже собранные `policies` передаются в КАЖДЫЙ вызов, не перевычисляются) — ПОТОМ запись замаскированной строки в CSV через `csv.DictWriter` (или `csv.writer` с явным порядком колонок).
- Кодировка: `.encode("utf-8")` (не `utf-8-sig`/BOM — если Excel-совместимость с кириллицей понадобится, это отдельное явное решение будущей стори при жалобе, не превентивная мера здесь).

### References

- [Source: _bmad-output/planning-artifacts/epics.md#L1474] — Story 20.4 формулировка (FR-40).
- [Source: _bmad-output/planning-artifacts/prds/prd-VAPS-2026-06-10/prd.md#L167] — FR-40 текст.
- [Source: Backend/VAPS/apps/core/services.py] — `mask_employee_data()`/`_partial_mask()`, существующий механизм маскирования.
- [Source: Backend/VAPS/apps/core/tests/test_masking.py] — структурный образец тестов.
- [Source: Backend/VAPS/apps/documents/generators/expense_xlsx.py] — прецедент «чистого рендерера» data→bytes.
- [Source: Backend/VAPS/apps/audit/diagnostics_export.py] — прецедент осознанного НЕ-экспорта audit payload (обоснование, почему аудит — отдельная будущая стори, не расширяется здесь).

## Dev Agent Record

### Agent Model Used

Claude Sonnet 5

### Debug Log References

### Completion Notes List

Реализовано по AC 1-8. `mask_employee_data()` расширен optional `policies=None` параметром — обратная совместимость: `None` → старое поведение (свой запрос), явно переданный → используется без повторного запроса. `build_employees_csv(rows, *, user_permissions)` в новом `apps/core/exports/employee_csv.py` — ОДИН запрос `SensitiveFieldPolicy` снаружи цикла, `csv.DictWriter` для корректного экранирования спецсимволов. 6 новых тестов + 4 существующих регрессионных (`test_masking.py`, без правок). Полная бэкенд-сюита — 4328 passed, 0 regressions. Никаких миграций (новый Python-модуль, не модель).

### File List

- `Backend/VAPS/apps/core/services.py` (modified — `mask_employee_data()` optional `policies` параметр)
- `Backend/VAPS/apps/core/exports/__init__.py` (new)
- `Backend/VAPS/apps/core/exports/employee_csv.py` (new — `build_employees_csv()`)
- `Backend/VAPS/apps/core/tests/test_employee_csv_export.py` (new)

## Change Log

| Дата | Изменение |
|---|---|
| 2026-08-06 | Story создана (create-story). Декомпозирована из epics.md's Story 20.4 (FR-40, 3 сущности × 2 формата) в 20.4a — только «сотрудники» × только «CSV», переиспользует существующий `mask_employee_data()` с новым optional `policies`-параметром для bulk-безопасности (NFR-4). История/аудит/XLSX — будущие стори (20.4b/c/d). |
| 2026-08-06 | Dev-story: `mask_employee_data(policies=None)` + `build_employees_csv()` + 6 тестов. `make gate`-эквивалент — 4328 passed, 0 regressions. Status → review. |
| 2026-08-06 | Review закрыт (Blind Hunter + Edge Case Hunter + Acceptance Auditor). Оба адверсариальных агента независимо совпали на CSV formula injection (CWE-1236) — free-text поля (`full_name`) без ограничения символов могли исполниться как формула в Excel/LibreOffice. Исправлено ведущим апострофом на значениях, начинающихся с `=`/`+`/`-`/`@` (стандартная OWASP-митигация) + 4 параметризованных regression-теста. BOM/кодировка для кириллицы в Excel — оставлено как задокументированное намеренное сужение scope (не патч). `make gate`-эквивалент после патча — 4332 passed, 0 regressions. Status → done. |
