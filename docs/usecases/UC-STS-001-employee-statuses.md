# UC-STS-001. Проставить и изменить статусы сотрудников, в том числе массово

| Поле | Значение |
|---|---|
| Модуль | Статусы и дежурства |
| Актор | Держатель `status.manage` (`DIRECTORATE_HEAD`, `HEAD_DIRECTORATE_LINE`, `HEAD_DEPARTMENT_LINE`, `HEAD_OPS_UNIT`, `INTEGRATION_USER`) — запись; держатель `status.view` — чтение; `ADMIN` |
| Статус | Done |
| Основание | `apps/operations/status_service.py` (`create_status`, `update_status`, `complete_status_early`, `extend_status`, `cancel_status`, `resolve_placeholder`), `bulk_status_service.py` (`bulk_create_statuses`), `conflict_matrix.py` (`HARD_STATUS_TYPE_CODES`, `detect_conflicts`), `status_merge.py`, `models_status.py` (`OpsEmployeeStatus`, `LifecycleState`, `StatusOverride`, `OpsStatusParticipation`), `apps/operations/api/views.py` (`StatusViewSet` — `create`/`partial_update`/`cancel`/`complete`/`extend`/`resolve`/`bulk`), `apps/operations/api/serializers.py` (`StatusCreateSerializer`, `StatusUpdateSerializer`, `StatusCancelSerializer`, `StatusCompleteSerializer`, `StatusResolveSerializer`), `apps/ops/api/views.py` (`OpsDailyBulkViewSet`, `/api/ops/daily/statuses-bulk/`), `apps/statuses/api/views.py` (`EmployeeStatusViewSet`, `WRITE_PERMISSION`), `apps/statuses/application/services.py` (`StatusApplicationService`), `apps/statuses/participation_guard.py`, `apps/staff_unit/views.py` (`_directorate_update`, `_refuse_participation_status`), FRONT `app/statuses/page.tsx`, `components/status-table.tsx`, `features/employee-status-update/ui/{EditStatusDialog,MassStatusUpdate,PlannedStatusesDialog,DutyAssignmentFields}.tsx`, `model/{edit-status-schema,mass-status-schema}.ts`, `features/ops-conflict-override/ui/ConflictDialog.tsx`, `hooks/use-ops-status-write.ts`, `lib/ops-errors.ts` (`OVERRIDABLE_CODES`), `lib/api.ts` |
| Дата актуализации | 2026-09-08 |

## Цель
Актор проставляет сотруднику своей области статус на период (отпуск, больничный, командировка, дежурство, участие в ОМ и т.д.), правит, продлевает, завершает или отменяет его, а также применяет один статус к нескольким сотрудникам разом.

## Предусловия
- Актор вошёл в систему; у него есть `status.manage` с областью, включающей подразделение сотрудника (для чтения — `status.view`).
- Сотрудник работает (`employment_status=WORKING`) и не откомандирован (статус `DETACHED` с `restricts_editing`).
- Справочник типов статусов заполнен (`seed_status_types`).

