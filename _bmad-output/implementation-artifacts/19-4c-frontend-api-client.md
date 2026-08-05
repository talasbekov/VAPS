---
baseline_commit: a1c3f0b
---

# Story 19.4c: Фронтенд — API-клиент месячного календаря статусов

Status: done

## Story

As a **фронтенд-разработчик следующей стори (19.4d, экран)**,
I want **типизированный React Query хук над `GET /api/operations/statuses/calendar/`**,
so that **экран календаря (19.4d) не пишет свой fetch/типизацию — переиспользует готовый хук, тот же паттерн, что все остальные features**.

## Scope Decision

- **Только API-клиент, БЕЗ экрана/страницы** — фронтенд-декомпозиция этого проекта (CLAUDE.md: API-клиент/layout/форма/... — отдельные стори) требует не смешивать хук и компонент в одной стори. Экран — 19.4d, будущая стори.
- **Новая feature-папка `frontend/src/features/status-calendar/`** — ни одна существующая папка не подходит: `daily-grid` — про грид отклонений текущего дня (Epic 9), не про месячный обзор одного сотрудника; специализированной "statuses"-фичи не существует. Новая фича — минимальный, явный дом для FR-37's экрана(ов).
- **`useEmployeeStatusCalendar(divisionId, employeeId, year, month)`** — буквальный образец `usePersonnel`'s query-хуков (`frontend/src/features/personnel/api/queries.ts`): `useQuery<Response, ApiFailure>`, типы выведены из `paths[...]` сгенерированной схемы (`shared/api/schema.d.ts`), НЕ ручные интерфейсы.
- **`npm run generate:api`** — регенерация `shared/api/schema.d.ts` из УЖЕ обновлённого (19.4b) `Backend/VAPS/schema.yaml` — обязательный первый шаг, без него `paths['/api/operations/statuses/calendar/']` не существует в типах.
- **Query-параметры через `URLSearchParams`** — образец `security-events/api/queries.ts`'s `toQueryString()`, не ручная конкатенация строк.
- **`enabled: Boolean(divisionId && employeeId)`** — хук может быть смонтирован ДО того, как экран (19.4d) выберет сотрудника/подразделение (напр. в форме выбора) — запрос не должен уйти с пустыми параметрами.
- **Out of scope**: React-компонент/страница календаря (19.4d); роутинг/`RequirePermission`-guard (19.4d, тот же паттерн, что остальные защищённые маршруты); MSW dev-фикстуры для `npm run dev:mock` (добавляются вместе с экраном, 19.4d — этой стори достаточно per-test MSW handlers).

## Acceptance Criteria

