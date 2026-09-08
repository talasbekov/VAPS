# UC-EVT-005. Согласовать расстановку

| Поле | Значение |
|---|---|
| Модуль | Охранные мероприятия |
| Актор | EVENT_APPROVER, HEAD_OPS_UNIT, DUTY_PLANNER (подпись/возврат); EVENT_OFFICER, HEAD_OPS_UNIT (отправка/отзыв, маршрут по API); старший объекта посещения и замещающий с `can_edit_placement` (по данным); ADMIN |
| Статус | Done |
| Основание | `apps/ops/security_events.py` (`send_for_approval`, `withdraw_from_approval`, `decide_approver`, `resolve_remark`, `approve_placement`, `return_placement`, `_approve_visit`, `_return_visit`, `_autocomplete_approval`, `_sync_event_approval`, `_submit_document_version`, `_decide_document_version`, `approval_is_stale`, `placement_signature`), `apps/ops/approval_route.py` (`seed_route`, `template_route`, `replace_steps`), `apps/ops/placement_return_notify.py`, `apps/operations/models_settings.py::OpsApprovalRouteStep`, `apps/operations/models_event.py` (`OpsSecurityEventVisitObject`, `OpsPlacementDocumentVersion`, `OpsSecurityEventTransition`), `apps/ops/api/views.py::SecurityEventViewSet` (`approval_send`, `approval_withdraw`, `approval_route_decide`, `approval_remark_resolve`, `approval_approve`, `approval_return`, `approval_route_add/remove/move`, `_object_lead_override`), `apps/ops/api/views_approval_route.py::OpsApprovalRouteViewSet`; FRONT `features/security-event-stages/ui/ApprovalStage.tsx`, `hooks/use-security-event-stages.ts` (`useSendForApproval`, `useWithdrawApproval`, `useDecideApprover`, `useResolveRemark`), `features/approval-route/ui/ApprovalRouteCard.tsx` |
| Дата актуализации | 2026-09-08 |

## Цель
Согласующие последовательно подписывают документ «Расстановка сил» объекта посещения (или возвращают его с замечаниями), после чего объект переходит на «Ознакомление».

## Предусловия
- ОМ существует, у него есть хотя бы один объект посещения (`OpsSecurityEventVisitObject`); объект находится на этапе `APPROVAL` (для отправки допускается и `ACKNOWLEDGEMENT`).
- Этап «Расстановка» по объекту завершён (`complete_placement`): `document_version >= 1`, заведена строка `OpsPlacementDocumentVersion` (DRAFT), объекту скопирован маршрут из настроек (`seed_route`).
- В настройках раздела задан маршрут согласования (`OpsApprovalRouteStep`, `PUT /api/ops/approval-route/`, право `settings.manage`); при пустом маршруте отправка отбивается `APPROVAL_ROUTE_EMPTY` (422).
- Посты расчёта объекта отнесены к объекту (`visitObjectId`), на посты назначены люди (подпись расстановки не пуста).
- Пользователь авторизован; для действий по данным — у учётки есть кадровая запись `employee`, активная.

## Main Flow
1. Ведущий ОМ (или старший объекта) открывает карточку ОМ, этап «Согласование», выбирает объект посещения и нажимает «Отправить на согласование».
2. Система копирует маршрут из настроек (если у объекта его ещё нет), фиксирует снимок состава расстановки, переводит документ в «На согласовании» (версия та же для черновика, N+1 поверх согласованной/возвращённой версии), ставит всем строкам маршрута статус «Ожидает», `approval_status = PENDING`.
3. Первый по порядку согласующий видит в таблице маршрута строку со статусом «Ожидает» и кнопками «Согласовать» / «Вернуть».
4. Согласующий нажимает «Согласовать»; система проверяет очередь (все предыдущие подписали) и, если у строки маршрута задана учётка, — что подписывает именно она; записывает подпись (ФИО, должность, логин, время, номер версии, хэш снимка, IP) и аудит `SECURITY_EVENT_APPROVAL_SIGNED`.
5. Шаги 3–4 повторяются для каждой следующей строки маршрута.
6. Когда подписали все и нет замечаний без ответа, система завершает этап автоматически: `approval_status = APPROVED`, версия документа → `APPROVED` (`decided_at`), сводный статус ОМ пересчитан (`_sync_event_approval`), объект переведён на `ACKNOWLEDGEMENT`, при смене стадии ОМ записан переход `OpsSecurityEventTransition` (FORWARD).
7. Система автоматически рассылает уведомления о заступлении (`_autonotify_acknowledgement`); сбой рассылки этап не откатывает.
8. Экран показывает подзаголовок «Согласовано (версия N от …)», подписи под строками маршрута, историю версий документа и печатную форму расстановки.

