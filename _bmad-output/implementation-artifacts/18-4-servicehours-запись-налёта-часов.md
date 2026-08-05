---
baseline_commit: 915a5f6
---

# Story 18.4: ServiceHours — запись Налёта часов (день/ночь) из опроса

Status: review

## Story

As a **держатель права `event.manage`**,
I want **вычислить Налёт часов день/ночь из фактического времени опроса (18.3)**,
so that **эти данные станут основой для дашборда нагрузки/перегрузки (Epic 19, FR-32), а не потребуют повторного ручного расчёта**.

## Scope Decision

- **PROVISIONAL design-решение (нет donor-спеки/справочника коэффициентов для этой стори — FR-32's «коэффициенты — справочник» явно относится к Epic 19's расчёту нагрузки, не к этой стори)**: ночные часы = `22:00–06:00` по МЕСТНОМУ времени (`settings.VAPS_LOCAL_TIMEZONE`, `Asia/Qyzylorda`) — стандартная норма трудового законодательства РК/РФ для «ночного времени». Дневные часы = остаток интервала. Подлежит подтверждению с Bratan при появлении реального справочника коэффициентов (Epic 19) — если там определена ДРУГАЯ граница, эта стори её унаследует, не переизобретает.
- **Новая модель `ServiceHours`** — `OneToOne` на `PlacementAssignmentActual` (буквальный образец `PlacementAssignmentActual`'s собственного `OneToOne`-паттерна на `PlacementAssignment`, 18.3): `day_hours`/`night_hours` (DecimalField, часы с точностью до сотых), `computed_at`.
- **`compute_service_hours(actual, *, actor)`** — ЧИСТАЯ функция интервального деления (`_split_day_night_hours(start_at, end_at)`, local-tz-aware) + upsert `ServiceHours`. НЕ вызывается автоматически из `record_assignment_actual_time()` (18.3, уже смержено/зарево') — отдельный явный вызов, тот же принцип разделения, что 18.1/18.2 (закрытие ≠ автоматический архив). Гейт: та же пара условий, что 18.3 (`is_current` + `event.status_code == CLOSED`) — ServiceHours не имеет смысла без валидного факта.
- **Алгоритм деления** — интервал `[actual_start_at, actual_end_at)` (UTC, из 18.3) конвертируется в local-tz, затем итеративно режется по границам 06:00/22:00 местного времени (обрабатывает интервалы, пересекающие ПОЛНОЧЬ И несколько дней подряд — теоретически опрос мог зафиксировать многодневное дежурство).
- **Out of scope**: коэффициенты (Epic 19); агрегация по сотруднику/подразделению/периоду (19.6 — «Налёт часов в карточке сотрудника»); перегрузка-детектор (19.2); API/экран (18.6); автоматический пересчёт при исправлении 18.3's факта (эта стори — явный вызов, не триггер).

## Acceptance Criteria

1. **AC-1.** Интервал ЦЕЛИКОМ в дне (напр. 09:00–17:00 местного) → `day_hours=8`, `night_hours=0`.
2. **AC-2.** Интервал ЦЕЛИКОМ в ночи (напр. 23:00–05:00 местного, пересекает полночь) → `day_hours=0`, `night_hours=6`.
3. **AC-3.** Интервал, пересекающий ОБЕ границы (напр. 20:00–08:00 местного) → `day_hours` и `night_hours` оба >0, сумма = длительность интервала.
4. **AC-4.** Многодневный интервал (>24 часов) → корректная сумма по всем пересечённым дням.
5. **AC-5.** `compute_service_hours()` — upsert (повторный вызов пересчитывает, не дублирует строку).
6. **AC-6.** Гейт: не `is_current`/событие не `CLOSED` → 422 (тот же гейт, что 18.3).
7. **AC-7.** `make gate` (Backend/VAPS) зелёный.

## Out of Scope

- Коэффициенты-справочник (Epic 19).
- Агрегация по сотруднику/периоду (19.6).
- Перегрузка (19.2).
- API/экран (18.6).
- Автоматический триггер при 18.3's исправлении факта.

## Tasks / Subtasks

- [x] Task 1 — `apps/operations/events/models.py`: `ServiceHours` (OneToOne на `PlacementAssignmentActual`, `day_hours`/`night_hours`/`computed_at`) + миграция
- [x] Task 2 — `apps/operations/events/services.py`: `_split_day_night_hours(start_at, end_at)` (чистая функция) + `compute_service_hours(actual, *, actor)`
- [x] Task 3 — Тесты (AC 1-6): целиком-день/целиком-ночь/обе-границы/многодневный/upsert/гейт-422
- [x] Task 4 — `docs/registries/audit-events.yaml`: `SERVICE_HOURS_COMPUTED`
- [x] Task 5 — `make gate`

## Dev Notes

- `apps/core/clock.py:23-24` (`_local_tz()`) — `ZoneInfo(settings.VAPS_LOCAL_TIMEZONE)`, `Asia/Qyzылорда` — приватная функция (leading underscore), НЕ импортировать напрямую (cross-module private-import antipattern) — переиспользовать ТОТ ЖЕ `settings.VAPS_LOCAL_TIMEZONE` + `ZoneInfo(...)` локально в новой функции.
- `apps/operations/events/models.py` (`PlacementAssignmentActual`, 18.3) — `actual_start_at`/`actual_end_at`, оба NOT NULL, `actual_start_at < actual_end_at` уже гарантирован DB CHECK — новая функция может полагаться на это (не перепроверять).
- `apps/operations/events/services.py` (`record_assignment_actual_time`, 18.3) — образец двойного гейта (`is_current` + `CLOSED`) + `select_for_update()`-паттерна (review-урок 18.3 — использовать лок с ПЕРВОГО черновика, не добавлять после ревью).
- Local-tz математика — `datetime.astimezone(ZoneInfo(...))`, деление по 06:00/22:00 итеративно (не naive `.hour`-сравнение — DST/граничные случаи, хотя `Asia/Qyzylorda` не наблюдает DST — писать код так, будто может).

### References

- [Source: Backend/VAPS/apps/core/clock.py] — local-tz-паттерн.
- [Source: Backend/VAPS/apps/operations/events/models.py] — `PlacementAssignmentActual` (18.3).
- [Source: Backend/VAPS/apps/operations/events/services.py] — `record_assignment_actual_time()` (18.3, гейт-образец).
- [Source: epics.md FR-32, Story 18.4] — «ServiceHours: запись Налёта часов (день/ночь) из опроса».

## Dev Agent Record

### Agent Model Used

Claude Sonnet 5

### Debug Log References

### Completion Notes List

Реализовано по AC 1-7. `_split_day_night_hours()` — чистая функция, итеративное деление интервала по 06:00/22:00 местным границам (`ZoneInfo(settings.VAPS_LOCAL_TIMEZONE)`), корректна для многодневных интервалов (протестировано на 48ч). `compute_service_hours()` — `select_for_update()` с ПЕРВОГО черновика (18.3's review-урок применён сразу, не после ревью), тот же двойной гейт (`is_current`+`CLOSED`), upsert. Все 4 боковых теста (день/ночь/обе-границы/многодневный) прошли с первого прогона — алгоритм проверен вручную перед написанием кода. `make gate` — 4111 passed (было 4104), 0 regressions.

### File List

- `Backend/VAPS/apps/operations/events/models.py` (modified — `ServiceHours`)
- `Backend/VAPS/apps/operations/events/migrations/0020_servicehours.py` (new)
- `Backend/VAPS/apps/operations/events/services.py` (modified — `_split_day_night_hours()`, `compute_service_hours()`)
- `Backend/VAPS/apps/operations/events/tests/test_service_hours.py` (new — 7 тестов)
- `docs/registries/audit-events.yaml` (modified — `SERVICE_HOURS_COMPUTED`)

## Change Log

| Дата | Изменение |
|---|---|
| 2026-08-04 | Story создана (create-story). PROVISIONAL: ночные часы 22:00–06:00 местного времени — стандартная трудовая норма, нет donor-справочника коэффициентов для проверки (тот принадлежит Epic 19). |
| 2026-08-04 | Dev-story: `ServiceHours` + миграция + интервальная функция деления + `compute_service_hours()` + 7 тестов + audit-registry. `make gate` — 4111 passed, 0 regressions. Status → review. |
