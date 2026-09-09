# UC-EVT-006. Ознакомить участников и подтвердить заступление

| Поле | Значение |
|---|---|
| Модуль | Охранные мероприятия |
| Актор | EVENT_OFFICER (ведущий мероприятие, `event.manage`); старший ОМ / старший объекта посещения / замещающий с `can_edit_placement` (роль в данных); назначенный сотрудник (роль в данных, свой наряд); начальник по области `status.manage` (только чтение назначений подчинённого); ADMIN |
| Статус | Partial |
| Основание | `apps/ops/acknowledgement_stage.py` (`remind_assignment`, `remind_pending`, `complete`), `apps/ops/acknowledgement_notify.py` (`notify_acknowledgement`), `apps/ops/acknowledgement_reminders.py` (`remind_supervisors_before_start`, `acknowledgement_deadline`), `apps/ops/assignment_decline_notify.py`, `apps/ops/my_assignments.py` (`acknowledge`, `decline`, `assignments_of`, `mark_viewed`, `may_acknowledge`, `may_manage_stage`, `may_read`), `apps/ops/security_events.py` (`_autonotify_acknowledgement`, `_advance`, `replace_assignment`, `_placement_chiefs`), `apps/operations/management/commands/remind_unconfirmed_acknowledgements.py`, `apps/operations/models_notification.py` (`OpsNotification`), `SecurityEventViewSet`: `POST /api/ops/security-events/{id}/acknowledge/{assignment_id}/`, `POST …/decline/{assignment_id}/`, `POST …/acknowledgement/complete/`, `POST …/acknowledgement/notify/`, `POST …/acknowledgement/remind/{assignment_id}/`, `POST …/acknowledgement/remind-all/`, `GET /api/ops/security-events/my-assignments/[?employee=]`; FRONT `features/security-event-stages/ui/AcknowledgementStage.tsx`, `widgets/my-profile/ui/ProfileBody.tsx`, `app/security-ops/profile/page.tsx`, `app/security-ops/profile/[employeeId]/page.tsx`, `hooks/use-security-event-stages.ts`, `hooks/use-my-assignments.ts` |
| Дата актуализации | 2026-09-08 |

## Цель
Довести назначения на посты до каждого заступающего и его руководителя, собрать подтверждения (или отказы с заменой) и перевести мероприятие на этап «Проведение».

## Предусловия
- Мероприятие (`OpsSecurityEvent`) или его объект посещения (`OpsSecurityEventVisitObject`) стоит на этапе `ACKNOWLEDGEMENT` — туда объект переводится утверждением расстановки (UC-EVT-005, `_approve_visit` → `advance_visits(…, "ACKNOWLEDGEMENT")`); мероприятие берёт наименьшую стадию своих объектов.
- В `placement_assignments` есть строки назначений (`id`, `postId`, `employeeId`, `employeeName`); пост — в `recon_sector_posts`.
- Для доставки уведомлений у сотрудника есть связь `Employee.user` (заполняется руками, `MyEmployeeViewSet`); подразделение сотрудника определяется по штатному слоту `StaffUnit`.
- Руководители-получатели — учётки с активной `UserRole` роли, держащей `status.manage`, с `scope_division_id` на подразделении сотрудника или любом предке.

