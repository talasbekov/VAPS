---
baseline_commit: 00998e7 (+ uncommitted 4.1 app `apps/audit`+модель `AuditLog`, 4.2 append-only-триггер `audit/0002`; ветка e3-catchup-clock-concurrency; E4 in-progress)
---

# Story 4.3: Сервис записи и request_id

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

<!-- ТРЕТЬЯ стори E4 (Аудит). Узкая: ОДНА точка записи `audit.services.record()` + middleware
     `apps/core/middleware.py` (request_id в contextvar, mirror clock.py `_override`) + AST-бан
     прямого импорта `apps.audit.models` вне `apps/audit`. БЕЗ событий мутаций статусов (4.4),
     БЕЗ read-API (4.5), БЕЗ coverage-теста (4.6), БЕЗ seed/runtime-валидации `action` против
     реестра (closed-world — ТЕСТОМ, не рантаймом; прецедент `emitted_codes()⊆реестр`),
     БЕЗ выделенной app-роли БД (E12), БЕЗ X-Forwarded-For / request_id-в-логах (defer).
     КЛЮЧЕВОЙ ФАКТ (architecture.md:464): «request_id: middleware → contextvar; аудит-сервис
     ЧИТАЕТ САМ» — request_id НЕ параметр record(). Аудит СИНХРОННЫЙ-на-мутации (ретро E3):
     record() пишет в ОКРУЖАЮЩЕЙ транзакции вызывающего, не catch-up-материализатор seam 3.12. -->

## Story

As a **разработчик, инструментирующий мутации аудитом**,
I want **единую точку записи `audit.services.record(*, actor, action, entity_type, entity_id, old_value, new_value, reason)`, которая сама дочитывает request-scoped инфраструктуру (request_id, IP, user_agent) из contextvar, заполняемого middleware `apps/core/middleware.py`, плюс AST-бан прямого импорта `apps.audit.models` для записи вне app `apps/audit`**,
so that **запись аудита — ОДНА точка (никто не делает raw-insert мимо сервиса — ARCH-SEC-032/MUST NOT), `created_at` течёт через единственные управляемые часы `Clock.now()` (ARCH-DATA-022), а request_id «не таскается параметрами» через сигнатуры доменных сервисов — он живёт в contextvar и сервис аудита читает его сам (architecture.md:464). Это инфраструктурный seam, на который 4.4 повесит события мутаций статусов, 4.5 — read-API, 4.6 — coverage (FR-36, ARCH-SEC-032, AR-9)**.

## Acceptance Criteria

