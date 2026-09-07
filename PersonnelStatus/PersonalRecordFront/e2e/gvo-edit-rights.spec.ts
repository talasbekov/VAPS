/**
 * Сводку ГВО правят создатель ОМ и начальник управления второго департамента
 * (Plane №947, задача заказчика 07.09.2026).
 *
 * ЕГО СЛОВА: «Сводные данные по Бюллетени нельзя изменить, а нужно чтобы
 * могли изменять тот кто создал, старший ГВО кого назначили, Начальник
 * управления второго департамента».
 *
 * ЧТО СТЕРЕЖЁТ ПРОБА — три половины сразу, тремя учётками матрицы доступа:
 *   1. создатель (`acc_employee_d2`) видит «Редактировать» на СВОЁМ визите;
 *   2. на ЧУЖОМ (заведённом администратором) — не видит: «создатель» не
 *      значит «кто угодно, кто умеет заводить»;
 *   3. начальник управления второго департамента (`acc_dir_head_d2`) видит
 *      кнопку и на чужом — право штаба.
 *
 * Кнопка — по слову сервера (`canEdit` в ответе сводки): клиент создателя не
 * узнаёт, поэтому подменять ответ о правах здесь нельзя — проба идёт живьём.
 * Мероприятия заводятся пробой с меткой и убираются в конце.
 *
 * Без SMOKE_LIVE=1 и ACCESS_MATRIX_PASSWORD скипается.
 */
import { expect, test, type Page } from '@playwright/test'
import { dropProbeEvents, probeTitle, probeToken } from './probe-events'
import { STAND_PASSWORD, STAND_USERNAME } from './stand-credentials'

const LIVE = process.env.SMOKE_LIVE === '1'
const APP = process.env.SMOKE_APP ?? 'http://localhost:3106'
const API = process.env.SMOKE_API ?? 'http://127.0.0.1:8100'
const PASSWORD = process.env.ACCESS_MATRIX_PASSWORD ?? ''

async function signIn(page: Page, username: string, password: string): Promise<void> {
  const api = page.context().request
  const csrf = (await (await api.get(`${APP}/api/auth/csrf/`)).json()) as { csrfToken: string }
  const res = await api.post(`${APP}/api/auth/callback/credentials/`, {
    form: { csrfToken: csrf.csrfToken, username, password, json: 'true' },
  })
  expect(res.status(), `учётка ${username} не пустила`).toBe(200)
}

async function createForeignEvent(token: string, title: string): Promise<string> {
  const res = await fetch(`${API}/api/ops/security-events/`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ title: probeTitle(title), businessDate: '2026-09-20', kind: 'FOREIGN' }),
  })
  expect(res.status, `не удалось завести пробный визит «${title}»`).toBe(201)
  return ((await res.json()) as { id: string }).id
}

test.describe(LIVE ? 'сводка ГВО: кто правит' : 'сводка ГВО: кто правит (скип: нет SMOKE_LIVE=1)', () => {
  test.skip(!LIVE, 'нужен живой стек: SMOKE_LIVE=1')
  test.skip(PASSWORD === '', 'нужен ACCESS_MATRIX_PASSWORD — тот же, которым заведены учётки')

  let ownId = ''
  let foreignId = ''
  let adminToken = ''

  test.beforeAll(async () => {
    const creator = await probeToken('acc_employee_d2', PASSWORD)
    adminToken = (await probeToken(STAND_USERNAME, STAND_PASSWORD)) ?? ''
    expect(creator, 'токен acc_employee_d2').not.toBeNull()
    expect(adminToken, 'токен стенда').not.toBe('')
    ownId = await createForeignEvent(creator!, 'Визит создателя №947')
    foreignId = await createForeignEvent(adminToken, 'Визит администратора №947')
  })

  test.afterAll(async () => {
    if (adminToken !== '') {
      const { dropped, refused } = await dropProbeEvents(adminToken)
      console.log(`уборка пробных визитов №947: снято ${dropped}, отказано ${refused}`)
    }
  })

  test('создатель правит СВОЙ визит и не правит чужой', async ({ page }) => {
    await signIn(page, 'acc_employee_d2', PASSWORD)

    await page.goto(`${APP}/security-ops/visits/${ownId}/`)
    const main = page.getByRole('main')
    await expect(main.getByRole('button', { name: 'Редактировать' }), 'создатель не видит правку своего визита').toBeVisible({ timeout: 30_000 })

    await page.goto(`${APP}/security-ops/visits/${foreignId}/`)
    // Сначала — что сводка ВООБЩЕ пришла: «кнопки нет» на пустом экране
    // зелено всегда.
    await expect(main.getByText(/Сводные данные ГВО/).first()).toBeVisible({ timeout: 30_000 })
    await expect(main.getByRole('button', { name: 'Редактировать' }), 'создатель правит ЧУЖОЙ визит').toHaveCount(0)
  })

  test('начальник управления второго департамента правит и чужой', async ({ page }) => {
    await signIn(page, 'acc_dir_head_d2', PASSWORD)
    await page.goto(`${APP}/security-ops/visits/${foreignId}/`)
    await expect(page.getByRole('main').getByRole('button', { name: 'Редактировать' }), 'штаб без правки сводки').toBeVisible({ timeout: 30_000 })
  })
})
