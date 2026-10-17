import { expect, test, type Page } from '@playwright/test'
import { STAND_PASSWORD, STAND_USERNAME } from './stand-credentials'

const LIVE = process.env.SMOKE_LIVE === '1'
const APP = process.env.SMOKE_APP ?? 'http://127.0.0.1:3350'
const alias = new URL(APP)
alias.hostname = 'localhost'

async function signIn(page: Page, app: string) {
  const csrf = await (await page.request.get(app + '/api/auth/csrf/')).json()
  const response = await page.request.post(app + '/api/auth/callback/credentials/', {
    form: { csrfToken: csrf.csrfToken, username: STAND_USERNAME, password: STAND_PASSWORD, json: 'true' },
  })
  expect(response.ok()).toBeTruthy()
}

test.describe('dashboard origin routing and honest loading state', () => {
  test.skip(!LIVE, 'Requires authenticated live portal')

  test('localhost loads every real staff page through the portal', async ({ page }) => {
    const app = alias.origin
    const calls: string[] = []
    const pages: { count: number; rows: number; next: string | null }[] = []
    const reads: Promise<void>[] = []
    page.on('request', request => {
      if (new URL(request.url()).pathname === '/api/staff_unit/staff-units/') calls.push(request.url())
    })
    page.on('response', response => {
      if (new URL(response.url()).pathname !== '/api/staff_unit/staff-units/' || response.status() !== 200) return
      reads.push(response.json().then(body => { pages.push({ count: body.count, rows: body.results.length, next: body.next }) }))
    })
    await signIn(page, app)
    await page.goto(app + '/dashboard/', { waitUntil: 'domcontentloaded' })
    await expect(page.getByRole('status').filter({ hasText: 'Данные обзора загружены' })).toBeVisible({ timeout: 30000 })
    await Promise.all(reads)
    expect(pages.length).toBeGreaterThan(1)
    expect(pages.reduce((total, current) => total + current.rows, 0)).toBe(pages[0].count)
    expect(pages.at(-1)?.next).toBeNull()
    expect(calls.every(url => new URL(url).origin === app)).toBeTruthy()
    await expect(page.getByText(/Не удалось загрузить штатное расписание/)).toHaveCount(0)
    await expect(page.getByText('Система работает стабильно', { exact: true })).toHaveCount(0)
  })

  for (const hierarchyPath of ['/api/staff_unit/statistics/', '/api/divisions/divisions_tree/']) {
  test(`failed hierarchy ${hierarchyPath} is reported and retry reloads hierarchy and staff`, async ({ page }) => {
    let hierarchyReads = 0
    await page.route(`**${hierarchyPath}**`, route => {
      hierarchyReads++
      return route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ detail: 'Controlled hierarchy outage' }) })
    })
    await signIn(page, APP)
    // A quick hierarchy failure can precede the last staff page. Let the
    // existing request finish before testing a fresh read on retry.
    const initialStaff = page.waitForResponse(async response =>
      new URL(response.url()).pathname === '/api/staff_unit/staff-units/'
      && response.status() === 200 && (await response.json()).next === null)
    await page.goto(APP + '/dashboard/', { waitUntil: 'domcontentloaded' })
    await expect(page.getByRole('alert').filter({ hasText: 'Не удалось загрузить иерархию подразделений.' })).toBeVisible({ timeout: 30000 })
    await expect(page.getByRole('status').filter({ hasText: 'Часть данных не загружена' })).toBeVisible()
    expect(hierarchyReads).toBeGreaterThan(0)
    await initialStaff
    await expect(page.getByText('Система работает стабильно', { exact: true })).toHaveCount(0)
    await page.unroute(`**${hierarchyPath}**`)
    const hierarchy = page.waitForResponse(response => response.url().includes(hierarchyPath) && response.status() === 200)
    const staff = page.waitForResponse(response => new URL(response.url()).pathname === '/api/staff_unit/staff-units/' && !new URL(response.url()).searchParams.has('page') && response.status() === 200)
    await page.getByRole('button', { name: 'Попробовать снова', exact: true }).click()
    await Promise.all([hierarchy, staff])
    await expect(page.getByRole('status').filter({ hasText: 'Данные обзора загружены' })).toBeVisible({ timeout: 30000 })
  })
  }
})
