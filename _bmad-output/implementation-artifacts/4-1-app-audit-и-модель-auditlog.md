---
baseline_commit: 00998e7 (ветка e3-catchup-clock-concurrency; E3 закрыт/в review, E4 стартует)
---

# Story 4.1: App audit и модель AuditLog

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

<!-- ПЕРВАЯ стори E4 (Аудит). Узкая: создать ВЛОЖЕННЫЙ app `apps/audit` + модель `AuditLog` +
     миграция + db_table `audit_logs`. БЕЗ append-only-БД (4.2), БЕЗ сервиса записи/request_id-middleware
     (4.3), БЕЗ аудита мутаций статусов (4.4), БЕЗ read-API (4.5). Аудит — СИНХРОННЫЙ-на-мутации
     (request_id/IP request-scoped), НЕ catch-up-материализатор seam 3.12 (значимое открытие ретро E3;
     ARCH-DATA-022 перечислил аудит среди beat-эффектов — спек-дрейф, не относится к 4.1). -->

## Story

As a **аудитор**,
I want **отдельный вложенный Django-app `apps/audit` со своей миграцией и моделью `AuditLog` (`actor_user_id`, `action` из реестра, target `entity_type`/`entity_id`, `old_value`/`new_value` JSONB, `reason`, `request_id`, `ip_address`, `user_agent`, `created_at`), db_table `audit_logs`**,
so that **журнал аудита существует как самостоятельный контекст-фундамент — на него сядут append-only-БД (4.2), сервис записи (4.3), аудит мутаций статусов (4.4) и read-API (4.5) (FR-36, ARCH-SEC-032, AR-9)**.

## Acceptance Criteria

1. **Given** новый вложенный app `apps/audit` (AppConfig `name="apps.audit"`, `label="audit"`, `default_auto_field=BigAutoField`) зарегистрирован в `INSTALLED_APPS`, **When** прогоняется `makemigrations`/`migrate`, **Then** создаётся таблица **`db_table="audit_logs"`** СВОЕЙ миграцией `apps/audit/migrations/0001_*` (label `audit`), без затрагивания других app.
2. **Given** модель `AuditLog`, **Then** поля точно по спеке §4.6 (`docs/PersonnelStatus/VAPS_7.8.2.md:926-941`) + `request_id`: `id` UUID-pk (`default=uuid4`), `actor_user_id` `CharField(100)` (НЕ FK — actor-строка X-User-Id, BR-ACCOUNT-002), `action` `CharField(100)` (UPPER_SNAKE из `audit-events.yaml`), `entity_type` `CharField(100)`, `entity_id` `UUIDField`, `old_value`/`new_value` `JSONField(null=True)`, `reason` `TextField(blank=True)`, **`request_id`** `CharField` (request-scoped, заполняет 4.3-middleware), `ip_address` `GenericIPAddressField`/`CharField(45)`, `user_agent` `TextField`, `created_at` `DateTimeField` — **БЕЗ `auto_now_add`/NOW()-default** (заполняется сервисом 4.3 через `Clock.now()`; ARCH-DATA-022 + ретро E3 action-item «Clock-эншафорс audit-времени»).
3. **Given** модельный тест, **When** создаётся `AuditLog` со всеми обязательными полями, **Then** запись сохраняется и ВСЕ поля читаются обратно равными (доказательство «все поля заполнены» на уровне МОДЕЛИ; реальная запись «через сервис» — 4.3). Индекс `idx_audit_entity` на `(entity_type, entity_id, created_at)` (§4.6) присутствует в миграции.
4. **Given** спек-дрейф полей (§4.6 SQL имеет `reason`/`user_agent`, НЕ имеет `request_id`; эпик/architecture:456/`audit-events.yaml`.record_shape имеют `request_id`), **When** проектируется модель, **Then** взят **СОЮЗ** (§4.6-поля + `request_id`); решение и расхождение зафиксированы в Dev Agent Record; при подтверждении — `request_id` дописать в §4.6/architecture отдельным касанием (НЕ в скоупе 4.1-кода). *(сверка AC↔спека — action-item ретро E3.)*
5. **And** анти-gold-plating: **только app+модель+миграция+модель-тест**. НЕ строится: append-only REVOKE/триггер (4.2), `audit.services.record()` + request_id-middleware + AST-бан (4.3), события мутаций статусов (4.4), read-API (4.5), coverage-тест (4.6), seed `action`-реестра. `AuditLog` НЕ наследует TimeStampedModel-базу (append-only: нет `updated_at`; actor — поле `actor_user_id`, не `created_by`-базы). Существующие app/модели/реестр `audit-events.yaml` НЕ трогаются.

