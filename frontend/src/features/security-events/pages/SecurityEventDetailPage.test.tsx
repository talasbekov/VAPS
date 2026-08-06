// @vitest-environment jsdom
// Story 20.1e: SecurityEventDetailPage did not have an isolated unit test
// before this story (19.4d precedent — page-level tests are usually covered
// by e2e/routing). This test exists specifically to prove the wiring of
// ReadinessPanel (real backend endpoint) into a mock-first page degrades
// honestly (dev-mock 404, not an unhandled MSW exception, not a broken page).
import '@testing-library/jest-dom/vitest'
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter, Route, Routes } from 'react-router'
import { server } from '../../../shared/api/testing/server'
import { ToastProvider } from '../../../shared/ui/toast'
import type { SecurityEvent } from '../model/types'
import { SecurityEventDetailPage } from './SecurityEventDetailPage'

afterEach(cleanup)

function buildEvent(overrides: Partial<SecurityEvent> = {}): SecurityEvent {
  return {
    id: '42',
    code: 'OM-42',
    title: 'Тестовое мероприятие',
    objectName: 'Объект №1',
    businessDate: '2026-08-10',
    stage: 'BULLETIN',
    readinessPercent: 60,
    forceNeed: 0,
    conflictsCount: 0,
    ownerName: 'Иванов И.И.',
    briefDescription: '',
    initialTasks: '',
    reconChecklist: [],
    reconSectorPosts: [],
    demandRows: [],
    demandApproved: false,
    forceRequests: [],
    placementAssignments: [],
    approvalStatus: 'PENDING',
    approvalComment: '',
    journalEntries: [],
    closureDirectionSummaries: [],
    closedAt: null,
    createdAt: '2026-08-01T00:00:00Z',
    updatedAt: '2026-08-01T00:00:00Z',
    ...overrides,
  }
}

function renderPage(eventId: string) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  return render(
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <MemoryRouter initialEntries={[`/security-events/${eventId}`]}>
          <Routes>
            <Route
              path="/security-events/:id"
              element={<SecurityEventDetailPage />}
            />
          </Routes>
        </MemoryRouter>
      </ToastProvider>
    </QueryClientProvider>,
  )
}

describe('SecurityEventDetailPage — readiness panel wiring', () => {
  it('renders ReadinessPanel with the event id and degrades honestly when the real endpoint 404s', async () => {
    const seenReadinessIds: string[] = []
    server.use(
      http.get('*/api/ops/security-events/42/', () =>
        HttpResponse.json(buildEvent()),
      ),
      http.get('*/api/operations/security-events/:id/readiness/', ({ params }) => {
        seenReadinessIds.push(String(params.id))
        return HttpResponse.json(
          {
            error_code: 'NOT_FOUND',
            message: 'ОМ не найден.',
            details: {},
            request_id: null,
            timestamp: new Date().toISOString(),
          },
          { status: 404 },
        )
      }),
    )

    renderPage('42')

    await waitFor(() =>
      expect(screen.getByText('Тестовое мероприятие')).toBeInTheDocument(),
    )

    expect(screen.getByText('Готовность ОМ')).toBeInTheDocument()
    await waitFor(() =>
      expect(screen.getByText(/Не удалось загрузить готовность/)).toBeInTheDocument(),
    )
    expect(seenReadinessIds).toEqual(['42'])
  })

  it('no longer renders the mock readinessPercent StatBox', async () => {
    server.use(
      http.get('*/api/ops/security-events/42/', () =>
        HttpResponse.json(buildEvent({ stage: 'DEMAND' })),
      ),
      http.get('*/api/operations/security-events/:id/readiness/', () =>
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

    renderPage('42')

    await waitFor(() =>
      expect(screen.getByText('Тестовое мероприятие')).toBeInTheDocument(),
    )

    expect(screen.queryByText('60%')).not.toBeInTheDocument()
    expect(screen.getByText('Всего требуется')).toBeInTheDocument()
    expect(screen.getByText('Постов')).toBeInTheDocument()
    expect(screen.getByText('Групп задействовано')).toBeInTheDocument()
  })
})
