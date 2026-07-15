---
baseline_commit: |
  3a1a5c1 (feat(story-9.6)) на ветке claude/exciting-vaughan-3e478b. Грид 9.4 +
  фокус 9.5 + валидация 9.6 готовы (DailyGrid: rows/onSubmit(deltas)/onCellCommit).
  9.7 — данные: prefill «вчера» + маппинг дельт в bulk-3.8.
context:
  - _bmad-output/planning-artifacts/epics.md (§Story 9.7: «загрузка вчерашнего состояния как дефолта и ввод только отклонений со счётчиком изменённых … открытие формы на сегодня → строки заполнены вчерашними значениями; счётчик отклонений обновляется; отправляются ТОЛЬКО отклонения (bulk-контракт 3.8)»)
  - docs/contracts/09-01-*.md (§2 «Преднабор: вчерашняя расстановка как дефолт, правятся только отклонения, счётчик изменено N из M»; §7 автосейв vs «Сдать день» — Open Question)
  - frontend/src/features/daily-grid/DailyGrid.tsx (9.4/9.6 — rows: EmployeeRow[]; onSubmit(changes: RowChange[]) уже отдаёт ТОЛЬКО дельты; счётчик «изменено N из M» уже есть; onCellCommit-seam для 409/422→маркеры 9.6)
  - Backend/VAPS/apps/operations/statuses (3.8 bulk_create_statuses — сервис массового обновления; HTTP-роут bulk = 10.2/E10, в схеме пока НЕТ → фронт-контракт bulk-запроса + submit-проп, реальный вызов = E10)
  - _bmad-output/planning-artifacts/architecture.md (ARCH-FE-010 данные=TanStack Query; ARCH-FE-013 feature-folders; L246 RHF/zod)
---

# Story 9.7: Prefill и отклонения

Status: done

## Story

As a **оператор**,
I want **предзаполнение грида вчерашней расстановкой (дефолт), правку ТОЛЬКО отклонений со счётчиком изменённых, и отправку ТОЛЬКО дельт в формате bulk-контракта 3.8**,
so that **ежедневный утренний ритуал — минимальный ввод; в бэкенд уходят только реально изменённые статусы**.

## Scope

Prefill-маппер (вчера→дефолт-строки) + bulk-маппер (дельты→bulk-3.8-запрос) + контейнер `DailyGridContainer` (prefill → DailyGrid → onSubmit(deltas) → bulk-маппер → submit-проп). Данные приходят props (реальные query/эндпоинт = E10). Счётчик отклонений — уже в 9.4.

## Out of Scope

- **Реальный HTTP bulk-эндпоинт + query-хук загрузки вчера** → 10.2/E10 (bulk-роут 3.8 в схеме нет; 9.7 = чистые мапперы + контейнер + submit-проп-контракт).
- Фильтр «только отклонения» — nice-to-have EXPERIENCE, вне epic-AC (E10). e2e → 9.9; экран/роут/сеть → 10.2. grammar.ts/перф/фокус (9.2/9.4/9.5) не менять.

## Acceptance Criteria

1. **Prefill из «вчера».** Given список сотрудников + вчерашняя расстановка (`employee_id → {statusCode, period}`), Then `buildPrefilledRows` строит `EmployeeRow[]` со `statusCode`/`period` из ВЧЕРА (сотрудник без вчерашней записи → дефолт, напр. IN_SERVICE). Чистая функция.

2. **Счётчик отклонений от prefill.** Given грид открыт с prefill-строками, Then счётчик «изменено 0 из M» (ничего не правлено); правка ячейки → счётчик растёт (базовая линия = prefill-значения). (Механизм в 9.4 — 9.7 подтверждает базу.)

