# UX Discovery Extract — Use Cases (PersonnelStatus / VAPS)

**Date:** 2026-06-19
**Sources read:**
- `docs/PersonnelStatus/USE_CASES_SPECIFICATION_VAPS.md` (v1.1, 4898 lines) — primary
- `docs/PersonnelStatus/brainstorming-session-2026-05-25-2256.md` (773 lines) — historical brainstorm (the file is named `brainstorming-session-2026-05-25-2256.md`; the prompt's `2026-05-25-2256` matched)

**Method note:** The use-cases spec uses two registers. Domain-core UCs (most EMP, STAFF-003, all STATUS-002/009/010, REPORT-001, SECOND-001, NOTIF-001, AUDIT-001, DICT-004, all DUTY/MARK/CALENDAR/DASH/IMPEX/RBAC/OPS) carry rich custom detail. Many others are **boilerplate templates** ("Выполнить сценарий X в модуле Y… 1. Инициатор открывает функцию… 2. Система проверяет авторизацию…"). Boilerplate UCs are flagged below as **[template]** — their flows carry no domain content beyond actor + name + RBAC/audit defaults. This is an explicit gap in the source, not an omission here.

**Scope filter:** PersonnelStatus = кадрово-оперативное ядро (сотрудники, оргструктура, штат, статусы, расход ЛС, прикомандирование, уведомления, аудит, справочники, RBAC, метки/календарь, импорт/экспорт). Operations/ОМ (objects, events, brokerage, ratings, HQ journal) are MVP-2+ and largely out of the daily-PersonnelStatus surface, but **дежурства (duties) project statuses into расход** and **caсcade replacement touches status**, so DUTY/MARK/OPS-011/012/DASH are kept.

---

## 1. Roles / Actors (Раздел 3)

Verbatim Russian terms preserved.

**Core PersonnelStatus actors:**
- **Администратор** — технический + функциональный администратор; полный доступ (справочники, оргструктура, штат, пользователи/роли, импорт, аудит). Не обходит аудит.
- **HR / кадровый сотрудник** — сотрудники, карточки, переводы, увольнения, штатные единицы, вакансии, справочники. Read-only где владеет КУ.
- **Руководство организации / Службы** — потребитель сводной картины (сводный расход, аналитика, индикаторы по всей организации). Обычно не редактирует.
- **Руководитель департамента** — контроль своего департамента; просмотр, своды, индикаторы, запросы прикомандирования. Scope департамента.
- **Руководитель управления** — *ключевой оператор ежедневного расхода*: массовое обновление статусов, сотрудники управления, расход управления, прикомандирование. Редактирует только своё управление; **запрещено при откомандировании / ограничивающем статусе**.
- **Начальник отдела** — аналог руководителя управления в scope отдела.
- **Сотрудник** — объект учёта + self-service (свой профиль/данные/уведомления). Нет доступа к чужим данным.
- **Наблюдатель / только просмотр** — read-only в scope.
- **Пользователь с доступом к отчётам** — роль/право генерации/скачивания отчётов (точный состав ролей — NC).
- **Назначенный ответственный** — контроль обновления статусов; получает уведомления об обновлении/отставании, видит проблемные управления.
- **Аудитор** — просмотр истории, аудита, архивов; без редактирования.
- **Система автоматизации / Celery** — авто-активация/завершение статусов, отчёты, уведомления; действия логируются как **AUTO**.
- **Внешняя система авторизации** — выдаёт JWT/claims (не UI-пользователь).
- **КУ / кадровая система** — внешний источник кадровых данных; на MVP — заглушка.

**Operations / future actors (вне ежедневного PersonnelStatus, но связаны):**
- **Старший объекта / старший наряда** — ведёт ОМ, рекогносцировка, расстановка, инструктаж.
- **Старший направления / сектора** — расчёт по направлению, документы.
- **ГАП СПС / брокер департамента** — канал запроса/распределения приданных сил.
- **Утверждающий уровень** — утверждение расстановки (один approver, ЭЦП future).
- **Штабист** — журнал штаба, инциденты, схемы.
- **ОМД / ОРГД** — дежурный по ОМ / по организации; временные права на дату/смену. (Сессионные надстройки — требуют валидации с заказчиком, см. OQ.)

---

## 2. Use Cases for PersonnelStatus (Раздел 5 + детальные §6)

Format per UC: **ID — name** | actor | goal | main flow | key alt/error. `[template]` = boilerplate flow in source.

### Authentication & Profile (UC-AUTH)
- **UC-AUTH-001 — Вход в систему** | Пользователь | получить доступ через утверждённый Auth. Flow: 1) ввод логин/пароль или внешний Auth; 2) проверка creds/токена; 3) получить роли+scope; 4) frontend сохраняет access token, открывает ролевой экран. Alt: A1 внешний Auth — пароль не хранится; A2 собственный JWT `/api/token/`. Err: E1 неверные данные; E2 токен отозван/просрочен.
- **UC-AUTH-002 — Обновление токена** `[template]` | Пользователь/Frontend.
- **UC-AUTH-003 — Просмотр профиля** | Пользователь | показать профиль, роль, подразделение, ограничения. Flow: определить юзера по токену → загрузить Employee+роли+scope → показать доступные действия и ограничения. Alt: A1 Employee не связан → только техпрофиль + ошибка привязки. Err: E1 401. Бизнес: чувствительные поля скрыты без права. UI `/profile`.
- **UC-AUTH-004 — Изменение профиля** `[template]` (состав редактируемых полей — OQ).
- **UC-AUTH-005 — Смена пароля** `[template]` (при внешнем Auth — вне VAPS; legacy — локально).
- **UC-AUTH-006 — Выход из системы** `[template]` (завершение сессии на стороне клиента/Auth).

