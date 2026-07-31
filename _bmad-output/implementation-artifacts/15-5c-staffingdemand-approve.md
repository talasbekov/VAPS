---
baseline_commit: 6cbf0a4
---

# Story 15.5c: `POST /security-events/{id}/staffing-demand/approve` — утверждение Потребности (FR-23)

Status: ready-for-dev

## Story

As a **утверждающий оператор**,
I want **утвердить рассчитанную Потребность в силах**,
so that **ОМ может продвинуться к брокериджу (Epic 15's следующий шаг, FR-24)**.

## Scope Decision (найдено при create-story)

- **Финальная часть разбитого `15-5`** (15.5a — модели done, 15.5b — захват done, эта стори — утверждение).
- **«Утверждение» — single-actor гейт, НЕ двойной контроль.** Research-агент лично проверил: FR-23 (`epics.md:61`) не упоминает двойной контроль (в отличие от FR-22's рекогносцировки, которая явно его называет). Ближайший структурный прецедент — `issue_bulletin()` (15.2b, простой одноактёрный переход), не `confirm_recon()` (15.3c, двойной контроль — синтезирован ИМЕННО потому, что FR-22 явно требовал «двойной контроль», здесь такого текста нет).
- **Транзит СТРОГО из `RECON`→`DEMAND`.** Симметрично предыдущим переходам линейного цикла (`DRAFT`→`BULLETIN`, `BULLETIN`→`RECON`). Конфликт статуса → `INVALID_LIFECYCLE_TRANSITION` (422).
- **Идемпотентность на уже-`DEMAND`** — тот же паттерн, что `issue_bulletin()`'s `was_draft`-гвард.
- **Аудит — на реальном переходе.** `SECURITY_EVENT_DEMAND_APPROVED`, содержит снимок утверждённых строк (`event.staffing_demands`) для полной прослеживаемости на момент утверждения.
- **Permission — `event.manage`** (тот же код, весь `SecurityEventViewSet`).

## Acceptance Criteria

1. **AC-1 (успешный переход).** `POST /security-events/{id}/staffing-demand/approve` на ОМ в `RECON` → 200, `status_code` становится `DEMAND`.
2. **AC-2 (идемпотентность).** Повторный вызов на уже-`DEMAND` → 200, no-op, без повторного аудита.
3. **AC-3 (конфликт статуса).** Вызов НЕ из `RECON`/`DEMAND` → 422.
4. **AC-4 (permission).** Требует `event.manage` — без него 403.
5. **AC-5 (аудит).** `SECURITY_EVENT_DEMAND_APPROVED` — только на реальном переходе, содержит снимок строк потребности.
6. **AC-6 (регресс нулевой).** `make gate` зелёный, роут — в обоих живых реестрах (`_Audited()` + `_Gate`).

## Out of Scope

- Требование «хотя бы одна строка потребности перед утверждением» — не запрошено буквально FR-23, консервативно НЕ гейтуем (пустая Потребность технически валидна, как пустой чек-лист в 15.3b).
- Брокеридж (FR-24, Epic 15's следующий шаг) — будущая стори.

## Tasks / Subtasks

- [ ] Task 1 — `services.py`: `approve_staffing_demand(event, *, actor)` — буквальный образец `issue_bulletin()`
- [ ] Task 2 — ViewSet `@action` `POST .../staffing-demand/approve`
- [ ] Task 3 — Живые реестры
- [ ] Task 4 — Тесты (успех, идемпотентность, конфликт, 403, аудит-снимок)
- [ ] Task 5 — Гейт + схема

## Dev Notes

- Читать `apps/operations/events/services.py::issue_bulletin()` (15.2b) — буквальный образец.

### References

- [Source: Backend/VAPS/apps/operations/events/services.py] — `issue_bulletin()` (15.2b).
- [Source: _bmad-output/planning-artifacts/epics.md:61] — FR-23 текст (нет упоминания двойного контроля).

## Dev Agent Record

### Context Reference

_(заполняется dev-story)_

### Completion Notes

_(заполняется dev-story)_

### File List

_(заполняется dev-story)_

## Change Log

| Дата | Изменение |
|---|---|
| 2026-07-31 | Story создана (create-story). Single-actor гейт выбран (не двойной контроль) — FR-23, в отличие от FR-22, не упоминает двойной контроль буквально. |
