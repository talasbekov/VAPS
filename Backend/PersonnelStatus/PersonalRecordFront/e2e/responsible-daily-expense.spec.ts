import { expect, test, type Page } from '@playwright/test'
import path from 'node:path'

const APP = process.env.SMOKE_APP ?? 'http://localhost:3106'
const date = '2026-09-10'
async function prepare(page: Page) {
  const api = page.context().request
  const csrf = await (await api.get(`${APP}/api/auth/csrf/`)).json()
  const response = await api.post(`${APP}/api/auth/callback/credentials/`, { form: {
    csrfToken: csrf.csrfToken, username: 'acc_forces_officer', password: process.env.ACCESS_MATRIX_PASSWORD ?? '', json: 'true',
  } })
  expect((await response.json()).url).not.toContain('error=')
  // Deterministic hierarchy fixture: department's own staff + directorate + section.
  // Catches counting only leaves, losing direct staff, and expanding only exact directorate staff.
  const reply = (body: unknown) => ({ contentType: 'application/json', body: JSON.stringify(body) })
  await page.route('**/api/operations/my-permissions/**', route => route.fulfill(reply({ permissions: ['status.view', 'forces.allocate', 'daily_report.generate'], roles: [{ code: 'FORCES_GATHERING_OFFICER', name: 'Ответственный', scope_division_id: 2, scope_division_name: 'Департамент' }] })))
  await page.route('**/api/ops/daily/divisions/**', route => {
    expect(new URL(route.request().url()).searchParams.get('business_date')).toBe(date)
    return route.fulfill(reply({ results: [
      { id: '2', name: 'Департамент', parent_id: null, division_type: 'department', without_status: 4, notify_recipient_name: null },
      { id: '3', name: 'Первое управление', parent_id: '2', division_type: 'directorate', without_status: 3, notify_recipient_name: 'Иванов И.' },
      { id: '4', name: 'Скрытый отдел', parent_id: '3', division_type: 'division', without_status: 2, notify_recipient_name: null },
    ] }))
  })
  const row = (id: number, count: number) => ({ division_id: id, name: String(id), list_total: count, staff_total: count, vacancies: 0, attached: 0, off_list: 0, columns: { ready: count }, event: { group: 0, squad: 0 } })
  await page.route('**/api/operations/strength-report/**', route => route.fulfill(reply({ business_date: date, columns: ['ready'], column_labels: { ready: 'В строю' }, rows: [row(2, 1), row(3, 1), row(4, 2)], totals: row(2, 4), warnings: [] })))
  await page.route('**/api/operations/status-types/**', route => route.fulfill(reply({ count: 1, next: null, results: [{ id: 1, code: 'IN_SERVICE', name: 'В строю', report_column_code: 'ready', is_active: true }] })))
  await page.route('**/api/ops/daily/daily-submissions/**', route => route.fulfill(reply({ results: [] })))
  await page.route('**/api/ops/daily/employees/**', route => {
    const query = new URL(route.request().url()).searchParams
    expect(query.getAll('division_id').sort()).toEqual(['3', '4'])
    expect(query.get('business_date')).toBe(date)
    return route.fulfill(reply({ results: [{ id: '41', full_name: 'Сотрудник из отдела', rank_code: 'Майор', division_id: '4' }] }))
  })
  await page.route('**/api/operations/statuses/**', route => route.fulfill(reply({ count: 0, next: null, results: [] })))
}

