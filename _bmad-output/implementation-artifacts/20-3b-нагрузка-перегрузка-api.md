---
baseline_commit: 22a9fad7
---

# Story 20.3b: Дашборд нагрузки/перегрузки — API-эндпоинт

Status: done

## Story

As a **держатель права `status.view`**,
I want **получить дни перегрузки для всех сотрудников управления по HTTP за один вызов**,
so that **будущий экран дашборда (20.3c+) сможет отобразить, кто перегружен, без прямого доступа к селектору и без N+1 по сотрудникам**.

## Scope Decision — ПРОЧИТАТЬ ПЕРВЫМ (новый субдомен, новая HTTP-поверхность)

**Отличие от 20.1b/20.2b**: `apps/operations/load/` — субдомен БЕЗ единой HTTP-поверхности (`api/`-папки не существует). Эта стори НЕ копирует существующий `@action` — создаёт новый `api/`-модуль с нуля, структурно зеркалящий уже существующие в проекте паттерны (`TrafficLightViewSet` — ближайший прецедент: GET-only `RequirePermissionMixin`-viewset, division-scope, никакой мутации).

- **Разбор 20.3a's явного out-of-scope**: «API/эндпоинт HTTP-слоя (20.3b)» + «Построение ростера/списка `employee_ids` — переиспользует `HistoricalEmployeeSelector.roster_on()`, не строится заново». Эта стори: (1) резолвит ростер управления через `HistoricalEmployeeSelector.roster_on(business_date=date_to, division_ids=[division_id])` (`apps/core/selectors.py:493`, УЖЕ существует), (2) передаёт полученный список `employee_ids` в `compute_overload_summary()` (20.3a, УЖЕ существует и протестирован). НИ ОДНА строка селекторной логики не меняется.
- **Новый `OverloadViewSet(RequirePermissionMixin, viewsets.ViewSet)`** в `apps/operations/load/api/views.py` — ОДИН GET-экшен `summary` (`url_path="summary"`), зарегистрирован в `apps/operations/api/urls.py`'s общем роутере: `router.register("load", OverloadViewSet, basename="ops-load")` → `GET /api/operations/load/summary/`.
- **Гейт — `status.view`** (не изобретается новый код; `status.view` — установленный код для чтения статус-подобных данных, тот же, что `TrafficLightViewSet`/`StatusViewSet`'s `on_date`-экшен использует для чтения). `event.manage` (упомянутый в 20.3a's докстринге "As a") НЕ используется — эта стори про ЧТЕНИЕ статусной/нагрузочной проекции, не про управление ОМ.
- **СВОЙ локальный `_ensure_division_scope`, НЕ импорт из `submissions.services.scope_gate`** — структурный прецедент `apps/operations/statuses/api/views.py`'s `_ensure_division_scope` (ARCH-003-подобная предосторожность: architecture.md's субдоменная цепочка `statuses ← submissions ← reports` явно запрещает `statuses → submissions`; `load` НЕ входит в эту цепочку и формального AST-гварда против него нет, но кросс-субдоменный импорт «просто потому что рядом лежит» — тот же класс god-импорта, которого проект избегает («Запрещено:... кросс-субдоменная оркестрация — только именованный оркестратор»). Маленькая локальная копия — безопаснее, дешевле, ничего не ломает при будущем ARCH-гварде.
- **Query-параметры**: `division_id` (UUID, обязателен), `date_from`/`date_to` (обе обязательны), `threshold_hours` (опционален, `Decimal`, дефолт `8` — зеркалит `compute_overload_summary()`'s дефолт).
- **Границы дат — урок 20.2b's ревью, применённый ПРЕВЕНТИВНО (не ждать повторной находки)**: инвертированный диапазон (`date_from > date_to`) → 400; диапазон длиннее `_MAX_RANGE_DAYS = 62` (тот же лимит, что `ExpensePeriodFilterSerializer`'s `MAX_PERIOD_DAYS`, локальная копия константы, не импорт) → 400. **Будущая дата НЕ блокируется** — сознательное отличие от 20.2b: `compute_fact_load_bulk()` читает СЫРЫЕ факты (`PlacementAssignmentActual`), а не проецирует «сегодняшний штат» на дату вычислением (как `StrengthReportService`) — будущая дата естественно даёт пустой результат (фактов ещё нет), это ЧЕСТНОЕ поведение, не фабрикация. Блокировка была бы искусственным ограничением без причины.
- **Ответ**: `{"division_id": <uuid>, "date_from": <date>, "date_to": <date>, "threshold_hours": <int>, "employees": [{"employee_id": <uuid>, "overload_days": [<date>, ...]}]}` — список (не dict-keyed-by-UUID — JSON не поддерживает non-string-ключи нативно; тот же принцип, что 20.2b's `laggards`/`rows`).
- **Out of scope**: экран дашборда (20.3c+); roll-up по подразделению (счётчик «N перегруженных», явный out-of-scope 20.3a); bulk по НЕСКОЛЬКИМ управлениям за один вызов (эта стори — один `division_id`, тот же паттерн единичного корня, что `TrafficLightViewSet.division`); изменение `compute_overload_summary()`/`compute_fact_load_bulk()`/`detect_overload_days()`.

## Acceptance Criteria

1. **AC-1.** `GET /api/operations/load/summary/?division_id=<uuid>&date_from=<date>&date_to=<date>` с правом `status.view` и валидным scope → 200, тело содержит `employees` — список `{employee_id, overload_days}` для КАЖДОГО сотрудника ростера управления на `date_to` (пустой `overload_days`, если сотрудник не перегружен).
2. **AC-2.** Без права `status.view` → 403 `PERMISSION_DENIED`.
3. **AC-3.** Держатель `status.view`, но scope НЕ покрывает запрошенный `division_id` → 403 (тот же паттерн, что `TrafficLightViewSet`/`statuses`'s `_ensure_division_scope`).
4. **AC-4.** Несуществующий `division_id` → 404.
5. **AC-5.** Отсутствующий `division_id`/`date_from`/`date_to` → 400 `VALIDATION_ERROR`.
6. **AC-6.** `date_from > date_to` (инвертированный диапазон) → 400.
7. **AC-7.** Диапазон длиннее 62 дней → 400.
8. **AC-8.** Кастомный `threshold_hours` в query — пробрасывается в `compute_overload_summary()` без изменений, влияет на `overload_days` идентично прямому вызову селектора.
9. **AC-9.** Будущий `date_to` (сотрудник ещё не работал в этот период) → 200 с пустыми `overload_days` (НЕ 400/422 — честно пусто, не блокируется).
10. **AC-10.** `make gate` (Backend/VAPS) зелёный.

## Out of Scope

- Экран дашборда (20.3c+).
- Roll-up по подразделению (счётчик «N перегруженных на управление»).
- Bulk по нескольким `division_id` за один вызов.
- Изменение `compute_overload_summary()`/`compute_fact_load_bulk()`/`detect_overload_days()`.

## Tasks / Subtasks

- [x] Task 1 — `apps/operations/load/api/serializers.py` (новый файл): `OverloadSummaryFilterSerializer` (`division_id`, `date_from`, `date_to`, `threshold_hours` — опциональный `DecimalField`, дефолт `8`).
- [x] Task 2 — `apps/operations/load/api/views.py` (новый файл): `OverloadViewSet(RequirePermissionMixin, viewsets.ViewSet)` — `summary` GET-экшен; локальный `_ensure_division_scope`/`_ensure_division_exists` (структурный образец `statuses/api/views.py`); резолв ростера через `HistoricalEmployeeSelector.roster_on()`; вызов `compute_overload_summary()`; сборка ответа.
- [x] Task 3 — `apps/operations/api/urls.py`: `router.register("load", OverloadViewSet, basename="ops-load")`.
- [x] Task 4 — Тесты (AC 1-9): `apps/operations/load/tests/test_overload_api.py`.
- [x] Task 5 — `make gate` (Backend/VAPS) — включая `test_rbac_matrix.py::test_matrix_covers_every_registered_route` (новый роут → строка в MATRIX) и `make schema` (регенерация `schema.yaml`).

### Review Findings

- [x] [Review][Patch] `threshold_hours` без `min_value` — ноль/отрицательное значение флагует ЛЮБОЙ день с активностью как перегрузку [Backend/VAPS/apps/operations/load/api/serializers.py:15]
- [x] [Review][Defer] `roster_on()` не разворачивает поддерево — зеркалит установленный прецедент `StatusViewSet.on_date` [Backend/VAPS/apps/operations/load/api/views.py:137] — deferred, не новый разрыв
- [x] [Review][Defer] Неупорядоченный `employees`-список — deferred, established convention (тот же класс, что 20.2b's `rows`)
- [x] [Review][Defer] Нет rate-limiting на per-division агрегацию — deferred, тот же класс, что уже зафиксирован для 20.2b

## Dev Notes

- `apps/operations/statuses/api/views.py` — СТРУКТУРНЫЙ ОБРАЗЕЦ ЦЕЛОГО ФАЙЛА: `RequirePermissionMixin`-viewset, `http_method_names = ["get", "options"]` (read-only, тот же паттерн, что `TrafficLightViewSet`), локальный `_ensure_division_scope` (копировать буквально, включая ревью-фикс «guard пустого/None division_id» — уже встроен в оригинал), `CoreDivisionTreeSelector`-based `_ensure_division_exists` (образец в `submissions/api/views.py:113-127`, но копировать ЛОКАЛЬНО, не импортировать — тот же принцип изоляции).
- `apps/core/selectors.py:493` (`HistoricalEmployeeSelector.roster_on(business_date, division_ids=None)`) → `Dict[division_id, List[employee_id]]`. Вызов: `roster = HistoricalEmployeeSelector.roster_on(business_date=date_to, division_ids=[division_id]); employee_ids = roster.get(division_id, [])`. Дата ростера — `date_to` (конец периода, «кто сейчас/на конец периода в управлении» — самый актуальный список для дашборда «кто перегружен СЕЙЧАС»).
- `apps/operations/load/selectors.py:220-233` (`compute_overload_summary`, 20.3a) — `Dict[UUID, List[date]]`, ПУСТОЙ список для каждого переданного `employee_id`. Пустой `employee_ids=[]` (управление без сотрудников на `date_to`) → пустой `dict` без запроса (уже гарантировано 20.3a's AC-5) — эндпоинт в этом случае просто возвращает `{"employees": []}`, не ошибку.
- `apps/operations/submissions/api/serializers.py:118-123` (`ExpensePeriodFilterSerializer`) — структурный образец `date_from`/`date_to`-валидации (инверсия/длина); `MAX_PERIOD_DAYS = 62` (`expense_read_service.py:28`) — значение скопировать в локальную константу `_MAX_RANGE_DAYS`, НЕ импортировать (та же изоляция, что `_ensure_division_scope`).
- `apps/operations/api/urls.py` — единый роутер для ВСЕХ `apps.operations.*`-viewset'ов (не per-app `urls.py`), импорт `OverloadViewSet` добавляется в существующий блок импортов из `apps.operations.load.api.views`.
- Тесты: структурный образец фикстур — `apps/operations/load/tests/test_overload_summary.py` (20.3a's юнит-тесты селектора, `make_object`/`make_event`/`make_assignment`/`make_actual`) + `apps/operations/submissions/tests/test_expense_report_api.py`/`test_expense_dashboard_api.py` (20.2b) для HTTP-слоя (APIClient/`X-User-Id`/UserRole-грант паттерн).
- **AC-9 (будущая дата НЕ блокируется) — намеренное отличие от 20.2b**: не копировать 20.2b's `assert_report_date_has_data()`/future-date-guard бездумно. `compute_fact_load_bulk()` читает `PlacementAssignmentActual` (сырые факты, не проекцию) — будущая дата без фактов даёт честный пустой результат по конструкции, блокировка была бы неоправданным ограничением. Обосновать это явно в коде/тесте, не полагаться на «на всякий случай скопировал гард».

### References

- [Source: _bmad-output/implementation-artifacts/20-3a-нагрузка-перегрузка-bulk-селектор.md] — селектор, форма возврата, Out of Scope пункт «API/эндпоинт HTTP-слоя (20.3b)».
- [Source: _bmad-output/implementation-artifacts/20-2b-расход-отстающие-api.md] — прецедент, ревью-урок про границы дат (применён здесь превентивно, с обоснованным исключением для future-date).
- [Source: Backend/VAPS/apps/operations/statuses/api/views.py] — структурный образец read-only viewset с локальным scope-гардом.
- [Source: Backend/VAPS/apps/core/selectors.py] — `HistoricalEmployeeSelector.roster_on()`.
- [Source: _bmad-output/planning-artifacts/architecture.md#L587] — субдоменная цепочка `statuses ← submissions ← reports`, обоснование локальной копии вместо импорта.

## Dev Agent Record

### Agent Model Used

Claude Sonnet 5

### Debug Log References

- Первый прогон `test_summary_nonexistent_division_404` упал 403 вместо 404 — division-scoped грант («viewer» на конкретное `div`) не покрывает случайный phantom UUID, scope-гард срабатывает раньше existence-гарда (тот же канон, что 6.10a). Исправлен тест — org-wide грант (`scope_division_id=None`) для этого конкретного случая.
- Ожидаемо (урок 20.1b/20.2b): первый `make gate` дал 2 сбоя от нового роута — `test_matrix_covers_every_registered_route` (MATRIX-строка `"ops-load-summary"`) и `test_schema_yaml_matches_fresh_generation` (`make schema`). Оба исправлены.

### Completion Notes List

Реализовано по AC 1-10. Новый субдомен `apps/operations/load/api/` — `OverloadSummaryFilterSerializer` + `OverloadViewSet.summary` GET-экшен, структурный образец `statuses/api/views.py`'s `on_date` (roster_on()+scope+existence). Локальный `_ensure_division_scope`/`_ensure_division_exists`/`_MAX_RANGE_DAYS` — НЕ импорт из `submissions` (та же ARCH-003-предосторожность, что statuses). Роут зарегистрирован в общем `apps/operations/api/urls.py`. Границы дат (инверсия/>62д) применены превентивно (урок 20.2b), но БЕЗ future-date-блокировки — обосновано явно (факт, не проекция, честно пуст на будущей дате). 10 тестов (AC 1-9, включая happy-path с реальной 4-дневной серией перегрузки через `PlacementAssignmentActual`-фикстуры). `make gate` (Backend/VAPS) после патчей RBAC MATRIX + `make schema` — 4401 passed, 0 regressions, makemigrations «No changes detected».

### File List

- `Backend/VAPS/apps/operations/load/api/__init__.py` (new)
- `Backend/VAPS/apps/operations/load/api/serializers.py` (new — `OverloadSummaryFilterSerializer`)
- `Backend/VAPS/apps/operations/load/api/views.py` (new — `OverloadViewSet`)
- `Backend/VAPS/apps/operations/api/urls.py` (modified — роут `ops-load`)
- `Backend/VAPS/apps/operations/load/tests/test_overload_api.py` (new)
- `Backend/VAPS/apps/operations/tests/test_rbac_matrix.py` (modified — MATRIX entry)
- `Backend/VAPS/schema.yaml` (regenerated — `make schema`)

## Change Log

| Дата | Изменение |
|---|---|
| 2026-08-06 | Story создана (create-story). Закрывает 20.3a's явный out-of-scope «API/эндпоинт HTTP-слоя» — новый субдомен `apps/operations/load/api/` с нуля (не копия существующего action), структурный образец `statuses/api/views.py`. Ревью-урок 20.2b (границы дат) применён превентивно, с обоснованным исключением для future-date (факт, не проекция). |
| 2026-08-06 | Dev-story: `OverloadViewSet.summary` + сериализатор + роут + 10 тестов. Обновлены RBAC MATRIX и `schema.yaml`. `make gate` (Backend/VAPS) — 4401 passed, 0 regressions. Status → review. |
| 2026-08-06 | Review закрыт (Blind Hunter + Edge Case Hunter + Acceptance Auditor). Acceptance Auditor: все 10 AC SATISFIED, отсутствие импорта из `submissions` подтверждено grep'ом. Blind Hunter и Edge Case Hunter независимо совпали на реальном пробеле: `threshold_hours` без `min_value` — исправлено (`min_value=Decimal("0.01")` + regression-тест). Edge Case Hunter лично опроверг 2 находки Blind Hunter (str/UUID-риск в `roster.get()` — типобезопасно; избыточная точность `threshold_hours` — DRF корректно отклоняет). 3 findings → deferred-work.md (отсутствие subtree-расширения ростера — зеркалит установленный прецедент `StatusViewSet.on_date`, не новый разрыв; неупорядоченный `employees`-список и отсутствие rate-limiting — established convention/тот же класс, что уже зафиксирован для 20.2b). `make gate` (Backend/VAPS) после патча — 4402 passed, 0 regressions, makemigrations «No changes detected». Status → done. |
