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

### Приоритет 1: Подготовка и фиксация поведения (Safeguarding)
* **STORY-000.1:** Интеграционное тестирование текущего API отчетов. Покрыть тестами `/api/reports/reports/expense/`, зафиксировать ожидаемый JSON/Excel выход.
* **STORY-000.2:** Рефакторинг структуры (Cookiecutter). Аккуратно адаптировать существующий код под целевую файловую структуру (без изменения бизнес-логики), настройка линтеров.

### Приоритет 2: Базовый фундамент (MVP-0 / MVP-1 Core)
* **STORY-001:** Bounded Context Isolation. Добавить AST-тесты, проверяющие, что модули не ссылаются друг на друга нелегально.
* **STORY-002 & STORY-003:** Внедрить `External JWT Middleware` и `PermissionService`. Заменить `user.role_info.get_user_division()` во viewsets на централизованные проверки прав.

### Приоритет 3: Ежедневный расход (MVP-1 Daily Expense)
* **STORY-010 & STORY-011:** Обновление моделей `Division` и `Employee`. Добавление leaf selector API и доработка интервалов истории переводов.
* **STORY-015:** Внедрение Daily update marks. Создать механизм ежедневной отметки (`Daily Mark`) для подразделений.
* **STORY-013 & STORY-014:** Доработка `EmployeeStatus` и добавление Bulk API (массовое обновление статусов оператором подразделения).
* **STORY-016 & STORY-017:** Адаптация отчетов. Рефакторинг `DataAggregator` под резолвер финального статуса VAPS и приведение Excel/Word отчетов к строгим контрактам из секции 77.

### Приоритет 4: Последующие фичи (После MVP-1)
* **STORY-040 - STORY-044:** Conduct & Archive (дашборды, инциденты).
* **STORY-050 - STORY-052:** Import/Export (загрузка легаси данных).
* Настройка feature flags (`DEPLOYMENT_STAGE=MVP_CORE`) и закрытого контура (отключение внешних рассылок).
