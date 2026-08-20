---
baseline_commit: 9f0657d (feat(story-6.7): Скачивание и повторная выдача; 6.1–6.7 done — Attachment+download+sha-verify+DOCUMENT_DOWNLOADED, DocumentSequence, 4 генератора, IssuedDocument+issue_expense_document, async DEFERRED)
context:
  - _bmad-output/planning-artifacts/epics.md (§Epic 6 Story 6.8 стр. 874-880; границы: 6.9 стр. 882-889 «зерно parallel-run/ночной diff против донора», 6.10 стр. 891-900 «HTTP-поверхность выпуска/периода», 6.5 «выпуск docx-only» done)
  - _bmad-output/planning-artifacts/architecture.md:109 (golden master двухслойно: «числа+формулы как рантайм-инварианты; нормализованный document.xml» — НЕ побайтово), :629-643 (§Test Organization & Make Targets — golden в test-full, make golden-update ручной, кросс-субдомен → operations/tests/…), :291 (снапшот = интервалы-факты + schema_version), :302 (Clock — единственное чтение wall-clock; MUST NOT timezone.now() в доменной логике)
  - _bmad-output/planning-artifacts/architecture.md:96 (NFR-8: golden master расхода — числа+XML, не байты)
  - Backend/VAPS/apps/operations/submissions/expense_document.py:44-162 (build_expense_document(snapshot, business_date, *, staff_map, division_names, division_id) → ExpenseDocumentData; ЧИСТАЯ, без ORM/wall-clock)
  - Backend/VAPS/apps/operations/statuses/services/strength_report.py:141-232 (derive_report(employees, status_rows, staff_map, on_date, division_names=None) → StrengthReportResult; REPORT_COLUMNS :65-77; чистая, stdlib)
  - Backend/VAPS/apps/operations/submissions/services/snapshot.py:33-87 (build_division_snapshot → {schema_version=1, roster, rows}; JSON-safe: uuid→str, date→ISO; штат/имя/вакансии снапшот НЕ несёт)
  - Backend/VAPS/apps/documents/generators/expense_docx.py:122-233 (generate_expense_docx(data) → bytes .docx (zip); python-docx lazy import; НИ timestamps, НИ ids, НИ random кодом не пишутся)
  - Backend/VAPS/apps/operations/submissions/services/document_release_service.py:198-250 (КАНОН-сборка входов выпуска: staff_map=CoreStaffingSelector.allocated_slots_on, division_names=CoreDivisionTreeSelector.divisions_map, derive+build+generate — зеркало для продюсера корпуса)
  - Backend/VAPS/apps/operations/submissions/tests/test_expense_formats_e2e.py:90-227 (снапшот→build_expense_document→derive-матрица оракул; ближайший якорь; сид Organization/DivisionType/Division/Rank/Employee/EmployeeStatus + build_division_snapshot)
  - Backend/VAPS/apps/documents/tests/test_expense_docx_generator.py:114-119 (docx-смоук: bytes/PK/reopenable — «2 смока» arch:633 УЖЕ есть), test_document_release.py:8-12 (почему .docx побайтово не диффать — python-docx mtime)
  - Backend/VAPS/Makefile:14-75 (цель schema = регенерация-in-place + drift-гвард test_schema_drift.py — ПРЕЦЕДЕНТ для golden-update; gate -m «not property and not concurrency and not slow»; test-full без -m; guard .venv + env-блок)
  - Backend/VAPS/pyproject.toml:51-60 (--strict-markers; markers = property/concurrency/slow — НЕТ golden; python_files=test_*.py → JSON/XML не собираются как тесты; testpaths=apps)
  - Backend/VAPS/conftest.py:14-16 (hypothesis-профили ci/full; НЕТ collection-хуков; «забытый маркер=ошибка коллекции» — аспирационно, не реализовано)
  - Backend/VAPS/apps/migration_legacy/ (donor_diff.py/strength_render.py/import_donor_slice/strength_report — ДОНОР-ПАРИТЕТ 1.6-1.8; зерно parallel-run = 6.9, НЕ 6.8; donor_slice.json = синтетический микро-срез, donor_baseline_sample.json = синтетический эталон)
---

# Story 6.8: Golden master 20–30 исторических дней

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a **разработчик**,
I want **замороженный корпус golden-кейсов расхода (`input.json` + `expected_values.json` + нормализованный `expected_document.xml`) за 20–30 исторических дней, воспроизводимый ЧИСТО из JSON без БД, плюс `make golden-update` для ревью-гейтового обновления эталона**,
so that **любая регрессия в расчёте (`derive_report`) или генерации (`build_expense_document`/`generate_expense_docx`) ловится диффабельно (числами и XML, не байтами), а эталон меняется только осознанно через просмотр `git diff`**.

## Acceptance Criteria

1. **Корпус golden-кейсов (формат и место).** Given каталог `apps/operations/submissions/tests/golden/`, Then он содержит **≥20 кейсов** (цель 20–30 бизнес-дат) `case_NNN/` (нумерация с ведущими нулями, сортируемая), каждый — РОВНО три текстовых файла в git без LFS: `input.json`, `expected_values.json`, `expected_document.xml`. `input.json` = `{"snapshot": {…schema_version:1, roster, rows…}, "business_date": "YYYY-MM-DD", "division_id": "<uuid>", "staff_map": {"<uuid>": <int>}, "division_names": {"<uuid>": "<name>"}}` — РОВНО пять входов `build_expense_document` (снапшот даёт два, три остальных — заморожены рядом; см. Ловушка №3). JSON сериализуется стабильно (`json.dumps(…, ensure_ascii=False, sort_keys=True, indent=2)` + финальный `\n`), кейсы разнообразны (разные бизнес-даты → разный расход: статусы стартуют/заканчиваются в окне, покрыты вакансии, ATTACHED, IN_SERVICE и ≥ большинства колонок `REPORT_COLUMNS`).