3. **Bulk-маппер дельт.** Given изменённые строки (`RowChange[]` из onSubmit), Then `toBulkRequest(changes, businessDate)` даёт bulk-3.8-запрос `{business_date, rows: [{employee_id, status_type_code, date_end?}]}` РОВНО из дельт (неизменённые НЕ включаются). Чистая функция. _(Ревью D1: shape выровнен с реальным сервисом 3.8 — `date_start`/`date_end` обязательны в каждой строке; `date_start = businessDate`; полуинтервал `[s, e)`: период «по … включительно» → `date_end = period+1д`, пусто → `businessDate+1д`.)_

4. **Контейнер связывает prefill + submit.** Given `DailyGridContainer` (props: `employees`, `yesterday`, `businessDate`, `onBulkSubmit(request)`), Then он строит prefill-строки, рендерит `DailyGrid`, а `onSubmit(deltas)` → `toBulkRequest` → `onBulkSubmit`. Ответ 409/422 (per-row) маппится обратно в маркеры через `onCellCommit`-seam (9.6) — контракт для E10.

5. **Гейт, границы, регресс.** `npm run gate` зелёный. grammar.ts (9.2) не тронут; перф (9.4)/фокус (9.5)/валидация (9.6) без регресса (их тесты зелёные). ARCH-FE (boundaries/lint-canon/hooks) чисты. Реальный эндпоинт/сеть — не в 9.7 (submit-проп).

## Tasks / Subtasks

- [x] Task 1: Типы данных prefill/bulk (AC: 1, 3, 4)
  - [x] `prefill.ts` (feature daily-grid): `YesterdayPlacement = Record<employeeId, {statusCode, period?}>`; `EmployeeSeed` (id/fullName/rank?); `BulkStatusRequest = {business_date: string; rows: {employee_id, status_type_code, date_start, date_end}[]}` (D1); `DailyGridContainerProps` — по факту объявлен в `DailyGridContainer.tsx` рядом с компонентом, не в prefill.ts (ревью P8: размещение разумнее буквы сабтаска).
- [x] Task 2: Чистые мапперы (AC: 1, 3)
  - [x] `buildPrefilledRows(employees, yesterday, defaultStatus="IN_SERVICE") → EmployeeRow[]`; `toBulkRequest(changes, businessDate) → BulkStatusRequest` (period → date_end если непусто).
- [x] Task 3: Контейнер (AC: 2, 4)
  - [x] `DailyGridContainer.tsx`: `rows = useMemo(buildPrefilledRows(...))`; `<DailyGrid rows={rows} onSubmit={(d) => onBulkSubmit(toBulkRequest(d, businessDate))} onCellCommit={...} />`. onCellCommit проброшен из props (E10 подключит реальный 409/422-маппинг).
- [x] Task 4: Тесты (AC: 1-4)
  - [x] `prefill.test.ts` (чистые): prefill из вчера (+дефолт для новых); bulk-маппер только дельты + date_end. `DailyGridContainer.test.tsx` (jsdom): открытие → счётчик «0 из M»; правка → счётчик растёт; «Сдать день» → onBulkSubmit получает bulk-запрос ТОЛЬКО с дельтами.
- [x] Task 5: Гейт + регресс (AC: 5)
  - [x] `npm run gate` зелёный; перф/фокус/валидация-тесты зелёные; grammar.ts не тронут; prettier.

### Review Findings

Проход 1 (bmad-code-review, **CROSS-MODEL**: Fable 5 ×3 слоя vs спека+dev Opus 4.8; дифф = коммит `6ba1021` + правка prefill.ts из 1d858e5, аудит против HEAD). 2 decision РЕШЕНЫ Bratan · 9 patch ПРИМЕНЕНЫ · 4 defer · 3 dismiss. Гейт после правок: 232 зелёных (+7).

