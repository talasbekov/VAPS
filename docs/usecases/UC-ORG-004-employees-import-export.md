# UC-ORG-004. Импортировать и выгрузить сотрудников

| Поле | Значение |
|---|---|
| Модуль | Оргструктура и кадры |
| Актор | Импорт — администратор стенда (management-команда, HTTP-актора нет); выгрузка — держатель `status.view` (читатель `/employees`); чтение карточек в контракте `/api/core/employees/` — держатель `personnel.view`; `ADMIN` |
| Статус | Partial |
| Основание | `apps/employees/models.py` (`Employee`, `EmployeeTransferHistory`), `apps/employees/management/commands/import_employees.py`, `apps/employees/tasks.py` (пять `pass`), `apps/employees/validators.py` (`iin_kz_validator`, TODO), `apps/employees/masking.py`, `apps/employees/api/{views,urls,serializers}.py` (роут `/api/employees/` закомментирован в `config/urls.py`), `apps/core/api/views.py` (`EmployeeViewSet`), `apps/core/api/serializers.py` (`EmployeeSerializer`), `apps/staff_unit/views.py` (`directorate_management`), FRONT `app/employees/page.tsx` (`exportCsv`), `app/organization/page.tsx` (`exportCsv`), `lib/api.ts` (`getStaffUnitsByDirectorate`) |
| Дата актуализации | 2026-09-08 |

## Цель
Актор загружает список сотрудников из файла в систему и выгружает текущий отбор сотрудников в файл.

## Предусловия
- Импорт: доступ к серверу с `manage.py`, CSV-файл в UTF-8 (BOM допустим) с разделителем `;` и колонками `FULL_NAME`, `IIN`.
- Выгрузка: актор вошёл в систему, открыт `/employees`, есть `status.view` и определена область (`directorate` отвечает 200).

## Main Flow
1. Администратор запускает `manage.py import_employees <csv_path>`.
2. Система читает файл построчно (`csv.DictReader`, `delimiter=";"`), пропускает строки без `FULL_NAME`.
3. Система разбирает ФИО по пробелам (фамилия, имя, остальное — отчество), дополняет ИИН нулями слева до 12 знаков, генерирует свободный табельный номер начиная с `001000`.
4. Система выполняет `Employee.objects.update_or_create(iin=…)`: по совпавшему ИИН обновляет ФИО и `is_active=True`, иначе создаёт сотрудника; выводит итог «Импорт завершён: создано N, обновлено M».
5. Сигнал `post_save` на `Employee` заводит новому сотруднику статус «В строю» (`ensure_active_status`, см. UC-STS-004).
6. Актор в портале открывает `/employees`, задаёт поиск, подразделение и статус, нажимает «Экспорт CSV».
7. Система запрашивает весь отбор без страницы (`GET /api/staff_unit/staff-units/directorate/` с теми же фильтрами), формирует `сотрудники.csv` (`;`, BOM, колонки «№», «ФИО», «Звание», «ИИН», «Должность», «Отдел», «Статус», «Статус с», «Дата найма», «Табельный номер») и отдаёт файл браузеру.
8. Внешние читатели получают кадровые карточки в донорском контракте `GET /api/core/employees/` (фильтры `division_id`, `status`, `rank_code`, `position_code`, `search`).

## Alternative Flow
- **AF1. Файл не найден**: шаг 1 → `Файл не найден: <путь>` в stdout, команда завершается без изменений.
- **AF2. Строка без ИИН**: шаг 4 → `iin=None`; `update_or_create(iin=None)` совпадает с первым сотрудником без ИИН — строка ОБНОВЛЯЕТ его вместо создания нового (см. «Открытые вопросы»).
- **AF3. Запрос всего отбора для экспорта не удался**: шаг 7 → `window.alert("Не удалось получить весь отбор — в файл ушла только показанная страница.")`, в файл уходят строки текущей страницы.
- **AF4. Нет `status.view` / область не определена**: шаг 6 → экран закрыт `DirectorateAccessNotice`, кнопки экспорта нет.
- **AF5. Нецелый `division_id` в `/api/core/employees/`**: шаг 8 → 400 `{"division_id": "должен быть целым числом"}`.
- **AF6. Ошибки формата CSV, дубли, неверный ИИН**: `Не реализовано в коде` (валидация ИИН на модель не навешана, дубли в файле перезаписывают друг друга).

## Изменения в системе
| Объект | Действие | Описание |
|---|---|---|
| `employees` (`Employee`) | create / update | Импорт: `personnel_number`, `last_name`, `first_name`, `middle_name`, `iin`, `is_active`; остальные поля — умолчания модели (`birth_date='1970-01-01'`, `hire_date='1970-01-01'`, `gender='M'`) |
| `employee_statuses` | create | Через сигнал `give_new_employee_a_status` — «В строю» новому сотруднику |
| Файл `сотрудники.csv` / `подразделения.csv` (браузер) | create | Клиентская сборка; сервер файлов не пишет |
| Очередь Celery (`export_employees_to_csv_task`, `export_employees_to_xlsx_task`) | — | `Не реализовано в коде`: тела задач — `pass` |
| `employee_transfers` (`EmployeeTransferHistory`) | — | Пишется только `POST /api/employees/employees/{id}/transfer/`, роут выключен |

