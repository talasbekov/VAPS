---
baseline_commit: |
  4e0172e (feat(story-9.2)) на ветке claude/exciting-vaughan-3e478b. Грамматика
  (grammar.ts/transition) реализована в 9.2. 9.3 — property-тесты поверх неё.
context:
  - _bmad-output/planning-artifacts/epics.md (§Story 9.3 стр. 1085: «fast-check свойства: фокус всегда в границах, нажатия не теряются, Esc возвращает pre-edit … произвольная последовательность клавиш (fast-check) → все три инварианта держатся; сид зафиксирован, профили ci/full»)
  - docs/contracts/09-01-экран-1-массовый-грид.md §3.3 (три инварианта — первоисточник)
  - frontend/src/features/daily-grid/grammar.ts (9.2 — `transition(input)`; grammar.types.ts — CellState/Key/Bounds/Action + KEY_TYPES/CELL_STATES)
  - _bmad-output/planning-artifacts/architecture.md (L253 «property-based (fast-check): фокус всегда в границах, нажатия не теряются, Esc возвращает pre-edit»; L258 гейт < 5 мин: property в vitest; ARCH-FE-010 канон; frontend/scripts/banned-packages.mjs — fast-check НЕ забанен)
  - frontend/package.json + deps-gate.mjs (добавление fast-check в devDeps + lock; deps-gate сверяет lock с бан-списком/scope)
---

# Story 9.3: Property-based грамматики

Status: review

## Story

As a **разработчик**,
I want **fast-check property-тесты грамматики 9.2: на ПРОИЗВОЛЬНЫХ последовательностях клавиш держатся три инварианта — (1) фокус всегда в границах, (2) нажатия не теряются, (3) Esc возвращает pre-edit — с зафиксированным сидом и профилями ci/full**,
so that **слепой ввод не ломается на неожиданных последовательностях, которые exhaustive-таблица (9.2) не перебирает**.

## Scope

Один property-тест-файл (fast-check) поверх неизменного `transition` (9.2) + dev-зависимость fast-check. НЕ трогает грамматику, НЕ грид.

## Out of Scope

- **Изменение `grammar.ts`/`grammar.types.ts`** — грамматика заморожена 9.2; если property найдёт баг — фикс отдельным коммитом/пересмотром 9.2, не в этой стори «по ходу».
- Грид (9.4), фокус-слой (9.5), валидация (9.6), любой React.

## Acceptance Criteria

1. **fast-check введён корректно.** Given `frontend/package.json`, Then `fast-check` добавлен в `devDependencies` (+ lock); `node scripts/deps-gate.mjs` зелёный (fast-check не в бан-списке/scope-банах). Импорт только в тест-файле.

2. **Инвариант 1 — фокус всегда в границах.** Given произвольная последовательность `Key[]`, произвольный старт (`state`, `position` в границах, `bounds` с `rows,cols ≥ 1` и валидными `columnKinds`), When свёртка последовательности через `transition`, Then после КАЖДОГО шага `nextPosition` в границах (`0 ≤ row < rows`, `0 ≤ col < cols`).

3. **Инвариант 2 — нажатия не теряются.** Given любой шаг, Then `transition` возвращает определённый результат (никогда `undefined`/throw), `action` ∈ известного множества, `nextState` ∈ `CELL_STATES`; детерминизм: повторный вызов с тем же входом даёт тот же выход.

4. **Инвариант 3 — Esc возвращает pre-edit.** Given `state ∈ {EDIT, PERIOD_EDIT}` и `key = Esc`, Then результат = `action: RESTORE_PRE_EDIT`, `nextState: NAVIGATE`, `nextPosition` = исходная позиция (не сдвинута). (Грамматика сигнализирует восстановление; само pre-edit значение хранит грид 9.4 — property проверяет сигнал/позицию.)

5. **Детерминизм прогона.** Given фиксированный сид fast-check, Then прогон воспроизводим; профиль числа прогонов — ci (быстро, в гейте) vs full (больше примеров) через env (напр. `FC_PROFILE`/`numRuns`), дефолт — ci. Контрпример при падении печатается (fast-check shrink).

