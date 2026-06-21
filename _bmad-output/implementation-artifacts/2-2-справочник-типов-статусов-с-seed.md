---
baseline_commit: 1b65f54f485a0068c09540020f953e99ce716d1c
---
# Story 2.2: Справочник типов статусов с seed

Status: review

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a администратор,
I want модель `StatusType` (натуральный `code`-PK, `name`, `is_hard_block`, `priority`, `report_column_code`, флаги учёта + `color`/`restricts_editing`) во вложенном app `apps.operations.statuses` (label `ops_statuses`) + идемпотентный management-command `seed_statuses`, материализующий канон **DB-OPS-003** (16 кодов из `strength_report.STATUS_TYPE_PRIORITIES` + `PENDING_CLARIFICATION`),
so that статусный движок и расход опираются на справочник-таблицу (FK-цель `to_field="code"`), а закодированные в `strength_report.py`/`employee_status.py` константы получают свой источник истины с автоматической сверкой.

## Acceptance Criteria

1. **(AC-1) Модель `StatusType` создана в `ops_statuses`.** **Given** app `ops_statuses` с моделью `EmployeeStatus`, **When** применяю миграцию `0002_status_type`, **Then** существует таблица `ops_status_types` с `code` (PK, VARCHAR), `name`, `is_hard_block`, `priority`, `report_column_code`, `counts_in_list`, `counts_in_staff`, `is_ku_owned`, `restricts_editing`, `color`, `is_active`; `makemigrations --check --dry-run` чист; `StatusType` реэкспортирован из `models/__init__.py`; `db_table == "ops_status_types"`.
2. **(AC-2) Идемпотентный seed по спеке.** **Given** пустая БД, **When** `python manage.py seed_statuses`, **Then** созданы все 17 строк (16 кодов DB-OPS-003 + `PENDING_CLARIFICATION`) с `priority`/`report_column_code` точно как в `strength_report.STATUS_TYPE_PRIORITIES`/`REPORT_COLUMN_BY_CODE`; повторный запуск идемпотентен (счётчики не растут, без дублей/ошибок).
3. **(AC-3) Ровно 4 hard-типа = канон.** **And** `StatusType.objects.filter(is_hard_block=True)` возвращает ровно `{SICK_LEAVE, LEAVE_BY_REPORT, VACATION, COMMAND}` — побайтно равно `HARD_STATUS_TYPE_CODES` (`employee_status.py:11`). (AC эпика «отпуск/больничный/командировка/рапорт» = эти 4 кода; «рапорт» = `LEAVE_BY_REPORT`, НЕ отдельный тип.)
4. **(AC-4) Автосверка с закодированными константами.** **And** тест кросс-проверяет, что seeded-набор кодов == `set(STATUS_TYPE_PRIORITIES)` ∪ `{PENDING_CLARIFICATION}`, priority/column совпадают, `counts_in_staff=False` ровно у `ATTACHED`, `restricts_editing=True` ровно у `DETACHED` — чтобы рассинхрон справочника и `strength_report.py` ловился красным тестом.

## Tasks / Subtasks

- [x] **Task 1. Модель `StatusType`** (AC: 1) — зеркалит code-PK паттерн `Role`/`Permission`
  - [x] `apps/operations/statuses/models/status_type.py`: `class StatusType(models.Model)` (плоский `models.Model`, НЕ `TimeStampedModel` — как `Role`/`Permission`, это статичный справочник). Поля: `code = CharField(primary_key=True, max_length=50)`, `name = CharField(max_length=100)`, `is_hard_block = BooleanField(default=False)`, `priority = IntegerField()`, `report_column_code = CharField(max_length=30)`, `counts_in_list = BooleanField(default=True)`, `counts_in_staff = BooleanField(default=True)`, `is_ku_owned = BooleanField(default=False)`, `restricts_editing = BooleanField(default=False)`, `color = CharField(max_length=20, blank=True, default="")`, `is_active = BooleanField(default=True)`
  - [x] `Meta`: `db_table = "ops_status_types"`, `ordering = ["priority"]`, `verbose_name = "Тип статуса"`, `verbose_name_plural = "Типы статусов"`. `__str__` → `self.code`
  - [x] Реэкспорт в `apps/operations/statuses/models/__init__.py`: добавить `StatusType` в импорт и `__all__` (рядом с `EmployeeStatus`, `HARD_STATUS_TYPE_CODES`) — реэкспорт = контракт [Source: architecture.md:596]
