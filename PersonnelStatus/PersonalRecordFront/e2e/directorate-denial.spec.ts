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
import { expect, test, type Page } from '@playwright/test'
import { STAND_PASSWORD, STAND_USERNAME } from './stand-credentials'

const LIVE = process.env.SMOKE_LIVE === '1'
const APP = process.env.SMOKE_APP ?? 'http://localhost:3106'
const ROLE_PASSWORD = process.env.ROLE_ACCOUNTS_PASSWORD ?? ''
const API = process.env.SMOKE_API ?? 'http://127.0.0.1:8100'

/**
 * Учётка, которой ручка `directorate` отказывает.
 *
 * 🔴 УЧЁТКА СМЕНЕНА ОСОЗНАННО (Plane №325). Здесь стоял `role_viewer`: до
 * №325 отказ получала ЛЮБАЯ учётка без кадровой роли ROLE_3/6/7, и годился
 * кто угодно. Теперь ручку открывает и право раздела `status.view`, а у
 * `role_viewer` оно есть — он законно проходит, и проба на нём проверяла бы
 * не отказ, а собственную устарелость. `role_ops_reader` несёт `object.view`
 * и `duty.view`, но не `status.view`.
 *
 * Предпосылка сверяется С СЕРВЕРОМ перед проверкой: раздача прав меняется, и
 * молча ослабнуть эта проба не должна.
 */
const ROLE_ACCOUNT = 'role_ops_reader'

const DICTIONARY_PATHS = /\/api\/dictionaries\/(positions|ranks)\//

async function signIn(page: Page, username: string, password: string): Promise<void> {
  const api = page.context().request
  const csrf = (await (await api.get(`${APP}/api/auth/csrf/`)).json()) as { csrfToken: string }
  await api.post(`${APP}/api/auth/callback/credentials/`, {
    form: { csrfToken: csrf.csrfToken, username, password, json: 'true' },
  })
}

test.describe(LIVE ? 'отказ экранов расхода' : 'отказ экранов расхода (скип: нет SMOKE_LIVE=1)', () => {
  test.skip(!LIVE, 'нужен живой стенд: SMOKE_LIVE=1')

  test('403: назван отказ по праву, справочники не запрошены', async ({ page }) => {
    test.skip(ROLE_PASSWORD === '', 'нужен ROLE_ACCOUNTS_PASSWORD')

    const dictionaryCalls: string[] = []
    page.on('request', (req) => {
      if (DICTIONARY_PATHS.test(req.url())) dictionaryCalls.push(req.url())
    })

    const tokenRes = await fetch(`${API}/api/token/`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: ROLE_ACCOUNT, password: ROLE_PASSWORD }),
    })
    expect(tokenRes.status, `учётка ${ROLE_ACCOUNT} не получила токен`).toBe(200)
    const { access } = (await tokenRes.json()) as { access: string }
    const permsRes = await fetch(`${API}/api/operations/my-permissions/`, {
      headers: { Authorization: `Bearer ${access}` },
    })
    expect(permsRes.status).toBe(200)
    const { permissions = [] } = (await permsRes.json()) as { permissions?: string[] }
    test.skip(
      permissions.includes('status.view') || permissions.includes('*'),
      `у ${ROLE_ACCOUNT} появилось status.view — отказ проверять больше нечем`,
    )

    await signIn(page, ROLE_ACCOUNT, ROLE_PASSWORD)
    await page.goto(`${APP}/statuses`, { waitUntil: 'domcontentloaded' })

    // Ждём САМ отказ, а не каркас: гвард появляется после ответа ручки, и
    // чтение сразу после `domcontentloaded` врёт (класс Plane №293).
    await expect(
      page.getByText('Недостаточно прав для просмотра этого раздела.'),
    ).toBeVisible({ timeout: 25_000 })
    await expect(page.getByText('Учётная запись не привязана к подразделению.')).toBeHidden()

    expect(
      dictionaryCalls,
      'закрытый экран запрашивает справочники, которые ему не отдадут',
    ).toEqual([])
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
