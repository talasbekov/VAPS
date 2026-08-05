// @vitest-environment jsdom
// Story 19.4c: contract tests for useEmployeeStatusCalendar — real schema
// types (paths[...]), MSW per-test handlers, образец placement/api/queries.test.tsx.
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, renderHook, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { server } from '../../../shared/api/testing/server'
import { ApiError } from '../../../shared/api/errors'
import { useEmployeeStatusCalendar } from './queries'

afterEach(cleanup)

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  const Wrapper = function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  }
  return { Wrapper }
}

describe('useEmployeeStatusCalendar', () => {
  it('returns the month calendar on the happy path', async () => {
    server.use(
      http.get('*/api/operations/statuses/calendar/', ({ request }) => {
        const url = new URL(request.url)
        expect(url.searchParams.get('division_id')).toBe('d1')
        expect(url.searchParams.get('employee_id')).toBe('e1')
        expect(url.searchParams.get('year')).toBe('2026')
        expect(url.searchParams.get('month')).toBe('8')
        return HttpResponse.json({ '2026-08-01': 'IN_SERVICE', '2026-08-05': 'VACATION' })
      }),
    )
    const { Wrapper } = createWrapper()
    const { result } = renderHook(() => useEmployeeStatusCalendar('d1', 'e1', 2026, 8), {
      wrapper: Wrapper,
    })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))

    expect(result.current.data).toEqual({
      '2026-08-01': 'IN_SERVICE',
      '2026-08-05': 'VACATION',
    })
  })

  it('surfaces a 403 as ApiFailure error', async () => {
    server.use(
      http.get('*/api/operations/statuses/calendar/', () =>
        HttpResponse.json(
          {
            error_code: 'PERMISSION_DENIED',
            message: 'Нет права на это подразделение.',
            details: {},
            request_id: null,
            timestamp: new Date().toISOString(),
          },
          { status: 403 },
        ),
      ),
    )
    const { Wrapper } = createWrapper()
    const { result } = renderHook(() => useEmployeeStatusCalendar('d1', 'e1', 2026, 8), {
      wrapper: Wrapper,
    })

    await waitFor(() => expect(result.current.isError).toBe(true))

    expect(result.current.error).toBeInstanceOf(ApiError)
    expect((result.current.error as ApiError).errorCode).toBe('PERMISSION_DENIED')
  })

  it('does not fetch when divisionId/employeeId are empty', async () => {
    const handler = vi.fn(() => HttpResponse.json({}))
    server.use(http.get('*/api/operations/statuses/calendar/', handler))
    const { Wrapper } = createWrapper()

    const { result } = renderHook(() => useEmployeeStatusCalendar('', '', 2026, 8), {
      wrapper: Wrapper,
    })

    expect(result.current.isPending).toBe(true)
    expect(result.current.fetchStatus).toBe('idle')
    expect(handler).not.toHaveBeenCalled()
  })

  it('refetches when year/month change while divisionId/employeeId stay the same', async () => {
    server.use(
      http.get('*/api/operations/statuses/calendar/', ({ request }) => {
        const url = new URL(request.url)
        return HttpResponse.json({ month: url.searchParams.get('month') })
      }),
    )
    const { Wrapper } = createWrapper()
    const { result, rerender } = renderHook(
      ({ month }: { month: number }) => useEmployeeStatusCalendar('d1', 'e1', 2026, month),
      { wrapper: Wrapper, initialProps: { month: 8 } },
    )

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(result.current.data).toEqual({ month: '8' })

    rerender({ month: 9 })

    await waitFor(() => expect(result.current.data).toEqual({ month: '9' }))
  })
})
