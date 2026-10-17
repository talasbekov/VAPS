import { expect, test, type Page } from '@playwright/test'
import { encode } from 'next-auth/jwt'

function staffRow(id: number, divisionId: number, directorateId: number, departmentName: string) {
  return {
    id, index: id, parent_id: null, vacancy: null,
    division: { id: divisionId, name: `Отдел ${divisionId}` },
    position: { id: 1, name: 'Инспектор', level: 8 },
    department_id: directorateId + 100, department_name: departmentName,
    directorate_id: directorateId, directorate_name: 'Первое управление',
    employee: {
      id, first_name: 'Имя', last_name: `Сотрудник${id}`, middle_name: 'Отчество',
      rank: null, photo_url: null, hire_date: null, birth_date: null,
      personnel_number: `status-${id}`, iin_masked: '',
      current_status: { status_type: 'in_service', state: 'active', start_date: '2026-10-07',
        end_date: null as string | null, location: '' },
    },
  }
}

const roster = [staffRow(1, 31, 11, 'Первый департамент'), staffRow(2, 32, 11, 'Первый департамент'),
  staffRow(3, 33, 12, 'Второй департамент')]
type StaffFixture = Omit<(typeof roster)[number], 'directorate_id'> & { directorate_id: number | null }

async function prepare(page: Page, initialRows: StaffFixture[] = roster) {
  const staffRows = structuredClone(initialRows)
  if (process.env.SMOKE_PASSWORD) {
    const csrf = await (await page.request.get('/api/auth/csrf/')).json()
    const response = await page.request.post('/api/auth/callback/credentials/', { form: {
      csrfToken: csrf.csrfToken, username: process.env.SMOKE_USER ?? 'admin',
      password: process.env.SMOKE_PASSWORD, json: 'true',
    } })
    expect(response.ok()).toBe(true)
    expect((await response.json()).url).not.toContain('error=')
  } else {
    const secret = process.env.STATUS_TEST_SECRET ?? 'status-directorate-test-secret'
    const token = await encode({ secret, token: { id: 'status-test', sub: 'status-test', name: 'Проверка статусов' } })
    const baseURL = process.env.STATUS_TEST_BASE_URL ?? process.env.SMOKE_BASE_URL ?? 'http://127.0.0.1:3341'
    await page.context().addCookies([{ name: 'next-auth.session-token', value: token, url: baseURL }])
  }
  await page.route('**/api/**', async route => {
    const url = new URL(route.request().url())
    let json: unknown = { count: 0, results: [], next: null, previous: null }
    if (url.pathname === '/api/auth/session/') {
      json = { user: { id: 'status-test', name: 'Проверка статусов' },
        accessToken: 'fixture-token', expires: '2099-01-01T00:00:00.000Z' }
    } else if (url.pathname === '/api/operations/my-permissions/') {
      json = { permissions: ['status.view', 'status.manage'], status_manage_division_ids: staffRows.map(row => row.division.id), roles: [] }
    } else if (url.pathname === '/api/staff_unit/staff-units/directorate/') {
      const selected = url.searchParams.get('directorate_id')
      const staff = selected ? staffRows.filter(row => row.directorate_id === Number(selected)) : staffRows
      json = { division: { id: 101, name: 'Департамент', code: 'fixture' }, staff_units: staff,
        total_count: staff.length, matched_count: staff.length, has_next: false,
        summary: { employees: staff.length, without_status: 0, overdue: 0, scheduled: 0 } }
    } else if (url.pathname === '/api/staff_unit/statistics/') {
      json = {
        summary: { departments_count: 2, directorates_count: 2, divisions_count: 3,
          employees_count: 3, staff_units_count: 3, vacancies_count: 0 },
        departments: [{ department_id: 111, department_name: 'Первый департамент', ancestors: [] }],
        directorates: [
          { directorate_id: 11, directorate_name: 'Первое управление', ancestors: ['Первый департамент'] },
          { directorate_id: 12, directorate_name: 'Первое управление', ancestors: ['Второй департамент'] },
        ],
        divisions: [{ division_id: 31, division_name: 'Отдел 31', ancestors: ['Первый департамент', 'Первое управление'] }],
      }
    } else if (url.pathname === '/api/statuses/types/') {
      json = [{ code: 'in_service', label: 'В строю', color: '' },
        { code: 'business_trip', label: 'В командировке', color: '' }]
    } else if (url.pathname === '/api/operations/strength-report/') {
      json = { business_date: '2026-10-07', rows: [], totals: { staff_total: 3, list_total: 3, columns: {} } }
    } else if (url.pathname === '/api/operations/tomorrow-block/') {
      json = { business_date: '2026-10-09', blocked: false, overridden: false, laggards: [] }
    } else if (url.pathname === '/api/statuses/statuses/' && route.request().method() === 'POST') {
      const payload = route.request().postDataJSON()
      const staff = staffRows.find(row => row.employee.id === payload.employee)
      if (staff) staff.employee.current_status = { status_type: payload.status_type, state: 'active',
        start_date: payload.start_date, end_date: payload.end_date ?? null, location: payload.location ?? '' }
      json = { id: 501, ...payload }
    }
    await route.fulfill({ json })
  })
  await page.goto('/statuses/')
  await expect(page.locator('[data-employee-id="1"]')).toBeVisible()
}

