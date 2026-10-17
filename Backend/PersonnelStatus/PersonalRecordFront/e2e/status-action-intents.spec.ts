import { expect, test, type Page } from '@playwright/test'
import { STAND_PASSWORD, STAND_USERNAME } from './stand-credentials'
import { clickRowMenuItem, staffedRow } from './row-menu'
import { randomUUID } from 'node:crypto'

test.skip(process.env.SMOKE_LIVE !== '1', 'Requires an externally managed live stand')

async function signIn(page: Page) {
  const { csrfToken } = await (await page.request.get('/api/auth/csrf/')).json()
  const response = await page.request.post('/api/auth/callback/credentials/', {
    form: { csrfToken, username: STAND_USERNAME, password: STAND_PASSWORD, json: 'true' },
  })
  expect(response.ok()).toBeTruthy()
}

async function serverDates(page: Page) {
  const token = await page.request.post(`${process.env.SMOKE_API}/api/token/`, {
    data: { username: STAND_USERNAME, password: STAND_PASSWORD },
  })
  expect(token.status()).toBe(200)
  const { access } = await token.json()
  const response = await page.request.get(`${process.env.SMOKE_API}/api/operations/tomorrow-block/`, {
    headers: { Authorization: `Bearer ${access}` },
  })
  expect(response.status()).toBe(200)
  const { business_date: tomorrow } = await response.json()
  const today = new Date(`${tomorrow}T00:00:00Z`)
  today.setUTCDate(today.getUTCDate() - 1)
  return { today: today.toISOString().slice(0, 10), tomorrow: tomorrow as string, headers: { Authorization: `Bearer ${access}` } }
}

test('row change uses server today independently of the day-submission URL date', async ({ page }) => {
  await signIn(page)
  const { today, tomorrow } = await serverDates(page)
  await page.goto(`/statuses/?businessDate=${tomorrow}`)
  await clickRowMenuItem(page, staffedRow(page), 'Изменить статус')
  const dialog = page.getByRole('dialog', { name: 'Статусы сотрудника', exact: true })
  await expect(dialog.getByText(`Изменение статуса на сегодня: ${today}.`, { exact: true })).toBeVisible()
  await expect(dialog.getByText('Дата сдачи дня не меняет дату начала статуса.', { exact: true })).toBeVisible()
  await expect(dialog.getByText('Планирование на будущую дату', { exact: true })).toHaveCount(0)
})

test('future planning starts within planned statuses and allows a future in-service start', async ({ page }) => {
  await signIn(page)
  const { tomorrow } = await serverDates(page)
  await page.goto('/statuses/')
  await clickRowMenuItem(page, staffedRow(page), 'Запланированные статусы')
  const list = page.getByRole('dialog', { name: 'Запланированные статусы сотрудника', exact: true })
  await list.getByRole('button', { name: /^Запланировать статус/ }).click()
  const dialog = page.getByRole('dialog', { name: 'Статусы сотрудника', exact: true })
  await expect(dialog.getByText('Планирование на будущую дату', { exact: true })).toBeVisible()
  await dialog.getByRole('combobox').first().click()
  await page.getByRole('option', { name: 'В строю', exact: true }).click()
  const date = new Date(`${tomorrow}T12:00:00`)
  const dayLabel = date.toLocaleDateString('ru-RU', { day: '2-digit', month: 'long', year: 'numeric' }).replace(' г.', '')
  await expect(dialog.getByLabel('Дата начала', { exact: false })).toHaveText(new RegExp(dayLabel))
  await expect(dialog.getByLabel('Дата окончания', { exact: false })).toHaveCount(0)
  await expect(page.getByRole('dialog')).toHaveCount(1)
})

