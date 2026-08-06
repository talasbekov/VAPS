---
baseline_commit: 0720880
---

# Story 20.1c: Фронтенд — API-клиент готовности ОМ

Status: done

## Story

As a **фронтенд-разработчик следующей стори (20.1d, панель)**,
I want **типизированный React Query хук над `GET /api/operations/security-events/{id}/readiness/` (20.1b)**,
so that **будущая панель готовности (20.1d) не пишет свой fetch/типизацию — переиспользует готовый хук, тот же паттерн, что 19.4c для календаря статусов**.

## Scope Decision

- **Только API-клиент, БЕЗ панели/компонента** — та же фронтенд-декомпозиция, что 19.4c/19.4d: хук и компонент — отдельные стори.
- **КРИТИЧНО — `security-events`-фича СЕЙЧАС mock-first, эта стори её НЕ трогает**: исследованием подтверждено — вся папка `frontend/src/features/security-events/` (кроме этого нового файла) работает по конвенции `backend-contract-pending` (`docs/frontend/FRONTEND_MOCK_API_CONTRACT.md`) — `pending-contracts.ts`'s `SECURITY_EVENTS_PATH = '/api/ops/security-events/'` — ФИКТИВНЫЙ путь, не существующий на реальном бэкенде (`/api/ops/` НЕ зарегистрирован ни в одном `urls.py`), обслуживается ТОЛЬКО MSW-моками, не работает в production/real-backend режиме. Story 20.1b, напротив, — РЕАЛЬНЫЙ, закоммиченный в `schema.yaml` эндпоинт (`/api/operations/security-events/{id}/readiness/`). Эта стори строит хук ПРОТИВ РЕАЛЬНОЙ сгенерированной схемы (`shared/api/schema.d.ts`, ARCH-FE-011), СОВЕРШЕННО ОТДЕЛЬНО от `pending-contracts.ts`'s hand-written типов — НЕ смешивать два источника истины (тот же явный запрет, что `pending-contracts.ts`'s собственный докстринг: «не создавать параллельных несовместимых типов»).
- **Новый файл `features/security-events/api/readiness.ts`** (НЕ `pending-contracts.ts`, НЕ `queries.ts` — тот файл целиком построен на pending-contract-путях) — импортирует типы НАПРЯМУЮ из `paths['/api/operations/security-events/{id}/readiness/']` сгенерированной схемы, буквальный образец `duty-plans`/`personnel`/`audit`'s features (реально интегрированные с бэкендом, НЕ pending-contract).
- **`npm run generate:api`** — регенерация `schema.d.ts` из УЖЕ обновлённого (20.1b) `Backend/VAPS/schema.yaml` — обязательный первый шаг, без него `paths['/api/operations/security-events/{id}/readiness/']` не существует в типах.
- **`useSecurityEventReadiness(eventId: string)`** — простой `useQuery<Response, ApiFailure>` (тот же паттерн, что `useSecurityEvent(id)` в `queries.ts` — `eventId` ОБЯЗАТЕЛЬНЫЙ параметр, БЕЗ `enabled`-гейта, в отличие от 19.4c's опциональных `divisionId`/`employeeId`).
- **`readinessKeys`-фабрика ключей — ДОПОЛНЯЕТ существующую `securityEventKeys`** (`query-keys.ts`), не новый отдельный файл — тот же логический неймспейс `security-events`, просто новый под-ресурс: `securityEventKeys.readiness(id)`.
- **Только per-test MSW-хендлеры** (тот же явный выбор, что 19.4c: «MSW dev-фикстуры для `npm run dev:mock` — добавляются вместе с экраном, этой стори достаточно per-test MSW handlers») — эта стори НЕ регистрирует хендлер в `app/mocks/compose-handlers.ts` (тот композит целиком обслуживает mock-first `security-events`-страницы по фиктивному `/api/ops/`-пути; регистрация РЕАЛЬНОГО пути туда — забота будущей стори 20.1d, когда решится, как совместить mock-режим страницы с реальным вызовом панели — см. Dev Notes).
- **Out of scope**: React-компонент/панель (20.1d); wiring в `CommandCenterPage`/`SecurityEventsListPage`/`SecurityEventDetailPage` (те три места уже рендерят фиктивный `event.readinessPercent`, mock-only поле — эта стори его НЕ трогает и НЕ заменяет, разбор соотношения — 20.1d); dev-mock MSW-регистрация; решение архитектурного вопроса «как reconcile mock-only страницу с реальным вызовом панели внутри неё» (флагируется для 20.1d, не решается здесь).

## Acceptance Criteria

1. **AC-1.** `npm run generate:api` регенерирует `schema.d.ts`, содержащий `paths['/api/operations/security-events/{id}/readiness/']['get']`.
2. **AC-2.** `useSecurityEventReadiness(eventId)` возвращает `useQuery`-результат с типом, ВЫВЕДЕННЫМ из `paths[...]['responses']['200']['content']['application/json']` (не ручной интерфейс).
3. **AC-3.** URL корректно интерполирует `eventId` (`/api/operations/security-events/{eventId}/readiness/`).
4. **AC-4.** Happy-path тест: MSW-хендлер отдаёт `{checklist_ready: true, demand_ready: false, placement_ready: false, acknowledgement_ready: true, conflicts_ready: true, readiness_pct: 60}`, хук возвращает те же данные через `result.current.data`.
5. **AC-5.** Ошибка сервера (403/404) корректно попадает в `result.current.error` как `ApiFailure` (тот же паттерн, что `useAssignmentVersion`'s тесты).
6. **AC-6.** `npm run gate` (frontend) зелёный.

## Out of Scope

- React-компонент/панель (20.1d).
- Wiring в существующие mock-only страницы (`CommandCenterPage`/`SecurityEventsListPage`/`SecurityEventDetailPage`'s `readinessPercent`).
- Dev-mock MSW-регистрация (`compose-handlers.ts`).
- Reconcile mock-first `security-events`-страницы с реальным бэкенд-вызовом (флаг для 20.1d).

## Tasks / Subtasks

- [x] Task 1 — `cd frontend && npm run generate:api` — регенерация `src/shared/api/schema.d.ts`.
- [x] Task 2 — `frontend/src/features/security-events/api/readiness.ts`: `useSecurityEventReadiness()` хук + типы.
- [x] Task 3 — `frontend/src/features/security-events/api/query-keys.ts`: `securityEventKeys.readiness(id)`.
- [x] Task 4 — Тесты (AC 2-5): `frontend/src/features/security-events/api/readiness.test.tsx`.
- [x] Task 5 — `npm run gate` (frontend).

## Dev Notes

- `frontend/src/features/duty-plans/api/queries.ts` / `frontend/src/features/personnel/api/queries.ts` / `frontend/src/features/audit/api/queries.ts` — СТРУКТУРНЫЙ ОБРАЗЕЦ реально-интегрированных (не pending-contract) хуков: типы напрямую из `paths['/api/...']['get']['responses']['200']['content']['application/json']`, реальные пути. Копировать ЭТОТ паттерн, НЕ `security-events/api/queries.ts`'s pending-contract паттерн.
- `frontend/src/features/security-events/api/queries.ts:80-85` (`useSecurityEvent`) — структурный образец простого id-based GET-хука (без `enabled`-гейта, id всегда обязателен по типу).
- `frontend/src/features/security-events/api/query-keys.ts` — добавить `readiness: (id: string) => [...securityEventKeys.details(), id, 'readiness'] as const` рядом с существующим `detail`.
- **CAVEAT для будущей 20.1d (панель)**: `security-events`-страницы СЕЙЧАС mock-first (`/api/ops/...`, обслуживается MSW в `dev:mock`). Панель готовности, вызывающая РЕАЛЬНЫЙ `/api/operations/.../readiness/`, будет работать в production-режиме (реальный бэкенд), но в `dev:mock`-режиме запрос уйдёт МИМО MSW (MSW перехватывает только зарегистрированные пути) — поведение (реальный сетевой запрос к несуществующему в dev серверу бэкенду, или сквозной проход) НЕ решается этой стори, только ФИКСИРУЕТСЯ как открытый вопрос для 20.1d.
- `frontend/src/features/placement/api/queries.test.tsx` — структурный образец теста: `QueryClientProvider`+`ToastProvider` wrapper, `server.use(http.get(...))` per-test MSW handler, `renderHook`+`waitFor`.
- `frontend/src/shared/api/client.ts` (`apiClient.get<T>(path)`) — единственная точка транспорта.
- Ответ бэка (20.1b) — типизированный DRF `Serializer` (НЕ `DictField`, в отличие от 19.4b's известной проблемы с drf-spectacular) — `openapi-typescript` должен корректно вывести все 6 полей БЕЗ обходного пути `OpenApiResponse`. Проверить сгенерированный тип ПОСЛЕ `npm run generate:api` — если резолвится в `unknown`/`{}`, см. 19.4c's ревью-урок (тот же класс проблемы: `SecurityEventReadinessSerializer` — обычный `serializers.Serializer` с явными полями, должен резолвиться штатно, но проверить эмпирически, не предполагать).

### References

- [Source: _bmad-output/implementation-artifacts/20-1b-готовность-ом-api.md] — бэкенд-эндпоинт (20.1b), форма ответа.
- [Source: _bmad-output/implementation-artifacts/19-4c-frontend-api-client.md] — прецедент декомпозиции «API-клиент отдельно от экрана», ревью-урок про DictField-резолюцию.
- [Source: docs/frontend/FRONTEND_MOCK_API_CONTRACT.md] — `backend-contract-pending` статус `security-events`, обоснование, почему эта стори НЕ трогает `pending-contracts.ts`.
- [Source: frontend/src/features/duty-plans/api/queries.ts] / [personnel/api/queries.ts] — структурный образец реально-интегрированного хука.

## Dev Agent Record

### Agent Model Used

Claude Sonnet 5

### Debug Log References

### Completion Notes List

Реализовано по AC 1-6. `npm run generate:api` резолвнул `SecurityEventReadiness` корректно (обычный DRF `Serializer` с явными полями — НЕ повторил 19.4b's `DictField`-проблему, тип пришёл сразу правильным, без обходного пути). `useSecurityEventReadiness(eventId)` — буквальный образец `duty-plans/api/queries.ts`'s `useDutyShifts()` (реально-интегрированный хук, не pending-contract). Новый файл `readiness.ts` сознательно ОТДЕЛЁН от `pending-contracts.ts`/`queries.ts` (mock-first `security-events`-конвенция), ключ добавлен в существующую `securityEventKeys`-фабрику. 4 теста (happy-path, 403, 404, URL-интерполяция). `npm run gate` (frontend) — 1149 tests passed (было 1145+4), 0 regressions, size-gate 224.6 KB / 300 KB бюджет.

### File List

- `frontend/src/shared/api/schema.d.ts` (regenerated)
- `frontend/src/features/security-events/api/readiness.ts` (new)
- `frontend/src/features/security-events/api/readiness.test.tsx` (new)
- `frontend/src/features/security-events/api/query-keys.ts` (modified — `readiness` key)

## Change Log

| Дата | Изменение |
|---|---|
| 2026-08-06 | Story создана (create-story). Исследование выявило: `security-events`-фича целиком mock-first (`backend-contract-pending`, фиктивный `/api/ops/` путь) — эта стори строит хук ПРОТИВ РЕАЛЬНОГО эндпоинта (20.1b) отдельным файлом, не смешивая с `pending-contracts.ts`. Reconcile-вопрос (mock-режим страницы vs реальный вызов панели) явно зафлагирован для 20.1d, не решается здесь. |
| 2026-08-06 | Dev-story: `useSecurityEventReadiness()` + 4 теста. `npm run gate` (frontend) — 1149 passed, 0 regressions. Status → review. |
| 2026-08-06 | Review закрыт (Blind Hunter + Edge Case Hunter + Acceptance Auditor). Оба ревьюера независимо совпали на риске коллизии query-key (`readiness` был вложен под `.details()`, который mock-first `queries.ts`'s мутации инвалидируют по prefix-match — случайно рефетчило бы РЕАЛЬНЫЙ бэкенд-запрос при завершении несвязанной mock-мутации) — исправлено собственным корневым ключом. Также исправлен вакуумный тест «interpolates the eventId» (проверял только `toHaveBeenCalledTimes(1)`, не сам URL) — теперь ассертит реальный путь запроса. `npm run gate` (frontend) после патча — 1149 passed, 0 regressions. Status → done. |
