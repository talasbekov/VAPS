# UC-EVT-001. Создать мероприятие и оформить бюллетень

| Поле | Значение |
|---|---|
| Модуль | Охранные мероприятия |
| Актор | EVENT_OFFICER, HEAD_OPS_UNIT, EMPLOYEE_OPS_D2 (право `event.create` / `event.bulletin`), ADMIN |
| Статус | Partial |
| Основание | `apps/ops/api/views.py` SecurityEventViewSet (`create`, `bindable_objects`, `visit_object_add`, `visit_object_detail`, `details`, `event_chief`, `bulletin`, `bulletin_complete`, `permission_override`), `apps/ops/security_events.py` (`create_event`, `update_bulletin_details`, `set_event_chief`, `add_visit_object`, `update_visit_object`, `update_bulletin`, `complete_bulletin`, `resolve_protected_persons`, `record_transition`), `apps/ops/event_location.py` (`resolve_location`, `compose_location`, `parse_person_details`), `apps/operations/models_event.py` (OpsSecurityEvent, OpsSecurityEventPerson, OpsSecurityEventVisitObject, OpsSecurityEventTransition), FRONT `features/create-security-event/ui/*` (CreateSecurityEventDialog, EditBulletinDialog, ObjectPicker, ProtectedPersonsPicker, ChiefCombobox, LocationFields, PersonDetailsFields, BulletinRowPreview), `features/security-event-stages/ui/BulletinPanel.tsx`, `features/security-event-stages/ui/AwaitingReconStage.tsx`, `features/event-visit-objects/ui/AddVisitObjectsDialog.tsx`, `EventChiefDialog.tsx`, `app/security-ops/events/page.tsx`, `app/security-ops/events/[id]/page.tsx`, `hooks/use-create-security-event.ts`, `hooks/use-security-event-stages.ts` |
| Дата актуализации | 2026-09-08 |

## Цель
Завести охранное мероприятие (ОМ) с автоматическим номером, заполнить сведения бюллетеня (тип, период, охраняемые лица, локация, объекты посещения, старший) и открыть по нему рекогносцировку.

## Предусловия
- Актор аутентифицирован; для реестра `/security-ops/events` нужно `event.view`, для создания — `event.create` (сервер, `permission_map["create"]`).
- Справочники заполнены: охраняемые лица (`OpsProtectedPerson`, `is_active=True`), страны/города (`OpsCountry`/`OpsCity`, `is_active=True`), объекты реестра (`OpsSecurityObject`), сотрудники (`Employee`, `is_active=True`) — для выбора старшего.
- У объекта, который привязывается к ОМ, желательна опубликованная версия паспорта (`OpsPassportVersion`) на дату ОМ — иначе привязка `passport_binding` пуста, импорт постов на рекогносцировке невозможен (окно предупреждает «паспорт не опубликован»).

## Main Flow
1. Актор в реестре ОМ нажимает «+ Создать бюллетень».
2. Система открывает модальное окно «Создать бюллетень» с подставленной локацией по умолчанию (Казахстан → Астана).
3. Актор выбирает тип мероприятия («Внутреннее» / «С участием иностранцев»), период (дата начала и окончания), при необходимости время с пометкой «прилёт/вылет» и номер борта.
4. Актор выбирает одно или несколько охраняемых лиц (первое в списке — главное), вводит название, страну, город, адрес.
5. Актор при желании выбирает объект из реестра (или заводит новый по названию) и старшего наряда / старшего ГВО.
6. Актор сверяет превью «Так строка ляжет в бюллетень» и нажимает «Создать бюллетень».
7. Система проверяет поля, выдаёт код `ОМ-<год>-<N>` (следующий за наибольшим выданным в этом году), привязывает действующую версию паспорта объекта на дату ОМ, создаёт ОМ, связки с лицами и (если объект выбран) первый объект посещения с унаследованным старшим; пишет переход в журнал и запись аудита `SECURITY_EVENT_CREATED`.
8. Система ставит стадию: `RECON` при выбранном объекте, `BULLETIN` без объекта; переводит актора в карточку ОМ.
9. Актор при необходимости дополняет ОМ из реестра: «Добавить объект» (объекты посещения), «Назначить/Заменить старшего наряда», «Редактировать бюллетень» (название, период, время, лица, локация).
10. Для ОМ без объекта актор в карточке на шаге «Рекогносцировка ещё не начата» нажимает «Открыть рекогносцировку»; система переводит ОМ в `RECON` (условие: текущая стадия `BULLETIN`).

