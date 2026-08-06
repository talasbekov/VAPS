---
baseline_commit: 452be34d
---

# Story 20.2b: Дашборд расхода и отстающих управлений — API-эндпоинт

Status: done

## Story

As a **держатель права `daily_report.generate`**,
I want **получить расход по всем управлениям И список отстающих ЗА ОДИН HTTP-вызов**,
so that **будущий экран дашборда (20.2c+) не собирает два источника вручную, а селектор (20.2a) становится реально вызываемым, не только Python-функцией**.

## Scope Decision

- **Закрывает 20.2a's явный out-of-scope**: «API/эндпоинт HTTP-слоя (20.2b)». Селектор (`compute_expense_dashboard(business_date)`, `apps/operations/selectors.py`) уже полностью реализован и протестирован — эта стори НЕ трогает его логику, только оборачивает в HTTP.
- **Новый `dashboard` action на СУЩЕСТВУЮЩЕМ `ExpenseReportViewSet`** (`apps/operations/submissions/api/views.py`), НЕ новый viewset/роут — та же логическая область (`/api/operations/expense-reports/dashboard/`), тот же паттерн, что `period`/`journal`/`document` (все — `@action(detail=False, ...)` на этом viewset). Причина держать это на `ExpenseReportViewSet`, а не создавать `apps/operations/api/dashboard_views.py`: `compute_expense_dashboard` — тонкая композиция, где `expense`-часть уже живёт в этом домене (submissions/расход), новый top-level модуль был бы избыточным дроблением ради одного эндпоинта.
- **БЕЗ division-scope гейта** (`ensure_division_scope` НЕ вызывается) — В ОТЛИЧИЕ от `create`/`list`/`period`/`journal`/`document` этого же viewset, которые все per-division. Структурный прецедент — `override_block` action (Story 6.10b): «day-level — без division-scope» (см. его докстринг/description в коде), гейтится ТОЛЬКО через `permission_map`/`RequirePermissionMixin`. `compute_expense_dashboard(business_date)` не принимает `division_id` — она ОРГ-ШИРОКАЯ по конструкции (20.2a's Scope Decision: «`division_id=None` → расход по ВСЕМ управлениям»), copy-paste `ensure_division_scope`-вызова сюда был бы бессмысленным (нет division_id, который можно бы проверить).
- **Гейтится `_EXPENSE_PERMISSION` = `"daily_report.generate"`** — тем же кодом, что весь остальной viewset (нет отдельного «read-only» права для расхода, установленная конвенция «management reads what it issues», Story 6.10a Д2). Новый permission-код НЕ изобретается.
- **`ExpenseDashboardFilterSerializer(business_date: DateField)`** — единственный query-параметр, структурный образец `ExpenseReportByDateFilterSerializer` минус `division_id` (тот единственный из существующих form-сериализаторов этого файла, где `business_date` — ЕДИНСТВЕННОЕ поле).
- **Ответ — composite `Serializer` (НЕ `ModelSerializer`)**, зеркалит `compute_expense_dashboard`'s dict 1:1: `business_date` (DateField), `expense` (вложенный объект — `business_date`/`rows`/`totals`/`violations`/`warnings`, буквально та же форма, что `period` action уже описывает через `inline_serializer` для `rows`/`totals` — переиспользовать ТЕ ЖЕ field-определения, не изобретать новые), `laggards` (list of `{division_id: UUID, name: str}`), `blocked` (Boolean), `overridden` (Boolean).
- **Out of scope**: экран дашборда (20.2c+); экспорт `.docx`/`.xlsx` (FR-40, Story 20.4); тренд/история за прошлые дни; изменение `compute_expense_dashboard`/`StrengthReportService`/`tomorrow_block` (только HTTP-обёртка); пагинация `laggards`/`rows` (оба списка — по числу управлений в организации, не растут неограниченно, тот же неявный контракт, что `period`'s `pages`/`rows` без пагинации).

## Acceptance Criteria

1. **AC-1.** `GET /api/operations/expense-reports/dashboard/?business_date=<date>` с правом `daily_report.generate` → 200, тело содержит `business_date`/`expense`/`laggards`/`blocked`/`overridden`, значения ИДЕНТИЧНЫ прямому вызову `compute_expense_dashboard(business_date)`.
2. **AC-2.** Без права `daily_report.generate` → 403 `PERMISSION_DENIED`.
3. **AC-3.** Отсутствующий `business_date` → 400 `VALIDATION_ERROR` (DRF form-валидация, не 500).
4. **AC-4.** Невалидный формат `business_date` (напр. `not-a-date`) → 400 `VALIDATION_ERROR`.
5. **AC-5.** `laggards` в ответе — список `{"division_id": <uuid>, "name": <str>}`, ТЕ ЖЕ записи (после stale-фильтра), что вернул бы прямой вызов селектора.
6. **AC-6.** Эндпоинт НЕ требует `division_id` (org-wide) — вызов держателем права БЕЗ явного division-scope на конкретное управление всё равно возвращает полный дашборд (в отличие от `period`/`journal`, которые 403 без scope).
7. **AC-7.** `make gate` (Backend/VAPS) зелёный.

## Out of Scope

- Экран дашборда (20.2c+).
- Экспорт `.docx`/`.xlsx` (FR-40, Story 20.4).
- Тренд/история за прошлые дни.
- Изменение `compute_expense_dashboard`/`StrengthReportService`/`tomorrow_block`.
- Пагинация `laggards`/`rows`.

## Tasks / Subtasks

- [x] Task 1 — `apps/operations/submissions/api/serializers.py`: `ExpenseDashboardFilterSerializer` (query-форма, `business_date` единственное поле).
- [x] Task 2 — `apps/operations/submissions/api/views.py`: `ExpenseReportViewSet.dashboard()` action — `@action(detail=False, methods=["get"], url_path="dashboard")`, permission_map-запись, БЕЗ `ensure_division_scope`.
- [x] Task 3 — Ответ через `inline_serializer`/composite-сериализатор, зеркалящий `compute_expense_dashboard`'s dict (переиспользовать `rows`/`totals`-схему из `period`'s `@extend_schema`).
- [x] Task 4 — Тесты (AC 1-6): `apps/operations/tests/test_expense_dashboard_api.py` (рядом с `apps/operations/tests/test_expense_dashboard.py`, 20.2a's юнит-тесты селектора — этот файл тестирует HTTP-слой отдельно, не дублирует селекторные тесты).
- [x] Task 5 — `make gate` (Backend/VAPS) — включая проверку `test_rbac_matrix.py::test_matrix_covers_every_registered_route` (AR-9, новый роут требует строку в MATRIX, тот же урок, что 20.1b) и `make schema` (регенерация `schema.yaml`).

### Review Findings

- [x] [Review][Patch] `dashboard` не имел ни `assert_report_date_has_data()`, ни гарда «дата не в будущем» — единственный read-экшен этого viewset без обеих проверок [Backend/VAPS/apps/operations/submissions/api/views.py:818]
- [x] [Review][Defer] `{**v, "division_id": str(...)}` предполагает наличие ключа без `.get()` [Backend/VAPS/apps/operations/submissions/api/views.py] — deferred, pre-existing dataclass-контракт 20.2a
- [x] [Review][Defer] `names[d]` без `.get()` — TOCTOU в 20.2a's `compute_expense_dashboard` [Backend/VAPS/apps/operations/selectors.py:45] — deferred, не в этом диффе
- [x] [Review][Defer] `AssertionError` из `derive_report` не маппится в структурированную ошибку — deferred, pre-existing поведение `StrengthReportService`
- [x] [Review][Defer] Нет rate-limiting на org-wide агрегацию — deferred, нет established паттерна в кодовой базе
- [x] [Review][Defer] `daily_report.generate` без division-scope видит весь орг — deferred, намеренное решение Scope Decision

## Dev Notes

- **КРИТИЧНО — обязательные реестры для НОВОГО роута** (урок 20.1b's Debug Log): добавление `@action` на существующий viewset регистрирует НОВЫЙ HTTP-роут — это ломает ДВА гейта, если их не обновить: (1) `apps/operations/tests/test_rbac_matrix.py`'s `MATRIX` (AR-9, `test_matrix_covers_every_registered_route` красный без строки `"ops-expense-report-dashboard": _Gate("daily_report.generate")`, имя может отличаться — свериться с реальным `basename`/`url_name` роутера при первом прогоне теста, НЕ гадать формат); (2) `make schema` — `schema.yaml` дрейфует без регенерации, `test_schema_drift.py` (если существует в этом дереве) красный. Прогнать оба гейта, не только «свой» тест-файл.
- `apps/operations/submissions/api/views.py:560-565` (`override_block` action) — СТРУКТУРНЫЙ ОБРАЗЕЦ «day-level, без division-scope»: `@action(detail=False, methods=["post"], url_path="override-tomorrow-block", url_name="override-tomorrow-block")`, тело гейтится ТОЛЬКО `RequirePermissionMixin`'s `permission_map` (нет `ensure_division_scope`-вызова). Новый `dashboard` — `methods=["get"]` вместо `["post"]`, тот же принцип отсутствия division-scope.
- `apps/operations/submissions/api/views.py:516-540` (`period` action) — СТРУКТУРНЫЙ ОБРАЗЕЦ для формы `@extend_schema`'s `rows`/`totals` inline-полей (`staff_total`/`list_total`/`vacancies`/`attached`/`columns` — буквально та же форма, что `StrengthReportResult`'s `rows: list[DivisionReportRow]`/`totals: ReportTotals`, `apps/operations/statuses/services/strength_report.py:112-138`). `compute_expense_dashboard`'s `expense`-поле — ЭТОТ ЖЕ `StrengthReportResult`, прокинутый как есть (20.2a's AC-1: «идентичен прямому вызову `StrengthReportService.compute()`»)) + добавляются `violations`/`warnings` (список `{division_id, reason, ...}` — см. `apps/operations/statuses/services/strength_report.py:177-199` для точной формы каждого типа находки, оба — plain dict, НЕ dataclass, отразить через `serializers.DictField()`/`serializers.ListField(child=serializers.DictField())`, не расписывать вручную все возможные ключи `reason` — они варьируются).
- `apps/operations/selectors.py` (`compute_expense_dashboard`, 20.2a) — возвращает `Dict` (не dataclass!) с ключами `business_date`/`expense`/`laggards`/`blocked`/`overridden`. `expense` — вложенный `StrengthReportResult` (dataclass, НЕ dict) — сериализатор должен читать атрибуты (`.rows`, `.totals`, ...), не `dict`-ключи, для этого вложенного объекта.
- `apps/operations/submissions/api/serializers.py:110-115` (`ExpenseReportByDateFilterSerializer`) — структурный образец `business_date = serializers.DateField()`; новый `ExpenseDashboardFilterSerializer` — тот же паттерн МИНУС `division_id`.
- `apps/operations/api/permissions.py` (`require_permission`) / `apps/core/api/permissions.py` (`RequirePermissionMixin`) — этот viewset использует `RequirePermissionMixin`'s декларативный `permission_map` (НЕ императивный `require_permission(request, ...)`-вызов внутри метода, как в `events/api/views.py`, разные viewset'ы в проекте используют оба паттерна — сверить, какой из них `RequirePermissionMixin` резолвит ПЕРЕД телом action, чтобы не задваивать гейт).
- Тесты: структурный образец — `apps/operations/submissions/tests/test_expense_api.py`/ближайший API-тест этого viewset (сверить точный файл/паттерн `APIClient` аутентификации перед написанием, тот же урок 20.1b — «не гадать механизм»).

