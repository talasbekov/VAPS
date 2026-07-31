---
baseline_commit: 2f0e3547fb09c367d666b85607095f786990b3ac
---

# Story 16.1: Placement — модель с версионированием

Status: ready-for-dev

## Story

As a **система расстановки**,
I want **версионируемую модель Расстановки (Placement) с построчными назначениями сотрудников**,
so that **черновик→согласование→утверждение (FR-26) имеют на что опереться, прежде чем строить логику формирования/конфликтов/утверждения**.

## Scope Decision (найдено при create-story)

- **Первая стори Epic 16** (`epics.md:1431`), FR-25/26/27 (`epics.md:63-65`): FR-26 — «Черновая Расстановка (Placement) автоматически → согласование с возвратом → утверждение (один approver, hash-ready заглушка ЭЦП); версионирование; упрощённая печать». FR-25 — конфликт-проверки. FR-27 — уведомления+ознакомление.
- **Модель/архитектура ЕЩЁ НЕ решены детально.** `architecture.md` фиксирует ТОЛЬКО глоссарий (`Расстановка → Placement`, `architecture.md:382`) и расположение (`apps/operations/events/`, `architecture.md:531`) — нет выделенного ARCH-ID под конкретную схему. **Ближайший архитектурный прецедент версионирования — `DailySubmission`** (`ARCH-DATA-021`/`ARCH-DATA-025`): immutable-версии + partial-unique `is_current` (ровно одна текущая версия на ключ) + unique `(ключ, version)`. Эта стори переиспользует ЭТОТ паттерн буквально для `AssignmentVersion`, а НЕ паттерн `apps/operations/duties`'s `DutyPlan` (mutable single-status, БЕЗ истории версий) — `duties` = повторяющийся месячный план, `Placement` = разовая версионируемая расстановка на конкретное ОМ с циклом submit→return→resubmit, структурно другое.
- **Два уровня модели, найденные research-агентом через `docs/registries/ws-message-types.yaml`'s УЖЕ ЗАРЕЗЕРВИРОВАННЫЕ типы** (`ASSIGNMENT_SUBMITTED`/`ASSIGNMENT_RETURNED`/`ASSIGNMENT_APPROVED` на `/assignment-versions/{id}`, `ACK_REQUIRED`/`ACK_MISSING_ESCALATION` на `/assignments/{id}`, `SOFT_CONFLICT_DETECTED` vs `HARD_BLOCK_ATTEMPT`): **(1) `AssignmentVersion`** — заголовок версии (статус DRAFT/SUBMITTED/RETURNED/APPROVED, привязка к `SecurityEvent`, версионирование по паттерну `DailySubmission`); **(2) `PlacementAssignment`** — построчное назначение сотрудника на пост внутри версии (`employee_id` — плоский UUID, `post` — FK на `ops_facilities.Post`, `acknowledged_at` — nullable, для будущего FR-27; поле-заглушка под конфликт-класс — soft/hard, реальная детекция — Story 16.3).
- **Явный, признанный незакрытый коллизионный риск с Epic 15 (Story 15.9's Acceptance Auditor-ревью), НЕ решается этой стори:** `SecurityEventDirectAssignment` (физнаряд, 15.9) сегодня БЕЗ гарда против двойного назначения («система пассивна» — намеренно), тогда как frontend-прототип (`PlacementAssignment` в `types.ts`) уже несёт «жёсткое правило против двойного назначения». Эта модель (16.1) добавляет ТОЛЬКО данные-структуру, БЕЗ enforcement — реальный hard-block (`HARD_BLOCK_ATTEMPT`) строится в 16.3. Задокументировано явно как открытый вопрос для 16.3, не изобретается решение здесь.
- **FR-27's открытый вопрос («компьютер у рядового сотрудника?», implementation-readiness-отчёт) НЕ блокирует эту стори** — модель-уровня `acknowledged_at`-поле не зависит от канала доставки (личный кабинет vs «экран зачитывания»), доставка — Story 16.6.
- **`audit-events.yaml` не содержит зарезервированных `PLACEMENT_*`/`ASSIGNMENT_VERSION_*`-записей** (только устаревшие generic `ASSIGNMENT_CREATED`/`ASSIGNMENT_DELETED`/`GROUP_ASSIGNMENT_CREATED`, не привязанные к Epic 16) — новые записи добавляет стори, которая реально пишет мутации (16.2+), не эта (модель+миграция, без сервиса/API).
- **Область стори — ТОЛЬКО модель+миграция**, тот же паттерн, что 15.5a/15.6/15.7a/15.9 (модель отдельно от сервиса/API/конфликт-логики). Черновое авто-формирование (16.2), конфликт-детектор (16.3), утверждение (16.4), проекция статусов (16.5), уведомления (16.6), печать (16.7), API/аудит/e2e (16.8) — все последующие стори.

## Acceptance Criteria

1. **AC-1 (`AssignmentVersion`-модель).** FK на `SecurityEvent`, `status` (`DRAFT`/`SUBMITTED`/`RETURNED`/`APPROVED`, TextChoices+CheckConstraint), `version` (PositiveIntegerField, ≥1), `is_current` (Boolean).
2. **AC-2 (ровно одна текущая версия на событие).** `UniqueConstraint(event, is_current=True)` (partial-unique, паттерн `DailySubmission`).
3. **AC-3 (версии различны).** `UniqueConstraint(event, version)`.
4. **AC-4 (`PlacementAssignment`-модель).** FK на `AssignmentVersion` (CASCADE — построчные назначения не переживают удаление версии-черновика), `employee_id` (плоский UUID, БЕЗ FK — ARCH-003), `post` FK на `ops_facilities.Post` (PROTECT), `acknowledged_at` (nullable DateTimeField), поле-заглушка конфликт-класса (`conflict_severity`, nullable/blank — заполняется 16.3, не эта стори).
5. **AC-5 (иммутабельность версии — CheckConstraint на уровне БД, не только конвенция).** `version >= 1`.
6. **AC-6 (регресс нулевой).** `make gate` зелёный, миграция чистая, ноль изменений вне `apps/operations/events/models.py`+миграции (+ возможно `apps/operations/events/tests/test_models.py` для happy-path модельных тестов).

## Out of Scope

- Сервис/API/представления — все последующие стори Epic 16 (16.2-16.8).
- Реальная детекция конфликтов (двойное назначение, Отдых, перегрузка, несоответствие Посту) — Story 16.3; эта стори только резервирует поле.
- Enforcement против двойного назначения (`SecurityEventDirectAssignment` vs `PlacementAssignment` коллизия, найдено в 15.9's ревью) — Story 16.3, не решается здесь.
- Уведомления/WS-эмиссия (`ASSIGNMENT_SUBMITTED` и т.д., уже зарезервированы в реестре) — Story 16.6.
- Печатная форма — Story 16.7.
- Аудит-события — добавляются стори, которая реально мутирует (16.2+), не эта.

## Tasks / Subtasks

- [ ] Task 1 — `AssignmentVersion`-модель + миграция (статус-enum, версионирование по паттерну `DailySubmission`)
- [ ] Task 2 — `PlacementAssignment`-модель + миграция (в той же миграции или следующей — построчные назначения)
- [ ] Task 3 — Модельные тесты (happy-path создания; `UniqueConstraint`-инварианты; `CheckConstraint`-инварианты)
- [ ] Task 4 — Гейт

## Dev Notes

- Читать `apps/operations/submissions/models/daily_submission.py` ЦЕЛИКОМ ПЕРЕД правкой — версионирование этой стори буквально копирует его паттерн (partial-unique `is_current` + unique `(ключ, version)` + `CheckConstraint(version__gte=1)`), НЕ изобретать заново.
- Читать `apps/operations/duties/models.py` — образец `employee_id`-плоского-UUID + `post` PROTECT-FK-конвенции (НЕ версионный паттерн — `DutyShift` mutable, не подходит для версий).
- `apps/operations/events/models.py`'s `SecurityEvent.StatusCode` — `PLACEMENT`/`APPROVED` уже существуют (Epic 15), `AssignmentVersion.event`-FK указывает сюда.
- ARCH-003: `employee_id` — плоский UUID, НЕ FK на `core_employees` (та же конвенция, что `DutyShift`/`SecurityEventDirectAssignment`).

### References

- [Source: _bmad-output/planning-artifacts/epics.md:63-65] — FR-25/26/27 текст.
- [Source: _bmad-output/planning-artifacts/epics.md:1429-1439] — Epic 16 весь список стори.
- [Source: _bmad-output/planning-artifacts/architecture.md:382] — глоссарий «Расстановка → Placement».
- [Source: _bmad-output/planning-artifacts/architecture.md:531] — расположение (`apps/operations/events/`).
- [Source: Backend/VAPS/apps/operations/submissions/models/daily_submission.py] — версионирование, буквальный образец.
- [Source: Backend/VAPS/apps/operations/duties/models.py] — `employee_id`-плоский-UUID + PROTECT-FK-конвенции.
- [Source: docs/registries/ws-message-types.yaml] — `ASSIGNMENT_SUBMITTED`/`ASSIGNMENT_RETURNED`/`ASSIGNMENT_APPROVED`/`ACK_REQUIRED`/`ACK_MISSING_ESCALATION`/`SOFT_CONFLICT_DETECTED`/`HARD_BLOCK_ATTEMPT` — структурные подсказки для полей модели.
- [Source: Backend/VAPS/apps/operations/events/models.py] — `SecurityEventDirectAssignment`'s docstring, признанный коллизионный риск с будущим `PlacementAssignment` (15.9's ревью).

## Dev Agent Record

### Context Reference

- Research-агент лично подтвердил: детальная схема версионирования НЕ зафиксирована в architecture.md (только глоссарий+расположение); `DailySubmission` — ближайший, буквально переиспользуемый архитектурный прецедент; `duties`-app — НЕ подходящий прецедент (mutable, не версионируемый); полный список зарезервированных WS-типов даёт структурные подсказки полей; явный, уже задокументированный (15.9) коллизионный риск с `SecurityEventDirectAssignment` — не решается этой стори.

### Completion Notes

_(заполняется dev-story)_

### File List

_(заполняется dev-story)_

## Change Log

| Дата | Изменение |
|---|---|
| 2026-08-01 | Story создана (create-story). Epic 15 закрыт, начало Epic 16. Модель+миграция only — тот же паттерн, что 15.5a/15.6/15.7a/15.9. Версионирование — буквальный образец `DailySubmission` (ARCH-DATA-021/025), НЕ `duties`-app паттерн. |
