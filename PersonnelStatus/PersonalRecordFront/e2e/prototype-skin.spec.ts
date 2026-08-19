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
