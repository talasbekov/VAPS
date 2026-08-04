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

describe('PlacementVersionDetailPage', () => {
  it('renders version header, assignments table, and conflicts panel', async () => {
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
              employee_id: '11111111-1111-1111-1111-111111111111',
              post: 5,
              conflict_severity: 'SOFT',
              conflict_codes: ['DOUBLE_ASSIGNMENT_CONFLICT'],
              acknowledged_at: null,
              ack_escalated_at: null,
            },
          ],
        }),
      ),
      http.get('*/api/operations/assignment-versions/7/conflicts/', () =>
        HttpResponse.json([
          {
            id: 1,
            employee_id: '11111111-1111-1111-1111-111111111111',
            post: 5,
            conflict_severity: 'SOFT',
            conflict_codes: ['DOUBLE_ASSIGNMENT_CONFLICT'],
            acknowledged_at: null,
            ack_escalated_at: null,
          },
        ]),
      ),
    )
    renderPage('/placement/7')

    await waitFor(() =>
      expect(screen.getByText(/Версия 2/)).toBeInTheDocument(),
    )
    expect(screen.getByText(/Утверждена/)).toBeInTheDocument()
    expect(
      screen.getAllByText('11111111-1111-1111-1111-111111111111'),
    ).not.toHaveLength(0)
    await waitFor(() =>
      expect(screen.getByText(/DOUBLE_ASSIGNMENT_CONFLICT/)).toBeInTheDocument(),
    )
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
})
