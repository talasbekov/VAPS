---
baseline_commit: 08ace73
---

# Story 17.7b: API — оперативное изменение

Status: review

## Story

As a **держатель права `assignment.amend`**,
I want **REST-эндпоинты для оперативного изменения Расстановки после утверждения (17.3) и каскадной замены выбывшего (17.5)**,
so that **фронтенд (17.7d) и внешние клиенты могут вызвать `amend_assignment_version()`/`cascade_replace_departed()` без прямого доступа к сервисному слою**.

## Scope Decision

- **Два новых `@action`'а на СУЩЕСТВУЮЩЕМ `AssignmentVersionViewSet`** (`apps/operations/events/api/views.py:596-`) — тот же ViewSet, что уже несёт `submit`/`return`/`approve`/`conflicts` (16.8b-d). НЕ новый ViewSet — `amend`/`replace-departed` мутируют/порождают версию по её собственному id, тот же класс операций, что `approve`.
  - `POST /api/operations/assignment-versions/{id}/amend/` → `amend_assignment_version()` (17.3). Требует `assignment.amend`.
  - `POST /api/operations/assignment-versions/{id}/replace-departed/` → `cascade_replace_departed()` (17.5). Требует `assignment.amend` (та же PROVISIONAL-код, что 17.3 — 17.5's Scope Decision явно делегирует всю мутацию в `amend_assignment_version()`, отдельного RBAC-кода не заводило).
- **`amend`-эндпоинт принимает ПОЛНЫЙ новый состав** (`reason`, `sanction`, `assignments: [{employee_id, post, is_unplanned?, source_division_id?, source_duty_shift_id?}]`) — сервис ожидает готовый список, не diff; эндпоинт — тонкая обёртка, конструирование diff'ов НЕ входит в scope (Story 17.7d, фронтенд, решает UI для построения списка).
- **`replace-departed`-эндпоинт** принимает `departed_employee_id`, `reason`, `sanction`, опционально `manual_replacement_employee_id` — прямой проброс в `cascade_replace_departed()`. НЕ строит `assignments`-список сам (это делает сервис внутри).
- **Ответ обоих эндпоинтов** — `AssignmentVersionDetailSerializer` (новая версия, литерал того же сериализатора, что `retrieve`/`submit`/`approve`) с кодом 201 (создаётся НОВАЯ версия — `is_current` переключается на новую строку, не мутация существующей, в отличие от `submit`/`approve` которые возвращают 200 на ту же строку).
- **`REPLACEMENT_NOT_FOUND` (409, уже в `error-codes.yaml:192`)** — транслируется DRF-хендлером автоматически (тот же generic `DomainError → Response` маппинг, что все остальные сервисные ошибки этого приложения); эндпоинт не добавляет собственной обработки.
- **Guard-порядок** — `require_permission()` ДО `_get_assignment_version_or_404(pk)` — литеральный прецедент 17.7a (review-найденный баг, зафиксированный там; здесь пишем правильно с первого раза).
- **`@extend_schema`** — на КАЖДОМ `@action` по одному декоратору (не combined GET+POST, как 17.7a) — коллизия из 17.7a's ревью здесь структурно невозможна (разные url_path, разные operationId по умолчанию), но каждый декоратор всё равно получает явный `request=`/`responses=` (не полагаться на auto-detection).
- **Out of scope**: построение `assignments`-diff на бэке (UI-забота, 17.7d); допнаряд-специфичный эндпоинт (17.4's поля уже часть общего `assignments`-спека, отдельного маршрута не требуется — epics.md не просит отдельный "допнаряд"-эндпоинт).

## Acceptance Criteria

1. **AC-1.** `POST /api/operations/assignment-versions/{id}/amend/` с валидным `reason`/`sanction`/`assignments`, актор с `assignment.amend`, версия — текущая APPROVED, событие IN_PROGRESS → 201, тело — новая версия (`AssignmentVersionDetailSerializer`).
2. **AC-2.** То же без `assignment.amend` → 403.
3. **AC-3.** `reason`/`sanction` пустые → 400 (сервисный `VALIDATION_ERROR`, транслированный).
4. **AC-4.** Версия не текущая/не APPROVED → 422 (`INVALID_LIFECYCLE_TRANSITION`).
5. **AC-5.** `POST /api/operations/assignment-versions/{id}/replace-departed/` с валидным `departed_employee_id`/`reason`/`sanction`, кандидат найден (Tier 1 или 2) → 201, тело — новая версия, пост выбывшего переназначен.
6. **AC-6.** Кандидат не найден ни на одном уровне → 409 `REPLACEMENT_NOT_FOUND` (транслированный, эскалационный аудит-ряд пишет сам сервис).
7. **AC-7.** `manual_replacement_employee_id` передан → сервис пропускает авто-поиск (проверка непосредственно через сервисный юнит-тест 17.5, эндпоинт лишь пробрасывает поле — здесь проверяется round-trip параметра в вызов).
8. **AC-8.** Оба эндпоинта без `assignment.amend` → 403 (RBAC-матрица покрывает оба новых route).
9. **AC-9.** `make gate` (Backend/VAPS) зелёный, включая `make schema` (drift-тест).

## Out of Scope

- Построение `assignments`-diff/UI (17.7d).
- Фронтенд (17.7d).
- e2e (17.7e).
- Отдельный RBAC-код для `replace-departed` (использует существующий `assignment.amend`, как задокументировано в 17.5's Scope Decision).

## Tasks / Subtasks

- [x] Task 1 — `apps/operations/events/api/serializers.py`: `AmendAssignmentVersionRequestSerializer` (`reason`, `sanction`, `assignments` — nested list serializer с полями `employee_id`/`post`/`is_unplanned`?/`source_division_id`?/`source_duty_shift_id`?), `ReplaceDepartedRequestSerializer` (`departed_employee_id`, `reason`, `sanction`, `manual_replacement_employee_id`?)
- [x] Task 2 — `apps/operations/events/api/views.py`: `AssignmentVersionViewSet.amend` и `.replace_departed` `@action`'ы (permission-ДО-404, литерал `submit`/`approve` для guard-порядка и структуры ответа)
- [x] Task 3 — Тесты (AC 1-9): create/403/400-empty-reason/422-not-current/replace-success/409-not-found/manual-replacement-round-trip/rbac-matrix
- [x] Task 4 — RBAC-матрица (`test_rbac_matrix.py`) + audit-матрица (`test_audit_coverage.py`) — новые записи для `ops-assignment-version-amend`/`ops-assignment-version-replace-departed`
- [x] Task 5 — `make gate` + `make schema`

## Dev Notes

- `apps/operations/events/api/views.py:660-700` (`AssignmentVersionViewSet.submit`/`.approve`) — буквальный образец: `require_permission()` → form validate → `_get_assignment_version_or_404(pk)` → сервис-вызов → сериализованный ответ. **ВНИМАНИЕ**: в текущем коде permission идёт ПЕРВЫМ, `_get_..._or_404` — ВТОРЫМ (уже правильный порядок в этом ViewSet, в отличие от 17.7a's первого черновика) — следовать буквально этой же последовательности.
- `apps/operations/events/services.py:1627` (`amend_assignment_version`) — сигнатура `(version, *, actor, reason, sanction, assignments)`, гарды actor→reason→sanction→lifecycle(is_current+APPROVED)→event IN_PROGRESS→per-spec validation, возвращает НОВУЮ версию.
- `apps/operations/events/services.py:1805` (`cascade_replace_departed`) — сигнатура `(version, *, actor, departed_employee_id, reason, sanction, manual_replacement_employee_id=None)`, делегирует всю мутацию в `amend_assignment_version()`, эскалация → `DomainError("REPLACEMENT_NOT_FOUND", 409, ...)` без создания версии.
- `docs/registries/error-codes.yaml:192` — `REPLACEMENT_NOT_FOUND` уже зарегистрирован (17.5), новый код не нужен.
- `apps/operations/management/commands/seed_operations.py:18,80,90,98` — `assignment.amend` уже сеяна (17.3, PROVISIONAL) для нужных ролей.
- `apps/operations/events/api/serializers.py:189-199` (`ReturnVersionSerializer`/`ApproveVersionSerializer`) — образец плоского `serializers.Serializer` для write-only request body; для `assignments` (nested list) — образец аналогичной nested-list структуры искать в `DirectAssignmentSerializer` или строить `serializers.ListField(child=serializers.DictField())` с ручной валидацией внутри сервиса (сервис уже валидирует каждый spec — эндпоинт не должен дублировать).

### References

- [Source: Backend/VAPS/apps/operations/events/api/views.py:596-741] — `AssignmentVersionViewSet` (submit/return/approve — образец).
- [Source: Backend/VAPS/apps/operations/events/services.py:1627] — `amend_assignment_version()`.
- [Source: Backend/VAPS/apps/operations/events/services.py:1805] — `cascade_replace_departed()`.
- [Source: Backend/VAPS/apps/operations/events/api/serializers.py:146-215] — существующие сериализаторы этого домена.
- [Source: docs/registries/error-codes.yaml:192] — `REPLACEMENT_NOT_FOUND`.

## Dev Agent Record

### Agent Model Used

Claude Sonnet 5

### Debug Log References

### Completion Notes List

Реализовано по AC 1-9. `amend`/`replace_departed` `@action`'ы на существующем `AssignmentVersionViewSet` (16.8), permission-ДО-404 с первого черновика (литерал 17.7a's review-фикса — не повторяю тот баг). Оба эндпоинта возвращают 201 (новая версия, не мутация существующей строки — отличие от `submit`/`approve`'s 200). `AmendAssignmentSpecSerializer` — nested list, зеркалит сервисный dict-spec 1:1 (17.4), per-spec-валидация НЕ дублируется — остаётся в сервисе. RBAC/audit-матрицы дополнены двумя строками (`assignment.amend` для обоих — 17.5's Scope Decision: `replace-departed` не заводит отдельный код). `make schema` перегенерирован — `assignment_version_amend`/`assignment_version_replace_departed` operationId подтверждены в `schema.yaml`. `make gate` — 4072 passed (было 4043), 0 regressions, ruff чист, drift-check чист.

### File List

- `Backend/VAPS/apps/operations/events/api/serializers.py` (modified — `AmendAssignmentSpecSerializer`, `AmendAssignmentVersionRequestSerializer`, `ReplaceDepartedRequestSerializer`)
- `Backend/VAPS/apps/operations/events/api/views.py` (modified — `AssignmentVersionViewSet.amend`, `.replace_departed`, imports)
- `Backend/VAPS/apps/operations/events/tests/test_amend_replace_api.py` (new — 9 тестов)
- `Backend/VAPS/apps/operations/tests/test_rbac_matrix.py` (modified — 2 новые строки матрицы)
- `Backend/VAPS/apps/audit/tests/test_audit_coverage.py` (modified — 2 новые строки матрицы)
- `Backend/VAPS/schema.yaml` (regenerated)

## Change Log

| Дата | Изменение |
|---|---|
| 2026-08-04 | Story создана (create-story), часть декомпозиции 17.7 — расширяет существующий `AssignmentVersionViewSet` (16.8) двумя новыми `@action`'ами. |
| 2026-08-04 | Dev-story: `amend`/`replace_departed` `@action`'ы + сериализаторы + 9 новых тестов + RBAC/audit-матрицы. `make gate` — 4072 passed, 0 regressions. Status → review. |
