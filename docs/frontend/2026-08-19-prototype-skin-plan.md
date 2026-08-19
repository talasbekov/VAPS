# Слой прототипа: план реализации

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Привести оформление PersonalRecordFront к виду прототипа Smart Жоспарлау — полотно, плотность таблиц, каркас — не меняя навигацию, маршруты и данные.

**Architecture:** Правки идут снизу вверх по слоям: токены → примитивы → общие компоненты → каркас → страницы. Палитра уже совпадает с прототипом дословно, поэтому меняются только геометрия, плотность и один недостающий цвет полотна. Каждая задача стережётся Playwright-пробой по **вычисленным стилям** на живом стенде — это единственный вид автотеста, который вообще способен поймать регресс оформления.

**Tech Stack:** Next.js 15.2.4 (App Router), React 19, Tailwind CSS 3.4.18, shadcn/ui на Radix, Playwright 1.56.

**Спека:** `docs/frontend/2026-08-19-prototype-skin-design.md`
**Базовый SHA:** `766638ca`
**Рабочий каталог всех путей:** `Backend/PersonnelStatus/PersonalRecordFront/`

---

## Global Constraints

Требования ниже действуют для **каждой** задачи плана.

**Сборка и версии**

- Tailwind собирается **3.4.18**, а слой `components/ui/*` сгенерирован под v4. **Запрещены** классы `shadow-xs`, `rounded-xs`, `outline-hidden`, `field-sizing-content` — в v3 они молча не генерируются, и правка выглядит применённой, не будучи применённой.
- Проверочная сборка **только** `NEXT_DIST_DIR=.next-build npx next build`. Голый `next build` травит `.next` работающего стенда и роняет :3106.
- Глобальные стили — только `app/globals.css`; никакого `styles/globals.css` в проекте нет (удалён коммитом `1cc83efe` до этой ветки, а не «мёртв, но существует» — прежняя формулировка была невакуумно неверна).
- `npm run lint` не работает: eslint в проекте не установлен, `next lint` падает с «ESLint must be installed». Не включать в шаги.

**Значения радиусов в этом проекте** (`--radius: 0.5rem`, `tailwind.config.js:93-96`)

| класс | реальный радиус |
|---|---|
| `rounded-sm` | 4px |
| `rounded-md` | 6px |
| `rounded-lg` | 8px |
| `rounded-xl` | 12px (дефолт Tailwind, не переопределён) |
| `rounded-full` | 999px |

**Текст и доступность**

- `--primary` и `--destructive` годятся как **заливка**, но не как буквы. Для текста брать `text-primary-ink` / `text-destructive-ink`.
- Литералы заголовков таблиц (`thead th`) **не менять** и регистр им **не задавать**: пины по `textContent` стоят в `e2e/tables-data.spec.ts:69,174,223,280` и `e2e/operations-analytics.spec.ts:256`. В исходнике прототипа на `th` нет `text-transform` — капс только у надзаголовков и групп сайдбара.
- Состав, порядок и названия пунктов меню, бренд «Проект Расход», маршруты — **не трогать**.

**Как гонять пробы**

```bash
cd Backend/PersonnelStatus/PersonalRecordFront
SMOKE_LIVE=1 npx playwright test --config=playwright.smoke.config.ts <файл> --reporter=list
```

- Стенд поднимается **снаружи**: Django `:8100`, `next dev -p 3106`. `webServer` в конфиге нет намеренно.
- Читать результат **`grep`-ом на `failed`/`✘`**, не `tail`-ом: хвост прячет падения.
- Учётка `admin/admin123`.
- Новую спеку обязательно добавлять в `testMatch` (`playwright.smoke.config.ts:22`) — иначе она не запустится и будет выглядеть зелёной.
- Прогонять только со своего порта :3106: соседний `next dev` делит `.next`.

**Рецепт перевода сырой `<table>` на примитив** (задачи 9-12)

```
<table ...>    → <Table>            import { Table, TableHeader, TableBody,
<thead>        → <TableHeader>              TableRow, TableHead, TableCell }
<tbody>        → <TableBody>           from "@/components/ui/table"
<tr>           → <TableRow>
<th>           → <TableHead>
<td>           → <TableCell>
```

Правила перевода:

1. Инлайн-`style` с `padding`/`font-size`/`border-bottom`/`background` у `th` и `td` **удалить целиком** — эти значения теперь даёт примитив.
2. `style={{ textAlign: 'center' }}` / `'right'` → `className="text-center"` / `"text-right"`.
3. `fontVariantNumeric: 'tabular-nums'` → `className="tabular-nums"`.
4. Смысловые цвета (`color: '#b91c1c'` и подобные) **сохранить**, переведя в токен: красный → `text-destructive-ink`, зелёный → `text-green-700`, синий → `text-primary-ink`, янтарный → `text-amber-700`.
5. Ширины колонок (`style={{ width: ... }}`) **сохранить** как есть.
6. Если вокруг `<table>` был свой `overflow-x-auto` — **снять**: `Table` уже оборачивает (`components/ui/table.tsx:8-11`), двойная обёртка даёт вложенный скролл.
7. Текст заголовков не менять ни на символ.

---

## Структура файлов

**Создаются**

| файл | ответственность |
|---|---|
| `e2e/prototype-skin.spec.ts` | сторож вычисленных стилей; растёт от задачи к задаче |
| `components/page-header.tsx` | надзаголовок + H1 + подпись + слот действий |
| `components/stat-card.tsx` | KPI-плитка: точка, лейбл, число, подпись |
| `components/navigation/breadcrumbs.tsx` | хлебные крошки для шапки |
| `components/filter-bar.tsx` | оболочка ряда фильтров единой высоты |

**Изменяются**

| файл | что |
|---|---|
| `app/globals.css:8-88,94` | токены `--canvas`, `--table-divider`, `--card` в тёмной; `body` на канвас |
| `tailwind.config.js:39-91` | цвета `canvas`, `table-divider` |
| `components/ui/table.tsx` | плотность и цвета `th`/`td`/`tr` |
| `components/ui/badge.tsx` | `rounded-full`, 11px/600 |
| `components/dashboard-layout.tsx:39,71-74` | снять `bg-background`, ширина отступа под сайдбар |
| `components/navigation/sidebar.tsx` | 256px, светлая шапка, компактные пункты |
| `components/navigation/header.tsx:50` | `bg-card` + крошки |
| `components/navigation/mobile-menu.tsx:47` | согласовать шапку с десктопной |
| 4 файла с зеброй | снять `odd:bg-muted/40` |
| 15 файлов с сырыми `<table>` | перевести на примитив |

---

## Task 0: База «до»

Выполняется **первой**, до единой правки кода. Её результат нужен каждой
последующей задаче: без базы «стало хуже» неотличимо от «было плохо» — в
проекте есть pre-existing падения.

**Files:**
- Create: `docs/frontend/skin-baseline.md` (список уже красных спек)

**Interfaces:**
- Consumes: ничего
- Produces: список базовых падений, на который ссылаются шаги «без новых падений» в задачах 2, 3, 5, 6, 7, 8, 10, 11, 12, 13, 15

- [ ] **Step 1: Убедиться, что стенд подняли вы, а не соседняя сессия**

```bash
ss -ltnp | grep -E ':(3106|8100)'
ps aux | grep -E "next dev -p 3106|manage.py runserver" | grep -v grep
```

Оба процесса должны идти **из этого чекаута**. Соседний `next dev` делит `.next`
и травит сборку. Django поднимать только с `settings.local_postgres`.

- [ ] **Step 2: Снять базовый прогон**

```bash
cd Backend/PersonnelStatus/PersonalRecordFront
SMOKE_LIVE=1 npx playwright test --config=playwright.smoke.config.ts \
  --reporter=list 2>&1 | tee /tmp/skin-baseline.log | grep -E "passed|failed"
grep -E "✘|failed" /tmp/skin-baseline.log
```

- [ ] **Step 3: Записать список красных спек**

Создать `docs/frontend/skin-baseline.md` с датой, SHA `766638ca`, числом
passed/failed и построчным списком уже красных тестов. Это единственный
документ, по которому потом судят «новое падение или старое».

- [ ] **Step 4: Снять базовые скриншоты**

12 маршрутов из Task 15 Step 2, в двух темах, ширины 1440 / 1024 / 375.
Складывать **в рабочий каталог**, а не в скретчпад: он сессионный и исчезнет.

- [ ] **Step 5: Коммит**

```bash
git add docs/frontend/skin-baseline.md
git commit -m "docs(frontend): база e2e до слоя прототипа"
```

---

## Task 1: Токены полотна и сторожевая проба

Корень «всё белое»: `--background` и `--card` равны в обеих темах, карточки не отделяются от полотна нигде. Лечится отдельным токеном канваса.

