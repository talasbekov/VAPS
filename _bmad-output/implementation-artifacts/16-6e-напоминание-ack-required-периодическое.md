---
baseline_commit: a50abe0
---

# Story 16.6e: Напоминание об ознакомлении (FR-27, часть 4/4)

Status: ready-for-dev

## Story

As a **сотрудник, назначенный на пост, ещё не подтвердивший ознакомление**,
I want **получать напоминание, пока мероприятие готовится**,
so that **я не забуду подтвердить до начала (FR-27, `docs/registries/ws-message-types.yaml::ACK_REQUIRED`)**.

## Scope Decision (найдено при create-story)

- **Часть 4/4 расщепления Story 16.6, последняя.** 16.6a-c (done) закрыли уведомление-об-утверждении, отметку, эскалацию старшему. Эта стори — `ACK_REQUIRED` (напоминание САМОМУ сотруднику), намеренно вынесенное из 16.6c при её проектировании из-за архитектурного расхождения (см. ниже).
- **КРИТИЧЕСКОЕ архитектурное решение: `ACK_REQUIRED`'s заявленная периодичность в `ws-message-types.yaml` («repeat: every 2h until ack during event prep») ЧЕСТНО НЕ РЕАЛИЗУЕМА буквально — сужается до «раз в день, пока не подтверждено», явное, задокументированное отклонение от буквального текста спеки.** `notify()`'s идемпотентность — `(recipient, kind, business_date)`, «один раз в день» — фундаментальный, никем не переоткрываемый контракт (Story 5.7a). «Каждые 2 часа» потребовало бы либо (a) второго notification-механизма мимо `notify()` (не установлено нигде в проекте), либо (b) многократных вызовов `notify()` с РАЗНЫМИ `business_date` в течение одного календарного дня (бессмысленно — `business_date` семантически «за какой день», не «какой конкретный вызов»). Сужение до «раз в день» — тот же класс решения, что 15.10's `brokerage.manage`-подмена «эскалации по вертикали» (задокументированное расхождение со спекой, не тихая недоработка).
- **Ключевое архитектурное отличие от 16.6c (эскалация): БЕЗ постоянного watermark-поля.** Эскалация (`ack_escalated_at`) — разовый исторический факт, никогда не повторяется. Напоминание — ПОВТОРЯЕТСЯ каждый день, пока `acknowledged_at IS NULL`; постоянное поле-флаг «уже напомнили» заблокировало бы напоминание НАВСЕГДА после первого дня — прямо противоречит цели «until ack». Достаточно самого `notify()`'s `(recipient, kind, business_date)`-контракта: одна строка `Notification` в день на сотрудника, автоматически ПОВТОРЯЕТСЯ на следующий день (новый `business_date`) БЕЗ какого-либо дополнительного кода — не изобретается watermark там, где `notify()`'s штатный контракт УЖЕ даёт нужное поведение.
- **Получатель — САМ назначенный сотрудник (`assignment.employee_id`), НЕ старший.** `ws-message-types.yaml::ACK_REQUIRED`'s `recipients: "assigned employee"` — отличается от `ACK_MISSING_ESCALATION`'s `recipients: "senior"` (16.6c). Резолюция через `CoreEmployeeSelector.user_ids_for()` (16.6a), буквально переиспользуется.
- **Новый порог «во время подготовки к мероприятию» — `VAPS_ACK_REMINDER_DAYS_BEFORE_EVENT`, PROVISIONAL, env-overridable.** Тот же паттерн, что `VAPS_FORCE_REQUEST_ESCALATION_DAYS`/`VAPS_ACK_ESCALATION_HOURS_BEFORE_EVENT` — «во время подготовки» нигде не квантифицировано в architecture.md, открытый вопрос продукту, дефолт — разумное значение (3 дня), исправимо без правки кода. НЕ путается с 16.6c's `VAPS_ACK_ESCALATION_HOURS_BEFORE_EVENT` (эскалация — узкое окно ЧАСОВ перед началом; напоминание — более широкое окно ДНЕЙ, начинается раньше).
- **Один `notify()`-вызов на УНИКАЛЬНОГО получателя** (не на строку `PlacementAssignment`) — тот же set-based dedup приём, что 16.6a's `_notify_assignment_approved()` (сотрудник с 2+ неподтверждёнными назначениями получает ОДНО напоминание в день, не по числу строк).
- **Только `PlacementAssignment` ТЕКУЩЕЙ (`version.is_current=True`) `APPROVED`-версии** — тот же вывод, что 16.6b/16.6c.

## Acceptance Criteria

