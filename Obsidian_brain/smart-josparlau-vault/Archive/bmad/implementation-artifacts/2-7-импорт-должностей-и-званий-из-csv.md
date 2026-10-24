---
baseline_commit: 40c7a6f6b480e121358767334cfabb778715c8a7
---
# Story 2.7: Импорт должностей и званий из CSV

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a администратор,
I want management-команду идемпотентного импорта должностей (`Position`) и званий (`Rank`) из `.csv` с построчным отчётом об ошибках,
so that справочники наполняются массово без ручного ввода, а битые/дублирующиеся строки видны со строкой и причиной, а не роняют весь импорт (FR-39).

## Acceptance Criteria

1. **Given** CSV должностей с валидными строками, дублем `code` и битой строкой (нечисловой `level`), **When** запускаю `manage.py import_references --positions <file>`, **Then** валидные строки созданы/обновлены идемпотентно через `update_or_create(code=...)`, а каждая отклонённая строка попадает в отчёт с **номером строки CSV** и **причиной** — невалидная строка НЕ прерывает импорт остальных.
2. **Given** тот же CSV, **When** запускаю импорт повторно, **Then** результат идемпотентен: число строк в `core_positions`/`core_ranks` не меняется, счётчики переключаются `created → updated`, побочных строк нет.
3. **Given** CSV званий с колонками `code,name,category,rank_index`, **When** `--ranks <file>`, **Then** звания созданы с корректными `category` (nullable) и `rank_index`; нечисловой `rank_index` → строка в отчёте как `invalid_rank_index`.
4. **Given** одна команда с обоими флагами `--positions A --ranks B`, **When** запускаю, **Then** обе сущности импортируются за один прогон с **раздельными** под-отчётами (`positions: read/created/updated/skipped`, затем `ranks: …`).
5. **Given** вызов без единого из `--positions`/`--ranks`, **When** запускаю, **Then** `CommandError` с понятным сообщением (нечего импортировать); **Given** несуществующий путь к файлу, **Then** `CommandError` с путём.
6. **Given** прогон импорта, **When** завершается, **Then** отчёт печатается в `stdout` в формате прецедента `import_donor_slice` (`name: read X, created Y, updated Z, skipped W` + построчные `- {reason}: {count} (examples: <строка>:<code>, …)`); `make gate` зелёный, миграций нет (`makemigrations --check` чист — модели не меняются).

## Tasks / Subtasks

- [x] **Задача 1. Management-команда `import_references` (AC: 1,3,4,5,6)**
  - [x] Создать `Backend/VAPS/apps/core/management/commands/import_references.py`, класс `Command(BaseCommand)` (точный прецедент: `apps/core/management/commands/seed_core.py`, импорт `import_donor_slice.py`).
  - [x] `add_arguments`: `--positions` (path, optional), `--ranks` (path, optional). В `handle`: если оба не заданы → `raise CommandError("nothing to import: pass --positions and/or --ranks")`.
  - [x] Для каждого заданного файла: проверить существование (`os.path.exists`), иначе `CommandError(f"file not found: {path}")`.
  - [x] Парсинг через `csv.DictReader` (stdlib); номер строки — `reader.line_num` (1-based, включает заголовок), использовать его как «строку» в отчёте.