- [x] **Task 2. Миграция `ops_statuses/0002_status_type.py`** (AC: 1) — ручное описательное имя (как `0001_employee_status.py`)
  - [x] `python manage.py makemigrations ops_statuses` → переименовать авто-файл в `0002_status_type.py`, `dependencies = [("ops_statuses", "0001_employee_status")]`, обычный `CreateModel(StatusType)` (НЕ SDAS — таблицы ещё нет, DDL нужен)
  - [x] Убедиться: `makemigrations --check --dry-run` после = «No changes detected»
- [x] **Task 3. Каркас management-команды в `ops_statuses`** (AC: 2) — директории ещё НЕТ
  - [x] Создать `apps/operations/statuses/management/__init__.py` (пустой)
  - [x] Создать `apps/operations/statuses/management/commands/__init__.py` (пустой). Django найдёт команду: `apps.operations.statuses` уже в `INSTALLED_APPS` [Source: config/settings.py:17]; прецедент вложенных команд — `apps/migration_legacy/management/commands/`
- [x] **Task 4. Команда `seed_statuses`** (AC: 2, 3) — зеркалит `seed_operations.py`
  - [x] `apps/operations/statuses/management/commands/seed_statuses.py`: модульная константа `STATUS_TYPES` (список dict со всеми полями — см. Dev Notes → «Seed-таблица»); `class Command(BaseCommand)`, `help="Seed status type reference catalog (idempotent)."`; в `handle` цикл `StatusType.objects.update_or_create(code=row["code"], defaults={...})`; финальная строка `self.stdout.write(self.style.SUCCESS(f"Seeded {n} status types"))`
  - [x] Значения `priority`/`report_column_code` НЕ выдумывать — брать дословно из `strength_report.STATUS_TYPE_PRIORITIES`/`REPORT_COLUMN_BY_CODE`. `is_hard_block=True` ровно для 4 кодов из `HARD_STATUS_TYPE_CODES`. `counts_in_staff=False` ровно для `ATTACHED`. `restricts_editing=True` ровно для `DETACHED` (FR-16). `color=""` для всех (палитра отложена — см. Dev Notes → «Гэп: color»)
- [x] **Task 5. Тест app-инвариантов** (AC: 1) — дополнить существующий `tests/test_app.py`
  - [x] Добавить `StatusType._meta.db_table == "ops_status_types"` (можно перейти на параметризованный `EXPECTED_DB_TABLES`-стиль из `rbac/tests/test_app.py:11-34`)
- [x] **Task 6. Тест seed + автосверка** (AC: 2, 3, 4) — зеркалит `tests/test_seed.py`
  - [x] `apps/operations/statuses/tests/test_seed_statuses.py`, `pytestmark = pytest.mark.django_db`. Кейсы: (а) `call_command("seed_statuses")` → `StatusType.objects.count() == 17`, набор кодов точный; (б) идемпотентность — вызвать дважды, count стабилен; (в) AC-3: `set(...filter(is_hard_block=True)...values_list("code", flat=True)) == set(HARD_STATUS_TYPE_CODES)` и `len == 4`; (г) AC-4 кросс-сверка с `strength_report`: для каждого кода `priority`/`report_column_code` равны константам, `counts_in_staff=False` только у `ATTACHED`, `restricts_editing=True` только у `DETACHED`, и `{c for c in seeded if c != "PENDING_CLARIFICATION"} == set(STATUS_TYPE_PRIORITIES)`
- [x] **Task 7. Верификация** (AC: 1–4)
  - [x] `make gate` зелёный: `ruff check .` (E,F) + `pytest -m "not property and not concurrency and not slow"` + `makemigrations --check --dry-run` (Postgres :5433, бюджет < 300 c) [Source: Makefile:31-54]
  - [x] Ручной прогон `seed_statuses` дважды на чистой БД — счётчик 17, без дублей

## Dev Notes

