// Real access settings checks with owned accounts and roles. No route mocks.
import { randomBytes, randomUUID } from 'node:crypto'
import { expect, test, type APIRequestContext, type Page } from '@playwright/test'
import { STAND_PASSWORD, STAND_USERNAME } from './stand-credentials'

const API = process.env.SMOKE_API ?? 'http://127.0.0.1:8100'
const APP = process.env.SMOKE_APP ?? 'http://localhost:3106'
type Headers = { Authorization: string }
interface AccountBody { id: number; username: string; is_active: boolean; employee_id: number | null }
interface RoleBody { code: string; name: string; description: string; is_active: boolean; permissions: string[] }
interface GrantBody { id: number; user_id: string; role_code: string; scope_division_id: number | null; is_active: boolean }
interface PermissionsBody {
  permissions: string[]
  global_permissions: string[]
  roles: { code: string; scope_division_id: number | null }[]
}
interface Profile { name: string; permission: '*' | 'admin.roles'; scope: number | null; global: boolean }
type AccessResource = 'accounts' | 'roles' | 'permissions' | 'user-roles' | 'access-catalog'
const profiles: Profile[] = [
  { name: 'scoped wildcard', permission: '*', scope: 2, global: false },
  { name: 'scoped explicit admin.roles', permission: 'admin.roles', scope: 2, global: false },
  { name: 'unscoped explicit admin.roles', permission: 'admin.roles', scope: null, global: true },
]
const screens = [
  { path: '/settings/users/', title: 'Пользователи', reads: ['accounts', 'roles', 'user-roles'] },
  { path: '/settings/roles/', title: 'Роли', reads: ['roles', 'permissions'] },
  { path: '/settings/permissions/', title: 'Права', reads: ['permissions', 'access-catalog'] },
] as const

function resourceAt(url: string): AccessResource | null {
  const path = new URL(url).pathname
  const match = path.match(/\/api\/operations\/(accounts|roles|permissions|user-roles)(?:\/|$)/)
  if (match) return match[1] as AccessResource
  return path.endsWith('/api/ops/access-catalog/') ? 'access-catalog' : null
}

async function tokenHeaders(request: APIRequestContext, username: string, password: string): Promise<Headers> {
  const response = await request.post(`${API}/api/token/`, { data: { username, password } })
  expect(response.status()).toBe(200)
  const body = await response.json() as { access: string }
  expect(body.access).toBeTruthy()
  return { Authorization: `Bearer ${body.access}` }
}

async function signIn(page: Page, username: string, password: string): Promise<void> {
  const csrf = await page.request.get(`${APP}/api/auth/csrf/`)
  expect(csrf.status()).toBe(200)
  const login = await page.request.post(`${APP}/api/auth/callback/credentials/`, {
    form: { csrfToken: (await csrf.json()).csrfToken, username, password, json: 'true' },
  })
  expect(login.status()).toBe(200)
  expect((await login.json()).url).not.toContain('error=')
}

