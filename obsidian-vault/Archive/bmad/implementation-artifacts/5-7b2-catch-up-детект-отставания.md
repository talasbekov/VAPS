---
baseline_commit: 6b72460 (HEAD на ветке e3-catchup-clock-concurrency) + НЕзакоммиченные code-review-фиксы 5.7a (notify() → вариант B синхронный, `chk_notification_kind` CheckConstraint, recipient.strip()+blank-guard). E1–E4 done; 5.1–5.7a done; epic-5 in-progress.
context:
  - _bmad-output/planning-artifacts/epics.md
  - _bmad-output/planning-artifacts/architecture.md
  - _bmad-output/implementation-artifacts/5-7a-notification-модель-notify.md
  - _bmad-output/implementation-artifacts/5-7b1-recipient-config-получатель-уведомлений.md
  - _bmad-output/implementation-artifacts/5-6a-derive-блокировки.md
  - _bmad-output/implementation-artifacts/deferred-work.md
---

# Story 5.7b2: Catch-up детект отставания — laggards + notify

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

<!-- ПРОИСХОЖДЕНИЕ: вторая из трёх частей разбитой 5.7 «Notifications-backend» (2026-06-30, реш. Bratan,
     3-way сплит): 5.7a (модель+notify — DONE) + 5.7b (catch-up детект отставания — ЭТА) + 5.7c (read-API).
     5.7b2 ЗАВИСИТ от 5.7a (notify) + 5.6a (tomorrow_block/laggards) + 5.7b1 (NotifyRecipientSelector.resolve_many). 5.7c зависит от 5.7a.

     ЦЕНТРАЛЬНЫЙ ФАКТ (ground-truth): management-команда + сервис в `apps/operations/submissions` (НЕ в
     notifications — import-direction: `notifications ← все`, обратной стрелки нет), зеркало
     `apps/operations/statuses/management/commands/materialize_status_effects.py` + `services/catch_up.py`.
     Джоба идёт по due-датам от СВОЕГО watermark (`catchup_plan`/`Clock`), к контрольному часу считает laggards
     через `tomorrow_block` (5.6a), группирует по получателю и зовёт `notify()` идемпотентно «одно на день».
     НЕ Celery (catch-up run-on-availability, «сервер выключен ночью»). Beat-регистрация — E12/12.6, НЕ здесь.

     ⚠️ ТРАПЫ: (1) `tomorrow_block` НЕ читает control_hour — гейт часа добавить самим (образец 5.3b `_is_late`);
     (2) control-hour-gating горизонта: `today` проверять только ПОСЛЕ control_hour, иначе преждевременные laggards
     + watermark не должен перескочить сегодня до контрольного часа; (3) НЕ `import apps.core.models` (ARCH-004 —
     Clock/Watermark/locks через core-шлюзы); (4) per-date atomic ВНЕ внешней txn (autocommit) иначе savepoint;
     (5) СВОЙ advisory-lock-key + СВОЙ watermark-key (НЕ переиспользовать статус-эффектов 0x56415053/"status_effects");
     (6) payload JSON: UUID → str; (7) `notify()` теперь ВАРИАНТ B (синхронный, возвращает Notification|None,
     raise ValueError на blank recipient) — звать ВНУТРИ per-date atomic; (8) «дивизион→ответственный» НЕ смоделирован
     (Q1=B решено) → резолюция через `NotifyRecipientSelector.resolve_many` (5.7b1, per-division + глобальный fallback); джоба сама НЕ резолвит. -->

## Story

As a **ответственный за сдачу оператор**,
I want **регламентную catch-up-джобу (management-команда + сервис), которая к контрольному часу по каждой due-дате находит необходимые управления, НЕ сдавшие срез, и шлёт мне идемпотентное уведомление «одно на день» об отставании — догоняя все пропущенные дни при простое сервера**,
so that **отстающие получают сигнал (FR-13) без ручного мониторинга; доставка к WS готовится в E11 (5.7b пишет запись, 11.2 добавит WS-эмиссию), read-API — 5.7c**.

## Acceptance Criteria