1. **middleware + contextvar.** **Given** новый `apps/core/middleware.py` с `RequestContextMiddleware`, зарегистрированным **ПЕРВЫМ (внешним)** в `config/settings.py` `MIDDLEWARE`, **When** обрабатывается HTTP-запрос, **Then** request-scoped `ContextVar` (паттерн `clock.py:_override` — `set(token)` + `reset(token)` в `finally`, без утечки между запросами) держит контекст запроса: `request_id` (из входящего заголовка `X-Request-Id`, иначе сгенерированный `uuid4().hex`; обрезан ≤100 — длина поля модели), `ip_address` (из `REMOTE_ADDR`), `user_agent` (из заголовка `User-Agent`); **And** middleware ставит атрибут `request.request_id` (его читает §36-конверт ошибок — `exception_handler.py:63 getattr(request,"request_id",None)`).
2. **record() — единственная точка записи.** **Given** `apps/audit/services.py::record(*, actor: str, action: str, entity_type: str, entity_id, old_value=None, new_value=None, reason: str = "") -> AuditLog`, **When** вызван, **Then** создаётся ровно один `AuditLog` c: `created_at = Clock.now()` (ARCH-DATA-022 — НЕ `auto_now_add`/NOW()); `request_id`/`ip_address`/`user_agent` — прочитаны СЕРВИСОМ из request-context contextvar (при отсутствии активного контекста — system/Celery-путь — `request_id=""`, `user_agent=""`, `ip_address` = sentinel `"0.0.0.0"`, преблагословлён defer'ом ревью 4.1); `actor` обязателен непустой (`ValueError` на пустом — guard программной ошибки); запись идёт в **ОКРУЖАЮЩЕЙ транзакции вызывающего** (синхронно-на-мутации: аудит коммитится/откатывается атомарно с мутацией). **And** record() НЕ валидирует `action` против реестра в рантайме (closed-world enforce ТЕСТОМ — прецедент `exception_handler.emitted_codes()⊆реестр`).
3. **request_id течёт сквозь запрос (ядро AC эпика).** **Given** запись аудита внутри HTTP-запроса (middleware активен), **When** `record()` пишет `AuditLog`, **Then** `AuditLog.request_id` == request_id этого запроса; **And** §36-конверт ошибки того же запроса несёт тот же НЕ-null `request_id` (интеграционный тест через ПОЛНЫЙ middleware-стек + эндпойнт, отдающий ошибку; при переданном `X-Request-Id` — конверт эхо-ит его).
4. **AST-бан импорта модели.** **Given** любой модуль ВНЕ `apps/audit/` (напр. сервис статусов 4.4), **When** ему нужна запись аудита, **Then** он ОБЯЗАН звать `audit.services.record()` и НЕ ИМПОРТИРОВАТЬ `apps.audit.models` напрямую — AST-тест (зеркало `apps/core/tests/test_isolation.py::_imports()`) краснеет на прямом импорте `apps.audit.models` (обе формы: `from apps.audit.models import …` и `from apps.audit import models`) в любом non-test `*.py` под `apps/`/`config/` вне `apps/audit/`. Чтение модели — тоже через app `apps/audit` (read-API 4.5 живёт ВНУТРИ `apps/audit`).
5. **анти-gold-plating + гейт.** Только: middleware + `record()` + AST-бан + их тесты + ОДНА строка регистрации middleware. НЕ строится: события мутаций статусов (4.4), read-API (4.5), coverage-тест (4.6), seed/рантайм-валидация `action`-реестра, выделенная lower-priv app-роль БД (E12), X-Forwarded-For / proxy-IP (E12/deploy), инъекция request_id в логи (architecture:466 — defer). НЕ трогаются: модель `AuditLog`, миграции `0001`/`0002`, `docs/registries/audit-events.yaml`, сервисы статусов, ЛОГИКА `exception_handler` (только добавляется новый интеграционный тест; существующий unit-ассерт `request_id is None` для no-middleware пути — НЕ ломать). `make gate` зелёный (Postgres :5433); ruff чист; `makemigrations --check` пуст (модель не меняется → миграции нет).

## Tasks / Subtasks

- [x] **Task 1 — request_id middleware** (AC: 1)
  - [x] `apps/core/middleware.py` — `RequestContextMiddleware` (классическая Django middleware `def __init__(self, get_response)` / `def __call__(self, request)`). Внутри: вычислить `request_id` (`request.headers.get("X-Request-Id")` или `uuid.uuid4().hex`; `[:100]`), `ip_address = request.META.get("REMOTE_ADDR") or ""`, `user_agent = request.headers.get("User-Agent", "")`. Собрать `RequestContext`, `token = _request_ctx.set(ctx)`; `request.request_id = ctx.request_id`; `try: response = get_response(request)` … `finally: _request_ctx.reset(token)`; `response["X-Request-Id"] = request_id` (реш. №4 — включено).
  - [x] Модуль-уровень: `_request_ctx: ContextVar[RequestContext | None] = ContextVar("request_ctx", default=None)` (mirror `clock.py:20`). `RequestContext` — `@dataclass(frozen=True)` с `request_id/ip_address/user_agent: str = ""`. Аксессоры: `get_request_context() -> RequestContext`, `get_request_id() -> str`.
  - [x] Зарегистрировать `"apps.core.middleware.RequestContextMiddleware"` **первым (внешним)** в `config/settings.py` `MIDDLEWARE`.
- [x] **Task 2 — `audit.services.record()`** (AC: 2)
  - [x] `apps/audit/services.py` — `record(*, actor, action, entity_type, entity_id, old_value=None, new_value=None, reason="") -> AuditLog`. `if not actor: raise ValueError(...)`. `ctx = get_request_context()`; `ip_address=ctx.ip_address or "0.0.0.0"` (sentinel system-пути). `AuditLog.objects.create(..., request_id=ctx.request_id, user_agent=ctx.user_agent, created_at=Clock.now())`.
  - [x] БЕЗ собственного `transaction.atomic()` (окружающая txn вызывающего); БЕЗ рантайм-валидации `action` против реестра (closed-world — тестом).
- [x] **Task 3 — request_id end-to-end + envelope-интеграция** (AC: 3)
  - [x] `apps/audit/tests/test_audit_record.py` (`@pytest.mark.django_db`): (а) под активным `RequestContext` (через middleware-хелпер `_in_request`) `record(...)` → `request_id`/`ip_address`/`user_agent` == значениям контекста; `created_at` через `clock.override(...)`; доменные поля round-trip (вкл. JSONB). (б) БЕЗ контекста → `request_id==""`, `ip_address=="0.0.0.0"`, `user_agent==""`. (в) `record(actor="")` → `pytest.raises(ValueError)`.
  - [x] Интеграционный envelope-тест в `apps/core/tests/test_request_id_middleware.py`: `APIClient` через ПОЛНЫЙ стек на `GET /api/operations/roles/` (X-User-Id `nobody` → 403 §36) с `X-Request-Id: trace-e2e` → JSON `request_id == "trace-e2e"`, НЕ null.
  - [x] Существующий `test_exception_handler.py:70` (`request_id is None` для no-middleware) — НЕ тронут (ассерт верен: CTX={} без request → None).
- [x] **Task 4 — AST-бан прямого импорта `apps.audit.models`** (AC: 4)
  - [x] `apps/audit/tests/test_audit_write_boundary.py` — зеркало `test_isolation.py::_imports()`; сканирует `*.py` под `apps/`+`config/`, исключая `tests` и `apps/audit/`; ловит все 4 формы (`from apps.audit.models import …`, `import apps.audit.models[ as m]`, `from apps.audit.models.x import …`, `from apps.audit import models`).
  - [x] Sanity-тест `test_ban_detects_each_import_form` — каждая запрещённая форма ловится, легитимный `from apps.audit.services import record` — нет.
- [x] **Task 5 — гейт и регрессия** (AC: 5)
  - [x] `make gate` зелёный (Postgres :5433) — **1307 passed**, 24 deselected; `ruff check` чист; `ruff format --check` (6 файлов) чист; `makemigrations --check` → «No changes detected» (модель не тронута). Регрессия нулевая: новые `apps/core/middleware.py`, `apps/audit/services.py`, 3 тест-файла + ОДНА строка `MIDDLEWARE`. `git diff --stat` подтверждён. Модель/`0001`/`0002`/реестр/сервисы статусов/логика handler не тронуты.

## Review Findings

_Code review (bmad-code-review, 2026-06-26, Opus 4.8 — **same-model caveat**: ревьюер = dev; 3 слоя Blind/Edge/Auditor; scoped diff ~386 строк / 5 новых файлов + 1 строка settings MIDDLEWARE; 4.1/4.2 исключены — уже отревьюены). **Acceptance Auditor: PASS — AC-1..5 ВСЕ SATISFIED, все 5 решений-форков соблюдены по дефолтам** (contextvar mirror `clock._override`; `record()` сигнатура поле-в-поле + все 11 полей модели; `created_at=Clock.now()` без auto_now_add; sentinel ip владеет `record()`; actor-guard; окружающая txn; без рантайм-валидации `action`; AST-бан обе формы + reads gated; first в MIDDLEWARE; анти-gold-plating — нет 4.4/4.5/4.6/E12). Blind+Edge сошлись на quality-находках; ни одной High. **0 decision · 1 patch · 2 defer · 10 dismiss.** Dismiss-фон: 1 false-positive (`user_agent` — `TextField`/text, НЕ bounded → нет DataError), остальное by-design/precedent-consistent (entity_id/action-guard = работа 4.6 + форк №3 «без рантайм-валидации»; ip-sentinel при пустом REMOTE_ADDR — корректная защита; header-after-finally — framework-mitigated, Django оборачивает исключения; AST exotic-bypass importlib/relative/parent-pkg — зеркалит принятый прецедент `test_isolation._imports`, реалистичный вектор `from apps.audit.models import` ловится; `INSTALLED_APPS` в диффе — строка 4.1, не 4.3, артефакт baseline `00998e7` до коммита 4.1)._

- [x] [Review][Patch] Хардинг client-supplied `X-Request-Id` (strip + ascii/printable-guard → иначе uuid4) [apps/core/middleware.py] — blank/whitespace-id хранится как есть; крафт-заголовок с CRLF/контрол-символами → `BadHeaderError` при `response["X-Request-Id"]=…` (вне try) → self-inflicted 500; non-latin → `UnicodeEncodeError` (resp-заголовки latin-1). Django блокирует саму инъекцию (риск = 500 + мусорный request_id в аудите/конверте, не RCE). — **ПРИМЕНЕНО+ВЕРИФИЦИРОВАНО:** `(incoming or "").strip()` + `if not incoming.isascii() or not incoming.isprintable(): incoming=""` → fallback `uuid4`. Тест `test_unsafe_or_blank_request_id_is_replaced` (parametrize: whitespace / CRLF / tab+ctl / unicode → генерируется безопасный id, `response["X-Request-Id"]` без BadHeaderError). `make gate` зелёный (**1311 passed**), ruff/format чисты.
- [x] [Review][Defer] IP из `REMOTE_ADDR`, не `X-Forwarded-For` — за прокси пишется адрес прокси [apps/core/middleware.py:59] — deferred, **явно в скоупе AC5 «X-Forwarded-For / proxy-IP (E12/deploy)»**; безопасный XFF требует trusted-proxy конфигурации (E12). (deferred-work.md)
- [x] [Review][Defer] Streaming/lazy-response body видит пустой контекст (reset в finally до итерации тела) [apps/core/middleware.py:64-66] — deferred, латентно: в проекте НЕТ Streaming/FileResponse/async (Edge verified); §36-заголовок ставится на response до return корректно; фикс = gold-plating под несуществующий streaming (кандидат — E6). (deferred-work.md)

## Dev Notes

### Цель (одним предложением)

4.3 — построить ИНФРА-SEAM аудита: единая точка записи `audit.services.record()` (created_at через Clock, request-инфра из contextvar) + middleware request_id (`apps/core/middleware.py`) + AST-бан raw-импорта модели. БЕЗ доменных событий (4.4) и read-API (4.5) — только seam.

### Авторитет спеки (что строим и откуда)

- **epics.md (Story 4.3):** «`audit.services.record(...)` + middleware с request_id в contextvar, So that запись аудита — одна точка, request_id не таскается параметрами. AC: мутация в HTTP → запись содержит request_id; **AST-бан прямого импорта `audit.models` на запись**.»
- **architecture.md:464 (Service Patterns) — КАНОН:** «**request_id: middleware → contextvar; аудит-сервис ЧИТАЕТ САМ.**» → request_id НЕ параметр `record()`; его источник — contextvar.
- **architecture.md:454 (Communication Patterns):** «Аудит: ЕДИНЫЙ сервис записи (actor, action UPPER_SNAKE из реестра, target, before/after JSON, request_id, IP). **MUST NOT: raw insert в аудит-таблицу.**» → record() — единственная точка; AST-бан реализует MUST NOT.
- **architecture.md:511 (дерево):** `core/ … middleware.py # request_id contextvar` — КАНОНИЧНОЕ место middleware: `apps/core/middleware.py` (sibling `clock.py`).
- **architecture.md:450 (Service Patterns):** «Актор: authentication class (core) ставит `request.actor_id: str`; чтение X-User-Id вне core запрещено (AST-чек).» → `actor` приходит из `request.actor_id` (через DRF-auth) и передаётся в record() ВЫЗЫВАЮЩИМ доменным сервисом ЯВНО; record() НЕ читает X-User-Id (это нарушило бы ARCH-SEC-030 и `test_x_user_id_literal_only_in_core_auth`).
- **§4.6 (`VAPS_7.8.2.md:926-941`) + 4.1-модель:** поля строки аудита (record() заполняет все). `created_at` без NOW()-default — Clock-инъекция (зафиксировано 4.1 Dev Notes + docstring `models.py:18-21`).
- **docs/registries/audit-events.yaml `.record_shape`:** «actor_user_id, action, entity_type, entity_id, before/after JSON, request_id, IP» — форма строки подтверждена.

### Разделение «домен / request-инфра» (почему request_id не параметр)

| Поле | Источник в record() | Почему |
|---|---|---|
| `actor` | **явный параметр** | доменный концепт; сервисы статусов уже имеют/валидируют `actor: str` (`status_service._require_actor`); проходит DRF-auth → `request.actor_id` → сервис → record() |
| `action`, `entity_type`, `entity_id`, `old_value`, `new_value`, `reason` | **явные параметры** | доменные данные конкретной мутации |
| `request_id`, `ip_address`, `user_agent` | **из contextvar** (middleware) | request-scoped ИНФРА; «не таскается параметрами» (architecture:464) — иначе 4.4 пришлось бы протаскивать их через КАЖДУЮ сигнатуру сервиса (ровно антипаттерн, против которого contextvar) |
| `created_at` | **`Clock.now()`** в record() | единственные управляемые часы (ARCH-DATA-022); тестируемо `clock.override` |

Следствие для 4.4: доменный сервис зовёт `record(actor=actor, action="STATUS_CREATED", entity_type="employee_status", entity_id=st.id, old_value=…, new_value=…)` — request-инфру НЕ передаёт. Сигнатуры сервисов E3 не меняются.

### 🔑 Решения по реализации (ДЕФОЛТЫ — подтвердить/переопределить; вопросы собраны в конце)

1. **Объём contextvar: ПОЛНЫЙ `RequestContext` (request_id + ip + user_agent) [РЕКОМЕНД.]** vs request_id-only (ip/ua — параметры record()). Рекоменд. полный: ip/ua — такая же request-инфра, как request_id; «не таскается параметрами» применимо к ним же; 4.4 остаётся чистым (передаёт только доменное). Architecture:464 явно называет лишь request_id, но record-shape (454) требует и IP — естественное расширение того же seam. Минимальная альтернатива оставила бы реальный client-IP HTTP-мутаций недостижимым до отдельного протаскивания. **Дефолт: полный RequestContext.**
2. **Sentinel IP для system-пути → `"0.0.0.0"` [РЕКОМЕНД.]**, владелец sentinel — `record()` (аудит знает про NOT NULL своей колонки; core/middleware остаётся generic — пустые строки при отсутствии контекста). Преблагословлён defer'ом ревью 4.1 (system-actor/entity-less события → 4.3/4.4 аккомодируют sentinel'ом). **Дефолт: sentinel в record(), не в middleware.**
3. **Рантайм-валидация `action` против реестра — НЕ делаем [РЕКОМЕНД.].** Closed-world в проекте enforce-ится ТЕСТАМИ, не рантаймом: `exception_handler` держит `emitted_codes()` и ТЕСТ проверяет `⊆ error-codes.yaml`; `test_status_provenance.py:69` так же тестом проверяет код в реестре. record() — тонкая запись; «action не в реестре → СТОП» закрывает 4.6 coverage-тест + дисциплина «новый action тем же PR». Рантайм-валидация = новый загрузчик yaml в горячем пути + дрейф от прецедента. **Дефолт: без рантайм-валидации.**
4. **Response-заголовок `X-Request-Id` — опц., рекоменд. включить** (1 строка `response["X-Request-Id"] = ctx.request_id` перед `return`): дёшево, помогает ops/логам коррелировать. Формально вне буквы AC. **Дефолт: включить; легко снять.**
5. **Дом AST-теста: новый `apps/audit/tests/test_audit_write_boundary.py` [РЕКОМЕНД.]** (app `apps/audit` самодостаточен: модель+append-only+сервис+граница вместе) vs расширить `apps/core/tests/test_isolation.py`. Прецедент: X-User-Id-граница живёт в core (это core/auth-граница); аудит-граница — audit'а. **Дефолт: новый файл в audit.**

