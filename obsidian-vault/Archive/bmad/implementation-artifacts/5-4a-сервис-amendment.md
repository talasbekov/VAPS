---
baseline_commit: f49218c (HEAD на ветке e3-catchup-clock-concurrency; фундамент E5 1–3b закоммичен: модель DailySubmission 0002, submit_day 5.3b, build_division_snapshot 5.3a, селекторы current_for/previous_for. 5.4a строит ПОВЕРХ него: поля amendment + миграция 0003 + сервис amend_day. Спайки 1.11/3.13 закрыты в done в этой же сессии — к 5.4a отношения не имеют.)
---

# Story 5.4a: Сервис amendment — создание версии v2+

Status: done

<!-- Декомпозиция 5.4 → 5.4a + 5.4b (2026-06-30, ≤5-файл). 5.4a = МЕХАНИЗМ пересдачи (создание версии v2+); 5.4b = бизнес-правило обязательности amendment (энфорс хука 3.9 + инверсный seam statuses↔submissions + interval-union). 5.4b ЗАВИСИТ от 5.4a. -->
<!-- Зеркалит прецедент 5.3a (срез-билдер, механизм) / 5.3b (сервис сдачи, бизнес-правило). -->
<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a **руководитель**,
I want **сервис пересдачи сданного дня новой версией v2+ (`event=AMENDED`: причина, санкция, ссылка на ретро-правку; новый срез через билдер 5.3a)**,
so that **поправка — видимая новая действующая версия, прежняя (v1) сохраняется неизменной, а расход воспроизводится из снапшота амендированной версии (ARCH-DATA-021)**.

## Acceptance Criteria

1. **Given** сданный день (есть действующая `is_current` версия) + причина + санкция + actor, **When** вызывается amendment-сервис, **Then** создаётся следующая версия: `version = max(version)+1`, новый снапшот через `build_division_snapshot`, `event=AMENDED`; старая версия получает `is_current=False` **ДО** вставки новой `is_current=True` в ОДНОЙ транзакции (immediate partial-unique `unique_daily_submission_current`); прежняя версия сохраняется (не удаляется, snapshot не правится).
2. **Given** amendment amendment'а, **When** сервис вызван повторно на уже амендированный день, **Then** создаётся v3 (`version = prev+1`), цепочка v1→v2→v3 прослеживается через `(division_id, business_date, version)` минимум на 2 звена; ровно одна версия `is_current` после каждого вызова.
3. **And** причина (`reason`) и санкция (`sanction`) хранятся на версии и обязательны для `event=AMENDED` (пустые → отказ ДО записи + DB-CheckConstraint как backstop). Ссылка на ретро-правку (`triggered_by_status_id`) — опциональна (manual amendment без конкретного статуса допустим).
4. **And** amendment ОБХОДИТ окно первичной сдачи (`BUSINESS_DATE_OUT_OF_WINDOW` не применяется — ретро-правка прошлых дат это и есть смысл amendment); попытка амендить день без существующей сдачи → доменная ошибка (новый код в реестре); гонка/повтор двух amendment ловится unique-констрейнтами → 409 `DAY_ALREADY_SUBMITTED`.
5. **And** анти-gold-plating: 5.4a НЕ строит энфорс-хук 3.9 / детекцию накрытых сдач / инверсный seam (это 5.4b), НЕ пишет аудит (эмиссия `DAILY_SUBMISSION_AMENDED` — 5.9), НЕ гейтит права/scope (5.8), НЕ трогает светофор (5.5), НЕ реализует эскалацию «санкция выше после ухода расхода наверх» (forward-seam: расход-релиз — E6, ещё нет; санкция фиксируется как вход).

## Tasks / Subtasks

- [x] **Task 1 — Поля amendment на DailySubmission + миграция 0003** (AC: 1, 2, 3)
  - [x] В `apps/operations/submissions/models/daily_submission.py` добавлены `reason = TextField(blank=True, default="")`, `sanction = CharField(max_length=255, blank=True, default="")`, `triggered_by_status_id = PositiveBigIntegerField(null=True, blank=True)` (flat-ссылка на EmployeeStatus.id — int BigAutoField, НЕ UUID; уточнено по факту PK операционных моделей). docstring модели — поля не требовали правки секции версий (комментарии у полей). _Уточнение от плана: тип `PositiveBigIntegerField`, не `UUIDField` — EmployeeStatus surrogate PK целочисленный._
  - [x] `CheckConstraint` `chk_daily_submission_amended_requires_reason_sanction`: `~Q(event="AMENDED") | (~Q(reason="") & ~Q(sanction=""))`.
  - [x] `makemigrations ops_submissions` → `0003_amendment_fields.py` (dep `0002_daily_submission`); `makemigrations --check` = «No changes detected» в `make gate`.
  - [x] Тест-зеркало `test_daily_submission.py`: поля/дефолты; CheckConstraint блокирует AMENDED с пустым reason/sanction; не-AMENDED не ограничены. Обновлён существующий `test_event_check_covers_event_choices` (AMENDED теперь требует reason/sanction — иначе регрессия).
