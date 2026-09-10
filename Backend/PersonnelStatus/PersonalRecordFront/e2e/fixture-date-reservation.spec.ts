/**
 * Бронь даты e2e — не админская лазейка: её получает обычная персона,
 * имеющая `event.create`, и тем же браузерным путём заводит и читает ОМ.
 */
import { expect, test, type Page } from '@playwright/test'
import { uniqueBusinessDate } from './business-date'

const LIVE = process.env.SMOKE_LIVE === '1'
const APP = process.env.SMOKE_APP ?? 'http://localhost:3106'
const API = process.env.SMOKE_API ?? 'http://127.0.0.1:8100'
const PASSWORD = process.env.ACCESS_MATRIX_PASSWORD ?? ''
const USERNAME = 'acc_employee_d2'

async function token(): Promise<string> {
  const response = await fetch(`${API}/api/token/`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username: USERNAME, password: PASSWORD }),
  })
  const body = (await response.json()) as { access?: string }
  expect(response.status, 'не удалось войти не-администратором').toBe(200)
  expect(body.access).toBeDefined()
  return body.access!
}

async function signIn(page: Page): Promise<void> {
  const api = page.context().request
  const csrf = (await (await api.get(`${APP}/api/auth/csrf/`)).json()) as { csrfToken: string }
  await api.post(`${APP}/api/auth/callback/credentials/`, {
    form: { csrfToken: csrf.csrfToken, username: USERNAME, password: PASSWORD, json: 'true' },
  })
}

test.describe(LIVE ? 'бронь e2e-деловой даты' : 'бронь e2e-деловой даты (скип: нет SMOKE_LIVE=1)', () => {
  test.skip(!LIVE, 'нужен живой стек: SMOKE_LIVE=1')
  test.skip(PASSWORD === '', 'нужен ACCESS_MATRIX_PASSWORD для не-администратора')

  test('не-администратор бронирует дату, создаёт и читает ОМ в браузере (Plane №890)', async ({ page }) => {
    // Если global setup не передал дочернему worker DB-бронь его запуска,
    // helper упадёт здесь до подготовки ОМ вместо тихого возврата к random.
    expect(uniqueBusinessDate()).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    const access = await token()
    const reservation = await fetch(`${API}/api/ops/security-events/fixture-date/`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${access}`, 'content-type': 'application/json' },
      body: '{}',
    })
    const { businessDate } = (await reservation.json()) as { businessDate?: string }
    expect(reservation.status).toBe(201)
    expect(businessDate).toMatch(/^\d{4}-\d{2}-\d{2}$/)

    const title = `Бронь даты №890 ${Date.now()}`
    await signIn(page)
    await page.goto(`${APP}/security-ops/events/`)
    await page.getByRole('button', { name: '+ Создать бюллетень' }).click()
    const dialog = page.getByRole('dialog')
    await dialog.getByLabel('Название ОМ').fill(title)
    await dialog.getByRole('button', { name: 'Внутреннее' }).click()
    await dialog.getByLabel('Дата начала').fill(businessDate!)
    await dialog.getByLabel('Дата окончания').fill(businessDate!)
    await dialog.getByLabel('Охраняемые лица').click()
    await page.locator('[data-slot="persons-combobox"] li button').first().click()
    await dialog.getByRole('button', { name: 'Создать бюллетень' }).click()
    await expect(dialog).toBeHidden({ timeout: 20_000 })

    const read = page.waitForResponse((response) =>
      response.request().method() === 'GET' && response.url().includes('/api/ops/security-events/?search='),
    )
    await page.goto(`${APP}/security-ops/events/?search=${encodeURIComponent(title)}`)
    const payload = (await (await read).json()) as { results: { title: string; businessDate: string }[] }
    expect(payload.results.find((event) => event.title === title)?.businessDate).toBe(businessDate)
    await expect(page.locator('tbody tr').first()).toContainText(title)
  })
})
