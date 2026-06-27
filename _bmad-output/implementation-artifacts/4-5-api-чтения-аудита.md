---
baseline_commit: 4bdea8e (E4 4.1–4.4 закоммичены одним коммитом; + uncommitted 4.4 review-патчи: status_service.py коммент, test_status_audit.py, sprint-status, deferred-work; ветка e3-catchup-clock-concurrency; E4 in-progress)
context:
  - _bmad-output/planning-artifacts/epics.md
  - _bmad-output/planning-artifacts/architecture.md
  - _bmad-output/implementation-artifacts/4-4-аудит-мутаций-статусов.md
---

# Story 4.5: API чтения аудита

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

<!-- ПЯТАЯ стори E4 (Аудит) — ПЕРВЫЙ ПОТРЕБИТЕЛЬ-НА-ЧТЕНИЕ записанного аудита. Фундамент 4.1–4.4
     закрыт (модель `AuditLog` + append-only БД + единый `record()` + события 11 кодов). 4.5 даёт
     read-only HTTP-поверхность над `audit_logs`, чтобы журнал был ДОСТУПЕН и ФИЛЬТРУЕМ без SQL-доступа
     (FR-36). СТРОИТСЯ: `GET /api/audit/logs/` ВНУТРИ `apps/audit` (api-слой с нуля: selectors +
     api/{serializers,views,urls}) + фильтры (объект/пользователь/тип/период) + LimitOffset-пагинация
     с ordering+id + гейт `audit.view` (УЖЕ в seed) + строки в RBAC-матрицу + тесты.
     НЕ строится: запись (4.3), новые коды (4.4), coverage-тест (4.6), аудит увольнения (4.7),
     экспорт/маскирование (E20), UI/экран журнала (E8/E10).
     КЛЮЧЕВЫЕ ФАКТЫ: (1) `entity_id` = employee UUID (реш. 4.4 №1) → «фильтр по объекту» = entity_type +
     entity_id(UUID), НЕ по integer-PK строки (он в `new_value`); (2) actor-поле = `actor_user_id`
     (строка, BR-ACCOUNT-002); (3) пагинация = LimitOffset (PageNumber — отвергнутый канон,
     architecture.md:31); (4) у `AuditLog` НЕТ Meta.ordering → задать `order_by("-created_at","id")`
     явно (bulk-аудит 4.4 пишет N строк с ОДИНАКОВЫМ created_at → id-tiebreaker несущий);
     (5) read-API ОБЯЗАН жить в `apps/audit` (AST-бан 4.3 на внешний импорт `apps.audit.models`);
     (6) RBAC-матрица (`test_rbac_matrix.py`) — жёсткий completeness-гейт, обходящий весь root-resolver:
     новый роут без строки в MATRIX = красный suite (в operations, не в audit). -->

## Story

As a **аудитор/проверяющий (роль с полномочием `audit.view`), которому нужно восстановить «кто/что/когда/было→стало» по сотруднику или решению, не имея и не получая прямого доступа к БД**,
I want **read-only HTTP-эндпоинт `GET /api/audit/logs/` (живёт ВНУТРИ `apps/audit`), отдающий записи `AuditLog` с серверной фильтрацией по объекту (`entity_type` + `entity_id`=UUID сотрудника), пользователю (`actor_user_id`), типу действия (`action`) и периоду (`created_at` от/до), с детерминированной сортировкой `(-created_at, id)` и limit/offset-пагинацией, под гейтом `audit.view`**,
so that **журнал аудита, append-only-запертый в БД (4.2), наполняемый единым сервисом записи (4.3) реальными событиями мутаций (4.4), стал доступен и фильтруем без SQL-доступа — закрывая FR-36 «журнал фильтруется по объекту/пользователю/типу/периоду» и давая SM-4 (полнота цифрового следа) проверяемую поверхность**.

## Acceptance Criteria

