// @vitest-environment jsdom
// Story 16.7 — упрощённая печатная форма Расстановки. jsdom CSS НЕ парсит
// (Ловушка 11 стори 8.8): ассертим РАЗМЕТКУ (порядок ячеек, тексты);
// computed styles/@media print судит только e2e в реальном браузере
// (образец ExpensePrintPage.test.tsx, 10.7).
import '@testing-library/jest-dom/vitest'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { MemoryRouter } from 'react-router'
import { afterEach, describe, expect, it } from 'vitest'
import { server } from '../../shared/api/testing/server'
import { PlacementPrintPage } from './PlacementPrintPage'
import { PRINT_EMPTY_MESSAGE, PRINT_NOT_FOUND_MESSAGE } from './placementPrint'

afterEach(cleanup)

function renderPage(initialPath: string) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[initialPath]}>
        <PlacementPrintPage />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

describe('PlacementPrintPage', () => {
  it('AC-1: no version_id shows explanatory text, no request', async () => {
    renderPage('/print/placement')

    expect(
      await screen.findByText(/Не хватает параметра печати/),
    ).toBeInTheDocument()
  })

  it('AC-1: non-numeric version_id shows explanatory text', async () => {
    renderPage('/print/placement?version_id=abc')

    expect(
      await screen.findByText(/Не хватает параметра печати/),
    ).toBeInTheDocument()
  })

  it('AC-2: renders header and assignments table', async () => {
    server.use(
      http.get('*/api/operations/assignment-versions/7/', () =>
        HttpResponse.json({
          id: 7,
          event: 3,
          status: 'APPROVED',
          version: 2,
          is_current: true,
          signature_hash: 'sig-abc',
          created_at: '2026-08-01T09:00:00Z',
          updated_at: '2026-08-01T09:00:00Z',
          assignments: [
            {
              id: 1,
              employee_id: '11111111-1111-1111-1111-111111111111',
              post: 5,
              conflict_severity: '',
              conflict_codes: [],
              acknowledged_at: '2026-08-02T10:00:00Z',
              ack_escalated_at: null,
            },
          ],
        }),
      ),
    )
    renderPage('/print/placement?version_id=7')

    expect(
      await screen.findByRole('heading', {
        name: /Событие #3.*Версия 2/,
      }),
    ).toBeInTheDocument()
    expect(screen.getByText(/Утверждена/)).toBeInTheDocument()
    expect(screen.getByText(/sig-abc/)).toBeInTheDocument()
    expect(
      screen.getByText('11111111-1111-1111-1111-111111111111'),
    ).toBeInTheDocument()
    expect(screen.getByRole('columnheader', { name: 'Сотрудник' })).toBeInTheDocument()
  })

  it('AC-4: 404 shows not-found text, not a crash', async () => {
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
    )
    renderPage('/print/placement?version_id=999')

    expect(await screen.findByText(PRINT_NOT_FOUND_MESSAGE)).toBeInTheDocument()
  })

  it('AC-3: generic error (500) shows a text, not a blank page', async () => {
    server.use(
      http.get('*/api/operations/assignment-versions/7/', () =>
        HttpResponse.json({ error_code: 'INTERNAL_ERROR' }, { status: 500 }),
      ),
    )
    renderPage('/print/placement?version_id=7')

    await waitFor(() =>
      expect(
        screen.getByText(/Не удалось загрузить версию Расстановки/),
      ).toBeInTheDocument(),
    )
  })

  it('401 is silent (RequireAuth handles the redirect elsewhere)', async () => {
    server.use(
      http.get('*/api/operations/assignment-versions/7/', () =>
        HttpResponse.json(
          {
            error_code: 'AUTH_REQUIRED',
            message: 'Требуется вход',
            details: {},
            request_id: null,
            timestamp: new Date().toISOString(),
          },
          { status: 401 },
        ),
      ),
    )
    renderPage('/print/placement?version_id=7')

    await waitFor(() =>
      expect(screen.queryByText(/Загрузка версии/)).not.toBeInTheDocument(),
    )
    expect(screen.queryByText(/Не удалось/)).not.toBeInTheDocument()
  })

  it('AC-5: version with no assignments shows the empty message, not a bare table', async () => {
    server.use(
      http.get('*/api/operations/assignment-versions/7/', () =>
        HttpResponse.json({
          id: 7,
          event: 3,
          status: 'DRAFT',
          version: 1,
          is_current: true,
          signature_hash: '',
          created_at: '2026-08-01T09:00:00Z',
          updated_at: '2026-08-01T09:00:00Z',
          assignments: [],
        }),
      ),
    )
    renderPage('/print/placement?version_id=7')

    expect(await screen.findByText(PRINT_EMPTY_MESSAGE)).toBeInTheDocument()
    expect(screen.queryByRole('table')).not.toBeInTheDocument()
  })

  it('review: renders assignments in server order, does not re-sort client-side', async () => {
    const EMPLOYEE_C = '33333333-3333-3333-3333-333333333333'
    const EMPLOYEE_A = '11111111-1111-1111-1111-111111111111'
    const EMPLOYEE_B = '22222222-2222-2222-2222-222222222222'
    server.use(
      http.get('*/api/operations/assignment-versions/7/', () =>
        HttpResponse.json({
          id: 7,
          event: 3,
          status: 'DRAFT',
          version: 1,
          is_current: true,
          signature_hash: '',
          created_at: '2026-08-01T09:00:00Z',
          updated_at: '2026-08-01T09:00:00Z',
          assignments: [
            {
              id: 3,
              employee_id: EMPLOYEE_C,
              post: 1,
              conflict_severity: '',
              conflict_codes: [],
              acknowledged_at: null,
              ack_escalated_at: null,
            },
            {
              id: 1,
              employee_id: EMPLOYEE_A,
              post: 2,
              conflict_severity: '',
              conflict_codes: [],
              acknowledged_at: null,
              ack_escalated_at: null,
            },
            {
              id: 2,
              employee_id: EMPLOYEE_B,
              post: 3,
              conflict_severity: '',
              conflict_codes: [],
              acknowledged_at: null,
              ack_escalated_at: null,
            },
          ],
        }),
      ),
    )
    renderPage('/print/placement?version_id=7')

    const rows = await screen.findAllByRole('row')
    // rows[0] is the header row.
    const bodyRows = rows.slice(1)
    expect(bodyRows.map((row) => row.textContent)).toEqual([
      expect.stringContaining(EMPLOYEE_C),
      expect.stringContaining(EMPLOYEE_A),
      expect.stringContaining(EMPLOYEE_B),
    ])
  })

  it('review: unmapped status falls back to the raw status string', async () => {
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
    )
    renderPage('/print/placement?version_id=7')

    expect(await screen.findByText(/UNKNOWN_FUTURE_STATUS/)).toBeInTheDocument()
  })
})
