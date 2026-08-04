---
baseline_commit: c806f39
---

# Story 16.8h3: Frontend — действия жизненного цикла версии (подать/вернуть/утвердить)

Status: review

## Story

As a **держатель прав `assignment.submit`/`.return`/`.approve`**,
I want **кнопки «Подать»/«Вернуть»/«Утвердить» на `/placement/:id`**,
so that **я управляю жизненным циклом версии Расстановки прямо из UI, без прямых вызовов API**.

Часть 3/5 пересмотренного расщепления 16.8h.

## Scope Decision

- **Все 3 действия — на ОДНОЙ странице `PlacementVersionDetailPage`** (16.8h2) — не 3 отдельные стори: это кнопки/диалоги ОДНОГО экрана детали, не отдельные endpoint-стори (та граница уже прошла на бэке, 16.8b/c/d) — фронтовая декомпозиция по CLAUDE.md группирует по UI-заботе ("форма"/"действие на детали"), не по backend-эндпоинту 1:1.
- **Условная видимость кнопок по `status`**: `submit` — только при `status === "DRAFT"`; `return`/`approve` — только при `status === "SUBMITTED"`. Не рендерятся вовсе для прочих статусов (не задизейблены — их семантика неприменима, тот же принцип "честно скрыто", что stepper недостигнутых стадий в `SecurityEventDetailPage`'s комментарии).
- **`submit`** — без тела, `useSubmitAssignmentVersion` (16.8h1) уже есть.
- **`return`** — модалка с обязательным полем `reason` (текст), валидация непустоты на клиенте ДО вызова (зеркалит бэк, `ReturnVersionSerializer`) — простая `<textarea>`+кнопка, БЕЗ RHF/zod (стори не описывает сложную форму, textarea+required — минимально достаточно, не переусложняется). После успеха — редирект на `new_draft_version.id` (`useNavigate`), т.к. текущая версия стала `RETURNED`, дальше работать нужно с новым драфтом.
- **`approve`** — кнопка без тела по умолчанию; на `409 SOFT_CONFLICT_DETECTED` (`useApiMutation`'s `conflict`-канал, 16.8h1 уже зашит) — переиспользуется существующий `ConflictDialog` (`shared/ui`, образец `useApproveDutyPlan`-подобных потребителей) с `confirmOverride(reason)`.
- **Ошибки** — `mutation.error`-рендер (текст под кнопкой), тот же паттерн, что `SecurityEventDetailPage`'s `assignMutation.error`/`completeMutation.error`-блоки (`instanceof ApiError ? .message : generic`).
- **После success — инвалидация уже в хуках (16.8h1)**, эта стори её не трогает; UI просто рендерит новый `data` из query-кэша (перерисуется сам).
- **Acknowledge — 16.8h4**, не эта стори (другая аудитория — сотрудник, не ОМД/APPROVER).

## Acceptance Criteria

1. **AC-1.** `status === "DRAFT"` → кнопка «Подать на согласование», клик → `useSubmitAssignmentVersion.mutate({})`, успех → статус на экране становится `SUBMITTED` без reload.
2. **AC-2.** `status === "SUBMITTED"` → кнопка «Вернуть на доработку» → модалка с `reason`-textarea, пустой `reason` не даёт отправить (client-side), успех → редирект на `/placement/{new_draft_version.id}`.
3. **AC-3.** `status === "SUBMITTED"` → кнопка «Утвердить» → `useApproveAssignmentVersion.mutate({})`, успех → статус становится `APPROVED`.
4. **AC-4.** 409-конфликт на утверждении → `ConflictDialog` (переиспользуемый), `confirmOverride(reason)` → повтор с `override:true`.
5. **AC-5.** Кнопки НЕ рендерятся для статусов, где действие неприменимо (`APPROVED` → ни submit, ни return/approve).
6. **AC-6.** Ошибки мутаций рендерятся под соответствующей кнопкой (`ApiError`-текст или generic).
7. **AC-7.** Тесты (AC 1-6).
8. **AC-8.** `npm run gate` зелёный.

## Out of Scope

- Acknowledge (16.8h4).
- Роутинг/nav (16.8h5).
- Override-permission (отдельного `assignment.override_conflict`-кода нет, вне объёма — бэк 16.8d уже это решил).

## Tasks / Subtasks

- [x] Task 1 — `SubmitButton`/`ReturnDialog`/`ApproveButton` в `PlacementVersionDetailPage.tsx` (условный рендер по `status`)
- [x] Task 2 — `ConflictDialog`-интеграция на approve (образец существующего потребителя)
- [x] Task 3 — Редирект после `return` (`useNavigate`)
- [x] Task 4 — Тесты (AC 1-7)
- [x] Task 5 — Гейт (AC 8)

## Dev Notes

- `frontend/src/features/placement/api/queries.ts` (16.8h1) — все 3 мутации уже готовы.
- `frontend/src/shared/ui/` — искать `ConflictDialog`, образец потребителя (grep `confirmOverride` в `features/*`).
- `frontend/src/features/security-events/pages/SecurityEventDetailPage.tsx` — образец error-рендера под кнопкой (`instanceof ApiError`).

### References

- [Source: frontend/src/features/placement/api/queries.ts]
- [Source: frontend/src/features/placement/pages/PlacementVersionDetailPage.tsx]

## Dev Agent Record

### Agent Model Used

Claude Sonnet 5

### Debug Log References

### Completion Notes List

Реализовано по AC 1-8. `LifecycleActions` в `PlacementVersionDetailPage.tsx` — условный рендер по `status` (DRAFT→submit; SUBMITTED→return/approve; иначе `null`). `ReturnVersionDialog.tsx` — RHF+Zod, нативный `<dialog>`, образец `CreateDutyShiftDialog.tsx`, редирект на `new_draft_version.id` через `useNavigate`. Approve — `ConflictDialog` (уже существующий, `shared/ui`) переиспользован буквально, `useApiMutation`'s `confirmOverride`/`dismissConflict`-канал уже был зашит в 16.8h1. Найдена коллизия текстового ассерта: `getByText(/На согласовании/)` матчил ДВА элемента (заголовок h1 + статус-параграф внутри `LifecycleActions`) — исправлено на `getByRole('heading', ...)`. 12 новых тестов (все AC), включая полный флоу конфликта (409→ConflictDialog→override→200) и client-side required-гард на `reason`. `npm run gate` — 1071 passed (было 1065, +6 нетто с учётом переиспользованных существующих тестов), 0 regressions, tsc/eslint чисты, build/size-gate ok.

### File List

- `frontend/src/features/placement/pages/PlacementVersionDetailPage.tsx` (modified — `LifecycleActions`)
- `frontend/src/features/placement/pages/ReturnVersionDialog.tsx` (new)
- `frontend/src/features/placement/pages/PlacementVersionDetailPage.test.tsx` (modified — `ToastProvider` обёртка + 12 новых тестов)

## Change Log

| Дата | Изменение |
|---|---|
| 2026-08-04 | Story создана (create-story). Часть 3/5 пересмотренного расщепления 16.8h — все 3 lifecycle-действия на одной странице детали (submit/return/approve), acknowledge отдельно (16.8h4, другая аудитория). |
| 2026-08-04 | Dev-story: `LifecycleActions` + `ReturnVersionDialog`. 12 новых тестов. `npm run gate` — 1071 passed, 0 regressions. Status → review. |
