# UC-STS-002. Просмотреть календарь статусов

| Поле | Значение |
|---|---|
| Модуль | Статусы и дежурства |
| Актор | Держатель `status.view` (`EMPLOYEE`, `DIRECTORATE_HEAD`, `DEPARTMENT_EXPENSE_OFFICER`, `DUTY_OFFICER`, `OPS_STAFF`, `DUTY_PLANNER`, `ANALYST`, `AUDITOR`, `HEAD_DIRECTORATE_LINE`, `HEAD_DEPARTMENT_LINE`, `HEAD_OPS_UNIT`, `EMPLOYEE_OPS_D2`, `FORCES_GATHERING_OFFICER`), `ADMIN` |
| Статус | Partial |
| Основание | `apps/ops/api/views_status_calendar.py` (`OpsStatusCalendarViewSet`: `month`, `day`), `apps/ops/status_calendar.py` (`parse_month`, `month_page`, `day_panel`, `MAX_PAGE_SIZE`, `MAX_GROUP_EMPLOYEES`), `apps/ops/api/urls.py` (`status-calendar`), FRONT `widgets/status-calendar/ui/{StatusCalendarBoard,StatusMonthGrid,StatusDayPanel,StatusMatrix}.tsx`, `hooks/use-status-calendar.ts`, `entities/status-calendar/index.ts`, `app/statuses/page.tsx` (вкладка `calendar`), `shared/config/in-development.ts` (`/statuses`, №427) |
| Дата актуализации | 2026-09-08 |

## Цель
Актор видит по дням месяца, кто из сотрудников его области в каком статусе, и раскрывает состав на выбранный день.

## Предусловия
- Актор вошёл в систему; есть `status.view` с областью хотя бы на одно подразделение.
- Экран `/statuses` открыт (ручка `directorate` ответила 200 — иначе страница целиком закрыта `DirectorateAccessNotice`).
- Строки статусов раздела (`OpsEmployeeStatus`) и канонический справочник типов заполнены.

## Main Flow
1. Актор открывает `/statuses`, вкладку «Календарь статусов».
2. Система запрашивает `GET /api/ops/status-calendar/month/?month=ГГГГ-ММ` за текущий месяц и показывает сетку дней с кодами статусов по дням (`StatusMonthGrid`) — с ведущими пустыми клетками до первого дня недели.
3. Актор листает месяцы стрелками — система перезапрашивает месяц.
4. Актор нажимает на день — система запрашивает `GET /api/ops/status-calendar/day/?date=ГГГГ-ММ-ДД` и показывает панель дня (`StatusDayPanel`): группы по типу статуса со списком сотрудников (ФИО, подразделение).
5. Актор переключается на вкладку «Матрица» — система показывает `StatusMatrix`: строки — сотрудники области (страницами по `page_size`, не больше 100), колонки — дни месяца, ячейки — код статуса.
6. Актор листает страницы матрицы и месяцы.

## Alternative Flow
- **AF1. Нет `status.view`**: шаги 2, 4 → 403 (`permission_map` `month`/`day` → `status.view`); вкладка недоступна, так как страница закрыта раньше (`DirectorateAccessNotice`).
- **AF2. Неверный формат месяца / даты**: 400 `{"month": "Ожидается месяц в формате ГГГГ-ММ."}` / `{"date": "Укажите дату в формате ГГГГ-ММ-ДД."}` — клиент собирает значения сам, актор их не вводит.
- **AF3. `division_id` вне области**: `_resolve_division_scope` отвечает 403 (подразделение не в области) — клиент `division_id` не передаёт (`divisionId = null`).
- **AF4. Сбой запроса месяца или дня**: врезка `LoadFailure` с кнопкой повтора (`isFetching` показывает процесс).
- **AF5. В группе дня больше 200 сотрудников**: список группы обрезается на `MAX_GROUP_EMPLOYEES` = 200.