1. **Фильтр по объекту (тип сущности + сотрудник).** **Given** в `audit_logs` события по нескольким сотрудникам, **When** клиент с `audit.view` шлёт `GET /api/audit/logs/?entity_type=employee_status&entity_id=<employee_uuid>`, **Then** возвращаются ТОЛЬКО записи с этим `entity_type` и `entity_id`, ни одной чужой. **And** `entity_id` интерпретируется как UUID сотрудника (реш. 4.4 №1) — фильтрация по integer-PK конкретной строки статуса через `entity_id` невозможна (он в `new_value`). [Source: epics.md:642; prd.md:160 «по объекту»; 4-4 AC-1/реш.№1; apps/audit/models.py:34]
2. **Фильтр по пользователю (актору).** **Given** события от разных операторов, **When** `GET /api/audit/logs/?actor=<user_id>`, **Then** только записи с этим `actor_user_id` (строка, не FK — ARCH-007/BR-ACCOUNT-002). [Source: prd.md:160 «по пользователю»; architecture.md:747; apps/audit/models.py:30]
3. **Фильтр по типу действия.** **Given** записи с разными `action`-кодами, **When** `GET /api/audit/logs/?action=STATUS_CREATED`, **Then** только события этого кода. **And** read-путь НЕ валидирует код против реестра (closed-world — забота записи 4.4/coverage 4.6); неизвестный код просто даёт пустой набор. [Source: prd.md:160 «по типу»; epics.md:638]
4. **Фильтр по периоду (диапазон `created_at`, полуоткрытый).** **Given** события за разные даты, **When** `GET /api/audit/logs/?created_from=<ts>&created_to=<ts>`, **Then** записи с `created_at` в полуоткрытом `[created_from, created_to)` (консистентно с календарными `[start,end)` E3); оба края опциональны и комбинируются с прочими фильтрами через AND. **And** даты из query парсятся tz-aware (проектная локаль), битая дата → 400 VALIDATION_ERROR. [Source: epics.md:642 «по сотруднику И периоду»; prd.md:160; architecture.md:432; core/api/views.py:204-208 (tz-парс прецедент)]
5. **Детерминированная сортировка + LimitOffset-пагинация на `(-created_at, id)`.** **Given** набор > одной страницы, **When** клиент листает `?limit=&offset=`, **Then** ответ — конверт `{count, next, previous, results}` (default limit 50, **max 200**), сортировка `created_at DESC` с ОБЯЗАТЕЛЬНЫМ tie-breaker `id` последним — страницы не теряют/не дублируют строки при равных `created_at` (bulk-аудит 4.4 пишет N строк с одинаковым `created_at`). [Source: epics.md:642 «пагинация с ordering+id»; architecture.md:427,31; apps/audit/services.py:82]
6. **Гейт прав `audit.view` (PermissionService, per-request).** **Given** запрос БЕЗ `audit.view`, **When** он бьёт `GET /api/audit/logs/`, **Then** **403 PERMISSION_DENIED**; **Given** запрос с `audit.view` (ORGD/ADMIN), **Then** 200. **And** проверка через `PermissionService` на каждый запрос, без сессионного кэша (ARCH-SEC-031); гейт декларативный (`permission_map`), роут зарегистрирован в RBAC-матрице. [Source: epics.md:638; architecture.md:755,450; seed_operations.py:22,64; test_rbac_matrix.py]
7. **Read-only — никаких write-глаголов.** **Given** эндпоинт аудита, **When** клиент шлёт `POST/PUT/PATCH/DELETE`, **Then** **405 Method Not Allowed** — поверхность строго `GET` (list[+detail]); запись только через `record()` (4.3), правка/удаление невозможны (append-only БД 4.2 + FR-36). [Source: prd.md:160,247; architecture.md:598,756 ARCH-SEC-032; 4-2 story]
8. **Форма ответа раскрывает поля `AuditLog` (snake_case, плоско).** **Given** успешный `GET`, **Then** каждая запись в `results` несёт поля FR-36 «актор, тип, объект, время, IP, было→стало»: `id`, `actor_user_id`, `action`, `entity_type`, `entity_id`, `old_value`, `new_value`, `reason`, `request_id`, `ip_address`, `user_agent`, `created_at` — snake_case end-to-end, read-only (сериализатор без `create/update`). [Source: prd.md:160; 4-1 story:83-98; architecture.md:427,447]
9. **Гейт зелёный + анти-gold-plating.** Только: api-слой read-only в `apps/audit` + selector + фильтры + пагинация + строки в RBAC-матрицу + тесты (+ опц. read-индекс — см. реш. №1). НЕ строится: запись/новые коды/coverage(4.6)/dismissal(4.7)/экспорт-маскирование(E20)/UI(E8/E10)/request_id-как-фильтр/scope-сужение по division (реш. №3). `make gate` зелёный (Postgres :5433); ruff чист; на каждый код ошибки эндпоинта — отдельный тест. [Source: epics.md:636-650; architecture.md:33,437]

## Tasks / Subtasks

- [x] **Task 1 — селектор чтения** (AC: 1-5)
  - [x] Создать `apps/audit/selectors.py` → `class AuditLogSelector` с `list(actor, *, entity_type=None, entity_id=None, actor_user_id=None, action=None, created_from=None, created_to=None) -> QuerySet[AuditLog]`. Фильтры применяются через AND, только переданные; `order_by("-created_at", "id")` ЗДЕСЬ (не во view). `actor` — первым аргументом по контракту (architecture.md:451), но при отсутствии scope-указания (реш. №3) видимость не сужает.
  - [x] `get(actor, pk) -> AuditLog` для retrieve (`.get(pk=...)` в селекторе, НЕ `get_object_or_404` во view; реш. №2 определяет, нужен ли retrieve).
  - [x] Чтение `AuditLog.objects` напрямую внутри `apps/audit` — легально (AST-бан 4.3 запрещает импорт `apps.audit.models` только ИЗВНЕ app).
- [x] **Task 2 — сериализатор формы** (AC: 8)
  - [x] Создать `apps/audit/api/__init__.py` (пустой) + `apps/audit/api/serializers.py` → `AuditLogSerializer(serializers.ModelSerializer)`, `Meta.model = AuditLog`, явный `fields = [id, actor_user_id, action, entity_type, entity_id, old_value, new_value, reason, request_id, ip_address, user_agent, created_at]`, все read-only. Без `create()/update()` (architecture.md:447, AST-чек).
