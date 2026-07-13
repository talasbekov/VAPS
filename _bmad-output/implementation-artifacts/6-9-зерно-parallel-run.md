---
baseline_commit: |
  e515fb6 (feat(story-6.8): Golden master 20–30 исторических дней (расход)) — 6.8 закоммичен
  из рабочего дерева перед реализацией 6.9 (golden.py, docx_normalize.py, golden-корпус case_001..025,
  golden_update, pyproject маркер golden). Makefile golden-update target едет в коммите 6.9 (общий файл).
  Ветка: claude/exciting-vaughan-3e478b (E1–E6[6.1–6.8], E4/E5/E8 — done; расход-инфра в operations/submissions).
context:
  - _bmad-output/planning-artifacts/epics.md (§Epic 6 Story 6.9 стр. 827-834 «зерно parallel-run»; границы: 6.8 стр. 819-825 «golden master = зерно», 6.10 стр. 836-843 HTTP-период/на-завтра, 7.0 стр. 847-857 стенд-в-контуре исполняет джобу 6.9, 7.8 стр. 917-923 ФОРМАЛИЗАЦИЯ parallel-run = exit criterion+дедлайн+дашборд; допущения A7 стр. 266 «сервер ночью → catch-up 6.9», A8 стр. 267 «донор жив? нет → frozen-suite историч.», NFR-9 стр. 97 «parallel-run с донором … exit 10 рабочих дней без unclassified»)
  - _bmad-output/planning-artifacts/architecture.md (ARCH-DATA-025 «Parallel-run exit criterion (3 слоя): (A) frozen-suite byte-for-byte / (B) классификатор timing/model/unclassified на живом прогоне / (C) выход 10 рабочих дней … Классификатор строится ВМЕСТЕ с эпиком расхода, НЕ на этапе parallel-run»; Решение G1 «донор = эталон parallel-run»; §Принцип отсечения «СЕЙЧАС(6): parallel-run + diff-отчёты»; ARCH-003/004 operations↛core.models через селекторы; Admin: MUST NOT регистрация бизнес-моделей; молчание=СТОП для новых кодов/событий/терминов)
  - Backend/VAPS/apps/migration_legacy/donor_diff.py (ГОТОВЫЙ классификатор, story 1.8, ЧИСТЫЙ без ORM: diff_day(vaps, baseline_for_day, code_by_division_id)→DiffResult; load_baseline(data) multi-day envelope {"days":[{date, rows}]}; render_diff(diff); категории timing/half_open_end · model/aggregator_inferred · model/attached_source · model/overstaffed · data/skipped_employee · unclassified; GATE_BLOCKING_CATEGORIES=frozenset{unclassified, data/skipped_employee}; DiffResult.has_unclassified + counts; выравнивание по Division.code; VAPS_ONLY_FOLD_COLUMNS=(ON_DUTY,AFTER_DUTY,BEFORE_DUTY,PENDING))
  - Backend/VAPS/apps/migration_legacy/management/commands/strength_report.py (story 1.8 ОДНОРАЗОВЫЙ read-only оркестратор — прототип, который 6.9 ПРОДВИГАЕТ в stateful ночную джобу: compute→diff→gate, --diff-baseline; УЖЕ раскрывает механику «unclassified → CommandError → non-zero exit»; READ-ONLY: не пишет БД, не читает Clock, business_date аргументом)
  - Backend/VAPS/apps/operations/statuses/services/strength_report.py:141,249,260 (derive_report ЧИСТ; StrengthReportService.compute(business_date, division_id=None) — единственный ORM-вход расхода; REPORT_COLUMNS, STATUS_TYPE_PRIORITIES)
  - Backend/VAPS/apps/operations/submissions/management/commands/check_lagging_submissions.py (story 5.7b2 — КАНОН catch-up-джобы: beat-ready, Celery НЕ импортируется [12.6 обернёт в @shared_task], watermark-driven, --today для ручного/catch-up прогона с гвардом «будущий --today = foot-gun», хронологический идемпотентный прогон под advisory-локом; materialize_status_effects.py — второй catch-up-прецедент)
  - Backend/VAPS/apps/core/clock.py:44,73 (Clock.today_local(); override(value) контекст-менеджер; catchup_plan(*, watermark: date|None, today: date)→list[date] ЧИСТАЯ date-математика) + apps/core/models.py:426 (Watermark: key unique CharField, last_materialized_date DateField — bookkeeping «докуда прогнали», консьюмер ставит дату явно, без NOW())
  - Backend/VAPS/apps/notifications/ (story 5.7a — ПРЕЦЕДЕНТ нового top-level app: AppConfig+label, +INSTALLED_APPS, модель flat ARCH-003 без FK, миграция 0001, UniqueConstraint идемпотентности)
  - Backend/VAPS/apps/migration_legacy/tests/fixtures/donor_baseline_sample.json (СИНТЕТИЧЕСКОЕ «зерно»: {"days":[{date, rows:[{division_code, division_name, staff_unit, in_service, vacation, sick_leave, business_trip, training, seconded_in, seconded_out, other_absence}]}]}; hand-recalc донор-формулой, НЕ побайтовый пересчёт; DEP1/DIR1, 2026-06-04..06) + donor_slice.json (dumpdata-формат донора); spikes/1.11-donor-export/ (спайк выгрузки; реального прод-дампа в репо НЕТ)
  - docs/registries/{audit-events.yaml, error-codes.yaml, ws-message-types.yaml} (молчание=СТОП: parallel/diff/report/донор-событий сейчас НЕТ)
---

# Story 6.9: Зерно parallel-run

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a **разработчик**,
I want **stateful ночную diff-джобу «расход VAPS против замороженного донор-эталона» (beat-ready, Celery-free, watermark-driven с catch-up) поверх ГОТОВОГО классификатора `donor_diff` (1.8), которая для каждой бизнес-даты классифицирует каждое расхождение в timing/model/unclassified, ПЕРСИСТИТ результат в реестр расхождений и ведёт счётчик подряд-зелёных дней — НЕ блокируя мерж**,
so that **режим parallel-run «тикает фоном с этого момента»: каждый прогон оставляет диффабельный след, unclassified оседает тикетом-в-реестре (а не теряется), пропущенная ночь догоняется, и появляется числовая основа для будущего exit-criterion (7.8) — при этом падение джобы или unclassified остаётся тикетом, а не красным CI**.

## Acceptance Criteria

1. **Ночная джоба (beat-ready, Celery-free, watermark-driven).** Given management-команда `parallel_run_diff` (зеркало канона `check_lagging_submissions` 5.7b2), When она запускается БЕЗ аргументов, Then она берёт «сегодня» из `Clock.today_local()`, читает watermark через `apps.core.watermark.get_or_bootstrap("parallel_run", default_date=today-1)` (первый прогон → bootstrap-выход, НЕ backfill — C4), вычисляет незакрытые бизнес-даты через `catchup_plan(watermark=before, today=today)` и прогоняет их ХРОНОЛОГИЧЕСКИ; `--today YYYY-MM-DD` допустим для ручного/тестового/catch-up прогона; **будущий `--today` (впереди реального времени) отклоняется `CommandError`** (foot-gun-гвард 5.7b2 — иначе watermark уедет вперёд). Celery/cron НЕ импортируются (12.6 обернёт команду в `@shared_task` и зарегистрирует в beat).

