# UC-EVT-008. Оформить визит иностранного охраняемого лица

| Поле | Значение |
|---|---|
| Модуль | Охранные мероприятия |
| Актор | GVO_LEAD, HEAD_OPS_UNIT, OPS_STAFF_COMMAND (штаб, `gvo.manage`); старший ГВО / создатель ОМ по данным (правка без права); ADMIN |
| Статус | Partial |
| Основание | `apps/operations/models_gvo.py` (`OpsForeignVisit`, `OpsForeignVisit.Status`, `OpsGvoSummaryPatch`), `apps/ops/gvo.py` (`visit_for_event`, `apply_patch`, `reset_patch`, `approve_visit`, `missing_required`, `REQUIRED_VISIT_FIELDS`, `ALLOWED_PATCH_KEYS`, `SECTION_PATCH_KEYS`), `apps/ops/documents_summary.py` (`derive_summary`, `summary_row`, `assembled_summaries`, `visit_view`), `apps/ops/api/views.py` `OpsGvoSummariesViewSet` (`/api/ops/gvo-summaries/`), `SecurityEventViewSet._GVO_EDITOR_ACTIONS`, `app/security-ops/visits/[id]/page.tsx`, `widgets/gvo-summary/ui/GvoSummaryPanel.tsx`, `widgets/gvo-summary/ui/GvoEditForm.tsx`, `widgets/gvo-visits-registry`, `hooks/use-gvo-summaries.ts`, `features/security-event-stages/ui/BulletinPanel.tsx` | 
| Дата актуализации | 2026-09-08 |

## Цель
Штаб / старший ГВО заполняет сводные данные визита иностранного охраняемого лица (страна, лица, прибытие/убытие, встречающие, размещение, группы, транспорт), доводит визит до состояния «Заполнен» и утверждает его.

## Предусловия
- Мероприятие `OpsSecurityEvent` создано с `kind = FOREIGN` (UC создания ОМ); у `kind = INTERNAL` визита не существует (`visit_for_event` возвращает `None`, `_require_foreign` → 422 `VISIT_FOREIGN_ONLY`).
- Актор аутентифицирован и имеет `event.view` (чтение сводки и страницы `/security-ops/visits/{id}`, `MODULE_PERMISSION["/security-ops/visits"] = event.view`).
- Для правки: `gvo.manage` ИЛИ актор — старший ОМ (`chief_employee_id` = своя кадровая запись) ИЛИ создатель ОМ (`owner_actor_id`).
- Для утверждения: только код права `gvo.manage` (или `*`); роль в данных утверждение не открывает (`_CHIEF_ACTIONS` = `{partial_update, reset}`).

## Main Flow
1. Актор открывает реестр ОМ `/security-ops/events`, вкладку «Визиты иностранных ОЛ» (список всех ОМ с `kind !== INTERNAL`, статус строки «Черновик · заполнено K из N» / «Утверждено») либо ссылку «Карточка визита →» в панели бюллетеня карточки ОМ.
2. Система открывает страницу визита `/security-ops/visits/{eventId}`: шапка с типом ОМ, ОЛ, датой, чипом статуса (Черновик / Заполнен / Утверждён), счётчиком «заполнено K из N обязательных», кнопками «Редактировать бюллетень», «PDF», «Утвердить»; ниже — панель сводных данных ГВО (`GET /api/ops/gvo-summaries/{code}/`: база из бюллетеня + правки визита, `canEdit`, `missingRequired`).
3. Актор нажимает «Редактировать» (кнопка видна по слову сервера `canEdit`) — вся сводка переходит в единый режим правки: страна, охраняемые лица (из справочника `OpsProtectedPerson`), прибытие/убытие, встречающие/провожающие (из кадров), размещение, ответственный и старший ГВО (из кадров), группы, транспорт; у обязательных полей — галочка «уточняется».
4. Актор нажимает «Сохранить» — система одним `PATCH /api/ops/gvo-summaries/{code}/` (`{section: null, values, unspecified}`) пишет правку в `OpsGvoSummaryPatch.patch` и в `OpsForeignVisit.data`, увеличивает `version`, переводит `DRAFT → READY`; выбранный старший ГВО с `employeeId` переписывает `chief_employee_id/chief_name` мероприятия.
5. Система пересчитывает `missingRequired` по `REQUIRED_VISIT_FIELDS` (Страна, Охраняемые лица, Дата прибытия, Дата убытия, Ответственный за ГВО, Старший ГВО); поле, помеченное «уточняется», обязательным не считается.
6. При необходимости актор добавляет объекты посещения («＋ Добавить объект», «Изменить объекты посещения») и машины из реестра ГОН («+ Машина из реестра») — те же ручки `SecurityEventViewSet` (`visit_object_add`, `visit_object_detail`, `vehicle_allocate/release`), открытые редактору сводки через `_gvo_editor_override`.
7. Актор (штаб с `gvo.manage`) нажимает «Утвердить» — система `POST /api/ops/gvo-summaries/{code}/approve/` проверяет обязательные поля, ставит `status = APPROVED`, `approved_at`, `approved_by`, пишет аудит `GVO_VISIT_APPROVED`.
8. Актор при необходимости выгружает документ сводных данных кнопкой «PDF» (`useRenderEventDocument`, kind `summary`).

