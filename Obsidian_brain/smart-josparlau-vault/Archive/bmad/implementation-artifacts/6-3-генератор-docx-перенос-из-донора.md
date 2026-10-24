---
baseline_commit: 671167d (feat(story-6.2): DocumentSequence; 6.1/6.2 done — app documents с Attachment, DocumentSequence и allocate_number существуют)
context:
  - _bmad-output/planning-artifacts/epics.md (§Epic 6 Story 6.3 стр. 831-837; Story 6.4/6.5 — соседи-потребители стр. 839-856; §Правила декомпозиции стр. 248-254)
  - _bmad-output/planning-artifacts/prds/prd-VAPS-2026-06-10/addendum.md §8 (стр. 92-99 — ДЕТАЛЬНЫЙ контракт формата; §3 — иерархия источников)
  - _bmad-output/planning-artifacts/prds/prd-VAPS-2026-06-10/prd.md (FR-17 стр. 116 + следствия-формулы)
  - _bmad-output/planning-artifacts/architecture.md (дерево стр. 537-539 — documents владелец генераторов; границы стр. 585-596; Data Flow стр. 624; golden master стр. 109, 633)
  - _bmad-output/planning-artifacts/ux-designs/ux-PersonnelStatus-2026-06-19/.working/extracts/extract-master-spec.md (§77.3/77.4/77.5 — выжимка ТЗ, ВСПОМОГАТЕЛЬНЫЙ источник по иерархии addendum §3)
  - _bmad-output/implementation-artifacts/epic-5-retro-2026-07-08.md (урок №2 derive-only, урок №4 DOCUMENT_*-семя, AI-4 cross-model гейт, §108 пины по registry)
  - _bmad-output/implementation-artifacts/6-2-documentsequence.md (предыдущая стори: конвенции app documents, гейт-база)
---

# Story 6.3: Генератор .docx (перенос из донора)

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a **руководство**,
I want **.docx по секции 77: альбомный, заголовок «{Подразделение} ЖЕКЕ ҚҰРАМЫНЫҢ САПТЫҚ ТІЗІМІ {дата} ЖЫЛҒЫ», шрифты 16/12/8, колонки по addendum §8, итог жирным**,
so that **официальный документ соответствует канону**.

## Acceptance Criteria

1. **Канон вёрстки.** **Given** валидные данные документа, **When** генерирую .docx, **Then** секция — альбомная (A4 landscape), первый абзац — заголовок `{Подразделение} ЖЕКЕ ҚҰРАМЫНЫҢ САПТЫҚ ТІЗІМІ {ДД.ММ.ГГГГ} ЖЫЛҒЫ` (16pt), заголовки и числа таблицы — 12pt, списки внутри ячеек — 8pt, итоговая строка «ИТОГО» — **жирным**; имя шрифта `Times New Roman` проставлено ЯВНО на каждом run (не дефолтный Calibri). [Source: epics.md §Story 6.3 стр. 833; addendum.md §8 стр. 94, 97; prd.md FR-17 стр. 116]
2. **Колонки контракта — полный состав, видимая сходимость.** **Then** таблица содержит колонки В ПОРЯДКЕ: `№ | Управление | По штату | По списку | Вакансии | В строю | На дежурстве | После дежурства | В командировке | Учёба/соревнования/конференция | В отпуске | На больничном | Прикомандирован | Откомандирован` (канон addendum §8) **плюс хвост** `Перед дежурством | Иное | Уточняется` (Д3 — все 11 derive-колонок обязаны быть видимы, иначе Σ видимых колонок ≠ «По списку» и формула «Список = Σ статусов без остатка» ломается В ДОКУМЕНТЕ). «Прикомандирован» рендерится как `+N`. [Source: addendum.md §8 стр. 95, 98; strength_report.py REPORT_COLUMNS:65-77; лейблы хвоста: «Перед дежурством»/«Иное» — extract-master-spec.md §77.3, «Уточняется» — стори 3.9 / strength_render.py:33]
3. **Данные = derive(снапшот).** **Given** снапшот сдачи (реальный `build_division_snapshot` над созданными Employee/EmployeeStatus — снапшот руками НЕ лепить, урок ревью 5.4b), **When** строю данные документа и генерирую, **Then** каждое число документа (Штат/Список/Вакансии/все колонки/+N/строка ИТОГО) равно соответствующему полю `derive_report(...)` от того же снапшота — поле-в-поле; порядок строк = порядок derive (рендерер НЕ пересортировывает — прецедент strength_render); AssertionError/ValueError derive НЕ глотаются (STOP-семантика). [Source: epics.md §Story 6.3 стр. 837; epic-5-retro урок №2 «E6-генераторы читают ТОЛЬКО derive(снапшот)»; strength_report.py:141-232]
4. **Ячейка статуса.** **Given** колонка-статус с ненулевым count (кроме «В строю» и агрегатных Штат/Список/Вакансии), **Then** ячейка = число + список строк `{rank} {full_name} — {ДД.ММ.ГГГГ}–{ДД.ММ.ГГГГ}` (8pt; период — из действующего winner-факта; rank пустой → без ведущего пробела, `" ".join(filter(None, ...))`); члены группируются по **колонке** — `REPORT_COLUMN_BY_CODE[winner]`, many-to-one (STUDY+COMPETITION+CONFERENCE → одна ячейка TRAINING; DUTY+GEV → ON_DUTY); при > 20 членов — первые 20 + строка `… ещё {N}`; count согласован со списком (полный размер списка до усечения == count — cross-assert в билдере для ВСЕХ колонок, КРОМЕ IN_SERVICE). «В строю» — только число, члены НЕ собираются: и для derived-носителей (факта нет), и для EVENT_ASSIGNMENT-факта (маппится в IN_SERVICE, strength_report.py:55). [Source: addendum.md §8 стр. 96; strength_report.py REPORT_COLUMN_BY_CODE:40-58; extract-master-spec.md §77.4, §8.5 DAILY_REPORT_CELL_MAX_NAMES=20; донор utils.py — перенос логики ячеек]
5. **Чистота и офлайн.** Билдер и рендерер — чистые функции (без ORM, без wall-clock, без сети, без записи на диск; результат — `bytes`); `python-docx` импортируется ЛЕНИВО внутри функции рендера (зеркало `strength_render.build_workbook`); AST-гвард изоляции `apps/documents/tests/test_isolation.py` остаётся зелёным (в app documents НИ ОДНОГО импорта `apps.operations.*` — контракт-датаклассы живут в documents, операционный билдер импортирует ИХ, направление «documents ← operations» разрешено). [Source: epics.md §Story 6.3 стр. 837 «генерация работает офлайн»; architecture.md стр. 591; strength_render.py:1-13]
6. **Гейт и анти-gold-plating.** `pyproject.toml` пополнен `python-docx>=1.2,<2` (house style диапазонов — зеркало openpyxl/PyJWT; registry-снимок на дату create-story 2026-07-08: **1.2.0** — урок E8 №3; та же версия у донора); `docs/registries/audit-events.yaml` пополнен форвард-семенем `DOCUMENT_GENERATED`/`DOCUMENT_ISSUED`/`DOCUMENT_SUPERSEDED` (урок E5 №4 — сеет первая генераторная стори; эмиссий в 6.3 НЕТ); `make gate` зелёный (Postgres :5433), `makemigrations --check` пуст (миграций в стори НЕТ); НЕТ правок API/urls/serializers/Admin/RBAC-матриц/error-codes.yaml/schema.yaml (API не менялся — regen не нужен); НИЧЕГО сверх секции «Границы». [Source: epic-5-retro §108, урок №4; epic-8-retro урок №3; architecture.md §Enforcement стр. 474-481]

## Tasks / Subtasks

