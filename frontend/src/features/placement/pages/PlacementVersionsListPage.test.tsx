// @vitest-environment jsdom
// Story 16.8h2: list page — isolated component render (not through AppRoutes,
// routing wiring is 16.8h5's scope), образец queries.test.tsx's MSW-паттерн.
import '@testing-library/jest-dom/vitest'
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { MemoryRouter } from 'react-router'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { server } from '../../../shared/api/testing/server'
import { PlacementVersionsListPage } from './PlacementVersionsListPage'

afterEach(cleanup)

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <PlacementVersionsListPage />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

describe('PlacementVersionsListPage', () => {
  it('renders the list of versions with a link to detail', async () => {
    server.use(
      http.get('*/api/operations/assignment-versions/', () =>
        HttpResponse.json({
          count: 1,
          next: null,
          previous: null,
          results: [
            {
              id: 7,
              event: 3,
              status: 'SUBMITTED',
              version: 1,
              is_current: true,
              signature_hash: '',
              created_at: '2026-08-01T09:00:00Z',
              updated_at: '2026-08-01T09:00:00Z',
            },
          ],
        }),
      ),
    )
    renderPage()

    await waitFor(() => expect(screen.getByText('Событие #3')).toBeInTheDocument())
    expect(screen.getByText('На согласовании')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Событие #3' })).toHaveAttribute(
      'href',
      '/placement/7',
    )
  })

  it('shows an empty state when there are no versions', async () => {
    server.use(
      http.get('*/api/operations/assignment-versions/', () =>
        HttpResponse.json({ count: 0, next: null, previous: null, results: [] }),
      ),
    )
    renderPage()

    await waitFor(() =>
      expect(screen.getByText('Версий Расстановки пока нет.')).toBeInTheDocument(),
    )
  })

  it('shows an error state on request failure', async () => {
    server.use(
      http.get('*/api/operations/assignment-versions/', () =>
        HttpResponse.json({ error_code: 'INTERNAL_ERROR' }, { status: 500 }),
      ),
    )
    renderPage()

    await waitFor(() =>
      expect(
        screen.getByText('Не удалось загрузить версии Расстановки. Попробуйте обновить страницу.'),
      ).toBeInTheDocument(),
    )
  })
})
