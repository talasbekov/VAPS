---
baseline_commit: 90ecf13
---

# Story 16.8c: API — вернуть Расстановку на доработку

Status: ready-for-dev

## Story

As an **утверждающий с правом `assignment.return` (APPROVER)**,
I want **`POST /api/operations/assignment-versions/{id}/return`**,
so that **поданную на согласование Расстановку можно вернуть планировщику через API, с обязательной причиной**.

`epics.md:1438`: «Story 16.8: API/экраны расстановки + аудит + e2e». Часть 3/9 расщепления (16.8a/b done — черновик+список/деталь, подача).

## Scope Decision (найдено при create-story)

- **Тонкая HTTP-обёртка вокруг УЖЕ существующей `return_assignment_version(version, *, actor, reason)` (16.4).** Та же форма, что 16.8b's `submit`-action, с ОДНИМ структурным отличием — сервис возвращает `(version, new_version)` (СТАРАЯ версия → `RETURNED`, НОВАЯ `DRAFT`-версия создаётся flip-before-insert, 16.4's докстринг), не одну строку.
- **Ответ — расширенный словарь, НЕ новый формальный serializer-класс.** `{**AssignmentVersionDetailSerializer(returned_version).data, "new_draft_version": AssignmentVersionSerializer(new_version).data}` — URL's `{id}` семантически про СТАРУЮ (возвращаемую) версию, `new_draft_version` — минимально необходимая ссылка для клиента, чтобы продолжить редактирование НОВОГО черновика. Вложенный `new_draft_version` — НЕ `Detail`-вариант (без вложенных `assignments` — они и так копия старой версии, `bulk_create`, дублировать в ответе избыточно). Не изобретается отдельный serializer-класс ради одного поля.
- **`reason` — ОБЯЗАТЕЛЬНОЕ тело запроса, `{"reason": "..."}`.** `return_assignment_version()` уже требует непустой `reason` (400 `VALIDATION_ERROR` при пустом/отсутствующем, `detail={"field": "reason"}`, 16.4) — сериализатор запроса (`ReturnVersionSerializer`, минимальный, один `CharField`) валидирует ДО вызова сервиса (тот же выбор, что `DirectAssignmentSerializer` уже делает — `is_valid(raise_exception=True)` перед сервисным вызовом), НЕ дублирует пустую-строку-проверку вручную (сервис уже гарантирует).
- **Право — `assignment.return`, уже засеяно И привязано** (APPROVER, найдено при 16.8a's create-story).
- **НЕ идемпотентна — `return_assignment_version()` СТРОГО требует `SUBMITTED`-исходный статус** (16.4's докстринг: терминальный переход на КОНКРЕТНОЙ строке, не replay-паттерн, как `submit`/`approve`). Повторный `/return` на уже-`RETURNED`-версии — `422 INVALID_LIFECYCLE_TRANSITION` (НЕ 200) — эта стори НЕ добавляет собственную идемпотентность там, где сервис её не несёт.
- **`DomainError`ы автомаппятся** (`VALIDATION_ERROR` 400 пустой `reason`/`actor`; `INVALID_LIFECYCLE_TRANSITION` 422 не-`SUBMITTED`-статус) — не дублируются вручную.
- **Аудит `ASSIGNMENT_VERSION_RETURNED`** — уже пишется ВНУТРИ `return_assignment_version()` самой (16.4, `new_value` несёт `reason`+`new_draft_version_id`), эндпоинт НЕ дублирует.

## Acceptance Criteria

1. **AC-1 (`POST .../{id}/return` — happy path).** Требует `assignment.return`. `SUBMITTED`-версия + непустой `reason` в теле → `200`, ответ несёт `status="RETURNED"` (старой версии) + `new_draft_version` (новая `DRAFT`, `version+1`).
2. **AC-2 (пустой/отсутствующий `reason` — 400).** `VALIDATION_ERROR`, `detail.field == "reason"`.
3. **AC-3 (не-`SUBMITTED` статус — 422, НЕ идемпотентно).** Например, `DRAFT`- или уже-`RETURNED`-версия — `422 INVALID_LIFECYCLE_TRANSITION`.
4. **AC-4 (несуществующий `{id}` → 404, не 500, включая нечисловой `pk`).** Тот же гард, что `_get_assignment_version_or_404()`.
5. **AC-5 (без `assignment.return` → 403).**
6. **AC-6 (новая DRAFT-версия несёт копии назначений старой).** `new_draft_version`'s `PlacementAssignment`-строки (проверяется через `GET .../{new_id}`, 16.8a) совпадают по `employee_id`/`post` со старой версией (переиспользование `return_assignment_version()`'s собственного `bulk_create`-копирования, 16.4).
7. **AC-7 (регресс нулевой, `make gate` зелёный).**

## Out of Scope

- `.../approve` — 16.8d.
- `.../acknowledge` — 16.8e.
- RBAC-строка (код уже существует) / HTTP audit-логирование сверх уже существующего `ASSIGNMENT_VERSION_RETURNED`.

## Tasks / Subtasks

- [ ] Task 1 — `apps/operations/events/api/serializers.py`: `ReturnVersionSerializer` (один `CharField` — `reason`)
- [ ] Task 2 — `@action(detail=True, methods=["post"])` `return` на `AssignmentVersionViewSet` (AC: 1-4, 6) — url_name должен избегать Python-ключевого слова `return` как имени метода (использовать `url_path="return"`, имя метода — НЕ `return`, напр. `return_`)
- [ ] Task 3 — MATRIX/AUDIT_MATRIX-строка (AC: 5, 7)
- [ ] Task 4 — `make schema` регенерация
- [ ] Task 5 — Тесты (AC 1-7, включая нечисловой pk сразу — урок 16.8a/b's ревью)
- [ ] Task 6 — Гейт

## Dev Notes

- `apps/operations/events/services.py::return_assignment_version()` (16.4) — читать целиком: НЕ идемпотентна (в отличие от `submit`/`approve`), возвращает `(version, new_version)`, `reason`-гард, flip-before-insert.
- `apps/operations/events/api/views.py::AssignmentVersionViewSet.submit` (16.8b) — образец тонкой action-обёртки, `http_method_names` уже расширен до `["get", "post", "options"]`.
- `apps/operations/events/api/serializers.py::DirectAssignmentSerializer` — образец `is_valid(raise_exception=True)` перед сервисным вызовом.
- **Именование метода**: `return` — зарезервированное слово Python, метод `@action`-декоратора НЕ может называться `return` буквально (`def return(self, ...)` — `SyntaxError`). Использовать `def return_(...)` с явным `url_path="return"` (даёт `ops-assignment-version-return` через `url_name`, НЕ `ops-assignment-version-return-` — задать `url_name="return"` явно).
- Тесты 16.8a/16.8b's ревью нашли одинаковый пробел дважды (нечисловой `pk`) — писать этот тест СРАЗУ, не дожидаясь ревью.

### References

- [Source: _bmad-output/implementation-artifacts/16-8b-api-подать-на-согласование.md] — буквальный образец тонкой action-обёртки, `http_method_names`-расширение уже сделано.
- [Source: Backend/VAPS/apps/operations/events/services.py] — `return_assignment_version()` (16.4).
- [Source: Backend/VAPS/apps/operations/events/api/views.py] — `AssignmentVersionViewSet` (16.8a/b), точка расширения.

## Dev Agent Record

### Agent Model Used

### Debug Log References

### Completion Notes List

### File List

## Change Log

| Дата | Изменение |
|---|---|
| 2026-08-01 | Story создана (create-story). Часть 3/9 расщепления Story 16.8. Тонкая HTTP-обёртка над `return_assignment_version()` (16.4) — НЕ идемпотентна (в отличие от submit/approve), требует `reason` в теле, возвращает `(старая RETURNED-версия, новая DRAFT-версия)` — ответ несёт оба через расширенный словарь, не новый formal serializer. Найдена ловушка именования метода — `return` зарезервировано Python. |