2. **Классификация КАЖДОГО диффа — реюз `donor_diff`, НЕ переизобретать.** Given бизнес-дата `D` с замороженным донор-эталоном, When джоба прогоняет `D`, Then она зовёт `StrengthReportService.compute(business_date=D)` → `StrengthReportResult(business_date, rows, totals, violations, warnings)` (расход VAPS) и `donor_diff.diff_day(vaps, baseline_for_day=load_baseline(...)[D], code_by_division_id=…)` — **`compute()`-результат скармливается `diff_day` НАПРЯМУЮ, без трансформа** (`diff_day` читает `vaps.rows`/`vaps.violations`/`vaps.business_date`). Возврат — `DiffResult(business_date, cells: list[DiffCell], counts: dict, has_unclassified: bool)`; каждая `DiffCell` = `(division_code, column, vaps, donor, delta, category)` (⚠️ РЕАЛЬНЫЕ имена полей, `donor_diff.py:83-91` — НЕ `column_code`/`vaps_value`/`donor_value`). **Фактические категории (закрытый список, `donor_diff.py`): `timing/half_open_end`, `model/aggregator_inferred`, `model/attached_source`, `model/overstaffed`, `data/skipped_employee`, `unclassified`.** ⚠️ `DiffCell.column` НЕ всегда код колонки: бывает синтетическим (`"Штат<Список"` для overstaffed-нарушения, `"attached"`, `"IN_SERVICE"`, шесть `_TYPE_COLUMNS`) — реестр хранит строку как есть, НЕ валидирует по enum колонок. Классификатор/категории/fold-константы (`VAPS_ONLY_FOLD_COLUMNS`, `GATE_BLOCKING_CATEGORIES`) — контракт 1.8, 6.9 их НЕ меняет (правки классификатора → 7.8/отдельная стори).

3. **Персистентный реестр расхождений (модель + миграция).** Given прогон даты `D`, Then каждая `DiffCell` из `DiffResult.cells` сохраняется строкой реестра с явным маппингом полей: `run_date=D`, `division_code=cell.division_code`, `column_code=cell.column`, `donor_value=cell.donor`, `vaps_value=cell.vaps`, `delta=cell.delta`, `category=cell.category`, `is_blocking = cell.category in GATE_BLOCKING_CATEGORIES` (производное при записи, НЕ поле `DiffCell`), `pending_signature = cell.category.startswith("model/")` (производное). Повторный прогон той же `D` ИДЕМПОТЕНТЕН (upsert/replace по `(run_date, division_code, column_code)` — не плодит дубли; `column_code` уникален per-ячейка в выводе `diff_day`, включая синтетические строки). Прогон с нулём расхождений оставляет запись факта «D прогнан, 0 диффов» в `ParallelRunDay` (иначе зелёный день неотличим от «не прогнан»). ⚠️ **CheckConstraint на `category` — ТОЛЬКО `category != ""`** (без-молчаливого-пустого, преференс Bratan `feedback_vaps_db_integrity_checks`), **НЕ enum-список** (C3: enum связал бы миграцию app с каталогом категорий классификатора 1.8/7.8; новая категория 7.8 → IntegrityError внутри `transaction.atomic()` джобы → отравление соединения, а не мягкий тикет). `column_code` тоже БЕЗ enum (синтетические строки). `donor_value`/`vaps_value` — CheckConstraint `>= 0` (это НЕ дельты; `delta` может быть отрицательной — без floor-констрейнта).

4. **Счётчик подряд-зелёных дней.** Given реестр, When джоба завершила прогон, Then доступен «счётчик зелёных дней» = число последних ПОДРЯД прогнанных бизнес-дат с нулём `is_blocking`-строк (unclassified ∪ data/skipped_employee — оба блокирующие, Решение №11 1.8); первый блокирующий день обнуляет серию. Счётчик выводится в отчёт прогона (число, не дашборд — дашборд/exit-criterion = 7.8).

5. **unclassified = тикет, НЕ блокер мержа; падение = тикет.** Given прогон дал ≥1 `unclassified` (или `data/skipped_employee`), Then эти строки помечены `is_blocking=true` в реестре (это и есть «тикет» — durable-запись; внешней тикет-системы в проекте НЕТ), команда печатает их явным блоком и **завершается кодом 0** (в отличие от гейтящей 1.8-команды `strength_report --diff-baseline`, которая раняет `CommandError` — та остаётся CI-гейтом, 6.9 её НЕ трогает). Given непойманное исключение внутри прогона одной даты, Then оно логируется/оседает записью-тикетом и НЕ роняет прогон остальных дат и НЕ является блокером мержа (джоба фоновая, вне CI-гейта мержа).

6. **«Донор неправ» (model) — только зафиксировать, подпись = 7.8.** Given диффы категории `model/*` («намеренное улучшение VAPS»), Then они сохраняются в реестр с категорией и флагом `pending_signature` (не приняты автоматически); **рабочий процесс подписи заказчика + ссылки на регламент (ARCH-DATA-025 слой B) НЕ реализуется в 6.9 — это 7.8**. 6.9 не вводит «донор неправ» как авто-зелёную категорию (прецедент: `model/single_winner` удалён в ревью 1.8-C1 как неотличимый от потери данных — не воскрешать).

7. **Catch-up семантика (AC-2 эпика).** Given сервер был выключен `N` ночей, When джоба стартует при ближайшей доступности, Then `catchup_plan` возвращает ВСЕ пропущенные бизнес-даты `(watermark, today]` и джоба прогоняет каждую хронологически; watermark продвигается через `advance("parallel_run", to_date=D)` ПОСЛЕ успешного прогона даты (пропуск ночи прогон не теряет, A7). Прогон под session-level `apps.core.locks.advisory_lock(<parallel_run-key>, blocking=False)` (НЕ `select_for_update` — релизится на commit, а джоба коммитит по-дневно; `acquired=False` → тихий выход, другой прогон уже идёт).

8. **Гейт, границы, реестры.** `make gate` зелёный. НОВАЯ модель → миграция (manual-имя `NNNN_<entity>.py`, НЕ `_auto_`; сущность+констрейнты = одна миграция; `makemigrations --check` чист). Арх-гварды зелёные: `operations↛core.models` (только через селекторы), новая модель НЕ регистрируется в Django Admin (бизнес-модель, MUST NOT). Если вводится новое audit-событие/error-код/WS-тип — дописать в `docs/registries/*.yaml` тем же PR (молчание=СТОП); `test_audit_coverage`/`test_rbac_matrix` зелёные (при дефолте Д7 — без правок: джоба read-only-по-домену, не actor-мутация). `ruff check` чист; `ruff format` ТОЧЕЧНО по изменённым `.py` (память `feedback_vaps_ruff_format_scoping`). `make test-full` зелёный (2 пред-существующих teardown-ERROR concurrency — не регрессия, память `project_test_full_concurrency_teardown`).

## Tasks / Subtasks

