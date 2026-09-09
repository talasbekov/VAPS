# UC-ORG-002. Управление штатными единицами и вакансиями

| Поле | Значение |
|---|---|
| Модуль | Оргструктура и кадры |
| Актор | Держатель `orgstructure.manage` (`DIRECTORATE_HEAD`, `HEAD_DIRECTORATE_LINE`, `HEAD_DEPARTMENT_LINE`, `HEAD_OPS_UNIT`) — запись; держатель `orgstructure.view` — чтение; `ADMIN` |
| Статус | Partial |
| Основание | `apps/staff_unit/models.py` (`StaffUnit`, `Vacancy`), `apps/staff_unit/views.py` (`StaffUnitViewSet`, `directorate_management`, `DivisionStatisticsViewSet`, `VacancyViewSet`, `PositionViewSet`), `apps/staff_unit/urls.py`, `apps/staff_unit/serializers.py`, `apps/common/rbac.py`, `apps/common/drf_permissions.py`, `apps/core/api/views.py` (`StaffingSlotViewSet`, `VacancyViewSet`, `PositionViewSet`, `RankViewSet`), FRONT `hooks/use-staff-units-page.ts`, `hooks/use-staff-unit-statistics.ts`, `hooks/use-staff-units-by-directorate.ts`, `app/employees/page.tsx`, `components/directorate-access-notice.tsx`, `lib/api.ts` (`getStaffUnitsByDirectorate`, `createStaffUnit`, `updateStaffUnitsByDirectorate`) |
| Дата актуализации | 2026-09-08 |

## Цель
Актор ведёт штатное расписание своей области: создаёт и правит штатные единицы, заводит в них сотрудников, видит свободные слоты (вакансии) и счётчики штата.

## Предусловия
- Актор вошёл в систему; у него есть `orgstructure.view` (чтение) или `orgstructure.manage` (запись) с областью, включающей нужное подразделение.
- Справочники должностей и званий заполнены (UC-ORG-003).
- Для ручки `directorate` — право `status.view`; учётная запись привязана к сотруднику со штатной единицей либо область задана грантами раздела.

## Main Flow
1. Актор открывает «Список сотрудников» (`/employees`, вкладка «Список сотрудников») — система запрашивает `GET /api/staff_unit/staff-units/directorate/` с фильтрами (поиск, подразделение, статус, страница по 50 строк) и показывает штатные единицы области с сотрудниками и их статусами.
2. Система показывает счётчики штата области из `GET /api/staff_unit/statistics/` и список отделов для фильтра.
3. Актор запрашивает штатное расписание по API: `GET /api/staff_unit/staff-units/` (список по области), `GET /api/staff_unit/staff-units/{id}/` (карточка с дочерними единицами и статусами, `StaffUnitDetailedSerializer`).
4. Актор создаёт штатную единицу: `POST /api/staff_unit/staff-units/` (подразделение, должность, номер слота `index`, родитель) — система проверяет право `create_staffing_position` → `orgstructure.manage` и область подразделения.
5. Актор заводит сотрудников в штатные единицы своего подразделения пакетом: `POST /api/staff_unit/staff-units/directorate/` — система создаёт `Employee` (генерирует табельный номер, принимает ИИН и звание) и привязывает к слоту.
6. Актор правит штатные единицы, сотрудников и статусы пакетом: `PUT/PATCH /api/staff_unit/staff-units/directorate/` (`staff_units[]`, `employees[]`, `employee_statuses[]`) — система применяет построчно и возвращает `updated` и `errors`.
7. Актор удаляет штатную единицу: `DELETE /api/staff_unit/staff-units/{id}/` (право `delete_staffing_position` → `orgstructure.manage`).
8. Актор смотрит свободные слоты: `GET /api/core/vacancies/?division_id=` — система отдаёт штатные единицы без сотрудника в контракте `StaffingSlotSerializer`; `GET /api/core/staffing-slots/` — все слоты.

## Alternative Flow
- **AF1. Нет права `status.view` на `directorate`**: шаг 1 → 403 `{"error": "Нужно право «Статусы: просмотр» — оно выдаётся ролью раздела в «Система → Роли»."}`; экран `/employees` закрывается целиком врезкой `DirectorateAccessNotice` (причина `permission`).
- **AF2. Учётка не привязана к подразделению**: шаг 1 → 400 «Не удалось определить подразделение пользователя»; та же врезка с причиной `scope` (чинит кадровик, а не администратор).
- **AF3. Нет `orgstructure.manage` или объект вне области**: шаги 4, 6, 7 → 403 (`CanManageStaffingTable` / `check_permission` с объектом).
- **AF4. Пакет с ошибками в строках**: шаг 6 → 200 с массивом `errors` (`ID штатной единицы обязателен`, `Штатная единица {id} не найдена или нет доступа`, `Звание с ID … не найдено`, `Сотрудник {id} не найден или нет доступа`, `Статус {id} не найден`); валидные строки применяются, невалидные пропускаются.
- **AF5. Попытка проставить статус «участие в ОМ» через `directorate`**: шаг 6 → отказ `_refuse_participation_status` (Plane №757): участие ставится только из запроса сбора сил.
- **AF6. Массовый пакет, в котором есть строки статусов, без права `status.manage`**: шаг 6 → ошибка строки `change_employee_status` (`check_permission`, `status.manage`).
- **AF7. Неизвестный `type_code` / нецелый `division_id`**: `GET /api/core/…` → 400 с текстом поля.

