---
baseline_commit: |
  98ad0e0 (feat(story-6.9): Зерно parallel-run) на ветке claude/exciting-vaughan-3e478b.
  E1–E6[6.1–6.9] реализованы; расход-инфра в apps/operations/submissions + apps/documents.
split: |
  6.10 разбита Bratan (2026-07-09) на 6.10a (эта — HTTP-выпуск + чтение по дате/периоду
  + date-before-data 422) и 6.10b (блокировка «на завтра»: TOMORROW_BLOCKED 422+laggards +
  POST override-эндпоинт + daily_report.override_block + date-валидация + фильтр протухших id).
context:
  - _bmad-output/planning-artifacts/epics.md (§Epic 6 Story 6.10 стр. 891-900: «расход за период (страница на дату)»; FR-17 стр. 50 «расход за день/период»; FR-18 стр. 51 «за прошедшие даты — всегда»; AC-3 стр. 898 «дата до начала данных → 422 с кодом, не пустой документ»; блокквота Bratan L900 — HTTP-«на завтра» = 6.10b)
  - _bmad-output/planning-artifacts/architecture.md (Layer Contract :445-454 view→сервис→селекторы; сериализатор только форма, MUST NOT serializer.create/update; сервис типизированные kwargs, transaction.atomic в сервисе; scope в сервисе через PermissionService→403 :452; list-селектор берёт actor первым :453; §Format :433-435 400=форма/422=бизнес/409=состояние + DomainError+единый handler; API-нейминг :410-412 /api/<ctx>/<resource>/ + POST /{id}/<verb>/; ARCH-DATA-021 :291 расход=derive(снапшот,дата); ARCH-DEFERRED-048 :773 AsyncJob DEFERRED, период-рендер 6.10 = кандидат-триггер; X-Accel :467; Admin :469 MUST NOT регать документы; молчание=СТОП :33-34)
  - Backend/VAPS/apps/operations/submissions/services/document_release_service.py:153 (issue_expense_document(*, division_id, business_date, actor) — SINGLE-date, HTTP-поверхности НЕТ «зона 6.10» :36; guards: 409 REPORT_NOT_READY_FOR_DATE :182 нет сдачи, 422 SNAPSHOT_SCHEMA_UNSUPPORTED :202, 422 REPORT_NOT_CONVERGENT :230, 409 DOCUMENT_ALREADY_ISSUED :263; amendment «взамен» SUPERSEDED; allocate_number gap-free; аудит DOCUMENT_ISSUED/SUPERSEDED)
  - Backend/VAPS/apps/documents/models.py (IssuedDocument :140 doc_type/number/year/business_date/division_id flat/attachment FK/supersedes/status ISSUED|SUPERSEDED; partial-unique uq_issued_document_current (doc_type,division_id,business_date) WHERE ISSUED :208; idx_issued_document_lookup(division_id,business_date) :239 — ездит period/date-lookup; DocumentSequence :73; EXPENSE_DOC_TYPE="расход" :8) + apps/documents/selectors.py:33 (IssuedDocumentSelector.current_issued — ТОЛЬКО lookup, нет list/period)
  - Backend/VAPS/apps/operations/submissions/api/views.py (DailySubmissionViewSet 5.8 — read-API КАРКАС для реюза: RequirePermissionMixin + ensure_division_scope, DailySubmissionPagination LimitOffset 50/200, list-селектор self-narrow через PermissionService.visible_division_ids) + api/serializers.py (DailySubmissionFilterSerializer division_id/business_date equality) ; config/urls.py:10 (api/documents/, api/operations/)
  - Backend/VAPS/apps/operations/submissions/services/snapshot.py:36 (build_division_snapshot→{schema_version=1,roster,rows}) + expense_document.py:44 (build_expense_document — single-date one-row) + statuses/services/strength_report.py:260 (StrengthReportService.compute per-date)
  - docs/registries/error-codes.yaml (REPORT_NOT_READY_FOR_DATE :138=409 «нет сдачи» — НЕ подходит для date-before-data; DOCUMENT_ALREADY_ISSUED :168; SNAPSHOT_SCHEMA_UNSUPPORTED :272; REPORT_NOT_CONVERGENT :278; growth_rule :21 новый код тем же PR) ; audit-events.yaml (DOCUMENT_ISSUED/DOWNLOADED/SUPERSEDED — все ЕСТЬ, новых не нужно) ; seed_operations.py:16 (daily_report.generate засеян, ORGD/OMD)
