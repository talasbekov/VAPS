---
baseline_commit: 00998e7 (+ uncommitted 4.1: app `apps/audit` + модель `AuditLog`, db_table `audit_logs`, review-passed→done; ветка e3-catchup-clock-concurrency; E4 in-progress)
---

# Story 4.2: Append-only на уровне БД

Status: done

<!-- ВТОРАЯ стори E4 (Аудит). Узкая: ОДНА миграция `audit/0002_*` (RunSQL) — триггер-функция +
     BEFORE UPDATE / BEFORE DELETE row-триггеры на `audit_logs`, RAISE при мутации; + REVOKE
     UPDATE/DELETE (ARCH-SEC-032) — поверх модели `AuditLog` (4.1). БЕЗ сервиса записи/request_id
     (4.3), БЕЗ событий статусов (4.4), БЕЗ read-API (4.5), БЕЗ отдельной app-роли (E12/deploy).
     КЛЮЧЕВОЙ ФАКТ: app коннектится ВЛАДЕЛЬЦЕМ таблицы (`vaps`) → owner байпасит REVOKE →
     реальный барьер = ТРИГГЕР; REVOKE — defense-in-depth/спек-буква (символичен при текущей
     single-owner-роли). -->

## Story

As a **аудитор**,
I want **неизменяемость таблицы `audit_logs` свойством БД: `BEFORE UPDATE`/`BEFORE DELETE` триггер, который RAISE при любой попытке мутации строки, плюс `REVOKE UPDATE, DELETE` (ARCH-SEC-032) — одной миграцией `audit/0002_*` (RunSQL, forward+reverse), без изменения модели**,
so that **append-only аудита — гарантия БД, а не договорённость: UPDATE/DELETE записи аудита отклоняется на уровне БД (даже от владельца-роли через триггер), а INSERT (append) продолжает работать; фундамент для сервиса записи (4.3), событий статусов (4.4) и read-API (4.5) (FR-36, ARCH-SEC-032, AR-9)**.

## Acceptance Criteria

1. **Given** миграция `apps/audit/migrations/0002_*` (`migrations.RunSQL` с `sql`+`reverse_sql`, `dependencies=[("audit","0001_initial")]`), **When** `migrate`, **Then** на `audit_logs` созданы: триггер-функция (PL/pgSQL, RAISE) + `BEFORE UPDATE` row-триггер + `BEFORE DELETE` row-триггер; выполнен `REVOKE UPDATE, DELETE ON audit_logs FROM PUBLIC`. Round-trip `migrate audit 0001` (reverse) чист — `DROP TRIGGER`/`DROP FUNCTION` снимают всё; повторный `migrate` восстанавливает. `makemigrations --check` пуст (RunSQL без `state_operations` — состояние модели не меняется, дрейфа нет).
2. **Given** существующая строка `AuditLog` (INSERT через ORM проходит — **append разрешён**), **When** приложение выполняет `UPDATE audit_logs SET action=... WHERE id=...` (raw cursor ИЛИ ORM `.update()`/`.save()`), **Then** БД отклоняет операцию исключением триггера; строка не изменена. *(Enforcement — ТРИГГЕР: app коннектится владельцем `vaps`, owner байпасит REVOKE, триггер фактический барьер.)*
3. **Given** существующая строка `AuditLog`, **When** приложение выполняет `DELETE FROM audit_logs WHERE id=...` (raw cursor ИЛИ ORM `.delete()`), **Then** БД отклоняет исключением триггера; строка на месте.
4. **Given** триггер RAISE, **Then** используется `USING ERRCODE = 'restrict_violation'` (SQLSTATE 23001, класс 23) → Django разворачивает в **`IntegrityError`** (консистентно с exclusion-тестами 3.x и exception-handler 3.1); сообщение содержит `audit_logs` и `append-only`. **And** `INSERT` НЕ затронут — `AuditLog.objects.create(...)` после установки триггеров продолжает работать (append-only ≠ no-insert).
5. **And** анти-gold-plating: **только миграция `0002` (функция+2 триггера+REVOKE) + Postgres-тесты append-only**. НЕ строится: `audit.services.record()`/request_id-middleware (4.3), события мутаций статусов (4.4), read-API (4.5), отдельная lower-priv app-роль (E12/deploy), сидинг `action`-реестра. НЕ трогаются: модель `AuditLog`, миграция `0001`, `docs/registries/audit-events.yaml`, другие app. Тест входит в `make gate` (Postgres :5433).

