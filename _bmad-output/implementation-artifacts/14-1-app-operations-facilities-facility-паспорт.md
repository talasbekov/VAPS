---
baseline_commit: |
  6632e3d (Merge PR #15 — E10+E11 мейнлайн). Ветка worktree:
  `claude/frosty-villani-bb0be9`, дерево чистое. Первая стори эпика 14 и
  ПЕРВАЯ стори этапа 2 — стартуем ДО пилота (E12 идёт параллельно в другой
  сессии/worktree, ветка `claude/vigilant-sutherland-fddc31`): решение Bratan
  от 2026-07-20. Пересечений по файлам с E12 (deploy/, Dockerfile,
  config/settings контейнерные правки) НЕ создавать. Дисциплина worktree:
  коммит ограничивать путями из File List, `git rev-parse --short HEAD`
  сверять ДО и ПОСЛЕ, чужую историю не переписывать (класс инцидентов
  10.2↔11.1 … 10.7↔10.8 — шесть раз подряд).
prerequisite: |
  Блокирующего пререквизита НЕТ: app создаётся с нуля, зависимостей на
  E10–E12 нет. Но эпик в epics.md — КАРКАС («полные AC — при старте этапа 2,
  сверка с VAPS_7.8.2 и Паспортом объекта», epics.md:1399): AC этой стори
  выведены из первоисточников ниже, а не скопированы из эпика. VAPS_7.8.2.md
  НЕ закоммичен — физически существует только в главной рабочей копии
  `/home/erda/Музыка/VAPS/docs/PersonnelStatus/VAPS_7.8.2.md`; в worktree
  ссылки на него НЕ разыменовываются, читать по абсолютному пути.
context:
  - _bmad-output/planning-artifacts/epics.md#L1397-1412 (каркас E14; 14.1 = app + Facility + Паспорт) · #L218-220 (устав E14: FR-19, FR-20, FR-39-виды)
  - _bmad-output/planning-artifacts/prds/prd-VAPS-2026-06-10/prd.md#L124 (FR-19 — полный текст) · #L55-56 (глоссарий: Объект/Паспорт/Пост/Сектор) · #L160 (FR-36 аудит)
  - _bmad-output/planning-artifacts/prds/prd-VAPS-2026-06-10/addendum.md#L22 (R6: operations/objects → в epics переименован facilities) · #L35 (operations = integer PK; cross-context — UUIDField/CharField, НИКОГДА FK) · #L41-46 (иерархия источников: PRD master, 7.8.2 dev-ready)
  - /home/erda/Музыка/VAPS/docs/PersonnelStatus/VAPS_7.8.2.md#L531-542 (DB-OPS-005 ops_objects) · #L2266-2304 (DB-OPS-014 паспорт, 1:1, vulnerable_places, completeness CHECK RED/YELLOW/GREEN) · #L2306-2318 (DB-OPS-015 history) · #L2320-2326 (BR-OBJECT-001…004) · #L3408-3410 (AC-039…041: history И audit)
  - /home/erda/Музыка/VAPS/docs/PersonnelStatus/ПланРасстановка.md#L302-337 (master-состав паспорта; «проблемные места = участки особого контроля» L320)
  - /home/erda/Музыка/VAPS/docs/PersonnelStatus/USE_CASES_SPECIFICATION_VAPS.md#L3488-3533 (UC-OPS-001: акторы Старший объекта/Администратор, scope, аудит old/new)
  - _bmad-output/planning-artifacts/architecture.md#L379-381 (Glossary СТОП: Facility/Post/Sector — НЕ Object/Site) · #L530 (operations/facilities в канон-структуре) · #L583 (вложенный app: name/label/migrations) · #L404-408 (naming БД, ручные имена миграций) · #L433-435,397-400 (DomainError, IntegrityError→по имени constraint, error-codes = закрытый мир) · #L444-453 (Layer Contract: сервис, atomic, scope) · #L465 (идемпотентность POST — natural unique) · #L469 (Admin = только справочники) · #L746-758 (ARCH-002/003/004/007, DATA-023/025, SEC-030/031/032)
  - Backend/VAPS/apps/operations/models.py:4-18 (TimeStampedModel — база operations; created_by строкой)
  - Backend/VAPS/apps/operations/statuses/ (эталон вложенного app: apps.py:4-7, models/-пакет с __all__, services/, api/ без urls.py)
  - Backend/VAPS/apps/operations/api/urls.py:17-34 (единый роутер родителя — роуты субдоменов регистрируются ЗДЕСЬ; в 14.1 НЕ трогаем — API нет)
  - Backend/VAPS/config/settings.py:31-34 (INSTALLED_APPS: родитель + каждый вложенный app)
  - Backend/VAPS/apps/operations/submissions/models/daily_submission.py:96-146 (канон CheckConstraint: choice-гард + drift-тест, floor version≥1, условная непустота ~Q|regex \S, partial unique)
  - Backend/VAPS/apps/audit/services.py:29-77 (record(): литерал action, ambient-транзакция) · apps/audit/tests/test_audit_coverage.py:146+,182-199 (facet B: литералы ⊆ audit-events.yaml; facet A: AUDIT_MATRIX — только для РОУТОВ, в 14.1 не сработает)
  - Backend/VAPS/apps/operations/tests/test_isolation.py:23-51 (AST-гвард изоляции — образец для нового app)
  - Backend/VAPS/apps/core/tests/test_isolation.py:35-53 (X-User-Id сканируется во ВСЕХ строках, включая докстринги — писать «идентифицирующий заголовок»)
  - Backend/VAPS/apps/operations/management/commands/seed_operations.py:20 (право `object.manage` УЖЕ посеяно, ролям не выдано)
  - _bmad-output/implementation-artifacts/6-1-app-documents-и-attachment.md#L69-186 (стори-аналог «новый app»: таблица эталонов, ловушки Admin/venv/миграций)
---

# Story 14.1: App operations/facilities — Facility + Паспорт (атрибуты, проблемные места)

Status: done

## Story

As a Администратор / Старший объекта,
I want завести в системе охраняемые Объекты (Facility) с Паспортами — атрибутами, проблемными местами и историей изменений,
so that этап 2 (дежурства, ОМ, расстановка) строится на едином корневом агрегате объекта, а изменения паспорта неудаляемы и подотчётны.

## Acceptance Criteria

1. **App.** Given новый вложенный app `apps.operations.facilities` (label `ops_facilities`), when `make gate` из `Backend/VAPS`, then гейт зелёный: миграции применяются, `makemigrations --check` пуст, изоляционные стражи (core.models-импорты, wall-clock, X-User-Id-литералы) молчат.
2. **Создание объекта.** Given валидные данные (code, name, address), when `create_facility(actor_id, …)`, then в одной транзакции создаются Facility И его Паспорт с `completeness_status='RED'` (BR-OBJECT-001: у активного объекта паспорт есть всегда), аудит-запись `FACILITY_CREATED` записана; при дубле `code` — `DomainError` с 409-семантикой через маппинг IntegrityError по имени constraint (голый IntegrityError наружу не выходит).
3. **Обновление паспорта.** Given существующий паспорт, when `update_passport(actor_id, facility_id, изменения, reason?)`, then атомарно: поля обновлены, создана запись FacilityPassportHistory (`old_value`/`new_value` JSON-диффом полей, `changed_by=actor_id`, `reason`) И аудит-запись `FACILITY_PASSPORT_UPDATED` (AC-041 донора: history И audit — обе, это разные механизмы).
4. **DB-инварианты.** Then на уровне БД отвергаются: `completeness_status` вне {RED,YELLOW,GREEN}; широта вне [-90,90] / долгота вне [-180,180]; пустой (whitespace-only) `code`/`name`/`address`. Drift-тест зеркалит choices ↔ constraint (канон `chk_daily_submission_event`).
5. **Деактивация вместо удаления.** Given объект, when деактивация через сервис, then `is_active=False` + аудит `FACILITY_DEACTIVATED`; физического delete-пути в сервисах нет.
6. **Чтение.** Given селекторы `get_facility(pk)` / `list_facilities(actor)`, then невалидный/несуществующий pk → `DomainError("ENTITY_NOT_FOUND", 404)`, list по канону принимает actor первым аргументом (сужение видимости — заглушка «все активные», scope-политика — зона API-стори).

## Tasks / Subtasks

- [x] Task 1: Boilerplate app (AC: 1)
  - [x] `apps/operations/facilities/{__init__,apps.py}` — `OpsFacilitiesConfig`, `name="apps.operations.facilities"`, `label="ops_facilities"`, `default_auto_field="django.db.models.BigAutoField"`
  - [x] `migrations/__init__.py`; регистрация в `config/settings.py` INSTALLED_APPS (после `apps.operations.submissions`)
- [x] Task 2: Модели (AC: 2, 4) — пакетом `models/` с реэкспортом в `models/__init__.py` (`__all__`)
  - [x] `models/facility.py` — `Facility(TimeStampedModel)`: `code` (CharField 50, unique), `name` (255), `address` (TextField), `latitude`/`longitude` (Decimal 9,6, null), `importance_level_code` (CharField 50, null, БЕЗ FK — справочник уровней = зона E15), `is_active` (default True); `db_table="ops_facilities"`; constraints: `uq_facility_code`, `chk_facility_code_not_blank` (regex `\S`), `chk_facility_name_not_blank`, `chk_facility_address_not_blank`, `chk_facility_lat_range`, `chk_facility_lon_range`
  - [x] `models/passport.py` — `FacilityPassport(TimeStampedModel)`: `facility` OneToOneField(CASCADE, related_name="passport"); `object_type` (CharField 100, null — свободный текст по донору, см. Открытые вопросы); `responsible_user_id` (CharField 100, null — актор-строка ARCH-007); `responsible_employee_id` (UUIDField, null — cross-context БЕЗ FK, ARCH-003); TEXT-поля: `description`, `security_notes`, `vulnerable_places` (verbose_name «Проблемные места»), `power_supply`, `ventilation`, `communication`, `internet`, `nearby_high_buildings`, `public_zones`, `crowd_places`, `repair_works`; JSONField(default=list): `access_routes`, `entrances`, `exits`, `service_entrances`, `parking_zones`, `dropoff_zones`, `elevators`, `stairs`, `roofs`, `basements`, `technical_rooms`, `cameras`; `completeness_status` (TextChoices RED/YELLOW/GREEN, default RED) + `chk_facility_passport_completeness`; `last_verified_at` (null), `last_verified_by` (CharField 100, null); `db_table="ops_facility_passports"`
  - [x] там же `FacilityPassportHistory(models.Model)`: `passport` FK(CASCADE, related_name="history"), `changed_by` (CharField 100, NOT NULL), `changed_at` (auto_now_add), `old_value` (JSONField, null), `new_value` (JSONField), `reason` (TextField, null); `db_table="ops_facility_passport_history"`, ordering `-changed_at`
- [x] Task 3: Миграция (AC: 1, 4)
  - [x] Одна ручная `0001_facility.py` (3 модели + все constraints; канон имён `NNNN_<entity>`, MUST NOT `_auto_`); `dependencies = []`
- [x] Task 4: Селекторы (AC: 6)
  - [x] `selectors.py`: `get_facility(pk)` с канонизацией входа (strip → int → except → `DomainError("ENTITY_NOT_FOUND", 404)`), `list_facilities(actor)` — активные, канон-сортировка по `name`
- [x] Task 5: Сервисы + аудит (AC: 2, 3, 5)
  - [x] `services.py`: `create_facility`, `update_passport` (history-дифф только изменённых полей), `deactivate_facility`; каждый — `transaction.atomic`, `audit.record()` внутри транзакции, литеральные action-коды
  - [x] `docs/registries/audit-events.yaml`: + `FACILITY_CREATED`, `FACILITY_PASSPORT_UPDATED`, `FACILITY_DEACTIVATED` (entity_type `facility`) — тем же коммитом (facet B audit-coverage)
- [x] Task 6: Тесты (AC: все)
  - [x] `tests/test_models.py` — constraint-тесты (каждый chk_* — транзакционная красная проба) + drift-тест choices↔constraint
  - [x] `tests/test_services.py` — create (объект+паспорт атомарно, RED, аудит), update_passport (history И audit, old/new корректны, reason), deactivate, дубль code → DomainError
  - [x] `tests/test_selectors.py` — ENTITY_NOT_FOUND на мусорный pk, list-контракт
  - [x] `tests/test_isolation.py` — AST-гвард по образцу operations (запрет `apps.core.models`, границы субдоменов)
  - [x] посев данных напрямую (`objects.create`) — factory_boy в проекте НЕТ; время только `core.clock`
- [x] Task 7: Гейт (AC: 1)
  - [x] `make gate` из `Backend/VAPS` зелёный; `ruff format` — только по НОВЫМ файлам стори; `make schema` НЕ нужен (API-поверхности нет)

## Dev Notes

### Эталоны — всё уже в кодовой базе, ничего не изобретать

| Что | Откуда копировать паттерн |
|---|---|
| Вложенный app (apps.py, label, INSTALLED_APPS) | `apps/operations/statuses/apps.py:4-7`; settings.py:31-34 |
| Базовая модель operations (int PK, created_by строкой) | `apps/operations/models.py:4-18` `TimeStampedModel` |
| models/-пакет с реэкспортом `__all__` | `apps/operations/statuses/models/__init__.py:1-15` |
| CheckConstraint: choice + drift-тест, floor, `\S`-непустота | `submissions/models/daily_submission.py:96-146` |
| Маппинг IntegrityError → DomainError по имени constraint | raise-сайты statuses/services (образец в 3.3) |
| Аудит из сервиса | `apps/audit/services.py:29-77` — `record()` в ambient-транзакции, action литералом |
| DomainError + конверт | `apps/core/exceptions.py`; handler `apps/core/api/exception_handler.py` |
| AST-гвард изоляции нового app | `apps/operations/tests/test_isolation.py:23-51` |
| Идемпотентный seed (если понадобится) | `seed_operations.py` — но в 14.1 seed НЕ нужен |

### ⚠️ Ловушка №1 (ГЛАВНАЯ): донорский DDL — семантический контракт, НЕ буквальный

VAPS_7.8.2 даёт UUID PK и `REFERENCES ops_event_levels`. У нас: **integer PK** (ARCH-003, addendum:35 — «operations = integer surrogate PK»), «Object» → **Facility** (Glossary ARCH:379 — СТОП-слово), таблицы `ops_facilities` / `ops_facility_passports` / `ops_facility_passport_history` (канон `ops_<plural_snake>`, не донорские `ops_objects*`). `importance_level_code` — nullable CharField БЕЗ FK: справочник уровней (`ops_event_levels`) принадлежит контуру ОМ (E15), FK на несуществующую таблицу невозможен; связь оформит E15. `responsible_employee_id` — UUIDField без FK (cross-context на core.Employee). Клятва донора «CASCADE от объекта к паспорту» сохраняется (OneToOneField on_delete=CASCADE), но delete-пути в сервисах нет вовсе — только `is_active=False`.

### ⚠️ Ловушка №2: «проблемные места» — это ОДНО поле, не сущность

PRD §6.1 («участки, требующие особого контроля») и VisitX §18.3 («уязвимые места») в 7.8.2 слиты в одну колонку `vulnerable_places TEXT` — отдельной таблицы нет нигде (проверено grep'ом по 7.8.2). НЕ изобретать M2M/дочернюю таблицу — поле `vulnerable_places` с verbose_name «Проблемные места». Исторические риски из инцидентов (BR-INCIDENT-002) — зона E17.

### ⚠️ Ловушка №3: history И audit — ДВЕ обязательные записи, не дубль

AC-041 донора: изменение паспорта пишет и `FacilityPassportHistory` (old/new JSON + reason — доменная история, читается в паспорте), и `audit.record()` (FR-36 — сквозной журнал). Реализовать ОБЕ в одной транзакции `update_passport`. history.old_value/new_value — дифф только изменённых полей (не полный снапшот: полный снимок паспорта — это BR-OBJECT-004 при закрытии ОМ, зона E18).

### ⚠️ Ловушка №4: completeness_status — только поле, БЕЗ автовычисления

Перечень «обязательных полей» паспорта нигде не зафиксирован (в 7.8.2 только пример `missing_required_fields`). В 14.1: TextChoices + default RED + CheckConstraint + drift-тест. Логика вычисления RED/YELLOW/GREEN и `verify`-флоу — НЕ здесь (15.4 «обновление паспорта до начала ОМ» / позже). Не выдумывать критерии.

### ⚠️ Ловушка №5: Admin — НЕ регистрировать

Facility и Паспорт — бизнес-модели (мутации через сервис с аудитом). Регистрация ломает `test_admin_registry_is_exactly_catalogs` (инцидент 5.2, повтор в 6.1). `admin.py` в новом app не создавать вовсе.

### ⚠️ Ловушка №6: стражи, которые сработают сами

- `test_no_wall_clock_reads_in_domain_layers` сканирует `services.py`/`models.py` ВСЕХ apps — включая новые: никаких `datetime.now()`/`timezone.now()`; время только `core.clock.Clock` (в 14.1 время нужно разве что в тестах — `clock.override`).
- `test_x_user_id_literal_only_in_core_auth` сканирует ВСЕ строковые константы включая докстринги — писать «идентифицирующий заголовок», не литерал.
- audit-coverage facet B: литералы `FACILITY_*` обязаны быть в `audit-events.yaml` тем же коммитом. Facet A (AUDIT_MATRIX) и RBAC-матрица НЕ сработают — роутов в 14.1 нет.
- `test_authz_boundary` — никаких `has_perm`/`is_staff` в бизнес-слое.

### ⚠️ Ловушка №7: гейт и среда

`make gate` — строго из `Backend/VAPS` (Postgres в docker на :5433 поднимает Makefile). Worktree без `.venv` — создать (`python3 -m venv .venv && .venv/bin/pip install -e '.[dev]'`) или симлинк на venv основного чекаута (ретро E5 AI-2). `ruff format` — ТОЛЬКО по файлам стори, не по папке.

### Дефолты (приняты мной — поднять на ревью, если не согласен)

- **Д1. Разнесение полей**: name/address/координаты/важность/is_active — на Facility; object_type и всё описательное — на Паспорте (по 7.8.2; PRD-master относит «наименование и тип» к паспорту, выбрана dev-ready раскладка).
- **Д2. `object_type` — свободный текст** (nullable), как у донора: справочника типов не существует ни в одном источнике; TextChoices выдумывать не из чего. Молчаливого `""` нет — null.
- **Д3. Право `object.manage`** уже посеяно (seed_operations.py:20), ролям не выдано. В 14.1 permission-гейт НЕ реализуется (нет API); сервисы принимают `actor_id: str` первым аргументом — enforcement придёт с API-стори. ROLE_PERMISSIONS не трогаем.
- **Д4. Координаты** nullable + range-CheckConstraint (донор диапазон не проверяет — дыра донора, закрываем по канону DB-инвариантов).
- **Д5. JSONB-поля** — 12 списков `JSONField(default=list)` без схемы (у донора схемы нет; JSON-схема со schema_version — паттерн requirements постов, зона 14.2).
- **Д6. Ошибки — только существующие коды**: `ENTITY_NOT_FOUND`, `VALIDATION_ERROR`; для дубля code — маппинг `uq_facility_code` → DomainError с 409-семантикой (код конфликта взять из error-codes.yaml, сверив с живыми raise-сайтами statuses; новых кодов НЕ вводить).
- **Д7. history для create НЕ пишется** (old_value нет смысла; создание фиксирует аудит FACILITY_CREATED). Первая history-запись — при первом update_passport, её `old_value` = состояние на момент создания.

### Границы (что 14.1 НЕ делает)

- **Post/Sector** (`ops_object_posts/sectors`, requirements-схема) → 14.2. **Чек-листы** → 14.3. **Виды дежурств** → 14.4. **План дежурств** → 14.5+.
- **HTTP API и экраны** — роутов нет вообще; REST CRUD объектов — отдельная стори (см. Открытые вопросы), экраны — 14.11.
- **Автовычисление completeness / verify-флоу / блокировка ОМ при RED** (BR-OBJECT-002/003) → 15.4 и контур SecurityEvent.
- **Привлекаемые группы** (PRD §6.1) — справочник Групп появляется в 15.6, связь невозможна.
- **Документы/фото/схемы паспорта** — Attachment-связь → E17. **Инциденты как исторический риск** → E17. **Снимок паспорта при закрытии ОМ** → E18.
- **Справочник уровней важности** — E15 (поле-заглушка без FK, Ловушка №1).
- **Frontend** — не трогается вовсе (schema.d.ts не регенерится — API нет).

### Previous Story Intelligence (6.1, ретро E10/E11)

- 6.1 — прямой аналог «новый app»: boilerplate вне файлового лимита; бизнес-модель не в Admin; `dependencies=[]` корректно; одна миграция = сущности+constraints.
- Ретро-урок E5 §4.1 (повторён в 6.1): каждый вход сервиса/селектора канонизируется (strip/тип/формат) до касания ORM — мусорный pk не должен давать 500.
- Урок 5.6b→5.7a: голый IntegrityError не выпускать из сервиса — травит внешнюю транзакцию.
- Ретро E10/E11 (0905899): cross-model ревью и сверка File List с git-диффом — дефолты процесса, не привычки; коммит после ревью, graphify отдельным chore.
- Память DB-инвариантов: choice без дефолта и числовые floor — DB-гард обязателен; анти-прецедент `EmployeeStatus.source` (choices с дефолтом без CHECK) НЕ копировать — в 14.1 у всех choice/floor полей есть constraint (AC-4).

### Git Intelligence

- Baseline `6632e3d` — merge PR #15 (E10+E11). Паттерн коммитов: `feat(story-N.N): <название>`; коммит после ревью; graphify-обновление отдельным `chore(graphify)` (backend-код app-уровня — обновить после коммита стори).
- Параллельно в другом worktree живёт E12 (`claude/vigilant-sutherland-fddc31`) — общих файлов нет и не должно появиться; `config/settings.py` правится и там (контейнерные правки) и здесь (INSTALLED_APPS) — при мерже возможен тривиальный конфликт, разрешать аддитивно.

### Project Structure Notes

- Считаемые файлы: NEW `models/facility.py`, `models/passport.py`, `selectors.py`, `services.py`; MODIFY `config/settings.py`, `docs/registries/audit-events.yaml` — 6 содержательных, boilerplate (`__init__`, `apps.py`, `migrations/*`) и тесты вне лимита (прецедент 6.1).
- `models/__init__.py` реэкспорт с `__all__` — контракт навсегда (ARCH:598).
- Роутер родителя `operations/api/urls.py` НЕ трогается (нет API).

### Открытые вопросы (Bratan)

1. **REST CRUD объектов/паспорта** — заводим стори 14.1a (по прецеденту 10.1a) сразу после 14.1, или API объектов ждёт своей очереди в каркасе (14.11 — только план дежурств)? Без API паспорт редактируется только кодом/шеллом.
2. **`object_type`**: оставить свободным текстом (Д2) или завести минимальный справочник типов (тогда — где его seed и кто ведёт)?
3. **Код 409-конфликта** для дубля `code` — какой из существующих error-codes канонический (сверить по raise-сайтам; если подходящего нет — расширяем реестр отдельным решением)?
4. **Терминология UI**: «Проблемные места» (PRD) как verbose_name поля `vulnerable_places` — ок, или предпочитаешь «Уязвимые места» (VisitX)?

### References

- [Source: _bmad-output/planning-artifacts/epics.md#L1397-1412; #L218-220]
- [Source: prd.md#L124 (FR-19), #L125-126 (FR-20), #L166 (FR-39), #L55-56 (глоссарий)]
- [Source: addendum.md#L22 (R6), #L35 (PK/FK канон), #L41-46 (иерархия источников)]
- [Source: /home/erda/Музыка/VAPS/docs/PersonnelStatus/VAPS_7.8.2.md#L531-542, #L2266-2326, #L3408-3410]
- [Source: /home/erda/Музыка/VAPS/docs/PersonnelStatus/ПланРасстановка.md#L302-337]
- [Source: /home/erda/Музыка/VAPS/docs/PersonnelStatus/USE_CASES_SPECIFICATION_VAPS.md#L3488-3533 (UC-OPS-001)]
- [Source: _bmad-output/planning-artifacts/architecture.md#L369-381, #L404-413, #L421-423, #L433-453, #L465-469, #L530, #L583-598, #L746-758]
- [Source: Backend/VAPS/apps/operations/models.py:4-18; statuses/apps.py:4-7; submissions/models/daily_submission.py:96-146; audit/services.py:29-77; audit/tests/test_audit_coverage.py; operations/tests/test_isolation.py:23-51; core/tests/test_isolation.py:35-53; seed_operations.py:20]
- [Source: _bmad-output/implementation-artifacts/6-1-app-documents-и-attachment.md (стори-аналог)]

## Dev Agent Record

### Agent Model Used

claude-fable-5 (Claude Code; спека и реализация — одна сессия 2026-07-20)

### Debug Log References

- Красная фаза: 47 тестов падают на ImportError (модели не существуют) — зафиксирована до реализации.
- Первый прогон тестов упал на SQLite (`near "OR": syntax error` — regex-CheckConstraint): тесты гоняются ТОЛЬКО под Postgres (VAPS_DB=postgres, :5433) — канон 1.1, env как в Makefile.
- `make gate` после точечного `ruff format` миграции: **2538 passed, 86s**, `makemigrations --check` чист.

### Completion Notes List

- Все 6 AC покрыты тестами напрямую; после ревью — 75 тестов (models 18 / services 32 / selectors 4 / isolation 1 + параметризация).
- **Отклонение от Д6 спеки (реестр кодов):** добавлены `FACILITY_ALREADY_EXISTS` и `FACILITY_ALREADY_INACTIVE` (оба 409, структурные) в `error-codes.yaml` — подходящих существующих кодов не было, «новых кодов не вводить» уступило прецеденту 6.10b. Дубль: pre-check в сервисе (последовательный путь) + `uq_facility_code` в CONSTRAINT_ERROR_MAP (race-бэкстоп, канон summary_service).
- **Отклонение от Task 2 (history.changed_at):** вместо `auto_now_add` — явный `Clock.now()` из сервиса (канон 4.3/audit_logs.created_at: контролируемые часы, тестируемость); поле без DB-дефолта.
- `code` unique оформлен явным `UniqueConstraint(Lower("code"), name="uq_facility_code")` — регистронезависимый ('OBJ-1' ≡ 'obj-1'), стабильное имя для CONSTRAINT_ERROR_MAP.
- Описательные TEXT-поля паспорта — `blank=True, default=""` (Django-канон); осознанные NULL только там, где «неизвестно» ≠ «пусто»: `object_type`, `responsible_*`, координаты, `importance_level_code`, `last_verified_*` (Д2).
- Ось аудита для int-PK: `uuid5("vaps:facility", pk)` — прецедент block_override; int pk едет в `new_value`.
- `update_passport`: честная идемпотентность — одинаковые значения не пишут ни history, ни audit (пустой дифф = вакуумная запись); `last_verified_*` вне whitelist (verify-флоу = 15.4).
- Повторная деактивация и правка паспорта деактивированного объекта — `FACILITY_ALREADY_INACTIVE` 409 (state): soft-delete замораживает агрегат.
- RBAC-гейт и scope НЕ реализованы (нет HTTP-поверхности) — сервисы принимают `actor_id` строкой; право `object.manage` посеяно ранее (2.9), ролям не выдано — раскладка в API-стори.
- Стражи прошли сами: audit-coverage facet B (FACILITY_* ⊆ yaml), изоляция (core.models/wall-clock/X-User-Id), admin-платформа (в admin ничего не регали), authz-boundary.

### File List

- NEW `Backend/VAPS/apps/operations/facilities/__init__.py`
- NEW `Backend/VAPS/apps/operations/facilities/apps.py`
- NEW `Backend/VAPS/apps/operations/facilities/migrations/__init__.py`
- NEW `Backend/VAPS/apps/operations/facilities/migrations/0001_facility.py`
- NEW `Backend/VAPS/apps/operations/facilities/migrations/0002_facility_passport.py`
- NEW `Backend/VAPS/apps/operations/facilities/migrations/0003_facility_passport_history.py`
- NEW `Backend/VAPS/apps/operations/facilities/models/__init__.py`
- NEW `Backend/VAPS/apps/operations/facilities/models/facility.py`
- NEW `Backend/VAPS/apps/operations/facilities/models/passport.py`
- NEW `Backend/VAPS/apps/operations/facilities/selectors.py`
- NEW `Backend/VAPS/apps/operations/facilities/services.py`
- NEW `Backend/VAPS/apps/operations/facilities/tests/__init__.py`
- NEW `Backend/VAPS/apps/operations/facilities/tests/test_models.py`
- NEW `Backend/VAPS/apps/operations/facilities/tests/test_services.py`
- NEW `Backend/VAPS/apps/operations/facilities/tests/test_selectors.py`
- NEW `Backend/VAPS/apps/operations/facilities/tests/test_isolation.py`
- MODIFY `Backend/VAPS/config/settings.py` (+1 строка INSTALLED_APPS)
- MODIFY `Backend/VAPS/apps/core/api/exception_handler.py` (+1 строка CONSTRAINT_ERROR_MAP: uq_facility_code — race-бэкстоп дубля)
- MODIFY `docs/registries/audit-events.yaml` (+3 action: FACILITY_CREATED / FACILITY_PASSPORT_UPDATED / FACILITY_DEACTIVATED)
- MODIFY `docs/registries/error-codes.yaml` (+FACILITY_ALREADY_EXISTS, +FACILITY_ALREADY_INACTIVE)

### Change Log

- 2026-07-20: Реализация 14.1 целиком (app + модели + миграция + селекторы + сервисы + 47 тестов); полный гейт зелёный (2538 passed). Статус → review.
- 2026-07-20: Same-model max-ревью (10 углов + sweep, санкционированное отступление от cross-model по прецеденту e6c862d): 23 находки, 20 исправлено, 2 задокументировано, 1 отложена. Тестов 47 → 75; полный гейт зелёный (2566 passed). Статус → done.

## Senior Developer Review (AI)

**Модель:** claude-fable-5 (same-model max, 10 finder-углов × верификация × sweep). **Итог:** Changes Requested → все правки применены, гейт зелёный.

**Исправлено (20):**
1. [High] NaN-координата → неперехваченный InvalidOperation 500 → finite-чек + quantize до масштаба колонки (тихое расхождение echo/БД тоже закрыто).
2. [High] Мутации без select_for_update и чтение до atomic (класс блокера ретро E3) → локи в селекторе внутри транзакции сервиса; лок-пины в тестах (FOR UPDATE в captured SQL).
3. [High] float/bool/Decimal-коэрсия pk → мутация чужого объекта → строгий канон `0|[1-9][0-9]*` (зеркало by_id 5.8b/5.8c).
4. [High] Регистрозависимый uq_facility_code ('obj-1' = дубль мимо 409) → UniqueConstraint(Lower("code")) + iexact pre-check.
5. [High] facility.passport → RelatedObjectDoesNotExist 500 → passport_for_update c 404-бэкстопом BR-OBJECT-001.
6. [High] Нет max_length-валидации → DataError 500 → капы длин (actor/code/name/importance/строки паспорта).
7. [Med] Не-JSON-сериализуемые элементы списков → TypeError в транзакции → json.dumps-проба при канонизации.
8. [Med] Substring-детект имени констрейнта (офф-канон, SQLite-хрупкий) → pre-check дубля + строка в CONSTRAINT_ERROR_MAP (канон summary_service).
9. [Med] Повторный deactivate = VALIDATION_ERROR(400, form) за state-конфликт → новый код FACILITY_ALREADY_INACTIVE (409, state).
10. [Med] Паспорт деактивированного объекта редактировался → soft-delete замораживает агрегат (409).
11. [Med] AC-3 без красной пробы атомарности update → monkeypatch-тест отката полей и history.
12. [Med] Вакуумный noop-тест идемпотентности → снапшот updated_at и полей.
13. [Med] sorted() по смешанным ключам changes → TypeError 500 → key=str.
14. [Low] Whitespace-only «изменение» TEXT-поля рождало мусорную history → strip-нормализация.
15. [Low] Координаты/importance не попадали в FR-36-трейл → включены в new_value FACILITY_CREATED.
16. [Low] Границы координат пробированы 2 из 4 → все четыре.
17. [Low] Миграция 3-в-1 → разрезана на 0001/0002/0003 по-сущности (канон NNNN_<entity>).
18. [Low] Функции вместо <Domain>Selector-класса → FacilitySelector.
19. [Low] Нет tie-breaker id в ordering (пагинация теряет строки) → order_by("name","id") + Meta.
20. [Low] kwarg actor_id против канона actor → переименован.

**Задокументировано без правки (2):** history.reason NOT NULL default "" (прецедент AuditLog.reason — осознанное отклонение от спеки); форма-валидация в сервисе до появления API-слоя (Layer Contract: сериализатор заберёт форму в API-стори).

**Отложено (1):** хойст _require_actor (5-я копия) / _json_safe (3-я) / pk-канонизации в apps/core|audit — рефактор четырёх чужих субдоменов, вне File List стори; выделено в отдельную задачу.
