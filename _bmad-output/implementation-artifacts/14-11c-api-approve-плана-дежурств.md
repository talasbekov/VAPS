---
baseline_commit: c3306f9
---

# Story 14.11c: API — утверждение плана дежурств

Status: done

## Story

As an **оператор с правом `duty.manage`**,
I want **`POST /api/operations/duty-plans/{id}/approve`**,
so that **план дежурств можно перевести в `APPROVED` и запустить проекцию статусов (BR-017) через API**.

`epics.md:1411` (буква, до разделения): «Story 14.11: API и экраны плана дежурств». Третья из ~12 подсторий разделения.

## Scope Decision (найдено при create-story)

- **Донор: `API-OPS-012`, `POST /api/operations/duty-plans/{id}/approve`, право `duty.manage`.** Тонкая HTTP-обёртка вокруг УЖЕ существующей `approve_duty_plan(plan)` (14.6, `services.py`).
- **`approve_duty_plan()` — идемпотентна по дизайну, подтверждено тестом (`test_approve_duty_plan_is_idempotent`, 14.6).** Переход статуса — `if plan.status_code != APPROVED`; повторная проекция безопасна (`project_duty_shift()`'s `get_or_create`). API-слой ДОЛЖЕН относиться к повторному `/approve` как к чистому `200`, НЕ как к ошибке — стори НЕ добавляет собственный state-machine-гард поверх уже идемпотентного сервиса.
- **`BR-DUTY-TYPE-004` (гейт «объект-паспорт не RED + свежая разведка при `requires_reconnaissance=true`») — ОСТАЁТСЯ отложенным, НЕ реализуется в этой стори.** Модель «разведки» (донор's `ops_event_reconnaissance`/`ops_event_reconnaissance_items`) вообще НЕ существует в кодовой базе — она принадлежит донор's Events-домену (`API-OPS-018`), другому эпику, не Epic 14. Без записи о разведке гейт НЕВОЗМОЖНО реализовать сегодня — это НЕ «14.11's территория», как формулировала 14.7's Scope Decision (та формулировка была неточной: реальный блокер — отсутствующая модель разведки, не отсутствие API-стори). Явно НЕ строится ни в каком виде (ни заглушкой, ни всегда-true проверкой) — заглушка была бы ложным чувством безопасности.
- **Ответ — сериализованный `DutyPlan` (`DutyPlanSerializer`), `200`.** Тот же паттерн, что `create`/`shifts` — без дополнительного «N смен спроецировано» (потребовало бы новой инструментации `project_duty_shift()`, не оправдано без явного требования).
- **Роут — `@action(detail=True, methods=["post"])` `approve` на существующем `DutyPlanViewSet`.** Даёт имя `ops-duty-plan-approve` (паттерн `{basename}-{action}`, тот же, что `ops-duty-plan-shifts`).
- **Новых записей в `CONSTRAINT_ERROR_MAP`/`error-codes.yaml` — НЕ требуется.** `approve_duty_plan()` не вызывает `full_clean()`, не создаёт новых экземпляров моделей, требующих валидации — только `save(update_fields=[...])` и `get_or_create()`-путь (уже покрыт 14.6-14.9's тестами).
- **RBAC-строка/HTTP audit-логирование — 14.12, тот же установленный паттерн.**

## Acceptance Criteria

1. **AC-1 (`POST .../{id}/approve` — happy path).** Требует `duty.manage`. Успех — `200`, сериализованный `DutyPlan` с `status_code="APPROVED"`.
2. **AC-2 (проекция реально запускается).** После вызова — `EmployeeStatus`-записи (DUTY/REST_AFTER_DUTY/[BEFORE_DUTY]) существуют для каждой смены плана (`source=OM_AUTO`).
3. **AC-3 (несуществующий `{id}` → 404).**
4. **AC-4 (повторный `/approve` на уже `APPROVED`-плане → чистый 200, идемпотентно).** НЕ ошибка; `EmployeeStatus`-записи не дублируются (переиспользование `approve_duty_plan()`'s собственной идемпотентности).
5. **AC-5 (без `duty.manage` → 403).**
6. **AC-6 (план без смен → успешный `200`, ничего не спроецировано, статус всё равно переходит).**
7. **AC-7 (регресс нулевой, `make gate` зелёный).**

## Out of Scope

- `BR-DUTY-TYPE-004`'s reconnaissance-гейт — невозможен без модели разведки (Events-эпик, не Epic 14).
- Cancel/replan-эндпоинты — 14.11d/e.
- `validate`/`conflicts` — 14.11f/g.
- RBAC-строка/HTTP audit-логирование — 14.12.

## Tasks / Subtasks

- [x] Task 1 — `@action(detail=True)` `approve` на `DutyPlanViewSet` (AC: 1-6)
  - [x] `apps/operations/duties/api/views.py` — `require_permission` → `get_object_or_404` → `approve_duty_plan(plan)` → сериализованный ответ
- [x] Task 2 — MATRIX/AUDIT_MATRIX-строка (AC: 5, 7)
  - [x] `ops-duty-plan-approve` — `_Gate("duty.manage")`/`_DeferredAudit(_DUTY)`
- [x] Task 3 — `make schema` регенерация
- [x] Task 4 — Тесты (AC: 1-7)
  - [x] happy path (статус+проекция), 403, 404, повторный вызов (идемпотентность), план без смен
  - [x] `make gate` зелёный, явно прогнан

## Dev Notes

- Читать `apps/operations/duties/services.py::approve_duty_plan` и `apps/operations/duties/tests/test_services.py::test_approve_duty_plan_is_idempotent` (уже существующая гарантия идемпотентности) ПЕРЕД имплементацией — эта стори НЕ добавляет свою идемпотентность, переиспользует существующую.

### References

- [Source: docs/PersonnelStatus/VAPS_7.8.2.md, API-OPS-012, BR-DUTY-TYPE-004] — донор-контракт эндпоинта + причина, почему reconnaissance-гейт невозможен.
- [Source: Backend/VAPS/apps/operations/duties/services.py::approve_duty_plan] — переиспользуемый сервис (14.6, done).
- [Source: Backend/VAPS/apps/operations/duties/api/views.py] — паттерн `@action(detail=True)` (14.11b).

## Dev Agent Record

### Context Reference

- Отдельный research-агент при create-story: подтверждено — `approve_duty_plan()` идемпотентна по дизайну (уже протестировано в 14.6); `BR-DUTY-TYPE-004`'s гейт невозможен (модель разведки не существует нигде в кодовой базе, принадлежит Events-эпику); новых записей в `CONSTRAINT_ERROR_MAP` не требуется.

### Completion Notes

Реализовано буквально по AC 1-7. `@action(detail=True, methods=["post"])` `approve` на `DutyPlanViewSet`: `require_permission` → `get_object_or_404` → `approve_duty_plan(plan)` → сериализованный ответ. Никакой собственной идемпотентности/state-machine-гарда не добавлено — переиспользуется существующая гарантия сервиса (14.6). MATRIX/AUDIT_MATRIX-строка `ops-duty-plan-approve` добавлена. 5 новых тестов (happy path+проекция, 403, 404, идемпотентность, план без смен), все зелёные под реальным Postgres с первой попытки; `make schema` регенерирован; `make gate` — 3287 passed (было 3272, +15), 0 regressions, no migration drift (чисто API-слой, новых DB-констрейнтов не требуется).

### File List

- `apps/operations/duties/api/views.py` (modified — `approve`-action)
- `apps/operations/tests/test_rbac_matrix.py` (modified — `MATRIX`'s новая строка)
- `apps/audit/tests/test_audit_coverage.py` (modified — `AUDIT_MATRIX`'s новая строка)
- `apps/operations/duties/tests/test_duty_plan_approve_api.py` (new)
- `schema.yaml` (regenerated — `make schema`)
- `apps/operations/duties/services.py` (modified — ревью-фикс: `cancelled_at`-гард в `project_duty_shift()`, `transaction.atomic()`+`select_for_update()` в `approve_duty_plan()`, функция теперь возвращает `plan`)
- `apps/operations/duties/api/views.py` (modified — ревью-фикс: использует возвращаемое значение `approve_duty_plan()`)
- `apps/operations/duties/tests/test_services.py` (modified — ревью-фикс: 1 новый regression-тест)

## Change Log

| Дата | Изменение |
|---|---|
| 2026-07-31 | Story создана (create-story). Третья из ~12 подсторий разделения 14.11. Тонкая HTTP-обёртка над `approve_duty_plan()` (14.6) — идемпотентность переиспользуется, не дублируется. `BR-DUTY-TYPE-004`'s гейт остаётся отложенным (реальный блокер — отсутствующая модель разведки, не отсутствие API-стори, как ошибочно сформулировала 14.7). |
| 2026-07-31 | Dev-story: `approve`-action, MATRIX/AUDIT_MATRIX-строка, 5 новых тестов, все зелёные под реальным Postgres с первой попытки. `make gate` — 3287 passed. Status → review. |
| 2026-07-31 | 3-агентное ревью (Blind Hunter/Edge Case Hunter/Acceptance Auditor). Acceptance Auditor подтвердил все 7 AC PASS. Edge Case Hunter (полный доступ к репо, в отличие от Blind Hunter) нашёл ДВА реальных дефекта в `services.py` (14.6/14.9a, теперь HTTP-доступных через эту стори, не только раньше в тестах): (1) **функциональный баг** — `approve_duty_plan()`/`project_duty_shift()` НИКОГДА не проверяли `shift.cancelled_at` — повторное `/approve` ПОСЛЕ отмены смены (14.9a) молча ВОСКРЕШАЛО удалённые `EmployeeStatus`-записи отменённой смены, полностью аннулируя отмену; (2) **гонка** — `approve_duty_plan()` не была обёрнута в `transaction.atomic()` (в отличие от `cancel_duty_shift`/`replan_duty_shift`), а `EmployeeStatus.source_ref` не несёт DB-уровневого unique-constraint — `get_or_create()` НЕ race-safe без него; два одновременных HTTP `/approve` могли дать дублирующиеся строки. Fix: (1) `cancelled_at is not None`-гард В `project_duty_shift()` (защищает ВСЕХ вызывающих, не только `approve_duty_plan`) + regression-тест (`test_reapproving_plan_does_not_resurrect_a_cancelled_shifts_statuses`); (2) `transaction.atomic()`+`DutyPlan.objects.select_for_update()` в `approve_duty_plan()`, функция теперь возвращает `plan` (переиспользуется вьюхой вместо мутации исходного объекта). Полное закрытие гонки (DB unique-constraint на `source_ref`) — вне scope этой стори (принадлежит `EmployeeStatus`'s модели, другой эпик/стори); блокировка на уровне плана существенно сужает окно. `make gate` — 3288 passed (было 3287, +1), без регрессий. Status → done. |
