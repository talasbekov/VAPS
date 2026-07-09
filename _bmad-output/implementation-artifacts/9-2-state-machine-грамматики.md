---
baseline_commit: |
  37035ff (docs(story-9.1)) на ветке claude/exciting-vaughan-3e478b. E1–E6, E8 done;
  E9 in-progress (9.1 контракт → review). 9.2 — ПЕРВЫЙ реальный фронт-код E9.
context:
  - _bmad-output/planning-artifacts/epics.md (§Story 9.2 стр. 1077: «чистый модуль (key, cellState, position) → (action, nextPosition) без React … грамматика тестируется без браузера; exhaustive-таблица переходов из контракта 9.1; каждый переход покрыт; модуль не импортирует React». §Story 9.3 стр. 1085 — fast-check property (ОТДЕЛЬНАЯ стори; 9.2 = только exhaustive unit).)
  - docs/contracts/09-01-экран-1-массовый-грид.md (§3 ГРАММАТИКА — ИСТОЧНИК ИСТИНЫ: §3.1 состояния NAVIGATE/EDIT/PERIOD_EDIT/CONFLICT; §3.2 ПОЛНАЯ таблица переходов состояние×клавиша→эффект; §3.3 три инварианта — фокус в границах / нажатия не теряются / Esc→pre-edit; §4 ячейка-статус; §5 конфликты 409/422)
  - _bmad-output/planning-artifacts/architecture.md (L253 «грамматика (Enter↓/Tab→/Esc-отмена/слепой ввод) = ЧИСТАЯ state machine без React; тесты: exhaustive-таблица переходов + property-based (fast-check): фокус всегда в границах, нажатия не теряются, Esc возвращает pre-edit»; ARCH-FE-013 L240 feature-folders app/features/shared, features↛features, shared↛features, barrel-index ЗАПРЕЩЁН; ARCH-FE-010 L237 стейт-канон)
  - Backend/VAPS/../frontend (E8-каркас: Vite+React19+TS, feature-folders src/{app,features,shared}; тест-стек Vitest 4 + RTL + MSW + jsdom; `npm run gate` = deps-gate+schema-check+tsc(strict)+eslint+lint-canon+vitest+build+size-gate; eslint-plugin-boundaries; fast-check в deps НЕТ — вводится в 9.3; features: auth, print-forms; daily-grid-фичи ещё НЕТ — 9.2 её заводит)
---

# Story 9.2: State machine грамматики

Status: review

## Story

As a **разработчик**,
I want **чистый TypeScript-модуль клавиатурной грамматики грида — переход `(key, cellState, position, bounds) → (action, nextState, nextPosition)` БЕЗ импорта React/DOM — реализующий таблицу переходов из бумажного контракта 9.1, покрытый exhaustive-таблицей юнит-тестов (Vitest)**,
so that **грамматика слепого ввода тестируется без браузера, а грид (9.4) и фокус-слой (9.5) лишь подключают готовую детерминированную машину; property-based свойства — отдельная стори 9.3**.

## Scope

Один чистый модуль (+ типы) + exhaustive unit-тесты, реализующий §3 контракта 9.1. НЕ React, НЕ DOM, НЕ грид.

## Out of Scope

- **fast-check property-тесты** (3 инварианта на произвольных последовательностях) → 9.3.
- **Грид-компонент** (TanStack Table+Virtual, рендер, автосейв) → 9.4; **фокус-слой** (реальный DOM-фокус/скролл) → 9.5; **валидация/конфликты в гриде** → 9.6; **prefill** → 9.7.
- **API/сеть, стили, любой React-компонент.**

## Acceptance Criteria

1. **Чистый модуль без React/DOM.** Given `src/features/daily-grid/grammar.ts` (+ `grammar.types.ts`), Then он экспортирует чистую функцию `transition(input) → result` и НЕ импортирует `react`/`react-dom`/DOM-глобалы (`document`/`window`); детерминирован (тот же вход → тот же выход), без сайд-эффектов. `tsc -b` (strict) зелёный.

2. **Модель типов из контракта.** Then типы отражают §3.1 контракта: `CellState = "NAVIGATE" | "EDIT" | "PERIOD_EDIT" | "CONFLICT"`; `Key` (дискриминированный: `Enter`/`Tab`/`ShiftTab`/`Esc`/`ArrowUp`/`ArrowDown`/`ArrowLeft`/`ArrowRight`/`Char`{char}); `Position = {row, col}`; `Bounds = {rows, cols}`; `Action` (union: `OPEN_EDIT`/`TYPE_AHEAD`/`CONFIRM_DOWN`/`CONFIRM_RIGHT`/`RESTORE_PRE_EDIT`/`MOVE`/`OPEN_PERIOD`/`OVERRIDE_RETRY`/`CLOSE_DIALOG`/`NOOP`). `transition({state, position, bounds, key}) → {action, nextState, nextPosition}`.

