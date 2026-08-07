// @vitest-environment jsdom
// Story 20.5c: изолированный тест страницы штатного расписания — прямой
// рендер, per-test MSW, образец OverloadPanel.test.tsx (20.3c).
import '@testing-library/jest-dom/vitest'
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { server } from '../../../shared/api/testing/server'
import { StaffingTablePage } from './StaffingTablePage'

afterEach(cleanup)

const DIVISION_ID = '11111111-1111-1111-1111-111111111111'

function renderPage() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  return render(
    <QueryClientProvider client={queryClient}>
      <StaffingTablePage />
    </QueryClientProvider>,
  )
}

function stubDivisions() {
  server.use(
    http.get('*/api/core/divisions/', () =>
      HttpResponse.json({
        count: 1,
        next: null,
        previous: null,
        results: [{ id: DIVISION_ID, name: 'Отдел А' }],
      }),
    ),
  )
}

function tableResponse(overrides: Record<string, unknown> = {}) {
  return {
    business_date: '2026-07-08',
    count: 0,
    results: [],
    ...overrides,
  }
}

describe('StaffingTablePage', () => {
  it('AC-2: fires without a division selection — whole org by default', async () => {
    stubDivisions()
    let sawDivisionParam = true
    server.use(
      http.get('*/api/core/staffing-table/', ({ request }) => {
        sawDivisionParam = new URL(request.url).searchParams.has('division_id')
        return HttpResponse.json(
          tableResponse({
            results: [
              {
                division_id: DIVISION_ID,
                position_code: 'P1',
                position_name: 'Инспектор',
                allocated: 5,
                filled: 4,
                vacant: 1,
              },
            ],
            count: 1,
          }),
        )
      }),
    )

    renderPage()

    await waitFor(() => expect(screen.getByText('Инспектор')).toBeInTheDocument())
    expect(sawDivisionParam).toBe(false)
    const table = screen.getByTestId('staffing-table-rows')
    expect(within(table).getByText('Отдел А')).toBeInTheDocument()
  })

  it('AC-3: selecting a division narrows results to it', async () => {
    stubDivisions()
    const seenDivisions: string[] = []
    server.use(
      http.get('*/api/core/staffing-table/', ({ request }) => {
        seenDivisions.push(new URL(request.url).searchParams.get('division_id') ?? '')
        return HttpResponse.json(tableResponse())
      }),
    )

    const user = userEvent.setup()
    renderPage()
    const select = await screen.findByLabelText('Подразделение')
    await waitFor(() => expect(select).not.toBeDisabled())
    await user.selectOptions(select, DIVISION_ID)

    await waitFor(() => expect(seenDivisions).toContain(DIVISION_ID))
  })

  it('AC-4: refetches when business date changes, no remount', async () => {
    stubDivisions()
    const seenDates: string[] = []
    server.use(
      http.get('*/api/core/staffing-table/', ({ request }) => {
        seenDates.push(new URL(request.url).searchParams.get('business_date') ?? '')
        return HttpResponse.json(tableResponse())
      }),
    )

    renderPage()
    await waitFor(() => expect(seenDates.length).toBeGreaterThan(0))

    const user = userEvent.setup()
    const dateInput = screen.getByLabelText('Дата') as HTMLInputElement
    await user.clear(dateInput)
    await user.type(dateInput, '2026-06-01')

    await waitFor(() => expect(seenDates).toContain('2026-06-01'))
  })

  it('AC-5: negative vacant is visually marked, not hidden or crashing', async () => {
    stubDivisions()
    server.use(
      http.get('*/api/core/staffing-table/', () =>
        HttpResponse.json(
          tableResponse({
            results: [
              {
                division_id: DIVISION_ID,
                position_code: 'P1',
                position_name: 'Инспектор',
                allocated: 2,
                filled: 5,
                vacant: -3,
              },
            ],
            count: 1,
          }),
        ),
      ),
    )

    renderPage()

    const cell = await screen.findByText('-3')
    expect(cell).toHaveClass('text-destructive')
  })

  it('AC-6: degrades silently on a 500 — no crash, no error text', async () => {
    stubDivisions()
    server.use(
      http.get('*/api/core/staffing-table/', () =>
        HttpResponse.json({ error_code: 'INTERNAL', message: 'boom' }, { status: 500 }),
      ),
    )

    renderPage()

    await waitFor(() => expect(screen.queryByRole('status')).not.toBeInTheDocument())
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(screen.getByText('Штатное расписание')).toBeInTheDocument()
  })

  it('AC-6: shows a visible message on a 422', async () => {
    stubDivisions()
    server.use(
      http.get('*/api/core/staffing-table/', () =>
        HttpResponse.json(
          { error_code: 'VALIDATION_ERROR', message: 'Некорректная дата.' },
          { status: 422 },
        ),
      ),
    )

    renderPage()

    await waitFor(() =>
      expect(screen.getByText(/Не удалось загрузить штатное расписание/)).toBeInTheDocument(),
    )
  })
})
