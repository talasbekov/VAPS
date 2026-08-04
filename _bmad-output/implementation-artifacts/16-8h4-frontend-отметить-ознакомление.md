---
baseline_commit: c090eda
---

# Story 16.8h4: Frontend — отметить ознакомление

Status: review

## Story

As a **участник расстановки (назначенный сотрудник)**,
I want **кнопку «Отметить ознакомление» на строке своего назначения**,
so that **я могу подтвердить, что видел своё назначение, без роли/RBAC-права — identity-based (16.8e)**.

Часть 4/5 пересмотренного расщепления 16.8h.

## Scope Decision

- **Кнопка — прямо в `AssignmentsTable` на `PlacementVersionDetailPage`** (не отдельная страница) — назначение уже там отображается построчно; добавляется 5-я колонка с действием, тот же паттерн, что `unassignMutation`'s per-row кнопка в `SecurityEventDetailPage`'s (pending-contract, но паттерн валиден) `PlacementWorkspace`.
- **НЕТ клиентской identity-проверки "это моё назначение"** — бэк (16.8e) сам решает 403 при чужом `employee_id` (identity через `UserEmployeeBinding`, фронт НЕ знает `employee_id` текущего пользователя без нового эндпоинта — вне объёма). Кнопка показывается на КАЖДОЙ строке без `acknowledged_at`; клик на чужом назначении просто вернёт 403 → рендерится как обычная ошибка мутации (тот же паттерн, что submit/approve).
- **Уже ознакомлено (`acknowledged_at !== null`)** — кнопка не рендерится, вместо неё дата/время (уже так в `AssignmentsTable`, 16.8h2 — эта стори это не меняет, только ДОБАВЛЯЕТ кнопку туда, где `acknowledged_at === null`).
- **`useAcknowledgePlacementAssignment(assignmentId, versionId)`** (16.8h1) уже готов — принимает ОБА id, инвалидирует `detail(versionId)` на success (страница перерисуется, колонка обновится).
- **Ошибка — инлайн под строкой** (не под всей таблицей) — `<tr>` с доп. `<tr>` для ошибки под ней, ИЛИ компактно в той же ячейке (выбор на dev-story: одна строка на назначение проще, ошибка в той же ячейке действия).

## Acceptance Criteria

1. **AC-1.** Строка с `acknowledged_at === null` → кнопка «Отметить ознакомление»; клик → `mutate({})`, успех → ячейка показывает дату/время без reload.
2. **AC-2.** Строка с `acknowledged_at !== null` → НЕТ кнопки, только дата/время (уже так, 16.8h2 — регресс-тест).
3. **AC-3.** 403 (чужое назначение) → ошибка рендерится под кнопкой/в ячейке, кнопка остаётся кликабельной (не блокируется навсегда).
4. **AC-4.** 422 (версия не `APPROVED`) — та же ошибка-обработка (кнопка всё равно рендерится, т.к. фронт не знает статус версии заранее для КАЖДОГО назначения по отдельности — версия ОДНА на всю таблицу, так что фактически недостижимо в UI при `version.status !== "APPROVED"`... **уточнить на dev-story**: если версия не `APPROVED`, показывать ли кнопку вообще? Разумно — НЕ показывать (как lifecycle-кнопки, 16.8h3), тест этого решения обязателен.
5. **AC-5.** Тесты (AC 1-4).
6. **AC-6.** `npm run gate` зелёный.

## Out of Scope

- Отдельный "мой кабинет"/personal view для сотрудника (эта стори — то же самое место, что ОМД видит).
- Маршрутизация/nav (16.8h5).

## Tasks / Subtasks

- [x] Task 1 — `AssignmentsTable`: колонка-действие в `PlacementVersionDetailPage.tsx`, условно по `acknowledged_at === null && version.status === "APPROVED"`
- [x] Task 2 — Ошибка-рендер per-row
- [x] Task 3 — Тесты (AC 1-5)
- [x] Task 4 — Гейт (AC 6)

## Dev Notes

- `frontend/src/features/placement/api/queries.ts::useAcknowledgePlacementAssignment` (16.8h1) — уже готов.
- `PlacementVersionDetailPage.tsx::AssignmentsTable` (16.8h2) — точка расширения, уже существует.

### References

- [Source: frontend/src/features/placement/api/queries.ts]
- [Source: frontend/src/features/placement/pages/PlacementVersionDetailPage.tsx]
- [Source: Backend/VAPS/apps/operations/events/api/views.py::PlacementAssignmentViewSet] (16.8e — identity-модель).

## Dev Agent Record

### Agent Model Used

Claude Sonnet 5

### Debug Log References

### Completion Notes List

Реализовано по AC 1-6. Уточнён на dev-story открытый вопрос AC-4 из Scope Decision: кнопка НЕ рендерится для не-`APPROVED`-версии (тот же принцип, что lifecycle-кнопки 16.8h3). `AcknowledgeCell` — отдельный компонент на строку (не вся таблица), собственный `useAcknowledgePlacementAssignment(assignmentId, versionId)`-инстанс, ошибка инлайн под кнопкой в той же ячейке. Найдено при тестировании: `useAcknowledgePlacementAssignment`'s success — `invalidateQueries`, НЕ `setQueryData` (в отличие от submit/approve/return, 16.8h1/h3) — тест AC-1 потребовал stateful GET-хендлер (не статический ответ), т.к. успех триггерит РЕФЕТЧ, не оптимистичное обновление кэша. 4 новых теста (все AC). `npm run gate` — 1078 passed (было 1074, +4), 0 regressions, tsc/eslint чисты, build/size-gate ok.

### File List

- `frontend/src/features/placement/pages/PlacementVersionDetailPage.tsx` (modified — `AcknowledgeCell`)
- `frontend/src/features/placement/pages/PlacementVersionDetailPage.test.tsx` (modified — 4 новых теста)

## Change Log

| Дата | Изменение |
|---|---|
| 2026-08-04 | Story создана (create-story). Часть 4/5 пересмотренного расщепления 16.8h — кнопка в `AssignmentsTable`, без клиентской identity-проверки (бэк 16.8e уже решает). |
| 2026-08-04 | Dev-story: `AcknowledgeCell`. 4 новых теста. `npm run gate` — 1078 passed, 0 regressions. Status → review. |
