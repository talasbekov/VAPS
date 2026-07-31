---
baseline_commit: b69fe71
---

# Story 15.1: App operations/events — SecurityEvent + жизненный цикл

Status: ready-for-dev

## Story

As a **разработчик, закладывающий фундамент Epic 15**,
I want **модель `SecurityEvent` (охранное мероприятие) с полем жизненного цикла**,
so that **Story 15.2+ (бюллетень/рекогносцировка/потребность/брокеридж/эскалация) имеют на чём строиться**.

Первая стори Epic 15 («ОМ — Потребность и брокеридж»). Models + migration ONLY — буквальный образец 14.1 (`Object`/`ObjectPassport`) и 14.5 (`DutyPlan`).

## Scope Decision (найдено при create-story)

- **Донор-спека (`docs/PersonnelStatus/VAPS_7.8.2.md`) НЕ ПРИСУТСТВУЕТ в этом worktree** (подтверждено прямой проверкой — известное слепое пятно, см. project-память «docs/ local-only», «Два рабочих окружения VAPS»). Research-агент процитировал `architecture.md:215` как источник детального 21-состояния `ops_event_statuses` — ПРОВЕРЕНО ЛИЧНО, цитата ложная (строка 215 — про Vite-стартер, не про SecurityEvent). Урок «сверять с raise-сайтами, не доверять цитате субагента вслепую» применён — не полагаться на непроверенную находку.
- **Реальный источник для этой стори — `epics.md`'s FR-список, прочитан лично, не через субагента.** `epics.md:58-68`: FR-21 (создание+бюллетень) → FR-22 (рекогносцировка) → FR-23 (Потребность) → FR-24 (брокеридж/физнаряд) → FR-26 (Расстановка, Epic 16) → FR-27 (ознакомление) → FR-28/29 (проведение, Epic 17) → FR-30 (закрытие, Epic 18). Один `SecurityEvent`-объект живёт через ВСЕ эти эпики — статус-поле этой стори должно покрывать полный цикл, не только Epic 15's часть.
- **Статус-enum — best-effort синтез из epics.md's FR-разбивки (верифицируемой ЛИЧНО), НЕ донор-спека буквально (недоступна).** PROVISIONAL, тот же паттерн, что `seed_operations.py`'s `personnel.*`/`document.*`-раскладка («тест проверяет механизм, не политику») — пересверить с донором, когда файл станет доступен (другая машина/окружение). Значения: `DRAFT` (создано) → `BULLETIN` (FR-21, бюллетень выпущен) → `RECON` (FR-22) → `DEMAND` (FR-23) → `BROKERAGE` (FR-24) → `PLACEMENT` (FR-26, Epic 16) → `APPROVED` (FR-26) → `IN_PROGRESS` (FR-28/29, Epic 17) → `CLOSED` (FR-30, Epic 18). `CANCELLED` — на любом этапе.
- **Существующий `frontend/src/features/security-events/`** (Smart Josparlau demo, 9-этапный `SECURITY_EVENT_STAGES`: BULLETIN/RECON/DEMAND/FORCES/PLACEMENT/APPROVAL/ACKNOWLEDGEMENT/CONDUCT/CLOSED) — НЕ источник истины для backend-модели (собственный докстринг фичи признаёт: макет, не реальная схема). Структурное совпадение фаз — ожидаемо (тот же домен), НЕ повод копировать буквально. Backend-модель — из epics.md FR, не из фронтенд-прототипа. Сближение фронта с реальным API (если будет) — отдельная будущая фронтенд-стори, не эта.
- **`apps/operations/events/`** — уже зарезервированное место (`architecture.md:531`, докстринг `apps/operations/facilities/models.py`'s Story 14.1 упоминает «Epic 15's territory» для `ops_event_levels`).
- **FK на `Object`** (`apps.operations.facilities.models.Object`) — тот же межпод-доменный FK-паттерн, что `duties`→`facilities` (14.5, санкционировано ARCH-003, `test_isolation.py`).
- **`ops_event_levels`/`importance_level_code`-FK — НЕ эта стори.** `Object.importance_level_code` уже CharField-placeholder (14.1's Scope Decision) — реальный справочник останется отложен, не строится здесь (title стори его не называет).
- **Models + migration ТОЛЬКО** — без API/services/RBAC/computed-полей, буквальный объём 14.1/14.5.

## Acceptance Criteria

1. **AC-1 (`SecurityEvent`-модель).** Поля: `object` (FK на `facilities.Object`), `title`, `status_code` (choices, DB-level CheckConstraint), `created_at`/`updated_at` (`TimeStampedModel`), `senior_employee_id` (flat UUID — ARCH-002/003, «Старший объекта», FR-21).
2. **AC-2 (статус-enum — 9 значений, см. Scope Decision).** `TextChoices` + `CheckConstraint`, дефолт `DRAFT`.
3. **AC-3 (`db_table`).** `ops_security_events` (донор-конвенция `ops_*`, тот же паттерн, что `ops_duty_plans`/`ops_objects`).
4. **AC-4 (миграция).** `makemigrations` создаёт единственную новую миграцию, `migrate` проходит чисто на пустой БД.
5. **AC-5 (ARCH-003 изоляция).** Новое приложение `apps/operations/events/` не импортирует `apps.core.models` напрямую — `test_isolation.py`-паттерн, зеркалящий `duties`/`facilities`.
6. **AC-6 (регресс нулевой).** `make gate` зелёный.

## Out of Scope

- API/views/services/RBAC — future stories (15.2+).
- `ops_event_levels`-справочник / `Object.importance_level_code`-реальный FK — не эта стори.
- Бюллетень/рекогносцировка/потребность/брокеридж-поля (нормализованные суб-сущности) — 15.2+.
- Сближение с `frontend/src/features/security-events/` (Smart Josparlau прототип) — отдельная будущая работа, если понадобится.

## Tasks / Subtasks

- [ ] Task 1 — Новое Django-приложение `apps/operations/events/` (AC: 5)
  - [ ] `apps.py`, `__init__.py`, регистрация в `INSTALLED_APPS`, зеркалит структуру `duties`/`facilities`
- [ ] Task 2 — `SecurityEvent`-модель (AC: 1-3)
  - [ ] `models.py`, `TimeStampedModel`-наследование, FK на `Object`, `status_code`-choices+CheckConstraint
- [ ] Task 3 — Миграция (AC: 4)
  - [ ] `makemigrations`, применить на тестовой БД
- [ ] Task 4 — Изоляция-тест (AC: 5)
  - [ ] `apps/operations/events/tests/test_isolation.py` (или добавление в общий, если такой уже параметризован по app) — зеркалит `duties`/`facilities`'s образец
- [ ] Task 5 — Гейт (AC: 6)
  - [ ] `make gate`, явно прогнан

## Dev Notes

- Читать `apps/operations/facilities/models.py` (14.1, буквальный образец докстринга+Scope Decision+CheckConstraint-паттерна) и `apps/operations/duties/models.py` (14.5, межпод-доменный FK-паттерн) ПЕРЕД имплементацией.
- `senior_employee_id` — flat UUID, НЕ FK на `core.Employee` (ARCH-002/003, тот же паттерн, что `DutyShift.employee_id`).
- **При следующей возможности сверить эту стори (статус-enum) с реальным `docs/PersonnelStatus/VAPS_7.8.2.md`**, если файл станет доступен в этом окружении — пересмотреть значения enum, если донор даёт другую раскладку.

### References

- [Source: Backend/VAPS/apps/operations/facilities/models.py] — буквальный образец докстринга/Scope Decision/CheckConstraint (14.1).
- [Source: Backend/VAPS/apps/operations/duties/models.py] — межпод-доменный FK-паттерн (14.5).
- [Source: _bmad-output/planning-artifacts/epics.md:58-68] — FR-21..FR-30, единственный лично-верифицированный источник статус-enum.
- [Source: _bmad-output/planning-artifacts/architecture.md:531] — `apps/operations/events/`-резервация места.

## Dev Agent Record

### Context Reference

- Research-агент при create-story процитировал `architecture.md:215` как источник 21-состояния `ops_event_statuses` — ЛИЧНО ПРОВЕРЕНО, цитата ложная (строка про Vite-стартер). Статус-enum вместо этого синтезирован из epics.md's FR-21..FR-30 (прочитан лично). Донор-спека физически недоступна в этом worktree (известный блайнд-спот).

### Completion Notes

### File List

## Change Log

| Дата | Изменение |
|---|---|
| 2026-07-31 | Story создана (create-story). Первая стори Epic 15. Research-агент процитировал architecture.md:215 как источник статус-enum — цитата оказалась ложной при личной проверке (та строка про Vite-стартер). Статус-enum вместо этого синтезирован из epics.md's FR-21..FR-30 (личная проверка). Донор-спека недоступна в этом worktree. Существующий frontend/security-events (Smart Josparlau прототип) НЕ источник истины для backend-модели. |
