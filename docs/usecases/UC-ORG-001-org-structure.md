# UC-ORG-001. Просмотреть структуру организации

| Поле | Значение |
|---|---|
| Модуль | Оргструктура и кадры |
| Актор | Держатель `orgstructure.view` (`DIRECTORATE_HEAD`, `DEPARTMENT_EXPENSE_OFFICER`, `DUTY_OFFICER`, `EVENT_OFFICER`, `OPS_STAFF`, `PATROL_LEAD`, `GVO_LEAD`, `EVENT_APPROVER`, `DUTY_PLANNER`, `DUTY_PLAN_APPROVER`, `OBJECT_KEEPER`, `RATING_EVALUATOR`, `ANALYST`, `SECURITY_ADMIN`, `AUDITOR`, `HEAD_DIRECTORATE_LINE`, `HEAD_DEPARTMENT_LINE`, `HEAD_OPS_UNIT`, `OVERVIEW_DEPARTMENT`, `FORCES_GATHERING_OFFICER`), `ADMIN` |
| Статус | Done |
| Основание | `apps/divisions/models.py` (`Division`, MPTT), `apps/divisions/api/views.py` (`DivisionViewSet`, `DivisionTreeViewSet`), `apps/core/api/views.py` (`DivisionViewSet`, `StaffingSlotViewSet`), `apps/staff_unit/views.py` (`StaffUnitViewSet.list`, `DivisionStatisticsViewSet`), `apps/common/rbac.py` (`OPS_PERMISSION_BY_PORTAL`), FRONT `app/organization/page.tsx`, `features/organization-structure/ui/OrgChart.tsx`, `OrgBoard.tsx`, `OrgNode.tsx`, `app/dashboard/page.tsx`, `hooks/use-staff-units.ts`, `hooks/use-staff-unit-statistics.ts`, `lib/api.ts` (`convertStaffUnitsResponseToOrgUnit`) |
| Дата актуализации | 2026-09-08 |

## Цель
Актор видит дерево подразделений своей области с занятыми и свободными штатными единицами и сводными счётчиками по департаментам, управлениям и отделам.

## Предусловия
- Актор вошёл в систему (UC-GEN-001).
- У актора есть право `orgstructure.view` (или `status.view` — только для ручки статистики) с областью, охватывающей хотя бы одно подразделение; иначе ручка статистики отвечает 400 «Не удалось определить область видимости пользователя».
- В базе заведено дерево `Division` (тип узла `organization` / `department` / `directorate` / `division`, глубина до 5 уровней) и штатные единицы `StaffUnit`.

## Main Flow
1. Актор открывает страницу «Структура организации» (`/organization`).
2. Система запрашивает сводку `GET /api/staff_unit/statistics/` и показывает шесть плиток: «Занято», «Департаментов», «Управлений», «Отделов», «Штатных единиц», «Вакансий».
3. Система показывает таблицу «Штат по подразделениям»: подразделение с путём предков («Входит в»), уровень, штат, занято, вакансий — по департаментам, управлениям и отделам области актора.
4. Система запрашивает штатные единицы `GET /api/staff_unit/staff-units/?page_size=500` и собирает из них интерактивное дерево (`OrgChart`): руководство → департаменты → управления, у каждого узла — руководитель и сотрудники с точкой текущего статуса.
5. Актор раскрывает и сворачивает узлы («Развернуть всё» / «Свернуть всё» / «Сбросить фокус»), ищет по подразделениям, сотрудникам и должностям через строку поиска внутри дерева.
6. Актор нажимает на узел — система открывает модальное окно с карточкой подразделения: руководитель (звание, должность, статус с датами), список сотрудников, дочерние подразделения с переходом по клику.
7. Актор нажимает «Экспорт CSV» — система формирует файл `подразделения.csv` из строк таблицы шага 3 на клиенте.
8. На «Обзоре» (`/dashboard`) актор видит ту же структуру в виде доски `OrgBoard` (колонки по управлениям, ряды по должностям) из тех же двух запросов.

