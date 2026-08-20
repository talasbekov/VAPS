---
baseline_commit: fec75d9 (E4 done; 5.1 done [JWT-вход + security-ревью]; ветка e3-catchup-clock-concurrency; epic-5 in-progress)
context:
  - _bmad-output/planning-artifacts/epics.md
  - _bmad-output/planning-artifacts/architecture.md
  - _bmad-output/implementation-artifacts/2-3-настройки-контроля-сдачи.md
---

# Story 5.2: Модель DailySubmission

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

<!-- ВТОРАЯ стори E5 «Сдача дня». ЧИСТО МОДЕЛЬНАЯ стори (model + migration + constraints + tests),
     по правилу декомпозиции CLAUDE.md. App `apps/operations/submissions` УЖЕ существует
     (SubmissionControlSettings из 2.3, migration 0001) — 5.2 ДОБАВЛЯЕТ туда модель DailySubmission.

     ГРАНИЦА СКОУПА (важно): 5.2 определяет ТАБЛИЦУ + констрейнты + документированную форму snapshot.
     НЕ строит: сервис сдачи (срез/diff/вычисление event/late/atomic) — это 5.3; amendment-flow — 5.4;
     amendment-триггер на ретро-правку (хук 3.9) — 5.4; API/экраны — 5.8/E10; селектор сложнее
     get-current — по необходимости 5.3. 5.2 НЕ СОЗДАЁТ строк (нет seed) — только схему.

     ЦЕНТРАЛЬНЫЙ ФАКТ (проверено 3 агентами): идиоматический скелет известен точно —
     • База: `apps.operations.models.TimeStampedModel` (integer BigAutoField PK + created_at/updated_at/
       created_by; НЕ core UUIDTimeStampedModel — operations surrogate-PK integer). Cross-context =
       flat `UUIDField` (ARCH-003, без FK в core — как Secondment.employee_id/from/to_division_id).
     • Snapshot = JSONB-массив ДЕНОРМАЛИЗОВАННЫХ ИНТЕРВАЛОВ-ФАКТОВ (ARCH-DATA-021): per-row
       employee_id/full_name/rank/status_type_code/status_id/date_start/date_end[полуоткрытый,
       ARCH-DATA-023]/source + schema_version. ХРАНИТ ФАКТЫ, НЕ derived (state PLANNED/ACTIVE/расход
       вычисляются из snapshot+business_date — derived-first ARCH-DATA-022/023). Денормализация ФИО/
       звания — потому что сдача = заявление-на-момент-T, поздние правки кадров НЕ переписывают историю.
     • Иммутабельность (ARCH-DATA-021): snapshot после создания не обновляется; amendment = новая версия.
     • Констрейнты (точный синтаксис из EmployeeStatus/Division/UserRole-прецедентов): partial-unique
       `(division_id, business_date) WHERE is_current` + plain unique `(division_id, business_date, version)`.

     ⚠️ ТРАПЫ: (1) база — operations TimeStampedModel, НЕ core UUIDTimeStampedModel; (2) division_id —
     UUIDField (НЕ FK); (3) submitted_at — `DateTimeField()` (НЕ auto_now_add; 5.3-сервис ставит через
     Clock.now() — append-once, как AuditLog.created_at); (4) partial-unique через `condition=Q(is_current=True)`
     (нужен Postgres — гейт Postgres-backed); (5) НЕ хранить в snapshot derived (state/расход/светофор);
     (6) snapshot/event/version/is_current/late ОПРЕДЕЛЯЮТСЯ здесь, но ЗАПОЛНЯЮТСЯ 5.3 (5.2 рядов не пишет).
     Forward-compat (5.3 diff/event, 5.4 version-chain/is_current, 5.10 byte-иммутабельность, 5.11 fractal). -->

## Story

As a **система (учётная модель)**,
I want **таблицу `DailySubmission` (`division_id`, `business_date`, `version`, `is_current`, `event`, `submitted_by`/`submitted_at`, `snapshot` JSONB интервалов-фактов с денормализованными ФИО + `schema_version`, `late`) с DB-констрейнтами «ровно одна текущая версия на (подразделение, день)» и «версии различны»**,
so that **сдача дня хранится как версионируемое, иммутабельное заявление-факт, на котором сервис сдачи (5.3), amendment-flow (5.4) и derived-расход строятся детерминированно (ARCH-DATA-021), а БД гарантирует целостность версий**.

