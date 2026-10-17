import { expect, test } from '@playwright/test'
import { STAND_PASSWORD, STAND_USERNAME } from './stand-credentials'
import { requireFixture } from './fixtures'

const APP = process.env.SMOKE_APP ?? 'http://localhost:3106'
const API = process.env.SMOKE_API ?? 'http://127.0.0.1:8100'

test.describe('Подбор замены без повторного назначения', () => {
  test.skip(process.env.SMOKE_LIVE !== '1', 'Нужен живой проверочный стенд')

  test('уже назначенный сотрудник недоступен в подборе замены', async ({ page }) => {
    const auth = await fetch(`${API}/api/token/`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: STAND_USERNAME, password: STAND_PASSWORD }),
    })
    expect(auth.ok).toBeTruthy()
    const { access } = await auth.json()
    const response = await fetch(`${API}/api/ops/security-events/?page_size=50&stage=CONDUCT`, {
      headers: { Authorization: `Bearer ${access}` },
    })
    const registry = await response.json() as { results: {
      id: string; placementAssignments: { id: string; employeeId: string; employeeName: string }[]
      visitObjects: { stage: string }[]
    }[] }
    const event = requireFixture(registry.results.find(row =>
      row.placementAssignments.length > 0 && row.visitObjects[0]?.stage === 'CONDUCT'),
    'Проведение с назначениями')
    const assigned = event.placementAssignments[0]
    // Fix only the picker dataset: generated names repeat across departments.
    // The production picker still has to disable the row using its employee ID.
    await page.route(url => url.pathname === '/api/ops/personnel/', route => route.fulfill({
      json: { count: 1, next: null, previous: null, results: [{
        id: assigned.employeeId, name: assigned.employeeName,
        fullName: assigned.employeeName, unit: 'Управление проверки',
        unitPath: 'Департамент / Управление проверки', rankLabel: '',
        status: 'AVAILABLE', rating: null,
      }] },
    }))
    const csrf = await (await page.request.get(`${APP}/api/auth/csrf/`)).json()
    await page.request.post(`${APP}/api/auth/callback/credentials/`, { form: {
      csrfToken: csrf.csrfToken, username: STAND_USERNAME, password: STAND_PASSWORD, json: 'true',
    } })
    await page.goto(`${APP}/security-ops/events/${event.id}/`)
    const panel = page.locator('[data-slot="card"]').filter({
      has: page.getByText('Замена выбывшего', { exact: true }),
    })
    await expect(panel).toBeVisible()
    await panel.getByLabel('Кого заменить').selectOption(assigned.id)
    const picker = panel.locator('[data-slot="personnel-picker"]')
    await picker.getByRole('textbox').fill(assigned.employeeName.split(' ')[0])
    const candidate = picker.getByRole('button').filter({ hasText: assigned.employeeName })
    await expect(candidate).toBeVisible()
    await expect(candidate).toBeDisabled()
    await expect(candidate).toContainText('уже назначен')
    await expect(panel.getByRole('button', { name: 'Заменить', exact: true })).toBeDisabled()
  })

  test('отзыв права блокирует подтверждение уже открытого закрытия', async ({ page }) => {
    const auth = await fetch(`${API}/api/token/`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: STAND_USERNAME, password: STAND_PASSWORD }),
    })
    const { access } = await auth.json()
    const response = await fetch(`${API}/api/ops/security-events/?page_size=50&stage=CONDUCT`, {
      headers: { Authorization: `Bearer ${access}` },
    })
    const registry = await response.json() as { results: {
      id: string; visitObjects: { stage: string }[]
    }[] }
    const event = requireFixture(registry.results.find(row => row.visitObjects[0]?.stage === 'CONDUCT'),
      'Незакрытый объект на проведении')
    let canManage = true
    let permissionReads = 0
    await page.route(url => url.pathname === '/api/operations/my-permissions/', route => {
      permissionReads++
      return route.fulfill({ json: {
        permissions: ['event.view', 'personnel.view', ...(canManage ? ['event.manage'] : [])],
        roles: [],
      } })
    })
    const csrf = await (await page.request.get(`${APP}/api/auth/csrf/`)).json()
    await page.request.post(`${APP}/api/auth/callback/credentials/`, { form: {
      csrfToken: csrf.csrfToken, username: STAND_USERNAME, password: STAND_PASSWORD, json: 'true',
    } })
    await page.goto(`${APP}/security-ops/events/${event.id}/`)
    await page.getByRole('button', { name: 'Закрыть объект', exact: true }).click()
    const dialog = page.getByRole('dialog')
    const confirm = dialog.getByRole('button', { name: 'Подтвердить закрытие', exact: true })
    await expect(confirm).toBeEnabled()
    const before = permissionReads
    canManage = false
    await page.evaluate(() => window.dispatchEvent(new Event('visibilitychange')))
    await expect.poll(() => permissionReads).toBeGreaterThan(before)
    await expect(confirm).toBeDisabled()
    await dialog.getByRole('button', { name: 'Отмена', exact: true }).click()
    await expect(dialog).toBeHidden()
  })
})

