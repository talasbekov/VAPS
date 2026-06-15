---
baseline_commit: b12603a934e756820514cfe43a026cde3c0e6713 (+ незакоммиченный блок сторей 1.1–1.7 в рабочем дереве)
---

# Story 1.8: Read-only вывод расхода и дифф с донором

Status: review

## Story

As a разработчик,
I want команду вывода расхода за дату/период (таблица + простой `.xlsx`) и diff-отчёт против цифр донора с категорией-гипотезой на каждое расхождение,
so that модель времени проверяется реальными данными — это DoD-гейт E1: расхождение без объяснения = эпик не закрыт.

## Acceptance Criteria

1. **Given** 5–7 импортированных дней, **When** генерирую расход за каждый день, **Then** для каждого дня выводится таблица расхода по подразделениям (Штат / Список / Вакансии / колонки `REPORT_COLUMNS` / Прикомандировано) + тоталы, и пишется простой `.xlsx`.
2. **Given** эталон донора за тот же день, **When** запускаю дифф, **Then** числа совпадают с эталоном ИЛИ каждое расхождение помечено ровно одной категорией канона parallel-run (architecture.md:311): **`timing`** (реплеируемо → объяснено) или **`model`** (намеренное расхождение модели; на E1 — гипотеза-заметка, формализация подписи/реестра = E7 7.8); всё необъяснённое **И** потеря данных VAPS (`data/skipped_employee`) → **`unclassified`** (блокер).
3. **And** эталон поступает в фиксированной JSON-схеме (многодневный конверт `days[]`, ключ внутри дня — `division_code`) и берётся из одного из источников: сохранённые расходы донора · пересчёт донорским кодом (`DataAggregator`, freeze) · память владельца / синтетический кейс (A4-страховка). Команда диффа агностична к источнику.
4. **And** кейс ретро-правки (AC эпика): синтетический или из памяти владельца — у донора плоская модель, следов правок в данных нет; демонстрируется, что правка интервала статуса задним числом меняет derived-расход на накрытую дату (Amendment-flow и снапшоты — E5, здесь только демонстрация эффекта).
5. **And** DoD-гейт механизирован: при наличии `unclassified`-расхождений команда диффа завершается ненулевым кодом и печатает явный блок `UNCLASSIFIED` — «расхождение без объяснения = эпик не закрыт» становится проверяемым, а не на словах.
6. **And** read-only: команда НЕ пишет в БД, НЕ читает Clock (business_date — явный аргумент), НЕ принимает actor; расход берётся строго через `StrengthReportService.compute` (контракт 1.7), рендер и дифф — чистые функции.

## Tasks / Subtasks

- [x] Task 1: зависимость для `.xlsx` (AC: 1)
  - [x] `pyproject.toml`: добавить `openpyxl>=3,<4` в `[project] dependencies` (рантайм — команда исполняется в контуре в составе image `migration_legacy`; чистый Python, офлайн-дружелюбен — критично для air-gap). Решение №3: это конец «нулевых рантайм-зависимостей» 1.7, санкционировано буквой AC «простой .xlsx». Других зависимостей НЕ добавлять
  - [x] `pip install -e '.[dev]'` после правки — иначе collection error в тестах рендера
- [x] Task 2: чистый модуль рендера расхода (AC: 1)
  - [x] `apps/migration_legacy/strength_render.py` — БЕЗ ORM/Django (тестируется без БД; ест `StrengthReportResult` из 1.7):
    - `COLUMN_LABELS_RU: dict[str, str]` — человекочитаемые заголовки для кодов `REPORT_COLUMNS` + Штат/Список/Вакансии/Прикомандировано (`SICK`→«Больничный», `VACATION`→«Отпуск», `COMMAND`→«Командировка», `TRAINING`→«Учёба», `OTHER`→«Прочие», `DETACHED`→«Откомандировано», `AFTER_DUTY`→«После деж.», `BEFORE_DUTY`→«Перед деж.», `ON_DUTY`→«На деж.», `IN_SERVICE`→«В строю»). Это **строки отображения**, не доменные термины — Glossary не пополняется; канон в коде остаётся кодом колонки
    - `render_table(result: StrengthReportResult) -> str` — текстовая таблица для stdout: строка на подразделение (name, staff_total, list_total, vacancies, колонки в порядке `REPORT_COLUMNS`, attached как «+N»), строка тоталов; ниже — блоки `violations` (staff_lt_list: division/staff/list) и `warnings` (no_staffing_record) человекочитаемо. Детерминированный порядок строк (как в `result.rows` — он уже отсортирован в `derive_report`)
    - `build_workbook(results: list[StrengthReportResult])` → объект `openpyxl.Workbook`: один лист на дату (имя листа = ISO-дата — 10 символов, без запрещённых openpyxl символов `/\\?*[]:`, коллизий нет при уникальных датах), шапка из `COLUMN_LABELS_RU`, строки подразделений, строка тоталов; **удалить дефолтный лист `Sheet`** (openpyxl создаёт его при `Workbook()`) — в файле не должно остаться пустого листа. **Простой**: без стилей/формул/мерджей/golden-master (полный генератор и golden — E6 6.3/6.8). `openpyxl` импортировать **на уровне функции** (модуль остаётся импортируемым без openpyxl для unit-тестов текстовой таблицы)
  - [x] MUST NOT: print() внутри (рендер возвращает строку/объект, печатает команда); `timezone.now()`/`date.today()`; запись в БД