- [x] **Task 1 — Зависимость python-docx (AC: 6)**
  - [x] `Backend/VAPS/pyproject.toml`: `python-docx>=1.2,<2` в runtime deps (house style диапазонов — как `openpyxl>=3,<4`) с комментарием-обоснованием по образцу openpyxl (стр. 9-12): перенос из донора (donor requirements.txt пинит 1.2.0; registry-снимок 1.2.0 на 2026-07-08, release 2025-06-16, Python ≥3.9); ЧЕСТНО отметить в комментарии: тянет lxml (C-extension) — осознанное отступление от openpyxl-обоснования «no C extensions» (Q2), бинарные wheels в offline-зеркало контура
  - [x] `.venv` worktree: `pip install -e '.[dev]'` (venv существует с 6.1 — ретро AI-2, НЕ пересоздавать)
- [x] **Task 2 — Контракт данных + рендерер (AC: 1, 2, 4, 5)**
  - [x] `apps/documents/generators/__init__.py` — пакет (НЕ Django app; реэкспорт публичных имён)
  - [x] `apps/documents/generators/expense_docx.py` (имя НЕ `docx.py` — Ловушка №2): frozen-датаклассы контракта — `ExpenseCellMember(rank, full_name, date_start, date_end)`, `ExpenseCell(count, members)`, `ExpenseRow(name, staff_total, list_total, vacancies, cells, attached: ExpenseCell)`, `ExpenseTotals(...)`, `ExpenseDocumentData(division_title, business_date, rows, totals)`; поля-числа — int, даты — `datetime.date`. ATTACHED в `cells` НЕ входит — только отдельное поле `attached` (рендерер, итерируя `DOCX_COLUMNS`, special-case'ит ключ `"ATTACHED"` → `row.attached`, рендер `+N` + список); строка ИТОГО — только числа, БЕЗ списков членов
  - [x] Константы вёрстки: `DOCX_COLUMNS` — порядок ключей derive-колонок в §8-порядке + хвост (Д3): `("IN_SERVICE","ON_DUTY","AFTER_DUTY","COMMAND","TRAINING","VACATION","SICK","ATTACHED","DETACHED","BEFORE_DUTY","OTHER","PENDING")`; `DOCX_COLUMN_LABELS` — русские лейблы по AC-2 (литеральная копия §8 + хвост §77.3; docstring: canonical source addendum §8, дубль ключей с operations.REPORT_COLUMNS — ОСОЗНАННЫЙ, sync-тест держит e2e в submissions); `CELL_MAX_MEMBERS = 20`; `FONT_NAME = "Times New Roman"`; размеры 16/12/8
  - [x] `generate_expense_docx(data: ExpenseDocumentData) -> bytes`: ленивый `from docx import Document` + `from docx.shared import Pt` + `from docx.enum.section import WD_ORIENT` ВНУТРИ функции; секция landscape (поменять width/height местами + orientation); заголовок-абзац `{division_title} ЖЕКЕ ҚҰРАМЫНЫҢ САПТЫҚ ТІЗІМІ {ДД.ММ.ГГГГ} ЖЫЛҒЫ` (run 16pt bold — Д10); таблица: шапка (12pt bold) → строки (№ с 1, name, числа 12pt; ячейки статусов: run count 12pt + runs членов 8pt с `\n`-переносами или отдельными параграфами; ATTACHED — `+N`) → строка «ИТОГО» (все runs bold 12pt); `font.name` НА КАЖДОМ run + `rFonts` для полного покрытия кириллицы (Ловушка №10); сохранение в `BytesIO` → `.getvalue()`
  - [x] Docstring-нарратив по-русски (house style 6.1/6.2): что канон (§8), что рендерер НЕ делает (не считает, не сортирует, не пишет на диск, формулы не проверяет — это derive/6.5)
- [x] **Task 3 — Билдер данных из снапшота (AC: 3, 4, 5)**
  - [x] `apps/operations/submissions/expense_document.py` (app-root read-only derive-модуль — зеркало `traffic_light.py`/`tomorrow_block.py`, НЕ services/): `build_expense_document(snapshot, business_date, *, staff_map, division_names, division_id) -> ExpenseDocumentData` — ЧИСТАЯ функция: ORM-обвязку (откуда staff_map/имена) даёт вызывающий (6.5) — зеркало сигнатуры `derive_report`
  - [x] Механика: ISO-даты строк снапшота → `date.fromisoformat` (полуоткрытый `[start, end)` — зеркало `_snapshot_winners`, Ловушка №8) → счётчики и итоги = вызов `derive_report(employees={division_id: roster_ids}, status_rows=..., staff_map=..., on_date=business_date, division_names=...)` — данные документа БУКВАЛЬНО derive(снапшот); члены ячеек: per-employee `resolve_status` → winner-код → **колонка = `REPORT_COLUMN_BY_CODE[winner]`** (many-to-one: STUDY/COMPETITION/CONFERENCE → TRAINING, DUTY/GEV → ON_DUTY — группировать ПО КОЛОНКЕ, не по коду); период — действующий факт winner-кода (при нескольких — min по date_start, Д7); строка члена `" ".join(filter(None, [rank, full_name]))` — из `snapshot["roster"]`; cross-assert `len(members) == columns[key]` для каждой колонки КРОМЕ `IN_SERVICE` (Ловушка №7)
  - [x] Члены НЕ собираются для колонки `IN_SERVICE` (только count, AC-4): ни для derived-носителей без факта, ни для EVENT_ASSIGNMENT-факта (его колонка — IN_SERVICE); ATTACHED — count + члены; исключения derive (AssertionError/ValueError) пролетают наружу (AC-3)
  - [x] Wall-clock НЕ читается (business_date — аргумент); импорт контракта: `from apps.documents.generators.expense_docx import ...` (разрешённая стрелка, Ловушка №3)
- [x] **Task 4 — Тесты рендерера, gate (AC: 1, 2, 4, 5)**
  - [x] `apps/documents/tests/test_expense_docx_generator.py` — БЕЗ `django_db` (чистые функции): вход — literal-датаклассы; читать сгенерированное через `docx.Document(BytesIO(result))`
  - [x] проверки: ориентация секции landscape; текст заголовка с kk-строкой и датой `ДД.ММ.ГГГГ`; шапка таблицы == полный порядок лейблов AC-2; значения ячеек из входа; `+N` у Прикомандирован; строка ИТОГО — числа верны и все runs bold; размеры шрифтов 16/12/8 и `font.name == "Times New Roman"` на runs (заголовок/таблица/члены); усечение 21 члена → 20 строк + `… ещё 1`; пустые члены → только число; bytes-результат открывается python-docx без ошибок (смок-валидность zip)
  - [x] тест изоляции подхватится сам (`test_isolation.py` rglob) — от generators/ НИКАКИХ импортов operations
- [x] **Task 5 — Тесты билдера + e2e от снапшота, gate (AC: 3, 4)**
  - [x] `apps/operations/submissions/tests/test_expense_document.py` (`pytest.mark.django_db`, БЕЗ transaction=True — teardown-ловушка 6.2 не задевается): данные через прямые `objects.create` + фикстуры-хелперы (зеркало `test_snapshot_builder.py:33-68`), снапшот — ТОЛЬКО `build_division_snapshot` (урок 5.4b)
  - [x] e2e (AC-3): снапшот с разными статусами, ОБЯЗАТЕЛЬНО включая multi-code колонку (напр. VACATION, STUDY + CONFERENCE → одна ячейка TRAINING с count 2 и 2 членами, DUTY, ATTACHED) + сотрудники без факта → `build_expense_document` → `generate_expense_docx` → распарсить документ → все числа == полям `derive_report` от тех же входов; +N прикомандированного вне «По списку»
  - [x] юниты билдера: период члена из winner-факта (несколько фактов — min date_start); ISO-парсинг полуоткрытого интервала (факт с `date_end == business_date` НЕ действует); защитный cross-assert count==len(members) — честным входом счётчики и члены НЕ развести (один снапшот), поэтому санкционированная техника: monkeypatch `derive_report` в модуле билдера на подделанные columns → AssertionError; пустой снапшот `{"roster": [], "rows": []}` → нулевые строки без падения (литерал здесь легален — негативный вход, не позитивная фикстура); неизвестный status_type_code → ValueError наружу; roster-член без факта → В строю (без списка); EVENT_ASSIGNMENT-факт → счётчик IN_SERVICE растёт, членов нет
  - [x] sync-гвард дублированных ключей (Д3): `DOCX_COLUMNS` (documents) покрывает РОВНО `REPORT_COLUMNS + ATTACHED` (operations) — живёт ЗДЕСЬ (submissions/tests видит обе стороны легально; AST-гвард documents тестовые модули не сканирует — `"tests" not in p.parts`, — но импорт operations из documents/tests нарушал бы ДУХ границы, потому дом sync-теста — submissions)
- [x] **Task 6 — Реестр-семя + doc-sync + гейт (AC: 6)**
  - [x] `docs/registries/audit-events.yaml`: `DOCUMENT_GENERATED`, `DOCUMENT_ISSUED`, `DOCUMENT_SUPERSEDED` — ФОРМАТ записи (entity_type: document / description / provenance / source: FR-17 + §34) зеркалит DOCUMENT_DOWNLOADED; комментарий «форвард-семя E6 (ретро E5 урок №4), эмиссия: 6.5» — НОВЫЙ (у существующих записей его нет), опора — growth_rule реестра + прецедент DOCUMENT_DOWNLOADED-без-эмиссии-до-6.7
  - [x] `make gate` зелёный в worktree; `ruff format` — ТОЛЬКО по конкретным изменённым файлам (урок 6.1); File List сверить с `git status`/`git diff --stat` (ретро AI-3)
  - [x] Проверить глазами: НЕТ новых миграций, НЕТ правок urls/views/serializers/admin/seed/schema.yaml/error-codes.yaml

## Dev Notes

### ⚠️ Ловушка №1 (ГЛАВНАЯ): в доноре переносимого DOCX-кода НЕТ — не искать «готовый генератор»

Факт-чек донора (2026-07-08, research-агент по `Backend/PersonnelStatus/.../apps/reports/`):

- `infrastructure/generators/docx_generator.py` — **заглушка**: 12 RU-колонок литералами, книжная ориентация, ни шрифтов, ни казахского заголовка, ни итоговой строки. Из него переносим ТОЛЬКО каркас `Document()` → таблица → `BytesIO` → bytes (и то — наш будет с вёрсткой).
- Самый близкий к канону код донора — **`utils.py::generate_personnel_expense_report()`**: 13 колонок, казахские метки, строка «ИТОГО», формула Штат=Список+Вакансии, ячейки «count + ФИО + период». НО это **XLSX по шаблону `расход.xlsx`**, которого в репо НЕТ (тест донора мокает шаблон). Переносится ЛОГИКА (состав ячейки, ИТОГО, «+N»), не код.
- `application/services.py` донора — 4 функции `pass` + мёртвый класс-дубль. Игнорировать.
- Физического .docx-эталона/скриншота ДОКУМЕНТА нет нигде (spikes/Расход*.png — скрины UI-дашборда донора, не документа). Канон вёрстки — ТОЛЬКО текстовый: addendum §8 + FR-17 + §77-выжимка.

Следствие: «перенос из донора» в этой стори = перенос КОНТРАКТА (addendum §8 дистиллирован из донорской практики) и логики ячеек utils.py. Весь рендер-код пишется заново. НЕ пытаться импортировать/копировать донорские модули.

### ⚠️ Ловушка №2: имя модуля `docx.py` — конфликт с пакетом python-docx

Библиотека импортируется как `import docx`. Наш модуль назвать `expense_docx.py`: абсолютные импорты Python 3 top-level пакет не затенят, но `from apps.documents.generators import docx` + `import docx` в одном файле — гарантированная путаница на ревью и в trace'ах. Ленивый импорт библиотеки ВНУТРИ функции — заодно зеркало прецедента `strength_render.build_workbook` (модуль импортируем без установленного пакета).

### ⚠️ Ловушка №3: AST-гвард documents банит operations — контракт живёт в documents

`apps/documents/tests/test_isolation.py` (6.1, rglob — новые файлы подхватит сам) банит `apps.operations.*` во ВСЕЙ app documents, включая generators/. Поэтому:

- Датаклассы контракта (`ExpenseDocumentData` и пр.) — В `apps/documents/generators/expense_docx.py`. Рендерер знает ТОЛЬКО их, про `StrengthReportResult` не знает.
- Билдер в `apps/operations/submissions/` импортирует контракт из documents — стрелка `documents ← operations` РАЗРЕШЕНА (architecture.md стр. 591; так же 6.5 будет звать `create_attachment`).
- Ключи колонок в `DOCX_COLUMNS` — осознанный дубль `REPORT_COLUMNS` через границу. Дрейф ловит sync-тест в submissions/tests (Task 5), где обе стороны видны. НЕ «чинить» дубль импортом operations в documents — сломает гвард.

### ⚠️ Ловушка №4: прятать OTHER/PENDING/BEFORE_DUTY нельзя — сходимость обязана быть видимой

derive несёт 11 колонок (`REPORT_COLUMNS`) + ATTACHED. Канон addendum §8 перечисляет только 9 статусных колонок — в нём нет «Иное» (OTHER), «Уточняется» (PENDING, введён стори 3.9 — в доноре не существовал) и «Перед дежурством» (BEFORE_DUTY). Если рендерить строго §8-набор, то `Σ видимых колонок ≠ По списку` для любого дня с этими статусами — документ ВИДИМО ломает формулу «Список = Σ статусов без остатка» (FR-17-следствие, SM-3). Поэтому Д3: все 11 + ATTACHED, канонические — в §8-порядке, три доп. — хвостом. Выжимка ТЗ §77.3 подтверждает состав («Перед дежурством», «Иное» там есть). Это вопрос Q1 для Bratan — но дефолт обязан быть «ничего не терять молча».

### ⚠️ Ловушка №5: снапшот НЕ несёт штат/вакансии/имя подразделения

Снапшот (schema v1, docstring `daily_submission.py:29-50`) — self-contained по roster+rows, но `staff_map` (Штат) и имена подразделений в нём НЕТ. Поэтому `build_expense_document` принимает `staff_map`/`division_names` АРГУМЕНТАМИ (зеркало `derive_report`) — чистая функция, ORM-обвязка (СЕЛЕКТОРЫ `CoreStaffingSelector.allocated_slots_on` — date-versioned, `CoreDivisionTreeSelector.divisions_map`) — зона вызывающего: в 6.3 это e2e-тест, в проде — выпуск 6.5. НЕ вшивать селекторы в билдер (ломает чистоту и тестируемость без БД мимо e2e).

### ⚠️ Ловушка №6: «комментарий» из §8-ячейки в снапшоте v1 НЕДОСТИЖИМ

addendum §8 стр. 96: ячейка = «количество + список (Фамилия И.О.) + **комментарий** + период». Строки снапшота (`rows`) несут только `employee_id/status_type_code/status_id/date_start/date_end/source` — ни reason, ни комментария. Рендерить комментарий НЕЛЬЗЯ без бампа snapshot-схемы, а бамп — «только осознанным решением» (договорённость ретро E5: будит KeyError-деферы 5.3b/5.5a). В 6.3 комментарий НЕ рендерится (Q3); «Фамилия И.О.» рендерится как `full_name` из roster КАК ЕСТЬ — эвристическое сокращение казахских ФИО до «И.О.» опаснее длинной строки.

### ⚠️ Ловушка №7: период члена — из winner-факта; группировка — по КОЛОНКЕ; IN_SERVICE вне cross-assert

- `resolve_status` возвращает КОД, не строку-факт. Для периода члена билдер локально выбирает действующий факт winner-кода (фильтр `date_start <= business_date < date_end` и `status_type_code == winner`; при нескольких — min по `date_start`). НЕ трогать сам `resolve_status`/`derive_report` (shared-код 1.7/1.8/5.5/5.10 с property-тестами — любая правка там будит регрессии).
- Ключ ячейки — КОЛОНКА, не код: `REPORT_COLUMN_BY_CODE[winner]` many-to-one (STUDY/COMPETITION/CONFERENCE → TRAINING; DUTY/GEV → ON_DUTY; SICK_LEAVE → SICK; LEAVE_BY_REPORT → VACATION; **EVENT_ASSIGNMENT → IN_SERVICE**). Группировка по коду дала бы ячейки, которых нет в DOCX_COLUMNS, и потерянных членов.
- Cross-assert `len(members) == columns[key]` — для всех колонок КРОМЕ `IN_SERVICE`: для неё члены сознательно не собираются (AC-4), а счётчик включает и derived-носителей без факта, и EVENT_ASSIGNMENT — буквальный assert на неё падал бы на любых реальных данных.

### ⚠️ Ловушка №8: даты снапшота — ISO-строки, интервалы полуоткрытые

`rows[].date_start/date_end` — строки `"YYYY-MM-DD"`; перед `resolve_status` парсить `date.fromisoformat` (зеркало `_snapshot_winners`, `traffic_light.py:106-117`). Полуоткрытый `[start, end)`: факт с `date_end == business_date` уже НЕ действует — юнит на это обязателен (класс ошибок, против которого вводился ARCH-DATA-023).

### ⚠️ Ловушка №9: где какие тесты бегут

- Тесты рендерера — ЧИСТЫЕ (без `django_db`): datacls-вход → bytes → `Document(BytesIO)`. Бегут в gate.
- Тесты билдера/e2e — `django_db` обычный, НИ ОДНОГО `transaction=True` (иначе teardown-flush валит gate — Ловушка №4 стори 6.2). Property/concurrency-маркеры НЕ нужны.
- Гейт-база после 6.2: **1989 passed, 29 deselected**. Прирост 6.3 — только свои тесты, ноль регрессий.

### ⚠️ Ловушка №10: шрифты в python-docx — явно на каждый run

Дефолт python-docx — Calibri 11 из встроенного template. Стилевой подход (правка styles) хрупок; канон стори — `run.font.name = "Times New Roman"` + `run.font.size = Pt(...)` на КАЖДОМ run. Для полноты кириллического покрытия проставить и `rFonts` (`r.font` покрывает ascii/hAnsi; `cs`-атрибут — через `run._element.rPr.rFonts.set(qn('w:cs'), ...)` при необходимости — решить по факту рендера, тест проверяет `font.name`). Embedding TTF в .docx python-docx НЕ поддерживает — и НЕ нужен: читалка контура — MS Word/LibreOffice с системным Times New Roman (казахские глифы ҚҰҢҒӘӨҮІҺ в TNR есть). «Шрифты вендорены» для .docx = имя шрифта фиксировано + генерация офлайн (python-docx несёт default-template в пакете, сети не касается); физический вендоринг .ttf-файлов — зона 6.4 (PDF, где рендеринг наш) (Q4).

### Эталоны — всё уже в кодовой базе, ничего не изобретать

| Что | Откуда копировать паттерн |
|---|---|
| Чистый рендерер результата derive (labels, layout, «+N», ИТОГО-строка, ленивый импорт библиотеки) | `apps/migration_legacy/strength_render.py` — ПРЯМОЙ прообраз 6.3 (docstring: «The full document generator lives in E6 (6.3/6.8)») |
| Формулы и структура данных (rows/totals/violations) | `apps/operations/statuses/services/strength_report.py:112-244` (derive_report, датаклассы) |
| Derive-из-снапшота (ISO-парсинг, roster=denominator) | `apps/operations/submissions/traffic_light.py:106-117` `_snapshot_winners` |
| Снапшот в тестах — только реальным билдером | `apps/operations/submissions/tests/test_snapshot_builder.py:33-68, 186-209` |
| Read-only derive-модуль в app-root submissions | `traffic_light.py`, `tomorrow_block.py` |
| Комментарий-обоснование зависимости в pyproject | `Backend/VAPS/pyproject.toml:9-12` (openpyxl, offline-контур) |
| Русские docstring-нарративы, kwargs-only | `apps/documents/services.py` (6.1/6.2) |
| RU-лейблы колонок (справочно; НЕ канон §8) | `strength_render.py COLUMN_LABELS_RU:20-36` |

### Дефолты (приняты мной — поднять на ревью, если не согласен)

- **Д1. Размещение**: рендерер — `apps/documents/generators/` (канон architecture стр. 537-539 «documents — владелец генераторов»; зеркало решения 6.2-Д1 «documents > drift дерева стр. 527-528»); билдер — `apps/operations/submissions/expense_document.py` (данные документа — производная СНАПШОТА, дом снапшота — submissions; прецеденты traffic_light/tomorrow_block). Про **R7** (addendum §4: «Расходная ведомость в operations.reports»): R7 — о домене ведомости (донорская модель Report/агрегация); фактическая кодовая база уже положила derive в statuses (strength_report, 1.7), снапшот-производные — в submissions (5.5/5.6); app `operations/reports` НЕ создаётся ради одного модуля — его заведёт первая стори с реальным reports-обитателем (классификатор диффов 6.9), перенос derive-модулей туда — осознанным рефактором, не побочкой 6.3.
- **Д2. Стори трогает две app** (documents + submissions) без FK/миграций: буква правила декомпозиции №3 говорит о cross-app FK/миграциях, здесь — cross-app import-зависимость через разрешённую стрелку. Считаю когезивным («генератор» = снапшот → канонический .docx: билдер без рендерера нетестируем по канону, рендерер без билдера не доказывает «данные = derive(снапшот)»); сплит 6.3a/6.3b дал бы две полустори с общим контрактом. Q5.
- **Д3. Состав колонок** — все 11 derive + ATTACHED; §8-порядок + хвост «Перед дежурством | Иное | Уточняется» (Ловушка №4). Q1 — ГЛАВНЫЙ вопрос вёрстки.
- **Д4. Ячейки со списками** — только статусные колонки с фактами + ATTACHED; «В строю» (и Штат/Список/Вакансии) — числа без списков (derived-статус не имеет факта/периода; полный ростер в ячейке раздул бы документ). Cap 20 + «… ещё N» (§8.5 выжимки, DOC-DAILY-CELL-004).
- **Д5. Формат даты** — `ДД.ММ.ГГГГ` и в заголовке, и в периодах членов (прецедент донора utils.py; казахские месяцы прописью — только по образцу заказчика, Q6).
- **Д6. «ИТОГО»** — заглавными (донор utils.py; strength_render пишет «Итого» — для ОФИЦИАЛЬНОГО документа берём донорский вид).
- **Д7. Период при нескольких фактах winner-кода** — факт с min `date_start` (отображение, не домен).
- **Д8. Рендерер формулы НЕ проверяет** — сходимость гарантирует derive (by construction + AssertionError), рантайм-ассерт ПЕРЕД ВЫПУСКОМ — AC стори 6.5. Дублирование проверки в рендерере = gold-plating.
- **Д9. Контракт входа — frozen-датаклассы** (не dict): typo-safety на границе двух app; зеркало датаклассов derive.
- **Д10. Заголовок жирным 16pt** (официальный титул; §8 про bold заголовка молчит — донорского эталона нет, выбираю жирный как у титулов; дешёво откатить).
- **Д11. Документ 6.3 — ОДНОстрочный** (одна строка управления по одному снапшоту + строка ИТОГО): билдер принимает ОДИН снапшот → `derive_report(employees={division_id: roster_ids}, ...)` даёт одну DivisionReportRow. Рендерер при этом row-агностичен (принимает список строк — рисует сколько дали). Многострочный свод (строки по дочерним управлениям из фрактальной сводки 5.11) и период — зона 6.5/6.10; НЕ изобретать итерацию по детям в билдере.

### Что уже есть (НЕ переизобретать)

- `derive_report`/`resolve_status`/`REPORT_COLUMNS` — формулы сходимости готовы и property-протестированы (5.10); докстринг strength_report.py прямо обещает «E6 will feed the same derive_report from JSONB snapshots».
- `build_division_snapshot` (5.3a) — фикстурный путь e2e; снапшот self-contained (roster: employee_id/full_name/rank; rows: факты).
- `strength_render.py` — прообраз рендерера (в migration_legacy, УДАЛЯЕТСЯ после cutover — потому НЕ импортировать его из документов, только копировать паттерн).
- `error-codes.yaml` УЖЕ содержит `DOCUMENT_GENERATION_FAILED` (500) — НЕ добавлять, НЕ эмитить (маппинг исключений на код — зона 6.5/API).
- `audit-events.yaml` УЖЕ содержит `DOCUMENT_DOWNLOADED` (для 6.7) и `ATTACHMENT_UPLOADED`.
- MIME docx уже в whitelist `VAPS_ATTACHMENT_CONTENT_TYPES` (6.1) — для 6.5 готово, в 6.3 не трогается.
- `allocate_number`/`create_attachment` (6.1/6.2) — в 6.3 НЕ вызываются (финализация — 6.5).
- Grep-факт: `python-docx`, `expense_docx`, `ExpenseDocumentData`, `build_expense_document` в кодовой базе НЕ встречаются — greenfield, коллизий нет.

### Границы (что 6.3 НЕ делает)

- **Выпуск/финализация** (снапшот → файл + sha256 + номер + «взамен исх. №», Attachment, аудит выпуска, рантайм-ассерт формул перед выпуском, чтение старых schema_version с явным отказом) → **6.5**. 6.3 не решает, КОГДА генерировать и КУДА класть байты.
- **.xlsx/.csv/.pdf** → 6.4 (контракт-датаклассы 6.3 станут их входом). **AsyncJob/замеры** → 6.6. **Скачивание/аудит скачивания** → 6.7. **Golden master + make golden-update** → 6.8 (двухслойная схема стр. 109: числа-инварианты + нормализованный document.xml — НЕ строить сейчас). **Период/«на завтра»** → 6.10.
- **HTTP-поверхности НЕТ**: ни view, ни urls, ни permission-кода `document.generate`, ни RBAC/AUDIT-матриц, ни schema.yaml regen. Реестр error-codes НЕ трогается.
- **Миграций НЕТ** (ни одной модели не добавляется/меняется).
- **Admin НЕ трогается**. **Снапшот-схема НЕ бампается** (Ловушка №6). **Glossary НЕ расширяется** (лейблы — display-строки, прецедент strength_render).
- **Из §77.4/§9.5 выжимки ТЗ СОЗНАТЕЛЬНО НЕ реализуются** (addendum §8 выигрывает по иерархии §3; фиксируем явно, не молчаливо): нумерация членов `1)…`, маркер `[осн. док.: N]`, «full list in appendix» после cap, база 9pt (у нас 16/12/8), сокращения `rank_short`/`FIO_short`. Возврат — только решением Bratan (Q3/Q7).
- **Многострочный свод и «страница на дату»** → 6.5/6.10 (Д11): в 6.3 документ одно-строчный.

### Previous Story Intelligence (6.2, ревью 2026-07-08)

- 6.2 APPROVE (0 CRITICAL/HIGH/MEDIUM, 2 LOW доки — исправлены на месте). Гейт-база: **1989 passed, 29 deselected, ~38s**.
- Механика 6.2 (allocate_number с локом) — потребитель 6.5, в 6.3 НЕ задействована; но конвенции app documents (русские docstring-нарративы, kwargs-only, санитизация на границе) — переносятся.
- Ретро AI-2: venv живёт в `Backend/VAPS/.venv` worktree — НЕ пересоздавать; Postgres :5433 поднимает Makefile.
- Ретро AI-3: File List сверять с git-диффом (находка в КАЖДОЙ стори 8.4-8.8 и в 6.1 — не повторять).
- Урок 6.1: `ruff format` — только по конкретным изменённым файлам.
- **Ретро AI-4 (ГЕЙТ, 3-й перенос E4-AI#3): 6.3 — в списке обязательного cross-model/ultra-ревью** (docx-генератор — перенос из донора). В ревью-секции этой стори ДОЛЖНА быть зафиксирована независимая модель/ultra — обычного same-model ревью НЕДОСТАТОЧНО. Прецедент работоспособности — 5.7c.

### Git Intelligence

- Baseline: `671167d` — feat(story-6.2): DocumentSequence. Паттерн коммитов: `feat(story-N.N): <название>`, коммит после ревью.
- Ветка worktree: `claude/exciting-vaughan-3e478b`; основная — `main`.
- `_bmad-output/story-automator/orchestration-*.md` в статусе M — артефакт автоматора, не трогать.

### Project Structure Notes

- Файловый лимит: нон-тест файлов 5 — `generators/__init__.py` (N), `generators/expense_docx.py` (N), `submissions/expense_document.py` (N), `pyproject.toml` (M), `docs/registries/audit-events.yaml` (M) ≤ 5 ✔; тесты (2 новых файла) вне лимита (правило №4). Миграций нет → правило №2 не задето. Две app — Д2/Q5.
- `generators/` — обычный python-пакет ВНУТРИ app documents (не Django app, не нужен apps.py/INSTALLED_APPS).
- Тесты — в app, чей код проверяют (канон стр. 631): рендерер в `apps/documents/tests/`, билдер+e2e+sync-гвард в `apps/operations/submissions/tests/`.

### References

- [Source: _bmad-output/planning-artifacts/epics.md §Story 6.3 (стр. 831-837); §Epic 6 (стр. 184-187, 811-813); Story 6.4/6.5 — соседние контракты (стр. 839-856); §Правила декомпозиции (стр. 248-254)]
- [Source: _bmad-output/planning-artifacts/prds/prd-VAPS-2026-06-10/addendum.md §8 (стр. 92-99) — ВЕРБАТИМ-канон формата; §3 — иерархия источников (выжимка ТЗ ниже addendum)]
- [Source: _bmad-output/planning-artifacts/prds/prd-VAPS-2026-06-10/prd.md FR-17 (стр. 116) + следствия-формулы; SM-2/SM-3 (стр. 208-209)]
- [Source: _bmad-output/planning-artifacts/architecture.md — дерево стр. 537-539 (documents=генераторы) vs 527-528 (drift, решён по прецеденту 6.2-Д1); границы стр. 585-596 (стрелка documents ← operations, AST-гварды); Data Flow стр. 624; golden master стр. 109/633 (зона 6.8); Layer Contract стр. 444-453; Enforcement стр. 474-481]
- [Source: _bmad-output/planning-artifacts/ux-designs/ux-PersonnelStatus-2026-06-19/.working/extracts/extract-master-spec.md §6.4/§77.3 (лейблы), §9.5/§77.4 (ячейка), §8.5 (cap 20), §8.2/§77.5 (маскирование — к 6.3 не применимо: ИИН в снапшоте нет)]
- [Source: _bmad-output/implementation-artifacts/epic-5-retro-2026-07-08.md — урок №2 (derive-only), №4 (DOCUMENT_*-семя), AI-4 (cross-model гейт 6.3/6.5/6.9), §100/§108 (пины по registry)]
- [Source: _bmad-output/implementation-artifacts/epic-8-retro-2026-07-07.md — урок №3 «registry-версии на дату create-story — обязательный раздел спеки»]
- [Source: Backend/VAPS/apps/operations/statuses/services/strength_report.py:17-77 (приоритеты/маппинг/REPORT_COLUMNS), :80-109 (resolve_status), :141-244 (derive_report); apps/operations/submissions/models/daily_submission.py:29-50 (схема снапшота v1); apps/operations/submissions/traffic_light.py:106-117; apps/migration_legacy/strength_render.py (прообраз рендерера); apps/documents/tests/test_isolation.py (AST-гвард); Backend/VAPS/pyproject.toml:5-21]
- [Source: донор — Backend/PersonnelStatus/Personnel-Records/organization_management/apps/reports/{infrastructure/generators/docx_generator.py — заглушка; utils.py — логика ячеек/ИТОГО; requirements.txt — python-docx==1.2.0}]
- [Source: PyPI python-docx 1.2.0 (2025-06-16, Python ≥3.9) — проверено 2026-07-08]
- Примечание: `docs/PersonnelStatus/VAPS_7.8.2.md` (§77) в репо ОТСУТСТВУЕТ (известный факт двух окружений); §77-контракт взят из выжимки extract-master-spec.md, приоритет отдан addendum §8 по иерархии §3.

### Latest Tech Information (пины по registry на дату create-story, урок E8 №3)

- **python-docx, registry-снимок 1.2.0** (последний релиз PyPI 2025-06-16; Python ≥3.9; донор пинит ту же 1.2.0 — паритет переноса; в pyproject — диапазон `>=1.2,<2` по house style). Тянет `lxml` (C-extension, бинарные wheels manylinux есть) и `typing_extensions`. API стори: `Document()`, `doc.sections[0]` (orientation/page_width/page_height), `add_table`, `cell.paragraphs[0].add_run`, `run.font.name/size/bold`, `Pt`, `WD_ORIENT.LANDSCAPE`, `doc.save(BytesIO)`. Никаких сетевых вызовов; default-template внутри пакета — офлайн-генерация из коробки.
- **API проверено ЭМПИРИЧЕСКИ на create-story (2026-07-08, чистый venv, python-docx==1.2.0)**: landscape требует И `orientation = WD_ORIENT.LANDSCAPE`, И РУЧНОГО свопа `page_width ↔ page_height` (библиотека сама НЕ свопает — без свопа страница останется портретной по размерам); kk-заголовок (Қ/Ұ/Ә-глифы), `font.name="Times New Roman"`, размеры 16/12/8, bold итога и BytesIO round-trip `Document(BytesIO(bytes))` — всё работает как описано. Альтернатива «нулевой зависимости» (ручной OOXML-zip) отклонена: объём/риск вёрстки несоизмеримы, донор-паритет теряется.

### Открытые вопросы (для Bratan — НЕ блокируют, приняты дефолты)

- Q1 (ГЛАВНЫЙ, вёрстка): состав/порядок колонок — подтвердить Д3 (все 11 derive-колонок; «Перед дежурством | Иное | Уточняется» хвостом после §8-набора). Альтернатива — согласовать с заказчиком выпадение этих статусов в «Иное»-агрегат.
- Q2: python-docx тянет lxml (C-extension) — осознанное отступление от openpyxl-прецедента «no C extensions». Ок для air-gap бандла (wheels вендорятся)?
- Q3: «комментарий» в ячейке §8 недостижим из снапшота v1 (Ловушка №6) — оставить без комментария до осознанного бампа схемы? «Фамилия И.О.» — рендерим full_name как есть (без эвристического сокращения)?
- Q4: трактовка «шрифты вендорены» для .docx — имя TNR + офлайн-генерация (Д, Ловушка №10); истинный font-embedding в .docx требует ручного OOXML (python-docx не умеет) — подтвердить, что НЕ нужен.
- Q5 (подтвердить ДО dev-story): две app в одной стори (Д2) — по БУКВЕ правила декомпозиции №3 (две app только при cross-app FK/миграциях) это отступление; подтвердить когезию против сплита 6.3a (билдер) / 6.3b (рендерер).
- Q6: формат даты kk-заголовка — `ДД.ММ.ГГГГ` (Д5) или казахские месяцы прописью (нужен образец заказчика)?
- Q7: сознательные отказы от деталей §77.4 (нумерация членов, appendix, маркер осн.-док., 9pt-база — см. Границы) — подтвердить.

## Senior Developer Review (AI)

### Review Findings (code-review проход 1, 2026-07-08, CROSS-MODEL: Opus 4.8 ×3 слоя — Blind/Edge/Auditor vs dev Fable 5 — гейт ретро AI-4 закрыт)

Acceptance Auditor: **6/6 AC IMPLEMENTED** (пофайловые доказательства до строк), 0 задач [x] без реализации, границы стори целы (git-сверка: миграций нет; derive/resolve_status/snapshot-схема/admin/urls/serializers/error-codes/schema.yaml не тронуты; стрелка documents ← operations соблюдена), все численные претензии Dev Agent Record верны (13+11+9 тестов; A4 landscape Mm(297)×Mm(210); w:cs на каждом run; Д11-распаковка). Гейт независимо перепрогнан ДО патчей: 2022 passed, 29 deselected, 37.28s — цифры Dev Record подтверждены. python-docx 1.2.0 + lxml 6.1.1 в venv подтверждены. 0 CRITICAL · 0 HIGH · 1 MEDIUM (defer 6.5) · 2 patch · 2 dismiss.

- [x] [Review][Patch][Low] Период члена при двух фактах winner-кода с ОДНИМ `date_start` (разные `date_end`, soft-коды — легальное пересечение) зависел от порядка строк снапшота: `min(key=date_start)` при тае берёт первый элемент генератора. Min-ключ расширен до `(date_start, date_end)` — детерминизм отображения, уточнение Д7 + юнит `test_member_period_equal_start_tie_breaks_by_min_date_end` (длинный факт создаётся ПЕРВЫМ — row-order-выбор дал бы 15.07) [apps/operations/submissions/expense_document.py:94-107]
- [x] [Review][Defer][Med] `build_expense_document` отбрасывает `report.violations`/`warnings`: на «донорской грязи» (staff_lt_list) или без staffing-записи (no_staffing_record → Штат 0) официальный документ выйдет с видимо ломаной формулой Штат=Список+Вакансии без сигнала вызывающему. Скоуп-корректно для 6.3 (Д8/Границы: рантайм-ассерт формул перед выпуском — AC стори 6.5; числа для арифметической проверки уже в контракте) → зафиксировано в deferred-work.md, закрыть в 6.5 (ре-derive при выпуске или проброс violations через контракт) [apps/operations/submissions/expense_document.py:70-79]
- [x] [Review][Patch][Low] File List: стори-файл был помечен «modified», по git — untracked new (косметика, класс находок ретро AI-3) [этот файл]
- [x] [Review][Dismiss] Жёсткие подскрипты `snapshot["roster"]`/`snapshot["rows"]` vs `.get(..., [])`-прецедент traffic_light (Blind, Low) — ОСОЗНАННО: громкий KeyError на схемо-нарушающем снапшоте = STOP-семантика официального документа (AC-3); graceful-деградация дашборд-прецедента дала бы тихо пустой официальный лист. Валидный снапшот v1 несёт оба ключа всегда.
- [x] [Review][Dismiss] Blind/Edge подтвердили отсутствие дефектов по всему остальному фронту: cross-assert недостижим на легальном входе (та же группировка, тот же resolve_status), `min()` непуст доказуемо, полуоткрытые интервалы согласованы, python-docx 1.2.0 API верифицирован эмпирически, cap-граница 20/21 корректна, KeyError-поверхность рендерера закрыта sync-гвардом, датаклассы без mutable-утечек, билдер линеен.

`make gate` после патча: **2023 passed, 29 deselected, ~39s** (2022 + 1 ревью-тест); `makemigrations --check` пуст; `ruff format`/`check` — точечно по 2 изменённым файлам (урок 6.1). Регрессия нулевая.

### Review Findings (code-review проход 2, 2026-07-08, независимая переверификация — Opus 4.8 vs dev Fable 5, гейт ретро AI-4 подтверждён)

Повторный adversarial-проход по запросу автоматора. Все материальные claim'ы прохода 1 перепроверены независимо (не доверяя записи), пофайлово против кода:

- **6/6 AC — IMPLEMENTED.** AC-1: A4-landscape (`orientation=LANDSCAPE` + ручной своп `Mm(297)×Mm(210)`), 16/12/8, `font.name`+`w:cs` на КАЖДОМ run (`expense_docx.py:150-233`). AC-2: шапка = `_FIXED_HEAD` + `DOCX_COLUMN_LABELS[DOCX_COLUMNS]` = ровно 17 колонок §8+хвост, ATTACHED→`+N` (`:72,196,208-210`). AC-3: числа = `derive_report` поле-в-поле, исключения не глотаются (`expense_document.py:62-81`). AC-4: группировка по `REPORT_COLUMN_BY_CODE[winner]` (many-to-one), IN_SERVICE без членов и вне cross-assert, cap 20+«… ещё N» (`:87-131`, `expense_docx.py:163-175`). AC-5: чистые функции, ленивый `from docx import` (`:145`), AST-гвард `test_isolation.py` зелён. AC-6: `python-docx>=1.2,<2` + 3 форвард-семени audit-events, без миграций/API-правок.
- **24/24 [x]-подзадачи реально сделаны** (0 ложных отметок); **границы целы** (git-сверка): derive/resolve_status/snapshot-схема/admin/urls/serializers/error-codes/schema.yaml не тронуты, стрелка documents ← operations соблюдена.
- **Инварианты доказаны заново:** `REPORT_COLUMN_BY_CODE[winner]` не KeyError'ит (его 17 ключей == ключам `STATUS_TYPE_PRIORITIES`); `min()` над acting-фактами непуст (resolve_status вернул winner ⇒ ≥1 действующий факт того же кода); `set(DOCX_COLUMNS \ ATTACHED)==REPORT_COLUMNS` (sync-гвард) ⇒ рендерер `row.cells[key]` не падает; ключи roster (`employee_id/full_name/rank`, snapshot.py:59-61) совпадают с подскриптами билдера.
- **Гейт независимо перепрогнан ДО любых правок: 2023 passed, 29 deselected, 50.29s; `makemigrations --check` → «No changes detected»** — цифры Dev Record и прохода 1 подтверждены точь-в-точь. python-docx 1.2.0 + lxml 6.1.1 в venv подтверждены. File List точен (13 записей = git-реальность; `orchestration-*.md` в git-M — артефакт автоматора вне скоупа, корректно не в списке).

**0 CRITICAL · 0 HIGH · 0 новых MEDIUM · 0 fixable.** Единственный MEDIUM (билдер отбрасывает `report.violations`/`warnings`) найден проходом 1 и корректно деферен в 6.5 (deferred-work.md; Д8/Границы — рантайм-ассерт формул перед выпуском = AC 6.5) — скоуп подтверждаю. LOW-наблюдение QA (молчаливо пустой титул при `division_id ∉ division_names`) зеркалит поведение derive (`name=names.get(...,"")`, strength_report.py:207) — не новый дефект; гвард здесь = gold-plating против AC-6 «ничего сверх Границ», закрывается ORM-обвязкой 6.5. Автофикс-режим: правок кода/тестов нет. Status остаётся **done** (0 CRITICAL).

## Dev Agent Record

### Agent Model Used

Claude Fable 5 (claude-fable-5), bmad-dev-story, 2026-07-08.

### Debug Log References

- RED→GREEN без сюрпризов в реализации; две правки на стороне ТЕСТОВ (не кода): (1) габариты секции в OOXML хранятся в twips — точные EMU `Mm(297)` не round-trip'ятся (10692130 ≠ 10692000), сверка переведена на `round(page_width.mm) == 297`; (2) в тесте усечения забыт дефолтный rank хелпера в строке члена — ассерт ослаблен до `in`.
- 93 «errors» при первом прогоне documents-тестов — не регрессия: django_db-тесты без поднятого Postgres (:5433 поднимает Makefile через docker compose). Под гейтом всё зелено.

### Completion Notes List

- **Task 1 (AC-6):** `python-docx>=1.2,<2` в pyproject с комментарием-обоснованием по образцу openpyxl (донор-паритет 1.2.0, registry-снимок 1.2.0; ЧЕСТНО отмечено отступление Q2 — lxml C-extension); установлено в существующий venv worktree (`pip install -e '.[dev]'` → python-docx 1.2.0, lxml 6.1.1).
- **Task 2 (AC-1/2/4/5):** `apps/documents/generators/` — обычный python-пакет с реэкспортом; `expense_docx.py` несёт frozen-датаклассы контракта (ExpenseCellMember/ExpenseCell/ExpenseRow/ExpenseTotals/ExpenseDocumentData), константы вёрстки (DOCX_COLUMNS §8-порядок + хвост Д3, DOCX_COLUMN_LABELS, CELL_MAX_MEMBERS=20, TNR, 16/12/8) и чистый рендерер `generate_expense_docx → bytes` с ленивым импортом python-docx. A4 landscape выставлен ЯВНО (`Mm(297)×Mm(210)` + orientation): дефолтный шаблон — Letter portrait, один своп width↔height дал бы Letter-landscape, а AC-1 требует A4. Шрифт/размер — на каждом run + `w:cs` через rFonts (Ловушка №10). ATTACHED — special-case «+N» вне `cells`; ИТОГО — только числа, все runs bold.
- **Task 3 (AC-3/4/5):** `apps/operations/submissions/expense_document.py` — чистый билдер (зеркало traffic_light/tomorrow_block): ISO-парсинг полуоткрытых интервалов → счётчики/итоги БУКВАЛЬНО из `derive_report` (исключения не глотаются); члены группируются по КОЛОНКЕ `REPORT_COLUMN_BY_CODE[winner]` (many-to-one), период — действующий факт winner-кода с min date_start (Д7); IN_SERVICE — только число (и derived, и EVENT_ASSIGNMENT); cross-assert count==len(members) для всех колонок, кроме IN_SERVICE; Д11 — однострочность через `(report_row,) = report.rows` (громкое падение при misuse staff_map). ORM-обвязка — зона вызывающего (Ловушка №5).
- **Task 4 (AC-1/2/4/5):** 13 чистых тестов рендерера (без django_db): A4 landscape, kk-заголовок 16pt bold, литеральная шапка AC-2 (17 колонок), значения ячеек, «+N», формат строки члена (пустой rank без ведущего пробела), усечение 21→20+«… ещё 1», пустые члены → только число, ИТОГО (числа+bold), порядок строк без пересортировки, явный TNR + канонические размеры на КАЖДОМ run, bytes/zip-смок. AST-гвард изоляции подхватил generators/ сам — зелёный.
- **Task 5 (AC-3/4):** 11 тестов билдера (django_db без transaction=True, снапшот — ТОЛЬКО `build_division_snapshot`): e2e снапшот→билдер→.docx→парсинг с multi-code TRAINING (STUDY+CONFERENCE→одна ячейка), DUTY, VACATION, ATTACHED («+N» вне «По списку») и парой без факта — каждое число документа == полю независимого `derive_report`; юниты: rank из Rank.name, период min-date_start при двух DUTY-фактах, полуоткрытый [start,end) (date_end==business_date не действует), roster-без-факта → IN_SERVICE без членов, EVENT_ASSIGNMENT → IN_SERVICE без членов, cross-assert через monkeypatch derive_report (санкционированная техника), пустой снапшот-литерал → нулевая строка без падения, неизвестный код → ValueError; sync-гвард Д3 (DOCX_COLUMNS == REPORT_COLUMNS+ATTACHED) живёт здесь же.
- **Task 6 (AC-6):** `docs/registries/audit-events.yaml` пополнен форвард-семенем DOCUMENT_GENERATED/DOCUMENT_ISSUED/DOCUMENT_SUPERSEDED (формат — зеркало DOCUMENT_DOWNLOADED, комментарий «форвард-семя E6, эмиссия 6.5»); `ruff format` — точечно по 5 изменённым файлам (урок 6.1); `make gate` зелёный: **2013 passed, 29 deselected, ~38s** (база 6.2: 1989 + 24 новых, ноль регрессий), `makemigrations --check` пуст («No changes detected»); правок urls/views/serializers/admin/seed/schema.yaml/error-codes.yaml НЕТ.
- Дефолты Д1–Д11 применены как записаны; открытые вопросы Q1–Q7 остаются Bratan'у (реализация следует дефолтам). Напоминание ретро AI-4: для 6.3 обязательно cross-model/ultra-ревью — same-model недостаточно.

### File List

- `Backend/VAPS/apps/documents/generators/__init__.py` (new)
- `Backend/VAPS/apps/documents/generators/expense_docx.py` (new)
- `Backend/VAPS/apps/operations/submissions/expense_document.py` (new)
- `Backend/VAPS/apps/documents/tests/test_expense_docx_generator.py` (new, тест)
- `Backend/VAPS/apps/operations/submissions/tests/test_expense_document.py` (new, тест)
- `Backend/VAPS/apps/documents/tests/test_expense_docx_render_contract.py` (new, QA-тест)
- `Backend/VAPS/apps/operations/submissions/tests/test_expense_document_builder_contract.py` (new, QA-тест)
- `Backend/VAPS/pyproject.toml` (modified)
- `docs/registries/audit-events.yaml` (modified)
- `_bmad-output/implementation-artifacts/sprint-status.yaml` (modified — трекинг статуса стори)
- `_bmad-output/implementation-artifacts/tests/test-summary.md` (modified — QA-сводка)
- `_bmad-output/implementation-artifacts/6-3-генератор-docx-перенос-из-донора.md` (new — этот файл, untracked до коммита стори)
- `_bmad-output/implementation-artifacts/deferred-work.md` (modified — дефер ревью для 6.5)

## Change Log

- 2026-07-08 — create-story (Claude Fable 5, #YOLO): стори создана; полный контекст-анализ двумя параллельными research-агентами (донор reports-app + ground-truth Backend/VAPS). ГЛАВНАЯ находка донор-анализа: переносимого DOCX-кода в доноре НЕТ (docx_generator — 12-колоночная заглушка; канон-логика ячеек/ИТОГО — в utils.py, XLSX по отсутствующему шаблону) — стори написана как «канон по addendum §8 + перенос ЛОГИКИ», не «копирование кода». API python-docx 1.2.0 проверено ЭМПИРИЧЕСКИ в чистом venv (landscape = orientation + ручной своп width/height; kk-глифы; 16/12/8; bold; BytesIO round-trip). Fresh-context валидация по checklist.md (независимый агент, все Source-ссылки сверены с точностью до строк) нашла и закрыла 2 CRITICAL: (1) cross-assert count==len(members) гарантированно падал на IN_SERVICE (члены для неё сознательно не собираются) — исключение прописано в AC-4/Task 3/Ловушке №7; (2) группировка членов по winner-КОДУ вместо КОЛОНКИ (`REPORT_COLUMN_BY_CODE` many-to-one: STUDY/COMPETITION/CONFERENCE→TRAINING, EVENT_ASSIGNMENT→IN_SERVICE) не была специфицирована — правило + multi-code e2e-кейс добавлены. Плюс: однострочность документа (Д11), R7-обоснование размещения (Д1), явные отказы §77.4 (Границы, Q7), пин по house style `>=1.2,<2` со снимком 1.2.0, техника негативного теста cross-assert (monkeypatch derive_report). Status: ready-for-dev.
- 2026-07-08 — dev-story (Claude Fable 5): реализация целиком — контракт+рендерер в `apps/documents/generators/` (frozen-датаклассы, чистый `generate_expense_docx` c ленивым python-docx, A4 landscape явными Mm, TNR/16/12/8 на каждом run, «+N», ИТОГО bold, cap 20+«… ещё N»), чистый билдер `apps/operations/submissions/expense_document.py` (данные = derive(снапшот), члены по колонке winner-факта, период min-date_start, IN_SERVICE без членов, cross-assert count==members кроме IN_SERVICE), `python-docx>=1.2,<2` в pyproject, форвард-семя DOCUMENT_GENERATED/ISSUED/SUPERSEDED в audit-events.yaml (эмиссий нет — зона 6.5). Тесты: 13 чистых (рендерер) + 11 django_db (билдер, e2e снапшот→docx против независимого derive_report, sync-гвард Д3). `make gate`: 2013 passed, 29 deselected (~38s; база 1989 + 24 новых, ноль регрессий), `makemigrations --check` пуст. TDD: две правки только на стороне тестов (twips-round-trip габаритов секции; дефолтный rank в тесте усечения). Status: review.
- 2026-07-08 — qa-generate-e2e-tests (Claude Fable 5): мутационный QA-проход (принцип 6.2 «какая правка кода не краснит ни один тест»), 9 судей двумя новыми файлами — `apps/documents/tests/test_expense_docx_render_contract.py` (5: граница cap ровно 20 без хвоста, стиль хвоста усечения 8pt/TNR, w:cs-rFonts казахских глифов на каждом run — Ловушка №10 не судилась вовсе, row-агностичность 0/2 строк + ИТОГО последней, пин «+0») и `apps/operations/submissions/tests/test_expense_document_builder_contract.py` (4: громкое падение Д11 на лишнем ключе staff_map, период из факта winner-КОДА против соседа по колонке TRAINING, член ровно в одной ячейке при SICK_LEAVE+DUTY, первый e2e хвоста Д3 OTHER/BEFORE_DUTY/PENDING+GEV с видимой сходимостью Σ колонок == «По списку» числами из распарсенного .docx). Невакуумность: 2 мутационные пробы (снятие w:cs; `rows[0]` вместо распаковки Д11) — каждая краснит РОВНО своего судью, откачены и сверены grep'ом. `make gate`: **2022 passed, 29 deselected (~38s)** = 2013 + 9 QA, ноль регрессий; `makemigrations --check` пуст; `ruff format` per-file по двум QA-модулям. Прод-код не тронут. Сводка: `_bmad-output/implementation-artifacts/tests/test-summary.md`. Наблюдение для ревью (не дефект): молчаливо пустой титул при отсутствии division_id в division_names — решить в 6.5.
- 2026-07-08 — code-review проход 1 (bmad-story-automator-review; **CROSS-MODEL**: Opus 4.8 ×3 слоя Blind/Edge/Auditor vs dev Fable 5 — гейт ретро AI-4 закрыт, прецедент 5.7c зеркально): Auditor 6/6 AC IMPLEMENTED, 0 ложных [x], границы целы, Dev Record без инфляции (гейт перепрогнан: 2022 passed подтверждено). 0 CRITICAL/HIGH. 2 патча: (1) детерминированный тай-брейк периода члена — min по `(date_start, date_end)` вместо row-order при равных стартах + 12-й тест билдера; (2) косметика File List (стори-файл new, не modified; +deferred-work.md). 1 MEDIUM → defer 6.5 в deferred-work.md: билдер отбрасывает `report.violations`/`warnings` — рантайм-ассерт формул перед выпуском обязан их ловить (Д8-скоуп). 2 dismiss (главный: жёсткие подскрипты снапшота = STOP-семантика, не gap). `make gate`: **2023 passed, 29 deselected (~39s)**, makemigrations пуст, ruff чист. Артефакты ревью НЕ закоммичены. Status: done.
- 2026-07-08 — code-review проход 2 (bmad-story-automator-review, автофикс-режим; независимая переверификация Opus 4.8 vs dev Fable 5): все claim'ы прохода 1 перепроверены пофайлово против кода — 6/6 AC IMPLEMENTED, 24/24 [x] реальны, границы целы, инварианты (KeyError-безопасность `REPORT_COLUMN_BY_CODE`, непустой `min()`, sync-гвард колонок, ключи roster) доказаны заново. Гейт независимо перепрогнан: **2023 passed, 29 deselected, 50.29s**, `makemigrations --check` пуст. 0 CRITICAL/HIGH/новых MEDIUM/fixable; MEDIUM violations/warnings подтверждён как корректный дефер в 6.5. Правок кода нет. Status: done (без изменений).
