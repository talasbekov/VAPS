---
baseline_commit: 4bdea8e (E4 4.1–4.4 закоммичены; + uncommitted 4.4 review-патчи + ВСЯ 4.5 [apps/audit/api, selectors, test, config/urls, rbac-matrix] + 4.5 review-патчи; ветка e3-catchup-clock-concurrency; E4 in-progress)
context:
  - _bmad-output/planning-artifacts/epics.md
  - _bmad-output/planning-artifacts/architecture.md
  - _bmad-output/implementation-artifacts/4-4-аудит-мутаций-статусов.md
  - _bmad-output/implementation-artifacts/deferred-work.md
---

# Story 4.6: Audit-coverage тест

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

<!-- ШЕСТАЯ (последняя кодовая) стори E4 — CI-СТРАЖ аудита (AR-9), не фича. Фундамент 4.1–4.5 закрыт.
     ЦЕНТРАЛЬНЫЙ ФАКТ (проверено 3 агентами): аудит впаян ТОЛЬКО на СЕРВИС-уровне (E3 statuses, 4.4);
     НИ ОДИН из ~18 мутирующих REST-роутов (core/operations) аудит сегодня НЕ пишет, а у аудируемых
     E3-мутаций НЕТ REST-вьюх (REST для E3 = E10). Поэтому буквальный «каждая мутирующая вьюха →
     assert строки AuditLog» покраснел бы в день один.
     4.6 = ДВА фасета мета-теста:
       • ФАСЕТ B (ядро, named-дефер из ревью 4.4 → deferred-work:401): source-derived closed-world —
         AST-скан call-sites `record(...)`/`record_many(...)` по apps/** собирает РЕАЛЬНО эмитируемые
         action-коды → assert `emitted ⊆ audit-events.yaml::actions`. Заменяет руками-поддерживаемый
         литерал `_STORY_4_4_ACTIONS` (test_status_audit.py) — закрывает дыру «новый сервис с
         незарегистрированным кодом тест НЕ краснит».
       • ФАСЕТ A (буква AR-9): route-coverage как ЖИВОЙ РЕЕСТР (зеркало test_rbac_matrix.py) —
         обход резолвера → мутирующие (POST/PUT/PATCH/DELETE) роуты → каждый ОБЯЗАН иметь строку в
         AUDIT_MATRIX как `_Audited` | `_DeferredAudit(ref)`; новый неклассифицированный мутирующий
         роут → красный. Сегодня ВСЕ ~18 роутов = `_DeferredAudit(ref)`.
     ПЕРЕИСПОЛЬЗОВАТЬ: walker `_walk`/`_served_routes` + `_DeferredGate`-паттерн (test_rbac_matrix.py);
     прецедент source-derived `exception_handler.emitted_codes()`; AST-каркас rglob+walk+skip-tests
     (test_audit_write_boundary.py); indent-aware парсер реестра `_registry_actions` (PyYAML в venv НЕТ).
     ⚠️ ТРАПЫ: (1) AST обязан ловить ОБЕ формы эмиссии — `record(action="X")` (kwarg) И
     `record_many([{"action":"X"}])` (dict-литерал, bulk_status_service.py); (2) скоупить к call-sites
     record/record_many, не к любому `action=` (иначе ложняк на DRF `@action`-декораторе); (3)
     исключить `tests/` из скана (самозагрязнение литералами); (4) парсить только секцию `actions:`,
     не `status_history_action_codes:`; (5) только ОДНО направление — `emitted ⊆ registry`, НЕ обратное
     (реестр — forward-seed с 9 кодами будущих эпиков, см. реш. №3); (6) rbac-MATRIX НЕ трогать
     (4.6 не добавляет роутов). -->

## Story

As an **аудитор безопасности / разработчик-сопровождающий**,
I want **параметризованный CI-страж, который (A) сверяет каждый зарегистрированный мутирующий роут с декларативным audit-реестром (`_Audited` | `_DeferredAudit(ref)`) — новый неклассифицированный мутирующий роут роняет CI; и (B) программно выводит из ИСХОДНОГО кода (AST-скан вызовов `record()`/`record_many()`) все эмитируемые `action`-коды и проверяет `emitted ⊆ audit-events.yaml`**,
so that **новая мутация без аудита или новый `action`-код вне реестра автоматически роняет CI (AR-9), а закрытый мир аудита перестаёт зависеть от руками-поддерживаемого литерала (`_STORY_4_4_ACTIONS`) — закрывая дефер ревью 4.4 (deferred-work:401) и реализуя архитектурный мандат «CI сверяет использованные коды с реестром» (architecture.md:398,479)**.

## Acceptance Criteria

### Фасет B — source-derived closed-world (ядро; замена статического литерала 4.4)

1. **`emitted ⊆ реестр` из ИСХОДНИКА.** **Given** AST-скан всех `apps/**/*.py` (исключая `*/tests/*`) собирает строковые `action`-литералы из call-sites `record(...)`/`record_many(...)`, **When** прогоняю coverage-тест, **Then** каждый эмитируемый код ∈ `docs/registries/audit-events.yaml` секции `actions:`; код вне реестра → красный. Это `исходник ⊆ реестр` (а не `литерал ⊆ реестр`). [Source: deferred-work.md:401; architecture.md:398,479; audit-events.yaml growth_rule:20]
2. **Обе формы эмиссии.** **Given** аудит эмитится двумя формами — `record(action="X", …)` (keyword) И `record_many([{"action":"X", …}])` (dict-литерал, `bulk_status_service.py:263`), **Then** скан собирает коды из ОБЕИХ; пропуск dict-формы (только kwarg) недопустим (потеряет `STATUS_CREATED` из bulk). **And** скан скоуплен к вызовам `record`/`record_many` (не к любому kwarg `action=`) — DRF `@action(...)`-декоратор и посторонние dict с ключом `action` не дают ложных кодов. [Source: bulk_status_service.py:263; status_service.py record ×9; secondment_service.py record ×3]
3. **Только одно направление (`emitted ⊆ registry`), НЕ обратное.** **Given** реестр `audit-events.yaml` — forward-seed (содержит 9 кодов будущих эпиков AUTH_*/ASSIGNMENT_*/GROUP_*/POST_*/DOCUMENT_*/DAILY_SUBMISSION_*, ещё не эмитируемых кодом), **Then** тест НЕ ассертит `registry ⊆ emitted` (no-orphans упал бы на 9 кодах); зафиксировать одно направление с комментарием-обоснованием. [Source: audit-events.yaml:24-128 (20 кодов: 9 базовых seed + 11 из 4.4); реш. №3]
4. **Анти-вакуум скана.** **Given** скан вернул 0 кодов (сломан AST-парсер/пути), **Then** тест ПАДАЕТ, а не «зеленеет ни о чём» (assert `len(emitted) >= 11` — текущие 11 кодов 4.4, зеркало `test_introspection_is_not_vacuous`). [Source: test_rbac_matrix.py:280-284]