1. **Management-команда + сервис в submissions.** **Given** нужна регламентная проверка, **Then** созданы `apps/operations/submissions/management/commands/<команда>.py` (тонкая обёртка) + `apps/operations/submissions/services/<сервис>.py` (вся логика), зеркало `statuses/.../materialize_status_effects.py` + `services/catch_up.py`. **Никакого Celery-импорта и beat-расписания** (обёртка @shared_task/регистрация — E12/12.6). [Source: epics.md:759,763 «management-команда … НЕ Celery»; catch_up.py-образец]
2. **Catch-up от собственного watermark.** **Given** сервер мог быть выключен ночью, **When** джоба стартует, **Then** план дат = `catchup_plan(watermark=<свой>, today=<горизонт>)` — хронологично, **дата за датой отдельными транзакциями**, watermark сдвигается инкрементально; повторный/конкурентный запуск не дублирует (advisory-lock, занято → тихо выйти). Ключ watermark и ключ advisory-lock — **собственные**, отличные от статус-эффектов. [Source: architecture.md:299 ARCH-DATA-022; catch_up.py:99-166]
3. **Гейт контрольного часа.** **Given** для даты D контрольный час ещё не наступил (`Clock.now()` local ≤ `control_hour`), **Then** D **не** проверяется и watermark **не** двигается на D (иначе преждевременные laggards и потеря дня). Горизонт плана: `today` включается только когда local-время > `control_hour`; иначе — по `today−1`. [Source: epics.md:757 «не сдало к 17:00−N»; 5.3b `_is_late` `day_submission_service.py:40-48`; A2 control_hour]
4. **Детект laggards реюзом 5.6a.** **Then** для проверяемой даты отстающие = `tomorrow_block(D).laggards` (набор `required_division_ids − current_for_many`), **bulk** (NFR-4, без COUNT-в-цикле). Своей логики «кто не сдал» не писать. [Source: tomorrow_block.py:51; epics.md:763 «через tomorrow_block/laggards»]
5. **Резолюция получателя + группировка.** **Then** получатели laggard-дивизионов резолвятся **bulk** через `NotifyRecipientSelector.resolve_many(laggards)` (5.7b1: per-division справочник → глобальный `default_notify_recipient`-fallback); laggards **группируются по получателю** → один `notify(recipient, Kind.SUBMISSION_LAGGING, D, payload={"laggard_division_ids":[str(uuid),…]})` на получателя. Дивизион, для которого `resolve_many` не вернул получателя (нет специфичного И пустой fallback), — **лог-warning + skip** (Q1b: при настроенном дежурном не случается). [Source: 5.7b1 NotifyRecipientSelector; 5.7a notify-контракт; реш. Bratan Q1=B/Q1b]
6. **Идемпотентность «одно на день».** **When** джоба прогоняется дважды за день (или catch-up повторно проходит D), **Then** на (recipient, kind, D) ровно одна запись — обеспечено (а) watermark: D проверяется один раз при переходе watermark через D; (б) `notify()`-`get_or_create` (5.7a). `notify()` зовётся **внутри** per-date `transaction.atomic()` (вариант B) — запись+watermark коммитятся атомарно. [Source: 5.7a Д3/AC5; architecture.md:299 «отдельными транзакциями»]
7. **Clock-behind-watermark → стоп+алерт; halt/skip-семантика.** **Given** `Clock.today_local() < watermark` (перевод часов назад), **Then** джоба останавливается с ERROR-логом, watermark не трогается, команда завершается ненулевым кодом (`CommandError`); занятый lock → stdout + exit 0. [Source: architecture.md:299 «today<watermark → стоп+алерт»; catch_up.py:116-130; materialize_status_effects.py:53-62]
8. **Границы + гейт.** **Then** 5.7b2 НЕ: read-API (5.7c) / WS-эмиссия (11.2) / Celery+beat-регистрация (12.1/12.6) / **модель/справочник получателя (это 5.7b1 — пререквизит)** / RBAC / изменение notifications-app. `make gate` зелёный, `ruff` чист, `makemigrations --check` пуст (**миграций у 5.7b2 НЕТ** — watermark keyed, notify-модель уже есть, справочник получателей в 5.7b1), submissions `test_isolation` зелёный (без запрещённых импортов). [Source: реш. границы; NFR-8]

## Tasks / Subtasks

- [x] **Task 1 — ПРЕРЕКВИЗИТ: резолюция получателя из 5.7b1 (AC: 5)**
  - [x] Убедиться, что 5.7b1 done: `NotifyRecipientSelector.resolve_many(division_ids) -> dict[UUID, str]` доступен (per-division справочник + глобальный fallback). **Своего селектора получателя в 5.7b2 НЕ писать** — использовать 5.7b1. Если 5.7b1 не готов — 5.7b2 заблокирован (см. Dependencies).
- [x] **Task 2 — сервис детекта отставания (AC: 3,4,5,6,7)**
  - [x] `apps/operations/submissions/services/<lagging_check>.py`: чистый сервис `check_lagging_submissions(*, today=None, ...) -> LaggingCheckResult` (dataclass halted/halt_reason/skipped/watermark_before/watermark_after/processed_days/notified_count — зеркало `CatchUpResult` catch_up.py:57-66).
  - [x] Advisory-lock СВОИМ ключом (`LAGGING_LOCK_KEY`, напр. `0x5641474C  # b"VAGL"`, ≠ `0x56415053`) через `apps.core.locks.advisory_lock(key, blocking=False)`; занято → `skipped=True`.
  - [x] Watermark СВОИМ ключом (`WATERMARK_KEY = "lagging_submissions"`) через `apps.core.watermark.get_or_bootstrap`/`advance` (НЕ `apps.core.models`). `default_date` бутстрапа = `real_today − 1` (проверять с дня деплоя вперёд, без ретро-backfill истории); `created` → ранний возврат.
  - [x] Гейт часа: `local_now = Clock.now().astimezone(ZoneInfo(settings.VAPS_LOCAL_TIMEZONE))`; `control_hour = SubmissionControlSettingsSelector.control_hour()`; `check_through = real_today if local_now.time() > control_hour else real_today - timedelta(days=1)`.
  - [x] Halt-ветки (порядок как catch_up.py): `real_today < watermark` → `halted, halt_reason="clock_behind_watermark"` + ERROR-лог; `gap > sanity` → `halted`. Если `check_through < watermark` (до контрольного часа, нового нет) → пустой план, no-op, **без** ложного алерта (НЕ звать `catchup_plan` с today<watermark).
  - [x] `plan = catchup_plan(watermark=before, today=check_through)[:MAX_CATCHUP_DAYS]`; per-day: `with transaction.atomic(): laggards_by_recipient = _detect(day); for recipient, div_ids: notify(...); watermark.advance(KEY, to_date=day)`. Сервис зовётся ВНЕ внешней txn (autocommit).
  - [x] `_detect(day)`: `laggards = tomorrow_block(day).laggards`; если пусто → `{}`; иначе `recipients = NotifyRecipientSelector.resolve_many(laggards)` (5.7b1, bulk), группировка `recipient -> [division_id]`, дивизион, отсутствующий в `recipients` (нет специфичного И пустой fallback), → `logger.warning(...)` + skip.
  - [x] `notify()` возвращает `Notification|None` (вариант B); None (эмиссия упала, залогировано) — не срывать прогон (сайд-канал). payload: `str(uuid)` для division-ids.
- [x] **Task 3 — management-команда (AC: 1,7)**
  - [x] `apps/operations/submissions/management/__init__.py`, `management/commands/__init__.py` (пустые — каталога ещё нет в submissions).
  - [x] `management/commands/<check_lagging_submissions>.py`: зеркало `materialize_status_effects.py` — `--today` (YYYY-MM-DD, опц., иначе `Clock.today_local()`); future-guard (`today > Clock.today_local()` → `CommandError`); malformed → `CommandError`; вызов сервиса; `result.skipped` → stdout+exit 0; `result.halted` → `CommandError` (ненулевой exit); успех → `self.style.SUCCESS(...)`. Docstring: «Beat-ready (12.1/12.6 register it); Celery НЕ импортируется».