## Tasks / Subtasks

- [x] **Task 1 — вложенный app `apps/audit`** (AC: 1)
  - [x] `apps/audit/__init__.py`, `apps/audit/apps.py` (`class AuditConfig(AppConfig)`: `name="apps.audit"`, `label="audit"`, `default_auto_field="django.db.models.BigAutoField"`) по образцу `apps/operations/rbac/apps.py`.
  - [x] `apps/audit/migrations/__init__.py`, `apps/audit/tests/__init__.py`.
  - [x] Зарегистрировать `"apps.audit"` в `config/settings.py` `INSTALLED_APPS` (после operations-app).
- [x] **Task 2 — модель `AuditLog`** (AC: 2, 4)
  - [x] `apps/audit/models.py` — `AuditLog` с полями AC-2 (СОЮЗ §4.6 + request_id). `class Meta: db_table="audit_logs"; indexes=[Index(fields=["entity_type","entity_id","created_at"], name="idx_audit_entity")]`. UUID-pk: `id = UUIDField(primary_key=True, default=uuid.uuid4, editable=False)`.
  - [x] `created_at` — `DateTimeField()` БЕЗ `auto_now_add` (Clock-инъекция сервисом 4.3); комментарий-обоснование (ARCH-DATA-022 + ретро). Док-строка модели: append-only (enforce БД — 4.2), запись только через сервис (4.3), `action` из `audit-events.yaml`.
  - [x] Зафиксировать спек-дрейф (AC-4) в Dev Agent Record.
- [x] **Task 3 — миграция** (AC: 1, 3)
  - [x] `python manage.py makemigrations audit` → `0001_auditlog` (CreateModel + индекс). MUST: миграция в `apps/audit/migrations/`, label `audit`, не трогает чужие миграции. Round-trip `migrate` / `migrate audit zero` чист.
- [x] **Task 4 — модель-тест** (AC: 3)
  - [x] `apps/audit/tests/test_audit_log_model.py` (`@pytest.mark.django_db`): создать `AuditLog` со всеми полями (`created_at` явным `Clock.now()`/фикс-datetime, т.к. нет auto_now_add) → `refresh_from_db` → все поля равны; `db_table=="audit_logs"`; `id` — UUID. Тест JSONB: `old_value`/`new_value` = dict, читаются обратно. Nullable: `old_value=None` проходит.
- [x] **Task 5 — гейт и регрессия** (AC: 5)
  - [x] `make gate` зелёный; `makemigrations --check` чист (миграция закоммичена); ruff чист. Регрессия нулевая: только новые файлы `apps/audit/*` + одна строка `INSTALLED_APPS`. `git diff --stat`.

## Review Findings

_Code review (bmad-code-review, 2026-06-26, Opus 4.8 — same-model caveat; 3 слоя Blind/Edge/Auditor; scoped diff ~178 содержательных строк / 7 новых файлов + 1 строка settings, WIP-untracked). Acceptance Auditor: **PASS — AC-1..5 ВСЕ SATISFIED ВЖИВУЮ** против §4.6 DDL (поле-в-поле: db_table `audit_logs`, имена/типы/null, индекс `idx_audit_entity`, union `request_id`, `created_at` без auto_now_add, не наследует base-модель). Edge Hunter: миграция зеркалит модель без makemigrations-дрейфа. **1 decision · 1 patch · 2 defer · 12 dismiss.** Dismiss-фон: ложные срабатывания против реального конфига (гейт = Postgres :5433 по Makefile — JSONB/inet/TIMESTAMPTZ реально проверены; `USE_TZ=True`; `__init__.py` существуют) либо by-design/spec-mandated (uuid4←gen_random_uuid app-сторона, created_at-Clock, NOT-NULL по §4.6, append-only→4.2, default_auto_field verbatim AC-1)._