2. **Consumer-тест (регрессия), БЕЗ БД.** Given `apps/operations/submissions/tests/test_expense_golden.py`, Then он параметризован по `sorted(golden/case_*)` (обнаружение на этапе импорта), помечен `@pytest.mark.golden`, и **НЕ несёт `pytest.mark.django_db`** — ни одного обращения к ORM/БД (все входы заморожены в `input.json`). Для каждого кейса: (a) `derive_report(<входы>)`, сериализованный тем же кодом, что и продюсер, **== `expected_values.json`** (слой ЧИСЕЛ); (b) `normalize_document_xml(generate_expense_docx(build_expense_document(<входы>)))` **== `expected_document.xml`** (слой XML). Загрузчик `input.json` коэрцит `division_id` И ключи `staff_map`/`division_names` в `uuid.UUID` согласованно (Ловушка №3). `generate_expense_docx` импортируется из модуля `apps.documents.generators.expense_docx` напрямую.

3. **Регрессия кусается.** Given локальное изменение `derive_report` ИЛИ `build_expense_document` ИЛИ `generate_expense_docx`, которое меняет вывод (например, инверсия колонки, сдвиг числа, правка подписи), When `make test-full`, Then ≥1 golden-кейс КРАСНЫЙ с диффом (число в `expected_values` ИЛИ фрагмент нормализованного XML). Дев подтверждает укус: временная мутация → красный → откат (зафиксировать в Dev Agent Record). Корпус на неизменном коде — зелёный.

4. **Обновление эталона — только ревью-гейтом.** Given `make golden-update` (опц. `CASE=NNN`), Then он регенерирует `expected_values.json` + `expected_document.xml` **на месте** из закоммиченного `input.json` (ЧИСТО, БЕЗ БД — те же чистые функции, что и consumer), НЕ трогая `input.json`, и печатает напоминание просмотреть `git diff` перед коммитом. Никакого молчаливого авто-принятия: эталон меняет ЧЕЛОВЕК, читая diff (зеркало прецедента `make schema` + `test_schema_drift.py`, Makefile:14-26).

5. **Детерминизм нормализации.** Given `expected_document.xml`, Then это `word/document.xml`, извлечённый из .docx-zip, с вырезанными атрибутами `w:rsid*` (regex `\s+w:rsid\w+="[0-9A-Fa-f]+"` → ``; сегодня их РОВНО 3, все в `<w:sectPr>` шаблона) и канонизированный C14N (`lxml.etree.canonicalize`). Given два прогона `generate_expense_docx` на одном входе, Then нормализованные XML побайтово идентичны (эмпирически подтверждено, python-docx закреплён `>=1.2,<2`). Timestamps живут в `docProps/core.xml` (НЕ в `document.xml`) → вне сравнения. Полный .docx побайтово НЕ диффать (zip-mtime/core.xml волатильны — `test_document_release.py:8-12`).

6. **Гейт, маркер, границы.** `make gate` зелёный (golden ИСКЛЮЧЁН из gate: `-m "not property and not concurrency and not slow and not golden"`); `make test-full` зелёный, включая полный golden-корпус (2 пред-существующих teardown-ERROR в `test_document_sequence_concurrency` — НЕ регрессия, DoD-бар корпуса = test-full). `makemigrations --check` чист — 6.8 НЕ трогает модели/миграции. `ruff check` чист; `ruff format` ТОЧЕЧНО по изменённым `.py` (урок 6.1). `test_rbac_matrix` и `test_audit_coverage` (обе facet) зелёные БЕЗ правок матриц — 6.8 не вводит эндпоинтов/мутаций/новых кодов реестров. Арх-гвард `operations ↛ core.models` соблюдён: поддерживаемый код (consumer + `golden_update`) НЕ импортирует `apps.core.models` — работает ЧИСТО из JSON (Ловушка №7).

## Tasks / Subtasks

- [x] Task 1: Нормализатор document.xml (AC: 2, 5)
  - [x] Создать `apps/documents/generators/docx_normalize.py`: `normalize_document_xml(docx_bytes: bytes) -> bytes` — `zipfile.ZipFile(io.BytesIO(docx_bytes)).read("word/document.xml")` → `re.sub(rb'\s+w:rsid\w+="[0-9A-Fa-f]+"', b"", xml)` → `lxml.etree.canonicalize(xml_data=xml.decode("utf-8")).encode("utf-8")`. Никакого wall-clock/ORM. НЕ добавлять в `generators/__init__.py` re-export (держать импорт узким).
  - [x] Юнит-тест нормализатора (в `apps/documents/tests/test_docx_normalize.py`, unmarked → бежит в gate): идемпотентность (`normalize(x) == normalize(normalize_source_twice)`), вырезание `w:rsid*` (после — 0 вхождений `w:rsid`), детерминизм 2× на одном входе.
- [x] Task 2: Сериализатор эталона чисел — ОДИН источник правды (AC: 2, 4)
  - [x] Функция сериализации `StrengthReportResult` → JSON-словарь: `{business_date, rows:[{division_id(str), name, staff_total, list_total, vacancies, columns:{11 ключей REPORT_COLUMNS кроме ATTACHED}, attached}], totals:{…}, violations:[…], warnings:[…]}`. Разместить так, чтобы её импортировали И consumer, И `golden_update` (например, рядом с `golden_update` или в маленьком общем модуле `tests/golden/_serialize.py` — НЕ дублировать, дрейф сериализации = ложный дифф). Загрузчик `input.json`: `date.fromisoformat(business_date)`, `uuid.UUID(division_id)`, ключи `staff_map`/`division_names` → `uuid.UUID` (Ловушка №3); `date_start`/`date_end` строк снапшота ОСТАЮТСЯ ISO (билдер парсит сам, `expense_document.py:66-67`).
