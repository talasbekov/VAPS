import { expect, test, type Page } from '@playwright/test'
import { STAND_PASSWORD, STAND_USERNAME } from './stand-credentials'

async function login(page: Page, username: string, password: string) {
  const { csrfToken } = await (await page.request.get('/api/auth/csrf/')).json()
  const response = await page.request.post('/api/auth/callback/credentials/', {
    form: { csrfToken, username, password, json: 'true' },
  })
  expect(response.ok()).toBeTruthy()
  expect((await response.json()).url).not.toContain('error=')
}

test.describe('staffing statistics permissions on actual dashboard', () => {
  test.skip(process.env.SMOKE_LIVE !== '1', 'Requires actual isolated API and reader account')

  test('reader without staffing rights does not request inaccessible statistics', async ({ page }) => {
    const username = process.env.RECON_READER_USER
    const password = process.env.RECON_READER_PASSWORD
    if (!username || !password) throw new Error('Provide the actual event.view-only reader')
    await login(page, username, password)
    const requests: string[] = []
    page.on('request', request => {
      if (request.url().includes('/api/staff_unit/statistics/')) requests.push(request.url())
    })
    const rights = page.waitForResponse(response => response.url().includes('/api/operations/my-permissions/') && response.status() === 200)
    await page.goto('/dashboard/')
    const permissions = (await (await rights).json()).permissions as string[]
    expect(permissions).not.toContain('*')
    expect(permissions).not.toContain('orgstructure.view')
    expect(permissions).not.toContain('status.view')
    await expect(page.getByRole('heading', { name: 'Доступ закрыт' })).toBeVisible()
    expect(requests, 'No inaccessible statistics request while permissions load or after denial').toHaveLength(0)
  })

  test('authorized administrator still loads actual statistics', async ({ page }) => {
    await login(page, STAND_USERNAME, STAND_PASSWORD)
    const response = page.waitForResponse(response => response.url().includes('/api/staff_unit/statistics/'))
    await page.goto('/dashboard/')
    expect((await response).status()).toBe(200)
    await expect(page.getByRole('heading', { name: 'Обзор', exact: true })).toBeVisible()
  })
})
