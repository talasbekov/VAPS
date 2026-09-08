# UC-ORG-003. Управление кадровыми справочниками

| Поле | Значение |
|---|---|
| Модуль | Оргструктура и кадры |
| Актор | `REFERENCE_ADMIN` (`dictionary.view`, `dictionary.manage`), `ADMIN`; чтение типов статусов — также держатели `status.view` |
| Статус | Done |
| Основание | `apps/dictionaries/models.py` (`Position`, `Rank`, `StatusType`, `DismissalReason`, `TransferReason`, `VacancyReason`, `EducationType`, `DocumentType`, `SystemSetting`), `apps/dictionaries/api/views.py` (`_StaffDictionaryViewSet`, `PositionViewSet`, `RankViewSet`, `StatusTypeViewSet`), `apps/dictionaries/api/urls.py`, `apps/dictionaries/archived.py` (`ARCHIVED_DICTIONARIES`), `apps/dictionaries/management/commands/{init_dictionaries,seed_positions_ranks}.py`, `apps/operations/status_types.py` (`StatusType`), `apps/operations/api/views.py` (`StatusTypeViewSet`, `/api/operations/status-types/`), `apps/operations/management/commands/seed_status_types.py`, `apps/core/api/views.py` (`PositionViewSet`, `RankViewSet`), FRONT `app/security-ops/dictionaries/page.tsx`, `app/security-ops/dictionaries/personnel/[kind]/page.tsx`, `app/security-ops/dictionaries/status-types/page.tsx`, `entities/staff-dictionary/index.ts`, `hooks/use-staff-dictionaries.ts` |
| Дата актуализации | 2026-09-08 |

## Цель
Актор ведёт справочники должностей и званий (просмотр, добавление, правка, удаление) и просматривает канонический справочник типов статусов.

## Предусловия
- Актор вошёл в систему; у него есть `dictionary.view` (просмотр) и `dictionary.manage` (правка).
- Справочники заполнены сидом (`seed_positions_ranks`, `seed_status_types`) либо руками.

## Main Flow
1. Актор открывает «Система → Справочники» (`/security-ops/dictionaries`) — система показывает реестр справочников раздела ОМ и блок кадровых справочников: «Должности», «Звания»; отдельной строкой — «Типы статусов».
2. Актор открывает «Должности» (`/security-ops/dictionaries/personnel/positions`) — система запрашивает `GET /api/dictionaries/positions/` и показывает строки: название, код, уровень.
3. Актор заполняет карточку «Добавить значение» (Название, Код, Уровень) и нажимает «Добавить» — система выполняет `POST /api/dictionaries/positions/`, список обновляется.
4. Актор нажимает «Изменить» у строки, правит поля, нажимает «Сохранить» — система выполняет `PUT /api/dictionaries/positions/{id}/`.
5. Актор нажимает «Удалить» — система выполняет `DELETE /api/dictionaries/positions/{id}/`; если на должность ссылаются штатные единицы, отказ с числом ссылок.
6. Те же шаги для «Званий» (`/security-ops/dictionaries/personnel/ranks`, `/api/dictionaries/ranks/`).
7. Актор открывает «Типы статусов» (`/security-ops/dictionaries/status-types`) — система запрашивает `GET /api/operations/status-types/` и показывает канонический каталог (код, название, приоритет, жёсткая блокировка, признак «неактивен»).
8. Справочники должностей и званий читают штатное расписание (UC-ORG-002), карточка сотрудника и `/api/core/positions/`, `/api/core/ranks/` (донорский контракт, ключ — `code`).

## Alternative Flow
- **AF1. Нет `dictionary.view`**: шаги 1–2, 7 → экран `OpsAccessDenied` «справочников»; бэкенд отвечает 403 (`RequirePermissionMixin`).
- **AF2. Нет `dictionary.manage`**: шаги 3–5 → форма добавления и кнопки «Изменить»/«Удалить» не показываются (`canManage`); бэкенд — 403.
- **AF3. Удаление используемой строки**: шаг 5 → 400 `{"detail": "Должность используется в штатном расписании (N) — сначала снимите эти назначения."}` (для звания — по `employee_set`); вторая линия — `ProtectedError` → 400 «… используется — удалить нельзя.» вместо 500.
- **AF4. Дубль кода или имени**: шаги 3–4 → 400 от `ModelSerializer` (`code` и `name` уникальны на модели).
- **AF5. Неизвестный `kind` в адресе**: `staffDictionaryOf(kind) === null` → «Справочник не найден».
- **AF6. Ошибка запроса списка**: врезка `LoadFailure` с повтором; ошибка мутации — текст `failure.message` под формой.
- **AF7. Карточка по коду `/api/core/positions/{code}/` с несуществующим кодом**: 404.