- [x] Task 3: Продюсер корпуса (одноразовый спайк) → закоммиченные `case_NNN/` (AC: 1, 3)
  - [x] Одноразовый сид-скрипт (в `spikes/golden-seed/`, НЕ app-код — арх-гвард: сид пишет `apps.core.models` Employee/Division/EmployeeStatus, в спайке легально, в `operations`-app нельзя). Зеркало сида `test_expense_formats_e2e.py:53-199`, масштабированное: реалистичное подразделение (по умолчанию 1, при желании дерево) + ~30–60 сотрудников со статусами, покрывающими 20–30 последовательных бизнес-дат. Для каждой даты `D`: `build_division_snapshot(div, D)` + `staff_map=CoreStaffingSelector.allocated_slots_on(...)` + `division_names=CoreDivisionTreeSelector.divisions_map([div])` → записать `input.json`; затем через функции Task 1/2 записать `expected_values.json` + `expected_document.xml`. **Провенанс по умолчанию — синтетика (донор-образная), Q2.**
  - [x] Закоммитить `apps/operations/submissions/tests/golden/case_001…case_0NN/` (≥20). Проверить разнообразие: не все колонки нулевые, есть вакансии/ATTACHED/IN_SERVICE, числа меняются день-в-день.
- [x] Task 4: `golden_update` management-команда + `make golden-update` (AC: 4)
  - [x] `apps/operations/submissions/management/commands/golden_update.py`: аргумент `--case NNN` (опц.). Для каждого кейса: перечитать `input.json` → регенерировать `expected_values.json` + `expected_document.xml` НА МЕСТЕ (импорт `build_expense_document`/`derive_report`/`generate_expense_docx`/`normalize_document_xml` + сериализатор Task 2). БЕЗ БД, БЕЗ `apps.core.models`. В конце stdout: «review the diff before committing: git diff -- apps/operations/submissions/tests/golden».
  - [x] `Backend/VAPS/Makefile`: добавить `golden-update` в `.PHONY`; цель зеркалит guard `.venv` цели `schema` (БЕЗ postgres env-блока — чистая регенерация): `$(PYTHON) manage.py golden_update $(if $(CASE),--case $(CASE),)` + echo-напоминание про diff.
- [x] Task 5: Consumer-тест + маркер (AC: 2, 6)
  - [x] `apps/operations/submissions/tests/test_expense_golden.py`: `@pytest.mark.golden`, БЕЗ `django_db`; `_CASES = sorted((Path(__file__).parent / "golden").glob("case_*"))`; `@pytest.mark.parametrize("case", _CASES, ids=[c.name for c in _CASES])`; загрузка через Task 2, сравнение AC-2(a)+(b). Guard-ассерт `len(_CASES) >= 20` (пустой glob не должен «зелёно проходить» вакуумно).
  - [x] `pyproject.toml:56-60`: добавить маркер `"golden: golden-master регрессия расхода (числа+нормализованный document.xml); только test-full"`.
  - [x] `Backend/VAPS/Makefile:68`: gate `-m "not property and not concurrency and not slow and not golden"`.
- [x] Task 6: Гейт, укус, границы (AC: 3, 6)
  - [x] `make gate` зелёный (golden исключён); `make test-full` зелёный (golden-корпус бежит и проходит).
  - [x] Укус AC-3: временная мутация в `derive_report`/билдере/генераторе → ≥1 golden красный → откат; зафиксировать в Dev Agent Record.
  - [x] `makemigrations --check` пуст; `ruff check` чист; `ruff format` точечно. git-сверка границ: `models.py`/миграции/эндпоинты/rbac-seed/`audit-events.yaml`/`error-codes.yaml` — НЕ тронуты; `test_rbac_matrix`/`test_audit_coverage`/арх-гвард `operations↛core.models` зелёные без правок.

## Dev Notes

### ⚠️ Ловушка №1 (ГЛАВНАЯ): эталон 6.8 = ВЫВОД САМОГО VAPS, замороженный — НЕ числа донора

6.8 — **саморефлексивный регресс-мастер**, а не паритет-с-донором. Доказательство из AC эпика (стр. 880): «изменение кода расчёта → расхождение с эталоном = **красный**». Это держится ТОЛЬКО если `эталон = прежний замороженный вывод VAPS`: поменял код расчёта — уехал от собственного эталона — красный. Если бы эталон был числами донора, движение кода К паритету давало бы зелёный, а не «красный». Значит `expected_values.json`/`expected_document.xml` = вывод `derive_report`/`generate_expense_docx` НА VAPS, замороженный. **Паритет VAPS-vs-донор** (классификатор timing/model/unclassified, `donor_diff.py`, ночная джоба) = **Story 6.9 «зерно parallel-run»**, НЕ 6.8. Двухслойность (NFR-8, arch:109): слой ЧИСЕЛ (`derive_report`) + слой XML (нормализованный `document.xml`). Слово «донора» в заголовке = провенанс ВХОДА (реалистичные дни), а не источник эталона.

### ⚠️ Ловушка №2: consumer БЕЗ БД — не `django_db`, не ORM; импорт `expense_docx` напрямую

