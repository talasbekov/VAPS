---
baseline_commit: 7211f18
---

# Story 11.3a: Бан глобала WebSocket

Status: ready-for-dev

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

- [ ] Task 1 — Конфиг ESLint (`frontend/eslint.config.js`, MOD) (AC: 1, 2, 3)
  - [ ] Добавить новый блок объекта конфигурации СРАЗУ после существующего ARCH-FE-015 блока (`fetch`/`XMLHttpRequest`, строки ~204-250) — тот же `files: ['src/**/*.{ts,tsx}']`, но `ignores: ['src/shared/notifications/**']` (вместо `src/shared/api/**`).
  - [ ] `no-restricted-globals`: `{ name: 'WebSocket', message: 'WS-транспорт только через shared/notifications (ARCH-FE-015-подобный канон, Story 11.3a): reconnect/backoff/kill-switch уже реализованы там, второй клиент — риск расхождения поведения' }`.
  - [ ] `no-restricted-properties`: `{ object: 'window', property: 'WebSocket', message: '...' }` и `{ object: 'globalThis', property: 'WebSocket', message: '...' }` — тот же текст сообщения, что глобал-бан, для консистентности с существующим XHR-паттерном.
  - [ ] Комментарий-обоснование над блоком: зеркало комментария у ARCH-FE-015 блока — почему этот канон существует (см. Dev Notes ниже), явная ссылка на Story 11.3a и epic-11-retro §1.
- [ ] Task 2 — Самотест канона (`frontend/scripts/lint-canon.test.mjs`, MOD) (AC: 4)
  - [ ] Новая константа `WS_NAME = \`__canon_ws_${PID}__\`` и путь `const WS = join(SRC, 'shared', 'notifications', WS_NAME)` (зеркало `API`/`API_NAME` для fetch-негатива).
  - [ ] `mkdirSync(WS, { recursive: true })` в try-блоке, `rmSync(WS, ...)` в finally.
  - [ ] Красная фикстура в `A` (существующая features-директория): `writeFileSync(join(A, 'websocket.ts'), 'export const ws = new WebSocket("wss://x")\n')`.
  - [ ] Красная фикстура property-канала: `writeFileSync(join(A, 'winwebsocket.ts'), 'export const w = new window.WebSocket("wss://x")\nexport const g = new globalThis.WebSocket("wss://x")\n')` — зеркало `winxhr.ts` (строки 185-189).
  - [ ] Зелёная фикстура: `writeFileSync(join(WS, 'probe.ts'), 'export const probe = () => new WebSocket("wss://x")\n')`.
  - [ ] Добавить `join(WS, '*.ts')` в массив путей `eslint.lintFiles([...])`.
  - [ ] `expectRule(results, \`${A_NAME}/websocket.ts\`, 'no-restricted-globals')`.
  - [ ] `expectRule(results, \`${A_NAME}/winwebsocket.ts\`, 'no-restricted-properties')`.
  - [ ] `expectClean(results, \`${WS_NAME}/probe.ts\`)`.
  - [ ] Обновить финальный `console.log` со счётчиком фикстур/негативных контролей (было «24 красных фикстур + 9 негативных контролей» → станет 26 + 10).
- [ ] Task 3 — Валидация (AC: 5)
  - [ ] `npm run gate` (frontend, из `frontend/`, не из корня — project convention) — зелёный целиком, включая `lint-canon.test.mjs`.
  - [ ] Убедиться, что `frontend/src/shared/notifications/notificationsSocket.ts` и `frontend/e2e-harness/notifications.tsx` (единственный файл вне `src/`, содержащий строку `WebSocket` — только в комментарии) не задеты — `e2e-harness/**` не под `src/**`, глоб их не матчит в принципе, задача — подтвердить, что это осталось так и не потребовалось точечного `ignores`.

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

_(заполняется dev-агентом по завершении)_

### File List

_(заполняется dev-агентом по завершении)_

## Change Log

| Дата | Изменение |
|---|---|
| 2026-07-28 | Story создана (create-story) |