### Что УЖЕ есть — переиспользовать / НЕ дублировать

- **`apps/core/clock.py:20,43-70`** — ЭТАЛОН contextvar-инфры: `_override: ContextVar(..., default=None)`, `set(token)`/`reset(token)` в `finally`. Middleware request_id зеркалит ровно этот паттерн (nestable, exception-safe). **`Clock.now()`** (`clock.py:28-35`) — источник `created_at`.
- **`apps/core/api/exception_handler.py:60-63,74,126`** — `_request_id(context)` уже читает `getattr(request,"request_id",None)` и кладёт в §36-конверт; middleware лишь должен ВЫСТАВИТЬ `request.request_id`. Логику handler НЕ трогать.
- **`apps/core/tests/test_isolation.py:14-23` (`_imports`), :26-32 (`_string_constants`), :35-53** — ЭТАЛОН AST-бан-теста (обход `rglob("*.py")`, исключение `tests`/целевой директории, `ast.walk`+`ast.ImportFrom`/`ast.Import`). Task 4 = клон под `apps.audit.models`. (Там же `:107-129` wall-clock-бан, `:132-140` cross-context-import-бан — варианты паттерна.)
- **`apps/core/auth/authentication.py:16-20`** — `XUserIdAuthentication` ставит `request.actor_id` (НЕ дублировать; record() НЕ читает X-User-Id — actor приходит параметром).
- **`apps/core/tests/conftest.py:7-24` (`grant`)** — фикстура APIClient+RBAC+`HTTP_X_USER_ID`; переиспользовать для envelope-интеграции (Task 3).
- **`apps/operations/statuses/services/` (`status_service.py`, `secondment_service.py`, `bulk_status_service.py`)** — БУДУЩИЕ потребители record() (4.4). У всех мутаций уже есть `actor: str` (`status_service._require_actor`). record() спроектирован под их вызов; в 4.3 их НЕ трогаем.
- **`docs/registries/audit-events.yaml`** — `action`-коды (UPPER_SNAKE). record() их НЕ валидирует (реш. №3); seed новых под статусы — 4.4.
- **`apps/audit/models.py` (`AuditLog`, db_table `audit_logs`)** — пишем через `.objects.create()`; модель/миграции 0001/0002 НЕ трогаем.