## Main Flow
1. Актор открывает «Статусы сотрудников» (`/statuses`, вкладка «Таблица сотрудников») — система показывает штат области (`GET /api/staff_unit/staff-units/directorate/`) с колонками «Статус (кадровый)», «По разделу ОМ», «Обновлён», «Следующий».
2. Актор нажимает «Изменить статус» у сотрудника — открывается диалог «Статусы сотрудника» с выбором типа, датами начала/окончания, комментарием; для «На дежурстве» — тип дежурства, объект, пост/группа; для «Участие в ОМ» — выбор мероприятий из запросов сбора сил.
3. Актор сохраняет — система для обычных типов пишет кадровый статус `POST /api/statuses/statuses/` (`StatusApplicationService.create_status`: закрывает текущий активный статус днём раньше, создаёт новый, пишет `StatusChangeHistory`); для участия в ОМ — `POST /api/operations/statuses/` с `participations[]`.
4. Актор открывает «Запланированные статусы» сотрудника — система показывает `GET /api/statuses/statuses/planned/?employee_id=` и строки раздела ОМ (`GET /api/operations/statuses/?employee_id=`); актор продлевает (`POST …/{id}/extend/`), завершает досрочно (`POST …/{id}/terminate/` с причиной), отменяет (`POST …/{id}/cancel/` с причиной) или правит (`PATCH …/{id}/`).
5. Актор переходит во вкладку «Массовое обновление», отмечает сотрудников в таблице, выбирает статус, период, комментарий и нажимает «Применить».
6. Система выполняет `PUT /api/staff_unit/staff-units/directorate/` с `employee_statuses[]` — по одной строке на сотрудника; каждая строка проверяется по праву `status.manage` и области, участие в ОМ отбивается.
7. Система показывает итог: сколько статусов применено, список отказов по строкам; локальные назначения на дежурство у обновлённых снимаются.
8. Оператор расхода (экран «Расход дня») ставит статусы пакетом моделью раздела: `POST /api/ops/daily/statuses-bulk/` (`business_date`, строки `employee_id`/`status_type_code`/`date_start`/`date_end`) — `bulk_create_statuses` проверяет область, дубли, конфликты и пишет `OpsEmployeeStatus` с аудитом.
9. По одиночным маршрутам раздела актор правит строку `OpsEmployeeStatus`: `PATCH /api/operations/statuses/{id}/`, `POST …/cancel/`, `…/complete/`, `…/extend/`, `…/resolve/` (замена заглушки), с обходом мягкого конфликта через `override` + `override_reason`.

## Alternative Flow
- **AF1. Нет `status.manage`**: шаги 3, 6, 8, 9 → 403 (`require_permission` в `EmployeeStatusViewSet.initial`, `permission_map` `StatusViewSet`, `OpsDailyBulkViewSet`, `check_permission('change_employee_status')` в `directorate`); в UI кнопки правки и вкладка «Массовое обновление» скрыты (`canEdit`).
- **AF2. Сотрудник вне области актора**: 403 `PERMISSION_DENIED` «Сотрудник вне области видимости оператора» (`_assert_employee_in_scope`, `_assert_employees_in_scope`).
- **AF3. Сотрудник откомандирован**: 403 `PERMISSION_DENIED` «Сотрудник откомандирован — редактирование статусов запрещено» (`assert_employee_status_editable`, `restricted_employee_ids`).
- **AF4. Сотрудник не работает**: 422 `EMPLOYEE_NOT_EMPLOYED`.
- **AF5. Пересечение с hard-статусом (`SICK_LEAVE`, `LEAVE_BY_REPORT`, `VACATION`, `COMMAND`)**: 422 `OVERLAPPING_HARD_STATUS` — не обходится; GiST-ограничение `excl_hard_status_overlap` страхует гонку.
- **AF6. Пересечение с soft-статусом**: 409 `STATUS_OVERLAP_WARNING` — фронт (`OpsConflictError.overridable`, `OVERRIDABLE_CODES`) открывает `ConflictDialog` и повторяет запрос с `override=true`, `override_reason`; без причины — 400 `VALIDATION_ERROR` «При override обязательна непустая причина» / `{"override_reason": "Обход конфликта требует причины."}`.
- **AF7. Неверный интервал / выход за границы найма / превышение `max_duration_days` типа**: 422 `INVALID_DATE_RANGE`, `DATE_OUTSIDE_EMPLOYMENT`, `MAX_DURATION_EXCEEDED`.
- **AF8. Участие в ОМ без мероприятия или по мероприятию, которое сотрудника не запрашивало**: 422 `PARTICIPATION_EVENT_REQUIRED` / `PARTICIPATION_EVENT_NOT_REQUESTED`; кадровый путь — `refuse_manual_participation` (400) и `_refuse_participation_status` в `directorate`.
- **AF9. Недопустимый переход жизненного цикла**: 422 `INVALID_LIFECYCLE_TRANSITION` (завершить можно только `ACTIVE`; отменить — `PLANNED` или начавшийся сегодня; продлить — только более поздней датой; разрешить — только заглушку и не в заглушку).
- **AF10. Пакет `statuses-bulk` с ошибками**: 422 «Массовое обновление отклонено: см. detail.rows» — весь пакет откатывается (`VALIDATION_ERROR` без `business_date`, пустой payload, дубль сотрудника, `ENTITY_NOT_FOUND`, `INVALID_STATUS_TYPE`, конфликты по строкам).
- **AF11. Кадровый статус «В строю» с датой окончания / тип без даты окончания**: 400 `{"end_date": "Статус \"В строю\" не должен иметь дату окончания."}` / «Для данного типа статуса требуется указать дату окончания.»; дата окончания раньше начала — 400.
- **AF12. Валидация формы на клиенте**: «Выберите статус.», «Укажите дату начала/окончания.», «Дата окончания раньше даты начала.», «Выберите тип дежурства/объект/пост/группу.», «Укажите хотя бы одно мероприятие.», «У привлечения на мероприятие укажите начало и окончание.»
- **AF13. Массовое обновление без выбранных сотрудников**: кнопка «Применить» заблокирована; сервер при частичных отказах отдаёт 200 с `errors[]`, тост перечисляет отказы.

