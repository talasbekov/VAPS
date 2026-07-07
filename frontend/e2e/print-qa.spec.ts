// QA-расширение e2e печатного каркаса (8.8) — пробелы покрытия сверх смока
// AC 8 (print.spec.ts не трогаем: на его 5/5 ссылается Debug Log стори).
// Здесь — то, что судит ТОЛЬКО реальный браузер (jsdom CSS не парсит,
// Ловушка 11): auth-гейт и разводка вне AppLayout на продакшн-сборке (AC 1),
// жирный итог «Общее» и ИИН-маска контракта doc-print (AC 5), границы
// таблицы (AC 3), сохранность контента под print-медиа (AC 8г — скрывается
// только подсказка). Файл вне src/** — literal-пути легальны (ARCH-FE-012).
import { expect, test } from '@playwright/test'

test('(е) auth-гейт продакшн-сборки: без credential /print/test → редирект /login', async ({
  page,
}) => {
  // Сид credential НЕ ставим — это негативный контроль RequireAuth (AC 1)
  await page.goto('/print/test')
  await expect(page).toHaveURL(/\/login$/)
  await expect(page.getByLabel('Идентификатор (X-User-Id)')).toBeVisible()
  await expect(page.locator('.print-root')).toHaveCount(0)
})

test.describe('за credential', () => {
  // Сид ДО скриптов страницы (Ловушка 6) — как в print.spec.ts
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      sessionStorage.setItem(
        'vaps.credential',
        JSON.stringify({ kind: 'dev', userId: 'e2e-print-qa' }),
      )
    })
  })

  test('(ж) print-роут разведён ВНЕ AppLayout: ни сайдбара, ни шапки портала', async ({
    page,
  }) => {
    await page.goto('/print/test')
    await expect(page.locator('.print-root')).toBeVisible()
    // navigation-лендмарк сайдбара AppLayout отсутствует (сиблинг layout-route);
    // banner тоже нет — <header> печатной шапки внутри <main> banner'ом не является (HTML-AAM)
    await expect(page.getByRole('navigation')).toHaveCount(0)
    await expect(page.getByRole('banner')).toHaveCount(0)
  })

  test('(з) контракт doc-print: казахская шапка, ИИН-маска, жирное «Общее»', async ({
    page,
  }) => {
    await page.goto('/print/test')
    // Казахская шапка с реальными глифами cyrillic + cyrillic-ext (AC 5)
    await expect(
      page.getByRole('heading', {
        name: 'Жеке құрамның тәуліктік шығыс тізімі — баспа сынағы',
      }),
    ).toBeVisible()
    // ИИН — строго маска «****** + последние 4 цифры» в каждой строке
    const iins = await page
      .locator('.print-root tbody tr td:nth-child(5)')
      .allTextContents()
    expect(iins.length).toBeGreaterThan(0)
    for (const iin of iins) {
      expect(iin).toMatch(/^\*{6}\d{4}$/)
    }
    // Итог «Общее» — жирный и в печатной гарнитуре (computed style — e2e-судья)
    const total = page.locator('.print-root tfoot td', { hasText: 'Общее' })
    const totalStyle = await total.evaluate((el) => {
      const cs = getComputedStyle(el)
      return { weight: cs.fontWeight, family: cs.fontFamily }
    })
    expect(Number(totalStyle.weight)).toBeGreaterThanOrEqual(700)
    expect(totalStyle.family).toContain('PT Serif')
  })

  test('(и) границы таблицы печатного контракта: 1pt solid, border-collapse', async ({
    page,
  }) => {
    await page.goto('/print/test')
    const table = await page
      .locator('.print-root table')
      .evaluate((el) => getComputedStyle(el).borderCollapse)
    expect(table).toBe('collapse')
    // Tailwind preflight границы стёр — print.css обязан их задать сам (Ловушка 2)
    const cell = await page
      .locator('.print-root tbody td')
      .first()
      .evaluate((el) => {
        const cs = getComputedStyle(el)
        return { style: cs.borderTopStyle, width: parseFloat(cs.borderTopWidth) }
      })
    expect(cell.style).toBe('solid')
    expect(cell.width).toBeGreaterThan(0) // 1pt ≈ 1.33px
  })

  test('(к) print-медиа скрывает ТОЛЬКО подсказку — контент печатается', async ({
    page,
  }) => {
    await page.goto('/print/test')
    await page.emulateMedia({ media: 'print' })
    await expect(page.locator('.print-screen-hint')).toBeHidden()
    // Юридический артефакт остаётся на бумаге целиком
    await expect(page.locator('.print-root h1')).toBeVisible()
    await expect(page.locator('.print-root table')).toBeVisible()
    await expect(page.locator('.print-note')).toBeVisible()
  })
})
