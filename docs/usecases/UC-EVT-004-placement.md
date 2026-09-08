# UC-EVT-004. Расставить силы по постам

| Поле | Значение |
|---|---|
| Модуль | Охранные мероприятия |
| Актор | Старший объекта / мероприятия (PATROL_LEAD, HEAD_OPS_UNIT — `placement.manage`), штаб (OPS_STAFF_COMMAND — `placement.command`), ведущий мероприятие (EVENT_OFFICER — `event.manage`, завершение этапа), замещающий на объекте (`OpsVisitObjectDeputy.can_edit_placement`, роль в данных), ADMIN |
| Статус | Partial |
| Основание | `apps/ops/api/views.py` SecurityEventViewSet (`placement_assign`, `placement_unassign`, `placement_move`, `placement_post_remove`, `placement_sector_senior`, `placement_complete`, `visit_object_deputy_add/remove`, `permission_override`, `permission_bypass_map`, `_require_placement_lead`); `apps/ops/security_events.py` (`assign_placement`, `move_placement`, `unassign_placement`, `remove_placement_post`, `set_sector_senior`, `complete_placement`, `_autopass_demand_and_forces`, `recompute_visit_needs`, `placement_frozen`, `deputy_can_edit_placement`, `placement_is_led_by`, `_ensure_document_version`); `apps/operations/models_event.py` (`OpsSecurityEvent.placement_assignments`, `OpsSecurityEventVisitObject`, `OpsVisitObjectDeputy`, `OpsPlacementDocumentVersion`); FRONT `features/security-event-stages/ui/PlacementStage.tsx`, `features/ops-conflict-override/ui/ConflictDialog.tsx`, `hooks/use-security-event-stages.ts`, `lib/ops-errors.ts`, `features/event-visit-objects/ui/AddDeputyDialog.tsx`, e2e `placement-stage.spec.ts`, `placement-pool.spec.ts`, `placement-reopen.spec.ts` |
| Дата актуализации | 2026-09-08 |

## Цель
Старший объекта расставляет принятый штабом состав по постам расчёта рекогносцировки и завершает этап «Расстановка», получив черновик документа «Расстановка сил» v1 и переход объекта на «Согласование».

## Предусловия
- Мероприятие (`OpsSecurityEvent`) прошло рекогносцировку: `recon_sector_posts` заполнены, `_autopass_demand_and_forces` перевёл ОМ через `DEMAND` → `FORCES` на `PLACEMENT` (`demand_rows`, `demand_approved=True`, `force_requests` заведены автоматически; ручек `demand/approve` и `forces/complete` нет — сняты по Plane №149).
- У мероприятия есть объект посещения (`OpsSecurityEventVisitObject`) на этапе `PLACEMENT`; у объекта документ расстановки не отправлен и не согласован (`placement_frozen` = False) и объект не закрыт.
- Штаб принял состав в «Сборе сил»: `force_roster` непуст (иначе колонка кандидатов показывает пустое состояние `[РАС-05]` — «Силы на объект ещё не выделены»); при пустом `force_roster` серверное правило «только из состава» не включается.
- Актор аутентифицирован, имеет `placement.manage` и является старшим (`chief_employee_id` мероприятия или объекта), либо имеет `placement.command`, либо назначен замещающим объекта с `can_edit_placement=True`; для завершения этапа — `event.manage`.

