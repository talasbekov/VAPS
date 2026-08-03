---
baseline_commit: 30f3ab0
---

# Story 16.8b: API — подать Расстановку на согласование

Status: review

## Story

As an **оператор с правом `assignment.submit` (OMD/SENIOR_COORDINATOR)**,
I want **`POST /api/operations/assignment-versions/{id}/submit`**,
so that **черновик Расстановки можно перевести в `SUBMITTED` через API, минуя прямую работу с ORM**.

`epics.md:1438`: «Story 16.8: API/экраны расстановки + аудит + e2e». Часть 2/9 расщепления (16.8a done — черновик+список/деталь версий).

## Scope Decision (найдено при create-story)

- **Тонкая HTTP-обёртка вокруг УЖЕ существующей `submit_assignment_version(version, *, actor)` (16.4).** Буквальный образец — 14.11c (`POST .../{id}/approve` для `DutyPlan`, та же форма: `require_permission` → `get_object_or_404` → сервисный вызов → сериализованный ответ, БЕЗ собственной state-machine-логики).
- **`submit_assignment_version()` — идемпотентна по дизайну, подтверждено тестом 16.4 (`test_submit_replay_on_already_submitted_is_idempotent`).** API-слой относится к повторному `/submit` как к чистому `200`, НЕ как к ошибке — та же формулировка, что 14.11c's Scope Decision про `approve_duty_plan()`.
- **Роут — `@action(detail=True, methods=["post"])` `submit` на существующем `AssignmentVersionViewSet` (16.8a), НЕ отдельный ViewSet.** Даёт имя `ops-assignment-version-submit` (паттерн `{basename}-{action}`, тот же, что `ops-duty-plan-approve`).
- **Право — `assignment.submit`, уже засеяно И привязано** (OMD/SENIOR_COORDINATOR, найдено при 16.8a's create-story) — НЕ `_require_any_permission()` (тот хелпер — только для read-эндпоинтов без выделенного кода; здесь код есть, единственный).
- **Ответ — `AssignmentVersionDetailSerializer` (16.8a), `200`.** Тот же выбор, что `placement_draft`'s ответ (16.8a) — согласованность формы ответа для всех action-эндпоинтов этого ресурса (не переключаться между `Serializer`/`DetailSerializer` без причины).
- **`DomainError`ы `submit_assignment_version()` (`VALIDATION_ERROR` 400 при пустом actor — недостижимо через API, `request.actor_id` уже гарантированно непустой к этой точке; `INVALID_LIFECYCLE_TRANSITION` 422 для не-DRAFT/не-SUBMITTED статуса) — автомаппятся, не дублируются вручную.**
- **Аудит `ASSIGNMENT_VERSION_SUBMITTED`** — уже пишется ВНУТРИ `submit_assignment_version()` самой (16.4, только на реальном переходе, не на idempotent replay), эндпоинт НЕ дублирует.

## Acceptance Criteria

1. **AC-1 (`POST .../{id}/submit` — happy path).** Требует `assignment.submit`. `DRAFT`-версия → `200`, сериализованная `AssignmentVersion` со `status="SUBMITTED"`.
2. **AC-2 (повторный `/submit` на уже `SUBMITTED` — чистый 200, идемпотентно).** НЕ ошибка; аудит-строка не дублируется (переиспользование `submit_assignment_version()`'s собственной идемпотентности, 16.4).
3. **AC-3 (не-`DRAFT`/не-`SUBMITTED` статус — 422).** Например, `APPROVED`-версия — `422 INVALID_LIFECYCLE_TRANSITION`.
4. **AC-4 (несуществующий `{id}` → 404, не 500).** Тот же гард, что `_get_assignment_version_or_404()` (16.8a).
5. **AC-5 (без `assignment.submit` → 403).**
6. **AC-6 (регресс нулевой, `make gate` зелёный).**

## Out of Scope

- `.../return`/`.../approve` — 16.8c/d.
- `.../acknowledge` — 16.8e.
- RBAC-строка (код уже существует) / HTTP audit-логирование сверх уже существующего `ASSIGNMENT_VERSION_SUBMITTED`.

## Tasks / Subtasks

- [x] Task 1 — `@action(detail=True, methods=["post"])` `submit` на `AssignmentVersionViewSet` (AC: 1-4)
- [x] Task 2 — MATRIX/AUDIT_MATRIX-строка (AC: 5, 6)
  - [x] `ops-assignment-version-submit` — `_Gate("assignment.submit")` в `test_rbac_matrix.py`, `_Audited()` в `test_audit_coverage.py`
- [x] Task 3 — `make schema` регенерация
- [x] Task 4 — Тесты (AC 1-6)
- [x] Task 5 — Гейт

## Dev Notes

- `apps/operations/events/services.py::submit_assignment_version()` (16.4) — читать целиком перед правкой: идемпотентность, `INVALID_LIFECYCLE_TRANSITION`-гард, уже пишет аудит.
- `apps/operations/duties/api/views.py::DutyPlanViewSet.approve` (14.11c) — буквальный образец тонкой action-обёртки над идемпотентным сервисом.
- `apps/operations/events/api/views.py::AssignmentVersionViewSet` (16.8a) — точка расширения, `_get_assignment_version_or_404()`, `AssignmentVersionDetailSerializer` уже существуют.
- `apps/operations/tests/test_rbac_matrix.py`/`apps/audit/tests/test_audit_coverage.py` — closed-world completeness, требуют новую строку (тот же урок, что 16.8a's dev-story: gate ловит недостающую строку).

### References

- [Source: _bmad-output/implementation-artifacts/14-11c-api-approve-плана-дежурств.md] — буквальный образец тонкой action-обёртки + Scope Decision структуры.
- [Source: Backend/VAPS/apps/operations/events/services.py] — `submit_assignment_version()` (16.4).
- [Source: Backend/VAPS/apps/operations/events/api/views.py] — `AssignmentVersionViewSet` (16.8a), точка расширения.
- [Source: _bmad-output/implementation-artifacts/16-8a-api-черновик-и-список-версий.md] — `assignment.submit`-код уже засеян/привязан (находка при 16.8a's create-story), `_get_assignment_version_or_404()`/`AssignmentVersionDetailSerializer` уже существуют.

## Dev Agent Record

### Agent Model Used

Claude Sonnet 5

### Debug Log References

### Completion Notes List

Реализовано по AC 1-6. `submit`-action добавлен на `AssignmentVersionViewSet` (16.8a) — `require_permission(request, "assignment.submit")` → `_get_assignment_version_or_404()` → `submit_assignment_version()` → `AssignmentVersionDetailSerializer`. **Найдено при реализации, не в Scope Decision**: `AssignmentVersionViewSet.http_method_names` (16.8a) был `["get", "options"]` — чисто read-only ViewSet, POST-actions физически не проходили бы (405, подтверждено живым красным прогоном тестов) — расширено до `["get", "post", "options"]`, докстринг ViewSet'а обновлён (16.8b и далее ЖИВУТ на этом же ViewSet'е, не read-only навсегда, как было заявлено в 16.8a's докстринге). Новые строки в `test_rbac_matrix.py` (`_Gate("assignment.submit")`) и `test_audit_coverage.py` (`_Audited()`, эмиссия внутри сервиса, не дублируется). 5 новых поведенческих тестов (AC 1-6, кроме AC-6 — гейт), все прошли после исправления `http_method_names` (изначально 5 из 5 падали 405, живой сигнал ошибки — не тихий пропуск). `make gate` — 3834 passed (было 3819, +15), 0 regressions, ruff чист, `make schema` (21 новых строк для нового эндпоинта), миграций нет.

### File List

- `Backend/VAPS/apps/operations/events/api/views.py` (modified — `submit`-action, `http_method_names` расширен до `["get", "post", "options"]`)
- `Backend/VAPS/apps/operations/events/tests/test_assignment_version_submit_api.py` (new)
- `Backend/VAPS/apps/operations/tests/test_rbac_matrix.py` (modified — 1 новая строка MATRIX)
- `Backend/VAPS/apps/audit/tests/test_audit_coverage.py` (modified — 1 новая строка AUDIT_MATRIX)
- `Backend/VAPS/schema.yaml` (regenerated — `make schema`, новый эндпоинт)

## Change Log

| Дата | Изменение |
|---|---|
| 2026-08-01 | Story создана (create-story). Часть 2/9 расщепления Story 16.8. Тонкая HTTP-обёртка над уже идемпотентным `submit_assignment_version()` (16.4), буквальный образец 14.11c (`approve`-action для `DutyPlan`). Право `assignment.submit` уже засеяно/привязано (16.8a's находка) — не изобретается. |
| 2026-08-01 | Dev-story: `submit`-action. Найдено живым красным прогоном — `AssignmentVersionViewSet.http_method_names` (16.8a) был read-only (`["get","options"]`), расширен до `["get","post","options"]`. 5 новых тестов, прошли после исправления. `make gate` — 3834 passed, 0 regressions, ruff чист, `make schema`. Status → review. |