3. **Таблица переходов покрыта ИСЧЕРПЫВАЮЩЕ.** Given таблица §3.2 контракта 9.1, Then `grammar.test.ts` (Vitest) содержит кейс на КАЖДУЮ пару (состояние × класс клавиши), ассертящий `action`+`nextState`+`nextPosition`. Ключевые переходы (дословно из контракта): `NAVIGATE`+`Enter`→`OPEN_EDIT`/`EDIT`; `NAVIGATE`+`Char`→`TYPE_AHEAD`(seed)/`EDIT`; `NAVIGATE`+`Tab|Arrow`→`MOVE` в границах; `EDIT`+`Enter`→`CONFIRM_DOWN` + фокус ↓ / `NAVIGATE`; `EDIT`+`Tab`→`CONFIRM_RIGHT`/след.колонка; `EDIT`+`Esc`→`RESTORE_PRE_EDIT`/`NAVIGATE`; `PERIOD_EDIT`+`Enter/Esc`; `CONFLICT`+override/esc→фокус в исходную ячейку. Непокрытая пара = красный тест (guard-мета: перечислить все состояния×классы и проверить наличие кейса).

4. **Инвариант границ (детерминированно, здесь — не property).** Then при любом `MOVE`-переходе `nextPosition` КЛАМПИТСЯ в `bounds` (0 ≤ row < rows, 0 ≤ col < cols); выход за границу → остаётся на месте (не теряется, не выпадает). Юнит-кейсы на всех 4 краях. (Свойство «на произвольных последовательностях» — 9.3.)

5. **Esc→pre-edit — грамматический контракт.** Then `Esc` в `EDIT`/`PERIOD_EDIT` даёт `action=RESTORE_PRE_EDIT` (грид применит восстановление pre-edit значения — 9.4); модуль сам значений ячеек НЕ хранит (чистая машина позиций/состояний). Юнит-кейс.

6. **Гейт зелёный, границы.** `npm run gate` зелёный (tsc strict + eslint boundaries + vitest + build + size). Модуль в `src/features/daily-grid/` (новая фича); **без barrel `index.ts`** (ARCH-FE-013) — импорт файла напрямую. Тест `grammar.test.ts` — чистый (node-окружение, БЕЗ jsdom/RTL — модуль не трогает DOM). НЕ вводить fast-check (это 9.3). Границы feature-folders соблюдены (daily-grid ничего не импортирует из других features).

## Tasks / Subtasks

- [x] Task 1: Типы (AC: 1, 2)
  - [x] `src/features/daily-grid/grammar.types.ts`: `CellState`, `Key` (discriminated union, `Char` несёт `char`), `Position`, `Bounds`, `Action`, `TransitionInput`, `TransitionResult`. Экспорт типов; ноль рантайм-кода.
- [x] Task 2: Чистая машина (AC: 1, 2, 4, 5)
  - [x] `src/features/daily-grid/grammar.ts`: `export function transition(input: TransitionInput): TransitionResult`. `switch` по `state`, внутри — по `key`. Клампинг позиции в `bounds` хелпером `clamp`. Ноль импортов react/dom. Чистая, детерминированная.
- [x] Task 3: Exhaustive unit-тесты (AC: 3, 4, 5)
  - [x] `src/features/daily-grid/grammar.test.ts` (Vitest, node-env): по кейсу на каждую (state × key-класс) из §3.2; краевые MOVE-кейсы (4 края); Esc→RESTORE_PRE_EDIT; type-ahead seed. Guard-тест «полнота»: перечислить произведение состояний×классов и утвердить, что каждый обработан (нет `NOOP`-дыр там, где контракт задаёт эффект).
  - [x] Мини-док-комментарий в тесте: ссылка на §3.2 контракта 9.1 (источник истины таблицы).