## Main Flow
1. Актор открывает карточку ОМ `/security-ops/events/<id>` на шаге «Расстановка» (стадии `DEMAND`/`FORCES`/`PLACEMENT` рисуются одним экраном `PlacementStage`) и при нескольких объектах выбирает объект посещения (`?visit=`).
2. Система показывает дерево постов по секторам (посты объекта — `visit_object_posts`), сводку KPI (постов / требуется / назначено / свободно / незаполнено / конфликтов / сверх расчёта) и колонку кандидатов из состава мероприятия с поиском по ФИО, фильтром по управлению, сортировкой и полосой рейтинга.
3. Актор перетаскивает кандидата на пост (или нажимает «Назначить», или «Распределить автоматически»); система `POST placement/assign` с `postId`, `employeeId`, необязательными `roleCode` (справочник `PLACEMENT_ROLES`) и `sectionCode` (`PLACEMENT_SECTIONS`).
4. Система проверяет: пост существует, сотрудник найден, состоит в `force_roster`, отдан этому объекту (`visitObjectId` строки состава), не занимает другой пост этого ОМ, расстановка объекта не заморожена; записывает назначение в `placement_assignments` (снимок имени и позывного) и пересчитывает `force_need` / `force_assigned` объекта.
5. Актор при необходимости переносит человека на другой пост перетаскиванием или через окно правки (пост, роль, секция) — `POST placement/<assignment_id>/move`, одна транзакция; отметка ознакомления и признак старшего при переносе снимаются.
6. Актор отмечает «Старший поста» чипом — `POST placement/<assignment_id>/senior`; система оставляет одного старшего на пост и пишет аудит `PLACEMENT_SECTOR_SENIOR_SET`.
7. Актор снимает лишний пустой пост при недоборе — `DELETE placement/posts/<post_id>` после диалога подтверждения; система пересобирает `demand_rows` и `force_need`, замечания снятого поста переводит в общие по объекту (`detachedPost`).
8. Актор снимает человека с поста («Удалить с поста») — `DELETE placement/<assignment_id>`.
9. Актор нажимает «Завершить расстановку» — `POST placement/complete` с `visitObjectId`; система проверяет этап ОМ и объекта, наличие постов и укомплектованность.
10. Система ставит `document_version=1`, создаёт строку `OpsPlacementDocumentVersion` (статус `DRAFT`, снимок постов и назначений, подпись), копирует маршрут согласования из настроек (`seed_route`), переводит объект на `APPROVAL`, пересчитывает этап ОМ (минимум по объектам) и пишет `OpsSecurityEventTransition`.

## Alternative Flow
- **AF1. Кандидат не в составе или отдан другому объекту**: шаг 4 → 422 `NOT_IN_ROSTER` с сообщением «… не в составе мероприятия» / «отдан(а) объекту „…“»; экран показывает ошибку (`StageError`).
- **AF2. Сотрудник уже на другом посту этого ОМ**: шаг 4/5 → 422 `DOUBLE_ASSIGNMENT`.
- **AF3. Мягкий конфликт**: шаг 4/5 → 409 `SOFT_CONFLICT_DETECTED` (`overridable`) со списком `conflicts`: `RATING_DATA_MISSING` (у поста задан `minRating`, данных рейтинга у сервера нет) и/или `OVER_NEED` (на посту уже `need` и более человек). Экран открывает `ConflictDialog`, актор вводит причину (10–500 символов), клиент повторяет тот же запрос с `override=true`, `override_reason`; причина сохраняется в `ratingOverrideReason` / `needOverrideReason` назначения.
- **AF4. Расстановка заморожена**: любая правка (шаги 3–8) при документе объекта `SUBMITTED`/`APPROVED` либо закрытом объекте → 422 `PLACEMENT_FROZEN` с `visitObjectId`, `stage`, `documentStatus`, `closed`.
- **AF5. Пост занят при снятии поста**: шаг 7 → 422 `POST_HAS_ASSIGNMENTS` («На посту стоит N чел. (…) — сначала снимите их»); диалог остаётся открытым и показывает ошибку. Снятие поста не на этапе `PLACEMENT` ОМ → 422 `INVALID_STAGE_TRANSITION`.
- **AF6. Недобор при завершении**: шаг 9 → 409 `PLACEMENT_UNDERSTAFFED` (`overridable`, `unfilledCount`) «K постов без людей. Завершить с недобором?»; после причины в `ConflictDialog` повтор с `override=true` завершает этап и пишет аудит `PLACEMENT_COMPLETED_WITH_SHORTAGE`.
- **AF7. Постов у объекта нет**: шаг 9 → 422 `PLACEMENT_INCOMPLETE` («Не все посты укомплектованы»), override не помогает.
- **AF8. Этап не тот**: шаг 9 при ОМ не на `PLACEMENT` или объекте уже дальше → 422 `INVALID_STAGE_TRANSITION`; кнопка «Завершить расстановку» на шаге, открытом назад с «Согласования», погашена (`placementAlreadyCompleted`).
- **AF9. Нет объектов / несколько без выбора**: шаг 9 → ошибка `pick_visit_object` («добавьте объект…» / «выберите, чью расстановку завершить»).
- **AF10. Не старший**: шаги 3, 5, 7, 8 при `placement.manage` без `placement.command`/`*` и без совпадения с `chief_employee_id` мероприятия/объекта → 403 `PERMISSION_DENIED` (`_require_placement_lead`); если старший не назначен нигде — проверка пропускает.
- **AF11. Замещающий на чужом посту**: `permission_override` не срабатывает (`deputy_can_edit_placement`: пост размечен другим объектом, либо объектов несколько и пост не размечен) → 403.
- **AF12. Роль/секция не из справочника или неактивна**: 400 `VALIDATION_ERROR` (`roleCode`/`sectionCode`).
- **AF13. Пост или назначение не найдены**: 404 `ENTITY_NOT_FOUND`.
- **AF14. Перенос без известного поста-истока в клиенте**: тост «Не удалось определить пост, с которого переносят…», запрос не уходит.

