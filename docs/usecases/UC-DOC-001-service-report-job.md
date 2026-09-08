# UC-DOC-001. Запустить служебный отчёт и скачать артефакт

| Поле | Значение |
|---|---|
| Модуль | Документы и отчёты |
| Актор | Роли с `report.generate` (DEPARTMENT_EXPENSE_OFFICER, DUTY_OFFICER, ANALYST, HEAD_OPS_UNIT, OM_CATEGORY_ORG, EMPLOYEE_OPS_D2), ADMIN |
| Статус | Partial |
| Основание | `apps/ops/reports.py` (`create_report_job`, `_advance`, `rerun_report_job`, `download_artifact`, `list_report_types`, `list_report_jobs`, `get_report_job`, `read_report_limits`), `apps/operations/models_report.py` (`OpsServiceReportType`, `OpsServiceReportJob`, `OpsServiceReportArtifact`), `apps/operations/models_settings.py` (`OpsPolicySetting` — пределы периода и срок хранения), `apps/ops/api/views.py::ServiceReportTypesViewSet` (`GET /api/ops/service-report-types/`), `ServiceReportJobsViewSet` (`GET/POST /api/ops/service-report-jobs/`, `GET …/{id}/`, `…/{id}/detail/`, `POST …/{id}/retry/`, `…/{id}/new-revision/`), `ServiceReportArtifactsViewSet` (`POST /api/ops/service-report-artifacts/{id}/download/`); FRONT `app/security-ops/service-reports/page.tsx`, `history/page.tsx`, `[reportJobId]/page.tsx`, `hooks/use-ops-reports.ts`, `entities/service-report/index.ts`, `shared/config/in-development.ts` (№437, №438) |
| Дата актуализации | 2026-09-08 |

## Цель
Актор запускает служебный отчёт за период, дожидается его сборки и скачивает артефакт с учётом маскирования, срока хранения и прав.

## Предусловия
- Актор аутентифицирован, имеет `report.generate`.
- В справочнике есть `OpsServiceReportType` с форматом (сегодня — только `CSV`).
- Политики в «Настройках» заданы: предел периода для типа (`maxPeriodDaysByType`) и срок хранения (`retentionDays`, `policyVersion`); иначе тип помечен `unavailableReason` и не запускается.
- Для sensitive-выгрузки — право `report.export_sensitive`.

## Main Flow
1. Актор открывает «Отчёты службы» (`/security-ops/service-reports`); система показывает типы отчётов (`GET /api/ops/service-report-types/`) с пределами периода и причинами недоступности.
2. Актор выбирает тип, формат, начало и конец периода, при праве — флажок «Включить скрытые поля (sensitive export)», и нажимает запуск («Форма запуска отчёта»).
3. Система (`POST /api/ops/service-report-jobs/`) проверяет: sensitive-право → даты → ключ идемпотентности (клиент строит `type:from:to:S|N:attempt`) → тип → формат → пределы политики → длина периода; при существующем ключе возвращает ту же работу.
4. Система создаёт `OpsServiceReportJob` в `PENDING` с параметрами и кодом `report-job-N`.
5. Экран опрашивает реестр каждые 700 мс, пока есть `PENDING`/`PROCESSING`; при каждом чтении сервер продвигает работу: `PENDING → PROCESSING (50 %) → COMPLETED|FAILED`.
6. На переходе в `COMPLETED` система собирает CSV из смен дежурств (`OpsDutyShift`: дата, сотрудник, объект, пост, состояние; sensitive добавляет «Примечание», «Обоснование обхода»), считает размер и хеш, создаёт `OpsServiceReportArtifact` с ревизией, версиями расчёта/маскирования/удержания и `expires_at = now + retentionDays`.
7. Экран показывает работу с артефактом и действиями, которые считает сервер (`OPEN_PARAMETERS`, `DOWNLOAD`, `RETRY`, `NEW_REVISION`, `VIEW_ERROR`).
8. Актор нажимает «Скачать»; система (`POST /api/ops/service-report-artifacts/{id}/download/`) повторно проверяет sensitive-право, владельца параметров и срок, отдаёт `fileName` и содержимое; браузер сохраняет файл.
9. При необходимости актор открывает «Историю отчётов» (фильтры по состоянию и «мои») или карточку работы (`/security-ops/service-reports/{reportJobId}`) и запускает «Повторить» / «Новая редакция» (`retry` / `new-revision`, тело пустое).