## Main Flow
1. Система при утверждении расстановки объекта автоматически рассылает уведомление «Заступление на ОМ» (`EVENT_ACKNOWLEDGEMENT`) каждому назначенному на посты этого объекта и их руководителям.
2. Сотрудник открывает «Мой профиль» → вкладка «Мои назначения»; система показывает карточки его нарядов (мероприятие, объект, сектор/пост, задача, требования, форма одежды, вооружение) и фиксирует момент первого открытия (`viewedAt`).
3. Сотрудник нажимает «Ознакомлен, заступлю»; система ставит `acknowledgedAt`, способ `self`, снимает отказ, если был.
4. Ведущий мероприятие или старший открывает этап «Ознакомление» в карточке ОМ; система показывает шапку «Ознакомились K из N · не открыли M · открыли и молчат O · отказов D · срок подтверждения» (срок — за час до начала), полосу готовности и список назначений по секторам с телефоном сотрудника.
5. Старший нажимает «Напомнить» у строки или «Напомнить всем, кто не подтвердил»; система рассылает напоминание назначенному и его руководителям и пишет `remindedAt` в строку.
6. Старший, доведя назначение устно, нажимает «Ознакомлен лично»; система ставит `acknowledgedAt` со способом `personal` и именем отметившего (`acknowledgedBy`).
7. За час до начала мероприятия система (команда `remind_unconfirmed_acknowledgements`) уведомляет руководителей поимённым списком их неподтвердивших подчинённых (`ACKNOWLEDGEMENT_DUE_SOON`).
8. Когда подтвердили все, ведущий мероприятие или старший ОМ нажимает «Завершить ознакомление»; система переводит мероприятие (все объекты) на этап `CONDUCT` и пишет переход в `OpsSecurityEventTransition`.

## Alternative Flow
- **AF1. Сотрудник не может заступить**: шаг 3 → «Не могу заступить», обязательная причина в диалоге → система ставит `declinedAt`, `declineReason`, `declinedBy`, `declinedVia`, снимает подтверждение; уведомление `ASSIGNMENT_DECLINED` уходит старшему объекта поста, его замещающим и старшему мероприятия; запись `ASSIGNMENT_DECLINED` в журнал мутаций с отчётом рассылки. На этапе старший видит отказ и «Заменить →» (`ReplaceInline` → `POST …/conduct/replace/`, `replace_assignment`, допускается на `ACKNOWLEDGEMENT` и `CONDUCT`; детали — UC-EVT-007).
- **AF2. Не все подтвердили при завершении**: шаг 8 → 422 `ACKNOWLEDGEMENT_INCOMPLETE` (`unconfirmed: N`); экран открывает диалог принудительного завершения с обязательным комментарием («Например: доведено устно на разводе») → `{"force": true, "comment"}` → переход на `CONDUCT` + запись `SECURITY_EVENT_ACKNOWLEDGEMENT_FORCED` (число неподтвердивших, комментарий). `force` без комментария — 400 `VALIDATION_ERROR` (`comment`).
- **AF3. Отказ без причины**: 400 `VALIDATION_ERROR` (`reason: «Укажите причину…»`); на экране кнопка «Отправить отказ» выключена при пустом поле.
- **AF4. Мероприятие закрыто (`CLOSED`)**: `acknowledge`/`decline` → 422 `INVALID_STAGE_TRANSITION` «Мероприятие закрыто — … уже нельзя» (проверяется раньше валидации причины).
- **AF5. Напоминание не по адресу**: уже подтвердил — 422 `ALREADY_ACKNOWLEDGED`; отказался — 422 `ALREADY_DECLINED`; «Напомнить всем» при отсутствии ожидающих — 422 `NOTHING_TO_REMIND`; напоминания/завершение не на этапе `ACKNOWLEDGEMENT` — 422 `INVALID_STAGE_TRANSITION`.
- **AF6. Рассылка при открытии этапа не на этапе или некому**: `notify_acknowledgement` → 422 `ACKNOWLEDGEMENT_STAGE_REQUIRED` / `PLACEMENT_EMPTY`; в автоматическом вызове `_autonotify_acknowledgement` `DomainError` глотается — утверждение расстановки не откатывается.
- **AF7. Сотрудник без учётки / уволен**: в отчёте рассылки поимённо `unlinkedEmployeeIds` / `dismissedEmployeeIds`, уведомление не создаётся; сотрудник без штатного слота в списочном напоминании за час ни в чей список не попадает.
- **AF8. Профиль без кадровой привязки или уволенного**: `GET my-assignments` → 200 с пустым `results` и `unlinkedReason` (`UNLINKED_REASON` / `DISMISSED_REASON`), не 403 (№596).
- **AF9. Чтение чужих назначений без области**: `?employee=<id>` вне области `status.manage` актора → 403 (`may_read`).
- **AF10. Назначение не найдено**: 404 `ENTITY_NOT_FOUND`.
- **AF11. Этап отстаёт по одному из объектов** (`eventOnStage` = false): на экране «Напомнить», «Напомнить всем» и «Завершить» выключены с причиной «Этап ведётся по всему мероприятию: …»; «Ознакомлен лично» остаётся доступной.
- **AF12. Сбой записи уведомления**: `notify_service.notify` глотает исключение, пишет `logger.exception`, возвращает `None`; деловая операция не откатывается.

