import { expect, test } from '@playwright/test'

const APP = process.env.SMOKE_APP ?? 'http://localhost:3106'
const API = process.env.SMOKE_API ?? 'http://127.0.0.1:8100'
const PASSWORD = process.env.ROLE_ACCOUNTS_PASSWORD ?? ''
const LIVE = process.env.SMOKE_LIVE === '1'

// Removing a query's permission gate must fail these real browser checks:
// the permitted status roster must not issue forbidden background requests.
// A positive case also protects legitimate scoped readers from over-gating.
const CASES = [
  { username: 'admin', requests: true, structure: true },
  { username: 'role_employee', requests: false, structure: false },
  { username: 'role_department_expense_officer', requests: false, structure: true },
  { username: 'role_duty_officer', requests: false, structure: true },
  { username: 'role_directorate_head', requests: true, structure: true },
  { username: 'role_forces_gathering_officer', requests: true, structure: true },
] as const

test.describe('status roster background queries respect backend permissions', () => {
  test.skip(!LIVE || PASSWORD === '', 'requires a live stand and ROLE_ACCOUNTS_PASSWORD')

  for (const actor of CASES) {
    test(`${actor.username}: request and structure queries follow actual permissions`, async ({ page }) => {
      const password = actor.username === 'admin' ? process.env.SMOKE_PASSWORD ?? '' : PASSWORD
      const tokenResponse = await page.request.post(`${API}/api/token/`, {
        data: { username: actor.username, password },
      })
      expect(tokenResponse.status()).toBe(200)
      const { access } = await tokenResponse.json()
      const permissionsResponse = await page.request.get(`${API}/api/operations/my-permissions/`, {
        headers: { Authorization: `Bearer ${access}` },
      })
      expect(permissionsResponse.status()).toBe(200)
      const { permissions } = await permissionsResponse.json() as { permissions: string[] }
      expect(permissions.includes('*') || permissions.includes('status.manage')).toBe(actor.requests)
      expect(permissions.includes('*') || permissions.includes('orgstructure.view')).toBe(actor.structure)

      const csrf = await (await page.request.get(`${APP}/api/auth/csrf/`)).json()
      const signedIn = await page.request.post(`${APP}/api/auth/callback/credentials/`, {
        form: { csrfToken: csrf.csrfToken, username: actor.username, password, json: 'true' },
      })
      expect(signedIn.status()).toBe(200)

      const requests: number[] = []
      const structures: number[] = []
      let requestStarts = 0
      let structureStarts = 0
      const errors: string[] = []
      page.on('pageerror', error => errors.push(error.message))
      page.on('request', request => {
        const pathname = new URL(request.url()).pathname
        if (pathname.endsWith('/forces/directorate-requests/')) requestStarts += 1
        if (pathname.endsWith('/divisions/divisions_tree/')) structureStarts += 1
      })
      page.on('response', response => {
        const pathname = new URL(response.url()).pathname
        if (pathname.endsWith('/forces/directorate-requests/')) requests.push(response.status())
        if (pathname.endsWith('/divisions/divisions_tree/')) structures.push(response.status())
      })
      const permissionsReady = page.waitForResponse(response =>
        response.url().includes('/api/operations/my-permissions/') && response.status() === 200)
      await page.goto(`${APP}/statuses/`)
      await permissionsReady
      await expect(page.getByRole('heading', { name: 'Управление статусами', exact: true })).toBeVisible()
      await expect(page.locator('main table tbody tr').first()).toBeVisible({ timeout: 25_000 })
      await expect(page.getByText(/^Обновлено:/).first()).toBeVisible()
      if (actor.requests) await expect.poll(() => requests.length).toBeGreaterThan(0)
      if (actor.structure) await expect.poll(() => structures.length).toBeGreaterThan(0)
      // Observe the fully hydrated roster long enough to catch queries mounted
      // with its hidden dialogs; no response is substituted or intercepted.
      await page.waitForTimeout(800)
      expect.soft(requests, 'unauthorized request banner prefetch').toEqual(actor.requests ? [200] : [])
      expect.soft(structures, 'unauthorized organization tree prefetch').toEqual(actor.structure ? [200] : [])
      expect.soft(requestStarts).toBe(actor.requests ? 1 : 0)
      expect.soft(structureStarts).toBe(actor.structure ? 1 : 0)
      expect(errors).toEqual([])
    })
  }
})

test('an access administrator with only admin.roles can choose an organizational scope', async ({ page }) => {
  test.skip(!LIVE || PASSWORD === '', 'requires a live stand and video_access_admin_only')
  const username = 'video_access_admin_only'
  const login = await page.request.post(`${API}/api/token/`, { data: { username, password: PASSWORD } })
  expect(login.status()).toBe(200)
  const { access } = await login.json()
  const permissions = await (await page.request.get(`${API}/api/operations/my-permissions/`, {
    headers: { Authorization: `Bearer ${access}` },
  })).json()
  expect(permissions.permissions).toEqual(['admin.roles'])
  const csrf = await (await page.request.get(`${APP}/api/auth/csrf/`)).json()
  expect((await page.request.post(`${APP}/api/auth/callback/credentials/`, {
    form: { csrfToken: csrf.csrfToken, username, password: PASSWORD, json: 'true' },
  })).status()).toBe(200)
  const structures: number[] = []
  page.on('response', response => {
    if (new URL(response.url()).pathname.endsWith('/divisions/divisions_tree/')) structures.push(response.status())
  })
  await page.goto(`${APP}/settings/users/`)
  await expect(page.getByRole('heading', { name: 'Пользователи', exact: true })).toBeVisible()
  await page.locator('main tbody tr button').first().click()
  await expect(page.getByLabel('Область', { exact: true })).toBeVisible()
  await expect.poll(() => page.getByLabel('Область', { exact: true }).locator('option').count()).toBeGreaterThan(1)
  expect(structures).toEqual([200])
})