**Files:**
- Create: `e2e/prototype-skin.spec.ts`
- Modify: `app/globals.css` (строки 8, 51, 94), `tailwind.config.js` (блок `colors`), `components/dashboard-layout.tsx:39`, `playwright.smoke.config.ts:22`

**Interfaces:**
- Consumes: ничего
- Produces: CSS-переменные `--canvas`, `--table-divider`; классы Tailwind `bg-canvas`, `border-table-divider`; функция `signIn(page, username?, password?)` в `e2e/prototype-skin.spec.ts`

- [ ] **Step 1: Написать падающую пробу**

Создать `e2e/prototype-skin.spec.ts`:

```ts
/**
 * Сторож ОФОРМЛЕНИЯ, а не данных: ассерты идут по ВЫЧИСЛЕННЫМ стилям.
 *
 * 🔴 Проверять именно computed style, а не наличие класса. Класс `bg-canvas`
 * может стоять в разметке и при этом не генерироваться сборкой — ровно так в
 * этом проекте молча не работают 20 v4-классов в слое ui/*. Ассерт «класс
 * есть» был бы зелёным на неработающем оформлении.
 */
import { expect, test, type Page } from '@playwright/test'

const LIVE = process.env.SMOKE_LIVE === '1'
const APP = process.env.SMOKE_APP ?? 'http://localhost:3106'

async function signIn(page: Page, username = 'admin', password = 'admin123'): Promise<void> {
  const api = page.context().request
  const csrf = (await (await api.get(`${APP}/api/auth/csrf/`)).json()) as {
    csrfToken: string
  }
  await api.post(`${APP}/api/auth/callback/credentials/`, {
    form: { csrfToken: csrf.csrfToken, username, password, json: 'true' },
  })
}

test.describe(LIVE ? 'слой прототипа' : 'слой прототипа (скип: нет SMOKE_LIVE=1)', () => {
  test.skip(!LIVE, 'нужен живой стек: SMOKE_LIVE=1')

  test('полотно отличается от карточки в обеих темах', async ({ page }) => {
    await signIn(page)
    await page.goto(`${APP}/security-ops/command-center/`)
    await expect(page.getByRole('heading', { name: 'Командный центр' })).toBeVisible()

    const read = () =>
      page.evaluate(() => {
        const card = document.querySelector('[data-slot="card"]')
        if (!card) throw new Error('на экране нет ни одной карточки — ассерт был бы вакуумным')
        return {
          canvas: getComputedStyle(document.body).backgroundColor,
          card: getComputedStyle(card).backgroundColor,
        }
      })

    const light = await read()
    expect(light.canvas, 'светлая: полотно слилось с карточкой').not.toBe(light.card)

    await page.emulateMedia({ colorScheme: 'dark' })
    await page.evaluate(() => document.documentElement.classList.add('dark'))
    const dark = await read()
    expect(dark.canvas, 'тёмная: полотно слилось с карточкой').not.toBe(dark.card)
  })
})
```

- [ ] **Step 2: Внести спеку в `testMatch`, иначе она не запустится**

В `playwright.smoke.config.ts:22` дописать `'prototype-skin.spec.ts'` в конец массива `testMatch`.

- [ ] **Step 3: Прогнать и убедиться, что проба КРАСНАЯ**

```bash
cd Backend/PersonnelStatus/PersonalRecordFront
SMOKE_LIVE=1 npx playwright test --config=playwright.smoke.config.ts prototype-skin.spec.ts --reporter=list 2>&1 | grep -E "passed|failed|✘|✓"
```

Ожидание: **1 failed**, сообщение «светлая: полотно слилось с карточкой» — сейчас оба цвета `rgb(255, 255, 255)`.

Если проба зелёная — остановиться и разобраться: значит ассерт не достаёт до предмета.

- [ ] **Step 4: Добавить токены в светлую тему**

В `app/globals.css`, в блок `:root`, сразу после строки `--background: 0 0% 100%;`:

```css
  /* Полотно страницы. ОТДЕЛЬНЫЙ токен, а не перекрашенный --background:
     класс bg-background стоит в 93 местах и почти везде означает поверхность
     КОНТРОЛА (диалог, outline-кнопка, активная вкладка, нативный select), а не
     фон страницы. Тонировать их — испортить контролы. Значение снято из
     прототипа: body{background:hsl(210 40% 97.5%)}. */
  --canvas: 210 40% 97.5%;
  /* Линейки ВНУТРИ таблицы светлее внешней рамки — в прототипе это заметная
     часть «воздуха», через --border не выражается. */
  --table-divider: 210 40% 95%;
```

- [ ] **Step 5: Добавить токены в тёмную тему и развести карточку с полотном**

В блоке `.dark` заменить строку `--card: 222.2 47% 11%;` на:

```css
  /* Карточка на тон СВЕТЛЕЕ полотна. Раньше --card == --background, и в тёмной
     теме карточки не были видны вовсе. У прототипа тёмной темы нет — значения
     выведены, контраст проверен. */
  --card: 222.2 47% 13%;
```

и сразу после строки `--background: 222.2 47% 11%;` добавить:

```css
  --canvas: 222.2 47% 9%;
  --table-divider: 217.2 32.6% 20%;
```

- [ ] **Step 6: Завести классы Tailwind**

В `tailwind.config.js`, в `theme.extend.colors`, после строки `background: "hsl(var(--background))",`:

```js
        canvas: "hsl(var(--canvas))",
        "table-divider": "hsl(var(--table-divider))",
```

- [ ] **Step 7: Перевести `body` на канвас**

В `app/globals.css:94-96` заменить:

```css
  body {
    @apply bg-canvas text-foreground font-sans;
  }
```

- [ ] **Step 8: Убрать белую заливку, перекрывающую полотно**

В `components/dashboard-layout.tsx:39` заменить

```tsx
      <div className="flex min-h-screen bg-background">
```

на

```tsx
      {/* Без bg-*: полотно даёт body (--canvas), карточки всплывают над ним. */}
      <div className="flex min-h-screen">
```

- [ ] **Step 9: Прогнать пробу — должна позеленеть**

```bash
SMOKE_LIVE=1 npx playwright test --config=playwright.smoke.config.ts prototype-skin.spec.ts --reporter=list 2>&1 | grep -E "passed|failed|✘|✓"
```

Ожидание: **1 passed**.

- [ ] **Step 10: Убедиться, что контролы не потонировались**

```bash
SMOKE_LIVE=1 npx playwright test --config=playwright.smoke.config.ts forms-validation.spec.ts --reporter=list 2>&1 | grep -E "passed|failed|✘"
```

Ожидание: столько же passed, сколько до правки. Если появились падения — значит `bg-background` где-то означал полотно; чинить точечно этот файл, а не токен.

- [ ] **Step 11: Коммит**

```bash
git add app/globals.css tailwind.config.js components/dashboard-layout.tsx \
        e2e/prototype-skin.spec.ts playwright.smoke.config.ts
git commit -m "feat(ui): полотно отделено от карточки — токен --canvas

--background и --card были равны в обеих темах, карточки не отделялись от
фона нигде. Перекрашивать --background нельзя: из 93 вхождений bg-background
почти все означают поверхность контрола, а не полотно страницы.

Побочно: в тёмной теме карточки впервые стали видны (--card на тон светлее)."
```

---

## Task 2: Примитив таблицы

**Files:**
- Modify: `components/ui/table.tsx`, `e2e/prototype-skin.spec.ts`

**Interfaces:**
- Consumes: `--table-divider`, `bg-muted` из Task 1
- Produces: `<Table>`/`<TableHead>`/`<TableCell>` с плотностью прототипа; на них опираются задачи 3, 9-12

- [ ] **Step 1: Дописать падающую пробу**

В `e2e/prototype-skin.spec.ts`, внутрь `test.describe`:

```ts
  test('таблица набрана по плотности прототипа', async ({ page }) => {
    await signIn(page)
    await page.goto(`${APP}/security-ops/events/`)
    await expect(page.getByRole('heading', { name: 'Реестр ОМ' })).toBeVisible()
    await expect(page.locator('tbody tr').first()).toBeVisible()

    const shape = await page.evaluate(() => {
      const th = document.querySelector('thead th') as HTMLElement | null
      const td = document.querySelector('tbody td') as HTMLElement | null
      if (!th || !td) throw new Error('таблицы на экране нет — ассерт был бы вакуумным')
      const cs = getComputedStyle(th)
      return {
        thSize: cs.fontSize,
        thWeight: cs.fontWeight,
        thBg: cs.backgroundColor,
        thTransform: cs.textTransform,
        tdSize: getComputedStyle(td).fontSize,
        bodyBg: getComputedStyle(document.body).backgroundColor,
      }
    })

    expect(shape.thSize).toBe('11px')
    expect(shape.thWeight).toBe('600')
    expect(shape.tdSize).toBe('12.5px')
    // Шапка таблицы залита — но не тем же, чем полотно: иначе на белой карточке
    // она невидима.
    expect(shape.thBg).not.toBe('rgba(0, 0, 0, 0)')
    // 🔴 Регистр заголовков НЕ задаём: thead th пинится по textContent в пяти
    // местах e2e, а в исходнике прототипа text-transform на th нет.
    expect(shape.thTransform).toBe('none')
  })
```

