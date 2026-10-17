import { expect, test } from '@playwright/test'
import { STAND_PASSWORD, STAND_USERNAME } from './stand-credentials'
import { requireFixture } from './fixtures'

const APP = process.env.SMOKE_APP ?? 'http://localhost:3106'
const API = process.env.SMOKE_API ?? 'http://127.0.0.1:8100'

test.describe('Ознакомление: область личного подтверждения', () => {
  test.skip(process.env.SMOKE_LIVE !== '1', 'Нужен проверочный стенд')
  for (const scenario of ['foreign', 'own-without-status-manage', 'revoked', 'linked', 'removed'] as const) {
    test(scenario, async ({ page }) => {
      await page.clock.install()
      const auth = await fetch(`${API}/api/token/`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ username: STAND_USERNAME, password: STAND_PASSWORD }),
      })
      expect(auth.ok).toBeTruthy()
      const { access } = await auth.json()
      const response = await fetch(`${API}/api/ops/security-events/?stage=CONDUCT&page_size=50`, {
        headers: { Authorization: `Bearer ${access}` },
      })
      expect(response.ok).toBeTruthy()
      const registry = await response.json() as { results: import('@/entities/security-event').SecurityEvent[] }
      const event = requireFixture(registry.results.find(row => row.placementAssignments.length > 0), 'Назначение')
      const assignment = event.placementAssignments[0]
      let allowed = scenario !== 'foreign'
      let linked = false
      let exists = true
      let detailReads = 0
      let writes = 0
      await page.route(url => url.pathname === '/api/operations/my-permissions/', route => route.fulfill({
        json: { permissions: ['event.view', ...(scenario === 'own-without-status-manage' ? [] : ['status.manage'])], roles: [] },
      }))
      await page.route(url => url.pathname === `/api/ops/security-events/${event.id}/`, route => {
        detailReads++
        return route.fulfill({ json: { ...event, stage: 'ACKNOWLEDGEMENT',
          visitObjects: event.visitObjects.map(row => ({ ...row, stage: 'ACKNOWLEDGEMENT' })),
          placementAssignments: exists ? [{ ...assignment, employeeHasAccount: linked,
            canConfirmWithoutAccount: allowed, acknowledgedAt: null, declinedAt: null }] : [],
        } })
      })
      await page.route(url => url.pathname.includes(`/security-events/${event.id}/acknowledge/`), route => {
        writes++
        return route.fulfill({ status: 403, json: { detail: 'Тест: запись запрещена' } })
      })
      const csrf = await (await page.request.get(`${APP}/api/auth/csrf/`)).json()
      await page.request.post(`${APP}/api/auth/callback/credentials/`, { form: {
        csrfToken: csrf.csrfToken, username: STAND_USERNAME, password: STAND_PASSWORD, json: 'true',
      } })
      await page.goto(`${APP}/security-ops/events/${event.id}/`)
      const button = page.getByTestId(`ack-row-${assignment.id}`).getByRole('button', { name: 'Подтвердить без учётки' })
      if (scenario === 'foreign') {
        await expect(button).toBeDisabled()
      } else {
        await expect(button).toBeEnabled()
        await button.click()
        const dialog = page.getByRole('dialog', { name: 'Подтвердить ознакомление', exact: true })
        await dialog.getByLabel('Способ доведения *').fill('Лично')
        await dialog.getByLabel('Основание отсутствия учётной записи *').fill('Учётная запись не создана')
        const submit = dialog.getByRole('button', { name: 'Подтвердить ознакомление', exact: true })
        await expect(submit).toBeEnabled()
        if (['revoked', 'linked', 'removed'].includes(scenario)) {
          const before = detailReads
          if (scenario === 'revoked') allowed = false
          if (scenario === 'linked') linked = true
          if (scenario === 'removed') exists = false
          await page.clock.fastForward(6 * 60_000)
          await page.evaluate(() => {
            window.dispatchEvent(new Event('offline'))
            window.dispatchEvent(new Event('online'))
          })
          await expect.poll(() => detailReads).toBeGreaterThan(before)
          await expect(submit).toBeDisabled()
        }
        await dialog.getByRole('button', { name: 'Отмена', exact: true }).click()
      }
      expect(writes).toBe(0)
    })
  }

  for (const allowed of [false, true]) {
    test(`профиль: область начальника ${allowed ? 'своя' : 'чужая'}`, async ({ page }) => {
      await page.clock.install()
      let capability = allowed
      let reads = 0
      await page.route(url => url.pathname === '/api/operations/my-permissions/', route => route.fulfill({
        json: { permissions: ['event.view', 'personnel.view', 'status.manage'],
          roles: [{ code: 'DIRECTORATE_HEAD', scopeDivisionId: '3' }] },
      }))
      await page.route(url => url.pathname === '/api/ops/security-events/my-assignments/', route => {
        reads++
        return route.fulfill({ json: { employeeId: '120', unlinkedReason: null, results: [{
          assignmentId: 'capability-profile-probe', eventId: '57', eventCode: 'ОМ-ПРАВА-ПРОБА',
          eventTitle: 'Проверка области', eventStage: 'ACKNOWLEDGEMENT', businessDate: '2026-10-11',
          businessDateEnd: null, objectName: 'Объект', visitObjectId: '41', visitObjectName: 'Объект',
          postId: 'post-probe', postFound: true, sector: 'Сектор', post: 'Пост', task: 'Задача',
          requirements: '', uniform: '', weapon: '', roleCode: null, sectionCode: null,
          employeeHasAccount: false, canConfirmWithoutAccount: capability,
          acknowledgedAt: null, declinedAt: null, declineReason: null,
        }] } })
      })
      const csrf = await (await page.request.get(`${APP}/api/auth/csrf/`)).json()
      await page.request.post(`${APP}/api/auth/callback/credentials/`, { form: {
        csrfToken: csrf.csrfToken, username: STAND_USERNAME, password: STAND_PASSWORD, json: 'true',
      } })
      await page.goto(`${APP}/security-ops/profile/120/`)
      const row = page.getByRole('listitem').filter({ hasText: 'ОМ-ПРАВА-ПРОБА' })
      await expect(row).toBeVisible()
      const button = row.getByRole('button', { name: 'Ознакомлен лично', exact: true })
      if (!allowed) {
        await expect(button).toHaveCount(0)
        await expect(page.locator('[data-slot="read-only"]')).toHaveText('Только чтение')
        return
      }
      await expect(page.locator('[data-slot="personal-acknowledgement"]')).toHaveText('Ознакомление подчинённого')
      await button.click()
      const dialog = page.getByRole('dialog', { name: 'Подтвердить ознакомление лично' })
      await dialog.getByLabel('Способ доведения *').fill('Устно')
      await dialog.getByLabel('Основание отсутствия учётной записи *').fill('Учётка не создана')
      const submit = dialog.getByRole('button', { name: 'Подтвердить ознакомление', exact: true })
      await expect(submit).toBeEnabled()
      const before = reads
      capability = false
      await page.clock.fastForward(6 * 60_000)
      await page.evaluate(() => {
        window.dispatchEvent(new Event('offline'))
        window.dispatchEvent(new Event('online'))
      })
      await expect.poll(() => reads).toBeGreaterThan(before)
      await expect(submit).toBeDisabled()
      await dialog.getByRole('button', { name: 'Отмена', exact: true }).click()
    })
  }
})