`build_expense_document` (`expense_document.py:44`), `derive_report` (`strength_report.py:141`) и все генераторы — ЧИСТЫЕ (grep: ноль `objects.`/`.filter(`). Все core-производные данные (`staff_map` из `CoreStaffingSelector`, `division_names` из `CoreDivisionTreeSelector`) ЗАМОРОЖЕНЫ в `input.json` на этапе продюсера. Значит consumer грузит JSON → зовёт чистые функции → сравнивает: **ни `pytest.mark.django_db`, ни запросов**. (pytest-django всё равно поднимает Django — «DB-free» = без обращений к БД, не без `django.setup()`; подтверждено спайком.) Импорт `generate_expense_docx` из `apps.documents.generators.expense_docx` (модуль), а не из пакета: `generators/__init__.py:20-22` тянет `openpyxl`/`reportlab`/`fpdf2` (в `.[dev]` они есть — сбоя не будет, но связь лишняя).

### ⚠️ Ловушка №3: uuid-коэрция загрузчика — СОГЛАСОВАННО (division_id + ОБА словаря)

`build_expense_document` берёт `division_title = division_names.get(division_id)` и `staff_map[division_id]`, а `derive_report` ключует/сортирует по `division_id`. В `input.json` всё — строки. Если загрузчик коэрцит `division_id` в `uuid.UUID`, но ключи `staff_map`/`division_names` оставит строками (или наоборот) — `.get(uuid)` по str-ключам промахнётся → `division_title=""`, `staff_total=0` МОЛЧА (тесты зелёные, документ битый). Коэрцить ВСЕ ТРИ в `uuid.UUID` (зеркало продукции `document_release_service.py:214-217`, где всё — uuid). Спайк-факт: согласованный all-str ТОЖЕ работает, но uuid зеркалит прод-путь — берём uuid.

### ⚠️ Ловушка №4: нормализовать `word/document.xml`, НЕ байты .docx

.docx = zip; полные байты недетерминированы (zip-mtime членов, `docProps/core.xml` с `dcterms:created/modified` шаблона). Golden сравнивает извлечённый `word/document.xml`. Эмпирика (python-docx 1.2.0): весь .docx run-to-run УЖЕ побайтово идентичен; в `document.xml` РОВНО 3 `w:rsid*` — статические константы шаблона в `<w:sectPr>`, python-docx их не генерит на run. Всё равно вырезаем `w:rsid*` + C14N — страховка от патча/refresh шаблона python-docx (тогда 3 константы сместятся, а тело — нет). `dcterms/created/modified/proofState/rId/w:id/nsid` в `document.xml` — 0 вхождений (проверено).

### ⚠️ Ловушка №5: golden живёт в test-full, НЕ в gate — DoD требует ОБА

Канон (arch:633/638/639): golden — в `make test-full` («golden полный»), gate его НЕ содержит. Маркер `golden` → gate исключает (`-m … and not golden`), test-full без `-m` бежит всё. Следствие: `make gate` зелёный НЕ доказывает корпус — DoD 6.8 требует ЯВНО и `make gate`, и `make test-full` зелёными (корпус проверяется в test-full). Consumer быстр (БЕЗ БД, мс/кейс) — «slow» семантически неверен, поэтому отдельный маркер `golden`, а не `slow` (Q3).

### ⚠️ Ловушка №6: golden-update ревью-гейтовый — без авто-принятия

`make golden-update` регенерирует `expected_*` на месте и ОСТАНАВЛИВАЕТСЯ — решение «эталон изменился законно» принимает человек, читая `git diff` (arch:633 «обновление только make golden-update с ревью diff»). Прямой прецедент — `make schema` (регенерация-in-place) + `test_schema_drift.py` (регенерация-в-temp + байт-сравнение как дрифт-гвард, Makefile:14-26). НЕ городить авто-`golden-update` в тесте/хуке. (Опц. будущий дрифт-гвард golden — в test-full, где живёт корпус; в 6.8 не обязателен, т.к. consumer УЖЕ сравнивает committed vs regenerated покейсно.)

### ⚠️ Ловушка №7: арх-гвард `operations ↛ core.models` — поддерживаемый код ЧИСТ

Гвард (`test_isolation`/ARCH-003): app-код `operations` не импортирует `apps.core.models` напрямую (только через core-селекторы). Consumer + `golden_update` НЕ импортируют `core.models` вовсе — работают из `input.json` (core-данные уже заморожены). `golden_update` импортит `build_expense_document`(operations)/`derive_report`(operations)/`generate_expense_docx`+нормализатор(documents) — всё легально (`operations→documents` разрешено, `document_release_service.py:51` уже так делает). Сид-продюсер (Task 3) пишет `core.models` — поэтому он ОДНОРАЗОВЫЙ СПАЙК в `spikes/`, а НЕ management-команда в `operations` (иначе гвард красный). Если Bratan захочет постоянный сид-команду — её место `migration_legacy` (где импорт `core.models` для донора уже легитимен), не `operations`.

### ⚠️ Ловушка №8: корпус — стабильный текст в git, без LFS

`input.json`/`expected_values.json` — `json.dumps(ensure_ascii=False, sort_keys=True, indent=2)` + `\n`; `expected_document.xml` — нормализованный текст. Диффабельно, без LFS (в репо LFS нет; единственные бинарники — `generators/fonts/*.ttf`). `python_files=["test_*.py"]` (pyproject:53) → JSON/XML в `golden/` НЕ собираются как тесты; `__init__.py` в `golden/` НЕ нужен (это данные, не пакет).

### Эталоны — всё в кодовой базе, ничего не изобретать

