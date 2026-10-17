// Runtime readiness checks use the real API and keep artifacts outside Git.
import { expect, test, type Page } from '@playwright/test'
import { STAND_PASSWORD, STAND_USERNAME } from './stand-credentials'
import type { SecurityEventStage } from '../entities/security-event'

const LIVE = process.env.SMOKE_LIVE === '1'
const APP = process.env.SMOKE_APP ?? 'http://localhost:3106'
const API = process.env.SMOKE_API ?? 'http://127.0.0.1:8100'

async function signIn(page: Page): Promise<void> {
  const csrf = await page.request.get(`${APP}/api/auth/csrf/`)
  expect(csrf.status()).toBe(200)
  const { csrfToken } = await csrf.json() as { csrfToken: string }
  const response = await page.request.post(`${APP}/api/auth/callback/credentials/`, {
    form: { csrfToken, username: STAND_USERNAME, password: STAND_PASSWORD, json: 'true' },
  })
  expect(response.status(), 'вход на проверочный стенд').toBe(200)
}

test.describe('метки фактически незавершённых функций', () => {
  test.skip(!LIVE, 'нужен живой стек: SMOKE_LIVE=1')

  test('готовые разделы открываются без метки в заголовке и меню', async ({ page }, testInfo) => {
    test.setTimeout(180_000)
    await signIn(page)
    for (const route of [
      '/security-ops/events/', '/security-ops/persons/',
      '/security-ops/dictionaries/', '/security-ops/dictionaries/geo/countries/',
      '/security-ops/dictionaries/personnel/positions/', '/security-ops/profile/',
      '/security-ops/service-reports/', '/statuses/', '/dashboard/',
    ]) {
      await page.goto(`${APP}${route}`)
      await expect(page.getByRole('heading', { level: 1 }), route).toBeVisible()
      await expect(page.locator('aside').getByRole('link', { name: /^Реестр ОМ/ }), route).toBeVisible()
      await expect(page.locator('main [data-slot="in-development"]'), route).toHaveCount(0)
      await expect(page.locator('aside [data-slot="in-development"]'), route).toHaveCount(0)
    }
    await page.screenshot({ path: testInfo.outputPath('ready-sections.png') })
  })

  test('реализованные этапы ОМ не помечены устаревшими задачами', async ({ page }, testInfo) => {
    test.setTimeout(180_000)
    const response = await page.request.post(`${API}/api/token/`, {
      data: { username: STAND_USERNAME, password: STAND_PASSWORD },
    })
    expect(response.status()).toBe(200)
    const { access } = await response.json() as { access: string }
    const registry = await page.request.get(`${API}/api/ops/security-events/?page_size=100`, {
      headers: { Authorization: `Bearer ${access}` },
    })
    expect(registry.status()).toBe(200)
    const rows = await registry.json() as { results: { id: string; stage: SecurityEventStage }[] }
    const targets = [...new Map(rows.results.map(row => [row.stage, row])).values()]
    expect(targets.length, 'наполненный стенд должен содержать мероприятия').toBeGreaterThan(0)
    await signIn(page)
    for (const target of targets) {
      await page.goto(`${APP}/security-ops/events/${target.id}/`)
      await expect(page.locator('[data-slot="stage-heading"]'), target.stage).toBeVisible()
      await expect(page.locator('main [data-slot="in-development"]'), target.stage).toHaveCount(0)
    }
    await page.screenshot({ path: testInfo.outputPath('ready-event-stage.png') })
  })

  test('ежедневный расход и сбор сил работают без общей метки', async ({ page }) => {
    await signIn(page)
    for (const route of ['/employees/', '/employees/?view=forces']) {
      await page.goto(`${APP}${route}`)
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
      await expect(page.locator('main [data-slot="in-development"]')).toHaveCount(0)
    }
  })

  test('готовые отчёты и журнал действий доступны без меток разработки', async ({ page }, testInfo) => {
    await signIn(page)
    await page.goto(`${APP}/reports/`)
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
    await expect(page.locator('aside').getByRole('link', { name: /^Реестр ОМ/ })).toBeVisible()
    const absences = page.locator('[data-slot="card"]').filter({
      has: page.locator('[data-slot="card-title"]', { hasText: 'Статистика отсутствий' }),
    })
    const staffing = page.locator('[data-slot="card"]').filter({
      has: page.locator('[data-slot="card-title"]', { hasText: 'Штатное расписание' }),
    })
    for (const card of [absences, staffing]) {
      await expect(card.locator('[data-slot="in-development"]')).toHaveCount(0)
    }
    await expect(absences.getByRole('button', { name: 'Сформировать' })).toBeEnabled()
    await expect(staffing.getByRole('button', { name: 'Показать штат' })).toBeEnabled()
    await expect(page.locator('main [data-slot="in-development"]')).toHaveCount(0)
    const audit = page.locator('[data-slot="card"]').filter({
      has: page.locator('[data-slot="card-title"]', { hasText: 'Журнал действий' }),
    })
    await expect(audit.locator('[data-slot="in-development"]')).toHaveCount(0)
    await expect(audit.getByRole('link', { name: 'Открыть журнал' })).toHaveAttribute('href', /^\/security-ops\/audit\/?$/)
    await page.screenshot({ path: testInfo.outputPath('ready-report-cards.png') })
  })
})