- [x] Task 4: Гейт + границы (AC: 6)
  - [x] `npm run gate` зелёный; проверить eslint-boundaries (daily-grid не тянет из features/*); отсутствие `react`-импорта (grep/лёгкий тест). `prettier --write` по новым файлам.

## Dev Notes

### ⚠️ Ловушка №1 (ГЛАВНАЯ): источник истины таблицы — контракт 9.1, не выдумка

`docs/contracts/09-01-экран-1-массовый-грид.md` §3.2 — ПОЛНАЯ таблица переходов (состояние×клавиша→эффект) и §3.3 — три инварианта. 9.2 реализует ИМЕННО её, кейс-в-кейс. Любое расхождение реализации с контрактом = баг реализации (контракт заморожен на согласование). Если в ходе реализации найдётся дыра/неоднозначность в контракте — не «додумывать» в коде, а поднять вопрос (контракт правится, потом код).

### ⚠️ Ловушка №2: чистота — БЕЗ React/DOM (граница с 9.4/9.5)

architecture.md L253: «чистая state machine без React». Модуль не импортирует `react`/`react-dom`, не трогает `document`/`window`, не хранит значения ячеек и не двигает реальный фокус — только вычисляет `(action, nextState, nextPosition)`. Реальный DOM-фокус/скролл = 9.5; рендер/автосейв = 9.4; восстановление pre-edit значения (по `RESTORE_PRE_EDIT`) применяет грид. Это делает грамматику тестируемой в node без jsdom и открывает 9.3 (fast-check без рендера).

### ⚠️ Ловушка №3: exhaustive ≠ вакуумно

AC-3 требует кейс на КАЖДУЮ (state × key-класс). Guard-тест полноты (произведение множеств состояний и классов клавиш → каждый обработан) ловит забытый переход. Классы клавиш фиксированы типом `Key` — не «строки». Непокрытая пара обязана падать, а не молча давать `NOOP`, если контракт задаёт эффект.

### ⚠️ Ловушка №4: feature-folders + barrel-бан (ARCH-FE-013)

Модуль — в НОВОЙ фиче `src/features/daily-grid/` (её ещё нет; 9.2 заводит). НЕ создавать `index.ts`-barrel (ARCH-FE-013 — самотест `lint-canon` ловит). Импорт файлов напрямую. `daily-grid` НЕ импортирует из других `features/*` (eslint-boundaries). Грамматика — самодостаточный слой этой фичи; 9.4 (грид) ляжет рядом.

### Дефолты (#YOLO)

- **Д1 (дом):** `src/features/daily-grid/` (фича экрана №1). Альт: `src/shared/` (если грамматику захотят переиспользовать — не планируется, экран один).
- **Д2 (Char как класс):** `Char` — один класс клавиши (несёт `char` для type-ahead-seed); конкретные буквы не размножают таблицу (type-ahead-фильтрация списка — забота ячейки/9.6, не грамматики позиций).
- **Д3 (CONFLICT в грамматике):** переходы входа/выхода из `CONFLICT` (open на commit-конфликте, close→фокус в ячейку) — в машине; САМО детектирование 409/422 и диалог — грид/9.6 (бэкенд-коды E3). Грамматика знает лишь «диалог открыт/закрыт → куда фокус».
- **Д4 (тест-окружение):** `grammar.test.ts` — node-env (модуль чист); не тянуть jsdom/RTL.

### Границы (что 9.2 НЕ делает)

- fast-check property (9.3); грид-рендер/TanStack/автосейв (9.4); DOM-фокус/скролл (9.5); валидация/конфликт-детект/ConflictDialog-провод (9.6); prefill/отклонения (9.7); перф-смоук (9.8); e2e (9.9).
- Никакого React-компонента, API, стилей, бэкенда.

### References

- [Source: epics.md §Story 9.2 стр. 1077 (чистый модуль (key,cellState,position)→(action,nextPosition), exhaustive-таблица, без React); §Story 9.3 стр. 1085 (fast-check — отдельно)]
- [Source: docs/contracts/09-01-экран-1-массовый-грид.md §3.1 (состояния), §3.2 (ПОЛНАЯ таблица переходов — источник истины), §3.3 (3 инварианта)]
- [Source: architecture.md L253 (чистая state machine без React + exhaustive+fast-check); ARCH-FE-013 L240 (feature-folders/barrel-бан/boundaries); ARCH-FE-010 L237 (стейт-канон)]
- [Source: frontend/ (E8: Vite/React19/TS, Vitest 4, npm run gate, eslint-boundaries; features/{auth,print-forms})]

### Открытые вопросы (для Bratan — дефолты активны)

- **Q1 (дом):** `features/daily-grid/` [Д1] vs `shared/` — грамматика фиче-локальна или общая?
- **Q2 (объём Action-union):** достаточно ли перечня AC-2, или контракт-ревью добавит эффект (напр. отдельный `CONFIRM_STAY` для bulk)? Сверить с §3.2 при dev.

### Процессный гейт

- Фронт-гейт: `npm run gate` (из `frontend/`), Node ≥22.12. Не бэкенд `make gate`.
- RTL keyboard-path в DoD формо-стори (architecture L262) — здесь неприменим (нет UI; это чистый модуль). Приедет с 9.4/9.5.
- Ревью — по контракту 9.1 (реализация ≡ таблица §3.2).

## Dev Agent Record

### Agent Model Used

claude-opus-4-8 (Opus 4.8) — create-story + dev-story (TDD)

### Debug Log References

- **npm run gate зелёный:** 181 тестов (17 файлов, вкл. grammar.test.ts — 55 кейсов: NAVIGATE/EDIT/PERIOD_EDIT/CONFLICT + границы + guard-полноты 4×9), tsc strict чист, eslint (+ boundaries) чист, lint-canon чист, vite build ок, size-gate 150.4 КБ gzip (бюджет 300). Node v24.13; `npm ci` поставил deps (не было node_modules).
- ⚠️ **Хвост 6.10a/b:** фронт-гейт `schema-check` поймал дрейф `src/shared/api/schema.d.ts` ↔ `schema.yaml` (6.10 добавил эндпоинты в schema.yaml, фронт-типы не были перегенерены — backend `make gate` этого не ловит). Исправлено `npm run generate:api` (regen из schema.yaml). schema.d.ts входит в этот коммит.
- tsc-фикс: `transition` не деструктурировал неиспользуемые bounds/key (под-функции ре-деструктурируют input) → `const {state, position}`.

### Completion Notes List

- **Task 1-2 (типы + машина) — DONE.** `src/features/daily-grid/grammar.types.ts` (CellState/Key-discriminated/Position/Bounds+columnKinds/Action/TransitionInput/Result + KEY_TYPES/CELL_STATES/ColumnKind) + `grammar.ts` (`transition(input)` — switch state→switch key, `clamp`/`move`-хелперы, ноль импортов react/dom, `never`-исчерпывающесть). Чистая, детерминированная.
- **⚙️ Уточнение Action-union (Q2, отклонение от черновика AC-2):** направление коммита/движения закодировано в `nextPosition`, поэтому вместо черновых `CONFIRM_DOWN`/`CONFIRM_RIGHT` — единый `COMMIT`; добавлены `OPEN_PERIOD` (Enter на period-колонке) и `LIST_MOVE` (↑/↓ по кандидатам combobox в EDIT — контракт §3.2). Колонки заданы через `Bounds.columnKinds` (ФИО=readonly/status/period/flag) — так `transition` решает OPEN_EDIT vs OPEN_PERIOD vs NOOP по виду колонки, оставаясь чистой (сверено с §3.2).
- **Task 3 (exhaustive тесты) — DONE.** `grammar.test.ts` (Vitest, node-env, без jsdom): кейсы по §3.2 + краевые клампы (4 края + COMMIT из последней строки) + Esc→RESTORE_PRE_EDIT + type-ahead seed + **guard-полноты** (произведение CELL_STATES×KEY_TYPES × все 4 колонки → валидный action, nextPosition в границах, nextState валиден). 55 кейсов.
- **Task 4 (гейт/границы) — DONE.** `npm run gate` зелёный; feature-folders `daily-grid` (новая, без barrel-index, ARCH-FE-013); eslint-boundaries чист (не тянет из других features); модуль без react/dom (tsc+чтение). prettier применён (single-quote/no-semi канон проекта).
- **Границы:** fast-check property = 9.3 (не введён); грид/рендер = 9.4; DOM-фокус = 9.5; валидация/конфликт-детект = 9.6. Модуль значений ячеек не хранит, реальный фокус не двигает.
- **Осталось:** ревью по контракту 9.1 (реализация ≡ §3.2). Q1 (дом=features/daily-grid) применён.

### File List

- `frontend/src/features/daily-grid/grammar.types.ts` (создан — типы грамматики)
- `frontend/src/features/daily-grid/grammar.ts` (создан — чистая state machine `transition`)
- `frontend/src/features/daily-grid/grammar.test.ts` (создан — 55 exhaustive unit-кейсов)
- `frontend/src/shared/api/schema.d.ts` (регенерирован — `generate:api`, хвост API-изменений 6.10a/b)
