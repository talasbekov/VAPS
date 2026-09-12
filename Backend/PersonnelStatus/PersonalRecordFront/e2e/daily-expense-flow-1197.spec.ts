/**
 * Проходка «Ежедневный расход» по замыслу заказчика (Plane №1197, 12.09.2026).
 *
 * Шаг 1 — начальник управления на `/statuses`: выбирает дату (по умолчанию
 * завтра сервера, можно любой день вперёд) и сдаёт день с той же страницы.
 * Шаг 2 — ответственный за сбор сил на `/employees?view=daily` видит таблицу
 * расхода департамента по бланку и индикатор сдачи управления.
 *
 * Проба ЖИВАЯ (стенд `:3106` + Django `:8100`): пишет настоящую сдачу за
 * свободную дату из 62-дневного окна, поэтому дату ищет сама — как
 * `main-daily-expense-walkthrough.spec.ts`. Снимки — `smoke-results/1197-*.png`.
 */
import fs from 'node:fs'
import { expect, test, type Page, type TestInfo } from '@playwright/test'

const LIVE = process.env.SMOKE_LIVE === '1'
const APP = process.env.SMOKE_APP ?? 'http://localhost:3106'
const API = process.env.SMOKE_API ?? 'http://127.0.0.1:8100'
const ROLE_PASSWORD = process.env.ROLE_ACCOUNTS_PASSWORD ?? ''
const HEAD = 'role_directorate_head'
const OFFICER = 'role_forces_gathering_officer'

async function token(username: string): Promise<string> {
  const response = await fetch(`${API}/api/token/`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username, password: ROLE_PASSWORD }),
  })
  expect(response.status, `учётка ${username} не получила токен`).toBe(200)
  return ((await response.json()) as { access: string }).access
}

async function getJson<T>(path: string, access: string): Promise<T> {
  const response = await fetch(`${API}${path}`, { headers: { Authorization: `Bearer ${access}` } })
  expect(response.status, `${path}: ${await response.clone().text()}`).toBe(200)
  return (await response.json()) as T
}

async function signIn(page: Page, username: string): Promise<void> {
  const csrf = await page.request.get(`${APP}/api/auth/csrf/`)
  const csrfToken = ((await csrf.json()) as { csrfToken: string }).csrfToken
  const response = await page.request.post(`${APP}/api/auth/callback/credentials/`, {
    form: { csrfToken, username, password: ROLE_PASSWORD, json: 'true' },
  })
  expect(((await response.json()) as { url: string }).url, `вход ${username}`).not.toContain('error=')
}

async function shot(page: Page, testInfo: TestInfo, name: string): Promise<void> {
  fs.mkdirSync('smoke-results', { recursive: true })
  const body = await page.screenshot({ path: `smoke-results/1197-${name}.png`, fullPage: true })
  await testInfo.attach(name, { body, contentType: 'image/png' })
}

function addDays(value: string, days: number): string {
  const date = new Date(`${value}T00:00:00Z`)
  date.setUTCDate(date.getUTCDate() + days)
  return date.toISOString().slice(0, 10)
}

function formatRu(value: string): string {
  const [y, m, d] = value.split('-')
  return `${d}.${m}.${y}`
}

