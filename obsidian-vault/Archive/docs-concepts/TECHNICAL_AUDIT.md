# Технический аудит проекта (на базе VAPS v7.8.2)

## 1. Current project structure

Структура проекта основана на Django + DRF, используется Celery для асинхронных задач и Redis как брокер/кэш.

* **Какие apps есть:** Все основные приложения сгруппированы в директории `organization_management/apps/`. Существующие приложения: `common`, `divisions`, `employees`, `statuses`, `secondments`, `reports`, `notifications`, `audit`, `dictionaries`, `staff_unit`.
* **Где settings:** Файлы настроек находятся в `organization_management/config/settings/` (`base.py`, `production.py` и т.д.).
* **Где urls:** Главный роутер находится в `organization_management/config/urls.py`, который подключает эндпоинты из `apps/<app_name>/api/urls.py`.
* **Где models:** Внутри каждого приложения, иногда вынесены в `domain/models.py` (например, `apps/reports/domain/models.py`), либо просто в `apps/<app_name>/models.py`.
* **Где serializers:** Расположены в `api/serializers.py` для каждого приложения.
* **Где views/viewsets:** Расположены в `api/views.py` или `views.py` внутри приложений.
* **Где services:** Бизнес-логика частично вынесена в `application/services.py` (например, в `reports`) или в папку `services` (как в `notifications/services`).
* **Где tasks:** В файлах `tasks.py` (например, `apps/reports/tasks.py`, `apps/statuses/tasks.py`, `apps/employees/tasks.py`).
* **Где reports/docx/xlsx/pdf generation:** В приложении `reports`:
  * Инфраструктурный слой: `infrastructure/generators/docx_generator.py`, `xlsx_generator.py`, `pdf_generator.py`.
  * Сбор данных: `infrastructure/data_aggregator.py`.
  * Утилиты синхронной генерации: `utils.py`.
* **Где tests:** Глобальные тесты лежат в `tests/` (unit, fixtures), а также внутри приложений: `apps/employees/tests/` (разбиты на `api`, `integration`, `unit`).
* **Где Docker/deployment:** В корне проекта находится `docker-compose.yml`. Скрипты инициализации и Dockerfile находятся в `docker/` и корне проекта.

---

## 2. Existing daily expense implementation

Текущая реализация "Ежедневного расхода" частично готова и функционирует:

* **Какие модели используются:**
  * `Division` (используется библиотека `django-mptt` для иерархии).
  * `StaffUnit` (штатные единицы).
  * `Employee` (сотрудники).
  * `EmployeeStatus` (статусы сотрудников).
  * `Report` (управление фоновыми задачами генерации).
* **Какие endpoints есть:**
  * `GET /api/reports/reports/expense/<department_id>/` — синхронная генерация отчета в Excel (`XLSX`).
  * `POST /api/reports/reports/generate/` — запуск асинхронной задачи генерации (создает объект Report).
  * `GET /api/reports/reports/<id>/status/` и `/download/` — проверка и скачивание асинхронного отчета.
* **Какая логика расчёта расхода:**
  В файле `apps/reports/utils.py` идет проход по древовидной структуре (управлениям/директоратам). С помощью метода `get_descendants(include_self=True)` собираются дочерние подразделения. Далее подсчитываются: штатные единицы, вакансии (где `employee__isnull=True`), сотрудники в строю и сотрудники в других активных статусах (`state=ACTIVE`).
* **Какие статусы поддерживаются:**
  `VACATION` (отпуск), `BUSINESS_TRIP` (командировка), `SICK_LEAVE` (больничный), `ON_DUTY` (дежурство), `AFTER_DUTY` (отдых после дежурства), `TRAINING` (учеба), `COMPETITION` (соревнования), `SECONDED_FROM` (прикомандирован), `SECONDED_TO` (откомандирован), `IN_SERVICE` (в строю), `LEAVE_BY_REPORT` (увольнение).
* **Как определяется обновление подразделения:**
  Через фильтрацию связей `employee__staff_unit__division_id__in`. Ежедневных отметок (Daily marks) как отдельной сущности нет, логика строится на "текущих" активных статусах.
