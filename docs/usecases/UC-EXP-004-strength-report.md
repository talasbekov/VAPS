# UC-EXP-004. Сформировать и выгрузить отчёт о расходе

| Поле | Значение |
|---|---|
| Модуль | Ежедневный расход |
| Актор | Роли со `status.view` (DIRECTORATE_HEAD, DEPARTMENT_EXPENSE_OFFICER, DUTY_OFFICER, HEAD_DEPARTMENT_LINE, ANALYST, AUDITOR и др.); DEPARTMENT_EXPENSE_OFFICER, DUTY_OFFICER, HEAD_DEPARTMENT_LINE, FORCES_GATHERING_OFFICER (выпуск документа, экран /reports); ADMIN |
| Статус | Partial |
| Основание | `apps/operations/strength_report.py` (`StrengthReportService.compute`, `resolve_status`), `apps/operations/expense_release.py` (`build_submitted_expense_document`, `render_expense`, `FORMATS` csv/xlsx/docx/pdf), `expense_document.py`, `expense_docx.py`, `expense_pdf.py`, `expense_xlsx.py`, `expense_csv.py`, `expense_period.py`, `expense_period_csv.py`, `golden.py` + `management/commands/update_golden.py`, `apps/operations/api/views.py::StrengthReportViewSet` (`GET /api/operations/strength-report/`, `/submitted/`, `/export/`, `/period/`, `/period-export/`), `IssuedDocumentViewSet` (`/api/operations/documents/` list/retrieve/`release`/`reissue`), `document_release.py`; `apps/reports` (`Report`, `JobStatus`, `ReportFormat`, `tasks.py::generate_report_task`, `ReportViewSet` `/api/reports/reports/` generate/status/download/`expense/{department_id}/`); FRONT `app/reports/page.tsx`, `hooks/use-strength-report.ts`, `lib/api.ts` (`getStrengthReport`, `getStrengthReportPeriod`, `downloadStrengthReportExport`) |
| Дата актуализации | 2026-09-08 |

## Цель
Актор получает расход (строевую записку) по подразделениям на дату — живой для просмотра и по сданному дню для выгрузки файлом.

## Предусловия
- Актор аутентифицирован, имеет `status.view` (просмотр/выгрузка) и `daily_report.generate` (открытие экрана `/reports`, выпуск документа).
- Для выгрузки и сданного расхода — день подразделения сдан (UC-EXP-001).
- Для живого расхода на будущую дату — нет блокировки завтра (UC-EXP-003).

## Main Flow
1. Актор открывает «Отчёты» (`/reports`), выбирает дату и нажимает загрузку.
2. Система запрашивает живой расход `GET /api/operations/strength-report/?business_date=` (без `division_id` — область сужает сервер).
3. Система считает по каждому подразделению области: Штат (слоты), В списке, Вакансии, Приданные, Вне списка, колонки статусов по справочнику `ops_status_types` (порядок — по приоритету), участие в ОМ; возвращает `columns`, `column_labels`, `rows`, `totals`, `warnings`.
4. Экран показывает таблицу «Подразделение / Штат / В списке / Вакансии / … / На ОМ / Выгрузка».
5. Актор нажимает выгрузку у строки подразделения.
6. Система запрашивает `GET /api/operations/strength-report/export/?division_id=&business_date=&file_format=xlsx`.
7. Система проверяет область и существование подразделения, берёт действующую сдачу дня, строит документ из снимка (список, колонки, поимённый состав) и живых штата/вакансий/приданных, рендерит в запрошенном формате (csv/xlsx/docx/pdf).
8. Браузер сохраняет файл `расход_<подразделение>_<дата>.xlsx`; экран показывает тост «Готово».
9. (API) Для периода актор вызывает `GET /strength-report/period/?date_from=&date_to=` и `/period-export/` (csv, строка на дату).
10. (API) Для официального выпуска актор вызывает `POST /api/operations/documents/release/ {division_id, business_date}`: система берёт замок головы сдачи, выделяет номер `OpsDocumentSequence` (вид «расход», год), рендерит .docx, сохраняет вложение и создаёт `OpsIssuedDocument (ISSUED)`; замена — `POST /documents/reissue/` с `reason`, прежний выпуск → `SUPERSEDED`.

