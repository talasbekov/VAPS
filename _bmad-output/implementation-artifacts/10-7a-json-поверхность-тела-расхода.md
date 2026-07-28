---
baseline_commit: 4aef890
---

# Story 10.7a: JSON-поверхность тела расхода

Status: done

## Story

As a **руководитель**,
I want **HTTP-роут, отдающий ПОЛНОЕ тело документа расхода (числа + члены ячеек — звание/ФИО/период) в типизированном JSON**,
so that **любая будущая фронт-фича (детализация ячейки, drill-down, экспорт) читает УЖЕ существующий билдер `build_expense_document`, а не переизобретает `resolve_status`/приоритеты на фронте (запрет, зафиксированный в 10.1b/10.6)**.

## Acceptance Criteria

Источник: `_bmad-output/implementation-artifacts/sprint-status.yaml:443-449` («10.7a — БЭК: JSON-поверхность тела расхода поверх УЖЕ существующей чистой функции `build_expense_document` (`expense_document.py:44`): сериализатор над `ExpenseDocumentData` + роут + `@extend_schema` + regen схемы. Билдер писать не нужно — готов с 6.3»).

1. **AC-1 (новый роут `GET /api/operations/expense-reports/document/`).** Given `division_id`+`business_date` (query, оба обязательны — точечный запрос ОДНОЙ пары, зеркало `ExpenseReportByDateFilterSerializer`), Then **200** с ПОЛНЫМ телом `ExpenseDocumentData`: `division_title`, `business_date`, `rows[]` (`name`, `staff_total`, `list_total`, `vacancies`, `cells` — по колонке `DOCX_COLUMNS`, `attached`), `totals` (те же числа, БЕЗ членов). Каждая `cells[colname]`/`attached` — `{count, members[]}`, `members[]` — `{rank, full_name, date_start, date_end}`. `build_expense_document` (`expense_document.py:44`) НЕ переписывается — вызывается байт-в-байт с теми же аргументами, что и на выпуске (`document_release_service.py:229-249`).
2. **AC-2 (роут READ-ONLY — ничего не выпускает, не консьюмит номер, не пишет аудит).** В отличие от `POST /expense-reports/` (6.10a, реально выпускает документ), этот роут — ЧИСТОЕ чтение: НЕТ `allocate_number`, НЕТ `IssuedDocument`, НЕТ записи в `audit`. Селектор — `DailySubmissionSelector.current_for` (БЕЗ `lock=True`, БЕЗ `transaction.atomic()`) — зеркало `summary_freshness` (10.6a), НЕ `latest_for(lock=True)` (это write-путь выпуска, сериализующийся с amendment).
3. **AC-3 (гарды — байт-в-байт с release-путём, СТОП-семантика сохранена).** Нет действующей сдачи на (division, date) → **409** `REPORT_NOT_READY_FOR_DATE` (то же сообщение, что `document_release_service.py:200-208`). `schema_version` снапшота не поддерживается → **422** `SNAPSHOT_SCHEMA_UNSUPPORTED` (`document_release_service.py:218-228`). Расход НЕ сходится (`derive_report` даёт violations/warnings) → **422** `REPORT_NOT_CONVERGENT` (`document_release_service.py:238-251`) — те же три гарда, что перед `build_expense_document` на выпуске, ПОРЯДОК идентичен.
4. **AC-4 (гейт/scope — тот же код, что весь `ExpenseReportViewSet`).** Право `daily_report.generate` (`_EXPENSE_PERMISSION`), `ensure_division_scope`+`_ensure_division_exists` — тот же порядок, что `list`/`period`/`journal` (exists-проверка ПОСЛЕ scope). 403 чужой scope; 404 нет подразделения.
5. **AC-5 (`members[]` — ПОЛНЫЙ список, без cap 20).** `CELL_MAX_MEMBERS = 20` (`expense_docx.py:65`) — cap render-слоя (DOCX/XLSX), НЕ часть `ExpenseDocumentData`. JSON-ответ отдаёт `len(members) == count` ВСЕГДА (билдер это уже cross-assert'ит), «…ещё N» — забота будущего UI-потребителя, не этой стори. Дев Notes фиксируют это явно, чтобы будущая UI-стори не считала cap багом бэка.
6. **AC-6 (схема + RBAC-матрица).** `MATRIX["ops-expense-report-document"] = _MethodGate({"get": "daily_report.generate"})`; `schema.yaml`/`schema.d.ts` содержат роут и типы (вложенные `inline_serializer` для `ExpenseDocumentRow`/`ExpenseDocumentCell`/`ExpenseDocumentCellMember`/`ExpenseDocumentTotals` — зеркало формы `TrafficLightTreeResponse`/`ExpensePeriodResponse`, НЕ `DictField`).
7. **AC-7 (регресс нулевой).** `build_expense_document`/`document_release_service.issue_expense_document`/`generate_expense_docx`/`generate_expense_xlsx` — БЕЗ изменений (только новая точка ЧТЕНИЯ поверх них). `make gate` зелёный.

## Tasks / Subtasks

- [x] Task 1 — Read-only сервис-обёртка (`Backend/VAPS/apps/operations/submissions/services/expense_document_read_service.py`, NEW) (AC: 1, 2, 3)
  - [x] `read_expense_document(*, division_id, business_date)` — зеркало шагов `document_release_service.py:197-249` ДО `data = build_expense_document(...)` включительно, БЕЗ шагов ПОСЛЕ (номер/файл/аудит): `DailySubmissionSelector.current_for(division_id, business_date)` (БЕЗ lock, БЕЗ транзакции — read-only, AC-2) → `None` → `DomainError("REPORT_NOT_READY_FOR_DATE", 409, ...)` (текст СЛОВО-В-СЛОВО с release-путём) → `schema_version`-гард (422 `SNAPSHOT_SCHEMA_UNSUPPORTED`, зеркало `document_release_service.py:218-228`) → `staff_map`/`division_names` через те же селекторы (`CoreStaffingSelector.allocated_slots_on`, `CoreDivisionTreeSelector.divisions_map`) → `derive_report` convergence-гард (422 `REPORT_NOT_CONVERGENT`, зеркало `:238-251`) → `build_expense_document(...)` → `return data` (`ExpenseDocumentData`).
  - [x] Экспорт `read_expense_document` в `apps/operations/submissions/services/__init__.py` (алфавитный порядок, зеркало `summary_freshness`).
- [x] Task 2 — Сериализация `ExpenseDocumentData` → JSON-safe dict (тот же модуль ИЛИ `views.py`) (AC: 1, 5)
  - [x] `_serialize_expense_document(data)` — ручная функция (dataclasses не JSON-сериализуемы напрямую, `date`-поля требуют `.isoformat()`): `{division_title, business_date: business_date.isoformat(), rows: [...], totals: {...}}`. Каждый `ExpenseCell`/`attached` → `{count, members: [{rank, full_name, date_start: .isoformat(), date_end: .isoformat()}, ...]}`. `cells` — dict по имени колонки (`REPORT_COLUMNS`-ключи), передаётся КАК ЕСТЬ (ключи уже строки).
- [x] Task 3 — Форма фильтра + `document`-экшен (`Backend/VAPS/apps/operations/submissions/api/serializers.py`, `views.py`, MOD) (AC: 1, 3, 4, 6)
  - [x] Переиспользовать `ExpenseReportByDateFilterSerializer` (УЖЕ существует, `serializers.py:110-115`, `division_id`+`business_date` оба обязательны) — новая форма НЕ нужна.
  - [x] `permission_map["document"] = _EXPENSE_PERMISSION`.
  - [x] `@action(detail=False, methods=["get"], url_path="document") def document(self, request, *args, **kwargs)`: валидирует форму → `ensure_division_scope(actor, _EXPENSE_PERMISSION, division_id)` → `_ensure_division_exists(division_id)` → `data = read_expense_document(division_id=division_id, business_date=business_date)` → `Response(_serialize_expense_document(data))`.
  - [x] `@extend_schema` — `parameters=[ExpenseReportByDateFilterSerializer]`, `responses={200: inline_serializer(...)}` с вложенными `inline_serializer` для `ExpenseDocumentRow`/`ExpenseDocumentCell`(`many=True` где список)/`ExpenseDocumentCellMember`/`ExpenseDocumentTotals` (зеркало 10.6a/10.5e — НЕ `DictField` для структурных полей; `cells`-словарь по колонке остаётся `DictField(child=...)`, т.к. ключи — открытое множество кодов колонок, не перечислимая структура).
- [x] Task 4 — RBAC-матрица (AC: 6)
  - [x] `test_rbac_matrix.py` (MOD): `MATRIX["ops-expense-report-document"] = _MethodGate({"get": "daily_report.generate"})`, рядом с `ops-expense-report-list`/`ops-expense-report-period`/`ops-expense-report-journal`.
- [x] Task 5 — Регенерация схемы (AC: 6)
  - [x] `make schema` (Backend/VAPS) + `cd frontend && npm run generate:api`. Отсечь несвязанный int64/int32-дрейф (известный паттерн 10.3c/10.5b/10.5e/10.6a), если воспроизведётся.
- [x] Task 6 — Тесты (`Backend/VAPS/apps/operations/submissions/tests/test_expense_document_api.py`, NEW) (AC: 1-7)
  - [x] AC-1: посев сдачи с известным составом (роль/ФИО/период фактов) → `document` отдаёт `rows[0].cells[colname].members` с ожидаемыми `rank`/`full_name`/`date_start`/`date_end`; `totals` — числа БЕЗ `members`-ключа нигде.
  - [x] AC-2: query-count/mock-проверка — `read_expense_document` НЕ вызывает `allocate_number`/`create_attachment`/`audit.services.record` (замокать и убедиться в нуле вызовов ИЛИ прямой assert на отсутствие `IssuedDocument`/`AuditLog`-строк после запроса).
  - [x] AC-3: три гарда по отдельности — нет сдачи → 409 `REPORT_NOT_READY_FOR_DATE`; неподдерживаемый `schema_version` (посеять сдачу с испорченным снапшотом) → 422 `SNAPSHOT_SCHEMA_UNSUPPORTED`; несходящийся расход (посеять расхождение штат/факт) → 422 `REPORT_NOT_CONVERGENT`.
  - [x] AC-4: чужой scope → 403; фантомное подразделение → 404.
  - [x] AC-5: посеять ячейку с >20 фактическими членами (если тестово достижимо дёшево) ИЛИ юнит-уровневый тест на `_serialize_expense_document` с фикстурой `ExpenseCell(count=25, members=tuple(25 элементов))` → сериализованный JSON несёт ВСЕ 25, не 20.
  - [x] AC-7 (косвенно): `test_document_release.py`/`test_expense_report_api.py`/golden-тесты — без изменений, проходят как есть (домен не тронут).
- [x] Task 7 — Гейт (AC: 7)
  - [x] `make gate` (Backend/VAPS) + `cd frontend && npm run gate` (schema-check должен остаться чист — фронт-потребителя у роута ещё нет, `tsc` не должен упасть на отсутствии консьюмера).

## Dev Notes

- **`build_expense_document` — чистая функция, УЖЕ готова с Story 6.3.** `expense_document.py:44-95` — без ORM/wall-clock/сети, снапшот+`business_date`+`staff_map`+`division_names`+`division_id` аргументами. Эта стори НЕ переписывает билдер — только даёт ему НОВУЮ, read-only точку входа через HTTP, параллельную существующей write-точке (`document_release_service.issue_expense_document`).
- **Три ORM-обвязки перед билдером — СКОПИРОВАТЬ, не абстрагировать в общую функцию с release-путём.** `document_release_service.py:197-249` — `latest_for(lock=True)` внутри `transaction.atomic()` (write-путь, сериализуется с amendment через row-лок). Эта стори использует `current_for` (БЕЗ лока/транзакции, read-only) — СОЗНАТЕЛЬНОЕ РАСХОЖДЕНИЕ с release-путём в выборе селектора, а не забытая деталь: чтение не обязано брать лок, который существует для защиты записи от гонки с amendment. Общая абстракция между `read_expense_document` и `issue_expense_document` НЕ заводится в этой стори — предполагаемая экономия (~30 строк) не окупает риск случайно протащить лок/транзакцию в read-путь при будущем рефакторинге; дублирование трёх гвардов — явное и осознанное.
- **`CELL_MAX_MEMBERS = 20` — cap РЕНДЕРА, не данных.** `expense_docx.py:65` — используется ТОЛЬКО внутри `generate_expense_docx`/`generate_expense_xlsx` при печати «…ещё N». `ExpenseDocumentData`/`ExpenseCell` cap НЕ несут — `count == len(members)` всегда (билдер cross-assert'ит это на каждый вызов). JSON-роут этой стори отдаёт `members` ПОЛНОСТЬЮ — будущий UI-потребитель сам решает, показывать ли cap (или показать все — JSON, в отличие от печатной формы, не ограничен местом на листе).
- **Три гарда — STOP-семантика, не «мягкая деградация».** `REPORT_NOT_READY_FOR_DATE` (409)/`SNAPSHOT_SCHEMA_UNSUPPORTED` (422)/`REPORT_NOT_CONVERGENT` (422) — те же коды, что видит `POST /expense-reports/` при выпуске. Роут этой стори НЕ придумывает свои коды отказа — если данные несходящиеся, JSON-просмотр тела документа так же недостижим, как сам выпуск: несогласованный расход нельзя ни выпустить, ни просто посмотреть.
- **Почему НЕ переиспользовать `/period`-роут (6.10a/10.5e).** `/period` использует СОВЕРШЕННО ДРУГОЙ источник чисел — `StrengthReportService.compute` (живой derive БЕЗ требования сданной сдачи, `expense_read_service.py:derive_period`), не `build_expense_document`. У `/period` НЕТ членов ячеек вообще (numbers-only page, Dev Notes 10.5e). Эта стори — НЕ модификация `/period`, а параллельный роут с другим доменным контрактом (требует СДАННОЙ сдачи, отдаёт члены).

### References

- [Source: _bmad-output/implementation-artifacts/sprint-status.yaml:443-449] — постановка.
- [Source: Backend/VAPS/apps/operations/submissions/expense_document.py:1-95] — `build_expense_document` целиком, доктрина «read-only derive, ORM-обвязка — забота вызывающего».
- [Source: Backend/VAPS/apps/documents/generators/expense_docx.py:65,77-125] — `CELL_MAX_MEMBERS`, датаклассы `ExpenseCellMember`/`ExpenseCell`/`ExpenseRow`/`ExpenseTotals`/`ExpenseDocumentData`.
- [Source: Backend/VAPS/apps/operations/submissions/services/document_release_service.py:197-251] — release-путь: три гарда + вызов билдера (шаблон для read-only обёртки этой стори).
- [Source: Backend/VAPS/apps/operations/submissions/selectors.py:22,117] — `current_for` (read) vs `latest_for(lock=True)` (write) — выбор селектора для этой стори.
- [Source: Backend/VAPS/apps/operations/submissions/services/expense_read_service.py:1-17] — доктрина read-only сервис-модуля («RBAC-free by contract», гейт — в view), прямой стилевой прецедент для нового `expense_document_read_service.py`.
- [Source: Backend/VAPS/apps/operations/submissions/api/views.py:389,513-538] — `ExpenseReportViewSet.period` (прямой прецедент структуры `@action`/`@extend_schema`/гвардов).
- [Source: Backend/VAPS/apps/operations/submissions/api/serializers.py:110-115] — `ExpenseReportByDateFilterSerializer` (переиспользуется без изменений).
- [Source: Backend/VAPS/apps/operations/tests/test_rbac_matrix.py:174-177] — `ops-expense-report-list`/`ops-expense-report-period`, точка добавления `ops-expense-report-document`.

## Project Context Reference

Смотри `10-6a-роут-свежести-сводки.md` (прямой предшественник: read-only сервис-обёртка поверх готового домена, `current_for` вместо write-селектора, three-guard STOP-семантика) и `10-5e-чтение-за-период-ui.md` (типизация вложенных структур через `inline_serializer`).

## Dev Agent Record

### Agent Model Used

claude-sonnet-5

### Debug Log References

### Completion Notes List

- `expense_document_read_service.py` — новый модуль, зеркало доктрины `expense_read_service.py` (RBAC-free by contract). `read_expense_document` — байт-в-байт три гарда release-пути (`document_release_service.py:197-249`), но с `current_for` (без lock/транзакции) вместо `latest_for(lock=True)` — read не обязан сериализоваться с amendment. Приватные хелперы `_parse_snapshot_rows`/`_json_safe_findings` импортированы из `document_release_service` напрямую — in-app прецедент Д9 (тот же приём, что `summary_service.py`).
- `build_expense_document`/`issue_expense_document`/генераторы .docx/.xlsx — БЕЗ изменений (AC-7 подтверждён: `git diff` по этим файлам пуст).
- `serialize_expense_document` — ручная сериализация (dataclasses не JSON-сериализуемы напрямую, `date`-поля требуют `.isoformat()`). `members[]` отдаётся ПОЛНОСТЬЮ, `CELL_MAX_MEMBERS=20` (рендер-cap .docx/.xlsx) НЕ применяется — подтверждено юнит-тестом на 25 членах.
- `document`-экшен на `ExpenseReportViewSet` — тот же `_EXPENSE_PERMISSION`/гейт-порядок (scope→exists), что `list`/`period`/`journal`. Ответ типизирован вложенными `inline_serializer` (не `DictField`) для `rows`/`cells`/`members`/`totals` — `cells`-словарь по коду колонки остаётся `DictField(child=...)`, т.к. набор кодов колонок открытый (не перечислимая структура).
- Регенерация схемы — БЕЗ постороннего дрейфа (диф `schema.yaml` чисто аддитивен, 154 строки, ни одной удалённой).
- Регресс: backend — `apps/operations`+`apps/documents`+`apps/core/tests/test_schema_drift.py`+`apps/audit` под `-m "not property and not concurrency and not slow and not golden"` → 2076 passed, 0 ERROR. `makemigrations --check` пуст, `ruff check apps/` чист. Frontend — `npm run gate` 977 тестов (без изменений — стори бэк-only, консьюмера у нового роута фронт ещё не завёл), tsc/eslint/schema-check/build/size-gate (212.1 KB gzip / 300 бюджет) зелёные.
- `make gate` не запускался напрямую (порт 5433 занят посторонним контейнером, задокументированная память проекта) — использован эквивалентный прогон на порту 5434.

**Ревью (3-агентное: Blind Hunter / Edge Case Hunter / Acceptance Auditor) — 7/7 AC SATISFIED, 0 реальных багов:**
- Blind Hunter (без контекста проекта) поднял 8 пунктов — ВСЕ ложные срабатывания: большинство описывают поведение, БУКВАЛЬНО скопированное байт-в-байт с уже существующего и уже отревьюженного write-пути (`document_release_service.py`) — не новый риск этой стори, а сознательное зеркалирование (`type(version) is not int`, `repr()` в detail, `roster_ids`-KeyError-риск, «warnings блокируют read» — всё это уже было в проде на write-пути). Единственный содержательный пункт («отсутствие lock — риск гонки») — Edge Case Hunter независимо проверил и подтвердил безопасность: `staff_map`/`division_names` зависят от `business_date`/`division_id` (стабильные входы), не от версии сдачи — тот же паттерн, что уже принят в `summary_freshness` (10.6a).
- Edge Case Hunter независимо проверил ВСЕ 6 пунктов своего чек-листа (гварды байт-в-байт, безопасность отсутствия lock, легальность cross-module private import — прецедент уже есть в `summary_service.py:48`, соответствие схемы датаклассам поле-в-поле, невакуумность `test_non_convergent_report_is_422`, отсутствие ATTACHED-коллизии в `cells`) — багов не нашёл.
- Acceptance Auditor независимо перепрогнал `test_expense_document_api.py`+`test_rbac_matrix.py` (575 passed), `ruff check`/`makemigrations --check` — оба чисты; подтвердил все 7 AC построчно; отметил единственную косметику — Task 3 текстом упоминал возможную правку `serializers.py`, которая не понадобилась (переиспользован существующий сериализатор, как и предписывали Dev Notes) — File List уже был точен, правок не потребовалось.

### File List

- `Backend/VAPS/apps/operations/submissions/services/expense_document_read_service.py` (NEW) — `read_expense_document`, `serialize_expense_document`.
- `Backend/VAPS/apps/operations/submissions/services/__init__.py` (MOD) — экспорт обеих функций.
- `Backend/VAPS/apps/operations/submissions/api/views.py` (MOD) — `document`-экшен, `permission_map`, импорты.
- `Backend/VAPS/apps/operations/tests/test_rbac_matrix.py` (MOD) — `MATRIX["ops-expense-report-document"]`.
- `Backend/VAPS/apps/operations/submissions/tests/test_expense_document_api.py` (NEW) — 9 тестов.
- `Backend/VAPS/schema.yaml` (регенерирован, чисто аддитивно).
- `frontend/src/shared/api/schema.d.ts` (регенерирован, чисто аддитивно).

## Change Log