## Alternative Flow
- **AF1. ОМ внутреннее (`kind = INTERNAL`)**: шаг 2 → страница показывает «…: визита у него нет» со ссылкой «К карточке мероприятия →»; PATCH/reset/approve на сервере — 422 `VISIT_FOREIGN_ONLY`. ОМ с `kind = null` (легаси) страницей НЕ отбивается (считается «не внутренним»), но сервер на правку ответит 422.
- **AF2. Нет права на правку**: шаг 3 → кнопка «Редактировать» не рисуется (`canEdit = false`); прямой PATCH/reset без `gvo.manage` и без роли в данных — 403 (`RequirePermissionMixin`).
- **AF3. Неизвестный раздел / ключ патча**: шаг 4 → `ValidationError` → 400 `VALIDATION_ERROR` «Проверьте состав патча» (`section` не из `SECTION_PATCH_KEYS`/`person:*`/`group:*`; ключ не из `ALLOWED_PATCH_KEYS`; `values` не объект; `unspecified` не список строк).
- **AF4. Мероприятие с таким кодом не найдено**: шаги 2/4/7 → 404 `ENTITY_NOT_FOUND` / `NotFound`.
- **AF5. Не заполнены обязательные поля**: шаг 7 → кнопка «Утвердить» погашена с видимой причиной «Заполните обязательные поля: …» (`RightGate`); сервер — 422 `VISIT_REQUIRED_MISSING` с `detail.missing`.
- **AF6. Визит уже утверждён**: шаг 7 → кнопка погашена («Визит уже утверждён»); сервер — 422 `VISIT_ALREADY_APPROVED`.
- **AF7. Нет права утверждать**: шаг 7 → кнопка погашена («Утверждает штаб (право на сводку ГВО)»); сервер — 403.
- **AF8. Правка / сброс утверждённого визита**: шаг 4 (или «Вернуть исходные») на `status = APPROVED` → утверждение снимается (`READY`, `approved_at = null`, `approved_by = ""`), аудит `GVO_VISIT_APPROVAL_REVOKED` с номером новой версии.
- **AF9. «Вернуть исходные»**: `POST /api/ops/gvo-summaries/{code}/reset/` `{section: null}` — снимаются все ключи разделов из `visit.data` и патча, флаги «уточняется» раздела снимаются вместе с данными, пустой патч удаляется; статус `READY` при этом НЕ возвращается в `DRAFT`.
- **AF10. Сводка не загрузилась / ещё грузится**: шаг 2 → панель «Не удалось загрузить сводные данные» / «Загрузка сводных данных…»; кнопка «Утвердить» погашена с причиной «Сводка не загрузилась — обновите страницу» / «Сводка ещё загружается».
- **AF11. Ошибка утверждения**: шаг 7 → под шапкой `role="alert"` «Не утверждено: {message}».

