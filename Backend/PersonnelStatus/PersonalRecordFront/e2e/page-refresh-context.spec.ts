import { expect, test } from '@playwright/test'
import { STAND_PASSWORD, STAND_USERNAME } from './stand-credentials'

const APP = process.env.SMOKE_APP ?? 'http://localhost:3106'

test.describe('Обновление расхода и серверной даты', () => {
  test.skip(process.env.SMOKE_LIVE !== '1', 'Authenticated read-only fixtures')
  for (const pageKind of ['statuses', 'board'] as const) {
    for (const explicit of [false, true]) {
      test(`${pageKind}: ${explicit ? 'выбранная дата сохраняется' : 'завтра перечитывается с сервера'}`, async ({ page }) => {
        let serverDate = '2026-10-10'
        let staffTotal = 1337
        await page.route('**/api/**', route => {
          const request = route.request()
          return !['GET', 'HEAD', 'OPTIONS'].includes(request.method()) && !new URL(request.url()).pathname.startsWith('/api/auth/')
            ? route.abort() : route.continue()
        })
        await page.route('**/api/operations/my-permissions/**', route => route.fulfill({ json: {
          permissions: ['*'], global_permissions: ['*'], roles: [],
        } }))
        await page.route('**/api/operations/tomorrow-block/**', route => route.fulfill({ json: {
          business_date: serverDate, blocked: false, laggards: [],
        } }))
        await page.route('**/api/ops/daily/divisions/**', route => route.fulfill({ json: { results: [] } }))
        await page.route(url => url.pathname === '/api/operations/strength-report/', route => route.fulfill({ json: {
          business_date: new URL(route.request().url()).searchParams.get('business_date') ?? serverDate,
          columns: [], column_labels: {}, rows: [], warnings: [],
          totals: { staff_total: staffTotal, list_total: staffTotal, vacancies: 0, attached: 0, off_list: 0, columns: {}, event: { assigned: 0, remaining: staffTotal } },
        } }))
        const csrf = await (await page.request.get(`${APP}/api/auth/csrf/`)).json()
        await page.request.post(`${APP}/api/auth/callback/credentials/`, { form: {
          csrfToken: csrf.csrfToken, username: STAND_USERNAME, password: STAND_PASSWORD, json: 'true',
        } })
        const suffix = explicit ? 'businessDate=2026-10-20' : ''
        await page.goto(pageKind === 'statuses' ? `${APP}/statuses/?${suffix}` : `${APP}/employees/?view=daily&${suffix}`)
        const region = page.getByRole('region', { name: pageKind === 'statuses' ? 'Сдача дня за управление' : 'Ежедневный расход', exact: true })
        if (pageKind === 'statuses') {
          await expect(region.getByLabel('Расход на дату', { exact: true })).toHaveValue(explicit ? '2026-10-20' : '2026-10-10')
        } else {
          await expect(region.getByRole('button', { name: explicit ? '20 октября 2026' : '10 октября 2026', exact: true })).toBeVisible()
          await expect(region.getByRole('group', { name: 'Сводка по департаменту' })).toContainText('1337')
        }
        serverDate = '2026-10-11'
        staffTotal = 1448
        await page.getByRole('button', { name: 'Обновить', exact: true }).click()
        if (pageKind === 'statuses') {
          await expect(region.getByLabel('Расход на дату', { exact: true })).toHaveValue(explicit ? '2026-10-20' : '2026-10-11')
          if (explicit) {
            await region.getByRole('button', { name: 'Вернуть завтра', exact: true }).click()
            await expect(region.getByLabel('Расход на дату', { exact: true })).toHaveValue('2026-10-11')
          }
        } else {
          await expect(region.getByRole('button', { name: explicit ? '20 октября 2026' : '11 октября 2026', exact: true })).toBeVisible()
          await expect(region.getByRole('group', { name: 'Сводка по департаменту' })).toContainText('1448')
        }
      })
    }
  }

  for (const pageKind of ['statuses', 'board'] as const) {
  test(`${pageKind}: ошибка повторного чтения даты блокирует сдачу по устаревшему умолчанию`, async ({ page }) => {
    await page.clock.install()
    let failDate = false
    await page.route('**/api/**', route => {
      const request = route.request()
      return !['GET', 'HEAD', 'OPTIONS'].includes(request.method()) && !new URL(request.url()).pathname.startsWith('/api/auth/')
        ? route.abort() : route.continue()
    })
    await page.route('**/api/operations/my-permissions/**', route => route.fulfill({ json: {
      permissions: ['*'], global_permissions: ['*'], roles: [],
    } }))
    await page.route('**/api/operations/tomorrow-block/**', route => route.fulfill(failDate
      ? { status: 503, json: { detail: 'Date temporarily unavailable' } }
      : { json: { business_date: '2026-10-10', blocked: false, laggards: [] } }))
    await page.route('**/api/ops/daily/divisions/**', route => route.fulfill({ json: { results: [
      { id: '3', name: 'Проверочное управление', division_type: 'directorate', can_submit: true, can_correct: true },
    ] } }))
    await page.route('**/api/ops/daily/daily-submissions/**', route => route.fulfill({ json: { results: [] } }))
    await page.route(url => url.pathname === '/api/operations/strength-report/', route => route.fulfill({ json: {
      business_date: '2026-10-10', columns: [], column_labels: {}, rows: [
        { division_id: 3, name: 'Проверочное управление', list_total: 1, staff_total: 1, columns: {} },
      ], warnings: [],
      totals: { staff_total: 1, list_total: 1, vacancies: 0, attached: 0, off_list: 0, columns: {}, event: { assigned: 0, remaining: 1 } },
    } }))
    const csrf = await (await page.request.get(`${APP}/api/auth/csrf/`)).json()
    await page.request.post(`${APP}/api/auth/callback/credentials/`, { form: {
      csrfToken: csrf.csrfToken, username: STAND_USERNAME, password: STAND_PASSWORD, json: 'true',
    } })
    await page.goto(pageKind === 'statuses' ? `${APP}/statuses/` : `${APP}/employees/?view=daily`)
    const region = page.getByRole('region', { name: pageKind === 'statuses' ? 'Сдача дня за управление' : 'Ежедневный расход', exact: true })
    if (pageKind === 'board') {
      await region.getByRole('group', { name: 'Проверочное управление', exact: true }).locator('button[aria-expanded]').click()
    }
    await expect(region.getByRole('button', { name: 'Сдать день', exact: true })).toBeEnabled()
    failDate = true
    await page.clock.fastForward(6 * 60_000)
    await page.evaluate(() => {
      window.dispatchEvent(new Event('offline'))
      window.dispatchEvent(new Event('online'))
    })
    await expect(region.getByText('Не удалось загрузить дату расхода.', { exact: true })).toBeVisible()
    await expect(region.getByRole('button', { name: 'Сдать день', exact: true })).toBeHidden()
    failDate = false
    await region.getByRole('button', { name: 'Повторить загрузку даты', exact: true }).click()
    await expect(region.getByRole('button', { name: 'Сдать день', exact: true })).toBeEnabled()
  })
  }
})