### Employees (UC-EMP)
- **UC-EMP-001 — Просмотр списка сотрудников** | Руководитель/HR/Наблюдатель | список в scope. Flow: 1) открыть список; 2) применить scope; 3) вернуть с пагинацией, **сортировка по должности затем фамилии**; 4) **UI выделяет откомандированных и прикомандированных отдельными блоками**. Alt: A1 руководство видит всю организацию; A2 сотрудник видит только себя. Err: 403/пустой список вне scope. UI `/employees`.
- **UC-EMP-002 — Поиск и фильтрация сотрудников** `[template]`.
- **UC-EMP-003 — Просмотр карточки сотрудника** `[template]`.
- **UC-EMP-004 — Создание сотрудника** | HR/Админ/(Рук.управления — NC) | создать карточку + подготовить к назначению. Flow: 1) ввод ФИО, ИИН, табельный номер (или авто), контакты, фото, звание, дата приёма; 2) валидация ИИН/уникальности/обязательных; 3) создать Employee; 4) при выбранной ставке — назначение на штат. Alt: A1 без ставки; A2 связать с внешней учёткой. Err: E1 дубликат ИИН/таб.номера; E2 ставка занята; E3 нет прав. Бизнес: один сотрудник = одна штатная единица; дата статуса ≥ дата приёма. UI `/employees/add`.
- **UC-EMP-005 — Редактирование сотрудника** `[template]`.
- **UC-EMP-006 — Архивация / увольнение сотрудника** `[template]`.
- **UC-EMP-007 — Просмотр истории кадровых перемещений** `[template]` | HR/Руководитель/Аудитор.
- **UC-EMP-008 — Связь сотрудника с пользователем** `[template]` | Админ/Auth (через `core_user_employee_bindings`).
- **UC-EMP-009 — Загрузка/изменение фото** `[template]`.

### Org structure (UC-DIV)
- **UC-DIV-001 — Просмотр дерева подразделений** | Все в scope | показать гибкую оргструктуру. Flow: 1) загрузить дерево; 2) фильтр активности+scope; 3) вернуть прямых/всех потомков, путь от корня, статистику по поддереву; 4) UI строит дерево/оргдиаграмму. Alt: A1 архивные узлы — только админу. Бизнес: ветки Орг→Деп→Упр→Отдел, Орг→Упр, Орг→Отдел + временные единицы. UI `/organization`.
- **UC-DIV-002 — Создание подразделения** | Админ/HR | Flow: ввод название/код/тип/родитель/ответственный → проверка уникальности кода + допустимости родителя → создать активный Division → перестроить дерево/кэш. Alt: A1 временное подразделение с датами действия. Err: дубликат кода, недопустимая иерархия. Бизнес: parent обязателен кроме корня.
- **UC-DIV-003 — Редактирование подразделения** `[template]`.
- **UC-DIV-004 — Архивация подразделения** `[template]` | Администратор.
- **UC-DIV-005 — Изменение родителя подразделения** `[template]` | Администратор.
- **UC-DIV-006 — Просмотр по зоне ответственности** `[template]`.

### Staffing (UC-STAFF)
- **UC-STAFF-001 — Просмотр штатных единиц** `[template]`.
- **UC-STAFF-002 — Создание штатной единицы** `[template]`.
- **UC-STAFF-003 — Назначение сотрудника на штатную единицу** | HR/Админ | Flow: 1) проверить, что у сотрудника нет другой ставки; 2) ставка свободна/имеет вакансию; 3) создать связь StaffUnit.employee; 4) закрыть Vacancy; 5) запись истории перевода + статус "В строю". Alt: A1 назначение с будущей даты → статус **PLANNED**. Err: сотрудник уже на ставке / ставка занята / нет прав. Бизнес: один сотрудник = одна ставка.
- **UC-STAFF-004 — Освобождение штатной единицы** `[template]`.
- **UC-STAFF-005 — Работа с вакансиями** `[template]`.
- **UC-STAFF-006 — Массовое создание/обновление штатных единиц** `[template]`.
- **UC-STAFF-007 — Статистика по штатному расписанию** `[template]`.

