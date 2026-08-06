---
baseline_commit: 7fa03b5
---

# Story 20.1e: Подключение панели готовности ОМ к карточке мероприятия

Status: done

## Story

As a **держатель права на просмотр карточки ОМ**,
I want **видеть реальную панель готовности (20.1d) на карточке мероприятия вместо статичного mock-числа**,
so that **FR-38's дашборд готовности перестаёт быть изолированным компонентом без потребителя и становится частью реального экрана**.

## Scope Decision — ПРОЧИТАТЬ ПЕРВЫМ (архитектурная развилка, решена Bratan'ом)

**Найденная проблема:** `SecurityEventDetailPage` целиком mock-first (`useSecurityEvent` читает `/api/ops/security-events/:id/`, обслуживается ТОЛЬКО MSW, backend для этих событий не существует). Реальный эндпоинт готовности (20.1b, `/api/operations/security-events/{id}/readiness/`) ожидает ID из РЕАЛЬНОЙ таблицы `SecurityEvent` (`apps.operations.events`). **Эти два ID-пространства НЕ пересекаются** — ни один mock-созданный ОМ не имеет реального backend-аналога.

**Решение (узкая честная стори, подтверждено Bratan'ом):** подключить `ReadinessPanel` как есть, НЕ пытаясь решить интеграцию ID-пространств целиком. Панель уже (с 20.1d) честно показывает сообщение об ошибке при 404/сбое — ничего нового в её поведении не требуется. Работа этой стори:
1. Вписать `<ReadinessPanel eventId={event.id} />` в `SecurityEventDetailPage`.
2. **КРИТИЧНО**: `frontend/src/app/mocks/browser.ts:24` — `onUnhandledRequest: 'error'`. Без dev-mock MSW-хендлера на РЕАЛЬНЫЙ путь `/api/operations/security-events/:id/readiness/` запрос НЕ станет вежливым 404 через `ReadinessPanel`'s error-UI — он упадёт как необработанное internal-исключение MSW (тот же класс проблемы, что 19.4d нашла эмпирически через `preview_start`, см. `_bmad-output/implementation-artifacts/19-4d-frontend-панель-календаря.md`'s Task 4). Добавить dev-mock хендлер, отдающий ЧЕСТНЫЙ 404 `NOT_FOUND`-конверт для ЛЮБОГО `:id` (честно отражает реальность: ни один mock-ОМ не существует на реальном бэкенде) — НЕ выдуманные success-данные.
3. Зафиксировать ограничение в Dev Notes для будущей стори, которая даст `security-events` реальную backend-интеграцию (переименование/слияние ID-пространств — вне бюджета этой стори).
4. Удалить теперь избыточный mock-`StatBox label="Готовность"` (заменяется реальной панелью, дублировать оба — вводить оператора в заблуждение, какое число верное).

**Out of scope**: реальная backend-интеграция `security-events` (создание реальных `SecurityEvent`-строк из mock-действий, миграция ID); списочная готовность в `CommandCenterPage`/`SecurityEventsListPage` (там `event.readinessPercent` — поле СПИСКА N событий, для него нужен bulk-эндпоинт, которого не существует — 20.1a/b строили только single-event; НЕ трогать эти две страницы); polling/auto-refresh; изменение поведения `ReadinessPanel` самого компонента (20.1d уже покрывает loading/error/success честно).

## Acceptance Criteria

