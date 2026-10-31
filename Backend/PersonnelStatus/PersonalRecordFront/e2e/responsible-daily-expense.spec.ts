import { expect, test, type Page } from '@playwright/test'
import path from 'node:path'

const APP = process.env.SMOKE_APP ?? 'http://localhost:3106'
const date = '2026-09-10'
async function prepare(page: Page, allowDateChanges = false) {
  const api = page.context().request
  const csrf = await (await api.get(`${APP}/api/auth/csrf/`)).json()
  const response = await api.post(`${APP}/api/auth/callback/credentials/`, { form: {
    csrfToken: csrf.csrfToken, username: process.env.SMOKE_USER ?? 'acc_forces_officer',
    password: (process.env.SMOKE_USER ? process.env.SMOKE_PASSWORD : process.env.ACCESS_MATRIX_PASSWORD) ?? process.env.SMOKE_PASSWORD ?? '', json: 'true',
  } })
  expect((await response.json()).url).not.toContain('error=')
  // Deterministic hierarchy fixture: department's own staff + directorate + section.
  // Catches counting only leaves, losing direct staff, and expanding only exact directorate staff.
  const reply = (body: unknown) => ({ contentType: 'application/json', body: JSON.stringify(body) })
  await page.route('**/api/operations/my-permissions/**', route => route.fulfill(reply({ permissions: ['status.view', 'forces.allocate', 'daily_report.generate'], roles: [{ code: 'FORCES_GATHERING_OFFICER', name: 'Ответственный', scope_division_id: 2, scope_division_name: 'Департамент' }] })))
  await page.route('**/api/ops/daily/divisions/**', route => {
    if (!allowDateChanges) expect(new URL(route.request().url()).searchParams.get('business_date')).toBe(date)
    return route.fulfill(reply({ results: [
      { id: '2', name: 'Департамент', parent_id: null, division_type: 'department', without_status: 4, notify_recipient_name: null },
      { id: '3', name: 'Первое управление', parent_id: '2', division_type: 'directorate', without_status: 3, notify_recipient_name: 'Иванов И.' },
      { id: '4', name: 'Скрытый отдел', parent_id: '3', division_type: 'division', without_status: 2, notify_recipient_name: null },
    ] }))
  })
  const row = (id: number, count: number) => ({ division_id: id, name: String(id), list_total: count, staff_total: count, vacancies: 0, attached: 0, off_list: 0, columns: { ready: count }, event: { group: 0, squad: 0 } })
  await page.route('**/api/operations/strength-report/**', route => route.fulfill(reply({ business_date: allowDateChanges ? new URL(route.request().url()).searchParams.get('business_date') : date, columns: ['ready'], column_labels: { ready: 'В строю' }, rows: [row(2, 1), row(3, 1), row(4, 2)], totals: row(2, 4), warnings: [] })))
  await page.route('**/api/operations/status-types/**', route => route.fulfill(reply({ count: 1, next: null, results: [{ id: 1, code: 'IN_SERVICE', name: 'В строю', report_column_code: 'ready', is_active: true }] })))
  await page.route('**/api/ops/daily/daily-submissions/**', route => route.fulfill(reply({ results: [] })))
  await page.route('**/api/ops/daily/employees/**', route => {
    const query = new URL(route.request().url()).searchParams
    // Люди запрашиваются ПО ОТДЕЛУ (второй уровень, Plane №1197): точные id
    // отдела (или самого управления для «непосредственно в управлении»), а не
    // всё поддерево управления разом.
    expect(['3', '4']).toEqual(expect.arrayContaining(query.getAll('division_id')))
    expect(query.getAll('division_id').length).toBeGreaterThan(0)
    expect(query.get('business_date')).toBe(date)
    return route.fulfill(reply({ results: [{ id: '41', full_name: 'Сотрудник из отдела', rank_code: 'Майор', division_id: '4' }] }))
  })
  await page.route('**/api/operations/statuses/**', route => route.fulfill(reply({ count: 0, next: null, results: [] })))
}