- [x] **Task 4 — тесты (AC: 2–7)**
  - [x] `apps/operations/submissions/tests/test_<lagging_check>.py` (django_db): (a) laggard есть → notify получателю из `resolve_many`, payload с laggard-ids; (b) идемпотентность — 2 прогона за день → 1 запись; (c) все сдали → 0 уведомлений; (d) гейт часа: до `control_hour` — D не проверяется, watermark не двинулся; после — проверяется; (e) catch-up простоя: watermark на N дней назад → все дни хронологично, watermark = последний; (f) `today < watermark` → halt + ERROR, watermark не тронут; (g) занятый lock (второй вход) → skipped, без дублей; (h) дивизион с per-division-записью → его получателю; дивизион без записи → глобальному fallback; дивизион без записи И пустой fallback → warning+skip, без исключения; (i) группировка — один получатель за 2 laggard-дивизиона → одно уведомление с обоими id.
  - [x] `call_command` тесты команды (зеркало test_catch_up.py:244-292): норм-прогон advance watermark; halt → `CommandError`; malformed/future `--today` → `CommandError`; StringIO stdout.
  - [x] Регрессия: `make gate` зелёный; `makemigrations --check` пуст; ruff чист (`ruff format` по-файлово); `apps/operations/submissions/tests/test_isolation` — новый код без `import apps.core.models`.

## Dev Notes

### Цель (одним предложением)
Регламентная catch-up-джоба (management-команда + чистый сервис в `submissions`), которая от собственного watermark, к контрольному часу, по каждой due-дате берёт `tomorrow_block(D).laggards`, резолвит получателей и шлёт идемпотентный `notify()` «одно на день» — переживая простой сервера (run-on-availability, НЕ Celery).

### Авторитет спеки (что строим и откуда)
- **epics.md:751-763** Story 5.7 + декомпозиция-нота 5.7b: management-команда + сервис, catchup_plan/Watermark, к контрольному часу, tomorrow_block/laggards, notify() ответственным, идемпотентно одно-на-день, НЕ Celery. **Гвоздь (epics.md:759):** лечь на catch-up-паттерн проекта, образец `materialize_status_effects`.
- **FR-13** (epics.md:44,131): уведомления об отставании (backend-часть; отображение — E10, WS — E11).
- **FR-41/NFR-5** (epics.md:85,93): регламентные задачи — идемпотентность + catch-up от watermark, advisory lock, Clock, business_date-параметр, tzdata UTC+5.

### 🔑 Решения по реализации (ДЕФОЛТЫ — подтвердить; вопросы в конце)
- **Д1 — РАЗМЕЩЕНИЕ: `apps/operations/submissions`, НЕ `apps/notifications`.** Import-direction (architecture.md:590 `notifications ← все`): notifications — leaf-sink, обратной стрелки `notifications → operations` нет. Джоба читает submissions-домен (tomorrow_block, control_settings — same-app), core через селекторы/Clock/шлюзы (operations→core легально, architecture.md:586), пишет через единственную разрешённую стрелку `notify()`. Класть в notifications = завести `notifications → operations` (AST-цикл, запрещён).
- **Д2 — ОТДЕЛЬНАЯ параллельная catch-up-джоба (Q2 реш. Bratan)**, НЕ регистрация materializer’а в `EFFECT_MATERIALIZERS` статус-движка. Своя семантика (контрольный час), свой watermark-key (`"lagging_submissions"`), свой advisory-lock-key. Причина: разные домены/тайминг; регистрация эмиттера уведомлений в статус-движок = связность и неверный тайминг. (Нота: docstring `catch_up.py` упоминал «5.7 notifications» как будущего registrant — ДО-декомпозиционное допущение; переопределено на «образец, не registrant».)
- **Д3 — ПОЛУЧАТЕЛЬ = `NotifyRecipientSelector.resolve_many` (Q1=B, реш. Bratan 2026-07-01).** Маппинг «дивизион→ответственный» в системе не был смоделирован (Q2 из 5.7a; подтверждено сканом: `core.Division` без head/manager; `Notification.recipient` — плоская строка; RBAC `scope_division_id` — subtree, не 1:1). Bratan выбрал Option B (конфигурируемый получатель) → выделено в **пререквизит-стори 5.7b1** (справочник `DivisionNotifyRecipient` per-division + глобальный `default_notify_recipient`-fallback + `resolve_many`). 5.7b2 **потребитель** `NotifyRecipientSelector.resolve_many(laggards)` — своего селектора получателя НЕ пишет. `submitted_by` последней сдачи (Option A) — ОТВЕРГНУТ (не стабильный владелец).
- **Д3b — дивизион без получателя из `resolve_many` → warning+skip (Q1b=глобальный fallback).** При настроенном `default_notify_recipient` этого не случается (fallback резолвит всех). Skip — только если И нет per-division-записи, И пустой fallback; логировать (видимо в 13.6/логах), НЕ падать.
- **Д4 — ГЕЙТ ЧАСА самим, N=0 (Q4 реш. Bratan).** `tomorrow_block` НЕ читает `control_hour` (5.6a про факт сдачи, не время — `tomorrow_block.py:19-22`). Добавить `local_now.time() > control_hour` (образец 5.3b `_is_late`). `control_hour` — `TimeField` в local TZ (Asia/Qyzylorda, config, НЕ wall-clock). **N=0** — гейт = сам `control_hour`; отдельного lead-time-поля НЕ вводим («−N» в epics иллюстративно).
- **Д5 — ГОРИЗОНТ = `real_today` только после контрольного часа, иначе `real_today−1`.** Так `today` проверяется ровно один раз (после часа), watermark не перескакивает сегодня преждевременно. Halt «часы назад» сравнивать с `real_today`, НЕ с `check_through` (иначе ложный алерт до часа). До часа при watermark=вчера: `check_through=вчера < ... ` → пустой план, no-op (НЕ звать `catchup_plan(today<watermark)` — он логирует error).
- **Д6 — БУТСТРАП watermark = `real_today − 1`, `created` → ранний возврат** (без ретро-backfill всей истории laggards; проверяем с дня деплоя вперёд). Зеркало «fresh deploy без backfill» (catch_up.py:107-114), но `default_date` = вчера (а не сегодня), чтобы первый реальный день проверился.
- **Д7 — notify() ВНУТРИ per-date atomic.** Вариант B (5.7a синхронный) → `Notification`-строка и `watermark.advance` коммитятся атомарно на дату (усиливает «одно на день»). Расхождение с AR-7 «notify (on_commit)» задокументировать (см. ниже §Reconcile on_commit).
- **Д8 — БЕЗ Celery/beat.** Framework-agnostic сервис + beat-ready команда + call_command-тесты. Регистрация periodic-задачи и smoke брокера — Story 12.6/E12 (epics.md:1307-1313). Напоминания FR-41 (7д/3д) — DEFERRED (epics.md:150).