- [ ] **Step 2: Прогнать — проба КРАСНАЯ**

```bash
SMOKE_LIVE=1 npx playwright test --config=playwright.smoke.config.ts prototype-skin.spec.ts --reporter=list 2>&1 | grep -E "passed|failed|✘|✓"
```

Ожидание: **1 passed, 1 failed**; в падении `thSize` — `14px` вместо `11px`.

- [ ] **Step 3: Переписать `TableHead`**

В `components/ui/table.tsx` заменить тело `TableHead`:

```tsx
function TableHead({ className, ...props }: React.ComponentProps<"th">) {
  return (
    <th
      data-slot="table-head"
      className={cn(
        // Значения сняты из прототипа: padding:10px 14px; font-size:11px;
        // font-weight:600; color:--muted-foreground; background:hsl(210 40% 98%).
        // Регистр НЕ задаётся: см. e2e/tables-data.spec.ts — заголовки пинятся
        // по тексту, а в прототипе text-transform на th нет.
        "text-muted-foreground bg-muted/50 h-auto px-3.5 py-2.5 text-left align-middle text-[11px] font-semibold whitespace-nowrap [&:has([role=checkbox])]:pr-0 [&>[role=checkbox]]:translate-y-[2px]",
        className
      )}
      {...props}
    />
  )
}
```

- [ ] **Step 4: Переписать `TableCell` и `TableRow`**

```tsx
function TableRow({ className, ...props }: React.ComponentProps<"tr">) {
  return (
    <tr
      data-slot="table-row"
      className={cn(
        // Разделитель СВЕТЛЕЕ внешней рамки — так в прототипе (210 40% 95%
        // против 214.3 31.8% 91.4%). Зебры в прототипе нет.
        "border-table-divider hover:bg-muted/40 data-[state=selected]:bg-muted border-b transition-colors",
        className
      )}
      {...props}
    />
  )
}

function TableCell({ className, ...props }: React.ComponentProps<"td">) {
  return (
    <td
      data-slot="table-cell"
      className={cn(
        // Прототип: padding:11px 10px; font-size:12.5px.
        "px-2.5 py-[11px] align-middle text-[12.5px] whitespace-nowrap [&:has([role=checkbox])]:pr-0 [&>[role=checkbox]]:translate-y-[2px]",
        className
      )}
      {...props}
    />
  )
}
```

- [ ] **Step 5: Снять нижнюю границу с шапки — её теперь рисует заливка**

Заменить тело `TableHeader`:

```tsx
function TableHeader({ className, ...props }: React.ComponentProps<"thead">) {
  return (
    <thead
      data-slot="table-header"
      className={cn("[&_tr]:border-border [&_tr]:border-b", className)}
      {...props}
    />
  )
}
```

- [ ] **Step 6: Прогнать — проба зелёная**

```bash
SMOKE_LIVE=1 npx playwright test --config=playwright.smoke.config.ts prototype-skin.spec.ts --reporter=list 2>&1 | grep -E "passed|failed|✘|✓"
```

Ожидание: **2 passed**.

- [ ] **Step 7: Прогнать пробы, читающие таблицы, — текст не должен поехать**

```bash
SMOKE_LIVE=1 npx playwright test --config=playwright.smoke.config.ts tables-data.spec.ts operations-analytics.spec.ts --reporter=list 2>&1 | grep -E "passed|failed|✘"
```

Ожидание: ни одного **нового** падения против базы, снятой в Task 0 ревьюером.

- [ ] **Step 8: Коммит**

```bash
git add components/ui/table.tsx e2e/prototype-skin.spec.ts
git commit -m "feat(ui): таблица набрана по плотности прототипа

th 14px/500/тёмный → 11px/600/--muted-foreground на заливке; td 14px → 12.5px;
разделитель строк переведён на --table-divider (светлее внешней рамки).

Регистр заголовков намеренно не задан: в исходнике прототипа text-transform на
th нет, а thead th пинится по textContent в пяти местах e2e."
```

---

## Task 3: Снятие зебры

Зебра — не решение прототипа: в его исходнике у `<tr>` нет фона вовсе, строки разделяет только тонкая линейка. Четыре файла добавляют её вручную.

**Files:**
- Modify: `components/status-table.tsx:537`, `app/organization/page.tsx:284`, `entities/employee/ui/EmployeeTable.tsx:142`, `app/security-ops/forces/page.tsx:212`, `e2e/prototype-skin.spec.ts`

**Interfaces:**
- Consumes: `TableRow` из Task 2
- Produces: ничего

- [ ] **Step 1: Дописать падающую пробу**

```ts
  test('строки таблицы не полосатые', async ({ page }) => {
    await signIn(page)
    await page.goto(`${APP}/employees/`)
    await expect(page.getByRole('heading', { name: 'Управление персоналом' })).toBeVisible()

    const rows = page.locator('tbody tr')
    // 🔴 Нужны минимум ТРИ строки: на двух ассерт «фоны совпадают» вырождается —
    // любая пара соседей в зебре различна, и проба не отличит зебру от её
    // отсутствия по одной паре.
    await expect(rows.nth(2)).toBeVisible()

    const backgrounds = await rows.evaluateAll((els) =>
      els.slice(0, 3).map((el) => getComputedStyle(el).backgroundColor)
    )
    expect(new Set(backgrounds).size, `фоны первых трёх строк: ${backgrounds.join(', ')}`).toBe(1)
  })
```

- [ ] **Step 2: Прогнать — проба КРАСНАЯ**

```bash
SMOKE_LIVE=1 npx playwright test --config=playwright.smoke.config.ts prototype-skin.spec.ts --reporter=list 2>&1 | grep -E "passed|failed|✘|✓"
```

Ожидание: **2 passed, 1 failed**; в сообщении два разных цвета.

- [ ] **Step 3: Снять зебру в `EmployeeTable`**

`entities/employee/ui/EmployeeTable.tsx:142` — заменить

```tsx
                  className="cursor-pointer odd:bg-muted/40 hover:bg-muted"
```

на

```tsx
                  className="cursor-pointer"
```

Hover даёт сам `TableRow`.

- [ ] **Step 4: Снять зебру в `forces`**

`app/security-ops/forces/page.tsx:212` — заменить

```tsx
                    className="cursor-pointer odd:bg-muted/40 hover:bg-muted"
```

на

```tsx
                    className="cursor-pointer"
```

- [ ] **Step 5: Снять зебру в `organization`**

`app/organization/page.tsx:284` — заменить

```tsx
                      <TableRow key={row.key} className="odd:bg-muted/40">
```

на

```tsx
                      <TableRow key={row.key}>
```

- [ ] **Step 6: Снять зебру в `status-table`, сохранив подсветку просрочки**

`components/status-table.tsx:536-538` — заменить

```tsx
                    isOverdue(employee.endDate) ? "bg-red-50" : "odd:bg-muted/40"
```

на

```tsx
                    // Подсветка просрочки ОСТАЁТСЯ: она несёт смысл, а не
                    // декорацию. Уходит только зебра.
                    isOverdue(employee.endDate) ? "bg-red-50" : ""
```

- [ ] **Step 7: Прогнать — проба зелёная**

```bash
SMOKE_LIVE=1 npx playwright test --config=playwright.smoke.config.ts prototype-skin.spec.ts --reporter=list 2>&1 | grep -E "passed|failed|✘|✓"
```

Ожидание: **3 passed**.

- [ ] **Step 8: Убедиться, что подсветка просрочки жива**

```bash
SMOKE_LIVE=1 npx playwright test --config=playwright.smoke.config.ts tables-data.spec.ts --reporter=list 2>&1 | grep -E "passed|failed|✘"
```

Ожидание: без новых падений — в `tables-data.spec.ts` есть ассерт на отметку просроченных.

- [ ] **Step 9: Коммит**

```bash
git add components/status-table.tsx app/organization/page.tsx \
        entities/employee/ui/EmployeeTable.tsx app/security-ops/forces/page.tsx \
        e2e/prototype-skin.spec.ts
git commit -m "feat(ui): снята зебра — в прототипе строки разделяет линейка, а не фон

Подсветка просроченных статусов в status-table сохранена: она несёт смысл."
```

---

## Task 4: Бейдж

В исходнике прототипа 101 вхождение `border-radius:999px`; преобладающая пара — `font-size:11px; font-weight:600`. Текущий бейдж — `rounded-md` (6px) и `text-xs` (12px).

**Files:**
- Modify: `components/ui/badge.tsx`, `e2e/prototype-skin.spec.ts`