- [x] **Task 2 — Селектор предшественника версии** (AC: 1, 2)
  - [x] `DailySubmissionSelector.latest_for(division_id, business_date, lock=False)` → строка с `max(version)`; `lock=True` → `select_for_update()`.
  - [x] НЕ дублирует `current_for`; находит chain-head даже при «ноль текущих» (тест `test_selector_latest_for_finds_head_with_zero_current`).
- [x] **Task 3 — Сервис `amend_day`** (AC: 1, 2, 3, 4, 5)
  - [x] `apps/operations/submissions/services/amendment_service.py`, `@transaction.atomic def amend_day(*, division_id, business_date, actor, reason, sanction, triggered_by_status_id=None)`.
  - [x] Гарды: `_require_actor` → 400; `_require_text(reason)`/`_require_text(sanction)` → 400; existence-gate `CoreDivisionTreeSelector.exists` → 404.
  - [x] **NO window check** — amendment про прошлые/сданные даты.
  - [x] Прекондиция `latest_for(..., lock=True)`; None → `DomainError("NO_SUBMISSION_TO_AMEND", 422)`; код добавлен в `docs/registries/error-codes.yaml` тем же PR.
  - [x] `snapshot = build_division_snapshot(...)` — пере-срез исправленного состояния.
  - [x] `version = latest.version + 1`.
  - [x] Flip-before-insert: `.filter(is_current=True).update(is_current=False)` ДО `create(is_current=True)`, во вложенном savepoint.
  - [x] `create(... event=Event.AMENDED, submitted_at=Clock.now(), late=False, reason, sanction, triggered_by_status_id)`.
  - [x] Гонка → 409 через существующий `CONSTRAINT_ERROR_MAP` (оба имени уже замаплены — без правок handler).
  - [x] Экспорт `amend_day` в `services/__init__.py` (`__all__`).
  - [x] НЕ пишет audit (5.9), НЕ гейтит права (5.8), НЕ трогает хук 3.9 (5.4b).
- [x] **Task 4 — Тесты сервиса** (`test_amendment_service.py`, `@pytest.mark.django_db`)
  - [x] amend создаёт v2 (version/is_current/AMENDED/reason/sanction; ровно одна current).
  - [x] v1 сохранён (is_current=False, snapshot байт-в-байт) + отдельный тест пере-сборки снапшота из исправленного состояния.
  - [x] Цепочка v3: версии {1,2,3}, ровно одна current, `current=v3`.
  - [x] Flip-before-insert доказан (count is_current==1 после amend).
  - [x] Прекондиция → 422 `NO_SUBMISSION_TO_AMEND`, no-side-effect.
  - [x] Окно обходится (amend прошлой даты проходит).
  - [x] reason/sanction обязательны: 400 (сервис) + IntegrityError (CheckConstraint, в `test_daily_submission.py`).
  - [x] Время через `clock.override`; `late` всегда False для amendment.
  - [x] Реестр-когерентность: `test_no_submission_to_amend_code_in_registry`. Forward-seam санкции задокументирован в docstring модуля теста.

### Review Findings (code-review 2026-06-30, проход 1)

Адверсариальное ревью (Blind Hunter + Edge Case Hunter + Acceptance Auditor) scoped-diff `f49218c..рабочее дерево` по коду 5.4a (8 файлов, +585/−2). **Acceptance Auditor: ACCEPTANCE MET** — все 5 AC + load-bearing инварианты (ARCH-DATA-021 иммутабельность, flip-before-insert, version=max+1, closed-world, operations↛core.models, statuses↛submissions) верифицированы вживую. Blind+Edge: CHANGES — нет data-corruption блокера (savepoint + unique-констрейнты держат), но реальные незакрытые грани. **Same-model caveat** (все слои Opus 4.8). Итог: **0 decision · 5 patch · 2 defer · 3 dismiss**.

