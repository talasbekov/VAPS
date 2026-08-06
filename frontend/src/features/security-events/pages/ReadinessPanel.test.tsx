// @vitest-environment jsdom
// Story 20.1d: изолированный тест панели готовности — прямой рендер с явным
// eventId, per-test MSW (не dev:mock), образец
// status-calendar/pages/StatusCalendarPanel.test.tsx.
import '@testing-library/jest-dom/vitest'
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { server } from '../../../shared/api/testing/server'
import { ToastProvider } from '../../../shared/ui/toast'
import { ReadinessPanel } from './ReadinessPanel'

afterEach(cleanup)

function renderWithProviders(children: ReactNode) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  return render(
    <QueryClientProvider client={queryClient}>
      <ToastProvider>{children}</ToastProvider>
    </QueryClientProvider>,
  )
}

describe('ReadinessPanel', () => {
  it('renders the checklist rows and the readiness percentage', async () => {
    server.use(
      http.get('*/api/operations/security-events/42/readiness/', () =>
        HttpResponse.json({
          checklist_ready: true,
          demand_ready: false,
          placement_ready: false,
          acknowledgement_ready: true,
          conflicts_ready: true,
          readiness_pct: 60,
        }),
      ),
    )

    renderWithProviders(<ReadinessPanel eventId="42" />)

    await waitFor(() => expect(screen.getByText('60%')).toBeInTheDocument())

    const checklistRow = screen.getByText('Чек-лист').closest('div')
    expect(checklistRow).toHaveTextContent('✓')

    const demandRow = screen.getByText('Наряд').closest('div')
    expect(demandRow).toHaveTextContent('—')
  })

  it('exposes readiness state to assistive tech via aria-label, not just a visual glyph', async () => {
    server.use(
      http.get('*/api/operations/security-events/42/readiness/', () =>
        HttpResponse.json({
          checklist_ready: true,
          demand_ready: false,
          placement_ready: false,
          acknowledgement_ready: true,
          conflicts_ready: true,
          readiness_pct: 60,
        }),
      ),
    )

    renderWithProviders(<ReadinessPanel eventId="42" />)

    await waitFor(() => expect(screen.getByText('60%')).toBeInTheDocument())

    expect(screen.getAllByLabelText('готово')).toHaveLength(3)
    expect(screen.getAllByLabelText('не готово')).toHaveLength(2)
  })

  it('shows a loading placeholder while the request is pending', () => {
    server.use(
      http.get(
        '*/api/operations/security-events/42/readiness/',
        () => new Promise(() => {}),
      ),
    )

    renderWithProviders(<ReadinessPanel eventId="42" />)

    expect(screen.getByText('Загрузка готовности…')).toBeInTheDocument()
  })

  it('shows an error message and does not throw on a 404', async () => {
    server.use(
      http.get('*/api/operations/security-events/999999/readiness/', () =>
        HttpResponse.json(
          {
            error_code: 'NOT_FOUND',
            message: 'ОМ не найден.',
            details: {},
            request_id: null,
            timestamp: new Date().toISOString(),
          },
          { status: 404 },
        ),
      ),
    )

    renderWithProviders(<ReadinessPanel eventId="999999" />)

    await waitFor(() =>
      expect(screen.getByText(/Не удалось загрузить готовность/)).toBeInTheDocument(),
    )
  })

  it('passes eventId through to the query without transformation', async () => {
    const seenUrls: string[] = []
    server.use(
      http.get('*/api/operations/security-events/:id/readiness/', ({ request }) => {
        seenUrls.push(new URL(request.url).pathname)
        return HttpResponse.json({
          checklist_ready: true,
          demand_ready: true,
          placement_ready: true,
          acknowledgement_ready: true,
          conflicts_ready: true,
          readiness_pct: 100,
        })
      }),
    )

    renderWithProviders(<ReadinessPanel eventId="777" />)

    await waitFor(() => expect(screen.getByText('100%')).toBeInTheDocument())
    expect(seenUrls).toEqual(['/api/operations/security-events/777/readiness/'])
  })
})
