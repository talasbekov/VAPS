---
baseline_commit: ced993d
---

# Story 14.11i: Frontend — контракт (API-клиент) плана дежурств

Status: done

## Story

As a **фронтенд-разработчик**,
I want **типизированный API-клиент над `/api/operations/duty-plans/*` (7 эндпоинтов, схема из 14.11h)**,
so that **14.11j-l (список/грид/действия) строятся на готовом, типобезопасном слое, не изобретают fetch заново**.

Девятая (первая frontend) из ~12 подсторий разделения 14.11.

## Scope Decision (найдено при create-story, research-агент + AskUserQuestion)

- **КОЛЛИЗИЯ ИМЁН, разрешена явным вопросом пользователю**: `frontend/src/features/duties/` УЖЕ занята — Smart Josparlau's `DutyPlanPage` (коммит `832d19f`), роутится в `App.tsx`, ходит по `/api/ops/duty-shifts/`/`/api/ops/duty-types/` через `pending-contracts.ts` (backend НЕ существует, статус `backend-contract-pending`). Это ДРУГАЯ система, не Epic 14's `/api/operations/duty-plans/`. **Решение пользователя: новая папка `frontend/src/features/duty-plans/`** — старая `duties/` НЕ трогается (не переименовывается, не удаляется, её роут в `App.tsx` остаётся как есть). Два похожих по смыслу экрана в разных местах приложения — принятый риск, не эта стори его разрешает.
- **Паттерн — `paths[...]`-производные типы, без ручного дублирования** (прецедент `frontend/src/features/personnel/api/queries.ts`): каждый эндпоинт получает `type XResponse = paths['/api/operations/duty-plans/...']['get']['responses']['200']['content']['application/json']`, вычисленный из `frontend/src/shared/api/schema.d.ts` (14.11h, уже полный).
- **Переиспользуется существующий `apiClient`** (`frontend/src/shared/api/client.ts`, `get<T>`/`post<T>`/`patch<T>`/`del<T>`) — НИКАКОГО сырого `fetch`/`XHR` (ARCH-FE-015, eslint-enфорсед). Ошибки — через существующий `ApiFailure`/`parseErrorResponse` (`shared/api/errors`).
- **`@tanstack/react-query`-хуки, не голые функции** — `useQuery`/`useMutation`, query keys `['duty-plans', ...]`, мутации инвалидируют релевантные ключи (`queryClient.invalidateQueries`).
- **НЕТ MSW-хендлеров, НЕТ UI, НЕТ юнит-тестов на сам `queries.ts`.** Прецедент (research-агент, прямой grep): ни один существующий `queries.ts` в кодовой базе не тестируется отдельно — тестирование идёт через страницы-потребители (MSW-хендлеры + page-тесты). MSW-хендлеры для `/api/operations/duty-plans/*` — 14.11j's территория (первый реальный потребитель).
- **`tsc -b`/`eslint` — единственная проверка этой стори** (компилируется без `any`, без ошибок типов) — реальное покрытие приходит с 14.11j-l.

## Acceptance Criteria

1. **AC-1 (7 типизированных хуков, все из `paths[...]`).** `frontend/src/features/duty-plans/api/queries.ts`: `useDutyPlans` (list), `useCreateDutyPlan`, `useDutyShifts`/`useCreateDutyShift` (shifts GET/POST), `useApproveDutyPlan`, `useCancelDutyShift`, `useReplanDutyShift`, `useValidateDutyPlan`, `useDutyPlanConflicts` — 9 хуков (7 эндпоинтов, `shifts` даёт 2 хука на GET/POST). Ни один тип не задублирован вручную — все выведены через `paths['/api/operations/duty-plans/...']['<method>']['...']`.
2. **AC-2 (только `apiClient`, без сырого fetch).** `eslint`-гейт (ARCH-FE-015) зелёный на новом файле — подтверждает отсутствие прямого `fetch`.
3. **AC-3 (мутации инвалидируют кэш).** `useCreateDutyPlan`/`useApproveDutyPlan`/`useCancelDutyShift`/`useReplanDutyShift` — каждая инвалидирует релевантный `['duty-plans', ...]`-ключ на success (`onSuccess`).
4. **AC-4 (модельные типы, если нужны, — отдельно).** Если есть данные, не покрытые прямым `paths[...]`-выводом (например union для 404/422-ошибок специфичных этой фиче) — `duty-plans/model/types.ts`; иначе файл не создаётся (не создавать пустышку).
5. **AC-5 (без коллизии со старой `duties/`).** `frontend/src/features/duties/` (Smart Josparlau) НЕ изменена ни байтом; `App.tsx`'s существующий роут на `DutyPlanPage` не тронут.
6. **AC-6 (регресс нулевой).** `npm run gate` зелёный (`tsc -b`, `eslint`, `vitest`, build, size-gate) — новый файл добавляет 0 новых тестов (по Scope Decision), не ломает существующие.

