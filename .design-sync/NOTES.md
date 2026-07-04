# design-sync NOTES — VAPS Design System (донор PersonalRecordFront)

Репо-специфичные гочи для будущих синхронизаций. Источник — донорское Next.js-приложение
`Backend/PersonnelStatus/PersonalRecordFront` (v0-генерированное, shadcn/ui new-york, Tailwind v3).

## Сборка
- Донор — приложение, НЕ библиотека: нет dist/. Вход бандла — рукописный баррель
  `Backend/PersonnelStatus/PersonalRecordFront/design-sync.entry.ts` (коммитится). Добавляешь
  компонент в синк → добавь экспорт в баррель И пин в `componentSrcMap`.
- НЕ передавать `--entry package.json` — resolveDistEntry возьмёт его как реальный вход и соберёт
  пустой 4КБ-бандл. `cfg.entry` указывает на баррель.
- У донора есть `lib/` → без `srcDir: "components"` конвертер взял бы `lib/` как source root.
- Дискавери через полное перечисление в `componentSrcMap` (у донора нет .d.ts-дерева с компонентами;
  content-scan срабатывает только при ПУСТОМ списке — пины его отключают). Пины = исчерпывающий список.
- Установка донора: pnpm (pnpm-lock.yaml новее package-lock.json). Существующий npm-shaped
  node_modules pnpm сносит только с TTY → запускать `CI=true pnpm i --frozen-lockfile`.
  Build-скрипты @sentry/cli и sharp игнорируются — для синка не нужны.
- CSS: Tailwind компилируется родным конфигом донора через buildCmd (см. config). Content включает
  `.design-sync/previews/**` — после правки превью с новыми утилити-классами перекомпилируй
  .ds-tailwind.css (buildCmd из донорской папки), затем полный package-build.
- Render-check: кеш ~/.cache/ms-playwright имеет chromium 1194/1208/1223/1228; донорский
  playwright 1.57 пинит 1200 (нет в кеше) → в .ds-sync ставится playwright@1.61.0 (пинит 1228).
  Также в .ds-sync нужен typescript, иначе .d.ts-проверка скипается.

## Квирки донора (воспроизводим честно, не «чиним»)
- Шрифт: layout.tsx грузит Inter/JetBrains Mono через next/font и ставит переменные
  --font-inter/--font-mono, но НИКТО их не применяет: body = font-sans = системный стек Tailwind.
  Реальный рендер донора — системный шрифт; бандл это воспроизводит. [FONT_MISSING] не фajerится — верно.
- alert.tsx использует Tailwind-v4-синтаксис `calc(var(--spacing)*4)` в v3-проекте — переменная
  не определена и в самом доноре; рендер деградирует одинаково там и тут. Не чинить.
- Токены `--status-bg`/`--status-text` referenced-but-undefined (ниже порога валидатора) — идут из
  статусных стилей features/; в доноре ставятся инлайном в рантайме.
- Radix-переменные (--radix-select-trigger-*, --radix-toast-swipe-*) инжектятся в рантайме — шум валидатора.

## Превью
- Импорт в превью: `from "my-v0-project"` (имя пакета донора). lucide-react и @/-алиасы резолвятся.
- Контент превью — русский, домен кадрового учёта (статусы «На месте/Отпуск/Командировка/Больничный»).
- Статусная палитра Badge — safelist донорского tailwind.config.js: bg-<color>-100/text-<color>-800.
- `preview-rebuild.mjs` НЕ перекомпилирует Tailwind: превью ограничены классами, уже лежащими в
  ds-bundle/_ds_bundle.css; новые классы появляются только после buildCmd + package-build.
  Проверка класса grep-ом: помни про экранирование точки (`gap-1\.5` — grep "gap-1.5" даёт
  ложный «нет»).