### Statuses (UC-STATUS) — ядро PersonnelStatus
- **UC-STATUS-001 — Просмотр текущего статуса** `[template]` | Все в scope.
- **UC-STATUS-002 — Назначение нового статуса** | Рук.управления/HR | зафиксировать спецстатус. Flow: 1) выбрать тип/даты/комментарий/документ; 2) проверка обязательности дат, дат приёма/увольнения, лимита длительности; 3) проверка пересечений; 4) создать EmployeeStatus **ACTIVE или PLANNED**; 5) запись истории. Alt: A1 дата=сегодня→ACTIVE; A2 дата в будущем→PLANNED; **A3 soft warning conflict → override с правом подтверждает исключение**. Err: E1 нет даты окончания где обязательна; E2 пересечение без права override; E3 статус из КУ недоступен для ручного изменения. Бизнес: статус-как-интервал; "В строю" по умолчанию. UI `/statuses`.
- **UC-STATUS-003 — Планирование будущего статуса** `[template]` | Рук.управления/HR.
- **UC-STATUS-004 — Авто-применение запланированного статуса** `[template]` | Celery.
- **UC-STATUS-005 — Авто-завершение истёкшего статуса** `[template]` | Celery.
- **UC-STATUS-006 — Продление статуса** `[template]` (требует новую дату окончания + причину, история "было/стало" — BR-012).
- **UC-STATUS-007 — Досрочное завершение статуса** `[template]` (требует фактическую дату + причину — BR-013).
- **UC-STATUS-008 — Отмена запланированного статуса** `[template]` (только PLANNED до даты начала — BR-014).
- **UC-STATUS-009 — Массовое обновление статусов** | Рук.управления/нач.отдела | быстро обновить ежедневный расход. Flow: 1) таблица сотрудников управления; 2) выбрать статусы+даты для нескольких; 3) валидация каждой строки + конфликтов; 4) сохранить пачку; 5) создать/обновить статусы + **зафиксировать факт обновления управления за дату**; 6) индикатор управления → "обновлено". Alt: A1 частичная ошибка — показать строки с ошибками, не терять валидный ввод (атомарность — OQ). Err: вне scope / откомандирован / конфликт статусов. Бизнес: **расход на завтра блокируется до полного обновления**. UI `/statuses` или `/organization`. Уведомления: DIVISION_UPDATED, DIVISION_PENDING.
- **UC-STATUS-010 — Проверка пересечения статусов** `[template]` | Система | гибрид `is_hard_block`: 422 hard / 409 soft+override.
- **UC-STATUS-011 — Возврат в "В строю"** `[template]` | Система/руководитель.
- **UC-STATUS-012 — Календарь статусов** | Все в scope | временная шкала статусов. Flow: 1) открыть календарь за период; 2) отобразить интервалы (включая PLANNED) **с цветами типов (StatusType.color)**, проекции дежурств, **составной статус по `ops_status_display_rules`**. Read-only, согласовано с расходом. Бизнес: один рабочий статус на дату по приоритету (BR-001 канона). Err: вне scope 403.

### Reports / Расход ЛС (UC-REPORT)
- **UC-REPORT-001 — Генерация "Расход личного состава"** | Руководитель/HR/руководство | официальный документ. Flow: 1) выбрать подразделение/организацию, дату/период, формат; 2) проверка прав + полноты обновлений если "на завтра"; 3) Report=pending; 4) Celery формирует файл; 5) status completed/failed; 6) уведомление + скачивание. Alt: A1 период → свод; A2 XLSX/PDF/CSV вместо DOCX. Err: E1 не все управления обновились → блок "на завтра"; E2 ошибка генерации; E3 вне scope. Бизнес: **штат = список + вакансии; список = статусы кроме прикомандированных; прикомандированные = "+N"; DOCX альбомная, заголовок 16, таблица 15 колонок**. Уведомления REPORT_READY/REPORT_FAILED. UI `/reports`.
- **UC-REPORT-002 — Отчёт по подразделению** `[template]`.
- **UC-REPORT-003 — Генерация штатного расписания** `[template]`.
- **UC-REPORT-004 — Сводка по статусам** `[template]`.
- **UC-REPORT-005 — Выбор формата DOCX/XLSX/PDF/CSV** `[template]`.
- **UC-REPORT-006 — Асинхронная генерация** `[template]` | Celery.
- **UC-REPORT-007 — Просмотр статуса генерации** `[template]` | Инициатор.
- **UC-REPORT-008 — Скачивание готового отчёта** `[template]`.

### Secondment / Прикомандирование (UC-SECOND)
- **UC-SECOND-001 — Создание запроса на прикомандирование** | Рук.управления/департамента | временно направить сотрудника. Flow: 1) выбрать сотрудника, принимающее подразделение, даты, причину, документ; 2) проверка, что не то же подразделение; 3) создать SecondmentRequest=pending; 4) уведомить принимающую сторону. Alt: A1 дата окончания неизвестна → открытый интервал. Err: E1 в своё же подразделение; E2 уже прикомандирован на период; E3 владелец = КУ → локальное создание запрещено. Уведомление SECONDMENT_REQUEST.
- **UC-SECOND-002 — Просмотр запросов** `[template]`.
- **UC-SECOND-003 — Одобрение запроса** `[template]` | Принимающее подразделение/уполномоченный.
- **UC-SECOND-004 — Отклонение запроса** `[template]`.
- **UC-SECOND-005 — Отмена запроса** `[template]` | Инициатор/уполномоченный.
- **UC-SECOND-006 — Авто-создание парных статусов** `[template]` | Система (создаёт "Откомандирован" в исходном + "Прикомандирован" в принимающем — BR-020).
- **UC-SECOND-007 — Запрос на возврат прикомандированного** `[template]` | Штатное подразделение.

