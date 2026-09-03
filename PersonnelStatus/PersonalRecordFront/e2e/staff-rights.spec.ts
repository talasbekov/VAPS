/**
 * Штаб второго департамента по всей цепочке (Plane №421, Ш-5 плана P2).
 *
 * Персона заказчика `acc_dept_head_d2` (`HEAD_OPS_UNIT`) после сида №421
 * заводит ОМ (`[БЛН-10]`), расставляет на любом объекте (`[РАС-08]`) и правит
 * сводку визита (`[ГВО-09]`). Проба ходит тем же путём, что заказчик: входит
 * учёткой, видит в реестре «+ Создать бюллетень», и по API той же учётки
 * заводит ОМ — сервер отвечает 201, а не 403, как до правки.
 *
 * Уборка стенда снимает пробные ОМ по заголовку («Проба»).
 *
 * КРАСНОТА НА МУТАЦИИ: убери `event.create` у `HEAD_OPS_UNIT` в
 * `seed_operations` и пересей стенд — создание отвечает 403.
 */
import { expect, test, type Page } from '@playwright/test'

const LIVE = process.env.SMOKE_LIVE === '1'
const APP = process.env.SMOKE_APP ?? 'http://localhost:3106'
const API = process.env.SMOKE_API ?? 'http://127.0.0.1:8100'
const PASSWORD = process.env.ACCESS_MATRIX_PASSWORD ?? ''

async function signIn(page: Page, username: string): Promise<void> {
  const api = page.context().request
  const csrf = (await (await api.get(`${APP}/api/auth/csrf/`)).json()) as { csrfToken: string }
  await api.post(`${APP}/api/auth/callback/credentials/`, {
    form: { csrfToken: csrf.csrfToken, username, password: PASSWORD, json: 'true' },
  })
}

async function tokenFor(username: string): Promise<string> {
  const res = await fetch(`${API}/api/token/`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username, password: PASSWORD }),
  })
  return ((await res.json()) as { access: string }).access
}

test.describe(LIVE ? 'права штаба' : 'права штаба (скип: нет SMOKE_LIVE=1)', () => {
  test.skip(!LIVE, 'нужен живой стек: SMOKE_LIVE=1')
  test.skip(PASSWORD === '', 'нужен ACCESS_MATRIX_PASSWORD — тот же, которым заведены учётки')

  test('acc_dept_head_d2: видит «+ Создать бюллетень» и заводит ОМ', async ({ page }) => {
    await signIn(page, 'acc_dept_head_d2')
    await page.goto(`${APP}/security-ops/events/`)
    await expect(page.getByRole('heading', { level: 1, name: 'Реестр ОМ' })).toBeVisible()
    await expect(page.getByRole('button', { name: '+ Создать бюллетень' })).toBeVisible()

    const token = await tokenFor('acc_dept_head_d2')
    const created = await fetch(`${API}/api/ops/security-events/`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        title: 'Проба прав штаба (e2e)',
        businessDate: '2026-09-25',
        kind: 'INTERNAL',
      }),
    })
    expect(created.status, await created.text()).toBe(201)
  })
})
