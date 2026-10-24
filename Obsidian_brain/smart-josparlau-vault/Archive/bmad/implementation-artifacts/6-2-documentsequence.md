---
baseline_commit: 9ad9d62c6dae81cad0cba130e7c1dcceacaa121b (feat(story-6.1): App documents и Attachment; epic-6 in-progress, 6.1 done — app documents существует)
context:
  - _bmad-output/planning-artifacts/epics.md (§Epic 6 Story 6.2 стр. 823-829; Story 6.5 стр. 848-856 — потребитель; §Правила декомпозиции стр. 248-254)
  - _bmad-output/planning-artifacts/architecture.md (§Process Patterns «Нумерация документов» стр. 468, «Конкурентность» стр. 464; §Naming Patterns → БД стр. 404-408; §Базовые модели стр. 419-422; §Test Organization стр. 629-644)
  - _bmad-output/implementation-artifacts/deferred-work.md (стр. 140 — §82.3 year-rollover: мандат этой стори; стр. 26/31/253/340 — классы гонок)
  - _bmad-output/implementation-artifacts/epic-5-retro-2026-07-08.md (AI-2, AI-3, урок №1 «санитизация по чек-листу»)
  - _bmad-output/implementation-artifacts/6-1-app-documents-и-attachment.md (предыдущая стори: конвенции app documents)
---

# Story 6.2: DocumentSequence

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a **система**,
I want **счётчик `DocumentSequence(doc_type, year, last_number)` с инкрементом `select_for_update` в транзакции финализации**,
so that **номера документов монотонны и gap-tolerant (откат транзакции не оставляет дырку — лок держится до коммита)**.

## Acceptance Criteria

1. **Конкурентный инкремент существующего счётчика.** **Given** существующая строка `(doc_type, year)` с `last_number = n`, **When** две транзакции конкурентно вызывают `allocate_number(doc_type=…, year=…)` (каждая в своём `transaction.atomic`), **Then** обе получают номера, номера уникальны и последовательны (`{n+1, n+2}`), в таблице ровно одна строка с `last_number = n+2`; проигравшая транзакция ЖДЁТ на row-локе до коммита победителя (не падает). [Source: epics.md §Story 6.2 стр. 829; architecture.md стр. 464, 468]
2. **Откат — дырки нет (лок до коммита).** **Given** счётчик с `last_number = n`, **When** `allocate_number` вызван внутри `transaction.atomic`, получил `n+1`, и транзакция откатилась (исключение), **Then** `last_number` в БД остался `n`, следующий успешный вызов возвращает тот же `n+1` — дырки в нумерации нет. [Source: epics.md §Story 6.2 стр. 829 «Given откат транзакции, Then дырки нет»]
3. **Bootstrap-гонка нового `(doc_type, year)` — закрытие §82.3.** **Given** строки `(doc_type, year)` НЕ существует (первый документ типа / нового года), **When** две конкурентные транзакции вызывают `allocate_number` для этой пары, **Then** в таблице ровно ОДНА строка, номера — `{1, 2}`, наружу не выходит ни `IntegrityError`, ни отравленная (aborted) внешняя транзакция. Семантика year-rollover, оставленная открытой инвентаризацией 1.12, определена и протестирована. [Source: deferred-work.md стр. 140 п.(1) «§82.3 → E6»; урок 5.6b→5.7a про голый IntegrityError]
4. **Модель + БД-инварианты.** **Given** применённая миграция `0002_documentsequence`, **Then** таблица `documents_document_sequences`: `doc_type` (CharField ≤50), `year`, `last_number` (default 0), `updated_at` (auto_now), integer PK; констрейнты: `uq_document_sequence_doc_type_year` (unique по паре), `chk_document_sequence_last_number_min` (`last_number ≥ 0`), `chk_document_sequence_year_range` (`2000 ≤ year ≤ 2200`), `chk_document_sequence_doc_type_not_blank` (`\S`-regex). **Given** прямой INSERT/UPDATE с нарушением, **Then** `IntegrityError` от БД. **MUST NOT: Postgres SEQUENCE** — в миграции нет `CreateSequence`/`GENERATED … AS IDENTITY`/`nextval`, номер НЕ AutoField (см. Ловушку №2). [Source: architecture.md стр. 468, 404-408; feedback: DB-уровень для инвариантов]
5. **Контракт сервиса.** `allocate_number(*, doc_type: str, year: int) -> int` — kwargs-only; санитизация по чек-листу (ретро E5 §4.1): `doc_type` — strip → непустое → ≤50; `year` — `int` (`bool` отвергается), в диапазоне 2000..2200; нарушение → `ValueError` (внутренний вызов, не HTTP). Вызов ВНЕ `transaction.atomic` → `TransactionManagementError` (имплицитный энфорс от `select_for_update` — лок обязан дожить до коммита вызывающего). `select_for_update` — в селекторе, инкремент — в сервисе (канон стр. 464). Wall-clock в сервисе/модели не читается — `year` подаёт вызывающий (политика «какой год у документа» — зона 6.5). Первый номер года = 1. [Source: architecture.md стр. 450, 464, 302; epic-5-retro урок №1]
6. **Гейт и анти-gold-plating.** `make gate` зелёный (Postgres :5433), `makemigrations --check` пуст, `ruff` чист; concurrency-тесты прогнаны явно на Postgres (полная команда и ожидаемый вывод `3 passed, 3 errors (teardown)` — Ловушка №4); НЕТ изменений API/urls/admin/audit/RBAC-матриц/schema.yaml (API не менялся — regen не нужен, drift-гейт остаётся зелёным без правок); НИЧЕГО сверх секции «Границы» не реализовано. [Source: architecture.md §Enforcement стр. 474-481, §Test Organization стр. 636-639; Makefile:52-73]