1. **AC-1.** `SecurityEventDetailPage` для существующего (mock) мероприятия рендерит `<ReadinessPanel eventId={event.id} />` — новая секция на странице, между шапкой мероприятия (`StageTracker`) и стадийным контентом (`StageContent`).
2. **AC-2.** Дублирующий mock `StatBox label="Готовность" value={event.readinessPercent}` (в `DemandForm`, `SecurityEventDetailPage.tsx:686`) удалён — сетка `StatBox` в этом месте становится 3-колоночной (`grid-cols-2 md:grid-cols-3`), не 4.
3. **AC-3.** В `dev:mock`-режиме панель НЕ падает необработанным MSW-исключением — новый dev-mock хендлер `GET /api/operations/security-events/:id/readiness/` зарегистрирован в `compose-handlers.ts`, отдаёт 404 `{error_code: 'NOT_FOUND', ...}` для любого `:id`, панель показывает штатное сообщение об ошибке (тот же `ReadinessPanel`'s `query.isError`-путь, без изменения его кода).
4. **AC-4.** `CommandCenterPage`/`SecurityEventsListPage` НЕ изменены — их `event.readinessPercent` продолжает работать как раньше (список остаётся вне scope).
5. **AC-5.** Тест на `SecurityEventDetailPage` (новый файл — страница не имела своего unit-теста до этой стори, см. Previous Story Intelligence) подтверждает: панель рендерится с переданным `event.id`, честно показывает ошибку при недоступности реального эндпоинта (per-test MSW handler на `/api/operations/security-events/:id/readiness/` → 404), остальная карточка мероприятия продолжает рендериться (регресс не сломан).
6. **AC-6.** `npm run gate` (frontend) зелёный.

## Out of Scope

- Реальная backend-интеграция `security-events` (объединение/миграция ID-пространств mock↔real).
- Списочная готовность в `CommandCenterPage`/`SecurityEventsListPage`.
- Polling/auto-refresh готовности.
- Изменение поведения `ReadinessPanel` (20.1d) самого по себе.

## Tasks / Subtasks

- [x] Task 1 — `frontend/src/features/security-events/pages/SecurityEventDetailPage.tsx`: вписать `<ReadinessPanel eventId={event.id} />` между `StageTracker` и `StageContent` (после строки 107); удалить `StatBox label="Готовность"` в `DemandForm` (строка ~686), сузить grid до 3 колонок.
- [x] Task 2 — `frontend/src/features/security-events/mocks/readiness-handlers.ts` (новый файл): dev-mock MSW-хендлер `GET */api/operations/security-events/:id/readiness/` → 404 `NOT_FOUND`-конверт (честный, статический, без persistence-адаптера — этот путь не имеет backend-аналога ни для одного mock-ОМ).
- [x] Task 3 — `frontend/src/app/mocks/compose-handlers.ts`: зарегистрировать новый хендлер (`...readinessMockHandlers`).
- [x] Task 4 — Тесты (AC 1-5): `frontend/src/features/security-events/pages/SecurityEventDetailPage.test.tsx` (новый файл) — рендер страницы с mock `useSecurityEvent`-данными (per-test MSW на `/api/ops/security-events/:id/`) + per-test MSW 404 на реальном readiness-пути, ассертить панель рендерится и показывает честную ошибку, `StatBox`-сетка 3-колоночная (нет "Готовность" среди StatBox).
- [x] Task 5 — Живая проверка в браузере (`preview_start`): открыть карточку ОМ, подтвердить, что панель НЕ роняет страницу необработанным MSW-исключением (тот же класс находки, что 19.4d — не полагаться только на юнит-тесты, MSW browser worker строже, чем `server.use()` в тестах).
- [x] Task 6 — `npm run gate` (frontend).

### Review Findings

- [x] [Review][Patch] `expect()` внутри MSW-резолвера заменён на захват `seenReadinessIds` снаружи + ассерт после рендера [frontend/src/features/security-events/pages/SecurityEventDetailPage.test.tsx:77]
- [x] [Review][Patch] Тест 2 усилен ассертами на оставшиеся 3 `StatBox` (регресс, стирающий всю сетку, раньше прошёл бы незамеченным) [frontend/src/features/security-events/pages/SecurityEventDetailPage.test.tsx:129]
- [x] [Review][Defer] Панель рендерится на любой стадии ОМ, не различает «неприменимо по стадии» от «бэкенда нет» [frontend/src/features/security-events/pages/SecurityEventDetailPage.tsx:110] — deferred, вероятно намеренно
- [x] [Review][Defer] Always-404 mock-хендлер не различает «нет строки у этого ОМ» от «эндпоинт недоступен» [frontend/src/features/security-events/mocks/readiness-handlers.ts] — deferred, by design
- [x] [Review][Defer] `useSecurityEventReadiness` без `enabled`-гейта на `eventId` [frontend/src/features/security-events/api/readiness.ts] — deferred, pre-existing из 20.1c
- [x] [Review][Defer] Query-кэш readiness растёт неограниченно при навигации между ОМ — deferred, established convention
- [x] [Review][Defer] Хардкод id `'42'` в трёх местах теста без общей константы [frontend/src/features/security-events/pages/SecurityEventDetailPage.test.tsx] — deferred, test-quality
- [x] [Review][Defer] Нет теста на стадию `CLOSED` [frontend/src/features/security-events/pages/SecurityEventDetailPage.test.tsx] — deferred, test-quality

## Dev Notes

- **Previous Story Intelligence (20.1d)**: `ReadinessPanel` (`frontend/src/features/security-events/pages/ReadinessPanel.tsx`) принимает `eventId: string`, уже честно обрабатывает `isLoading`/`isError`/`isSuccess` — ничего в этой стори НЕ меняет сам компонент. Тесты 20.1d используют per-test MSW на `*/api/operations/security-events/:id/readiness/` — тот же паттерн переиспользовать здесь.
- **Previous Story Intelligence (19.4d)**: `StatusCalendarPanel` — тот же прецедент «панель отдельной стори, wiring — отдельная стори» — при живой проверке в браузере (`preview_start`) обнаружилось, что БЕЗ dev-mock MSW-хендлера запрос падает не через error-UI компонента, а через MSW-внутреннюю ошибку (`onUnhandledRequest: 'error'`, `frontend/src/app/mocks/browser.ts:24` — passthrough НЕ разрешён). Эта стори повторяет то же самое для readiness-пути — добавление dev-mock хендлера ОБЯЗАТЕЛЬНО, не опционально, несмотря на то что это «просто заглушка 404».
- `frontend/src/features/security-events/mocks/handlers.ts:158` (`createSecurityEventsHandlers`) — существующий mock-хендлер фабрика для `/api/ops/security-events/...`. НЕ добавлять readiness-хендлер туда — этот путь (`/api/operations/...`) концептуально отдельный (реальный бэкенд), та же логика разделения, что 20.1c's `readiness.ts` отдельный от `queries.ts`. Новый файл `mocks/readiness-handlers.ts` — простой статический хендлер, БЕЗ `adapter`/`clock` параметров (нет персистентности — 404 всегда).
- `frontend/src/app/mocks/compose-handlers.ts` — паттерн регистрации: `...xHandlers` в массиве, импорт сверху. `statusCalendarHandlers` (строка 30) — простейший прецедент хендлера без параметров (сравнить с `createXHandlers(adapter, clock)` для persistence-backed).
- `frontend/src/features/security-events/pages/SecurityEventDetailPage.tsx:52-75` — страница уже читает `useParams<{id}>()`/`useSecurityEvent(id ?? '')`, гейтит на `isLoading`/`isError`. `event.id` (строка 75+) — тот самый ID для `ReadinessPanel eventId={event.id}`.
- `frontend/src/features/security-events/pages/SecurityEventDetailPage.tsx:686` — `StatBox label="Готовность" value={`${event.readinessPercent}%`}` внутри `DemandForm`'s `grid-cols-2 gap-2.5 md:grid-cols-4` — удалить эту `StatBox`, изменить класс на `md:grid-cols-3` (3 оставшихся: Всего требуется/Постов/Групп задействовано).
- **CAVEAT, зафиксированный явно (не решается здесь)**: после этой стори реальная панель готовности будет ПОСТОЯННО показывать «не найдено» для любого демо-ОМ (пока `security-events` не получит реальную backend-интеграцию) — это ЧЕСТНОЕ, а не сломанное поведение (§35 «не показывай success раньше данных»), но следующему разработчику, который даст `security-events` реальный бэкенд, нужно будет либо (а) убедиться, что созданные там ОМ реально пишутся в `apps.operations.events.SecurityEvent`, либо (б) явно решить, что `security-events`-CRUD и Epic-20-дашборды готовности — разные системы с разными ID и панель переносится в другое место.
- `frontend/src/shared/api/errors.ts` (`ErrorEnvelope`) — форма 404-конверта для mock-хендлера: `{ error_code: 'NOT_FOUND', message: '...', details: {}, request_id: null, timestamp: new Date().toISOString() }` (тот же формат, что 20.1c/20.1d тестов).

### References

- [Source: _bmad-output/implementation-artifacts/20-1d-готовность-ом-панель.md] — `ReadinessPanel`, CAVEAT про ID-пространства зафиксирован явно.
- [Source: _bmad-output/implementation-artifacts/19-4d-frontend-панель-календаря.md] — прецедент «панель нуждается в dev-mock хендлере, обнаружено живой проверкой в браузере».
- [Source: frontend/src/app/mocks/browser.ts] — `onUnhandledRequest: 'error'`, причина обязательности dev-mock хендлера.
- [Source: frontend/src/app/mocks/compose-handlers.ts] — точка регистрации.

## Dev Agent Record

### Agent Model Used

Claude Sonnet 5

### Debug Log References

- `tsc -b` упал на `error TS6133: 'ReactNode' is declared but its value is never read.` в новом тест-файле — импорт был скопирован по образцу другого теста, но не использован (сигнатура `renderPage` не типизирует children через `ReactNode`). Убран.
- Живая проверка в браузере (`preview_start`, persona `demo-event-planner`/"Организатор ОМ"): открыт `/security-events/{id}` для реального mock-события (ОМ-2026-1). Панель "Готовность ОМ" честно перешла из "Загрузка готовности…" в "Не удалось загрузить готовность: ОМ не найден." — ни разу не сработал `[MSW] Error: intercepted a request without a matching request handler` для readiness-пути (только пред-существующий шум `/api/notifications/` — unrelated, до этой стори). Страница продолжила рендерить стадийный контент (Расстановка) без падения.

### Completion Notes List

Реализовано по AC 1-6. `<ReadinessPanel eventId={event.id} />` вписана в `SecurityEventDetailPage` между шапкой мероприятия и стадийным контентом. Дублирующий mock `StatBox label="Готовность"` удалён из `DemandForm`, сетка сужена до 3 колонок. Новый dev-mock хендлер (`readiness-handlers.ts`) отдаёт честный 404 для ЛЮБОГО `:id` на реальном пути `/api/operations/security-events/:id/readiness/` — зарегистрирован в `compose-handlers.ts`. Новый файл `SecurityEventDetailPage.test.tsx` (страница не имела своего unit-теста до этой стори) — 2 теста: панель рендерится с переданным `event.id` и честно показывает ошибку при 404; mock `readinessPercent` StatBox больше не рендерится. Живая проверка в браузере подтвердила честную деградацию (не решается юнит-тестами: MSW browser worker строже per-test `server.use()`). `npm run gate` (frontend) — 1156 tests passed (было 1154+2), 0 regressions, size-gate 225.0 KB / 300 KB бюджет. Архитектурное ограничение (ID-пространство mock security-events не пересекается с реальным backend) задокументировано в Dev Notes для будущей стори реальной backend-интеграции.

### File List

- `frontend/src/features/security-events/pages/SecurityEventDetailPage.tsx` (modified — ReadinessPanel wired in, mock StatBox removed)
- `frontend/src/features/security-events/pages/SecurityEventDetailPage.test.tsx` (new)
- `frontend/src/features/security-events/mocks/readiness-handlers.ts` (new)
- `frontend/src/app/mocks/compose-handlers.ts` (modified — readinessMockHandlers registered)

## Change Log

| Дата | Изменение |
|---|---|
| 2026-08-06 | Story создана (create-story). Архитектурная развилка (ID-пространство mock security-events vs реальный backend SecurityEvent) поднята на границе 20.1d→20.1e и решена Bratan'ом: узкая честная стори — вписать панель, задокументировать/протестировать честную деградацию через dev-mock 404-хендлер, НЕ пытаться решить интеграцию целиком. |
| 2026-08-06 | Dev-story: панель вписана, mock StatBox удалён, dev-mock 404-хендлер + регистрация, 2 новых теста, живая проверка в браузере (честная деградация подтверждена). `npm run gate` (frontend) — 1156 passed, 0 regressions. Status → review. |
| 2026-08-06 | Review закрыт (Blind Hunter + Edge Case Hunter + Acceptance Auditor). Acceptance Auditor: все 6 AC SATISFIED, `CommandCenterPage`/`SecurityEventsListPage` подтверждены нетронутыми grep'ом. 2 patch применены (тест 1: `expect()` внутри MSW-резолвера → захват `seenReadinessIds` снаружи, тот же прецедент, что 20.1c уже установила; тест 2: усилен ассертами на оставшиеся 3 `StatBox`, чтобы регресс всей сетки не проходил незамеченным). 6 findings → deferred-work.md (панель на любой стадии ОМ — вероятно намеренно; always-404 не различает причину — by design; отсутствие `enabled`-гейта — pre-existing из 20.1c; неограниченный рост query-кэша — established convention; хардкод id/нет теста CLOSED — test-quality). Edge Case Hunter's находка про отсутствие `resetHandlers()` между тестами ОПРОВЕРГНУТА — вызывается глобально в `vitest.setup.ts:33`. `npm run gate` (frontend) после патчей — 1156 passed, 0 regressions. Status → done. |
