---
baseline_commit: 999a98d49b428562165d286dabfb7db70024948a
---

# Story 8.1: Scaffold Vite react-ts с контурной донастройкой

Status: done

> **Контекст запуска:** первая фронтенд-стори проекта (эпик E8 стартует; фронта в репо ещё нет — гринфилд).
> Baseline диффа: `999a98d` (ревизия планирования: донорский shadcn вместо Mantine).
> Стратегия: **frontend-first** — E8–E11 идут с MSW-моками впереди бэка (E6/E7 и 5.10/5.11 позже).
> Визуальный контракт экранов — кликабельный прототип claude.ai/design «Дашборд расхода персонала»
> (брифы: `_bmad-output/planning-artifacts/ux-designs/ux-PersonnelStatus-2026-06-19/prototype-briefs-claude-design.md`).
> К ЭТОЙ стори прототип отношения почти не имеет — здесь только каркас сборки; UI появится в 8.7.

## Story

As a разработчик,
I want `npm create vite` (react-ts) + build.target firefox100, browserslist, бюджет ≤300КБ в gate, каркас вендоринга шрифтов, dev-прокси `/api` и `/ws`,
so that фронтенд собирается под целевую среду (Firefox ~100, 4 ГБ RAM, закрытый контур без CDN) с первого дня.

## Acceptance Criteria

1. **Given** чистый клон + `npm ci` в `frontend/`, **When** `npm run build`, **Then** сборка проходит; `vite.config.ts` содержит `build.target: 'firefox100'`; `.browserslistrc` = `firefox >= 100`.
2. **Given** `npm run gate` (фронтовый гейт), **Then** последовательно проходят: `tsc -b` (типы), `eslint .` (включая eslint-plugin-compat против browserslist), `vite build`, `node scripts/size-gate.mjs` — суммарный **gzip** всех JS-ассетов `dist/` ≤ **300 КБ**; при превышении гейт падает с перечислением ассетов и их размеров.
3. **Given** собранный `dist/` и `index.html`, **Then** ни одного запроса на внешние хосты: нет `<link>`/`<script>`/`@import`/`url()` на `http(s)://` (кроме `localhost`); проверка — grep-ассерт в `size-gate.mjs` (или отдельный `no-cdn`-чек в гейте). Шрифты — системный стек (канон ДС донора: Inter НЕ подключать); каркас `public/fonts/` создан (пустой, с README-строкой) под будущую казахскую кириллицу, если понадобится.
4. **Given** `npm run dev` при поднятом Django (`localhost:8000`), **Then** запросы `/api/*` проксируются на `http://localhost:8000`, `/ws/*` — с `ws: true`; цель прокси переопределяется env `VITE_PROXY_TARGET`.
5. **Given** дерево `frontend/src/`, **Then** каркас каталогов соответствует ARCH-FE-013: `app/` (entry, `main.tsx`), `features/` (пусто, `.gitkeep`), `shared/` (пусто, `.gitkeep`); демо-мусор Vite (логотипы, счётчик, App.css-стили) удалён — `App.tsx` рендерит минимальную заглушку «PersonnelStatus».
6. **Given** `.nvmrc`, **Then** нода запинена (`24`); `package.json` содержит `"engines": {"node": ">=22.12"}` (минимум Vite 7).

## Tasks / Subtasks

- [x] Task 1: Scaffold (AC: 1, 5, 6)
  - [x] `npm create vite@latest frontend -- --template react-ts` из корня репо; зафиксировать версии: Vite 7.x, React 19.2.x, TypeScript 5.x
  - [x] Удалить демо-boilerplate; `src/app/main.tsx` как entry (поправить `index.html`), `App.tsx` → заглушка; создать `src/features/.gitkeep`, `src/shared/.gitkeep`
  - [x] `.nvmrc` (24), `engines` в package.json, `.gitignore` дополнить (dist, node_modules уже есть у Vite-шаблона)
- [x] Task 2: Контурная донастройка сборки (AC: 1, 4)
  - [x] `vite.config.ts`: `build.target: 'firefox100'`, `server.proxy` для `/api` (target из `VITE_PROXY_TARGET` || `http://localhost:8000`, `changeOrigin: false`) и `/ws` (`ws: true`)
  - [x] `.browserslistrc`: `firefox >= 100`
