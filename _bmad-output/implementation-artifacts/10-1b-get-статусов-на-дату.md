---
baseline_commit: a928465
---

# Story 10.1b: GET статусов на дату (преднабор «вчера»)

Status: done

## Story

As a **оператор управления**,
I want **GET-эндпоинт `/api/operations/statuses/on-date/?division_id=&business_date=`, возвращающий живые статусы сотрудников подразделения на дату**,
so that **грид массового обновления (10.2) может преднабрать «вчера» реальными данными вместо пустого экрана с плейсхолдером «Преднабор со вчера недоступен»**.

## Acceptance Criteria

Источник: `sprint-status.yaml:328` (вторая половина AI-4 ретро E9); `frontend/src/features/daily-grid/DailyUpdatePage.tsx:152` (`yesterday` state, комментарий "10.1b инициализирует её из query"); `apps/operations/statuses/api/views.py` (`StatusViewSet`, комментарий "GET-загрузка «вчера» — 10.1b").

1. **AC-1 (happy path → 200 + список).** Given держатель `status.view` со scope, покрывающим подразделение, GET `?division_id=<D>&business_date=<дата>`, When вызываю, Then **200**, тело — список `{employee_id, status_type_code, date_start, date_end}` для всех живых (`cancelled_at IS NULL`, интервал покрывает дату) статусов сотрудников `division_id` на дату. Сотрудники без статуса на дату в ответе не появляются (пустая строка = «В строю», клиент трактует отсутствие как дефолт).
2. **AC-2 (чужой scope → 403).** Given держатель `status.view` БЕЗ scope на `division_id`, Then **403** `PERMISSION_DENIED`, тело пустое (не течёт список чужого подразделения).
3. **AC-3 (несуществующее подразделение → 404).** Given валидный UUID, не существующий как `Division`, Then **404** `ENTITY_NOT_FOUND` (гейт ПОСЛЕ scope-проверки — паттерн `_ensure_division_exists`, submissions 6.10a: scoped-чужак получает 403 первым, не oracle существования).
4. **AC-4 (структурная валидация → 400).** Отсутствующий `division_id`/`business_date`, невалидный UUID/дата → **400** `VALIDATION_ERROR`.
5. **AC-5 (грубый гейт права → 403 ДО вьюхи).** Актор без `status.view` (например, только `status.manage` без view — если такое разделение существует в seed) или аноним → **403** на `RequirePermissionMixin`, вьюха не вызывается.
6. **AC-6 (безскоуповый грант → все подразделения проходят).** Global/wildcard-грант `status.view` — любой `division_id` проходит scope-гейт (тот же контракт, что `ensure_division_scope`/submissions).
7. **AC-7 (схема регенерирована + нет дрейфа).** `schema.yaml` содержит `GET /api/operations/statuses/on-date/`; `test_schema_drift.py` зелёный; `frontend/src/shared/api/schema.d.ts` перегенерирован и содержит роут.
8. **AC-8 (RBAC-матрица покрывает роут).** Новая строка `MATRIX["ops-status-on-date"] = _MethodGate({"get": "status.view"})`; completeness-тесты зелёные.
9. **AC-9 (регресс нулевой).** `StatusViewSet`'s существующий `bulk`-action, вся статус-инфраструктура (3.7/3.8/6.9) — без правок логики. `make gate` зелёный.

## Tasks / Subtasks

- [x] Task 1 — Query-сериализатор (`apps/operations/statuses/api/serializers.py`, MOD) (AC: 4)
  - [x] `StatusOnDateQuerySerializer(serializers.Serializer)`: `division_id=UUIDField()`, `business_date=DateField()` — оба обязательны (нет `required=False`: без даты/подразделения запрос не имеет смысла, явный 400 лучше молчаливого "весь список").
