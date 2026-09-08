# UC-ADM-001. Управление ролями и правами

| Поле | Значение |
|---|---|
| Модуль | Администрирование и доступ |
| Актор | Администратор доступа — держатель `admin.roles` (`SECURITY_ADMIN`, `ADMIN`) |
| Статус | Done |
| Основание | `apps/operations/models.py` (`Role`, `Permission`, `RolePermission`), `RoleViewSet` / `PermissionViewSet` в `apps/operations/api/views.py` (`/api/operations/roles/`, `/api/operations/permissions/`, `POST roles/{code}/permissions/`), `services.RoleAdminService` (`save_role`, `save_permission`, `change_role_permissions`), `services.PermissionService`, `MyPermissionsViewSet` (`/api/operations/my-permissions/`), `apps/ops/access_catalog.py` + `AccessCatalogViewSet` (`/api/ops/access-catalog/`), `management/commands/seed_operations.py` (`PERMISSIONS`, `ROLES`, `ROLE_PERMISSIONS`); FRONT `app/settings/roles/page.tsx`, `app/settings/permissions/page.tsx`, `hooks/use-access-permissions.ts`, `entities/access/index.ts`, `hooks/use-ops-permissions.ts` |
| Дата актуализации | 2026-09-08 |

## Цель
Администратор заводит и включает/выключает права и роли и собирает состав прав роли, чтобы выдача роли человеку (UC-ADM-002) открывала ровно нужные функции.

## Предусловия
- Актор вошёл и имеет `admin.roles` (или `*`).
- Справочники засеяны `manage.py seed_operations` (роли и права из `PERMISSIONS`/`ROLES`/`ROLE_PERMISSIONS`; команда идемпотентна).

## Main Flow
1. Актор открывает «Настройки → Права» (`/settings/permissions`); система читает `GET /api/operations/permissions/?search=` и каталог `GET /api/ops/access-catalog/`.
2. Актор выбирает право и видит, какие ручки/функции оно открывает (каталог собирается из `permission_map` вьюсетов и построчных `require_permission(...)` разбором исходника).
3. Актор нажимает «Новое право», вводит код, название, описание → `POST /api/operations/permissions/`; система создаёт `Permission` и пишет аудит.
4. Актор переключает состояние права «Отключить/Включить» → `PATCH /api/operations/permissions/{code}/` с `is_active`.
5. Актор открывает «Настройки → Роли» (`/settings/roles`); система читает `GET /api/operations/roles/?search=` (с составом `permissions`).
6. Актор нажимает «Новая роль», вводит код (например, `ARCHIVIST`), название, описание → `POST /api/operations/roles/`.
7. Актор в блоке «Состав прав» добавляет право из справочника (поиск по справочнику) или снимает его с подтверждением «Снять право с роли?» → `POST /api/operations/roles/{code}/permissions/` с `{"add": [...], "remove": [...]}`.
8. Система меняет `RolePermission`, пишет аудит с составом до/после и возвращает роль; у всех держателей роли права меняются немедленно — клиент инвалидирует `["ops-me"]`, и `GET /api/operations/my-permissions/` отдаёт свежий набор.
9. Актор переключает состояние роли «Отключить/Включить» → `PATCH /api/operations/roles/{code}/`.

## Alternative Flow
- **AF1. Нет права `admin.roles`**: любой шаг → 403 `PERMISSION_DENIED` (`require_permission`); экран показывает `OpsAccessDenied what="справочника ролей"` / `"справочника прав"`.
- **AF2. `add` и `remove` оба пусты**: шаг 7 → 400 «add or remove must be non-empty».
- **AF3. Одно право и в `add`, и в `remove`**: шаг 7 → 400 «permission listed in both add and remove: […]».
- **AF4. Неизвестный код права в `add`**: шаг 7 → 400 «unknown permission: […]»; коды в `remove` не проверяются (снятие несуществующего — холостое).
- **AF5. Состав после правки совпал с составом до**: шаг 8 → запись аудита не пишется, ответ 200.
- **AF6. Ошибки полей формы (пустой код/название, превышение `max_length` 50/100/255)**: шаги 3, 6 → 400 от `ModelSerializer`; ошибки раскладываются под поля диалога (`setFieldErrors`).
- **AF7. Повторный `POST` с существующим кодом**: `save_*` делает `update_or_create` — сервис перезаписал бы запись, но `ModelSerializer` с `code` как первичным ключом отбивает дубликат валидацией уникальности (400).
- **AF8. Каталог не загрузился**: шаг 2 → в панели права состояние ошибки (`isCatalogError`), список прав показывается.

## Изменения в системе
| Объект | Действие | Описание |
|---|---|---|
| `ops_permissions` (`Permission`) | create / update | `code` (pk, ≤100), `name`, `description`, `is_active`; удаление не предусмотрено (нет `destroy`) |
| `ops_roles` (`Role`) | create / update | `code` (pk, ≤50), `name`, `description`, `is_active`; удаления нет |
| `ops_role_permissions` (`RolePermission`) | create / delete | `get_or_create` для `add`, `delete` для `remove`; уникальность `(role_code, permission_code)` |
| `ops_audit_logs` | create | `ACCESS_PERMISSION_SAVED` (entity `access_permission`, `entity_key=code`), `ACCESS_ROLE_SAVED` (`access_role`), `ACCESS_ROLE_PERMISSIONS_CHANGED` (`old/new_value={"permissions": [...]}`) |
| Эффективные права держателей роли | read | `PermissionService.effective_permissions` читает `RolePermission` при каждом запросе — кэша нет, изменения действуют сразу |

