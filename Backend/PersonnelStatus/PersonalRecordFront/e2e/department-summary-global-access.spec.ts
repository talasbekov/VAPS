import { randomBytes, randomUUID } from 'node:crypto'
import { expect, test } from '@playwright/test'
import { STAND_USERNAME, STAND_PASSWORD } from './stand-credentials'

const API = process.env.SMOKE_API ?? 'http://127.0.0.1:8100'
const APP = process.env.SMOKE_APP ?? 'http://localhost:3106'

test('a scoped expense role must not narrow an administrator’s global department summary', async ({ page, request }) => {
  test.skip(process.env.SMOKE_LIVE !== '1', 'requires the real standalone application and API')
  const auth = await request.post(`${API}/api/token/`, { data: { username: STAND_USERNAME, password: STAND_PASSWORD } })
  expect(auth.status()).toBe(200)
  const headers = { Authorization: `Bearer ${(await auth.json()).access}` }
  // These are the two department fixtures of the seeded live stand, not
  // child directorates. Check the prerequisites before creating an account.
  for (const id of [2, 18]) {
    const division = await request.get(`${API}/api/core/divisions/${id}/`, { headers })
    expect(division.status(), `department fixture ${id} is missing`).toBe(200)
    const row = await division.json()
    expect(row.type_code, `fixture ${id} must be a department`).toBe('department')
    expect(row.parent, `fixture ${id} must belong to the Service`).toBe(1)
  }
  const username = `e2e_summary_global_${Date.now()}`
  const password = randomBytes(24).toString('base64url')
  const account = await request.post(`${API}/api/operations/accounts/`, { headers, data: { username, password } })
  expect(account.status()).toBe(201)
  const accountId = (await account.json()).id as number
  const grantIds: number[] = []
  try {
    for (const [role_code, scope_division_id] of [['ADMIN', null], ['DEPARTMENT_EXPENSE_OFFICER', 2]] as const) {
      const grant = await request.post(`${API}/api/operations/user-roles/`, { headers, data: { user_id: String(accountId), role_code, scope_division_id } })
      expect(grant.status()).toBe(201)
      grantIds.push((await grant.json()).id)
    }
    const csrf = await (await page.request.get(`${APP}/api/auth/csrf/`)).json()
    const login = await page.request.post(`${APP}/api/auth/callback/credentials/`, { form: { csrfToken: csrf.csrfToken, username, password, json: 'true' } })
    expect((await login.json()).url).not.toContain('error=')
    const trees: { division_id: number; parent_id: number | null }[][] = []
    const versionTargets: number[] = []
    page.on('response', async response => {
      const url = new URL(response.url())
      if (url.pathname.endsWith('/traffic-light/tree/') && response.status() === 200) {
        trees.push((await response.json()).nodes)
      }
      if (url.pathname.endsWith('/daily-submissions/') && url.searchParams.has('business_date') &&
        url.searchParams.has('division_id') && response.status() === 200) {
        versionTargets.push(Number(url.searchParams.get('division_id')))
      }
    })
    const permissionsAnswered = page.waitForResponse(response => new URL(response.url()).pathname.endsWith('/my-permissions/'))
    await page.goto(`${APP}/employees?view=department-summary`)
    const { permissions } = await (await permissionsAnswered).json()
    expect(permissions).toContain('*')
    const summary = page.getByRole('region', { name: 'Суточный свод', exact: true })
    await expect(summary).toBeVisible()
    await page.waitForLoadState('networkidle')
    expect(trees.length, 'the additional scoped grant must not replace global summary resolution').toBeGreaterThan(0)
    expect(trees.some(nodes => nodes.some(node => node.division_id === 18 && node.parent_id === 1)),
      'the global summary must retain the second department outside the extra scoped grant').toBe(true)
    // The resolver may choose a department automatically when coverage is
    // unequal. With equal coverage the user chooses from the actual tree.
    if (versionTargets.length === 0) {
      await summary.getByRole('button', { name: 'Второй департамент', exact: true }).click()
    }
    await expect.poll(() => versionTargets.length,
      { message: 'the global summary must successfully read department versions' }).toBeGreaterThan(0)
  } finally {
    const failures: unknown[] = []
    for (const id of grantIds) {
      try {
        const removed = await request.delete(`${API}/api/operations/user-roles/${id}/`, { headers })
        expect(removed.status()).toBe(204)
      } catch (error) {
        failures.push(error)
      }
    }
    try {
      const blocked = await request.patch(`${API}/api/operations/accounts/${accountId}/`, { headers, data: { is_active: false } })
      expect(blocked.status()).toBe(200)
    } catch (error) {
      failures.push(error)
    }
    if (failures.length > 0) throw new AggregateError(failures, 'failed to clean up the owned summary account')
  }
})