## Alternative Flow
- **AF1. Нет права `report.generate`**: экран `OpsAccessDenied`; API — 403.
- **AF2. sensitive без `report.export_sensitive`**: шаг 3 → 403 `PERMISSION_DENIED` (проверка раньше валидации периода).
- **AF3. Даты нечитаемы / начало позже конца**: 422 `INVALID_PERIOD`; нет ключа: 422 `IDEMPOTENCY_KEY_REQUIRED`; тип неизвестен: 422 `UNKNOWN_REPORT_TYPE`; формат не в списке типа: 422 `UNSUPPORTED_FORMAT`.
- **AF4. Политика молчит**: 422 `PERIOD_LIMIT_UNAVAILABLE` / `RETENTION_UNAVAILABLE`; на экране тип показан с `unavailableReason`, запуск заблокирован.
- **AF5. Период длиннее предела**: 422 `PERIOD_TOO_LONG` («не может превышать N дней»).
- **AF6. Сборка упала / срок хранения исчез к моменту сборки**: работа → `FAILED` с `failure_code` (`ASSEMBLY_FAILED`, `RETENTION_UNAVAILABLE`) и безопасным сообщением; действие `VIEW_ERROR`.
- **AF7. Артефакт просрочен**: скачивание → 422 `ARTIFACT_EXPIRED`; экран — «Срок хранения истёк», кнопка недоступна.
- **AF8. Чужая работа без `report.view_foreign_parameters`**: параметры скрыты (`FOREIGN_PARAMETERS_REASON`), скачивание → 403 (`FOREIGN_DOWNLOAD_REASON`).
- **AF9. Sensitive-работа у актора без sensitive-права**: не видна в списке и по `id` → 404.
- **AF10. `RETRY` незавершённой работы**: 422 `JOB_NOT_FINISHED`; `NEW_REVISION` у не-`COMPLETED`: 422 `NO_BASE_REVISION`; `RETRY` при пригодном артефакте — переиспользование без новой работы («Готовый артефакт с теми же параметрами уже есть — новая работа не запускалась.»).
- **AF11. Работа не найдена**: 404; экран «Работа недоступна».

## Изменения в системе
| Объект | Действие | Описание |
|---|---|---|
| `ops_service_report_jobs` | create | `PENDING`, параметры, `idempotency_key`, `sensitive`, `created_by_*` |
| `ops_service_report_jobs` | update | продвижение состояния на чтении: `state`, `progress_percent`, `completed_at`, `failure_code`, `artifact_code` |
| `ops_service_report_artifacts` | create | CSV-содержимое, `revision`, версии политик, `file_size`, `hash`, `expires_at` |
| `ops_policy_settings` / `ops_policy_section_versions` | read | пределы периода, срок хранения и версия политики |
| `OpsDutyShift` | read | источник строк отчёта |
| HTTP-аудит (`AuditMiddleware`) | create | CREATE на успешные POST (создание, retry, new-revision, download) |

## Бизнес-требования (BR)
- **BR1.** Порядок проверок при запуске: право → sensitive-право → параметры → тип/формат → политика → длина периода.
- **BR2.** Повтор с тем же `idempotencyKey` не создаёт вторую работу.
- **BR3.** Формат — только те, что тип реально формирует (`formats`); сегодня `CSV`; PDF/XLSX/DOCX без реализации не показываются (`UNAVAILABLE_FORMATS`).
- **BR4.** Обычный экспорт не содержит колонок скрытых полей вовсе; sensitive добавляет их и требует `report.export_sensitive`.
- **BR5.** Артефакт формируется ровно на переходе в `COMPLETED` и не меняется; версии расчёта, маскирования, удержания замораживаются в артефакте.
- **BR6.** Срок доступности считает сервер (`expires_at`); просроченный артефакт не выдаётся.
- **BR7.** Скачивание — отдельная операция с повторной проверкой прав, владельца и срока; отдаётся содержимое, постоянной ссылки нет.
- **BR8.** Действия строки считает сервер; клиент не решает доступность кнопок сам.
- **BR9.** `RETRY` возвращает пригодный артефакт серии, если он есть; `NEW_REVISION` собирает заново всегда с `revision+1`.
- **BR10.** Параметры чужой работы видны только с `report.view_foreign_parameters`; без него и скачивание чужого запрещено.