- [x] [Review][Defer] NOT NULL `ip_address`/`entity_id` vs будущие system-actor / entity-less аудит-события [models.py:33 entity_id, models.py:40 ip_address] — **decision Bratan 2026-06-26: оставить §4.6 NOT NULL**. Модель верно зеркалит §4.6 (`ip_address VARCHAR(45) NOT NULL`, `entity_id UUID NOT NULL`); 4.1 держим model-only / §4.6-верным (анти-goldplating). System-инициированные мутации (catch-up 3.12→4.4: APPLIED/COMPLETED, actor=SYSTEM, нет IP) и entity-less события (AUTH/export) аккомодирует **4.3/4.4** (sentinel IP `0.0.0.0` / синтетический entity), при нужде — отдельная миграция позже. Подвопрос inet-vs-CharField(45) (форензик raw-строка) — там же. **deferred — по решению держать §4.6-контракт; стоимость ALTER позже принята осознанно.**
- [x] [Review][Patch] Регресс-тест на инвариант «`created_at` без auto_now_add» — `AuditLog.objects.create(...)` без `created_at` → `IntegrityError` (NOT NULL). Пиннит ARCH-DATA-022 / Clock-инъекцию 4.3: будущий `auto_now_add=True`/`default=now` прошёл бы все 3 текущих теста, ТИХО сломав документированный инвариант (models.py:18-21). Дёшево, защищает stated design decision. [tests/test_audit_log_model.py] — **ПРИМЕНЕНО+ВЕРИФИЦИРОВАНО:** `test_created_at_required_no_auto_default` (`pytest.raises(IntegrityError)` под `transaction.atomic()`); 4 audit-теста зелёные на Postgres :5433, ruff чист.
- [x] [Review][Defer] Доп. индексы read-пути (`actor_user_id`/`request_id`/`created_at`-alone) [models.py:45-52] — deferred, к 4.5 read-API (§4.6 даёт один индекс; добавлять сейчас = анти-goldplating 4.1)
- [x] [Review][Defer] Случайный `uuid4` PK на write-heavy append-only `audit_logs` (локальность B-tree/bloat на объёме) [models.py:30] — deferred, pre-existing: UUID-pk = §4.6 + VAPS-конвенция; смена стратегии (UUIDv7/seq) — архитектурное решение вне 4.1

## Dev Notes

### Цель (одним предложением)

4.1 — ФУНДАМЕНТ E4: новый вложенный app `apps/audit` + модель `AuditLog` (db_table `audit_logs`) по §4.6-спеке, на который сядут append-only (4.2), сервис записи (4.3), аудит статусов (4.4), read-API (4.5). Только модель — без поведения.

### Авторитетная спека модели (§4.6 + reconcile)

§4.6 SQL (`VAPS_7.8.2.md:926-941`) — авторитетный DDL `audit_logs`:
```sql
id UUID PK DEFAULT gen_random_uuid()
actor_user_id VARCHAR(100) NOT NULL
action VARCHAR(100) NOT NULL
entity_type VARCHAR(100) NOT NULL
entity_id UUID NOT NULL
old_value JSONB
new_value JSONB
reason TEXT
ip_address VARCHAR(45) NOT NULL
user_agent TEXT NOT NULL
created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP NOT NULL
INDEX idx_audit_entity (entity_type, entity_id, created_at)
```

**⚠️ Спек-дрейф (action-item ретро E3 — сверка AC↔спека):** §4.6 SQL **НЕ содержит `request_id`**, но эпик 4.1, `architecture.md:456` («единый сервис записи: actor, action, target, before/after JSON, **request_id**, IP») и `docs/registries/audit-events.yaml`.record_shape — содержат. И наоборот, §4.6 имеет `reason`/`user_agent`, которых нет в эпике. **Решение: СОЮЗ** — модель = все §4.6-поля + `request_id`. Обоснование: §4.6 — детальный DDL (источник истины по схеме), а request_id — сквозная инфра-колонка (middleware 4.3), явно требуемая architecture/эпиком/реестром. После подтверждения Bratan — дописать `request_id` в §4.6/architecture отдельным doc-касанием (вне 4.1-кода).

**Маппинг §4.6 → Django (точные имена полей сохранить — это db-схема и потребители 4.3/4.4/4.5):**