### Что УЖЕ есть — переиспользовать / НЕ дублировать (точные сигнатуры)
- **Laggards:** `apps/operations/submissions/tomorrow_block.py:51` `tomorrow_block(business_date: date) -> TomorrowBlock(blocked, laggards:list[UUID], overridden)`. Реюз `.laggards`. Внутри — bulk `current_for_many` (NFR-4).
- **Контрольный час/required:** `apps/operations/submissions/selectors.py:104` `SubmissionControlSettingsSelector.control_hour() -> time` / `.required_division_ids() -> list[UUID]`. Модель `models/control_settings.py:9` (`control_hour = TimeField(default=time(17,0))`, `required_division_ids = ArrayField(UUIDField)`).
- **«Кто сдал» bulk:** `selectors.py:24` `DailySubmissionSelector.current_for_many(division_ids, business_date) -> {division_id: DailySubmission}`; отсутствие = laggard (внутри `tomorrow_block`).
- **Резолюция получателя (5.7b1, ПРЕРЕКВИЗИТ):** `NotifyRecipientSelector.resolve_many(division_ids) -> dict[UUID, str]` (per-division справочник `DivisionNotifyRecipient` → глобальный `default_notify_recipient`-fallback; bulk). 5.7b2 только вызывает — НЕ строит.
- **Гейт часа (образец):** `services/day_submission_service.py:40-48` `_is_late` — `Clock.now().astimezone(ZoneInfo(settings.VAPS_LOCAL_TIMEZONE)).time() > control_hour`.
- **Catch-up ядро (образец):** `apps/operations/statuses/services/catch_up.py` — `CatchUpResult`-dataclass (57-66), control-flow lock→bootstrap→halt→sanity→plan→per-day-atomic (92-166). Команда `statuses/management/commands/materialize_status_effects.py` (skeleton). Тесты `tests/test_catch_up.py:244-292` (call_command).
- **Clock:** `apps/core/clock.py` — `Clock.now()`/`Clock.today_local()`, `catchup_plan(*, watermark, today) -> list[date]` (73). `override()` для тестов (наивный datetime → TypeError).
- **Watermark-шлюз:** `apps/core/watermark.py` — `get_or_bootstrap(key, *, default_date) -> (date, created)` / `advance(key, *, to_date)`. Модель `core.Watermark` (keyed, `key` unique) — **миграций НЕ надо**, таблица generic.
- **Advisory lock:** `apps/core/locks.py:22` `advisory_lock(key, *, blocking=True)` — SESSION-level `pg_advisory_lock`/`pg_try_advisory_lock`. Статус-эффекты держат `0x56415053`; **взять СВОЙ** ключ.
- **notify (5.7a):** `apps/notifications/services.py:28` `notify(recipient, kind, business_date, payload=None) -> Notification|None` — синхронный (вариант B), `get_or_create` идемпотентно, `recipient.strip()`+blank-guard (`ValueError`), None при инфра-сбое (залогировано). `Kind.SUBMISSION_LAGGING` (с `chk_notification_kind` DB-гардом).

### Архитектурные правила, которые 5.7b ОБЯЗАНА соблюсти
- **ARCH-DATA-022** (architecture.md:299,750): catch-up = чистая функция от watermark; хронологично, дата за датой, отдельными транзакциями; pg_advisory_lock; today<watermark → стоп+алерт; идемпотентность.
- **ARCH-003** (architecture.md:745): cross-context — плоский UUID, без FK (division_ids, recipient, payload — плоские).
- **ARCH-004** (architecture.md:746,586): селекторы — единственный канал cross-context; **НЕ `import apps.core.models`** из operations. Clock/Watermark/locks — через `apps.core.clock`/`apps.core.watermark`/`apps.core.locks` (публичные шлюзы, не models). submissions `test_isolation` это проверит.
- **NFR-4** (epics.md:92; architecture.md:451,326): bulk-селекторы, **запрет COUNT/запросов-в-цикле**. Резолюция получателей — bulk `NotifyRecipientSelector.resolve_many` (5.7b1), НЕ per-division-резолюция в цикле.
- **NFR-5/Clock** (architecture.md:300): чтение wall-clock ТОЛЬКО через `Clock`; `business_date` — явный параметр; НЕ `timezone.now()`/NOW()-default в доменной логике.
- **Admin/audit:** джоба — не мутирующая вьюха; аудит-запись `NOTIFICATION_SENT` НЕ требуется гвардом (audit-coverage целит вьюхи; владелец аудита сдач — 5.9). notify-идемпотентность-тест закрывает. Не регать ничего в admin.

### Reconcile: on_commit (AR-7) vs вариант B (5.7a факт)
Арх-доки (AR-7 epics.md:109; architecture.md:539/590/621/457) описывают `notify` как `on_commit`. 5.7a реализована СИНХРОННО (вариант B, reш. code-review 2026-07-01). Для 5.7b это **совместимо и предпочтительно**: ARCH-DATA-022 требует per-date отдельные транзакции — синхронный `notify()` внутри per-date `atomic` коммитит запись+watermark атомарно. Действие: (а) звать `notify()` синхронно внутри per-date atomic; (б) в Dev-заметках/PR отметить расхождение с «(on_commit)»-лейблом, чтобы ревью не флагнуло; (в) арх-текст (539/590/621) со временем аннотировать «вариант B» — вне скоупа 5.7b.