## Tasks / Subtasks

- [x] **Task 1 — Модель DocumentSequence + миграция (AC: 4)**
  - [x] `apps/documents/models.py`: `class DocumentSequence(models.Model)` — bare-модель Watermark-стиля (Д2): `doc_type = CharField(max_length=50)`, `year = PositiveIntegerField()`, `last_number = PositiveIntegerField(default=0)`, `updated_at = DateTimeField(auto_now=True)`; PK — неявный BigAutoField (default_auto_field app)
  - [x] `Meta`: `db_table = "documents_document_sequences"`; констрейнты по AC-4 (стиль `condition=models.Q(...)` — зеркало `daily_submission.py:114-123`; `\S`-regex non-blank — зеркало Attachment); verbose_name по-русски
  - [x] Docstring модели: контракт «номер выдаётся ТОЛЬКО через `services.allocate_number` в транзакции финализации; прямой UPDATE = мимо лока; MUST NOT Postgres SEQUENCE (nextval не транзакционен → дырки при откате)»
  - [x] Миграция `0002_documentsequence.py` (переименовать из авто-имени; `dependencies=[("documents", "0001_attachment")]`); модель + констрейнты = ОДНА миграция (канон стр. 408)
  - [x] НЕ регистрировать в Admin (architecture.md стр. 469 — документы в явном списке запретов)
- [x] **Task 2 — Селектор с локом (AC: 1, 5)**
  - [x] `apps/documents/selectors.py`: `lock_sequence(*, doc_type, year)` → `DocumentSequence.objects.select_for_update().get(doc_type=…, year=…)`; docstring «use inside a transaction» (зеркало `CoreEmployeeLockSelector.lock_employee`, `apps/core/selectors.py:255-261`); лок в селекторе — канон стр. 464
- [x] **Task 3 — Сервис allocate_number (AC: 1, 2, 3, 5)**
  - [x] `apps/documents/services.py`: `allocate_number(*, doc_type, year)` — санитизация входов (AC-5) → `get_or_create(doc_type=…, year=…, defaults={"last_number": 0})` (bootstrap, Ловушка №1) → перечитка через `selectors.lock_sequence(...)` (ОБЯЗАТЕЛЬНО — объект из get_or_create НЕ залочен) → `last_number += 1` → `save(update_fields=["last_number", "updated_at"])` → `return row.last_number`
  - [x] Load-bearing docstring (house style — прецедент `_lock_for_edit`, `status_service.py:438-455`): сервис MUST вызываться внутри `transaction.atomic` финализации вызывающего; своего `atomic` НЕ открывает; лок держится до коммита вызывающего — это и есть механизм «откат без дырки»; контракт против дедлока — один вызов = одна строка, при будущей мульти-аллокации в одной транзакции сортировать по `(doc_type, year)` (Ловушка №7)
  - [x] Никакого чтения Clock/времени в сервисе (AST-гвард `test_no_wall_clock_reads_in_domain_layers` сканирует `services.py` всех apps)
- [x] **Task 4 — Unit-тесты, бегут в gate (AC: 2, 4, 5)**
  - [x] `apps/documents/tests/test_document_sequence.py`:
  - [x] констрейнты через `pytest.raises(IntegrityError)` под `transaction.atomic()` (паттерн `test_attachment_model.py`): дубль `(doc_type, year)`; `year` вне диапазона; пустой/пробельный `doc_type`; отрицательный `last_number` через прямой SQL-UPDATE (post-insert мутация — самый честный вектор; `objects.create(last_number=-1)` тоже даёт IntegrityError через встроенный чек позитив-филда). Ассертить ТОЛЬКО `IntegrityError`, НЕ имя констрейнта (встроенный чек и `chk_*_min` делят предикат — БД может процитировать любое из имён; прецедент Attachment имена не проверяет)
  - [x] последовательность: три вызова подряд (каждый в своём atomic) → 1, 2, 3; одна строка
  - [x] независимость счётчиков: `(тип_А, 2026)`, `(тип_А, 2027)`, `(тип_Б, 2026)` — каждый стартует с 1 (семантика year-rollover: новый год = новый счётчик с 1)
  - [x] откат без дырки (AC-2): вложенный `atomic` + исключение → `last_number` не изменился → повторный вызов возвращает тот же номер
  - [x] санитизация: не-str doc_type / пустой / 51 символ / `year=True` (bool!) / год 1999 → `ValueError`
  - [x] ⚠️ В ЭТОМ файле НИ ОДНОГО `django_db(transaction=True)` — такой тест бежит в gate и валит teardown-flush (Ловушка №4); тест на `TransactionManagementError` живёт в concurrency-файле (Task 5)