- [x] **Задача 2. Построчная валидация + идемпотентный upsert (AC: 1,2,3)**
  - [x] Реализовать `EntityReport` по образцу `import_donor_slice.py:33-57` (`read/created/updated`, `skips: defaultdict(list)`, `skip(reason, example)`, свойство `skipped`). Пример в skip — строка `f"{line_num}:{code or '?'}"`.
  - [x] **Positions** (`core_positions`): колонки `code,name,level,sort_order`. Правила: `code` непустой иначе `skip("empty_code")`; `name` непустой иначе `skip("empty_name")`; `level`/`sort_order` пусто → `0` (дефолт модели), нечисло → `skip("invalid_level"|"invalid_sort_order")`. Upsert: `Position.objects.update_or_create(code=code, defaults={"name","level","sort_order"})`. `is_active` НЕ класть в `defaults` (на create берётся дефолт `True`, на update не затирается).
  - [x] **Ranks** (`core_ranks`): колонки `code,name,category,rank_index`. Правила: `code`/`name` непустые; `category` пусто → `None`; `rank_index` пусто → `0`, нечисло → `skip("invalid_rank_index")`. Upsert: `Rank.objects.update_or_create(code=code, defaults={"name","category","rank_index"})`.
  - [x] Дубль `code` внутри файла: первое вхождение применяется, последующие → `skip("duplicate_in_file")` (детерминизм; идемпотентность по AC-2 обеспечивает `update_or_create`).
  - [x] Каждый upsert обернуть в `with transaction.atomic():` (savepoint per row, прецедент `import_donor_slice.py:456-463`), `IntegrityError`/`DataError` → `skip("integrity_error"|"invalid_value")` — валидные строки не откатываются.
  - [x] Счётчик: `created`/`updated` по флагу из `update_or_create`.
- [x] **Задача 3. Печать отчёта (AC: 1,6)**
  - [x] `_print_report` по образцу `import_donor_slice.py:488-523`: на сущность `self.style.SUCCESS(f"{name}: read {r.read}, created {r.created}, updated {r.updated}, skipped {r.skipped}")`, затем `for reason, examples in sorted(r.skips.items()): write(f"  - {reason}: {len(examples)} (examples: {', '.join(examples[:5])})")`. Лимит примеров = 5 (`EXAMPLE_LIMIT`, прецедент).
- [x] **Задача 4. Тесты (AC: все)**
  - [x] Создать `Backend/VAPS/apps/core/tests/test_import_references.py`, `pytestmark = pytest.mark.django_db`. CSV — **inline через `tmp_path`** (`(tmp_path / "pos.csv").write_text(...)`), без коммита фикстур.
  - [x] Кейсы: (a) валидные positions → created, проверка полей; (b) повторный прогон → `Position.objects.count()` не изменился, второй прогон даёт `updated` (AC-2); (c) дубль `code` в файле → `duplicate_in_file` + валидные созданы; (d) нечисловой `level` → `invalid_level` со **строкой** в отчёте (assert на `capsys`/`StringIO` stdout), остальные импортированы (AC-1); (e) пустой `code` → `empty_code`; (f) ranks с `category=None` и `rank_index` (AC-3); (g) оба флага за один прогон, два под-отчёта (AC-4); (h) без флагов → `CommandError`, несуществующий путь → `CommandError` (AC-5).
- [x] **Задача 5. Гейт (AC: 6)**
  - [x] Прогнать `make gate` (Postgres :5433): `ruff check .` чист, pytest зелёный (+новые тесты), `makemigrations --check --dry-run` = «No changes detected» (модели не трогаем), бюджет < 300с. Артефакты **НЕ коммитить** (за Bratan).

## Dev Notes

### Где это живёт (граница core↛operations — НЕ перекладывать в operations)

`Position` и `Rank` — это **core-справочники** (`Backend/VAPS/apps/core/models.py:99-127`, app label `core`). Команда импортирует **только core-модели**, поэтому её место — `apps/core/management/commands/`, рядом с уже существующим `seed_core.py`. Граница `core↛operations` (ARCH-004, `test_isolation.py:132-140`) запрещает `apps.core` импортировать `apps.operations.*` и требует чистоты `apps/core/sorting.py` — **это не про management-команды и не про эту историю**. Не создавать импортёр в `apps.operations`: это было бы переусложнением и нарушило бы локальность справочников.

### Целевые модели (НЕ изменять — миграции в этой истории НЕТ)

