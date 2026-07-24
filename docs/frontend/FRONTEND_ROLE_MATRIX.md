# FRONTEND_ROLE_MATRIX

Demo persona → реальный набор permission-кодов → область видимости → временные полномочия.

Persona — `mock-only-demo` runtime-переключатель (`app/mocks/demo-runtime.ts`), НЕ отдельная auth-модель: переключение вызывает существующий `AuthContext.login()` с demo-credential, права по-прежнему приходят через `['me']` (usePermissions). Коды прав ниже — рабочий проект реестра Smart Josparlau; вводятся по мере реализации Этапа 2+, каждый — с owner-feature в `FRONTEND_MOCK_API_CONTRACT.md`.

| Persona (demo) | Роль домена | Permission codes (план) | Scope | Временные полномочия |
|---|---|---|---|---|
| event_planner | Организатор ОМ (штаб) | ops.dashboard.view, ops.security_event.view, ops.security_event.create, ops.bulletin.manage, ops.demand.manage, ops.placement.manage, ops.acknowledgement.manage, ops.conduct.manage, ops.closure.manage | своё управление | — |
| recon_officer | Офицер рекогносцировки | ops.security_event.view, ops.recon.manage | назначенные ОМ | — |
| broker | Брокер сил (распределение) | ops.force_request.view, ops.force_allocation.manage | по запросам своей группы | — |
| placement_approver | Утверждающий расстановку | ops.placement.view, ops.placement.approve | своё управление | — |
| omd_temp | Сотрудник с временными полномочиями ОМД | ops.security_event.view, ops.assignment.replace (ВРЕМЕННО, TemporaryPermissionGrant) | конкретное ОМ, на время его проведения | да — не постоянная роль (D6) |
| objects_admin | Ведение объектов/паспортов | ops.object.view, ops.object.manage, ops.passport.publish | свои объекты | — |
| analyst | Аналитика/дашборды/экспорт | ops.analytics.view, ops.export.run | по scope должности | — |
| admin | Полный доступ (эталон) | `*` (wildcard, как существующий admin) | всё | — |

## Правила
- Permission-коды выше — рабочий план; при реализации каждой стори код фиксируется в `FRONTEND_MOCK_API_CONTRACT.md` и проверяется дважды: на UI (скрытие) и в mock-repository (реальный отказ 403/422) — запрет §35 «проверять права только скрытием кнопки».
- Смена persona обязана: (1) `queryClient.removeQueries(['me'])` через существующий `login()`, (2) сброс feature-кэшей, зависящих от видимости, (3) редирект на корректный стартовый экран новой persona.
- Персональные данные предыдущей persona не должны быть видны после переключения — проверяется тестом на каждую granted-then-revoked операцию.

## Статус
Реализовано (Этап 2+3): все коды в `event_planner`, `recon_officer`, `broker`, `placement_approver` реально проверяются в `mocks/repository.ts` (permission-check + 403 на отказ), не только на UI. `objects_admin`/`analyst` — план, ещё не подкреплены реализацией (Этапы 5-6).

**Известный пробел**: `placement_approver` имеет `ops.placement.approve`, но НЕ `ops.security_event.view` — route guard реестра/детали ОМ требует `ops.security_event.view`, поэтому эта persona физически не может открыть карточку ОМ, чтобы согласовать расстановку. Не проверено, задумано ли это как «approve делается из отдельного экрана-очереди» (Not started) или это упущенный код — не чинить вслепую, уточнить перед Этапом 6. Для ручного end-to-end прогона всего жизненного цикла одной persona использовать `admin` (wildcard).