---

# Story 6.10a: HTTP-выпуск расхода и чтение по дате/периоду

Status: review

## Story

As a **руководство**,
I want **HTTP-поверхность расхода: POST-выпуск за дату (гейт `daily_report.generate` + scope в сервисе, поверх готового `issue_expense_document` 6.5) и GET-чтение расхода за дату и за период (read-only «страница на дату», БЕЗ нового DocumentSequence-номера), с явным 422 `REPORT_NO_DATA_FOR_DATE` для даты до начала данных (нет roster и статусов)**,
so that **FR-17 (расход за день/период по HTTP) закрыт — переиспользуя single-date issue-пайплайн и read-API-каркас 5.8, без переизобретения; «на завтра»-блокировка и override — отдельная стори 6.10b**.

## Acceptance Criteria

1. **POST-выпуск за дату.** Given `POST /api/operations/expense-reports/` с `{division_id, business_date}` и правом `daily_report.generate`, When вызываю, Then сервис `issue_expense_document(division_id, business_date, actor)` выполняется в одной транзакции и возвращает выпущенный `IssuedDocument` (номер, sha256, ссылка на attachment для скачивания через 6.7); scope-проверка «своё подразделение» — в СЕРВИСЕ через PermissionService (→ 403 DomainError), НЕ во view. Существующие guards пробрасываются как есть: нет сдачи→409 `REPORT_NOT_READY_FOR_DATE`, старая схема→422 `SNAPSHOT_SCHEMA_UNSUPPORTED`, несходимость→422 `REPORT_NOT_CONVERGENT`, повтор версии→409 `DOCUMENT_ALREADY_ISSUED`.

2. **GET расход за дату.** Given `GET /api/operations/expense-reports/?division_id&business_date`, When дата валидна и есть выпущенный документ, Then возвращается его метаданные (number/year/business_date/status/attachment_id) через `IssuedDocumentSelector` (read-only, self-narrow по `visible_division_ids` актора, как 5.8). Байт-файл отдаётся эндпоинтом скачивания 6.7 (X-Accel), 6.10a его НЕ дублирует.

3. **GET расход за период (page-per-date, read-only, БЕЗ номера).** Given `GET .../expense-reports/period/?division_id&date_from&date_to`, When период валиден, Then возвращается упорядоченная по дате коллекция «страниц» — по одной на дату диапазона, каждая = `derive(снапшот этой даты)` (реюз `build_division_snapshot`+`build_expense_document`/`derive_report` per-date), read-only, **новый DocumentSequence-номер НЕ выделяется** (суточный выпуск AC-1 остаётся единственным нумерованным юр-артефактом). Многодневного единого документа НЕТ — период = N независимых per-date сборок (Решение Bratan Q2).

4. **Date-before-data → 422 `REPORT_NO_DATA_FOR_DATE`.** Given дата (в single- или period-запросе) ДО начала данных — нет ни roster, ни статусов на дату (до горизонта импорта / подразделение ещё не существовало), Then 422 `REPORT_NO_DATA_FOR_DATE` (НОВЫЙ код, business_hard), НЕ пустой документ и НЕ 409 `REPORT_NOT_READY_FOR_DATE` (тот = «нет сдачи», иная семантика). Легально пустое подразделение (0 сотрудников, сходимость 0=0+0) — валидно, НЕ этот код.

5. **Sync vs async (ARCH-DEFERRED-048).** Given реалистичный объём, When мерю время генерации периода (замер в духе 6.6), Then решение зафиксировано ЧИСЛОМ: остаётся синхронно, если p95 < 2с (единичный выпуск ~22мс — запас); если период-рендер превышает порог → флип ARCH-DEFERRED-048 в ACTIVE (202+поллинг). НЕ вводить AsyncJob молча и НЕ оставлять sync молча при превышении.

6. **Реестры, RBAC, границы, гейт.** Новый код `REPORT_NO_DATA_FOR_DATE` (422) в `error-codes.yaml` тем же PR (молчание=СТОП); аудит-события НЕ добавляются (issue/download уже в реестре). Новый эндпоинт(ы) → строка в RBAC-матрице 2.9 (гейт `daily_report.generate` засеян — seed не трогаем; read-гейт — Д2). Модели НЕ регать в Admin. `serializer.create/update` НЕ использовать; scope в сервисе. `make gate` зелёный; `makemigrations --check` чист (моделей 6.10a НЕ добавляет — реюз IssuedDocument); ruff чист; арх-гвард `operations↛core.models` цел.

