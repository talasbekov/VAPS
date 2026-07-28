---
baseline_commit: 7211f18
---

# Story 11.3a: Бан глобала WebSocket

Status: done

## Story

As a **архитектор фронтенда**,
I want **запрет прямого использования глобала `WebSocket` (и его property-каналов `window.WebSocket`/`globalThis.WebSocket`) везде в `src/`, кроме `src/shared/notifications/**`**,
so that **WS-транспорт остаётся единой точкой (`notificationsSocket.ts`) так же, как HTTP уже стянут в `shared/api` (ARCH-FE-015) — второй параллельный WS-клиент не может тихо появиться в фиче в обход reconnect/backoff/kill-switch логики, уже написанной и протестированной в Epic 11**.

## Acceptance Criteria

Источник: `_bmad-output/implementation-artifacts/epic-11-retro-2026-07-20.md` §1: «Carve-out'ы в backlog (намеренно): 11.3a (бан глобала `WebSocket` вне `src/shared/notifications/**`)» — отложенный из Story 11.3 (`ws-клиент-с-reconnect`) технический долг, аналогичный по духу ARCH-FE-015 (HTTP только через `apiClient`, стори 8.4).

1. **AC-1 (глобал `WebSocket` забанен вне `src/shared/notifications/**`).** `eslint.config.js` получает новый блок `no-restricted-globals` на `name: 'WebSocket'` с `files: ['src/**/*.{ts,tsx}']`, `ignores: ['src/shared/notifications/**']` — зеркало структуры существующего ARCH-FE-015 блока (`eslint.config.js:204-250`) для `fetch`/`XMLHttpRequest`.
2. **AC-2 (property-каналы тоже забанены).** `no-restricted-properties` банит `window.WebSocket` и `globalThis.WebSocket` в том же блоке — зеркало property-банов XHR (ревью 8.4 явно зафиксировало: «бан глобала обходился через `window.XMLHttpRequest`» — тот же обходной канал существует и для `WebSocket`, поэтому банится сразу, а не постфактум).
3. **AC-3 (единственное легальное использование — `notificationsSocket.ts` — остаётся зелёным).** `frontend/src/shared/notifications/notificationsSocket.ts:99` (`const defaultSocketFactory: SocketFactory = (url) => new WebSocket(url)`) — внутри исключённого пути, продолжает линтиться без ошибок.
4. **AC-4 (`lint-canon.test.mjs` доказывает канон фикстурами, не только конфигом).** Новая красная фикстура в `features/__canon_a_<pid>__/` использует `new WebSocket(...)` → ассертится `no-restricted-globals`. Новая фикстура на property-канал (`window.WebSocket`/`globalThis.WebSocket`) → ассертится `no-restricted-properties`. Негативный контроль: фикстура ВНУТРИ временной `shared/notifications/__canon_ws_<pid>__/` с `new WebSocket(...)` — зелёная (зеркало `API_NAME`-фикстуры для fetch, строки 196-199 и 450 текущего файла).
5. **AC-5 (регресс нулевой).** `npm run gate` (frontend) зелёный, включая сам `lint-canon.test.mjs`. Существующий `notificationsSocket.ts` и его тесты (`notificationsSocket.test.ts`) — без изменений в поведении, только линт продолжает их пропускать.

## Tasks / Subtasks

- [x] Task 1 — Конфиг ESLint (`frontend/eslint.config.js`, MOD) (AC: 1, 2, 3)
  - [x] **Отклонение от исходного плана (обнаружено при реализации):** простое добавление отдельного блока `{ files: ['src/**/*.{ts,tsx}'], ignores: ['src/shared/notifications/**'], rules: {...WebSocket...} }` СРАЗУ после ARCH-FE-015-блока сломало сам ARCH-FE-015 — flat config НЕ мержит значение правила между блоками с overlapping `files`: второй матчащий блок для того же имени правила (`no-restricted-globals`/`no-restricted-properties`) полностью ЗАМЕНЯЕТ набор ограничений первого, а не объединяет. `lint-canon.test.mjs` немедленно поймал регресс (fetch/XHR-фикстуры внезапно позеленели). Исправлено расщеплением на 3 непересекающихся блока: (1) весь `src/**` кроме `shared/api/**` и `shared/notifications/**` — оба канона разом; (2) `shared/api/**` — только WS-бан (HTTP легален); (3) `shared/notifications/**` — только HTTP-бан (WS легален). Комментарий-предупреждение об этой ловушке flat config оставлен прямо в конфиге.
  - [x] `no-restricted-globals`: `{ name: 'WebSocket', message: '...' }` — во всех трёх блоках, где применимо.
  - [x] `no-restricted-properties`: `window.WebSocket`/`globalThis.WebSocket` — во всех трёх блоках, где применимо.
  - [x] Комментарий-обоснование над блоком — ссылка на Story 11.3a и epic-11-retro §1, плюс явное предупреждение о non-merge ловушке flat config (для будущих канонов).
