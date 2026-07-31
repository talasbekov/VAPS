---
baseline_commit: a18deed
---

# Story 14.11j: Frontend — список + создание планов дежурств

Status: ready-for-dev

## Story

As an **оператор с правом `duty.manage`**,
I want **страницу списка планов дежурств с формой создания**,
so that **планы дежурств видны и создаются через UI, не только через API**.

Десятая (вторая frontend) из ~12 подсторий разделения 14.11.

## Scope Decision (найдено при create-story, research-агент)

- **Новый route `/duty-plans`, право `duty.manage`.** НЕ переиспользует `ROUTES.duties` (`/duties`) — та ведёт на `features/duties/DutyPlanPage` (Smart Josparlau, чужой бэк `/api/ops/*`, коды `ops.duty.view`/`ops.duty.manage`). Это РАЗНЫЕ системы (see 14.11i's Scope Decision, коллизия разрешена пользователем) — новый nav-пункт «Планы дежурств» (мн. число, отличимо от существующего «План дежурств», ед. число) со своей иконкой.
- **Паттерн — буквально `SecurityEventsListPage.tsx` + `CreateSecurityEventDialog.tsx`** (лучший прецедент «список+создание» на реальной, не pending-contract, схеме): таблица с `isLoading`/`isError`/`isEmpty`-ветками, кнопка «+ Создать план» открывает нативный `<dialog>`+`showModal()` (ЕДИНЫЙ канон модалок, не второй UI-kit), React Hook Form + Zod, 400-ошибки → `setError` по DRF-деталям (`ApiError.details`).
- **Object-picker — ЗАГЛУШКА, числовое поле `object` (ID), НЕ выпадающий список.** Research подтвердил: `features/objects/` — тоже pending-contract (свой `SecurityObject`, не реальный `Object`/`ObjectPassport` из 14.1), в `schema.d.ts` НЕТ пути на список объектов (`grep "/api/.*object" schema.d.ts` — пусто). Построить настоящий picker — либо новая backend-стори (эндпоинт объектов ещё не выставлен HTTP), либо расширение объёма ВНЕ этой стори. Числовое поле — осознанный, документированный stopgap; полноценный picker — future work, когда объекты получат свой список-эндпоинт.
- **После успешного создания — остаться на списке, НЕ навигировать на деталь-страницу.** 14.11k (грид смен, деталь-страница ОДНОГО плана) ещё не существует — `securityEventDetailTo`-паттерн (навигация на деталь после создания) неприменим, детали пока некуда вести.
- **Никаких approve/cancel/replan-кнопок, никакого грида смен на этой странице** — 14.11k/l.
- **Тесты права — через `server.use()`-оверрайд `/api/operations/my-permissions/`** (прецедент `app-layout.qa.test.tsx`), НЕ через новую demo-персону в `demo-personas.ts` (никто ещё не запросил постоянную демо-персону с `duty.manage` — добавление её — расширение объёма, не эта стори).
- **MSW-хендлеры — новый `duty-plans/mocks/handlers.ts` + `fixtures.ts`**, зеркалящие реальный DRF-конверт (`{count, next, previous, results}` для list, `201`+объект для create) — прецедент `personnel/mocks/handlers.ts` (реальная, не pending-contract, схема). Регистрируется в `app/mocks/compose-handlers.ts`/`compose-seed.ts` (dev:mock demo-режим).

## Acceptance Criteria

1. **AC-1 (список — таблица с колонками объект/год/месяц/статус).** `duty.manage` → страница `/duty-plans` показывает таблицу `useDutyPlans()`'s результатов.
2. **AC-2 (пустое состояние).** Ноль планов → сообщение, не пустая таблица.
3. **AC-3 (ошибка загрузки).** Список 5xx/сетевая ошибка → сообщение об ошибке, не краш.
4. **AC-4 (гейт права).** Без `duty.manage` — маршрут заблокирован `RequirePermission` (тот же паттерн отказа, что остальные разделы).
5. **AC-5 (создание — форма).** Кнопка «+ Создать план» открывает `<dialog>` (год/месяц/object-ID числовые поля, RHF+Zod).
6. **AC-6 (успех — список обновляется, диалог закрывается, БЕЗ навигации).** `useCreateDutyPlan`'s инвалидация уже есть (14.11i) — новый план виден в списке без reload; диалог закрывается; НЕ переходим на деталь-страницу (её нет).
7. **AC-7 (400 → инлайн-ошибки полей).** Серверная 400-валидация (например дубль object+year+month) → `setError` по полю, форма остаётся открытой.
8. **AC-8 (регресс нулевой).** `npm run gate` зелёный; `features/duties/` (Smart Josparlau) не тронута.

## Out of Scope

- Настоящий object-picker (выпадающий список) — future work, требует нового backend-эндпоинта списка объектов.
- Грид смен плана, детали ОДНОГО плана — 14.11k.
- approve/cancel/replan-кнопки — 14.11l.
- Постоянная demo-персона с `duty.manage` в `demo-personas.ts` — не запрошена, тесты используют `server.use()`-оверрайд.

## Tasks / Subtasks

- [ ] Task 1 — `ROUTES.dutyPlans`/`NAV_SECTIONS`-запись (AC: 1, 4)
  - [ ] `frontend/src/shared/routes.ts` — новый путь `/duty-plans`, nav-пункт «Планы дежурств», право `duty.manage`
- [ ] Task 2 — `DutyPlansListPage.tsx` (AC: 1-3)
  - [ ] `frontend/src/features/duty-plans/pages/DutyPlansListPage.tsx` — таблица, isLoading/isError/isEmpty
- [ ] Task 3 — `CreateDutyPlanDialog.tsx` (AC: 5-7)
  - [ ] `frontend/src/features/duty-plans/pages/CreateDutyPlanDialog.tsx` — нативный dialog, RHF+Zod (год/месяц/object-ID), setError на 400
- [ ] Task 4 — Роутинг (AC: 4)
  - [ ] `frontend/src/app/App.tsx` — `lazy`-импорт, `<Route>` за `RequirePermission permission="duty.manage"`
- [ ] Task 5 — MSW-хендлеры (AC: 1-3, 5-7)
  - [ ] `duty-plans/mocks/handlers.ts`/`fixtures.ts`, регистрация в `compose-handlers.ts`
- [ ] Task 6 — Тесты (AC: 1-8)
  - [ ] Page-тест (RTL+MSW, `server.use()`-паттерн из `app-layout.qa.test.tsx`): список/пусто/ошибка/гейт-права/создание-успех/создание-400
  - [ ] `npm run gate` зелёный, явно прогнан

## Dev Notes

- Читать `frontend/src/features/security-events/pages/SecurityEventsListPage.tsx`/`CreateSecurityEventDialog.tsx` (буквальный образец) и `frontend/src/app/app-layout.qa.test.tsx` (паттерн `server.use()`-оверрайда прав в тестах) ПЕРЕД имплементацией.
- `useDutyPlans`/`useCreateDutyPlan` уже готовы (14.11i, `duty-plans/api/queries.ts`).
- НЕ трогать `features/duties/` (Smart Josparlau) — отдельная, не связанная фича.

### References

- [Source: frontend/src/features/security-events/pages/SecurityEventsListPage.tsx] — буквальный образец списка.
- [Source: frontend/src/features/security-events/pages/CreateSecurityEventDialog.tsx] — буквальный образец диалога создания.
- [Source: frontend/src/app/app-layout.qa.test.tsx] — паттерн `server.use()`-оверрайда прав для тестов.
- [Source: frontend/src/features/personnel/mocks/handlers.ts] — паттерн MSW-хендлеров на реальной схеме.
- [Source: frontend/src/features/duty-plans/api/queries.ts] — готовые хуки (14.11i).

## Dev Agent Record

### Context Reference

- Research-агент при create-story: `SecurityEventsListPage`/`CreateSecurityEventDialog` — лучший прецедент; object-picker невозможен полноценно (нет backend-эндпоинта списка объектов) — числовое поле как stopgap; тесты прав — `server.use()`-оверрайд, не новая demo-персона.

### Completion Notes

### File List

## Change Log

| Дата | Изменение |
|---|---|
| 2026-07-31 | Story создана (create-story). Десятая (вторая frontend) из ~12 подсторий разделения 14.11. Новый route /duty-plans (не /duties — та занята Smart Josparlau). Object-picker — числовое ID-поле (stopgap, нет backend-эндпоинта списка объектов). После создания — остаться на списке (14.11k деталь-страницы ещё нет). Тесты прав — server.use()-оверрайд, не новая demo-персона. |
