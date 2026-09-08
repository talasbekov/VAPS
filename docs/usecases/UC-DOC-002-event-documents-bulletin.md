# UC-DOC-002. Сформировать документ мероприятия, выпустить бюллетень и проверить целостность

| Поле | Значение |
|---|---|
| Модуль | Документы и отчёты |
| Актор | Роли с `event.view` (сборка документов ОМ, чтение выпусков), роли с `event.bulletin` (EVENT_OFFICER, HEAD_OPS_UNIT, EMPLOYEE_OPS_D2 — выпуск бюллетеня), роли с `document.view` (скачивание вложений), оператор сервера (проверка целостности), ADMIN |
| Статус | Done |
| Основание | `apps/ops/documents.py` (`fill_template`, `docx_to_pdf`, `render_docx_from_template`, `render_pdf_from_template`, `stamp_draft`), `apps/ops/document_tables.py`, `apps/ops/documents_registry.py` (`KINDS`, `render`), `documents_summary.py`, `documents_bulletin.py`, `documents_schedules.py`, `documents_placement.py`, `documents_placement_full.py`, `documents_case.py`, `documents_vehicles.py`, `apps/ops/bulletin_issues.py` (`issue_bulletin`, `issue_file`, `parse_as_of`), `apps/operations/document_service.py` (`create_attachment`, `allocate_number`, `verify_integrity`, `prepare_download`), `document_storage.py` (`OPS_PRIVATE_STORAGE_ROOT`, `xaccel_redirect_path`), `docx_fingerprint.py`, `models_document.py` (`OpsAttachment`, `OpsDocumentSequence`, `OpsIssuedDocument`, `OpsBulletinIssue`), `apps/ops/api/views.py::OpsEventDocumentsViewSet` (`GET /api/ops/event-documents/`, `GET …/render/`), `views_bulletin_issues.py::OpsBulletinIssuesViewSet` (`GET/POST /api/ops/bulletin-issues/`, `GET …/{id}/file/`), `apps/operations/api/views.py::AttachmentViewSet` (`GET /api/operations/attachments/{id}/download/`), `management/commands/check_document_integrity.py`, `sync_placement_sections.py`; FRONT `app/security-ops/service-reports/page.tsx` («Документы по мероприятию», «Выпуски бюллетеня»), `hooks/use-ops-reports.ts` (`useEventDocumentKinds`, `useRenderEventDocument`, `useBulletinIssues`, `useIssueBulletin`, `useBulletinIssueFile`), `features/security-event-stages/ui/ApprovalStage.tsx` («Скачать PDF» расстановки), `ClosedView.tsx` («Скачать дело (PDF)»), `app/security-ops/visits/[id]/page.tsx` (сводные данные) |
| Дата актуализации | 2026-09-08 |

## Цель
Актор получает документ мероприятия по шаблону заказчика (docx/pdf), фиксирует выпуск информационного бюллетеня на выбранный срез, а система гарантирует неизменность и целостность выпущенных файлов.

## Предусловия
- Актор аутентифицирован; для сборки — `event.view`, для выпуска бюллетеня — `event.bulletin`, для скачивания вложений `/api/operations/attachments/` — `document.view`.
- Шаблоны `.docx` лежат в `apps/ops/document_templates`; установлены `python-docx` и LibreOffice (`soffice`) для PDF.
- Для документов «по мероприятию» (`summary`, `placement`, `placement_full`, `case`) известен код ОМ; для `placement` при нескольких объектах посещения — `visitObject`.
- Приватное хранилище `OPS_PRIVATE_STORAGE_ROOT` доступно на запись.

## Main Flow
1. Актор открывает «Отчёты службы» → «Документы по мероприятию»; система отдаёт виды документов и форматы (`GET /api/ops/event-documents/`: Сводные данные, Информационный бюллетень, График прибытия, График убытия, Расстановка, Общая расстановка (бланк), Дело объекта, Список броней в ГОН; форматы DOCX/PDF).
2. Актор выбирает вид, при необходимости вводит «Код мероприятия» (`needsEvent`) и «Срез бюллетеня» (`needsAsOf`, `datetime-local`), выбирает формат и нажимает сборку («Собираем…»).
3. Система (`GET …/render/?kind=&event=&asOf=&visitObject=&ext=`) находит сборщик по `kind`, подставляет значения в шаблон (`{{ключ}}`, склейка прогонов Word), размножает строки таблиц, при `ext=pdf` конвертирует через LibreOffice; для несогласованной расстановки ставит штамп «ПРОЕКТ» (`stamp_draft`).
4. Система возвращает JSON `{fileName, contentBase64, contentType}`; браузер сохраняет файл. Те же документы доступны из карточки ОМ: «Скачать PDF» на этапе согласования (`placement`), «Скачать дело (PDF)» в закрытом ОМ (`case`), сводные данные на странице визита (`summary`).
5. Актор в блоке «Выпуски бюллетеня» задаёт срез и нажимает «Выпустить на этот срез».
6. Система (`POST /api/ops/bulletin-issues/ {asOf}`) разбирает срез (дата без времени → 08:00), собирает строки бюллетеня один раз, рендерит PDF вне транзакции, затем в транзакции пишет байты в хранилище (`create_attachment`: sha256 и размер на лету, файл под `storage_key`), создаёт `OpsAttachment` и `OpsBulletinIssue` (срез, кто, снимок строк, число ОМ); пишет `ATTACHMENT_UPLOADED`.
7. Экран перечитывает список выпусков (`GET /api/ops/bulletin-issues/`, новые сверху).
8. Актор нажимает «Скачать PDF» у выпуска; система (`GET …/{id}/file/`) через `prepare_download` сверяет sha256 и размер файла на диске с записью, пишет `DOCUMENT_DOWNLOADED`, отдаёт байты тем же JSON-конвертом.
9. Оператор по расписанию запускает `manage.py check_document_integrity [--division N]`; система обходит все `OpsIssuedDocument`, сверяет вложения (`verify_integrity`), печатает «Проверено выпусков: N» и «Порчи не обнаружено.» либо список испорченных с ненулевым кодом выхода.
10. После пересборки бланка расстановки оператор запускает `manage.py sync_placement_sections` (по умолчанию сухой прогон) — справочник секций приводится к шаблону.