### Подводные камни для dev-агента

- **request_id — НЕ параметр record().** Соблазн `record(..., request_id=...)`. НЕТ (architecture:464): contextvar, сервис читает сам. Параметром — только доменное + `actor`.
- **record() НЕ читает X-User-Id и НЕ берёт `request`.** Сервисы (architecture:448) «MUST NOT принимать `request`». `actor` приходит ЯВНО (строкой). Чтение X-User-Id вне `core/auth` уронит `test_x_user_id_literal_only_in_core_auth` (ARCH-SEC-030). И не называть переменные/строки с литералом `x_user_id`.
- **`created_at` обязателен в create()** — модель без `auto_now_add` (4.1): `.create(...)` без `created_at` упадёт NOT NULL. record() ВСЕГДА передаёт `Clock.now()`. (Регресс-тест 4.1 `test_created_at_required_no_auto_default` это пиннит.)
- **`reset(token)` в `finally` ОБЯЗАТЕЛЕН** — иначе request_id протечёт в следующий запрос (переиспользование тредов/воркеров). Точно как `clock.override` finally-reset.
- **middleware — ПЕРВЫЙ (внешний)** в `MIDDLEWARE`, чтобы request_id был доступен всему (вкл. ранние ошибки). Существующий комментарий-порядок (`settings.py:31`) про Session→Auth→Message — request_id ставим ВЫШЕ него (обёртка).
- **ip NOT NULL (§4.6).** Пустой `""` в `GenericIPAddressField`/`inet` → `DataError`. Sentinel `"0.0.0.0"` при отсутствии контекста ОБЯЗАТЕЛЕН (реш. №2). Не путать с `None`.
- **AST-бан ловит ОБЕ формы импорта:** `from apps.audit.models import AuditLog` (ImportFrom module=`apps.audit.models`) И `from apps.audit import models` (ImportFrom module=`apps.audit`, alias `models`). Иначе дыра.
- **Postgres-only тест record():** JSONB/`inet`/UUID — Postgres. `@pytest.mark.django_db`, гейт на :5433. (record()-тесты не требуют skip-guard, как append-only 4.2 — они пишут валидную строку, на sqlite тоже пройдут, но канон гейта = Postgres.)
- **Не строить отдельную транзакцию для аудита.** Синхронно-на-мутации (ретро E3): record() в окружающей txn; если мутация откатилась — аудита нет (корректно: аудируем УСПЕШНЫЕ мутации). Это НЕ catch-up-материализатор (seam 3.12) — то про beat-эффекты, аудит туда не входит (спек-дрейф, зафиксирован 4.1).
- **Existing `test_exception_handler.py:70` (`request_id is None`)** — корректен для no-middleware unit-пути; НЕ «чинить» его. Реальный request_id доказывает новый интеграционный тест.
- **ruff format — по ФАЙЛУ, не по app-папке** (VAPS-конвенция: иначе трогает out-of-scope); гейт = `ruff check` (E,F).
- **Реестр/сервисы статусов/handler-логику не трогать** — события 4.4, read-API 4.5, coverage 4.6.