- [x] Task 1: Дом реестра — новый top-level app `apps/parallel_run` (Д1, AC: 3, 8)
  - [x] `apps/parallel_run/apps.py` (AppConfig, `name="apps.parallel_run"`, `label="parallel_run"`) + `__init__.py`; регистрация в `INSTALLED_APPS` (settings). Зеркало 5.7a `apps/notifications`.
  - [x] Модель `ParallelRunDiff` (`models.py`), поля-приёмники `DiffCell` (маппинг AC-3): `run_date:DateField` (без отдельного db_index — ведущая колонка UniqueConstraint покрывает выборки по дате; текст исправлен на ревью 2026-07-13), `division_code:CharField`, `column_code:CharField` (хранит `cell.column`, вкл. синтетические строки), `donor_value:IntegerField`, `vaps_value:IntegerField`, `delta:IntegerField`, `category:CharField`, `is_blocking:BooleanField`, `pending_signature:BooleanField(default=False)`, timestamps. `db_table="parallel_run_diffs"` (явно). `UniqueConstraint(run_date, division_code, column_code)` (идемпотентный upsert, AC-3). ⚠️ `CheckConstraint`: **`category != ""`** (НЕ enum-список — C3, иначе миграция связана с каталогом классификатора + IntegrityError-в-atomic), `donor_value>=0`, `vaps_value>=0` (БЕЗ floor на `delta`). flat поля, БЕЗ FK через границу (ARCH-003).
  - [x] Модель `ParallelRunDay` (per-дата, Д5): `run_date:DateField(unique)`, `status:CharField` (`"ok"` / `"no_baseline"` — CheckConstraint `!= ""`; нужен для no-baseline-даты E4, чтобы watermark продвигался и дата не переигрывалась), `blocking_count:IntegerField`, `total_diffs:IntegerField`, `ran_at:DateTimeField`. Одна строка на прогнанную дату — источник счётчика зелёных дней («прогнан vs не прогнан», C4/E4). Обе модели в одной миграции `0001`.
  - [x] Миграция `0001_parallel_run.py` (manual-имя; round-trip forward→reverse→forward exit=0).
- [x] Task 2: Ночная джоба — команда `parallel_run_diff` (Д2, AC: 1, 2, 5, 6, 7)
  - [x] `apps/parallel_run/management/commands/parallel_run_diff.py` — СТРУКТУРНОЕ зеркало `check_lagging_submissions.py`: `--today` (foot-gun-гвард на будущую дату → `CommandError`); `today = Clock.today_local()` при отсутствии. ⚠️ **Watermark через КАНОНИЧЕСКИЙ gateway `apps.core.watermark`, НЕ `max(run_date)` из ParallelRunDay** (C4/C5): под advisory-локом `before, created = get_or_bootstrap("parallel_run", default_date=today - 1 day)`; если `created` (первый прогон на свежем деплое) → bootstrap-выход БЕЗ backfill (иначе `catchup_plan(watermark=None)` вернёт `[]` → джоба молча не прогонит ничего); иначе `dates = catchup_plan(watermark=before, today=today)`. Advisory-лок: `apps.core.locks.advisory_lock(<НОВЫЙ int-ключ parallel_run>, blocking=False)` — session-level `pg_advisory_lock` (⚠️ НЕ `select_for_update`/`pg_advisory_xact_lock`: релизятся на первом commit, а джоба коммитит по-дневно, `locks.py` это прямо запрещает; ключ ОТЛИЧНЫЙ от lagging `0x5641474C` и status-effects `0x56415053`). Для каждой `D` хронологически: `try: run_one(D)` → при исключении записать тикет и продолжить (AC-5).
  - [x] `run_one(D)`: `vaps = StrengthReportService.compute(business_date=D)`; `baseline = load_baseline(<источник эталона>)`; **если `D` НЕ в `baseline` → записать `ParallelRunDay(D, status="no_baseline")` (НЕ KeyError, НЕ ложный дифф) и продвинуть watermark, чтобы дата не переигрывалась вечно (E4)**; иначе `diff = diff_day(vaps, baseline[D], code_by_division_id=<Division.code→id map, см. Task 3>)`; upsert строк `ParallelRunDiff` из `diff.cells` (маппинг полей AC-3: `column_code=cell.column`, `donor_value=cell.donor`, `vaps_value=cell.vaps`, `delta=cell.delta`; `is_blocking = cell.category in GATE_BLOCKING_CATEGORIES`; `pending_signature = cell.category.startswith("model/")`); upsert `ParallelRunDay(D, status="ok", blocking_count, total_diffs, ran_at)`; **продвинуть watermark через gateway (`advance("parallel_run", D)`), а НЕ полагаться на факт ParallelRunDay** (единый источник watermark, C5).
  - [x] Отчёт прогона в stdout: сводка по категориям (реюз/зеркало `render_diff`), явный блок `UNCLASSIFIED`/`DATA-LOSS` при наличии, и **счётчик подряд-зелёных дней** (AC-4). Команда завершается кодом 0 даже при unclassified (AC-5) — НЕ `CommandError` на диффах.
  - [x] READ-ONLY по домену: джоба НЕ пишет `core.models`/статусы/сдачи — только свой `parallel_run`-реестр (арх-гвард).
- [x] Task 3: Источник донор-эталона (Д4, AC: 2, 3)
  - [x] Дефолт: эталон грузится из закоммиченного СИНТЕТИЧЕСКОГО `donor_baseline_sample.json` (или расширенного golden-производного набора) — реальный прод-дамп донора в репо/контуре ОТСУТСТВУЕТ (спайк 1.11 в `review`, доступ = за Bratan; A8 — «жив ли донор» — эскалация pending). Путь эталона — аргумент команды/сеттинг (`--baseline PATH`), НЕ хардкод.
  - [x] Явно задокументировать в Dev Notes: 6.9 = МЕХАНИКА зерна на замороженном эталоне; замена/добор реальными днями донора и `make freeze-donor` = 7.0/7.8 (когда доступен контур-стенд).
  - [x] `code_by_division_id` для `diff_day`: **ПРЯМОЙ `dict(Division.objects.values_list("id", "code"))`** (зеркало `strength_report.py:60`, `from apps.core.models import Division`) — ⚠️ core-СЕЛЕКТОРА `Division.code→id` в проекте НЕТ (E1); прямой импорт `core.models` легален для `parallel_run` как донор-парити-инфра (Q2/Д3), НЕ городить фиктивный селектор.
- [x] Task 4: `make parallel-run-diff` (Д6, AC: 1, 8)
  - [x] `Backend/VAPS/Makefile`: цель `parallel-run-diff` (в `.PHONY`), guard `.venv` (зеркало `golden-update`), запуск `manage.py parallel_run_diff` (+ postgres env-блок — джоба читает БД, в отличие от чистой golden-update). НЕ добавлять в `make gate` (фоновая, не CI-гейт).
- [x] Task 5: Тесты (AC: 1-7)
  - [x] `apps/parallel_run/tests/test_parallel_run_diff.py` (django_db): (a) прогон дня с известными диффами → строки реестра с верными категориями/is_blocking; (b) идемпотентность повторного прогона `D` (нет дублей); (c) catch-up: watermark N дней назад → прогнаны ВСЕ пропущенные даты (через `clock.override` для детерминизма); (d) unclassified → `is_blocking=true` + **exit 0** (не `CommandError`); (e) исключение на одной дате не роняет остальные; (f) счётчик зелёных дней: серия зелёных → N, блокирующий день → 0; (g) foot-gun будущий `--today` → `CommandError`; (h) `model/*` → `pending_signature=true`, не авто-зелёный.
  - [x] Реюз готовых unit-тестов классификатора (`migration_legacy/tests/test_donor_diff.py`) — НЕ дублировать классификацию; 6.9-тесты про ДЖОБУ+РЕЕСТР+CATCH-UP.
  - [x] Посев данных напрямую (`bulk_create`, БЕЗ factory_boy — память `reference_vaps_no_factory_boy`); `clock.override` для «сегодня/ночь». ⚠️ **E5: `StrengthReportService.compute` тянет из `HistoricalEmployeeSelector`/`CoreStaffingSelector`/`EmployeeStatusSelector` (`strength_report.py:278-287`)** — фикстура ОБЯЗАНА засеять Division (с `.code`) + Employee + staffing-слоты + статусы, ИНАЧЕ VAPS-расход пуст → каждая донор-строка станет `data/skipped_employee` (донор-профицит, который VAPS не объясняет) → диффы бессмысленны. Зеркалить сид `test_expense_formats_e2e.py`/донор-slice, согласовав `division_code` фикстуры с ключами `donor_baseline_sample.json`.
