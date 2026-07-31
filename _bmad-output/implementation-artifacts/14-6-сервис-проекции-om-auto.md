---
baseline_commit: ad55f47
---

# Story 14.6: Сервис проекции OM_AUTO (DUTY/REST_AFTER_DUTY)

Status: ready-for-dev

## Story

As a **разработчик**,
I want **сервис в `apps.operations.duties`, который при утверждении плана дежурств проецирует смены (`DutyShift`) в `EmployeeStatus`-записи `DUTY`+`REST_AFTER_DUTY` с `source=OM_AUTO`, идемпотентно по `source_ref`**,
so that **BR-017's «утверждённая смена автоматически создаёт Статусы» работает как единственный (single-writer) источник этих двух типов записей, готовый к вызову из будущего API-эндпоинта (14.11)**.

`epics.md:1406` (буква): «Story 14.6: Сервис проекции OM_AUTO (единственный writer; DUTY/REST_AFTER_DUTY; идемпотентность по source_ref; enforcement-тест)». Шестая стори Epic 14, строится на `DutyPlan`/`DutyShift` (14.5, done) и на уже существующем `EmployeeStatus`/`StatusType` (Epic 3).

## Scope Decision (найдено при create-story)

- **`source=OM_AUTO`, `source_ref` — оба поля УЖЕ существуют на `EmployeeStatus`, ничего не добавляется в статусную модель.** `apps/operations/statuses/models/employee_status.py`'s `Source.OM_AUTO` (комментарий: «owned by the duty/event projection (E14)») и `source_ref` (комментарий: «Owner/idempotency key for projection-written rows (e.g. "DUTY:42")») спроектированы ИМЕННО под эту стори ещё в Epic 3 — реализация лишь ЗАПОЛНЯЕТ уже подготовленный контракт.
- **`StatusType` для `DUTY`/`REST_AFTER_DUTY` — уже засеяны.** `apps/operations/statuses/management/commands/seed_statuses.py`'s `STATUS_TYPES` содержит `("DUTY", "На дежурстве", 70, "ON_DUTY")` и `("REST_AFTER_DUTY", "После дежурства", 60, "AFTER_DUTY")`, оба вне `HARD_BLOCK_CODES` (soft). Ничего нового не сеется.
- **Существующий `create_status()` (services/status_service.py) НЕ переиспользуется — новый writer-путь.** `create_status()` явно форсирует `source=USER` («AC-7 — projection-owned rows are written by operations, never here») и гоняет `_validate_interval` (проверка hire_date/dismissal_date сотрудника) + `_assert_no_conflict` (soft/hard конфликт-детектор). BR-017 не упоминает ни одной из этих проверок для проекции — донор буквально: «система проецирует... `source_code='DUTY_AUTO'`» без условий. Эта стори строит ОТДЕЛЬНУЮ функцию `project_duty_shift()` в `apps/operations/duties/services.py`, которая создаёт `EmployeeStatus` НАПРЯМУЮ (`EmployeeStatus.objects.get_or_create(source_ref=..., defaults=...)`), минуя `create_status()`'s employee-boundary и conflict-проверки — они не часть BR-017's контракта, и конфликт-логика явно принадлежит 14.8 («Конфликт Отдыха»), не этой стори.
- **Донор: `DUTY_AUTO` vs VAPS: `OM_AUTO`.** Донор-спека (`VAPS_7.8.2.md:518`) использует `source_code` enum `USER/KU_SYNC/DUTY_AUTO/ASSIGNMENT_AUTO`; VAPS уже нормализовал это в ОДНО значение `OM_AUTO` ещё при Epic 3 (`EmployeeStatus.Source`). Это — уже решённое, более раннее архитектурное решение, не предмет пересмотра в этой стори; используется `OM_AUTO` буквально, без введения `DUTY_AUTO`.
- **Кросс-сабдоменный импорт `duties→statuses` — разрешён, без нового isolation-исключения.** `apps/operations/tests/test_isolation.py` гвардит ТОЛЬКО (1) `operations`↛`apps.core.models` и (2) `statuses`↛`submissions` (однонаправленно). Ни одного правила `duties`↛`statuses` не существует — тот же класс сиблинг-сабдоменного доступа, что уже установлен `duties→facilities` (14.5). Направление зависимости (`duties` знает о `statuses`, не наоборот) естественно — дежурства ПОРОЖДАЮТ статусы, не читаются ими.
- **`DutyPlan.status_code` DRAFT→APPROVED переход — ВКЛЮЧЁН в эту стори КАК ЧИСТЫЙ ДОМЕННЫЙ ВЫЗОВ, БЕЗ HTTP/permission/audit-слоя.** `apps/operations/duties/services.py::approve_duty_plan(plan)` — переводит `status_code` в `APPROVED` (идемпотентно: повторный вызов на уже-`APPROVED` плане — no-op, не ошибка, зеркалит донор's «duplicate approval is idempotent») и вызывает `project_duty_shift()` для каждой смены плана. `POST /api/operations/duty-plans/{id}/approve`, разрешение `duty.manage`, RBAC-строка, audit-логирование HTTP-уровня — ВСЕ явно отложены на 14.11 («API и экраны плана дежурств», уже зарезервирована в epics.md). Обоснование по CLAUDE.md: модели/сервисы/API — разные слои, эндпоинт без сервиса построить бессмысленно, но сервис без эндпоинта — тестируемая, самодостаточная единица.
- **Календарные даты `EmployeeStatus.date_start`/`date_end` (полуоткрытый `[start, end)`, ARCH-DATA-023) vs `DutyShift.starts_at`/`ends_at` (datetime).** `_validate_interval`'s комментарий подтверждает: односуточный интервал `[D, D+1)` — валиден (1 день). Правило конвертации для этой стори: `date_start = starts_at.date()`; `date_end = ends_at.date()` если `ends_at`'s время ровно полночь (00:00), иначе `ends_at.date() + 1 день` (смена «захватывает» календарный день, на который приходится её конец, если конец не ровно на границе суток). Для `DUTY` — интервал самой смены; для `REST_AFTER_DUTY` — `starts_at=shift.ends_at`, `ends_at=shift.ends_at + 24 часа` (донор буквально), та же конвертация в календарные даты.
- **BEFORE_DUTY, конфликт Отдыха, re-проекция при перепланировании — вне этой стори.** Все три — буква 14.7/14.8/14.9 соответственно, уже зарезервированы в epics.md.
- **Employee hire_date/dismissal_date boundary-проверка — НЕ выполняется в этой стори.** См. выше — `_validate_interval`'s employment-границы принадлежат `create_status()`'s (ручного) пути; BR-017 не упоминает их для проекции, и OM_AUTO-запись авторитетна по построению (план уже утверждён кем-то с правом `duty.manage`, а не произвольным вводом оператора).

## Acceptance Criteria

1. **AC-1 (`project_duty_shift` — DUTY-запись).** `apps/operations/duties/services.py::project_duty_shift(shift)` создаёт ОДНУ `EmployeeStatus` со `status_type_code="DUTY"`, `employee_id=shift.employee_id`, `date_start`/`date_end` по правилу конвертации выше, `source=EmployeeStatus.Source.OM_AUTO`, `source_ref=f"DUTY:{shift.pk}"`.
2. **AC-2 (`project_duty_shift` — REST_AFTER_DUTY-запись).** Та же функция создаёт ВТОРУЮ `EmployeeStatus` со `status_type_code="REST_AFTER_DUTY"`, интервал `[shift.ends_at, shift.ends_at + 24h)` (в календарных датах), `source=OM_AUTO`, `source_ref=f"REST_AFTER_DUTY:{shift.pk}"`.
3. **AC-3 (идемпотентность по `source_ref`).** Повторный вызов `project_duty_shift(shift)` на УЖЕ спроецированной смене — no-op: НЕ создаёт дубликаты (`EmployeeStatus.objects.filter(source_ref=...).count()` остаётся 1 для каждого из двух `source_ref`), не бросает исключение.
4. **AC-4 (`approve_duty_plan` — переход статуса).** `apps/operations/duties/services.py::approve_duty_plan(plan)` переводит `plan.status_code` в `APPROVED` и сохраняет.
5. **AC-5 (`approve_duty_plan` — проекция ВСЕХ смен плана).** Вызывает `project_duty_shift()` для КАЖДОЙ `DutyShift` плана (`plan.shifts.all()`).
6. **AC-6 (`approve_duty_plan` — идемпотентность самого перехода).** Повторный вызов `approve_duty_plan()` на уже-`APPROVED` плане — no-op (не бросает исключение, не создаёт дубликаты статусов — переиспользует AC-3's гарантию).
7. **AC-7 (single-writer enforcement — существующий гард, новый тест со стороны duties).** Ручная попытка изменить/отменить спроецированную запись (`EmployeeStatus.source=OM_AUTO`) через существующий статусный сервис (`cancel_status`/аналог из `status_service.py`) вызывает `DomainError` `AUTO_STATUS_READONLY` (422) — тест ПОДТВЕРЖДАЕТ уже существующий `assert_user_editable()`-гард на РЕАЛЬНО спроецированной этой стори записи, не строит новый гард.
8. **AC-8 (без обхода конфликт-детекции — не тема этой стори).** Проекция НЕ вызывает `_assert_no_conflict`; пересекающиеся DUTY/REST_AFTER_DUTY-интервалы допускаются на уровне этой стори без ошибки (конфликт — 14.8's территория). Тест: две пересекающиеся по времени смены одного сотрудника обе успешно проецируются без исключения.
9. **AC-9 (регресс нулевой).** `make gate` зелёный: существующие статусные тесты (Epic 3-11) не затронуты — новый код только ДОБАВЛЯЕТ writer-путь, не меняет `create_status()`/`cancel_status()`/`assert_user_editable()`.
10. **AC-10 (изоляция).** `apps.operations.duties` импортирует `apps.operations.statuses` (модель + возможно вспомогательный тип), НЕ импортирует `apps.core.models` напрямую. `test_isolation.py` проходит без изменений.

## Out of Scope

- `POST /api/operations/duty-plans/{id}/approve`, разрешение `duty.manage`, RBAC-строка, HTTP-уровневое audit-логирование — 14.11.
- BEFORE_DUTY-проекция — 14.7.
- Конфликт Отдыха (soft-блок/override при пересечении REST_AFTER_DUTY с чем-то ещё) — 14.8.
- Re-проекция при перепланировании/отмене дежурства (удаление/пересоздание спроецированных статусов) — 14.9.
- Employee-граничные проверки (hire_date/dismissal_date) для OM_AUTO-записей — не требуются по BR-017, не строятся здесь.

## Tasks / Subtasks

- [ ] Task 1 — `project_duty_shift()` (AC: 1, 2, 3)
  - [ ] `apps/operations/duties/services.py` — функция конвертации datetime→calendar-date (правило из Scope Decision)
  - [ ] `project_duty_shift(shift)` — DUTY + REST_AFTER_DUTY, `get_or_create` по `source_ref`
- [ ] Task 2 — `approve_duty_plan()` (AC: 4, 5, 6)
  - [ ] `approve_duty_plan(plan)` — идемпотентный переход + вызов `project_duty_shift` для каждой смены
- [ ] Task 3 — Тесты (AC: 7, 8, 9, 10)
  - [ ] Юнит: DUTY/REST_AFTER_DUTY созданы с правильными полями/датами
  - [ ] Юнит: повторный `project_duty_shift` — идемпотентность (0 новых строк)
  - [ ] Юнит: `approve_duty_plan` — status_code меняется, смены проецируются
  - [ ] Юнит: повторный `approve_duty_plan` — идемпотентность
  - [ ] Юнит: ручная правка OM_AUTO-записи через `cancel_status` → `DomainError AUTO_STATUS_READONLY`
  - [ ] Юнит: пересекающиеся смены — обе проецируются без исключения (AC-8)
  - [ ] `test_isolation.py` прогнан явно
  - [ ] `make gate` зелёный, явно прогнан

## Dev Notes

- Читать `apps/operations/statuses/models/employee_status.py` (поля `Source`/`source_ref`/`period`/`assert_user_editable`) и `apps/operations/statuses/services/status_service.py::create_status`/`cancel_status` ПЕРЕД имплементацией — новый код должен явно НЕ дублировать их валидацию, но использовать те же имена полей буквально.
- `EmployeeStatus.objects.get_or_create(source_ref=..., defaults={...})` — простейший идемпотентный паттерн; если требуется атомарность при параллельных вызовах — не тема этой стори (единственный вызывающий на сегодня — тесты и, в будущем, 14.11's эндпоинт с блокировкой плана, не эта стори).
- `Clock` (ARCH-004, `apps.core.clock.Clock`) НЕ участвует — все даты вычисляются из `shift.starts_at`/`ends_at`, не из «текущего момента».

### References

- [Source: docs/PersonnelStatus/VAPS_7.8.2.md, BR-017 (строки 1236-1243, буквальный текст проекции), donor API list (строка 1489, `POST .../approve`)] — базовый контракт проекции.
- [Source: _bmad-output/planning-artifacts/epics.md:1406] — буква стори, сиблинг-стори 14.7-14.11.
- [Source: Backend/VAPS/apps/operations/statuses/models/employee_status.py] — `Source.OM_AUTO`, `source_ref`, `assert_user_editable()` — все уже существуют, эта стори их ЗАПОЛНЯЕТ.
- [Source: Backend/VAPS/apps/operations/statuses/services/status_service.py::create_status] — почему НЕ переиспользуется (форсирует `source=USER`, гоняет проверки, которых BR-017 не требует).
- [Source: Backend/VAPS/apps/operations/statuses/management/commands/seed_statuses.py] — `DUTY`/`REST_AFTER_DUTY` `StatusType` уже засеяны.
- [Source: Backend/VAPS/apps/operations/tests/test_isolation.py] — подтверждено: нет гварда против `duties→statuses`.
- [Source: Backend/VAPS/apps/operations/duties/models.py] — `DutyPlan`/`DutyShift` (14.5, done), на которых строится эта стори.

## Dev Agent Record

### Context Reference

- Отдельный research-агент при create-story: подтверждено — `source=OM_AUTO`/`source_ref` уже спроектированы в Epic 3 именно под эту стори; `DUTY`/`REST_AFTER_DUTY` `StatusType` уже засеяны; `create_status()` форсирует `source=USER` и НЕ подходит как writer-путь для проекции; кросс-сабдоменный импорт `duties→statuses` архитектурно чист (не требует нового isolation-исключения, тот же паттерн, что `duties→facilities`); `approve`-эндпоинт/permission/RBAC/audit явно зарезервированы за 14.11 в epics.md.

### Completion Notes

_(заполняется dev-story)_

### File List

_(заполняется dev-story)_

## Change Log

| Дата | Изменение |
|---|---|
| 2026-07-31 | Story создана (create-story). Шестая стори Epic 14, строится на `DutyPlan`/`DutyShift` (14.5, done) и на уже существующей статусной инфраструктуре (`Source.OM_AUTO`/`source_ref`, спроектированной под эту стори ещё в Epic 3). Новый writer-путь (не переиспользует `create_status()`, форсирующий `source=USER` и лишние employee/conflict-проверки, которых BR-017 не требует). `approve_duty_plan()` включает чистый доменный переход статуса БЕЗ HTTP/permission/audit — они зарезервированы за 14.11. |