- [x] [Review][Patch] **Whitespace-only reason/sanction обходит CheckConstraint-backstop** (все 3 слоя) — констрейнт тестит `!= ""`, но `"   " != ""` истинно → семантически-пустая AMENDED-строка коммитится прямым `create()`, хотя коммент заявляет «backstop против тихого пустого». Усилить констрейнт на `\S` (непустой после trim) + strip reason/sanction в сервисе перед записью. [`models/daily_submission.py` CheckConstraint + `migrations/0003` + `services/amendment_service.py`]
- [x] [Review][Patch] **docstring overpromise: `amend_day` не raise'ит `DomainError(409)` сам** (blind+edge) — 409 на гонке версий приходит ТОЛЬКО через внешний `CONSTRAINT_ERROR_MAP` (DRF-handler) на `IntegrityError`; service-вызыватель (5.4b-хук) получит сырой `IntegrityError`. Уточнить docstring: 409 — via handler на IntegrityError, не raise напрямую; внутренний caller (5.4b) обрабатывает сам. [`services/amendment_service.py` docstring]
- [x] [Review][Patch] **409/version-collision backstop не покрыт тестом** (все 3 слоя) — самый тонкий путь (flip+insert+unique-backstop) не тестируется. Добавить детерминированный тест: monkeypatch stale `latest_for` (version=1 при существующей v2) → collision на `unique_daily_submission_version` → IntegrityError; savepoint откатывает flip (v1 остаётся current). [`tests/test_amendment_service.py`]
- [x] [Review][Patch] **Пробелы покрытия: zero-current service-amend, empty-roster amend, whitespace на DB-уровне** (edge+auditor) — «ноль текущих» тестируется только на селекторе (не через `amend_day`); empty-roster пере-сборка снапшота не тестируется; whitespace-only отклоняется только на сервисе, не на CheckConstraint. Добавить 3 теста. [`tests/test_amendment_service.py` + `tests/test_daily_submission.py`]
- [x] [Review][Patch] **Внутренняя рассогласованность спеки: `UUIDField` vs реальный `PositiveBigIntegerField`** (auditor) — Dev Notes «Решения» п.1 и «Подводные камни» всё ещё пишут `UUIDField`/«плоский UUID», хотя код/Task1/Completion и реальность — `PositiveBigIntegerField` (EmployeeStatus = целочисленный surrogate PK). Документационная честность. [story `5-4a-сервис-amendment.md` Dev Notes]
- [x] [Review][Defer] **`business_date=None` → 500 вместо 400** (blind+edge): нет type/None-гарда; `None.isoformat()` в detail 422-ветки → unmapped 500. By-design typed-kwarg контракт (сервисы берут типизированные kwargs, REST/5.8 владеет коэрсингом — паритет с `submit_day`/`secondment_service`). 5.4b передаёт реальную дату. — deferred-work.md.
- [x] [Review][Defer] **`triggered_by_status_id` без positivity/existence-гарда** (edge): `PositiveBigIntegerField` не даёт DB-CHECK (positivity = validator, `create()` его минует); negative/zero/dangling коммитится молча. Опциональный flat-ref (ARCH-003, как `division_id` — тоже не валидируется на уровне поля); 5.4b передаёт валидный id. Опц. DB-CHECK `> 0` — будущее ужесточение. — deferred-work.md.
- Dismissed (3, by-design/паритет): (1) реестр-тест presence-only grep — паритет с `test_status_service.test_new_code_in_registry` (CI-coherence = отдельная стори per registry meta); (2) File List заявляет sprint-status.yaml, его нет в scoped-diff — ожидаемо (BMAD-трекинг коммитится отдельно); (3) `amend_day` пере-собирает весь снапшот / drift / empty roster «unguarded» — by-design ARCH-DATA-021 (amendment = пере-срез исправленного состояния; empty-roster валиден как у `submit_day`), корректное поведение (тест-пробел закрыт patch выше).

## Dev Notes

### Цель (одним предложением)

Построить service-уровневый МЕХАНИЗМ создания следующей версии сдачи дня (`AMENDED`, v2+) поверх уже существующей модели/билдера/сервиса E5 — БЕЗ энфорса-триггера (5.4b), аудита (5.9), прав (5.8). Это «механизм пересдачи»; «обязательность amendment при ретро-правке» — отдельная стори 5.4b, которая будет ВЫЗЫВАТЬ этот сервис.

### Что УЖЕ ЕСТЬ (фундамент — НЕ строить заново, переиспользовать)

