# VAPS Frontend (PersonnelStatus)

Vite + React + TypeScript. Целевая среда — закрытый контур: Firefox ~100, 4 ГБ RAM, без CDN
и внешних запросов. Стек и структура — стори 8.1 (ARCH-FE-013).

## Команды

- `npm run dev` — dev-сервер; `/api/*` и `/ws/*` проксируются на Django
  (`http://localhost:8000`; цель переопределяется env `VITE_PROXY_TARGET`,
  для удалённого таргета прокси сам включает `changeOrigin`)
- `npm run build` — типы (`tsc -b`) + прод-сборка (`vite build`, target `firefox100`)
- `npm run lint` — eslint flat config + `eslint-plugin-compat` против `.browserslistrc` (`firefox >= 100`)
- `npm run gate` — фронтовый гейт: `tsc -b && eslint . && vite build && node scripts/size-gate.mjs`

## Гейт (`scripts/size-gate.mjs`)

1. **Бюджет**: суммарный gzip всех JS-ассетов `dist/` ≤ 300 КБ; при превышении — exit 1
   с таблицей ассетов и размеров.
2. **no-CDN**: в `dist/` нет загрузок с внешних хостов (`http(s)://`, `ws(s)://`,
   protocol-relative `//host` вне `localhost`/`127.0.0.1`) в загрузочных контекстах
   (`src`/`srcset`/`href`/`url()`/`@import`/`import()`/`fetch`/`new URL`/`WebSocket`).

## Node

`.nvmrc` = 24; `package.json` `engines.node >= 22.12` (минимум Vite 7).

## Шрифты

Системный sans-стек (канон ДС), внешние шрифты не подключаются; каркас под вендоринг
woff2 — `public/fonts/`.

## Структура `src/` (ARCH-FE-013)

- `app/` — entry (`main.tsx`), корневой `App`
- `features/` — фичи (пусто до 8.2+)
- `shared/` — переиспользуемое (пусто до 8.2+)
