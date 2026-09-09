# UC-GEN-002. Просмотреть свой профиль и сменить пароль

| Поле | Значение |
|---|---|
| Модуль | Общие |
| Актор | Любая вошедшая учётная запись (все роли); для вкладки «Мои назначения» — держатель `event.view` |
| Статус | Partial |
| Основание | `apps/operations/api/self_account.py` (`SelfProfileView`, `ChangeOwnPasswordView`), `apps/operations/api/user_urls.py` (`/api/user/profile/`, `/api/user/change-password/`), `apps/common/throttles.py` + `REST_FRAMEWORK.DEFAULT_THROTTLE_RATES['change-password']`, `services.AccountSelfService`, `MyPermissionsViewSet`, `MyEmployeeViewSet` (`/api/operations/my-employee/`), `OpsPersonnelViewSet.me` (`/api/ops/personnel/me/`), `OpsSecurityEventsViewSet.my_assignments` (`/api/ops/security-events/my-assignments/`); FRONT `app/security-ops/profile/page.tsx`, `widgets/my-profile/ui/ProfileBody.tsx`, `features/edit-profile/ui/EditProfileDialog.tsx`, `hooks/use-my-employee.ts`, `hooks/use-my-assignments.ts`, `shared/config/in-development.ts` |
| Дата актуализации | 2026-09-08 |

## Цель
Актор видит свою кадровую запись, назначения, календарь и историю службы и может поправить свои имя/фамилию/почту и сменить пароль.

## Предусловия
- Актор вошёл в систему (UC-GEN-001).
- Для тела профиля: у учётной записи заполнена связь `Employee.user` (кадровая служба заполняет вручную; сид её не делает).

## Main Flow
1. Актор открывает «Мой профиль» (`/security-ops/profile`) из бокового меню.
2. Система запрашивает `GET /api/operations/my-employee/` и получает свою кадровую запись (`employee`) либо `employee: null` с причиной `unlinked_reason`.
3. Система показывает шапку профиля (ФИО, статус словами: действующий «до …», ближайший «с …», иначе «В строю», средний балл по закрытым ОМ) и три вкладки: «Мои назначения», «Календарь», «История».
4. Актор на вкладке «Мои назначения» видит свои назначения на ОМ (`GET /api/ops/security-events/my-assignments/`) и может отметить «Ознакомлен, заступлю» (`POST …/acknowledge/<assignmentId>/`) или «Не могу заступить» с причиной (`POST …/decline/<assignmentId>/`).
5. Актор открывает меню шапки → «Редактировать профиль»; система читает `GET /api/user/profile/` и показывает диалог.
6. Актор правит имя, фамилию, почту и нажимает «Сохранить изменения» → `PATCH /api/user/profile/`; система показывает «Профиль успешно обновлен» и через 2 с перезагружает страницу.
7. Актор заполняет «Текущий пароль», «Новый пароль», «Подтвердите новый пароль» и нажимает кнопку смены пароля → `POST /api/user/change-password/`.
8. Система проверяет текущий пароль и валидаторы Django для нового, сохраняет пароль, пишет запись аудита и отвечает `{"message": "Пароль изменён."}`; диалог очищает поля и показывает «Пароль изменён. Он понадобится при следующем входе.»

## Alternative Flow
- **AF1. Учётка не связана с кадровой записью**: шаг 2 → 200 с `employee: null`; экран показывает карточку «Кадровая запись не найдена» с текстом причины сервера и подсказкой «Связь заводит кадровая служба…». Вкладки не показываются.
- **AF2. Запрос `my-employee` не прошёл (обрыв, 403)**: шаг 2 → карточка «Не удалось прочитать кадровую запись. Профиль показан не будет».
- **AF3. Нет права `event.view`**: шаг 4 → назначения показываются, но ссылка на карточку ОМ не рисуется — вместо неё текст (`EventLink` в `ProfileBody`: `hasPermission("event.view")`, при `hideWithoutAccess` кнопка-ссылка скрывается).
- **AF4. Пустые поля смены пароля**: шаг 7 → клиент отбивает без запроса: «Заполните все поля для смены пароля» + подписи под полями («Введите текущий пароль» / «Введите новый пароль» / «Повторите новый пароль»).
- **AF5. Новый пароль и подтверждение не совпадают**: шаг 7 → «Новые пароли не совпадают», подпись «Пароли не совпадают» под подтверждением; запроса нет.
- **AF6. Текущий пароль неверен**: шаг 8 → 400 `{"current_password": ["Текущий пароль неверен."]}`; ошибка показывается под полем.
- **AF7. Новый пароль не проходит валидаторы Django** (`UserAttributeSimilarityValidator`, `MinimumLengthValidator`, `CommonPasswordValidator`, `NumericPasswordValidator`): шаг 8 → 400 с русскими сообщениями (`translation.override("ru")`) под полем `new_password`.
- **AF8. Новый пароль совпадает с текущим**: шаг 8 → 400 `{"new_password": ["Новый пароль совпадает с текущим."]}`.
- **AF9. Больше 10 попыток смены пароля в час**: шаг 8 → 429 (`ScopedRateThrottle`, scope `change-password`, `10/hour`).
- **AF10. Почта уже занята другой учёткой**: шаг 6 → 400 `{"email": ["Эта почта уже занята другой учётной записью."]}` (`validate_email`, регистронезависимо).
- **AF11. Сотрудник уволен (`is_active=False`)**: `my-assignments` → 200 с `unlinkedReason = DISMISSED_REASON`, `/api/ops/personnel/me/` → 404 `EMPLOYEE_NOT_LINKED`.

