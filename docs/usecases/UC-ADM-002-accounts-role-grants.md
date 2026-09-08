# UC-ADM-002. Управление учётными записями, выдача роли с областью и временного права

| Поле | Значение |
|---|---|
| Модуль | Администрирование и доступ |
| Актор | Администратор доступа — держатель `admin.roles` (`SECURITY_ADMIN`, `ADMIN`) |
| Статус | Partial |
| Основание | `AccountViewSet` (`/api/operations/accounts/`, `POST {id}/reset-password/`), `UserRoleViewSet` (`/api/operations/user-roles/`), `TemporaryDutyViewSet` (`/api/operations/temporary-duty/`, `POST {id}/expire/`) в `apps/operations/api/views.py`; `apps/operations/models.py` (`UserRole`, `TemporaryDutyPermission`), `services.AccountAdminService`, `services.RoleAdminService` (`assign_role`, `revoke_role`, `keeps_access_admin_without`, `grant_temporary_duty`, `expire_temporary_duty`), `services.PermissionService`; сериализаторы `AccountSerializer`, `AssignRoleRequestSerializer`, `GrantTemporaryDutyRequestSerializer`; FRONT `app/settings/users/page.tsx`, `hooks/use-access-permissions.ts`, `entities/access/index.ts` |
| Дата актуализации | 2026-09-08 |

## Цель
Администратор заводит учётную запись, блокирует её, сбрасывает пароль и выдаёт/снимает роли раздела с областью (подразделение или вся служба), а также временное право наряда на срок.

## Предусловия
- Актор вошёл и имеет `admin.roles` (или `*`).
- Роли заведены (UC-ADM-001); для области — подразделения (`Division`) существуют.

## Main Flow
1. Актор открывает «Настройки → Пользователи» (`/settings/users`); система читает `GET /api/operations/accounts/?search=`.
2. Актор нажимает «Завести учётную запись», вводит логин, фамилию, имя, почту, при желании пароль → `POST /api/operations/accounts/`.
3. Система создаёт `User`; если пароль не задан — генерирует временный (16 символов из алфавита без похожих знаков) и возвращает его один раз в `temporary_password`; экран показывает диалог «Временный пароль» с кнопкой «Скопировать».
4. Актор выбирает учётку; система читает её выдачи `GET /api/operations/user-roles/?user_id=<id>`.
5. Актор в блоке «Выдать роль» выбирает роль и область («Вся служба» или подразделение) → `POST /api/operations/user-roles/` `{user_id, role_code, scope_division_id|null}`; система создаёт/реактивирует `UserRole` и пишет аудит `ACCESS_ROLE_GRANTED`.
6. Актор нажимает «Снять» у выдачи, подтверждает «Снять роль?» → `DELETE /api/operations/user-roles/{id}/`; система деактивирует выдачу (`is_active=False`, история остаётся) и пишет `ACCESS_ROLE_REVOKED`.
7. Актор нажимает «Сбросить пароль», подтверждает → `POST /api/operations/accounts/{id}/reset-password/`; система ставит временный пароль, пишет `ACCESS_ACCOUNT_PASSWORD_RESET` и показывает его в диалоге «Временный пароль».
8. Актор нажимает «Заблокировать» (с подтверждением «Заблокировать учётную запись?») или «Разблокировать» (без подтверждения) → `PATCH /api/operations/accounts/{id}/` `{is_active}`; система пишет `ACCESS_ACCOUNT_SAVED`.
9. Права человека пересчитываются при следующем запросе (`PermissionService.effective_permissions`); клиент инвалидирует `["ops-me"]`.
10. Временное право наряда: `POST /api/operations/temporary-duty/` `{user_id, duty_role_code, starts_at, ends_at, employee_id?, scope_division_id?, event_id?}` → `TemporaryDutyPermission`; `POST …/{id}/expire/` снимает его досрочно; `GET …/?user_id=` — список. Экрана нет — только API.