### Notifications (UC-NOTIF)
- **UC-NOTIF-001 — Получение уведомления** | Система | доставить событие. Flow: 1) определить адресатов; 2) создать Notification; 3) realtime-событие в WebSocket-группу; 4) **UI показывает в колокольчике**. Alt: A1 offline → сохраняется, показывается при входе. Err: E1 WebSocket недоступен → сохраняется без push. Бизнес: MVP in-app/realtime в LAN; email/SMS противоречат закрытому контуру.
- **UC-NOTIF-002 — Просмотр списка** `[template]`.
- **UC-NOTIF-003 — Отметить как прочитанное** `[template]`.
- **UC-NOTIF-004 — Отметить все как прочитанные** `[template]`.
- **UC-NOTIF-005 — Удаление уведомления** `[template]`.
- **UC-NOTIF-006 — Real-time через WebSocket** `[template]` | Система.

### Audit (UC-AUDIT)
- **UC-AUDIT-001 — Авто-логирование API-запросов** | Система | неизменяемый след. Flow: middleware получает user/IP/метод/URL/body → пропускает → фиксирует status+время → сохраняет AuditEntry кроме исключённых путей. Бизнес: **append-only**; admin/static/media исключаемы; чувствительные данные маскируются.
- **UC-AUDIT-002 — Просмотр журнала** `[template]` | Админ/Аудитор.
- **UC-AUDIT-003 — Фильтрация аудита** `[template]`.
- **UC-AUDIT-004 — Проверка действий пользователя** `[template]`.

### Dictionaries (UC-DICT)
- **UC-DICT-001 — Просмотр справочников** `[template]`.
- **UC-DICT-002 — Управление должностями** `[template]`.
- **UC-DICT-003 — Управление званиями** `[template]`.
- **UC-DICT-004 — Управление типами статусов** | Админ/HR | настроить StatusType + правила длительности. Flow: 1) создать/редактировать StatusType: name, code, parent, **requires_end_date, max_duration_days, color**; 2) проверка уникальности кода + ссылочной целостности; 3) сохранить; 4) правила применяются при создании статусов. Alt: A1 неактивный тип скрыт из выбора, остаётся в истории. Err: E1 удаление используемого типа запрещено. Бизнес: типы статусов иерархичны; макс.длительности — OQ. UI `/api/dictionaries/status-types/`.
- **UC-DICT-005 — Управление причинами** `[template]`.
- **UC-DICT-006 — Управление системными настройками** `[template]` | Администратор.

### RBAC (UC-RBAC)
- **UC-RBAC-001 — Управление ролями и правами** | Администратор | вести роли/права. Flow: создать/изменить роль + набор прав (ops_roles, ops_permissions, ops_role_permissions); матрица по канону §37. Err: удаление роли с активными назначениями → 409. Бизнес: RBAC оперирует `user_id` не `employee_id`.
- **UC-RBAC-002 — Назначение ролей пользователям** | Администратор | роль + scope (подразделение/объект) → ops_user_roles. Err: дублирующее назначение → 400.
- **UC-RBAC-003 — Временные полномочия ОМД/ОРГД** | Админ/уполн.руководитель | временные права на дату/смену. Flow: 1) выдать (пользователь, права, окно дата/смена) → ops_temporary_duty_permissions; 2) внутри окна расширенные права; 3) по истечении — авто-прекращение, действие вне окна → 403. Alt: A1 досрочный отзыв. Бизнес: **на личную учётку, не на "должность дежурного"**; аудит пишет actor_user_id.

### Daily marks & calendar
- **UC-MARK-001 — Метки ежедневного обновления по подразделениям** | Рук.управления/нач.отдела; контроль ОМД/ответственный | зафиксировать обновление + контроль полноты. Flow: 1) после обновления подтвердить метку "обновлено" за дату (ops_daily_personnel_marks); 2) **индикатор по дереву: обновлено / не обновлено / отстаёт**; 3) **отсутствие метки хотя бы одного обязательного листа блокирует FINAL-вариант расхода** (черновик доступен); 4) уведомления об отставании. Бизнес: метки per leaf-division, историчны.

### Duties (UC-DUTY) — проецируют статусы в расход
- **UC-DUTY-001 — Создание/завершение дежурной смены с автопроекцией статусов** | Старший объекта/ОМД; система | Flow: 1) назначить сотрудника на смену вида дежурства; 2) проверка конфликтов (статус КУ, двойное назначение, сутки отдыха) по гибриду Q2; 3) **авто-проекция статусов: "на дежурстве" (DUTY) на сутки + "отдых после дежурства" (REST_AFTER_DUTY) на след.сутки**; 4) расширение: BEFORE_DUTY перед сменой (окно — OQ); 5) попадает в общий расход ЛС. Alt: A1 завершение/отмена → проекции корректируются; A2 назначение на отдых → soft-warning+override. Err: 403 / hard 422 / soft 409. Бизнес: прошедшие смены не редактируются (BR-016 канона).
- **UC-DUTY-002 — Справочник видов дежурств объекта** | Старший объекта/Админ | Flow: создать вид: название, длительность смены, правила отдыха, политика REST_AFTER_DUTY (`is_hard_block`, по умолч. hard). Err: деактивация вида с будущими сменами → 409. Бизнес: повседневные роли ("дежурный по комнате хранения оружия") моделируются видами дежурств; полный перечень — OQ.

