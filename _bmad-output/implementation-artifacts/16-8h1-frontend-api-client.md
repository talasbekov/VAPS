---
baseline_commit: 5b8f177
---

# Story 16.8h1: Frontend — API client для Расстановки

Status: done

## Story

As a **frontend-разработчик следующих под-сторий 16.8h**,
I want **типизированный `queries.ts` над `/api/operations/assignment-versions/*` и `/placement-assignments/*`**,
so that **экраны (16.8h2-8) переиспользуют готовые React Query хуки, не изобретая fetch-вызовы заново**.

Часть 1/8 расщепления 16.8h (frontend не имел вообще никакого UI для Расстановки — новая фича с нуля).

## Scope Decision

- **Образец — `frontend/src/features/duty-plans/api/queries.ts`** (14.11i) — буквально копируется структура: `paths[...]`-выведенные типы (НЕ ручное дублирование), `{feature}Keys`-объект query-ключей, `useQuery`-хуки для чтения, `useApiMutation`-хуки для мутаций (СЫРОЙ `useMutation` в `src/features/**` забанен ARCH-FE-015-eslint'ом).
- **Эндпоинты, покрываемые этой стори (все 16.8a-f):**
  - `GET /api/operations/assignment-versions/` → `useAssignmentVersions(eventId?)`
  - `GET /api/operations/assignment-versions/{id}/` → `useAssignmentVersion(versionId)`
  - `GET /api/operations/assignment-versions/{id}/conflicts/` → `useAssignmentVersionConflicts(versionId)`
  - `POST /api/operations/security-events/{id}/placement/draft/` → `useCreatePlacementDraft(eventId)`
  - `POST /api/operations/assignment-versions/{id}/submit/` → `useSubmitAssignmentVersion(versionId)`
  - `POST /api/operations/assignment-versions/{id}/return/` → `useReturnAssignmentVersion(versionId)`
  - `POST /api/operations/assignment-versions/{id}/approve/` → `useApproveAssignmentVersion(versionId)`
  - `POST /api/operations/placement-assignments/{id}/acknowledge/` → `useAcknowledgePlacementAssignment(assignmentId)`
- **`src/shared/api/schema.d.ts` уже перегенерирован** (`npm run generate:api`, коммит `5b8f177`) — все 8 путей присутствуют, эта стори их ТОЛЬКО потребляет.
- **`useApiMutation`'s conflict-канал (409 overridable) — используется для `approve`** (16.8d's `SOFT_CONFLICT_DETECTED`), тот же `confirmOverride`/`dismissConflict`-паттерн, что уже есть в `useApproveDutyPlan`-подобных хуках — НЕ изобретается заново.
- **НЕТ UI в этой стори** — только хуки + типы + MSW-мок-фикстуры (`mocks/handlers.ts`/`fixtures.ts`, образец `duty-plans/mocks/`) для последующих сторий 16.8h2-8 тестировать без реального бэка.
- **Query-инвалидация**: `submit`/`return`/`approve` инвалидируют `assignmentVersionKeys.detail(id)` + `.lists()`; `acknowledge` инвалидирует только `.detail(assignmentVersionId)` версии, к которой относится назначение (assignment уже содержит `version`-поле для этого).

## Acceptance Criteria

