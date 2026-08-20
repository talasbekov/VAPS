---
baseline_commit: 665856851e7e66d65bf723af14d93cdda9e92d72
---
# Story 2.9: RBAC-матрица роль×операция — сквозной gate-тест авторизации

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

> **Это тест/gate-стори, НЕ feature-стори.** Данные матрицы роль→право уже существуют (seed `seed_operations`: 8 ролей / 17 прав; `PermissionService` реализован в 2.1). Exhaustive-анализ кода (create-story, 2026-06-23) подтвердил: deliverable 2.9 = **параметризованный сквозной тест «роль × endpoint → разрешено/запрещено»**, который (а) перечисляет ВСЕ зарегистрированные API-роуты, (б) требует явных ожиданий для 8 ролей + анонима по каждому, (в) роняет ревью, если появился роут без строки в матрице (AR-9). Плюс закрывается **forward-guard, отложенный из ревью 2.8**: «бизнес-эндпоинты не консультируют Django `has_perm`/`is_staff`» (deferred-work.md#L209). **Ни одного кодового файла приложения не меняется — стори чисто аддитивная (новые тесты).**
>
> **⚠️ Центральное открытие анализа (читать до старта):** ВСЕ эндпоинты `api/core/` (employees/divisions/positions/ranks/staffing-slots/vacancies) **сейчас не загейчены вообще** — ни одного `require_permission` в `apps/core/api/views.py`. Загейчены только `api/operations/`. Матрица обязана покрыть и core (AC «все зарегистрированные роуты»), но **2.9 НЕ чинит гейты core** (это отдельные стори) — она их **честно фиксирует как known-gap с указателем на стори-фикс** (см. Dev Notes → «Решение по незагейченным core-роутам»).

## Story

As a аудитор безопасности,
I want параметризованный сквозной тест матрицы «роль × endpoint → разрешено/запрещено», который проверяет каждый зарегистрированный API-роут против 8 ролей + анонима и падает, если появился роут без явной строки в матрице,
so that новый endpoint без записи в матрице не проходит ревью, а граница «авторизация = только in-house `PermissionService`, Django-permissions не консультируются бизнес-кодом» зафиксирована тестом (AR-9; FR-33; решение по реанимации Django-auth из 2.8).

## Acceptance Criteria

1. **Completeness-gate (буквальный AC эпика).** **Given** корневой URLconf со всеми зарегистрированными API-роутами (core + operations), **When** прогоняю матричный тест, **Then** каждая конкретная пара (роут, HTTP-метод) имеет явную строку в декларативной RBAC-матрице теста; **And** зарегистрированная пара без строки → тест **красный**; **And** «протухшая» строка матрицы для несуществующего роута → тест **красный**. *(epics.md#L468 «роут вне матрицы = красный тест»; AR-9.)*

2. **Per-actor ожидания.** **Given** каждый **загейченный** роут (operations), **When** прогоняю поведенческий тест, параметризованный по 8 ролям + аноним (9 акторов), **Then** фактический ответ совпадает с задекларированным ожиданием: `ALLOW` = страж не падает (не 403); `DENY` = `403 PERMISSION_DENIED`. Источник истины для вывода ожиданий — посев `seed_operations` (8 ролей/17 прав).

3. **Ground-truth для operations.** **Given** admin-эндпоинты operations (`roles/`, `permissions/`, `user-roles/`, `temporary-duty/` — все за `require_permission("admin.roles")`), **When** тестирую, **Then** `ALLOW` только для `ADMIN` (держит `*`), `DENY` для остальных 7 ролей и анонима; **And** `my-permissions/` (любой аутентифицированный `actor_id`) — `ALLOW` для всех 8 ролей, `DENY` для анонима.

4. **Честная фиксация незагейченных core-роутов.** **Given** core-роуты без `require_permission` (employees/divisions/positions/ranks/staffing-slots/vacancies), **When** матрица их декларирует, **Then** каждый помечен явной строкой-маркером **deferred-gate** с указателем на стори/запись фикса; **And** инвариант «аноним должен получать `DENY`» закодирован как `pytest.mark.xfail(strict=True, reason=...)` — суммарно: набор зелёный, разрыв виден и **сам перевернётся** (xpass → strict-failure) когда гейт появится; **And** ни один core-роут не помечен «публичный by-design» молча.

5. **Boundary-guard (forward-guard из ревью 2.8).** **Given** бизнес-слои (`apps/operations/**`, `apps/core/api/**`, `apps/core/services*`, `apps/core/selectors*`), **When** guard-тест сканирует их исходники, **Then** ни один не консультирует Django-auth: запрещены `request.user`, `.has_perm(`, `.has_module_perms(`, `.is_staff`, `.is_superuser`; **And** допустимо только в `apps/core/auth/**`, определении модели `User` (`apps/core/models.py`), миграциях и будущих `admin.py`. *(deferred-work.md#L209; граница 2.8.)*

6. **Гейт, без миграции.** **Given** стори ничего не меняет в моделях, **When** `make gate` (Postgres :5433), **Then** `ruff check .` чист (E/F), pytest зелёный (+новые тесты), `makemigrations --check --dry-run` → «No changes detected» (новой миграции **нет**), бюджет < 300с (NFR-8). **Артефакты НЕ коммитить** (за Bratan; прецедент 2.4–2.8).

## Tasks / Subtasks

- [x] **Задача 1. Интроспекция роутов из резолвера (AC: 1)**
  - [x] В новом `apps/operations/tests/test_rbac_matrix.py` написать хелпер, обходящий `django.urls.get_resolver()` (корневой URLconf), собирающий все конкретные пары `(endpoint_id, http_method)`. Для DRF-ViewSet брать `pattern.callback.cls` + `pattern.callback.actions` (mapping `http_method → handler`), для `@action` — их методы (`assign-employee`/`release`/`archive`/`restore`/`expire`/`leaf-descendants`).
  - [x] **Канонизация (gotcha):** отфильтровать format-suffix паттерны (`\.<format>`/`format=`) и DRF api-root, дедуплицировать. Идентификатор роута — стабильный (basename + suffix действия + метод), чтобы матрица читалась.
  - [x] Утвердить итог против ground-truth-таблицы в Dev Notes (ожидаемый перечень роутов) — это «золотое» число для самопроверки completeness-теста.
- [x] **Задача 2. Декларативная RBAC-матрица (AC: 1,3,4)**
  - [x] Объявить в том же модуле явную структуру `MATRIX` — по строке на `(endpoint_id, method)`. Рекомендованная форма строки — guard-спека, детерминированно разворачиваемая в 9-акторную сетку (см. Dev Notes → код-скетч): `Gate("admin.roles")` | `AnyAuthenticated()` | `DeferredGate(fix_ref=...)`.
  - [x] **operations (ENFORCED):** все admin-роуты → `Gate("admin.roles")`; `my-permissions` → `AnyAuthenticated()`.
  - [x] **core (DEFERRED-GATE):** каждый core-роут → `DeferredGate(fix_ref="...")` с реальным указателем на **стори 2.13 «Гейт прав на core API эндпоинты»** (заведена в backlog 2026-06-23 — единый дом фикса core-гейтинга); для `assign-employee`/маскирования допустимо добавить точечную ссылку deferred-work.md#L25/#L12.
  - [x] Сделать `MATRIX` явно «живым реестром»: комментарий-шапка «новый endpoint ⇒ строка здесь, иначе AR-9 красный» (epics.md#L729: новые permission-коды добавляются в `seed_operations` + строкой в матрицу 2.9).
- [x] **Задача 3. Completeness-тест (AC: 1)**
  - [x] Тест: `set(resolved_routes) == set(MATRIX.keys())`. Симметрично: непокрытый роут → fail; протухшая строка → fail. Сообщение об ошибке должно печатать diff (что добавить/удалить), чтобы будущий dev сразу понял.
- [x] **Задача 4. Поведенческий per-actor тест (AC: 2,3,4)**
  - [x] `pytestmark = pytest.mark.django_db`; в setup — `call_command("seed_operations")` (санкционированное исключение из «seed в тестах запрещён», обоснование в Dev Notes), затем по одному `UserRole.objects.create(user_id="<role>-user", role_code_id="<ROLE>")` на каждую из 8 ролей (прецедент `test_api_permissions.py::test_require_permission_allows_admin`). Аноним = запрос без `HTTP_X_USER_ID`.
  - [x] Параметризовать по строкам матрицы × 9 акторов. DRF `APIClient`, `client.credentials(HTTP_X_USER_ID="<actor>")`. Проверять **deny-path** на 403 (стабильно без валидного payload: `require_permission` вызывается ПЕРВЫМ, до `get_object`/сериализации — для detail-роутов годится dummy-pk, см. Dev Notes); `ALLOW` = ответ ≠ 403.
  - [x] Для `DeferredGate`-строк: ассерт «аноним → 403» обернуть `pytest.mark.xfail(strict=True, reason=fix_ref)`. 8 ролевых ячеек core помечать `pending`/skip с указателем (политика per-role не определена до стори-гейта) — НЕ выдумывать коды прав для core.
- [x] **Задача 5. Boundary-guard тест (AC: 5)**
  - [x] Новый `apps/operations/tests/test_authz_boundary.py` (или секция в matrix-файле): сканировать исходники бизнес-слоёв на запрещённые токены Django-auth (`request.user`, `.has_perm(`, `.has_module_perms(`, `.is_staff`, `.is_superuser`). Прецедент аппарата — AST/исходный скан в `apps/operations/tests/test_isolation.py` и `apps/core/tests/test_isolation.py` (`test_x_user_id_literal_only_in_core_auth`, `test_no_wall_clock_reads_in_domain_layers`).
  - [x] Whitelist: `apps/core/auth/**`, `apps/core/models.py` (легитимные поля `is_staff`/`is_superuser` из `PermissionsMixin`), `migrations/**`, любые `admin.py` (появятся в 2.10+). Скан целить в `api/`/`services`/`selectors`/`permissions`, НЕ в `models.py`/миграции.
- [x] **Задача 6. Гейт (AC: 6)**
  - [x] `make gate` (Postgres :5433): `ruff check .` чист, pytest зелёный (новые тесты + нулевая регрессия 15 существующих RBAC-тестов), `makemigrations --check` «No changes detected» (миграции НЕТ). Бюджет < 300с. **Артефакты НЕ коммитить.**

## Dev Notes

### Что именно надо построить (и чего НЕ надо)

2.9 — **сквозной gate-тест**, а не новая бизнес-логика. Роль→право матрица уже **данные** в `ops_role_permissions`, посеянные `seed_operations` (DB-OPS-001). `PermissionService.has_permission(user_id, permission_code, division_id=None)` и стражи `require_permission(...)` уже работают (2.1). Архитектура (architecture.md#L632) предписывает ровно одно: **параметризованный тест роль×операция, где новый endpoint без строки не проходит ревью**. Никакого in-memory «матричного объекта» в проде заводить НЕ нужно — матрица живёт как данные + как декларация ожиданий в тесте.

### Ground-truth: полный инвентарь роутов (золотое число для completeness-теста)

Сейчас зарегистрированы только DRF API-роуты (`config/urls.py`: `api/core/` + `api/operations/`; Django `admin/` ещё НЕ смонтирован — придёт в 2.10). Перечень ниже — что обязан вернуть резолвер; матричные строки кросс-сверяются с ним.

**`api/operations/` — ENFORCED (страж `require_permission`):**

| endpoint | путь | методы | guard | ALLOW | DENY |
|---|---|---|---|---|---|
| ops-role | `roles/` | GET (list) | `admin.roles` | ADMIN | 7 ролей + аноним |
| ops-role | `roles/{pk}/` | GET (retrieve) | `admin.roles` | ADMIN | 7 + аноним |
| ops-permission | `permissions/` | GET (list) | `admin.roles` | ADMIN | 7 + аноним |
| ops-permission | `permissions/{pk}/` | GET (retrieve) | `admin.roles` | ADMIN | 7 + аноним |
| ops-user-role | `user-roles/` | GET (list), POST (create) | `admin.roles` | ADMIN | 7 + аноним |
| ops-user-role | `user-roles/{pk}/` | DELETE (destroy) | `admin.roles` | ADMIN | 7 + аноним |
| ops-temp-duty | `temporary-duty/` | GET (list), POST (create) | `admin.roles` | ADMIN | 7 + аноним |
| ops-temp-duty | `temporary-duty/{pk}/expire/` | POST (action) | `admin.roles` | ADMIN | 7 + аноним |
| ops-my-permissions | `my-permissions/` | GET (list) | any-authenticated | все 8 ролей | аноним |

> **Почему только ADMIN на admin-роутах:** `admin.roles` держит лишь роль `ADMIN` — через wildcard `*` (`ROLE_PERMISSIONS["ADMIN"] = ["*"]`). `PermissionService.has_permission` короткозамыкает на `*`. Остальные 7 ролей `admin.roles` не имеют → 403.
> **`my-permissions`:** `MyPermissionsViewSet.list` проверяет только наличие `request.actor_id` (не право) → любой валидный `X-User-Id` проходит (даже у юзера без ролей); аноним → 403.

**`api/core/` — DEFERRED-GATE (страж ОТСУТСТВУЕТ, см. решение ниже):**

| endpoint | путь | методы (по `http_method_names`) |
|---|---|---|
| employee | `employees/` | GET (list), POST (create) |
| employee | `employees/{pk}/` | GET (retrieve), PATCH (partial_update) |
| employee | `employees/{pk}/archive/` | POST |
| employee | `employees/{pk}/restore/` | POST |
| division | `divisions/` | GET, POST |
| division | `divisions/{pk}/` | GET, PUT, PATCH, DELETE *(полный ModelViewSet — без `http_method_names`)* |
| division | `divisions/{pk}/leaf-descendants/` | GET |
| position | `positions/` | GET, POST |
| position | `positions/{pk}/` | GET, PATCH |
| rank | `ranks/` | GET, POST |
| rank | `ranks/{pk}/` | GET, PATCH |
| staffing-slot | `staffing-slots/` | GET, POST |
| staffing-slot | `staffing-slots/{pk}/` | GET, PATCH |
| staffing-slot | `staffing-slots/{pk}/assign-employee/` | POST *(deferred-work.md#L25: гейт в E2)* |
| staffing-slot | `staffing-slots/{pk}/release/` | POST |
| vacancy | `vacancies/` | GET (list) |

> `EmployeeViewSet.http_method_names = ["get","patch","post"]` (нет PUT/DELETE). `Position/Rank/StaffingSlot` → `["get","post","patch"]`. `Division` — полный `ModelViewSet`. `Vacancy` — голый `ViewSet` только с `list`.
> **Дериви инвентарь программно из резолвера**, не хардкодь таблицу: её роль — золотое число самопроверки. Матричные строки декларируются вручную (это ожидания), completeness-тест сверяет «декларировано == резолвед».

### 🔑 Решение по незагейченным core-роутам (центральная развилка — default, требует подтверждения Bratan)

AC эпика буквально требует «все зарегистрированные роуты». Но весь `api/core/` сейчас публичен (ни одного `require_permission`). Варианты и принятый по умолчанию:

- ❌ Чинить гейты core внутри 2.9 — раздувает стори (mix теста и гейтинга, >5 файлов, чужая ответственность). Нарушает твои decomposition-правила.
- ❌ Исключить core из матрицы — нарушает букву AC и убивает ценность (главный смысл — ловить именно незагейченные роуты).
- ✅ **DEFERRED-GATE (default, утверждён Bratan 2026-06-23):** матрица содержит строку на КАЖДЫЙ роут (completeness ✓); core-строки — явные маркеры `DeferredGate(fix_ref=...)` с указателем на **стори 2.13**; инвариант «аноним → DENY» закодирован `xfail(strict=True)`. Набор зелёный, разрыв виден и трекается, маркер сам перевернётся, когда гейт появится. Per-role политика для core (какое право на какой роут) **не выдумывается** — она решается в стори-гейте 2.13.

**Разрешено (Bratan, 2026-06-23):** заведена выделенная стори **2.13 «Гейт прав на core API эндпоинты»** (backlog, Epic 2) — единый дом фикса core-гейтинга. `fix_ref` всех `DeferredGate`-строк указывает на 2.13 (deferred-work.md#L25 `assign-employee`, #L12 маскирование, #L26 NULL-scope гонка — входят в её скоуп). Полный файл 2.13 будет создан через `create-story`, когда её вытащат (контекст уже в deferred-work.md).

### Существующий аппарат — переиспользовать, не изобретать

- **Стражи/идентичность:** `apps/operations/api/permissions.py::require_permission(request, code, division_id=None)` → `PermissionDenied("PERMISSION_DENIED")` (=403); идентичность `request.actor_id` ставит `apps/core/auth/authentication.py::XUserIdAuthentication` из `X-User-Id`. Бизнес-код берёт actor из `request.actor_id`, НЕ из payload (ARCH-SEC-030).
- **Сервис:** `apps/operations/services.py::PermissionService.{has_permission, effective_permissions}` (stateless, без кэша; `*` короткозамыкает; scope через `CoreDivisionTreeSelector`; temp-duty по окну `Clock.now()`).
- **Посев:** `apps/operations/management/commands/seed_operations.py` — 8 ролей, 17 прав, `ROLE_PERMISSIONS` (ADMIN=`*`; OMD/SENIOR_COORDINATOR/APPROVER/DIVISION_OPERATOR/ORGD/VIEWER/INTEGRATION_USER — конкретные наборы).
- **Прецедент теста авторизации:** `apps/operations/tests/test_api_permissions.py` (паттерн `_authenticated_request`, `UserRole.objects.create(user_id=..., role_code_id="ADMIN")`, `client.credentials(HTTP_X_USER_ID=...)` в `test_roles_api.py`/`test_user_roles_api.py`/`test_temp_duty_api.py`).
- **Прецедент source/AST-скан-гарда:** `apps/operations/tests/test_isolation.py` (operations ↛ `apps.core.models`); `apps/core/tests/test_isolation.py::test_x_user_id_literal_only_in_core_auth` и `::test_no_wall_clock_reads_in_domain_layers` — копировать форму для boundary-guard (Задача 5).

### Рекомендованная форма матрицы (скетч — не обязателен буквально)

```python
# apps/operations/tests/test_rbac_matrix.py
# ЖИВОЙ РЕЕСТР: новый endpoint ⇒ строка здесь, иначе completeness-тест красный (AR-9).
ROLES = ["ADMIN","ORGD","OMD","SENIOR_COORDINATOR","APPROVER",
         "DIVISION_OPERATOR","VIEWER","INTEGRATION_USER"]  # + аноним отдельно

class Gate:            # требует право: ALLOW тем ролям, у кого оно есть (по seed), аноним DENY
    def __init__(self, code): self.code = code
class AnyAuthenticated: ...      # ALLOW любой actor_id, аноним DENY
class DeferredGate:              # core: гейт ещё не реализован
    def __init__(self, fix_ref): self.fix_ref = fix_ref

MATRIX = {
    ("ops-role", "GET"):            Gate("admin.roles"),
    ("ops-my-permissions", "GET"):  AnyAuthenticated(),
    # ... все operations ...
    ("employee-list", "GET"):       DeferredGate("story 2.13 (гейт прав core API)"),
    ("staffing-slot-assign-employee", "POST"): DeferredGate("story 2.13; deferred-work.md#L25"),
    # ... все core ...
}
```
`Gate.code` → разворачивается в 9-акторную сетку через `PermissionService.has_permission`/посев (явные ожидания без ручного дублирования 9 ячеек). Это удовлетворяет «явные ожидания для 8 ролей + анонима», оставаясь DRY и читаемым.

### Gotchas (ловушки, на которых легко споткнуться)

- **AST-граница operations ↛ core.models:** matrix-тест лежит в `apps/operations/tests/`. `test_isolation.py` запретит импорт `apps.core.models` отсюда. Роуты бери из резолвера (`django.urls`), запросы — через `APIClient`/`reverse(...)`; **НЕ импортируй core-модели**. `UserRole`/`Role` из `apps.operations.rbac.models` — можно.
- **Detail-роуты без реального объекта:** для ENFORCED-роутов `require_permission` вызывается ПЕРВЫМ (до `get_object`) — `roles/{pk}/`, `user-roles/{pk}/` DELETE, `temporary-duty/{pk}/expire/` дают 403 на dummy-pk без создания объекта. Для core (deferred) detail-роут аноним даст 404/200 ≠ 403 → ассерт-deny корректно уходит в `xfail`.
- **DRF format-suffix и api-root:** резолвер вернёт `.json`-варианты и корневой роут — отфильтровать, иначе completeness-тест распухнет ложными строками.
- **«Seed в тестах запрещён» (architecture.md#L437):** общий канон — фабрики `factory_boy`. **2.9 — санкционированное исключение:** тест проверяет именно РЕАЛЬНЫЙ посев (`seed_operations` = источник истины матрицы, epics.md#L729), а не выдуманную фабриками копию. Весь существующий RBAC-suite (15 файлов) уже грузит `call_command("seed_operations")` — следуй ему. Зафиксируй это решение комментарием в тесте.
- **DomainError ещё нет (придёт в 3.1):** работаем с существующим `PermissionDenied("PERMISSION_DENIED")` → 403. НЕ вводить `DomainError`/единый handler здесь (2.5 уже отложила это в 3.1).
- **Будущий `admin/` (2.10):** когда смонтируют Django Admin — это ДРУГАЯ ось авторизации (Django `is_staff`/superuser, не `PermissionService`). Матрица `PermissionService` должна **явно исключить** `admin/`-роуты (с комментарием), а не молча проглотить. Сейчас `admin/` не смонтирован — задел на будущее.
- **`xfail(strict=True)` самоперевор:** если core-роут вдруг начнёт возвращать 403 анониму (гейт появился) — xpass под strict уронит тест и заставит снять маркер. Это фича, не баг: матрица сама требует обновления при появлении гейта.

### Граница: Django-auth ТОЛЬКО для admin, бизнес-RBAC = `PermissionService` (хвост 2.8)

2.8 включила `PermissionsMixin` на `User` (живые `has_perm`/`is_staff`/`is_superuser` app-wide) ради будущего Admin (2.10). Риск forward-looking (ревью 2.8 → defer): код, ошибочно вызвавший `request.user.has_perm(...)`, молча консультирует Django вместо in-house RBAC. **Boundary-guard теста 2.9 (Задача 5) — естественный дом этой фиксации** (deferred-work.md#L209). Граница: `is_staff`/`is_superuser` легитимны ТОЛЬКО в определении `User` (`core/models.py`) и admin-поверхности (2.10+); бизнес-слой (api/services/selectors) их не трогает (ARCH-SEC-031: авторизация — только `PermissionService`).

### Project Structure Notes

- **Создать:** `Backend/VAPS/apps/operations/tests/test_rbac_matrix.py` (интроспекция + матрица + completeness + per-actor), `Backend/VAPS/apps/operations/tests/test_authz_boundary.py` (Django-auth guard). 2 файла, один слой (тесты), одна ответственность (сквозная верификация авторизации), независимо тестируема и откатываема (чисто аддитивно).
- **Изменить (код приложения):** НИЧЕГО. (+BMAD-трекинг: `sprint-status.yaml`, этот файл.) Миграции НЕТ (моделей не трогаем) → `makemigrations --check` обязан остаться «No changes detected».
- **НЕ трогать:** любой `views.py`/`permissions.py`/`urls.py` (добавление гейтов core = отдельные стори); `seed_operations.py`; `PermissionService`; `XUserIdAuthentication`; маскирование/`X-User-Permissions`.

### Out of Scope (НЕ реализовывать в 2.9)

- **Добавление `require_permission`-гейтов на core-эндпоинты** (employees/divisions/positions/ranks/staffing-slots/vacancies, в т.ч. `assign-employee` deferred-work.md#L25) → **стори 2.13** (заведена в backlog); в 2.9 только фиксируются как `DeferredGate` + `xfail`.
- **Перенос маскирования** с клиентского `X-User-Permissions` на `PermissionService` (deferred-work.md#L12) → отдельно.
- **Фикс NULL-scope unique-constraint гонки** в `RoleAdminService.assign_role` (deferred-work.md#L26) → кандидат отдельной стори.
- **Привязка `object.manage`/`event.manage`/`duty.manage` к ролям** и Role-строки для `HQ_DUTY`/`OBJECT_SENIOR_DUTY` → feature-стори E14–E18.
- **Scope/subtree-поведение** (своё ли подразделение) — уже покрыто `test_permission_scope.py`; матрица тестирует ГРУБЫЙ слой роль×endpoint (architecture.md#L450), не scope.
- **DomainError / единый exception-handler** → 3.1.
- **Django Admin / `admin/`-роуты** → 2.10 (другая ось авторизации; матрица их явно исключает).

### References

- [Source: _bmad-output/planning-artifacts/epics.md#L464-470] — Story 2.9 (user story + AC «8 ролей + аноним; роут вне матрицы = красный»); [#L111] AR-9 (обязательный сквозной тест RBAC-матрицы); [#L729] матрица как живой реестр для новых permission-кодов; [#L294] аноним к защищённому endpoint → 403.
- [Source: _bmad-output/planning-artifacts/architecture.md#L632] — нормативное предписание параметризованной RBAC-матрицы; [#L450-451] Permission-класс = грубая проверка роли/действия, scope — в сервисе; [#L315-316,754-755] ARCH-SEC-030/031 (единая точка идентичности; авторизация только PermissionService, без кэша); [#L126] RBAC-слайс (8 ролей/17 прав); [#L437-439] тест-стандарты (seed в тестах запрещён — см. санкционированное исключение); [#L636] make gate.
- [Source: docs/superpowers/specs/2026-06-08-operations-rbac-design.md#L98-156] — каноничная матрица роль→право (§4), `PermissionService` (§5), HTTP-поверхность с per-endpoint стражами (§6).
- [Source: Backend/VAPS/apps/operations/api/views.py] — стражи `require_permission("admin.roles")` на всех admin-роутах; `MyPermissionsViewSet` = any-authenticated; [api/permissions.py] `require_permission`; [api/urls.py] basenames `ops-*`.
- [Source: Backend/VAPS/apps/core/api/views.py + urls.py] — **незагейченные** core-роуты (нет `require_permission`); `assign_employee` явно без гейта (комментарий `:137-139`); маскирование на клиентском `X-User-Permissions` (`:25-27`).
- [Source: Backend/VAPS/apps/operations/management/commands/seed_operations.py] — 8 ролей / 17 прав / `ROLE_PERMISSIONS` (ADMIN=`*`).
- [Source: Backend/VAPS/apps/operations/tests/test_api_permissions.py + test_isolation.py; apps/core/tests/test_isolation.py] — прецеденты паттерна авторизац. теста и source/AST-guard.
- [Source: _bmad-output/implementation-artifacts/deferred-work.md#L12,L25-27,L209] — отложенные пункты: маскирование→PermissionService (E2/2.9), `assign-employee` гейт (E2), NULL-scope гонка (E2/2.9), **PermissionsMixin design-hazard → boundary-guard в 2.9** (основной хвост).
- [Source: _bmad-output/implementation-artifacts/2-8-admin-для-справочников.md#L50-52,L90,L170] — граница «Django-permissions только для admin»; RBAC-модели → область 2.9; forward-guard отложен в 2.9.
- [Source: _bmad-output/implementation-artifacts/2-1-...rbac...md] — `PermissionService`/`RoleAdminService` остались в `apps/operations/services.py`; модели в `apps/operations/rbac/models.py`; гейт = доказательство AC.
- [Source: Backend/VAPS/Makefile] — `make gate` (Postgres :5433, ruff + pytest «not property/concurrency/slow» + makemigrations --check), бюджет < 300с (NFR-8).

## Dev Agent Record

### Agent Model Used

Opus 4.8 (claude-opus-4-8[1m]), bmad-dev-story, 2026-06-23. baseline_commit `6658568`.

### Debug Log References

- **Интроспекция роутов (эмпирически, не по докам DRF):** `manage.py`-шелл-дамп `get_resolver()` → подтвердил 25 served-роутов. Ключевой нюанс: роутер кладёт в `callback.actions` ПОЛНЫЙ маппинг ViewSet (например `employee-detail` → get/put/patch/delete), а `http_method_names` режет на dispatch (405). Поэтому served = `actions ∩ cls.http_method_names` → `employee-detail` реально get/patch (put/delete = 405, вне матрицы). Format-suffix варианты (`\.(?P<format>...)`) делят один `name` → дедуп по `(name, method)`; `api-root` (actions=None) исключён.
- **Деривация ALLOW из посева:** держатели права берутся из `seed_operations.ROLE_PERMISSIONS` на этапе сборки параметров (без БД) — матрица в синхроне с seed (AC-2). Только `ADMIN` держит `admin.roles` (через `*`).
- **Поведенческая проба без payload:** `APIClient(raise_request_exception=False)` — ALLOW-проба POST/DELETE может упасть в бизнес-логике (KeyError/UUID-cast), но нам важен лишь слой авторизации (`require_permission` зовётся ПЕРВЫМ, до `get_object`/сериализации) → ассерт `≠403`. DENY-проба не требует payload (страж роняет 403 раньше). Detail-роуты — dummy-pk `"0"` через `reverse(name, kwargs={"pk":"0"})` с fallback на `reverse(name)`.
- **Discriminating power (RED-эквивалент для тест-стори) ВЕРИФИЦИРОВАН вживую:** (1) удалил строку `ops-role-list` из `MATRIX` → `test_matrix_covers_every_registered_route` КРАСНЫЙ («роуты без строки в MATRIX»); (2) добавил `ghost-route` → КРАСНЫЙ («протухшие строки»); восстановил → ЗЕЛЁНЫЙ; 25 served == 25 MATRIX. Это и есть AR-9 «роут вне матрицы = красный тест».
- **`xfail(strict=True)` самоперевор ПРОВЕРЕН в этом repo-конфиге:** throwaway-проба (xfail+`assert True`) → `XPASS(strict)` → `FAILED`. Значит, когда core-гейт появится (аноним→403), strict-xfail упадёт и заставит снять маркер (стори 2.13). 28 core-anon ячеек сейчас xfail (core не загейчен).
- **Boundary-guard зелёный:** grep бизнес-слоёв на `request.user`/`.has_perm(`/`.has_module_perms(`/`.is_staff`/`.is_superuser` (operations + core api/services/selectors, минус core/models.py и core/auth/) → 0 совпадений. AST-скан подтвердил.
- **Полный `make gate`** (Postgres :5433, docker `vaps-db-1`): **536 passed (+106), 18 deselected, 28 xfailed**; `ruff check .` чист (E/F); `makemigrations --check` → «No changes detected» (моделей не трогали, миграции нет); 10s (бюджет NFR-8 = 300s). Нулевая регрессия (15 существующих RBAC-тестов + весь suite зелёные).

### Completion Notes List

- **Deliverable = 2 аддитивных тест-файла, ноль правок кода приложения, без миграции** (как и проектировалось — тест/gate-стори).
- **`test_rbac_matrix.py`:** интроспекция served-роутов из резолвера (`actions ∩ http_method_names`, дедуп format-suffix, без `api-root`); декларативная `MATRIX` (25 строк) с тремя видами стражей (`_Gate(code)` / `_AnyAuthenticated` / `_DeferredGate(fix_ref)`); completeness-gate (missing/stale → красный); структурные тесты (явные ожидания для 9 акторов, 8 ролей + аноним); ground-truth operations (admin-only + my-permissions); поведенческая параметризация роль×endpoint×актор. 99 operations-проб (вживую) + 28 core-anon (`xfail(strict)`), core per-role политика = `PENDING` → стори 2.13 (декларирована в данных, не исполняется).
- **`test_authz_boundary.py`:** AST-скан бизнес-слоёв (operations + core api/services/selectors) на консультацию Django-auth (`has_perm`/`has_module_perms`/`is_staff`/`is_superuser`/`request.user`); whitelist `core/models.py` (легит. `is_staff`/`is_superuser` из `PermissionsMixin`) и `core/auth/` (контракт X-User-Id). Закрыт forward-guard, отложенный из ревью 2.8 (deferred-work.md#L209).
- **Решение Bratan по core:** все `_DeferredGate.fix_ref` указывают на стори **2.13** (заведена в backlog). 2.9 не чинит незагейченные core-роуты — честно фиксирует + трекает через strict-xfail.
- **DomainError не вводился** (придёт в 3.1): работаем с существующим `PermissionDenied("PERMISSION_DENIED")` → 403.
- **Артефакты НЕ закоммичены агентом** (за Bratan; прецедент 2.4–2.8). Status → review (dev не само-промоутит в done; ревью желательно другой моделью).

### File List

**To Create** — сделано
- `Backend/VAPS/apps/operations/tests/test_rbac_matrix.py`
- `Backend/VAPS/apps/operations/tests/test_authz_boundary.py`

**To Modify (код приложения)** — НЕТ (стори чисто аддитивная; миграции нет)
- _(BMAD-трекинг: `sprint-status.yaml`, этот файл)_

## Change Log

| Дата | Изменение |
|------|-----------|
| 2026-06-23 | Создана история 2.9 (bmad-create-story, Opus 4.8): сквозной gate-тест RBAC-матрицы роль×endpoint (AR-9) + boundary-guard (хвост 2.8). Exhaustive-анализ вскрыл: данные матрицы уже посеяны (8 ролей/17 прав), deliverable = параметризованный тест; центральная развилка — весь `api/core/` сейчас не загейчен → default DEFERRED-GATE (`xfail(strict)` + указатель), core-гейтинг вне scope. Стори чисто аддитивная (2 тест-файла, без миграции). Status → ready-for-dev. |
| 2026-06-23 | Решение Bratan (AskUserQuestion): core-гейтинг выносится в выделенную стори **2.13 «Гейт прав на core API эндпоинты»** (заведена в backlog, Epic 2). `fix_ref` всех `DeferredGate`-строк 2.9 указывает на 2.13. |
| 2026-06-23 | Dev (bmad-dev-story, Opus 4.8): реализованы 2 аддитивных тест-файла (`test_rbac_matrix.py` — сквозной gate-тест роль×endpoint, completeness + 99 поведенческих проб operations + 28 core-anon `xfail(strict)`; `test_authz_boundary.py` — AST-guard Django-auth, хвост 2.8). Ноль правок кода приложения, без миграции. Discriminating power верифицирована вживую (missing/stale-строка → красный; strict-xfail self-flip → XPASS=FAILED). `make gate` зелёный (Postgres :5433: **536 passed +106, 28 xfailed**; ruff чист; makemigrations «No changes detected»; 10s). Артефакты НЕ закоммичены агентом. Status → review. |
| 2026-06-23 | Code-review (bmad-code-review, Opus 4.8 — same-model caveat; 3 слоя: Blind Hunter / Edge Case Hunter / Acceptance Auditor; scoped diff 384 строки по 2 новым тест-файлам). Acceptance Auditor: **ACCEPT** — AC-1..6 SATISFIED вживую (completeness red-on-missing/stale; strict-xfail self-flip; boundary red-on-violation; out-of-scope чист; цифры DAR воспроизведены). 0 decision · 3 patch · 3 defer · 4 dismiss. См. ## Review Findings. |
| 2026-06-23 | Применены 3 патча ревью: P1 покрытие plain `APIView` в `_served_routes` (`actions is None` + `cls` → хендлеры ∩ `http_method_names`; верифицировано: ProbeView → {get,post} детектится, раньше пропуск мимо AR-9); P2 ALLOW-ассерт `not in (401,403)` + комментарий про 5xx-on-create; P3 анти-вакуум guard'ы (`assert SERVED`/непустые params + непустой boundary-скан с operations). SERVED неизменно 25 (ViewSet'ы), +1 тест `test_introspection_is_not_vacuous`. `make gate` зелёный (Postgres :5433: **537 passed +1, 28 xfailed**; ruff чист; makemigrations «No changes detected»; 10s). 3 defer → deferred-work.md. Артефакты НЕ закоммичены агентом. Status → done. |

## Review Findings

_Code-review (bmad-code-review, 2026-06-23, Opus 4.8 — same-model caveat: ревью той же моделью, что писала реализацию; 3 адверсариальных слоя; scoped diff 384 строки по 2 новым тест-файлам). Acceptance Auditor: ACCEPT — все 6 AC SATISFIED, верифицировано вживую (удаление/добавление строки MATRIX → красный; strict-xfail self-flip → XPASS=FAILED; подсадка `request.user.has_perm` → boundary красный). Edge Case Hunter (с доступом к коду) опроверг ряд находок Blind Hunter (интроспекция корректна, `_url_for` резолвит все 25, DENY-страж до object-lookup, `_Gate`==`has_permission`, не вакуумно). 0 decision · 3 patch · 3 defer · 4 dismiss._

### Patches

- [x] [Review][Patch] Покрыть plain `APIView` в интроспекции роутов [test_rbac_matrix.py:_served_routes] — `_served_routes` берёт только callback с `actions` (router-ViewSet'ы); обычный `APIView`/`GenericAPIView` (штатный DRF-паттерн) реально достижим по HTTP, но молча выпадет из MATRIX → роут проскользнёт мимо AR-9 (сама цель gate'а). Латентно (сейчас все вью — ViewSet'ы). Фикс: при `actions is None` и наличии `cls` — методы из `http_method_names ∩ определённые хендлеры (get/post/put/patch/delete)`. (edge HIGH)
- [x] [Review][Patch] Ужесточить ALLOW-ассерт [test_rbac_matrix.py:test_rbac_matrix_behaviour] — ALLOW = «≠403» засчитывает 401 как доступ → `assert status not in (401, 403)`; зафиксировать комментарием, что 5xx на payloadless-create = «авторизация пройдена» (страж до KeyError; снятие стража ловится DENY-ячейками: роль без права → 500≠403 → красный). (blind MED + edge MED)
- [x] [Review][Patch] Анти-вакуум guard'ы [test_rbac_matrix.py, test_authz_boundary.py] — `assert SERVED`/непустой behavioral-набор + в `test_guard_excludes_legitimate_django_auth_sites` `assert scanned` непуст и содержит operations-файл; иначе при поломке путей оба гейта зеленеют вакуумно. (blind LOW)

### Deferred

- [x] [Review][Defer] completeness сверяет имена роутов, а не пары (name, method) [test_rbac_matrix.py:test_matrix_covers_every_registered_route] — новый метод на существующем имени не флагается completeness'ом (но ловится поведенчески DENY-ячейками, пока методы роута делят один guard). Ключевать MATRIX по (name, method) когда появятся роуты со смешанной по-методной политикой. — deferred (поведение уже method-granular)
- [x] [Review][Defer] _url_for угадывает pk по NoReverseMatch [test_rbac_matrix.py:_url_for] — хрупко к кастомным роутерам / `lookup_url_kwarg`≠pk и к совпадению list/detail имён; сейчас все 25 роутов резолвятся корректно (верифицировано Edge). — deferred (латентно)
- [x] [Review][Defer] boundary AST слеп к алиасам request / getattr-строкам [test_authz_boundary.py:_violations] — ловит прямой `request.user`/`*.request.user` + 4 forbidden-attr, но не `r=request; r.user` / `getattr(u,"is_staff")`; прецедент — эвристичные guard'ы test_isolation. Документировать границу гарантии. — deferred (эвристика, код чист)

### Dismissed (4)

- `xfail(strict=True)` на core-anon = намеренный forcing-function self-flip (AC-4 SATISFIED), не «инверсия семантики» — Blind Hunter без контекста; массовый XPASS при появлении гейта = требуемый сигнал флипнуть `_DeferredGate→_Gate` в 2.13.
- `_Gate` деривация держателей из `ROLE_PERMISSIONS` = специфицированное поведение (AC-2 «источник истины — seed») + независимый ground-truth тест `test_operations_admin_routes_are_admin_only`.
- `_IGNORED_METHODS` blacklist «неполон» = non-issue (методы из `actions ∩ http_method_names`; head/options/trace не входят в DRF actions; `patch` тестируется намеренно).
- core per-role не исполняется (только anon) = out-of-scope by design (core per-role политика → стори 2.13; AC-4), совпадает со спекой.