## Изменения в системе
| Объект | Действие | Описание |
|---|---|---|
| `ops_security_event.placement_assignments` (JSON) | update | добавление/удаление/перенос назначений; поля `id`, `postId`, `employeeId`, `employeeName`, `callsign`, `roleCode`, `sectionCode`, `acknowledgedAt`, `ratingOverrideReason`, `needOverrideReason`, `isSectorSenior` |
| `ops_security_event.recon_sector_posts`, `demand_rows`, `force_need` | update | при снятии пустого поста (`remove_placement_post`); `recon_force_request`, `force_requests`, `force_allocation`, `readiness_percent` не трогаются |
| `OpsSecurityEventVisitObject.force_need`, `force_assigned` | update | `recompute_visit_needs` после каждой правки расстановки |
| `OpsSecurityEventVisitObject.approval_remarks` | update | замечания снятого поста: `postId=None`, `detachedPost=<подпись>` |
| `OpsSecurityEventVisitObject.document_version`, `stage`, `approval_route` | update | завершение: `document_version=1` (не меньше текущей), `stage=APPROVAL`, маршрут из настроек (`seed_route`) |
| `OpsPlacementDocumentVersion` | create | строка версии `number=1`, `status=DRAFT`, `signature`, `snapshot` (посты + назначения объекта), `created_by` (`_ensure_document_version`; если строка уже есть — не создаётся) |
| `OpsSecurityEvent.stage`, `readiness_percent` | update | пересчёт этапа ОМ минимумом по объектам (`advance_visits`) |
| `OpsSecurityEventTransition` | create | `PLACEMENT → APPROVAL`, если этап ОМ изменился |
| `OpsVisitObjectDeputy` | create / delete | назначение и снятие замещающего объекта (`employee_id`, `employee_name`, `can_edit_placement`, `assigned_by`) |
| Аудит действий (`audit_service.record`) | create | `PLACEMENT_SECTOR_SENIOR_SET`, `PLACEMENT_COMPLETED_WITH_SHORTAGE`, `SECURITY_EVENT_PLACEMENT_BY_DEPUTY`, `SECURITY_EVENT_DEPUTY_ASSIGNED`, `SECURITY_EVENT_DEPUTY_REVOKED` |
| HTTP-аудит (`apps/audit` AuditMiddleware) | create | каждый успешный write-запрос к `/api/ops/security-events/<id>/placement/...` и `.../deputies` |
| Леджер сил (`signals.py` post_save → `project_forces_ledger`) | update | проекция при каждом сохранении `OpsSecurityEvent` |