## Изменения в системе
| Объект | Действие | Описание |
|---|---|---|
| `dictionaries.Position` | create / update / delete | Поля `name`, `code` (уникален), `level` |
| `dictionaries.Rank` | create / update / delete | Поля `name` (уникально), `code` (уникален), `level`; сериализатор `fields='__all__'` |
| `operations.StatusType` (`/api/operations/status-types/`) | read | Правка только сидом `seed_status_types` (канон пересинхронизируется из кода) |
| `dictionaries.StatusType`, `DismissalReason`, `TransferReason`, `VacancyReason`, `EducationType`, `DocumentType`, `SystemSetting` | — | Архивные (`ARCHIVED_DICTIONARIES`): таблицы остаются, не показываются ни в Admin, ни в API |
| `audit.AuditLog` | create | `AuditMiddleware` разрешает `ContentType` `dictionaries.position` / `dictionaries.rank` из пути `/api/dictionaries/positions/` → запись `CREATE`/`UPDATE`/`DELETE` с `diff` old/new для `PUT/PATCH` |

## Бизнес-требования (BR)
- **BR1.** Чтение кадровых справочников — по `dictionary.view`, правка — по `dictionary.manage` (то же право, что у справочников ОМ; решение заказчика 28.08.2026).
- **BR2.** Строка справочника, на которую ссылается хотя бы одна штатная единица (должность) или сотрудник (звание), не удаляется; отказ называет число ссылок.
- **BR3.** `Position.code`, `Rank.code`, `Rank.name` уникальны; `level` — целое (`SmallIntegerField`), сортировка `/api/core/` — по `level`, `name`, `id`.
- **BR4.** Ключ должностей и званий в контракте `/api/core/` — `code` (lookup по коду, регулярное выражение допускает точку); `sort_order`, `category`, `is_active` в этом контракте всегда `null`.
- **BR5.** Справочник типов статусов один — `operations.StatusType` (`code` — PK, `name`, `priority`, `is_hard_block`, `report_column_code`, `counts_in_list`, `counts_in_staff`, `restricts_editing`, `max_duration_days`, `is_active`, `is_placeholder`, `legacy_code` уникален); читается по `status.view` ИЛИ `dictionary.view`; запись по HTTP не открыта.
- **BR6.** Легаси `GET /api/dictionaries/status_types/` отдаёт перечисление `EmployeeStatus.StatusType` из кода, а не строки таблицы `dictionaries.StatusType`.
- **BR7.** Семь справочников (`StatusType`, `DismissalReason`, `TransferReason`, `VacancyReason`, `EducationType`, `DocumentType`, `SystemSetting`) архивированы решением заказчика 27.08.2026 (Plane №200) — данные не удалены, показ закрыт везде, проба стережёт.

## Требования к логированию
- `AuditMiddleware` → `audit.AuditLog` на успешные `POST/PUT/PATCH/DELETE /api/dictionaries/positions/`, `/api/dictionaries/ranks/` (пользователь, IP, user-agent, `object_id` из ответа/пути, `diff` для обновления).
- `OpsAuditLog` (`audit_service.DICTIONARY_ENTRY_CREATED` / `_UPDATED` / `_SET_ACTIVE` / `_DELETED`) для кадровых справочников: `Не реализовано в коде` — эти действия пишут справочники раздела ОМ (`/api/ops/dictionaries/`), `_StaffDictionaryViewSet` `audit_service` не зовёт.
- Просмотр справочников не логируется, кроме `LogIPMiddleware` (`print`).

