import { expect, test, type Page } from '@playwright/test'

const APP = process.env.SMOKE_APP ?? 'http://localhost:3346'
const PASSWORD = process.env.ROLE_ACCOUNTS_PASSWORD ?? ''
test.skip(process.env.SMOKE_LIVE !== '1' || !PASSWORD, 'Requires seeded role accounts')

async function signIn(page: Page, username: string) {
  const csrf = await (await page.request.get(`${APP}/api/auth/csrf/`)).json()
  const result = await page.request.post(`${APP}/api/auth/callback/credentials/`, {
    form: { csrfToken: csrf.csrfToken, username, password: PASSWORD, json: 'true' },
  })
  expect((await result.json()).url).not.toContain('error=')
  await page.route('**/api/**', route => {
    const request = route.request()
    if (['GET', 'HEAD', 'OPTIONS'].includes(request.method()) || new URL(request.url()).pathname.startsWith('/api/auth/')) return route.continue()
    return route.abort()
  })
}

test('a directorate head never chooses a child division as a department summary', async ({ page }) => {
  await signIn(page, 'role_directorate_head')
  const summaryTargets: string[] = []
  page.on('request', request => {
    const url = new URL(request.url())
    if (url.pathname.endsWith('/daily-submissions/') && url.searchParams.has('division_id')) summaryTargets.push(url.searchParams.get('division_id')!)
  })
  await page.goto(`${APP}/employees?view=daily`)
  const summary = page.getByRole('region', { name: 'Суточный свод', exact: true })
  await expect(summary).toContainText('Свод департамента собирает ответственный')
  await expect(summary.getByRole('button', { name: /отдел/ })).toHaveCount(0)
  expect(summaryTargets).toEqual([])
})

for (const [username, count] of [['role_directorate_head', 1], ['role_department_expense_officer', 4]] as const) {
  test(`${username}: submission progress counts directorates, not their child divisions`, async ({ page }) => {
    await signIn(page, username)
    await page.goto(`${APP}/employees?view=daily`)
    if (username === 'role_department_expense_officer') {
      await expect(page.getByText(new RegExp(`Сдали \\d+ из ${count}`), { exact: true })).toBeVisible()
      await expect(page.getByText('Управления раскрываются до отделов и людей. Сотрудники отделов включены в своё управление.')).toBeVisible()
    } else {
      await expect(page.getByText(new RegExp(`Сдано \\d+ из ${count} управлений на`))).toBeVisible()
    }
  })
}