test.describe('ежедневный расход ответственного', () => {
  test.skip(process.env.SMOKE_LIVE !== '1', 'нужен живой стенд для входа')
  test.setTimeout(60_000)
  test('считает поддерево один раз и раскрывает сотрудников без уровня отделов', async ({ page }) => {
    await prepare(page)
    await page.goto(`${APP}/employees?view=daily&businessDate=${date}`)
    const screen = page.getByRole('region', { name: 'Расход департамента' })
    await expect(screen.getByTestId('daily-list-total')).toHaveText('4')
    await expect(screen.getByTestId('daily-ready-total')).toHaveText('4')
    await expect(screen.getByText('Без отдельной отметки · в строю', { exact: true }).locator('..').locator('dd')).toHaveText('4')
    await expect(screen.getByText('Сдали 0 из 1')).toBeVisible()
    await screen.getByRole('button', { name: 'Первое управление', exact: true }).click()
    await expect(screen.getByText('Сотрудник из отдела')).toBeVisible()
    await expect(screen.getByText('Скрытый отдел', { exact: true })).toHaveCount(0)
    await expect(screen.getByText('Без отдельной отметки: в строю')).toBeVisible()
    await page.screenshot({ path: path.join('/tmp', '1090-task2-responsible-daily.png'), fullPage: true })
  })
  test('ошибка сдач не становится нулём; повтор восстанавливает данные', async ({ page }) => {
    await prepare(page)
    await page.route('**/api/ops/daily/daily-submissions/**', route => route.fulfill({ status: 503, contentType: 'application/json', body: '{}' }))
    await page.goto(`${APP}/employees?view=daily&businessDate=${date}`)
    const screen = page.getByRole('region', { name: 'Расход департамента' })
    await expect(screen.getByText('Не удалось получить состояние сдачи')).toBeVisible()
    await expect(screen.getByText('Сдали 0 из 1')).toHaveCount(0)
    await page.unroute('**/api/ops/daily/daily-submissions/**')
    await page.route('**/api/ops/daily/daily-submissions/**', route => route.fulfill({ contentType: 'application/json', body: '{"results":[]}' }))
    await screen.getByRole('button', { name: 'Повторить состояние сдачи' }).click()
    await expect(screen.getByText('Сдали 0 из 1')).toBeVisible()
  })
  test('напоминает департаменту на выбранную дату, показывает отказ и неразрешённых получателей', async ({ page }) => {
    await prepare(page)
    let attempts = 0
    await page.route('**/api/operations/daily-summaries/remind/**', async route => {
      expect(route.request().method()).toBe('POST')
      expect(route.request().postDataJSON()).toEqual({ division_id: 2, business_date: date })
      attempts++
      await new Promise(resolve => setTimeout(resolve, 300))
      await route.fulfill(attempts === 1 ? { status: 503, contentType: 'application/json', body: '{}' } : { contentType: 'application/json', body: JSON.stringify({ business_date: date, laggard_division_ids: [3], notified_recipient_count: 0, unresolved_division_ids: [3] }) })
    })
    await page.goto(`${APP}/employees?view=daily&businessDate=${date}`)
    await page.getByRole('button', { name: 'Напомнить всем несдавшим' }).click()
    await expect(page.getByRole('button', { name: 'Отправка напоминаний…' })).toBeDisabled()
    await expect(page.getByText('Напоминания не отправлены. Повторите попытку кнопкой выше.')).toBeVisible()
    await page.getByRole('button', { name: 'Напомнить всем несдавшим' }).click()
    await expect(page.getByText('Получателей уведомлено: 0. Без получателя: Первое управление.')).toBeVisible()
    expect(attempts).toBe(2)
  })
  test('живой расход роли отображает серверный состав и работает на узком экране', async ({ page }) => {
    const api = page.context().request
    const csrf = await (await api.get(`${APP}/api/auth/csrf/`)).json()
    await api.post(`${APP}/api/auth/callback/credentials/`, { form: { csrfToken: csrf.csrfToken, username: 'acc_forces_officer', password: process.env.ACCESS_MATRIX_PASSWORD ?? '', json: 'true' } })
    const reportResponse = page.waitForResponse(response => response.url().includes('/api/operations/strength-report/') && response.status() === 200)
    await page.goto(`${APP}/employees?view=daily&businessDate=${date}`)
    const screen = page.getByRole('region', { name: 'Расход департамента' })
    const liveReport = await (await reportResponse).json()
    await expect(screen.getByTestId('daily-list-total')).toHaveText(String(liveReport.totals.list_total), { timeout: 30_000 })
    await expect(screen.getByRole('button', { name: 'Собрать свод' }).or(screen.getByText(/Отправлен дежурному|Отправить дежурному/)).first()).toBeVisible()
    await expect(screen.getByRole('alert')).toHaveCount(0)
    await page.screenshot({ path: path.join('/tmp', '1090-task2-responsible-daily-live.png'), fullPage: true })
    await page.setViewportSize({ width: 375, height: 812 })
    await expect(screen.getByLabel('Деловая дата')).toBeVisible()
    // Dashboard shell animates its desktop margin for 300ms after breakpoint changes.
    await expect.poll(() => screen.evaluate(element => element.scrollWidth <= element.clientWidth + 1)).toBe(true)
    await page.screenshot({ path: path.join('/tmp', '1090-task2-responsible-daily-mobile.png'), fullPage: true })
    await page.getByRole('button', { name: 'Переключить на тёмную тему' }).click()
    await expect(page.locator('html')).toHaveClass(/dark/)
    await page.screenshot({ path: path.join('/tmp', '1090-task2-responsible-daily-dark.png'), fullPage: true, animations: 'disabled' })
  })
})