**Interfaces:**
- Consumes: ничего
- Produces: `<Badge>` с радиусом 999px

- [ ] **Step 1: Дописать падающую пробу**

```ts
  test('бейдж — таблетка 11px', async ({ page }) => {
    await signIn(page)
    await page.goto(`${APP}/employees/`)
    await expect(page.getByRole('heading', { name: 'Управление персоналом' })).toBeVisible()

    const badge = page.locator('tbody [data-slot="badge"]').first()
    await expect(badge).toBeVisible()

    const shape = await badge.evaluate((el) => {
      const cs = getComputedStyle(el)
      return { radius: parseFloat(cs.borderRadius), size: cs.fontSize, weight: cs.fontWeight }
    })

    // Таблетка: радиус заведомо больше половины высоты бейджа.
    expect(shape.radius).toBeGreaterThan(100)
    expect(shape.size).toBe('11px')
    expect(shape.weight).toBe('600')
  })
```

- [ ] **Step 2: Прогнать — проба КРАСНАЯ**

Ожидание: **3 passed, 1 failed**; `radius` = 6.

Если падение вида «locator resolved to 0 elements» — у `Badge` нет `data-slot="badge"`; сначала проверить разметку примитива и поправить локатор, не ассерт.

- [ ] **Step 3: Поменять базовые классы бейджа**

В `components/ui/badge.tsx` в `badgeVariants` заменить `rounded-md` на `rounded-full`, а `text-xs` на `text-[11px]`, и убедиться, что в базовой строке стоит `font-semibold` (а не `font-medium`).

```tsx
const badgeVariants = cva(
  // Прототип: border-radius:999px; font-size:11px; font-weight:600 —
  // преобладающая пара из 101 вхождения таблетки.
  "inline-flex items-center justify-center rounded-full border px-2 py-0.5 text-[11px] font-semibold w-fit whitespace-nowrap shrink-0 [&>svg]:size-3 gap-1 [&>svg]:pointer-events-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px] aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 aria-invalid:border-destructive transition-[color,box-shadow] overflow-hidden",
  { /* variants оставить без изменений */ }
)
```

Сверить итоговую строку с текущей в файле и перенести только перечисленные отличия — остальные классы не трогать.

- [ ] **Step 4: Прогнать — проба зелёная**

Ожидание: **4 passed**.

- [ ] **Step 5: Проверить, что бейджи статусов не потеряли цвет**

```bash
SMOKE_LIVE=1 npx playwright test --config=playwright.smoke.config.ts tables-data.spec.ts org-structure-status.spec.ts --reporter=list 2>&1 | grep -E "passed|failed|✘"
```

Ожидание: без новых падений. Цвета приходят из `EMPLOYEE_STATUS_PAINT` через `className`, радиус на них не влияет.

- [ ] **Step 6: Коммит**

```bash
git add components/ui/badge.tsx e2e/prototype-skin.spec.ts
git commit -m "feat(ui): бейдж — таблетка 11px/600 вместо rounded-md 12px"
```

---

## Task 5: PageHeader

**Files:**
- Create: `components/page-header.tsx`
- Modify: `app/security-ops/events/page.tsx` (первое применение), `e2e/prototype-skin.spec.ts`

**Interfaces:**
- Consumes: ничего
- Produces:

```tsx
interface PageHeaderProps {
  eyebrow?: string      // капсовый надзаголовок, --primary
  title: string         // H1
  description?: string  // подпись под H1
  actions?: React.ReactNode  // кнопки справа
}
export function PageHeader(props: PageHeaderProps): JSX.Element
```

Задачи 13-14 раскатывают этот компонент по остальным страницам.

- [ ] **Step 1: Дописать падающую пробу**

```ts
  test('заголовок страницы набран по прототипу', async ({ page }) => {
    await signIn(page)
    await page.goto(`${APP}/security-ops/events/`)

    const h1 = page.getByRole('heading', { name: 'Реестр ОМ', level: 1 })
    await expect(h1).toBeVisible()

    const shape = await h1.evaluate((el) => {
      const cs = getComputedStyle(el)
      return { size: cs.fontSize, weight: cs.fontWeight }
    })
    expect(shape.size).toBe('25px')
    expect(shape.weight).toBe('700')

    const eyebrow = page.locator('[data-slot="page-eyebrow"]')
    await expect(eyebrow).toHaveText('ОХРАННЫЕ МЕРОПРИЯТИЯ')
    expect(await eyebrow.evaluate((el) => getComputedStyle(el).textTransform)).toBe('uppercase')
  })
```

- [ ] **Step 2: Прогнать — проба КРАСНАЯ**

Ожидание: **4 passed, 1 failed**; `size` = `24px` — на этой странице заголовок
`text-2xl` (`app/security-ops/events/page.tsx:102`), в отличие от легаси-портала,
где везде `text-3xl`. Надзаголовка нет вовсе, поэтому второе падение — на
`page-eyebrow`.

- [ ] **Step 3: Создать компонент**

`components/page-header.tsx`:

```tsx
import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

interface PageHeaderProps {
  /** Капсовый надзаголовок над H1 — раздел, к которому относится страница. */
  eyebrow?: string;
  title: string;
  description?: string;
  /** Кнопки справа; выравниваются по верхнему краю блока заголовка. */
  actions?: ReactNode;
  className?: string;
}

/**
 * Заголовок страницы в наборе прототипа:
 *   надзаголовок 10.5px/700/uppercase/letter-spacing .12em/--primary, mb 6px
 *   H1           25px/700/line-height 1.15/letter-spacing -.02em, mb 6px
 *   подпись      --muted-foreground
 *
 * Надзаголовок набран `text-primary-ink`, а не `text-primary`: насыщенный
 * --primary как БУКВЫ даёт 3.46:1 на тёмном фоне и не проходит 4.5:1.
 */
export function PageHeader({
  eyebrow,
  title,
  description,
  actions,
  className,
}: PageHeaderProps) {
  return (
    <div className={cn("flex flex-wrap items-start justify-between gap-4", className)}>
      <div className="min-w-0">
        {eyebrow ? (
          <p
            data-slot="page-eyebrow"
            className="text-primary-ink mb-1.5 text-[10.5px] font-bold tracking-[.12em] uppercase"
          >
            {eyebrow}
          </p>
        ) : null}
        <h1 className="mb-1.5 text-[25px] leading-[1.15] font-bold tracking-[-.02em]">
          {title}
        </h1>
        {description ? (
          <p className="text-muted-foreground text-sm">{description}</p>
        ) : null}
      </div>
      {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
    </div>
  );
}
```

- [ ] **Step 4: Применить на «Реестре ОМ»**

В `app/security-ops/events/page.tsx` найти блок заголовка (иконка + `<h1>` + подпись + кнопка «+ Создать ОМ») и заменить его на:

```tsx
      <PageHeader
        eyebrow="Охранные мероприятия"
        title="Реестр ОМ"
        description="Полный цикл: от бюллетеня и рекогносцировки до закрытия и архива"
        actions={/* существующая кнопка «+ Создать ОМ» — перенести как есть */}
      />
```

Импорт: `import { PageHeader } from "@/components/page-header"`.

Текст `title` должен совпасть с прежним `<h1>` дословно: он пинится в `e2e/events-registry.spec.ts`.

- [ ] **Step 5: Прогнать — проба зелёная**

Ожидание: **5 passed**.

- [ ] **Step 6: Проверить спеку реестра**

```bash
SMOKE_LIVE=1 npx playwright test --config=playwright.smoke.config.ts events-registry.spec.ts --reporter=list 2>&1 | grep -E "passed|failed|✘"
```

Ожидание: без новых падений.

- [ ] **Step 7: Коммит**

```bash
git add components/page-header.tsx app/security-ops/events/page.tsx e2e/prototype-skin.spec.ts
git commit -m "feat(ui): PageHeader — надзаголовок, H1 25px, слот действий

Первое применение — «Реестр ОМ». Раскатка по остальным страницам — отдельно."
```

---

## Task 6: Хлебные крошки и шапка

Крошек в коде нет вовсе; они числятся в незакрытых долгах аудита от 17.08.

**Files:**
- Create: `components/navigation/breadcrumbs.tsx`
- Modify: `components/navigation/header.tsx:49-50`, `e2e/prototype-skin.spec.ts`

**Interfaces:**
- Consumes: ничего
- Produces: `export function Breadcrumbs(): JSX.Element | null` — читает `usePathname()` сама, пропсов не требует

- [ ] **Step 1: Дописать падающую пробу**

