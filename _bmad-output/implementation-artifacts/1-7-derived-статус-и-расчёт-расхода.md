---
baseline_commit: b12603a934e756820514cfe43a026cde3c0e6713 (+ незакоммиченный блок сторей 1.1–1.6 в рабочем дереве)
---

# Story 1.7: Derived-статус и расчёт расхода

Status: done

## Story

As a руководитель,
I want селектор status_on(employee, date) и сервис агрегации расхода по подразделениям (формулы сходимости),
so that расход вычисляется из интервалов детерминированно.

## Acceptance Criteria

1. **Given** импортированный срез, **When** считаю расход на дату D, **Then** Штат = Список + Вакансии и Список = Σ статусов без остатка (рантайм-ассерт).
2. **Given** статус с end=D, **Then** в D он не действует (полуоткрытость).
3. **And** property-тест (hypothesis ci-profile): ровно один derived-статус на дату; закон сохранения дней.

## Tasks / Subtasks

- [x] Task 1: тест-инфраструктура hypothesis (AC: 3)
  - [x] `pyproject.toml`: добавить `hypothesis>=6,<7` в `[project.optional-dependencies] dev`. Других зависимостей НЕ добавлять
  - [x] `conftest.py` (корень Backend/VAPS, рядом с manage.py — тест-инфраструктура, вне лимита файлов): регистрация hypothesis-профилей `ci` (max_examples=10) и `full` (max_examples=500), загрузка через `settings.load_profile(os.environ.get("HYPOTHESIS_PROFILE", "ci"))` — дефолт ci
  - [x] `Makefile`: добавить цель `test-full` (зеркало env-блока gate; `HYPOTHESIS_PROFILE=full`; `pytest` БЕЗ `-m`-фильтра; `timeout 1500` — бюджет 25 мин architecture.md). Цель `gate` НЕ трогать (см. Решение №7)
- [x] Task 2: bulk-селекторы core (AC: 1)
  - [x] `apps/core/selectors.py` — расширить существующие классы, НЕ создавать параллельных каналов (ARCH-004):
    - `CoreEmployeeSelector.working_by_division(division_ids=None) -> dict[uuid, list[uuid]]` (или values-QuerySet `id, division_id`): Employee с `employment_status="WORKING"`, одним запросом по всем подразделениям; `division_ids=None` = вся БД. Знаменатель расхода E1 (Решение №3)
    - `CoreStaffingSelector.allocated_slots_on(business_date, division_ids=None) -> dict[uuid, int]`: по DivisionHistoricalSlot правило BR-002: `valid_from <= T AND (valid_to IS NULL OR valid_to > T)`, где `T` = local-midnight(business_date) в `ZoneInfo(settings.VAPS_LOCAL_TIMEZONE)`; при нескольких подходящих строках одного подразделения берётся строка с максимальным `valid_from` (Решение №5). Один запрос
    - `CoreDivisionTreeSelector.divisions_map(division_ids=None) -> dict[uuid, str]` (id → name) — для строк отчёта, один запрос
  - [x] MUST NOT: `timezone.now()`/`date.today()` (линт 1.3); business_date — всегда явный аргумент; никаких per-item запросов
- [x] Task 3: селектор статусов + чистое ядро резолва (AC: 1, 2, 3)
  - [x] `apps/operations/statuses/services/strength_report.py` (+ boilerplate `services/__init__.py` с реэкспортом) — ЧИСТОЕ ядро без ORM (тестируется без БД; E6 переиспользует с снапшотами — ARCH-DATA-021 derive(снапшот, дата)):
    - `STATUS_TYPE_PRIORITIES: dict[str, int]` и `REPORT_COLUMN_BY_CODE: dict[str, str]` — литерально из DB-OPS-003 (15 кодов: SICK_LEAVE=10/SICK, LEAVE_BY_REPORT=15/VACATION, VACATION=20/VACATION, COMMAND=30/COMMAND, STUDY=32/TRAINING, COMPETITION=34/TRAINING, CONFERENCE=36/TRAINING, DETACHED=40/DETACHED, ATTACHED=50/ATTACHED, REST_AFTER_DUTY=60/AFTER_DUTY, BEFORE_DUTY=65/BEFORE_DUTY, DUTY=70/ON_DUTY, GEV=75/ON_DUTY, EVENT_ASSIGNMENT=80/IN_SERVICE, IN_SERVICE=999/IN_SERVICE) + `OTHER_ABSENCE=38/OTHER` (Решение №4). Sync-комментарий в стиле HARD_STATUS_TYPE_CODES: «сверяется seed-тестом 2.2; OTHER_ABSENCE — кандидат в реестр, фиксация 1.12/2.2»
    - `resolve_status(rows, on_date) -> str`: rows = неотменённые интервальные факты (employee уже отфильтрован); действует = `date_start <= on_date < date_end` (полуоткрытость, AC-2); победитель = min priority, tie-break `status_type_code ASC`, затем `date_start ASC` (BR-001); пусто → `"IN_SERVICE"` (FR-9: дата без интервала = «В строю»); код не в STATUS_TYPE_PRIORITIES → `ValueError` с кодом в сообщении (СТОП-семантика; DomainError придёт в 3.1)
  - [x] `apps/operations/statuses/selectors.py` — `EmployeeStatusSelector`:
    - `overlapping_on(on_date, employee_ids=None)` — bulk: неотменённые (`cancelled_at__isnull=True`) статусы с `period__contains=on_date` (GiST-индекс `gist_status_employee_period` существует ровно для этого), values-строки `employee_id, status_type_code, date_start, date_end`. ЕДИНСТВЕННЫЙ канал данных для агрегации
    - `status_on(employee_id, on_date) -> str` — точечный AC-контракт: те же данные одного сотрудника + `resolve_status`. MUST NOT: вызывать `status_on` в цикле где-либо (анти-паттерн COUNT()-в-цикле донора — NFR architecture.md)
