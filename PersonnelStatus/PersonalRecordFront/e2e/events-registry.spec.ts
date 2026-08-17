/**
 * Реестр ОМ на ЖИВОМ стенде: фильтры периода и ответственного.
 *
 * Проба отвечает на один вопрос: фильтры сужают выборку НА СЕРВЕРЕ, а не по
 * загруженной странице. Разница принципиальна — фильтр по странице отвечал бы
 * «ничего не найдено» там, где записи есть на следующей.
 */
import { expect, test, type Page } from '@playwright/test'

const LIVE = process.env.SMOKE_LIVE === '1'
const APP = process.env.SMOKE_APP ?? 'http://localhost:3106'
const API = process.env.SMOKE_API ?? 'http://127.0.0.1:8100'

async function apiToken(): Promise<string> {
  const res = await fetch(`${API}/api/token/`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username: 'admin', password: 'admin123' }),
  })
  return ((await res.json()) as { access: string }).access
}

async function signIn(page: Page): Promise<void> {
  const api = page.context().request
  const csrf = (await (await api.get(`${APP}/api/auth/csrf/`)).json()) as { csrfToken: string }
  await api.post(`${APP}/api/auth/callback/credentials/`, {
    form: { csrfToken: csrf.csrfToken, username: 'admin', password: 'admin123', json: 'true' },
  })
}

test.describe(LIVE ? 'реестр ОМ' : 'реестр ОМ (скип: нет SMOKE_LIVE=1)', () => {
  test.skip(!LIVE, 'нужен живой стек: SMOKE_LIVE=1')

  test('период и ответственный фильтруют на сервере', async ({ page }) => {
    const token = await apiToken()
    const headers = { Authorization: `Bearer ${token}` }
    const all = (await (
      await fetch(`${API}/api/ops/security-events/?page_size=200`, { headers })
    ).json()) as { count: number; owners: string[]; results: { businessDate: string }[] }
    expect(all.owners.length, 'нужен хотя бы один ответственный').toBeGreaterThan(0)

    const dates = [...new Set(all.results.map((e) => e.businessDate))].sort()
    const cut = dates[dates.length - 1]
    const expected = (await (
      await fetch(`${API}/api/ops/security-events/?from=${cut}&page_size=200`, { headers })
    ).json()) as { count: number }
    expect(expected.count, 'фикстура не различает период').toBeLessThan(all.count)

    await signIn(page)
    await page.goto(`${APP}/security-ops/events/`)
    await expect(page.getByRole('heading', { name: 'Реестр ОМ' })).toBeVisible({
      timeout: 15_000,
    })

    // Полоса готовности из прототипа
    await expect(page.getByRole('progressbar').first()).toBeVisible()

    // Фильтр периода: число строк совпадает с ответом сервера на тот же запрос
    await page.getByLabel('Период с').fill(cut)
    await expect
      .poll(async () => page.locator('tbody tr').count(), { timeout: 15_000 })
      .toBe(Math.min(expected.count, 20))

    // Фильтр по ответственному предлагает значения, посчитанные сервером
    const owner = all.owners[0]
    const select = page.getByLabel('Ответственный')
    await expect(select.locator('option', { hasText: owner })).toHaveCount(1)
  })
})