- [x] **Task 5 — Concurrency-тесты, бегут в test-full (AC: 1, 3)**
  - [x] `apps/documents/tests/test_document_sequence_concurrency.py` — скелет ЦЕЛИКОМ из `apps/operations/statuses/tests/test_employee_status_concurrency.py`: `@pytest.mark.concurrency` + `@pytest.mark.django_db(transaction=True)`, `threading.Barrier(2)`, `connection.close()` в `finally` каждого воркера, `results`-dict, `join(timeout)` + `assert not thread.is_alive()`, ручной cleanup в `finally`
  - [x] в каждом воркере — СВОЙ `with transaction.atomic():` вокруг `allocate_number(...)` (прецедентный скелет зовёт `@transaction.atomic`-сервис, а `allocate_number` намеренно своего atomic НЕ открывает — буквальная копия скелета уйдёт в autocommit и упадёт)
  - [x] тест 1 (AC-1): строка предсоздана с `last_number = 5` → два потока аллоцируют конкурентно → номера `{6, 7}`, строка одна, `last_number = 7`
  - [x] тест 2 (AC-3, §82.3): строки НЕТ → два потока аллоцируют конкурентно → ровно одна строка, номера `{1, 2}`, ни одного error-исхода в results
  - [x] тест 3 (AC-5): вызов `allocate_number` вне atomic (autocommit, без потоков) → `TransactionManagementError`; в `finally` удалить строку счётчика — `get_or_create` успевает закоммитить её ДО того, как `lock_sequence` поднимет TME (Ловушка №3)
  - [x] прогнать явно на Postgres (SQLite молча игнорирует `select_for_update` — тесты «пройдут» по ложной причине): `docker compose up -d --wait db && VAPS_DB=postgres VAPS_DB_NAME=vaps VAPS_DB_USER=vaps VAPS_DB_PASSWORD=vaps VAPS_DB_HOST=localhost VAPS_DB_PORT=5433 .venv/bin/pytest -m concurrency apps/documents` (зеркало Makefile:58-64); ожидаемый вывод — `3 passed, 3 errors`, где все 3 error — teardown-flush (Ловушка №4), exit-код ненулевой из-за них — это НЕ провал
- [x] **Task 6 — Doc-sync + гейт (AC: 6)**
  - [x] `deferred-work.md` стр. ~140: пометить п.(1) «DocumentSequence year-rollover §82.3» как закрытый этой стори (семантика: новый `(doc_type, year)` бутстрапится `get_or_create` под защитой unique-констрейнта, гонка двух транзакций сериализуется на unique-индексе + row-локе, счётчик нового года стартует с 1)
  - [x] `make gate` в worktree зелёный (venv в worktree уже создан при 6.1 — ретро AI-2); `ruff format` — только по конкретным изменённым файлам
  - [x] Сверить File List с фактическим git-диффом (ретро AI-3: 0 документационных MEDIUM в E6)

## Dev Notes

### Эталоны — всё уже в кодовой базе, ничего не изобретать

| Что | Откуда копировать паттерн |
|---|---|
| Внутренний счётчик-модель без API (bare `models.Model`, updated_at auto_now) | `apps/core/models.py:426-439` `Watermark` — «Internal bookkeeping» |
| PositiveIntegerField + явный `chk_*_min` (belt-and-braces) | `apps/operations/submissions/models/daily_submission.py:69,121-123` (`version` + `chk_daily_submission_version_min`) |
| `\S`-regex non-blank CheckConstraint | `apps/documents/models.py` (Attachment, 6.1) |
| Лок-селектор с docstring «use inside a transaction» | `apps/core/selectors.py:255-261` `lock_employee`; `apps/operations/submissions/selectors.py:124-131` `latest_for(lock=True)` |
| Load-bearing docstring про лок под READ COMMITTED | `apps/operations/statuses/services/status_service.py:438-455` `_lock_for_edit` |
| Concurrency-тест (маркер, Barrier, connection.close, join+is_alive) | `apps/operations/statuses/tests/test_employee_status_concurrency.py:95-200` |
| IntegrityError-тест констрейнтов | `apps/documents/tests/test_attachment_model.py` |
| kwargs-only сервис, docstring-нарратив на русском | `apps/documents/services.py` `create_attachment` (6.1) |

### ⚠️ Ловушка №1 (ГЛАВНАЯ): bootstrap-гонка НЕ должна травить транзакцию финализации

`allocate_number` работает ВНУТРИ чужого `transaction.atomic` (финализация 6.5). Голый `IntegrityError` внутри atomic оставляет транзакцию aborted (урок 5.6b→5.7a; deferred-work.md стр. 253). Правильная механика:

- **`get_or_create(doc_type=…, year=…, defaults={"last_number": 0})`** — Django внутри оборачивает `create` в savepoint и при `IntegrityError` (проигрыш гонки на unique-индексе) откатывает ТОЛЬКО savepoint и повторяет `get()`. Внешняя транзакция не отравлена. Это работает ТОЛЬКО потому, что `uq_document_sequence_doc_type_year` существует — unique-констрейнт здесь load-bearing, не декорация.
- Семантика Postgres READ COMMITTED в гонке: T2 при INSERT конфликтующей пары ВИСНЕТ на unique-индексе до исхода T1; коммит T1 → `IntegrityError` у T2 → savepoint-rollback → повторный `get()` видит строку (новый снапшот на statement); откат T1 → INSERT T2 проходит. Оба исхода корректны, наружу ничего не летит.
- **После `get_or_create` строка НЕ залочена** — обязательна перечитка `select_for_update().get(...)` через селектор. Пропуск перечитки = lost update (два потока читают одно значение, оба пишут +1 → дубль номера). Deferred-work стр. 340 документирует ровно этот класс гонки.
- НЕ изобретать альтернативы: `exists()+create()` — гонка; `bulk_create(ignore_conflicts=True)` — прецедента в кодовой базе нет; advisory lock (`core/locks.py`) — session-level инструмент для МЕЖ-транзакционных прогонов (catch-up), для внутри-транзакционного счётчика не годится и не нужен.