## Tasks / Subtasks

- [x] Task 1: POST-выпуск эндпоинт (AC: 1, 6)
  - [x] Вью-слой в `apps/operations/submissions/api/` (Д1 mount): `ExpenseReportViewSet` (или action на существующем роутере) — `POST` c `RequirePermissionMixin("daily_report.generate")`; сериализатор входа только форма (`division_id: UUID`, `business_date: date`), MUST NOT `serializer.create()`; вызывает `issue_expense_document(division_id=…, business_date=…, actor=request.actor_id)`; scope-проверка в сервисе (добавить PermissionService-scope в `issue_expense_document` ЛИБО тонкий сервис-обёртка, чтобы view не решал scope — канон :452).
  - [x] Сериализатор ответа: метаданные `IssuedDocument` (number/year/business_date/status/attachment_id/sha256). Регистрация роутера в `submissions/api/urls.py` или `operations/api/urls.py`; `@extend_schema` для OpenAPI (ARCH-FE-011) + `make schema`.
- [x] Task 2: GET расход за дату (AC: 2, 6)
  - [x] Расширить `IssuedDocumentSelector` методом чтения по (division_id, business_date) с actor-narrow (`visible_division_ids`, зеркало 5.8c); GET-роут с фильтр-сериализатором (division_id/business_date). Read-only, БЕЗ мутаций.
- [x] Task 3: GET расход за период (page-per-date, read-only) (AC: 3, 4)
  - [x] `GET .../period/` фильтр-сериализатор (`division_id`, `date_from`, `date_to`; валидация диапазона, разумный cap на длину периода — Д3). Сборка: для каждой даты диапазона — `build_division_snapshot`+`build_expense_document`/`derive_report` (реюз single-date пайплайна в цикле); БЕЗ `allocate_number`, БЕЗ записи IssuedDocument (read-only). Ответ — упорядоченный список per-date страниц/метаданных.
  - [x] Date-before-data guard (AC-4): для каждой запрошенной даты — если нет ни roster, ни статусов → 422 `REPORT_NO_DATA_FOR_DATE`. Селектор-проба существования данных на дату (реюз `HistoricalEmployeeSelector.roster_on` + `EmployeeStatusSelector.overlapping_on`; обе пусты → before-data).
- [x] Task 4: Реестр + RBAC-матрица (AC: 6)
  - [x] `docs/registries/error-codes.yaml`: +`REPORT_NO_DATA_FOR_DATE` (422, business_hard, overridable:false, «Запрошена дата до начала данных — нет roster и статусов»).
  - [x] `DomainError`-подкласс/использование кода в сервисе date-before-data-проверки; единый exception_handler рендерит §36-конверт.
  - [x] RBAC-матрица 2.9: строки для новых роутов (issue=`daily_report.generate`; read=Д2). `test_rbac_matrix` зелёный.
- [x] Task 5: Async-замер (AC: 5)
  - [x] Замер p95 генерации периода на реалистичном объёме (в духе 6.6). Зафиксировать число в Dev Notes/Debug Log. Решение: sync [дефолт] или флип ARCH-DEFERRED-048. Если sync — пометить, что триггер остаётся (период > порог в будущем → 6.6-путь).
- [x] Task 6: Тесты + гейт (AC: 1-6)
  - [x] `apps/operations/submissions/tests/` (django_db): POST-выпуск happy (право+scope→201/выпуск), 403 без права, 403 чужой scope, 409/422 guards пробрасываются; GET-дата (есть/нет документа); GET-период 3 дня→3 страницы по снапшотам; date-before-data→422 `REPORT_NO_DATA_FOR_DATE` (не 409, не пустой); пустое подразделение→валидно. Посев напрямую (Organization/Division/Employee/EmployeeStatus + **DivisionHistoricalSlot** обязателен, иначе no_staffing_record→422; зеркало `test_document_release.py`), `clock.override`, RBAC через `UserRole`/`seed_operations`.
  - [x] `make gate` зелёный; `makemigrations --check` чист; ruff чист (`ruff format` точечно); `make schema` (если @extend_schema) + фронт-кодоген вне scope (E8/E10).