## Tasks / Subtasks

- [x] **Task 1 — миграция `0002` (RunSQL, триггер + REVOKE)** (AC: 1, 2, 3, 4)
  - [x] `apps/audit/migrations/0002_audit_logs_append_only.py` — `migrations.Migration` с `dependencies=[("audit","0001_initial")]`, одна операция `migrations.RunSQL(sql=..., reverse_sql=...)`.
  - [x] `sql` (forward): `CREATE OR REPLACE FUNCTION audit_logs_reject_modification() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'audit_logs is append-only (ARCH-SEC-032): % rejected', TG_OP USING ERRCODE = 'restrict_violation'; END; $$;` → `CREATE TRIGGER trg_audit_logs_no_update BEFORE UPDATE ON audit_logs FOR EACH ROW EXECUTE FUNCTION audit_logs_reject_modification();` → `CREATE TRIGGER trg_audit_logs_no_delete BEFORE DELETE ON audit_logs FOR EACH ROW EXECUTE FUNCTION audit_logs_reject_modification();` → `REVOKE UPDATE, DELETE ON audit_logs FROM PUBLIC;`
  - [x] `reverse_sql`: `DROP TRIGGER IF EXISTS trg_audit_logs_no_update ON audit_logs;` `DROP TRIGGER IF EXISTS trg_audit_logs_no_delete ON audit_logs;` `DROP FUNCTION IF EXISTS audit_logs_reject_modification();` (GRANT назад НЕ нужен — на свежей таблице PUBLIC не имел UPDATE/DELETE; REVOKE символичен — см. Dev Notes).
  - [x] (Рекомендуется, см. Решение TRUNCATE) добавить `CREATE TRIGGER trg_audit_logs_no_truncate BEFORE TRUNCATE ON audit_logs FOR EACH STATEMENT EXECUTE FUNCTION audit_logs_reject_modification();` + соответствующий `DROP TRIGGER` в reverse.
- [x] **Task 2 — Postgres-тесты append-only** (AC: 2, 3, 4)
  - [x] `apps/audit/tests/test_audit_append_only.py` (`@pytest.mark.django_db` + skip-if-not-postgresql): `test_update_via_raw_sql_rejected`, `test_delete_via_raw_sql_rejected`, `test_orm_update_rejected` (`AuditLog.objects.filter(pk=...).update(...)`), `test_insert_still_allowed` (create после триггеров проходит). Каждый отказной — `with pytest.raises(IntegrityError), transaction.atomic():`; ассерт `append-only`/`audit_logs` в сообщении; после — строка не изменена/на месте (в новом savepoint).
  - [x] (если включён TRUNCATE-триггер) `test_truncate_rejected` (raw `TRUNCATE audit_logs`).
  - [x] Postgres-guard: `pytestmark = [pytest.mark.django_db, pytest.mark.skipif(connection.vendor != "postgresql", reason="append-only enforced by Postgres trigger")]` (триггер — Postgres-only; на sqlite-дефолте UPDATE прошёл бы → тест должен скипаться, не падать ложно). Сверить, нет ли уже проектного postgres-only-маркера/фикстуры — если есть, переиспользовать.
- [x] **Task 3 — гейт и регрессия** (AC: 1, 5)
  - [x] `make gate` зелёный (Postgres :5433); `makemigrations --check` пуст (RunSQL не меняет model-state); ruff чист (`ruff format` миграции под 88 cols). Регрессия нулевая: только новый `0002_*` + новый `test_audit_append_only.py`. `git diff --stat`. Модель/`0001`/реестр/чужие app не тронуты.