### Фасет A — route-coverage living-registry (буква AR-9)

5. **Completeness мутирующих роутов.** **Given** обход `get_resolver()` выделяет все (роут, мутирующий метод ∈ {POST,PUT,PATCH,DELETE} + write-`@action`), **When** прогоняю coverage-тест, **Then** каждый мутирующий роут ОБЯЗАН иметь строку в `AUDIT_MATRIX`; роут без строки (`served − matrix`) → красный; протухшая строка (`matrix − served`, роут удалён) → красный. [Source: epics.md:644-650; architecture.md:632; test_rbac_matrix.py:239-250]
6. **Явный вердикт + escape-hatch.** **Given** `AUDIT_MATRIX`, **Then** каждая строка несёт `_Audited()` (роут реально пишет AuditLog) либо `_DeferredAudit(fix_ref)` со ссылкой на стори/эпик, где аудит будет добавлен (зеркало `_DeferredGate(fix_ref)`). Сегодня ВСЕ текущие мутирующие роуты (core CRUD employee/division/position/rank/staffing-slot + archive/restore/assign/release; operations user-role/temp-duty create/destroy/expire) = `_DeferredAudit(ref)` — ни один не аудируется (проверено). [Source: test_rbac_matrix.py:107-116,121-180; ground-truth — 0 аудируемых роутов]

### Гейт

7. **RED-эквивалент + гейт зелёный + анти-gold-plating.** **Given** временно убрать `record()` из одного сервиса ИЛИ добавить фиктивный `record(action="NOPE")`, **Then** тест КРАСНЕЕТ (discriminating power доказан в Debug Log, как требовала 2.9). **And** тест входит в `make gate`-набор (без маркеров property/concurrency/slow); `make gate` зелёный; ruff чист. **And** анти-gold-plating: 4.6 НЕ добавляет аудит в неаудируемые роуты (это 4.7/E5/E10), НЕ строит runtime per-route assert, НЕ трогает rbac-MATRIX/модель/миграции/`audit-events.yaml`, НЕ вводит рантайм-валидацию в `record()`. [Source: architecture.md:636; 2-9-...md:206; реш. №1]

## Tasks / Subtasks

