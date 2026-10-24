---
baseline_commit: 665856851e7e66d65bf723af14d93cdda9e92d72
---
# Story 2.14: Раскатка гейта на остальные core API ViewSet'ы + (name,method)-рефакторинг MATRIX (2/2)

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

> **Часть 2/2 (финальная) декомпозиции «Гейт прав на core API»** (решение Bratan, AskUserQuestion 2026-06-23). 2.13 (Part A) построил механизм A (seam инжектит `request.effective_permissions`, core-гейт `require_permission` читает атрибут) и доказал его на пилоте `VacancyViewSet`. **Эта стори раскатывает гейт на остальные 5 core ViewSet'ов** (Employee/Division/Position/Rank/StaffingSlot) и делает **отложенный (name,method)-рефакторинг MATRIX** (deferred 2.9 #L215), без которого Employee и др. со смешанной view/edit политикой загейтить нельзя. **Закрывает эпик 2.**
>
> **Закрывает дыры:** `staffing-slot-assign-employee` (#L25 — аноним с произвольным X-User-Id создаёт назначение) и 15 остальных публичных core-роутов. После 2.14 в MATRIX НЕ остаётся ни одного `_DeferredGate`.

## Story

As a архитектор безопасности VAPS,
I want чтобы все оставшиеся core API ViewSet'ы (employees/divisions/positions/ranks/staffing-slots) были загейчены in-house RBAC по принципу «GET=view, write=manage/edit», а тест-матрица роль×endpoint выражала per-метод политику,
so that ни один core-эндпоинт не доступен анонимно/без права, дыра анонимной-назначки (#L25) закрыта, и AR-9 покрывает (роут, метод), а не только имя роута (FR-33; AR-9; ARCH-SEC-031).

## Acceptance Criteria

1. **(name,method)-рефакторинг MATRIX (deferred 2.9 #L215).** **Given** `test_rbac_matrix.py`, **When** добавлен страж `_MethodGate({method: code})` (per-метод коды) рядом с `_Gate`/`_AnyAuthenticated`, а `expected(actor, method)` принимает метод, **Then** completeness-gate проверяет НЕ только `set(SERVED)⊆set(MATRIX)` по именам, но И что `_MethodGate` покрывает РОВНО served-методы своего роута (нет пропущенного/лишнего метода → красный); **And** `_Gate`/`_AnyAuthenticated` остаются method-uniform (сигнатура `expected(actor, method)` совместима).
2. **Гейт-микшин + per-action карта на 5 ViewSet'ов.** **Given** `RequirePermissionMixin` (core, в `apps/core/api/permissions.py` или `mixins.py`) с `permission_map = {action: code}`, энфорс в `initial()` ПОСЛЕ `super().initial()` (когда seam уже наполнил `request.effective_permissions`); незамапленный action → `PermissionDenied` (fail-closed), **When** микшин подмешан в Employee/Division/Position/Rank/StaffingSlot ViewSet'ы с полными картами (см. Dev Notes), **Then** каждый обслуживаемый action гейчен соответствующим кодом; **And** ноль импортов `apps.operations` в core (`test_core_does_not_import_other_context_models` зелёный); **And** boundary-guard 2.9 зелёный (микшин читает `request.effective_permissions`/`actor_id`, не Django-auth).
3. **Все 15 MATRIX-строк перевёрнуты, `assign-employee` закрыт.** **Given** 15 core-роутов (employee×4/division×3/position×2/rank×2/staffing-slot×4), **When** их строки `_DeferredGate("story 2.14")` → `_Gate`/`_MethodGate` с кодами из Dev Notes, **Then** per-role сетка зелёная для каждого (роут,метод)×актор (ALLOW держателям кода, DENY иначе + аноним 403); **And** в MATRIX НЕ остаётся ни одного `_DeferredGate`; **And** `staffing-slot-assign-employee` POST требует `personnel.edit` (аноним/не-держатель → 403, закрыт #L25).
4. **Существующие API-тесты авторизованы (нулевая функц. регрессия).** **Given** ранее-публичные эндпоинты теперь гейчены, **When** прогон, **Then** все существующие тесты, бьющие в employees/divisions/positions/ranks/staffing-slots (≥`test_employee_api.py`, `test_division_api.py`, `test_staffing_api.py`, проверить `test_actor_field.py`), авторизованы посевом + актором с нужным правом (shared-хелпер/фикстура — DRY); **And** их смысловые ассерты (статусы 200/201, тела) сохранены — гейт добавлен, поведение не сломано.
5. **Parity-тест (deferred из ревью 2.13) + гейт.** **Given** core-гейт дублирует `*`-короткозамыкание PermissionService, **When** добавлен parity-тест «`require_permission` (core) ≡ `PermissionService.has_permission` на матрице кейсов (держатель/не-держатель/`*`/аноним)», **Then** он зелёный (ловит будущий дрейф wildcard-семантики); **And** `make gate` (Postgres :5433) — ruff чист, pytest зелёный, `manage.py check` 0 issues, `makemigrations --check` «No changes detected», < 300с. **Артефакты НЕ коммитить** (за Bratan).

## Tasks / Subtasks

- [x] **Задача 1. (name,method)-рефакторинг MATRIX (AC: 1)**
  - [x] В `apps/operations/tests/test_rbac_matrix.py` добавить класс `_MethodGate` (конструктор `{method: code}`; `expected(self, actor, method)` → ищет код метода → деривит держателей из `ROLE_PERMISSIONS` как `_Gate`; аноним → DENY). Привести `_Gate.expected`/`_AnyAuthenticated.expected`/`_DeferredGate.expected` к сигнатуре `(self, actor, method)` (method игнорируется у uniform-стражей).
  - [x] Обновить `_behavioral_params()`: `spec.expected(actor, method)` (передать method). Обновить `test_matrix_declares_all_actors_explicitly` под новую сигнатуру.
  - [x] Усилить completeness: для `_MethodGate`-строк ассертить `set(spec.methods) == SERVED[name]` (per-метод покрытие — закрывает #L215: новый метод на существующем роуте без кода → красный).
- [x] **Задача 2. RequirePermissionMixin + применение к 5 ViewSet'ам (AC: 2)**
  - [x] В core (`apps/core/api/permissions.py` или новый `apps/core/api/mixins.py`) — `RequirePermissionMixin`: `permission_map = {}`; override `initial(self, request, *a, **k)`: `super().initial(...)` затем `code = self.permission_map.get(self.action)`; `if code is None: raise PermissionDenied("PERMISSION_DENIED")` (fail-closed на незамапленный action); иначе `require_permission(request, code)`. Импорт только core/DRF.
  - [x] Подмешать в `EmployeeViewSet`/`DivisionViewSet`/`PositionViewSet`/`RankViewSet`/`StaffingSlotViewSet` (первым базовым классом, до `viewsets.*`) + задать `permission_map` (полные карты — Dev Notes). `VacancyViewSet` НЕ трогать (загейчен в 2.13 явным `require_permission` — оставить как есть ИЛИ по желанию мигрировать на микшин, но не обязательно).
  - [x] Снять одиночный `require_permission` из тела `VacancyViewSet.list`? — НЕТ, оставить (2.13, не регрессировать). Микшин — для 5 новых.
- [x] **Задача 3. Flip всех 15 MATRIX-строк (AC: 3)**
  - [x] Заменить `_DeferredGate("story 2.14")` на `_Gate`/`_MethodGate` по картам Dev Notes. `assign-employee` → `_Gate("personnel.edit")` (один POST). После — `grep _DeferredGate test_rbac_matrix.py` ПУСТ.
- [x] **Задача 4. Авторизовать существующие API-тесты (AC: 4)**
  - [x] Найти ВСЕ тесты, бьющие в гейченные эндпоинты: `grep -rEn "client\.(get|post|patch|put|delete)\(.*api/core/(employees|divisions|positions|ranks|staffing-slots)"` (известны: `test_employee_api.py` ~6, `test_division_api.py` ~2, `test_staffing_api.py` ~2; проверить `test_actor_field.py`). Авторизовать: `call_command("seed_operations")` + `UserRole.objects.create(user_id=..., role_code_id=<роль с нужным правом>)` + `client.credentials(HTTP_X_USER_ID=...)`. DRY: вынести хелпер/фикстуру (напр. в `conftest.py` или общий модуль) `authed_client(role)` / `as_role`. Право подобрать под метод (чтение→view-роль; запись→ORGD/ADMIN).
  - [x] Сохранить смысловые ассерты (200/201/тела). Гейт добавлен — поведение не менять.
- [x] **Задача 5. Parity-тест + гейт (AC: 5)**
  - [x] Тест (в `apps/operations/tests/` — импорт обоих легален): для набора (актор-держатель / не-держатель / ADMIN-`*` / аноним-без-actor_id) — собрать request (как `_resolved_request` в `test_api_gate.py`), сверить, что `require_permission` (core) raise/не-raise СОГЛАСОВАН с `PermissionService.has_permission(actor, code)`. Ловит дрейф wildcard.
  - [x] `make gate` (Postgres :5433). **Артефакты НЕ коммитить.**

## Dev Notes

### Контекст из 2.13 (механизм A уже построен — НЕ переделывать)

2.13 (done) дал: seam `apps/operations/api/authz.py::EffectivePermissionsResolver` (зарегистрирован строкой в `config/settings.py` `DEFAULT_AUTHENTICATION_CLASSES` после XUserId) пишет `request.effective_permissions`; core-гейт `apps/core/api/permissions.py::require_permission(request, code)` читает атрибут (ноль импортов operations, `*`-короткозамыкание). 4 permission-кода + provisional role-map УЖЕ в `seed_operations` (НЕ менять seed в 2.14). Пилот `VacancyViewSet.list` загейчен. Порядок auth-классов закреплён `test_auth_class_order_is_identity_then_resolver`.

### Permission-карты на 5 ViewSet'ов (action → код)

Таксоном 2.13: `personnel.{view,edit}` (Employee/StaffingSlot/Vacancy), `orgstructure.{view,manage}` (Division/Position/Rank). Принцип: **чтение (list/retrieve/leaf_descendants/любой GET-custom) → `.view`; запись (create/update/partial_update/destroy/archive/restore/assign/release) → `.edit`/`.manage`.**

| ViewSet | http_method_names | permission_map (action→код) |
|---|---|---|
| `EmployeeViewSet` | get,patch,post | list/retrieve→`personnel.view`; create/partial_update/archive/restore→`personnel.edit` |
| `DivisionViewSet` | (ModelViewSet, все) | list/retrieve/leaf_descendants→`orgstructure.view`; create/update/partial_update/destroy→`orgstructure.manage` |
| `PositionViewSet` | get,post,patch | list/retrieve→`orgstructure.view`; create/partial_update→`orgstructure.manage` |
| `RankViewSet` | get,post,patch | list/retrieve→`orgstructure.view`; create/partial_update→`orgstructure.manage` |
| `StaffingSlotViewSet` | get,post,patch | list/retrieve→`personnel.view`; create/partial_update/assign_employee/release→`personnel.edit` |

⚠️ **Карта должна покрывать ВСЕ обслуживаемые actions** (микшин fail-closed на незамапленный). `DivisionViewSet` = полный ModelViewSet → НЕ забыть `update` (PUT), `destroy` (DELETE). Сверить `self.action`-имена: кастомные actions — это имя метода (`archive`, `restore`, `assign_employee`, `release`, `leaf_descendants`), не url_path.

### MATRIX (name,method) — целевые строки

```
"employee-list":        _MethodGate({"get": "personnel.view", "post": "personnel.edit"}),
"employee-detail":      _MethodGate({"get": "personnel.view", "patch": "personnel.edit"}),
"employee-archive":     _Gate("personnel.edit"),   # один POST
"employee-restore":     _Gate("personnel.edit"),
"division-list":        _MethodGate({"get": "orgstructure.view", "post": "orgstructure.manage"}),
"division-detail":      _MethodGate({"get": "orgstructure.view", "put": "orgstructure.manage",
                                     "patch": "orgstructure.manage", "delete": "orgstructure.manage"}),
"division-leaf-descendants": _Gate("orgstructure.view"),   # один GET
"position-list":        _MethodGate({"get": "orgstructure.view", "post": "orgstructure.manage"}),
"position-detail":      _MethodGate({"get": "orgstructure.view", "patch": "orgstructure.manage"}),
"rank-list":            _MethodGate({"get": "orgstructure.view", "post": "orgstructure.manage"}),
"rank-detail":          _MethodGate({"get": "orgstructure.view", "patch": "orgstructure.manage"}),
"staffing-slot-list":   _MethodGate({"get": "personnel.view", "post": "personnel.edit"}),
"staffing-slot-detail": _MethodGate({"get": "personnel.view", "patch": "personnel.edit"}),
"staffing-slot-assign-employee": _Gate("personnel.edit"),  # один POST — закрывает #L25
"staffing-slot-release":         _Gate("personnel.edit"),
```
⚠️ Сверить served-методы каждого роута через `SERVED` (резолвер) ПЕРЕД написанием — `division-detail` методы зависят от того, что реально отдаёт ModelViewSet (get/put/patch/delete). `_MethodGate.methods` обязан == `SERVED[name]` (completeness).

### Почему микшин в `initial()`, а не per-метод require_permission

`initial()` DRF вызывается ПОСЛЕ `perform_authentication` (которое триггерит seam → `request.effective_permissions` наполнен) и ДО хендлера; `self.action` уже выставлен `ViewSetMixin.initialize_request`. Один хук покрывает все actions (вкл. дефолтные create/update/destroy ModelViewSet, которые иначе пришлось бы переопределять). Fail-closed на незамапленный action = новый action без кода → 403, ловится completeness-тестом матрицы. Альтернатива (явный `require_permission` в каждом методе, как operations) — verbose для ModelViewSet с дефолтными actions; микшин DRY и единообразен.

### Тонкости / Gotchas

- **Микшин — первым базовым классом:** `class EmployeeViewSet(RequirePermissionMixin, viewsets.ModelViewSet)` — чтобы его `initial()` вызвал `super().initial()` (DRF-цепочку), затем гейт. Порядок MRO критичен.
- **`self.action` для кастомных @action:** имя Python-метода (`archive`, `assign_employee`), НЕ `url_path` (`assign-employee`). Карта по `self.action`.
- **Завал существующих тестов — ОЖИДАЕМ и МАСШТАБНЕЕ, чем в 2.13:** ~10 API-вызовов в 3+ файлах станут 403. Это не регрессия кода — тесты не авторизованы. Задача 4 обязательна; БЕЗ неё гейт красный. DRY-хелпер сэкономит правки. Прецедент авторизации: `test_staffing_api.py::test_vacancies_endpoint` (2.13) + `test_rbac_matrix` фикстура `matrix_actors`.
- **DivisionViewSet DELETE/PUT:** ModelViewSet отдаёт destroy/update. Гейтим их `orgstructure.manage`. Вопрос «нужен ли вообще DELETE на дивизии» — ОТДЕЛЬНЫЙ (ограничение методов ≠ гейтинг); не сужать `http_method_names` в этой стори.
- **Маскирование (`X-User-Permissions`, #L12) НЕ трогать** — gate≠masking. Хотя seam теперь даёт настоящие `request.effective_permissions` (соблазн переключить) — это отдельная стори (out of scope).
- **seed НЕ меняется:** все 4 кода + role-map посеяны в 2.13. Если правишь seed — стоп, не та стори (канонизация provisional-карты — отдельный открытый вопрос Bratan + prune-проход, см. deferred-work).
- **Без миграции** (только views/mixin/tests). `makemigrations --check` обязан остаться «No changes detected».
- **boundary-guard 2.9** сканит `apps/core/api/**` — микшин читает `request.effective_permissions`/`request.actor_id`, не `request.user`/`.has_perm`/`is_staff` → зелёный.

### Out of Scope (НЕ в 2.14)

- **Перенос маскирования** `X-User-Permissions`→`request.effective_permissions` (#L12) → отдельная стори.
- **Канонизация provisional role-map + seed-prune устаревших грантов** (deferred ревью 2.13 — security-sensitive) → при ревизии карты Bratan, отдельно.
- **Scope-subtree enforcement** («своё ли подразделение», ARCH#L450) → сервис-слой, E3+.
- **Ограничение HTTP-методов** (напр. запрет DELETE дивизий) → отдельно.
- **Seam-perf** (резолв на ungated; deferred 2.13) — после 2.14 ungated core-роутов не остаётся, но перф-рефайн (lazy/memo) → при горячих эндпоинтах расхода (E6+).

### Project Structure Notes

- **Создать:** `RequirePermissionMixin` (в `apps/core/api/permissions.py` или новый `apps/core/api/mixins.py`); parity-тест (в `apps/operations/tests/`); опц. shared auth-фикстура (conftest/helper).
- **Изменить:** `apps/core/api/views.py` (микшин + permission_map на 5 ViewSet'ов), `apps/operations/tests/test_rbac_matrix.py` (_MethodGate + flip 15 строк + completeness), `apps/core/tests/test_employee_api.py` + `test_division_api.py` + `test_staffing_api.py` (+`test_actor_field.py` если бьёт) — авторизация.
- **НЕ трогать:** seam `authz.py`, core-гейт `require_permission` (2.13), `seed_operations`, маскирование, `VacancyViewSet` (загейчен), модели/миграции, `XUserIdAuthentication`, `PermissionService`.

### References

- [Source: _bmad-output/implementation-artifacts/2-13-гейт-прав-на-core-api-эндпоинты.md] — механизм A (seam+core-гейт), таксоном 4 кодов, provisional role-map, девиация пилота (почему Employee отложен сюда), Review Findings (parity-тест deferred сюда).
- [Source: _bmad-output/implementation-artifacts/deferred-work.md] — #L25 (assign-employee аноним-назначка → эта стори); #L215-эквивалент (completeness по (name,method) — рефакторинг здесь); ревью-2.13 деферы (seam-perf, seed-prune, wildcard-parity).
- [Source: Backend/VAPS/apps/core/api/views.py] — 5 ViewSet'ов под гейт (actions/http_method_names); `VacancyViewSet` (загейчен 2.13, не трогать); маскирование `_permissions_from_request` (не трогать).
- [Source: Backend/VAPS/apps/core/api/permissions.py] — `require_permission` (2.13); дом для `RequirePermissionMixin`.
- [Source: Backend/VAPS/apps/operations/tests/test_rbac_matrix.py:61-130,258-321] — `_Gate`/`_AnyAuthenticated`/`_DeferredGate`, `_behavioral_params`, фикстура `matrix_actors`, поведенческий тест (рефакторинг под (name,method)).
- [Source: Backend/VAPS/apps/core/tests/test_api_gate.py] — `_resolved_request`-харнесс (для parity-теста); `test_auth_class_order_is_identity_then_resolver`.
- [Source: Backend/VAPS/apps/operations/management/commands/seed_operations.py] — 4 кода + provisional role-map (НЕ менять).
- [Source: _bmad-output/planning-artifacts/architecture.md#L450-451] permission-класс = грубая роль/действие, scope в сервисе; [#L585] core↛all; [#L315-316] ARCH-SEC-030/031.
- [Decision] AskUserQuestion 2026-06-23: сплит 2.13/2.14 + пилот Vacancy (Employee→2.14) (Bratan).

## Dev Agent Record

### Agent Model Used

Opus 4.8 (claude-opus-4-8[1m]), bmad-dev-story, 2026-06-23, TDD. baseline_commit `6658568`. Django 5.1.15.

### Debug Log References

- **SERVED верифицирован до кода** (резолвер): `division-detail`={delete,get,patch,put}, остальные совпали с дизайном Dev Notes → карты `_MethodGate` точны.
- **TDD-последовательность:** Task 1 (рефакторинг харнесса: `_MethodGate`, `expected(actor, method)`, per-метод completeness) → матрица зелёная без смены поведения (115 passed). Task 3 (flip 15 строк `_DeferredGate`→`_Gate`/`_MethodGate`) → **RED** (134 failed — загейченные ожидания при незагейченных вьюхах). Task 2 (`RequirePermissionMixin` + 5 ViewSet'ов) → **GREEN** (матрица 358 passed, **0 xfailed** — `_DeferredGate` не осталось).
- **`RequirePermissionMixin`** (`apps/core/api/permissions.py`): энфорс в `initial()` ПОСЛЕ `super().initial()` (seam уже наполнил `request.effective_permissions`); `permission_map[self.action]`; незамапленный action → `PermissionDenied` (fail-closed). Подмешан ПЕРВЫМ базовым классом в 5 ViewSet'ов (MRO). `VacancyViewSet` оставлен на явном require_permission (2.13, не регрессировать).
- **(name,method)-completeness (#L215):** `test_method_gates_cover_exactly_served_methods` — `_MethodGate.methods == SERVED[name]` (новый метод без кода → красный). Закрывает отложенную 2.9-доработку.
- **#L25 закрыт:** `staffing-slot-assign-employee` POST → `personnel.edit`. `test_actor_field.py::test_assign_employee_api_without_header_leaves_created_by_null` (документировал дыру «actorless → created_by NULL») **переписан** в `test_assign_employee_api_denies_anonymous_caller` (аноним → 403, назначение не создаётся).
- **13 существующих API-тестов авторизованы** через DRY-фикстуру `grant` (`apps/core/tests/conftest.py`; seed + UserRole + X-User-Id; ADMIN-`*` по умолчанию — проходит любой гейт; per-role политику проверяет матрица). `test_staffing_api.py` 2.13-инлайн отрефакторен на `grant`, лишние импорты убраны. `test_actor_field` hr-7 авторизован (`grant(client, user_id="hr-7")` → created_by="hr-7" цел).
- **Parity-тест** (`apps/operations/tests/test_gate_parity.py`, deferred из ревью 2.13): `require_permission` (core) ≡ `PermissionService.has_permission` на 7 кейсах (держатель/не-держатель/`*`/unknown-code) + аноним → ловит будущий wildcard-дрейф.
- **Boundary-clean:** `test_core_does_not_import_other_context_models` + `test_authz_boundary.py` зелёные (микшин читает `request.effective_permissions`/`actor_id`, ноль импортов operations).
- **Без seed/миграции/маскирования.** **Полный `make gate`** (Postgres :5433): **824 passed, 0 xfailed** (было 27 — все core загейчены), 18 deselected; ruff чист; `manage.py check` 0 issues; `makemigrations --check` «No changes detected»; 41s.

### Completion Notes List

- **Эпик 2 закрыт по факту:** все 16 core API-роутов загейчены in-house RBAC; в MATRIX **ноль** `_DeferredGate`. Механизм A (2.13) раскатан через `RequirePermissionMixin`; (name,method)-рефакторинг MATRIX (#L215) выполнен.
- **Закрыта дыра #L25** (анонимная назначка). 15 ранее-публичных роутов + Employee теперь под гейтом «GET=view, write=edit/manage».
- **+ тесты:** per-метод completeness, parity-тест, 13 авторизованных API-тестов (DRY `grant`-фикстура).
- **Осталось за Bratan (отдельно, не 2.14):** канонизация provisional role-map + seed-prune устаревших грантов (security-sensitive, deferred ревью 2.13); перенос маскирования `X-User-Permissions`→`effective_permissions` (#L12); seam-perf на горячих эндпоинтах (E6+).
- **Артефакты НЕ закоммичены агентом** (за Bratan; прецедент 2.4–2.13). Status → review.

### File List

**Создано:**
- `Backend/VAPS/apps/core/tests/conftest.py` (DRY `grant`-фикстура авторизации)
- `Backend/VAPS/apps/operations/tests/test_gate_parity.py` (parity core-гейт ≡ PermissionService)

**Изменено:**
- `Backend/VAPS/apps/core/api/permissions.py` (+`RequirePermissionMixin`)
- `Backend/VAPS/apps/core/api/views.py` (микшин + `permission_map` на Employee/Division/Position/Rank/StaffingSlot)
- `Backend/VAPS/apps/operations/tests/test_rbac_matrix.py` (`_MethodGate` + `expected(actor,method)` + per-метод completeness + flip 15 строк; `_holders`-хелпер)
- `Backend/VAPS/apps/core/tests/test_employee_api.py` (7 тестов авторизованы)
- `Backend/VAPS/apps/core/tests/test_division_api.py` (2 теста авторизованы)
- `Backend/VAPS/apps/core/tests/test_staffing_api.py` (2 теста авторизованы + рефактор 2.13-инлайна на `grant`)
- `Backend/VAPS/apps/core/tests/test_actor_field.py` (hr-7 авторизован; anon-тест переписан под закрытый #L25)
- _(BMAD-трекинг: `sprint-status.yaml`, этот файл)_

## Change Log

| Дата | Изменение |
|------|-----------|
| 2026-06-23 | Создана история 2.14 Part B (bmad-create-story, Opus 4.8): раскатка гейта на 5 core ViewSet'ов (Employee/Division/Position/Rank/StaffingSlot) + (name,method)-рефакторинг MATRIX (deferred 2.9 #L215). `RequirePermissionMixin` (core, action→код карта, fail-closed, энфорс в initial()); `_MethodGate` в тест-матрице (per-метод коды + per-метод completeness); flip всех 15 `_DeferredGate`→`_Gate`/`_MethodGate` (закрывает #L25 assign-employee); авторизация ~10 существующих API-тестов (DRY-хелпер); parity-тест core-гейт≡PermissionService (deferred из ревью 2.13). seed/маскирование/миграции не трогаются. Закрывает эпик 2. Status → ready-for-dev. |
| 2026-06-23 | Code-review (bmad-code-review, Opus 4.8 — same-model caveat; 3 слоя; scoped diff 555 строк по 9 файлам). Acceptance Auditor: **ACCEPT** — AC-1..5 SATISFIED эмпирически (matrix 358/0 xfailed, isolation+boundary+parity зелёные, 18 авторизованных API-тестов, ноль _DeferredGate, #L25 закрыт, только 5 ViewSet'ов, seed/маскирование/миграции не тронуты). Edge Case Hunter (с кодом+БД) подтвердил: mixin timing sound, permission_map покрывает served-actions точно, ноль too-weak-кодов, masking без утечки, boundary чист — но вскрыл 2 MED (OPTIONS/metadata→403; PUT/DELETE→403 вместо 405). Опроверг Blind HIGH (initial-ordering, masking-leak, Vacancy-other-actions). 0 decision · 3 patch · 2 defer · 7 dismiss. См. ## Review Findings. |
| 2026-06-23 | Dev (bmad-dev-story, Opus 4.8, TDD): раскатка завершена, **эпик 2 закрыт по факту**. SERVED верифицирован (division-detail=delete/get/patch/put). Task 1 рефакторинг харнесса (`_MethodGate`/`expected(actor,method)`/per-метод completeness #L215) → зелёный. Task 3 flip 15 строк → RED (134 failed). Task 2 `RequirePermissionMixin` (initial() после super, fail-closed, MRO-first) + permission_map на 5 ViewSet'ов → GREEN (матрица 358 passed, 0 xfailed — `_DeferredGate` не осталось). #L25 закрыт (assign-employee→personnel.edit; anon-тест переписан на «403»). 13 API-тестов авторизованы DRY-фикстурой `grant` (conftest). Parity-тест (deferred 2.13) добавлен. Boundary-clean (isolation+2.9-guard зелёные; микшин в core, ноль импортов operations). `make gate` зелёный (Postgres :5433: 824 passed, 0 xfailed, ruff чист, makemigrations «No changes detected», check 0 issues, 41s). seed/маскирование/миграции не тронуты. Артефакты НЕ закоммичены. Status → review. |

| 2026-06-23 | Применены 3 патча ревью (mixin OPTIONS/405-фикс + map↔served-тест + strengthen anon-assert). Mixin `initial()`: пропуск method не из `http_method_names` (→405) + `metadata` (→OPTIONS 200) — починен эмпирически подтверждённый контракт-баг (OPTIONS/PUT/DELETE→403); защищена будущая SPA (CORS-preflight). +3 теста (options-not-gated, 405-not-403, map==served defense-in-depth) + усилен #L25-anon-тест (detail=PERMISSION_DENIED). `make gate` зелёный (Postgres :5433: 827 passed +3, 0 xfailed, ruff чист, makemigrations «No changes detected», check 0 issues, 28s). 2 defer → deferred-work.md (HTTP-тесты под ADMIN — митигировано matrix; «только ADMIN держит `*`»-гард → к канонизации role-map). **Эпик 2 закрыт.** Артефакты НЕ закоммичены агентом. Status → done. |

## Review Findings

_Code-review (bmad-code-review, 2026-06-23, Opus 4.8 — same-model caveat; 3 слоя; scoped diff 555 строк). Acceptance Auditor: **ACCEPT** — все 5 AC SATISFIED. Edge Case Hunter (с кодом+БД) подтвердил корректность ядра (mixin timing, permission_map↔served, ноль too-weak-кодов, masking без утечки, #L25 закрыт, boundary чист) и вскрыл 2 MED поведения mixin на НЕ-served методах. 0 decision · 3 patch · 2 defer · 7 dismiss._

### Patches (3)

- [x] [Review][Patch] **OPTIONS/metadata → 403 (CORS-preflight риск SPA)** + **PUT/DELETE → 403 вместо 405** [apps/core/api/permissions.py] — edge MED ×2 (эмпирически). ПРИМЕНЕНО+ВЕРИФИЦИРОВАНО единым фиксом mixin `initial()`: `if request.method.lower() not in self.http_method_names: return` (неподдерживаемые методы → DRF 405) + `if self.action == "metadata": return` (OPTIONS-metadata → 200). Division (полный ModelViewSet) DELETE/PUT обслуживает → гейтятся как и было. +2 теста: `test_options_is_not_gated` (OPTIONS→не-403), `test_unsupported_method_returns_405_not_403` (DELETE на Position→405).
- [x] [Review][Patch] **Нет прямого теста `permission_map == served-actions`** [apps/core/tests/test_api_gate.py] — edge LOW (defense-in-depth). ПРИМЕНЕНО: `test_gated_viewsets_map_every_served_action` (интроспекция роутера → каждый served-action ∈ `permission_map`; пересечение с `http_method_names` зеркалит mixin-фикс). +strengthen: `test_assign_employee_api_denies_anonymous_caller` ассертит `detail == "PERMISSION_DENIED"` (403 = именно гейт, blind LOW).

### Defer (2)

- [x] [Review][Defer] **HTTP-тесты эндпоинтов авторизуются ADMIN(`*`) → too-weak-code/map-ошибка ловится только matrix'ем (нет независимого оракула)** [apps/core/tests/conftest.py] — deferred. Blind: endpoint-behavior тесты с ADMIN не различают, требует ли write `.view` или `.edit`. Митигировано: rbac-matrix гоняет РЕАЛЬНЫЕ роли (VIEWER и т.д.) через живой DRF-стек и ловит гейт, пропускающий не-держателя (Edge верифицировал VIEWER→403 на write). Остаточный зазор: ДВЕ согласованные ошибки (и map, и MATRIX с одним слабым кодом) не ловятся. Независимый semantic-оракул «write обязан требовать edit-tier» — возможное усиление, но граничит с over-engineering при текущем покрытии matrix+parity. Пересмотреть, если карта прав усложнится.
- [x] [Review][Defer] **`*` — безусловный мастер-ключ; нет ассерта «только ADMIN держит `*`»** [apps/operations/management/commands/seed_operations.py] — deferred, by-design (ADMIN=`*`). Blind: если не-ADMIN роль когда-нибудь получит `*` (баг/правка) — откроются все гейты, matrix это закодирует как «корректно». Гард-тест «ни одна роль кроме ADMIN не держит `*` в ROLE_PERMISSIONS» — security-hardening, естественный дом — канонизация provisional role-map (открытый вопрос Bratan, вместе с seed-prune).

### Dismissed (7)

- **`initial()` ordering / seam-before-check / AttributeError-вместо-403** (blind HIGH): опровергнуто Edge эмпирически — `super().initial()` гоняет `perform_authentication` → seam наполняет `request.effective_permissions` ДО проверки; `self.action` выставлен `ViewSetMixin.initialize_request` до `initial`. MRO верен (mixin первым, super вызывается).
- **matrix тавтологичен (зеркалит prod-map)** (blind HIGH): на уровне ДЕКЛАРАЦИИ кодов — да, но поведенческий тест гоняет реальные роли через живой стек → ловит гейт, не энфорсящий заявленную политику (Edge: VIEWER→403 на write верифицирован). Не вакуумно.
- **`test_detail_..._reveals_iin` проходит по «не той причине» (ADMIN-`*` вместо header)** (blind MED): опровергнуто Edge — `mask_employee_data` keyуется на `X-User-Permissions`-header (литерал `in`, без `*`); ADMIN-gate-identity НЕ протекает в маскирование. Тест честно проверяет header-путь.
- **VacancyViewSet другие actions не загейчены** (blind MED): опровергнуто Edge — Vacancy обслуживает ТОЛЬКО `list`; инлайн `require_permission` его покрывает.
- **`grant` get_or_create предполагает посеянный ADMIN** (blind MED): seed всегда создаёт ADMIN; при удалении — FK-ошибка громкая, не тихий over-grant. Низкосигнально.
- **unmapped-action → generic 403 без лога (недиагностируемо)** (blind/edge): покрыто patch P1 (OPTIONS/PUT-DELETE — основные источники); для забытого реального @action fail-closed 403 + matrix-completeness ловит на ревью. Лог-строка — минор.
- **dead `_DeferredGate`/PENDING-ветки + `_MethodGate` case-lookup** (edge LOW, blind LOW): `_DeferredGate` оставлен намеренно (будущие deferred-роуты, zero impact); `_MethodGate` lookup на lower-key, а matrix итерирует lowercase-SERVED → латентно, не баг.