| §4.6 колонка | Django-поле | Заметка |
|---|---|---|
| `id` UUID PK | `UUIDField(primary_key=True, default=uuid.uuid4, editable=False)` | `gen_random_uuid()`→`uuid4` (app-сторона); конвенция VAPS — UUID-pk |
| `actor_user_id` VARCHAR(100) | `CharField(max_length=100)` | actor-строка X-User-Id; НЕ FK на User/Employee (BR-ACCOUNT-002) |
| `action` VARCHAR(100) | `CharField(max_length=100)` | UPPER_SNAKE из `audit-events.yaml`; валидация против реестра — сервис 4.3, не модель |
| `entity_type` VARCHAR(100) | `CharField(max_length=100)` | target-тип; flat-строка (ARCH-003, не contenttypes-FK) |
| `entity_id` UUID | `UUIDField()` | target-id |
| `old_value` JSONB | `JSONField(null=True, blank=True)` | «before» |
| `new_value` JSONB | `JSONField(null=True, blank=True)` | «after» |
| `reason` TEXT | `TextField(blank=True, default="")` | §4.6 + ТЗ «комментарий» |
| **`request_id`** | `CharField(max_length=…, blank=True, default="")` | reconcile-добавка; заполняет 4.3-middleware из contextvar |
| `ip_address` VARCHAR(45) | `GenericIPAddressField()` ИЛИ `CharField(max_length=45)` | 45 = IPv6 |
| `user_agent` TEXT | `TextField(blank=True, default="")` | §4.6 |
| `created_at` TIMESTAMPTZ | `DateTimeField()` **без auto_now_add** | Clock-инъекция сервисом 4.3 (см. ниже) |

### Решение — `created_at` через Clock, не `auto_now_add`/DB-default

§4.6 пишет `DEFAULT CURRENT_TIMESTAMP`, НО ARCH-DATA-022 запрещает `timezone.now()`/NOW()-defaults в домене, а ретро E3 завела action-item «Clock-эншафорс audit-времени» (defer: `auto_now` штампует мимо Clock → рассинхрон при дрейфе часов). **Дефолт стори: `created_at = DateTimeField()` без `auto_now_add`/default — заполняется сервисом 4.3 через `Clock.now()`** (единый источник времени, тестируемо через `clock.override`). Следствие: на этом этапе (без сервиса) модель-тест 4.1 передаёт `created_at` явно. Развилка для Bratan: Clock-инъекция (рекоменд., консистентно с ядром) vs `auto_now_add` (проще, но мимо Clock — тогда defer остаётся открытым).

### Что УЖЕ есть — переиспользовать/НЕ дублировать

- **`apps/operations/rbac/apps.py`** — образец вложенного app (AppConfig name/label). `INSTALLED_APPS` (`config/settings.py:21-26`) — куда регистрировать.
- **`docs/registries/audit-events.yaml`** — реестр `action` (seed от 1.12: `AUTH_LEGACY_TOKEN_*` + derived). `action`-поле модели хранит эти коды; валидация/seed — НЕ 4.1.
- **`apps/core/middleware.py`** (request_id contextvar — упоминается architecture:452/511) — потребитель `request_id` в 4.3, не 4.1. (Проверить, существует ли уже; если да — 4.3 переиспользует.)
- **UUID-pk конвенция** — модели VAPS на UUID (employee_id и пр.); `AuditLog.id` UUID консистентен.
- **donor `AuditEntry`/`AuditLog`** (G2, `docs/epics/audit-consolidation.md`) — проблема ДОНОРА; VAPS строит AuditLog С НУЛЯ (E4-intro). НЕ переносить донор-код.

### Подводные камни для dev-агента

- **Только модель.** Соблазн «раз уж модель, добавлю сервис/REVOKE/события». НЕТ: 4.2/4.3/4.4. Это узкая фундамент-стори.
- **db_table ТОЧНО `audit_logs`** (не `audit_auditlog`-дефолт) — потребители 4.3/4.4/4.5 + §4.6 + ARCH-SEC-032 «UPDATE audit_logs» завязаны на имя.
- **Имена полей §4.6 сохранить дословно** (`actor_user_id`, `entity_type`/`entity_id`, `old_value`/`new_value`, `ip_address`, `user_agent`) — это db-контракт.
- **НЕ наследовать TimeStampedModel-базу** (append-only: нет `updated_at`; нет `created_by` — actor хранится в `actor_user_id`).
- **append-only НЕ в 4.1** — REVOKE/триггер = 4.2. Миграция 4.1 = чистый CreateModel.
- **`created_at` без auto_now_add** → любой `.create()` без `created_at` упадёт NOT NULL — это ОК (форсит Clock-инъекцию сервисом); модель-тест передаёт явно.
- **Postgres-only:** JSONB/UUID — Postgres; тест на :5433, не SQLite.
- **Реестр `audit-events.yaml` не трогать** — seed `action` под мутации = их стори (4.4 и т.д.).