- [x] **Task 3 — ViewSet + гейт + пагинация** (AC: 5, 6, 7)
  - [x] Создать `apps/audit/api/views.py`: `AuditLogPagination(LimitOffsetPagination)` с `default_limit=50, max_limit=200`; `class AuditLogViewSet(RequirePermissionMixin, viewsets.ReadOnlyModelViewSet)` с `permission_map={"list":"audit.view","retrieve":"audit.view"}` (импорт `from apps.core.api.permissions import RequirePermissionMixin` — core-сеам, НЕ импортировать operations), `pagination_class=AuditLogPagination`, `serializer_class=AuditLogSerializer`. Тонкий: парсит/валидирует query-фильтры формой → зовёт `AuditLogSelector.list(actor=request.actor_id, **filters)` → пагинирует → сериализует.
  - [x] Query-фильтры валидировать DRF-сериализатором фильтров (`entity_id` как `UUIDField`, `created_from/created_to` как datetime, tz-aware) → битый ввод = `ValidationError` → 400 VALIDATION_ERROR (через единый хендлер, без ручного `Response`).
  - [x] `ReadOnlyModelViewSet` → write-методы дают 405 автоматически (AC-7).
- [x] **Task 4 — URL + монтаж** (AC: 5)
  - [x] Создать `apps/audit/api/urls.py`: `DefaultRouter().register("logs", AuditLogViewSet, basename="audit-log")`, `urlpatterns = router.urls`. Эндпоинт = `/api/audit/logs/`.
  - [x] Изменить `config/urls.py`: добавить `path("api/audit/", include("apps.audit.api.urls"))` (рядом с `api/core/`, `api/operations/`).
- [x] **Task 5 — RBAC-матрица (ОБЯЗАТЕЛЬНЫЙ MODIFY)** (AC: 6)
  - [x] В `apps/operations/tests/test_rbac_matrix.py` добавить в `MATRIX`: `"audit-log-list": _Gate("audit.view")` (+ `"audit-log-detail": _Gate("audit.view")` если retrieve включён, реш. №2). Без этого `test_matrix_covers_every_registered_route` краснеет (жёсткий completeness-гейт по всему root-resolver). ALLOW для ADMIN/ORGD, DENY для прочих/анонима выводятся из seed.
- [x] **Task 6 — read-индекс (УСЛОВНО, реш. №1)** (AC: 9)
  - [x] ЕСЛИ реш. №1=A: создать `apps/audit/migrations/0003_audit_read_indexes.py` с индексом ТОЛЬКО под фактически отгружаемую неиндексированную фильтр-ось (рек. `(actor_user_id, created_at)`), имя `idx_audit_<...>`; round-trip forward→reverse→forward проверить. `makemigrations --check` перестанет быть пустым (отличие от 4.2-4.4 — осознанно). ЕСЛИ реш. №1=B (дефолт): миграции НЕТ, `makemigrations --check` пуст; индекс-профиль отложен до реальных данных (deferred-work).
- [x] **Task 7 — тесты** (AC: 1-9)
  - [x] Новый `apps/audit/tests/test_audit_read_api.py` (`@pytest.mark.django_db`, Postgres; фабрики/`record()` для наполнения). Кейсы: фильтр по объекту (entity_type+entity_id → только свои); по actor; по action; по периоду `[from,to)` (граница включ/исключ); пагинация limit/offset с детерминизмом на равных `created_at` (bulk-сценарий — страницы не теряют строки); max_limit=200 капинг; гейт 403 без `audit.view` / 200 с ним; 405 на POST/PUT/PATCH/DELETE; 400 на битый `entity_id`/дату; форма ответа = 12 полей snake_case.
  - [x] Поведенческий ALLOW/DENY через RBAC-матрицу (ADMIN/ORGD allow, OMD/аноним deny).
- [x] **Task 8 — гейт, регрессия, анти-gold-plating** (AC: 9)
  - [x] `make gate` зелёный (Postgres :5433); `ruff check` (E,F) чист на изменённых/новых файлах; `makemigrations --check` пуст (реш. №1=B) ИЛИ ровно один ожидаемый `0003` (реш. №1=A). `ruff format` — по своему файлу (VAPS-конвенция), гейт = ruff check.
  - [x] Регрессия нулевая: существующие RBAC/seed-тесты зелёные; AST-бан `test_audit_write_boundary` зелёный (новый api-слой НЕ импортирует `operations` и НЕ пишет в модель).
  - [x] НЕ тронуты: `seed_operations.py` (право есть), `apps/audit/models.py`, миграции `0001`/`0002`, `audit-events.yaml`, сервисы записи, чужие app.

## Dev Notes

### Цель (одним предложением)

4.5 — дать read-only HTTP-поверхность `GET /api/audit/logs/` над `audit_logs` ВНУТРИ `apps/audit`, с серверными фильтрами (объект/пользователь/тип/период), детерминированной LimitOffset-пагинацией `(-created_at, id)` и гейтом `audit.view`, закрыв FR-36 «журнал доступен и фильтруем без доступа к БД». Первый потребитель-на-чтение аудита; образец read-API для будущих аудит-журналов (E5 сдачи).

### Авторитет спеки (что строим и откуда)

