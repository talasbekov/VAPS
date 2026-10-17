# UC-ADM-006. Завести пользователя, выдать роль с областью и работать в системе строго в своей области

| Поле | Значение |
|---|---|
| Модуль | Администрирование и доступ |
| Актор | Администратор доступа — держатель `admin.roles` (`ADMIN`, `SECURITY_ADMIN`); Пользователь — любая учётная запись, которой выдана роль раздела с областью |
| Статус | Partial |
| Основание | Сквозной UC над UC-ADM-001 (роли и права), UC-ADM-002 (учётки и выдачи), UC-GEN-001 (вход). Код: `apps/operations/models.py` (`Role`, `Permission`, `RolePermission`, `UserRole`, `TemporaryDutyPermission`), `apps/operations/services.py` (`PermissionService.effective_permissions/unscoped_permissions/visible_division_ids/scope_matches`, `AccountAdminService`, `RoleAdminService`, `LegacyRoleSync.actor_id_for_user`), `apps/operations/api/permissions.py` (`require_permission`, `require_any_permission`, `require_scoped_permission`, `RequirePermissionMixin`), `apps/operations/api/views.py` (`AccountViewSet`, `UserRoleViewSet`, `MyPermissionsViewSet`, `MyEmployeeViewSet`, `StatusViewSet`, `_resolve_division_scope`, `_assert_division_in_scope`), `apps/ops/daily.py`, `apps/ops/api/views.py` (`SecurityEventViewSet`, `SecurityObjectViewSet`, `OpsPersonnelViewSet`, `OpsDailyDivisionsViewSet`, `permission_override`), `apps/staff_unit/views.py` (`_ops_scope_divisions`, `_ops_scope_roots`, `_own_scope_divisions`, `_get_user_own_division`, `CanReadDirectorate`, `DivisionStatisticsViewSet._statistics_scope`), `apps/statuses/api/views.py` (`EmployeeStatusViewSet`), `apps/divisions/api/views.py`, `apps/audit/views.py`, `apps/common/rbac.py`, `apps/common/services/permissions.py`, `apps/common/jwt_serializers.py`, `apps/employees/admin.py` (`autocomplete_fields=['user']`), `management/commands/seed_operations.py` (`PERMISSIONS`, `ROLES`, `ROLE_PERMISSIONS`), `apps/common/management/commands/seed_access_matrix.py` (`PERSONAS`, `_bind_employee`); FRONT `app/settings/users/page.tsx`, `app/settings/roles/page.tsx`, `hooks/use-access-permissions.ts`, `hooks/use-ops-permissions.ts`, `entities/portal-access/index.ts` (`MODULE_PERMISSION`), `components/navigation/{sidebar,header}.tsx`, `components/providers.tsx`, `app/dashboard/page.tsx`, `components/dashboard/stats-cards.tsx`, `hooks/use-absence-statistics.ts`, `components/status-table.tsx`, `hooks/use-staff-units-page.ts`, `hooks/use-staff-unit-statistics.ts`, `app/security-ops/profile/page.tsx`, `e2e/access-matrix-menu.spec.ts` |
| Дата актуализации | 2026-09-21 |

## Цель
Администратор под своей учётной записью заводит нового пользователя, выдаёт ему роль (набор прав) с областью — подразделением или всей службой, — и пользователь после входа видит в меню только разрешённые модули, а внутри модулей — только данные своей области. Всё, что вне области, сервер не отдаёт и не принимает независимо от того, каким клиентом пришёл запрос.

## Предусловия
- Администратор вошёл; у него `admin.roles` или `*` (роль `ADMIN`). Флаг Django `is_superuser` сам по себе доступа в раздел не даёт (BR6).
- Каталог ролей и прав засеян (`manage.py seed_operations`), оргструктура заведена (`Division`), кадровые записи (`Employee`) стоят на штатных единицах — область вычисляется по подразделению штатной единицы сотрудника.
- Пользователь получит логин и временный пароль от администратора лично: доставки почтой/SMS нет (UC-ADM-002).