## Dev Notes

### ⚠️ Ловушка №1 (ГЛАВНАЯ): выпуск single-date УЖЕ готов — 6.10a только надевает HTTP

`issue_expense_document` (6.5, `document_release_service.py:153`) — полный single-date пайплайн в одной транзакции с ВСЕМИ guard'ами (409 нет-сдачи, 422 схема/несходимость, 409 повтор), amendment-«взамен»/SUPERSEDED, gap-free номер, аудит. Его docstring прямо: «HTTP-поверхности НЕТ (Д3, зона 6.10)». **6.10a НЕ трогает бизнес-логику выпуска** — добавляет view+сериализатор+роут+scope-в-сервисе. Не дублировать guard'ы во view (канон :435 — никаких try/except+ручной Response; DomainError ловит единый handler).

### ⚠️ Ловушка №2: период = read-only page-per-date, БЕЗ номера (Решение Bratan Q2)

AC «документ из трёх страниц» ≠ один многостраничный нумерованный документ. Реалия кода: multi-date issue НЕ существует, `build_expense_document` single-date one-row, DocumentSequence = один номер на (doc_type,year). **Период — read-only сборка N per-date страниц из снапшотов, БЕЗ `allocate_number`, БЕЗ записи IssuedDocument.** Суточный POST-выпуск (AC-1) остаётся единственным нумерованным юр-артефактом. НЕ выделять номер на период, НЕ городить multi-date issue-семантику.

### ⚠️ Ловушка №3: date-before-data (422) ≠ нет-сдачи (409) — РАЗНАЯ семантика

`REPORT_NOT_READY_FOR_DATE` (409, `error-codes.yaml:138`) = «сдачи на дату нет» (снапшот не выпущен). AC-4 — иное: дата ДО начала данных (нет ни roster, ни статусов вообще). Нужен НОВЫЙ 422 `REPORT_NO_DATA_FOR_DATE`. НЕ переиспользовать 409 и НЕ переиспользовать `BUSINESS_DATE_OUT_OF_WINDOW` (409, окно первичной сдачи 5.4 — другое). Пробы существования: `roster_on` пуст И `overlapping_on` пуст → before-data. ⚠️ Легально пустое подразделение (0 сотрудников на дату В пределах данных) — валидный снапшот (сходимость 0=0+0), НЕ этот код (граница 5.3b).

### ⚠️ Ловушка №4: scope — в СЕРВИСЕ, не во view; read-селектор self-narrow

Канон :452-453: permission-класс = грубый гейт роли/действия; «своё ли подразделение» — в сервисе через PermissionService→403; каждый list-селектор берёт actor первым и сам сужает видимость (ViewSet по правам НЕ фильтрует). Реюз `PermissionService.visible_division_ids` (5.8c). `issue_expense_document` сейчас scope НЕ проверяет (был pre-HTTP) → добавить scope-гейт в сервис (или тонкая обёртка), чтобы view не решал.

### ⚠️ Ловушка №5: async — замер, не догадка (ARCH-DEFERRED-048)

Период-рендер (N страниц) — ЯВНО названный кандидат-триггер AsyncJob (`architecture.md:773`). Правило: замерить p95 на реалистичном объёме; sync только если < 2с (единичный ~22мс — запас ×), иначе флип в 202+поллинг. Зафиксировать ЧИСЛО. Ни молчаливого async, ни молчаливого sync-над-порогом.

### Дефолты (#YOLO — поднять на ревью)

- **Д1 (mount):** новые эндпоинты в `apps/operations/submissions/api/` (там живёт issue-код; `operations/reports`-app в реалии нет, арх-намерение устарело). Альт: создать `operations/reports`-app.
- **Д2 (read-permission):** чтение расхода (issued/период) гейтит `daily_report.generate` (руководство читает то, что выпускает; `daily_report.view` НЕ существует — решение 2026-07-02; `mark_update` держит оператор, не ORGD/OMD). Альт: завести `daily_report.view`.
- **Д3 (period cap):** разумный предел длины периода (напр. ≤ 62 дня) + валидация `date_from<=date_to`; за пределом → 400 VALIDATION_ERROR.
- **Д4 (async):** sync [дефолт по замеру 6.6]; флип только числом.
- **Д5 (период-ответ):** JSON-коллекция per-date метаданных/страниц (read-only), НЕ бинарный файл; экспорт-файл периода (склейка docx/pdf) — при необходимости отдельная стори/6.4-форматы, не блокер FR-17-минимума.