- [x] Task 6: Гейт, границы, реестры (AC: 8)
  - [x] `make gate` зелёный; `makemigrations --check` чист; round-trip `0001`; `ruff check` чист + `ruff format` точечно; `make test-full` зелёный (teardown-ERROR concurrency — пред-существующие).
  - [x] git-сверка границ: 1.8-класификатор (`donor_diff.py`), 6.8-golden, submissions/documents-пайплайн, rbac/audit-матрицы, `docs/registries/*.yaml` (если Д7 — без новых событий) — НЕ тронуты сверх объявленного; арх-гвард `operations↛core.models` и «Admin=только справочники» зелёные.

### Review Findings

<!-- Ревью 2026-07-13 (Fable 5, cross-model гейт AI-4 соблюдён: спека+dev = Opus 4.8). Слои: Blind Hunter / Edge Case Hunter / Acceptance Auditor. -->

- [x] [Review][Decision] Watermark продвигается после УПАВШЕЙ даты — отступление от буквы AC-7 («advance ПОСЛЕ успешного прогона»); канон 5.7b2 наоборот держит watermark для ретрая (`lagging_check.py:69-76`). **РЕШЕНО Bratan 2026-07-13: оставить advance** — error-строка = durable-тикет, liveness важнее авторетрая (систематически падающая дата не запирает план); ретрай-политика = 7.8. Отступление от буквы AC-7 ПРИНЯТО. [services/parallel_run_diff.py:180-191]
- [x] [Review][Patch] ✅ ИСПРАВЛЕНО 2026-07-13 (ex-Decision, **РЕШЕНО Bratan: no_baseline ПРОПУСКАЕТСЯ**) Зелёная серия: `no_baseline`-день не рвёт и не удлиняет серию (прозрачный день); `error` и blocking-дни рвут. Иначе календарные дыры эталона (выходные донора) структурно обнуляют серию каждые 5–6 дней и NFR-9 «10 рабочих дней» недостижим. Поправить `_green_streak` + тест на no_baseline-день в середине серии [Backend/VAPS/apps/parallel_run/services/parallel_run_diff.py:264-275]
- [x] [Review][Patch] ✅ ИСПРАВЛЕНО 2026-07-13 (ex-Decision, **РЕШЕНО Bratan: пустой день = no_baseline**) День в эталоне с пустым `rows: []` трактовать как `no_baseline` (`if not baseline_for_day` вместо `is None`) — артефакт заморозки не маскируется под массовую потерю данных; реальный «донор пуст» на живом доноре практически невозможен. + тест [Backend/VAPS/apps/parallel_run/services/parallel_run_diff.py:204-205]
- [x] [Review][Patch] ✅ ИСПРАВЛЕНО 2026-07-13 (halt_reason="baseline_unreadable", exit 0, watermark не тронут; докстринг поправлен) Baseline-I/O без защиты: `FileNotFoundError`/`JSONDecodeError`/`ValueError` из `load_baseline` → сырой traceback, non-zero exit (читается ДО лока) — пробой non-blocking-контракта AC-5 и докстринга «only hard error is --today»; в beat-режиме джоба будет молча падать каждую ночь без тикета. Fix: try/except → halt_reason="baseline_unreadable", exit 0 + поправить докстринг [Backend/VAPS/apps/parallel_run/services/parallel_run_diff.py:108,278-281]
- [x] [Review][Patch] ✅ ИСПРАВЛЕНО 2026-07-13 (обработчик обёрнут в собственный try/except: лог + continue) Recovery-ветка per-day сама не защищена: сбой соединения БД или `Watermark.DoesNotExist` внутри `except`-блока (`_record_error_day`+`advance` в atomic) вылетает наружу → остальные даты плана брошены, non-zero exit — тот же класс отказов, от которого ветка защищает. Обернуть обработчик [Backend/VAPS/apps/parallel_run/services/parallel_run_diff.py:180-191]
- [x] [Review][Patch] ✅ ИСПРАВЛЕНО 2026-07-13 (ValueError в сервисе до чтения baseline; + различение halt-reason today_behind_watermark vs clock_behind_watermark) Foot-gun-гвард будущего `--today` только в CLI-слое; сервис `run_parallel_run_diff` (который 12.6 обернёт в `@shared_task`) не защищён — вызов с будущей датой отравит watermark. Продублировать гвард в сервис [Backend/VAPS/apps/parallel_run/services/parallel_run_diff.py:104-106]
- [x] [Review][Patch] ✅ ИСПРАВЛЕНО 2026-07-13 (+12 тестов: реальный unclassified, E5-посев Division+slots+Employee+SICK_LEAVE→зелёный день, no_baseline-прозрачность серии, rows:[], future-today сервиса, unreadable-baseline+команда-exit-0, lock-skip, оба halt, усечение 31/64, краш recovery-ветки; 24/24 зелёные) Тест-дыры против Task 5: (d) нет теста с РЕАЛЬНОЙ категорией `unclassified` (blocking проверен только через data/skipped_employee); E5-посев обойдён — интеграция `compute→diff_day` не прогнана на непустом VAPS (Division+Employee+staffing+статусы); оркестрационные ветки не покрыты (lock-skip, clock_behind_watermark, gap-sanity, усечение 31, влияние no_baseline на серию) [Backend/VAPS/apps/parallel_run/tests/test_parallel_run_diff.py]
- [x] [Review][Patch] ✅ ИСПРАВЛЕНО 2026-07-13 (`remaining_backlog` в ParallelRunResult + logger.warning + WARNING-строка команды) Тихая усечка `MAX_CATCHUP_DAYS=31`: при бэклоге >31 дня — SUCCESS без признака «обработана часть, осталось N»; добавить сигнал в результат и stdout [Backend/VAPS/apps/parallel_run/services/parallel_run_diff.py:170]
- [x] [Review][Patch] ✅ ИСПРАВЛЕНО 2026-07-13 (Makefile-комментарий уточнён «БД сама НЕ поднимается» + семантика TODAY; real_today→run_today/wall_today; текст артефакта db_index поправлен) Мелочи: комментарий Makefile обещает поднятие БД, цель не поднимает (поправить комментарий или добавить `docker compose up -d --wait db`); ложный halt-reason `clock_behind_watermark` при `TODAY=<прошлое>` на свежем деплое (заявленный в Makefile сценарий недостижим — уточнить сообщение/док); имя `real_today` содержит ручную дату (переименовать); артефакт-текст «run_date db_index» не соответствует коду (индекса нет, спасает ведущая колонка UniqueConstraint — поправить текст) [Backend/VAPS/Makefile:34-49; services:507]
- [x] [Review][Defer] `gap > SANITY_DAYS(366)` — вечный halt без канала эскалации: каждый ночной запуск упирается в тот же halt при exit 0, единственный след — logger.error [services/parallel_run_diff.py:554-570] — deferred, наблюдаемость/алёрты = 7.8 (зеркало канона 5.7b2)
- [x] [Review][Defer] Хвосты 6.8 в коммите 6.9 (Makefile `golden-update` + gate-фильтр `not golden`) — стори не ревертится атомарно [Backend/VAPS/Makefile:18-30,59] — deferred, уже закоммичено, признано в frontmatter спеки