## Review Findings

_Code review (bmad-code-review, 2026-06-26, Opus 4.8 — **same-model caveat** (ревьюер = dev); 3 слоя Blind/Edge/Auditor; scoped diff ~165 строк / 2 новых файла WIP-untracked: миграция `0002` + `test_audit_append_only`). Acceptance Auditor: **PASS — AC-1..5 ВСЕ SATISFIED** (RunSQL-форма/depends `0001`/round-trip/`makemigrations`-чист; UPDATE/DELETE raw+orm rejected; ERRCODE `restrict_violation`→`IntegrityError`; INSERT работает; TRUNCATE-guard present; анти-goldplating; тест в gate). Edge подтвердил: у `audit_logs` нет FK (CASCADE недостижим), gate реально гоняет файл на Postgres (триггер оттестирован). **1 decision · 2 patch · 2 defer · 7 dismiss.** Ключевое уточнение (Edge): роль `vaps` = владелец И **суперюзер** (statuses/0001:20) → bypass-поверхность шире, чем только REVOKE._

- [x] [Review][Defer] Append-only «мягкий» против суперюзер-владельца `vaps` [migrations/0002:39-55] — **decision Bratan 2026-06-26: defer жёсткость в E12**. Триггер блокирует обычные UPDATE/DELETE/TRUNCATE (AC-2/3 выполнены, оттестировано — реальная частая угроза: баг в коде делает `.update()`/`.delete()`), НО тот же `vaps` (владелец + суперюзер) может `ALTER TABLE … DISABLE TRIGGER` / `SET session_replication_role='replica'` / `DROP TABLE` и обойти и триггер, и REVOKE. Жёсткая неизменяемость требует выделенной non-owner/non-superuser app-роли (INSERT/SELECT only) — инфра **E12/deploy**, не миграция. **deferred — 4.2 закрывает accidental-mutation угрозу (по AC); hostile-superuser закрывает E12 dedicated-role; стоимость осознанна.**
- [x] [Review][Patch] Усилить `test_update_via_orm_rejected` — ассертил только тип `IntegrityError`, без сообщения. [tests/test_audit_append_only.py] — **ПРИМЕНЕНО+ВЕРИФИЦИРОВАНО:** добавлен `assert "append-only" in str(excinfo.value).lower()` + новый `test_delete_via_orm_rejected` (AC-3 ORM-путь). 6 audit-append-only тестов зелёные на Postgres :5433.
- [x] [Review][Patch] `CREATE OR REPLACE TRIGGER` для идемпотентности — 3 триггера были голый `CREATE TRIGGER`. [migrations/0002:39,45,51] — **ПРИМЕНЕНО+ВЕРИФИЦИРОВАНО:** все 3 → `CREATE OR REPLACE TRIGGER` (PG16/PG14+); миграция применяется чисто на свежей БД, squash-safe, асимметрия с `CREATE OR REPLACE FUNCTION` снята.
- [x] [Review][Defer] Неквалифицированные имена / `search_path` / `DROP FUNCTION` без CASCADE [migrations/0002:29,56-63] — deferred: при единственном потребителе и public-схеме (PG16) работает; риск только при будущем reuse `audit_logs_reject_modification()` на 2-й append-only-таблице или смене схемы. Схемо-квалификация (`public.…`) — когда audit станет мульти-табличным (проект нигде не квалифицирует — консистентность).
- [x] [Review][Defer] Round-trip миграции не покрыт автотестом [migrations/0002] — deferred: round-trip верифицирован ВРУЧНУЮ в dev (forward→reverse→forward; триггеры/функция подтверждены через `pg_trigger`), консистентно с dev-attested паттерном проекта (ops_rbac/0002 round-trip тоже был ручной/«за Bratan»). Migration-state-тест — тест-канон E7.

## Dev Notes

### Цель (одним предложением)

