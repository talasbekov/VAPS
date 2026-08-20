---
baseline_commit: c5779d925ba3861dbf0ff06ef57ce5707235aec2
---

# Story 3.5: Override-сущность

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As **руководитель**,
I want **override как запись первого класса (структурированная причина, актор, объект, время): при повторе операции с `override=true` + причиной soft-409 (3.4) обходится, операция проходит, и фиксируется Override-запись со ссылкой на обойдённый конфликт**,
so that **каждый обход конфликта считаем per-оператор и per-подразделение (SM-C1) — обходы видимы и аудируемы, а не происходят «снаружи» и не отравляют данные**.

## Acceptance Criteria

Источник: [epics.md#L513-L520] (Story 3.5), FR-11 [epics.md#L42], SM-C1, ARCH-DATA-022 «override блокировки — сущность первого класса с причиной» [architecture.md#L83], ARCH-SEC-032 (append-only audit).

1. **AC-1 (обход soft-409 + запись).** Given soft-409 (`STATUS_OVERLAP_WARNING`) от 3.4-детектора, When повторяю `create_status` с `override=True` и непустой причиной, Then операция проходит (статус создан), И создана **Override-запись** (FK на статус, `employee_id`, `status_type_code`, `reason`, `conflicts[]`-снимок обойдённых soft-конфликтов, `created_by=actor`). Статус + Override создаются **атомарно** (одна транзакция — либо оба, либо ничего).
2. **AC-2 (причина обязательна).** Given `override=True` с пустой/whitespace причиной, Then `DomainError(400)` `VALIDATION_ERROR` — проверка **до** конфликт-детекции; статус не создан, Override не создан.
3. **AC-3 (hard НЕ overridable).** Given hard-пересечение, When создаю с `override=True` и причиной, Then всё равно `DomainError(422)` `OVERLAPPING_HARD_STATUS`. `override` обходит ТОЛЬКО soft-409, никогда hard-422 (4 hard-типа — жёсткий блок, FR-11).
4. **AC-4 (нет конфликта → нет записи).** Given `override=True` + причина, но пересечений нет, Then статус создаётся штатно, Override-запись **НЕ** создаётся (нечего обходить — запись ссылается на конфликт).
5. **AC-5 (дефолт не меняет 3.4).** Given `override=False` (дефолт), Then поведение 3.4 неизменно: soft → 409, hard → 422. Существующие тесты 3.4 зелёные без правок.
6. **AC-6 (одна запись на операцию).** Один `create_status` с обходом → ровно одна Override-запись; `conflicts[]` перечисляет ВСЕ обойдённые soft-конфликты этой операции. Запись append-once на сервисном уровне (нет update-пути в 3.5; DB-level REVOKE/триггер append-only — E4).
7. **AC-7 (закрытый мир).** Коды переиспользуются: `STATUS_OVERLAP_WARNING` (409, есть) триггерит обход, `VALIDATION_ERROR` (400, есть) — пустая причина. Новых кодов НЕ вводится.
8. **AC-8 (миграция).** Миграция `0005` (CreateModel `Override`) обратима; round-trip forward→reverse→forward на одноразовой БД (прецедент 2.1/3.2). `makemigrations --check` чист после.
9. **AC-9 (out of scope, без протечек).** НЕ строятся: REST-эндпоинт + ConflictDialog-проводка (API-стори/8.5), surfacing warnings/overridable/conflicts[] в HTTP-ответ (API), override в `update_status` (lifecycle → 3.6), AuditLog-событие `OVERRIDE_APPLIED` (→ 4.4), DB-level append-only REVOKE/триггеры (→ E4), длина причины 10–500 (Решение №1).

## Tasks / Subtasks

- [x] **Task 1 — Модель `Override` + миграция** (AC: 1,6,8)
  - [x] `apps/operations/statuses/models/override.py`: `class Override(TimeStampedModel)` — `status = ForeignKey(EmployeeStatus, on_delete=PROTECT)`, `employee_id = UUIDField()` (денорм для SM-C1-запросов), `status_type_code = CharField(max_length=50)`, `reason = TextField()`, `conflicts = JSONField(default=list)`. `Meta.db_table = "ops_status_overrides"`, индекс `(employee_id, -created_at)`. `TimeStampedModel` даёт id/created_at/updated_at/created_by (актор-строка, ARCH-007).
  - [x] Re-export `Override` из `models/__init__.py` (+ `__all__`).
  - [x] Миграция `0005_status_override` (CreateModel + AddIndex; deps `0004`). Reverse удаляет таблицу (данные теряются — задокументировать). Round-trip на одноразовой БД.
- [x] **Task 2 — Проброс override в сервис** (AC: 1,2,3,5) — см. **Решение №2**
  - [x] `create_status(..., override=False, override_reason="")` — новые kwargs с дефолтами (обратная совместимость; существующие вызовы не ломаются).
  - [x] Валидация причины **до** конфликт-детекции: `if override and not override_reason.strip(): raise DomainError("VALIDATION_ERROR", 400, ...)` (AC-2). Порядок: actor → lock_employee → **reason-check** → resolve_type → validate_interval → conflict-check.
  - [x] `update_status` вызывает конфликт-проверку с `override=False` (override-правка — это 3.6/lifecycle, вне 3.5).
- [x] **Task 3 — Обход soft в `_assert_no_conflict`** (AC: 1,3,5)
  - [x] Сигнатура `_assert_no_conflict(..., override=False)`. **hard всегда raise 422** (override не трогает). soft: `if report.soft and not override: raise 409`. Если `override and report.soft` → НЕ raise, **вернуть** обойдённые soft-конфликты (для записи). Нет конфликтов → вернуть пусто.
  - [x] Вернуть `report.soft` (или сериализованные `_conflict_details(report.soft)`) вызывающему.
- [x] **Task 4 — Запись Override (атомарно)** (AC: 1,4,6)
  - [x] В `create_status`, ВНУТРИ savepoint (`with transaction.atomic()`) после `status.save()`: если обойдены soft-конфликты (`override` and вернулись soft) → `Override.objects.create(status=status, employee_id=…, status_type_code=…, reason=override_reason, conflicts=_conflict_details(bypassed), created_by=actor)`. Если конфликтов не было — Override НЕ создаётся (AC-4).
- [x] **Task 5 — Тесты** (`apps/operations/statuses/tests/test_override.py` или расширить test_status_service.py) (AC: все)
  - [x] override=true + причина + soft-overlap (ACTIVE) → статус создан + Override-запись (проверить FK, reason, conflicts[]-содержимое, created_by, employee_id, status_type_code).
  - [x] override=true + пустая/whitespace причина → 400 `VALIDATION_ERROR`, ноль статусов/override.
  - [x] override=true + причина + HARD-overlap → 422 `OVERLAPPING_HARD_STATUS` (не обойдён), ноль override.
  - [x] override=true + причина, конфликта нет → статус создан, Override-запись НЕ создана (AC-4).
  - [x] override=false (дефолт) → soft-overlap по-прежнему 409 (AC-5, регресс 3.4 не тронут).
  - [x] Атомарность: при искусственном сбое записи Override статус откатывается (ноль строк) — savepoint.
  - [x] Round-trip миграции 0005 (forward→reverse→forward).
- [x] **Task 6 — Гейт** (DoD)
  - [x] `make gate` зелёный (Postgres :5433): `pytest -m "not property and not concurrency and not slow"`, `ruff check .`, `makemigrations --check` «No changes detected», бюджет 300s.
  - [x] Round-trip 0005 пройден.

## Dev Notes

### Решения (ПРИНЯТО = A по рекомендации, «продолжай» 2026-06-24 — Bratan может переиграть на B)

> **№1 = A** (только непустая причина) · **№2 = A** (override — сервис-параметр, без REST/ConflictDialog). Приняты по рекомендации в режиме непрерывного цикла; не финальное «РЕШЕНО Bratan» — флипай при желании.

> **Решение №1 — строгость валидации `override_reason`. → A.**
> - **Вариант A (предложено):** только **непустая** причина (`.strip()` ≠ ""), как буквально требует AC-2 «override без причины → 400». Минимум over-reach.
> - Вариант B: ввести границу длины 10–500 символов (донор-спека VAPS_7.8.2 §BR-003). Реальное бизнес-правило, но вне явного AC + добавляет тест-поверхность; риск донор-over-reach (прецедент: поля-ловушки).
> Рекомендация: **A** (AC-литерал; 10–500 — отдельный follow-up, если заказчик подтвердит). Код в любом случае `VALIDATION_ERROR` 400.

> **Решение №2 — объём: сервис-параметр, без REST/ConflictDialog. → A.**
> - **Вариант A (предложено):** `override`/`override_reason` — параметры сервиса `create_status` (продолжение Решения №3 из 3.3/3.4 «сервис без прод-REST»). REST-эндпоинт, ConflictDialog-retry (8.5/ARCH-FE-015), surfacing `conflicts[]`/`overridable` в HTTP-ответ — отдельная API-стори. Тест обхода — прямой вызов сервиса.
> - Вариант B: ввести REST-эндпоинт создания статуса с override прямо здесь. Крупнее, нарушает «API — отдельная стори» (CLAUDE.md) и прецедент 2.4/2.5/3.3/3.4.
> Рекомендация: **A** (continuity; API/surfacing — отдельно).

### Архитектурные правила (developer guardrails)

- **Реюз 3.4-инфраструктуры (НЕ переписывать):** soft-409 поднимает `_assert_no_conflict` (`status_service.py`) с `overridable=True`; `report.soft` несёт `Conflict`-объекты (other_status_type/date_start/date_end); `_conflict_details(...)` сериализует их в list[dict]. `override` обходит ТОЛЬКО ветку `if report.soft`, hard-ветка (422) нетронута. [status_service.py `_assert_no_conflict`]
- **hard никогда не overridable** (FR-11, ARCH-DATA-020). `override=true` + hard-overlap → 422. Тест обязателен (AC-3). GiST `excl_hard_status_overlap` — бэкстоп hard×hard в любом случае.
- **Override-запись ↔ конфликт.** Запись создаётся ТОЛЬКО когда реально обойдены soft-конфликты (AC-4): нет конфликта → нет записи. `conflicts` = снимок (`_conflict_details`), не FK (конфликт — вычисляемый, не персистентный объект). Одна запись на `create_status`-операцию, `conflicts[]` перечисляет все обойдённые (AC-6).
- **Атомарность** (AC-1): `status.save()` + `Override.objects.create()` в ОДНОМ `transaction.atomic()`-savepoint. Сбой записи Override → откат статуса. Прецедент savepoint — 3.3/3.4.
- **Модель-конвенции (мирроринг EmployeeStatus):** `TimeStampedModel` (integer BigAutoField PK, created_at/updated_at/created_by-строка); `employee_id = UUIDField()` плоский cross-context (НЕ FK на core, ARCH-002/003/007); `status_type_code` CharField; `db_table="ops_status_overrides"`. `status` FK на EmployeeStatus с `on_delete=PROTECT` (статусы не удаляются — soft-cancel; PROTECT безопасно). [operations/models.py TimeStampedModel; employee_status.py паттерны]
- **Append-once:** 3.5 создаёт запись, update-пути нет. DB-level REVOKE UPDATE/DELETE + триггер (ARCH-SEC-032) — Epic 4 (audit append-only), НЕ в 3.5.
- **actor — строка** (ARCH-007/BR-ACCOUNT-002): `created_by=actor` (user_id-строка), не FK на сотрудника. `_require_actor` уже валидирует непустоту.
- **Коды реестра — переиспользовать.** `STATUS_OVERLAP_WARNING` (409, overridable) и `VALIDATION_ERROR` (400) уже есть. Новых НЕ вводить (AC-7). [error-codes.yaml#L100-L105, L26-L31]
- **Сервис-слой, не API** (Решение №2=A). override — kwarg `create_status`. Surfacing в HTTP-ответ (overridable/conflicts[]/warnings) — API-стори.

### Project Structure Notes

- Модель: `apps/operations/statuses/models/override.py` (NEW) + re-export в `models/__init__.py` (MOD).
- Миграция: `apps/operations/statuses/migrations/0005_status_override.py` (NEW; deps 0004).
- Сервис: `apps/operations/statuses/services/status_service.py` (MOD — override-kwargs + reason-валидация + bypass + запись).
- Тесты: `apps/operations/statuses/tests/test_override.py` (NEW) либо расширить test_status_service.py.
- Файлов ~5 (модель + миграция + __init__ + сервис + тест). В рамках ориентира.

### Previous Story Intelligence (3.4, 3.3)

- **3.4 (done):** `_assert_no_conflict` поднимает soft-409 `STATUS_OVERLAP_WARNING` `overridable=True` + `detail.conflicts[]`; hard→422. Forward-hooks → 3.5: «override escape → 3.5» (conflict_matrix.py docstring), «override entity is 3.5». `_conflict_details` готов к реюзу. Решения 3.4 = A/A/A (чистый модуль / soft-409 впаян / единый hard-источник).
- **3.4 deferred → 3.5-смежное:** COMPLETED (прошлый) soft-overlap → блокирующий 409 (не warning) — 3.5 НЕ меняет семантику COMPLETED, но override-эскейп РАБОТАЕТ для любого soft-409 (включая бэкдейт-COMPLETED) → закрывает операбельность («можно обойти с причиной»). FR-10 warning-surfacing → API-стори, не 3.5.
- **3.3 (done):** `create_status` typed-kwargs, `_require_actor`, `_lock_employee`, savepoint вокруг INSERT, Решение №3 «сервис без прод-REST». 3.5 продолжает контракт (override — новые kwargs).
- **Регресс-хазард:** смена сигнатуры `_assert_no_conflict` (+override) затрагивает оба вызова — create_status (override прокидывается) и update_status (всегда override=False). Существующие 3.4-тесты soft-409 должны остаться зелёными при дефолте.

### Git Intelligence

Коммит-паттерн `feat(EN): стори X.Y — <суть>`; коммитит **Bratan** (dev-агент не коммитит). dev-story = RED→GREEN + `make gate` зелёный. Прецедент модели+миграции+round-trip — 3.2 (0003), 3.3 (0004).

### References

- [Source: _bmad-output/planning-artifacts/epics.md#L513-L520] — Story 3.5 AC (override=true+причина→проходит+запись; без причины→400).
- [Source: _bmad-output/planning-artifacts/epics.md#L42] — FR-11 (4 hard → 422; остальные → 409 + override с фиксацией).
- [Source: _bmad-output/planning-artifacts/architecture.md#L83] — ARCH-DATA-022 «каждый неизбежный обход — дешёвый, видимый, аудируемый; override — сущность первого класса с причиной».
- [Source: _bmad-output/planning-artifacts/architecture.md (ARCH-SEC-032)] — append-only audit (DB-enforced) — контекст для E4, не 3.5.
- [Source: Backend/VAPS/apps/operations/statuses/services/status_service.py] — `_assert_no_conflict` (обход soft), `_conflict_details`, create_status/update_status, savepoint.
- [Source: Backend/VAPS/apps/operations/statuses/conflict_matrix.py] — ConflictReport.soft, Conflict-поля (снимок для записи).
- [Source: Backend/VAPS/apps/operations/models.py] — TimeStampedModel (база Override).
- [Source: Backend/VAPS/apps/operations/statuses/models/employee_status.py] — паттерны модели (UUIDField employee_id, db_table, FK-конвенции).
- [Source: Backend/VAPS/apps/core/exceptions.py] — DomainError(overridable).
- [Source: docs/registries/error-codes.yaml#L100-L105,L26-L31] — STATUS_OVERLAP_WARNING (409 overridable), VALIDATION_ERROR (400).
- [Source: _bmad-output/implementation-artifacts/3-4-конфликт-детектор-на-матрице-данных.md] — soft-409, forward-hook override→3.5.
- [Source: _bmad-output/implementation-artifacts/deferred-work.md] — COMPLETED-soft, warning-surfacing (контекст).

## Dev Agent Record

### Agent Model Used

Opus 4.8 (1M context) — bmad-dev-story, TDD, 2026-06-24.

### Debug Log References

- `make gate` (Postgres :5433): 1187 passed (+8), 21 deselected, ruff чист, makemigrations «No changes detected», 26s.
- Round-trip 0005 на vaps_rt35: forward→reverse→forward, таблица ops_status_overrides 1→0→1, все exit 0.
- ruff: авто-сгенерированная миграция 0005 превышала 88 кол → `ruff format` по файлу (прецедент: миграции форматируются после makemigrations); makemigrations --check остался чист.

### Completion Notes List

- **Модель `Override`** (`models/override.py`, `TimeStampedModel`): `status` FK→EmployeeStatus (on_delete=PROTECT, related_name="overrides"), `employee_id` (UUIDField денорм для SM-C1), `status_type_code`, `reason` (TextField), `conflicts` (JSONField снимок). `db_table="ops_status_overrides"`, индекс (employee_id, -created_at). Миграция 0005 CreateModel (обратима, round-trip). Re-export из models/__init__.
- **Сервис (Решение №2=A — параметры, без REST):** `create_status(..., override=False, override_reason="")`. Валидация причины (`.strip()`) ДО конфликт-детекции → `VALIDATION_ERROR` 400 (AC-2). `_assert_no_conflict(..., override=False)`: hard ВСЕГДА 422 (override не трогает); soft → 409 если не override, иначе **возвращает** обойдённые soft (для записи). create_status: при `override and bypassed` — `Override.objects.create(...)` в ТОМ ЖЕ savepoint, что и `status.save()` (AC-1 атомарность). Запись iff обойдены soft (AC-4: нет конфликта → нет записи).
- **hard НЕ overridable (AC-3):** override=true + hard-overlap → 422 OVERLAPPING_HARD_STATUS, ноль Override. Тест есть.
- **update_status не трогает override** (дефолт False; override-правка → 3.6).
- **Закрытый мир (AC-7):** новых кодов нет — `STATUS_OVERLAP_WARNING` (409) триггерит обход, `VALIDATION_ERROR` (400) — пустая причина. Оба уже в реестре.
- **8 тестов** (test_override.py): soft-bypass+запись (FK/reason/conflicts[]/created_by), пустая+whitespace причина→400 (parametrized), hard-не-обойдён→422, нет-конфликта→нет-записи, дефолт-409, атомарный откат (monkeypatch Override.create→raise → статус откатывается), export-wiring.
- **Out of scope (AC-9):** REST/ConflictDialog/surfacing → API-стори; override в update_status → 3.6; AuditLog OVERRIDE_APPLIED → 4.4; DB-level append-only REVOKE/триггер → E4; длина причины 10-500 → Решение №1=A (только непустая).
- Регрессия зелёная (3.4 soft-409-тесты не тронуты; override-дефолт False). Артефакты НЕ закоммичены агентом.

### File List

- `Backend/VAPS/apps/operations/statuses/models/override.py` (NEW) — модель Override.
- `Backend/VAPS/apps/operations/statuses/migrations/0005_override.py` (NEW) — CreateModel (ruff-formatted).
- `Backend/VAPS/apps/operations/statuses/models/__init__.py` (MOD) — экспорт Override.
- `Backend/VAPS/apps/operations/statuses/services/status_service.py` (MOD) — override/override_reason kwargs, reason-валидация, _assert_no_conflict возвращает обойдённые soft, запись Override в savepoint.
- `Backend/VAPS/apps/operations/statuses/tests/test_override.py` (NEW) — 8 тестов.

### Change Log

- 2026-06-24 — story 3.5 реализована (bmad-dev-story, Opus 4.8): Override-сущность — обход soft-409 с причиной + первоклассная аудит-запись; модель + миграция 0005; create_status override-параметры; атомарная запись; hard не overridable; 1187 passed. Status → review.
- 2026-06-24 — code-review проход 1 (bmad-code-review, Opus 4.8, 3 слоя): Acceptance Auditor ACCEPT (AC-1..9 + решения вживую, атомарность load-bearing); Edge 0 HIGH/MED (все ветки верифицированы); Blind-находки про report.soft/atomicity опровергнуты Edge. 0 decision · 3 patch ПРИМЕНЕНЫ (None-причина→400 не 500; docstring SM-C1 division честно; тест-усиления cross-type+pk) · 4 defer · 6 dismiss. make gate: 1189 passed, ruff чист, makemigrations чист. Status → done.

## Review Findings (code-review проход 1 — 2026-06-24, Opus 4.8, same-model caveat)

3 слоя. **Acceptance Auditor: ACCEPT** — AC-1..9 + оба решения SATISFIED вживую (атомарность доказана load-bearing: status.save вне savepoint → count==2 → тест упал бы; миграция round-trip; closed-world — error-codes.yaml не тронут). **Edge: 0 HIGH/0 MED** — эмпирически верны: hard+soft mixed+override→422 без Override; PLANNED-warning→report.warnings (НЕ soft)→нет Override; атомарность реальна (Override.create внутри того же savepoint, что save); update_status не может override; JSONField default=list безопасен; миграция обратима; FK PROTECT работает; причина — только непустая, скрытого 10-500 нет. Blind 2 значимых опровергнуты Edge (report.soft исключает PLANNED; атомарность гарантирует внешний @atomic). **0 decision · 3 patch · 4 defer · 6 dismiss.**

- [x] [Review][Patch] `override_reason.strip()` падал AttributeError→500 на `None` — **ПРИМЕНЕНО+ВЕРИФИЦИРОВАНО:** `(override_reason or "").strip()`; parametrize-тест расширен на `None`→400. (blind, MED)
- [x] [Review][Patch] docstring Override переобещал per-division SM-C1 — **ПРИМЕНЕНО:** docstring честный — per-operator из `created_by`, per-division join'ом `employee_id`→Employee.division (текущая); point-in-time `division_id`-снимок → deferred-work. (blind+edge, LOW doc-accuracy)
- [x] [Review][Patch] тест-семантика snapshot + атомарность — **ПРИМЕНЕНО:** `test_override_snapshot_records_the_conflicting_type_not_the_new` (новый STUDY обходит существующий CONFERENCE → `status_type_code`==STUDY, `conflicts[]`==[CONFERENCE]); rollback-тест ассертит, что строка `date_start=Jun5` отсутствует (не просто count). (blind, LOW test-quality)
- [x] [Review][Defer] денорм `division_id`-снимок для point-in-time per-division SM-C1 [override.py] — deferred: текущий per-division через employee→division join (отражает ТЕКУЩУЮ дивизию, не на момент override). Снимок division-на-момент → стори метрик/дашбордов SM-C1 (E20) или когда SM-C1 реально считается. (blind+edge LOW)
- [x] [Review][Defer] `reason` — TextField без верхней границы [override.py] — deferred: Решение №1=A (только непустая); max-length / 10-500 (донор BR-003) → когда появится HTTP-сериализатор (API-стори). (edge LOW)
- [x] [Review][Defer] FK PROTECT: нет теста/пути очистки при hard-delete статуса; каскад Employee/Division→статус даст ProtectedError [override.py] — deferred, by-design: статусы soft-cancel'ятся, не hard-удаляются. Пересмотреть, если введётся каскадное удаление. (blind LOW)
- [x] [Review][Defer] edit-override отсутствует (update_status не override'ит/не пишет запись) [status_service.py] — deferred, by-design → 3.6 (lifecycle): override-правка существующего статуса. (blind LOW)

Dismissed (6): Blind «report.soft несёт PLANNED→ложная Override-запись» (Edge опроверг: PLANNED→warnings, не soft); «override теряет overridable-различие» (то же); «атомарность-тест вакуумен» (внешний @transaction.atomic гарантирует AC-1-атомарность; Edge подтвердил load-bearing; внутренний savepoint — 3.3-race-бэкстоп, не AC-1; усилен патчем); «empty-reason 400 даже без конфликта» (fail-fast by-design); «employee_id str-vs-UUID» (UUIDField коэрсит); «is_exported тавтологичен» (безвреден).