## Требования к правам
| Роль | Доступ | Как обеспечивается |
|---|---|---|
| `ADMIN` | полный | `*` |
| `REFERENCE_ADMIN` | полный (должности, звания), чтение типов статусов | `permission_map`: `list`/`retrieve` → `dictionary.view`, `create`/`update`/`partial_update`/`destroy` → `dictionary.manage`; `StatusTypeViewSet` — `require_any_permission("status.view", "dictionary.view")` |
| Держатели `status.view` (`EMPLOYEE`, `DIRECTORATE_HEAD`, `DEPARTMENT_EXPENSE_OFFICER`, `DUTY_OFFICER`, `OPS_STAFF`, `DUTY_PLANNER`, `ANALYST`, `AUDITOR`, `HEAD_*`, `EMPLOYEE_OPS_D2`, `FORCES_GATHERING_OFFICER`) | чтение типов статусов | `require_any_permission("status.view", "dictionary.view")`; страница `/security-ops/dictionaries/status-types` открывается по любому из двух прав |
| Держатели `orgstructure.view` (см. UC-ORG-001) | чтение должностей и званий в контракте `/api/core/positions/`, `/api/core/ranks/` | `permission_map` → `orgstructure.view` |
| Остальные роли (`EVENT_OFFICER`, `PATROL_LEAD`, `GVO_LEAD`, `EVENT_APPROVER`, `OBJECT_KEEPER`, `RATING_EVALUATOR`, `FEEDBACK_TRIAGE`, `SECURITY_ADMIN`, `INTEGRATION_USER`, `OM_CATEGORY_ORG`, `OVERVIEW_DEPARTMENT`, `OPS_STAFF_COMMAND`) | нет к `/api/dictionaries/`, к странице | 403; `OpsAccessDenied` |
| Любой вошедший | чтение легаси `GET /api/dictionaries/status_types/` | `IsAuthenticated` |

## Требования к UX/UI
- Страница «Справочники» (`/security-ops/dictionaries`, eyebrow «Система», метка «В разработке: Справочник стран и городов (№417)» из `in-development.ts` для всего раздела): реестр справочников ОМ карточками-ссылками и блок кадровых справочников со ссылками «Должности», «Звания».
- Страница справочника (`/security-ops/dictionaries/personnel/[kind]`): заголовок по `meta.label`; список строк карточками `RowCard` (название, код, уровень; кнопки «Изменить», «Удалить» только с `dictionary.manage`); режим правки строки — поля Название, Код, Уровень, кнопки «Отмена», «Сохранить» («Сохранение…» пока `isSaving`); карточка «Добавить значение» — `Label`/`Input` «Название» (`new-name`), «Код» (`new-code`), «Уровень» (`new-level`), кнопка «Добавить» («Добавление…» пока `isPending`).
- Состояния: «Загрузка…», пустой список (карточка с текстом), `LoadFailure` с повтором, `failure.message` при ошибке мутации, «Справочник не найден», `OpsAccessDenied`.
- Страница «Типы статусов» (`/security-ops/dictionaries/status-types`): таблица канонических типов с бейджем «неактивен» у `is_active=false`; только чтение; `LoadFailure` с повтором.
- Обязательность полей и маски на клиенте: `Не определено в коде` (валидация — только ответ сервера).

## Открытые вопросы
- Легаси `GET /api/dictionaries/status_types/` отдаёт перечисление из кода, дублируя канон `/api/operations/status-types/`; читателей на фронте нет (клиент ходит в `/api/statuses/types/` и `/api/operations/status-types/`).
- Четыре архивных справочника требуются каноном (UC-DICT-005 «Причины», UC-DICT-006 «Системные настройки») — архив принят заказчиком с этим знанием; в UI причин увольнения/перевода/вакансии нет.
- `RankSerializer` отдаёт `fields='__all__'` (включая `created_at`/`updated_at`), `PositionSerializer` — только `id`, `name`, `code`, `level`; контракты двух однотипных справочников различаются.
- Клиентская форма не проверяет пустые поля и число в «Уровень» — ошибки приходят только от сервера.
- Правка канона типов статусов доступна только сидом; в «Система → Справочники» строка есть, действий нет — по решению в коде («канон пересинхронизируется из кода»).
- Метка «В разработке» на всём разделе `/security-ops/dictionaries` (№417 — страны и города) наследуется и кадровыми справочниками, у которых открытых карточек нет.