- [x] [Review][Decision] **D1: фронт-контракт «bulk-3.8-shape» гарантированно отвергается сервисом 3.8** — `_REQUIRED_ROW_KEYS = (employee_id, status_type_code, date_start, date_end)`: строка без ЛЮБОГО ключа → 400 на весь payload (bulk_status_service.py:44,91). `toBulkRequest` не эмитит `date_start` никогда, `date_end` — только при непустом period → каждый запрос маппера заведомо 400. Плюс семантика: бэк — полуинтервал `[s, e)`, date_end=None невозможен (`_validate_interval`: `date_start >= date_end` → TypeError), день = `[D, D+1)`; а UI-период «по … включительно» → date_end = period+1день. Q1 спеки откладывал сверку «при появлении роута», но сервис-shape знаем уже сейчас. **РЕШЕНИЕ Bratan: выровнять сейчас** — применено (date_start=businessDate; date_end=period+1д | businessDate+1д, ключи всегда; UTC-математика; не-ISO мусор — как есть, громкий 422).
- [x] [Review][Decision] **D2: отклонение «вернулся в строй» невыразимо в bulk-3.8** — bulk только СОЗДАЁТ deviation-записи; IN_SERVICE есть в StatusType (999), но USER-запись IN_SERVICE поверх ещё живого вчерашнего статуса (напр. VACATION по 20-е) даст 409/422, а сервис атомарен — один вернувшийся блокирует сдачу ВСЕГО дня. Правильный механизм — закрытие/снятие вчерашнего статуса, которого в 3.8 нет. **РЕШЕНИЕ Bratan: слать как есть** — громкий отказ вместо тихой потери; требование механизма снятия/закрытия статуса зафиксировано как обязательный вход спеки 10.2 (deferred-work.md).
- [x] [Review][Patch] P1: осиротевший `period` при пустом вчерашнем `statusCode` — статус лёг в дефолт, а его period выжил и уедет как date_end уже с другим статусом [prefill.ts:48]
- [x] [Review][Patch] P2: «Сдать день» без правок → `onBulkSubmit({rows: []})` → бэк 400 «Пустой payload»; гейт `changes.length === 0` в контейнере + тест [DailyGridContainer.tsx:45]
- [x] [Review][Patch] P3: дубли `id` в `employees` → две строки грида с одним id → дубль в `changed` → бэк 400 (AC-3) на весь день; дедуп (первый выигрывает) в buildPrefilledRows + тест [prefill.ts:38]
- [x] [Review][Patch] P4: самоисцеление входа: `employees`/`yesterday` = null/undefined из рантайма → TypeError в useMemo, падение страницы (прецедент 9.2/9.4) [prefill.ts:38]
- [x] [Review][Patch] P5: `period.trim()` в toBulkRequest — whitespace-only period сейчас truthy и эмитит мусорный date_end [prefill.ts:63]
- [x] [Review][Patch] P6: смена `businessDate` при живых правках — правки переживают RESYNC и уходят с НОВЫМ business_date; `key={businessDate}` (правки принадлежат дню) + тест [DailyGridContainer.tsx:42]
- [x] [Review][Patch] P7: тесты-усиления: откат правки → счётчик обратно «0 из 3» и строки нет в bulk; позиционная привязка «В отпуске» к строке e0 (прецедент 9.5); restore стабов offsetHeight/Width в afterAll; toHaveBeenCalledTimes(1); кейс `statusCode: ''` + period (защищает ||-фикс 9.6) [DailyGridContainer.test.tsx, prefill.test.ts]
- [x] [Review][Patch] P8: чекбокс-дрейф Task 1 — `DailyGridContainerProps` заявлен в prefill.ts, объявлен в DailyGridContainer.tsx (размещение по факту разумнее — поправить текст сабтаска) [спека Task 1]
- [x] [Review][Patch] P9: тип `onBulkSubmit` → `void | Promise<void>` (Д4 спеки говорит void|Promise) + JSDoc-требование стабильности ссылок employees/yesterday + useCallback на onSubmit-лямбду [DailyGridContainer.tsx:22,45]
- [x] [Review][Defer] AC4-seam непригоден по направлению данных для маппинга bulk-ответа: `onCellCommit` зовётся гридом синхронно в момент коммита, а per-row ошибки (`detail.rows[]`) приходят ПОСЛЕ onBulkSubmit; каналов «ответ → setMarkers» нет — расширение дважды деферённой темы seam (9.5/9.6) → вход спеки 10.2 [DailyGridContainer.tsx:24] — deferred
- [x] [Review][Defer] полная валидация формата period (свободный текст → мусорный date_end; одна строка атомарно валит весь bulk) → E10, реальный date-редактор (решение 9.6) [prefill.ts:63] — deferred
- [x] [Review][Defer] pending/двойной клик «Сдать день»/ошибки bulk-уровня — fire-and-forget onBulkSubmit → транспорт/экран 10.2 [DailyGridContainer.tsx:22] — deferred
- [x] [Review][Defer] `businessDate === ''` проходит в business_date запроса — источник даты = E10 [DailyGridContainer.tsx:19] — deferred

