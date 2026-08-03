---
baseline_commit: d8e488c
---

# Story 16.8d: API — утвердить Расстановку

Status: done

## Story

As an **утверждающий с правом `assignment.approve` (APPROVER)**,
I want **`POST /api/operations/assignment-versions/{id}/approve`**,
so that **поданную на согласование Расстановку можно утвердить через API — с идемпотентным повтором и override-обходом мягких конфликтов**.

`epics.md:1438`: «Story 16.8: API/экраны расстановки + аудит + e2e». Часть 4/9 расщепления (16.8a/b/c done — черновик+список/деталь, подача, возврат).

## Scope Decision (найдено при create-story)

- **Тонкая HTTP-обёртка вокруг УЖЕ существующей `approve_assignment_version(version, *, actor, override=False, override_reason="")`** (16.4, `services.py:1066`). Структурно ближе к `submit` (16.8b) чем к `return` (16.8c) — **идемпотентна**: повторный вызов на уже-`APPROVED`-версии возвращает `version` без изменений (`services.py:1115-1116`), НЕ 422.
- **НОВОЕ по сравнению с 16.8a/b/c: тело запроса необязательно** — `{}`/пустой POST допустим (approve без override). `{"override": true, "override_reason": "..."}` — обход мягких конфликтов. **Образец сериализатора уже есть**: `apps/operations/statuses/api/serializers.py::BulkStatusCreateSerializer` — `override = BooleanField(required=False)`, `override_reason = CharField(required=False, allow_blank=True)`, читаются через `.get(..., False)`/`.get(..., "")` во вьюхе (10.2a) — **буквально копируется**, НЕ изобретается заново.
- **Ответ — простой `AssignmentVersionDetailSerializer(version).data`** — НЕТ `new_draft_version`-паттерна 16.8c (approve не создаёт новую версию, только переводит текущую в `APPROVED`).
- **`DomainError`ы автомаппятся** — все три ветки сервиса:
  - `VALIDATION_ERROR` 400 — пустой `actor` (не наш случай, всегда есть) ИЛИ `override=True` без непустого `override_reason`.
  - `INVALID_LIFECYCLE_TRANSITION` 422 — статус не `SUBMITTED` и не `APPROVED` (т.е. `DRAFT`/`RETURNED`).
  - `SOFT_CONFLICT_DETECTED` 409, `overridable=True` — есть непросмотренные конфликты (`conflict_severity` непусто на любом assignment) и НЕ (override И непустой override_reason).