## Main Flow
1. Администратор открывает «Настройки → Пользователи» (`/settings/users`), нажимает «Завести учётную запись», вводит логин, фамилию, имя, почту → `POST /api/operations/accounts/`. Система создаёт `auth_user`, возвращает временный пароль один раз (`temporary_password`), пишет `ACCESS_ACCOUNT_SAVED`.
2. Администратор связывает учётку с кадровой записью сотрудника (`Employee.user`, OneToOne): по этой связи работают «Мой профиль», шапка портала, сводка отсутствий «Обзора», входящие прикомандирования и подбор «своих» людей в сборе сил. Область роли (шаг 3) от этой связи **не зависит**. Сегодня связь ставится только в Django-админке — см. «Разрыв», п. 5.
3. Администратор выбирает учётку и в блоке «Выдать роль» указывает роль и область: «Вся служба» (`scope_division_id = null`) или подразделение → `POST /api/operations/user-roles/`. Система создаёт `UserRole`, пишет `ACCESS_ROLE_GRANTED`. Область накрывает подразделение и всё его поддерево (`DivisionTreeSelector.subtree_ids`). Грантов может быть несколько, у каждого своя область — так собраны персоны матрицы заказчика (`seed_access_matrix.PERSONAS`): например, `acc_dir_head` = `HEAD_DIRECTORATE_LINE` на своё управление + `OVERVIEW_DEPARTMENT` на свой департамент; `acc_dept_head_d2` = `HEAD_OPS_UNIT` на департамент + `OM_CATEGORY_ORG` и `OPS_STAFF_COMMAND` без области.
4. Если готовой роли с нужным набором прав нет, администратор до выдачи заводит её в «Настройки → Роли» и отмечает права (UC-ADM-001). Роль без единого права доступа не даёт (AF2).
5. Администратор передаёт пользователю логин и временный пароль; пользователь меняет его в «Мой профиль» (UC-GEN-002).
6. Пользователь входит (`POST /api/token/`, UC-GEN-001). Токен несёт только личность (`username`, `email`, `is_staff`, `is_superuser`, данные сотрудника) — прав в токене нет, поэтому перелогин после выдачи роли не нужен.
7. Клиент запрашивает `GET /api/operations/my-permissions/` → `{permissions: [...], roles: [{code, name, scope_division_id, scope_division_name}]}` — объединение прав по всем активным грантам и действующим временным правам наряда. Меню и разделы строятся по карте `MODULE_PERMISSION` (`entities/portal-access`): модуль без права не показывается, прямой переход по адресу — экран `OpsAccessDenied`; шапка и сайдбар печатают роли с областью.
8. Пользователь открывает модуль. Сервер проверяет право (`RequirePermissionMixin.permission_map` / `require_permission`) и сужает данные областью гранта через `PermissionService.visible_division_ids(actor, право)` (`None` — вся служба, множество id — область, пусто — ничего):
   - «Статусы сотрудников» (`/statuses`): `GET /api/staff_unit/staff-units/directorate/` — штатные единицы только подразделений области `status.view` (`_own_scope_divisions` → `_ops_scope_divisions`); чужой `division_id` в параметре пересекается с областью и даёт пустой список. Фильтр подразделений экрана — из `GET /api/staff_unit/statistics/` (`_statistics_scope` по `status.view`/`orgstructure.view`). Статусы раздела `GET /api/operations/statuses/` — `_resolve_division_scope`: чужой `division_id` → 403.
   - «Обзор» (`/dashboard`): дерево `OrgBoard` — из `statistics`, только область.
   - «Ежедневный расход» (`/employees`, `DailyExpenseBoard`): `GET /api/ops/daily/divisions/` — область `status.view` для чтения и `daily_report.generate` для сдачи (`ops/daily.py`).
   - «Сбор сил на ОМ»: список запросов — только свой департамент (`test_the_requests_list_shows_only_my_department`); оповещение управлений, отправка списка, выделение людей — `require_scoped_permission` по подразделению **из данных мероприятия**, а не из тела запроса.
   - Прикомандирования раздела (`/api/operations/secondments/`): строки, где своё подразделение — источник или приёмник.
   - Штатное расписание и вакансии (`/api/staff_unit/staff-units/`, `vacancies/`): `get_user_scope_queryset` по области `orgstructure.view` (`common/rbac.py`).