### Operations UCs touching status (kept for status linkage)
- **UC-OPS-011 — Ознакомление с расстановкой** | Сотрудник; контроль старший объекта | Flow: 1) система уведомляет (мероприятие/пост/задачи/особенности — предварит. инструктаж); 2) сотрудник отмечает ознакомление; 3) фиксация с временем; 4) старший видит сводку кто/не ознакомился. Alt: A1 сотрудник **отклоняет назначение с причиной** → старший инициирует замену (OPS-012). Бизнес: ознакомление — блокер готовности.
- **UC-OPS-012 — Каскадная замена выбывшего** | Старший объекта/руководство | Flow: 1) запуск замены; 2) **система авто-предлагает кандидатов по штатной цепочке внутри управления** + проверка конфликтов/соответствия посту; 3) выбор или ручной подбор **в пределах департамента**; 4) если невозможно → **эскалация наверх**; 5) санкционированное изменение с историей. Alt: A1 кандидат с soft-конфликтом → override; A2 отказ всех → эскалация. Уведомления: выбывшему, новому, старшему.

### Import/Export (UC-IMPEX) — администратор
- **UC-IMPEX-001 — Импорт legacy (PREVIEW/STRICT)** | Админ | Flow: 1) **PREVIEW** — валидирует + отчёт (создаст/обновит/ошибки) без записи; 2) **STRICT** — атомарное применение; 3) **идемпотентность** (повтор не дублирует), изменение подразделения → история; 4) MPPT-валидация для сотрудников. Err: контракт файла → 400 построчно; STRICT с ошибками → отказ без частичной записи.
- **UC-IMPEX-002 — Контроль статуса import job** | Админ | список jobs: статус (PENDING/RUNNING/SUCCESS/FAILED/PARTIAL), режим, файл, инициатор; детали = построчный отчёт.
- **UC-IMPEX-003 — Экспорт данных с маскированием ПДн** | Админ/HR/Аудитор | Flow: выбрать набор+формат → применить `core_sensitive_field_policies` (маскирование без права раскрытия) → асинхронно → **скачивание логируется как sensitive download**.

### Dashboards (UC-DASH) — read-only analytics
- **UC-DASH-001 — Дашборд готовности к мероприятию** | Старший объекта/руководство | блокеры готовности (чек-лист, потребность утв/закрыта, ознакомление, расстановка утв) + % готовности + "что не готово и где задержка".
- **UC-DASH-002 — Дашборд нагрузки на людей** | Начальники/руководство | накопленная занятость + признаки перегрузки (**3+ дня подряд по 8+ часов**; превышение предельного времени поста).
- **UC-DASH-003 — Дашборд общего расхода + рекомендации** | Руководство/начальники | "**где сейчас сотрудники**" на любую дату (дежурства/ОМ/отдых/статусы) + рекомендации (MVP-2) по оценкам/нагрузке.

### Operations-only UCs (out of daily PersonnelStatus, listed for completeness)
UC-OPS-001 (паспорт объекта), UC-OPS-002 (план дежурств), UC-OPS-003 (создание ОМ), UC-OPS-004 (рекогносцировка/потребность), UC-OPS-005 (запрос приданных сил/брокеридж), UC-OPS-006 (проверка конфликтов расстановки), UC-OPS-007 (утверждение расстановки), UC-OPS-008 (опер.изменение после утверждения), UC-OPS-009 (фиксация инцидента), UC-OPS-010 (оценивание/рейтинг — двустороннее, 10б, default 8, закрытое), UC-OPS-013 (журнал штаба immutable), UC-OPS-014 (закрытие/архив), UC-OPS-015 (фактическое время на посту), UC-GROUP-001 (справочник групп).

---

## 3. Surfaces / Screens (implied)

Explicit URLs from spec:
- `/` or `/login` — вход
- `/profile` — профиль (`/api/common/user/profile/`)
- `/employees` — список сотрудников; `/employees/add` — создание; (карточка сотрудника implied)
- `/organization` — дерево/оргдиаграмма подразделений (`divisions_tree`)
- `/statuses` — статусы; massbulk update также может жить на `/organization`
- **Status calendar** (calendar view, UC-STATUS-012) — экран/виджет
- `/reports` — отчёты (генерация, статус, скачивание)
- Штатное расписание (UI implied, API `/api/staff_unit/`)
- Прикомандирование (requests UI implied)
- **Колокольчик уведомлений** (bell) — глобальный в шапке
- Журнал аудита (admin/auditor UI)
- Справочники (должности, звания, типы статусов, причины, настройки) — likely Django Admin + UI
- Admin RBAC (роли/права/назначения/временные полномочия)
- **Индикатор обновления по дереву подразделений** (обновлено/не обновлено/отстаёт) — likely на `/organization` или отдельный дашборд готовности расхода
- Import/Export admin screens (PREVIEW отчёт, список jobs)
- Дашборды: готовность ОМ, нагрузка, общий расход + рекомендации

UX brainstorm preference (Ось E): **единый портал, один URL, один вход, ролевые экраны**; пользователь не видит деления "PS"/"VX" — это бэкенд-модули. **Единая карточка сотрудника**, блоки скрываются по правам (богатая: фото, антропометрия, налёт, рейтинг, статус; часть полей не в печать).

---

## 4. Key data entities (Раздел 9)