## Изменения в системе
| Объект | Действие | Описание |
|---|---|---|
| `OpsSecurityEvent.placement_assignments` (JSON) | update | `acknowledgedAt`, `acknowledgedVia` (`self`/`personal`), `acknowledgedBy`; `declinedAt`, `declineReason`, `declinedBy`, `declinedVia`; `viewedAt` (один раз, до ответа, только на этапе `ACKNOWLEDGEMENT`); `remindedAt`; под `lock_event` (`SELECT … FOR UPDATE`) |
| `OpsSecurityEvent.stage`, `readiness_percent`; `OpsSecurityEventVisitObject.stage` | update | `ACKNOWLEDGEMENT` → `CONDUCT` по всем объектам (`_advance` / `advance_visits`) |
| `OpsSecurityEventTransition` | create | переход `ACKNOWLEDGEMENT → CONDUCT` (`record_transition`, только при фактической смене стадии мероприятия) |
| `OpsNotification` | create | `EVENT_ACKNOWLEDGEMENT` (при открытии этапа — ключ дедупликации объект/день; напоминание по кнопке — `dedupe_key=None`, без дедупликации), `ACKNOWLEDGEMENT_DUE_SOON` (ключ — мероприятие, списочный payload по «своим»), `ASSIGNMENT_DECLINED` (ключ — назначение); payload с `eventId`, `eventCode`, `eventTitle`, `businessDate`, `objectName`, `visitObjectId`, `asSupervisor`, `reminder`, `oneHourBefore`, `unconfirmed[]`, `reason` |
| WS-канал (`channels`, `OPS_WS_ENABLED`) | send | публикация конверта уведомления в группу получателя после коммита (`_publish`) |
| Журнал мутаций (`audit_service.record`) | create | `ASSIGNMENT_DECLINED` (причина, автор, способ, отчёт доставки), `SECURITY_EVENT_ACKNOWLEDGEMENT_FORCED` (unconfirmed, comment) |
| HTTP-аудит (`apps/audit` AuditMiddleware) | create | каждый успешный POST к `/api/ops/security-events/…` |
| Леджер сил (`signals.post_save` → `project_forces_ledger`) | update | перепроекция на каждом сохранении `OpsSecurityEvent` |
| `GET my-assignments` | read | плоский список назначений сотрудника по всем ОМ (`assignments_of`) — с побочной записью `viewedAt` на своём списке |