## Alternative Flow
- **AF1. Согласующий возвращает на доработку**: шаг 4 → «Вернуть» открывает модалку с обязательной причиной и списком замечаний (текст, пост или «Общее», «Срочно») → `decide_approver(RETURNED)`: причина обязательна (400 `comment`), замечания только к постам своего объекта (400 `remarks.<i>`), тип `remarks` — список (400) → `_return_visit`: `approval_status = RETURNED`, строки маршрута `APPROVED/PENDING` сброшены в `NOT_SENT` (подписи сняты), версия документа → `RETURNED`, уведомление `PLACEMENT_RETURNED` старшему объекта и замещающим, аудит `SECURITY_EVENT_PLACEMENT_RETURNED`, объект → `PLACEMENT`, переход ОМ вида `RETURN` при смене стадии.
- **AF2. Ответ на замечание**: старший объекта / замещающий (`can_edit_placement`) / держатель `event.manage` отвечает на открытое замечание: «Устранено» (ответ необязателен), «Не согласен» (ответ обязателен, 400 `response`), возврат в «Открыто» тем же эндпоинтом (`decision=OPEN`). Если после ответа подписаны все и открытых замечаний нет — автозавершение (шаг 6).
- **AF3. Повторная отправка после возврата**: старший исправляет расстановку и повторяет шаг 1 → версия документа N+1, прежняя помечена `superseded_at`; строки маршрута снова `PENDING`, комментарий вернувшего сохраняется.
- **AF4. Отзыв с согласования**: пока никто не подписал — «Отозвать с согласования» → строки `PENDING` → `NOT_SENT`, снимок стёрт, версия документа → `DRAFT` (номер прежний), объект → `PLACEMENT` (переход `RETURN`). Если хоть одна подпись есть — 422 `APPROVAL_WITHDRAW_AFTER_SIGN`.
- **AF5. Расстановка изменилась после отправки**: подпись состава расходится со снимком → баннер «Расстановка изменилась после отправки», автозавершение не проходит (`APPROVAL_STALE` 422 глотается), требуется повторная отправка.
- **AF6. Не та очередь / не та учётка**: решение раньше очереди — 422 `APPROVAL_OUT_OF_ORDER`; строка привязана к учётке, а подписывает другой (без `*`) — 403 `APPROVAL_NOT_YOUR_TURN`; строка не отправлена — 422 `APPROVAL_NOT_SENT`.
- **AF7. Нечего согласовывать**: подпись расстановки пуста — 422 `PLACEMENT_EMPTY`; у ОМ несколько объектов и есть посты без объекта — 422 `RECON_POSTS_UNASSIGNED`; пустой маршрут в настройках — 422 `APPROVAL_ROUTE_EMPTY`.
- **AF8. Не тот этап**: объект не на `APPROVAL` — 422 (`_require_visit_stage`) для решения, отзыва, ручного согласования/возврата.
- **AF9. Несколько объектов без указания `visitObjectId`**: 422 «выберите, согласование какого из них вы правите» (`_approval_target`); нет объектов вовсе — 422.
- **AF10. Нет права**: 403 (`permission_map`); старший объекта без `event.manage` проходит `_object_lead_override` только на send/withdraw/remark resolve, замещающий — только на remark resolve и только с `can_edit_placement`.
- **AF11. Ручное завершение/возврат по API**: `POST approval/approve/` (`assignment.approve`) — те же проверки, что в шаге 6, с явными отказами `APPROVAL_ROUTE_EMPTY`, `APPROVAL_STALE`, `APPROVAL_RETURNED`, `APPROVAL_INCOMPLETE`, `APPROVAL_REMARKS_OPEN`; `POST approval/return/` (`assignment.return`) — возврат с обязательной причиной. Кнопок в UI нет (`[СОГ-11]`).

