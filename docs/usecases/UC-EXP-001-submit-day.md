# UC-EXP-001. Сдать день расхода

| Поле | Значение |
|---|---|
| Модуль | Ежедневный расход |
| Актор | DIRECTORATE_HEAD (начальник управления), ADMIN |
| Статус | Done |
| Основание | `apps/operations/day_submission_service.py` (`submit_day`), `apps/operations/models_submission.py` (`OpsDailySubmission`, `OpsSubmissionControlSettings`), `apps/operations/api/views.py::DailySubmissionViewSet` (`POST /api/operations/daily-submissions/`, `GET …/{id}/export/`), `apps/ops/api/views.py::OpsDailySubmissionsViewSet` + `apps/ops/daily.py` (`/api/ops/daily/daily-submissions/`), `apps/operations/personal_export_service.py::export_submission`; FRONT `app/employees/page.tsx` (режим без `?view` — «Ежедневный расход организации»), `features/daily-expense/ui/DailyExpenseBoard.tsx`, `features/ops-daily/day-submission-panel.tsx`, `entities/daily-grid/index.ts` |
| Дата актуализации | 2026-09-08 |

## Цель
Начальник управления фиксирует («сдаёт») состояние личного состава своего подразделения за деловую дату как неизменяемый снимок с подписью, временем и отметкой опоздания.

## Предусловия
- Актор аутентифицирован и имеет право `daily_report.mark_update` с областью, включающей подразделение (`_assert_division_in_scope`).
- Подразделение существует в дереве (`DivisionTreeSelector.exists`).
- Деловая дата входит в окно сдачи — сегодня или завтра по часам раздела (`Clock.today_local()`).
- День за это подразделение ещё не сдан ни одной версией (`DailySubmissionSelector.exists_for`).
- Статусы сотрудников на дату проставлены (снимок собирается с серверного состояния, несохранённые правки экрана в него не попадут).

## Main Flow
1. Актор открывает «Ежедневный расход организации» (`/employees` без `?view=`), раскрывает строку своего управления.
2. Система показывает панель «Сдача дня» с состоянием дня и историей сдач подразделения (`GET /api/ops/daily/daily-submissions/?division_id=`).
3. Актор нажимает «Сдать день».
4. Система показывает подтверждение: сколько строк изменено, последняя сдача подразделения, ожидаемая категория события (предварительная оценка).
5. Актор нажимает «Подтвердить сдачу».
6. Система проверяет права и область, существование подразделения, окно дат и отсутствие сдачи за день.
7. Система собирает снимок состава и фактов статусов (`build_division_snapshot`), сравнивает с предыдущей сдачей подразделения и определяет событие: `CHANGED` или `CONFIRMED_NO_CHANGES`.
8. Система вычисляет отметку опоздания: локальное время сдачи строго позже контрольного часа из `OpsSubmissionControlSettings` (по умолчанию 17:00).
9. Система создаёт `OpsDailySubmission` версии 1 (`is_current=True`) и пишет событие журнала `DAILY_SUBMISSION_SUBMITTED`.
10. Система возвращает 201 с проекцией сдачи; экран перечитывает состояние дня и показывает «День сдан: vN · событие · кто · когда».
11. При необходимости актор скачивает личную копию сданного дня (`GET /api/operations/daily-submissions/{id}/export/`, .xlsx); факт выдачи пишется в журнал `SUBMISSION_EXPORTED`.

## Alternative Flow
- **AF1. Не выбрано подразделение / есть несохранённые правки / дата вне окна (клиент)**: шаг 3 → панель показывает причину («Выберите подразделение.», «Сначала сохраните правки: изменено N», «Сдать можно только за сегодня или завтра.»), запрос не уходит.
- **AF2. Нет права или подразделение вне области**: шаг 6 → 403 `PERMISSION_DENIED`; экран: «Недостаточно прав на сдачу дня. Требуется право daily_report.mark_update.»
- **AF3. Подразделение не найдено**: шаг 6 → 404 `ENTITY_NOT_FOUND`; экран: «Подразделение не найдено.»
- **AF4. Дата вне окна сервера**: шаг 6 → 422 `BUSINESS_DATE_OUT_OF_WINDOW` с `details.allowed`; экран печатает допустимые даты из ответа.
- **AF5. День уже сдан**: шаг 6 → 409 `DAY_ALREADY_SUBMITTED`; экран: «День уже сдан. Исправить его можно кнопкой «Исправить сдачу».», состояние перечитывается.
- **AF6. Ошибка формы тела** (нет `division_id`/`business_date`): 400, список деталей на экране.
- **AF7. Гонка двух сдач**: вторая вставка нарушает `unique_ops_submission_current` → IntegrityError → на HTTP-границе 409 `DAY_ALREADY_SUBMITTED`; журнал отклонённой сдачи не пишется.
- **AF8. Сеть / 5xx / 401**: панель молчит (kind `silent`), сообщение отдаёт общий канал ошибок.
- **AF9. Экспорт снимка неподдерживаемой версии схемы**: шаг 11 → 422.

