---
baseline_commit: 9f646ec437d466632dd960542f7f33e85f47ae3b
---
# Story 5.8a: API POST сдачи дня (`POST /api/operations/daily-submissions/`)

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a **оператор управления (держатель `daily_report.mark_update`)**,
I want **`POST /api/operations/daily-submissions/` — HTTP-эндпоинт сдачи дня, гейченный правом и скоупом подразделения**,
so that **сдача (FR-DS, сервис `submit_day` 5.3b) доступна по паттернам API проекта, с 403 на чужое подразделение и §36-конвертом ошибок**.

> **Место в сплите 5.8** (реш. Bratan 2026-07-02): **5.8a (POST сдача)** → 5.8b (POST /{id}/amend/) → 5.8c (GET история/детали). 5.8a — ПЕРВАЯ: создаёт api-скелет `submissions/api/`, прецедент POST-body input-сериализатора и сервис-гард скоупа, которые 5.8b/5.8c реюзят. TOMORROW_BLOCKED/override-API → 6.10 (вне всего сплита 5.8).

> **Решения create-story (Bratan, 2026-07-02):**
> - **Сплит = 3-way** (a/b/c по эндпоинтам; зеркало 5.3–5.7).
> - **TOMORROW_BLOCKED + override-API → 6.10** (закрыт Q3 5.6a): блок гейтит только «расход на завтра»; `submit_day` блок НЕ консультирует — 5.8a его НЕ трогает.
> - **amend-право (5.8b) = реюз `daily_report.correct`**; **чтение (5.8c) = `mark_update` + actor-scoped селектор** — здесь только для контекста границ.

## Acceptance Criteria

1. **Endpoint смонтирован, POST-only.** **Given** запущенный API, **When** `POST /api/operations/daily-submissions/`, **Then** роут обслуживается через operations-router (`router.register("daily-submissions", …, basename="ops-daily-submission")` → route `ops-daily-submission-list`); **When** GET/PUT/PATCH/DELETE на тот же URL, **Then** `405` (list/detail приедут в 5.8c; write-глаголы кроме POST не мапятся).

2. **Гейт права (coarse, view).** **Given** аноним (без actor_id), **Then** `403 PERMISSION_DENIED`; **Given** actor без `daily_report.mark_update`, **Then** `403`; **Given** держатель кода (DIVISION_OPERATOR, ADMIN `*`), **Then** гейт пройден. Механизм: `RequirePermissionMixin` + `permission_map = {"create": "daily_report.mark_update"}`. `seed_operations` НЕ меняется (код уже посеян — seed_operations.py:16-18).

3. **Scope: чужое подразделение → 403 (ключевой инвариант).** **Given** actor с ролью, скоупленной на дивизион A (`UserRole.scope_division_id=A`), **When** сдача за дивизион B вне поддерева A, **Then** `403 PERMISSION_DENIED`; **When** сдача за A или потомка A, **Then** проходит; **Given** глобальная роль (scope NULL) или ADMIN `*`, **Then** любой дивизион проходит. Механизм: сервис-гард `ensure_division_scope(actor, "daily_report.mark_update", division_id)` (новый, `submissions/services/scope_gate.py`) через `PermissionService.has_permission(..., division_id=...)` → `DomainError("PERMISSION_DENIED", 403)`; вызывается из view ДО `submit_day` (Д1 — НЕ внутрь `submit_day`).

4. **Валидация формы (400).** **Given** payload без `division_id` / с не-UUID `division_id` / без `business_date` / с кривой датой (не `YYYY-MM-DD`), **Then** `400 VALIDATION_ERROR` через input-сериализатор (`is_valid(raise_exception=True)`, unified handler — БЕЗ ручного `Response`). Закрывает business_date=None-класс деферов для submit-пути. **And** actor берётся ТОЛЬКО из `request.actor_id` (ARCH-SEC-030) — поля `actor`/`submitted_by` в payload игнорируются.

5. **Доменные коды транслируются как есть (thin view).** **Given** несуществующий `division_id`, **Then** `404 ENTITY_NOT_FOUND` (existence-гейт УЖЕ в `submit_day` — API НЕ дублирует); **Given** повторная сдача дня, **Then** `409 DAY_ALREADY_SUBMITTED`; **Given** `business_date` вне окна `{today, today+1}` (Asia/Qyzylorda), **Then** `422 BUSINESS_DATE_OUT_OF_WINDOW`. Ответ — §36-конверт `{error_code, message, details, request_id, timestamp}`. Новые коды в реестр НЕ добавляются (все четыре уже в `error-codes.yaml`).