## Alternative Flow
- **AF1. Нет права `admin.roles`**: любой шаг → 403; экран — `OpsAccessDenied what="учётных записей"`.
- **AF2. Снятие с себя последней выдачи, дающей `admin.roles` или `*`**: шаг 6 → `DomainError LAST_ACCESS_ADMIN_ROLE` «Нельзя снять с себя последнюю роль, дающую управление доступом.»; диалог показывает причину сервера.
- **AF3. Несуществующая выдача**: шаг 6 → 404.
- **AF4. `scope_division_id` не существует**: шаг 5 → 400 «Подразделения с таким id нет.»; неизвестный `role_code` → 400 (`PrimaryKeyRelatedField`).
- **AF5. Повторная выдача той же роли в той же области**: шаг 5 → `update_or_create` реактивирует существующую строку (`is_active=True`), аудит с `created: false`.
- **AF6. Пароль в теле `PATCH` учётки**: шаг 8 → 400 `{"password": "Пароль меняется действием reset-password/."}`.
- **AF7. Заданный при создании пароль не проходит `AUTH_PASSWORD_VALIDATORS`**: шаг 2 → 400 со списком сообщений под полем `password`; временный пароль в этом случае не выдаётся.
- **AF8. Логин занят / пустой**: шаг 2 → 400 от `ModelSerializer` (`username` уникален в `auth_user`); ошибки под полями.
- **AF9. `starts_at >= ends_at` у временного права**: шаг 10 → 400 `{"ends_at": "Окончание должно быть позже начала."}`; неизвестный `duty_role_code` → 400 (`ChoiceField` по `DUTY_ROLE_CHOICES`).
- **AF10. `expire` несуществующего права**: шаг 10 → 404.
- **AF11. Ничего не найдено по поиску**: шаг 1 → «По запросу „…“ ничего не найдено.»

## Изменения в системе
| Объект | Действие | Описание |
|---|---|---|
| `auth_user` (`User`) | create / update | создание с `set_password` (заданный или временный пароль); правка `first_name`, `last_name`, `email`, `is_active`; сброс пароля (`update_fields=["password"]`). Удаления нет |
| `ops_user_roles` (`UserRole`) | create / update | `user_id` (строка = `str(User.pk)`), `role_code`, `scope_division_id`, `is_active`, `created_by`; уникальность `(user_id, role_code, scope_division_id)`; снятие — `is_active=False` |
| `ops_temporary_duty_permissions` (`TemporaryDutyPermission`) | create / update | `duty_role_code` из `DUTY_ROLE_CHOICES`, окно `starts_at < ends_at` (`full_clean`), `created_by`; `expire` → `is_active=False` |
| `ops_audit_logs` | create | `ACCESS_ACCOUNT_SAVED` (снимок `username/first_name/last_name/email/is_active` до/после), `ACCESS_ACCOUNT_PASSWORD_RESET` (`new_value={"username"}`), `ACCESS_ROLE_GRANTED` (`user_id, role_code, scope_division_id, created`), `ACCESS_ROLE_REVOKED` (по каждой активной строке) |
| Аудит временного права | — | Не реализовано в коде: `grant_temporary_duty`/`expire_temporary_duty` записей в `OpsAuditLog` не делают |
| Отправка временного пароля человеку (почта/SMS) | — | Не реализовано в коде: пароль отдаётся один раз в ответе администратору |

## Бизнес-требования (BR)
- **BR1.** Временный пароль — 16 символов из `abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789`, выдаётся один раз в ответе (`temporary_password`) и нигде не хранится в открытом виде.
- **BR2.** Пароль учётки меняется администратором только сбросом (`reset-password/`), не правкой; заданный при создании пароль проходит валидаторы Django.
- **BR3.** Роль выдаётся с областью: `scope_division_id=null` — вся служба; заданное подразделение накрывает своё поддерево (`DivisionTreeSelector.subtree_ids`). Право без области у грантов с областью не действует на «общие» вопросы (`unscoped_permissions`).
- **BR4.** Снятие роли — деактивация, история выдач сохраняется; администратор не может снять с себя последнюю выдачу с `admin.roles`/`*`.
- **BR5.** Блокировка (`is_active=False`) закрывает вход (UC-GEN-001) и WebSocket (UC-GEN-003); действующие access-токены живут до истечения (до 8 ч) — отзыва токенов нет.
- **BR6.** Временное право действует в окне `[starts_at, ends_at]` при `is_active=True` и участвует в `effective_permissions` наравне с ролями (`_active_grants`).
- **BR7.** Идентификатор человека в RBAC — строка `str(User.pk)` (`LegacyRoleSync.actor_id_for_user`); поле заведено под внешний КУ.
- **BR8.** Поиск учёток — по логину, имени, фамилии, почте; поиск выдач — по логину/ФИО/коду и имени роли.