### References

- [Source: _bmad-output/implementation-artifacts/20-2a-расход-отстающие-селектор.md] — селектор, форма возврата, Out of Scope пункт «API/эндпоинт HTTP-слоя (20.2b)».
- [Source: _bmad-output/implementation-artifacts/20-1b-готовность-ом-api.md] — прецедент API-стори над готовым селектором, урок про RBAC MATRIX + schema.yaml реестры.
- [Source: Backend/VAPS/apps/operations/submissions/api/views.py] — `ExpenseReportViewSet`, `period`/`override_block` structural precedents.
- [Source: Backend/VAPS/apps/operations/statuses/services/strength_report.py] — `StrengthReportResult`/`DivisionReportRow`/`ReportTotals` точная форма.

## Dev Agent Record

### Agent Model Used

Claude Sonnet 5

### Debug Log References

- `compute_expense_dashboard()`'s `expense`-поле — `StrengthReportResult` (dataclass), не dict — DRF `Response()` не сериализует dataclass-инстансы автоматически. Исправлено ручной сборкой plain-dict'ов для `rows`/`totals` (тот же приём, что `expense_read_service.py`'s приватный `_serialize_report`, не импортирован напрямую — module-private конвенция, схема продублирована локально во вью).
- Первый прогон `make gate` дал 2 ожидаемых сбоя (тот же урок, что 20.1b): `test_matrix_covers_every_registered_route` (AR-9, новый роут без строки в MATRIX) → добавлена строка `"ops-expense-report-dashboard": _MethodGate({"get": "daily_report.generate"})`; `test_schema_yaml_matches_fresh_generation` → `make schema` перегенерировал `schema.yaml` (диф добавляет только новый эндпоинт).
- Ruff E501 на новом тест-файле (длинные ассерты) → `ruff format` по файлу (не по app-папке, project convention).

### Completion Notes List

Реализовано по AC 1-7. `dashboard` action на существующем `ExpenseReportViewSet` — GET-only, БЕЗ `ensure_division_scope` (org-wide по конструкции 20.2a's селектора), структурный прецедент `override_block`'s «day-level без scope». Гейтится тем же `daily_report.generate`, что весь остальной viewset. `ExpenseDashboardFilterSerializer` — единственное поле `business_date`. Ответ — ручная сборка plain-dict из `compute_expense_dashboard()`'s dataclass-полей (`StrengthReportResult`/`DivisionReportRow`/`ReportTotals`), зеркалит форму, уже описанную `period`'s `@extend_schema`. 7 тестов покрывают AC 1-6 (happy-path/403/400 отсутствующая дата/400 невалидная дата/форма laggard совпадает с селектором/org-wide без scope/значения идентичны прямому вызову селектора). `make gate` (Backend/VAPS) после патчей RBAC MATRIX + `make schema` — 4379 passed, 0 regressions, makemigrations «No changes detected».

### File List

- `Backend/VAPS/apps/operations/submissions/api/serializers.py` (modified — `ExpenseDashboardFilterSerializer`)
- `Backend/VAPS/apps/operations/submissions/api/views.py` (modified — `dashboard` action + import)
- `Backend/VAPS/apps/operations/tests/test_expense_dashboard_api.py` (new)
- `Backend/VAPS/apps/operations/tests/test_rbac_matrix.py` (modified — MATRIX entry)
- `Backend/VAPS/schema.yaml` (regenerated — `make schema`)

## Change Log

| Дата | Изменение |
|---|---|
| 2026-08-06 | Story создана (create-story). Закрывает 20.2a's явный out-of-scope «API/эндпоинт HTTP-слоя» — новый `dashboard`-action на существующем `ExpenseReportViewSet`, БЕЗ division-scope (org-wide по конструкции селектора), структурный прецедент `override_block`'s «day-level без scope». |
| 2026-08-06 | Dev-story: `dashboard` action + сериализатор + 7 тестов. Обновлены RBAC MATRIX и `schema.yaml`. `make gate` (Backend/VAPS) — 4379 passed, 0 regressions. Status → review. |
| 2026-08-06 | Review закрыт (Blind Hunter + Edge Case Hunter + Acceptance Auditor). Acceptance Auditor: все 7 AC SATISFIED. Blind Hunter и Edge Case Hunter независимо совпали на реальном пробеле: `dashboard` — единственный read-экшен `ExpenseReportViewSet` без гардов даты (`assert_report_date_has_data()`/«не в будущем»), в отличие от `period`/`document`/`tree`/`division` — исправлено (оба гарда + 2 теста: `test_dashboard_future_date_400`, `test_dashboard_before_data_422`). `make schema` перегенерирован (описание эндпоинта уточнено). 5 findings → deferred-work.md (KeyError-риски в `violations`/`warnings`/`names[d]` — pre-existing контракты 20.2a, не этого диффа; `AssertionError`-риск — pre-existing поведение `StrengthReportService`; отсутствие rate-limiting и org-wide видимость без scope — намеренные решения спеки). `npm run gate`-эквивалент (`make gate`, Backend/VAPS) после патча — 4381 passed, 0 regressions, makemigrations «No changes detected». Status → done. |
