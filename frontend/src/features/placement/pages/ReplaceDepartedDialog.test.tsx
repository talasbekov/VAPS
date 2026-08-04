// @vitest-environment jsdom
// Story 17.7d: «Снять и заменить» — button visibility/success-redirect/
// 409/403/empty-validation. Rendered through PlacementVersionDetailPage
// (same harness as ReturnVersionDialog's tests) since the button lives in
// AssignmentsTable, not a standalone entry point.
import '@testing-library/jest-dom/vitest'
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { MemoryRouter, Route, Routes } from 'react-router'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { server } from '../../../shared/api/testing/server'
import { ToastProvider } from '../../../shared/ui/toast'
import { PlacementVersionDetailPage } from './PlacementVersionDetailPage'

if (typeof HTMLDialogElement.prototype.showModal !== 'function') {
  HTMLDialogElement.prototype.showModal = function (this: HTMLDialogElement) {
    this.open = true
  }
  HTMLDialogElement.prototype.close = function (this: HTMLDialogElement) {
    this.open = false
    this.dispatchEvent(new Event('close'))
  }
}

afterEach(cleanup)

const EMPLOYEE_A = '11111111-1111-1111-1111-111111111111'

function renderPage(initialPath: string) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <MemoryRouter initialEntries={[initialPath]}>
          <Routes>
            <Route path="/placement/:id" element={<PlacementVersionDetailPage />} />
          </Routes>
        </MemoryRouter>
      </ToastProvider>
    </QueryClientProvider>,
  )
}

function approvedVersion(overrides: Record<string, unknown> = {}) {
  return {
    id: 7,
    event: 3,
    status: 'APPROVED',
    version: 2,
    is_current: true,
    signature_hash: 'abc',
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
    ...overrides,
  }
}