## Бизнес-требования (BR)
- **BR1.** Стадии `DEMAND` и `FORCES` проходятся сервером автоматически при завершении рекогносцировки (`_autopass_demand_and_forces`): `demand_rows` строятся из постов, `demand_approved=True`, заявка на силы одна (`force-request-1`, `requestedCount=force_need`, если > 0); ОМ и все объекты сразу на `PLACEMENT`; отдельных экранов и ручек утверждения потребности нет.
- **BR2.** Раскладка сил штабом правится на стадиях `DEMAND`, `FORCES`, `PLACEMENT` (`_ALLOCATION_STAGES`): состав принимается, пока ОМ уже стоит на расстановке.
- **BR3.** На пост ставят только сотрудника из `force_roster`; если строка состава несёт `visitObjectId`, — только на посты этого объекта. У ОМ без состава правило не включается.
- **BR4.** Сотрудник не может занимать два поста одного ОМ (`DOUBLE_ASSIGNMENT`, жёсткое правило); при переносе переносимая строка исключается из проверки.
- **BR5.** Мягкие предупреждения (`RATING_DATA_MISSING` при заданном `minRating`; `OVER_NEED` при `taken >= need`) собираются в один 409 и обходятся непустым `override_reason` при `override=true`; причина хранится раздельно по типу конфликта. При переносе конфликты считаются на посту-приёмнике без переносимого.
- **BR6.** `roleCode` и `sectionCode` необязательны, но если заданы — должны быть активными записями справочников `PLACEMENT_ROLES` / `PLACEMENT_SECTIONS`.
- **BR7.** Имя и позывной сотрудника фиксируются снимком в момент назначения.
- **BR8.** Правка расстановки запрещена, пока документ объекта `SUBMITTED` или `APPROVED` либо объект закрыт (`stage=CLOSED` / `closed_at`); черновик и возвращённый документ правятся.
- **BR9.** Заморозка проверяется по объекту поста: у единственного объекта неразмеченные посты — его; при нескольких объектах неразмеченный пост ничей. При переносе проверяются оба объекта (исток и приёмник).
- **BR10.** Перенос сохраняет `id` назначения, снимает `acknowledgedAt` и `isSectorSenior`; отказ сервера ничего не меняет.
- **BR11.** Старший поста — один на пост: назначение снимает признак у остальных назначений того же поста.
- **BR12.** Снять с расчёта можно только пустой пост и только на этапе `PLACEMENT` ОМ; замечания согласования по снятому посту сохраняются как общие по объекту.
- **BR13.** Числа объекта `force_need` / `force_assigned` — снимки, пересчитываемые после каждой правки; неразмеченные посты при нескольких объектах в суммы не входят.
- **BR14.** Завершение расстановки идёт по объекту (`visitObjectId`; при одном объекте выбирается сам, при нескольких обязателен); требует `stage=PLACEMENT` у ОМ и у объекта, хотя бы один пост; недобор — 409 с обязательным комментарием; пустой расчёт override не снимает.
- **BR15.** После завершения документ «Расстановка сил» — версия 1 в статусе `DRAFT`; версия не откатывается, если уже выросла; маршрут согласования копируется из настроек; объект переходит на `APPROVAL`.
- **BR16.** Расставляет старший: держатель `placement.manage` должен совпадать с `chief_employee_id` мероприятия или любого его объекта; если старший не назначен нигде — допускается любой держатель права; `placement.command` и `*` проверку снимают.
- **BR17.** Замещающий с `can_edit_placement=True` правит расстановку своего объекта (назначить, снять, перенести, снять пост) без кода права; каждое его действие пишется в аудит именно как действие замещающего. Замещающие назначаются и снимаются только на незакрытом ОМ и открытом объекте; один сотрудник — один раз на объект.
- **BR18.** Завершение этапа и назначение старшего поста замещающему не открыты; завершение — только `event.manage`.
- **BR19.** Клиент: причина обхода конфликта — 10–500 символов после trim (`ConflictDialog`); сервер требует лишь непустую строку.

## Требования к логированию
- Аудит действий (`OpsAuditLog` через `audit_service.record`): `PLACEMENT_SECTOR_SENIOR_SET` (actor, `code`, `sector`, `postId`, `post`, `employeeId/Name`, `old_value` — прежний старший); `PLACEMENT_COMPLETED_WITH_SHORTAGE` (`visitObjectId`, `unfilledCount`, `comment`); `SECURITY_EVENT_PLACEMENT_BY_DEPUTY` (`deputyId`, `deputyName`, `operation` ASSIGN/UNASSIGN/MOVE/REMOVE_POST, `postId`/`assignmentId`); `SECURITY_EVENT_DEPUTY_ASSIGNED` / `SECURITY_EVENT_DEPUTY_REVOKED` (объект, сотрудник, `canEditPlacement`).
- HTTP-аудит: `AuditMiddleware` пишет каждый успешный write-запрос к `/api/`.
- Журнал переходов: `OpsSecurityEventTransition` при смене этапа ОМ (`record_transition`).
- Обычные назначение/снятие/перенос правообладателем в аудит действий не пишутся — след живёт в `placement_assignments` (осознанно, комментарий в `_record_deputy_placement`). Не реализовано в коде: аудит обхода мягкого конфликта (`override_reason` при назначении/переносе хранится только в JSON назначения, отдельной записи аудита нет).
- Логгер `logging.getLogger` в `security_events.py` на пути расстановки не вызывается (`logger.warning/exception` — строки 4780/4791, другой путь). Не реализовано в коде: прикладные логи расстановки.

