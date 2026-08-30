/**
 * Дашборд служебной учётки: ШТАТНОЕ состояние, а не сбой (Plane №340).
 *
 * Что было. Сводка по личному составу считается по подразделению СОТРУДНИКА, а
 * служебные учётки (`role_*`, их 28) к сотрудникам не привязаны — привязку
 * заводят вручную, сид её не делает. Ручка отвечала законным 400 «Пользователь
 * не привязан к сотруднику», а дашборд показывал «Не удалось загрузить сводку…
 * Повторить» — приглашение чинить то, что не сломано. Обход всех 28 учёток
 * 30.08.2026 нашёл это у КАЖДОЙ.
 *
 * Проба стережёт не текст ради текста, а РАЗЛИЧЕНИЕ: причина названа, кнопки
 * повтора нет (повтор ничего не изменит), и экран при этом не пуст.
 */
import { expect, test, type Page } from '@playwright/test'

const LIVE = process.env.SMOKE_LIVE === '1'
const APP = process.env.SMOKE_APP ?? 'http://localhost:3106'
const API = process.env.SMOKE_API ?? 'http://127.0.0.1:8100'
const PASSWORD = process.env.ROLE_ACCOUNTS_PASSWORD ?? ''
const ACCOUNT = 'role_viewer'

async function signIn(page: Page, username: string): Promise<void> {
  const api = page.context().request
  const csrf = (await (await api.get(`${APP}/api/auth/csrf/`)).json()) as { csrfToken: string }
  await api.post(`${APP}/api/auth/callback/credentials/`, {
    form: { csrfToken: csrf.csrfToken, username, password: PASSWORD, json: 'true' },
  })
}

test.describe(LIVE ? 'дашборд служебной учётки' : 'дашборд служебной учётки (скип: нет SMOKE_LIVE=1)', () => {
  test.skip(!LIVE, 'нужен живой стенд: SMOKE_LIVE=1')
  test.skip(PASSWORD === '', 'нужен ROLE_ACCOUNTS_PASSWORD')

  test('непривязанная учётка видит причину, а не предложение повторить', async ({ page }) => {
    // Предпосылка сверяется С СЕРВЕРОМ: привяжут учётку — проба проверяла бы
    // не то, и молчать об этом она не должна.
    const tokenRes = await fetch(`${API}/api/token/`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: ACCOUNT, password: PASSWORD }),
    })
    expect(tokenRes.status, `учётка ${ACCOUNT} не получила токен`).toBe(200)
    const { access } = (await tokenRes.json()) as { access: string }
    const stats = await fetch(`${API}/api/statuses/statuses/absence_statistics/`, {
      headers: { Authorization: `Bearer ${access}` },
    })
    test.skip(
      stats.status === 200,
      `учётку ${ACCOUNT} привязали к сотруднику — «непривязанной» больше нет`,
    )

    await signIn(page, ACCOUNT)
    await page.goto(`${APP}/dashboard`, { waitUntil: 'domcontentloaded' })

    await expect(
      page.getByText(/эта учётная запись с сотрудником не связана/),
    ).toBeVisible({ timeout: 30_000 })
    await expect(page.getByText('Не удалось загрузить сводку по личному составу')).toBeHidden()
    // Кнопки повтора у штатного состояния быть не должно: повтор ничего не
    // изменит, а её присутствие и делает состояние похожим на сбой.
    await expect(page.getByRole('button', { name: /Повторить/ })).toHaveCount(0)
  })
})