## Изменения в системе
| Объект | Действие | Описание |
|---|---|---|
| `ops_security_event_visit_objects` (`OpsSecurityEventVisitObject`) | update | `approval_route` (статусы, `decidedAt`, `comment`, `signature`), `approval_snapshot`, `approval_status`, `approval_comment`, `approval_remarks`, `document_version`, `stage` (APPROVAL → ACKNOWLEDGEMENT / PLACEMENT) |
| `OpsPlacementDocumentVersion` | create / update | отправка: DRAFT→SUBMITTED (`sent_at`, `signature`, `snapshot`) или новая строка N+1 с `superseded_at` у решённой; решение: `status` APPROVED/RETURNED + `decided_at`; отзыв: SUBMITTED→DRAFT, `sent_at=NULL`; `created_by` — актор |
| `ops_security_events` (`OpsSecurityEvent`) | update | сводные `approval_status`/`approval_comment` (`_sync_event_approval`), `stage`/`readiness_percent` (`recompute_event_stage`) |
| `OpsSecurityEventTransition` | create | переход стадии ОМ: `FORWARD` (→ACKNOWLEDGEMENT) или `RETURN` (→PLACEMENT) — только при фактической смене стадии мероприятия |
| `OpsNotification` (`notify_service`) | create | вид `PLACEMENT_RETURNED` старшему объекта и замещающим (dedupe по объекту и деловой дате); после согласования — уведомления о заступлении (`notify_acknowledgement`) |
| `OpsApprovalRouteStep` | read | шаблон маршрута копируется на объект (`seed_route`) |
| `OpsPolicySetting` (`APPROVAL.RETURN_URGENT_DAYS`) | read | порог автосрочности замечаний (по умолчанию 1 день) |
| Журнал аудита (`audit_service.record`) | create | `SECURITY_EVENT_APPROVAL_SIGNED`, `SECURITY_EVENT_PLACEMENT_RETURNED`, `SECURITY_EVENT_APPROVAL_BY_OBJECT_LEAD`; `APPROVAL_ROUTE_REPLACED` — при замене маршрута в настройках |
| Аудит HTTP (`AuditMiddleware`) | create | запись каждого успешного POST/DELETE к `/api/ops/security-events/<id>/approval/...` |