- [x] Task 2 — GET-экшен на существующем `StatusViewSet` (`apps/operations/statuses/api/views.py`, MOD) (AC: 1, 2, 3, 5, 6)
  - [x] `http_method_names` расширяется до `["get", "post", "options"]`.
  - [x] `permission_map["on_date"] = "status.view"`.
  - [x] `@action(detail=False, methods=["get"], url_path="on-date", url_name="on-date") def on_date(self, request)`: валидирует query → `ensure_division_scope(request.actor_id, "status.view", division_id)` → `_ensure_division_exists(division_id)` (порядок: scope сначала, existence — потом, паттерн 6.10a) → резолвит `employee_id`-список подразделения на дату (через `apps.core.selectors` — сотрудники подразделения; ARCH-003, не прямой `Employee.objects`) → `EmployeeStatusSelector.overlapping_on(business_date, employee_ids)` (готовый селектор, `apps/operations/statuses/selectors.py:39`) → сериализует список.
  - [x] `StatusOnDateResponseSerializer` — плоская проекция (`employee_id`, `status_type_code`, `date_start`, `date_end`) прямо из `.values()`-словарей селектора (не ORM-объекты — `overlapping_on` уже возвращает dict-строки).
  - [x] `@extend_schema` с `parameters=[OpenApiParameter(...)]` для query-параметров (GET без body — spectacular требует явных `parameters`, не `request=`).
- [x] Task 3 — RBAC-матрица (AC: 5, 8)
  - [x] `test_rbac_matrix.py` (MOD): `MATRIX["ops-status-on-date"] = _MethodGate({"get": "status.view"})`.
- [x] Task 4 — Регенерация схемы (AC: 7)
  - [x] `make schema` (бэк) + `npm run generate:api` (фронт); оба артефакта в File List.
- [x] Task 5 — Тесты (`apps/operations/statuses/tests/test_status_on_date_api.py`, NEW) (AC: 1-6, 9)
  - [x] AC-1: 200, список совпадает с прямым запросом `EmployeeStatus` на дату; сотрудник без статуса отсутствует в ответе.
  - [x] AC-2: держатель со scope на ДРУГОЕ подразделение → 403, пустое тело (не течёт).
  - [x] AC-3: несуществующий division_id (валидный UUID) → 404, ПОСЛЕ прохождения scope (не 404-oracle для чужака — держатель БЕЗ scope на фантомный division_id получает 403, не 404).
  - [x] AC-4: без `division_id`/`business_date` → 400; невалидный UUID/дата → 400.
  - [x] AC-5: аноним → 403; держатель без `status.view` → 403.
  - [x] AC-6: безскоуповый грант → любое подразделение проходит.
- [x] Task 6 — Гейт обеих сторон (AC: 7, 9)
  - [x] `make gate` (Postgres :5434, из `Backend/VAPS`); `cd frontend && npm run gate`.

## Dev Notes

- **Порядок scope→existence — намеренно, не порядок валидации.** Копирует решение 6.10a/submissions (`_ensure_division_exists` вызывается ПОСЛЕ `ensure_division_scope`): держатель без scope на фантомный ID получает 403 (не превращать 404 в oracle существования для чужаков).
- **`EmployeeStatusSelector.overlapping_on()` — уже существующий, готовый селектор** (`apps/operations/statuses/selectors.py:39`), используемый strength_report/snapshot. Эта стори НЕ добавляет новую бизнес-логику подсчёта — только HTTP-поверхность поверх существующего чтения.
- **Employee-список подразделения** — резолвить через существующий core-селектор (не `Employee.objects.filter` напрямую из `operations`, ARCH-003) — свериться, какой селектор уже отдаёт employee_id-список по division_id (вероятно `CoreEmployeeSelector` или аналог, использованный в `bulk_status_service`/`strength_report`).
- **Разделение от 10-1b2** (справочник статус-типов) — намеренное: разные вьюхи/сериализаторы/consumers (частный список статусов сотрудника vs справочник типов), объединение было бы "несколько эндпоинтов в одной стори" (нарушение decomposition-правил CLAUDE.md).
- **GET, не мутирует** — НЕ добавляется в `AUDIT_MATRIX` (аудит покрывает только мутирующие роуты, прецедент: `StatusViewSet.bulk` — единственный мутирующий экшен, `on_date` — read).

