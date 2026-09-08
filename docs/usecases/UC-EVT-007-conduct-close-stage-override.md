# UC-EVT-007. Провести и закрыть мероприятие, переопределить этап

| Поле | Значение |
|---|---|
| Модуль | Охранные мероприятия |
| Актор | EVENT_OFFICER (event.manage); старший ОМ / старший объекта / замещающий с can_edit_placement (замена по данным); ADMIN, OPS_STAFF_COMMAND (event.stage_override); ADMIN (event.delete) |
| Статус | Partial |
| Основание | apps/ops/security_events.py (add_journal_entry, replace_assignment, override_stage, STAGE_OVERRIDE_TARGETS, close_visit_object, close_event, _finalize_event_closure, recompute_event_stage, delete_event, DELETE_FORBIDDEN_STAGES, update_bulletin_details, record_transition), apps/ops/conduct_evaluations.py (set_score, score_all, visit_evaluations), apps/ops/api/views.py SecurityEventViewSet (journal, conduct_replace, stage_override, close, destroy, visit_object_close, visit_object_evaluations, visit_object_evaluations_all, details, _stage_lead_override), apps/ops/api/serializers.py _closure_summary, apps/operations/models_event.py (OpsSecurityEvent, OpsSecurityEventVisitObject, OpsSecurityEventTransition), apps/operations/audit_service.py, FRONT features/security-event-stages/ui/ConductStage.tsx, ClosedView.tsx, app/security-ops/events/[id]/page.tsx (StageViewNotice), app/security-ops/events/page.tsx (удаление), hooks/use-security-event-stages.ts |
| Дата актуализации | 2026-09-08 |

## Цель
Ведущий мероприятия на этапе «Проведение» фиксирует ход ОМ (журнал штаба, инциденты, замены, оценки по постам), закрывает объекты посещения и мероприятие целиком с итоговым комментарием; администратор при необходимости переводит ОМ на произвольный этап или удаляет ошибочно заведённое ОМ.

## Предусловия
- ОМ существует, `event.stage == "CONDUCT"` (для журнала, замены, оценок и закрытия); для замены допустим также `ACKNOWLEDGEMENT`.
- У ОМ есть объекты посещения (`OpsSecurityEventVisitObject`); стадия ОМ — минимум по стадиям объектов (`recompute_event_stage`).
- Актор аутентифицирован; права выданы ролью (`ROLE_PERMISSIONS`) или ролью в данных (старший ОМ/объекта, замещающий).
- Для перевода этапа: право `event.stage_override`; целевой этап входит в `STAGE_OVERRIDE_TARGETS` = BULLETIN, RECON, PLACEMENT, APPROVAL, ACKNOWLEDGEMENT, CONDUCT (CLOSED в списке нет намеренно).
- Для удаления: право `event.delete`; ОМ не в стадии CLOSED, без `placement_assignments` и `journal_entries`.