## Dev Notes

### ⚠️ Ловушка №1 (ГЛАВНАЯ): дельты УЖЕ есть — 9.7 = prefill + bulk-shape

`DailyGrid.onSubmit(changes)` (9.4) уже отдаёт ТОЛЬКО изменённые строки, счётчик «изменено N из M» уже считает от `initials`. 9.7 не переизобретает — добавляет (а) prefill: базовая линия = вчерашние значения (строятся `buildPrefilledRows`, попадают в `rows.statusCode`), (б) маппинг дельт в bulk-3.8-shape, (в) контейнер. Базовая линия счётчика = prefill-значения (initials грида).

### ⚠️ Ловушка №2: bulk-роут в схеме НЕТ — контракт, не живой вызов

3.8 `bulk_create_statuses` — сервис без HTTP-роута (в schema.d.ts нет). 9.7 определяет `BulkStatusRequest` как ФРОНТ-КОНТРАКТ и вызывает `onBulkSubmit`-проп (не fetch). Реальный эндпоинт + типизация из схемы + query-загрузка вчера = 10.2/E10 (сверить shape с бэком при появлении роута). НЕ хардкодить fetch/URL (ARCH-FE-015 транспорт — apiClient, эндпоинта нет).

### ⚠️ Ловушка №3: чистые мапперы — тестируемы без React

`buildPrefilledRows`/`toBulkRequest` — чистые (без React/DOM), тест в node. Контейнер тонкий: prefill(useMemo) + DailyGrid + onSubmit→bulk→проп. 409/422-ответ→маркеры уже умеет 9.6 (`onCellCommit`); контейнер пробрасывает seam (E10 подключит реальный per-row-маппинг ответа).

### ⚠️ Ловушка №4: не сломать 9.4/9.5/9.6

Контейнер оборачивает DailyGrid, не меняя его. Перф (1 commit), фокус, маркеры — их тесты в гейте, обязаны остаться зелёными.

### Дефолты (#YOLO)

- **Д1 (дефолт-статус):** сотрудник без вчерашней записи → `IN_SERVICE` (derived «В строю»).
- **Д2 (period→date_end):** ~~непустой `period` строки → `date_end` в bulk-row; пустой → опустить~~ **ПЕРЕРЕШЕНО ревью D1:** ключи `date_start`/`date_end` всегда присутствуют (требование `_REQUIRED_ROW_KEYS` сервиса 3.8); период «включительно» → `date_end = period+1д`, пустой → `businessDate+1д` (день `[D, D+1)`).
- **Д3 (фильтр «только отклонения»):** НЕ в 9.7 (nice-to-have EXPERIENCE → E10).
- **Д4 (submit-проп):** `onBulkSubmit(request): void|Promise` — реальный вызов (apiClient+эндпоинт) в 10.2.

### Границы (что 9.7 НЕ делает)

- Реальный bulk-эндпоинт/fetch/query-хук/роут/экран (10.2/E10); фильтр отклонений (E10); e2e (9.9); автосейв (Open Question §7). grammar.ts/перф/фокус/валидация не менять.

### References

