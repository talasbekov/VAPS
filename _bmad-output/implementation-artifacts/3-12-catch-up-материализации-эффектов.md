---
baseline_commit: 9294d0a (HEAD «feat(E3): стори 3.11 — секондмент-возврат (FR-15) + DETACHED read-only (FR-16); ревью 3.10→done»). Рабочее дерево: незакоммичены только `.claude/settings.json`, `.gitignore`, `_bmad-output/story-automator/` — кода не касаются. 3.12 строится поверх 1.3 (Clock + Watermark + `catchup_plan`).
---

# Story 3.12: Catch-up материализации эффектов

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a **система**,
I want **регламентный catch-up-раннер от watermark: под advisory-локом, хронологично, по одному дню на транзакцию, с монотонным сдвигом watermark, капом на длину плана, bootstrap первой даты и остановкой с алертом при переводе часов назад**,
so that **эффекты переходов (аудит, хуки уведомлений) материализуются ровно один раз после любых простоев — идемпотентно, возобновляемо и без дублей при конкурентном запуске (FR-41 ядро)**.

## Acceptance Criteria

Источник: [epics.md#L576-L582] (Story 3.12), FR-41 [epics.md#L85] («watermark catch-up активации/завершения (ARCH-DATA-022), идемпотентность + advisory lock»), NFR-5 [epics.md#L93], ARCH-DATA-022 [architecture.md#L299] (catch-up = чистая функция от watermark; хронологически, дата за датой, отдельными транзакциями; `pg_advisory_lock` от конкурентного Beat; `today < watermark` → стоп + алерт), [architecture.md#L298] (MUST NOT: мутируемый enum state, перещёлкиваемый задачами), [architecture.md#L522] (файл `operations/statuses/tasks.py` — «catch-up (watermark)»), [architecture.md#L469] (Beat: при занятом локе — молча выйти). Закрывает три отложенных пункта Story 1.3: [deferred-work.md#L18] (кап/чанкинг), [deferred-work.md#L19] (дисциплина записи Watermark), [deferred-work.md#L20] (`override()` и треды).

> **⚠️ Решения A–G приняты как ДЕФОЛТЫ create-story (НЕ подтверждены Bratan).** №A — кандидат на STOP-эскалацию (architecture.md#L33-34): архитектура даёт **два разных** механизма лока — `pg_advisory_lock` (#L299, ARCH-DATA-022) и `cache.add`+TTL (#L469). Выбран `pg_try_advisory_lock`; обоснование в Dev Notes → Решения. Bratan вправе переопределить на ревью.

1. **AC-1 (core-владение watermark: I/O + advisory-лок).** NEW `apps/core/watermark.py` — единственная точка чтения/записи `core_watermarks`: `advisory_lock(name)` (контекст-менеджер, отдаёт `bool` «взят/занят»), `read_watermark(key) -> date | None`, `bootstrap_watermark(key, *, on: date) -> date`, `advance_watermark(key, *, to: date)`. Модуль **не читает wall clock** (business_date — всегда параметр, ARCH-DATA-022 #L300), хотя AST-тест `test_no_wall_clock_reads_in_domain_layers` его не покрывает (не `services.py`/`models.py`) — дисциплина руками.
2. **AC-2 (монотонность + непустой ключ; закрывает [deferred-work.md#L19]).** `advance_watermark` строго возрастающая: `to <= current` → `ValueError` (молчаливый откат назад, ре-материализующий дни, невозможен). MOD `apps/core/models.py`: `Watermark.Meta.constraints += CheckConstraint(key != "")`, имя `ck_core_watermarks_key_not_blank` (стиль `ck_submission_control_settings_singleton`). Миграция `0018_watermark_key_not_blank` (после `0017_alter_divisiontype_sort_order...`), обратима, round-trip.
3. **AC-3 (bootstrap первой даты; закрывает «ответственность потребителя» 1.3 [clock.py#L77-78]).** Given `core_watermarks` не содержит `key="status_effects"`, When раннер стартует, Then **внутри лока** создаётся строка с `last_materialized_date = Clock.today_local()`, обрабатывается 0 дней, результат `status="bootstrapped"`. Конкурентный первый create не гонится до `IntegrityError` (лок держится) — второй ход видит уже созданную строку.
4. **AC-4 (хронологично, по-дневно, отдельными транзакциями, возобновляемо).** Given простой 3 дня (watermark = today−3), When раннер стартует, Then дни `[today−2, today−1, today]` обработаны **строго по возрастанию**, **каждый в своей `transaction.atomic()`**, и в ТОЙ ЖЕ транзакции watermark сдвинут на этот день. Падение на дне K оставляет watermark на K−1 (дни `<K` не переигрываются) — следующий запуск продолжает с K.
5. **AC-5 (кап/чанкинг плана; закрывает [deferred-work.md#L18]).** Модульная константа `CATCHUP_MAX_DAYS = 400`. Given план длиннее капа (watermark на годы позади: старый бэкап / fat-finger seed `1970-01-01`), When раннер стартует, Then обрабатываются первые `CATCHUP_MAX_DAYS` дат хронологически, watermark сдвинут на последнюю обработанную, `logger.warning` с числом оставшихся дней, результат несёт `remaining > 0`. **Не hard-stop:** легитимный длинный простой обязан догоняться без ручного вмешательства; аномалия видна как повторяющийся WARNING.
6. **AC-6 (`today < watermark` → стоп + алерт; контракт спайка 3.13 [epics.md#L590]).** Given перевод часов назад, When раннер стартует, Then: `catchup_plan` вызван (он логирует `ERROR "clock behind watermark: catch-up halted"` в логгер `apps.core.clock` — контракт 1.3), раннер **сам сравнивает `today < watermark`** и возвращает `status="halted"`; watermark **не двигается**, эффекты **не вызываются**, данные не перезаписываются. ⚠️ `catchup_plan` отдаёт `[]` для ТРЁХ разных случаев (`today<wm` / `today==wm` / `wm is None`) — по пустому списку halt отличить нельзя, сравнение обязательно.
7. **AC-7 (двойной ПОСЛЕДОВАТЕЛЬНЫЙ запуск не дублирует эффекты).** Given раннер отработал день D (watermark = D = today), When раннер запускается второй раз в тот же день, Then `catchup_plan` даёт `[]`, эффекты **не вызваны повторно** (спай: 0 вызовов), `status="noop"`. Идемпотентность несёт монотонный watermark — **не** `unique(сущность, business_date, версия сдачи)` из #L299 (см. Решение F).
8. **AC-8 (КОНКУРЕНТНЫЙ запуск не дублирует эффекты).** Given раннер A держит лок, When раннер B стартует в **другом соединении**, Then B получает `pg_try_advisory_lock = false`, молча выходит (`status="locked"`, `logger.info`), эффекты B **не вызваны**, watermark сдвинут ровно один раз. Тест — `@pytest.mark.concurrency` + `@pytest.mark.django_db(transaction=True)` + `threading` + `connection.close()` в `finally` (паттерн `test_employee_status_concurrency.py`). ⚠️ Advisory-локи **реентерабельны внутри одной сессии** — тест в одном соединении дал бы ложно-зелёный.
9. **AC-9 (эффекты = именованные no-op сеймы; граница ARCH-004 не нарушена).** NEW `apps/operations/statuses/effects.py`: `materialize_day_effects(business_date)` → зовёт `record_catchup_audit(business_date)` и `emit_catchup_notifications(business_date)` — обе **no-op с докстрингой** (стиль `amendment_hook.py`, 3.9). Ничего не пишут: `AuditLog` = E4 (4.1 в backlog), уведомления = E5, авто-возврат — **derived** (3.7, не эффект). NEW `apps/operations/statuses/tasks.py` (`run_status_effects_catchup()`) импортирует `apps.core.clock` и `apps.core.watermark`, но **НЕ** `apps.core.models` — иначе красный `test_operations_does_not_import_core_models` [operations/tests/test_isolation.py#L23]. NEW `management/commands/catchup_status_effects.py` — исполняемая точка входа.
10. **AC-10 (закрытый мир + гейт).** Новых кодов ошибок НЕТ; раннер **не поднимает `DomainError`** (нет HTTP-поверхности) — внутренние нарушения → `ValueError`. Новых событий в `docs/registries/audit-events.yaml` НЕТ (эффекты — no-op). Lock-id выводится детерминированно `zlib.crc32(name.encode())` — **встроенный `hash()` запрещён** (PYTHONHASHSEED рандомизирует между процессами → два beat взяли бы разные локи). `make gate` зелёный (из `Backend/VAPS`), `makemigrations --check` чист после `0018`. Concurrency-тест (AC-8) гейтом **деселектится** — прогнать отдельно `pytest -m concurrency` и записать результат в Dev Agent Record (паттерн 3.14).
11. **AC-11 (out of scope — без протечек).** НЕ строится: **Celery/`@shared_task`/beat-schedule/Redis-брокер и контейнеры worker+beat** (в проекте Celery нет вовсе: 0 вхождений; #L117/#L335/#L555 — предмет E12-деплоя; сегодня раннер — обычный вызываемый + management-команда); **таблица материализации эффектов** и `unique(сущность, business_date, версия сдачи)` (нужна «версия сдачи» = `DailySubmission` = E5); реальная запись аудита (E4, 4.1); реальные уведомления (E5, 5.7); напоминания FR-41 «за 7 дней до начала / за 3 дня до конца» (DEFERRED, триггер «старт этапа 2» [epics.md#L150]); мутация lifecycle-состояний статусов (**запрещено** #L298 — состояние derived); настройка `CATCHUP_MAX_DAYS` через `settings` (модульная константа); тест «регистрация beat-задач» (#L632 — вместе с Celery в E12); `AUTO_APPLY`/`AUTO_COMPLETE` из PRD FR-7 [prd.md#L91] (в derived-first это события аудита, а не мутации; в реестре `audit-events.yaml` их нет → E4).

## Tasks / Subtasks

- [x] **Task 1 — Дисциплина Watermark: constraint + миграция** (AC: 2)
  - [x] `apps/core/models.py`: в `Watermark.Meta` добавить `constraints = [models.CheckConstraint(condition=~models.Q(key=""), name="ck_core_watermarks_key_not_blank")]`. ⚠️ Django 5.1+ — kwarg `condition`; на 5.0 — `check` (проверить версию по `pyproject.toml`: `Django>=5.0,<5.2`; сверить с уже написанным `ck_submission_control_settings_singleton` в `submissions/models/control_settings.py#L36` и повторить ЕГО kwarg).
  - [x] Миграция `0018_watermark_key_not_blank.py` (manual-имя, не `_auto_`; зависит от `0017_alter_divisiontype_sort_order_alter_position_level_and_more`).
  - [x] `ruff format` **по файлу миграции** (не по папке app — авто-генерация даёт >88 символов → E501; прецедент 3.5/3.10/3.11).
  - [x] Round-trip forward→reverse→forward на одноразовой БД (`vaps_rt312`), все `exit=0`; затем `makemigrations --check` → «No changes detected».
- [x] **Task 2 — `apps/core/watermark.py`: advisory-лок + I/O** (AC: 1, 2, 3) — Решения A/B/E
  - [x] `_lock_id(name: str) -> int`: `zlib.crc32(name.encode())` (детерминированно между процессами; **не `hash()`**, AC-10).
  - [x] `@contextmanager advisory_lock(name)`: `SELECT pg_try_advisory_lock(%s)` → `yield acquired: bool`; в `finally` — `SELECT pg_advisory_unlock(%s)` **только если брали** (иначе снимешь чужой счётчик). **Session-level, не `_xact_`** (Решение B): лок обязан пережить N дневных транзакций.
  - [x] `read_watermark(key) -> date | None` (`.values_list(...).first()`, без `get_or_create`).
  - [x] `bootstrap_watermark(key, *, on: date) -> date`: `get_or_create(key=key, defaults={"last_materialized_date": on})`; вернуть фактическую дату (могла быть создана ранее).
  - [x] `advance_watermark(key, *, to: date)`: прочитать текущее, `if to <= current: raise ValueError(...)` (строго монотонно), затем `update`. Вызывается **внутри дневной транзакции** раннера.
  - [x] Никаких `timezone.now()`/`date.today()` — дата приходит параметром.
- [x] **Task 3 — `apps/operations/statuses/effects.py`: сеймы эффектов** (AC: 9) — Решение F
  - [x] `record_catchup_audit(business_date)` — no-op + докстрока: «E4 (4.1) заполнит; `AuditLog` не существует; событие в `audit-events.yaml` не зарегистрировано».
  - [x] `emit_catchup_notifications(business_date)` — no-op + докстрока: «E5 (5.7) заполнит; `notifications.services.notify()` не существует».
  - [x] `materialize_day_effects(business_date)` — зовёт обе; **ничего не пишет в БД**; докстрока про derived-авто-возврат (3.7) — НЕ эффект.
  - [x] `statuses` не импортирует `submissions`/`audit`/`notifications` (граница #L587, стиль `amendment_hook.py#L7-13`).
- [x] **Task 4 — `apps/operations/statuses/tasks.py`: раннер** (AC: 3,4,5,6,7,8,9) — Решения C/D/G
  - [x] `WATERMARK_KEY = "status_effects"`, `CATCHUP_MAX_DAYS = 400`; логгер `logging.getLogger(__name__)`.
  - [x] `run_status_effects_catchup() -> dict` (или frozen dataclass) с полями `status` ∈ {`locked`,`bootstrapped`,`halted`,`noop`,`ok`}, `processed: list[date]`, `remaining: int`.
  - [x] Порядок (жёстко): `with advisory_lock(WATERMARK_KEY) as acquired:` → `if not acquired: logger.info(...); return locked` → `today = Clock.today_local()` → `wm = read_watermark(KEY)` → `if wm is None: bootstrap_watermark(KEY, on=today); return bootstrapped` → `plan = catchup_plan(watermark=wm, today=today)` (**зовём ДО проверки halt — чтобы сработал ERROR-лог 1.3**) → `if today < wm: return halted` → `if not plan: return noop` → усечь до `CATCHUP_MAX_DAYS`, при усечении `logger.warning(remaining=...)` → цикл по дням: `with transaction.atomic(): materialize_day_effects(day); advance_watermark(KEY, to=day)`.
  - [x] **НЕ импортировать `apps.core.models`** (AC-9). Импорт: `from apps.core.clock import Clock, catchup_plan`, `from apps.core.watermark import advisory_lock, read_watermark, bootstrap_watermark, advance_watermark`.
- [x] **Task 5 — Точка входа: management-команда** (AC: 9)
  - [x] `apps/operations/statuses/management/commands/catchup_status_effects.py`: `handle()` зовёт раннер, печатает итог (`status`, число дней, `remaining`), `exit code != 0` при `halted`. Стиль — `seed_statuses.py`.
- [x] **Task 6 — Тесты `apps/core/tests/test_watermark.py`** (AC: 1,2,3) — TDD RED→GREEN
  - [x] `advance_watermark` вперёд — ок; назад и «в ту же дату» → `ValueError`.
  - [x] `bootstrap_watermark` идемпотентен (второй вызов не перетирает дату).
  - [x] `CheckConstraint`: `Watermark.objects.create(key="", ...)` → `IntegrityError` (по имени `ck_core_watermarks_key_not_blank`).
  - [x] `advisory_lock` отдаёт `True`, а после выхода лок снят (проверить `pg_advisory_unlock`-счётчик / повторный захват в новой сессии).
  - [x] Пер-тестовый `@pytest.mark.django_db` — **не** модульный `pytestmark` (правка ревью 3.9).
- [x] **Task 7 — Тесты `apps/operations/statuses/tests/test_catchup_materialization.py`** (AC: 4,5,6,7,8) — TDD RED→GREEN
  - [x] Спай эффектов: `monkeypatch` на `materialize_day_effects` (или на обе no-op-функции) → собирать вызванные даты.
  - [x] AC-4: watermark = `today−3`, `clock.override(date)` → `processed == [today−2, today−1, today]` строго по возрастанию; watermark == today.
  - [x] AC-4 (возобновляемость): эффект-спай бросает на 2-м дне → watermark остался на 1-м; повторный запуск продолжает со 2-го.
  - [x] AC-5: watermark = `today − 500` → `len(processed) == 400`, `remaining == 100`, WARNING в `caplog`; watermark = 400-й день.
  - [x] AC-6: watermark = `today + 5` → `status="halted"`, эффекты 0 вызовов, watermark не изменился; `caplog.set_level(logging.ERROR, logger="apps.core.clock")` содержит `"clock behind watermark: catch-up halted"`.
  - [x] AC-3: пустая таблица → `status="bootstrapped"`, 0 эффектов, строка создана с `today`.
  - [x] AC-7: два **последовательных** запуска в один день → второй `status="noop"`, эффекты вызваны суммарно ровно за первые дни.
  - [x] AC-8: `@pytest.mark.concurrency` + `@pytest.mark.django_db(transaction=True)`; два треда, барьер, `connection.close()` в `finally`; ровно один тред работает, второй `locked`. ⚠️ `clock.override()` — ContextVar, **не пересекает границу треда** ([deferred-work.md#L20]) → ставить override **внутри** каждого треда либо сеять watermark так, чтобы реальный `today` подходил.
- [x] **Task 8 — Гейт** (AC: 10)
  - [x] `make gate` зелёный **из `Backend/VAPS`** (не из корня worktree); `ruff check .` чист; `makemigrations --check` — «No changes detected».
  - [x] Отдельно: `pytest -m concurrency` (гейт деселектит) — записать passed/время в Dev Agent Record.
  - [x] Регресс: `test_isolation.py` (обе изоляции), `test_clock.py`, `test_tzdata_canary.py` зелёные.

## Dev Notes

### Решения (ВСЕ = дефолты create-story; №A — кандидат на STOP-эскалацию)

> **⚠️ №A = `pg_try_advisory_lock` (session-level), НЕ `cache.add`+TTL.** Архитектура противоречит сама себе: #L299 (ARCH-DATA-022) предписывает `pg_advisory_lock`, #L469 — `cache.add` с TTL. Выбран advisory-лок, потому что: (1) `epics.md#L85` и AC самой стори говорят «advisory lock»; (2) **`CACHES` в `config/settings.py` не сконфигурирован** → дефолт `LocMemCache` процесс-локален, а worker и beat по #L335 — **разные контейнеры** ⇒ cache-лок физически не пересечёт границу процесса и не защитит ни от чего; (3) `try`-вариант (неблокирующий) реализует требуемое «при занятом — молча выйти» (#L469), тогда как блокирующий `pg_advisory_lock` копил бы очередь beat-тиков.
> **№B = session-level, не `pg_try_advisory_xact_lock`.** Лок обязан жить поверх N дневных транзакций; xact-вариант отпустил бы его на первом же коммите, и второй beat влез бы в середину плана.
> **№C = кап-с-чанкингом (`CATCHUP_MAX_DAYS = 400`), не hard-stop.** Закрывает [deferred-work.md#L18]. Легитимный длинный простой обязан догоняться сам; аномальный watermark (1970) виден повторяющимся WARNING'ом и не вешает раннер на 20k транзакций за один тик.
> **№D = bootstrap в `today`.** На свежей БД истории эффектов нет — материализовать назад нечего. `catchup_plan(watermark=None)` намеренно молчит (`clock.py#L77-78`: «consumer's responsibility, Story 3.12»).
> **№E = монотонность в сервисе + `CheckConstraint` на `key != ""`.** Монотонность нельзя выразить `CheckConstraint` (нужно старое значение) → guard в `advance_watermark`; триггер — избыточен. Пустой ключ ловится БД (предпочтение Bratan: молчаливое `""` закрывать на DB-уровне).
> **№F = эффекты — no-op сеймы; идемпотентность несёт watermark.** `unique(сущность, business_date, версия сдачи) + upsert` из #L299 **нереализуем сегодня**: «версия сдачи» — это `DailySubmission` (ARCH-DATA-021), т.е. Epic 5. Пока эффекты ничего не пишут, дедуп-ключ дедуплицировать нечего. **Не создавать таблицу материализации** — она приедет вместе с реальными эффектами (E4/E5) и их версией.
> **№G = halt-детект сравнением, не по пустому плану.** `catchup_plan` возвращает `[]` в трёх семантически разных случаях; раннер обязан сравнить `today < watermark` сам, иначе перевод часов назад выглядит как штатное «нечего делать».

### Архитектурные правила (developer guardrails)

- **ARCH-004 / изоляция контекстов** ([operations/tests/test_isolation.py#L23]): любой прод-файл под `apps/operations/` с `import apps.core.models` → **красный гейт**. `core_watermarks` — таблица core ⇒ весь её I/O живёт в `apps/core/watermark.py`, раннер зовёт функции. Разрешено: `apps.core.clock`, `apps.core.selectors`, `apps.core.exceptions` (#L586).
- **ARCH-DATA-022 #L298: запрещён мутатор состояния.** Раннер **не трогает** `EmployeeStatus`: PLANNED→ACTIVE→FINISHED вычисляются из `[start,end)` + Clock. Единственное, что он пишет, — `Watermark.last_materialized_date`. Противоречие с PRD FR-7 [prd.md#L91] («переходы выполняются регламентными задачами… `AUTO_APPLY`/`AUTO_COMPLETE`») разрешается в пользу архитектуры: в derived-first это **события аудита**, а не запись состояния (и в `audit-events.yaml` их пока нет → E4).
- **Wall clock только через Clock** (#L300, AST-тест `test_no_wall_clock_reads_in_domain_layers`). Тест покрывает `services.py`/`models.py` и пакеты `services/`,`models/` — `tasks.py` и `watermark.py` **не покрыты**, дисциплина руками. `Clock.today_local()` читается **один раз** в раннере; ниже по стеку business_date — параметр.
- **`hash()` запрещён для lock-id** — PYTHONHASHSEED рандомизирован per-process; два beat-контейнера взяли бы разные локи. `zlib.crc32` детерминирован.
- **Advisory-локи реентерабельны в пределах сессии.** `pg_try_advisory_lock` дважды в одном соединении вернёт `true` оба раза (счётчик). ⇒ (а) `pg_advisory_unlock` строго парный; (б) тест конкурентности обязан идти через **разные соединения** (треды + `django_db(transaction=True)`), иначе ложно-зелёный.
- **`clock.override()` не пересекает границу треда** ([deferred-work.md#L20]): ContextVar в дочернем треде пуст → читается реальное время; `reset` токена из чужого контекста → `ValueError`. Ставить override внутри треда.
- **Закрытый мир** (#L33-34, `docs/registries/error-codes.yaml`): новых кодов нет. Раннер — не HTTP-путь, `DomainError` не поднимает; внутренние нарушения инварианта → `ValueError`.
- **Транзакции — в сервисе, не во view** (#L448); здесь: `transaction.atomic()` **на день**, не на весь план (иначе теряется возобновляемость и смысл «отдельными транзакциями» #L299).

### Project Structure Notes

- **NEW** `Backend/VAPS/apps/core/watermark.py` — advisory-лок + I/O `core_watermarks`.
- **MOD** `Backend/VAPS/apps/core/models.py` — `Watermark.Meta.constraints` (+CheckConstraint).
- **NEW** `Backend/VAPS/apps/core/migrations/0018_watermark_key_not_blank.py`.
- **NEW** `Backend/VAPS/apps/operations/statuses/effects.py` — сеймы эффектов (стиль `amendment_hook.py`).
- **NEW** `Backend/VAPS/apps/operations/statuses/tasks.py` — раннер (путь предписан #L522: «tasks.py — catch-up (watermark)»).
- **NEW** `Backend/VAPS/apps/operations/statuses/management/commands/catchup_status_effects.py` — точка входа.
- **NEW** `Backend/VAPS/apps/core/tests/test_watermark.py`, **NEW** `Backend/VAPS/apps/operations/statuses/tests/test_catchup_materialization.py`.
- Прод-файлов 6 (из них 1 MOD, 1 миграция) + 2 тестовых. Выше эвристики «≤5», но это **одна цепочка одной ответственности** (bookkeeping → раннер → точка входа), рассечённая надвое границей контекстов ARCH-004, которую нельзя не пересечь: watermark принадлежит core, catch-up — statuses. Дробить дальше — плодить стори, которые нельзя протестировать по отдельности.
- **`tasks.py` — обычный модуль, не Celery.** Имя выбрано под будущий autodiscover (#L596); `@shared_task`-обёртка и beat-schedule приедут в E12 вместе с Celery/Redis/контейнерами.

### Previous Story Intelligence (1.3 + 3.6–3.11)

- **1.3 (done) — фундамент.** `apps/core/clock.py`: `Clock.now()` (aware UTC, единственный легитимный `timezone.now()`), `Clock.today_local()` (Asia/Qyzylorda), `override()` (ContextVar, вложенный, exception-safe), `catchup_plan(*, watermark, today) -> list[date]` — **чистая**, `(watermark, today]` включительно, строгий type-guard (`datetime` отвергается `TypeError`), `today<watermark` → ERROR-лог + `[]`, `watermark is None` → `[]` без алерта. Модель `Watermark(key unique, last_materialized_date, updated_at)`, `db_table="core_watermarks"`, миграция `0014_watermark`. 1.3 явно оставила 3.12: beat-раннер, advisory-лок, upsert, инициализацию watermark.
- **3.9 (done) — паттерн сейма.** `amendment_hook.py:mark_days_for_amendment` — именованный no-op с докстрокой о будущем потребителе, реальный call-site, ноль импортов вниз по границе. **Копировать этот паттерн для `effects.py`.**
- **3.9-ревью:** модульный `pytestmark = django_db` снят — ставить `@pytest.mark.django_db` пер-тестово.
- **3.6-ревью:** «stale instance / lost update» — перечитывать строку после захвата лока. Здесь: `advance_watermark` читает текущее значение **внутри** дневной транзакции под уже взятым advisory-локом.
- **3.11-ревью:** `request_return` был отмечен как «запись без лока» — не повторять: запись watermark **всегда** под advisory-локом.
- **3.5/3.10/3.11:** миграции — ручные имена (`0008_secondment_return_facts`, не `_auto_`); сразу `ruff format` по файлу миграции; round-trip forward→reverse→forward на одноразовой БД.
- **Аудит нигде в E3 не пишется** — во всех стори 3.9/3.10/3.11 события аудита отложены в E4 (4.4 инструментирует сервисы E3). 3.12 — не исключение.
- **Тесты сеют данные напрямую** (`objects.create` / `bulk_create`): `factory_boy` в проекте **нет** (единственное упоминание — санкционированное исключение в `test_rbac_matrix.py`). `freezegun` **не установлен** — время только `clock.override()`.
- **Concurrency-шаблон:** `test_employee_status_concurrency.py` — `threading.Thread`, `Event`-барьер, `WAIT`-таймаут, `connection.close()` в `finally`, `thread.join(timeout)` + `assert not thread.is_alive()`. `TransactionTestCase` в проекте не используется.

### Git Intelligence

- baseline `9294d0a` (E3 3.11 закоммичена вместе с ревью 3.10→done). Незакоммичены только `.claude/settings.json`, `.gitignore`, `_bmad-output/story-automator/` — кода не касаются.
- Ритм E3: одна стори = один `feat(E3): ...` коммит; артефакты стори и `sprint-status.yaml` в том же коммите; `graphify` — отдельным `chore`. Dev-агент **не коммитит** — оставляет артефакты Bratan'у.
- dev-story: TDD RED→GREEN (сначала падающий тест на ещё не экспортированный символ) → миграция + round-trip → `make gate` → `pytest -m concurrency` отдельно.
- Ожидаемый коммит: `feat(E3): стори 3.12 — catch-up материализации эффектов (FR-41 ядро): advisory-лок, по-дневные транзакции, монотонный watermark`.

### References

- [Source: _bmad-output/planning-artifacts/epics.md#L576-L582] — Story 3.12: user story + AC (простой 3 дня; хронологично, отдельными транзакциями; двойной/конкурентный запуск не дублирует; `today < watermark` → стоп + алерт).
- [Source: _bmad-output/planning-artifacts/epics.md#L85] — FR-41: watermark catch-up, идемпотентность + advisory lock.
- [Source: _bmad-output/planning-artifacts/epics.md#L93] — NFR-5: идемпотентные beat-задачи + catch-up от watermark; business_date — параметр.
- [Source: _bmad-output/planning-artifacts/epics.md#L150] — FR-41: ядро → E3; напоминания → DEFERRED (триггер «старт этапа 2»).
- [Source: _bmad-output/planning-artifacts/epics.md#L590] — Story 3.13 (спайк «часы без NTP») потребляет контракт AC-6.
- [Source: _bmad-output/planning-artifacts/architecture.md#L299] — ARCH-DATA-022: catch-up = чистая функция от watermark; дата за датой, отдельными транзакциями; `pg_advisory_lock`; `today < watermark` → стоп + алерт.
- [Source: _bmad-output/planning-artifacts/architecture.md#L298] — MUST NOT: мутируемый enum state, перещёлкиваемый задачами (паттерн донора).
- [Source: _bmad-output/planning-artifacts/architecture.md#L469] — Beat: при занятом локе молча выйти; два параллельных catch-up недопустимы (альтернативный `cache.add`-механизм — см. Решение A).
- [Source: _bmad-output/planning-artifacts/architecture.md#L522] — структура: `operations/statuses/tasks.py # catch-up (watermark)`.
- [Source: _bmad-output/planning-artifacts/architecture.md#L117 / #L335 / #L555] — Celery + Beat + Redis, worker/beat — отдельные контейнеры (в коде отсутствуют → E12, AC-11).
- [Source: _bmad-output/planning-artifacts/architecture.md#L300] — Clock — единственная точка чтения wall clock; freezegun не трогает Postgres.
- [Source: _bmad-output/planning-artifacts/architecture.md#L586-L587] — границы: `operations → core` только selectors/exceptions/clock, НЕ models; `statuses` не импортирует `submissions`.
- [Source: _bmad-output/planning-artifacts/architecture.md#L630 / #L636] — маркеры `property/concurrency/slow`; `make gate` = ruff + pytest без этих маркеров + `makemigrations --check`.
- [Source: _bmad-output/implementation-artifacts/deferred-work.md#L18] — кап/чанкинг плана: «Контракт чанкинга/капа — ответственность потребителя, определить в Story 3.12» → AC-5.
- [Source: _bmad-output/implementation-artifacts/deferred-work.md#L19] — дисциплина записи Watermark (пустой `key`, откат назад, гонка первого upsert) → AC-2, AC-3.
- [Source: _bmad-output/implementation-artifacts/deferred-work.md#L20] — `clock.override()` не пересекает границу треда; «актуально с приходом Celery (3.12)» → Task 7.
- [Source: Backend/VAPS/apps/core/clock.py#L73-L97] — `catchup_plan`: три разных `[]`; ERROR-лог `"clock behind watermark: catch-up halted"` в логгере `apps.core.clock`.
- [Source: Backend/VAPS/apps/core/models.py#L426-L439] — `Watermark`: `key` unique CharField (без CheckConstraint), `last_materialized_date`, `updated_at`; `db_table="core_watermarks"`.
- [Source: Backend/VAPS/apps/operations/tests/test_isolation.py#L23-L29] — `test_operations_does_not_import_core_models` (жёсткая граница для `tasks.py`).
- [Source: Backend/VAPS/apps/core/tests/test_isolation.py#L107-L129] — `test_no_wall_clock_reads_in_domain_layers` (покрывает только `services.py`/`models.py` и пакеты `services/`,`models/`).
- [Source: Backend/VAPS/apps/operations/statuses/amendment_hook.py] — эталон no-op сейма с докстрокой (Решение F).
- [Source: Backend/VAPS/apps/operations/statuses/tests/test_employee_status_concurrency.py] — эталон concurrency-теста (треды, барьер, `connection.close()`).
- [Source: Backend/VAPS/apps/operations/submissions/models/control_settings.py#L36-L38] — эталон `CheckConstraint` + имя `ck_...`.
- [Source: Backend/VAPS/Makefile] — `gate`: `ruff check . && pytest -m "not property and not concurrency and not slow" && makemigrations --check --dry-run`, бюджет 300s.
- [Source: Backend/VAPS/pyproject.toml] — deps: Django/DRF/psycopg/openpyxl; dev: pytest, pytest-django, ruff, hypothesis. **Ни celery, ни redis, ни freezegun.** Маркеры `property/concurrency/slow`, `--strict-markers`.
- [Source: docs/registries/error-codes.yaml] — закрытый мир кодов ошибок (новых не вводим).
- [Source: docs/registries/audit-events.yaml] — `AUTO_APPLY`/`AUTO_COMPLETE`/`CATCHUP_*` отсутствуют → эффекты аудита не эмитим (E4).
- [Source: _bmad-output/planning-artifacts/prds/prd-VAPS-2026-06-10/prd.md#L91] — FR-7 (переходы «выполняются регламентными задачами») — противоречие с #L298, разрешено в Dev Notes.
- [Source: _bmad-output/planning-artifacts/prds/prd-VAPS-2026-06-10/prd.md#L168] — FR-41 канон (00:01 / 00:15 / напоминания; времена настраиваются).

## Dev Agent Record

### Agent Model Used

claude-opus-4-8[1m] (Opus 4.8, 1M context) — bmad-dev-story, 2026-07-09.
⚠️ Same-model caveat: code-review стори 3.12 прогнать **другой** моделью.

### Debug Log References

**Окружение.** В worktree не было `.venv` (gitignored). Пересобран локально:
`python3 -m venv .venv && .venv/bin/pip install -e '.[dev]'` → Django **5.1.15**
⇒ kwarg `condition` у `CheckConstraint` (совпало с `ck_submission_control_settings_singleton`).
Симлинк на `.venv` мейнлайна **сознательно не сделан**: editable-install кладёт
`__editable___vaps_0_1_0_finder` в `sys.meta_path`, а meta-path finder приоритетнее
`sys.path` ⇒ `import apps` разрешился бы в **основной чекаут**, а не в worktree
(тесты бы молча гоняли чужой код). Проверено: `apps.__file__` → путь worktree.

**Baseline (до правок):** `make gate` → 1272 passed, 21 deselected, 25s, зелёный.
Время прогона 22:31 +05 — вне tz-флейк-окна 00:00–05:00 (`test_vacancies_endpoint`).

**Round-trip миграции 0018** на одноразовой БД `vaps_rt312` (создана/удалена в `vaps-db-1`):
1. forward (все приложения) → `exit=0`
2. reverse `migrate core 0017` → `exit=0`; `pg_constraint` для `ck_core_watermarks_key_not_blank` → **0 строк**
3. forward `migrate core 0018` → `exit=0`; `pg_constraint` → **1 строка**
4. `makemigrations --check --dry-run` → «No changes detected», `exit=0`

**Мутационная проверка AC-8 (не ложно-зелёный).** Стори прямо предупреждает, что
concurrency-тест в одном соединении даст ложно-зелёный (advisory-локи реентерабельны).
Временно мутировал `advisory_lock`, заставив его **всегда** отдавать `acquired=True`
(= полное отсутствие взаимного исключения) → `test_concurrent_run_is_locked_out_and_effects_fire_once`
**упал**, причём поймал его второй эшелон защиты:
`ValueError: watermark 'status_effects' must advance strictly forward: 2026-03-10 -> 2026-03-10`
(тред-«проигравший» дошёл до `advance_watermark` на уже материализованный день).
Мутация откачена, файл чист (`grep -c MUTANT` → 0), тест снова зелёный.
Вывод: и advisory-лок (AC-8), и монотонность (AC-2) — рабочие, независимые барьеры.

**Прогоны.**
- `make gate` (из `Backend/VAPS`): **1291 passed, 22 deselected, 25s** — зелёный.
  `ruff check .` чист; `makemigrations --check` → «No changes detected».
- `pytest -m concurrency` (гейт деселектит): **2 passed, 1311 deselected, 3.45s**
  (пре-существующий `test_employee_status_concurrency` + новый AC-8).
- Регресс по названным файлам: `apps/core/tests/test_isolation.py`,
  `apps/operations/tests/test_isolation.py`, `test_clock.py`, `test_tzdata_canary.py`
  → **26 passed**.
- Полный `pytest` (включая property/concurrency/slow): **1313 passed, 0 errors**.
  Teardown-ERROR'ов (память о `audit_logs` × TRUNCATE) на этой ветке нет —
  `audit` = E4, ещё не построен; новый `django_db(transaction=True)` их не добавил.

### Completion Notes List

Реализовано ровно то, что в Tasks 1–8; сверх стори ничего не добавлено.

**Что построено (цепочка одной ответственности).**
- `apps/core/watermark.py` (NEW) — единственная точка I/O `core_watermarks`:
  `_lock_id` (`zlib.crc32`), `advisory_lock` (session-level `pg_try_advisory_lock`,
  парный `pg_advisory_unlock` **только если брали**), `read_watermark`,
  `bootstrap_watermark` (идемпотентный `get_or_create`), `advance_watermark`
  (строго монотонный, `ValueError` при `to <= current`). Wall clock не читает.
- `apps/core/models.py` (MOD) + миграция `0018_watermark_key_not_blank` (NEW) —
  `CheckConstraint(~Q(key=""))`, имя `ck_core_watermarks_key_not_blank`.
- `apps/operations/statuses/effects.py` (NEW) — три именованных no-op сейма по
  образцу `amendment_hook.py`; ноль импортов (границу #L587 не пересекает).
- `apps/operations/statuses/tasks.py` (NEW) — раннер `run_status_effects_catchup()`
  → frozen dataclass `CatchupResult(status, processed, remaining)`.
  Порядок шагов — ровно как предписан Task 4.
- `apps/operations/statuses/management/commands/catchup_status_effects.py` (NEW) —
  точка входа; `CommandError` при `halted` ⇒ `exit code != 0`.

**Решения, принятые по ходу (в дополнение к A–G из Dev Notes).**
1. `advance_watermark` пишет через `row.save(update_fields=[...])`, **не**
   `queryset.update()`: `auto_now` на `updated_at` срабатывает только на `save()`,
   иначе поле наблюдаемости молча протухало бы. Инвариант «прочитать текущее →
   сверить → записать» соблюдён; сериализует писателей advisory-лок.
2. `advance_watermark` без `select_for_update()`: под advisory-локом строчный лок
   избыточен, а `select_for_update()` вне транзакции — `TransactionManagementError`,
   т.е. футган для будущего вызова из скрипта. Замечание ревью 3.6 («перечитывать
   строку после захвата лока») выполнено: чтение — **внутри** дневной транзакции.
3. `advance_watermark` на небутстрапнутый ключ → `ValueError("not bootstrapped")`
   (а не `Watermark.DoesNotExist`): закрытый мир AC-10, раннер — не HTTP-поверхность.
4. Добавлены 2 теста management-команды (`status=ok` в stdout; `CommandError` при
   `halted`). Task 5 не перечислял тестов, но DoD требует покрытия точки входа —
   и это единственное место, где проверяется «`exit code != 0` при halted».
5. Добавлен `test_advisory_lock_releases_on_exception` — падение на дне K обязано
   отпустить лок, иначе следующий beat-тик вечно получал бы `locked`.

**Проверка AC ↔ тест (все 11 закрыты).**
| AC | Где проверено |
|----|---------------|
| AC-1 (core-владение, лок+I/O) | `test_watermark.py` целиком; `test_operations_does_not_import_core_models` |
| AC-2 (монотонность + непустой ключ) | `test_advance_watermark_backwards_raises`, `..._to_same_date_raises`, `test_blank_key_violates_check_constraint`; round-trip 0018 |
| AC-3 (bootstrap) | `test_empty_table_bootstraps_at_today_and_materializes_nothing`, `test_bootstrap_is_idempotent_and_never_overwrites` |
| AC-4 (хронология, по-дневные транзакции, возобновляемость) | `test_three_day_outage_is_replayed_chronologically`, `test_failure_mid_plan_leaves_watermark_on_last_good_day_and_resumes` |
| AC-5 (кап/чанкинг) | `test_plan_longer_than_cap_is_chunked_and_warns` (400 обработано, `remaining=100`, 1 WARNING) |
| AC-6 (halt + алерт) | `test_clock_behind_watermark_halts_and_alerts` (ERROR из `apps.core.clock`), `test_management_command_exits_nonzero_when_halted` |
| AC-7 (двойной последовательный запуск) | `test_second_sequential_run_on_the_same_day_is_a_noop` |
| AC-8 (конкурентный запуск) | `test_concurrent_run_is_locked_out_and_effects_fire_once` (2 треда, 2 соединения) + мутационная проверка выше |
| AC-9 (сеймы + границы) | `effects.py` (ноль импортов), `tasks.py` (только `clock`+`watermark`), `test_management_command_runs_the_catchup_and_reports_its_outcome` |
| AC-10 (закрытый мир + гейт) | `test_lock_id_is_crc32_not_builtin_hash`; `make gate` зелёный; реестры не тронуты |
| AC-11 (out of scope) | Celery/брокер/таблица материализации/аудит/уведомления/напоминания **не построены**; `settings` не тронуты |

**Открытые вопросы для Bratan (ревью).**
- **Решение A (advisory-лок vs `cache.add`)** остаётся кандидатом на STOP-эскалацию:
  архитектура противоречива (#L299 vs #L469). Реализован `pg_try_advisory_lock`.
  Обоснование не изменилось: `CACHES` не сконфигурирован ⇒ `LocMemCache` процесс-локален.
- `CATCHUP_MAX_DAYS = 400` — модульная константа, не `settings` (по AC-11).

### File List

**NEW**
- `Backend/VAPS/apps/core/watermark.py`
- `Backend/VAPS/apps/core/migrations/0018_watermark_key_not_blank.py`
- `Backend/VAPS/apps/core/tests/test_watermark.py`
- `Backend/VAPS/apps/operations/statuses/effects.py`
- `Backend/VAPS/apps/operations/statuses/tasks.py`
- `Backend/VAPS/apps/operations/statuses/management/commands/catchup_status_effects.py`
- `Backend/VAPS/apps/operations/statuses/tests/test_catchup_materialization.py`

**MOD**
- `Backend/VAPS/apps/core/models.py` (`Watermark.Meta.constraints`)
- `Backend/VAPS/apps/operations/tests/test_isolation.py` (+1 тест `test_statuses_does_not_import_sibling_contexts`, граница #L587 — добавлен QA-automation проходом 2026-07-09, отсутствовал в исходном File List; добавлено на ревью, см. Review Notes ниже)
- `_bmad-output/implementation-artifacts/3-12-catch-up-материализации-эффектов.md` (чекбоксы, Dev Agent Record, Change Log, Status)
- `_bmad-output/implementation-artifacts/sprint-status.yaml` (`3-12` → `review` → `done`, `last_updated`)

**DELETED** — нет.

### Review Notes (bmad-story-automator-review, 2026-07-09)

Автоматический ревью-проход (Sonnet 5 — закрывает same-model caveat дев-стори Opus 4.8). Git status/diff сверены с File List; прод-код (`watermark.py`, `tasks.py`, `effects.py`, `catchup_status_effects.py`, оба тест-файла) прочитан построчно заново; `make gate` и `pytest -m concurrency` **перезапущены вживую**, а не переиспользованы старые числа из Dev Agent Record.

**Находки — 2 MEDIUM, 0 HIGH/CRITICAL:**

1. **MEDIUM — File List не включал `apps/operations/tests/test_isolation.py`.** `git diff` показывает файл модифицированным (+1 тест `test_statuses_does_not_import_sibling_contexts`, граница #L587), но он не упомянут нигде в стори. Источник — отдельный QA-automation проход (`bmad-qa-generate-e2e-tests`, 2026-07-09), артефакты которого (`_bmad-output/implementation-artifacts/tests/test-summary.md`) не закоммичены и не связаны со стори-файлом. **Исправлено:** файл добавлен в File List (MOD, выше).
2. **MEDIUM — Dev Agent Record устарел относительно текущего состояния репозитория.** Тот же QA-automation проход добавил 15 тестов (`test_watermark.py` 11→15, `test_catchup_materialization.py` 9→19, `test_isolation.py` 2→3) поверх дев-стори (Tasks 6/7), не обновив числа гейта в стори — Debug Log References всё ещё нёс «1291 passed» (снимок ДО QA-прохода). Живой перезапуск подтвердил текущее состояние: `make gate` (из `Backend/VAPS`) → **1306 passed, 22 deselected, 23s**, зелёный (`ruff check .` чист, `makemigrations --check --dry-run` → «No changes detected»); `pytest -m concurrency` → **2 passed, 1326 deselected, 3.46s**. QA-проход задокументирован 13 мутационными проверками (каждый новый тест проверен внесением дефекта в прод-код — все 13 ловят дефект; прод-файлы восстановлены побайтово). **Исправлено:** живые числа зафиксированы здесь; историческая запись дев-стори в Debug Log References выше оставлена без изменений — это точный снимок момента дев-стори, а не ошибка.

**Перепроверено вживую (не по заявлениям стори):**
- Все 11 AC сверены построчно с кодом — реализация соответствует, ни один task-чекбокс 1–8 не оверклеймит.
- Границы контекстов: `effects.py` — ноль импортов; `tasks.py` импортирует только `apps.core.clock`+`apps.core.watermark` (grep подтверждён), `apps.core.models` не импортирован (ARCH-004 держится).
- Lock-id — `zlib.crc32`, не встроенный `hash()` (AC-10).
- `ck_core_watermarks_key_not_blank` — миграция 0018 применена и синхронна с моделью (`makemigrations --check` чист).
- Advisory-лок session-level, парный `pg_advisory_unlock` только при `acquired=True`; независимость барьеров (лок AC-8 vs монотонность AC-2) подтверждена мутационной проверкой в test-summary.md.

**Не исправлено — требует решения Bratan, не кода:** Решение A (`pg_try_advisory_lock` vs `cache.add`+TTL из architecture.md#L469) остаётся STOP-эскалацией — архитектура сама себе противоречит (#L299 предписывает advisory lock, #L469 — cache). Реализованный дефолт обоснован в Dev Notes (CACHES не сконфигурирован ⇒ `LocMemCache` процесс-локален, бесполезен между будущими worker/beat контейнерами). Ревью не закрывает архитектурное противоречие — это по определению решение человека, не находка для автофикса.

**Вывод:** 0 CRITICAL/HIGH — Status → **done** (прецедент 2.4–3.11).

## Change Log

| Дата | Изменение |
|------|-----------|
| 2026-07-09 | Стори 3.12 реализована: catch-up материализации эффектов (FR-41 ядро). Advisory-лок (`pg_try_advisory_lock`, session-level), хронологичный проход по дням, по одной `transaction.atomic()` на день, монотонный watermark, кап `CATCHUP_MAX_DAYS=400` с чанкингом, bootstrap первой даты, halt+алерт при `today < watermark`. Эффекты — именованные no-op сеймы (E4/E5 заполнят). Закрыты 3 отложенных пункта Story 1.3 (deferred-work.md#L18/#L19/#L20). |
| 2026-07-09 | Миграция `core.0018_watermark_key_not_blank` — `CheckConstraint(~Q(key=""))`; round-trip forward→reverse→forward зелёный. |
| 2026-07-09 | Тесты: `apps/core/tests/test_watermark.py` (11), `apps/operations/statuses/tests/test_catchup_materialization.py` (9, из них 1 `@pytest.mark.concurrency`). `make gate`: 1291 passed / 22 deselected / 25s. `pytest -m concurrency`: 2 passed. |
| 2026-07-09 | `sprint-status.yaml`: `3-12` `backlog` → `in-progress` → `review` (create-story не перевёл ключ в `ready-for-dev` — рассинхрон исправлен вперёд). |
| 2026-07-09 | QA test automation (`bmad-qa-generate-e2e-tests`): +15 тестов (`test_watermark.py` 11→15, `test_catchup_materialization.py` 9→19, `apps/operations/tests/test_isolation.py` 2→3 — граница `statuses ↛ submissions/audit/notifications`); 13 мутационных проверок, все ловят внесённый дефект. `make gate`: 1306 passed / 22 deselected. Саммари: `_bmad-output/implementation-artifacts/tests/test-summary.md` (не закоммичено). |
| 2026-07-09 | Ревью (`bmad-story-automator-review`, Sonnet 5 — закрывает same-model caveat): 2 MEDIUM найдено и исправлено (File List не включал `test_isolation.py`; Dev Agent Record нёс числа гейта ДО QA-automation прохода вместо текущих). 0 HIGH/CRITICAL. `make gate`/`pytest -m concurrency` перезапущены вживую — оба зелёные (1306 passed / 22 deselected; 2 passed / 1326 deselected). Status → done. |
