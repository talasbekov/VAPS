# UC-ADM-004. Просмотреть журнал аудита

| Поле | Значение |
|---|---|
| Модуль | Администрирование и доступ |
| Актор | Ревизор / администратор доступа — держатель `audit.view` (`AUDITOR`, `SECURITY_ADMIN`, `ADMIN`) |
| Статус | Done |
| Основание | `apps/operations/audit_service.py` (`record`, `record_many`, словари `ACTIONS`/`ENTITY_TYPES`), `apps/operations/models_audit.py` (`OpsAuditLog`), миграция `apps/operations/migrations/0006_*` (триггер `ops_audit_logs_append_only`), `AuditLogViewSet` (`/api/operations/audit-logs/`), `OpsAuditLogViewSet` (`/api/ops/audit-logs/`), `apps/audit` (`AuditLog`, `AuditMiddleware`, `/api/audit/logs/`); FRONT `app/security-ops/audit/page.tsx`, `hooks/use-ops-audit.ts`, `entities/audit-log` |
| Дата актуализации | 2026-09-08 |

## Цель
Актор видит, кто, когда и что изменил в разделе ОМ (доменные события с снимками до/после), чтобы разобрать спорную ситуацию.

## Предусловия
- Актор вошёл и имеет `audit.view` (или `*`).
- События записаны сервисами через `audit_service.record` (единственная точка записи; триггер БД запрещает `UPDATE`/`DELETE`).

## Main Flow
1. Актор открывает «Система → Аудит» (`/security-ops/audit`).
2. Система читает `GET /api/ops/audit-logs/` — последние 200 записей `OpsAuditLog`, свежие первыми.
3. Система показывает таблицу: «Дата и время», «Пользователь» (`ID <actorUserId>`), «Действие» (подпись по словарю клиента + код в `title`), «Сущность» (подпись типа + идентификатор), «Изменение» (`oldValue` → `newValue`, причина).
4. Актор вводит текст в поиск; система фильтрует загруженные строки на клиенте по подписи действия, коду, типу сущности, идентификатору, актору и причине.
5. Для программного разбора актор (или интеграция) использует `GET /api/operations/audit-logs/` с фильтрами `entity_type`, `entity_id`, `actor`, `action`, `created_from`/`created_to` (окно `[from, to)`) и пагинацией `DefaultPagination`.

## Alternative Flow
- **AF1. Нет `audit.view`**: шаги 2, 5 → 403 `PERMISSION_DENIED`; экран — `OpsAccessDenied what="журнала аудита"`.
- **AF2. Неизвестный `entity_type` или `action`, `entity_id` без `entity_type`, нечитаемые даты**: шаг 5 → 400.
- **AF3. Запрос не прошёл**: шаг 2 → состояние ошибки на экране.
- **AF4. Попытка изменить/удалить строку журнала (любым путём, включая SQL)**: триггер `trg_ops_audit_logs_append_only` → `RAISE EXCEPTION 'ops_audit_logs дополняется только: <op> запрещён'`.
- **AF5. Запись с незнакомым кодом события/сущности или без актора** (дефект вызывающего кода): `_build` → `ValueError`, строка не пишется, мутация вызывающего откатывается вместе с ней.
- **AF6. Незнакомый код действия/сущности в ответе**: шаг 3 → клиент печатает код как есть (`isKnownAuditAction`/`isKnownAuditEntity`).

## Изменения в системе
| Объект | Действие | Описание |
|---|---|---|
| `ops_audit_logs` (`OpsAuditLog`) | read | чтение по `audit.view`; запись — только сервисами через `record`/`record_many` (в транзакции вызывающего, время — `Clock.now()`) |
| `audit_auditlog` (`audit.AuditLog`, старый HTTP-журнал) | read | `GET /api/audit/logs/` (`IsAuthenticated`, фильтры `AuditLogFilter`, сортировка по `timestamp`); наполняется `AuditMiddleware` на каждый успешный `POST/PUT/PATCH/DELETE` к `/api/`, если `ContentType(app_label=<сегмент 2>, model=<сегмент 3 без s>)` существует и известен `id` объекта |
| Экспорт журнала (CSV/PDF) | — | Не реализовано в коде |