- [x] Task 3: чистый модуль диффа с донором (AC: 1, 2, 5)
  - [x] `apps/migration_legacy/donor_diff.py` — БЕЗ ORM (тестируется без БД):
    - `DONOR_TO_VAPS: dict` — отображение колонок донорского `DataAggregator` → колонки VAPS (см. таблицу в Dev Notes): `staff_unit`→staff_total, `sick_leave`→SICK, `business_trip`→COMMAND, `other_absence`→OTHER, `seconded_out`→DETACHED — донор-агрегатор разбивает эти типы в свои колонки, VAPS 1:1; `vacation`→VACATION, `training`→TRAINING — донор считает ТОЛЬКО `vacation`/`training`, VAPS folds сюда ещё `leave_by_report`/`competition`; `seconded_in`→attached — разные источники; `in_service`→IN_SERVICE — у донора это catch-all (inferred + все типы, которые агрегатор не разбивает). НЕ в маппинге (нет донор-поля): `list_total`, `vacancies`, `present_total`, `presence_pct`
    - `BaselineRow` (dataclass) + `load_baseline(data) -> dict[date, dict[str, BaselineRow]]` — **многодневный конверт** (донорский `DataAggregator.collect_data` отдаёт ОДИН день за прогон → 5–7 прогонов склеиваются в `days[]`): схема `{"days": [{"date": "YYYY-MM-DD", "rows": [{"division_code", "division_name", "staff_unit", "in_service", "vacation", "sick_leave", "business_trip", "training", "seconded_in", "seconded_out", "other_absence"}]}]}`; внешний ключ = дата (ISO→`date`), внутренний = `division_code`. Невалидная схема → `ValueError`; **дубликат `division_code` в одном дне → `ValueError`** (СТОП-семантика: схлопнутые под `(organization, code)` донор-коды обязаны резолвиться pk→code на freeze-шаге, НЕ тихий last-write-wins — зеркало фикса C2/KO-2 импорта)
    - `CATEGORY_RULES` — фиксированный каталог детерминированных правил, выровненный на канон 3-категорий architecture.md:311 (Решение №6 + №11): `timing/half_open_end`, `model/single_winner`, `model/aggregator_inferred` (донор-агрегатор не разбивает `leave_by_report`/`competition`/`on_duty`/`after_duty` → они в inferred «В строю», VAPS — в VACATION/TRAINING/ON_DUTY/AFTER_DUTY; парный дифф VAPS<колонка>+k ↔ донор IN_SERVICE+k), `model/attached_source` (`related_division`-seconded_in + игнор `seconded_from` донором vs VAPS ATTACHED), `model/overstaffed` (Штат<Список — «донор неправ против документа»). **`data/skipped_employee` НЕ explained-фрипасс** (Решение №11): помечается, но трактуется как `unclassified` (блокер AC-5) — иначе потеря донор-строки молча зеленит гейт. Каждое правило — предикат над (колонка, знак расхождения, контекст division/violations)
    - `diff_day(vaps: StrengthReportResult, baseline_for_day: dict[code, BaselineRow], code_by_division_id: dict[uuid, str]) -> DiffResult` — выравнивание по `Division.code` (донор-pk в Division НЕ персистится — Решение №5) по **union(коды baseline ∪ коды code_by_division_id)**; сторона без строки = нули (в т.ч. baseline-only code без VAPS Division — эмитится с VAPS-стороной=0, чтобы схлопнутое/пропущенное подразделение было видно, а не молча проглочено); сравниваются ТОЛЬКО колонки из `DONOR_TO_VAPS` (Список/Вакансии/present_total/presence_pct НЕ диффятся — у донора нет полей); на каждую ненулевую разницу по ячейке применяется первый сработавший `CATEGORY_RULE`, иначе `unclassified`; результат: список `DiffCell{division_code, column, vaps, donor, delta, category}` + счётчики по категориям + флаг `has_unclassified`
    - `render_diff(diff: DiffResult) -> str` — текстовый отчёт: группировка по категориям, в конце явный блок `UNCLASSIFIED` (или «нет»)
  - [x] MUST NOT: тащить ORM; «угадывать» категорию для произвольного расхождения — неизвестное И потеря данных VAPS обязаны остаться `unclassified` (иначе гейт врёт)
- [x] Task 4: management-команда `strength_report` (AC: 1, 2, 5, 6)
  - [x] `apps/migration_legacy/management/commands/strength_report.py` — тонкая оркестровка (образец стиля — `import_donor_slice.py`):
    - args: `--date YYYY-MM-DD` ЛИБО `--from`/`--to` (диапазон, **инклюзивный на обоих концах**: `--from D --to D` = 1 день), `--division <uuid>` (опц., субдерево), `--xlsx PATH` (опц., путь файла), `--diff-baseline PATH` (опц., путь к ОДНОМУ JSON со всеми днями диапазона)
    - валидация аргументов (CLI-граница): `--date` и `--from`/`--to` **взаимоисключающие** — переданы оба ИЛИ ни одного → `CommandError`; `--from` без `--to` (и наоборот) → `CommandError`; невалидная дата (`date.fromisoformat`) → `CommandError`; `--from > --to` → `CommandError`
    - при `--division`: **до** `compute` проверить `Division.objects.filter(id=division_id).exists()`, отсутствует → `raise CommandError(f"division {division_id} not found")` (Решение №7: молчаливый пустой отчёт неотличим от пустого поддерева — `subtree_ids` сеет несуществующий id безусловно)
    - на каждую дату: `StrengthReportResult = StrengthReportService.compute(business_date, division_id)` → `render_table` в stdout; при `--xlsx` — собрать workbook по всем датам и `wb.save(path)` один раз
    - при `--diff-baseline`: `load_baseline` (многодневный конверт); построить `code_by_division_id` одним bulk-запросом `Division.objects.values_list("id","code")`; на каждую дату `diff_day(result, baseline_by_date[d], code_by_division_id)` (отсутствие дня в эталоне для покрытой даты → `CommandError`) + `render_diff`; **если хоть один день дал `has_unclassified` → `raise CommandError` (ненулевой код, AC-5)**
  - [x] MUST NOT: `timezone.now()`/`date.today()` (дата только из аргумента — линт 1.3; диапазон разворачивается явной арифметикой `timedelta`); запись в БД; принимать/читать actor; `try/except` с ручным выводом ошибок домена (CommandError — это CLI-граница, допустима)
- [x] Task 5: эталон-фикса, документация freeze и синтетический кейс ретро-правки (AC: 3, 4)
  - [x] `apps/migration_legacy/tests/fixtures/donor_baseline_sample.json` — эталон в многодневной схеме Task 3 под существующую `donor_slice.json` (числа — ручной/синтетический пересчёт по донор-формуле над тем же срезом). **Обязательно покрыть каждую ожидаемую категорию:** end-inclusive `timing/half_open_end` на граничном дне; `model/aggregator_inferred` через `leave_by_report` И `competition` (донор-срез их содержит — 1.7 DoD упоминает competition); `model/attached_source`; `model/overstaffed`; и заведомый `data/skipped_employee`/`unclassified` для проверки AC-5
  - [x] Документировать (в Dev Agent Record → Completion Notes — НЕ в `deferred-work.md`: это review-derived реестр, а freeze-источник — прямое решение) три пути получения боевого эталона и какой выбран; freeze донорским кодом = разовый прогон `DataAggregator` донора (ОДИН прогон на день, склейка в `days[]`) → JSON этой схемы (донор НЕ трогать — это его собственный код в его окружении; pk→code резолвится в донор-окружении, где доступен `Division.code`; формализация freeze-donor/parallel-run — E7 7.8). Если по итогам ревью 1.8 родится отложенный долг — заносить отдельной секцией «Deferred from: 1.8» **после** ревью, не мид-реализации
  - [x] Синтетический кейс ретро-правки: фикса/тест, показывающий, что правка `date_end` интервала статуса задним числом меняет `resolve_status` (и колонку расхода) на накрытую дату — демонстрация эффекта, БЕЗ создания Amendment/DailySubmission (E5)
