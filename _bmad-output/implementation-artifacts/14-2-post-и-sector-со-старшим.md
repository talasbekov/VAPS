---
baseline_commit: 04a038b
---

# Story 14.2: `Post` и `Sector` (модели)

Status: ready-for-dev

## Story

As a **разработчик**,
I want **модели `Sector` (сектор объекта) и `Post` (пост охраны, тип/задачи/предельное время/требования)**,
so that **Epic 14's последующие стори (чек-лист 14.3, дежурства 14.5+) имеют модельный фундамент постов/секторов, сверенный с донор-спекой VAPS_7.8.2**.

`epics.md#L1402` (буква: «Post (тип, задачи, предельное время, требования) и Sector со старшим»). Вторая стори Epic 14, строится поверх 14.1's `Object`/`ObjectPassport` (done).

## Scope Decision (найдено при create-story)

- **«Sector со старшим» — донор НЕ даёт такого поля.** `docs/PersonnelStatus/VAPS_7.8.2.md` (`ops_object_sectors`, DB-OPS-005) — 6 полей: `id`/`object_id`/`name`/`sort_order`/`is_active`/`created_at`/`updated_at`. НИ ОДНОГО поля про «старшего» на уровне сектора. Единственное «старший»-понятие в донор-спеке — `ops_events.senior_user_id`/`senior_employee_id` (DB-OPS-022, уровень МЕРОПРИЯТИЯ, не сектора) и PRD's FR-19/FR-22 «Старший объекта» — это RBAC-ПЕРСОНА (роль, управляющая ВСЕМ объектом целиком, включая рекогносцировку секторов/постов), не атрибут данных на `Sector`. **Решение**: `Sector` строится буквально по донору (6 полей, БЕЗ поля старшего) — «со старшим» в заголовке стори относится к РОЛИ, которая администрирует секторы (RBAC — стори 14.12 или отдельная), не к колонке этой модели. Если это решение окажется неверным (продукту реально нужен `senior_employee_id` на секторе), это отдельный, осознанный запрос продукта — не изобретается здесь без донор-основания.
- **Модели живут в ТОМ ЖЕ файле `apps/operations/facilities/models.py`**, что `Object`/`ObjectPassport` (14.1) — тот же app, та же донор-таблица-группа (DB-OPS-005), не отдельное приложение (architecture.md#L530 явно группирует Facility/Post/Sector/паспорта/чек-листы в одном `facilities/`).
- **`post_type_code`/`ops_post_types` — тот же deferred-FK паттерн, что `importance_level_code` (14.1).** Донор ссылается на справочник `ops_post_types` (`code`/`name`, seed `FIXED`/`MOBILE`/`CHECKPOINT`/`RESERVE`), которого в кодовой базе ЕЩЁ НЕТ. Поле — обычный `CharField(default="FIXED")`, не FK (тот же аргумент, что 14.1's Scope Decision).
- **`requirements` JSONB — хранится как есть, схема НЕ валидируется в этой стори.** Донор даёт полную JSON-схему поля (`schema_version`/`min_height_cm`/`gender`/`min_rank_index`/`max_rank_index`/`required_position_codes`/`allow_overqualification`, DB-OPS-006) — но валидация ЭТОЙ схемы (структурная проверка вложенного JSON) — сервис/API-забота будущей стори, зеркалит 14.1's решение не автовычислять `completeness_status` в модельной стори.
- **`min_rating`'s enforcement — НЕ строится.** Донор (`RATING-DECISION-002`) явно говорит: «not enforced in MVP-core unless minimal rating aggregate module enabled» — поле хранится (`DecimalField(max_digits=3, decimal_places=1)`), никакой бизнес-логики проверки рейтинга здесь.
- **Терминология: `Post`/`Sector`, не альтернативные переводы.** Architecture.md's naming-канон (`:379-381`) и донор оба сходятся на этих именах — никакого расхождения с каноном, в отличие от 14.1's `Object`-vs-`Facility` (там канон проиграл донору+PRD; здесь канон и донор совпадают).

## Acceptance Criteria

1. **AC-1 (модель `Sector`).** `Sector(TimeStampedModel)`: `object` (`ForeignKey(Object, on_delete=CASCADE, related_name="sectors")`), `name` (CharField, max_length=255), `sort_order` (PositiveIntegerField, default=0), `is_active` (BooleanField, default=True). `db_table="ops_object_sectors"`. `UniqueConstraint(fields=["object", "name"])` (донор: `unique_object_sector_name UNIQUE(object_id, name)`).
2. **AC-2 (модель `Post`).** `Post(TimeStampedModel)`: `object` (`ForeignKey(Object, on_delete=CASCADE, related_name="posts")`), `sector` (`ForeignKey(Sector, on_delete=SET_NULL, null=True, blank=True, related_name="posts")` — ОПЦИОНАЛЬНАЯ группировка, донор: `sector_id ... ON DELETE SET NULL`, пост существует и без сектора), `code` (CharField, max_length=50), `name` (CharField, max_length=255). `db_table="ops_object_posts"`. `UniqueConstraint(fields=["object", "code"])` (донор: `unique_object_post_code UNIQUE(object_id, code)`).
3. **AC-3 (тип поста — deferred FK, как `importance_level_code`).** `post_type_code` (CharField, max_length=50, default="FIXED") — plain field, НЕ FK (`ops_post_types` не существует, см. Scope Decision).
4. **AC-4 (`max_service_minutes` — DB CheckConstraint на диапазон).** `PositiveIntegerField(default=480)` + `CheckConstraint` `[30, 1440]` (донор: `CHECK (max_service_minutes BETWEEN 30 AND 1440)`) — тот же DB-гард паттерн, что 14.1's ревью добавило для lat/long (не полагаться только на `PositiveIntegerField`'s > 0).
5. **AC-5 (`requirements` — JSONField, схема не валидируется).** `JSONField(default=dict, blank=True)` — хранит структуру донора (`schema_version`/`min_height_cm`/`gender`/`min_rank_index`/`max_rank_index`/`required_position_codes`/`allow_overqualification`) как есть, без Python/DB-уровневой валидации вложенной схемы (см. Scope Decision).
6. **AC-6 (расширение поста — 9 полей DB-OPS-016).** `tasks`/`features`/`location_description` (TextField, blank=True), `is_outdoor` (BooleanField, null=True, blank=True — донор без DEFAULT, буквально nullable), `max_continuous_minutes` (PositiveIntegerField, null=True, blank=True — донор без DEFAULT), `min_rating` (DecimalField, max_digits=3, decimal_places=1, null=True, blank=True), `requires_weapon`/`requires_special_equipment` (BooleanField, default=False), `requires_uniform` (BooleanField, default=True).
7. **AC-7 (`is_active` на обеих моделях).** `Post.is_active` (BooleanField, default=True) — донор's `ops_object_posts.is_active`.
8. **AC-8 (миграция).** Одна `0003_...` (следующий номер после 14.1's `0001`/`0002`) в `apps/operations/facilities/migrations/` — обе новые модели, оба `db_table`, оба `UniqueConstraint`, `max_service_minutes`'s `CheckConstraint`.
9. **AC-9 (Admin — не регистрируется).** Тот же аргумент, что 14.1's AC-9: `Sector`/`Post` — растущий бизнес-реестр (десятки постов на объект), не статичный справочник — Admin НЕ регистрируется.
10. **AC-10 (тесты + границы контекста).** Модельные тесты: создание `Sector`/`Post`, уникальность `(object, name)` на секторе и `(object, code)` на посте, `sector=None` допустим (пост без сектора), удаление `Sector` → `Post.sector` становится `NULL` (не удаляет пост, `SET_NULL`), удаление `Object` каскадно удаляет `Sector`/`Post` (донор: `ON DELETE CASCADE`), `max_service_minutes` вне `[30,1440]` → `IntegrityError` (DB-гард red-probe, 2+ значения). `test_isolation.py` — автоматически покрывает (тот же app, уже в скане).
11. **AC-11 (регресс нулевой).** `make gate` зелёный.

## Out of Scope

- Поле «старший сектора» — НЕ добавляется без донор-основания (см. Scope Decision). Если продукт явно запросит — отдельная стори/явное решение.
- Чек-лист объекта (14.3), справочник видов дежурств (14.4), API/сериализаторы/вьюхи для `Post`/`Sector` — отдельные будущие стори.
- Валидация вложенной JSON-схемы `requirements` — сервис/API-забота, не эта стори.
- `ops_post_types`-справочник и его FK — Epic 15/будущая стори, как `ops_event_levels` (14.1).
- Enforcement `min_rating` — явно отложено донором самим (`RATING-DECISION-002`).
- RBAC-права на посты/секторы — 14.12 или отдельная стори.

## Tasks / Subtasks

- [ ] Task 1 — Модель `Sector` (AC: 1)
  - [ ] `apps/operations/facilities/models.py` — класс `Sector`, `UniqueConstraint(object, name)`
- [ ] Task 2 — Модель `Post` (AC: 2, 3, 4, 5, 6, 7)
  - [ ] `apps/operations/facilities/models.py` — класс `Post`, все поля AC-2..AC-7
  - [ ] `CheckConstraint` на `max_service_minutes` `[30, 1440]`
  - [ ] `UniqueConstraint(object, code)`
- [ ] Task 3 — Миграция (AC: 8)
  - [ ] `makemigrations` — `0003_...`
- [ ] Task 4 — Тесты + реальный прогон (AC: 10, 11)
  - [ ] Юнит: создание `Sector`/`Post`, уникальность на обеих моделях
  - [ ] Юнит: `Post` без `sector` (NULL допустим)
  - [ ] Юнит: удаление `Sector` → `Post.sector` NULL (`SET_NULL`, не удаляет `Post`)
  - [ ] Юнит: удаление `Object` каскадно удаляет `Sector`+`Post`
  - [ ] Юнит: `max_service_minutes` red-probe (мин. 2 невалидных значения вне `[30,1440]`, DB-уровень)
  - [ ] `test_isolation.py` прогнан явно
  - [ ] `make gate` зелёный, явно прогнан

## Dev Notes

- **Строится ПОВЕРХ живого `models.py` 14.1 (с ревью-фиксами).** `apps/operations/facilities/models.py` уже содержит `Object` (с `CheckConstraint` на lat/long, ревью-раунд 14.1) и `ObjectPassport` (`PROTECT`, не `CASCADE`, тот же ревью-раунд) — читать файл ПЕРЕД правкой, не предполагать состояние из письма стори 14.1 (то письмо описывает ДОРЕВЬЮ-состояние в некоторых местах Completion Notes; актуальное состояние — в самом файле + миграциях `0001`/`0002`).
- **`Post.object` И `Post.sector` — ОБА поля одновременно, не взаимоисключающие.** Донор явно держит `object_id` NOT NULL на посте ДАЖЕ когда `sector_id` заполнен — сектор группирует посты ВНУТРИ объекта, не заменяет прямую связь пост↔объект. Не убирать `object`-поле «раз есть sector→object».
- **`CheckConstraint`-паттерн на `max_service_minutes` — копировать 14.1's ревью-фикс (lat/long) буквально**, не 13.5a/13.5c's `choices`-паттерн (там `__in`, здесь `__gte`/`__lte` диапазон — та же структура, что `ck_object_latitude_range`).
- **`is_outdoor`/`max_continuous_minutes` — донор БЕЗ `DEFAULT`, значит `NULL`-по-умолчанию, не `False`/`0`.** Не путать с `requires_weapon`/`requires_uniform`, у которых донор ЯВНО даёт `DEFAULT FALSE`/`DEFAULT TRUE NOT NULL` — разное поведение специально, копировать буквально из DB-OPS-016 (см. AC-6 текст).
- **`sort_order` — `PositiveIntegerField`, не `IntegerField`.** Донор: `INT DEFAULT 0` без явного диапазона, но семантика «порядок сортировки» не бывает отрицательной — `PositiveIntegerField` (тот же класс полей, что уже используется в проекте для аналогичных «счётчик/порядок»-полей).

### References

- [Source: docs/PersonnelStatus/VAPS_7.8.2.md, DB-OPS-005 (ops_object_sectors, ops_object_posts, ops_post_types), DB-OPS-006 (requirements JSON-схема), DB-OPS-016 (расширение постов, 9 полей)] — буквальные имена/типы полей.
- [Source: _bmad-output/planning-artifacts/prd.md, FR-19, FR-22] — «Старший объекта» — RBAC-персона, не атрибут Sector (обоснование Scope Decision).
- [Source: _bmad-output/planning-artifacts/architecture.md#L379-381, #L530] — naming-канон (Post/Sector совпадают с донором), плановая структура `facilities/`.
- [Source: _bmad-output/implementation-artifacts/14-1-app-operations-facilities-facility-паспорт.md] — прямой предшественник, `Object`/`ObjectPassport`, ревью-раунд (lat/long CheckConstraint, PROTECT-паттерн) — оба паттерна копируются в эту стори.
- [Source: Backend/VAPS/apps/operations/facilities/models.py] — живой файл, читать ПЕРЕД правкой (актуальнее письма 14.1).

## Dev Agent Record

### Context Reference

- Отдельный research-агент при create-story: полный текст донор-спеки для `ops_object_sectors`/`ops_object_posts`/`ops_post_types`/`requirements`-схемы/DB-OPS-016-расширения, подтверждено ОТСУТСТВИЕ поля «старший» на Sector в донор-схеме (ключевая находка — «со старшим» в заголовке стори не соответствует данным донора), подтверждено отсутствие коллизии имён `Post`/`Sector` в кодовой базе, актуальное состояние `apps/operations/facilities/models.py` (после 14.1's ревью-раунда).

### Completion Notes

_(заполняется dev-story)_

### File List

_(заполняется dev-story)_

## Change Log

| Дата | Изменение |
|---|---|
| 2026-07-31 | Story создана (create-story). Вторая стори Epic 14, строится на `Object`/`ObjectPassport` (14.1, done). «Sector со старшим» — донор не даёт поля старшего на Sector; заголовок отнесён к RBAC-роли «Старший объекта» (FR-19), не к колонке модели — задокументировано явно в Scope Decision, не изобретено без основания. |
