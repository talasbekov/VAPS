/**
 * Отказ экранов расхода: ПРИЧИНА, а не общий текст (Plane №329).
 *
 * Что стерегут эти пробы — ровно две вещи, каждая своей мутацией:
 *
 * 1. Справочники должностей и званий НЕ запрашиваются на экране, который
 *    человеку всё равно закрыт. Диалоги заведения сотрудника и правки статуса
 *    смонтированы вместе со страницей, и до №329 их `useQuery` уходил в сеть
 *    при каждом заходе на /statuses и /employees — у трёх десятков ролевых
 *    учёток это давало 403 в консоль за данные, которых никто не просил.
 *    Мутация: убрать `open` из `useRanks(open)` — проба краснеет.
 *
 * 2. 400 и 403 — РАЗНЫЕ отказы с разными починками. 403 чинит администратор
 *    (выдать право), 400 — кадровик (связать учётку со штатной единицей). До
 *    №329 экран печатал на оба «Недостаточно прав», и человека с непривязанной
 *    учёткой отправляли выпрашивать право, которое у него уже есть.
 *    Мутация: вернуть один текст на обе ветки — проба краснеет.
 */
import { randomBytes } from 'node:crypto'
import { expect, test, type Page } from '@playwright/test'
import { STAND_PASSWORD, STAND_USERNAME } from './stand-credentials'

const LIVE = process.env.SMOKE_LIVE === '1'
const APP = process.env.SMOKE_APP ?? 'http://localhost:3106'
const API = process.env.SMOKE_API ?? 'http://127.0.0.1:8100'

/**
 * Реальная seed-роль без status.view. Учётка и её единственное назначение
 * принадлежат пробе; общие ролевые учётки и их пароли ей не нужны.
 * Права сверяются с сервером: изменение роли должно уронить предпосылку,
 * а не превратить проверку отказа в skip.
 */
const DENIED_ROLE = 'OBJECT_KEEPER'

const DICTIONARY_PATHS = /\/api\/dictionaries\/(positions|ranks)\//

async function signIn(page: Page, username: string, password: string): Promise<void> {
  const api = page.context().request
  const csrfResponse = await api.get(`${APP}/api/auth/csrf/`)
  expect(csrfResponse.status()).toBe(200)
  const csrf = (await csrfResponse.json()) as { csrfToken: string }
  expect(csrf.csrfToken).toEqual(expect.any(String))
  expect(csrf.csrfToken).not.toBe('')
  const login = await api.post(`${APP}/api/auth/callback/credentials/`, {
    form: { csrfToken: csrf.csrfToken, username, password, json: 'true' },
  })
  expect(login.status(), `вход ${username} не завершился успешно`).toBe(200)
  const { url } = (await login.json()) as { url: string }
  expect(url).toEqual(expect.any(String))
  expect(url).not.toContain('error=')
}

