---
baseline_commit: 4e1350b (feat(story-6.3): Генератор .docx; 6.1–6.3 done — контракт ExpenseDocumentData, generate_expense_docx, build_expense_document и venv с python-docx/openpyxl существуют)
context:
  - _bmad-output/planning-artifacts/epics.md (§Epic 6 Story 6.4 стр. 839-846; соседи 6.3/6.5 стр. 831-856; §Правила декомпозиции стр. 248-254)
  - _bmad-output/planning-artifacts/prds/prd-VAPS-2026-06-10/addendum.md §8 (стр. 92-99 — канон формата, единый для всех форматов)
  - _bmad-output/planning-artifacts/prds/prd-VAPS-2026-06-10/prd.md (FR-17 стр. 116 — «дополнительно .xlsx/.pdf/.csv»; SM-3 стр. 209)
  - _bmad-output/planning-artifacts/architecture.md (стр. 537-539 — documents владелец генераторов «docx/xlsx/pdf»; стр. 180/675 — OQ-5; стр. 585-596 — границы/AST)
  - _bmad-output/implementation-artifacts/6-3-генератор-docx-перенос-из-донора.md (предыдущая стори: контракт, паттерны, ревью-уроки)
  - Backend/VAPS/apps/documents/generators/expense_docx.py (ground truth контракта — вход ВСЕХ рендереров 6.4)
  - донор Backend/PersonnelStatus/Personnel-Records/organization_management/apps/reports/utils.py (объект сверки OQ-5)
---

# Story 6.4: Генераторы .xlsx/.csv/.pdf

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a **оператор**,
I want **те же данные в .xlsx/.csv и .pdf (FR-17: дополнительные форматы к первичному .docx)**,
so that **расход доступен в табличном виде и в нередактируемой форме; контракт XLSX сверяется с выводом донора (закрытие OQ-5)**.

## Acceptance Criteria

1. **Эквивалентность чисел (ГЛАВНЫЙ).** **Given** один `ExpenseDocumentData` (фикстура **≥2 строк** — иначе «порядок строк» вакуумен — с попарно различными числами из НЕПЕРЕСЕКАЮЩЕГОСЯ диапазона: уникальные трёхзначные, не встречающиеся в датах периодов членов, № строк и дате титула — иначе присутствие ≠ маппинг для PDF), **When** генерирую `.docx` (готовый 6.3), `.xlsx`, `.csv`, `.pdf`, **Then** каждое числовое значение (Штат/Список/Вакансии/12 колонок/строка ИТОГО; ATTACHED нормализуется «+N» → N) идентично во всех четырёх форматах поле-в-поле; порядок строк одинаков (рендереры НЕ пересортировывают). **And** e2e: **Given** снапшот сдачи (реальный `build_division_snapshot`, руками не лепить — урок 5.4b), **When** `build_expense_document` → все четыре генератора, **Then** числа каждого формата равны полям независимого `derive_report(...)` от тех же входов; исключения derive/билдера НЕ глотаются (STOP-семантика 6.3 не размывается). [Source: epics.md §Story 6.4 стр. 845; epic-5-retro урок №2 derive-only]
2. **Канон XLSX.** **Given** валидные данные, **When** `generate_expense_xlsx(data)`, **Then** результат `bytes`, открывается `load_workbook(BytesIO(...))`; РОВНО один лист, title = `business_date.isoformat()` (безопасен от запрещённых символов openpyxl — прецедент `strength_render`); первая строка — kk-титул `{division_title} ЖЕКЕ ҚҰРАМЫНЫҢ САПТЫҚ ТІЗІМІ {ДД.ММ.ГГГГ} ЖЫЛҒЫ` (merge по ширине таблицы, Times New Roman 16 bold); строка шапки = `_FIXED_HEAD + DOCX_COLUMN_LABELS[по DOCX_COLUMNS]` — литеральный дубль 17-колоночной шапки docx (12 bold TNR); строки: № с 1, безчленные числовые ячейки — **int** (числа как числа), статусные ячейки с членами — текст `«{count}\n{строки членов}»` (строки = тот же `_member_line`, cap `CELL_MAX_MEMBERS` + `… ещё {N}`, wrap_text); ATTACHED — `+N` (+ члены); строка ИТОГО — bold, зеркало docx (раскладка ИТОГО во ВСЕХ форматах: «№» — пусто, лейбл «ИТОГО» — в колонке «Управление», далее числа, ATTACHED — `+N`; expense_docx.py:212-229); page setup: `ws.page_setup.orientation = "landscape"` + `ws.page_setup.paperSize = ws.PAPERSIZE_A4` — константа живёт на **Worksheet**, не на PageSetup (`page_setup.paperSize = "A4"` → TypeError; проверено в venv). [Source: addendum §8 стр. 92-99; expense_docx.py:27-74, 212-229; 6.3 AC-1/2/4]
3. **CSV — числовая форма.** **Then** результат `bytes` в **utf-8-sig** (BOM `EF BB BF` — Excel-friendly); `csv.reader(..., delimiter=";")`: строка 1 — титул (одно поле), строка 2 — та же 17-колоночная шапка, далее строки данных, последняя — ИТОГО; раскладка data-строки зеркалит docx: «№» — int с 1, «Управление» — `row.name` (ЕДИНСТВЕННАЯ текстовая ячейка данных), далее Штат/Список/Вакансии и 12 статусных колонок — ТОЛЬКО count-числа (списки членов НЕ выгружаются — Д4), парсятся `int()`; ATTACHED — целое N **без** «+» (машиночитаемость); строка ИТОГО: «№» — пустое поле, «ИТОГО» — в колонке «Управление», далее числа (зеркало expense_docx.py:212-229, ATTACHED — int); терминатор строк CRLF. [Source: prd.md FR-17 стр. 116 «табличный вид»; Д4/Q4/Q6]
4. **PDF — офлайн, вендоренные шрифты kk.** **Then** результат `bytes` начинается `%PDF-`; `pypdf.PdfReader`: страница A4 landscape — mediabox `round(width)==842`, `round(height)==595` pt (fpdf2 даёт 841.89×595.28, ТОЧНЫЙ assert упадёт); `extract_text()` содержит kk-подстроки титула («ҚҰРАМЫНЫҢ», «ЖЫЛҒЫ»), лейблы шапки (probes по НОРМАЛИЗОВАННОМУ тексту — `\n`/пробелы убраны — или короткими фрагментами: «Учёба/соревнования/конференция» в узкой колонке переносится), все уникальные числа фикстуры отдельными токенами, `+N`, «ИТОГО», хвост усечения `… ещё {N}`; вёрстка кодом: титул 16 bold / шапка и числа 12 / члены 8 / ИТОГО bold / cap 20 (размеры — зона код-ревью, парсинг размеров из PDF не требуется); шрифт — вендоренный **Liberation Serif** Regular+Bold из `apps/documents/generators/fonts/` (SIL OFL 1.1, текст лицензии рядом), cmap-гвард тестом (fonttools) покрытия ВСЕХ kk/ru-символов канона; генерация офлайн: без сети, без subprocess, без LibreOffice — тяжёлой конверсии НЕТ, ветка «деферрал PDF с триггером» НЕ активируется (решение зафиксировано эмпирикой: fpdf2-рендер однострочного документа 34ms/25KB на create-story). [Source: epics.md §Story 6.4 стр. 846; Ловушка №4; Latest Tech]
5. **Реестр расхождений — закрытие OQ-5.** **Then** создан `docs/registries/expense-xlsx-donor-discrepancies.md`: фиксирует решение OQ-5 — **контракт ОТЧЁТА по addendum §8** (единый с .docx 6.3), не побайтовое зеркало донорского шаблона (шаблона `расход.xlsx` в репо физически НЕТ — сверка семантическая по коду `utils.py`); перечисляет РАСХОЖДЕНИЯ: заголовки в бинарном шаблоне vs в коде; 13 колонок донора без «№» и без BEFORE_DUTY/OTHER/PENDING, порядок «В строю ↔ Вакансии» обратен §8; две строки на управление (числа + отдельная строка ФИО, склейка «; ») vs одна ячейка «count + члены»; формат периода `дд.мм.ГГГГ - дд.мм.ГГГГ` и дежурства БЕЗ периода vs наш `_member_line` (en-dash, период у всех); суффиксы «, из/в {div}» у секондментов vs их отсутствие; «+N» у донора НЕТ (Прикомандирован — обычная колонка); строка «Басшылық» (руководство) у донора vs её отсутствие (однострочность Д11-6.3, свод — 6.5/6.10); агрегация MPTT-поддеревом на `datetime.now()` vs derive(снапшот) на `business_date`; и ПАРИТЕТЫ: предвычисленные значения без Excel-формул, VACATION+LEAVE_BY_REPORT в одну колонку, TRAINING+COMPETITION в одну, суммирование ИТОГО. CSV/PDF отмечены как форматы БЕЗ донорского прообраза (в доноре не существуют — проверено). [Source: epics.md стр. 845 «закрытие OQ-5»; architecture.md стр. 180/675; донор utils.py:41-465]
6. **Чистота и изоляция.** Все три генератора — чистые функции `ExpenseDocumentData -> bytes`: без ORM, без wall-clock в НАШЕМ коде, без сети, без записи на диск; единственное санкционированное файловое ЧТЕНИЕ — вендоренные TTF из ресурсов пакета (`Path(__file__).parent / "fonts"`); `openpyxl` и `fpdf` импортируются ЛЕНИВО внутри generate-функций (зеркало 6.3/strength_render; csv — stdlib, ленивость не требуется); AST-гвард `test_isolation.py` зелёный (rglob подхватит новые модули сам — НИ ОДНОГО импорта `apps.operations.*`); `expense_docx.py` и `expense_document.py` НЕ изменяются (git-сверка). [Source: expense_docx.py:145; test_isolation.py:23-25; architecture.md стр. 591]
7. **Гейт и анти-gold-plating.** `pyproject.toml` пополнен `fpdf2>=2.8,<3` (runtime, комментарий-обоснование house style — см. Task 1) и `pypdf>=5,<6` (dev — тестовый парсер PDF); `generators/__init__.py` реэкспортирует три новые функции; `make gate` зелёный (Postgres :5433 поднимает Makefile), `makemigrations --check` пуст (миграций в стори НЕТ); НЕТ правок API/urls/serializers/admin/settings/RBAC-матриц/audit-events.yaml (семя DOCUMENT_* посеяно в 6.3)/error-codes.yaml (DOCUMENT_GENERATION_FAILED уже есть)/schema.yaml (API не менялся); НИЧЕГО сверх секции «Границы». [Source: pyproject.toml:5-27; 6.3 AC-6; architecture.md §Enforcement]