### Тесты стори

- **Локально:** `make gate` зелёный (Postgres :5433); `makemigrations --check` пуст (модель не тронута); ruff чист. Новые: `test_audit_record.py` (round-trip всех полей + request_id из ctx + system-путь sentinel + `ValueError` на пустом actor; `created_at` через `clock.override`), envelope-интеграция (request_id эхо `X-Request-Id`, не null), `test_audit_write_boundary.py` (AST-бан зелёный; ловит умышленный нарушитель).
- **Регрессия:** нулевая на существующем — только новые `apps/core/middleware.py`, `apps/audit/services.py`, 3 тест-файла + 1 строка `MIDDLEWARE`. `git diff --stat`.
- **НЕ в этом стори:** события статусов (4.4), read-API (4.5), coverage (4.6), app-роль (E12), proxy-IP/логи (defer).

### Definition of Done

- [x] `apps/core/middleware.py::RequestContextMiddleware` (contextvar request_id+ip+ua, finally-reset, `request.request_id`) зарегистрирован первым в `MIDDLEWARE`.
- [x] `apps/audit/services.py::record(...)` — единственная точка записи: `created_at=Clock.now()`, request-инфра из contextvar, sentinel ip `0.0.0.0`, `actor` обязателен, окружающая txn, без рантайм-валидации action.
- [x] AST-бан `test_audit_write_boundary.py`: прямой импорт `apps.audit.models` вне `apps/audit` (все формы) краснеет.
- [x] Интеграция: `AuditLog.request_id` == request_id запроса; §36-конверт несёт тот же request_id (эхо `X-Request-Id`).
- [x] Анти-gold-plating: нет событий/read-API/coverage/seed/app-роли; модель/`0001`/`0002`/реестр/сервисы/handler-логика не тронуты.
- [x] `make gate` зелёный (1307 passed), ruff чист, `makemigrations --check` пуст, регрессия нулевая. Completion Notes без вранья.