### Что это за стори (суть и риск)
Низкорисковая добавка справочной таблицы в **существующий** app `ops_statuses`: одна модель `StatusType` + одна обычная `CreateModel`-миграция + idempotent seed + тесты. **НЕ** SDAS-перенос (в отличие от 2.1) — таблицы нет, нужен нормальный DDL. Главная ценность — дать источник истины уже закодированным в `strength_report.py`/`employee_status.py` константам и закрепить автосверку, чтобы рассинхрон ловился тестом.

### Источник истины: целевая кодовая база `Backend/VAPS`
Работаем в `Backend/VAPS/`. Донор `Backend/PersonnelStatus/` НЕ канон: его `StatusType` TextChoices (`statuses/models.py:11-23`) — другие slug'и (`vacation`/`sick_leave`/`business_trip`), а его seed справочников (`dictionaries/migrations/0002_seed_reference_data.py:12`) — лишь 3 плейсхолдера. VAPS использует UPPERCASE-коды DB-OPS-003. [Source: project memory `project_vaps_architecture.md`]

### Канон данных уже В КОДЕ (главный анти-reinvent сигнал)
Кодовая база **явно ждёт 2.2** и несёт данные дословно — НЕ выдумывать заново:
- `apps/operations/statuses/models/employee_status.py:9-11` — `HARD_STATUS_TYPE_CODES = ("SICK_LEAVE","LEAVE_BY_REPORT","VACATION","COMMAND")`; комментарий: «the seed test in story 2.2 cross-checks this tuple».
- `apps/operations/statuses/models/employee_status.py:17-18` — `status_type_code = CharField(max_length=50)` (свободный текст); комментарий: «FK to StatusType (to_field="code") arrives with the dictionary in 2.2».
- `apps/operations/statuses/services/strength_report.py:18-58` — `STATUS_TYPE_PRIORITIES` (16 кодов), `REPORT_COLUMN_BY_CODE`, `ATTACHED_CODE = "ATTACHED"`. Комментарий `:13-17`: эти таблицы «must stay in sync with the StatusType rows — the seed test in story 2.2 cross-checks both tables»; «OTHER_ABSENCE (38/OTHER) … to be fixed in 1.12 and seed 2.2».
- Канон-спека таблицы/строк: DB-OPS-003 `docs/PersonnelStatus/VAPS_7.8.2.md:488-506`; FK `ops_employee_statuses.status_type_code → ops_status_types(code) ON DELETE RESTRICT` `VAPS_7.8.2.md:600`.

> Дев-агенту: импортируй константы из `strength_report`/`employee_status` в тест для сверки. В САМ seed значения можно прописать литералами (читаемость + независимость от рефактора сервиса), но тест ДОЛЖЕН сверить их с `STATUS_TYPE_PRIORITIES`/`REPORT_COLUMN_BY_CODE`/`HARD_STATUS_TYPE_CODES` — это и есть AC-4.

### Seed-таблица (17 строк) — дословно
16 кодов из `STATUS_TYPE_PRIORITIES` (порядок = по priority) + `PENDING_CLARIFICATION`. `is_hard`=is_hard_block, `staff`=counts_in_staff, `ku`=is_ku_owned (DB-OPS-003: true для абсанс-типов 10–50, false для оперативных 60–999), `edit`=restricts_editing.