```ts
  test('в шапке есть хлебные крошки', async ({ page }) => {
    await signIn(page)
    await page.goto(`${APP}/security-ops/events/`)
    await expect(page.getByRole('heading', { name: 'Реестр ОМ' })).toBeVisible()

    const crumbs = page.getByRole('navigation', { name: 'Хлебные крошки' })
    await expect(crumbs).toBeVisible()
    await expect(crumbs).toContainText('Реестр ОМ')

    // Шапка белая, а не в цвет полотна — иначе она сливается с ним.
    const header = page.locator('header').first()
    const headerBg = await header.evaluate((el) => getComputedStyle(el).backgroundColor)
    const bodyBg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor)
    expect(headerBg).not.toBe(bodyBg)
  })
```

- [ ] **Step 2: Прогнать — проба КРАСНАЯ**

Ожидание: **5 passed, 1 failed**; крошек нет.

- [ ] **Step 3: Создать компонент**

`components/navigation/breadcrumbs.tsx`:

```tsx
"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ChevronRight } from "lucide-react";

/**
 * Подписи сегментов маршрута. Ключ — сегмент URL как есть.
 * Сегменты, которых здесь нет (идентификаторы), в крошки не попадают:
 * «/security-ops/events/42» читается как «Реестр ОМ», а не «Реестр ОМ / 42».
 */
const SEGMENT_LABELS: Record<string, string> = {
  "security-ops": "Охранные мероприятия",
  "command-center": "Командный центр",
  events: "Реестр ОМ",
  gvo: "Реестр ГВО",
  forces: "Сбор сил",
  persons: "Охраняемые лица",
  objects: "Объекты и паспорта",
  laws: "Законы об ОМ",
  calendar: "Календарь смен",
  duties: "Дежурства",
  "daily-expense": "Расход и светофор",
  ratings: "Оперативный рейтинг",
  analytics: "Аналитика",
  operations: "Аналитика ОМ",
  "service-reports": "Отчёты службы",
  dictionaries: "Справочники",
  audit: "Аудит",
  changelog: "Журнал изменений",
  settings: "Настройки",
  feedback: "Обратная связь",
  profile: "Мой профиль",
  dashboard: "Обзор",
  employees: "Управление персоналом",
  organization: "Структура организации",
  statuses: "Статусы сотрудников",
  reports: "Отчёты",
};

export function Breadcrumbs() {
  const pathname = usePathname();
  const segments = pathname.split("/").filter(Boolean);

  const crumbs: { href: string; label: string }[] = [];
  let href = "";
  for (const segment of segments) {
    href += `/${segment}`;
    const label = SEGMENT_LABELS[segment];
    if (label) crumbs.push({ href: `${href}/`, label });
  }

  if (crumbs.length === 0) return null;

  return (
    <nav aria-label="Хлебные крошки" className="min-w-0">
      <ol className="text-muted-foreground flex items-center gap-1.5 text-[12.5px]">
        {crumbs.map((crumb, index) => {
          const isLast = index === crumbs.length - 1;
          return (
            <li key={crumb.href} className="flex min-w-0 items-center gap-1.5">
              {index > 0 ? (
                <ChevronRight className="size-3.5 shrink-0" aria-hidden />
              ) : null}
              {isLast ? (
                <span className="text-foreground truncate font-semibold" aria-current="page">
                  {crumb.label}
                </span>
              ) : (
                <Link href={crumb.href} className="hover:text-foreground truncate">
                  {crumb.label}
                </Link>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
```

- [ ] **Step 4: Врезать крошки в шапку и сделать её белой**

В `components/navigation/header.tsx:50` заменить `bg-background` на `bg-card`, и сразу после кнопки бургера вставить `<Breadcrumbs />`:

```tsx
      <div className="sticky top-0 z-40 flex h-14 items-center justify-between bg-card px-4 sm:px-6">
```

Импорт: `import { Breadcrumbs } from "@/components/navigation/breadcrumbs"`.

- [ ] **Step 5: Прогнать — проба зелёная**

Ожидание: **6 passed**.

- [ ] **Step 6: Проверить, что крошки не сломали шапку на узкой ширине**

```bash
SMOKE_LIVE=1 npx playwright test --config=playwright.smoke.config.ts smoke-buttons.spec.ts --reporter=list 2>&1 | grep -E "passed|failed|✘"
```

Ожидание: без новых падений.

- [ ] **Step 7: Коммит**

```bash
git add components/navigation/breadcrumbs.tsx components/navigation/header.tsx e2e/prototype-skin.spec.ts
git commit -m "feat(nav): хлебные крошки в шапке, шапка на bg-card

Крошек в коде не было вовсе — числились в незакрытых долгах аудита 17.08."
```

---

## Task 7: Сайдбар

**Files:**
- Modify: `components/navigation/sidebar.tsx`, `components/dashboard-layout.tsx:56-74`, `components/navigation/mobile-menu.tsx:47`, `e2e/prototype-skin.spec.ts`

**Interfaces:**
- Consumes: `--sidebar*` токены (уже есть)
- Produces: ничего

- [ ] **Step 1: Дописать падающую пробу**

```ts
  test('сайдбар 256px и светлая шапка', async ({ page }) => {
    await signIn(page)
    await page.goto(`${APP}/security-ops/events/`)
    await expect(page.getByRole('heading', { name: 'Реестр ОМ' })).toBeVisible()

    const aside = page.locator('aside').first()
    await expect(aside).toBeVisible()
    expect(await aside.evaluate((el) => el.getBoundingClientRect().width)).toBe(256)

    // Шапка сайдбара больше не залита синим: сравниваем с --primary кнопки.
    const brandBg = await page
      .locator('[data-slot="sidebar-brand"]')
      .evaluate((el) => getComputedStyle(el).backgroundColor)
    const asideBg = await aside.evaluate((el) => getComputedStyle(el).backgroundColor)
    expect(brandBg).toBe(asideBg)
  })
```

- [ ] **Step 2: Прогнать — проба КРАСНАЯ**

Ожидание: **6 passed, 1 failed**; ширина 320.

- [ ] **Step 3: Сузить сайдбар в лэйауте**

В `components/dashboard-layout.tsx`: в блоке десктопного сайдбара (строки 56-62) заменить `w-80` на `w-64`, в контенте (строки 71-74) — `lg:ml-80` на `lg:ml-64`.

- [ ] **Step 4: Переписать шапку сайдбара**

В `components/navigation/sidebar.tsx:217-228` заменить блок шапки на:

```tsx
        <div
          data-slot="sidebar-brand"
          className="border-sidebar-border flex h-16 flex-shrink-0 items-center gap-[11px] border-b px-[18px]"
        >
          {/* Прототип: плитка 36px, radius 10px, bg-primary, белый текст 800/13px.
              Заливка ушла с шапки на плитку — шапка стала светлой. */}
          <div className="bg-primary text-primary-foreground grid size-9 shrink-0 place-items-center rounded-[10px] text-[13px] font-extrabold">
            ПР
          </div>
          <div className="min-w-0">
            <div className="text-sidebar-foreground truncate text-[15px] font-bold tracking-[.06em]">
              Проект Расход
            </div>
            <div className="text-sidebar-foreground/55 truncate text-[10.5px]">
              Учёт личного состава
            </div>
          </div>
        </div>
```

Строка «Проект Расход» сохраняется дословно — бренд по решению не меняется.

- [ ] **Step 5: Уплотнить пункты меню**

В `components/navigation/sidebar.tsx:44-45` заменить `ITEM_CLASS`:

```tsx
// Прототип: компактный пункт 13px, radius 9px. Было 15px/600 с px-4 py-3 —
// при 256px такие пункты переносились в две строки.
const ITEM_CLASS =
  "flex items-center rounded-[9px] px-3 py-2 text-[13px] font-medium transition-colors";
```

- [ ] **Step 6: Набрать заголовки групп капсом**

Найти в `sidebar.tsx` разметку заголовка группы (сейчас `ОХРАННЫЕ МЕРОПРИЯТИЯ`) и задать ей:

```tsx
className="text-sidebar-foreground/45 mx-2.5 mb-1.5 text-[10px] font-bold tracking-[.12em] uppercase"
```

Текст заголовков не менять.

- [ ] **Step 7: Сжать карточку роли в строку**

Найти блок «Текущая роль» внизу сайдбара и заменить внешний контейнер `rounded-xl border p-4` на компактную строку:

```tsx
        <div className="border-sidebar-border flex items-center gap-2.5 border-t px-3 py-2.5">
```

Внутри: подпись роли — `text-[10px] uppercase tracking-[.12em] text-sidebar-foreground/45`, название — `text-[12.5px] font-semibold truncate`. Блок «Полный доступ ко всем функциям» и «Отдел: …» убрать в `title` контейнера — при 256px они не помещаются и сейчас наезжают на кнопку темы.

- [ ] **Step 8: Согласовать мобильное меню**

В `components/navigation/mobile-menu.tsx:47` заменить `<span className="text-lg font-bold text-white">Проект Расход</span>` на ту же плитку + бренд, что в Step 4, чтобы шапки совпадали.

- [ ] **Step 9: Прогнать — проба зелёная**

