// E2e-смок печатного каркаса (8.8, AC 8) — единственный судья computed styles
// и реальной загрузки шрифтов (jsdom CSS не парсит — Ловушка 11). Файл вне
// src/** — literal-пути в goto() легальны (правило ARCH-FE-012 видит только src).
import { expect, test } from '@playwright/test'

// Сид credential ДО скриптов страницы (Ловушка 6): addInitScript исполняется
// до init модуля credential.ts (гидратация на import) — page.evaluate после
// load опоздал бы, RequireAuth уже средиректил бы на /login.
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    sessionStorage.setItem(
      'vaps.credential',
      JSON.stringify({ kind: 'dev', userId: 'e2e-print-smoke' }),
    )
  })
})

test('(а) DOM-скан /print/test: ни одного класса вне print-*', async ({
  page,
}) => {
  await page.goto('/print/test')
  await expect(page.locator('.print-root')).toBeVisible()
  const offenders = await page.evaluate(() =>
    Array.from(document.querySelectorAll('*'))
      .flatMap((el) => Array.from(el.classList))
      .filter((cls) => !cls.startsWith('print-')),
  )
  expect(offenders).toEqual([])
})

test('(б) типографика печатного контракта: PT Serif, 16/12/8 pt', async ({
  page,
}) => {
  await page.goto('/print/test')
  const h1 = page.locator('.print-root h1')
  await expect(h1).toBeVisible()
  const h1Style = await h1.evaluate((el) => {
    const cs = getComputedStyle(el)
    return { family: cs.fontFamily, size: parseFloat(cs.fontSize) }
  })
  expect(h1Style.family).toContain('PT Serif')
  expect(h1Style.size).toBeCloseTo(21.33, 1) // 16pt ≈ 21.33px
  const bodySize = await page
    .locator('.print-root tbody td')
    .first()
    .evaluate((el) => parseFloat(getComputedStyle(el).fontSize))
  expect(bodySize).toBeCloseTo(16, 1) // 12pt = 16px
  const noteSize = await page
    .locator('.print-note')
    .evaluate((el) => parseFloat(getComputedStyle(el).fontSize))
  expect(noteSize).toBeCloseTo(10.67, 1) // 8pt ≈ 10.67px
})

test('(в) казахские глифы реально загружены из вендоренного woff2', async ({
  page,
}) => {
  await page.goto('/print/test')
  const loaded = await page.evaluate(async () => {
    await document.fonts.ready
    return {
      // Ә — сабсет cyrillic-ext; І — сабсет cyrillic (нужны ОБА)
      cyrillicExt: document.fonts.check('12pt "PT Serif"', 'Ә'),
      cyrillic: document.fonts.check('12pt "PT Serif"', 'І'),
    }
  })
  expect(loaded).toEqual({ cyrillicExt: true, cyrillic: true })
})

test('(г) @media print: экранная подсказка на бумагу не попадает', async ({
  page,
}) => {
  await page.goto('/print/test')
  await expect(page.locator('.print-screen-hint')).toBeVisible()
  await page.emulateMedia({ media: 'print' })
  const display = await page
    .locator('.print-screen-hint')
    .evaluate((el) => getComputedStyle(el).display)
  expect(display).toBe('none')
})

test('(д) негативный контроль утечки: /login БЕЗ PT Serif (скоуп .print-root держит портал чистым)', async ({
  page,
}) => {
  await page.goto('/login')
  await expect(
    page.getByLabel('Идентификатор (X-User-Id)'),
  ).toBeVisible()
  // body И заголовок: расскоупленный элементный селектор (h1 {…} вне
  // .print-root) отравил бы именно заголовки портала (Ловушка 1)
  const families = await page.evaluate(() => ({
    body: getComputedStyle(document.body).fontFamily,
    heading: getComputedStyle(document.querySelector('h1')!).fontFamily,
  }))
  expect(families.body).not.toContain('PT Serif')
  expect(families.heading).not.toContain('PT Serif')
})