* **Как генерируется DOCX/XLSX/PDF:**
  * Синхронно (Excel): Через `openpyxl` в `utils.py`. Заполняется таблица с подсчетом количества и списком ФИО в примечаниях.
  * Асинхронно: Через Celery, сбор данных осуществляет `DataAggregator`, затем передает в `DOCXGenerator`/`XLSXGenerator`/`PDFGenerator`, которые формируют байтовый буфер и сохраняют в поле файла модели `Report`.
* **Какие баги или риски видны:**
  * Синхронная генерация (`expense`) по всему департаменту может вызывать TimeOut на больших данных, так как выполняется множество `COUNT()` SQL-запросов в цикле.
  * Структура отчета (визуальная) может не в полной мере соответствовать секции 77 из VAPS v7.8.2.
  * Ролевая модель жестко завязана на свойство `user.role_info.get_user_division()` в ViewSet'ах, что не соответствует абстракции `PermissionService`.

---

## 3. Existing vs VAPS v7.8.2 comparison

| Requirement (v7.8.2) | Existing implementation | Status | What to keep | What to refactor | What to add |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **STORY-001**: Project skeleton | Приложения изолированы, настройки вынесены. | Compatible | Текущую структуру `apps/`. | Подвести под clean architecture, если требуется. | Тесты изоляции контекстов (AST-тесты). |
| **STORY-002**: External JWT | `SimpleJWT` используется, но нет проверки внешних токенов по стандарту VAPS. | Partial | JWT аутентификацию. | Мидлвари авторизации (коды `401 AUTH_REQUIRED`, `403`). | Identity extraction (извлечение `sub`). |
| **STORY-003**: RBAC / Permissions | Хардкод проверок (`user_division.get_descendants`) прямо во views. | Partial | Ограничение зон ответственности. | Вынести проверки в `PermissionService`. | Модели ролей (Roles) и политик (Permissions). |
| **STORY-010**: Core divisions | `Division` использует `MPTTModel`. | Compatible | Модель `Division` и иерархию. | — | Рекурсивный выбор листов (leaf selector) SQL. |
| **STORY-011**: Employees & histories | `Employee`, `EmployeeTransferHistory` присутствуют. | Partial | Существующие таблицы. | Логику закрытия/открытия интервалов истории при переводе. | — |
| **STORY-012**: Staffing slots / vacancies | `StaffUnit`, вакансия считается как слот без `Employee`. | Compatible | Модель `StaffUnit`. | — | Фиксированную историческую калькуляцию (Historical state). |
| **STORY-013**: Employee statuses | `EmployeeStatus` (ACTIVE/PLANNED), `StatusChangeHistory`. | Compatible | Модели статусов и Celery задачи уведомлений. | Строгую валидацию переходов (transitions). | Bulk update API (STORY-014). |
| **STORY-015**: Daily update marks | Отсутствует. Расход считается по текущему срезу. | Missing | — | — | Отметки подразделений (Daily Marks) и статус-замки. |
| **STORY-016/017**: Daily report generators | Есть DataAggregator, docx/xlsx/pdf генераторы (celery + sync). | Partial | Генераторы файлов и асинхронные задачи. | Оптимизировать N+1 запросы в цикле генерации. | Точный контракт DOCX/XLSX (секция 77), резолвер конечного статуса. |

---

## 4. Migration risks

* **Что может сломаться:**
  Переход на строгий RBAC (`PermissionService`) может закрыть доступ к существующим эндпоинтам. Замена или оптимизация `django-mptt` на рекурсивные CTE нарушит вызовы `get_descendants()` во всем коде.
* **Какие миграции опасные:**
  Любые структурные изменения в моделях `EmployeeStatus` и `StaffUnit`. Текущая история переводов может стать невалидной, если изменить правила закрытия интервалов.
* **Какие модули нельзя трогать первыми:**
  `reports` (генераторы) и логика расчетов — они жестко зависят от моделей `EmployeeStatus` и `Division`. До стабилизации базового слоя (models & permissions), переписывать генераторы нельзя.
* **Что нужно покрыть тестами перед изменением:**
  Критически важно написать unit/интеграционные тесты на `/api/reports/reports/expense/` и `apps.reports.utils.generate_personnel_expense_report`, чтобы гарантировать сохранение бизнес-логики расчета при рефакторинге.

