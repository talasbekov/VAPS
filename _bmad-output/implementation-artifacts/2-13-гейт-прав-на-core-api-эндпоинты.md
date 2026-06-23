---
baseline_commit: 665856851e7e66d65bf723af14d93cdda9e92d72
---
# Story 2.13: Permission-seam для core API + пилотный гейт (1/2)

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

> **Часть 1/2 декомпозиции «Гейт прав на core API»** (решение Bratan, 2026-06-23, AskUserQuestion). 2.9 (RBAC-матрица) осознанно оставил весь `api/core/` НЕ загейченным под `_DeferredGate`+`xfail(strict=True)` с указателем сюда: «не выдумывать коды прав для core; per-role политика → стори-гейт 2.13». Эта стори (Part A) **строит механизм** и **доказывает его на ОДНОМ пилотном ViewSet** (`VacancyViewSet` — см. Dev Notes «Девиация пилота»: исходно был `EmployeeViewSet`, переключён по решению Bratan из-за смешанной (name,method) политики Employee). Раскатка на остальные 5 ViewSet'ов + flip их MATRIX-строк → **2.14**.
>
> **⚠️ Центральная архитектурная развилка (РЕШЕНА — вариант A, Bratan 2026-06-23):** `require_permission`/`PermissionService` живут в **operations**, а ARCH#L585 — жёсткое ACTIVE-правило **«core ↛ all» (core никого не импортирует)**; `test_core_does_not_import_other_context_models` сканит **весь** `apps/core/` (вкл. `api/`). Поэтому core API физически не может вызвать PermissionService напрямую — это и есть причина, почему он сегодня публичен. **Решение (механизм A):** seam-инъекция `request.effective_permissions` из operations-слоя, зарегистрированного **строкой** в `config/settings.py`; core-гейт читает только request-атрибут (ноль импортов operations).

## Story

