---
baseline_commit: 30ca1a9
---

# Story 14.11f: API — валидация плана дежурств (dry-run конфликтов)

Status: done

## Story

As an **оператор с правом `duty.manage`**,
I want **`POST /api/operations/duty-plans/{id}/validate`**,
so that **план дежурств можно проверить на конфликты ДО утверждения, без записи в БД**.

`epics.md` (донор `VAPS_7.8.2.md:5933-5937`, §48.5): `validate`/`conflicts` — сиблинг-эндпоинты, добавленные к API-OPS-012 отдельным «High Fix»-аддендумом (в исходном контракте API-OPS-012, `:1483-1489`, их нет). Шестая из ~12 подсторий разделения 14.11.

## Scope Decision (найдено при create-story, research-агент)

- **Донор (§48.4, BR-DUTY-CONFLICT-001, `:5904-5931`) специфицирует ПОЛНЫЙ чек-лист**: hard-статусы, существующие assignment'ы, другие смены дежурств, нарушения отдыха, workload-лимиты, соответствие поста. **BR-DUTY-CONFLICT-002** — конфликты пишутся в `ops_conflicts`/`ops_duty_conflicts` (severity/is_overridden/override_reason).
- **Полная широта — НЕ в этой стори.** Assignment/workload/post-requirement машинерия не существует в кодовой базе вообще (research-агент подтвердил: `approve_duty_plan`/`project_duty_shift` сегодня НЕ делают никаких конфликт-проверок; 14.11c's Scope Decision уже явно отложила `validate`/`conflicts` на 14.11f/g). `epics.md:1433` («Story 16.3: Полный конфликт-детектор назначений... по оперативному блоку 14.10») явно называет ПОЛНЫЙ детектор отдельной будущей стори. Таблица `ops_duty_conflicts` — тоже НЕ создаётся здесь (нет персистентности конфликтов, только dry-run вычисление на лету).
- **Эта стори — узкий, буквально сегодня реализуемый срез**: для каждой (не отменённой) смены плана — overlap-проверка занятости сотрудника, переиспользуя УЖЕ существующую чистую матрицу `apps.operations.statuses.conflict_matrix.detect_conflicts()` (Story 3.4/14.8, ровно тот же детектор, что `status_service._assert_no_conflict()` использует для ручных статусов) против:
  1. Существующих `EmployeeStatus`-строк сотрудника (hard-статусы/другие DUTY/REST_AFTER_DUTY проекции из ДРУГИХ планов — уже видны через `EmployeeStatus`, если те планы утверждены).
  2. Других смен ЭТОГО ЖЕ плана для того же сотрудника (нет DB-констрейнта на это — `DutyShift` не уникален по employee+время; чисто в Python, `detect_conflicts` умеет принимать произвольный список `existing_rows`, трактуя каждую пересекающуюся смену как «DUTY»-тип).
- **Read-only, ничего не пишет** — ни в `DutyPlan.status_code`, ни в `EmployeeStatus`, ни (пока не существует) в `ops_duty_conflicts`. `POST`, а не `GET`, зеркалит донора (§48.5 явно перечисляет его как `POST`) — вероятно потому что тело/параметры валидации могут расширяться позже; ничего в теле сегодня не требуется.
- **Ответ — `200`, плоский список конфликтов**, не `DutyPlanSerializer`: `[{"shift_id": int, "employee_id": uuid, "conflict_code": str, "severity": "HARD"|"SOFT", "message": str}, ...]`. Пустой план или план без конфликтов → `200 []`.
- **Коды ошибок — ничего нового.** `validate` сама никогда не 422/409 — это не мутация, конфликты — часть тела ответа `200`, не ошибка.
- **Роут — `ops-duty-plan-validate`.** MATRIX/AUDIT_MATRIX-строка нужна (`_Gate("duty.manage")`/`_DeferredAudit`, как сиблинги).
- **`conflicts` (донора `GET .../conflicts`) — вне этой стори, 14.11g.** (Судя по донору, `conflicts` — предположительно чтение ПЕРСИСТЕНТНЫХ строк из `ops_duty_conflicts`; поскольку та таблица не создаётся здесь, 14.11g либо строит перси-стентность с нуля, либо (что вероятнее, раз донор не даёт полной схемы) переиспользует тот же on-the-fly детектор под другим URL — решение 14.11g's create-story, не этой.)

## Acceptance Criteria

1. **AC-1 (happy path — чистый план, без конфликтов).** Требует `duty.manage`. План с одной или несколькими не пересекающимися по времени сменами разных сотрудников → `200`, `[]`.
2. **AC-2 (self-overlap внутри плана — тот же сотрудник, пересекающиеся смены).** Две смены ОДНОГО сотрудника в ОДНОМ плане с пересекающимся `[starts_at, ends_at)` → `200`, непустой список, `severity == "SOFT"` (DUTY×DUTY — не hard-тип), обе смены упомянуты (`shift_id` каждой).
3. **AC-3 (overlap с существующим hard-статусом сотрудника, из ДРУГОГО источника).** Сотрудник уже имеет `EmployeeStatus` с hard-типом (например `SICK_LEAVE`), пересекающимся по времени со сменой плана → `200`, конфликт с `severity == "HARD"`.
4. **AC-4 (отменённая смена плана исключена из проверки).** Смена с `cancelled_at is not None` не участвует ни как источник, ни как цель конфликта.
5. **AC-5 (несуществующий план → 404).**
6. **AC-6 (без `duty.manage` → 403).**
7. **AC-7 (read-only — ничего не изменяется).** `DutyPlan.status_code`, все `DutyShift`-строки, все `EmployeeStatus`-строки — побайтово идентичны до/после вызова (snapshot-сравнение), независимо от найденных конфликтов.
8. **AC-8 (регресс нулевой, `make gate` зелёный).**

## Out of Scope

- Полная широта BR-DUTY-CONFLICT-001 (assignment/workload/post-requirement) — Story 16.3.
- `ops_duty_conflicts`-таблица / персистентность конфликтов — не эта стори.
- `GET .../conflicts` — 14.11g.
- RBAC-строка/HTTP audit-логирование — 14.12.

## Tasks / Subtasks

- [x] Task 1 — `@action` `validate` на `DutyPlanViewSet` (AC: 1-7)
  - [x] `require_permission` → `get_object_or_404` → для каждой не отменённой смены плана собрать overlap-кандидатов (другие смены плана того же сотрудника + `EmployeeStatus` того же сотрудника) → `classify_pair()` на пару → сериализовать непустой список
- [x] Task 2 — MATRIX/AUDIT_MATRIX-строка (AC: 6, 8)
  - [x] `ops-duty-plan-validate` — `_Gate("duty.manage")`/`_DeferredAudit(_DUTY)`
- [x] Task 3 — `make schema` регенерация
- [x] Task 4 — Тесты (AC: 1-8)
  - [x] чистый план, self-overlap (SOFT), hard-overlap с внешним EmployeeStatus, отменённая смена исключена, 404, 403, read-only snapshot до/после
  - [x] `make gate` зелёный, явно прогнан

## Dev Notes

- Читать `apps/operations/statuses/conflict_matrix.py::detect_conflicts`/`classify_pair` (3.4/14.8) и `apps/operations/statuses/services/status_service.py::_assert_no_conflict` (буквальный образец: как строится `existing_rows`, как классифицируется пара) ПЕРЕД имплементацией.
- `detect_conflicts(*, new_type, existing_rows, business_date)` — чистая функция, `existing_rows` — список dict с `status_type_code`/`date_start`/`date_end`. Для смен плана трактовать каждую смену как тип `"DUTY"` (тот же код, что `project_duty_shift()` использует для проекции).
- `apps.operations.duties.api.views.DutyPlanViewSet` (14.11a-e) — тот же класс, тот же `_PERMISSION`, тот же стиль `@extend_schema`.

### References

- [Source: Backend/VAPS/apps/operations/statuses/conflict_matrix.py] — переиспользуемая чистая матрица (3.4/14.8, done).
- [Source: Backend/VAPS/apps/operations/statuses/services/status_service.py::_assert_no_conflict] — образец построения existing_rows/классификации (3.3/3.4).
- [Source: Backend/VAPS/apps/operations/duties/api/views.py] — 14.11a-e, стиль action/permission/extend_schema.

## Dev Agent Record

### Context Reference

- Отдельный research-агент при create-story: донор специфицирует ПОЛНЫЙ конфликт-чек-лист (BR-DUTY-CONFLICT-001/002), но вся машинерия для assignment/workload/post-requirement не существует — только 16.3 её строит. Эта стори — узкий переиспользуемый срез через уже существующий `conflict_matrix.detect_conflicts()`.

### Completion Notes

Реализовано по AC 1-8. `validate_duty_plan(plan)` (services.py) — для каждой не отменённой смены плана собирает overlap-кандидатов (другие смены того же плана/сотрудника через datetime-пересечение starts_at/ends_at, плюс живые `EmployeeStatus`-строки того же сотрудника через date-пересечение, исключая source_ref самой смены) и классифицирует каждую пару через `conflict_matrix.classify_pair()` напрямую (не `detect_conflicts()` — PLANNED/WARNING-различение неактуально для dry-run, который никогда не блокирует). `@action` `validate` на `DutyPlanViewSet`: `require_permission` → `get_object_or_404` → `validate_duty_plan(plan)` → `200` с `DutyPlanConflictSerializer(many=True)`. Новый output-only сериализатор (`shift_id`/`employee_id`/`conflict_code`/`severity`/`message`), ничего не пишет. 7 новых тестов (чистый план, self-overlap SOFT с обеими сменами, hard-overlap с внешним `EmployeeStatus`, отменённая смена исключена, 404, 403, read-only snapshot до/после через полный dict-сравнение всех строк `DutyShift`/`EmployeeStatus`), все зелёные под реальным Postgres с первой попытки; `make schema` регенерирован (drift-free); `make gate` — 3348 passed (было 3331, +17), 0 regressions.

**Ревью (Blind Hunter/Edge Case Hunter/Acceptance Auditor, параллельно):** Acceptance Auditor подтвердил все 8 AC PASS против реального кода и реального прогона Postgres (895 passed на целевом срезе), включая независимую пробу AC-4 (живая смена vs отменённый EmployeeStatus — не флагуется). Edge Case Hunter не нашёл багов, разрешил все спекуляции Blind Hunter'а как non-issues (timezone-граница, classify_pair("DUTY","DUTY")→SOFT, симметрия self-overlap, ветвление сообщения, исключение отменённых EmployeeStatus), отметил O(n²) Python-цикл как не блокирующий (масштаб — план на месяц, десятки смен) и один пробел покрытия (отменённый EmployeeStatus, не только отменённая смена). Blind Hunter нашёл ДВА реальных дефекта: (1) **schema.yaml неверно документировал ответ как paginated envelope** (`PaginatedDutyPlanConflictList` + limit/offset query-параметры) вместо реального плоского массива — причина: `DutyPlanViewSet.pagination_class` — classовый атрибут, drf-spectacular детектирует его на ЛЮБОМ action с `Serializer(many=True)`-ответом независимо от факта пагинации; исправлено через `@action(..., pagination_class=None)` (DRF's собственный документированный механизм переопределения `*_classes` per-action через kwargs); (2) **`own_refs`-исключение было scoped только на ТЕКУЩУЮ смену**, не на все смены плана — при повторной валидации уже APPROVED-плана с несколькими сменами одного сотрудника, спроецированный EmployeeStatus СОСЕДНЕЙ смены плана не исключался и попадал в кандидаты, дублируя тот же самый конфликт (уже пойманный прямым shift-vs-shift сравнением) вторым, паразитным входом через другой `conflict_code`. Исправлено — `plan_own_refs` теперь собирается по ВСЕМ сменам плана, вычисляется один раз до цикла. Добавлены 2 теста (отменённый EmployeeStatus исключён; sibling-проекция не дублирует конфликт). `make gate` после фиксов — 3350 passed, 0 regressions, schema.yaml drift-free (подтверждён верный плоский `type: array` вместо paginated-обёртки).

### File List

- `apps/operations/duties/services.py` (modified — `validate_duty_plan()`, review fix: `plan_own_refs` по всем сменам плана)
- `apps/operations/duties/api/serializers.py` (modified — `DutyPlanConflictSerializer`)
- `apps/operations/duties/api/views.py` (modified — `validate`-action, review fix: `pagination_class=None`)
- `apps/operations/tests/test_rbac_matrix.py` (modified — `MATRIX`'s новая строка)
- `apps/audit/tests/test_audit_coverage.py` (modified — `AUDIT_MATRIX`'s новая строка)
- `apps/operations/duties/tests/test_duty_plan_validate_api.py` (new, +2 review tests)
- `schema.yaml` (regenerated — `make schema`, review fix confirmed: bare array, not paginated envelope)

## Change Log

| Дата | Изменение |
|---|---|
| 2026-07-31 | Story создана (create-story). Шестая из ~12 подсторий разделения 14.11. Донор специфицирует полный BR-DUTY-CONFLICT-001 чек-лист, но эта стори намеренно сужена до self-overlap (план) + hard/soft overlap с существующими EmployeeStatus, переиспользуя conflict_matrix.detect_conflicts() (3.4/14.8) — полная широта отложена на Story 16.3. Read-only, 200 с плоским списком конфликтов, ничего не пишет. |
| 2026-07-31 | Dev-story: `validate_duty_plan()` (classify_pair() напрямую, не detect_conflicts() — PLANNED-различение неактуально для dry-run), `validate`-action, `DutyPlanConflictSerializer`, MATRIX/AUDIT_MATRIX-строки, 7 новых тестов, все зелёные с первой попытки. `make gate` — 3348 passed. Status → review. |
| 2026-07-31 | Ревью (3 агента параллельно): Acceptance Auditor — все 8 AC PASS. Blind Hunter — 2 реальных дефекта (schema.yaml false-pagination artifact; own_refs scoped только на текущую смену, не на весь план). Edge Case Hunter — багов не нашёл, разрешил спекуляции, отметил 1 пробел покрытия. Фиксы применены (`pagination_class=None`, `plan_own_refs`), +2 теста, `make gate` — 3350 passed, 0 regressions. Status → done. |
