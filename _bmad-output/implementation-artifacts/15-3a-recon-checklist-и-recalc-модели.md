---
baseline_commit: c2ffa64
---

# Story 15.3a: Recon-чек-лист + пересчёт постов/секторов — модели (FR-22)

Status: review

## Story

As a **разработчик, закладывающий фундамент рекогносцировки**,
I want **event-scoped модели чек-листа рекогносцировки и строк пересчёта постов/секторов**,
so that **15.3b (захват данных) и 15.3c (двойной контроль + переход в RECON) имеют на чём строиться**.

## Scope Decision (найдено при create-story)

- **FR-22 (`epics.md:60`, личная проверка research-агентом + перепроверка):** «Рекогносцировка: чек-лист, корректировка расчёта постов/секторов, двойной контроль, обновление Паспорта». Четыре разных куска — это СТРУКТУРНО больше, чем 15.2b's чистый статус-переход (там не было отдельной спеки за enum-значением). Разбито на 15.3a (эта, модели) / 15.3b (захват данных) / 15.3c (двойной контроль + переход + паспорт) per CLAUDE.md decomposition rules (models/API/business-logic — разные слои, разные стори).
- **Никакой детальной спеки чек-листа/пересчёта нигде не найдено** (research-агент проверил epics.md + architecture.md — только заголовочная строка FR-22, без структуры полей). PROVISIONAL — тот же паттерн, что 15.1's статус-enum (донор-спека недоступна в этом worktree).
- **Существующая FR-19-чек-лист-подсистема (`ChecklistTemplate`/`ChecklistItem`/`ChecklistBinding`/`ChecklistOverride`, Story 14.3) — НЕ переиспользуется буквально.** Это шаблон-каталог для паспорта ОБЪЕКТА (per-object template+override), а FR-22's чек-лист — per-ОМ (per-`SecurityEvent`) разовый пропуск, структурно другая задача (не каталог с шаблонами, разовая запись результатов прохождения). Смешивать разные домены (Object-level template vs Event-level pass-through) — не оправдано отсутствием прямого требования переиспользования.
- **Frontend-прототип (`frontend/src/features/security-events/model/types.ts:28-45`) — СИЛЬНЫЙ soft-сигнал полей** (не источник истины, тот же осторожный статус, что 15.1's Scope Decision для этого прототипа): `ReconChecklistItem {id, label, done, result, comment}`, `ReconSectorPost {id, sector, post, task, need, requirements, result, comment}`. Комментарий прототипа сам явно говорит: «скопирована в контекст ОМ, не Object/Sector/Post Epic 14» — подтверждает выбор НЕ переиспользовать 14.3's модели.
- **Две новые child-модели, FK на `SecurityEvent`** (`related_name` для bulk-запросов), `db_table`-конвенция `ops_*`. `result`-поле — `TextChoices` (`MATCHES`/`NEEDS_CHANGES`), не свободный текст (прототип уже это устанавливает как select, не text input).
- **Models + migration ТОЛЬКО** — буквальный объём 15.1 (models-first паттерн этого приложения). API (bulk-запись через 15.3b) — не эта стори.

## Acceptance Criteria

1. **AC-1 (`SecurityEventChecklistItem`).** Поля: `event` (FK на `SecurityEvent`), `label`, `done` (bool), `result` (choices, nullable), `comment`.
2. **AC-2 (`SecurityEventSectorPost`).** Поля: `event` (FK), `sector`, `post`, `task`, `need` (int), `requirements`, `result` (те же choices), `comment`.
3. **AC-3 (`result`-choices — DB-level CheckConstraint).** `MATCHES`/`NEEDS_CHANGES`, nullable (не пройдено — `null`).
4. **AC-4 (`db_table`).** `ops_security_event_checklist_items` / `ops_security_event_sector_posts`.
5. **AC-5 (миграция).** Единственная новая миграция, `migrate` чисто на пустой БД.
6. **AC-6 (изоляция + гейт).** `test_isolation.py` покрывает автоматически (AST-скан), `make gate` зелёный.

## Out of Scope

- API для записи/чтения чек-листа/пересчёта (bulk create/update) — Story 15.3b.
- Двойной контроль (second-approver gate) + переход `DRAFT/BULLETIN`→`RECON` + обновление Паспорта — Story 15.3c.
- Переиспользование/интеграция с 14.3's `ChecklistTemplate`-подсистемой — не запрошено, структурно другая задача (см. Scope Decision).

## Tasks / Subtasks

- [x] Task 1 — `SecurityEventChecklistItem`-модель (AC: 1, 3, 4)
- [x] Task 2 — `SecurityEventSectorPost`-модель (AC: 2, 3, 4)
- [x] Task 3 — Миграция (AC: 5)
- [x] Task 4 — Изоляция-тест (AC: 6) — покрыто общим `test_isolation.py`, подтверждено прогоном
- [x] Task 5 — App-smoke тесты + DB-constraint-пруф (AC: 1-6, тот же паттерн, что 15.1's `test_models.py`) + CASCADE-пруф
- [x] Task 6 — Гейт (AC: 6)

## Dev Notes

- Читать `apps/operations/events/models.py` (15.1, буквальный образец докстринга/CheckConstraint-паттерна для ЭТОГО приложения) ПЕРЕД имплементацией.
- `frontend/src/features/security-events/model/types.ts:28-45` — soft-сигнал полей (НЕ источник истины).
- `result`-choices: `MATCHES` ("Соответствует") / `NEEDS_CHANGES` ("Требует изменений"), nullable.

### References

- [Source: _bmad-output/planning-artifacts/epics.md:60] — FR-22 текст.
- [Source: Backend/VAPS/apps/operations/events/models.py] — буквальный образец (15.1).
- [Source: frontend/src/features/security-events/model/types.ts:28-45] — soft field-сигнал (Smart Josparlau прототип).

## Dev Agent Record

### Context Reference

- Research-агент лично проверил FR-22 (`epics.md:60`), подтвердил отсутствие детальной чек-лист-спеки, нашёл frontend-прототип с готовыми полями (не источник истины) и явно рекомендовал разбиение на под-стори — применено буквально.

### Completion Notes

Реализовано по AC 1-6. `SecurityEventChecklistItem`/`SecurityEventSectorPost` — event-scoped child-модели, `CASCADE` на удаление `SecurityEvent` (не `PROTECT`, как у `Object`→`SecurityEvent` — эти строки не имеют самостоятельной ценности без своего ОМ). `result`-поле — общий `ReconCheckResult`-TextChoices (`MATCHES`/`NEEDS_CHANGES`), nullable + DB-level CheckConstraint (`result__in=[...] | result__isnull=True`). Поля синтезированы из `frontend/src/features/security-events/model/types.ts`'s `ReconChecklistItem`/`ReconSectorPost` (soft-сигнал, донор-спека недоступна). Миграция `0002` — единственная, применилась чисто. 8 новых тестов (db_table-смок ×2, nullable-persist, CheckConstraint-пруф ×2, CASCADE-пруф). `make gate` — 3426 passed (было 3420, +6), 0 regressions, no drift.

### File List

- `Backend/VAPS/apps/operations/events/models.py` (modified — 2 новые модели + `ReconCheckResult`)
- `Backend/VAPS/apps/operations/events/migrations/0002_securityeventchecklistitem_securityeventsectorpost.py` (new)
- `Backend/VAPS/apps/operations/events/tests/test_recon_models.py` (new)

## Change Log

| Дата | Изменение |
|---|---|
| 2026-07-31 | Story создана (create-story), разбита из планового `15-3` на 15.3a (модели)/15.3b (захват данных)/15.3c (двойной контроль+переход+паспорт) — FR-22 структурно больше 15.2b's чистого статус-перехода. |
| 2026-07-31 | Dev-story: 2 новые event-scoped child-модели + миграция + 8 тестов. `make gate` — 3426 passed. Status → review. |