- [Source: epics.md §Story 9.7 (prefill вчера, счётчик, только дельты bulk-3.8)]
- [Source: docs/contracts/09-01-*.md §2 (преднабор/счётчик), §7 (автосейв Open Q)]
- [Source: frontend/src/features/daily-grid/DailyGrid.tsx (onSubmit(deltas)/счётчик/onCellCommit 9.4-9.6); Backend/VAPS/apps/operations/statuses (3.8 bulk сервис, роут=E10); ARCH-FE-010/013]

### Открытые вопросы (для Bratan — дефолты активны)

- **Q1 (bulk-shape):** ЗАКРЫТ ревью D1 в части rows-shape (выровнен с сервисом: date_start/date_end обязательны). Остаток на 10.2: division_id/actor в теле или из auth-контекста; типизация из schema.d.ts при появлении роута.
- **Q2 (дефолт-статус):** сотрудник без вчера → IN_SERVICE [Д1] или пусто (обязательный ввод)? Смежное решение D2 ревью: дельта «вернулся в строй» уходит в bulk как есть (громкий 409/422); механизм снятия статуса — обязательный вход спеки 10.2.

### Процессный гейт

- `npm run gate` (frontend); мапперы — node-тесты; контейнер — jsdom. Ревью — по epic-AC + регресс 9.4-9.6.

## Dev Agent Record

### Agent Model Used

claude-opus-4-8 (Opus 4.8) — create-story + dev-story (TDD)

### Debug Log References

- **npm run gate зелёный:** tsc strict, eslint/boundaries/lint-canon, vitest (5 prefill/container + 5 valid + 10 focus + 5 grid = все без регресса), build, size 150.4 КБ/300.
- tsc-фикс: неиспользуемый `describe` в container-тесте (тесты на верхнем уровне) убран.

### Completion Notes List

- **Task 1-2 (типы+мапперы) — DONE.** `prefill.ts`: `EmployeeSeed`/`YesterdayPlacement`/`BulkStatusRequest` (фронт-контракт) + чистые `buildPrefilledRows(employees, yesterday, default=IN_SERVICE)` (вчера→statusCode/period, без вчера→дефолт) + `toBulkRequest(changes, businessDate)` (только дельты; period→date_end, пустой опущен).
- **Task 3 (контейнер) — DONE.** `DailyGridContainer.tsx`: `rows=useMemo(buildPrefilledRows)`, рендерит DailyGrid, `onSubmit(changes)→onBulkSubmit(toBulkRequest(changes, businessDate))`, пробрасывает `onCellCommit`-seam (9.6). Тонкий — DailyGrid не менялся.
- **Task 4-5 (тесты+гейт) — DONE.** `prefill.test.ts` (node, 3): prefill+дефолт, bulk только-дельты+date_end, пустой. `DailyGridContainer.test.tsx` (jsdom+userEvent, 2): prefill-строки+счётчик «0 из 3»+вчерашний статус; правка→«1 из 3»→«Сдать день»→onBulkSubmit ТОЛЬКО с изменённой строкой в bulk-shape. Гейт зелёный; перф/фокус/валидация без регресса; grammar.ts не тронут.
- **Границы:** реальный bulk-эндпоинт/fetch/query-загрузка вчера/роут/экран = 10.2/E10 (BulkStatusRequest = фронт-контракт, submit-проп); фильтр отклонений = E10 (Д3); e2e=9.9; автосейв=Open Q.
- **Осталось:** Q1 (bulk-shape сверить с бэк-3.8 при HTTP-роуте 10.2)/Q2 (дефолт-статус) — дефолты.

### File List

- `frontend/src/features/daily-grid/prefill.ts` (создан — buildPrefilledRows + toBulkRequest + типы)
- `frontend/src/features/daily-grid/DailyGridContainer.tsx` (создан — prefill→DailyGrid→bulk-submit)
- `frontend/src/features/daily-grid/prefill.test.ts` (создан — 3 node-теста мапперов)
- `frontend/src/features/daily-grid/DailyGridContainer.test.tsx` (создан — 2 jsdom-теста)