4.2 — превратить append-only `audit_logs` из обещания docstring (4.1) в **свойство БД**: одна миграция `audit/0002_*` (RunSQL) ставит `BEFORE UPDATE`/`BEFORE DELETE` триггеры (RAISE) + REVOKE по ARCH-SEC-032; UPDATE/DELETE отклоняются, INSERT работает. Поведения (сервис/события/API) — НЕ здесь.

### Авторитет спеки (что строим)

- **epics.md:612-618 (Story 4.2):** «As a аудитор, I want REVOKE UPDATE/DELETE для app-роли + триггер на таблице аудита… AC: попытка UPDATE/DELETE записи аудита из приложения → отказ на уровне БД; тест входит в gate.»
- **architecture.md:317 / 756 (ARCH-SEC-032):** «аудит — append-only, enforced БД (REVOKE UPDATE/DELETE + триггер); консолидация на `AuditLog`. **MUST NOT:** raw insert в аудит мимо сервиса; UPDATE/DELETE аудита.»
- **architecture.md:533-534:** `audit/` — «AuditLog append-only (REVOKE/триггер); запись ТОЛЬКО через `audit.services.record()`».
- **§4.6 (`VAPS_7.8.2.md:923-942`):** DDL `audit_logs` — **триггер/REVOKE в §4.6 SQL ОТСУТСТВУЮТ** (только таблица+индекс). Append-only-механика живёт в architecture (ARCH-SEC-032), не в §4.6. → 4.2 ДОБАВЛЯЕТ триггер+REVOKE; это не дрейф, а реализация ADR поверх §4.6-таблицы (как 4.1 зафиксировала: «DB-level enforcement… is story 4.2»). Опционально дописать триггер/REVOKE в §4.6 отдельным doc-касанием (вне 4.2-кода) — за Bratan.

### 🔑 КЛЮЧЕВОЕ РЕШЕНИЕ — триггер = барьер, REVOKE = defense-in-depth (owner байпасит REVOKE)

Приложение и тесты коннектятся как **`vaps`** (`docker-compose.yml` `POSTGRES_USER: vaps`; `Makefile` gate `VAPS_DB_USER=vaps`), и `vaps` — **владелец** таблиц (он же гоняет миграции). В PostgreSQL **владелец таблицы и суперюзер БАЙПАСЯТ `REVOKE`** — `REVOKE UPDATE, DELETE ON audit_logs FROM vaps` НЕ заблокирует приложение. Поэтому:
- **Триггер `BEFORE UPDATE`/`BEFORE DELETE` (RAISE) — фактическое enforcement:** срабатывает для ЛЮБОЙ роли, включая владельца. На него вешаем AC-2/3/4 и тесты.
- **`REVOKE UPDATE, DELETE` — по букве ARCH-SEC-032** (defense-in-depth). При текущей single-owner-роли он **символичен** (на свежей таблице PUBLIC и так без UPDATE/DELETE; owner байпасит). Станет реально значимым, когда E12/deploy введёт выделенную **lower-priv app-роль** (не владелец). Дефолт стори: `REVOKE … FROM PUBLIC` (буква ADR удовлетворена дёшево) + эта заметка. Развилка для Bratan ниже.

### Решения по реализации (дефолты — подтвердить/переопределить)

1. **ERRCODE триггера → `restrict_violation` (23001):** `RAISE EXCEPTION … USING ERRCODE='restrict_violation'`. Класс 23 → Django разворачивает в `IntegrityError` (как exclusion-constraint 3.x; ловится exception-handler 3.1 как 409). Альтернатива — голый `RAISE EXCEPTION` (SQLSTATE P0001 → Django `InternalError`, тест ассертит `DatabaseError`). Рекоменд. `restrict_violation` ради консистентности теста/handler.
2. **TRUNCATE-guard (опц., рекомендуется в скоуп):** row-триггеры `BEFORE UPDATE/DELETE` **не** срабатывают на `TRUNCATE` (это statement-level операция, отдельная от DELETE). Чтобы «неизменяемость — свойство БД» не имела дыры, добавить `BEFORE TRUNCATE … FOR EACH STATEMENT` триггер (та же функция, `TG_OP='TRUNCATE'`). Дёшево, та же миграция. Формально за пределами буквы AC (ARCH-SEC-032 пишет «UPDATE/DELETE»), поэтому — осознанное включение, не scope creep. Развилка для Bratan ниже.
3. **REVOKE-таргет:** `FROM PUBLIC` (символичен сейчас, см. ключевое решение). Альтернатива — отложить REVOKE целиком в E12 (выделенная app-роль) и в 4.2 шиповать только триггер. Дефолт: включить `REVOKE FROM PUBLIC` (буква ARCH-SEC-032).