## Alternative Flow
- **AF1. Не заполнены обязательные поля (тип, дата начала/окончания, лицо, название, страна, город)**: шаг 6 → кнопка «Создать бюллетень» неактивна, под ней строка «чего не хватает»; серверная проверка (`create_event`) на пустые `title`, `kind`, неверную `businessDate` отвечает 400 `VALIDATION_ERROR` с ошибками по полям.
- **AF2. Неизвестный тип / дата окончания раньше начала / время не ЧЧ:ММ / адрес или локация длиннее 255**: шаг 7 → 400 с сообщением по полю («Неизвестный тип мероприятия.», «Дата окончания раньше даты начала.», «Укажите время в формате ЧЧ:ММ.», «Не длиннее 255 символов.»); форма показывает ошибки у полей и общим списком (`FieldErrors`).
- **AF3. Страна/город не найдены или скрыты, город не относится к стране**: шаг 7 → 400 `countryId`/`cityId` («Страна не найдена в справочнике.», «Город не найден в справочнике.», «Город не относится к выбранной стране.»). При правке (`details`) уже сохранённые скрытые страна/город принимаются (`unchanged`).
- **AF4. Лицо не найдено / неактивно**: шаг 7 → 400 `protectedPersonIds` («Охраняемое лицо не найдено в справочнике: <id>»); дубли в списке снимаются молча.
- **AF5. Объект не найден в реестре / сотрудник-старший не найден**: шаг 7 → 400 `objectId` («Объект не найден в реестре.») / `chiefEmployeeId` («Сотрудник не найден.»).
- **AF6. Нет права `event.create`**: шаг 7 → 403 `PERMISSION_DENIED`; окно показывает общий текст «Не удалось создать мероприятие. Проверьте поля и попробуйте снова.» (кнопка создания на клиенте по праву не скрывается).
- **AF7. Добавление объекта посещения к уже имеющемуся объекту**: шаг 9 → 400 `objectId` «Этот объект уже добавлен в мероприятие.»; окно «Добавить объекты» считает результат «Добавлено K из N».
- **AF8. Мероприятие закрыто (`CLOSED`)**: шаг 9 → 422 `INVALID_STAGE_TRANSITION` («Мероприятие закрыто — сведения бюллетеня / старший наряда / объекты посещения не меняются.»); на клиенте пункты меню скрыты при `stage === "CLOSED"`.
- **AF9. Снятие старшего, когда он не назначен**: шаг 9 → 404 «У мероприятия не назначен старший.»
- **AF10. «Открыть рекогносцировку» не на стадии `BULLETIN`**: шаг 10 → 422 «Бюллетень можно завершить только на этапе «Бюллетень».»; текст показывает `StageError`.
- **AF11. Неизвестный или нечисловой id мероприятия**: любой шаг правки → 404 «Мероприятие не найдено.»
- **AF12. PATCH `bulletin` без `briefDescription`/`initialTasks`**: 400 «Обязательное поле.» — но из UI ручка не вызывается (см. Открытые вопросы).