test.describe(LIVE ? 'отказ экранов расхода' : 'отказ экранов расхода (скип: нет SMOKE_LIVE=1)', () => {
  test.skip(!LIVE, 'нужен живой стенд: SMOKE_LIVE=1')

  test('403: назван отказ по праву, справочники не запрошены', async ({ page, request }) => {
    const dictionaryCalls: string[] = []
    page.on('request', (req) => {
      if (DICTIONARY_PATHS.test(req.url())) dictionaryCalls.push(req.url())
    })

    const adminAuth = await request.post(`${API}/api/token/`, {
      data: { username: STAND_USERNAME, password: STAND_PASSWORD },
    })
    expect(adminAuth.status(), 'администратор не получил токен для собственной fixture').toBe(200)
    const headers = { Authorization: `Bearer ${(await adminAuth.json()).access}` }
    const username = `e2e_directorate_denied_${Date.now()}_${randomBytes(4).toString('hex')}`
    const password = randomBytes(24).toString('base64url')
    const account = await request.post(`${API}/api/operations/accounts/`, {
      headers,
      data: { username, password },
    })
    expect(account.status(), 'не удалось создать собственную учётку отказа').toBe(201)
    const accountId = (await account.json()).id as number
    const grantIds: number[] = []
    try {
      const grant = await request.post(`${API}/api/operations/user-roles/`, {
        headers,
        data: { user_id: String(accountId), role_code: DENIED_ROLE, scope_division_id: null },
      })
      expect(grant.status(), `роль ${DENIED_ROLE} должна существовать на стенде`).toBe(201)
      grantIds.push((await grant.json()).id)
      const tokenRes = await request.post(`${API}/api/token/`, { data: { username, password } })
      expect(tokenRes.status(), `учётка ${username} не получила токен`).toBe(200)
      const { access } = (await tokenRes.json()) as { access: string }
      const deniedHeaders = { Authorization: `Bearer ${access}` }
      const permsRes = await request.get(`${API}/api/operations/my-permissions/`, {
        headers: deniedHeaders,
      })
      expect(permsRes.status()).toBe(200)
      const { permissions } = (await permsRes.json()) as { permissions: string[] }
      expect(permissions, 'назначение роли должно давать её реальное право чтения').toContain('object.view')
      expect(permissions, 'учётке отказа нельзя выдавать чтение статусов').not.toContain('status.view')
      expect(permissions, 'учётке отказа нельзя выдавать все права').not.toContain('*')
      const directorate = await request.get(`${API}/api/staff_unit/staff-units/directorate/`, {
        headers: deniedHeaders,
      })
      expect(directorate.status(), 'аутентифицированной учётке directorate должен отказать по праву').toBe(403)

      await signIn(page, username, password)
      const permissionsAnswered = page.waitForResponse((response) =>
        new URL(response.url()).pathname.endsWith('/my-permissions/'),
      )
      await page.goto(`${APP}/statuses`, { waitUntil: 'domcontentloaded' })
      const browserPermissions = await permissionsAnswered
      expect(browserPermissions.status()).toBe(200)
      const browserBody = (await browserPermissions.json()) as { permissions: string[] }
      expect(browserBody.permissions).toContain('object.view')
      expect(browserBody.permissions).not.toContain('status.view')
      expect(browserBody.permissions).not.toContain('*')

      // После ответа my-permissions страницу закрывает OpsAccessDenied на
      // status.view, поэтому браузер может не обращаться к directorate.
      // Проверяем названный отказ и отсутствие запросов справочников.
      await expect(
        page.getByText('Недостаточно прав для просмотра статусов сотрудников.'),
      ).toBeVisible({ timeout: 25_000 })
      await expect(page.getByText('Учётная запись не привязана к подразделению.')).toBeHidden()

      expect(
        dictionaryCalls,
        'закрытый экран запрашивает справочники, которые ему не отдадут',
      ).toEqual([])
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
        const blocked = await request.patch(`${API}/api/operations/accounts/${accountId}/`, {
          headers,
          data: { is_active: false },
        })
        expect(blocked.status()).toBe(200)
      } catch (error) {
        failures.push(error)
      }
      if (failures.length > 0) throw new AggregateError(failures, 'failed to clean up the owned denial account')
    }
  })

  test('400: назван отказ по привязке учётки, а не по праву', async ({ page }) => {
    // 400 воспроизводится подменой ответа: завести на стенде учётку с ролью
    // ROLE_3 и без подразделения значило бы испортить общий стенд ради одной
    // ветки текста. Проверяется РАЗВЕТВЛЕНИЕ экрана по коду ответа — оно и
    // сломалось бы при откате правки.
    await page.route(/\/api\/staff_unit\/staff-units\/directorate\//, async (route) => {
      await route.fulfill({
        status: 400,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'Не удалось определить подразделение пользователя' }),
      })
    })

    await signIn(page, STAND_USERNAME, STAND_PASSWORD)
    await page.goto(`${APP}/statuses`, { waitUntil: 'domcontentloaded' })

    await expect(
      page.getByText('Учётная запись не привязана к подразделению.'),
    ).toBeVisible({ timeout: 25_000 })
    await expect(page.getByText('Недостаточно прав для просмотра этого раздела.')).toBeHidden()
    // Причина сервера остаётся на экране: без неё поддержке нечего спросить.
    await expect(
      page.getByText(/Не удалось определить подразделение пользователя/),
    ).toBeVisible()
  })
})