for (const profile of profiles) {
  for (const screen of screens) {
    test(`global access UI: ${profile.name} ${profile.global ? 'opens' : 'cannot open'} ${screen.path}`, async ({ page, request }) => {
      test.skip(process.env.SMOKE_LIVE !== '1', 'requires the real standalone API and application')
      const adminHeaders = await tokenHeaders(request, STAND_USERNAME, STAND_PASSWORD)
      const adminPermissions = await request.get(`${API}/api/operations/my-permissions/`, { headers: adminHeaders })
      expect(adminPermissions.status()).toBe(200)
      const admin = await adminPermissions.json() as PermissionsBody
      expect(admin.global_permissions.some(code => code === '*' || code === 'admin.roles'),
        'fixture provisioning requires actual unscoped administration').toBe(true)
      const division = await request.get(`${API}/api/core/divisions/2/`, { headers: adminHeaders })
      expect(division.status()).toBe(200)
      expect(await division.json()).toMatchObject({ id: 2, type_code: 'department', parent: 1 })

      const fixtureKey = randomUUID()
      const username = `e2e_access_global_${fixtureKey}`
      const password = randomBytes(24).toString('base64url')
      const roleCode = `E2E_ACCESS_${fixtureKey}` // 47 characters; Role.code max_length=50.
      const roleName = `Owned global access ${fixtureKey}`
      const roleDescription = `e2e-owned-global-access:${fixtureKey}`
      const roleUrl = `${API}/api/operations/roles/${encodeURIComponent(roleCode)}/`
      let accountId: number | undefined
      let roleCreated = false
      const grants: { id: number; roleCode: string; scope: number | null }[] = []
      let scenarioError: unknown
      let permissionsAnswered = false
      const calls: { resource: AccessResource; method: string; path: string; afterPermissions: boolean }[] = []
      const replies: { resource: AccessResource; method: string; path: string; status: number }[] = []
      const readBodies = new Map<AccessResource, Promise<{ status: number; results: unknown }>>()

      const requireOwnAccount = async (): Promise<AccountBody> => {
        if (accountId === undefined) throw new Error('no captured own account ID')
        const response = await request.get(`${API}/api/operations/accounts/${accountId}/`, { headers: adminHeaders })
        expect(response.status()).toBe(200)
        const row = await response.json() as AccountBody
        expect(row).toMatchObject({ id: accountId, username, employee_id: null })
        return row
      }
      const requireOwnRole = async (): Promise<RoleBody> => {
        if (!roleCreated) throw new Error('no captured own role creation')
        const response = await request.get(roleUrl, { headers: adminHeaders })
        expect(response.status()).toBe(200)
        const row = await response.json() as RoleBody
        expect(row).toMatchObject({ code: roleCode, name: roleName, description: roleDescription })
        return row
      }
      const ownGrantRows = async (): Promise<GrantBody[]> => {
        await requireOwnAccount()
        const rows: GrantBody[] = []
        const seen = new Set<string>()
        let next: string | null = `${API}/api/operations/user-roles/?user_id=${accountId}&limit=1000`
        while (next !== null) {
          const url = new URL(next, API)
          expect(url.origin).toBe(new URL(API).origin)
          expect(url.pathname).toBe('/api/operations/user-roles/')
          expect(url.searchParams.get('user_id')).toBe(String(accountId))
          expect(seen.has(url.href), 'owned grant pagination must not loop').toBe(false)
          seen.add(url.href)
          const response = await request.get(url.href, { headers: adminHeaders })
          expect(response.status()).toBe(200)
          const body = await response.json() as { results: GrantBody[]; next: string | null }
          expect(Array.isArray(body.results)).toBe(true)
          expect(body.next === null || typeof body.next === 'string').toBe(true)
          for (const row of body.results) expect(row.user_id).toBe(String(accountId))
          rows.push(...body.results)
          next = body.next
        }
        expect(new Set(rows.map(row => row.id)).size).toBe(rows.length)
        return rows
      }
      const requirePermissions = (body: PermissionsBody): void => {
        expect(body.permissions).toEqual([profile.permission])
        expect(body.global_permissions).toEqual(profile.global ? ['admin.roles'] : [])
        expect(body.roles.map(({ code, scope_division_id }) => ({ code, scope_division_id })))
          .toEqual([{ code: roleCode, scope_division_id: profile.scope }])
      }

      try {
        const absent = await request.get(roleUrl, { headers: adminHeaders })
        expect(absent.status(), 'the UUID role must never overwrite an existing role').toBe(404)
        const account = await request.post(`${API}/api/operations/accounts/`, {
          headers: adminHeaders, data: { username, password, is_active: true },
        })
        expect(account.status()).toBe(201)
        const accountBody = await account.json() as AccountBody
        if (!Number.isSafeInteger(accountBody.id) || accountBody.id <= 0) throw new Error('invalid owned account ID')
        accountId = accountBody.id
        expect(accountBody).toMatchObject({ username, employee_id: null, is_active: true })
        const role = await request.post(`${API}/api/operations/roles/`, {
          headers: adminHeaders, data: { code: roleCode, name: roleName, description: roleDescription, is_active: true },
        })
        expect(role.status()).toBe(201)
        roleCreated = true
        expect((await requireOwnRole()).permissions).toEqual([])
        // Assign the empty OWN role first: a role that already contains '*'
        // cannot be assigned with a department scope by the public contract.
        const grant = await request.post(`${API}/api/operations/user-roles/`, {
          headers: adminHeaders,
          data: { user_id: String(accountId), role_code: roleCode, scope_division_id: profile.scope },
        })
        expect(grant.status()).toBe(201)
        const grantBody = await grant.json() as GrantBody
        if (!Number.isSafeInteger(grantBody.id) || grantBody.id <= 0) throw new Error('invalid owned grant ID')
        grants.push({ id: grantBody.id, roleCode, scope: profile.scope })
        expect(grantBody).toMatchObject({ user_id: String(accountId), role_code: roleCode, scope_division_id: profile.scope, is_active: true })
        await requireOwnRole()
        const composition = await request.post(`${roleUrl}permissions/`, {
          headers: adminHeaders, data: { add: [profile.permission] },
        })
        expect(composition.status()).toBe(200)
        expect(await composition.json()).toMatchObject({ code: roleCode, permissions: [profile.permission] })

        const actorHeaders = await tokenHeaders(request, username, password)
        const actorPermissions = await request.get(`${API}/api/operations/my-permissions/`, { headers: actorHeaders })
        expect(actorPermissions.status()).toBe(200)
        requirePermissions(await actorPermissions.json() as PermissionsBody)
        await signIn(page, username, password)
        // Actual browser events only: no routes are intercepted or fulfilled.
        page.on('request', browserRequest => {
          const resource = resourceAt(browserRequest.url())
          if (resource === null) return
          const url = new URL(browserRequest.url())
          calls.push({ resource, method: browserRequest.method(), path: `${url.pathname}${url.search}`, afterPermissions: permissionsAnswered })
        })
        page.on('response', response => {
          const url = new URL(response.url())
          if (url.pathname.endsWith('/my-permissions/') && response.status() === 200) permissionsAnswered = true
          const resource = resourceAt(response.url())
          if (resource !== null) {
            replies.push({ resource, method: response.request().method(), path: `${url.pathname}${url.search}`, status: response.status() })
            const collectionPath = resource === 'access-catalog'
              ? '/api/ops/access-catalog/'
              : `/api/operations/${resource}/`
            if (profile.global && response.request().method() === 'GET' &&
              url.pathname === collectionPath && !readBodies.has(resource)) {
              readBodies.set(resource, response.json()
                .then((body: { results: unknown }) => ({ status: response.status(), results: body.results }))
                .catch(() => ({ status: response.status(), results: undefined })))
            }
          }
        })
        const actualPermissions = page.waitForResponse(response => response.request().method() === 'GET' &&
          new URL(response.url()).pathname.endsWith('/my-permissions/') && !new URL(response.url()).searchParams.has('division_id'))
        const target = new URL(screen.path, APP)
        if (screen.path === '/settings/users/') {
          target.searchParams.set('search', username)
          target.searchParams.set('user', String(accountId))
        } else if (screen.path === '/settings/roles/') {
          target.searchParams.set('search', roleCode)
          target.searchParams.set('code', roleCode)
        } else {
          target.searchParams.set('search', 'admin.roles')
          target.searchParams.set('code', 'admin.roles')
        }
        await page.goto(target.href, { waitUntil: 'domcontentloaded' })
        const browserPermissions = await actualPermissions
        expect(browserPermissions.status()).toBe(200)
        const effectiveAccess = await browserPermissions.json() as PermissionsBody
        requirePermissions(effectiveAccess)
        const denied = page.getByRole('heading', { name: 'Доступ закрыт', exact: true })
        if (profile.global) {
          await expect(page.getByRole('heading', { name: screen.title, exact: true })).toBeVisible()
          await expect(denied).toHaveCount(0)
          await expect.poll(() => screen.reads.every(resource => readBodies.has(resource)),
            { message: 'the unscoped custom role must perform every actual access read required by this screen' }).toBe(true)
          for (const resource of screen.reads) {
            const response = await readBodies.get(resource)!
            expect(response.status, `an unscoped custom admin.roles grant must read actual ${resource}`).toBe(200)
            expect(Array.isArray(response.results), `actual ${resource} response must contain a list`).toBe(true)
          }
          if (screen.path === '/settings/users/') {
            await expect(page.getByRole('table').getByRole('button', { name: username, exact: true })).toBeVisible()
            await expect(page.locator('ul[aria-label="Роли человека"] li').filter({ hasText: roleCode })).toHaveCount(1)
          } else if (screen.path === '/settings/roles/') {
            await expect(page.getByRole('table').getByRole('button', { name: roleCode, exact: true })).toBeVisible()
            await expect(page.locator('ul[aria-label="Состав прав роли"] li').filter({ hasText: 'admin.roles' })).toHaveCount(1)
          } else {
            await expect(page.getByText('Где применяется', { exact: true })).toBeVisible()
            await expect(page.getByText('/api/ops/access-catalog/', { exact: false }).first()).toBeVisible()
          }
        } else {
          // Soft assertions keep both the missing denial and the leaked reads
          // in a single RED artifact while the owned resources still clean up.
          await expect.soft(denied).toBeVisible({ timeout: 5_000 })
          await page.waitForLoadState('networkidle')
          expect.soft(calls, 'a scoped grant must make NO access-data request, including before permissions resolve').toEqual([])
          await expect.soft(page.getByRole('heading', { name: screen.title, exact: true })).toHaveCount(0, { timeout: 1_000 })
        }
        // Require the actual navigation/header to exist before absence checks.
        await expect(page.locator('aside nav')).toBeVisible()
        await expect(page.getByRole('button', { name: 'Меню пользователя', exact: true })).toBeVisible()
        for (const entry of screens) {
          const withoutSlash = entry.path.slice(0, -1)
          const link = page.locator(`aside nav a[href="${entry.path}"], aside nav a[href="${withoutSlash}"]`)
          if (profile.global) {
            await expect(link).toHaveCount(1)
            await expect(link).toContainText(entry.title)
          } else {
            await expect.soft(link).toHaveCount(0, { timeout: 1_000 })
          }
        }
        await page.getByRole('button', { name: 'Меню пользователя', exact: true }).click()
        const userMenu = page.getByRole('menu')
        await expect(userMenu).toBeVisible()
        const settings = userMenu.getByRole('menuitem', { name: 'Настройки', exact: true })
        // /settings opens policy settings: its page and API use settings.view,
        // including an effective scoped wildcard. Access administration above
        // remains restricted to an unscoped admin.roles grant.
        const canViewPolicySettings = effectiveAccess.permissions.some(code => code === '*' || code === 'settings.view')
        if (canViewPolicySettings) {
          await expect(settings).toBeVisible()
          await expect(settings).toHaveAttribute('href', '/settings/')
        } else await expect.soft(settings).toHaveCount(0, { timeout: 1_000 })
        await page.keyboard.press('Escape')
        if (!profile.global) expect(calls, 'closed access reads must remain disabled after navigation/header checks').toEqual([])
      } catch (error) {
        scenarioError = error
        throw error
      } finally {
        const failures: unknown[] = []
        for (const captured of grants) {
          try {
            const row = (await ownGrantRows()).find(grant => grant.id === captured.id)
            expect(row, 'only a captured grant of this owned account may be removed').toBeDefined()
            expect(row).toMatchObject({ user_id: String(accountId), role_code: captured.roleCode, scope_division_id: captured.scope })
            const removed = await request.delete(`${API}/api/operations/user-roles/${captured.id}/`, { headers: adminHeaders })
            expect(removed.status()).toBe(204)
          } catch (error) { failures.push(error) }
        }
        if (roleCreated) {
          try {
            await requireOwnRole()
            const removed = await request.post(`${roleUrl}permissions/`, { headers: adminHeaders, data: { remove: [profile.permission] } })
            expect(removed.status()).toBe(200)
            expect(await removed.json()).toMatchObject({ code: roleCode, permissions: [] })
          } catch (error) { failures.push(error) }
          try {
            await requireOwnRole()
            const blocked = await request.patch(roleUrl, { headers: adminHeaders, data: { is_active: false } })
            expect(blocked.status()).toBe(200)
            expect(await blocked.json()).toMatchObject({ code: roleCode, is_active: false })
          } catch (error) { failures.push(error) }
        }
        if (accountId !== undefined) {
          try {
            await requireOwnAccount()
            const blocked = await request.patch(`${API}/api/operations/accounts/${accountId}/`, { headers: adminHeaders, data: { is_active: false } })
            expect(blocked.status()).toBe(200)
            expect(await blocked.json()).toMatchObject({ id: accountId, username, is_active: false })
          } catch (error) { failures.push(error) }
        }
        await test.info().attach('owned-global-access-ui-fixture', {
          contentType: 'application/json',
          body: Buffer.from(JSON.stringify({ fixtureKey, accountId, username, roleCode, roleName, roleDescription, grants, profile, screen: screen.path, calls, replies, cleanupFailures: failures.length }, null, 2)),
        })
        if (failures.length > 0) throw new AggregateError(scenarioError === undefined ? failures : [scenarioError, ...failures], 'failed to clean up owned global-access UI fixtures')
      }
    })
  }
}