test.describe('profile rating queries follow aggregate access', () => {
  test.skip(!LIVE || PASSWORD === '', 'requires a live stand and linked demo profiles')
  for (const username of ['role_employee', 'admin']) {
    test(`${username}: own profile avoids unauthorized rating queries`, async ({ page }) => {
      const password = username === 'admin' ? process.env.SMOKE_PASSWORD ?? '' : PASSWORD
      const login = await page.request.post(`${API}/api/token/`, { data: { username, password } })
      expect(login.status()).toBe(200)
      const { access } = await login.json()
      const headers = { Authorization: `Bearer ${access}` }
      const { permissions } = await (await page.request.get(`${API}/api/operations/my-permissions/`, { headers })).json()
      expect(permissions.includes('*') || permissions.includes('rating.view_aggregate')).toBe(username === 'admin')
      const { employee } = await (await page.request.get(`${API}/api/operations/my-employee/`, { headers })).json()
      expect(employee).not.toBeNull()
      const csrf = await (await page.request.get(`${APP}/api/auth/csrf/`)).json()
      expect((await page.request.post(`${APP}/api/auth/callback/credentials/`, {
        form: { csrfToken: csrf.csrfToken, username, password, json: 'true' },
      })).status()).toBe(200)
      const registry: number[] = []
      const registryStarts: string[] = []
      page.on('request', request => {
        if (new URL(request.url()).pathname.endsWith('/evaluation-registry/')) registryStarts.push(request.url())
      })
      page.on('response', response => {
        if (new URL(response.url()).pathname.endsWith('/evaluation-registry/')) registry.push(response.status())
      })
      const permissionsReady = page.waitForResponse(response =>
        response.url().includes('/api/operations/my-permissions/') && response.status() === 200)
      const assignmentsReady = page.waitForResponse(response =>
        response.url().includes('/api/ops/security-events/my-assignments/') && response.status() === 200)
      await page.goto(`${APP}/security-ops/profile/`)
      await Promise.all([permissionsReady, assignmentsReady])
      await expect(page.getByRole('heading', { name: employee.full_name, exact: true })).toBeVisible()
      await page.getByRole('button', { name: 'История', exact: true }).click()
      if (username === 'role_employee') {
        await expect(page.locator('[data-slot="history-score"]').first()).toHaveText('нет доступа')
        expect(registryStarts).toEqual([])
        expect(registry).toEqual([])
      } else {
        await expect.poll(() => registry.length).toBeGreaterThan(0)
        expect(registry.every(status => status === 200)).toBe(true)
      }
    })
  }
})

test.describe('a reader following a real forces request link', () => {
  test.skip(!LIVE || PASSWORD === '', 'requires a live stand and ROLE_ACCOUNTS_PASSWORD')
  let allocationId: string

  test.beforeAll(async ({ request }) => {
    const login = await request.post(`${API}/api/token/`, {
      data: { username: 'role_directorate_head', password: PASSWORD },
    })
    expect(login.status()).toBe(200)
    const { access } = await login.json()
    const response = await request.get(`${API}/api/ops/security-events/forces/directorate-requests/`, {
      headers: { Authorization: `Bearer ${access}` },
    })
    expect(response.status()).toBe(200)
    const { results } = await response.json() as { results: { allocationId: string }[] }
    expect(results.length, 'requires a real sent request in the stand').toBeGreaterThan(0)
    allocationId = results[0].allocationId
  })

  for (const username of ['role_employee', 'role_department_expense_officer', 'role_duty_officer']) {
    test(`${username}: a request link explains the restriction and finishes loading`, async ({ page }) => {
      const csrf = await (await page.request.get(`${APP}/api/auth/csrf/`)).json()
      expect((await page.request.post(`${APP}/api/auth/callback/credentials/`, {
        form: { csrfToken: csrf.csrfToken, username, password: PASSWORD, json: 'true' },
      })).status()).toBe(200)
      const details: string[] = []
      page.on('request', request => {
        const pathname = new URL(request.url()).pathname
        if (pathname.includes('/forces/requests/') && pathname.endsWith('/directorate/')) details.push(request.url())
      })
      await page.goto(`${APP}/statuses/?forcesRequest=${encodeURIComponent(allocationId)}`)
      await expect(page.locator('main table tbody tr').first()).toBeVisible({ timeout: 25_000 })
      const explanation = page.getByRole('region', { name: 'Запрос на сбор сил недоступен' })
      await expect(explanation).toBeVisible()
      await expect(explanation).toContainText(/прав.*выдел|выдел.*прав/i)
      await expect(page.locator('main .animate-pulse')).toHaveCount(0)
      expect(details, 'a linked request must not bypass its permission gate').toEqual([])
    })
  }
})