## Бизнес-требования (BR)
- **BR1.** Согласование ведётся по объекту посещения, не по мероприятию: маршрут, замечания, снимок и версии документа принадлежат `OpsSecurityEventVisitObject`; при нескольких объектах `visitObjectId` обязателен.
- **BR2.** Маршрут задаётся в настройках раздела (`OpsApprovalRouteStep`, роль подписанта обязательна, учётка необязательна и должна существовать); объект получает копию при завершении расстановки или при первой отправке; правка настройки не переписывает маршруты уже идущих согласований.
- **BR3.** Отправка возможна только на этапе `APPROVAL` (или `ACKNOWLEDGEMENT`) объекта, при непустом маршруте и непустой подписи расстановки; у ОМ с несколькими объектами все посты должны быть отнесены к объектам.
- **BR4.** Отправка фиксирует снимок состава (`approval_snapshot` — отсортированные пары пост:сотрудник); изменение состава после отправки делает согласование устаревшим и блокирует завершение до повторной отправки.
- **BR5.** Версия документа растёт отправкой: черновик и «на согласовании» сохраняют номер; поверх согласованной или возвращённой версии создаётся N+1, прежняя помечается `superseded_at`. Все версии хранятся.
- **BR6.** Решения принимаются строго по порядку маршрута; решать может только строка со статусом `PENDING`.
- **BR7.** Строка маршрута с привязанной учёткой подписывается только этой учёткой (403 `APPROVAL_NOT_YOUR_TURN`); держатель `*` не сужается.
- **BR8.** Подпись хранит реквизиты: ФИО из кадровой записи, должность строки, логин, время, номер версии, первые 16 символов sha256 снимка, IP соединения (не из заголовка).
- **BR9.** Возврат требует причины; каждое замечание привязывается к посту своего объекта или «Общее»; срочность считает сервер по порогу `APPROVAL.RETURN_URGENT_DAYS`, если клиент не прислал.
- **BR10.** Возврат любым согласующим возвращает объект на `PLACEMENT`: подписи и ожидания сбрасываются в `NOT_SENT`, версия → `RETURNED`, уведомляются старший объекта и замещающие.
- **BR11.** Этап завершается автоматически последней подписью или последним ответом на замечание при условии: маршрут непуст, все `APPROVED`, нет `RETURNED`, нет открытых замечаний, расстановка не устарела. Кнопки «Завершить этап» у согласующего нет.
- **BR12.** Отзыв с согласования возможен только пока никто не подписал; отзыв снимает только `PENDING`, стирает снимок, возвращает документ в `DRAFT` тем же номером и объект — на `PLACEMENT`.
- **BR13.** Ответ на замечание: «Устранено» без обязательного ответа, «Не согласен» — ответ обязателен; возврат в «Открыто» допустим; в замечании фиксируется `resolvedInDocumentVersion`.
- **BR14.** Сводный статус ОМ: `RETURNED`, если возвращён хоть один объект (комментарий — от последнего по времени возврата); `APPROVED`, когда согласованы все; иначе `PENDING`.
- **BR15.** Переход стадии мероприятия записывается в append-only журнал переходов только при фактической смене стадии ОМ (стадия ОМ — наименьшая по объектам).
- **BR16.** Уведомление о возврате считает доставленное, а не попытки; сотрудники без учётки, уволенные и отказ вставки попадают в отчёт отдельными списками; сбой рассылки возврат не откатывает (`dispatchFailed` в аудите).
- **BR17.** Действие старшего объекта/замещающего в обход `event.manage` фиксируется именной записью `SECURITY_EVENT_APPROVAL_BY_OBJECT_LEAD`; правообладателю такая запись не ставится.

## Требования к логированию
- Аудит действий (`audit_service.record`): `SECURITY_EVENT_APPROVAL_SIGNED` (actor — логин подписанта или `system`; `eventCode`, `visitObjectId`, `approverId`, реквизиты подписи), `SECURITY_EVENT_PLACEMENT_RETURNED` (actor — логин вернувшего, для решения в маршруте — логин согласующего или `system`; `code`, `visitObjectId`, `objectName`, `comment`, `remarksOpen`, `notified`, `unlinked`, `undelivered`, `dismissed`, `nobody`, `dispatchFailed`), `SECURITY_EVENT_APPROVAL_BY_OBJECT_LEAD` (actor — учётка старшего/замещающего; `code`, `action` = approval_send / approval_withdraw / approval_remark_resolve, `leadId`, `leadName`, `visitObjectId`), `APPROVAL_ROUTE_REPLACED` (настройки; `old_value`/`new_value` — списки шагов).
- HTTP-аудит `AuditMiddleware`: каждый успешный write-запрос к `/api/ops/security-events/<id>/approval/...` и `/api/ops/approval-route/`.
- `logger.*` в `apps/ops/security_events.py` есть только в `respond_allocation` (сбор сил); на пути согласования вызовов логгера нет. Уровневое логирование (info/warning) отправки, подписи, отзыва, автозавершения — `Не реализовано в коде`.
- Отдельная аудит-запись об отправке на согласование правообладателем, об отзыве и об автозавершении этапа — `Не реализовано в коде` (след живёт в версии документа и маршруте; в HTTP-аудите — как запрос).