## Out of Scope

- MSW-хендлеры для `/api/operations/duty-plans/*` — 14.11j.
- Любой UI/страница/компонент — 14.11j-l.
- Переименование/рефакторинг старой `features/duties/` (Smart Josparlau) — не в этом эпике.

## Tasks / Subtasks

- [x] Task 1 — `frontend/src/features/duty-plans/api/queries.ts` (AC: 1-4)
  - [x] 9 хуков, `paths[...]`-производные типы, `apiClient`, query keys `['duty-plans', ...]`, инвалидация на мутациях
- [x] Task 2 — Гейт (AC: 2, 5, 6)
  - [x] `npm run gate` — `tsc -b`/`eslint`/`vitest`/build/size-gate

## Dev Notes

- Читать `frontend/src/features/personnel/api/queries.ts` (лучший прецедент — реальная не-заглушечная схема, `paths[...]`-паттерн) ПЕРЕД имплементацией.
- `frontend/src/shared/api/schema.d.ts` (14.11h) — все 7 путей уже присутствуют: `/duty-plans/`, `/{id}/approve/`, `/{id}/conflicts/`, `/{id}/shifts/`, `/{id}/shifts/{shift_id}/cancel/`, `/{id}/shifts/{shift_id}/replan/`, `/{id}/validate/`.
- НЕ путать с `frontend/src/features/duties/` (Smart Josparlau, чужой бэк) — не читать её как образец для ЭТОЙ стори (разные конвенции, `pending-contracts.ts`-паттерн специфичен её собственному отложенному контракту).

### References

- [Source: frontend/src/features/personnel/api/queries.ts] — паттерн `paths[...]`-хуков.
- [Source: frontend/src/shared/api/client.ts] — `apiClient`.
- [Source: frontend/src/shared/api/schema.d.ts] — типы (14.11h).
- [Source: Backend/VAPS/apps/operations/duties/api/views.py] — 7 эндпоинтов (14.11a-g).

## Dev Agent Record

### Context Reference

- Research-агент + `AskUserQuestion` при create-story: коллизия имён с существующей `features/duties/` (Smart Josparlau) разрешена — новая папка `duty-plans/`, старая не трогается. Паттерн — `personnel/api/queries.ts`'s `paths[...]`-производные типы. Тестов на сам `queries.ts` не пишем (нет прецедента в кодовой базе) — тестирование приходит с 14.11j's MSW+page-тестами.

### Completion Notes

Реализовано по AC 1-6. `frontend/src/features/duty-plans/api/queries.ts` — 9 хуков (`useDutyPlans`, `useCreateDutyPlan`, `useDutyShifts`, `useCreateDutyShift`, `useApproveDutyPlan`, `useCancelDutyShift`, `useReplanDutyShift`, `useValidateDutyPlan`, `useDutyPlanConflicts`), все типы request/response выведены из `paths['/api/operations/duty-plans/...']` (schema.d.ts, 14.11h) — ни один тип не задублирован вручную. Мутации — через `useApiMutation` (не сырой `useMutation`, ARCH-FE-015). `dutyPlanKeys`-фабрика (прецедент `securityEventKeys`), мутации инвалидируют релевантные ключи (`useCreateDutyPlan`→lists, `useCreateDutyShift`/`useCancelDutyShift`/`useReplanDutyShift`→shifts(planId), `useApproveDutyPlan`→lists+shifts). `useValidateDutyPlan` (dry-run) намеренно НЕ инвалидирует ничего — она ничего не меняет на сервере. `features/duties/` (Smart Josparlau) не тронута ни байтом. `npm run gate` — 1021 vitest passed (без новых тестов, по Scope Decision), `tsc -b`/`eslint` чисто, build/size-gate зелёные (213.7KB/300KB).

### File List

- `frontend/src/features/duty-plans/api/queries.ts` (new)

## Change Log

| Дата | Изменение |
|---|---|
| 2026-07-31 | Story создана (create-story). Девятая (первая frontend) из ~12 подсторий разделения 14.11. КОЛЛИЗИЯ с существующей features/duties/ (Smart Josparlau, чужой бэк /api/ops/*) обнаружена research-агентом, разрешена AskUserQuestion — новая папка features/duty-plans/, старая не трогается. Паттерн — personnel/api/queries.ts's paths[...]-производные типы. Без MSW/UI/юнит-тестов на сам queries.ts (нет прецедента в кодовой базе) — приходит с 14.11j. |
| 2026-07-31 | Dev-story: `duty-plans/api/queries.ts` (9 хуков), `npm run gate` зелёный (1021 passed, tsc/eslint чисто). Status → done. |