### ⚠️ Ловушка №2: что конкретно значит «MUST NOT: Postgres SEQUENCE»

`nextval()` НЕ транзакционен: взятый номер при откате не возвращается → дырка. Поэтому запрещены ВСЕ формы: `CREATE SEQUENCE` в миграции, `GENERATED … AS IDENTITY`, `AutoField`/`SmallAutoField` для номера документа, `serial`-типы. Наша механика — обычная integer-колонка `last_number` + row-лок до коммита: откат отменяет и инкремент. Ревью-проверка: в сгенерированной миграции 0002 нет ни одного упоминания sequence, кроме неявного BigAutoField PK самой строки счётчика (PK строки — НЕ номер документа, его транзакционность не важна).

### ⚠️ Ловушка №3: `select_for_update` вне транзакции и устройство тестов

- Вне atomic `select_for_update` кидает `TransactionManagementError` — это ЖЕЛАЕМЫЙ имплицитный энфорс контракта «только в транзакции финализации» (runtime-assert `in_atomic_block` в кодовой базе не принят — house style: load-bearing docstring + имплицитный энфорс; прецедентов программной проверки НЕТ, не вводить).
- Обычный `pytest.mark.django_db`-тест сам живёт внутри транзакции — «вне atomic» в нём не воспроизвести. Тест на `TransactionManagementError` требует `django_db(transaction=True)` (autocommit) — и потому живёт ТОЛЬКО в concurrency-файле с маркером (Ловушка №4: любой `transaction=True`-тест в gate валит teardown-flush). Учесть побочку: до TME `get_or_create` УЖЕ закоммитил строку — прибрать в `finally`.
- Unit-тест отката (AC-2) потоков НЕ требует: вложенный `atomic` (savepoint) + исключение → проверка, что номер переиспользован. Он бежит в gate — gap-tolerance закрыта гейтом, а не только test-full.

### ⚠️ Ловушка №4: concurrency-маркер, teardown-ERROR'ы и где что бежит

- ЛЮБОЙ `django_db(transaction=True)`-тест (не только с потоками) ОБЯЗАН нести `@pytest.mark.concurrency`: `make gate` маркер деселектит (`-m "not property and not concurrency and not slow"`, Makefile:68). Причина жёсткая и эмпирически проверенная: teardown такого теста делает flush → `TRUNCATE audit_logs` → statement-триггер `trg_audit_logs_no_truncate` (`apps/audit/migrations/0002:51-54`) срабатывает ДАЖЕ НА ПУСТОЙ таблице → `1 passed, 1 error`, pytest exit ≠ 0 → gate красный. Gate сегодня зелёный только потому, что оба существующих `transaction=True`-теста замаркированы concurrency.
- Следствие: каждый `transaction=True`-тест 6.2 даёт ровно 1 ожидаемый teardown-ERROR НЕЗАВИСИМО от того, пишет ли он audit-строки. Явный прогон трёх тестов → `3 passed, 3 errors (teardown)`; фон `make test-full` вырастет с 2 pre-existing до 5 — это НЕ регрессия (quality-bar проекта = `make gate`). Критерий успеха прогона — `3 passed` и все error'ы строго teardown-flush.
- В каждом воркере: своё соединение + `connection.close()` в `finally` (иначе висящие коннекты); `threading.Barrier(2)` с `timeout`; `join(timeout)` + `assert not thread.is_alive()`.
- `clock.override` — ContextVar, в потоки НЕ пропагирует (тут не нужен — сервис времени не читает, но помнить при отладке).
- `transaction=True` отключает транзакционную изоляцию тестов → ручной cleanup в `finally` (прецедент `test_employee_status_concurrency.py:194-200`).

### ⚠️ Ловушка №5: базовая модель — operations.TimeStampedModel ЗАПРЕЩЁН

AST-гвард `apps/documents/tests/test_isolation.py` банит `apps.operations.*` во ВСЕЙ app. Integer-PK база живёт в operations → недоступна. Третью базовую модель вводить нельзя (architecture.md стр. 422). Решение — bare `models.Model` (Д2, прецедент Watermark). `UUIDTimeStampedModel` НЕ брать: UUID PK — для внешне-видимых сущностей (стр. 420), счётчик наружу не отдаётся, `created_by` для системной строки бессмыслен.

### ⚠️ Ловушка №6: Admin и аудит — НЕ трогать

- Admin: documents прямо в списке запретов (architecture.md стр. 469 «MUST NOT: регистрация … документов»); гвард `test_admin_registry_is_exactly_catalogs` поймает.
- Аудит: у 6.2 нет ни HTTP-роута (AUDIT_MATRIX обходит только URL-resolver — правок не нужно), ни `record()`-вызова (facet B не затронут). Аудит ВЫПУСКА с номером — зона 6.5 (`DOCUMENT_*`-коды сеет первая генераторная стори — ретро E5 урок №4; 6.2 — НЕ генераторная, коды не сеет).

### ⚠️ Ловушка №7: дедлок — контракт, а не код

Один вызов = лок одной строки → дедлок невозможен. Опасность появится, если будущий вызывающий аллоцирует НЕСКОЛЬКО типов в одной транзакции встречным порядком. Зафиксировать в docstring сервиса: «при мульти-аллокации в одной транзакции — вызывать в отсортированном порядке `(doc_type, year)`» (зеркало `lock_employees` с `order_by("id")`, `apps/core/selectors.py:263-278`). Retry-обёртки на `DeadlockDetected` НЕ строить (gold-plating; deferred-work стр. 31 — awareness, не мандат).