### Project Structure Notes

- Новые: `apps/core/middleware.py`, `apps/audit/services.py`, `apps/audit/tests/test_audit_record.py`, `apps/audit/tests/test_audit_write_boundary.py`, `apps/core/tests/test_request_id_envelope.py` (или дописать в существующий core-api-тест-файл). Изменяемый: `config/settings.py` (1 строка `MIDDLEWARE`).
- `apps/core/middleware.py` — sibling `clock.py`/`exceptions.py` (architecture:511). `apps/audit/services.py` — внутри app аудита (единственный легальный импортёр модели на запись).
- НЕ трогать: `apps/audit/models.py`, `apps/audit/migrations/*`, `docs/registries/audit-events.yaml`, `apps/operations/*`, `apps/core/api/exception_handler.py` (логика), `apps/core/auth/*`.

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Story-4.3] — `record()` + middleware request_id в contextvar; AC: HTTP-мутация → request_id в записи; AST-бан импорта `audit.models`.
- [Source: _bmad-output/planning-artifacts/architecture.md:464 (Service Patterns)] — **«request_id: middleware → contextvar; аудит-сервис читает сам»** (request_id не параметр).
- [Source: _bmad-output/planning-artifacts/architecture.md:454 (Communication Patterns)] — единый сервис записи (actor/action/target/before-after/request_id/IP); **MUST NOT raw insert** → AST-бан.
- [Source: _bmad-output/planning-artifacts/architecture.md:450 (Service Patterns)] — actor через `request.actor_id`; чтение X-User-Id вне core запрещено (AST-чек ARCH-SEC-030).
- [Source: _bmad-output/planning-artifacts/architecture.md:511 (дерево)] — `core/middleware.py # request_id contextvar` (место middleware).
- [Source: Backend/VAPS/apps/core/clock.py:20,28-35,43-70] — эталон contextvar (`_override` set/reset-finally) + `Clock.now()` (created_at).
- [Source: Backend/VAPS/apps/core/api/exception_handler.py:60-63,74,126] — `_request_id` читает `request.request_id`; §36-конверт; логику не трогать.
- [Source: Backend/VAPS/apps/core/tests/test_isolation.py:14-23,26-32,35-53] — эталон AST-бан-теста (`_imports`, обход, исключения).
- [Source: Backend/VAPS/apps/core/tests/test_exception_handler.py:66,70] — `request_id`-слот конверта; no-middleware fallback `None` (не ломать).
- [Source: Backend/VAPS/apps/core/auth/authentication.py:16-20] — `request.actor_id` (actor параметром, не чтением X-User-Id).
- [Source: Backend/VAPS/apps/core/tests/conftest.py:7-24] — `grant` фикстура (APIClient+RBAC) для envelope-интеграции.
- [Source: Backend/VAPS/apps/audit/models.py:29-55] — `AuditLog` (поля, db_table `audit_logs`, created_at без auto_now_add); пишем `.objects.create()`.
- [Source: Backend/VAPS/apps/operations/statuses/services/{status_service,secondment_service,bulk_status_service}.py] — будущие потребители record() (4.4); `actor: str` уже есть; в 4.3 не трогаем.
- [Source: docs/registries/audit-events.yaml (.record_shape, actions)] — форма строки + `action`-коды; рантайм-валидацию не делаем (closed-world тестом).
- [Source: docs/PersonnelStatus/VAPS_7.8.2.md §4.6 (926-941)] — DDL `audit_logs` (ip NOT NULL → sentinel; created_at NOT NULL → Clock).
- [Source: _bmad-output/implementation-artifacts/4-1-app-audit-и-модель-auditlog.md] — модель + defer'ы (sentinel ip `0.0.0.0` для system/entity-less → 4.3/4.4); аудит синхронный-на-мутации (ретро E3).
- [Source: _bmad-output/implementation-artifacts/4-2-append-only-на-уровне-бд.md] — append-only БД (record() пишет INSERT — append разрешён).
- [Source: Backend/VAPS/Makefile (gate, Postgres :5433); pyproject.toml markers] — верификация.