- [x] Task 6: unit-тесты рендера и диффа (чистые, gate) (AC: 1, 2, 5)
  - [x] `apps/migration_legacy/tests/test_strength_render.py` — текстовая таблица на собранном вручную `StrengthReportResult` (включая violations/warnings); `build_workbook` создаёт лист на дату с ожидаемой шапкой/числами (читать обратно через `openpyxl.load_workbook` из `io.BytesIO`); **число листов == числу дат** (нет лишнего дефолтного `Sheet`)
  - [x] `apps/migration_legacy/tests/test_donor_diff.py` — таблицы: точное совпадение → пусто; end-inclusive граничный день → `timing/half_open_end`; `leave_by_report`-сотрудник → `model/aggregator_inferred` (VAPS VACATION+1 ↔ донор IN_SERVICE+1); `competition`-сотрудник → `model/aggregator_inferred` (VAPS TRAINING+1 ↔ донор IN_SERVICE+1); дежурный (`on_duty`/`after_duty`) → `model/aggregator_inferred`; Штат<Список → `model/overstaffed`; потеря строки → `data/skipped_employee`, помечен, НО `has_unclassified=True`; произвольное необъяснимое → `unclassified`+`has_unclassified`; выравнивание по code (отсутствующая сторона = нули; baseline-only code → эмитится с VAPS=0); дубль `division_code` в дне → `ValueError`; Список/Вакансии/present_total НЕ диффятся
  - [x] Самопроверка нетривиальности (процесс-правило ревью 1.1–1.7): временно «классифицировать» unclassified в любую категорию → тест на `unclassified` обязан покраснеть → вернуть
- [x] Task 7: интеграционный тест команды + gate (AC: 1, 5, 6)
  - [x] `apps/migration_legacy/tests/test_strength_report_command.py` (Postgres, gate): импорт `donor_slice.json` → `call_command("strength_report", "--from", D1, "--to", D3)` печатает таблицы; `--xlsx tmp` создаёт файл с **ровно 3 листами** (имена = ISO-даты D1/D2/D3 — диапазон инклюзивен); `--diff-baseline donor_baseline_sample.json` печатает категоризированный дифф; кейс с подсаженным `unclassified`/`data/skipped_employee`-расхождением → `pytest.raises(CommandError)` (AC-5); `--date` с несуществующим `--division` → `pytest.raises(CommandError)` (валидация до `compute`, Решение №7); взаимоисключение `--date`+`--from` → `CommandError`
  - [x] `make gate` зелёный (< 5 мин); `make test-full` зелёный; сьюты core/operations/statuses/migration_legacy зелёные

## Dev Notes

### Цель (одним предложением)

Сделать расход 1.7 видимым (таблица + простой `.xlsx`) и доказуемым: дифф против донорских цифр, где каждое расхождение объяснено категорией-гипотезой канона parallel-run, а необъяснённое (`unclassified`) механически роняет гейт — это и есть проверка модели времени данными, ради которой строился весь E1 (главный остаточный риск Winston: «модель времени проверена рассуждением, но не данными»).

### Текущее состояние кода (прочитано 2026-06-15)

- **Контракт-источник — `apps/operations/statuses/services/strength_report.py` (1.7):**
  - `StrengthReportService.compute(business_date: date, division_id: UUID|None=None) -> StrengthReportResult` — ровно 4 bulk-запроса, без Clock/actor/записи. Это ЕДИНСТВЕННЫЙ вход 1.8 к расходу (не переписывать агрегацию).
  - `StrengthReportResult(business_date, rows: list[DivisionReportRow], totals: ReportTotals, violations: list, warnings: list)`.
  - `DivisionReportRow(division_id, name, staff_total, list_total, vacancies, columns: dict, attached: int)`; `columns` — ключи из `REPORT_COLUMNS`.
  - `REPORT_COLUMNS = (SICK, VACATION, COMMAND, TRAINING, OTHER, DETACHED, AFTER_DUTY, BEFORE_DUTY, ON_DUTY, IN_SERVICE)`; `ATTACHED` — отдельной колонкой (attached), вне Списка и вне Σ-баланса.
  - `violations`: `{division_id, reason:"staff_lt_list", staff_total, list_total}` (Штат < Список — мусор/переукомплектованность донора). `warnings`: `{division_id, reason:"no_staffing_record"}`.
  - `derive_report` сейчас сеет строку только для подразделений с сотрудниками ИЛИ слотом (1.7 review D2 → контракт пустых подразделений отдан 1.8, Решение №7).
- **Донор-агрегатор — `Backend/PersonnelStatus/.../apps/reports/infrastructure/data_aggregator.py` (ТОЛЬКО ЧИТАТЬ):** `DataAggregator.collect_data(report)` → `{division, date, rows:[{division_id(донор-pk), division_name, staff_unit, in_service, vacation, sick_leave, business_trip, training, seconded_in, seconded_out, other_absence, present_total, presence_pct}]}` за ОДИН `ref_date`. **Критично:** агрегатор разбивает в свои колонки ТОЛЬКО типы `in_service/vacation/sick_leave/business_trip/training/other_absence/seconded_to`; `known`-сумма (data_aggregator.py:92-100) НЕ включает `leave_by_report`, `competition`, `on_duty`, `after_duty`, `seconded_from` → они уходят в `inferred_in_service = max(0, total-known)` (строки 103-104). Закрытый интервал `start<=ref AND (end IS NULL OR end>=ref)` (строка 53). Это источник почти всех категорий диффа (ниже).
- **VAPS импорт-маппинг — `apps/migration_legacy/transform.py` `DONOR_STATUS_TYPE_MAP`:** `vacation→VACATION`, `leave_by_report→LEAVE_BY_REPORT`, `sick_leave→SICK_LEAVE`, `business_trip→COMMAND`, `training→STUDY`, `competition→COMPETITION`, `other_absence→OTHER_ABSENCE`, `on_duty→DUTY`, `after_duty→REST_AFTER_DUTY`, `seconded_from→ATTACHED`, `seconded_to→DETACHED`; `in_service` НЕ импортируется (`Skip("in_service_derived")` — derived-first). ⇒ VAPS колонки VACATION/TRAINING шире донорских одноимённых на `leave_by_report`/`competition`; ON_DUTY/AFTER_DUTY/ATTACHED у VAPS есть, у донор-агрегатора растворены в in_service.
- **Импорт 1.6/1.7 — `apps/migration_legacy/management/commands/import_donor_slice.py`:**
  - identity mapping сотрудников = `Employee.external_id = str(donor_pk)`; **Division донор-pk НЕ хранит** — ключ `(organization, code)`, `unique_org_division_code`. ⇒ дифф выравнивается по `Division.code` (Решение №5).
  - `Division.code` — `CharField(max_length=100)` (`apps/core/models.py`), уникален в рамках организации.
  - Штат материализован в `DivisionHistoricalSlot` из `count(staff_units)` (тот же источник, что у донора — Решение №5 1.7, паритет Штата гарантирован).
  - схлопывание донор-кодов под `(organization, code)` в один Division (review C2/KO-2 1.7) — почему freeze обязан резолвить pk→code, а `load_baseline` падает на дубле кода.
