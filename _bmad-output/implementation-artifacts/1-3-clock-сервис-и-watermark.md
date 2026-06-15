---
baseline_commit: b12603a934e756820514cfe43a026cde3c0e6713 (+ незакоммиченные изменения сторей 1.1 и 1.2 в рабочем дереве)
---

# Story 1.3: Clock-сервис и watermark

Status: done

## Story

As a разработчик,
I want core.clock.Clock (единственная точка wall clock, с override()) и модель watermark last_materialized_date,
so that время — инжектируемая зависимость и catch-up — чистая функция.

## Acceptance Criteria

1. **Given** тест с `clock.override(date(2026,6,1))`, **When** доменный код спрашивает `Clock.today_local()`, **Then** возвращается подменённая дата.
2. **Given** today < watermark, **When** вычисляется план catch-up, **Then** план пуст и пишется алерт-лог.
3. **And** линт: `timezone.now()`/`date.today()` в `apps/*/services|models` — ошибка.

## Tasks / Subtasks

- [x] Task 1: Модуль `apps/core/clock.py` — Clock + override (AC: 1)
  - [x] Создать `apps/core/clock.py` (путь зафиксирован структурой архитектуры: `core/clock.py # Clock-сервис (+override для тестов)`)
  - [x] `Clock.now() -> datetime` — aware UTC datetime; внутри допустим `django.utils.timezone.now()` — это ЕДИНСТВЕННОЕ легитимное место чтения wall clock во всём проекте (ARCH-DATA-022)
  - [x] `Clock.today_local() -> date` — текущая business-дата: `now()` сконвертированный в `ZoneInfo(settings.VAPS_LOCAL_TIMEZONE)` (= "Asia/Qyzylorda"), взята `.date()` (ARCH-DATA-023: календарные сутки, полночь Asia/Qyzylorda)
  - [x] `override(value)` — context manager на `contextvars.ContextVar` (token-reset в finally → exception-safe, поддерживает вложенность, thread/async-safe). Принимает `date` (→ `today_local()` возвращает её; `now()` = полночь этой даты в local tz, сконвертированная в UTC) или aware `datetime` (→ `now()` возвращает его; `today_local()` = его дата в local tz). Naive datetime → `TypeError` (запрет молчаливой двусмысленности)
  - [x] MUST NOT: чтение wall clock где-либо ещё в clock.py-потребителях; глобальный мутируемый стейт вместо contextvar; freezegun (он — только для тонкого слоя границы, не для доменных тестов)
- [x] Task 2: Чистая функция плана catch-up (AC: 2)
  - [x] В том же `apps/core/clock.py`: `catchup_plan(*, watermark: date | None, today: date) -> list[date]` — чистая функция без ORM/IO (ARCH-DATA-022: «план = f(watermark, today)»)
  - [x] `watermark < today` → список дат `[watermark+1 … today]` включительно, строго хронологически (catch-up идёт «дата за датой»)
  - [x] `watermark == today` → `[]` (нечего материализовывать)
  - [x] `today < watermark` → `[]` + алерт через `logging.getLogger(__name__).error(...)` с явным маркером перевода часов назад (например `"clock behind watermark"` + обе даты в extra). Это AC-2 и контракт спайка 3.13 («перевод часов назад → catch-up останавливается с алертом»)
  - [x] `watermark is None` → `[]` без алерта (watermark ещё не инициализирован; bootstrap первой даты — ответственность потребителя, Story 3.12)
  - [x] MUST NOT: `print()`; чтение Clock внутри catchup_plan (обе даты приходят параметрами — функция чистая)