// The stage payload is isolated in the browser. These tests never submit a
// replacement, completion or permission change to the live API.
test.describe('Ознакомление: безопасность открытых форм', () => {
  test.skip(process.env.SMOKE_LIVE !== '1', 'Нужен живой проверочный стенд')

  for (const scenario of ['duplicate', 'replace-revoked', 'complete-revoked', 'complete-failure'] as const) {
    test(scenario, async ({ page }) => {
      const auth = await fetch(`${API}/api/token/`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ username: STAND_USERNAME, password: STAND_PASSWORD }),
      })
      expect(auth.ok).toBeTruthy()
      const { access } = await auth.json()
      const response = await fetch(`${API}/api/ops/security-events/?page_size=50&stage=CONDUCT`, {
        headers: { Authorization: `Bearer ${access}` },
      })
      expect(response.ok).toBeTruthy()
      const registry = await response.json() as { results: import('@/entities/security-event').SecurityEvent[] }
      const event = requireFixture(registry.results.find(row => row.placementAssignments.length > 0),
        'Мероприятие с назначениями')
      const assigned = event.placementAssignments[0]
      const candidateId = scenario === 'duplicate' ? assigned.employeeId : '999999991'
      let canManage = true
      let reads = 0
      await page.route(url => url.pathname === '/api/operations/my-permissions/', route => {
        reads++
        return route.fulfill({ json: {
          permissions: ['event.view', 'personnel.view', ...(canManage ? ['event.manage'] : [])], roles: [],
        } })
      })
      await page.route(url => url.pathname === '/api/operations/my-employee/', route => route.fulfill({
        json: { employee: null, unlinked_reason: 'Тест без назначенного старшего' },
      }))
      await page.route(url => url.pathname === `/api/ops/security-events/${event.id}/`, route => route.fulfill({
        json: { ...event, stage: 'ACKNOWLEDGEMENT', chiefEmployeeId: null,
          visitObjects: event.visitObjects.map(visit => ({ ...visit, stage: 'ACKNOWLEDGEMENT', chiefEmployeeId: null, deputies: [] })),
          placementAssignments: event.placementAssignments.map(row => ({ ...row,
            acknowledgedAt: null, declinedAt: row.id === assigned.id ? '2026-10-09T12:00:00Z' : null,
            declineReason: row.id === assigned.id ? 'Учебная причина' : null,
          })),
        },
      }))
      await page.route(url => url.pathname === '/api/ops/personnel/', route => route.fulfill({
        json: { count: 1, next: null, previous: null, results: [{
          id: candidateId, name: 'Проверочный Кандидат', fullName: 'Проверочный Кандидат',
          unit: 'Управление', unitPath: 'Департамент / Управление', rankLabel: '', status: 'AVAILABLE', rating: null,
        }] },
      }))
      const csrf = await (await page.request.get(`${APP}/api/auth/csrf/`)).json()
      await page.request.post(`${APP}/api/auth/callback/credentials/`, { form: {
        csrfToken: csrf.csrfToken, username: STAND_USERNAME, password: STAND_PASSWORD, json: 'true',
      } })
      await page.goto(`${APP}/security-ops/events/${event.id}/`)
      if (scenario.startsWith('complete-')) {
        await page.getByRole('button', { name: 'Завершить ознакомление', exact: true }).click()
        const dialog = page.getByRole('dialog')
        await dialog.getByLabel('Комментарий').fill('Учебное основание')
        const confirm = dialog.getByRole('button', { name: 'Завершить без подтверждения всех', exact: true })
        await expect(confirm).toBeEnabled()
        if (scenario === 'complete-failure') {
          await page.route(url => url.pathname === `/api/ops/security-events/${event.id}/acknowledgement/complete/`, route => route.fulfill({
            status: 422, json: { error_code: 'INVALID_STAGE_TRANSITION', message: 'Учебный отказ: состав изменён, проверьте назначения.' },
          }))
          const rejected = page.waitForResponse(res => res.url().includes('/acknowledgement/complete/') && res.status() === 422)
          await confirm.click()
          await rejected
          await expect(dialog.getByRole('alert')).toContainText('Учебный отказ: состав изменён')
          await expect(dialog.getByLabel('Комментарий')).toHaveValue('Учебное основание')
          await dialog.getByRole('button', { name: 'Отмена', exact: true }).click()
          await page.getByRole('button', { name: 'Завершить ознакомление', exact: true }).click()
          await expect(dialog.getByRole('alert')).toHaveCount(0)
          return
        }
        const before = reads
        canManage = false
        await page.evaluate(() => window.dispatchEvent(new Event('visibilitychange')))
        await expect.poll(() => reads).toBeGreaterThan(before)
        await expect(confirm).toBeDisabled()
        await expect(confirm).toHaveAccessibleDescription(/ведущий|старший/)
        return
      }
      await page.getByTestId(`ack-row-${assigned.id}`).getByRole('button', { name: 'Заменить →', exact: true }).click()
      const panel = page.getByTestId('ack-replace')
      await panel.locator('#ack-replace-search').fill('Проверочный')
      const option = panel.locator('[data-slot="personnel-picker"]').getByRole('button').filter({ hasText: 'Проверочный Кандидат' })
      await expect(option).toBeVisible()
      if (scenario === 'duplicate') {
        await expect(option).toBeDisabled()
        await expect(option).toContainText('уже назначен')
      } else {
        await option.click()
        const confirm = panel.getByRole('button', { name: 'Заменить', exact: true })
        await expect(confirm).toBeEnabled()
        const before = reads
        canManage = false
        await page.evaluate(() => window.dispatchEvent(new Event('visibilitychange')))
        await expect.poll(() => reads).toBeGreaterThan(before)
        await expect(confirm).toBeDisabled()
        await expect(confirm).toHaveAccessibleDescription(/замен|прав|старший/i)
      }
    })
  }
})