- **`migration_legacy` — санкционированный мост:** право прямых импортов из core/statuses закреплено в 1.6; `local_midnight` живёт в `apps/core/selectors.py`. 1.8 импортирует `StrengthReportService` из statuses через тот же мост — это НЕ нарушение границ (migration_legacy — не субдомен operations; «edet v image; удаляется после cutover»).
- **Команд вывода/диффа НЕТ** — создаются этой сторёй. В `migration_legacy` одна команда (`import_donor_slice`); модулей `strength_render.py`/`donor_diff.py` нет.
- **`openpyxl` НЕ установлен**; зависимостей в `pyproject` три рантайм (Django/DRF/psycopg) + dev (pytest/ruff/hypothesis). Маркеры `property`/`concurrency`/`slow` объявлены; gate = `-m "not property and not concurrency and not slow"`.

### Донор vs VAPS — таблица расхождений (каталог категорий-гипотез диффа)

| Аспект | Донор (`DataAggregator`) | VAPS (`derive_report`) | Категория диффа |
|---|---|---|---|
| Граница интервала | `start<=D AND (end IS NULL OR end>=D)` — **закрытый `[ ]`** | полуоткрытый `[start, end)` — статус с `end==D` НЕ действует (AC-2 1.7) | `timing/half_open_end` |
| Несколько статусов на человека | **двойной счёт** (попадает в обе колонки), `inferred=max(0,total-known)` гасит | ровно один победитель по приоритету (BR-001) | `model/single_winner` |
| Отпуск по рапорту | `leave_by_report` НЕ агрегируется (нет в `known`) → падает в inferred «В строю» | импортируется (`LEAVE_BY_REPORT`) и кладётся в колонку **VACATION** | `model/aggregator_inferred`: VAPS VACATION +k ↔ донор IN_SERVICE +k |
| Соревнования | `competition` НЕ агрегируется (нет в `known`) → inferred «В строю» | импортируется (`COMPETITION`) → колонка **TRAINING** | `model/aggregator_inferred`: VAPS TRAINING +k ↔ донор IN_SERVICE +k |
| Дежурные типы | `on_duty`/`after_duty` есть в модели донора, но **агрегатор их не разбивает** → inferred «В строю» (`before_duty` в доноре отсутствует вовсе) | импортируются (`DUTY`→ON_DUTY, `REST_AFTER_DUTY`→AFTER_DUTY) | `model/aggregator_inferred`: VAPS ON_DUTY/AFTER_DUTY +k ↔ донор IN_SERVICE +k |
| Прикомандированные | `seconded_in` по `related_division` (1.6 related_division НЕ импортирует); донорский `seconded_from` агрегатор НЕ читает вовсе — такой сотрудник проваливается в inferred «В строю» (используется только `SECONDED_TO`) | ATTACHED из `seconded_from`→ATTACHED как «+N» | `model/attached_source` |
| Учёба (study) | `training` агрегируется в свою колонку | донор `training`→`STUDY`→колонка **TRAINING** | 1:1 (тот же источник), дифф только timing/single_winner |
| Больн./Командир./Прочие/Откоманд. | `sick_leave`/`business_trip`/`other_absence`/`seconded_out` агрегируются | `SICK`/`COMMAND`/`OTHER`/`DETACHED` 1:1 | дифф только timing/single_winner |
| Штат | `count(StaffUnit)` по подразделению | `count(staff_units)` → `DivisionHistoricalSlot` (тот же источник) | обычно 0 (паритет, Решение №5) |
| Штат<Список | `total_working`; присутствие = in_service+seconded_in | WORKING−ATTACHED; Штат<Список → `violations` | `model/overstaffed` (донор-мусор, «донор неправ») — фиксируется как VAPS-violation, НЕ как дифф-ячейка |
| Пропущенные при импорте | считаются (полные донор-данные) | 1.6 мог скипнуть строку (no_division/невалид) → фантомные вакансии (DEP1=5/1/4, намеренный паритет Штата) | `data/skipped_employee` — **НЕ фрипасс**: помечается, но → `unclassified` (Решение №11) |
| `list_total`/`vacancies`/`present_total`/`presence_pct` | донор эмитит только `present_total`/`presence_pct`; `list_total`/`vacancies` НЕ эмитит вовсе | VAPS считает Список/Вакансии; present_total/presence_pct не считает | **вне ячеечного диффа** (нет общего поля) |

**Маппинг колонок донор→VAPS (что реально сравнивается):** `staff_unit→staff_total`; `sick_leave→SICK`, `business_trip→COMMAND`, `other_absence→OTHER`, `seconded_out→DETACHED`, `training→TRAINING` — донор-агрегатор разбивает эти типы, VAPS 1:1 (дифф только timing/single_winner). `vacation→VACATION` и (`training` уже учтён, а вот) колонка VAPS TRAINING/VACATION систематически больше донорских из-за folding `leave_by_report`/`competition` → `model/aggregator_inferred`. `in_service→IN_SERVICE` — у донора catch-all (inferred + все неразбитые типы), систематически больше VAPS. `seconded_in→attached` — разные источники (`model/attached_source`). **НЕ сравниваются:** `list_total`/`vacancies` (донор не эмитит), `present_total`/`presence_pct` (донор-производные, VAPS не считает).

### Решения, принятые при создании стори (дефолты; менять только осознанно)