- **epics.md Story 4.5 (#L636-642):** «read-only API с фильтрами (объект, пользователь, тип, период) под permission `audit.view` … журнал доступен без доступа к БД (FR-36). AC: **Given** фильтр по сотруднику и периоду, **Then** только его события, отсортированы, пагинация с ordering+id.»
- **prd.md FR-36 (#L160):** «Каждое значимое действие пишется в неизменяемый Аудит (актор, тип, объект, время, IP, было/стало); журнал фильтруется по объекту/пользователю/типу/периоду; удаление и правка невозможны через интерфейс.» + SM-4 (#L213) «100% назначений/overrides восстановимы из Аудита».
- **architecture.md:427 (Format Patterns):** «Списки — конверт limit/offset `{count, next, previous, results}`; default 50, max 200; ordering обязателен на каждом list-endpoint, tie-breaker `id` последним (иначе пагинация молча теряет строки).» + #L31 PageNumberPagination ОТВЕРГНУТ.
- **architecture.md:442-453 (Layer Contract):** `view → сервис → (селекторы, модели, аудит)`; чтение — в СЕЛЕКТОРЕ (#L451 «каждый list-селектор принимает actor первым и сам сужает видимость»); `serializer.create/update` и `get_object_or_404` во view запрещены (#L447).
- **architecture.md:598 (API surface):** `/api/audit/` зафиксирован как **read-only**. #L413 нейминг `api/{serializers,views,urls}.py` + селектор `<Ctx><Domain>Selector`.
- **architecture.md:755 ARCH-SEC-031:** авторизация только `PermissionService`, на КАЖДЫЙ запрос, без сессионного кэша. **:756 ARCH-SEC-032:** аудит append-only enforced БД → строго read-only. **:754 ARCH-SEC-030:** идентичность из `request.actor_id`, не парсить X-User-Id в audit. **:747 ARCH-007/BR-ACCOUNT-002:** `actor_user_id` — строка.

### 🔑 Решения по реализации (ДЕФОЛТЫ — подтвердить/переопределить; вопросы собраны в конце)

1. **Read-индексы read-пути — ОТЛОЖИТЬ (дефолт=B) vs внести `0003` сейчас (A).**
   ⚠️ На `audit_logs` ровно ОДИН индекс `idx_audit_entity (entity_type, entity_id, created_at)` (models.py:47-52) — покрывает фильтр «объект+период» и сортировку. Непокрыты: `actor_user_id`-фильтр, `action`-фильтр, глобальный `created_at`-only список → seq scan. deferred-work.md:378 ЯВНО парковал «профиль индексов под РЕАЛЬНЫЕ запросы чтения — стори 4.5».
   *Дефолт B (РЕКОМЕНД.):* индексы НЕ добавлять. «Профиль под реальные запросы» требует реальных данных; на пилоте `audit_logs` почти пуст → любой индекс сейчас = спекулятивный «впрок» (нарушает анти-gold-plating, architecture.md:33). `makemigrations --check` остаётся пустым (консистентно с 4.2-4.4). Индекс-профиль — отдельный follow-up при росте/профилировании (перезаписать deferred-work.md:378).
   *Альтернатива A:* внести `0003` с ОДНИМ индексом `(actor_user_id, created_at)` (путь «что делал актор X за период» — самый вероятный аудиторский запрос помимо entity). Тогда `makemigrations --check` перестаёт быть пустым (осознанное отличие). Индекс ТОЛЬКО под отгружаемую ось, не «впрок» (как 4.1 дал ровно один индекс §4.6).
2. **Detail-эндпоинт (`GET /api/audit/logs/{id}/`) — ВКЛЮЧИТЬ (дефолт) vs только list.**
   epics-AC называет только list+фильтры+пагинация. `ReadOnlyModelViewSet` даёт retrieve почти бесплатно. *Дефолт (РЕКОМЕНД.):* включить list+retrieve (полезно 4.6/E10, обе строки в матрицу). *Альтернатива:* только list (`http_method_names` или отдельный mixin), одна строка в матрице — строгий анти-gold-plating. Низкая ставка.
3. **Scope-сужение аудита по подразделению — НЕТ (дефолт), флат `audit.view` видит всё.**
   ⚠️ STOP (architecture.md:33): право `audit.view` в seed — ПЛОСКОЕ, без division-scope; архитектура МОЛЧИТ, сужается ли чтение аудита по подразделению актора. *Дефолт (РЕКОМЕНД.):* НЕ изобретать scope-narrowing; держатель `audit.view` видит весь журнал (селектор принимает `actor` по контракту, но не сужает). Если scope нужен — решение заказчика, не выбор агента. → вынесено в Open Q.
4. **`ip_address`/`user_agent` в ответе — отдавать как есть (дефолт), маскирование = E20.**
   FR-36 явно называет «IP» в составе журнала → `ip_address` отдаём. Маскирование чувствительных полей — E20 (вне 4.5). `user_agent` (§4.6, не в FR-36) — отдаём. Низкая ставка; флаг «не светить UA» — за Bratan при нужде.
5. **Граница периода — полуоткрытая `[created_from, created_to)` (дефолт).** Консистентно с календарными `[start,end)` E3 (ARCH-DATA-023). Зафиксировано в AC-4.

### Что УЖЕ есть — переиспользовать / НЕ дублировать

- **Право `audit.view`** — УЖЕ в `seed_operations.py:22` (`("audit.view","Просмотр аудита")`), замаплено на ORGD (`:64-65`) + ADMIN через `*`. Под тестами (`test_seed.py:22`, `test_permission_service.py:28`). 4.5 НЕ заводит право — только ссылается в `permission_map`.
- **Гейт-механика** — `apps/core/api/permissions.py` `RequirePermissionMixin` (декларативный `permission_map`, читает `request.effective_permissions`, ставится первым в MRO). Сеам `apps/operations/api/authz.py:EffectivePermissionsResolver` (в `DEFAULT_AUTHENTICATION_CLASSES`) зовёт `PermissionService.effective_permissions(actor_id)`. Импорт `core` из `audit` легален (core ↛ all = core никого не импортирует; его — все могут; architecture.md:585). НЕ импортировать `apps.operations.*` из `audit`.
- **Read-API exemplar** — `apps/operations/api/views.py:48-60` `UserRoleViewSet` (фильтруемый append-only список без write + ручная пагинация) — ближайший шаблон. Полный — `apps/core/api/views.py` (Employee/Division ViewSets), но там `PageNumberPagination` (НЕ копировать — отвергнутый канон). URL-паттерн: `DefaultRouter().register(...)`, `urlpatterns = router.urls`; монтаж в `config/urls.py`.
- **Exception handler** — `apps/core/api/exception_handler.py` (§36-конверт `{error_code, message, details, request_id, timestamp}`); 403→PERMISSION_DENIED, 400→VALIDATION_ERROR, 404→ENTITY_NOT_FOUND (коды уже в `docs/registries/error-codes.yaml`). НЕ ловить try/except + ручной Response (architecture.md:433). DomainError для read-пути НЕ нужен.
- **Селекторы-прецеденты** — `apps/operations/statuses/selectors.py:EmployeeStatusSelector` (bulk-first reads), `apps/operations/selectors.py:OpsUserRoleSelector`, `apps/core/selectors.py`. Конвенция `<Ctx><Domain>Selector`, возвращает QuerySet.
- **tz-парс query-дат** — прецедент `apps/core/api/views.py:204-208` (`VacancyViewSet`, `timezone.make_aware` в проектной локали).
- **AuditLog поля** (models.py:29-55): `id`(UUID PK), `actor_user_id`(CharField), `action`(CharField), `entity_type`(CharField), `entity_id`(**UUIDField**), `old_value`/`new_value`(JSONField nullable), `reason`(TextField), `request_id`(CharField), `ip_address`(GenericIPAddressField), `user_agent`(TextField), `created_at`(DateTimeField, без auto_now_add). `db_table="audit_logs"`. БЕЗ `updated_at`, БЕЗ `Meta.ordering`.

### Подводные камни для dev-агента

- **`entity_id` = employee UUID, НЕ PK строки** — «фильтр по объекту» = `entity_type` + `entity_id`(UUID). НЕ закладывать контракт «дай аудит по status_id=N» через `entity_id` (integer-PK строки лежит в `new_value` JSON).
- **actor-поле = `actor_user_id`** (строка), НЕ `actor`/`created_by`/FK. Сериализатор/фильтр — по `actor_user_id` (query-param можно назвать `actor`, маппить на `actor_user_id`).
- **RBAC-матрица — обязательный MODIFY** (`test_rbac_matrix.py`). Забыть = красный suite в operations, не в audit. Имена роутов `audit-log-list`/`audit-log-detail` (от `basename`).
- **Нет дефолтной сортировки** у модели → `order_by("-created_at", "id")` ЯВНО в селекторе. `id`-tiebreaker НЕСУЩИЙ: bulk-аудит 4.4 пишет N строк ОДНИМ `Clock.now()` (services.py:82) → равные `created_at` реальны, без `id` LimitOffset молча теряет строки.
- **`api/audit/` нет в root urlconf** — без правки `config/urls.py` эндпоинт недостижим.
- **read-API ОБЯЗАН быть в `apps/audit`** (4.3 AC-4) — чтобы легально читать `AuditLog.objects` мимо AST-бана. НЕ выносить во view core/operations.
- **Пагинация = LimitOffset** (`default_limit=50, max_limit=200`) — НЕ `PageNumberPagination` (architecture.md:31,427). Прецедент `operations/api/views.py:16` задаёт только `default_limit` — 4.5 обязан добавить и `max_limit`.
- **400 на битый фильтр** — валидировать query DRF-формой (UUID/дата), отдать `ValidationError`→VALIDATION_ERROR; не маппить вручную.
- **STOP по scope** (реш. №3) — НЕ изобретать division-сужение; молчание архитектуры = спросить/дефолт «видит всё».
- **ruff format — по ФАЙЛУ**, гейт = `ruff check` (E,F) (VAPS-конвенция).

### Тесты стори

- **Новый** `apps/audit/tests/test_audit_read_api.py` (Postgres): фильтры объект/actor/action/период; пагинация-детерминизм на равных `created_at` (bulk); max_limit капинг; гейт 403/200; 405 на write; 400 на битый ввод; форма 12 полей; ALLOW/DENY через матрицу. На каждый код ошибки — отдельный тест (architecture.md:437).
- **Регрессия:** `make gate` зелёный (Postgres :5433); RBAC/seed-тесты зелёные; AST-бан зелёный; `makemigrations --check` пуст (реш. №1=B) или ровно `0003` (A).

### Definition of Done

- [ ] `GET /api/audit/logs/` (list[+retrieve, реш.№2]) в `apps/audit/api/` + `AuditLogSelector`; read-only, 405 на write.
- [ ] Фильтры объект(entity_type+entity_id UUID)/actor/action/период `[from,to)`; сортировка `(-created_at, id)`; LimitOffset 50/200.
- [ ] Гейт `audit.view` (PermissionService, per-request) → 403/200; строки в RBAC-матрице (list[+detail]).
- [ ] Форма ответа = 12 полей `AuditLog` snake_case, read-only сериализатор.
- [ ] `config/urls.py` монтирует `api/audit/`.
- [ ] Реш.№1: индекс отложен (B, миграции нет) ИЛИ `0003` под одну отгружаемую ось (A).
- [ ] Тесты: фильтры/пагинация/403/405/400/форма/матрица. На каждый код ошибки — тест.
- [ ] Анти-gold-plating: нет записи/новых кодов/coverage(4.6)/dismissal(4.7)/экспорта-маскирования(E20)/UI/request_id-фильтра/scope-сужения.
- [ ] `make gate` зелёный, ruff чист, регрессия нулевая, AST-бан зелёный. Completion Notes без вранья.

### Project Structure Notes

- **Вариация vs «≤5 файлов»:** 4.5 создаёт api-слой (`api/__init__`, `api/serializers`, `api/views`, `api/urls`, `selectors`, тест) + 2 MODIFY (`config/urls.py`, `test_rbac_matrix.py`) [+ опц. `0003`]. Это ОСОЗНАННО: architecture.md:413 определяет `api/{serializers,views,urls}` как ЕДИНИЦУ read-эндпоинта; дробление раздробило бы одну API-поверхность. Прецедент вариации — 4.4 (5 код-файлов как одна сквозная стори). Один эндпоинт с бизнес-логикой = одна стори (CLAUDE.md API Decomposition).
- **Новые:** `apps/audit/selectors.py`; `apps/audit/api/{__init__,serializers,views,urls}.py`; `apps/audit/tests/test_audit_read_api.py` [+ `apps/audit/migrations/0003_audit_read_indexes.py` при реш.№1=A]. **Изменяемые:** `config/urls.py`; `apps/operations/tests/test_rbac_matrix.py`. **НЕ трогать:** `seed_operations.py` (право есть), `apps/audit/models.py`, миграции `0001`/`0002`, `audit-events.yaml`, сервисы записи, чужие app.

### References

- [Source: _bmad-output/planning-artifacts/epics.md#L600-650] — Epic 4; Story 4.5 (#L636-642): фильтры объект/пользователь/тип/период под `audit.view`, AC «только его события, отсортированы, пагинация ordering+id».
- [Source: _bmad-output/planning-artifacts/prd.md#L160] — FR-36 (журнал фильтруется по объекту/пользователю/типу/периоду; правка/удаление невозможны через интерфейс); #L213 SM-4; #L245-247 NFR безопасность/аудит.
- [Source: _bmad-output/planning-artifacts/architecture.md#L427,31] — Format Patterns: LimitOffset-конверт default 50/max 200, ordering+id tiebreaker; PageNumber отвергнут.
- [Source: _bmad-output/planning-artifacts/architecture.md#L442-453,447,451] — Layer Contract: чтение в селекторе (actor-first), serializer без create/update, get_object_or_404 запрещён.
- [Source: _bmad-output/planning-artifacts/architecture.md#L413,598,409] — api/ нейминг; `/api/audit/` read-only; URL-канон plural kebab + DefaultRouter basename `<ctx>-<resource>`.
- [Source: _bmad-output/planning-artifacts/architecture.md#L754-756,747] — ARCH-SEC-030/031/032, ARCH-007/BR-ACCOUNT-002 (actor строка).
- [Source: Backend/VAPS/apps/audit/models.py#L29-55] — AuditLog поля/типы, db_table, единственный индекс idx_audit_entity, нет Meta.ordering.
- [Source: Backend/VAPS/apps/core/api/permissions.py#L21-52] — RequirePermissionMixin + permission_map (гейт для переиспользования).
- [Source: Backend/VAPS/apps/operations/api/authz.py#L6-30; apps/operations/services.py#L14-56] — EffectivePermissionsResolver-сеам + PermissionService.
- [Source: Backend/VAPS/apps/operations/management/commands/seed_operations.py#L22,64] — `audit.view` УЖЕ в seed → ORGD (+ ADMIN `*`).
- [Source: Backend/VAPS/apps/operations/tests/test_rbac_matrix.py] — completeness-гейт MATRIX (обязательный MODIFY).
- [Source: Backend/VAPS/apps/operations/api/views.py#L16,48-60; apps/core/api/views.py#L24,33-65,204-208] — read-API exemplars; LimitOffset/PageNumber; tz-парс query-дат.
- [Source: Backend/VAPS/config/urls.py] — root urlconf (добавить api/audit/).
- [Source: Backend/VAPS/apps/core/api/exception_handler.py; docs/registries/error-codes.yaml] — §36-конверт; PERMISSION_DENIED/VALIDATION_ERROR/ENTITY_NOT_FOUND.
- [Source: _bmad-output/implementation-artifacts/4-4-аудит-мутаций-статусов.md] — 11 action-кодов, entity_type ∈ {employee_status,secondment,override}, entity_id=employee_id UUID (реш.№1), PK в new_value.
- [Source: _bmad-output/implementation-artifacts/4-3-сервис-записи-и-request-id.md#L32] — read-API 4.5 живёт ВНУТРИ apps/audit.
- [Source: _bmad-output/implementation-artifacts/deferred-work.md#L378] — read-path индексы → парковано в 4.5 (реш.№1).

## Dev Agent Record

### Agent Model Used

claude-opus-4-8[1m] (Opus 4.8, 1M context)

### Debug Log References

- **Подтверждённые решения (Bratan):** №1=B (read-индексы отложены — миграции НЕТ, `makemigrations --check` пуст, как 4.2–4.4); №2 retrieve включён; №3 без division-scope (`audit.view` плоское → видит всё); №4 `ip_address`/`user_agent` как есть; №5 период `[from, to)` полуоткрытый.
- **405 vs 403 на write-глаголах:** `RequirePermissionMixin.initial` рано выходит, только если метод НЕ в `http_method_names`. У `ReadOnlyModelViewSet` дефолтный `http_method_names` включает post/put/patch/delete → write-глагол ушёл бы в `action=None` → 403 (вводящий в заблуждение). Решение: `http_method_names = ["get","head","options"]` (паттерн core GET-only viewsets) → write-метод не в списке → миксин рано выходит → DRF отдаёт 405. Залочено тестом `test_write_verbs_not_allowed`.
- **retrieve через селектор (не get_object_or_404):** `get_object()` переопределён на `AuditLogSelector.get()` (architecture.md#L451 — `.get(pk=)` в селекторе, не во view); `AuditLog.DoesNotExist` → `NotFound("ENTITY_NOT_FOUND")` → 404 через единый хендлер.
- **VERIFIED:** focused `test_audit_read_api.py` — 21 passed; `make gate` (Postgres :5433) — **1368 passed** +39 (read-API тесты + параметризация rbac-матрицы на 2 новых роута × 9 акторов), 24 deselected, `makemigrations --check` → «No changes detected» (реш. №1=B), `ruff check`/`ruff format --check` чисты, 26s.

### Completion Notes List

4.5 — read-only API чтения аудита (`GET /api/audit/logs/`): ПЕРВЫЙ потребитель-на-чтение записанного аудита (FR-36). API-слой построен с нуля ВНУТРИ `apps/audit` (AST-бан 4.3). `make gate` зелёный (1368 passed, +39).

- ✅ **Task 1:** `apps/audit/selectors.py::AuditLogSelector` — `list(actor, *, filters)` (AND-фильтры объект/actor/action/период, `order_by("-created_at","id")`) + `get(actor, pk)` для retrieve. Чтение `AuditLog.objects` внутри app (легально). Видимость НЕ сужается (реш. №3 — флат `audit.view`).
- ✅ **Task 2:** `apps/audit/api/serializers.py` — `AuditLogSerializer` (ModelSerializer, 12 полей, read-only) + `AuditLogFilterSerializer` (валидация query: `entity_id` UUID, `created_from/to` datetime → битый ввод 400).
- ✅ **Task 3:** `AuditLogViewSet(RequirePermissionMixin, ReadOnlyModelViewSet)` — `permission_map={"list":"audit.view","retrieve":"audit.view"}` (core-сеам, без импорта operations), `AuditLogPagination(LimitOffset, default 50/max 200)`, `http_method_names` GET-only (write→405), `get_queryset` валидирует фильтры → селектор, `get_object` → селектор.
- ✅ **Task 4:** `apps/audit/api/urls.py` (`DefaultRouter` register "logs" basename "audit-log") + монтаж `path("api/audit/", …)` в `config/urls.py`.
- ✅ **Task 5:** RBAC-матрица — `audit-log-list`/`audit-log-detail` → `_Gate("audit.view")` в `test_rbac_matrix.py` (completeness-гейт зелёный; ALLOW ORGD/ADMIN, DENY прочие/аноним из seed).
- ✅ **Task 6 (реш. №1=B):** read-индексы НЕ добавлены — миграции НЕТ, `makemigrations --check` пуст. Индекс-профиль под реальные данные остаётся в deferred-work:378.
- ✅ **Task 7:** `apps/audit/tests/test_audit_read_api.py` (21 теста): фильтры объект/actor/action/период `[from,to)`; пагинация-детерминизм на равных `created_at`; max_limit/default_limit; гейт 403(no-perm/аноним)/200; 405 на POST/PUT/PATCH/DELETE; 400 на битый entity_id/дату; форма 12 полей; retrieve 200/404/403.
- ✅ **Task 8:** `make gate` зелёный (1368 passed), ruff check/format чисты, makemigrations пуст, регрессия нулевая, AST-бан `test_audit_write_boundary` зелёный (api-слой не импортирует operations, не пишет в модель).
- **Анти-gold-plating:** нет записи/новых кодов/coverage(4.6)/dismissal(4.7)/экспорта-маскирования(E20)/UI/request_id-фильтра/scope-сужения; модель/миграции 0001-0002/seed/audit-events.yaml не тронуты.
- **DoD:** все пункты Definition of Done выполнены (эндпоинт list+retrieve, фильтры+сортировка+пагинация, гейт+матрица, форма, реш.№1=B без миграции, тесты на каждый код ошибки, AST-бан, гейт зелёный).

**Статус → review.** Артефакты НЕ закоммичены агентом.

### File List

**Создано:**
- `Backend/VAPS/apps/audit/selectors.py` — `AuditLogSelector` (list-фильтры + get)
- `Backend/VAPS/apps/audit/api/__init__.py`
- `Backend/VAPS/apps/audit/api/serializers.py` — `AuditLogSerializer` + `AuditLogFilterSerializer`
- `Backend/VAPS/apps/audit/api/views.py` — `AuditLogViewSet` + `AuditLogPagination`
- `Backend/VAPS/apps/audit/api/urls.py` — router `audit-log`
- `Backend/VAPS/apps/audit/tests/test_audit_read_api.py` — 21 теста

**Изменено:**
- `Backend/VAPS/config/urls.py` — монтаж `path("api/audit/", …)`
- `Backend/VAPS/apps/operations/tests/test_rbac_matrix.py` — строки `audit-log-list`/`audit-log-detail` в `MATRIX`

## Change Log

- 2026-06-27 — Dev (bmad-dev-story, Opus 4.8, TDD): реализована стори 4.5 — read-only API чтения аудита (FR-36). `GET /api/audit/logs/` (list+retrieve) ВНУТРИ `apps/audit`: `AuditLogSelector` (фильтры объект/actor/action/период `[from,to)`, сортировка `(-created_at, id)`) + `AuditLogSerializer`/`AuditLogFilterSerializer` + `AuditLogViewSet(RequirePermissionMixin, ReadOnlyModelViewSet)` под `audit.view` (УЖЕ в seed → ORGD/ADMIN) + LimitOffset 50/200 + GET-only (write→405). Монтаж в `config/urls.py`; строки в RBAC-матрицу. Решения: №1=B (индексы отложены, миграции нет), №2 retrieve вкл, №3 без scope, №4 ip/UA как есть, №5 `[from,to)`. 21 новый тест. `make gate` зелёный (Postgres :5433: **1368 passed** +39, 24 deselected, makemigrations пуст, ruff check/format чисты, 26s). Регрессия нулевая. Артефакты НЕ закоммичены агентом. Status → review.


### Review Findings

**Code review 2026-06-27 (bmad-code-review, Opus 4.8 — same-model caveat; 3 слоя Blind/Edge/Acceptance Auditor; scoped diff 8 файлов / ~475 строк, uncommitted, vs 4bdea8e). Acceptance Auditor: все 9 AC SATISFIED вживую + 5 решений соблюдены (read в селекторе, LimitOffset не PageNumber, гейт через core-сеам без импорта operations, живёт в apps/audit, реш.№1=B без миграции). Триаж: 0 decision · 3 patch · 0 defer · 7 dismiss. ВСЕ 3 patch ПРИМЕНЕНЫ+ВЕРИФИЦИРОВАНЫ (make gate 1369 passed).**

- [x] [Review][Patch] **Битый UUID в retrieve-pk → 500 вместо 404** (Blind+Edge+Auditor, HIGH; Edge эмпирически подтвердил, я перепроверил: `GET /api/audit/logs/not-a-uuid/` → `AuditLog.objects.get(pk="0")` бросает Django `ValidationError` [не `DoesNotExist`] на UUID-колонке → единый хендлер не распознаёт → `_internal_error` → 500 INTERNAL_ERROR). DefaultRouter regex `[^/.]+` пропускает не-UUID-сегмент. **ПРИМЕНЕНО:** `get_object` ловит `(AuditLog.DoesNotExist, DjangoValidationError, ValueError)` → `NotFound()` (404 ENTITY_NOT_FOUND; `NotFound()` без аргумента даёт человекочитаемый message — попутно закрыл косметику Auditor F4 «код в message»). +тест `test_retrieve_malformed_pk_is_404`. [views.py get_object] (list-путь не был задет — там `entity_id` валидируется сериализатором → 400)

- [x] [Review][Patch] **`max_limit` тест тавтологичен** (Blind+Auditor F2, MED): `test_pagination_limits` ассертил только атрибуты класса (50/200), не поведение капинга. **ПРИМЕНЕНО:** заменён на `test_pagination_caps_limit_and_defaults` — через `paginator.get_limit()`: `?limit=5000` → 200 (капинг), без `limit` → 50. [test]

- [x] [Review][Patch] **Тесты ошибок не пинят §36-`error_code`** (Auditor F3, LOW): `test_bad_*`/`test_gate_*`/`test_retrieve_unknown` ассертили только HTTP-статус. **ПРИМЕНЕНО:** добавлены ассерты `error_code` ∈ {VALIDATION_ERROR (400), PERMISSION_DENIED (403), ENTITY_NOT_FOUND (404)} — закрытый мир реестра залочен. [test]

- _Dismissed (7):_ Blind «ordering перебивается `OrderingFilter`-бэкендом» — ОПРОВЕРГНУТО (в `REST_FRAMEWORK` нет `DEFAULT_FILTER_BACKENDS`, Edge сверил settings); Blind «пустой `?entity_type=` → 400» — by-design (пустое значение фильтра = некорректный ввод); Blind «`actor`-параметр мёртвый / sees-all не покрыт» — `actor` намеренно forward-compat (реш.№3), а sees-all неявно покрыт (тест-строки от `op-1`/`alice`/`bob` читает `auditor`); Blind «OPTIONS отдаёт метаданные» — проектная DRF-конвенция всех гейченных вьюх (метадата не чувствительна); Blind «`get_object` без `check_object_permissions`» — object-level прав в проекте нет (action-гейт достаточен); Edge «retrieve игнорит валидацию фильтров» — by-design (detail не фильтрует, безвредно); Auditor F5 «naive-tz парс не покрыт тестом» — стандартное DRF+USE_TZ поведение.

**make gate зелёный после патчей (Postgres :5433: 1369 passed +1, 24 deselected, makemigrations «No changes detected», ruff check/format чисты, 24s). Артефакты ревью НЕ закоммичены агентом.**
