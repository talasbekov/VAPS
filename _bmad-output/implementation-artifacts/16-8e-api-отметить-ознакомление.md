---
baseline_commit: 770fdb6
---

# Story 16.8e: API — отметить ознакомление

Status: done

## Story

As an **участник расстановки (назначенный сотрудник)**,
I want **`POST /api/operations/placement-assignments/{id}/acknowledge`**,
so that **я могу подтвердить, что видел своё назначение, через API — без роли/RBAC-кода, только личность (я = этот сотрудник)**.

`epics.md:1438`: «Story 16.8: API/экраны расстановки + аудит + e2e». Часть 5/9 расщепления (16.8a-d done — черновик+список/деталь, подача, возврат, утверждение).

## Scope Decision (найдено при create-story)

- **НОВЫЙ ресурс, НЕ действие на `AssignmentVersionViewSet`.** `acknowledge_placement_assignment(assignment, *, actor)` (16.6b) работает на `PlacementAssignment`, не на `AssignmentVersion` — плоский `PlacementAssignmentViewSet(viewsets.ViewSet)`, зарегистрированный на `placement-assignments`, СЕЙЧАС только с одним `acknowledge`-действием (тот же инкрементальный паттерн, что `AssignmentVersionViewSet` прошёл в 16.8a→d — action-only ViewSet, list/retrieve НЕ нужны: чтение назначений уже есть через `assignment-versions/{id}` вложенным `assignments`, 16.8a).
- **НЕ RBAC permission-код — identity-проверка.** 16.6b's Scope Decision (буквально, `16-6b-отметка-ознакомления.md:19`) явно откладывает «actor == назначенный сотрудник» на Story 16.8 как API/permissions-слой. Здесь эта проверка РЕАЛИЗУЕТСЯ: гейт = "any authenticated" (нет `assignment.acknowledge`-кода, он и не нужен — это не ролевое право, а самообслуживание), плюс identity-проверка внутри вьюхи — `request.actor_id` (внешний auth-id, строка) должен резолвиться через `UserEmployeeBinding` в ТОГО ЖЕ `Employee`, что `assignment.employee_id`. Буквальный образец гейта — `apps.notifications.api.views.NotificationViewSet.initial()` (5.7c/11.4a): "Gate = authentication, no RBAC code... foreign notification → 403" — ОДИН-В-ОДИН тот же паттерн (там `recipient == request.actor_id` напрямую, здесь через мостик `UserEmployeeBinding`, т.к. `employee_id` — не то же самое, что `actor_id`/`user_id`).
- **НОВЫЙ reverse-селектор `CoreEmployeeSelector.employee_id_for(user_id)`** в `apps/core/selectors.py` — **ОБЯЗАТЕЛЕН**, НЕ опционален: `apps/operations/tests/test_isolation.py::test_operations_does_not_import_core_models` — AST-скан, ЗАПРЕЩАЕТ `apps.operations.*` импортировать `apps.core.models` напрямую (ARCH-003). Прямой `UserEmployeeBinding.objects.filter(...)` во вьюхе `apps/operations/events/api/views.py` СЛОМАЕТ этот гард. Симметричный reverse к уже существующему `user_ids_for(employee_ids)` (16.6a, `employee_id -> user_id`, bulk) — новый метод `employee_id_for(user_id) -> uuid | None` (единичный, не bulk — идентичность одного actor'а за раз, не пачка).
- **Ответ — `PlacementAssignmentSerializer(assignment).data`** (16.8a, уже существует, read-only).
- **`DomainError`ы автомаппятся** — `VALIDATION_ERROR` 400 (пустой `actor` — недостижимо через API, `request.actor_id` уже гарантированно непусто вьюхой до вызова сервиса), `INVALID_LIFECYCLE_TRANSITION` 422 (версия не `APPROVED`).
- **Идентичность НЕ проходит через `DomainError`** — `403 PermissionDenied` (DRF-стандартный, как `NotificationViewSet`'s "foreign notification → 403"), НЕ вызов сервиса вовсе при несовпадении (сервис даже не достигается — фильтр identity ДО сервисного вызова, тот же порядок, что все action'ы `AssignmentVersionViewSet` уже используют: гейт → тело/identity → 404-lookup → сервис).
- **Право на `assignment.approve`/`.submit`/`.return`/`.create` (штатные роли ОМД/APPROVER) — НЕ обходит identity-проверку.** Согласование/утверждение и самообслуживание-ознакомление — РАЗНЫЕ операции; ОМД/APPROVER акт "от имени" сотрудника — явно вне объёма (16.6b's докстринг: "не изобретается здесь").
- **Идемпотентна** (16.6b: "first ack wins", повторный вызов — чистый `200`, `acknowledged_at` не меняется, аудит не дублируется) — как `submit`/`approve`, НЕ как `return`.
- **Аудит `PLACEMENT_ASSIGNMENT_ACKNOWLEDGED`** — уже пишется ВНУТРИ `acknowledge_placement_assignment()` самой (16.6b), только на РЕАЛЬНОМ переходе. Эндпоинт не дублирует.
- **Сотрудник без `UserEmployeeBinding` (не имеет логина) не может отметить ознакомление через API вовсе** — `employee_id_for()` вернёт `None`, что НИКОГДА не равно реальному `assignment.employee_id` (UUID) → `403`. Это ожидаемо: у сотрудника без учётки физически нет `actor_id`, которым он мог бы вызвать API — не новый пробел, тот же класс, что `user_ids_for()`'s "no data = skip" (16.6a).

## Acceptance Criteria

1. **AC-1 (`POST .../{id}/acknowledge` — happy path).** `APPROVED`-версия, `assignment.employee_id` имеет `UserEmployeeBinding` на `request.actor_id`, вызывающий = ЭТОТ actor → `200`, `acknowledged_at` непусто.
2. **AC-2 (идемпотентный повтор — 200, `acknowledged_at` НЕ меняется, аудит не дублируется).** Второй `/acknowledge` тем же actor'ом → `200`, то же значение `acknowledged_at`, что и после первого вызова, `AuditLog.objects.filter(action="PLACEMENT_ASSIGNMENT_ACKNOWLEDGED").count() == 1`.
3. **AC-3 (чужое назначение — 403, идентичность не совпадает).** `actor` с валидной `UserEmployeeBinding`, но на ДРУГОГО `employee_id`, чем у `assignment` → `403`, сервис НЕ вызывается (аудит-строка не создаётся вовсе).
4. **AC-4 (нет `UserEmployeeBinding` вообще — 403).** Authenticated `actor` без привязки → `403` (не 500, не молчаливый "как будто бы совпало").
5. **AC-5 (версия не `APPROVED` — 422).** Например, назначение внутри `SUBMITTED`-версии → `422 INVALID_LIFECYCLE_TRANSITION`.
6. **AC-6 (несуществующий `{id}` → 404, не 500, включая нечисловой `pk`).**
7. **AC-7 (анонимный вызов — 403, не 401/500).** Без `X-User-Id` → `403` (тот же контракт, что `NotificationViewSet.initial()`'s "no actor_id → 403").
8. **AC-8 (регресс нулевой, `make gate` зелёный, `test_isolation.py` не сломан).**

## Out of Scope

- ОМД/APPROVER отмечающий "от имени" сотрудника — явно вне объёма (16.6b's докстринг).
- `.../conflicts` (детальный список конфликтов версии) — 16.8f.
- RBAC MATRIX-строка использует `_AnyAuthenticated()`, НЕ `_Gate(код)` — новой permission-строки НЕ заводится, т.к. права нет.

## Tasks / Subtasks

- [x] Task 1 — `apps/core/selectors.py::CoreEmployeeSelector.employee_id_for(user_id)` — единичный reverse-lookup `UserEmployeeBinding.objects.filter(user_id=...).values_list("employee_id", flat=True).first()`
- [x] Task 2 — `apps/operations/events/api/serializers.py`: ничего нового (переиспользуется `PlacementAssignmentSerializer`, 16.8a)
- [x] Task 3 — НОВЫЙ `PlacementAssignmentViewSet(viewsets.ViewSet)` в `apps/operations/events/api/views.py` — `initial()`-оверрайд (образец `NotificationViewSet`) для "no actor_id → 403", `acknowledge`-действие с identity-проверкой через `CoreEmployeeSelector.employee_id_for()` (AC: 1-7)
- [x] Task 4 — регистрация `placement-assignments` в `apps/operations/api/urls.py` (образец: `assignment-versions`-регистрация)
- [x] Task 5 — MATRIX-строка (`_AnyAuthenticated()`, НЕ `_Gate`) + AUDIT_MATRIX-строка (AC: 8)
- [x] Task 6 — `make schema` регенерация
- [x] Task 7 — Тесты (AC 1-8, включая нечисловой pk сразу, включая `test_isolation.py`/`test_operations_does_not_import_core_models` НЕ ломается — прогнать явно)
- [x] Task 8 — Гейт

## Dev Notes

- `apps/operations/events/services.py::acknowledge_placement_assignment()` (16.6b, строки 1172-1224) — читать целиком: ИДЕМПОТЕНТНА, `INVALID_LIFECYCLE_TRANSITION` при не-`APPROVED`-версии, актор-identity НЕ проверяется на сервисном уровне (намеренно, "future 16.8").
- `apps/notifications/api/views.py::NotificationViewSet.initial()` — буквальный образец "any authenticated, no RBAC code" + identity-scope-в-теле, читать целиком перед реализацией (комментарий про `self.action is None`/OPTIONS-обход тоже применим здесь, если добавляется `initial()`-оверрайд).
- `apps/core/selectors.py::CoreEmployeeSelector.user_ids_for()` (16.6a, строки 272-289) — образец bulk `employee_id -> user_id`; НОВЫЙ метод — обратное направление, ЕДИНИЧНОЕ (не bulk, `.first()`).
- `apps/operations/tests/test_isolation.py::test_operations_does_not_import_core_models` — ОБЯЗАТЕЛЬНО прогнать после реализации, ДО коммита. Прямой импорт `apps.core.models.UserEmployeeBinding` в `apps/operations/**` красит этот тест.
- `apps/operations/events/api/serializers.py::PlacementAssignmentSerializer` (16.8a) — уже существует, переиспользуется как есть.
- Тесты 16.8a/b/c/d's ревью нашли одинаковый пробел четырежды (нечисловой `pk`) — писать этот тест СРАЗУ.
- Для AC-1/2/3/4 нужна РЕАЛЬНАЯ `APPROVED`-версия — цепочка `placement/draft` → `submit` → `approve` (HTTP, 16.8b/d) — переиспользовать `make_submitted_version()`-стиль хелпер из 16.8c/d's тестов + один `.post(approve_url(...))`-вызов, не мокать статус вручную.
- `UserEmployeeBinding.objects.create(user_id=..., employee_id=...)` — прямое создание фикстуры В ТЕСТЕ допустимо (тесты НЕ подчиняются ARCH-003, только `apps/operations/**`-код).

### References

- [Source: _bmad-output/implementation-artifacts/16-6b-отметка-ознакомления.md] — Scope Decision про отложенную identity-проверку, буквально цитируется.
- [Source: _bmad-output/implementation-artifacts/16-8d-api-утвердить.md] — литеральный образец предыдущей стори цикла.
- [Source: Backend/VAPS/apps/operations/events/services.py:1172-1224] — `acknowledge_placement_assignment()` (16.6b).
- [Source: Backend/VAPS/apps/notifications/api/views.py] — `NotificationViewSet` — any-auth+self-scope, буквальный образец.
- [Source: Backend/VAPS/apps/core/selectors.py:272-289] — `user_ids_for()`, образец для нового reverse-метода.
- [Source: Backend/VAPS/apps/operations/tests/test_isolation.py] — ARCH-003 AST-гард, обязателен к прогону.

## Dev Agent Record

### Agent Model Used

Claude Sonnet 5

### Debug Log References

### Completion Notes List

Реализовано по AC 1-8. Новый reverse-селектор `CoreEmployeeSelector.employee_id_for(user_id)` в `apps/core/selectors.py` (единичный, не bulk). НОВЫЙ `PlacementAssignmentViewSet` в `apps/operations/events/api/views.py` — `initial()`-оверрайд (образец `NotificationViewSet`, 5.7c/11.4a) для "no actor_id → 403", `acknowledge`-действие: `_get_placement_assignment_or_404()` → identity-проверка через `CoreEmployeeSelector.employee_id_for(request.actor_id) != assignment.employee_id` → `403` ДО вызова сервиса (сервис вообще не достигается при несовпадении) → `acknowledge_placement_assignment()`. Зарегистрирован `placement-assignments` в `apps/operations/api/urls.py`. MATRIX-строка — `_AnyAuthenticated()`, НЕ `_Gate` (нет RBAC-кода, это самообслуживание). 8 новых поведенческих тестов (все AC), пришлось создавать РЕАЛЬНЫЕ `Employee`-строки (не голый `uuid.uuid4()`) для `UserEmployeeBinding`'s FK-ограничения — обнаружено при первом прогоне (4 IntegrityError), исправлено переиспользованием `test_assignment_approved_notification.py`'s `make_employee()`-паттерна. `test_isolation.py::test_operations_does_not_import_core_models` прогнан явно — не сломан (импорт идёт через `CoreEmployeeSelector`, не напрямую `core.models`). `make gate` — 3896 passed (было 3878, +18), 0 regressions, ruff чист, `make schema` (22 новых строки), миграций нет.

### File List

- `Backend/VAPS/apps/core/selectors.py` (modified — `CoreEmployeeSelector.employee_id_for()`)
- `Backend/VAPS/apps/operations/events/api/views.py` (modified — `PlacementAssignmentViewSet`, `_get_placement_assignment_or_404`)
- `Backend/VAPS/apps/operations/api/urls.py` (modified — регистрация `placement-assignments`)
- `Backend/VAPS/apps/operations/events/tests/test_placement_assignment_acknowledge_api.py` (new)
- `Backend/VAPS/apps/operations/tests/test_rbac_matrix.py` (modified — 1 новая строка MATRIX)
- `Backend/VAPS/apps/audit/tests/test_audit_coverage.py` (modified — 1 новая строка AUDIT_MATRIX)
- `Backend/VAPS/schema.yaml` (regenerated — `make schema`, новый эндпоинт)

**После ревью:**
- `Backend/VAPS/apps/operations/events/api/views.py` (modified — `initial()`'s `"metadata"`-карвин-аут)
- `Backend/VAPS/apps/operations/events/tests/test_placement_assignment_acknowledge_api.py` (modified — 1 новый тест)

## Change Log

| Дата | Изменение |
|---|---|
| 2026-08-03 | Story создана (create-story). Часть 5/9 расщепления Story 16.8. НОВЫЙ ресурс `PlacementAssignmentViewSet` (не действие на `AssignmentVersionViewSet` — другая модель). Identity-based авторизация (не RBAC-код) — образец `NotificationViewSet` (5.7c/11.4a). Найден ОБЯЗАТЕЛЬНЫЙ новый reverse-селектор `CoreEmployeeSelector.employee_id_for()` — ARCH-003 запрещает прямой импорт `core.models` из `operations`. Ultimate context engine analysis completed - comprehensive developer guide created. |
| 2026-08-03 | Dev-story: `employee_id_for()` + `PlacementAssignmentViewSet.acknowledge`. 8 новых тестов (потребовались реальные `Employee`-строки для FK, не голый uuid). `test_isolation.py` подтверждён непробитым. `make gate` — 3896 passed, 0 regressions, ruff чист, `make schema`. Status → review. |
| 2026-08-03 | 3-agent ревью (Blind Hunter, Edge Case Hunter, Acceptance Auditor). Acceptance Auditor: 0 расхождений, ARCH-003 подтверждён прямым чтением импортов (не только Completion Notes). Edge Case Hunter нашёл реальный пробел: `initial()`'s карвин-аут не зеркалил `NotificationViewSet`'s `self.action == "metadata"`-исключение буквально (единственное отличие от заявленного "literal mirror") — OPTIONS-preflight без actor_id получал вводящий в заблуждение 403 вместо metadata-ответа. Исправлено + 1 новый тест (`test_acknowledge_anonymous_options_is_not_403`). Blind Hunter's "High"-находка (None==None bypass при NULL employee_id) — ложное срабатывание: `PlacementAssignment.employee_id = models.UUIDField()` БЕЗ `null=True` (DB NOT NULL), `UserEmployeeBinding.user_id` — `unique=True` (не может быть несколько строк на actor'а) — обе посылки находки опровергнуты чтением модели. Остальные находки — вне объёма (rate-limiting, IDOR-теоретизирование на несуществующих данных, `.isdigit()`-эджкейсы уже идентичны конвенции 16.8a-d). `make gate` повторно — 3897 passed, 0 regressions, ruff чист, миграций нет. Status → done. |
