---
baseline_commit: c5779d9 (HEAD «2.8 story»). ВНИМАНИЕ: блок 3.1–3.7 реализован, но в рабочем дереве НЕЗАКОММИЧЕН. 3.8 строится поверх; закоммитить 3.1–3.7 до/вместе с 3.8.
---

# Story 3.8: Bulk-API массового обновления

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a **оператор управления**,
I want **сервис атомарного массового создания статусов одним вызовом — список отклонений по управлению на дату, all-or-nothing, с per-row детализацией ошибок и БЕЗ N+1 (постоянное число SQL-запросов независимо от числа строк)**,
so that **утреннее обновление управления (FR-12) — одна форма, одно сохранение; неуказанные сотрудники остаются derived-«В строю» (3.7, без записей); при любом конфликте/ошибке НИЧЕГО не записывается частично, а оператор видит, какая строка виновата**.

## Acceptance Criteria

Источник: [epics.md#L540-L546] (Story 3.8), FR-12 [epics.md#L43] «массовое обновление одной формой/одним сохранением; неуказанные подтверждаются В строю», NFR-4 [epics.md#L92] (contention, bulk-селекторы, запрет COUNT-в-цикле), architecture.md#L61 (анти-паттерн донора COUNT-в-цикле), #L326 (cross-context: только bulk-API, никаких per-item в циклах).

1. **AC-1 (атомарное создание отклонений).** Given управление 40 человек, payload из 3 отклонений (валидных), When вызываю `bulk_create_statuses`, Then **атомарно** создано ровно 3 `EmployeeStatus` (source=USER), 37 неуказанных НЕ получают записей (они derived-«В строю» по 3.7). Одна транзакция.
2. **AC-2 (конфликт в строке → 409 с per-row детализацией, ничего частично).** Given одна из строк пересекает существующий soft-статус (ACTIVE), When вызываю bulk, Then `DomainError(409)` `STATUS_OVERLAP_WARNING` с `detail.rows[]` (список проблемных строк: `index`, `employee_id`, `code`, `message`), И в БД создано **0** статусов (полный откат — savepoint/atomic). hard-пересечение в строке → агрегат `422` (см. AC-6 precedence).
3. **AC-3 (дубль сотрудника в payload → 400).** Given payload содержит две строки с одним `employee_id`, Then `DomainError(400)` `VALIDATION_ERROR` (структурная проверка payload ДО любой БД-работы/мутации); ничего не создано. (Один bulk = ≤1 строка на сотрудника.)
4. **AC-4 (уволенный → 422 по строке).** Given строка для сотрудника, чей интервал выходит за `dismissal_date` (или начинается до `hire_date`), Then в `detail.rows[]` эта строка с `DATE_OUTSIDE_EMPLOYMENT` (422); агрегат-статус 422; ничего не создано.
5. **AC-5 (чужое подразделение → 403, scope В СЕРВИСЕ).** Given строка для сотрудника вне `allowed_division_ids` оператора (Решение №2: scope — параметр сервиса, фронту не доверяем), When вызываю bulk, Then `DomainError(403)` `PERMISSION_DENIED` (fail-fast, security — до бизнес-валидации); ничего не создано.
6. **AC-6 (per-row агрегация + precedence, закрытый мир).** Все бизнес-ошибки строк (интервал/занятость/max_duration → 422; soft-конфликт → 409) собираются в ОДИН `DomainError` с `detail.rows[]`; http_status агрегата = максимальная severity среди строк (**422 при наличии любой 422-строки, иначе 409**). Новых кодов НЕ вводится — переиспываются `VALIDATION_ERROR`(400), `PERMISSION_DENIED`(403), `DATE_OUTSIDE_EMPLOYMENT`/`MAX_DURATION_EXCEEDED`/`INVALID_DATE_RANGE`/`INVALID_STATUS_TYPE`/`OVERLAPPING_HARD_STATUS`(422), `STATUS_OVERLAP_WARNING`(409). Новизна — структура `detail.rows[]` (как 3.5 добавил `conflicts[]`).
7. **AC-7 (no N+1 — перф-контракт, NFR-4).** Given payload 5 строк И payload 50 строк, When вызываю bulk, Then число SQL-запросов **КОНСТАНТНО** (не зависит от числа строк; `django_assert_num_queries`): один bulk-lock сотрудников, один bulk-fetch существующих статусов, in-memory конфликт-детект, один `bulk_create`. НИКАКИХ `create_status`-в-цикле (тот делает per-row lock + per-row conflict-query = N+1). p95-бюджет ответа на **300 строк** — зафиксировать ЗАМЕРОМ (прецедент спайка 1.10: измерить, записать константу, охранить тестом; если замер невозможен на dev-машине — пометить `PENDING-measure` и делегировать, как путь B 1.10).
8. **AC-8 (intra-payload пересечения).** Given две строки одного… — N/A (AC-3 запрещает дубль employee в payload). Но строка может пересечь СУЩЕСТВУЮЩИЙ статус того же сотрудника — это AC-2 (конфликт-детект против БД + intra-payload не нужен, т.к. ≤1 строка/сотрудник).
9. **AC-9 (out of scope, без протечек).** НЕ строится: REST-эндпоинт + сериализатор payload (Решение №1 — сервис; POST/DRF → API-стори E10); RBAC-резолвинг `allowed_division_ids` из `UserRole.scope_division_id` (Решение №2 — параметр; резолвинг → API-стори/permission-слой); override в bulk (массовый обход soft → отдельная стори/флаг, если понадобится); «подтверждение» неуказанных как явный факт (это сдача дня E5, не 3.8); автосейв/черновик формы (E10, после жалобы — architecture.md#L97); генерация синтетики 5000 для нагрузки (fixture-фабрика до нагрузочных, architecture.md#L97).
10. **AC-10 (регресс нулевой + гейт).** `create_status`/`update_status`/lifecycle (3.3–3.6) и весь репозиторий — зелёные без правок; новый `lock_employees` не ломает `lock_employee`. `make gate` зелёный; `makemigrations --check` чист (3.8 без модели/миграции).

## Tasks / Subtasks

- [x] **Task 1 — Bulk-lock селектор** (AC: 7,10)
  - [x] `apps/core/selectors.py`: `CoreEmployeeLockSelector.lock_employees(employee_ids)` → `Employee.objects.select_for_update().filter(id__in=ids).order_by("id")` → вернуть `{id: employee}`. **Детерминированный порядок (`order_by("id")`) — анти-deadlock** (множество writer'ов на одно управление в пик 16-17). Один запрос. Существующий `lock_employee` НЕ трогать.
- [x] **Task 2 — Bulk-сервис** (`services/bulk_status_service.py`, NEW) (AC: 1–6,8) — см. **Решения**
  - [x] `@transaction.atomic def bulk_create_statuses(rows, *, actor, business_date, allowed_division_ids)`. `rows`: список dict `{employee_id, status_type_code, date_start, date_end, comment?, document_basis?, source_ref?}`. Порядок фаз (cheap→expensive, fail-fast на структурном/security):
    1. `_require_actor(actor)` (реюз из status_service).
    2. **Payload-структура (AC-3):** дубль `employee_id` → 400 `VALIDATION_ERROR` (set-проверка, до БД). Пустой payload → ранний возврат `[]` (или 400 — Решение №4).
    3. **Bulk-lock (Task 1):** `lock_employees([r.employee_id])`; отсутствующий сотрудник → 404 `ENTITY_NOT_FOUND` с этой строкой (или агрегат — Решение №4).
    4. **Scope (AC-5, fail-fast):** для каждой строки `locked[emp].division_id in allowed_division_ids`? нет → 403 `PERMISSION_DENIED` (security до бизнес-валидации; Решение №2/№3 — scope по ТЕКУЩЕМу `division_id` локнутого сотрудника).
    5. **Bulk-fetch существующих (AC-7):** `EmployeeStatus.objects.filter(employee_id__in=ids, cancelled_at__isnull=True).values("employee_id","status_type_code","date_start","date_end")` — ОДИН запрос; сгруппировать по `employee_id` в dict.
    6. **Per-row бизнес-валидация (in-memory, AC-4,6):** для каждой строки — `_resolve_status_type` (тип; кэшировать резолв типов — Решение №4, чтобы не N+1 по справочнику: prefetch уникальные коды одним запросом ЛИБО кэш в памяти), `_validate_interval` (занятость/max_duration/инверсия → 422), затем конфликт: отфильтровать существующие строки сотрудника, пересекающие `[date_start,date_end)` (half-open в Python), `detect_conflicts(new_type, overlaps, business_date)`; hard→422-ошибка строки, soft (не override)→409-ошибка строки. Собрать ошибки в список `row_errors`.
    7. **Агрегат (AC-2,6):** если `row_errors` непуст → `raise DomainError(<max-severity http_status>, code=<представительный>, detail={"rows": row_errors})`; ничего не записано (мы ещё не писали).
    8. **Bulk insert (AC-1,7):** `EmployeeStatus.objects.bulk_create([EmployeeStatus(...source=USER...) for r in rows])` — ОДИН запрос. Вернуть созданные.
  - [x] `services/__init__.py`: экспорт `bulk_create_statuses` (+ `__all__`).
- [x] **Task 3 — Тесты функциональные** (`tests/test_bulk_status_service.py`, NEW) (AC: 1–6,8,10)
  - [x] Реюз фикстур (env: org/div + StatusTypes VACATION/STUDY; `_emp`). AC-1: 3 валидных → 3 строки, count==3. AC-2: одна строка soft-overlap → 409 `STATUS_OVERLAP_WARNING`, `detail.rows` содержит index/employee_id/code, count==0 (полный откат). AC-3: дубль employee → 400, count==0. AC-4: интервал за увольнение → 422, `rows` с `DATE_OUTSIDE_EMPLOYMENT`, count==0. AC-5: сотрудник вне `allowed_division_ids` → 403, count==0. AC-6: смешанный payload (одна 422-строка + одна 409-строка) → агрегат 422, обе в `rows`. hard-overlap строка → 422. missing employee → 404. Happy-path source==USER.
- [x] **Task 4 — Перф-тест (no N+1 + бюджет)** (`tests/test_bulk_status_service.py`) (AC: 7)
  - [x] `django_assert_num_queries(N)` (прецедент `test_strength_report_service.py:231-260`): payload 5 строк и payload 50 строк → ОДИНАКОВОЕ число запросов (зафиксировать N замером; ожидаемо ~4-5: lock + типы(prefetch) + existing-statuses + bulk_create). Тест с РАЗНЫМ числом строк ловит N+1.
  - [x] p95-бюджет 300 строк: измерить локально (как 1.10 — путь A), записать константу в тест/доке; если dev-машина не репрезентативна — `PENDING-measure`, делегировать замер (путь B), тест-скелет с TODO-бюджетом. **Не выдумывать число — замерить или пометить PENDING.**
- [x] **Task 5 — Гейт** (AC: 10)
  - [x] `make gate` зелёный (Postgres :5433): `pytest -m "not property and not concurrency and not slow"`, `ruff check .`, `makemigrations --check` «No changes detected» (миграций нет), бюджет 300s. Перф-тест с `assertNumQueries` — в gate-подсете (не property/slow), если быстрый; иначе пометить `@pytest.mark.slow` и гонять в `test-full`.
  - [x] Регресс 3.3–3.7 + весь репозиторий зелёный.

## Dev Notes

### Решения (ПРИНЯТО = A по рекомендации; подтверждены Bratan на create-story: single-story, сервис, scope-параметр. Менять осознанно.)

> **№1 = A (сервис, не REST).** `bulk_create_statuses` — сервис-функция (continuity Решения №3 из 3.3–3.6). POST-эндпоинт + DRF-сериализатор payload + surfacing `detail.rows[]` в HTTP — API-стори E10 («экран массового обновления»). Тест — прямой вызов сервиса.
> **№2 = A (scope — параметр `allowed_division_ids`).** Сервис ПРИНИМАЕТ множество разрешённых дивизионов и сам энфорсит 403 («scope в сервисе, фронту не доверяем», AC-5). РЕЗОЛВИНГ этого множества из RBAC (`UserRole.scope_division_id` где `is_active`, + subtree через `CoreDivisionTreeSelector`) — API/permission-слой (E10/E2), НЕ 3.8. Тест передаёт ids явно.
> **№3 = A (scope по текущему `division_id`).** Проверка «чужого подразделения» — по `locked_employee.division_id` (текущая дивизия, один запрос). Date-versioned membership (2.4 `roster_on`) точнее на исторические даты, но «утреннее обновление» — про сегодня; current div избегает лишнего запроса. Историческую сверку — refinement (отметить defer, если заказчик потребует на ретро-даты).
> **№4 = A (агрегация + типы).** Per-row ошибки в `detail.rows[]` (reuse-коды, без нового кода — closed-world как 3.5). Резолв типов — prefetch уникальных `status_type_code` ОДНИМ запросом (`StatusType.objects.filter(code__in=set(...), is_active=True)` → кэш-dict), чтобы фаза 6 была чисто in-memory (иначе N+1 по справочнику). Пустой payload → 400 `VALIDATION_ERROR` (бессмысленный bulk; либо ранний `[]` — выбрать, задокументировать). missing employee и дубль — структурные, fail-fast 404/400.

### Архитектурные правила (developer guardrails)

- **NFR-4 — это про КОЛИЧЕСТВО запросов, не throughput.** Главный анти-паттерн донора — COUNT()/SELECT в цикле (architecture.md#L61, #L326). Сердце 3.8: **lock-bulk → fetch-bulk → in-memory → insert-bulk**, число запросов КОНСТАНТНО. Любой `.get()`/`.filter()`/`_assert_no_conflict` ВНУТРИ цикла по строкам = провал AC-7. Тест с 5 и 50 строками — страховка.
- **НЕ звать `create_status` в цикле.** Он делает per-row `_lock_employee` (1 query) + per-row `_assert_no_conflict` (1 query) + per-row save → N+1+1. 3.8 переиспывает ЛОГИКУ (`_validate_interval`, `_conflict_details`, `detect_conflicts`, `_resolve_status_type`-результат), но НЕ цикл вызовов. Вынести общие хелперы из `status_service.py` (импортировать) — не дублировать.
- **`detect_conflicts` — чистый, реюз as-is** [conflict_matrix.py:85-118]: на вход live-overlapping существующие строки сотрудника (отфильтрованные в Python half-open), `new_type`, `business_date`. hard→422, soft(ACTIVE)→409, soft vs PLANNED→warning (не блокирует). 3.8 фильтрует overlaps в памяти (НЕ запросом per row).
- **Атомарность (AC-1,2):** весь `bulk_create_statuses` под `@transaction.atomic`; агрегат-ошибка поднимается ДО `bulk_create` → ничего не записано (даже savepoint не нужен — мы пишем последним шагом). GiST `excl_hard_status_overlap` — race-бэкстоп на `bulk_create` (если конкурентная вставка проскочила pre-check → IntegrityError → §36 → 422); обернуть `bulk_create` в savepoint для чистого отката.
- **source=USER принудительно** (как create_status, AC-7 3.2): bulk создаёт операторские строки; проекционные (OM_AUTO) — не здесь.
- **Bulk-lock порядок — детерминированный** (`order_by("id")`): два оператора на одно управление в пик не должны deadlock'нуть на разном порядке локов. Прецедент contention — architecture.md#L61.
- **«Неуказанные = В строю» — НИЧЕГО не делаем** (3.7): bulk создаёт ТОЛЬКО строки-отклонения; 37 из 40 не получают записей, их статус derived-IN_SERVICE. «Подтверждение» (что их просмотрели) — сдача дня E5, не 3.8.
- **Закрытый мир (AC-6):** новых кодов НЕТ. `detail.rows[]` — новая структура payload (прецедент: 3.5 ввёл `conflicts[]` без нового кода). Каждая строка в `rows[]`: `{index, employee_id, code, message}`.
- **Коды реестра** [error-codes.yaml]: `VALIDATION_ERROR`(400), `PERMISSION_DENIED`(403), `ENTITY_NOT_FOUND`(404), `STATUS_OVERLAP_WARNING`(409 overridable), `OVERLAPPING_HARD_STATUS`/`DATE_OUTSIDE_EMPLOYMENT`/`MAX_DURATION_EXCEEDED`/`INVALID_DATE_RANGE`/`INVALID_STATUS_TYPE`(422) — все есть.

### Project Structure Notes

- **NEW** `services/bulk_status_service.py` — `bulk_create_statuses`.
- **MOD** `apps/core/selectors.py` — `CoreEmployeeLockSelector.lock_employees`.
- **MOD** `services/__init__.py` — экспорт.
- **NEW** `tests/test_bulk_status_service.py` — функциональные + перф (`assertNumQueries`).
- Возможный **MOD** `services/status_service.py` — вынести переиспользуемые хелперы (если приватные `_validate_interval`/`_resolve_status_type` нужно импортировать; они уже модуль-уровневые → импортируются как есть, правка не нужна).
- Файлов ~4. Без модели/миграции/реестра. Связная ответственность «атомарное массовое создание статусов».

### Previous Story Intelligence (3.3–3.7)

- **3.3 (done):** `create_status`, `_require_actor`/`_lock_employee`/`_resolve_status_type`/`_validate_interval`/`_assert_no_conflict`/`_conflict_details` — все модуль-уровневые в `status_service.py`, импортируемы. 3.8 переиспывает ЛОГИКУ, не цикл вызовов (no-N+1).
- **3.4 (done):** `detect_conflicts` + матрица — чистые, реюз. hard×soft = HARD (блок на создании). soft vs PLANNED → warning.
- **3.5 (done):** прецедент «новая detail-структура (`conflicts[]`) без нового кода» — 3.8 повторяет с `rows[]`. Override в bulk — OUT (AC-9).
- **3.6 (done):** `cancelled_at__isnull` — bulk-fetch существующих фильтрует отменённые (как селектор). lifecycle — не здесь.
- **3.7 (done):** «неуказанные = derived IN_SERVICE без записи» — 3.8 создаёт только отклонения, опирается на этот контракт.
- **Селекторы (2.4/1.7):** `EmployeeStatusSelector.overlapping_on` (bulk by employee_ids — паттерн); `HistoricalEmployeeSelector.roster_on` (bulk roster); `CoreEmployeeLockSelector.lock_employee` (одиночный → 3.8 добавляет bulk). Перф-тест: `django_assert_num_queries` — прецедент `test_strength_report_service.py:231-260` (5 константных запросов).
- **RBAC (E2):** `UserRole(user_id, role_code, scope_division_id, is_active)` [rbac/models.py] — источник `allowed_division_ids` для API-стори; 3.8 принимает готовое множество.

### Git Intelligence

- **⚠️ 3.1–3.7 НЕЗАКОММИЧЕНЫ.** 3.8 поверх. Закоммитить блок E3 до/вместе. dev-агент не коммитит (за Bratan).
- Коммит: `feat(E3): стори 3.8 — bulk-сервис массового обновления (no-N+1)`. dev-story = RED→GREEN + `make gate`. Прецедент перф-теста `assertNumQueries` — strength_report 1.7/2.4.
- p95-замер: если делается реально — путь A (как 1.10, замер за Bratan на целевой машине); иначе `PENDING-measure` + делегировать. НЕ выдумывать бюджет.

### References

- [Source: _bmad-output/planning-artifacts/epics.md#L540-L546] — Story 3.8 AC (атомарно; 409 per-row; дубль→400; уволенный→422/строка; чужой div→403; перф constant-queries + p95/300).
- [Source: _bmad-output/planning-artifacts/epics.md#L43] — FR-12 (массовое обновление; неуказанные = В строю).
- [Source: _bmad-output/planning-artifacts/epics.md#L92] — NFR-4 (contention; bulk-селекторы; запрет COUNT-в-цикле; 5000/200-300/пик 16-17).
- [Source: _bmad-output/planning-artifacts/architecture.md#L61, #L326] — анти-паттерн донора (COUNT в цикле); cross-context только bulk-API, никаких per-item в циклах.
- [Source: Backend/VAPS/apps/operations/statuses/services/status_service.py] — `_require_actor`/`_lock_employee`/`_resolve_status_type`/`_validate_interval`/`_assert_no_conflict`/`_conflict_details`/`create_status` (реюз логики, НЕ цикл вызовов).
- [Source: Backend/VAPS/apps/operations/statuses/conflict_matrix.py:85-118] — `detect_conflicts` (чистый, per-employee in-memory).
- [Source: Backend/VAPS/apps/core/selectors.py:201-208] — `CoreEmployeeLockSelector.lock_employee` (→ добавить `lock_employees`); `HistoricalEmployeeSelector.roster_on` (bulk roster).
- [Source: Backend/VAPS/apps/operations/rbac/models.py] — `UserRole.scope_division_id` (источник allowed_division_ids — API-стори, не 3.8).
- [Source: Backend/VAPS/apps/operations/statuses/tests/test_strength_report_service.py:231-260] — `django_assert_num_queries` паттерн (константа запросов; 5/50 строк ловит N+1).
- [Source: docs/registries/error-codes.yaml] — переиспользуемые коды (новых нет, AC-6).
- [Source: _bmad-output/implementation-artifacts/3-5-override-сущность.md] — прецедент detail-структуры без нового кода.
- [Source: _bmad-output/implementation-artifacts/3-7-дефолт-в-строю-и-непрерывность.md] — «неуказанные = derived IN_SERVICE без записи».

## Dev Agent Record

### Agent Model Used

Opus 4.8 (1M context) — bmad-dev-story, TDD (RED→GREEN), 2026-06-25.

### Debug Log References

- **RED:** `test_bulk_status_service.py` (11 тестов) собран первым → ImportError (`bulk_create_statuses` отсутствует).
- **GREEN:** после `lock_employees` + `bulk_create_statuses` — 11 passed (1.36s). `bulk_create` корректно отработал с `period` GeneratedField (Django 5.1 исключает generated-поля из INSERT).
- **No-N+1 ДОКАЗАН load-bearing:** инжектирован per-row `EmployeeStatus.objects.filter(...).exists()` в цикл → перф-тест упал: «N+1 detected: 5 rows used 13 queries, 50 rows used 58» (5 vs 50 разошлись на +45). После отката — 11 passed. **Реальная константа = 8 запросов** (4 «боевых»: bulk-lock + prefetch типов + bulk-fetch existing + bulk_create; +4 SAVEPOINT/RELEASE от вложенных atomic в тест-транзакции), не зависит от числа строк.
- **Гейт `make gate`** (Postgres :5433): **1236 passed, 21 deselected**, ruff чист, `makemigrations --check` «No changes detected» (3.8 без модели/миграции), **23s**.
- **Регресс нулевой:** `lock_employee` (одиночный) не тронут; 3.3–3.7 + весь репозиторий зелёные.

### Completion Notes List

Bulk-сервис атомарного массового создания статусов (FR-12), **no-N+1** (NFR-4). Решения №1–4 приняты как в стори.

- ✅ **Task 1 (`lock_employees`):** `CoreEmployeeLockSelector.lock_employees(ids)` → `select_for_update().filter(id__in=...).order_by("id")` (детерминированный порядок = анти-deadlock) → `{id: Employee}`. Один запрос. `lock_employee` не тронут.
- ✅ **Task 2 (`bulk_create_statuses`, новый `bulk_status_service.py`):** фазы — actor → пустой/дубль payload→400 → bulk-lock → missing→404 → scope (current `division_id`)→403 → prefetch типов (1 запрос) → bulk-fetch existing (1 запрос) → per-row in-memory валидация (`_validate_interval` 3.3 + `detect_conflicts` 3.4, half-open overlap в Python) с СБОРОМ ошибок → агрегат (max severity 422>409, `detail.rows[]`) → `bulk_create` в savepoint. **НЕ зовёт `create_status` в цикле** (реюз логики, не вызовов).
- ✅ **Task 3 (функц. тесты, 10):** атомарность 3-строки; конфликт→409+rows+откид; дубль→400; уволенный→422/строка; чужой div→403; смешанный→агрегат-422; hard→422; missing→404; пустой→400; пустой actor→400.
- ✅ **Task 4 (перф):** `CaptureQueriesContext` — 5 vs 50 строк → ОДИНАКОВОЕ число запросов (доказано load-bearing инжектом N+1). **p95-бюджет 300 строк — `PENDING-measure`** (путь B, прецедент 1.10): двух-машинное окружение (dev≠целевая ВПС), репрезентативный p95-замер делегирован Bratan на целевой машине; no-N+1 (субстантивный контракт) ЗАКРЫТ и охранён тестом. Число не выдумано.
- ✅ **Task 5 (гейт):** 1236 passed, ruff чист, makemigrations чист, 23s; регресс зелёный.
- **Closed-world (AC-6):** новых кодов НЕТ — `detail.rows[]` новая структура (прецедент `conflicts[]` 3.5). **Out of scope соблюдён (AC-9):** REST/сериализатор→E10; RBAC-резолвинг scope→API; override в bulk→отд.; «подтверждение» неуказанных→E5. Артефакты не закоммичены агентом (за Bratan; коммит с блоком E3).

### File List

- `Backend/VAPS/apps/core/selectors.py` (MOD) — `CoreEmployeeLockSelector.lock_employees` (bulk-lock, order_by id).
- `Backend/VAPS/apps/operations/statuses/services/bulk_status_service.py` (NEW) — `bulk_create_statuses` + `_overlaps`.
- `Backend/VAPS/apps/operations/statuses/services/__init__.py` (MOD) — экспорт `bulk_create_statuses`.
- `Backend/VAPS/apps/operations/statuses/tests/test_bulk_status_service.py` (NEW) — 11 тестов (функц. + no-N+1).

### Change Log

- 2026-06-25 — story 3.8 реализована (bmad-dev-story, Opus 4.8, TDD): bulk-сервис атомарного массового создания статусов (FR-12), no-N+1 (NFR-4). `lock_employees` (bulk-lock) + `bulk_create_statuses` (lock-bulk→prefetch-types→fetch-existing→in-memory validate→bulk_create; per-row `detail.rows[]`, агрегат 422>409; дубль→400, уволенный→422, чужой div→403). 11 тестов; no-N+1 доказан load-bearing (инжект N+1 → 5/50 разошлись 13/58). Константа 8 запросов. p95-бюджет 300 строк → PENDING-measure (двух-машинное окружение). `make gate` зелёный (1236 passed, ruff чист, makemigrations чист, 23s). Status → review. Артефакты не закоммичены агентом.

## Review Findings

### Code-review проход 1 (bmad-code-review, 2026-06-25, Opus 4.8 — same-model caveat)

3 адверсариальных слоя (Blind Hunter diff-only / Edge Case Hunter +код / Acceptance Auditor +спека). Scoped diff ~484 строки по 4 файлам (selectors.py +15, services/__init__.py +4, bulk_status_service.py NEW 192, test_bulk_status_service.py NEW 235). Диф чист от чужого кода: 3.1–3.6 закоммичены в HEAD, 3.7 (`test_in_service_continuity.py`) — test-only вне File List 3.8, исключён.

**Acceptance Auditor: ACCEPT** — AC-1..AC-10 SATISFIED вживую: 638 регресс statuses+core зелёные; `makemigrations --check` «No changes detected» (3.8 без модели/миграции); no-N+1 доказан load-bearing инжектом (5/50→13/58); перф-тест не вакуумен; closed-world — все 9 кодов в error-codes.yaml, новых нет; p95/300 честно `PENDING-measure`, число не выдумано. Dev Record не оверклеймит (8 запросов, 13/58 N+1, savepoint-rationale — подтверждены пробами).

Триаж: **0 decision · 3 patch · 5 defer · 8 dismiss.**

#### Patch (ПРИМЕНЕНЫ+ВЕРИФИЦИРОВАНЫ 2026-06-25)
- [x] [Review][Patch] `business_date=None` → `date > None` TypeError → 500 (не ловится `except DomainError`, интермиттентно — только при наличии overlap); guard на входе → 400 `VALIDATION_ERROR` [bulk_status_service.py] — single-row иммунен (берёт `Clock.today_local()` внутри, status_service.py:163); конвенция «защити future-caller → 400 не 500» (status_service.py:215). +регресс `test_none_business_date_400`.
- [x] [Review][Patch] отсутствующий обязательный ключ строки (`employee_id`/`status_type_code`/`date_start`/`date_end`) → `KeyError` → 500; per-row shape-guard (`_REQUIRED_ROW_KEYS`) → 400 `VALIDATION_ERROR` с `index`/`missing`; + дубль-detail теперь несёт конкретные `employee_ids` (Counter, E4) [bulk_status_service.py]. +регресс `test_missing_required_row_key_400`.
- [x] [Review][Patch] `max_duration_days` настроен в фикстуре CONFERENCE=5, но не покрыт в bulk — добавлен `test_max_duration_exceeded_row_422` (CONFERENCE 7дн → per-row `MAX_DURATION_EXCEEDED` 422) [test_bulk_status_service.py].

**Верификация патчей:** `make gate` зелёный (Postgres :5433): **1239 passed** (+3 теста), 21 deselected, `ruff check` чист, `makemigrations --check` «No changes detected», 22s. Status → **done** (прецедент 2.4–3.7: AC SATISFIED, патчи разрешены, defer'ы залогированы). Артефакты НЕ закоммичены агентом.

#### Defer (записано в deferred-work.md)
- [x] [Review][Defer] агрегат soft-409 envelope роняет `overridable` (registry `overridable:true`; single-row передаёт `True`, exceptions.py default `False`) + per-row нет `overridable` [bulk_status_service.py:219] — deferred: семантику решать при E10 HTTP-слое + bulk-override (нет консьюмера; bulk-override OUT по AC-9)
- [x] [Review][Defer] нет cap на размер payload + `bulk_create` без `batch_size` [bulk_status_service.py] — deferred: лимит запроса → сериализатор E10 (масштаб утра ~40-300; param-limit только на ~8k+)
- [x] [Review][Defer] docstring `lock_employees` переобещает анти-deadlock (верно для bulk-vs-bulk; single-row лочит 1 строку — цикла не образует) [selectors.py:209] — deferred: doc-honesty уточнение
- [x] [Review][Defer] перф-тест на одном типе/одном дивизионе — не ловит гипотетический per-type/per-division N+1 (структурно отсутствует) [test_bulk_status_service.py:462] — deferred: опц. усиление multi-type rows
- [x] [Review][Defer] `_overlaps` дублирует half-open предикат в Python (неизбежно для in-memory no-N+1; идентичен single-row `date_start__lt/date_end__gt`) [bulk_status_service.py:83] — deferred: общий предикат при смене half-open семантики (maintainability)

#### Dismiss (опровергнуто кодом — 8)
- TOCTOU-гонка валидации вне лока (Blind HIGH) — опроверг Edge+код: все writer'ы лочат Employee-строку первой (bulk `lock_employees`, single `create_status`/lifecycle `lock_employee`); чтение existing ПОСЛЕ локов в той же транзакции сериализует статус-записи сотрудника; hard бэкстопится GiST. Инвариант документирован status_service.py:351-354.
- IntegrityError hard-overlap → 500 (Blind HIGH) — опроверг: savepoint + §36 handler конвертит `excl_hard_status_overlap` → 422 (байт-в-байт паттерн create_status:247-254, проверен e2e в 3.3 real dispatch); pre-check путь покрыт `test_hard_overlap_row_422`.
- `bulk_create` минует save/full_clean (Blind MED) — опроверг: `state` derived (не stored), `period` GeneratedField (исключён из INSERT), дефолты полей совпадают (`comment`/`document_basis`=""; `source_ref`=None=null=True), констрейнты срабатывают на БД.
- `source_ref` NOT NULL (Blind MED) — опроверг: `null=True` (employee_status.py:101), create_status тоже шлёт None.
- агрегат-precedence / tie-break (Blind MED) — опроверг: в `row_errors` попадают только 422/409 (400/404/403 fail-fast ДО цикла), `max` по http_status корректен; envelope-code «представительный» разрешён спекой (AC-6).
- live-status фильтр расходится с single-row (Blind MED) — опроверг: `cancelled_at__isnull=True` идентичен `_assert_no_conflict`:149-154; completed-статусы корректно учитываются (интервал состоялся).
- inactive vs unknown тип слиты в `INVALID_STATUS_TYPE` (Blind LOW) — опроверг: идентично single-row `_resolve_status_type`:56-68.
- inner `atomic` «мёртвая церемония» (Blind LOW) — опроверг: savepoint осмыслен (изоляция IntegrityError, иначе внешняя транзакция отравлена), паттерн 3.3.