9. Пользователь пишет только внутри области: статус чужому сотруднику → 403 `PERMISSION_DENIED` (`DomainError`, «Сотрудник вне области видимости оператора»); пачка с одним чужим человеком отклоняется целиком до первой записи; сотрудник без штатной единицы для гранта с областью — отказ (fail-closed), для гранта без области — пропуск (BR3).
10. Администратор меняет доступ: снимает роль (`DELETE /api/operations/user-roles/{id}/` — деактивация, история остаётся), меняет права роли (`POST /api/operations/roles/{code}/permissions/`), блокирует учётку (`PATCH /api/operations/accounts/{id}/ {is_active:false}`). Сервер считает права заново на каждом запросе — кэша нет; клиент пользователя перечитывает `my-permissions` по своей политике кэша (BR5, AF4).
11. Все действия шагов 1, 3, 4, 10 видны в журнале раздела (`/security-ops/audit`, право `audit.view`): кто, кому, какую роль, с какой областью, когда.

## Alternative Flow
- **AF1. У актора нет `admin.roles`**: шаги 1, 3, 4, 10 → 403 `PERMISSION_DENIED`; экран — `OpsAccessDenied`. Суперпользователь Django без роли `ADMIN` получает тот же 403: `PermissionService` флаг `is_superuser` не читает.
- **AF2. Роль выдана, но прав у неё нет** (новая роль из UC-ADM-001 без отмеченных прав, либо права сняты): шаг 7 → `permissions: []`; в меню нет ни одного гейтированного модуля, кроме «Мой профиль». Для пользователя это выглядит как «права не добавились». Проверка: `GET /api/operations/roles/{code}/` → `permissions`; `GET /api/operations/my-permissions/` под учёткой пользователя.
- **AF3. Учётка не связана с кадровой записью** (шаг 2 пропущен): вход и меню работают — область даёт грант, а не сотрудник; но «Обзор» отвечает 400 «Пользователь не привязан к сотруднику» в карточках отсутствий (`absence_statistics`), «Мой профиль» показывает `UNLINKED_REASON` («Учётная запись не связана с кадровой…»), входящие прикомандирования пусты, сбор сил не находит «своего» человека; `/statuses` без гранта с `status.view` — 400 «Не удалось определить подразделение пользователя».
- **AF4. Права выданы, а экран пользователя их ещё не показывает**: `["ops-me"]` кэшируется клиентом на 60 с, перечитывание при возврате фокуса окна выключено (`components/providers.tsx`: `staleTime: 60_000`, `refetchOnWindowFocus: false`). Новый грант появляется после перехода между экранами спустя минуту или после перезагрузки страницы. Снятая роль по той же причине остаётся в меню до минуты; сервер отказывает сразу.
- **AF5. Область гранта есть, а подразделение действия установить нельзя** (объект без подразделения, сотрудник без штатной единицы, нечисловой id): `require_scoped_permission` спрашивает `unscoped_permissions` — у гранта с областью отказ, у гранта без области пропуск.
- **AF6. Пользователь с областью видит данные чужого подразделения** — дефект, не поведение по замыслу. Подтверждённые по коду места — «Разрыв», п. 1–4: кадровые статусы `/api/statuses/statuses/` (весь список любому вошедшему), сводка отсутствий по штатной единице вместо области, полное дерево и CRUD `/api/divisions/`, HTTP-аудит `/api/audit/logs/`.
- **AF7. Реестры раздела ОМ без области**: мероприятия, объекты, охраняемые лица, транспорт, кадровый снимок для расстановки (`/api/ops/security-events/`, `/api/ops/objects/`, `/api/ops/personnel/`, `/api/ops/protected-persons/`, `/api/ops/vehicles/`) отдаются целиком любому держателю права — у мероприятия и объекта нет подразделения, область на них по текущей модели не действует. Доступ к действиям над конкретным ОМ решает роль в данных (`permission_override`: старший объекта, замещающий, создатель, старший ГВО).
- **AF8. Повторная выдача той же роли в той же области**: строка реактивируется (`update_or_create`); несуществующий `scope_division_id` → 400 «Подразделения с таким id нет.»; неизвестный `role_code` → 400.
- **AF9. Администратор снимает с себя последнюю выдачу с `admin.roles`/`*`**: `DomainError LAST_ACCESS_ADMIN_ROLE`, отказ.
- **AF10. Учётка заблокирована** (`is_active=false`): вход и WebSocket закрыты; уже выданный access-токен живёт до 8 ч (UC-ADM-002, BR5).