---

## 5. Recommended next stories

Дальнейшая работа разбита по приоритетам с упором на сохранение рабочей бизнес-логики.

**Важное правило выполнения:**
Не удалять, не переименовывать и не перемещать существующий код до тех пор, пока не будут добавлены и успешно пройдены тесты. Каждое изменение должно сохранять текущее поведение рабочего ежедневного расхода, если только спецификация VAPS v7.8.2 явно не требует обратного.

### Приоритет 1: Подготовка и фиксация поведения (Safeguard current behavior)
* **STORY-000.1 — Golden master tests for current daily expense:**
  Создать интеграционные/юнит-тесты, фиксирующие текущее поведение:
  * `GET /api/reports/reports/expense/<department_id>/`
  * `generate_personnel_expense_report`
  * Логику подсчета статусов и вакансий.
  * Агрегацию потомков подразделений (`division descendant aggregation`).
  * Структуру XLSX (достаточную для обнаружения регрессий).
  *Не рефакторить логику отчетов до прохождения этих тестов.*
* **STORY-000.2 — Architecture and dependency mapping:**
  Анализ зависимостей и подготовка безопасной карты рефакторинга без изменения поведения:
  * Построить карту текущих импортов между приложениями (apps).
  * Выявить нелегальные/рискованные межмодульные зависимости (cross-app dependencies).
  * Найти места, где бизнес-логика смешана с views.
  * Найти переиспользуемые сервисы для извлечения.
  *Не перемещать файлы, не переименовывать apps, не менять модели. План миграции составляется только после прохождения тестов.*
* **STORY-000.3 — Query performance audit for daily expense:**
  Поиск N+1 запросов и повторных вызовов `COUNT()` внутри циклов. Предложить оптимизированную агрегацию, но не переписывать код до появления тестов.

### Приоритет 2: Базовый фундамент (Core architecture without breaking behavior)
* **STORY-001 — Bounded Context Isolation:**
  Внедрение AST/import тестов, начиная в режиме предупреждений/отчетов (warning/report mode), а не в строгом failing режиме, так как проект уже может содержать cross-app imports.
* **STORY-002 — External JWT:** Внедрить поддержку внешних токенов.
* **STORY-003 — PermissionService:** Централизовать права доступа (`PermissionService`), но сохранить текущее поведение (`user.role_info.get_user_division()`), пока замена не будет покрыта тестами.

### Приоритет 3: Ежедневный расход (MVP-1 Daily Expense)
* **STORY-010:** Divisions / leaf selector.
* **STORY-011:** Employees and transfer history intervals.
* **STORY-013:** Status transitions (строгая валидация).
* **STORY-014:** Bulk status update API.
* **STORY-015:** Daily Marks design and implementation.
  *Перед реализацией необходимо написать дизайн-документ `DAILY_MARKS_DESIGN.md`*, объясняющий:
  * Почему текущего расчета по active-status недостаточно.
  * Что хранит сущность Daily Mark.
  * Кто может отмечать подразделение.
  * Ставятся ли отметки на департамент/управление/отдел.
  * Как отметки влияют на итоговый расход.
  * Что происходит, если отметка отсутствует.
  * Как работают статус-замки.
  * Взаимодействие с существующей `EmployeeStatus`.
* **STORY-016/017:** Report contract adaptation.
  *Перед изменением генерации DOCX/XLSX/PDF составить документ `REPORT_CONTRACT_GAP.md`*, содержащий сравнение текущего вывода с секцией 77:
  * Существующие vs обязательные колонки.
  * Недостающие поля, несовпадения в формулах.
  * Визуальные отличия.
  * Требуемые изменения для XLSX и DOCX.
  * Является ли PDF частью MVP-1 или post-MVP.

### Приоритет 4: Последующие фичи (After MVP-1)
* **Archive / Conduct modules** (дашборды, инциденты).
* **Import / Export** (фреймворк легаси-данных).
* **Audit hardening**.
* **Notifications** (in-app, email/sms выключены в MVP_CORE).
* **Production hardening** (оптимизации, feature flags).
