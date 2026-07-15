---
baseline_commit: 596987c (HEAD «fix(story-10.1): правки cross-model ревью»). Стори — бэкфилл AI-4 ретро E10 (§7), первый сплит. Садится МЕЖДУ 10.1 (done) и 10.2 (backlog); блокирует 10.2 по данным. GET «вчера» (префилл грида) — отдельная стори 10.1b, НЕ здесь.
---

# Story 10.1a: REST bulk-роут массового создания статусов

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a **оператор управления**,
I want **HTTP POST-эндпоинт `/api/operations/statuses/bulk/`, который принимает `{business_date, rows[]}`, гейтит по праву `status.manage`, сам резолвит мои разрешённые подразделения из RBAC (payload дивизиону НЕ верим) и делегирует готовому сервису `bulk_create_statuses` (3.8)**,
so that **утреннее массовое обновление управления (FR-12) стало вызываемым по сети — фронт 10.2 пишется от РЕАЛЬНОГО контракта в `schema.d.ts`, а сверка shape/ошибок живёт в бэке, а не в UI (закрытие дефекта «frontend-first против несуществующей поверхности», ретро E9 §3)**.

## Acceptance Criteria

Источник: ретро E10 [epic-9-retro-2026-07-14.md#L75] (AI-4: «HTTP-роут bulk-3.8 + регенерация schema.d.ts + query-загрузка вчера»; гейт «schema.d.ts содержит bulk-роут»); FR-12 [epics.md#L43]; сервис 3.8 [3-8-bulk-api-массового-обновления.md] (AC-9: REST/сериализатор явно делегированы «API-стори E10» — это она); ARCH-SEC-030 (identity из auth-контракта, не payload); фронт-контракт [frontend/src/features/daily-grid/prefill.ts:19-29] (`BulkStatusRequest = {business_date, rows[]}`, БЕЗ division_id).

1. **AC-1 (happy path → 201 + счётчик).** Given держатель `status.manage` со scope на управление, POST `{business_date, rows:[3 валидных]}`, When вызываю эндпоинт, Then **201**, тело `{"created": 3}`, в БД ровно 3 `EmployeeStatus` (source=USER), неуказанные — без записей (derived, 3.7). Вьюха вызвала сервис с `actor=request.actor_id` и резолвнутым `allowed_division_ids`.
2. **AC-2 (per-row ошибки → envelope `details.rows[]`, ничего частично).** Given одна строка пересекает существующий soft-статус (ACTIVE), Then **409**, тело §36-envelope `{"error_code":"STATUS_OVERLAP_WARNING","message":…,"details":{"rows":[{"index","employee_id","code","message"}]},"request_id","timestamp"}`, в БД **0** статусов. hard-пересечение → **422** `OVERLAPPING_HARD_STATUS`. Смешанный payload (422-строка + 409-строка) → агрегат **422**, обе строки в `details.rows`. (Сервис 3.8 уже так бросает; вьюха НИЧЕГО не ловит — DomainError течёт через `domain_exception_handler`.)
3. **AC-3 (структурная валидация → 400).** Given payload с (а) дублем `employee_id`, ИЛИ (б) отсутствующим обязательным ключом строки (`employee_id`/`status_type_code`/`date_start`/`date_end`), ИЛИ (в) пустым `rows`, ИЛИ (г) неверным типом (не-UUID / не-date), Then **400** `VALIDATION_ERROR` (DRF-сериализатор ловит (б)/(в)/(г) на границе; сервис 3.8 ловит (а) set-проверкой), в БД 0. Тело — тот же envelope с `details`.
4. **AC-4 (чужой scope → 403, резолв В ВЬЮХЕ).** Given держатель `status.manage` со scope НЕ покрывающим дивизион сотрудника из строки, When вызываю, Then **403** `PERMISSION_DENIED` (сервис 3.8 fail-fast по `allowed_division_ids`, резолвнутым вьюхой через `PermissionService.visible_division_ids(actor,"status.manage")`), в БД 0. (Решение №2 3.8: scope — параметр сервиса, фронту не доверяем.)
5. **AC-5 (грубый гейт права → 403 ДО сервиса).** Given актор БЕЗ `status.manage` (напр. держит только `status.view`), Then **403** `PERMISSION_DENIED` на `RequirePermissionMixin` — сервис НЕ вызывается. Аноним (без `actor_id`) → **403**. `*`-wildcard (ADMIN) проходит гейт.
6. **AC-6 (identity из контракта, source форсирован).** actor берётся ТОЛЬКО из `request.actor_id` (X-User-Id/JWT seam, 2.13); поля `actor`/`source`/`created_by` в payload игнорируются (ARCH-SEC-030). Все созданные строки — `source=USER` (форсит сервис 3.8). `business_date` — из payload (операторская дата обновления), не из Clock.
7. **AC-7 (глобальный scope → все дивизионы).** Given актор с безскоуповым грантом `status.manage` (`visible_division_ids` → `None`), Then вьюха трактует это как «все дивизионы» и bulk проходит по строкам любых подразделений (нет ложного 403). (None-контракт `visible_division_ids` — глобальная видимость.)
8. **AC-8 (схема регенерирована + нет дрейфа — ГЕЙТ РЕТРО).** `Backend/VAPS/schema.yaml` перегенерирован (`make schema`) и содержит `POST /api/operations/statuses/bulk/` с телом `{business_date, rows[]}` и ответом 201; `apps/core/tests/test_schema_drift.py` зелёный. `frontend/src/shared/api/schema.d.ts` перегенерирован (`npm run generate:api`) и **содержит bulk-роут** (буквальный гейт AI-4); фронт-гейт `schema-check.mjs` зелёный.
9. **AC-9 (RBAC-матрица покрывает роут).** Новый роут внесён в живой реестр `MATRIX` (`test_rbac_matrix.py`) строкой `ops-status-bulk` → `_MethodGate({"post":"status.manage"})`; `test_matrix_covers_every_registered_route` и `test_method_gates_cover_exactly_served_methods` зелёные (нет missing/stale). Ожидания ALLOW/DENY поведенческого теста выводятся из **реального** seed (`_holders` читает `ROLE_PERMISSIONS`) — держатели `status.manage` (ADMIN via `*`, INTEGRATION_USER) → ALLOW, прочие → DENY, аноним → DENY. **seed НЕ меняется**: гранение `status.manage` роли `DIVISION_OPERATOR` — PROVISIONAL policy-решение Bratan (раскладка ролей в seed помечена «тест проверяет механизм, не политику»), выносится как открытый вопрос, НЕ бэйкается в эту инфра-стори.
10. **AC-10 (cap на размер payload — закрытие 3.8-defer).** `rows` ограничен сверху `max_length` на ListField (граница утра ~40–300 строк на управление; cap = 1000 с запасом). Payload > cap → **400** `VALIDATION_ERROR`. (Дефер 3.8 «нет cap на payload → сериализатор E10» — закрывается здесь, на естественной границе.)
11. **AC-11 (регресс нулевой + гейт обеих сторон).** Сервис 3.8 (`bulk_create_statuses`, `bulk_status_service.py`), матрица-поведение существующих роутов, весь бэкенд-репозиторий — зелёные без правок логики. `make gate` (из `Backend/VAPS`) зелёный; `makemigrations --check` «No changes detected» (стори без модели/миграции — seed-грант через данные seed-команды, не schema). Фронт `npm run gate` зелёный.

## Tasks / Subtasks

- [x] **Task 1 — Сериализаторы payload** (`apps/operations/statuses/api/serializers.py`, NEW) (AC: 3,10)
  - [x] `BulkStatusCreateRowSerializer(serializers.Serializer)`: `employee_id=UUIDField()`, `status_type_code=CharField(max_length=50)`, `date_start=DateField()`, `date_end=DateField()`, `comment/document_basis/source_ref=CharField(required=False, allow_blank=True)`. Обязательные 4 ключа зеркалят `_REQUIRED_ROW_KEYS` сервиса 3.8 (отсутствие → DRF 400 ДО сервиса, дублирующая страховка shape-guard'а 3.8).
  - [x] `BulkStatusCreateSerializer(serializers.Serializer)`: `business_date=DateField()`, `rows=BulkStatusCreateRowSerializer(many=True, allow_empty=False, max_length=1000)`. **НЕТ `division_id`** — scope резолвится из RBAC актора (фронт-контракт 9.7; Решение №2 3.8). `allow_empty=False` → пустой `rows` = 400 (AC-3в); `max_length=1000` = cap (AC-10). `actor`/`source` в payload игнорируются (не объявлены — DRF отбросит; ARCH-SEC-030).
  - [x] `__init__.py` пакета `api/` (NEW пустой).
- [x] **Task 2 — StatusViewSet + bulk-action** (`apps/operations/statuses/api/views.py`, NEW) (AC: 1,2,4,5,6,7)
  - [x] `class StatusViewSet(RequirePermissionMixin, viewsets.ViewSet)`: `http_method_names = ["post", "options"]`; `permission_map = {"bulk": "status.manage"}`.
  - [x] `@action(detail=False, methods=["post"], url_path="bulk", url_name="bulk") def bulk(self, request)`:
    1. `form = BulkStatusCreateSerializer(data=request.data); form.is_valid(raise_exception=True)` (AC-3/10).
    2. `allowed = PermissionService.visible_division_ids(request.actor_id, "status.manage")` → если `None` (глобальный) → `allowed = set(CoreDivisionTreeSelector.divisions_map().keys())` (все id дивизионов одним запросом; AC-7; см. Решение №3 — не звать сервис с `None`, привести к множеству).
    3. `created = bulk_create_statuses(form.validated_data["rows"], actor=request.actor_id, business_date=form.validated_data["business_date"], allowed_division_ids=allowed)`.
    4. `return Response({"created": len(created)}, status=201)`.
  - [x] `@extend_schema(request=BulkStatusCreateSerializer, responses={201: inline_serializer("BulkStatusCreateResponse", {"created": serializers.IntegerField()})}, description="…403/400/409/422…")` — чтобы spectacular эмитил тело запроса и ответа (ARCH-FE-011: фронт кодогенит из схемы, не пишет типы руками; прецедент MyPermissionsViewSet 8.6).
  - [x] Вьюха НЕ ловит `DomainError` и НЕ фильтрует по правам вручную — 400/403/404/409/422 сервиса текут через `domain_exception_handler` (layer contract, зеркало `DailySubmissionViewSet`).
- [x] **Task 3 — Регистрация роута** (`apps/operations/api/urls.py`, MOD) (AC: 8,9)
  - [x] `from apps.operations.statuses.api.views import StatusViewSet`; `router.register("statuses", StatusViewSet, basename="ops-status")`. Reverse-имя action = `ops-status-bulk` → URL `/api/operations/statuses/bulk/`.
- [x] **Task 4 — RBAC-матрица (строка живого реестра)** (AC: 5,9)
  - [x] `apps/operations/tests/test_rbac_matrix.py` (MOD): в `MATRIX` добавить `"ops-status-bulk": _MethodGate({"post": "status.manage"})`. Свериться с `ops-daily-submission-amend` (паттерн @action-роута). Ожидания ALLOW/DENY посчитаются автоматически из seed (`_holders`) — держатели `status.manage` (ADMIN, INTEGRATION_USER). НЕ хардкодить per-role.
  - [x] **seed НЕ трогать.** Гейт-код = существующий `status.manage` (Решение №4). Грант `DIVISION_OPERATOR` — открытый policy-вопрос Bratan (см. AC-9); зафиксировать в Completion Notes как решение к принятию, не менять `ROLE_PERMISSIONS`.
- [x] **Task 5 — Регенерация схемы (обе половины)** (AC: 8)
  - [x] Бэк: `make schema` (из `Backend/VAPS`) → перегенерить `schema.yaml`; проверить, что `POST /api/operations/statuses/bulk/` появился; `test_schema_drift.py` зелёный.
  - [x] Фронт: `cd frontend && npm run generate:api` → перегенерить `src/shared/api/schema.d.ts`; проверить наличие bulk-роута (гейт AI-4); `node scripts/schema-check.mjs` зелёный.
- [x] **Task 6 — API-тесты** (`apps/operations/statuses/tests/test_bulk_status_api.py`, NEW) (AC: 1–7,10)
  - [x] Реюз фикстур env 3.8 (org/div + StatusTypes; сотрудники). Клиент — `APIClient().credentials(HTTP_X_USER_ID=<actor>)`; актору-держателю грантится роль с `status.manage` (посев `seed_operations` + `UserRole.objects.create(user_id=…, role_code_id="INTEGRATION_USER")` — паттерн `test_rbac_matrix.matrix_actors`). Держатель с scope: назначить `UserRole` со `scope_division_id=div.id` держащей роли, ЛИБо глобальный (unscoped) грант для AC-1/AC-7.
  - [x] AC-1: 201, `{"created":3}`, count==3, source==USER (держатель, unscoped ⇒ global scope). AC-2: soft→409 envelope `error_code=STATUS_OVERLAP_WARNING`+`details.rows`+count==0; hard→422; mixed→422. AC-3: дубль→400, пропуск ключа→400, пустой rows→400, не-UUID→400. AC-4: держатель со scope на ДРУГОЙ дивизион, строка сотрудника вне scope→403, count==0. AC-5: актор БЕЗ `status.manage` (напр. роль `VIEWER`/`DIVISION_OPERATOR` — только `status.view`)→403 (mixin, count==0); аноним→403. AC-7: unscoped-грант→bulk по сотрудникам разных дивизионов проходит. AC-10: rows length 1001→400.
- [x] **Task 7 — Гейт обеих сторон** (AC: 8,11)
  - [x] `make gate` (Postgres :5433, из `Backend/VAPS`): pytest-подсет + ruff + `makemigrations --check` «No changes detected», бюджет 300s. Матрица + schema-drift + новые API-тесты зелёные. Регресс 3.8/существующих роутов зелёный.
  - [x] `cd frontend && npm run gate`: `schema-check.mjs` + tsc + eslint + vitest + build + size-gate зелёные (schema.d.ts обновлён, типов руками не добавлено).

## Dev Notes

### Решения (ПРИНЯТО = A по рекомендации; менять осознанно)

> **№1 = A (тонкая вьюха над готовым сервисом).** Вся бизнес-логика — в `bulk_create_statuses` (3.8, done, отревьюен). Вьюха: сериализатор → резолв scope → вызов сервиса → 201. НИКАКОЙ бизнес-валидации/конфликт-детекта в вьюхе (дублировать 3.8 = дрейф). Зеркало `DailySubmissionViewSet`/`ExpenseReportViewSet` (submissions/api/views.py).
> **№2 = A (scope резолвится в вьюхе через `visible_division_ids`, НЕ `ensure_division_scope`).** `ensure_division_scope` проверяет ОДНУ division_id — не годится: bulk-payload охватывает много сотрудников разных дивизионов, а сервис 3.8 энфорсит per-row по множеству `allowed_division_ids`. Вьюха резолвит МНОЖЕСТВО через `PermissionService.visible_division_ids(actor, "status.manage")` и передаёт в сервис. `division_id` в payload НЕТ (фронт-контракт 9.7).
> **№3 = A (глобальный `None` → множество всех дивизионов В ВЬЮХЕ через core-селектор).** `visible_division_ids` возвращает `None` при безскоуповом гранте (ADMIN `*` / unscoped роль). Сервис 3.8 ждёт множество и делает `emp.division_id in allowed` — `None` уронил бы `TypeError`. Вьюха приводит `None` к «все дивизионы» ДО вызова сервиса: `set(CoreDivisionTreeSelector.divisions_map().keys())` (метод есть, `apps/core/selectors.py:122`, «None = the whole DB», один запрос). **НЕ дёргать `Division.objects` из operations напрямую** (ARCH-003: operations читает core только через селекторы; прецедент — submissions/api/views.py импортирует `CoreDivisionTreeSelector`). Материализация id при пилотном масштабе (сотни дивизионов) тривиальна; сервис 3.8 НЕ трогаем (None-passthrough в сервис = раздувание blast-radius, отвергнуто).
> **№4 = A (право = существующий `status.manage`).** Не плодить новый код. `status.manage` («Управление статусами») уже в seed-реестре; сейчас держат ADMIN (`*`) и INTEGRATION_USER. Матрица гейтит `post` на `status.manage`. **Грант операторской роли (`DIVISION_OPERATOR`) — НЕ здесь**: раскладка ролей в `seed_operations` помечена PROVISIONAL («тест проверяет механизм, не политику», открытый вопрос Bratan). Инфра-стори строит МЕХАНИЗМ (гейтимый роут); кому дать право писать статусы — policy-решение, выносится в Completion Notes. Happy-path тесты используют держателя (`INTEGRATION_USER` или роль с прямым грантом `status.manage`).
> **№5 = A (ответ = счётчик `{created:N}`).** 10.2 AC: «Given успех → счётчик применённых отклонений». Минимальный контракт. Богатая проекция созданных строк (id/serialized) — не нужна консьюмеру сейчас; отметить defer, если 10.2 потребует эхо строк.

### Архитектурные правила (developer guardrails)

- **DomainError НЕ ловить.** `EXCEPTION_HANDLER = apps.core.api.exception_handler.domain_exception_handler` (settings) конвертит `DomainError(code, http_status, detail)` в §36-envelope `{error_code, message, details, request_id, timestamp}`. `detail={"rows":[…]}` сервиса 3.8 садится в `details.rows` как есть. Никаких try/except/ручных Response в вьюхе (layer contract, submissions/api/views.py docstring).
- **Сигнатура `DomainError` — `(code, http_status, detail=None, overridable=False, message=None)`** (`apps/core/exceptions.py:32`). code ПЕРВЫМ. (Здесь сами НЕ бросаем — сервис 3.8 бросает; знать для тестов, что читают `error_code`/`details`.)
- **`overridable` НЕ сурфейсится envelope'ом** (поле не в `_envelope`). Bulk-override — OUT (AC-9 3.8: массовый обход soft → отдельная стори). 409 `STATUS_OVERLAP_WARNING` сам по коду сигналит overridable-семантику клиенту; override-retry с причиной — seam 10.2 (ретро §5.2). НЕ добавлять overridable в этот роут.
- **`RequirePermissionMixin` первым в MRO** (`class StatusViewSet(RequirePermissionMixin, viewsets.ViewSet)`): его `initial` оборачивает DRF-цепочку. Гейт читает `request.effective_permissions` (populated 2.13-seam `EffectivePermissionsResolver` в `DEFAULT_AUTHENTICATION_CLASSES`). Action вне `permission_map` → fail-closed 403; `test_rbac_matrix` completeness гарантирует, что gap всплывёт на тесте, не в проде — поэтому Task 4 (MATRIX-строка) load-bearing.
- **`http_method_names = ["post", "options"]`** — HEAD/GET/PUT/DELETE → 405 (минимальная поверхность, зеркало submissions 5.8). `bulk` — `@action(detail=False)`, значит роут `/statuses/bulk/`, а НЕ `/statuses/`; list/create самого ViewSet не определяем (не нужны в 10.1a; GET «вчера» = 10.1b добавит list).
- **identity — только `request.actor_id`** (X-User-Id/JWT seam, `apps/core/auth/authentication.py`; ARCH-SEC-030). Payload-поля actor/source/created_by игнорировать (не в сериализаторе). source=USER форсит сам сервис.
- **Регенерация схемы — ОБЯЗАТЕЛЬНА и двусторонняя.** Бэк `make schema` (иначе `test_schema_drift` красный), фронт `npm run generate:api` (иначе `schema-check.mjs` красный + гейт AI-4 не выполнен). Оба артефакта (`schema.yaml`, `schema.d.ts`) в File List и коммите.

### Project Structure Notes

- **NEW** пакет `apps/operations/statuses/api/` (`__init__.py`, `serializers.py`, `views.py`) — REST-поверхность статусов (сейчас в `statuses/` нет `api/`; поверхность живёт в `operations/api/` и `submissions/api/`; создаём по образцу submissions).
- **MOD** `apps/operations/api/urls.py` — `router.register("statuses", …)`.
- **MOD** `apps/operations/tests/test_rbac_matrix.py` — строка MATRIX (seed НЕ трогаем).
- **REGEN** `Backend/VAPS/schema.yaml`, `frontend/src/shared/api/schema.d.ts`.
- **NEW** `apps/operations/statuses/tests/test_bulk_status_api.py`.
- Файлов ~6 (сериализатор+вьюха+urls+matrix+2 схемы+тест). Выше ориентира «≤5», но это неделимый минимум для ОДНОГО гейтимого REST-роута с drift/matrix-гейтами — сплит меньше сломал бы связность (роут без матрицы/схемы не проходит гейт). Связная ответственность: «HTTP-поверхность bulk-создания статусов».

### Previous Story Intelligence

- **3.8 (done):** `bulk_create_statuses(rows, *, actor, business_date, allowed_division_ids)` — атомарно, no-N+1, per-row `detail.rows[]`, агрегат 422>409, дубль→400, пропуск ключа→400 (shape-guard `_REQUIRED_ROW_KEYS`), уволенный→422, чужой div→403, missing emp→404. Возвращает список созданных `EmployeeStatus`. **Вьюха 10.1a НИЧЕГО из этого не переписывает** — только резолвит `allowed_division_ids` и зовёт. Дефер 3.8 «cap на payload → сериализатор E10» закрывается здесь (AC-10); дефер «overridable в агрегат-конверте» остаётся OUT (bulk-override не строим).
- **9.7 (done):** фронт-контракт `prefill.ts` (`BulkStatusRequest={business_date, rows[]}`, 4 обяз. ключа строки, БЕЗ division_id) заведомо выровнен по 3.8. 10.1a обязана отдать роут ИМЕННО этой формы, иначе 9.7-маппер (`toBulkRequest`) не состыкуется. Комментарий 9.7: «HTTP-роут = 10.2/E10, там division_id/actor, Q1» — Q1 закрывается ЗДЕСЬ (division_id не в payload, actor из seam).
- **5.8a/b/c, 6.10a/b (submissions/api):** эталонный паттерн тонкой вьюхи (`RequirePermissionMixin` + `permission_map` + `http_method_names` + `@extend_schema` + сервис + envelope без try/except). Копировать структуру, не логику.
- **2.13/2.9 (RBAC):** `EffectivePermissionsResolver` кладёт `request.effective_permissions`; `PermissionService.visible_division_ids(user, code)` → множество или `None`. `MATRIX` в `test_rbac_matrix.py` — живой реестр, новый роут обязан иметь строку.
- **8.6 (MyPermissionsViewSet):** прецедент `@extend_schema(inline_serializer)` на plain ViewSet, чтобы spectacular эмитил тело (иначе «No response body» и фронт нечего кодогенить, ARCH-FE-011).

### Git Intelligence

- Baseline `596987c` (10.1 done). Рабочее дерево чистое.
- Коммит (за Bratan, после ревью): `feat(story-10.1a): REST bulk-роут статусов + regen schema (backfill AI-4)`. dev-story = RED→GREEN + `make gate` (бэк) + `npm run gate` (фронт). Артефакты (включая `schema.yaml`/`schema.d.ts`) НЕ коммитит агент.
- Прецедент same-model caveat: если ревью той же моделью — красная проба ОБЯЗАТЕЛЬНА на важных ассертах (scope-403, `details.rows`-surfacing, drift-гейт), ретро E10 AI-1/AI-2.

### References

- [Source: _bmad-output/implementation-artifacts/epic-9-retro-2026-07-14.md#L75, #L80-88] — AI-4 (scope + гейт «schema.d.ts содержит bulk-роут»; порядок 10.1→AI-4→10.2).
- [Source: _bmad-output/implementation-artifacts/3-8-bulk-api-массового-обновления.md] — сервис `bulk_create_statuses` (AC-9: REST→E10; Решения №1/№2 scope-параметр; defer cap payload → сериализатор).
- [Source: Backend/VAPS/apps/operations/statuses/services/bulk_status_service.py:58] — сигнатура сервиса `(rows, *, actor, business_date, allowed_division_ids)`.
- [Source: Backend/VAPS/apps/operations/services.py:70-106] — `PermissionService.visible_division_ids` (множество или None=глобально).
- [Source: Backend/VAPS/apps/core/selectors.py:100-112] — `CoreDivisionTreeSelector.subtree_ids`/`children_map` (для «все дивизионы» при None — свериться на наличие all-ids метода).
- [Source: Backend/VAPS/apps/core/api/permissions.py:21-62] — `RequirePermissionMixin` (`permission_map`, fail-closed, MRO-первым).
- [Source: Backend/VAPS/apps/core/api/exception_handler.py:75-87, 141-145] — §36-envelope `{error_code, message, details, request_id, timestamp}`; `domain_exception_handler`.
- [Source: Backend/VAPS/apps/core/exceptions.py:32] — `DomainError(code, http_status, detail, overridable, message)`.
- [Source: Backend/VAPS/apps/operations/submissions/api/views.py:115-171] — эталон тонкой вьюхи (`DailySubmissionViewSet`).
- [Source: Backend/VAPS/apps/operations/api/urls.py] — router.register (добавить `statuses`).
- [Source: Backend/VAPS/config/urls.py:7] — префикс `api/operations/`.
- [Source: Backend/VAPS/apps/operations/tests/test_rbac_matrix.py:122, 279-320] — `MATRIX` живой реестр + completeness-тесты.
- [Source: Backend/VAPS/apps/operations/management/commands/seed_operations.py:5-63] — реестр прав + роли (`status.manage`, `DIVISION_OPERATOR`).
- [Source: Backend/VAPS/apps/core/tests/test_schema_drift.py] — `schema.yaml` vs `spectacular --file`; регенерация `make schema`.
- [Source: frontend/package.json] — `generate:api` (`openapi-typescript ../Backend/VAPS/schema.yaml -o src/shared/api/schema.d.ts`), `gate` (`schema-check.mjs` + tsc + eslint + vitest + build + size-gate).
- [Source: frontend/src/features/daily-grid/prefill.ts:19-29, 79-101] — фронт-контракт `BulkStatusRequest` (форма роута обязана совпасть).

## Dev Agent Record

### Agent Model Used

Opus 4.8 (Claude Code) — bmad-dev-story, TDD (RED→GREEN), 2026-07-15.

### Debug Log References

- **RED:** `test_bulk_status_api.py` собран первым → `NoReverseMatch: Reverse for 'ops-status-bulk' not found` (роута нет). Проба валидна.
- **GREEN:** после `api/{serializers,views}.py` + `router.register("statuses")` — 13 API-тестов зелёные (2.6s). Матрица (`test_rbac_matrix`) — все кейсы `ops-status-bulk|post|<role>` зелёные без правки seed (expected выведен из `_holders`: ALLOW ADMIN/INTEGRATION_USER, DENY прочие+аноним).
- **Два архитектурных гварда поймали пропуски спеки** (оба — реальный долг, не шум):
  1. `test_schema_drift` красный до `make schema` → регенерация `schema.yaml` (bulk-роут на L1528) → зелёный; фронт `npm run generate:api` → `schema.d.ts` содержит `/api/operations/statuses/bulk/` (L1053) = **гейт AI-4**.
  2. `test_audit_coverage::test_audit_matrix_covers_every_mutating_route` красный: `ops-status-bulk` — мутирующий роут без строки в `AUDIT_MATRIX`. Сервис 3.8 эмитит аудит (`record_many` STATUS_CREATED + `record` STATUS_BULK_CREATED) → классифицирован `_Audited()` + добавлен HTTP-smoke pin `test_bulk_emits_audit_through_route` (3× STATUS_CREATED + summary с `actor_user_id`, count). Спека этого не предусмотрела — гвард audit-coverage сработал как задумано.
- **Окружение:** порт 5433 занят чужим контейнером (`masterqalakz-db_test-1`, другой проект) → тесты гонялись против изолированного `vaps-db-5434` (postgres:16, те же креды). `make gate` в проде использует 5433 — при коммите освободить порт или пересоздать штатный `vaps-db-1`.
- **Гейт бэк:** ruff чист; `pytest -m "not property and not concurrency and not slow and not golden"` → **2239 passed**, 56 deselected, 58s; `makemigrations --check` «No changes detected» (без модели/миграции). **Гейт фронт:** `npm run gate` зелёный — `schema-check` байт-в-байт, 232 vitest, build, size-gate 150.4КБ/300.

### Completion Notes List

REST bulk-роут статусов (POST `/api/operations/statuses/bulk/`) — тонкая вьюха поверх сервиса 3.8, разблокирует 10.2 по данным (backfill AI-4).

- ✅ **Task 1–3:** сериализаторы (`{business_date, rows[]}`, БЕЗ division_id, cap 1000) + `StatusViewSet(RequirePermissionMixin)` с `@action url_path="bulk"` (резолв scope через `visible_division_ids`, `None`→все дивизионы через `divisions_map().keys()`, вызов сервиса, 201 `{created:N}`) + `router.register("statuses")`.
- ✅ **Task 4:** строка `MATRIX["ops-status-bulk"] = _MethodGate({"post":"status.manage"})`. **seed НЕ тронут** (см. открытый вопрос ниже).
- ✅ **Task 5:** регенерированы обе половины схемы (`schema.yaml` + `schema.d.ts`); гейт AI-4 «schema.d.ts содержит bulk-роут» — выполнен.
- ✅ **Task 6:** 14 API-тестов (AC-1..7,10 + audit-pin). DomainError сервиса сурфейсится §36-envelope'ом (`details.rows[]`) — вьюха не ловит.
- ✅ **Task 7:** гейт обеих сторон зелёный, регресс нулевой (сервис 3.8 не тронут).
- ⚠️ **ОТКЛОНЕНИЕ ОТ СПЕКИ (добавлен файл):** `apps/audit/tests/test_audit_coverage.py` (MOD) не был в File List — гвард audit-coverage потребовал классификации мутирующего роута. Добавлена строка `_Audited()` + pin-тест. Легитимный долг, закрыт честно (не `_DeferredAudit`).
- 🔓 **ОТКРЫТЫЙ ВОПРОС policy (Bratan):** `DIVISION_OPERATOR` сейчас держит только `status.view` → фактический оператор НЕ может вызвать bulk-роут. FR-12 подразумевает, что утреннее обновление делает оператор. Механизм построен (гейт `status.manage`, держат ADMIN+INTEGRATION_USER); **дать ли `status.manage` роли `DIVISION_OPERATOR`** — PROVISIONAL policy-решение (seed помечен «тест проверяет механизм, не политику»). НЕ бэйкнуто в инфра-стори; ждёт решения к 10.2.
- 🔴 **Красная проба (для ревью, AI-1 E10):** ключевые ассерты (scope-403, `details.rows` surfacing, audit-эмиссия) — механическую пробу «мутация→red» применить в ревью-секции (Task 3 цикла).

### File List

- `Backend/VAPS/apps/operations/statuses/api/__init__.py` (NEW) — пакет api.
- `Backend/VAPS/apps/operations/statuses/api/serializers.py` (NEW) — `BulkStatusCreateSerializer`/`BulkStatusCreateRowSerializer` (cap `MAX_BULK_ROWS=1000`).
- `Backend/VAPS/apps/operations/statuses/api/views.py` (NEW) — `StatusViewSet` + `@action bulk`.
- `Backend/VAPS/apps/operations/api/urls.py` (MOD) — `router.register("statuses", …)`.
- `Backend/VAPS/apps/operations/tests/test_rbac_matrix.py` (MOD) — строка `ops-status-bulk`.
- `Backend/VAPS/apps/audit/tests/test_audit_coverage.py` (MOD) — строка `AUDIT_MATRIX["ops-status-bulk"] = _Audited()` (сверх спеки — гвард).
- `Backend/VAPS/apps/operations/statuses/tests/test_bulk_status_api.py` (NEW) — 14 API-тестов (AC + audit-pin).
- `Backend/VAPS/schema.yaml` (REGEN) — bulk-роут в OpenAPI.
- `frontend/src/shared/api/schema.d.ts` (REGEN) — bulk-роут в TS-типах (гейт AI-4).

### Change Log

- 2026-07-15 — story 10.1a реализована (bmad-dev-story, Opus 4.8, TDD): REST bulk-роут статусов поверх сервиса 3.8. Тонкая вьюха (RequirePermissionMixin `status.manage` + резолв scope из RBAC + 201 `{created}`); §36-envelope сурфейсит `details.rows[]`. Регенерированы `schema.yaml` + `schema.d.ts` (гейт AI-4 выполнен). MATRIX + AUDIT_MATRIX строки (audit-гвард поймал пропуск спеки → `_Audited` + pin). 14 API-тестов; бэк-гейт 2239 passed, фронт-гейт зелёный. seed НЕ тронут (грант `DIVISION_OPERATOR` — открытый policy-вопрос Bratan). Status → review. Артефакты НЕ закоммичены агентом.
- 2026-07-15 — cross-model ревью (3 адверсариальных слоя) + красная проба. 3 patch применены (харденинг вакуум-ассертов + AC-2/AC-6 покрытие); 15-й тест добавлен. Бэк-гейт 2240 passed, ruff чист. Status → done.

## Review Findings

### Code-review проход 1 (bmad-code-review, 2026-07-15, Opus 4.8 — same-model caveat; красная проба обязательна по AI-1 ретро E10)

3 адверсариальных слоя (Blind Hunter diff-only / Edge Case Hunter +код / Acceptance Auditor +спека). Scoped diff ~418 строк исходников (+148 генерированной схемы) по 7 файлам. Форма роута сверена с фронт-контрактом 9.7 (`{business_date, rows[]}` без division_id) — совпадает; `statuses/bulk` в обоих схема-артефактах; seed НЕ тронут.

**Acceptance Auditor: ACCEPT** — AC-1..11 удовлетворены. Блокеров нет. Edge Case Hunter: критичных необработанных краёв нет; рассинхрон `set()`-vs-`None` **невозможен** (mixin и `visible_division_ids` читают один `_active_grants`); DRF 3.16.1 реально валидирует `max_length` на ListField → AC-10 не вакуумен.

Триаж: **0 decision · 3 patch · 2 defer · 3 dismiss.**

#### Patch (ПРИМЕНЕНЫ + красная проба 2026-07-15)
- [x] [Review][Patch] **Вакуум `count()==0` в 3 deny-тестах** (Blind Hunter, главная находка): при пустом старте `==0` зелён и когда вьюха молча ничего не делает. Введён `_seed_baseline()` (ненулевой старт) + `count()==before` в `test_bulk_foreign_scope_403`/`test_bulk_without_manage_permission_403`/`test_bulk_anonymous_403`. **Красная проба:** мутация вьюхи `allowed = все дивизионы` (bypass scope) → `test_bulk_foreign_scope_403` покраснел (403→201, count вырос). Совпадает с классом дефектов [[feedback_vaps_vacuous_optional_chain_assert]].
- [x] [Review][Patch] **AC-2 «ничего частично» доказан только для 409** (Acceptance Auditor): добавлен `count()==before` в `test_bulk_hard_conflict_422` и `test_bulk_mixed_aggregate_422`. **Красная проба:** мутация вьюхи (глотание `DomainError` → 201) → оба surfacing-теста покраснели.
- [x] [Review][Patch] **AC-6 identity/source/business_date не заперты тестом** (Acceptance Auditor, мягкий overclaim): добавлен `test_bulk_identity_from_contract_payload_ignored` — rogue payload `source=OM_AUTO`/`actor=attacker` игнорируются (created.source==USER, audit actor_user_id из seam), `business_date` passthrough в audit `new_value`. **Красная проба:** мутация сервиса (drop summary-`record()`) → pin-тест `test_bulk_emits_audit_through_route` покраснел (`AuditLog.DoesNotExist`). Overclaim закрыт: AC-6 теперь запёрт.

**Верификация патчей:** прод-код мутировался только под красную пробу и восстановлен из `cp`-бэкапов (НЕ `git checkout` — урок 9.6 [[feedback_red_probe_backup]]); diff с бэкапом пуст, 0 «PROBE»-остатков. Бэк-гейт **2240 passed** (+1 тест, всего 15 API-тестов), ruff чист. Фронт-гейт зелёный (не затронут). Артефакты НЕ закоммичены агентом.

#### Defer (в deferred-work.md)
- [ ] [Review][Defer] `divisions_map()` не фильтрует `is_active` (Edge #1): для global-scope-актора `None→все дивизионы` включает деактивированные (асимметрия с `active_ids`). Безобидно — расширяет `allowed`, не сужает (ложного 403 нет). Уточнение — при hardening scope-семантики / если появится требование «неактивный дивизион невидим».
- [ ] [Review][Defer] `business_date` невалидируем и не связан со строками (Edge #2): роут принимает любую дату (прошлое/будущее); идёт в `detect_conflicts` как ось PLANNED-классификации. By-design (фронт шлёт «сегодня»), но кривой вход тихо смещает классификацию. Валидация границ — 10.2 (там UI выбора даты) / дата-редактор E10.

#### Dismiss (опровергнуто кодом/агентами — 3)
- Рассинхрон grant-vs-holding → `visible_division_ids` даёт `set()` при пройденном mixin — Edge опроверг: оба читают один `_active_grants`; пусто → mixin тоже 403.
- Off-by-one cap `==1000` — `max_length` инклюзивен (1000 проходит, 1001 отвергнут); позитивный тест на ровно 1000 — nice-to-have, не баг.
- Дубль-employee 400 «из сервиса, не сериализатора» — тест ассертит `status_code==400`, поведение верное; различение источника 400 — косметика.