## Изменения в системе
| Объект | Действие | Описание |
|---|---|---|
| `OpsSecurityEvent` | create | код `ОМ-<год>-<N>`, title, kind, business_date/_end, event_time, security_object + object_name + passport_binding, protected_person(+name), location/country/city/address, chief_employee_id/chief_name, stage (`RECON`/`BULLETIN`), readiness_percent (15/0), owner_name, owner_actor_id, recon_checklist из `RECON_CHECKLIST_TEMPLATE`, пустые JSON-поля этапов, approval_status `PENDING` |
| `OpsSecurityEventPerson` (M2M `protected_persons`) | create / update | состав лиц (`set`), атрибуты arrival_at/departure_at/flight_arrival/flight_departure/is_senior/note (`apply_person_details`) |
| `OpsSecurityEventVisitObject` | create | первый объект посещения при выбранном объекте (старший наследуется от ОМ, `position=0`, stage = стадии ОМ); при «Добавить объект» — новый со своей привязкой паспорта, `position = last+1`, stage = стадии ОМ, старший НЕ наследуется |
| `OpsSecurityEvent.recon_sector_posts` | update | при добавлении второго объекта неразмеченные посты закрепляются за единственным прежним (`_pin_unmarked_posts_to_the_only_visit`); после добавления — `recompute_visit_needs` |
| `OpsSecurityEventTransition` | create | `None → RECON/BULLETIN` при создании; `BULLETIN → RECON` при завершении бюллетеня (`kind=FORWARD`) |
| `OpsSecurityEvent` | update | `details`: title, business_date/_end, event_time, location/country/city/address, protected_person(+name), состав лиц; `chief`: chief_employee_id/chief_name; `bulletin`: brief_description, initial_tasks; `bulletin/complete`: stage=`RECON`, readiness 15 (через `advance_visits`, если объекты есть) |
| `OpsSecurityEventVisitObject` | update / delete | PATCH `visit_day`, `note` (≤255); DELETE — снятие объекта (при наличии постов объекта — 422) |
| `OpsSecurityObject` | create | из окна создания можно завести новый объект по названию (`POST /api/ops/objects/`) |
| Аудит (`audit_service`) | create | `SECURITY_EVENT_CREATED` (code, title, businessDate), `SECURITY_EVENT_DETAILS_UPDATED` (old/new: code, title, даты, время, лица, location), `SECURITY_EVENT_CHIEF_SET` (old/new employeeId, employeeName); HTTP-аудит `AuditMiddleware` на каждый успешный write |
| Леджер сил | update | сигнал `post_save OpsSecurityEvent → project_forces_ledger` |
| `OpsBulletinIssue` | — | не затрагивается: выпуск информационного бюллетеня (`apps/ops/bulletin_issues.py`, `/api/ops/bulletin-issues/`) — отдельная сущность (срез дня + PDF), к этапу `BULLETIN` мероприятия не относится |

