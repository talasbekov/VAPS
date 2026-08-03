---
baseline_commit: a50abe0
---

# Story 16.6e: Напоминание об ознакомлении (FR-27, часть 4/4)

Status: done

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

- [x] Task 1 — `apps/notifications/models.py`: `Kind.ACK_REQUIRED` + миграция (буквальный образец 16.6a/16.6c)
- [x] Task 2 — `config/settings.py`: `VAPS_ACK_REMINDER_DAYS_BEFORE_EVENT` (PROVISIONAL, env-overridable)
- [x] Task 3 — `apps/operations/events/services.py`: `send_ack_reminders()` — выборка, set-based дедуп получателей (образец 16.6a), `notify()` БЕЗ watermark-поля, аудит
- [x] Task 4 — Тесты (AC 1-8 по отдельности)
- [x] Task 5 — Гейт

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

Claude Sonnet 5

### Debug Log References

### Completion Notes List

Реализовано по AC 1-8. `Notification.Kind.ACK_REQUIRED` + миграция `0010` (буквальный образец `0008`/`0009`). `VAPS_ACK_REMINDER_DAYS_BEFORE_EVENT` (PROVISIONAL, дефолт 3 дня, env-overridable, отдельная единица от `VAPS_ACK_ESCALATION_HOURS_BEFORE_EVENT`). `send_ack_reminders()` — новая функция в `apps/operations/events/services.py`: выборка `PlacementAssignment` (текущая `APPROVED`-версия, `acknowledged_at IS NULL`, событие в окне `(now, now+threshold]`), set-дедуп `employee_id -> user_id` через `CoreEmployeeSelector.user_ids_for()` (16.6a), один `notify()` на уникального получателя, БЕЗ bulk_update/watermark-поля (сознательное архитектурное отличие от 16.6c — см. Scope Decision), аудит `PLACEMENT_ACK_REMINDER_SENT` с batch-sentinel `entity_id`. Новая запись в `docs/registries/audit-events.yaml`. 8 новых тестов (AC 1-7 по отдельности + явный `test_no_watermark_field_added_to_placement_assignment`, проверяющий `PlacementAssignment._meta.get_fields()` НЕ содержит нового поля-флага — прямое утверждение AC-8's «без watermark»), все прошли с первого запуска (одна правка — `ruff format` на длинной строке теста, без изменения поведения). `make gate` поймал ожидаемый schema drift (новый `Kind`-choice) — исправлено `make schema`. `make gate` (после) — 3776 passed (было 3768, +8), 0 regressions, ruff чист, миграции чистые (только `Kind`-констрейнт, НЕТ новых полей на `PlacementAssignment` — AC-8 подтверждён).

### File List

- `Backend/VAPS/apps/notifications/models.py` (modified — `Kind.ACK_REQUIRED` + `chk_notification_kind` расширен)
- `Backend/VAPS/apps/notifications/migrations/0010_remove_notification_chk_notification_kind_and_more.py` (new)
- `Backend/VAPS/config/settings.py` (modified — `VAPS_ACK_REMINDER_DAYS_BEFORE_EVENT`)
- `Backend/VAPS/apps/operations/events/services.py` (modified — `send_ack_reminders()`)
- `Backend/VAPS/apps/operations/events/tests/test_send_ack_reminders.py` (new)
- `Backend/VAPS/schema.yaml` (regenerated — `make schema`, новый `Kind`-choice)
- `docs/registries/audit-events.yaml` (modified — `PLACEMENT_ACK_REMINDER_SENT` запись)

**3-агентное ревью — 0 регрессов, все находки закрыты как соответствующие уже принятым паттернам эпика или неотъемлемое следствие уже принятого сужения, без правок:**
- **Medium (Edge Case Hunter): «недоинформирование при появлении НОВОГО неподтверждённого назначения в ТОТ ЖЕ день после первого прогона» — сотрудник не получает свежего WS-сигнала о втором факте в тот же день (только `notify()`'s `(recipient, kind, business_date)`-идемпотентность).** Реально, но неотъемлемое следствие уже задокументированного сужения «раз в день» — И у `escalate_missing_acknowledgements()` (16.6c), несмотря на свой мердж-приём для `payload`, ТОЖЕ не переотправляет WS-сигнал на мердже (`.save(update_fields=["payload"])` не проходит через `notify()`'s `on_commit`-публикацию) — тот же практический предел уже есть у прецедента. Переносить мердж-приём сюда не имело бы функционального смысла — `payload={}` пуст по дизайну (напоминание — не дайджест), мердж пустого с пустым ничего не меняет. Не исправлено, задокументировано.
- **Medium→принято (Blind Hunter): «дублирующая аудит-запись при повторном прогоне в тот же день (нет per-day watermark)».** Реальное, но НАМЕРЕННОЕ следствие ОТСУТСТВИЯ watermark (сама суть этой стори — Scope Decision явно объясняет, ПОЧЕМУ watermark не добавляется). Тот же класс trade-off, что у `escalate_stale_force_requests()`/`escalate_missing_acknowledgements()`'s собственных `record()`-вызовов — аудит фиксирует «прогон затронул эти строки», не «доставка гарантированно новая». Не исправлено.
- **Medium→OK (Blind Hunter поднял; сверено с 16.6c/15.10): «неподтверждённые получатели без привязки аккаунта попадают в `reminded_assignment_ids` audit payload».** Буквально ТОТ ЖЕ паттерн, что `escalate_missing_acknowledgements()`'s `escalated_assignment_ids`/`escalate_stale_force_requests()`'s `escalated_request_ids` — ВСЕ протухшие строки в payload независимо от резолюции получателя (аудит = факт «строка рассмотрена батчем», отдельно от факта доставки) — не новый паттерн, не регресс.
- **False positive (Blind Hunter): «нет теста на исключение подтверждённых/далёких событий».** Ревьюер получил ТОЛЬКО эксцерпт диффа, не полный тестовый файл — `test_already_acknowledged_is_not_reminded`/`test_event_too_far_away_is_not_reminded` реально существуют и проходят.
- **Low (оба хантера, приняты без правки): асимметрия границы окна `(now, threshold]`, невалидированный отрицательный env-порог, `int()`-парсинг без гарда.** Все — тот же паттерн, что уже принят в 16.6c для `VAPS_ACK_ESCALATION_HOURS_BEFORE_EVENT`, не новый риск.
- Acceptance Auditor: все 8 AC PASS, AC-5's «без кастомного дедупа» подтверждён прямым чтением (нет `select_for_update()`/мердж-логики, только `set()`), AC-7's независимость от эскалации подтверждена (фильтр НЕ содержит `ack_escalated_at`-условия вообще), задокументированное сужение «раз в день» подтверждено В КОДЕ (докстринг + комментарий `Kind.ACK_REQUIRED`), не только в стори-файле.

`make gate` — без изменений после ревью (правок не потребовалось) — **3776 passed**, 0 regressions, ruff чист. Status → done. **Этим завершается расщепление Story 16.6 (16.6a/b/c/e done; 16.6d намеренно пропущена, заблокирована на Story 16.8).**

## Change Log

| Дата | Изменение |
|---|---|
| 2026-08-01 | Story создана (create-story). Часть 4/4 расщепления Story 16.6, последняя. Разрешает архитектурное расхождение, найденное при 16.6c: «каждые 2 часа» из ws-message-types.yaml сужено до «раз в день, пока не подтверждено» — честно достижимо через `notify()`'s штатный `(recipient, kind, business_date)`-контракт БЕЗ нового watermark-поля (в отличие от 16.6c's `ack_escalated_at`, разового факта эскалации). Получатель — сам сотрудник, не старший. |
| 2026-08-01 | Dev-story: `send_ack_reminders()` — без watermark, полагается на `notify()`'s собственный контракт. 8 новых тестов, прошли с первого запуска. `make gate` поймал ожидаемый schema drift — исправлено `make schema`. `make gate` (после) — 3776 passed, 0 regressions, ruff чист. Status → review. |
| 2026-08-01 | 3-агентное ревью: 0 регрессов. Все находки — неотъемлемые следствия уже задокументированного сужения «раз в день» либо совпадают с паттернами 16.6c/15.10, не регресс. `make gate` — без изменений, 3776 passed. Status → done. Завершает расщепление Story 16.6 (16.6d пропущена, заблокирована на 16.8). |