Ожидание: **7 passed**.

- [ ] **Step 10: Проверить навигацию целиком**

```bash
SMOKE_LIVE=1 npx playwright test --config=playwright.smoke.config.ts smoke-buttons.spec.ts --reporter=list 2>&1 | grep -E "passed|failed|✘"
```

Ожидание: без новых падений. Смоук кликает по пунктам меню — если пункт перестал попадать под клик, падение будет здесь.

- [ ] **Step 11: Коммит**

```bash
git add components/navigation/sidebar.tsx components/dashboard-layout.tsx \
        components/navigation/mobile-menu.tsx e2e/prototype-skin.spec.ts
git commit -m "feat(nav): сайдбар 256px, светлая шапка, компактные пункты

Синяя заливка ушла с шапки на плитку логотипа. Карточка роли сжата в строку —
при 256px прежняя наезжала на кнопку темы. Состав меню не менялся."
```

---

## Task 8: StatCard и легаси-плитки

На `/dashboard` и `/organization` подписи плиток обрезаются: «Командирові», «Прикоманди», «На соревновани», «Штатных единиц».

**Files:**
- Create: `components/stat-card.tsx`
- Modify: `app/dashboard/page.tsx` (или файл, рисующий плитки обзора), `app/organization/page.tsx`, `e2e/prototype-skin.spec.ts`

**Interfaces:**
- Consumes: `Card` из `components/ui/card`
- Produces:

```tsx
type StatTone = "neutral" | "success" | "warning" | "danger" | "info";
interface StatCardProps {
  label: string;
  value: string | number;
  caption?: string;
  tone?: StatTone;   // по умолчанию "neutral"
}
export function StatCard(props: StatCardProps): JSX.Element
```

- [ ] **Step 1: Дописать падающую пробу**

```ts
  test('подписи KPI-плиток не обрезаются', async ({ page }) => {
    await signIn(page)
    await page.goto(`${APP}/dashboard/`)
    await expect(page.getByRole('heading', { name: 'Обзор' })).toBeVisible()

    const clipped = await page.locator('[data-slot="stat-label"]').evaluateAll((els) =>
      els
        .filter((el) => el.scrollWidth > el.clientWidth + 1)
        .map((el) => `${el.textContent?.trim()} (${el.scrollWidth}>${el.clientWidth})`)
    )
    expect(clipped, `обрезанные подписи: ${clipped.join('; ')}`).toEqual([])

    const value = page.locator('[data-slot="stat-value"]').first()
    const shape = await value.evaluate((el) => {
      const cs = getComputedStyle(el)
      return { size: cs.fontSize, weight: cs.fontWeight, numeric: cs.fontVariantNumeric }
    })
    expect(shape.size).toBe('24px')
    expect(shape.weight).toBe('800')
    expect(shape.numeric).toContain('tabular-nums')
  })
```

- [ ] **Step 2: Прогнать — проба КРАСНАЯ**

Ожидание: **7 passed, 1 failed**; `data-slot="stat-label"` не найден.

- [ ] **Step 3: Создать компонент**

`components/stat-card.tsx`:

```tsx
import { cn } from "@/lib/utils";

type StatTone = "neutral" | "success" | "warning" | "danger" | "info";

const DOT_CLASS: Record<StatTone, string> = {
  neutral: "bg-muted-foreground",
  success: "bg-green-600",
  warning: "bg-amber-500",
  danger: "bg-destructive",
  info: "bg-primary",
};

const VALUE_CLASS: Record<StatTone, string> = {
  neutral: "",
  success: "text-green-700",
  warning: "text-amber-700",
  danger: "text-destructive-ink",
  info: "text-primary-ink",
};

interface StatCardProps {
  label: string;
  value: string | number;
  caption?: string;
  tone?: StatTone;
  className?: string;
}

/**
 * KPI-плитка в наборе прототипа: точка-индикатор, мелкий лейбл, число
 * 24px/800/tabular-nums, подпись.
 *
 * 🔴 Лейбл НЕ обрезается по ширине: прежние плитки резали «Командирові» и
 * «Прикоманди» посреди слова. Длинная подпись переносится, а не прячется.
 */
export function StatCard({ label, value, caption, tone = "neutral", className }: StatCardProps) {
  return (
    <div
      data-slot="stat-card"
      className={cn("bg-card rounded-xl border p-4", className)}
    >
      <div className="flex items-start gap-2">
        <span className={cn("mt-1.5 size-1.5 shrink-0 rounded-full", DOT_CLASS[tone])} aria-hidden />
        <span
          data-slot="stat-label"
          className="text-muted-foreground text-[11px] leading-snug font-medium text-balance"
        >
          {label}
        </span>
      </div>
      <div
        data-slot="stat-value"
        className={cn("mt-[5px] text-2xl font-extrabold tabular-nums", VALUE_CLASS[tone])}
      >
        {value}
      </div>
      {caption ? (
        <div className="text-muted-foreground mt-1 text-[11px] leading-snug">{caption}</div>
      ) : null}
    </div>
  );
}
```

- [ ] **Step 4: Перевести плитки обзора**

Плитки `/dashboard` рисует **общий** компонент
`components/dashboard/stats-cards.tsx` (`StatsCards`, экспортируется также из
`design-sync.entry.ts:27`), подключён в `app/dashboard/page.tsx:5,99`. Переписать
внутренности `StatsCards` на `StatCard`, сохранив её публичный пропс-интерфейс
(`StatsCardsProps`, строка 23) — тогда страница не меняется вовсе.

Подписи и значения сохранить дословно.

- [ ] **Step 5: Перевести плитки структуры организации**

В `app/organization/page.tsx` плитки свёрстаны на месте (строки ~160-240:
«Занято», «Департаментов», «Управлений», «Отделов», «Штатных единиц»,
«Вакансий»). Заменить на `StatCard`. Подписи и числа не менять.

- [ ] **Step 6: Прогнать — проба зелёная**

Ожидание: **8 passed**.

- [ ] **Step 7: Проверить обе страницы пробами**

```bash
SMOKE_LIVE=1 npx playwright test --config=playwright.smoke.config.ts org-structure-view.spec.ts org-structure-status.spec.ts --reporter=list 2>&1 | grep -E "passed|failed|✘"
```

Ожидание: без новых падений.

- [ ] **Step 8: Коммит**

```bash
git add components/stat-card.tsx app/organization/page.tsx e2e/prototype-skin.spec.ts
git add -u app/dashboard
git commit -m "feat(ui): StatCard — число 24px/800/tabular-nums, подпись не режется

Прежние плитки обрезали «Командирові», «Прикоманди», «На соревновани» посреди
слова. Подпись теперь переносится."
```

---

## Task 9: Сырые таблицы — рейтинг

Перевод по рецепту из **Global Constraints**.

**Files:**
- Modify: `app/security-ops/ratings/page.tsx`, `app/security-ops/ratings/export/page.tsx`, `app/security-ops/ratings/evaluations/page.tsx`, `app/security-ops/ratings/audit/page.tsx`, `app/security-ops/ratings/employees/[employeeId]/page.tsx`

**Interfaces:**
- Consumes: `Table`/`TableHeader`/`TableBody`/`TableRow`/`TableHead`/`TableCell` из Task 2
- Produces: ничего

- [ ] **Step 1: Дописать пробу, покрывающую перевод**

В `e2e/prototype-skin.spec.ts`:

```ts
  // Один ассерт на все переведённые экраны: если хоть один остался на сырой
  // <table>, его th сохранит прежние 14px и проба покажет, какой именно.
  for (const route of [
    '/security-ops/ratings/',
    '/security-ops/ratings/export/',
    '/security-ops/ratings/evaluations/',
    '/security-ops/ratings/audit/',
  ]) {
    test(`таблица переведена на примитив: ${route}`, async ({ page }) => {
      await signIn(page)
      await page.goto(`${APP}${route}`)
      await expect(page.locator('thead th').first()).toBeVisible()

      const sizes = await page
        .locator('thead th')
        .evaluateAll((els) => [...new Set(els.map((el) => getComputedStyle(el).fontSize))])
      expect(sizes, `на ${route} шапка набрана не 11px`).toEqual(['11px'])
    })
  }
```

- [ ] **Step 2: Прогнать — пробы КРАСНЫЕ**

```bash
SMOKE_LIVE=1 npx playwright test --config=playwright.smoke.config.ts prototype-skin.spec.ts --reporter=list 2>&1 | grep -E "passed|failed|✘|✓"
```

Ожидание: **8 passed, 4 failed** — по одному падению на маршрут, в сообщении `["14px"]` или собственный размер из инлайн-стиля.

- [ ] **Step 3: Перевести `ratings/page.tsx`**

Применить рецепт из Global Constraints. Заменить `<table>`/`<thead>`/`<tbody>`/`<tr>`/`<th>`/`<td>` на компоненты, удалить инлайн-стили плотности, сохранить смысловые цвета и ширины колонок.

