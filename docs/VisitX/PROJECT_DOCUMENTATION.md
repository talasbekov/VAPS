# Документация проекта "Personnel Records"

## Оглавление
1. [Общая информация](#общая-информация)
2. [Архитектура проекта](#архитектура-проекта)
3. [Назначение системы](#назначение-системы)
4. [Функциональные модули](#функциональные-модули)
5. [Технологический стек](#технологический-стек)
6. [Модели данных](#модели-данных)
7. [API Endpoints](#api-endpoints)
8. [Бизнес-логика и автоматизация](#бизнес-логика-и-автоматизация)
9. [Безопасность и производительность](#безопасность-и-производительность)
10. [Развертывание](#развертывание)

---

## Общая информация

**Название:** Personnel Records (Система управления кадровым учетом)

**Тип:** Полнофункциональное веб-приложение

**Описание:** Комплексная система для управления персоналом, штатным расписанием и организационной структурой предприятия с иерархическими подразделениями.

**Структура проекта:**
- **Backend:** Django REST Framework приложение (`Personnel-Records/`)
- **Frontend:** Next.js 15 приложение с TypeScript (`PersonalRecordFront/`)

---

## Архитектура проекта

### Backend: Django REST Framework

**Архитектурный паттерн:** Domain-Driven Design (DDD)

**Ключевые компоненты:**
- Модульная архитектура с отдельными Django приложениями
- PostgreSQL для production, SQLite для development
- Celery + Redis для асинхронных задач и планировщика
- Django Channels + WebSocket для real-time уведомлений
- RESTful API с автоматической документацией (Swagger/OpenAPI)

**Структура Django приложений:**
```
organization_management/
├── apps/
│   ├── employees/         # Управление сотрудниками
│   ├── divisions/         # Подразделения
│   ├── statuses/          # Статусы сотрудников
│   ├── staff_unit/        # Штатное расписание
│   ├── dictionaries/      # Справочники
│   ├── secondments/       # Прикомандирование
│   ├── reports/           # Отчеты
│   ├── notifications/     # Уведомления
│   ├── audit/             # Аудит действий
│   └── common/            # Общие компоненты
├── config/                # Настройки проекта
└── static/                # Статические файлы
```

### Frontend: Next.js 15

**Архитектурный паттерн:** Feature-Sliced Design (FSD)

**Ключевые компоненты:**
- Next.js 15 App Router
- React 19 с TypeScript
- Tailwind CSS + shadcn/ui компоненты
- React Query для управления состоянием сервера
- NextAuth.js + JWT для аутентификации
- Standalone mode для Docker развертывания

**Структура FSD:**
```
PersonalRecordFront/
├── app/                   # Страницы (Next.js App Router)
├── features/              # Функциональные модули
├── entities/              # Доменные сущности
├── shared/                # Общие ресурсы
├── widgets/               # Композитные компоненты
└── components/            # UI компоненты
```

---

## Назначение системы

### Основные функции

#### 1. Управление персоналом
- **Учет сотрудников** с полными личными данными (ФИО, дата рождения, ИИН, фото, контакты)
- **История кадровых перемещений** (переводы между подразделениями, увольнения)
- **Управление статусами** сотрудников:
  - В строю (основной статус)
  - Отпуска (очередной, учебный, без содержания и др.)
  - Больничные
  - Командировки
  - Учеба
  - Прикомандирование
- **Табельные номера** с автоматической генерацией
- **Звания и должности** сотрудников

#### 2. Штатное расписание
- **Управление штатными единицами** (слотами) по подразделениям
- **Связь сотрудник ↔ штатная единица** (один сотрудник = одна штатная единица)
- **Управление вакансиями** с указанием причин
- **Статистика** по штатному расписанию:
  - Количество штатных единиц
  - Количество занятых позиций
  - Количество вакансий
  - Процент заполненности

#### 3. Организационная структура
- **Иерархия подразделений** с 4 уровнями:
  - Организация (верхний уровень)
  - Департамент
  - Управление (Directorate)
  - Отдел (Division)
- **Визуализация оргструктуры** в виде дерева и доски
- **Активация/архивация** подразделений
- **Управление иерархией** через MPTT (Modified Preorder Tree Traversal)

#### 4. Автоматизация процессов
- **Автоматическое применение** запланированных статусов
- **Автоматическое завершение** истекших статусов
- **Уведомления** о предстоящих событиях:
  - За 7 дней до начала статуса
  - За 3 дня до завершения статуса
- **Real-time уведомления** через WebSocket

#### 5. Отчетность
- **Генерация отчетов** в форматах DOCX, XLSX, PDF:
  - Расход личного состава
  - Отчет по подразделению
  - Штатное расписание
  - Сводка по статусам
- **Асинхронная генерация** больших отчетов через Celery
- **История отчетов** с возможностью скачивания

#### 6. Прикомандирование
- **Запросы на прикомандирование** сотрудников в другие подразделения
- **Workflow одобрения** (ожидание → одобрено/отклонено/отменено)
- **Автоматическое создание** парных статусов (откомандирован/прикомандирован)

---

## Функциональные модули

### Backend модули

#### employees - Управление сотрудниками
**Модели:**
- `Employee` - основная информация о сотруднике
- `EmployeeTransferHistory` - история переводов и увольнений

**Функции:**
- CRUD операции над сотрудниками
- Валидация ИИН (казахстанский идентификационный номер)
- Автоматическая генерация табельных номеров
- Связь с User для аутентификации
- История кадровых перемещений
- Управление статусом занятости (working/fired)

**API:** `/api/employees/`

#### divisions - Подразделения
**Модели:**
- `Division` - подразделение (с MPTT для иерархии)

**Функции:**
- Иерархическая древовидная структура
- 4 типа подразделений: organization, department, directorate, division
- Активация/архивация подразделений
- Построение дерева подразделений
- Уникальные коды подразделений

**API:** `/api/divisions/`

#### statuses - Статусы сотрудников
**Модели:**
- `EmployeeStatus` - текущий и запланированные статусы
- `StatusChangeHistory` - история изменений

**Функции:**
- Управление состоянием статусов (planned → active → completed/cancelled)
- Иерархические типы статусов
- Валидация пересечений статусов по датам
- Автоматическое завершение конфликтующих статусов
- Продление и досрочное завершение статусов
- Отмена запланированных статусов
- История всех изменений

**API:** `/api/statuses/`

**Celery задачи (автоматические):**
- `apply_planned_statuses` (09:05) - активация запланированных
- `complete_expired_statuses` (09:10) - завершение истекших
- `send_upcoming_status_notifications` (09:12) - уведомления за 7 дней
- `send_ending_status_notifications` (09:15) - уведомления за 3 дня

#### staff_unit - Штатное расписание
**Модели:**
- `StaffUnit` - штатная единица (слот)
- `Vacancy` - вакансия

**Функции:**
- Связь слотов с подразделениями и должностями
- OneToOne связь с сотрудниками
- Управление вакансиями с причинами
- Статистика по подразделениям
- Массовые операции (создание/обновление штатных единиц)
- Иерархическая структура штатного расписания

**API:** `/api/staff_unit/`

#### dictionaries - Справочники
**Модели:**
- `Position` - должности с уровнями
- `StatusType` - типы статусов (иерархические)
- `Rank` - звания
- `DismissalReason` - причины увольнения
- `TransferReason` - причины перевода
- `VacancyReason` - причины открытия вакансии
- `EducationType` - типы образования
- `DocumentType` - типы документов
- `SystemSetting` - системные настройки
- `Feedback` - обратная связь

**API:** `/api/dictionaries/`

#### secondments - Прикомандирование
**Модели:**
- `SecondmentRequest` - запрос на прикомандирование

**Функции:**
- Запросы на перемещение между подразделениями
- Workflow: pending → approved/rejected/cancelled
- Автоматическое создание статусов при одобрении
- Валидация (нельзя прикомандировать в свое же подразделение)

**API:** `/api/secondments/`

#### reports - Отчеты
**Модели:**
- `Report` - сгенерированный отчет

**Функции:**
- Генерация отчетов в форматах DOCX, XLSX, PDF
- 4 типа отчетов:
  - `personnel_roster` - расход личного состава
  - `division_report` - отчет по подразделению
  - `staffing_table` - штатное расписание
  - `status_summary` - сводка по статусам
- Асинхронная генерация через Celery
- Хранение файлов отчетов
- Отслеживание статуса генерации

**API:** `/api/reports/`

**Celery задачи:**
- `generate_report_task` - генерация отчета в фоне

#### notifications - Уведомления
**Модели:**
- `Notification` - уведомление пользователя

**Функции:**
- Real-time уведомления через WebSocket
- Типы уведомлений:
  - Изменение статуса
  - Запросы на прикомандирование
  - Готовность отчетов
- Отслеживание прочитанности
- Payload для дополнительных данных
- Связь с объектами через GenericForeignKey

**API:** `/api/notifications/`

**WebSocket:** `ws://localhost:8000/ws/notifications/`

#### audit - Аудит
**Модели:**
- `AuditEntry` - запись аудита

**Функции:**
- Автоматическое логирование всех API запросов
- Middleware для перехвата запросов
- Сохранение: метода, URL, body, статуса ответа, IP адреса
- Исключение админки из логирования

**Middleware:** `AuditMiddleware`

#### common - Общие компоненты
**Функции:**
- JWT сериализаторы для токенов
- Пагинация (50 записей по умолчанию)
- IP логирование
- Общие утилиты
- Профиль пользователя
- Смена пароля

**API:** `/api/common/`

### Frontend модули

#### Страницы (app/)
- `/` - Страница входа с анимацией
- `/dashboard` - Главная панель с:
  - Статистика по статусам
  - Календарь событий
  - График статусов
- `/organization` - Оргструктура и штатное расписание
- `/employees` - Управление сотрудниками
- `/statuses` - Управление статусами
- `/reports` - Генерация и скачивание отчетов
- `/feedback` - Обратная связь

#### Функциональные модули (features/)
- `add-employee/` - Форма добавления сотрудников
- `edit-profile/` - Редактирование профиля
- `employee-status-update/` - Обновление статусов:
  - Одиночное обновление
  - Массовое обновление
- `organization-structure/` - Визуализация оргструктуры:
  - Древовидное представление
  - Доска с карточками
- `secondment-requests/` - Управление прикомандированиями
- `notifications/` - Dropdown с уведомлениями
- `feedback-chat/` - Чат обратной связи
- `send-feedback/` - Форма отправки обратной связи

#### UI компоненты (components/)
- shadcn/ui компоненты (35+ компонентов Radix UI)
- Кастомные компоненты
- Тема (светлая/темная)

---

## Технологический стек

### Backend

#### Core Framework
- **Django** 5.2.4
- **Django REST Framework** 3.16.0
- **Python** 3.x

#### База данных и ORM
- **PostgreSQL** (production)
- **SQLite** (development)
- **psycopg2-binary** 2.9.10

#### Асинхронность и очереди
- **Celery** 5.5.3 - асинхронные задачи
- **django-celery-beat** 2.8.1 - периодические задачи
- **django-celery-results** 2.6.0 - хранение результатов
- **Redis** 6.3.0 - брокер сообщений и кеш

#### Real-time коммуникации
- **Django Channels** 4.3.1
- **channels-redis** 4.3.0
- **Daphne** 4.2.1 (ASGI сервер)
- **WebSocket** протокол

#### API и документация
- **drf-spectacular** 0.28.0 - OpenAPI/Swagger
- **djangorestframework-simplejwt** 5.5.1 - JWT аутентификация
- **django-cors-headers** 4.7.0 - CORS

#### Иерархические структуры
- **django-mptt** 0.18.0 - Modified Preorder Tree Traversal

#### Генерация отчетов
- **python-docx** 1.1.2 - Word документы
- **openpyxl** 3.1.5 - Excel таблицы
- **reportlab** 4.4.3 - PDF документы

#### Файловое хранилище
- **django-storages** 1.14.2
- **boto3** 1.34.0 - S3 интеграция
- **Pillow** 11.3.0 - обработка изображений
- **WhiteNoise** 6.11.0 - статические файлы

#### Тестирование
- **pytest** 8.4.1
- **pytest-django** 4.11.1
- **pytest-mock** 3.15.1
- **factory_boy** 3.3.3 - фабрики для тестов
- **Faker** 37.12.0 - генерация тестовых данных

#### Production сервер
- **gunicorn** 23.0.0 - WSGI сервер
- **uvicorn** 0.40.0 - ASGI сервер

#### Утилиты
- **python-dotenv** 1.2.1 - переменные окружения
- **django-filter** 25.1 - фильтрация API
- **requests** 2.32.5 - HTTP клиент

### Frontend

#### Core Framework
- **Next.js** 15.2.4
- **React** 19
- **TypeScript** 5.x

#### UI библиотеки
- **Radix UI** - 35+ компонентов:
  - accordion, alert-dialog, avatar, badge
  - calendar, checkbox, dialog, dropdown-menu
  - label, popover, progress, radio-group
  - select, separator, switch, tabs
  - table, toast, tooltip и др.
- **Tailwind CSS** 3.4.0
- **tailwindcss-animate** 1.0.7
- **Framer Motion** 12.23.24 - анимации
- **Lucide React** 0.454.0 - иконки

#### State Management и Data Fetching
- **@tanstack/react-query** 5.90.8 - управление серверным состоянием
- **React Hook Form** 7.60.0 - формы
- **Zod** 3.25.67 - валидация схем
- **@hookform/resolvers** 3.10.0

#### Аутентификация
- **NextAuth.js** 4.24.13
- JWT токены

#### Календарь и дата
- **FullCalendar** 6.1.19 (с плагинами):
  - @fullcalendar/react
  - @fullcalendar/daygrid
  - @fullcalendar/timegrid
  - @fullcalendar/interaction
- **date-fns** - работа с датами
- **react-day-picker** 9.8.0 - выбор дат

#### Визуализация данных
- **Recharts** 2.15.4 - графики и диаграммы
- **react-organizational-chart** 2.2.1 - оргструктура

#### Утилиты
- **clsx** 2.1.1 - условные классы
- **tailwind-merge** 2.5.5 - объединение Tailwind классов
- **class-variance-authority** 0.7.1 - варианты компонентов
- **cmdk** 1.0.4 - command menu

#### Мониторинг
- **@sentry/nextjs** 10.21.0 - отслеживание ошибок

#### Дополнительные UI компоненты
- **react-resizable-panels** 2.1.7 - изменяемые панели
- **embla-carousel-react** 8.5.1 - карусель
- **sonner** 1.7.4 - toast уведомления
- **next-themes** 0.4.6 - темы

#### Тестирование
- **@playwright/test** 1.56.1 - E2E тесты
- **@testing-library/react** 16.3.0
- **@testing-library/jest-dom** 6.9.1
- **Jest** 29.7.0

---

## Модели данных

### Основные модели Backend

#### Employee (Сотрудник)
```python
class Employee(models.Model):
    id: BigAutoField                          # Первичный ключ
    personnel_number: CharField               # Табельный номер (unique)
    last_name: CharField                      # Фамилия
    first_name: CharField                     # Имя
    middle_name: CharField                    # Отчество
    birth_date: DateField                     # Дата рождения
    gender: CharField                         # Пол (M/F)
    iin: CharField                            # ИИН (unique)
    photo: ImageField                         # Фото
    rank: ForeignKey(Rank)                    # Звание
    user: OneToOneField(User)                 # Связь с пользователем
    hire_date: DateField                      # Дата приема
    dismissal_date: DateField                 # Дата увольнения
    is_active: BooleanField                   # Активен
    archived_at: DateTimeField                # Дата архивации
    employment_status: CharField              # working/fired
    work_phone: CharField                     # Служебный телефон
    work_email: EmailField                    # Служебная почта
    personal_phone: CharField                 # Личный телефон
    personal_email: EmailField                # Личная почта
    notes: TextField                          # Примечания
```

#### Division (Подразделение)
```python
class Division(MPTTModel):                    # MPTT для иерархии
    id: BigAutoField
    name: CharField                           # Название
    code: CharField                           # Код (unique)
    division_type: CharField                  # organization/department/directorate/division
    parent: TreeForeignKey(self)              # Родительское подразделение
    is_active: BooleanField                   # Активно
    order: IntegerField                       # Порядок сортировки
    archived_at: DateTimeField                # Дата архивации

    # MPTT поля (автоматические)
    tree_id: IntegerField                     # ID дерева
    level: IntegerField                       # Уровень в иерархии
    lft: IntegerField                         # Left (для MPTT)
    rght: IntegerField                        # Right (для MPTT)
```

#### EmployeeStatus (Статус сотрудника)
```python
class EmployeeStatus(models.Model):
    id: BigAutoField
    employee: ForeignKey(Employee)            # Сотрудник
    status_type: ForeignKey(StatusType)       # Тип статуса
    state: CharField                          # planned/active/completed/cancelled
    start_date: DateField                     # Дата начала
    end_date: DateField                       # Дата окончания (плановая)
    actual_end_date: DateField                # Фактическая дата окончания
    comment: TextField                        # Комментарий
    early_termination_reason: TextField       # Причина досрочного завершения
    related_division: ForeignKey(Division)    # Связанное подразделение (для прикомандирования)
    location: CharField                       # Место (для командировок/учебы)
    created_by: ForeignKey(User)              # Кто создал
    is_notified: BooleanField                 # Отправлено ли уведомление
    auto_applied: BooleanField                # Применено ли автоматически
    created_at: DateTimeField
    updated_at: DateTimeField
```

#### StatusType (Тип статуса)
```python
class StatusType(models.Model):
    id: BigAutoField
    name: CharField                           # Название (unique)
    code: CharField                           # Технический код (unique)
    description: TextField                    # Описание
    parent: ForeignKey(self)                  # Родительский статус (иерархия)
    is_active: BooleanField                   # Активен
    requires_end_date: BooleanField           # Требуется дата окончания
    max_duration_days: IntegerField           # Максимальная длительность
    color: CharField                          # Цвет для UI
    sort_order: IntegerField                  # Порядок сортировки
```

Иерархия статусов:
```
В строю (in_service)
Отпуск (vacation)
├── Очередной отпуск (annual_leave)
├── Учебный отпуск (educational_leave)
└── Отпуск без содержания (unpaid_leave)
Больничный (sick_leave)
Командировка (business_trip)
Учеба (training)
Прикомандирован (seconded_to)
Откомандирован (seconded_from)
```

#### StaffUnit (Штатная единица)
```python
class StaffUnit(models.Model):
    id: BigAutoField
    division: ForeignKey(Division)            # Подразделение
    position: ForeignKey(Position)            # Должность
    employee: OneToOneField(Employee)         # Сотрудник (один к одному)
    vacancy: OneToOneField(Vacancy)           # Вакансия (если не занята)
    category: CharField                       # Категория
    index: PositiveIntegerField               # Номер слота в подразделении
```

#### Position (Должность)
```python
class Position(models.Model):
    id: BigAutoField
    name: CharField                           # Название
    level: SmallIntegerField                  # Уровень (чем меньше, тем выше)
    category: CharField                       # Категория
```

#### Rank (Звание)
```python
class Rank(models.Model):
    id: BigAutoField
    name: CharField                           # Название (unique)
    level: SmallIntegerField                  # Уровень
```

#### SecondmentRequest (Запрос на прикомандирование)
```python
class SecondmentRequest(models.Model):
    id: BigAutoField
    employee: ForeignKey(Employee)            # Сотрудник
    from_division: ForeignKey(Division)       # Откуда
    to_division: ForeignKey(Division)         # Куда
    start_date: DateField                     # Дата начала
    end_date: DateField                       # Дата окончания
    reason: TextField                         # Причина
    status: CharField                         # pending/approved/rejected/cancelled
    requested_by: ForeignKey(User)            # Кто запросил
    approved_by: ForeignKey(User)             # Кто одобрил
    rejected_by: ForeignKey(User)             # Кто отклонил
    rejection_reason: TextField               # Причина отклонения
    created_at: DateTimeField
    updated_at: DateTimeField
```

#### Report (Отчет)
```python
class Report(models.Model):
    id: BigAutoField
    report_type: CharField                    # personnel_roster/division_report/staffing_table/status_summary
    report_format: CharField                  # docx/xlsx/pdf
    division: ForeignKey(Division)            # Подразделение
    date_from: DateField                      # Дата начала периода
    date_to: DateField                        # Дата окончания периода
    filters: JSONField                        # Дополнительные фильтры
    job_id: CharField                         # ID задачи Celery (unique)
    status: CharField                         # pending/processing/completed/failed
    file: FileField                           # Файл отчета
    error_message: TextField                  # Сообщение об ошибке
    created_by: ForeignKey(User)              # Кто создал
    created_at: DateTimeField
    completed_at: DateTimeField               # Дата завершения генерации
```

#### Notification (Уведомление)
```python
class Notification(models.Model):
    id: BigAutoField
    recipient: ForeignKey(User)               # Получатель
    notification_type: CharField              # Тип уведомления
    title: CharField                          # Заголовок
    message: TextField                        # Сообщение
    link: CharField                           # Ссылка
    is_read: BooleanField                     # Прочитано
    related_object_id: PositiveIntegerField   # ID связанного объекта
    related_model: CharField                  # Модель связанного объекта
    payload: JSONField                        # Дополнительные данные
    created_at: DateTimeField
    read_at: DateTimeField                    # Дата прочтения
```

### TypeScript интерфейсы Frontend

#### Employee (UI)
```typescript
interface Employee {
  id: string;
  name: string;                               // Полное имя
  position: string;                           // Должность
  status: StatusType;                         // Тип статуса
  statusState: 'planned' | 'active' | 'completed' | 'cancelled';
  avatar: string;                             // URL фото
  phone?: string;
  email?: string;
  department_id?: string;
  statusStartDate?: string;
  statusEndDate?: string;
}
```

#### StaffUnit (UI)
```typescript
interface StaffUnit {
  id: number;
  division: {
    id: number;
    name: string;
    level?: number;
    code?: string;
  };
  index: number;                              // Номер слота
  parent_id: number | null;
  vacancy: number | null;
  employees: StaffUnitEmployee[];
  children?: StaffUnit[];                     // Дочерние слоты
}

interface StaffUnitEmployee {
  position: {
    id: number;
    name: string;
    level: number;
  };
  employee: {
    id: number;
    first_name: string;
    last_name: string;
    middle_name?: string;
    photo?: string;
    current_status?: {
      status_type: string;
      state: string;
      start_date?: string;
      end_date?: string;
    };
    rank?: number;
  } | null;
}
```

---

## API Endpoints

### Базовый URL
- **Development:** `http://localhost:8000/api/`
- **Production:** `https://yourdomain.com/api/`

### Аутентификация

#### Получение токенов
```http
POST /api/token/
Content-Type: application/json

{
  "username": "user@example.com",
  "password": "password123"
}

Response:
{
  "access": "eyJ0eXAiOiJKV1QiLCJhbGc...",
  "refresh": "eyJ0eXAiOiJKV1QiLCJhbGc..."
}
```

#### Обновление токена
```http
POST /api/token/refresh/
Content-Type: application/json

{
  "refresh": "eyJ0eXAiOiJKV1QiLCJhbGc..."
}

Response:
{
  "access": "eyJ0eXAiOiJKV1QiLCJhbGc..."
}
```

### Сотрудники (`/api/employees/`)

```http
GET    /api/employees/employees/                  # Список сотрудников (пагинация, фильтры)
POST   /api/employees/employees/                  # Создание сотрудника
GET    /api/employees/employees/{id}/             # Детали сотрудника
PUT    /api/employees/employees/{id}/             # Полное обновление
PATCH  /api/employees/employees/{id}/             # Частичное обновление
DELETE /api/employees/employees/{id}/             # Удаление (архивация)
```

**Фильтры:**
- `?division_id=` - по подразделению
- `?status=` - по статусу занятости (working/fired)
- `?search=` - поиск по ФИО, табельному номеру, ИИН

### Подразделения (`/api/divisions/`)

```http
GET    /api/divisions/divisions/                  # Список подразделений
POST   /api/divisions/divisions/                  # Создание подразделения
GET    /api/divisions/divisions/{id}/             # Детали подразделения
PUT    /api/divisions/divisions/{id}/             # Обновление
DELETE /api/divisions/divisions/{id}/             # Удаление (архивация)
GET    /api/divisions/divisions_tree/             # Дерево подразделений (иерархия)
```

**Параметры дерева:**
- `?is_active=true` - только активные

### Статусы (`/api/statuses/`)

```http
GET    /api/statuses/statuses/                    # Список статусов (пагинация)
POST   /api/statuses/statuses/                    # Создание статуса
GET    /api/statuses/statuses/{id}/               # Детали статуса
PATCH  /api/statuses/statuses/{id}/               # Обновление статуса
DELETE /api/statuses/statuses/{id}/               # Удаление статуса
```

**Специальные endpoints:**
```http
GET    /api/statuses/statuses/planned/            # Запланированные статусы
       ?employee_id=123                            # для конкретного сотрудника

GET    /api/statuses/statuses/absence_statistics/ # Статистика отсутствий
       ?division_id=5                              # по подразделению
       ?start_date=2024-01-01
       &end_date=2024-12-31

POST   /api/statuses/statuses/{id}/extend/        # Продление статуса
       Body: { "new_end_date": "2024-12-31" }

POST   /api/statuses/statuses/{id}/terminate/     # Досрочное завершение
       Body: { "reason": "Причина" }

POST   /api/statuses/statuses/{id}/cancel/        # Отмена запланированного
       Body: { "reason": "Причина" }
```

### Штатное расписание (`/api/staff_unit/`)

```http
GET    /api/staff_unit/staff-units/               # Список штатных единиц (пагинация)
POST   /api/staff_unit/staff-units/               # Создание штатной единицы
GET    /api/staff_unit/staff-units/{id}/          # Детали штатной единицы
PUT    /api/staff_unit/staff-units/{id}/          # Обновление
DELETE /api/staff_unit/staff-units/{id}/          # Удаление
```

**Специальные endpoints:**
```http
GET    /api/staff_unit/staff-units/directorate/   # Штатное расписание директората пользователя (дерево)
       ?division_id=5                              # для конкретного подразделения

POST   /api/staff_unit/staff-units/directorate/   # Массовое создание сотрудников и штатных единиц
       Body: {
         "staff_units": [
           {
             "division_id": 5,
             "position_id": 3,
             "employee": {
               "first_name": "Иван",
               "last_name": "Иванов",
               ...
             }
           }
         ]
       }

PUT    /api/staff_unit/staff-units/directorate/   # Массовое обновление сотрудников и статусов
       Body: {
         "updates": [
           {
             "employee_id": 123,
             "status": {
               "status_type_id": 2,
               "start_date": "2024-01-01",
               ...
             }
           }
         ]
       }

GET    /api/staff_unit/statistics/                # Статистика по штатным единицам
       ?division_id=5                              # для подразделения
```

**Response статистики:**
```json
{
  "total_units": 150,
  "filled_units": 142,
  "vacant_units": 8,
  "fill_rate": 94.67
}
```

### Справочники (`/api/dictionaries/`)

```http
GET    /api/dictionaries/positions/               # Должности
GET    /api/dictionaries/ranks/                   # Звания
GET    /api/dictionaries/status-types/            # Типы статусов (иерархия)
GET    /api/dictionaries/dismissal-reasons/       # Причины увольнения
GET    /api/dictionaries/transfer-reasons/        # Причины перевода
GET    /api/dictionaries/vacancy-reasons/         # Причины открытия вакансии
GET    /api/dictionaries/education-types/         # Типы образования
GET    /api/dictionaries/document-types/          # Типы документов
POST   /api/dictionaries/feedback/                # Отправка обратной связи
```

### Прикомандирование (`/api/secondments/`)

```http
GET    /api/secondments/requests/                 # Список запросов
POST   /api/secondments/requests/                 # Создание запроса
GET    /api/secondments/requests/{id}/            # Детали запроса
PUT    /api/secondments/requests/{id}/            # Обновление
```

**Специальные actions:**
```http
POST   /api/secondments/requests/{id}/approve/    # Одобрение запроса
       Body: { "comment": "Одобрено" }

POST   /api/secondments/requests/{id}/reject/     # Отклонение запроса
       Body: { "reason": "Причина отклонения" }

POST   /api/secondments/requests/{id}/cancel/     # Отмена запроса
       Body: { "reason": "Причина отмены" }
```

### Отчеты (`/api/reports/`)

```http
GET    /api/reports/reports/                      # Список отчетов пользователя
POST   /api/reports/reports/generate/             # Создание задачи на генерацию
       Body: {
         "report_type": "personnel_roster",
         "report_format": "xlsx",
         "division_id": 5,
         "date_from": "2024-01-01",
         "date_to": "2024-12-31",
         "filters": {}
       }

GET    /api/reports/reports/{id}/                 # Детали отчета (с статусом генерации)
GET    /api/reports/reports/{id}/download/        # Скачивание файла отчета
```

**Типы отчетов:**
- `personnel_roster` - Расход личного состава
- `division_report` - Отчет по подразделению
- `staffing_table` - Штатное расписание
- `status_summary` - Сводка по статусам

**Форматы отчетов:**
- `docx` - Microsoft Word
- `xlsx` - Microsoft Excel
- `pdf` - PDF документ

### Уведомления (`/api/notifications/`)

```http
GET    /api/notifications/notifications/          # Список уведомлений пользователя
       ?is_read=false                              # только непрочитанные

POST   /api/notifications/notifications/{id}/mark_read/      # Отметить как прочитанное
POST   /api/notifications/notifications/mark_all_read/       # Отметить все как прочитанные
DELETE /api/notifications/notifications/{id}/                # Удаление уведомления
```

**WebSocket подключение:**
```javascript
const ws = new WebSocket('ws://localhost:8000/ws/notifications/');

ws.onmessage = (event) => {
  const notification = JSON.parse(event.data);
  console.log('Новое уведомление:', notification);
};
```

### Пользователь (`/api/common/`)

```http
GET    /api/common/user/profile/                  # Профиль текущего пользователя
PATCH  /api/common/user/profile/                  # Обновление профиля
POST   /api/common/user/change-password/          # Смена пароля
       Body: {
         "old_password": "old123",
         "new_password": "new123"
       }
```

### Документация API

```http
GET    /docs/                                      # Swagger UI (короткий URL)
GET    /redoc/                                     # ReDoc (короткий URL)
GET    /api/schema/                                # OpenAPI схема (JSON/YAML)
GET    /api/schema/swagger-ui/                    # Swagger UI (полный URL)
GET    /api/schema/redoc/                         # ReDoc (полный URL)
```

---

## Бизнес-логика и автоматизация

### Валидация статусов

#### Правила валидации

1. **Дата окончания:**
   - Статус "В строю" не имеет даты окончания (бессрочный)
   - Все остальные статусы требуют дату окончания

2. **Пересечения:**
   - Нельзя создать статус, который пересекается по датам с активным или запланированным статусом
   - При создании нового статуса система автоматически завершает конфликтующие статусы

3. **Максимальная длительность:**
   - Отпуск: максимум 60 дней (настраивается в `SystemSetting`)
   - Другие типы статусов: ограничения в модели `StatusType.max_duration_days`

4. **Дата начала:**
   - Нельзя создавать статусы на прошедшие даты
   - Дата начала не может быть раньше даты приема сотрудника

5. **Прикомандирование:**
   - Нельзя прикомандировать сотрудника в его же подразделение
   - Создаются парные статусы: "откомандирован" (в исходном подразделении) и "прикомандирован" (в целевом)

### Жизненный цикл статуса

```
1. СОЗДАНИЕ (planned)
   ↓
2. ПРИМЕНЕНИЕ (active) - автоматически в start_date или вручную
   ↓
3. ЗАВЕРШЕНИЕ (completed) - автоматически в end_date или вручную

   Возможна отмена (cancelled) на любом этапе
```

**Состояния:**
- `planned` - Запланирован, ожидает начала
- `active` - Активен, сотрудник в этом статусе
- `completed` - Завершен (по плану или досрочно)
- `cancelled` - Отменен

**Переходы:**
- `planned` → `active` - автоматически (Celery) или вручную
- `active` → `completed` - автоматически (Celery) или досрочное завершение
- `planned` → `cancelled` - отмена запланированного статуса

### Автоматизация (Celery Beat)

#### Периодические задачи

**Время выполнения (UTC):**

1. **09:05 - Применение запланированных статусов**
   ```python
   apply_planned_statuses()
   ```
   - Находит все статусы с `state=planned` и `start_date=today`
   - Меняет состояние на `active`
   - Завершает текущий активный статус (если есть)
   - Отправляет уведомление сотруднику и руководителю
   - Устанавливает флаг `auto_applied=True`

2. **09:10 - Завершение истекших статусов**
   ```python
   complete_expired_statuses()
   ```
   - Находит все статусы с `state=active` и `end_date<=today`
   - Меняет состояние на `completed`
   - Устанавливает `actual_end_date=today`
   - Активирует статус "В строю" (если нет следующего запланированного)
   - Отправляет уведомление

3. **09:12 - Уведомления о предстоящих статусах**
   ```python
   send_upcoming_status_notifications()
   ```
   - Находит статусы с `start_date=today+7days`
   - Отправляет уведомления сотруднику и руководителю
   - Флаг `is_notified=True` предотвращает повторную отправку

4. **09:15 - Уведомления о завершающихся статусах**
   ```python
   send_ending_status_notifications()
   ```
   - Находит статусы с `end_date=today+3days`
   - Отправляет уведомления

#### Асинхронная генерация отчетов

**Задача:**
```python
generate_report_task(report_id)
```

**Процесс:**
1. Пользователь создает запрос на отчет (POST `/api/reports/reports/generate/`)
2. Создается объект `Report` со статусом `pending`
3. Запускается Celery задача `generate_report_task`
4. Статус меняется на `processing`
5. Генерируется файл (DOCX/XLSX/PDF)
6. Файл сохраняется в `report.file`
7. Статус меняется на `completed` или `failed`
8. Отправляется уведомление пользователю
9. Пользователь скачивает файл (GET `/api/reports/reports/{id}/download/`)

### Real-time уведомления

#### WebSocket Consumer

**Подключение:**
```javascript
const ws = new WebSocket('ws://localhost:8000/ws/notifications/');
```

**Аутентификация:**
- Токен передается в query string: `?token=JWT_TOKEN`
- При подключении проверяется валидность токена

**Типы уведомлений:**

1. **Изменение статуса:**
   ```json
   {
     "type": "status_change",
     "title": "Изменение статуса",
     "message": "Ваш статус изменен на 'Отпуск'",
     "link": "/statuses",
     "payload": {
       "status_id": 123,
       "status_type": "vacation",
       "start_date": "2024-01-15"
     }
   }
   ```

2. **Запрос на прикомандирование:**
   ```json
   {
     "type": "secondment_request",
     "title": "Новый запрос на прикомандирование",
     "message": "Иванов И.И. запросил прикомандирование",
     "link": "/secondments/123",
     "payload": {
       "request_id": 123,
       "employee_name": "Иванов Иван Иванович"
     }
   }
   ```

3. **Готовность отчета:**
   ```json
   {
     "type": "report_ready",
     "title": "Отчет готов",
     "message": "Отчет 'Расход личного состава' готов к скачиванию",
     "link": "/reports/123",
     "payload": {
       "report_id": 123,
       "report_type": "personnel_roster"
     }
   }
   ```

---

## Безопасность и производительность

### Безопасность

#### Аутентификация

**JWT токены:**
- **Access token:** 8 часов (480 минут)
- **Refresh token:** 7 дней (604800 секунд)
- Алгоритм: HS256
- Bearer токены в заголовках: `Authorization: Bearer <token>`

**Конфигурация:**
```python
SIMPLE_JWT = {
    'ACCESS_TOKEN_LIFETIME': timedelta(hours=8),
    'REFRESH_TOKEN_LIFETIME': timedelta(days=7),
    'ROTATE_REFRESH_TOKENS': False,
    'BLACKLIST_AFTER_ROTATION': False,
    'ALGORITHM': 'HS256',
    'SIGNING_KEY': SECRET_KEY,
}
```

#### Авторизация

**Система ролей:**
1. **Администратор** - полный доступ
2. **HR менеджер** - управление персоналом
3. **Начальник департамента** - доступ к своему департаменту
4. **Начальник управления** - доступ к своему управлению
5. **Начальник отдела** - доступ к своему отделу
6. **Сотрудник** - просмотр своих данных

**Разграничение:**
- Проверка зоны ответственности по подразделениям
- Фильтрация данных по уровню доступа
- Запрет на изменение данных вне зоны ответственности

#### Аудит

**AuditMiddleware:**
- Логирование всех API запросов
- Сохраняемые данные:
  - IP адрес
  - HTTP метод (GET, POST, PUT, DELETE и т.д.)
  - URL endpoint
  - Тело запроса (JSON)
  - Статус ответа (200, 404, 500 и т.д.)
  - Время запроса
  - Пользователь (если аутентифицирован)
- Исключения: `/admin/`, `/static/`, `/media/`

#### Валидация данных

**Backend:**
- Django REST Framework сериализаторы
- Валидация полей (required, max_length, unique и т.д.)
- Кастомные валидаторы (ИИН, даты, пересечения статусов)
- Защита от SQL-инъекций (Django ORM)

**Frontend:**
- Zod схемы для валидации форм
- React Hook Form для управления формами
- Валидация перед отправкой на сервер

#### CORS

**Настройка:**
```python
CORS_ALLOWED_ORIGINS = [
    "http://localhost:3000",  # Frontend dev
    "http://localhost:8000",  # Backend dev
    # Production origins
]
CORS_ALLOW_CREDENTIALS = True
```

### Производительность

#### Кеширование

**Redis:**
- Celery broker (очереди задач)
- Celery результаты
- Кеш для часто используемых данных
- Session backend

**OpenAPI схема:**
- Кеширование на 60 минут
- Уменьшение времени генерации документации

#### Оптимизация запросов

**Django ORM:**
- `select_related()` для ForeignKey (JOIN)
- `prefetch_related()` для ManyToMany и обратных FK
- Индексы на часто используемых полях:
  - `Employee.iin` (unique index)
  - `Employee.personnel_number` (unique index)
  - `Division.code` (unique index)
  - `EmployeeStatus.employee` + `state` (composite index)

**MPTT для иерархий:**
- Эффективные запросы дерева подразделений
- O(1) для получения всех потомков
- O(1) для получения всех предков

#### Пагинация

**Настройки:**
```python
REST_FRAMEWORK = {
    'DEFAULT_PAGINATION_CLASS': 'rest_framework.pagination.PageNumberPagination',
    'PAGE_SIZE': 50,
}
```

**Response:**
```json
{
  "count": 1250,
  "next": "http://api.example.com/employees/?page=3",
  "previous": "http://api.example.com/employees/?page=1",
  "results": [...]
}
```

#### Фильтрация

**django-filter:**
- Фильтрация по полям
- Фильтрация по связанным объектам
- Поиск (search)
- Ordering (сортировка)

**Примеры:**
```
GET /api/employees/employees/?division_id=5
GET /api/employees/employees/?search=Иванов
GET /api/statuses/statuses/?state=active&start_date__gte=2024-01-01
```

#### Асинхронность

**Celery:**
- Асинхронная генерация отчетов
- Фоновая обработка задач
- Периодические задачи (Beat)
- Масштабируемость через workers

**Django Channels:**
- Асинхронная обработка WebSocket соединений
- Real-time коммуникации без блокировки

#### Статические файлы

**WhiteNoise:**
- Эффективная раздача статики из Django
- Сжатие gzip
- Кеширование с Cache-Control заголовками
- Не требует отдельного веб-сервера для статики

**Production:**
- Nginx для статики и медиа файлов
- CDN для глобального распределения

---

## Развертывание

### Backend (Django)

#### Переменные окружения

```env
# Django
SECRET_KEY=your-secret-key-here
DEBUG=False
ALLOWED_HOSTS=yourdomain.com,www.yourdomain.com

# Database
DATABASE_URL=postgresql://user:password@localhost:5432/personnel_records
DB_NAME=personnel_records
DB_USER=postgres
DB_PASSWORD=your-db-password
DB_HOST=localhost
DB_PORT=5432

# Redis
REDIS_URL=redis://localhost:6379/0
CELERY_BROKER_URL=redis://localhost:6379/0
CELERY_RESULT_BACKEND=redis://localhost:6379/0

# AWS S3 (опционально, для файлового хранилища)
AWS_ACCESS_KEY_ID=your-access-key
AWS_SECRET_ACCESS_KEY=your-secret-key
AWS_STORAGE_BUCKET_NAME=your-bucket-name
AWS_S3_REGION_NAME=us-east-1

# CORS
CORS_ALLOWED_ORIGINS=http://localhost:3000,https://yourdomain.com

# Email (для уведомлений)
EMAIL_HOST=smtp.gmail.com
EMAIL_PORT=587
EMAIL_USE_TLS=True
EMAIL_HOST_USER=your-email@gmail.com
EMAIL_HOST_PASSWORD=your-password
```

#### Docker Compose

```yaml
version: '3.8'

services:
  db:
    image: postgres:15
    environment:
      POSTGRES_DB: personnel_records
      POSTGRES_USER: postgres
      POSTGRES_PASSWORD: postgres
    volumes:
      - postgres_data:/var/lib/postgresql/data
    ports:
      - "5432:5432"

  redis:
    image: redis:7-alpine
    ports:
      - "6379:6379"

  web:
    build: .
    command: gunicorn organization_management.config.wsgi:application --bind 0.0.0.0:8000
    volumes:
      - .:/app
      - static_volume:/app/staticfiles
      - media_volume:/app/media
    ports:
      - "8000:8000"
    depends_on:
      - db
      - redis
    env_file:
      - .env

  daphne:
    build: .
    command: daphne -b 0.0.0.0 -p 8001 organization_management.config.asgi:application
    ports:
      - "8001:8001"
    depends_on:
      - db
      - redis
    env_file:
      - .env

  celery:
    build: .
    command: celery -A organization_management.config worker -l info
    volumes:
      - .:/app
    depends_on:
      - db
      - redis
    env_file:
      - .env

  celery-beat:
    build: .
    command: celery -A organization_management.config beat -l info --scheduler django_celery_beat.schedulers:DatabaseScheduler
    volumes:
      - .:/app
    depends_on:
      - db
      - redis
    env_file:
      - .env

  nginx:
    image: nginx:alpine
    ports:
      - "80:80"
      - "443:443"
    volumes:
      - ./nginx.conf:/etc/nginx/nginx.conf
      - static_volume:/app/staticfiles
      - media_volume:/app/media
    depends_on:
      - web
      - daphne

volumes:
  postgres_data:
  static_volume:
  media_volume:
```

#### Команды развертывания

```bash
# 1. Клонирование репозитория
git clone <repository-url>
cd Personnel-Records

# 2. Создание виртуального окружения
python -m venv venv
source venv/bin/activate  # Linux/Mac
# venv\Scripts\activate  # Windows

# 3. Установка зависимостей
pip install -r requirements/production.txt

# 4. Настройка переменных окружения
cp .env.example .env
# Отредактируйте .env файл

# 5. Миграции базы данных
python manage.py migrate

# 6. Создание суперпользователя
python manage.py createsuperuser

# 7. Сбор статических файлов
python manage.py collectstatic --noinput

# 8. Загрузка начальных данных (справочники)
python manage.py loaddata dictionaries

# 9. Запуск серверов
# Gunicorn (WSGI)
gunicorn organization_management.config.wsgi:application --bind 0.0.0.0:8000 --workers 4

# Daphne (ASGI для WebSocket)
daphne -b 0.0.0.0 -p 8001 organization_management.config.asgi:application

# Celery Worker
celery -A organization_management.config worker -l info --concurrency=4

# Celery Beat
celery -A organization_management.config beat -l info --scheduler django_celery_beat.schedulers:DatabaseScheduler
```

### Frontend (Next.js)

#### Переменные окружения

```env
# API
NEXT_PUBLIC_API_URL=http://localhost:8000
NEXT_PUBLIC_WS_URL=ws://localhost:8000

# NextAuth
NEXTAUTH_URL=http://localhost:3000
NEXTAUTH_SECRET=your-nextauth-secret

# Sentry (опционально)
NEXT_PUBLIC_SENTRY_DSN=your-sentry-dsn
```

#### Docker

```dockerfile
# Dockerfile
FROM node:20-alpine AS base

# Dependencies
FROM base AS deps
WORKDIR /app
COPY package.json pnpm-lock.yaml ./
RUN corepack enable pnpm && pnpm install --frozen-lockfile

# Builder
FROM base AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN corepack enable pnpm && pnpm run build

# Runner
FROM base AS runner
WORKDIR /app
ENV NODE_ENV production
RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 nextjs

COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

USER nextjs
EXPOSE 3000
ENV PORT 3000

CMD ["node", "server.js"]
```

#### Команды развертывания

```bash
# 1. Клонирование репозитория
git clone <repository-url>
cd PersonalRecordFront

# 2. Установка зависимостей
pnpm install

# 3. Настройка переменных окружения
cp .env.example .env.local
# Отредактируйте .env.local файл

# 4. Сборка production
pnpm run build

# 5. Запуск production сервера
pnpm run start

# Или через Docker
docker build -t personnel-records-frontend .
docker run -p 3000:3000 personnel-records-frontend
```

### Nginx конфигурация

```nginx
upstream django {
    server web:8000;
}

upstream daphne {
    server daphne:8001;
}

upstream nextjs {
    server nextjs:3000;
}

server {
    listen 80;
    server_name yourdomain.com;

    # Frontend (Next.js)
    location / {
        proxy_pass http://nextjs;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
    }

    # API (Django)
    location /api/ {
        proxy_pass http://django;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    # WebSocket (Daphne)
    location /ws/ {
        proxy_pass http://daphne;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    }

    # Static files
    location /static/ {
        alias /app/staticfiles/;
        expires 30d;
        add_header Cache-Control "public, immutable";
    }

    # Media files
    location /media/ {
        alias /app/media/;
        expires 7d;
        add_header Cache-Control "public";
    }

    # Admin
    location /admin/ {
        proxy_pass http://django;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }
}
```

### Мониторинг и логирование

#### Sentry

**Backend:**
```python
import sentry_sdk

sentry_sdk.init(
    dsn="your-sentry-dsn",
    environment="production",
    traces_sample_rate=0.1,
)
```

**Frontend:**
```javascript
// next.config.js
const { withSentryConfig } = require('@sentry/nextjs');

module.exports = withSentryConfig({
  // Next.js config
}, {
  // Sentry config
  silent: true,
});
```

#### Логирование

**Django:**
```python
LOGGING = {
    'version': 1,
    'disable_existing_loggers': False,
    'handlers': {
        'file': {
            'level': 'INFO',
            'class': 'logging.FileHandler',
            'filename': '/var/log/django/personnel_records.log',
        },
        'console': {
            'level': 'DEBUG',
            'class': 'logging.StreamHandler',
        },
    },
    'loggers': {
        'django': {
            'handlers': ['file', 'console'],
            'level': 'INFO',
            'propagate': True,
        },
    },
}
```

### Резервное копирование

#### База данных

```bash
# Backup
pg_dump -U postgres -h localhost personnel_records > backup_$(date +%Y%m%d).sql

# Restore
psql -U postgres -h localhost personnel_records < backup_20240115.sql
```

#### Медиа файлы

```bash
# Backup
tar -czf media_backup_$(date +%Y%m%d).tar.gz media/

# Restore
tar -xzf media_backup_20240115.tar.gz
```

---

## Заключение

**Personnel Records** - это комплексное решение для управления персоналом с:

- **Полным циклом** управления сотрудниками (прием, перевод, увольнение)
- **Автоматизацией** рутинных процессов (статусы, уведомления)
- **Штатным расписанием** с визуализацией организационной структуры
- **Отчетностью** в различных форматах
- **Real-time уведомлениями** через WebSocket
- **Современным технологическим стеком** (Django + Next.js)
- **Масштабируемой архитектурой** (микросервисы, асинхронность)
- **Безопасностью** (JWT, роли, аудит)

Система готова к production развертыванию и может быть расширена дополнительными модулями.

---

**Разработчик:** Personnel Records Team
**Версия:** 1.0
**Дата:** 2026
**Лицензия:** Proprietary