```python
# Backend/VAPS/apps/core/models.py:99-112
class Position(models.Model):
    code = models.CharField(primary_key=True, max_length=50)   # PK, матчится с Employee.position_code (строка, не FK)
    name = models.CharField(max_length=255)
    level = models.IntegerField(default=0)                     # ось сортировки канона 2.6 (меньше=старше); БЕЗ MinValueValidator (→ 2.8)
    sort_order = models.IntegerField(default=0)
    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)
    class Meta: db_table = "core_positions"

# Backend/VAPS/apps/core/models.py:114-127
class Rank(models.Model):
    code = models.CharField(primary_key=True, max_length=50)   # PK
    name = models.CharField(max_length=255)
    category = models.CharField(max_length=50, null=True, blank=True)
    rank_index = models.IntegerField(default=0)
    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)
    class Meta: db_table = "core_ranks"
```

Модели уже существуют (миграции `core/0003_position.py`, `core/0004_rank.py`). **Схему не менять → миграции нет → `makemigrations --check` остаётся чист.** Если возникнет соблазн добавить FK/валидатор/поле — это out of scope (см. ниже).

### Прецедент идемпотентного upsert — `seed_core.py` (мирроринг, не переизобретать)

```python
# Backend/VAPS/apps/core/management/commands/seed_core.py — уже сеет POSITIONS/RANKS захардкоженными данными
Position.objects.update_or_create(
    code=code, defaults={"name": name, "level": level, "sort_order": sort_order},
)
```

Story 2.7 — это **CSV-обобщение** того же паттерна (FR-39 «импорт .csv»). `seed_core` оставить нетронутым (он сеет минимальный пилотный набор; CSV-импортёр — для реального наполнения). Та же идиома `update_or_create(code=..., defaults={...})`.

### Прецедент отчёта по ошибкам — `import_donor_slice.py` (мирроринг `EntityReport`)

```python
# apps/migration_legacy/management/commands/import_donor_slice.py:33-57
class EntityReport:
    def __init__(self):
        self.read = 0; self.created = 0; self.updated = 0
        self.skips = defaultdict(list)
    def skip(self, reason, example): self.skips[reason].append(example)
    @property
    def skipped(self): return sum(len(v) for v in self.skips.values())
```

Печать (мирроринг `import_donor_slice.py:488-523`): per-entity сводка + `- {reason}: {count} (examples: …)`, `EXAMPLE_LIMIT = 5`. **Отличие для 2.7:** пример = `"<line_num>:<code>"` (AC требует «строку» — берём `csv.DictReader.line_num`), а не donor pk.

Per-row savepoint (`import_donor_slice.py:456-463`): каждый upsert в `with transaction.atomic():`, ловить `IntegrityError`/`DataError` → skip с причиной. Это и даёт AC-1 «битая строка не роняет остальные».

### CSV-контракт (зафиксировать в коде и тесте)

- **Positions**: заголовок `code,name,level,sort_order`. `code`,`name` обязательны (непустые). `level`,`sort_order` — int, пусто → 0, нечисло → skip. Лишние колонки игнорировать; отсутствие обязательной колонки в заголовке → `CommandError` (структурная ошибка файла, не построчная).
- **Ranks**: заголовок `code,name,category,rank_index`. `code`,`name` обязательны. `category` опционально (пусто → `None`). `rank_index` — int, пусто → 0, нечисло → skip.
- Кодировка — UTF-8; `csv.DictReader` со стандартным диалектом (запятая).

### Тестовый дом-стиль (из 2.6) и гейт

- Тесты на Postgres :5433, `pytestmark = pytest.mark.django_db`. Прецедент-тест: `apps/core/tests/test_positions.py`, `test_ranks.py` (используют `call_command("seed_core")`). Здесь — `call_command("import_references", positions=str(path))` + проверка БД и захваченного stdout.
- **Property-тесты не нужны** (это I/O, не алгоритм) — не добавлять (анти-gold-plating). Достаточно интеграционных кейсов из Задачи 4.
- `make gate` recipe (`Backend/VAPS/Makefile:31-54`): `docker compose up -d --wait db` → `ruff check .` (select E,F) → `pytest -m "not property and not concurrency and not slow"` → `manage.py makemigrations --check --dry-run`; env `VAPS_DB_PORT=5433`; бюджет 300с (NFR-8); 2.6 база была 407 passed / 18 deselected.
- ruff: форматировать **по файлу**, не по app-папке; гейт = `ruff check` (E,F), не format.
- **Артефакты НЕ коммитить** (dev не само-промоутит в done; Status → review; коммит за Bratan). Прецедент 2.4/2.5/2.6.