### Границы (что 6.10a НЕ делает)

- **«На завтра»-блокировка, TOMORROW_BLOCKED, POST override, `daily_report.override_block`, date-валидация блока/override, фильтр протухших id → 6.10b.**
- **Скачивание байт-файла (X-Accel) + DOCUMENT_DOWNLOADED → 6.7** (готово; 6.10a отдаёт attachment_id, качает 6.7).
- **Multi-date нумерованный документ** (Решение Q2 = read-only per-date без номера).
- **Фронт (экраны расхода) → E10; кодоген типов → E8/E10.**
- **Новые аудит-события** — нет (issue/download в реестре).

### References

- [Source: epics.md стр. 891-900 (6.10 AC + блокквота Bratan L900); FR-17 стр. 50, FR-18 стр. 51; AC-3 стр. 898]
- [Source: architecture.md :445-454 Layer Contract; :433-435 §Format/DomainError; :410-412 API-нейминг; :291 ARCH-DATA-021; :773 ARCH-DEFERRED-048; :467 X-Accel; :469 Admin-гвард; :33-34 молчание=СТОП]
- [Source: Backend/VAPS/apps/operations/submissions/services/document_release_service.py:36,153,182,202,230,263 — issue_expense_document single-date + guards]
- [Source: Backend/VAPS/apps/documents/models.py:73,140,208,239 (IssuedDocument/DocumentSequence/индексы); apps/documents/selectors.py:33 (current_issued)]
- [Source: Backend/VAPS/apps/operations/submissions/api/{views,serializers}.py — 5.8 read-API каркас (RequirePermissionMixin/ensure_division_scope/пагинация/фильтр/visible_division_ids)]
- [Source: Backend/VAPS/apps/operations/submissions/services/snapshot.py:36; expense_document.py:44; statuses/services/strength_report.py:260 — per-date сборка]
- [Source: docs/registries/error-codes.yaml:138,168,272,278 (+ REPORT_NO_DATA_FOR_DATE добавить); seed_operations.py:16 (daily_report.generate)]

### Открытые вопросы (для Bratan — дефолты активны)

- **Q1 (mount):** `submissions/api` [Д1] vs новый `operations/reports`-app (арх-намерение)?
- **Q2 (read-permission):** `daily_report.generate` для чтения [Д2] vs новый `daily_report.view`?
- **Q3 (период-экспорт):** JSON per-date коллекция [Д5] — достаточно для FR-17-минимума, или нужен склеенный файл периода (docx/pdf) уже в 6.10a?

### Процессный гейт

- ⚠️ 6.3/6.5/6.9 были в cross-model гейте AI-4; 6.10a вводит HTTP-поверхность выпуска — ревьюить внимательно (по возможности cross-model). Fresh-context валидация спеки после написания.
- `make gate` из `Backend/VAPS` (Postgres :5433). Посев с обязательным `DivisionHistoricalSlot`.

## Dev Agent Record

### Agent Model Used

claude-opus-4-8 (Opus 4.8) — create-story + fresh-context валидация + dev-story (TDD)

### Debug Log References

- **make gate зелёный:** 2171 passed (+37: 10 API-тестов + параметризованные RBAC/audit-матрицы по 2 новым роутам), 56 deselected, `makemigrations --check` «No changes detected» (моделей НЕ добавляли — реюз IssuedDocument), schema-drift ок (schema.yaml регенерирован `make schema`), ruff чист (`ruff format` по тесту), 43s.
- Fresh-context валидация применена: E2 (scope через `ensure_division_scope` во VIEW, не в сервис — 5.4b-хук зовёт сервисы без HTTP-actor), C3 (2 строки RBAC-матрицы: `ops-expense-report-list` get+post=generate, `-period` get=generate), + строка AUDIT_MATRIX `ops-expense-report-list`=_Audited (POST-выпуск эмитит DOCUMENT_ISSUED).

### Completion Notes List

