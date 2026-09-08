# UC-OBJ-003. Вести справочники раздела ОМ, законы и транспорт ГОН

| Поле | Значение |
|---|---|
| Модуль | Объекты и справочники ОМ |
| Актор | REFERENCE_ADMIN (справочники: чтение и правка), держатели `catalog.view` (законы), держатели `event.view` (транспорт ГОН), ADMIN (правка законов и транспорта в Django Admin) |
| Статус | Done |
| Основание | `apps/ops/dictionaries.py` (DEFINITIONS, create_entry, update_entry, set_entry_active, delete_entry, usage_of), `apps/operations/models_settings.py::OpsDictionaryEntry`, `OpsDictionariesViewSet` (`/api/ops/dictionaries/`, `/{CODE}/entries/` GET+POST, `/entries/{id}/set-active/`, `/entries/{id}/` PATCH+DELETE), `apps/operations/models_legal.py::OpsLegalDocument`, `OpsLegalDocumentsViewSet` (`/api/ops/legal-documents/`), `apps/operations/models_vehicle.py` (OpsVehicle, OpsEventVehicle), `OpsVehiclesViewSet` (`/api/ops/vehicles/`, `/vehicles/armor-classes/`), `apps/ops/vehicles.py`, FRONT `app/security-ops/dictionaries/page.tsx`, `dictionaries/[code]/page.tsx`, `app/security-ops/laws/page.tsx`, `app/security-ops/vehicles/page.tsx`, `entities/dictionary`, `entities/legal-document`, `entities/vehicle` |
| Дата актуализации | 2026-09-08 |

## Цель
Администратор справочников ведёт значения справочников раздела ОМ, а сотрудники читают нормативную базу ОМ и реестр транспорта ГОН.

## Предусловия
- Пользователь аутентифицирован; для справочников — `dictionary.view` (чтение) / `dictionary.manage` (правка); для законов — `catalog.view`; для транспорта — `event.view`.
- Законы и транспорт заведены через Django Admin (`operations/admin.py`); фронт их только читает.

## Main Flow
1. Актор открывает «Справочники» (`/security-ops/dictionaries`).
2. Система отдаёт перечень справочников раздела с числом значений и активных (`GET /api/ops/dictionaries/`): JOURNAL_ENTRY_TYPES, RETURN_REASONS, POST_REQUIREMENTS, POST_REQUIREMENT_GROUPS, PLACEMENT_ROLES, PLACEMENT_SECTIONS, SEASONAL_CORRECTIONS, EVENT_PARTICIPATION_KINDS, EVENT_GROUP_ROLES, плюс внешний STATUS_TYPES; отдельным блоком — «Кадровые справочники».
3. Актор открывает карточку справочника (`/security-ops/dictionaries/{CODE}`); система отдаёт его значения с посчитанными сервером связями (`GET /dictionaries/{CODE}/entries/`).
4. Актор добавляет значение: код, название, при необходимости группа (для POST_REQUIREMENTS и EVENT_GROUP_ROLES).
5. Система создаёт активное значение (`POST /dictionaries/{CODE}/entries/`, 201), пишет `DICTIONARY_ENTRY_CREATED`.
6. Актор правит название/описание/группу (`PATCH /dictionaries/entries/{id}/`) — система пишет `DICTIONARY_ENTRY_UPDATED`; деактивирует/активирует значение (`POST /dictionaries/entries/{id}/set-active/`) — `DICTIONARY_ENTRY_SET_ACTIVE`.
7. Актор удаляет неиспользуемое значение (`DELETE /dictionaries/entries/{id}/`, 204) — система проверяет связи и пишет `DICTIONARY_ENTRY_DELETED`.
8. Сотрудник открывает «Законы об ОМ» (`/security-ops/laws`), ищет по названию, номеру или содержанию; система отдаёт активные документы (`GET /api/ops/legal-documents/`) с видом, кодом, названием, редакцией, статусом, числом страниц и ссылкой на файл (или её отсутствием).
9. Сотрудник открывает «Транспорт ГОН» (`/security-ops/vehicles`), ищет по марке или госномеру, отбирает по классу брони (`GET /vehicles/armor-classes/`) и включает показ выведенных машин (`includeRetired=1`); система отдаёт строки реестра (`GET /api/ops/vehicles/?armorClass&deployment&search&includeRetired`).

