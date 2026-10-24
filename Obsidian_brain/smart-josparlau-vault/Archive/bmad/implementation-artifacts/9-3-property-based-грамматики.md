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

Status: done

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
  - [x] ⚙️ Ревью 2026-07-14: `stateArb`/`positionArb(bounds)` как отдельных генераторов НЕТ — реализованы слитно внутри `startArb` (эквивалентно, раскрыто в Completion Notes; дрейф формулировки чекбокса зафиксирован). `keyArb` (non-Char литералы под `satisfies` + `Char` из пула с кириллицей — правка ревью), `boundsArb` (`rows/cols` 1..8, `columnKinds` длиной `cols`). Чистые, без React.
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

## Review Findings

<!-- Ревью 2026-07-14 (bmad-code-review, Fable 5, CROSS-MODEL vs спека+dev Opus 4.8; дифф = коммит 0cc64ad, аудит против HEAD — grammar.ts/types менялись d13fed8 [ревью 9.2], сам тест-файл не менялся; Auditor прогнал 3 мутационные пробы фактически). Слои: Blind Hunter / Edge Case Hunter / Acceptance Auditor. Вердикт AC: 1/2/4/5/6-pass (инв.1 и инв.3 доказуемо НЕ вакуумны — красные на мутациях), 3-ВАКУУМЕН → закрыт. 0 decision · 9 patch ПРИМЕНЕНЫ · 2 defer · 4 dismiss. После патчей: 4 теста (2→4), красная проба «Char→NOOP» красная (15 прогонов), full-профиль 687мс, npm run gate зелёный (219, 150.4KB). -->