## Бизнес-требования (BR)
- **BR1.** Рассылка о заступлении идёт автоматически при переводе объекта на `ACKNOWLEDGEMENT` — по постам этого объекта, а не по всему мероприятию (№537); ручная ручка `acknowledgement/notify` шлёт по всему ОМ.
- **BR2.** Адресаты уведомления — назначенные (по связи `Employee.user`) и их руководители: учётки с активной ролью, держащей `status.manage`, областью на подразделении сотрудника или его предке (`supervisors_by_division`); нет ролей с этим правом — рассылать некому (fail-closed).
- **BR3.** Уволенный сотрудник (`Employee.is_active=False`) уведомления и напоминания не получает и в «не дошло» не попадает; учитывается отдельной графой `dismissedEmployeeIds`.
- **BR4.** Состояния строки назначения: «ожидает (не открыл)», «открыл и молчит» (`viewedAt`), «ознакомлен» (`acknowledgedAt`), «отказ» (`declinedAt`). Подтверждение и отказ взаимоисключающи; уже данный ответ можно переменить.
- **BR5.** «Ознакомлен лично» (`acknowledgedVia=personal`, `acknowledgedBy`) ставится только когда строка ДОКАЗАННО чужая (актор с кадровой привязкой ≠ `employeeId` строки); неизвестность читается как `self` (№721). Подтвердить чужую строку по данным может старший мероприятия/объекта (`_placement_chiefs`); послабление «старший не назначен → любой» не действует.
- **BR6.** Отказ требует непустой причины; автор и способ отказа записываются в строку и в журнал мутаций (№588).
- **BR7.** Отказавшемуся не напоминают (`ALREADY_DECLINED`, `_pending`, `_unconfirmed`) — его заменяют; подтвердившему не напоминают (`ALREADY_ACKNOWLEDGED`).
- **BR8.** Напоминание по кнопке — событие, без дедупликации «одно на день» (`dedupe_key=None`); момент последнего напоминания — `remindedAt` в строке.
- **BR9.** Срок подтверждения (`acknowledgementDeadline`) — начало ОМ (`business_date` + `event_time`, без времени 08:00) минус 1 час; тем же окном руководители получают поимённое напоминание `ACKNOWLEDGEMENT_DUE_SOON` — каждому только его люди.
- **BR10.** Завершение этапа переводит мероприятие целиком; при неподтвердивших — только с `force=true` и непустым комментарием, с записью `SECURITY_EVENT_ACKNOWLEDGEMENT_FORCED`.
- **BR11.** Завершать этап могут ведущий (`event.manage`) и старший мероприятия (`chief_employee_id`); старший объекта и замещающий — нет (`_EVENT_LEAD_ONLY_ACTIONS`, №613). Старший объекта заменяет только на постах своего объекта; неразмеченный пост многообъектного ОМ — ничей (отказ).
- **BR12.** Замещающий ведёт этап только с `can_edit_placement=True`; наблюдатель — зритель.
- **BR13.** Все правки `placement_assignments` — под замком `lock_event` (в т.ч. `mark_viewed`, №825).
- **BR14.** Отметка `viewedAt` ставится один раз, только при чтении СВОЕГО списка и только на ОМ этапа `ACKNOWLEDGEMENT`; чтение старшим `?employee=` отметку не ставит.
- **BR15.** Замена (`replace_assignment`) допускается на этапах `ACKNOWLEDGEMENT` и `CONDUCT`, требует `reasonCode` и запрещает двойное назначение на другой пост (`DOUBLE_ASSIGNMENT`).

## Требования к логированию
- Журнал мутаций (`audit_service.record`): `ASSIGNMENT_DECLINED` — актор, `code`, `assignmentId`, `reason`, `declinedBy`, `via`, `notified`, `unlinked`, `undelivered`, `dismissed`, `nobody`; `SECURITY_EVENT_ACKNOWLEDGEMENT_FORCED` — актор, `old_value {stage, unconfirmed}`, `new_value {stage: CONDUCT, comment}`.
- `OpsSecurityEventTransition` — факт перехода `ACKNOWLEDGEMENT → CONDUCT`.
- HTTP-аудит `AuditMiddleware` — все успешные write-запросы.
- `notify_service`: `logger.exception` при сбое записи уведомления и при сбое WS-публикации (`WS-публикация не удалась: получатель=… вид=… дата=…`).
- Management-команда печатает отчёт в stdout: «напоминания за час: мероприятий N, неподтвердивших N, руководителей N — коды».
- `Не реализовано в коде`: запись в журнал мутаций подтверждения ознакомления (`acknowledge`, в т.ч. «лично»), напоминаний (`remind`/`remind-all`), ручной и автоматической рассылки открытия этапа и штатного завершения этапа (без `force`) — след только в JSON строки (`acknowledgedAt`/`remindedAt`) и в HTTP-аудите; `logger.*` в `acknowledgement_*`, `my_assignments`, `assignment_decline_notify` и на этом пути `security_events.py` отсутствует.