## Требования к правам
| Роль | Доступ | Как обеспечивается |
|---|---|---|
| ADMIN | полный | `*`; при `*` не действует привязка строки маршрута к учётке (`bypass_identity`) |
| EVENT_APPROVER | подпись / возврат в маршруте, ручные `approve/` и `return/` | `permission_map`: `approval_route_decide`, `approval_approve` → `assignment.approve`; `approval_return` → `assignment.return` |
| HEAD_OPS_UNIT | подпись / возврат + отправка, отзыв, ответы на замечания, маршрут объекта | `assignment.approve`, `assignment.return`; `event.manage` нет — отправка/отзыв только как старший объекта по данным (`_object_lead_override`) или через `placement.manage` не даёт; фактически: подпись/возврат по праву, остальное — `Не реализовано в коде` для этой роли без роли в данных |
| DUTY_PLANNER | подпись / возврат в маршруте | `assignment.approve`, `assignment.return` (`[СОГ-12]`, Plane №401) |
| EVENT_OFFICER | отправка, отзыв, ответы на замечания, add/remove/move маршрута по API | `event.manage` (`approval_send`, `approval_withdraw`, `approval_remark_resolve`, `approval_route_add/remove/move`) |
| Старший объекта посещения (`chief_employee_id`, любая роль без `event.manage`) | отправка, отзыв, ответы на замечания своего объекта | `_object_lead_override` (`_OBJECT_LEAD_ACTIONS`); аудит `SECURITY_EVENT_APPROVAL_BY_OBJECT_LEAD` |
| Замещающий (`OpsVisitObjectDeputy`, `can_edit_placement=True`) | ответы на замечания своего объекта | `_object_lead_override` (`_OBJECT_DEPUTY_ACTIONS`); замещающий без флага — нет |
| Администратор настроек (`settings.manage`) | замена маршрута в настройках | `OpsApprovalRouteViewSet.permission_map`: `list` → `settings.view`, `replace` → `settings.manage` |
| OPS_STAFF, PATROL_LEAD, GVO_LEAD, EMPLOYEE_OPS_D2, DIRECTORATE_HEAD, DEPARTMENT_EXPENSE_OFFICER, FORCES_GATHERING_OFFICER, DUTY_OFFICER, DUTY_PLAN_APPROVER, OBJECT_KEEPER, RATING_EVALUATOR, ANALYST, AUDITOR | чтение карточки ОМ и этапа | `event.view` (`retrieve`); кнопки этапа выключены с подсказкой причины (`AccessHints`, `RightGate`) |
| HEAD_DIRECTORATE_LINE, HEAD_DEPARTMENT_LINE, EMPLOYEE | нет | нет `event.view` |

## Требования к UX/UI
- Экран: карточка ОМ `/security-ops/events/<id>?step=…`, вкладка этапа «Согласование» — компонент `ApprovalStage.tsx` (панель этапа, страница). Маршрут по умолчанию — карточка «Маршрут согласования» на `/security-ops/settings` (`ApprovalRouteCard.tsx`: шаги с полями «Роль подписанта» (обязательное), «Подразделение», «Учётка» (placeholder «без привязки»), кнопки «Выше»/«Ниже»/«Снять шаг», добавить шаг, сохранить).
- Состав панели: полоса объектов посещения (`VisitObjectApprovalStrip`, выбор объекта); блок причин недоступности (`AccessHints`, `aria-describedby` на кнопках); алерт «Прошлый возврат: …» при `RETURNED`; жёлтый баннер «Расстановка изменилась после отправки…» при `stale`; KPI-плитки «постов», «назначено / потребность», «не укомплектовано», «обновлено».
- Секция «Маршрут согласования»: подзаголовок — статус документа словами (Черновик / На согласовании / Согласовано (версия N от …) / Возвращено / «Согласование сброшено: расстановка изменена») и «версия N» (`role="status"`); кнопки «Поправить расстановку» (пока документ правится и есть `placement.manage`), «Отозвать с согласования» (активна, пока есть `PENDING` и нет подписей), «Отправить на согласование» (маршрут непуст, право send). Таблица (горизонтальная прокрутка, min-width 900px): Порядок, ФИО (+ «учётка …», строка подписи «Согласовано <дата> · ФИО, должность · версия N · хэш»), Подразделение, Должность, Статус (NOT_SENT / PENDING / APPROVED / RETURNED — цветные подписи), Дата, Комментарий, Действия («Согласовать», «Вернуть» — только у строки `PENDING`). Пустое состояние: «Маршрут согласования не настроен — подписантов задаёт администратор в «Администрировании»…» со ссылкой. Формы добавления согласующего на объекте нет (снята, Plane №702).
- Модалка «Вернуть на доработку» (`data-slot="return-dialog"`): поле «Причина» (обязательное, placeholder «Что необходимо исправить»), список замечаний (текст, select «Пост» с опцией «Общее», чекбокс «Срочно», «Убрать замечание», «Добавить замечание»), подпись о правиле автосрочности, ошибки полей (`FieldErrors`), кнопки «Отмена» / «Вернуть».
- Секция замечаний (`ApprovalRemarks`): счётчик открытых, у каждого — текст, автор, дата, привязка (пост/«Общее»), «документ vN», бейдж «Срочно», статус (Открыто / Устранено / Не согласен), ответ; действия «Устранено», «Не согласен» (раскрывает textarea ответа, обязателен), «Вернуть в открытые».
- Секция «История версий документа «Расстановка сил»»: счётчик «Версия N · возврат K-й», список версий (vN, статус, «отменена» при `supersededAt`, diff словами «добавлен пост…/снят пост…/пост: было → стало» или «Изменений против предыдущей версии нет», автор, даты); скрыта, если единственная версия — черновик.
- Печатная форма расстановки (`PrintedPlacement`), пометка «согласовано» при `APPROVED`.
- Подпись внизу: «Этап завершится сам, когда подпишут все согласующие и не останется замечаний без ответа. Возврат любым согласующим возвращает объект на «Расстановку»». Ошибки мутаций — `StageError` под секцией.
- Состояние «Согласовывать нечего: строки расчёта не отнесены к объекту» с кнопкой показать первый объект.
- Загрузка прав: пока `useOpsPermissions` грузится, кнопки подписи/возврата считаются доступными (`approve: loading || canApprove`).

