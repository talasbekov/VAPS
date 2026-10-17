import { test, expect, type Page } from '@playwright/test'

async function signIn(page: Page) {
  const csrf = await (await page.request.get('/api/auth/csrf/')).json()
  const response = await page.request.post('/api/auth/callback/credentials/', {
    form: { csrfToken: csrf.csrfToken, username: process.env.SMOKE_USER ?? 'admin', password: process.env.SMOKE_PASSWORD!, json: 'true' },
  })
  expect((await response.json()).url).not.toContain('error=')
}

const date = '2026-10-07'
const node = (id: number, name: string, parent: number | null) => ({ division_id: id, name, parent_id: parent, status: 'RED', late: false })
const catalog = ['IN_SERVICE', 'SICK'].map((code, i) => ({ code, name: i === 0 ? 'В строю' : 'На больничном', report_column_code: code, priority: i === 0 ? 999 : 1, counts_in_list: true, counts_in_staff: true, is_active: true }))

test.beforeEach(async ({ page }) => {
  test.skip(!process.env.SMOKE_PASSWORD, 'Requires isolated test account')
  await signIn(page)
  await page.route('**/api/operations/my-permissions/**', route => route.fulfill({ json: { permissions: ['*'], global_permissions: ['*'], roles: [{ code: 'ADMIN', name: 'Администратор', scope_division_id: null, scope_division_name: null }, { code: 'DUTY_OFFICER', name: 'Дежурный', scope_division_id: null, scope_division_name: null }] } }))
})

test('service summary automatically shows department chiefs and deputies with absence details, while ordinary staff stay aggregated', async ({ page }) => {
  await page.route('**/api/operations/traffic-light/tree/**', route => route.fulfill({ json: { business_date: date, control_hour: '18:00:00', nodes: [node(1, 'Служба', null), node(2, 'Шестой департамент', 1), node(3, 'Первое управление', 2)] } }))
  await page.route('**/api/operations/tomorrow-block/**', route => route.fulfill({ json: { business_date: date, blocked: false, overridden: false, laggards: [] } }))
  await page.route('**/api/ops/daily/submissions/**', route => route.fulfill({ json: { results: [] } }))
  await page.route('**/api/operations/status-types/**', route => route.fulfill({ json: { count: 2, next: null, previous: null, results: catalog } }))
  await page.route('**/api/operations/strength-report/**', route => route.fulfill({ json: { business_date: date, rows: [], totals: { staff_total: 3, list_total: 3, vacancies: 0, columns: { IN_SERVICE: 2, SICK: 1 }, attached: 0 } } }))
  await page.route('**/api/ops/daily/employees/**', route => route.fulfill({ json: { results: new URL(route.request().url()).searchParams.get('division_id') === '1' ? [
    { id: '24', full_name: 'Прямой Сотрудник Службы', position_level: 7, position_name: 'Инспектор' },
  ] : [
    { id: '21', full_name: 'Начальников Иван Петрович', rank_code: 'полковник', position_level: 1, position_name: 'Начальник департамента' },
    { id: '22', full_name: 'Заместителев Пётр Иванович', rank_code: 'полковник', position_level: 2, position_name: 'Заместитель начальника департамента' },
    { id: '23', full_name: 'Обычный Сергей Андреевич', rank_code: 'капитан', position_level: 7, position_name: 'Инспектор' },
  ] } }))
  await page.route('**/api/operations/statuses/**', route => route.fulfill({ json: { count: 1, next: null, previous: null, results: [{ id: 1, employee_id: 22, status_type_code: 'SICK', date_start: '2026-10-05', date_end: '2026-10-09', cancelled_at: null, state: 'ACTIVE', destination: 'Городская больница', participations: [] }] } }))
  await page.goto(`/security-ops/service-summary/?dateFrom=${date}`)
  const summary = page.getByRole('region', { name: `Свод по Службе на 07.10.2026`, exact: true })
  await expect(summary.getByText('Начальников Иван Петрович', { exact: true })).toBeVisible()
  await expect(summary.getByText('Заместителев Пётр Иванович', { exact: true })).toBeVisible()
  await expect(summary.getByText('Городская больница', { exact: true })).toBeVisible()
  await expect(summary.getByText(/05\.10\.2026.*08\.10\.2026/)).toBeVisible()
  await summary.getByRole('button', { name: 'Раскрыть: Шестой департамент', exact: true }).click()
  await expect(summary.getByText('Обычный Сергей Андреевич', { exact: true })).toHaveCount(0)
  const rootExpand = summary.getByRole('button', { name: 'Раскрыть: Руководство Службы', exact: true })
  if (await rootExpand.count()) await rootExpand.click()
  await expect(summary.getByText('Прямой Сотрудник Службы', { exact: true })).toHaveCount(0)
})