- [ ] **Step 4: Перевести `ratings/export/page.tsx`**

То же по рецепту.

- [ ] **Step 5: Перевести `ratings/evaluations/page.tsx`**

То же по рецепту.

- [ ] **Step 6: Перевести `ratings/audit/page.tsx`**

То же по рецепту.

- [ ] **Step 7: Перевести `ratings/employees/[employeeId]/page.tsx`**

То же по рецепту. Маршрут требует идентификатора и в цикл проб не входит — проверяется глазами на шаге 9.

- [ ] **Step 8: Прогнать — пробы зелёные**

Ожидание: **12 passed**.

- [ ] **Step 9: Проверить карточку сотрудника в рейтинге глазами**

Открыть `/security-ops/ratings/` → перейти в любого сотрудника → убедиться, что таблица набрана так же, как на списке.

- [ ] **Step 10: Коммит**

```bash
git add app/security-ops/ratings e2e/prototype-skin.spec.ts
git commit -m "refactor(ratings): пять таблиц рейтинга переведены на примитив

Инлайн-стили плотности сняты, смысловые цвета сохранены через токены."
```

---

## Task 10: Сырые таблицы — аналитика

**Files:**
- Modify: `app/security-ops/analytics/page.tsx` (4 таблицы), `app/security-ops/analytics/operations/page.tsx` (2 таблицы), `app/security-ops/ratings/analytics/page.tsx` (2 таблицы), `e2e/prototype-skin.spec.ts`

**Interfaces:**
- Consumes: примитив таблицы из Task 2
- Produces: ничего

- [ ] **Step 1: Дописать пробу**

```ts
  for (const route of [
    '/security-ops/analytics/',
    '/security-ops/analytics/operations/',
    '/security-ops/ratings/analytics/',
  ]) {
    test(`аналитика переведена на примитив: ${route}`, async ({ page }) => {
      await signIn(page)
      await page.goto(`${APP}${route}`)
      await expect(page.locator('thead th').first()).toBeVisible()

      const sizes = await page
        .locator('thead th')
        .evaluateAll((els) => [...new Set(els.map((el) => getComputedStyle(el).fontSize))])
      expect(sizes, `на ${route} шапка набрана не 11px`).toEqual(['11px'])
    })
  }
```

- [ ] **Step 2: Прогнать — пробы КРАСНЫЕ**

Ожидание: **12 passed, 3 failed**.

- [ ] **Step 3: Перевести четыре таблицы в `analytics/page.tsx`**

Применить рецепт из Global Constraints к каждой из четырёх.

- [ ] **Step 4: Перевести две таблицы в `analytics/operations/page.tsx`**

То же по рецепту. **Осторожно:** `e2e/operations-analytics.spec.ts:256` читает `thead th` этой страницы по тексту — заголовки не менять ни на символ.

- [ ] **Step 5: Перевести две таблицы в `ratings/analytics/page.tsx`**

То же по рецепту.

- [ ] **Step 6: Прогнать — пробы зелёные**

Ожидание: **15 passed**.

- [ ] **Step 7: Прогнать спеку аналитики**

```bash
SMOKE_LIVE=1 npx playwright test --config=playwright.smoke.config.ts operations-analytics.spec.ts service-analytics.spec.ts --reporter=list 2>&1 | grep -E "passed|failed|✘"
```

Ожидание: без новых падений.

- [ ] **Step 8: Коммит**

```bash
git add app/security-ops/analytics app/security-ops/ratings/analytics e2e/prototype-skin.spec.ts
git commit -m "refactor(analytics): восемь таблиц аналитики переведены на примитив"
```

---

## Task 11: Сырые таблицы — features

**Files:**
- Modify: `features/organization-structure/ui/OrgBoard.tsx`, `features/ops-ratings/rating-dynamics-section.tsx`, `features/ops-daily/daily-grid.tsx`, `features/ops-changelog/changelog-view.tsx`, `e2e/prototype-skin.spec.ts`

**Interfaces:**
- Consumes: примитив таблицы из Task 2
- Produces: ничего

- [ ] **Step 1: Дописать пробу**

```ts
  for (const route of ['/security-ops/daily-expense/', '/security-ops/changelog/', '/organization/']) {
    test(`features переведены на примитив: ${route}`, async ({ page }) => {
      await signIn(page)
      await page.goto(`${APP}${route}`)
      await expect(page.locator('thead th').first()).toBeVisible()

      const sizes = await page
        .locator('thead th')
        .evaluateAll((els) => [...new Set(els.map((el) => getComputedStyle(el).fontSize))])
      expect(sizes, `на ${route} шапка набрана не 11px`).toEqual(['11px'])
    })
  }
```

- [ ] **Step 2: Прогнать — пробы КРАСНЫЕ**

Ожидание: **15 passed, 3 failed**. `/organization/` уже частично на примитиве — падение придёт от `OrgBoard`, чья таблица сырая.

- [ ] **Step 3: Перевести `OrgBoard.tsx`**

Применить рецепт. Файл несёт свой `components/org-board.styles.css` — проверить, не задаёт ли он плотность `th`/`td`; если задаёт, убрать эти правила, остальное оставить.

- [ ] **Step 4: Перевести `rating-dynamics-section.tsx`**

То же по рецепту.

- [ ] **Step 5: Перевести `daily-grid.tsx`**

То же по рецепту. В файле есть комментарий-отказ от виртуализации на строке 10 — не трогать, он объясняет решение.

- [ ] **Step 6: Перевести `changelog-view.tsx`**

То же по рецепту. Страница статическая, в сеть не ходит — данные приходят пропом `fixes`.

- [ ] **Step 7: Прогнать — пробы зелёные**

Ожидание: **18 passed**.

- [ ] **Step 8: Прогнать спеки структуры**

```bash
SMOKE_LIVE=1 npx playwright test --config=playwright.smoke.config.ts org-structure-view.spec.ts org-structure-status.spec.ts --reporter=list 2>&1 | grep -E "passed|failed|✘"
```

Ожидание: без новых падений.

- [ ] **Step 9: Коммит**

```bash
git add features/organization-structure features/ops-ratings features/ops-daily \
        features/ops-changelog components/org-board.styles.css e2e/prototype-skin.spec.ts
git commit -m "refactor(features): четыре таблицы features переведены на примитив"
```

---

## Task 12: Сырые таблицы — хвост

**Files:**
- Modify: `app/security-ops/service-reports/history/page.tsx`, `app/security-ops/gvo/[id]/page.tsx`, `app/reports/page.tsx`, `e2e/prototype-skin.spec.ts`

**Interfaces:**
- Consumes: примитив таблицы из Task 2
- Produces: ничего

- [ ] **Step 1: Дописать пробу**

```ts
  for (const route of ['/security-ops/service-reports/history/', '/reports/']) {
    test(`хвост переведён на примитив: ${route}`, async ({ page }) => {
      await signIn(page)
      await page.goto(`${APP}${route}`)
      await expect(page.locator('thead th').first()).toBeVisible()

      const sizes = await page
        .locator('thead th')
        .evaluateAll((els) => [...new Set(els.map((el) => getComputedStyle(el).fontSize))])
      expect(sizes, `на ${route} шапка набрана не 11px`).toEqual(['11px'])
    })
  }
```

- [ ] **Step 2: Прогнать — пробы КРАСНЫЕ**

Ожидание: **18 passed, 2 failed**.

- [ ] **Step 3: Перевести `service-reports/history/page.tsx`**

Применить рецепт из Global Constraints.

- [ ] **Step 4: Перевести `gvo/[id]/page.tsx`**

То же по рецепту. Маршрут требует идентификатора и в цикл проб не входит — проверяется на шаге 6.

- [ ] **Step 5: Перевести `app/reports/page.tsx`**

То же по рецепту.

- [ ] **Step 6: Прогнать — пробы зелёные, карточку ГВО проверить спекой**

```bash
SMOKE_LIVE=1 npx playwright test --config=playwright.smoke.config.ts prototype-skin.spec.ts gvo-sections.spec.ts --reporter=list 2>&1 | grep -E "passed|failed|✘|✓"
```

Ожидание: **20 passed** в `prototype-skin`, `gvo-sections` без новых падений.

- [ ] **Step 7: Убедиться, что сырых таблиц не осталось**

```bash
grep -rn "<table" --include=*.tsx . | grep -v node_modules | grep -v "components/ui/table.tsx"
```

Ожидание: **пусто**. Если что-то нашлось — перевести и повторить.

- [ ] **Step 8: Коммит**

```bash
git add app/security-ops/service-reports app/security-ops/gvo app/reports e2e/prototype-skin.spec.ts
git commit -m "refactor(tables): последние три сырые таблицы переведены на примитив

Теперь <table> остался ровно один — в самом примитиве."
```

