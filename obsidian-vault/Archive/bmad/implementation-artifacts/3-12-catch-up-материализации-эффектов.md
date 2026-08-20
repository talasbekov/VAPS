---
baseline_commit: 9294d0a (HEAD на main; E3 1–11 done/review, 3.11 закоммичена. В рабочем дереве — патчи ревью спайка 1.11 прохода 5 (spikes/1.11-donor-export/* + BMAD-артефакты); к стори 3.12 отношения НЕ имеют, в File List не включать.)
---

# Story 3.12: Catch-up материализации эффектов

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a **система VAPS**,
I want **детерминированный, идемпотентный движок catch-up: от watermark `status_effects` строится план дат (чистая функция `catchup_plan`), и каждый день обрабатывается хронологично, в отдельной транзакции, под session-level advisory-локом, с продвижением watermark**,
so that **побочные эффекты переходов статусов (аудит E4, уведомления 5.7, авто-возврат) материализуются ровно один раз после любых простоев сервера, конкурентный/повторный запуск не дублирует и не теряет прогон, а перевод часов назад останавливает обработку с алертом без перезаписи данных (FR-41 ядро, NFR-5, ARCH-DATA-022)**.

<!-- ЯДРО, а не консьюмер. Продукт стори — ДВИЖОК catch-up + точка-расширения (реестр материализаторов), а НЕ конкретные эффекты. Аудит (E4) и уведомления (5.7) ещё не существуют — они ПОДКЛЮЧАЮТСЯ к этому движку позже. Движок реален и тестируем уже сейчас (план/лок/идемпотентность/halt/watermark) через тест-инъекцию фейкового материализатора. -->

## Acceptance Criteria

1. **Given** watermark `status_effects` = D-3 и сегодня = D, **When** запускается движок catch-up, **Then** дни D-2, D-1, D обрабатываются **хронологично** (по возрастанию), **каждый в ОТДЕЛЬНОЙ транзакции** (`transaction.atomic` на день, не на весь прогон), и `last_materialized_date` сдвигается на обработанный день **после** успешной фиксации этого дня (частичный прогон оставляет watermark на последнем успешном дне).
2. **Given** два прогона движка стартуют конкурентно (имитация двойного beat), **When** оба пытаются материализовать те же дни, **Then** **session-level Postgres advisory-лок** (`pg_advisory_lock`/`pg_try_advisory_lock` по стабильному ключу движка) сериализует их: второй прогон либо ждёт, либо немедленно выходит «уже идёт» (no-op) — эффекты **не дублируются**, watermark не откатывается. Лок берётся на ВЕСЬ прогон (взаимное исключение задачи), а не на строку.
3. **Given** watermark `status_effects` = D и сегодня = D, **When** движок запускается повторно (тот же день, уже материализованный), **Then** план пуст (`catchup_plan` отдаёт `[]` для `(D, D]`), прогон — **идемпотентный no-op**: ни одного повторного эффекта, watermark без изменений.
4. **Given** `today < watermark` (часы переведены назад / битый seed), **When** строится план, **Then** обработка **останавливается с алертом** (структурный `logger.error`, как контракт `catchup_plan`), **данные НЕ перезаписываются**, watermark НЕ откатывается, прогон завершается «halted» (через management-команду — ненулевой выход/`CommandError`). Подробная процедура для админа контура — спайк 3.13 (этот стори лишь обеспечивает безопасный стоп).
5. **Given** watermark-строки `status_effects` ещё нет (первый запуск / свежий деплой), **When** движок запускается, **Then** он **бутстрапит** watermark `last_materialized_date = today` и НИЧЕГО ретроактивно не материализует (эффекты считаются «с момента go-live», не задним числом) — без алерта (`catchup_plan(watermark=None)` отдаёт `[]`); следующий прогон стартует с этого дня.
6. **Given** аномально большой разрыв (watermark на годы позади), **When** строится план, **Then** срабатывает **защита от безграничного прогона**: за один запуск обрабатывается не более `MAX_CATCHUP_DAYS` дней (watermark двигается инкрементально, остаток доберётся следующими прогонами — beat идемпотентен), а при разрыве сверх sanity-потолка (`> CATCHUP_SANITY_DAYS`, вероятный баг часов/seed) — **halt + алерт** вместо перемалывания. (Закрывает defer ревью 1.3 «`catchup_plan` неограничен».)
7. **Given** обработка дня D', **When** движок материализует эффекты этого дня, **Then** `business_date` передаётся материализаторам **явным параметром** (НЕ через `Clock.override` — он не распространяется в beat-воркер; ARCH-DATA-022 «business_date — параметр»); каждый зарегистрированный материализатор обязан быть идемпотентным по контракту (`unique(сущность, business_date, …) + upsert`). Сегодня **реестр материализаторов пуст** (seam): движок проходит дни и двигает watermark, не вызывая ни одного эффекта. Аудит (E4), уведомления (5.7), авто-возврат подключатся к этому реестру позже.
8. **Given** движок должен исполняться как beat-задача, **When** этот стори завершён, **Then** он поставляет **framework-agnostic сервис + management-команду** `materialize_status_effects` (запускается и тестируется БЕЗ Celery), а `@shared_task`-обёртка, Celery-app и регистрация в beat-расписании **вынесены в 12.1/12.6** (Celery/брокер ещё не установлены — зависимость `celery` НЕ добавляется). Команда — корректный, идемпотентный, beat-ready вход.
9. **And** анти-gold-plating: НЕ строятся конкретные эффекты (аудит-строки E4, Notification 5.7, авто-возврат секондментов), НЕ ставится Celery/Redis/брокер/compose (12.1), НЕ регистрируется beat-расписание (12.1) и smoke брокера (12.6), НЕ трогаются существующие статус-сервисы/`catchup_plan`/`Watermark`-модель (переиспользуются как есть). Новых моделей и миграций нет (`Watermark` уже есть из 1.3). Реестр материализаторов — пустой seam с задокументированным контрактом, без спекулятивных реализаций.

## Tasks / Subtasks

- [x] **Task 1 — advisory-лок хелпер в core** (AC: 2)
  - [x] `apps/core/locks.py` (NEW): контекст-менеджер `advisory_lock(key: int, *, blocking: bool = True)` поверх Postgres `pg_advisory_lock(key)` / `pg_try_advisory_lock(key)` + `pg_advisory_unlock(key)` через `django.db.connection.cursor()`. **Session-level** (не xact), чтобы лок жил весь прогон, охватывающий НЕСКОЛЬКО транзакций-дней (xact-лок снялся бы на первом commit). MUST: гарантированный `unlock` в `finally`; `blocking=False` → отдавать признак «не захвачено» (для «уже идёт → no-op»). Ключ — стабильный int (напр. константа `STATUS_EFFECTS_LOCK_KEY`, оформить как именованную константу, не magic number).
  - [x] Док-строка: почему session-level, а не `select_for_update` (взаимное исключение ЗАДАЧИ через границы транзакций, не строки) и не xact-лок (снимется между днями).
- [x] **Task 2 — движок catch-up (сервис)** (AC: 1, 3, 4, 5, 6, 7)
  - [x] `apps/operations/statuses/services/catch_up.py` (NEW): функция `materialize_status_effects(*, today: date) -> CatchUpResult` (или dataclass-результат: processed_days, halted, halt_reason, watermark_before/after).
  - [x] Алгоритм: (1) взять session advisory-лок (`blocking=False`); не захвачен → вернуть «skipped: already running» (no-op, AC-2). (2) Прочитать/создать watermark `key="status_effects"` (бутстрап `last_materialized_date=today` при отсутствии — AC-5). (3) **Распознать halt ДО плана**: если `today < wm.last_materialized_date` → «halted» (AC-4), НЕ двигать watermark, НЕ писать. **MUST: не полагаться на пустой `plan` для детекта halt** — `catchup_plan` отдаёт `[]` и для halt (`today<watermark`), и для штатного no-op (`today==watermark`); различить их можно ТОЛЬКО явным сравнением `today < watermark`, иначе перевод часов назад тихо станет no-op вместо алерта. (4) `plan = catchup_plan(watermark=wm.last_materialized_date, today=today)` (переиспользовать `apps.core.clock.catchup_plan`); пустой план при `today==watermark` → штатный идемпотентный no-op (AC-3). (5) применить cap `MAX_CATCHUP_DAYS`; разрыв `> CATCHUP_SANITY_DAYS` → halt+алерт (AC-6). (6) для каждого дня плана (хронологично): `with transaction.atomic():` вызвать `_materialize_day(business_date=day)` → по успеху `wm.last_materialized_date = day; wm.save(update_fields=["last_materialized_date"])` (AC-1). (7) вернуть результат.
  - [x] `_materialize_day(*, business_date: date)`: проходит **реестр материализаторов** `EFFECT_MATERIALIZERS` (сегодня **пустой кортеж/список** — seam) и вызывает каждый `mat(business_date=business_date)`. Контракт материализатора (док-строка): чистый по отношению к повтору (идемпотентность через `unique + upsert`), не бросает HTTP-`DomainError` (фон, не запрос) — на необработанной ошибке откатывается транзакция дня и прогон останавливается на этом дне (watermark остаётся на предыдущем успешном).
  - [x] Константы `MAX_CATCHUP_DAYS`, `CATCHUP_SANITY_DAYS` — именованные, с комментарием-обоснованием; реестр `EFFECT_MATERIALIZERS = ()` с комментарием «E4 (аудит), 5.7 (уведомления), авто-возврат регистрируются здесь».
- [x] **Task 3 — management-команда (beat-ready вход)** (AC: 8)
  - [x] `apps/operations/statuses/management/commands/materialize_status_effects.py` (NEW) по образцу `seed_statuses.py`/`strength_report`: `handle()` зовёт `materialize_status_effects(today=Clock.today_local())` (Clock — единственная точка wall-clock; в реальном beat override не действует, берётся реальная дата — AC-7). Вывод: число обработанных дней, watermark before→after, halt-причина. `--today YYYY-MM-DD` (опц.) для ручного/тестового прогона. Halt (AC-4/6) → `CommandError` (ненулевой выход), чтобы оператор/CI заметили.
  - [x] Док-строка команды: «beat-ready ядро; `@shared_task`-обёртка и регистрация в beat — 12.1/12.6; здесь Celery НЕ импортируется и НЕ добавляется в зависимости».
- [x] **Task 4 — тесты движка** (AC: 1–8)
  - [x] `apps/operations/statuses/tests/test_catch_up.py` (NEW). Тест-инъекция **фейкового материализатора** (через monkeypatch `EFFECT_MATERIALIZERS` или DI-параметр), записывающего вызовы `business_date`, чтобы проверить механику движка без реальных эффектов.
  - [x] Кейсы: (a) разрыв 3 дня → ровно дни D-2,D-1,D в порядке возрастания, по одному вызову материализатора на день, watermark=today после (AC-1); (b) повтор того же дня → 0 вызовов, watermark без изменений (AC-3, идемпотентность); (c) конкурентность — второй прогон при удержанном локе → skipped no-op, без двойных вызовов (AC-2; через два соединения/`pg_try_advisory_lock`); (d) `today < watermark` → halted, 0 вызовов, watermark не откатан, логнут error (AC-4); (e) нет watermark → бутстрап=today, 0 ретро-вызовов (AC-5); (f) разрыв > `MAX_CATCHUP_DAYS` → обработан первый батч, watermark инкрементально сдвинут, остаток на следующий прогон; разрыв > sanity → halted (AC-6); (g) материализатор бросает на дне 2 из 3 → день 1 зафиксирован (watermark=day1), прогон остановлен, день 3 не тронут (AC-1 «отдельные транзакции», атомарность дня); (h) `business_date` приходит параметром, не из Clock (AC-7).
  - [x] Детерминизм времени: `clock.override(date(...))` в тестах сервиса/команды (как в `test_override.py`/статус-сервисах); для конкурентного кейса — реальная вторая сессия БД.
- [x] **Task 5 — гейт и регрессия**
  - [x] `make gate` зелёный (Postgres :5433; advisory-лок требует реальный Postgres — НЕ SQLite). `makemigrations` → «No changes detected» (новых моделей нет). `ruff check` чист (по изменённым файлам).
  - [x] Регрессия нулевая: `catchup_plan`, `Watermark`-модель, статус-сервисы НЕ изменены (переиспользованы). Проверка: `git diff --stat` — только новые файлы движка/команды/локов/тестов.

### Review Findings (code-review 2026-06-26, проход 1)

Адверсариальное ревью (Blind Hunter + Edge Case Hunter + Acceptance Auditor) scoped-диффа `Backend/VAPS/` 3.12 (5 файлов, +560 строк). **Acceptance Auditor: APPROVE — AC 1–9 ВСЕ MET вживую** (per-day atomic + watermark-advance; session-лок не xact; halt по явному сравнению + регресс-тест; cap/sanity границы; business_date параметром; нет Celery/моделей/миграций; 5-й файл watermark-gateway верифицирован как ARCH-004-обязательный). Edge Hunter подтвердил массу границ (no-NameError, session-лок переживает per-day commit, cap/sanity boundary `>`, committed-дни не реэмитятся, update_fields refreshes auto_now, psycopg-коннект совместим). Находки ниже — hardening краёв СВЕРХ AC, не блокеры. **Same-model caveat:** все 3 слоя — Opus 4.8 (как имплементатор).

0 decision-needed · 3 patch · 6 defer · 6 dismiss.

- [x] [Review][Patch] ✅ ПРИМЕНЕНО — Кривой `--today` → сырой `ValueError`-traceback вместо `CommandError` — обернуть `date.fromisoformat` в try → `CommandError("неверный --today, ожидается YYYY-MM-DD")` (файл уже импортирует `CommandError`) [`materialize_status_effects.py`] [blind+edge]
- [x] [Review][Patch] ✅ ПРИМЕНЕНО — **Будущий `--today` отравляет watermark → стойкий halt.** `--today <будущая дата>` (разрыв < sanity) двигает watermark в будущее → каждый реальный прогон затем halt'ит `clock_behind_watermark` пока wall-clock не догонит (месяцы), восстановление = ручная правка БД. Гард в КОМАНДЕ (не в движке — его тесты гоняют произвольные даты): если `today > Clock.today_local()` → `CommandError` [`materialize_status_effects.py`] [edge MED]
- [x] [Review][Patch] ✅ ПРИМЕНЕНО — Док-нота: движок должен исполняться ВНЕ объемлющей транзакции (autocommit) — иначе per-day `transaction.atomic()` вырождается в savepoint и durability/resumability per-day теряется (актуально для Celery-обёртки 12.1; mgmt-команда/Celery-таска по умолчанию без объемлющей txn — ОК) [`catch_up.py` docstring] [blind MED]
- [x] [Review][Defer] `advance()` делает `Watermark.objects.get()` каждый день (до 31 SELECT/прогон) + сырой `DoesNotExist`, если admin удалит watermark-строку посреди прогона (advisory-лок не покрывает чужой delete) [`apps/core/watermark.py`] — deferred: harden до `filter().update()`/обработки delete при появлении admin-редактирования watermark
- [x] [Review][Defer] Исключение материализатора пробрасывается сырым traceback'ом (команда не оборачивает), без отчёта о частичном прогрессе [`catch_up.py` loop] — deferred: реестр пуст; graceful-репорт/retry — забота 12.1-beat-обёртки, когда появятся материализаторы
- [x] [Review][Defer] Не-транзакционный побочный эффект будущего материализатора может задвоиться при ретрае (день откатился после внешнего вызова) — движок гарантирует не-реэмиссию ЗАКОММиченных дней, но материализатор обязан быть идемпотентным сам [`catch_up.py` contract] — deferred: контракт материализатора, энфорсится при подключении E4/5.7
- [x] [Review][Defer] `advisory_lock(blocking=True)` без таймаута ждёт вечно — движок использует `blocking=False`, но публичный API имеет зависающий дефолт [`apps/core/locks.py`] — deferred: добавить lock-timeout/доку при появлении блокирующего вызывателя
- [x] [Review][Defer] Глобальный keyspace advisory-локов: `STATUS_EFFECTS_LOCK_KEY=0x56415053` может коллизить с будущим вызывателем `pg_advisory_lock` того же int [`catch_up.py`] — deferred: реестр ключей-конвенция, когда появятся другие advisory-локи
- [x] [Review][Defer] `test_catch_up_partial_failure...` под `django_db` доказывает savepoint-изоляцию, не cross-process durability (per-day atomic = savepoint в объемлющей тест-txn) [`test_catch_up.py`] — deferred: добавить `transaction=True`-тест для доказательства реального per-day commit
- Dismissed (6): bootstrap «today не материализуется» = **by-design AC-5** (no retroactive backfill, реестр пуст; Auditor: AC-5 MET); unlock-на-той-же-connection — задокументированное допущение, текущее использование синхронно; acquire-вне-try «leak» — safe-by-accident (session-лок снимается при разрыве коннекта; Edge: no NameError); `type(today)` coupling — `Clock.today_local()` верифицированно отдаёт plain `date`; concurrency-тесты вне fast-гейта — проектная конвенция (лок-SQL всё равно гоняется не-concurrency тестами); `--today ""` → None — приемлемо (пусто = брать Clock).

## Dev Notes

### Цель (одним предложением)

3.12 — это **ядро FR-41**: детерминированный движок «catch-up = чистая функция от watermark» (ARCH-DATA-022), который безопасно догоняет пропущенные дни после простоев и предоставляет **точку расширения** для побочных эффектов. Сам по себе движок сегодня эффектов не материализует (их сущности — E4/5.7 — ещё не построены); его ценность — корректная, идемпотентная, конкурент-безопасная МЕХАНИКА, на которую эти консьюмеры сядут, и которая нужна ДО пилота (E12).

### Главное архитектурное решение (ARCH-DATA-022) — derived-first, beat ≠ источник истины

- **Действующий статус ВЫЧИСЛЯЕТСЯ** из интервалов + `business_date` (`derive_state`, story 1.7) — это источник истины. **Celery Beat НЕ источник истины**: он лишь **материализует побочные эффекты** (уведомления, авто-возврат, аудит) идемпотентно. [Source: architecture.md ARCH-DATA-022, строки 104–105, 298–302]
- **Catch-up = чистая функция от watermark**: `план = f(watermark, today)`; хронологически, дата за датой, **отдельными транзакциями**; `unique(сущность, business_date, версия) + upsert` (идемпотентность эффекта); `pg_advisory_lock` от конкурентного Beat; `today < watermark` → стоп + алерт. 3.12 реализует ровно этот паттерн. [Source: architecture.md, строки 298–302]
- **Следствие для тестов**: т.к. derived-state уже даёт правильный статус на любую дату без материализации, движок 3.12 НЕ обязан ничего «досчитывать» для корректности расхода — он материализует только ЭФФЕКТЫ (которых пока нет). Поэтому тестируем механику через фейковый материализатор, а не через изменение расхода.

### Текущее состояние кода (прочитано через recon 2026-06-26) — что переиспользуем, что НЕ трогаем

**EXISTS — переиспользовать как есть:**
- `apps/core/clock.py`:
  - `Clock.now()` (aware UTC, honours override), `Clock.today_local()` (полночь Asia/Qyzylorda, UTC+5 через `settings.VAPS_LOCAL_TIMEZONE`), `override(date|datetime)` — **ContextVar, НЕ распространяется в треды/Celery-воркеры** (by design). В beat реальная задача всегда читает реальную дату через `Clock.today_local()` — НЕ полагаться на override во входе движка.
  - `catchup_plan(*, watermark: date|None, today: date) -> list[date]` (строки ~73–97): **уже** даёт `(watermark, today]` хронологично; `watermark=None → []` (no alert); `today < watermark → logger.error + []` (контракт halt). **НЕ переписывать** — обернуть. Сигнатура keyword-only, plain `date` (НЕ datetime) — приводить через `.date()`/`today_local().date()` при необходимости.
- `apps/core/models.py` `Watermark` (строки ~426–439, миграция 0014): `key` (unique, max_length=100), `last_materialized_date` (DateField, **без дефолта** — бутстрап на консьюмере), `updated_at` (auto_now). Канонический `key="status_effects"`. **Новой миграции НЕ нужно.**
- `apps/core/selectors.py` `CoreEmployeeLockSelector.lock_employee/lock_employees` (строки ~201–223): **row-level** `select_for_update` + `order_by("id")`. Это НЕ то, что нужно движку (он сериализует ЗАДАЧУ, а не строки) — но образец того, как код берёт локи. 3.12 вводит ОТДЕЛЬНЫЙ паттерн — **session-level `pg_advisory_lock`** (взаимное исключение всего прогона через границы транзакций-дней).
- `apps/core/exceptions.py` `DomainError(code, http_status, detail=, message=)` — closed-world коды из `docs/registries/error-codes.yaml`. **Движок — фон, НЕ HTTP-запрос**: DomainError тут неуместен (нет рендера envelope). Ошибки → структурный лог + halt; через команду → `CommandError`. Новых error-кодов НЕ вводим (background-alert = лог, не HTTP-код).
- Статус-сервисы `apps/operations/statuses/services/` (`status_service`, `bulk_status_service`, `secondment_service`, `dismissal`, `strength_report`): паттерны `@transaction.atomic`, `_lock_employee`, `clock.override` в тестах. **Не изменяются** этим стори.

**ABSENT — НЕ предполагать существующим:**
- **Celery / брокер / beat / Redis** — НЕТ (нет `config/celery.py`, нет `CELERY_*` в `config/settings.py`, нет `celery`/`redis`/`django-celery-beat` в `pyproject.toml`, нет worker/beat/redis в `docker-compose.yml`). **Владелец инфраструктуры — Story 12.1** (прод-compose: nginx+uvicorn+worker+beat+postgres+redis), регистрация/smoke beat — **12.6**. → 3.12 поставляет сервис+команду, Celery-обёртку НЕ добавляет. [Source: recon; architecture.md строки 117, 335–336; deploy/spike-1.9/docker-compose.yml:2 «прод-топология … — она в 12.1»]
- **Аудит (E4)** — НЕТ `AuditLog`-модели/сервиса (только `created_by`-провенанс на base-модели). **Уведомления (5.7)** — НЕТ `Notification`/`notify()` (только config-заглушка `SubmissionControlSettings`). **Авто-возврат** как эффект — НЕТ. → реестр материализаторов СЕГОДНЯ пуст; это ожидаемо для «ядра».
- **Сервис материализации эффектов** — НЕТ (есть только derived-вычисление + no-op `amendment_hook.py` seam для E5). 3.12 создаёт сам движок.

### Решения, принятые при создании стори (дефолты; менять только осознанно)

1. **3.12 = ядро + seam, НЕ консьюмеры.** Движок реален и полностью тестируем сейчас; конкретные эффекты (E4/5.7/авто-возврат) подключаются позже к пустому реестру. Обоснование: их сущности не построены; строить их здесь = преждевременно и нарушает декомпозицию.
2. **Celery-обёртка вынесена в 12.1/12.6.** Поставляем framework-agnostic `materialize_status_effects(today=...)` + management-команду. `@shared_task`, Celery-app, beat-расписание, зависимость `celery` — НЕ здесь (12.1 владеет инфраструктурой, 12.6 — регистрацией/smoke). Команда — корректный beat-ready вход, тестируемый без брокера. Это устраняет «celery в pyproject до брокера» и пересечение скоупа с 12.1.
3. **Session-level `pg_advisory_lock`, не xact-лок и не row-лок.** Прогон охватывает НЕСКОЛЬКО транзакций (по дню) — xact-лок снялся бы на первом commit. Нужен лок уровня сессии на весь прогон. Требует реального Postgres (тест-гейт уже на :5433).
4. **Per-day транзакция, watermark двигается после каждого успешного дня.** Частичный сбой на дне N оставляет дни 1..N-1 зафиксированными и watermark на N-1 — следующий прогон добирает с N. Это и есть catch-up-идемпотентность.
5. **Бутстрап watermark = today, без ретро-backfill.** На первом запуске эффекты начинаются «с сейчас», не задним числом (нет смысла материализовать уведомления/аудит за прошлое до go-live). Документировать явно.
6. **Cap `MAX_CATCHUP_DAYS` + sanity-потолок `CATCHUP_SANITY_DAYS`.** Закрывает defer ревью 1.3 («`catchup_plan` неограничен»): батч за прогон + halt при абсурдном разрыве (баг часов/seed), вместо тихого перемалывания тысяч дней.
7. **`business_date` — параметр, не Clock в материализаторе.** Clock.override не доедет до beat-воркера; ARCH-DATA-022 «business_date — параметр». Движок передаёт дату явно.

### Подводные камни для dev-агента

- **НЕ строить эффекты.** Соблазн «раз уж есть движок, добавлю аудит/уведомление». НЕТ: E4/5.7. Реестр пустой, тест — через фейковый материализатор.
- **НЕ тащить Celery.** Не добавлять `celery`/`redis` в `pyproject.toml`, не создавать `config/celery.py`, не писать `@shared_task`. Только сервис + команда. (12.1/12.6.)
- **Session-лок ≠ xact-лок.** `pg_advisory_xact_lock` снимется на первом `commit` между днями → потеряешь взаимное исключение на остаток прогона. Бери `pg_advisory_lock` (session) и гарантируй `pg_advisory_unlock` в `finally`. На пуле соединений следи, что lock/unlock на ОДНОМ соединении.
- **Postgres-only.** Advisory-локи — фича Postgres; на SQLite тест упадёт. Гейт уже Postgres (:5433), но новые тесты должны это уважать (никаких SQLite-fallback-ассертов).
- **`catchup_plan` не трогать.** Переиспользовать; `today<watermark` и `watermark=None` уже обработаны — распознавать их исходы, а не дублировать логику.
- **DomainError не для фона.** Не оборачивать halt в `DomainError` (нет HTTP-рендера). Лог + `CommandError`. Новых error-кодов в реестр не добавлять без явной нужды (closed-world: добавление = STOP-and-ask).
- **Watermark-гонка на бутстрапе.** Первый параллельный `get_or_create(key="status_effects")` может гнать до IntegrityError (unique key). Брать advisory-лок ДО bootstrap/чтения watermark, либо `get_or_create` под защитой лока — тогда гонка снята самим локом.
- **Halt ≠ no-op, но `catchup_plan` их СХЛОПЫВАЕТ в `[]`.** `today==watermark` (всё материализовано) и `today<watermark` (часы назад) оба дают пустой план. Детектить halt ТОЛЬКО явным `today < watermark` ПЕРЕД построением плана — иначе перевод часов назад тихо станет «нечего делать» вместо стоп+алерт (нарушение AC-4). Тест (d) обязан это ловить.
- **Общий watermark на все эффекты (для будущих E4/5.7).** `last_materialized_date` — ОДИН на ключ `status_effects`, общий для всего реестра. Когда E4/5.7 добавят материализатор, он стартует с ТЕКУЩЕГО watermark, прошлые дни задним числом НЕ материализуются (согласуется с бутстрап-философией «эффекты с go-live»). Если новому эффекту понадобится отдельный прогресс/backfill — это ОТДЕЛЬНЫЙ watermark-ключ и решение той стори, не 3.12.
- **Таймбокс E1 не относится** (это E3). Стори E3 — без жёсткого таймбокса; следовать канону качества.

### Тесты стори

- **Локально (dev, обязательно):** `make gate` зелёный на Postgres :5433; `makemigrations` «No changes detected»; `ruff check` чист по изменённым файлам.
- **Юнит/интеграция (pytest):** см. Task 4 (a–h). Конкурентный кейс (AC-2) — через второе соединение БД и `pg_try_advisory_lock` (или два потока с реальными коннектами); детерминизм времени — `clock.override`.
- **Регрессия:** нулевая по `catchup_plan`/`Watermark`/статус-сервисам/`config`/`pyproject.toml` — только новые файлы. Проверка `git diff --stat`.
- **НЕ в этом стори (проверки-консьюмеры — позже):** реальные эффекты аудита/уведомлений (E4/5.7), smoke через брокер (12.6), beat-расписание (12.1), spike часов-назад процедура (3.13).

### Definition of Done

- [x] `apps/core/locks.py`: session-level `advisory_lock` контекст-менеджер (blocking + try), гарантированный unlock, именованный ключ.
- [x] `apps/operations/statuses/services/catch_up.py`: `materialize_status_effects(today=...)` — лок → watermark(bootstrap) → `catchup_plan` → halt-распознавание → cap/sanity → per-day atomic + watermark-advance → пустой реестр-seam `EFFECT_MATERIALIZERS` с контрактом.
- [x] `apps/operations/statuses/management/commands/materialize_status_effects.py`: beat-ready вход, `--today`, halt→`CommandError`, Celery НЕ импортируется.
- [x] Тесты Task 4 (a–h) проходят; конкурентность и halt покрыты; время детерминировано.
- [x] `make gate` зелёный (Postgres), `makemigrations` пуст, `ruff check` чист; регрессия нулевая (только новые файлы).
- [x] Анти-gold-plating соблюдён: нет эффектов, нет Celery/брокера/compose/beat-регистрации, нет новых моделей/миграций, `catchup_plan`/`Watermark`/статус-сервисы не тронуты, реестр пуст.
- [x] Completion Notes без вранья: каждое «проверено/прошло» — с фактической командой/наблюдением (вывод `make gate`, имена тестов).

### Project Structure Notes

- Новые файлы: `apps/core/locks.py` (NEW, generic-инфра локов), `apps/operations/statuses/services/catch_up.py` (NEW, движок — concern статус-эффектов), `apps/operations/statuses/management/commands/materialize_status_effects.py` (NEW, вход по образцу `seed_statuses.py`), `apps/operations/statuses/tests/test_catch_up.py` (NEW). Итого 4 новых файла, одна связная ответственность (движок catch-up) — в рамках лимита «≤5 файлов».
- Изменяемых файлов нет (Watermark/catchup_plan уже есть). Если потребуется экспорт в `services/__init__.py` — минимальная правка реэкспорта.
- Локация лока в `apps/core/` — т.к. advisory-лок generic (его потом могут переиспользовать 5.7-beat и др.), а не специфичен статусам. Движок в `operations/statuses/services/` — т.к. материализует ЭФФЕКТЫ переходов статусов.

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Story-3.12 (576–582)] — AC ядра: beat от watermark, хронологично/по-дневно/advisory-лок, идемпотентность после простоев, `today<watermark`→стоп+алерт.
- [Source: _bmad-output/planning-artifacts/epics.md (85 FR-41, 93 NFR-5, 150, 172–173 Epic 3 intro, 266 A7)] — FR-41 (регламентный watermark catch-up + идемпотентность + advisory lock), NFR-5 (идемпотентные beat + catch-up от watermark), «catch-up ядро».
- [Source: _bmad-output/planning-artifacts/architecture.md ARCH-DATA-022 (104–105, 298–302)] — derived-first, beat ≠ источник истины; catch-up = чистая функция от watermark; per-day отдельные транзакции; unique+upsert; pg_advisory_lock; today<watermark→стоп+алерт.
- [Source: _bmad-output/planning-artifacts/architecture.md (117, 335–336)] — стек Celery+Beat+Redis; прод-топология (worker/beat отдельными контейнерами) — provision в 12.1.
- [Source: _bmad-output/planning-artifacts/epics.md#Story-12.1 (1223), #Story-12.6 (1262)] — 12.1 владеет Celery/брокером/compose; 12.6 регистрирует/smoke-тестит beat-задачи. 3.12 поставляет задачу, они её запускают/проверяют.
- [Source: _bmad-output/planning-artifacts/epics.md#Story-3.13 (584–590)] — спайк «часы без NTP»: процедура админа при переводе часов; 3.12 обеспечивает безопасный стоп, 3.13 — процедуру.
- [Source: Backend/VAPS/apps/core/clock.py (Clock, catchup_plan ~73–97)] — переиспользуемое ядро времени/плана (recon 2026-06-26).
- [Source: Backend/VAPS/apps/core/models.py (Watermark ~426–439), migrations/0014_watermark.py] — модель watermark (есть, миграция не нужна).
- [Source: Backend/VAPS/apps/core/exceptions.py (DomainError), docs/registries/error-codes.yaml] — closed-world коды; фон-движок использует лог, не DomainError.
- [Source: Backend/VAPS/apps/operations/statuses/services/ (status_service/bulk/secondment/dismissal/strength_report)] — паттерны сервис-слоя (atomic, локи, clock.override в тестах).
- [Source: _bmad-output/implementation-artifacts/deferred-work.md] — defer ревью 1.3: «`catchup_plan` неограничен при большом разрыве — контракт чанкинга/капа в Story 3.12»; «дисциплина записи Watermark (advisory lock/upsert) — закрыть в Story 3.12»; «clock.override не распространяется на новые треды — актуально с приходом Celery (3.12)». 3.12 закрывает cap (AC-6) и фиксирует advisory-лок-дисциплину (AC-2); ContextVar-ограничение учтено (AC-7, business_date параметром).
- [Source: _bmad-output/implementation-artifacts/1-11-спайк-выгрузка-данных-донора.md] — конвенция честных Completion Notes / Debug Log.

## Dev Agent Record

### Agent Model Used

claude-opus-4-8[1m] (Opus 4.8, 1M context)

### Debug Log References

- **make gate (Postgres :5433), 2026-06-26 — ЗЕЛЁНЫЙ:** `1284 passed, 23 deselected in 20.97s`; `ruff check .` чист; `manage.py makemigrations --check` → «No changes detected» (новых моделей нет, `Watermark` переиспользована). До boundary-фикса гейт упал на `test_operations_does_not_import_core_models` (catch_up.py импортировал `apps.core.models` напрямую — ARCH-004) → введён core-gateway `apps/core/watermark.py`, операции импортируют его, не модель; isolation-тесты после фикса зелёные (5 passed).
- **test_catch_up.py — 14 passed** (`pytest apps/operations/statuses/tests/test_catch_up.py`), вкл. 2 `@concurrency` (реальная вторая psycopg-сессия для кросс-сессионного advisory-лока). Гейт исключает `concurrency`; прогнаны отдельно: `pytest -m concurrency` → `2 passed`.
- **Эмпирические проверки механики:** разрыв 3 дня → дни Jun2/Jun3/Jun4 по возрастанию, watermark→Jun4; повтор того же дня → 0 вызовов (идемпотентный no-op); `today<watermark` → halted+`logger.error("…behind watermark…")`, watermark не откатан; пустой план НЕ маскирует halt (явное сравнение); бутстрап без watermark → set=today, 0 ретро-вызовов; разрыв > MAX_CATCHUP_DAYS(31) → ровно 31 день, watermark инкрементально, остаток на след. прогон; разрыв > sanity(366) → halted; материализатор бросает на дне 2/3 → день 1 закоммичен (watermark=Jun2), день 3 не тронут; второй прогон при удержанном локе → `skipped`, 0 двойных вызовов; команда `materialize_status_effects --today` → «catch-up ok», halt → `CommandError`.
- **ruff format** применён по двум новым файлам (catch_up.py, test_catch_up.py — собственный новый код); все 5 новых файлов format-clean. Гейт = `ruff check` (E,F) — чист.

### Completion Notes List

Стори 3.12 — **ядро FR-41** (движок catch-up), реализовано TDD (red→green), `make gate` зелёный.

- ✅ **Task 1 — advisory-лок:** `apps/core/locks.py` — session-level `advisory_lock(key, *, blocking=True)` (`pg_advisory_lock`/`pg_try_advisory_lock`/`pg_advisory_unlock`), гарантированный unlock в `finally`, `blocking=False` отдаёт «не захвачено». Док-строка объясняет session- vs xact-/row-лок.
- ✅ **Task 2 — движок:** `apps/operations/statuses/services/catch_up.py` — `materialize_status_effects(*, today=None, materializers=None) -> CatchUpResult`. Лок→бутстрап-под-локом→**явный halt-детект `today<watermark`** (не по пустому плану!)→sanity/cap→per-day `transaction.atomic()` + advance watermark. Реестр `EFFECT_MATERIALIZERS = ()` (seam), `MAX_CATCHUP_DAYS=31`/`CATCHUP_SANITY_DAYS=366` именованы с обоснованием.
- ✅ **Task 3 — команда:** `materialize_status_effects.py` — beat-ready вход, `--today`, halt→`CommandError`; Celery НЕ импортируется/НЕ добавлен в зависимости.
- ✅ **Task 4 — тесты:** `test_catch_up.py` — 14 тестов (кейсы a–h + команда + Clock-дефолт + halt-vs-noop регрессия), фейковый материализатор-рекордер через DI-параметр.
- ✅ **Task 5 — гейт:** зелёный (1284 passed), makemigrations пуст, ruff чист, регрессия нулевая (`catchup_plan`/`Watermark`-модель/статус-сервисы не изменены).
- ⚠️ **Отклонение от плана (обосновано):** добавлен 5-й новый файл `apps/core/watermark.py` (core-gateway над `Watermark`) — план предполагал прямой импорт `Watermark` в движок, но isolation-тест ARCH-004 запрещает `apps.operations` импортировать `apps.core.models`. Gateway — конвенция-корректное решение (как `apps.core.selectors`/`services`); движок импортирует `apps.core.watermark`, не модель. Cohesion сохранена, ≤5 новых файлов.
- **Анти-gold-plating соблюдён:** эффекты не построены (реестр пуст), Celery/брокер/compose/beat-регистрация не тронуты, новых моделей/миграций нет, `catchup_plan`/`Watermark`/статус-сервисы переиспользованы.
- **Закрыты defer'ы 1.3:** cap безграничного `catchup_plan` (MAX/SANITY), advisory-лок-дисциплина watermark, ContextVar-Clock в beat → `business_date` параметром.

### File List

**Создано:**
- `Backend/VAPS/apps/core/locks.py` — session-level advisory-лок хелпер
- `Backend/VAPS/apps/core/watermark.py` — core-gateway над моделью Watermark (ARCH-004 isolation)
- `Backend/VAPS/apps/operations/statuses/services/catch_up.py` — движок catch-up
- `Backend/VAPS/apps/operations/statuses/management/commands/materialize_status_effects.py` — beat-ready команда
- `Backend/VAPS/apps/operations/statuses/tests/test_catch_up.py` — 14 тестов (вкл. 2 concurrency)

**Изменено:** нет (Watermark-модель/миграция 0014, `catchup_plan` — переиспользованы как есть).

## Change Log

- 2026-06-26 — Dev (bmad-dev-story, Opus 4.8, TDD red→green): реализован движок catch-up материализации эффектов (FR-41 ядро, ARCH-DATA-022). 5 новых файлов (locks, watermark-gateway, движок, команда, тесты), 14 тестов. Session-level advisory-лок (взаимное исключение прогона), per-day транзакции + watermark-advance, явный halt-детект (`today<watermark` ≠ пустой план), batch-cap MAX=31/SANITY=366 (закрыл defer 1.3), пустой реестр-seam для E4/5.7. Boundary-фикс: core-gateway `apps/core/watermark.py` вместо прямого импорта `apps.core.models` (ARCH-004). `make gate` зелёный (1284 passed, makemigrations пуст, ruff чист). Артефакты НЕ закоммичены агентом. Status → review.
- 2026-06-26 — Code-review (bmad-code-review, проход 1, 3 слоя Opus 4.8 same-model caveat): Acceptance Auditor APPROVE — AC 1–9 ВСЕ MET вживую. 0 decision · **3 patch ПРИМЕНЕНЫ+ВЕРИФИЦИРОВАНЫ** (P1 кривой `--today`→`CommandError`; P2 будущий `--today`→`CommandError` против watermark-poison; P3 docstring «движок вне объемлющей txn») · 6 defer→deferred-work.md · 6 dismiss. +2 теста (guard-кейсы `--today`). `make gate` зелёный после патчей (**1286 passed**, makemigrations пуст, ruff чист). Артефакты ревью НЕ закоммичены агентом. Status → done.