## Tasks / Subtasks

- [x] **Task 1 — Зависимости (AC: 7)**
  - [x] `Backend/VAPS/pyproject.toml`: `fpdf2>=2.8,<3` в runtime deps с комментарием-обоснованием по образцу python-docx (стр. 22-26): донорского PDF-прообраза для расхода НЕТ (донор PDF расхода не генерирует — проверено); выбор fpdf2 2.8.7 (registry-снимок 2026-07-08): декларативный `table()` + `add_font(TTF)` для kk-глифов, эмпирически проверен на create-story; ЧЕСТНО отметить: LGPL-3.0 + тянет Pillow (C-extension), fonttools, defusedxml — wheels вендорятся в offline-зеркало контура (расширение прецедента Q2-6.3); альтернатива reportlab (донор пинит 4.5.1 в ДРУГОЙ подсистеме) отклонена — Д5/Q2
  - [x] `pypdf>=5,<6` в `[project.optional-dependencies].dev` (парсер PDF в тестах; BSD-3, pure-python, снимок 5.6.0)
  - [x] `.venv` worktree: `pip install -e '.[dev]'` (venv существует — ретро AI-2, НЕ пересоздавать)
- [x] **Task 2 — Вендоринг шрифтов + cmap-гвард (AC: 4)**
  - [x] `apps/documents/generators/fonts/`: `LiberationSerif-Regular.ttf`, `LiberationSerif-Bold.ttf` (копия из `/usr/share/fonts/truetype/liberation/` — пакет fonts-liberation2) + `LICENSE` (SIL OFL 1.1 — из `/usr/share/doc/fonts-liberation2/copyright` или канонический текст OFL)
  - [x] `apps/documents/tests/test_pdf_fonts.py` (чистый, без django_db): через `fontTools.ttLib.TTFont(...).getBestCmap()` — ОБА TTF покрывают каждый символ kk-титула («ЖЕКЕ ҚҰРАМЫНЫҢ САПТЫҚ ТІЗІМІ ЖЫЛҒЫ» + ӘӨҮІҺҒ-класс), всех значений `DOCX_COLUMN_LABELS`, `_FIXED_HEAD`, «ИТОГО», «… ещё», цифр и пунктуации `_member_line` («—», «–», «.», «+»); fonttools в venv — транзитив fpdf2, отдельная зависимость НЕ заводится
- [x] **Task 3 — XLSX-рендерер (AC: 1, 2, 6)**
  - [x] `apps/documents/generators/expense_xlsx.py`: `generate_expense_xlsx(data) -> bytes`; ленивые `from openpyxl import Workbook` / `from openpyxl.styles import Alignment, Font` ВНУТРИ функции; лист = ISO-дата; титул merged 16 bold TNR; шапка 12 bold; тело: № с 1, безчленные ячейки int, ячейки с членами — текст `count` + `_member_line`-строки через `\n` (cap + «… ещё N» — ТА ЖЕ логика усечения, что в docx; ВНИМАНИЕ: `fill_status_cell` — closure ВНУТРИ `generate_expense_docx`, импортировать НЕЛЬЗЯ — ~5 строк логики усечения продублировать), `Alignment(wrap_text=True, vertical="top")`; ATTACHED — `+N`; ИТОГО bold; `ws.page_setup.orientation = "landscape"` + `ws.page_setup.paperSize = ws.PAPERSIZE_A4` (инкантация AC-2); `wb.save(BytesIO)` → `.getvalue()`; docstring-нарратив по-русски (что канон §8, что рендерер НЕ делает — не считает, не сортирует, формулы не проверяет)
  - [x] Реэкспорт `generate_expense_xlsx` в `generators/__init__.py` (+ `__all__`)
  - [x] `apps/documents/tests/test_expense_xlsx_generator.py` (чистый; фикстуры-хелперы — КОПИЯ паттерна `test_expense_docx_generator.py:35-111`): bytes/round-trip `load_workbook`; ровно один лист, имя = ISO-дата; титул текст+16+bold; порядок шапки == литеральной 17-колоночной AC-2; значения ячеек; **int-тип** безчленных числовых ячеек; текст ячейки с членами (первая строка == `str(count)`); `+N`; ИТОГО значения+bold; усечение 21 → 20 + `… ещё 1`; page setup landscape/A4; порядок строк без пересортировки; TNR/размеры на титуле/шапке/ИТОГО
