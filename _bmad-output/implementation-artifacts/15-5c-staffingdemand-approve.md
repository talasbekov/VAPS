---
baseline_commit: 6cbf0a4
---

# Story 15.5c: `POST /security-events/{id}/staffing-demand/approve` — утверждение Потребности (FR-23)

Status: done

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

- [x] Task 1 — `services.py`: `approve_staffing_demand(event, *, actor)` — буквальный образец `issue_bulletin()`
- [x] Task 2 — ViewSet `@action` `POST .../staffing-demand/approve`
- [x] Task 3 — Живые реестры
- [x] Task 4 — Тесты (успех, идемпотентность, конфликт, 403, аудит-снимок)
- [x] Task 5 — Гейт + схема

## Dev Notes

- Читать `apps/operations/events/services.py::issue_bulletin()` (15.2b) — буквальный образец.

### References

- [Source: Backend/VAPS/apps/operations/events/services.py] — `issue_bulletin()` (15.2b).
- [Source: _bmad-output/planning-artifacts/epics.md:61] — FR-23 текст (нет упоминания двойного контроля).

## Dev Agent Record

### Context Reference

_(заполняется dev-story)_

### Completion Notes

Реализовано по AC 1-6. `approve_staffing_demand()` — буквальный образец `issue_bulletin()`: непустой-`actor`-гвард, `select_for_update()`, строгий `RECON`-гейт, идемпотентный no-op на `DEMAND`, `INVALID_LIFECYCLE_TRANSITION`(422) на прочих статусах. Аудит `SECURITY_EVENT_DEMAND_APPROVED` содержит снимок всех строк `staffing_demands` на момент утверждения (прослеживаемость). `POST .../staffing-demand/approve` — тонкий `@action`. Оба живых реестра обновлены (`_Audited()`+`_Gate`). 5 новых тестов (успех/идемпотентность/конфликт/403/аудит-снимок). `make gate` — 3521 passed (было 3506, +15), 0 regressions, no drift.

**Ревью (Blind Hunter/Edge Case Hunter/Acceptance Auditor, параллельно):** все три агента — 0 багов. Blind Hunter лично проверил через DRF-исходники, что вложенный `url_path="staffing-demand/approve"` резолвится в правильное route-имя (`url_name` берётся из имени метода, не из `url_path`) — оба живых реестра корректны. Edge Case Hunter эмпирически подтвердил отсутствие URL-коллизии между `staffing-demand` (PUT) и `staffing-demand/approve` (POST) — кросс-методные пробы дают чистый 405, не путаницу; также прогнал полную цепочку DRAFT→BULLETIN→RECON(двойной контроль)→PUT потребность→POST утверждение — всё выжило нетронутым. Acceptance Auditor — 6/6 AC PASS, независимо перепроверил single-actor-vs-dual-control обоснование (FR-22 явно называет двойной контроль, FR-23 — нет), нашёл косметическую опечатку в имени тест-файла в комментарии — исправлено. Status → done.

### File List

- `Backend/VAPS/apps/operations/events/services.py` (modified — `approve_staffing_demand()`)
- `Backend/VAPS/apps/operations/events/api/views.py` (modified — `staffing_demand_approve`-action)
- `Backend/VAPS/apps/operations/events/tests/test_staffing_demand_approve.py` (new)
- `Backend/VAPS/apps/audit/tests/test_audit_coverage.py` (modified — `_Audited()`-запись)
- `Backend/VAPS/apps/operations/tests/test_rbac_matrix.py` (modified — `_Gate`-запись)
- `docs/registries/audit-events.yaml` (modified — `SECURITY_EVENT_DEMAND_APPROVED`-запись)
- `Backend/VAPS/schema.yaml` (regenerated)

## Change Log

| Дата | Изменение |
|---|---|
| 2026-07-31 | Story создана (create-story). Single-actor гейт выбран (не двойной контроль) — FR-23, в отличие от FR-22, не упоминает двойной контроль буквально. |
| 2026-07-31 | Dev-story: `approve_staffing_demand()` + `POST .../approve`-action. 5 новых тестов, оба живых реестра обновлены, схема регенерирована. `make gate` — 3521 passed. Status → review. |
| 2026-07-31 | Ревью (3 агента параллельно): 0 багов, 6/6 AC PASS, URL-роутинг вложенного пути верифицирован через DRF-исходники + эмпирически. Косметический фикс комментария. Status → done. Epic 15's Story 15.5 (a/b/c) полностью закрыта. |