PersonnelStatus-core:
- **User** (id, username/email, external_id, roles/scopes)
- **Employee** (ФИО, ИИН, табельный номер, фото, контакты, даты приёма/увольнения, employment_status)
- **Division** (name, code, type, parent, is_active, responsible) — self-parent дерево
- **StaffUnit** (division, position, index, category, active dates, parent_staff_unit)
- **Vacancy** (status, reason, opened_at, closed_at, requirements)
- **Position** (name, level, category) — сортировка сотрудников
- **Rank** (name, level)
- **StatusType** (name, code, parent, requires_end_date, max_duration_days, **color**)
- **EmployeeStatus** (employee, status_type, **state**, start_date, end_date, **source**, comment, docs) — статус-как-интервал
- **SecondmentRequest** (employee, from_division, to_division, dates, reason, status)
- **Report** (type, format, division, dates, filters, job_id, status, file)
- **Notification** (recipient, type, title, message, link, is_read, payload)
- **AuditEntry / AuditLog** (user, method, url, body, response_status, ip, timestamp, action, old/new)
- **SystemSetting** (key, value, description, is_active)
- **Role / Permission / UserRole** (+ scope_division)
- **TemporaryDutyPermission** (user, permissions, window_start, window_end)
- **DailyPersonnelMark** (division, report_date, marked_by, marked_at)
- **ImportJob / ExportJob** (type, mode PREVIEW/STRICT, file, status, report); **SensitiveFieldPolicy**
- TransferHistory / StatusChangeHistory (implied history tables)
- **UserEmployeeBinding** (`core_user_employee_bindings`)

Operations-side (DUTY/status-linked): DutyPlan/DutyShift, ObjectDutyType, plus Object/Event/Group/Assignment/Conflict/Acknowledgement/Replacement/Actuals/Evaluation/Readiness/Recommendation (mostly MVP-2+).

---

## 5. Statuses / States (the complete set)

### EmployeeStatus lifecycle (state machine) — BR-006, §7.5
**PLANNED → ACTIVE → COMPLETED / CANCELLED**
- PLANNED auto-activates on start date (Celery, BR-010)
- ACTIVE auto-completes on expiry; if no next status → returns to "В строю" (BR-011)
- CANCELLED: only a PLANNED status can be cancelled, before start date (BR-014)

### Personnel status values (status types / enum)
From brainstorm context + spec:
- **В строю** (default/base status — BR-005, "in formation/active")
- **На дежурстве** / **DUTY** ("on duty" — projected by duty shift)
- **Отдых после дежурства** / **REST_AFTER_DUTY** (mandatory rest next 24h after duty)
- **BEFORE_DUTY** (pre-duty projection — extension Q3/PR-2, window OQ)
- **В отпуске** (on leave)
- **Командировка** (business trip)
- **Больничный** (sick leave)
- **Прикомандирован** (seconded-in / attached)
- **Откомандирован** (seconded-out / detached)
- **Рапорт** (report — listed among hard-block types BR-009)
- **Учёба** (study — owner KU; OQ where it lands — N/OQ)
- **Соревнования** (competitions — OQ; KU)
- **ГЭВ** (группа экстренного выезда / emergency response group — owner VAPS; OQ)

`is_hard_block` classification (BR-009): **hard (422)** = отпуск, больничный, командировка, рапорт. **soft (409 + override w/ reason 10–500 chars)** = the rest. REST_AFTER_DUTY = soft+override (but brainstorm OQ flags it may be harder/absolute).

Status source enum (audit): **USER, KU_SYNC, OM_AUTO** (brainstorm) / actor recorded as **AUTO** for Celery actions.

### Secondment request states
**pending → одобрен / отклонён / отменён** (approve/reject/cancel; UC-SECOND-003/004/005).

### Report / job states
- Report: **pending → processing → completed / failed** (NFR-010)
- Import/Export job: **PENDING / RUNNING / SUCCESS / FAILED / PARTIAL** (UC-IMPEX-002)
- Import modes: **PREVIEW / STRICT**

### Division daily-update indicator (UC-MARK-001)
**обновлено / не обновлено / отстаёт** (updated / not-updated / lagging). Per leaf-division; missing mark blocks FINAL расход.

### Report variant
**черновик (draft) / FINAL** — FINAL blocked until all mandatory leaf-divisions marked.

### Event/ОМ approval (operations, future)
Recon → potreбnost → request → расстановка → утверждение → ознакомление → опер.изменения → закрытие/архив; AssignmentVersion versioned + hash; approval one approver; ЭЦП future.

### Conflict check responses (hybrid model — Q2/PR-1)
**422 hard-block** / **409 soft + override** / 403 no-right / 400 bad data.

---

## 6. Domain terminology glossary