- Сборка входов расхода (продюсер зеркалит): `document_release_service.py:198-250` — `staff_map=CoreStaffingSelector.allocated_slots_on(division_id, on_date)`, `division_names=CoreDivisionTreeSelector.divisions_map([division_id])`, `roster_ids=[m["employee_id"] for m in snapshot["roster"]]`, `derive_report(...)`, `build_expense_document(snapshot, business_date, staff_map=…, division_names=…, division_id=…)`, `generate_expense_docx(data)`.
- Оракул derive-матрицы + сид: `test_expense_formats_e2e.py:90-227` (`_expected_matrix` = независимый `derive_report`; `make_division/make_employee/make_status`; `build_division_snapshot(div, D)`).
- Снапшот-контракт: `snapshot.py:33-87` (`schema_version=1`, `roster:[{employee_id,full_name,rank}]` sorted, `rows:[{employee_id,status_type_code,status_id,date_start,date_end,source}]`; билдер читает только `employee_id/status_type_code/date_start/date_end`).
- Колонки: `strength_report.py:65-77` (`REPORT_COLUMNS` — 11; `ATTACHED` отдельно, `counts_in_staff=false`).
- docx-смоук «2 смока» (arch:633) УЖЕ есть: `test_expense_docx_generator.py:114-119` (PK/reopenable) — 6.8 их НЕ создаёт заново.
- Прецедент ревью-гейтовой регенерации: `Makefile:14-26` (`schema`) + `apps/core/tests/test_schema_drift.py:53-69`.
- Реестр-гигиена в gate (не трогаем, обязаны остаться зелёными): `test_audit_coverage.py`, `test_exception_handler.py` (загрузка `docs/registries/*.yaml`).

### Дефолты (приняты под #YOLO — поднять на ревью, если не согласен)

- **Д1 (ГЛАВНЫЙ, семантика):** эталон = вывод VAPS заморожен (регресс-мастер), два слоя числа+XML. Паритет-с-донором = 6.9. Альт «эталон=числа донора» отвергнут — противоречит AC «изменение кода → красный».
- **Д2 (провенанс/объём корпуса):** синтетика-богатая, детерминированно ~20–30 дней [ДЕФОЛТ]. Богаче всего покрывает колонки, строится СЕЙЧАС в репо. Альты: (B) донор-микро-срез `donor_slice.json` (~22 бизнес-даты в 2026-05-20…06-10, но 3 сотр./2 подр. — тонко), (C) полный реальный экспорт донора из контура (внешний `dumpdata`, отложен). См. Q2.
- **Д3 (input.json):** `{snapshot, business_date, division_id, staff_map, division_names}`; загрузчик коэрцит все uuid согласованно; снапшот-строки дат остаются ISO.
- **Д4 (expected_values.json):** сериализованный `StrengthReportResult` (rows/totals/violations/warnings). ОДИН сериализатор для consumer и update (анти-дрейф).
- **Д5 (нормализация):** извлечь `word/document.xml` + вырезать `w:rsid*` + C14N. Timestamps (`core.xml`) вне сравнения.
- **Д6 (маркер):** новый `golden` (pyproject) + правка gate `-m` [ДЕФОЛТ]. Альт «reuse `slow`» отвергнут — семантически неверно (golden быстрый). См. Q3.
- **Д7 (golden-update):** management-команда, ЧИСТАЯ/БЕЗ БД, регенерация-in-place из `input.json`, ревью через `git diff`. Без postgres env-блока в Makefile.
- **Д8 (продюсер):** одноразовый сид-спайк в `spikes/` (пишет `core.models` вне app — арх-гвард цел). Постоянная сид-команда, если понадобится, → `migration_legacy`.
- **Д9 (место):** `apps/operations/submissions/tests/golden/case_NNN/` (со-локация с билдером и всеми расход-тестами). Арх-путь `operations/reports/tests/golden/` (arch:633) УСТАРЕЛ — пакета `reports` нет; вариация задокументирована здесь.
- **Д10 (объём стори):** одна когезивная стори (регресс-корпус расхода). Файлов кода ~5 (нормализатор, сериализатор/загрузчик, команда, тест, Makefile+pyproject), данные (корпус) в счёт ответственности не идут. Дробить = over-decomposition (прецедент 5.6b). См. Q4 (сплит-опция).

### Границы (что 6.8 НЕ делает)

- **Паритет-с-донором**: ночная diff-джоба, классификатор timing/model/unclassified, счётчик зелёных дней, «донор неправ»-регламент → **6.9** (`donor_diff.py`/`strength_render.py`/`import_donor_slice`/`strength_report` — донор-инфра 1.6-1.8 уже есть). 6.8 сравнивает VAPS с СОБОЙ, не с донором.
- **Реальный 20–30-дневный экспорт донора из контура** → внешний артефакт (`manage.py dumpdata` против архивной донор-БД); в воркtree его НЕТ (только синтетические `donor_slice.json`/`donor_baseline_sample.json`). Дефолт-корпус = синтетика-в-репо; замена/добор реальными днями — пере-сид, когда экспорт доступен (стенд 7.0).
- **HTTP-поверхность** расхода (POST-выпуск, lookup по дате/периоду, `TOMORROW_BLOCKED`) → **6.10**.
- **xlsx/csv/pdf golden** → golden только docx (выпуск docx-only, 6.5-Д2); эквивалентность 4 форматов (числа) УЖЕ покрыта `test_expense_formats_e2e.py` — golden добавляет ЗАМОРОЗКУ для docx-XML + чисел.
- **`freeze-donor`/`parallel-run-diff` make-цели** → 6.9/E7.
- **Модели/миграции/эндпоинты/новые коды реестров** → нет (регресс-инфра поверх готового пайплайна).

### Previous Story Intelligence