## Изменения в системе
| Объект | Действие | Описание |
|---|---|---|
| `auth_user` (`User`) | create / update | учётка: логин, ФИО, почта, `is_active`, хеш пароля (UC-ADM-002) |
| `employees_employee.user` | update | связь кадровой записи с учёткой (шаг 2); сегодня — только Django-админка |
| `ops_user_roles` (`UserRole`) | create / update | грант: `user_id = str(User.pk)`, `role_code`, `scope_division_id` (`null` = вся служба), `is_active`, `created_by`; снятие — `is_active=False` |
| `ops_roles`, `ops_role_permissions` | create / update / delete | новая роль и её права (UC-ADM-001) |
| `ops_audit_logs` (`OpsAuditLog`) | create | `ACCESS_ACCOUNT_SAVED`, `ACCESS_ROLE_GRANTED`, `ACCESS_ROLE_REVOKED`, `ACCESS_ROLE_SAVED`, `ACCESS_ROLE_PERMISSIONS_CHANGED`, `ACCESS_ACCOUNT_PASSWORD_RESET` |
| Эффективные права пользователя | read | считаются на каждом запросе из `UserRole` + действующих `TemporaryDutyPermission` + `RolePermission`; кэш — только на объекте `request` (`effective_permissions(request)`) |
| Данные экранов пользователя | read / write | сужаются `visible_division_ids` / `require_scoped_permission` — таблица покрытия в «Разрыве» |

## Бизнес-требования (BR)
- **BR1. Единственный источник доступа — роли раздела с областью.** Что можно — решает код права роли; чьё — область гранта: подразделение и его поддерево, `null` — вся служба. Экраны и ручки не знают кодов ролей наизусть (решение Ш-2/Ш-3, Plane №352): новая роль заказчика работает без правки кода.
- **BR2. Область действует на сервере на каждом чтении и записи**, а не только в меню: список, счётчик, фильтр, карточка и мутация одного экрана отвечают одной и той же областью. Запрос чужого подразделения — 403, а не пустой ответ (пустой неотличим от «там никого нет»).
- **BR3. Неопределимая область разбирается по типу гранта**: грант без области — пропуск, все гранты с областью — отказ (fail-closed). Подразделение берётся из данных (штатная единица сотрудника, департамент строки), а не из тела запроса.
- **BR4. Меню и разделы строятся по объединению прав всех активных грантов** (`my-permissions`); модуль без права не показывается; прямой переход — `OpsAccessDenied`. Право `*` открывает всё.
- **BR5. Изменение прав действует на сервере немедленно** и без перелогина (прав в токене нет); клиент обязан перечитать права не позже чем через 60 с или при явном действии пользователя.
- **BR6. Флаг `is_superuser` — не путь доступа** в разделе ОМ; в переходных модулях (`staff_unit`, `reports`, `secondments`, `common/rbac.py`) он остаётся обходом до их переноса на права раздела.
- **BR7. Учётная запись связывается с кадровой записью из интерфейса администратора**: область роли и «свой сотрудник» — два разных факта, и второй нужен экранам самообслуживания.
- **BR8. Права роли — из справочника в БД.** Сид `seed_operations` только добавляет (`update_or_create`) и не перетирает изменения администратора; миграции меняют выдачи ролям только по решению заказчика, зафиксированному в докстринге миграции.
- **BR9. Выключенная роль или право (`is_active=False`) продолжают действовать** в гейте — намеренно (Plane №924); отключение через экран меняет справочник, не доступ. Снимать доступ — снятием выдачи.
- **BR10. Пароль**: временный, 16 символов, показывается один раз; смена администратором только сбросом (UC-ADM-002).

## Требования к логированию
- `OpsAuditLog`: все события доступа из таблицы выше, актор — `resolve_actor_id(request)`; `revoke_role` требует непустого актора.
- Отказ по области отдаётся ответом (`DomainError PERMISSION_DENIED`, `detail={employee_id|division_id}`), в журнал не пишется — по замыслу.
- `LogIPMiddleware` — строка на каждый запрос; `audit.AuditLog` (HTTP-аудит) — успешные мутации `/api/`, но для `accounts`, `user-roles`, `roles`, `permissions` `ContentType` не находится и записей нет.
- Связывание `Employee.user` через Django-админку — только `django_admin_log`; в `OpsAuditLog` — `Не реализовано в коде`.