## Изменения в системе
| Объект | Действие | Описание |
|---|---|---|
| `ops_employee_statuses`, `employees`, `staff_units`, `operations.StatusType` | read | Сборка календаря по области актора; ничего не пишется |

## Бизнес-требования (BR)
- **BR1.** Календарь строится по строкам раздела `OpsEmployeeStatus` и каноническому справочнику (`operations.StatusType`), не по кадровым `statuses.EmployeeStatus`.
- **BR2.** Область — подразделения гранта `status.view` с потомками (`_resolve_division_scope`); параметр `division_id` сужает выборку только внутри области.
- **BR3.** Страница матрицы — `page`/`page_size`, `page_size` зажимается в `[1, 100]` (`MAX_PAGE_SIZE`); ответ несёт `page_size` и сводку месяца (`month_summary`).
- **BR4.** Панель дня группирует сотрудников по типу статуса (`_group_of` по каталогу) и режет группу на 200 человек.
- **BR5.** Месяц принимается только в формате `ГГГГ-ММ`, дата — `ГГГГ-ММ-ДД`; иное — 400.

## Требования к логированию
- Чтение календаря не логируется, кроме `LogIPMiddleware` (`print`) и `django.request` при 4xx/5xx.
- `OpsAuditLog` / `audit.AuditLog` для просмотра календаря: `Не реализовано в коде`.

## Требования к правам
| Роль | Доступ | Как обеспечивается |
|---|---|---|
| `ADMIN` | чтение | `*` |
| Держатели `status.view` (`EMPLOYEE`, `DIRECTORATE_HEAD`, `DEPARTMENT_EXPENSE_OFFICER`, `DUTY_OFFICER`, `OPS_STAFF`, `DUTY_PLANNER`, `ANALYST`, `AUDITOR`, `HEAD_DIRECTORATE_LINE`, `HEAD_DEPARTMENT_LINE`, `HEAD_OPS_UNIT`, `EMPLOYEE_OPS_D2`, `FORCES_GATHERING_OFFICER`) | чтение в области | `permission_map = {"month": "status.view", "day": "status.view"}` (`RequirePermissionMixin`), `_resolve_division_scope(request, division_id, "status.view")` |
| `INTEGRATION_USER` (только `status.manage`) и остальные роли без `status.view` | нет | 403 |

## Требования к UX/UI
- Вкладка «Календарь статусов» на странице `/statuses` (метка страницы «В разработке … (№427)»); внутри — `Tabs` «Месяц» / «Матрица».
- «Месяц»: сетка `StatusMonthGrid` (заголовок «<Месяц> <год>», стрелки перелистывания, клетки дней с кодами статусов, выделение выбранного дня) и панель `StatusDayPanel` справа (на узком экране — снизу): дата словами («8 сентября 2026»), группы по статусам, список сотрудников; состояния загрузки и `LoadFailure`.
- «Матрица»: таблица сотрудник × день с кодами, переключение месяца и страниц; `LoadFailure` с повтором.
- Фильтр по подразделению в календаре: `Не реализовано в коде` (проп `divisionId` есть у обоих компонентов, `StatusCalendarBoard` его не передаёт).
- Легенда цветов/кодов статусов, всплывающие подсказки по ячейкам: `Не определено в коде`.

## Открытые вопросы
- Из `in-development.ts` для `/statuses`: «„Участие в ОМ“ только из запроса, колонка „По разделу ОМ“, „ознакомлен“ (№427)» — метка стоит на всей странице, включая календарь.
- Календарь читает только строки раздела `OpsEmployeeStatus`; кадровые статусы (`statuses.EmployeeStatus`), которые ставят диалоги `/statuses`, в календаре не видны, если не продублированы в разделе.
- Фильтр подразделения поддержан сервером (`division_id`), но не выведен в UI.
- Обрезание групп дня на 200 человек и страниц матрицы на 100 никак не сообщается актору.
- В календаре нет перехода к правке статуса (UC-STS-001) — только просмотр.