## Бизнес-требования (BR)
- **BR1.** Код ОМ формируется сервером как `ОМ-<год даты начала>-<N>`, где N — следующий за наибольшим уже выданным номером этого года (не количество строк); поле `code` уникально.
- **BR2.** Обязательны: название (`title`), тип (`kind` ∈ `INTERNAL`/`FOREIGN`), дата начала (`businessDate`, ГГГГ-ММ-ДД). На клиенте дополнительно обязательны дата окончания, минимум одно охраняемое лицо, страна и город (`[БЛН-11]`); на сервере они необязательны.
- **BR3.** Дата окончания не раньше даты начала; время — ЧЧ:ММ или ЧЧ:ММ:СС; адрес/локация ≤255 символов; борт ≤100; примечание лица ≤255.
- **BR4.** Тип мероприятия задаётся при создании и через `details` не меняется; для `FOREIGN` подпись старшего — «Старший ГВО», запись появляется в реестре ГВО (сводка — UC-EVT-008).
- **BR5.** Охраняемых лиц может быть несколько; первое в списке — главное (`protected_person`); дубли снимаются молча, неизвестный id — ошибка поля. Старое одиночное поле `protectedPersonId` принимается, если список не прислан.
- **BR6.** Локация: страна и город из справочника (`is_active`), город обязан принадлежать стране; при указании только города страна берётся от него; строка `location` = «Страна, Город, адрес» (`compose_location`, ≤255). Если структура не прислана, `location` трактуется как адрес.
- **BR7.** Объект при создании необязателен. С объектом ОМ сразу стартует в `RECON` и получает первый объект посещения с унаследованным старшим; без объекта — стадия `BULLETIN`, объекты добавляются позже.
- **BR8.** Версия паспорта привязывается на дату начала ОМ: последняя по номеру среди `effective_from <= business_date`; отсутствие версии — не ошибка (привязка пустая).
- **BR9.** Объекты посещения добавляются на любой незакрытой стадии; один объект — один раз на ОМ (unique `(event, security_object)`); добавленные позже объекты старшего не наследуют.
- **BR10.** Старший ОМ один; `POST chief` с `employeeId` назначает/заменяет, без него — снимает; на закрытом ОМ не меняется.
- **BR11.** Правка сведений (`details`) частичная: отсутствующий ключ — «не трогать», пустая строка — очистить (время, дата окончания, лица, адрес). Закрытое ОМ не правится.
- **BR12.** Завершение бюллетеня допустимо только на стадии `BULLETIN` и переводит ОМ в `RECON` (объектам ставится та же стадия); переход пишется в `OpsSecurityEventTransition`.
- **BR13.** Создатель ОМ (`owner_actor_id` = id учётки) правит сведения, объекты посещения и транспорт своего ОМ без `event.manage`; клиент получает признак `canEditBulletin` от сервера.
- **BR14.** Права на списки для окна создания (`bindable-objects`) — `event.manage` ИЛИ `event.create`.

## Требования к логированию
- Аудит действий: `SECURITY_EVENT_CREATED` (actor, entity_id, new_value: code/title/businessDate) в `create_event`; `SECURITY_EVENT_DETAILS_UPDATED` (old/new) в `update_bulletin_details`; `SECURITY_EVENT_CHIEF_SET` (old/new) в `set_event_chief`.
- HTTP-аудит: `AuditMiddleware` (`apps/audit`) пишет каждый успешный write-запрос к `/api/ops/security-events/…`.
- Журнал переходов: `OpsSecurityEventTransition` (from_stage, to_stage, kind, occurred_at) при создании и завершении бюллетеня.
- `logger` в `apps/ops/security_events.py` объявлен, но на пути создания/правки бюллетеня/объектов/старшего/завершения не вызывается (вызовы только в ветке сил, ~строка 4780) — `Не реализовано в коде`.
- Аудит добавления/снятия объекта посещения, PATCH `bulletin`, завершения бюллетеня — `Не реализовано в коде` (в `add_visit_object` это отмечено намеренно: «у ОМ пишутся заведение и закрытие»); след остаётся только в HTTP-аудите и журнале переходов.

## Требования к правам
| Роль | Доступ | Как обеспечивается |
|---|---|---|
| ADMIN | полный | `*` |
| EVENT_OFFICER | полный (создание, бюллетень, объекты, старший, правка, завершение) | `event.create`, `event.bulletin`, `event.manage` в `permission_map` (`create`, `bulletin`, `bulletin_complete`, `visit_object_add/detail`, `details`, `event_chief`, `bindable_objects`) |
| HEAD_OPS_UNIT | создание, PATCH `bulletin`, завершение бюллетеня, списки объектов; правка своего ОМ как создатель | `event.create`, `event.bulletin`; `details`/`visit_object_add`/`visit_object_detail` — только через `_creator_override` (`owner_actor_id`); `event_chief` — нет (`event.manage` отсутствует) |
| EMPLOYEE_OPS_D2 | как HEAD_OPS_UNIT | `event.create`, `event.bulletin`, `event.view`; `event_chief` — нет |
| GVO_LEAD, старший ГВО (chief), создатель — на ОМ `kind=FOREIGN` | объекты посещения и транспорт | `_gvo_editor_override` (`gvo.manage` / создатель / `chief_employee_id`) для `_GVO_EDITOR_ACTIONS` |
| OPS_STAFF, PATROL_LEAD, EVENT_APPROVER, DIRECTORATE_HEAD, DEPARTMENT_EXPENSE_OFFICER, FORCES_GATHERING_OFFICER, DUTY_*, OBJECT_KEEPER, RATING_EVALUATOR, ANALYST, AUDITOR | чтение реестра и карточки | `event.view` (OPS_READ); действия UC → 403 `PERMISSION_DENIED` |
| HEAD_DIRECTORATE_LINE, HEAD_DEPARTMENT_LINE, EMPLOYEE | нет | нет `event.view`; клиентский гейт `MODULE_PERMISSION["/security-ops/events"] = "event.view"` |
| Создание нового объекта из окна (`POST /api/ops/objects/`) | только держатель `object.manage` | `SecurityObjectViewSet.permission_map["create"] = object.manage` — у EVENT_OFFICER/HEAD_OPS_UNIT/EMPLOYEE_OPS_D2 права нет |

