/**
 * Единое правило доступа в разделе ОМ (`[РЕЕ-09]`, Plane №422).
 *
 * Что здесь стережётся — ТОЛЬКО те два пункта правила, что не спорят с
 * решением заказчика №350 (31.08.2026: пункт меню без права ПРЯЧЕТСЯ, кнопка
 * внутри экрана ВЫКЛЮЧАЕТСЯ с причиной, а не убирается):
 *
 *  1) закрытый экран отвечает словами «Доступ закрыт» (заголовок), а под ним
 *     — прежняя фраза «Недостаточно прав для просмотра …», по которой экран
 *     опознают обход и пробы отказа;
 *  2) кнопки переходов этапа («Завершить этап и перейти далее», «Закрыть
 *     объект») у читателя раздела (`acc_employee_d2`) ВЫКЛЮЧЕНЫ и подсказка
 *     называет, чьё это действие — до №422 они были активны и отвечали 403
 *     без слов.
 *
 * КРАСНОТА НА МУТАЦИИ: сними `!access.can(EVENT_MANAGE)` у кнопки этапа —
 * (2) красна; убери заголовок в `ops-access-denied.tsx` — красна (1).
 */
import { expect, test, type Page } from '@playwright/test'
import { STAND_PASSWORD, STAND_USERNAME } from './stand-credentials'

const LIVE = process.env.SMOKE_LIVE === '1'
const APP = process.env.SMOKE_APP ?? 'http://localhost:3106'
const API = process.env.SMOKE_API ?? 'http://127.0.0.1:8100'
const PASSWORD = process.env.ACCESS_MATRIX_PASSWORD ?? ''

async function signIn(page: Page, username: string, password: string): Promise<void> {
  const api = page.context().request
  const csrf = (await (await api.get(`${APP}/api/auth/csrf/`)).json()) as { csrfToken: string }
  await api.post(`${APP}/api/auth/callback/credentials/`, {
    form: { csrfToken: csrf.csrfToken, username, password, json: 'true' },
  })
}

async function adminEvents(): Promise<{ id: string; stage: string }[]> {
  const tok = await fetch(`${API}/api/token/`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username: STAND_USERNAME, password: STAND_PASSWORD }),
  })
  const { access } = (await tok.json()) as { access: string }
  const res = await fetch(`${API}/api/ops/security-events/?page_size=100`, {
    headers: { Authorization: `Bearer ${access}` },
  })
  return ((await res.json()) as { results: { id: string; stage: string }[] }).results
}

test.describe(LIVE ? 'правило доступа' : 'правило доступа (скип: нет SMOKE_LIVE=1)', () => {
  test.skip(!LIVE, 'нужен живой стек: SMOKE_LIVE=1')
  test.skip(PASSWORD === '', 'нужен ACCESS_MATRIX_PASSWORD — тот же, которым заведены учётки')

  test('закрытый экран говорит «Доступ закрыт»', async ({ page }) => {
    await signIn(page, 'acc_employee_d2', PASSWORD)
    // «Система → Аудит» закрыта всем шести неадминистраторским персонам.
    await page.goto(`${APP}/security-ops/audit`)
    await expect(page.getByRole('heading', { name: 'Доступ закрыт' })).toBeVisible()
    await expect(page.getByText(/Недостаточно прав для просмотра/)).toBeVisible()
  })

  test('читатель раздела видит кнопку перехода этапа выключенной, с причиной', async ({ page }) => {
    const rows = await adminEvents()
    const target = rows.find((e) => ['RECON', 'PLACEMENT', 'ACKNOWLEDGEMENT'].includes(e.stage))
    test.skip(target === undefined, 'на стенде нет ОМ на этапах 1, 2 или 4')

    await signIn(page, 'acc_employee_d2', PASSWORD)
    await page.goto(`${APP}/security-ops/events/${target!.id}/`)
    // На расстановке кнопка зовётся «Завершить расстановку» (`[РАС-01]`, Plane №445).
    const button = page.getByRole('button', { name: /^Завершить (этап и перейти далее|расстановку)$/ })
    await expect(button).toBeVisible()
    await expect(button).toBeDisabled()
    await expect(button).toHaveAttribute('title', /ведущий ОМ или штаб/)
  })
})