- [x] [Review][Patch] ✅ ИСПРАВЛЕНО 2026-07-14 (в свёртку добавлены эффект-классы §3.2 без дублирования всей таблицы: стрелки в NAVIGATE → MOVE с направленным сдвигом/клампом на границе; Char на status → TYPE_AHEAD+seed===char+EDIT; Enter на status/period → OPEN_EDIT/OPEN_PERIOD; Char в EDIT → TYPE_AHEAD+seed; красная проба «Char→NOOP» роняет свойство за 15 прогонов) **Инв.2 «нажатия не теряются» был подменён вакуумным «результат определён и валиден» (blind CRITICAL + auditor мутационной пробой: вечно-NOOP заглушка проходила инв.1+2 на 100%):** свойство не отличало «нажатие обработано» от «нажатие проглочено» — регрессия глотания символов прошла бы гейт. Ослабление было внесено ещё на этапе спеки (AC-3 сформулирован слабо) — AC-3 оставлен как есть (тотальность+детерминизм), различающая сила добавлена В ДОПОЛНЕНИЕ. [frontend/src/features/daily-grid/grammar.properties.test.ts]
- [x] [Review][Patch] ✅ ИСПРАВЛЕНО (ассерт в свёртке: state∈{EDIT,PERIOD_EDIT} && action≠COMMIT → nextPosition === входная позиция) **Инв.3 не видел дрейфа позиции внутри edit-сессии (blind MAJOR):** одиночный синтетический Esc-шаг честен, но если бы какой-то ключ внутри EDIT сдвигал позицию, Esc «вернул» бы фокус в уехавшую ячейку — оба свойства оставались зелёными. [frontend/src/features/daily-grid/grammar.properties.test.ts]
- [x] [Review][Patch] ✅ ИСПРАВЛЕНО (новое 3-е свойство: стартовая позиция −5..15 × bounds 1..8 × любой state/key → nextPosition в границах) **Самоисцеление входа (d13fed8) лежало ЦЕЛИКОМ вне property-пространства (edge MAJOR):** startArb генерировал только валидные старты — единственное поведение, добавленное правками ревью 9.2, не исполнялось ни одним прогоном; отрицательные координаты и overflow по col не были покрыты ВООБЩЕ нигде (юнит-кейсы d13fed8 — только row-overflow и rows=0). [frontend/src/features/daily-grid/grammar.properties.test.ts]
- [x] [Review][Patch] ✅ ИСПРАВЛЕНО (CHAR_POOL с кириллицей/ё/цифрами/пробелом/дефисом + oneof с дефолтным string) **Генератор Char покрывал только ASCII fast-check (blind MAJOR):** язык самих операторов (кириллический type-ahead статусов) не встречался ни в одном прогоне. [frontend/src/features/daily-grid/grammar.properties.test.ts]
- [x] [Review][Patch] ✅ ИСПРАВЛЕНО (toStrictEqual вместо toEqual) **Детерминизм не отличал `seed: undefined` от отсутствия seed (edge MINOR):** toEqual считает `{seed: undefined}` ≡ `{}` — недетерминизм формы результата проходил. [frontend/src/features/daily-grid/grammar.properties.test.ts]
- [x] [Review][Patch] ✅ ИСПРАВЛЕНО (снапшот входной позиции до вызова + ассерт неизменности) **Чистота transition не ассертилась (blind+edge MINOR):** кламп мутацией входного объекта прошёл бы все свойства, а гриду 9.4 дал бы shared-reference баг. [frontend/src/features/daily-grid/grammar.properties.test.ts]
- [x] [Review][Patch] ✅ ИСПРАВЛЕНО (Record<Action,true> → Set; литералы NON_CHAR_KEYS под `satisfies readonly Key[]` вместо `as Key`; мета-тест синка NON_CHAR_KEYS↔KEY_TYPES) **ACTIONS-сет и Key-касты без компайл-привязки (blind+edge MINOR):** Set<Action> принимал подмножество (новый Action — только рантайм-лотерея), `as Key` пропустил бы будущий payload-несущий вариант в генератор молча. [frontend/src/features/daily-grid/grammar.properties.test.ts]
- [x] [Review][Patch] ✅ ИСПРАВЛЕНО (`npm run test:property-full` в package.json — зеркало backend test-full/HYPOTHESIS_PROFILE) **FC_PROFILE=full не был подключён ни к одному скрипту (blind+edge MINOR):** ветка full=1000 не исполнялась никаким автоматическим прогоном — могла молча сломаться (проверено: 687мс, зелёная). [frontend/package.json]
- [x] [Review][Patch] ✅ ИСПРАВЛЕНО (minLength:1 у последовательности + комментарий о CONFLICT-покрытии в тест-файле) **Вакуумные пустые последовательности + недокументированная граница CONFLICT (blind+edge NOTE):** fast-check биасит к малым размерам — часть из 100 сидированных прогонов не исполняла тело вовсе; вход в CONFLICT задаёт грид (не грамматика) → в свёртке CONFLICT только стартовым префиксом, компенсация exhaustive-таблицей теперь оговорена комментом. [frontend/src/features/daily-grid/grammar.properties.test.ts]
- [x] [Review][Defer] **Фикс-сид навсегда = замороженные N примеров (blind MINOR):** канон проекта (урок tz-флейка — гейт не мигает) осознанно меняет «случайность» на воспроизводимость; рандом-сид с логированием в ночном full-прогоне — вопрос CI-инфраструктуры (её нет до E12) — deferred [frontend/src/features/daily-grid/grammar.properties.test.ts:19]
- [x] [Review][Defer] **Дрейф чекбокса Task 2 (auditor LOW):** заявленные `stateArb`/`positionArb(bounds)` реализованы слитно в `startArb` — эквивалентно и раскрыто в Notes, чекбокс аннотирован; систематический паттерн (8-е наблюдение) — отслеживается ретроспективой эпика — deferred/зафиксировано [_bmad-output/implementation-artifacts/9-3-property-based-грамматики.md]
- [x] [Review][Dismiss ×4] `columnKinds.length < cols` не генерируется (fallback `?? 'readonly'` = безопасное направление, dismissed ещё ревью 9.2); инв.3 «сигнал, не значение» (санкционировано Ловушкой №2 спеки, значение тестирует грид 9.4 — Esc-тест ревью 9.4); File List без sprint-status.yaml (процессная конвенция, консистентно с 9.4); ассерты `nextState∈CELL_STATES`/`ACTIONS.has` «тавтологичны под strict TS» (ловят unsafe cast и рантайм-мусор не-TS вызова — осознанная стоимость нуля).

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

- `frontend/src/features/daily-grid/grammar.properties.test.ts` (создан — 2 property-свойства fast-check; ревью 2026-07-14 — усилен до 4 тестов: эффект-классы в свёртке, OOB-самоисцеление, кириллица, toStrictEqual, чистота, компайл-привязки, мета-синк генератора)
- `frontend/package.json` (изменён — +fast-check в devDependencies; ревью — +скрипт test:property-full)
- `frontend/package-lock.json` (изменён — fast-check + транзитивные)