- **6.7** (`document_release_service.py`) — «повторная выдача» = скачивание; выпуск docx-only. 6.8 НЕ трогает `issue_expense_document`/download/audit — читает пайплайн как ground truth для продюсера (сборка входов :198-250).
- **6.4** (`test_expense_formats_e2e.py`) — e2e «снапшот→build→4 формата==derive» + `_expected_matrix`; ближайший якорь, golden = его «замороженная» версия для docx (+ числа). PDF-байты недетерминированы (CreationDate) — урок «нормализуй, не диффай байты» распространяется на docx (mtime).
- **5.10** (property иммутабельность снапшота) — канон «канонический `json.dumps(sort_keys)` для байт-ассертов»; golden-JSON сериализуется так же (диффабельность).
- **Процессный цикл (память проекта):** коммит после ревью; `graphify update` — отдельным chore при значимом изменении app-кода documents/operations; baseline-SHA `9f0657d` в шапке; `ruff format` ТОЧЕЧНО по файлу; same-model-ревью caveat → fresh-context валидация по checklist.

### Git Intelligence

- HEAD `9f0657d` = 6.7 done; эпик 6 идёт «одна стори — один коммит» (`feat(story-6.N): …`). Коммит 6.8: `feat(story-6.8): Golden master 20–30 исторических дней`.
- Донор-инфра (`migration_legacy`) заложена в E1 (commit `4ce19dd`, стори 1.6-1.8) — НЕ переизобретать; 6.8 её НЕ использует (это 6.9).
- Корпус `golden/case_*/` (много файлов данных) — крупный, но текстовый и диффабельный; коммитить одним PR стори.

### Project Structure Notes

- Поддерживаемый код: `apps/documents/generators/docx_normalize.py` (нормализатор), `apps/operations/submissions/management/commands/golden_update.py` (команда), `apps/operations/submissions/tests/test_expense_golden.py` + `tests/golden/` (тест+корпус) + маленький общий сериализатор/загрузчик; `Makefile`/`pyproject.toml` (маркер+цель). Продюсер — `spikes/golden-seed/` (вне app).
- Арх-гвард `operations↛core.models`: consumer/`golden_update` НЕ импортируют core.models (Ловушка №7). Импорт `operations→documents`/`operations→statuses` легален.
- Модель не меняется → `makemigrations --check` обязан остаться пустым.
- `graphify update .` — по проектному правилу при значимом изменении app-кода (documents+operations); отдельным chore после ревью.

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Story-6.8 (стр. 874-880) — golden-кейсы input.json+expected_values.json+нормализованный document.xml; обновление только make golden-update с ревью diff]
- [Source: architecture.md:96 (NFR-8 числа+XML не байты), :109 (golden двухслойно), :629-643 (§Test Organization: golden в test-full, make golden-update ручной, кросс-субдомен operations/tests/), :291 (снапшот+schema_version), :302 (wall-clock только Clock)]
- [Source: Backend/VAPS/apps/operations/submissions/expense_document.py:44-162 — build_expense_document (чистая); statuses/services/strength_report.py:65-77,141-232 — derive_report + REPORT_COLUMNS]
- [Source: Backend/VAPS/apps/operations/submissions/services/snapshot.py:33-87 — build_division_snapshot / schema_version=1 / JSON-safe]
- [Source: Backend/VAPS/apps/operations/submissions/services/document_release_service.py:198-250 — канон-сборка staff_map/division_names/derive/build/generate]
- [Source: Backend/VAPS/apps/documents/generators/expense_docx.py:122-233 — generate_expense_docx → bytes; python-docx lazy; без timestamps/ids/random]
- [Source: Backend/VAPS/apps/operations/submissions/tests/test_expense_formats_e2e.py:90-227 — оракул derive + сид-паттерн]
- [Source: Backend/VAPS/apps/documents/tests/test_expense_docx_generator.py:114-119 — docx-смоук; test_document_release.py:8-12 — почему не диффать байты .docx]
- [Source: Backend/VAPS/Makefile:14-75 — цель schema (регенерация+drift) как прецедент golden-update; gate -m; guard .venv]
- [Source: Backend/VAPS/pyproject.toml:51-60 — маркеры/--strict-markers/python_files/testpaths; conftest.py:14-16 — hypothesis-профили ci/full]

### Latest Tech Information

- **Эмпирический спайк (create-story, 2026-07-09, python-docx 1.2.0, lxml)** — проведён до конца, ЗЕЛЁНЫЙ (артефакт: `scratchpad/golden-spike/golden_mechanism_spike.py`):
  - Полный DB-free пайплайн `input.json → load(uuid-coerce) → derive_report → build_expense_document → generate_expense_docx → normalize` воспроизводим: `expected_values` и нормализованный `document.xml` побайтово идентичны при повторном прогоне.
  - `division_title` корректен при uuid-ключах (`'Отдел Ф'`); мутация типов ключей (uuid id + str-ключи) → молчаливое `""`/0 (Ловушка №3).
  - Числа сходятся: staff=10 → list=5, vacancies=5, IN_SERVICE=3, VACATION=1, ON_DUTY=1, attached=1; Σcolumns=list_total.
  - `document.xml` run-to-run УЖЕ идентичен; ровно 3 `w:rsid*` в `<w:sectPr>` (константы шаблона); нормализация (strip `w:rsid*` + `lxml.etree.canonicalize`) стабильна и идемпотентна; `core.xml` несёт `dcterms` (вне сравнения).
- `hashlib`/`zipfile`/`re`/`json`/`uuid` — stdlib; `lxml` — транзитивная зависимость python-docx (есть). 6.8 НЕ вводит новых зависимостей. python-docx закреплён `>=1.2,<2` (pyproject) — бамп → пере-`golden-update` с ревью diff.

### Открытые вопросы (для Bratan — НЕ блокируют, приняты дефолты)