### References

- [Source: _bmad-output/implementation-artifacts/10-1a-rest-bulk-роут-статусов.md] — паттерн тонкой вьюхи, RBAC-матрица, schema-регенерация (эталон этой стори).
- [Source: Backend/VAPS/apps/operations/statuses/selectors.py:28-56] — `EmployeeStatusSelector.overlapping_on`.
- [Source: Backend/VAPS/apps/operations/submissions/api/views.py:105-120] — `_ensure_division_exists`, порядок scope→existence.
- [Source: Backend/VAPS/apps/operations/submissions/services/scope_gate.py] — `ensure_division_scope`.
- [Source: frontend/src/features/daily-grid/DailyUpdatePage.tsx:152] — точка подключения (`yesterday` state).

## Dev Agent Record

### Agent Model Used

claude-sonnet-5

### Debug Log References

### Completion Notes List

- `_ensure_division_scope`/`_ensure_division_exists` — СВОИ локальные копии submissions-паттерна (не импорт `submissions.services.scope_gate.ensure_division_scope`): `apps.operations.statuses` не имеет права импортировать `apps.operations.submissions` (architecture.md#L587, гвард `test_statuses_does_not_import_submissions`) — ловлено самим гвардом на первой попытке импорта, исправлено сразу.
- Employee-состав подразделения на дату — через `HistoricalEmployeeSelector.roster_on()` (канон date-versioned ростера, ARCH-DATA-025), не `working_by_division`/сырой `Employee.objects.filter` — согласовано с прецедентом Story 7.9 (migration_legacy roster export).
- 3-слойное ревью (Blind Hunter / Edge Case Hunter / Acceptance Auditor) не нашло реальных багов; единственный применённый патч — защитный blank-guard в `_ensure_division_scope` (Edge Case Hunter, Low): текущий вызывающий код не может передать пустой `division_id` (DRF UUIDField отклоняет раньше), но это модуль-локальный helper общего назначения — guard добавлен на случай будущего вызывающего с опциональным параметром.
- Остальные находки (2) — задокументированы как defer в deferred-work.md: pagination-отсутствие (не проблема на масштабе пилота) и `roster_on`-семантика (уволенный сотрудник с незакрытым живым статусом молча пропадает из ответа — согласовано с существующим контрактом `roster_on`, не новый разрыв).
- Схема регенерирована обеими сторонами (`schema.yaml`+`schema.d.ts`); `node_modules` фронта пришлось установить заново в этом worktree (`npm install`) — не было установлено.
- Полный регресс: `apps/operations/` (1787 passed, 3 pre-existing concurrency-teardown ERROR — задокументированы в памяти, не регрессия), `test_schema_drift`/`test_isolation` зелёные; фронт `npm run gate` — 866 vitest passed, build, size-gate 208.9KB/300 — зелёный.

### File List

- `Backend/VAPS/apps/operations/statuses/api/serializers.py` (modified — `StatusOnDateQuerySerializer`, `StatusOnDateRowSerializer`)
- `Backend/VAPS/apps/operations/statuses/api/views.py` (modified — `on_date` action, `_ensure_division_scope`, `_ensure_division_exists`)
- `Backend/VAPS/apps/operations/statuses/tests/test_status_on_date_api.py` (new, 11 тестов)
- `Backend/VAPS/apps/operations/tests/test_rbac_matrix.py` (modified — `ops-status-on-date` строка)
- `Backend/VAPS/schema.yaml` (regenerated — `GET /api/operations/statuses/on-date/`)
- `frontend/src/shared/api/schema.d.ts` (regenerated)
