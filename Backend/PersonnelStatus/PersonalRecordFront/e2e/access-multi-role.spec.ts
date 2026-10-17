/**
 * Несколько ролей у одного человека на ЖИВОМ стенде (Plane №353).
 *
 * Требование заказчика звучит одной фразой — «пользователям можно давать не
 * только одну роль, а несколько», — и распадается на два наблюдаемых факта,
 * которые до этой пробы не стерёг никто:
 *
 *   1. на экране «Пользователи» вторая роль ЛОЖИТСЯ РЯДОМ с первой, а не
 *      заменяет её;
 *   2. человек ВИДИТ весь свой состав ролей — в карточке профиля. До №353 там
 *      печаталась одна первая роль, а полный список жил в атрибуте `title`
 *      подписи в шапке: он не открывается ни с клавиатуры, ни касанием.
 *
 * Проба создаёт UUID-роль через экран, выдаёт и снимает её тем же экраном.
 * Независимая аварийная уборка API снимает только собственное назначение и
 * отключает собственную роль; исходные назначения администратора проверяются.
 * Роль пробы БЕЗ ПРАВ — выдаётся она администратору, и роль
 * с правами меняла бы ему доступ на время прогона.
 *
 * Мутирующая проба требует отдельный ночной стек API :18346 + UI :3347.
 */
import { randomUUID } from 'node:crypto'
import { expect, test, type Page, type APIRequestContext } from '@playwright/test'
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
interface GrantBody {
  id: number; user_id: string; role_code: string; scope_division_id: number | null; is_active: boolean
}

async function grantRows(request: APIRequestContext, headers: { Authorization: string },
  filter: { user_id?: string; search?: string }): Promise<GrantBody[]> {
  const url = new URL('/api/operations/user-roles/', API)
  url.searchParams.set('limit', '1000')
  for (const [key, value] of Object.entries(filter)) url.searchParams.set(key, value)
  let next: string | null = url.href
  const visited = new Set<string>()
  const rows: GrantBody[] = []
  while (next !== null) {
    const current = new URL(next, API)
    expect(current.origin).toBe(new URL(API).origin)
    expect(current.pathname).toBe('/api/operations/user-roles/')
    for (const [key, value] of Object.entries(filter)) expect(current.searchParams.get(key)).toBe(value)
    expect(visited.has(current.href), 'grant pagination must not loop').toBe(false)
    visited.add(current.href)
    const response = await request.get(current.href, { headers })
    expect(response.status()).toBe(200)
    const body = await response.json() as { results: GrantBody[]; next: string | null }
    expect(Array.isArray(body.results)).toBe(true)
    if (filter.user_id !== undefined) for (const row of body.results) expect(row.user_id).toBe(filter.user_id)
    rows.push(...body.results)
    next = body.next
  }
  return rows
}

const grantIdentity = (row: GrantBody) => ({ id: row.id, user_id: row.user_id,
  role_code: row.role_code, scope_division_id: row.scope_division_id, is_active: row.is_active })

async function signIn(page: Page, username = STAND_USERNAME, password = STAND_PASSWORD): Promise<void> {
  const api = page.context().request
  const csrf = (await (await api.get(`${APP}/api/auth/csrf/`)).json()) as {
    csrfToken: string
  }
  await api.post(`${APP}/api/auth/callback/credentials/`, {
    form: { csrfToken: csrf.csrfToken, username, password, json: 'true' },
  })
}