## Изменения в системе
| Объект | Действие | Описание |
|---|---|---|
| `OpsForeignVisit` | create | Заводится лениво при первом PATCH/approve (`visit_for_event(create=True)`, `get_or_create`, `protected_person_id` из ОМ); при создании ОМ с `kind=FOREIGN` не создаётся (в `security_events.py` и `signals.py` обращений к модели нет) |
| `OpsForeignVisit` | update | `data` (merge по ключам верхнего уровня), `unspecified`, `version += 1`, `status` DRAFT→READY / APPROVED→READY, `approved_at`, `approved_by` |
| `OpsGvoSummaryPatch` | create / update / delete | Дублирующая запись правок (`patch`, `updated_by`); удаляется при пустом остатке после reset |
| `OpsSecurityEvent` | update | `chief_employee_id`, `chief_name` — при выборе старшего ГВО с `employeeId` (`_sync_senior_to_event`) |
| `OpsSecurityEventVisitObject`, `OpsSecurityEventVehicle` (`event.vehicles`) | create / update / delete | Через ручки `SecurityEventViewSet`, открытые редактору сводки (`_GVO_EDITOR_ACTIONS`) |
| Журнал аудита (`audit_service.record`) | create | `GVO_SUMMARY_PATCHED`, `GVO_SUMMARY_RESET`, `GVO_VISIT_APPROVED`, `GVO_VISIT_APPROVAL_REVOKED` |
| Сводка (`GET /gvo-summaries/{code}/`, `GET /gvo-summaries/assembled/`, `GET /gvo-summaries/`) | read | Собранная сводка (база `derive_summary` + `visit.data` либо патч), `visit` (status, version, unspecified, approvedAt), `filled`, `missingRequired`, `requiredTotal/Filled`, `canEdit` |

## Бизнес-требования (BR)
- **BR1.** Визит существует только у ОМ с `kind = FOREIGN`; правка, сброс и утверждение у иного ОМ отклоняются (422 `VISIT_FOREIGN_ONLY`).
- **BR2.** Статусы визита: `DRAFT` → `READY` (первая сохранённая правка) → `APPROVED` (утверждение); любая правка или сброс утверждённого визита возвращает `READY` и снимает отметку утверждения. Обратного перехода `READY → DRAFT` нет.
- **BR3.** Утверждение допустимо только при заполненных обязательных полях: Страна, Охраняемые лица, Дата прибытия, Дата убытия, Ответственный за ГВО, Старший ГВО; поле, помеченное «уточняется» (`unspecified`), считается заполненным. Даты прибытия/убытия считаются заполненными только если введены человеком (умолчание из дня ОМ не засчитывается, `DERIVED_DEFAULT_PATHS`).
- **BR4.** Повторное утверждение утверждённого визита отклоняется (422 `VISIT_ALREADY_APPROVED`); утверждённая версия одна.
- **BR5.** Патч принимает только ключи `ALLOWED_PATCH_KEYS` (country, persons, arrival, departure, meet, farewell, stay, delegation, sbChief, weapons, wishes, obVariant, radio, responsible, senior, groups, transport, meetEmployeeIds, farewellEmployeeIds, delegationEmployeeIds); присланный ключ замещает секцию целиком, отсутствующий не трогается; `allocatedTransport` и `visits` патчем не правятся (выводятся из выделений и объектов посещения).
- **BR6.** Раздел (`section`) необязателен; если прислан — должен быть одним из `SECTION_PATCH_KEYS` / `person:*` / `group:*`. Каждый разрешённый ключ принадлежит хотя бы одному разделу (иначе «Вернуть исходные» его не снимет).
- **BR7.** База сводки выводится из бюллетеня: страна — из карточки главного ОЛ, лица — из справочника (главное первым), даты — день ОМ, ответственный — `owner_name`, старший ГВО — `chief_employee_id/chief_name` ОМ, группа «ГВО» пустая.
- **BR8.** Старший ГВО, выбранный в сводке с `employeeId`, становится старшим мероприятия (источник один); набранный текстом — мероприятие не меняет и права не даёт.
- **BR9.** Правит сводку держатель `gvo.manage`, старший ЭТОГО ОМ или его создатель; утверждает только держатель `gvo.manage` (штаб). Старший объекта посещения сводку не правит.
- **BR10.** Чтение сводки — по `event.view`; экран получает признак `canEdit` от сервера и не держит собственной копии правила.
- **BR11.** Объекты посещения и машины из реестра ГОН правятся редактором сводки только у ОМ `kind = FOREIGN`; закрытое ОМ отбивает сервис, кнопка «＋ Добавить объект» скрыта при `stage = CLOSED`.