## Требования к правам
| Роль | Доступ | Как обеспечивается |
|---|---|---|
| ADMIN | полный | `*`; `_require_placement_lead` при `*` не сужает |
| PATROL_LEAD | правка расстановки своего объекта/мероприятия (assign, unassign, move, post_remove, sector_senior); завершение этапа — нет | `placement.manage` в `permission_map` + `_require_placement_lead` (совпадение с `chief_employee_id` ОМ или объекта; при отсутствии старшего — допуск); `placement_sector_senior` проверки «своё ли» не имеет |
| HEAD_OPS_UNIT | как PATROL_LEAD | `placement.manage`; `event.manage` у роли нет — завершить этап не может |
| OPS_STAFF_COMMAND (роль-добавка) | правка расстановки на любом объекте — только вместе с `placement.manage` от основной роли | `placement.command` в `permission_bypass_map` снимает проверку «своё ли» в `_require_placement_lead`; сам по себе расстановку не открывает |
| EVENT_OFFICER | завершение расстановки, назначение/снятие замещающих; правка расстановки — нет | `event.manage` для `placement_complete`, `visit_object_deputy_add/remove` |
| Замещающий объекта (роль в данных, любая роль с активным сотрудником) | assign, unassign, move, post_remove на постах своего объекта; senior и complete — нет | `permission_override` → `_DEPUTY_ACTIONS` + `deputy_can_edit_placement` (`OpsVisitObjectDeputy.can_edit_placement=True`), действие пишется в аудит `SECURITY_EVENT_PLACEMENT_BY_DEPUTY` |
| OPS_STAFF, GVO_LEAD, EVENT_APPROVER, EMPLOYEE_OPS_D2, FORCES_GATHERING_OFFICER, DIRECTORATE_HEAD, DEPARTMENT_EXPENSE_OFFICER, DUTY_*, OBJECT_KEEPER, RATING_EVALUATOR, ANALYST, AUDITOR | чтение карточки (этап видит) | `event.view` (OPS_READ) на `retrieve`; write-ручки — 403 |
| HEAD_DIRECTORATE_LINE, HEAD_DEPARTMENT_LINE, EMPLOYEE | нет | `event.view` отсутствует |
| Фронт | кнопки «Назначить», перетаскивание, «Снять пост», «Распределить автоматически» — по `placement.manage`; «Завершить расстановку» — по `event.manage`; иначе `RightGate` с причиной | `useChainAccess` → `useOpsPermissions().hasPermission`; проверку «своё ли» и статус замещающего клиент не делает |