## Требования к UX/UI
- **Реестр ОМ** (`/security-ops/events`, страница): заголовок «Реестр ОМ», кнопка «+ Создать бюллетень» (по праву не скрывается), переключатель «Календарь / К списку», строка ОМ с меню действий: «Добавить объект» и «Назначить/Заменить старшего наряда» (по `event.manage`, не `CLOSED`), «Редактировать бюллетень» (по серверному `canEditBulletin`, не `CLOSED`), «Удалить мероприятие» (`event.delete`). Метка «В разработке» из `in-development.ts`.
- **Модальное окно «Создать бюллетень»** (`CreateSecurityEventDialog`, zod `formSchema`): переключатель типа (кнопки «Внутреннее» / «С участием иностранцев», подсказка под ним; ошибка «Обязательное поле.»); дата начала и дата окончания (`ГГГГ-ММ-ДД`, сводка периода «дни недели · N дней», ошибка «Дата окончания раньше даты начала.»); время (ЧЧ:ММ) с пометкой «без пометки / прилёт / вылет» и полем борта (≤100, placeholder «KC 871»); лица — `ProtectedPersonsPicker` (поиск, чипы, минимум одно: «Укажите хотя бы одно охраняемое лицо.»), название («Обязательное поле.»); `LocationFields` — страна/город (селекты из справочника, по умолчанию KZ/Астана, состояние загрузки, ошибка «Повторить»), адрес (≤255); `ObjectPicker` — список объектов с поиском, пометка «паспорт не опубликован», создание нового объекта по названию; `ChiefCombobox` — поиск сотрудника по фамилии (debounce 250 мс, `usePersonnelPage`), подпись «Старший наряда» / «Старший ГВО» по типу; превью «Так строка ляжет в бюллетень» (Дата, Время, ОЛ, Мероприятие, Локация, Старший); кнопки «Отмена» и «Создать бюллетень» (disabled, пока не заполнены тип, даты, лицо, название, страна, город; подсказка «чего не хватает» через `aria-describedby`; «Создание…» при отправке); серверные ошибки — у полей и общим списком `FieldErrors`; общий текст «Не удалось создать мероприятие…». После успеха — переход в карточку ОМ.
- **Модальное окно «Редактировать бюллетень»** (`EditBulletinDialog` → PATCH `details`): название, дата начала, дата окончания, время, охраняемые лица, блок `PersonDetailsFields` «Лица на мероприятии — время и борт» (datetime-local прибытие/убытие, борт с placeholder «KC 871», чекбокс «Старший» — для каждого лица), страна/город, адрес/место; тип и объекты не правятся.
- **Окно «Добавить объекты посещения»** (`AddVisitObjectsDialog`): поиск «Поиск по названию или коду объекта», множественный выбор, кнопка «Добавить (N)», итог «Добавлено K из N».
- **Окно старшего** (`EventChiefDialog` → POST `chief`): выбор сотрудника, назначить/заменить/снять.
- **Карточка ОМ** (`/security-ops/events/[id]`): панель «Сведения об ОМ» (`BulletinPanel`, на всех незакрытых стадиях, только справка: номер, наименование, тип, объект, место/адрес, локация, страна/город, даты, время, продолжительность, ответственный, старший наряда/ГВО («не назначен»), статус, лица и их количество; для `FOREIGN` — старший группы ГВО, численность ГВО); шаг стадии `BULLETIN` — `AwaitingReconStage` «Рекогносцировка ещё не начата» с текстом про отсутствие объекта и ссылкой в реестр, кнопка «Открыть рекогносцировку» («Открытие…»), ошибка через `StageError`; бейдж «В разработке» этапа (`inDevelopmentOfStage`).
- Полей «Краткое описание» / «Первичные задачи» (`briefDescription`, `initialTasks`) в интерфейсе нет.