## Alternative Flow
- **AF1. Нет права**: шаги 1–3 без `dictionary.view`, 8 без `catalog.view`, 9 без `event.view` → `OpsAccessDenied`; сервер 403. Шаги 4–7 без `dictionary.manage` → сервер 403 (форма на экране по праву не скрывается).
- **AF2. Неизвестный справочник**: шаг 3/4 → 404 `ENTITY_NOT_FOUND` по `code`.
- **AF3. Ошибки формы значения**: шаг 4 → 400 `VALIDATION_ERROR`: `code` «Обязательное поле.» / «Код уже используется в этом справочнике.»; `label` «Обязательное поле.»; `groupCode` «Группа не найдена или неактивна.» (проверяется только у справочников с родителем группы). Шаг 6 (PATCH) — `label` обязателен, `groupCode` та же проверка; код значения правкой не принимается.
- **AF4. Значение не найдено**: шаги 6–7 → 404 `ENTITY_NOT_FOUND` по `id`.
- **AF5. Удаление значения со связями**: шаг 7 → 409 `DICTIONARY_ENTRY_IN_USE` «Значение используется (N): {источник — примеры}» с `detail.usage`; экран показывает зависимость.
- **AF6. Удаление значения справочника, связи которого не отслеживаются**: шаг 7 → 422 `DICTIONARY_USAGE_UNKNOWN` с причиной («Связи не отслеживаются — удаление запрещено, используйте деактивацию»); удаление доступно только для JOURNAL_ENTRY_TYPES и POST_REQUIREMENT_GROUPS (`usage_of` → `TRACKED`).
- **AF7. Ошибка загрузки списков**: шаги 2, 3, 8, 9 → экран показывает состояние ошибки (`query.isError`).

## Изменения в системе
| Объект | Действие | Описание |
|---|---|---|
| `ops_dictionary_entries` (OpsDictionaryEntry) | create | dictionary_code, code (upper), label, description, is_active=true, group_code (только при родителе группы), updated_by |
| `ops_dictionary_entries` | update | label, description, group_code, updated_by, updated_at (PATCH); is_active, updated_by (set-active) |
| `ops_dictionary_entries` | delete | Физическое удаление после проверки связей (только TRACKED-справочники без связей) |
| `OpsAuditLog` (audit_service) | create | `DICTIONARY_ENTRY_CREATED`, `DICTIONARY_ENTRY_UPDATED` (old/new label, groupCode), `DICTIONARY_ENTRY_SET_ACTIVE` (old/new isActive), `DICTIONARY_ENTRY_DELETED` |
| HTTP-аудит `apps/audit` | create | AuditMiddleware на POST/PATCH/DELETE `/api/ops/dictionaries/…` |
| `OpsLegalDocument`, `OpsVehicle`, `OpsEventVehicle` | read | Только чтение через API; правка — Django Admin |
| Справочники, законы, транспорт | read | `GET /dictionaries/`, `/dictionaries/{CODE}/entries/`, `/legal-documents/`, `/vehicles/`, `/vehicles/armor-classes/` |

## Бизнес-требования (BR)
- **BR1.** Код значения уникален внутри справочника (`uniq_ops_dictionary_entry_code`), непустой, приводится к верхнему регистру; название обязательно (≤ 255).
- **BR2.** Справочник — только из закрытого перечня `DEFINITIONS` (check-constraint `chk_ops_dictionary_code`); новые справочники с экрана не заводятся.
- **BR3.** Группа значения принимается только у справочников с родителем группы (`GROUP_PARENT`: POST_REQUIREMENTS → POST_REQUIREMENT_GROUPS, EVENT_GROUP_ROLES → EVENT_PARTICIPATION_KINDS) и должна ссылаться на активное значение родителя.
- **BR4.** Код значения после создания не меняется — на него ссылаются по коду.
- **BR5.** Удаление разрешено только когда связи значения отслеживаются (`TRACKED`) и их ноль; при связях — 409 с перечнем носителей; у неотслеживаемых справочников — только деактивация (422).
- **BR6.** Связи считаются сервером поимённо: для JOURNAL_ENTRY_TYPES — по записям журналов ОМ (`journal_entries[].type`), для POST_REQUIREMENT_GROUPS — по дочерним требованиям с `group_code`.
- **BR7.** Нормативный документ: вид `LAW/ORDER/REGULATION/INSTRUCTION`, статус `IN_FORCE/UNDER_REVIEW`, уникальный код, число страниц обязательно; файлы система не хранит (`file_url` может быть null); отдаются только активные.
- **BR8.** Транспорт ГОН: у активных машин госномер уникален (`uniq_ops_vehicle_active_plate`); выведенные (`is_active=false`) показываются только по `includeRetired` в значениях `1/true/yes`; классы брони для отбора — только имеющиеся в парке.
- **BR9.** Правка законов и транспорта выполняется исключительно в Django Admin; API этих реестров — только чтение.

## Требования к логированию
- Справочники: `audit_service.record` на создание, правку, смену активности и удаление значения (актор — `resolve_actor_id(request)`, entity `dictionary_entry`, old/new значения).
- HTTP-аудит успешных write-запросов — AuditMiddleware `apps/audit`.
- `logging.getLogger` в `dictionaries.py`, `gvo.py`, `vehicles.py`, `views.py` не используется.
- Отказы 409/422 при удалении в журнал раздела не пишутся — `Не реализовано в коде`.
- Правки законов и транспорта в Django Admin — только стандартный `LogEntry` Django; в журнал раздела — `Не реализовано в коде`.