As a архитектор безопасности VAPS,
I want чтобы появился boundary-чистый механизм авторизации core API (in-house RBAC через `PermissionService`, не нарушая «core ↛ all»), и чтобы он был доказан гейтом на флагманском `EmployeeViewSet`,
so that последующая раскатка (2.14) сводится к механической установке гейтов, а флагманский PII-эндпоинт перестаёт быть анонимно доступным (FR-33; AR-9; ARCH-SEC-031 «авторизация только через PermissionService, per-request»; ARCH#L585 «core ↛ all»).

## Acceptance Criteria

1. **Seam резолвит эффективные права (operations-сторона, зарегистрирован строкой).** **Given** DRF-authentication-класс в `apps/operations/api/` (читает `request.actor_id`, **НЕ** `X-User-Id`; зовёт `PermissionService.effective_permissions(actor_id)`; пишет `request.effective_permissions: set`; возвращает `None`), зарегистрированный в `config/settings.py` `DEFAULT_AUTHENTICATION_CLASSES` **после** `XUserIdAuthentication`, **When** приходит запрос с валидным `X-User-Id` актора, имеющего роль, **Then** `request.effective_permissions` = набор кодов этой роли (вкл. `*` для ADMIN); **And** без `X-User-Id` (аноним) → `request.effective_permissions == set()` (без обращения к БД).
2. **Core-гейт — локальная проверка request-атрибута (ноль импортов operations).** **Given** хелпер `apps/core/api/permissions.py::require_permission(request, code)` (raise `PermissionDenied("PERMISSION_DENIED")` если нет `actor_id` ИЛИ `code` не в `request.effective_permissions` и нет `*`), **Then** `apps/core/api/permissions.py` и `views.py` НЕ импортируют `apps.operations.*` (`test_core_does_not_import_other_context_models` зелёный); **And** boundary-guard 2.9 (`test_authz_boundary.py`) зелёный — хелпер читает `request.effective_permissions`/`request.actor_id`, не `request.user`/`.has_perm`/`is_staff`.
3. **Permission-таксоном core + seed (provisional role-mapping).** **Given** `seed_operations.PERMISSIONS` пополнен 4 core-кодами (`personnel.view`, `personnel.edit`, `orgstructure.view`, `orgstructure.manage`), `ROLE_PERMISSIONS` — provisional раскладкой по 8 ролям (см. Dev Notes; помечено PROVISIONAL — открытый вопрос Bratan), **When** `seed_operations` прогоняется, **Then** коды и role-perm строки создаются идемпотентно; **And** держатели каждого кода деривятся матрицей из `ROLE_PERMISSIONS` (тот же путь, что для `admin.roles` в 2.9).
4. **Пилот `VacancyViewSet` загейчен end-to-end, MATRIX перевёрнут.** **Given** `VacancyViewSet.list` → `require_permission(request, "personnel.view")` первой строкой (`vacancy-list` = только GET → единая по-методная политика, один код; см. Dev Notes → «Девиация пилота»), **When** в `test_rbac_matrix.py` строка `vacancy-list` → `_Gate("personnel.view")` (снят `_DeferredGate`+`xfail`), **Then** per-role сетка зелёная: ALLOW держателям `personnel.view` (+ADMIN через `*`), DENY остальным ролям и анониму (403); **And** остальные 15 core-строк (employee×4/division×3/position×2/rank×2/staffing-slot×4) ОСТАЮТСЯ `_DeferredGate("story 2.14")` (раскатка + (name,method)-рефакторинг MATRIX → 2.14).
5. **Нулевая регрессия + границы + гейт.** **Given** изменения, **Then**: `completeness`-gate матрицы зелёный (каждый served-роут ∈ MATRIX, нет протухших); seam не ломает существующие тесты (operations require_permission по-прежнему читает PermissionService напрямую; аноним → пустой набор); маскирование (`X-User-Permissions`) НЕ трогается (gate≠masking — отдельный #L12); миграции не нужны (модели не меняются); `make gate` (Postgres :5433) — ruff чист, pytest зелёный (+seam/gate/per-role тесты), `manage.py check` 0 issues, `makemigrations --check` «No changes detected», < 300с. **Артефакты НЕ коммитить** (за Bratan).

## Tasks / Subtasks

- [x] **Задача 1. Seam: DRF-auth-класс резолва прав (AC: 1)**
  - [x] Создать `apps/operations/api/authz.py` (или дополнить `permissions.py`): класс `EffectivePermissionsResolver(BaseAuthentication)` — `authenticate(self, request)`: `actor_id = getattr(request, "actor_id", None)`; `request.effective_permissions = PermissionService.effective_permissions(actor_id) if actor_id else set()`; `return None` (не клеймит идентичность — как `XUserIdAuthentication`). Импорт `PermissionService` из `apps.operations.services` — РАЗРЕШЕНО (operations→core/internal ок; это operations-сторона). НЕ читать `X-User-Id` (только `request.actor_id`) — иначе `test_x_user_id_literal_only_in_core_auth` покраснеет.
  - [x] `config/settings.py`: `REST_FRAMEWORK["DEFAULT_AUTHENTICATION_CLASSES"]` = `["apps.core.auth.authentication.XUserIdAuthentication", "apps.operations.api.authz.EffectivePermissionsResolver"]` (порядок: XUserId ПЕРВЫЙ ставит `actor_id`, resolver ВТОРОЙ читает его). Строковая ссылка — config импортирует operations легально (композиционный корень), core не импортирует.
- [x] **Задача 2. Core-гейт хелпер (AC: 2)**
  - [x] Создать `apps/core/api/permissions.py::require_permission(request, permission_code)` — зеркало operations-версии, но БЕЗ обращения к PermissionService: `if not getattr(request, "actor_id", None): raise PermissionDenied("PERMISSION_DENIED")`; `perms = getattr(request, "effective_permissions", set())`; `if "*" not in perms and permission_code not in perms: raise PermissionDenied("PERMISSION_DENIED")`. Импорт только `rest_framework.exceptions.PermissionDenied`. НИКАКОГО `import apps.operations`.
- [x] **Задача 3. Permission-таксоном + seed (AC: 3)**
  - [x] `seed_operations.py`: в `PERMISSIONS` добавить `("personnel.view", ...)`, `("personnel.edit", ...)`, `("orgstructure.view", ...)`, `("orgstructure.manage", ...)`. В `ROLE_PERMISSIONS` — provisional раскладку (Dev Notes; PROVISIONAL). Идемпотентность сохраняется (`update_or_create`).
- [x] **Задача 4. Пилот: гейт VacancyViewSet (AC: 4)**
  - [x] `apps/core/api/views.py`: импорт `from apps.core.api.permissions import require_permission`. В `VacancyViewSet.list` → `require_permission(request, "personnel.view")` ПЕРВОЙ строкой (до `compute_free_slots`). `vacancy-list` обслуживает только GET → единый код, никакой по-методной развилки (почему Vacancy, а не Employee — Dev Notes «Девиация пилота»).
  - [x] Маскирование (`X-User-Permissions`) НЕ трогать (VacancyViewSet и так без маскирования; #L12 — отдельно).
- [x] **Задача 5. Flip MATRIX пилота + per-role тесты (AC: 4, 5)**
  - [x] `apps/operations/tests/test_rbac_matrix.py`: `vacancy-list` → `_Gate("personnel.view")` (убрать `_DeferredGate`). Остальные 15 core-строк → `_DeferredGate("story 2.14")` (обновить `fix_ref` с «story 2.13» на «story 2.14»; `assign-employee` сохранить `; deferred-work.md#L25`). Per-role сетка для `vacancy-list` теперь активна (xfail снят) — completeness-gate + ALLOW/DENY деривятся из seed автоматически.
- [x] **Задача 6. Юнит-тесты seam + gate (AC: 1, 2)**
  - [x] Seam: запрос с актором-держателем → `request.effective_permissions` содержит коды; аноним → `set()`. Gate: `require_permission` raise 403 при пустом/без кода, проходит при наличии/при `*`. (Прецедент аппарата — `apps/operations/tests/test_api_permissions.py`.)
- [x] **Задача 7. Гейт (AC: 5)**
  - [x] `make gate` (Postgres :5433): ruff чист, pytest зелёный, `manage.py check` 0 issues, `makemigrations --check` «No changes detected». **Артефакты НЕ коммитить.**

## Dev Notes

### Архитектурный механизм (РЕШЕНИЕ A) — почему именно так

**Ограничение:** ARCH#L585 «core ↛ all» (ACTIVE, AST-enforced). `_module_files("core")` в `apps/core/tests/test_isolation.py` = ВСЕ `.py` под `apps/core/` кроме tests (вкл. `api/`); `test_core_does_not_import_other_context_models` запрещает любой `apps.operations.*` импорт в core. ⇒ core/api **не может** импортировать `require_permission`/`PermissionService`.

**Тайминг идентичности (ключевая тонкость):** `XUserIdAuthentication.authenticate()` (`apps/core/auth/authentication.py`) ставит `request.actor_id` и **возвращает `None`** → DRF НЕ останавливается, а **идёт к следующему authenticator** (DRF прерывает цепочку только на non-None tuple). Значит можно добавить ВТОРОЙ auth-класс, который выполнится ПОСЛЕ и увидит уже выставленный `request.actor_id`. Middleware не годится — оно отрабатывает ДО DRF-auth (actor_id ещё не стоит), а читать `X-User-Id` вне `core/auth` запрещено (`test_x_user_id_literal_only_in_core_auth` сканит и `config/`).

**Seam (3 шва):**
1. `EffectivePermissionsResolver` (DRF auth, **operations**, импортирует PermissionService — легально) — читает `request.actor_id`, пишет `request.effective_permissions`, `return None`.
2. `config/settings.py` регистрирует его **строкой** после XUserId в `DEFAULT_AUTHENTICATION_CLASSES` — config = композиционный корень, может ссылаться на operations; **core не импортирует ничего**.
3. `apps/core/api/permissions.py::require_permission` — читает только `request.effective_permissions`/`request.actor_id`; ноль импортов operations. Дублирует `*`-короткозамыкание (1 строка, зеркало `PermissionService.has_permission`) — задокументировать.

**Почему boundary-clean:** core импортирует только свой хелпер (`apps.core.api.permissions`) + DRF. operations-resolver читает `request.actor_id` (не `X-User-Id`) и использует in-house PermissionService (не Django `has_perm`) → `test_authz_boundary` (2.9) и `test_x_user_id_literal_only_in_core_auth` зелёные.

```python
# apps/operations/api/authz.py  (operations-сторона — импорт PermissionService ОК)
from rest_framework.authentication import BaseAuthentication
from apps.operations.services import PermissionService

class EffectivePermissionsResolver(BaseAuthentication):
    """Attaches request.effective_permissions (in-house RBAC) post-identity.

    Runs after XUserIdAuthentication (which sets request.actor_id and returns
    None, so DRF continues the chain). Reads request.actor_id — NOT X-User-Id
    (ARCH-SEC-030). Returns None: it enriches, it does not claim identity.
    """
    def authenticate(self, request):
        actor_id = getattr(request, "actor_id", None)
        request.effective_permissions = (
            PermissionService.effective_permissions(actor_id) if actor_id else set()
        )
        return None
```
```python
# apps/core/api/permissions.py  (core-сторона — НИКАКОГО import apps.operations)
from rest_framework.exceptions import PermissionDenied

def require_permission(request, permission_code):
    """Gate a core API action on an in-house RBAC code. Mirrors
    operations/api/permissions.py but reads request.effective_permissions
    (populated by the operations authz seam) — core ↛ operations (ARCH#L585)."""
    if not getattr(request, "actor_id", None):
        raise PermissionDenied("PERMISSION_DENIED")
    perms = getattr(request, "effective_permissions", set())
    if "*" not in perms and permission_code not in perms:
        raise PermissionDenied("PERMISSION_DENIED")
```

### Permission-таксоном core (4 кода) + provisional role-mapping

| Код | Покрывает (в 2.14 — раскатка) | В пилоте 2.13 |
|---|---|---|
| `personnel.view` | Employee + StaffingSlot + Vacancy — чтение | Employee list/retrieve |
| `personnel.edit` | Employee + StaffingSlot — запись (вкл. archive/restore/assign/release) | Employee create/patch/archive/restore |
| `orgstructure.view` | Division + Position + Rank — чтение | — (2.14) |
| `orgstructure.manage` | Division + Position + Rank — запись | — (2.14) |

**Provisional `ROLE_PERMISSIONS` (⚠️ PROVISIONAL — открытый вопрос #1 Bratan):**
- `VIEWER`: + `personnel.view`, `orgstructure.view`
- `DIVISION_OPERATOR`: + `personnel.view`, `orgstructure.view`
- `ORGD`: + `personnel.view`, `personnel.edit`, `orgstructure.view`, `orgstructure.manage` (ОРГД = владелец кадровых записей/оргструктуры)
- `OMD`, `SENIOR_COORDINATOR`, `APPROVER`: + `personnel.view`, `orgstructure.view` (нужны ростеры для расстановки)
- `INTEGRATION_USER`: — (без core-прав; только `status.manage`) → служит DENY-дискриминатором в пилот-тесте `vacancy-list` (доказывает DENY не только для анонима, но и для роли-не-держателя)
- `ADMIN`: `*` (уже есть — держит всё через wildcard)

Эта раскладка — орг-политика; засеяна, чтобы пилот-тест деривил держателей. **НЕ канон — подтвердить/переопределить (Bratan).** Тест 2.13 проверяет МЕХАНИЗМ (держатели personnel.view → ALLOW employee-list; не-держатели/аноним → DENY), не «правильность» политики.

### Что регистрируем где (границы импорта — критично)

- `apps/operations/api/authz.py` → импортирует `apps.operations.services.PermissionService` ✓ (operations-сторона).
- `config/settings.py` → строковая ссылка `"apps.operations.api.authz.EffectivePermissionsResolver"` ✓ (config не под isolation-сканом core).
- `apps/core/api/permissions.py` + `views.py` → импортируют только друг друга + DRF/core ✓ (ноль `apps.operations`).
- Проверка: после правок `test_core_does_not_import_other_context_models`, `test_x_user_id_literal_only_in_core_auth`, `test_authz_boundary.py` — все зелёные.

### Девиация пилота: VacancyViewSet вместо EmployeeViewSet (Bratan, 2026-06-23)

**Исходно** пилотом был EmployeeViewSet. Dev-анализ вскрыл блокер: DRF-роутер даёт `employee-list` = GET(list, `view`) + POST(create, `edit`) и `employee-detail` = GET(retrieve, `view`) + PATCH(partial_update, `edit`) — **смешанная по-методная политика на одном route-name**. Но `MATRIX`/`_Gate(code)` ключуются по **имени роута** (один код на все методы), поэтому корректно загейтить Employee нельзя без отложенного 2.9-рефакторинга MATRIX до `(name, method)` (deferred #L215). AskUserQuestion (Bratan): **вариант A** — сменить пилот на `VacancyViewSet`.

**VacancyViewSet** (`apps/core/api/views.py:155`, `viewsets.ViewSet` только с `list`) → `vacancy-list` обслуживает **только GET** → единая по-методная политика, один код `personnel.view`. Доказывает весь механизм (seam → core-gate → MATRIX flip → per-role сетка) с **нулевым** изменением matrix-харнесса. Гейт: `require_permission(request, "personnel.view")` первой строкой в `list` (до `compute_free_slots`).

EmployeeViewSet + остальные смешанные ViewSet'ы + `(name, method)`-рефакторинг MATRIX → **2.14** (там все роуты со смешанной политикой, рефакторинг уместен рядом с раскаткой).

### MATRIX flip (test_rbac_matrix.py)

`_Gate(code)` (стр.61), `_DeferredGate(fix_ref)` (стр.85, оборачивается `xfail(strict=True, reason=...)` когда `isinstance(spec,_DeferredGate)` стр.272-276). Перевод employee-строк `_DeferredGate→_Gate` убирает их из xfail-ветки → идут через нормальную per-role сетку (ALLOW держателям из seed, DENY иначе). `xfail(strict=True)` сам бы упал XPASS если оставить `_DeferredGate` на загейченном роуте — поэтому flip ОБЯЗАТЕЛЕН одновременно с гейтом (forcing-function 2.9). Остальные 12 строк: `fix_ref` «story 2.13»→«story 2.14».

### Gotchas

- **Порядок auth-классов** в `DEFAULT_AUTHENTICATION_CLASSES`: XUserId ПЕРВЫЙ (ставит actor_id), resolver ВТОРОЙ. Перепутаешь — resolver увидит `actor_id=None` для всех → все права пусты → всё 403.
- **resolver `return None`**: если вернуть tuple — DRF прервёт цепочку и склеит identity (сломает контракт «X-User-Id = идентичность»). Только `None` + side-effect.
- **Seam бежит для ВСЕХ запросов** (глобальный auth): аноним → `set()` без БД-запроса (guard `if actor_id`); авторизованный → 1 резолв `effective_permissions` (роли+temp-duty+role_perms, индексировано). ARCH-SEC-031 (per-request, без кэша) — это by-design, не N+1.
- **operations require_permission НЕ меняется**: он зовёт `PermissionService.has_permission` напрямую (не `request.effective_permissions`). Сосуществуют. НЕ рефакторить operations под seam в этой стори (out of scope).
- **Маскирование ≠ гейт**: `X-User-Permissions` (клиент-доверяемый, #L12) остаётся. Seam теперь даёт настоящие `request.effective_permissions` — соблазн переключить маскирование, но это ОТДЕЛЬНО (out of scope, заметка в 2.14/follow-up).
- **Без миграции**: только views/permissions/settings/seed/tests. Если тронул модель — стоп, не та стори.

### Project Structure Notes

- **Создать:** `apps/operations/api/authz.py` (seam resolver), `apps/core/api/permissions.py` (core gate). Тесты: `apps/operations/tests/test_api_permissions.py` (или новый) — seam + gate юниты.
- **Изменить:** `config/settings.py` (DEFAULT_AUTHENTICATION_CLASSES), `apps/core/api/views.py` (гейт VacancyViewSet.list), `apps/operations/management/commands/seed_operations.py` (4 кода + role-map), `apps/operations/tests/test_rbac_matrix.py` (flip `vacancy-list` + fix_ref остальных 15).
- **НЕ трогать:** маскирование/`X-User-Permissions`; `XUserIdAuthentication`; `PermissionService`; `operations/api/permissions.py` (require_permission); остальные 5 core ViewSet'ов вкл. Employee (→2.14); модели/миграции.

### Out of Scope (НЕ в 2.13 Part A)

- **Гейт остальных 5 core ViewSet'ов** (Employee/Division/Position/Rank/StaffingSlot) + flip их 15 MATRIX-строк + **(name, method)-рефакторинг MATRIX** (deferred 2.9 #L215, нужен для смешанной view/edit политики Employee и др.) → **2.14**. Вкл. `assign-employee` (#L25 анонимная-назначка).
- **Перенос маскирования** с `X-User-Permissions` на `request.effective_permissions` (#L12) → отдельно (теперь дёшево — seam даёт настоящие права).
- **Scope-subtree enforcement** («своё ли подразделение») — ARCH#L450 «scope-проверка в сервисе через PermissionService→DomainError 403»; гейт здесь = грубая роль/действие. Per-division scope → при сервис-слое (E3+).
- **NULL-scope гонка** (#L26), JWT-переход (INT-2). Канонизация role-mapping (provisional → confirmed) — открытый вопрос Bratan.

### References

- [Source: _bmad-output/implementation-artifacts/2-9-rbac-матрица-роль-операция.md#L110-116,L169-174] — DEFERRED-GATE решение, `fix_ref`→2.13, «не выдумывать коды core», список незагейченных core-роутов; #L120-121 стражи/PermissionService; #L137-159 MATRIX/Gate/DeferredGate-механика + xfail self-flip.
- [Source: Backend/VAPS/apps/operations/tests/test_rbac_matrix.py:100-128,261-276] — MATRIX (16 core `_DeferredGate("story 2.13")`); per-role + xfail-wrap логика (flip-таргет).
- [Source: Backend/VAPS/apps/operations/api/permissions.py] — `require_permission` (зеркало для core-версии); [services.py:14-56] `PermissionService.{effective_permissions,has_permission}` (`*`-короткозамыкание).
- [Source: Backend/VAPS/apps/core/auth/authentication.py] — `XUserIdAuthentication` (ставит `actor_id`, `return None` → цепочка продолжается).
- [Source: Backend/VAPS/apps/core/api/views.py:25-27,30-95,124-144] — `_permissions_from_request`/маскирование (НЕ трогать); `EmployeeViewSet` (пилот); `StaffingSlotViewSet.assign_employee` (#L25 → 2.14).
- [Source: Backend/VAPS/apps/operations/management/commands/seed_operations.py:5-52] — `PERMISSIONS`/`ROLES`/`ROLE_PERMISSIONS` (пополнить).
- [Source: Backend/VAPS/apps/core/tests/test_isolation.py:10-12,132-140] — `_module_files("core")` (вкл. api/) + `test_core_does_not_import_other_context_models` (граница, которую механизм A соблюдает); :35-54 `test_x_user_id_literal_only_in_core_auth` (X-User-Id только в core/auth).
- [Source: _bmad-output/planning-artifacts/architecture.md#L585] «core ↛ all»; [#L450-451] permission-класс = грубая роль/действие, scope в сервисе; [#L315-316] ARCH-SEC-030/031; [#L96-99 config/settings.py] DEFAULT_AUTHENTICATION_CLASSES=[XUserId], DEFAULT_PERMISSION_CLASSES=[].
- [Source: _bmad-output/implementation-artifacts/deferred-work.md#L12,L25-26,L209] — маскирование→PermissionService (#L12, отдельно); assign-employee гейт (#L25→2.14); NULL-scope (#L26).
- [Decision] AskUserQuestion 2026-06-23: механизм A (middleware/seam инжектит perms) + сплит на 2 стори (Bratan).

## Dev Agent Record

### Agent Model Used

Opus 4.8 (claude-opus-4-8[1m]), bmad-dev-story, 2026-06-23, TDD. baseline_commit `6658568`. Django 5.1.15.

### Debug Log References

- **Девиация пилота (Bratan A, AskUserQuestion):** dev-анализ вскрыл блокер — `EmployeeViewSet` имеет смешанную по-методной политику на одном route-name (`employee-list`=GET view+POST edit), а `MATRIX`/`_Gate` ключуются по имени роута → корректный гейт Employee требует отложенного 2.9-рефакторинга MATRIX до `(name,method)` (#L215). Решение Bratan: пилот → `VacancyViewSet` (`vacancy-list`=только GET, единый код). Employee + (name,method)-рефакторинг → 2.14.
- **TDD RED→GREEN:** flip `vacancy-list`→`_Gate("personnel.view")` + seed-коды → RED-прогон: `vacancy-list/get/__anon__` и `.../INTEGRATION_USER` ждут 403, получают 200 (не загейчен); 7 ALLOW-ролей зелёные → дискриминатор работает. GREEN после seam+gate+пилот.
- **Механизм A реализован (3 шва):** (1) `apps/operations/api/authz.py::EffectivePermissionsResolver` (DRF auth, читает `request.actor_id`, пишет `request.effective_permissions` via PermissionService, `return None`); (2) `config/settings.py` `DEFAULT_AUTHENTICATION_CLASSES` += resolver **после** XUserId (строковая ссылка — config-корень, core не импортирует); (3) `apps/core/api/permissions.py::require_permission` читает только request-атрибут (ноль импортов operations). Тайминг подтверждён: `XUserIdAuthentication.authenticate` возвращает `None` → DRF продолжает цепочку → resolver видит выставленный `actor_id`.
- **Boundary-clean верифицирован:** `test_core_does_not_import_other_context_models`, `test_x_user_id_literal_only_in_core_auth`, `test_authz_boundary.py` (2.9) — все зелёные. core/api импортирует только свой хелпер + DRF.
- **Gotcha:** docstring `authz.py` содержал литерал «X-User-Id» (в пояснении «НЕ читаем его») → `test_x_user_id_literal_only_in_core_auth` (тупой строковый скан) покраснел; перефразировал без литерала.
- **3 ожидаемых регрессии (следствие гейта/seed) исправлены:** `test_vacancies_endpoint` — авторизован (seed + UserRole VIEWER + X-User-Id); `test_omd_matrix` — добавлены provisional `personnel.view`/`orgstructure.view` к OMD; `test_seed_is_idempotent` — OMD-count 5→7.
- **Полный `make gate`** (Postgres :5433): **571 passed (+16)**, 18 deselected, **27 xfailed** (было 28 — `vacancy-list` перевёрнут из `_DeferredGate`/xfail в `_Gate`); ruff чист; `manage.py check` 0 issues; `makemigrations --check` «No changes detected»; 21s.

### Completion Notes List

- **Механизм A доставлен + доказан пилотом.** Seam (operations-сторона) инжектит `request.effective_permissions`; core-гейт авторизует без импорта operations — соблюдает ARCH#L585 «core↛all». `vacancy-list` загейчен `personnel.view`; per-role сетка матрицы для него активна (ALLOW 7 ролей + ADMIN`*`, DENY INTEGRATION_USER + аноним).
- **Permission-таксоном (4 кода):** `personnel.{view,edit}`, `orgstructure.{view,manage}` + provisional role-map (⚠️ открытый вопрос Bratan — НЕ канон; тест проверяет механизм, не политику). `INTEGRATION_USER` намеренно без core-прав → DENY-дискриминатор в пилот-тесте.
- **Девиация пилота** (Employee→Vacancy, Bratan A) задокументирована в Dev Notes; Employee + (name,method)-рефакторинг MATRIX + раскатка на остальные 5 ViewSet'ов → **2.14**.
- **Без миграции** (только views/permissions/settings/seed/tests). Маскирование (`X-User-Permissions`, #L12) НЕ тронуто.
- **Артефакты НЕ закоммичены агентом** (за Bratan; прецедент 2.4–2.12). Status → review.

### File List

**Создано:**
- `Backend/VAPS/apps/operations/api/authz.py` (seam: EffectivePermissionsResolver)
- `Backend/VAPS/apps/core/api/permissions.py` (core-gate require_permission)
- `Backend/VAPS/apps/core/tests/test_api_gate.py` (7 юнитов: seam + gate + fail-closed)

**Изменено:**
- `Backend/VAPS/config/settings.py` (DEFAULT_AUTHENTICATION_CLASSES += resolver после XUserId)
- `Backend/VAPS/apps/core/api/views.py` (импорт + гейт VacancyViewSet.list на personnel.view)
- `Backend/VAPS/apps/operations/management/commands/seed_operations.py` (4 core-кода + provisional role-map)
- `Backend/VAPS/apps/operations/tests/test_rbac_matrix.py` (flip vacancy-list→_Gate; остальные 15 core→story 2.14)
- `Backend/VAPS/apps/core/tests/test_staffing_api.py` (авторизация test_vacancies_endpoint под гейт)
- `Backend/VAPS/apps/operations/tests/test_seed.py` (OMD provisional core-права; idempotent count 5→7)
- _(BMAD-трекинг: `sprint-status.yaml`, этот файл)_

## Change Log

| Дата | Изменение |
|------|-----------|
| 2026-06-23 | Создана история 2.13 Part A (bmad-create-story, Opus 4.8): permission-seam для core API + пилотный гейт. Декомпозиция «Гейт прав на core API» на 2.13(seam+пилот)/2.14(раскатка) — решение Bratan (AskUserQuestion). Механизм A (решён Bratan): DRF-auth-resolver в operations пишет `request.effective_permissions` (зарегистрирован строкой в settings после XUserId), core-гейт `apps/core/api/permissions.py` читает request-атрибут — соблюдает ARCH#L585 «core↛all». 4 core permission-кода + provisional role-map (открытый вопрос Bratan). Без миграции. Status → ready-for-dev. |
| 2026-06-23 | Code-review (bmad-code-review, Opus 4.8 — same-model caveat; 3 слоя; scoped diff 332 строки по 9 файлам, settings/MATRIX сужены до 2.13-блоков). Acceptance Auditor: **ACCEPT** — AC-1..5 SATISFIED эмпирически. Edge Case Hunter (с кодом+БД) ПОДТВЕРДИЛ корректность: DRF-цепочка (resolver бежит после XUserId через `_authenticate`; `initial()` форсит auth до вью; side-effect доезжает до гейта), boundary (ноль реальных operations-импортов в core), fail-closed на исключение PermissionService (500, не fail-open). Опроверг Blind HIGH (cross-request leak — свежий Request на вызов; fail-OPEN — на деле fail-CLOSED). 0 decision · 2 patch · 3 defer · 6 dismiss. См. ## Review Findings. |
| 2026-06-23 | Dev (bmad-dev-story, Opus 4.8, TDD): механизм A реализован + доказан пилотом. **Девиация пилота (Bratan A, AskUserQuestion):** Employee→Vacancy — dev-анализ вскрыл, что EmployeeViewSet имеет смешанную (name,method) view/edit политику, а MATRIX ключуется по имени роута → требует отложенного 2.9-рефакторинга (#L215); Vacancy (vacancy-list=GET-only, единый код) доказывает механизм с нулевым изменением харнесса. Employee + (name,method)-рефакторинг → 2.14. Реализовано: seam `authz.py` (EffectivePermissionsResolver, operations), core-gate `permissions.py` (ноль импортов operations), settings-регистрация, гейт VacancyViewSet.list на personnel.view, 4 seed-кода + provisional role-map (INTEGRATION_USER без core-прав = DENY-дискриминатор), flip vacancy-list→_Gate. TDD RED→GREEN. Boundary-clean (3 isolation/guard зелёные; gotcha: «X-User-Id»-литерал в docstring → перефразирован). 3 ожид. регрессии исправлены (vacancies авторизован; OMD +2 perm; idempotent 5→7). +7 юнитов seam/gate. `make gate` зелёный (Postgres :5433: 571 passed +16, 27 xfailed, ruff чист, makemigrations «No changes detected», check 0 issues, 21s). Артефакты НЕ закоммичены. Status → review. |

| 2026-06-23 | Применены 2 патча ревью: P1 `test_auth_class_order_is_identity_then_resolver` (закрепляет load-bearing порядок auth-классов — реверс молча DENY-ит валидных юзеров); P2 doc-fix L10 (EmployeeViewSet→VacancyViewSet). `make gate` зелёный (Postgres :5433: 572 passed +1, 27 xfailed, ruff чист, makemigrations «No changes detected», 25s). 3 defer → deferred-work.md (seam-perf на ungated; seed grow-only no-prune — важно при ревизии provisional-карты; wildcard-дрейф → parity-тест в 2.14). Артефакты НЕ закоммичены агентом. Status → done. |

## Review Findings

_Code-review (bmad-code-review, 2026-06-23, Opus 4.8 — same-model caveat; 3 слоя: Blind Hunter / Edge Case Hunter / Acceptance Auditor; scoped diff 332 строки). Acceptance Auditor: **ACCEPT** — все 5 AC SATISFIED, верифицировано реальным прогоном. Edge Case Hunter (с кодом+БД) эмпирически ПОДТВЕРДИЛ корректность механизма (DRF-цепочка, boundary, fail-closed) и опроверг главные Blind-HIGH. 0 decision · 2 patch · 3 defer · 6 dismiss._

### Patches (2)

- [x] [Review][Patch] **Порядок auth-классов не закреплён явным тестом** — ПРИМЕНЕНО+ВЕРИФИЦИРОВАНО: `test_auth_class_order_is_identity_then_resolver` (читает `settings.REST_FRAMEWORK[...]`, ассертит `index(XUserId) < index(resolver)`). Гейт зелёный (572 passed +1). [Backend/VAPS/apps/core/tests/test_api_gate.py] — edge+blind MED (Edge эмпирически: реверс порядка `DEFAULT_AUTHENTICATION_CLASSES` → resolver бежит до XUserId → `effective_permissions=set()` для всех → гейт DENY всем валидным; юниты `_resolved_request` хардкодят порядок и не поймают). МИТИГИРОВАНО интеграцией: matrix `vacancy-list` ALLOW-ячейки + `test_vacancies_endpoint` гоняют реальный DRF-стек → реордер уронил бы ALLOW→403. Но дёшево добавить ЯВНЫЙ guard: тест читает `settings.REST_FRAMEWORK["DEFAULT_AUTHENTICATION_CLASSES"]` и ассертит `index(XUserIdAuthentication) < index(EffectivePermissionsResolver)` — самодокументирует load-bearing порядок и ловит реордер мгновенно/явно.
- [x] [Review][Patch] **Устаревшая ссылка на EmployeeViewSet во вводном блокноте** [2-13-...md:L10] — auditor (косметика): intro-blockquote называл пилотом `EmployeeViewSet`. ПРИМЕНЕНО: L10 поправлен на `VacancyViewSet` (+ссылка на «Девиация пилота»).

### Defer (3)

- [x] [Review][Defer] **Seam резолвит права на КАЖДЫЙ аутентифицированный запрос, вкл. незагейченные эндпоинты** [Backend/VAPS/apps/operations/api/authz.py] — deferred (известный trade-off механизма A). Edge эмпирически: ungated `employee-list` платит 3 RBAC-запроса (user_roles/temp_duty/role_permissions), которые не потребляет. ARCH-SEC-031 предписывает per-request без кэша, так что per-request — by-design; расточительна лишь резолюция на роутах без гейта. Рефайнмент: ленивая резолюция (резолвить лишь при вызове require_permission) ИЛИ per-request memo. Пересмотреть при горячих list/detail (E6/расход) или в 2.14.
- [x] [Review][Defer] **`seed_operations` не вычищает устаревшие RolePermission (grow-only)** [Backend/VAPS/apps/operations/management/commands/seed_operations.py] — deferred, pre-existing (тот же паттерн, что seed_statuses #L173). Edge эмпирически: грант `VIEWER→admin.roles` выживает ре-сид. КРИТИЧНО для 2.13: role-map PROVISIONAL и БУДЕТ ревизирован (Bratan) — когда право убирают из карты, старый грант в уже-посеянной БД НЕ отзывается; idempotent-тест (count==7) считает только добавления. При канонизации карты — добавить prune-проход (`RolePermission.exclude(...).delete()` по карте) ЛИБО ручной cleanup посеянной БД.
- [x] [Review][Defer] **`*`-wildcard продублирован в core-гейте и PermissionService — риск дрейфа** [Backend/VAPS/apps/core/api/permissions.py] — deferred (структурно вынужден границей core↛operations). Сегодня семантика совпадает (Edge сверил `services.py:52-56`). Если PermissionService изменит wildcard-логику (вторая супер-привилегия / scoped-wildcard), core-гейт молча разойдётся. Лечение: parity-тест «core-гейт ≡ PermissionService.has_permission на наборе кейсов» (живёт в тестах, импорт обоих легален) — в 2.14.

### Dismissed (6)

- **Cross-request state leakage `effective_permissions`** (blind HIGH): опровергнуто Edge эмпирически — свежий DRF `Request` на каждый вызов, переиспользования/кэша request нет; side-effect не переживает запрос.
- **Fail-OPEN если resolver не отработал** (blind HIGH): опровергнуто — на деле fail-CLOSED: DRF `initial()` обращается к `request.user` → форсит auth-цепочку до вью (Edge сверил `request.py`/`views.py`); даже без неё `getattr(...,set())`→DENY. Blind сам признал «denied for holders» = fail-closed.
- **403 вместо 401 для анонима** (blind HIGH): намеренная конвенция проекта — `XUserIdAuthentication` docstring («401 здесь замаскировал бы 403 PERMISSION_DENIED-контракт»); core-гейт зеркалит established `operations/api/permissions.py` (2.1). Не баг.
- **`PERMISSION_DENIED` как user-facing detail** (blind LOW): намеренный error-контракт (зеркало operations; структурный DomainError-mapping → E3/3.1). Не дефект.
- **15 sibling core-эндпоинтов всё ещё публичны** (blind LOW): by-design → 2.14, задекларировано `_DeferredGate`+xfail (само перевернётся при гейте). Трекается.
- **fail-closed-тест тавтологичен / idempotency count-based / INTEGRATION_USER через отсутствие** (blind MED+LOW кластер): fail-closed-тест документирует намерение, реальный ordering ловит интеграция (→ patch P1); idempotency-контент проверен `test_omd_matrix`; INTEGRATION_USER-DENY покрыт `test_gate_denies_actor_without_permission`. Низкосигнально.
