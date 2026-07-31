---
baseline_commit: 6cbf0a4
---

# Story 15.7a: `GroupForceRequest` — модель (FR-24, Story 15.7 «Запросы Группам»)

Status: review

## Story

As a **разработчик, закладывающий фундамент запросов Группам**,
I want **event-scoped модель агрегированного запроса на Группу**,
so that **15.7b (генерация+рассылка) и 15.8 (выделение брокером) имеют на чём строиться**.

## Scope Decision (найдено при create-story)

- **Story 15.7 (`epics.md:1422`, личная проверка research-агента + ре-верификация):** «Запросы Группам (рассылка, статусы запроса)» — FR-24 (`epics.md:62`): «Двухуровневый брокеридж: запросы Группам → брокеры выделяют; физнаряд — ОМД напрямую». Разбито на 15.7a (модель) / 15.7b (генерация+рассылка API) per CLAUDE.md decomposition (models/API — разные слои).
- **Никакой backend-сущности с таким смыслом не существует** (личная проверка research-агента: grep `ForceRequest|force_request|GroupRequest` по всему `Backend/VAPS/` — 0 совпадений). Frontend-прототип (`frontend/src/features/security-events/model/types.ts:60-74`, `mocks/demandLogic.ts:1-25`) — soft-сигнал, НЕ источник истины: `ForceRequest {id, group, requestedCount, allocatedCount, status: NOT_SENT|SENT|PARTIALLY_ALLOCATED|ALLOCATED, comment}`, агрегат по группе (сумма `need` из `StaffingDemandRow`).
- **Поля синтезированы из frontend-сигнала** — ближайшее структурное соответствие, epics.md/architecture.md не дают деталей полей ни для FR-24, ни для Story 15.7.
- **`group` — теперь FK на `Group`-справочник (15.6)**, НЕ свободный текст (в отличие от `SecurityEventStaffingDemand.group`, которая осталась текстом — 15.6's Scope Decision явно отложила эту миграцию для уже-закрытой 15.5a-модели; здесь — новая модель, FK с самого начала оправдан, конфликта с прошлым решением нет).
- **`allocated_count` — присутствует в модели с дефолтом `0`, НЕ записывается этой стори** (запись — 15.8's «выделение людей брокером»). Присутствует здесь, т.к. 15.8 будет мутировать существующее поле, не добавлять новое (тот же принцип, что `SecurityEvent.recon_first_confirmed_by` — поле заложено заранее для будущего потребителя).
- **`event`+`group` — unique together.** Один агрегированный запрос на пару (ОМ, Группа) — повторная генерация (15.7b) обновляет существующую строку, не дублирует (тот же «replace»-принцип, что везде в Epic 15).

## Acceptance Criteria

1. **AC-1 (`GroupForceRequest`-модель).** Поля: `event` (FK, CASCADE), `group` (FK на `Group`, PROTECT — справочник не должен исчезать под ссылками), `requested_count` (int), `allocated_count` (int, default 0), `status` (choices: `NOT_SENT`/`SENT`/`PARTIALLY_ALLOCATED`/`ALLOCATED`, default `NOT_SENT`), `comment`.
2. **AC-2 (`db_table`).** `ops_group_force_requests`.
3. **AC-3 (unique together).** `(event, group)` — DB-level `UniqueConstraint`.
4. **AC-4 (`status`-choices — DB-level CheckConstraint).**
5. **AC-5 (миграция).** Единственная новая, чисто на пустой БД.
6. **AC-6 (изоляция + гейт).** `test_isolation.py` покрывает автоматически, `make gate` зелёный.

## Out of Scope

- Генерация/агрегация из `StaffingDemand` — 15.7b.
- Запись `allocated_count`/переход в `PARTIALLY_ALLOCATED`/`ALLOCATED` — Story 15.8.
- API — 15.7b.

## Tasks / Subtasks

- [x] Task 1 — `GroupForceRequest`-модель (AC: 1-4)
- [x] Task 2 — Миграция (AC: 5)
- [x] Task 3 — Тесты: app-smoke + unique-constraint-пруф + CheckConstraint-пруф + CASCADE + PROTECT (AC: 1-6)
- [x] Task 4 — Гейт (AC: 6)

## Dev Notes

- Читать `apps/operations/events/models.py`'s `SecurityEventStaffingDemand`/`Group` (15.5a/15.6) — буквальный образец соседних моделей в том же файле.
- `PROTECT` на `group` (справочник, тот же принцип, что `SecurityEvent.object`), `CASCADE` на `event` (event-scoped child, тот же принцип, что `SecurityEventSectorPost`).

### References

- [Source: _bmad-output/planning-artifacts/epics.md:1422] — Story 15.7 текст.
- [Source: _bmad-output/planning-artifacts/epics.md:62] — FR-24 текст.
- [Source: frontend/src/features/security-events/model/types.ts:60-74] — `ForceRequest`, soft-сигнал полей.
- [Source: Backend/VAPS/apps/operations/events/models.py] — `SecurityEventStaffingDemand`/`Group`, буквальный образец (15.5a/15.6).

## Dev Agent Record

### Context Reference

- Research-агент лично подтвердил отсутствие backend-сущности, нашёл frontend `ForceRequest`-прототип (soft-сигнал), подтвердил разбиение 15.7 (запросы) vs 15.8 (выделение) — раздельные стори в epics.md.

### Completion Notes

Реализовано по AC 1-6. `GroupForceRequest` — event-scoped модель, `group` FK на `Group` (`PROTECT` — справочник не должен исчезать под ссылками, доказано `test_deleting_group_is_protected`), `event` FK `CASCADE`. `Status`-enum (4 значения) + DB-level CheckConstraint. `UniqueConstraint(event, group)` — один агрегированный запрос на пару. Миграция `0006` — единственная. 6 новых тестов (db_table, create+persist, unique-together-пруф, CheckConstraint-пруф, CASCADE-пруф, PROTECT-пруф). `make gate` — 3542 passed (было 3536, +6), 0 regressions, no drift.

### File List

- `Backend/VAPS/apps/operations/events/models.py` (modified — `GroupForceRequest`-модель)
- `Backend/VAPS/apps/operations/events/migrations/0006_groupforcerequest.py` (new)
- `Backend/VAPS/apps/operations/events/tests/test_group_force_request_model.py` (new)

## Change Log

| Дата | Изменение |
|---|---|
| 2026-07-31 | Story создана (create-story), разбита из планового `15-7` на 15.7a (модель)/15.7b (генерация+рассылка API). `group`-поле — FK на 15.6's справочник с самого начала (не текст, в отличие от уже-закрытой `SecurityEventStaffingDemand.group`). |
| 2026-07-31 | Dev-story: `GroupForceRequest`-модель + миграция + 6 тестов. `make gate` — 3542 passed. Status → review. |