- [x] Task 3: Линт-минимум с compat (AC: 2)
  - [x] Flat eslint config: typescript-eslint (recommended) + `eslint-plugin-compat` (браузерные API против browserslist) + react-hooks НЕ здесь (полный канон-набор — стори 8.2, не дублировать)
- [x] Task 4: Гейт (AC: 2, 3)
  - [x] `scripts/size-gate.mjs`: суммарный gzip JS в `dist/assets` ≤ 300\*1024; вывод таблицы ассетов; exit 1 при превышении
  - [x] Тот же скрипт (или сосед `no-cdn`): скан `dist/**/*.{html,css,js}` на `https?://` вне localhost — найдено → exit 1 со списком
  - [x] `package.json` scripts: `dev`, `build`, `preview`, `lint`, `gate` = `tsc -b && eslint . && vite build && node scripts/size-gate.mjs`
- [x] Task 5: Каркас шрифтов + фиксация отступления (AC: 3)
  - [x] `public/fonts/README.md` (1–2 строки: системный стек — канон ДС; сюда лягут woff2 казахской кириллицы, если реальный контур потребует)
- [x] Task 6: Проверка целиком
  - [x] Чистый прогон: `npm ci && npm run gate` зелёный; `npm run dev` поднимается, прокси отвечает (ручная проверка с бэком или curl-ом через dev-сервер)

### Review Findings

_Code review 2026-07-06 (bmad-code-review, Fable 5; слои: Blind Hunter / Edge Case Hunter / Acceptance Auditor; дифф 999a98d..6392562)._

- [x] [Review][Decision] Vite 8.1 / TS 6.0 вместо запиненных спекой Vite 7.x / TS 5.x — девиация задокументирована в Completion Notes, но обоснование донор-совместимости для 8.7 («донор React 19, TS5 — версии совместимы») с TS6 не перепроверено. **Решение Bratan 2026-07-06: даунгрейд до спеки** → vite 7.3.6 / typescript 5.9.3 / @vitejs/plugin-react 5.2.0, гейт зелёный (59.4/300 КБ). (auditor)
- [x] [Review][Decision] Dev-прокси без `changeOrigin: true` при удалённом `VITE_PROXY_TARGET` — спека предписывает `changeOrigin: false`, но при таргете на удалённый Django (двухмашинный сетап ноутбук+ВПС) уйдёт `Host: localhost:5173` → 400 DisallowedHost на каждый `/api`/`/ws` запрос. **Решение Bratan 2026-07-06: условный `changeOrigin`** — true только при не-localhost таргете (локальный кейс остаётся по спеке); regex-логика проверена на 6 кейсах. (blind+edge+auditor)
- [x] [Review][Patch] no-CDN гвард дырявый: protocol-relative `//host`, `ws://`/`wss://`, байпас `localhost\b` (`localhost.evil.com`), эвристика пропускает `fetch(`/`new URL(`/`srcset=`/верхний регистр `SRC=`, сканируются только `.html|.css|.js` [frontend/scripts/size-gate.mjs:48-57] (blind+edge+auditor) — закрыто: точное сравнение хоста, +wss/protocol-relative, контексты srcset/JSON-ключи/fetch/new URL/WebSocket/xhr.open, /i-флаг, +svg/webmanifest/json/mjs/cjs; 8 байпас-фикстур ловятся, license/строки react.dev не флагуются
- [x] [Review][Patch] Корневой `.gitignore` (`lib/`, `build/`) молча проглотит `frontend/src/lib/` — каноничное место shadcn-utils для вендоринга донора в 8.7; воспроизведено `git check-ignore` [.gitignore:11,17] (edge) — закрыто негейтом `!frontend/**/lib/`+`!frontend/**/build/`; проверено в обе стороны (Backend/lib всё ещё игнорируется)
- [x] [Review][Patch] size-gate: 0 JS-файлов = вакуумный pass (stale/зачищенный dist → exit 0 без единого ассета); `.mjs`/`.cjs` не считаются бюджетом [frontend/scripts/size-gate.mjs:29-45] (edge) — закрыто: guard `jsFiles.length === 0` → exit 1, фильтр `\.(js|mjs|cjs)$`
- [x] [Review][Patch] tsconfig `lib: ES2023` при таргете FF100: `findLast` (FF104+)/`toSorted` (FF115+) проходят весь гейт (tsc+esbuild+compat) и падают TypeError в рантайме; заодно нет `DOM.Iterable` (`for..of` по NodeList → TS2488) [frontend/tsconfig.app.json:5] (edge+blind) — закрыто: target/lib ES2022 + DOM.Iterable, комментарий-обоснование в tsconfig
- [x] [Review][Patch] eslint не покрывает `scripts/size-gate.mjs` и `eslint.config.js` — нет конфиг-блока для `*.{js,mjs}`, гейт-скрипт сам вне гейта качества (проверено живым прогоном) [frontend/eslint.config.js:11,19] (blind+edge) — закрыто блоком `**/*.{js,mjs}` (js.recommended + node-globals); probe-файл с ошибкой ловится
- [x] [Review][Patch] `frontend/README.md` — стоковый шаблон про несуществующий Oxlint/`.oxlintrc.json`; не описывает реальное: `gate`, бюджет 300КБ, `VITE_PROXY_TARGET`, FF100 [frontend/README.md] (blind+auditor) — закрыто: переписан под реальный сетап (команды, гейт, прокси, Node, структура ARCH-FE-013)
- [x] [Review][Patch] `.gitignore` фронта не игнорирует `.env`/`.env.*` при том, что `vite.config.ts` читает env через `loadEnv` — первый же `.env` с внутренними хостами контура попадёт в git [frontend/.gitignore] (blind) — закрыто: добавлены `.env`/`.env.*`
- [x] [Review][Patch] `public/fonts/README.md` с внутренним путём репо (`.design-sync/conventions.md`) копируется в деплой-артефакт `dist/fonts/README.md` — нейтрализовать содержимое, сам файл предписан AC3 [frontend/public/fonts/README.md] (blind+edge) — закрыто: содержимое нейтрализовано, dist проверен grep-ом
- [x] [Review][Defer] Корневой quality-bar (`make gate`) не включает фронтовый гейт — `npm run gate` существует только внутри `frontend/` и ниоткуда не вызывается [Backend/VAPS/Makefile:31] — deferred, wiring корневого гейта/CI — отдельная стори (blind+edge)

