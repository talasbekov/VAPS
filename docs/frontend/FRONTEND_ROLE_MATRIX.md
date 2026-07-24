# FRONTEND_ROLE_MATRIX

Demo persona → реальный набор permission-кодов → область видимости → временные полномочия.

Persona — `mock-only-demo` runtime-переключатель (`app/mocks/demo-runtime.ts`), НЕ отдельная auth-модель: переключение вызывает существующий `AuthContext.login()` с demo-credential, права по-прежнему приходят через `['me']` (usePermissions). Коды прав ниже — рабочий проект реестра Smart Josparlau; вводятся по мере реализации Этапа 2+, каждый — с owner-feature в `FRONTEND_MOCK_API_CONTRACT.md`.

| Persona (demo) | Роль домена | Permission codes (актуально) | Scope | Временные полномочия |
|---|---|---|---|---|
| event_planner | Организатор ОМ (штаб) | ops.dashboard.view, ops.security_event.view, ops.security_event.create, ops.bulletin.manage, ops.demand.manage, ops.placement.manage, ops.acknowledgement.manage, ops.conduct.manage, ops.closure.manage, ops.dictionary.view, ops.calendar.view | своё управление | — |
| recon_officer | Офицер рекогносцировки | ops.security_event.view, ops.recon.manage, ops.dictionary.view, ops.calendar.view | назначенные ОМ | — |
| broker | Брокер сил (распределение) | ops.force_request.view, ops.force_allocation.manage, ops.dictionary.view | по запросам своей группы | — |
| placement_approver | Утверждающий расстановку | ops.placement.view, ops.placement.approve, ops.dictionary.view | своё управление | — |
| omd_temp | Сотрудник с временными полномочиями ОМД | ops.security_event.view, ops.assignment.replace (ВРЕМЕННО, TemporaryPermissionGrant) | конкретное ОМ, на время его проведения | да — не постоянная роль (D6) |
| objects_admin | Ведение объектов/паспортов/дежурств/справочников | ops.object.view, ops.object.manage, ops.passport.publish, ops.duty.view, ops.duty.manage, ops.dictionary.view, ops.dictionary.manage, ops.calendar.view | свои объекты | — |
| analyst | Аналитика/дашборды/экспорт | ops.analytics.view, ops.export.run, ops.dictionary.view, ops.calendar.view | по scope должности | — |
| admin | Полный доступ (эталон) | `*` (wildcard, как существующий admin) | всё | — |

## Правила
- Permission-коды выше — рабочий план; при реализации каждой стори код фиксируется в `FRONTEND_MOCK_API_CONTRACT.md` и проверяется дважды: на UI (скрытие) и в mock-repository (реальный отказ 403/422) — запрет §35 «проверять права только скрытием кнопки».
- Смена persona обязана: (1) `queryClient.removeQueries(['me'])` через существующий `login()`, (2) сброс feature-кэшей, зависящих от видимости, (3) редирект на корректный стартовый экран новой persona.
- Персональные данные предыдущей persona не должны быть видны после переключения — проверяется тестом на каждую granted-then-revoked операцию.

## Статус
Реализовано: все коды выше реально проверяются в соответствующих `mocks/repository.ts` (permission-check + 403 на отказ), не только на UI — `event_planner`/`recon_officer`/`broker`/`placement_approver` (Этап 2+3), `objects_admin` (Этап 5, +duties Этап 7, +dictionaries Этап 8), `analyst` (Этап 7).

`ops.dictionary.view` (§30, Этап 8) добавлен ВСЕМ non-admin persona выше — частичная реализация «все авторизованные видят разрешённые справочники» в рамках существующего каталога persona (см. FRONTEND_DECISIONS A43); `ops.dictionary.manage` — только `objects_admin` (тематически ближайший текущий владелец: паспорта/дежурства) и `admin`.

`ops.calendar.view` (§25, Этап 9) добавлен `event_planner`/`recon_officer`/`objects_admin`/`analyst` — ролям, уже читающим хотя бы один из композируемых источников календаря (`ops.security_event.view` или `ops.duty.view`) или владеющим аналитикой (`analyst`, прецедент A33/A34); `broker`/`placement_approver` не получили — ни один из их существующих кодов не связан с дежурствами/ОМ-расстановкой напрямую. **Важно**: `ops.calendar.view` НЕ отменяет проверку `ops.duty.view`/`ops.security_event.view` внутри `CalendarPage` — persona с `ops.calendar.view`, но без одного из двух прав (`objects_admin` без `ops.security_event.view`, `analyst` без обоих), видит честный частичный/пустой список с явным объяснением, а не ошибку (см. FRONTEND_DECISIONS A47).

**Известный пробел**: `placement_approver` имеет `ops.placement.approve`, но НЕ `ops.security_event.view` — route guard реестра/детали ОМ требует `ops.security_event.view`, поэтому эта persona физически не может открыть карточку ОМ, чтобы согласовать расстановку. Не проверено, задумано ли это как «approve делается из отдельного экрана-очереди» (Not started) или это упущенный код — не чинить вслепую, уточнить перед Этапом 6. Для ручного end-to-end прогона всего жизненного цикла одной persona использовать `admin` (wildcard).
