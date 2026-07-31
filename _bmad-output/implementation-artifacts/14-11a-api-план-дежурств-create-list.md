---
baseline_commit: 7cbe09a
---

# Story 14.11a: API — создание/список планов дежурств

Status: ready-for-dev

## Story

As an **оператор с правом `duty.manage`**,
I want **`POST /api/operations/duty-plans` (создать план) и `GET /api/operations/duty-plans` (список планов)**,
so that **план дежурств можно завести и найти через API, минуя прямую работу с ORM**.

`epics.md:1411` (буква, до разделения): «Story 14.11: API и экраны плана дежурств (бумажный контракт → грид-переиспользование)». Первая из ~12 подсторий разделения (backend+frontend в одной строке нарушало CLAUDE.md's декомпозицию) — см. Scope Decision.

## Scope Decision (найдено при create-story)

- **Разделение 14.11 → 14.11a...l.** Buквальный заголовок смешивает backend (API) и frontend (экраны) в одной стори — прямое нарушение CLAUDE.md's «не смешивать backend и frontend», «несколько эндпоинтов → разделять». Установленный в этом эпике прецедент (14.9→14.9a/b) и в проекте в целом (10.1→10-1a/b/b2/c, 10.2→10-2a/b) — один эндпоинт (или тесно связанная пара create+list одного ресурса) на стори. Полный список: 14.11a (эта, create+list планов) → 14.11b (create+list смен) → 14.11c (approve) → 14.11d (cancel) → 14.11e (replan) → 14.11f (donor's `validate`) → 14.11g (donor's `conflicts`) → 14.11h (OpenAPI schema regen) → 14.11i-l (frontend, после того как backend существует).
- **Донор: `API-OPS-012`, `POST|GET /api/operations/duty-plans`, право `duty.manage`.** `docs/PersonnelStatus/VAPS_7.8.2.md` — буквальный путь и метод.
- **`duty.manage` — код права УЖЕ существует, засеян.** `apps/operations/management/commands/seed_operations.py` — `("duty.manage", "Управление дежурствами")`. Эта стори лишь ИСПОЛЬЗУЕТ его через `require_permission(request, "duty.manage")` (свободная функция, `apps/operations/api/permissions.py`, тот же паттерн, что `bugreports`/`statuses`/`submissions`). RBAC-СТРОКА (привязка права к конкретным ролям) — `Story 14.12` («Аудит + RBAC-строки»), НЕ эта стори — без биндинга к роли право просто ни у кого нет, но КОД проверки уже корректен и заработает, как только 14.12 привяжет роль.
- **Место кода — `apps/operations/duties/api/` (новый пакет), регистрация в `apps/operations/api/urls.py`.** Зеркалит `bugreports`/`statuses`/`submissions`'s структуру (`api/views.py`+`serializers.py`+`urls.py` внутри сабдомена, роутер собирается в общем `apps/operations/api/urls.py`).
- **Паттерн ViewSet — простой `viewsets.ViewSet` + свободная функция `require_permission`, НЕ `RequirePermissionMixin`.** Обе схемы существуют в кодовой базе; для двух простых actions (`create`/`list`) явный вызов внутри метода (паттерн `bugreports/api/views.py`) читаемее, чем `permission_map`-декларация ради двух записей.
- **Ответ на `create` — сериализованный `DutyPlan`, `201`.** Ответ на `list` — пагинированный список (`LimitOffsetPagination`, дефолт 50/потолок 200, тот же паттерн, что `bugreports`, — без пагинации `list` растущей таблицы читает всё, старый урок).
- **Валидация `year`/`month`/`status_code` — переиспользуется существующая DB-уровневая (14.5), сериализатор НЕ дублирует диапазоны как отдельную Python-проверку (DRY, DB — источник истины).** `IntegrityError` от нарушенных `CheckConstraint`'ов (14.5) уже маппится в 422/400 существующим `exception_handler.py` (общий бэкстоп, story 3.3's урок «IntegrityError→422»).
- **RBAC-строка/audit-логирование HTTP-уровня — 14.12, не эта стори.**

## Acceptance Criteria

