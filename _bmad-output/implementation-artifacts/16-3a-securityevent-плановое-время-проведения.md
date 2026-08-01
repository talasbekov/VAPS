---
baseline_commit: 8476a25f52074e56c7776d80e8f8b4d33d171926
---

# Story 16.3a: SecurityEvent — плановое время проведения (пререквизит FR-25, часть 1/4)

Status: ready-for-dev

## Story

As a **конфликт-детектор Расстановки**,
I want **знать, КОГДА проводится ОМ**,
so that **проверки двойного назначения/Отдыха/пересечения дежурства (FR-25) могли вообще сравнивать интервалы, а не гадать по времени создания записи**.

## Scope Decision (найдено при create-story — КРИТИЧЕСКИЙ блокирующий разрыв)

- **Найдено при попытке спроектировать Story 16.3 («Полный конфликт-детектор назначений», FR-25).** Все её проверки — интервальные по природе (двойное назначение = пересекающиеся интервалы; Отдых = пересечение с `REST_AFTER_DUTY`-статусом; пересечение дежурства = пересечение с `DutyShift`). **`SecurityEvent` (Epic 15, Story 15.1, уже закрыт) НЕ несёт НИ ОДНОГО поля времени/даты проведения** — только `object`/`title`/`status_code`/`senior_employee_id`/recon-подтверждения. Без интервала «когда» сравнивать нечего — это блокирует не только «перегрузку» (уже известный greenfield-разрыв), но и «буквально любую» интервальную проверку FR-25, включая те, что research считал «buildable now».
- **Решение подтверждено Bratan напрямую** (не автономный PROVISIONAL-выбор, как обычно в этой сессии — здесь разрыв структурный, затрагивает уже закрытый Epic 15, поэтому вынесен на прямое решение): добавить `starts_at`/`ends_at` на `SecurityEvent` — ретрофит на уже отгруженную модель Epic 15, не на `AssignmentVersion`/`PlacementAssignment` (интервал принадлежит МЕРОПРИЯТИЮ, не отдельному назначению — все назначения одного ОМ разделяют одно и то же плановое окно; будущие Story 17.x's «оперативные изменения после утверждения» тоже логичнее вешать на событие, не дублировать интервал на каждое построчное назначение).
- **Nullable-поля, не NOT NULL** — существующие `SecurityEvent`-строки (если такие уже созданы в проде/на других ветках) не имеют времени; ретроактивная миграция БЕЗ дефолта на существующие строки была бы либо угадыванием, либо блокирующей NOT NULL миграцией на потенциально непустой таблице. `clean()`-гард (`starts_at < ends_at`, тот же паттерн, что `DutyShift`/`TemporaryDutyPermission`) — только когда ОБА поля заполнены.
- **Область стори — ТОЛЬКО поля+миграция+гард**, тот же паттерн, что 16.1. Заполнение полей (кто и когда их устанавливает — на этапе `bulletin`? `demand`? отдельный API?) — вне объёма; вероятно всплывёт естественно в 16.3b/16.8 или как отдельная API-стори, когда конкретный workflow-момент станет ясен.

## Acceptance Criteria

1. **AC-1 (поля).** `SecurityEvent.starts_at`/`SecurityEvent.ends_at` — `DateTimeField(null=True, blank=True)`.
2. **AC-2 (гард).** `clean()` — если ОБА поля заполнены и `starts_at >= ends_at` → `ValidationError` (тот же паттерн, что `DutyShift.clean()`/`TemporaryDutyPermission.clean()`; НЕ CheckConstraint на уровне БД, т.к. один из intervals МОЖЕТ быть `NULL` — CHECK с `NULL`-операндом всегда истинен, эквивалент есть только через `full_clean()`).
3. **AC-3 (регресс нулевой).** `make gate` зелёный; существующие `SecurityEvent`-тесты не ломаются (создание без `starts_at`/`ends_at` остаётся валидным).

## Out of Scope

- КТО и КОГДА заполняет эти поля (workflow-момент) — не эта стори, всплывёт в 16.3b/16.8 или отдельно.
- Сами конфликт-проверки (двойное назначение/Отдых/дежурство/перегрузка/несоответствие Посту) — Story 16.3b+.
- Индексация под будущие range-запросы (`GiST`/`btree_gist` для интервального поиска) — добавляется той стори, которая реально пишет запрос (16.3b), не изобретается заранее.

## Tasks / Subtasks

- [ ] Task 1 — `SecurityEvent.starts_at`/`ends_at` + миграция
- [ ] Task 2 — `clean()`-гард (`starts_at < ends_at`, только если оба заполнены)
- [ ] Task 3 — Тесты (создание без полей валидно; корректный интервал валиден; `starts_at >= ends_at` — `ValidationError`)
- [ ] Task 4 — Гейт

## Dev Notes

- `apps/operations/duties/models.py`'s `DutyShift.clean()`... нет, `DutyShift`'s интервал-CheckConstraint (`ck_duty_shift_starts_before_ends`, `models.Q(starts_at__lt=models.F("ends_at"))`) — DB-уровневый, но там ОБА поля NOT NULL (не наш случай — у нас nullable, CheckConstraint с NULL всегда истинен, не защита). Наш гард — только `clean()`, тот же паттерн, что `TemporaryDutyPermission.clean()`.
- `apps/operations/rbac/models.py`'s `TemporaryDutyPermission.clean()` — буквальный образец для nullable-совместимого сравнения (хотя там поля NOT NULL — сравнить оба паттерна, взять правильный для nullable-случая).

### References

- [Source: _bmad-output/planning-artifacts/epics.md:1433] — Story 16.3 текст (источник разрыва).
- [Source: _bmad-output/planning-artifacts/prds/prd-VAPS-2026-06-10/prd.md] — FR-25 (интервальные проверки).
- [Source: Backend/VAPS/apps/operations/events/models.py] — `SecurityEvent`, текущее отсутствие полей времени.
- [Source: Backend/VAPS/apps/operations/duties/models.py] — `DutyShift`'s интервал-CheckConstraint (NOT NULL случай, для сравнения).
- [Source: Backend/VAPS/apps/operations/rbac/models.py] — `TemporaryDutyPermission.clean()` (nullable-совместимый паттерн).

## Dev Agent Record

### Context Reference

- Найдено при попытке спроектировать 16.3: `SecurityEvent` не несёт временных полей, блокируя ЛЮБУЮ интервальную FR-25-проверку. Решение (добавить поля на `SecurityEvent`, не на `PlacementAssignment`) подтверждено Bratan напрямую (структурный разрыв, затрагивающий закрытый Epic 15) — не автономный PROVISIONAL-выбор.

### Completion Notes

_(заполняется dev-story)_

### File List

_(заполняется dev-story)_

## Change Log

| Дата | Изменение |
|---|---|
| 2026-08-01 | Story создана (create-story). Критический блокирующий разрыв, найденный при проектировании 16.3: SecurityEvent не несёт времени проведения, все FR-25's интервальные проверки заблокированы. Решение (поля на SecurityEvent, ретрофит Epic 15) подтверждено Bratan напрямую. |