## Изменения в системе
| Объект | Действие | Описание |
|---|---|---|
| `ops_daily_submissions` (`OpsDailySubmission`) | create | версия 1, `is_current=True`, `event`, `submitted_by`, `submitted_at`, `late`, `snapshot` (roster + rows) |
| `ops_audit_log` (`audit_service.record`) | create | `DAILY_SUBMISSION_SUBMITTED`, entity `daily_submission`, `new_value` — снимок сдачи |
| `ops_audit_log` | create | `SUBMISSION_EXPORTED` при выгрузке .xlsx |
| `ops_submission_control_settings` | read | контрольный час для отметки `late` |
| HTTP-аудит (`apps/audit`, AuditMiddleware) | create | запись CREATE на успешный POST |

## Бизнес-требования (BR)
- **BR1.** Сдача допустима только за сегодня или завтра по часам раздела; окно считается на момент вызова.
- **BR2.** Один день подразделения сдаётся один раз; повторная фиксация — только поправка (UC-EXP-002).
- **BR3.** Снимок неизменяем и самодостаточен: расход и светофор выводятся из него без перезапроса живых данных.
- **BR4.** Событие первой сдачи подразделения — всегда `CHANGED`; далее `CONFIRMED_NO_CHANGES`, если состав и факты совпали с предыдущей сдачей (ФИО, звания и id строк не сравниваются).
- **BR5.** `late = true`, если локальное время сдачи строго позже контрольного часа; ровно в контрольный час — не поздно.
- **BR6.** Актор берётся из аутентификации; тело запроса — ровно `division_id` и `business_date`.
- **BR7.** Не более одной текущей версии на (подразделение, день) — держит БД (`unique_ops_submission_current`).
- **BR8.** Чтение сдач — под `status.view`; чужое подразделение — 403, а не пустой список; снимок отдаёт только чтение одной версии.
- **BR9.** PUT/PATCH/DELETE на сдачу не открыты.
- **BR10.** На экране сдача блокируется при несохранённых правках статусов.

## Требования к логированию
- Журнал раздела: `DAILY_SUBMISSION_SUBMITTED` (actor, entity_id = pk сдачи, new_value — снимок) и `SUBMISSION_EXPORTED` при выгрузке — `audit_service.record`.
- HTTP-аудит: `AuditMiddleware` пишет CREATE на успешный POST к `/api/`.
- Console-логгер (`logging.getLogger`) в `day_submission_service.py` отсутствует; отказы (403/409/422) в журнал не пишутся намеренно.
- Логирование отказов сдачи (кто и когда пытался) — `Не реализовано в коде`.

## Требования к правам
| Роль | Доступ | Как обеспечивается |
|---|---|---|
| ADMIN | полный | `*` (wildcard, без области) |
| DIRECTORATE_HEAD | полный (сдача + чтение в своей области) | `daily_report.mark_update` (create), `status.view` (list/retrieve/export); `permission_map` `DailySubmissionViewSet`/`OpsDailySubmissionsViewSet`, область — `_assert_division_in_scope` |
| DEPARTMENT_EXPENSE_OFFICER, DUTY_OFFICER, OPS_STAFF, DUTY_PLANNER, ANALYST, AUDITOR, HEAD_DIRECTORATE_LINE, HEAD_DEPARTMENT_LINE, HEAD_OPS_UNIT, EMPLOYEE, EMPLOYEE_OPS_D2, FORCES_GATHERING_OFFICER | чтение | `status.view` |
| Остальные роли | нет | нет права в `ROLE_PERMISSIONS` |

## Требования к UX/UI
- Страница `/employees` (без `?view=`) — вкладка «Ежедневный расход организации» (`DailyExpenseBoard`); гейт страницы — права `forces.command | forces.allocate | forces.select` (`modulePermissionsOf("/employees")`), гейт борда — `status.view`.
- Строка управления раскрывается; в раскрытой строке — панель «Сдача дня» (`DaySubmissionPanel`), в свёрнутой — бейдж состояния сдачи из общего списочного ответа.
- Панель: кнопка «Сдать день» → блок подтверждения («Сдать день? Изменено N из M…», последняя сдача, ожидаемая категория) с кнопками «Подтвердить сдачу» / «Отмена»; состояния «Загрузка состояния дня…», «Отправка…», «Не удалось прочитать состояние дня.»; после сдачи — «День сдан: vN · …» и кнопка «Исправить сдачу».
- Ошибки: жёлтая плашка (клиентский отказ), красная плашка с сообщением и списком деталей (серверный отказ), «Допустимые даты: …» при 422.
- Отдельная страница /reports использует тот же расход для просмотра и выгрузки (UC-EXP-004).

## Открытые вопросы
- Гейт экрана `/employees` — права сбора сил (`forces.*`), а не `status.view`/`daily_report.mark_update`: роль с правом сдачи, но без `forces.select`, не откроет вкладку расхода (`entities/portal-access`, `OpsAccessDenied what="сбора сил на ОМ"`).
- Панель показывает «Исправить сдачу» без проверки права `daily_report.correct` (комментарий в коде: «Демо-персона wildcard»); отказ приходит только с сервера (403).
- Два маршрута на одну операцию: `/api/operations/daily-submissions/` и адаптер `/api/ops/daily/daily-submissions/` (без `retrieve`/`export`); экран `SummaryVersions` ходит в оба.
- Клиентское окно сдачи считается по браузерной дате, серверное — по часам раздела; истина — `details.allowed` в 422 (отмечено в коде).