1. **AC-1 (`POST /api/operations/duty-plans` — создание).** Требует `duty.manage` (403 `PERMISSION_DENIED` без него). Тело: `object` (UUID/PK объекта), `year`, `month`. Успех — `201`, сериализованный `DutyPlan` (`status_code="DRAFT"` по умолчанию).
2. **AC-2 (дубликат `(object, year, month)` → 409/422).** Существующий `UniqueConstraint` (14.5) — `IntegrityError` маппится существующим `exception_handler.py`'s бэкстопом.
3. **AC-3 (`year`/`month` вне диапазона → 422).** Существующий `CheckConstraint` (14.5) — тот же маппинг.
4. **AC-4 (`GET /api/operations/duty-plans` — список).** Требует `duty.manage`. Пагинация `LimitOffsetPagination` (default 50, max 200). Опциональный фильтр по `object` (query-параметр) — без него возвращает все планы (учитывая пагинацию).
5. **AC-5 (без `duty.manage` — 403 на обоих actions).**
6. **AC-6 (регресс нулевой, `make gate` зелёный).**

## Out of Scope

- `POST/GET /api/operations/duty-plans/{id}/shifts` — 14.11b.
- `POST .../approve` — 14.11c.
- Cancel/replan-эндпоинты смен — 14.11d/e.
- `validate`/`conflicts` — 14.11f/g.
- OpenAPI `@extend_schema`-регенерация схемы (`schema.yaml`) — 14.11h (тот же паттерн, что `10-1c`'s отдельная контракт-стори).
- RBAC-строка (привязка `duty.manage` к роли) / HTTP audit-логирование — 14.12.
- Frontend — 14.11i-l.

## Tasks / Subtasks

- [ ] Task 1 — Пакет `apps/operations/duties/api/` (AC: 1, 4)
  - [ ] `serializers.py` — `DutyPlanSerializer` (ModelSerializer, read), `DutyPlanCreateSerializer` (write: `object`/`year`/`month`)
  - [ ] `views.py` — `DutyPlanViewSet(viewsets.ViewSet)`, `create`/`list`, `require_permission(request, "duty.manage")`
  - [ ] `urls.py` — роутер-регистрация фрагмент (или прямой экспорт вьюсета для сборки в общем `apps/operations/api/urls.py`)
- [ ] Task 2 — Регистрация в общем роутере (AC: 1, 4)
  - [ ] `apps/operations/api/urls.py` — `router.register("duty-plans", DutyPlanViewSet, basename="ops-duty-plan")`
- [ ] Task 3 — Тесты (AC: 1-6)
  - [ ] `create` — happy path, 403 без права, 409/422 на дубликат, 422 на диапазон
  - [ ] `list` — happy path, пагинация, 403 без права
  - [ ] `make gate` зелёный, явно прогнан

## Dev Notes

- Читать `apps/operations/bugreports/api/views.py`/`serializers.py` (простейший недавний прецедент `viewsets.ViewSet`+`require_permission`) и `apps/operations/api/urls.py` (существующая регистрация роутера) ПЕРЕД имплементацией.
- `request.actor_id` — уже установлен аутентификацией (populated до вызова вьюсета, ARCH#L585's authz seam) — не переизобретать.

### References

- [Source: docs/PersonnelStatus/VAPS_7.8.2.md, API-OPS-012] — `POST|GET /api/operations/duty-plans`, право `duty.manage`.
- [Source: Backend/VAPS/apps/operations/bugreports/api/views.py] — паттерн `viewsets.ViewSet`+`require_permission`+`LimitOffsetPagination`.
- [Source: Backend/VAPS/apps/operations/management/commands/seed_operations.py] — `duty.manage` уже засеян.
- [Source: Backend/VAPS/apps/operations/duties/models.py::DutyPlan] — модель (14.5, done), на которой строится эта стори.

## Dev Agent Record

### Context Reference

- Отдельный research-агент при create-story: подтверждено — 14.11 требует разделения на ~12 подсторий (backend/frontend-микс запрещён CLAUDE.md); заказчик подтвердил строить backend+frontend полнотекстово (все подстории, включая `validate`/`conflicts`); `duty.manage` уже засеян (не RBAC-строка); установленный паттерн `viewsets.ViewSet`+`require_permission` (bugreports — самый свежий прецедент); общий роутер `apps/operations/api/urls.py` собирает вьюсеты всех сабдоменов.

### Completion Notes

_(заполняется dev-story)_

### File List

_(заполняется dev-story)_

## Change Log

| Дата | Изменение |
|---|---|
| 2026-07-31 | Story создана (create-story). Первая из ~12 подсторий разделения 14.11 (backend+frontend-микс нарушал CLAUDE.md). `duty.manage` уже засеян как код права — RBAC-строка (биндинг к роли) отложена на 14.12. Паттерн `viewsets.ViewSet`+`require_permission`, зеркалит `bugreports/api/`. |