## Изменения в системе
| Объект | Действие | Описание |
|---|---|---|
| `staff_units` (`StaffUnit`) | create / update / delete | Слот: подразделение, должность, сотрудник (OneToOne), вакансия (OneToOne), родитель, `index` |
| `employees` (`Employee`) | create / update | Через `directorate` POST/PUT: ФИО, ИИН, звание, автоматический `personnel_number`, привязка к слоту |
| `employee_statuses` (`statuses.EmployeeStatus`) | create / update | Через `directorate` PUT — строки `employee_statuses[]` (см. UC-STS-001) |
| `vacancies` (`Vacancy`) | — | `Не реализовано в коде`: роут `vacancies` в `apps/staff_unit/urls.py` закомментирован (строка 9), записи не создаются и не читаются; `/api/core/vacancies/` отдаёт свободные слоты, а не записи `Vacancy` |
| `audit.AuditLog` | create | `AuditMiddleware` пишет `POST/PUT/PATCH/DELETE /api/staff_unit/staff-units/{id}/` (`ContentType` `staff_unit.staff-unit` не разрешается → см. «Логирование») |

## Бизнес-требования (BR)
- **BR1.** Штатная единица — пара «подразделение + должность» с номером слота `index`; сотрудник занимает не более одного слота (`OneToOneField`).
- **BR2.** Вакансия = штатная единица без сотрудника (`StaffUnit.employee IS NULL`) на текущий момент; временных границ у слота нет (`valid_from`/`valid_to` в контракте `/api/core/` всегда `null`), параметр `date` не поддерживается намеренно.
- **BR3.** Кадровые имена прав (`view_staffing_table`, `create_staffing_position`, `edit_staffing_position`, `delete_staffing_position`, `manage_staffing_table`, `view_vacancies`, `create_vacancy`, `edit_vacancy`, `close_vacancy`, `change_employee_status`) — только точки вызова; за ними стоят коды раздела `orgstructure.view` / `orgstructure.manage` / `status.manage` (`OPS_PERMISSION_BY_PORTAL`).
- **BR4.** Область записи — подразделения грантов `orgstructure.manage` с потомками (`is_in_scope`); суперпользователь Django — без ограничений.
- **BR5.** Чтение `directorate` открывается только `status.view` (кадровое `view_staffing_table` снято, Plane №352); запись через `directorate` — прежними кадровыми правами (`edit_staffing_position`, `create_staffing_position`, `change_employee_status`).
- **BR6.** При создании сотрудника через `directorate` ID сотрудника указывать нельзя; табельный номер генерируется сервером; после создания сотрудник ищется по ИИН и табельному и возвращается в ответе.
- **BR7.** Пакетное обновление идёт построчно с savepoint на строку: ошибка одной строки не откатывает остальные.
- **BR8.** Фильтры `directorate` GET: `search`, `division_id`, `employee_ids`, `position_level_max` (должности не ниже уровня), `status`, `status_not`, `with_summary`, `page`, `page_size` — все по И.
- **BR9.** Статистика (`/api/staff_unit/statistics/`) считается по `StaffUnit` области: штат, занято, вакансий — по департаментам, управлениям, отделам с путём предков.

## Требования к логированию
- `LogIPMiddleware` печатает каждый запрос (`print`), логгер `django.server` — в консоль.
- `AuditMiddleware`: для `/api/staff_unit/staff-units/…` `ContentType` ищется по `app_label="staff_unit"`, `model="staff-unit"` — модели с таким именем нет (`staffunit`), запись `AuditLog` не создаётся. Для `directorate` — то же. Аудит правок штатного расписания: `Не реализовано в коде`.
- `OpsAuditLog` (`audit_service`) при создании/правке штатных единиц и сотрудников: `Не реализовано в коде` (в `audit_service.ACTIONS` нет действий по штату; `EMPLOYEE_DISMISSED` есть, но из `staff_unit` не вызывается).
- `logging.getLogger` в `apps/staff_unit/admin.py` — только админка.

