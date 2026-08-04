// @vitest-environment jsdom
// Story 16.8h2: detail page — isolated component render (not through
// AppRoutes, routing wiring is 16.8h5's scope).
import '@testing-library/jest-dom/vitest'
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { MemoryRouter, Route, Routes } from 'react-router'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { server } from '../../../shared/api/testing/server'
import { PlacementVersionDetailPage } from './PlacementVersionDetailPage'

afterEach(cleanup)

function renderPage(initialPath: string) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[initialPath]}>
        <Routes>
          <Route path="/placement/:id" element={<PlacementVersionDetailPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

const EMPLOYEE_A = '11111111-1111-1111-1111-111111111111'
const EMPLOYEE_B = '22222222-2222-2222-2222-222222222222'

describe('PlacementVersionDetailPage', () => {
  it('renders version header, assignments table, and a conflicts panel genuinely sourced from its own query', async () => {
    // Detail's `assignments` and the conflicts endpoint return DIVERGENT
    // data on purpose (review, Acceptance Auditor) — proves the panel
    // reads from useAssignmentVersionConflicts, not from re-deriving
    // version.assignments.
    server.use(
      http.get('*/api/operations/assignment-versions/7/', () =>
        HttpResponse.json({
          id: 7,
          event: 3,
          status: 'APPROVED',
          version: 2,
          is_current: true,
          signature_hash: 'abc123',
          created_at: '2026-08-01T09:00:00Z',
          updated_at: '2026-08-01T09:00:00Z',
          assignments: [
            {
              id: 1,
              employee_id: EMPLOYEE_A,
              post: 5,
              conflict_severity: '',
              conflict_codes: [],
              acknowledged_at: '2026-08-02T10:00:00Z',
              ack_escalated_at: null,
            },
          ],
        }),
      ),
      http.get('*/api/operations/assignment-versions/7/conflicts/', () =>
        HttpResponse.json([
          {
            id: 2,
            employee_id: EMPLOYEE_B,
            post: 6,
            conflict_severity: 'HARD',
            conflict_codes: ['REST_VIOLATION_CONFLICT'],
            acknowledged_at: null,
            ack_escalated_at: null,
          },
        ]),
      ),
    )
    renderPage('/placement/7')

    await waitFor(() => expect(screen.getByText(/Версия 2/)).toBeInTheDocument())
    expect(screen.getByText(/Утверждена/)).toBeInTheDocument()
    // Assignments table: employee A, no conflict ('—'), ack timestamp rendered.
    expect(screen.getByText(EMPLOYEE_A)).toBeInTheDocument()
    expect(screen.getByText('—')).toBeInTheDocument()
    expect(screen.getByText(new Date('2026-08-02T10:00:00Z').toLocaleString('ru-RU'))).toBeInTheDocument()
    // Conflicts panel: employee B, HARD — proves it's the SEPARATE
    // conflicts-endpoint payload, not a re-render of the table above.
    await waitFor(() =>
      expect(screen.getByText(/REST_VIOLATION_CONFLICT/)).toBeInTheDocument(),
    )
    expect(screen.getByText(EMPLOYEE_B)).toBeInTheDocument()
    expect(screen.queryByText(EMPLOYEE_B, { selector: 'td' })).not.toBeInTheDocument()
  })

  it('shows a not-found state for a missing version (404)', async () => {
    server.use(
      http.get('*/api/operations/assignment-versions/999/', () =>
        HttpResponse.json(
          {
            error_code: 'ENTITY_NOT_FOUND',
            message: 'Не найдено',
            details: {},
            request_id: null,
            timestamp: new Date().toISOString(),
          },
          { status: 404 },
        ),
      ),
      http.get('*/api/operations/assignment-versions/999/conflicts/', () =>
        HttpResponse.json([]),
      ),
    )
    renderPage('/placement/999')

    await waitFor(() =>
      expect(screen.getByText('Версия Расстановки не найдена.')).toBeInTheDocument(),
    )
  })

  it('shows a generic (non-404) error state distinct from the not-found message', async () => {
    server.use(
      http.get('*/api/operations/assignment-versions/7/', () =>
        HttpResponse.json({ error_code: 'INTERNAL_ERROR' }, { status: 500 }),
      ),
      http.get('*/api/operations/assignment-versions/7/conflicts/', () =>
        HttpResponse.json([]),
      ),
    )
    renderPage('/placement/7')

    await waitFor(() =>
      expect(
        screen.getByText(
          'Не удалось загрузить версию Расстановки. Попробуйте обновить страницу.',
        ),
      ).toBeInTheDocument(),
    )
    expect(screen.queryByText('Версия Расстановки не найдена.')).not.toBeInTheDocument()
  })

  it('renders an unmapped status value as raw text (fallback)', async () => {
    server.use(
      http.get('*/api/operations/assignment-versions/7/', () =>
        HttpResponse.json({
          id: 7,
          event: 3,
          status: 'UNKNOWN_FUTURE_STATUS',
          version: 1,
          is_current: true,
          signature_hash: '',
          created_at: '2026-08-01T09:00:00Z',
          updated_at: '2026-08-01T09:00:00Z',
          assignments: [],
        }),
      ),
      http.get('*/api/operations/assignment-versions/7/conflicts/', () =>
        HttpResponse.json([]),
      ),
    )
    renderPage('/placement/7')

    await waitFor(() =>
      expect(screen.getByText(/UNKNOWN_FUTURE_STATUS/)).toBeInTheDocument(),
    )
  })

  it('conflicts panel shows its own loading, then error state on failure', async () => {
    server.use(
      http.get('*/api/operations/assignment-versions/7/', () =>
        HttpResponse.json({
          id: 7,
          event: 3,
          status: 'APPROVED',
          version: 1,
          is_current: true,
          signature_hash: '',
          created_at: '2026-08-01T09:00:00Z',
          updated_at: '2026-08-01T09:00:00Z',
          assignments: [],
        }),
      ),
      http.get('*/api/operations/assignment-versions/7/conflicts/', async () => {
        await new Promise((resolve) => setTimeout(resolve, 20))
        return HttpResponse.json({ error_code: 'INTERNAL_ERROR' }, { status: 500 })
      }),
    )
    renderPage('/placement/7')

    expect(await screen.findByText('Проверка конфликтов…')).toBeInTheDocument()
    await waitFor(() =>
      expect(screen.getByText('Не удалось проверить конфликты.')).toBeInTheDocument(),
    )
  })

  it('conflicts panel shows "no conflicts" when the version has none', async () => {
    server.use(
      http.get('*/api/operations/assignment-versions/7/', () =>
        HttpResponse.json({
          id: 7,
          event: 3,
          status: 'APPROVED',
          version: 1,
          is_current: true,
          signature_hash: '',
          created_at: '2026-08-01T09:00:00Z',
          updated_at: '2026-08-01T09:00:00Z',
          assignments: [
            {
              id: 1,
              employee_id: EMPLOYEE_A,
              post: 5,
              conflict_severity: '',
              conflict_codes: [],
              acknowledged_at: null,
              ack_escalated_at: null,
            },
          ],
        }),
      ),
      http.get('*/api/operations/assignment-versions/7/conflicts/', () =>
        HttpResponse.json([]),
      ),
    )
    renderPage('/placement/7')

    await waitFor(() => expect(screen.getByText('Конфликтов нет.')).toBeInTheDocument())
  })
})