## Требования к логированию
- `OpsAuditLog`: события из таблицы выше, актор — `resolve_actor_id(request)`; `revoke_role` требует непустого актора (`ValidationError` иначе).
- `LogIPMiddleware`: строка на каждый запрос.
- HTTP-аудит `audit.AuditLog`: `ContentType(operations, account|user-role|temporary-dut)` не существует → записи нет — `Не реализовано в коде`.
- Аудит выдачи/снятия временного права: `Не реализовано в коде`.
- Факт выдачи временного пароля в лог не пишется (только событие аудита без значения) — по замыслу.

## Требования к правам
| Роль | Доступ | Как обеспечивается |
|---|---|---|
| `ADMIN` | полный | `*` |
| `SECURITY_ADMIN` | полный (учётки, выдачи, сброс пароля, временные права) | `admin.roles`; `require_permission(request, "admin.roles")` в каждом методе `AccountViewSet`, `UserRoleViewSet`, `TemporaryDutyViewSet`; экран — `MODULE_PERMISSION["/settings/users"] = "admin.roles"` + `OpsAccessDenied` |
| Все остальные роли | нет | 403 `PERMISSION_DENIED` |
| Вошедший без роли | чтение своих прав и ролей | `/api/operations/my-permissions/` (`permissions`, `roles` с областями) |

## Требования к UX/UI
- «Пользователи» — страница `/settings/users` (eyebrow «Настройки», описание «Учётные записи и их роли. Роль выдаётся с областью: подразделением или всей службой.»): поиск «Поиск по логину, имени, фамилии или почте…», кнопка «Завести учётную запись», таблица «Логин | Человек | Состояние» («Входит» / «Заблокирован»), состояния загрузки / ошибки / «ничего не найдено».
- Панель учётки: кнопки «Сбросить пароль» (подтверждение «Сбросить пароль?» / «Сбросить»), «Заблокировать» (подтверждение «Заблокировать учётную запись?») / «Разблокировать» (без подтверждения); таблица выдач (роль, область — имя подразделения или «Вся служба», кнопка «Снять» → диалог «Снять роль?» с текстом «Роль <code> в области «…» перестанет…», причина отказа сервера при `LAST_ACCESS_ADMIN_ROLE`); блок «Выдать роль»: селект «Роль», селект «Область» (первый пункт «Вся служба» — `WHOLE_SERVICE_VALUE`, далее подразделения), кнопка «Выдать».
- Диалог «Завести учётную запись»: «Логин», «Фамилия», «Имя», «Почта», «Пароль (необязательно)»; клиентских проверок нет — ошибки сервера раскладываются под поля; после успеха поля очищаются.
- Диалог «Временный пароль» (после создания без пароля и после сброса): пароль и кнопка «Скопировать».
- Экран временных прав наряда: `Нет пользовательского интерфейса` (только API `temporary-duty`).

## Открытые вопросы
- Временное право наряда есть только в API (`TemporaryDutyViewSet`), экрана и клиентских хуков нет (`grep temporary-duty` по `app/`, `hooks/`, `entities/` пуст) — причина статуса Partial.
- Выдача/снятие временного права не пишется в `OpsAuditLog`, хотя меняет доступ человека так же, как роль.
- Блокировка учётки не отзывает выданные access-токены (до 8 ч) и не закрывает открытые WebSocket-соединения.
- `AssignRoleRequestSerializer.user_id` — произвольная строка до 100 символов: существование учётки с таким id не проверяется; выдача «в никуда» возможна через API (экран подставляет id выбранной учётки).
- Область роли не проверяется на осмысленность для роли (например, `ADMIN` с областью подразделения) — правило не определено в коде.
- Доставка временного пароля человеку (почта/SMS): `Не реализовано в коде`; пароль виден только в диалоге администратора.
