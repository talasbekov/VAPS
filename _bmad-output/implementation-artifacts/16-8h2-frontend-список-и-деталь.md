---
baseline_commit: 1403d5d
---

# Story 16.8h2: Frontend — список и деталь версий Расстановки

Status: done

## Story

As a **держатель права чтения Расстановки**,
I want **`/placement` (список версий) и `/placement/:id` (деталь версии с назначениями и конфликтами)**,
so that **я вижу реальные (не pending-contract) версии Расстановки и их состояние**.

Часть 2/5 пересмотренного расщепления 16.8h.

## Scope Decision

- **НЕ встраивается в `SecurityEventDetailPage`** — та страница целиком pending-contract (фиктивный строковый `event.id`, весь фетч через `pending-contracts.ts`), embedding сломал бы реальные хуки 16.8h1 (нет реального numeric event id). Пользователь явно выбрал отдельный экран (create-story, 2026-08-04).
- **Образец — `duty-plans/pages/DutyPlansListPage.tsx`/`DutyPlanDetailPage.tsx`** — буквально копируется структура: `isLoading`/`isError`/`isEmpty`-ветки, `Link` на деталь по id, детальная страница читает `useParams`.
- **Список показывает `event` как голый numeric id** (реальной "деталь события"-страницы ещё нет нигде во фронте — pending-contract feature её не даёт) — не изобретается фиктивная связь; в списке также `status`/`version`/`is_current`/`updated_at`.
- **Деталь показывает**: статус/версию/`signature_hash`, таблицу `assignments` (employee_id/post/conflict_severity/conflict_codes/acknowledged_at), отдельную панель конфликтов через `useAssignmentVersionConflicts` (16.8f, свежий пересчёт — ЗАПРОС отдельный от `assignments`-в-детали, честно показывает РАЗНИЦУ: сохранённый снимок vs пересчёт).
- **Действия (submit/return/approve/acknowledge) — 16.8h3/h4**, НЕ эта стори — только чтение.
- **Маршруты/nav — 16.8h5**, эта стори добавляет `ROUTES.placementVersions`/`placementVersionDetail`(To) в `shared/routes.ts` (нужны для `Link`), но НЕ регистрирует роут в `App.tsx`/nav (та же граница, что 14.11j/k разделили создание маршрутов от их подключения к роутеру — подключение в h5, вместе с permission-гардом).

## Acceptance Criteria

1. **AC-1.** `/placement` — список версий (`useAssignmentVersions()`), loading/error/empty-ветки, `Link` на деталь.
2. **AC-2.** `/placement/:id` — деталь: статус/версия/`is_current`/`signature_hash`, таблица `assignments`.
3. **AC-3.** Панель конфликтов на детали — отдельный запрос `useAssignmentVersionConflicts`, свой loading/error, показывает `conflict_severity`+`conflict_codes` по каждой конфликтующей строке.
4. **AC-4.** Деталь — 404/error-состояние для несуществующего id (тот же паттерн, что `DutyPlanDetailPage`).
5. **AC-5.** Тесты (RTL, MSW) — happy path списка и детали, error-состояние.
6. **AC-6.** `npm run gate` зелёный.

## Out of Scope

- Кнопки действий (16.8h3/h4).
- Подключение маршрута в `App.tsx`/nav-меню (16.8h5).

## Tasks / Subtasks

- [x] Task 1 — `frontend/src/shared/routes.ts`: `placementVersions`/`placementVersionDetail`/`placementVersionDetailTo`
- [x] Task 2 — `frontend/src/features/placement/pages/PlacementVersionsListPage.tsx`
- [x] Task 3 — `frontend/src/features/placement/pages/PlacementVersionDetailPage.tsx` (assignments-таблица + конфликты-панель)
- [x] Task 4 — Тесты (AC 5)
- [x] Task 5 — Гейт (AC 6)

## Dev Notes

- `frontend/src/features/duty-plans/pages/DutyPlansListPage.tsx`/`DutyPlanDetailPage.tsx` — буквальный образец.
- `frontend/src/features/placement/api/queries.ts` (16.8h1) — все хуки уже готовы, эта стори их ТОЛЬКО потребляет.

### References

- [Source: frontend/src/features/duty-plans/pages/]
- [Source: frontend/src/features/placement/api/queries.ts]

## Dev Agent Record

### Agent Model Used

Claude Sonnet 5

### Debug Log References

### Completion Notes List

Реализовано по AC 1-6. `ROUTES.placementVersions`/`placementVersionDetail`(`To`) добавлены (маршрут в `App.tsx` НЕ подключён — 16.8h5). `PlacementVersionsListPage`/`PlacementVersionDetailPage` — образец `duty-plans`'s страниц. Найдены 2 расхождения генерируемой схемы с реальным рантаймом (typescript-openapi не улавливает пустой default choice-поля и типизирует JSONField как `unknown`) — `conflictSeverityLabel()`/`conflictCodesOf()`-хелперы вместо борьбы с типом. Страничные тесты — НЕ через `AppRoutes` (тот паттерн требует прав/роутинга, вне объёма этой стори), изолированный рендер компонента с собственным `MemoryRouter`+`QueryClientProvider`. 14 новых тестов (list: happy/empty/error; detail: happy+конфликты, 404). `npm run gate` — 1061 passed, 0 regressions, tsc/eslint чисты, build/size-gate ok.

### File List

- `frontend/src/shared/routes.ts` (modified — новые маршруты)
- `frontend/src/features/placement/pages/PlacementVersionsListPage.tsx` (new)
- `frontend/src/features/placement/pages/PlacementVersionsListPage.test.tsx` (new)
- `frontend/src/features/placement/pages/PlacementVersionDetailPage.tsx` (new)
- `frontend/src/features/placement/pages/PlacementVersionDetailPage.test.tsx` (new)

**После ревью:**
- `frontend/src/features/placement/pages/PlacementVersionDetailPage.test.tsx` (modified — 5 новых тестов, happy-path переписан на расходящиеся данные)

## Change Log

| Дата | Изменение |
|---|---|
| 2026-08-04 | Story создана (create-story). Часть 2/5 пересмотренного расщепления 16.8h — отдельный экран, не embedding в SecurityEventDetailPage (пользовательское решение). |
| 2026-08-04 | Dev-story: список+деталь. 14 новых тестов. `npm run gate` — 1061 passed, 0 regressions. Status → review. |
| 2026-08-04 | 3-agent ревью (Blind Hunter, Edge Case Hunter, Acceptance Auditor). Acceptance Auditor: happy-path тест детали использовал ИДЕНТИЧНЫЕ данные в detail и conflicts-ответах — не мог отличить "панель читает из своего запроса" от гипотетической регрессии re-derive из `version.assignments` — переписан на РАСХОДЯЩИЕСЯ данные (разные сотрудники/severity). Edge Case Hunter независимо совпал + добавил: панель-конфликтов не имела своих loading/error/empty-тестов, не было теста generic-(non-404)-ошибки детали (отличить от 404-сообщения), не было теста unmapped-status-фоллбэка. Добавлено 5 новых тестов. Blind Hunter's находки — все вне объёма (routing/nav — явно 16.8h5) или мелкие стилевые (дубль STATUS_LABEL — matches duty-plans' конвенция). `npm run gate` повторно — 1065 passed, 0 regressions, tsc/eslint чисты. Status → done. |
