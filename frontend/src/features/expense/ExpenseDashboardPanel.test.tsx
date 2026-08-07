// @vitest-environment jsdom
// Story 20.2c: изолированный тест дашборд-панели — прямой рендер с явной
// businessDate, per-test MSW, образец ExpenseJournalPanel/ReadinessPanel.
import '@testing-library/jest-dom/vitest'
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { server } from '../../shared/api/testing/server'
import { ExpenseDashboardPanel } from './ExpenseDashboardPanel'

afterEach(cleanup)

function renderPanel(businessDate = '2026-07-08') {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  return render(
    <QueryClientProvider client={queryClient}>
      <ExpenseDashboardPanel businessDate={businessDate} />
    </QueryClientProvider>,
  )
}

function dashboardResponse(overrides: Record<string, unknown> = {}) {
  return {
    business_date: '2026-07-08',
    expense: {
      business_date: '2026-07-08',
      rows: [
        {
          division_id: '11111111-1111-1111-1111-111111111111',
          name: 'Отдел А',
          staff_total: 10,
          list_total: 8,
          vacancies: 2,
          attached: 0,
          columns: {},
        },
      ],
      totals: { staff_total: 10, list_total: 8, vacancies: 2, attached: 0 },
      violations: [],
      warnings: [],
    },
    laggards: [],
    blocked: false,
    overridden: false,
    ...overrides,
  }
}

describe('ExpenseDashboardPanel', () => {
  it('renders totals and the division row table', async () => {
    server.use(
      http.get('*/api/operations/expense-reports/dashboard/', () =>
        HttpResponse.json(dashboardResponse()),
      ),
    )

    renderPanel()

    await waitFor(() => expect(screen.getByText('Отдел А')).toBeInTheDocument())
    expect(screen.getByText('Все управления сдали')).toBeInTheDocument()
  })

  it('renders laggard names, not raw UUIDs', async () => {
    server.use(
      http.get('*/api/operations/expense-reports/dashboard/', () =>
        HttpResponse.json(
          dashboardResponse({
            laggards: [
              {
                division_id: '22222222-2222-2222-2222-222222222222',
                name: 'Отдел Б',
              },
            ],
            blocked: true,
          }),
        ),
      ),
    )

    renderPanel()

    await waitFor(() => expect(screen.getByText('Отдел Б')).toBeInTheDocument())
    expect(screen.queryByText('22222222-2222-2222-2222-222222222222')).not.toBeInTheDocument()
  })

  it('shows a loading placeholder while the request is pending', () => {
    server.use(
      http.get(
        '*/api/operations/expense-reports/dashboard/',
        () => new Promise(() => {}),
      ),
    )

    renderPanel()

    expect(screen.getByText('Загрузка дашборда…')).toBeInTheDocument()
  })

  it('shows an honest error message on a 422 and does not crash', async () => {
    server.use(
      http.get('*/api/operations/expense-reports/dashboard/', () =>
        HttpResponse.json(
          {
            error_code: 'REPORT_NO_DATA_FOR_DATE',
            message: 'Нет данных за эту дату.',
            details: {},
            request_id: null,
            timestamp: new Date().toISOString(),
          },
          { status: 422 },
        ),
      ),
    )

    renderPanel()

    await waitFor(() =>
      expect(
        screen.getByText(/Не удалось загрузить дашборд расхода/),
      ).toBeInTheDocument(),
    )
  })

  it('degrades silently on a 500 — no crash, no error text (AC-6)', async () => {
    server.use(
      http.get('*/api/operations/expense-reports/dashboard/', () =>
        HttpResponse.json({ error_code: 'INTERNAL', message: 'boom' }, { status: 500 }),
      ),
    )

    renderPanel()

    await waitFor(() => expect(screen.queryByRole('status')).not.toBeInTheDocument())
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(screen.getByText('Дашборд расхода')).toBeInTheDocument()
  })

  it('refetches when businessDate prop changes', async () => {
    const seenDates: string[] = []
    server.use(
      http.get('*/api/operations/expense-reports/dashboard/', ({ request }) => {
        const url = new URL(request.url)
        seenDates.push(url.searchParams.get('business_date') ?? '')
        return HttpResponse.json(dashboardResponse())
      }),
    )

    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    })
    const { rerender } = render(
      <QueryClientProvider client={queryClient}>
        <ExpenseDashboardPanel businessDate="2026-07-08" />
      </QueryClientProvider>,
    )
    await waitFor(() => expect(seenDates).toContain('2026-07-08'))

    rerender(
      <QueryClientProvider client={queryClient}>
        <ExpenseDashboardPanel businessDate="2026-07-09" />
      </QueryClientProvider>,
    )

    await waitFor(() => expect(seenDates).toContain('2026-07-09'))
  })
})