### Дефолты (приняты мной — поднять на ревью, если не согласен)

- **Д1. Размещение — `apps/documents`** (models.py, services.py, selectors.py 6.1). В architecture.md есть drift: дерево стр. 528 кладёт DocumentSequence в `operations/reports/`, но Data Flow стр. 624 («documents: … Attachment + DocumentSequence»), граница стр. 591 (`documents ← operations` — разрешённая стрелка) и факт 6.1 (top-level app documents уже существует) — за documents. Потребитель-финализация 6.5 живёт в documents-потоке. Стр. 528 считаю документационным дрейфом; НЕ создавать app `operations/reports` ради счётчика.
- **Д2. База = bare `models.Model`** (Watermark-прецедент `core/models.py:426`): integer BigAutoField PK (default_auto_field app), `updated_at = auto_now` (метаданные фреймворка, не wall-clock домена — тот же механизм, что в базовых моделях). Без `created_at`/`created_by` — зеркало Watermark, счётчик мутируется in-place.
- **Д3. Bootstrap**: `get_or_create(..., defaults={"last_number": 0})` + обязательная перечитка под локом; первый номер года/типа = **1**. Year-rollover = просто новая строка нового года, стартует с 1 (это и есть определённая семантика §82.3).
- **Д4. `doc_type` — свободный CharField(max_length=50) без choices/TextChoices/реестра.** Реестр реальных типов документов появится у выпуска (6.5) — там будут первые литералы. Заводить choices «на вырост» = gold-plating и лишняя миграция при 6.5. Инвариант на этом этапе — только non-blank (`\S`) в БД + санитизация в сервисе.
- **Д5. `year` подаёт вызывающий** (typed kwarg, канон стр. 450; из `business_date` документа — политика 6.5). Сервис/модель wall-clock НЕ читают (стр. 302; AST-гвард). Диапазон-гвард 2000..2200 и в БД (`chk_document_sequence_year_range`), и в сервисе — отсекает перепутанные аргументы (`year=6`, `year=20026`) на границе.
- **Д6. Контрактные нарушения → `ValueError`**, не DomainError: вызывающий — внутренний код (6.5), не HTTP-граница; прецедент — `override_tomorrow_block` кидает ValueError (маппинг на API — зона потребителя). Новые error-codes НЕ вводятся.
- **Д7. Аллокация НЕ аудируется** отдельной записью: номер попадёт в аудит выпуска (6.5) как часть финализации. Реестры (audit-events/error-codes) этой стори не трогаются.
- **Д8. Сервис возвращает голый `int`.** Формат строки номера («№ 12», «взамен исх. № …», нужен ли год в написании) — зона 6.5/генераторов; 6.2 форматирование не делает.
- **Д9. `last_number = PositiveIntegerField(default=0)` + явный `chk_document_sequence_last_number_min`** — осознанное дублирование встроенного чека позитив-филда именованным констрейнтом (зеркало `daily_submission.version`; именованный — greppable и переживает смену типа поля).

### Что уже есть (НЕ переизобретать)