- **Право — `assignment.approve`, уже засеяно И привязано** (APPROVER, найдено при 16.8a's create-story).
- **Аудит `ASSIGNMENT_VERSION_APPROVED`** — уже пишется ВНУТРИ `approve_assignment_version()` самой (16.4, `new_value` несёт `event_id`/`signature_hash`/`override`/`override_reason`), НО только на РЕАЛЬНОМ переходе (идемпотентный повтор на уже-`APPROVED` НЕ пишет второй раз — ранний `return` до `record()`, `services.py:1115-1116`). Эндпоинт НЕ дублирует.
- **Побочные эффекты уже реализованы внутри сервиса, эндпоинт их не трогает**: `project_placement_assignment()` (16.5, EVENT_ASSIGNMENT-проекция для каждого участника) и `_notify_assignment_approved()` (16.6a, уведомления участникам+старшему) — ОБА выполняются только на реальном переходе (внутри `with transaction.atomic()`, до `version.save()`), НЕ на идемпотентном повторе. Эта стори их не тестирует заново (уже покрыты 16.5/16.6a-собственными тестами) — тестируется только то, что сам HTTP-эндпоинт вызывает сервис и правильно транслирует его исходы в статус-коды.
- **409 `SOFT_CONFLICT_DETECTED` требует РЕАЛЬНОГО конфликта** — т.е. тест должен создать НАСТОЯЩУЮ конфликтную ситуацию через `detect_placement_conflicts()`'s триггер (не мокать `conflict_severity` вручную на `PlacementAssignment` — сервис вызывает `detect_placement_conflicts(version)` ЗАНОВО перед проверкой, "никогда не доверяет возможно устаревшему предыдущему скану", `services.py:1073`). Самый простой воспроизводимый конфликт из существующих 16.3b/c тестов — двойное назначение одного `employee_id` на два разных поста той же версии (см. `apps/operations/events/tests/test_placement_conflicts.py` за образцом фикстуры).

## Acceptance Criteria

1. **AC-1 (`POST .../{id}/approve` — happy path, без override).** Требует `assignment.approve`. `SUBMITTED`-версия без конфликтов + пустое/отсутствующее тело → `200`, `status="APPROVED"`, `signature_hash` непусто.
2. **AC-2 (идемпотентный повтор — 200, НЕ 422, НЕ дублирует аудит).** Второй `/approve` на уже-`APPROVED`-версии → `200` (не ошибка), `AuditLog.objects.filter(action="ASSIGNMENT_VERSION_APPROVED").count() == 1` (не 2).
3. **AC-3 (конфликт без override — 409 `SOFT_CONFLICT_DETECTED`).** Версия с реальным (двойное назначение) конфликтом, пустое тело → `409`, `error_code="SOFT_CONFLICT_DETECTED"`. **[Уточнено при dev-story]**: `DomainError.overridable` — атрибут исключения, НЕ поле HTTP-конверта (`domain_exception_handler`'s `_envelope()` не прокидывает его в ответ) — тестируется на уровне сервиса (`test_assignment_version_workflow.py`), не через API-ответ.
4. **AC-4 (конфликт с override — 200, обходит).** Та же версия, `{"override": true, "override_reason": "Разрешено вручную"}` → `200`, `status="APPROVED"`.
5. **AC-5 (`override=true` без `override_reason` — 400).** `VALIDATION_ERROR`.
6. **AC-6 (не-`SUBMITTED`/не-`APPROVED` статус — 422).** Например, `DRAFT`- или `RETURNED`-версия → `422 INVALID_LIFECYCLE_TRANSITION`.
7. **AC-7 (несуществующий `{id}` → 404, не 500, включая нечисловой `pk`).**
8. **AC-8 (без `assignment.approve` → 403).**
9. **AC-9 (регресс нулевой, `make gate` зелёный).**

## Out of Scope

- `.../acknowledge` — 16.8e.
- `.../conflicts` (детальный список конфликтов версии) — 16.8f.
- RBAC-строка (код уже существует) / HTTP audit-логирование сверх уже существующего `ASSIGNMENT_VERSION_APPROVED`.
- Повторное тестирование 16.5's EVENT_ASSIGNMENT-проекции или 16.6a's уведомлений — уже покрыты их собственными тестами; эта стори тестирует только HTTP-транспорт до сервиса.

## Tasks / Subtasks

- [x] Task 1 — `apps/operations/events/api/serializers.py`: `ApproveVersionSerializer` (`override = BooleanField(required=False)`, `override_reason = CharField(required=False, allow_blank=True)` — буквальная копия `BulkStatusCreateSerializer`'s полей, 10.2a)
- [x] Task 2 — `@action(detail=True, methods=["post"])` `approve` на `AssignmentVersionViewSet` (AC: 1-8)
- [x] Task 3 — MATRIX/AUDIT_MATRIX-строка (AC: 8, 9)
- [x] Task 4 — `make schema` регенерация
- [x] Task 5 — Тесты (AC 1-9, включая нечисловой pk сразу, включая РЕАЛЬНЫЙ конфликт через `detect_placement_conflicts()`'s триггер — не мок)
- [x] Task 6 — Гейт

## Dev Notes

- `apps/operations/events/services.py::approve_assignment_version()` (16.4, строки 1066-1169) — читать целиком: ИДЕМПОТЕНТНА (в отличие от `return_assignment_version`, как `submit`), опциональные `override`/`override_reason`, 409 `SOFT_CONFLICT_DETECTED` при непросмотренных конфликтах.
- `apps/operations/statuses/api/serializers.py::BulkStatusCreateSerializer` (10.2a) — буквальный образец `override`/`override_reason`-полей сериализатора, включая комментарий про НАМЕРЕННОЕ отсутствие `default=` (openapi-typescript трактует `default=` как всегда-присутствующее поле в TS-типе — читать этот комментарий перед копированием).
- `apps/operations/statuses/api/views.py:105-131` — образец чтения через `form.validated_data.get("override", False)`/`.get("override_reason", "")` во вьюхе.
- `apps/operations/events/api/views.py::AssignmentVersionViewSet.submit`/`.return_` (16.8b/c) — тонкая action-обёртка, `http_method_names` уже расширен до `["get", "post", "options"]`.
- Для AC-3/AC-4 нужен РЕАЛЬНЫЙ конфликт — смотреть `apps/operations/events/tests/test_placement_conflicts.py` за минимальной воспроизводимой фикстурой (двойное назначение одного `employee_id` на два поста той же версии — 16.3b's тип конфликта, самый простой).
- Тесты 16.8a/b/c's ревью нашли одинаковый пробел трижды (нечисловой `pk`) — писать этот тест СРАЗУ, не дожидаясь ревью.
- 16.8c's ревью нашло: `@extend_schema`'s `responses=` должен ТОЧНО отражать реально возвращаемый словарь (там понадобился отдельный `AssignmentVersionReturnResponseSerializer`, т.к. ответ включал лишний ключ). Здесь ответ — простой `AssignmentVersionDetailSerializer(version).data` без добавленных ключей, так что `responses={200: AssignmentVersionDetailSerializer}` корректен без обёртки — но перепроверить на dev-story, что во вьюхе НЕТ ручной мутации словаря перед `Response(...)`.

### References

- [Source: _bmad-output/implementation-artifacts/16-8c-api-вернуть-на-доработку.md] — литеральный образец тонкой action-обёртки + пробелы, найденные в её ревью.
- [Source: Backend/VAPS/apps/operations/events/services.py:1066-1169] — `approve_assignment_version()` (16.4).
- [Source: Backend/VAPS/apps/operations/statuses/api/serializers.py:31-51] — `override`/`override_reason`-сериализатор, образец (10.2a).
- [Source: Backend/VAPS/apps/operations/events/api/views.py] — `AssignmentVersionViewSet` (16.8a/b/c), точка расширения.

## Dev Agent Record

### Agent Model Used

Claude Sonnet 5

### Debug Log References

### Completion Notes List

Реализовано по AC 1-9. `ApproveVersionSerializer` (`override`/`override_reason`, буквальная копия 10.2a's `BulkStatusCreateSerializer`-полей) в `apps/operations/events/api/serializers.py`. `approve`-action на `AssignmentVersionViewSet` — `require_permission` → `ApproveVersionSerializer.is_valid()` → `_get_assignment_version_or_404()` → `approve_assignment_version()` → `AssignmentVersionDetailSerializer(version).data` (простой, без обёртки — approve не создаёт новую версию). **Уточнено при dev-story**: AC-3's `overridable`-заявление скорректировано — это атрибут исключения `DomainError.overridable`, `domain_exception_handler`'s `_envelope()` его в HTTP-ответ НЕ прокидывает (проверено чтением кода до написания теста) — тест ассертит только `error_code`. 9 новых поведенческих тестов (AC 1-9 по отдельности), включая нечисловой `pk` сразу и РЕАЛЬНЫЙ двойной-конфликт через два overlapping-события с общим `employee_id` (не мок `conflict_severity`) — все прошли после однократной правки (overridable-ассерт). Новые строки в `test_rbac_matrix.py`/`test_audit_coverage.py`. `make gate` — 3875 passed (было 3856, +19), 0 regressions, ruff чист, `make schema` (48 новых строк), миграций нет.

### File List

- `Backend/VAPS/apps/operations/events/api/serializers.py` (modified — `ApproveVersionSerializer`)
- `Backend/VAPS/apps/operations/events/api/views.py` (modified — `approve`-action)
- `Backend/VAPS/apps/operations/events/tests/test_assignment_version_approve_api.py` (new)
- `Backend/VAPS/apps/operations/tests/test_rbac_matrix.py` (modified — 1 новая строка MATRIX)
- `Backend/VAPS/apps/audit/tests/test_audit_coverage.py` (modified — 1 новая строка AUDIT_MATRIX)
- `Backend/VAPS/schema.yaml` (regenerated — `make schema`, новый эндпоинт)

**После ревью:**
- `Backend/VAPS/apps/operations/events/tests/test_assignment_version_approve_api.py` (modified — 3 новых теста)

## Change Log

| Дата | Изменение |
|---|---|
| 2026-08-03 | Story создана (create-story). Часть 4/9 расщепления Story 16.8. Тонкая HTTP-обёртка над `approve_assignment_version()` (16.4) — ИДЕМПОТЕНТНА (в отличие от 16.8c's return), опциональные `override`/`override_reason` (копия 10.2a's сериализатора), 409 `SOFT_CONFLICT_DETECTED` overridable при непросмотренных конфликтах. Ultimate context engine analysis completed - comprehensive developer guide created. |
| 2026-08-03 | Dev-story: `ApproveVersionSerializer` + `approve`-action. Уточнено AC-3 — `overridable` не в HTTP-конверте, только атрибут исключения. 9 новых тестов, включая реальный двойной-конфликт через overlapping-события. `make gate` — 3875 passed, 0 regressions, ruff чист, `make schema`. Status → review. |
| 2026-08-03 | 3-agent ревью (Blind Hunter, Edge Case Hunter, Acceptance Auditor). Acceptance Auditor: red-probe подтвердил AC-3's конфликт-тест НЕ вакуумен (нейтрализация `has_conflicts` в сервисе красит тест). Edge Case Hunter и Acceptance Auditor независимо совпали на пробеле AC-6 (`RETURNED`-статус не тестировался отдельно от `DRAFT`). Добавлены 3 новых теста: whitespace-only `override_reason` (отдельный код-путь от полностью-пустого), идемпотентный повтор ПОСЛЕ появления конфликта у другой версии (доказывает ранний идемпотентный `return` пропускает `detect_placement_conflicts()`), `RETURNED`-версия → 422. Blind Hunter's находки — все ложные срабатывания/вне-скоупа: "override_reason не аудируется" опровергнуто чтением кода сервиса (аудируется, `new_value["override_reason"]`); "нет отдельного права на override" / "нет optimistic concurrency" / "overridable выпадает из конверта" — архитектурные вне-скоупа для тонкой HTTP-обёртки, последнее уже задокументировано в AC-3. `make gate` повторно — 3878 passed, 0 regressions, ruff чист, миграций нет. Status → done. |
