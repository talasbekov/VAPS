/**
 * Раскрытые списки управлений и отделов показывают ТОЛЬКО людей со статусом
 * не «в строю» (Plane №1234, поручение заказчика 12.09.2026, `[РАСХ-РШ-12]`),
 * на обоих экранах свода; остальных раскрывает ссылка «Показать всех».
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

test.describe('№1234 — в списках управлений только люди не «в строю»', () => {
  test.skip(!LIVE, 'нужен живой стенд: SMOKE_LIVE=1')
  test.skip(ROLE_PASSWORD === '', 'нет пароля ролевых учёток')

  test('ответственный: отдел раскрывается без «в строю», «Показать всех» раскрывает остальных', async ({ page }) => {
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
    await expect(people.filter({ hasText: 'в строю' })).toHaveCount(0)
    const showAll = screen.getByRole('button', { name: /^Показать всех/ })
    if ((await showAll.count()) > 0) {
      await showAll.first().click()
      await expect(people.filter({ hasText: 'в строю' }).first()).toBeVisible()
    } else {
      // Все в отделе со статусом — раскрывать некого; сам список не пуст.
      expect(await people.count()).toBeGreaterThan(0)
    }
  })

  test('дежурный: лист раскрывается без «В строю» в бейджах', async ({ page }) => {
    test.setTimeout(120_000)
    await signIn(page, 'role_duty_officer')
    await page.goto(`${APP}/security-ops/service-summary`, { waitUntil: 'domcontentloaded' })
    const region = page.getByRole('region', { name: 'Свод по Службе', exact: true })
    const table = region.getByRole('table', { name: 'Служба по департаментам' })
    await expect(table).toBeVisible({ timeout: 30_000 })
    let found = false
    for (let step = 0; step < 10 && !found; step += 1) {
      const next = table.getByRole('button', { name: /^Раскрыть: (?!Руководство)/ }).first()
      if ((await next.count()) === 0) break
      await next.click()
      await expect(table.getByText('Загрузка личного состава…')).toHaveCount(0, { timeout: 10_000 })
      const list = table.locator('ul[role="list"]')
      const empty = table.getByText('Все в строю — отклонений нет')
      if ((await list.count()) > 0 || (await empty.count()) > 0) found = true
    }
    expect(found, 'ни один лист не раскрылся').toBe(true)
    const badges = table.locator('ul[role="list"] li').filter({ hasText: /^.*В строю$/ })
    await expect(table.locator('ul[role="list"] li').filter({ has: page.getByText('В строю', { exact: true }) })).toHaveCount(0)
    expect(await badges.count()).toBe(0)
  })
})