## Dev Notes

### Архитектурные гварды (обязательны, источник — architecture.md Decision Register)

- **ARCH-FE-013**: `app/ features/ shared/`; features/A → features/B бан; shared → features бан. В этой стори только СОЗДАТЬ каркас; enforcement (eslint-boundaries) — стори 8.2.
- **ARCH-FE-014 (финал-2, ревизия 2026-07-04)**: вид = донорские shadcn-компоненты + токен-классы; **preflight ON**; styled-components/emotion бан. В этой стори Tailwind ещё НЕ ставится (лендинг Tailwind+токенов донора — 8.7); не тащить его «заодно».
- **ARCH-FE-010**: стейт-канон (Query/URL/useState) — здесь не трогается, но НЕ добавлять никаких стейт-библиотек в scaffold.
- **Чёрный список навсегда**: MUI, Vuetify, AG Grid, Handsontable, полный AntD, Quasar, zustand/redux/mobx, orval, styled-components/emotion.
- Vite 7: `build.target: 'firefox100'` — валидное esbuild-значение; минимальная нода `^20.19 || >=22.12` (на машине v24.13.0, `.nvmrc`=24).

### Границы стори (не расползаться)

- НЕТ: Tailwind/shadcn/токены (8.7), полные линтеры+boundaries+no-restricted-imports (8.2), кодоген схемы (8.3), apiClient/MSW (8.4–8.5), auth (8.6), Router/routes.ts/layout (8.7), print (8.8), vitest/RTL (появится с 8.4 для контрактных тестов).
- Бюджет ≤300КБ отражает ПУСТОЙ каркас с запасом на рост; сейчас реальный размер ~60–80КБ (react+react-dom gzip). Не «оптимизировать» бюджет под текущий размер.

### Донор и среда (фактура)

- Донор `Backend/PersonnelStatus/PersonalRecordFront`: React 19, Tailwind 3.4, TS5 — версии совместимы с планом вендоринга компонентов в 8.7; в scaffold из донора НИЧЕГО не копируется.
- Канон ДС (`.design-sync/conventions.md`): системный шрифт (Inter не подключать), токены придут со стилями донора в 8.7 — поэтому AC-3 фиксирует «шрифты из репо» как «ноль внешних запросов + каркас каталога», а не «woff2 в репо». Это осознанная трактовка «вендоринга шрифтов» из эпика; расхождение с architecture.md («вендоренные шрифты казахская кириллица») задокументировано в README каркаса — реальные файлы добавятся по требованию контура.
- Бэкенд dev: Django на `localhost:8000` (`/api/core|operations|audit|notifications`), WS `/ws/notifications/` (появится в E11 — прокси-правило закладываем сейчас).

