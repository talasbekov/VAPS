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
})