1. **Дом = `migration_legacy`, НЕ новый app `reports`.** 1.7 Решение №2 явно отложило рождение `reports` до E6 («со снапшотами»); дифф с донором — концептуально parallel-run/миграция, а не отчётный домен; `migration_legacy` уже владеет донор-фасадными командами, «edet v image», имеет санкционированный мост чтения. Создавать app сейчас = boilerplate + AST-изоляция-тест + конфликт с принятым решением. Лимиты соблюдены: одна app + чтение `statuses.services`.
2. **Вывод = management-команда, НЕ endpoint.** API/SPA нет до E8; боевой endpoint расхода (POST→AsyncJob→Celery→X-Accel, `operations/reports`+`documents`) — E6 6.5/6.6. AC «команду/endpoint» для E1 = команда.
3. **`.xlsx` через `openpyxl` (новая РАНТАЙМ-зависимость).** Буква AC требует `.xlsx`; openpyxl — чистый Python, офлайн (контур). Конец «нулевых рантайм-деп» 1.7 — осознанно. Скоуп «простой»: один лист на дату, шапка, строки, тоталы; без стилей/формул/golden-master/байт-в-байт (это E6 6.3/6.8, app `documents`). НЕ создавать `documents`-app и НЕ ходить в Celery.
4. **Эталон = JSON фиксированной (многодневной) схемы, команда диффа агностична к источнику.** Три пути (AC-3): сохранённые расходы донора · freeze пересчётом донорским `DataAggregator` · память владельца/синтетика (A4). Донор затух в проде (память проекта) → боевой путь, скорее всего, freeze ИЛИ A4. Для gate коммитится синтетический `donor_baseline_sample.json`.
5. **Выравнивание диффа по `Division.code`.** Донор-pk в Division не персистится; `(organization, code)` уникален; донор-`code` импортируется как `Division.code`. Эталон ключуется по `division_code`; freeze резолвит донор-pk→code в донор-окружении. Выравнивание по union кодов, отсутствующая сторона = нули.
6. **Классификатор = ФИКСИРОВАННЫЙ каталог правил, неизвестное → `unclassified`.** Детерминированные предикаты над (колонка, знак, контекст). НИКАКОГО «угадывания»: необъяснённое расхождение обязано остаться `unclassified` и уронить гейт (AC-5). **Полный авто-классификатор (timing-реплей логики донора на момент снапшота, реестр model-diffs с подписью заказчика, 10 дней нуля unclassified, ночной донор-compose) — E7 7.8** (architecture.md, Parallel-run exit criterion, 3 слоя). 1.8 — walking-skeleton разовый дифф, не пайплайн.
7. **Контракт пустых подразделений (defer-долг 1.7 D2): дифф выравнивает по code, отсутствующая сторона = нули; `derive_report` НЕ трогаем** (не сеем нулевые строки в чистое ядро 1.7 — хирургичность, инварианты сходимости не затронуты). Опущение пустых подразделений в самом расходе узаконено для E1. **Несуществующий `division_id` в `compute` (defer-долг 1.7): команда ДО вызова `compute` проверяет `Division.objects.filter(id=division_id).exists()`, отсутствует → `CommandError`.** Путь «пустой отчёт с предупреждением» ОТКЛОНЁН: он неотличим от пустого поддерева (`subtree_ids` сеет несуществующий id безусловно) и делает тест Task 7 недетерминированным.
8. **Ретро-правка (AC-4) = синтетическая демонстрация, БЕЗ Amendment-машинерии.** Amendment-flow и DailySubmission-снапшоты — E5; в E1 нет «сданного дня», который правка могла бы протухить. Демонстрируется только эффект: правка `date_end` интервала меняет `resolve_status`/колонку на накрытую дату; у донора плоская модель — следов нет. Это тест/фикса + заметка, не код движка поправок.
9. **DoD-гейт механизирован кодом возврата.** `has_unclassified=True` на любом дне → `CommandError` (ненулевой exit) + блок `UNCLASSIFIED` в выводе. «Расхождение без объяснения = эпик не закрыт» перестаёт быть устным обещанием.
10. **read-only до конца.** Команда не пишет в БД, не читает Clock, не принимает actor; даты — только из аргументов; рендер и дифф — чистые (тестируются без БД). Единственный ORM-доступ — `compute` (через мост) + `Division.values_list("id","code")`/`.exists()` для выравнивания и валидации.
11. **Каталог категорий выровнен на канон architecture.md:311 (timing / model / unclassified) — `data/*` это вспомогательный слой, НЕ третий explained-бакет (осознанное отклонение walking-skeleton).** ЖЁСТКО: `data/skipped_employee` (VAPS потерял донор-строку → донор прав) **НЕ считается explained и НЕ зеленит гейт молча** — помечается этой меткой для читаемости, но входит в `has_unclassified` (блокер по AC-5), пока не получит `model`-статус с заметкой о паритете/подписи (E7 7.8). Только `model/overstaffed` (донор-мусор, «донор неправ против документа») трактуется как explained `model`. `timing/*` — реплеируемо-объяснимо. Всё прочее → `unclassified`.

### Что НЕ трогать (Out of Scope)

- **Агрегация расхода** (`derive_report`/`compute`/селекторы 1.7) — переиспользуется как есть, НЕ переписывается; не сеять пустые подразделения в ядро (Решение №7).
- **App `reports` и `documents`, Celery, AsyncJob, X-Accel, DocumentSequence, байт-в-байт хранение файла, golden-master `.docx`/`.xml`** — E6.
- **Endpoint расхода, RBAC/actor-сужение, exception_handler/DomainError** — E6/3.1; здесь CLI + `CommandError`.
- **Amendment/DailySubmission/снапшоты/трёхцветный светофор** — E5.
- **Полный parallel-run пайплайн** (`migration/parallel_run/`, frozen-suite, ночной донор-compose, авто-классификатор, реестр model-diffs с подписью, 10-дневный exit criterion) — E7 7.8; здесь — ручной разовый дифф против переданного эталона.
- **Политика обновления статусов/слотов при повторном импорте, нормализация tz, валидация gender/rank** — deferred-долги 1.6/1.7, E7; не чинить мимоходом. Правка `deferred-work.md` мид-реализации запрещена (его секции — review-derived).
- **Донор** (`Backend/PersonnelStatus/`) — только чтение; freeze-прогон `DataAggregator` — в донор-окружении, без правок донора.

### Подводные камни для dev-агента

