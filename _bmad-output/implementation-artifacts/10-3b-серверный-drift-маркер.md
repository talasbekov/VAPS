---
baseline_commit: a4aca95
---

# Story 10.3b: Серверный drift-маркер на экране сдачи

Status: done

## Story

As a **оператор**,
I want **на экране сдачи дня (после того, как день сдан) видеть ПОЛНОЕ серверное расхождение подразделения (`{added, removed, changed}` из 5.5a), а не только правки, отправленные с этого экрана**,
so that **я узнаю о расходе, случившемся ЛЮБЫМ каналом (не только через этот браузер), не открывая отдельно дерево светофора**.

## Acceptance Criteria

Источник: `_bmad-output/implementation-artifacts/10-3-экран-сдачи-дня.md:39,72,182,303,312,318,421` — стори 10.3 сознательно ограничила свой drift-маркер ЛОКАЛЬНЫМ (правки, отправленные с этого экрана уже после сдачи), потому что серверный `division_traffic_light` (5.5a) не имел HTTP-роута. 10.3c (только что завершена) добавила роут `GET /api/operations/traffic-light/division/`. Эта стори — обещанный преемник («10.3b»), закрывающий класс расхождений целиком: окно гонки между 201 сдачи и рефетчем `daySubmission`, правки из ДРУГОГО браузера/канала, правки, отправленные не через грид вовсе.

1. **AC-1 (запрос серверного drift на сданном дне).** Given день сдан (`current !== null` в `DaySubmissionPanel`, то же условие, что уже держит существующий локальный drift и кнопку «Исправить сдачу»), When панель смонтирована, Then панель делает `GET /api/operations/traffic-light/division/?division_id=<D>&business_date=<дата>` (react-query, `enabled: divisionId !== null && dateValid && current !== null`).
2. **AC-2 (YELLOW → рендер серверной панели).** Given ответ `{status: "YELLOW", late, drift: {added, removed, changed}}`, Then рендерится ОТДЕЛЬНАЯ (не заменяющая локальную) панель с `data-testid="day-submission-server-drift"`, `role="alert"`, перечисляющая `added` (добавленные в состав), `removed` (выбывшие из состава) и `changed` (сменившие статус: было → стало) сотрудников.
3. **AC-3 (GREEN/RED/ошибка → тишина).** Given `status !== "YELLOW"` (т.е. `drift === null`) ИЛИ запрос ещё не завершился/упал (`isLoading`/`isError`), Then панели НЕТ в DOM — никакого «пустого блока» или скелетона (drift — necessary-only обогащение, не первичный сигнал экрана).
4. **AC-4 (резолюция ФИО — best-effort, без нового N+1).** Given `added`/`changed[].employee_id` есть в уже загрученном составе подразделения (`nameById`, тот же источник, что кормит локальный drift), Then печатается ФИО. Given id ОТСУТСТВУЕТ в `nameById` (типично для `removed` — сотрудник уже не в живом составе, который и есть источник `nameById`), Then печатается `id` с пометкой «нет в текущем составе» — НЕ скрывается строка и НЕ заводится второй сетевой запрос за именем.
5. **AC-5 (смена подразделения/даты не оставляет чужой drift).** Given раскладка `key={divisionId}-{businessDate}` на `DailyUpdatePage` уже ремаунтит `DaySubmissionPanel` при смене выбора (10.2/10.3 прецедент), Then запрос серверного drift пересоздаётся вместе с панелью — старое расхождение чужого дня/подразделения не может показаться поверх нового.
6. **AC-6 (граница текста — серверная панель ≠ локальная).** Текст серверной панели прямо называет её отличие от локальной: «Полное расхождение по данным сервера — включает правки из ЛЮБОГО источника, не только с этого экрана». Обе панели МОГУТ показаться одновременно (пересекающиеся множества — не баг: серверная включает локальную как подмножество).
7. **AC-7 (регресс нулевой).** Локальный drift-маркер (`localDrift`, 10.3 AC-10) — без изменений логики/текста/тестов. `DaySubmissionPanel`'s остальной рендер (сдача/amendment/версии) — без изменений. `npm run gate` зелёный.
8. **AC-8 (RBAC — доверие серверному гейту).** Экран НЕ дублирует permission-проверку перед вызовом роута (гейт `status.view` уже стоит на бэке, 10.3c AC-8) — 403 от роута попадает в `isError` и панель молчит (AC-3), как любая другая серверная ошибка обогащения.