## Требования к логированию
- Аудит (`audit_service.record`, `entity_type = ENTITY_SECURITY_EVENT`): `GVO_SUMMARY_PATCHED` (actor, omCode, keys), `GVO_SUMMARY_RESET` (actor, omCode, section), `GVO_VISIT_APPROVED` (actor, omCode, version), `GVO_VISIT_APPROVAL_REVOKED` (actor, omCode, новая version). Фронт после утверждения сбрасывает кеш `ops-audit-logs`.
- HTTP-аудит `AuditMiddleware` (`apps/audit`) — каждый успешный PATCH/POST к `/api/ops/gvo-summaries/…`.
- `logging.getLogger` в `apps/ops/gvo.py` и `apps/ops/documents_summary.py` отсутствует — прикладных логов по этому пути нет: `Не реализовано в коде`.
- Отказы 403/422 (`VISIT_REQUIRED_MISSING`, `VISIT_ALREADY_APPROVED`, `VISIT_FOREIGN_ONLY`) в аудит не пишутся: `Не реализовано в коде`.
- Ленивое создание `OpsForeignVisit` отдельной записью аудита не фиксируется: `Не реализовано в коде`.

## Требования к правам
| Роль | Доступ | Как обеспечивается |
|---|---|---|
| ADMIN | полный | `*` |
| GVO_LEAD | полный (правка, сброс, утверждение, объекты/транспорт визита) | `gvo.manage` (`permission_map` `partial_update`/`reset`/`approve`; `_gvo_editor_override` в `SecurityEventViewSet`) + `event.view` (OPS_READ) |
| HEAD_OPS_UNIT | полный | `gvo.manage` (в профиле, миграция 0105) + `event.view` |
| OPS_STAFF_COMMAND (роль-добавка) | полный | `gvo.manage` |
| Старший ОМ (`chief_employee_id` = своя кадровая запись), любая роль с `event.view` | правка и сброс своего визита; утверждение — нет | `OpsGvoSummariesViewSet.permission_override` (`_CHIEF_ACTIONS`), `_is_chief_or_creator`; `_gvo_editor_override` для объектов/транспорта |
| Создатель ОМ (`owner_actor_id` = actor_id), любая роль с `event.view` | правка и сброс своего визита; утверждение — нет | те же `_is_chief_or_creator` / `_is_creator` |
| EVENT_OFFICER, OPS_STAFF, PATROL_LEAD, EVENT_APPROVER, EMPLOYEE_OPS_D2, FORCES_GATHERING_OFFICER, DIRECTORATE_HEAD, DEPARTMENT_EXPENSE_OFFICER, DUTY_OFFICER, DUTY_PLANNER, DUTY_PLAN_APPROVER, OBJECT_KEEPER, RATING_EVALUATOR, ANALYST, AUDITOR | чтение (страница визита, сводка, реестр, PDF) | `event.view` (`list`/`retrieve`/`assembled`, `MODULE_PERMISSION["/security-ops/visits"]`) |
| HEAD_DIRECTORATE_LINE, HEAD_DEPARTMENT_LINE, EMPLOYEE | нет | нет `event.view` → `OpsAccessDenied` на фронте, 403 на API |