- [x] **Task 4 — CSV-рендерер (AC: 1, 3, 6)**
  - [x] `apps/documents/generators/expense_csv.py`: `generate_expense_csv(data) -> bytes`; stdlib `csv.writer` поверх `io.StringIO` (`delimiter=";"`, терминатор CRLF — дефолт writer'а) → `encode("utf-8-sig")`; строки: титул (одно поле), шапка 17, данные (раскладка AC-3: № int, `row.name` текстом, остальное — count-числа; ATTACHED — int без «+»), ИТОГО (№ пуст, лейбл в колонке «Управление»); docstring фиксирует диалект (Д4) и отличие от документных форм (члены/+N — прерогатива .docx/.xlsx/.pdf)
  - [x] Реэкспорт в `__init__.py`
  - [x] `apps/documents/tests/test_expense_csv_generator.py` (чистый): префикс BOM `b"\xef\xbb\xbf"`; parse `csv.reader(StringIO(raw.decode("utf-8-sig")), delimiter=";")`; титул первой строкой; шапка 17 == литералу; `row.name` в данных и «ИТОГО» в колонке «Управление» ПРИСУТСТВУЮТ (анти-C1: CSV без имён подразделений — дефект); числовые ячейки парсятся `int()`; ATTACHED без «+»; ИТОГО последней строкой; членских строк НЕТ нигде; CRLF в сырых байтах
- [x] **Task 5 — PDF-рендерер (AC: 1, 4, 6)**
  - [x] `apps/documents/generators/expense_pdf.py`: `generate_expense_pdf(data) -> bytes`; ленивый `from fpdf import FPDF` ВНУТРИ функции; `FPDF(orientation="landscape", format="A4")`; `add_font("Serif", style="", fname=<fonts>/LiberationSerif-Regular.ttf)` + `style="B"` → Bold (пути — `Path(__file__).resolve().parent / "fonts"`); титул 16 bold; `pdf.table(first_row_as_headings=True)`: шапка 12 bold (через `headings_style=FontFace(emphasis="BOLD")` либо `set_font(style="B")` перед строкой шапки), строки — числа 12, ячейка с членами — многострочный текст `count\nчлены` (строки — тот же `_member_line`; для 8pt членов — `set_font_size` при построении ячейки, эмпирика спайка), ATTACHED `+N`, ИТОГО — `set_font(style="B")` ПЕРЕД `table.row(...)` (приём спайка), 12 bold; cap 20 + `… ещё N`; `bytes(pdf.output())`; docstring: почему шрифт НЕ «Times New Roman» (Ловушка №4) и почему LibreOffice-путь отклонён
  - [x] Реэкспорт в `__init__.py`
  - [x] `apps/documents/tests/test_expense_pdf_generator.py` (чистый): `result[:5] == b"%PDF-"`; `PdfReader(BytesIO)` round-trip; mediabox `round()`==842×595 (landscape A4, Ловушка №9); `extract_text()`-probes ПО НОРМАЛИЗОВАННОМУ тексту (см. AC-4): kk-подстроки титула, лейблы шапки, уникальные числа фикстуры, `+N`, «ИТОГО», `… ещё 1` при 21 члене; пустые члены → только число; порядок строк (по позициям чисел в тексте — только если стабильно, иначе присутствие)
- [x] **Task 6 — Эквивалентность четырёх форматов + e2e от снапшота (AC: 1)**
  - [x] `apps/documents/tests/test_expense_formats_equivalence.py` (чистый): ОДНА фикстура **≥2 строк** с числами по AC-1 (уникальные трёхзначные ВНЕ диапазонов дат/№/титула; включая members-ячейку, пустую ячейку, ATTACHED>0) → `generate_expense_docx/xlsx/csv/pdf` → извлечение чисел (docx — таблица python-docx, для членских ячеек ПЕРВЫЙ ПАРАГРАФ ячейки — `cell.text` целиком несёт и даты членов; xlsx — openpyxl, для текст-ячеек первая строка; csv — reader; pdf — токены-числа из `extract_text` по нецифровым разделителям) → поле-в-поле равенство docx≡xlsx≡csv (позиционно, включая порядок строк) и pdf ⊇ те же числа как отдельные токены (нормализация `+N`→N); непересекающийся диапазон фикстуры делает presence == mapping для PDF (анти-C2: коллизия с фрагментом даты `01.07.2026`/№ строки маскирует пропажу числа)
  - [x] `apps/operations/submissions/tests/test_expense_formats_e2e.py` (`pytest.mark.django_db`, БЕЗ transaction=True — teardown-ловушка 6.2): данные с multi-код колонкой (STUDY+CONFERENCE → TRAINING), DUTY, VACATION, ATTACHED и парой без факта (зеркало e2e 6.3, фикстуры — копия `test_expense_document.py`); снапшот ТОЛЬКО `build_division_snapshot` → `build_expense_document` → все 4 генератора → числа каждого == полям независимого `derive_report`
- [x] **Task 7 — Реестр расхождений OQ-5 + гейт (AC: 5, 7)**
  - [x] `docs/registries/expense-xlsx-donor-discrepancies.md`: шапка-назначение (закрытие OQ-5, дата, стороны сверки: VAPS `generate_expense_xlsx` по addendum §8 vs донор `apps/reports/utils.py::generate_personnel_expense_report` со ссылками на строки), таблица «Расхождение | Донор | VAPS | Обоснование» по списку AC-5 + таблица паритетов + явная секция «CSV/PDF: донорского прообраза нет»; фиксация ответа на OQ-5: «контракт отчёта» (addendum §8), не «контракт миграции»
  - [x] `make gate` зелёный в worktree; `ruff format` — ТОЛЬКО по конкретным изменённым файлам (урок 6.1); File List сверить с `git status`/`git diff --stat` (ретро AI-3)
  - [x] Проверить глазами: НЕТ миграций, НЕТ правок urls/views/serializers/admin/settings/seed/schema.yaml/error-codes.yaml/audit-events.yaml; `expense_docx.py`/`expense_document.py` не тронуты

## Dev Notes

### ⚠️ Ловушка №1 (ГЛАВНАЯ): донорского прообраза почти нет — «сверка», а не «перенос»

Факт-чек донора (2026-07-08, research-агент по `Backend/PersonnelStatus/.../apps/reports/`):

- Донорский «Расход» умеет ТОЛЬКО XLSX и строится по бинарному шаблону `apps/reports/расход.xlsx`, которого в репозитории НЕТ (перепроверено: ни одного .xlsx во всём репо; тест донора `test_daily_expense.py:17-39` подменяет шаблон пустым Workbook через monkeypatch). Заголовки колонок, merge, ширины, шрифты и ориентация живут в отсутствующем шаблоне — из кода восстановима только СЕМАНТИКА (13 колонок, две строки на управление, «; »-склейка ФИО, «ИТОГО» = предвычисленные суммы, литералы «Басшылық»/«ИТОГО»).
- CSV и PDF версий расхода в доноре НЕ СУЩЕСТВУЕТ нигде (grep по reportlab/fpdf/weasyprint/csv: PDF — только `infrastructure/generators/pdf_generator.py` из ДРУГОЙ подсистемы «обобщённых отчётов» с другим 12-колоночным контрактом; CSV — только заглушки-`pass` в employees). Единственный эндпоинт расхода отдаёт XLSX без выбора формата.
- Следствие: AC эпика «контракт XLSX сверяется с выводом донора» исполняется как СЕМАНТИЧЕСКАЯ сверка кода `utils.py:41-465` + документирование расхождений в реестре (AC-5). НЕ искать шаблон, НЕ копировать `XLSXGenerator` (не тот отчёт), НЕ переносить «две строки на управление» (наш канон — ячейка §8).

### ⚠️ Ловушка №2: асимметрия контракта — ATTACHED и IN_SERVICE

`ExpenseRow.cells` НЕ содержит ключа `ATTACHED` — прикомандированные живут отдельным полем `row.attached: ExpenseCell` (и `totals.attached: int` отдельно от `totals.columns`). Итерируя `DOCX_COLUMNS`, рендерер обязан special-case'ить `"ATTACHED"` → `row.attached` с рендером `+N` — точно как `generate_expense_docx` (expense_docx.py:208-210). `IN_SERVICE` — count заполнен, `members` всегда пуст (билдер их сознательно не собирает). Забыть special-case = KeyError на первом же документе.

### ⚠️ Ловушка №3: изоляция и внутрипакетный реюз приватных хелперов

AST-гвард (`apps/documents/tests/test_isolation.py:23-25`, rglob c исключением tests) подхватит три новых модуля сам — импорт `apps.operations.*` из них запрещён; вход только `ExpenseDocumentData`. Формат строки члена, фиксированная шапка, лейбл ИТОГО и формат даты УЖЕ существуют в `expense_docx.py` как модульно-приватные (`_member_line`, `_FIXED_HEAD`, `_TOTALS_LABEL`, `_DATE_FORMAT`). Sibling-модули пакета импортируют их КАК ЕСТЬ (Д7): пакет — единица инкапсуляции, а дубль формата = гарантированный дрейф строк между форматами (расхождение, которое AC-1 не поймает — он про числа). ВАЖНО: `fill_status_cell` (:163-175) — closure ВНУТРИ `generate_expense_docx`, импортировать НЕВОЗМОЖНО — импортируемы РОВНО четыре имени выше; логика усечения (~5 строк: `shown = members[:CELL_MAX_MEMBERS]`, хвост `… ещё {hidden}` при `hidden > 0`) дублируется в каждом рендерере. `expense_docx.py` при этом НЕ редактировать (промоут в публичные имена — осознанным рефактором вне 6.4, чтобы 6.3-код остался нетронутым перед golden 6.8).

### ⚠️ Ловушка №4: kk-глифы в PDF — только вендоренный TTF; «Times New Roman» невендорим

Core-шрифты fpdf2 — latin-1: любой kk/ru-текст без `add_font(TTF)` упадёт или выйдет мусором. Times New Roman — проприетарный шрифт Microsoft, класть его .ttf в репо НЕЛЬЗЯ. Канон-компромисс (Д6): **Liberation Serif** (SIL OFL 1.1) — метрический аналог TNR (стандартная подмена fontconfig), полное покрытие kk-глифов ҚҰҢҒӘӨҮІҺ + ru ПРОВЕРЕНО эмпирически fontTools'ом на create-story (Regular и Bold, 2026-07-08); DejaVu Serif — задокументированный fallback (покрытие тоже полное, но метрики не TNR). Т.е. PDF-документ физически набран НЕ «Times New Roman» — честно фиксируется в docstring (и это НЕ донорское расхождение — донор PDF не делает). Констату `FONT_NAME` из expense_docx к PDF НЕ применять. Курсив/иные начертания не нужны — вендорим ровно Regular+Bold.

### ⚠️ Ловушка №5: XLSX-ячейка с членами — текст, безчленные — int

Канон §8 «ячейка = количество + список» в XLSX означает: ячейка с членами — ТЕКСТ (`"{count}\n{члены}"` c wrap_text), и её значение перестаёт быть числом. Числами (int) обязаны остаться: №, Штат, Список, Вакансии и статусные ячейки БЕЗ членов (в т.ч. В строю). Тест эквивалентности парсит текст-ячейку по первой строке. Двухстрочный донорский вариант (числа отдельно, ФИО отдельной строкой) СОЗНАТЕЛЬНО не воспроизводится (канон §8 выигрывает; расхождение — в реестр, Q5). Имя листа — ISO-дата: свободна от запрещённых openpyxl символов `/\?*[]:` (прецедент `strength_render.build_workbook` docstring).

### ⚠️ Ловушка №6: PDF-байты недетерминированы — тесты парсят, не диффают

fpdf2 проставляет `/CreationDate` из wall-clock ВНУТРИ библиотеки — два вызова дают разные байты. Побайтовое сравнение PDF — НЕ тестовая техника этой стори (и golden 6.8 для PDF будет решать это отдельно). Правило чистоты AC-6 — про НАШ код (он wall-clock не читает; business_date — из контракта); метаданные библиотеки — допустимая честная информация (Д8): повторная выдача 6.7 читает СОХРАНЁННЫЕ байты, не регенерирует.

### ⚠️ Ловушка №7: pypdf extract_text — probes подстроками, не полной фразой

Экстракция текста может вставлять переносы внутри длинных строк — И титула, И лейблов шапки (узкие колонки таблицы переносят «Учёба/соревнования/конференция» гарантированно). Пробы в тестах — по НОРМАЛИЗОВАННОМУ тексту (`"".join(text.split())` или замена `\n` → «») либо короткими устойчивыми подстроками («ҚҰРАМЫНЫҢ», «ИТОГО», отдельные числа-токены). Эмпирика спайка: kk-текст, даты `01.07.2026` и лейблы извлекаются корректно (fpdf2 2.8.7 + pypdf 5.6.0).

### ⚠️ Ловушка №8: где какие тесты бегут

- Тесты рендереров, шрифтов и эквивалентности — ЧИСТЫЕ (без django_db): datacls-вход → bytes → парсер. Бегут в gate.
- e2e от снапшота — `django_db` обычный, НИ ОДНОГО `transaction=True` (teardown-ловушка 6.2). Property/concurrency-маркеры НЕ нужны.
- Гейт-база после 6.3 (два ревью-прохода): **2023 passed, 29 deselected, ~39-50s**. Прирост 6.4 — только свои тесты, ноль регрессий.

### ⚠️ Ловушка №9: fpdf2 API — эмпирика create-story (2026-07-08, чистый venv, fpdf2==2.8.7)

- `FPDF(orientation="landscape", format="A4")` → страница ~841.89×595.28 pt сразу (ручного свопа, как в python-docx, НЕ нужно); в ассертах — `round()` (точное 842/595 упадёт).
- `pdf.output()` возвращает `bytearray` → оборачивать `bytes(...)`.
- `add_font(family, style, fname)` вызывать ДО `set_font`; отдельно для `""` (Regular) и `"B"` (Bold); параметр `uni` устарел и не нужен.
- `pdf.table(first_row_as_headings=True)` — context manager; многострочная ячейка — `\n` в тексте; смена размера шрифта посреди строки таблицы — `set_font_size(...)` перед `row.cell(...)` (проверено); bold строки — `set_font(style="B")` ПЕРЕД `table.row(...)` (приём спайка для ИТОГО; для шапки альтернатива — `headings_style=FontFace(emphasis="BOLD")`, `from fpdf.fonts import FontFace`); заголовок автоповторяется при разрыве страницы.
- Рендер однострочного документа: 34ms, 25KB — синхронная генерация; формальные замеры на реалистичном объёме (свод) — зона 6.6, этот факт её НЕ закрывает.

### ⚠️ Ловушка №10: шрифты — данные пакета, wheel не собирается

Путь к TTF — `Path(__file__).resolve().parent / "fonts" / ...`. Проект ставится editable (`pip install -e`), в контур едет копией дерева — package-data/MANIFEST не настраиваются (их нет и для существующих ресурсов). Если когда-то появится wheel-сборка — package-data станет задачей ТОЙ стори; здесь достаточно смок-теста, что генерация PDF работает из чистого venv.

### Эталоны — всё уже в кодовой базе, ничего не изобретать

| Что | Откуда копировать паттерн |
|---|---|
| Контракт входа + канон вёрстки + special-case ATTACHED + усечение cap 20 | `apps/documents/generators/expense_docx.py` — ПРЯМОЙ прообраз всех трёх рендереров |
| openpyxl-механика (ленивый импорт, лист-на-дату, append строк) | `apps/migration_legacy/strength_render.py:151-193` `build_workbook` (но 6.4 отдаёт bytes, не Workbook, и несёт стили) |
| Тест-паттерн рендерера (фикстуры `_col/_member/_cells/_totals/_data`, `_generated`) | `apps/documents/tests/test_expense_docx_generator.py:35-111` |
| Фикстуры e2e от снапшота (objects.create + build_division_snapshot) | `apps/operations/submissions/tests/test_expense_document.py` |
| Комментарий-обоснование зависимости | `Backend/VAPS/pyproject.toml:9-13` (openpyxl) и `:22-26` (python-docx) |
| Семантика донора для реестра расхождений | донор `apps/reports/utils.py:41-465` (две строки/«; »/периоды/«Басшылық»/ИТОГО) |
| Русские docstring-нарративы | `apps/documents/services.py`, `expense_docx.py` |

### Дефолты (приняты мной — поднять на ревью, если не согласен)

- **Д1. Размещение**: три модуля — `apps/documents/generators/expense_{xlsx,csv,pdf}.py` (канон architecture стр. 537-539: documents — владелец генераторов «docx/xlsx/pdf»); шрифты — `generators/fonts/`. Билдер НЕ трогается: вход всех рендереров — `ExpenseDocumentData` (в этом и была цель контракта 6.3).
- **Д2. Закрытие OQ-5**: «XLSX golden master — контракт миграции или отчёта?» → **контракт ОТЧЁТА** по addendum §8, единый с .docx; сверка с донором — семантическая (шаблона нет физически), расхождения — реестром (AC-5). Побайтовая сверка с донорским XLSX невозможна и не нужна.
- **Д3. XLSX = документная форма**: полное зеркало docx-канона (титул/17 колонок/ячейка count+члены/ИТОГО bold/TNR-имена 16/12/8/landscape print setup); bytes через `wb.save(BytesIO)`.
- **Д4. CSV = числовая форма**: титул + шапка + числа + ИТОГО; БЕЗ списков членов (машиночитаемая таблица; члены — в документных формах); ATTACHED — int без «+»; utf-8-sig + `;` + CRLF (Excel ru-локали открывает двойным кликом). Q4/Q6.
- **Д5. PDF — нативный рендер fpdf2**, НЕ конверсия .docx: LibreOffice headless (тяжёлая системная зависимость в air-gap) отклонён без замера — замер нужен ТОЛЬКО если тяжёлая зависимость требуется, а она не требуется (эмпирика Ловушки №9); ветка AC эпика «явный деферрал PDF» не активируется. reportlab — жизнеспособная альтернатива (BSD; донор пинит 4.5.1 в другой подсистеме), отклонена за императивный API и отсутствие эмпирики; Q2.
- **Д6. Шрифт PDF — Liberation Serif** Regular+Bold (OFL, метрика TNR, полное kk-покрытие — эмпирика); DejaVu Serif — fallback. Вендорится с текстом лицензии. Q3.
- **Д7. Внутрипакетный импорт приватных хелперов** `_member_line`/`_FIXED_HEAD`/`_TOTALS_LABEL`/`_DATE_FORMAT` из `expense_docx` — осознанный (Ловушка №3); `expense_docx.py` не редактируется.
- **Д8. CreationDate PDF — дефолт fpdf2** (wall-clock метаданные библиотеки): честная информация о моменте генерации; на числа и AC не влияет; байтовая идентичность повторной выдачи (6.7) обеспечивается хранением файла, не детерминизмом генерации.
- **Д9. «Details»-лист XLSX из выжимки ТЗ** (extract-master-spec стр. 320 «XLSX has separate Details sheet») НЕ реализуется: addendum §8 выигрывает по иерархии §3 — зеркало отказов Q7-6.3. Явный отказ, не молчаливый.
- **Д10. Эквивалентность в тесте**: docx≡xlsx≡csv — позиционное сравнение чисел; PDF — по множеству уникальных чисел фикстуры из extract_text (позиционный парсинг PDF хрупок); нормализация `+N`→N.
- **Д11. Однострочность** унаследована от 6.3-Д11: рендереры row-агностичны (рисуют сколько строк дали), многострочный свод — зона 6.5/6.10; в тестах допускаются multi-row фикстуры (рендереры это уже умеют by construction).
- **Д12. Одна стори, шесть нон-тест файлов** (3 модуля + `__init__` + pyproject + реестр = 6 > лимита 5) + 3 файла-ассета шрифтов: отступление от буквы правила «≤5 файлов» зафиксировано ЧЕСТНО (прецедент Д2/Q5-6.3); обоснование — три рендерера над ОДНИМ контрактом с ОБЩИМ тестом эквивалентности (AC-1 тестируем только при совместной поставке); ассеты-шрифты — бинарные данные, не код (дух правила №1 о boilerplate). Альтернатива — сплит 6.4a (xlsx+csv) / 6.4b (pdf+шрифты) — Q1, ГЛАВНЫЙ.

### Что уже есть (НЕ переизобретать)

- `ExpenseDocumentData` и весь контракт — реэкспортированы из `apps.documents.generators` (6.3); рендереры 6.4 НЕ определяют своих датаклассов и НЕ меняют контракт.
- `openpyxl 3.1.5` УЖЕ в pyproject (`>=3,<4`, стори 1.8) и в venv — xlsx-путь БЕЗ новой зависимости; донор пинит ту же 3.1.5 (паритет).
- MIME whitelist `VAPS_ATTACHMENT_CONTENT_TYPES` УЖЕ несёт xlsx/pdf/csv (`config/settings.py:230-231`, стори 6.1) — settings НЕ трогать, 6.5 готово.
- `audit-events.yaml`: DOCUMENT_GENERATED/ISSUED/SUPERSEDED посеяны в 6.3 — НЕ дописывать, эмиссий в 6.4 НЕТ. `error-codes.yaml`: DOCUMENT_GENERATION_FAILED существует — НЕ трогать (маппинг — зона 6.5/API).
- `strength_render.py` — только копировать паттерн, НЕ импортировать (migration_legacy удаляется после cutover).
- Grep-факт: `expense_xlsx`, `expense_csv`, `expense_pdf`, `fpdf`, `reportlab`, `weasyprint` в кодовой базе НЕ встречаются; .ttf/.otf в репо НЕТ — greenfield, коллизий нет.

### Границы (что 6.4 НЕ делает)

- **Выпуск/финализация** (Attachment + sha256 + номер + «взамен», рантайм-ассерт формул, проброс violations/warnings — дефер ревью 6.3 в deferred-work.md:545-549) → **6.5**. Рендереры 6.4, как и docx, формулы НЕ проверяют и violations НЕ видят (их нет в контракте).
- **Замеры и AsyncJob** → 6.6 (эмпирика 34ms — факт спайка, НЕ закрытие 6.6). **Скачивание/аудит** → 6.7. **Golden master** → 6.8 (никаких golden-каталогов и make golden-update здесь). **Parallel-run diff-реестр ДАННЫХ** → 6.9 (реестр 6.4 — про ФОРМАТ, это разные артефакты). **Период/«на завтра»** → 6.10.
- **HTTP-поверхности НЕТ**: ни view, ни urls, ни permission-кодов, ни RBAC/AUDIT-матриц, ни schema regen. **Миграций НЕТ. Admin не трогается. Снапшот-схема не бампается. Билдер и expense_docx.py не изменяются.**
- **Details-лист XLSX, нумерация членов, маркер осн.-док., сокращения ФИО** (выжимка ТЗ §77) — сознательные отказы (Д9, зеркало Q7-6.3).
- Ширины колонок XLSX/PDF — по усмотрению разработчика (читаемость), НЕ предмет AC и тестов.

### Previous Story Intelligence (6.3, два ревью-прохода 2026-07-08)

- 6.3 done: CROSS-MODEL ревью (Opus 4.8 vs dev Fable 5), 0 CRITICAL/HIGH; гейт-база **2023 passed, 29 deselected**. Ревью-гейт ретро AI-4 покрывает 6.3/**6.5**/6.9 — 6.4 в списке обязательного cross-model НЕТ (same-model допустимо; донор-перенос здесь минимален).
- Ревью-патч 6.3 (тай-брейк периода члена по `(date_start, date_end)`) — уже в билдере; рендереры периоды не вычисляют, только печатают готовые.
- Dev-урок 6.3: правки в TDD пришлись на ТЕСТЫ, не код (twips-round-trip габаритов) — для xlsx/pdf аналогично закладывать допуски парсеров (напр., int-тип ячеек openpyxl, probes pypdf), а не точные бинарные сверки.
- Ретро AI-2: venv живёт в `Backend/VAPS/.venv` worktree — НЕ пересоздавать. Урок 6.1: `ruff format` — только по изменённым файлам. Ретро AI-3: File List сверять с git-диффом.

### Git Intelligence

- Baseline: `4e1350b` — feat(story-6.3). Паттерн коммитов: `feat(story-N.N): <название>`, коммит после ревью.
- Ветка worktree: `claude/exciting-vaughan-3e478b`; основная — `main`.
- `_bmad-output/story-automator/orchestration-*.md` в статусе M — артефакт автоматора, не трогать.

### Project Structure Notes

- Нон-тест файлов 6: `expense_xlsx.py` (N), `expense_csv.py` (N), `expense_pdf.py` (N), `generators/__init__.py` (M), `pyproject.toml` (M), `docs/registries/expense-xlsx-donor-discrepancies.md` (N) — превышение буквы «≤5» на 1, честно поднято (Д12/Q1). Ассеты: `generators/fonts/{LiberationSerif-Regular.ttf, LiberationSerif-Bold.ttf, LICENSE}` — бинарные данные пакета. Тестовых файлов 6 (новых) — вне лимита (правило №4).
- `generators/` — обычный python-пакет (НЕ Django app); тесты — в app, чей код проверяют: рендереры/шрифты/эквивалентность — `apps/documents/tests/`, e2e — `apps/operations/submissions/tests/` (канон architecture стр. 631).

### References

- [Source: _bmad-output/planning-artifacts/epics.md §Story 6.4 (стр. 839-846); §Epic 6 (стр. 184-187, 811-813); Story 6.5 — сосед-потребитель (стр. 848-856); §Правила декомпозиции (стр. 248-254)]
- [Source: _bmad-output/planning-artifacts/prds/prd-VAPS-2026-06-10/addendum.md §8 (стр. 92-99) — канон формата; §3 — иерархия источников]
- [Source: _bmad-output/planning-artifacts/prds/prd-VAPS-2026-06-10/prd.md FR-17 (стр. 116); SM-2/SM-3 (стр. 208-209)]
- [Source: _bmad-output/planning-artifacts/architecture.md — стр. 537-539 (documents = владелец генераторов docx/xlsx/pdf); стр. 180, 675 (OQ-5 — «контракт миграции или отчёта»); стр. 585-596 (границы, AST-гварды); стр. 638-642 (make gate)]
- [Source: _bmad-output/planning-artifacts/ux-designs/ux-PersonnelStatus-2026-06-19/.working/extracts/extract-master-spec.md стр. 320 («XLSX Details sheet» — отказ Д9), стр. 170 (форматы DOCX/XLSX/PDF в донорском ТЗ; CSV добавляет FR-17)]
- [Source: _bmad-output/implementation-artifacts/6-3-генератор-docx-перенос-из-донора.md — контракт, ловушки, ревью; deferred-work.md:545-549 (violations → 6.5)]
- [Source: Backend/VAPS/apps/documents/generators/expense_docx.py:27-74 (DOCX_COLUMNS/LABELS/константы), :77-127 (датаклассы), :130-137 (_member_line), :163-175 (fill_status_cell — closure, логика усечения), :208-210 (special-case ATTACHED), :212-229 (раскладка строки ИТОГО); generators/__init__.py; apps/operations/submissions/expense_document.py:44-58; apps/migration_legacy/strength_render.py:151-193; apps/documents/tests/test_expense_docx_generator.py:35-111; apps/documents/tests/test_isolation.py:23-25; Backend/VAPS/pyproject.toml:5-30; Backend/VAPS/config/settings.py:225-231 (xlsx-MIME :229, pdf/csv :230); Backend/VAPS/Makefile:52-75]
- [Source: донор — Backend/PersonnelStatus/Personnel-Records/organization_management/apps/reports/utils.py:41-465 (generate_personnel_expense_report: шаблон :52-59, раскладка :77-95, колонки :229-251/:416-439, ИТОГО :444-456, периоды « - », склейка «; », «Басшылық» :229); apps/reports/tests/integration/test_daily_expense.py:17-39 (мок отсутствующего шаблона); apps/reports/infrastructure/generators/{xlsx,pdf,docx}_generator.py (ДРУГАЯ подсистема — не образец); Backend/PersonnelStatus/Personnel-Records/requirements.txt:32 (openpyxl==3.1.5), :44 (python-docx==1.2.0), :47 (reportlab==4.5.1)]
- [Source: PyPI registry-снимки 2026-07-08 — fpdf2 2.8.7, pypdf 5.6.0, openpyxl 3.1.5, reportlab 5.0.0]

### Latest Tech Information (пины по registry на дату create-story, урок E8 №3)

- **fpdf2, registry-снимок 2.8.7** (py>=3.10 — проект py312; LGPL-3.0-only; deps: defusedxml, Pillow>=8.3.2, fonttools>=4.34 — в спайк-venv встали pillow 12.3.0 / fonttools 4.63.0). В pyproject — `>=2.8,<3` по house style. **API проверено ЭМПИРИЧЕСКИ на create-story (2026-07-08, чистый venv)**: `FPDF(orientation="landscape", format="A4")` даёт 842×595pt БЕЗ ручного свопа; `add_font` TTF (Regular + `style="B"`); kk-титул, `table()` с multiline-ячейкой и сменой размера шрифта, bold-итог, `bytes(pdf.output())`, round-trip `pypdf.PdfReader` + `extract_text()` с kk-текстом — всё работает; 34ms/25KB на однострочный документ. Альтернативы отклонены: reportlab 5.0.0 (императивный API, нет эмпирики; донор-пин 4.5.1 — из другой подсистемы), LibreOffice headless (тяжёлая системная зависимость в air-gap — ветка деферрала не нужна), ручной PDF (несоизмеримый объём).
- **pypdf, снимок 5.6.0** (BSD-3, pure-python, deps только typing_extensions) — dev-only парсер тестов, `>=5,<6`.
- **openpyxl 3.1.5** — уже установлен (пин `>=3,<4` с 1.8); равен донорскому пину 3.1.5. API стори: `Workbook`, `ws.cell/append`, `Font(name=..., size=..., bold=...)`, `Alignment(wrap_text=True)`, `ws.merge_cells`, `ws.page_setup.orientation/paperSize`, `wb.save(BytesIO)`. **Проверено ЭМПИРИЧЕСКИ в venv ПРОЕКТА (2026-07-08)**: `page_setup.orientation="landscape"` + `paperSize = ws.PAPERSIZE_A4` round-trip'ятся через save/load (paperSize=9); ISO-имя листа; int-ячейка возвращается int'ом; multiline-текст ячейки парсится `splitlines()[0]`; merged-титул с TNR 16 bold читается обратно; байты начинаются `PK`.
- **Шрифты**: LiberationSerif-Regular/Bold.ttf (SIL OFL 1.1, метрический аналог TNR; источник — системный пакет fonts-liberation2, `/usr/share/fonts/truetype/liberation/`) — cmap-покрытие ВСЕХ kk/ru символов канона проверено эмпирически fontTools (2026-07-08); DejaVuSerif — проверенный fallback.

### Открытые вопросы (для Bratan — НЕ блокируют, приняты дефолты)

- Q1 (ГЛАВНЫЙ, структурный): одна стори с 6 нон-тест файлами (Д12) vs сплит 6.4a (xlsx+csv, без новых зависимостей) / 6.4b (pdf + шрифты + fpdf2)? Дефолт — НЕ сплитить: общий тест эквивалентности AC-1 и один контракт; сплит потребует правки sprint-status/epics (correct-course).
- Q2: PDF-библиотека — fpdf2 2.8.7 (Д5: LGPL-3.0 + Pillow C-ext, эмпирика есть) vs reportlab (BSD, донор-пин в другой подсистеме)? LGPL для внутреннего использования без модификации либы — ок?
- Q3: шрифт PDF — Liberation Serif (метрика TNR, Д6) vs DejaVu Serif? Вендоринг OFL-лицензии рядом с .ttf достаточен?
- Q4: CSV-диалект — `;` + utf-8-sig + CRLF (Excel ru-локали, Д4) vs `,` + utf-8 (RFC 4180, машины)?
- Q5: XLSX-ячейка «count + члены» одним текстом (канон §8, Д3) vs донорский стиль «две строки на управление» — подтвердить канон-вариант (расхождение фиксируется реестром).
- Q6: ATTACHED в CSV — чистое int (Д4) vs строка «+N» (визуальный паритет)? В XLSX — «+N» (документная форма).
- Q7: PDF-метаданные CreationDate из wall-clock библиотеки (Д8) — ок, или требовать детерминированные байты генерации (не требуется для 6.7 by design)?
- Q8: дом реестра расхождений — `docs/registries/expense-xlsx-donor-discrepancies.md` (единственный .md среди .yaml-реестров) — ок, или отдельный `docs/reports/`?

## Senior Developer Review (AI)

### Review Findings (code-review, 2026-07-08, story-automator autonomous review — Fable 5, same-model допустим: 6.4 вне списка cross-model гейта ретро AI-4)

Adversarial-проход по всем клеймам стори, пофайлово против кода (3 рендерера + 6 тест-файлов + реестр + pyproject + `__init__` + шрифты), git-реальность против File List, гейт перепрогнан независимо.

- **7/7 AC — IMPLEMENTED.** AC-1: эквивалентность docx≡xlsx≡csv позиционно + PDF токенами (фикстура 2 строк, 44 уникальных трёхзначных вне служебных диапазонов, самопроверка отдельным тестом) + e2e от реального `build_division_snapshot` → 4 формата == независимый `derive_report`; STOP-семантика закрыта QA-судьями (KeyError на пропавшем ключе × 3 формата). AC-2: лист=ISO-дата, merged kk-титул A1:Q1 16 bold TNR, литеральная 17-колоночная шапка 12 bold, безчленные ячейки int, членские — текст `count\n…` (wrap_text, cap 20 + «… ещё N»), ATTACHED `+N`, ИТОГО bold-зеркало docx (`expense_xlsx.py:74-121`), `page_setup.orientation="landscape"` + `paperSize = ws.PAPERSIZE_A4` — точная инкантация AC-2. AC-3: BOM utf-8-sig, `;`, CRLF-only (тест «голых \n нет»), числовая форма без членов, ATTACHED int без «+», ИТОГО с пустым «№», экранирование `;`/кавычек round-trip. AC-4: `%PDF-`, mediabox round 842×595, kk-probes по нормализованному тексту, все лейблы, числа-токены, `+N`, «ИТОГО», хвост усечения, вендоренный Liberation Serif R+B + LICENSE OFL, офлайн (без сети/subprocess/LibreOffice), cmap-гвард (усилен ревью — см. Fix-1). AC-5: реестр — решение OQ-5 «контракт ОТЧЁТА §8», 10 расхождений, 5 паритетов, секция «CSV/PDF прообраза НЕТ». AC-6: три чистых функции, ленивые openpyxl/fpdf, единственное файловое чтение — TTF пакета, AST-гвард rglob подхватил новые модули (импортов `apps.operations.*` нет), `expense_docx.py`/`expense_document.py` git-нетронуты. AC-7: fpdf2 runtime + pypdf dev с комментариями-обоснованиями house style, реэкспорт+`__all__`, гейт зелёный, миграций нет, API/urls/admin/settings/реестры-yaml не тронуты.
- **Все [x]-подзадачи 7 тасков реально сделаны** (0 ложных отметок); ловушки №2 (ATTACHED special-case), №3 (ровно 4 приватных импорта + дубль ~5 строк усечения), №5 (int vs текст), №9 (fpdf2-инкантации) соблюдены в коде буквально.
- **Гейт независимо перепрогнан ДО правок: 2066 passed, 29 deselected, 48.97s; ruff check чист; `makemigrations --check` → «No changes detected»** — цифры Dev Record и QA-прохода подтверждены точь-в-точь.
- [x] [Review][Fix][Med] cmap-гвард покрывал только буквы канон-лейблов: 22 буквы кириллицы (Ё Б Д Й Ф Х Ц Ч Ш Щ Ъ Ь Э Ю Я, г з й х ъ ы э) не гвардились, а ФИО/звания/имена подразделений приходят ДАННЫМИ — усечённый/подменённый шрифт с дырой на этих буквах прошёл бы гейт и дал tofu на «Хасенов»/«Юрий» в официальном документе. `_CANON_TEXT` расширен полным ru-алфавитом обеих регистров (kk-специфика уже была); Liberation Serif покрывает — тест зелёный (эмпирика fontTools) [apps/documents/tests/test_pdf_fonts.py:30-48]
- [x] [Review][Fix][Med] File List не содержал `_bmad-output/implementation-artifacts/tests/test-summary.md` (git M, изменён QA-проходом и упомянут в Change Log) — добавлен (класс находок ретро AI-3). `orchestration-*.md` в git-M — артефакт автоматора вне скоупа, корректно не в списке (прецедент ревью 6.3) [этот файл]
- [x] [Review][Fix][Low] Completion Notes и Change Log заявляли «45 уникальных трёхзначных» в фикстуре эквивалентности — фактически 44 (пересчитано исполнением `_fixture()`: 15+14+15; числа 101–144). Самопроверочный тест пинит уникальность/диапазон, но не количество — прозы поправлены на 44 [этот файл]
- [x] [Review][Dismiss][Low] PDF: членская ячейка целиком 8pt, включая count (AC-4 канон «числа 12») — ограничение plain-text ячейки fpdf2 (один размер на ячейку), честно задокументировано в docstring и Completion Notes; XLSX зеркально (члены 12pt — один шрифт на ячейку). Осознанные формат-компромиссы, не дефекты.
- [x] [Review][Dismiss][Low] pyproject-комментарий пина pypdf фиксирует registry-снимок 5.6.0, в venv фактически 5.9.0 (в пределах пина `>=5,<6`; Debug Log это честно отмечает) — комментарий документирует снимок на дату create-story, не churn'ить.

**0 CRITICAL · 0 HIGH · 2 MEDIUM (исправлены) · 1 LOW (исправлен) · 2 dismiss.** `make gate` после фиксов: тест-гвард шрифтов зелёный (3 passed), ruff check/format чисты по изменённому файлу; правка чисто тестовая — прод-код ревью не менял. Q1–Q8 остаются на решение Bratan (не блокируют: дефолты Д1–Д12 применены и реализация им соответствует). Status: review → **done** (0 CRITICAL).

## Dev Agent Record

### Agent Model Used

Claude Fable 5 (claude-fable-5) — dev-story, 2026-07-08. Same-model с create-story (допустимо: 6.4 вне списка обязательного cross-model ретро AI-4).

### Debug Log References

- TDD red→green по каждому таску; гейт-финал: **2057 passed, 29 deselected, 51s** (база 6.3: 2023 → +34 новых теста, ноль регрессий); `ruff check` чист; `makemigrations --check` пуст.
- Единственная нетривиальная находка dev-цикла (вне спека): **fpdf2 НЕ разрывает строку таблицы между страницами** (`ValueError: row … too high`), а дефолтный `line_height = 2×font_size` (~8.5мм при 12pt) раздувал cap-ячейку (20 членов + хвост) за пределы A4-страницы — mandated-тест усечения падал. Решение в `expense_pdf.py`: явный `line_height=4мм` + динамические `col_widths` по естественной ширине контента (замер `get_string_width`; членские колонки до 60мм — строка члена ~57.4мм@8pt влезает без переноса; шапка ширину сознательно НЕ диктует — её переносы канонизированы Ловушкой №7). Экстремальный документ (многие колонки по 20 членов разом) может не влезть по высоте — падает громким ValueError (STOP-семантика, зафиксировано в docstring).
- Эмпирика openpyxl (спайк в venv): `paperSize` после round-trip читается int 9 (константа `PAPERSIZE_A4` — строка "9") — ассерт через `int(...) == 9`; merged-титул читается `A1:Q1`.
- pypdf в venv встал 5.9.0 (пин `>=5,<6`; снимок стори 5.6.0 — в пределах пина).

### Completion Notes List

- **Task 1**: fpdf2 `>=2.8,<3` (runtime, комментарий-обоснование по образцу python-docx: нет донорского прообраза, LGPL-3.0 + Pillow/fonttools/defusedxml честно отмечены) + pypdf `>=5,<6` (dev); `pip install -e '.[dev]'` в существующий venv (fpdf2 2.8.7, pypdf 5.9.0, fonttools 4.63.0, Pillow 12.3.0).
- **Task 2**: вендорены LiberationSerif-Regular/Bold.ttf из системного fonts-liberation2 + LICENSE (полный текст SIL OFL 1.1 из debian copyright); cmap-гвард `test_pdf_fonts.py` (fontTools, транзитив fpdf2): оба TTF покрывают kk-титул, Ә/Ө/Ү/І/Һ/Ғ-класс (обе регистровые формы), все лейблы шапки, «ИТОГО», «… ещё», цифры и пунктуацию `_member_line` + гвард наличия LICENSE.
- **Task 3**: `generate_expense_xlsx` — один лист = ISO-дата, merged kk-титул 16 bold TNR, литеральная 17-колоночная шапка 12 bold, безчленные ячейки int, членские — текст `count\nчлены` (wrap_text, top; дубль ~5 строк усечения — closure `fill_status_cell` неимпортируема), ATTACHED `+N`, ИТОГО bold-зеркало docx, `page_setup.orientation="landscape"` + `paperSize = ws.PAPERSIZE_A4`. Один шрифт на ячейку (rich text не используется) — члены тем же 12pt, отмечено в docstring.
- **Task 4**: `generate_expense_csv` — utf-8-sig BOM, `;`, CRLF; титул одним полем, шапка 17, данные только count-числа (`row.name` — единственный текст), ATTACHED int без «+», ИТОГО с пустым «№» и лейблом в «Управление»; членов/`+`/«…» нет нигде (тест-гвард).
- **Task 5**: `generate_expense_pdf` — ленивый fpdf, вендоренный Liberation Serif Regular+Bold (`add_font` до `set_font`), титул 16 bold, `pdf.table(first_row_as_headings, headings_style=FontFace(emphasis="BOLD"))`, члены 8pt (`set_font_size` перед `cell` — весь текст членской ячейки, включая count: ограничение plain-text ячейки, в docstring), ИТОГО bold (`set_font(style="B")` перед `table.row()`), cap 20 + «… ещё N», `bytes(pdf.output())`; docstring фиксирует отказ от TNR (Ловушка №4) и от LibreOffice (Д5). Плюс layout-инженерия line_height/col_widths (см. Debug Log).
- **Task 6**: эквивалентность — одна фикстура 2 строк, 44 попарно различных трёхзначных числа вне служебных токенов (самопроверка фикстуры отдельным тестом), docx≡xlsx≡csv позиционно (включая порядок строк и ИТОГО) + матрица == самому контракту + PDF ⊇ все числа токенами с нормализацией `+N`→N; e2e — реальный `build_division_snapshot` → `build_expense_document` → 4 формата, каждое число == независимому `derive_report` (docx/xlsx/csv поле-в-поле, PDF токенами + `+N` + «ИТОГО» + титул), multi-код STUDY+CONFERENCE→TRAINING, DUTY, VACATION, ATTACHED, двое без факта; `django_db` без transaction=True.
- **Task 7**: реестр `docs/registries/expense-xlsx-donor-discrepancies.md` — решение OQ-5 «контракт ОТЧЁТА по addendum §8»; 10 расхождений (шаблон-бинарник, 13 колонок без №/BEFORE_DUTY/OTHER/PENDING, обратный порядок В строю↔Вакансии, две строки на управление + «; », формат периода « - » и дежурства без периода, суффиксы «из/в {div}», нет «+N», «Басшылық», ACTIVE-на-сейчас vs derive(снапшот), лист/титул из шаблона) + 5 паритетов (предвычисленные значения, VACATION+LEAVE_BY_REPORT, TRAINING+COMPETITION, ИТОГО, openpyxl 3.1.5) + секция «CSV/PDF: донорского прообраза НЕТ»; все донор-факты пересверены по коду utils.py (строки уточнены: дежурства без периода :353/:364, склейки :313/:328/:343/:380, MPTT :271, ИТОГО :444-456). `ruff format` — точечно по 10 изменённым файлам (урок 6.1); границы сверены git-диффом: `expense_docx.py`/`expense_document.py` нетронуты, миграций/urls/views/serializers/admin/settings/schema/реестров-yaml — нет.
- Все дефолты Д1-Д12 стори соблюдены; Q1-Q8 остаются на решение Bratan (ревью).

### File List

- `Backend/VAPS/pyproject.toml` (M — fpdf2 runtime, pypdf dev)
- `Backend/VAPS/apps/documents/generators/__init__.py` (M — реэкспорт трёх генераторов)
- `Backend/VAPS/apps/documents/generators/expense_xlsx.py` (N)
- `Backend/VAPS/apps/documents/generators/expense_csv.py` (N)
- `Backend/VAPS/apps/documents/generators/expense_pdf.py` (N)
- `Backend/VAPS/apps/documents/generators/fonts/LiberationSerif-Regular.ttf` (N — ассет, SIL OFL 1.1)
- `Backend/VAPS/apps/documents/generators/fonts/LiberationSerif-Bold.ttf` (N — ассет, SIL OFL 1.1)
- `Backend/VAPS/apps/documents/generators/fonts/LICENSE` (N — текст SIL OFL 1.1)
- `Backend/VAPS/apps/documents/tests/test_pdf_fonts.py` (N)
- `Backend/VAPS/apps/documents/tests/test_expense_xlsx_generator.py` (N)
- `Backend/VAPS/apps/documents/tests/test_expense_csv_generator.py` (N)
- `Backend/VAPS/apps/documents/tests/test_expense_pdf_generator.py` (N)
- `Backend/VAPS/apps/documents/tests/test_expense_formats_equivalence.py` (N)
- `Backend/VAPS/apps/operations/submissions/tests/test_expense_formats_e2e.py` (N)
- `docs/registries/expense-xlsx-donor-discrepancies.md` (N)
- `_bmad-output/implementation-artifacts/sprint-status.yaml` (M — статус стори)
- `_bmad-output/implementation-artifacts/tests/test-summary.md` (M — сводка QA-прохода, ревью-фикс File List)
- `_bmad-output/implementation-artifacts/6-4-генераторы-xlsx-csv-pdf.md` (M — этот файл)

## Change Log

- 2026-07-08 — create-story (Claude Fable 5, #YOLO): стори создана; полный контекст-анализ двумя параллельными research-агентами (донор reports-app + ground-truth Backend/VAPS) + ЭМПИРИЧЕСКИЙ спайк в чистом venv (fpdf2 2.8.7: A4-landscape/add_font TTF/table с multiline/bold/bytes-output/pypdf-round-trip kk-текста — 34ms/25KB; fontTools: полное kk-покрытие cmap Liberation Serif и DejaVu Serif, Regular+Bold). ГЛАВНАЯ находка донор-анализа: донорский расход — ТОЛЬКО XLSX по отсутствующему в репо шаблону (заголовки/стили в бинарнике, из кода — только семантика), CSV/PDF расхода в доноре НЕ СУЩЕСТВУЮТ → «сверка с донором» = семантическая сверка utils.py + реестр расхождений (AC-5, закрытие OQ-5 в пользу «контракта отчёта» addendum §8). Дизайн: три чистых рендерера contract→bytes в apps/documents/generators/ поверх НЕИЗМЕНЯЕМОГО контракта 6.3, внутрипакетный реюз _member_line/_FIXED_HEAD (анти-дрейф форматов), вендоринг Liberation Serif (OFL) + cmap-гвард, тест эквивалентности чисел 4 форматов + e2e от снапшота. Fresh-context валидация по checklist.md (независимый агент; все Source-ссылки сверены до строк, контракт/гвард/донор-факты подтверждены) нашла и закрыла 2 CRITICAL: (1) раскладка CSV-строк была недоспецифицирована — over-literal «ячейки только числа» позволял выпустить CSV без имён подразделений и лейбла ИТОГО при зелёных тестах — раскладка data/ИТОГО-строк прописана явно (зеркало expense_docx.py:212-229); (2) «уникальность чисел ⇒ presence==mapping» для PDF была неверна без запрета коллизий с датами/№/титулом — фикстура ужесточена (≥2 строк, трёхзначные вне служебных диапазонов, токены-числа). Плюс 8 уточнений: точная инкантация `ws.page_setup.paperSize = ws.PAPERSIZE_A4` (строковый сет — TypeError; константа на Worksheet; перепроверено в venv проекта), mediabox 841.89×595.28 → round-ассерты, нормализация текста для probes лейблов, fill_status_cell = closure (не импортировать — дублировать ~5 строк), явная раскладка ИТОГО во всех форматах, docx-извлечение первым параграфом ячейки, bold-приёмы fpdf2 (set_font(style="B") / FontFace), пути донорских цитат. Дефолты Д1-Д12 активны (#YOLO), Q1-Q8 ждут Bratan (Q1 структурный — 6 файлов vs сплит). Status: ready-for-dev.
- 2026-07-08 — qa-generate-e2e-tests (Claude Fable 5): мутационный QA-проход (принцип 6.2/6.3 «какая правка кода не краснит ни один тест»), 9 судей добавлены в СУЩЕСТВУЮЩИЕ пер-форматные тест-файлы (по 3 на формат, новых файлов нет): STOP-семантика ×3 (пропавший ключ статусной колонки → KeyError, не молчаливая дыра — рефактор `.get(key, default)` был невидим ни одному тесту), row-агностичность 0 строк ×3 (Д11-пин QA 6.3 существовал только для docx — опора свода 6.5), XLSX «ATTACHED без членов = текст „+N“» (держался ТОЛЬКО нормализацией `+N`→N эквивалентности, т.е. ничем), CSV экранирование «;»/кавычек round-trip (гвард от наивного `";".join`), PDF многостраничность 60 строк (≥2 страниц, все маркеры-числа целы сквозь разрыв, порядок сохранён, шапка автоповторена, ИТОГО на последней — первый судья пути свода 6.5/6.10). Невакуумность: 2 мутационные пробы (csv `.get`-дефолт; снятие ATTACHED-special-case xlsx) — каждая краснит РОВНО своего судью, откачены и сверены grep'ом. `make gate`: **2066 passed, 29 deselected (~53s)** = 2057 + 9 QA, ноль регрессий; `makemigrations --check` пуст; `ruff format` per-file по трём изменённым тест-файлам. Прод-код/pyproject/реестр/шрифты не тронуты; File List не менялся. Сводка: `_bmad-output/implementation-artifacts/tests/test-summary.md`. Наблюдение для ревью (не дефект): «+0» ATTACHED без членов в XLSX/PDF vs 0 в CSV — решить вместе с Q6.
- 2026-07-08 — dev-story (Claude Fable 5): все 7 тасков TDD-циклом red→green; 3 чистых рендерера `ExpenseDocumentData -> bytes` (`expense_xlsx/csv/pdf.py`) поверх нетронутого контракта 6.3 с внутрипакетным реюзом `_member_line`/`_FIXED_HEAD`/`_TOTALS_LABEL`/`_DATE_FORMAT` (Д7) и дублем ~5 строк усечения (closure неимпортируема); вендоринг Liberation Serif Regular+Bold + OFL-лицензия + cmap-гвард; тест эквивалентности чисел 4 форматов (позиционно docx≡xlsx≡csv, PDF токенами, 44 уникальных трёхзначных) + e2e от реального снапшота против независимого derive; реестр расхождений OQ-5 (10 расхождений, 5 паритетов, CSV/PDF без прообраза — все донор-факты пересверены по utils.py). Вне спека: layout-инженерия PDF (line_height=4мм + динамические col_widths по контенту) — fpdf2 не разрывает строку таблицы между страницами, дефолтный line_height 2×font_size валил mandated-тест cap-ячейки (детали — Debug Log). Гейт: 2057 passed (+34, ноль регрессий), ruff чист, makemigrations пуст. Границы git-сверены. Status: ready-for-dev → review.
- 2026-07-08 — code-review (Claude Fable 5, story-automator autonomous review; same-model допустим — 6.4 вне cross-model гейта AI-4): adversarial-проход всех клеймов пофайлово; 7/7 AC IMPLEMENTED, 0 ложных [x], границы целы (git-сверка: `expense_docx.py`/билдер/urls/admin/settings/реестры-yaml нетронуты); гейт перепрогнан независимо ДО правок — **2066 passed, 29 deselected, 48.97s**, ruff чист, `makemigrations --check` пуст (цифры Dev Record/QA подтверждены). Находки: 0 CRITICAL/HIGH; 2 MEDIUM исправлены — (1) cmap-гвард шрифтов покрывал только буквы лейблов (22 буквы кириллицы вне гварда при ФИО-данных из снапшота) → `_CANON_TEXT` расширен полным ru-алфавитом обеих регистров, тест зелёный; (2) File List не нёс изменённый `tests/test-summary.md` → добавлен; 1 LOW исправлен — «45 уникальных трёхзначных» в прозе против фактических 44 (пересчитано исполнением). 2 dismiss (осознанные формат-компромиссы: 8pt count членской ячейки PDF; снимок pypdf 5.6.0 в комментарии пина при 5.9.0 в venv). Правка чисто тестовая (test_pdf_fonts.py) + прозы стори. Status: review → done.
