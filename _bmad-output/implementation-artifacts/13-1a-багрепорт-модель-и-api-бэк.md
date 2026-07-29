---
baseline_commit: 5ac968d
---

# Story 13.1a: Багрепорт — модель и API (бэк)

Status: done

## Story

As a **разработчик**,
I want **модель `BugReport` + `POST /api/bugreports/` (открыт любому аутентифицированному пользователю) + `GET /api/bugreports/` (виден ТОЛЬКО через новый RBAC-код разработчика)**,
so that **бэкенд-половина канала «сообщить о проблеме» существует ДО фронтенд-кнопки (13.1b) — записывает контекст, скрывает отправителя от начальства по построению, не изобретая новый механизм видимости поверх уже существующего RBAC**.

Декомпозиция буквы стори 13.1 (эпик 13, письмо `epics.md#L1348-1353`) на бэк/фронт — по division-of-labor этой сессии (10.5b/10.5c-прецедент: «журнал выпусков (бэк)» → «журнал выпусков (UI)»), CLAUDE.md's ≤5-файлов/одна-ответственность.

## Acceptance Criteria

1. **AC-1 (`BugReport`-модель).** `apps/operations/bugreports/models.py` (NEW app) — наследует `apps.operations.models.TimeStampedModel` (не `core`'s `UUIDTimeStampedModel` — модель живёт в `operations`, зеркалит `rbac/models.py`'s конвенцию, той же кодовой базы). Поля: `user_id` (CharField(100), тот же паттерн, что `UserRole.user_id` — внешний auth id, НЕ FK на `core_employees`), `screen_path` (CharField, `useLocation().pathname`-значение от фронта), `app_version`/`build_sha` (CharField, из фронтового `APP_VERSION`/`BUILD_SHA`), `last_request_ids` (JSONField — список строк, фронт собирает сам, см. Dev Notes — backend НЕ хранит rolling-историю, только то, что прислал клиент), `description` (TextField, что делал/что ожидал/что произошло — свободный текст от оператора).
2. **AC-2 (`POST /api/bugreports/` — открыт любому аутентифицированному, БЕЗ RBAC-гейта на запись).** Кто угодно с валидным внешним JWT может отправить репорт — стоимость репорта ~0 (буква стори). НЕ через `RequirePermissionMixin` на create-действии (это гейтует ЧТЕНИЕ, не запись — см. AC-3).
3. **AC-3 (`GET /api/bugreports/` — видимость через НОВЫЙ RBAC permission-код, не новый механизм).** Один новый `Permission`-код (`bugreports.view`, зеркалит существующие коды в `apps/operations/rbac/models.py::Permission`) — список/детали видны ТОЛЬКО `user_id`, у которого есть активная `UserRole` с этим кодом (стандартный `RequirePermissionMixin`, уже используемый ВЕЗДЕ в проекте — см. `apps/operations/submissions/api/views.py::ExpenseReportViewSet`). Анонимность от начальства — начальство просто НЕ получает этот permission-код (обычные роли его не содержат по умолчанию); отправитель сам НЕ видит чужие репорты (create-only для не-разработчика).
4. **AC-4 (тесты).** Unit: сериализация round-trip. Integration: (а) любой аутентифицированный POST — 201; (б) GET без `bugreports.view` — 403; (в) GET с `bugreports.view` — 200, видит репорт из (а).

## Out of Scope

- Фронтенд-кнопка/форма (13.1b, отдельная стори).
- Rolling-история `request_id` на бэке (буква стори — фронт присылает то, что уже накопил сам, backend не строит новую инфраструктуру трекинга — см. Dev Notes).
- Экспорт диагностики/патч-цикл (13.2/13.3).

## Tasks / Subtasks

- [x] Task 1 — `apps/operations/bugreports/` (NEW app) — модель + миграция (AC: 1)
  - [x] `models.py`: `BugReport(TimeStampedModel)`.
  - [x] Миграция создаёт таблицу (`ops_bug_reports`).
- [x] Task 2 — Новый RBAC permission-код `bugreports.view` (AC: 3)
  - [x] `seed_operations.py` (не отдельная data-миграция — реальный прецедент кодовой базы для Permission/Role-сидинга): `bugreports.view` + новая роль `DEVELOPER` с этим единственным правом.
- [x] Task 3 — API (сериализатор + viewset + urls) (AC: 2, 3)
  - [x] `serializers.py`: `BugReportCreateSerializer` + `BugReportSerializer`.
  - [x] `views.py`: `BugReportViewSet` — БЕЗ `RequirePermissionMixin` (см. Completion Notes — иное решение, чем изначально написано в AC-3, обоснование ниже); `create` проверяет только `actor_id` (аутентификация), `list`/`retrieve` вызывают `require_permission(request, "bugreports.view")` напрямую.
  - [x] `config/urls.py`: новый `api/bugreports/`-контекст (7-й).