## Требования к правам
| Роль | Доступ | Как обеспечивается |
|---|---|---|
| ADMIN | полный | `*` |
| EVENT_OFFICER | полный: acknowledge, decline, complete, notify, remind, remind-all, conduct/replace; my-assignments | `event.manage` (`permission_map`), `event.view` (my_assignments); при действии по праву запись «по роли» не ставится (`_acts_by_permission`) |
| Старший мероприятия (`chief_employee_id`, роль в данных) | напоминания, «Ознакомлен лично», отказ за сотрудника, замена, завершение | `_stage_lead_override` / `_my_assignments_override` → `may_manage_stage`, `may_acknowledge`; `is_active` обязателен |
| Старший объекта посещения (`visit.chief_employee_id`) / замещающий с `can_edit_placement` | напоминания, «Ознакомлен лично», отказ за сотрудника, замена только на постах своего объекта; завершение — нет | `_stage_lead_override` (`_EVENT_LEAD_ONLY_ACTIONS`, `_replaces_own_post`), `may_manage_stage`, `_leads_as_deputy` |
| Назначенный сотрудник (любая роль, свой наряд) | свои назначения, «Ознакомлен, заступлю», «Не могу заступить» | `_my_assignments_override` → `employee_of_user`, `_own_assignment`; уволенному — пустой ответ (`DISMISSED_REASON`) и отказ в `may_acknowledge` |
| HEAD_OPS_UNIT, DIRECTORATE_HEAD, HEAD_DIRECTORATE_LINE, HEAD_DEPARTMENT_LINE, INTEGRATION_USER | чтение назначений подчинённого (`?employee=`) по области; получатели уведомлений как руководители | `status.manage` (`PermissionService.visible_division_ids`, `may_read`; `SUPERVISE_PERMISSION`) |
| OPS_STAFF, PATROL_LEAD, GVO_LEAD, EVENT_APPROVER, HEAD_OPS_UNIT, EMPLOYEE_OPS_D2, OM_CATEGORY_ORG, OPS_STAFF_COMMAND, FORCES_GATHERING_OFFICER, DEPARTMENT_EXPENSE_OFFICER, DUTY_*, OBJECT_KEEPER, RATING_EVALUATOR, ANALYST, AUDITOR | чтение карточки ОМ (этап видно, кнопки выключены с причиной); `my-assignments` любого сотрудника без ограничения области | `event.view` (`list/retrieve`, `my_assignments` в `permission_map`) |
| OPS_STAFF_COMMAND | принудительная смена этапа | `event.stage_override` (`POST …/stage/`) |
| EMPLOYEE, HEAD_DIRECTORATE_LINE, HEAD_DEPARTMENT_LINE (без `event.view`) | только свой профиль (`my-assignments` без параметра) | `_my_assignments_override` без параметра `employee` → всегда `True` |
| Команда `remind_unconfirmed_acknowledgements` | системный запуск | `Не реализовано в коде` — планировщика нет (`CELERY_BEAT_SCHEDULE` отсутствует), запуск руками |