## Alternative Flow
- **AF1. День не сдан**: шаг 7 → 404 `DAY_NOT_SUBMITTED`; экран показывает тост «День не сдан» (не как ошибку).
- **AF2. Чужое подразделение**: 403 (`_assert_division_in_scope` / `_resolve_division_scope`), не пустой отчёт.
- **AF3. Подразделение не найдено**: 404 `ENTITY_NOT_FOUND`.
- **AF4. Снимок ссылается на код вне справочника**: 422 `UNRESOLVABLE_STATUS_TYPE`.
- **AF5. Неизвестный `file_format`**: 400 с `allowed` (csv, docx, pdf, xlsx).
- **AF6. Живой расход на будущую дату при блокировке**: шаг 2 → 422 `TOMORROW_BLOCKED` со списком отстающих; экран печатает сообщение сервера.
- **AF7. Период без одной из дат**: 400 `VALIDATION_ERROR` («Период задаётся обеими датами»).
- **AF8. Выпуск: день не сдан** → 404 `DAY_NOT_SUBMITTED`; уже выпущен → 409 `DOCUMENT_ALREADY_ISSUED`; замена без причины → 400; замена невыпущенного → `DOCUMENT_NOT_ISSUED`.
- **AF9. Нет права `daily_report.generate` на экран** → `OpsAccessDenied`.
- **AF10. Ошибка загрузки** → «Не удалось загрузить расход» / «Не удалось выгрузить расход».

## Изменения в системе
| Объект | Действие | Описание |
|---|---|---|
| живой расход, сданный расход, период | read | вычисляются на чтении из `staff_units`, статусов и снимков сдач |
| файл выгрузки (`export`, `period-export`) | read | собирается на лету, не хранится |
| `ops_attachments` (`OpsAttachment`) | create | байты .docx выпуска в `OPS_PRIVATE_STORAGE_ROOT` (только `release`/`reissue`) |
| `ops_document_sequences` | update | `last_number+1` под построчным замком |
| `ops_issued_documents` | create/update | новый выпуск `ISSUED`; при замене прежний → `SUPERSEDED` |
| `ops_audit_log` | create | `ATTACHMENT_UPLOADED`, `DOCUMENT_ISSUED`, `DOCUMENT_SUPERSEDED` |
| `reports` (`apps/reports.Report`) | create/update | только через `/api/reports/reports/generate/` (Celery `generate_report_task`), клиентом не вызывается |

## Бизнес-требования (BR)
- **BR1.** Штат = число слотов; Список = слоты, занятые работающими минус вне списка; Вакансии = пустые слоты или занятые уволенными; Штат = Список + Вне списка + Вакансии; приданные («+N») в равенство не входят.
- **BR2.** Статусы считаются на дату, штат — сегодняшний (историчности слотов нет).
- **BR3.** Сотрудник без штатной единицы в расход не входит.
- **BR4.** Приоритеты, колонки и их порядок — из справочника `ops_status_types` (`priority`, `report_column_code`, `counts_in_staff`); участие в ОМ — счётчик рядом с колонками, не колонка.
- **BR5.** Живой и сданный расход — разные маршруты с разным набором полей; совпадать обязаны только на нетронутом дне.
- **BR6.** Выгрузка — только по сданному дню; состав и колонки — из снимка, штат/вакансии/приданные — живые.
- **BR7.** Форматов четыре (csv/xlsx/docx/pdf), данные одни; период — только csv.
- **BR8.** Область сужает выборку всегда; без `division_id` — вся область актора.
- **BR9.** Выпуск фиксирует байты, дайджест, номер и версию сдачи; повторный выпуск на день — отказ; замена — новый номер «взамен» с обязательной причиной.
- **BR10.** Эталон печатной формы (`golden.py`) сверяется и обновляется одним кодом (`update_golden`).