- [x] Task 3: Модель Watermark + миграция (AC: 2 — носитель last_materialized_date)
  - [x] В `apps/core/models.py` добавить `Watermark(models.Model)`: `key = CharField(max_length=100, unique=True)` (идентификатор процесса материализации, например "status_effects" — потребитель 3.12), `last_materialized_date = DateField()`, `updated_at = DateTimeField(auto_now=True)`
  - [x] Plain `models.Model` с дефолтным BigAuto PK — по образцу служебно-справочных моделей core (DivisionType/Position/Rank, `apps/core/models.py:82-119`), НЕ UUIDTimeStampedModel (не внешне-видимая кадровая сущность, на неё никто не ссылается)
  - [x] `db_table = "core_watermarks"` (naming pattern `core_<plural_snake>`)
  - [x] Миграция: `makemigrations core` → переименовать в `0014_watermark.py` (ручное имя, MUST NOT `_auto_`); зависимость от `0013_sensitivefieldpolicy`; отформатировать ruff'ом сразу (урок ревью 1.1/1.2)
  - [x] MUST NOT: NOW()/`timezone.now`-default на `last_materialized_date` (business-дата задаётся потребителем явно — ARCH-DATA-022); сервис записи watermark (advisory lock, upsert — это Story 3.12, не здесь)