- **Q1 (ГЛАВНЫЙ, семантика):** эталон = вывод VAPS заморожен (регресс-мастер, Д1) — подтвердить, что 6.8 НЕ про паритет-с-донором (это 6.9). От этого зависит смысл `expected_values.json`.
- **Q2 (провенанс/объём корпуса):** синтетика-богатая ~20–30 дней [ДЕФОЛТ Д2] vs донор-микро-срез (~22, тонко) vs полный реальный экспорт из контура (внешний, отложен). Реальные 20–30 дней донора в воркtree отсутствуют.
- **Q3 (маркер):** новый `golden` + правка gate `-m` [ДЕФОЛТ Д6] vs reuse `slow` (0 правок Makefile/pyproject, но семантически неверно).
- **Q4 (объём стори):** одна когезивная 6.8 [ДЕФОЛТ Д10] vs сплит 6.8a (механизм: нормализатор+consumer+golden-update+2-3 сид-кейса) / 6.8b (масштаб корпуса до 20–30). AC написан как одна.

### Процессный гейт (AI-4 / AI-3, epic-5-retro)

- Fresh-context валидация по `checklist.md` ПОСЛЕ написания (same-model caveat) — проведена.
- `make gate` перед коммитом; корпус проверяется `make test-full` (2 пред-существующих teardown-ERROR `test_document_sequence_concurrency` — НЕ регрессия; DoD-бар корпуса = test-full).
- tz-флейк `test_vacancies_endpoint` (00:00–05:00) — не 6.8, не блокер. golden БЕЗ БД/wall-clock — tz-флейка не касается.
- 6.8 НЕ в cross-model-списке гейта AI-4 (там 6.3/6.5/6.9) — same-model ревью допустимо; fresh-context валидация проведена.

## Dev Agent Record

### Agent Model Used

claude-opus-4-8 (Opus 4.8), BMAD create-story, #YOLO

### Debug Log References

- **Укус AC-3 (bite verification).** Временная мутация `strength_report.derive_report` (`vacancies = max(0, staff_total - list_total) + 1`) → golden RED (1 failed на слое чисел: `dumps(expected_values(inputs)) != expected_values.json`); откат `git checkout` → golden GREEN (26 passed). Корпус реально кусает регрессию.
- **Round-trip корпуса.** Пересчёт из `input.json` всех 25 кейсов → 0 mismatch против записанных эталонов; 25/25 различных `expected_values` (вариативность); покрыты все 11 REPORT_COLUMNS + ATTACHED (в 11 кейсах) + IN_SERVICE (25) + вакансии.
- **make gate** = 2122 passed, 56 deselected (golden исключён), makemigrations «No changes detected», ruff чист, 46s. **make test-full** = 2178 passed (все 26 golden), 6 teardown-ERROR concurrency — ПРЕД-СУЩЕСТВУЮЩИЕ (тот же счёт 6 без golden: `-m "not golden"` → 2152 passed, 6 errors; append-only audit_logs × TransactionTestCase TRUNCATE; память фиксировала «2» — устарело, с тех пор добавлены concurrency-тесты 6.2/6.5/статусов). НЕ регрессия.

### Completion Notes List

- **Task 1 (нормализатор document.xml) — DONE.** `normalize_document_xml(docx_bytes)`: извлечь `word/document.xml` из zip → вырезать `w:rsid*` (`\s+w:rsid\w+="[0-9A-Fa-f]+"`) → `lxml.etree.canonicalize`. Узкий импорт (в `generators/__init__.py` НЕ добавлен). 4 юнит-теста (вырезание rsid, детерминизм 2×, идемпотентность C14N, два дока различаются только rsid→равны после нормализации), БЕЗ БД → бегут в gate. ruff чист (format точечно + ручной E501 в докстринге).
- **Task 2 (сериализатор/загрузчик — единый источник) — DONE.** `apps/operations/submissions/golden.py`: `load_input` (согласованная uuid-коэрция division_id + ключей staff_map/division_names, Ловушка №3), `serialize_report` (StrengthReportResult→dict), `expected_values` (слой чисел), `expected_document_xml` (слой XML), `dumps` (канонический json). ЧИСТ — без core.models (docstring-упоминание ≠ импорт). ОДИН код для consumer и golden_update (анти-дрейф). 4 DB-free теста на синтетич. снапшоте (uuid-коэрция, числа+сходимость, детерминизм XML, канон-dumps) → бегут в gate.
- **Task 3 (продюсер корпуса) — DONE.** `spikes/golden-seed/seed_golden_corpus.py` (одноразовый, вне app → легально пишет core.models, Ловушка №7): сид 1 подразделение + 40 сотрудников (по одному статус-интервалу, коды покрывают все колонки) в ОТКАТ-транзакции; для 25 дат `build_division_snapshot` + заморозка staff_map/division_names → `input.json` + эталоны через golden.py. 25 кейсов (75 файлов), БД чистая после отката. Провенанс = синтетика-богатая (Q2-дефолт; реальный донор = 6.9/контур).
- **Task 4 (golden_update + make golden-update) — DONE.** Management-команда `golden_update` (`--case NNN` опц.): регенерация expected_* на месте из input.json теми же чистыми функциями, БЕЗ БД, НЕ трогает input.json, печатает напоминание про `git diff`. Makefile-цель `golden-update` (guard .venv, без postgres-env-блока) + `.PHONY`. Проверено: `make golden-update` → 0 изменённых файлов (идемпотентно, эталон воспроизводится точно).
- **Task 5 (consumer + маркер) — DONE.** `test_expense_golden.py`: `@pytest.mark.golden`, БЕЗ django_db, параметризован по `sorted(golden/case_*)` (25) + guard `len≥20`; сравнивает (a) числа и (b) нормализованный XML. Маркер `golden` в pyproject; gate `-m "… and not golden"`. Проверено: `-m golden` → 26 passed; gate-фильтр → 26 deselected (исключён).
- **Task 6 (гейт, укус, границы) — DONE.** gate зелёный (golden исключён), test-full зелёный (golden включён, 6 teardown-ERROR пред-существующие). Укус подтверждён (Debug Log). Границы: НЕ тронуты models/миграции/эндпоинты/rbac-seed/audit-events/error-codes (git-сверка); `makemigrations --check` чист; арх-гвард operations↛core.models зелёный (golden.py/consumer/команда не импортируют core.models); test_rbac_matrix/test_audit_coverage зелёные без правок.