6. **201 + detail-проекция без снапшота.** **Given** валидная сдача, **Then** `201` с плоской snake_case проекцией ровно `{id, division_id, business_date, version, is_current, event, submitted_by, submitted_at, late}` — БЕЗ `snapshot` (тяжёлый JSON — десятки–сотни КБ; отдача снапшота решается в 5.8c) и БЕЗ `reason/sanction/triggered_by_status_id` (amend-поля, v1 всегда пусты); `submitted_by == actor_id` вызывающего; `version == 1`, `event ∈ {CHANGED, CONFIRMED_NO_CHANGES}`, `late` по контрольному часу.

7. **RBAC-матрица зелёная.** **Then** `MATRIX["ops-daily-submission-list"] = _MethodGate({"post": "daily_report.mark_update"})`; `test_matrix_covers_every_registered_route` зелёный; поведенчески — аноним `403`, держатель `≠403` (payloadless POST → 400 бизнес-слоя = ALLOW, канон матрицы).

8. **Гейт.** **Then** `make gate` зелёный: все тесты (+новые), `ruff` чист (E,F), `makemigrations --check` пуст (миграций НЕТ — API-only стори); 18 тестов `test_day_submission_service.py` НЕ тронуты и зелёные (регрессия нулевая).

## Tasks / Subtasks

- [x] **Task 1 — Сервис-гард скоупа** (AC: 3)
  - [x] Создать `apps/operations/submissions/services/scope_gate.py` → `ensure_division_scope(actor, permission_code, division_id)`: `PermissionService.has_permission(actor, permission_code, division_id=division_id)` → `False` → `raise DomainError("PERMISSION_DENIED", 403, detail={"division_id": str(division_id)})`.
  - [x] Docstring: почему гард ОТДЕЛЬНЫЙ, а не внутри `submit_day` (Д1): 18 тестов 5.3b зовут сервис без RBAC-сида — целы; форвард 5.8b — хук 5.4b (`enforce_amendment_on_retro_edit` → `amend_day`) системный, БЕЗ HTTP-прав, гейт внутри сервиса сломал бы enforcement. «Scope в сервисе» (AC 5.8 / architecture L450) = сервис-СЛОЙ владеет проверкой, view только вызывает.
  - [x] ⚠️ `PermissionService._scope_matches`: `division_id=None` → scope НЕ сужает (проверка пройдёт!) — гард обязан требовать непустой `division_id` (сериализатор гарантирует UUID, но guard-assert дешевле дыры).
  - [x] Экспорт в `services/__init__.py` `__all__`.
- [x] **Task 2 — Сериализаторы (input-прецедент + проекция)** (AC: 4, 6)
  - [x] Создать `apps/operations/submissions/api/__init__.py` (пустой) и `api/serializers.py`.
  - [x] `DailySubmissionCreateSerializer(serializers.Serializer)`: `division_id = serializers.UUIDField()`, `business_date = serializers.DateField()` — ПЕРВЫЙ POST-body input-сериализатор проекта (operations-эталоны читают `request.data` напрямую — НЕ копировать это); лишние поля payload игнорируются (DRF-канон, зеркало 5.7c unknown-params).
  - [x] `DailySubmissionSerializer(serializers.ModelSerializer)`: `Meta.model = DailySubmission`, `fields` = 9 полей AC-6, `read_only_fields = fields`. НЕ включать `snapshot`.
- [x] **Task 3 — ViewSet (create-only)** (AC: 1, 2, 3, 5, 6)
  - [x] Создать `api/views.py`: `DailySubmissionViewSet(RequirePermissionMixin, <база-зеркало TemporaryDutyViewSet>)`; mixin ПЕРВЫМ в MRO; `permission_map = {"create": "daily_report.mark_update"}`; `http_method_names = ["post", "options"]`.
  - [x] `create()` ЯВНЫЙ (зеркало `TemporaryDutyViewSet.create` operations/api/views.py:97-113): input-сериализатор → `ensure_division_scope(request.actor_id, "daily_report.mark_update", division_id)` → `submit_day(division_id=…, business_date=…, actor=request.actor_id)` → `Response(DailySubmissionSerializer(sub).data, status=201)`.
  - [x] ⚠️ БЕЗ `CreateModelMixin`/`serializer.save()` (MUST NOT `serializer.create()/update()` — architecture L448); БЕЗ try/except + ручного `Response` (handler-канон); `window_dates` НЕ прокидывать (сервисный параметр, не API-контракт).