## Бизнес-требования (BR)
- **BR1.** Право — то, что проверяют ручки (`permission_map`, `require_permission`, `require_scoped_permission`); каталог применения не хранится, а собирается из кода при запросе.
- **BR2.** Код `*` даёт все права (`WILDCARD`); `has_permission` возвращает `True` при `*` в эффективном наборе.
- **BR3.** Роли и права не удаляются — только выключаются `is_active`. `PermissionService.roles_holding` и `effective_permissions` флаг `is_active` роли/права НЕ учитывают (намеренно, по комментарию `roles_holding`): выключенное право продолжает действовать у роли, пока оно в `RolePermission`.
- **BR4.** Правка состава — атомарная операция «добавить и снять одним обращением»; событие аудита пишется только при фактическом изменении.
- **BR5.** Эталонный состав ролей — `ROLE_PERMISSIONS` в `seed_operations.py`; `ADMIN` = `["*"]`, `SECURITY_ADMIN` = `admin.roles`, `audit.view`, `orgstructure.view`, `personnel.view`.
- **BR6.** Эффективные права актора считаются по активным выдачам `UserRole` и действующим `TemporaryDutyPermission` с учётом области (`scope_division_id` → поддерево подразделений).
- **BR7.** Поиск по коду/названию/описанию — `icontains`, параметр `search`; списки пагинированы `DefaultPagination`.

## Требования к логированию
- `OpsAuditLog`: три события выше, актор — `resolve_actor_id(request)` (id учётки), синхронно в транзакции; `ACCESS_ROLE_PERMISSIONS_CHANGED` содержит полный состав до/после.
- `LogIPMiddleware`: строка на каждый запрос.
- HTTP-аудит `audit.AuditLog`: `ContentType(operations, role|permission)` находится, но в ответе нет ключа `id` (pk — `code`), поэтому `target_object_id` пуст и запись не создаётся — `Не реализовано в коде`.
- Сообщение об ошибке валидации в лог: `Не реализовано в коде` (только ответ 400).

## Требования к правам
| Роль | Доступ | Как обеспечивается |
|---|---|---|
| `ADMIN` | полный | `*` в `ROLE_PERMISSIONS` |
| `SECURITY_ADMIN` | полный | `admin.roles`; `require_permission(request, "admin.roles")` в `list/retrieve/create/update/permissions` `RoleViewSet` и `PermissionViewSet`; `AccessCatalogViewSet.permission_map = {"list": "admin.roles"}`; экраны — `MODULE_PERMISSION["/settings/roles"|"/settings/permissions"] = "admin.roles"`, гейт `OpsAccessDenied`; пункт «Настройки» в меню шапки — `hasPermission("admin.roles")` |
| Все остальные роли | нет (в т.ч. чтение) | 403 `PERMISSION_DENIED` |
| Любая вошедшая учётная запись | чтение своих прав | `GET /api/operations/my-permissions/[?division_id=]` — без кода права |

## Требования к UX/UI
- «Права» — страница `/settings/permissions` (eyebrow «Настройки», описание «Право — это то, что проверяют ручки системы…»): поиск «Поиск по коду, названию или описанию…», кнопка «Новое право», таблица «Код | Название | Состояние», панель выбранного права с кнопкой «Отключить/Включить» и списком функций из каталога (состояния загрузки/ошибки каталога), состояния списка: загрузка / ошибка / пусто.
- Диалог «Новое право»: поля «Код», «Название», «Описание»; ошибки сервера под полями; после создания диалог сбрасывается.
- «Роли» — страница `/settings/roles` (описание «Роль — это набор прав, который выдают человеку…»): поиск, кнопка «Новая роль», таблица «Код | Название | (число прав) | Состояние», панель роли: «Отключить/Включить», «Состав прав» (список с кнопками «Снять»), поиск «Поиск по справочнику прав…» для добавления; диалог подтверждения «Снять право с роли?».
- Диалог «Новая роль»: «Код» (placeholder «например, ARCHIVIST»), «Название» («Архивариус»), «Описание» («Кому и зачем выдаётся эта роль»); ошибки под полями.
- Обязательность на клиенте не проверяется — полагается на 400 сервера; масок нет.
- Раздел `/settings/*` рендерится под клиентским `layout.tsx` (ожидание мок-воркера «Загрузка раздела…»); `/settings` — реэкспорт страницы `/security-ops/settings` (UC-ADM-003).

## Открытые вопросы
- Выключенное право/роль (`is_active=False`) продолжает действовать в `effective_permissions` — «Отключить» на экране меняет только справочник, но не доступ; в комментарии `roles_holding` это названо намеренным, на экране не объяснено.
- `save_role`/`save_permission` в сервисе — `update_or_create` по коду, то есть `POST` с существующим кодом на уровне сервиса перезаписывает запись; защищает только валидация сериализатора.
- Удаление ошибочно заведённой роли/права: `Не реализовано в коде`.
- Каталог применения читает `permission_map` и построчные гейты разбором `ast`; права, проверяемые иным способом (например, `permission_bypass_map`, `permission_override`), в каталог попадают только если их читает `_inline_codes`/`_rows` — проверка полноты каталога кодом не гарантируется.
- Пункт «Настройки» в меню шапки (`header.tsx`) не имеет `onClick`/ссылки — открывает ничего.