## Main Flow
1. Ведущий открывает карточку ОМ на этапе «Проведение» (`/security-ops/events/[id]`), выбирает объект посещения в шапке (`VisitObjectPicker`).
2. В панели «Оценки участников» ставит оценки 1–10 назначенным на посты объекта по одному (`POST visit-objects/<id>/evaluations`) или «Всем 10» неоценённым (`POST …/evaluations/all`); при оценке ≤ 5 система лишь подсказывает «желательно пояснить».
3. В панели «Инциденты и замечания» добавляет записи типа INCIDENT с временем, постом, описанием, подробностями и принятыми мерами (`POST journal`); в панели «Журнал штаба» — записи INSTRUCTION / ORDER с заголовком и описанием.
4. При выбытии сотрудника ведущий (или старший ОМ/объекта, замещающий) выполняет «Замена выбывшего» (`POST conduct/replace`): выбирает назначение, сотрудника-замену и причину; система создаёт новое назначение с унаследованными ролью и секцией и пишет запись журнала типа REPLACEMENT с постом.
5. Ведущий нажимает «Закрыть объект»; система в подтверждении показывает «Оценено K из N, инцидентов M», предупреждает о неоценённых; ведущий вводит необязательный комментарий и подтверждает (`POST visit-objects/<id>/close`).
6. Система переводит объект в CLOSED, ставит `closed_at`, `closing_comment`, пишет аудит VISIT_OBJECT_CLOSED и пересчитывает стадию ОМ по объектам.
7. Когда закрыт последний объект, система автоматически закрывает мероприятие: stage CLOSED, readiness 100 %, `closed_at`, запись перехода, открытие оценивания (`ratings.open_evaluation_for_event`), аудит SECURITY_EVENT_CLOSED.
8. Альтернативно ведущий закрывает ОМ целиком из панели «Закрытие и итоги»: видит итог одной строкой (постов · назначено из потребности · замен · отказов · инцидентов), вводит необязательный итоговый комментарий, нажимает «Закрыть мероприятие» (`POST close`); система закрывает все незакрытые объекты и выполняет тот же финал.
9. Карточка закрытого ОМ отображается как «Архив» с якорями «Итог · Оценки · Инциденты · Документы · История» и кнопкой «Скачать дело (PDF)» (`GET /api/ops/event-documents/render/?kind=case`).
10. Администратор (или OPS_STAFF_COMMAND), просматривая другой шаг цепочки, нажимает «Перевести ОМ сюда», подтверждает; система переводит все объекты и ОМ на выбранный этап (`POST stage`), снимает штампы закрытия, пишет переход и аудит SECURITY_EVENT_STAGE_OVERRIDDEN.
11. Администратор удаляет ошибочно заведённое ОМ из реестра (`DELETE /api/ops/security-events/<id>/`) после подтверждения «Удалить <код>?»; система пишет снимок в аудит SECURITY_EVENT_DELETED, удаляет строку с объектами посещения каскадом и снимает участия сотрудников на это ОМ.

## Alternative Flow
- **AF1. Действие не на этапе «Проведение»**: шаги 3, 5, 8 → 422 `INVALID_STAGE_TRANSITION` («Журнал штаба доступен только на этапе «Проведение».» / «Закрыть объект можно только на этапе «Проведение».» / «Закрыть ОМ можно только на этапе «Проведение».»); оценки — «Оценки ставятся на этапе «Проведение».». Замена вне ACKNOWLEDGEMENT/CONDUCT — 422 «Замена доступна на этапах «Ознакомление» и «Проведение».».
- **AF2. Пустой заголовок записи журнала**: шаг 3 → 422 `{title: ["Обязательное поле."]}`; форма показывает `FieldErrors`. Время инцидента разбирается (`_incident_moment`), не ISO — ошибка валидации.
- **AF3. Замена: причина пуста / сотрудник не найден / назначение не найдено / уже назначен на другой пост**: шаг 4 → 422 `reasonCode`/`incomingEmployeeId` «Обязательное поле.»/«Сотрудник не найден.»; 404 «Назначение не найдено.»; 422 `DOUBLE_ASSIGNMENT`.
- **AF4. Старший объекта заменяет назначение на чужом посту**: шаг 4 → `_stage_lead_override` возвращает False (`_replaces_own_post`) → 403.
- **AF5. Объект уже закрыт**: шаги 2, 5 → 422 `VISIT_OBJECT_ALREADY_CLOSED` («Объект уже закрыт — изменения после закрытия невозможны.»); ошибка показывается внутри диалога закрытия.
- **AF6. Оценка не целое / вне шкалы 1–10 / у назначения нет сотрудника**: шаг 2 → 422 `SCORE_NOT_INTEGER`, `SCORE_OUT_OF_SCALE`, `EVALUATION_TARGET_UNKNOWN`; для «Всем 10» `score=None` → `SCORE_NOT_INTEGER`.
- **AF7. Итоги направлений с пустым summary**: шаг 8 → 422 `directionSummaries.<i>.summary: Обязательное поле.` (само наличие итогов необязательно).
- **AF8. Перевод на недопустимый этап (в том числе CLOSED, DEMAND, FORCES)**: шаг 10 → 422 «На этот этап перевести нельзя.» (ошибка показывается в окне подтверждения).
- **AF9. Перевод на этап, где уже все объекты**: шаг 10 → идемпотентно, 200 без записи перехода и аудита.
- **AF10. Удаление закрытого ОМ или ОМ с расстановкой/журналом**: шаг 11 → 422 `EVENT_DELETE_FORBIDDEN` с текстом причины; фронт показывает destructive-toast «Мероприятие не удалено» с текстом сервера. Кнопка «Удалить» скрыта при `stage === "CLOSED"`.
- **AF11. Правка сведений бюллетеня закрытого ОМ (`PATCH details`)**: 422 «Мероприятие закрыто — сведения бюллетеня не меняются.»; на фронте «Редактировать бюллетень» скрыто при CLOSED.
- **AF12. Нет права**: 403 из `require_permission`; на фронте кнопки «Закрыть объект» / «Закрыть мероприятие» выключены с причиной (`AccessHints`, `RightGate`), панель оценок показывает «evaluation-locked», запрос сводки без `event.manage` не отправляется.
- **AF13. Двойное закрытие мероприятия (уже CLOSED)**: шаг 8 → AF1 (`_require_stage` CONDUCT).