## Требования к UX/UI
- Экран: карточка ОМ `/security-ops/events/<id>`, шаг «Расстановка» (компонент `PlacementStage`, `Card role="region" aria-label="Расстановка сил"`); тот же экран рисуется для стадий `DEMAND` и `FORCES`. Переключатель объекта посещения в шапке карточки (`?visit=`) при нескольких объектах; метка «В разработке» из `in-development.ts`.
- Шапка: KPI «постов / требуется / назначено / свободно / незаполнено (warn) / конфликтов (bad) / сверх расчёта (warn)»; кнопки «Распределить автоматически» (outline, disabled при `unfilled === 0`, без права — `RightGate` с причиной) и «Завершить расстановку» (disabled при `complete.isPending`, без `event.manage`, при `placementAlreadyCompleted` — причина «Расстановка уже завершена — вернитесь к согласованию»); строка-предупреждение (`placementWarning`): «не укомплектовано постов: N — завершение спросит подтверждения; назначений с обходом предупреждения по рейтингу: N; постов усилено сверх расчёта: N» — только если есть что сказать.
- Левая колонка `aside aria-label="Дерево постов"`: секторы → посты, счётчик назначено/need, подпись «Старший поста: …»/«Старшие постов: …», пост — цель drop; у пустого поста при `placement.manage` кнопка-иконка «Снять пост с расстановки» → диалог «Снять пост „…“?» с описанием (сектор, уменьшение потребности на `need` чел., заявка штабу не меняется), кнопки «Отмена» / «Снять пост» (destructive, закрывается по ответу сервера, ошибка показывается в диалоге).
- Центр: выбранный пост, «Слоты поста» (`ul aria-label`) — строки назначений (`data-testid=placement-assignment-<id>`, draggable по `placement.manage`), чип-переключатель «Старший поста» (`aria-label="Старший поста: <имя>"`), кнопка «Удалить с поста», окно правки назначения (селекты «Роль наряда», «Секция бланка», «Пост» — клавиатурная альтернатива перетаскиванию), кнопка «Открыть краткую информацию о рейтинге» (`RatingBriefDialog`, по `rating.view_aggregate`), блок замечаний согласования (`aria-label="Замечания согласования"`).
- Правая колонка — кандидаты из состава: «Поиск по ФИО», «Фильтр по управлению», «Сортировка кандидатов» («Рекомендуемые» и др.), «Фильтр по рейтингу»; строки draggable; «Совпадение %» считается на клиенте (60 + 25 за требование поста + 15 за рейтинг); подпись «Потребность объекта „…“: N» / «Потребность неотнесённых постов: N»; ссылка «Открыть „Сбор сил на ОМ“ →» (`/employees?view=forces&tab=collections`). Пустое состояние (`data-slot="placement-pool-empty"`): «Силы на объект ещё не выделены», «Заявки на силы по <код> ещё нет.» / «Заявка <код>: запрошено N чел. В состав штаб пока никого не принял.», ссылка «Сбор сил на ОМ →».
- Диалоги конфликта: три `ConflictDialog` (назначение, перенос, завершение), общий для раздела: заголовок — сообщение сервера, список `conflicts`, Textarea причины 10–500 символов, «Подтвердить» активна только при валидной причине, «Отмена»/Escape — без повтора.
- Ошибки сервера показываются `StageError`/`StageErrors`; тост при переносе без поста-истока. Состояния загрузки — `isPending` на кнопках («Завершение…», «Снятие…»).
- Замещающий: диалог «Замещающий на объекте» (`AddDeputyDialog`): выбор сотрудника, чекбокс «может править расстановку» (`canEditPlacement`, по умолчанию включён), уже назначенные исключаются из выбора.
- Zod-схемы форм нет: проверка на сервере (`VALIDATION_ERROR` по `employeeId`, `roleCode`, `sectionCode`).

## Открытые вопросы
- Метка «В разработке» DEMAND / FORCES / PLACEMENT (`shared/config/in-development.ts`): «Подписи по спецификации, перетаскивание, пустое состояние без списка (№445)».
- Клиент открывает кнопки расстановки только по коду `placement.manage` (`useChainAccess`); замещающий по данным без этого права получает погашенные кнопки и `RightGate`, хотя сервер (`permission_override`) его действия пропускает — UI для замещающего без права не проверен в коде.
- `placement_sector_senior` не вызывает `_require_placement_lead`: любой держатель `placement.manage` меняет старшего поста на чужом мероприятии; замещающему действие закрыто (не в `_DEPUTY_ACTIONS`).
- `OpsSecurityEvent.conflicts_count` инициализируется нулём при создании и расстановкой не обновляется; KPI «конфликтов» на экране считается на клиенте по `ratingOverrideReason`, сериализатор отдаёт `conflictsCount` из модели — два разных числа под одним словом.
- `RATING_DATA_MISSING` поднимается всегда, когда у поста задан `minRating`: данных рейтинга у сервера на этом пути нет, проверка требования поста — только предупреждение.
- Комментарий в `PlacementStage.tsx` (`placementWarning`) говорит «сервер отбивает `PLACEMENT_INCOMPLETE`» при недоборе, тогда как сервер отвечает 409 `PLACEMENT_UNDERSTAFFED`; `PLACEMENT_INCOMPLETE` — только при отсутствии постов.
- «Совпадение %» и объяснение автоподбора (`autoReasons`) живут только в сессии экрана; сервер факта «поставлено автоматически» не хранит (осознанное отклонение по комментарию в коде).
- `placement_is_led_by` возвращает True при отсутствии старшего у ОМ и всех объектов — осознанное послабление (Plane №74), закреплено в `Decisions.md`.
- Стадии `DEMAND` и `FORCES` в реестре `/security-ops/events` скрыты из фильтра (`page.tsx:95`), но остаются в перечислении `Stage` модели и `STAGE_READINESS` — достижимы только через `stage_override`.
