---
baseline_commit: 73ea5ac («chore(sprint-status): вынести заблокированный E7 из головы очереди»). Стори — вторая половина бэкфилла AI-4 (ретро E9 §7), первый из двух GET-роутов. Исходный ключ `10-1b-get-статусов-на-дату-и-справочник` РАЗДЕЛЁН гейтом декомпозиции 2026-07-27: справочник статус-типов уехал в 10.1d, фронт-потребители — в 10.1e/10.1f. Здесь ТОЛЬКО GET списка статусов, ТОЛЬКО бэк.
---

# Story 10.1b: GET списка статусов на дату

Status: ready-for-dev

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a **оператор управления**,
I want **HTTP GET-эндпоинт `/api/operations/statuses/?business_date=&division_id=`, который отдаёт живые статусные записи подразделения на дату, гейтится правом `status.view` и сам проверяет мой scope по RBAC**,
so that **префилл «вчера» на экране массового обновления перестал быть заглушкой: сегодня `yesterday` пуст, все строки садятся в `DEFAULT_STATUS = IN_SERVICE` ([DailyUpdatePage.tsx:9-11](../../frontend/src/features/daily-grid/DailyUpdatePage.tsx)) — оператор видит «В строю» там, где вчера был отпуск, и правит вручную то, что должно было предзаполниться**.

### Goal

Один read-роут: «дай статусы подразделения X на дату D». Ничего больше.

### Scope

- `GET /api/operations/statuses/` с обязательными `business_date` и `division_id`.
- Гейт права + проверка scope + 404 на фантомный дивизион.
- Селектор-композиция: ростер на дату (core) ⋈ живые интервалы (statuses).
- Регенерация обеих схем (`schema.yaml`, `schema.d.ts`) + строка RBAC-матрицы.

### Out of Scope

- **Справочник статус-типов** — стори 10.1d. Здесь не трогаем ни `StatusType`-сериализатор, ни `statusTypes.ts`.
- **Фронт-потребитель** — стори 10.1e. `DailyUpdatePage.tsx`, `prefill.ts`, `DailyGridContainer.tsx` в этой стори НЕ меняются; `schema.d.ts` перегенерируется, но ни один компонент новый тип не импортирует.
- **Материализация derived-статусов.** Роут отдаёт ТОЛЬКО реальные записи `EmployeeStatus`. Сотрудник без записи в ответе отсутствует — потребитель уже сам садит его в `DEFAULT_STATUS` ([prefill.ts:31](../../frontend/src/features/daily-grid/prefill.ts)). Досыпать в ответ синтетические «В строю» — значит продублировать `resolve_status` в транспортном слое.
- **Выбор даты.** Роут принимает дату как параметр и не знает про Clock. Какую дату спросить (⚠️ НЕ календарное «вчера» — [daySubmission.ts:145](../../frontend/src/features/daily-grid/daySubmission.ts)) — решает 10.1e.
- **Отменённые записи** (`cancelled_at IS NOT NULL`) — «записи нет» по канону 1.5/3.6.
- **Пагинация** — см. Решение №2.

## Acceptance Criteria