### Ловушки

1. **Vite-шаблон кладёт entry в `src/main.tsx`** — переносим в `src/app/main.tsx` и правим `<script src>` в `index.html`, иначе ARCH-FE-013-каркас фиктивен.
2. **eslint-plugin-compat проверяет БРАУЗЕРНЫЕ API, не синтаксис** — синтаксис держит esbuild-таргет; не пытаться закрыть одно другим, нужны оба (AC-1 + AC-2).
3. **`tsc -b` требует композитных ссылок Vite-шаблона** (tsconfig.app/node) — не разваливать структуру tsconfig.
4. **size-gate по gzip, не по сырым байтам** — `zlib.gzipSync(readFileSync(f)).length`; сырые байты дадут ложное превышение.
5. **Прокси `/ws` без `ws: true` молча не апгрейдит** соединение — флаг обязателен уже сейчас, чтобы E11 не дебажил «почему не коннектится».
6. **`npm create vite` спрашивает интерактивно** при существующей папке — папки `frontend/` нет (проверено), но агенту запускать с флагами неинтерактивно.
7. **Не коммитить `package-lock.json` от чужого registry** — установка с дефолтного npm; lock коммитится (воспроизводимость контура).

### Project Structure Notes

- Путь: `frontend/` в КОРНЕ репо (architecture.md §дерево, строка `├── frontend/`), НЕ `Backend/`.
- Целевое дерево этой стори:
  ```
  frontend/
  ├── package.json  package-lock.json  vite.config.ts
  ├── tsconfig.json  tsconfig.app.json  tsconfig.node.json
  ├── eslint.config.js  .browserslistrc  .nvmrc  index.html
  ├── scripts/size-gate.mjs
  ├── public/fonts/README.md
  └── src/
      ├── app/main.tsx  App.tsx
      ├── features/.gitkeep
      └── shared/.gitkeep
  ```