interface WildcardRoleBody {
  code: string
  name: string
  description: string
  is_active: boolean
  permissions: string[]
}

interface WildcardAccountBody {
  id: number
  username: string
  is_active: boolean
  employee_id: number | null
}

interface WildcardGrantBody {
  id: number
  user_id: string
  role_code: string
  scope_division_id: number | null
  is_active: boolean
}

interface WildcardPermissionsBody {
  permissions: string[]
  global_permissions: string[]
  roles: { code: string; scope_division_id: number | null }[]
}

interface WildcardTreeBody {
  nodes: { division_id: number; parent_id: number | null; name: string }[]
}

// The existing ADMIN + scoped expense test above stays intact. These custom
// codes exercise the scope contract without treating a particular role code
// as global. The wildcard is added AFTER assignment through the public API:
// assigning a role that already has '*' to a department is rightly rejected.
for (const wildcardScope of [2, null] as const) {
  test(wildcardScope === 2
    ? 'a scoped custom wildcard must retain department 2 as the summary target'
    : 'a global custom wildcard must retain global summary resolution beside a scoped expense role', async ({ page, request }) => {
    test.skip(process.env.SMOKE_LIVE !== '1', 'requires the real standalone application and API')
    const auth = await request.post(`${API}/api/token/`, { data: { username: STAND_USERNAME, password: STAND_PASSWORD } })
    expect(auth.status()).toBe(200)
    const adminHeaders = { Authorization: `Bearer ${(await auth.json()).access}` }
    // Check the real stand's department identities without changing its tree.
    for (const id of [2, 18]) {
      const response = await request.get(`${API}/api/core/divisions/${id}/`, { headers: adminHeaders })
      expect(response.status(), `department fixture ${id} is missing`).toBe(200)
      expect(await response.json()).toMatchObject({ id, type_code: 'department', parent: 1 })
    }

    const fixtureKey = randomUUID()
    const username = `e2e_summary_scoped_${fixtureKey}`
    const password = randomBytes(24).toString('base64url')
    // Role.code is limited to 50 characters; this UUID-based code is 46.
    const roleCode = `E2E_SCOPE_${fixtureKey}`
    const roleName = `Owned summary wildcard ${fixtureKey}`
    const roleDescription = `e2e-owned-scoped-wildcard:${fixtureKey}`
    const roleUrl = `${API}/api/operations/roles/${encodeURIComponent(roleCode)}/`
    let accountId: number | undefined
    let roleCreated = false
    const grants: { id: number; roleCode: string }[] = []
    const targets: number[] = []
    const versions: { target: number; status: number }[] = []
    let scenarioError: unknown

    const requireOwnAccount = async (): Promise<WildcardAccountBody> => {
      if (accountId === undefined) throw new Error('no captured account ID for owned wildcard cleanup')
      const response = await request.get(`${API}/api/operations/accounts/${accountId}/`, { headers: adminHeaders })
      expect(response.status()).toBe(200)
      const row = await response.json() as WildcardAccountBody
      expect(row).toMatchObject({ id: accountId, username, employee_id: null })
      return row
    }
    const requireOwnRole = async (): Promise<WildcardRoleBody> => {
      if (!roleCreated) throw new Error('no captured owned wildcard role')
      const response = await request.get(roleUrl, { headers: adminHeaders })
      expect(response.status()).toBe(200)
      const row = await response.json() as WildcardRoleBody
      expect(row).toMatchObject({ code: roleCode, name: roleName, description: roleDescription })
      return row
    }
    const ownGrantRows = async (): Promise<WildcardGrantBody[]> => {
      await requireOwnAccount()
      const rows: WildcardGrantBody[] = []
      let next: string | null = `${API}/api/operations/user-roles/?user_id=${accountId}&limit=1000`
      const visited = new Set<string>()
      while (next !== null) {
        const url = new URL(next, API)
        expect(url.origin).toBe(new URL(API).origin)
        expect(url.pathname).toBe('/api/operations/user-roles/')
        expect(url.searchParams.get('user_id')).toBe(String(accountId))
        expect(visited.has(url.href), 'owned grant pagination must not loop').toBe(false)
        visited.add(url.href)
        const response = await request.get(url.href, { headers: adminHeaders })
        expect(response.status()).toBe(200)
        const body = await response.json() as { results: WildcardGrantBody[]; next: string | null }
        expect(Array.isArray(body.results)).toBe(true)
        for (const row of body.results) expect(row.user_id).toBe(String(accountId))
        rows.push(...body.results)
        next = body.next
      }
      return rows
    }
    const requirePermissions = (body: WildcardPermissionsBody) => {
      expect(body.permissions).toContain('*')
      expect(body.roles.map(({ code, scope_division_id }) => ({ code, scope_division_id }))
        .sort((left, right) => left.code.localeCompare(right.code))).toEqual([
        { code: roleCode, scope_division_id: wildcardScope },
        { code: 'DEPARTMENT_EXPENSE_OFFICER', scope_division_id: 2 },
      ].sort((left, right) => left.code.localeCompare(right.code)))
      expect(body.global_permissions).toEqual(wildcardScope === 2 ? [] : ['*'])
    }

    try {
      const absent = await request.get(roleUrl, { headers: adminHeaders })
      expect(absent.status(), 'the UUID role must not overwrite an existing role').toBe(404)
      const account = await request.post(`${API}/api/operations/accounts/`, {
        headers: adminHeaders, data: { username, password, is_active: true },
      })
      expect(account.status()).toBe(201)
      const accountBody = await account.json() as WildcardAccountBody
      if (!Number.isSafeInteger(accountBody.id) || accountBody.id <= 0) throw new Error('invalid owned account ID')
      accountId = accountBody.id
      expect(accountBody).toMatchObject({ username, employee_id: null, is_active: true })

      const created = await request.post(`${API}/api/operations/roles/`, {
        headers: adminHeaders,
        data: { code: roleCode, name: roleName, description: roleDescription, is_active: true },
      })
      expect(created.status()).toBe(201)
      roleCreated = true
      const emptyRole = await requireOwnRole()
      expect(emptyRole.is_active).toBe(true)
      expect(emptyRole.permissions).toEqual([])
      for (const [code, scope] of [[roleCode, wildcardScope], ['DEPARTMENT_EXPENSE_OFFICER', 2]] as const) {
        const response = await request.post(`${API}/api/operations/user-roles/`, {
          headers: adminHeaders,
          data: { user_id: String(accountId), role_code: code, scope_division_id: scope },
        })
        expect(response.status()).toBe(201)
        const grant = await response.json() as WildcardGrantBody
        if (!Number.isSafeInteger(grant.id) || grant.id <= 0) throw new Error('invalid owned grant ID')
        grants.push({ id: grant.id, roleCode: code })
        expect(grant).toMatchObject({ user_id: String(accountId), role_code: code, scope_division_id: scope, is_active: true })
      }
      expect(new Set(grants.map(grant => grant.id)).size).toBe(2)
      await requireOwnRole()
      const added = await request.post(`${roleUrl}permissions/`, { headers: adminHeaders, data: { add: ['*'] } })
      expect(added.status()).toBe(200)
      expect(await added.json()).toMatchObject({ code: roleCode, permissions: ['*'] })

      const actorAuth = await request.post(`${API}/api/token/`, { data: { username, password } })
      expect(actorAuth.status()).toBe(200)
      const actorHeaders = { Authorization: `Bearer ${(await actorAuth.json()).access}` }
      const actorPermissions = await request.get(`${API}/api/operations/my-permissions/`, { headers: actorHeaders })
      expect(actorPermissions.status()).toBe(200)
      requirePermissions(await actorPermissions.json() as WildcardPermissionsBody)
      const actualTree = await request.get(`${API}/api/operations/traffic-light/tree/`, { headers: actorHeaders })
      expect(actualTree.status()).toBe(200)
      const tree = await actualTree.json() as WildcardTreeBody
      expect(tree.nodes.find(node => node.division_id === 2)?.parent_id).toBe(wildcardScope === 2 ? null : 1)
      if (wildcardScope === 2) {
        expect(tree.nodes.some(node => node.division_id === 18), 'scoped wildcard must not grant a foreign department').toBe(false)
      } else {
        expect(tree.nodes.some(node => node.division_id === 18 && node.parent_id === 1)).toBe(true)
      }

      const csrf = await page.request.get(`${APP}/api/auth/csrf/`)
      expect(csrf.status()).toBe(200)
      const login = await page.request.post(`${APP}/api/auth/callback/credentials/`, {
        form: { csrfToken: (await csrf.json()).csrfToken, username, password, json: 'true' },
      })
      expect(login.status()).toBe(200)
      expect((await login.json()).url).not.toContain('error=')
      // Observers inspect actual browser traffic; no page.route or client mock.
      page.on('request', responseRequest => {
        const url = new URL(responseRequest.url())
        if (url.pathname.endsWith('/daily-submissions/') && url.searchParams.has('business_date') && url.searchParams.has('division_id')) {
          targets.push(Number(url.searchParams.get('division_id')))
        }
      })
      page.on('response', response => {
        const url = new URL(response.url())
        if (url.pathname.endsWith('/daily-submissions/') && url.searchParams.has('business_date') && url.searchParams.has('division_id')) {
          versions.push({ target: Number(url.searchParams.get('division_id')), status: response.status() })
        }
      })
      const uiPermissions = page.waitForResponse(response => {
        const url = new URL(response.url())
        return url.pathname.endsWith('/my-permissions/') && !url.searchParams.has('division_id')
      })
      const uiTree = wildcardScope === null ? page.waitForResponse(response => {
        const url = new URL(response.url())
        return url.pathname.endsWith('/traffic-light/tree/') && !url.searchParams.has('root_division_id')
      }) : null
      await page.goto(`${APP}/employees?view=department-summary`)
      const [permissionsResponse, treeResponse] = await Promise.all([uiPermissions, uiTree])
      expect(permissionsResponse.status()).toBe(200)
      requirePermissions(await permissionsResponse.json() as WildcardPermissionsBody)
      const summary = page.getByRole('region', { name: 'Суточный свод', exact: true })
      await expect(summary).toBeVisible()
      await page.waitForLoadState('networkidle')
      if (wildcardScope === 2) {
        await expect.poll(() => targets.length, { message: 'the scoped summary must read actual department versions' }).toBeGreaterThan(0)
        await page.waitForLoadState('networkidle')
        expect([...new Set(targets)], 'wildcard must not replace the department with a scoped tree child').toEqual([2])
        expect(versions.length).toBeGreaterThan(0)
        expect(versions.every(row => row.target === 2 && row.status === 200)).toBe(true)
        await expect(summary).not.toContainText('Не удалось узнать, собирался ли свод')
      } else {
        if (treeResponse === null) throw new Error('the global custom wildcard requires the actual UI tree response')
        expect(treeResponse.status()).toBe(200)
        const uiNodes = (await treeResponse.json() as WildcardTreeBody).nodes
        expect(uiNodes.some(node => node.division_id === 18 && node.parent_id === 1),
          'a custom global wildcard must keep the foreign department in the real UI tree').toBe(true)
        // Equal coverage exposes an actual department picker; use the department
        // outside the extra scope. Unique coverage legitimately auto-selects.
        if (targets.length === 0) {
          const foreign = uiNodes.find(node => node.division_id === 18)
          expect(foreign).toBeDefined()
          await summary.getByRole('button', { name: foreign!.name, exact: true }).click()
          await expect.poll(() => versions.some(row => row.target === 18 && row.status === 200)).toBe(true)
        }
        await expect.poll(() => versions.length).toBeGreaterThan(0)
        await page.waitForLoadState('networkidle')
        expect(versions.every(row => row.status === 200)).toBe(true)
        expect(targets.length).toBeGreaterThan(0)
        expect(targets.every(target => uiNodes.some(node => node.division_id === target && node.parent_id === 1))).toBe(true)
        await expect(summary).not.toContainText('Не удалось узнать, собирался ли свод')
      }
    } catch (error) {
      scenarioError = error
      throw error
    } finally {
      const failures: unknown[] = []
      for (const captured of grants) {
        try {
          const ownRows = await ownGrantRows()
          const row = ownRows.find(grant => grant.id === captured.id)
          expect(row, `captured grant ${captured.id} must belong to the owned account before removal`).toBeDefined()
          expect(row).toMatchObject({ user_id: String(accountId), role_code: captured.roleCode })
          const removed = await request.delete(`${API}/api/operations/user-roles/${captured.id}/`, { headers: adminHeaders })
          expect(removed.status()).toBe(204)
        } catch (error) { failures.push(error) }
      }
      if (roleCreated) {
        try {
          await requireOwnRole()
          const removed = await request.post(`${roleUrl}permissions/`, { headers: adminHeaders, data: { remove: ['*'] } })
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
      await test.info().attach('owned-custom-wildcard-fixture', {
        contentType: 'application/json',
        body: Buffer.from(JSON.stringify({ fixtureKey, username, accountId, roleCode, wildcardScope, grants, targets, versions, cleanupFailures: failures.length }, null, 2)),
      })
      if (failures.length > 0) throw new AggregateError(scenarioError === undefined ? failures : [scenarioError, ...failures], 'failed to clean up the owned custom wildcard fixture')
    }
  })
}