## Изменения в системе
| Объект | Действие | Описание |
|---|---|---|
| OpsSecurityEvent.journal_entries (JSON) | update | новая запись `{id, type, title, description, occurredAt, postId, measures, createdAt}` в начало списка (журнал/инцидент); запись REPLACEMENT при замене |
| OpsSecurityEvent.placement_assignments (JSON) | update | замена: исходящее назначение удаляется, входящее добавляется с унаследованными roleCode/sectionCode, acknowledgedAt=null |
| OpsEventEvaluation | create / update | оценка этапа (method MANUAL, basis EXECUTION_OF_DUTIES); прежняя строка помечается `superseded_by_code`; `score=None` — снятие оценки |
| OpsEvaluationWorkItem | create | `_open_evaluation_once` / `open_evaluation_for_event` — задание оценщика при первой оценке и при закрытии |
| OpsSecurityEventVisitObject | update | stage=CLOSED, closed_at, closing_comment при закрытии; при override — stage=цель, closed_at=None, closing_comment="" у всех объектов |
| OpsSecurityEvent | update | закрытие: stage=CLOSED, readiness_percent=100, closed_at, closing_comment, closure_direction_summaries; override: stage, readiness_percent по STAGE_READINESS, closed_at=None при выходе из CLOSED |
| OpsSecurityEventTransition | create | запись перехода (FORWARD/RETURN) при закрытии и при override со сменой этапа |
| OpsSecurityEvent | delete | удаление строки; объекты посещения, замещающие, версии документов — каскадом по FK |
| Участия сотрудников (status_cleanup.purge_orphan_participations) | delete | снятие участий на удалённое ОМ, аудит STATUS_PARTICIPATIONS_PURGED |
| Журнал аудита (audit_service) | create | VISIT_OBJECT_CLOSED, SECURITY_EVENT_CLOSED, SECURITY_EVENT_STAGE_OVERRIDDEN, SECURITY_EVENT_DELETED (снимок до удаления, флаг forced), SECURITY_EVENT_DETAILS_UPDATED |
| Леджер сил (signals.project_forces_ledger) | update | пересчёт проекции по post_save OpsSecurityEvent |
| Документ «дело» (documents_case.render_case) | read | сборка PDF по закрытому ОМ по кнопке «Скачать дело» |

