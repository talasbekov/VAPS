---
baseline_commit: 0599d95
---

# Story 17.7c: Frontend — журнал штаба

Status: done

## Story

As a **держатель права `event.journal.create`/`event.journal.view`**,
I want **UI-панель журнала штаба на странице версии Расстановки**,
so that **я могу читать и писать записи журнала (17.1/17.2/17.7a), не обращаясь к API напрямую**.

## Scope Decision

- **КРИТИЧЕСКИ ВАЖНО (найдено в ходе research для этой стори, скорректировало исходный план 17.7 decomposition)**: `frontend/src/features/security-events/` — ЦЕЛИКОМ `backend-contract-pending` (`docs/frontend/FRONTEND_MOCK_API_CONTRACT.md`, namespace `/api/ops/security-events/`) — donor-паритетный прототип (Smart Josparlau), НЕ подключённый к реальному бэку Epic 15-17 (`apps.operations.events`, namespace `/api/operations/`). Внутри уже ЕСТЬ мок-версия журнала (`useAddJournalEntry`, `JournalEntryType = 'INSTRUCTION'|'ORDER'|'INCIDENT'|'REPLACEMENT'`) — ДРУГОЙ enum, ДРУГОЙ id-space, чем реальный бэк 17.1/17.7a (`BRIEFING`/`DIRECTIVE`/`INCIDENT`). Точечная миграция ТОЛЬКО журнала внутри этой страницы сломала бы согласованность страницы (остальные секции — bulletin/recon/placement/closure — остаются мок-данными с мок-id) и нарушила бы §7.5 контракта («не создавай отдельные несовместимые типы»). Решение с Bratan: **НЕ трогать `features/security-events/`** — это отдельный prototype-трек. Полная миграция security-events с mock на реальный бэк — epic-масштаба работа, вне scope этой стори.
- **Вместо этого**: новая независимая панель журнала под `features/placement/` (УЖЕ на реальной схеме — `queries.ts`'s комментарий "Реальная схема (не pending-contract)", 16.8h1) — та же feature-папка, что версии Расстановки. Добавляется на `PlacementVersionDetailPage.tsx` (уже показывает `event`-поле версии) — журнал рендерится под секцией назначений, keyed по `version.event` (реальный Django event id, не мок-id).
- **Эндпоинты** (17.7a, уже реальные): `GET /api/operations/security-events/{eventId}/journal-entries/` (список), `POST .../journal-entries/` (создание, форма: `entry_type`/`text`/опц. `post`/`participant_ids`/`photo_attachment_id`).
- **`post`-поле** — эта стори ОГРАНИЧИВАЕТ форму BRIEFING/DIRECTIVE (без поста); INCIDENT-запись с обязательным постом — вне scope (нет UI выбора поста в этой стори, `post` эндпоинт технически принимает, но форма его не предлагает). `participant_ids`/`photo_attachment_id` — тоже вне scope формы (аплоад фото — существующий 6.1-эндпоинт, не подключается здесь).
- **`GET /api/operations/journal-entries/{id}/`** (detail-эндпоинт, 17.7a) — НЕ используется этой стори (список уже несёт все нужные поля, отдельная detail-навигация не требуется).
- **RBAC** — `event.journal.view` гейтит рендер списка (403 → пустое состояние с сообщением, не крах страницы); `event.journal.create` гейтит форму (403 на POST → toast, форма остаётся видимой для повторной попытки — тот же UX-канон, что `useApiMutation`'s error-handling в остальных стори этой feature-папки).
- **Out of scope**: миграция `features/security-events/` (отдельная epic-масштаба работа); фильтрация списка по `entry_type` (эндпоинт поддерживает `?entry_type=`, UI — не в этой стори, простой хронологический список); INCIDENT-тип записи (требует пост-выбор — 17.7d или отдельная стори).

## Acceptance Criteria

1. **AC-1.** Открыть `PlacementVersionDetailPage` для существующей версии → под секцией назначений видна панель «Журнал штаба» со списком записей события (`GET .../journal-entries/`), актор с `event.journal.view`.
2. **AC-2.** Список пуст → видно пустое состояние («Записей пока нет»), не ошибка.
3. **AC-3.** Форма (тип `BRIEFING`/`DIRECTIVE` — select, текст — textarea) + кнопка «Добавить запись», актор с `event.journal.create` → сабмит → `POST .../journal-entries/` → новая запись появляется в списке (инвалидация/оптимистичный рефетч), форма очищается.
4. **AC-4.** Актор без `event.journal.view` → панель показывает «Нет доступа» вместо списка, не 403-крах страницы.
5. **AC-5.** Актор без `event.journal.create` → форма скрыта/задизейблена (403 на попытке сабмита обрабатывается через `useApiMutation`'s стандартный error-toast, не крашит страницу).
6. **AC-6.** Пустой текст в форме → клиентская валидация блокирует сабмит до вызова API (zod-схема, тот же канон, что `bulletinSchema` и другие формы этой кодовой базы).
7. **AC-7.** `npm run gate` (frontend) зелёный — tsc/eslint/vitest/build/size-gate.

## Out of Scope

- Миграция `features/security-events/` с mock на реальный бэк.
- INCIDENT-тип записи (пост-выбор) — отдельная стори при необходимости.
- Фильтр по `entry_type`, участники (`participant_ids`), фото (`photo_attachment_id`).
- 17.7d (оперативное изменение) — отдельная стори.
- e2e (17.7e).

## Tasks / Subtasks

- [x] Task 1 — `frontend/src/features/placement/api/queries.ts`: `useJournalEntries(eventId)` (query), `useAddJournalEntry(eventId)` (mutation) — типы из `paths['/api/operations/security-events/{id}/journal-entries/']`
- [x] Task 2 — `frontend/src/features/placement/pages/JournalPanel.tsx` (новый компонент): список + форма, RBAC-условный рендер (403 → "Нет доступа"/форма скрыта), zod-валидация текста
- [x] Task 3 — Подключить `JournalPanel` в `PlacementVersionDetailPage.tsx` (передать `version.event`)
- [x] Task 4 — `frontend/src/features/placement/mocks/fixtures.ts` + `mocks/handlers.ts`: demo-данные и MSW-обработчики для dev:mock режима (list/create)
- [x] Task 5 — Тесты (AC 1-6): `JournalPanel.test.tsx` — рендер списка/пустое состояние/сабмит формы/403-view/403-create/пустой-текст-валидация
- [x] Task 6 — `npm run gate` (frontend)

## Dev Notes

- `frontend/src/features/placement/api/queries.ts` — буквальный образец структуры хука (query-keys, `useApiMutation`, `paths[...]`-типизация). НЕ импортировать типы из `features/security-events/model/types.ts` (другой, мок-контракт) — только реальная OpenAPI-схема (`src/shared/api/schema.d.ts`, перегенерирована в 17.7b's сессии командой `npm run generate:api`).
- `frontend/src/features/placement/pages/PlacementVersionDetailPage.tsx` — `version.event` (число, реальный Django event id) — передать в `JournalPanel`.
- RBAC на фронте — эта кодовая база НЕ хранит permission-коды клиентской стороной для conditional-рендера (в отличие от route guards) — 403 обрабатывается РЕАКТИВНО через `ApiError`/`useApiMutation`'s error-канал (запрос уходит, бэк отвечает 403, UI показывает "Нет доступа"), не заранее скрывается по client-side permission-check (тот же паттерн, что остальные mutation'ы этой feature-папки — нет client-side permission-gating нигде в `placement/`).
- `bulletinSchema` (`features/security-events/pages/SecurityEventDetailPage.tsx:46-50`) — образец zod-валидации формы (`z.string().trim().min(1, 'Обязательное поле')`).
- `frontend/src/features/placement/mocks/handlers.ts`/`fixtures.ts` — образец MSW-паттерна для dev:mock; `nextVersionId`-подобный counter для новых записей.
- `docs/frontend/FRONTEND_MOCK_API_CONTRACT.md` — journal-entries НЕ добавляется в этот реестр (тот реестр — ТОЛЬКО для `backend-contract-pending`/`external-personnel-contract-pending`/`mock-only-demo` операций; `placement/`'s эндпоинты УЖЕ реальные, как и все остальные хуки этой feature-папки — не документированы там же по той же причине).

### References

- [Source: Backend/VAPS/apps/operations/events/api/views.py] — `journal_entries` `@action` (17.7a).
- [Source: frontend/src/features/placement/api/queries.ts] — образец хуков.
- [Source: frontend/src/features/placement/pages/PlacementVersionDetailPage.tsx] — точка врезки.
- [Source: docs/frontend/FRONTEND_MOCK_API_CONTRACT.md] — почему `features/security-events/` не трогается.

## Dev Agent Record

### Agent Model Used

Claude Sonnet 5

### Debug Log References

### Completion Notes List

Реализовано по AC 1-7. `useJournalEntries`/`useAddJournalEntry` — образец `queries.ts`'s существующих хуков (`paths[...]`-типизация из `schema.d.ts`, перегенерирован `npm run generate:api` после 17.7b's `schema.yaml`-обновления). `JournalPanel` — новый компонент, RBAC реактивно (403 из query/mutation error-канала → "Нет доступа"/скрытая форма, без client-side permission-check, тот же паттерн, что весь остальной `placement/`). zod-валидация текста (`bulletinSchema`-образец). MSW fixtures/handlers для dev:mock (list фильтрует по `event`, create пушит в фикстуру). Побочный фикс: 2 существующих теста в `PlacementVersionDetailPage.test.tsx` использовали неспецифичный `screen.findByRole('textbox')`, ожидая единственный textbox на странице (ConflictDialog's reason-поле) — после добавления `JournalPanel`'s собственной `<textarea>` запрос стал неоднозначным (2 совпадения) — исправлено на `within(dialog).getByRole('textbox')` (dialog найден через `getByRole('dialog')`, нативный `<dialog>` несёт implicit ARIA role). `npm run gate` (frontend) — 1112 passed (77 test files), tsc/eslint/lint-canon/schema-check/build/size-gate все зелёные (222.8 KB gzip, бюджет 300 KB).

После ревью (3 агента): Blind Hunter, Edge Case Hunter и Acceptance Auditor независимо сошлись на ОДНОМ реальном дефекте — при 403 на создание форма пряталась НАВСЕГДА (`{!isCreateForbidden && <form>}`, `addMutation.error` очищается только явным `reset()` или новым `mutate()`) — противоречило собственному Dev Notes-канону стори («форма остаётся видимой для повторной попытки»). Закрыто кнопкой «Повторить» → `addMutation.reset()`; проверено новым тестом (403 → «Повторить» → форма возвращается). Также приняты находки: журнал без автора/времени записи — пробел для «журнала штаба» (Blind Hunter) — добавлено отображение `created_by`/`created_at`; AC-4's тест не различал 403-ветку от generic-error-ветки (Acceptance Auditor) — добавлен тест на non-403 (500) → generic alert; 422 `INVALID_LIFECYCLE_TRANSITION` не был протестирован на API-уровне (Acceptance Auditor) — добавлен тест; порядок списка не был закреплён тестом с 3+ элементами (Blind Hunter, тот же класс, что project-memory `feedback_order_assert_needs_three_items.md`) — добавлен; только BRIEFING-дефолт проходил тест сабмита, DIRECTIVE — никогда — добавлен round-trip тест. Отклонены: `onFormError`/DRF-field-level-details канал — нет established-прецедента в этой feature-папке; `conflict`/`confirmOverride` — `create_journal_entry()` никогда не бросает `ConflictError`, находка неприменима; `ENTRY_TYPE_LABEL['INCIDENT']` — защитная запись, не мёртвый код; aria-live на статус-текстах — нет established-конвенции в кодовой базе. `npm run gate` (frontend) — 1117 passed (было 1112), build/size-gate чисты (222.9 KB gzip).

### File List

- `frontend/src/features/placement/api/queries.ts` (modified — `useJournalEntries`, `useAddJournalEntry`, `journalEntryKeys`)
- `frontend/src/features/placement/pages/JournalPanel.tsx` (new)
- `frontend/src/features/placement/pages/JournalPanel.test.tsx` (new — 6 тестов dev + 5 после ревью)
- `frontend/src/features/placement/pages/PlacementVersionDetailPage.tsx` (modified — подключение `JournalPanel`)
- `frontend/src/features/placement/pages/PlacementVersionDetailPage.test.tsx` (modified — 2 теста: `textbox` → `within(dialog)`, побочный фикс от неоднозначного запроса)
- `frontend/src/features/placement/mocks/fixtures.ts` (modified — `JOURNAL_ENTRIES`, `JournalEntryFixture`)
- `frontend/src/features/placement/mocks/handlers.ts` (modified — 2 новых обработчика)
- `frontend/src/shared/api/schema.d.ts` (regenerated — `npm run generate:api` от обновлённого `schema.yaml`, 17.7a/17.7b)

## Change Log

| Дата | Изменение |
|---|---|
| 2026-08-04 | Story создана (create-story). Research обнаружил: `features/security-events/` целиком mock (`backend-contract-pending`), точечная миграция журнала внутри неё сломала бы согласованность страницы — решение с Bratan: отдельная панель под `features/placement/` (уже реальная схема), не трогать mock-прототип. |
| 2026-08-04 | Dev-story: `JournalPanel` + хуки + mocks + 6 тестов. Побочный фикс: 2 теста `PlacementVersionDetailPage.test.tsx` (неоднозначный `textbox`-запрос). `npm run gate` — 1112 passed. Status → review. |
| 2026-08-04 | Review закрыт (3 агента, независимо совпали). Реальный дефект: 403-на-создание прятал форму навсегда, без пути к повтору — закрыт кнопкой «Повторить» + `reset()`. +5 тестов из находок (retry, branch-discrimination, 422-lifecycle, порядок 3+, DIRECTIVE round-trip) + отображение автора/времени записи. `npm run gate` — 1117 passed. Status → done. |