## Alternative Flow
- **AF1. Неизвестный `kind`, не указан обязательный `event`, неверный формат**: шаг 3 → 400 `VALIDATION_ERROR` («Проверьте заполнение формы.»); ОМ не найдено → 404 `ENTITY_NOT_FOUND`.
- **AF2. `placement` при нескольких объектах без `visitObject`**: отказ с просьбой выбрать объект.
- **AF3. В шаблоне остались незаполненные места**: `DomainError` из `_fill_or_fail` (если не `allow_unresolved`); шаблон не найден / LibreOffice не ответил за 60 с или вернул ошибку → `DomainError`.
- **AF4. Дело объекта без `event.manage`**: оценки в документ не включаются (`_may_see_evaluations`), документ собирается.
- **AF5. Срез бюллетеня пуст или нечитаем**: шаг 6 → 400 `VALIDATION_ERROR` (`asOf`); на экране кнопка disabled при пустом срезе.
- **AF6. Нет права `event.bulletin`**: 403; чтение выпусков остаётся под `event.view`.
- **AF7. Выпуск не найден / нечисловой id**: шаг 8 → 404 `ENTITY_NOT_FOUND`.
- **AF8. Байты выпуска не совпали с дайджестом или файл пропал**: `logger.error` + 500 `DOCUMENT_INTEGRITY_FAILED`; файл не выдаётся.
- **AF9. Некорректное имя/тип/пустой файл при записи вложения**: 400 `VALIDATION_ERROR` (`file`); сбой после записи байт — файл-мусор, строка не создаётся.
- **AF10. Ошибка сети/сервера на экране**: сообщения общего канала; кнопки возвращаются в исходное состояние.
- **AF11. Проверка целостности: выпусков нет** → «Выпущенных документов нет — проверять нечего.», код 0.

## Изменения в системе
| Объект | Действие | Описание |
|---|---|---|
| файл документа (render) | read | собирается на лету из шаблона, не хранится |
| приватное хранилище `OPS_PRIVATE_STORAGE_ROOT/{storage_key}` | create | байты PDF выпуска бюллетеня |
| `ops_attachments` | create | `original_name`, `content_type`, `size`, `sha256`, `storage_key` |
| `ops_bulletin_issues` | create | `as_of`, `issued_by`, `rows` (снимок), `event_count`, `attachment` (PROTECT) |
| `ops_audit_log` | create | `ATTACHMENT_UPLOADED` при выпуске; `DOCUMENT_DOWNLOADED` при выдаче байт |
| `OpsPlacementSection` (справочник секций) | create/update | `sync_placement_sections`: новые, подписи, `is_active=False` у снятых |
| HTTP-аудит | create | CREATE на `POST bulletin-issues` |
| Веб-сервер nginx (`X-Accel-Redirect`) | send | отдача байт `/api/operations/attachments/{id}/download/` при `OPS_XACCEL_ENABLED` |