1. **AC-1 (напоминание при подготовке, ознакомление отсутствует).** `PlacementAssignment` текущей `APPROVED`-версии, `acknowledged_at IS NULL`, `event.starts_at` в пределах `VAPS_ACK_REMINDER_DAYS_BEFORE_EVENT` дней от `Clock.now()` (и ещё не наступило) — сотрудник (если есть привязка аккаунта) получает `ACK_REQUIRED`-уведомление.
2. **AC-2 (событие ещё далеко — нет напоминания).** `event.starts_at` дальше порога — уведомление не отправляется.
3. **AC-3 (уже подтверждено — нет напоминания).** `acknowledged_at IS NOT NULL` — строка исключается из выборки.
4. **AC-4 (нет привязки аккаунта — тихий пропуск).** У сотрудника нет `UserEmployeeBinding` — `notify()` не вызывается, функция не падает (тот же принцип, что 16.6a/16.6c).
5. **AC-5 (в тот же день — идемпотентно, без нового кода).** Повторный вызов функции В ТОТ ЖЕ день для ТОГО ЖЕ сотрудника — `notify()`'s собственная `(recipient, kind, business_date)`-идемпотентность даёт РОВНО одну видимую строку (не пишется отдельный watermark для этого — ПРОВЕРЯЕТСЯ, что функция НЕ добавляет никакого нового поля-флага, полагается целиком на `notify()`'s контракт).
6. **AC-6 (несколько неподтверждённых назначений одного сотрудника — одно напоминание).** Сотрудник с 2+ неподтверждёнными строками (разные события/посты) — РОВНО одно `ACK_REQUIRED`-уведомление за прогон (set-based дедуп получателей).
7. **AC-7 (независимость от эскалации).** Строка с уже проставленным `ack_escalated_at` (16.6c) — ВСЁ РАВНО получает напоминание, если `acknowledged_at` по-прежнему `None` (эскалация старшему и напоминание сотруднику — независимые, не блокирующие друг друга механизмы).
8. **AC-8 (регресс нулевой, БЕЗ watermark-поля).** `make gate` зелёный; единственная миграция — новый `Notification.Kind.ACK_REQUIRED`; НИ ОДНОГО нового поля на `PlacementAssignment` (в отличие от 16.6c's `ack_escalated_at`).

## Out of Scope

- **Честная реализация «каждые 2 часа»** — не изобретается, задокументированное сужение до «раз в день» (см. Scope Decision).
- **Watermark-поле «уже напомнили»** — намеренно НЕ добавляется (заблокировало бы повтор напоминания).
- **Celery/beat-расписание** — та же территория, что 16.6c, не эта стори.
- **API/HTTP-обёртка (ручной запуск)** — Story 16.8.
- **Прекращение напоминаний после эскалации (16.6c)** — независимые механизмы, не связываются.

## Tasks / Subtasks

- [ ] Task 1 — `apps/notifications/models.py`: `Kind.ACK_REQUIRED` + миграция (буквальный образец 16.6a/16.6c)
- [ ] Task 2 — `config/settings.py`: `VAPS_ACK_REMINDER_DAYS_BEFORE_EVENT` (PROVISIONAL, env-overridable)
- [ ] Task 3 — `apps/operations/events/services.py`: `send_ack_reminders()` — выборка, set-based дедуп получателей (образец 16.6a), `notify()` БЕЗ watermark-поля, аудит
- [ ] Task 4 — Тесты (AC 1-8 по отдельности)
- [ ] Task 5 — Гейт

## Dev Notes

- `apps/operations/events/services.py::_notify_assignment_approved()` (16.6a) — буквальный образец резолюции получателя (`CoreEmployeeSelector.user_ids_for()`) и set-based дедупа «один вызов на уникального получателя».
- `apps/operations/events/services.py::escalate_missing_acknowledgements()` (16.6c) — образец фильтрации по `version__status=APPROVED, version__is_current=True, acknowledged_at__isnull=True, event.starts_at`-окну — НО без `ack_escalated_at`-эквивалента (эта стори намеренно НЕ добавляет watermark).
- `config/settings.py::VAPS_ACK_ESCALATION_HOURS_BEFORE_EVENT` (16.6c) — образец PROVISIONAL-порога; НЕ переиспользуется буквально (разные единицы/окна — часы для эскалации, дни для напоминания).
- `apps/notifications/models.py::Notification.Kind`/`chk_notification_kind` — добавление `ACK_REQUIRED`, миграция буквально образец `0008`/`0009`.
- `docs/registries/audit-events.yaml` — новая batch-аудит запись (образец `PLACEMENT_ACKNOWLEDGEMENT_ESCALATED`, 16.6c).

### References

- [Source: _bmad-output/planning-artifacts/epics.md:1436] — Story 16.6 текст.
- [Source: docs/registries/ws-message-types.yaml:151-157] — `ACK_REQUIRED`: `recipients: "assigned employee"`, `repeat: "every 2h until ack during event prep"`.
- [Source: _bmad-output/implementation-artifacts/16-6c-эскалация-неподтверждённого-ознакомления.md] — Scope Decision про несовместимость периодичности с `notify()`'s контрактом (найдено при проектировании 16.6c, разрешается здесь сужением).
- [Source: Backend/VAPS/apps/operations/events/services.py] — `_notify_assignment_approved()` (16.6a), `escalate_missing_acknowledgements()` (16.6c), буквальные образцы.

## Dev Agent Record

### Agent Model Used

### Debug Log References

### Completion Notes List

### File List

## Change Log

| Дата | Изменение |
|---|---|
| 2026-08-01 | Story создана (create-story). Часть 4/4 расщепления Story 16.6, последняя. Разрешает архитектурное расхождение, найденное при 16.6c: «каждые 2 часа» из ws-message-types.yaml сужено до «раз в день, пока не подтверждено» — честно достижимо через `notify()`'s штатный `(recipient, kind, business_date)`-контракт БЕЗ нового watermark-поля (в отличие от 16.6c's `ack_escalated_at`, разового факта эскалации). Получатель — сам сотрудник, не старший. |