test.describe(LIVE ? 'несколько ролей у человека' : 'несколько ролей у человека (скип: нет SMOKE_LIVE=1)', () => {
  test.skip(!LIVE, 'нужен живой стек: SMOKE_LIVE=1')

  test('вторая роль ложится рядом с первой и видна в карточке профиля', async ({ page, request }) => {
    // UUID identity exists before the first write. Z deliberately exercises
    // a role beyond the default first page; missing options must fail honestly.
    isolatedDatabase()
    const marker = randomUUID()
    const PROBE_ROLE = `Z_E2E_SECOND_${marker}`
    const roleName = `Вторая роль пробы ${marker}`
    const roleDescription = `e2e-owned-second-role:${marker}`
    expect(PROBE_ROLE.length).toBeLessThanOrEqual(50)
    const roleUrl = `${API}/api/operations/roles/${encodeURIComponent(PROBE_ROLE)}/`
    const auth = await request.post(`${API}/api/token/`, {
      data: { username: STAND_USERNAME, password: STAND_PASSWORD },
    })
    expect(auth.status()).toBe(200)
    const token = (await auth.json()).access as string
    expect(token).toBeTruthy()
    const headers = { Authorization: `Bearer ${token}` }
    const accountId = Number(JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString()).user_id)
    expect(Number.isSafeInteger(accountId) && accountId > 0).toBe(true)
    const validateActor = async () => {
      const response = await request.get(`${API}/api/operations/accounts/${accountId}/`, { headers })
      expect(response.status()).toBe(200)
      expect(await response.json()).toMatchObject({ id: accountId, username: STAND_USERNAME, is_active: true })
    }
    await validateActor()
    const beforeGrants = await grantRows(request, headers, { user_id: String(accountId) })
    expect(beforeGrants.some(row => row.is_active), 'a real first role is required').toBe(true)
    expect(beforeGrants.filter(row => row.role_code === PROBE_ROLE)).toHaveLength(0)
    const capturedGrantIds = new Set<number>()
    const paginationRoles: RoleBody[] = []
    let roleCreated = false
    let scenarioError: unknown
    const validateOwnRole = async (allowMissing = false): Promise<RoleBody | undefined> => {
      const response = await request.get(roleUrl, { headers })
      if (allowMissing && !roleCreated && response.status() === 404) return undefined
      expect(response.status()).toBe(200)
      const row = await response.json() as RoleBody
      expect(row).toMatchObject({ code: PROBE_ROLE, name: roleName, description: roleDescription })
      expect(row.permissions).toEqual([])
      return row
    }
    const errors: string[] = []
    page.on('pageerror', (e) => errors.push(String(e)))
    page.on('console', (m) => {
      if (m.type() === 'error') errors.push(m.text())
    })

    try {
    await signIn(page)

    // Создание роли остаётся настоящим UI; API используется для проверки
    // авторитетной идентичности и ограниченной аварийной уборки.
    const initialRoles = page.waitForResponse(response => {
      const url = new URL(response.url())
      return url.pathname === '/api/operations/roles/' && response.request().method() === 'GET' && !url.searchParams.has('search')
    })
    await page.goto(`${APP}/settings/roles/`)
    expect((await initialRoles).status()).toBe(200)
    await expect(page.getByRole('heading', { name: 'Роли', exact: true })).toBeVisible()
    const rolesRegistry = page.getByRole('table')
    const searchedRoles = page.waitForResponse(response => {
      const url = new URL(response.url())
      return url.pathname === '/api/operations/roles/' && response.request().method() === 'GET' && url.searchParams.get('search') === PROBE_ROLE
    })
    await page.getByLabel('Поиск по справочнику ролей').fill(PROBE_ROLE)
    const searched = await searchedRoles
    expect(searched.status()).toBe(200)
    expect((await searched.json()).results).toEqual([])
    await expect(rolesRegistry.locator('tbody tr')).toHaveCount(0)
    await page.getByRole('button', { name: 'Завести роль' }).click()
    await page.getByLabel('Код').fill(PROBE_ROLE)
    await page.getByLabel('Название').fill(roleName)
    await page.getByLabel('Описание', { exact: true }).fill(roleDescription)
    const createdRole = page.waitForResponse(response => new URL(response.url()).pathname === '/api/operations/roles/' && response.request().method() === 'POST')
    await page.getByRole('button', { name: 'Завести', exact: true }).click()
    const created = await createdRole
    if (created.status() === 201) roleCreated = true
    expect(created.status()).toBe(201)
    expect(await created.json()).toMatchObject({ code: PROBE_ROLE, name: roleName,
      description: roleDescription, is_active: true, permissions: [] })
    await expect(rolesRegistry.getByRole('button', { name: PROBE_ROLE, exact: true })).toBeVisible()
    const readFirstRolePage = async () => {
      const response = await request.get(`${API}/api/operations/roles/?limit=50`, { headers })
      expect(response.status()).toBe(200)
      return await response.json() as { count: number; next: string | null; results: RoleBody[] }
    }
    let firstRolePage = await readFirstRolePage()
    const probePosition = firstRolePage.results.findIndex(row => row.code === PROBE_ROLE)
    // RoleViewSet orders by code. Use the actual position in that ordering,
    // not the total catalog size: only rows BEFORE the Z probe move it off
    // page one. A-prefixed UUID roles add exactly the missing predecessors.
    if (probePosition >= 0) {
      for (let index = 0; index < 50 - probePosition; index += 1) {
        const filler: RoleBody = {
          code: `A_E2E_P_${marker}_${String(index).padStart(2, '0')}`,
          name: `Роль страницы ${marker} ${index}`,
          description: `e2e-owned-role-page:${marker}:${index}`,
          is_active: true, permissions: [],
        }
        expect(filler.code.length).toBeLessThanOrEqual(50)
        const url = `${API}/api/operations/roles/${encodeURIComponent(filler.code)}/`
        expect((await request.get(url, { headers })).status()).toBe(404)
        // Record identity before POST: cleanup can rediscover a committed
        // creation even if its response is lost. No permissions or grants.
        paginationRoles.push(filler)
        const response = await request.post(`${API}/api/operations/roles/`, {
          headers, data: { code: filler.code, name: filler.name,
            description: filler.description, is_active: true },
        })
        expect(response.status()).toBe(201)
        expect(await response.json()).toMatchObject({ ...filler })
      }
      firstRolePage = await readFirstRolePage()
    }
    expect(firstRolePage.count, 'this real regression requires a role catalog spanning pages').toBeGreaterThan(50)
    expect(firstRolePage.next).not.toBeNull()
    expect(firstRolePage.results.some(row => row.code === PROBE_ROLE),
      'own Z role must really be outside the default first page').toBe(false)

    await page.goto(`${APP}/settings/users/`)
    await expect(page.getByRole('heading', { name: 'Пользователи', exact: true })).toBeVisible()

    const registry = page.getByRole('table')
    await expect.poll(async () => registry.getByRole('row').count()).toBeGreaterThan(1)
    const everything = await registry.getByRole('row').count()
    await page.getByLabel('Поиск по учётным записям').fill(STAND_USERNAME)
    // ДОЖДАТЬСЯ СУЖЕНИЯ, а не только появления нужной строки: поиск
    // отложенный, и его ответ перерисовывает реестр. Клик по строке раньше
    // ответа открывал окно подтверждения, которое тут же исчезало вместе с
    // перерисованной карточкой — проба падала «кнопка отцепилась от DOM» на
    // ровном месте (воспроизведено: с уже выданной ролью падала каждый раз).
    await expect.poll(async () => registry.getByRole('row').count()).toBeLessThan(everything)
    const actorRoles = page.waitForResponse(response => {
      const url = new URL(response.url())
      return url.pathname === '/api/operations/user-roles/' && response.request().method() === 'GET' && url.searchParams.get('user_id') === String(accountId)
    })
    await registry.getByRole('button', { name: STAND_USERNAME, exact: true }).click()
    expect((await actorRoles).status()).toBe(200)
    await expect(page.getByRole('heading', { name: 'Выдать роль' })).toBeVisible()
    // Роли человека приезжают своим запросом: смотреть на список сразу после
    // выбора значит смотреть на ещё пустой.
    await expect(page.getByText('Загрузка ролей человека…')).toHaveCount(0)

    // Локаторы по CSS, а не по роли: пока окно подтверждения открывается и
    // закрывается, Radix прячет фон от дерева доступности, и `getByRole`
    // вернул бы ноль независимо от содержимого списка.
    const assigned = page.locator('ul[aria-label="Роли человека"] li')
    const probeRow = assigned.filter({ hasText: PROBE_ROLE })
    await expect(probeRow).toHaveCount(0)
    // ПЕРВАЯ роль уже есть — иначе «вторая рядом с первой» проверять не на чем.
    const before = await assigned.count()
    expect(before).toBeGreaterThan(0)
    expect(before).toBe(beforeGrants.filter(row => row.is_active).length)

    // Real options must include the own later-page role; no fabricated option
    // or fallback API assignment substitutes for the user-visible grant.
    const roleSelect = page.getByLabel('Роль', { exact: true })
    await expect(roleSelect.locator(`option[value="${PROBE_ROLE}"]`)).toHaveCount(1)
    await roleSelect.selectOption(PROBE_ROLE)
    const assignedResponse = page.waitForResponse(response => new URL(response.url()).pathname === '/api/operations/user-roles/' && response.request().method() === 'POST')
    await page.getByRole('button', { name: 'Выдать', exact: true }).click()
    const granted = await assignedResponse
    expect(granted.status()).toBe(201)
    const ownGrant = await granted.json() as GrantBody
    expect(ownGrant).toMatchObject({ user_id: String(accountId), role_code: PROBE_ROLE,
      scope_division_id: null, is_active: true })
    expect(Number.isSafeInteger(ownGrant.id) && ownGrant.id > 0).toBe(true)
    capturedGrantIds.add(ownGrant.id)

    // ГЛАВНОЕ: прежняя роль осталась, назначений стало на одно больше.
    await expect(probeRow).toHaveCount(1)
    await expect.poll(async () => assigned.count()).toBe(before + 1)

    // Карточка профиля называет ОБЕ роли: до №353 там стояла одна первая.
    await page.getByRole('button', { name: 'Меню пользователя' }).click()
    const profileRoles = page.locator('ul[aria-label="Роли раздела"] li')
    await expect.poll(async () => profileRoles.count()).toBe(before + 1)
    await expect(page.locator('ul[aria-label="Роли раздела"]')).toContainText(
      roleName,
    )
    await page.screenshot({ path: 'smoke-results/access-multi-role.png', fullPage: true })
    await page.keyboard.press('Escape')

    // Снятие также выполняется настоящим UI и проверяет именно own grant.
    await probeRow.getByRole('button', { name: 'Снять' }).click()
    const removedResponse = page.waitForResponse(response => new URL(response.url()).pathname === `/api/operations/user-roles/${ownGrant.id}/` && response.request().method() === 'DELETE')
    await confirmInDialog(page, { title: 'Снять роль?', button: 'Снять' })
    expect((await removedResponse).status()).toBe(204)
    await expect(probeRow).toHaveCount(0)
    await expect.poll(async () => assigned.count()).toBe(before)

    expect(errors).toEqual([])
    } catch (error) { scenarioError = error; throw error }
    finally {
      const failures: unknown[] = []
      // Rediscovery handles a committed UI POST whose response was not captured.
      // No base-account patch or removal of its pre-existing roles is permitted.
      try {
        await validateActor()
        const ownRole = await validateOwnRole(true)
        if (ownRole !== undefined) {
          const rows = (await grantRows(request, headers, { search: PROBE_ROLE }))
            .filter(row => row.role_code === PROBE_ROLE)
          expect(rows.length, 'fresh UUID role can only have this scenario’s one grant').toBeLessThanOrEqual(1)
          for (const row of rows) {
            try {
              expect(row).toMatchObject({ user_id: String(accountId), role_code: PROBE_ROLE, scope_division_id: null })
              if (capturedGrantIds.size) expect(capturedGrantIds.has(row.id)).toBe(true)
              if (row.is_active) {
                const response = await request.delete(`${API}/api/operations/user-roles/${row.id}/`, { headers })
                expect(response.status()).toBe(204)
              }
            } catch (error) { failures.push(error) }
          }
        }
      } catch (error) { failures.push(error) }
      try {
        const ownRole = await validateOwnRole(true)
        if (ownRole !== undefined) {
          const rows = (await grantRows(request, headers, { search: PROBE_ROLE }))
            .filter(row => row.role_code === PROBE_ROLE)
          expect(rows.every(row => row.user_id === String(accountId) && row.scope_division_id === null && !row.is_active)).toBe(true)
          const response = await request.patch(roleUrl, { headers, data: { is_active: false } })
          expect(response.status()).toBe(200)
          expect(await response.json()).toMatchObject({ code: PROBE_ROLE, name: roleName,
            description: roleDescription, permissions: [], is_active: false })
        }
      } catch (error) { failures.push(error) }
      try {
        const remaining = await grantRows(request, headers, { user_id: String(accountId) })
        expect(remaining.filter(row => row.role_code !== PROBE_ROLE).map(grantIdentity))
          .toEqual(beforeGrants.map(grantIdentity))
        expect(remaining.filter(row => row.role_code === PROBE_ROLE && row.is_active)).toHaveLength(0)
        await validateActor()
      } catch (error) { failures.push(error) }
      // Roles have no DELETE API. Deactivate only our exact UUID fixtures,
      // and refuse any role whose identity, permissions or grants changed.
      for (const filler of paginationRoles) {
        try {
          const url = `${API}/api/operations/roles/${encodeURIComponent(filler.code)}/`
          const found = await request.get(url, { headers })
          if (found.status() === 404) continue
          expect(found.status()).toBe(200)
          const row = await found.json() as RoleBody
          expect(row).toMatchObject({ ...filler })
          expect((await grantRows(request, headers, { search: filler.code }))
            .filter(grant => grant.role_code === filler.code)).toHaveLength(0)
          const response = await request.patch(url, { headers, data: { is_active: false } })
          expect(response.status()).toBe(200)
          expect(await response.json()).toMatchObject({ ...filler, is_active: false })
        } catch (error) { failures.push(error) }
      }
      await test.info().attach('own-second-role-fixture', { contentType: 'application/json',
        body: Buffer.from(JSON.stringify({ marker, roleCode: PROBE_ROLE, accountId,
          capturedGrantIds: [...capturedGrantIds], baselineGrantIds: beforeGrants.map(row => row.id),
          paginationRoleCodes: paginationRoles.map(row => row.code) }, null, 2)) })
      if (failures.length) throw new AggregateError(scenarioError === undefined ? failures : [scenarioError, ...failures],
        'owned second-role cleanup failed; existing account/role bindings preserved')
    }
  })
})