### Поток (псевдокод)
```python
# apps/operations/submissions/services/lagging_check.py
LAGGING_LOCK_KEY = 0x5641474C   # b"VAGL" — ≠ status-effects 0x56415053
WATERMARK_KEY = "lagging_submissions"
MAX_CATCHUP_DAYS = 31
SANITY_DAYS = 366

def check_lagging_submissions(*, today=None):
    real_today = today or Clock.today_local()          # type-guarded date
    with advisory_lock(LAGGING_LOCK_KEY, blocking=False) as ok:
        if not ok:
            return LaggingCheckResult(skipped=True)
        before, created = watermark.get_or_bootstrap(WATERMARK_KEY, default_date=real_today - timedelta(days=1))
        if created:
            return LaggingCheckResult(watermark_before=None, watermark_after=before)
        if real_today < before:                        # часы назад
            logger.error("clock behind watermark: lagging-check halted", extra={...})
            return LaggingCheckResult(halted=True, halt_reason="clock_behind_watermark", watermark_before=before)
        if (real_today - before).days > SANITY_DAYS:
            return LaggingCheckResult(halted=True, halt_reason="gap_exceeds_sanity", watermark_before=before)
        control_hour = SubmissionControlSettingsSelector.control_hour()
        local_now = Clock.now().astimezone(ZoneInfo(settings.VAPS_LOCAL_TIMEZONE))
        check_through = real_today if local_now.time() > control_hour else real_today - timedelta(days=1)
        if check_through < before:                     # до контрольного часа, нового нет
            return LaggingCheckResult(watermark_before=before, watermark_after=before)  # no-op, без алерта
        plan = catchup_plan(watermark=before, today=check_through)[:MAX_CATCHUP_DAYS]
        processed, notified = [], 0
        for day in plan:
            with transaction.atomic():                 # ВНЕ внешней txn (autocommit) → реальный per-day commit
                notified += _emit_lagging(day)
                watermark.advance(WATERMARK_KEY, to_date=day)
            processed.append(day)
        return LaggingCheckResult(watermark_before=before, watermark_after=(processed[-1] if processed else before),
                                  processed_days=processed, notified_count=notified)

def _emit_lagging(day) -> int:
    laggards = tomorrow_block(day).laggards            # 5.6a реюз (bulk)
    if not laggards:
        return 0
    recipients = NotifyRecipientSelector.resolve_many(laggards)   # 5.7b1 bulk (NFR-4): per-division → fallback
    by_recipient = defaultdict(list)
    for div_id in laggards:
        recipient = recipients.get(div_id)
        if not recipient:                                # нет per-division И пустой fallback (Q1b)
            logger.warning("lagging division has no configured recipient", extra={"division_id": str(div_id), "business_date": str(day)})
            continue
        by_recipient[recipient].append(div_id)
    for recipient, div_ids in by_recipient.items():
        notify(recipient, Notification.Kind.SUBMISSION_LAGGING, day,
               payload={"laggard_division_ids": [str(x) for x in div_ids]})
    return len(by_recipient)
```

### Подводные камни для dev-агента
- `tomorrow_block` НЕ фильтрует по часу — гейт часа отдельно (Д4/Д5). НЕ проверять сегодня до `control_hour`.
- Halt «часы назад» — по `real_today`, не `check_through`. `catchup_plan(today<watermark)` логирует error → НЕ звать его при `check_through < before` (вернуть no-op).
- per-date `atomic` — сервис ВНЕ внешней транзакции (autocommit), иначе atomic = savepoint и внешний откат сотрёт прогресс (catch_up.py:85-91).
- Свой lock-key И watermark-key (НЕ `0x56415053`/`"status_effects"`).
- `resolve_many` (5.7b1) bulk — НЕ per-division-резолюция в цикле (NFR-4/анти-N+1).
- payload — UUID → `str` (JSON). `notify()` может вернуть None (инфра-сбой залогирован) — не срывать прогон.
- НЕ `import apps.core.models` (Clock/Watermark/locks через шлюзы; submissions test_isolation).
- НЕ Celery, НЕ beat-регистрация, НЕ read-API, НЕ трогать notifications-app, НЕ новая миграция.

### Previous-story интеллидженс (5.7a DONE + review, 5.6a DONE)
- **5.7a (code-review 2026-07-01):** notify() → **вариант B** (синхронный, `Notification|None`, `recipient.strip()`+blank-guard `ValueError`); `Kind.SUBMISSION_LAGGING` теперь с `chk_notification_kind` DB-CheckConstraint; payload JSON-сериализуем (UUID→str). Deferred в `deferred-work.md`: реальный race-тест notify, `read_at`-индекс (5.7c), `test_isolation`-скан notifications-app. 5.7b — потребитель notify, эти деферы его не блокируют.
- **5.7a Q2 (резолюция получателя):** прямо отложен в 5.7b → это Q1 здесь. Скан подтвердил: маппинга нет.
- **5.6a (tomorrow_block):** required=required (пустой own-ростер НЕ освобождает); laggards str-sorted; `control_hour` не читается (docstring 19-22). Defer 5.6a: `business_date=None`→тихий blocked (typed-kwarg контракт; 5.7b передаёт валидный `date` из плана — не касается).
- **catch_up.py (3.12/E3):** advisory-lock SESSION-level (не xact — переживает per-day commit); bootstrap-created → без backfill; today<watermark отдельная halt-ветка (не пустой план); MAX/ SANITY-кэпы; call_command-тесты через StringIO.

### Технические версии / окружение
- Django 5.1 ORM, `Clock`, `catchup_plan`, `Watermark`-шлюз, `advisory_lock`, `BaseCommand`, `SubmissionControlSettingsSelector`, `tomorrow_block`, `notify`. **Новых зависимостей НЕТ** (НЕ Celery). **Миграций НЕТ** (watermark keyed; notify-модель есть). `make gate` (Postgres :5433); `ruff` by-file; tzdata UTC+5 канарейка в gate.