- **Расход личного состава (расход ЛС)** — daily official document/report: who is where, headcount by status on a date. Central artifact.
- **Личный состав (ЛС)** — personnel/staff.
- **В строю** — base/default status: present and available ("in formation").
- **Штатная единица / ставка** — staff unit / position slot. One employee per unit.
- **Вакансия** — unoccupied staff unit.
- **Прикомандирование / прикомандирован** — secondment-in: temporarily attached to a receiving division; shown as "+N", NOT in receiving headcount (BR-022).
- **Откомандирование / откомандирован** — secondment-out: stays in own listed headcount but not "в строю" (BR-021).
- **Подразделение** — division/org unit. Hierarchy: Организация → (Департамент) → Управление → Отдел → Группа; flexible depth.
- **Управление** — directorate (key daily-operation unit). **Отдел** — department/section. **Департамент** — department (top-level under org).
- **Звание** — military/service rank. **Должность** — position.
- **Дежурство** — duty shift (24h); next 24h = mandatory rest.
- **Наряд** — detail/roster assignment.
- **Расстановка** — placement/deployment plan (operations).
- **Охранное мероприятие (ОМ)** — security event (operations).
- **Объект** — guarded object (central operations entity, has паспорт).
- **Паспорт объекта** — object passport.
- **Пост / Сектор** — post (service point) / sector (zone of several posts).
- **Рекогносцировка** — reconnaissance (via checklist).
- **Потребность** — calculated personnel requirement.
- **Боевой расчёт** — combat/duty roster (in PR title; no dedicated section — OQ N1).
- **Метка обновления** — daily-update mark per division.
- **ОМД** — дежурный по ОМ (event duty officer; day coordinator). **ОРГД** — дежурный по организации (org duty officer; read-only oversight). Both = session-overlay roles, validation pending.
- **ГАП СПС** — resource-allocation channel / brokerage (приданные силы = attached forces).
- **Брокер департамента** — department broker (resource request/distribution).
- **КУ** — Кадровый Учёт (external HR system of record; not yet built).
- **Налёт часов** — accumulated service/duty hours (VX/operations side).
- **ГЭВ** — группа экстренного выезда (emergency response group).
- **ЭЦП** — digital signature (future; hash-ready stub now).
- **Каскадная замена** — cascade replacement down the staff-position chain.

---

## 7. UX-affecting constraints

**Permissions / scope (per UC + matrix §4):**
- Everything is **scope-gated by division** (BR-017): users see/edit only their зона ответственности.
- Руководитель управления edits **only own управление**; **blocked if откомандирован/ограничивающий статус** (BR-018, hard UX state).
- Сотрудник = self only (profile, own data, own notifications, own acknowledgement).
- Чувствительные поля скрыты по умолчанию, раскрываются only by right (NFR-007); карточка blocks hidden by право.
- Mass status update only within own управление/отдел.
- Report generation/download scoped (BR-023); FINAL blocked by incomplete marks (BR-016/036).
- Temporary OMD/ORGD powers strictly within date/shift window; out-of-window → 403 (BR-037).
- RBAC keyed on `user_id` not `employee_id`.

**Audit:** Append-only (NFR-008, UI must not allow editing audit). All significant user actions + system status transitions logged (BR-025); old/new values for changes; AUTO for Celery; **every sensitive download logged** (BR-039). Auth attempts logged.

**Real-time:** in-app only, closed network (BR-026). WebSocket optional delivery layer; **DB is source of truth**; WebSocket outage must not lose notifications (NFR-016). No email/SMS/Telegram (future). Notification bell + unread flag.

**Validation rules (UX-visible):**
- ИИН validity + uniqueness; табельный номер uniqueness (UC-EMP-004).
- Status: requires_end_date for types that need it; cannot exceed hire/dismissal dates (BR-008); max_duration_days per type.
- Conflict hybrid: **hard → 422 (block)**, **soft → 409 + override requiring reason 10–500 chars + history** (BR-009). The override path is a first-class UX flow.
- One employee = one staff unit (BR-001); staff unit = occupied XOR vacant (BR-002).
- Cannot second into own division (BR-019).
- Pagination default **50** (NFR-009); search/filter; indices on ИИН/табельный/статусы.
- Reports: retention ≥ 90 days (NFR-012).
- Localization: расход document has **Kazakh title**; UI described in Russian (exact UI languages OQ — NFR-014).

---

## 8. Interaction details (concrete UI behaviors described)

- **Sorting:** employee list sorted by **должность (position level) then фамилия** (UC-EMP-001, BR).
- **Grouping/blocks:** откомандированные and прикомандированные shown as **separate blocks** in lists; прикомандированные as **"+N"** (UC-EMP-001, BR-022).
- **Filtering/search:** `?division_id=&search=` (UC-EMP-001); audit filtering (UC-AUDIT-003); calendar by period.
- **Bulk actions:** mass status update — table of division employees, multi-select status+dates, save batch; **partial-error handling must preserve valid rows** (atomicity OQ); mass staff-unit create/update.
- **Override confirmation:** soft-conflict → explicit override confirmation requiring reason (10–500 chars), recorded in history. Hard-conflict → hard block (no override).
- **Indicators / status colors:** division-tree update indicator (обновлено/не обновлено/отстаёт); calendar uses **StatusType.color**; composite status display via display rules; readiness dashboard shows % + blocker list.
- **Acknowledgement:** employee marks "ознакомлен" on assignment; can decline with reason → triggers replacement; supervisor sees who has/hasn't acknowledged.
- **Calendar:** read-only timeline including PLANNED intervals + duty projections, composite status per date.
- **Import preview:** PREVIEW shows create/update/error report before write; per-row error reporting; job status list with states.
- **Inline edit:** not explicitly specified — bulk table edit is the described pattern for statuses (no explicit inline-edit-on-card statement; flag as not stated).
- **Notifications:** bell in header (single global), unread flag, list, mark-read / mark-all-read / delete; offline messages shown on next login.
- **Report flow:** async — user not blocked, sees pending/processing/completed/failed, gets notification, downloads (NFR-010).
- **Escalation (brainstorm):** unacted requests escalate UP the vertical (управление → зам.деп → рук.деп), NOT through ОРГД.