### Тесты стори

- **Локально:** `make gate` зелёный; `makemigrations --check` чист; ruff чист; новый `test_audit_log_model.py` зелёный (все поля round-trip, db_table, UUID-pk, JSONB nullable).
- **Регрессия:** нулевая — только `apps/audit/*` (новое) + одна строка `INSTALLED_APPS`. `git diff --stat`.
- **НЕ в этом стори:** запись через сервис (4.3), append-only-отказ БД (4.2), события статусов (4.4), read-API (4.5), coverage (4.6).

### Definition of Done

- [x] `apps/audit` (apps.py label `audit`) в `INSTALLED_APPS`; `AuditLog` (db_table `audit_logs`) с полями §4.6 + request_id; UUID-pk; индекс `idx_audit_entity`.
- [x] `created_at` без auto_now_add (Clock-инъекция 4.3); спек-дрейф зафиксирован в Dev Agent Record.
- [x] Миграция `0001_auditlog` своя (label `audit`), round-trip чист; `makemigrations --check` пуст.
- [x] Модель-тест: все поля round-trip + db_table + UUID + JSONB(null).
- [x] Анти-gold-plating: нет сервиса/REVOKE/событий/API/seed; не наследует base-модель; реестр/чужие app не тронуты.
- [x] `make gate` зелёный, ruff чист, регрессия нулевая. Completion Notes без вранья.

### Project Structure Notes

- Новые: `apps/audit/{__init__.py, apps.py, models.py, migrations/__init__.py, migrations/0001_auditlog.py, tests/__init__.py, tests/test_audit_log_model.py}`. Изменяемый: `config/settings.py` (одна строка INSTALLED_APPS). Связная единица (новый app+модель), boilerplate тривиален.
- `apps/audit/` — ТОП-уровневый app (sibling `core`/`operations`/`documents`/`notifications`, architecture:533), НЕ под operations.
- НЕ трогать: `apps/core`, `apps/operations/*`, `docs/registries/audit-events.yaml`, существующие миграции.

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Story-4.1] — AuditLog (actor/action/target/before-after/request_id/IP/created_at), app вложенный со своими миграциями, db_table по спеке.
- [Source: docs/PersonnelStatus/VAPS_7.8.2.md §4.6 (926-941)] — авторитетный DDL `audit_logs` (точные поля/типы/индекс).
- [Source: _bmad-output/planning-artifacts/architecture.md (456 record-shape+request_id, 533 app-размещение, 317/756 ARCH-SEC-032 append-only, 422 JSONB-конвенция, 452 request_id-middleware)] — структура, append-only (4.2), request_id (4.3).
- [Source: docs/registries/audit-events.yaml] — реестр `action` (record_shape подтверждает request_id); seed под мутации — НЕ 4.1.
- [Source: docs/PersonnelStatus/VAPS_7.8.2.md §4.6 BR-ACCOUNT-002 (328)] — `actor_user_id` ≠ `core_employees.id` (actor — строка X-User-Id).
- [Source: Backend/VAPS/apps/operations/rbac/apps.py + config/settings.py:21-26] — образец вложенного app + регистрация.
- [Source: _bmad-output/implementation-artifacts/epic-3-retro-2026-06-26.md] — action-items: Clock-эншафорс audit-времени (created_at), сверка AC↔спека (спек-дрейф request_id); значимое открытие: аудит СИНХРОННЫЙ-на-мутации, не catch-up-материализатор seam 3.12.

## Dev Agent Record

### Agent Model Used

claude-opus-4-8[1m] (Opus 4.8, 1M context)

### Debug Log References