## Dev Notes

### ⚠️ Ловушка №1 (ГЛАВНАЯ): классификатор УЖЕ построен — 6.9 его ПРОДВИГАЕТ, не пишет заново

`apps/migration_legacy/donor_diff.py` (story 1.8) — готовый ЧИСТЫЙ классификатор: `diff_day`/`load_baseline`/`render_diff`, категории `timing/*`·`model/*`·`data/skipped_employee`·`unclassified`, `GATE_BLOCKING_CATEGORIES`, `DiffResult.has_unclassified`, выравнивание по `Division.code`, fold-константы `VAPS_ONLY_FOLD_COLUMNS`. Команда `strength_report --diff-baseline` (1.8) уже делает `compute→diff→gate` ОДНОРАЗОВО и синхронно. **6.9 = превращение этого прототипа в stateful фоновый режим**: (1) persist результата в реестр, (2) catch-up watermark, (3) счётчик зелёных дней, (4) НЕ-блокирующая семантика. Архитектура (ARCH-DATA-025) прямо говорит: «Классификатор строится ВМЕСТЕ с эпиком расхода, НЕ на этапе parallel-run» — поэтому он уже здесь, и 6.9 его РЕЮЗИТ. Любая правка правил/категорий классификатора — вне 6.9 (7.8 или отдельная стори).

### ⚠️ Ловушка №2: catch-up-джоба = ДОСЛОВНОЕ зеркало `check_lagging_submissions` (5.7b2), НЕ Celery

Проект уже имеет КАНОН beat-ready catch-up-джобы: `apps/operations/submissions/management/commands/check_lagging_submissions.py`. Читать его как шаблон ПЕРЕД написанием: (1) `Celery НЕ импортируется` — 12.6 обернёт команду в `@shared_task` и зарегистрирует в beat; (2) `--today` для ручного/catch-up прогона; (3) **будущий `--today` отклоняется `CommandError`** (иначе watermark уедет вперёд реального времени → все последующие реальные прогоны встанут `clock_behind_watermark`); (4) watermark-driven через `Clock`/`catchup_plan`; (5) advisory-лок против параллельных запусков; (6) хронологический идемпотентный прогон. `materialize_status_effects.py` — второй catch-up-прецедент. НЕ вводить Celery/cron/apscheduler (в проекте их нет; регистрация в beat = 12.6).

### ⚠️ Ловушка №3 (КРИТИЧНО, C4/C5): watermark — через gateway с BOOTSTRAP, НЕ `max(run_date)`

⚠️ **Watermark держится в КАНОНИЧЕСКОМ `apps.core.watermark`-gateway, НЕ выводится из `ParallelRunDay`.** `catchup_plan(watermark=None, ...)` возвращает **`[]`** (`clock.py`), значит на свежем деплое (пустой ParallelRunDay → `max=None`) джоба молча не прогонит НИЧЕГО. Канон `lagging_check.py:106-124` решает это bootstrap-шагом ПОД ЛОКОМ: `before, created = watermark_gateway.get_or_bootstrap("parallel_run", default_date=today - 1 day)`; `if created:` → выход без backfill (первый прогон только сеет watermark). Иначе `dates = catchup_plan(watermark=before, today=today)`, прогон, затем `watermark_gateway.advance("parallel_run", to_date=D)` после КАЖДОЙ успешной даты (AC-7; own key per catch-up domain, ARCH-DATA-022). `ParallelRunDay` — для «прогнан vs не прогнан» + счётчика зелёных (число последних подряд `ParallelRunDay(status="ok", blocking_count=0)`), НЕ для watermark (единый источник, C5). `catchup_plan` (`clock.py:73`) — keyword-only `watermark: date|None`, `today: date`; НЕ передавать datetime (TypeError-гвард).

### ⚠️ Ловушка №4: 6.9-джоба НЕ-блокирующая — в отличие от гейтящей 1.8-команды

`strength_report --diff-baseline` (1.8) НАМЕРЕННО раняет `CommandError` (non-zero) на `unclassified` — это CI-гейт «расхождение без объяснения = эпик не закрыт». **6.9-джоба — другой энтрипойнт с ПРОТИВОПОЛОЖНОЙ семантикой выхода**: unclassified/падение → durable-тикет в реестре + печать блока, но **exit 0** и НЕ блокер мержа (AC-5, буква эпика «падение джобы — тикет, не блокер мержа»). Обе команды сосуществуют: 1.8 гейтит, 6.9 фонит. НЕ переиспользовать `CommandError`-на-диффах в 6.9.

### ⚠️ Ловушка №5: «донор неправ» (model) и подпись — граница 6.9↔7.8

ARCH-DATA-025 слой B: категория `model` = «намеренное улучшение: запись в реестре + подпись заказчика + сверка с регламентом — “донор неправ” только против документа». **6.9 реализует ТОЛЬКО “запись в реестре” (флаг `pending_signature`)**; рабочий процесс подписи/ссылки-на-регламент + exit criterion (10 рабочих дней · 100% авто-классификация · frozen-suite зелёный) + дедлайн + дашборд зелёных дней = **7.8 «формализация parallel-run»** (epics стр. 917-923). 6.9 не авто-зеленит `model`. Прецедент: `model/single_winner` был УДАЛЁН в ревью 1.8-C1 (Bratan, Вариант 1) как неотличимый от потери данных, который тихо зеленил гейт на потерянной донор-строке — не воскрешать никакую «single winner»/«донор неправ» авто-зелёную категорию без решения Bratan.

### ⚠️ Ловушка №6: `data/skipped_employee` — БЛОКИРУЕТ, это не free pass

`GATE_BLOCKING_CATEGORIES = frozenset({"unclassified", "data/skipped_employee"})` (Решение №11 1.8): потеря VAPS донор-строки = «донор прав, VAPS потерял» → блокирующее. `is_blocking` в реестре обязан включать ОБЕ категории, не только `unclassified`. Счётчик зелёных дней обнуляется на любой блокирующей.

### ⚠️ Ловушка №7: арх-границы — новый app, но модель НЕ в Admin, `operations↛core.models` цел

- Новый `apps/parallel_run` (top-level, как `notifications`/`documents`/`audit`) — БИЗНЕС-модель, поэтому **НЕ регистрировать в Django Admin** (architecture: «Admin — только справочники без бизнес-инвариантов; MUST NOT регистрация … документов/статусов»; память `feedback_vaps_arch_guards`).
- Джоба читает расход через `StrengthReportService.compute` (ORM-вход statuses) — легально. Донор-эталон грузится из JSON (`load_baseline`), НЕ из ORM. Map `Division.code→id` — **ПРЯМОЙ `dict(Division.objects.values_list("id","code"))`** (селектора нет, E1; зеркало `strength_report.py:60`).
- ⚠️ **E2: изоляционный гвард — per-app OPT-IN, глобального скана НЕТ.** Каждый app сам держит `tests/test_isolation.py`, сканирующий ТОЛЬКО свой контекст (`notifications/tests/test_isolation.py` сканит `"notifications"`); `migration_legacy` изоляционного теста НЕ имеет ВООБЩЕ. Значит новый `parallel_run` с `import apps.core.models` НЕ роняет НИЧЕГО — «настраивать AST-гвард» не нужно/нечего. Единственное решение (Q2/Д3): **НЕ добавлять `parallel_run/tests/test_isolation.py`** — прямой импорт `core.models` не-гвардится, как в `migration_legacy` (донор-парити-инфра). Если Bratan захочет запретить — тогда добавить свой isolation-тест (не дефолт).