## Бизнес-требования (BR)
- **BR1.** Журнал штаба, оценки, закрытие объекта и закрытие ОМ доступны только при `event.stage == "CONDUCT"`; замена — на ACKNOWLEDGEMENT и CONDUCT.
- **BR2.** Заголовок записи журнала обязателен; тип на сервере не проверяется (принимается как есть); фронт из формы «Журнал штаба» шлёт только INSTRUCTION/ORDER, инциденты — отдельной формой с временем, постом, описанием и мерами.
- **BR3.** При замене причина и сотрудник обязательны; один сотрудник не может стоять на двух постах одного ОМ; роль и секция наследуются от заменяемого; в журнал пишется запись REPLACEMENT с `postId`.
- **BR4.** Оценка — целое 1–10 (`RATING_SCALE_MIN/MAX`); «Всем 10» ставит только неоценённым и не перезаписывает ручные; оценки закрытого объекта не меняются.
- **BR5.** Закрыть объект можно один раз; комментарий закрытия необязателен; неоценённые сотрудники закрытию не мешают.
- **BR6.** Стадия ОМ = наименьшая среди объектов; закрытие последнего объекта автоматически закрывает ОМ с тем же финалом, что ручное закрытие (штамп, переход, оценивание, аудит) [ЗАК-12].
- **BR7.** Закрытие ОМ целиком закрывает все незакрытые объекты; итоги по направлениям необязательны, но присланные — с непустым `summary`; итоговый комментарий необязателен [ЗАК-04].
- **BR8.** После закрытия: сведения бюллетеня не правятся, ОМ не удаляется, объекты не закрываются повторно; закрытые ОМ читают отчёты, история лиц/объектов (`EventHistoryDialog`) и «дело».
- **BR9.** Перевод этапа (override) допустим только на входные стадии шагов BULLETIN/RECON/PLACEMENT/APPROVAL/ACKNOWLEDGEMENT/CONDUCT; закрыть ОМ обходом нельзя; перевод двигает ВСЕ объекты разом; перевод на текущий этап всех объектов идемпотентен; при выходе из CLOSED снимаются `closed_at` ОМ и объектов, `closing_comment` объектов, итоги направлений ОМ сохраняются; перевод на CONDUCT открывает оценивание; аудит пишется всегда, переход — только при смене этапа ОМ.
- **BR10.** Удаление: запрещено для CLOSED и для ОМ с расстановкой или записями журнала; `force` доступен только команде `purge_probe_events`, через API не передаётся; ответ 204; участия на удалённое ОМ снимаются.
- **BR11.** Готовность по этапам: CONDUCT 95 %, CLOSED 100 % (`STAGE_READINESS`).

## Требования к логированию
- Аудит действий (`audit_service.record`, actor, entity SECURITY_EVENT, old/new value): VISIT_OBJECT_CLOSED (visitObjectId, objectName, code, comment); SECURITY_EVENT_CLOSED (stage old/new, code); SECURITY_EVENT_STAGE_OVERRIDDEN (stage old/new, code); SECURITY_EVENT_DELETED (снимок code/title/stage/businessDate/objectName/ownerName/forced — до удаления); SECURITY_EVENT_DETAILS_UPDATED (before/after сведений); STATUS_PARTICIPATIONS_PURGED при снятии участий.
- Журнал переходов `OpsSecurityEventTransition` — append-only, в той же транзакции (закрытие, override).
- HTTP-аудит: `AuditMiddleware` пишет каждый успешный write-запрос к `/api/` (journal, conduct/replace, evaluations, close, stage, DELETE).
- `logging.getLogger` в `security_events.py` используется только в пути ответа департамента по силам (forces), на пути проведения/закрытия вызовов `logger.` нет.
- Не логируется доменным аудитом: запись в журнал штаба / инцидент, замена участника, выставление оценки (только HTTP-аудит и запись в самом `journal_entries`) — `Не реализовано в коде`.

