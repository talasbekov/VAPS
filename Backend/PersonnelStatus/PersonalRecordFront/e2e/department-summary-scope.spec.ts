import { expect, test, type Page } from '@playwright/test'

const APP = process.env.SMOKE_APP ?? 'http://localhost:3106'
const API = process.env.SMOKE_API ?? 'http://127.0.0.1:8100'
const PASSWORD = process.env.ROLE_ACCOUNTS_PASSWORD ?? ''

async function login(page: Page, username: string) {
  const csrf = await (await page.request.get(`${APP}/api/auth/csrf/`)).json()
  const response = await page.request.post(`${APP}/api/auth/callback/credentials/`, {
    form: { csrfToken: csrf.csrfToken, username, password: PASSWORD, json: 'true' },
  })
  expect((await response.json()).url).not.toContain('error=')
}

function summaryTargets(page: Page) {
  const targets: string[] = []
  page.on('request', request => {
    const url = new URL(request.url())
    if (url.pathname.endsWith('/daily-submissions/') && url.searchParams.has('business_date') && url.searchParams.has('division_id')) {
      targets.push(url.searchParams.get('division_id')!)
    }
  })
  return targets
}

test.describe('daily department summary retains the actual role scope', () => {
  test.skip(process.env.SMOKE_LIVE !== '1' || PASSWORD === '', 'requires the live seeded role stand')
  for (const username of ['role_department_expense_officer', 'role_forces_gathering_officer']) {
    test(`${username}: department root must not become a child directorate`, async ({ page }) => {
      const auth = await page.request.post(`${API}/api/token/`, { data: { username, password: PASSWORD } })
      expect(auth.status()).toBe(200)
      const { access } = await auth.json()
      const perms = await page.request.get(`${API}/api/operations/my-permissions/`, { headers: { Authorization: `Bearer ${access}` } })
      expect(perms.status()).toBe(200)
      const { roles } = await perms.json() as { roles: { code: string; scope_division_id: number | null }[] }
      const scope = roles.find(role => ['DEPARTMENT_EXPENSE_OFFICER', 'FORCES_GATHERING_OFFICER'].includes(role.code))?.scope_division_id
      expect(scope, 'fixture requires a department-scoped grant').not.toBeNull()
      expect(scope).toBeDefined()
      await login(page, username)
      const targets = summaryTargets(page)
      await page.goto(`${APP}/employees?view=department-summary`)
      const summary = page.getByRole('region', { name: 'Суточный свод', exact: true })
      await expect(summary).toBeVisible({ timeout: 30_000 })
      await expect(summary).not.toContainText('Загрузка свода…')
      await expect.poll(() => targets.length).toBeGreaterThan(0)
      await page.waitForLoadState('networkidle')
      expect([...new Set(targets)], 'summary must target the department, not a child of the scoped tree root').toEqual([String(scope)])
    })
  }

  test('two department grants require choosing an actual department before reading versions', async ({ page }) => {
    await login(page, 'video_expense_two_scopes')
    const targets = summaryTargets(page)
    await page.goto(`${APP}/employees?view=department-summary`)
    const summary = page.getByRole('region', { name: 'Суточный свод', exact: true })
    await expect(summary.getByText('Доступно несколько департаментов. Выберите департамент, за который собираете свод.')).toBeVisible()
    const first = summary.getByRole('button', { name: 'Первый департамент', exact: true })
    const second = summary.getByRole('button', { name: 'Второй департамент', exact: true })
    await expect(first).toBeVisible()
    await expect(second).toBeVisible()
    await page.waitForLoadState('networkidle')
    expect(targets, 'a scoped tree child must never be queried before choosing a department').toEqual([])
    await first.click()
    await expect.poll(() => [...new Set(targets)]).toEqual(['2'])
    await page.waitForLoadState('networkidle')
    expect([...new Set(targets)]).toEqual(['2'])
  })

  test('a global grant remains global when a department grant is also present', async ({ page }) => {
    await login(page, 'video_expense_global_and_scoped')
    const targets = summaryTargets(page)
    const treeResponse = page.waitForResponse(response => new URL(response.url()).pathname.endsWith('/traffic-light/tree/'))
    const divisionsResponse = page.waitForResponse(response => new URL(response.url()).pathname.endsWith('/daily/divisions/'))
    await page.goto(`${APP}/employees?view=department-summary`)
    const summary = page.getByRole('region', { name: 'Суточный свод', exact: true })
    await expect(summary).toBeVisible()
    const tree = await (await treeResponse).json() as { nodes: { division_id: number; parent_id: number | null }[] }
    expect(tree.nodes.some(node => node.division_id === 18 && node.parent_id === 1),
      'the summary must resolve the full server tree instead of narrowing to the extra scoped grant').toBe(true)
    const { results: divisions } = await (await divisionsResponse).json() as { results: { id: string; division_type: string }[] }
    const departments = new Set(divisions.filter(row => row.division_type === 'department').map(row => String(row.id)))
    await expect(summary).not.toContainText('Загрузка структуры подразделений…')
    await page.waitForLoadState('networkidle')
    // Unequal coverage may select a department automatically; equal coverage
    // offers a choice. Both paths must use real departments from the full tree.
    if (targets.length === 0) {
      await summary.getByRole('button', { name: 'Второй департамент', exact: true }).click()
      await expect.poll(() => targets.length).toBeGreaterThan(0)
    }
    expect(targets.every(id => departments.has(id))).toBe(true)
  })
})