### Что УЖЕ есть — переиспользовать/НЕ дублировать

- **`apps/operations/rbac/migrations/0002_rename_content_types.py`** — образец миграции с forward+reverse (там `RunPython(forward, reverse)`; для 4.2 — `RunSQL(sql, reverse_sql)`, тот же принцип обратимости). Первая RunSQL-миграция в проекте — точность DDL критична (опечатка в триггере = runtime-облом).
- **`apps/operations/statuses/migrations/0001_employee_status.py`** — образец сложного Postgres-объекта (`ExclusionConstraint`) в миграции (декларативно через ORM; здесь — raw SQL, т.к. триггеры ORM не выражает).
- **`apps/operations/statuses/tests/test_employee_status_model.py:22-33`** — образец теста DB-constraint: `with pytest.raises(IntegrityError): with transaction.atomic(): …` + ассерт имени/сообщения. Зеркалить для append-only.
- **`apps/audit/models.py`** — модель `AuditLog`, `db_table="audit_logs"`; docstring уже описывает append-only (4.2) — **НЕ менять**. **`apps/audit/migrations/0001_initial.py`** — на него `dependencies` нового `0002`.
- **`apps/core/locks.py:37-43`** — образец `with connection.cursor() as cur: cur.execute(...)` (raw SQL из Python) — для отказных тестов через сырой UPDATE/DELETE.
- **`Makefile` gate** — верификация: Postgres :5433, `ruff check`, pytest, `makemigrations --check --dry-run`.

### Подводные камни для dev-агента

- **Триггер, не REVOKE.** Не полагаться на REVOKE как барьер (owner байпасит) — вешать тесты на триггер. Тест, который «проверяет» только REVOKE, дал бы ложно-зелёный (owner всё равно мутирует, если триггера нет).
- **`makemigrations --check` ДОЛЖЕН остаться пуст:** `RunSQL` без `state_operations` не меняет model-state → дрейфа нет. НЕ добавлять `state_operations` (модель не меняется). Не трогать `models.py`.
- **Round-trip обязателен:** `migrate audit 0001` (reverse) и обратно `migrate audit` — чисто. `reverse_sql` дропает оба (три) триггера + функцию. `DROP … IF EXISTS` ради идемпотентности.
- **`ERRCODE` обязателен для IntegrityError:** без `USING ERRCODE` голый RAISE = P0001 → Django `InternalError` (НЕ `IntegrityError`) → ассерт `IntegrityError` упадёт. Это и есть AC-4.
- **Postgres-only тест:** триггер существует только на Postgres. На sqlite-дефолте (`pytest` без `VAPS_DB=postgres`) триггера нет → UPDATE пройдёт → `pytest.raises` упадёт ложно. ОБЯЗАТЕЛЬНО skip-guard по `connection.vendor`. Гейт гоняет Postgres — там тесты активны.
- **`transaction.atomic()` вокруг отказной операции:** RAISE абортит транзакцию; savepoint (`atomic`) держит объемлющую тест-txn живой для последующих ассертов «строка на месте» (как exclusion-тесты / `test_created_at_required_no_auto_default` 4.1).
- **TRUNCATE — отдельный путь:** если включаешь TRUNCATE-guard, это `FOR EACH STATEMENT` (не ROW) и `BEFORE TRUNCATE` — отдельный `CREATE TRIGGER`.
- **Литерал `%` в `RAISE EXCEPTION '… %', TG_OP` под RunSQL:** `RunSQL` исполняет SQL с `params=None` → psycopg НЕ интерполирует `%`-формат, литерал `%` безопасен. **НЕ удваивать до `%%`** (иначе в сообщение уйдёт буквальный `%%`). `$$…$$` dollar-quoting функции — обычный текст в Python-строке миграции, конфликта с Python нет. Многооператорную SQL-строку (функция; триггеры; REVOKE) `RunSQL` исполняет одним `execute` — Postgres парсит `;` (внутри `$$…$$` — dollar-quoted, не рвётся).
- **REVOKE FROM PUBLIC символичен** — не ждать от него блокировки в тесте (тест на REVOKE-эффект НЕ писать; барьер доказывает триггер).
- **Append (INSERT) НЕ блокировать:** триггеры только `BEFORE UPDATE/DELETE/TRUNCATE`. `test_insert_still_allowed` стережёт регресс (случайный `BEFORE INSERT` сломал бы 4.1 и сервис 4.3).
- **Реестр/чужое не трогать:** `audit-events.yaml`, `apps/core`, `apps/operations/*`, существующие миграции.