### File List

- `Backend/VAPS/apps/documents/generators/docx_normalize.py` (создан)
- `Backend/VAPS/apps/documents/tests/test_docx_normalize.py` (создан)
- `Backend/VAPS/apps/operations/submissions/golden.py` (создан — единый источник: load_input+uuid-коэрция, serialize_report, expected_values, expected_document_xml, dumps)
- `Backend/VAPS/apps/operations/submissions/tests/test_golden_serialize.py` (создан — 4 DB-free теста синтетич. снапшота)
- `Backend/VAPS/apps/operations/submissions/management/commands/golden_update.py` (создан — ревью-гейтовая регенерация эталона из input.json, без БД)
- `Backend/VAPS/apps/operations/submissions/tests/test_expense_golden.py` (создан — consumer: @pytest.mark.golden, БЕЗ БД, 25 кейсов + guard len≥20)
- `Backend/VAPS/apps/operations/submissions/tests/golden/case_001…case_025/` (создан — корпус 75 файлов: input.json + expected_values.json + expected_document.xml)
- `Backend/VAPS/Makefile` (изменён — цель `golden-update` + `.PHONY`; gate `-m … and not golden`)
- `Backend/VAPS/pyproject.toml` (изменён — маркер `golden`)
- `spikes/golden-seed/seed_golden_corpus.py` (создан — одноразовый продюсер корпуса, откат-транзакция, вне app)

## Senior Developer Review (AI)

**Дата:** 2026-07-09 · **Ревьюер:** bmad-code-review (Fable 5, same-model — 6.8 не в cross-model AI-4-списке; 3 слоя: Blind Hunter / Edge Case Hunter / Acceptance Auditor). **Исход: APPROVE.**

- **Acceptance Auditor: все 6 AC SATISFIED вживую** (≥20 кейсов×3 файла, стабильная сериализация, все 11 колонок покрыты; consumer БЕЗ БД 26 passed за 0.59s; укус подтверждён на ОБОИХ слоях — числа+XML → 25 failed → revert; golden-update идемпотентен и не трогает input.json; нормализация детерминирована; gate/границы/арх-гвард чисты). Dev Record без оверклейма.
- **Edge Case Hunter** опроверг спекуляции Blind вживую (детерминизм 0 mismatch, uuid-коэрция согласована, арх-гвард чист, парсинг дат симметричен) и подтвердил 4 периферийные находки (management-команда + byte-regex).
- **Триаж: 0 decision · 2 patch (применены+верифицированы) · 2 defer · dismiss остальное.**
  - **P1** (MED): `golden_update` на битом/пустом/отсутствующем `input.json` кидал сырое исключение и мог оставить кейс полу-обновлённым → try/except→`CommandError` с именем кейса + вычисление обоих эталонов ДО записи (verified: `{}`→`CommandError: … KeyError: 'snapshot'`, gate 2122).
  - **P2** (MED): `--case 5` молча не находил zero-padded `case_005` → нормализация числового аргумента `zfill(3)` (verified: `--case 5`→case_005).
  - **Defer:** (1) multi-division `input.json` не поддержан — `build_expense_document` single-division by contract (падает громко ValueError, не тихо); корпус single-division by construction → E6/E10 при необходимости. (2) byte-regex нормализатора теоретически мог бы задеть `w:rsid`-подобную подстроку в тексте — но regex предписан спекой AC-5, триггер для реальных ФИО невозможен; пересмотреть при эволюции шаблона.
  - **Dismiss:** newline-платформа (проект Linux-only); `rmtree` в спайке (корпус в git, one-off); спекуляции Blind, опровергнутые Edge/Auditor (nested-UUID findings плоские, детерминизм, Makefile-DB, arch-guard).

## Change Log

| Дата | Версия | Описание | Автор |
|------|--------|----------|-------|
| 2026-07-09 | 0.1 | Черновик стори (bmad-create-story, Opus 4.8, #YOLO) — golden-master расхода: регресс-корпус (input.json+expected_values.json+нормализованный document.xml, VAPS-self-frozen), consumer БЕЗ БД (маркер golden→test-full), make golden-update ревью-гейтовый; нормализация document.xml (strip w:rsid*+C14N) эмпирически подтверждена спайком; провенанс=синтетика-богатая (реальный донор=6.9/контур). Границы: паритет-донор=6.9, HTTP=6.10. Status → ready-for-dev | Bratan (BMAD create-story) |
| 2026-07-09 | 1.0 | Реализация (bmad-dev-story, ручной прогон, Fable 5) — нормализатор document.xml + golden.py (единый источник) + продюсер-спайк (25 кейсов/75 файлов) + golden_update/make golden-update + consumer (маркер golden) + маркер pyproject + gate-фильтр. gate 2122 passed / test-full 2178 passed (6 teardown-ERROR пред-существующие). Укус AC-3 подтверждён. Границы соблюдены (без моделей/миграций/эндпоинтов). Status → review | Bratan (BMAD dev-story) |
