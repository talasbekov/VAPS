---
baseline_commit: 3e28e60
---

# Story 15.5b: `PUT /security-events/{id}/staffing-demand` — захват данных потребности (FR-23)

Status: ready-for-dev

## Story

As a **оператор, рассчитывающий потребность в силах**,
I want **записать/перезаписать строки потребности для ОМ**,
so that **15.5c может утвердить их**.

## Scope Decision (найдено при create-story)

- **Средняя часть разбитого `15-5`** (15.5a — модели done; эта стори — захват; 15.5c — утверждение).
- **Буквальный образец 15.3b** (`checklist`/`sector-posts` PUT-replace-паттерн): `PUT`-replace-all-семантика (не построчный CRUD — та же логика, что 15.3b's Scope Decision: форма, редактируемая целиком, не построчно), `_get_event_or_404()`-хелпер (уже существует, переиспользуется), `select_for_update()` на родительском `SecurityEvent` (тот же ревью-урок 15.3b — без него конкурентные `PUT` дают torn write).
- **Аудит — DEFERRED**, тот же принцип, что 15.3b's чек-лист/пересчёт: черновик-данные до утверждения (15.5c), не финализированное бизнес-событие. Аудируется факт УТВЕРЖДЕНИЯ (15.5c), не каждая правка черновика.
- **Permission — `event.manage`** (тот же код, что весь остальной `SecurityEventViewSet`, кроме `passport`-action, который специально object-уровневый).

## Acceptance Criteria

1. **AC-1 (replace).** `PUT /security-events/{id}/staffing-demand` с массивом строк → 200, старые строки удалены, новые созданы.
2. **AC-2 (пустой массив).** Допустим — сброс.
3. **AC-3 (permission).** Требует `event.manage` — без него 403.
4. **AC-4 (404).** Нечисловой/несуществующий id — 404, не 500.
5. **AC-5 (concurrency-safe).** `select_for_update()` на родительском `SecurityEvent` — конкурентные `PUT` не дают torn write (тот же фикс, что 15.3b).
6. **AC-6 (регресс нулевой).** `make gate` зелёный, роут — `_DeferredAudit` (audit) + `_Gate("event.manage")` (RBAC).

## Out of Scope

- Утверждение — 15.5c.
- Auto-расчёт от `SecurityEventSectorPost` — нет формулы (15.5a's Scope Decision).

## Tasks / Subtasks

- [ ] Task 1 — Сериализатор `StaffingDemandSerializer`
- [ ] Task 2 — `services.py`: `replace_staffing_demand(event, rows)` — `select_for_update()`+delete+bulk_create
- [ ] Task 3 — ViewSet `@action` `PUT .../staffing-demand`
- [ ] Task 4 — Живые реестры
- [ ] Task 5 — Тесты (replace, пустой массив, 403, 404)
- [ ] Task 6 — Гейт + схема

## Dev Notes

- Читать `apps/operations/events/services.py::replace_checklist_items()`/`replace_sector_posts()` (15.3b, включая ревью-фикс `select_for_update()`) — буквальный образец, применить `select_for_update()` СРАЗУ (не как ревью-фикс).

### References

- [Source: Backend/VAPS/apps/operations/events/services.py] — replace-функции (15.3b).
- [Source: Backend/VAPS/apps/operations/events/models.py] — `SecurityEventStaffingDemand` (15.5a).

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
| 2026-07-31 | Story создана (create-story). Буквальный образец 15.3b, `select_for_update()` применён сразу (не как ревью-фикс, урок уже учтён). |