## Требования к логированию
- Журнал раздела: `DOCUMENT_ISSUED`, `DOCUMENT_SUPERSEDED`, `ATTACHMENT_UPLOADED` при выпуске; чтение и выгрузка на лету (`export`, `period-export`) в журнал не пишутся.
- HTTP-аудит: только успешные write-запросы (release/reissue, generate в `/api/reports/`).
- Console-логгеров в `strength_report.py`, `expense_release.py` нет.
- Логирование факта выгрузки расхода файлом (кто скачал) — `Не реализовано в коде` (в отличие от `SUBMISSION_EXPORTED` у личной копии сдачи).

## Требования к правам
| Роль | Доступ | Как обеспечивается |
|---|---|---|
| ADMIN | полный | `*` |
| DEPARTMENT_EXPENSE_OFFICER, DUTY_OFFICER, HEAD_DEPARTMENT_LINE, FORCES_GATHERING_OFFICER | экран `/reports`, чтение и выгрузка в области, выпуск/замена документа | `daily_report.generate` (гейт экрана `modulePermissionsOf("/reports")`, `IssuedDocumentViewSet` release/reissue) + `status.view` (`StrengthReportViewSet` все действия) |
| DIRECTORATE_HEAD, ANALYST, AUDITOR, OPS_STAFF, DUTY_PLANNER, HEAD_DIRECTORATE_LINE, HEAD_OPS_UNIT, EMPLOYEE, EMPLOYEE_OPS_D2 | чтение/выгрузка расхода по API в области (экран `/reports` закрыт) | `status.view` |
| Роли с `document.view` | реестр выпущенных документов, скачивание вложения | `document.view` (`IssuedDocumentViewSet` list/retrieve, `AttachmentViewSet.download`) |
| `/api/reports/reports/*` | аутентифицированный; зона по `PermissionService.get_accessible_divisions` | `IsAuthenticated`, `can_access_division` |

## Требования к UX/UI
- Страница «Отчёты» (`/reports`, eyebrow «Ежедневный расход»): выбор даты («Выберите дату»), таблица расхода (Подразделение, Штат, В списке, Вакансии, колонки статусов, «На ОМ», «Выгрузка» с кнопкой xlsx, disabled во время выгрузки); ошибка «Не удалось загрузить расход»; тосты «Готово» / «День не сдан» / «Ошибка».
- Три карточки-заглушки с меткой «В работе» и disabled-кнопками: «Штатное расписание», «Статистика отсутствий», «Журнал действий».
- Выбор формата (csv/docx/pdf), период (`/period`), выпуск и замена официального документа, реестр выпусков — `Нет пользовательского интерфейса`.

## Открытые вопросы
- Экран выгружает только xlsx; docx/pdf/csv и период (`/period`, `/period-export`) доступны только по API.
- Выпуск официального документа с номером (`documents/release`, `reissue`) и реестр выпусков (`GET /api/operations/documents/`) без UI.
- Приложение `apps/reports` (`Report`, Celery `generate_report_task`, `/api/reports/reports/generate|status|download`, `expense/{department_id}/` через `reports/utils.py`) — параллельная реализация отчётов, клиентом не используется; `download` отдаёт `file.url` (публичный MEDIA), а не байты через приватное хранилище; расписания Celery (`CELERY_BEAT_SCHEDULE`) нет.
- Карточки «Штатное расписание», «Статистика отсутствий», «Журнал действий» на `/reports` — заглушки «В работе».
- Экран не обрабатывает 422 `TOMORROW_BLOCKED` отдельно — блокировка завтра показывается как обычная ошибка.
- Расход на прошлую дату использует сегодняшний штат (осознанный компромисс в коде).