1. **AC-1.** `useAssignmentVersions(eventId?)` — список, опциональный фильтр по event.
2. **AC-2.** `useAssignmentVersion(versionId)` — деталь, вложенные `assignments`.
3. **AC-3.** `useAssignmentVersionConflicts(versionId)` — плоский список (НЕ paginated, 16.8f).
4. **AC-4.** `useCreatePlacementDraft`, `useSubmitAssignmentVersion`, `useReturnAssignmentVersion`, `useApproveAssignmentVersion`, `useAcknowledgePlacementAssignment` — все через `useApiMutation`, корректная query-инвалидация на success.
5. **AC-5.** `approve`'s conflict-канал доступен вызывающей стороне (типизированный `ConflictError`/`confirmOverride`).
6. **AC-6.** Unit-тесты хуков (образец `duty-plans`'s тестовый паттерн, если есть, иначе MSW-хендлеры + `renderHook`).
7. **AC-7.** `npm run gate` зелёный (tsc, eslint, vitest, build, size-gate).

## Out of Scope

- Любой UI/страницы (16.8h2-7).
- Роутинг (16.8h8).

## Tasks / Subtasks

- [x] Task 1 — `frontend/src/features/placement/api/queries.ts` — типы + query-ключи + хуки (AC 1-5)
- [x] Task 2 — `frontend/src/features/placement/mocks/fixtures.ts` + `handlers.ts` (MSW, образец `duty-plans/mocks/`)
- [x] Task 3 — Тесты (AC 6)
- [x] Task 4 — Гейт (AC 7)

## Dev Notes

- `frontend/src/features/duty-plans/api/queries.ts` — буквальный образец, читать целиком перед реализацией.
- `frontend/src/shared/api/useApiMutation.ts` — conflict-канал (`ConflictError`/`confirmOverride`/`dismissConflict`), читать перед `useApproveAssignmentVersion`.
- Проверить MSW-путь-коллизию (`feedback_msw_path_collision_silent` — грепать `src` на занятость `/api/operations/assignment-versions` ДО регистрации хендлера).

### References

- [Source: frontend/src/features/duty-plans/api/queries.ts]
- [Source: frontend/src/shared/api/useApiMutation.ts]
- [Source: Backend/VAPS/schema.yaml] — контракт (актуален на коммит 5b8f177).

## Dev Agent Record

### Agent Model Used

Claude Sonnet 5

### Debug Log References

### Completion Notes List

Реализовано по AC 1-7. `queries.ts` — 8 типов из `paths[...]` (approve's `requestBody` опционален на уровне схемы — `NonNullable<...>['content']`, найдено при tsc), query-ключи, 3 `useQuery`-хука (list/detail/conflicts), 5 `useApiMutation`-хуков (draft/submit/return/approve/acknowledge). MSW-фикстуры+хендлеры (образец `duty-plans/mocks/`), зарегистрированы в `app/mocks/compose-handlers.ts`. Найден ESLint-гард на `_omit`-идиому (`no-unused-vars` без `varsIgnorePattern`) — исправлено delete-по-копии вместо деструктуризации. 7 новых hook-тестов (образец `useApiMutation.test.tsx` — `ToastProvider`+`QueryClientProvider`-обёртка, MSW per-test). `npm run gate` — 1054 passed, 0 regressions, tsc/eslint чисты, build ok, size-gate 219.6 KB / 300 KB бюджет.

### File List

- `frontend/src/features/placement/api/queries.ts` (new)
- `frontend/src/features/placement/api/queries.test.tsx` (new)
- `frontend/src/features/placement/mocks/fixtures.ts` (new)
- `frontend/src/features/placement/mocks/handlers.ts` (new)
- `frontend/src/app/mocks/compose-handlers.ts` (modified — регистрация `placementHandlers`)

**После ревью:**
- `frontend/src/features/placement/mocks/handlers.ts` (modified — `return`-хендлер сбрасывает conflict/ack-поля на новом драфте)
- `frontend/src/features/placement/api/queries.test.tsx` (modified — 2 новых теста + инвалидация-ассерты в 2 существующих)

## Change Log

| Дата | Изменение |
|---|---|
| 2026-08-03 | Story создана (create-story). Часть 1/8 расщепления 16.8h — фундамент (API client), без UI. |
| 2026-08-03 | Dev-story: `queries.ts` + MSW-мок. 7 новых тестов. `npm run gate` — 1054 passed, 0 regressions, build/size-gate ok. Status → review. |
| 2026-08-03 | 3-agent ревью (Blind Hunter, Edge Case Hunter, Acceptance Auditor). Edge Case Hunter (independently confirmed, High): mock's `return`-хендлер копировал `conflict_severity`/`acknowledged_at` на новый драфт, реальный бэк их сбрасывает (`bulk_create` только `version`/`employee_id`/`post_id`) — исправлено. Acceptance Auditor + Edge Case Hunter независимо совпали: `useCreatePlacementDraft` не имел тестов вовсе, инвалидация кэша нигде не ассертилась (только успех запроса) — добавлены 2 новых теста + `getQueryState(...).isInvalidated`-ассерты в `submit`/`acknowledge`. Blind Hunter's "list strips assignments — silent type lie" — ложное срабатывание: реальная схема (`AssignmentVersion` vs `AssignmentVersionDetail`) подтверждает список НЕ несёт `assignments` — мок корректен. Остальные находки — вне объёма (нет UI-потребителя ещё) или совпадают с существующей конвенцией `duty-plans`. `npm run gate` повторно — 1056 passed, 0 regressions, tsc/eslint чисты. Status → done. |