## Требования к UX/UI
- **Этап «Ознакомление»** — карточка (`Card`) в карточке ОМ, `AcknowledgementStage.tsx`. Шапка: «Ознакомились K из N · не открыли M · открыли и молчат O · отказов D · срок подтверждения ДД.ММ ЧЧ:ММ» (`data-testid="ack-summary"`), полоса готовности (`aria-label="Готовность ознакомления"`, сегменты: подтвердили / отказ / открыли и молчат / не открывали). Кнопки: «Напомнить всем, кто не подтвердил (N)» (выключена: нет прав, все ответили — «Все ответили — напоминать некому», этап отстаёт), «Завершить ознакомление» (выключена: не ведущий/старший ОМ, `total === 0`, этап отстаёт; причина — `AccessHints`/`RightGate`, `aria-describedby`). Фильтр выборки (`scope`); список по секторам (пост вне расчёта — «Пост вне расчёта»); пустое состояние: «Назначений нет — ознакамливаться некому.» / «В этой выборке никого нет.». Строка (`AssignmentRow`): ФИО, пост, состояние, «открыл … и не нажал…», «напомнили …», телефон (`tel:`), кнопки «Напомнить», «Ознакомлен лично» (title «Ознакомлен лично — доведено устно, отметка старшего»), «Заменить →» (выключена на чужом объекте: «Заменить на посту чужого объекта может только его старший»). `ReplaceInline` (`aria-label="Замена отказавшегося"`): выбор сотрудника, причина (обязательно, placeholder «Например: болезнь»), «Заменить».
- **Диалог принудительного завершения** (`Dialog`): «Этап перейдёт на «Проведение» без их подтверждения. Комментарий …», поле комментария (обязательно, placeholder «Например: доведено устно на разводе»), подтверждение выключено при пустом комментарии / `isPending`.
- **Мой профиль** `/security-ops/profile` (страница, `ProfileBody`), вкладки «Мои назначения» / «Календарь» / «История». Состояния страницы: «Загрузка профиля…», ошибка «Не удалось прочитать кадровую запись…», «Кадровая запись не найдена». Карточка назначения: код/название ОМ, объект, сектор · пост, задача, требования, форма одежды, вооружение; до этапа `ACKNOWLEDGEMENT` — плашка «назначение готовится» без кнопок; на этапе — кнопки «Ознакомлен, заступлю» (скрыта после подтверждения) и «Не могу заступить» (скрыта после отказа); ошибка ответа — `role="alert"` «Ответ не сохранён — попробуйте ещё раз.». Диалог отказа: заголовок «Не могу заступить — <код>», поле «Причина» (обязательно, placeholder «Например: болезнь, командировка, отпуск по приказу»), «Отправить отказ» выключена при пустой причине.
- **Профиль сотрудника** `/security-ops/profile/[employeeId]` — те же карточки только для чтения (`readOnly`, вкладка «Назначения»), доступ решает сервер (`may_read`).
- Zod-схем у форм этапа и профиля нет — обязательность держится на `disabled` кнопок и серверных 400.

## Открытые вопросы
- Метка «В разработке» этапа ACKNOWLEDGEMENT (`in-development.ts`): «Список по секторам, «Напомнить всем», отказ с «Заменить →» (№432)»; «Шапка «Ознакомились K из N · отказов · срок», «Ознакомлен лично» (№447)» — при том что перечисленное в коде экрана есть.
- Метка «В разработке» `/security-ops/profile`: «Карточки назначений «Ознакомлен, заступлю» / «Не могу заступить» (№405)»; «Шапка: должность и подразделение словами, рейтинг; история закрытых ОМ (№434)»; «Три вкладки, календарь с полосками постов, без заглушек (№449)».
- Напоминание руководителям за час (`[ОЗН-06]`, №427) — management-команда без планировщика: `CELERY_BEAT_SCHEDULE` отсутствует, cron в коде нет; докстринг команды обещает «расписание кладёт отдельный срез (каждые 15 минут)» — в коде его нет.
- `useNotifyAcknowledgement` (`POST …/acknowledgement/notify/`) — хук и ручка есть, читателей в UI нет (кнопка «Отправить уведомления» снята, см. докстринг `_send`); при этом докстринг `_autonotify_acknowledgement` говорит «ручная кнопка на этапе остаётся».
- Тип `MyAssignmentRow` в `hooks/use-my-assignments.ts` не содержит `viewedAt` и `phone`, которые сервер отдаёт в `my-assignments`; профиль их не показывает.
- Отдельного «завершить ознакомление по объекту» нет — этап завершается по всему ОМ (комментарий у `_EVENT_LEAD_ONLY_ACTIONS`: «заведена карточка»).
- Уведомления только внутренние (`OpsNotification` + WS при `OPS_WS_ENABLED`); внешних каналов (почта, SMS, push) нет.
- Старший без кадровой привязки, отметивший чужую строку, получает способ `self` вместо `personal` (осознанное преуменьшение, №721).
- Подтверждение «Ознакомлен лично» и напоминания не пишутся в журнал мутаций — только в JSON строки и в HTTP-аудит.