---

## Task 13: FilterBar и даты на «Реестре ОМ»

На «Реестре ОМ» стоят нативные `dd.mm.yyyy` — разной высоты с соседними контролами и в другом наборе.

**Files:**
- Create: `components/filter-bar.tsx`
- Modify: `app/security-ops/events/page.tsx`, `e2e/prototype-skin.spec.ts`

**Interfaces:**
- Consumes: ничего
- Produces:

```tsx
interface FilterBarProps {
  children: React.ReactNode;
  /** Обработчик кнопки «Сбросить фильтры»; без него кнопка не рисуется. */
  onReset?: () => void;
}
export function FilterBar(props: FilterBarProps): JSX.Element
```

- [ ] **Step 1: Дописать падающую пробу**

```ts
  test('контролы фильтров одной высоты', async ({ page }) => {
    await signIn(page)
    await page.goto(`${APP}/security-ops/events/`)
    const bar = page.locator('[data-slot="filter-bar"]')
    await expect(bar).toBeVisible()

    const heights = await bar
      .locator('input, select, button')
      .evaluateAll((els) => [...new Set(els.map((el) => Math.round(el.getBoundingClientRect().height)))])
    expect(heights, `высоты контролов: ${heights.join(', ')}`).toHaveLength(1)
  })
```

- [ ] **Step 2: Прогнать — проба КРАСНАЯ**

Ожидание: `data-slot="filter-bar"` не найден.

- [ ] **Step 3: Создать компонент**

`components/filter-bar.tsx`:

```tsx
import type { ReactNode } from "react";

import { Button } from "@/components/ui/button";

interface FilterBarProps {
  children: ReactNode;
  onReset?: () => void;
}

/**
 * Ряд фильтров единой высоты. Высоту задаёт сам ряд через селектор потомков —
 * иначе каждый экран назначает её по-своему и они расходятся.
 */
export function FilterBar({ children, onReset }: FilterBarProps) {
  return (
    <div
      data-slot="filter-bar"
      className="flex flex-wrap items-center gap-2 [&_button]:h-9 [&_input]:h-9 [&_select]:h-9"
    >
      {children}
      {onReset ? (
        <Button variant="ghost" size="sm" className="ml-auto" onClick={onReset}>
          Сбросить фильтры
        </Button>
      ) : null}
    </div>
  );
}
```

- [ ] **Step 4: Обернуть фильтры «Реестра ОМ»**

В `app/security-ops/events/page.tsx` обернуть существующий ряд фильтров в `<FilterBar onReset={…}>`, а нативные `<input type="date">` заменить на `<Input type="date" … />` из `@/components/ui/input`, сохранив имена и обработчики.

- [ ] **Step 5: Прогнать — проба зелёная**

Ожидание: **21 passed**.

- [ ] **Step 6: Проверить, что фильтрация работает**

```bash
SMOKE_LIVE=1 npx playwright test --config=playwright.smoke.config.ts events-registry.spec.ts --reporter=list 2>&1 | grep -E "passed|failed|✘"
```

Ожидание: без новых падений.

- [ ] **Step 7: Коммит**

```bash
git add components/filter-bar.tsx app/security-ops/events/page.tsx e2e/prototype-skin.spec.ts
git commit -m "feat(ui): FilterBar — ряд фильтров единой высоты, даты на Input"
```

---

## Task 14: Раскатка PageHeader

**Files:**
- Modify: `app/dashboard/page.tsx`, `app/employees/page.tsx`, `app/organization/page.tsx`, `app/statuses/page.tsx`, `app/reports/page.tsx`, `e2e/prototype-skin.spec.ts`

**Interfaces:**
- Consumes: `PageHeader` из Task 5
- Produces: ничего

- [ ] **Step 1: Дописать пробу**

```ts
  for (const [route, heading] of [
    ['/dashboard/', 'Обзор'],
    ['/employees/', 'Управление персоналом'],
    ['/organization/', 'Структура организации'],
    ['/statuses/', 'Управление статусами'],
    ['/reports/', 'Отчеты'],
  ] as const) {
    test(`заголовок по прототипу: ${route}`, async ({ page }) => {
      await signIn(page)
      await page.goto(`${APP}${route}`)
      const h1 = page.getByRole('heading', { name: heading, level: 1 })
      await expect(h1).toBeVisible()
      expect(await h1.evaluate((el) => getComputedStyle(el).fontSize)).toBe('25px')
    })
  }
```

Заголовки взяты из живого стенда; если на маршруте другой текст — поправить константу, а не разметку страницы.

- [ ] **Step 2: Прогнать — пробы КРАСНЫЕ**

Ожидание: **21 passed, 5 failed**; везде `30px`.

- [ ] **Step 3: Перевести `/dashboard`**

Заменить блок заголовка на `<PageHeader eyebrow="Личный состав" title="Обзор" description=… actions=… />`. Текст `title` и `description` сохранить дословно.

- [ ] **Step 4: Перевести `/employees`**

`<PageHeader eyebrow="Личный состав" title="Управление персоналом" description="Управление сотрудниками организации" actions=… />`.

- [ ] **Step 5: Перевести `/organization`**

`<PageHeader eyebrow="Личный состав" title="Структура организации" description="Визуальная организационная диаграмма с иерархией подразделений" actions=… />`.

- [ ] **Step 6: Перевести `/statuses` и `/reports`**

`/statuses` — `app/statuses/page.tsx:134`, H1 «Управление статусами» (именно так,
а НЕ «Статусы сотрудников» — это подпись пункта меню, заголовок страницы другой).
`/reports` — `app/reports/page.tsx:113`, H1 «Отчеты».
Надзаголовки: «Личный состав» и «Официальные документы». Тексты
`title`/`description` сохранить дословно.

- [ ] **Step 7: Прогнать — пробы зелёные**

Ожидание: **26 passed**.

- [ ] **Step 8: Коммит**

```bash
git add app/dashboard app/employees app/organization app/statuses app/reports e2e/prototype-skin.spec.ts
git commit -m "feat(ui): PageHeader раскатан на легаси-портал"
```

---

## Task 15: Финальная проверка

**Files:**
- Create: `docs/frontend/2026-08-19-prototype-skin-report.md`
- Modify: ничего (кроме находок)

**Interfaces:**
- Consumes: всё предыдущее
- Produces: отчёт с итогами

- [ ] **Step 1: Прогнать весь набор проб**

```bash
cd Backend/PersonnelStatus/PersonalRecordFront
SMOKE_LIVE=1 npx playwright test --config=playwright.smoke.config.ts --reporter=list 2>&1 | tee /tmp/skin-final.log | grep -E "passed|failed"
grep -E "✘|failed" /tmp/skin-final.log
```

Критерий: ни одного падения, которого не было в базе. Список базовых падений берётся у ревьюера из Task 0.

- [ ] **Step 2: Снять контрольные скриншоты**

Обойти в двух темах и на трёх ширинах (1440 / 1024 / 375): `/dashboard/`, `/employees/`, `/organization/`, `/statuses/`, `/reports/`, `/security-ops/command-center/`, `/security-ops/events/`, `/security-ops/objects/`, `/security-ops/daily-expense/`, `/security-ops/persons/`, `/security-ops/analytics/`, `/security-ops/ratings/`.

- [ ] **Step 3: Проверить переполнения**

На каждой странице каждой ширины:

```js
[...document.querySelectorAll('*')].filter((el) => el.scrollWidth > el.clientWidth + 1 &&
  getComputedStyle(el).overflowX === 'visible').length
```

Критерий: **0**. Горизонтальная прокрутка допустима только внутри `[data-slot="table-container"]`.

- [ ] **Step 4: Проверить контраст в обеих темах**

Пройти по текстовым узлам, посчитать контраст с фактическим фоном. Критерий: 0 пар ниже 4.5:1. Найденное чинить токеном (`-ink`), а не точечными классами.

- [ ] **Step 5: Красная проба на канвас**

Временно вернуть `--canvas` к `0 0% 100%`, открыть `/security-ops/command-center/`, убедиться, что карточки слились с фоном, вернуть значение. Это доказывает, что токен действительно работает, а не просто присутствует.

- [ ] **Step 6: Проверочная сборка**

```bash
NEXT_DIST_DIR=.next-build npx next build 2>&1 | tail -20
```

Критерий: сборка проходит. Голый `next build` не запускать — травит `.next` стенда.

- [ ] **Step 7: Написать отчёт**

`docs/frontend/2026-08-19-prototype-skin-report.md`: что сделано по слоям, числа до/после (размеры, ширина сайдбара, число сырых таблиц), список расхождений с прототипом, оставленных сознательно, и незакрытые хвосты.

- [ ] **Step 8: Коммит**

```bash
git add docs/frontend/2026-08-19-prototype-skin-report.md
git commit -m "docs(frontend): отчёт по слою прототипа"
```
