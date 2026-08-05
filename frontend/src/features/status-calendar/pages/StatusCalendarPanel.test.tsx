// @vitest-environment jsdom
// Story 19.4d: StatusCalendarPanel — isolated component test, MSW per-test
// handlers (образец placement/api/queries.test.tsx's wrapper).
import '@testing-library/jest-dom/vitest'
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { server } from '../../../shared/api/testing/server'
import { StatusCalendarPanel } from './StatusCalendarPanel'

afterEach(cleanup)

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  }
}

describe('StatusCalendarPanel', () => {
  it('shows a loading placeholder before data arrives', async () => {
    server.use(
      http.get(
        '*/api/operations/statuses/calendar/',
        () => new Promise((resolve) => setTimeout(() => resolve(HttpResponse.json({})), 20)),
      ),
    )
    const Wrapper = createWrapper()
    render(<StatusCalendarPanel divisionId="d1" employeeId="e1" />, { wrapper: Wrapper })

    expect(screen.getByText('Загрузка календаря…')).toBeInTheDocument()
    await waitFor(() => expect(screen.queryByText('Загрузка календаря…')).not.toBeInTheDocument())
  })

  it('renders day cells with status codes on success', async () => {
    const today = new Date()
    const iso = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-01`
    server.use(
      http.get('*/api/operations/statuses/calendar/', () =>
        HttpResponse.json({ [iso]: 'VACATION' }),
      ),
    )
    const Wrapper = createWrapper()
    render(<StatusCalendarPanel divisionId="d1" employeeId="e1" />, { wrapper: Wrapper })

    await waitFor(() => expect(screen.getByText('VACATION')).toBeInTheDocument())
  })

  it('shows an error message on failure without throwing', async () => {
    server.use(
      http.get('*/api/operations/statuses/calendar/', () =>
        HttpResponse.json(
          {
            error_code: 'PERMISSION_DENIED',
            message: 'Нет права.',
            details: {},
            request_id: null,
            timestamp: new Date().toISOString(),
          },
          { status: 403 },
        ),
      ),
    )
    const Wrapper = createWrapper()
    render(<StatusCalendarPanel divisionId="d1" employeeId="e1" />, { wrapper: Wrapper })

    await waitFor(() =>
      expect(screen.getByText(/Не удалось загрузить календарь/)).toBeInTheDocument(),
    )
  })

  it('navigating to the previous month changes the header label', async () => {
    let lastMonthParam: string | null = null
    server.use(
      http.get('*/api/operations/statuses/calendar/', ({ request }) => {
        lastMonthParam = new URL(request.url).searchParams.get('month')
        return HttpResponse.json({})
      }),
    )
    const Wrapper = createWrapper()
    render(<StatusCalendarPanel divisionId="d1" employeeId="e1" />, { wrapper: Wrapper })

    await waitFor(() => expect(lastMonthParam).not.toBeNull())
    const initialMonth = lastMonthParam

    await userEvent.click(screen.getByLabelText('Предыдущий месяц'))

    await waitFor(() => expect(lastMonthParam).not.toBe(initialMonth))
  })

  it('crosses the year boundary going from January to December of the previous year', async () => {
    let lastQuery: { year: string | null; month: string | null } = { year: null, month: null }
    server.use(
      http.get('*/api/operations/statuses/calendar/', ({ request }) => {
        const url = new URL(request.url)
        lastQuery = { year: url.searchParams.get('year'), month: url.searchParams.get('month') }
        return HttpResponse.json({})
      }),
    )
    const Wrapper = createWrapper()
    render(
      <StatusCalendarPanel divisionId="d1" employeeId="e1" initialYear={2026} initialMonth={1} />,
      { wrapper: Wrapper },
    )

    await waitFor(() => expect(lastQuery).toEqual({ year: '2026', month: '1' }))

    await userEvent.click(screen.getByLabelText('Предыдущий месяц'))

    await waitFor(() => expect(lastQuery).toEqual({ year: '2025', month: '12' }))
  })

  it('crosses the year boundary going from December to January of the next year', async () => {
    let lastQuery: { year: string | null; month: string | null } = { year: null, month: null }
    server.use(
      http.get('*/api/operations/statuses/calendar/', ({ request }) => {
        const url = new URL(request.url)
        lastQuery = { year: url.searchParams.get('year'), month: url.searchParams.get('month') }
        return HttpResponse.json({})
      }),
    )
    const Wrapper = createWrapper()
    render(
      <StatusCalendarPanel divisionId="d1" employeeId="e1" initialYear={2026} initialMonth={12} />,
      { wrapper: Wrapper },
    )

    await waitFor(() => expect(lastQuery).toEqual({ year: '2026', month: '12' }))

    await userEvent.click(screen.getByLabelText('Следующий месяц'))

    await waitFor(() => expect(lastQuery).toEqual({ year: '2027', month: '1' }))
  })

  it('renders 29 day cells for a leap-year February', async () => {
    server.use(http.get('*/api/operations/statuses/calendar/', () => HttpResponse.json({})))
    const Wrapper = createWrapper()
    render(
      <StatusCalendarPanel divisionId="d1" employeeId="e1" initialYear={2024} initialMonth={2} />,
      { wrapper: Wrapper },
    )

    await waitFor(() => expect(screen.getByText('29')).toBeInTheDocument())
    expect(screen.queryByText('30')).not.toBeInTheDocument()
  })

  it('renders 28 day cells for a non-leap-year February', async () => {
    server.use(http.get('*/api/operations/statuses/calendar/', () => HttpResponse.json({})))
    const Wrapper = createWrapper()
    render(
      <StatusCalendarPanel divisionId="d1" employeeId="e1" initialYear={2026} initialMonth={2} />,
      { wrapper: Wrapper },
    )

    await waitFor(() => expect(screen.getByText('28')).toBeInTheDocument())
    expect(screen.queryByText('29')).not.toBeInTheDocument()
  })
})