## Требования к правам
| Роль | Доступ | Как обеспечивается |
|---|---|---|
| `ADMIN` | всё | `*` (`ROLE_PERMISSIONS["ADMIN"]`). Область у гранта `ADMIN` глобальные проверки не сужает: `require_permission` резолвит права с `division_id=None`, и любой грант совпадает |
| `SECURITY_ADMIN` | учётки, выдачи, роли, права, каталог применения, аудит | `admin.roles`, `audit.view`; `require_permission(request, "admin.roles")` в `AccountViewSet`, `UserRoleViewSet`, `RoleViewSet`, `PermissionViewSet`; экраны `/settings/{users,roles,permissions}` через `MODULE_PERMISSION` |
| Любая роль с областью | модули по правам роли; данные — подразделение области и его поддерево | `RequirePermissionMixin` + `visible_division_ids` / `require_scoped_permission` в ручках из таблицы покрытия |
| Любая роль без области | те же модули по всей службе | `scope_division_id=null` → `visible_division_ids` = `None` |
| Вошедший без роли | «Мой профиль», свои права, своя кадровая запись, свои смены | `/api/user/profile/`, `/api/user/change-password/`, `/api/operations/my-permissions/`, `/api/operations/my-employee/`, `duty-shifts/mine` (`permission_override`) |
| Суперпользователь Django без роли | раздел ОМ — 403; переходные модули — всё | `is_superuser` в `staff_unit/views.py` (≈20 мест), `reports/api/views.py`, `secondments/api/views.py`, `common/rbac.py`, `common/services/permissions.py` |

## Требования к UX/UI
- «Пользователи» (`/settings/users`) — как в UC-ADM-002, плюс: поле «Сотрудник» в панели учётки (поиск по кадровым записям, привязка/отвязка `Employee.user`, подсказка «Без связи недоступны профиль, сводка отсутствий и входящие прикомандирования»); область выдачи — путём «Департамент › Управление › Отдел» (как в фильтре `status-table`), а не только именем; при выдаче роли без прав — предупреждение «У роли нет ни одного права — пользователь ничего не увидит».
- «Роли» (`/settings/roles`): при сохранении роли без прав — то же предупреждение.
- Клиент пользователя: роли с областью в шапке и сайдбаре — есть (`scope_division_name`); отказ по области показывает причину сервера («Сотрудник вне области видимости оператора»), а не общий «Доступ закрыт».
- «Обзор» без кадровой связи: карточки отсутствий показывают причину («Учётная запись не связана с кадровой записью»), а не блок ошибки загрузки.
- Права на клиенте перечитываются при возврате фокуса окна либо есть действие «Обновить права» — выданная роль появляется без перезагрузки.

## Post-Conditions
- Учётка существует, связана с сотрудником, имеет один или несколько активных грантов с областью; события выдачи — в `OpsAuditLog`.
- Пользователь видит модули по правам, данные — по области; запросы вне области получают 403 на сервере.

## Разрыв с текущей реализацией

### Что уже работает
Сквозной путь «завести учётку → выдать роль с областью → пользователь работает в своей области» реализован для экранов раздела: `/statuses` (directorate, statistics, `/api/operations/statuses/`), `/dashboard` (дерево), ежедневный расход, сбор сил, прикомандирования раздела, штатка и вакансии. Проверки области покрыты пробами `test_scoped_permission.py`, `test_ops_forces_scope.py`, `test_status_writes_require_status_manage.py`, `test_statistics_ops_scope.py`, `test_directorate_ops_role.py`.

### Таблица покрытия областью (по коду)
| Экран / ручка | Право | Область гранта действует |
|---|---|---|
| `/api/staff_unit/staff-units/directorate/` (таблица «Статусы») | `status.view` | да — `_own_scope_divisions` |
| `/api/staff_unit/statistics/` (фильтр подразделений, «Обзор») | `status.view` / `orgstructure.view` | да — `_statistics_scope` |
| `/api/staff_unit/staff-units/`, `vacancies/` | `orgstructure.view/manage` | да — `get_user_scope_queryset` |
| `/api/operations/statuses/` (чтение, пачка, правка) | `status.view` / `status.manage` | да — `_resolve_division_scope`, `_assert_*_in_scope` |
| `/api/ops/daily/*` | `status.view` / `daily_report.generate` | да — `ops/daily.py` |
| Сбор сил (`forces_*`, `notify`, `submit`, `member_add`) | `forces.*` | да — `require_scoped_permission` |
| `/api/operations/secondments/` | `status.view` | да — источник или приёмник в области |
| `/api/reports/` | `orgstructure.view` (область) | да — `common/services/permissions.py`; без гранта — только свои отчёты |
| `/api/statuses/statuses/` (кадровые статусы, список, `planned`, `history`) | нет (только `IsAuthenticated`) | **нет** — все статусы любому вошедшему (`get_queryset`, `TODO: Добавить проверку ролей`) |
| `/api/statuses/statuses/absence_statistics/` (карточки «Обзора») | нет | **нет** — подразделение штатной единицы пользователя, не область гранта; без связи — 400 |
| `/api/divisions/`, `/api/divisions/tree/` | нет (`IsAuthenticated`, `ModelViewSet`) | **нет** — всё дерево; create/update/destroy подразделений любому вошедшему |
| `/api/audit/logs/` (HTTP-аудит с `diff`, `ip_address`, `user_agent`) | нет (`IsAuthenticated`) | **нет** |
| `/api/ops/security-events/`, `objects/`, `personnel/`, `protected-persons/`, `vehicles/` | `event.view`, `object.view`, `event.manage`/`event.create`, `catalog.view` | нет по модели — у сущностей нет подразделения (AF7) |
| `/api/dictionaries/`, `/api/ops/dictionaries/` | `dictionary.view/manage` | не требуется — справочники общие |

