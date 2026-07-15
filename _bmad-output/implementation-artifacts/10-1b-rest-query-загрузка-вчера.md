---
baseline_commit: a311f88 (HEAD «chore(bmad): команда „цикл“ + sprint-status: ключ 10.1b»). Стори — бэкфилл AI-4 ретро E10 (§7), ВТОРОЙ сплит (первый — 10.1a bulk-POST, done f086880). GET-загрузка данных «вчера» для префилла грида; блокирует create-story 10.2 по данным.
---

# Story 10.1b: REST query-загрузка «вчера» (префилл грида)

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a **оператор управления**,
I want **HTTP GET-эндпоинт `/api/operations/statuses/grid-prefill/?business_date=YYYY-MM-DD`, который по праву `status.view` отдаёт мне одним ответом список сотрудников моих подразделений на дату (roster) и их живые статусы на эту дату**,
so that **грид 10.2 предзаполняется «вчерашней расстановкой» от РЕАЛЬНОГО контракта в `schema.d.ts` (маппер `buildPrefilledRows` 9.7 получает `EmployeeSeed[]` + материал для `YesterdayPlacement`), а не от выдуманной формы — вторая половина AI-4 (первая, bulk-POST, закрыта 10.1a)**.

## Acceptance Criteria

Источник: ретро E10 [epic-9-retro-2026-07-14.md#L75] (AI-4: «…+ query-загрузка вчера»; порядок 10.1→AI-4→10.2); фронт-контракт [frontend/src/features/daily-grid/prefill.ts:7-17] (`EmployeeSeed {id, fullName, rank?}`, `YesterdayPlacement = Record<employee_id, {statusCode, period?}>`); селекторы-доноры [apps/core/selectors.py:334 `roster_on`], [apps/operations/statuses/selectors.py:20 `overlapping_on`], [apps/core/selectors.py:194 `denorm_for`]; канон scope-видимости L451 [apps/operations/submissions/selectors.py:50-71].

1. **AC-1 (happy path → 200 с формой ответа).** Given держатель `status.view` со scope на управление и business_date=вчера, When GET `/api/operations/statuses/grid-prefill/?business_date=<вчера>`, Then **200**, тело `{"business_date": "<вчера>", "employees": [{"id", "full_name", "rank"}], "statuses": [{"employee_id", "status_type_code", "date_start", "date_end"}]}`. `employees` — roster на дату (только WORKING & active, membership из `EmployeeDivisionHistory` с fallback на текущий дивизион — семантика `roster_on` как есть); `rank` — имя из справочника Rank (fallback на сырой `rank_code` — семантика `denorm_for`); `statuses` — ТОЛЬКО живые (cancelled_at IS NULL) интервалы, содержащие дату (`period__contains` — семантика `overlapping_on`), ТОЛЬКО для сотрудников из roster. Порядок `employees` детерминирован (`full_name`, `id` tie-break).
2. **AC-2 (пустое управление → 200 пустые списки).** Given держатель со scope на дивизион без сотрудников, Then **200** `{"employees": [], "statuses": []}` — НЕ 404/500; сотрудник в roster без статуса на дату просто отсутствует в `statuses` (дефолт `IN_SERVICE` доклеивает фронт — `DEFAULT_STATUS` prefill.ts:32, бэк derived-строк НЕ выдумывает).
3. **AC-3 (чужой scope → сужение, НЕ 403 — канон L451).** Given держатель `status.view` со scope только на дивизион A, а в БД есть сотрудники дивизионов A и B, Then ответ содержит сотрудников A (ненулевой дискриминатор — свои ПРИСУТСТВУЮТ) и НЕ содержит сотрудников B (и их статусов); статус — **200**. Given безскоуповый/wildcard грант (`visible_division_ids` → `None`), Then видны все дивизионы (None-passthrough в `roster_on(division_ids=None)` = вся БД — контракты совпадают, приведение к множеству как в 10.1a НЕ нужно).
4. **AC-4 (без права → 403 ДО селектора).** Given актор БЕЗ `status.view` (напр. роль OMD/APPROVER — держат assignment/report-права, но не status.view), Then **403** `PERMISSION_DENIED` на `RequirePermissionMixin`, селектор НЕ вызывается. Аноним (без `actor_id`) → **403**. Держатели из seed: ADMIN (`*`), DIVISION_OPERATOR, VIEWER → ALLOW.
5. **AC-5 (валидация query → 400).** Given запрос без `business_date` ИЛИ с не-датой (`business_date=abc`), Then **400** `VALIDATION_ERROR` в §36-envelope. Дату бэк НЕ вычисляет сам («вчера» считает фронт) и НЕ ограничивает диапазон (симметрия с решением 10.1a по `business_date`, defer «валидация границ» остаётся за 10.2/дата-редактором).
6. **AC-6 (поверхность методов — пин 5.8c).** POST на `/statuses/grid-prefill/` → **405**. GET на `/statuses/bulk/` → **405** (НЕ 403 и НЕ 200): появление `"get"` в `http_method_names` ViewSet'а активирует ветку `action is None → MethodNotAllowed` mixin'а (`apps/core/api/permissions.py:49-57`, ревью 5.8c) — оба направления запереть тестами.
7. **AC-7 (NFR-4 — константное число запросов).** Число SQL-запросов НЕ растёт с числом сотрудников/статусов: пин `django_assert_num_queries` (roster=2 + denorm=2 + statuses=1 + RBAC-резолв — зафиксировать фактическое число), сид ≥10 сотрудников с статусами. Никаких per-row вызовов (`status_on`/`division_at` в цикле запрещены — докстринги селекторов).
8. **AC-8 (схема регенерирована обе половины — гейт AI-4).** `Backend/VAPS/schema.yaml` перегенерирован (`make schema`) и содержит `GET /api/operations/statuses/grid-prefill/` с query-параметром `business_date` и телом 200; `apps/core/tests/test_schema_drift.py` зелёный. `frontend/src/shared/api/schema.d.ts` перегенерирован (`npm run generate:api`) и содержит grid-prefill-роут; `frontend/scripts/schema-check.mjs` зелёный.
9. **AC-9 (RBAC-матрица покрывает роут).** Строка `"ops-status-grid-prefill": _MethodGate({"get": "status.view"})` в `MATRIX` (`test_rbac_matrix.py`); `test_matrix_covers_every_registered_route` и `test_method_gates_cover_exactly_served_methods` зелёные (`ops-status-bulk` остаётся `{"post"}` — у @action-паттерна `callback.actions` per-роут, "get" в `http_method_names` served-методы bulk НЕ расширяет). Ожидания ALLOW/DENY выводятся из seed (`_holders`). **seed НЕ меняется.** **`AUDIT_MATRIX` НЕ трогать:** роут GET-only, `_served_mutating` его не видит; добавление строки уронит stale-ассерт (`test_audit_coverage.py:293-305`).
10. **AC-10 (регресс нулевой + гейт обеих сторон).** 10.1a-роут (15 тестов `test_bulk_status_api.py`), селекторы-доноры, весь бэкенд — зелёные без правок логики. `make gate` (из `Backend/VAPS`) зелёный; `makemigrations --check` «No changes detected» (стори без модели/миграции). Фронт `npm run gate` зелёный (schema.d.ts обновлён, типов руками не добавлено).

## Tasks / Subtasks

- [x] **Task 1 — Query-сериализатор + response-сериализаторы** (`apps/operations/statuses/api/serializers.py`, MOD) (AC: 1,5,8)
  - [x] `GridPrefillQuerySerializer(serializers.Serializer)`: `business_date=DateField()` (required by default → отсутствие/мусор = DRF 400).
  - [x] Response-сериализаторы для spectacular (read-only, только схема): `GridPrefillEmployeeSerializer` (`id=UUIDField`, `full_name=CharField`, `rank=CharField(allow_null=True)`), `GridPrefillStatusSerializer` (`employee_id=UUIDField`, `status_type_code=CharField`, `date_start=DateField`, `date_end=DateField`), `GridPrefillResponseSerializer` (`business_date=DateField`, `employees=…(many=True)`, `statuses=…(many=True)`). Без выдуманных полей: ровно то, что кладут селекторы и ест prefill.ts.
- [x] **Task 2 — Селектор query-загрузки** (`apps/operations/statuses/selectors.py`, MOD) (AC: 1,2,3,7)
  - [x] Функция/classmethod `grid_prefill(actor, business_date) -> dict` — actor-first, **сужает видимость сам** (канон L451, зеркало `DailySubmissionSelector.list`, submissions/selectors.py:50-71):
    1. `visible = PermissionService.visible_division_ids(actor, "status.view")` (прецедент импорта PermissionService в селектор — submissions/selectors.py:63).
    2. `roster = HistoricalEmployeeSelector.roster_on(business_date, division_ids=visible)` — `None` проходит как есть («вся БД», docstring roster_on; ARCH-003 — core только через селектор).
    3. `employee_ids` = плоское объединение значений roster; `denorm = CoreEmployeeSelector.denorm_for(employee_ids)` → `employees=[{id, full_name, rank}]`, сортировка `(full_name, str(id))`.
    4. `statuses = EmployeeStatusSelector.overlapping_on(business_date, employee_ids=employee_ids)` — уже ровно 4 нужных поля.
    5. Вернуть `{"employees": …, "statuses": …}`. Пустой roster → пустые списки (denorm_for/overlapping_on на пустом списке — 0 лишних строк; НЕ звать overlapping_on с `employee_ids=None` — это «все сотрудники БД», утечка scope).
- [x] **Task 3 — GET-action на StatusViewSet** (`apps/operations/statuses/api/views.py`, MOD) (AC: 1,4,5,6)
  - [x] `http_method_names = ["get", "post", "options"]` (было post/options); `permission_map = {"bulk": "status.manage", "grid_prefill": "status.view"}`.
  - [x] `@action(detail=False, methods=["get"], url_path="grid-prefill", url_name="grid-prefill") def grid_prefill(self, request)`: `q = GridPrefillQuerySerializer(data=request.query_params); q.is_valid(raise_exception=True)`; `data = grid_prefill(actor=request.actor_id, business_date=q.validated_data["business_date"])`; `return Response({"business_date": …, **data}, status=200)`. Тонкая вьюха: НЕ фильтрует по правам вручную (сужает селектор), ничего не ловит.
  - [x] `@extend_schema(parameters=[GridPrefillQuerySerializer], responses={200: GridPrefillResponseSerializer}, description="…roster+статусы на дату; scope сужает видимость (чужие дивизионы отсутствуют); 403 без status.view; 400 битый business_date…")` — иначе spectacular эмитит пустоту, фронту нечего кодогенить (ARCH-FE-011, прецедент 8.6/10.1a).
  - [x] `apps/operations/api/urls.py` НЕ трогать — `router.register("statuses", StatusViewSet)` уже покрывает новый @action (reverse `ops-status-grid-prefill`).
- [x] **Task 4 — RBAC-матрица** (`apps/operations/tests/test_rbac_matrix.py`, MOD) (AC: 4,9)
  - [x] Строка `"ops-status-grid-prefill": _MethodGate({"get": "status.view"})` с комментарием: гейт = читающее право статусов (держат DIVISION_OPERATOR, VIEWER, ADMIN); scope — сужение селектором (канон L451), матрицей не проверяется.
  - [x] **seed НЕ трогать; AUDIT_MATRIX НЕ трогать** (GET-only → добавление строки = красный stale-ассерт).
- [x] **Task 5 — Регенерация схемы (обе половины)** (AC: 8)
  - [x] Бэк: `make schema` (из `Backend/VAPS`) → `schema.yaml` содержит `GET /api/operations/statuses/grid-prefill/`; `test_schema_drift.py` зелёный.
  - [x] Фронт: `cd frontend && npm run generate:api` → `schema.d.ts` содержит grid-prefill; `node scripts/schema-check.mjs` зелёный.
- [x] **Task 6 — API-тесты** (`apps/operations/statuses/tests/test_grid_prefill_api.py`, NEW) (AC: 1–7)
  - [x] Реюз паттерна env 10.1a (`test_bulk_status_api.py`): посев `seed_operations` + `UserRole` (актор-держатель — роль с `status.view`, напр. `DIVISION_OPERATOR` со `scope_division_id`; глобальный — unscoped `VIEWER`/ADMIN); клиент `APIClient().credentials(HTTP_X_USER_ID=…)`.
  - [x] AC-1: 200, форма ответа, статус только живой и содержащий дату (сид: cancelled-строка и вне-даты строка НЕ в ответе), rank из справочника. AC-2: пустой дивизион → 200 `[]`/`[]`; сотрудник без статуса отсутствует в `statuses`. AC-3: scoped-оператор — свой сотрудник ПРИСУТСТВУЕТ + чужой ОТСУТСТВУЕТ (оба ассерта, ненулевой дискриминатор — урок вакуума 10.1a); unscoped → оба видны. AC-4: OMD-актор → 403; аноним → 403. AC-5: без business_date → 400; `business_date=abc` → 400. AC-6: POST grid-prefill → 405; GET bulk → 405. AC-7: `django_assert_num_queries` на сиде ≥10 сотрудников.
- [x] **Task 7 — Гейт обеих сторон** (AC: 8,10)
  - [x] `make gate` (из `Backend/VAPS`; Postgres — см. окружение в Previous Story Intelligence): pytest-подсет + ruff + `makemigrations --check`. Матрица + schema-drift + audit-coverage + 15 тестов 10.1a + новые тесты зелёные.
  - [x] `cd frontend && npm run gate`: schema-check + tsc + eslint + vitest + build + size-gate зелёные.

## Dev Notes

### Решения (ПРИНЯТО = A по рекомендации; менять осознанно)

> **№1 = A (ОДИН GET-роут отдаёт и roster, и статусы одним ответом).** Ответственность одна — «query-загрузка данных дня для префилла»; два эндпоинта (roster отдельно, статусы отдельно) = два roundtrip'а, два гейта, две строки матрицы ради одного консьюмера (10.2), и фронт всё равно склеивает. Правило размера соблюдено: один роут.
> **№2 = A (право = `status.view`).** Читающее право статусов, уже в seed; держат **DIVISION_OPERATOR**, VIEWER, ADMIN (`*`). Продукт: грид — рабочее место оператора; префилл-чтение гейтим правом, которым оператор РЕАЛЬНО владеет — иначе родился бы второй policy-вопрос «оператор не может открыть свой грид» (клон открытого вопроса 10.1a про `status.manage`). Альтернатива `daily_report.mark_update` (прецедент «GET = mark_update ПО РЕШЕНИЮ», test_rbac_matrix.py:137-139) отвергнута: тот прецедент — про submissions без собственного read-права; у статусов read-право ЕСТЬ, вязать чтение статусов к отметочному праву отчёта — семантический дрейф. Побочно VIEWER видит префилл — консистентно с его ролью наблюдателя (читает статусы по определению права).
> **№3 = A (scope — сужение селектором, канон L451; НЕ 403).** GET-список НЕ ошибается на scope: `visible_division_ids(actor, "status.view")` → в `roster_on(division_ids=…)`; чужие дивизионы просто отсутствуют (зеркало `DailySubmissionSelector.list`). `None` (глобальный/wildcard) проходит в `roster_on` как есть — его контракт «None = вся БД» совпадает; приведение None→множество из 10.1a здесь НЕ нужно (там сервис 3.8 ждал множество). Статусы тянуть ТОЛЬКО по `employee_ids` из roster — `overlapping_on(date, None)` отдал бы всю БД мимо scope.
> **№4 = A (ответ = сырые факты, derived-логики нет).** `employees` = roster+denorm (`{id, full_name, rank}` — ровно `EmployeeSeed`), `statuses` = `overlapping_on` как есть (`{employee_id, status_type_code, date_start, date_end}`). НЕ звать `resolve_status`/не выдумывать derived `IN_SERVICE`-строки: отсутствие записи = дефолт на фронте (prefill.ts `DEFAULT_STATUS`, Д1 9.7). Несколько пересекающихся статусов одного сотрудника → несколько строк `statuses`; редукция в `Record<employee_id,…>` (`YesterdayPlacement`) — маппер фронта 10.2 (там же `period` = `date_end` минус день, полуинтервал). Плоский `statuses[]`-список, НЕ Record — OpenAPI-типизация Record с UUID-ключами кодогенится в `{[key: string]: …}` без гарантий, список честнее.
> **№5 = A (GET — новый @action на СУЩЕСТВУЮЩЕМ StatusViewSet).** Не плодить второй ViewSet/регистрацию. Появление `"get"` в `http_method_names` безопасно для bulk-роута: mixin (ревью 5.8c) при `action is None` бросает 405 — GET `/statuses/bulk/` останется 405, не 403/200. Это ИМЕННО тот случай, ради которого ветка писалась (permissions.py:49-57) — запереть пин-тестом (AC-6).
> **№6 = A (`business_date` — обязательный query-параметр, «вчера» считает фронт).** Бэк не вычисляет дату от Clock: роут переиспользуем для любой даты (ретро-просмотр), а «вчера» — знание консьюмера (грид). Симметрия с 10.1a (`business_date` из payload). Валидация диапазона дат — не здесь (defer 10.1a Edge #2 остаётся за 10.2/дата-редактором).

### Архитектурные правила (developer guardrails)

- **Вьюха тонкая, селектор actor-first.** Никакой фильтрации по правам в вьюхе (канон L451 — «LIST-селектор сужает видимость сам»); никаких try/except — единственная ошибка тут DRF 400 от query-сериализатора, она течёт в §36-envelope через `domain_exception_handler`.
- **ARCH-003:** operations читает core ТОЛЬКО через селекторы (`HistoricalEmployeeSelector.roster_on`, `CoreEmployeeSelector.denorm_for`) — не `Employee.objects` напрямую.
- **`RequirePermissionMixin` уже первый в MRO** (views.py:28) — не менять порядок; только расширить `permission_map` и `http_method_names`. Action вне map → fail-closed 403; completeness-тест матрицы ловит gap.
- **AUDIT_MATRIX — НЕ трогать.** GET-only роут не мутирует; `_served_mutating` (test_audit_coverage.py:269-290) пересекает actions с `_WRITE_METHODS` — grid-prefill туда не попадает, а лишняя строка = красный stale-ассерт.
- **NFR-4:** все три селектора уже bulk (roster=2 запроса, denorm=2, statuses=1); НЕ добавлять per-row обращений (`status_on`/`division_at` в цикле — анти-паттерн донора, докстринги selectors.py:63-71/296).
- **Регенерация схемы — ОБЯЗАТЕЛЬНА и двусторонняя** (`make schema` + `npm run generate:api`), оба артефакта в File List; иначе drift-гейты красные.
- **Детерминированный порядок `employees`** — иначе флейк-тесты и скачущий грид (сортировка `(full_name, str(id))` в селекторе, не в вьюхе).

### Project Structure Notes

- **MOD** `apps/operations/statuses/api/serializers.py` — query + response-сериализаторы.
- **MOD** `apps/operations/statuses/api/views.py` — `"get"` в http_method_names, permission_map, @action grid_prefill.
- **MOD** `apps/operations/statuses/selectors.py` — `grid_prefill(actor, business_date)`.
- **MOD** `apps/operations/tests/test_rbac_matrix.py` — строка MATRIX (seed и AUDIT_MATRIX НЕ трогаем).
- **REGEN** `Backend/VAPS/schema.yaml`, `frontend/src/shared/api/schema.d.ts`.
- **NEW** `apps/operations/statuses/tests/test_grid_prefill_api.py`.
- Файлов ~7 — как в 10.1a: неделимый минимум для ОДНОГО гейтимого REST-роута (роут без матрицы/схемы не проходит гейт). `urls.py` в этот раз НЕ трогается.

### Previous Story Intelligence (из 10.1a, done + Review Findings)

- **Вакуум-паттерн — главный урок ревью 10.1a:** ассерт «чужого нет в ответе» зелёный и на пустом ответе. КАЖДЫЙ negative-ассерт спарить с ненулевым позитивным дискриминатором (свой сотрудник ПРИСУТСТВУЕТ + чужой ОТСУТСТВУЕТ в одном тесте); класс дефектов [[feedback_vaps_vacuous_optional_chain_assert]].
- **Красная проба ОБЯЗАТЕЛЬНА** (AI-1 ретро E10, same-model caveat) на ключевых ассертах: мутация селектора «игнорировать scope» → scope-тест обязан покраснеть; мутация «не фильтровать cancelled» → AC-1-тест красный. Прод-код под пробу бэкапить `cp`, восстанавливать из бэкапа — **НЕ `git checkout`** (стирает незакоммиченные ревью-правки, инцидент 9.6 [[feedback_red_probe_backup]]); после — diff с бэкапом пуст, 0 «PROBE»-остатков.
- **Окружение 10.1a:** порт 5433 был занят чужим контейнером (`masterqalakz-db_test-1`, другой проект) → тесты гонялись против изолированного контейнера `vaps-db-5434` (postgres:16, порт **5434**, креды vaps/vaps, `VAPS_DB_PORT=5434`). Проверить занятость 5433 ДО гейта; при коммите/штатном прогоне освободить порт или использовать 5434-контейнер.
- **10.1a построила всё, на что 10.1b садится:** пакет `statuses/api/` (serializers/views), регистрация `router.register("statuses")`, строка MATRIX `ops-status-bulk`, паттерн тестов `test_bulk_status_api.py` (посев ролей через `UserRole`, `HTTP_X_USER_ID`). Копировать структуру, не логику.
- **Открытый policy-вопрос 10.1a НЕ трогать:** `DIVISION_OPERATOR` без `status.manage` (bulk-POST ему недоступен) — ждёт решения Bratan к 10.2. 10.1b спроектирована так, чтобы НЕ породить клон вопроса: право чтения `status.view` оператор уже держит (Решение №2).
- **Спектакулярный прецедент:** без `@extend_schema` plain-ViewSet эмитит «No response body» — фронт-кодоген слепнет (урок 8.6, повторён в 10.1a).

### Git Intelligence

- Baseline `a311f88` (10.1a done + sprint-status ключи). Рабочее дерево чистое.
- Коммит (за Bratan/оркестратора, после ревью): `feat(story-10.1b): REST query-загрузка «вчера» — backfill AI-4 (grid-prefill GET + regen схемы)`. dev-story = RED→GREEN + `make gate` (бэк) + `npm run gate` (фронт). **Артефакты (включая `schema.yaml`/`schema.d.ts`) коммитит оркестратор, НЕ dev-агент.**
- Same-model caveat: если ревью той же моделью — красная проба обязательна на scope-сужении, cancelled-фильтре и 405-пинах.

### References

- [Source: _bmad-output/implementation-artifacts/epic-9-retro-2026-07-14.md#L75, #L80-88] — AI-4 (query-загрузка «вчера» — вторая половина; порядок 10.1→AI-4→10.2).
- [Source: _bmad-output/implementation-artifacts/10-1a-rest-bulk-роут-статусов.md] — канон формата/паттернов REST-слоя; Review Findings (вакуум, красная проба, окружение 5434).
- [Source: Backend/VAPS/apps/operations/statuses/api/views.py:28-33] — `StatusViewSet` (`http_method_names=["post","options"]`, `permission_map={"bulk":"status.manage"}`) — точка расширения.
- [Source: Backend/VAPS/apps/core/selectors.py:334-382] — `HistoricalEmployeeSelector.roster_on(business_date, division_ids=None)` → `{division_id: [employee_id]}`; None = вся БД; 2 bulk-запроса; WORKING & active; history-fallback BR-CORE-HISTORY-003.
- [Source: Backend/VAPS/apps/core/selectors.py:193-218] — `CoreEmployeeSelector.denorm_for(employee_ids)` → `{id: {full_name, rank}}` (rank из справочника, fallback код; 2 bulk-запроса; ARCH-003-канал).
- [Source: Backend/VAPS/apps/operations/statuses/selectors.py:19-34] — `EmployeeStatusSelector.overlapping_on(on_date, employee_ids)` → `[{employee_id, status_type_code, date_start, date_end}]`; живые + `period__contains`; 1 GiST-запрос.
- [Source: Backend/VAPS/apps/operations/submissions/selectors.py:50-71] — канон L451: actor-first LIST-селектор сужает видимость сам (`visible_division_ids`, None=global); прецедент импорта PermissionService в селектор.
- [Source: Backend/VAPS/apps/operations/services.py:70-106] — `PermissionService.visible_division_ids(user, code)` → множество или None.
- [Source: Backend/VAPS/apps/core/api/permissions.py:40-61] — mixin: `action is None → MethodNotAllowed` (ревью 5.8c) — держит 405 GET /bulk/ при «get» в http_method_names.
- [Source: Backend/VAPS/apps/operations/management/commands/seed_operations.py:50-81] — `ROLE_PERMISSIONS`: `status.view` держат DIVISION_OPERATOR, VIEWER (+ADMIN `*`); `daily_report.mark_update` — только DIVISION_OPERATOR.
- [Source: Backend/VAPS/apps/operations/tests/test_rbac_matrix.py:122-164, 285-316] — MATRIX (живой реестр; прецедент «GET = mark_update ПО РЕШЕНИЮ» L137-139 — тут НЕ применён, см. Решение №2) + completeness/per-метод тесты.
- [Source: Backend/VAPS/apps/audit/tests/test_audit_coverage.py:269-305] — `_served_mutating` ∩ `_WRITE_METHODS` → GET-only роут в AUDIT_MATRIX НЕ вносить (stale-ассерт).
- [Source: Backend/VAPS/apps/core/tests/test_schema_drift.py] — drift-гейт бэка; регенерация `make schema`.
- [Source: frontend/src/features/daily-grid/prefill.ts:7-32, 45-77] — потребитель: `EmployeeSeed {id, fullName, rank?}`, `YesterdayPlacement`, `DEFAULT_STATUS='IN_SERVICE'` (дефолт доклеивает фронт), `buildPrefilledRows`.
- [Source: frontend/package.json] — `generate:api`, `gate`.

## Dev Agent Record

### Agent Model Used

Fable 5 (субагент цикла)

### Debug Log References

- **RED:** `NoReverseMatch: Reverse for 'ops-status-grid-prefill' not found` — роута нет, весь новый тест-файл падает на импорте (содержательная причина: эндпоинт не существует). Зафиксировано до реализации.
- **GREEN (бэк):** полный подсет `pytest -m "not property and not concurrency and not slow and not golden"` → **2261 passed, 56 deselected** (в т.ч. 12 новых grid-prefill, 15 тестов 10.1a, RBAC-матрица, schema-drift, audit-coverage). `ruff check .` — All checks passed. `makemigrations --check --dry-run` — No changes detected.
- **GREEN (фронт):** `npm run gate` → exit 0 (schema-check + tsc + eslint + vitest **232 passed (24 файла)** + build + size-gate 150.4/300 KB gzip).
- **Красные пробы (бэкап `cp`, восстановление из бэкапа, diff пуст, 0 PROBE-остатков):** (1) селектор игнорирует scope (`visible=None`) → `test_prefill_scoped_sees_own_not_foreign` FAILED; (2) снят cancelled-фильтр статусов → `test_prefill_happy_shape_live_statuses_rank_and_order` FAILED; (3) GET открыт на bulk-@action → `test_get_bulk_405_not_403_not_200` FAILED.
- **NFR-4 пин:** 12 SQL-запросов (auth-seam=3 + RBAC-резолв селектора=4 + roster_on=2 + denorm_for=2 + overlapping_on=1) на сиде 12 сотрудников со статусами; состав зафиксирован прогоном.

### Completion Notes List

- Все Tasks/Subtasks выполнены по спеке; все принятые Решения №1–№6 соблюдены (один GET-роут, право `status.view` через константу `GRID_PREFILL_PERMISSION` — единый источник для гейта и селектора, зеркало `READ_PERMISSION` submissions; scope — сужение селектором, канон L451; сырые факты без derived-строк; @action на существующем StatusViewSet; `business_date` — обязательный query-параметр).
- Селектор — classmethod `EmployeeStatusSelector.grid_prefill(actor, business_date)` (спека допускала «функция/classmethod»); `overlapping_on` зовётся строго по `employee_ids` из roster (пустой список, НЕ None).
- **Отклонение окружения (Task 7, не кода):** буквальный `make gate` не запускался — рецепт хардкодит `VAPS_DB_PORT=5433` + `docker compose up db`, а порт 5433 занят чужим контейнером `masterqalakz-db_test-1` (задокументировано в Previous Story Intelligence, прецедент 10.1a). Композиция гейта (ruff + тот же pytest-подсет + `makemigrations --check`) прогнана зелёной против изолированного контейнера `vaps-db-5434` (`VAPS_DB_PORT=5434`). При штатном прогоне оркестратором — освободить 5433 или использовать 5434.
- Spectacular warnings/errors при `make schema` — pre-existing (diff schema.yaml = только +86 строк grid-prefill/компонентов, ничего не удалено); `test_schema_drift` зелёный.
- `seed_operations.py`, `AUDIT_MATRIX`, `bulk_status_service` (сервис 3.8), `urls.py` — НЕ тронуты (по спеке).
- Открытый policy-вопрос 10.1a (DIVISION_OPERATOR без `status.manage`) не затронут: чтение гейтится `status.view`, которое оператор держит.

### File List

- `Backend/VAPS/apps/operations/statuses/api/serializers.py` (MOD — GridPrefillQuery/Employee/Status/Response-сериализаторы)
- `Backend/VAPS/apps/operations/statuses/api/views.py` (MOD — «get» в http_method_names, permission_map, @action grid_prefill + extend_schema)
- `Backend/VAPS/apps/operations/statuses/selectors.py` (MOD — GRID_PREFILL_PERMISSION + EmployeeStatusSelector.grid_prefill)
- `Backend/VAPS/apps/operations/tests/test_rbac_matrix.py` (MOD — строка MATRIX ops-status-grid-prefill)
- `Backend/VAPS/apps/operations/statuses/tests/test_grid_prefill_api.py` (NEW — 12 API-тестов AC-1…AC-7)
- `Backend/VAPS/schema.yaml` (REGEN — make schema)
- `frontend/src/shared/api/schema.d.ts` (REGEN — npm run generate:api)
- `_bmad-output/implementation-artifacts/sprint-status.yaml` (MOD — ключ стори)
- `_bmad-output/implementation-artifacts/10-1b-rest-query-загрузка-вчера.md` (MOD — этот файл)

### Change Log

- 2026-07-15: Story 10.1b реализована TDD-циклом (RED NoReverseMatch → GREEN): GET `/api/operations/statuses/grid-prefill/?business_date=…` на StatusViewSet (право `status.view`, scope сужает селектор — канон L451), сериализаторы схемы, селектор `grid_prefill`, строка RBAC-матрицы, регенерация schema.yaml + schema.d.ts, 12 API-тестов + 3 красные пробы. Гейты: бэк 2261 passed / ruff чист / migrations чисты; фронт gate exit 0 (232 теста). Status → review.
- 2026-07-15: Ревью-правки (проход 1, см. Review Findings): P1 харденинг вакуумного теста пустого управления (дискриминатор утечки «пустой roster → вся БД»), P2 детерминированный порядок `statuses` в селекторе + порядок-тест (секондмент-пара), P3 пин полуинтервала `[)` на эндпоинте, P4 пин rank-fallback `"" `, P5 докстринг-честность roster-семантики. 2 красные пробы (P1/P2) red→restored, diff с бэкапами пуст. Гейт: бэк **2263 passed** (14 тестов grid-prefill, +2 новых) / ruff чист. Фронт не тронут. Status → done.

## Review Findings

### Code-review проход 1 (bmad-code-review, 2026-07-15, Fable 5 — cross-model к dev Fable-субагенту; same-model caveat → механические красные пробы обязательны по AI-1 ретро E10)

3 адверсариальных слоя (Blind Hunter diff-only / Edge Case Hunter +код / Acceptance Auditor +спека). Контракты сверены с raise-сайтами и фактической семантикой селекторов-доноров (`roster_on`, `denorm_for`, `overlapping_on`), не со словарём — урок 10.1 [[feedback_vaps_verify_against_raise_sites]].

**Acceptance Auditor: ACCEPT** — AC-1..10 удовлетворены; числа гейта воспроизведены независимо (2261→2263 passed на подсете `not property/concurrency/slow/golden` против vaps-db-5434; ruff чист). Блокеров нет.

Триаж: **0 decision · 5 patch · 4 defer · 4 dismiss.**

#### Patch (ПРИМЕНЕНЫ + красные пробы 2026-07-15)
- [x] [Review][Patch] **P1 — вакуум теста пустого управления** (Blind Hunter): `test_prefill_empty_division_200_empty_lists` был зелёным на пустой БД — `statuses == []` ничего не дискриминировал. Посеян чужой сотрудник с живым статусом в ДРУГОМ дивизионе → ассерты теперь ловят утечку «пустой roster → вся БД». **Красная проба:** мутация `overlapping_on` `is not None`→truthy (`if employee_ids:`) → тест red. Класс дефектов [[feedback_vaps_vacuous_optional_chain_assert]].
- [x] [Review][Patch] **P2 — недетерминированный порядок `statuses`** (Edge Case Hunter): при 2+ живых статусах одного сотрудника (легальная секондмент-пара DETACHED+ATTACHED, COMPATIBLE_PAIRS 3.10) БД без ORDER BY отдаёт случайный порядок — маппер 10.2 получал бы случайного «победителя». Сортировка в селекторе `(employee_id, status_type_code, date_start)` + докстринг + тест точного порядка (вставка в обратном сортировке порядке — natural pk-порядок ≠ отсортированному). **Красная проба:** снята сортировка из `grid_prefill` → порядок-тест red.
- [x] [Review][Patch] **P3 — полуинтервал не запёрт на эндпоинте** (Acceptance Auditor): код корректен (`period` = daterange `'[)'`), но контракт границ не был пином. Тест: `[06-01, 06-05)` при `business_date=06-05` НЕ в ответе (date_end исключителен); `[06-05, 06-06)` — В ответе (date_start включителен).
- [x] [Review][Patch] **P4 — rank-fallback не задокументирован тестом** (Edge Case Hunter): `rank_code=""` → `rank == ""` (НЕ null) — фактическая семантика `denorm_for` (`rank_names.get("", "")`). Ассерт добавлен в happy-тест; контракт для маппера 10.2 (трактовать `""` как отсутствие).
- [x] [Review][Patch] **P5 — докстринг-overclaim roster** (Acceptance Auditor): шапка тест-файла заявляла «roster (WORKING & active на дату)» — по дате версионируется ТОЛЬКО принадлежность к дивизиону (семантика `roster_on` E1); найм/увольнение не версионированы. Смягчено до фактической семантики, код не менялся.

**Верификация патчей:** прод-код мутировался только под красные пробы и восстановлен из `cp`-бэкапов (НЕ `git checkout` — урок 9.6 [[feedback_red_probe_backup]]); diff с бэкапом пуст, 0 «PROBE»-остатков. Бэк-гейт **2263 passed** (+2 теста, всего 14 grid-prefill), ruff чист. Фронт не тронут (`npm run gate` не требуется). Артефакты НЕ закоммичены агентом.

#### Defer (в deferred-work.md)
- [ ] [Review][Defer] Roster не версионирован по найму/увольнению — pre-existing E1-семантика `roster_on` (`apps/core/selectors.py:334-382`), впервые видимая на экране; ретро-дата покажет сегодняшний штат в вчерашних дивизионах. → E7 (backfill history) / refinement.
- [ ] [Review][Defer] Global-грант (`visible=None`) → неограниченный `__in` по всему штату — O(N) размер запроса; NFR-4-пин покрывает только scoped-путь. → hardening при живых объёмах.
- [ ] [Review][Defer] Контракт `rank`: «"" vs null vs undefined» — фактически всегда строка, пустая при отсутствии кода (P4 запёр); выравнивание типов → маппер 10.2.
- [ ] [Review][Defer] Правило «победителя» при 2+ живых статусах одного сотрудника — данные после P2 детерминированы, но выбор победителя не специфицирован. → маппер 10.2.

#### Dismiss (опровергнуто кодом/агентами — 4)
- Утечка «пустой roster → вся БД» — опровергнуто: `overlapping_on` использует `is not None` (`selectors.py:37`), `__in=[]` даёт пустой результат (P1-тест теперь запирает).
- Статусы-сироты при дыре denorm — опровергнуто: `denorm_for` фильтрует только `id__in` по той же таблице Employee; ids из roster всегда покрыты.
- `date_end` NULL в ответе против non-nullable схемы — опровергнуто моделью: GeneratedField `period = daterange(date_start, date_end, '[)')` требует NOT NULL оба поля.
- HEAD→405 — канон проекта (deliberate, зеркало submissions 5.8).