- App `documents` целиком (6.1): apps.py, INSTALLED_APPS, models/services/selectors, миграция 0001, AST-гвард изоляции (rglob — новые файлы подхватит сам).
- `DocumentSequence`, `doc_type`, `last_number`, `allocate` — в кодовой базе НЕ встречаются (проверено grep'ом): greenfield, коллизий имён нет.
- Прецедентов «create-then-lock счётчика внутри чужой транзакции» в кодовой базе НЕТ — эту механику канонизирует ИМЕННО 6.2 (писать docstring'и как канон для будущих счётчиков).
- Никаких новых зависимостей в `pyproject.toml`.

### Границы (что 6.2 НЕ делает)

- **Финализация/выпуск** (снапшот → файл + sha256 + номер, «взамен исх. №», аудит выпуска) → **6.5**. 6.2 не решает, КОГДА и С КАКИМ годом брать номер, — только КАК взять его безопасно.
- **Генераторы** .docx/.xlsx/.csv/.pdf → 6.3/6.4. **AsyncJob** → 6.6. **Скачивание/повторная выдача** → 6.7.
- **API/urls/serializers/Admin/RBAC/schema.yaml** — не трогаются вовсе (у счётчика нет HTTP-поверхности; `make schema` НЕ гонять — API не менялся, drift-гейт зелёный без правок; фронт-генерат `schema.d.ts` не трогать).
- **Реестр/choices doc_type**, формат номера, сброс/пере-нумерация, retry на дедлоки, ARCH-ID в Decision Register (механика уже покрыта прозой Process Patterns стр. 468 — новых ПРАВИЛ стори не вводит) — не делать.

### Previous Story Intelligence (6.1, ревью 2026-07-08)

- 6.1 прошла ревью APPROVE (0 CRITICAL/HIGH); гейт-база после 6.1: **1959 passed, 26 deselected**. Прирост 6.2 — только свои тесты; concurrency-тесты уйдут в deselected.
- Ретро AI-2 отработан в 6.1: venv СОЗДАН прямо в worktree (`Backend/VAPS/.venv`), Postgres :5433 поднимает Makefile — окружение для gate готово, не пересоздавать.
- Ретро AI-3: File List сверять с git-диффом (в 6.1 ревью поймало пропущенный QA-файл — не повторять).
- Урок ревью 6.1: `ruff format` только по конкретным изменённым файлам (гейт = `ruff check` E,F — формат не гоняется по папкам).
- Стиль app documents: русскоязычные docstring-нарративы со ссылками на стори/ловушки; kwargs-only сервисы; санитизация на границе по чек-листу (ретро E5 §4.1) — для 6.2 это kwargs `doc_type`/`year`.
- Cross-model/ultra-ревью (ретро AI-4) обязателен для 6.3/6.5/6.9 — 6.2 в списке НЕТ, обычное ревью достаточно.

### Git Intelligence

- Baseline: `9ad9d62` — feat(story-6.1): App documents и Attachment. Паттерн коммитов: `feat(story-N.N): <название>`, коммит после ревью стори.
- Ветка worktree: `claude/exciting-vaughan-3e478b`; основная — `main`.
- `_bmad-output/story-automator/orchestration-*.md` в статусе M — артефакт автоматора, не трогать.

### Project Structure Notes

- Файловый лимит: не-тестовых файлов 4 — `models.py` (M), `services.py` (M), `selectors.py` (M), `migrations/0002_documentsequence.py` (N) ≤ 5 ✔; тесты вне лимита (правило №4); модель + её схемная миграция = одна стори (правило №2). Одна app — правило «≤2 app» не задето.
- Тесты — в `apps/documents/tests/` (канон стр. 631: тесты в app, чей код проверяют); отдельный файл под concurrency — чтобы деселект-граница gate/test-full была видна по имени файла.

### References

- [Source: _bmad-output/planning-artifacts/epics.md §Story 6.2 (стр. 823-829); §Story 6.5 — контракт потребителя (стр. 848-856); AR-7 «DocumentSequence (gap-tolerant)» (стр. 109); §Правила декомпозиции (стр. 248-254)]
- [Source: _bmad-output/planning-artifacts/architecture.md §Process Patterns «Нумерация документов» (стр. 468) — ВЕРБАТИМ-источник требования; «Конкурентность» (стр. 464); «Django Admin» (стр. 469); §Naming Patterns → БД (стр. 404-408); §Базовые модели (стр. 419-422); §Layer Contract kwargs (стр. 450); Clock-канон (стр. 302); §Test Organization/маркеры (стр. 629-644); границы/Data Flow (стр. 591, 624; drift стр. 528); ARCH-DATA-020 (стр. 750), ARCH-DEFERRED-044 «единичный транзакционный тест» (стр. 769)]
- [Source: _bmad-output/implementation-artifacts/deferred-work.md стр. 140 п.(1) — мандат §82.3; стр. 26 (NULL-семантика unique), 31 (deadlock как conflict), 253 (savepoint-дисциплина), 340 (гонка без select_for_update)]
- [Source: _bmad-output/implementation-artifacts/epic-5-retro-2026-07-08.md — AI-2 (worktree venv), AI-3 (File List), AI-4 (cross-model только 6.3/6.5/6.9), урок №1 (санитизация), урок №4 (DOCUMENT_*-коды — у генераторных стори)]
- [Source: Backend/VAPS/apps/core/models.py:426-439 — Watermark; apps/core/selectors.py:255-278 — lock_employee/lock_employees; apps/operations/statuses/services/status_service.py:438-455 — _lock_for_edit docstring; apps/operations/statuses/tests/test_employee_status_concurrency.py — скелет concurrency-теста; apps/operations/submissions/models/daily_submission.py:69,97-147 — стиль констрейнтов; apps/documents/* — конвенции 6.1]
- [Source: Backend/VAPS/Makefile:52-73 (gate деселект маркеров), pyproject.toml:33-38 (строгие маркеры: property/concurrency/slow)]
- Примечание: `docs/PersonnelStatus/VAPS_7.8.2.md` (§82.3) в репо ОТСУТСТВУЕТ (не закоммичен — известный факт двух окружений); семантика §82.3 фиксируется этой стори + docstring'ами модели/сервиса + отметкой в deferred-work.md (Task 6).

### Открытые вопросы (для Bratan — НЕ блокируют, приняты дефолты)

- Q1: Диапазон year-гварда 2000..2200 (Д5) — подтвердить (или сузить к 2020..2100).
- Q2: `doc_type` без реестра/choices до 6.5 (Д4) — ок? Первые литералы типов появятся у выпуска.
- Q3: Нужна ли строка в Decision Register (ARCH-ID) для канона «счётчик = строка + row-лок, не SEQUENCE», или прозы Process Patterns стр. 468 достаточно (Д-позиция: достаточно, новых правил не вводим)?

## Dev Agent Record

### Agent Model Used

Claude Fable 5 (claude-fable-5)

### Debug Log References

- Unit-тесты (Postgres :5433): `21 passed in 1.31s` — зелёные с первого прогона.
- Concurrency-тесты (полная команда из Task 5, Postgres :5433): `3 passed, 86 deselected, 3 errors in 1.45s` — все 3 error строго teardown-flush (`Database test_vaps couldn't be flushed` — TRUNCATE audit_logs × statement-триггер append-only), ровно как предсказано Ловушкой №4.
- `make gate`: `1980 passed, 29 deselected in 35.08s`, `No changes detected` (makemigrations --check), ruff чист, `gate duration: 37s`. Дельта к базе 6.1 (1959 passed, 26 deselected): +21 своих unit-тестов, +3 concurrency в deselected — ровно ожидаемый прирост, ноль регрессий.

### Completion Notes List

- **Task 1**: `DocumentSequence` — bare `models.Model` (Д2, зеркало Watermark): `doc_type` CharField(50), `year`/`last_number` PositiveIntegerField, `updated_at` auto_now, неявный BigAutoField PK. Все 4 констрейнта AC-4 (`uq_document_sequence_doc_type_year`, `chk_*_last_number_min`, `chk_*_year_range` 2000..2200, `chk_*_doc_type_not_blank` `\S`-regex). Миграция `0002_documentsequence` — Django сам дал целевое имя, переименование не понадобилось; `dependencies=[("documents", "0001_attachment")]`; модель + констрейнты = одна миграция; в файле НЕТ ни одной формы SEQUENCE (Ловушка №2 проверена глазами). В Admin НЕ регистрировалась (гвард `test_admin_registry_is_exactly_catalogs` зелёный в гейте).
- **Task 2**: `selectors.lock_sequence(*, doc_type, year)` — `select_for_update().get(...)`, docstring «Use inside a transaction» (зеркало `lock_employee`). Лок в селекторе, инкремент в сервисе (канон стр. 464).
- **Task 3**: `services.allocate_number(*, doc_type, year)` — санитизация по чек-листу (strip → непустое → ≤50; `bool` отвергается до `int`-проверки; диапазон 2000..2200) → `get_or_create(defaults={"last_number": 0})` (bootstrap под savepoint — внешняя транзакция не отравлена) → ОБЯЗАТЕЛЬНАЯ перечитка под локом через селектор → `+1` → `save(update_fields=...)`. Своего `atomic` не открывает; load-bearing docstring фиксирует канон create-then-lock, механизм «откат без дырки» и контракт против дедлока (сортировка `(doc_type, year)` при будущей мульти-аллокации). Wall-clock не читается (AST-гвард зелёный).
- **Task 4**: 21 unit-тест в gate: все констрейнты через `IntegrityError` от БД (дубль пары, year 1999/2201, пустой/пробельный doc_type, `last_number=-1` через create И через прямой SQL-UPDATE post-insert); имена констрейнтов НЕ ассертились (встроенный чек и `chk_*_min` делят предикат); монотонность 1→2→3 в одной строке; независимость счётчиков `(А,2026)/(А,2027)/(Б,2026)` — каждый с 1 (семантика year-rollover); откат без дырки (вложенный atomic + исключение → номер переиспользован); 9 параметризованных `ValueError`-кейсов санитизации + strip/boundary-50. НИ ОДНОГО `transaction=True` в файле.
- **Task 5**: 3 concurrency-теста (маркер `concurrency` + `django_db(transaction=True)`, скелет 3.14: Barrier(2), `connection.close()` в finally, `join(timeout)` + `is_alive`, ручной cleanup): AC-1 — существующий счётчик 5 → потоки получают `{6,7}`, строка одна, `last_number=7` (проигравший ЖДЁТ на локе, не падает); AC-3/§82.3 — bootstrap-гонка → ровно одна строка, номера `{1,2}`, ноль error-исходов; AC-5 — вызов вне atomic → `TransactionManagementError` (строка от `get_or_create` прибрана в finally — Ловушка №3). В воркерах СВОЙ `transaction.atomic()` (сервис свой не открывает).
- **Task 6**: deferred-work.md п.(1) §82.3 помечен ЗАКРЫТЫМ с фиксацией семантики (get_or_create под unique + row-лок, новый год стартует с 1); `ruff format` — только по 6 конкретным изменённым файлам (урок 6.1); File List сверен с `git status`/`git diff --stat` (ретро AI-3) — совпадение полное.
- Дефолты Д1–Д9 применены как приняты в стори (размещение в `apps/documents`, bare-модель, ValueError, без choices/реестра/аудита/формата номера). Открытые вопросы Q1–Q3 остаются на ревью Bratan.

### File List

- `Backend/VAPS/apps/documents/models.py` (M — класс DocumentSequence + docstring-канон)
- `Backend/VAPS/apps/documents/migrations/0002_documentsequence.py` (N)
- `Backend/VAPS/apps/documents/selectors.py` (M — lock_sequence)
- `Backend/VAPS/apps/documents/services.py` (M — allocate_number)
- `Backend/VAPS/apps/documents/tests/test_document_sequence.py` (N — 21 unit-тест, gate)
- `Backend/VAPS/apps/documents/tests/test_document_sequence_concurrency.py` (N — 3 теста, test-full)
- `Backend/VAPS/apps/documents/tests/test_document_sequence_allocation_contract.py` (N — 8 QA-судей / 9 кейсов, gate; скилл qa-generate-e2e-tests)
- `_bmad-output/implementation-artifacts/tests/test-summary.md` (M — QA-сводка 6.2)
- `_bmad-output/implementation-artifacts/deferred-work.md` (M — §82.3 п.(1) закрыт)
- `_bmad-output/implementation-artifacts/sprint-status.yaml` (M — статус стори)
- `_bmad-output/implementation-artifacts/6-2-documentsequence.md` (M — этот файл)

## Senior Developer Review (AI)

**Reviewer:** Bratan (автономный review-flow story automator) — 2026-07-08
**Outcome:** ✅ **APPROVE** — 0 CRITICAL, 0 HIGH, 0 MEDIUM, 2 LOW (исправлены на месте)

### Проверено адверсариально

- **Git vs File List**: полное совпадение (ретро AI-3); `orchestration-*.md` — задокументированный артефакт автоматора, не расхождение.
- **AC-1..AC-3**: concurrency-тесты ПРОГНАНЫ живьём на Postgres :5433 — `3 passed, 95 deselected, 3 errors`, все 3 error строго teardown-flush (Ловушка №4 подтверждена эмпирически). Сериализация `{6,7}` на row-локе, bootstrap-гонка `{1,2}` в одной строке без утечки IntegrityError, TME вне atomic.
- **AC-4**: миграция 0002 сверена с моделью поле-в-поле; все 4 констрейнта с именами из AC; ноль SEQUENCE-примитивов (плюс QA-гвард сканирует миграции). IntegrityError-тесты от живой БД, включая post-insert raw-SQL вектор.
- **AC-5**: kwargs-only, санитизация по чек-листу (bool до int — проверено), `select_for_update` в селекторе / инкремент в сервисе (канон стр. 464), перечитка под локом после `get_or_create` на месте, wall-clock не читается, первый номер = 1.
- **AC-6**: `make gate` прогнан ревьюером дважды (до и после фиксов): `1989 passed, 29 deselected`, `makemigrations --check` пуст, ruff чист. API/urls/admin/audit/RBAC/schema.yaml не тронуты — подтверждено git-диффом.
- **Task-аудит**: все чекбоксы `[x]` сверены с кодом; заявленные счётчики тестов пересчитаны (21 unit + 9 QA-кейсов + 3 concurrency); дельта гейта 1959→1989 / 26→29 сходится.
- Механика get_or_create-savepoint под READ COMMITTED промоделирована по шагам (победитель/проигравший, оба исхода отката T1) — корректна, наружу ничего не летит.

### Findings (все исправлены)

1. **[LOW][fixed]** `services.py:1` — модульный docstring остался «Story 6.1 — сервис записи вложений», хотя модуль теперь несёт и `allocate_number` (6.2). Заголовок расширен.
2. **[LOW][fixed]** `selectors.py:1` — тот же дрейф заголовка («read-канал Attachment»), модуль несёт `lock_sequence` (6.2). Заголовок расширен.

Дефолты Д1–Д9 валидны; открытые вопросы Q1–Q3 остаются Bratan'у (не блокируют — приняты дефолты).

## Change Log

- 2026-07-08 — create-story (Claude Fable 5): стори создана; полный контекст-анализ (architecture §Process Patterns 464/468, deferred-work §82.3-мандат, прецеденты Watermark/lock_employee/concurrency-тест 3.14, ретро E5) двумя параллельными research-агентами; fresh-context валидация по checklist.md с ЭМПИРИЧЕСКОЙ проверкой на живой Postgres-БД нашла и закрыла 2 CRITICAL: (1) `transaction=True`-тест в gate-файле валит teardown-flush (statement-триггер audit append-only срабатывает на пустой таблице) — TME-тест перенесён в concurrency-файл; (2) ожидаемые teardown-ERROR'ы задокументированы честно (`3 passed, 3 errors`, test-full фон 2→5 — не регрессия); плюс пиннинг полной Postgres-команды прогона (SQLite молча игнорирует select_for_update) и atomic-обёртка в воркерах. Механика get_or_create-savepoint сверена с исходниками Django 5.1.15. Status: ready-for-dev.
- 2026-07-08 — dev-story (Claude Fable 5): все 6 задач реализованы строго по спеке, ноль отклонений от дефолтов Д1–Д9. Модель + миграция 0002 (4 констрейнта, без SEQUENCE), lock_sequence-селектор, allocate_number с get_or_create-bootstrap + перечиткой под локом, 21 unit-тест (gate) + 3 concurrency-теста (test-full). Прогоны: unit `21 passed`; concurrency на Postgres `3 passed, 3 errors` (все error — teardown-flush, как предсказано); `make gate` зелёный `1980 passed, 29 deselected, 37s`, makemigrations --check пуст. deferred-work.md §82.3 п.(1) закрыт. API/urls/admin/audit/RBAC/schema.yaml не тронуты. Status: review.
- 2026-07-08 — review (Claude Fable 5, автономный flow story automator): адверсариальное ревью с эмпирической верификацией — `make gate` (1989 passed, 29 deselected, чист makemigrations --check) и concurrency-прогон на Postgres (`3 passed, 3 errors` — все teardown-flush) воспроизведены ревьюером; все AC/таски/счётчики тестов сверены с кодом и git-диффом. 0 CRITICAL/HIGH/MEDIUM; 2 LOW (устаревшие модульные docstring-заголовки services.py/selectors.py «Story 6.1») исправлены на месте, гейт перепрогнан зелёным. Outcome: APPROVE. Status: review → done; sprint-status синхронизирован.
- 2026-07-08 — qa-generate-e2e-tests (Claude Fable 5): мутационный gap-анализ dev-сьюта; главная находка — механизм лока судился ТОЛЬКО в test-full (мутация «убрать select_for_update» проходила gate зелёным). 8 QA-судей / 9 кейсов в новом `test_document_sequence_allocation_contract.py` (все в gate): структурный судья лока (ровно один FOR UPDATE, ноль SAVEPOINT), границы year 2000/2200 принимаются, откат bootstrap-транзакции целиком, две аллокации одной пары в одной транзакции, слияние padded doc_type, updated_at в update_fields, анти-AutoField + анти-SEQUENCE скан миграций. Невакуумность: 2 мутационные пробы (каждая краснит РОВНО своего судью при зелёном dev-сьюте, откачены). `make gate`: **1989 passed, 29 deselected (38s)**. Dev-модули, прод-код, concurrency-контракт «3 passed, 3 errors» не тронуты. Сводка: `tests/test-summary.md`.
