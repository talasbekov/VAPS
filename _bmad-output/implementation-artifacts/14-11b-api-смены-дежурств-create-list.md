---
baseline_commit: 5fc5a0a
---

# Story 14.11b: API — создание/список смен дежурств

Status: ready-for-dev

## Story

As an **оператор с правом `duty.manage`**,
I want **`POST /api/operations/duty-plans/{id}/shifts` (создать смену) и `GET /api/operations/duty-plans/{id}/shifts` (список смен плана)**,
so that **смены дежурств можно завести и найти внутри конкретного плана через API**.

`epics.md:1411` (буква, до разделения): «Story 14.11: API и экраны плана дежурств». Вторая из ~12 подсторий разделения (см. 14.11a's Scope Decision).

## Scope Decision (найдено при create-story)

- **Донор: `API-OPS-012`, `POST|GET /api/operations/duty-plans/{id}/shifts`, право `duty.manage`.**
- **Паттерн — `@action(detail=True)` на `DutyPlanViewSet`, НЕ плоский `/duty-shifts?plan={id}`.** Донор буквально задаёт вложенный путь `.../{id}/shifts`; установленный в кодовой базе идиом для «под-путь одного ресурса, идентифицированного `{pk}`» — `@action(detail=True, methods=[...])` (прецедент: `DailySubmissionViewSet.export`/`.amend`, `apps/operations/submissions/api/views.py`). Один action `shifts`, ветвление по `request.method` (GET/POST) внутри — не разделяется на два action'а, т.к. DRF's `@action` с `methods=["get","post"]` уже стандартно так делается.
- **`DutyShift.clean()`'s cross-FK гард (post/duty_type должны принадлежать объекту плана, 14.5) — ОБЯЗАТЕЛЬНО вызывается явно (`full_clean()`), эта стори — ПЕРВЫЙ HTTP write-путь для `DutyShift`.** В отличие от 14.11a's DB-constraint-only рассуждения (там DB уже гарантирует инвариант, повторная Python-проверка была бы дублированием) — здесь гард НЕ имеет DB-уровневого бэкстопа вообще (Postgres `CHECK` не может сравнивать колонки разных таблиц, тот же аргумент, что в 14.2/14.3/14.5's `clean()`-комментариях). Пропуск `full_clean()` пропустил бы инвариант молча. Зеркалит уже установленный паттерн (`replan_duty_shift()`, 14.9b: `new_shift.full_clean(); new_shift.save()`).
- **`ck_duty_shift_starts_before_ends` (14.5) — новая запись в `CONSTRAINT_ERROR_MAP` + `error-codes.yaml`.** Тот же паттерн, что 14.11a's поправка (закрытый реестр по имени constraint'а, не общий бэкстоп) — `DUTY_SHIFT_INVALID_INTERVAL`/422.
- **`ValidationError` от `full_clean()` — НЕ требует новой записи в `CONSTRAINT_ERROR_MAP`.** Django's `ValidationError`, пойманное DRF's штатным путём (не `IntegrityError`), уже маппится в `400 VALIDATION_ERROR` существующим `exception_handler.py`'s DRF-делегирующим шагом (`_DRF_STATUS_TO_CODE`) — при условии, что вьюха НЕ перехватывает и не глушит исключение (пусть пропагирует).
- **Cancel-поля (14.9a) — экспонируются read-only, не исключаются.** `cancelled_at`/`cancelled_by`/`cancelled_reason` — «append-once cancel facts», часть истории смены, не отдельный ресурс; исключение скрыло бы легитимную историю отмены от любого читателя списка. Запись в них — НЕ через эту стори (14.11d — cancel-эндпоинт).
- **Роут — ОДИН, на существующем `DutyPlanViewSet` (не новая регистрация в роутере).** `@action(detail=True)` даёт имя `ops-duty-plan-shifts` (для GET и POST, тот же паттерн, что `-list` уже покрывает и `list`, и `create`), путь `duty-plans/{pk}/shifts/`. Требует ОДНУ новую строку в `MATRIX`/`AUDIT_MATRIX` (не две).
- **`plan` — НЕ поле тела запроса, берётся из URL `{pk}`.** `DutyShiftCreateSerializer` не содержит `plan`.
- **RBAC-строка/HTTP audit-логирование — 14.12, тот же установленный паттерн.**

## Acceptance Criteria

1. **AC-1 (`POST .../{id}/shifts` — создание).** Требует `duty.manage`. Тело: `employee_id` (UUID), `post` (опционально, PK), `duty_type` (опционально, PK), `duty_role_code`/`notes` (опционально), `starts_at`/`ends_at` (обязательно). `plan` — из URL. Успех — `201`, сериализованная `DutyShift`.
2. **AC-2 (несуществующий `{id}` плана → 404).**
3. **AC-3 (`starts_at >= ends_at` → 422 `DUTY_SHIFT_INVALID_INTERVAL`).** Существующий `CheckConstraint` (14.5) — новая запись в `CONSTRAINT_ERROR_MAP`.
4. **AC-4 (несовместимый `post`/`duty_type` (другой объект, не объект плана) → 400).** `full_clean()`'s `ValidationError`, штатный DRF-путь, БЕЗ новой записи в `CONSTRAINT_ERROR_MAP`.
5. **AC-5 (`GET .../{id}/shifts` — список).** Требует `duty.manage`. Пагинация (тот же `LimitOffsetPagination`, 50/200). Ответ включает `cancelled_at`/`cancelled_by`/`cancelled_reason` (read-only, для уже отменённых смен — видна история).
6. **AC-6 (без `duty.manage` — 403 на обоих actions).**
7. **AC-7 (регресс нулевой, `make gate` зелёный).**

## Out of Scope

- `POST .../approve` — 14.11c.
- Cancel/replan-эндпоинты — 14.11d/e.
- `validate`/`conflicts` — 14.11f/g.
- RBAC-строка/HTTP audit-логирование — 14.12.

## Tasks / Subtasks

- [ ] Task 1 — `DutyShift`-сериализаторы (AC: 1, 5)
  - [ ] `apps/operations/duties/api/serializers.py` — `DutyShiftSerializer` (read), `DutyShiftCreateSerializer` (write)
- [ ] Task 2 — `@action(detail=True)` `shifts` на `DutyPlanViewSet` (AC: 1-6)
  - [ ] `apps/operations/duties/api/views.py` — ветвление GET/POST, `require_permission`, `get_object_or_404` на план, `full_clean()` перед `save()`
- [ ] Task 3 — `CONSTRAINT_ERROR_MAP`/`error-codes.yaml` (AC: 3)
  - [ ] `ck_duty_shift_starts_before_ends` → `DUTY_SHIFT_INVALID_INTERVAL`/422
- [ ] Task 4 — MATRIX/AUDIT_MATRIX-строка (AC: 6, 7)
  - [ ] `ops-duty-plan-shifts` — `_Gate("duty.manage")`/`_DeferredAudit(_DUTY)`
- [ ] Task 5 — `make schema` регенерация
- [ ] Task 6 — Тесты (AC: 1-7)
  - [ ] create happy path, 403, 404 (несуществующий план), 422 (интервал), 400 (несовместимый post/duty_type)
  - [ ] list happy path (включая отменённую смену — cancel-поля видны), 403
  - [ ] `make gate` зелёный, явно прогнан

## Dev Notes

- Читать `apps/operations/duties/api/views.py`/`serializers.py` (14.11a, готовый паттерн) и `apps/operations/submissions/api/views.py::DailySubmissionViewSet.export`/`.amend` (`@action(detail=True)`-прецедент) и `apps/operations/duties/services.py::replan_duty_shift` (`full_clean()`-вызов перед `save()`, буквальный образец) ПЕРЕД имплементацией.

### References

- [Source: docs/PersonnelStatus/VAPS_7.8.2.md, API-OPS-012] — `POST|GET /api/operations/duty-plans/{id}/shifts`.
- [Source: Backend/VAPS/apps/operations/submissions/api/views.py::DailySubmissionViewSet] — `@action(detail=True)`-прецедент.
- [Source: Backend/VAPS/apps/operations/duties/services.py::replan_duty_shift] — `full_clean()`-паттерн, буквальный образец.
- [Source: Backend/VAPS/apps/operations/duties/models.py::DutyShift] — модель+`clean()` (14.5/14.9a, done).

## Dev Agent Record

### Context Reference

- Отдельный research-агент при create-story: подтверждено — `@action(detail=True)`-паттерн (не плоский `?plan=`-фильтр); `full_clean()` обязателен (нет DB-бэкстопа для cross-FK гарда); cancel-поля экспонируются read-only; один роут `ops-duty-plan-shifts` для GET+POST.

### Completion Notes

_(заполняется dev-story)_

### File List

_(заполняется dev-story)_

## Change Log

| Дата | Изменение |
|---|---|
| 2026-07-31 | Story создана (create-story). Вторая из ~12 подсторий разделения 14.11. `@action(detail=True)` на существующем `DutyPlanViewSet` (не новая регистрация роутера) — донор задаёт вложенный путь буквально. `full_clean()` обязателен для cross-FK гарда (нет DB-бэкстопа, урок 14.2/14.3/14.5). |