- **Полуоткрытость — главный ожидаемый timing-дифф.** Расхождение на граничном дне (`end==D`: донор +1 в колонке типа, VAPS этот человек в `IN_SERVICE`) — это НЕ баг, это `timing/half_open_end`, подтверждение AC-2 1.7. Классификатор обязан его ловить, а не падать.
- **`leave_by_report`/`competition`/`on_duty`/`after_duty` — НЕ «нет диффа».** Это была ловушка первой версии каталога: донор-агрегатор НЕ разбивает эти типы (нет в `known`) → они в его inferred «В строю», а VAPS импортирует их в VACATION/TRAINING/ON_DUTY/AFTER_DUTY. ⇒ систематический парный дифф VAPS<колонка>+k ↔ донор IN_SERVICE+k = `model/aggregator_inferred`. Срез `donor_slice.json` содержит competition → правило обязано покрывать его, иначе ложный `unclassified` и ложно красный гейт.
- **«Донор не знает дежурных» — неверная формулировка.** Донор-МОДЕЛЬ знает `on_duty`/`after_duty`/`seconded_from`; их растворяет донор-АГРЕГАТОР (не разбивает в колонки). Дев, заглянув в донор-модель, найдёт эти типы — важно понимать, что дифф рождается на стороне `collect_data`, а не из «отсутствия типа». Реально отсутствует у донора только `before_duty` (и `gev`/`event_assignment` — у VAPS тоже 0 в срезе, диффа нет).
- **Список/Вакансии/present_total/presence_pct НЕ диффятся поячеечно.** У донора нет полей `list_total`/`vacancies`; `present_total`/`presence_pct` — донор-производные, у VAPS аналога нет. Сравниваются только колонки `DONOR_TO_VAPS` (включая Штат=staff_unit). Иначе — ложный шквал `unclassified` на каждом подразделении.
- **`data/skipped_employee` не зеленит гейт.** Потеря донор-строки при импорте — это «донор прав, VAPS потерял», по канону architecture.md → `unclassified`/блокер, а не explained. Метка `data/*` только для читаемости отчёта; флаг `has_unclassified` обязан учитывать её (Решение №11).
- **`unclassified` священен.** Любое искушение «дотянуть» необъяснённое расхождение до категории убивает смысл гейта. Правило срабатывает только на ЗАРАНЕЕ ОПИСАННЫЙ структурный паттерн; всё прочее → `unclassified` → ненулевой exit (AC-5). Самопроверка нетривиальности Task 6 это охраняет.
- **Дифф ключуется по `code`, не по name и не по uuid.** Имена не уникальны (донор-дубли кодов схлопываются в один Division — review C2/KO-2 1.7); uuid в эталоне донора нет. Резолв `code_by_division_id` — один bulk `values_list`, НЕ per-row. Дубль `division_code` в эталоне дня → `ValueError` (схлопывание обязано резолвиться на freeze).
- **`openpyxl` импортировать в функции**, не на уровне модуля `strength_render.py` — чтобы unit-тесты текстовой таблицы и сам модуль импортировались без установленного openpyxl. `Workbook()` создаёт дефолтный лист `Sheet` — удалить его, иначе в файле останется пустой лист (тест проверяет число листов == числу дат).
- **Многодневный эталон — один файл-конверт `days[]`.** Донорский `DataAggregator.collect_data` отдаёт один день за прогон; freeze склеивает 5–7 прогонов. `--diff-baseline` — путь к одному JSON; `load_baseline → dict[date, dict[code, BaselineRow]]`. Отсутствие покрытой даты в эталоне → `CommandError`.
- **Дисциплина линта 1.3:** `timezone.now()`/`date.today()` в команде/модулях — ошибка ruff-конфига. Дата приходит аргументом; диапазон [from..to] инклюзивен на обоих концах, разворачивается явной арифметикой `timedelta` (off-by-one ловит тест на ровно-N-листов).
- **ruff `E,F` py312 сразу:** длинные маппинги (категории, маппинг колонок, RU-лейблы) разбивать заранее — урок ревью 1.1–1.7 (E501 ловили дважды).
- **`make gate` — единственная команда прогона** (Postgres-сьюта). Точечно: `docker compose up -d --wait db && VAPS_DB=postgres VAPS_DB_NAME=vaps VAPS_DB_USER=vaps VAPS_DB_PASSWORD=vaps VAPS_DB_HOST=localhost VAPS_DB_PORT=5433 .venv/bin/pytest apps/migration_legacy`.
- **Незакоммиченный блок 1.1–1.7 в рабочем дереве** — НЕ откатывать, НЕ включать в свой File List (процесс-правило ревью 1.4: блок коммитится вместе). 1.7-код (`strength_report.py` и пр.) ещё не в git — образцы брать из рабочего дерева.
- **Completion Notes без вранья:** каждое «прогнано/passed» — с командой и результатом в Debug Log (ревью 1.4/1.5 ловили необоснованные ноты).

### Технические версии

- Django 5.1.x, psycopg3, PostgreSQL 16 (compose, 5433) — без изменений.
- **Новая рантайм-зависимость: `openpyxl>=3,<4`** (актуальный мажор 3.1.x; чистый Python, без C-расширений, офлайн — подходит для контура). Других зависимостей не добавляется.

### Git-интеллидженс

- HEAD = `b12603a`; блок сторей 1.1–1.7 НЕ закоммичен — `strength_report.py`, селекторы, `transform.py`, импорт-команда живут в рабочем дереве. Образцы стиля команды/отчёта брать из `apps/migration_legacy/management/commands/import_donor_slice.py` (arg-parsing, `self.stdout.write`, `CommandError`, dataclass-репорты).
- Уроки ревью 1.1–1.7 (обязательные): полный File List; ruff-формат сразу; самопроверка нетривиальности новых тестов (сломать → красный → вернуть); deferred-баги не чинить мимоходом; Completion Notes подкреплять Debug Log'ом.

### Зависимости

- **Depends on:** 1.7 (`StrengthReportService.compute`/`StrengthReportResult` — прямой контракт; отчёт о слотах), 1.6 (импортированный срез + `Division.code` + `DONOR_STATUS_TYPE_MAP` + identity mapping), 1.1 (gate/Postgres-harness). Косвенно 1.3 (линт времени).
- **Blocks / закрывает:** **DoD-гейт E1** (расход за 5–7 дней против донора, каждое расхождение объяснено или эпик не закрыт). Зерно для E6 (генераторы/документ), E7 7.8 (формализация parallel-run — каталог категорий 1.8 = прото-классификатор), 1.12 (категории-гипотезы и OTHER_ABSENCE-долг попадут в инвентаризацию).
- **Связана:** 2.4 (списочный состав на дату уточнит `data/skipped_employee`), 7.5 (post-migration сходимость переиспользует дифф-логику).

### Тесты стори

- **Unit (без БД, gate):** `render_table` (строки/тоталы/violations/warnings), `build_workbook` (лист на дату, шапка, числа — читать через `load_workbook(BytesIO)`; число листов == числу дат); `donor_diff` — точное совпадение→пусто, end-inclusive→`timing/half_open_end`, `leave_by_report`/`competition`/`on_duty`→`model/aggregator_inferred`, Штат<Список→`model/overstaffed`, потеря строки→`data/skipped_employee`+`has_unclassified`, необъяснённое→`unclassified`, выравнивание по code (нули/baseline-only), дубль code→`ValueError`, Список/Вакансии/present_total не диффятся.
- **Integration (Postgres, gate):** импорт `donor_slice.json` → `strength_report --from/--to` печатает таблицы; `--xlsx` создаёт файл с ровно N (инклюзивно) листами; `--diff-baseline sample` печатает категоризированный дифф; подсаженное `unclassified`/`data/skipped_employee` → `CommandError`; несуществующий `--division` → `CommandError`; `--date`+`--from` → `CommandError`.
- **Регрессия:** сьюты core/operations/statuses/migration_legacy зелёные; `make gate` зелёный (< 5 мин); `make test-full` зелёный.
- **Manual (DoD):** импорт фикстуры → `strength_report --from D1 --to Dk --xlsx /tmp/rashod.xlsx --diff-baseline donor_baseline_sample.json` → таблицы и дифф глазами: расхождения объяснимы по каталогу, `UNCLASSIFIED` пуст на синтетике; открыть `.xlsx`.

### Definition of Done