test('same-name directorates remain distinct and sections share their directorate group', async ({ page }) => {
  await prepare(page)
  await expect(page.locator('[data-directorate-id="11"]')).toHaveCount(1)
  await expect(page.locator('[data-directorate-id="12"]')).toHaveCount(1)
  await expect(page.locator('[data-directorate-id="11"]')).toContainText('Первый департамент')
  await expect(page.locator('[data-directorate-id="12"]')).toContainText('Второй департамент')
  await expect(page.getByRole('columnheader', { name: 'Управление', exact: true })).toBeVisible()
  expect(await page.locator('tbody > tr').evaluateAll(rows => rows.map(row =>
    row.getAttribute('data-directorate-id') ?? row.getAttribute('data-employee-id'))))
    .toEqual(['11', '1', '2', '12', '3'])
})

test('directorate selector filters by numeric ID and excludes section options', async ({ page }) => {
  await prepare(page)
  await page.getByRole('combobox', { name: 'Фильтр по управлению' }).click()
  await expect(page.getByRole('option', { name: /Отдел 31/ })).toHaveCount(0)
  const request = page.waitForRequest(request =>
    new URL(request.url()).pathname === '/api/staff_unit/staff-units/directorate/' &&
    new URL(request.url()).searchParams.get('directorate_id') === '12')
  await page.getByRole('option', { name: 'Второй департамент › Первое управление' }).click()
  await request
  await expect(page.locator('[data-employee-id]')).toHaveCount(1)
  await expect(page.locator('[data-employee-id="3"]')).toBeVisible()
})

test('saving a grouped employee status keeps the actual section ID and editable destination', async ({ page }) => {
  const rows = structuredClone(roster)
  rows[0].employee.current_status = { status_type: 'business_trip', state: 'active',
    start_date: '2026-10-07', end_date: '2026-10-09', location: 'Астана' }
  await prepare(page, rows)
  await page.locator('[data-employee-id="1"]').getByRole('button', { name: /^Действия:/ }).click()
  await page.getByRole('menuitem', { name: 'Изменить статус', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Статусы сотрудника', exact: true })
  await expect(dialog.getByRole('combobox', { name: /Новый статус/ })).toContainText('В командировке')
  await expect(dialog.getByRole('textbox', { name: 'Место убытия', exact: true })).toHaveValue('Астана')
  await dialog.getByRole('textbox', { name: 'Место убытия', exact: true }).fill('Алматы')
  const request = page.waitForRequest(request =>
    new URL(request.url()).pathname === '/api/statuses/statuses/' && request.method() === 'POST')
  await dialog.getByRole('button', { name: 'Сохранить', exact: true }).click()
  expect((await request).postDataJSON()).toMatchObject({ employee: 1, related_division: 31, location: 'Алматы' })
  await expect(dialog).toBeHidden()
  await page.locator('[data-employee-id="1"]').getByRole('button', { name: /^Действия:/ }).click()
  await page.getByRole('menuitem', { name: 'Изменить статус', exact: true }).click()
  await expect(dialog.getByRole('textbox', { name: 'Место убытия', exact: true })).toHaveValue('Алматы')
  await expect(dialog.getByText('Изменение статуса на сегодня: 2026-10-08.', { exact: true })).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(dialog).toBeHidden()
  await page.locator('[data-employee-id="2"]').getByRole('button', { name: /^Действия:/ }).click()
  await page.getByRole('menuitem', { name: 'Изменить статус', exact: true }).click()
  await expect(dialog.getByRole('combobox', { name: /Новый статус/ })).toContainText('В строю')
  await expect(dialog.getByText('Изменение статуса на сегодня: 2026-10-08.', { exact: true })).toBeVisible()
  await dialog.getByRole('combobox', { name: /Новый статус/ }).click()
  await page.getByRole('option', { name: 'В командировке', exact: true }).click()
  await expect(dialog.getByRole('textbox', { name: 'Место убытия', exact: true })).toHaveValue('')
  await expect(dialog.getByRole('button', { name: /^Дата окончания/ })).toContainText('Выберите дату')
})

test('employees outside a directorate remain visible without a misleading department group', async ({ page }) => {
  await prepare(page, [...roster, { ...staffRow(4, 41, 11, 'Третий департамент'),
    directorate_id: null, directorate_name: '' }])
  await expect(page.locator('[data-directorate-id="none"]')).toHaveText('Без управления')
  await expect(page.locator('[data-employee-id="4"]')).toBeVisible()
})