### Тесты стори

- **Локально:** `make gate` зелёный (Postgres :5433); `makemigrations --check` пуст; ruff чист; `test_audit_append_only.py` зелёный (update-rejected, delete-rejected, orm-update-rejected, insert-allowed [, truncate-rejected]).
- **Регрессия:** нулевая — только новый `0002_*` + новый тест-файл. `git diff --stat`. Модель/`0001`/реестр/чужие app не тронуты.
- **НЕ в этом стори:** сервис записи (4.3), события статусов (4.4), read-API (4.5), app-роль (E12).

### Definition of Done

- [x] Миграция `audit/0002_*` (RunSQL, depends `0001_initial`): триггер-функция + `BEFORE UPDATE` + `BEFORE DELETE` (+ опц. `BEFORE TRUNCATE`) + `REVOKE UPDATE, DELETE … FROM PUBLIC`; `reverse_sql` снимает всё; round-trip чист; `makemigrations --check` пуст.
- [x] UPDATE/DELETE `audit_logs` из приложения (raw + ORM) отклонены триггером с `ERRCODE=restrict_violation` → `IntegrityError`, сообщение `append-only`; INSERT работает.
- [x] Postgres-тесты append-only (skip-if-not-postgresql) зелёные и входят в `make gate`.
- [x] Анти-gold-plating: нет сервиса/событий/API/app-роли/seed; модель/`0001`/реестр/чужие app не тронуты.
- [x] `make gate` зелёный, ruff чист, регрессия нулевая. Completion Notes без вранья.

### Project Structure Notes