## Alternative Flow
- **AF1. Область не определена (400 от `/api/staff_unit/statistics/`)**: шаг 2 → плитки показывают «—», таблица не рисуется; `useStaffUnitStatistics` не повторяет запрос (`retryUnlessClientError`); отдельная плашка причины не выводится.
- **AF2. Нет права `orgstructure.view` (403 от `/api/staff_unit/staff-units/`)**: шаг 4 → `OrgChart` показывает текст ошибки и кнопку «Повторить»; дерево не строится.
- **AF3. Сбой сервера при запросе статистики**: шаг 2 → врезка `LoadFailure` «Не удалось загрузить статистику по структуре» с кнопкой повтора.
- **AF4. Штатных единиц в области нет**: шаг 4 → «Нет данных для отображения».
- **AF5. Нет корневого подразделения (`GET /api/divisions/divisions_tree/`)**: 404 «Корневое подразделение не найдено» — ручку читает только диалог прикомандирования (UC-STS-003), экран структуры её не зовёт.

## Изменения в системе
| Объект | Действие | Описание |
|---|---|---|
| `divisions`, `staff_units`, `employees` | read | Чтение дерева, штатных единиц и сотрудников области актора; счётчики считаются на лету по `StaffUnit.employee IS NULL / NOT NULL` |
| Файл `подразделения.csv` (браузер) | create | Клиентская выгрузка строк таблицы; серверной ручки выгрузки нет |

## Бизнес-требования (BR)
- **BR1.** Дерево подразделений — MPTT (`Division.parent`), типы узлов: организация, департамент, управление, отдел; имя уникально внутри родителя (`uq_division_name_per_parent`), код `code` уникален и генерируется автоматически (`DIV-XXXXXXXX`), если не задан.
- **BR2.** Область видимости — подразделения грантов права (`visible_division_ids`) вместе с потомками; отдельного разбора уровней нет (`apps/common/rbac.py`).
- **BR3.** Плитка «Занято» считает занятые слоты `StaffUnit` с сотрудником, «Вакансий» — слоты без сотрудника; сотрудник без штатной единицы в счётчики не попадает.
- **BR4.** Числа уровней вложены (управление включает свои отделы), строки таблицы в итог не складываются — об этом экран предупреждает подписью.
- **BR5.** Статистика открывается двумя правами — `status.view` или `orgstructure.view`; суперпользователь Django видит всё.
- **BR6.** Мягкое удаление подразделения (`DELETE /api/divisions/divisions/{id}/`) запрещено при наличии дочерних узлов или работающих сотрудников в ветке; перемещение (`POST …/move/`) — не в себя, не в потомка, глубина ≤ 5.
- **BR7.** Список `GET /api/core/divisions/` принимает `?type_code=<тип>`; неизвестный тип — 400 с перечнем допустимых.

## Требования к логированию
- Чтение структуры и статистики не логируется ничем, кроме `LogIPMiddleware` (`print` строки `Incoming Request: <method> <path> from IP`) и стандартного `django.server` в консоль.
- Правка подразделений через `/api/divisions/divisions/` (`POST`/`PUT`/`PATCH`/`DELETE`) попадает в `audit.AuditLog` через `AuditMiddleware` (`ContentType` `divisions.division` разрешается из пути; для `restore`/`move` — только при наличии `id` в ответе, у них его нет → запись не создаётся).
- Аудит просмотра структуры в `OpsAuditLog`: `Не реализовано в коде`.

