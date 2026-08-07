// @vitest-environment jsdom
// Story 20.6c: изолированный тест панели сводки по статусам — прямой
// рендер, per-test MSW, образец OverloadPanel.test.tsx (20.3c).
import '@testing-library/jest-dom/vitest'
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { server } from '../../shared/api/testing/server'
import { StatusSummaryPanel } from './StatusSummaryPanel'

afterEach(cleanup)

const DIVISION_ID = '11111111-1111-1111-1111-111111111111'

function renderPanel() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  return render(
    <QueryClientProvider client={queryClient}>
      <StatusSummaryPanel />
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

function summaryResponse(overrides: Record<string, unknown> = {}) {
  return {
    business_date: '2026-07-08',
    division_id: null,
    staff_total: 10,
    list_total: 8,
    vacancies: 2,
    attached: 1,
    columns: {
      SICK: 0,
      VACATION: 1,
      COMMAND: 0,
      TRAINING: 0,
      OTHER: 0,
      DETACHED: 0,
      AFTER_DUTY: 1,
      BEFORE_DUTY: 0,
      ON_DUTY: 2,
      PENDING: 0,
      IN_SERVICE: 4,
    },
    ...overrides,
  }
}

describe('StatusSummaryPanel', () => {
  it('AC-2: fires without a division selection — whole org by default', async () => {
    stubDivisions()
    let sawDivisionParam = true
    server.use(
      http.get('*/api/operations/statuses/summary/', ({ request }) => {
        sawDivisionParam = new URL(request.url).searchParams.has('division_id')
        return HttpResponse.json(summaryResponse())
      }),
    )

    renderPanel()

    await waitFor(() => expect(screen.getByText('10')).toBeInTheDocument())
    expect(sawDivisionParam).toBe(false)
  })

  it('AC-3: selecting a division narrows the query', async () => {
    stubDivisions()
    const seenDivisions: string[] = []
    server.use(
      http.get('*/api/operations/statuses/summary/', ({ request }) => {
        seenDivisions.push(new URL(request.url).searchParams.get('division_id') ?? '')
        return HttpResponse.json(summaryResponse())
      }),
    )

    const user = userEvent.setup()
    renderPanel()
    const select = await screen.findByLabelText('Подразделение')
    await waitFor(() => expect(select).not.toBeDisabled())
    await user.selectOptions(select, DIVISION_ID)

    await waitFor(() => expect(seenDivisions).toContain(DIVISION_ID))
  })

  it('AC-4: refetches when business date changes, no remount', async () => {
    stubDivisions()
    const seenDates: string[] = []
    server.use(
      http.get('*/api/operations/statuses/summary/', ({ request }) => {
        seenDates.push(new URL(request.url).searchParams.get('business_date') ?? '')
        return HttpResponse.json(summaryResponse())
      }),
    )

    renderPanel()
    await waitFor(() => expect(seenDates.length).toBeGreaterThan(0))

    const user = userEvent.setup()
    const dateInput = screen.getByLabelText('Дата') as HTMLInputElement
    await user.clear(dateInput)
    await user.type(dateInput, '2026-06-01')

    await waitFor(() => expect(seenDates).toContain('2026-06-01'))
  })

  it('AC-5: all 11 report columns render with Russian labels, not raw codes', async () => {
    stubDivisions()
    server.use(
      http.get('*/api/operations/statuses/summary/', () =>
        HttpResponse.json(summaryResponse()),
      ),
    )

    renderPanel()

    const table = await screen.findByTestId('status-summary-columns')
    for (const label of [
      'На больничном',
      'В отпуске',
      'В командировке',
      'Учёба/сборы',
      'Иное отсутствие',
      'Откомандирован',
      'После дежурства',
      'Перед дежурством',
      'На дежурстве',
      'Уточняется',
      'В строю',
    ]) {
      expect(table).toHaveTextContent(label)
    }
    expect(screen.queryByText('IN_SERVICE')).not.toBeInTheDocument()
  })

  it('AC-6: degrades silently on a 500 — no crash, no error text', async () => {
    stubDivisions()
    server.use(
      http.get('*/api/operations/statuses/summary/', () =>
        HttpResponse.json({ error_code: 'INTERNAL', message: 'boom' }, { status: 500 }),
      ),
    )

    renderPanel()

    await waitFor(() => expect(screen.queryByRole('status')).not.toBeInTheDocument())
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(screen.getByText('Сводка по статусам')).toBeInTheDocument()
  })

  it('AC-6: shows a visible message on a 422', async () => {
    stubDivisions()
    server.use(
      http.get('*/api/operations/statuses/summary/', () =>
        HttpResponse.json(
          { error_code: 'VALIDATION_ERROR', message: 'Некорректная дата.' },
          { status: 422 },
        ),
      ),
    )

    renderPanel()

    await waitFor(() =>
      expect(
        screen.getByText(/Не удалось загрузить сводку по статусам/),
      ).toBeInTheDocument(),
    )
  })

  it('AC-6: shows a visible message on a 403 (not silenced like 401/5xx)', async () => {
    stubDivisions()
    server.use(
      http.get('*/api/operations/statuses/summary/', () =>
        HttpResponse.json(
          { error_code: 'PERMISSION_DENIED', message: 'Нет права status.view.' },
          { status: 403 },
        ),
      ),
    )

    renderPanel()

    await waitFor(() =>
      expect(
        screen.getByText(/Не удалось загрузить сводку по статусам/),
      ).toBeInTheDocument(),
    )
  })
})