### Что предстоит
| № | Требование | Что есть | Что предстоит |
|---|---|---|---|
| 1 | BR2 на кадровых статусах | `EmployeeStatusViewSet.get_queryset` (`apps/statuses/api/views.py`) отдаёт все статусы любому вошедшему; `planned` и `history` — по любому `employee_id`. Экраны сегодня зовут только `planned` и `absence_statistics`, но по API статусы чужого подразделения читаются | Сузить чтение `visible_division_ids(actor, "status.view")` по штатной единице сотрудника — тем же правилом, что уже стоит на записи (`_assert_employees_in_scope`); `planned`/`history` — отказ по чужому `employee_id` |
| 2 | BR2 на сводке отсутствий «Обзора» | `absence_statistics` берёт подразделение по цепочке `User → Employee → StaffUnit → Division`; у учётки без связи — 400; у начальника департамента со штатной единицей в отделе сводка считается по отделу | Считать по области гранта (`_statistics_scope`), связь с сотрудником использовать только как запасной ключ |
| 3 | BR2 и гейт на оргструктуре | `DivisionViewSet`/`DivisionTreeViewSet` — `IsAuthenticated`: любой вошедший читает всё дерево и может создавать, править и архивировать подразделения через API (экран это не показывает, но проверка на клиенте проверкой не является) | Гейт `orgstructure.view` на чтение, `orgstructure.manage` на запись; дерево — по области либо только для `admin.roles`/`orgstructure.manage`. Клиенты дерева: `SecondEmployeeDialog` (цель прикомандирования), `/settings/users` (выбор области) |
| 4 | Гейт на HTTP-аудите | `AuditLogViewSet` — `IsAuthenticated` (см. UC-ADM-004) | `audit.view` |
| 5 | BR7 связь учётки с сотрудником из интерфейса | Только Django-админка (`EmployeeAdmin.autocomplete_fields=['user']`) или сид `seed_access_matrix._bind_employee`; `AccountSerializer` поля `employee` не имеет, `/api/core/employees/` read-only; `MyEmployeeViewSet` честно отвечает `employee: null` + причина | Поле `employee_id` в `AccountSerializer` (`PATCH accounts/{id}/`), проверка «сотрудник свободен» (OneToOne), событие `ACCESS_ACCOUNT_EMPLOYEE_LINKED` в `OpsAuditLog`, поле «Сотрудник» на `/settings/users` |
| 6 | BR6 суперпользователь | `is_superuser` открывает всё в `staff_unit/views.py`, `reports`, `secondments`, `common/rbac.py`, `common/services/permissions.py`; в разделе ОМ не действует — две «суперроли» с разным покрытием | Снять обход по мере переноса модулей на права раздела; до тех пор — не выдавать `is_superuser` рабочим учёткам, для администрирования использовать роль `ADMIN` |
| 7 | BR5 / AF4 свежесть прав на клиенте | `staleTime: 60_000`, `refetchOnWindowFocus: false` для всех запросов, `["ops-me"]` инвалидируется только на клиенте администратора | `refetchOnWindowFocus: true` для `["ops-me"]` (или `staleTime: 0`), кнопка «Обновить права» в шапке |
| 8 | AF2 роль без прав | Экран выдачи не предупреждает; `is_active=False` роли/права гейт игнорирует по замыслу, на экране это не объяснено (UC-ADM-001) | Предупреждение на `/settings/users` и `/settings/roles`; подпись у переключателя «Отключить» — «не снимает доступ» |
| 9 | Проверка адресата выдачи | `AssignRoleRequestSerializer.user_id` — любая строка до 100 символов; выдача «в никуда» возможна через API | Валидатор существования `User` по `pk` |
| 10 | BR4 карта модулей | `MODULE_PERMISSION` ведётся руками и должна совпадать с `permission_map` сервера; каталог применения (`/api/ops/access-catalog/`) показывает только серверную сторону | Проба, сверяющая `MODULE_PERMISSION` с каталогом (право карты обязано существовать в справочнике и стоять хотя бы на одной ручке модуля) |
| 11 | Область на реестрах ОМ (AF7) | По модели данных области нет; действия над конкретным ОМ — по роли в данных | Решение заказчика: нужна ли область (например, по департаменту-владельцу ОМ); при «да» — поле подразделения у `OpsSecurityEvent`/`OpsSecurityObject` и фильтр списка |
| 12 | `ADMIN` с областью | Выдача возможна, но `*` проходит все глобальные проверки при любой области — область у `ADMIN` вводит в заблуждение | Запретить область у ролей с `*` (400 на `user-roles`) либо честно показывать «Вся служба» |
| 13 | Мёртвый сценарий стенда | `scripts/create_users.py` импортирует несуществующее `apps.auth` и содержит литерал пароля `string` | Удалить; учётки стенда — `seed_access_matrix` / `seed_role_accounts` с паролем из окружения |