- Гейт фронта живёт в `frontend/package.json` (`npm run gate`); интеграция в корневой/CI-гейт — вопрос стори 8.2 (когда появится полный линт-набор), здесь не решать.

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Story 8.1] — формулировка и AC эпика
- [Source: _bmad-output/planning-artifacts/architecture.md#Канон фронтенд-стека] — ARCH-FE-010…015
- [Source: _bmad-output/planning-artifacts/architecture.md#Frontend Architecture] — ARCH-FE-014 финал-2 (ревизия 2026-07-04)
- [Source: _bmad-output/planning-artifacts/architecture.md#дерево каталогов] — frontend/ структура, `.browserslistrc .nvmrc public/fonts/`
- [Source: .design-sync/conventions.md] — системный шрифт, токен-идиом (для 8.7, здесь только «не Inter»)
- [Source: _bmad-output/planning-artifacts/ux-designs/ux-PersonnelStatus-2026-06-19/prototype-briefs-claude-design.md] — прототипы (контекст эпика)

## Dev Agent Record

### Agent Model Used

Claude Fable 5 (claude-fable-5), bmad-dev-story, 2026-07-04.

### Debug Log References

- Red-фаза size-gate: без `dist/` падает с внятным сообщением; заодно поймал реальный баг — `URL.pathname` percent-кодирует кириллический путь репо (`Музыка`) → заменено на `fileURLToPath` (комментарий в скрипте).
- Red-фаза compat: канарейки `startViewTransition`/`navigator.share` НЕ ловятся (вне покрытия данных плагина); подтверждение работоспособности — `fetch` под `BROWSERSLIST="ie 11"` (ловится) и `new OffscreenCanvas()` под FF100 (`OffscreenCanvas is not supported in Firefox 100`) → конфиг корректен.
- Green: `npm ci && npm run gate` → tsc чист, eslint чист, build FF100, JS 58.1 KB gzip из 300 KB бюджета, no-CDN чисто.
- Прокси проверен вживую: Django поднят на :8001 (порт :8000 занят чужим контейнером из `/app`, отвечает 404 — не трогал), vite dev на :5273 (: 5173 тоже занят чужим) с `VITE_PROXY_TARGET=http://localhost:8001` → `GET :5273/api/core/employees/` вернул типизированный 403 `PERMISSION_DENIED` JSON бэка VAPS. Env-переопределение прокси работает; `/ws` — `ws: true` в конфиге (живой WS-хендшейк проверит E11, эндпоинта ещё нет).

### Completion Notes List

- **Отклонение от спеки (версии):** `npm create vite@latest` дал Vite **8.1** / TypeScript **6.0** / React 19.2.7 — новее июньского пина архитектуры (Vite 7). Оставлен актуальный stable: `build.target firefox100` поддержан, gate зелёный. Спека писала «Vite 7.x» — фактические версии зафиксированы здесь и в package.json.
- **Отклонение от спеки (линтер):** шаблон Vite 8 кладёт **oxlint**, не eslint. oxlint не поддерживает eslint-plugin-compat/boundaries (канон 8.1/8.2) → oxlint и `.oxlintrc.json` удалены, поставлен eslint 9 flat + typescript-eslint + eslint-plugin-compat. Шаблонного react-hooks-плагина в oxlint-варианте не было — канон-набор целиком в 8.2, как и планировалось.
- `changeOrigin` для прокси не выставлялся (дефолт false — как в спеке); Django на localhost принимает Host как есть.
- Порты 8000 и 5173 на этой машине заняты посторонними контейнерами (`/app`) — для dev-работы использовать `VITE_PROXY_TARGET` и `vite --port`; стоит знать при отладке «почему 404».
- AC-3 (no-CDN) реализован в `size-gate.mjs` эвристикой по атрибутам загрузки (`src=/href=/url(/@import/import(`) — лицензионные URL в комментариях бандла не дают ложных срабатываний.

### File List

- `frontend/package.json` — new (scripts: dev/build/lint/preview/gate; engines >=22.12)
- `frontend/package-lock.json` — new
- `frontend/vite.config.ts` — new (build.target firefox100; прокси /api, /ws ws:true; VITE_PROXY_TARGET)
- `frontend/index.html` — new (lang=ru, title PersonnelStatus, entry /src/app/main.tsx)
- `frontend/eslint.config.js` — new (flat: js+tseslint recommended + compat flat/recommended на src/**)
- `frontend/.browserslistrc` — new (firefox >= 100)
- `frontend/.nvmrc` — new (24)
- `frontend/.gitignore` — new (из шаблона Vite)
- `frontend/scripts/size-gate.mjs` — new (бюджет 300KB gzip JS + no-CDN скан; fileURLToPath из-за кириллицы в пути)
- `frontend/public/fonts/README.md` — new (системный стек — канон ДС; каркас под woff2)
- `frontend/src/app/main.tsx` — new (entry)
- `frontend/src/app/App.tsx` — new (заглушка «PersonnelStatus»)
- `frontend/src/features/.gitkeep` — new
- `frontend/src/shared/.gitkeep` — new
- `frontend/tsconfig.json`, `frontend/tsconfig.app.json`, `frontend/tsconfig.node.json` — new (шаблон, не менялись)
- `frontend/README.md` — new (шаблон Vite, не менялся)
- Удалено из шаблона: `.oxlintrc.json`, `src/App.css`, `src/index.css`, `src/assets/*`, `public/vite.svg`, `public/favicon.svg`, `public/icons.svg`

### Post-Review Fixes (2026-07-06)

Применены все 10 патчей ревью (2 из решений Bratan + 8 patch): даунгрейд до спеки
(vite 7.3.6 / typescript 5.9.3 / @vitejs/plugin-react 5.2.0 — package.json+lock),
условный `changeOrigin` (vite.config.ts), ужесточённый no-CDN гвард + guard вакуумного
pass (scripts/size-gate.mjs), target/lib ES2022+DOM.Iterable (tsconfig.app.json),
линт-блок `**/*.{js,mjs}` (eslint.config.js), переписан frontend/README.md,
`.env`/`.env.*` в frontend/.gitignore, негейт `!frontend/**/lib|build/` в корневом
.gitignore, нейтрализован public/fonts/README.md. Верификация: `npm run gate` зелёный
(59.4/300 КБ gzip), 8 no-CDN байпас-фикстур ловятся / react.dev-строки не флагуются,
git check-ignore в обе стороны, eslint-probe ловит ошибку, vite dev поднимается.
Устаревшие после фиксов Completion Notes выше (версии Vite 8/TS 6, changeOrigin=false)
— исторические, актуальное состояние здесь.