- [x] Task 2 — Самотест канона (`frontend/scripts/lint-canon.test.mjs`, MOD) (AC: 4)
  - [x] `WS_NAME`/`WS` (зеркало `API`/`API_NAME`), `mkdirSync`/`rmSync` в try/finally.
  - [x] Красная фикстура `websocket.ts` (глобал) и `winwebsocket.ts` (property-канал, оба object) в `A`.
  - [x] Зелёная фикстура `WS/probe.ts`.
  - [x] `join(WS, '*.ts')` добавлен в `eslint.lintFiles([...])`.
  - [x] `expectRule` на оба красных канала, `expectClean` на зелёный.
  - [x] Счётчик в финальном `console.log` обновлён: 24→26 фикстур, 9→10 негативных контролей.
- [x] Task 3 — Валидация (AC: 5)
  - [x] `npm run gate` (frontend) — зелёный целиком: deps-gate, schema-check, tsc, eslint, lint-canon (26+10), schema-check.test, build-constants.test, vitest (63 files/993 tests passed), vite build, size-gate (212.4 KB / 300 KB бюджет).
  - [x] Подтверждено: `notificationsSocket.ts` (внутри `shared/notifications`) и `e2e-harness/notifications.tsx` (вне `src/`, строка `WebSocket` только в комментарии) не затронуты — gate зелёный без единого точечного `ignores` сверх трёх канон-блоков.

## Dev Notes

- **Прямой прецедент — ARCH-FE-015 (Story 8.4).** Структура нового блока — буквальная копия существующего HTTP-бана (`eslint.config.js:204-250`): тот же приём `no-restricted-globals` + `no-restricted-properties` для обхода через `window.X`/`globalThis.X`, тот же `files`/`ignores` паттерн (один разрешённый модуль-владелец транспорта). Отличие только в имени глобала (`WebSocket` вместо `fetch`/`XMLHttpRequest`) и в исключённом пути (`src/shared/notifications/**` вместо `src/shared/api/**`).
- **Ревью 8.4 явно предупредило про property-канал как обходной путь** («бан глобала обходился через `window.XMLHttpRequest`») — эта же ловушка применима к `WebSocket`: `window.WebSocket`/`globalThis.WebSocket` банятся С ПЕРВОГО ПРОХОДА, не постфактум-фиксом.
- **Единственное реальное production-использование `new WebSocket(...)` в `src/`** — `notificationsSocket.ts:99`, внутри `defaultSocketFactory`. Проверено грепом (`grep -rn "new WebSocket" frontend/src`) на момент создания стори — больше нигде в `src/` глобал не используется напрямую. `frontend/e2e-harness/notifications.tsx:13` содержит строку `WebSocket` только в комментарии (не код) и физически вне `src/`, поэтому вне области действия правила без дополнительных `ignores`.
- **Самотест — не факультатив.** Проектный канон (см. существующий `lint-canon.test.mjs`, комментарий в шапке файла: «вакуумный pass запрещён») требует доказывать ЛЮБОЙ новый ESLint-канон живой красной фикстурой + негативным контролем на разрешённое направление, а не полагаться на факт компиляции конфига. Пропуск Task 2 оставил бы правило недоказанным — тот же урок, что уже был усвоен в 8.2/8.4/8.7.
- **Зачем это вообще нужно (мотивация из ретро).** Epic 11 построил единственный WS-клиент с reconnect/backoff/kill-switch (`VAPS_WS_ENABLED`, Story 11.5) — весь этот протокол живёт в одном модуле. Без архитектурного барьера ничто не мешает будущей фиче открыть свой `new WebSocket(...)` в обход reconnect-логики и kill-switch — молчаливая деградация, которую поймать в code review сложнее, чем на этапе линта.
- **Не трогать `notificationsSocket.ts`/`notificationsSocket.test.ts`/`useNotificationsFeed.*`.** Эта стори — чисто линт-канон, ноль изменений в рантайм-коде WS-клиента.