- [x] Task 4: Перевод существующего кода на Clock (AC: 3 — иначе новый линт красный)
  - [x] `apps/operations/services.py:32` (`PermissionService.effective_permissions`): `now = timezone.now()` → `now = Clock.now()`; импорт `from apps.core.clock import Clock`; убрать неиспользуемый импорт `timezone`, если станет неиспользуемым
  - [x] Граница это разрешает явно: «operations/* → core: только selectors, exceptions, **clock**; НЕ models» [architecture.md#Architectural Boundaries] — AST-тест изоляции operations НЕ должен покраснеть
  - [x] Поведение PermissionService не меняется (Clock.now() без override == timezone.now()); существующие тесты temp-duty проходят без правок
- [x] Task 5: AST-чек «wall clock вне Clock — ошибка» (AC: 3)
  - [x] В `apps/core/tests/test_isolation.py` добавить тест по образцу `test_x_user_id_literal_only_in_core_auth`: обойти `apps/**/{services,models}` — файлы `services.py`, `models.py` и содержимое пакетов `services/`, `models/` любого app (включая будущие вложенные apps `apps/operations/<sub>/`), исключая `tests/`, `migrations/` в `path.parts`
  - [x] Детектор: `ast.Call`, где `func` — `ast.Attribute`; взять `ast.unparse(node.func)` и сматчить по суффиксам denylist `{"timezone.now", "date.today", "datetime.now", "datetime.today", "datetime.utcnow"}` (суффикс-матч покрывает и алиасы вида `dt.datetime.now`)
  - [x] `auto_now`/`auto_now_add` в моделях — НЕ нарушение (keyword-аргументы, не вызовы; чек на ast.Call их не заденет — убедиться тестом, что существующие модели зелёные)
  - [x] Самопроверка нетривиальности: временно вернуть `timezone.now()` в operations/services.py → тест красный; убрать → зелёный (паттерн 1.2, Task 4)
  - [x] MUST NOT: чинить `apps/core/api/views.py:129,141,154` (`timezone.now()` во views) — api/ вне скоупа AC-3; см. Out of Scope
- [x] Task 6: Тесты и зелёный gate (AC: 1, 2, 3)
  - [x] Создать `apps/core/tests/test_clock.py`:
    - (а) AC-1 дословно: `with clock.override(date(2026, 6, 1)): assert Clock.today_local() == date(2026, 6, 1)`
    - (б) выход из контекста → возвращается реальная дата; вложенный override → внутренний побеждает, после выхода — внешний
    - (в) `Clock.now()` aware (`utcoffset() is not None`), в UTC
    - (г) без override `Clock.today_local()` == дата `Clock.now()` в Asia/Qyzylorda
    - (д) override с naive datetime → TypeError
    - (е) `catchup_plan(watermark=D, today=D+3)` == `[D+1, D+2, D+3]` (хронологично)
    - (ж) `catchup_plan(watermark=D, today=D)` == `[]`
    - (з) AC-2 дословно: `catchup_plan(watermark=D, today=D-1)` == `[]` и через `caplog` зафиксирован ERROR-алерт
    - (и) `catchup_plan(watermark=None, today=D)` == `[]` без алерта
    - (к) `Watermark`: создание с key + last_materialized_date; второй с тем же key → IntegrityError (unique)
  - [x] Существующие тесты operations (test_temp_duty_api и весь сьют) зелёные без правок
  - [x] `make gate` зелёный (ruff + тесты на Postgres + makemigrations --check + tzdata-канарейка)

### Review Findings

- [x] [Review][Patch] AST-чек wall clock: ложноотрицательные срабатывания — расширить denylist (`timezone.localdate`, `timezone.localtime`, `time.time`, `datetime.fromtimestamp`) и детектор (ловить `ast.Name`-вызовы `now`/`today`/`utcnow`/`localdate`/`localtime`, импортированные из time-модулей через `from ... import`, включая алиасы) — решение ревью 2026-06-11, вариант «расширить и denylist, и детектор» [Backend/VAPS/apps/core/tests/test_isolation.py:56]
- [x] [Review][Patch] `Clock.now()` нарушает собственный контракт «aware UTC» под override с non-UTC datetime — замороженное значение возвращается verbatim в исходной tz; нормализовать `frozen = value.astimezone(dt_timezone.utc)` (инстант тот же, тесты не меняются) [Backend/VAPS/apps/core/clock.py:55]
- [x] [Review][Patch] `catchup_plan()` молча принимает `datetime` (datetime IS-A date): `(today - watermark).days` усекает неполные сутки, а план возвращает datetime'ы вместо дат — добавить строгий type guard (`type(...) is not date` → TypeError), в духе запрета молчаливой двусмысленности этой же стори [Backend/VAPS/apps/core/clock.py:79]
- [x] [Review][Patch] Суффикс-матч AST-чека пересекает границы идентификаторов: `user_timezone.now()` матчится на `"timezone.now"`, `summary_date.today()` на `"date.today"` — добавить dot-boundary (`("." + dotted).endswith(("." + d for d in denylist))`), покрытие алиасов вида `dt.datetime.now` сохраняется [Backend/VAPS/apps/core/tests/test_isolation.py:90]
- [x] [Review][Patch] `test_today_local_matches_now_in_local_tz` флакает на границе локальной полуночи: два независимых чтения Clock могут разъехаться на сутки — взять `now` до и после и допускать обе даты [Backend/VAPS/apps/core/tests/test_clock.py:72]
- [x] [Review][Defer] `catchup_plan` неограничен при большом положительном разрыве (watermark годами позади → десятки тысяч дат одним планом, без капа/предупреждения) — контракт чанкинга/капа определить в Story 3.12 [Backend/VAPS/apps/core/clock.py:88] — deferred, скоуп потребителя
- [x] [Review][Defer] Дисциплина записи Watermark не защищена: пустой `key=""` проходит `objects.create()` (нет CheckConstraint), откат `last_materialized_date` назад не алертится, конкурентный первый upsert по одному key гонится до IntegrityError — advisory lock/upsert-сервис явно отложены спекой в Story 3.12 [Backend/VAPS/apps/core/models.py:406] — deferred, скоуп 3.12
- [x] [Review][Defer] `override()` не распространяется на новые треды (ContextVar пуст в дочернем треде → внутри override читается реальное время), а reset токена из чужого контекста даёт ValueError — задокументировать ограничение к приходу Celery/тредов (3.12) [Backend/VAPS/apps/core/clock.py:20] — deferred, документация ограничения

## Dev Notes

### Цель (одним предложением)

Свести чтение wall clock к одной подменяемой точке ДО появления статусного движка (1.5/1.7 уже считают «на дату», 3.12 строит catch-up — если время расползётся по коду сейчас, derived-first развалится на тестируемости) и положить в БД носитель watermark, чтобы план catch-up был чистой функцией `f(watermark, today)`, проверяемой без Celery и без БД.

### Текущее состояние кода (прочитано 2026-06-11 — НЕ перепроверять, состояние зафиксировано)

- `apps/core/clock.py` НЕ существует. Watermark-модели нет нигде (grep по `watermark|last_materialized` — пусто).
- **Wall clock вне тестов читается в 4 местах:** `apps/operations/services.py:32` (`PermissionService.effective_permissions` — окно temp-duty; ПОПАДАЕТ под новый чек, мигрирует в Task 4) и `apps/core/api/views.py:129,141,154` (`assign_employee`/`release`/`VacancyViewSet.list` — api/, ВНЕ скоупа AC-3, не трогать).
- `config/settings.py`: `TIME_ZONE = "Asia/Qyzylorda"`, `USE_TZ = True`, `VAPS_LOCAL_TIMEZONE = "Asia/Qyzylorda"` (строка, годится для `ZoneInfo(...)`). LOGGING не сконфигурирован — `logging.getLogger(__name__).error(...)` достаточно (structured JSON — эпик деплоя).
- Миграции core: последняя `0013_sensitivefieldpolicy` (плюс `User` живёт в `0001_initial` по решению ревью 1.2). Все имена ручные.
- `apps/core/tests/test_isolation.py`: хелперы `_module_files(context)` (обходит `apps/<context>/**/*.py` без `tests` в parts), `_imports(path)`, `_string_constants(path)`; тесты `test_x_user_id_literal_only_in_core_auth` (образец для нового чека, включая самопроверку нетривиальности) и `test_core_does_not_import_other_context_models`.
- `apps/operations/tests/test_isolation.py` сторожит «operations не импортирует core.models» — импорт `apps.core.clock` под это НЕ попадает (и разрешён границей явно).
- Образцы служебных моделей с обычным PK в core: `DivisionType`/`Position`/`Rank` (`apps/core/models.py:82-119`, plain `models.Model`, `DEFAULT_AUTO_FIELD = BigAutoField`).
- tzdata-канарейка уже есть: `apps/core/tests/test_tzdata_canary.py` (utcoffset Asia/Qyzylorda == +05:00).
- pytest: маркеры `property/concurrency/slow`, `--strict-markers`; hypothesis НЕ установлен (property-тесты начнутся с 1.7) — тесты этой стори обычные, без маркеров.
- ruff: `select = ["E", "F"]`, target py312.

### Что НЕ трогать (Out of Scope)

- **Beat-задача catch-up, advisory lock, upsert эффектов, инициализация watermark** — Story 3.12. Здесь только модель-носитель и чистая функция плана.
- **`apps/core/api/views.py:129,141,154`** (`timezone.now()` во views) — вне скоупа AC-3 (линт покрывает `services|models`). Уйдёт при переносе этой логики во view→сервис (layer contract); НЕ расширять чек на api/ в этой стори — это сломало бы её «одна ответственность».
- **Семантика business_date в сервисах** («все доменные функции принимают business_date явно») — норма ARCH-DATA-022 применяется к НОВЫМ сервисам начиная с 1.7; ретрофит существующих core-сервисов сюда не входит.
- **`Backend/PersonnelStatus/` — ДОНОР, не трогать.**
- **Рефактор `core/models.py` → пакет `models/`** — по-прежнему отдельная стори («при первом касании» отложено и в 1.2).
- Спайк часов/рассинхрона — Story 3.13 (потребитель алерта, который ты здесь создаёшь).
- freezegun не добавлять в зависимости — он не нужен: override покрывает домен.

### Архитектурные нормы, которые исполняет стори

- **ARCH-DATA-022 (derived-first, фрагмент времени):** «**Clock-сервис** — единственное место чтения wall clock (override для тестов); все доменные функции принимают business_date явно. MUST NOT: timezone.now()/NOW()-defaults в доменной логике и business-полях (freezegun не трогает Postgres). freezegun — только тонкий слой границы»; «catch-up = чистая функция от watermark (last_materialized_date): план = f(watermark, today); хронологически, дата за датой»; «today < watermark (перевод часов) → стоп + алерт». [Source: _bmad-output/planning-artifacts/architecture.md#Data Architecture]
- **ARCH-DATA-023 (интервалы/время):** календарные сутки, полночь Asia/Qyzylorda; Казахстан = единый UTC+5 без сезонных переходов (канарейка уже в gate). [Source: architecture.md#Data Architecture]
- **Format Patterns:** «MUST NOT: смешивать `date.today()` и `timezone.now().date()` — только Clock-сервис». [Source: architecture.md#Format Patterns]
- **Structure Patterns:** «время — только `core.clock.override(...)`» в тестах. [Source: architecture.md#Structure Patterns]
- **Architectural Boundaries:** «operations/* → core: только selectors, exceptions, clock; НЕ models» — импорт Clock из operations легален. [Source: architecture.md#Architectural Boundaries]
- **Enforcement:** «AST-тесты (…, timezone.now в домене)» — AC-3 реализуется AST-тестом в стиле существующих, не ruff-правилом (ruff E,F не умеет такой запрет без плагина). [Source: architecture.md#Enforcement Guidelines]
- Naming: `db_table = "core_watermarks"`; миграция `0014_watermark.py` ручным именем; модель + её constraints = одна миграция. [Source: architecture.md#Naming Patterns]
- `make gate` зелёный до закрытия стори. [Source: architecture.md#Enforcement Guidelines]

### Решения, принятые при создании стори (дефолты; менять только осознанно)

1. **`catchup_plan` живёт в `core/clock.py`, не в core/services.py**: функция — чистая математика дат без ORM (обе даты — параметры), темпоральное ядро целиком в одном модуле; `core/services.py` — про кадровые операции, мешать туда инфраструктуру времени не надо. Beat-задача 3.12 (в operations/statuses/tasks.py по структуре) прочитает Watermark из БД, спросит Clock.today_local() и вызовет catchup_plan.
2. **Watermark — keyed-модель (`key` unique), не синглтон-строка**: материализаций будет несколько (catch-up эффектов статусов 3.12; ночная diff-джоба parallel-run; beat-проверка светофора 5.7 — каждой нужен свой маркер «докуда дошёл»). Ключ строкой стоит ноль сейчас и экономит миграцию потом. Канонические значения key назначают потребители (3.12 — первый).
3. **Plain `models.Model`, не UUIDTimeStampedModel**: watermark — внутренняя служебная таблица, на которую никто не ссылается ни внутри, ни снаружи; прецедент обычного PK в core уже есть (DivisionType/Position/Rank). ARCH-002 («core — UUID PK») читается по существующему коду как правило для внешне-видимых кадровых сущностей.
4. **`catchup_plan(watermark=None) → []` без алерта**: отсутствие watermark = материализация ещё не запускалась; чистая функция не может решить, с какой даты начинать (это знание потребителя — 3.12 создаст строку с начальной датой явно). Алерт только на `today < watermark` — это аномалия часов, а не холодный старт.
5. **`override()` принимает date ИЛИ aware datetime, naive datetime — TypeError**: AC формулирует override датой; datetime нужен для будущих тестов «контрольного часа 17:00» (5.3). Naive datetime запрещён — ровно та двусмысленность («какая это таймзона?»), ради устранения которой существует Clock.
6. **`Clock.now()` добавляется сразу** (а не только today_local): PermissionService нужен datetime для окна temp-duty (Task 4); без now() пришлось бы оставить timezone.now() и дырявить собственный линт исключением — хуже.
7. **Чек сканирует и будущие пакеты `services/`, `models/` вложенных apps** (`apps/operations/<sub>/...` появятся с 1.5): дешевле написать обход правильно сейчас, чем расширять чек миграцией в каждой стори.

### Подводные камни для dev-агента

- **contextvar + token**: `override` обязан восстанавливать предыдущее значение через `var.reset(token)` в `finally`, не через `var.set(None)` — иначе вложенные override ломаются и упавший тест отравляет соседей.
- **Конверсия в local tz — только внутри Clock**: `today_local()` = `Clock.now().astimezone(ZoneInfo(settings.VAPS_LOCAL_TIMEZONE)).date()`. НЕ `date.today()` (наивная системная TZ) и НЕ `timezone.localdate()` вне clock.py.
- **`USE_TZ=True` уже стоит** — `timezone.now()` внутри Clock возвращает aware UTC; ничего довинчивать не надо.
- **caplog в pytest**: алерт проверять через фикстуру `caplog` (`caplog.set_level(logging.ERROR, logger="apps.core.clock")`); имя логгера = `__name__` модуля = `apps.core.clock`.
- **AST-чек: не заденьте сам clock.py** — он в `apps/core/clock.py`, путь не матчится на `services|models`, исключений городить не нужно. Если решите сканировать шире — clock.py единственное легитимное исключение.
- **`makemigrations` сгенерирует имя сам — переименовать в `0014_watermark.py` до коммита**; `makemigrations --check` в gate поймает дрейф; ruff-формат миграции сразу (уроки ревью 1.1/1.2 — оба раза спотыкались об это).
- **В рабочем дереве лежат незакоммиченные изменения сторей 1.1 и 1.2** (Makefile, compose, pyproject, core/auth, User в 0001_initial, E501-фиксы) — НЕ откатывать, НЕ включать в свой File List. HEAD = `b12603a`.
- **Не импортировать ничего operations-ового в core/clock.py** — core никого не импортирует (AST-тест изоляции сторожит).
- Дни в `catchup_plan` — `timedelta(days=1)` по голым `date`; никакого DST-кошмара нет by design (единый UTC+5, канарейка сторожит).
- В `test_isolation.py` живёт известный pre-existing deferred-баг (поглощённый операнд) — НЕ чинить, просто добавить свой тест рядом (то же правило было в 1.2).

### Технические версии (зафиксированы архитектурой 2026-06-10, веб-ресёрч не требуется)

- Django 5.0–5.1 (pyproject `Django>=5.0,<5.2`): contextvars, zoneinfo — stdlib py312; `timezone.now()` стабилен.
- Новых зависимостей НЕ добавлять (ни freezegun, ни hypothesis — последний придёт с 1.7).
- Окружение: venv `Backend/VAPS/.venv`, Postgres 16 на 5433 через `docker compose up -d --wait db`, `make gate` — штамп закрытия.

### Git-интеллидженс

- HEAD = `b12603a` (гигиена репо); работа 1.1 и 1.2 НЕ закоммичена — рабочее дерево уже содержит core/auth, User-модель, gate-харнесс. Паттерны брать из `Backend/VAPS/apps/` (ручные миграции, AST-тесты в test_isolation.py, plain-модели справочников), НЕ из донора (`Backend/PersonnelStatus/`).
- Уроки ревью 1.1/1.2: полный File List обязателен; миграции форматируются ruff'ом (без exclude); самопроверка нетривиальности AST-чека — обязательный шаг, не опция; swappable/initial-нюансы миграций к этой стори не относятся (Watermark — обычная модель).

### Зависимости

- Depends on: Story 1.1 (make gate, Postgres-harness), Story 1.2 (паттерны AST-чеков; прямой кодовой зависимости нет).
- Blocks: Story 1.7 (derived-расчёт спрашивает Clock.today_local()/business_date), Story 3.12 (beat catch-up — потребитель Watermark и catchup_plan), Story 3.13 (спайк часов — потребитель алерта), Story 5.3 (граница 17:00 тестируется через override datetime), Story 1.4 (не блокирует, но сервисы 1.4+ уже обязаны соблюдать линт AC-3).

### Тесты стори

- Unit: `apps/core/tests/test_clock.py` — override (date/datetime/naive/вложенность/восстановление), today_local/now-семантика, catchup_plan (4 ветки: нормальная/равенство/часы-назад+алерт/None), Watermark unique key.
- Integration: сьют operations зелёный без правок (PermissionService на Clock.now() поведенчески идентичен); `makemigrations --check` чист.
- AST: новый чек в `apps/core/tests/test_isolation.py` — wall-clock вызовы в `apps/**/{services,models}` = offender; самопроверка временным нарушением.
- Manual (DoD): `make gate` зелёный; grep `timezone.now\|date.today` по `apps/*/services*` и `apps/*/models*` находит ноль вхождений вне clock.py.

### Definition of Done

- [x] `apps/core/clock.py`: Clock.now()/Clock.today_local()/override() — единственная точка wall clock; AC-1 проходит дословно
- [x] `catchup_plan` — чистая функция; today < watermark → пустой план + ERROR-алерт (AC-2); все 4 ветки покрыты тестами
- [x] Модель `Watermark` (key unique, last_materialized_date) + миграция `0014_watermark.py` ручным именем
- [x] `apps/operations/services.py` читает время через Clock; сьют operations зелёный без правок тестов
- [x] AST-чек wall clock в services|models добавлен и нетривиально красный при нарушении (AC-3)
- [x] Новых зависимостей нет; `make gate` зелёный

### Project Structure Notes

- `apps/core/clock.py` — точно по целевой структуре архитектуры (модуль в core, не пакет, не app).
- Watermark добавляется в существующий `apps/core/models.py` (файл, не пакет) — рефактор models.py→models/ по-прежнему осознанно отложен (решение 1.2 не пересматривается).
- Целевая структура размещает «tasks.py # catch-up (watermark)» в `apps/operations/statuses/` — это Story 3.12; настоящая стори кладёт в core только то, от чего 3.12 будет зависеть (модель + чистая функция + Clock). Расхождения со структурой нет: statuses-app ещё не существует (создаётся в 1.5).
- `project-context.md` в репо отсутствует (проверено glob'ом при активации) — раздел project-context не применим.

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Story 1.3] — формулировка и AC
- [Source: _bmad-output/planning-artifacts/epics.md#Epic 1] — место в walking skeleton («Clock/watermark» — инфраструктура временного ядра)
- [Source: _bmad-output/planning-artifacts/architecture.md#Data Architecture] — ARCH-DATA-022 (Clock, watermark, catch-up = чистая функция, today<watermark → стоп+алерт), ARCH-DATA-023 (календарные сутки, Asia/Qyzylorda)
- [Source: _bmad-output/planning-artifacts/architecture.md#Format Patterns] — запрет date.today()/timezone.now() мимо Clock
- [Source: _bmad-output/planning-artifacts/architecture.md#Architectural Boundaries] — operations → core.clock разрешён
- [Source: _bmad-output/planning-artifacts/architecture.md#Complete Project Directory Structure] — core/clock.py; statuses/tasks.py (catch-up) — будущий потребитель
- [Source: Backend/VAPS/apps/operations/services.py:32] — timezone.now() в PermissionService (мигрирует на Clock)
- [Source: Backend/VAPS/apps/core/api/views.py:129,141,154] — timezone.now() во views (вне скоупа, не трогать)
- [Source: Backend/VAPS/apps/core/tests/test_isolation.py] — образец AST-чека и хелперы
- [Source: Backend/VAPS/apps/core/models.py:82-119] — DivisionType/Position/Rank: образец plain-модели в core
- [Source: _bmad-output/implementation-artifacts/1-2-кастомная-модель-user-и-identity-контракт.md] — уроки ревью (формат миграций, самопроверка AST-чека, незакоммиченное дерево)
- [Source: _bmad-output/implementation-artifacts/deferred-work.md] — известные deferred (поглощённый операнд в test_isolation — не чинить)

## Dev Agent Record

### Agent Model Used

claude-fable-5 (Claude Code)

### Debug Log References

- RED → GREEN по TDD: тесты `test_clock.py` написаны до реализации, падали с ImportError, затем 16/16 зелёные.
- `makemigrations core` сразу сгенерировал имя `0014_watermark.py` (модель одна) — ручное переименование не понадобилось; миграция отформатирована ruff'ом немедленно (урок ревью 1.1/1.2).
- Самопроверка нетривиальности AST-чека выполнена: временный возврат `timezone.now()` в `apps/operations/services.py` → `test_no_wall_clock_reads_in_domain_layers` красный; откат → зелёный.
- Финал: `make gate` зелёный — ruff чист, 135 passed (вкл. tzdata-канарейку), `makemigrations --check` чист, 4s.
- Ручной DoD-grep: `timezone.now|date.today` по `apps/*/services*.py` и `apps/*/models*.py` — ноль вхождений.

### Completion Notes List

- **Task 1**: `apps/core/clock.py` — `Clock.now()` (aware UTC; внутри единственный легитимный `timezone.now()`), `Clock.today_local()` (дата в `ZoneInfo(settings.VAPS_LOCAL_TIMEZONE)`), `override()` — context manager на `ContextVar` с token-reset в `finally` (вложенность и exception-safety покрыты тестами). Принимает `date` (→ now() = полночь local tz в UTC) или aware `datetime`; naive datetime → `TypeError`. Проверка `isinstance(value, datetime)` идёт раньше `date` (datetime — подкласс date).
- **Task 2**: `catchup_plan(*, watermark, today)` в том же модуле — чистая функция без ORM/IO. 4 ветки: нормальная (`[watermark+1 … today]` хронологично), равенство → `[]`, `today < watermark` → `[]` + `logger.error("clock behind watermark: catch-up halted", extra={обе даты})`, `watermark is None` → `[]` без алерта.
- **Task 3**: модель `Watermark` (plain `models.Model`, BigAuto PK по образцу DivisionType/Position/Rank): `key` unique, `last_materialized_date` DateField без NOW()-default, `updated_at` auto_now; `db_table="core_watermarks"`. Миграция `0014_watermark.py`, зависимость от `0013_sensitivefieldpolicy`.
- **Task 4**: `apps/operations/services.py` переведён на `Clock.now()`; импорт `django.utils.timezone` убран. Сьют operations (56 тестов) зелёный без правок тестов; AST-тест изоляции operations не покраснел (граница «operations → core.clock» разрешена явно).
- **Task 5**: в `apps/core/tests/test_isolation.py` добавлен `test_no_wall_clock_reads_in_domain_layers`: обход `apps/**` — файлы `services.py`/`models.py` и содержимое пакетов `services/`/`models/` (включая будущие вложенные apps), исключая `tests/`/`migrations/`; детектор `ast.Call` + `ast.unparse(node.func)` с суффикс-матчем denylist `{timezone.now, date.today, datetime.now, datetime.today, datetime.utcnow}`. `auto_now`/`auto_now_add` не задеваются (keyword-аргументы, не вызовы) — существующие модели зелёные. Самопроверка нетривиальности выполнена. Pre-existing deferred-баг (поглощённый операнд) не тронут.
- **Task 6**: `test_clock.py` — 16 тестов, все кейсы (а)–(к) включая AC-1 и AC-2 дословно; `caplog` на логгер `apps.core.clock`. Новых зависимостей нет (ни freezegun, ни hypothesis). `apps/core/api/views.py:129,141,154` не тронуты (вне скоупа AC-3).

### File List

- `Backend/VAPS/apps/core/clock.py` — новый: Clock, override(), catchup_plan()
- `Backend/VAPS/apps/core/models.py` — изменён: добавлена модель Watermark
- `Backend/VAPS/apps/core/migrations/0014_watermark.py` — новый: миграция Watermark
- `Backend/VAPS/apps/core/tests/test_clock.py` — новый: 16 unit-тестов темпорального ядра
- `Backend/VAPS/apps/core/tests/test_isolation.py` — изменён: AST-чек wall clock в services|models
- `Backend/VAPS/apps/operations/services.py` — изменён: PermissionService читает время через Clock.now()

## Change Log

- 2026-06-11: Story 1.3 реализована полностью (Tasks 1–6, AC 1–3). Темпоральное ядро `core/clock.py` (Clock + override + catchup_plan), модель Watermark + миграция 0014, operations/services.py на Clock, AST-чек wall clock с самопроверкой нетривиальности. `make gate` зелёный, 135 passed. Статус → review.
- 2026-06-11: Code review (Blind Hunter + Edge Case Hunter + Acceptance Auditor): вердикт аудитора PASS, 5 patch-находок исправлены (UTC-нормализация override-datetime, type guard в catchup_plan, усиленный AST-чек: расширенный denylist + резолюция импорт-алиасов + ast.Name-вызовы + dot-boundary, фикс midnight-флака), +2 теста (18 в test_clock.py), 3 находки deferred в deferred-work.md (скоуп 3.12), 8 отклонено как шум. Самопроверка нетривиальности усиленного чека выполнена (3 вида нарушений ловятся). `make gate` зелёный, 137 passed. Статус → done.