| code | name (RU) | priority | column | is_hard | staff | list | ku | edit |
|---|---|--:|---|:-:|:-:|:-:|:-:|:-:|
| SICK_LEAVE | На больничном | 10 | SICK | ✅ | ✅ | ✅ | ✅ | — |
| LEAVE_BY_REPORT | Отпуск по рапорту | 15 | VACATION | ✅ | ✅ | ✅ | ✅ | — |
| VACATION | В отпуске | 20 | VACATION | ✅ | ✅ | ✅ | ✅ | — |
| COMMAND | В командировке | 30 | COMMAND | ✅ | ✅ | ✅ | ✅ | — |
| STUDY | Учёба | 32 | TRAINING | — | ✅ | ✅ | ✅ | — |
| COMPETITION | Соревнования | 34 | TRAINING | — | ✅ | ✅ | ✅ | — |
| CONFERENCE | Конференция | 36 | TRAINING | — | ✅ | ✅ | ✅ | — |
| OTHER_ABSENCE | Иное отсутствие | 38 | OTHER | — | ✅ | ✅ | ✅ | — |
| DETACHED | Откомандирован | 40 | DETACHED | — | ✅ | ✅ | ✅ | ✅ |
| ATTACHED | Прикомандирован | 50 | ATTACHED | — | ❌ | ✅ | ✅ | — |
| REST_AFTER_DUTY | После дежурства | 60 | AFTER_DUTY | — | ✅ | ✅ | — | — |
| BEFORE_DUTY | Перед дежурством | 65 | BEFORE_DUTY | — | ✅ | ✅ | — | — |
| DUTY | На дежурстве | 70 | ON_DUTY | — | ✅ | ✅ | — | — |
| GEV | Группа экстренного выезда | 75 | ON_DUTY | — | ✅ | ✅ | — | — |
| EVENT_ASSIGNMENT | Привлечён на мероприятие | 80 | IN_SERVICE | — | ✅ | ✅ | — | — |
| IN_SERVICE | В строю | 999 | IN_SERVICE | — | ✅ | ✅ | — | — |
| PENDING_CLARIFICATION | Уточняется | 990 | IN_SERVICE | — | ✅ | ✅ | — | — |

`color` = `""` у всех (см. гэп ниже). Имена RU — кросс-walk из `prd.md:89` + глоссарий `architecture.md:369-381`; имена оперативных типов (GEV/EVENT_ASSIGNMENT/PENDING_CLARIFICATION) — рабочие, не из verbatim-спеки (помечено как story-level).

### Решённые гэпы (нет канона — зафиксированы в стори, подтвердить у Bratan в конце)
- **`color`/цвет.** Названо в эпике (`epics.md:405`) и FR-39 (`prd.md:166`), но **отсутствует** в DB-OPS-003 DDL, в коде и у донора. Цвет — UI-концепт светофора/календаря (`prd.md:54,161`), не атрибут строки в текущей спеке. **Решение:** колонку `color` создаём (контракт FR-39 + без будущей миграции), но в seed оставляем `""` — конкретную палитру отложить до UI-стори. [Гэп подтвердить]
- **`ограничивает_редактирование`/restricts_editing.** Нет колонки в канон-DDL; поведение задано лишь для `Откомандирован` — FR-16 (`prd.md:110`, `epics.md:47`): откомандированный лишается права редактирования статусов. **Решение:** `restricts_editing` BooleanField, `True` ровно у `DETACHED`. [Гэп подтвердить]
- **`PENDING_CLARIFICATION` атрибуты.** Архрешение (`epics.md:37`, `architecture.md:48,375`); поведение — жёлтый светофор + своя строка расхода (AR-11 `epics.md:113`, `epics.md:552`), но priority/column/counts НЕ заданы. **Решение (provisional):** `priority=990`, `column=IN_SERVICE`, counts=true/true. [Гэп подтвердить — это влияет на сортировку/колонку расхода в E3]
- **Состав «12».** Verbatim-списка из 12 кодов нет нигде. `prd.md:89` даёт 12 RU-имён (вкл. IN_SERVICE, без GEV); DB-OPS-003 — 15+IN_SERVICE. **Решение:** «12 базовых» — это документ-ярлык, а не число строк; сидим весь набор DB-OPS-003 (16 с учётом `OTHER_ABSENCE`) + `PENDING_CLARIFICATION` = 17. [Подтвердить число 17 в AC-2]
- **`OTHER_ABSENCE`.** В коде есть (`strength_report.py:25`), в донор-seed не было — `strength_report.py:16` прямо помечает «to be … accounted for in seed 2.2». Включаем.

### Прецеденты для копирования
- **Code-PK справочник:** `Role`/`Permission` (`apps/operations/rbac/models.py:8-18,100-110`) — `code = CharField(primary_key=True)`, плоский `models.Model`, явный `db_table`, `__str__→code`. `StatusType` следует этому, НЕ `TimeStampedModel`.
- **Seed-команда:** `apps/operations/management/commands/seed_operations.py` — модульные константы (`PERMISSIONS`/`ROLES`), `update_or_create(code=…, defaults={…})`, одна `SUCCESS`-строка, БЕЗ `@transaction.atomic` (прецедент без транзакции; можно добавить — не обязательно).
- **Seed-тест:** `apps/operations/tests/test_seed.py` — `pytestmark = pytest.mark.django_db`, точные `set(...values_list...)`, идемпотентность через двойной `call_command` + сверка count.
- **App-тест:** `apps/operations/statuses/tests/test_app.py:7-16` (installed/label/db_table) и параметризованный `rbac/tests/test_app.py:11-34` (`EXPECTED_DB_TABLES`).
- **Миграция:** `ops_statuses/0001_employee_status.py` — ручное имя, `initial=True`; новая — `0002_status_type.py`, dep на `0001_employee_status`.