- Новые: `apps/audit/migrations/0002_audit_logs_append_only.py`, `apps/audit/tests/test_audit_append_only.py`. Изменяемых production-файлов нет (модель не трогаем). Связная единица (DB-enforcement + тест).
- `apps/audit/` — топ-уровневый app (sibling `core`/`operations`), architecture:533.
- НЕ трогать: `apps/audit/models.py`, `apps/audit/migrations/0001_initial.py`, `docs/registries/audit-events.yaml`, `apps/core`, `apps/operations/*`.

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Story-4.2 (612-618)] — REVOKE UPDATE/DELETE + триггер; AC «отказ на уровне БД; тест в gate».
- [Source: _bmad-output/planning-artifacts/architecture.md (317, 756 ARCH-SEC-032; 533-534 app-размещение; 454-458 communication-pattern «raw insert MUST NOT»; 462 «append-only таблицы — без локов»; 596 makemigrations --check в gate)] — append-only enforced БД, REVOKE+триггер, MUST NOT UPDATE/DELETE.
- [Source: docs/PersonnelStatus/VAPS_7.8.2.md §4.6 (923-942)] — DDL `audit_logs` (триггер/REVOKE в §4.6 SQL отсутствуют — добавляет ADR/4.2).
- [Source: Backend/VAPS/apps/operations/rbac/migrations/0002_rename_content_types.py] — образец forward+reverse миграции (RunPython → для 4.2 RunSQL).
- [Source: Backend/VAPS/apps/operations/statuses/migrations/0001_employee_status.py] — образец Postgres-объекта в миграции (ExclusionConstraint).
- [Source: Backend/VAPS/apps/operations/statuses/tests/test_employee_status_model.py:22-33] — образец теста DB-constraint (`pytest.raises(IntegrityError)` + `transaction.atomic()` + ассерт сообщения).
- [Source: Backend/VAPS/apps/audit/{models.py,migrations/0001_initial.py}] — `db_table="audit_logs"`; зависимость `0002`→`0001_initial`; docstring уже ссылается на 4.2.
- [Source: Backend/VAPS/apps/core/locks.py:37-43] — `connection.cursor()` raw-SQL паттерн.
- [Source: Backend/VAPS/Makefile (gate, Postgres :5433)] — верификация.
- [Source: _bmad-output/implementation-artifacts/4-1-app-audit-и-модель-auditlog.md] — предыдущая стори (модель AuditLog; review-passed, defer'ы 4.1: NOT NULL ip/entity → 4.3/4.4, индексы → 4.5).

## Dev Agent Record

### Agent Model Used

claude-opus-4-8[1m] (Opus 4.8, 1M context)

### Debug Log References

- **Red-green-refactor (явный red):** тест-файл написан ПЕРВЫМ, прогон до миграции → **4 failed** (`DID NOT RAISE`: UPDATE/DELETE/TRUNCATE проходят без триггера) + 1 passed (`insert_still_allowed`). Доказал, что тесты не вакуумны. После миграции `0002` → **5 passed**.
- **RunSQL — list-форма (не строка):** `RunSQL(sql=[...])` исполняет каждый оператор verbatim с `params=None`. Это решает ДВЕ проблемы разом: (1) Django НЕ гоняет `prepare_sql_script`/`sqlparse`, который мог бы неверно порезать тело функции по `;` внутри `$$…$$`; (2) `params=None` → psycopg НЕ интерполирует `%`, поэтому `RAISE EXCEPTION '… %', TG_OP` остаётся с одинарным `%` (без экранирования `%%`).
- **ERRCODE = restrict_violation (23001, класс 23):** триггер RAISE с этим errcode → Django разворачивает в `IntegrityError` (как exclusion-constraint 3.x), тесты ассертят `IntegrityError` + `append-only` в сообщении.
- **owner байпасит REVOKE (подтверждено):** app=`vaps`=владелец таблицы → REVOKE для него no-op; enforcement = триггер (fires for all roles). REVOKE FROM PUBLIC оставлен по букве ARCH-SEC-032 (defense-in-depth, символичен при single-owner).
- **TRUNCATE-guard включён** (рекоменд. дефолт): row-триггеры BEFORE UPDATE/DELETE не ловят TRUNCATE → отдельный `BEFORE TRUNCATE … FOR EACH STATEMENT`. `test_truncate_rejected` зелёный.
- **Round-trip ВЕРИФИЦИРОВАН на dev-БД:** `migrate audit` (0001+0002 OK) → `migrate audit 0001` (reverse 0002 OK, без ошибок) → `migrate audit` (re-forward OK); после — `pg_trigger` показывает все 3 триггера + функцию `audit_logs_reject_modification` на месте (проверка через ORM, не psql).
- **VERIFIED:** `make gate` зелёный — **1295 passed** (+5 append-only-тестов к 1290), 24 deselected, 23s; `makemigrations --check` → «No changes detected» (RunSQL без `state_operations` — model-state не меняется); `ruff check`/`format` чисты (E501 в docstring теста починен). Регрессия нулевая: только новый `0002_*` + новый тест-файл, модель/`0001`/реестр/чужие app не тронуты.

### Completion Notes List

4.2 — append-only `audit_logs` enforced БД (ARCH-SEC-032). `make gate` зелёный.

- ✅ **Task 1:** миграция `0002_audit_logs_append_only` (RunSQL list-форма): функция `audit_logs_reject_modification` (RAISE, errcode `restrict_violation`) + триггеры `BEFORE UPDATE`/`BEFORE DELETE` (row) + `BEFORE TRUNCATE` (statement) + `REVOKE UPDATE, DELETE … FROM PUBLIC`; `reverse_sql` дропает всё; round-trip чист.
- ✅ **Task 2:** 5 Postgres-тестов (skip-if-not-postgresql): update-raw / update-orm / delete-raw отклонены (`IntegrityError`, `append-only`), insert разрешён, truncate отклонён.
- ✅ **Task 3:** `make gate` зелёный (1295 passed), `makemigrations --check` пуст, ruff чист, регрессия нулевая.
- **Развилки create-story — все три взяты дефолтами:** ERRCODE=`restrict_violation`→IntegrityError; TRUNCATE-guard ВКЛЮЧЁН; REVOKE `FROM PUBLIC`. Открыто (за Bratan, вне 4.2-кода): дописать триггер/REVOKE в §4.6/architecture doc-касанием; выделенная lower-priv app-роль (чтобы REVOKE стал не символичным) — E12/deploy.
- **Анти-gold-plating:** нет сервиса записи (4.3)/событий (4.4)/API (4.5)/app-роли (E12)/seed; модель/`0001`/`audit-events.yaml`/чужие app не тронуты.

**Статус → review.**

### File List

**Создать:**
- `Backend/VAPS/apps/audit/migrations/0002_audit_logs_append_only.py`
- `Backend/VAPS/apps/audit/tests/test_audit_append_only.py`

**Изменить:** _(нет production-файлов; модель не трогаем)_

## Change Log

- 2026-06-26 — Create-Story (bmad-create-story, Opus 4.8): создана стори 4.2 — append-only `audit_logs` на уровне БД (триггер BEFORE UPDATE/DELETE + REVOKE, ARCH-SEC-032) поверх модели 4.1. Заземлена на эксгаустивный анализ артефактов (epics/architecture/§4.6) + кодовой базы. Ключевое открытие: app=владелец таблицы → owner байпасит REVOKE → enforcement = триггер; REVOKE = defense-in-depth/спек-буква. Открытые развилки (ERRCODE, TRUNCATE-guard, REVOKE-таргет) с рекоменд-дефолтами — за Bratan. Status → ready-for-dev.
- 2026-06-26 — Dev (bmad-dev-story, Opus 4.8): реализована стори 4.2. Миграция `audit/0002_audit_logs_append_only` (RunSQL list-форма): функция `audit_logs_reject_modification` (RAISE, errcode `restrict_violation`→`IntegrityError`) + триггеры BEFORE UPDATE/DELETE (row) + BEFORE TRUNCATE (statement) + `REVOKE UPDATE, DELETE … FROM PUBLIC`; обратимая (`reverse_sql`), round-trip верифицирован на dev-БД. 5 Postgres-тестов append-only (red-green: 4 failed до миграции → 5 passed после). Все 3 развилки create-story взяты дефолтами (errcode restrict_violation, TRUNCATE-guard включён, REVOKE FROM PUBLIC). `make gate` зелёный (1295 passed, makemigrations пуст, ruff чист), регрессия нулевая. Артефакты НЕ закоммичены агентом. Status → review.
- 2026-06-26 — Code-review (bmad-code-review, Opus 4.8, same-model caveat; 3 слоя): Acceptance Auditor PASS AC-1..5. 1 decision · 2 patch · 2 defer · 7 dismiss. Decision (мягкий append-only против суперюзер-владельца `vaps`) → **defer в E12** (выделенная app-роль; решение Bratan). 2 patch ПРИМЕНЕНЫ+ВЕРИФИЦИРОВАНЫ: усилен `test_update_via_orm_rejected` (ассерт сообщения) + новый `test_delete_via_orm_rejected`; 3 триггера → `CREATE OR REPLACE TRIGGER` (идемпотентность/squash-safe). 2 defer → deferred-work (неквалифиц. имена/search_path; round-trip без автотеста). `make gate` зелёный (1296 passed). Status → done.
