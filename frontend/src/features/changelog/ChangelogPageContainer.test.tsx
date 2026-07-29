// @vitest-environment jsdom
// Story 13.4b — container wiring: real GET /api/bugreports/journal/,
// pagination envelope unwrapped before ChangelogPage ever sees it, error
// surfaced (not silently swallowed into an indistinguishable empty state).
import '@testing-library/jest-dom/vitest'
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { http, HttpResponse } from 'msw'
import { server } from '../../shared/api/testing/server'
import { ChangelogPageContainer, JOURNAL_ERROR_TEXT } from './ChangelogPageContainer'

afterEach(cleanup)

function renderContainer() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return render(
    <QueryClientProvider client={client}>
      <ChangelogPageContainer />
    </QueryClientProvider>,
  )
}

describe('ChangelogPageContainer', () => {
  it('unwraps the paginated envelope into ChangelogPage rows', async () => {
    server.use(
      http.get('*/api/bugreports/journal/', () =>
        HttpResponse.json({
          count: 1,
          next: null,
          previous: null,
          results: [
            {
              id: '1',
              version: 'abc1234',
              releasedAt: '2026-07-19',
              summary: 'Кнопка «Сдать день» починена',
            },
          ],
        }),
      ),
    )
    renderContainer()

    expect(
      await screen.findByText('Кнопка «Сдать день» починена'),
    ).toBeInTheDocument()
    expect(screen.getByText('abc1234')).toBeInTheDocument()
  })

  it('shows the empty state on an empty journal (not an error)', async () => {
    server.use(
      http.get('*/api/bugreports/journal/', () =>
        HttpResponse.json({ count: 0, next: null, previous: null, results: [] }),
      ),
    )
    renderContainer()

    expect(await screen.findByText('Исправлений пока нет.')).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('surfaces a visible error on request failure, not a silent empty list', async () => {
    server.use(
      http.get('*/api/bugreports/journal/', () =>
        HttpResponse.json(
          {
            error_code: 'SERVER_ERROR',
            message: 'x',
            details: {},
            request_id: null,
            timestamp: '2026-07-29T09:00:00+05:00',
          },
          { status: 500 },
        ),
      ),
    )
    renderContainer()

    expect(await screen.findByRole('alert')).toHaveTextContent(JOURNAL_ERROR_TEXT)
  })
})
