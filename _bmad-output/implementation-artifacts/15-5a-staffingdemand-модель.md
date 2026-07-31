---
baseline_commit: 6cbf0a4
---

# Story 15.5a: `SecurityEventStaffingDemand` — модель (FR-23)

Status: ready-for-dev

## Story

As a **разработчик, закладывающий фундамент «Потребности»**,
I want **event-scoped модель строк потребности в силах**,
so that **15.5b (захват данных) и 15.5c (утверждение) имеют на чём строиться**.

## Scope Decision (найдено при create-story)

- **FR-23 (`epics.md:61`, личная проверка research-агента + ре-верификация):** «Потребность (StaffingDemand): расчёт и утверждение по направлениям/Группам». Story 15.5 (`epics.md:1420`) — однострочный заголовок, известный «каркас»-пробел (`implementation-readiness-report-2026-06-11.md:275` явно признаёт: Epic 14-20's стори — skeleton, полные AC будут на этапе 2).
- **Коллизия имён — ПРОВЕРЕНА И ИСКЛЮЧЕНА.** `StaffingDemand` НЕ существует нигде в `Backend/VAPS/apps/` (личная проверка research-агента, grep по всему backend-дереву — 0 совпадений). Единственное похожее имя — `StaffingSlot` (существующая, но структурно НЕ связанная сущность, «штатная единица», другой домен). Название безопасно.
- **«Расчёт» — НЕ формула, отдельный ввод.** Frontend-прототип (`frontend/src/features/security-events/model/types.ts:49-56`, `mocks/fixtures.ts:65-70`) трактует `StaffingDemandRow` как отдельно вводимый набор строк (не производную от `SecurityEventSectorPost.need`, 15.3a) — оба поля независимы, комментарий прототипа прямо разводит уровни (recon vs demand). Никакой формулы «расчёта» нигде не найдено. Модель — плоский набор вводимых строк, как `SecurityEventSectorPost`.
- **Поля синтезированы из frontend soft-сигнала** (`StaffingDemandRow`, НЕ источник истины, тот же осторожный статус, что везде в Epic 15): `sector`, `task`, `shift`, `need` (int), `group`, `requirements`, `comment`.
- **Модель — event-scoped child, `CASCADE` на удаление `SecurityEvent`** (тот же паттерн, что `SecurityEventSectorPost`, 15.3a — строки не имеют самостоятельной ценности без своего ОМ).
- **Models + migration ТОЛЬКО** — буквальный объём 15.3a.

## Acceptance Criteria

1. **AC-1 (`SecurityEventStaffingDemand`-модель).** Поля: `event` (FK, CASCADE), `sector`, `task`, `shift`, `need` (PositiveIntegerField), `group`, `requirements`, `comment`.
2. **AC-2 (`db_table`).** `ops_security_event_staffing_demands`.
3. **AC-3 (миграция).** Единственная новая миграция, чисто на пустой БД.
4. **AC-4 (изоляция + гейт).** `test_isolation.py` покрывает автоматически, `make gate` зелёный.

## Out of Scope

- API для записи/чтения — Story 15.5b.
- Утверждение (переход RECON/DEMAND) — Story 15.5c.
- Автовычисление `need` от `SecurityEventSectorPost` — нет формулы, не эта стори (см. Scope Decision).

## Tasks / Subtasks

- [ ] Task 1 — `SecurityEventStaffingDemand`-модель (AC: 1, 2)
- [ ] Task 2 — Миграция (AC: 3)
- [ ] Task 3 — Тесты: app-smoke + `db_table` (AC: 1-4)
- [ ] Task 4 — Гейт (AC: 4)

## Dev Notes

- Читать `apps/operations/events/models.py`'s `SecurityEventSectorPost` (15.3a) — буквальный образец.
- `frontend/src/features/security-events/model/types.ts:49-56` — soft field-сигнал.

### References

- [Source: _bmad-output/planning-artifacts/epics.md:61] — FR-23 текст.
- [Source: Backend/VAPS/apps/operations/events/models.py] — `SecurityEventSectorPost`, буквальный образец (15.3a).
- [Source: frontend/src/features/security-events/model/types.ts:49-56] — `StaffingDemandRow`, soft-сигнал.

## Dev Agent Record

### Context Reference

- Research-агент лично исключил коллизию имён (`StaffingDemand` не существует в backend), подтвердил отсутствие формулы расчёта, нашёл frontend-поля.

### Completion Notes

_(заполняется dev-story)_

### File List

_(заполняется dev-story)_

## Change Log

| Дата | Изменение |
|---|---|
| 2026-07-31 | Story создана (create-story), разбита из планового `15-5` на 15.5a (модель)/15.5b (захват)/15.5c (утверждение). Коллизия имён с существующей сущностью проверена и исключена. |