- [x] Task 4 — Тесты (AC: 4)
  - [x] `apps/operations/bugreports/tests/test_app.py` (структурный).
  - [x] `apps/operations/bugreports/tests/test_bugreport_api.py` — 5 сценариев (201 без роли / 403 без аутентификации / 403 без bugreports.view / 200 с DEVELOPER / 403 у ORGD-руководства).
- [x] Task 5 — Реальный прогон
  - [x] `make gate` зелёный (2976 passed, было 2875 — +101 от новых RBAC-акторов×роутов в параметризованной матрице + новых тестов).

## Dev Notes

- **«Видимость только разработчику» — НЕ новый механизм, существующий RBAC-код.** Research при create-story изначально предположил, что нужен новый "developer-only"-примитив — неверно: `apps.operations.rbac`'s `Role`/`UserRole`/`RolePermission`/`Permission` уже РЕШАЮТ ровно эту задачу (произвольный permission-код, выданный конкретному `user_id` через `UserRole`, без выдачи обычным ролям). Изобретать новый примитив поверх уже работающего RBAC было бы избыточной абстракцией (CLAUDE.md).
- **`last_request_ids` — клиент присылает, бэк не собирает.** `apps/core/middleware.py`'s `RequestContextMiddleware` (Story 4.3) даёт per-REQUEST `request_id` (эхо в `X-Request-Id`-заголовке), но НЕ rolling-историю по пользователю/сессии — эта стори НЕ строит новую трекинг-инфраструктуру (буква эпика этого не требует, 13.1b с фронта уже накапливает последние N из ответных заголовков). Backend просто принимает список строк как есть.
- **`app_version`/`build_sha` — из фронта, backend не знает версию себя.** Research подтвердил: `config/settings.py` не экспонирует `APP_VERSION` — фронт уже имеет `frontend/src/shared/version.ts`'s build-time константы (`APP_VERSION`/`BUILD_SHA`, Vite `define`) — эта стори просто принимает их строками в payload, не пытается получить версию бэка независимо (той нет и не нужна для этой стори).
- **Копировать паттерн `ExpenseReportViewSet`.** `apps/operations/submissions/api/views.py::ExpenseReportViewSet` (`RequirePermissionMixin`, viewsets.ViewSet) — ближайший прецедент простого нового write-эндпоинта в этой кодовой базе; `apps/operations/submissions/api/serializers.py` — сосед-сериализатор.
- **`TimeStampedModel`, не `core`'s `UUIDTimeStampedModel`.** Модель живёт в `apps.operations` (не `apps.core`) — зеркалит `rbac/models.py`'s собственный выбор базового класса (`apps.operations.models.TimeStampedModel`), не смешивать с core-конвенцией.

### References