### Known interactions / deferred (НЕ чинить здесь)

- **Re-import перетирает Admin-правки** (как `update_or_create(defaults=...)` в seed — deferred-work.md:174): повторный CSV-импорт форсит `defaults`. Для CSV это ожидаемо (явный bulk-load оператора). Переход на `create_defaults` (Django 5.0+) для не-канон-полей — вместе со стори **2.8** (Admin справочников). Не вводить здесь.
- **`Position.level` без `MinValueValidator`** (deferred-work.md:193): отрицательные уровни допустимы и сортируются «старше». Импортёр их НЕ запрещает (валидатор — стори **2.8**); только не-int → skip. Не добавлять range-проверку.

### Project Structure Notes

- **Создать:** `apps/core/management/commands/import_references.py`, `apps/core/tests/test_import_references.py` — обе в существующей структуре `apps.core`. Конфликтов с layout нет; директории `management/commands/` и `tests/` уже есть.
- **Не трогать:** `seed_core.py`, `models.py`, миграции, `apps.operations.*`, Django Admin. ≤2 кодовых файла → в пределах правила размера истории.
- Команда регистрируется автоматически (Django management discovery), `INSTALLED_APPS` уже содержит `apps.core` (`config/settings.py:15`). Изменений в settings/urls нет.

### Out of Scope (НЕ реализовывать в 2.7)