- [x] **Task 4 — Роутинг** (AC: 1)
  - [x] Модифицировать `apps/operations/api/urls.py`: `router.register("daily-submissions", DailySubmissionViewSet, basename="ops-daily-submission")` (префикс непустой — урок 5.7c про пустой префикс DefaultRouter; basename с `ops-` — конвенция файла).
- [x] **Task 5 — RBAC-матрица** (AC: 7)
  - [x] Модифицировать `apps/operations/tests/test_rbac_matrix.py`: `MATRIX["ops-daily-submission-list"] = _MethodGate({"post": "daily_report.mark_update"})` (класс есть, :82-97) + комментарий (сдача дня, scope в сервис-гарде — матрица проверяет coarse-код).
- [x] **Task 6 — Тесты API-контракта** (AC: 1–7)
  - [x] Создать `apps/operations/submissions/tests/test_daily_submission_api.py` (зеркало test_audit_read_api/test_notifications_read_api: `APIClient` + `HTTP_X_USER_ID`; Postgres).
  - [x] RBAC-фикстуры: сеять роли/скоупы через `UserRole` (эталон `test_permission_scope.py`) либо `seed_operations` (эталон фикстуры `matrix_actors`); окно дат — `clock.override(...)` (канон, НЕ freezegun).
  - [x] Кейсы: 201 happy (форма 9 полей, `submitted_by=actor`, `version=1`) · GET→405 · аноним→403 · без кода→403 · чужой дивизион (scoped роль)→403 · поддерево-дивизион→201 · глобальная роль→201 · 400×2+ (нет/кривой `division_id`, нет/кривая `business_date`) · payload-`submitted_by` игнорируется (ARCH-SEC-030) · 404 несуществующий дивизион · 409 дубль · 422 вне окна · §36-конверт (`error_code` в ответах ошибок).
  - [x] НЕ перетестировать домен (late/event/snapshot-содержимое/race — доказано 5.3b на сервис-уровне; тесты «каждый код ошибки из спеки эндпоинта» — канон architecture L437).
- [x] **Task 7 — Гейт** (AC: 8)
  - [x] `ruff format` по КАЖДОМУ новому/тронутому файлу (per-file, урок feedback_vaps_ruff_format_scoping), `ruff check` (E,F).
  - [x] `make gate` зелёный; зафиксировать число тестов и время.

### Review Findings (code-review 2026-07-02; слои: Blind Hunter / Edge Case Hunter / Acceptance Auditor; все 8 AC — satisfied; 1 decision · 6 patch · 0 defer · 10 dismiss; все применены, гейт после патчей: 1701 passed, 27s)

- [x] [Review][Decision] Хвост 5.7c едет в диффе 5.8a — 3 файла notifications (blank-guard селектора, hardening test_isolation, +2 тест-группы read-api) не в File List стори; спека (Project Structure Notes) велела закоммитить их ДО dev 5.8a. — **Решение Bratan: два коммита** (5.7c-tail + review-фиксы его регрессии отдельно, затем 5.8a).
- [x] [Review][Patch] MAJOR: whitespace-only `X-User-Id` → 500 на `GET /api/notifications/` — новый blank-guard селектора ДОСТИЖИМ по HTTP (auth не стрипит header, гейт вьюхи проверяет только truthiness; docstring-клейм «Unreachable via HTTP» ложен; ValueError → handler шаг 5 → 500; до гварда было 200+[]). → strip в `XUserIdAuthentication` (зеркало JWT-канона `sub`) + тест `test_gate_denies_whitespace_actor_header` [Backend/VAPS/apps/core/auth/authentication.py:20-22 ← регрессия от apps/notifications/selectors.py:31]
- [x] [Review][Patch] `ensure_division_scope`: falsy-не-None `division_id` (`""`) обходит fail-loud гвард и ПРОХОДИТ для глобальной роли (та самая «тихая дыра»); str-UUID тихо 403-ит scoped-роли (type-sensitive `in` по set[UUID] из subtree_ids). → `if not division_id` + нормализация к UUID + 3 гвард-теста — контракт заявлен реюзабельным (5.8b/6.10) [Backend/VAPS/apps/operations/submissions/services/scope_gate.py:27]
- [x] [Review][Patch] Дубль literal-кода `"daily_report.mark_update"` — `permission_map` и вызов гарда никак не связаны; разъедутся молча. → модульная константа `_SUBMIT_PERMISSION` [Backend/VAPS/apps/operations/submissions/api/views.py:28,38]
- [x] [Review][Patch] Тест-гэпы API-контракта: PUT/PATCH/DELETE→405 (AC1 обещает все write-глаголы; 5.7c-suite пинует все четыре — зеркало сломано); own-division root→201; scoped-роль+phantom-UUID→403 (fail-closed контраст с 404 у global); `today+1`→201 (верх окна). → +9 тестов (сьют 16→25) [Backend/VAPS/apps/operations/submissions/tests/test_daily_submission_api.py]
- [x] [Review][Patch] Blank-guard селектора: non-str actor (int/UUID) → `AttributeError` на `.strip()` вместо задуманного самоописательного `ValueError`. → isinstance-проверка + параметр `42` в тесте [Backend/VAPS/apps/notifications/selectors.py:31]
- [x] [Review][Patch] Два имени будущего audit-события в 5 строках: `DAY_SUBMITTED` (коммент) vs `DAILY_SUBMISSION_SUBMITTED` (reason-строка). → выровнено к реестровому `DAILY_SUBMISSION_SUBMITTED` (docs/registries/audit-events.yaml) [Backend/VAPS/apps/audit/tests/test_audit_coverage.py:232-235]