- [x] **Task 1 — source-derived closed-world (Фасет B, AC: 1-4)**
  - [x] Создать `apps/audit/tests/test_audit_coverage.py`. Реализовать `_emitted_actions() -> set[str]`: AST-каркас `rglob("*.py")` по `apps/**` (BASE_DIR как в `test_audit_write_boundary.py`), SKIP путей с `tests` в частях; `ast.parse`+`ast.walk`; собирать `action`-литералы ТОЛЬКО из `ast.Call`, где `func` — `Name`/`Attribute` с именем ∈ {`record`, `record_many`}: (a) keyword-форма — `node.keywords` с `arg=="action"` и `value=ast.Constant(str)`; (b) dict-форма — в `node.args` обойти `ast.Dict`, ключ `Constant "action"` → значение `Constant(str)`.
  - [x] `_registry_actions() -> set[str]`: переиспользовать indent-aware парсер из `test_status_audit.py:465-484` (PyYAML НЕТ) — читать ТОЛЬКО секцию `actions:` (флаг по колонке-0 `actions:`, ловить `^  ([A-Z][A-Z0-9_]*):`), не `status_history_action_codes:`.
  - [x] `test_emitted_actions_subset_of_registry`: `assert _emitted_actions() - _registry_actions() == set()` (одно направление, реш. №3 — коммент «реестр = forward-seed, no-orphans НЕ ассертим»).
  - [x] `test_emission_scan_not_vacuous`: `assert len(_emitted_actions()) >= 11` (текущие 4.4-коды; анти-зелёный-вакуум).
- [x] **Task 2 — route-coverage living-registry (Фасет A, AC: 5-6)**
  - [x] В том же файле: `_walk(resolver)` + `_served_mutating()` (калька `test_rbac_matrix.py:186-230`, дублирование приватных — устоявшийся паттерн проекта; фильтр методов до {post,put,patch,delete}, отсечь get/head/options/trace и format-suffix дубли). Декларативный `AUDIT_MATRIX: dict[str, _Audited|_DeferredAudit]`.
  - [x] `_DeferredAudit(fix_ref)` (калька `_DeferredGate`); `_Audited()` (для будущих аудируемых роутов). Заполнить `AUDIT_MATRIX` ВСЕМИ текущими мутирующими роут-именами (employee-list/detail/archive/restore, division-*, position-*, rank-*, staffing-slot-*/assign-employee/release, ops-user-role-list/detail, ops-temp-duty-list/expire) → каждый `_DeferredAudit("<ref>")` (core CRUD → E10/audit-увязка; RBAC-админка → admin-audit-эпик; точные ref — из epics FR-маппинга).
  - [x] `test_audit_matrix_covers_every_mutating_route`: `served − matrix` (missing) и `matrix − served` (stale) → красный.
  - [x] `test_route_introspection_not_vacuous`: `assert _served_mutating()` непуст.
- [x] **Task 3 — удалить статический литерал 4.4 (AC: 1, реш. №4)**
  - [x] В `apps/operations/statuses/tests/test_status_audit.py` удалить `_STORY_4_4_ACTIONS`, `test_all_4_4_action_codes_in_registry` и ставшие мёртвыми хелперы (`_registry_actions`, импорт `re`/`Path`/`settings`, если больше нигде в файле не используются — проверить grep) — source-derived тест 4.6 их перекрывает (deferred-work:401). НЕ удалять прочие тесты 4.4.
- [x] **Task 4 — RED-эквивалент (AC: 7)**
  - [x] Доказать discriminating power (в Debug Log, не коммитить): (а) временно вставить `record(action="NOPE_NOT_IN_REGISTRY")` в сервис → `test_emitted_actions_subset_of_registry` КРАСНЕЕТ; (б) временно убрать строку из `AUDIT_MATRIX` → `test_audit_matrix_covers_every_mutating_route` КРАСНЕЕТ. Откатить обе правки.
- [x] **Task 5 — гейт, регрессия, анти-gold-plating (AC: 7)**
  - [x] `make gate` зелёный (Postgres :5433); тест в gate-наборе (без property/concurrency/slow); `ruff check`/`format` чисты; `makemigrations --check` пуст (тест-only, миграций нет).
  - [x] Регрессия нулевая: после удаления статического теста (Task 3) — `test_status_audit.py` остальные зелёные; `test_audit_write_boundary` зелёный (новый тест-файл в `tests/` → исключён из AST-бана и сам не пишет модель).
  - [x] НЕ тронуты: `audit-events.yaml`, `test_rbac_matrix.py` MATRIX, модель/миграции аудита, сервисы, read-API 4.5.

## Dev Notes

### Цель (одним предложением)

4.6 — CI-страж AR-9: (B) AST-скан исходника доказывает `эмитируемые action-коды ⊆ реестр` (закрывает дефер 4.4 о статическом литерале), (A) живой реестр мутирующих роутов гарантирует, что новый мутирующий роут без аудит-классификации роняет CI. Тест-only, ноль продакшн-кода.

### Авторитет спеки (что строим и откуда)