### Архитектурные правила и границы (соблюсти)
- **`code` = natural VARCHAR PK** (не int): EmployeeStatus ссылается `to_field="code"`, а условие `ExclusionConstraint` видит только stored-колонки [Source: architecture.md:282, 420].
- **`is_hard_block` — stored-дискриминатор:** кормит условие `excl_hard_status_overlap` + ветку 422(hard)/409+override(soft) конфликт-детектора (декларативные данные, не if-ы) [Source: architecture.md:48,106,282,432].
- **Живёт в `ops_statuses`, НЕ в core, НЕ в новом app:** справочник — FK-цель `EmployeeStatus` и поставщик hard/soft, потребители (constraint + детектор) в этом же app [Source: architecture.md:518-520,605]. (Есть формальное натяжение с маппингом FR-39 «справочники→core» `architecture.md:616`; разрешаем явно: статус-тип co-located со своим потребителем — `ops_statuses`.)
- **Вложенный app — конвенции 2.1:** свои `migrations/`, явный `db_table`, реэкспорт в `__init__.py` [Source: architecture.md:581,596].
- **Admin-редактируемый справочник:** `StatusType` — «справочник без бизнес-инвариантов», его регистрация в Admin РАЗРЕШЕНА (в отличие от `EmployeeStatus`); сама регистрация — стори 2.8, не здесь [Source: architecture.md:467-468]. `is_active`-деактивация вместо hard delete [Source: architecture.md:468].
- **Без wall-clock в домене:** плоский `models.Model`, никаких `auto_now`/`timezone.now`-дефолтов в бизнес-полях (для статичного справочника неактуально) [Source: architecture.md:300,429].
- **Gate:** `makemigrations --check` + registries-проверка под < 5 мин [Source: architecture.md:636; Makefile:31-54].

### Project Structure Notes
- **Variance (осознанный):** стори трогает 8 файлов (6 create + 2 modify) — выше эвристики «≤5», но это атомарный минимум для «модель + миграция + каркас команды + seed + тесты»; все правки — в границах одного app `ops_statuses`, одна ответственность (справочник типов). Каркас `management/__init__.py` + `commands/__init__.py` — пустые обязательные файлы.
- **Команда `seed_statuses` — во вложенном app** (`apps/operations/statuses/management/commands/`), НЕ в родителе: co-location с моделью; прецедент вложенных команд — `apps/migration_legacy/management/commands/`.

## Out of Scope (не трогать)

- **FK-конверсия `EmployeeStatus.status_type_code` (CharField → ForeignKey(to_field="code")).** Комментарий `employee_status.py:17` обещает FK «в 2.2», но реальная конверсия рискованна: backfill, порядок миграции против `excl_hard_status_overlap` (которое читает `status_type_code`), `strength_report.resolve_status` падает на неизвестных кодах by design. 2.2 даёт справочник+seed; `status_type_code` остаётся свободным текстом, валидируемым справочником/seed. FK — отдельная стори.
- Изменения `EmployeeStatus`, его констрейнтов/`HARD_STATUS_TYPE_CODES`, `strength_report.py` (только читаем для сверки).
- Регистрация в Django Admin (стори 2.8), RBAC-матрица (2.9), конкретная цвет-палитра (UI-стори), бизнес-семантика `PENDING_CLARIFICATION`/конфликт-детектор (E3).
- Донор `Backend/PersonnelStatus/`.

## Dependencies