## Изменения в системе
| Объект | Действие | Описание |
|---|---|---|
| `employee_statuses` (`statuses.EmployeeStatus`) | create / update | Кадровый статус: `status_type`, `state` (`planned`/`active`/`completed`/`cancelled`), `start_date`, `end_date`, `actual_end_date`, `comment`, `early_termination_reason`, `related_division`, `location`, `created_by`, `auto_applied`; предыдущий активный закрывается (`actual_end_date = start-1`, `COMPLETED`) или отменяется |
| `employee_status_change_history` (`StatusChangeHistory`) | create | Сигнал `log_status_change` (`CREATED`/`MODIFIED`) и сервис (`CANCELLED`, продление, завершение) |
| `ops_employee_statuses` (`OpsEmployeeStatus`) | create / update | Строка раздела: `employee_id`, `status_type_code`, `date_start`, `date_end` (полуинтервал), `source=USER`, `comment`, `document_basis`, `cancelled_*`; состояние выводится (`derive_state`), не хранится |
| `OpsStatusParticipation` | create / delete | Участие в ОМ: `event_id`, `kind_code`, `role_code` при `participations[]` |
| `StatusOverride` | create | Обход soft-конфликта: `reason`, `conflicts[]` |
| `OpsAuditLog` (`audit_service`) | create | `STATUS_CREATED`, `STATUS_UPDATED`, `STATUS_CANCELLED`, `STATUS_COMPLETED`, `STATUS_EXTENDED`, `STATUS_CLARIFICATION_RESOLVED`; для пакета — `record_many` |
| `localStorage` браузера (`entities/duty-assignment/model/store.ts`) | create / delete | Назначение на дежурство (объект, пост/группа) из диалога — только на клиенте |

## Бизнес-требования (BR)
- **BR1.** Запись статусов — по `status.manage`, чтение — по `status.view`; область — подразделения гранта с потомками; для одиночных маршрутов сотрудник статуса проверяется на вхождение в область (`_assert_status_in_scope`).
- **BR2.** Интервал строки раздела — полуинтервал `[date_start, date_end)`, `date_start < date_end` (`chk_status_dates`); состояние выводится из дат и `cancelled_at` относительно бизнес-даты `Clock`: `PLANNED` → `ACTIVE` → `COMPLETED`, `CANCELLED` ортогонально.
- **BR3.** Конфликты: hard×любой → 422 без обхода; soft×`ACTIVE` → 409 с обходом по причине; soft×ещё не начавшийся — предупреждение (`conflict_matrix.classify_pair`).
- **BR4.** Обход конфликта требует непустой `override_reason`; факт обхода пишется в `StatusOverride` и в `reason` записи аудита.
- **BR5.** Начало статуса не раньше `hire_date`, конец не позже `dismissal_date`; длительность не больше `max_duration_days` типа, если задан.
- **BR6.** Отмена требует причину; завершить досрочно можно только активный статус датой не позже сегодняшней; продление — только более поздней `date_end`; ретро-правка требует `amendment_reason` (`enforce_amendment_on_retro_edit`).
- **BR7.** «Участие в ОМ» (`EVENT_ASSIGNMENT`, `EVENT_ASSIGNMENT_GROUP`, `IN_EVENT`) ставится только с `participations[]` по мероприятиям, запросившим сотрудника через сбор сил; кадровые маршруты и `directorate` такие типы отбивают (Plane №757, №840).
- **BR8.** Массовый пакет раздела (`statuses-bulk`): `business_date` обязателен, одна строка на сотрудника, все строки в области; ошибка любой строки отклоняет весь пакет (422 с `detail.rows[]`).
- **BR9.** Массовое обновление портала (`directorate` PUT) — построчно с savepoint: валидные строки применяются, отказы возвращаются в `errors[]`.
- **BR10.** Кадровый статус: «В строю» без даты окончания, остальные типы — с обязательной датой окончания; новый статус закрывает предыдущий активный; запланированный статус должен начинаться в будущем (`plan_status`).
- **BR11.** Кадровый `StatusType` ограничен перечислением (`in_service`, `vacation`, `leave_by_report`, `sick_leave`, `business_trip`, `training`, `competition`, `conference`, `other_absence`, `on_duty`, `after_duty`, `seconded_from`, `seconded_to`); мост в канон — `legacy_code`.

