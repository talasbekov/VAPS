---
baseline_commit: d87a28e
---

# Story 14.1: `apps.operations.facilities` — Object + Паспорт (модели)

Status: done

## Story

As a **разработчик**,
I want **модель `Object` (охраняемая инфраструктура) и модель `ObjectPassport` (атрибуты паспорта: описание, инфраструктура, «проблемные места»)**,
so that **Epic 14's последующие стори (Post/Sector 14.2, чек-лист 14.3, дежурства 14.5+) имеют модельный фундамент, сверенный с донор-спекой VAPS_7.8.2**.

`epics.md#L1401` (буква: «App operations/facilities: Facility + Паспорт (атрибуты, проблемные места)»). Первая стори Epic 14 — сама буква эпика (`epics.md#L1397-1399`) требует «сверки с VAPS_7.8.2 и Паспортом объекта» при старте этапа 2; это ПЕРВОЕ, что делает эта стори (см. Scope Decision).

## Scope Decision (найдено при create-story)

- **Донор называет сущность «object» (`ops_objects`), не «facility».** Буква эпика говорит «Facility», но `docs/PersonnelStatus/VAPS_7.8.2.md` (раздел 17, `DB-OPS-004`) и PRD's глоссарий (`prd.md:55`, «Объект — постоянная охраняемая инфраструктура; имеет Паспорт») используют «Объект»/`ops_objects`. Модель называется `Object` (Django-модель `apps.operations.facilities.models.Object`, `db_table="ops_objects"`), не `Facility` — терминология донора и PRD выигрывает у буквы эпика (донор — источник схемы, буква эпика — черновой ярлык при написании этого файла).
- **Только МОДЕЛИ + миграция — НЕ API, НЕ сервисы, НЕ RBAC.** Буква стори («Facility + Паспорт (атрибуты, проблемные места)») говорит про АТРИБУТЫ — данные, не эндпоинты. CLAUDE.md's Database Decomposition (п.1 «Table/model creation» — отдельная стори от API/сервисов) подтверждает это как самостоятельную единицу работы. API/экраны для объектов явно нигде в 12-стори списке Epic 14 не названы отдельно (14.11 — только API плана дежурств) — будет либо отдельной будущей стори (не в этом списке, добавится при необходимости), либо частью более поздней стори эпика. Эта стори закрывает ТОЛЬКО модельный слой.
- **`importance_level_code` (FK на `ops_event_levels`) — ОТЛОЖЕН.** Донор ссылается на справочник `ops_event_levels`, которого в кодовой базе ЕЩЁ НЕТ (это Epic 15's территория — «ОМ — Потребность и брокеридж»). Строить FK на несуществующую таблицу нельзя. Поле создаётся как обычный `CharField` (не FK) с явным комментарием «станет FK, когда придёт `ops_event_levels`» — тот же паттерн, что incremental-миграции этого проекта (напр. `alert_hour` добавлен ОТДЕЛЬНОЙ миграцией 13.5a на существующую модель).
- **`ops_object_passport_history` (аудит-лог правок паспорта, `DB-OPS-015`) — ОТЛОЖЕН.** Не входит в 12-стори список явным пунктом; вероятно часть 14.12 («Аудит + RBAC-строки + e2e дежурного цикла») или отдельной будущей стори при необходимости — НЕ создаётся здесь.
- **`vulnerable_places` — буквально «проблемные места».** Донор НЕ создаёт отдельную таблицу под это понятие — это ОДНО текстовое поле паспорта (`vulnerable_places TEXT`). PRD's «проблемные места» = этот же смысл, не путать с «историей мероприятий и инцидентов» (та часть FR-19 — из `ops_event_incidents`, Epic 15+ и связанных стори, вне 14.1).
- **PK — `BigAutoField`, не UUID донора.** Донор использует `UUID DEFAULT gen_random_uuid()` для `ops_objects`/`ops_object_passports`, но ЖИВАЯ кодовая база (`apps.operations.models.TimeStampedModel`, используется `bugreports`/`submissions`/`notifications`) — integer `BigAutoField` для operations-сущностей (проектное решение, докстринг модели explicit). Живой код — источник истины над донор-SQL (`[[feedback_vaps_verify_against_raise_sites]]`-класс урока: сверять с текущей кодовой базой, не буквально копировать донор).

## Acceptance Criteria

1. **AC-1 (новое Django-приложение `apps.operations.facilities`).** `Backend/VAPS/apps/operations/facilities/` — `apps.py` (`OpsFacilitiesConfig`, `name="apps.operations.facilities"`, `label="ops_facilities"`, зеркалит `apps.operations.bugreports`'s `apps.py`), зарегистрировано в `INSTALLED_APPS` (`config/settings.py`, рядом с другими `apps.operations.*`).
2. **AC-2 (модель `Object`).** `Object(TimeStampedModel)`: `code` (CharField, unique, max_length=50), `name` (CharField, max_length=255), `address` (TextField), `latitude`/`longitude` (DecimalField, null=True, blank=True — координаты не всегда известны при создании), `importance_level_code` (CharField, max_length=50, blank=True — FK-заглушка, см. Scope Decision), `is_active` (BooleanField, default=True). `db_table="ops_objects"`.
3. **AC-3 (модель `ObjectPassport`, 1:1 к `Object`).** `ObjectPassport(TimeStampedModel)`: `object` (`OneToOneField(Object, on_delete=CASCADE, related_name="passport")`), `object_type` (CharField, blank=True), `responsible_user_id`/`responsible_employee_id` (CharField, max_length=100, blank=True — ARCH-007 flat external ids, НЕ FK на `core.Employee`), `description`/`security_notes`/`vulnerable_places` (TextField, blank=True). `db_table="ops_object_passports"`.
4. **AC-4 (структурные JSONB-поля паспорта).** 12 полей `JSONField(default=list, blank=True)`: `access_routes`, `entrances`, `exits`, `service_entrances`, `parking_zones`, `dropoff_zones`, `elevators`, `stairs`, `roofs`, `basements`, `technical_rooms`, `cameras` (буквально имена донора, `DB-OPS-014`).
5. **AC-5 (инфраструктурные текстовые поля).** 8 полей `TextField(blank=True)`: `power_supply`, `ventilation`, `communication`, `internet`, `nearby_high_buildings`, `public_zones`, `crowd_places`, `repair_works`.
6. **AC-6 (`completeness_status` — DB CheckConstraint, не только choices).** `CharField` c `choices` (`RED`/`YELLOW`/`GREEN`, TextChoices), default `"RED"` (донор: «RED пока не подтверждено») + DB `CheckConstraint` (`kind__in`-паттерн, зеркалит `[[feedback_vaps_db_integrity_checks]]`'s урок — choices без DB-гарда пропускает `bulk_create`/`.objects.create()`). Автовычисление статуса (BR-OBJECT-002) — НЕ в этой стори (см. Scope Decision, модели-only).
7. **AC-7 (`last_verified_at`/`last_verified_by`).** `DateTimeField(null=True, blank=True)` / `CharField(max_length=100, blank=True)` — когда/кем паспорт последний раз подтверждён (донор `DB-OPS-014`); заполнение — забота будущего API-стори, не этой.
8. **AC-8 (миграция).** Одна `0001_initial.py` в `apps/operations/facilities/migrations/` — обе модели, оба `db_table`, `CheckConstraint` на `completeness_status`.
9. **AC-9 (Admin — справочник, реальная сущность бизнес-данных).** `Object`/`ObjectPassport` НЕ регистрируются в Admin как обычные reference-таблицы: это БИЗНЕС-сущности (растущий, изменяемый пилотом реестр объектов и их паспортов), а не статичный справочник вроде `SubmissionControlSettings`. Мирроит существующее решение проекта: `Notification`/`DailySubmission`/`BugReport` — НЕ регистрируются в Admin («Admin = только справочники», `[[feedback_vaps_arch_guards]]`). `Object`/`ObjectPassport` попадают в ту же категорию — АДМИН НЕ РЕГИСТРИРУЕТСЯ в этой стори.
10. **AC-10 (тесты + границы контекста).** Модельные тесты: создание `Object`+`ObjectPassport`, уникальность `code`, 1:1-ограничение паспорта (второй паспорт на тот же `object` → `IntegrityError`), `completeness_status` вне `{RED,YELLOW,GREEN}` → `IntegrityError` (DB-гард, не приложенческий — мирроит 13.5a's red-probe паттерн). `apps.operations.facilities` НЕ импортирует `apps.core.models` (ARCH-004, `test_isolation.py`'s существующий AST-гвард уже это проверит автоматически — без правки самого теста, он сканирует ВСЕ apps под `operations`).
11. **AC-11 (регресс нулевой).** `make gate` зелёный.

## Out of Scope

- API/сериализаторы/вьюхи для `Object`/`ObjectPassport` — не просит буква стори, будет отдельной стори при необходимости.
- `Post`/`Sector` (14.2), чек-лист (14.3) — отдельные стори, свои модели.
- `ops_object_passport_history` (аудит правок паспорта) — вероятно 14.12 или отдельная будущая стори.
- Автовычисление `completeness_status` (BR-OBJECT-002 — «RED если обязательные поля пусты») — бизнес-логика, не модельный атрибут; будущая стори (сервис/API).
- `importance_level_code`'s FK на `ops_event_levels` — справочник не существует (Epic 15), поле остаётся plain CharField до появления Epic 15's работы.
- RBAC-права на объекты/паспорта — RBAC-стори эпика (14.12) или отдельная, не эта.

## Tasks / Subtasks

- [x] Task 1 — Приложение `apps.operations.facilities` (AC: 1)
  - [x] `apps/operations/facilities/apps.py`, `__init__.py`
  - [x] `INSTALLED_APPS` в `config/settings.py`
- [x] Task 2 — Модель `Object` (AC: 2)
  - [x] `apps/operations/facilities/models.py` (один файл — 2 модели, объём не требует пакета, зеркалит `bugreports/models.py`)
- [x] Task 3 — Модель `ObjectPassport` (AC: 3, 4, 5, 6, 7)
  - [x] Все поля из AC-3..AC-7
  - [x] `CheckConstraint` на `completeness_status`
- [x] Task 4 — Миграция (AC: 8)
  - [x] `makemigrations` — одна `0001_initial.py`
- [x] Task 5 — Тесты + реальный прогон (AC: 10, 11)
  - [x] Юнит: создание, уникальность `code`, 1:1-паспорт, `completeness_status`-CHECK red-probe (4 значения параметризовано)
  - [x] `test_isolation.py` прогнан явно — зелёный (ARCH-004: `apps.operations.facilities` не импортирует `apps.core.models`)
  - [x] `make gate` зелёный, явно прогнан (3077 passed)

## Dev Notes

- **Терминология: `Object`, не `Facility`.** Класс модели, `db_table`, все docstring'и — «Object»/«объект» (донор+PRD), НЕ «Facility». Буква эпика использовала «Facility» как черновой англо-ярлык при написании epics.md — это НЕ обязывающее имя, схема донора и глоссарий PRD весят больше.
- **`app_label="ops_facilities"`, но `db_table="ops_objects"`/`"ops_object_passports"` — разные пространства имён, это нормально.** App-label — Django-внутреннее пространство миграций (мирроит `ops_submissions`/`ops_facilities`-стиль), `db_table` — реальное имя SQL-таблицы, ЯВНО заданное под донор-схему (architecture.md#L583 требует явный `db_table` для всех subdomain-приложений).
- **`OneToOneField`, не `ForeignKey(unique=True)`.** Донор's `object_id UUID UNIQUE REFERENCES` — ровно семантика Django's `OneToOneField` (один паспорт на объект, обратный доступ `object.passport`).
- **12 JSONB-полей — буквально имена донора, не переименовывать/не группировать в один JSON-блоб.** Донор явно перечисляет их как ОТДЕЛЬНЫЕ колонки (`DB-OPS-014`), не один вложенный объект — сохранить 1:1 соответствие для будущей сверки с донором (когда API появится, легче мапить поле-в-поле).
- **`CheckConstraint`-паттерн — копировать 13.5a/13.5c's установленный стиль** (`ck_<table>_<field>_choices`-именование, `Q(field__in=[...])`), не изобретать новый.
- **Admin-решение (AC-9) — намеренное расхождение с прежними reference-таблицами этого эпика (13.5a's `SubmissionControlSettings` РЕГИСТРИРУЕТСЯ в Admin).** Разница: `SubmissionControlSettings` — singleton КОНФИГ (правится редко, вручную), `Object`/`ObjectPassport` — растущий БИЗНЕС-реестр (десятки/сотни объектов, правится через будущий API/UI, не через Django Admin). Мирроит `Notification`/`DailySubmission` (бизнес-записи, НЕ в Admin), не `SubmissionControlSettings` (конфиг, В Admin).

### References

- [Source: docs/PersonnelStatus/VAPS_7.8.2.md, раздел 17 (DB-OPS-004, DB-OPS-014, DB-OPS-015)] — SQL-схема `ops_objects`/`ops_object_passports`/`ops_object_passport_history`, буквальные имена полей.
- [Source: _bmad-output/planning-artifacts/prd.md#L55, #L124 (FR-19)] — глоссарий «Объект», буква FR-19.
- [Source: _bmad-output/planning-artifacts/architecture.md#L530, #L583, #L588-589, #L611] — плановая структура `apps/operations/facilities/`, subdomain-конвенция (`name`/`label`/`db_table`), граница `operations↛core.models` (ARCH-004), FR-19↔`facilities`-маппинг.
- [Source: Backend/VAPS/apps/operations/bugreports/apps.py] — `AppConfig`-паттерн для копирования.
- [Source: Backend/VAPS/apps/operations/models.py] — `TimeStampedModel`, обоснование integer PK (докстринг explicit).
- [Source: Backend/VAPS/apps/core/tests/test_isolation.py] — существующий AST-гвард `apps.core↛other-context-models`, автоматически покроет новое приложение без правки самого теста.

## Dev Agent Record

### Context Reference

- Отдельный research-агент при create-story: полный текст донор-спеки (`ops_objects`/`ops_object_passports`/`ops_object_passport_history`, разделы 17.3-17.5), подтверждено ОТСУТСТВИЕ существующего `objects`/`facilities`-приложения в кодовой базе (чисто greenfield, не переименование/не коллизия), architecture.md's плановая структура и subdomain-конвенция, PRD's глоссарий+FR-19.

### Completion Notes

- **AC-1**: `apps/operations/facilities/apps.py` (`OpsFacilitiesConfig`, `name="apps.operations.facilities"`, `label="ops_facilities"`) — буквальная копия `bugreports/apps.py`'s структуры. Зарегистрировано в `INSTALLED_APPS` сразу после `apps.operations.bugreports`.
- **AC-2/AC-3/AC-4/AC-5/AC-6/AC-7**: `Object` (6 полей: `code`/`name`/`address`/`latitude`/`longitude`/`importance_level_code`/`is_active`) и `ObjectPassport` (`OneToOneField`, 6 текстовых + 12 JSONB-структурных + 8 инфраструктурных текстовых + `completeness_status`+`last_verified_at`/`last_verified_by`) — все поля буквально из донор-спеки `DB-OPS-004`/`DB-OPS-014`. `completeness_status` защищён `CheckConstraint` (мирроит 13.5a/13.5c's `ck_<table>_<field>_choices`-паттерн), доказано red-probe тестом на 4 невалидных значениях (`""`, `"PURPLE"`, `"red"`, `"green "` — регистр и трейлинг-пробел тоже покрыты).
- **AC-8**: одна миграция `0001_initial.py` — обе модели, `CheckConstraint` включён.
- **AC-9**: Admin НЕ регистрируется — `admin.py` не создан для этого приложения (осознанное решение, задокументировано в Dev Notes: `Object`/`ObjectPassport` — растущий бизнес-реестр, не статичный справочник).
- **AC-10**: `test_isolation.py`'s существующий AST-гвард (`apps.core↛other-context-models`) прогнан явно — зелёный без каких-либо правок самого теста (новое приложение автоматически попало под скан). 16 новых тестов (4 в `test_app.py`, 12 в `test_models.py`, включая параметризованные).
- **AC-11**: `make gate` — 3077 passed (было 3061 до стори, +16 новых тестов), "No changes detected" (новая модель НЕ API-поверхность — сериализаторов/вьюх нет, `schema.yaml` не тронут).
- **Терминология подтверждена живым кодом**: класс `Object` (не `Facility`), `db_table="ops_objects"`/`"ops_object_passports"` — буквально имена донора, задокументировано в Scope Decision почему буква эпика («Facility») не выиграла у донор-схемы.

### File List

- `Backend/VAPS/apps/operations/facilities/__init__.py` (NEW).
- `Backend/VAPS/apps/operations/facilities/apps.py` (NEW).
- `Backend/VAPS/apps/operations/facilities/models.py` (NEW) — `Object`, `ObjectPassport`.
- `Backend/VAPS/apps/operations/facilities/migrations/__init__.py` (NEW).
- `Backend/VAPS/apps/operations/facilities/migrations/0001_initial.py` (NEW).
- `Backend/VAPS/apps/operations/facilities/tests/__init__.py` (NEW).
- `Backend/VAPS/apps/operations/facilities/tests/test_app.py` (NEW) — 4 теста.
- `Backend/VAPS/apps/operations/facilities/tests/test_models.py` (NEW) — 12 тестов.
- `Backend/VAPS/config/settings.py` (MOD) — `INSTALLED_APPS` новая запись.
- `Backend/VAPS/apps/operations/facilities/migrations/0002_alter_objectpassport_object_and_more.py` (NEW, ревью-фикс) — `PROTECT` + lat/long-`CheckConstraint`.
- `Backend/VAPS/apps/operations/facilities/tests/test_models.py` (MOD, ревью-фикс) — 9 новых тестов.

## Change Log

| Дата | Изменение |
|---|---|
| 2026-07-30 | Story создана (create-story). Первая стори Epic 14 (после подтверждённой пользователем премисы «этап 2 стартовал»). Терминология донора («Object») предпочтена букве эпика («Facility»); модели-only скоуп (API/сервисы — будущие стори); `importance_level_code`'s FK и `passport_history`-таблица явно отложены (зависят от ещё не построенных частей Epic 15/14.12). |
| 2026-07-30 | dev-story: приложение `apps.operations.facilities`, модели `Object`+`ObjectPassport`, миграция, 16 тестов. `make gate` 3077 passed. Status → review |
| 2026-07-31 | 3-агентное ревью (Blind Hunter, Edge Case Hunter, Acceptance Auditor; первая попытка Edge Case Hunter/Acceptance Auditor упала по API 529 Overloaded — повторный прогон успешен). Acceptance Auditor — все 11 AC подтверждены невакуумными. Триаж 2 находок: (1) Blind Hunter + Edge Case Hunter (сошлись независимо) — `latitude`/`longitude` не имели DB-гарда диапазона (плохое геокодирование могло молча записать 999.999999) → добавлен `CheckConstraint` на оба поля (`[-90,90]`/`[-180,180]`, NULL проходит по стандартной Postgres CHECK-семантике), миграция `0002`; (2) Edge Case Hunter — `ObjectPassport.object`'s `on_delete=CASCADE` противоречит `Object.is_active`'s подразумеваемому пути деактивации (флаг, не hard delete) → `PROTECT` (мирроит `apps/operations/rbac/models.py`'s тот же паттерн «не должно молча исчезать»). 9 новых тестов (4 lat/long-red-probe, 4 lat/long-граница+NULL, 1 PROTECT-red-probe). `make gate` — 3086 passed (было 3077, +9), "No changes detected". Status → done |