## Acceptance Criteria

### Констрейнты (ядро — тестируемое в 5.2)

1. **Ровно одна текущая версия.** **Given** для `(division_id, business_date)` уже есть строка с `is_current=True`, **When** вставляю вторую с `is_current=True` тем же ключом, **Then** БД отвергает (partial-unique `(division_id, business_date) WHERE is_current` → `IntegrityError`). **And** две версии того же дня с РАЗНЫМ `is_current` (одна True, прочие False) — валидны. [Source: epics.md 5.2 AC; EmployeeStatus/Division UniqueConstraint-прецеденты]
2. **Версии различны.** **Given** строка `(division_id, business_date, version=1)`, **When** вставляю ещё одну с тем же `version=1`, **Then** БД отвергает (unique `(division_id, business_date, version)` → `IntegrityError`); `version=2` тем же ключом — валидна. [Source: epics.md 5.2 AC]

### Форма (документированный контракт; построение — 5.3)

3. **snapshot хранит интервалы-факты, НЕ derived.** **Given** поле `snapshot` (JSONField), **Then** его документированная форма — `{"schema_version": <int>, "rows": [{employee_id, full_name, rank, status_type_code, status_id, date_start, date_end, source}, …]}`: денормализованные интервалы-факты (поля EmployeeStatus), БЕЗ derived-состояний (state/расход/светофор вычисляются из snapshot+business_date). Это контракт модели; ЗАПОЛНЕНИЕ и enforce «не derived» — сервис 5.3. [Source: architecture.md ARCH-DATA-021/022/023; employee_status.py interval-поля]
4. **Поля версионирования и события определены.** **Given** модель, **Then** есть: `division_id` (UUIDField, ARCH-003 flat), `business_date` (DateField), `version` (PositiveIntegerField default 1), `is_current` (BooleanField default True), `event` (CharField choices `Event`: CONFIRMED_NO_CHANGES/CHANGED/AMENDED), `submitted_by` (CharField ≤100, ARCH-007), `submitted_at` (DateTimeField — ставится 5.3-сервисом через Clock, НЕ auto_now_add), `late` (BooleanField default False), `snapshot` (JSONField). + `created_at`/`updated_at`/`created_by` от базы. [Source: epics.md 5.2; agent-2 идиоматический скелет]

### Гейт / границы

5. **Миграция + гейт + анти-gold-plating.** **Given** модель в `apps/operations/submissions`, **Then** `db_table="ops_daily_submissions"`, русский `verbose_name`; миграция 0002 (dep на 0001); `makemigrations --check` пуст после; `make gate` зелёный (Postgres :5433 — partial-unique требует Postgres); `ruff` чист. **And** анти-gold-plating: 5.2 НЕ строит сервис сдачи (5.3)/diff/event-вычисление/amendment(5.4)/API(5.8)/amendment-триггер(хук 3.9→5.4); НЕ создаёт строк (нет seed); НЕ хранит derived в snapshot; селектор — максимум тонкий get-current (или вовсе 5.3). [Source: epics.md 5.3-5.11; реш. №4/№5]

## Tasks / Subtasks