## Требования к правам
| Роль | Доступ | Как обеспечивается |
|---|---|---|
| `ADMIN` | полный | `*` покрывает `orgstructure.view`; суперпользователь Django — ветка `is_superuser` в `StaffUnitViewSet.get_queryset` и `_statistics_scope` |
| Все роли с `*SECTION_READ` / `*OPS_READ` (`DIRECTORATE_HEAD`, `DEPARTMENT_EXPENSE_OFFICER`, `DUTY_OFFICER`, `EVENT_OFFICER`, `OPS_STAFF`, `PATROL_LEAD`, `GVO_LEAD`, `EVENT_APPROVER`, `DUTY_PLANNER`, `DUTY_PLAN_APPROVER`, `OBJECT_KEEPER`, `RATING_EVALUATOR`, `ANALYST`, `AUDITOR`, `HEAD_DIRECTORATE_LINE`, `HEAD_DEPARTMENT_LINE`, `HEAD_OPS_UNIT`, `FORCES_GATHERING_OFFICER`), `SECURITY_ADMIN`, `OVERVIEW_DEPARTMENT` | чтение | `orgstructure.view` → `CanViewStaffingTable` (`view_staffing_table` → `orgstructure.view` в `OPS_PERMISSION_BY_PORTAL`) для `/api/staff_unit/staff-units/`; `permission_map` `list`/`retrieve` → `orgstructure.view` в `apps/core/api/views.py`; `_statistics_scope` принимает `status.view` или `orgstructure.view` |
| `EMPLOYEE`, `EMPLOYEE_OPS_D2`, `REFERENCE_ADMIN`, `FEEDBACK_TRIAGE`, `INTEGRATION_USER`, `OM_CATEGORY_ORG`, `OPS_STAFF_COMMAND` | нет | нет `orgstructure.view` → 403 на штатных единицах; статистика — 400 «область не определена» (у `EMPLOYEE_OPS_D2`, `INTEGRATION_USER` есть `status.view`/`status.manage`, но не `orgstructure.view` → статистика открыта, дерево нет) |
| Любой вошедший | полный | `/api/divisions/divisions/` (CRUD, `restore`, `move`, `employees`) и `/api/divisions/divisions_tree/` закрыты только `IsAuthenticated` — кодов прав раздела нет |

## Требования к UX/UI
- Страница «Структура организации» (`/organization`), eyebrow «Личный состав», кнопка «Экспорт CSV» (заблокирована, пока статистика не загружена).
- Шесть плиток `StatCard`: значение «…» при загрузке, «—» при отсутствии данных; подписи «Занятых штатных единиц», «В зоне видимости пользователя», «Структур в выбранном департаменте», «Подразделений нижнего уровня», «Всего позиций в штатном расписании», «Свободных должностей».
- Карточка «Штат по подразделениям»: таблица «Подразделение» (с путём предков серым под именем), «Уровень», «Штат», «Занято» (зелёный), «Вакансий» (красный); рисуется только при непустом списке строк.
- Компонент `OrgChart`: кнопки «Развернуть всё», «Свернуть всё», «Сбросить фокус», «Повторить» (при ошибке); строка поиска «Поиск по подразделениям, сотрудникам и должностям…» с выпадающими совпадениями; состояния «Загрузка данных...», «Нет данных для отображения», текст ошибки.
- Модальное окно узла: тип (Руководство / Департамент / Управление), руководитель со званием, должностью, состоянием статуса (Запланирован / Активен / Завершен / Отменен) и датами, список сотрудников с точкой статуса, список дочерних подразделений с переходом, кнопки навигации и «Закрыть».
- «Обзор» (`/dashboard`): доска `OrgBoard` с кнопкой обновления; настоящая иерархия берётся из `/api/staff_unit/statistics/`.

## Открытые вопросы
- `lib/api.ts` содержит методы `getOrgChart()` → `GET /api/org-chart/` и `getDepartments()`/CRUD → `/api/departments/`, а `next.config.js` проксирует эти префиксы на бэкенд, но в `config/urls.py` таких маршрутов нет — вызовы дадут 404. Экран структуры их не использует (читает `/api/staff_unit/staff-units/` и `/api/staff_unit/statistics/`); методы и перезаписи — мёртвый код.
- Экран строится не из дерева `Division`, а из плоского списка штатных единиц (`convertStaffUnitsResponseToOrgUnit`): подразделения без штатных единиц в `OrgChart` не видны.
- `/api/divisions/divisions/` даёт полный CRUD, `restore` и `move` любому вошедшему без права `orgstructure.manage`; правки оргструктуры в UI нет.
- `GET /api/staff_unit/staff-units/` без `page` запрашивается с `page_size=500` — при большем штате дерево неполное (клиент страницы дальше не листает).
- Ручка статистики при отсутствии области отвечает 400, экран показывает прочерки без объяснения причины (в отличие от `/employees`, где есть `DirectorateAccessNotice`).
- Модель `Division` объявляет Django-permission `can_view_subordinate_departments`, в коде она нигде не проверяется.