## Требования к логированию
- HTTP-аудит `AuditMiddleware` на успешные POST.
- Console-логгера в `apps/ops/reports.py` нет; события `audit_service` (запуск, скачивание отчёта) — `Не реализовано в коде`.
- Факт скачивания артефакта (кто, когда) в журнале раздела — `Не реализовано в коде`; сбой сборки хранится в самой работе (`failure_code`, `safe_failure_message`).

## Требования к правам
| Роль | Доступ | Как обеспечивается |
|---|---|---|
| ADMIN | полный, включая sensitive и чужие параметры | `*` |
| DEPARTMENT_EXPENSE_OFFICER, DUTY_OFFICER, ANALYST, HEAD_OPS_UNIT, OM_CATEGORY_ORG, EMPLOYEE_OPS_D2 | запуск, список, карточка, retry/new-revision, скачивание своих | `report.generate` — `permission_map` всех трёх вьюсетов; фильтр видимости `_is_job_visible`, `_can_see_parameters` |
| Право `report.export_sensitive` | sensitive-выгрузка, видимость sensitive-работ | `permission_bypass_map` (расширяющее право), проверка в `create_report_job`/`download_artifact`; в `ROLE_PERMISSIONS` ни одной роли не выдано (только ADMIN через `*`) |
| Право `report.view_foreign_parameters` | параметры и файл чужих работ | проверка в `_can_see_parameters`; ролям не выдано |
| Остальные | нет | — |

## Требования к UX/UI
- Страница «Отчёты службы» (`/security-ops/service-reports`, eyebrow «Охранные мероприятия», метка «В разработке» №437, №438): навигация «Разделы отчётов»; «Форма запуска отчёта» — тип, формат, «Начало периода», «Конец периода», флажок sensitive (disabled без `canExportSensitive`), подсказка «Период — не длиннее N дней», `unavailableReason` вместо кнопки; блок «Работы и артефакты» с опросом («Загрузка реестра…», «Артефакт ещё не сформирован — отчёт готовится на сервере.», «Готовим…», «Повторить», «Повторяем…», «Срок хранения истёк»).
- «История отчётов» (`/security-ops/service-reports/history`): фильтры «Состояние работы» (Все состояния…) и «мои»; таблица Отчёт / Период / Формат / Состояние / Редакция / Режим выгрузки / Маскирование / Расчёт / Размер / Срок доступности / Сформировал / Создан / Ключ идемпотентности / Действия; пусто — «Отчёты ещё не запускались.» / «По выбранным фильтрам работ нет.».
- Карточка работы (`/security-ops/service-reports/{reportJobId}`): «Состояние работы», «Параметры запуска», «Артефакт», «Действия работы», «Чего в этой карточке нет»; «Работа недоступна» при 404.
- Опрос не идёт на скрытой вкладке.

## Открытые вопросы
- Из `in-development.ts`: «Печать: интервал без года, „Фамилия / позывной“, заголовок среза (№438)»; «„Скачать дело“ одним PDF (№437)» — отмечено на экране меткой «В разработке».
- Единственный формат — CSV; PDF/XLSX/DOCX объявлены недоступными с причинами (`UNAVAILABLE_FORMATS`), водяной знак в артефакте отсутствует.
- Фонового исполнителя нет: состояние продвигается при чтении (комментарий «упрощён ИСПОЛНИТЕЛЬ»); без опроса клиентом работа остаётся `PENDING`.
- Права `report.export_sensitive` и `report.view_foreign_parameters` не выданы ни одной роли в `seed_operations.py` — работают только у ADMIN.
- Источник данных отчёта — смены дежурств (`OpsDutyShift`), а не расход личного состава; тип назван «Расход личного состава» по §22.
- Отдельный реестр отчётов `apps/reports` (`/api/reports/`) с Celery-задачей — вторая, несвязанная реализация (см. UC-EXP-004).
