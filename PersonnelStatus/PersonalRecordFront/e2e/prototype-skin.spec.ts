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
    await expect(page.getByRole('heading', { name: 'Сбор сил на ОМ' })).toBeVisible()

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
    await expect(page.getByRole('heading', { name: 'Сбор сил на ОМ' })).toBeVisible()

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

  // Заголовок /security-ops/events/ покрыт единой таблицей HEADER_ROUTES в
  // конце файла вместе с остальными 29 статическими маршрутами — отдельный
  // тест на него был бы её дублем.

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
    // Экран берётся такой, где подпись крошки СОВПАДАЕТ с h1. У части
    // страниц это не так по замыслу («Журнал: сообщено → исправлено» в крошке
    // сокращён до «Журнал»), и проба на них сторожила бы сокращение, а не
    // проводку. «Охраняемые лица» — h1 и подпись сегмента дословно равны.
    await page.goto(`${APP}/security-ops/persons/`)
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

  // Категории заменили аккордеон 22.08.2026. Прежняя проба здесь меряла
  // плотность кнопки-заголовка против пункта — контрола больше нет вовсе,
  // и проба ушла вместе с ним: сравнивать стало нечего.
  test('категории меню нераскрываемые: все пункты видны сразу', async ({ page }) => {
    await signIn(page)
    await page.goto(`${APP}/security-ops/events/`)
    await expect(page.getByRole('heading', { name: 'Реестр ОМ' })).toBeVisible()

    const aside = page.locator('aside').first()
    await expect(aside).toBeVisible()
    // 🔴 Сначала доказываем, что сайдбар ЖИВОЙ: у скрытого (`hidden lg:block`
    // на узком экране) размеры нулевые, и всё ниже вырождается в истину само.
    expect(await aside.evaluate((el) => el.getBoundingClientRect().width)).toBeGreaterThan(0)

    // Ни одного раскрывающего контрола: категория — заголовок, а не кнопка.
    // Ассерт именно по aria-expanded, а не по отсутствию <button>: скрытое
    // состояние обязано быть слышно скринридеру, поэтому любой вернувшийся
    // аккордеон объявит себя этим атрибутом и здесь же попадётся.
    expect(await aside.locator('button[aria-expanded]').count()).toBe(0)

    // Порядок и состав категорий пинятся литерально: перестановка — это
    // смена информационной архитектуры, а не косметика, и должна быть видна
    // в диффе.
    const headings = aside.getByRole('heading', { level: 2 })
    await expect(headings).toHaveText([
      'Личный кабинет',
      'Ежедневный расход',
      'Объекты',
      'Охранные мероприятия',
      'Администрирование',
      'Обратная связь',
    ])

    // Капс — на CSS: в разметке естественный регистр, иначе теряются
    // акронимы («ОМ», «ГВО»). Playwright читает textContent и капса не видит,
    // поэтому проверяется отдельно вычисленным стилем.
    expect(
      await headings.first().evaluate((el) => getComputedStyle(el).textTransform)
    ).toBe('uppercase')

    // Под каждой категорией — непустой ВИДИМЫЙ список. Скрытый (свёрнутый)
    // список — ровно то состояние, которого больше не должно быть.
    const groups = await aside.evaluate((el) =>
      Array.from(el.querySelectorAll('h2')).map((h) => {
        const list = h.nextElementSibling as HTMLElement | null
        return {
          title: h.textContent ?? '',
          isList: list?.tagName === 'UL',
          links: list ? list.querySelectorAll('a').length : 0,
          height: list ? list.getBoundingClientRect().height : 0,
        }
      })
    )
    expect(groups.length).toBe(6)
    for (const group of groups) {
      expect(group.isList, `«${group.title}»: под заголовком не список`).toBe(true)
      expect(group.links, `«${group.title}»: пустая категория`).toBeGreaterThan(0)
      expect(group.height, `«${group.title}»: список свёрнут`).toBeGreaterThan(0)
    }

    // Сумма пунктов = число ссылок сайдбара: ни один пункт не спрятан мимо
    // категорий и ни один не отрисован дважды.
    const total = groups.reduce((sum, group) => sum + group.links, 0)
    expect(await aside.locator('a').count()).toBe(total)
    expect(total).toBe(19)
  })

  test('подсвечен один пункт — самый длинный подошедший адрес', async ({ page }) => {
    await signIn(page)

    // Вложенная пара: /security-ops/analytics (Аналитика службы) —
    // префикс /security-ops/analytics/operations (Аналитика ОМ). Наивный
    // startsWith зажигал бы оба, и «вы здесь» переставало быть местом.
    await page.goto(`${APP}/security-ops/analytics/operations/`)
    await expect(page.getByRole('heading', { name: 'Аналитика мероприятий', level: 1 })).toBeVisible()

    const aside = page.locator('aside').first()
    const current = aside.locator('a[aria-current="page"]')
    await expect(current).toHaveCount(1)
    await expect(current).toHaveText('Аналитика ОМ')

    // Родительский адрес зажигает СВОЙ пункт — иначе «самый длинный» можно
    // было бы получить, просто никогда не подсвечивая родителя.
    await page.goto(`${APP}/security-ops/analytics/`)
    await expect(
      page.getByRole('heading', { name: 'Состояние службы и личного состава', level: 1 })
    ).toBeVisible()
    await expect(aside.locator('a[aria-current="page"]')).toHaveText('Аналитика службы')
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
  for (const route of ['/security-ops/changelog/']) {
    test(`features переведены на примитив: ${route}`, async ({ page }) => {
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

  // `OrgBoard` (`/dashboard/`) НАМЕРЕННО не на примитиве: карточка «Структура
  // организации» откачена 21.08.2026 к прежнему виду — своя <table> со своей
  // плотностью и рамками. Перевод на Table/TableHead (19.08, 788ad0e0) заодно
  // снял горизонтальную прокрутку обёртки, из-за чего широкая доска вела себя
  // иначе.
  //
  // Стили при этом живут в CSS-МОДУЛЕ, а не в глобальном файле, каким они были
  // до 935a0f52: правила `tbody td`/`table`/`td:empty` вложены в `.board` и за
  // доску не выходят. Проба сторожит ОБА условия — вид вернулся, утечка нет
  // (сама утечка проверяется отдельным тестом переходом /dashboard → /employees).
  test('OrgBoard: своя таблица со scoped-стилями, а не примитив', async ({ page }) => {
    await signIn(page)
    await page.goto(`${APP}/dashboard/`)

    const board = page.locator('table').first()
    await expect(board).toBeVisible()
    // Примитива на доске быть не должно: он и есть откаченное состояние.
    await expect(page.locator('[data-slot="table"]')).toHaveCount(0)
    await expect(page.locator('[data-slot="table-head"]')).toHaveCount(0)

    const cells = board.locator('tbody td')
    const cellCount = await cells.count()
    expect(cellCount, 'на доске нет ни одной ячейки — проверка была бы вакуумной').toBeGreaterThan(0)

    // Плотность и рамка приезжают из модуля. Пустые клетки правило не трогает
    // (`td:empty` снимает рамку), поэтому мерка идёт по НЕПУСТОЙ ячейке.
    const filled = board.locator('tbody td:not(:empty)').first()
    await expect(filled).toBeVisible()
    const style = await filled.evaluate((el) => {
      const computed = getComputedStyle(el)
      return {
        minWidth: computed.minWidth,
        border: computed.borderBottomStyle,
        padding: computed.paddingTop,
      }
    })
    expect(style.minWidth, 'ячейка доски не несёт min-width из модуля').toBe('140px')
    expect(style.border, 'ячейка доски осталась без рамки модуля').toBe('solid')
    expect(style.padding, 'ячейка доски не несёт padding модуля').toBe('5px')

    // Класс обёртки ХЭШИРОВАН сборщиком — признак модуля. Голое `board`
    // означало бы возврат глобального файла, а с ним и утечки.
    // 🔴 Судим по ТОКЕНАМ класса, а не по вхождению подстроки: сборщик даёт
    // имя вида `org-board-module__myJ_sW__board`, где локальное имя стоит в
    // КОНЦЕ. Прежняя проверка искала «board, за которым нет буквы/цифры» и
    // краснела на исправном модуле — сторож кричал волками (22.08.2026).
    // Признак глобального CSS ровно один: токен, РАВНЫЙ «board».
    const wrapper = page.locator('div:has(> table)').first()
    const className = await wrapper.getAttribute('class')
    expect(className ?? '', 'на доске нет класса-обёртки').not.toBe('')
    const tokens = (className ?? '').split(/\s+/).filter(Boolean)
    expect(
      tokens.includes('board'),
      `класс обёртки не хэширован (${className}) — похоже на глобальный CSS вместо модуля`,
    ).toBe(false)
    expect(
      tokens.some((token) => token !== 'board' && token.includes('board')),
      `среди классов обёртки нет модульного имени доски (${className})`,
    ).toBe(true)
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

  // Task 13: ряд фильтров «Реестра ОМ» — поиск, селект этапа, две даты и
  // селект ответственного — должен иметь одну высоту на весь ряд, включая
  // кнопку «Сбросить фильтры».
  //
  // 🔴 Эта проба стережёт ПРАВИЛО компонента (`[&_button]:h-9 [&_input]:h-9
  // [&_select]:h-9` на самом FilterBar), а не случайное совпадение дефолтов
  // детей. Гарантия: селект «Этап» (app/security-ops/events/page.tsx) НЕ
  // несёт свой `h-9` в разметке — высоту ему навязывает исключительно ряд.
  // Если снести className у FilterBar целиком, этот селект просядет до
  // высоты браузерного `<select>` по умолчанию (не 36px) и тест обязан
  // упасть. Порог по числу контролов — `> 1`: на единственном контроле
  // `toHaveLength(1)` истинно тривиально и ничего не доказывает.
  test('контролы фильтров одной высоты', async ({ page }) => {
    await signIn(page)
    await page.goto(`${APP}/security-ops/events/`)
    const bar = page.locator('[data-slot="filter-bar"]')
    await expect(bar).toBeVisible()

    const controls = bar.locator('input, select, button')
    const count = await controls.count()
    expect(count, 'в ряду фильтров меньше двух контролов — сравнивать высоты было бы не с чем').toBeGreaterThan(1)

    const heights = await controls.evaluateAll((els) => [
      ...new Set(els.map((el) => Math.round(el.getBoundingClientRect().height))),
    ])
    expect(heights, `высоты контролов: ${heights.join(', ')}`).toHaveLength(1)
  })

  // Task 13: кнопка «Сбросить фильтры» должна ДЕЙСТВОВАТЬ, а не просто быть на
  // экране. Проверяются оба следствия сброса: адрес теряет параметры отбора И
  // список возвращается к полному. Одного мало — почистить адрес можно, не
  // перезапросив список, а перерисовать список можно, оставив мусор в адресе.
  //
  // Отбор задан этапом RECON: он заведомо уже страницы в 20 строк. Если
  // фикстура стенда съедет и записей на этом этапе не станет (или станет
  // больше страницы), ассерты ниже упадут ГРОМКО с числами в сообщении — это
  // дрейф фикстуры, а не молчаливо вакуумная проба.
  test('«Сбросить фильтры» очищает адрес и возвращает полный список', async ({ page }) => {
    await signIn(page)

    await page.goto(`${APP}/security-ops/events/`)
    await expect(page.getByRole('heading', { name: 'Реестр ОМ' })).toBeVisible()
    await expect(page.locator('tbody tr').first()).toBeVisible()
    const fullCount = await page.locator('tbody tr').count()
    expect(fullCount, 'реестр пуст без фильтров — сравнивать было бы не с чем').toBeGreaterThan(0)

    await page.goto(`${APP}/security-ops/events/?stage=RECON&from=2026-01-01`)
    await expect(page.locator('tbody tr').first()).toBeVisible()
    const filteredCount = await page.locator('tbody tr').count()
    expect(
      filteredCount,
      `отбор не сузил реестр: было ${fullCount}, стало ${filteredCount}`
    ).toBeLessThan(fullCount)
    expect(filteredCount, 'отбор обнулил реестр — сброс нечем отличить от ошибки').toBeGreaterThan(0)

    await page.getByRole('button', { name: 'Сбросить фильтры' }).click()

    await expect
      .poll(() => page.url(), { timeout: 15_000 })
      .not.toContain('stage=')
    expect(page.url(), 'в адресе остался период — сброс почистил не всё').not.toContain('from=')

    await expect
      .poll(() => page.locator('tbody tr').count(), { timeout: 15_000 })
      .toBe(fullCount)
  })

  // Task 14b: KPI-плитки на /employees/ и /statuses/ оставались на старой
  // ручной вёрстке (Card+CardHeader+иконка), пока /dashboard и /organization
  // уже несли `StatCard`. Тот же снаряд, что и «подписи KPI-плиток не
  // обрезаются» выше (строка ~272), но по этим двум маршрутам: плитки
  // действительно на `StatCard` (guard числа > 0, число набрано
  // 24px/800/tabular-nums) и подписи не обрезаются (scrollWidth <= clientWidth
  // с guard на пустое множество/clientWidth=0).
  for (const [route, heading] of [
    ['/employees/', 'Сбор сил на ОМ'],
    ['/statuses/', 'Управление статусами'],
  ] as const) {
    test(`KPI-плитки на StatCard: ${route}`, async ({ page }) => {
      await signIn(page)
      await page.goto(`${APP}${route}`)
      await expect(page.getByRole('heading', { name: heading, level: 1 })).toBeVisible()

      const cards = page.locator('[data-slot="stat-card"]')
      await expect(cards.first()).toBeVisible()
      const cardCount = await cards.count()
      expect(cardCount, `на ${route} нет ни одной [data-slot="stat-card"] — проверка была бы вакуумной`).toBeGreaterThan(0)

      const value = page.locator('[data-slot="stat-value"]').first()
      const shape = await value.evaluate((el) => {
        const cs = getComputedStyle(el)
        return { size: cs.fontSize, weight: cs.fontWeight, numeric: cs.fontVariantNumeric }
      })
      expect(shape.size, `на ${route} число плитки не 24px`).toBe('24px')
      expect(shape.weight, `на ${route} число плитки не весом 800`).toBe('800')
      expect(shape.numeric, `на ${route} число плитки не tabular-nums`).toContain('tabular-nums')

      const labels = page.locator('[data-slot="stat-label"]')
      await expect(labels.first()).toBeVisible()
      const labelCount = await labels.count()
      expect(labelCount, `на ${route} нет ни одной [data-slot="stat-label"] — проверка была бы вакуумной`).toBeGreaterThan(0)

      const clipped = await labels.evaluateAll((els) => {
        const visible = els.filter((el) => (el as HTMLElement).clientWidth > 0)
        if (visible.length === 0) {
          throw new Error('все data-slot="stat-label" скрыты — clientWidth=0 у всех')
        }
        return visible
          .filter((el) => el.scrollWidth > el.clientWidth + 1)
          .map((el) => `${el.textContent?.trim()} (${el.scrollWidth}>${el.clientWidth})`)
      })
      expect(clipped, `на ${route} обрезанные подписи: ${clipped.join('; ')}`).toEqual([])
    })
  }

  // Регрессия финальной проверки: PageHeader actions-слот (`shrink-0` без
  // `min-w-0`) не сжимался на узком экране и физически уезжал за вьюпорт —
  // кнопка первичного действия была недостижима на телефоне. Ассерт по
  // правому краю И блока actions, И самой кнопки внутри — обе точки должны
  // остаться в пределах вьюпорта.
  for (const [route, buttonName] of [
    ['/employees/', 'Добавить сотрудника'],
    ['/statuses/', 'Обновить'],
  ] as const) {
    test(`actions-слот PageHeader не обрезается на 375px: ${route}`, async ({ page }) => {
      await signIn(page)
      await page.setViewportSize({ width: 375, height: 900 })
      await page.goto(`${APP}${route}`)

      const actions = page.locator('[data-slot="page-header-actions"]')
      await expect(actions).toBeVisible()

      const button = page.getByRole('button', { name: buttonName })
      await expect(button).toBeVisible()

      const [actionsBox, buttonBox] = await Promise.all([
        actions.evaluate((el) => el.getBoundingClientRect().right),
        button.evaluate((el) => el.getBoundingClientRect().right),
      ])

      expect(
        actionsBox,
        `на ${route} блок actions уходит за правый край вьюпорта (375px): right=${actionsBox}`
      ).toBeLessThanOrEqual(375)
      expect(
        buttonBox,
        `на ${route} кнопка «${buttonName}» уходит за правый край вьюпорта (375px): right=${buttonBox}`
      ).toBeLessThanOrEqual(375)
    })
  }

  // Финальное ревью: `features/organization-structure/ui/org-board.styles.css`
  // — обычный (нескоупленный) .css, импортированный из OrgBoard.tsx. Чанк
  // маршрута /dashboard/ в App Router дописывает эти правила в документ при
  // клиентской навигации и НЕ снимает их при уходе с маршрута — `tbody td` и
  // `table` продолжают действовать на любой другой таблице, до которой потом
  // дошли кликом (без полной перезагрузки страницы).
  //
  // 🔴 Проба обязана перейти на /employees/ КЛИКОМ по пункту меню, а не через
  // page.goto — goto делает полную навигацию, которая эту утечку не ловит:
  // js-чанк /dashboard/ просто не грузится вовсе, и раз внесённые правила в
  // документе нечему было оставить.
  test('переход с /dashboard кликом не красит таблицу /employees чужим CSS', async ({ page }) => {
    await signIn(page)
    await page.goto(`${APP}/dashboard/`)
    // Ждём, что доска подразделений (носитель org-board.styles.css) реально
    // смонтирована — иначе чанк не гарантированно загружен.
    await expect(page.locator('table').first()).toBeVisible()

    // Путь ДВУМЯ клиентскими переходами: пункт меню ведёт на «Сбор сил на ОМ»
    await page.getByRole('link', { name: 'Сбор сил на ОМ' }).click()
    await expect(page).toHaveURL(new RegExp('/employees/?$'))

    const cell = page.locator('table tbody td').first()
    await expect(cell).toBeVisible()

    const style = await cell.evaluate((el) => {
      const cs = getComputedStyle(el)
      return { borderBottomColor: cs.borderBottomColor, minWidth: cs.minWidth }
    })

    expect(
      style.borderBottomColor,
      `ячейка таблицы /employees закрашена рамкой org-board.styles.css (утечка нескоупленного tbody td): ${style.borderBottomColor}`
    ).not.toBe('rgb(0, 0, 0)')
    expect(
      style.minWidth,
      `ячейка таблицы /employees унаследовала min-width:140px из org-board.styles.css`
    ).not.toBe('140px')
  })

  // ─────────────────────────────────────────────────────────────────────────
  // Единый сторож заголовков: ВСЕ статические маршруты приложения на одной
  // таблице.
  //
  // Раньше это были три отдельные группы (Task 5 — только /security-ops/events,
  // Task 14 — пять экранов легаси-портала, PH-1 — шесть экранов рейтинга) с
  // побайтово одинаковыми телами. Финальное ревью ветки отметило такое
  // дублирование как запах; здесь оно свёрнуто.
  //
  // 🔴 Заголовок ищется через getByRole(..., { level: 1 }), а НЕ по подстроке
  // текста: текстовый локатор поймал бы <p> с тем же словом.
  //
  // 🔴 Размер меряется через getComputedStyle, а НЕ проверкой класса в
  // className. Слой ui/* сгенерирован под Tailwind v4, а собирается 3.4.18 —
  // часть классов молча не генерируется, и ассерт «класс есть» был бы зелёным
  // на неработающем стиле.
  //
  // 🔴 Надзаголовок ассертится в ЕСТЕСТВЕННОМ регистре, а капс проверяется
  // отдельно через textTransform. Playwright читает textContent и не видит CSS
  // text-transform; проба, написанная капсом, заставила бы дублировать капс в
  // JSX через toUpperCase() — компонент начал бы терять регистр акронимов и
  // имён собственных (так уже случилось в Task 5 и откатывалось).
  const HEADER_ROUTES: Array<{ path: string; title: string; eyebrow: string }> = [
    // Легаси-портал
    { path: '/dashboard/', title: 'Обзор', eyebrow: 'Ежедневный расход' },
    { path: '/employees/', title: 'Сбор сил на ОМ', eyebrow: 'Ежедневный расход' },
    { path: '/organization/', title: 'Структура организации', eyebrow: 'Личный состав' },
    { path: '/statuses/', title: 'Управление статусами', eyebrow: 'Ежедневный расход' },
    { path: '/reports/', title: 'Отчеты', eyebrow: 'Ежедневный расход' },
    // Охранные мероприятия и объекты
    { path: '/security-ops/command-center/', title: 'Командный центр', eyebrow: 'Ежедневный расход' },
    { path: '/security-ops/events/', title: 'Реестр ОМ', eyebrow: 'Охранные мероприятия' },
    { path: '/security-ops/gvo/', title: 'Реестр ГВО', eyebrow: 'Охранные мероприятия' },
    { path: '/security-ops/persons/', title: 'Охраняемые лица', eyebrow: 'Охранные мероприятия' },
    { path: '/security-ops/objects/', title: 'Объекты и паспорта', eyebrow: 'Объекты' },
    { path: '/security-ops/laws/', title: 'Законы об ОМ', eyebrow: 'Охранные мероприятия' },
    // Рейтинг вне меню (экран остался по адресу) + аналитика и отчёты
    { path: '/security-ops/ratings/', title: 'Оперативный рейтинг', eyebrow: 'Оценка и отчётность' },
    { path: '/security-ops/ratings/workspace/', title: 'Оценивание участников', eyebrow: 'Оценка и отчётность' },
    { path: '/security-ops/ratings/evaluations/', title: 'Итоговые оценки участников', eyebrow: 'Оценка и отчётность' },
    { path: '/security-ops/ratings/export/', title: 'Выгрузка рейтинга', eyebrow: 'Оценка и отчётность' },
    { path: '/security-ops/ratings/audit/', title: 'Журнал оценивания', eyebrow: 'Оценка и отчётность' },
    { path: '/security-ops/ratings/analytics/', title: 'Аналитика рейтинга', eyebrow: 'Оценка и отчётность' },
    { path: '/security-ops/analytics/', title: 'Состояние службы и личного состава', eyebrow: 'Ежедневный расход' },
    { path: '/security-ops/analytics/operations/', title: 'Аналитика мероприятий', eyebrow: 'Охранные мероприятия' },
    { path: '/security-ops/service-reports/', title: 'Отчёты службы', eyebrow: 'Охранные мероприятия' },
    { path: '/security-ops/service-reports/history/', title: 'История отчётов', eyebrow: 'Охранные мероприятия' },
    // Администрирование
    { path: '/security-ops/dictionaries/', title: 'Справочники', eyebrow: 'Администрирование' },
    { path: '/security-ops/settings/', title: 'Настройки ОМ', eyebrow: 'Администрирование' },
    { path: '/security-ops/feedback/', title: 'Обратная связь', eyebrow: 'Обратная связь' },
    { path: '/security-ops/audit/', title: 'Аудит', eyebrow: 'Администрирование' },
    // Личный кабинет
    { path: '/security-ops/profile/', title: 'Мой профиль', eyebrow: 'Личный кабинет' },
  ]

  for (const { path, title, eyebrow } of HEADER_ROUTES) {
    test(`заголовок по прототипу: ${path}`, async ({ page }) => {
      await signIn(page)
      await page.goto(`${APP}${path}`)

      const h1 = page.getByRole('heading', { name: title, level: 1 })
      await expect(h1, `${path}: нет H1 «${title}»`).toBeVisible()

      const shape = await h1.evaluate((el) => {
        const cs = getComputedStyle(el)
        return { size: cs.fontSize, weight: cs.fontWeight }
      })
      expect(shape.size, `${path}: размер H1`).toBe('25px')
      expect(shape.weight, `${path}: вес H1`).toBe('700')

      // Ровно один H1 на странице: раскатка PageHeader не должна была
      // оставить прежний заголовок рядом с новым.
      const h1Count = await page.getByRole('heading', { level: 1 }).count()
      expect(h1Count, `${path}: на странице ${h1Count} заголовков H1`).toBe(1)

      const eyebrowEl = page.locator('[data-slot="page-eyebrow"]')
      await expect(eyebrowEl, `${path}: нет надзаголовка`).toHaveText(eyebrow)
      expect(
        await eyebrowEl.evaluate((el) => getComputedStyle(el).textTransform),
        `${path}: капс надзаголовка должен делать CSS`
      ).toBe('uppercase')
    })
  }

  // Детальные маршруты требуют живой записи в пути, поэтому идут отдельно:
  // идентификатор берётся из реестра, а не выдумывается. Заголовок здесь —
  // ИМЯ ЗАПИСИ, поэтому пинить текст нечем; проверяется только набор.
  const DETAIL_ROUTES: Array<{ registry: string; name: string }> = [
    { registry: '/security-ops/events/', name: 'карточка ОМ' },
    { registry: '/security-ops/objects/', name: 'карточка объекта' },
    { registry: '/security-ops/gvo/', name: 'карточка ГВО' },
  ]

  for (const { registry, name } of DETAIL_ROUTES) {
    test(`заголовок по прототипу: ${name}`, async ({ page }) => {
      await signIn(page)
      await page.goto(`${APP}${registry}`)

      // 🔴 Адрес записи вычисляем из разметки, а не кликаем по «первой ссылке
      // в таблице»: реестр объектов по умолчанию показывает КАРТОЧКИ, а не
      // таблицу (`view === 'cards'`, app/security-ops/objects/page.tsx:693), и
      // табличный локатор там не находит ничего. Отбрасываем ссылки на сам
      // реестр — иначе «переход» никуда не ведёт и проба падает по своей вине.
      // Реестр наливается запросом уже после монтирования, поэтому ссылку
      // ЖДЁМ, а не читаем сразу после goto: иначе guard сработает на пустой
      // странице и обвинит фикстуру вместо гонки.
      const readHref = () =>
        page.evaluate((base) => {
          const links = [...document.querySelectorAll<HTMLAnchorElement>('a[href]')]
            .map((a) => a.getAttribute('href') ?? '')
            .filter(
              (h) => h.startsWith(base) && h.replace(base, '').replace(/\/$/, '') !== ''
            )
          return links[0] ?? null
        }, registry)

      await expect
        .poll(readHref, {
          timeout: 20_000,
          message: `${name}: в реестре не появилось ни одной ссылки на запись — проба была бы вакуумной`,
        })
        .not.toBeNull()

      const href = await readHref()

      await page.goto(`${APP}${href}`)

      const h1 = page.getByRole('heading', { level: 1 }).first()
      await expect(h1, `${name}: нет H1`).toBeVisible()
      expect(
        await h1.evaluate((el) => getComputedStyle(el).fontSize),
        `${name}: размер H1`
      ).toBe('25px')
    })
  }
})