## Открытые вопросы
- Литерал `false` в условии формы добавления согласующего (`adding && rights.manageRoute && false`) снят вместе с формой (Plane №702, комментарий в `ApprovalStage.tsx` ~строка 980): вопрос закрыт, на текущем коде недостижимой разметки нет.
- Привязка строки маршрута к учётке «если в маршруте» (№429) реализована: `OpsApprovalRouteStep.username` → `approval_route[].username` → проверка `APPROVAL_NOT_YOUR_TURN` в `decide_approver`; при `bypass_identity` (`*`) не сужается. Строка без учётки подписывается любым держателем `assignment.approve` — роль «подписант без учётки» из докстринга модели («будущая роль») отдельно `Не реализовано в коде`.
- Эндпоинты `approval/route/` (add), `approval/route/<id>/` (remove), `approval/route/<id>/move/` живы на сервере под `event.manage`, но UI их не зовёт; серверной проверки «маршрут объекта нельзя править после отправки» в `add_approver`/`remove_approver`/`move_approver` нет — по API можно менять маршрут во время идущего согласования (снятие подписанной строки не запрещено).
- `approval_route_add`/`remove`/`move` не проверяют `_require_visit_stage` — работают на любом этапе объекта.
- Отправка допускается с этапа `ACKNOWLEDGEMENT` (`_require_visit_stage(visit, ("APPROVAL","ACKNOWLEDGEMENT"))`), тогда как сообщение об ошибке говорит только про «Согласование».
- «Дополнительно штабу при „Срочно“» и подъём объекта вверх в списке заявок (`[СБС-10]`) при возврате не реализованы — адресата «штаб» в правах раздела нет (докстринг `placement_return_notify.py`, Decisions).
- Рассылка о возврате — только внутренние уведомления `OpsNotification`; почта/SMS `Не реализовано в коде`.
- `HEAD_OPS_UNIT` имеет `assignment.approve/return` и `placement.manage`, но не `event.manage`: отправить/отозвать согласование он может только будучи старшим объекта по данным.
- В подписи `versionHash` считается от `approval_snapshot` объекта, а не от `signature` строки `OpsPlacementDocumentVersion`; после отзыва снимок пустой — при повторной подписи без переотправки хэш был бы от пустой строки (переотправка обязательна по коду, поэтому практически недостижимо).
- Ручной `approval/approve/` при пустом маршруте отвечает текстом «добавьте согласующих», хотя на объекте согласующих не добавляют (маршрут — в настройках).