### ⚠️ Ловушка №8: A8 (жив ли донор?) и реальный эталон — известный внешний блокер

Ночная diff-джоба «против донора» предполагает эталон. A8 (epics стр. 267, эскалация `escalation-A5-A8-owner-2026-06-16.md`, статус draft-pending-send) — открытый вопрос заказчику «вносит ли кто-то данные в донора сейчас?»: если НЕТ → parallel-run переопределяется на frozen-suite историч. + ручная сверка (7.9). **6.9 механику это НЕ блокирует**: джоба дифает против ЗАМОРОЖЕННОГО baseline-JSON (работает в обоих режимах — живой инкремент донора ИЛИ исторический frozen). Реальный прод-дамп донора в репо отсутствует (спайк 1.11 в `review`, прод-доступ = за Bratan) → дефолт-эталон синтетический; замена реальными днями + `make freeze-donor` = 7.0/7.8. Задокументировать зависимость, НЕ блокировать реализацию механики.

### Эталоны — всё в кодовой базе, ничего не изобретать

- Классификатор + категории + gate-логика: `apps/migration_legacy/donor_diff.py` (`diff_day`/`load_baseline`/`render_diff`/`DiffResult`/`GATE_BLOCKING_CATEGORIES`).
- Синхронный прототип оркестрации: `apps/migration_legacy/management/commands/strength_report.py` (compute→diff→gate).
- Расход (ORM-вход): `apps/operations/statuses/services/strength_report.py:260` `StrengthReportService.compute(business_date, division_id=None)`.
- Catch-up джоба-канон: `apps/operations/submissions/management/commands/check_lagging_submissions.py` (5.7b2); `materialize_status_effects.py` (statuses).
- Catch-up математика + watermark: `apps/core/clock.py:73` `catchup_plan`; `apps/core/models.py:426` `Watermark`.
- Новый top-level app: `apps/notifications` (5.7a — AppConfig/label/INSTALLED_APPS/миграция 0001/flat-модель).
- Синтетический эталон + формат: `apps/migration_legacy/tests/fixtures/donor_baseline_sample.json`.
- Реестры: `docs/registries/{audit-events,error-codes,ws-message-types}.yaml`.

### Дефолты (Д1/Д3-модели/Д7/Д9 ✅ ПОДТВЕРЖДЕНЫ Bratan 2026-07-09; остальные под #YOLO)

> **Подтверждено Bratan (2026-07-09):** Q1→**новый app `apps/parallel_run`** (Д1); Q3→**две модели `ParallelRunDiff`+`ParallelRunDay`** (Д5); Q4→**без AuditLog-события** (Д7); Q6→**одна когезивная стори** (Д9). Остаются открытыми (дефолты активны): Q2 (граница app/импорт core.models — Д3), Q5 (синтетический эталон — Д4), Q7 (граница 6.9↔7.8).

- **Д1 (ГЛАВНЫЙ, схемо-влияющий) ✅ РЕШЕНО = НОВЫЙ top-level `apps/parallel_run`** (зеркало прецедента 5.7a `notifications`: новый домен → новый top-level app; parallel-run переживёт миграцию, отдельный дом чище). Отклонены: модель в `migration_legacy` (app без `models.py`/`migrations/` сейчас) и в `operations/submissions`.
- **Д2 (джоба):** management-команда `parallel_run_diff`, beat-ready/Celery-free, зеркало 5.7b2 (watermark+catch-up+advisory-лок+foot-gun-гвард).
- **Д3 (граница app):** `parallel_run` = донор-парити-инфра → импорт `apps.core.models` легален (как `migration_legacy`); AST-гвард настроить. Альт: только через core-селекторы.
- **Д4 (эталон):** синтетический `donor_baseline_sample.json` через `--baseline PATH`; реальный донор-freeze + `make freeze-donor` = 7.0/7.8 (прод-доступ pending, A8/1.11).
- **Д5 (модели) ✅ РЕШЕНО = ДВЕ модели:** `ParallelRunDiff` (per-ячейка) + `ParallelRunDay` (per-дата, для watermark и счётчика зелёных). Обе в `0001`. Отклонён вариант «одна модель + сентинел-строка зелёного дня».
- **Д6 (make):** `make parallel-run-diff` (guard .venv + postgres-env; НЕ в gate).
- **Д7 (audit/коды) ✅ РЕШЕНО = БЕЗ AuditLog-события:** джоба read-only-ПО-ДОМЕНУ, пишет только свой реестр → **НЕ вводить AuditLog-событие и новые error-коды** (реестр `ParallelRunDiff`/`ParallelRunDay` — сам след; `test_audit_coverage`/`test_rbac_matrix` без правок). Отклонён `PARALLEL_RUN_COMPLETED`.
- **Д8 (объём/exit семантика):** unclassified/падение = durable-тикет + exit 0 (не блокер мержа); гейтящая 1.8-команда не трогается.
- **Д9 (объём стори) ✅ РЕШЕНО = ОДНА когезивная стори** (зерно parallel-run). Много реюза (классификатор+catch-up-канон готовы); модель-без-джобы-писателя = пустая стори (анти-прецедент 5.6b over-decomposition). Отклонён сплит 6.9a/6.9b.

### Границы (что 6.9 НЕ делает)

- **Формализация parallel-run** — exit criterion (10 рабочих дней без unclassified · 100% авто-классификация · frozen-suite зелёный), дедлайн, дашборд зелёных дней, рабочий процесс подписи «донор неправ» → **7.8** (epics стр. 917-923; ARCH-DATA-025 слой C).
- **frozen-suite byte-for-byte строгий diff** (ARCH-DATA-025 слой A) + `make freeze-donor` → 7.8/7.0.
- **Исполнение джобы в контуре** (где живут данные донора) → **7.0** (стенд-в-контуре; epics стр. 851 «diff-джобы 6.9 исполняются там»).
- **Celery `@shared_task` + регистрация в beat-расписании** → **12.6**.
- **Реальный прод-дамп донора / доступ** → спайк 1.11 (review) + A8-эскалация (прод-доступ за Bratan).
- **Изменение классификатора `donor_diff`** (новые категории, timing-replay логики донора) → 7.8/отдельная стори; 6.9 реюзит контракт 1.8 как есть.
- **HTTP-поверхность / UI дашборда parallel-run** → E10/7.8; 6.9 — джоба+реестр+CLI-отчёт.

### Previous Story Intelligence