- [x] **Task 1 — модель (AC: 1,2,3,4)**
  - [x] Создать `apps/operations/submissions/models/daily_submission.py`: `class DailySubmission(TimeStampedModel)` (импорт `from apps.operations.models import TimeStampedModel`). Поля: `division_id=UUIDField()`, `business_date=DateField()`, `version=PositiveIntegerField(default=1)`, `is_current=BooleanField(default=True)`, вложенный `class Event(models.TextChoices)` (CONFIRMED_NO_CHANGES/CHANGED/AMENDED с русскими label), `event=CharField(max_length=50, choices=Event.choices)`, `submitted_by=CharField(max_length=100)`, `submitted_at=DateTimeField()` (БЕЗ auto_now_add — append-once, 5.3 ставит через Clock), `late=BooleanField(default=False)`, `snapshot=JSONField(default=dict)`. Докстринг с формой snapshot (schema_version + rows интервалов-фактов) + «иммутабелен после создания; amendment=новая версия (5.4); derived не хранить».
  - [x] `class Meta`: `db_table="ops_daily_submissions"`, `verbose_name`/`verbose_name_plural` (рус.), `constraints=[UniqueConstraint(fields=["division_id","business_date"], condition=Q(is_current=True), name="unique_daily_submission_current"), UniqueConstraint(fields=["division_id","business_date","version"], name="unique_daily_submission_version")]`, `indexes=[Index(fields=["division_id","business_date","-version"], name="idx_daily_submission_lookup")]`.
  - [x] Зарегистрировать в `apps/operations/submissions/models/__init__.py` (import + `__all__`).
- [x] **Task 2 — миграция (AC: 5)**
  - [x] `manage.py makemigrations ops_submissions` → `0002_daily_submission.py` (dep `[("ops_submissions","0001_submission_control_settings")]`); проверить explicit fields (id BigAutoField, created_at/updated_at/created_by, constraints через `models.Q`). НЕ ручной seed.
- [x] **Task 3 — admin: НЕ регистрировать (ОТКЛОНЕНИЕ от исходного спека; решение Bratan 2026-06-29)**
  - [x] ~~Зарегистрировать `DailySubmission` read-only в admin.py~~ → **ОТМЕНЕНО.** Регистрация бизнес-модели в Admin (даже read-only) нарушает архитектурный инвариант ARCH#L467/L485 «бизнес-модели не в Admin — запись только через сервис, мимо Admin = мимо аудита/прав» и валит страж `apps/core/tests/test_admin_platform.py::test_admin_registry_is_exactly_catalogs` (`==` точный реестр справочников). Прежний докстринг `admin.py` (стори 2.11) уже явно фиксировал «**НЕ** DailySubmission (бизнес, E5; ARCH#L467/L485)». Записи DailySubmission иммутабельны и пишутся ТОЛЬКО сервисом 5.3 (ARCH-DATA-021) → инспекция пойдёт через API/экран (5.8/E10), не Admin. `admin.py` НЕ тронут (revert). Подтверждено Bratan (AskUserQuestion, 2026-06-29).
- [x] **Task 4 — тесты (AC: 1,2,4,5)**
  - [x] `apps/operations/submissions/tests/test_daily_submission.py` (`pytest.mark.django_db`, образец `test_control_settings.py`): db_table; **partial-unique** (две `is_current=True` тем же (div,date) → `IntegrityError` под `transaction.atomic()`; одна True + одна False — OK); **unique version** (дубль (div,date,version) → IntegrityError; version=2 — OK); дефолты (version=1, is_current=True, late=False); `Event.choices`; `submitted_at` НЕ auto (можно задать явно). + в `test_app.py` — `test_daily_submission_db_table`.
  - [x] Регрессия: `make gate` зелёный; `makemigrations --check` пуст; ruff чист.

## Review Findings (Code Review — 2026-06-29, bmad-code-review, 3 адверсариальных слоя)

### Decision Needed

- [x] [Review][Decision] **DB-level value-guards для `event` и `version`.** `event` объявлен БЕЗ дефолта → `DailySubmission.objects.create()` без него пишет `""` (CharField.choices валидируются только в `full_clean()`, не на пути `.create()`; DB-чека нет). Auto-CHECK у `PositiveIntegerField` — `>= 0`, т.е. `version=0` проходит (а цепочка версий предполагает старт с 1). Добавить `CheckConstraint(Q(event__in=Event.values))` + `CheckConstraint(Q(version__gte=1))`? — ОТКЛОНЕНИЕ от прецедента `EmployeeStatus.source` (choice-поля в проекте НЕ DB-чекаются), НО у `source` есть дефолт `USER`, а у `event` дефолта нет → «» достижимо молча. [daily_submission.py event/version] (edge: EC-1 Med, EC-3 Low)
  - ✅ **РЕШЕНО (Bratan, AskUserQuestion): оба чека.** Применено: `chk_daily_submission_event` (event ∈ [CONFIRMED_NO_CHANGES, CHANGED, AMENDED]) + `chk_daily_submission_version_min` (version ≥ 1) в Meta.constraints + миграция 0002 (регенерирована) + тесты (`test_empty_event_rejected`, `test_bogus_event_rejected`, `test_version_zero_rejected`, `test_event_check_covers_event_choices` — drift-guard).