1. **AC-1.** `npm run generate:api` регенерирует `schema.d.ts`, содержащий `paths['/api/operations/statuses/calendar/']['get']`.
2. **AC-2.** `useEmployeeStatusCalendar(divisionId, employeeId, year, month)` возвращает `useQuery`-результат с типом `EmployeeStatusCalendarResponse` (выведен из `paths[...]`, форма `Record<string, string>`).
3. **AC-3.** Query-параметры (`division_id`, `employee_id`, `year`, `month`) корректно сериализуются в URL через `URLSearchParams`.
4. **AC-4.** `enabled: false`, когда `divisionId`/`employeeId` пусты — запрос НЕ уходит (тест: MSW handler не вызван / хук остаётся `isPending` без сетевого вызова).
5. **AC-5.** Happy-path тест: MSW-хендлер отдаёт `{ "2026-08-01": "IN_SERVICE", ... }`, хук возвращает те же данные через `result.current.data`.
6. **AC-6.** Ошибка сервера (403/404) корректно попадает в `result.current.error` как `ApiFailure` (тот же паттерн, что `useAssignmentVersion`'s тесты).
7. **AC-7.** `npm run gate` (frontend) зелёный.

## Out of Scope

- React-компонент/страница (19.4d).
- Роутинг/permission guard (19.4d).
- MSW dev-фикстуры для `npm run dev:mock` (19.4d).
- Календарь по Подразделению (19.5, отдельная backend+frontend цепочка).

## Tasks / Subtasks

- [x] Task 1 — `cd frontend && npm run generate:api` — регенерация `src/shared/api/schema.d.ts`.
- [x] Task 2 — `frontend/src/features/status-calendar/api/queries.ts`: `useEmployeeStatusCalendar()` хук + типы + `statusCalendarKeys` (query-key фабрика, образец `securityEventKeys`).
- [x] Task 3 — Тесты (AC 2-6): `frontend/src/features/status-calendar/api/queries.test.tsx` — MSW per-test handlers, образец `placement/api/queries.test.tsx`.
- [x] Task 4 — `npm run gate` (frontend).

## Dev Notes

- `frontend/src/features/personnel/api/queries.ts` — структурный образец простого GET-хука (`useQuery<Response, ApiFailure>`, `queryKey`, `apiClient.get<Response>(path)`).
- `frontend/src/features/security-events/api/queries.ts:60-67` (`toQueryString`) — образец сериализации query-параметров через `URLSearchParams`, буквально копируется (меняются только имена параметров).
- `frontend/src/features/placement/api/queries.test.tsx` — структурный образец теста: `QueryClientProvider` + `ToastProvider` wrapper, `server.use(http.get(...))` per-test MSW handler, `renderHook`+`waitFor`.
- `frontend/src/shared/api/client.ts` (`apiClient.get<T>(path)`) — единственная точка транспорта, не `fetch()` напрямую (ARCH-FE-015-подобный запрет на сырой `useMutation`/fetch в `src/features/**`, та же дисциплина применяется к GET).
- `frontend/src/shared/api/schema.d.ts` — генерируется, НЕ редактируется руками; коммитится в репозиторий (образец: предыдущие стори коммитят регенерированный файл вместе с кодом, который на него опирается).
- Ответ бэка (19.4b) — ПЛОСКИЙ объект `{"2026-08-01": "IN_SERVICE", ...}`, НЕ массив/обёрнутый в `results` — тип `Record<string, string>`, выведенный из `paths[...]['responses']['200']['content']['application/json']`.

### References

- [Source: _bmad-output/implementation-artifacts/19-4b-api-месячный-календарь.md] — бэкенд-эндпоинт (19.4b), форма ответа.
- [Source: frontend/src/features/personnel/api/queries.ts] — структурный образец GET-хука.
- [Source: frontend/src/features/security-events/api/queries.ts] — образец `toQueryString`.
- [Source: frontend/src/features/placement/api/queries.test.tsx] — образец теста с MSW.

## Dev Agent Record

### Agent Model Used

Claude Sonnet 5

### Debug Log References

### Completion Notes List

Реализовано по AC 1-7. `npm run generate:api` подтянул `paths['/api/operations/statuses/calendar/']` из уже обновлённого (19.4b) `schema.yaml`. `useEmployeeStatusCalendar()` — буквальный образец `personnel/api/queries.ts` (простой `useQuery`) + `security-events/api/queries.ts`'s `toQueryString()` (URLSearchParams). `enabled: Boolean(divisionId && employeeId)` предотвращает запрос с пустыми параметрами. Ответ типизирован как `Record<string, string>`, выведенный из схемы (плоский объект `{ISO-дата: код}`, 19.4b). 3 теста (happy-path с проверкой query-параметров, 403→`ApiError` с `errorCode`, `enabled:false` — хендлер НЕ вызван). `npm run gate` (frontend) — 1132 tests passed (было 1129 + 3), 0 regressions, size-gate 223.9 KB / 300 KB бюджет.

**Ревью (Blind Hunter + Edge Case Hunter + Acceptance Auditor)** — все 7 AC подтверждены (все три ревьюера независимо перепроверили: нет React-компонента, нет роутинга, нет MSW dev-фикстур в этой стори). ГЛАВНАЯ находка (High, независимо подтверждена Blind Hunter и Edge Case Hunter): `EmployeeStatusCalendarResponse` резолвился в `{[key: string]: unknown}`, НЕ `Record<string, string>` — 19.4b's `serializers.DictField(child=serializers.CharField())`, переданный напрямую в `@extend_schema(responses={...})`, НЕ был понят drf-spectacular 0.30.0 (`_get_response_for_code()`: bare `DictField` — не Serializer/list/basic-type/type-hint → тихий fallback на `additionalProperties: {}` / "Unspecified response body"). ИСПРАВЛЕНО В BACKEND (19.4b, `apps/operations/statuses/api/views.py`): `OpenApiResponse(response={"type": "object", "additionalProperties": {"type": "string"}}, ...)` — сырой OpenAPI-схема-dict, задокументированный обходной путь именно для этого случая (`isinstance(serializer, dict)` — короткое замыкание резолюции). `schema.yaml` регенерирован, фронт `schema.d.ts` регенерирован — тип теперь корректно `{[key: string]: string}`. Добавлен тест `refetches when year/month change` (Med-находка, Edge Case Hunter — единственное реально важное непротестированное поведение хука, чьё назначение — навигация по месяцам). Остальные находки (whitespace-only ID проходит `enabled`-гейт, отсутствие явного round-trip-теста на zero-padding месяца, отсутствие 400/404-тестов — избыточны, `parseErrorResponse` уже единообразен) — отложены как Low, не блокируют. `make gate` (Backend/VAPS) — 4266 passed; `npm run gate` (frontend) — 1133 passed после фикса.

### File List

- `Backend/VAPS/apps/operations/statuses/api/views.py` (modified — review fix, `calendar` action's `@extend_schema(responses=...)`)
- `Backend/VAPS/schema.yaml` (regenerated — review fix)
- `frontend/src/shared/api/schema.d.ts` (regenerated)
- `frontend/src/features/status-calendar/api/queries.ts` (new)
- `frontend/src/features/status-calendar/api/queries.test.tsx` (new)

## Change Log

| Date | Change |
|---|---|
| 2026-08-05 | Story created (create-story workflow, 19.4c — фронтенд API-клиент над 19.4b), baseline `a1c3f0b` |
| 2026-08-05 | Implemented (dev-story), status → review |
| 2026-08-05 | Code review (Blind Hunter + Edge Case Hunter + Acceptance Auditor): fixed 19.4b's OpenAPI response schema (DictField wasn't resolved, response typed as `unknown`), added month-change refetch test; status → done |