6. **Гейт зелёный.** `npm run gate` зелёный (property-тест бежит в vitest, node-env, быстрый — чистая функция); tsc/eslint/lint-canon/boundaries чисты. Грамматика 9.2 НЕ изменена (git-сверка).

## Tasks / Subtasks

- [x] Task 1: Зависимость (AC: 1)
  - [x] `npm i -D fast-check` (обновит package.json + lock); `node scripts/deps-gate.mjs` зелёный.
- [x] Task 2: Генераторы (arbitraries) (AC: 2-4)
  - [x] `keyArb` (произвольный `Key`, `Char` с непустым символом), `stateArb` (из `CELL_STATES`), `boundsArb` (`rows/cols` 1..8, `columnKinds` длиной `cols` из `{readonly,status,period,flag}`), `positionArb(bounds)` (в границах). Чистые, без React.
- [x] Task 3: Свойства (AC: 2-5)
  - [x] `grammar.properties.test.ts`: (а) свёртка `Key[]` через `transition` — `nextPosition` в границах на каждом шаге + позиция следующего шага = предыдущий `nextPosition`; (б) детерминизм (двойной вызов ≡); (в) Esc в EDIT/PERIOD_EDIT → RESTORE_PRE_EDIT+NAVIGATE+та же позиция; (г) `action`∈множества/`nextState`∈CELL_STATES. Сид зафиксирован; numRuns по профилю.
- [x] Task 4: Гейт (AC: 6)
  - [x] `npm run gate` зелёный; git-сверка «grammar.ts/types не тронуты»; prettier по тест-файлу.

## Dev Notes

### ⚠️ Ловушка №1 (ГЛАВНАЯ): грамматика 9.2 ЗАМОРОЖЕНА

9.3 — только тесты. `transition` не меняется. Если property найдёт нарушение инварианта — это БАГ (грамматики или контракта), поднимается отдельно (фикс = ревизия 9.2/контракта 9.1), а не «подгоняется» в этой стори. Ценность 9.3 — доказать инварианты §3.3 на пространстве последовательностей, которое exhaustive-таблица не покрывает.

### ⚠️ Ловушка №2: Esc→pre-edit — на уровне грамматики это СИГНАЛ, не значение

Модуль 9.2 значений ячеек не хранит (чистые позиции/состояния). «Esc возвращает pre-edit» на уровне грамматики = `Esc` в EDIT/PERIOD_EDIT всегда даёт `RESTORE_PRE_EDIT` + возврат в NAVIGATE в ТОЙ ЖЕ позиции. Фактическое восстановление значения ячейки применяет грид (9.4). Property проверяет сигнал+позицию, не хранилище.

### ⚠️ Ловушка №3: свёртка последовательности — позиция цепляется

Инвариант «фокус в границах» проверяется на СВЁРТКЕ: старт `(state0, pos0)` → на каждом ключе следующий вход = `{state: prev.nextState, position: prev.nextPosition, bounds, key}`. Так `bounds` постоянен (грид не меняет форму в ходе ввода), а позиция/состояние переносятся. Каждый промежуточный `nextPosition` обязан быть в границах.

### ⚠️ Ловушка №4: профили ci/full + фикс-сид (детерминизм гейта)

fast-check с фиксированным `seed` (воспроизводимость; урок tz-флейка — гейт не должен мигать). numRuns: ci (напр. 100, быстро в `npm run gate`) vs full (напр. 1000). Переключатель env (`FC_PROFILE=full`) — дефолт ci. Зеркало backend hypothesis ci/full (architecture L258).

### Дефолты (#YOLO)

- **Д1 (файл):** `frontend/src/features/daily-grid/grammar.properties.test.ts` (рядом с модулем).
- **Д2 (numRuns):** ci=100 / full=1000 через `FC_PROFILE`; seed зафиксирован константой.
- **Д3 (bounds-диапазон):** rows/cols 1..8 (достаточно для инвариантов; не раздувать прогон).