## Tasks / Subtasks

- [x] Task 1 — Серверный drift-запрос внутри `DaySubmissionPanel` (`frontend/src/features/daily-grid/DaySubmissionPanel.tsx`, MOD) (AC: 1, 3, 5, 8)
  - [x] `useQuery({ queryKey: ['division-traffic-light', divisionId, businessDate], queryFn: () => apiClient.get<TrafficLightDivisionResponse>(...), enabled: divisionId !== null && dateValid && current !== null })`. Тип ответа — из схемы: `components['schemas']['TrafficLightDivisionResponse']` (`../../shared/api/schema`), НЕ рукописное зеркало (ARCH-FE-011, схема для этого роута уже есть — 10.3c).
  - [x] Путь query-строки собрать вручную (тот же паттерн, что `historyQuery` в этом же файле, — параметры роута в схему не эмитятся как отдельная форма, только как `parameters` OpenAPI, не как готовый URL-билдер).
- [x] Task 2 — Резолюция ФИО без нового запроса (`DaySubmissionPanel.tsx`, MOD) (AC: 4)
  - [x] Панель уже получает `nameById`? — ПРОВЕРИТЬ: сейчас `nameById` строится в `DailyUpdatePage.tsx` (для `localDrift`), панели НЕ передаётся. Добавить проп `nameById: Record<string, string>` (аддитивный, как `localDrift`) — переиспользовать ТОТ ЖЕ маппинг, не заводить второй.
  - [x] Функция `resolveName(id, nameById): string` — `nameById[id] ?? \`${id} (нет в текущем составе)\`` .
- [x] Task 3 — Рендер панели (`DaySubmissionPanel.tsx`, MOD) (AC: 2, 3, 6)
  - [x] Блок ПОСЛЕ существующего `localDrift`-блока (не вместо): условие рендера — `serverDriftQuery.data?.status === 'YELLOW' && serverDriftQuery.data.drift !== null`.
  - [x] Три под-списка (added/removed/changed), пустые опускаются (drift сервиса гарантирует непустое множество хотя бы в одном — но локально не полагаться на инвариант бэка молча: `.length > 0` перед рендером каждого под-списка).
  - [x] Текст границы (AC-6) — дословно из AC.
- [x] Task 4 — Проп `nameById` от `DailyUpdatePage` (`frontend/src/features/daily-grid/DailyUpdatePage.tsx`, MOD) (AC: 4)
  - [x] Передать уже существующий `nameById` (объявлен для `localDrift`, см. Dev Notes) новым пропом в `<DaySubmissionPanel nameById={nameById} .../>`.
- [x] Task 5 — MSW default-хендлер (`frontend/src/shared/api/testing/handlers.ts`, MOD) (AC: 7 — не даёт СУЩЕСТВУЮЩИМ тестам поймать незамоканный 404/hang)
  - [x] `http.get('*/api/operations/traffic-light/division/', () => HttpResponse.json({status: 'GREEN', late: false, drift: null}))` — нейтральный дефолт (не показывает панель нигде, где тест явно её не настраивает).
- [x] Task 6 — Тесты (`DaySubmissionPanel.test.tsx`, MOD) (AC: 1-6, 8)
  - [x] AC-2: YELLOW-ответ с непустыми `added`/`removed`/`changed` → все три группы на экране, ФИО резолвятся из `nameById`.
  - [x] AC-3: GREEN/RED-ответ → `queryByTestId('day-submission-server-drift')` отсутствует; то же для ответа-ошибки (403/404) и для `current === null` (день не сдан — запрос вообще не должен уйти, проверить через MSW-счётчик вызовов).
  - [x] AC-4: `removed`-id ОТСУТСТВУЕТ в переданном `nameById` → строка есть, содержит id + пометку «нет в текущем составе» (не падает, не пропускает строку).
  - [x] AC-6: обе панели (локальная + серверная) рендерятся ОДНОВРЕМЕННО при соответствующих пропах — красная проба на регрессию локальной (см. Dev Notes).
- [x] Task 7 — Гейт (AC: 7)
  - [x] `cd frontend && npm run gate`.

## Dev Notes

