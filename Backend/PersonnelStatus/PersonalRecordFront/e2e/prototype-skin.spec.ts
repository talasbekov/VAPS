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
    // 🔴 textContent — в ЕСТЕСТВЕННОМ регистре: капс делает CSS, а не JS.
    // Если проба потребует здесь капс, компонент придётся уродовать
    // toUpperCase()-ом, и он начнёт терять регистр акронимов и имён.
    await expect(eyebrow).toHaveText('Охранные мероприятия')
    expect(await eyebrow.evaluate((el) => getComputedStyle(el).textTransform)).toBe('uppercase')
  })

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

  test('крошка называет страницу так же, как её h1', async ({ page }) => {
    await signIn(page)
    await page.goto(`${APP}/security-ops/daily-expense/`)
    const h1 = page.getByRole('heading', { level: 1 })
    await expect(h1).toBeVisible()
    const h1Text = await h1.textContent()

    const lastCrumb = page.locator('nav[aria-label="Хлебные крошки"] [aria-current="page"]')
    await expect(lastCrumb).toBeVisible()
    await expect(lastCrumb).toHaveText(h1Text!.trim())
  })

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

  test('заголовок подгруппы набран в одной плотности с пунктами', async ({ page }) => {
    await signIn(page)
    await page.goto(`${APP}/security-ops/events/`)
    await expect(page.getByRole('heading', { name: 'Реестр ОМ' })).toBeVisible()

    const aside = page.locator('aside').first()
    await expect(aside).toBeVisible()

    // Группа «Оперативная работа» открыта сама: текущий адрес лежит внутри неё.
    const groupButton = aside.locator('button[aria-controls^="sidebar-group-"]').first()
    await expect(groupButton).toBeVisible()
    const listId = await groupButton.getAttribute('aria-controls')
    // 🔴 Лист берём ИЗ ЭТОЙ ЖЕ группы: сравнивать заголовок с пунктом чужой
    // (закрытой) группы нельзя — у скрытого узла размеры не считаются.
    const leafLink = aside.locator(`#${listId} a`).first()
    await expect(leafLink).toBeVisible()

    const shape = await page.evaluate(
      ([btnId, id]) => {
        const btn = document.querySelector(`button[aria-controls="${btnId}"]`) as HTMLElement
        const leaf = document.querySelector(`#${id} a`) as HTMLElement
        if (!btn || !leaf) throw new Error('нет пары «заголовок группы + пункт» — ассерт был бы вакуумным')
        const b = getComputedStyle(btn)
        const l = getComputedStyle(leaf)
        return {
          btnSize: b.fontSize,
          leafSize: l.fontSize,
          btnPadY: b.paddingTop,
          leafPadY: l.paddingTop,
          btnPadX: b.paddingRight,
          btnRadius: b.borderRadius,
          leafRadius: l.borderRadius,
          btnHeight: Math.round(btn.getBoundingClientRect().height),
          leafHeight: Math.round(leaf.getBoundingClientRect().height),
          // Иерархия держится ВЕСОМ, а не кеглем: заголовок группы должен
          // остаться тяжелее листа, иначе уровни сольются.
          btnWeight: b.fontWeight,
          leafWeight: l.fontWeight,
        }
      },
      [listId, listId]
    )

    // Единая сетка: заголовок группы и пункт под ним набраны одним кеглем.
    expect(shape.btnSize, `заголовок ${shape.btnSize} против пункта ${shape.leafSize}`).toBe(
      shape.leafSize
    )
    expect(shape.leafSize).toBe('13px')
    // Плотность та же: вертикальные поля, радиус и итоговая высота строки.
    expect(shape.btnPadY).toBe(shape.leafPadY)
    expect(shape.btnRadius).toBe(shape.leafRadius)
    expect(shape.btnHeight).toBe(shape.leafHeight)
    // ...но уровень всё ещё различим: заголовок тяжелее листа.
    expect(Number(shape.btnWeight)).toBeGreaterThan(Number(shape.leafWeight))

    // Шеврон не разъехался после уплотнения.
    const geometry = await groupButton.evaluate((el) => {
      const svg = el.querySelector('svg')
      const span = el.querySelector('span')
      if (!svg || !span) throw new Error('в заголовке группы нет шеврона или текста')
      const b = el.getBoundingClientRect()
      const s = svg.getBoundingClientRect()
      const t = span.getBoundingClientRect()
      return {
        btnW: b.width,
        svgW: s.width,
        svgH: s.height,
        inside: s.top >= b.top && s.bottom <= b.bottom && s.right <= b.right && s.left >= b.left,
        gapRight: b.right - s.right,
        textOverlapsChevron: t.right > s.left,
      }
    })
    // 🔴 Сначала доказываем, что мерили ЖИВУЮ геометрию: у скрытого сайдбара
    // (`hidden lg:block` на узком экране) все rect'ы нулевые, и проверки
    // «внутри» и «зазор не больше N» вырождаются в истину сами собой.
    expect(geometry.btnW).toBeGreaterThan(0)
    expect(geometry.svgW).toBeGreaterThan(0)
    expect(geometry.svgH).toBeGreaterThan(0)
    expect(geometry.inside, 'шеврон вылез за пределы кнопки').toBe(true)
    // Зазор справа — ровно поле кнопки: шеврон не прилип к краю и не уехал
    // внутрь. Сравнение с допуском: rect'ы приходят субпикселями (наблюдалось
    // 11.999998 против 12), точное равенство здесь давало бы флейк.
    expect(geometry.gapRight).toBeCloseTo(parseFloat(shape.btnPadX), 1)
    expect(geometry.textOverlapsChevron, 'текст заголовка налез на шеврон').toBe(false)
  })

  test('подписи KPI-плиток не обрезаются', async ({ page }) => {
    await signIn(page)
    await page.goto(`${APP}/dashboard/`)
    await expect(page.getByRole('heading', { name: 'Обзор' })).toBeVisible()

    const labels = page.locator('[data-slot="stat-label"]')
    // 🔴 Guard ДО содержательной проверки: getBoundingClientRect/scrollWidth на
    // СКРЫТОМ узле отдаёт нули с обеих сторон неравенства, и «обрезанных нет»
    // означает «я ничего не нашёл», а не «оформление верное».
    await expect(labels.first()).toBeVisible()
    const count = await labels.count()
    expect(count, 'ни одной KPI-плитки на экране — проверка была бы вакуумной').toBeGreaterThan(0)

    const clipped = await labels.evaluateAll((els) => {
      const visible = els.filter((el) => (el as HTMLElement).clientWidth > 0)
      if (visible.length === 0) {
        throw new Error('все data-slot="stat-label" скрыты — clientWidth=0 у всех')
      }
      return visible
        .filter((el) => el.scrollWidth > el.clientWidth + 1)
        .map((el) => `${el.textContent?.trim()} (${el.scrollWidth}>${el.clientWidth})`)
    })
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

      // 🔴 Font-size один в один совпадает с ручной версткой этих файлов
      // (text-[11px] уже стоял на th) — сам по себе ассерт вакуумен для
      // ЭТОГО набора маршрутов. Примитив TableHead ещё и заливает шапку
      // (bg-muted/50); ручная разметка — нет. Проверяем оба признака.
      const bg = await page
        .locator('thead th')
        .first()
        .evaluate((el) => getComputedStyle(el).backgroundColor)
      expect(bg, `на ${route} шапка таблицы не залита — значит не примитив`).not.toBe(
        'rgba(0, 0, 0, 0)'
      )
    })
  }

  // Task 10: аналитика (analytics, analytics/operations, ratings/analytics).
  // 🔴 `ratings/analytics/page.tsx` уже несёт `text-[11px] font-semibold
  // text-muted-foreground` на ручных th — проба по одному только font-size
  // зелёная и ДО перевода на примитив. TableHead жёстко даёт ещё и
  // `bg-muted/50` заливку шапки, которой у ручной разметки нет вовсе:
  // второй ассерт отличает переведённую таблицу от непереведённой там, где
  // первый бессилен.
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

      const bg = await page
        .locator('thead th')
        .first()
        .evaluate((el) => getComputedStyle(el).backgroundColor)
      expect(bg, `на ${route} шапка таблицы не залита — значит не примитив`).not.toBe(
        'rgba(0, 0, 0, 0)'
      )
    })
  }

  // 🔴 Минимальная ширина — ОСОЗНАННОЕ решение, а не случайность разметки: без
  // неё правые колонки на узком экране сжимаются до нечитаемости (в исходнике
  // рядом с `min-w-[48rem]` стоял комментарий именно об этом). При переводе на
  // примитив эта ширина уже однажды потерялась молча: `Table` даёт
  // `overflow-x-auto` сам, скролл не пропал, и ни один ассерт оформления
  // просадку не заметил. Проба меряет ЖИВУЮ ширину на узком окне, а не наличие
  // класса: класс мог бы стоять в разметке и не генерироваться сборкой.
  test('таблицы аналитики рейтинга не сжимаются на узком экране', async ({ page }) => {
    await signIn(page)
    await page.setViewportSize({ width: 640, height: 900 })
    await page.goto(`${APP}/security-ops/ratings/analytics/`)
    await expect(page.locator('thead th').first()).toBeVisible()

    const tables = page.locator('[data-slot="table"]')
    // Guard ДО содержательной проверки: на пустом множестве `evaluateAll`
    // вернул бы [], цикл ниже не выполнился бы ни разу и проба прошла бы на
    // пустом месте.
    const count = await tables.count()
    expect(count, 'на странице нет двух таблиц — проверка была бы вакуумной').toBe(2)

    const shapes = await tables.evaluateAll((els) =>
      els.map((el) => ({
        min: getComputedStyle(el).minWidth,
        rendered: Math.round(el.getBoundingClientRect().width),
      }))
    )

    for (const [index, shape] of shapes.entries()) {
      expect(shape.min, `таблица №${index + 1} потеряла min-width`).toBe('768px')
      // Окно уже минимума (640 < 768): таблица ОБЯЗАНА выйти за контейнер и
      // отдать скролл, а не ужаться. Ассерт по отрисованной ширине ловит и
      // случай, когда класс есть, но перебит чем-то снаружи.
      expect(
        shape.rendered,
        `таблица №${index + 1} сжалась до ${shape.rendered}px при минимуме 768px`
      ).toBeGreaterThanOrEqual(768)
    }
  })

  // Task 11: сырые таблицы слоя features (ratings dynamics, daily-grid,
  // changelog). Однородная шапка — единственный размер 11px.
  for (const route of ['/security-ops/daily-expense/', '/security-ops/changelog/']) {
    test(`features переведены на примитив: ${route}`, async ({ page }) => {
      await signIn(page)
      await page.goto(`${APP}${route}`)

      if (route === '/security-ops/daily-expense/') {
        // Грид не монтируется, пока не выбрано подразделение с личным
        // составом: у первого по алфавиту подразделения сотрудников может не
        // быть («Личный состав не загружен» вместо таблицы), поэтому перебор
        // идёт до первого варианта, где реально появляется строка грида.
        const division = page.locator('select').first()
        const options = division.locator('option')
        await expect(options.nth(1)).toBeAttached()
        const values = await options.evaluateAll((els) =>
          els
            .map((el) => (el as HTMLOptionElement).value)
            .filter((value) => value !== '')
        )
        for (const value of values) {
          await division.selectOption(value)
          const found = await page
            .locator('thead th')
            .first()
            .waitFor({ state: 'visible', timeout: 3000 })
            .then(() => true)
            .catch(() => false)
          if (found) break
        }
      }

      await expect(page.locator('thead th').first()).toBeVisible()

      const sizes = await page
        .locator('thead th')
        .evaluateAll((els) => [...new Set(els.map((el) => getComputedStyle(el).fontSize))])
      expect(sizes, `на ${route} шапка набрана не 11px`).toEqual(['11px'])

      const bg = await page
        .locator('thead th')
        .first()
        .evaluate((el) => getComputedStyle(el).backgroundColor)
      expect(bg, `на ${route} шапка таблицы не залита — значит не примитив`).not.toBe(
        'rgba(0, 0, 0, 0)'
      )
    })
  }

  // `OrgBoard` (`/dashboard/`) — особый случай: шапка НЕ однородна по
  // замыслу. Первые две строки — акцентные заголовки департамента и
  // заместителей с намеренным `!text-lg` поверх примитива (30px), остальные
  // — рядовые 11px `TableHead`. Проба проверяет ПРИМИТИВ по структурному
  // признаку (data-slot) и по факту заливки фона, а не по единственному
  // размеру шрифта — тот здесь заведомо смешанный.
  test('OrgBoard переведён на примитив: /dashboard/', async ({ page }) => {
    await signIn(page)
    await page.goto(`${APP}/dashboard/`)

    const heads = page.locator('[data-slot="table-head"]')
    await expect(heads.first()).toBeVisible()
    const count = await heads.count()
    expect(count, 'на /dashboard/ нет ни одной ячейки заголовка — проверка была бы вакуумной').toBeGreaterThan(0)

    const sizes = await heads.evaluateAll((els) => [
      ...new Set(els.map((el) => getComputedStyle(el).fontSize)),
    ])
    // Рядовые заголовки управлений/отделов обязаны нести 11px примитива;
    // акцентные (`!text-lg`) добавляют второй размер — оба ожидаемы.
    expect(sizes, 'на /dashboard/ шапка не несёт 11px примитива').toContain('11px')

    const bg = await heads
      .nth(count - 1)
      .evaluate((el) => getComputedStyle(el).backgroundColor)
    expect(
      bg,
      'на /dashboard/ последняя ячейка шапки (уровень отделов) не залита — значит не примитив'
    ).not.toBe('rgba(0, 0, 0, 0)')
  })

  // Task 12: хвост сырых таблиц (история отчётов, сводный отчёт по расходу).
  // Оба экрана уже несли text-[11px] явным классом на ручной разметке — проба
  // «размер 11px» одна вакуумна (см. уроки задач 9-11), поэтому вторым
  // ассертом проверяется фон шапки: TableHead даёт bg-muted/50, у ручной
  // разметки заливки нет.
  for (const route of ['/security-ops/service-reports/history/', '/reports/']) {
    test(`хвост переведён на примитив: ${route}`, async ({ page }) => {
      await signIn(page)
      await page.goto(`${APP}${route}`)

      if (route === '/reports/') {
        // Таблица расхода не монтируется на заход — она приезжает по клику
        // «Показать расход» после загрузки отчёта за выбранную (сегодняшнюю)
        // дату.
        await page.getByRole('button', { name: 'Показать расход' }).click()
      }

      await expect(page.locator('thead th').first()).toBeVisible()

      const heads = page.locator('thead th')
      const count = await heads.count()
      expect(count, `на ${route} нет ни одной ячейки заголовка — проверка была бы вакуумной`).toBeGreaterThan(0)

      const sizes = await heads.evaluateAll((els) => [...new Set(els.map((el) => getComputedStyle(el).fontSize))])
      expect(sizes, `на ${route} шапка набрана не 11px`).toEqual(['11px'])

      const bg = await heads
        .first()
        .evaluate((el) => getComputedStyle(el).backgroundColor)
      expect(bg, `на ${route} шапка таблицы не залита — значит не примитив`).not.toBe(
        'rgba(0, 0, 0, 0)'
      )
    })
  }
})