| Компонент | Путь | Что даёт 5.4a |
|---|---|---|
| Модель `DailySubmission` | `apps/operations/submissions/models/daily_submission.py` | `version`/`is_current`/`event`(вкл. `Event.AMENDED` forward-seed)/`snapshot`/`submitted_by`/`submitted_at`/`late`; констрейнты `unique_daily_submission_current` (partial), `unique_daily_submission_version`, `chk_daily_submission_event`, `chk_daily_submission_version_min`; `db_table="ops_daily_submissions"`. Наследует `TimeStampedModel` (operations-база, integer PK). **Полей reason/sanction/triggered_by НЕТ** → Task 1. |
| Срез-билдер `build_division_snapshot(division_id, business_date)` | `apps/operations/submissions/services/snapshot.py` | READ-ONLY, `SCHEMA_VERSION=1`, формат `{schema_version, roster:[{employee_id,full_name,rank}], rows:[{employee_id,status_type_code,status_id,date_start,date_end,source}]}`, детерминированный порядок. **Переиспользовать БЕЗ изменений** для среза новой версии. |
| Сервис `submit_day(*, division_id, business_date, actor, window_dates=None)` | `apps/operations/submissions/services/day_submission_service.py` | ОБРАЗЕЦ скелета: `@transaction.atomic` + `_require_actor` + existence-gate + вложенный savepoint вокруг racy-INSERT. `amend_day` зеркалит его, НО: `event=AMENDED` (не diff), `version=max+1` (не 1), flip старой `is_current`, БЕЗ окна. |
| Селектор `DailySubmissionSelector` | `apps/operations/submissions/selectors.py` | `current_for(division_id, business_date)` (is_current-строка), `previous_for(...)` (baseline diff). Добавить `latest_for` (max version). |
| Реестр audit | `docs/registries/audit-events.yaml` | `DAILY_SUBMISSION_AMENDED` уже forward-seeded (НЕ эмитить в 5.4a — это 5.9). |
| Реестр errors | `docs/registries/error-codes.yaml` | `DAY_ALREADY_SUBMITTED` (409), `BUSINESS_DATE_OUT_OF_WINDOW` (422), `ENTITY_NOT_FOUND` (404), `VALIDATION_ERROR` (400). **Нет** кода «нечего амендить» → Task 3 добавляет `NO_SUBMISSION_TO_AMEND`. |
| `DomainError(code, http_status, detail=None, overridable=False, message=None)` | `apps/core/exceptions.py:14` | Чистый класс; код ОБЯЗАН быть в реестре (STOP-правило). Handler + `CONSTRAINT_ERROR_MAP` — `apps/core/api/exception_handler.py:27,132`. |
| `Clock` | `apps/core/clock.py` | `Clock.now()` для `submitted_at`. Время ТОЛЬКО через Clock (ARCH-DATA-022; никаких `timezone.now()` в домене). |

### Архитектурные правила, которые 5.4a ОБЯЗАНА соблюсти

- **ARCH-DATA-021** (architecture.md:286–295, 749): снапшот «не правится — вытесняется» (v1→v2…, ровно одна действующая). Поправка = событие `AMENDED` с атрибутами кто/когда/причина/санкция/ссылка на ретро-правку. Иммутабельность снапшота: amendment делает НОВЫЙ snapshot, старый неизменен (питает property-тест 5.10). MUST NOT: правка снапшота на месте; второй источник истины; вытеснение версии помимо flow.
- **«Ровно одна действующая» — прикладной инвариант** (БД даёт at-most-one через partial-unique; «ноль текущих» на уровне БД валиден). Держит СЕРВИС, переключая `is_current` в одной txn (5.2-defer BH-2, Решение №6).
- **Flip-before-insert** (5.2-defer BH-2, дословно): «5.4 amendment обязан ставить старой версии `is_current=False` ДО вставки новой `is_current=True` (интуитивный обратный порядок тронет `unique_daily_submission_current` посреди txn) — либо вернуться к `deferrable=Deferrable.DEFERRED`». Констрейнт сейчас **immediate** (не deferrable) → порядок обязателен.
- **`version=max(version)+1`, не хардкод** (5.3b-defer): «Хардкод `version=1` + пречек только по `is_current` → 500 для дня с не-current версиями… Закрыть в 5.4: вычислять `max(version)+1`». `latest_for` решает это.
- **Конкурентность** (architecture.md:462): мутация существующей строки = `select_for_update()` в селекторе внутри atomic-сервиса; constraint = backstop (срабатывание в проде = аномалия), не стратегия; `IntegrityError`→409 по имени констрейнта. Уровни изоляции (READ COMMITTED/REPEATABLE READ) архитектура НЕ предписывает — достаточно select_for_update + atomic + unique-backstop.
- **operations ↛ core.models** (ARCH-004; страж `apps/operations/tests/test_isolation.py::test_operations_does_not_import_core_models`, AST-скан): в core ходить ТОЛЬКО через `apps.core.selectors` / `exceptions` / `clock`. Образец — `snapshot.py` (через `CoreEmployeeSelector`).
- **Граница субдоменов** `statuses ← submissions ← reports` (architecture.md:587): `submissions` зависит от `statuses` (можно импортировать), обратное запрещено. 5.4a — целиком в `submissions`, эту границу не задевает (её задевает 5.4b).
- **Бизнес-модели НЕ регистрируются в Admin** (страж `apps/core/tests/test_admin_platform.py::test_admin_registry_is_exactly_catalogs`): новые поля `DailySubmission` НЕ требуют Admin-регистрации.
- **Память проекта (DB-инварианты):** Bratan предпочитает `CheckConstraint` на DB для choice-полей без дефолта и обязательностей (прецедент `chk_daily_submission_version_min`). Отсюда `chk_daily_submission_amended_requires_reason_sanction` — в духе проекта, не gold-plating.

