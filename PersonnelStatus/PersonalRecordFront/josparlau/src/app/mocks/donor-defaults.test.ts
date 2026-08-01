// Донор-дефолты demo-режима (Этап 71): без них незамоканные эндпоинты линии
// PersonnelStatus отвечали 500 «Request Handler Error» (onUnhandledRequest:
// 'error') — вечная загрузка /organization, потоп ретраев колокольчика.
// Handler-уровень (приём Этапа 49): setupServer + реальный apiClient.
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { WebSocketHandler } from 'msw'
import { setupServer } from 'msw/node'
import { createApiClient } from '../../shared/api/client'
import { ApiError } from '../../shared/api/errors'
import { DIVISIONS } from '../../features/personnel/mocks/fixtures'
import { donorDefaultHandlers } from './donor-defaults'

// WS-handlers в env node не поднимаются (WebSocket-перехват — браузерный);
// HTTP-дефолты отделяются так же, как их различает сам MSW — по классу.
const httpOnly = donorDefaultHandlers().filter(
  (handler) => !(handler instanceof WebSocketHandler),
)
const server = setupServer(...(httpOnly as Parameters<typeof setupServer>))

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }))
afterAll(() => server.close())
afterEach(() => server.resetHandlers())

const client = createApiClient({ baseUrl: 'http://localhost' })

async function statusOf(call: () => Promise<unknown>): Promise<number> {
  try {
    await call()
    return 200
  } catch (error) {
    if (error instanceof ApiError) return error.status
    throw error
  }
}

describe('донор-дефолты demo-режима (Этап 71)', () => {
  it('лента уведомлений — пустая страница, а не 500 с ретрай-потопом', async () => {
    const page = await client.get<{ count: number; results: unknown[] }>(
      '/api/notifications/?limit=50',
    )
    expect(page.count).toBe(0)
    expect(page.results).toEqual([])
  })

  it('дерево светофора собрано из ТЕХ ЖЕ подразделений, что /api/core/divisions, со статусом «нет данных»', async () => {
    const tree = await client.get<{
      nodes: { division_id: string; name: string; status: string }[]
    }>('/api/operations/traffic-light/tree/?business_date=2026-07-20')
    expect(tree.nodes.map((node) => node.division_id)).toEqual(DIVISIONS.map((d) => d.id))
    // NEUTRAL — канонический «Нет данных» контракта: demo не ведёт сдачу дня,
    // и красить цвета значило бы выдумать её результат.
    expect(new Set(tree.nodes.map((node) => node.status))).toEqual(new Set(['NEUTRAL']))
  })

  it('сдач дня не было — пустая страница, мутации линии отвечают named-отказом 422', async () => {
    const page = await client.get<{ results: unknown[] }>(
      '/api/operations/daily-submissions/?division_id=division-1',
    )
    expect(page.results).toEqual([])
    expect(await statusOf(() => client.post('/api/operations/daily-submissions/', {}))).toBe(422)
    expect(await statusOf(() => client.post('/api/operations/statuses/bulk/', {}))).toBe(422)
    // Текст отказа называет причину, а не прячется за générique-ошибкой.
    const error = await client
      .post('/api/operations/statuses/bulk/', {})
      .then(
        () => null,
        (e: unknown) => e,
      )
    expect((error as ApiError).message).toContain('backend PersonnelStatus')
    expect((error as ApiError).message).toContain('Данные не изменены')
  })

  it('официальный расход: GET — штатный 404 «не выпущен», POST — named-отказ', async () => {
    expect(
      await statusOf(() => client.get('/api/operations/expense-reports/?business_date=2026-07-20')),
    ).toBe(404)
    expect(await statusOf(() => client.post('/api/operations/expense-reports/', {}))).toBe(422)
  })
})