### Patches

- [x] [Review][Patch] **Докстринг переоценивает гарантию.** Класс-докстринг утверждал «БД гарантирует «ровно одна текущая версия»», но partial-unique даёт НЕ БОЛЕЕ одной — «ноль текущих» валидно на уровне БД. ✅ Переписан: DB = ≤1 (at-most-one); «ровно одна» — инвариант ПРИЛОЖЕНИЯ (5.3/5.4 держат флаг в одной txn). [daily_submission.py docstring] (blind+edge: BH-1/EC-2)
- [x] [Review][Patch] **Устаревшие упоминания admin в стори-доке.** ✅ Приведено к факту: DoD — убрано «admin read-only»; Project Structure Notes — убран `admin.py (MODIFY)`, «≈6» → «5 файлов». [5-2-модель-dailysubmission.md: DoD + Project Structure Notes] (auditor: AA-1)
- [x] [Review][Patch] **Хардненинг тестов.** ✅ Добавлено: (a) `refresh_from_db` в `test_field_defaults`; (b) `test_submitted_at_is_required` (NOT NULL/append-once); (c) `test_two_current_different_divisions_same_day_ok` + `test_two_current_different_days_same_division_ok` (позитив cross-key); (d) `test_zero_current_versions_allowed` (at-most-one). [test_daily_submission.py] (blind+edge: BH-3/EC-4/EC-5/EC-2)

### Deferred

- [x] [Review][Defer] **Partial-unique immediate (не deferrable).** 5.4 amendment обязан ставить старой версии `is_current=False` ДО вставки новой `is_current=True` (интуитивный обратный порядок тронет `unique_daily_submission_current` посреди txn) — либо вернуться к `deferrable=Deferrable.DEFERRED` тогда. [daily_submission.py constraint] — deferred, forward-концерн 5.4 (blind: BH-2)

## Dev Notes

### Цель (одним предложением)

5.2 — добавить версионируемую иммутабельную таблицу `DailySubmission` (snapshot интервалов-фактов + partial-unique «одна текущая версия» + unique версий) в существующий app `submissions`. Чистая модель: схема + констрейнты + миграция + тесты. Построение снапшота/событий — 5.3.

### Авторитет спеки (что строим и откуда)

- **epics.md Story 5.2:** «DailySubmission (date, division, submitted_by/at, snapshot JSONB интервалов-фактов с денормализованными ФИО + schema_version, event, version, is_current) … ровно одна is_current (partial unique (division, business_date) WHERE is_current); unique (division, business_date, version) … снапшот хранит интервалы-факты, не derived-состояния».
- **ARCH-DATA-021 (architecture.md):** DailySubmission/snapshot — JSONB rows денормализованных фактов; версионирование; иммутабельность (amendment=новая версия); «снапшот = интервалы-факты, не выводы».
- **ARCH-DATA-022/023:** derived-first (state выводится из интервала+business_date); полуоткрытые `[date_start, date_end)`. → snapshot хранит интервалы, расход/state/светофор — derive at read time.
- **ARCH-003:** cross-context refs — flat UUIDField (без FK в core). `division_id`/`snapshot.employee_id` — UUID.
- **ARCH-007:** actor (`submitted_by`/`created_by`) — строка external account id, не FK.

### 🔑 Решения по реализации (ДЕФОЛТЫ — подтвердить/переопределить; вопросы в конце)