- Depends on Story 1.5 (`ops_statuses` как вложенный app + `EmployeeStatus`/`HARD_STATUS_TYPE_CODES`) — done.
- Depends on Story 1.7/1.8 (`strength_report.STATUS_TYPE_PRIORITIES`/`REPORT_COLUMN_BY_CODE` — источник seed-значений) — done.
- **Независима** от незакоммиченной 2.1 (RBAC relocation, app `ops_rbac`) — 2.2 живёт в `ops_statuses`, общих файлов нет; baseline = HEAD `1b65f54`.
- Blocks (soft): будущая FK-стори `EmployeeStatus → StatusType`; E3 конфликт-детектор читает `is_hard_block`/`priority` из справочника.

## Tests

- **Unit / app-инварианты** (`tests/test_app.py`): `StatusType._meta.db_table == "ops_status_types"`.
- **Seed** (`tests/test_seed_statuses.py`): полнота (17 строк, точный набор кодов), идемпотентность (двойной `call_command`, count стабилен), AC-3 (ровно 4 hard == `HARD_STATUS_TYPE_CODES`), AC-4 кросс-сверка priority/column/counts/edit с `strength_report`/`HARD_STATUS_TYPE_CODES`.
- **Миграции:** `makemigrations --check --dry-run` чист (в `make gate`).
- **Manual:** `seed_statuses` дважды на чистой БД → 17, без дублей.
- factory_boy для будущих тестов; **seed в тестах запрещён** — наполнение только через команду [Source: architecture.md:437].

## Definition of Done

- [x] Модель `StatusType` + миграция `0002_status_type` + реэкспорт `__init__.py`
- [x] Каркас `management/` + команда `seed_statuses` (idempotent, значения = DB-OPS-003)
- [x] `tests/test_seed_statuses.py` + дополнение `test_app.py`; автосверка AC-4 зелёная
- [x] `make gate` зелёный (ruff + pytest + `makemigrations --check`), ручной seed×2 проверен
- [x] Нет хардкод-секретов; `db_table`/коды строго по DB-OPS-003
- [x] Гэпы (color/restricts_editing/PENDING_CLARIFICATION/число 17) подтверждены или скорректированы перед/при dev

## Dev Agent Record

### Agent Model Used

Opus 4.8 (1M context) — bmad-dev-story, 2026-06-21.

### Debug Log References

- Таргетные тесты `apps/operations/statuses/tests/` (Postgres :5433) → 10 passed (4 app + 6 seed).
- `make gate` зелёный: **365 passed, 7 deselected** (= 358 baseline после 2-1 + 7 новых), `ruff check .` clean, `makemigrations --check --dry-run` = «No changes detected», 6с (бюджет NFR-8 < 300с).
- Ручная репетиция на dev-БД: `migrate ops_statuses` (0001+0002 OK) → `seed_statuses` ×2 → count=17 стабилен; hard=`{COMMAND,LEAVE_BY_REPORT,SICK_LEAVE,VACATION}`, no_staff=`{ATTACHED}`, restrict=`{DETACHED}`.
- Авто-генерация миграции даёт E501 на длинной `code`-строке → `ruff format` оборачивает (прецедент 2.1). `ruff format` также схлопнул ручные переносы в тестах (строки ≤88).

### Completion Notes List

- **AC-1 (модель).** `StatusType` (плоский `models.Model`, code-PK по образцу `Role`/`Permission`) в `apps/operations/statuses/models/status_type.py`, поля по DB-OPS-003 + `restricts_editing`/`color`/`is_active`; `db_table="ops_status_types"`, `ordering=["priority"]`, RU `verbose_name`. Реэкспорт из `models/__init__.py`. Миграция `0002_status_type` (обычный `CreateModel`, dep `0001_employee_status`). `makemigrations --check` чист.
- **AC-2 (seed).** Команда `seed_statuses` во вложенном app (`apps/operations/statuses/management/commands/`, каркас `management/` создан) зеркалит `seed_operations` (`update_or_create` по `code`). 17 строк (16 DB-OPS-003 вкл. `OTHER_ABSENCE` + `PENDING_CLARIFICATION`), значения-литералы; флаги выведены из множеств. Идемпотентность доказана (тест + ручной ×2).
- **AC-3 (4 hard).** `is_hard_block=True` ровно `{SICK_LEAVE, LEAVE_BY_REPORT, VACATION, COMMAND}` == `HARD_STATUS_TYPE_CODES` — тест `test_exactly_four_hard_blocks_match_constant`.
- **AC-4 (автосверка).** `test_priorities_and_columns_match_strength_report` + `test_seed_creates_all_types` сверяют priority/column/набор кодов с `STATUS_TYPE_PRIORITIES`/`REPORT_COLUMN_BY_CODE`; `counts_in_staff=False` только `ATTACHED` (== `ATTACHED_CODE`), `restricts_editing=True` только `DETACHED`. Рассинхрон справочника и кода → красный тест.
- **Подтверждённые гэпы (Bratan, AskUserQuestion):** seed=17 строк; `color` — колонка есть, seed `""` (палитра отложена); `PENDING_CLARIFICATION` — `priority=990`/`column=IN_SERVICE` (provisional, семантика в E3); `restricts_editing=True` только `DETACHED` (FR-16). FK-конверсия `EmployeeStatus.status_type_code` — НЕ делалась (out of scope).
- **Границы:** тронут только app `ops_statuses`; `EmployeeStatus`/`strength_report.py`/`HARD_STATUS_TYPE_CODES` не изменялись (только читаются тестом). Независимо от незакоммиченной 2.1.