Источник: ретро E9 [epic-9-retro-2026-07-14.md#L75] (AI-4: «…+ query-загрузка "вчера"» — вторая половина, первая закрыта 10.1a); заглушка-потребитель [DailyUpdatePage.tsx:9-11]; форма ответа выведена из [prefill.ts:13-29] (`YesterdayPlacement = employee_id → {statusCode, period?}`); прецедент вьюхи/скоупа/схемы — [10-1a-rest-bulk-роут-статусов.md].

1. **AC-1 (happy path → 200, детерминированный порядок).** Given держатель `status.view` со scope на дивизион, у двух сотрудников дивизиона есть живые статусы, покрывающие `business_date`, When `GET /api/operations/statuses/?business_date=2026-07-26&division_id=<div>`, Then **200**, тело `{"business_date":"2026-07-26","division_id":"<div>","rows":[{employee_id,status_type_code,date_start,date_end}×2]}`. `business_date`/`division_id` эхо-полями — ответ, приехавший после смены даты на экране, распознаётся как чужой (защита от гонки; поля дешёвые). **Порядок строк детерминирован** — `(employee_id, date_start)`; ассертить сравнением со СПИСКОМ целиком (два сотрудника × два статуса), не `assert len(...)`: без явного `order_by` порядок из БД не гарантирован, и тест стал бы флейком, а не гардом.
2. **AC-2 (границы интервала — полуоткрытый `[date_start, date_end)`).** Given статус `[2026-07-20, 2026-07-26)`, Then он **есть** в ответе на `business_date=2026-07-25` и **отсутствует** на `2026-07-26`. Given статус `[2026-07-26, 2026-07-27)`, Then он есть на `2026-07-26`. (Ровно семантика `period__contains` — то же, чем считается расход; расхождение здесь развело бы префилл и отчёт. ⚠️ Открытых справа интервалов не бывает: `date_end` NOT NULL + `CheckConstraint(date_start__lt=date_end)`, [employee_status.py:86,152-155](../../Backend/VAPS/apps/operations/statuses/models/employee_status.py) — `date_end=None` в фикстуре даст IntegrityError, а не «бессрочный статус».)
3. **AC-3 (отменённые и чужие не видны).** Given у сотрудника дивизиона статус с `cancelled_at IS NOT NULL`, покрывающий дату, Then его в `rows` **нет**. Given живой статус сотрудника ДРУГОГО дивизиона, Then его в `rows` **нет** (даже если актор видит оба дивизиона — фильтр по запрошенному `division_id`, не по всему scope).
4. **AC-4 (ростер на дату, не сегодняшняя приписка).** Состав дивизиона резолвится `HistoricalEmployeeSelector.roster_on(business_date, {division_id})` — только `WORKING` и `is_active` сотрудники. Given уволенный сотрудник с живым статусом на дату, Then его в `rows` нет. ⚠️ Пока `EmployeeDivisionHistory` пуст (донор-импорт не пишет истории, бэкфилл — E7), срабатывает фолбэк BR-CORE-HISTORY-003 «текущий дивизион»: это ожидаемое поведение, не дефект.
5. **AC-5 (грубый гейт права → 403).** Given актор без `status.view` (напр. держит только `status.manage`), Then **403** `PERMISSION_DENIED` на `RequirePermissionMixin` — селектор НЕ вызывается. Аноним (без `actor_id`) → **403**. `*`-wildcard (ADMIN) проходит.
6. **AC-6 (чужой scope → 403, НЕ пустой список).** Given держатель `status.view` со scope на другой дивизион, When спрашивает `division_id` вне поддерева, Then **403** `PERMISSION_DENIED`, тело — §36-envelope с `details.division_id`. **Пустой 200 здесь запрещён**: потребитель трактует пустой ответ как «отклонений не было» и садит весь дивизион в «В строю» — тихо неверные данные вместо громкого отказа. (Отличие от канона «list никогда не ошибается на scope» ([DailySubmissionSelector.list](../../Backend/VAPS/apps/operations/submissions/selectors.py):52-56) осознанное: там `division_id` необязателен и список — обзор; здесь он обязателен и ответ — источник предзаполнения. Прецедент обязательного `division_id` с 403 — `ExpenseReportViewSet.period`.)
7. **AC-7 (глобальный грант).** Given актор с безскоуповым/wildcard-грантом `status.view` (`has_permission(..., division_id=…)` → True для любого), Then любой существующий `division_id` отдаётся с 200.
8. **AC-8 (фантомный дивизион → 404, ПОСЛЕ гейта scope).** Given валидный UUID несуществующего дивизиона, Then **404** `ENTITY_NOT_FOUND`. Порядок проверок: право (403) → scope (403) → существование (404) — скоупнутый чужак получает 403 и НЕ узнаёт, существует ли дивизион (oracle-утечка; тот же порядок, что `_ensure_division_exists` в submissions).
9. **AC-9 (структурная валидация → 400).** Given отсутствует `business_date`, ИЛИ отсутствует `division_id`, ИЛИ `business_date` не ISO-дата, ИЛИ `division_id` не UUID, Then **400** `VALIDATION_ERROR` (DRF-сериализатор фильтров на границе, до селектора), тело — §36-envelope с `details`.
10. **AC-10 (схема регенерирована + ответ ОБЪЕКТ, не массив).** `Backend/VAPS/schema.yaml` перегенерирован (`make schema`), содержит `GET /api/operations/statuses/` с обоими query-параметрами и телом ответа 200; `apps/core/tests/test_schema_drift.py` зелёный. `frontend/src/shared/api/schema.d.ts` перегенерирован (`npm run generate:api`); `node scripts/schema-check.mjs` зелёный. **Гейт стори (два, оба обязательны):** (а) `grep -c 'operations/statuses/' frontend/src/shared/api/schema.d.ts` даёт ≥2 (было 1 — только bulk); (б) в `schema.yaml` у `/api/operations/statuses/` `get.responses.'200'.content.application/json.schema` — **`$ref` на объект, НЕ `type: array`**. См. Решение №5: без явного `many=False` spectacular обернёт ответ в массив, рантайм останется правильным, и ни один другой AC этого не заметит.
11. **AC-11 (RBAC-матрица покрывает роут).** В `MATRIX` добавлена строка `"ops-status-list": _MethodGate({"get": "status.view"})`; `test_matrix_covers_every_registered_route` и `test_method_gates_cover_exactly_served_methods` зелёные. Ожидания ALLOW/DENY считаются из живого сида (`_holders`), per-role не хардкодятся. **Сид НЕ меняется** — `status.view` уже есть и уже гранён `DIVISION_OPERATOR` ([seed_operations.py:66](../../Backend/VAPS/apps/operations/management/commands/seed_operations.py)).
12. **AC-12 (арх-инварианты и регресс).** `test_statuses_does_not_import_submissions` зелёный (см. Решение №1) — новая вьюха НЕ импортирует `apps.operations.submissions.*`. `test_operations_does_not_import_core_models` зелёный (core только через селекторы). POST `bulk` (10.1a) не задет: его тесты, матрица и контракт без правок. `make gate` (из `Backend/VAPS`) зелёный, `makemigrations --check` → «No changes detected» (модели не трогаем). `npm run gate` (из `frontend`) зелёный — меняется только сгенерированный `schema.d.ts`.
13. **AC-13 (own-level, НЕ поддерево).** Given у запрошенного дивизиона есть дочерний, и у сотрудника ДОЧЕРНЕГО дивизиона живой статус на дату, Then его в `rows` **нет**. Ростер берётся строго `roster_on(business_date, {division_id})` — точное равенство, без `subtree_ids`. ⚠️ Это НЕ следует из scope-гейта: тот subtree-aware (`_scope_matches`), и дев, рассуждая по аналогии, может честно взять поддерево. Канон проекта — own-level, зафиксирован прямым текстом в [snapshot.py:50](../../Backend/VAPS/apps/operations/submissions/services/snapshot.py) и [traffic_light.py:36](../../Backend/VAPS/apps/operations/submissions/traffic_light.py); грид фронта тоже own-level (`/api/core/employees/?division_id=` — точное равенство), поэтому поддерево развело бы строки грида и префилл. **Тест обязан брать дочерний дивизион, а не сиблинг** — на сиблинге обе реализации зелёные, ассерт вакуумен.
14. **AC-14 (пустой ростер → пустой ответ, НЕ вся база).** Given дивизион существует и актор его видит, но сотрудников в нём на дату нет, при этом в БД есть живые статусы сотрудников других дивизионов, Then **200** и `rows == []`. ⚠️ Это гард против утечки: `overlapping_on(date, employee_ids=None)` фильтр по сотрудникам **не применяет** ([selectors.py:53-56](../../Backend/VAPS/apps/operations/statuses/selectors.py)), а естественная идиома `roster.get(division_id)` для пустого дивизиона возвращает именно `None`. Ошибка тихая: 200 с чужими данными. 🔴 Красная проба обязательна — подменить `[]` на `None` в вызове, тест должен покраснеть.

## Tasks / Subtasks

- [ ] **Task 1 — Сериализаторы чтения** (`apps/operations/statuses/api/serializers.py`, MOD) (AC: 1,9)
  - [ ] `StatusListFilterSerializer(serializers.Serializer)`: `business_date = DateField()`, `division_id = UUIDField()` — **оба обязательные** (AC-9). Зеркало `ExpensePeriodFilterSerializer`.
  - [ ] `EmployeeStatusRowSerializer(serializers.Serializer)`: `employee_id = UUIDField()`, `status_type_code = CharField()`, `date_start = DateField()`, `date_end = DateField()`. Ровно 4 поля — форма `EmployeeStatusSelector.overlapping_on` и ровно то, что ест `YesterdayPlacement`. `source`/`id` НЕ отдаём (Решение №3).
- [ ] **Task 2 — Селектор списка на дату** (`apps/operations/statuses/selectors.py`, MOD) (AC: 2,3,4,13,14)
  - [ ] `EmployeeStatusSelector.for_division_on(business_date, division_id) -> list[dict]`: `roster_on(business_date, {division_id})` → плоский список `employee_ids` → `cls.overlapping_on(business_date, employee_ids=employee_ids)`.
  - [ ] 🚨 **Пустой ростер обязан давать `[]`, а не «всю базу».** `roster.get(division_id)` вернёт `None`, а `overlapping_on(date, employee_ids=None)` фильтр **не применяет** → утечка чужих статусов под видом 200. Писать `roster.get(division_id, [])` и выходить рано; если выходишь рано — второго запроса нет вовсе (AC-14).
  - [ ] **Own-level, без `subtree_ids`** — множество ровно `{division_id}` (AC-13).
  - [ ] `from apps.core.selectors import HistoricalEmployeeSelector` — санкционированный канал чтения core (ARCH-003; `core.models` импортировать нельзя).
  - [ ] Докстрингом зафиксировать: `roster_on` даёт `{division_id: [employee_id]}` и берёт ТОЛЬКО `WORKING & is_active`; фолбэк BR-CORE-HISTORY-003 действует до бэкфилла E7 (AC-4).
  - [ ] Детерминированный порядок: отсортировать результат по `(employee_id, date_start)` — без явного `order_by` порядок строк из БД не гарантирован, а тест на список стал бы флейком.
- [ ] **Task 3 — list-экшен на StatusViewSet** (`apps/operations/statuses/api/views.py`, MOD) (AC: 1,5,6,7,8)
  - [ ] `permission_map = {"bulk": _BULK_PERMISSION, "list": _READ_PERMISSION}`, где `_READ_PERMISSION = "status.view"`; `http_method_names = ["get", "post", "options"]` (было `["post", "options"]`).
  - [ ] `def list(self, request, *args, **kwargs)`: фильтры → `is_valid(raise_exception=True)` → **scope-гейт** (Решение №1) → **404-гейт** `CoreDivisionTreeSelector.exists(division_id)` → селектор → `Response({"business_date":…, "division_id":…, "rows": EmployeeStatusRowSerializer(rows, many=True).data})`.
  - [ ] Порядок гейтов ровно: право (mixin) → scope (403) → существование (404) → чтение. Комментарием — почему именно так (AC-8, oracle-утечка).
  - [ ] **`parameters` — сериализатором фильтров, не списком `OpenApiParameter`:** `@extend_schema(parameters=[StatusListFilterSerializer], …)`. Канон проекта — [views.py:350](../../Backend/VAPS/apps/operations/submissions/api/views.py) (`parameters=[ExpensePeriodFilterSerializer]`), результат в `schema.yaml` идентичен ручному списку. Без явных `parameters` spectacular не увидит query-параметры у `ViewSet.list` вовсе (AC-10а).
  - [ ] 🚨 **`responses={200: ...}` обязан нести `many=False`** — см. Решение №5. Иначе AC-10б красный, а рантайм зелёный.
  - [ ] Обновить **оба** устаревших текста: модуль-докстринг (`"""Story 10.1a — REST bulk-роут статусов…"""`, теперь модуль несёт два роута) И inline-комментарий над `http_method_names` ([views.py:31](../../Backend/VAPS/apps/operations/statuses/api/views.py): «Минимальная поверхность: только POST bulk. GET-загрузка "вчера" — 10.1b») — второй становится прямо ложным.
- [ ] **Task 4 — RBAC-матрица** (`apps/operations/tests/test_rbac_matrix.py`, MOD) (AC: 11)
  - [ ] `"ops-status-list": _MethodGate({"get": "status.view"})` рядом с `"ops-status-bulk"`. Reverse-имя даёт `DefaultRouter` для `basename="ops-status"` — `urls.py` НЕ меняется (роут уже зарегистрирован 10.1a).
  - [ ] Сид не трогать (AC-11).
- [ ] **Task 5 — API-тесты** (`apps/operations/statuses/tests/test_status_read_api.py`, NEW) (AC: 1–9,13,14)
  - [ ] **Копировать поимённо из [test_bulk_status_api.py:33-77](../../Backend/VAPS/apps/operations/statuses/tests/test_bulk_status_api.py)** (общего `conftest.py` для `operations` НЕТ — только корневой и `apps/core/tests/`, так что хелперы придётся продублировать): фикстура `env` (`call_command("seed_operations")` + org/DivisionType/Division + два `StatusType`), `_division`, `_emp`, `_grant(user_id, role_code, division=None)` — именно он даёт актора С ролью И scope, что нужно AC-6/AC-7, `_client(actor)` (с `raise_request_exception = False`).
  - [ ] **Роли берутся из живого сида, не выдумываются** ([seed_operations.py](../../Backend/VAPS/apps/operations/management/commands/seed_operations.py)): `status.view` держат `DIVISION_OPERATOR` (L66) и `VIEWER` (L77) → акторы для AC-1/AC-6/AC-7; `INTEGRATION_USER` держит **только** `status.manage` (L80) → идеальный актор для AC-5; `ADMIN` через `*` → AC-7.
  - [ ] AC-1 happy path + сравнение СПИСКА целиком (порядок); AC-2 обе границы интервала (`date_end` исключающая — **обязательный тест**, не рассуждение); AC-3 отменённый + чужой дивизион; AC-4 уволенный; AC-5 без права + аноним; AC-6 чужой scope → 403 (а не пустой 200 — ассертить именно код и `error_code`); AC-7 глобальный грант; AC-8 фантомный UUID → 404 И скоупнутый чужак на фантомном → **403, не 404**; AC-9 четыре формы 400; **AC-13 дочерний (не сиблинг!) дивизион не виден**; **AC-14 пустой дивизион → `rows == []` при живых статусах в других дивизионах**.
  - [ ] 🔴 **Три красные пробы (обязательны, AI-1 ретро E10)** — каждая должна покраснеть, зелёная = ассерт вакуумен:
    1. вернуть в AC-6 пустой 200 вместо 403;
    2. заменить `roster.get(division_id, [])` на `roster.get(division_id)` — AC-14 обязан упасть (проба против утечки);
    3. заменить `{division_id}` на `CoreDivisionTreeSelector.subtree_ids(division_id)` — AC-13 обязан упасть.
  - [ ] Перед пробами убедиться, что незакоммиченных правок нет — `git checkout` после пробы стирает несохранённое ([инцидент 9.6](../../CLAUDE.md)).
- [ ] **Task 6 — Регенерация схем** (AC: 10)
  - [ ] Бэк: `make schema` из `Backend/VAPS`; проверить наличие `GET /api/operations/statuses/` и обоих параметров; `test_schema_drift.py` зелёный.
  - [ ] Фронт: `cd frontend && npm run generate:api`; `node scripts/schema-check.mjs`; выполнить гейт-грep AC-10.
- [ ] **Task 7 — Гейт обеих сторон** (AC: 12)
  - [ ] `make gate` из `Backend/VAPS` (ruff + pytest + `makemigrations --check`, бюджет 300s). Отдельно убедиться, что `test_isolation.py` и `test_rbac_matrix.py` в выборке.
  - [ ] `npm run gate` из `frontend` (⚠️ из своей папки — из корня vitest берёт чужой конфиг).
  - [ ] ⚠️ Известный пред-существующий флейк `daily-grid/DailyUpdatePage.test.tsx` на системной дате 2026-07-25+ — **не регресс этой стори**; подтвердить `git stash`-пробой, если упадёт, и не чинить здесь.

## Files To Create

- `Backend/VAPS/apps/operations/statuses/tests/test_status_read_api.py`

## Files To Modify

- `Backend/VAPS/apps/operations/statuses/api/serializers.py`
- `Backend/VAPS/apps/operations/statuses/api/views.py`
- `Backend/VAPS/apps/operations/statuses/selectors.py`
- `Backend/VAPS/apps/operations/tests/test_rbac_matrix.py`

Регенерируемые (не авторские, вывод `make schema` / `npm run generate:api`):
`Backend/VAPS/schema.yaml`, `frontend/src/shared/api/schema.d.ts`.

## Dependencies

- **Depends on:** 10.1a (`StatusViewSet`, роутер-регистрация `ops-status`, паттерн вьюхи) — `done`; 2.4 (`roster_on`) — `done`; 3.2 (`EmployeeStatus`, GiST-индекс) — `done`.
- **Blocks:** 10.1e (префилл «вчера» во фронте) — без этого роута ей нечего звать.
- **Независима от:** 10.1d (справочник статус-типов) — другой роут, другой потребитель; порядок между ними любой.

## Tests

- **Unit:** `EmployeeStatusSelector.for_division_on` — границы интервала, отменённые, чужой дивизион, пустой ростер (покрывается через API-тесты; отдельный selector-тест — по желанию дева, если удобнее изолировать).
- **Integration:** `test_status_read_api.py` — 200/400/403/404 и все AC выше, через `APIClient`.
- **Regression:** `test_rbac_matrix.py`, `test_isolation.py`, `test_schema_drift.py`, весь `test_bulk_status_api.py`.
- **Manual:** не требуется — поверхности в UI эта стори не создаёт (потребитель — 10.1e).

## Definition of Done

- [ ] Код реализован
- [ ] Тесты добавлены (включая красную пробу Task 5)
- [ ] `make gate` зелёный из `Backend/VAPS`
- [ ] `npm run gate` зелёный из `frontend`
- [ ] `makemigrations --check` → «No changes detected»
- [ ] Обе схемы регенерированы, гейт-грep AC-10 проходит
- [ ] Нет захардкоженных секретов
- [ ] Докстринг `views.py` обновлён (устаревшее «только POST bulk» вычищено)

## Dev Notes

### Решение №1 — scope-гейт пишем на месте, `ensure_division_scope` импортировать НЕЛЬЗЯ

Готовый хелпер 403-скоупа живёт в `apps/operations/submissions/services/scope_gate.py`. Импорт его из `statuses` **уронит гейт**: `test_statuses_does_not_import_submissions` ([test_isolation.py:36-52](../../Backend/VAPS/apps/operations/tests/test_isolation.py)) запрещает `statuses → submissions.*` — поток подобластей односторонний вниз (architecture.md#L587), и инверсия 5.4b держится на callback-хуке, а не на импорте.

Поэтому во вьюхе:

```python
from apps.core.exceptions import DomainError  # закрытый мир кодов, новых не заводим

if not PermissionService.has_permission(request.actor_id, _READ_PERMISSION, division_id=division_id):
    raise DomainError("PERMISSION_DENIED", 403, detail={"division_id": str(division_id)})
```

`has_permission` subtree-aware (`_scope_matches`) — ровно та же семантика, что у `ensure_division_scope`, потому что тот сам её и зовёт.

⚠️ **`message` не передавать.** Оригинал ([scope_gate.py:38-41](../../Backend/VAPS/apps/operations/submissions/services/scope_gate.py)) его не передаёт, поэтому в его конверте `message == "PERMISSION_DENIED"`. Добавить сюда человеческий текст = завести ровно тот дрейф 403-конверта, о котором Открытый вопрос №1. Зеркалим буквально.

Коды `PERMISSION_DENIED` и `ENTITY_NOT_FOUND` уже в закрытом мире хендлера ([exception_handler.py:44-48](../../Backend/VAPS/apps/core/api/exception_handler.py)) — регистрировать новые не нужно и нельзя.

⚠️ Это **не** дублирующий гард в смысле «два владельца одного инварианта» — это единственный доступный путь из этой подобласти. Честная альтернатива (поднять `scope_gate` в нейтральный `apps/operations/services/`, откуда его уже импортируют обе стороны) отклонена по бюджету: 6+ файлов правок в закрытом эпике ради read-роута. **Вынести в открытые вопросы для ревью** — если Bratan решит, что дрейф 403-конверта между двумя реализациями реален, это отдельная рефактор-стори.

### Решение №2 — без пагинации, `division_id` обязателен

`LimitOffsetPagination` (канон architecture.md#L427, default 50 / max 200) здесь **опасен**: потребитель — префилл. Обрезанная страница означает, что сотрудник с отпуском не приедет в ответе и сядет в `DEFAULT_STATUS = IN_SERVICE` — оператор увидит «В строю» и, не заметив, сдаст день с неверными данными. Тихая порча вместо ошибки.

Вместо пагинации — обязательный `division_id`: объём ответа ограничен размером подразделения (~40–300 строк на управление; той же оценкой 10.1a калибровала свой cap в 1000). Управление целиком — естественная единица экрана.

Если когда-нибудь понадобится «весь scope одним запросом» — это другой роут с другим потребителем, не расширение этого.

Ключ ответа поэтому — **`rows`, а не `results`**: в этом проекте `results` означает пагинационный конверт `{count, next, previous, results}` (architecture.md#L427, `LimitOffsetPagination`). Здесь конверта нет, и `results` читался бы как «первая страница». `rows` — симметрия с телом bulk-запроса 10.1a.

### Решение №3 — отдаём 4 поля, не 6

`overlapping_on` уже возвращает ровно `{employee_id, status_type_code, date_start, date_end}`; `snapshot_facts_on` (6 полей, с `id`/`source`) существует для снапшота сдачи, у него другой владелец. Потребителю префилла `id`/`source` не нужны ни для чего: `YesterdayPlacement` = `{statusCode, period?}`. Отдавать больше — расширять контракт вперёд спроса и потом не мочь сузить.

### Решение №4 — эхо-поля `business_date`/`division_id` в ответе

Экран меняет дату и подразделение селекторами; два запроса легко разъезжаются во времени. Эхо даёт потребителю дешёвую проверку «этот ответ про то, что сейчас на экране». Ставится сейчас, потому что добавить поле в ответ позже дёшево, а вот заставить фронт проверять то, чего в ответе нет, — нет.

### Решение №5 — `many=False` обязателен, иначе схема соврёт молча

drf-spectacular решает «список ли это» **по имени экшена**, а не по форме ответа: `openapi.py:145-147` — `return self.view.action == 'list'`, дальше `openapi.py:1527-1541` оборачивает схему в `build_array_type`, если нет override `many=False`. Наш экшен называется `list`, а ответ — объект `{business_date, division_id, rows}`. Итог без override: `schema.yaml` объявит 200 массивом, `schema.d.ts` типизирует ответ массивом, **рантайм при этом правильный** — расхождение всплывёт только у потребителя 10.1e.

Лечится так же, как это уже сделано в проекте — [views.py:126-129](../../Backend/VAPS/apps/operations/submissions/api/views.py):

```python
_StatusListResponse = extend_schema_serializer(many=False)(
    inline_serializer(name="EmployeeStatusListResponse", fields={...})
)
```

⚠️ Прецедент `ExpenseReportViewSet.period`, на который опирается остальная стори, этой ловушки **не содержит**: у `@action` имя экшена `period`, а не `list`, и эвристика не срабатывает. Ловушка живёт ровно у `ExpenseReportViewSet.list`. Не переносить оттуда `@extend_schema` механически.

Ни один другой AC этого не поймал бы: AC-1 проверяет тело (правильное), гейт-грep AC-10а считает вхождения пути (есть), `test_schema_drift` сравнивает `schema.yaml` со свежесгенерированным собой. Поэтому AC-10б ассертит форму явно.

### Что читать перед кодом (файлы UPDATE)

- [views.py](../../Backend/VAPS/apps/operations/statuses/api/views.py) — сейчас: один `@action bulk`, `http_method_names = ["post","options"]`, `permission_map = {"bulk": "status.manage"}`. Меняем: +`list`, +`get`, +ключ карты, докстринг. Сохранить: вьюха НЕ ловит `DomainError` и не фильтрует по правам вручную — всё течёт в `domain_exception_handler`.
- [serializers.py](../../Backend/VAPS/apps/operations/statuses/api/serializers.py) — сейчас: только bulk-payload (`MAX_BULK_ROWS = 1000`). Добавляем два класса рядом; существующие не трогаем (их форма — контракт 10.2, уже в проде фронта).
- [selectors.py](../../Backend/VAPS/apps/operations/statuses/selectors.py) — сейчас: `StatusTypeSelector.names_map`, `EmployeeStatusSelector.{earliest_start, overlapping_on, snapshot_facts_on, status_on}`. ⚠️ `overlapping_on` **не трогать**: на её точную 4-полевую форму завязан `strength_report` (комментарий в `snapshot_facts_on` фиксирует это прямым текстом). Новый метод — сосед, не правка.
- [test_rbac_matrix.py](../../Backend/VAPS/apps/operations/tests/test_rbac_matrix.py) — `MATRIX` + `_MethodGate`; строка `ops-status-bulk` на L177 — образец соседа.

### Ловушки, каждая из которых стоила бы прогона

1. **`None` означает «без фильтра» на ДВУХ этажах подряд, и оба тихие.**
   - `roster_on(date, division_ids)`: `None` = вся БД, `set()` = ничего ([_resolve_roster, selectors.py:66](../../Backend/VAPS/apps/core/selectors.py) — `if division_ids is not None`). Передавать `{division_id}`, никогда `None`.
   - `overlapping_on(date, employee_ids)`: **та же семантика этажом ниже** ([statuses/selectors.py:53-56](../../Backend/VAPS/apps/operations/statuses/selectors.py)). `roster.get(division_id)` для дивизиона без сотрудников вернёт `None` → отдадутся статусы всей базы. Это AC-14 и красная проба №2.
2. **`period__contains` полуоткрытый.** `date_end` — исключающая граница. Тест на обе границы обязателен (AC-2), иначе off-by-one разведёт префилл и расход.
3. **spectacular не выведет query-параметры сам** для `ViewSet.list` — без явных `parameters` они не попадут в `schema.yaml`, и `schema.d.ts` приедет с пустым `parameters.query`. AC-10а проверяет именно это.
4. **`RequirePermissionMixin` fail-closed, а не fail-open.** Экшен, отсутствующий в `permission_map`, получает `PermissionDenied` — [permissions.py:65-68](../../Backend/VAPS/apps/core/api/permissions.py): `code = self.permission_map.get(self.action); if code is None: raise PermissionDenied(...)`. Забытый `"list"` даёт **403 всем, включая ADMIN**, а не открытый роут. Ранний return существует только для метода вне `http_method_names` (405 отдаёт DRF) и для `action == "metadata"`. Практический вывод для дева: если новый роут молча отвечает 403 держателю права — первым делом смотреть карту, а не RBAC-сид.
5. **Порядок 403/404.** Сначала scope, потом существование. Обратный порядок превращает 404 в оракул существования дивизионов для чужака.
6. **`AUDIT_MATRIX` трогать НЕ нужно** — интроспекция аудит-покрытия сужена до мутирующих глаголов ([test_audit_coverage.py:270-289](../../Backend/VAPS/apps/audit/tests/test_audit_coverage.py), `_served_mutating`), GET-only роут туда не попадает. Сказано явно, чтобы не потратить прогон на выяснение.
7. **`ruff` здесь — `select = ["E","F"]`, дефолтная длина строки 88, `ruff format` по канону НЕ гоняется.** Длинный `@extend_schema` придётся разложить руками; форматтером по папке не проходить (заденет out-of-scope файлы).
8. **`http_method_names = ["get","post","options"]` безопасно для существующего bulk.** GET на `/statuses/bulk/` даёт `action=None` → миксин сам поднимает 405, а `_served_routes` матрицы считает методы из `callback.actions`, поэтому строка `ops-status-bulk` останется `{"post"}` и `test_method_gates_cover_exactly_served_methods` не покраснеет.

### Project Structure Notes

Роут `statuses` уже зарегистрирован в [urls.py](../../Backend/VAPS/apps/operations/api/urls.py) (`basename="ops-status"`) — `DefaultRouter` сам отдаст `list` по `GET /api/operations/statuses/` и имя `ops-status-list`. **`urls.py` в этой стори не меняется** — это и держит счёт авторских файлов на пяти.

### References

- [Source: _bmad-output/implementation-artifacts/epic-9-retro-2026-07-14.md#L75] — AI-4, «query-загрузка вчера»
- [Source: _bmad-output/implementation-artifacts/10-1a-rest-bulk-роут-статусов.md] — прецедент вьюхи, scope, схемы, матрицы
- [Source: _bmad/custom/decomposition-rules.md] — разрез по эндпоинтам, из-за которого стори сужена
- [Source: frontend/src/features/daily-grid/prefill.ts:13-31] — форма `YesterdayPlacement`, `DEFAULT_STATUS`
- [Source: frontend/src/features/daily-grid/DailyUpdatePage.tsx:9-11] — заглушка-потребитель, точка врезки 10.1e
- [Source: Backend/VAPS/apps/core/selectors.py:333-383] — `roster_on`, BR-CORE-HISTORY-003
- [Source: Backend/VAPS/apps/operations/tests/test_isolation.py:36-52] — запрет `statuses → submissions`

## Открытые вопросы (к ревью, не блокируют dev)

1. **Дрейф 403-конверта.** Решение №1 оставляет две реализации scope-гейта (`ensure_division_scope` в submissions и inline в statuses). Стоит ли поднять хелпер в `apps/operations/services/` отдельной рефактор-стори?
2. **Индекс под bulk-скан истории.** `roster_on` тянет `EmployeeDivisionHistory` по всей БД без индекса на `(starts_at, ends_at)` — сама она это называет perf-follow-up «таблица пуста до E7». С этим роутом она попадает в интерактивный путь экрана. Мерить после бэкфилла E7, не сейчас.

## Dev Agent Record

### Agent Model Used

### Debug Log References

### Completion Notes List

### File List