describe('ReplaceDepartedDialog (via PlacementVersionDetailPage)', () => {
  it('AC-1: shows the button on an APPROVED, current version', async () => {
    server.use(
      http.get('*/api/operations/assignment-versions/7/', () =>
        HttpResponse.json(approvedVersion()),
      ),
      http.get('*/api/operations/assignment-versions/7/conflicts/', () =>
        HttpResponse.json([]),
      ),
    )
    renderPage('/placement/7')

    expect(
      await screen.findByRole('button', { name: /Снять и заменить/ }),
    ).toBeInTheDocument()
  })

  it('AC-2: hides the button on a non-current version', async () => {
    server.use(
      http.get('*/api/operations/assignment-versions/7/', () =>
        HttpResponse.json(approvedVersion({ is_current: false })),
      ),
      http.get('*/api/operations/assignment-versions/7/conflicts/', () =>
        HttpResponse.json([]),
      ),
    )
    renderPage('/placement/7')

    await screen.findByText(EMPLOYEE_A)
    expect(
      screen.queryByRole('button', { name: /Снять и заменить/ }),
    ).not.toBeInTheDocument()
  })

  it('AC-2: hides the button on a DRAFT version', async () => {
    server.use(
      http.get('*/api/operations/assignment-versions/7/', () =>
        HttpResponse.json(approvedVersion({ status: 'DRAFT' })),
      ),
      http.get('*/api/operations/assignment-versions/7/conflicts/', () =>
        HttpResponse.json([]),
      ),
    )
    renderPage('/placement/7')

    await screen.findByText(EMPLOYEE_A)
    expect(
      screen.queryByRole('button', { name: /Снять и заменить/ }),
    ).not.toBeInTheDocument()
  })

  it('AC-3: blocks submit when reason/sanction are empty', async () => {
    const user = userEvent.setup()
    server.use(
      http.get('*/api/operations/assignment-versions/7/', () =>
        HttpResponse.json(approvedVersion()),
      ),
      http.get('*/api/operations/assignment-versions/7/conflicts/', () =>
        HttpResponse.json([]),
      ),
    )
    renderPage('/placement/7')

    await user.click(await screen.findByRole('button', { name: /Снять и заменить/ }))
    await user.click(screen.getByRole('button', { name: 'Заменить' }))

    expect(await screen.findByText('Укажите причину.')).toBeInTheDocument()
    expect(screen.getByText('Укажите санкцию.')).toBeInTheDocument()
  })

  it('AC-4: successful submit redirects to the new current version', async () => {
    const user = userEvent.setup()
    let received: Record<string, unknown> | null = null
    server.use(
      http.get('*/api/operations/assignment-versions/7/', () =>
        HttpResponse.json(approvedVersion()),
      ),
      http.get('*/api/operations/assignment-versions/7/conflicts/', () =>
        HttpResponse.json([]),
      ),
      http.post(
        '*/api/operations/assignment-versions/7/replace-departed/',
        async ({ request }) => {
          received = (await request.json()) as Record<string, unknown>
          return HttpResponse.json(approvedVersion({ id: 8, version: 3 }), { status: 201 })
        },
      ),
      http.get('*/api/operations/assignment-versions/8/', () =>
        HttpResponse.json(approvedVersion({ id: 8, version: 3 })),
      ),
      http.get('*/api/operations/assignment-versions/8/conflicts/', () =>
        HttpResponse.json([]),
      ),
    )
    renderPage('/placement/7')

    await user.click(await screen.findByRole('button', { name: /Снять и заменить/ }))
    await user.type(screen.getByLabelText('Причина'), 'Выбыл по болезни')
    await user.type(screen.getByLabelText('Санкция'), 'Приказ №9')
    await user.click(screen.getByRole('button', { name: 'Заменить' }))

    await waitFor(() => expect(screen.getByText(/Версия 3/)).toBeInTheDocument())
    expect(received).toMatchObject({
      departed_employee_id: EMPLOYEE_A,
      reason: 'Выбыл по болезни',
      sanction: 'Приказ №9',
    })
  })

  it('AC-5: 409 REPLACEMENT_NOT_FOUND shows an error and keeps the dialog open', async () => {
    const user = userEvent.setup()
    server.use(
      http.get('*/api/operations/assignment-versions/7/', () =>
        HttpResponse.json(approvedVersion()),
      ),
      http.get('*/api/operations/assignment-versions/7/conflicts/', () =>
        HttpResponse.json([]),
      ),
      http.post('*/api/operations/assignment-versions/7/replace-departed/', () =>
        HttpResponse.json(
          {
            error_code: 'REPLACEMENT_NOT_FOUND',
            message: 'Кандидат на замену не найден.',
            details: {},
            request_id: null,
            timestamp: new Date().toISOString(),
          },
          { status: 409 },
        ),
      ),
    )
    renderPage('/placement/7')

    await user.click(await screen.findByRole('button', { name: /Снять и заменить/ }))
    await user.type(screen.getByLabelText('Причина'), 'x')
    await user.type(screen.getByLabelText('Санкция'), 'y')
    await user.click(screen.getByRole('button', { name: 'Заменить' }))

    expect(await screen.findByText('Кандидат на замену не найден.')).toBeInTheDocument()
    expect(screen.getByRole('dialog')).toBeInTheDocument()
  })

  it('AC-6: 403 shows an error, and reopening the dialog clears it (no permanent lockout)', async () => {
    const user = userEvent.setup()
    server.use(
      http.get('*/api/operations/assignment-versions/7/', () =>
        HttpResponse.json(approvedVersion()),
      ),
      http.get('*/api/operations/assignment-versions/7/conflicts/', () =>
        HttpResponse.json([]),
      ),
      http.post('*/api/operations/assignment-versions/7/replace-departed/', () =>
        HttpResponse.json({ error_code: 'PERMISSION_DENIED' }, { status: 403 }),
      ),
    )
    renderPage('/placement/7')

    await user.click(await screen.findByRole('button', { name: /Снять и заменить/ }))
    await user.type(screen.getByLabelText('Причина'), 'x')
    await user.type(screen.getByLabelText('Санкция'), 'y')
    await user.click(screen.getByRole('button', { name: 'Заменить' }))
    const dialog = await screen.findByRole('dialog')
    await within(dialog).findByRole('alert')

    await user.click(screen.getByRole('button', { name: 'Отмена' }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /Снять и заменить/ }))
    const reopenedDialog = screen.getByRole('dialog')
    expect(within(reopenedDialog).queryByRole('alert')).not.toBeInTheDocument()
    expect(screen.getByLabelText('Причина')).toHaveValue('')
  })

  it('review (Blind Hunter): rows have distinct accessible names and each wires the correct employee to the dialog', async () => {
    const user = userEvent.setup()
    const EMPLOYEE_B = '22222222-2222-2222-2222-222222222222'
    let received: Record<string, unknown> | null = null
    server.use(
      http.get('*/api/operations/assignment-versions/7/', () =>
        HttpResponse.json(
          approvedVersion({
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
              {
                id: 2,
                employee_id: EMPLOYEE_B,
                post: 6,
                conflict_severity: '',
                conflict_codes: [],
                acknowledged_at: null,
                ack_escalated_at: null,
              },
            ],
          }),
        ),
      ),
      http.get('*/api/operations/assignment-versions/7/conflicts/', () =>
        HttpResponse.json([]),
      ),
      http.post(
        '*/api/operations/assignment-versions/7/replace-departed/',
        async ({ request }) => {
          received = (await request.json()) as Record<string, unknown>
          return HttpResponse.json(approvedVersion({ id: 9, version: 3 }), { status: 201 })
        },
      ),
      http.get('*/api/operations/assignment-versions/9/', () =>
        HttpResponse.json(approvedVersion({ id: 9, version: 3 })),
      ),
      http.get('*/api/operations/assignment-versions/9/conflicts/', () =>
        HttpResponse.json([]),
      ),
    )
    renderPage('/placement/7')
    await screen.findByText(EMPLOYEE_A)

    const buttons = await screen.findAllByRole('button', { name: /Снять и заменить/ })
    expect(buttons).toHaveLength(2)
    expect(buttons[0].getAttribute('aria-label')).not.toBe(
      buttons[1].getAttribute('aria-label'),
    )

    // review-precedent: clicking the SECOND row's button must submit
    // EMPLOYEE_B, not fall back to the first row's employee_id.
    await user.click(buttons[1])
    await user.type(screen.getByLabelText('Причина'), 'x')
    await user.type(screen.getByLabelText('Санкция'), 'y')
    await user.click(screen.getByRole('button', { name: 'Заменить' }))

    await waitFor(() =>
      expect(received).toMatchObject({ departed_employee_id: EMPLOYEE_B }),
    )
  })
})
