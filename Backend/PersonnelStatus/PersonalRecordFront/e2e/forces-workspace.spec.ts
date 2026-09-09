import { expect, test, type Page } from '@playwright/test'

const APP = process.env.SMOKE_APP ?? 'http://localhost:3106'
const PASSWORD = process.env.ACCESS_MATRIX_PASSWORD ?? ''

async function signIn(page: Page, username: string) {
  const api = page.context().request
  const csrf = await (await api.get(`${APP}/api/auth/csrf/`)).json()
  const response = await api.post(`${APP}/api/auth/callback/credentials/`, {
    form: { csrfToken: csrf.csrfToken, username, password: PASSWORD, json: 'true' },
  })
  expect(response.ok()).toBe(true)
  const result = await response.json()
  expect(result.url, 'вход ролевой учётки завершился ошибкой').not.toContain('error=')
}

test.describe('рабочие места сбора сил', () => {
  test.setTimeout(60_000)
  test.skip(process.env.SMOKE_LIVE !== '1', 'нужен живой стенд')

  test('ответственный попадает на рабочий стол и выбирает отдельные процессы', async ({ page }) => {
    await signIn(page, 'acc_forces_officer')
    await page.goto(`${APP}/employees?businessDate=2026-09-10`)
    await expect(page.getByRole('heading', { name: 'Рабочий стол', exact: true })).toBeVisible({ timeout: 30_000 })
    const nav = page.getByRole('navigation', { name: 'Рабочее место' })
    await expect(nav.getByRole('link', { name: 'Ежедневный расход', exact: true })).toBeVisible()
    await nav.getByRole('link', { name: 'Сбор сил на ОМ', exact: true }).click()
    await expect(page).toHaveURL(/view=forces/)
    await expect(page).toHaveURL(/businessDate=2026-09-10/)
    await expect(page.getByRole('button', { name: 'Ежедневный расход организации' })).toHaveCount(0)
    await nav.getByRole('link', { name: 'Рабочий стол', exact: true }).click()
    await expect(page.getByRole('heading', { name: 'Рабочий стол', exact: true })).toBeVisible()
  })

  test('штаб попадает в распределения', async ({ page }) => {
    await signIn(page, 'acc_ops_staff')
    await page.goto(`${APP}/employees`)
    await expect(page.getByRole('heading', { name: 'Распределения', exact: true })).toBeVisible({ timeout: 30_000 })
    await expect(page.getByRole('button', { name: 'Ежедневный расход организации' })).toHaveCount(0)
  })

  test('начальник управления сохраняет прежний гейт раздела сбора сил', async ({ page }) => {
    await signIn(page, 'acc_dir_head')
    await page.goto(`${APP}/employees`)
    // This account has forces.select, not forces.allocate/forces.command.
    // The legacy page denies it once permissions resolve; checking a tab
    // before that response only tested its temporary loading flash.
    await expect(page.getByText('Недостаточно прав для просмотра сбора сил на ОМ.', { exact: true })).toBeVisible({ timeout: 30_000 })
    await expect(page.getByRole('navigation', { name: 'Рабочее место' })).toHaveCount(0)
  })

  test('ошибка прав закрывает экран; повтор открывает рабочее место', async ({ page }) => {
    await signIn(page, 'acc_forces_officer')
    await page.route('**/api/operations/my-permissions/**', route => route.fulfill({
      status: 503, contentType: 'application/json', body: JSON.stringify({ detail: 'Temporarily unavailable' }),
    }))
    await page.goto(`${APP}/employees`)
    await expect(page.getByRole('heading', { name: 'Доступ закрыт' })).toBeVisible({ timeout: 20_000 })
    await expect(page.getByRole('heading', { name: 'Рабочий стол', exact: true })).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Ежедневный расход организации' })).toHaveCount(0)
    await page.unroute('**/api/operations/my-permissions/**')
    await page.getByRole('button', { name: 'Повторить', exact: true }).click()
    await expect(page.getByRole('heading', { name: 'Рабочий стол', exact: true })).toBeVisible()
  })

  test('ошибка запросов не превращается в нулевые показатели', async ({ page }) => {
    await signIn(page, 'acc_forces_officer')
    await page.route('**/api/ops/security-events/forces/requests/**', route => route.fulfill({
      status: 503, contentType: 'application/json', body: JSON.stringify({ detail: 'Temporarily unavailable' }),
    }))
    await page.goto(`${APP}/employees`)
    const requests = page.getByRole('article', { name: 'Входящие запросы Штаба' })
    await expect(requests.getByText('Не удалось получить запросы Штаба', { exact: true })).toBeVisible({ timeout: 20_000 })
    await expect(requests.getByText('Активных', { exact: true })).toHaveCount(0)
    await page.unroute('**/api/ops/security-events/forces/requests/**')
    await requests.getByRole('button', { name: 'Повторить', exact: true }).click()
    await expect(requests.getByText('Активных', { exact: true })).toBeVisible()
  })
})