- [x] `openpyxl` в рантайм-зависимостях; `pip install -e '.[dev]'` проходит
- [x] `strength_render.py`: `render_table` + `build_workbook` (простой `.xlsx`, лист на дату, без дефолтного `Sheet`), чистый, openpyxl в функции
- [x] `donor_diff.py`: маппинг колонок (только реально сравнимые), многодневный `load_baseline` (дубль code→ValueError), фиксированный каталог категорий канона timing/model/unclassified (`model/aggregator_inferred` покрывает leave_by_report/competition/duty), `diff_day` (union по code), `render_diff` с блоком `UNCLASSIFIED`; `data/skipped_employee` → has_unclassified
- [x] команда `strength_report`: `--date`/`--from`/`--to` (инклюзив, взаимоисключение)/`--division` (exists()→CommandError)/`--xlsx`/`--diff-baseline`; read-only; `CommandError` при `unclassified` (AC-5) и невалидных аргументах
- [x] эталон-фикса покрывает timing + aggregator_inferred (leave_by_report И competition) + overstaffed + unclassified; документированный выбор источника боевого эталона (в Completion Notes); синтетический кейс ретро-правки (без Amendment)
- [x] AC-1 (таблица+xlsx на 5–7 днях), AC-2/AC-5 (категории канона + unclassified→ненулевой код), AC-6 (read-only) покрыты тестами
- [x] донор не тронут; `derive_report` 1.7 не тронут; `deferred-work.md` не правлен мид-реализации; новых рантайм-зависимостей кроме openpyxl нет; `make gate` зелёный (< 5 мин)

### Project Structure Notes

