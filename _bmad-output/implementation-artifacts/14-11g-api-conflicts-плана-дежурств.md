---
baseline_commit: 3c8acf2
---

# Story 14.11g: API — список конфликтов плана дежурств

Status: ready-for-dev

## Story

As an **оператор с правом `duty.manage`**,
I want **`GET /api/operations/duty-plans/{id}/conflicts`**,
so that **конфликты плана можно ПРОЧИТАТЬ (без побочного POST-семантики) тем же вычислением, что `validate`**.

`epics.md` (донор `VAPS_7.8.2.md:5933-5937`, §48.5): `validate`/`conflicts` — сиблинг-эндпоинты одного «High Fix»-аддендума. Седьмая (последняя backend) из ~12 подсторий разделения 14.11.

## Scope Decision (найдено при create-story)

- **14.11f's Scope Decision явно отложила это решение сюда**: донор не даёт полной схемы `ops_conflicts`/`ops_duty_conflicts` (BR-DUTY-CONFLICT-002), а вся конфликт-детекция сегодня — pure on-the-fly вычисление (`validate_duty_plan()`, 14.11f), не персистентность. Строить таблицу+запись+чтение конфликтов с нуля — отдельная, невходящая в объём работа (никакая стори до сих пор не пишет в `ops_conflicts`, и ничто в кодовой базе не читает эту таблицу).
- **Решение: `conflicts` — ТОНКАЯ обёртка над ТЕМ ЖЕ `validate_duty_plan()`, что и `validate` (14.11f), под другим HTTP-методом/URL.** `GET`, а не `POST` — семантически это чтение (идемпотентно, без побочных эффектов, что уже верно для `validate_duty_plan()` — она и так read-only), и донор (§48.5) даёт `conflicts` именно как `GET`, в отличие от `validate`'s `POST`. Дублирования логики нет: оба action'а вызывают один и тот же сервис.
- **Разница с `validate` — ТОЛЬКО HTTP-метод/URL/operation_id/RBAC-строка.** Ответ — тот же `DutyPlanConflictSerializer(many=True)`, тот же `200`, тот же plain array (без пагинации — то же `pagination_class=None`, тот же паттерн, что review-фикс 14.11f).
- **Почему не один action на оба метода** (как `shifts` в 14.11b, `@action(methods=["get","post"])`)**:** донор трактует их как ДВА РАЗНЫХ логических эндпоинта (`validate` — команда «проверь сейчас», `conflicts` — запрос «покажи что нашли») с разными operation_id/описаниями в OpenAPI, даже если код за ними идентичен сегодня. Один action с веткой по методу здесь скрывал бы это концептуальное различие без экономии кода (в отличие от `shifts`, где create/list — генуинно разное тело).
- **Роут — `ops-duty-plan-conflicts`.** MATRIX/AUDIT_MATRIX-строка нужна (`_Gate("duty.manage")`/`_DeferredAudit`, как сиблинги). Хотя `GET`, не мутация — но 14.11f's `validate` уже прецедент: RBAC/audit-МАТРИЦЫ регистрируют строку по факту существования роута с явным гейтом, а не по HTTP-методу (RBAC-матрица покрывает ВСЕ роуты, не только мутирующие — только audit-матрица завязана на мутирующий метод; `GET` НЕ входит в audit-полноту-гейт, но ВХОДИТ в RBAC-полноту-гейт).

## Acceptance Criteria

1. **AC-1 (happy path — чистый план).** Требует `duty.manage`. `GET`, чистый план → `200`, `[]`.
2. **AC-2 (конфликты — тот же результат, что `validate` на том же плане).** План с self-overlap и/или hard-overlap → `200`, список ИДЕНТИЧЕН (побайтово, тот же набор конфликтов) тому, что вернул бы `POST .../validate` для того же плана в том же состоянии.
3. **AC-3 (несуществующий план → 404).**
4. **AC-4 (без `duty.manage` → 403).**
5. **AC-5 (read-only, без query-параметров — просто GET).**
6. **AC-6 (регресс нулевой, `make gate` зелёный, schema.yaml без пагинации — bare array, как `validate`).**

## Out of Scope

- Персистентность конфликтов (`ops_duty_conflicts`-таблица) — не эта стори, не входит ни в один текущий backlog-item.
- Полная широта BR-DUTY-CONFLICT-001 — Story 16.3.
- RBAC-строка/HTTP audit-логирование (реальное, не completeness-гейт) — 14.12.

## Tasks / Subtasks

- [ ] Task 1 — `@action` `conflicts` на `DutyPlanViewSet` (AC: 1-5)
  - [ ] `GET`, `require_permission` → `get_object_or_404` → `validate_duty_plan(plan)` (14.11f, без изменений) → `200` с `DutyPlanConflictSerializer(many=True)`, `pagination_class=None`
- [ ] Task 2 — MATRIX/AUDIT_MATRIX-строка (AC: 4, 6)
  - [ ] `ops-duty-plan-conflicts` — `_Gate("duty.manage")`/`_DeferredAudit(_DUTY)`
- [ ] Task 3 — `make schema` регенерация
- [ ] Task 4 — Тесты (AC: 1-6)
  - [ ] чистый план, идентичность с `validate`'s результатом на том же fixture, 404, 403
  - [ ] `make gate` зелёный, явно прогнан

## Dev Notes

- Читать `apps/operations/duties/api/views.py::validate` (14.11f, буквальный образец: `require_permission`→`get_object_or_404`→сервис→`Response(...)`, `pagination_class=None`-паттерн) ПЕРЕД имплементацией. `conflicts` — идентичный код, другой HTTP-метод/`url_name`/`operation_id`/description.
- `validate_duty_plan(plan)` (services.py, 14.11f) переиспользуется БЕЗ ИЗМЕНЕНИЙ.

### References

- [Source: Backend/VAPS/apps/operations/duties/services.py::validate_duty_plan] — переиспользуемый сервис (14.11f, done).
- [Source: Backend/VAPS/apps/operations/duties/api/views.py::validate] — буквальный образец (14.11f), включая `pagination_class=None`-review-фикс.

## Dev Agent Record

### Context Reference

- Решение зафиксировано ещё в 14.11f's create-story: `conflicts` — GET-обёртка над тем же `validate_duty_plan()`, без персистентности (таблица `ops_duty_conflicts` не строится нигде в текущем backlog).

### Completion Notes

### File List

## Change Log

| Дата | Изменение |
|---|---|
| 2026-07-31 | Story создана (create-story). Седьмая (последняя backend) из ~12 подсторий разделения 14.11. `conflicts` — тонкая GET-обёртка над `validate_duty_plan()` (14.11f), без новой таблицы персистентности (донор не даёт полной схемы `ops_duty_conflicts`, ничто в backlog её не строит). Тот же bare-array/pagination_class=None паттерн, что 14.11f's review-фикс. |