### References

- [Source: _bmad-output/implementation-artifacts/epic-11-retro-2026-07-20.md] — постановка carve-out'а (§1, §4).
- [Source: frontend/eslint.config.js:204-250] — прямой структурный прецедент (ARCH-FE-015, fetch/XHR бан).
- [Source: frontend/scripts/lint-canon.test.mjs] — самотест-канон, паттерн фикстур для копирования (см. `API`/`API_NAME`/`fetch.ts`/`winfetch.ts`/`winxhr.ts`).
- [Source: frontend/src/shared/notifications/notificationsSocket.ts:99] — единственное легальное использование глобала.

## Dev Agent Record

### Context Reference

- Story context assembled directly from epic-11 retrospective + live grep of `src/` for existing `WebSocket` usage (no epics.md entry exists for this carve-out — it originates from the retro, not the original epic decomposition).

### Completion Notes

Реализовано по плану с одним значимым отклонением, обнаруженным в процессе (см. Task 1): наивное добавление отдельного `{files, ignores, rules}`-блока после ARCH-FE-015 сломало сам ARCH-FE-015, потому что flat config ESLint НЕ мержит значения правил (`no-restricted-globals`/`no-restricted-properties`) между блоками с overlapping `files` — второй матчащий блок для того же имени правила ПОЛНОСТЬЮ заменяет набор ограничений первого. `lint-canon.test.mjs` немедленно поймал регресс (fetch/XHR-фикстуры внезапно позеленели на существующих файлах). Исправлено расщеплением на три непересекающихся блока (общий src / shared/api-владелец / shared/notifications-владелец), с явным предупреждающим комментарием в конфиге — задокументировано как урок для будущих ESLint-канонов.

**Ревью (3 агента, cross-model):**
- **Blind Hunter** (diff-only) и **Edge Case Hunter** (полный доступ к проекту) НЕЗАВИСИМО пришли к одной и той же находке: самотест доказывал только «свой канон легален у владельца» (WebSocket легален в shared/notifications, fetch легален в shared/api), но НЕ доказывал обратную сторону — что «чужой» бан не потерялся у владельца (WebSocket всё ещё красный в shared/api, fetch всё ещё красный в shared/notifications). Ровно та ловушка non-merge flat config, которую сама правка призвана предотвращать, — прошла бы регресс незамеченной. Исправлено: добавлены 2 красные фикстуры (`API/ws-banned.ts`, `WS/fetch-banned.ts`) + 2 assertion'а; счётчик самотеста обновлён 26→28 красных фикстур (негативные контроли остались 10 — обе новые фикстуры красные, не зелёные).
- Edge Case Hunter также отметил (не блокер, задокументировано как открытый trade-off): три новых блока, в отличие от соседних ARCH-FE-012/печатного канона, не исключают `*.test.{ts,tsx}` — сегодня это безвредно (ни один тестовый файл не создаёт `new WebSocket(...)` напрямую, все идут через мокнутую фабрику), но будущий тест, которому понадобится реальный `new WebSocket(...)` вне `shared/notifications` (например, против реального mock WS-сервера), будет заблокирован линтом без явного carve-out. Осознанно не расширяю поверхность правки под гипотетический будущий тест — при необходимости добавляется отдельной точечной правкой.
- **Acceptance Auditor** независимо перепрочитал код, сам прогнал `lint-canon.test.mjs` и полный `npm run gate` (993 теста / 63 файла, size-gate 212.4 KB / 300 KB) — все 5 AC подтверждены удовлетворёнными без расхождений с заявлениями стори.

Финальный прогон `npm run gate` (после фикса находок ревью) — зелёный целиком.

### File List

- `frontend/eslint.config.js` (MOD) — три блока вместо одного (ARCH-FE-015 + Story 11.3a, WS-бан).
- `frontend/scripts/lint-canon.test.mjs` (MOD) — 28 красных фикстур + 10 негативных контролей (было 24+9 до стори).

## Change Log

| Дата | Изменение |
|---|---|
| 2026-07-28 | Story создана (create-story) |
| 2026-07-28 | dev-story: реализация + фикс flat-config non-merge ловушки + фикс находок ревью (перекрёстные негативные контроли) → done |