## Требования к правам
| Роль | Доступ | Как обеспечивается |
|---|---|---|
| ADMIN | полный (все действия, включая перевод этапа и удаление) | `*` |
| EVENT_OFFICER | журнал, инциденты, замена, оценки, закрытие объекта и ОМ, PATCH details | `event.manage` (permission_map: journal, conduct_replace, close, visit_object_close, visit_object_evaluations, visit_object_evaluations_all, details) |
| OPS_STAFF_COMMAND | перевод ОМ на произвольный этап | `event.stage_override` (permission_map: stage_override); других действий этапа нет |
| Старший ОМ (chief_employee_id) | замена участника | `_stage_lead_override` через `my_assignments.may_manage_stage` (conduct_replace ∈ `_STAGE_LEAD_ACTIONS`) |
| Старший объекта / замещающий с can_edit_placement | замена участника только на постах своего объекта | `_stage_lead_override` + `_replaces_own_post` |
| Создатель ОМ (owner_actor_id) | PATCH details | `_creator_override` (details ∈ `_CREATOR_ACTIONS`) |
| HEAD_OPS_UNIT, EMPLOYEE_OPS_D2, OPS_STAFF, PATROL_LEAD, GVO_LEAD, EVENT_APPROVER, FORCES_GATHERING_OFFICER, DIRECTORATE_HEAD, DEPARTMENT_EXPENSE_OFFICER, DUTY_*, OBJECT_KEEPER, RATING_EVALUATOR, ANALYST, AUDITOR | чтение карточки и архива | `event.view` (retrieve); `event.manage` нет → кнопки выключены с причиной, сводка оценок не запрашивается |
| RATING_EVALUATOR | ссылка «Оценка участников ОМ →» из панели закрытия | `rating.evaluate` (только фронт-ссылка на `/security-ops/ratings/workspace`) |
| HEAD_DIRECTORATE_LINE, HEAD_DEPARTMENT_LINE, EMPLOYEE | нет | `event.view` отсутствует |
| Удаление ОМ | только ADMIN | `event.delete` есть только у `*` (в ROLE_PERMISSIONS ни одной роли с `event.delete`, seed_operations.py строки 73, 501) |

## Требования к UX/UI
- Страница `/security-ops/events/[id]`, этап CONDUCT (`ConductStage`), порядок карточек: `VisitObjectPicker` (объект посещения), «Оценки участников» (`EvaluationPanel`: строки по назначениям объекта, цифры 1–10, поле «Комментарий (необязательно)», подсказка «Оценка N — желательно пояснить» при ≤ 5, кнопка «Всем 10» выключается при полной оценке/без права, прогресс «оценено K из N», состояние `evaluation-locked` без права), «Инциденты и замечания» (`IncidentsPanel`: «+ Добавить», форма: Время, Пост (select), Описание *, Подробности, Принятые меры; пусто — «Инцидентов не было»), «Закрытие объекта» (`VisitObjectClosurePanel`: кнопка «Закрыть объект» → диалог «Закрыть объект «<имя>»?» со строкой «Оценено K из N, инцидентов M. После закрытия изменения по объекту невозможны.» + «Мероприятие при этом закроется целиком.» для последнего объекта, предупреждение «N сотрудников без оценки…», поле «Итоговый комментарий по объекту (необязательно)», ошибка сервера внутри окна; черновик чистится при закрытии окна и смене объекта), «Закрытие и итоги» (`ClosurePanel`: строка «Постов N · назначено K из N · замен · отказов · инцидентов», поле «Итоговый комментарий (необязательно)», ссылка «Оценка участников ОМ →» при `rating.evaluate`, кнопка «Закрыть мероприятие»), «Контроль постов» (`PostControlPanel`, разрез укомплектованности), «Журнал штаба» (`JournalPanel`: Тип (Указание/Приказ), Заголовок *, Описание, `FieldErrors`/`StageError`), «Замена выбывшего» (`ReplacementPanel`: «Кого заменить» (select назначений), сотрудник, «Причина *» placeholder «Например: болезнь», кнопка «Заменить»/«Замена…»).
- Выключенные кнопки закрытия сопровождаются причиной (`AccessHints`, `RightGate`, `aria-describedby`), а не только серым цветом.
- Этап CLOSED (`ClosedView`): заголовок «Архив · <код>», навигация-якоря «Итог · Оценки · Инциденты · Документы · История», карточки: Итог (строка сводки, комментарий закрытия), Оценки участников (ссылка в реестр оценок `?event=<код>`), Инциденты (с постом или «пост не указан»), Документы (ссылки на RECON/BULLETIN, паспорт объекта), История (переходы и старые итоги направлений), кнопка «Скачать дело (PDF)» / «Сборка дела…» с подписью состава дела и строкой «сохранено: …». Панель «Сведения об ОМ» у закрытого ОМ не показывается.
- Перевод этапа: при просмотре другого шага цепочки (`EventStepper`, `?step=`) полоса `StageViewNotice` («Этап пройден / Этап ещё не открыт · мероприятие на шаге N», «Форма только для чтения», кнопка «К текущему шагу»); при `event.stage_override` — кнопка «Перевести ОМ сюда» → диалог «Перевести мероприятие на шаг N «…»?» с описанием (стадия сменится на сервере, переход в журнал и аудит), кнопки «Отмена»/«Перевести»/«Перевод…», ошибка сервера внутри окна; панель чужого шага `inert` с opacity 60 %. Без права параметр `?step=` не действует.
- Удаление: реестр `/security-ops/events` → меню строки → «Удалить» (только при `event.delete` и stage ≠ CLOSED) → диалог «Удалить <код>?» с описанием последствий и предупреждением про расстановку/журнал, кнопки «Отмена»/«Удалить»/«Удаление…»; успех — toast «Мероприятие <код> удалено», отказ — destructive-toast с текстом сервера. В карточке ОМ кнопки удаления нет.
- Zod-схем у форм этапа нет: валидация серверная (`FieldErrors`), обязательность помечена «*» в подписи.
- Диалог `RatingBriefDialog` (краткая информация о рейтинге по бейджу сотрудника, только просмотр) и `EventHistoryDialog` (история закрытых ОМ по лицу/объекту) — связанные экраны чтения, оценок не ставят.

