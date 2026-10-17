/**
 * Дашборд служебной учётки читает область status.view независимо от
 * кадровой связи (UC-ADM-006). Отсутствующий персональный профиль — 404
 * EMPLOYEE_NOT_LINKED; сводка по области гранта при этом доступна.
 * См. backend test_absence_statistics_use_grant_without_employee_link.
 */
import { expect, test, type Page } from '@playwright/test'

const LIVE = process.env.SMOKE_LIVE === '1'
const APP = process.env.SMOKE_APP ?? 'http://localhost:3106'
const API = process.env.SMOKE_API ?? 'http://127.0.0.1:8100'
const PASSWORD = process.env.UNLINKED_PASSWORD ?? process.env.ROLE_ACCOUNTS_PASSWORD ?? ''
const ACCOUNT = process.env.UNLINKED_USERNAME ?? 'role_viewer'

async function signIn(page: Page, username: string): Promise<void> {
  const api = page.context().request
  const csrf = (await (await api.get(`${APP}/api/auth/csrf/`)).json()) as { csrfToken: string }
  const response = await api.post(`${APP}/api/auth/callback/credentials/`, {
    form: { csrfToken: csrf.csrfToken, username, password: PASSWORD, json: 'true' },
  })
  expect(response.status(), `вход непривязанной учётки ${username} не принят`).toBe(200)
}

test.describe(LIVE ? 'дашборд служебной учётки' : 'дашборд служебной учётки (скип: нет SMOKE_LIVE=1)', () => {
  test.skip(!LIVE, 'нужен живой стенд: SMOKE_LIVE=1')
  test.skip(PASSWORD === '', 'нужен ROLE_ACCOUNTS_PASSWORD')

  test('непривязанная учётка видит сводку по области своего гранта', async ({ page }) => {
    // Предпосылка сверяется С СЕРВЕРОМ: привяжут учётку — проба проверяла бы
    // не то, и молчать об этом она не должна.
    const tokenRes = await fetch(`${API}/api/token/`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: ACCOUNT, password: PASSWORD }),
    })
    expect(tokenRes.status, `учётка ${ACCOUNT} не получила токен`).toBe(200)
    const { access } = (await tokenRes.json()) as { access: string }
    const profile = await fetch(`${API}/api/ops/personnel/me/`, {
      headers: { Authorization: `Bearer ${access}` },
    })
    expect(profile.status, 'предусловие: служебная учётка не связана с сотрудником').toBe(404)
    expect(((await profile.json()) as { error_code: string }).error_code).toBe('EMPLOYEE_NOT_LINKED')
    const stats = await fetch(`${API}/api/statuses/statuses/absence_statistics/`, {
      headers: { Authorization: `Bearer ${access}` },
    })
    expect(stats.status, 'статистика определяется грантом status.view').toBe(200)
    const statistics = (await stats.json()) as { staff_count: number; total_absences: number }
    expect(statistics.staff_count).toBeGreaterThan(0)

    await signIn(page, ACCOUNT)
    await page.goto(`${APP}/dashboard`, { waitUntil: 'domcontentloaded' })

    // Compact dashboard summary pairs its labels and values in a dl.
    const staff = page.locator('dl > div', {
      has: page.getByText('Всего сотрудников', { exact: true }),
    })
    await expect(staff.getByRole('definition')).toHaveText(String(statistics.staff_count), { timeout: 30_000 })
    const absences = page.locator('dl > div', {
      has: page.getByText('Всего отсутствий', { exact: true }),
    })
    await expect(absences.getByRole('definition')).toHaveText(String(statistics.total_absences))
    await expect(page.getByText(/эта учётная запись с сотрудником не связана/)).toBeHidden()
    await expect(page.getByText('Не удалось загрузить сводку по личному составу')).toBeHidden()
    await expect(page.getByRole('button', { name: /Повторить/ })).toHaveCount(0)
  })
})
