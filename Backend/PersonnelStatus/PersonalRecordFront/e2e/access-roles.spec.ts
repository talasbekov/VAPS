/**
 * Экран «Роли» в настройках на ЖИВОМ стенде (Plane №36, шаг «П-7»).
 *
 * Проба отвечает на два вопроса: поиск СУЖАЕТ реестр ролей (проверяется и
 * отсев — поиск, который ничего не отсеивает, прошёл бы проверку «нужная роль
 * видна»), и состав прав правится на самом экране — выданное право появляется
 * в составе, снятое исчезает, причём снятие спрашивает подтверждение.
 *
 * Проба создаёт собственную UUID-роль через настоящий экран. Права собираются
 * и снимаются тем же экраном; независимая аварийная уборка возвращает только
 * её состав к пустому и отключает только её. Назначения людям не создаются.
 * Мутирующая проба допускается только на отдельном ночном API18346/UI3347.
 *
 * Без SMOKE_LIVE=1 скипается: нужен отдельный API :18346 + UI :3347.
 */
import { randomUUID } from 'node:crypto'
import { expect, test, type Page } from '@playwright/test'
import { confirmInDialog } from './dialog'
import { STAND_PASSWORD, STAND_USERNAME } from './stand-credentials'

const LIVE = process.env.SMOKE_LIVE === '1'
const APP = process.env.SMOKE_APP ?? 'http://localhost:3106'
const API = process.env.SMOKE_API ?? 'http://127.0.0.1:18346'

// Mutations require one complete approved tuple; mixed targets are rejected.
function isolatedDatabase(): string {
  const api = new URL(API)
  const app = new URL(APP)
  const local = (url: URL) => url.protocol === 'http:' &&
    ['localhost', '127.0.0.1'].includes(url.hostname) && url.pathname === '/' &&
    !url.username && !url.password && !url.search && !url.hash
  const targets = [
    ['18346', '3347', 'smart-night-20261008-backend-1', 'smart_night_20261008'],
    ['18349', '3350', 'smart-complete-20261008-backend-1', 'smart_complete_20261008'],
    ['18349', '3350', 'smart-refine-20261008-backend-1', 'smart_refine_20261008'],
    ['18351', '3354', 'smart-eight-hours-20261009-backend-1', 'smart_eight_hours_20261009'],
  ]
  const target = targets.find(([apiPort, appPort, container]) =>
    api.port === apiPort && app.port === appPort && process.env.SMOKE_DOCKER_CONTAINER === container)
  if (!local(api) || !local(app) || !target) throw new Error('Refuse mutations outside an approved isolated API/UI/container tuple')
  return target[3]
}

interface RoleBody {
  code: string; name: string; description: string; is_active: boolean; permissions: string[]
}

async function signIn(page: Page, username = STAND_USERNAME, password = STAND_PASSWORD): Promise<void> {
  const api = page.context().request
  const csrf = (await (await api.get(`${APP}/api/auth/csrf/`)).json()) as {
    csrfToken: string
  }
  const signedIn = await api.post(`${APP}/api/auth/callback/credentials/`, {
    form: { csrfToken: csrf.csrfToken, username, password, json: 'true' },
  })
  expect(signedIn.status()).toBe(200)
}

