---
baseline_commit: 5ac968d
---

# Story 13.1a: Багрепорт — модель и API (бэк)

Status: ready-for-dev

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

- [ ] Task 1 — `apps/operations/bugreports/` (NEW app) — модель + миграция (AC: 1)
  - [ ] `models.py`: `BugReport(TimeStampedModel)`.
  - [ ] Миграция создаёт таблицу.
- [ ] Task 2 — Новый RBAC permission-код `bugreports.view` (AC: 3)
  - [ ] Data-миграция (или seed, зеркалит существующий паттерн сидинга `Permission`-строк — найти прецедент в `apps/operations/rbac/migrations/`) добавляет код `bugreports.view`.
- [ ] Task 3 — API (сериализатор + viewset + urls) (AC: 2, 3)
  - [ ] `serializers.py`: `BugReportSerializer`.
  - [ ] `views.py`: `BugReportViewSet` — `create` без permission-гейта (кроме стандартной аутентификации), `list`/`retrieve` через `RequirePermissionMixin` с кодом `bugreports.view`.
  - [ ] `config/urls.py`: новый `api/bugreports/`-контекст (7-й, зеркалит существующие 6).
- [ ] Task 4 — Тесты (AC: 4)
  - [ ] `apps/operations/bugreports/tests/test_app.py` (структурный, зеркалит другие app'ы).
  - [ ] `apps/operations/bugreports/tests/test_bugreport_api.py` — 201/403/200-сценарии.
- [ ] Task 5 — Реальный прогон
  - [ ] `make gate` зелёный.

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

### File List

## Change Log

| Дата | Изменение |
|---|---|
| 2026-07-29 | Story создана (create-story), декомпозирована на 13.1a (бэк)/13.1b (фронт) |