- **Спек-дрейф (AC-4) — РЕШЕНО СОЮЗ:** модель `AuditLog` = все §4.6-поля (`actor_user_id, action, entity_type, entity_id, old_value, new_value, reason, ip_address, user_agent, created_at`) + **`request_id`** (есть в эпике/architecture:456/`audit-events.yaml`.record_shape, НЕТ в §4.6 SQL). Зафиксировано: §4.6/architecture стоит дописать `request_id` отдельным doc-касанием (вне 4.1-кода) — **за Bratan**.
- **`created_at` Clock-вариант (подтверждён Bratan):** `DateTimeField()` без `auto_now_add`/DB-default — заполнит сервис 4.3 через `Clock.now()`. Следствие: `.create()` без `created_at` падает NOT NULL (форсит Clock-инъекцию); модель-тест передаёт `created_at` явно.
- **Boundary-фикс (гейт поймал):** `test_x_user_id_literal_only_in_core_auth` (ARCH-SEC-030) упал — литерал `X-User-Id` был в docstring `models.py` (скан string-констант). Перефразировал docstring («authenticated actor id from the request») — литерал убран, isolation-тесты зелёные.
- **Миграция:** Django авто-назвал `0001_initial` (не `0001_auditlog` из плана — авто-конвенция Django для первой миграции, эквивалентно). CreateModel `AuditLog` (db_table `audit_logs`) + индекс `idx_audit_entity`.
- **VERIFIED:** `make gate` зелёный — **1289 passed** (+3 модель-теста), 24 deselected; `makemigrations --check` → «No changes detected» (миграция на месте); `ruff check`/`format` чисты (миграция авто-форматнута под 88 cols). Модель-тест: все поля round-trip (вкл. JSONB dict + null), `db_table=="audit_logs"`, UUID-pk. Регрессия нулевая (только `apps/audit/*` + 1 строка INSTALLED_APPS).

### Completion Notes List

4.1 — фундамент E4 (app+модель, без поведения). `make gate` зелёный.

- ✅ **Task 1:** вложенный app `apps/audit` (AppConfig label `audit`) + `INSTALLED_APPS`.
- ✅ **Task 2:** модель `AuditLog` (СОЮЗ §4.6 + request_id; UUID-pk; индекс `idx_audit_entity`; db_table `audit_logs`); `created_at` без auto_now_add (Clock-инъекция 4.3); не наследует base-модель (append-only).
- ✅ **Task 3:** миграция `0001_initial` (своя, label `audit`); `makemigrations --check` чист.
- ✅ **Task 4:** 3 модель-теста (round-trip всех полей + JSONB nullable + db_table).
- ✅ **Task 5:** гейт зелёный (1289 passed), ruff чист, регрессия нулевая.
- **Анти-gold-plating:** нет сервиса (4.3)/REVOKE (4.2)/событий (4.4)/API (4.5)/seed; реестр/чужие app не тронуты.

**Статус → review.** Открыто (за Bratan): дописать `request_id` в §4.6/architecture (doc-сверка спек-дрейфа).

### File List

**Создано:**
- `Backend/VAPS/apps/audit/__init__.py`
- `Backend/VAPS/apps/audit/apps.py` — AuditConfig (label `audit`)
- `Backend/VAPS/apps/audit/models.py` — `AuditLog` (db_table `audit_logs`)
- `Backend/VAPS/apps/audit/migrations/__init__.py`
- `Backend/VAPS/apps/audit/migrations/0001_initial.py` — CreateModel + индекс
- `Backend/VAPS/apps/audit/tests/__init__.py`
- `Backend/VAPS/apps/audit/tests/test_audit_log_model.py` — 3 модель-теста

**Изменено:**
- `Backend/VAPS/config/settings.py` — `"apps.audit"` в INSTALLED_APPS (1 строка)

## Change Log

- 2026-06-26 — Dev (bmad-dev-story, Opus 4.8): реализована стори 4.1 — фундамент E4. Новый вложенный app `apps/audit` + модель `AuditLog` (db_table `audit_logs`, поля §4.6 + request_id, UUID-pk, индекс `idx_audit_entity`) + миграция `0001_initial` + 3 модель-теста. `created_at` без auto_now_add (Clock-инъекция сервисом 4.3 — подтверждено Bratan). Спек-дрейф `request_id` (§4.6 SQL не имеет, эпик/arch имеют) разрешён СОЮЗОМ. Boundary-фикс: убран литерал `X-User-Id` из docstring (ARCH-SEC-030). `make gate` зелёный (1289 passed, makemigrations пуст, ruff чист), регрессия нулевая. Артефакты НЕ закоммичены агентом. Status → review.