## Требования к логированию
- `OpsAuditLog` через `audit_service.record`/`record_many`: действия из «Изменений» с `entity_type=employee_status`, снимками до/после (`status_snapshot`), `reason` при обходе; для `statuses-bulk` — по записи на строку.
- `StatusChangeHistory` — построчная история кадрового статуса (кто, когда, `old_value`/`new_value`, комментарий).
- `AuditMiddleware` → `audit.AuditLog`: для `/api/statuses/statuses/` (`ContentType` `statuses.statuse` — не разрешается) и `/api/operations/statuses/` (`operations.statuse`) записи не создаются; для `directorate` — тоже. HTTP-аудит статусов: `Не реализовано в коде`.
- Консоль: `logging.getLogger` в `apps/statuses/application/services.py` и `apps/operations/notify_service.py`; `django.request` на 4xx/5xx.
- Уведомление руководителей о массовом обновлении (`notifyManagers`) и отложенное применение (`scheduleUpdate`): `Не реализовано в коде` — чекбоксы формы никуда не передаются.

## Требования к правам
| Роль | Доступ | Как обеспечивается |
|---|---|---|
| `ADMIN` | полный | `*`; суперпользователь в `directorate` |
| `DIRECTORATE_HEAD`, `HEAD_DIRECTORATE_LINE`, `HEAD_DEPARTMENT_LINE`, `HEAD_OPS_UNIT` | полный в области | `status.manage`: `permission_map` `StatusViewSet` (`create`, `partial_update`, `cancel`, `complete`, `extend`, `resolve`, `bulk`), `OpsDailyBulkViewSet.create`, `EmployeeStatusViewSet.WRITE_PERMISSION`, `check_permission('change_employee_status')` |
| `INTEGRATION_USER` | запись без чтения | `status.manage` есть, `status.view` нет: одиночные и пакетные записи проходят, списки и `directorate` — 403 |
| Держатели `status.view` (`EMPLOYEE`, `DEPARTMENT_EXPENSE_OFFICER`, `DUTY_OFFICER`, `OPS_STAFF`, `DUTY_PLANNER`, `ANALYST`, `AUDITOR`, `EMPLOYEE_OPS_D2`, `FORCES_GATHERING_OFFICER`) | чтение | `permission_map` `list`/`retrieve` → `status.view`; `CanReadDirectorate`; `useOpsPermissions("status.manage")` скрывает правку |
| Остальные роли (`EVENT_OFFICER`, `PATROL_LEAD`, `GVO_LEAD`, `EVENT_APPROVER`, `DUTY_PLAN_APPROVER`, `OBJECT_KEEPER`, `RATING_EVALUATOR`, `FEEDBACK_TRIAGE`, `REFERENCE_ADMIN`, `SECURITY_ADMIN`, `OM_CATEGORY_ORG`, `OVERVIEW_DEPARTMENT`, `OPS_STAFF_COMMAND`) | нет | 403; экран `/statuses` закрыт `DirectorateAccessNotice` |
| Любой вошедший | чтение кадровых статусов `GET /api/statuses/statuses/`, `planned`, `history`, `absence_statistics` | `IsAuthenticated`; `get_queryset` возвращает все статусы (`TODO: Добавить проверку ролей`, `views.py:186`) |

