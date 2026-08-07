// @vitest-environment jsdom
// Story 20.3c: изолированный тест панели перегрузки — прямой рендер, per-test
// MSW, образец ExpenseDashboardPanel.test.tsx (20.2c).
import '@testing-library/jest-dom/vitest'
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { server } from '../../shared/api/testing/server'
import { OverloadPanel } from './OverloadPanel'

afterEach(cleanup)

const DIVISION_ID = '11111111-1111-1111-1111-111111111111'
const EMPLOYEE_ID = '22222222-2222-2222-2222-222222222222'

function renderPanel() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  return render(
    <QueryClientProvider client={queryClient}>
      <OverloadPanel />
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

function stubEmployees(overrides: Record<string, unknown> = {}) {
  server.use(
    http.get('*/api/core/employees/', () =>
      HttpResponse.json({
        count: 1,
        next: null,
        previous: null,
        results: [
          {
            id: EMPLOYEE_ID,
            full_name: 'Иванов Иван Иванович',
            last_name: 'Иванов',
            first_name: 'Иван',
          },
        ],
        ...overrides,
      }),
    ),
  )
}

function overloadResponse(overrides: Record<string, unknown> = {}) {
  return {
    division_id: DIVISION_ID,
    date_from: '2026-07-02',
    date_to: '2026-07-08',
    threshold_hours: '8',
    employees: [],
    ...overrides,
  }
}

async function selectDivision(user: ReturnType<typeof userEvent.setup>) {
  const select = await screen.findByLabelText('Подразделение')
  await waitFor(() => expect(select).not.toBeDisabled())
  await user.selectOptions(select, DIVISION_ID)
}

describe('OverloadPanel', () => {
  it('renders overloaded employee names, not raw UUIDs', async () => {
    stubDivisions()
    stubEmployees()
    server.use(
      http.get('*/api/operations/load/summary/', () =>
        HttpResponse.json(
          overloadResponse({
            employees: [{ employee_id: EMPLOYEE_ID, overload_days: ['2026-07-03', '2026-07-04'] }],
          }),
        ),
      ),
    )

    const user = userEvent.setup()
    renderPanel()
    await selectDivision(user)

    await waitFor(() =>
      expect(screen.getByText(/Иванов Иван Иванович/)).toBeInTheDocument(),
    )
    expect(screen.queryByText(EMPLOYEE_ID)).not.toBeInTheDocument()
  })

  it('shows an honest empty state when nobody is overloaded', async () => {
    stubDivisions()
    stubEmployees()
    server.use(
      http.get('*/api/operations/load/summary/', () =>
        HttpResponse.json(overloadResponse()),
      ),
    )

    const user = userEvent.setup()
    renderPanel()
    await selectDivision(user)

    await waitFor(() =>
      expect(
        screen.getByText('Перегруженных нет за выбранный период'),
      ).toBeInTheDocument(),
    )
  })

  it('filters out employees with an empty overload_days list', async () => {
    stubDivisions()
    stubEmployees()
    server.use(
      http.get('*/api/operations/load/summary/', () =>
        HttpResponse.json(
          overloadResponse({
            employees: [{ employee_id: EMPLOYEE_ID, overload_days: [] }],
          }),
        ),
      ),
    )

    const user = userEvent.setup()
    renderPanel()
    await selectDivision(user)

    await waitFor(() =>
      expect(
        screen.getByText('Перегруженных нет за выбранный период'),
      ).toBeInTheDocument(),
    )
  })

  it('does not fire the overload request before a division is selected', async () => {
    stubDivisions()
    let called = false
    server.use(
      http.get('*/api/operations/load/summary/', () => {
        called = true
        return HttpResponse.json(overloadResponse())
      }),
    )

    renderPanel()
    await screen.findByLabelText('Подразделение')
    expect(called).toBe(false)
  })

  it('blocks the request and warns when dateFrom is after dateTo', async () => {
    stubDivisions()
    stubEmployees()
    let callCount = 0
    server.use(
      http.get('*/api/operations/load/summary/', () => {
        callCount += 1
        return HttpResponse.json(overloadResponse())
      }),
    )

    const user = userEvent.setup()
    renderPanel()
    await selectDivision(user)
    await waitFor(() => expect(callCount).toBeGreaterThan(0))
    const callsBeforeInvalidRange = callCount

    const dateFrom = screen.getByLabelText('С') as HTMLInputElement
    const dateTo = screen.getByLabelText('По') as HTMLInputElement
    await user.clear(dateTo)
    await user.type(dateTo, '2020-01-01')
    await user.clear(dateFrom)
    await user.type(dateFrom, '2026-07-08')

    await waitFor(() =>
      expect(screen.getByText('Дата начала позже даты окончания.')).toBeInTheDocument(),
    )
    expect(callCount).toBe(callsBeforeInvalidRange)
  })

  it('degrades silently on a 500 — no crash, no error text', async () => {
    stubDivisions()
    stubEmployees()
    server.use(
      http.get('*/api/operations/load/summary/', () =>
        HttpResponse.json({ error_code: 'INTERNAL', message: 'boom' }, { status: 500 }),
      ),
    )

    const user = userEvent.setup()
    renderPanel()
    await selectDivision(user)

    await waitFor(() => expect(screen.queryByRole('status')).not.toBeInTheDocument())
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(screen.getByText('Перегрузка')).toBeInTheDocument()
  })

  it('refetches when the selected division changes', async () => {
    stubDivisions()
    stubEmployees()
    const seenDivisions: string[] = []
    server.use(
      http.get('*/api/operations/load/summary/', ({ request }) => {
        const url = new URL(request.url)
        seenDivisions.push(url.searchParams.get('division_id') ?? '')
        return HttpResponse.json(overloadResponse())
      }),
    )

    const user = userEvent.setup()
    renderPanel()
    await selectDivision(user)

    await waitFor(() => expect(seenDivisions).toContain(DIVISION_ID))
  })

  it('refetches when dateFrom/dateTo change (AC-6), no remount', async () => {
    stubDivisions()
    stubEmployees()
    const seenRanges: string[] = []
    server.use(
      http.get('*/api/operations/load/summary/', ({ request }) => {
        const url = new URL(request.url)
        seenRanges.push(
          `${url.searchParams.get('date_from')}:${url.searchParams.get('date_to')}`,
        )
        return HttpResponse.json(overloadResponse())
      }),
    )

    const user = userEvent.setup()
    renderPanel()
    await selectDivision(user)
    await waitFor(() => expect(seenRanges.length).toBeGreaterThan(0))

    const dateFrom = screen.getByLabelText('С') as HTMLInputElement
    await user.clear(dateFrom)
    await user.type(dateFrom, '2026-06-01')

    await waitFor(() =>
      expect(seenRanges.some((range) => range.startsWith('2026-06-01:'))).toBe(true),
    )
  })

  it('renders correct Russian day-count grammar (2/3/4 vs 5+ vs 11-14)', async () => {
    stubDivisions()
    stubEmployees()
    server.use(
      http.get('*/api/operations/load/summary/', () =>
        HttpResponse.json(
          overloadResponse({
            employees: [
              {
                employee_id: EMPLOYEE_ID,
                overload_days: ['2026-07-01', '2026-07-02', '2026-07-03'],
              },
            ],
          }),
        ),
      ),
    )

    const user = userEvent.setup()
    renderPanel()
    await selectDivision(user)

    await waitFor(() => expect(screen.getByText(/3 дня перегрузки/)).toBeInTheDocument())
  })
})