## Dev Notes

### Эталоны — собирать из ТРЁХ мест (write-API над DomainError-сервисом в проекте ПЕРВЫЙ)
- **Permission-механика:** `apps/core/api/views.py:33-44` `EmployeeViewSet` — `RequirePermissionMixin` + `permission_map` (dict action→код, mixin ПЕРВЫМ в MRO); сам mixin — `apps/core/api/permissions.py:21-52` (гейт в `initial()` после `super()`, OPTIONS/metadata пропуск, отсутствие action в map → fail-closed 403). Импорт core→operations легален (operations→core разрешено).
- **Service-call + 201:** `apps/operations/api/views.py:97-113` `TemporaryDutyViewSet.create` — явный `create()`, identity из `request.actor_id` НИКОГДА из payload (ARCH-SEC-030), `Response(serializer.data, 201)` без envelope.
- **Thin-view канон (свежайший):** `apps/audit/api/views.py` + `apps/notifications/api/views.py` (5.7c) — «gate → validate → сервис/селектор → serialize», ошибки ТОЛЬКО через unified handler.

### Сервис ГОТОВ — view остаётся тонкой
`submit_day(*, division_id, business_date, actor, window_dates=None)` (`day_submission_service.py:83`) сам даёт: 400 (пустой actor) / **404 ENTITY_NOT_FOUND (existence-гейт — API НЕ дублирует, deferred-defense 5.3b L157)** / 409 DAY_ALREADY_SUBMITTED (пре-чек; race-backstop через `CONSTRAINT_ERROR_MAP` handler'а — `unique_daily_submission_current`/`_version` уже замаплены exception_handler.py:27-38) / 422 BUSINESS_DATE_OUT_OF_WINDOW. Окно default `{today, today+1}` через `Clock.today_local()`. `late`/`event`/снапшот — сервис. **`submit_day` НЕ меняется вообще.**

### ⚠️ ЛОВУШКА №1: scope-гейт НЕ внутрь submit_day (Д1, ГЛАВНЫЙ)
18 сервис-тестов 5.3b зовут `submit_day(actor="operator-1")` без RBAC-сида — гейт внутри сервиса покрасил бы их все. Плюс форвард-мина 5.8b: `enforce_amendment_on_retro_edit` (хук 3.9→5.4b) зовёт `amend_day` СИСТЕМНО, без HTTP-прав. Поэтому: отдельный `ensure_division_scope` в services/ (сервис-СЛОЙ владеет скоупом — «scope в сервисе» AC 5.8 / architecture L450 честен), view вызывает его между валидацией и `submit_day`.

### ⚠️ ЛОВУШКА №2: `_scope_matches(division_id=None)` → PASS
`apps/operations/services.py:17-24`: `division_id=None` — scope НЕ сужает, проверка проходит. Гард НИКОГДА не зовёт `has_permission` без division_id (сериализатор даёт UUID; в гарде дешёвый guard-assert на None).

### ⚠️ ЛОВУШКА №3: НЕ `CreateModelMixin` / НЕ `serializer.save()`
Architecture L442-452: «MUST NOT `serializer.create()/update()`»; сервисы принимают типизированные kwargs, НЕ request/validated_data. `create()` пишется явно, мутация — только `submit_day`.

### Двойная проверка кода — санкционирована каноном
View (mixin) проверяет код глобально (`request.effective_permissions` — резолвер БЕЗ division_id, authz.py:23-30); сервис-гард проверяет код+scope через `PermissionService.has_permission(..., division_id)` (subtree по `CoreDivisionTreeSelector.subtree_ids`, services.py:17-56). Дублирование = канон L450 («permission-класс — грубая проверка; scope — в сервисе»).

### Что уже есть (НЕ переизобретать)
- `daily_report.mark_update` посеян (seed_operations.py:16-18; DIVISION_OPERATOR :60-63, ADMIN `*`) — seed НЕ трогать.
- Коды ошибок: `PERMISSION_DENIED`(:66)/`VALIDATION_ERROR`(:26)/`ENTITY_NOT_FOUND`(:86)/`DAY_ALREADY_SUBMITTED`(:126)/`BUSINESS_DATE_OUT_OF_WINDOW`(:224) — все в `docs/registries/error-codes.yaml`; реестр НЕ трогать (closed-world: код вне реестра = СТОП).
- `DomainError(code, http_status, detail=None, ...)` — `apps/core/exceptions.py:14`; `detail` (singular kwarg) → wire-поле `details`.
- Scope-механика: `UserRole.scope_division_id` (rbac/models.py:28), `PermissionService.has_permission` (services.py:51-56), тесты-эталон `test_permission_scope.py`.
- Mount `/api/operations/` уже в `config/urls.py:7` — НЕ трогать config.

### Модель DailySubmission (читаем для проекции; НЕ меняем)
`models/daily_submission.py`: integer BigAuto PK (операционный канон — НЕ UUID-каст-ловушка audit), `division_id` UUID flat, `business_date`, `version`, `is_current`, `event` (3 choices), `submitted_by` (flat actor-id), `submitted_at` (Clock, НЕ auto_now_add), `late`, `snapshot` JSON (ТЯЖЁЛЫЙ — в проекцию НЕ отдавать, Д2), `reason`/`sanction`/`triggered_by_status_id` (amend-поля — в проекцию 5.8a НЕ отдавать).

### Дефолты (мои; Д1 — подтверждён Bratan на create-story)
- **Д1 (ГЛАВНЫЙ):** scope-гейт = отдельный сервис-гард, вызывается view (НЕ внутри submit_day). Подтверждён.
- **Д2:** 201-проекция без `snapshot` и без amend-полей (9 полей AC-6); отдача снапшота — вопрос 5.8c (detail).
- **Д3:** basename `ops-daily-submission` (конвенция `ops-*` operations/api/urls.py:9-13).
- **Д4:** api-пакет в `apps/operations/submissions/api/` (зеркало layer-структуры submissions: services/, selectors.py, api/; viewset регистрируется в operations-router).
- **Д5:** payload = ровно `{division_id, business_date}`; лишние поля игнорируются (DRF-канон, зеркало 5.7c).

### Границы (что 5.8a НЕ делает)
НЕ amend-эндпоинт (5.8b) · НЕ GET list/detail/пагинация/ordering/селекторы чтения (5.8c) · НЕ TOMORROW_BLOCKED/override/блок-консультация при сдаче (6.10, реш. Bratan) · НЕ аудит DAY_SUBMITTED (5.9) · НЕ notify() (готов, но эмиссия при сдаче не специфицирована — вне) · НЕ новые permission-коды/seed · НЕ новые error-коды/реестр · НЕ Admin-регистрация DailySubmission (architecture L467 MUST NOT) · НЕ трогает `submit_day`/`amend_day`/селекторы/модель/миграции · НЕ throttle/OpenAPI (проектная позиция).

### Project Structure Notes
- Создаются: `apps/operations/submissions/services/scope_gate.py`, `apps/operations/submissions/api/{__init__,serializers,views}.py`, `apps/operations/submissions/tests/test_daily_submission_api.py`.
- Модифицируются: `apps/operations/submissions/services/__init__.py` (экспорт), `apps/operations/api/urls.py` (register), `apps/operations/tests/test_rbac_matrix.py` (строка).
- Миграций НЕТ; `config/urls.py` НЕ трогается. Счёт: 5 create + 3 modify — в бюджете (одна ответственность: POST-эндпоинт + его гейты).
- Рабочее дерево на момент создания стори содержит НЕзакоммиченные ревью-патчи 5.7c (isolation-гвард усилен, blank-guard селектора, +7 тестов) — закоммитить ДО старта dev 5.8a.

### Previous Story Intelligence (5.7c, review 2026-07-02)
- Thin-view + unified handler канон подтверждён ревью (ACCEPT все 10 AC, cross-model Fable 5 vs Opus 4.8).
- Уроки ревью, применимые здесь: (1) анонимные write-глаголы идут по ветке раннего return mixin'а → 405 ДО auth — покрыть тестом сразу (в 5.7c добавляли патчем); (2) blank/None вход в load-bearing фильтр — fail-loud, не тихий пустой результат (зеркало для Ловушки №2); (3) `ruff format` строго per-file; (4) вакуумные тест-гварды (сканирует ничего → зелёный) — не писать таких.
- Паттерн routing 5.7c: пустой префикс DefaultRouter конфликтует с api-root — здесь префикс непустой, DefaultRouter operations-канон работает как есть.

### References
- [Source: epics.md:769-776 + декомпозиционная нота 5.8 (2026-07-02)] — стори, AC, сплит, решения.
- [Source: architecture.md L409-411 (URL-канон), L427 (envelope/201-detail), L431-433 (400/422/409 + §36), L442-452 (layer contract, MUST NOT serializer.save, scope в сервисе L450), L437 (тест на каждый код), L463 (идемпотентность POST), L467 (Admin MUST NOT), L483 (пример daily-submissions)].
- [Source: apps/operations/submissions/services/day_submission_service.py:83 + docstring] — контракт submit_day.
- [Source: apps/operations/services.py:17-56] — PermissionService._scope_matches/has_permission (+None-pass ловушка).
- [Source: apps/core/api/permissions.py:21-52] — RequirePermissionMixin; [apps/core/api/views.py:33-44] — permission_map эталон.
- [Source: apps/operations/api/views.py:97-113] — TemporaryDutyViewSet.create (201-эталон, ARCH-SEC-030); [apps/operations/api/urls.py:9-13] — router/basename конвенция.
- [Source: apps/core/api/exception_handler.py:27-38,141-176] — CONSTRAINT_ERROR_MAP (409-backstop уже замаплен), §36-конверт.
- [Source: apps/operations/management/commands/seed_operations.py:16-18,45-71] — daily_report.* коды и держатели.
- [Source: apps/operations/tests/test_rbac_matrix.py:82-97,191-235] — _MethodGate + интроспекция; [test_permission_scope.py] — scope-фикстуры.
- [Source: docs/registries/error-codes.yaml:26,66,86,126,224] — все коды стори уже в реестре.
- [Source: deferred-work.md L460,L482,L488] — business_date=None-класс: submit-путь закрывается сериализатором здесь; amend-путь → 5.8b; блок/override → 6.10.
- [Source: memory feedback_vaps_ruff_format_scoping, feedback_vaps_arch_guards] — per-file format; Admin=справочники; тестируемые инварианты.

## Dev Agent Record

### Agent Model Used

Fable 5 — `claude-fable-5`

### Debug Log References

- RED: 16/16 тестов падали `NoReverseMatch: ops-daily-submission-list` (роута нет) — подтверждён на Postgres :5433.
- GREEN: 16/16 API-тестов; `test_rbac_matrix.py` 394 passed (+9 поведенческих по новому роуту).
- `make gate`: **1687 passed, 25 deselected, makemigrations «No changes detected», ruff чист, 27s** (< 300s NFR-8).

### Implementation Plan / Decisions

- **TDD red→green:** тесты HTTP-контракта первыми (RED: NoReverseMatch), затем реализация (GREEN 16/16).
- **Scope-гейт (Д1, подтверждён Bratan):** `ensure_division_scope` в `services/scope_gate.py` — вне `submit_day`; guard-assert `division_id is None → ValueError` (ловушка `_scope_matches(None)`→PASS); 403 несёт `details={"division_id"}`.
- **ViewSet:** `RequirePermissionMixin + viewsets.ViewSet` (mixin первым в MRO), явный `create()` (БЕЗ CreateModelMixin/serializer.save — L448); `http_method_names=["post","options"]` → GET 405 (тестированы authed И anon ветки — урок 5.7c).
- **Открытие по ходу (в рамках AC-8):** audit-coverage страж 4.6 (`test_audit_matrix_covers_every_mutating_route`, AR-9 живой реестр) требует классифицировать каждый новый мутирующий роут → добавлена строка `AUDIT_MATRIX["ops-daily-submission-list"] = _DeferredAudit("аудит сдач → 5.9")` в `apps/audit/tests/test_audit_coverage.py`. Файл не был в плане стори — обязательная пара к строке RBAC-матрицы; урок для 5.8b/5.8c: каждый новый write-роут = 2 реестровые строки (RBAC + audit-coverage).

### Completion Notes List

- ✅ AC1 endpoint `POST /api/operations/daily-submissions/` (route `ops-daily-submission-list`, POST-only; GET → 405 у authed и anon).
- ✅ AC2 coarse-гейт: аноним 403 / без кода 403 / держатель проходит; seed не тронут.
- ✅ AC3 scope: чужой дивизион 403 (+details), поддерево 201, глобальная роль 201 — через `ensure_division_scope`.
- ✅ AC4 форма: 400×4 (нет/кривой UUID, нет/кривая дата); identity из payload игнорируется (ARCH-SEC-030).
- ✅ AC5 доменные коды как есть: 404/409/422 + §36-конверт; try/except в view нет.
- ✅ AC6 201-проекция ровно 9 полей, без snapshot/amend-полей; `submitted_by == actor_id`.
- ✅ AC7 RBAC-матрица `_MethodGate({"post": mark_update})` — completeness + поведенческие зелёные.
- ✅ AC8 `make gate` зелёный (1687), миграций нет, 18 тестов 5.3b не тронуты.
- Границы соблюдены: `submit_day`/`amend_day`/селекторы/модель/seed/реестр кодов/Admin/аудит/notify — не тронуты; amend (5.8b), GET (5.8c), блок (6.10) — вне.

### File List

**Created:**
- `Backend/VAPS/apps/operations/submissions/services/scope_gate.py`
- `Backend/VAPS/apps/operations/submissions/api/__init__.py`
- `Backend/VAPS/apps/operations/submissions/api/serializers.py`
- `Backend/VAPS/apps/operations/submissions/api/views.py`
- `Backend/VAPS/apps/operations/submissions/tests/test_daily_submission_api.py`

**Modified:**
- `Backend/VAPS/apps/operations/submissions/services/__init__.py` (экспорт `ensure_division_scope`)
- `Backend/VAPS/apps/operations/api/urls.py` (register `daily-submissions`)
- `Backend/VAPS/apps/operations/tests/test_rbac_matrix.py` (строка `ops-daily-submission-list`)
- `Backend/VAPS/apps/audit/tests/test_audit_coverage.py` (строка `AUDIT_MATRIX` — deferred на 5.9)

## Change Log

| Дата | Версия | Изменение | Автор |
|------|--------|-----------|-------|
| 2026-07-02 | 0.1 | Создана стори (bmad-create-story, Fable 5): декомпозиция 5.8 → a/b/c (реш. Bratan), 5.8a = POST сдачи; 4 решения зафиксированы (сплит, TOMORROW_BLOCKED→6.10, amend=correct, чтение=mark_update+scope) | Bratan |
| 2026-07-02 | 1.0 | Реализован POST сдачи дня (TDD): scope_gate-сервис + api-скелет submissions (первый POST-body input-сериализатор) + create-only ViewSet + роутинг + строки RBAC-матрицы и AUDIT_MATRIX (deferred 5.9). 16 API-тестов. `make gate` зелёный (1687 passed). Status → review | Amelia (dev-story) |
| 2026-07-02 | 1.1 | Code-review (3 слоя, все 8 AC satisfied): 1 decision (два коммита — 5.7c-tail отдельно) + 6 patch применены — MAJOR-фикс 500 на whitespace `X-User-Id` (strip в auth, регрессия blank-гварда 5.7c), ужесточение `ensure_division_scope` (falsy + UUID-нормализация), константа permission-кода, +9 контракт-тестов, isinstance в селекторе, имя audit-события по реестру; 10 dismiss. `make gate` 1701 passed, 27s. Status → done | Bratan + Fable 5 (code-review) |