### Project Structure Notes
- **CREATE:** `submissions/services/<lagging_check>.py` (сервис) · `submissions/management/__init__.py` + `management/commands/__init__.py` (каталога в submissions ещё НЕТ) + `management/commands/<check_lagging_submissions>.py` (команда) · `submissions/tests/test_<lagging_check>.py`. **MODIFY:** нет (резолюция получателя — селектор из 5.7b1; своего кода в selectors/models 5.7b2 не добавляет). Содержательных: сервис + команда (2) + тесты. **Файлов ≤5** (без __init__-boilerplate). **Миграций НЕТ.**
- **НЕ трогать:** `apps/notifications/*` (только потребляем `notify`), `core`, `statuses/catch_up` (образец, не менять), RBAC, audit.
- Имена (предложение): команда/сервис `check_lagging_submissions`, dataclass `LaggingCheckResult`. Dev может согласовать иначе — держать «catch-up/lagging»-семантику.

### References
- [Source: epics.md:751-765 (Story 5.7 + декомпозиция-нота 5.7b)] — management-команда+сервис, catchup_plan/Watermark, control_hour, tomorrow_block/laggards, notify одно-на-день, НЕ Celery, образец materialize_status_effects.
- [Source: epics.md:44,131 (FR-13)] · [epics.md:85,93 (FR-41/NFR-5)] · [epics.md:92 (NFR-4)] · [epics.md:1307-1313 (Story 12.6 beat-регистрация)] · [epics.md:150 (FR-41 напоминания DEFERRED)].
- [Source: architecture.md:299,301,750 (ARCH-DATA-022) · :745 (ARCH-003) · :746,586,590 (ARCH-004 import-matrix `notifications ← все`) · :300 (Clock) · :451,326 (bulk-селекторы) · :109/539/590/621/457 (AR-7 notify on_commit — reconcile B)].
- [Source: Backend/VAPS/apps/operations/statuses/services/catch_up.py + management/commands/materialize_status_effects.py + tests/test_catch_up.py] — catch-up образец (lock/watermark/per-day/halt/call_command).
- [Source: Backend/VAPS/apps/core/clock.py (catchup_plan/Clock) · core/watermark.py (get_or_bootstrap/advance) · core/locks.py (advisory_lock)].
- [Source: Backend/VAPS/apps/operations/submissions/tomorrow_block.py:51 (laggards) · selectors.py:24,85,104 (current_for_many/previous_for/SubmissionControlSettingsSelector) · models/control_settings.py:9 · services/day_submission_service.py:40-48 (_is_late)].
- [Source: Backend/VAPS/apps/notifications/services.py:28 (notify вариант B) · models.py (Kind.SUBMISSION_LAGGING + chk_notification_kind)] · [5-7a-notification-модель-notify.md (Change Log 2026-07-01, Review Findings)].

### Dependencies
- **Depends on 5.7b1** (Recipient-config — `NotifyRecipientSelector.resolve_many`): 5.7b2 БЛОКИРОВАН, пока 5.7b1 не `done`. Строить 5.7b1 первой.
- **Depends on 5.7a** (`notify` — done) + **5.6a** (`tomorrow_block`/laggards — done).
- **Blocks:** ничего напрямую (5.7c зависит от 5.7a, не от 5.7b2). Beat-регистрация джобы — Story 12.6 (E12).

### Решённые вопросы (Bratan, 2026-07-01 при create-story)
- **Q1 = B** — конфигурируемый получатель → выделен в пререквизит 5.7b1 (`resolve_many`). Option A (`submitted_by`) отвергнут.
- **Q1b = глобальный fallback** — `default_notify_recipient` (в 5.7b1); несопоставленный дивизион при непустом fallback резолвится; при пустом — warning+skip.
- **Q2 = отдельная джоба** (свой watermark/lock/команда), НЕ materializer статус-движка.
- **Q4 = N=0** — гейт = сам `control_hour`; lead-поле N не вводим.

### Открытые вопросы (для Bratan — подтвердить при dev)
- **Q3 — горизонт/бутстрап.** Д5 (today проверяется только после `control_hour`) + Д6 (bootstrap watermark = вчера, без ретро-backfill истории laggards). Подтвердить, что backfill истории НЕ нужен и «сегодня после часа» — верный первый проверяемый день.

## Dev Agent Record

### Agent Model Used

Opus 4.8 (claude-opus-4-8[1m]) — bmad-dev-story, зеркало `materialize_status_effects`.

### Debug Log References

- GREEN: новый `test_lagging_check.py` — 19/19 passed на Postgres :5433 (включая concurrency-lock-тест, запущенный без marker-фильтра).
- `make gate` зелёный: **1628 passed** (было 1610 после 5.7b1; +18 в gate, +1 concurrency deselected), 25 deselected, `ruff check .` чист, `makemigrations --check` → «No changes detected» (у 5.7b2 миграций НЕТ), 30s (< 300s NFR-8).
- `test_isolation` (`apps/operations/tests/test_isolation.py::test_operations_does_not_import_core_models`) зелёный — сервис/команда через шлюзы `apps.core.clock`/`watermark`/`locks`, без `import apps.core.models`.

### Completion Notes List