## Требования к правам
| Роль | Доступ | Как обеспечивается |
|---|---|---|
| `ADMIN` | полный | `*`; суперпользователь — `is_superuser` в `check_permission` и `get_queryset` |
| `DIRECTORATE_HEAD`, `HEAD_DIRECTORATE_LINE`, `HEAD_DEPARTMENT_LINE`, `HEAD_OPS_UNIT` | полный в области | `orgstructure.manage` через `CanManageStaffingTable` (`manage_staffing_table`) и `check_permission(user, 'create_staffing_position'/'edit_staffing_position'/'delete_staffing_position', obj)`; статусы в пакете — `status.manage` (`change_employee_status`) |
| Роли с `orgstructure.view` (см. UC-ORG-001) | чтение `staff-units`, `statistics`, `/api/core/staffing-slots`, `/api/core/vacancies` | `CanViewStaffingTable` (`view_staffing_table` → `orgstructure.view`); `permission_map` `list`/`retrieve` → `orgstructure.view` |
| Роли со `status.view` (в т.ч. `EMPLOYEE`, `EMPLOYEE_OPS_D2`, `INTEGRATION_USER` — нет; у них нет `status.view`/есть только `status.manage`) | чтение `directorate` | `CanReadDirectorate` → `_has_ops_status_view`; `INTEGRATION_USER` (`status.manage` без `status.view`) в `directorate` не пускается |
| Остальные (`REFERENCE_ADMIN`, `FEEDBACK_TRIAGE`, `OM_CATEGORY_ORG`, `OPS_STAFF_COMMAND`, `OVERVIEW_DEPARTMENT` на запись) | нет | 403 |
| Любой вошедший | чтение/запись `/api/staff_unit/positions/` | `Не реализовано в коде`: роут `positions` закомментирован (`urls.py:7`); `PositionViewSet` в `views.py` ставит `IsAuthenticated` на все методы |

## Требования к UX/UI
- Страница «Сотрудники» (`/employees`), вкладка «Список сотрудников»: строка поиска «Поиск по ФИО, должности, отделу...», фильтр отдела (`SearchableSelect`, список из статистики), фильтр «Все статусы» (типы из справочника + «Не обновлено»), таблица `EmployeeTable`: чекбокс, «№», «ФИО», «Должность», «Отдел», «Статус», «Статус с», «Дата найма», действия; постраничная навигация по 50 строк; кнопки «Обновить», «Экспорт CSV»; вкладка «Карточки» — те же строки карточками с кнопкой «Сбросить фильтры» при пустом отборе.
- Состояния: загрузка, ошибка с повтором, пустой отбор; при 403/400 от `directorate` — экран целиком заменяется `DirectorateAccessNotice` с двумя разными текстами (нет права / учётка не привязана).
- Форма создания или правки штатной единицы, форма вакансии, кнопка «Добавить сотрудника»: `Не реализовано в коде` (в UI нет вызовов `createStaffUnit`, `POST/DELETE /api/staff_unit/staff-units/`; `updateStaffUnitsByDirectorate` зовёт только массовое обновление статусов, UC-STS-001).
- Свободные слоты отдельным списком: `Не реализовано в коде` (`/api/core/vacancies/` фронтом не читается; вакансии видны только счётчиком и строками-вакансиями в таблице статусов).

## Открытые вопросы
- Управление штатными единицами доступно только через API: в портале нет ни одной формы создания/правки/удаления слота, хотя `lib/api.ts` содержит `createStaffUnit` (POST `directorate`) без вызывающих.
- Роуты `positions` и `vacancies` в `apps/staff_unit/urls.py` закомментированы (строки 7 и 9): `VacancyViewSet` с `permission_map` и `Vacancy` со статусами `open`/`closed`, требованиями и обязанностями недоступны по HTTP; вакансии как сущность не ведутся.
- `/api/core/vacancies/` отдаёт слоты без сотрудника, игнорируя `Vacancy` — два понятия «вакансия» в коде (объявление о наборе и пустой слот).
- Модели `StaffUnit` и `Vacancy` объявляют по 9–12 Django-permissions (`view_staffing_table_all`, `change_position_quota`, `publish_vacancy` и др.), в коде используются только имена из `OPS_PERMISSION_BY_PORTAL`; остальные не проверяются нигде.
- `AuditMiddleware` не разрешает `ContentType` для `staff-units` (имя модели с дефисом), правки штата не попадают ни в один журнал.
- В `directorate` POST при ошибке валидации сотрудника в `errors` уходит `str(ValidationError)` (repr словаря), а не поле → сообщение.
- Ограничение откомандированных (запрет правки данных у `is_seconded`) снято вместе со старым каталогом ролей (`apps/common/rbac.py`), аналога в разделе нет — потеря записана в `Frontend/Decisions.md`.
