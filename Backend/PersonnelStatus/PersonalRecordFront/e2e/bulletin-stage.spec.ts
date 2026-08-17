/**
 * Этап «Бюллетень» карточки ОМ на ЖИВОМ стенде.
 *
 * Проба отвечает на один вопрос: готовность этапа считается по СОХРАНЁННОМУ
 * бюллетеню, а не по набранному в полях. Разница не косметическая: сервер
 * смотрит на своё состояние, и набранный, но не сохранённый текст этап не
 * откроет — экран, считающий по форме, обещал бы завершение, которого не
 * будет.
 *
 * Фикстуру проба готовит сама (пустое ОМ на «Бюллетене») и доводит до
 * заполненного состояния; этап не завершает — иначе фикстура одноразовая.
 */
import { expect, test, type Page } from '@playwright/test'

const LIVE = process.env.SMOKE_LIVE === '1'
const APP = process.env.SMOKE_APP ?? 'http://localhost:3106'
const API = process.env.SMOKE_API ?? 'http://127.0.0.1:8100'

interface EventRow {
  id: string
  code: string
  stage: string
  briefDescription: string
  initialTasks: string
}

async function apiToken(): Promise<string> {
  const res = await fetch(`${API}/api/token/`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username: 'admin', password: 'admin123' }),
  })
  return ((await res.json()) as { access: string }).access
}

async function events(token: string): Promise<EventRow[]> {
  const res = await fetch(`${API}/api/ops/security-events/?page_size=50`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  return ((await res.json()) as { results: EventRow[] }).results
}

async function signIn(page: Page): Promise<void> {
  const api = page.context().request
  const csrf = (await (await api.get(`${APP}/api/auth/csrf/`)).json()) as { csrfToken: string }
  await api.post(`${APP}/api/auth/callback/credentials/`, {
    form: { csrfToken: csrf.csrfToken, username: 'admin', password: 'admin123', json: 'true' },
  })
}

test.describe(LIVE ? 'бюллетень' : 'бюллетень (скип: нет SMOKE_LIVE=1)', () => {
  test.skip(!LIVE, 'нужен живой стек: SMOKE_LIVE=1')

  test('готовность считается по сохранённому, а не по набранному', async ({ page }) => {
    const token = await apiToken()
    const suitable = (rows: EventRow[]): EventRow | undefined =>
      rows.find(
        (e) =>
          e.stage === 'BULLETIN' &&
          (e.briefDescription.trim() === '' || e.initialTasks.trim() === ''),
      )
    let event = suitable(await events(token))
    if (event === undefined) {
      await prepareEvent(token)
      event = suitable(await events(token))
      expect(event, 'не удалось подготовить фикстуру').toBeDefined()
    }
    const target = event!

    await signIn(page)
    await page.goto(`${APP}/security-ops/events/${target.id}/`)
    const card = page.locator('[data-slot="card"]', {
      has: page.locator('[data-slot="card-title"]', { hasText: 'Бюллетень' }),
    })
    await expect(card).toBeVisible({ timeout: 15_000 })
    await expect(card).toContainText('заполнено не всё')
    await expect(card).toContainText('Краткое описание — не заполнено')

    // Набранное, но НЕ сохранённое готовность не меняет — меняет предупреждение
    await card.getByLabel('Краткое описание *').fill('Проба бюллетеня.')
    await card.getByLabel('Первичные задачи направлениям *').fill('Проба задач.')
    await expect(card).toContainText('Есть несохранённые правки')
    await expect(card).toContainText('заполнено не всё')
    await expect(card).toContainText('Краткое описание — не заполнено')

    // Сохранение переводит этап в «можно завершать», и это видит бэк
    await card.getByRole('button', { name: 'Сохранить бюллетень' }).click()
    await expect(card).toContainText('можно завершать', { timeout: 15_000 })
    await expect(card).toContainText('Краткое описание — сохранено')
    const fresh = (await events(token)).find((e) => e.id === target.id)
    expect(fresh?.briefDescription).toBe('Проба бюллетеня.')
  })
})

/** Заводит пустое ОМ на этапе «Бюллетень». */
async function prepareEvent(token: string): Promise<void> {
  const headers = { Authorization: `Bearer ${token}`, 'content-type': 'application/json' }
  const call = async (method: string, path: string, body?: unknown): Promise<any> => {
    const res = await fetch(`${API}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    })
    return res.json().catch(() => ({}))
  }
  const objects = await call('GET', '/api/ops/security-events/bindable-objects/')
  const object = objects.results.find(
    (item: { publishedVersionCount: number }) => item.publishedVersionCount > 0,
  )
  if (object === undefined) throw new Error('на стенде нет объекта с паспортом')
  await call('POST', '/api/ops/security-events/', {
    title: 'Проба бюллетеня (e2e)',
    objectId: object.id,
    businessDate: '2026-08-25',
  })
}