- **AC-1** management-команда `check_lagging_submissions` (тонкая обёртка) + сервис `check_lagging_submissions` в `services/lagging_check.py` (вся логика); зеркало `materialize_status_effects` + `catch_up`. Celery НЕ импортируется, beat-регистрация → 12.6.
- **AC-2** catch-up от собственного watermark `WATERMARK_KEY="lagging_submissions"` (≠ status-effects), advisory-lock `LAGGING_LOCK_KEY=0x5641474C "VAGL"` (≠ `0x56415053`); план дат `catchup_plan`, дата-за-датой отдельными per-day `transaction.atomic()`; занятый lock → `skipped=True` тихо. Тесты: catch-up простоя, bootstrap, concurrency-skip.
- **AC-3** гейт часа: `check_through = real_today if Clock.now().local.time() > control_hour else real_today−1`; до часа D не проверяется, watermark не двигается на D. `check_through < before` → no-op БЕЗ ложного «behind»-алерта (не зовём `catchup_plan(today<watermark)`). Тесты before/after-hour.
- **AC-4** laggards = `tomorrow_block(D).laggards` (реюз 5.6a, bulk); своей «кто не сдал» логики нет.
- **AC-5** получатели — bulk `NotifyRecipientSelector.resolve_many(laggards)` (5.7b1); группировка `recipient → [division_id]` → один `notify(recipient, SUBMISSION_LAGGING, D, payload={"laggard_division_ids":[str…]})` на получателя; дивизион без получателя (нет специфичного И пустой fallback) → `logger.warning` + skip, не падаем. Тесты: specific-wins, fallback, orphan-warn-skip, группировка.
- **AC-6** идемпотентность «одно на день»: (а) watermark — D проверяется один раз при переходе; (б) `notify()`-`get_or_create` (5.7a). `notify()` — ВНУТРИ per-date atomic (вариант B): запись+watermark атомарны. Тест: 2 прогона/день → 1 запись.
- **AC-7** `real_today < watermark` → `halted, halt_reason="clock_behind_watermark"` + ERROR-лог, watermark нетронут; команда → `CommandError` (ненулевой exit); `gap > SANITY_DAYS` → halt; занятый lock → stdout + exit 0. Halt-сравнение по `real_today`, не `check_through`. Тесты: halt-clock-behind, gap-sanity, command-halt→CommandError.
- **AC-8 границы:** НЕ read-API (5.7c) / НЕ WS (11.2) / НЕ Celery+beat (12.1/12.6) / НЕ модель получателя (5.7b1) / НЕ RBAC / НЕ трогали notifications-app. **Миграций НЕТ.** Батч-кэп `MAX_CATCHUP_DAYS=31` (тест large-gap).
- **Q3 (горизонт/бутстрап)** — реализован по дефолту Д5/Д6: bootstrap watermark = `real_today−1`, без ретро-backfill истории; «сегодня» проверяется только после `control_hour`. **Требует подтверждения Bratan при ревью** (backfill истории НЕ делаем).
- **Reconcile on_commit vs вариант B:** `notify()` зовётся синхронно внутри per-date atomic (совместимо с ARCH-DATA-022 «отдельные транзакции»); расхождение с AR-7-лейблом «(on_commit)» — задокументировано (арх-текст аннотировать «вариант B» вне скоупа 5.7b2).

### Change Log

- 2026-07-01 — 5.7b2 реализация: сервис `lagging_check.check_lagging_submissions` (watermark+lock+гейт-часа+catch-up+notify) + management-команда `check_lagging_submissions` + 19 тестов. Зеркало `materialize_status_effects`. `make gate` зелёный (1628 passed), миграций нет. Status → review.
- 2026-07-01 — code-review (3-layer adversarial, Opus 4.8): все AC SATISFIED. 2 patch применены — ① `notify()→None` теперь бросает `LaggingNotifyError` (watermark держится на N-1, идемпотентный ретрай; убран over-report `notified_count`); ② bootstrap watermark от реального `Clock.today_local()` (анти-poison `--today <прошлое>`). Целевые тесты 65/65, ruff check+format чисто. 2 defer → `deferred-work.md`, 3 dismiss. + 2 регресс-теста на ① (`test_notify_failure_raises_and_holds_watermark_on_n_minus_1`, `test_notify_failure_mid_catchup_keeps_prior_committed_days`). Целевой прогон `test_lagging_check.py` 21/21, ruff чисто. Status → done. ⚠️ патчи не закоммичены (в рабочем дереве).

### File List

**Created:**
- `Backend/VAPS/apps/operations/submissions/services/lagging_check.py`
- `Backend/VAPS/apps/operations/submissions/management/__init__.py`
- `Backend/VAPS/apps/operations/submissions/management/commands/__init__.py`
- `Backend/VAPS/apps/operations/submissions/management/commands/check_lagging_submissions.py`
- `Backend/VAPS/apps/operations/submissions/tests/test_lagging_check.py`

**Modified:**
- (нет — резолюция получателя через селектор 5.7b1; своего кода в selectors/models 5.7b2 не добавляет)

### Review Findings

Code review 2026-07-01 (adversarial 3-layer: Blind Hunter + Edge Case Hunter + Acceptance Auditor, Opus 4.8; scope — всё рабочее дерево b1+b2). Acceptance Auditor: все AC 5.7b1(1–7) и 5.7b2(1–8) реализованы и покрыты тестами, arch-гварды (ARCH-003/004, ARCH-DATA-022, свои watermark/lock-ключи, no-Celery, идемпотентность, graceful-orphan) соблюдены. Ниже — корректностные/эдж-находки.

**Resolution (Bratan, 2026-07-01):** ① Patch · ② Patch · ③ Defer · ④ Dismiss · ⑤ Dismiss · ⑥ Dismiss.

- ✅ **[Patch APPLIED 2026-07-01] ①** `notify()→None` (инфра-фейл) → `_emit_lagging` бросает `LaggingNotifyError`, per-day `atomic()` откатывается, watermark держится на N-1 → идемпотентный ретрай на след. ране; `notified_count` считает только персистнутые строки. [lagging_check.py:188-231] + 2 регресс-теста (одиночный день N-1 hold; multi-day partial-progress).
- ✅ **[Patch APPLIED 2026-07-01] ②** bootstrap watermark `default_date` от реального `Clock.today_local()`, а не от параметра `today` (симметрично future-гарду) → `--today <прошлое>` first-run больше не отравляет watermark назад. [lagging_check.py:115-124]
- **[Defer] ③** ретроактивный `required_division_ids` — reason: корень (неисторизированные настройки) вне скоупа 5.7b2; as-of историзацию делать отдельно. → `deferred-work.md`.
- **[Dismiss] ④⑤⑥** — by-design: расход ежедневный (вкл. выходные); `--today`-граница только у ручного флага и самолечится на реальном ране; override снимает блокировку, а не факт отставания.

