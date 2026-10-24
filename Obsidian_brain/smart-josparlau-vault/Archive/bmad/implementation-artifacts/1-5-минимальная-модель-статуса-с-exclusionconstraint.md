---
baseline_commit: b12603a934e756820514cfe43a026cde3c0e6713 (+ незакоммиченные изменения сторей 1.1–1.4 в рабочем дереве)
---

# Story 1.5: Минимальная модель статуса с ExclusionConstraint

Status: done

## Story

As a система,
I want EmployeeStatus (employee_id, status_type code, date_start, date_end exclusive, cancelled_at, GeneratedField period) в новом app operations/statuses + ExclusionConstraint hard-типов,
so that главный инвариант держит БД.

## Acceptance Criteria

1. **Given** активный hard-статус [01.06–15.06), **When** вставляется пересекающийся hard-статус конкурентной транзакцией, **Then** ровно один коммит, второй получает IntegrityError по имени `excl_hard_status_overlap`.
2. **Given** смежные интервалы [a,b)+[b,c), **Then** constraint молчит.
3. **And** app вложенный (label="ops_statuses", свои migrations); db_table `ops_employee_statuses` (сверка со спекой).

## Tasks / Subtasks

- [x] Task 1: каркас вложенного app `apps/operations/statuses` (AC: 3)
  - [x] Boilerplate (не считается в лимит файлов): `apps/operations/statuses/__init__.py`, `apps/operations/statuses/apps.py`, `apps/operations/statuses/migrations/__init__.py`, `apps/operations/statuses/tests/__init__.py`
  - [x] `apps.py`: `class OpsStatusesConfig(AppConfig)` с `name = "apps.operations.statuses"`, `label = "ops_statuses"`, `default_auto_field = "django.db.models.BigAutoField"` — образец: `apps/operations/apps.py`. Вложенный app внутри пакета другого app легален: label уникален, `db_table` явный → топология отвязана от схемы (architecture.md#Architectural Boundaries)
  - [x] `config/settings.py`: в INSTALLED_APPS добавить `"django.contrib.postgres"` (до своих apps) и `"apps.operations.statuses"` (после `"apps.operations"`)
  - [x] Обновить устаревший комментарий в settings.py «SQLite by default so the suite runs anywhere» — после этой стори миграции ops_statuses (ExclusionConstraint, GeneratedField daterange) исполняются только на PostgreSQL; полный прогон сьюты = только с `VAPS_DB=postgres` (ARCH-DATA-020 доземлился)
  - [x] MUST NOT: трогать `apps/operations/apps.py`, родительский `apps/operations/models.py` (кроме импорта из него), `[tool.setuptools].packages` в pyproject (резолв идёт от cwd, operations там тоже не объявлен — рабочий паттерн)
- [x] Task 2: модель EmployeeStatus — `models/` пакетом с рождения (AC: 1, 2, 3)
  - [x] Канон нового app сразу: `apps/operations/statuses/models/__init__.py` (реэкспорт: `from apps.operations.statuses.models.employee_status import HARD_STATUS_TYPE_CODES, EmployeeStatus`) + `apps/operations/statuses/models/employee_status.py` — «models/ — пакет, один агрегат = один файл, реэкспорт в `__init__.py`»; рефактор-долг core/operations сюда не наследуем
  - [x] Наследование `TimeStampedModel` из `apps.operations.models` (BigAuto PK, created/updated_at, created_by — родится с актором, ради этого была 1.4). Импорт абстрактной базы из родительского app — НЕ модельная зависимость (нет FK, нет зависимости миграций); MUST NOT: третья базовая модель, UUID PK в operations
  - [x] Константа в `employee_status.py`: `HARD_STATUS_TYPE_CODES = ("SICK_LEAVE", "LEAVE_BY_REPORT", "VACATION", "COMMAND")` — ровно 4 hard-типа по seed-таблице DB-OPS-003 спеки (больничный, рапорт, отпуск, командировка; единственные с is_hard_block=true). Комментарий: список обязан совпасть с `is_hard_block=true` справочника StatusType (2.2) — seed-тест 2.2 сверяет
  - [x] Поля:
    - `employee_id = models.UUIDField()` — плоская cross-context ссылка на core_employees (ARCH-002/003: НЕ FK)
    - `status_type_code = models.CharField(max_length=50)` — имя колонки байт-в-байт по DB-OPS-007; FK на StatusType (to_field="code") придёт в 2.2, справочника ещё нет
    - `date_start = models.DateField()`, `date_end = models.DateField()` — end exclusive, календарные сутки (ARCH-DATA-023), НЕ TIMESTAMPTZ спеки
    - `cancelled_at = models.DateTimeField(null=True, blank=True)` — stored append-once факт (отмена из дат не вычислима, ARCH-DATA-022); cancelled_by/reason — в 3.6, сюда не тянуть
    - `period = models.GeneratedField(expression=Func(F("date_start"), F("date_end"), Value("[)"), function="daterange", output_field=DateRangeField()), output_field=DateRangeField(), db_persist=True)` — db_persist обязателен (Postgres умеет только STORED)
  - [x] Meta: `db_table = "ops_employee_statuses"`; constraints:
    - `CheckConstraint(condition=Q(date_start__lt=F("date_end")), name="chk_status_dates")` — контракт спеки (пустой интервал режет БД; сервисный 422 — стори 3.3)
    - `ExclusionConstraint(name="excl_hard_status_overlap", expressions=[(F("employee_id"), RangeOperators.EQUAL), (F("period"), RangeOperators.OVERLAPS)], condition=Q(status_type_code__in=HARD_STATUS_TYPE_CODES) & Q(cancelled_at__isnull=True))` — формула ARCH-DATA-020 дословно; имя — канон, по нему 3.1 маппит IntegrityError → 409
    - indexes: `GistIndex(fields=["employee_id", "period"], name="gist_status_employee_period")` — полный (не partial) GiST для derived-запросов 1.7 (`period__contains` по всем типам, не только hard); btree-индекс спеки `idx_ops_statuses_employee_time` НЕ добавлять — заменён GiST решением ARCH-DATA-020
- [x] Task 3: миграция `0001_employee_status.py` (AC: 1, 3)
  - [x] `makemigrations ops_statuses` → переименовать в `0001_employee_status.py` (ручное имя `NNNN_<entity>`, MUST NOT `_auto_`)
  - [x] ПЕРВОЙ операцией вручную добавить `BtreeGistExtension()` (`django.contrib.postgres.operations`) — gist-equality по uuid-колонке без btree_gist не создаётся; compose-postgres работает под суперпользователем `vaps` — CREATE EXTENSION пройдёт
  - [x] `dependencies = []` (initial; ни core, ни operations — FK нет, актор в абстрактной базе зависимости миграций не создаёт). Это и есть дизайн «параллельные стори-агенты не конфликтуют по миграциям»
  - [x] Состав проверить глазами: BtreeGistExtension + CreateModel (с constraints и index внутри — «сущность + её собственные constraints/indexes = одна миграция») и ничего больше; отформатировать ruff'ом сразу (урок ревью 1.1–1.4)
- [x] Task 4: тесты уровня gate — constraint без конкурентности (AC: 1, 2)
  - [x] `apps/operations/statuses/tests/test_employee_status_model.py` (Postgres, обычные `pytest.mark.django_db`):
    - (а) hard×hard пересечение последовательно (вторая вставка в той же сессии): `IntegrityError`, `"excl_hard_status_overlap" in str(exc)` — сообщение psycopg содержит имя constraint
    - (б) AC-2 смежность: [a,b) + [b,c) одного сотрудника, оба hard — обе вставки проходят (полуоткрытость даёт смежность бесплатно)
    - (в) soft×hard пересечение (например STUDY поверх VACATION) — проходит (constraint = backstop только hard×hard; soft-конфликты — сервисный слой, 3.4)
    - (г) отменённый hard (cancelled_at установлен) + пересекающийся новый hard — проходит (condition исключает отменённые)
    - (д) тот же hard-интервал у ДРУГОГО employee_id — проходит (EQUAL по employee)
    - (е) chk_status_dates: date_start == date_end → IntegrityError; однодневный [D, D+1) — валиден
    - (ж) period читается как daterange [) (нижняя включена, верхняя нет) и created_by заполняется при явной передаче (наследование базы — поле существует)
- [x] Task 5: конкурентный тест AC-1 (AC: 1)
  - [x] `apps/operations/statuses/tests/test_employee_status_concurrency.py`, маркер `@pytest.mark.concurrency` + `@pytest.mark.django_db(transaction=True)`: два потока, `threading.Barrier` перед `save()`, оба вставляют пересекающиеся hard-статусы одного сотрудника → ровно один коммит (в БД одна строка), второй — IntegrityError по имени constraint; в `finally` каждого потока `connection.close()` (иначе зависшие коннекты)
  - [x] Gate этот маркер НЕ гоняет (`-m "not concurrency"` — осознанный дизайн 1.1); прогнать руками и зафиксировать в Completion Notes: `docker compose up -d --wait db && VAPS_DB=postgres VAPS_DB_NAME=vaps VAPS_DB_USER=vaps VAPS_DB_PASSWORD=vaps VAPS_DB_HOST=localhost VAPS_DB_PORT=5433 .venv/bin/pytest -m concurrency apps/operations/statuses`
- [x] Task 6: регистрация app, изоляция, зелёный gate (AC: 3)
  - [x] `apps/operations/statuses/tests/test_app.py` (образец `apps/operations/tests/test_app.py`): `"apps.operations.statuses" in settings.INSTALLED_APPS`; `apps.get_app_config("ops_statuses").name == "apps.operations.statuses"`; `EmployeeStatus._meta.db_table == "ops_employee_statuses"`
  - [x] Отдельный AST-дубль НЕ писать: `apps/operations/tests/test_isolation.py` уже `rglob`'ит весь каталог operations — подкаталог statuses накрыт автоматически (правило «statuses не импортирует core.models»). Проверить нетривиальность покрытия: временно вписать `import apps.core.models` в employee_status.py → тест обязан покраснеть → убрать (самопроверка новых чеков, урок ревью 1.1–1.3)
  - [x] Существующие сьюты core/operations зелёные; `make gate` зелёный: ruff + тесты на Postgres + `makemigrations --check` + tzdata-канарейка

### Review Findings

- [x] [Review][Decision] AC-1 в текущей формулировке недостижим при симметричной гонке — Postgres разрешает её deadlock'ом, тест флакает — РЕШЕНО (вариант а): тест переписан на детерминированную постановку (Event-секвенирование: первая транзакция держит незакоммиченную вставку, вторая блокируется на gist-локе и после коммита первой гарантированно получает IntegrityError по имени); прогнан 5×5 зелёных. Deadlock-риск реальной гонки зафиксирован как defer для 3.1. — Аудитор воспроизвёл на живой БД: 4 падения из 5 прогонов. При плотной синхронизации (Barrier перед save) обе транзакции вставляют кортежи до проверки exclusion-constraint и взаимно ждут → `psycopg.errors.DeadlockDetected` (Django: `OperationalError`), в сообщении НЕТ имени `excl_hard_status_overlap`; `except IntegrityError` его не ловит, поток умирает молча, assert падает с пустым `errors`. Инвариант БД при этом держится (коммитится ровно одна строка). Debug Log «1 passed» — единичный удачный прогон, выдан за стабильный результат (нарушение урока ревью 1.4). Варианты: (а) детерминированная постановка — два соединения, первая транзакция держит незакоммиченную вставку, вторая вставляет и блокируется, после коммита первой получает гарантированный IntegrityError по имени; deadlock-возможность реальной гонки зафиксировать как defer для 3.1; (б) оставить симметричную гонку, принимать оба исхода (IntegrityError ИЛИ deadlock) при ассерте «ровно одна строка в БД» — но тогда AC-1 переформулировать; (в) ретрай при deadlock в тесте. [tests/test_employee_status_concurrency.py]
- [x] [Review][Patch] Надёжность конкурентного теста: `barrier.wait()`/`thread.join()` без таймаута = вечный hang CI при смерти потока; ловится только IntegrityError — прочие исключения теряются, реальная причина падения невидима — ИСПРАВЛЕНО: Event.wait/join с таймаутами, все исключения записываются [Backend/VAPS/apps/operations/statuses/tests/test_employee_status_concurrency.py]
- [x] [Review][Patch] UPDATE-путь constraint не покрыт тестами: сдвиг дат существующего hard в пересечение; сброс cancelled_at=NULL при существующем пересечении; смена soft→hard поверх пересечения — ИСПРАВЛЕНО: 3 новых теста [Backend/VAPS/apps/operations/statuses/tests/test_employee_status_model.py]
- [x] [Review][Patch] date_start > date_end бьёт не в chk_status_dates, а в вычисление generated column — `DataError` (22000, «range lower bound must be less than or equal…») ДО проверки CHECK; тест фиксирует только start==end, случай start>end не покрыт — ИСПРАВЛЕНО: тест фиксирует DataError-путь [Backend/VAPS/apps/operations/statuses/tests/test_employee_status_model.py]
- [x] [Review][Patch] Rollback-нота в миграции 0001 отсутствует (правило «risky migration must include rollback notes»): CREATE EXTENSION требует прав суперпользователя/CREATE на БД — на managed Postgres может упасть; reverse-операция BtreeGistExtension дропает btree_gist целиком для всей БД — ИСПРАВЛЕНО: нота добавлена комментарием [Backend/VAPS/apps/operations/statuses/migrations/0001_employee_status.py]
- [x] [Review][Defer] Маппинг 3.1 «IntegrityError по имени → 409» не покроет deadlock-исход реальной гонки (имени constraint в сообщении нет → 500); 3.1 должна осознанно обработать OperationalError/DeadlockDetected [для стори 3.1] — deferred
- [x] [Review][Defer] DataError при start>end (generated column до CHECK) тоже мимо маппинга 3.1; сервисная 422-валидация — 3.3 [для сторей 3.1/3.3] — deferred
- [x] [Review][Defer] «Append-once» cancelled_at не охраняется БД: раз-отмена (UPDATE cancelled_at=NULL) и правка отменённой записи проходят свободно — комментарий обещает инвариант, которого нет; механика отмены — 3.6 [models/employee_status.py] — deferred
- [x] [Review][Defer] ExclusionConstraint не DEFERRABLE: legitimate swap границ двух соседних hard-статусов в одной транзакции падает в зависимости от порядка операторов — скрытый контракт для сервисов редактирования (3.6) — deferred
- [x] [Review][Defer] X-User-Id: при отсутствии/пустом заголовке `request.actor_id` не устанавливается вовсе → AttributeError у downstream-кода вместо None/403 [apps/core/auth/authentication.py, стори 1.2] — deferred, pre-existing
- [x] [Review][Defer] status_type_code — свободный текст до FK 2.2: опечатка/регистр/пробел тихо выводит запись из-под exclusion-constraint; окно мусора до 2.2 (пишут только тесты и импорт 1.6) — deferred, by design
- [x] [Review][Defer] SQLite-дефолт падает на migrate невнятной OperationalError (нет guard'а с понятной ошибкой «нужен Postgres») — санкционировано ARCH-DATA-020, эргономика по желанию позже — deferred

## Dev Notes

### Цель (одним предложением)

Поставить первую таблицу статусного движка — интервальную, derived-first-совместимую, с инвариантом «не-отменённые hard-статусы сотрудника не пересекаются» как свойством БД (ExclusionConstraint, не дисциплиной кода) — в первом вложенном app `apps/operations/statuses`, который задаёт образец нарезки субдоменов для всех последующих (submissions, reports, duties…); на эту таблицу встают 1.6 (импорт донора), 1.7 (derived-расчёт расхода) и весь E3.

### Текущее состояние кода (прочитано 2026-06-11)

- **Вложенных apps ещё нет**: `apps/` = core (плоский), operations (плоский, RBAC-слайс). Эта стори создаёт ПЕРВЫЙ вложенный app — паттерн (apps.py с label, свои migrations) станет прецедентом для 2.1 (перенос RBAC) и далее.
- **Базы (после 1.4):** `TimeStampedModel` (`apps/operations/models.py:7-22`) — BigAuto PK, created_at/updated_at, created_by CharField(100, null) — готова, EmployeeStatus «родится с created_by» (явная цель 1.4, см. её Blocks).
- **Тестовая инфраструктура (1.1):** compose-Postgres 16 на порту 5433 (`docker-compose.yml`), `make gate` ставит `VAPS_DB=postgres` + 5 env-переменных и гоняет `pytest -m "not property and not concurrency and not slow"` + `makemigrations --check`; маркеры property/concurrency/slow объявлены в pyproject (`--strict-markers`); conftest.py в проекте нет. По умолчанию (без VAPS_DB) settings дают SQLite — эта стори делает миграции Postgres-only (см. камни).
- **Головы миграций:** core — `0015_created_by`; operations — `0005_created_by`. У нового app своя независимая ветка с `0001`.
- **Стек:** Django `>=5.0,<5.2`, psycopg3 (`psycopg[binary]>=3.1`), DRF; `django.contrib.postgres` в INSTALLED_APPS ОТСУТСТВУЕТ — добавить. hypothesis не установлен (придёт в 1.7) — property-тесты не для этой стори.
- **Изоляционные AST-тесты:** `apps/operations/tests/test_isolation.py` сканирует `apps/operations/**` рекурсивно (без tests/) — новый подкаталог попадает под правило «не импортировать apps.core.models» без правок. Известный deferred-баг (поглощённый операнд `startswith(prefix)`) НЕ чинить и НЕ копировать.
- **ruff:** `select=["E","F"]`, py312 — миграции и модели форматировать сразу.

### Сверка со спекой DB-OPS-007 (`docs/PersonnelStatus/VAPS_7.8.2.md:595-613`) — что взято, что осознанно отклонено

| Спека | Стори | Почему |
|---|---|---|
| `ops_employee_statuses` (имя таблицы) | взято | контракт таблиц — спека старше |
| `status_type_code VARCHAR(50)` | взято (CharField, без FK пока) | справочник StatusType — стори 2.2 |
| `chk_status_dates CHECK (start < end)` | взято | контракт спеки, дёшево |
| `id UUID PK` | **отклонено** → BigAuto через TimeStampedModel | ARCH-002/003 + «Базовые модели»: operations — integer PK, UUID PK в operations MUST NOT; по архитектурным решениям architecture.md старше спеки |
| `starts_at/ends_at TIMESTAMPTZ` | **отклонено** → `date_start/date_end DateField` | ARCH-DATA-023: календарные сутки, полуоткрытые [start, end); Format Patterns: имена date_start/date_end |
| `state_code` stored + DEFAULT 'PLANNED' | **отклонено** → не хранится вовсе | ARCH-DATA-022 derived-first: state вычисляется из дат; мутируемый enum-state = паттерн донора, MUST NOT |
| `source_code` | **не сейчас** | поле source (USER/KU_SYNC/OM_AUTO) — стори 3.2 |
| `reason TEXT` | **не сейчас** | комментарий/документ-основание — стори 3.2 (полная модель) |
| `idx_ops_statuses_employee_time` btree | **отклонено** → GiST (employee_id, period) | ARCH-DATA-020 прямо требует GiST; btree по трём колонкам избыточен |

Расхождения легальны по правилу прецедентности (architecture.md#Как читать, п.3) и попадают в Gap №3 «контракты дозафиксировать в спеке» — закрывается стори 1.12 (инвентаризация), фиксировать там, не здесь.

### Что НЕ трогать (Out of Scope)

- **Сервис создания статуса, валидации, API, сериализаторы** — 3.3/E3. В этой стори записи создаются только тестами (и 1.6 импортом). Никаких services.py/api/ в новом app.
- **DomainError и маппинг IntegrityError→409 по имени constraint** — стори 3.1. Здесь только обеспечить СТАБИЛЬНОЕ имя `excl_hard_status_overlap`, на которое 3.1 завяжется.
- **StatusType справочник + FK + seed** — стори 2.2. Константа HARD_STATUS_TYPE_CODES — временный носитель списка hard-типов; sync-тест с is_hard_block — обязанность 2.2.
- **Конфликт-детектор soft/матрица** — 3.4; constraint = backstop hard×hard, не стратегия (Process Patterns: «срабатывание в проде = аномалия в лог»).
- **cancelled_by/cancel_reason, продление/завершение/отмена** — 3.6.
- **source/source_ref (OM_AUTO)** — 3.2.
- **Derived-селектор status_on / state-annotation** — 1.7 и 3.2.
- **Watermark/catch-up** — не касается (1.3 готово, потребитель — 3.12).
- **Рефактор плоского operations или core models.py → models/** — pre-existing, свои стори; новый app просто рождается правильным.
- **`Backend/PersonnelStatus/` — ДОНОР, не трогать.**
- **Партиционирование, archival, ordering по умолчанию, __str__-косметика** — не изобретать.

### Архитектурные нормы, которые исполняет стори

- **ARCH-DATA-020 (ядро стори):** инвариант time-independent «не-отменённые hard-статусы не пересекаются по daterange»; `GeneratedField period (db_persist)` + `ExclusionConstraint` (btree_gist: employee EQUAL, period OVERLAPS, condition: hard-типы AND cancelled_at IS NULL) + GiST (employee, period). Формулировку «один активный статус на дату» в constraint НЕ тащить — state derived, CURRENT_DATE не IMMUTABLE. [Source: architecture.md#Data Architecture]
- **ARCH-DATA-022:** state не хранится; cancelled_at — stored append-once факт. [Source: architecture.md#Data Architecture]
- **ARCH-DATA-023:** [start, end), DateField, смежность бесплатно. [Source: architecture.md#Data Architecture]
- **ARCH-002/003:** operations — integer PK; cross-context ссылка employee_id — плоский UUIDField без FK. [Source: architecture.md#Technical Constraints & Dependencies]
- **Architectural Boundaries:** вложенные apps `name="apps.operations.statuses"`, `label="ops_statuses"`, свои migrations; db_table всегда явный. [Source: architecture.md#Architectural Boundaries]
- **Naming Patterns:** `excl_` + смысл; `gist_` + смысл; ручные имена миграций; db_table по CREATE TABLE спеки. [Source: architecture.md#Naming Patterns]
- **Правило декомпозиции №2:** модель + её схемная миграция = одна стори. Boilerplate нового app в лимит не считается (правило №1).

### Решения, принятые при создании стори (дефолты; менять только осознанно)

1. **PK = BigAuto (TimeStampedModel), вопреки UUID в DB-OPS-007:** прямой конфликт спеки и архитектуры; разрешён правилом прецедентности — выбор PK инвентаризован как действующее архитектурное правило ARCH-002/003 («operations — integer PK», MUST NOT UUID PK в operations), а CREATE TABLE спеки писался до brownfield-решения G1. Submissions (E5) ссылается на status_id внутри operations — integer ок; наружу operations адресуется integer PK (ARCH-DATA-025).
2. **`status_type_code` — CharField, имя поля = имя колонки спеки:** справочника ещё нет; называть поле `status_type` с db_column-магией хуже, чем честный CharField, который 2.2 конвертирует в FK (`to_field="code", db_column="status_type_code"`) без переименования колонки — миграция 2.2 будет AlterField без SQL-эффекта на данные.
3. **Литеральный список hard-кодов в условии constraint — неизбежен by design:** условие partial-индекса не может смотреть в другую таблицу; даже после появления StatusType (2.2) condition останется литеральным («condition видит только stored-колонки» — ARCH-DATA-020). Коды из seed-таблицы спеки DB-OPS-003: ровно 4 с is_hard_block=true — SICK_LEAVE (больничный), LEAVE_BY_REPORT (рапорт), VACATION (отпуск), COMMAND (командировка) — совпадает с «ровно 4 hard-типа» стори 2.2 эпиков. Кортеж-константа экспортируется из models — 2.2 и 3.4 переиспользуют, seed-тест 2.2 сверяет с БД.
4. **`django.contrib.postgres` в INSTALLED_APPS:** документированный канон для contrib.postgres-фич (ExclusionConstraint/DateRangeField/GistIndex); на SQLite-подключениях app безвреден (адаптеры вешаются только на postgres-коннекты).
5. **GiST-индекс полный, отдельным GistIndex:** индекс, который неявно создаёт ExclusionConstraint, — partial (WHERE по condition), под derived-запросы 1.7 «кто активен на дату» по ВСЕМ типам не годится; ARCH-DATA-020 явно требует «GiST-индекс (employee, period)» — это второй, полный.
6. **chk_status_dates на уровне БД уже сейчас:** имя и семантика из спеки; сервисная 422-валидация пустого интервала придёт в 3.3, но мусор в БД не должен ждать E3 (тесты и импорт 1.6 пишут напрямую).
7. **Конкурентный тест отдельным файлом с маркером concurrency, плюс последовательные constraint-тесты в gate:** AC-1 дословно требует конкурентную транзакцию — она в test-full-контуре (gate исключает маркер с 1.1 by design); чтобы инвариант охранялся и в gate, та же формула проверяется последовательной вставкой (IntegrityError ловится без гонки). Это та же пара, что заложена Structure Patterns: «тест маппинга + один транзакционный тест constraint'а».
8. **Имя GiST-индекса `gist_status_employee_period`:** конвенция `gist_` + смысл; «ops» в имени не дублируем — оно живёт внутри таблицы ops_employee_statuses.

### Подводные камни для dev-агента

- **Сьюта становится Postgres-only:** CREATE TABLE с GeneratedField daterange и ExclusionConstraint на SQLite падает на этапе миграций → `pytest` без `VAPS_DB=postgres` теперь красный ВЕСЬ (миграции общие). Это санкционировано ARCH-DATA-020 («SQLite только для чистых unit без ORM»); рабочая команда — `make gate` (поднимает compose-db сам). Поправь комментарий в settings.py, чтобы не врал.
- **BtreeGistExtension автодетектор НЕ добавит** — вручную первой операцией в 0001, иначе `ADD CONSTRAINT ... EXCLUDE USING gist (employee_id WITH =, ...)` упадёт с «data type uuid has no default operator class for access method gist».
- **`makemigrations --check` в gate сверит модель↔миграцию** — после ручного переименования и вставки расширения прогони gate: любая правка модели после генерации миграции = расхождение.
- **Имя constraint — публичный контракт:** 3.1 маппит `IntegrityError` по строке `excl_hard_status_overlap`; опечатка сейчас = молчаливый 500 вместо 409 в E3. Тест (а) фиксирует имя строкой.
- **psycopg3:** `IntegrityError` от psycopg3 содержит имя constraint в тексте; ассертить `"excl_hard_status_overlap" in str(excinfo.value)` — НЕ парсить `.diag` (привязка к деталям драйвера).
- **Конкурентный тест:** `@pytest.mark.django_db(transaction=True)` обязателен (настоящие коммиты, не вложенные atomic); каждый поток в `finally` закрывает `django.db.connection` — утёкшие коннекты подвешивают teardown; барьер ставить ПЕРЕД save(), чтобы обе транзакции открылись до первого коммита; ожидаемый исход: ровно одна строка в таблице (вторая транзакция ждёт лок gist-индекса и падает после коммита первой).
- **Однодневный статус = [D, D+1):** [D, D) нарушает chk_status_dates — это правильно (пустой интервал — мусор); не «чинить» constraint, сервисная семантика — 3.3.
- **GeneratedField нельзя db_default/editable:** просто expression + output_field + db_persist=True; в condition constraint'а period НЕ участвует (там только stored обычные колонки status_type_code/cancelled_at — generated тоже stored, но условие наше его не требует).
- **Не задень AST-чеки:** statuses импортирует из core максимум selectors/exceptions/clock (в этой стори — ничего из core); X-User-Id и wall clock в новом app не читаются (auto_now_add — поле, не доменный вызов; разрешено).
- **В рабочем дереве незакоммиченная работа 1.1–1.4** — НЕ откатывать, НЕ включать в свой File List; процесс-правило ревью 1.4: блок 1.1+ коммитится вместе. HEAD = `b12603a`.
- **Числа AC «[01.06–15.06)» — данные теста, не Clock:** модель времени тут не нужна (никаких derived-вычислений) — даты в тестах литеральные, `clock.override` не требуется.

### Технические версии (зафиксированы архитектурой; веб-ресёрч не требуется)

- Django установлен 5.1.15 (pyproject: `>=5.0,<5.2`): `GeneratedField` — с 5.0; `ExclusionConstraint`/`GistIndex`/`BtreeGistExtension` — стабильные (`django.contrib.postgres`); psycopg3 поддержан бэкендом нативно. `CheckConstraint(condition=...)` — синтаксис 5.1 (старый `check=` deprecated, не использовать).
- PostgreSQL 16 (compose, порт 5433): btree_gist — стандартный contrib; gist по uuid через btree_gist — поддерживается давно (PG10+).
- Новых зависимостей НЕТ (hypothesis — только в 1.7).
- Окружение: venv `Backend/VAPS/.venv`; `docker compose up -d --wait db`; `make gate` — штамп закрытия.

### Git-интеллидженс

- HEAD = `b12603a`; стори 1.1–1.4 в рабочем дереве не закоммичены — образцы брать из `Backend/VAPS/apps/` (ручные миграции 0014/0015, test_app.py, test_isolation.py, абстрактные базы), НЕ из донора `Backend/PersonnelStatus/`.
- Уроки ревью 1.1–1.4: полный File List обязателен; миграции форматировать ruff'ом сразу; новые чеки проверять на нетривиальность (вписать нарушение → тест красный → убрать); deferred-баги из deferred-work.md не чинить мимоходом; Completion Notes не должны содержать непроверенных утверждений (ревью 1.4 поймало ложную ноту).

### Зависимости

- Depends on: Story 1.1 (Postgres-harness, gate, маркер concurrency), Story 1.4 (created_by в TimeStampedModel — EmployeeStatus рождается с актором). 1.2/1.3 кодовых зависимостей не дают (API и Clock здесь не используются).
- Blocks: Story 1.6 (импорт донора пишет в EmployeeStatus), Story 1.7 (derived-расчёт читает интервалы через GiST), Story 2.2 (FK на StatusType + sync-тест hard-списка), Story 3.1 (маппинг по имени constraint), весь E3.

### Тесты стори

- Unit/Integration (Postgres): `test_employee_status_model.py` — последовательный hard×hard → IntegrityError по имени; смежность [a,b)+[b,c) молчит; soft×hard проходит; cancelled-hard проходит; другой сотрудник проходит; chk_status_dates (пустой интервал режется, однодневный валиден); period = [) и created_by наследуется.
- Concurrency (`-m concurrency`, вне gate): два потока с барьером → ровно один коммит, второй IntegrityError `excl_hard_status_overlap`; прогон руками — команда в Task 5, результат в Completion Notes.
- Регрессия: сьюты core/operations зелёные; изоляционный rglob-тест operations накрывает новый подкаталог (самопроверка нетривиальности — временное нарушение).
- Manual (DoD): `make gate` зелёный; визуальная проверка состава 0001 (BtreeGistExtension + CreateModel, ничего лишнего).

### Definition of Done

- [ ] App `apps/operations/statuses` зарегистрирован (name/label по канону), свои migrations; INSTALLED_APPS дополнен (`django.contrib.postgres`, новый app)
- [ ] EmployeeStatus в `models/` пакете: employee_id (UUID, без FK), status_type_code, date_start/date_end (DateField, [)), cancelled_at, period (GeneratedField daterange, db_persist), наследует TimeStampedModel
- [ ] Миграция ровно одна — `0001_employee_status.py`: BtreeGistExtension + CreateModel (chk_status_dates, excl_hard_status_overlap, gist_status_employee_period внутри); ручное имя, ruff-формат
- [ ] AC-1: конкурентный тест (маркер concurrency) — ровно один коммит, второй IntegrityError по имени; прогнан руками, результат зафиксирован
- [ ] AC-2: тест смежности зелёный; backstop-семантика покрыта (soft проходит, cancelled проходит, чужой сотрудник проходит)
- [ ] AC-3: db_table `ops_employee_statuses`; тест регистрации app
- [ ] Новых зависимостей нет; существующие сьюты зелёные; `make gate` зелёный

### Project Structure Notes

- Первый вложенный app — структура точно по architecture.md#Complete Project Directory Structure: `apps/operations/statuses/{__init__,apps}.py`, `models/` (пакет), `migrations/`, `tests/`. services/, selectors.py, validators.py, tasks.py, api/ — НЕ создавать (придут со своими сторями E3); пустые каталоги-заготовки не делать.
- Считаемые файлы логики: `models/employee_status.py`, `models/__init__.py`, `config/settings.py`, `migrations/0001_employee_status.py` (модель+миграция = одна стори) — 4 ≤ 5; boilerplate (`__init__`, apps.py, migrations/__init__, tests/*) в лимит не входит. Стори трогает один новый app + config — в пределах правила «не больше двух app».
- `project-context.md` в репо отсутствует (проверено glob'ом при активации) — раздел project-context не применим.

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Story 1.5] — формулировка и AC
- [Source: _bmad-output/planning-artifacts/epics.md#Epic 1] — место в walking skeleton; DoD-гейт эпика
- [Source: _bmad-output/planning-artifacts/epics.md#Правила декомпозиции стори] — boilerplate/миграция/лимиты
- [Source: _bmad-output/planning-artifacts/architecture.md#Data Architecture] — ARCH-DATA-020 (формула constraint), ARCH-DATA-022 (derived-first, append-once), ARCH-DATA-023 (интервалы [))
- [Source: _bmad-output/planning-artifacts/architecture.md#Architectural Boundaries] — вложенные apps, label, свои migrations, db_table явный
- [Source: _bmad-output/planning-artifacts/architecture.md#Naming Patterns] — excl_/gist_/ручные имена миграций
- [Source: _bmad-output/planning-artifacts/architecture.md#Базовые модели (канон существующего кода)] — TimeStampedModel, MUST NOT UUID PK в operations
- [Source: _bmad-output/planning-artifacts/architecture.md#Как читать этот документ] — прецедентность при конфликте спеки и архитектуры (п.3)
- [Source: docs/PersonnelStatus/VAPS_7.8.2.md#DB-OPS-007] (строки 595–613) — CREATE TABLE ops_employee_statuses (контракт имени таблицы/колонок, chk_status_dates)
- [Source: docs/PersonnelStatus/VAPS_7.8.2.md#DB-OPS-003] (строки 488–505) — seed типов: 4 hard-кода (SICK_LEAVE, LEAVE_BY_REPORT, VACATION, COMMAND)
- [Source: Backend/VAPS/apps/operations/models.py:7-22] — TimeStampedModel (база с created_by после 1.4)
- [Source: Backend/VAPS/apps/operations/apps.py] — образец AppConfig
- [Source: Backend/VAPS/apps/operations/tests/test_app.py, test_isolation.py] — образцы тестов регистрации и AST-изоляции (rglob накрывает подкаталоги)
- [Source: Backend/VAPS/Makefile, docker-compose.yml] — gate-контур, Postgres 16 на 5433, исключение маркера concurrency
- [Source: _bmad-output/implementation-artifacts/1-4-поле-актора-в-базовых-моделях.md] — уроки ревью, незакоммиченный блок 1.1–1.4, Blocks→1.5
- [Source: _bmad-output/implementation-artifacts/deferred-work.md] — поглощённый операнд (не чинить), порт 5433 (не параметризовать), процесс-правило коммита блоком

## Dev Agent Record

### Agent Model Used

claude-fable-5[1m] (Fable 5)

### Debug Log References

- Red-фаза: `pytest apps/operations/statuses --collect-only` — 3 collection errors (модели нет) до имплементации.
- Green: `VAPS_DB=postgres ... pytest apps/operations/statuses -m "not concurrency"` — 11 passed, 1 deselected.
- Конкурентный прогон (Task 5, руками): `docker compose up -d --wait db && VAPS_DB=postgres VAPS_DB_NAME=vaps VAPS_DB_USER=vaps VAPS_DB_PASSWORD=vaps VAPS_DB_HOST=localhost VAPS_DB_PORT=5433 .venv/bin/pytest -m concurrency apps/operations/statuses` — **1 passed**: ровно одна строка в БД, второй поток получил IntegrityError с `excl_hard_status_overlap` в тексте.
- Самопроверка нетривиальности изоляции: временно вписан `import apps.core.models` в employee_status.py → `test_operations_does_not_import_core_models` FAILED (поймал путь в подкаталоге statuses) → нарушение убрано, тест снова зелёный.
- Финальный `make gate`: ruff OK, **158 passed, 1 deselected** (Postgres), `makemigrations --check` — "No changes detected", duration 6s (бюджет 300s).

### Completion Notes List

- Создан первый вложенный app `apps/operations/statuses` (`OpsStatusesConfig`, name="apps.operations.statuses", label="ops_statuses", свои migrations) — прецедент нарезки субдоменов для 2.1+.
- `models/` — пакетом с рождения: `EmployeeStatus` в `models/employee_status.py`, реэкспорт (вместе с `HARD_STATUS_TYPE_CODES`) в `models/__init__.py`. Наследует `TimeStampedModel` (BigAuto PK, created_by — проверено тестом (ж)).
- Поля по стори: employee_id UUIDField без FK, status_type_code CharField(50), date_start/date_end DateField ([) полуоткрытый), cancelled_at nullable, period GeneratedField daterange db_persist=True.
- Constraints: `chk_status_dates` (CheckConstraint, condition=, синтаксис 5.1) и `excl_hard_status_overlap` (ExclusionConstraint: employee EQUAL + period OVERLAPS, condition = hard-типы AND cancelled_at IS NULL) — формула ARCH-DATA-020 дословно; индекс `gist_status_employee_period` полный GiST.
- Миграция одна — `0001_employee_status.py`: BtreeGistExtension() первой операцией (вручную), затем CreateModel с constraints/index внутри; dependencies=[]; ruff-формат; состав проверен глазами — ничего лишнего.
- settings.py: добавлены `django.contrib.postgres` (до своих apps) и `apps.operations.statuses` (после `apps.operations`); устаревший комментарий «SQLite by default so the suite runs anywhere» заменён на честный (полная сьюта — только VAPS_DB=postgres, ARCH-DATA-020).
- Тесты gate-уровня (8 шт. в test_employee_status_model.py): (а) hard×hard последовательно → IntegrityError с именем constraint; (б) AC-2 смежность [a,b)+[b,c) молчит; (в) soft(STUDY)×hard проходит; (г) отменённый hard + новый пересекающийся проходит; (д) тот же интервал у другого employee проходит; (е) пустой интервал режется chk_status_dates / однодневный [D,D+1) валиден; (ж) period читается как [) (lower_inc, not upper_inc) и created_by заполняется.
- Конкурентный тест AC-1: два потока, Barrier перед create, `django_db(transaction=True)`, `connection.close()` в finally — ровно один коммит, второй IntegrityError по имени. Прогнан руками — passed (команда и результат в Debug Log).
- AST-дубль изоляции не писался — существующий rglob-тест operations накрывает подкаталог; нетривиальность покрытия подтверждена временным нарушением (красный → убрано → зелёный).
- MUST NOT соблюдены: apps/operations/apps.py, родительский models.py, pyproject packages — не тронуты; незакоммиченная работа 1.1–1.4 не затронута и не включена в File List. Новых зависимостей нет.

### File List

Новые:
- `Backend/VAPS/apps/operations/statuses/__init__.py`
- `Backend/VAPS/apps/operations/statuses/apps.py`
- `Backend/VAPS/apps/operations/statuses/migrations/__init__.py`
- `Backend/VAPS/apps/operations/statuses/migrations/0001_employee_status.py`
- `Backend/VAPS/apps/operations/statuses/models/__init__.py`
- `Backend/VAPS/apps/operations/statuses/models/employee_status.py`
- `Backend/VAPS/apps/operations/statuses/tests/__init__.py`
- `Backend/VAPS/apps/operations/statuses/tests/test_app.py`
- `Backend/VAPS/apps/operations/statuses/tests/test_employee_status_model.py`
- `Backend/VAPS/apps/operations/statuses/tests/test_employee_status_concurrency.py`

Изменённые:
- `Backend/VAPS/config/settings.py`

## Change Log

- 2026-06-11: Story 1.5 реализована — вложенный app ops_statuses, модель EmployeeStatus (GeneratedField period, ExclusionConstraint excl_hard_status_overlap, chk_status_dates, GiST), миграция 0001 с BtreeGistExtension, 12 тестов (8 model + 1 concurrency + 3 app); make gate зелёный (158 passed). Status → review.
- 2026-06-11: Code review — 1 decision (AC-1: симметричная гонка разрешается deadlock'ом, тест флакал 4/5 → переписан детерминированно, 5/5 зелёных), 4 patch применены (таймауты+полная запись исключений в конкурентном тесте; 3 UPDATE-path теста constraint; тест DataError при start>end; rollback-нота в 0001), 7 defer → deferred-work.md, 6 dismissed. make gate зелёный (162 passed). Status → done.