- **6.8 (golden master, done, uncommitted в рабочем дереве)** — САМОРЕФЛЕКСИВНЫЙ регресс-мастер (эталон = вывод VAPS заморожен), НЕ паритет-с-донором. Его Dev Notes прямо: «Паритет VAPS-vs-донор (классификатор timing/model/unclassified, `donor_diff.py`, ночная джоба) = Story 6.9». 6.8 НЕ трогал `donor_diff`/`migration_legacy` — 6.9 первый реальный потребитель `donor_diff` после 1.8. ⚠️ Закоммитить 6.8 ПЕРЕД dev-story 6.9 (baseline-SHA).
- **1.8 (read-only вывод + дифф с донором, done)** — построил `donor_diff` + `strength_report`-команду + gate-механику. Ревью-уроки: C1 удаление `model/single_winner`; C4 guard отрицательных счётчиков (`donor_diff.py:165-169` — не воскрешать «fail-safe»); Решение №11 `data/skipped_employee`=блокер. 6.9 наследует эти инварианты.
- **5.7a/5.7b2 (notifications + lagging catch-up)** — прецедент нового top-level app + КАНОН beat-ready catch-up-джобы (watermark/foot-gun/advisory-лок/Celery-free). 6.9-джоба — прямое зеркало.
- **3.9 (PENDING)** — добавил `PENDING` в `VAPS_ONLY_FOLD_COLUMNS` (патч P2), иначе PENDING-статус давал ложный `data/skipped_employee`. Fold-набор — контракт, не трогать.
- **Процессный цикл (память `project_bmad_story_cycle_flow`):** коммит после ревью; `graphify update .` отдельным chore при значимом изменении app-кода (`parallel_run`+`migration_legacy`); baseline-SHA 6.8 в шапку при dev-story; same-model-ревью caveat → fresh-context валидация по checklist.

### Git Intelligence

- Ветка `claude/exciting-vaughan-3e478b`: E1–E6[6.1–6.8], E4/E5/E8 done; расход-инфра в `operations/submissions` (НЕ `operations/reports` — арх-путь устарел, пакета `reports` нет). Эпик 6 идёт «одна стори — один коммит» (`feat(story-6.N): …`).
- ⚠️ Реализация 6.8 (golden.py/docx_normalize.py/корпус/Makefile/pyproject) в рабочем дереве НЕ закоммичена (HEAD `b7f7d92` = только спека 6.8). Закоммитить `feat(story-6.8)` → его SHA = baseline 6.9.
- Донор-инфра (`migration_legacy`: donor_diff/strength_report/import_donor_slice/transform) заложена в E1 (1.6–1.8) — НЕ переизобретать.
- `catchup_plan`/`Watermark`/`check_lagging_submissions`/`materialize_status_effects` — E3-catchup/E5 инфра, готова к реюзу.

### Project Structure Notes

