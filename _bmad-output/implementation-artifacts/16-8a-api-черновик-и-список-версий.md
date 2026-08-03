---
baseline_commit: 9244a5a
---

# Story 16.8a: API — черновик Расстановки + список/деталь версий

Status: review

## Story

As an **оператор с правом `assignment.create` (OMD/SENIOR_COORDINATOR)**,
I want **`POST` для формирования черновика Расстановки из физнаряда и `GET`-эндпоинты для списка/детали версий**,
so that **Расстановку можно завести и просмотреть через API, минуя прямую работу с ORM**.

`epics.md:1438`: «Story 16.8: API/экраны расстановки + аудит + e2e». Первая из ~9 подсторий разделения (backend+frontend+e2e в одной строке — прямое нарушение CLAUDE.md's декомпозиции) — см. Scope Decision. Буквальный образец расщепления — 14.11 → 14.11a-l (Epic 14, дежурства).

## Scope Decision (найдено при create-story)

- **Разделение 16.8 → 16.8a...i.** Установленный в проекте прецедент (14.11a-l, 10.1→10-1a/b/b2/c) — один эндпоинт (или тесно связанная create+list пара одного ресурса) на стори, backend отдельно от frontend, e2e отдельно от backend. Полный список: 16.8a (эта, черновик+список/деталь версий) → 16.8b (submit) → 16.8c (return) → 16.8d (approve) → 16.8e (acknowledge) → 16.8f (conflicts read) → 16.8g (OpenAPI schema regen, образец 14.11h) → 16.8h (экраны, frontend) → 16.8i (e2e цепочка).
- **КРИТИЧЕСКАЯ находка при проектировании: permission-коды `assignment.create`/`assignment.submit`/`assignment.return`/`assignment.approve` УЖЕ засеяны И УЖЕ привязаны к ролям** (`apps/operations/management/commands/seed_operations.py`) — `assignment.create`/`assignment.submit` → OMD/SENIOR_COORDINATOR, `assignment.return`/`assignment.approve` → APPROVER. Это ОТМЕНЯЕТ более раннее (16.6a's Scope Decision) предположение «нет permission-кода для approve/submit» — тот вывод касался grep'а ТОЛЬКО `apps/operations/rbac/`+`docs/registries/`, но не заглянул в `apps/operations/management/commands/seed_operations.py` (не под `rbac/`). **Не решается здесь** (16.8b/c/d используют коды напрямую), но открывает возможность для БУДУЩЕЙ 16.6d (уведомления `ASSIGNMENT_SUBMITTED`→«approver» теперь резолвируемы через `assignment.approve`-держателей — та же `UserRole.objects.filter(role_code__role_permissions__permission_code_id__in=[...])`-конструкция, что `escalate_stale_force_requests()`). `ASSIGNMENT_RETURNED`→«creator» ВСЁ ЕЩЁ блокирован (`AssignmentVersion` по-прежнему без `created_by`) — 16.6d остаётся частично блокированной, не полностью разблокированной этой находкой.
- **Нет `assignment.view`-кода — чтение (`list`/`retrieve`) гейтуется «любой из create/submit/return/approve».** Ни одна роль не держит отдельного read-only права на Расстановку (в отличие от `duty.manage`, где `duty-plans` read/write делят один код). `require_permission()` — только ОДИН код за вызов; для «любого из» пишется локальный хелпер `_require_any_permission(request, codes)` (новый, буквальный `require_permission`-паттерн, цикл + one-throws-all-throw). Не изобретается новый permission-код там, где существующие роли уже дают достаточное покрытие (OMD/SENIOR_COORDINATOR создают/подают, APPROVER возвращает/утверждает — обе стороны цикла нуждаются в чтении).
- **`POST` черновика — nested action на `SecurityEventViewSet`, НЕ отдельный top-level ресурс.** `form_draft_placement(event, *, actor)` принимает `event`, не сырые поля — тот же idiom, что уже существующий `direct_assignments`-action в ТОМ ЖЕ файле (`apps/operations/events/api/views.py`) — `POST /security-events/{id}/placement/draft`, не `POST /assignment-versions {event: id}`.
- **`GET /assignment-versions` (список) + `GET /assignment-versions/{id}` (деталь, с вложенными `PlacementAssignment`) — новый `AssignmentVersionViewSet`.** Деталь возвращает ПЕРСИСТЕНТНЫЕ `conflict_severity`/`conflict_codes`/`acknowledged_at`/`ack_escalated_at` (последнее вычисленное состояние — свежесть гарантируется на `approve`, не на произвольном чтении, тот же выбор, что весь остальной read-API этого проекта не пересчитывает на GET).
- **Ошибки `form_draft_placement()` — уже структурированные `DomainError`** (`VALIDATION_ERROR` 400, `PLACEMENT_DRAFT_ALREADY_EXISTS` 409) — автоматически превращаются в HTTP через уже существующий `apps/core/api/exception_handler.py`, НЕ маппятся вручную здесь (тот же паттерн, что `issue_bulletin()`'s вызов в `bulletin`-action ничего не мапит сам).
- **Аудит `PLACEMENT_DRAFT_FORMED`** — уже пишется ВНУТРИ `form_draft_placement()` самой (16.2), эндпоинт НЕ дублирует.

## Acceptance Criteria

1. **AC-1 (`POST /api/operations/security-events/{id}/placement/draft` — черновик).** Требует `assignment.create` (403 `PERMISSION_DENIED` без него). Успех — `201`, сериализованная `AssignmentVersion` (со вложенными созданными `PlacementAssignment`).
2. **AC-2 (повторный вызов — 409).** Событие уже несёт текущую версию — `409 PLACEMENT_DRAFT_ALREADY_EXISTS` (существующий `DomainError` из `form_draft_placement()`, не дублируется вручную).
3. **AC-3 (`GET /api/operations/assignment-versions` — список).** Требует ЛЮБОЙ из `assignment.create`/`assignment.submit`/`assignment.return`/`assignment.approve`. Пагинация `LimitOffsetPagination` (default 50, max 200). Опциональный фильтр по `event` (query-параметр).
4. **AC-4 (`GET /api/operations/assignment-versions/{id}` — деталь).** Тот же permission-набор. Ответ несёт `status`/`version`/`is_current`/`signature_hash` версии + вложенный список `assignments` (`employee_id`, `post`, `conflict_severity`, `conflict_codes`, `acknowledged_at`, `ack_escalated_at`).
5. **AC-5 (без прав — 403 на всех actions).**
6. **AC-6 (несуществующий `event_id`/`version_id` — 404, не 500).** Тот же гард, что `_get_event_or_404()` (нечисловой `pk` — чистый 404, не сырой `ValueError`).
7. **AC-7 (регресс нулевой, `make gate` зелёный).**

## Out of Scope

- `POST .../submit`/`.../return`/`.../approve` — 16.8b/c/d.
- `POST .../acknowledge` (личность-проверка actor==assignment.employee_id, отложенная 16.6b's Scope Decision) — 16.8e.
- `GET .../conflicts` (принудительный пересчёт `detect_placement_conflicts()`) — 16.8f.
- **[Обновлено при dev-story]** `schema.yaml`-регенерация — переоткрыта: изначально запланированная как отдельная 16.8g была отклонена в пользу уже установленного прецедента 16.6a/c/e — `make schema` выполняется ВНУТРИ этой же стори (`make gate`'s drift-тест иначе краснит эту же стори, а не гипотетическую будущую), тот же приём, никакого нового разделения backend/contract не изобретается. 16.8g остаётся в sprint-status.yaml как ЗАРЕЗЕРВИРОВАННЫЙ слот на случай будущего расхождения, но, вероятно, не понадобится отдельно.
- RBAC-строка (новых кодов не добавляется — переиспользуются существующие) / HTTP audit-логирование сверх уже существующего `PLACEMENT_DRAFT_FORMED`.
- Frontend — 16.8h.
- e2e — 16.8i.

## Tasks / Subtasks

- [x] Task 1 — `apps/operations/events/api/serializers.py`: `AssignmentVersionSerializer`, `PlacementAssignmentSerializer` (nested), `AssignmentVersionDetailSerializer` (AC: 1, 3, 4)
- [x] Task 2 — `apps/operations/events/api/views.py`: `@action`-метод `placement_draft` на `SecurityEventViewSet` (AC: 1, 2, 6)
- [x] Task 3 — `apps/operations/events/api/views.py`: новый `AssignmentVersionViewSet` (`list`/`retrieve`), `_require_any_permission()`-хелпер (AC: 3, 4, 5, 6)
- [x] Task 4 — `apps/operations/api/urls.py`: регистрация `assignment-versions` (AC: 3, 4)
- [x] Task 5 — Тесты (AC 1-7)
- [x] Task 6 — Гейт (schema drift исправлен `make schema` внутри этой стори, не отложен — переоткрыто Out of Scope при dev-story); 2 closed-world completeness-теста (`test_rbac_matrix.py`/`test_audit_coverage.py`) потребовали новых строк — `_AnyOfGate`-класс добавлен

## Dev Notes

- `apps/operations/events/api/views.py::SecurityEventViewSet.direct_assignments` — буквальный образец nested `@action`, включая `_get_event_or_404()`-гард против нечислового `pk`.
- `apps/operations/duties/api/views.py::DutyPlanViewSet` (14.11a) — буквальный образец `create`/`list` ViewSet + `require_permission()` + `LimitOffsetPagination`.
- `apps/operations/events/services.py::form_draft_placement()` (16.2) — читать целиком: уже кидает `DomainError`, уже пишет аудит, НЕ дублировать ни то ни другое во view.
- `apps/operations/api/permissions.py::require_permission()` — единственный код за вызов; для «любого из» — новый локальный хелпер, не переоткрывать `PermissionService`.
- `apps/operations/management/commands/seed_operations.py` — `assignment.create`/`.submit`/`.return`/`.approve` уже засеяны И привязаны к ролям (OMD/SENIOR_COORDINATOR/APPROVER) — переиспользуются буквально, новых кодов/ролей не добавляется.
- `apps/operations/events/models.py::PlacementAssignment`/`AssignmentVersion` — читать поля перед сериализацией (`conflict_severity`, `conflict_codes`, `acknowledged_at`, `ack_escalated_at` — все уже существуют, 16.1/16.3b/16.6b/16.6c).

### References

- [Source: _bmad-output/planning-artifacts/epics.md:1438] — Story 16.8 текст (расщепление на 16.8a-i).
- [Source: _bmad-output/implementation-artifacts/14-11a-api-план-дежурств-create-list.md] — буквальный образец разделения API-стори + Scope Decision структуры.
- [Source: Backend/VAPS/apps/operations/events/api/views.py] — `SecurityEventViewSet`, `direct_assignments`-action, `_get_event_or_404()`.
- [Source: Backend/VAPS/apps/operations/events/services.py] — `form_draft_placement()` (16.2).
- [Source: Backend/VAPS/apps/operations/management/commands/seed_operations.py] — `assignment.*`-коды, уже привязаны к ролям (находка при create-story, частично разблокирует будущую 16.6d).
- [Source: Backend/VAPS/apps/core/api/exception_handler.py] — `DomainError`→HTTP автомаппинг, не дублируется вручную.

## Dev Agent Record

### Agent Model Used

Claude Sonnet 5

### Debug Log References

### Completion Notes List

Реализовано по AC 1-7. `PlacementAssignmentSerializer`/`AssignmentVersionSerializer`/`AssignmentVersionDetailSerializer` — новые read-only `ModelSerializer`ы в `apps/operations/events/api/serializers.py`, персистентные поля, не пересчитывают конфликты. `placement_draft` — nested `@action` на `SecurityEventViewSet` (`POST /security-events/{id}/placement/draft`), тонкая обёртка над `form_draft_placement()` — не дублирует ни `DomainError`-обработку (уже автомаппится через `exception_handler.py`), ни аудит (уже пишется внутри сервиса). Новый `AssignmentVersionViewSet` (`list`/`retrieve`) + `_require_any_permission()`-хелпер (нет отдельного `assignment.view`-кода — чтение гейтуется «любой из» 4 существующих assignment.*-кодов). Роутер: `assignment-versions` зарегистрирован в `apps/operations/api/urls.py`. 11 новых поведенческих тестов (AC 1-7 по отдельности + межролевое чтение — APPROVER читает версии, созданные OMD), все прошли с первого запуска. `make gate` изначально поймал 3 ожидаемых closed-world/drift-теста: (1) `test_rbac_matrix.py` потребовал строк для 3 новых роутов — добавлен НОВЫЙ класс `_AnyOfGate` (не было готового «любой из N кодов»-гейта в тестовой матрице, буквальный образец `_Gate`); (2) `test_audit_coverage.py` потребовал строку для мутирующего `placement/draft`-роута (`_Audited()`, аудит уже внутри сервиса); (3) `test_schema_drift.py` — исправлено `make schema` ВНУТРИ этой стори (переоткрыто первоначальное Out-of-Scope-намерение «отдельная 16.8g» — см. правку ниже). `make gate` (после) — 3817 passed (было 3776, +41, большинство — параметризованные по ролям строки closed-world матриц), 0 regressions, ruff чист (1 длинная строка в новом `_AnyOfGate`-блоке — `ruff format`), миграций нет (чисто API-стори).

### File List

- `Backend/VAPS/apps/operations/events/api/serializers.py` (modified — `PlacementAssignmentSerializer`/`AssignmentVersionSerializer`/`AssignmentVersionDetailSerializer`)
- `Backend/VAPS/apps/operations/events/api/views.py` (modified — `placement_draft`-action, `AssignmentVersionViewSet`, `_require_any_permission()`)
- `Backend/VAPS/apps/operations/api/urls.py` (modified — регистрация `assignment-versions`)
- `Backend/VAPS/apps/operations/events/tests/test_placement_api.py` (new)
- `Backend/VAPS/apps/operations/tests/test_rbac_matrix.py` (modified — `_AnyOfGate`-класс + 3 новые строки MATRIX)
- `Backend/VAPS/apps/audit/tests/test_audit_coverage.py` (modified — 1 новая строка AUDIT_MATRIX)
- `Backend/VAPS/schema.yaml` (regenerated — `make schema`, новые эндпоинты)

## Change Log

| Дата | Изменение |
|---|---|
| 2026-08-01 | Story создана (create-story). Часть 1/9 расщепления Story 16.8 (backend+frontend+e2e в одной epics.md-строке). Находка: `assignment.create/.submit/.return/.approve`-коды уже засеяны И привязаны к ролям (`seed_operations.py`, вне `apps/operations/rbac/`, поэтому пропущены при 16.6a's grep) — частично разблокирует будущую 16.6d (`ASSIGNMENT_SUBMITTED`→«approver» теперь резолвируем; `ASSIGNMENT_RETURNED`→«creator» всё ещё блокирован, нет `created_by`). Нет отдельного `assignment.view`-кода — чтение гейтуется «любой из» через новый локальный хелпер. |
| 2026-08-01 | Dev-story: `placement_draft`-action + `AssignmentVersionViewSet`. 11 новых тестов, прошли с первого запуска. `make gate` потребовал `_AnyOfGate`-класс (RBAC-матрица), новую строку в audit-матрице, `make schema` (переоткрыто Out-of-Scope — regen внутри этой стори, не 16.8g). `make gate` (после) — 3817 passed, 0 regressions, ruff чист. Status → review. |