- **Task 1 (POST-выпуск) — DONE.** `ExpenseReportViewSet(RequirePermissionMixin, viewsets.ViewSet)` в `submissions/api/views.py`; `create` → `ExpenseReportIssueSerializer` (форма) → `ensure_division_scope(actor, daily_report.generate, division_id)` → `assert_report_date_has_data` (422 до issue) → `issue_expense_document` → 201 `IssuedExpenseReportSerializer`. Роут `ops-expense-report` в `operations/api/urls.py`. `@extend_schema` не добавлял (spectacular warnings не фейлят; schema.yaml регенерирован).
- **Task 2 (GET по дате) — DONE.** `list` action: `ExpenseReportByDateFilterSerializer` → scope → `IssuedDocumentSelector.current_issued` → 200 или 404 ENTITY_NOT_FOUND.
- **Task 3 (GET период + date-before-data) — DONE.** `period` action (`@action detail=False GET`): `ExpensePeriodFilterSerializer` → scope → `derive_period` (новый `expense_read_service.py`): per-date `StrengthReportService.compute` → JSON-страницы, БЕЗ номера/записи (Q2 read-only); range/length-валидация (400); `assert_report_date_has_data` per-date (422 REPORT_NO_DATA_FOR_DATE). Дом date-before-data пробы: глобально `not roster_on(date) and not overlapping_on(date)` (roster с fallback дат-нечувствителен на пилоте → пробирается через изоляцию: подразделение без сотрудников/статусов → 422).
- **Task 4 (реестр + RBAC) — DONE.** `REPORT_NO_DATA_FOR_DATE` (422 business_hard) в `error-codes.yaml`; RBAC-матрица 2.9 (2 строки); аудит-события НЕ добавляли (DOCUMENT_ISSUED/SUPERSEDED эмитит 6.5).
- **Task 5 (async-замер) — DONE (по рассуждению).** ARCH-DEFERRED-048-триггер = «многостраничный docx-РЕНДЕР». 6.10a period НЕ рендерит docx — возвращает JSON-числа (N× чистый `compute`, мс/дата); суточный docx-выпуск = 1 документ (~22мс, замер 6.6). Порог 2с не достигается → sync (флип НЕ нужен). Формальный бенчмарк не гонял (рендер-путь не активируется); триггер остаётся при появлении многостраничного docx-экспорта периода (Д5-альт).
- **Task 6 (тесты + гейт) — DONE.** 10 тестов `test_expense_report_api.py` (issue happy 201/403-no-perm/403-foreign-scope/422-before-data; get-by-date 200/404; period 3-страницы/422-before-data/400-inverted/400-too-long). Посев зеркалит `test_document_release.py` (DivisionHistoricalSlot обязателен) + RBAC через `seed_operations`+`UserRole`(ORGD)+APIClient(X-User-Id). Гейт зелёный, границы соблюдены.
- **Границы:** «на завтра»/TOMORROW_BLOCKED/override → 6.10b; скачивание X-Accel → 6.7; фронт → E10. Новых моделей/миграций нет.
- **Осталось (Q1/Q2/Q3 дефолты активны):** mount=submissions/api; read-perm=generate; период=JSON per-date. ⚠️ ревью cross-model (HTTP-выпуск-поверхность).

### File List

- `Backend/VAPS/apps/operations/submissions/services/expense_read_service.py` (создан — assert_report_date_has_data + derive_period)
- `Backend/VAPS/apps/operations/submissions/services/__init__.py` (изменён — +экспорты)
- `Backend/VAPS/apps/operations/submissions/api/serializers.py` (изменён — +4 сериализатора расхода)
- `Backend/VAPS/apps/operations/submissions/api/views.py` (изменён — +ExpenseReportViewSet)
- `Backend/VAPS/apps/operations/api/urls.py` (изменён — +expense-reports роут)
- `Backend/VAPS/apps/operations/submissions/tests/test_expense_report_api.py` (создан — 10 тестов)
- `Backend/VAPS/apps/operations/tests/test_rbac_matrix.py` (изменён — +2 строки)
- `Backend/VAPS/apps/audit/tests/test_audit_coverage.py` (изменён — +1 строка AUDIT_MATRIX)
- `Backend/VAPS/docs/registries/error-codes.yaml` → фактически `docs/registries/error-codes.yaml` (изменён — +REPORT_NO_DATA_FOR_DATE)
- `Backend/VAPS/schema.yaml` (регенерирован — новые эндпоинты)