### Границы (что 9.3 НЕ делает)

- Не меняет grammar.ts/types (9.2). Грид/фокус/валидация = 9.4-9.6. Не вводит React/DOM/jsdom (property на чистой функции).

### References

- [Source: epics.md §Story 9.3 стр. 1085 (fast-check, 3 инварианта, сид+профили ci/full)]
- [Source: docs/contracts/09-01-*.md §3.3 (три инварианта — первоисточник)]
- [Source: architecture.md L253 (property-based fast-check + 3 инварианта), L258 (property в vitest-гейте < 5 мин)]
- [Source: frontend/src/features/daily-grid/grammar.ts + grammar.types.ts (9.2 — transition/типы/KEY_TYPES/CELL_STATES); frontend/scripts/deps-gate.mjs + banned-packages.mjs (fast-check не забанен)]

### Открытые вопросы (для Bratan — дефолты активны)

- **Q1 (профиль в гейте):** ci=100 numRuns в `npm run gate` [Д2] — достаточно, или гонять full? (баланс покрытие vs время гейта).
- **Q2 (env-имя):** `FC_PROFILE` [Д2] или переиспользовать существующий механизм фронт-гейта?

### Процессный гейт

- `npm run gate` (frontend). Property на чистой функции — быстрый, node-env, без jsdom.
- Ревью — по §3.3 контракта (инварианты) + фикс-сид (нет флейка).

## Dev Agent Record

### Agent Model Used

claude-opus-4-8 (Opus 4.8) — create-story + dev-story (property-based)

### Debug Log References

- **npm run gate зелёный:** property-тесты в vitest (2 свойства × 100 прогонов ci; профиль full=1000 через `FC_PROFILE`), tsc/eslint/lint-canon/boundaries чисты, build+size 150.4 КБ/300. fast-check 4.9.0 в devDeps; `deps-gate` зелёный (fast-check не забанен, 536 пакетов lock).
- Свойства прошли на пространстве последовательностей — грамматика 9.2 инварианты §3.3 держит; grammar.ts/types НЕ изменены.

### Completion Notes List

- **Task 1 (dep) — DONE.** `npm i -D fast-check` (4.9.0) + lock; deps-gate зелёный.
- **Task 2-3 (генераторы + свойства) — DONE.** `grammar.properties.test.ts`: arbitraries — `keyArb` (oneof non-Char + Char с 1-символьной строкой), `boundsArb` (rows/cols 1..8 + columnKinds длиной cols), `startArb` (state из CELL_STATES + position в границах). Свойства: (инв.1+2) свёртка `Key[]` (≤50) через `transition` — на КАЖДОМ шаге nextPosition в границах + action∈множества + nextState∈CELL_STATES + детерминизм (двойной вызов ≡); позиция/состояние переносятся, bounds постоянен. (инв.3) Esc в EDIT/PERIOD_EDIT → RESTORE_PRE_EDIT/NAVIGATE/та же позиция. Фикс-сид `0x9a3` (без флейка), numRuns по `FC_PROFILE` (ci=100/full=1000).
- **Task 4 (гейт) — DONE.** `npm run gate` зелёный; git-сверка: grammar.ts/grammar.types.ts НЕ тронуты (9.2 заморожена). prettier применён.
- **Границы:** грамматика не менялась; грид/фокус/валидация = 9.4-9.6; без React/DOM/jsdom.
- **Осталось:** ревью по §3.3. Дефолты Д1-Д3 (файл рядом с модулем; ci=100/full=1000; bounds 1..8) применены; Q1/Q2 (профиль в гейте / env-имя) — дефолт ci/FC_PROFILE.

### File List

- `frontend/src/features/daily-grid/grammar.properties.test.ts` (создан — 2 property-свойства fast-check)
- `frontend/package.json` (изменён — +fast-check в devDependencies)
- `frontend/package-lock.json` (изменён — fast-check + транзитивные)