- **epics.md Story 4.6 (#L644-650):** «параметризованный тест "каждая мутирующая вьюха оставляет след" … новая мутация без аудита не пройдёт CI (AR-9). Given все зарегистрированные мутирующие роуты, Then роут без аудит-записи = красный.»
- **AR-9 (epics.md:111; architecture.md:632):** обязательные сквозные тесты: RBAC-матрица; **audit-coverage (каждая мутирующая вьюха оставляет след)**. Один паттерн «новый X не зарегистрирован → CI красный» — общий с RBAC-матрицей 2.9.
- **architecture.md:398,479:** «кода/типа нет в реестре → СТОП; CI сверяет использованные коды с реестром». 4.6 реализует эту сверку для `audit_logs.action`.
- **audit-events.yaml growth_rule (#L20):** «Action не в реестре → СТОП. Каждая мутирующая стори E2+ дописывает свой action тем же PR.»
- **deferred-work.md:401 (дефер ревью 4.4 → ЯВНО в 4.6):** «Closed-world enforce — статический литерал, не дериват из исходника … `литерал ⊆ реестр`, не `исходник ⊆ реестр` → новый сервис с незарегистрированным кодом тест НЕ покраснит. Программный скан эмиссии (AST по сервис-файлам) — скоуп 4.6 generic audit-coverage.» ← прямая директива по содержанию.
- **architecture.md:442-445,456,588:** аудит — на уровне СЕРВИСА (view→сервис→аудит), единый сервис записи, AST-бан прямого импорта `audit.models`. Объясняет, почему «вьюха» в AR-9 ≠ привязка к view сегодня.

### 🔑 Решения по реализации (ДЕФОЛТЫ — подтвердить/переопределить; вопросы в конце)

1. **Скоуп = ОБА фасета A+B [РЕКОМЕНД., ДЕФОЛТ].** B — ядро (named-дефер 4.4, самодостаточно, реальные зубы сегодня); A — буква AR-9 + future-proof (E5/E10-мутации форсируются в реестр). *Альтернатива:* только B (легче, но не покрывает букву «мутирующая вьюха»). Рекомендация — оба: B обязателен, A дёшев (реюз rbac-walker).
2. **Фасет B сканирует ВСЕ `apps/**` call-sites record/record_many [РЕКОМЕНД., ДЕФОЛТ].** Сегодня эмиттеры только в 3 E3-сервисах, но скан-всего ловит будущие эмиттеры где угодно («generic audit-coverage», deferred-work:401). *Альтернатива:* жёстко 3 файла (минимум дефера) — хрупко к новым сервисам. Рекомендация — скан-всего.
3. **Только `emitted ⊆ registry` (одно направление) [ВЫНУЖДЕННО].** Реестр — forward-seed: 9 базовых кодов (AUTH_*/ASSIGNMENT_*/GROUP_*/POST_*/DOCUMENT_*/DAILY_SUBMISSION_*, audit-events.yaml:24-72) ещё НЕ эмитируются кодом (их стори впереди). Обратное `registry ⊆ emitted` (no-orphans) упало бы на этих 9. Поэтому ассертим только `emitted - registry == ∅`; коммент-обоснование обязателен. (Когда все эпики реализованы — no-orphans можно включить, но это НЕ скоуп 4.6.)
4. **Удалить статический `_STORY_4_4_ACTIONS` [РЕКОМЕНД., ДЕФОЛТ].** 4.6 source-derived тест строго мощнее (`исходник ⊆ реестр` ⊇ `литерал ⊆ реестр`). Оставлять оба — дублирование + ложное чувство покрытия от литерала. *Альтернатива:* оставить как локальный smoke — отклонено (дефер 4.4 именно про замену литерала). Task 3 чистит мёртвые хелперы.
5. **Route-classification: ВСЕ текущие мутирующие роуты = `_DeferredAudit(ref)` [ДЕФОЛТ].** Ни один сегодня не аудируется (ground-truth). Каждому — ref на будущую аудит-стори (core доменные мутации → когда core начнёт аудироваться; RBAC-админка → admin-audit; точные ref проставить по FR-маппингу epics). НЕ исключать роуты молча (даже справочники-через-Admin) — `_DeferredAudit` с явным ref, чтобы решение было видимым. *Под-вопрос:* считать ли write-`@action` (archive/restore/assign-employee/release/expire) мутирующими — ДА (rbac-matrix перечисляет их поимённо, зеркалить).

### Что УЖЕ есть — переиспособать / НЕ дублировать

- **rbac-matrix walker** (`apps/operations/tests/test_rbac_matrix.py:186-230`): `_walk(get_resolver())` (рекурсия URLResolver/URLPattern → `(name, callback.cls, callback.actions)`); `_served_routes()` (оба DRF-паттерна: ViewSet via `callback.actions`, plain APIView via хендлеры ∩ `http_method_names`). 4.6 копирует + фильтрует до write-методов. `_walk`/`_served_routes` приватны → дублировать (паттерн проекта: 4.4 продублировал `_registry_*`).
- **`_DeferredGate(fix_ref)`** (`test_rbac_matrix.py:107-116`) + completeness `test_matrix_covers_every_registered_route` (239-250) + анти-вакуум `test_introspection_is_not_vacuous` (280-284) — структурные образцы для `_DeferredAudit` и трёх тестов Фасета A.
- **source-derived прецедент** `exception_handler.emitted_codes()` (`apps/core/api/exception_handler.py:48-53`) + `test_exception_handler.test_emitted_codes_subset_of_registry` (`emitted_codes() - _registry_codes()`) — форма «эмиссия из прод-структур ⊆ реестр». 4.6-Фасет-B = его обобщение через AST.
- **AST-каркас** `apps/audit/tests/test_audit_write_boundary.py:21-57` (`BASE_DIR=parents[3]`, `rglob("*.py")`, skip `tests`/`apps/audit`-для-бана, `ast.parse`+`ast.walk`, ветки Import/ImportFrom; мета-тест «guards the guard» через tempfile) — каркас для `_emitted_actions()` (но 4.6 скан НЕ исключает `apps/audit`, только `tests`).
- **indent-aware парсер реестра** `test_status_audit.py:465-484` (`_registry_actions`) — копировать (PyYAML в venv НЕТ).
- **Тест-конвенции:** `apps/audit/tests/test_*.py`; в gate-наборе (без property/concurrency/slow, architecture.md:630,636); seed в тестах запрещён кроме санкционированного (architecture.md:437) — 4.6 мета-тест данные НЕ создаёт (статический скан), так что вопрос не встаёт.

### Подводные камни для dev-агента

- **AST: обе формы.** `record(action="X")` (kwarg) И `record_many([{"action":"X"}])` (dict-литерал, `bulk_status_service.py:263` — `STATUS_CREATED` эмитится ТОЛЬКО так). Только-kwarg-скан пропустит bulk-код → ложный зелёный.
- **Скоуп скана к `record`/`record_many`-вызовам**, не к любому `action=`-kwarg — иначе DRF `@action(detail=True, methods=["post"])` и dict с ключом `action` дадут мусорные «коды».
- **Исключить `tests/`** из AST-скана — тест-файлы содержат `_STORY_4_4_ACTIONS`/литералы → самозагрязнение (и сам новый `test_audit_coverage.py` содержит коды для RED-проверки в комментах/строках).
- **Реестр: только секция `actions:`** (не `status_history_action_codes:` — другой словарь `ops_employee_status_history.action_code`, тот же UPPER_SNAKE → ложные коды).
- **Одно направление** (реш. №3) — `emitted ⊆ registry`; обратное упадёт на 9 forward-seed кодах.
- **rbac-MATRIX НЕ трогать** — 4.6 не добавляет роутов (в отличие от 4.5). Если тронуть — рискуешь сломать 2.9.
- **`_emitted_actions()` должен найти ≥11** (текущие коды 4.4: STATUS_CREATED/UPDATED/EXTENDED/COMPLETED/CANCELLED/CLARIFICATION_RESOLVED, OVERRIDE_APPLIED, STATUS_BULK_CREATED, SECONDMENT_INITIATED/RETURN_REQUESTED/RETURNED) — анти-вакуум.
- **`func` может быть `Name` ИЛИ `Attribute`** — сервисы импортируют `from apps.audit.services import record, record_many` → вызовы `record(...)` это `ast.Name`. Но устойчивее ловить и `Attribute` (`services.record(...)`) на будущее.
- **RED-эквивалент откатить** — Task 4 правки временные, НЕ коммитить.

### Тесты стори (это сам тест-файл)

- **Новый** `apps/audit/tests/test_audit_coverage.py`: `test_emitted_actions_subset_of_registry` (B), `test_emission_scan_not_vacuous` (B), `test_audit_matrix_covers_every_mutating_route` (A: missing+stale), `test_route_introspection_not_vacuous` (A). Опц. «guards the guard» (фиктивный сниппет с `record(action="X")` через tempfile → скан ловит).
- **Регрессия:** `make gate` зелёный; `test_status_audit.py` после чистки (Task 3) зелёный; `test_audit_write_boundary` зелёный; `makemigrations --check` пуст.

### Definition of Done

- [ ] `test_audit_coverage.py` создан: Фасет B (`emitted ⊆ registry`, обе формы, анти-вакуум) + Фасет A (route-completeness missing+stale, `_DeferredAudit`-реестр, анти-вакуум).
- [ ] AST ловит `record(action=)` И `record_many([{"action":}])`, скоуплен к record/record_many, исключает `tests/`.
- [ ] `_registry_actions` парсит только `actions:`; одно направление `emitted ⊆ registry` (реш. №3, коммент).
- [ ] Статический `_STORY_4_4_ACTIONS` + его тест удалены из `test_status_audit.py` (+ мёртвые хелперы), остальные 4.4-тесты зелёные.
- [ ] RED-эквивалент доказан в Debug Log (оба теста краснеют на инъекции; правки откачены).
- [ ] Анти-gold-plating: аудит в роуты не добавлен, runtime-валидации нет, rbac-MATRIX/реестр/модель/миграции не тронуты.
- [ ] `make gate` зелёный, тест в gate-наборе, ruff/format чисты, `makemigrations --check` пуст. Completion Notes без вранья.

### Project Structure Notes

- **Тест-only стори** (AR-9 CI-страж) — продакшн-кода ноль. Файлов: 1 новый тест + 1 MODIFY (чистка статического теста 4.4). Это меньше «≤5 файлов» — норм.
- **Новые:** `apps/audit/tests/test_audit_coverage.py`. **Изменяемые:** `apps/operations/statuses/tests/test_status_audit.py` (удалить статический литерал-тест + мёртвые хелперы). **НЕ трогать:** `audit-events.yaml`, `apps/operations/tests/test_rbac_matrix.py`, `apps/audit/models.py`/миграции, сервисы записи, `apps/audit/api/*` (4.5).
- Размещение в `apps/audit/tests/` (а не `operations/tests/integration/`) — консистентно с `test_audit_write_boundary.py` (тоже сквозной AST-мета-тест аудита).

### References

- [Source: _bmad-output/planning-artifacts/epics.md#L644-650,111,177-178] — Story 4.6 + AR-9 (audit-coverage обязательный сквозной тест).
- [Source: _bmad-output/planning-artifacts/architecture.md#L398,479,632,636] — closed-world «CI сверяет коды с реестром»; AR-9 «каждая мутирующая вьюха оставляет след»; `make gate`-композиция.
- [Source: _bmad-output/planning-artifacts/architecture.md#L442-445,456,588] — аудит на сервис-уровне; единый сервис записи; AST-бан импорта модели (почему «вьюха» ≠ view-привязка сегодня).
- [Source: _bmad-output/implementation-artifacts/deferred-work.md#L401] — дефер ревью 4.4: статический литерал → программный скан исходника = скоуп 4.6.
- [Source: docs/registries/audit-events.yaml#L20,24-128] — growth_rule; секция `actions:` (20 кодов: 9 forall-seed + 11 из 4.4); `status_history_action_codes:` (другой словарь — НЕ парсить).
- [Source: Backend/VAPS/apps/operations/tests/test_rbac_matrix.py#L107-116,186-230,239-250,280-284] — `_DeferredGate`, `_walk`/`_served_routes`, completeness-gate, анти-вакуум (структурный донор Фасета A).
- [Source: Backend/VAPS/apps/core/api/exception_handler.py#L48-53; apps/core/tests/test_exception_handler.py#L182-184] — source-derived `emitted_codes() ⊆ registry` (форма-донор Фасета B).
- [Source: Backend/VAPS/apps/audit/tests/test_audit_write_boundary.py#L21-77] — AST-каркас rglob+walk+skip-tests + «guards the guard».
- [Source: Backend/VAPS/apps/operations/statuses/tests/test_status_audit.py#L457-489] — статический `_STORY_4_4_ACTIONS` + `_registry_actions` (удалить литерал, переиспользовать парсер).
- [Source: Backend/VAPS/apps/operations/statuses/services/{status_service,secondment_service,bulk_status_service}.py] — 14 call-sites record/record_many (вселенная эмитируемых кодов; bulk_status_service.py:263 — dict-форма).
- [Source: Backend/VAPS/apps/{core,operations}/api/views.py] — ~18 мутирующих роутов (ни один не аудируется → все `_DeferredAudit`).

## Dev Agent Record

### Agent Model Used

claude-opus-4-8[1m] (Opus 4.8, 1M context)

### Debug Log References

- **Подтверждённые решения (Bratan):** №1 оба фасета A+B; №2 скан всех `apps/**`; №3 только `emitted ⊆ registry` (реестр forward-seed); №4 удалить статический `_STORY_4_4_ACTIONS`; №5 все роуты `_DeferredAudit(ref)`, write-`@action` мутирующие.
- **Форма эмиссии bulk:** `bulk_status_service.py:259` зовёт `record_many([{"action": "STATUS_CREATED", …} for st in created])` — `action` это VALUE dict-литерала в list-comp, НЕ kwarg. AST-скан обходит `node.args` → `ast.walk` → `ast.Dict` (покрывает list-comp). Только-kwarg-скан потерял бы этот код.
- **RED-эквивалент ДОКАЗАН (discriminating power, 2.9-прецедент):**
  - Фасет B: временный `apps/audit/_red_probe.py` с `record(action="NOPE_NOT_IN_REGISTRY")` → `test_emitted_actions_subset_of_registry` КРАСНЕЕТ (`эмитируемые код(ы) вне audit-events.yaml: ['NOPE_NOT_IN_REGISTRY']`); удалён → зелёный.
  - Фасет A: временно убрана строка `ops-temp-duty-expire` из `AUDIT_MATRIX` → `test_audit_matrix_covers_every_mutating_route` КРАСНЕЕТ (`мутирующие роуты без строки: ['ops-temp-duty-expire']`) — заодно подтвердило, что walker находит РОВНО 18 роутов, и матрица совпадает; строка возвращена.
- **VERIFIED:** focused `test_audit_coverage.py` + `test_status_audit.py` — 23 passed; `make gate` (Postgres :5433) — **1374 passed** (+8 нетто: +6 новых coverage-тестов +3 hardening-теста в `test_status_audit` −1 удалённый статический), 24 deselected; `makemigrations --check` → «No changes detected» (тест-only); `ruff check`/`ruff format --check` чисты; 24s.
- **Скан нашёл 11 эмитируемых кодов** (STATUS_CREATED/UPDATED/EXTENDED/COMPLETED/CANCELLED/CLARIFICATION_RESOLVED, OVERRIDE_APPLIED, STATUS_BULK_CREATED, SECONDMENT_INITIATED/RETURN_REQUESTED/RETURNED) — все ∈ реестр. Walker нашёл 18 мутирующих роутов — все классифицированы `_DeferredAudit`.

### Completion Notes List

4.6 — audit-coverage CI-страж (AR-9): тест-only, продакшн-кода ноль. Два фасета мета-теста доказывают «новая мутация/код без аудита роняет CI». `make gate` зелёный (1374 passed, +8).

- ✅ **Task 1 (Фасет B):** `test_audit_coverage.py::_emitted_actions()` — AST-скан `apps/**` (skip `tests/`), `_actions_in_tree` ловит ОБЕ формы (kwarg + dict-литерал), скоуплен к `record`/`record_many` (`_call_name` для Name/Attribute). `_registry_actions()` — indent-aware парс только секции `actions:`. `test_emitted_actions_subset_of_registry` (одно направление, реш.№3), `test_emission_scan_not_vacuous` (≥11), `test_scan_detects_both_emission_forms` (guards-the-guard: оба формата + игнор не-record `action=`).
- ✅ **Task 2 (Фасет A):** `_walk`/`_served_mutating` (калька rbac, фильтр write-методов), `_Audited`/`_DeferredAudit(fix_ref)`, `AUDIT_MATRIX` (18 роутов, все `_DeferredAudit` с ref `_CORE`/`_RBAC`). `test_audit_matrix_covers_every_mutating_route` (missing+stale), `test_route_introspection_not_vacuous`, `test_audit_matrix_verdicts_are_explicit`.
- ✅ **Task 3:** удалён статический `_STORY_4_4_ACTIONS` + `test_all_4_4_action_codes_in_registry` + мёртвые хелперы (`_registry_actions`, импорты `re`/`Path`/`settings`) из `test_status_audit.py`; оставлен breadcrumb-комментарий на 4.6. Прочие 4.4-тесты зелёные.
- ✅ **Task 4:** RED-эквивалент доказан для ОБОИХ фасетов (см. Debug Log); правки откачены.
- ✅ **Task 5:** `make gate` зелёный (1374 passed), тест в gate-наборе, ruff чист, makemigrations пуст, регрессия нулевая, AST-бан `test_audit_write_boundary` зелёный.
- **Анти-gold-plating:** аудит в роуты не добавлен; runtime-валидации нет; rbac-MATRIX/`audit-events.yaml`/модель/миграции/сервисы/4.5-read-API не тронуты.
- **Решения:** №1 A+B; №2 скан-всего; №3 emitted⊆registry; №4 удалён литерал; №5 все роуты _DeferredAudit.

**Статус → review.** Артефакты НЕ закоммичены агентом.

### File List

**Создано:**
- `Backend/VAPS/apps/audit/tests/test_audit_coverage.py` — мета-тест AR-9 (Фасет B source-derived closed-world + Фасет A route-coverage living-registry; 6 тестов)

**Изменено:**
- `Backend/VAPS/apps/operations/statuses/tests/test_status_audit.py` — удалён статический `_STORY_4_4_ACTIONS`/`test_all_4_4_action_codes_in_registry` + мёртвые хелперы/импорты (перекрыт source-derived тестом 4.6); breadcrumb-коммент

## Change Log

- 2026-06-27 — Dev (bmad-dev-story, Opus 4.8, TDD): реализована стори 4.6 — audit-coverage CI-страж (AR-9), тест-only. Фасет B: AST-скан `record()`/`record_many()` по `apps/**` (обе формы — kwarg + dict-литерал, скоуплен к record-вызовам, skip `tests/`) → `emitted ⊆ audit-events.yaml::actions` (одно направление — реестр forward-seed); заменяет статический `_STORY_4_4_ACTIONS` (закрывает дефер ревью 4.4, deferred-work:401). Фасет A: route-coverage living-registry (зеркало `test_rbac_matrix`) — walker мутирующих роутов + `AUDIT_MATRIX` (18 роутов = `_DeferredAudit(ref)`, аудит на сервис-уровне, роуты не аудируются); новый неклассифицированный мутирующий роут → красный. RED-эквивалент доказан для обоих фасетов. Удалён статический литерал-тест из `test_status_audit.py`. `make gate` зелёный (Postgres :5433: **1374 passed** +8, 24 deselected, makemigrations пуст, ruff check/format чисты, 24s). Регрессия нулевая. Артефакты НЕ закоммичены агентом. Status → review.

## Review Findings

_Code review 2026-06-29 (bmad-code-review, Opus 4.8 ×3 слоя: Blind Hunter / Edge Case Hunter / Acceptance Auditor). **Тест-код обоих фасетов корректен** — все ассерты сверены с реальным сервис-кодом; served-mutating 18 == AUDIT_MATRIX 18; emitted 11 ⊆ registry 20; парсер реестра, исключение `tests/`, удалённые импорты — verified clean. Findings — про forward-контракт стража, scope и точность отчёта, не про текущие баги. Итог: **2 decision · 2 patch · 4 defer · 6 dismiss**._

### Decision needed

- [x] [Review][Decision→Patch] **Forward-протекция Фасета B слабее, чем заявляет докстринг** — AST-скан ловит только ЛИТЕРАЛЬНЫЕ формы `record(action="LIT")` / `{"action":"LIT"}`; не-литеральные (именованная константа, f-string, conditional, `record_many(<переменная-список>)`, алиас-импорт `record as ...`, прямой `AuditLog.objects.create(action=…)`) тихо невидимы → будущий ложно-зелёный. Сегодня честно зелёный (все 11 эмиссий литеральны — проверено; `record()` keyword-only → позиционная форма невозможна; прямой insert закрыт `test_audit_write_boundary`). НО докстринг/PR заявляют «a new service emitting an unregistered code now turns CI red», что верно лишь для литеральных форм. [blind+edge; `apps/audit/tests/test_audit_coverage.py:68-99`] — **Решение Bratan: (A)** задокументировать инвариант + смягчить оверклейм докстринга → см. patch P-D1.
- [x] [Review][Decision→Keep] **Scope creep в `test_status_audit.py`** — добавлены 3 НОВЫХ 4.4-теста (`test_extend_with_override_*`, `test_resolve_with_override_*`, `test_confirm_return_planned_legs_*`) + 4 ассерта поверх санкционированной Task 3 «только-чистки» (спека: «1 новый + 1 MODIFY = чистка»). Добавочно и корректно (сверено с сервис-кодом), AR-9 НЕ ослабляет. [auditor; `apps/operations/statuses/tests/test_status_audit.py:329-400` + ассерты 302-321,370-375] — **Решение Bratan: (A)** оставить (написано, зелено, харднит 4.4); учёт поправить → P1.

### Patch

- [x] [Review][Patch] **P-D1** (из D1→A): смягчить оверклейм-докстринг `test_audit_coverage.py` («a new service emitting an unregistered code now turns CI red» → честная формулировка про литеральные формы) + зафиксировать инвариант «audit action-коды ОБЯЗАНЫ быть строковыми литералами прямо в `record`/`record_many`; единственная точка записи — `record()` (enforced `test_audit_write_boundary`)». [`apps/audit/tests/test_audit_coverage.py:1-31,68-73`]
- [x] [Review][Patch] **P1**: Completion Notes/Debug Log врут в учёте: «+5 нетто» → реально **+8** (+6 coverage +3 status_audit −1 удалён) — DoD «без вранья». D2=оставить → финальное +8. [`4-6-audit-coverage-тест.md:179,184,206`]
- [x] [Review][Patch] **P2**: AC4 сам себе противоречил: тело AC4 говорило `len(emitted) >= 1`, код и Task1/DevNotes — `>= 11` (код строже и верен). Prose AC4 приведён к `>= 11`. [`4-6-audit-coverage-тест.md:55`]

### Defer (pre-existing / future hardening)

- [x] [Review][Defer] Анти-вакуум `>= 11` имеет нулевой запас (== текущему числу); 1-в-1 переименование оставит `len==11`. Реальный дискриминатор — subset-тест. [`apps/audit/tests/test_audit_coverage.py:145-149`] — deferred, low
- [x] [Review][Defer] Фасет A слеп к роутам без `callback.cls` (функц-вью / Django-admin / вебхуки мутации) — принятое сквозное допущение, зеркало `test_rbac_matrix`; API проекта только DRF. Не регресс 4.6. [`apps/audit/tests/test_audit_coverage.py:233-254`] — deferred, pre-existing
- [x] [Review][Defer] `_emitted_actions` без обработки SyntaxError / не-UTF-8 по `apps/**` — будущий битый файл уронит набор непрозрачно; сейчас 6/6 зелёные. [`apps/audit/tests/test_audit_coverage.py:107-110`] — deferred, future hardening
- [x] [Review][Defer] `tests.py`-однофайлы / app-root `test_*.py` не исключены (только пакет `tests/`); в репо таких нет (verified) → нет триггера. [`apps/audit/tests/test_audit_coverage.py:107-109`] — deferred, future hardening
