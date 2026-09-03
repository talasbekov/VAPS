/**
 * Оценки сотрудников на этапе «Проведение» (`[ЗАК-02]`/`[ЗАК-05]`, Plane №433)
 * на ЖИВОМ стенде.
 *
 * Фикстура — ОМ на «Проведении» с незакрытым объектом и назначениями.
 * Оценки на фикстуре снимаются до и после пробы (повторный клик — снять),
 * чтобы прогон не оставлял фикстуру «оценённой» и не ломал следующий.
 * Закрытие объекта проба НЕ выполняет — только открывает подтверждение и
 * проверяет текст «Оценено K из N, инцидентов N» и «без оценки. Закрыть?».
 */
import { expect, test, type Page } from '@playwright/test'
import { requireFixture } from './fixtures'
import { STAND_PASSWORD, STAND_USERNAME } from './stand-credentials'

const LIVE = process.env.SMOKE_LIVE === '1'
const APP = process.env.SMOKE_APP ?? 'http://localhost:3106'
const API = process.env.SMOKE_API ?? 'http://127.0.0.1:8100'

interface Summary {
  rows: { assignmentId: string | null; score: number | null; replaced: boolean }[]
  evaluated: number
  total: number
  incidents: number
}

async function apiToken(): Promise<string> {
  const res = await fetch(`${API}/api/token/`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username: STAND_USERNAME, password: STAND_PASSWORD }),
  })
  const body = (await res.json()) as { access?: string }
  if (body.access === undefined) throw new Error('нет токена стенда')
  return body.access
}

async function signIn(page: Page): Promise<void> {
  const api = page.context().request
  const csrf = (await (await api.get(`${APP}/api/auth/csrf/`)).json()) as { csrfToken: string }
  await api.post(`${APP}/api/auth/callback/credentials/`, {
    form: { csrfToken: csrf.csrfToken, username: STAND_USERNAME, password: STAND_PASSWORD, json: 'true' },
  })
}

test.describe(LIVE ? 'оценки на этапе проведения' : 'оценки на этапе проведения (скип: нет SMOKE_LIVE=1)', () => {
  test.skip(!LIVE, 'нужен живой стек: SMOKE_LIVE=1')

  test('клик ставит и снимает, «Всем 10» добивает, закрытие называет K из N', async ({ page }) => {
    const token = await apiToken()
    const headers = { Authorization: `Bearer ${token}`, 'content-type': 'application/json' }
    const call = async (method: string, path: string, body?: unknown) =>
      (await fetch(`${API}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) })).json()

    const registry = (await call('GET', '/api/ops/security-events/?page_size=50&stage=CONDUCT')) as {
      results: { id: string; placementAssignments: unknown[]; visitObjects: { id: string; stage: string }[] }[]
    }
    const target = requireFixture(
      registry.results.find(
        (e) => e.placementAssignments.length > 0 && e.visitObjects.some((v) => v.stage !== 'CLOSED'),
      ),
      'ОМ на «Проведении» с назначениями и незакрытым объектом',
    )
    const visit = target.visitObjects.find((v) => v.stage !== 'CLOSED')!
    const base = `/api/ops/security-events/${target.id}/visit-objects/${visit.id}/evaluations/`
    const clear = async () => {
      const summary = (await call('GET', base)) as Summary
      for (const row of summary.rows) {
        if (row.score !== null && row.assignmentId !== null) {
          await call('POST', base, { assignmentId: row.assignmentId, score: null })
        }
      }
    }
    await clear()
    const initial = (await call('GET', base)) as Summary
    expect(initial.total, 'у объекта нет назначений — оценивать некого').toBeGreaterThan(0)

    await signIn(page)
    await page.goto(`${APP}/security-ops/events/${target.id}/`)
    const panel = page.locator('[data-slot="evaluation-panel"]')
    await expect(panel).toBeVisible({ timeout: 15_000 })
    const progress = panel.locator('[data-slot="evaluation-progress"]')
    await expect(progress).toHaveText(`Оценено 0 из ${initial.total}`)

    const firstRow = panel.locator('[data-slot="evaluation-row"]').first()
    const seven = firstRow.getByRole('button', { name: '7', exact: true })
    await seven.click()
    await expect(seven).toHaveAttribute('aria-pressed', 'true')
    await expect(progress).toHaveText(`Оценено 1 из ${initial.total}`)
    // Сервер — источник: оценка попала в модель рейтинга.
    const afterOne = (await call('GET', base)) as Summary
    expect(afterOne.evaluated).toBe(1)

    // Низкая оценка — подсказка, не блокировка.
    const three = firstRow.getByRole('button', { name: '3', exact: true })
    await three.click()
    await expect(firstRow.locator('[data-slot="low-score-hint"]')).toContainText('желательно пояснить')

    // Повторный клик — снять.
    await three.click()
    await expect(three).toHaveAttribute('aria-pressed', 'false')
    await expect(progress).toHaveText(`Оценено 0 из ${initial.total}`)

    // Подтверждение закрытия называет K из N и предупреждает про неоценённых.
    await page.getByRole('button', { name: 'Закрыть объект' }).click()
    const dialog = page.getByRole('dialog')
    await expect(dialog.locator('[data-slot="close-summary"]')).toContainText(
      `Оценено 0 из ${initial.total}, инцидентов ${initial.incidents}`,
    )
    await expect(dialog.locator('[data-slot="close-unrated"]')).toContainText('без оценки. Закрыть?')
    await dialog.getByRole('button', { name: 'Отмена' }).click()
    await expect(dialog).toBeHidden()

    // «Всем 10» — всем неоценённым.
    await panel.getByRole('button', { name: 'Всем 10' }).click()
    await expect(progress).toHaveText(`Оценено ${initial.total} из ${initial.total}`)
    const all = (await call('GET', base)) as Summary
    expect(all.rows.filter((r) => !r.replaced).every((r) => r.score === 10)).toBe(true)

    await clear()
    const cleaned = (await call('GET', base)) as Summary
    expect(cleaned.evaluated).toBe(0)
  })
})