1. **`schema_version` ВНУТРИ snapshot JSON, не отдельной колонкой [РЕКОМЕНД., ДЕФОЛТ].** Форма `{"schema_version":1,"rows":[…]}` — снапшот самоописателен и byte-воспроизводим (5.10 property-иммутабельность). *Альтернатива:* отдельная колонка `snapshot_schema_version` — отклонено (расщепляет факт-блок). [Source: agent-3 рекоменд. форма]
2. **`event` — обязательный CharField+choices, БЕЗ дефолта [ДЕФОЛТ].** 5.2 рядов не пишет; 5.3 всегда задаёт event (CONFIRMED_NO_CHANGES/CHANGED), 5.4 — AMENDED. Choices включают AMENDED заранее (forward-compat 5.4), хотя пишет его 5.4. *Альтернатива:* nullable — отклонено (событие — суть строки).
3. **`submitted_at = DateTimeField()` (НЕ auto_now_add) [ДЕФОЛТ, append-once].** 5.3-сервис ставит через `Clock.now()` (зеркало `AuditLog.created_at` 4.3 — единые управляемые часы, ARCH-DATA-022). `created_at`/`updated_at` от базы (auto) — это аудит-таймстампы строки, НЕ время сдачи.
4. **Без сервиса/diff/seed в 5.2 [ДЕФОЛТ, граница].** 5.2 не создаёт строк, не строит снапшот. Тесты создают строки напрямую (`.objects.create(...)` с минимальным snapshot=`{}`/валидным dict) для проверки КОНСТРЕЙНТОВ — не настоящей сдачи.
5. **Селектор — отложить в 5.3 [ДЕФОЛТ].** Чтение текущей версии/по версии нужно 5.3/5.5; в 5.2 селектор не обязателен (модель-стори). *Под-вопрос:* тонкий `DailySubmissionSelector.current(division_id, business_date)` сейчас — если хочешь, добавлю; иначе 5.3.
6. **`is_current=True` дефолт [ДЕФОЛТ].** Первая версия по природе текущая; partial-unique гарантирует единственность; 5.4 при amendment снимает флаг с предыдущей и ставит на новую (в одной txn).

### Что УЖЕ есть — переиспользовать / НЕ дублировать

- **`apps/operations/models.py::TimeStampedModel`** — база (integer PK + created_at/updated_at/created_by). DailySubmission наследует ЕЁ (НЕ core UUIDTimeStampedModel).
- **`apps/operations/submissions/`** — app существует (2.3): `SubmissionControlSettings` (образец Meta/db_table/constraints), `models/__init__.py` (паттерн регистрации), `migrations/0001`, `admin.py`, `selectors.py`, `tests/test_control_settings.py` (образец constraint-тестов `pytest.raises(IntegrityError)+transaction.atomic()`).
- **Констрейнт-синтаксис:** `EmployeeStatus` (CheckConstraint/ExclusionConstraint с `condition=Q(...)`), `Division`/`UserRole` (plain composite UniqueConstraint). Для partial-unique — `UniqueConstraint(fields=..., condition=Q(is_current=True), name=...)`.
- **Cross-ref:** `Secondment` (employee_id/from/to_division_id = UUIDField, ARCH-003).
- **JSONField:** `AuditLog.old_value/new_value`, `Override.conflicts` (default-энкодер, без кастома).
- **Event-vocabulary:** `EmployeeStatus.Source` / `Vacancy.Status` (`models.TextChoices` + CharField(choices)).
- **Snapshot интервал-факт = поля `EmployeeStatus`:** employee_id, status_type_code, status_id(pk), date_start, date_end (полуоткрытый), source.

### Подводные камни для dev-агента

- **База — operations `TimeStampedModel`** (integer PK), НЕ core `UUIDTimeStampedModel` (UUID PK). Спутать = неверный PK-тип + миграция.
- **`division_id` — UUIDField, НЕ FK** (ARCH-003). Не `ForeignKey(Division)`.
- **`submitted_at` без `auto_now_add`** — иначе 5.3 не сможет ставить через Clock (append-once). Просто `DateTimeField()`.
- **partial-unique нужен Postgres** — `condition=Q(is_current=True)` → частичный индекс. Гейт Postgres-backed; SQLite не поддержит (но проект и так Postgres-only для ops-миграций).
- **НЕ хранить derived в snapshot** — только интервалы-факты. State/расход/светофор выводятся (ARCH-DATA-022).
- **5.2 рядов не создаёт** — нет RunPython-seed (в отличие от 0001). Тесты создают строки сами для проверки констрейнтов.
- **ruff:** `ruff check` (E,F); `ruff format` по изменённым файлам (см. [[feedback_vaps_ruff_format_scoping]]).