- Django Admin для справочников → **2.8**.
- `MinValueValidator`/`create_defaults`-защита от перетирания → **2.8**.
- Любой HTTP/API-endpoint импорта (команда — только CLI).
- Импорт сотрудников, оргструктуры, StaffingSlot → E7 (`7.2`/`7.3`).
- Изменение моделей `Position`/`Rank`, новые поля, FK `Employee.position_code → Position`.

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Story 2.7 (line 447-453)] — user story + AC (дубли/битая строка → отчёт со строками и причинами).
- [Source: _bmad-output/planning-artifacts/epics.md#FR-39 (line 83)] — «Справочники … + импорт .csv».
- [Source: Backend/VAPS/apps/core/models.py:99-127] — модели `Position`/`Rank` (поля, db_table, PK=code).
- [Source: Backend/VAPS/apps/core/management/commands/seed_core.py] — прецедент `update_or_create(code=…, defaults=…)`.
- [Source: Backend/VAPS/apps/migration_legacy/management/commands/import_donor_slice.py:33-57, 456-523] — `EntityReport`, per-row savepoint, формат отчёта.
- [Source: Backend/VAPS/apps/core/tests/test_positions.py, test_ranks.py] — тест-прецедент `call_command` + проверка БД.
- [Source: Backend/VAPS/Makefile:31-54] — `make gate` (Postgres :5433, ruff E/F, makemigrations --check).
- [Source: _bmad-output/implementation-artifacts/deferred-work.md:174, 193-194] — deferred: re-seed перетирание, `Position.level` без валидатора → 2.8.
- [Source: _bmad-output/implementation-artifacts/2-6-канон-сортировки-списков.md:80-84,147-153,189] — граница core↛operations, дом-стиль тестов, «артефакты не коммитятся».

## Dev Agent Record

### Agent Model Used

Opus 4.8 (claude-opus-4-8[1m]), bmad-dev-story, 2026-06-23. baseline_commit `40c7a6f`.

### Debug Log References

- TDD: тесты написаны первыми (`test_import_references.py`, 12 кейсов). RED — `.venv/bin/pytest apps/core/tests/test_import_references.py` → 9 failed «Unknown command: 'import_references'» (3 guard-rail прошли временно по `CommandError` от диспетчера). GREEN после команды → 12 passed (1.16s).
- ruff E501 на 3 строках (docstring `_parse_int`, list-comp `missing`, тест-строка ranks) → разбиты/сокращены вручную (канон: ruff check по файлу, не format).
- Полный `make gate` (Postgres :5433, docker `vaps-db-1` healthy): **421 passed, 18 deselected** (база 409 → +12), `ruff check .` clean, `makemigrations --check --dry-run` = «No changes detected», 6s (бюджет NFR-8 = 300s). Регрессий нет.

### Completion Notes List

- **Команда** `apps/core/management/commands/import_references.py` — `--positions`/`--ranks` (≥1 обязателен, иначе `CommandError`). Идемпотентный `update_or_create(code=..., defaults=...)` (мирроринг `seed_core`); `EntityReport` + per-row `transaction.atomic()` savepoint (мирроринг `import_donor_slice`). `is_active` НЕ в `defaults` → дефолт `True` на create, не затирается на update.
- **Отчёт**: `<entity>: read X, created Y, updated Z, skipped W` + `- {reason}: {count} (examples: <csv_line>:<code>, …)` (EXAMPLE_LIMIT=5). Пример несёт **номер строки CSV** (`csv.DictReader.line_num`) — прямое доказательство AC-1 «ошибки со строками и причинами».
- **Skip-причины**: `empty_code`, `empty_name`, `duplicate_in_file` (первое вхождение выигрывает), `invalid_level`/`invalid_sort_order`/`invalid_rank_index` (нечисло; пусто → 0 = дефолт модели), `integrity_error`/`invalid_value` (DB-уровень). Битая строка не прерывает импорт остальных.
- **Структурные ошибки файла** (нет пути / нет обязательной колонки в заголовке) → `CommandError` (а не построчный skip).
- **Без модели/миграции** — `Position`/`Rank` уже существуют (`core/0003`, `core/0004`); `makemigrations --check` чист. Out of scope соблюдён: Admin, `MinValueValidator` на `level`, `create_defaults`-защита — НЕ трогались (→ 2.8). `seed_core.py` не изменён.
- **Артефакты НЕ закоммичены агентом** (за Bratan). Status → review (dev не само-промоутит в done; ревью желательно другой моделью — прецедент 2.4/2.5/2.6).

### File List

**To Create** — сделано
- `Backend/VAPS/apps/core/management/commands/import_references.py`
- `Backend/VAPS/apps/core/tests/test_import_references.py`

**To Modify**
- _(app-код не менялся; BMAD-трекинг: `sprint-status.yaml`, этот файл)_

### Change Log

| Дата | Изменение |
|------|-----------|
| 2026-06-23 | Создана история 2.7 (bmad-create-story, Opus 4.8): CSV-импортёр должностей/званий в `apps.core`, идемпотентный `update_or_create` + `EntityReport` с построчными причинами; миграции нет; Out of scope: Admin/валидатор → 2.8. Status → ready-for-dev. |
| 2026-06-23 | Dev (bmad-dev-story, Opus 4.8): реализована команда `import_references` (+12 тестов, TDD). `make gate` зелёный (Postgres :5433: 421 passed, +12; ruff чист; makemigrations «No changes detected»; 6s). Без модели/миграции. Артефакты НЕ закоммичены агентом. Status → review. |
| 2026-06-23 | Code-review (bmad-code-review, Opus 4.8, 3 слоя: Blind Hunter / Edge Case Hunter / Acceptance Auditor; scoped diff 387 строк, 2 новых файла). Acceptance Auditor: **ACCEPT** — AC-1..6 SATISFIED, out-of-scope чист. Итог триажа: 1 decision · 4 patch · 3 defer · 8 dismiss. См. ## Review Findings. |
| 2026-06-23 | Применены 5 патчей (decision «рваные строки» → строгий, резолв Bratan): P1 BOM→`utf-8-sig`; P2 decode/`csv.Error`→`CommandError`; P3 тест `empty_name`; P4 AC-5 assert текста сообщения; P5 `_is_ragged`→`skip("malformed_row")`+2 теста. `make gate` зелёный (Postgres :5433: **424 passed**, +3; ruff чист; makemigrations «No changes detected»; 6s). 3 defer → deferred-work.md. Артефакты НЕ закоммичены агентом. Status → done. |

## Review Findings

_Code-review (bmad-code-review, 2026-06-23, Opus 4.8, 3 адверсариальных слоя; scoped diff 387 строк по 2 новым файлам). Acceptance Auditor: ACCEPT — все 6 AC SATISFIED, корректность на well-formed UTF-8 CSV подтверждена; findings ниже — робастность/operator-experience hardening, не блокирующие баги. 1 decision · 4 patch · 3 defer · 8 dismiss._

### Decision needed (resolved)

- [x] [Review][Decision] Рваные строки CSV (число полей ≠ заголовку) [import_references.py:104-105,126-133] — короткая строка → `None`→`_parse_int`→`0` (обрезанная строка молча импортируется как валидная); длинная строка → данные под ключ `None`, молча теряются. **РЕЗОЛВ Bratan (2026-06-23): строгий** — детектить рваные строки (короткие и длинные) → `skip("malformed_row")` с номером строки. → стал patch **P5** ниже. (blind+edge MED)

### Patches

- [x] [Review][Patch] BOM в заголовке ломает колонку `code` (Excel «CSV UTF-8») [import_references.py:96] — `open(..., encoding="utf-8")` не срезает BOM → первый заголовок `﻿code` → `CommandError("missing required column(s): code")` на КОРРЕКТНОМ файле. Фикс: `encoding="utf-8-sig"` (срезает BOM если есть, иначе no-op). Excel — частый инструмент оператора. (edge MED)
- [x] [Review][Patch] Не-UTF-8 / битый CSV → сырой traceback вместо CommandError [import_references.py:96-105] — Windows-1251 кириллический справочник (`UnicodeDecodeError`) или битая кавычка (`csv.Error`) роняют команду traceback'ом, мимо AC-5-паттерна «file-level → CommandError» (прецедент `import_donor_slice` оборачивает чтение). Фикс: try/except (UnicodeDecodeError, csv.Error) → CommandError(path). (blind+edge MED)
- [x] [Review][Patch] Ветка skip `empty_name` без теста [test_import_references.py] — реализована (import_references.py:121,156), но не покрыта; есть только тест `empty_code`. Добавить зеркальный тест. (auditor)
- [x] [Review][Patch] AC-5 тесты проверяют только тип исключения, не текст [test_import_references.py:169-176] — `test_missing_file_raises`/`test_no_flags_raises` не ассертят, что путь/причина в сообщении (AC-5 требует «CommandError с путём»). Усилить `pytest.raises(..., match=...)`. (auditor)
- [x] [Review][Patch] P5 — строгий детект рваных строк (резолв decision) [import_references.py:104-105,112-133,147-166] — короткая (None в обязательном поле) или длинная (ключ `None` от `restkey`) строка → `skip("malformed_row", example)` с номером строки CSV до парсинга; не роняет остальные. + тест (короткая/длинная → malformed_row, валидные импортятся). (resolved decision)

### Deferred

- [x] [Review][Defer] Сверхдлинные значения (code>50/name>255/category>50) [import_references.py:176-189] — на Postgres gracefully skip как `invalid_value` (метка не длино-специфична), на SQLite сохраняются без усечения (дивергенция, если pytest гонять на SQLite, а не на гейтовом Postgres). Полировка: pre-валидация длины с явной причиной → 2.8. — deferred (AC не затронуты)
- [x] [Review][Defer] Ветка savepoint DB-reject (`invalid_value`/`integrity_error`) без теста [import_references.py:184-189] — dev-гарантия «битая строка не роняет остальные» на DB-уровне не прогоняется; тест engine-зависим (Postgres-only), а `integrity_error` практически недостижим (in-file `seen` дедупит до БД). — deferred (test-hardening)
- [x] [Review][Defer] `EXAMPLE_LIMIT=5` усечение без теста [import_references.py:204] — `examples[:5]` не покрыто (>5 skip одной причины → показать 5). Дёшево, низкий приоритет. — deferred (nice-to-have)