## Требования к правам
| Роль | Доступ | Как обеспечивается |
|---|---|---|
| ADMIN | полный (включая Django Admin) | `*` |
| REFERENCE_ADMIN | справочники: полный | `dictionary.view` (`list`, `entries`), `dictionary.manage` (`create_entry`, `set_active`, `delete_entry` PATCH+DELETE) — `permission_map` OpsDictionariesViewSet |
| REFERENCE_ADMIN | законы, транспорт: нет | у роли нет `catalog.view` и `event.view` |
| Роли с OPS_READ/SECTION_READ (EMPLOYEE, DIRECTORATE_HEAD, DEPARTMENT_EXPENSE_OFFICER, DUTY_OFFICER, EVENT_OFFICER, OPS_STAFF, PATROL_LEAD, GVO_LEAD, EVENT_APPROVER, DUTY_PLANNER, DUTY_PLAN_APPROVER, OBJECT_KEEPER, RATING_EVALUATOR, ANALYST, AUDITOR, HEAD_*_LINE, HEAD_OPS_UNIT) | законы: чтение | `catalog.view` — `OpsLegalDocumentsViewSet.permission_map`; экран `MODULE_PERMISSION["/security-ops/laws"]` |
| Роли с OPS_READ (те же, кроме EMPLOYEE, HEAD_DIRECTORATE_LINE, HEAD_DEPARTMENT_LINE — у них SECTION_READ без `event.view`) | транспорт: чтение | `event.view` — `OpsVehiclesViewSet.permission_map`; экран `MODULE_PERMISSION["/security-ops/vehicles"]` |
| Все, кроме REFERENCE_ADMIN и ADMIN | справочники: нет | 403 |

## Требования к UX/UI
- **«Справочники»** — страница `/security-ops/dictionaries`: таблица «Справочник / Описание / Значений / Активных / Действия» со ссылками на карточки; блок «Кадровые справочники» со ссылками `/security-ops/dictionaries/personnel/{kind}`; состояния загрузки и ошибки; метка «В разработке: Справочник стран и городов (№417)» в шапке.
- **Карточка справочника** — страница `/security-ops/dictionaries/{CODE}`: блок «Добавить значение» (поля «Код *», «Название *», «Группа (код)» с подсказкой `ACCESS` — только у справочников с группами; кнопка добавления отключена на время запроса; ошибки полей с сервера); список значений с бейджами активности и «группа: {код}», счётчиком связей по источникам; у значения — кнопки правки (поля «Название», «Описание», «Группа», кнопки сохранить/отмена), деактивации/активации, удаления; сообщения 409/422 показываются текстом сервера.
- **«Законы об ОМ»** — страница `/security-ops/laws`: поиск «Поиск по названию, номеру документа или содержанию…», кнопки-фильтры по виду, карточки документа (вид, код, редакция, статус, страницы); при `fileUrl=null` — текст об отсутствии файла, иначе кнопки «Открыть» (новая вкладка) и «Скачать»; состояния загрузки/ошибки/пусто.
- **«Транспорт ГОН»** — страница `/security-ops/vehicles`: поиск «Поиск по марке или государственному номеру…», кнопки-фильтры по классу брони, переключатель показа выведенных машин (aria-pressed, параметр URL `includeRetired`), таблица (марка, кузов, год, ГРНЗ, класс брони или «без брони», дислокация, примечание); состояния загрузки/ошибки/пусто.
- Нет права — `OpsAccessDenied`.

## Открытые вопросы
- Экран карточки справочника проверяет только `dictionary.view`: форма добавления и кнопки правки/удаления видны читателю без `dictionary.manage`, отказ приходит от сервера 403.
- Удаление физически доступно лишь для двух справочников (JOURNAL_ENTRY_TYPES, POST_REQUIREMENT_GROUPS); для остальных `usage_of` отвечает `NOT_TRACKED`, и удаление всегда отбивается 422 — по замыслу кода, но пользователю кнопка удаления показывается.
- Законы и транспорт ГОН не имеют UI-правки и API записи — только Django Admin (docstring моделей/вьюсетов); файлы законов не хранятся (`fileUrl` всегда null, если не заполнен вручную).
- Справочник стран и городов (`OpsCountry`/`OpsCity`) в списке `/security-ops/dictionaries` отсутствует; метка «В разработке (№417)» в `in-development.ts`.
- Внешний справочник STATUS_TYPES (`EXTERNAL_DEFINITIONS`) и «Кадровые справочники» ведутся другими приложениями и в этот UC не входят.