### Тесты стори

- **Новые** (`test_daily_submission.py`): partial-unique (2×is_current→IntegrityError; True+False→OK), unique-version (дубль→IntegrityError; v2→OK), дефолты, Event.choices, db_table, submitted_at-не-auto. + `test_app.py` db_table-тест.
- **Регрессия:** `make gate` зелёный; `makemigrations --check` пуст; ruff чист.

### Definition of Done

- [ ] `DailySubmission(TimeStampedModel)` создана: поля (div_id UUID/business_date/version/is_current/event-choices/submitted_by/submitted_at-без-auto/late/snapshot-JSON), db_table `ops_daily_submissions`, рус. verbose_name.
- [ ] Констрейнты: partial-unique `(division_id, business_date) WHERE is_current` + unique `(division_id, business_date, version)`; индекс lookup.
- [ ] Зарегистрирована в `models/__init__.py`; миграция 0002 (dep 0001); `makemigrations --check` пуст. (Admin — НЕ регистрируется: ARCH#L467/L485, см. Completion Notes ⚠️ ОТКЛОНЕНИЕ.)
- [ ] Тесты констрейнтов (partial-unique + version) зелёные через `IntegrityError`+`transaction.atomic()`; дефолты/choices/db_table покрыты.
- [ ] Snapshot-форма (интервалы-факты + schema_version, не derived) задокументирована в докстринге модели.
- [ ] Анти-gold-plating: нет сервиса/diff/seed/amendment/API; derived в snapshot не хранится.
- [ ] `make gate` зелёный (Postgres :5433), ruff чист. Completion Notes без вранья.

### Project Structure Notes

- **Чисто модельная стори.** Файлов: `models/daily_submission.py` (NEW) + `models/__init__.py` (MODIFY) + `migrations/0002_daily_submission.py` (NEW) + `tests/test_daily_submission.py` (NEW) + `tests/test_app.py` (MODIFY, db_table). **5 файлов** (admin.py НЕ трогаем — ARCH#L467/L485, отклонение Task 3): одна сущность, один слой — в пределах ≤5.
- **НЕ трогать:** `SubmissionControlSettings`/0001, статусы/аудит/RBAC, сервисы. Только добавление в `submissions`.

### References

- [Source: _bmad-output/planning-artifacts/epics.md — Story 5.2 + 5.3/5.4/5.10/5.11] — поля, констрейнты, forward-compat (event/version/is_current/snapshot-иммутабельность/fractal).
- [Source: _bmad-output/planning-artifacts/architecture.md — ARCH-DATA-021/022/023] — snapshot=интервалы-факты не derived; версионирование+иммутабельность; полуоткрытые интервалы; derived-first.
- [Source: _bmad-output/planning-artifacts/architecture.md — ARCH-003, ARCH-007] — flat UUIDField cross-ref; actor-строка.
- [Source: Backend/VAPS/apps/operations/models.py — TimeStampedModel] — база (integer PK + created_at/updated_at/created_by).
- [Source: Backend/VAPS/apps/operations/submissions/ — control_settings.py / models/__init__.py / migrations/0001 / admin.py / tests/test_control_settings.py] — app-конвенции (Meta/db_table/constraints/регистрация/constraint-тесты).
- [Source: Backend/VAPS/apps/operations/statuses/models/employee_status.py — interval-поля + Source + CheckConstraint/ExclusionConstraint condition=Q] — snapshot интервал-факт + constraint-синтаксис.
- [Source: Backend/VAPS/apps/operations/statuses/models/secondment.py — UUIDField cross-ref ARCH-003].
- [Source: Backend/VAPS/apps/core/models.py — Division/UserRole UniqueConstraint; Vacancy.Status TextChoices].
- [Source: Backend/VAPS/apps/audit/models.py — JSONField + created_at-via-Clock append-once паттерн].
- [Source: docs/registries/audit-events.yaml — DAILY_SUBMISSION_SUBMITTED/AMENDED forward-seed] — аудит сдач (5.9), не 5.2 (контекст).

## Dev Agent Record

### Agent Model Used

claude-opus-4-8[1m] (Opus 4.8, 1M context)

### Debug Log References

- **3 параллельных research-агента + верификация:** (app-конвенции) база `apps.operations.models.TimeStampedModel` integer-PK, db_table `ops_<snake_plural>`, constraints в Meta, миграция 0002 dep 0001, тесты `IntegrityError`+`transaction.atomic()`; (констрейнты/версионирование) точный синтаксис `UniqueConstraint(condition=Q(is_current=True))` + Secondment UUIDField cross-ref + submitted_at через Clock (append-once, не auto_now_add) + Event TextChoices; (snapshot/архитектура) ARCH-DATA-021 snapshot=денормализ. интервалы-факты+schema_version, НЕ derived, иммутабелен, forward-compat 5.3/5.4/5.10/5.11.
- **Граница скоупа:** 5.2 = модель+миграция+констрейнты+тесты; снапшот-построение/diff/event/late/amendment — 5.3/5.4.

### Completion Notes List

- **Модель `DailySubmission(TimeStampedModel)`** создана (`models/daily_submission.py`): `division_id` UUIDField (ARCH-003, flat cross-ref, НЕ FK), `business_date` DateField, `version` PositiveIntegerField(1), `is_current` BooleanField(True), вложенный `Event(TextChoices)` (CONFIRMED_NO_CHANGES/CHANGED/AMENDED, рус. label; AMENDED forward-seed для 5.4), `event` CharField(choices, без дефолта), `submitted_by` CharField(100, ARCH-007), `submitted_at` `DateTimeField()` **без auto_now_add** (append-once, 5.3 ставит через Clock), `late` BooleanField(False), `snapshot` JSONField(default=dict). Докстринг документирует форму snapshot (schema_version + rows денормализ. интервалов-фактов) + иммутабельность + «derived не хранить».
- **Констрейнты (4, после code-review):** partial-unique `(division_id, business_date) WHERE is_current` (НЕ более одной текущей/день) + unique `(division_id, business_date, version)` (версии различны) + `chk_daily_submission_event` (event ∈ choices) + `chk_daily_submission_version_min` (version ≥ 1) + lookup-индекс `(division_id, business_date, -version)`. База — operations `TimeStampedModel` (integer BigAutoField PK), НЕ core UUID-база.
- **Миграция `0002_daily_submission.py`** (dep `0001`): explicit fields (id BigAutoField + created_at/updated_at/created_by), оба UniqueConstraint через `models.Q`, индекс. Без RunPython-seed (5.2 рядов не создаёт). `makemigrations --check` → «No changes detected».
- **Тесты:** `test_daily_submission.py` (11 шт.) — db_table, дефолты, Event.choices, submitted_at-не-auto (+round-trip явного значения), partial-unique (2×True→IntegrityError; True+False→OK), unique-version (дубль→IntegrityError; v2→OK), snapshot-форма round-trip. + `test_app.py::test_daily_submission_db_table`. Паттерн `pytest.raises(IntegrityError)` под `transaction.atomic()` (образец `test_control_settings.py`).
- **⚠️ ОТКЛОНЕНИЕ от спека (Task 3, admin):** исходная Task 3 требовала зарегистрировать DailySubmission в Admin read-only. **НЕ выполнено по решению Bratan** (AskUserQuestion, 2026-06-29): нарушает архитектурный инвариант ARCH#L467/L485 (бизнес-модели не в Admin; запись только сервисом — мимо Admin = мимо аудита/прав) и валит существующий страж `test_admin_registry_is_exactly_catalogs` (`==` точный реестр). Прежний докстринг `admin.py` (2.11) уже фиксировал «НЕ DailySubmission». `admin.py` оставлен без изменений (revert). Инспекция DailySubmission пойдёт через API/экран (5.8/E10), не Admin.
- **Гейт:** `make gate` зелёный — ruff check чист, **1427 passed, 24 deselected**, `makemigrations --check` пуст. `ruff format` применён только к изменённым файлам ([[feedback_vaps_ruff_format_scoping]]).
- **Анти-gold-plating соблюдён:** нет сервиса сдачи/diff/event-вычисления/amendment/API/seed; selector не добавлен (отложен в 5.3, реш. №5); derived в snapshot не хранится.

### File List

**Создано:**
- `Backend/VAPS/apps/operations/submissions/models/daily_submission.py`
- `Backend/VAPS/apps/operations/submissions/migrations/0002_daily_submission.py`
- `Backend/VAPS/apps/operations/submissions/tests/test_daily_submission.py`

**Изменено:**
- `Backend/VAPS/apps/operations/submissions/models/__init__.py` (+DailySubmission в import + `__all__`)
- `Backend/VAPS/apps/operations/submissions/tests/test_app.py` (+`test_daily_submission_db_table`)

**НЕ изменялся (вопреки исходному ожиданию):**
- `Backend/VAPS/apps/operations/submissions/admin.py` — DailySubmission НЕ регистрируется в Admin (ARCH#L467/L485; решение Bratan). См. Completion Notes ⚠️ ОТКЛОНЕНИЕ.

**НЕ тронуто:** `SubmissionControlSettings`/migrations/0001, statuses/audit/rbac, сервисы.

## Change Log

- 2026-06-29 — Code-review (bmad-code-review, Opus 4.8, 3 адверсариальных слоя: Blind/Edge/Auditor — **same-model caveat**): 1 decision + 3 patch применены, 1 defer, 2 dismiss. **Усилены DB-инварианты** (решение Bratan): `CheckConstraint` `chk_daily_submission_event` (event ∈ choices — закрывает молчаливое `""` у no-default поля) + `chk_daily_submission_version_min` (version ≥ 1). Докстринг исправлен (partial-unique = «не более одной», а не «ровно одна»; «ровно одна» — прикладной инвариант). Тесты: +8 (drift-guard event, empty/bogus event, version=0, submitted_at-required, cross-key positives, zero-current). Стори-док: убраны устаревшие admin-упоминания (DoD/Project Structure Notes → 5 файлов). Defer: partial-unique immediate → порядок flip-before-insert для 5.4 (deferred-work.md). Миграция 0002 регенерирована (4 констрейнта). `make gate` зелёный (1435 passed). Status → done.
- 2026-06-29 — Dev-story (bmad-dev-story, Opus 4.8): реализована модель `DailySubmission(TimeStampedModel)` + миграция 0002 + 11 тестов констрейнтов/формы. partial-unique «одна текущая версия/день» + unique версий + lookup-индекс; `submitted_at` без auto (append-once через Clock в 5.3); snapshot JSONField с задокументированной формой интервалов-фактов. **ОТКЛОНЕНИЕ от спека:** Task 3 (admin-регистрация) НЕ выполнена — нарушает ARCH#L467/L485 (бизнес-модели не в Admin) и страж `test_admin_registry_is_exactly_catalogs`; `admin.py` оставлен без изменений (решение Bratan, AskUserQuestion). `make gate` зелёный (1427 passed, ruff чист, makemigrations --check пуст). Status → review.
- 2026-06-29 — Create-story (bmad-create-story, Opus 4.8, 3 параллельных research-агента + верификация): создан контекст стори 5.2 — модель DailySubmission. Чисто модельная (model+migration+constraints+tests). База `apps.operations.models.TimeStampedModel`; `division_id` UUIDField (ARCH-003); snapshot JSONB интервалов-фактов (денормализ. ФИО+schema_version, НЕ derived, ARCH-DATA-021); констрейнты partial-unique `(division_id, business_date) WHERE is_current` + unique версий; `submitted_at` через Clock (append-once, не auto_now_add); Event TextChoices. Скоуп-граница: построение снапшота/diff/event/amendment — 5.3/5.4. Дефолты: №1 schema_version внутри JSON, №2 event обязателен+choices, №3 submitted_at без auto, №4 без сервиса/seed, №5 селектор→5.3, №6 is_current дефолт True. epic-5 in-progress. Status → ready-for-dev.