## Требования к UX/UI
- Вкладка «Визиты иностранных ОЛ» на странице `/security-ops/events` (`GvoVisitsRegistry`): список ОМ с `kind !== INTERNAL`, переключатель «все / мои» (мои — по совпадению `ownerName` с именем пользователя), поиск; строка — код, название, ОЛ, старший, счёт состава, чип статуса «Черновик · заполнено K из N» / «Утверждено», ссылка на `/security-ops/visits/{id}`; пусто — «Мероприятий с иностранным охраняемым лицом нет».
- Страница `/security-ops/visits/[id]` (`VisitPage`, клиентская, под `<Suspense>`): состояния «Загрузка визита…», `LoadFailure` с повтором, `OpsAccessDenied` без `event.view`; для `kind = INTERNAL` — карточка «визита у него нет» со ссылкой на ОМ. Шапка: чип статуса (Черновик / Заполнен / Утверждён), «заполнено K из N обязательных», «утверждён {дата-время}», кнопки «Редактировать бюллетень» (по `canEditBulletin`, не CLOSED), «PDF» («Собираем…»), «Утвердить» («Утверждаем…») — при блокировке погашена с видимой причиной (`RightGate`). Строка «Обязательные поля без данных: … Пустое поле можно пометить «уточняется»…»; ошибка утверждения — `role="alert"`.
- Панель `GvoSummaryPanel`: «Загрузка сводных данных…» / «Не удалось загрузить сводные данные»; бейдж «Сводка заполнена» / «Черновик сводки»; кнопка «Редактировать» при `canEdit`; секции Страна, Охраняемые лица, Прибытие, Убытие, Организация (размещение, старший СБ, оружие, вариант ОБ, радио, пожелания, делегация), Ответственный / Старший ГВО, Группы, Транспорт («+ Машина из реестра», пусто — «Транспорт не выделен»), Объекты посещения («＋ Добавить объект», «Изменить объекты посещения», пусто — «Объекты посещения не добавлены в мероприятие»).
- Форма правки `GvoEditForm` (единый режим): все поля инпутами; галочки «уточняется» у обязательных полей (страна, персоны — на блок, даты, ответственный, старший); выбор лиц — `ProtectedPersonPickDialog` (справочник, загрузка фото с тостами «Снимок загружен» / «Снимок не загружен»), сотрудников — `GvoMemberPickerDialog`; кнопки «Сохранить» («Сохранение…»), «Отмена», «Вернуть исходные» («Возврат…»). Zod-схемы нет; клиентской валидации обязательности нет — обязательность проверяет сервер при утверждении, ошибки состава патча приходят 400 с сервера.
- Диалог объектов посещения `GvoVisitsDialog`, диалог `EditBulletinDialog` — из шапки.

## Открытые вопросы
- Метка «В разработке» `/security-ops/events` (`shared/config/in-development.ts`): «Визит иностранного ОЛ отдельной страницей со статусом (№435, №436, №441)» — при том, что страница, статус и утверждение в коде есть; метка не снята.
- `OpsForeignVisit` не создаётся при создании ОМ `kind = FOREIGN` — только лениво при первой правке/утверждении; до этого `visit = null` в сводке, реестр показывает «Черновик» по `filled`. Бэкфилл для существующих строк в коде не найден (комментарий модели упоминает Ш-20 «пока страницу не переведут»).
- Двойная запись правок: `OpsGvoSummaryPatch` дублирует `OpsForeignVisit.data` («патч ОСТАЁТСЯ и читается, пока страницу не переведут»); чтение предпочитает визит — снятие патча отдельным шагом не сделано.
- Статус визита после «Вернуть исходные» остаётся `READY` даже при пустых данных (реестр это скрывает подписью «Черновик», страница визита показывает чип «Заполнен»).
- Обязательные поля не совпадают с `REQUIRED_VISIT_FIELDS` по составу с флагами: путь `persons` помечается «уточняется» на весь блок; проверка «даты введены человеком» опирается на наличие ключа в `visit.data`, а не на отличие от базы.
- Утверждение доступно только по коду `gvo.manage`; старший ГВО и создатель ОМ (роль в данных) утверждать не могут — намеренно (`[ГВО-09]`), но подпись на кнопке говорит «Утверждает штаб», тогда как `gvo.manage` есть и у GVO_LEAD.
- ОМ с `kind = null` (легаси): страница визита и ссылка «Карточка визита →» его показывают, а сервер любую правку отбивает 422 `VISIT_FOREIGN_ONLY`.
- Фильтр «мои» в реестре визитов — по совпадению `ownerName` с именем пользователя (текст, не `owner_actor_id`).
- Экспорт документа только «PDF» с кнопки страницы; `render_summary_pdf(fmt)` поддерживает формат параметром, но на странице визита иного формата не предложено.