## Dev Agent Record

### Agent Model Used

claude-opus-4-8[1m] (Opus 4.8, 1M context)

### Debug Log References

- **Boundary-фикс (гейт поймал, как и в 4.1):** `test_x_user_id_literal_only_in_core_auth` (ARCH-SEC-030) упал — литерал `X-User-Id` был в docstring `apps/audit/services.py` (скан string-констант ловит обе формы написания). Перефразировал: «the identity header is read only by core/auth» — литерал убран, isolation-тест зелёный. (Подводный камень был явно отмечен в Dev Notes — реализовался ровно как предсказано.)
- **Решения-форки реализованы по дефолтам:** №1 полный `RequestContext` (request_id+ip+ua в одном contextvar); №2 sentinel ip `0.0.0.0` — владелец `record()` (core/middleware остаётся generic с пустыми строками); №3 без рантайм-валидации `action` (closed-world тестом); №4 `X-Request-Id` response-заголовок включён; №5 AST-тест в `apps/audit/tests/` (audit самодостаточен).
- **Envelope e2e:** `request.request_id` (Django) → DRF `Request.__getattr__` делегирует к `_request`→ `exception_handler._request_id` читает его в §36-конверт. Эндпойнт `GET /api/operations/roles/` (X-User-Id `nobody`→403) подтверждает поток через ПОЛНЫЙ middleware-стек.
- **VERIFIED:** `make gate` зелёный — **1307 passed**, 24 deselected, 23s (бюджет NFR-8 300s); `ruff check` чист; `ruff format --check` 6 файлов чисты; `makemigrations --check` → «No changes detected» (модель не тронута → миграции нет). 11 новых тестов (6 middleware/envelope + 3 record + 2 boundary). Регрессия нулевая (`git diff --stat`: только `config/settings.py` +4 + новые файлы).