---

## 9. Open questions / contradictions + brainstorm carry-ins

### Open Questions still OPEN (§13 + scattered)
- **G2** — Max status durations: no final per-type limit dictionary. **OPEN.**
- **G3** — Date format in расход header ("формат, принятый в организации") — partially closed by canon template; verify with customer. **OPEN.**
- **G4** — Exact permission matrix for роль-5/роль-6 (отчёты, наблюдатель) + precise scope rules. **OPEN** (base matrix in canon §37).
- **G6** — Audit retention regulation. **OPEN.**
- **N1** — "Боевой расчёт подразделений" in PR title but no section. **OPEN — ask customer.**
- **N2** — BEFORE_DUTY window length. **OPEN.**
- **N3** — Time-norm adjustment dictionary (conditions + coefficients for post limit time). **OPEN.**
- **N4** — "Иные виды" of non-ОМ duty roles (PR §5.1 "перечислить"). **OPEN.**
- **C7-доп** — Multiple/sequential secondments — detail at user-story level. **OPEN.**
- **Атомарность массового обновления** — partial-save vs full-rollback (UC-STATUS-009) — resolved at canon §31 (PREVIEW/STRICT) but UX of partial errors needs design.
- **OMD/ORGD roles** — session overlay vs collapse into "старший объекта + ГАП + dashboards" — validation with customer (brainstorm E1).
- **Ownership of each status type** (which статусы owned by КУ vs VAPS) — flagged repeatedly (UC-STATUS-002 E3, UC-DICT-004).
- Auth final model (UC-AUTH-001) — resolved to external JWT but legacy adapter retained.
- Whether REST_AFTER_DUTY is an absolute blocker vs soft warning (brainstorm OQ E3) — spec says soft+override; brainstorm suspects harder.

### Resolved contradictions (record for design rationale)
- C1 status owner → VAPS + source_code on MVP, KU-sync future.
- C2 auth → external JWT contract; legacy only migration.
- C3 conflicts → hybrid `is_hard_block` (422/409+override). **This replaced the brainstorm's original "hard gating / status-only selection prevents conflict by design"** (brainstorm A1 reconciliation): now **soft warning + override with logging** is canonical.
- C4 ЭЦП → approval by руководитель without ЭЦП; hash-ready; real ЭЦП future.
- C5 notifications → in-app only, DB source of truth, WebSocket optional.
- C6 org structure → local in `core` until КУ.

### Brainstorm raw ideas / preferences worth carrying into UX
(File marked HISTORICAL — not a requirements base, but strong UX signal from the user/operator.)
- **Single portal, single login (JWT), role-driven screens; no PS/VX split visible to user** (Ось E). Backend modules = talent/operations.
- **One employee card**, blocks shown/hidden by rights; rich card (фото, антропометрия, налёт, рейтинг, статус); some fields excluded from print.
- **Multi-role per user allowed**, including duty roles.
- **Дежурство = assignment to a personal account** (not shared login, not a "duty position") — `DutyAssignment(user, role, 08:00→08:00)`; auto-expiring; full audit "who exactly was ОМД/ОРГД".
- **Notification = bell only**, event-driven, addressed to the affected person (e.g., "you were removed/replaced from placement"). **Escalation up the vertical**, not via ОРГД.
- **Брокер ресурсов** — a role in PS that sees all personnel by управления and serves VX requests (aggregator, not point-to-point).
- **Дежурный по организации (ОРГД) cross-service dashboard / "командный центр"** — read-only org-wide расход overview (counts + lists by status), "светофор"/traffic-light view, alert on "молчуны" (3 days no update). ОРГД moves no people.
- **ОМД** — per-day coordinator; one ОМД per day for all events of that day.
- **Каскадная замена** down the staff-position chain: auto within управление, manual within департамент, then escalate; system must know **position hierarchy**, not just division hierarchy; manual override always allowed; notify the replacing person (and OQ: also unit head?).
- **Закрытый контур / single on-prem server**; tablets = deferred offline phase (read-only расстановка + rating entry; server always authoritative).
- **"Запланированный статус" / next-day default** — system rolls people back to a planned status after an event/duty.
- **Status-as-interval, auto-activation by date** — единая временная ось, daily entry = confirm/edit already-planned.
- UX domain questions raised but unanswered: единый портал vs два SPA; микрофронтенды; глобальный vs локальный поиск; live-sync across tabs; deep link `/employee/12345` target; what to show on portal home.
- Onboarding/feedback domains flagged: in-app tutorials, what's new, terminology unification, embedded feedback form (anonymity, voting, changelog crediting idea authors), feedback champion per division.

### Absences to flag (NOT invented)
- No explicit inline-edit-on-card spec (only bulk-table editing for statuses).
- No wireframes/visual specs in either source — only flows, rules, URLs.
- Many UCs (~60%) are template boilerplate with no UI-level detail — their screen behavior must be designed, not extracted.
- Exact UI language(s) unspecified (Russian assumed; расход header Kazakh).
- No keyboard/accessibility, no empty-state/loading-state specs (brainstorm lists loading/error states as needed frontend stories but no detail).
