---
baseline_commit: dcf5ec421ef8a4a299ba0a86f81d041a620c374e
---

# Story 8.7: Роутер, routes.ts и layout

Status: done

> **Контекст запуска:** седьмая стори E8; baseline диффа: `dcf5ec4` (8.6 закоммичена целиком).
> Портал получает лицо: полная карта маршрутов константами в `routes.ts` + линт-ужесточение
> ARCH-FE-012, Tailwind v3 + токены донора, вендоренные shadcn-компоненты (ds-bundle),
> каркас сайдбар+шапка по прототипу «Дашборд расхода персонала», роль-фильтрованная навигация
> на guards 8.6. Стори чисто фронтовая — `Backend/**` не трогается вовсе.
> **Решения (создано в #YOLO-прогоне 2026-07-07):** Q1–Q5 = дефолты Д1–Д9, активны;
> подтвердить у Bratan при запуске dev-story.

## Story

As a разработчик,
I want полную карту маршрутов портала константами в `src/shared/routes.ts` (с линт-баном строковых literal-путей), Tailwind-лейаут с токенами донора, вендоренные донорские shadcn-компоненты в `shared/ui` и каркас AppLayout (роль-фильтрованный сайдбар + шапка по прототипу) вокруг `<Outlet/>`,
so that навигация и вид канонизированы механически (ARCH-FE-012 линтом, ARCH-FE-014 донор-токенами), оператор видит только доступные ему разделы (UX-спайн L52, роль-фильтрованный сайдбар), и все экраны E9/E10 стартуют внутри готового каркаса без изобретения вида.

## Acceptance Criteria

1. **Given** `src/shared/routes.ts`, **Then** он содержит полную карту разделов пилота по UX L59-68: `login: '/login'`, `home: '/'` (Дашборд «Расход»), `employees: '/employees'`, `dailyExpense: '/daily-expense'`, `organization: '/organization'`, `reports: '/reports'`, `audit: '/audit'` — и `NAV_SECTIONS` (маршрут + русская подпись + lucide-иконка + код права) для сайдбара; `/admin/*` в карту НЕ входит (Д5).
2. **Given** строковый literal-путь в `navigate('/x')`, `<Link to="/x">`, `<Navigate to="/x">` или `<Route path="/x">` вне `routes.ts`, **Then** eslint красный (no-restricted-syntax; ужесточение ARCH-FE-012 «ревью-правило → линт», обещано в 8.6); **Given** те же места с константами `ROUTES.*`, **Then** линт зелёный (негативный контроль); краснота и негативный контроль доказаны фикстурами lint-canon с обновлённым счётчиком финального лога.
3. **Given** `npm run build`, **Then** CSS собран Tailwind **v3.4.x** (НЕ v4 — v4 требует FF128+, целевой браузер FF100), preflight ON, токены донора `:root`/`.dark` скопированы вербатим из `ds-bundle/_ds_bundle.css` в `src/index.css`, семантические классы (`bg-background`, `text-foreground`, `bg-sidebar`, …) работают; в разметке 8.7 нет ни одного сырого hex-цвета и не-токенного цвета (ARCH-FE-014).
4. **Given** `src/shared/ui/`, **Then** в нём вендорены донорские shadcn-компоненты (канон new-york, сверка пропсов/вариантов с `ds-bundle/components/*/**.prompt.md`): `Button`, `Avatar`, `DropdownMenu`, `Separator`, `Card`, `Input`, `Label` (7 штук — ровно то, что использует каркас+логин; Badge и прочие — со своими экранами) + `cn()` в `src/shared/lib/cn.ts`; barrel-index НЕ создан (скан lint-canon); Button отдаёт варианты default/secondary/outline/ghost/link/destructive и size sm/default/lg/icon (prompt.md донора).
5. **Given** авторизованный пользователь на любом маршруте портала, **Then** рендерится AppLayout: сайдбар слева (лого-заглушка «PS» + «PersonnelStatus», разделы по прототипу: Дашборд · Управление персоналом · Расход дня · Подразделения · Отчёты · Аудит; активный раздел подсвечен токеном `sidebar-accent` через `NavLink`) и шапка (справа колокольчик-заглушка disabled и блок пользователя: `Avatar` + `DropdownMenu` с пунктом «Выйти» → `logout()` из 8.6 → редирект на `/login` реактивно через RequireAuth); контент раздела — в `<Outlet/>`.
6. **Given** пользователь без права раздела (нет кода и нет `*`), **Then** раздел скрыт из сайдбара (фильтрация по `usePermissions().hasPermission`), а прямой заход по URL упирается в `RequirePermission` («Доступ запрещён», механика 8.6); **Given** право или wildcard `*`, **Then** раздел виден и открывается. Карта гейтов: `/` и `/employees` и `/organization` → `status.view`; `/daily-expense` → `daily_report.mark_update`; `/reports` → `daily_report.generate`; `/audit` → `audit.view` (коды — из seed_operations, дословно).
7. **Given** маршруты разделов, **Then** каждый рендерит заглушку-страницу в card-языке (H1 раздела + подпись «Экран приедет в E9/E10»), реальных экранов НЕТ (границы стори); существующие потоки 8.6 (login → redirect, 401 → logout, guards) не сломаны — все тесты 8.6 зелёные без правок семантики.
8. **Given** `/login`, **Then** LoginPage одета в вендоренные компоненты (Card + Label + Input + Button, токен-классы), JWT-поле — `type="password"` (ревью-находка 8.6 №5); поведение и тесты 8.6 сохранены (Enter-submit, zod «ровно одно», `state.from`).
9. **Given** eslint, **Then** подключён `eslint-plugin-tailwindcss` v3.18.x (enforcement ARCH-FE-014) и краснота на не-токенный произвол (кастомный classname вне канона) доказана фикстурой; `prettier-plugin-tailwindcss` сортирует классы с TW v3-конфигом (проверено вживую, Ловушка 6).
10. **Given** чистый клон (`npm ci && npm run gate`), **Then** зелёный целиком: deps-gate (без новых банов), schema-check, tsc, eslint (boundaries для `shared/ui`/`shared/lib` чисты), lint-canon (новый счётчик), vitest (старые 99 + новые), vite build (target firefox100) + size-gate ≤300КБ JS gzip; новый размер бандла зафиксирован в Completion Notes.

## Tasks / Subtasks

- [x] Task 1: Зависимости (AC: 3, 4, 9)
  - [x] `npm i tailwindcss@^3.4.19 postcss autoprefixer class-variance-authority@^0.7.1 clsx@^2.1.1 tailwind-merge@^2.6.1 lucide-react@^1.23.0 @radix-ui/react-slot@^1.3.0 @radix-ui/react-avatar@^1.2.2 @radix-ui/react-dropdown-menu@^2.1.20 @radix-ui/react-separator@^1.1.11` (версии registry 2026-07-07); dev: `eslint-plugin-tailwindcss@^3.18.3`
  - [x] ЗАПРЕЩЕНО: `tailwindcss@4`, `@tailwindcss/vite` (v4-only), `tailwind-merge@3` (для TW4), `eslint-plugin-tailwindcss@4` (peer TW4), `tw-animate-css`, `react-day-picker` (не нужен до Calendar-стори) — см. Ловушку 1
  - [x] Убедиться: deps-gate/banned-packages не задеты (radix/CVA/lucide не в бан-листе — проверить на baseline)
- [x] Task 2: Tailwind-фундамент (AC: 3)
  - [x] `tailwind.config.js`: `content: ['./index.html', './src/**/*.{ts,tsx}']`, `darkMode: 'class'`, theme.extend.colors — семантические имена на `hsl(var(--…))` по конвенции shadcn v3 (background/foreground/card/popover/primary/secondary/muted/accent/destructive/border/input/ring + `sidebar: {DEFAULT, foreground, primary, 'primary-foreground', accent, 'accent-foreground', border, ring}`), `borderRadius` от `var(--radius)`; шрифт НЕ переопределять (системный стек, README ds-bundle: «Inter НЕ подключать»)
  - [x] `postcss.config.js`: `{ plugins: { tailwindcss: {}, autoprefixer: {} } }` (TW v3-путь; НЕ @tailwindcss/vite)
  - [x] `src/index.css`: `@tailwind base/components/utilities` + блок токенов `:root`/`.dark` **вербатим** из `ds-bundle/_ds_bundle.css` L3173-3245 (34 переменные light + 32 dark, hsl-каналы; `--chart-*` тоже копировать — придут с дашбордом E10); `body { @apply bg-background text-foreground; }` — единственный легальный `@apply` (в index.css, ARCH-FE-014)
  - [x] Импорт `../index.css` в `src/app/main.tsx`; preflight ON — прогнать vitest: тесты 8.4–8.6 style-agnostic (RTL по ролям/тексту), падений быть не должно
- [x] Task 3: `src/shared/lib/cn.ts` (AC: 4)
  - [x] `export function cn(...inputs: ClassValue[]) { return twMerge(clsx(inputs)) }` — слот `shared/lib` назван каноном (L554-555); БЕЗ barrel-index
- [x] Task 4: Вендоринг shadcn-компонентов в `src/shared/ui/` (AC: 4)
  - [x] Источник кода: канонические shadcn/ui **new-york** TSX (Tailwind v3-стиль, hsl-токены) — ds-bundle `.jsx` НЕ копировать (это re-export-заглушки `window.VapsUI`, не исходники; Ловушка 2); shadcn CLI НЕ использовать (текущий генерит v4/oklch-стиль)
  - [x] Файлы: `Button.tsx` (CVA-варианты по prompt.md), `Avatar.tsx`, `DropdownMenu.tsx`, `Separator.tsx`, `Card.tsx`, `Input.tsx`, `Label.tsx`; импорты `cn` — из `../lib/cn` (shared→shared легально); PascalCase.tsx (канон TS-нейминга)
  - [x] Сверка каждого с `ds-bundle/components/general/<Имя>/<Имя>.prompt.md` (варианты/композиция) — расхождение = баг вендоринга; остальные 16 компонентов ds-bundle (вкл. Badge/Table/StatsCards/OrgNode) НЕ вендорить (по мере надобности в E9/E10, Д3)
- [x] Task 5: `src/shared/routes.ts` — полная карта + NAV (AC: 1)
  - [x] Расширить `ROUTES` до карты UX L59-68 (см. AC 1); `as const` сохранить; фабрик с параметрами в 8.7 нет (детальные маршруты приедут со своими сториями)
  - [x] `NAV_SECTIONS: readonly { route, label, icon, permission }[]` — Дашборд(`LayoutDashboard`,`status.view`) · Управление персоналом(`Users`,`status.view`) · Расход дня(`ClipboardList`,`daily_report.mark_update`) · Подразделения(`Network`,`status.view`) · Отчёты(`FileText`,`daily_report.generate`) · Аудит(`ScrollText`,`audit.view`); иконки — импорт из lucide-react в месте рендера ИЛИ компонентом в конфиге (решить по tsc/boundaries; конфиг в shared легален)
- [x] Task 6: `src/shared/ui/AppLayout.tsx` — каркас (AC: 5, 6)
  - [x] Композиция по прототипу (бриф 1): `<div class=flex>` сайдбар (`bg-sidebar text-sidebar-foreground border-r border-sidebar-border`, лого «PS» + «PersonnelStatus», nav из `NAV_SECTIONS.filter(s => hasPermission(s.permission))`, `NavLink` с активным `bg-sidebar-accent`) + правая колонка: шапка (`border-b`, справа: колокольчик `Button variant=ghost size=icon disabled` c aria-label «Уведомления (появятся в E11)», блок пользователя `Avatar` (инициалы/фолбэк) + `DropdownMenu` → пункт «Выйти») + `<main class="flex-1 …"><Outlet/></main>`
  - [x] «Выйти» = `useAuth().logout()` — навигацию делает RequireAuth реактивно (механика Д7-8.6, `window.location` запрещён); `useMe()`/`usePermissions` — единственный источник прав (ARCH-FE-010, ничего не копировать в state)
  - [x] Пока `['me']` грузится — сайдбар показывает скелет/пусто (индикация только состоянием Query, свои isLoading-флаги запрещены L472); при ошибке загрузки прав — не прятать шапку (logout должен оставаться доступным)
  - [x] НИКАКИХ h-dvh/text-wrap-утилит (FF101+, Ловушка 4) — h-screen/min-h-screen
- [x] Task 7: Разводка маршрутов в `src/app/App.tsx` (AC: 5, 6, 7)
  - [x] `<Route element={<RequireAuth><AppLayout/></RequireAuth>}>` (layout-route) → вложенные `<Route path={ROUTES.x} element={<RequirePermission permission="…"><SectionStub/></RequirePermission>}>`; Home-заглушка 8.1 умирает, `/` = заглушка «Дашборд „Расход“» за `status.view`
  - [x] Заглушки разделов — в `src/app/` (например `app/section-stubs.tsx`): `Card` + H1 раздела + `text-muted-foreground` «Экран появится в E9–E10» (фичи-папки НЕ создавать раньше их сторий; app→всё легально ARCH-FE-013)
  - [x] Экспорт `AppRoutes` сохранить (E2E-тесты оборачивают в MemoryRouter)
- [x] Task 8: Линт (AC: 2, 9)
  - [x] eslint.config.js: блок no-restricted-syntax для `src/**/*.{ts,tsx}` с `ignores: ['src/shared/routes.ts', 'src/**/*.test.{ts,tsx}']`: селекторы на literal в `JSXAttribute[name.name='to']` (и Literal, и JSXExpressionContainer>Literal), `JSXAttribute[name.name='path']`, `CallExpression[callee.name='navigate']` c первым аргументом-Literal; message со ссылкой на ARCH-FE-012; тесты исключены ОСОЗНАННО — существующие 8.6-тесты строят синтетический маршрут `path="/secret"` (guards.test.tsx L66, LoginPage.test.tsx L142), канон правит продукт-код, тестам синтетика легальна (Ловушка 9)
  - [x] eslint.config.js: `eslint-plugin-tailwindcss` flat-конфиг (`no-contradicting-classname` + `no-custom-classname` минимум; settings.tailwindcss.config → tailwind.config.js) для `src/**/*.{ts,tsx}`
  - [x] Prettier: убедиться, что `prettier-plugin-tailwindcss` сортирует с TW v3 (Ловушка 6): прогнать `npx prettier --check` на файле с намеренно перемешанными классами
- [x] Task 9: lint-canon (AC: 2, 9)
  - [x] Красные фикстуры: (а) `navigate('/literal')`, (б) `<Link to="/literal">`, (в) не-токенный класс/произвол для tailwind-плагина; негативные контроли: `navigate(ROUTES.home)` / `<Link to={ROUTES.home}>` зелёные
  - [x] Обновить счётчик финального лога (L310: было «13 красных фикстур + 6 негативных контролей»); фикстуры — паттерном `__canon_*_<PID>__`; barrel/TS-only-сканы не трогать (css в src легален — скан банит только js/jsx/mjs/cjs)
- [x] Task 10: LoginPage стилизация (AC: 8)
  - [x] Центрированная `Card` (max-w, `bg-background` фон страницы), `Label`+`Input` для полей, `Button` submit; JWT-поле `type="password"` (ревью 8.6 №5); DOM-семантика/имена полей/поведение НЕ менять — тесты 8.6 должны пройти без правок ассертов (правки только если ассерт цеплялся за отсутствие стилей)
  - [x] «Доступ запрещён»/`PERMISSIONS_ERROR_TEXT` (guards) НЕ переодевать — headless-строки останутся до экранов E10 (Д8); тексты — контракт тестов 8.6
- [x] Task 11: Тесты (AC: 2, 5, 6, 7, 8)
  - [x] `AppLayout.test.tsx` (jsdom, MemoryRouter + MSW): полный набор прав → все 6 разделов в сайдбаре; `['status.view']` → только Дашборд/Персонал/Подразделения; `['*']` → все; «Выйти» → credential очищен, уведён на `/login` (реальная Providers-композиция, прецедент 8.5/8.6)
  - [x] Разводка: прямой заход на `/daily-expense` без `daily_report.mark_update` → «Доступ запрещён» (RequirePermission на данных `['me']`); с правом → заглушка раздела
  - [x] LoginPage: существующие тесты зелёные; +ассерт `type="password"` у JWT-поля
  - [x] Механика тестов = уроки 8.5/8.6 дословно: `// @vitest-environment jsdom` первой строкой, `import '@testing-library/jest-dom/vitest'` per-file, явный `afterEach(cleanup)`, MSW-капчеры массивом
- [x] Task 12: Красные пробы и верификация (AC: 2, 6, 9, 10)
  - [x] Красные пробы вживую (Debug Log): (а) literal-путь в App.tsx → eslint красный; (б) сломать фильтрацию сайдбара (убрать filter) → тест «виден только доступный раздел» красный; (в) hex-цвет `text-[#ff0000]`/кастомный класс в AppLayout → tailwind-линт красный; (г) выкинуть RequirePermission с маршрута → тест разводки красный
  - [x] Чистые прогоны: `npm ci && npm run gate` зелёный; зафиксировать новый бандл (JS gzip; ожидание: 108 KB + radix/CVA/lucide ≈ +20–30 KB, бюджет 300 КБ держится с запасом); CSS-вес отметить в Completion Notes (size-gate считает только JS — Ловушка 7)

## Dev Notes

### Архитектурные гварды (обязательны, источник — architecture.md)

- **ARCH-FE-012** (L239/L761) — ядро стори: «React Router (plain Routes) + `src/shared/routes.ts` (все пути — константы/фабрики)»; enforcement «ревью-правило, ужесточить линтом» — ЭТА стори и есть ужесточение (обещание 8.6 AC-8). MUST NOT: TanStack Router (забанен banned-packages.mjs L29); literal-пути вне routes.ts.
- **ARCH-FE-014 финал-2, ревизия 2026-07-04** (L241/L763 + §Frontend Architecture L333): внешний вид — ТОЛЬКО донорские shadcn-компоненты + семантические токен-классы (`bg-card`/`text-foreground`/…); Tailwind-лейаут (flex/grid/gap/spacing) свободен; **preflight ON** (нужен shadcn); enforcement — eslint-plugin-tailwindcss. MUST NOT: runtime CSS-in-JS (styled-components/emotion/goober/@stitches/styled-jsx — бан-лист), inline style кроме рантайм-виртуализации, `@apply` вне index.css, произвольные hex вне токен-семейств. Прежний «Mantine-финал-1» ОТМЕНЁН — упоминания Mantine в DESIGN.md/EXPERIENCE.md читать как «донорский shadcn-эквивалент» (сами токены/плотность/палитра в силе).
- **ARCH-FE-013** (L240/L762): `shared/ui/` и `shared/lib/` — канонические слоты (L554-555), вписываются в boundaries без правки конфига; barrel-index запрещён (скан lint-canon). Заглушки разделов — в `app/` (app→всё), фич-папки не создавать раньше их сторий.
- **ARCH-FE-010** (L237/L759): легальны РОВНО 2 Context — Auth (есть, 8.6) и Theme. Theme в 8.7 НЕ вводится (Д4) — тёмные токены лежат в CSS готовыми, переключатель придёт отдельно. Права в сайдбаре — только `usePermissions()` из `useQuery(['me'])`, НИКАКОГО дублирования в state.
- **ARCH-FE-011/015**: в стори НЕТ API-работы — apiClient/errors/useApiMutation не трогаются; никакого парсинга Response.
- **UX-канон**: карта маршрут→право — EXPERIENCE.md L59-68 (таблица разделов); сайдбар/шапка — prototype-briefs L44-46 (лого «PS» + «PersonnelStatus», колокольчик, аватар; порядок разделов из брифа); «роль-фильтрованный сайдбар» — L52. Кликабельный прототип: claude.ai/design «Дашборд расхода персонала» (эталон композиции каркаса).
- **Компактная плотность рабочих таблиц** (текст стори эпика): в 8.7 таблиц НЕТ — фиксируется конвенцией: рабочие таблицы E9/E10 = плотные строки ВНУТРИ `Card`-контейнера (EXPERIENCE L46, DESIGN §Layout); каркас не должен навязывать разделам вертикальные отступы, съедающие плотность (`<main>` — нейтральный контейнер с умеренным padding).
- **СТОП-канон L33**: architecture.md молчит о версии Tailwind, механике вендоринга и составе каркаса → зафиксированы дефолтами Д1–Д9 с Q-листом (#YOLO-прецедент 8.4–8.6).

### Ловушки

1. **ГЛАВНАЯ — Tailwind v4 несовместим с FF100**: v4 требует Safari 16.4+/Chrome 111+/**Firefox 128+** (`@property`, `color-mix()`); целевой браузер — FF100 (`build.target: 'firefox100'`). Ставить строго **tailwindcss@^3.4.19** через PostCSS (`postcss.config.js`), НЕ `@tailwindcss/vite` (v4-only). Спутники по эпохе: `tailwind-merge@^2` (v3.x — под TW4), `eslint-plugin-tailwindcss@^3.18` (peer `tailwindcss: ^3.4.0`; v4.0.6 плагина — под TW4).
2. **ds-bundle `.jsx` — НЕ исходники**: это re-export-заглушки (`Object.assign(window, { Avatar: window.VapsUI.Avatar })`), реализация зарыта в компилированном `_ds_bundle.js`. Вендорить канонический shadcn/ui **new-york** TSX (v3-стиль, hsl-токены), сверяя вид/варианты с `.prompt.md` (реальный контракт: Button = default/secondary/outline/ghost/link/destructive × sm/default/lg/icon) — `.d.ts` бандла декларативно пустые (`[key: string]: unknown`), контрактом НЕ являются.
3. **shadcn CLI не использовать**: текущий `npx shadcn add` генерит Tailwind v4/oklch-стиль (`@theme`, `oklch(…)`) — не совпадёт ни с TW3-конфигом, ни с hsl-токенами донора. Компоненты пишутся руками по канону new-york (v3).
4. **CSS-фичи новее FF100 в утилитах**: `h-dvh`/`w-dvw` (dvh/dvw — FF101+), `text-wrap: balance` — НЕ использовать; `h-screen`/`min-h-screen`. eslint-plugin-compat проверяет только JS API — CSS-совместимость держится дисциплиной + target.
5. **Radix на FF100**: primitives (dropdown-menu, avatar) — стандартный DOM 2022 года, работают; но релизный смоук на архивном FF100 остаётся ручным (Playwright на FF100 невозможен — канон L260). В стори — статические гарантии.
6. **prettier-plugin-tailwindcss 0.8.0 × TW v3**: плагин стоит с 8.2, но Tailwind в проекте не было — сортировка не проверялась вживую. Проверить при установке (файл с перемешанными классами → `--check`); при несовместимости с v3-конфигом — даунгрейд плагина до последней 0.6.x (умеет v3 через авторезолв tailwind.config). Не верить на слово.
7. **size-gate считает только JS**: CSS-ассет (весь Tailwind-вывод) в бюджет 300КБ формально не входит — зафиксировать CSS-вес в Completion Notes; JIT-вывод по 8 компонентам + каркасу ожидается ~10–20 КБ gzip. Радикс/CVA/lucide лягут в JS (+20–30 КБ к 108).
8. **Headless-строки 8.6 — контракт тестов**: «Доступ запрещён», `PERMISSIONS_ERROR_TEXT` (guards.tsx) не переименовывать и не переодевать — на них стоят тесты 8.6; стилизация этих заглушек — вместе с экранами E10.
9. **no-restricted-syntax: границы правила**: сам `routes.ts` исключить (`ignores`), иначе константы-строки покраснеют; тест-файлы исключить — 8.6-тесты уже строят синтетический `path="/secret"` (guards.test.tsx L66, LoginPage.test.tsx L142; чинить их = трогать чужой контракт, а канон ARCH-FE-012 правит продукт-код); catch-all `path="*"`/NotFound в 8.7 НЕ вводить (не требуется картой; появится — константой). MSW-хендлеры (`testing/handlers.ts`) — строки URL вне JSX/navigate, селекторы их не заденут.
10. **preflight ON меняет глобальный вид**: margin/heading-сбросы затронут всё; тесты 8.4–8.6 — RTL по ролям/тексту (style-agnostic), падений не ждём, но прогнать vitest сразу после Task 2, до больших правок.
11. **Кириллица в пути репо**: правки node-скриптов (lint-canon) — `fileURLToPath(new URL(...))`, не `.pathname` (закреплённый урок 8.1–8.6).
12. **jsdom не парсит Tailwind**: тесты каркаса ассертят ПОВЕДЕНИЕ (наличие/отсутствие пунктов nav, редиректы, aria) и классы как строки при необходимости — не computed styles.

### Фактура фронта (ground truth на baseline dcf5ec4)

- **routes.ts**: зачаток `{ login, home }` + комментарий «линт-ужесточение — 8.7; полная карта — 8.7» (расширяем его).
- **App.tsx**: `AppRoutes` экспортируется (E2E-обёртка MemoryRouter), `/login` → LoginPage, `/` → RequireAuth→Home-заглушка «Каркас портала» (заглушка умирает в Task 7); `BrowserRouter` в `App`.
- **guards.tsx (8.6 + ревью)**: `RequireAuth` (credential-гейт ДО запросов, `state.from`), `RequirePermission` (на данных `['me']`; загрузка → Query-заглушка; отказ → «Доступ запрещён»; ошибка загрузки → `role="alert"` `PERMISSIONS_ERROR_TEXT`).
- **AuthContext**: `useAuth(): { userId, login, logout }`; `logout()` = clearCredential + removeQueries(['me']); `login()` тоже сбрасывает `['me']` (ревью-фикс 8.6 №1). Для JWT `userId` = null → фолбэк-инициалы в Avatar («??» / иконка User).
- **usePermissions**: `{ permissions: ReadonlySet | undefined, hasPermission(code), isLoading, error }`; wildcard `*` учтён внутри `hasPermission`.
- **eslint.config.js**: flat, tseslint.config(...); баны — из `scripts/banned-packages.mjs` (единый источник eslint+deps-gate); boundaries-матрица app/features/shared уже покрывает `shared/ui`/`shared/lib`; `__canon_*` фикстуры игнорируются глобально, самотест линтит их с `ignore: false`.
- **lint-canon.test.mjs**: счётчик L310 «13 красных фикстур + 6 негативных контролей»; сканы barrel-index (index.ts в src бан) и TS-only (только `.js/.jsx/.mjs/.cjs` — `.css` легален); фикстуры `__canon_*_<PID>__`.
- **vite.config.ts**: `build.target: 'firefox100'`, dev-прокси /api,/ws; vitest `environment: node` + jsdom per-file docblock.
- **index.html**: `lang="ru"`, title «PersonnelStatus»; `public/fonts/` — только README (шрифты вендорятся к печати 8.8; UI — системный стек, README ds-bundle).
- **gate-цепочка**: `deps-gate → schema-check → tsc -b → eslint → lint-canon → schema-check.test → vitest run → vite build → size-gate`; vitest 99/99 на baseline; бандл 108.0 KB gzip / бюджет 300 КБ (JS-only).
- **Версии registry 2026-07-07**: tailwindcss 3.4.19 (v3-хвост; 4.3.2 — бан по FF100), eslint-plugin-tailwindcss 3.18.3 / 4.0.6(TW4), tailwind-merge 2.6.1 / 3.6.0(TW4), CVA 0.7.1, clsx 2.1.1, lucide-react 1.23.0 (peer react ^19 ok), @radix-ui/react-slot 1.3.0, react-avatar 1.2.2, react-dropdown-menu 2.1.20, react-separator 1.1.11, postcss 8.5.16, autoprefixer 10.5.2.

### Донорская ДС (ds-bundle/ — источник вида)

- **Состав**: 23 компонента (20 general + OrgNode + StatsCards + ThemeToggle), стиль shadcn new-york, иконки lucide; `README.md` — конвенции (обязательные композиции: DropdownMenuItem только внутри корня и т.п.).
- **Токены**: `_ds_bundle.css` L3173-3245 — `:root` (34 переменные) + `.dark` (32), hsl-каналы (`--background: 0 0% 100%`), `--radius: 0.5rem`, ПОЛНЫЙ набор `--sidebar-*` (8 штук — сайдбар в токенах донора уже есть). Копировать вербатим, не «улучшать».
- **Идиом**: только токен-классы (`bg-card`, `text-muted-foreground`, `border-input`…); статусные пары `bg-<цвет>-100 text-<цвет>-800` (понадобятся в E9/E10, в 8.7 — не нужны); `cn(...)` для склейки; системный шрифт.
- **Sidebar-компонента в ДС НЕТ** — каркас собирается Tailwind-лейаутом на `--sidebar`-токенах по прототипу (бриф 1 L44-46: лого «PS»+«PersonnelStatus»; сайдбар: Дашборд(активен)/Управление персоналом/Расход дня/Подразделения/Отчёты/Аудит; шапка: колокольчик с бейджем + аватар). Колокольчик в 8.7 — disabled-заглушка БЕЗ фейкового счётчика (меньше мока = меньше лжи; центр уведомлений — E11).
- **DESIGN.md написан до ревизии 2026-07-04** (говорит «Mantine») — палитра/плотность/card-язык в силе, реализация — shadcn-эквиваленты; при конфликте видения — прототип claude.ai/design и ds-bundle новее.

### Дефолты (Д) и вопросы Bratan (Q)

- **Д1 (ГЛАВНЫЙ)**: Tailwind **v3.4.x**, не v4 — v4 требует FF128+, контур целится в FF100 (жёсткий NFR). Цена: legacy-мажор (v3 в maintenance). Альтернатива «v4 + свои фолбэки» отвергнута: официальная матрица браузеров v4 несовместима с контуром, самодельные полифиллы = второй источник истины о совместимости. Апгрейд — когда контур обновит браузер (событийный триггер, не сейчас).
- **Д2**: вендоринг = рукописный канон shadcn new-york (v3-стиль), сверенный с prompt.md бандла; НЕ копия `.jsx`-заглушек, НЕ shadcn CLI (генерит v4-стиль). ds-bundle остаётся эталоном вида, `frontend/src/shared/ui` — единственным источником кода компонентов.
- **Д3**: вендорим 7 компонентов (Button/Avatar/DropdownMenu/Separator/Card/Input/Label) — ровно то, что использует каркас+логин сейчас; остальные 16 (вкл. Badge — придёт со статус-ячейками E9) — по мере надобности своими сториями (не тащить мёртвый код).
- **Д4**: Theme Context/ThemeToggle НЕ в 8.7 (в прототипе шапки нет переключателя; ARCH-FE-010 разрешает Theme-контекст, но не требует его сейчас); `.dark`-токены лежат в CSS готовыми — включение темы = отдельная мелкая стори.
- **Д5**: `/admin/*` не в карте 8.7 — гейт «`*`/admin.roles (позже)» (UX L68), SPA-админа нет в пилотных эпиках; Django Admin живёт отдельно (ARCH: только справочники).
- **Д6**: заглушки разделов живут в `app/` (не в features/) — фича-папка появляется вместе с реальным экраном своей стори; переезд заглушки в фичу = часть той стори.
- **Д7**: гейт Дашборда `/` = `status.view` (карта UX L61) — пользователь без права (например INTEGRATION_USER c одним status.manage) увидит «Доступ запрещён»; это соответствует канону, не чинить в 8.7.
- **Д8**: LoginPage стилизуется здесь (обещание 8.6 «headless до 8.7» + ревью-находка №5 type=password); «Доступ запрещён»/Query-заглушки guards НЕ переодеваются (контракт тестов 8.6; их вид — с экранами E10).
- **Д9**: линт literal-путей = `no-restricted-syntax` в eslint.config.js (селекторы to/path/navigate) + красные фикстуры lint-canon; отдельный AST-скрипт не строится (тот же паттерн enforcement, что баны 8.2).
- **Q1 = Д1**: Tailwind v3.4 из-за FF100 — ок? (главная развилка стори)
- **Q2 = Д3**: вендорим 8 компонентов сейчас, остальные по надобности — ок, или сразу все 23?
- **Q3 = Д4**: без Theme/тёмной темы в 8.7 — ок?
- **Q4 = Д8**: стилизация LoginPage в этой стори (+type=password) — ок, или строго каркас?
- **Q5 = Д5/Д7**: /admin вне карты; `/` за status.view — ок?

### Границы стори (не расползаться)

- **НЕТ**: реальные экраны разделов (дашборд/KPI/оргдерево — E10, грид — E9, аудит-журнал — своя стори); Theme Context/тёмная тема (Д4); центр уведомлений и живой колокольчик (E11); печать/print.css (8.8); /admin (Д5); StatsCards/OrgNode/Table и остальные 15 компонентов ДС (со своими экранами); переодевание «Доступ запрещён»/ConflictDialog/toast (E10 / при первом использовании); донастройка retry `['me']` (кандидат из ревью 8.6 — только если UX-заметно, отдельным решением); шрифты в public/fonts (печать 8.8); breadcrumbs/страница 404 (не в карте UX).
- **НЕ трогать**: `Backend/**` (стори чисто фронтовая); `shared/api/**` (client/errors/useApiMutation/schema.d.ts); `shared/auth/**` семантику (guards/AuthContext/usePermissions — только ИСПОЛЬЗУЮТСЯ; правка только если тест-контракт требует стилевого класса — не требует); тесты 8.4–8.6 (кроме +ассерта type=password в LoginPage.test.tsx); gate-цепочку package.json (состав шагов); `scripts/{deps-gate,size-gate,schema-check}*.mjs`; `vite.config.ts` (Tailwind идёт через postcss.config.js, не через vite-плагин).

### Project Structure Notes

- Файлы create: `frontend/tailwind.config.js`, `frontend/postcss.config.js`, `frontend/src/index.css`, `frontend/src/shared/lib/cn.ts`, `frontend/src/shared/ui/{Button,Avatar,DropdownMenu,Separator,Card,Input,Label,AppLayout}.tsx`, `frontend/src/app/section-stubs.tsx` (+ тесты: `AppLayout.test.tsx`, при необходимости `app/routing.test.tsx` — вне лимита).
- Файлы modify: `frontend/src/shared/routes.ts`, `frontend/src/app/App.tsx`, `frontend/src/app/main.tsx` (импорт css), `frontend/eslint.config.js`, `frontend/scripts/lint-canon.test.mjs`, `frontend/src/features/auth/LoginPage.tsx` (+его тест — только новый ассерт type=password), `frontend/package.json` (+deps) + `package-lock.json` (генерируемый).
- **BMAD-размер**: 13 create + 7 modify (без генерируемых) — вариация против «≤5 файлов» осознанна: эпик определил 8.7 одной сторей «роутер+routes+layout» (карта, линт, токены, вендоринг и каркас связаны в один AC-флоу: линт требует карту, каркас требует токены+компоненты); 8 из 13 create — механический вендоринг по готовому эталону (7 компонентов + токены). Прецеденты 8.4–8.6 (#YOLO).
- `shared/ui/` и `shared/lib/` — канонические слоты (architecture L554-555), boundaries-матрица покрывает без правок; barrel-index не создавать.

### Previous Story Intelligence (8.6 + ревью)

- **Обещания 8.6, которые закрывает 8.7**: линт literal-путей (AC-8 8.6 «линт-ужесточение — 8.7»); полная карта маршрутов (Д3-8.6); layout/сайдбар/shadcn/Tailwind (граница 8.6); logout-кнопка в UI (механика есть — кнопка здесь); JWT-поле type=password (ревью №5); стилизация LoginPage (ARCH-FE-014-заметка 8.6).
- **Уроки механики тестов (переносить дословно)**: jsdom только per-file docblock (vitest 4 без environmentMatchGlobs); jest-dom per-file, НЕ в общий setup; явный `afterEach(cleanup)`; MSW-капчеры заголхов/запросов массивом; E2E-флоу через реальную Providers-композицию; MemoryRouter в тестах (BrowserRouter не даёт initialEntries).
- **Инцидент 8.6**: eslint-boundaries ловит и тест-файлы (guards.test.tsx в shared не может импортировать features) — тесты AppLayout, которым нужен LoginPage-флоу, размещать в app/ (app→всё) или без импорта фич.
- **401-механика (не дублировать в layout)**: handle401 в QueryCache/MutationCache уже глобален; «Выйти» просто зовёт logout() — RequireAuth уводит сам; `window.location` запрещён.
- **Git-паттерн конвейера**: 8.3→8.6 — коммит на стори (`feat(story-8.X): …`) после ревью; спека → dev-story → automate → review → commit (оркестратор 8, шаг create для 8.7).

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Story 8.7 (L1050-1056)] — текст стори и AC; L1042-1048 (8.6 — фундамент), L1058-1064 (8.8 — граница печати), L193-195 (Epic 8 + прототип-контракт), L248-254 (правила декомпозиции)
- [Source: _bmad-output/planning-artifacts/architecture.md L239/L761 (ARCH-FE-012), L241/L763 + L333 (ARCH-FE-014 финал-2, ревизия 2026-07-04), L240/L762 (FE-013), L237/L759 (FE-010), L248-251 (донорские shadcn: ds-bundle, CVA, копирование в shared/ui, чёрный список UI), L225 (React Router v7), L231 (build firefox100, бюджет, compat), L246 (формы/таблицы), L262 (keyboard path), L472 (Query-канон), L545-555 (структура frontend: app/features/shared, ui/, lib/, routes.ts), L33 (СТОП-канон)]
- [Source: _bmad-output/planning-artifacts/ux-designs/ux-PersonnelStatus-2026-06-19/EXPERIENCE.md L50-80 (IA: роль-фильтрованный сайдбар, карта маршрут→право L59-68, скоуп-гейтинг), L46 (card-постура + плотность рабочих таблиц), L202-203 (401/403)]
- [Source: _bmad-output/planning-artifacts/ux-designs/ux-PersonnelStatus-2026-06-19/DESIGN.md (палитра/плотность/card-язык; написан до ревизии — «Mantine» читать как shadcn-эквивалент), prototype-briefs-claude-design.md L1-16 (решение стека 2026-07-04), L44-46 (сайдбар+шапка), L130-138 (кликабельный прототип «Дашборд расхода персонала»)]
- [Source: ds-bundle/README.md (конвенции ДС: токен-семейства, композиции, системный шрифт), ds-bundle/_ds_bundle.css L3173-3245 (токены :root/.dark вербатим), ds-bundle/components/general/*/*.prompt.md (контракты вида), ds-bundle/components/general/Avatar/Avatar.jsx L1-2 (доказательство: .jsx = re-export-заглушки)]
- [Source: frontend/src/shared/routes.ts (зачаток), frontend/src/app/App.tsx (AppRoutes/Home-заглушка), frontend/src/shared/auth/{guards,AuthContext,usePermissions} (механика 8.6), frontend/eslint.config.js (матрица/баны/структура), frontend/scripts/lint-canon.test.mjs L94-99 (TS-only скан: css легален), L310 (счётчик 13+6), frontend/vite.config.ts (firefox100, vitest), frontend/scripts/size-gate.mjs (JS-only бюджет)]
- [Source: Backend/VAPS/apps/operations/management/commands/seed_operations.py L7-22 (коды прав: status.view, daily_report.mark_update, daily_report.generate, audit.view, admin.roles), L69 (VIEWER)]
- [Source: _bmad-output/implementation-artifacts/8-6-auth-подключение.md (Dev Notes/ловушки/ревью — предыдущая стори), 8-5-useapimutation-и-conflictdialog.md (уроки тест-механики)]
- Версии registry 2026-07-07 — см. «Фактура фронта»; совместимость Tailwind v4 × FF128+ — официальная матрица браузеров Tailwind v4 (compatibility docs)

## Dev Agent Record

### Agent Model Used

claude-fable-5 (Claude Fable 5) — bmad-dev-story, 2026-07-07

### Debug Log References

Красные пробы Task 12 — все четыре доказаны вживую и откачены:

- (а) literal-путь `path="/login"` в App.tsx → eslint красный `no-restricted-syntax` (26:19, message со ссылкой ARCH-FE-012); после отката зелёный.
- (б) сайдбар без фильтрации (`NAV_SECTIONS` вместо `.filter(hasPermission)`) → тест «только status.view → …; остальное скрыто» красный (1 failed | 7 passed); после отката 8/8.
- (в) кастомный класс `__my_custom_skin` в AppLayout → `tailwindcss/no-custom-classname` красный; после отката зелёный. NB: `text-[#ff0000]` плагином НЕ ловится — arbitrary value формально валидный TW-класс; hex-канон AC 3 держится ревью-дисциплиной (в разметке 8.7 сырых hex нет — проверено грепом), классовый произвол ловится линтом.
- (г) `/daily-expense` без `RequirePermission` → тест «прямой заход БЕЗ daily_report.mark_update → Доступ запрещён» красный (1 failed | 7 passed); после отката 8/8 + eslint чист.

Дополнительно доказано вживую до фикстур: инлайн-проба с 6 literal-каналами (path×3, to-Literal, to-ExpressionContainer, navigate) — 6 красных однолинейно + `no-custom-classname` седьмым.

### Completion Notes List

- Решения Q1–Q5 = дефолты Д1–Д9 (#YOLO-прогон 2026-07-07) реализованы как активные; подтверждение Bratan — на ревью: TW v3.4 из-за FF100 (Q1), 7 компонентов сейчас (Q2), без Theme/тёмной темы (Q3), LoginPage одета здесь + type=password (Q4), /admin вне карты и `/` за status.view (Q5).
- Версии легли точно по спеке: tailwindcss 3.4.19, tailwind-merge 2.6.1, eslint-plugin-tailwindcss 3.18.3, CVA 0.7.1, lucide-react 1.23.0, radix slot 1.3.0/avatar 1.2.2/dropdown-menu 2.1.20/separator 1.1.11; deps-gate чист (баны не задеты).
- Ловушка 6 проверена вживую: prettier-plugin-tailwindcss 0.8.0 сортирует классы с TW v3 (авторезолв tailwind.config.js; `bg-sidebar` из theme.extend распознан и отсортирован) — даунгрейд до 0.6.x НЕ понадобился.
- Вендоринг (нюансы сверх спеки): (1) донорский `Card` включает `CardAction`, у upstream он свёрстан grid-хедером с `:has()` — FF100 его не умеет (появился в FF121) → реализовано безусловным `grid-cols-[1fr_auto]` с явным `col-start-1` у Title/Description, вид тот же; (2) `DropdownMenuItem` поддерживает `variant="destructive"` (контракт prompt.md донора, новее v3-канона); Checkbox/Radio/Sub-части меню не вендорены (дух Д3 — по мере надобности); (3) `Label` — нативный `<label>` (в deps стори нет @radix-ui/react-label; контракт htmlFor/peer-disabled сохранён); (4) анимационные классы канона (animate-in/fade-in) опущены — tailwindcss-animate не в зависимостях стори.
- eslint: в boundaries добавлен `'boundaries/ignore': ['**/*.css']` — первый не-JS импорт в src (`app/main.tsx → ../index.css`) считался «unknown element»; сама матрица не тронута, `shared/ui`/`shared/lib` легли в неё без правок.
- Токены: в `_ds_bundle.css` фактически 33 переменные `:root` (спека считала 34) + 32 `.dark` — скопированы вербатим ВСЕ, включая `--chart-*` и полный набор `--sidebar-*`.
- Тест-механика: Radix DropdownMenu в jsdom потребовал per-file полифиллов (ResizeObserver для floating-ui, scrollIntoView, pointer-capture) в AppLayout.test.tsx — общий setup 8.4 не тронут; уроки 8.5/8.6 перенесены дословно (jsdom docblock, jest-dom per-file, afterEach(cleanup), реальная Providers-композиция).
- Тест 8.6 «реальный AppRoutes … открывает Home-заглушку» (ассерт `PersonnelStatus`) остался зелёным семантически честно: текст теперь — лого сайдбара AppLayout; в LoginPage текст «PersonnelStatus» осознанно НЕ внесён, чтобы не ослабить этот ассерт.
- Гейты: `npm ci && npm run gate` зелёный целиком; vitest **108** (99 baseline + 9 новых); lint-canon **16 красных + 8 негативных контролей**; бандл **149.4 KB gzip JS** (было 108.0; +41.4 — radix+floating-ui, CVA, lucide, компоненты; бюджет 300 КБ держится с запасом); CSS-ассет **13.46 KB raw / 3.54 KB gzip** (Ловушка 7: в size-gate не входит, зафиксировано здесь). _Финал после QA-прохода и ревью-фиксов: vitest **121** (108 + 13 QA), lint-canon **18+8**; гейт перепрогнан в ревью — зелёный, бандл/CSS без изменений._

### File List

Создано:

- frontend/tailwind.config.js
- frontend/postcss.config.js
- frontend/src/index.css
- frontend/src/shared/lib/cn.ts
- frontend/src/shared/ui/Button.tsx
- frontend/src/shared/ui/Avatar.tsx
- frontend/src/shared/ui/DropdownMenu.tsx
- frontend/src/shared/ui/Separator.tsx
- frontend/src/shared/ui/Card.tsx
- frontend/src/shared/ui/Input.tsx
- frontend/src/shared/ui/Label.tsx
- frontend/src/shared/ui/AppLayout.tsx
- frontend/src/app/section-stubs.tsx
- frontend/src/app/AppLayout.test.tsx
- frontend/src/app/app-layout.qa.test.tsx (QA-проход: 13 E2E — клик-навигация, полная карта гейтов, шапка при зависших/упавших правах, инициалы Avatar; см. tests/test-summary.md)

Изменено:

- frontend/src/shared/routes.ts (полная карта ROUTES + NAV_SECTIONS)
- frontend/src/app/App.tsx (layout-route RequireAuth→AppLayout, разводка за RequirePermission; Home-заглушка 8.1 умерла)
- frontend/src/app/main.tsx (импорт ../index.css)
- frontend/eslint.config.js (no-restricted-syntax ARCH-FE-012 — 5 селекторов dev + 3 template-селектора из ревью; eslint-plugin-tailwindcss; boundaries/ignore css)
- frontend/scripts/lint-canon.test.mjs (5 красных + 2 негативных фикстуры 8.7 — 3 dev + 2 ревью; счётчик 18+8)
- frontend/src/features/auth/LoginPage.tsx (Card/Label/Input/Button, токен-классы; JWT type=password)
- frontend/src/features/auth/LoginPage.test.tsx (+ассерт type=password — единственная правка тестов 8.6)
- frontend/package.json (+deps 8.7)
- frontend/package-lock.json (генерируемый)
- _bmad-output/implementation-artifacts/sprint-status.yaml (статус стори)

## Senior Developer Review (AI)

Ревьюер: Bratan (bmad-story-automator-review, Claude Fable 5), 2026-07-07. Исход: **Approve после авто-фиксов** — 0 CRITICAL, все находки HIGH/MEDIUM исправлены на месте.

Проверено против реальности: все 10 AC сверены с кодом; git-дифф против baseline `dcf5ec4` полностью совпадает с File List (единственное расхождение — QA-файл, см. №3); токены `:root`/`.dark` сверены вербатим с `ds-bundle/_ds_bundle.css` (33+32 — совпадают до символа); сырых hex в разметке 8.7 нет (греп); `npm run gate` прогнан целиком — зелёный (vitest 121/121, lint-canon 18+8, бандл 149.4 KB gzip JS = заявке, CSS 3.54 KB gzip = заявке).

Находки и что с ними сделано:

1. **[HIGH → исправлено] AC 2 частично: канал `path` не был доказан фикстурой.** AC 2 называет 4 канала (navigate / Link to / Navigate to / Route path); фикстуры lint-canon покрывали 2 селектора (navigate-Literal, to-Literal). `to` у Link и Navigate — один селектор, но `path` — отдельный, и его регресс (удаление селектора) прошёл бы гейт молча: живая проба Task 12 — одноразовая. Фикс: красная фикстура `route-literal.tsx` (`<Route path="/literal">`) + expectRule.
2. **[MEDIUM → исправлено] Обход ARCH-FE-012 шаблонными литералами без подстановки.** `navigate(` + "`" + `/literal` + "`" + `)`, `to={...}` и `path={...}` с TemplateLiteral проходили линт зелёными (доказано пробой до фикса: exit 0). Фикс: +3 селектора `TemplateLiteral[expressions.length=0]` в eslint.config.js, красная фикстура `template-literal.tsx`, негативный контроль в `nav-const.tsx` — шаблон С подстановкой `${ROUTES.*}` остаётся зелёным (бан не перетянут). Счётчик lint-canon: 16+8 → **18+8**.
3. **[MEDIUM → исправлено] File List неполон после QA-прохода.** `frontend/src/app/app-layout.qa.test.tsx` (13 E2E, QA-шаг автоматора) существовал на диске, но в File List отсутствовал; счётчик Completion Notes (vitest 108) устарел — фактически **121**. Фикс: File List дополнен, счётчики сверены с живым прогоном.
4. **[LOW — принято без правки] `Separator.tsx` — мёртвый код на сегодня**: каркас использует `DropdownMenuSeparator` (свой примитив), standalone-Separator никем не импортируется. Оставлен: AC 4 называет его поимённо в семёрке; первый потребитель — экраны E9/E10.
5. **[LOW — принято без правки] `text-[#ff0000]`-канал (arbitrary value) плагином не ловится** — честно задокументировано в Debug Log (в); hex-канон AC 3 держится ревью-дисциплиной. Симметрично границам enforcement 8.2.

## Change Log

- 2026-07-07 (ревью): авто-фиксы ревью — фикстура канала `path` (HIGH), бан template-литералов без подстановки в to/path/navigate + фикстура и негативный контроль (MEDIUM), File List дополнен QA-файлом `app-layout.qa.test.tsx` (MEDIUM); lint-canon 18+8; `npm run gate` перепрогнан целиком — зелёный (vitest 121/121, бандл 149.4 KB gzip JS). Status → done.
- 2026-07-07: Story 8.7 реализована целиком (Tasks 1–12): Tailwind v3.4.19 (PostCSS-путь, цель FF100) + токены донора вербатим (`:root`/`.dark`, preflight ON); `cn()`; 7 вендоренных shadcn-компонентов new-york v3 (сверка с prompt.md ds-bundle); полная карта ROUTES + NAV_SECTIONS; AppLayout — роль-фильтрованный сайдбар (UX L52) + шапка (колокольчик-заглушка, Avatar+DropdownMenu «Выйти»→logout()); разводка 6 разделов за RequirePermission (коды seed_operations); линт-ужесточение ARCH-FE-012 (no-restricted-syntax: to/path/navigate) и ARCH-FE-014 (eslint-plugin-tailwindcss); lint-canon 16+8; LoginPage одета + JWT type=password (ревью 8.6 №5). 9 новых тестов (vitest 108/108), 4 красные пробы вживую (откачены), `npm ci && npm run gate` зелёный целиком; бандл 149.4 KB gzip JS / бюджет 300, CSS 3.54 KB gzip. Status → review.
