import { randomUUID } from 'node:crypto'
import { expect, test, type Page } from '@playwright/test'
import { clickRowMenuItem } from './row-menu'
import { requireIsolatedForcesClone } from './owned-forces-fixture'

const APP = process.env.SMOKE_APP ?? ''
const API = process.env.SMOKE_API ?? ''
const variants = [
  ['DUTY_COMBAT', 'Боевое дежурство'],
  ['DUTY_DAILY', 'Суточное дежурство'],
  ['DUTY_OPERATIONAL', 'Оперативное дежурство'],
] as const

test.skip(process.env.SMOKE_LIVE !== '1' || process.env.DUTY_VARIANTS_MUTATION !== '1',
  'Requires explicit duty mutation authorization on an approved disposable clone')

async function signIn(page: Page) {
  const csrfResponse = await page.request.get(`${APP}/api/auth/csrf/`)
  expect(csrfResponse.status()).toBe(200)
  const { csrfToken } = await csrfResponse.json()
  const response = await page.request.post(`${APP}/api/auth/callback/credentials/`, {
    form: {
      csrfToken, username: process.env.SMOKE_USERNAME ?? 'admin',
      password: process.env.SMOKE_PASSWORD!, json: 'true',
    },
  })
  expect(response.ok()).toBe(true)
  expect(new URL((await response.json()).url).searchParams.has('error')).toBe(false)
}

async function openEmployee(page: Page, employeeId: number, marker: string) {
  await page.goto(`${APP}/statuses/`)
  await page.getByPlaceholder('Поиск по ФИО, подразделению, должности...').fill(marker)
  const row = page.locator(`tr[data-employee-id="${employeeId}"]`)
  await expect(row).toBeVisible()
  return row
}