test('row actions remain inside the viewport when delayed real submission metadata moves the row', async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 1000 })
  await signIn(page)
  const { tomorrow, headers } = await serverDates(page)
  const divisionsResponse = await page.request.get(`${process.env.SMOKE_API}/api/ops/daily/divisions/?business_date=${tomorrow}`, { headers })
  expect(divisionsResponse.status()).toBe(200)
  const division = (await divisionsResponse.json()).results.find((row: { can_submit?: boolean; division_type?: string }) =>
    row.can_submit === true && row.division_type === 'directorate')
  expect(Boolean(division), 'A real authorized directorate is required to exercise summary expansion').toBe(true)
  let release!: () => void
  let received = false
  const pending = new Promise<void>(resolve => { release = resolve })
  await page.route('**/api/ops/daily/divisions/**', async route => {
    const response = await route.fetch()
    received = true
    await pending
    await route.fulfill({ response })
  })
  try {
    await page.goto(`/statuses/?businessDate=${tomorrow}&submitDivision=${division.id}`)
    await expect.poll(() => received, { timeout: 10_000, message: 'Real submission metadata was requested' }).toBe(true)
    const row = page.locator('table tbody tr[data-employee-id]')
      .filter({ hasNot: page.getByText('ВАКАНТ') }).nth(8)
    // Radix makes the background aria-hidden while its modal menu is open.
    // Keep the DOM anchor observable during the delayed background response.
    const trigger = row.locator('button[data-slot="dropdown-menu-trigger"]')
    await expect(trigger).toBeVisible()
    await trigger.evaluate(element => {
      window.scrollBy(0, element.getBoundingClientRect().bottom - window.innerHeight + 8)
    })
    await trigger.click()
    const menu = page.getByRole('menu')
    await expect(menu).toBeVisible()
    const before = await trigger.boundingBox()
    release()
    await expect(page.locator('select[aria-label="Управление для сдачи дня"]')).toBeVisible()
    await expect.poll(async () => (await trigger.boundingBox())!.y, { timeout: 10_000 })
      .toBeGreaterThan(before!.y + 20)
    await expect.poll(async () => {
      const box = await menu.boundingBox()
      return box !== null && box.x >= 0 && box.y >= 0 && box.x + box.width <= 1600 && box.y + box.height <= 1000
    }, { timeout: 5_000, message: 'The entire open row menu must remain in the viewport after the real panel expands' }).toBe(true)
    await menu.getByRole('menuitem', { name: 'Изменить статус', exact: true }).click({ timeout: 5_000 })
    await expect(page.getByRole('dialog', { name: 'Статусы сотрудника', exact: true })).toBeVisible()
  } finally {
    release()
  }
})

