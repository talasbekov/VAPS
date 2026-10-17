import { expect, test } from '@playwright/test'
import type { SecurityEvent } from '@/entities/security-event'
import { STAND_PASSWORD, STAND_USERNAME } from './stand-credentials'
import { requireFixture } from './fixtures'

const APP = process.env.SMOKE_APP ?? 'http://localhost:3106'
const API = process.env.SMOKE_API ?? 'http://127.0.0.1:8100'

test.describe('Журнал штаба: сохранность формы', () => {
  test.skip(process.env.SMOKE_LIVE !== '1', 'Нужен живой проверочный стенд')
  for (const scenario of ['failure', 'pending-success', 'read-only'] as const) {
    test(scenario, async ({ page }) => {
      const auth = await fetch(`${API}/api/token/`, { method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ username: STAND_USERNAME, password: STAND_PASSWORD }) })
      expect(auth.ok).toBeTruthy()
      const { access } = await auth.json()
      const response = await fetch(`${API}/api/ops/security-events/?page_size=50&stage=CONDUCT`, {
        headers: { Authorization: `Bearer ${access}` },
      })
      expect(response.ok).toBeTruthy()
      const registry = await response.json() as { results: SecurityEvent[] }
      let event = requireFixture(registry.results[0], 'ОМ на проведении')
      await page.route(url => url.pathname === `/api/ops/security-events/${event.id}/`, route => route.fulfill({ json: event }))
      await page.route(url => url.pathname === '/api/operations/my-permissions/', route => route.fulfill({ json: {
        permissions: ['event.view', ...(scenario === 'read-only' ? [] : ['event.manage'])], roles: [],
      } }))
      const title = 'Инструктаж учебной смены'
      const description = 'Проверить связь перед выходом на пост.'
      let sent = 0
      let release!: () => void
      const pending = new Promise<void>(resolve => { release = resolve })
      await page.route(url => url.pathname === `/api/ops/security-events/${event.id}/journal/`, async route => {
        sent++
        if (scenario === 'pending-success') {
          await pending
          event = { ...event, journalEntries: [...event.journalEntries, {
            id: 'test-journal-entry', type: 'INSTRUCTION', title, description, createdAt: '2026-10-09T17:00:00Z',
          }] }
          await route.fulfill({ json: event })
        } else await route.fulfill({ status: 422, json: {
          error_code: 'INVALID_STAGE_TRANSITION', message: 'Учебный отказ: журнал временно недоступен.',
        } })
      })
      const csrf = await (await page.request.get(`${APP}/api/auth/csrf/`)).json()
      await page.request.post(`${APP}/api/auth/callback/credentials/`, { form: {
        csrfToken: csrf.csrfToken, username: STAND_USERNAME, password: STAND_PASSWORD, json: 'true',
      } })
      await page.goto(`${APP}/security-ops/events/${event.id}/`)
      const panel = page.locator('[data-slot="card"]').filter({ has: page.getByText('Журнал штаба', { exact: true }) })
      const submit = panel.getByRole('button', { name: 'Добавить запись', exact: true })
      if (scenario === 'read-only') {
        await expect(submit).toBeDisabled()
        await expect(submit).toHaveAccessibleDescription(/ведущий|прав|штаб/i)
        expect(sent).toBe(0)
        return
      }
      await panel.getByLabel('Заголовок').fill(title)
      await panel.getByLabel('Описание').fill(description)
      await submit.click()
      if (scenario === 'failure') {
        await expect(panel.getByRole('alert')).toContainText('Учебный отказ')
        await expect(panel.getByLabel('Заголовок')).toHaveValue(title)
        await expect(panel.getByLabel('Описание')).toHaveValue(description)
      } else {
        try {
          await expect.poll(() => sent).toBe(1)
          await expect(panel.getByLabel('Заголовок')).toBeDisabled()
          await expect(panel.getByLabel('Описание')).toBeDisabled()
          await expect(panel.getByLabel('Тип', { exact: true })).toBeDisabled()
          await expect(panel.getByLabel('Заголовок')).toHaveValue(title)
        } finally { release() }
        await expect(panel.getByLabel('Заголовок')).toHaveValue('')
        await expect(panel.getByLabel('Описание')).toHaveValue('')
        await expect(panel.getByText(title, { exact: true })).toBeVisible()
        expect(sent).toBe(1)
      }
    })
  }
})