## Изменения в системе
| Объект | Действие | Описание |
|---|---|---|
| `auth_user` | update | `first_name`, `last_name`, `email` (только `SELF_EDITABLE_FIELDS`; `username`, `is_staff`, `is_superuser`, `password` через `/profile/` недоступны — поля закрыты в сериализаторе) |
| `auth_user.password` | update | `set_password(new_password)` в `AccountSelfService.change_password` |
| `ops_audit_logs` (`OpsAuditLog`) | create | `ACCESS_ACCOUNT_SAVED` (entity `access_account`, снимок до/после) при реальном изменении профиля; `ACCESS_ACCOUNT_PASSWORD_CHANGED` (`new_value={"username"}`) при смене пароля; актор — `str(user.pk)` |
| Назначения ОМ (`acknowledge`/`decline`) | update | Описываются в UC модуля ОМ; здесь — точки входа с профиля |
| `my_assignments.mark_viewed(employee)` | update | Отметка просмотра списка назначений при чтении своих назначений (без `?employee=`) |
| Кадровая запись, звание, должность, подразделение, статусы, смены | read | `/api/operations/my-employee/`, `/api/core/ranks|positions|divisions/`, `/api/operations/statuses/?employee=…`, `duty-shifts/mine` |

## Бизнес-требования (BR)
- **BR1.** Актор правит только себя: адресата в `/api/user/profile/` и `/api/user/change-password/` нет ни в пути, ни в теле — всегда `request.user`.
- **BR2.** Смена пароля требует текущий пароль; подтверждение нового сравнивается только на клиенте (серверу приходит один `new_password`).
- **BR3.** Новый пароль обязан пройти `AUTH_PASSWORD_VALIDATORS` (минимальная длина 8 по умолчанию `MinimumLengthValidator`, не только цифры, не распространённый, не похож на атрибуты пользователя) и отличаться от текущего.
- **BR4.** Частота смены пароля — не более 10 запросов в час на пользователя.
- **BR5.** Почта уникальна среди учёток без учёта регистра (проверка только в этом сериализаторе; на модели `unique` нет).
- **BR6.** Кто «я» решает сервер по `Employee.user`; подбор по ФИО на клиенте запрещён (комментарий в `MyProfilePage`).
- **BR7.** Чужой профиль (`/security-ops/profile/[employeeId]`) читает тот же `ProfileBody`, но смены чужого сотрудника не показываются и подписи «мои» заменяются.
- **BR8.** Ответ смены пароля не несёт ни пароля, ни его признака — только `message`.

## Требования к логированию
- `OpsAuditLog`: `ACCESS_ACCOUNT_SAVED` и `ACCESS_ACCOUNT_PASSWORD_CHANGED` (см. таблицу выше) — синхронно, в транзакции.
- `LogIPMiddleware`: строка `Incoming Request …` на каждый запрос (`print`).
- HTTP-аудит `audit.AuditLog`: для `/api/user/*` запись не создаётся (`ContentType(app_label="user", …)` не существует) — `Не реализовано в коде`.
- Событие «сотрудник отметил ознакомление» в `OpsAuditLog`: только для отказа (`ASSIGNMENT_DECLINED`); подтверждение пишется полем `acknowledgedBy` в назначении, отдельной записи журнала нет.