test('one session persists a current change and future in-service plan without replacing the current status', async ({ page }) => {
  test.skip(process.env.STATUS_INTENT_MUTATION !== '1', 'Requires explicit disposable copied-database mutation authorization')
  expect(process.env.SMOKE_APP).toBe('http://127.0.0.1:3350')
  expect(process.env.SMOKE_API).toBe('http://127.0.0.1:18349')
  const copiedStands: Record<string, string> = {
    smart_complete_20261008: 'smart-complete-20261008-backend-1',
    smart_refine_20261008: 'smart-refine-20261008-backend-1',
  }
  const container = copiedStands[process.env.PR_DB_NAME ?? '']
  expect(container, 'Only an explicitly listed copied database may be mutated').toBeTruthy()
  expect(process.env.SMOKE_DOCKER_CONTAINER).toBe(container)
  await signIn(page)
  const { today, tomorrow } = await serverDates(page)
  const api = process.env.SMOKE_API!
  const token = await page.request.post(`${api}/api/token/`, { data: { username: STAND_USERNAME, password: STAND_PASSWORD } })
  expect(token.status()).toBe(200)
  const { access } = await token.json()
  const headers = { Authorization: `Bearer ${access}` }
  const staff = await page.request.get(`${api}/api/staff_unit/staff-units/directorate/?page=1&page_size=1`, { headers })
  expect(staff.status()).toBe(200)
  const division = (await staff.json()).staff_units[0].division.id as number
  const positions = await page.request.get(`${api}/api/dictionaries/positions/?page_size=200&is_active=true`, { headers })
  expect(positions.status()).toBe(200)
  const position = (await positions.json()).results.find((row: { is_active?: boolean }) => row.is_active !== false)
  expect(position).toBeTruthy()
  const marker = `UX-${randomUUID().slice(0, 8)}`
  const fixtureResponse = await page.request.post(`${api}/api/staff_unit/staff-units/directorate/`, {
    headers, data: { atomic: true,
      employees: [{ last_name: marker, first_name: 'Статус', iin: null, rank: null }],
      staff_units: [{ division, position: position.id }],
    },
  })
  expect(fixtureResponse.status()).toBe(201)
  const fixture = await fixtureResponse.json()
  expect(fixture.success, JSON.stringify(fixture.errors)).toBe(true)
  const employee = fixture.created.employees[0]
  const slot = fixture.created.staff_units[0]
  console.log(`Owned copied status fixture employee=${employee.id}, staff_unit=${slot.id}, marker=${marker}`)
  await page.goto(`/statuses/?businessDate=${tomorrow}`)
  await page.getByPlaceholder('Поиск по ФИО, подразделению, должности...').fill(marker)
  const row = page.locator(`tr[data-employee-id="${employee.id}"]`)
  await clickRowMenuItem(page, row, 'Изменить статус')
  let dialog = page.getByRole('dialog', { name: 'Статусы сотрудника', exact: true })
  await dialog.getByRole('combobox', { name: /Новый статус/ }).click()
  await page.getByRole('option', { name: 'В командировке', exact: true }).click()
  await dialog.getByRole('button', { name: /^Дата окончания/ }).click()
  const daySelector = await page.evaluate(iso => new Date(`${iso}T12:00:00`).toLocaleDateString(), today)
  await page.locator(`[data-slot="calendar"] button[data-day="${daySelector}"]`).click()
  const createCurrent = page.waitForResponse(response => response.url().includes('/api/statuses/statuses/') && response.request().method() === 'POST')
  await dialog.getByRole('button', { name: 'Сохранить', exact: true }).click()
  const savedCurrent = await createCurrent
  expect(savedCurrent.status(), await savedCurrent.text()).toBe(201)
  const current = await savedCurrent.json()
  expect(current).toMatchObject({ employee: employee.id, start_date: today, end_date: today, state: 'active' })
  await expect(dialog).toHaveCount(0)
  await clickRowMenuItem(page, row, 'Запланированные статусы')
  await page.getByRole('dialog').getByRole('button', { name: /^Запланировать статус/ }).click()
  dialog = page.getByRole('dialog', { name: 'Статусы сотрудника', exact: true })
  await dialog.getByRole('combobox', { name: /Новый статус/ }).click()
  await page.getByRole('option', { name: 'В строю', exact: true }).click()
  const createFuture = page.waitForResponse(response => response.url().includes('/api/statuses/statuses/') && response.request().method() === 'POST')
  await dialog.getByRole('button', { name: 'Сохранить', exact: true }).click()
  const savedFuture = await createFuture
  expect(savedFuture.status(), await savedFuture.text()).toBe(201)
  const future = await savedFuture.json()
  expect(future).toMatchObject({ employee: employee.id, status_type: 'in_service', start_date: tomorrow, state: 'planned', end_date: null })
  const persisted = await page.request.get(`${api}/api/statuses/statuses/planned/?employee_id=${employee.id}`, { headers })
  expect(persisted.status()).toBe(200)
  const snapshot = await persisted.json()
  expect(snapshot.current.id).toBe(current.id)
  expect(snapshot.planned.map((item: { id: number }) => item.id)).toContain(future.id)
  await clickRowMenuItem(page, row, 'Запланированные статусы')
  await expect(page.getByRole('dialog').getByText(tomorrow.split('-').reverse().join('.'), { exact: true })).toBeVisible()
})