## Требования к UX/UI
- Страница «Статусы сотрудников» (`/statuses`, метка «В разработке: «Участие в ОМ» только из запроса, колонка «По разделу ОМ», «ознакомлен» (№427)»); вкладки «Таблица сотрудников», «Календарь статусов» (UC-STS-002), «Массовое обновление» (только с `status.manage`); кнопки «Входящие запросы на прикомандирование» (UC-STS-003) и баннер запросов сбора сил.
- Таблица `StatusTable`: чекбокс, «№», «ФИО», «Отдел», «Должность», «Статус (кадровый)», «По разделу ОМ», «Обновлён», «Следующий», меню действий («Изменить статус», «Запланированные статусы», «Прикомандировать»); строки-вакансии без действий.
- Диалог «Статусы сотрудника» (`EditStatusDialog`): `Select` типа статуса (подписи из справочника), блок `DutyAssignmentFields` для «На дежурстве» (тип POST/GROUP, объект из `/api/ops/objects/`, пост или группа), выбор мероприятий для участия, два `Calendar` дат (для «В строю» не требуются), `Textarea` комментария, кнопки «Сохранить»/«Отмена»; ошибки формы под полями и `root`-ошибка текстом сервера.
- Диалог «Запланированные статусы сотрудника» (`PlannedStatusesDialog`): список кадровых статусов по состояниям, блок строк раздела ОМ (загрузка / ошибка / «пусто»), действия «Продлить», «Завершить досрочно» (причина), «Отменить» (причина), правка дат.
- Вкладка «Массовое обновление» (`MassStatusUpdate`): счётчик «N человек», `Select` статуса с бейджем цвета, два `Calendar`, комментарий, чекбоксы «Уведомить руководителей» (`notifyManagers`, по умолчанию включён) и «Отложенное применение» (`scheduleUpdate`), `Alert` предупреждения, кнопка «Применить» (заблокирована без выбора), тост с итогом и отказами.
- `ConflictDialog` (`features/ops-conflict-override`): текст конфликта, поле причины обхода, «Подтвердить»/«Отмена» — используется для маршрутов раздела ОМ.

## Открытые вопросы
- Две модели статусов живут параллельно: кадровая `statuses.EmployeeStatus` (`/api/statuses/`, диалоги правки и массовое обновление) и раздела `OpsEmployeeStatus` (`/api/operations/statuses/`, `/api/ops/daily/statuses-bulk/`, участие в ОМ); правила конфликтов, обхода и аудита действуют только во второй.
- `EmployeeStatusViewSet.get_queryset` (`apps/statuses/api/views.py:186`) — `TODO: Добавить проверку ролей`: чтение всех кадровых статусов любому вошедшему без области.
- Чекбоксы «Уведомить руководителей» и «Отложенное применение» массового обновления ни в один запрос не попадают.
- Массовое обновление портала идёт через `PUT /api/staff_unit/staff-units/directorate/`, а не через `statuses-bulk`; `ConflictDialog`/`override` в этом пути не работают (кадровая модель конфликтов не считает).
- Назначение на дежурство из диалога («На дежурстве» с объектом и постом) хранится в `localStorage` и не отправляется на сервер; смена `OpsDutyShift` не создаётся (см. UC-STS-005).
- `EditStatusDialog` использует `related_division` для «Прикомандирован из/Откомандирован в» кадровой модели, тогда как прикомандирование раздела ведётся отдельной сущностью (UC-STS-003).
- Метка №427 (участие только из запроса, колонка «По разделу ОМ», «ознакомлен») остаётся на экране, хотя серверная часть участия закрыта (№757/№840) — снятие метки ждёт закрытия карточки.
- `INTEGRATION_USER` пишет статусы, но не может их прочитать (нет `status.view`).