- Новый код: `apps/parallel_run/{apps.py, __init__.py, models.py, migrations/0001_parallel_run.py, management/commands/parallel_run_diff.py, tests/test_parallel_run_diff.py}`; `Backend/VAPS/config/settings.py` (+INSTALLED_APPS — N1: single-file settings, не пакет `settings/`); `Backend/VAPS/Makefile` (+parallel-run-diff). Реюз (импорт, не копия): `apps.migration_legacy.donor_diff`, `apps.operations.statuses.services.StrengthReportService`, `apps.core.clock.catchup_plan/Clock`, `apps.core.watermark` (get_or_bootstrap/advance), `apps.core.locks.advisory_lock`, `apps.core.models.Division` (прямой, E1).
- Арх-гвард: новая модель НЕ в Admin; `parallel_run`→core.models — Д3 (донор-инфра, прямой импорт не-гвардится, E2 — изоляционный тест не добавляем).
- Миграция manual-имя `0001_parallel_run.py`, сущности+констрейнты одной миграцией; `makemigrations --check` чист.
- `graphify update .` — отдельным chore после ревью (значимое изменение app-кода).

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Story-6.9 (стр. 827-834) — ночная diff-джоба + реестр timing/model/unclassified + счётчик зелёных дней + catch-up; unclassified=тикет; «донор неправ» только с регламентом+подписью; падение=тикет не блокер]
- [Source: epics.md стр. 819-825 (6.8 golden=зерно), 847-857 (7.0 стенд исполняет 6.9), 917-923 (7.8 формализация: exit criterion+дедлайн+дашборд), 266-267 (A7 catch-up / A8 донор-жив), 97 (NFR-9 exit 10 рабочих дней)]
- [Source: architecture.md — ARCH-DATA-025 «Parallel-run exit criterion (3 слоя)»; Решение G1 донор=эталон; Принцип отсечения «СЕЙЧАС(6): parallel-run»; ARCH-003/004 границы; Admin=только справочники; молчание=СТОП]
- [Source: Backend/VAPS/apps/migration_legacy/donor_diff.py — diff_day/load_baseline/render_diff/DiffResult/GATE_BLOCKING_CATEGORIES/VAPS_ONLY_FOLD_COLUMNS; выравнивание по Division.code]
- [Source: Backend/VAPS/apps/migration_legacy/management/commands/strength_report.py — синхронный прототип compute→diff→gate (1.8); gate через CommandError на unclassified]
- [Source: Backend/VAPS/apps/operations/statuses/services/strength_report.py:141,260 — derive_report / StrengthReportService.compute]
- [Source: Backend/VAPS/apps/operations/submissions/management/commands/check_lagging_submissions.py — КАНОН beat-ready catch-up (5.7b2): Celery-free, watermark, foot-gun-гвард, advisory-лок]
- [Source: Backend/VAPS/apps/core/clock.py:73 (catchup_plan, watermark=None→[]) + apps/core/models.py:426 (Watermark) + apps/core/watermark.py:13,27 (get_or_bootstrap(key,*,default_date) / advance(key,*,to_date)) + apps/core/locks.py:22 (advisory_lock(key,*,blocking); session-level pg_advisory_lock, select_for_update ЗАПРЕЩЁН)]
- [Source: Backend/VAPS/apps/operations/submissions/services/lagging_check.py:106-124 — bootstrap-под-локом ПАТТЕРН (get_or_bootstrap→created?выход:catchup_plan→per-day-atomic→advance); LAGGING_LOCK_KEY 0x5641474C, status-effects 0x56415053 — parallel_run берёт ТРЕТИЙ]
- [Source: Backend/VAPS/apps/migration_legacy/donor_diff.py:83-91 (DiffCell: division_code/column/vaps/donor/delta/category) + :352-406 (DiffResult: business_date/cells/counts/has_unclassified) + :257-296 (синтетические column-строки «Штат<Список»/«attached»/«IN_SERVICE»); apps/operations/statuses/services/strength_report.py:60 (dict(Division.objects.values_list("id","code")) — прямой, селектора нет)]
- [Source: Backend/VAPS/apps/notifications/ — прецедент top-level app (5.7a); apps/operations/statuses/management/commands/materialize_status_effects.py — 2-й catch-up]
- [Source: Backend/VAPS/apps/migration_legacy/tests/fixtures/donor_baseline_sample.json — синтетический эталон + формат; docs/registries/*.yaml]

### Latest Tech Information

- Новых внешних зависимостей 6.9 НЕ вводит: `donor_diff`/`catchup_plan`/`StrengthReportService`/`watermark`/`locks` — внутренние; stdlib `json`/`datetime`. Celery/cron/apscheduler НЕ вводятся (12.6). Advisory-лок = `apps.core.locks.advisory_lock(key, blocking=False)` (session-level `pg_advisory_lock`, `locks.py:22`) — ⚠️ НЕ `select_for_update`/`pg_advisory_xact_lock` (релизятся на первом commit, а джоба коммитит по-дневно — `locks.py:5-9` это прямо запрещает).
- `make gate`/`make test-full` из `Backend/VAPS` (память `project_vaps_gate_location`), Postgres :5433 (`docker compose up -d --wait db`). tz-флейк `test_vacancies_endpoint` (00:00–05:00) — не 6.9.

### Открытые вопросы (для Bratan — НЕ блокируют, приняты дефолты)

✅ **Решены Bratan 2026-07-09:** Q1 (дом = новый app `parallel_run`), Q3 (две модели Diff+Day), Q4 (без audit-события), Q6 (одна когезивная стори). Остаются:

- **Q2 (граница app — ГЛАВНЫЙ оставшийся):** теперь, когда Q1=новый app, нужен вердикт для AST-гварда — `parallel_run` = донор-парити-инфра с легальным импортом `core.models` (как `migration_legacy`) [Д3, дефолт] vs operations-подобный (только core-селекторы)?
- **Q5 (эталон):** синтетический baseline сейчас [Д4] — подтвердить, что реальный донор-freeze осознанно отложен в 7.0/7.8 (A8/1.11 pending), 6.9 = механика зерна.
- **Q7 (граница 6.9↔7.8):** подтвердить, что 6.9 = живой классифицирующий прогон + реестр + счётчик + catch-up, а exit-criterion/подпись-заказчика/дашборд/frozen-suite-строгий = 7.8.

### Процессный гейт (AI-4 / AI-3, epic-5-retro)

- ⚠️ **6.9 — в cross-model/ultra списке гейта AI-4** (sprint-status упоминает «cross-model гейт AI-4 — там 6.3/6.5/**6.9**»): реализацию ревьюить cross-model/ultra (same-model недостаточно). Эта СПЕКА написана Opus 4.8 → dev-story другой моделью, ревью — третьей/ultra.
- Fresh-context валидация спеки по `checklist.md` (same-model caveat) — провести после написания.
- `make gate` перед коммитом; catch-up-джоба тестируется через `clock.override` (детерминизм), не реальным временем.

## Dev Agent Record

### Agent Model Used

claude-opus-4-8 (Opus 4.8) — create-story + fresh-context валидация (свежий агент) + dev-story (ручной прогон, TDD)

### Debug Log References

- **make gate зелёный:** 2134 passed (+12 новых, база 6.8 = 2122), 56 deselected, `makemigrations --check` «No changes detected», ruff чист (после `ruff format` по авто-миграции 0001 + тест-файлу — прецедент 3.5), 40s. Ноль регрессий.
- Новые тесты (12) прошли изолированно за 1.63s; round-trip миграции неявно (gate makemigrations-check чист).
- Категории диффа воспроизведены на пустом VAPS против crafted-baseline: `data/skipped_employee` (in_service донора → блокер), `model/attached_source` (seconded_in → pending_signature, не блокер), зелёный день (all-zero row → 0 ячеек).

### Completion Notes List

- **Реализовано в worktree `exciting-vaughan-3e478b`** (E6-линия), НЕ в reverent-dhawan (решение Bratan). Все дефолты Д1-Д9 + правки fresh-context-валидации (C1-C6/E1-E5) применены как написано.
- **Task 1 (app+модели+миграция) — DONE.** Новый top-level `apps/parallel_run` (AppConfig label=parallel_run, +INSTALLED_APPS). `ParallelRunDiff` (поля-приёмники DiffCell: column_code=cell.column вкл. синтетику, donor/vaps/delta; is_blocking/pending_signature derived; UniqueConstraint(run_date,division_code,column_code); CheckConstraint category!="" [НЕ enum — C3], values>=0). `ParallelRunDay` (run_date unique, status ok/no_baseline/error [C4/E4], blocking_count/total_diffs). Миграция `0001_parallel_run` (manual-имя).
- **Task 2 (джоба) — DONE.** `services/parallel_run_diff.py` — зеркало lagging_check 5.7b2: advisory_lock(PARALLEL_RUN_LOCK_KEY=0x56505244 «VPRD», blocking=False) → get_or_bootstrap("parallel_run", today-1)+created-выход [C4/C5] → clock-behind/sanity → catchup_plan → per-day atomic (_run_one + advance to_date=D). НЕ-блокирующая (C6/AC-5): per-day crash → _record_error_day + advance + continue (не raise); command exit 0 даже на unclassified/halt. Команда `parallel_run_diff` (foot-gun future --today → CommandError; --baseline).
- **Task 3 (эталон) — DONE.** `--baseline` default = синтетический `donor_baseline_sample.json` (Д4; реальный freeze=7.0/7.8). `code_by_division_id` = прямой `dict(Division.objects.values_list("id","code"))` (E1, селектора нет; импорт core.models легален как донор-инфра).
- **Task 4 (make) — DONE.** `make parallel-run-diff` (guard .venv + postgres-env; TODAY=/BASELINE= опц.; НЕ в gate).
- **Task 5 (тесты) — DONE.** 12 тестов django_db: категории+is_blocking, model→pending_signature, green-streak (3 подряд), blocking сбрасывает streak, catch-up 3 дня, идемпотентность, no_baseline, per-day crash изолирован+non-blocking (monkeypatch compute), first-run bootstrap без backfill, foot-gun future --today, command exit 0 на blocking, services re-export. Посев напрямую (без factory_boy); crafted-baseline против пустого VAPS = детерминированные категории (E5-сложный посев обойдён для job-логики).
- **Task 6 (гейт/границы) — DONE.** gate зелёный; makemigrations-check чист; ruff чист; арх-гвард `operations↛core.models` зелёный (parallel_run не в operations; изоляционный тест не добавлен — E2/Д3); модель НЕ в Admin; audit/rbac-матрицы без правок (Д7 — джоба read-only-по-домену, ноль record()); реестры *.yaml не тронуты (новых событий/кодов нет).
- **Границы соблюдены:** exit-criterion/подпись/дашборд/frozen-suite-строгий=7.8; контур-исполнение=7.0; Celery+beat=12.6; реальный донор-дамп=1.11/A8.
- **Осталось (Q2/Q5/Q7):** дефолты активны, подтвердить на ревью. ⚠️ 6.9 в cross-model гейте AI-4 — ревью не той же моделью.

### File List

- `Backend/VAPS/apps/parallel_run/__init__.py` (создан)
- `Backend/VAPS/apps/parallel_run/apps.py` (создан — AppConfig)
- `Backend/VAPS/apps/parallel_run/models.py` (создан — ParallelRunDiff + ParallelRunDay)
- `Backend/VAPS/apps/parallel_run/migrations/__init__.py` (создан)
- `Backend/VAPS/apps/parallel_run/migrations/0001_parallel_run.py` (создан)
- `Backend/VAPS/apps/parallel_run/services/__init__.py` (создан — re-export)
- `Backend/VAPS/apps/parallel_run/services/parallel_run_diff.py` (создан — джоба+catch-up+persist+green-streak)
- `Backend/VAPS/apps/parallel_run/management/__init__.py` (создан)
- `Backend/VAPS/apps/parallel_run/management/commands/__init__.py` (создан)
- `Backend/VAPS/apps/parallel_run/management/commands/parallel_run_diff.py` (создан — beat-ready команда)
- `Backend/VAPS/apps/parallel_run/tests/__init__.py` (создан)
- `Backend/VAPS/apps/parallel_run/tests/test_parallel_run_diff.py` (создан — 12 тестов)
- `Backend/VAPS/config/settings.py` (изменён — +"apps.parallel_run" в INSTALLED_APPS)
- `Backend/VAPS/Makefile` (изменён — +parallel-run-diff цель + .PHONY)