### Что 5.4a НЕ строит (Out of Scope) и куда это уходит

- **Энфорс «правка сданного дня требует amendment» + тело `mark_days_for_amendment` + инверсный seam statuses↔submissions + корректный interval-union** → **5.4b** (зависит от 5.4a). 5.4a даёт сервис, который 5.4b будет вызывать.
- **Эмиссия аудита `DAILY_SUBMISSION_AMENDED`** → **5.9** (как `submit_day` не пишет аудит). Код уже в реестре; literal-эмиссия (для guard 4.6 `test_audit_coverage`) — в 5.9.
- **Права/scope-403, API `POST /{id}/amend/`** → **5.8** (сервис берёт actor-строку, прав не гейтит — конвенция 5.3b).
- **Светофор/drift после amendment** → **5.5**.
- **Property-тест иммутабельности снапшота** → **5.10** (5.4a лишь гарантирует, что v1.snapshot не правится).
- **Эскалация «санкция выше после ухода расхода наверх»** → **forward-seam**: «расход ушёл наверх» = релиз документа расхода (E6, ещё backlog). Машинного определения нет (architecture.md:288 даёт только принцип «выше, чем до»; уровни/авторизация — open-вопрос). 5.4a ФИКСИРУЕТ `sanction` как вход; правило сравнения подключается, когда E6 даст релиз-состояние.
- **«Взамен исх. №…» (номер документа)** → **E6** (`DocumentSequence` 6.2 / выпуск 6.5). На уровне submissions «цепочка» = последовательность версий `(division, business_date, version)`; номер исходящего — у документа расхода.

### Конвенции реализации (соблюсти точно)

- **Сервис** — модульная функция в `services/<name>.py`, keyword-only аргументы, `actor` строкой, `@transaction.atomic`, экспорт через `services/__init__.py` `__all__`. Образцы: `status_service.create_status`, `day_submission_service.submit_day`.
- **Селекторы** — классы `*Selector` со staticmethod/classmethod в `selectors.py`; чтение БД только здесь.
- **Доменные ошибки** — `raise DomainError("CODE", <http>, detail={...}, message="...")`; код в `error-codes.yaml` (формат `CODE: {http_status, overridable, category, description, source}`); coherence-тест `emitted_codes ⊆ registry`.
- **Тесты** — `apps/operations/submissions/tests/test_*.py`, `@pytest.mark.django_db`; данные через `.objects.create()` + хелперы `make_division`/`make_employee`/`make_status` (образец `test_strength_report_service.py:37-74` / `test_day_submission_service.py`); констрейнты — `pytest.raises(IntegrityError)` под `transaction.atomic()`; ошибки сервиса — `pytest.raises(DomainError)` + проверка `.code`/`.http_status` + no-side-effect counts.
- **Гейт** — `ruff check` (E,F) только по изменённым файлам, `ruff format` по файлу (не по app-папке — память проекта); `make gate` (Postgres :5433); `makemigrations --check` пуст.

### Подводные камни для dev-агента

- **Порядок flip→insert строг** (immediate partial-unique). Сначала погасить старую `is_current`, потом вставить новую. Тест должен это доказывать (успешный amend без `IntegrityError` на `unique_daily_submission_current`).
- **`version` — `max(version)+1`, не `current.version+1`** — если есть не-current версии с бОльшим номером (теоретически после будущих операций), `current.version+1` столкнётся с `unique_daily_submission_version`. Брать `latest_for` (max).
- **Снапшот amendment ПЕРЕсобирается** из ТЕКУЩЕГО (исправленного) состояния — это не копия v1, а новый срез на ту же `business_date`. Денорм ФИО/звание берутся «как есть сейчас» (билдер 5.3a).
- **Окно НЕ применять** — иначе amendment прошлой даты упадёт `BUSINESS_DATE_OUT_OF_WINDOW` (ровно то, что amendment призван разрешить).
- **Не эмитить аудит и не звать хук** — соблазн «раз уж пишу версию, отмечу накрытые дни / запишу аудит». НЕТ: хук = 5.4b, аудит = 5.9.
- **Новый error-код — в реестр тем же PR** (`NO_SUBMISSION_TO_AMEND`), иначе coherence-тест/STOP-правило.
- **`triggered_by_status_id` — плоский `PositiveBigIntegerField`, не FK** (ARCH-003); ссылается на целочисленный surrogate PK `EmployeeStatus` (operations-модели = int BigAutoField, не UUID). Nullable (manual amendment).
- **`reason`/`sanction` default `""`** (не NULL) — чтобы v1-строки (submit_day) оставались валидны под CheckConstraint (`event != AMENDED` ветка не требует их).