test.describe('№1197 — проходка ежедневного расхода', () => {
  test.skip(!LIVE, 'нужен живой стенд: SMOKE_LIVE=1')
  test.skip(ROLE_PASSWORD === '', 'нет пароля ролевых учёток')
  test.setTimeout(180_000)

  test('начальник управления сдаёт день со «Статусов» на дату вперёд; ответственный видит сдачу', async ({ page }, testInfo) => {
    // ── Разведка по API: область роли и свободная дата ────────────────────
    const headToken = await token(HEAD)
    const me = await getJson<{ roles: { code: string; scope_division_id: number | null; scope_division_name: string | null }[] }>(
      '/api/operations/my-permissions/', headToken,
    )
    const scope = me.roles.find((role) => role.code === 'DIRECTORATE_HEAD' && role.scope_division_id !== null)
    expect(scope, 'у role_directorate_head нет области управления').toBeTruthy()
    const divisionId = scope!.scope_division_id as number
    const tomorrow = (await getJson<{ business_date: string }>('/api/operations/tomorrow-block/', headToken)).business_date

    let businessDate: string | null = null
    for (let offset = 5; offset < 60; offset += 1) {
      const candidate = addDays(tomorrow, offset)
      const list = await getJson<{ count: number }>(
        `/api/ops/daily/daily-submissions/?division_id=${divisionId}&business_date=${candidate}`, headToken,
      )
      if (list.count === 0) { businessDate = candidate; break }
    }
    expect(businessDate, 'в окне нет свободной даты').not.toBeNull()

    // ── Шаг 1: «Статусы сотрудников», дата по умолчанию — завтра сервера ──
    await signIn(page, HEAD)
    await page.goto(`${APP}/statuses`)
    const close = page.getByRole('region', { name: 'Сдача дня за управление' })
    await expect(close).toBeVisible({ timeout: 30_000 })
    await expect(close.locator('#status-business-date')).toHaveValue(tomorrow)
    await expect(close.getByText(/По умолчанию — завтра/)).toBeVisible()
    await expect(close.getByRole('button', { name: 'Сдать день' })).toBeVisible()
    await expect(page).not.toHaveURL(/businessDate=/)
    await shot(page, testInfo, '01-statuses-default-tomorrow')

    // ── Дата на 5+ дней вперёд: раньше клиент отказывал «только сегодня или завтра» ──
    await close.locator('#status-business-date').fill(businessDate as string)
    await expect(page).toHaveURL(new RegExp(`businessDate=${businessDate}`))
    await expect(close.getByText(`Выбрана дата ${formatRu(businessDate as string)}`)).toBeVisible()
    await close.getByRole('button', { name: 'Сдать день' }).click()
    await expect(close.getByText('Сдать можно только за сегодня или завтра.')).toHaveCount(0)
    await close.getByRole('button', { name: 'Подтвердить сдачу' }).click()
    await expect(close.getByText(/День сдан: v1/)).toBeVisible({ timeout: 20_000 })
    await shot(page, testInfo, '02-statuses-day-submitted')

    const after = await getJson<{ count: number }>(
      `/api/ops/daily/daily-submissions/?division_id=${divisionId}&business_date=${businessDate}`, headToken,
    )
    expect(after.count, 'сдача не дошла до сервера').toBe(1)

    // ── Шаг 2: ответственный за сбор сил видит сдачу управления на ту же дату ──
    const officerToken = await token(OFFICER)
    const officer = await getJson<{ roles: { code: string; scope_division_id: number | null }[] }>(
      '/api/operations/my-permissions/', officerToken,
    )
    const department = officer.roles.find((role) => role.code === 'FORCES_GATHERING_OFFICER')?.scope_division_id
    const divisions = await getJson<{ results: { id: string; parent_id: string | null; name: string }[] }>(
      `/api/ops/daily/divisions/?business_date=${businessDate}`, officerToken,
    )
    const own = divisions.results.find((row) => row.id === String(divisionId))
    const inDepartment = own !== undefined && own.parent_id === String(department)
    test.info().annotations.push({ type: 'scope', description: `управление ${divisionId} (${scope!.scope_division_name}) ${inDepartment ? 'в' : 'НЕ в'} департаменте ${department}` })

    await signIn(page, OFFICER)
    await page.goto(`${APP}/employees?view=daily&businessDate=${businessDate}`)
    const screen = page.getByRole('region', { name: 'Расход департамента' })
    await expect(screen).toBeVisible({ timeout: 30_000 })
    await expect(screen.getByText(/Сдали \d+ из \d+/)).toBeVisible({ timeout: 30_000 })
    // Таблица по бланку: «Руководство» первой строкой, «ИТОГО» последней, колонки бланка.
    await expect(screen.getByRole('row', { name: /Руководство департамента/ })).toBeVisible()
    await expect(screen.getByRole('row', { name: /ИТОГО по департаменту/ })).toBeVisible()
    for (const head of ['Штат', 'Список', 'В строю', 'Вакансии']) {
      await expect(screen.getByRole('columnheader', { name: head, exact: true })).toBeVisible()
    }
    if (inDepartment) {
      const name = scope!.scope_division_name as string
      // `has` — от корня страницы: локатор, уже сужённый регионом, внутри filter не находит вложенное.
      const row = screen.getByRole('row').filter({ has: page.getByRole('button', { name, exact: true }) })
      await expect(row).toBeVisible()
      await expect(row.getByRole('img', { name: 'Сдача: Сдано', exact: true })).toBeVisible()
      await shot(page, testInfo, '03-responsible-table')
      // Раскрытие: отделы вторым уровнем, под отделом — люди по статусам.
      await row.getByRole('button', { name, exact: true }).click()
      const sections = divisions.results.filter((item) => item.parent_id === String(divisionId))
      if (sections.length > 0) {
        const section = screen.getByRole('button', { name: sections[0].name, exact: true })
        await expect(section).toBeVisible()
        await section.click()
        await expect(screen.getByText(/Без отдельной отметки: в строю|Загрузка сотрудников/).first()).toBeVisible({ timeout: 20_000 })
      }
      await shot(page, testInfo, '04-responsible-expanded')
    } else {
      await shot(page, testInfo, '03-responsible-table')
    }
    // Свод — под таблицей, на том же экране.
    await expect(screen.getByRole('region', { name: 'Суточный свод' })).toBeVisible()
    // Режим «Диапазон»: плитки по датам, каждая со своим индикатором.
    await screen.getByRole('button', { name: 'Диапазон', exact: true }).click()
    await expect(page).toHaveURL(/dateFrom=/)
    const tiles = screen.getByRole('list', { name: 'Расход по датам' })
    await expect(tiles.getByRole('listitem')).toHaveCount(5, { timeout: 30_000 })
    await expect(tiles.getByRole('listitem').first()).toContainText(/сдали \d+ из \d+/)
    await shot(page, testInfo, '05-responsible-range')
    await screen.getByRole('button', { name: 'День', exact: true }).click()
    await expect(page).not.toHaveURL(/dateFrom=/)
  })
})