## Бизнес-требования (BR)
- **BR1.** Документы берутся из образцов заказчика как шаблонов; подставляются только значения (`{{ключ}}`), строки таблиц размножаются копией XML с сохранением оформления, строка-образец удаляется.
- **BR2.** Форматов два — docx и pdf; умолчание pdf; параметр `ext`, не `format`.
- **BR3.** Документ отдаётся одним ответом (без очереди) как JSON с base64; прямой ссылки нет.
- **BR4.** Виды по мероприятию требуют код ОМ; бюллетень и графики строятся по всем ОМ на момент среза; `placement` принадлежит объекту посещения.
- **BR5.** Выпуск бюллетеня неизменяем: срез, автор, снимок строк и PDF замораживаются; новый срез — новая строка; удалить выпуск нельзя (PROTECT).
- **BR6.** Транзакция не объемлет конвертацию; строки собираются один раз и передаются отрисовщику.
- **BR7.** Байты пишутся до строки; метаданные строки — единственный источник заголовков и предмет сверки; имя на диске не производно от имени файла.
- **BR8.** Любая выдача байт хранимого документа идёт через `prepare_download`: сверка sha256/размера и запись `DOCUMENT_DOWNLOADED`.
- **BR9.** Нумерация исходящих (`allocate_number`) — транзакционный счётчик по (вид, год) под построчным замком.
- **BR10.** Права: сборка и чтение выпусков — `event.view`; выпуск — `event.bulletin`; оценки в «Деле» — `event.manage`; скачивание вложений — `document.view`.
- **BR11.** Проверка целостности не пишет журнал, не останавливается на первой порче и возвращает ненулевой код при порче.

## Требования к логированию
- Журнал раздела: `ATTACHMENT_UPLOADED` (actor, entity `attachment`), `DOCUMENT_DOWNLOADED` (actor, attachment) — `audit_service.record`.
- Console-логгер `document_service.py`: `logger.error` при расхождении дайджеста/размера и при отсутствии файла (`DOCUMENT_INTEGRITY_FAILED`).
- HTTP-аудит `AuditMiddleware` на `POST bulletin-issues`.
- Сборка документов на лету (`render`) в журнал не пишется — `Не реализовано в коде`; итог `check_document_integrity` — только stdout/код выхода, в БД не фиксируется.

## Требования к правам
| Роль | Доступ | Как обеспечивается |
|---|---|---|
| ADMIN | полный | `*` |
| EVENT_OFFICER, HEAD_OPS_UNIT, EMPLOYEE_OPS_D2 | сборка документов, чтение и выпуск бюллетеня | `event.view` + `event.bulletin` — `OpsBulletinIssuesViewSet.permission_map["create"]` |
| DIRECTORATE_HEAD, DEPARTMENT_EXPENSE_OFFICER, DUTY_OFFICER, OPS_STAFF, PATROL_LEAD, GVO_LEAD, EVENT_APPROVER, DUTY_PLANNER, DUTY_PLAN_APPROVER, OBJECT_KEEPER, RATING_EVALUATOR, ANALYST, AUDITOR, OM_CATEGORY_ORG | сборка документов, список и файл выпусков | `event.view` — `OpsEventDocumentsViewSet`, `OpsBulletinIssuesViewSet` list/file |
| EVENT_OFFICER (`event.manage`) | оценки в «Деле объекта» | `documents_case._may_see_evaluations` |
| Роли с `document.view` | скачивание вложений выпущенных документов | `AttachmentViewSet.permission_map["download"]` |
| Оператор сервера | `check_document_integrity`, `sync_placement_sections` | доступ к `manage.py` |

## Требования к UX/UI
- «Отчёты службы» (`/security-ops/service-reports`) → секция «Документы по мероприятию» (aria «Выгрузка документов ОМ»): селект «Вид документа» («Выберите вид документа», «Загрузка видов документов…»), поле «Код мероприятия» (placeholder `ОМ-2026-1`, обязательно при `needsEvent`), «Срез бюллетеня» (`datetime-local`), «Формат документа», кнопка сборки («Собираем…», disabled при незаполненном обязательном).
- Секция «Выпуски бюллетеня»: срез, кнопка «Выпустить на этот срез» («Выпускаем…», disabled при пустом срезе), «Список выпусков» (срез, кто, когда, число ОМ, имя файла), «Скачать PDF» («Готовим…»), «Загрузка выпусков…».
- Карточка ОМ: этап согласования — «Скачать PDF» расстановки («Собираем…»); закрытое ОМ — «Скачать дело (PDF)» («Сборка дела…»); страница визита — сводные данные PDF.
- Проверка целостности, синхронизация секций, реестр вложений — `Нет пользовательского интерфейса`.

## Открытые вопросы
- Из `in-development.ts` для `/security-ops/service-reports`: «Печать: интервал без года, „Фамилия / позывной“, заголовок среза (№438)»; «„Скачать дело“ одним PDF (№437)» (при этом `kind=case` и кнопка «Скачать дело (PDF)» в `ClosedView` уже есть).
- Выпуск бюллетеня не дедуплицируется и не троттлится (комментарий в `views_bulletin_issues.py`): повторные нажатия плодят неудаляемые выпуски.
- Расписания для `check_document_integrity` нет (`CELERY_BEAT_SCHEDULE` отсутствует) — команда рассчитана на внешний планировщик.
- Выпуск официального документа расхода с номером (`OpsIssuedDocument`, `document_release.py`) и скачивание через `attachments/{id}/download/` (X-Accel) не имеют экрана (см. UC-EXP-004).
- Документы на лету не журналируются — кто и что выгружал, установить нельзя.
- PDF зависит от установленного LibreOffice; отсутствие `soffice` даёт `DomainError` только в момент сборки.