test.describe('ежедневный расход ответственного', () => {
  test.skip(process.env.SMOKE_LIVE !== '1', 'нужен живой стенд для входа')
  test.setTimeout(60_000)
  test('mobile expense numbers remain exposed after horizontal scrolling past a long department name', async ({ page }, testInfo) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await prepare(page)
    const longName = 'Управление обеспечения охраны объектов и специальных мероприятий'
    await page.route('**/api/ops/daily/divisions/**', route => route.fulfill({ json: { results: [
      { id: '2', name: 'Департамент', parent_id: null, division_type: 'department', without_status: 4, notify_recipient_name: null },
      { id: '3', name: longName, parent_id: '2', division_type: 'directorate', without_status: 3, notify_recipient_name: null },
      { id: '4', name: 'Отдел', parent_id: '3', division_type: 'division', without_status: 2, notify_recipient_name: null },
    ] } }))
    await page.goto(`${APP}/employees?view=daily&businessDate=${date}`)
    const row = page.getByRole('row').filter({ has: page.getByRole('button', { name: longName, exact: true }) })
    const numericCell = row.getByRole('cell').nth(2)
    await expect(numericCell).toHaveText('3')
    await numericCell.evaluate(cell => {
      const viewport = cell.closest('table')!.parentElement!
      viewport.scrollIntoView({ block: 'center' })
      viewport.scrollLeft += cell.getBoundingClientRect().left - viewport.getBoundingClientRect().left - viewport.clientWidth / 2 + cell.clientWidth / 2
    })
    const exposure = await numericCell.evaluate(cell => {
      const viewport = cell.closest('table')!.parentElement!
      const box = cell.getBoundingClientRect()
      const hit = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2)
      return { exposed: hit === cell || (hit !== null && cell.contains(hit)), scrollLeft: viewport.scrollLeft,
        viewportWidth: viewport.clientWidth, nameWidth: cell.parentElement!.firstElementChild!.getBoundingClientRect().width,
        coveringText: hit?.textContent?.trim() }
    })
    await testInfo.attach('numeric-cell-hit-test', { body: JSON.stringify(exposure), contentType: 'application/json' })
    expect(exposure.scrollLeft).toBeGreaterThan(0)
    expect(exposure.exposed, JSON.stringify(exposure)).toBe(true)
    const scrollRegion = page.getByRole('region', { name: 'Таблица расхода', exact: true })
    await scrollRegion.evaluate(element => { element.scrollLeft = 0 })
    await scrollRegion.focus()
    await page.keyboard.press('ArrowRight')
    await expect.poll(() => scrollRegion.evaluate(element => element.scrollLeft)).toBeGreaterThan(0)
    await page.setViewportSize({ width: 1440, height: 1000 })
    await expect.poll(() => row.getByRole('cell').first().evaluate(cell => getComputedStyle(cell).position)).toBe('sticky')
  })
  for (const outcome of ['incomplete', 'success'] as const) {
    test(`generic summary context switch clears ${outcome} feedback and reason before sending another department`, async ({ page }) => {
      await prepare(page, true)
      // Generic board deliberately keeps SummaryVersions mounted while its picker changes.
      await page.route('**/api/operations/my-permissions/**', route => route.fulfill({ json: { permissions: ['*'], global_permissions: ['*'], roles: [] } }))
      // Generic board also reads direct department staff; the responsible fixture
      // above intentionally restricts expansion to directorate/section ids.
      await page.route('**/api/ops/daily/employees/**', route => route.fulfill({ json: { results: [] } }))
      await page.route('**/api/operations/traffic-light/tree/**', route => route.fulfill({ json: { business_date: date, nodes: [
        { division_id: 2, parent_id: null, name: 'Департамент А', is_summary_node: true },
        { division_id: 7, parent_id: null, name: 'Департамент Б', is_summary_node: true },
      ] } }))
      const version = (division: number) => ({ id: 97000 + division, division_id: String(division), business_date: date,
        version: 1, is_current: true, event: 'CHANGED', submitted_by: 'Проверка', submitted_at: `${date}T11:00:00+05:00`,
        late: false, sent_at: null, sent_by: '', incomplete_reason: '' })
      // These synthetic versions have no matching live database snapshot.
      // Keep the freshness response in the same fixture as the versions/send response.
      await page.route('**/api/operations/daily-summaries/freshness/**', route => {
        const query = new URL(route.request().url()).searchParams
        expect(query.get('business_date')).toBe(date)
        const division = Number(query.get('division_id'))
        expect([2, 7]).toContain(division)
        return route.fulfill({ json: { division_id: division, business_date: date,
          status: 'FRESH', can_rebuild: true, superseded: [], missing: [], unpinned: [] } })
      })
      await page.route('**/api/ops/daily/daily-submissions/**', route => {
        const division = Number(new URL(route.request().url()).searchParams.get('division_id'))
        return route.fulfill({ json: { results: division === 2 || division === 7 ? [version(division)] : [] } })
      })
      const bodies: { division_id: number; business_date: string; reason: string }[] = []
      await page.route('**/api/operations/daily-summaries/send/**', route => {
        const body = route.request().postDataJSON()
        bodies.push(body)
        if (body.division_id === 2 && outcome === 'incomplete') return route.fulfill({ status: 400, json: {
          error_code: 'VALIDATION_ERROR', message: 'Свод неполный', details: { laggards: [3] },
        } })
        return route.fulfill({ json: { ...version(body.division_id), sent_at: `${date}T12:00:00+05:00`, sent_by: 'Проверка' } })
      })
      await page.goto(`${APP}/employees?view=daily&businessDate=${date}`)
      const summary = page.getByRole('region', { name: 'Суточный свод', exact: true })
      await summary.getByRole('button', { name: 'Департамент А', exact: true }).click()
      await summary.getByRole('button', { name: 'Отправить дежурному', exact: true }).click()
      if (outcome === 'incomplete') {
        await expect(summary.getByRole('alert')).toContainText('Свод неполный')
        await summary.getByLabel('Причина неполной отправки', { exact: true }).fill('Причина только департамента А')
      } else {
        await expect(summary.getByText('Свод отправлен дежурному', { exact: true })).toBeVisible()
      }
      await summary.getByRole('button', { name: 'Выбрать другой', exact: true }).click()
      await summary.getByRole('button', { name: 'Департамент Б', exact: true }).click()
      await expect(summary.getByRole('button', { name: 'Отправить дежурному', exact: true })).toBeVisible()
      await expect(summary.getByLabel('Причина неполной отправки', { exact: true })).toHaveCount(0)
      await expect(summary.getByRole('alert')).toHaveCount(0)
      await expect(summary.getByText('Свод отправлен дежурному', { exact: true })).toHaveCount(0)
      await summary.getByRole('button', { name: 'Отправить дежурному', exact: true }).click()
      await expect.poll(() => bodies.length).toBe(2)
      expect(bodies[1]).toEqual({ division_id: 7, business_date: date, reason: '' })
    })
  }
  test('period edits keep the displayed report and summary action on a date inside the new range', async ({ page }) => {
    await prepare(page, true)
    await page.route('**/api/operations/strength-report/period/**', route => route.fulfill({ json: { pages: [] } }))
    let assembled: unknown
    await page.route('**/api/operations/daily-summaries/', route => {
      assembled = route.request().postDataJSON()
      return route.fulfill({ status: 201, json: {} })
    })
    await page.goto(`${APP}/employees?view=daily&businessDate=${date}&search=retained`)
    const screen = page.getByRole('region', { name: 'Расход департамента' })
    await expect(screen.getByLabel('Расход на дату')).toHaveValue(date)
    await screen.getByRole('button', { name: 'Диапазон', exact: true }).click()
    await screen.getByLabel('С', { exact: true }).fill('2026-09-20')
    await expect(screen.getByRole('heading', { name: 'Расход на 20.09.2026', exact: true })).toBeVisible()
    await expect(screen.getByRole('listitem').filter({ hasText: '20.09.2026' })).toHaveAttribute('aria-pressed', 'true')
    expect(new URL(page.url()).searchParams.get('businessDate')).toBe('2026-09-20')
    expect(new URL(page.url()).searchParams.get('search')).toBe('retained')
    await screen.getByLabel('по', { exact: true }).fill('2026-09-18')
    await expect(screen.getByRole('heading', { name: 'Расход на 18.09.2026', exact: true })).toBeVisible()
    await screen.getByRole('button', { name: 'Собрать свод', exact: true }).click()
    await expect.poll(() => assembled).toEqual({ division_id: 2, business_date: '2026-09-18', allow_incomplete: true })
    await screen.getByRole('button', { name: 'День', exact: true }).click()
    await expect(screen.getByLabel('Расход на дату')).toHaveValue('2026-09-18')
    expect(new URL(page.url()).searchParams.has('dateFrom')).toBe(false)
  })
  // Пин переписан ОСОЗНАННО (Plane №1197, решение заказчика 12.09.2026):
  // раньше проба требовала «раскрывает сотрудников БЕЗ уровня отделов», теперь
  // отделы — второй уровень таблицы со своими числами, а люди — под отделом.
  test('считает поддерево один раз; раскрывает управление до отделов, отдел — до людей', async ({ page }, testInfo) => {
    await prepare(page)
    await page.goto(`${APP}/employees?view=daily&businessDate=${date}`)
    const screen = page.getByRole('region', { name: 'Расход департамента' })
    await expect(screen.getByTestId('daily-list-total')).toHaveText('4')
    await expect(screen.getByTestId('daily-ready-total')).toHaveText('4')
    await expect(screen.getByText('Без отдельной отметки · в строю', { exact: true }).locator('..').locator('dd')).toHaveText('4')
    await expect(screen.getByText('Сдали 0 из 1')).toBeVisible()
    // Бланк: «Руководство» первой строкой (прямой состав департамента = 1), «ИТОГО» последней.
    await expect(screen.getByRole('row', { name: /Руководство департамента/ })).toContainText('1')
    await expect(screen.getByRole('row', { name: /ИТОГО по департаменту/ })).toContainText('4')
    await screen.getByRole('button', { name: 'Первое управление', exact: true }).click()
    await expect(screen.getByRole('button', { name: 'Скрытый отдел', exact: true })).toBeVisible()
    await expect(screen.getByText('Сотрудник из отдела')).toHaveCount(0)
    await screen.getByRole('button', { name: 'Скрытый отдел', exact: true }).click()
    // Требования 07.10.2026: полный состав виден сразу после раскрытия отдела.
    await expect(screen.getByText('Сотрудник из отдела')).toBeVisible()
    await expect(screen.getByRole('button', { name: /^Показать всех/ })).toHaveCount(0)
    await expect(screen.getByText('Без отдельной отметки: в строю')).toBeVisible()
    await page.screenshot({ path: testInfo.outputPath('responsible-daily.png'), fullPage: true })
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
  test('пересекающиеся статусы выбираются по приоритету каталога, не порядку API', async ({ page }) => {
    await prepare(page)
    const type = (code: string, name: string, priority: number, active = true) => ({ code, name, priority, report_column_code: code, is_active: active, counts_in_staff: true, counts_in_list: true, is_hard_block: false, restricts_editing: false, is_ku_owned: false, max_duration_days: null, color: '', legacy_code: null })
    await page.route('**/api/operations/status-types/**', route => route.fulfill({ json: { count: 4, next: null, results: [type('IN_SERVICE', 'В строю', 100), type('DUTY', 'На дежурстве', 30), type('SICK_LEAVE', 'На больничном', 10, false), type('EXPIRED', 'Истёкший статус', 1)] } }))
    const status = (id: number, code: string, start: string, end: string) => ({ id, employee_id: 41, status_type_code: code, date_start: start, date_end: end, destination: code === 'SICK_LEAVE' ? 'Городская больница' : '', state: 'ACTIVE', source: '', comment: '', document_basis: '', cancelled_at: null, cancelled_reason: '', participations: [] })
    await page.route('**/api/operations/statuses/**', route => route.fulfill({ json: { count: 3, next: null, results: [status(1, 'DUTY', date, '2026-09-12'), status(2, 'EXPIRED', '2026-09-08', date), status(3, 'SICK_LEAVE', '2026-09-09', '2026-09-12')] } }))
    await page.goto(`${APP}/employees?view=daily&businessDate=${date}`)
    await page.getByRole('button', { name: 'Первое управление', exact: true }).click()
    await page.getByRole('button', { name: 'Скрытый отдел', exact: true }).click()
    const person = page.getByText('Сотрудник из отдела', { exact: true }).locator('..')
    // Deactivated catalog entries still describe historical facts; date_end is exclusive.
    await expect(person.getByText('На больничном', { exact: true })).toBeVisible()
    await expect(person.getByText('На дежурстве', { exact: true })).toHaveCount(0)
    await expect(person.getByText(/09\.09\.2026.*11\.09\.2026/)).toBeVisible()
    await expect(person.getByText('Городская больница', { exact: true })).toBeVisible()
  })
  // Пин переписан ОСОЗНАННО (Plane №1197): вместо четырёх групп «По списку /
  // В строю / Отклонения / Сдача» — строка таблицы с колонками бланка и
  // индикатором-точкой, названным словами (`role="img"`, цвет не единственный сигнал).
  test('строка управления: индикатор сдачи назван словами, числа в колонках бланка', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 1000 })
    await prepare(page)
    await page.goto(`${APP}/employees?view=daily&businessDate=${date}`)
    const unit = page.getByRole('row').filter({ has: page.getByRole('button', { name: 'Первое управление', exact: true }) })
    await expect(unit.getByRole('img', { name: 'Сдача: Не сдано', exact: true })).toBeVisible()
    await expect(unit.getByText('не сдано', { exact: true })).toBeVisible()
    const cells = unit.getByRole('cell')
    // Управление · Штат · Список · В строю · Вакансии · [колонки справочника: ready]
    await expect(cells.nth(1)).toHaveText('3')
    await expect(cells.nth(2)).toHaveText('3')
    await expect(cells.nth(3)).toHaveText('3')
    await expect(cells.nth(4)).toHaveText('0')
    await expect(page.getByRole('columnheader', { name: 'Штат' })).toBeVisible()
    await expect(page.getByRole('columnheader', { name: 'Вакансии' })).toBeVisible()
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
    await expect(screen.getByLabel('Расход на дату')).toBeVisible()
    // Dashboard shell animates its desktop margin for 300ms after breakpoint changes.
    await expect.poll(() => screen.evaluate(element => element.scrollWidth <= element.clientWidth + 1)).toBe(true)
    await page.screenshot({ path: path.join('/tmp', '1090-task2-responsible-daily-mobile.png'), fullPage: true })
    await page.emulateMedia({ colorScheme: 'dark' })
    await page.evaluate(() => localStorage.setItem('theme', 'dark'))
    await page.reload()
    await expect(page.locator('html')).not.toHaveClass(/dark/)
    await expect(page.locator('html')).toHaveCSS('color-scheme', 'light')
    await expect(screen.getByLabel('Расход на дату')).toBeVisible()
    await page.screenshot({ path: path.join('/tmp', '1090-task2-responsible-daily-light-system-dark.png'), fullPage: true, animations: 'disabled' })
  })
})