test('three named duty statuses persist their location across sessions and appear in the service roster', async ({ page, browser }, testInfo) => {
  test.setTimeout(180_000)
  // Check every declared target before authentication or fixture creation.
  requireIsolatedForcesClone()
  expect(testInfo.project.use.baseURL).toBe(APP)
  expect(Boolean(process.env.SMOKE_PASSWORD), 'Clone credentials must be supplied').toBe(true)
  await signIn(page)

  const token = await page.request.post(`${API}/api/token/`, {
    data: { username: process.env.SMOKE_USERNAME ?? 'admin', password: process.env.SMOKE_PASSWORD },
  })
  expect(token.status()).toBe(200)
  const headers = { Authorization: `Bearer ${(await token.json()).access}` }
  const tomorrowResponse = await page.request.get(`${API}/api/operations/tomorrow-block/`, { headers })
  expect(tomorrowResponse.status()).toBe(200)
  const serverDay = new Date(`${(await tomorrowResponse.json()).business_date}T00:00:00Z`)
  serverDay.setUTCDate(serverDay.getUTCDate() - 1)
  const today = serverDay.toISOString().slice(0, 10)

  const catalogResponse = await page.request.get(`${API}/api/statuses/types/?selectable=1`, { headers })
  expect(catalogResponse.status()).toBe(200)
  const catalog = await catalogResponse.json() as { code: string; label: string; report_column_code: string }[]
  for (const [code, label] of variants) {
    expect(catalog.find(type => type.code === code)).toMatchObject({ label, report_column_code: 'ON_DUTY' })
  }

  const staff = await page.request.get(`${API}/api/staff_unit/staff-units/directorate/?page=1&page_size=1`, { headers })
  expect(staff.status()).toBe(200)
  const division = (await staff.json()).staff_units[0].division.id as number
  const positions = await page.request.get(`${API}/api/dictionaries/positions/?page_size=200&is_active=true`, { headers })
  expect(positions.status()).toBe(200)
  const position = (await positions.json()).results.find((row: { is_active?: boolean }) => row.is_active !== false)
  expect(position).toBeTruthy()
  const marker = `DUTY-${randomUUID()}`
  const fixtureResponse = await page.request.post(`${API}/api/staff_unit/staff-units/directorate/`, {
    headers, data: {
      atomic: true,
      employees: [{ last_name: marker, first_name: 'Проверка', iin: null, rank: null }],
      staff_units: [{ division, position: position.id }],
    },
  })
  expect(fixtureResponse.status()).toBe(201)
  const fixture = await fixtureResponse.json()
  expect(fixture.success).toBe(true)
  const employeeId = fixture.created.employees[0].id as number
  // The owned fixture remains only in the explicitly authorized disposable clone.
  testInfo.annotations.push({ type: 'owned-clone-fixture', description: `employee=${employeeId}; marker=${marker}` })

  for (const [code, label] of variants) {
    await test.step(`${label}: save and read in an independent session`, async () => {
      const location = `${marker}, ${label}, пост 2`
      const row = await openEmployee(page, employeeId, marker)
      await clickRowMenuItem(page, row, 'Изменить статус')
      const dialog = page.getByRole('dialog', { name: 'Статусы сотрудника', exact: true })
      await dialog.getByRole('combobox', { name: /Новый статус/ }).click()
      await page.getByRole('option', { name: label, exact: true }).click()
      await dialog.getByLabel('Место дежурства', { exact: true }).fill(location)
      const endDate = dialog.getByRole('button', { name: /^Дата окончания/ })
      const expectedDate = await page.evaluate(iso => new Date(`${iso}T12:00:00`).toLocaleDateString('ru-RU', {
        day: '2-digit', month: 'long', year: 'numeric',
      }).replace(/ г\.$/, ''), today)
      // The subsequent change inherits today's saved end date; clicking it again would deselect it.
      if (!(await endDate.textContent())?.includes(expectedDate)) {
        await endDate.click()
        const calendarDay = await page.evaluate(iso => new Date(`${iso}T12:00:00`).toLocaleDateString(), today)
        await page.locator(`[data-slot="calendar"] button[data-day="${calendarDay}"]`).click()
      }
      await expect(endDate).toContainText(expectedDate)
      const saving = page.waitForResponse(response => new URL(response.url()).pathname === '/api/statuses/statuses/' && response.request().method() === 'POST')
      await dialog.getByRole('button', { name: 'Сохранить', exact: true }).click()
      const saved = await saving
      expect(saved.status()).toBe(201)
      const current = await saved.json()
      expect(current).toMatchObject({ employee: employeeId, status_type: code, location, start_date: today, end_date: today, state: 'active' })
      await expect(dialog).toHaveCount(0)

      const persisted = await page.request.get(`${API}/api/statuses/statuses/planned/?employee_id=${employeeId}`, { headers })
      expect(persisted.status()).toBe(200)
      expect((await persisted.json()).current).toMatchObject({ id: current.id, status_type: code, location })

      const freshContext = await browser.newContext({ baseURL: APP, serviceWorkers: 'block' })
      try {
        const freshPage = await freshContext.newPage()
        await signIn(freshPage)
        const freshRow = await openEmployee(freshPage, employeeId, marker)
        await expect(freshRow).toContainText(label)
        await clickRowMenuItem(freshPage, freshRow, 'Изменить статус')
        const freshDialog = freshPage.getByRole('dialog', { name: 'Статусы сотрудника', exact: true })
        await expect(freshDialog.getByRole('combobox', { name: /Новый статус/ })).toContainText(label)
        await expect(freshDialog.getByLabel('Место дежурства', { exact: true })).toHaveValue(location)

        const rosterResponse = freshPage.waitForResponse(response => {
          const url = new URL(response.url())
          return url.pathname === '/api/ops/duty-register/roster/' && url.searchParams.get('business_date') === today && response.request().method() === 'GET'
        })
        await freshPage.goto(`${APP}/security-ops/combat-duty/?date=${today}`)
        const roster = await rosterResponse
        expect(roster.status()).toBe(200)
        const people = (await roster.json()).departments.flatMap((department: { employees: { employee_id: number; status_label: string; destination: string }[] }) => department.employees)
        expect(people.filter((person: { employee_id: number }) => person.employee_id === employeeId)).toEqual([
          expect.objectContaining({ employee_id: employeeId, status_label: label, destination: location }),
        ])
        const rosterRow = freshPage.getByRole('article').filter({ hasText: marker })
        await expect(rosterRow).toHaveCount(1)
        await expect(rosterRow).toContainText(label)
        await expect(rosterRow).toContainText(location)
      } finally {
        await freshContext.close()
      }
    })
  }
})