- [x] Task 4: сервис агрегации расхода с формулами сходимости (AC: 1)
  - [x] Там же в `services/strength_report.py`:
    - чистая `derive_report(employees, status_rows, staff_map, on_date) -> StrengthReportResult` (dataclass): на каждого сотрудника ровно один победитель-код через `resolve_status` → колонка через `REPORT_COLUMN_BY_CODE`; группировка по `division_id` сотрудника
    - Формулы на подразделение: победители ATTACHED — отдельная колонка «+N», НЕ входят в Список (DB-OPS-003 counts_in_staff=false; BR-002 п.6); **Список = WORKING-сотрудники подразделения минус ATTACHED-победители**; **Штат = allocated_slots** из staff_map (нет записи → Штат=0 + warning `no_staffing_record`, BR-002.1); **Вакансии = max(0, Штат − Список)**; DETACHED считается в своём подразделении обычной колонкой
    - Рантайм-ассерты AC-1 (на каждое подразделение И на тоталы — сходимость глобальна, ARCH-DATA-025): `Σ колонок без ATTACHED == Список` (нарушение = баг реализации → raise AssertionError/ValueError); `Штат == Список + Вакансии` — при Штат < Список формула невыполнима по данным → подразделение в `violations` результата (не raise — это находка о данных для 1.8), ассерт проверяет остальные (Решение №6)
    - Результат: `business_date`, `rows` (division_id, name, staff_total, list_total, vacancies, колонки по REPORT_COLUMN_BY_CODE, attached), `totals`, `violations`, `warnings`
  - [x] `StrengthReportService.compute(business_date: date, division_id: UUID | None = None) -> StrengthReportResult` — ORM-обёртка: division_id задан → область = `CoreDivisionTreeSelector.subtree_ids`; данные строго через селекторы Task 2/3 (bulk, по одному запросу на сущность); сборка → `derive_report`. MUST NOT: принимать request/actor (API нет до 1.8+; RBAC-сужение придёт с API-сторями), писать в БД, читать Clock (business_date — явный аргумент, ARCH-DATA-022)