## Требования к правам
| Роль | Доступ | Как обеспечивается |
|---|---|---|
| Любая вошедшая учётная запись (все роли, `ADMIN`) | полный к своему профилю и паролю | `permission_classes = [IsAuthenticated]` у `SelfProfileView`, `ChangeOwnPasswordView`; `MyEmployeeViewSet`, `MyPermissionsViewSet` — гейт `resolve_actor_id` (403 `PERMISSION_DENIED` без идентичности) |
| `EMPLOYEE` и прочие без `event.view` | полный к своему профилю; ссылки на карточки ОМ из назначений не рисуются | `my-assignments` на сервере кодом права не закрыт (свои назначения); `EventLink` в `ProfileBody`: `hasPermission("event.view")`; `OpsPersonnelViewSet.me` требует `event.view` (`_READ_EVENT_PERMISSION`) |
| Роли с `event.view` (`*OPS_READ`: `DIRECTORATE_HEAD`, `DEPARTMENT_EXPENSE_OFFICER`, `DUTY_OFFICER`, `EVENT_OFFICER`, `OPS_STAFF`, `PATROL_LEAD`, `GVO_LEAD`, `EVENT_APPROVER`, `DUTY_PLANNER`, `DUTY_PLAN_APPROVER`, `OBJECT_KEEPER`, `RATING_EVALUATOR`, `ANALYST`, `AUDITOR`, `HEAD_OPS_UNIT`, `EMPLOYEE_OPS_D2`, `OM_CATEGORY_ORG`), `ADMIN` | полный к профилю, включая ссылки на карточки ОМ из назначений | `event.view` в `ROLE_PERMISSIONS`; `ADMIN` — `*` |
| Аноним | нет | JWT отсутствует → `IsAuthenticated` 401; экран `/security-ops/profile` не закрыт `middleware.ts`, гейт — 403 бэка через `useOpsPermissions` |

## Требования к UX/UI
- «Мой профиль» — страница `/security-ops/profile` (`PageHeader` eyebrow «Личный кабинет», описание «Личные данные, назначения, календарь и история службы»); в шапке метка «В разработке» с пунктами из `in-development.ts` (№405, №434, №449).
- Состояния: «Загрузка профиля…»; карточка ошибки чтения; карточка «Кадровая запись не найдена» (пунктирная рамка) с причиной сервера.
- Тело (`ProfileBody`): шапка с ФИО, статусом словами, средним баллом; вкладки «Мои назначения» (карточки назначений: мероприятие, объект, сектор/пост, задача, форма/оружие, отметка «Ознакомлен»/«лично», кнопки подтверждения и отказа с причиной, ссылка на ОМ только при `event.view`), «Календарь» (сетка месяца Пн–Вс, полоски статусов и смен, панель выбранного дня), «История» (таблица заступлений с колонкой «Балл»: число / «не оценивалось» / нет права / загрузка).
- «Редактировать профиль» — модальный диалог из меню шапки (`EditProfileDialog`): поля имя, фамилия, почта, кнопка «Сохранить изменения»; раздел «Смена пароля»: «Текущий пароль», «Новый пароль» (placeholder «Введите новый пароль (минимум 8 символов)»), «Подтвердите новый пароль», кнопка смены; ошибки — общим `Alert` и подписями под полями (`aria-describedby`); успех — зелёным сообщением; кнопки `disabled` во время запроса.
- Профиль другого сотрудника — `/security-ops/profile/[employeeId]`, закрыт `OpsAccessDenied what="профиля сотрудника"` для не имеющих права.

## Открытые вопросы
- Метки «В разработке» по `/security-ops/profile` (`in-development.ts`): «Карточки назначений „Ознакомлен, заступлю“ / „Не могу заступить“ (№405)», «Шапка: должность и подразделение словами, рейтинг; история закрытых ОМ (№434)», «Три вкладки, календарь с полосками постов, без заглушек (№449)» — карточки открыты, статус UC Partial.
- Два разных ответа на «кто я»: `/api/operations/my-employee/` (200 + `employee: null`) и `/api/ops/personnel/me/` (404 `EMPLOYEE_NOT_LINKED`, требует `event.view`) — контракты расходятся по коду ответа и гейту.
- После сохранения профиля диалог делает `window.location.reload()` — несохранённое состояние других экранов теряется.
- Шапка «Мои назначения» и кнопки отметок доступны всем, а `/api/ops/personnel/me/` (второй ответ на «кто я») требует `event.view` — у `EMPLOYEE` эта ручка отвечает 403, хотя `my-employee` и `my-assignments` открыты.
- Уведомление актора о смене пароля (почта/SMS): `Не реализовано в коде`.
