---
baseline_commit: a4aca95
---

# Story 10.3b: Серверный drift-маркер на экране сдачи

Status: ready-for-dev

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

- [ ] Task 1 — Серверный drift-запрос внутри `DaySubmissionPanel` (`frontend/src/features/daily-grid/DaySubmissionPanel.tsx`, MOD) (AC: 1, 3, 5, 8)
  - [ ] `useQuery({ queryKey: ['division-traffic-light', divisionId, businessDate], queryFn: () => apiClient.get<TrafficLightDivisionResponse>(...), enabled: divisionId !== null && dateValid && current !== null })`. Тип ответа — из схемы: `components['schemas']['TrafficLightDivisionResponse']` (`../../shared/api/schema`), НЕ рукописное зеркало (ARCH-FE-011, схема для этого роута уже есть — 10.3c).
  - [ ] Путь query-строки собрать вручную (тот же паттерн, что `historyQuery` в этом же файле, — параметры роута в схему не эмитятся как отдельная форма, только как `parameters` OpenAPI, не как готовый URL-билдер).
- [ ] Task 2 — Резолюция ФИО без нового запроса (`DaySubmissionPanel.tsx`, MOD) (AC: 4)
  - [ ] Панель уже получает `nameById`? — ПРОВЕРИТЬ: сейчас `nameById` строится в `DailyUpdatePage.tsx` (для `localDrift`), панели НЕ передаётся. Добавить проп `nameById: Record<string, string>` (аддитивный, как `localDrift`) — переиспользовать ТОТ ЖЕ маппинг, не заводить второй.
  - [ ] Функция `resolveName(id, nameById): string` — `nameById[id] ?? \`${id} (нет в текущем составе)\`` .
- [ ] Task 3 — Рендер панели (`DaySubmissionPanel.tsx`, MOD) (AC: 2, 3, 6)
  - [ ] Блок ПОСЛЕ существующего `localDrift`-блока (не вместо): условие рендера — `serverDriftQuery.data?.status === 'YELLOW' && serverDriftQuery.data.drift !== null`.
  - [ ] Три под-списка (added/removed/changed), пустые опускаются (drift сервиса гарантирует непустое множество хотя бы в одном — но локально не полагаться на инвариант бэка молча: `.length > 0` перед рендером каждого под-списка).
  - [ ] Текст границы (AC-6) — дословно из AC.
- [ ] Task 4 — Проп `nameById` от `DailyUpdatePage` (`frontend/src/features/daily-grid/DailyUpdatePage.tsx`, MOD) (AC: 4)
  - [ ] Передать уже существующий `nameById` (объявлен для `localDrift`, см. Dev Notes) новым пропом в `<DaySubmissionPanel nameById={nameById} .../>`.
- [ ] Task 5 — MSW default-хендлер (`frontend/src/shared/api/testing/handlers.ts`, MOD) (AC: 7 — не даёт СУЩЕСТВУЮЩИМ тестам поймать незамоканный 404/hang)
  - [ ] `http.get('*/api/operations/traffic-light/division/', () => HttpResponse.json({status: 'GREEN', late: false, drift: null}))` — нейтральный дефолт (не показывает панель нигде, где тест явно её не настраивает).
- [ ] Task 6 — Тесты (`DaySubmissionPanel.test.tsx`, MOD) (AC: 1-6, 8)
  - [ ] AC-2: YELLOW-ответ с непустыми `added`/`removed`/`changed` → все три группы на экране, ФИО резолвятся из `nameById`.
  - [ ] AC-3: GREEN/RED-ответ → `queryByTestId('day-submission-server-drift')` отсутствует; то же для ответа-ошибки (403/404) и для `current === null` (день не сдан — запрос вообще не должен уйти, проверить через MSW-счётчик вызовов).
  - [ ] AC-4: `removed`-id ОТСУТСТВУЕТ в переданном `nameById` → строка есть, содержит id + пометку «нет в текущем составе» (не падает, не пропускает строку).
  - [ ] AC-6: обе панели (локальная + серверная) рендерятся ОДНОВРЕМЕННО при соответствующих пропах — красная проба на регрессию локальной (см. Dev Notes).
- [ ] Task 7 — Гейт (AC: 7)
  - [ ] `cd frontend && npm run gate`.

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

### File List
