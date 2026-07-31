---
baseline_commit: da60566
---

# Story 14.11k: Frontend — деталь плана + грид смен дежурств

Status: review

## Story

As an **оператор с правом `duty.manage`**,
I want **страницу ОДНОГО плана дежурств со списком его смен + созданием смены**,
so that **можно посмотреть/наполнить конкретный план, не только его видеть в общем списке**.

Одиннадцатая (третья frontend) из ~12 подсторий разделения 14.11.

## Scope Decision (найдено при create-story, research-агент)

- **Паттерн деталь-страницы — буквально `SecurityEventDetailPage.tsx`**: `useParams<{id}>()`, isLoading/isError/not-found-ветки ПЕРЕД телом страницы, `<Link>` «Назад к списку».
- **КРИТИЧЕСКАЯ находка research-агента: НЕТ `GET /api/operations/duty-plans/{id}/` (retrieve).** Схема (14.11a-h) даёт только `list`/`create`/`shifts`/`approve`/`cancel_shift`/`replan_shift`/`validate`/`conflicts` — ни одного одиночного GET-плана. **Решение — переиспользовать `useDutyPlans()` (list) и отфильтровать по `id` на клиенте.** Это НЕ «зависимость от тёплого кэша», как первично предположил research-агент: `useDutyPlans()`, вызванный на деталь-странице, делает СОБСТВЕННЫЙ независимый fetch списка (свой queryKey), так что прямой заход по URL (F5/новая вкладка) тоже работает — просто дороже одного retrieve-запроса (весь список ради одной строки). На демо-масштабе (donor-scale, тот же аргумент, что `personnel`'s «единая страница без пролистывания») это приемлемо; настоящий retrieve-эндпоинт — future backend work, НЕ в объёме этой (фронтенд-only) стори (CLAUDE.md: backend+frontend в одной стори — расширение объёма).
- **Новый route `/duty-plans/:id`** (`ROUTES.dutyPlanDetail`/`dutyPlanDetailTo(id)`, прецедент `securityEventDetailTo`). `DutyPlansListPage.tsx`'s строки таблицы теперь `<Link>` на деталь (сейчас — просто `<td>`, без навигации; комментарий "здесь нет Link/навигации на строку" в шапке файла становится устаревшим — обновить/убрать).
- **Грид смен — `useDutyShifts(planId)`** (готов с 14.11i), колонки: `employee_id`, `post`, `duty_type`, `duty_role_code`, `starts_at`/`ends_at`, индикатор отменена/нет (`cancelled_at !== null`). `notes`/`cancelled_by`/`cancelled_reason` — НЕ показываются (отложено на 14.11l, где реально нужна причина отмены).
- **Создание смены — модальный `<dialog>`** (не inline-строка, буквальный образец `CreateDutyPlanDialog.tsx`, не Recon/Demand-таблицы — те правят СУЩЕСТВУЮЩИЕ строки, здесь создаётся НОВАЯ запись). Поля: `employee_id` (UUID-строка), `post`/`duty_type` — ЧИСЛОВОЙ ID-stopgap (тот же паттерн, что 14.11j's `object` — `/api/operations/facilities/posts|duty-types/`-списков во фронтенд-схеме НЕТ, подтверждено `grep`), `duty_role_code`/`notes` (текст, опционально), `starts_at`/`ends_at` (datetime-local).
- **НИКАКИХ approve/cancel/replan/validate/conflicts-кнопок или UI** — 14.11l.
- **400-ошибки создания смены — та же ValidationError-only-логика**, что 14.11j's review-фикс (не широкий `ApiError`).

## Acceptance Criteria

1. **AC-1 (деталь — заголовок плана).** Валидный `:id` → заголовок с объектом/годом/месяцем/статусом (по данным `useDutyPlans()`, отфильтрованным по `id`).
2. **AC-2 (несуществующий/неразрешимый id → сообщение + ссылка назад).** `id` не найден в списке (или список пуст) → «План не найден», `<Link>` на `/duty-plans`.
3. **AC-3 (грид смен — таблица).** `useDutyShifts(planId)` → таблица с колонками employee_id/post/duty_type/duty_role_code/starts_at/ends_at/статус-отмены.
4. **AC-4 (пустой грид).** Ноль смен → сообщение, не пустая таблица.
5. **AC-5 (ссылка со списка планов).** `DutyPlansListPage`'s строки таблицы — `<Link>` на `/duty-plans/{id}`.
6. **AC-6 (создание смены — форма).** «+ Создать смену» открывает `<dialog>` (employee_id/post/duty_type/duty_role_code/notes/starts_at/ends_at).
7. **AC-7 (успех — грид обновляется, диалог закрывается).** `useCreateDutyShift`'s инвалидация (готова с 14.11i) — новая смена видна без reload.
8. **AC-8 (400 → инлайн-ошибки полей, узко ValidationError).** Серверная 400-валидация → `setError` по полю; НЕ широкий `ApiError`-catch (урок 14.11j review).
9. **AC-9 (регресс нулевой).** `npm run gate` зелёный; `features/duties/` не тронута.

## Out of Scope

- Настоящий `GET /api/operations/duty-plans/{id}/`-эндпоинт — future backend work, не эта (frontend-only) стори.
- post/duty_type picker (выпадающий список) — числовое ID-поле, как object в 14.11j.
- approve/cancel/replan/validate/conflicts-UI — 14.11l.

## Tasks / Subtasks

- [x] Task 1 — `ROUTES.dutyPlanDetail`/`dutyPlanDetailTo` (AC: 1, 2, 5)
  - [x] `frontend/src/shared/routes.ts`
- [x] Task 2 — `DutyPlanDetailPage.tsx` (AC: 1-4)
  - [x] `frontend/src/features/duty-plans/pages/DutyPlanDetailPage.tsx` — `useParams`, `useDutyPlans()`-фильтр по id, `useDutyShifts(planId)`, isLoading/isError/not-found/empty-ветки
- [x] Task 3 — `CreateDutyShiftDialog.tsx` (AC: 6-8)
  - [x] `frontend/src/features/duty-plans/pages/CreateDutyShiftDialog.tsx` — буквальный образец `CreateDutyPlanDialog.tsx` (после review-фикса 14.11j), ValidationError-only setError-эффект СРАЗУ
- [x] Task 4 — Роутинг + ссылка со списка (AC: 5)
  - [x] `frontend/src/app/App.tsx` — новый `<Route>` за `RequirePermission permission="duty.manage"`
  - [x] `DutyPlansListPage.tsx` — строки таблицы оборачиваются в `<Link>`
- [x] Task 5 — Тесты (AC: 1-9)
  - [x] Page-тест (RTL+MSW, паттерн `duty-plans-list.qa.test.tsx`, живёт в `src/app/` — ARCH-FE-013): деталь+грид, not-found, пустой грид, ссылка со списка, создание-успех, создание-400
  - [x] `npm run gate` зелёный, явно прогнан

## Dev Notes

- Читать `frontend/src/features/security-events/pages/SecurityEventDetailPage.tsx` (образец деталь-страницы), `frontend/src/features/duty-plans/pages/{DutyPlansListPage,CreateDutyPlanDialog}.tsx` (14.11j, буквальный образец для грида/диалога), `frontend/src/app/duty-plans-list.qa.test.tsx` (тестовый паттерн) ПЕРЕД имплементацией.
- `useDutyShifts`/`useCreateDutyShift` уже готовы (14.11i).
- НЕ повторять 14.11j's review-найденный дефект (широкий `ApiError`-catch вместо `ValidationError`) — писать `ValidationError`-only СРАЗУ.

### References

- [Source: frontend/src/features/security-events/pages/SecurityEventDetailPage.tsx] — образец деталь-страницы.
- [Source: frontend/src/features/duty-plans/pages/DutyPlansListPage.tsx] — 14.11j, добавить `<Link>`.
- [Source: frontend/src/features/duty-plans/pages/CreateDutyPlanDialog.tsx] — 14.11j (после review-фикса) — буквальный образец для `CreateDutyShiftDialog`.
- [Source: frontend/src/features/duty-plans/api/queries.ts] — `useDutyShifts`/`useCreateDutyShift` (14.11i).

## Dev Agent Record

### Context Reference

- Research-агент при create-story: нет retrieve-эндпоинта плана — решение переиспользовать `useDutyPlans()`-список с клиентским фильтром (не блокер, не зависит от тёплого кэша — свой fetch). `post`/`duty_type` — тот же числовой ID-stopgap, что `object` в 14.11j (нет backend-эндпоинтов списка).

### Completion Notes

Реализовано по AC 1-9. `DutyPlanDetailPage.tsx` — `useParams`+`useDutyPlans()`-фильтр по id (нет retrieve-эндпоинта, Scope Decision), `useDutyShifts(planId)`-грид, isLoading/isError/not-found/empty-ветки (буквальный скелет `SecurityEventDetailPage`). `CreateDutyShiftDialog.tsx` — буквальный образец `CreateDutyPlanDialog.tsx` ПОСЛЕ review-фикса 14.11j (ValidationError-only setError, безопасный generic-баннер с UX L208-исключением для 5xx/network) — урок применён проактивно, не заново открыт. `post`/`duty_type` — числовой ID-stopgap (`.optional().or(z.literal(''))`, тот же паттерн, что `object` в 14.11j). Zod-`transform` конвертирует `datetime-local`-строки в ISO через `new Date(...).toISOString()`. `DutyPlansListPage.tsx`'s строки теперь `<Link>` на деталь. MSW-хендлеры `shifts`(GET+POST) добавлены в `duty-plans/mocks/handlers.ts`/`fixtures.ts`. 6 новых page-тестов (`src/app/duty-plan-detail.qa.test.tsx`, тот же слой, что `duty-plans-list.qa.test.tsx` — ARCH-FE-013), все зелёные с первой попытки. `npm run gate` — 1034 passed (было 1027, +7 — 6 новых + список-тест на ссылку), 0 regressions, build/size-gate зелёные (218.1KB/300KB).

### File List

- `frontend/src/features/duty-plans/pages/DutyPlanDetailPage.tsx` (new)
- `frontend/src/features/duty-plans/pages/CreateDutyShiftDialog.tsx` (new)
- `frontend/src/features/duty-plans/pages/DutyPlansListPage.tsx` (modified — строки → `<Link>`)
- `frontend/src/features/duty-plans/api/queries.ts` (modified — экспортированы `DutyShiftsListResponse`/`DutyShiftCreateRequest`)
- `frontend/src/features/duty-plans/mocks/handlers.ts` (modified — `shifts` GET+POST)
- `frontend/src/features/duty-plans/mocks/fixtures.ts` (modified — `DutyShiftFixture`/`DUTY_SHIFTS`)
- `frontend/src/app/duty-plan-detail.qa.test.tsx` (new)
- `frontend/src/app/App.tsx` (modified — новый route)
- `frontend/src/shared/routes.ts` (modified — `ROUTES.dutyPlanDetail`/`dutyPlanDetailTo`)

## Change Log

| Дата | Изменение |
|---|---|
| 2026-07-31 | Story создана (create-story). Одиннадцатая (третья frontend) из ~12 подсторий разделения 14.11. Нет retrieve-эндпоинта плана — решение переиспользовать useDutyPlans()-список с клиентским фильтром по id (работает и на прямом заходе — свой независимый fetch, не кэш-зависимость). post/duty_type — числовой ID-stopgap, как object в 14.11j. ValidationError-only setError с самого начала (не повторять 14.11j's review-находку). |
| 2026-07-31 | Dev-story: `DutyPlanDetailPage`/`CreateDutyShiftDialog`, ссылка со списка, MSW shifts-хендлеры, 6 page-тестов, все зелёные с первой попытки (14.11j's review-урок применён проактивно). `npm run gate` — 1034 passed. Status → review. |
