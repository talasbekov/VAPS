# VAPS Frontend (PersonnelStatus)

Vite + React + TypeScript. Целевая среда — закрытый контур: Firefox ~100, 4 ГБ RAM, без CDN
и внешних запросов. Стек и структура — стори 8.1 (ARCH-FE-013).

## Команды

- `npm run dev` — dev-сервер; `/api/*` и `/ws/*` проксируются на Django
  (`http://localhost:8000`; цель переопределяется env `VITE_PROXY_TARGET`,
  для удалённого таргета прокси сам включает `changeOrigin`)
- `npm run build` — типы (`tsc -b`) + прод-сборка (`vite build`, target `firefox100`)
- `npm run lint` — eslint flat config: `eslint-plugin-compat` против `.browserslistrc`
  (`firefox >= 100`), `eslint-plugin-boundaries` (ARCH-FE-013), баны пакетов/каналов,
  `eslint-plugin-tailwindcss`
- `npm test` — vitest (юниты + RTL + MSW)
- `npm run test:e2e` — Playwright-смок (chromium, против прод-preview); **вне gate**,
  отдельная релизная дисциплина (Д4-8.8)
- `npm run generate:api` — регенерация `src/shared/api/schema.d.ts` из `Backend/VAPS/schema.yaml`
  (после `make schema` на бэке; ARCH-FE-011)
- `npm run gate` — фронтовый гейт (порядок фиксирован, быстрые проверки первыми):
  `deps-gate` (баны в lock) → `schema-check` (drift типов) → `tsc -b` → `eslint .` →
  `lint-canon.test` (самотест канона) → `schema-check.test` (самотест drift-гейта) →
  `vitest run` → `vite build` → `size-gate`

## Гейт (`scripts/size-gate.mjs`)

1. **Бюджет**: суммарный gzip всех JS-ассетов `dist/` ≤ 300 КБ; при превышении — exit 1
   с таблицей ассетов и размеров.
2. **no-CDN**: в `dist/` нет загрузок с внешних хостов (`http(s)://`, `ws(s)://`,
   protocol-relative `//host` вне `localhost`/`127.0.0.1`) в загрузочных контекстах
   (`src`/`srcset`/`href`/`url()`/`@import`/`import()`/`fetch`/`new URL`/`WebSocket`).

## Стилизация

Tailwind CSS **v3.4** через `postcss.config.js` — жёсткий пин: v4 требует FF128+
(`@property`, `color-mix()`), цель контура FF100. Спутники той же эпохи:
`tailwind-merge@^2`, `eslint-plugin-tailwindcss@^3.18`. Донорские shadcn-компоненты
(new-york, v3-стиль) вендорятся руками в `shared/ui` — shadcn CLI не использовать
(генерит v4/oklch). Печать — отдельный `print.css` под скоупом `.print-root`
(`features/print-forms/`), UI-классы на бумагу не попадают.

## Node

`.nvmrc` = 24; `package.json` `engines.node >= 22.12` (минимум Vite 7).

## Шрифты

Системный sans-стек (канон ДС), внешние шрифты не подключаются; каркас под вендоринг
woff2 — `public/fonts/`.

## Структура `src/` (ARCH-FE-013)

- `app/` — entry (`main.tsx`), корневой `App`, `providers.tsx`, section-заглушки,
  кросс-слойные тесты флоу
- `features/` — `auth/` (LoginPage), `print-forms/` (print-route + `print.css`)
- `shared/` — `api/` (client, errors, useApiMutation, `schema.d.ts`, MSW-testing),
  `auth/` (AuthContext, usePermissions, guards, credential), `lib/` (cn),
  `ui/` (вендоренные shadcn + AppLayout, ConflictDialog, toast), `routes.ts`

Границы: `features/A → features/B` и `shared → features/app` запрещены (eslint-boundaries);
barrel-index.ts — бан. Все пути маршрутов — константы `shared/routes.ts` (ARCH-FE-012, линт).