### Решения, принятые при создании стори (дефолты — менять осознанно)

1. **Поля:** `reason` TextField, `sanction` CharField(255), `triggered_by_status_id` PositiveBigIntegerField(null=True) — минимум под AC «причина/санкция/ссылка»; тип целочисленный (EmployeeStatus surrogate PK), не UUID. Структурированные уровни санкции НЕ вводятся (архитектура их не определяет — open-вопрос).
2. **`sanction` — записываемый вход**, не вычисляемый уровень. Сравнение «выше/ниже» — forward-seam (E6).
3. **CheckConstraint обязательности reason/sanction для AMENDED** — DB-backstop в духе проекта (память: Bratan за DB-инварианты).
4. **`amend_day` — отдельный файл `amendment_service.py`**, не расширение `day_submission_service.py` (разные ответственности: первичная сдача vs пересдача; разные правила окна/версии/event).
5. **`late=False` для amendment** — поздность осмысленна для первичной сдачи (после 17:00), не для пересдачи.
6. **Прекондиция «есть что амендить»** → `NO_SUBMISSION_TO_AMEND` (422 business_hard), не 404 (это бизнес-правило «нельзя амендить несданное», не «сущность не найдена»).

### Git-интеллидженс

- HEAD = `f49218c` («5.2, 5.3a, 5.3b stories») — фундамент E5 (модель 0002, submit_day, snapshot-билдер, селекторы) ЗАКОММИЧЕН. 5.4a строит поверх.
- Недавние коммиты: `f49218c` (5.2/5.3a/5.3b), `fec75d9`/`e95a5e1` (5.1 вход оператора, JWT), E4-аудит. Паттерн коммитов: одна стори = один коммит, отдельно BMAD-трекинг. Коммит 5.4a — за Bratan.
- В этой же сессии закрыты спайки 1.11/3.13 (E1/E3 → done) — изменения BMAD-трекинга в рабочем дереве, к коду 5.4a отношения не имеют, в File List не включать.

### Previous-story интеллидженс (forward-долги, прямо завещанные 5.4)