- **Прямой прецедент — локальный drift-блок в ТОМ ЖЕ файле.** Условие видимости (`current !== null`), стиль `data-testid`/`role="alert"`, текст-граница — копируются буквально по духу, не изобретаются заново. Серверный блок — СЛЕДУЮЩИЙ `{... ? <div> : null}` после локального, не замена.
- **`nameById` уже существует в `DailyUpdatePage.tsx`** (объявлен для `localDrift`, см. `DailyUpdatePage.tsx` — комментарий «Объявлено ДО мутации: её onSuccess читает ФИО для маркера drift (10.3)»). Эта стори добавляет ВТОРОГО потребителя того же маппинга через новый проп панели — не второй источник.
- **Backend-контракт (10.3c, только что смёрджена).** `GET /api/operations/traffic-light/division/?division_id=&business_date=` → `{status, late, drift}`; `drift` — `{added: [uuid], removed: [uuid], changed: [{employee_id, from, to}]}` или `null`. `null` для GREEN/RED — НЕ `{}`. `status` может быть только GREEN/YELLOW/RED для этого роута (NEUTRAL/UNKNOWN — cascade-only, здесь недостижимы, см. `views.py` description после ревью-фикса 10.3c).
- **Почему БЕЗ нового запроса за именами `removed`.** `removed` — сотрудник, которого больше НЕТ в живом составе (`/api/core/employees/`, тот же запрос, что кормит `nameById`) — по определению его там не найти. Заводить `GET /api/core/employees/{id}/` на каждый removed-id — N+1 ради текстовой метки; вместо этого честно печатаем id с пометкой (AC-4). Открытый вопрос для будущей стори: витрина уволенных/переведённых сотрудников с историческими именами (НЕ в этой стори — не блокирует AC).
- **Почему панель НЕ дублирует permission-гейт.** Роут уже несёт `status.view`-гейт (10.3c AC-8); тот же держатель, что видит сам экран сдачи (тот тоже требует прав на подразделение), в норме имеет и `status.view`. Дублирующая клиентская проверка добавила бы состояние без пользы — 403 просто гасится в `isError` (AC-3, AC-8), как любая другая серверная ошибка обогащения на этом экране (ср. `historyQuery` не имеет собственного alert на ошибку).
- **Красная проба обязательна на AC-6/AC-7 (урок ревью 10.2b/10.3).** Добавление второго условного блока в тот же компонент — классическое место для «дублирующего гарда, который перекрывает первый и оставляет тест старого блока зелёным несмотря на регрессию» (memory: `feedback_redundant_guards_vacuous_probe`). Тест «обе панели одновременно» — не опция, а обязательный AC-6-тест именно ПОТОМУ, что без него мутация, которая случайно связывает видимость одного блока с другим, останется незамеченной.

### References

- [Source: _bmad-output/implementation-artifacts/10-3-экран-сдачи-дня.md:14-21,545-570] — `DaySubmissionPanel`, локальный drift-блок (прямой прецедент кода/стиля/тестов).
- [Source: _bmad-output/implementation-artifacts/10-3c-роут-drift-подразделения.md] — контракт роута, только что смёрджен (`a4aca95`); `TrafficLightDivisionResponse`/`TrafficLightDrift`/`TrafficLightDriftChange` в `schema.d.ts`.
- [Source: Backend/VAPS/apps/operations/submissions/traffic_light.py:72-150] — `DivisionTrafficLight`/`division_traffic_light` (5.5a), семантика `_diff_winners` (added/removed/changed), предупреждение не путать с `_compute_event`.
- [Source: frontend/src/features/daily-grid/DailyUpdatePage.tsx] — `nameById`, `employeesQuery`, раскладка `key={divisionId}-{businessDate}` (ремаунт-сброс при смене выбора).
- [Source: frontend/src/features/traffic-light/trafficLight.ts:26-31] — `TrafficLightStatus` (переиспользовать ТИП через `schema.d.ts`, а не импортировать МОДУЛЬ — `features/daily-grid` → `features/traffic-light` запрещён ARCH-FE-013; `shared/api/schema` — не features, импортировать можно).

## Dev Agent Record

### Agent Model Used

claude-sonnet-5

### Debug Log References

### Completion Notes List