- [x] Task 5: импорт штата из staff_units донора (AC: 1; санкционировано handoff'ом 1.6: «Если 1.7 упрётся в "Вакансии" — расширение делается в 1.7»)
  - [x] `apps/migration_legacy/transform.py`: чистая `count_staff_slots(staff_unit_rows) -> tuple[dict[division_pk, int], skips]` — считает ВСЕ staff_units с division (включая employee=NULL — это и есть вакансии донора); division=NULL → skip-счётчик `slot_no_division`
  - [x] `import_donor_slice.py`: шаг после оргструктуры — на каждое подразделение из карты `DivisionHistoricalSlot.objects.update_or_create(division=d, valid_from=local_midnight(window_start), defaults={"allocated_slots": n})` (идемпотентность при том же окне; другое окно даст вторую timeline-строку — селектор Task 2 берёт последнюю по valid_from, Решение №5); local_midnight в `ZoneInfo(settings.VAPS_LOCAL_TIMEZONE)`; division_pk вне division_map → счётчик `slot_division_skipped`
  - [x] Отчёт команды дополнить блоком staffing slots: прочитано слотов / подразделений покрыто / created/updated / skip-причины — числа Штата читает 1.8
- [x] Task 6: property-тесты чистого ядра (hypothesis, маркер `property`) (AC: 2, 3)
  - [x] `apps/operations/statuses/tests/test_strength_report_properties.py`, `@pytest.mark.property`, БЕЗ django_db (чистое ядро). Стратегии: сотрудники по 1–3 подразделениям; интервальные факты со случайными типами из STATUS_TYPE_PRIORITIES, датами вокруг D (включая end==D, start==D, пересечения, дубли), флагом cancelled; staff_map со случайными значениями (включая «меньше списка» и отсутствие записи)
  - [x] Инварианты: (а) ровно один derived-статус на (employee, date) — никто не потерян, никто не в двух колонках (AC-3); (б) Σ колонок без ATTACHED == Список на каждое подразделение и в тоталах; (в) Штат == Список + Вакансии для всех подразделений вне violations; (г) полуоткрытость: факт с date_end == D не влияет на результат в D (AC-2); (д) закон сохранения дней: для окна дат [D1..Dk] при неизменном составе Σ по всем датам всех колонок без ATTACHED == Список × k; (е) детерминизм: перестановка входных строк не меняет результат
  - [x] Юнит-таблицы (без маркера — идут в gate): приоритеты (SICK_LEAVE бьёт EVENT_ASSIGNMENT — AC TASK-018b «SICK > EVENT»), tie-break при равном приоритете (code ASC, затем date_start ASC), fallback IN_SERVICE, cancelled невидим, ValueError на неизвестный код, однодневный интервал [D, D+1) действует ровно в D
- [x] Task 7: интеграционные тесты и gate (AC: 1, 2)
  - [x] `apps/operations/statuses/tests/test_strength_report_service.py` (Postgres, gate): мини-набор через ORM — fallback IN_SERVICE (статусов нет), VACATION в окне, ATTACHED как +N (не в Списке), статус с end=D не действует в D, подразделение без DivisionHistoricalSlot → warning `no_staffing_record`, переукомплектованное (Штат < Список) → violations; `status_on` точечно совпадает с колонкой агрегата
  - [x] `apps/migration_legacy/tests/test_import_command.py` — дополнить: фикстуру `donor_slice.json` расширить вакантным staff_unit (employee=null); после импорта DivisionHistoricalSlot создан с правильным allocated_slots; повторный прогон идемпотентен (created==0); блок staffing slots в stdout; `StrengthReportService.compute` на импортированной фикстуре проходит без violations типа «программный инвариант» и Штат == Список + Вакансии на чистых подразделениях фикстуры (сквозной AC-1)
  - [x] Самопроверка нетривиальности (процесс-правило ревью 1.1–1.6): временно сломать полуоткрытость (`<=` вместо `<` на date_end) → юнит И property обязаны покраснеть → вернуть
  - [x] `make gate` зелёный (property/concurrency в gate не идут — маркеры); `make test-full` зелёный (property с full-профилем); `pytest -m property` локально зелёный (ci-профиль по умолчанию)

### Review Findings

Ревью 2026-06-12 (слои: Blind Hunter, Edge Case Hunter, Acceptance Auditor — auditor чисто, все AC/MUST NOT подтверждены).

- [ ] [Review][Decision] `working_by_division` фильтрует только `employment_status=WORKING`, игнорируя `is_active` — соседний `active_in_division` фильтрует `is_active=True`. WORKING-но-неактивный сотрудник раздувает Список (знаменатель расхода), оставаясь невидимым в пер-division списке. Спека Task 2 буквально задала фильтр по employment_status — вопрос к семантике модели: возможно ли состояние `is_active=False && WORKING` и должен ли он входить в Список?
- [ ] [Review][Patch] Дубли donor-кода подразделения под одним org схлопываются в один Division, а `_import_staffing_slots` перезаписывает `allocated_slots` счётчиком последнего donor-pk вместо суммы (+ `covered` двоится) — Штат тихо занижается [Backend/VAPS/apps/migration_legacy/management/commands/import_donor_slice.py:277-285]
- [ ] [Review][Patch] `allocated_slots_on` недетерминирован при равных `valid_from` одного подразделения: queryset без `order_by`, строгое `>` в редьюсере — Штат может «мигать» между прогонами, нарушая инвариант детерминизма (е). Нужен вторичный tie-break (pk) [Backend/VAPS/apps/core/selectors.py:103-125]
- [ ] [Review][Patch] Hypothesis-профили не отключают deadline: full = 500 примеров под дефолтным 200ms-на-пример — классический источник CI-флейков на тяжёлых derive_report-мирах; добавить `deadline=None` в оба профиля [Backend/VAPS/conftest.py:11-13]
- [x] [Review][Defer] Clamp-артефакты открытых статусов между прогонами: stale `date_end` при повторе с поздним `--until` (natural key clamped-строк без date_end → скип вместо продления), а закрытый донором интервал бьётся об артефакт и мисклассифицируется как `hard_overlap` [import_donor_slice.py:412-446] — deferred, pre-existing 1.6; расширяет уже зафиксированную запись «статусы никогда не обновляются» (E7)
- [x] [Review][Defer] Циклы parent у Division персистятся в БД: цикл ломается только для резолва организации, второй проход пишет `division.parent` без проверки цикла — subtree-обходы должны это переживать [import_donor_slice.py:235-249] — deferred, pre-existing
- [x] [Review][Defer] Классификация IntegrityError по подстрокам английских сообщений Postgres (`"null value"`, `"iin"`, имя constraint) — хрупко к lc_messages/переименованиям [import_donor_slice.py:372-383, 452-466] — deferred, pre-existing
- [x] [Review][Defer] Несколько staff_units на сотрудника: division назначается последней строкой файла, без skip/warning — невидимый недетерминизм мастер-данных [import_donor_slice.py:323-327] — deferred, pre-existing
- [x] [Review][Defer] Наивный `cancelled_at` при donor `updated_at` без offset: `fromisoformat` вернёт naive → RuntimeWarning и сдвиг на локальный offset [transform.py:135] — deferred, pre-existing
- [x] [Review][Defer] `gender` и dangling `rank_pk` проходят без валидации (СТОП-семантика применена выборочно): gender пишется verbatim, отсутствующий rank тихо деградирует в `("", 0)` [transform.py:199; import_donor_slice.py:344] — deferred, pre-existing
- [x] [Review][Defer] Счётчики отчёта искажают картину: fallback-организация инкрементит created без read; `update_or_create` всегда пишет defaults → идемпотентный повтор показывает `updated N` при нулевых изменениях — числа читает 1.8 [import_donor_slice.py:207-212] — deferred, pre-existing convention
- [x] [Review][Defer] Слот с не-полуночным `valid_from` невидим в свой стартовый день (`valid_from__lte=local_midnight(D)` — поведение по букве BR-002) — гигиена данных для будущего write-API слотов [apps/core/selectors.py:106-122] — deferred, спека-mandated
- [x] [Review][Defer] `compute()` с несуществующим `division_id` возвращает пустой отчёт вместо ошибки (subtree_ids не проверяет существование) — валидация принадлежит API-слою 1.8 [strength_report.py:265-267] — deferred, scope 1.8
- [x] [Review][Defer] Makefile: `docker compose up --wait` внутри `timeout 300` гейта (медленный pull = ложный TIMED OUT), креды БД захардкожены [Backend/VAPS/Makefile:31-44] — deferred, pre-existing 1.1–1.6 (gate не трогали по Решению №7)

### Review Findings — 2026-06-15 (повторное адверсариальное ревью)

Повторный прогон bmad-code-review (7 слоёв-охотников → кластеризация → двойная адверсариальная верификация correctness+scope → синтез; 47 сырых → 32 уникальных находки; прогон `wf_dbbaa59c-259`). Итог: **1 in-scope HIGH** (подтверждает KO-2 ниже), остальное low/nit; ядро BR-001/BR-002/AC-1/AC-2/AC-3 положительно подтверждено верификаторами (C24/25/27–32). Этот блок переоценивает 4 открытые находки от 2026-06-12: KO-1/KO-2/KO-4 стоят, **KO-3 понижена HIGH→low (defer)** — тай недостижим текущими путями записи.

Decision-needed:

- [x] [Review][Patch] `working_by_division`: добавить фильтр `is_active=True` (выровнять с `active_in_division`) — **вердикт D1=2 (2026-06-15)**, осознанное отклонение от Решения №3. На текущих импортированных данных no-op (`is_active` не трогается импортом 1.6 → дефолт True); расходится с донор-паритетом 1.8 только при появлении WORKING-но-неактивных строк. [Backend/VAPS/apps/core/selectors.py:85-101] (=C4/KO-1)
- [x] [Review][Defer] `derive_report`/`compute` не сеют строки для подразделений субдерева без WORKING-сотрудников И без слота — пустое подразделение «исчезает» вместо нулевой строки. [Backend/VAPS/apps/operations/statuses/services/strength_report.py:155,254-281] — deferred → 1.8 (**вердикт D2=1, 2026-06-15**): контракт состава/отображения строк решает потребитель отчёта (1.8), вызывающего API ещё нет; инварианты сходимости не затронуты. (=C5)

Patch:

- [x] [Review][Patch] **HIGH** Схлопнутые donor-коды подразделений (UniqueConstraint `(organization, code)`) ПЕРЕЗАПИСЫВАЮТ `allocated_slots` счётчиком последнего donor-pk вместо СУММЫ; `covered` двоится → Штат (STAFF_TOTAL/BR-002) тихо занижается. Перекидать `counts` на `Division.id` (сумма по схлопнутым pk) ДО цикла записи, писать один раз на Division, `covered++` на различимый Division. Фикстура с уникальными кодами не ловит кейс. [Backend/VAPS/apps/migration_legacy/management/commands/import_donor_slice.py:269-286] (=C2/KO-2; единственный HIGH, блокер закрытия 1.7)
- [x] [Review][Patch] Hypothesis-профили ci/full не отключают `deadline` (наследуют дефолт 200ms/пример); full=500 примеров на тяжёлых derive_report-мирах → риск интермиттентных CI-флейков. Добавить `deadline=None` в оба `register_profile`. [Backend/VAPS/conftest.py:11-13] (=C3/KO-4; low — CI-гигиена)
- [x] [Review][Patch] valid_to-граница BR-002 (закрытый слот) не покрыта ни одним ORM-тестом — все интеграционные слоты `valid_to=None`. Добавить: слот `valid_to==local_midnight(D)` невидим в D (строгое `>`); слот `valid_to==local_midnight(D+1)` считается в D. [Backend/VAPS/apps/operations/statuses/tests/test_strength_report_service.py:68] (=C26; low — пробел покрытия нового кода)
- [x] [Review][Patch] `test_bulk_one_query_per_entity` на ОДНОМ подразделении не докажет отсутствие per-division N+1 (4 запроса при 1 div пройдут и при регрессии). Развести сущности на 2–3 подразделения внутри `assert_num_queries(4)`. [Backend/VAPS/apps/operations/statuses/tests/test_strength_report_service.py:205-213] (=C19; low — robustness теста)
- [x] [Review][Patch] `compute(division_id=None)` разворачивает все WORKING-id в один Python-список → гигантский `IN(...)`; `overlapping_on(on_date)` уже сужает через `period__contains`+GiST и избыточен. Для whole-DB звать `overlapping_on` без `employee_ids`, не-членов отсеивать в `derive_report`. [Backend/VAPS/apps/operations/statuses/services/strength_report.py:268-275] (=C17; low — нет API-вызывающего до 1.8, опционально)

Deferred:

- [x] [Review][Defer] `allocated_slots_on` недетерминирован при равных `valid_from` (нет `order_by`, строгое `>` в редьюсере) — **переоценено: тай недостижим** текущими путями записи (`update_or_create` по `(division, valid_from)` де-факто уникален; `valid_to` никто не закрывает). Защитное усиление под E7 (вторичный tie-break по pk). [Backend/VAPS/apps/core/selectors.py:103-125] — deferred (=C1/KO-3, понижено HIGH→low: «ломает детерминизм на практике» НЕ подтверждено)
- [x] [Review][Defer] `working_by_division` фильтрует `employment_status` без индекса (`idx_emp_div_active` = `(division, is_active)`) → seq scan, деградация на росте таблицы. Индекс `(employment_status, division)` или partial — follow-up (1.7 без миграций). [Backend/VAPS/apps/core/selectors.py:85-101] — deferred (=C18, новый путь доступа, требует миграции)
- [x] [Review][Defer] `_resolve_until` для незавершённых строк берёт `actual_end_date` при дефолте конца окна — асимметрия с `transform_status`; `_import_staffing_slots` не потребляет `until`. [Backend/VAPS/apps/migration_legacy/management/commands/import_donor_slice.py] — deferred, pre-existing 1.6 (=C6)
- [x] [Review][Defer] Несколько staff_units на сотрудника → division от последней строки файла без skip/warning. [Backend/VAPS/apps/migration_legacy/management/commands/import_donor_slice.py:323-327] — deferred, pre-existing 1.6 (=C8, повтор записи 2026-06-12)
- [x] [Review][Defer] Штат считает staff_units импорт-скипнутых сотрудников → фантомные вакансии (DEP1→5/1/4) — но это **намеренный паритет** с донор-агрегатором (Решение №5/№6) для диффа 1.8. [Backend/VAPS/apps/migration_legacy/transform.py] — deferred, spec-mandated (=C12)
- [x] [Review][Defer] Наивный `cancelled_at` из donor `updated_at` без offset (`fromisoformat` → naive в USE_TZ-поле); в 1.7 `cancelled_at` только IS-NULL-фильтруется, фикстуры с Z. [Backend/VAPS/apps/migration_legacy/transform.py:135] — deferred, pre-existing 1.6 (=C15, повтор записи 2026-06-12)

Dismissed как шум/false-positive/верификация (19): C7, C9, C10, C11, C13, C14, C16, C20, C21, C22, C23 (refuted/nit) + C24, C25, C27, C28, C29, C30, C31, C32 (положительные подтверждения конформности BR-001/BR-002/AC-1/AC-2/AC-3 — не дефекты). Детали в прогоне `wf_dbbaa59c-259`.

## Dev Notes

### Цель (одним предложением)

Превратить импортированные интервалы в детерминированный расход: чистое ядро «кто в какой колонке на дату D» (приоритеты DB-OPS-003, fallback «В строю», полуоткрытость) + bulk-агрегация по подразделениям с формулами сходимости как рантайм-ассертами — это ядро потом ест снапшоты (E6), а его property-инварианты — главная страховка против семантически неверного AI-кода (стратегия качества architecture.md).

### Текущее состояние кода (прочитано 2026-06-12)

- **`EmployeeStatus`** (`apps/operations/statuses/models/employee_status.py`): `employee_id` UUIDField (плоский), `status_type_code` CharField (свободный текст до FK 2.2), `date_start`/`date_end` NOT NULL `[)`, `cancelled_at` nullable, `period` GeneratedField daterange; **полный GiST `gist_status_employee_period` заведён в 1.5 «для derived-выборок 1.7»** — `period__contains=D` обязан его использовать. `HARD_STATUS_TYPE_CODES` экспортируется из `apps.operations.statuses.models`.
- **В statuses нет** `selectors.py`, `services/` — создаются этой сторей. Каталог models/ — пакет с реэкспортом (образец структуры).
- **`apps/core/selectors.py`**: `CoreDivisionTreeSelector` (`subtree_ids`, `leaf_descendants`, `_children_map`), `CoreEmployeeSelector` (`get`, `active_in_division` — per-division, для агрегации НЕ годится), `HistoricalEmployeeSelector.division_at` (per-item + fallback на текущее подразделение — в агрегации НЕ использовать, см. Решение №3).
- **`DivisionHistoricalSlot`** (`apps/core/models.py:278-298`): division FK, `allocated_slots` (MinValue 0), `valid_from`/`valid_to` DateTimeField — модель ровно под BR-002 STAFF_TOTAL, существует с core/0009, **данных в неё никто не пишет** — наполняет Task 5.
- **`Employee`**: `division` FK PROTECT NOT NULL (знаменатель E1), `employment_status` WORKING/FIRED/ARCHIVED, `is_active` (импорт 1.6 его не трогает — в фильтрах НЕ использовать), `separated_at`/`hire_date`/`dismissal_date` — для E1 не используются (Решение №3).
- **Импорт 1.6** (`apps/migration_legacy/`): transform.py — чистые функции; команда уже парсит `staff_unit.staffunit` (карта employee_pk → division/position), но слоты НЕ материализует; фикстура `tests/fixtures/donor_slice.json` содержит staff_units; in_service-интервалы донора НЕ импортированы (skip `in_service_derived`) — **fallback IN_SERVICE в resolve — единственный источник колонки «В строю»**; импортируемые литералы кодов: VACATION, LEAVE_BY_REPORT, SICK_LEAVE, COMMAND, STUDY, COMPETITION, OTHER_ABSENCE, DUTY, REST_AFTER_DUTY, ATTACHED, DETACHED.
- **Clock** (`apps/core/clock.py`): в этой стори НЕ нужен — business_date везде явный аргумент; `settings.VAPS_LOCAL_TIMEZONE` существует (его читает clock) — использовать для local_midnight. `TIME_ZONE="Asia/Qyzylorda"`, `USE_TZ=True`.
- **Тестовая инфраструктура**: conftest.py в проекте НЕТ (создаётся Task 1); маркеры `property`/`concurrency`/`slow` уже объявлены в pyproject (`--strict-markers`); gate гоняет `-m "not property and not concurrency and not slow"`; hypothesis НЕ установлен — новая dev-зависимость.
- **Донор-агрегатор** (`Backend/PersonnelStatus/.../apps/reports/infrastructure/data_aggregator.py` — ТОЛЬКО ЧИТАТЬ): считает СТАТУСЫ, а не людей (сотрудник с двумя пересекающимися статусами попадает в обе колонки — двойной счёт); «без статуса = В строю» (`inferred_in_service = max(0, total - known)`); Штат = `count(StaffUnit)` по подразделению; `seconded_in` по `related_division` (мы related_division не импортируем); `seconded_from` агрегатор вообще игнорирует (такой сотрудник у донора проваливается в inferred «В строю»). Это категории-гипотезы для диффа 1.8, НЕ повод воспроизводить двойной счёт.

### Сверка с источниками — что взято, что осознанно отклонено

| Источник | Взято / Отклонено | Почему |
|---|---|---|
| BR-001 (VAPS_7.8.2): min priority, tie `status_type_code ASC, starts_at ASC`, пусто → IN_SERVICE | взято литерально | контракт резолвера; «ровно один статус на дату» (AC-3) |
| BR-001: источники = statuses со `state IN (ACTIVE, PLANNED)` + approved assignments | адаптировано: неотменённые интервалы, содержащие D | state в VAPS derived (ARCH-DATA-022), `state==ACTIVE/PLANNED` на дату D ≡ «интервал содержит D и не отменён»; assignments — этап 2 (E16) |
| DB-OPS-003: priority/report_column_code/counts_in_staff | взято литералами в константы | FK и seed — 2.2; коды обязаны совпасть заранее (урок 1.6) |
| BR-002: STAFF_TOTAL из DivisionHistoricalSlot, правило valid_from/valid_to, BR-002.1 warning | взято | модель готова; warning вместо падения |
| BR-002 п.4: LIST_TOTAL = STAFF − VACANCIES | отклонено для E1: Список = фактические WORKING минус ATTACHED | литеральная формула при Штат<Список даёт «список меньше живых людей» — расход врёт о людях; E1 меряет реальность, расхождение фиксируется в violations (Решение №6) |
| BR-002: leaf-подразделения, историческое подразделение на T | упрощено: Employee.division, все подразделения с людьми/слотами | историй EmployeeDivisionHistory в срезе нет (1.6 их не пишет); «списочный состав на дату» — 2.4 |
| TASK-018b/c (DailyStatusResolver/ReportItemAggregator) | реализуется как resolve_status + derive_report в statuses | сущности спеки = функции ядра; имена по Glossary (StrengthReport) |
| architecture.md: «property-based на ядро агрегации: никто не в двух списках, никто не потерян, суммы сходятся» | взято как инварианты (а)–(е) Task 6 | прямое требование стратегии качества |
| architecture.md: reports-app владеет агрегацией | отложено: ядро живёт в statuses | E1 без снапшотов; reports появится с E6 и импортирует statuses (разрешённая стрелка «вниз»); ядро чистое — переезд дешёвый (Решение №2) |

### Что НЕ трогать (Out of Scope)

- **State-аннотация PLANNED/ACTIVE/FINISHED** (Case/When + @property, тест эквивалентности) — 3.2. Здесь только «статус на дату».
- **Вывод расхода (команда/endpoint, .xlsx), дифф с донором, эталоны** — 1.8. Эта стори отдаёт StrengthReportResult в памяти.
- **DomainError/exception_handler** — 3.1. Неизвестный код = ValueError.
- **FK status_type_code → StatusType, seed, реестры** — 2.2/1.12. Константы с sync-комментарием.
- **Watermark/catch-up/Celery** — 3.12. Расход — чистое чтение.
- **RBAC/actor-сужение селекторов** — придёт с API-сторями (правило «list-селектор принимает actor» — про API-видимость; внутренних derive-селекторов не касается, зафиксировать комментарием).
- **StaffingSlot/Vacancy-модели** — НЕ использовать: Штат E1 = DivisionHistoricalSlot (BR-002); пообъектная штатка — E2.
- **Кэширующие stored-поля «для производительности»** — ЗАПРЕЩЕНО (предостережение Winston: второй источник истины о времени).
- **«Ошибка коллекции на забытый маркер»** (conftest-фича из architecture.md) — не сейчас, отдельное улучшение тест-инфраструктуры.
- **Deferred-баги из deferred-work.md** — не чинить мимоходом.
- **Донор** (`Backend/PersonnelStatus/`) — только чтение.

### Решения, принятые при создании стори (дефолты; менять только осознанно)

1. **Ядро — чистые функции, ORM — тонкая обёртка.** `resolve_status`/`derive_report` не знают про Django: property-тесты без БД укладываются в бюджет, E6 вызовет то же ядро на JSONB-снапшоте (ARCH-DATA-021: расход = derive(снапшот, дата)), parallel-run-классификатор получит реплеируемую функцию.
2. **Агрегация живёт в `operations/statuses`, не в новом app reports.** Лимит «не больше двух app» (правила декомпозиции) уже выбран statuses+migration_legacy (+санкционированный канал core/selectors); «кто активен на дату» — домен статусов; reports-app родится в E6 со снапшотами и будет импортировать statuses (разрешённое направление: statuses ← submissions ← reports).
3. **Список(D) для E1 = `employment_status="WORKING"` по `Employee.division`, без исторической активности.** Донор-агрегатор фильтрует ровно так (паритет для диффа 1.8 важнее буквы BR-002 про created_at/separated_at — у импортированных строк created_at = момент импорта, формула спеки на историческом срезе вырождается). Уволенные в окне среза — категория-гипотеза 1.8; «списочный состав на дату» — стори 2.4.
4. **`OTHER_ABSENCE` получает priority=38, колонку OTHER.** Кода нет в DB-OPS-003, но 1.6 его уже импортирует (Решение №4 стори 1.6), а BR-002 содержит колонку OTHER. 38 — в полосе «прочих отсутствий» между TRAINING-группой (32–36) и DETACHED (40). Sync-комментарий «кандидат в реестр — 1.12/2.2» обязателен.
5. **Штат из донора: слоты = count(staff_units) на подразделение, одна timeline-строка на окно импорта.** Источник тот же, что у донор-агрегатора (паритет 1.8). `update_or_create(division, valid_from=local_midnight(window_start))` — идемпотентность при том же окне; другое окно даёт вторую строку с valid_to=NULL — селектор берёт последнюю по valid_from (документированный edge; полная политика timeline — E7).
6. **Семантика рантайм-ассертов AC-1 двухслойная.** Программные инварианты (Σ колонок без ATTACHED == Список; Штат == Список + Вакансии там, где Штат ≥ Список) держатся конструкцией — их нарушение = баг → raise. Невыполнимость формулы по данным (Штат < Список — переукомплектованность/мусор донора) — НЕ исключение, а запись в `violations` результата: расход обязан выйти и показать находку (петля доверия: каждый дифф — объяснимая категория, 1.8).
7. **Противоречие architecture.md о property в gate решено в пользу литерала таблицы.** Таблица make-целей: gate = `-m "not property/concurrency/slow"`; одновременно «hypothesis ci (в gate)». Решение: маркер `property` в gate НЕ идёт (gate не трогаем — бюджет 5 мин священен), профиль ci — дефолт для локального `pytest -m property`, full — в новой цели `make test-full` (бюджет 25 мин из той же таблицы). Юнит-таблицы резолвера (без маркера) идут в gate и держат регрессию ежедневно.
8. **Неизвестный `status_type_code` в данных → ValueError, не «прочие».** До FK 2.2 колонка — свободный текст; пишут её только тесты и импорт 1.6 (контролируемые литералы), значит незнакомый код = программная ошибка, и тихая колонка OTHER замаскировала бы её (СТОП-семантика на данных, как в 1.6).

### Подводные камни для dev-агента

- **Полуоткрытость — сердце AC-2:** действует = `date_start <= D < date_end`. В ORM это `period__contains=D` (daterange `[)` сам отдаёт нужное) — НЕ писать вручную `date_end__gt`/`gte`-каши; в чистом ядре — явное сравнение. Тест с литеральными датами: статус [01.06, 15.06) в 15.06 НЕ действует, однодневный [D, D+1) действует ровно в D.
- **Bulk или смерть:** агрегация делает ровно по ОДНОМУ запросу на сущность (статусы через `overlapping_on`, сотрудники, слоты, имена подразделений). `status_on`-в-цикле, `active_in_division`-в-цикле, `division_at`-в-цикле — воспроизведение анти-паттерна донора, ради изгнания которого селекторам прописан bulk-API (architecture.md, NFR производительность).
- **Пересечения в данных легальны:** exclusion constraint держит только hard×hard; soft×soft, soft×hard, дубли одного типа — реальны (импорт 1.6 их пропускает). `resolve_status` обязан детерминированно выбирать победителя из ЛЮБОГО набора, property-стратегии обязаны такие наборы генерить.
- **cancelled_at — это «записи нет»:** фильтр `cancelled_at__isnull=True` в селекторе; чистое ядро получает уже живые факты (не тащить флаг внутрь resolve).
- **ATTACHED — единственный код с counts_in_staff=false:** его носитель НЕ в Списке и НЕ в Σ-балансе, но В отчёте (+N). Забыть вычесть его из Списка = Σ-ассерт упадёт на любой фикстуре с ATTACHED — property-инвариант (б) это ловит.
- **timezone-ловушка DivisionHistoricalSlot:** valid_from — aware datetime; сравнение с датой D — только через local_midnight(D) в `ZoneInfo(settings.VAPS_LOCAL_TIMEZONE)` (НЕ `datetime(D...)` без tzinfo, НЕ UTC-полночь: это сдвиг на 5 часов и off-by-one на границе суток). Канарейка tzdata уже в gate.
- **`update_or_create` и `valid_from` в lookup-части:** `update_or_create(division=d, valid_from=ts, defaults={"allocated_slots": n})` — allocated_slots в defaults, иначе повторный прогон с изменившимся числом слотов не обновит строку.
- **Дисциплина линта 1.3:** `timezone.now()`/`date.today()` в services/models — ошибка ruff-конфига. Расходу время не нужно вовсе — business_date приходит аргументом до самого низа.
- **ruff сразу** (`select=["E","F"]`, py312): длинные таблицы приоритетов разбить заранее (урок ревью 1.1–1.6).
- **hypothesis в gate:** property-тесты маркированы `property` и в gate не идут, но САМ импорт hypothesis в тест-файле выполняется при коллекции — если зависимость не установлена, gate упадёт на collection error. `pip install -e '.[dev]'` после правки pyproject — первый шаг.
- **Не изобретать вывод:** никаких print-таблиц/CSV/endpoint'ов — 1.8. Результат — структура данных + тесты.
- **В рабочем дереве незакоммиченный блок 1.1–1.6** — НЕ откатывать, НЕ включать в свой File List (процесс-правило ревью 1.4: блок коммитится вместе).
- **`make gate` — единственная команда прогона** (Postgres-сьюта); точечно: `docker compose up -d --wait db && VAPS_DB=postgres VAPS_DB_NAME=vaps VAPS_DB_USER=vaps VAPS_DB_PASSWORD=vaps VAPS_DB_HOST=localhost VAPS_DB_PORT=5433 .venv/bin/pytest apps/operations/statuses`.

### Технические версии

- Django 5.1.x, psycopg3, PostgreSQL 16 (compose, 5433) — без изменений.
- **Новая dev-зависимость: `hypothesis>=6,<7`** (актуальный мажор 6.x; чистый Python, офлайн-дружелюбен — важно для контура). Рантайм-зависимостей НЕ добавляется.

### Git-интеллидженс

- HEAD = `b12603a`; блок сторей 1.1–1.6 не закоммичен — образцы кода брать из рабочего дерева `Backend/VAPS/apps/` (вложенный app statuses, стиль селекторов core, отчёт import_donor_slice), НЕ из донора.
- Уроки ревью 1.1–1.6 (обязательные): полный File List; ruff-формат сразу; самопроверка нетривиальности новых тестов (сломать → красный → вернуть); deferred-баги не чинить мимоходом; Completion Notes без непроверенных утверждений — каждое «прогнано/passed» подкреплять командой и результатом в Debug Log (ревью 1.4 и 1.5 ловили враньё в нотах).

### Зависимости

- Depends on: 1.5 (EmployeeStatus + GiST), 1.6 (импортированный срез + staff_unit-парсинг команды), 1.1 (gate/Postgres-harness). Косвенно 1.3 (линт времени).
- Blocks: 1.8 (вывод и дифф едят StrengthReportResult и отчёт о слотах), E5/E6 (снапшот и документ переиспользуют ядро derive), 2.2 (seed-тест сверит STATUS_TYPE_PRIORITIES/REPORT_COLUMN_BY_CODE и HARD_STATUS_TYPE_CODES со справочником).
- Связана: 2.4 (списочный состав на дату заменит Решение №3), 1.12 (OTHER_ABSENCE → реестр).

### Тесты стори

- Unit (без БД, gate): таблицы резолвера — приоритеты, tie-break, fallback, cancelled, полуоткрытость, ValueError; `count_staff_slots`.
- Property (hypothesis, маркер `property`, ci=10/full=500): инварианты (а)–(е) Task 6 на чистом ядре.
- Integration (Postgres, gate): селектор `overlapping_on`/`status_on` на ORM; сервис на мини-наборе (fallback, ATTACHED +N, end=D, no_staffing_record, violations); импорт слотов на фикстуре + идемпотентность + сквозной AC-1 на импортированном срезе.
- Регрессия: сьюты core/operations/statuses/migration_legacy зелёные; `make gate` зелёный; `make test-full` зелёный.
- Manual (DoD): `import_donor_slice` на фикстуре → `StrengthReportService.compute` в shell → строки расхода глазами: числа объяснимы, violations/warnings читаются.

### Definition of Done

- [ ] hypothesis в dev extras; conftest с профилями ci/full; `make test-full` существует и зелёный
- [ ] `CoreEmployeeSelector.working_by_division`, `CoreStaffingSelector.allocated_slots_on`, `CoreDivisionTreeSelector.divisions_map` — bulk, по одному запросу
- [ ] `EmployeeStatusSelector` (`overlapping_on`, `status_on`) + чистый `resolve_status` по BR-001 с fallback IN_SERVICE
- [ ] `derive_report`/`StrengthReportService.compute`: колонки DB-OPS-003, ATTACHED +N вне Списка, Штат/Список/Вакансии, ассерты двухслойной семантики (Решение №6), violations/warnings в результате
- [ ] Импорт штата: DivisionHistoricalSlot из staff_units донора, идемпотентно, с блоком в отчёте команды
- [ ] AC-1 сквозной на импортированной фикстуре; AC-2 юнитом и интеграционно; AC-3 property-инвариантами (а), (д)
- [ ] Новых рантайм-зависимостей нет; донор не тронут; `make gate` зелёный (< 5 мин)

### Project Structure Notes

- Новые файлы точно по architecture.md#Complete Project Directory Structure: statuses получает `selectors.py` и `services/` (пакет — как в эскизе структуры); reports-app НЕ создаётся (Решение №2).
- Считаемые файлы логики: `apps/core/selectors.py`, `apps/operations/statuses/selectors.py`, `apps/operations/statuses/services/strength_report.py`, `apps/migration_legacy/transform.py`, `apps/migration_legacy/management/commands/import_donor_slice.py` — 5 ≤ 5. Вне лимита: тесты и фикстуры, boilerplate (`services/__init__.py`), тест-инфраструктура (`conftest.py`) и конфиг сборки (`pyproject.toml`, `Makefile` — по прецеденту 1.1, владевшей Makefile как harness).
- App-границы: statuses (своя логика) + migration_legacy (санкционированный мост, право прямых импортов закреплено в 1.6) + `apps/core/selectors.py` — расширение ЕДИНСТВЕННОГО санкционированного канала cross-context чтения (ARCH-004), не «третья app» в смысле правила о модельных связях: моделей, миграций и FK стори не добавляет ни в одну app.
- `project-context.md` в репо отсутствует (проверено glob'ом при активации) — раздел не применим.

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Story 1.7] — формулировка и AC
- [Source: _bmad-output/planning-artifacts/epics.md#Epic 1] — DoD-гейт эпика (расход 5–7 дней против донора); допущения A3/A4
- [Source: _bmad-output/planning-artifacts/epics.md#Правила декомпозиции стори] — лимиты файлов/app
- [Source: _bmad-output/planning-artifacts/architecture.md#Data Architecture] — ARCH-DATA-021 (derive(снапшот, дата) — будущий потребитель ядра), ARCH-DATA-022 (derived-first, business_date явно, MUST NOT мутируемый state), ARCH-DATA-023 (интервалы `[)`, календарные сутки), ARCH-DATA-025 (сходимость глобально)
- [Source: _bmad-output/planning-artifacts/architecture.md#Test Organization & Make Targets] — маркеры, hypothesis-профили ci/full, бюджеты gate/test-full (источник Решения №7)
- [Source: _bmad-output/planning-artifacts/architecture.md#Implementation Handoff] — предостережение Winston (никаких кэширующих stored-полей)
- [Source: docs/PersonnelStatus/VAPS_7.8.2.md#BR-001. Daily report priority matrix] — резолв: min priority, tie-break code/starts_at, пусто → IN_SERVICE
- [Source: docs/PersonnelStatus/VAPS_7.8.2.md#BR-002. Daily report columns and staffing balance] — колонки, STAFF_TOTAL из core_division_historical_slots, BR-002.1 warning, ATTACHED +N
- [Source: docs/PersonnelStatus/VAPS_7.8.2.md#DB-OPS-003. `ops_status_types` seed] — приоритеты/колонки/counts_in_staff (15 кодов)
- [Source: docs/PersonnelStatus/VAPS_7.8.2.md#TASK-018b. DailyStatusResolver, #TASK-018c. ReportItemAggregator] — AC резолвера и агрегатора (SICK > EVENT; ATTACHED не в числителе)
- [Source: Backend/VAPS/apps/operations/statuses/models/employee_status.py] — модель, HARD_STATUS_TYPE_CODES, GiST под derived-выборки
- [Source: Backend/VAPS/apps/core/models.py:278-298] — DivisionHistoricalSlot (приёмник Штата)
- [Source: Backend/VAPS/apps/core/selectors.py] — существующие селекторы (расширять, не дублировать)
- [Source: Backend/PersonnelStatus/Personnel-Records/organization_management/apps/reports/infrastructure/data_aggregator.py] — донор-агрегатор: двойной счёт статусов, inferred «В строю», штат = count(StaffUnit), seconded_in по related_division (категории-гипотезы 1.8)
- [Source: _bmad-output/implementation-artifacts/1-6-минимальный-импорт-среза-донора.md] — handoff про Вакансии/штат, литералы кодов, уроки ревью
- [Source: _bmad-output/implementation-artifacts/deferred-work.md] — окно свободного текста status_type_code до 2.2; не чинить deferred мимоходом

## Dev Agent Record

### Agent Model Used

claude-fable-5 (Claude Code, bmad-dev-story workflow, 2026-06-12)

### Debug Log References

- RED ядро: `pytest apps/operations/statuses/tests/test_strength_report_properties.py` → collection error (модуля нет); после реализации — 23 passed (0.12s).
- Полный hypothesis-профиль ядра: `HYPOTHESIS_PROFILE=full pytest ... -m property` → 6 passed (4.35s, 500 примеров).
- Самопроверка нетривиальности (процесс-правило ревью 1.1–1.6): временно `<` → `<=` на date_end в `resolve_status` → покраснели юнит-таблицы `test_one_day_interval_acts_exactly_on_its_day`, `test_end_date_is_exclusive` И property-инвариант (г) `test_half_openness_facts_ending_on_d_are_invisible` (3 failed, 20 passed) → возврат `<` → 23 passed.
- Интеграция сервиса: `pytest apps/operations/statuses/tests/test_strength_report_service.py` (Postgres 5433) → 16 passed (0.94s), включая `test_bulk_one_query_per_entity` — compute() укладывается ровно в 4 запроса.
- RED импорт: `pytest apps/migration_legacy` → collection error (нет `count_staff_slots`); после реализации → 89 passed (1.34s), включая сквозной AC-1 `test_compute_on_imported_fixture_converges`.
- `make gate` → 284 passed, 7 deselected, ruff clean, `makemigrations --check` clean; duration 5s (бюджет 300s). Первый прогон поймал 2 × E501 в property-тестах — исправлено переносом строк.
- `pytest -m property` (ci-профиль по умолчанию) → 6 passed, 285 deselected (0.20s).
- `make test-full` (HYPOTHESIS_PROFILE=full, без -m-фильтра) → 291 passed; duration 10s (бюджет 1500s).
- Manual DoD: импорт фикстуры + `StrengthReportService.compute` на 2026-06-02/04/06 — отчёт распечатан, числа объяснимы: на 06-06 VACATION с end=06-06 не действует (полуоткрытость) → IN_SERVICE; COMPETITION (prio 34) бьёт DETACHED (40) → TRAINING; «staffing divisions covered: 2»; violations/warnings пусты на всех датах.

### Completion Notes List

- Реализовано чистое ядро `resolve_status`/`derive_report` (services/strength_report.py, stdlib-only на уровне модуля): приоритеты и колонки DB-OPS-003 литералами (15 кодов + OTHER_ABSENCE=38/OTHER с sync-комментарием), полуоткрытость `date_start <= D < date_end`, fallback IN_SERVICE, ValueError на неизвестный код, ATTACHED как «+N» вне Списка, двухслойная семантика ассертов (Решение №6): Σ-инварианты → raise AssertionError, Штат < Список → запись в `violations`, отсутствие слота → warning `no_staffing_record` (BR-002.1).
- `StrengthReportService.compute` размещён в том же strength_report.py (лимит 5 файлов логики), но импортирует селекторы НА УРОВНЕ ФУНКЦИИ — это сохраняет чистоту модуля (property-тесты без Django) и разрывает цикл импортов selectors ↔ services. compute = ровно 4 bulk-запроса (сотрудники, слоты, статусы, имена), без Clock, без actor, без записи в БД.
- Отклонение от литеральной сигнатуры стори: `derive_report` получил опциональный kwarg `division_names` — имена подразделений нужны в строках результата (Task 4), а каналом для них назначен `divisions_map` (Task 2). Опциональность сохраняет 4-аргументный чистый вызов в property-тестах.
- `local_midnight()` вынесен публичной функцией в `apps/core/selectors.py` (а не задублирован в селекторе и команде): tz-ловушка из «подводных камней» закрыта одним протестированным местом; команда импорта берёт его через санкционированный мост 1.6.
- Импорт штата: `count_staff_slots` (чистая, в transform.py) считает ВСЕ staff_units с division, включая employee=NULL (вакансии донора); `_import_staffing_slots` материализует по одной timeline-строке на окно (`update_or_create(division, valid_from=local_midnight(window_start))`, allocated_slots в defaults — повторный прогон с изменившимся числом слотов обновляет строку). Отчёт дополнен блоком `staffing_slots: read/created/updated/skipped` + строкой `staffing divisions covered: N`; skip-причины: `slot_no_division` (примеры = pk слотов) и `slot_division_skipped` (примеры = donor division_pk — pk слотов теряются при подсчёте, задокументировано в коде).
- Фикстура donor_slice.json УЖЕ содержала вакантный staff_unit (pk 5, employee=null) — расширение не потребовалось; тест проверяет, что он входит в Штат (DEP1 = 5 слотов).
- Tie-break «code ASC» при равном приоритете ненаблюдаем снаружи: таблица приоритетов инъективна, равенство возможно только у дублей одного кода. Покрыт детерминизм-тестами (юнит + property-инвариант (е)); ветка остаётся в min-ключе как future-proof к 2.2.
- Property-инвариант (д) (закон сохранения дней) проверяется на стратегии без ATTACHED-кодов: с ATTACHED Список меняется по датам и константа Список × k не определена; ATTACHED-вариативность покрыта инвариантами (а)/(б) на полной стратегии.
- hypothesis 6.155.2 установлен в dev extras; профили ci=10/full=500 в корневом conftest.py; `make test-full` добавлен (зеркало env-блока gate, timeout 1500); цель `gate` не тронута (Решение №7).
- Незакоммиченный блок сторей 1.1–1.6 в рабочем дереве не тронут и не включён в File List (процесс-правило ревью 1.4).

### File List

Created:
- Backend/VAPS/conftest.py
- Backend/VAPS/apps/operations/statuses/selectors.py
- Backend/VAPS/apps/operations/statuses/services/__init__.py
- Backend/VAPS/apps/operations/statuses/services/strength_report.py
- Backend/VAPS/apps/operations/statuses/tests/test_strength_report_properties.py
- Backend/VAPS/apps/operations/statuses/tests/test_strength_report_service.py

Modified:
- Backend/VAPS/pyproject.toml
- Backend/VAPS/Makefile
- Backend/VAPS/apps/core/selectors.py
- Backend/VAPS/apps/migration_legacy/transform.py
- Backend/VAPS/apps/migration_legacy/management/commands/import_donor_slice.py
- Backend/VAPS/apps/migration_legacy/tests/test_transform.py
- Backend/VAPS/apps/migration_legacy/tests/test_import_command.py

## Change Log

- 2026-06-12: Story 1.7 реализована целиком (Tasks 1–7): hypothesis-инфраструктура (профили ci/full, make test-full), bulk-селекторы core (working_by_division, allocated_slots_on, divisions_map, local_midnight), EmployeeStatusSelector (overlapping_on/status_on), чистое ядро resolve_status/derive_report с формулами сходимости и двухслойными ассертами, StrengthReportService.compute (4 bulk-запроса), импорт штата из staff_units донора в DivisionHistoricalSlot (идемпотентный, с блоком в отчёте), юнит-таблицы + 6 property-инвариантов + 16 интеграционных тестов сервиса + 7 тестов импорта штата. Гейты: make gate 284 passed (5s), make test-full 291 passed (10s). Status → review.