- **5.2 Defer BH-2 / Решение №6:** flip `is_current=False` ДО insert (immediate constraint) — Task 3.
- **5.2 Решение №2:** `Event.AMENDED` forward-seeded — использовать, не добавлять.
- **5.3b Defer:** `version=max+1` (не хардкод 1); пречек по `is_current` создаёт «ноль текущих» — `latest_for` (max version) обходит.
- **5.3b Defer:** `_diff_key` доверяет форме `previous.snapshot` — для 5.4a не критично (amend не diff'ит, всегда AMENDED), но при бампе `SCHEMA_VERSION` до v2 — общая забота.
- **deferred-work.md (стр. 315–316):** amendment-seam min/max union + `source` hardcoded — это материя 5.4b (interval-union) и statuses (source), НЕ 5.4a.

### Технические версии / окружение

- Django ORM: `models.TextField`/`CharField`/`UUIDField`, `UniqueConstraint(condition=Q(...))`, `CheckConstraint`, `transaction.atomic` (savepoint), `select_for_update()`. Никаких новых зависимостей (`pyproject.toml` не трогать).
- Postgres (compose :5433), `make gate`. Миграция 0003 — чистая schema-миграция (rule 2: модель+миграция = одна стори).

### Project Structure Notes

Файлы (лимит ≤5 соблюдён; модель+миграция = 1 по rule 2; тесты не в лимите):
- MODIFY `apps/operations/submissions/models/daily_submission.py` (+ поля + CheckConstraint)
- CREATE `apps/operations/submissions/migrations/0003_amendment_fields.py`
- CREATE `apps/operations/submissions/services/amendment_service.py`
- MODIFY `apps/operations/submissions/services/__init__.py` (export — тривиально)
- MODIFY `apps/operations/submissions/selectors.py` (+ `latest_for`)
- MODIFY `docs/registries/error-codes.yaml` (+ `NO_SUBMISSION_TO_AMEND` — реестр, не app-код)
- CREATE `apps/operations/submissions/tests/test_amendment_service.py` (тесты — вне лимита)
- (возм.) MODIFY `apps/operations/submissions/tests/test_daily_submission.py` (поля/CheckConstraint)

Всё в `submissions`-контексте — границу `statuses↔submissions` не задевает (её резолвит 5.4b). Admin не трогается.

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Story-5.4a (697–...)] — AC механизма пересдачи v2+, forward-seam санкции.
- [Source: _bmad-output/planning-artifacts/epics.md#Story-5.4b] — зависимый энфорс-хук (контекст границы).
- [Source: _bmad-output/planning-artifacts/architecture.md:286–295,749 (ARCH-DATA-021)] — версии/is_current/AMENDED/иммутабельность/«не правится — вытесняется».
- [Source: _bmad-output/planning-artifacts/architecture.md:288] — инвариант «ретро-правка накрытой даты ОБЯЗАНА триггерить amendment» + «санкция выше после ухода расхода наверх».
- [Source: _bmad-output/planning-artifacts/architecture.md:293,623] — «взамен исх. №» (документ — E6), цепочка versions.
- [Source: _bmad-output/planning-artifacts/architecture.md:462–463] — конкурентность (`select_for_update`, IntegrityError→409, idempotency через unique).
- [Source: _bmad-output/planning-artifacts/architecture.md:587 (граница statuses←submissions←reports)] + [:485 (operations↛core.models)].
- [Source: Backend/VAPS/apps/operations/submissions/models/daily_submission.py] — модель/констрейнты/`Event.AMENDED`.
- [Source: Backend/VAPS/apps/operations/submissions/services/day_submission_service.py] — скелет `submit_day` (образец).
- [Source: Backend/VAPS/apps/operations/submissions/services/snapshot.py] — `build_division_snapshot` (переиспользовать).
- [Source: Backend/VAPS/apps/operations/submissions/selectors.py] — `current_for`/`previous_for` (+ `latest_for`).
- [Source: Backend/VAPS/apps/core/exceptions.py:14 + apps/core/api/exception_handler.py:27,132] — DomainError + CONSTRAINT_ERROR_MAP.
- [Source: docs/registries/error-codes.yaml:130,228] — `DAY_ALREADY_SUBMITTED`/`BUSINESS_DATE_OUT_OF_WINDOW` (amendment = легальный путь).
- [Source: docs/registries/audit-events.yaml:65 (`DAILY_SUBMISSION_AMENDED`)] — forward-seed (эмиссия 5.9).
- [Source: _bmad-output/implementation-artifacts/5-2-модель-dailysubmission.md] — Defer BH-2 (flip-before-insert), Решения №2/№6.
- [Source: _bmad-output/implementation-artifacts/5-3b-сервис-сдачи-дня.md] — Defer (version=max+1, «ноль текущих»).
- [Source: _bmad-output/implementation-artifacts/deferred-work.md:315–316] — interval-union/source (материя 5.4b).

## Dev Agent Record

### Agent Model Used

claude-opus-4-8[1m] (Opus 4.8, 1M context) — bmad-dev-story (TDD red-green).

### Debug Log References

- **`make gate` зелёный (Postgres :5433):** `ruff check .` чист (после `ruff format` миграции 0003 + теста — ASCII-строка авто-Q констрейнта была 286 симв.; прежние «длинные» миграции кириллические, символов ≤88); `pytest -m "not property and not concurrency and not slow"` → **1492 passed, 24 deselected, 32s** (<300s NFR-8); `makemigrations --check` → «No changes detected». Целевые: `test_amendment_service.py` + `test_daily_submission.py` → **38 passed**.
- **Регрессия — нулевая по стандартному gate.** Зелёные: `test_isolation` (operations↛core.models — `amend_day` ходит в core только через `CoreDivisionTreeSelector`), `test_admin_platform` (новые поля не требуют Admin-регистрации), `test_audit_coverage`.
- **`make test-full` — 1516 passed + 2 PRE-EXISTING teardown-ERROR** (НЕ регрессия 5.4a): `test_employee_status_concurrency.py` (gate-исключён, `@pytest.mark.concurrency` + `django_db(transaction=True)`). Причина — `psycopg.errors.RestrictViolation: audit_logs is append-only (ARCH-SEC-032): TRUNCATE rejected`: `TransactionTestCase` teardown делает `TRUNCATE` всех таблиц, append-only DB-триггер `audit_logs` (стори **4.2**, `apps/audit/migrations/0002_audit_logs_append_only.py`) отбивает TRUNCATE. Тела тестов проходят («2 passed»); падает только flush. 5.4a не трогает `audit_logs`/concurrency-тесты/EmployeeStatus — взаимодействие 4.2-триггера и TransactionTestCase-flush существует независимо. Кандидат в deferred-work (test-infra): flush-исключение audit_logs / `serialized_rollback` для concurrency-тестов.

### Completion Notes List

Реализован МЕХАНИЗМ amendment-flow (создание версии v2+); энфорс хука 3.9 — отдельная 5.4b (зависит от этого сервиса).

- ✅ **AC1** (v2-создание + flip + v1 сохранён): `amend_day` гасит прежнюю `is_current` ДО вставки новой (immediate partial-unique), `version=latest+1`, `event=AMENDED`, новый срез билдером 5.3a; v1 неизменна (тест snapshot байт-в-байт).
- ✅ **AC2** (цепочка v3): amend amendment'а → версии {1,2,3}, ровно одна current, прослеживаемость через `(division, business_date, version)`.
- ✅ **AC3** (reason/sanction обязательны): сервис 400 + DB-CheckConstraint backstop; `triggered_by_status_id` опционален.
- ✅ **AC4** (обход окна / прекондиция / гонка): окно не применяется; нет сдачи → 422 `NO_SUBMISSION_TO_AMEND` (новый код в реестре); гонка → 409 через существующий `CONSTRAINT_ERROR_MAP`.
- ✅ **AC5** (анти-gold-plating): НЕ построены энфорс-хук/seam (5.4b), audit (5.9), права (5.8), светофор (5.5); эскалация санкции — forward-seam (расход-релиз E6), санкция фиксируется как вход.
- **Уточнение от плана:** `triggered_by_status_id` — `PositiveBigIntegerField` (EmployeeStatus PK целочисленный), не `UUIDField`.
- **Артефакты НЕ закоммичены агентом** (коммит — за Bratan, прецедент проекта).

### File List

**Создано:**
- `Backend/VAPS/apps/operations/submissions/services/amendment_service.py` — сервис `amend_day`
- `Backend/VAPS/apps/operations/submissions/migrations/0003_amendment_fields.py` — поля + CheckConstraint
- `Backend/VAPS/apps/operations/submissions/tests/test_amendment_service.py` — тесты сервиса/селектора/реестра

**Изменено:**
- `Backend/VAPS/apps/operations/submissions/models/daily_submission.py` — поля `reason`/`sanction`/`triggered_by_status_id` + `chk_daily_submission_amended_requires_reason_sanction`
- `Backend/VAPS/apps/operations/submissions/selectors.py` — `DailySubmissionSelector.latest_for`
- `Backend/VAPS/apps/operations/submissions/services/__init__.py` — экспорт `amend_day`
- `Backend/VAPS/apps/operations/submissions/tests/test_daily_submission.py` — тесты полей/констрейнта + правка `test_event_check_covers_event_choices`
- `docs/registries/error-codes.yaml` — код `NO_SUBMISSION_TO_AMEND` (422)
- `_bmad-output/implementation-artifacts/sprint-status.yaml` — статус 5-4a → review

## Change Log

- 2026-06-30 — Создана стори 5.4a (bmad-create-story, Opus 4.8): декомпозиция 5.4 → 5.4a (сервис) + 5.4b (энфорс) по ≤5-файл правилу; исчерпывающий контекст (3-агентный анализ E5/архитектуры/кода шва). Status → ready-for-dev.
- 2026-06-30 — Dev (bmad-dev-story, Opus 4.8, TDD): реализован сервис `amend_day` (механизм версии v2+). Поля `reason`/`sanction`/`triggered_by_status_id` + CheckConstraint (миграция 0003); селектор `latest_for`; новый код `NO_SUBMISSION_TO_AMEND` (реестр). Flip-before-insert (5.2-defer BH-2), `version=max+1` (5.3b-defer) закрыты. `make gate` зелёный (1492 passed, ruff чист, makemigrations чист). Регрессия нулевая по gate. `make test-full`: 1516 passed + 2 ПРЕ-СУЩЕСТВУЮЩИХ teardown-ERROR в gate-исключённых concurrency-тестах (audit_logs append-only TRUNCATE-триггер 4.2 × TransactionTestCase-flush — не регрессия 5.4a). Артефакты не закоммичены агентом. Status → review.
- 2026-06-30 — Code review проход 1 (bmad-code-review, Opus 4.8 ×3 слоя — Blind/Edge/Auditor, **same-model caveat**; scoped-diff `f49218c..рабочее дерево`). Acceptance Auditor: ACCEPTANCE MET (все 5 AC). 0 decision · **5 patch ПРИМЕНЕНЫ** · 2 defer→deferred-work.md · 3 dismiss. Патчи: (1) CheckConstraint усилён `__regex=r"\S"` + strip reason/sanction в сервисе (whitespace-only больше не обходит backstop) — миграция 0003 перегенерирована; (2) docstring `amend_day` уточнён (409 на гонке = via DRF-handler на IntegrityError, не raise; 5.4b-caller получит сырой IntegrityError); (3) детерминированный тест version-collision backstop (monkeypatch stale `latest_for`); (4) +3 теста покрытия (zero-current service-amend, empty-roster, whitespace на DB-уровне ×2); (5) фикс внутренней рассогласованности спеки (`UUIDField`→`PositiveBigIntegerField` в Dev Notes). `make gate` зелёный (1497 passed +5, ruff чист, makemigrations чист). Артефакты не закоммичены агентом. Status → done.
