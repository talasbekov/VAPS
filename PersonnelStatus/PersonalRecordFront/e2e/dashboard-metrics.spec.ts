/**
 * Сторож ЧЕСТНОСТИ блока «Показатели эффективности» на /dashboard.
 *
 * До 21.08.2026 карточка печатала три постоянных числа (87 % при цели 90 %,
 * 92 при 85, 94 при 95) — они не менялись никогда и ни из чего не выводились.
 * Теперь на их месте названы причины, почему системе нечего считать (тот же
 * приём, что у `unavailableKpi` в ops/passport.py).
 *
 * 🔴 Ассерт «на карточке нет процента» держит именно то, что чинилось:
 * вернётся любое выдуманное число с `%` — проба покраснеет. Проценты
 * соседних плиток он не задевает, потому что читает ТОЛЬКО эту карточку.
 */
import { expect, test, type Page } from '@playwright/test'
import { STAND_PASSWORD, STAND_USERNAME } from './stand-credentials'

const LIVE = process.env.SMOKE_LIVE === '1'
const APP = process.env.SMOKE_APP ?? 'http://localhost:3106'

async function signIn(page: Page, username = STAND_USERNAME, password = STAND_PASSWORD): Promise<void> {
  const api = page.context().request
  const csrf = (await (await api.get(`${APP}/api/auth/csrf/`)).json()) as { csrfToken: string }
  await api.post(`${APP}/api/auth/callback/credentials/`, {
    form: { csrfToken: csrf.csrfToken, username, password, json: 'true' },
  })
}

test.describe(LIVE ? 'дашборд: показатели эффективности' : 'дашборд: показатели (скип: нет SMOKE_LIVE=1)', () => {
  test.skip(!LIVE, 'нужен живой стек: SMOKE_LIVE=1')

  test('вместо выдуманных процентов — причины и ссылка на светофор', async ({ page }) => {
    await signIn(page)
    await page.goto(`${APP}/dashboard`)

    const card = page
      .locator('[data-slot="card"]')
      .filter({ hasText: 'Показатели эффективности' })
    // Карточка должна быть ровно одна: на двух locator.textContent() читал бы
    // первую, и ассерт «нет процента» мог бы оказаться про чужую карточку.
    await expect(card).toHaveCount(1)
    await expect(card).toBeVisible()

    for (const name of ['Эффективность обновления', 'Время ответа', 'Точность данных']) {
      await expect(card.getByText(name, { exact: true })).toBeVisible()
    }
    // Причина у каждого показателя, а не общая отписка одной строкой.
    await expect(card.locator('dd')).toHaveCount(3)

    const text = (await card.innerText()).replace(/\s+/g, ' ')
    expect(text, 'в карточке снова печатается процент — значит вернулось выдуманное число').not.toMatch(/\d\s*%/)

    // Слэш на конце дорисовывает сам Next (`trailingSlash: true` в
    // next.config.js) — в исходнике href написан без него. Пин литеральный, по
    // тому, что видит браузер.
    const link = card.getByRole('link', { name: /светофор/i })
    await expect(link).toHaveAttribute('href', '/security-ops/analytics/')
  })
})
