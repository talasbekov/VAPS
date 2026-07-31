---
baseline_commit: 8393dcd
---

# Story 14.7: BEFORE_DUTY-проекция

Status: ready-for-dev

## Story

As a **разработчик**,
I want **`project_duty_shift()` (14.6) также проецировал `BEFORE_DUTY`-запись, когда у смены есть `duty_type` с `before_duty_minutes > 0`**,
so that **BR-DUTY-TYPE-003 выполняется: оператор видит сотрудника «перед дежурством» за настроенное число минут до начала смены, тем же единственным (single-writer) путём, что и `DUTY`/`REST_AFTER_DUTY`**.

`epics.md:1406` (буква): «Story 14.7: BEFORE_DUTY проекция (OQ-3 duration param)». Седьмая стори Epic 14, прямое продолжение 14.6 (done).

## Scope Decision (найдено при create-story)

- **Донор буквально резервирует BEFORE_DUTY «до решения заказчика» (OQ-010) — заказчик решение принял.** `docs/PersonnelStatus/VAPS_7.8.2.md:961,1244`: «BEFORE_DUTY — зарезервировано, в MVP не проецировать до решения заказчика»; `OQ-010` (строка 1907): «BEFORE_DUTY проецируется автоматически? MVP — нет, уточнить». Заказчик (Bratan) подтвердил при create-story этой стори: строить полноценно, в MVP, как `DUTY`/`REST_AFTER_DUTY`. Донор-документ НЕ обновлён (внешний файл, не редактируется этой стори) — решение зафиксировано здесь и в этом Change Log, авторитетно для реализации.
- **Механика — по аналогии с `REST_AFTER_DUTY`, симметрично.** Донор буквально даёт только правило (`BR-DUTY-TYPE-003`, строка 5879): «`before_duty_minutes > 0` creates `BEFORE_DUTY` projection» — без явной формулы интервала. `DutyType.before_duty_minutes` (14.4, уже существует, `PositiveIntegerField(default=0)`, `CHECK before_duty_minutes >= 0` донора уже покрыт implicit-гардом `PositiveIntegerField`, урок 13.5a/14.4). Симметричная интерпретация (зеркало `REST_AFTER_DUTY`, которая начинается В КОНЦЕ смены и длится `rest_after_minutes`): `BEFORE_DUTY` начинается ЗА `before_duty_minutes` ДО начала смены и заканчивается В момент начала смены — `[starts_at - before_duty_minutes, starts_at)`.
- **`before_duty_minutes == 0` (донор-дефолт) → BEFORE_DUTY НЕ проецируется.** Буква `BR-DUTY-TYPE-003`: «`> 0` creates projection» — ноль explicitly НЕ создаёт запись. Также: если `shift.duty_type` не задан (nullable, 14.5) — BEFORE_DUTY не проецируется (нет источника `before_duty_minutes`).
- **`BEFORE_DUTY` `StatusType` — уже засеян.** `seed_statuses.py`'s `STATUS_TYPES` содержит `("BEFORE_DUTY", "Перед дежурством", 65, "BEFORE_DUTY")`, вне `HARD_BLOCK_CODES` (soft). Ничего нового не сеется.
- **`BR-DUTY-TYPE-004` (requires_reconnaissance-гейт на approve — «object passport not RED и recon within validity period») — ВНЕ ЭТОЙ СТОРИ.** Это проверка ПЕРЕД approve (может заблокировать сам переход), не часть проекции — принадлежит 14.11's HTTP/permission-слою (тот же паттерн отсрочки, что и в 14.6 для `duty.manage`-эндпоинта). `requires_reconnaissance` (14.4, уже существует на `DutyType`) в этой стори НЕ читается.
- **Точка встраивания — `project_duty_shift()` (14.6) расширяется, не новая функция.** BEFORE_DUTY — третья запись ТОГО ЖЕ single-writer'а, вызывается из ТОГО ЖЕ `approve_duty_plan()`, с тем же идемпотентным `get_or_create`-паттерном по `source_ref=f"BEFORE_DUTY:{shift.pk}"`.

## Acceptance Criteria