## Открытые вопросы
- Метка «В разработке» `/security-ops/events` (`in-development.ts`): «Форма создания ОМ по спецификации: ОЛ-чипы, страна/город, превью (№419, №439)»; там же: «Бейджи «Возвращено», «Срочно», «потребность/назначено» в реестре (№423)»; «Визит иностранного ОЛ отдельной страницей со статусом (№435, №436, №441)».
- Метка этапа `BULLETIN`: «Рекогносцировка без старшего закрыта, импорт из паспорта объекта посещения (№424)»; «Переключатель «Норма / Замечание / Не проверено», подвал с потребностью (№443)».
- `@transaction.atomic` в `security_events.py` (~строка 270) стоит над вспомогательной `_creator_account_id`, а не над `create_event`: создание ОМ (строка ОМ + M2M лиц + объект посещения + переход + аудит) идёт без транзакции сервиса; `ATOMIC_REQUESTS` в настройках не найден. При падении после `objects.create` возможна строка ОМ без лиц/объекта/перехода.
- `PATCH /bulletin/` (`brief_description`, `initial_tasks`) и хук `useUpdateBulletin` существуют, но ни один экран их не вызывает; `BulletinPanel` с 07.09.2026 (№943) — только справка «текста бюллетеня в проекте нет». Ручка и право `event.bulletin` для неё — мёртвый контракт либо задел.
- Право `event.bulletin` открывает `bulletin_complete`, но кнопка «Открыть рекогносцировку» (`AwaitingReconStage`) на клиенте по праву не гейтится — держатель только `event.view` видит кнопку и получает 403 в `StageError`.
- Клиент: «Добавить объект» и «Назначить старшего» в меню строки видны только по `event.manage` (`canEditObjects`), тогда как сервер пускает создателя (`_creator_override` для `visit_object_add`/`visit_object_detail`) и редактора ГВО — создатель без `event.manage` (HEAD_OPS_UNIT, EMPLOYEE_OPS_D2) не видит кнопки добавления объектов, хотя API ему разрешён; `event_chief` создателю не открыт вовсе (только `event.manage`), хотя в окне создания старшего он задать может.
- Кнопка «+ Создать бюллетень» показывается всем с `event.view`; без `event.create` отправка формы даёт 403 и общее сообщение «Проверьте поля» — вводящее в заблуждение.
- Создание нового объекта из `ObjectPicker` требует `object.manage`, которого нет ни у одной роли с `event.create` кроме ADMIN — на клиенте это не отражено.
- Обязательность на клиенте шире серверной (дата окончания, лицо, страна, город обязательны только в форме): через API можно завести ОМ без лиц и локации.
- Из формы создания на сервер уходят атрибуты только главного лица и только одного события (прилёт ИЛИ вылет по `timeMark`, `personDetailsOf`); полные атрибуты всех лиц (`PersonDetailsFields`) доступны только в окне правки.
- Переход `BULLETIN → RECON` через `complete_bulletin` не проверяет наличие старшего и объекта; метка №424 («Рекогносцировка без старшего закрыта») в коде этого шага не реализована.
