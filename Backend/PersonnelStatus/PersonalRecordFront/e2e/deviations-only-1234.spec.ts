/**
 * Требования 07.10.2026: расход подразделения раскрывает полный состав,
 * свод Службы раскрывает числовые итоги и показывает поимённо руководство.
 *
 * Проба ЖИВАЯ и только читает.
 */
import { expect, test, type Page } from '@playwright/test'

const LIVE = process.env.SMOKE_LIVE === '1'
const APP = process.env.SMOKE_APP ?? 'http://localhost:3106'
const ROLE_PASSWORD = process.env.ROLE_ACCOUNTS_PASSWORD ?? ''

async function signIn(page: Page, username: string): Promise<void> {
  const csrf = await page.request.get(`${APP}/api/auth/csrf/`)
  const csrfToken = ((await csrf.json()) as { csrfToken: string }).csrfToken
  const response = await page.request.post(`${APP}/api/auth/callback/credentials/`, {
    form: { csrfToken, username, password: ROLE_PASSWORD, json: 'true' },
  })
  expect(((await response.json()) as { url: string }).url, `вход ${username}`).not.toContain('error=')
}

test.describe('№1234 — состав расхода и числовой свод Службы', () => {
  test.skip(!LIVE, 'нужен живой стенд: SMOKE_LIVE=1')
  test.skip(ROLE_PASSWORD === '', 'нет пароля ролевых учёток')

  test('ответственный: отдел раскрывается до полного состава', async ({ page }) => {
    test.setTimeout(120_000)
    await signIn(page, 'role_forces_gathering_officer')
    await page.goto(`${APP}/employees?view=daily`, { waitUntil: 'networkidle' })
    const screen = page.getByRole('region', { name: 'Расход департамента' })
    const table = screen.getByRole('table')
    await expect(table).toBeVisible({ timeout: 60_000 })
    await table.getByRole('button', { expanded: false }).filter({ hasNotText: 'Руководство департамента' }).first().click()
    const section = table.getByRole('button', { expanded: false }).filter({ hasNotText: 'Руководство департамента' }).first()
    if ((await section.count()) > 0) await section.click()
    await expect(screen.getByText('Загрузка сотрудников…')).toHaveCount(0, { timeout: 30_000 })
    const people = screen.locator('[data-slot="person"]')
    expect(await people.count()).toBeGreaterThan(0)
    await expect(screen.getByRole('button', { name: /^Показать всех/ })).toHaveCount(0)
  })

  test('дежурный: раскрытие дерева не добавляет поимённые списки обычных сотрудников', async ({ page }) => {
    test.setTimeout(120_000)
    await signIn(page, 'role_duty_officer')
    await page.goto(`${APP}/security-ops/service-summary`, { waitUntil: 'domcontentloaded' })
    const region = page.getByRole('region', { name: 'Свод по Службе', exact: true })
    const table = region.getByRole('table', { name: 'Служба по департаментам' })
    await expect(table).toBeVisible({ timeout: 30_000 })
    await expect(table.getByText('Загрузка личного состава…')).toHaveCount(0, { timeout: 30_000 })
    const leadershipLists = await table.locator('ul[role="list"]').count()
    for (let step = 0; step < 10; step += 1) {
      const next = table.getByRole('button', { name: /^Раскрыть: (?!Руководство)/ }).first()
      if ((await next.count()) === 0) break
      await next.click()
      await expect(table.getByText('Загрузка личного состава…')).toHaveCount(0, { timeout: 10_000 })
      await expect(table.locator('ul[role="list"]')).toHaveCount(leadershipLists)
    }
    await expect(table.getByRole('button', { name: /^Показать всех/ })).toHaveCount(0)
  })
})