- aria-invalid: донор собирает Tailwind v3, где aria-invalid не в дефолтных вариантах, а классы
  shadcn написаны под v4 → invalid-состояния выпадали из CSS. Реализовано заявленное исходниками
  поведение через обёртку `.design-sync/tailwind.ds.config.js` (buildCmd указывает на неё).
  В самом доноре это латентный баг — aria-invalid поля не красятся и в проде.
- framer-motion в капче (StatsCards): entry-анимация не доигрывается → в превью скоуп-`<style>` с
  `opacity:1!important; transform:none!important` (НЕ tailwind-классы). MotionGlobalConfig из
  превью не работает (dual instance framer в превью-бандле и _ds_bundle.js). JS-счётчик
  AnimatedNumber ловится на ~80% значения с джиттером ±1–3 — принято (числа правдоподобны);
  known render warn.
- Капча column-mode всегда 900x700 (viewport-override читается только в single-mode); высокий
  контент — обёртка `style={{zoom: 0.6}}` (StatsCards).
- Radix статические паттерны: `open` на корне оверлея; DropdownMenu `modal={false}`; Select
  показывает выбранное в закрытом триггере (defaultValue + items в SelectContent); Checkbox
  defaultChecked рендерит indicator; Tooltip донора без Portal (нужен запас сверху);
  ToastProvider>Toast(open)+ToastViewport.
- Textarea: `field-sizing-content` не поддержан капчей → явный rows={4}.
- Label peer-disabled: label ПОСЛЕ peer-элемента в DOM, Input с className="peer".
- Битые <img> в капче: donor `/placeholder.svg` 404-ит → data:image/svg+xml URI.
- ThemeToggle: обёртка ThemeProvider (next-themes) attribute="class" defaultTheme="light"
  enableSystem={false}; mounted-гвард в капче проходит.
- Calendar: react-day-picker v9, `locale={ru}` (date-fns) прокидывается; фиксировать month и
  selected для детерминизма.
- Донорский баг (не чинить в превью): цвета юнитов орг-структуры из lib/api.ts:1253 содержат
  несуществующие шейды (via-green-150 и т.п.) — градиент рендерится без via-стопа, как и в проде.
- --status-bg/--status-text живут в features/employee-status-update/*; OrgNode их не читает —
  статусные цвета орг-дерева передаёт renderEmployee-колбэк вызывающего (OrgChart.tsx:37).

## Known render warns
Нет. Финальный validate первого синка (2026-07-03): 23/23 previews render cleanly, 0 предупреждений.
Любой warn на ресинке — новый, разбирать.

## Re-sync risks (что может молча протухнуть)
- `.ds-tailwind.css` — генерат, в gitignore. На свежем клоне СНАЧАЛА buildCmd (из папки донора),
  потом package-build, иначе CSS будет отсутствовать/протухнет.
- Превью OrgNode реплицирует statusColors/renderEmployee из OrgChart.tsx:37 — если донор поменяет
  маппинг, превью молча разойдётся с приложением. Сверять при изменениях orgstructure.
- Превью StatsCards несёт инлайн-объект stats по интерфейсу stats-cards.tsx — смена формы пропсов
  сломает компиляцию превью (это заметно: floor card + `! preview build failed`).
- `tailwind.ds.config.js` require-ит донорский tailwind.config.js по относительному пути; если донор
  переедет на Tailwind v4 (CSS-конфиг) или переместит конфиг — обёртку пересмотреть (aria-invalid
  в v4 станет дефолтом и обёртка не нужна).
- Скриншоты StatsCards недетерминированы по числам (AnimatedNumber ловится на ~80% значения,
  джиттер ±1–3) — render hash от исходников, чурна верификации нет; на глазах не пугаться.
- Системный шрифт — осознанное решение (донор грузит Inter, но не применяет). Если донор начнёт
  реально применять Inter — пересмотреть fonts (появится [FONT_MISSING]).
- Playwright: маппинг версий к кешу chromium (1.61.0↔1228) может протухнуть при обновлении кеша.
- Частично верифицировано: hover/drag-состояния статически не рендерятся и не проверялись;
  открытый список Select не показан (закрытых состояний хватило).