**Decision-needed (resolved above):**

- [ ] [Review][Decision] `notify()`-фейл проглатывается, но watermark всё равно advance → уведомление за день теряется молча [lagging_check.py:174-176,188-219] — `notify()` non-fatal (любой инфра-Exception → log+return None, не raise; services.py:52). `_emit_lagging` игнорирует возврат → per-day `atomic()` коммитит watermark даже когда INSERT уведомления упал и был поглощён savepoint'ом get_or_create (не IntegrityError, но восстановимо). Идемпотентность-по-watermark → день D больше не переобрабатывается → нотис за D потерян навсегда. Противоречит собственному докстрингу («failure on day N … leaves the watermark on N-1», :171-173) и контракту зеркала `catch_up` (материализатор ПРОБРАСЫВАЕТ фейл, чтобы watermark держался). Побочно: `notified_count` считает попытки, а не персистнутые строки → SUCCESS-строка команды over-report. Триггер узкий (DB-down/serialization крашат весь ран — данные не теряются; окно = восстановимый-но-не-Integrity фейл), но контракт нарушен. Рекоменд.: в `_emit_lagging` трактовать `notify()→None` как сигнал прервать день (raise) → watermark держится на N-1, ретрай на след. ране (идемпотентно). Решение: hold-and-retry (реком.) vs принять advance-and-lose.
- [ ] [Review][Decision] Catch-up применяет ТЕКУЩИЙ `required_division_ids` ретроактивно к прошлым дням [lagging_check.py:198] — `tomorrow_block(day)` читает текущий singleton настроек для каждого прошлого дня плана (набор не историзирован). Добавили дивизион X в required сегодня при отстающем на N дней watermark → catch-up шлёт `SUBMISSION_LAGGING` за X на все прошлые дни, когда X не был обязан (и не мог сдать по тогдашнему правилу). То же для дивизиона, созданного mid-window. Корень — неисторизированные настройки (пред-существующий дизайн), но НОВО обнажён catch-up'ом по истории. Решение: приемлемо / нужна as-of историзация / floor на «дату добавления»?
- [ ] [Review][Decision] Нет рабочего календаря — выходные/праздники помечаются как laggards [lagging_check.py:166,198] — `catchup_plan` даёт каждую календарную дату, `tomorrow_block` не знает о нерабочих днях; во всём app submissions нет ни одного календарного концепта. Если в домене сдача НЕ обязательна в выходные/праздники → флуд ложных `SUBMISSION_LAGGING`. Вероятно by-design (расход = ежедневный учёт каждый день, вкл. выходные) → тогда dismiss. Решение: подтвердить, что сдача обязательна каждый календарный день; если нет — нужен календарный фильтр.
- [ ] [Review][Decision] Первый запуск с `--today <далёкое-прошлое>` на свежей БД отравляет watermark назад → заклинивает джобу sanity-потолком [lagging_check.py:108-112 + check_lagging_submissions.py:46-52] — гард команды блокирует только БУДУЩЕЕ `--today`. На свежей БД `--today 2025-01-01`: bootstrap ставит watermark=2024-12-31 и возвращается сразу (created-ветка, ничего не обрабатывает); след. реальный ран видит gap≈547 > SANITY_DAYS(366) → halt `gap_exceeds_sanity`, watermark заморожен до ручного DB-edit. Решение: гардить далёкое-прошлое `--today` при отсутствующем watermark / bootstrap'ить от реального wall-clock today, а не от параметра?
- [ ] [Review][Decision] Включение граничного дня при `--today <прошлое>` зависит от текущего time-of-day, а не от истёкшего контроль-часа того дня [lagging_check.py:153-159] — `check_through` берёт `real_today` (параметр) при `local_now.time() > control_hour`, иначе `real_today-1`; `local_now` — всегда реальные стенные часы. `--today 2026-06-20` в 09:00 (до 17:00) → граничный день 06-20 пропущен; тот же вызов в 18:00 → обработан. Реальный beat (`today=None`) корректен; страдает только ручной/тестовый escape-hatch `--today`, самолечится на след. реальном ране. Решение: принять off-by-one флага / гейтить прошлые дни безусловно (real_today < wall-clock today ⇒ включать).
- [ ] [Review][Decision] Активный override «на завтра» (5.6b) не подавляет lagging-уведомление [lagging_check.py:198] — `_emit_lagging` читает `.laggards`, а не `.blocked/overridden`; по дизайну `tomorrow_block` держит laggards видимыми при override. Продуктовый вопрос: должен ли легальный обход блокировки также глушить «нытьё» об отставании, или факт несдачи остаётся и уведомлять корректно (вероятно by-design). Решение: подавлять при активном override / продолжать уведомлять.

**Defer:**

- [x] [Review][Defer] Предусловие «MUST run OUTSIDE a transaction» (autocommit) задокументировано, но не гардируется рантаймом [lagging_check.py:85-90,170-176] — deferred, pre-existing: тот же пробел у зеркала `catch_up` (консистентно); дешёвый `connection.get_autocommit()`-assert падал бы громко при будущем мисюзе, но сейчас не actionable.

**Dismissed (шум/false-positive, 2):**

- `resolve_many` промахивается по specific-получателю на неканоническом (uppercase) строковом UUID [selectors.py:156-171] — внутренний путь 5.7b2 передаёт UUID-объекты (`required_division_ids = ArrayField(UUIDField)` → `laggards` = UUID), `str(uuid)` каноничен с обеих сторон → корректно; докстринг уже покрывает канонические строковые UUID. Задевает лишь гипотетического внешнего строкового вызывающего (5.7c API — backlog) с неканоническим форматом. Спекулятивно.
- Атрибуция миграции 0005 (Acceptance Auditor) — информационная нота: 0005 — deliverable 5.7b1 (AC-3), а не 5.7b2 (у которой миграций нет, AC-8). Границы соблюдены, действий не требуется.