- [Source: _bmad-output/planning-artifacts/epics.md#L1348-1353] — буква стори 13.1.
- [Source: apps/core/middleware.py] — `RequestContextMiddleware`, `request_id`-контекст (Story 4.3) — что ЕСТЬ, что эта стори НЕ строит заново.
- [Source: frontend/src/shared/version.ts] — `APP_VERSION`/`BUILD_SHA` (13.1b будет читать это, 13.1a просто принимает строками).
- [Source: apps/operations/rbac/models.py::Role/UserRole/RolePermission/Permission] — существующий механизм видимости, переиспользуемый для «только разработчику».
- [Source: apps/operations/submissions/api/views.py::ExpenseReportViewSet] — паттерн-прецедент простого нового write-эндпоинта.
- [Source: apps/operations/tests/test_authz_boundary.py::FORBIDDEN_ATTRS] — `is_staff`/`is_superuser` запрещены для бизнес-authz — RBAC-код, не Django-admin-флаги.

## Dev Agent Record

### Context Reference

- Собрано делегированным research-агентом при create-story: `AuditedModel`/`TimeStampedModel`-конвенции, `request_id`-инфраструктура (что есть/чего нет), версия-трекинг (фронт vs бэк), «developer-only»-прецедент (найдено: нет нового механизма, есть переиспользуемый RBAC), API URL-конвенции + write-endpoint-прецедент, фронтовый `useLocation()`-паттерн.

### Completion Notes

- **AC-1**: `BugReport(TimeStampedModel)` в новом app `apps/operations/bugreports/` (label `ops_bugreports`), таблица `ops_bug_reports`. Поля точно по AC: `user_id`, `screen_path`, `app_version`, `build_sha`, `last_request_ids` (JSONField, клиент присылает как есть), `description`.
- **AC-2/AC-3 — реализация ИНАЧЕ, чем буквально написано в AC-3 (`RequirePermissionMixin`), с явным обоснованием.** `RequirePermissionMixin` fail-close на КАЖДОЕ действие (нет кода в `permission_map` → 403) — заставило бы завести отдельный permission-код на `create`, который пришлось бы раздать ВСЕМ ролям, чтобы сохранить «стоимость репорта ~0» — по сути имитация «нет права», а не его отсутствие. Вместо этого `BugReportViewSet` НЕ наследует mixin: `create` проверяет только `request.actor_id` (аутентификация, не RBAC-право) — соответствует `DEFAULT_PERMISSION_CLASSES=[]` конвенции проекта (аутентификация ≠ авторизация). `list`/`retrieve` вызывают ту же свободную функцию `require_permission()`, что использует mixin внутри — идентичный механизм авторизации, применённый выборочно. Живые тесты доказывают ОБА направления: `no-role-operator` создаёт репорт (201) и НЕ может его увидеть (403 на list, даже свой собственный); `ORGD`-роль (руководство) тоже 403; только `DEVELOPER`-роль (новая, единственный держатель `bugreports.view`) видит 200.
- **Новая роль `DEVELOPER`, не новый механизм видимости.** Research при create-story изначально предположил, что нужен новый "developer-only"-примитив — опровергнуто: существующий RBAC (`Role`/`UserRole`/`RolePermission`/`Permission`) уже решает это ровно тем же способом, что остальные 8 ролей. `seed_operations.py`: `bugreports.view` permission + `DEVELOPER` роль + маппинг.
- **Найдены и исправлены 6 реальных gate-регрессий (не review — прямой `make gate`):**
  1. `test_seed.py::test_seed_creates_all_roles`/`test_seed_is_idempotent` — хардкод «8 ролей» → 9 (добавлен `DEVELOPER`).
  2. `test_rbac_matrix.py::test_actor_set_is_eight_roles_plus_anon` → переименован `test_actor_set_is_nine_roles_plus_anon`, 8→9/9→10.
  3. `test_rbac_matrix.py::test_matrix_covers_every_registered_route` — добавлены строки `bugreport-list`/`bugreport-detail`; понадобился НОВЫЙ примитив `_ANY_AUTH`-сентинел внутри `_MethodGate` (смешанная политика на одном роуте: POST=любой аутентифицированный, GET=код-право — прецедента смешивания ДО этой стори не было).
  4. `test_audit_coverage.py::test_audit_matrix_covers_every_mutating_route` — добавлена строка `_DeferredAudit(_BUGREPORTS)`: багрепорт САМ по себе append-only запись (created_at/created_by/user_id), не бизнес-мутация с юридическим следом (аналогия с уже существующим `_NOTIF`-обоснованием) — отдельный AuditLog-канал НЕ заведён осознанно, не пропущен.
  5. `test_schema_drift.py` — `make schema` перегенерирован.
  6. **Самостоятельно найден и исправлен ДО финального прогона (не gate поймал, я сам при первой генерации схемы):** `router.register("", BugReportViewSet, ...)` с ПУСТЫМ префиксом дал operationId-коллизию (`bugreports_retrieve` для ОБОИХ GET-эндпоинтов, list и retrieve) — та же ловушка, что `apps/notifications/api/urls.py`'s собственный докстринг уже документирует («DefaultRouter с пустым префиксом сталкивает api-root со list»). Исправлено: точная копия notifications' паттерна (`path()`-маппинг, НЕ router) + явные `@extend_schema(operation_id=...)` на все 3 метода (паттерн `ExpenseReportViewSet`) — коллизия исчезла, `unable to guess serializer`-ошибка тоже пропала (явные `responses=`).
- **AC-4**: 5 API-тестов (не 4 из плана — добавлен `test_ordinary_role_without_bugreports_view_stays_forbidden`, доказывающий, что НАСТОЯЩАЯ руководящая роль ORGD тоже не видит репорты, не только гипотетический безролевой актор). `make gate` — 2976 passed (было 2875), `ruff check` чисто, `make schema` без drift.

**3-агентное ревью (Blind Hunter, Edge Case Hunter, Acceptance Auditor, параллельно) — 4 реальные находки, все применены:**
- **Blind Hunter (HIGH, подтверждено)**: `list()` был БЕЗ пагинации — единственный подобный list-эндпоинт в кодовой базе без неё (`AuditLogPagination`/`DefaultPagination` — уже установленный канон). Учитывая, что `create` НАМЕРЕННО открыт без RBAC-ограничения (AC-2, «стоимость ~0») — это реальный риск неограниченного роста таблицы + одного `GET`, тянущего её целиком в память. Исправлено: `BugReportPagination(LimitOffsetPagination)`, зеркалит `AuditLogPagination` (default 50, потолок 200), `list()` переписан на `paginate_queryset`/`get_paginated_response` (паттерн `UserRoleViewSet`, `apps/operations/api/views.py`).
- **Edge Case Hunter (MED, подтверждено)**: `retrieve()` не имел НИ ОДНОГО прямого теста (только косвенное покрытие 403-пути через `test_rbac_matrix.py`) — добавлены `test_developer_can_retrieve_a_single_report_by_id` (200 + тело) и `test_retrieve_of_missing_id_is_404_for_a_developer` (404).
- **Edge Case Hunter (LOW, defense-in-depth)**: `last_request_ids` — `ListField` без `max_length` (элементов), инцидентально ограничен только глобальным `DATA_UPLOAD_MAX_MEMORY_SIZE`, не осознанным дизайном. Исправлено: явный `max_length=20` + тест `test_create_serializer_rejects_too_many_request_ids`.
- **Acceptance Auditor (найдено расхождение с AC-4)**: заявленный в AC-4 «unit: serialization round-trip» тест реально ОТСУТСТВОВАЛ в первом прогоне (только HTTP-интеграционные). Добавлен `tests/test_serializers.py` — 3 юнит-теста напрямую на `BugReportCreateSerializer`/`BugReportSerializer`, без HTTP.
- **Опровергнутые/некритичные находки (проверены, не требуют фикса)**: `_ANY_AUTH`/RBAC-механизм подтверждён Acceptance Auditor как «тот же код-путь, что mixin использует внутри» — легитимное, задокументированное отклонение от буквы AC-3, не тихий спецкейс; `retrieve()` без per-row scoping — подтверждено НЕ IDOR (та же модель, что `AuditLogViewSet` — глобальная видимость держателю права, именно так и задумано); `ADMIN`'s wildcard `*` тоже видит багрепорты — существующая, не новая конвенция (не нарушает «анонимность от начальства», цель — скрыть от ORGD/OMD, не от superuser).
- Живой ре-прогон после всех фиксов: `apps/operations/bugreports/` — 13 passed (было 8). `make gate` — 2981 passed (было 2976), `make schema` без drift, `ruff check` чисто.

### File List

- `Backend/VAPS/apps/operations/bugreports/` (NEW app) — `models.py`, `apps.py`, `migrations/0001_initial.py`, `api/serializers.py`, `api/views.py`, `api/urls.py`, `tests/test_app.py`, `tests/test_bugreport_api.py`.
- `Backend/VAPS/config/settings.py` (MOD) — `INSTALLED_APPS` += `apps.operations.bugreports`.
- `Backend/VAPS/config/urls.py` (MOD) — новый `api/bugreports/`-контекст.
- `Backend/VAPS/apps/operations/management/commands/seed_operations.py` (MOD) — `bugreports.view` permission + `DEVELOPER` роль.
- `Backend/VAPS/apps/operations/tests/test_seed.py` (MOD) — 8→9 ролей.
- `Backend/VAPS/apps/operations/tests/test_rbac_matrix.py` (MOD) — `_ANY_AUTH`-сентинел (новый примитив), 2 новые MATRIX-строки, 8→9 ролей.
- `Backend/VAPS/apps/audit/tests/test_audit_coverage.py` (MOD) — `_BUGREPORTS`-обоснование + `_DeferredAudit`-строка.
- `Backend/VAPS/schema.yaml` (MOD) — регенерирован (`make schema`, дважды — до и после ревью-фиксов).
- `Backend/VAPS/apps/operations/bugreports/tests/test_serializers.py` (NEW, ревью-фикс) — юнит-тесты сериализатора.

## Change Log

| Дата | Изменение |
|---|---|
| 2026-07-29 | Story создана (create-story), декомпозирована на 13.1a (бэк)/13.1b (фронт) |
| 2026-07-29 | dev-story: модель+API+RBAC-видимость реализованы (иной механизм, чем в AC-3 буквально — обоснование в Completion Notes), 6 реальных gate-регрессий найдено и исправлено (8→9 ролей, RBAC/audit-матрицы, operationId-коллизия). `make gate` 2976 passed. Status → review |
| 2026-07-29 | 3-агентное ревью: 4 реальные находки исправлены (пагинация list(), retrieve()-тесты, last_request_ids-потолок, недостающий unit-тест сериализатора). Живой ре-прогон 13/13 + `make gate` 2981 passed. Status → done |
