---
baseline_commit: 9663e27
---

# Story 16.8h5: Frontend — маршрутизация и права

Status: done

## Story

As a **держатель права `assignment.create`**,
I want **`/placement` и `/placement/:id` подключены к роутеру + пункт «Расстановка» в навигации**,
so that **экраны 16.8h2-4 реально достижимы из приложения, не только из изолированных тестов**.

Часть 5/5 пересмотренного расщепления 16.8h — последняя.

## Scope Decision

- **`RequirePermission` несёт ОДИН код** (`shared/auth/guards.tsx`) — бэк's list/detail/conflicts принимают ЛЮБОЙ из `assignment.create/.submit/.return/.approve`, но фронтовый гейт умеет только один код. Выбран `assignment.create` (OMD) — тот же компромисс, что `dutyPlans`'s `duty.manage` (не заводится multi-permission-инфраструктура ради одной стори).
- **Роуты — eager import** (не `lazy()`), образец `duty-plans` (НЕ `security-events`, чей `lazy()` — задокументированное исключение "route-based code splitting обязателен для «охранных мероприятий»", специфичное для той фичи).
- **`NAV_SECTIONS`-запись** — добавлена (в отличие от `changelog`/`printExpense`, которые НАМЕРЕННО не в навигации) — Расстановка ЕСТЬ полноценный раздел портала.
- **`changelog-routing.test.tsx`'s `NAV_SECTIONS.toHaveLength(12)`** — сломан добавлением новой записи, исправлен на `13` (регресс, не новая находка — счётчик уже был хрупким до этой стори).

## Acceptance Criteria

1. **AC-1.** Без `assignment.create` — `/placement` показывает `ACCESS_DENIED_TEXT` (тот же гейт, что `/duty-plans`).
2. **AC-2.** С `assignment.create` — `/placement` рендерит реальные данные (не тестовый изолированный рендер, а через `AppRoutes`).
3. **AC-3.** `/placement/:id` доступна по прямому URL (F5/новая вкладка).
4. **AC-4.** Пункт «Расстановка» в навигации — присутствует с `assignment.create`, отсутствует без.
5. **AC-5.** Переход список→деталь по клику работает end-to-end (`AppRoutes`, не изолированный рендер страницы).
6. **AC-6.** `npm run gate` зелёный, включая `changelog-routing.test.tsx`'s счётчик `NAV_SECTIONS`.

## Out of Scope

- Multi-permission `RequirePermission` (архитектурное расширение, не эта стори).
- Роутинг для `SecurityEventDetailPage`'s pending-contract-секций (вне объёма всего 16.8h).

## Tasks / Subtasks

- [x] Task 1 — `App.tsx`: `<Route>` для `placementVersions`/`placementVersionDetail`, `RequirePermission permission="assignment.create"`
- [x] Task 2 — `routes.ts`: `NAV_SECTIONS`-запись
- [x] Task 3 — `changelog-routing.test.tsx`: обновить `toHaveLength`
- [x] Task 4 — Тесты (AC 1-5, реальная композиция `Providers+AppRoutes`, образец `duty-plans-list.qa.test.tsx`/`duty-plan-detail.qa.test.tsx`)
- [x] Task 5 — Гейт (AC 6)

## Dev Notes

- `frontend/src/app/duty-plans-list.qa.test.tsx`/`duty-plan-detail.qa.test.tsx` (14.11j/k) — буквальный образец: `Providers`+`MemoryRouter`+`AppRoutes`, права через `server.use()`-оверрайд `/api/operations/my-permissions/`.
- `frontend/src/app/changelog-routing.test.tsx` — искать `toHaveLength` перед коммитом, эта стори ОБЯЗАНА его обновить.

### References

- [Source: frontend/src/app/duty-plans-list.qa.test.tsx]
- [Source: frontend/src/app/App.tsx]
- [Source: frontend/src/shared/routes.ts]

## Dev Agent Record

### Agent Model Used

Claude Sonnet 5

### Debug Log References

### Completion Notes List

Реализовано по AC 1-6. `App.tsx` — 2 новых `<Route>` (eager import, образец `duty-plans`), `RequirePermission permission="assignment.create"`. `routes.ts` — `NAV_SECTIONS`-запись (`UserCheck`-иконка). Найден и исправлен предсуществующий хрупкий счётчик `changelog-routing.test.tsx`'s `NAV_SECTIONS.toHaveLength(12)` → `13` (сломался бы ЛЮБОЙ добавленной nav-записью, не специфично для этой стори — типичный "магическое число длины массива"-паттерн, оставлен как есть, не переработан). 6 новых тестов (`placement-routing.qa.test.tsx`, образец `duty-plans-list.qa.test.tsx`/`duty-plan-detail.qa.test.tsx` — реальная композиция `Providers+AppRoutes+MemoryRouter`, не изолированный рендер страницы, впервые в 16.8h). `npm run gate` — 1085 passed (было 1079, +6), 0 regressions, tsc/eslint чисты, build/size-gate ok (221.5 KB / 300 KB).

### File List

- `frontend/src/app/App.tsx` (modified — 2 новых `<Route>`)
- `frontend/src/shared/routes.ts` (modified — `NAV_SECTIONS`-запись)
- `frontend/src/app/changelog-routing.test.tsx` (modified — `toHaveLength` 12→13)
- `frontend/src/app/placement-routing.qa.test.tsx` (new)

**После ревью:**
- `frontend/src/app/App.tsx` (modified — комментарий про single-permission-code ограничение прямо у `<Route>`, не только в `routes.ts`)
- `frontend/src/app/placement-routing.qa.test.tsx` (modified — 1 новый тест, 404 через реальную композицию `AppRoutes`)

## Change Log

| Дата | Изменение |
|---|---|
| 2026-08-04 | Story создана (create-story). Часть 5/5 (финал) пересмотренного расщепления 16.8h. |
| 2026-08-04 | Dev-story: маршруты + nav + `changelog-routing.test.tsx`-счётчик. 6 новых тестов. `npm run gate` — 1085 passed, 0 regressions. Status → review. |
| 2026-08-04 | 3-agent ревью (Blind Hunter, Edge Case Hunter, Acceptance Auditor). Acceptance Auditor нашёл документационный разрыв: single-permission-code ограничение (`assignment.create` вместо любого из 4) было задокументировано только в `routes.ts`'s `NAV_SECTIONS`-записи, не рядом с самим `<Route>` в `App.tsx` (файл, который РЕАЛЬНО навязывает гейт) — добавлен комментарий. Edge Case Hunter нашёл пробел: 404 тестировался только изолированно (16.8h2), не через реальную композицию `AppRoutes` — добавлен тест; потребовал `{timeout: 10_000}` (Providers' `QueryClient` ретраит запросы по умолчанию, `queries.retry:false` не задан глобально — тот же прецедент, `duty-plans-list.qa.test.tsx:114`). Blind Hunter's находки — либо уже задокументированные компромиссы (single-code gate), либо косметика (иконка). `npm run gate` повторно — 1086 passed, 0 regressions, tsc/eslint чисты. Status → done. Story 16.8h (все 5 под-сторий) закрыта. |