### Completion Notes List

4.3 — инфра-seam аудита (middleware request_id + единая точка записи + AST-бан). `make gate` зелёный (1307 passed).

- ✅ **Task 1:** `RequestContextMiddleware` (contextvar request_id+ip+ua, mirror `clock._override`, finally-reset, `request.request_id`, `X-Request-Id` resp-заголовок) первым в `MIDDLEWARE`.
- ✅ **Task 2:** `audit.services.record()` — единственная точка записи: `created_at=Clock.now()`, request-инфра из contextvar, sentinel ip `0.0.0.0`, `actor` обязателен, окружающая txn, без рантайм-валидации action.
- ✅ **Task 3:** record-тесты (round-trip + ctx + system-sentinel + ValueError) + envelope-e2e (request_id эхо `X-Request-Id` через полный стек, не null).
- ✅ **Task 4:** AST-бан `test_audit_write_boundary.py` (все 4 формы импорта + self-sanity).
- ✅ **Task 5:** гейт зелёный (1307 passed), ruff/format чисты, makemigrations пуст, регрессия нулевая.
- **Анти-gold-plating:** нет событий статусов (4.4)/read-API (4.5)/coverage (4.6)/seed/app-роли (E12); модель/`0001`/`0002`/реестр/сервисы статусов/логика handler не тронуты.

**Статус → review.** Для 4.4: доменный сервис зовёт `record(actor=…, action=…, entity_type=…, entity_id=…, old_value=…, new_value=…)` — request-инфру НЕ передаёт (читается из contextvar).

### File List

**Создано:**
- `Backend/VAPS/apps/core/middleware.py` — `RequestContextMiddleware` + `RequestContext` + contextvar + аксессоры
- `Backend/VAPS/apps/audit/services.py` — `record()` (единая точка записи)
- `Backend/VAPS/apps/core/tests/test_request_id_middleware.py` — 6 тестов (middleware unit + envelope e2e)
- `Backend/VAPS/apps/audit/tests/test_audit_record.py` — 3 теста (record round-trip/sentinel/ValueError)
- `Backend/VAPS/apps/audit/tests/test_audit_write_boundary.py` — 2 теста (AST-бан + self-sanity)

**Изменено:**
- `Backend/VAPS/config/settings.py` — `RequestContextMiddleware` первым в `MIDDLEWARE` (1 строка + комментарий)

## Change Log

- 2026-06-26 — Dev (bmad-dev-story, Opus 4.8): реализована стори 4.3 — инфра-seam аудита. Middleware `apps/core/middleware.py` (request_id в contextvar, mirror `clock._override`, finally-reset, `request.request_id`, `X-Request-Id` resp-заголовок) первым в `MIDDLEWARE`; `apps/audit/services.py::record()` — единственная точка записи (created_at через `Clock.now()`, request-инфра из contextvar, sentinel ip `0.0.0.0`, actor обязателен, окружающая txn, без рантайм-валидации action); AST-бан `test_audit_write_boundary.py` (прямой импорт `apps.audit.models` вне `apps/audit` краснеет). Boundary-фикс: убран литерал `X-User-Id` из docstring `services.py` (ARCH-SEC-030 — как в 4.1). `make gate` зелёный (1307 passed, makemigrations пуст, ruff/format чисты), регрессия нулевая, 11 новых тестов. Артефакты НЕ закоммичены агентом. Status → review.
- 2026-06-26 — Code review (bmad-code-review, Opus 4.8, same-model caveat; 3 слоя Blind/Edge/Auditor, scoped diff 4.3). Acceptance Auditor: PASS — AC 1–5 ВСЕ SATISFIED, все 5 форков по дефолтам. 0 decision · 1 patch · 2 defer · 10 dismiss. Применён 1 patch: хардинг client-supplied `X-Request-Id` (strip + ascii/printable-guard → fallback uuid4; +parametrize-тест) — закрывает self-inflicted 500 / мусорный id. 2 defer (IP=REMOTE_ADDR→XFF в E12 [скоуп AC5]; streaming-context — латентно, нет streaming) → deferred-work.md. `make gate` зелёный (**1311 passed**), регрессия нулевая. Status → done.