## Бизнес-требования (BR)
- **BR1.** Журнал раздела — append-only: правка и удаление запрещены триггером БД; отложенная запись (`on_commit`, очередь) запрещена — запись синхронна и откатывается вместе с мутацией.
- **BR2.** Словарь событий закрыт и проверяется на записи (`ACTIONS`, `ENTITY_TYPES`): статусы, прикомандирования, увольнение, сдача дня и сводки, документы, паспорта, ОМ (создание/закрытие/удаление/перевод этапа/согласование/возврат/замещающий/старший объекта/сбор сил), рейтинг ГВО, дежурства, настройки, справочники, охраняемые лица, доступ (`ACCESS_PERMISSION_SAVED`, `ACCESS_ROLE_SAVED`, `ACCESS_ROLE_PERMISSIONS_CHANGED`, `ACCESS_ACCOUNT_SAVED`, `ACCESS_ACCOUNT_PASSWORD_RESET`, `ACCESS_ACCOUNT_PASSWORD_CHANGED`, `ACCESS_ROLE_GRANTED`, `ACCESS_ROLE_REVOKED`).
- **BR3.** Строка требует ровно один ключ сущности — `entity_id` (int) или `entity_key` (строка); актор-объект `User` приводится к `pk`, строковые системные акторы (`system:dismissal`, `seed_access_matrix`) допустимы.
- **BR4.** Событие пишется на каждую изменённую строку, а не на операцию (пачка — `record_many` одним моментом времени; сводное событие операции — сверх построчных).
- **BR5.** Снимки `old_value`/`new_value` — плоские JSON-значения (даты строками, без объектов модели).
- **BR6.** Порядок ленты — свежие первыми, при равном времени — по убыванию `id` (`/api/operations/audit-logs/`), по `-created_at, -id` (`/api/ops/audit-logs/`).
- **BR7.** Держатель `audit.view` видит журнал целиком, без сужения по области.

## Требования к логированию
- Сам UC — чтение журнала; запись событий описана в UC-источниках. `LogIPMiddleware` печатает каждый запрос.
- HTTP-аудит `audit.AuditLog` для чтения не пишется (только write-методы).
- Журнал чтения журнала (кто открывал аудит): `Не реализовано в коде`.
- Запись в `OpsAuditLog` полей `request_id`, `ip`, `user_agent`: `Не реализовано в коде` (намеренно, докстринг модели); у старого `audit.AuditLog` они есть (`ip_address`, `user_agent`, `session_id`).

## Требования к правам
| Роль | Доступ | Как обеспечивается |
|---|---|---|
| `ADMIN` | чтение | `*` |
| `SECURITY_ADMIN`, `AUDITOR` | чтение | `audit.view`; `AuditLogViewSet.permission_map = {"list": "audit.view", "retrieve": "audit.view"}`, `OpsAuditLogViewSet.permission_map = {"list": "audit.view"}`; экран — `MODULE_PERMISSION["/security-ops/audit"] = "audit.view"` + `OpsAccessDenied` |
| Все остальные роли | нет | 403 |
| Любая вошедшая учётная запись | чтение старого HTTP-журнала `/api/audit/logs/` | `permission_classes = [IsAuthenticated]` — кодом права раздела не закрыт |
| Запись/правка/удаление | никто | нет write-ручек; триггер БД |

## Требования к UX/UI
- «Аудит» — страница `/security-ops/audit` (eyebrow «Система», описание «Журнал действий раздела ОМ — только для чтения»): поле поиска «Поиск по действию, сущности, пользователю…», таблица с колонками «Дата и время» (110px), «Пользователь» (80px, `ID <id>`), «Действие» (190px, подпись + код в `title`), «Сущность» (150px, подпись + `· <id>`), «Изменение» (≥300px, снимки и причина).
- Состояния: загрузка, ошибка запроса, пустой результат поиска.
- Фильтров по типу/актору/дате, пагинации и экспорта на экране нет; показываются только последние 200 записей.
- Старый HTTP-журнал `/api/audit/logs/` экраном не читается (`Нет пользовательского интерфейса` для него).

## Открытые вопросы
- Экран показывает только 200 последних записей без серверных фильтров и пагинации, хотя `/api/operations/audit-logs/` их поддерживает; клиентский метод `lib/api.ts` для `/api/operations/audit-logs/?limit=` экраном аудита не используется.
- Пользователь в таблице показан только как `ID <actorUserId>` — сопоставления с логином/ФИО нет.
- Два журнала о разном: `OpsAuditLog` (доменные события раздела) и `audit.AuditLog` (HTTP-мутации, только когда URL совпадает с именем модели) — для ручек `/api/ops/*`, `/api/operations/accounts|user-roles|notifications`, `/api/user/*` HTTP-журнал пуст.
- `/api/audit/logs/` открыт любому вошедшему без `audit.view`; там лежат `ip_address`, `user_agent`, `session_id` и `diff` полей.
- В `OpsAuditLog` до Plane №895 часть строк несёт в `actor_user_id` логин, а не id (исправлено приведением в `_build`; миграции данных для старых строк в коде не найдено).
