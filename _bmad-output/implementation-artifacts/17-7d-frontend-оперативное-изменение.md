---
baseline_commit: 02888c9
---

# Story 17.7d: Frontend — оперативное изменение (каскадная замена выбывшего)

Status: review

## Story

As a **держатель права `assignment.amend`**,
I want **UI-кнопку «Снять и заменить» на строке назначения в утверждённой версии Расстановки**,
so that **я могу вызвать каскадную замену выбывшего (17.5/17.7b), не обращаясь к API напрямую**.

## Scope Decision

- **Уточнение literal-scope 17.7 (epics.md:1448)**: «API/экраны журнала штаба + аудит + e2e» — literal-текст эпика просит экраны ЖУРНАЛА, не «оперативное изменение» как отдельный экран. 17.7b (API оперативного изменения) уже построен как полезное расширение существующей `AssignmentVersionViewSet`-инфраструктуры (16.8); эта стори (17.7d) — ЕГО минимальный UI-фронт, ограниченный САМЫМ узким, самодостаточным сценарием: **каскадная замена выбывшего** (`cascade_replace_departed()`, 17.5/17.7b), а НЕ полный редактор произвольного `assignments`-списка (`amend_assignment_version()` с генерик-diff — построение UI-редактора постов/сотрудников с нуля — epic-масштаба работа, вне scope, нет запроса в epics.md).
- **Точка врезки** — кнопка «Снять и заменить» на КАЖДОЙ строке `AssignmentsTable` (`PlacementVersionDetailPage.tsx`), видна ТОЛЬКО когда `version.status === 'APPROVED' && version.is_current` (та же lifecycle-логика, что `amend_assignment_version()`'s собственный гард — 17.7b's сервисный вызов иначе вернёт 422, кнопка не должна провоцировать заведомо-невалидный запрос).
- **Диалог** (новый компонент `ReplaceDepartedDialog.tsx`, буквальный образец `ReturnVersionDialog.tsx`'s структуры — `<dialog>`+`showModal`/`close`) — поля: `reason` (текст, обязательно), `sanction` (текст, обязательно). `departed_employee_id` — берётся из строки таблицы (не вводится вручную). `manual_replacement_employee_id` — ВНЕ SCOPE этой стори (авто-поиск по штатной цепочке — единственный путь в UI; ручной выбор кандидата требует employee-picker компонента, которого в кодовой базе ещё нет).
- **Успех** — `POST .../replace-departed/` создаёт новую версию (201) → редирект/обновление на новую текущую версию (тот же паттерн, что `return`'s `new_draft_version`-редирект, `ReturnVersionDialog.tsx`).
- **409 REPLACEMENT_NOT_FOUND** — сообщение об ошибке в диалоге (не ConflictDialog — это не overridable-конфликт, это окончательный отказ; сервис даже не создаёт версию, только эскалационный аудит), диалог остаётся открытым для отмены.
- **Out of scope**: полный `amend`-редактор (произвольный assignments-diff UI); `manual_replacement_employee_id` (ручной выбор кандидата); допнаряд-маркировка через UI (17.4's поля, отдельная стори при необходимости); e2e (17.7e).

## Acceptance Criteria

1. **AC-1.** `APPROVED`+`is_current` версия → каждая строка `AssignmentsTable` несёт кнопку «Снять и заменить».
2. **AC-2.** Версия не `APPROVED`/не `is_current` → кнопка не отображается.
3. **AC-3.** Клик по кнопке → открывается диалог с полями `reason`/`sanction`, оба обязательны (клиентская zod-валидация блокирует пустой сабмит).
4. **AC-4.** Успешный сабмит → `POST .../replace-departed/` → новая текущая версия → страница переходит на неё (redirect на `/placement/{new.id}`, тот же UX, что `ReturnVersionDialog`'s редирект).
5. **AC-5.** 409 `REPLACEMENT_NOT_FOUND` → сообщение об ошибке в диалоге, диалог остаётся открытым (не крашит страницу, не закрывается молча).
6. **AC-6.** Актор без `assignment.amend` (403) → сообщение об ошибке в диалоге, форма остаётся видимой для повторной попытки (17.7c's review-lesson: НЕ permanent lockout — reset() доступен через повторное открытие диалога, диалог размонтируется при закрытии).
7. **AC-7.** `npm run gate` (frontend) зелёный.

## Out of Scope

- Полный редактор `assignments`-списка (генерик `amend`).
- `manual_replacement_employee_id` (ручной выбор кандидата).
- Допнаряд-UI (17.4's поля).
- e2e (17.7e).

## Tasks / Subtasks

- [x] Task 1 — `frontend/src/features/placement/api/queries.ts`: `useReplaceDeparted(versionId)` — типы из `paths['/api/operations/assignment-versions/{id}/replace-departed/']`
- [x] Task 2 — `frontend/src/features/placement/pages/ReplaceDepartedDialog.tsx` (новый компонент, образец `ReturnVersionDialog.tsx`): reason/sanction форма + submit + error-рендер (403/409 — НЕ permanent-lockout, диалог закрывается кнопкой «Отмена», открывается заново чистым)
- [x] Task 3 — Подключить кнопку «Снять и заменить» на каждую строку `AssignmentsTable` (условно на `status === 'APPROVED' && is_current`), передать `departed_employee_id` из строки
- [x] Task 4 — Редирект на новую версию после успеха (образец `ReturnVersionDialog`'s `useNavigate`/эффект на `mutation.data`)
- [x] Task 5 — Тесты (AC 1-6): `ReplaceDepartedDialog.test.tsx` или расширение `PlacementVersionDetailPage.test.tsx` — видимость кнопки/успех-редирект/409/403/пустая-валидация
- [x] Task 6 — `npm run gate` (frontend)

## Dev Notes

- `frontend/src/features/placement/pages/ReturnVersionDialog.tsx` — буквальный образец структуры диалога (native `<dialog>`, `showModal`/`close`, форма, редирект на успех через `useNavigate`).
- `frontend/src/features/placement/api/queries.ts` — `useReturnAssignmentVersion`/`useApproveAssignmentVersion` — образец мутации с `queryClient.setQueryData`/`invalidateQueries`.
- **17.7c's review-урок (permanent-lockout)**: `useApiMutation`'s `error` НЕ самоочищается — если этот диалог, как `JournalPanel`, скрывает форму по `error instanceof ApiError && status === 403`, нужен ЯВНЫЙ путь назад (кнопка «Отмена»/«Повторить» с `mutation.reset()`, или диалог полностью размонтируется при закрытии — `ReturnVersionDialog`'s паттерн уже размонтирует при `open=false`, что естественно очищает mutation-state при следующем открытии, т.к. `useApiMutation` — новый инстанс на каждый маунт компонента... ПРОВЕРИТЬ: `ReplaceDepartedDialog` должен монтироваться/размонтироваться через `open`-condition (НЕ через CSS display:none), чтобы диалог получал свежий `useReplaceDeparted()`-хук при каждом открытии).
- `AssignmentsTable` (`PlacementVersionDetailPage.tsx:225-`) — `version.status`/`version.is_current` уже доступны в родительском компоненте, передать вниз как пропсы.
- Backend (17.7b): `POST /api/operations/assignment-versions/{id}/replace-departed/` — body `{departed_employee_id, reason, sanction}`, 201 (новая версия) / 409 `REPLACEMENT_NOT_FOUND` / 403 / 422.

### References

- [Source: Backend/VAPS/apps/operations/events/api/views.py] — `replace_departed` `@action` (17.7b).
- [Source: frontend/src/features/placement/pages/ReturnVersionDialog.tsx] — образец диалога.
- [Source: frontend/src/features/placement/pages/PlacementVersionDetailPage.tsx] — точка врезки (`AssignmentsTable`).

## Dev Agent Record

### Agent Model Used

Claude Sonnet 5

### Debug Log References

### Completion Notes List

Реализовано по AC 1-7. `useReplaceDeparted` — образец `queries.ts`'s мутаций. `ReplaceDepartedDialog` — буквальный образец `ReturnVersionDialog.tsx` (native `<dialog>`, RHF+Zod, редирект на успех через `useNavigate`); диалог ПОЛНОСТЬЮ размонтируется при `open=false` (`if (!open) return null`) — это САМО закрывает 17.7c's review-урок (permanent-lockout): при следующем открытии `useReplaceDeparted()` — новый инстанс, `mutation.error` не переживает размонтирование, форма ВСЕГДА чистая при новом открытии, отдельный `reset()`-путь не понадобился (структурное решение, не поведенческий костыль). Кнопка «Снять и заменить» — новая колонка `AssignmentsTable`, видна только `status === 'APPROVED' && is_current` (тот же lifecycle-гард, что сервис). MSW-мок для dev:mock (детерминированный demo-id вместо реального штатного поиска — `find_replacement_candidates()` требует core-справочники, недоступные в mock-режиме). `npm run gate` (frontend) — 1124 passed (было 1117), tsc/eslint/build/size-gate все зелёные (223.3 KB gzip, бюджет 300 KB).

### File List

- `frontend/src/features/placement/api/queries.ts` (modified — `useReplaceDeparted`, `ReplaceDepartedRequest`/`Response`)
- `frontend/src/features/placement/pages/ReplaceDepartedDialog.tsx` (new)
- `frontend/src/features/placement/pages/ReplaceDepartedDialog.test.tsx` (new — 7 тестов)
- `frontend/src/features/placement/pages/PlacementVersionDetailPage.tsx` (modified — колонка «Действия», `ReplaceDepartedCell`)
- `frontend/src/features/placement/mocks/handlers.ts` (modified — 1 новый обработчик)

## Change Log

| Дата | Изменение |
|---|---|
| 2026-08-04 | Story создана (create-story). Scope сужен до каскадной замены выбывшего (17.5/17.7b) — literal-текст эпика не просит полный amend-редактор; тот остаётся вне scope. |
| 2026-08-04 | Dev-story: `ReplaceDepartedDialog` + хук + кнопка в `AssignmentsTable` + mock + 7 тестов. `npm run gate` — 1124 passed. Status → review. |