## Открытые вопросы
- Метка «В разработке» этапа CONDUCT (in-development.ts): «Оценки 1–10 по постам внутри этапа, «Закрыть объект» с подтверждением (№433)»; «Итог одной строкой, поля инцидента, один необязательный комментарий (№448)».
- Метка «В разработке» этапа CLOSED: «Архив с якорями, «Скачать дело» (№437, №448)»; «Мероприятие закрывается по всем объектам автоматически (№404)». Код всех четырёх карточек в дереве есть (`close_visit_object`, `_finalize_event_closure`, `ClosedView`, `CaseDownload`), метки не сняты — карточки не закрыты заказчиком.
- Тип записи журнала (`entry_type`) на сервере не валидируется: API принимает любую строку, в том числе INCIDENT без времени/поста (фронт эту дорогу закрыл, №729, сервер — нет).
- Запись в журнал штаба, инцидент, замена и выставление оценки не пишут доменный аудит (`audit_service`) — только HTTP-аудит; при этом override и закрытие пишут. Комментарий в `delete_event` называет журнал штаба «работой людей», но следа автора у записи нет (в `journal_entries` нет actor).
- `override_stage` при выходе из CLOSED снимает `closed_at` ОМ, но оставляет `closing_comment` ОМ (у объектов `closing_comment` стирается) — комментарий в коде оговаривает только итоги направлений; расхождение между уровнями ОМ и объекта.
- `close_event` по-прежнему принимает `directionSummaries` (сохраняются в `closure_direction_summaries`), а фронт их больше не шлёт (№448) — поле живёт только для истории.
- Закрытие объекта (`visit_object_close`) и оценки закрыты только `event.manage`: старший объекта/ОМ по данным (`_stage_lead_override`) их не имеет, хотя замену на том же этапе ведёт; в `_STAGE_LEAD_ACTIONS` эти действия не включены.
- Замена на CONDUCT не требует и не сбрасывает ознакомление входящего (`acknowledgedAt: null`), уведомления замене не отправляются — `Не реализовано в коде`.
- `ClosurePanel` печатает `event.closureSummary` (по всему ОМ), диалог закрытия объекта — сводку объекта; у ОМ с несколькими объектами записи журнала без `postId` не относятся ни к одному объекту (`_entries_of_visit`) и в сводке объекта не видны.
- Удаление ОМ доступно только из реестра; в карточке ОМ кнопки удаления нет. Ролей с `event.delete`, кроме ADMIN (`*`), в `ROLE_PERMISSIONS` нет.
- `EVENT_STEPS` на фронте — шесть шагов, `STAGE_OVERRIDE_TARGETS` — шесть стадий; перевод обратно из CLOSED возможен только через `?step=` на закрытом ОМ при наличии права — сценарий на экране не назван.