### File List

**To Create:**
- `Backend/VAPS/apps/operations/statuses/models/status_type.py`
- `Backend/VAPS/apps/operations/statuses/migrations/0002_status_type.py`
- `Backend/VAPS/apps/operations/statuses/management/__init__.py`
- `Backend/VAPS/apps/operations/statuses/management/commands/__init__.py`
- `Backend/VAPS/apps/operations/statuses/management/commands/seed_statuses.py`
- `Backend/VAPS/apps/operations/statuses/tests/test_seed_statuses.py`

**To Modify:**
- `Backend/VAPS/apps/operations/statuses/models/__init__.py` (реэкспорт `StatusType`)
- `Backend/VAPS/apps/operations/statuses/tests/test_app.py` (db_table-ассерт `ops_status_types`)
- `Backend/VAPS/apps/operations/statuses/services/strength_report.py` (review P-3: comment-only — устаревшая заметка про OTHER_ABSENCE)

### References

- Эпик/AC: [Source: _bmad-output/planning-artifacts/epics.md#Story 2.2 (line 403-410)], FR-6 [Source: epics.md:37], FR-39 [Source: prd.md:89,166], FR-16 [Source: prd.md:110]
- Канон строк: DB-OPS-003 [Source: docs/PersonnelStatus/VAPS_7.8.2.md:488-506], FK [Source: VAPS_7.8.2.md:600]
- Код-источник seed: [Source: Backend/VAPS/apps/operations/statuses/services/strength_report.py:13-58]
- Hard-set: [Source: Backend/VAPS/apps/operations/statuses/models/employee_status.py:9-18]
- Конвенции: [Source: architecture.md:282,403,420,467-468,518-520,581,596,605,636]
- Прецеденты: [Source: apps/operations/management/commands/seed_operations.py], [Source: apps/operations/rbac/models.py:8-18], [Source: apps/operations/tests/test_seed.py]

## Change Log

| Дата | Изменение |
|------|-----------|
| 2026-06-21 | Создан story-контекст (bmad-create-story, Opus 4.8): StatusType + seed_statuses по DB-OPS-003. Канон-данные найдены в `strength_report.py`/`employee_status.py` (код ждёт 2.2). 4 гэпа без канона зафиксированы provisional-решениями (color/restricts_editing/PENDING_CLARIFICATION/число 17). FK-конверсия — out of scope. Status → ready-for-dev. |
| 2026-06-21 | Реализация (bmad-dev-story, Opus 4.8): модель `StatusType` + миграция `0002_status_type` + команда `seed_statuses` (17 строк, idempotent) + автосверка-тесты. 8 файлов (6 create / 2 modify). `make gate` зелёный (365 passed = 358+7, ruff clean, makemigrations чист, 6с); ручная репетиция migrate+seed×2 на dev-БД. 4 гэпа подтверждены Bratan (AskUserQuestion). Status → review. |
| 2026-06-21 | Code-review пр.1 (bmad-code-review, 3 слоя Opus 4.8, scoped diff 282 строки): AC-1..4 SATISFIED. 5 patch применены (тесты `is_ku_owned` + значения `PENDING`; устаревший комментарий `strength_report:16-17`; `ordering=["priority","code"]`; порядок seed); 3 defer → `deferred-work.md` (PENDING→IN_SERVICE-семантика E3, отсутствие prune, перетирание оператор-правок 2.8); ~10 dismiss. `make gate` зелёный (367 passed, makemigrations чист). Status ОСТАЁТСЯ review (осознанный override auto-`done`: артефакты не закоммичены агентом + ревью той же моделью — прецедент 1.9–2.1). |

## Review Findings (bmad-code-review пр.1, 2026-06-21)

Слои: **Blind Hunter** (только diff) · **Edge Case Hunter** (diff + repo) · **Acceptance Auditor** (diff + spec). Opus 4.8, scoped-diff 282 строки. **Acceptance Auditor: AC-1..AC-4 — все SATISFIED**, scope / File List / gap-решения подтверждены; `EmployeeStatus` / `strength_report.py` / `HARD_STATUS_TYPE_CODES` не изменялись (только читаются тестом).

### Patch

- [x] [Review][Patch] Тест на `is_ku_owned` — кросс-проверка seeded `is_ku_owned=True` == `KU_OWNED_CODES` (10 кодов) [tests/test_seed_statuses.py]. Единственный флаг без теста = самое вероятное место опечатки (Blind+Edge).
- [x] [Review][Patch] Пин значений `PENDING_CLARIFICATION` — явный ассерт priority=990 / column=IN_SERVICE / is_hard_block=False [tests/test_seed_statuses.py]. Сейчас исключён из кросс-сверки (`EXTRA_BEYOND_STRENGTH_REPORT`) → provisional-значения без тест-давления (Edge).
- [x] [Review][Patch] Устаревший комментарий `strength_report.py:16-17` — «OTHER_ABSENCE absent from the seed … to be fixed in seed 2.2» теперь ложь (2.2 его засидила). Обновить (comment-only, логику/константы не трогаем) (Edge).
- [x] [Review][Patch] Детерминированная сортировка `ordering=["priority","code"]` [models/status_type.py + migration 0002 options]. `priority` не unique → tie-break против недетерминизма Postgres/SQLite; state-only, без DB-изменений (Blind+Edge).
- [x] [Review][Patch] Неточный комментарий seed «in priority order» (IN_SERVICE 999 перечислен перед PENDING 990) — переставить PENDING перед IN_SERVICE [seed_statuses.py] (Blind nit).

### Defer (вынесены в deferred-work.md)

- [x] [Review][Defer] `PENDING_CLARIFICATION.report_column_code="IN_SERVICE"` → pending/«уточняется» считается как в-строю (Blind major). Сегодня НЕ потребляется (текущий `strength_report` использует свой 16-код-constant без PENDING). Семантика (жёлтый светофор, своя строка расхода — AR-11) → E3. — deferred, provisional подтверждён Bratan.
- [x] [Review][Defer] Seed не пруна́ет осиротевшие строки — при удалении кода из `STATUS_TYPES` re-seed оставляет строку live; `is_active`-soft-delete не задействован (Blind+Edge). Каталог сейчас grow-only (прецедент `seed_operations`). — deferred.
- [x] [Review][Defer] Re-seed перетирает оператор-правки — `update_or_create(defaults=…)` сбрасывает `is_active`/`color` каждый прогон (Blind+Edge). Актуально с Admin-редактированием (стори 2.8) → `create_defaults` для `is_active`/`color`. — deferred.

### Dismissed (для протокола)

- Blind «тест циркулярен» — Edge подтвердил: `strength_report` — независимый hand-maintained источник, кросс-сверка реально ловит дрейф.
- Blind «HARD_BLOCK не сверен напрямую» — транзитивно доказано (seeded-строки vs `HARD_STATUS_TYPE_CODES`).
- Edge «SQLite-only фейл» — пре-существующий `0001` (PG-only ExclusionConstraint), проект Postgres-таргет; не дефект 2.2.
- Edge «orphan free-text status_type_code» — FK out of scope (документировано).
- Edge «hardcoded 17» — намеренный независимый счётчик (set-equality уже ловит дрейф).
- `counts_in_list=True` везде (канон DB-OPS-003); app-label `ops_statuses`; encoding UTF-8; max_length — верифицированы чистыми/каноничными.
