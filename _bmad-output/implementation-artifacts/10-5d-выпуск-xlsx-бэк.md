---
baseline_commit: 37dbfe3
---

# Story 10.5d: Выпуск .xlsx — бэк

Status: ready-for-dev

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

- [ ] Task 1 — `format`-параметр сервиса (`Backend/VAPS/apps/operations/submissions/services/document_release_service.py`, MOD) (AC: 1, 2, 3)
  - [ ] Сигнатура: `issue_expense_document(*, division_id, business_date, actor, format="docx")`.
  - [ ] Гвард ПЕРЕД `transaction.atomic()`: `if format not in ("docx", "xlsx"): raise DomainError("VALIDATION_ERROR", 400, detail={"format": format}, message="Неизвестный формат документа.")`.
  - [ ] Локальная константа `_XLSX_CONTENT_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"` (та же строка, что `views.py:104` — модуль другой, копия строки, не импорт: `document_release_service.py` не должен тянуть `apps/operations/submissions/api/views.py`, направление зависимости).
  - [ ] Импорт `generate_expense_xlsx` из `apps.documents.generators` (рядом с существующим `generate_expense_docx`).
  - [ ] Ветвление ПЕРЕД `original_name`/`create_attachment` (сейчас — `views.py:250,288,295` эквивалент в сервисе): `file_bytes = generate_expense_xlsx(data) if format == "xlsx" else generate_expense_docx(data)`; `extension = "xlsx" if format == "xlsx" else "docx"`; `content_type = _XLSX_CONTENT_TYPE if format == "xlsx" else _DOCX_CONTENT_TYPE`; `original_name = f"расход_{business_date.isoformat()}_исх-{number}.{extension}"`.
- [ ] Task 2 — HTTP-форма (`Backend/VAPS/apps/operations/submissions/api/serializers.py`, MOD) (AC: 4)
  - [ ] `ExpenseReportIssueSerializer`: `format = serializers.ChoiceField(choices=["docx", "xlsx"], required=False, default="docx")`.
- [ ] Task 3 — Вкрутка в `create`-экшен (`Backend/VAPS/apps/operations/submissions/api/views.py`, MOD) (AC: 4, 5)
  - [ ] `issue_expense_document(..., format=form.validated_data["format"])` (`default="docx"` сериализатора гарантирует ключ ВСЕГДА присутствует в `validated_data`).
- [ ] Task 4 — Регенерация схемы (AC: 5)
  - [ ] `make schema` (Backend/VAPS) + `cd frontend && npm run generate:api`.
- [ ] Task 5 — Тесты (AC: 1-6)
  - [ ] Сервис-уровень (`Backend/VAPS/apps/operations/submissions/tests/test_document_release.py`, MOD или новый файл): `format="xlsx"` → `Attachment.content_type` == xlsx-константа, `original_name` оканчивается `.xlsx`, байты — валидный .xlsx (та же openpyxl-проверка, что существующие xlsx-генератор-тесты); `format` не передан → байты/content-type/имя ИДЕНТИЧНЫ существующему поведению (regression pin); `format="pdf"` (невалидный) → `DomainError` 400 ДО транзакции — `IssuedDocument.objects.count()`/`DocumentSequence`-счётчик НЕ выросли (AC-2's «до номера»).
  - [ ] HTTP-уровень (`Backend/VAPS/apps/operations/submissions/tests/test_expense_report_api.py`, MOD): POST с `format: "xlsx"` в теле → 201, `content_type` в ответе точки чтения соответствует; POST БЕЗ `format` → 201, поведение как раньше (regression pin существующего теста — не менять, просто подтвердить в Dev Record, что не тронут).
- [ ] Task 6 — Гейт (AC: 6)
  - [ ] `make gate` (Backend/VAPS).

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

### File List
