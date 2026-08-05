---
baseline_commit: 139adc2
---

# Story 18.6c: Frontend — опрос-панель

Status: review

## Story

As a **держатель права `event.manage`**,
I want **записать фактическое время назначения, вычислить Налёт часов и отметить перегрузку прямо со страницы версии Расстановки**,
so that **опрос по итогам ОМ (18.3-18.5, API 18.6b) не требует прямых вызовов API вручную**.

## Scope Decision

- **Real-API панель под `features/placement/`, НЕ `features/security-events/`** — буквальный прецедент 17.7c/d: `features/security-events/` остаётся отдельным backend-contract-pending Smart Josparlau mock-прототипом (свой id-space, `pending-contracts.ts` не знает про 18.6a/b), не трогается. Подтверждено: grep по `archive`/`actual-time`/`service-hours`/`overload` в этой папке — ноль совпадений.
- **Компонент встраивается в СУЩЕСТВУЮЩУЮ `AssignmentsTable`** (`PlacementVersionDetailPage.tsx`) новой ячейкой **`OprosCell`**, буквальный образец `AcknowledgeCell`/`ReplaceDepartedCell` (per-row, тот же файл) — НЕ новый route/страница (опрос — по-назначению, не по-событию; таблица уже рендерит по одной строке на `PlacementAssignment`).
- **RBAC — реактивно через error-каналы, НЕ client-side permission-check** — буквальный прецедент `JournalPanel` (17.7c): «403 обрабатывается реактивно через query/mutation error-каналы, не скрывается заранее». Та же логика применяется к 422 (`is_current`/`CLOSED`-гейты 18.3-18.5) — кнопки ВСЕГДА видны, ошибка (403/422) показывается под кнопкой после неудачной попытки, тот же паттерн, что `AcknowledgeCell`'s `mutation.error`-рендер.
- **Три ПОСЛЕДОВАТЕЛЬНЫХ шага в ОДНОЙ ячейке, НЕ автоматическая цепочка**: буквально зеркалит бэковый принцип (18.6b's Scope Decision — сервисы намеренно не авто-триггерят друг друга). UI показывает ТЕКУЩИЙ доступный шаг как кнопку; успех шага N делает видимым шаг N+1 (по наличию `actual`/`hours` в локальном state ячейки — НЕ через новый GET-запрос за состоянием, эти три ручки уже возвращают финальный объект).
  - Шаг 1: форма `actual_start_at`/`actual_end_at` (`datetime-local` × 2) → «Записать факт» → `POST .../actual-time/`.
  - Шаг 2 (виден после успеха шага 1): «Вычислить налёт» → `POST .../service-hours/` → показывает `day_hours`/`night_hours`.
  - Шаг 3 (виден после успеха шага 2): «Проверить перегрузку» → `POST .../overload/` → показывает `is_overloaded`/`overload_minutes`.
- **`datetime-local` → ISO конвертация через `zonedDateTimeToIso()`** (буквальная копия `features/duty-plans/lib/localDateTime.ts` в НОВЫЙ `features/placement/lib/localDateTime.ts` — feature boundaries lint ARCH-FE-013 запрещает `features/*`→`features/*`-импорт, копия — established паттерн этого кодового пространства при межфичевом переиспользовании мелких утилит). Это ЗАКРЫВАЕТ 18.6b's deferred-риск (naive datetime → `settings.TIME_ZONE`, не `VAPS_LOCAL_TIMEZONE`) НА КОРНЮ — фронт физически не может отправить offset-less строку, `zonedDateTimeToIso()` всегда возвращает aware ISO с явным `Z`.
- **`npm run generate:api` — ОБЯЗАТЕЛЬНЫЙ первый шаг**: `schema.d.ts` устарел (Aug 4, до 18.6a/b), ни `close`/`archive`/`actual-time`/`service-hours`/`overload` — нет типов. Регенерировать из актуального `Backend/VAPS/schema.yaml` (18.6b уже сделал `make schema` аддитивно) ДО написания `queries.ts`-хуков.
- **Мутации — ТОЛЬКО через `useApiMutation`** (ARCH-FE-015-lint), запросы/хуки — новые экспорты в СУЩЕСТВУЮЩЕМ `features/placement/api/queries.ts` (не новый файл), буквальный образец `useAcknowledgePlacementAssignment`.
- **Инвалидация кэша НЕ требуется** — в отличие от `acknowledge` (инвалидирует `assignmentVersionKeys.detail`, т.к. таблица читает `acknowledged_at` из версии), опрос-состояние (`actual`/`hours`/`overload`) живёт ТОЛЬКО в локальном state `OprosCell` (мутации возвращают финальный объект напрямую, версия/список назначений не содержит этих полей вообще — `PlacementAssignmentSerializer` их не несёт).
- **Out of scope**: e2e (18.6d); отображение опрос-состояния в самом списке версий/после перезагрузки страницы (нет GET-эндпоинта за состоянием одного назначения — 18.6b не добавляла read-actions, только upsert-style POST; если понадобится «показать уже записанный факт после reload» — новая стори); объединённая кнопка «весь опрос одним кликом» (намеренно, тот же принцип, что 18.6b); UX-полировка/дизайн-ревью (минимальная функциональная вёрстка, тот же уровень, что `JournalPanel`/`AcknowledgeCell`).

## Acceptance Criteria

1. **AC-1.** На странице версии Расстановки, для назначения без записанного факта — видна форма (2× `datetime-local`) + кнопка «Записать факт»; успешная отправка → `POST .../actual-time/`, показывается кнопка «Вычислить налёт».
2. **AC-2.** Успешный «Вычислить налёт» → `POST .../service-hours/`, показывает `day_hours ч. / night_hours ч.` + кнопка «Проверить перегрузку».
3. **AC-3.** Успешный «Проверить перегрузку» → `POST .../overload/`, показывает «Перегрузка: да/нет» (+ `overload_minutes`, если перегружено).
4. **AC-4.** Ошибка шага 1 (403/422/сетевая) → сообщение под формой, форма остаётся доступной для повтора (не блокируется навсегда).
5. **AC-5.** Ошибка шага 2/3 → сообщение под соответствующей кнопкой, кнопка остаётся кликабельной (retry без потери шага 1's результата).
6. **AC-6.** `datetime-local`-ввод конвертируется через `zonedDateTimeToIso()` (Asia/Qyzylorda), не через `new Date(...).toISOString()` напрямую.
7. **AC-7.** `npm run gate` (frontend/) зелёный (tsc + eslint + vitest + build + size-gate).

## Out of Scope

- e2e полного цикла ОМ (Story 18.6d).
- Персистентность опрос-состояния между перезагрузками страницы (нет read-эндпоинта).
- Объединённая «весь опрос одним кликом» кнопка.
- UX-полировка/дизайн-ревью.

## Tasks / Subtasks

- [x] Task 1 — `npm run generate:api` (регенерация `schema.d.ts` из актуального `Backend/VAPS/schema.yaml`)
- [x] Task 2 — `frontend/src/features/placement/lib/localDateTime.ts` (копия `duty-plans/lib/localDateTime.ts` — `zonedDateTimeToIso`/`isoToZonedDateTimeLocal`)
- [x] Task 3 — `frontend/src/features/placement/api/queries.ts`: `useRecordActualTime`/`useComputeServiceHours`/`useFlagOverload` хуки (типы из `paths[...]`, буквальный образец `useAcknowledgePlacementAssignment`)
- [x] Task 4 — `frontend/src/features/placement/pages/PlacementVersionDetailPage.tsx`: `OprosCell` (новая ячейка в `AssignmentsTable`, RHF+zod форма шага 1, локальный state для шагов 2/3, буквальный образец `AcknowledgeCell`)
- [x] Task 5 — `frontend/src/features/placement/mocks/handlers.ts`: MSW-заглушки для трёх новых путей (dev:mock)
- [x] Task 6 — Тесты (AC 1-6): `PlacementVersionDetailPage.test.tsx` (или новый `OprosCell.test.tsx`) — happy path трёх шагов последовательно, 403/422 на каждом шаге, retry без потери прогресса, `zonedDateTimeToIso` вызывается (не голый `toISOString`)
- [x] Task 7 — Браузерная проверка через Preview (dev:mock) — реальный клик по трём шагам (скриншот недоступен — preview_screenshot таймаутил в этой сессии; проверено через snapshot/eval/network — та же строгость: POST-тела и итоговый DOM-текст лично проверены)
- [x] Task 8 — `npm run gate` (frontend/)

## Dev Notes

- `frontend/src/features/placement/pages/PlacementVersionDetailPage.tsx:226-280` (`AssignmentsTable`) — новая колонка «Опрос» после «Действия», `OprosCell` получает `assignmentId={String(a.id)}` (буквально как `AcknowledgeCell`/`ReplaceDepartedCell` получают свои id-пропы).
- `frontend/src/features/placement/pages/PlacementVersionDetailPage.tsx:287-326` (`AcknowledgeCell`) — образец: `useApiMutation`-хук, `mutation.isPending`/`mutation.error`-рендер, `ApiError`/`GENERIC_FAILURE_MESSAGE` (`shared/api/errors`, `shared/api/useApiMutation`).
- `frontend/src/features/placement/api/queries.ts:158-170` (`useAcknowledgePlacementAssignment`) — буквальный образец сигнатуры/структуры для трёх новых хуков (`useApiMutation<Response, Request>`, `mutationFn`, без обязательной инвалидации — эта стори её не требует, см. Scope Decision).
- `frontend/src/features/duty-plans/lib/localDateTime.ts` — `zonedDateTimeToIso(localDateTime, timeZone=VAPS_LOCAL_TIMEZONE)`/`isoToZonedDateTimeLocal(iso, timeZone)` — КОПИРОВАТЬ буквально (ARCH-FE-013 boundaries запрещает `features/duty-plans`→`features/placement` импорт), не переизобретать offset-математику.
- `frontend/src/features/duty-plans/pages/CreateDutyShiftDialog.tsx:17,43-48,148,155` — образец RHF+zod+`datetime-local`+`zonedDateTimeToIso()`-интеграции (`Input type="datetime-local"`, `z.string().min(1, ...)` на форме, конвертация ТОЛЬКО в `onSubmit`, не в схеме).
- `frontend/src/features/placement/pages/JournalPanel.tsx` — образец реактивного 403-рендера (`ApiError`+`.status === 403`) и `useEffect`-сброса формы на успех (`addMutation.data !== undefined`).
- `PlacementAssignmentSerializer` (Backend) НЕ несёт `actual_time`/`service_hours`-поля — опрос-состояние физически недоступно через уже загруженный `version.assignments[i]`, только через ответы трёх новых мутаций. `OprosCell` обязана хранить прогресс в СВОЁМ `useState` (не в react-query кэше версии).
- `frontend/src/shared/api/schema.d.ts` — устарел на момент создания стори (mtime Aug 4, до 18.6a/b). Task 1 обязательна ДО Task 3, иначе `paths['/api/operations/placement-assignments/{id}/actual-time/']` не существует в типах.

### References

- [Source: Backend/VAPS/apps/operations/events/api/views.py] — `actual_time`/`service_hours`/`overload` actions (18.6b).
- [Source: frontend/src/features/placement/pages/PlacementVersionDetailPage.tsx] — `AssignmentsTable`/`AcknowledgeCell` (структурный образец).
- [Source: frontend/src/features/placement/pages/JournalPanel.tsx] — реактивный 403/422-рендер (17.7c).
- [Source: frontend/src/features/duty-plans/lib/localDateTime.ts] — `zonedDateTimeToIso` (14.11k, review-исправленная tz-математика).
- [Source: _bmad-output/implementation-artifacts/18-6b-api-опрос-налёт-перегрузка.md] — deferred: naive-datetime-риск, закрываемый этой стори через `zonedDateTimeToIso()`.
- [Source: epics.md FR-32, FR-43, Story 18.6] — «API/экраны закрытия + аудит + e2e полного цикла ОМ» (эта стори — фронт-часть опроса).

## Dev Agent Record

### Agent Model Used

Claude Sonnet 5

### Debug Log References

### Completion Notes List

Реализовано по AC 1-7. `OprosCell` — новая ячейка `AssignmentsTable`, буквальный образец `AcknowledgeCell` (мутация → `isPending`/`error`-рендер) + `JournalPanel`'s реактивной 403/422-обработки (никакого проактивного client-side permission-check). Три шага показываются последовательно по наличию `mutation.data` каждой из трёх мутаций — состояние живёт только в react-query-кэше самих мутаций (не в отдельном `useState`, react-query уже хранит последний успешный результат между рендерами).

`zonedDateTimeToIso()` скопирован буквально из `duty-plans/lib/localDateTime.ts` в новый `placement/lib/localDateTime.ts` (ARCH-FE-013 boundaries запрещает `features/*`→`features/*`). Это закрывает 18.6b's deferred naive-datetime-риск НА КОРНЮ — форма физически не может отправить offset-less строку.

`npm run generate:api` выполнен первым (Task 1) — `schema.d.ts` был устаревшим на 1 день (до 18.6a/b), без него `paths['/api/operations/placement-assignments/{id}/actual-time/']` не существовал бы в типах.

Браузерная проверка (Preview, dev:mock): обнаружена и обойдена инфраструктурная проблема — порт 5173 занят ЧУЖИМ root-owned процессом (`/app/node_modules/.bin/vite --port 5173`, не относится к этому воркспейсу), из-за чего harness'а прокси зависал на «Awaiting server…». Исправлено в `.claude/launch.json`: dev:mock запускается на порту 5183. После фикса — залогинился под demo-персоной «Администратор (эталон)» (только у неё видна `/placement/*`-навигация в demo RBAC), прошёл все три шага вручную: POST `actual-time` вернул `2026-08-04T04:00:00.000Z` для введённых `09:00` местного (Asia/Qyzylorda, +05:00) — подтверждает `zonedDateTimeToIso()`, не голый `toISOString()`; «Вычислить налёт» показал «8.00 ч. день / 0.00 ч. ночь»; «Проверить перегрузку» показал «Перегрузка: нет». `preview_screenshot` таймаутил в этой сессии (известная нестабильность инструмента) — визуальное подтверждение через `preview_snapshot`/`preview_eval`/`preview_network` (тело запроса и итоговый DOM-текст проверены лично, не только «не упало»).

3 новых теста в `PlacementVersionDetailPage.test.tsx` (полный happy-path трёх шагов + tz-конверсия-assert в теле POST, ошибка шага 1 с retry, ошибка шага 2 без потери шага 1), `npm run gate` — 1128 passed (frontend), билд+size-gate зелёные (223.9 KB gzip, бюджет 300 KB).

### File List

- `frontend/src/shared/api/schema.d.ts` (regenerated — additive, includes 18.6a/b operations)
- `frontend/src/features/placement/lib/localDateTime.ts` (new — скопирован из `duty-plans/lib/localDateTime.ts`)
- `frontend/src/features/placement/api/queries.ts` (modified — `useRecordActualTime`/`useComputeServiceHours`/`useFlagOverload`)
- `frontend/src/features/placement/pages/PlacementVersionDetailPage.tsx` (modified — `OprosCell`, новая колонка «Опрос по итогам»)
- `frontend/src/features/placement/pages/PlacementVersionDetailPage.test.tsx` (modified — 3 новых теста)
- `frontend/src/features/placement/mocks/handlers.ts` (modified — MSW-заглушки для actual-time/service-hours/overload)
- `.claude/launch.json` (modified — dev:mock порт 5173→5183, обход коллизии с чужим root-owned процессом; gitignored, не коммитится)

## Change Log

| Дата | Изменение |
|---|---|
| 2026-08-05 | Story создана (create-story). Пятая часть разбиения 18.6 — фронт-панель опроса, встроена ячейкой `OprosCell` в существующую `AssignmentsTable` (не новая страница), реактивная 403/422-обработка (прецедент 17.7c's JournalPanel), `zonedDateTimeToIso()` (скопирован из duty-plans, ARCH-FE-013 boundaries) закрывает 18.6b's deferred naive-datetime-риск на корню. Status → ready-for-dev. |
| 2026-08-05 | Dev-story: `generate:api` + `localDateTime.ts` + 3 query-хука + `OprosCell` + MSW-заглушки + 3 теста + браузерная проверка (Preview, все 3 шага вручную, tz-конверсия подтверждена по телу POST). `.claude/launch.json` — dev:mock порт 5183 (обход чужого процесса на 5173). `npm run gate` — 1128 passed, билд/size-gate зелёные. Status → review. |