test('combat duty section displays server roster across departments and can change date', async ({ page }) => {
  const requestedDates: string[] = []
  await page.route('**/api/ops/duty-register/roster/**', route => {
    const requestedDate = new URL(route.request().url()).searchParams.get('business_date') ?? ''
    requestedDates.push(requestedDate)
    const departments = [
      { id: 2, name: 'Шестой департамент', employees: [{ employee_id: 21, full_name: 'Первый Иван Петрович', position_name: 'Инспектор', status_label: 'На дежурстве', date_start: date, date_end: '2026-10-08', destination: 'Объект А', placements: [{ source: 'STATUS', source_id: 1, label: 'Объект А', start_at: null, end_at: null, record_id: null }] }] },
      { id: 4, name: 'Другой департамент', employees: [{ employee_id: 22, full_name: 'Второй Пётр Иванович', position_name: 'Инспектор', status_label: 'На дежурстве', date_start: date, date_end: '2026-10-08', destination: 'Объект Б', placements: [] }] },
    ]
    return route.fulfill({ json: { business_date: requestedDate || date, time_zone: 'Asia/Almaty', generated_at: '', combat_groups: [], departments: requestedDate === '2026-10-08' ? departments.slice(1) : departments } })
  })
  await page.route('**/api/ops/combat-duty-shifts/**', route => route.fulfill({ json: { results: [] } }))
  await page.goto(`/security-ops/combat-duty/?date=${date}`)
  await expect(page.getByRole('heading', { name: 'Журнал дежурств', exact: true })).toBeVisible()
  await expect(page.getByText('Первый Иван Петрович', { exact: true })).toBeVisible()
  await expect(page.getByText('Второй Пётр Иванович', { exact: true })).toBeVisible()
  await expect(page.getByText('Объект А', { exact: true })).toBeVisible()
  await page.getByRole('combobox', { name: 'Подразделение', exact: true }).selectOption('2')
  await expect(page.getByText('Второй Пётр Иванович', { exact: true })).toHaveCount(0)
  await page.getByLabel('Дата состава').fill('2026-10-08')
  await expect.poll(() => requestedDates).toContain('2026-10-08')
  await page.getByRole('button', { name: 'Сбросить фильтры', exact: true }).click()
  await expect(page.getByText('Второй Пётр Иванович', { exact: true })).toBeVisible()
  await expect(page.getByRole('combobox', { name: 'Подразделение', exact: true })).toHaveValue('')
})

test('combat duty denies an account without access before requesting roster', async ({ page }) => {
  await page.route('**/api/operations/my-permissions/**', route => route.fulfill({ json: { permissions: [], global_permissions: [], roles: [] } }))
  const requests: string[] = []
  page.on('request', request => { if (request.url().includes('/api/ops/duty-register/roster/')) requests.push(request.url()) })
  await page.goto('/security-ops/combat-duty/')
  await expect(page.getByRole('heading', { name: 'Доступ закрыт', exact: true })).toBeVisible()
  expect(requests).toEqual([])
})

test('combat duty includes accepted server groups even without employee duty statuses', async ({ page }) => {
  await page.route('**/api/ops/duty-register/roster/**', route => route.fulfill({ json: {
    business_date: date, departments: [], time_zone: 'Asia/Almaty', generated_at: '', combat_groups: [{
      shift_id: 17, group_name: 'БГ-1', route_label: 'Трасса А', route_ids: ['route-a'],
      division_id: 3, division_name: 'Первое управление', department_id: 2, department_name: 'Шестой департамент',
      leader_name: 'Старший Иван Петрович', member_names: ['Участник Пётр Иванович'], reserve_names: ['Резервный Сергей Андреевич'],
      stage_code: 'ACTIVE', stage_label: 'На дежурстве', actual_member_names: null, actual_start: null, actual_end: null,
    }],
  } }))
  await page.goto(`/security-ops/combat-duty/?date=${date}`)
  const groups = page.getByRole('region', { name: 'Боевые группы', exact: true })
  await groups.locator('summary').click()
  await expect(groups.getByText('БГ-1', { exact: true })).toBeVisible()
  await expect(groups.getByText('Трасса А', { exact: false })).toBeVisible()
  await expect(groups.getByText('Старший Иван Петрович', { exact: true })).toBeVisible()
  await expect(groups.getByText('Участник Пётр Иванович', { exact: true })).toBeVisible()
  await expect(groups.getByText('Резервный Сергей Андреевич', { exact: true })).toBeVisible()
  await expect(page.getByText('На выбранную дату сотрудники на боевом дежурстве отсутствуют.')).toHaveCount(0)
})