test.describe(LIVE ? 'роли в настройках' : 'роли в настройках (скип: нет SMOKE_LIVE=1)', () => {
  test.skip(!LIVE, 'нужен живой стек: SMOKE_LIVE=1')

  test('поиск сужает реестр, состав прав собирается и снимается', async ({ page, request }) => {
    isolatedDatabase()
    const marker = randomUUID()
    const PROBE_ROLE = `Z_E2E_PROBE_${marker}`
    const roleName = `Роль пробы ${marker}`
    const roleDescription = `e2e-owned-role-composition:${marker}`
    expect(PROBE_ROLE.length).toBeLessThanOrEqual(50)
    const roleUrl = `${API}/api/operations/roles/${encodeURIComponent(PROBE_ROLE)}/`
    const permissionsPath = `/api/operations/roles/${encodeURIComponent(PROBE_ROLE)}/permissions/`
    const auth = await request.post(`${API}/api/token/`, {
      data: { username: STAND_USERNAME, password: STAND_PASSWORD },
    })
    expect(auth.status()).toBe(200)
    const token = (await auth.json()).access as string
    expect(token).toBeTruthy()
    const headers = { Authorization: `Bearer ${token}` }
    const absent = await request.get(roleUrl, { headers })
    expect(absent.status(), 'a fresh owned UUID role must not exist before UI creation').toBe(404)
    let roleCreated = false
    let scenarioError: unknown
    const validateOwnRole = async (): Promise<RoleBody | undefined> => {
      const response = await request.get(roleUrl, { headers })
      if (!roleCreated && response.status() === 404) return undefined
      expect(response.status()).toBe(200)
      const row = await response.json() as RoleBody
      expect(row).toMatchObject({ code: PROBE_ROLE, name: roleName, description: roleDescription })
      expect(Array.isArray(row.permissions)).toBe(true)
      expect(row.permissions.every(code => code === 'admin.roles'), 'cleanup refuses any unexpected permission').toBe(true)
      expect(new Set(row.permissions).size).toBe(row.permissions.length)
      return row
    }
    const assertOwnRoleUnassigned = async () => {
      const response = await request.get(`${API}/api/operations/user-roles/?search=${encodeURIComponent(PROBE_ROLE)}&limit=1`, { headers })
      expect(response.status()).toBe(200)
      const body = await response.json() as { count: number; results: unknown[]; next: string | null }
      // An authoritative total of zero excludes assignments beyond page 1 too.
      expect(body.count, 'this scenario never assigns its UUID role to an account').toBe(0)
      expect(body.results).toEqual([])
      expect(body.next).toBeNull()
    }

    const errors: string[] = []
    page.on('pageerror', (e) => errors.push(String(e)))
    page.on('console', (m) => {
      if (m.type() === 'error') errors.push(m.text())
    })

    try {
    await signIn(page)
    const initialRoles = page.waitForResponse(response => {
      const url = new URL(response.url())
      return url.pathname === '/api/operations/roles/' && response.request().method() === 'GET' && !url.searchParams.has('search')
    })
    await page.goto(`${APP}/settings/roles/`)
    expect((await initialRoles).status()).toBe(200)
    await expect(page.getByRole('heading', { name: 'Роли', exact: true })).toBeVisible()

    const registry = page.getByRole('table')
    // Список приезжает запросом: считать строки сразу после перехода значит
    // считать пустую таблицу (первый прогон так и упал на нуле).
    await expect.poll(async () => registry.getByRole('row').count()).toBeGreaterThan(2)
    const everything = await registry.getByRole('row').count()

    // The UUID role is always created through the UI. Absence on the first
    // page never authorizes creation or reuse of an existing shared role.
    await page.getByRole('button', { name: 'Завести роль' }).click()
    await page.getByLabel('Код').fill(PROBE_ROLE)
    await page.getByLabel('Название').fill(roleName)
    await page.getByLabel('Описание', { exact: true }).fill(roleDescription)
    const createdResponse = page.waitForResponse(response => new URL(response.url()).pathname === '/api/operations/roles/' && response.request().method() === 'POST')
    await page.getByRole('button', { name: 'Завести', exact: true }).click()
    const created = await createdResponse
    if (created.status() === 201) roleCreated = true
    expect(created.status()).toBe(201)
    expect(await created.json()).toMatchObject({ code: PROBE_ROLE, name: roleName,
      description: roleDescription, is_active: true, permissions: [] })
    await expect(page.getByRole('dialog', { name: 'Новая роль' })).toHaveCount(0)

    const filteredResponse = page.waitForResponse(response => {
      const url = new URL(response.url())
      return url.pathname === '/api/operations/roles/' && response.request().method() === 'GET' && url.searchParams.get('search') === PROBE_ROLE
    })
    await page.getByLabel('Поиск по справочнику ролей').fill(PROBE_ROLE)
    const filtered = await filteredResponse
    expect(filtered.status()).toBe(200)
    const found = await filtered.json() as { count: number; results: RoleBody[]; next: string | null }
    expect(found.count).toBe(1)
    expect(found.results).toHaveLength(1)
    expect(found.next).toBeNull()
    expect(found.results[0]).toMatchObject({ code: PROBE_ROLE, name: roleName,
      description: roleDescription, is_active: true, permissions: [] })
    await expect(registry.getByRole('button', { name: PROBE_ROLE, exact: true })).toBeVisible()
    // ОТСЕВ: без него проба зеленела бы и на поиске, который ничего не делает.
    await expect.poll(async () => registry.getByRole('row').count()).toBeLessThan(everything)

    await registry.getByRole('button', { name: PROBE_ROLE }).click()
    await expect(page.getByText('Состав прав')).toBeVisible()

    // Выдача: право уезжает из «выдать» в «состав». Локатор строки — по CSS,
    // а НЕ по роли: пока диалог открыт и закрывается, Radix прячет фон от
    // дерева доступности, и любой `getByRole` по фону вернёт ноль независимо
    // от содержимого — такой ассерт зеленел бы, ничего не проверяя.
    await page.getByLabel('Поиск права для выдачи роли').fill('admin.roles')
    // Дождаться, что список ПРЕДЛОЖЕНИЯ сузился: поиск отложенный, и клик по
    // первой кнопке «Выдать» сразу после ввода выдавал роли ПЕРВОЕ право
    // справочника — на стенде это оказался `*` (полный доступ). Проба при
    // этом зеленела: снимала она то, что нашла, а не то, что выдала.
    const offered = page.locator('ul[aria-label="Права, которые можно выдать"] li')
    await expect(offered).toHaveCount(1)
    await expect(offered.first()).toContainText('admin.roles')
    const grantedResponse = page.waitForResponse(response => new URL(response.url()).pathname === permissionsPath && response.request().method() === 'POST')
    await offered.getByRole('button', { name: 'Выдать' }).click()
    const granted = await grantedResponse
    expect(granted.status()).toBe(200)
    expect(await granted.json()).toMatchObject({ code: PROBE_ROLE, name: roleName,
      description: roleDescription, is_active: true, permissions: ['admin.roles'] })
    const grantedRow = page
      .locator('ul[aria-label="Состав прав роли"] li')
      .filter({ hasText: 'admin.roles' })
    await expect(grantedRow.getByRole('button', { name: 'Снять' })).toHaveCount(1)

    // Снятие спрашивает подтверждение: доступ пропадает у всех, кому роль выдана.
    await grantedRow.getByRole('button', { name: 'Снять' }).click()
    const removedResponse = page.waitForResponse(response => new URL(response.url()).pathname === permissionsPath && response.request().method() === 'POST')
    await confirmInDialog(page, { title: 'Снять право с роли?', button: 'Снять' })
    const removed = await removedResponse
    expect(removed.status()).toBe(200)
    expect(await removed.json()).toMatchObject({ code: PROBE_ROLE, name: roleName,
      description: roleDescription, is_active: true, permissions: [] })
    await expect(page.locator('ul[aria-label="Состав прав роли"] li')).toHaveCount(0)

    await page.screenshot({ path: 'smoke-results/access-roles.png', fullPage: true })

    expect(errors).toEqual([])
    } catch (error) { scenarioError = error; throw error }
    finally {
      const failures: unknown[] = []
      // Rediscovery covers a committed UI POST whose response was lost. Exact
      // UUID/code/name/description and zero grants are checked before each write.
      try {
        const ownRole = await validateOwnRole()
        if (ownRole !== undefined) {
          await assertOwnRoleUnassigned()
          if (ownRole.permissions.includes('admin.roles')) {
            const response = await request.post(`${API}${permissionsPath}`, {
              headers, data: { remove: ['admin.roles'] },
            })
            expect(response.status()).toBe(200)
            expect(await response.json()).toMatchObject({ code: PROBE_ROLE, name: roleName,
              description: roleDescription, permissions: [] })
          }
        }
      } catch (error) { failures.push(error) }
      try {
        const ownRole = await validateOwnRole()
        if (ownRole !== undefined) {
          await assertOwnRoleUnassigned()
          const response = await request.patch(roleUrl, { headers, data: { is_active: false } })
          expect(response.status()).toBe(200)
          expect(await response.json()).toMatchObject({ code: PROBE_ROLE, name: roleName,
            description: roleDescription, is_active: false, permissions: [] })
        }
      } catch (error) { failures.push(error) }
      try {
        await test.info().attach('own-role-composition-fixture', {
          contentType: 'application/json',
          body: Buffer.from(JSON.stringify({ marker, roleCode: PROBE_ROLE, roleCreated }, null, 2)),
        })
      } catch (error) { failures.push(error) }
      if (failures.length) throw new AggregateError(scenarioError === undefined ? failures : [scenarioError, ...failures],
        'owned role-composition cleanup failed; shared roles and account bindings preserved')
    }
  })
})