## Бизнес-требования (BR)
- **BR1.** Ключ сопоставления при импорте — ИИН (уникален, `null` допустим); табельный номер (`personnel_number`, уникален) генерируется как первый свободный номер от `001000`.
- **BR2.** ИИН короче 12 знаков дополняется нулями слева; проверка контрольной суммы и даты рождения по ИИН — `Не реализовано в коде` (`iin_kz_validator` проверяет только 12 цифр и к полю модели не привязан: `validators=` на `Employee.iin` отсутствует).
- **BR3.** ФИО делится по пробелам: первое слово — фамилия, второе — имя, остальное — отчество.
- **BR4.** Выгрузка содержит ровно текущий отбор экрана (поиск, подразделение, статус) и уважает область актора (`directorate`); ИИН в файле — замаскированный (`iinMasked`, `apps/employees/masking.py`).
- **BR5.** Файл выгрузки — CSV с BOM и разделителем `;` (для Excel); XLSX — `Не реализовано в коде`.
- **BR6.** Статус занятости сотрудника — `employment_status` (`WORKING` / `FIRED` …), увольнение закрывает активные и отменяет запланированные статусы (сигнал `close_statuses_on_dismissal`); удаление сотрудника через API запрещено (405 «Используйте увольнение») — роут выключен.
- **BR7.** Контракт `/api/core/employees/` только чтение; поля `external_id`, `phone`, `height_cm`, `is_attached_force`, `data_source` всегда `null`; `full_name` собирается сериализатором; `division` — из штатной единицы.

## Требования к логированию
- Импорт: только `stdout` команды (`Файл не найден`, `Импорт завершён: создано N, обновлено M`); построчные ошибки не логируются; `logging` не используется.
- Экспорт: ничего не логируется (клиентская операция); `audit_service.SUBMISSION_EXPORTED` относится к выгрузке расхода, не к списку сотрудников.
- Создание/правка сотрудников через `directorate` (UC-ORG-002) — `Не реализовано в коде` (`AuditMiddleware` не разрешает `ContentType`, `audit_service` не зовётся).
- Что должно логироваться, но не логируется: кто, когда и какой файл импортировал; сколько строк отброшено; факт выгрузки персональных данных — `Не реализовано в коде`.

## Требования к правам
| Роль | Доступ | Как обеспечивается |
|---|---|---|
| Администратор стенда (shell) | импорт | Management-команда без проверки прав |
| `ADMIN` | полный | `*` |
| Держатели `status.view` (`EMPLOYEE`, `DIRECTORATE_HEAD`, `DEPARTMENT_EXPENSE_OFFICER`, `DUTY_OFFICER`, `OPS_STAFF`, `DUTY_PLANNER`, `ANALYST`, `AUDITOR`, `HEAD_DIRECTORATE_LINE`, `HEAD_DEPARTMENT_LINE`, `HEAD_OPS_UNIT`, `EMPLOYEE_OPS_D2`, `FORCES_GATHERING_OFFICER`) | выгрузка CSV с `/employees` | `CanReadDirectorate` (`status.view`) на `directorate`; кнопка видна всем, у кого открыт экран |
| Держатели `personnel.view` (`*SECTION_READ`, `SECURITY_ADMIN`, `OM_CATEGORY_ORG`) | чтение `/api/core/employees/` | `permission_map` → `personnel.view` |
| Держатели `orgstructure.manage` | создание/правка сотрудников через `directorate` POST/PUT | `check_permission(user, 'create_staffing_position'/'edit_staffing_position')` (UC-ORG-002) |
| Любой вошедший | CRUD `/api/employees/employees/`, `transfer`, `dismiss`, `history` | `Не реализовано в коде`: роут закомментирован в `config/urls.py`; в `EmployeeViewSet.get_permissions` все ветки — `IsAuthenticated` |

## Требования к UX/UI
- Импорт: `Нет пользовательского интерфейса` (кнопка «Импорт» на `/employees` удалена — у неё не было обработчика, комментарий в `page.tsx:877`).
- Экспорт: кнопка «Экспорт CSV» на странице «Сотрудники» (`/employees`, над фильтрами; текст «Собираем файл…» и `disabled` пока `exporting`); при отказе полного отбора — системный `alert`. Кнопка «Экспорт CSV» на «Структуре организации» (`/organization`) — выгрузка таблицы подразделений (UC-ORG-001).
- Таблица `EmployeeTable` (колонки «№», «ФИО», «Должность», «Отдел», «Статус», «Статус с», «Дата найма») — источник строк для файла; фильтры: поиск, отдел, статус.

## Открытые вопросы
- `update_or_create(iin=None)` для строк без ИИН: все такие строки файла обновляют одного и того же сотрудника без ИИН (или первого найденного), новые не создаются — импорт теряет людей без ИИН.
- Табельный номер генерируется и для обновляемого сотрудника (`defaults` содержит `personnel_number`) — при повторном импорте у существующих меняется табельный.
- `iin_kz_validator` импортирован в `models.py`, но не применён к полю `iin` (TODO в `validators.py`: «minimal test-restored implementation»); ИИН любой длины/содержимого принимается через `directorate` POST.
- Пять задач Celery в `apps/employees/tasks.py` (`copy_statuses_task`, `check_status_updates_task`, `reset_default_statuses_task`, `export_employees_to_csv_task`, `export_employees_to_xlsx_task`) — `pass` с TODO; серверная выгрузка не существует.
- Роут `/api/employees/` закомментирован в `config/urls.py`: перевод (`transfer` с `EmployeeTransferHistory`), увольнение (`dismiss`), история (`history`) недоступны по HTTP; `next.config.js` при этом проксирует `/api/employees/*`.
- Клиентская выгрузка обходит серверный аудит: факт выгрузки персональных данных (ФИО, ИИН пусть и маскированный, дата найма) нигде не фиксируется.
- Умолчания модели `birth_date='1970-01-01'`, `hire_date='1970-01-01'`, `personnel_number='000000'` попадают в импортированных сотрудников как настоящие значения.