- Новые файлы логики: `apps/migration_legacy/strength_render.py`, `apps/migration_legacy/donor_diff.py`, `apps/migration_legacy/management/commands/strength_report.py` — **3 ≤ 5**. Вне лимита: тесты, фикстуры (`donor_baseline_sample.json`), конфиг сборки (`pyproject.toml`).
- App-границы: одна app (`migration_legacy`) + чтение `apps.operations.statuses.services.StrengthReportService` через санкционированный мост 1.6 (migration_legacy — не субдомен operations; моделей/миграций/FK стори не добавляет). По architecture.md `reports`/`documents`-домены — E6; здесь намеренно не создаются (Решение №1/№2).
- `project-context.md` в репо отсутствует (проверено glob'ом при активации) — раздел не применим.

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Story 1.8] — формулировка, AC, DoD-гейт эпика; A3/A4-страховки эталона
- [Source: _bmad-output/planning-artifacts/epics.md#Epic 1] — DoD-гейт «расход 5–7 дней против донора, каждое расхождение объяснено»
- [Source: _bmad-output/planning-artifacts/epics.md#Правила декомпозиции стори] — лимит файлов/app
- [Source: _bmad-output/planning-artifacts/architecture.md#Data Architecture] — ARCH-DATA-023 (`[)` календарные сутки), ARCH-DATA-025 (сходимость глобально); **Parallel-run exit criterion 3 слоя (timing/model/unclassified) — канон категорий 1.8, формализация классификатора = E7**
- [Source: _bmad-output/planning-artifacts/architecture.md#Project Structure] — `operations/reports` (классификатор diff-категорий) и `documents` (xlsx-генераторы) — целевой дом, отложен до E6; `migration_legacy` едет в image
- [Source: _bmad-output/planning-artifacts/architecture.md#Test Organization & Make Targets] — make gate/test-full бюджеты; golden-master = E6
- [Source: _bmad-output/planning-artifacts/architecture.md#Implementation Handoff] — главный остаточный риск Winston (модель времени проверить данными — цель 1.8); запрет кэширующих stored-полей
- [Source: Backend/VAPS/apps/operations/statuses/services/strength_report.py] — контракт `StrengthReportService.compute`/`StrengthReportResult`/`REPORT_COLUMNS` (прямой вход 1.8)
- [Source: Backend/PersonnelStatus/Personnel-Records/organization_management/apps/reports/infrastructure/data_aggregator.py] — донор-агрегатор: закрытый интервал `end>=ref`, двойной счёт, `known` НЕ включает leave_by_report/competition/on_duty/after_duty/seconded_from → inferred «В строю»; `seconded_in` по related_division; Штат=count(StaffUnit) (источник каталога категорий)
- [Source: Backend/VAPS/apps/migration_legacy/transform.py] — `DONOR_STATUS_TYPE_MAP` (донор-код → VAPS-код; что VAPS импортирует, а донор-агрегатор не разбивает); `in_service`→Skip (derived-first)
- [Source: Backend/VAPS/apps/migration_legacy/management/commands/import_donor_slice.py] — стиль команды; Division по `(organization, code)`, donor-pk не персистится (выравнивание диффа по code); схлопывание кодов C2/KO-2; блок staffing slots
- [Source: Backend/VAPS/apps/core/models.py] — `Division.code` (max_length=100), `unique_org_division_code`; `DivisionHistoricalSlot` (Штат)
- [Source: _bmad-output/implementation-artifacts/1-7-derived-статус-и-расчёт-расхода.md] — handoff 1.7: «вывод/дифф/эталоны — 1.8», defer-долги D2 (пустые подразделения, несуществующий division_id), фантомные вакансии (намеренный паритет)
- [Source: _bmad-output/implementation-artifacts/deferred-work.md] — окно свободного текста status_type_code до 2.2; статусы не обновляются при повторном импорте (категории-гипотезы планируемых диффов); не чинить deferred мимоходом

## Dev Agent Record

### Agent Model Used

claude-opus-4-8[1m] (bmad-dev-story workflow), 2026-06-15.

### Debug Log References

Все прогоны — gate-окружение Postgres (`VAPS_DB=postgres … VAPS_DB_PORT=5433`, docker compose db healthy):

- Task 1: `pip install -e '.[dev]'` → `Successfully installed et-xmlfile-2.0.0 openpyxl-3.1.5 vaps-0.1.0`; `python -c "import openpyxl"` → `3.1.5`.
- Task 2 (render): red (ModuleNotFoundError strength_render) → green `8 passed` (`test_strength_render.py`).
- Task 3 (diff): red (ModuleNotFoundError donor_diff) → green `18 passed` (`test_donor_diff.py`).
- Task 6 самопроверка нетривиальности: temp-патч type-column fallback `unclassified`→`model/single_winner` → `test_arbitrary_unexplained_surplus_is_unclassified` FAILED (`Extra items in the right set: 'unclassified'`) → revert → зелёный. Подтверждает, что `unclassified`-тест ловит подмену категории.
- Эмпирическая сверка VAPS-чисел (probe, удалён): импорт `donor_slice.json` → `compute` на 06-04/05/06 совпал с ручным выводом (DEP1 5/1/4 VACATION на 04–05, IN_SERVICE на 06; DIR1 1/1/0 TRAINING/DETACHED/TRAINING). На этих числах построен `donor_baseline_sample.json`.
- Task 7 (integration): первый прогон 13/14 (падал `test_range_prints_tables_per_division` — таблица печатает имена подразделений `row.name`, а коды живут в диффе; правка ассерта) → `12 passed`.
- Manual DoD (визуальный прогон, удалён): таблица + категоризированный дифф читаются; 06-04 aggregator_inferred+attached_source+single_winner (UNCLASSIFIED: нет); 06-05 data/skipped_employee (UNCLASSIFIED заполнен); 06-06 aggregator_inferred+timing/half_open_end; `xlsx written`; затем `[CommandError exit] DoD gate: unclassified discrepancies present` (ненулевой код, AC-5).
- Lint: две E501 (`_LAYOUT`, тест build_workbook) исправлены → `ruff check .` → `All checks passed!`.
- `make gate` → `328 passed, 7 deselected`, `gate duration: 5s`, `makemigrations --check` → `No changes detected`.
- `make test-full` → `335 passed`, `test-full duration: 10s`.

### Completion Notes List

Реализованы все 7 задач; 6 файлов логики/тестов + 1 фикстура созданы, `pyproject.toml` изменён (только `openpyxl`).

- **AC-1 (таблица + .xlsx):** `strength_render.render_table` (текст, имена подразделений, attached как «+N», violations/warnings) и `build_workbook` (лист на дату по ISO-имени, дефолтный `Sheet` удалён, openpyxl импортируется в функции). Команда печатает таблицы за каждый день диапазона и сохраняет один `.xlsx` со всеми датами.
- **AC-2 + AC-5 (категории + механический гейт):** `donor_diff` — фиксированный каталог канона timing/model/unclassified (предикаты над колонкой/знаком/контекстом IN_SERVICE-пары и vaps-violations). `model/aggregator_inferred` покрывает leave_by_report (VACATION), competition (TRAINING) и дежурные ON_DUTY/AFTER_DUTY/BEFORE_DUTY (VAPS-only fold-колонки питают `fold_surplus`). `data/skipped_employee` помечается, но входит в `has_unclassified` (Решение №11) → команда печатает блок `UNCLASSIFIED` и роняет код через `CommandError`.
- **AC-3 (агностичность к источнику):** `load_baseline` ест многодневный конверт `days[]` (внешний ключ — дата, внутренний — `division_code`), дубль кода в дне → `ValueError` (зеркало C2/KO-2). Команда не знает, откуда взялись числа.
- **AC-4 (ретро-правка):** `test_retro_amendment.py` — чистая демонстрация на `resolve_status`: сдвиг `date_end` интервала меняет derived-статус и колонку расхода на накрытую дату, БЕЗ Amendment/DailySubmission (E5).
- **AC-6 (read-only):** команда не пишет в БД, не читает Clock (даты — только из аргументов, диапазон разворачивается `timedelta`), не принимает actor; единственный ORM-доступ — `compute` через мост 1.6 + `Division.values_list/.exists()`. `render_*`/`diff_*` — чистые, тестируются без БД.

**Выбор источника боевого эталона (документировано здесь по требованию Task 5, НЕ в `deferred-work.md`):** три пути (AC-3) — сохранённые расходы донора · freeze пересчётом донорским `DataAggregator` · память владельца/синтетика (A4). Донор затух в проде (память проекта) → боевой путь, скорее всего, **freeze ИЛИ A4**. Freeze = разовый прогон `DataAggregator` в донор-окружении (ОДИН прогон на день, склейка в `days[]`, pk→code резолвится там, где доступен `Division.code`); донор НЕ трогается. Для gate закоммичен синтетический `donor_baseline_sample.json` (A4). Формализация freeze-donor/parallel-run (ночной compose, реестр model-diffs с подписью, 10-дневный exit) — E7 7.8.

**Сознательное сужение покрытия категорий в интеграционной фикстуре (НЕ долг — структурное ограничение реального среза):** `donor_baseline_sample.json` исчерпывает timing/half_open_end, model/aggregator_inferred (через VACATION И TRAINING), model/attached_source, model/single_winner, data/skipped_employee. `model/overstaffed` требует VAPS-violation `staff_lt_list`, которой реальный срез не даёт (DEP1 5≥1, DIR1 1≥1), поэтому он исчерпывающе покрыт в unit-сьюте `test_donor_diff.py::TestOverstaffed`. Каждое правило каталога имеет unit-тест; интеграция доказывает сквозную проводку + гейт. Это отражено в `_comment` фикстуры.

**Прото-классификатор, не финал:** правила — структурные предикаты на ЗАРАНЕЕ ОПИСАННЫЙ паттерн; timing/half_open_end детектируется по знаку (донор +k в типе ↔ VAPS +k в IN_SERVICE), без реплея донорской интервальной логики по датам (это E7). `unclassified` священен — самопроверка нетривиальности (Task 6) это охраняет.

Доноры не тронуты; `derive_report` 1.7 не тронут; `deferred-work.md` не правлен; новых рантайм-зависимостей кроме `openpyxl` нет. Незакоммиченный блок 1.1–1.7 в рабочем дереве НЕ включён в File List ниже.

### File List

**Создано:**
- `Backend/VAPS/apps/migration_legacy/strength_render.py`
- `Backend/VAPS/apps/migration_legacy/donor_diff.py`
- `Backend/VAPS/apps/migration_legacy/management/commands/strength_report.py`
- `Backend/VAPS/apps/migration_legacy/tests/test_strength_render.py`
- `Backend/VAPS/apps/migration_legacy/tests/test_donor_diff.py`
- `Backend/VAPS/apps/migration_legacy/tests/test_strength_report_command.py`
- `Backend/VAPS/apps/migration_legacy/tests/test_retro_amendment.py`
- `Backend/VAPS/apps/migration_legacy/tests/fixtures/donor_baseline_sample.json`

**Изменено:**
- `Backend/VAPS/pyproject.toml` (добавлена рантайм-зависимость `openpyxl>=3,<4`)

## Change Log

- 2026-06-15: Story 1.8 реализована (bmad-dev-story). 3 модуля логики (`strength_render`, `donor_diff`, `strength_report`-команда) + 4 теста + синтетическая эталон-фикстура; `openpyxl>=3,<4` в рантайм. Каталог категорий канона timing/model/unclassified, механический DoD-гейт (`unclassified`/`data/skipped_employee` → `CommandError`/ненулевой код). `make gate` зелёный (328 passed, 5s), `make test-full` зелёный (335 passed). Status → review.
- 2026-06-15: Story 1.8 создана (bmad-create-story, контекст-движок) + адверсариально провалидирована (multi-agent ревью против реального кода/артефактов, прогон `wf_2159b42a-7f0`): исправлен каталог категорий диффа (донор-агрегатор не разбивает leave_by_report/competition/on_duty/after_duty/seconded_from → `model/aggregator_inferred`; Список/Вакансии вне ячеечного диффа; категории выровнены на канон timing/model/unclassified, `data/skipped_employee` не зеленит гейт), уточнены многодневный конверт эталона, валидация несуществующего division_id (CommandError), xlsx-эджи. Статус → ready-for-dev.
