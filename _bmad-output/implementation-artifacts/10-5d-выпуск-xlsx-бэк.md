---
baseline_commit: 37dbfe3
---

# Story 10.5d: Выпуск .xlsx — бэк

Status: done

## Story

As a **руководитель**,
I want **выпускать официальный расход И в .xlsx, не только в .docx**,
so that **я могу получить номерной документ в формате, удобном для дальнейшей табличной обработки, без потери юридической силы (тот же номер/цепочка/аудит)**.

## Acceptance Criteria

Источник: `_bmad-output/implementation-artifacts/sprint-status.yaml:395-397` («10.5d — БЭК: .xlsx. `generate_expense_xlsx` существует, но `issue_expense_document` зовёт `generate_expense_docx` БЕЗУСЛОВНО; format-параметра нет. Вторая половина epic-AC «.docx/.xlsx»») и докстринг `frontend/src/features/expense/ExpenseReportPage.tsx:6-8` (фантом №1 — переключатель формата, названа стори-преемник для БЭКА).

1. **AC-1 (`issue_expense_document` принимает `format`).** Given вызов с `format="xlsx"`, Then сервис зовёт `generate_expense_xlsx` (не `generate_expense_docx`), `Attachment.content_type` — `application/vnd.openxmlformats-officedocument.spreadsheetml.sheet` (та же константа, что уже используется для .xlsx в `views.py:104` — `_XLSX_CONTENT_TYPE`), имя файла — `расход_{дата}_исх-{number}.xlsx` (расширение меняется, остальной паттерн имени — БЕЗ изменений). Given `format` не передан (или `"docx"`), Then поведение ИДЕНТИЧНО сегодняшнему (backward-compatible дефолт — вызовы БЕЗ параметра из существующих тестов/кода продолжают работать).
2. **AC-2 (невалидный format → 400, ДО генерации/номера).** Given `format` вне `{"docx", "xlsx"}`, Then `DomainError("VALIDATION_ERROR", 400, ...)` — гвард СРАЗУ после `_require_actor`, ДО `transaction.atomic()`-блока с локами/generate/allocate_number (мусорный ввод не должен трогать счётчик документов).
3. **AC-3 (номер/цепочка/статус — формат-агностичны).** `DocumentSequence`/`allocate_number`, `supersedes`-цепочка, `IssuedDocument.status` (ISSUED/SUPERSEDED) — БЕЗ изменений логики: формат влияет ТОЛЬКО на байты файла и `Attachment.content_type`/`original_name`. `IssuedDocument` НЕ получает нового поля «формат» (модель и так узнаёт формат через `attachment.content_type`/`original_name` — дублировать в отдельной колонке избыточно).
4. **AC-4 (HTTP-поверхность — опциональный `format` в теле POST).** `ExpenseReportIssueSerializer` несёт `format` (`ChoiceField(choices=["docx","xlsx"], required=False, default="docx")`) — тело `{division_id, business_date}` (без `format`) продолжает работать ИДЕНТИЧНО (AC-1's backward-compat распространяется на HTTP-слой).
5. **AC-5 (RBAC/схема).** Право/гейт `create`-экшена — БЕЗ изменений (`daily_report.generate`, тот же). `schema.yaml`/`schema.d.ts` несут обновлённый `ExpenseReportIssueRequest` (с `format`).
6. **AC-6 (регресс нулевой).** ВСЕ существующие вызовы `issue_expense_document` (без `format`) и существующие HTTP-тесты (тело без `format`) — БЕЗ изменений поведения. `make gate` зелёный.

## Tasks / Subtasks

- [x] Task 1 — `format`-параметр сервиса (`Backend/VAPS/apps/operations/submissions/services/document_release_service.py`, MOD) (AC: 1, 2, 3)
  - [x] Сигнатура: `issue_expense_document(*, division_id, business_date, actor, format="docx")`.
  - [x] Гвард ПЕРЕД `transaction.atomic()`: `if format not in ("docx", "xlsx"): raise DomainError("VALIDATION_ERROR", 400, detail={"format": format}, message="Неизвестный формат документа.")`.
  - [x] Локальная константа `_XLSX_CONTENT_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"` (та же строка, что `views.py:104` — модуль другой, копия строки, не импорт: `document_release_service.py` не должен тянуть `apps/operations/submissions/api/views.py`, направление зависимости).
  - [x] Импорт `generate_expense_xlsx` из `apps.documents.generators` (рядом с существующим `generate_expense_docx`).
  - [x] Ветвление ПЕРЕД `original_name`/`create_attachment` (сейчас — `views.py:250,288,295` эквивалент в сервисе): `file_bytes = generate_expense_xlsx(data) if format == "xlsx" else generate_expense_docx(data)`; `extension = "xlsx" if format == "xlsx" else "docx"`; `content_type = _XLSX_CONTENT_TYPE if format == "xlsx" else _DOCX_CONTENT_TYPE`; `original_name = f"расход_{business_date.isoformat()}_исх-{number}.{extension}"`.
- [x] Task 2 — HTTP-форма (`Backend/VAPS/apps/operations/submissions/api/serializers.py`, MOD) (AC: 4)
  - [x] `ExpenseReportIssueSerializer`: `format = serializers.ChoiceField(choices=["docx", "xlsx"], required=False, default="docx")`.
- [x] Task 3 — Вкрутка в `create`-экшен (`Backend/VAPS/apps/operations/submissions/api/views.py`, MOD) (AC: 4, 5)
  - [x] `issue_expense_document(..., format=form.validated_data["format"])` (`default="docx"` сериализатора гарантирует ключ ВСЕГДА присутствует в `validated_data`).
- [x] Task 4 — Регенерация схемы (AC: 5)
  - [x] `make schema` (Backend/VAPS) + `cd frontend && npm run generate:api`.
- [x] Task 5 — Тесты (AC: 1-6)
  - [x] Сервис-уровень (`Backend/VAPS/apps/operations/submissions/tests/test_document_release.py`, MOD или новый файл): `format="xlsx"` → `Attachment.content_type` == xlsx-константа, `original_name` оканчивается `.xlsx`, байты — валидный .xlsx (та же openpyxl-проверка, что существующие xlsx-генератор-тесты); `format` не передан → байты/content-type/имя ИДЕНТИЧНЫ существующему поведению (regression pin); `format="pdf"` (невалидный) → `DomainError` 400 ДО транзакции — `IssuedDocument.objects.count()`/`DocumentSequence`-счётчик НЕ выросли (AC-2's «до номера»).
  - [x] HTTP-уровень (`Backend/VAPS/apps/operations/submissions/tests/test_expense_report_api.py`, MOD): POST с `format: "xlsx"` в теле → 201, `content_type` в ответе точки чтения соответствует; POST БЕЗ `format` → 201, поведение как раньше (regression pin существующего теста — не менять, просто подтвердить в Dev Record, что не тронут).
- [x] Task 6 — Гейт (AC: 6)
  - [x] `make gate` (Backend/VAPS).

## Dev Notes

- **`generate_expense_xlsx` УЖЕ существует и протестирован (Story 6.4)** — эта стори НЕ пишет рендерер, только подключает его к сервису выпуска условно. `apps/documents/generators/expense_xlsx.py:58` — сигнатура `ExpenseDocumentData -> bytes`, ТОТ ЖЕ вход, что `generate_expense_docx` (оба принимают `data` из `build_expense_document`, `document_release_service.py:241-248`, — эта часть пайплайна формат-агностична и НЕ меняется).
- **`IssuedDocument` модель НЕ меняется (нет миграции).** Формат документа полностью выводится из `attachment.content_type`/`attachment.original_name` — заводить отдельную колонку `format` на `IssuedDocument` было бы дублированием источника истины (тот же принцип, что `reason`/`supersedes` уже живут БЕЗ дублирования в `IssuedDocument` напрямую там, где Attachment уже несёт нужное).
- **UI-переключателя формата в ЭТОЙ стори НЕТ — сознательный вырез, не забытая часть.** Докстринг `ExpenseReportPage.tsx:6-8` называет ТОЛЬКО «10.5d (бэк)» преемником фантома №1 — сам UI-тумблер `.docx/.xlsx` не назван ни в одной будущей стори роадмапа на момент создания этой. Бэк готов принять `format`, HTTP-поверхность готова — фронт продолжает слать тело БЕЗ `format` (дефолт `docx` на сериализаторе), поведение экрана `/reports` не меняется НИКАК. UI-тумблер — кандидат в отдельную стори при реальной потребности (тот же паттерн, что UI-пагинация журнала в 10.5c).
- **Гвард формата — ДО транзакции, не внутри.** Все остальные гварды `issue_expense_document` (schema version, release-ассерт, already-issued) стоят ВНУТРИ `transaction.atomic()`, потому что зависят от данных, прочитанных под локом. `format` — чистый ввод-параметр, не требующий БД вовсе — гвард ДО блокировки экономит захват submission-лока на заведомо мусорном вводе (тот же принцип, что `_require_actor` уже стоит первой строкой функции, ДО `transaction.atomic()`).

### References

- [Source: _bmad-output/implementation-artifacts/sprint-status.yaml:395-397] — постановка, независимость от 10.5a/b/c.
- [Source: Backend/VAPS/apps/documents/generators/expense_xlsx.py] — `generate_expense_xlsx` (Story 6.4, уже существует, переиспользуется буквально).
- [Source: Backend/VAPS/apps/operations/submissions/services/document_release_service.py:153-320] — `issue_expense_document`, точка врезки ветвления (после `_assert_matches_derive`, до `create_attachment`).
- [Source: Backend/VAPS/apps/operations/submissions/api/views.py:104,239,265] — `_XLSX_CONTENT_TYPE` (существующая константа, тот же литерал переиспользуется в сервисе).
- [Source: Backend/VAPS/apps/operations/submissions/api/serializers.py:93-101] — `ExpenseReportIssueSerializer` (точка врезки поля `format`).
- [Source: frontend/src/features/expense/ExpenseReportPage.tsx:1-9] — докстринг, фантом №1, прямо называющий 10.5d преемником (только бэк).

## Dev Agent Record

### Agent Model Used

claude-sonnet-5

### Debug Log References

### Completion Notes List

- `format` — новый именованный аргумент функции (тень встроенного `format()` в теле функции — не вызывается внутри неё, ruff молчит, конфликта нет).
- Гвард формата — ДО `transaction.atomic()` (AC-2), после `_require_actor` — та же позиция в теле функции, что уже устоявшийся паттерн для чистых input-гвардов.
- `_XLSX_CONTENT_TYPE` — копия строкового литерала из `views.py:104`, НЕ импорт (направление зависимости: сервис-слой не должен тянуть API-слой).
- Ветвление байтов/content-type/имени — единый `if format == "xlsx"` в трёх местах (генератор, content_type, extension), не дублирует остальную формат-агностичную часть пайплайна (`build_expense_document`/`_assert_matches_derive`/`allocate_number`/`supersedes`-цепочка — без изменений).
- HTTP-слой: `ExpenseReportIssueSerializer.format` — `ChoiceField` с `default="docx"`, поэтому невалидный `format` (напр. `"pdf"`) отклоняется УЖЕ на границе сериализатора (400 до вызова сервиса) — тот же итоговый код 400, что и внутренний гвард сервиса при прямом service-level вызове (двойная защита: HTTP формы + доменной функции, консистентно с остальными полями этого сериализатора).
- `IssuedDocument` модель НЕ менялась — миграций нет, подтверждено `makemigrations --check` (пусто).
- Регресс: `apps/operations`+`apps/documents`+`apps/core/test_schema_drift`+`apps/audit` — 2080 passed, 6 ERROR (те же документированные concurrency-teardown флейки — не регрессия). `ruff check apps/` чист. Frontend `npm run gate` — 916 тестов, tsc/eslint/build/size-gate (210.5 KB gzip / 300 бюджет) зелёные (новое поле `format` — опциональное на request-стороне, ripple-фикса не потребовалось, в отличие от 10.5b).

**Ревью (3-агентное: Blind Hunter / Edge Case Hunter / Acceptance Auditor) — 6/6 AC SATISFIED, 0 багов:**
- Все три слоя независимо подтвердили: guard-позиция ДО транзакции корректна (нет захвата submission-лока на мусорном формате), backward-compat дефолт работает (единственный существующий caller — сам этот диф, HTTP-слой всегда прокидывает `format` через `validated_data` с дефолтом), `_XLSX_CONTENT_TYPE` байт-в-байт совпадает с `views.py:104`, оба генератора принимают идентичную сигнатуру `(data)`, тест `test_issue_xlsx_format` корректно проверяет `workbook.active.title` против реального поведения генератора (`sheet.title = business_date.isoformat()`).
- Acceptance Auditor независимо перепрогнал `ExpenseReportIssueSerializer(data={..., "format": "pdf"})` вживую — подтвердил заявление Completion Notes: HTTP-невалидный `format` отклоняется сериализатором ДО вызова сервиса, а `test_issue_invalid_format_400` (HTTP) и `test_issue_invalid_format_400_before_transaction` (прямой сервис-вызов) кроют ДВА РАЗНЫХ гварда — не задваивают покрытие одного и того же кода, framing «двойная защита» точен.
- Ни одной реальной находки — редчайший случай для этой сессии (3-агентное ревью впервые за много стори не нашло ни одного бага).

### File List

- `Backend/VAPS/apps/operations/submissions/services/document_release_service.py` (MOD) — `format`-параметр, гвард, ветвление генератора/content-type/имени.
- `Backend/VAPS/apps/operations/submissions/api/serializers.py` (MOD) — `ExpenseReportIssueSerializer.format`.
- `Backend/VAPS/apps/operations/submissions/api/views.py` (MOD) — проброс `format` в `issue_expense_document`.
- `Backend/VAPS/schema.yaml` (регенерирован).
- `frontend/src/shared/api/schema.d.ts` (регенерирован).
- `Backend/VAPS/apps/operations/submissions/tests/test_document_release.py` (MOD) — `_issue`-хелпер +`format`-параметр, 3 новых теста.
- `Backend/VAPS/apps/operations/submissions/tests/test_expense_report_api.py` (MOD) — 2 новых HTTP-теста.