- Реализация целиком внутри `features/daily-grid` (`DaySubmissionPanel.tsx` + один аддитивный проп на `DailyUpdatePage.tsx`) — `nameById` уже существовал на экране для `localDrift`, переиспользован, второй источник ФИО не заведён. `features/traffic-light` не импортировался (ARCH-FE-013) — тип ответа взят напрямую из `shared/api/schema` (`TrafficLightDivisionResponse`), не из соседней фичи.
- Серверная панель — ОТДЕЛЬНЫЙ условный блок ПОСЛЕ существующего локального (`data-testid="day-submission-server-drift"` vs `day-submission-drift`), рендерится только на `status === 'YELLOW' && drift !== null`; GREEN/RED/loading/error — тишина (AC-3), без дублирующей клиентской permission-проверки (AC-8, 403 гасится как обычная ошибка обогащения).
- Резолюция ФИО — best-effort без нового сетевого запроса (AC-4): id отсутствует в `nameById` (типичный случай для `removed`, поскольку это множество по определению вне живого состава) → печатается `id (нет в текущем составе)`, строка не пропадает.
- Красная проба (AC-6, память `feedback_redundant_guards_vacuous_probe`): мутация `serverDrift !== null && localDrift.length === 0` покраснила тест «обе панели одновременно» — подтверждено, что тест ловит регрессию, а не вакуумен. Мутация отменена, тесты восстановлены зелёными.
- Тестов в стори — 6 изначальных (AC-1—AC-4, AC-6, AC-8), исправлено к 7 ревью-фиксом ниже (Completion Notes черновика ошибочно называли «7» до фикса — расхождение поймал Acceptance Auditor).

**Ревью (3-агентное: Blind Hunter / Edge Case Hunter / Acceptance Auditor) — 2 реальных бага, оба исправлены:**
1. **Устаревший кэш серверного drift после исправления сдачи (Blind Hunter, HIGH).** `amendMutation.onSuccess` инвалидировал `day-submission`/`division-submissions`, но НЕ `division-traffic-light` — панель могла показывать расхождение, которое исправление уже закрыло (или пропустить новое, внесённое амендментом). Исправлено: добавлена инвалидация `['division-traffic-light', divisionId, businessDate]` в `amendMutation.onSuccess`; та же инвалидация добавлена и в `mutation.onSuccess` (изначальная сдача) защитно — на случай гонки, хотя там баг менее вероятен (запрос до сдачи был `enabled: false`). Новый регресс-тест `«ревью-фикс: успешное исправление инвалидирует кэш...»` — красная проба подтвердила ловит.
2. **Пустая YELLOW-оболочка без содержимого (Edge Case Hunter, LOW).** Три под-списка (`added`/`removed`/`changed`) были каждый защищён `.length > 0`, но САМА панель — нет: гипотетический бэкенд-ответ `{status:'YELLOW', drift:{added:[],removed:[],changed:[]}}` (нарушающий собственный инвариант сервиса) рисовал бы alert без единой строки. Исправлено: `serverDrift` обнуляется, если сумма длин трёх групп равна 0 — панель целиком не рендерится на таком вырожденном ответе.
- Регресс: `npm run gate` — 881 тест (было 874 до стори, 880 после первичной реализации, 881 после ревью-фикса), tsc/eslint/build/size-gate (209.6 KB gzip / 300 бюджет) зелёные. Локальный drift-блок (10.3 AC-10) — код и тесты не тронуты.
- Бэкенд не затрагивался — стори чисто фронтовая (роут 10.3c уже существует и смёрджен).

### File List

- `frontend/src/features/daily-grid/DaySubmissionPanel.tsx` (MOD) — серверный drift-запрос + рендер, `resolveName`, инвалидация кэша на submit/amend (ревью-фикс), guard всей панели на all-empty drift (ревью-фикс).
- `frontend/src/features/daily-grid/DailyUpdatePage.tsx` (MOD) — проп `nameById` в `<DaySubmissionPanel>`.
- `frontend/src/shared/api/testing/handlers.ts` (MOD) — дефолт-хендлер + фикстура роута 10.3c.
- `frontend/src/features/daily-grid/DaySubmissionPanel.test.tsx` (MOD) — 7 новых тестов (AC-1—AC-4, AC-6, AC-8 + регресс-тест на ревью-фикс №1) + `nameById` в существующих литералах пропов.