### Как проверить на стенде
Учётка `U` с одним грантом `HEAD_DIRECTORATE_LINE` на управление `A` (департамента `D`), чужое подразделение `B`:
1. `GET /api/operations/my-permissions/` под `U` → `permissions` содержит `status.view`, `status.manage`, `orgstructure.manage`; `roles[0].scope_division_name = A`.
2. `GET /api/operations/my-permissions/?division_id=<B>` → `permissions: []` (грант не накрывает `B`).
3. `GET /api/staff_unit/staff-units/directorate/` → только штатные единицы `A` и потомков; `?division_id=<B>` → пусто. `GET /api/staff_unit/statistics/` → `divisions` только из `A`.
4. `GET /api/operations/statuses/?division_id=<B>` → 403. `POST /api/operations/statuses/bulk/` с сотрудником из `B` → 403 `{error_code: PERMISSION_DENIED, detail: {employee_id}}`.
5. Дефекты п. 1–4: `GET /api/statuses/statuses/` → строки сотрудников `B` (п. 1); `GET /api/statuses/statuses/absence_statistics/` → 400 «Пользователь не привязан к сотруднику» либо сводка по штатной единице `U`, а не по `A` (п. 2); `GET /api/divisions/tree/` → всё дерево, `POST /api/divisions/` → 201 (п. 3); `GET /api/audit/logs/` → 200 (п. 4).
6. Меню под `U`: «Обзор», «Статусы сотрудников» (как у `acc_dir_head` в `e2e/access-matrix-menu.spec.ts`); «Настройки» скрыты. После выдачи новой роли администратором — меню `U` меняется после перехода между экранами не раньше чем через 60 с (п. 7).

## Открытые вопросы
- Нужна ли область на реестрах раздела ОМ (мероприятия, объекты, охраняемые лица, транспорт) — сейчас доступ к ним «всё или ничего» по праву, а к действиям — по роли в данных.
- Что считать «своим» подразделением для сводок самообслуживания («Обзор», профиль): штатная единица сотрудника или область гранта — сегодня первое, и у руководителя с грантом на департамент сводка считается по его отделу.
- `ADMIN` с областью: запрещать выдачу или трактовать как «Вся служба».
- Порядок связывания учётки с кадровой записью: обязательный шаг при заведении (нельзя завести без сотрудника) или необязательный (технические учётки `INTEGRATION_USER` сотрудника не имеют).
- Персоны матрицы заказчика (`seed_access_matrix`, 8 учёток `acc_*`) проверяются e2e только по составу меню (`access-matrix-menu.spec.ts`); проверки «видит только свою область» на уровне данных в e2e нет.
- Временные права наряда — без экрана (UC-ADM-002); их область (`scope_division_id`) участвует в `visible_division_ids` наравне с ролями.
