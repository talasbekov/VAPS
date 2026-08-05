// @vitest-environment jsdom
// Story 19.4d review fix: statusCalendarHandlers must fall back to the
// current year/month on missing or malformed query params instead of
// silently producing invalid ISO keys (Number(null)===0 gotcha).
import { afterEach, beforeAll, afterAll, describe, expect, it } from 'vitest'
import { setupServer } from 'msw/node'
import { apiClient } from '../../../shared/api/client'
import { statusCalendarHandlers } from './handlers'

const server = setupServer(...statusCalendarHandlers)

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }))
afterEach(() => server.resetHandlers())
afterAll(() => server.close())

function fetchCalendar(query: string): Promise<Record<string, string>> {
  return apiClient.get<Record<string, string>>(
    `/api/operations/statuses/calendar/?${query}`,
  )
}

describe('statusCalendarHandlers', () => {
  it('returns a dense month for valid year/month', async () => {
    const calendar = await fetchCalendar('division_id=d1&employee_id=e1&year=2026&month=8')
    expect(Object.keys(calendar)).toHaveLength(31)
    expect(calendar['2026-08-01']).toBe('IN_SERVICE')
  })

  it('falls back to the real current month when year/month are missing', async () => {
    const now = new Date()
    const calendar = await fetchCalendar('division_id=d1&employee_id=e1')
    const expectedIso = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`
    expect(calendar[expectedIso]).toBeDefined()
    expect(Object.keys(calendar).every((iso) => !iso.includes('-00-') && !iso.startsWith('0-'))).toBe(
      true,
    )
  })

  it('falls back to the real current month when year/month are non-numeric', async () => {
    const now = new Date()
    const calendar = await fetchCalendar('division_id=d1&employee_id=e1&year=abc&month=xyz')
    const expectedIso = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`
    expect(calendar[expectedIso]).toBeDefined()
  })

  it('falls back when month is out of the 1-12 range', async () => {
    const now = new Date()
    const calendar = await fetchCalendar('division_id=d1&employee_id=e1&year=2026&month=13')
    const expectedIso = `2026-${String(now.getMonth() + 1).padStart(2, '0')}-01`
    expect(Object.keys(calendar).some((iso) => iso.includes('-13-'))).toBe(false)
    expect(calendar[expectedIso]).toBeDefined()
  })
})