1. **AC-1 (BEFORE_DUTY-проекция при `duty_type.before_duty_minutes > 0`).** `project_duty_shift(shift)` создаёт ТРЕТЬЮ `EmployeeStatus` со `status_type_code="BEFORE_DUTY"`, интервал `[shift.starts_at - duty_type.before_duty_minutes минут, shift.starts_at)` (в календарных датах, та же `_to_date_range()`-конвертация), `source=OM_AUTO`, `source_ref=f"BEFORE_DUTY:{shift.pk}"`.
2. **AC-2 (без `duty_type` — BEFORE_DUTY не создаётся).** Если `shift.duty_type is None` — НИКАКОЙ `BEFORE_DUTY`-записи не создаётся (только `DUTY`+`REST_AFTER_DUTY`, как в 14.6).
3. **AC-3 (`before_duty_minutes == 0` — BEFORE_DUTY не создаётся).** Если `shift.duty_type.before_duty_minutes == 0` (донор-дефолт) — BEFORE_DUTY не проецируется.
4. **AC-4 (идемпотентность по `source_ref`, тот же паттерн 14.6).** Повторный вызов `project_duty_shift(shift)` — no-op для `BEFORE_DUTY:{shift.pk}` (0 дубликатов).
5. **AC-5 (`approve_duty_plan` — без изменений в сигнатуре, BEFORE_DUTY проецируется автоматически).** `approve_duty_plan(plan)` (14.6) продолжает работать без модификации своего тела — расширение целиком внутри `project_duty_shift()`.
6. **AC-6 (single-writer enforcement переносится).** `BEFORE_DUTY`-запись так же read-only через существующий `assert_user_editable()` (переиспользование 14.6's теста-паттерна, не новый гард).
7. **AC-7 (регресс нулевой).** Все существующие тесты 14.5/14.6 (без `duty_type` или с `before_duty_minutes=0`) продолжают проходить БЕЗ изменений своих ассертов — расширение аддитивно.
8. **AC-8 (`make gate` зелёный).**

## Out of Scope

- `BR-DUTY-TYPE-004` (reconnaissance-гейт на approve) — 14.11 или отдельная будущая стори.
- Конфликт Отдыха / BEFORE_DUTY-пересечения — 14.8.
- Re-проекция при перепланировании — 14.9.

## Tasks / Subtasks

- [ ] Task 1 — Расширить `project_duty_shift()` (AC: 1, 2, 3, 4, 5)
  - [ ] `apps/operations/duties/services.py` — блок BEFORE_DUTY внутри `project_duty_shift`, условный на `shift.duty_type_id` и `before_duty_minutes > 0`
- [ ] Task 2 — Тесты (AC: 6, 7, 8)
  - [ ] Юнит: BEFORE_DUTY создаётся с правильным интервалом при `duty_type.before_duty_minutes > 0`
  - [ ] Юнит: без `duty_type` — BEFORE_DUTY не создаётся
  - [ ] Юнит: `before_duty_minutes=0` — BEFORE_DUTY не создаётся
  - [ ] Юнит: повторный вызов — идемпотентность BEFORE_DUTY
  - [ ] Юнит: `assert_user_editable()` на BEFORE_DUTY-записи
  - [ ] Прогнать ВСЕ существующие тесты 14.5/14.6 — 0 регрессий
  - [ ] `make gate` зелёный, явно прогнан

## Dev Notes

- `DutyType.before_duty_minutes` — уже существует (`apps/operations/facilities/models.py`, 14.4), `PositiveIntegerField(default=0)`.
- Формула интервала — симметрична `REST_AFTER_DUTY`'s (`shift.ends_at` → `+rest_after_minutes`), только в обратную сторону от начала смены: `shift.starts_at - timedelta(minutes=duty_type.before_duty_minutes)` → `shift.starts_at`.
- `_to_date_range()` (14.6, review-исправлена на локализацию к `Asia/Qyzylorda`) переиспользуется буквально, без изменений.

### References

- [Source: docs/PersonnelStatus/VAPS_7.8.2.md, BR-DUTY-TYPE-003 (строка 5879), OQ-010 (строка 1907, заказчик снял вопрос при create-story)] — механика и премис-гейт.
- [Source: Backend/VAPS/apps/operations/facilities/models.py::DutyType] — `before_duty_minutes` (14.4).
- [Source: Backend/VAPS/apps/operations/duties/services.py] — `project_duty_shift`/`_to_date_range` (14.6, review-исправлена), точка расширения.

## Dev Agent Record

### Context Reference

- Донор-документ явно резервирует BEFORE_DUTY «до решения заказчика» — заказчик решение дал при create-story (AskUserQuestion): строить полноценно, в MVP. `BR-DUTY-TYPE-004` (reconnaissance-гейт) явно НЕ часть этой стори — принадлежит approve-эндпоинту (14.11).

### Completion Notes

_(заполняется dev-story)_

### File List

_(заполняется dev-story)_

## Change Log

| Дата | Изменение |
|---|---|
| 2026-07-31 | Story создана (create-story). Седьмая стори Epic 14, прямое расширение `project_duty_shift()` (14.6, done). Донор резервирует BEFORE_DUTY «до решения заказчика» (OQ-010) — заказчик подтвердил: строить полноценно в MVP, симметрично `REST_AFTER_DUTY`. `BR-DUTY-TYPE-004` (reconnaissance-гейт на approve) явно вне этой стори — 14.11. |
