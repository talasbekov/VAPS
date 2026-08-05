// @vitest-environment jsdom
// Story 16.8h2: detail page — isolated component render (not through
// AppRoutes, routing wiring is 16.8h5's scope).
// Story 16.8h3: page now renders lifecycle mutations (useApiMutation) —
// ToastProvider required (образец useApiMutation.test.tsx).
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

// jsdom не реализует <dialog> methods — прецедент ConflictDialog.test.tsx.
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

function version(overrides: Record<string, unknown>) {
  return {
    id: 7,
    event: 3,
    version: 1,
    is_current: true,
    signature_hash: '',
    created_at: '2026-08-01T09:00:00Z',
    updated_at: '2026-08-01T09:00:00Z',
    assignments: [] as Record<string, unknown>[],
    ...overrides,
  }
}

describe('LifecycleActions', () => {
  it('AC-1: DRAFT shows submit, success updates status without reload', async () => {
    server.use(
      http.get('*/api/operations/assignment-versions/7/', () =>
        HttpResponse.json(version({ status: 'DRAFT' })),
      ),
      http.get('*/api/operations/assignment-versions/7/conflicts/', () =>
        HttpResponse.json([]),
      ),
      http.post('*/api/operations/assignment-versions/7/submit/', () =>
        HttpResponse.json(version({ status: 'SUBMITTED' })),
      ),
    )
    renderPage('/placement/7')
    const submitButton = await screen.findByRole('button', {
      name: 'Подать на согласование',
    })

    await userEvent.click(submitButton)

    await waitFor(() =>
      expect(
        screen.getByRole('heading', { name: /На согласовании/ }),
      ).toBeInTheDocument(),
    )
  })

  it('AC-5: APPROVED shows no lifecycle action buttons', async () => {
    server.use(
      http.get('*/api/operations/assignment-versions/7/', () =>
        HttpResponse.json(version({ status: 'APPROVED' })),
      ),
      http.get('*/api/operations/assignment-versions/7/conflicts/', () =>
        HttpResponse.json([]),
      ),
    )
    renderPage('/placement/7')

    await waitFor(() => expect(screen.getByText(/Утверждена/)).toBeInTheDocument())
    expect(
      screen.queryByRole('button', { name: 'Подать на согласование' }),
    ).not.toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: 'Вернуть на доработку' }),
    ).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Утвердить' })).not.toBeInTheDocument()
  })

  it('AC-3: SUBMITTED approve success updates status', async () => {
    server.use(
      http.get('*/api/operations/assignment-versions/7/', () =>
        HttpResponse.json(version({ status: 'SUBMITTED' })),
      ),
      http.get('*/api/operations/assignment-versions/7/conflicts/', () =>
        HttpResponse.json([]),
      ),
      http.post('*/api/operations/assignment-versions/7/approve/', () =>
        HttpResponse.json(version({ status: 'APPROVED', signature_hash: 'sig' })),
      ),
    )
    renderPage('/placement/7')
    const approveButton = await screen.findByRole('button', { name: 'Утвердить' })

    await userEvent.click(approveButton)

    await waitFor(() => expect(screen.getByText(/Утверждена/)).toBeInTheDocument())
  })

  it('AC-4: 409 SOFT_CONFLICT_DETECTED opens ConflictDialog, override retries with override:true', async () => {
    let received: Record<string, unknown> | null = null
    server.use(
      http.get('*/api/operations/assignment-versions/7/', () =>
        HttpResponse.json(version({ status: 'SUBMITTED' })),
      ),
      http.get('*/api/operations/assignment-versions/7/conflicts/', () =>
        HttpResponse.json([]),
      ),
      http.post('*/api/operations/assignment-versions/7/approve/', async ({ request }) => {
        const body = (await request.json()) as Record<string, unknown>
        received = body
        if (body.override === true) {
          return HttpResponse.json(version({ status: 'APPROVED' }))
        }
        return HttpResponse.json(
          {
            error_code: 'SOFT_CONFLICT_DETECTED',
            message: 'Конфликт',
            details: {},
            request_id: null,
            timestamp: new Date().toISOString(),
          },
          { status: 409 },
        )
      }),
    )
    renderPage('/placement/7')
    const approveButton = await screen.findByRole('button', { name: 'Утвердить' })
    await userEvent.click(approveButton)

    const dialog = await screen.findByRole('dialog')
    const reasonInput = within(dialog).getByRole('textbox')
    await userEvent.type(reasonInput, 'Разрешено вручную после проверки')
    await userEvent.click(screen.getByRole('button', { name: /Подтвердить/ }))

    await waitFor(() => expect(screen.getByText(/Утверждена/)).toBeInTheDocument())
    expect(received).toMatchObject({ override: true })
  })

  it('AC-2: SUBMITTED return dialog requires reason, redirects to new_draft_version on success', async () => {
    server.use(
      http.get('*/api/operations/assignment-versions/7/', () =>
        HttpResponse.json(version({ status: 'SUBMITTED' })),
      ),
      http.get('*/api/operations/assignment-versions/7/conflicts/', () =>
        HttpResponse.json([]),
      ),
      http.get('*/api/operations/assignment-versions/8/', () =>
        HttpResponse.json(version({ id: 8, status: 'DRAFT', version: 2 })),
      ),
      http.get('*/api/operations/assignment-versions/8/conflicts/', () =>
        HttpResponse.json([]),
      ),
      http.post('*/api/operations/assignment-versions/7/return/', async ({ request }) => {
        const body = (await request.json()) as { reason?: string }
        if (!body.reason?.trim()) {
          return HttpResponse.json({ error_code: 'VALIDATION_ERROR' }, { status: 400 })
        }
        return HttpResponse.json({
          ...version({ status: 'RETURNED' }),
          new_draft_version: version({ id: 8, status: 'DRAFT', version: 2 }),
        })
      }),
    )
    renderPage('/placement/7')
    const returnButton = await screen.findByRole('button', { name: 'Вернуть на доработку' })
    await userEvent.click(returnButton)

    // Client-side required guard — submit without typing anything.
    await userEvent.click(screen.getByRole('button', { name: 'Вернуть' }))
    expect(await screen.findByText('Укажите причину возврата.')).toBeInTheDocument()

    await userEvent.type(screen.getByLabelText('Причина возврата'), 'Проверить состав')
    await userEvent.click(screen.getByRole('button', { name: 'Вернуть' }))

    await waitFor(() => expect(screen.getByText(/Версия 2/)).toBeInTheDocument())
  })

  it('AC-6: submit failure renders the error under the button', async () => {
    server.use(
      http.get('*/api/operations/assignment-versions/7/', () =>
        HttpResponse.json(version({ status: 'DRAFT' })),
      ),
      http.get('*/api/operations/assignment-versions/7/conflicts/', () =>
        HttpResponse.json([]),
      ),
      http.post('*/api/operations/assignment-versions/7/submit/', () =>
        HttpResponse.json(
          {
            error_code: 'INVALID_LIFECYCLE_TRANSITION',
            message: 'Нельзя подать эту версию.',
            details: {},
            request_id: null,
            timestamp: new Date().toISOString(),
          },
          { status: 422 },
        ),
      ),
    )
    renderPage('/placement/7')
    const submitButton = await screen.findByRole('button', {
      name: 'Подать на согласование',
    })
    await userEvent.click(submitButton)

    expect(await screen.findByText('Нельзя подать эту версию.')).toBeInTheDocument()
  })

  it('AC-6: approve non-conflict failure renders the error, and dismissing a conflict never leaks the raw ConflictError message', async () => {
    server.use(
      http.get('*/api/operations/assignment-versions/7/', () =>
        HttpResponse.json(version({ status: 'SUBMITTED' })),
      ),
      http.get('*/api/operations/assignment-versions/7/conflicts/', () =>
        HttpResponse.json([]),
      ),
      http.post('*/api/operations/assignment-versions/7/approve/', () =>
        HttpResponse.json(
          {
            error_code: 'INVALID_LIFECYCLE_TRANSITION',
            message: 'Нельзя утвердить эту версию.',
            details: {},
            request_id: null,
            timestamp: new Date().toISOString(),
          },
          { status: 422 },
        ),
      ),
    )
    renderPage('/placement/7')
    const approveButton = await screen.findByRole('button', { name: 'Утвердить' })
    await userEvent.click(approveButton)

    expect(await screen.findByText('Нельзя утвердить эту версию.')).toBeInTheDocument()
  })

  it('AC-6 (review): dismissing the conflict dialog does not leak the raw ConflictError inline', async () => {
    server.use(
      http.get('*/api/operations/assignment-versions/7/', () =>
        HttpResponse.json(version({ status: 'SUBMITTED' })),
      ),
      http.get('*/api/operations/assignment-versions/7/conflicts/', () =>
        HttpResponse.json([]),
      ),
      http.post('*/api/operations/assignment-versions/7/approve/', () =>
        HttpResponse.json(
          {
            error_code: 'SOFT_CONFLICT_DETECTED',
            message: 'Технический текст конфликта — не для инлайн-ошибки.',
            details: {},
            request_id: null,
            timestamp: new Date().toISOString(),
          },
          { status: 409 },
        ),
      ),
    )
    renderPage('/placement/7')
    const approveButton = await screen.findByRole('button', { name: 'Утвердить' })
    await userEvent.click(approveButton)
    await screen.findByRole('dialog')

    await userEvent.click(screen.getByRole('button', { name: 'Отмена' }))

    expect(
      screen.queryByText('Технический текст конфликта — не для инлайн-ошибки.'),
    ).not.toBeInTheDocument()
  })

  it('RETURNED status renders no lifecycle action buttons', async () => {
    server.use(
      http.get('*/api/operations/assignment-versions/7/', () =>
        HttpResponse.json(version({ status: 'RETURNED' })),
      ),
      http.get('*/api/operations/assignment-versions/7/conflicts/', () =>
        HttpResponse.json([]),
      ),
    )
    renderPage('/placement/7')

    await waitFor(() =>
      expect(screen.getByText(/Возвращена на доработку/)).toBeInTheDocument(),
    )
    expect(
      screen.queryByRole('button', { name: 'Подать на согласование' }),
    ).not.toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: 'Вернуть на доработку' }),
    ).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Утвердить' })).not.toBeInTheDocument()
  })
})

describe('AcknowledgeCell', () => {
  function approvedVersionWithAssignment(overrides: Record<string, unknown> = {}) {
    return version({
      status: 'APPROVED',
      assignments: [
        {
          id: 1,
          employee_id: EMPLOYEE_A,
          post: 5,
          conflict_severity: '',
          conflict_codes: [],
          acknowledged_at: null,
          ack_escalated_at: null,
          ...overrides,
        },
      ],
    })
  }

  it('AC-1: unacknowledged row on an APPROVED version shows the button, success shows the timestamp', async () => {
    // useAcknowledgePlacementAssignment invalidates (not setQueryData)
    // detail(versionId) — the follow-up refetch must reflect the ack, so
    // the GET handler is stateful here (mirrors placement/mocks/handlers.ts).
    const current = approvedVersionWithAssignment()
    server.use(
      http.get('*/api/operations/assignment-versions/7/', () =>
        HttpResponse.json(current),
      ),
      http.get('*/api/operations/assignment-versions/7/conflicts/', () =>
        HttpResponse.json([]),
      ),
      http.post('*/api/operations/placement-assignments/1/acknowledge/', () => {
        current.assignments[0].acknowledged_at = '2026-08-04T12:00:00Z'
        return HttpResponse.json(current.assignments[0])
      }),
    )
    renderPage('/placement/7')
    const button = await screen.findByRole('button', { name: 'Отметить ознакомление' })

    await userEvent.click(button)

    await waitFor(() =>
      expect(
        screen.getByText(new Date('2026-08-04T12:00:00Z').toLocaleString('ru-RU')),
      ).toBeInTheDocument(),
    )
    expect(
      screen.queryByRole('button', { name: 'Отметить ознакомление' }),
    ).not.toBeInTheDocument()
  })

  it('AC-2: already-acknowledged row shows only the timestamp, no button', async () => {
    server.use(
      http.get('*/api/operations/assignment-versions/7/', () =>
        HttpResponse.json(
          approvedVersionWithAssignment({ acknowledged_at: '2026-08-01T10:00:00Z' }),
        ),
      ),
      http.get('*/api/operations/assignment-versions/7/conflicts/', () =>
        HttpResponse.json([]),
      ),
    )
    renderPage('/placement/7')

    await waitFor(() =>
      expect(
        screen.getByText(new Date('2026-08-01T10:00:00Z').toLocaleString('ru-RU')),
      ).toBeInTheDocument(),
    )
    expect(
      screen.queryByRole('button', { name: 'Отметить ознакомление' }),
    ).not.toBeInTheDocument()
  })

  it('AC-3: 403 on a foreign assignment renders inline, button stays clickable', async () => {
    server.use(
      http.get('*/api/operations/assignment-versions/7/', () =>
        HttpResponse.json(approvedVersionWithAssignment()),
      ),
      http.get('*/api/operations/assignment-versions/7/conflicts/', () =>
        HttpResponse.json([]),
      ),
      http.post('*/api/operations/placement-assignments/1/acknowledge/', () =>
        HttpResponse.json(
          {
            error_code: 'PERMISSION_DENIED',
            message: 'Это не ваше назначение.',
            details: {},
            request_id: null,
            timestamp: new Date().toISOString(),
          },
          { status: 403 },
        ),
      ),
    )
    renderPage('/placement/7')
    const button = await screen.findByRole('button', { name: 'Отметить ознакомление' })

    await userEvent.click(button)

    expect(await screen.findByText('Это не ваше назначение.')).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'Отметить ознакомление' }),
    ).not.toBeDisabled()
  })

  it('AC-4: non-APPROVED version shows no button for unacknowledged assignments', async () => {
    server.use(
      http.get('*/api/operations/assignment-versions/7/', () =>
        HttpResponse.json(
          version({
            status: 'SUBMITTED',
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
      ),
      http.get('*/api/operations/assignment-versions/7/conflicts/', () =>
        HttpResponse.json([]),
      ),
    )
    renderPage('/placement/7')

    await waitFor(() => expect(screen.getByText(EMPLOYEE_A)).toBeInTheDocument())
    expect(
      screen.queryByRole('button', { name: 'Отметить ознакомление' }),
    ).not.toBeInTheDocument()
  })

  it('review: two rows keep independent ack state — acknowledging one does not affect the other', async () => {
    const current = version({
      status: 'APPROVED',
      assignments: [
        {
          id: 1,
          employee_id: EMPLOYEE_A,
          post: 5,
          conflict_severity: 'HARD',
          conflict_codes: ['REST_VIOLATION_CONFLICT'],
          acknowledged_at: null,
          ack_escalated_at: null,
        },
        {
          id: 2,
          employee_id: EMPLOYEE_B,
          post: 6,
          conflict_severity: '',
          conflict_codes: [],
          acknowledged_at: '2026-08-01T10:00:00Z',
          ack_escalated_at: null,
        },
      ],
    })
    server.use(
      http.get('*/api/operations/assignment-versions/7/', () =>
        HttpResponse.json(current),
      ),
      http.get('*/api/operations/assignment-versions/7/conflicts/', () =>
        HttpResponse.json([]),
      ),
      http.post('*/api/operations/placement-assignments/1/acknowledge/', () => {
        ;(current.assignments[0] as Record<string, unknown>).acknowledged_at =
          '2026-08-04T13:00:00Z'
        return HttpResponse.json(current.assignments[0])
      }),
    )
    renderPage('/placement/7')

    // Row B (already acknowledged) never shows a button; row A does.
    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: 'Отметить ознакомление' }),
      ).toBeInTheDocument(),
    )
    expect(
      screen.getByText(new Date('2026-08-01T10:00:00Z').toLocaleString('ru-RU')),
    ).toBeInTheDocument()
    expect(screen.getByText('HARD')).toBeInTheDocument()

    await userEvent.click(
      screen.getByRole('button', { name: 'Отметить ознакомление' }),
    )

    // Row A flips to a timestamp; row B's own (untouched) timestamp survives
    // the whole-table refetch unaffected.
    await waitFor(() =>
      expect(
        screen.getByText(new Date('2026-08-04T13:00:00Z').toLocaleString('ru-RU')),
      ).toBeInTheDocument(),
    )
    expect(
      screen.getByText(new Date('2026-08-01T10:00:00Z').toLocaleString('ru-RU')),
    ).toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: 'Отметить ознакомление' }),
    ).not.toBeInTheDocument()
  })
})

// Story 18.6c: OprosCell — actual-time/service-hours/overload, три
// последовательных шага в одной ячейке.
function versionWithOneAssignment() {
  return {
    id: 9,
    event: 4,
    status: 'APPROVED',
    version: 1,
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
  }
}

describe('PlacementVersionDetailPage — opros (18.6c)', () => {
  it('walks all three opros steps and shows the final overload result', async () => {
    let receivedActualBody: { actual_start_at?: string; actual_end_at?: string } = {}
    server.use(
      http.get('*/api/operations/assignment-versions/9/', () =>
        HttpResponse.json(versionWithOneAssignment()),
      ),
      http.get('*/api/operations/assignment-versions/9/conflicts/', () =>
        HttpResponse.json([]),
      ),
      http.post(
        '*/api/operations/placement-assignments/1/actual-time/',
        async ({ request }) => {
          receivedActualBody = (await request.json()) as typeof receivedActualBody
          return HttpResponse.json({
            id: 1,
            assignment: 1,
            actual_start_at: receivedActualBody.actual_start_at,
            actual_end_at: receivedActualBody.actual_end_at,
            recorded_by: 'user-1',
            created_at: '2026-08-04T18:00:00Z',
            updated_at: '2026-08-04T18:00:00Z',
          })
        },
      ),
      http.post('*/api/operations/placement-assignments/1/service-hours/', () =>
        HttpResponse.json({
          id: 1,
          actual: 1,
          day_hours: '8.00',
          night_hours: '0.00',
          computed_at: '2026-08-04T18:01:00Z',
          is_overloaded: false,
          overload_minutes: '0.00',
        }),
      ),
      http.post('*/api/operations/placement-assignments/1/overload/', () =>
        HttpResponse.json({
          id: 1,
          actual: 1,
          day_hours: '8.00',
          night_hours: '0.00',
          computed_at: '2026-08-04T18:01:00Z',
          is_overloaded: true,
          overload_minutes: '120.00',
        }),
      ),
    )
    const user = userEvent.setup()
    renderPage('/placement/9')
    await waitFor(() => expect(screen.getByText(/Версия 1/)).toBeInTheDocument())

    const startInput = screen.getByLabelText(`Начало факта: ${EMPLOYEE_A}`)
    const endInput = screen.getByLabelText(`Окончание факта: ${EMPLOYEE_A}`)
    await user.click(startInput)
    await user.paste('2026-08-04T09:00')
    await user.click(endInput)
    await user.paste('2026-08-04T17:00')
    await user.click(screen.getByRole('button', { name: 'Записать факт' }))

    // Review-relevant: assert offset-aware ISO, not the raw local string —
    // proves zonedDateTimeToIso() ran, not a bare toISOString() call.
    await waitFor(() =>
      expect(receivedActualBody.actual_start_at).toBe('2026-08-04T04:00:00.000Z'),
    )
    expect(receivedActualBody.actual_end_at).toBe('2026-08-04T12:00:00.000Z')

    await user.click(
      await screen.findByRole('button', { name: 'Вычислить налёт' }),
    )
    expect(await screen.findByText(/8.00 ч. день/)).toBeInTheDocument()

    await user.click(
      screen.getByRole('button', { name: 'Проверить перегрузку' }),
    )

    expect(await screen.findByText(/Перегрузка: да/)).toBeInTheDocument()
    expect(screen.getByText(/\+120.00 мин/)).toBeInTheDocument()
  })

  it('shows an error under the form on actual-time failure and keeps it usable for retry', async () => {
    server.use(
      http.get('*/api/operations/assignment-versions/9/', () =>
        HttpResponse.json(versionWithOneAssignment()),
      ),
      http.get('*/api/operations/assignment-versions/9/conflicts/', () =>
        HttpResponse.json([]),
      ),
      http.post('*/api/operations/placement-assignments/1/actual-time/', () =>
        HttpResponse.json(
          {
            error_code: 'INVALID_LIFECYCLE_TRANSITION',
            message: 'Факт можно записать только после закрытия события.',
            details: {},
            request_id: null,
            timestamp: new Date().toISOString(),
          },
          { status: 422 },
        ),
      ),
    )
    const user = userEvent.setup()
    renderPage('/placement/9')
    await waitFor(() => expect(screen.getByText(/Версия 1/)).toBeInTheDocument())

    const startInput = screen.getByLabelText(`Начало факта: ${EMPLOYEE_A}`)
    const endInput = screen.getByLabelText(`Окончание факта: ${EMPLOYEE_A}`)
    await user.click(startInput)
    await user.paste('2026-08-04T09:00')
    await user.click(endInput)
    await user.paste('2026-08-04T17:00')
    await user.click(screen.getByRole('button', { name: 'Записать факт' }))

    expect(
      await screen.findByText('Факт можно записать только после закрытия события.'),
    ).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Записать факт' })).toBeInTheDocument()
  })

  it('shows an error under the "Вычислить налёт" button on failure without losing step 1', async () => {
    server.use(
      http.get('*/api/operations/assignment-versions/9/', () =>
        HttpResponse.json(versionWithOneAssignment()),
      ),
      http.get('*/api/operations/assignment-versions/9/conflicts/', () =>
        HttpResponse.json([]),
      ),
      http.post('*/api/operations/placement-assignments/1/actual-time/', () =>
        HttpResponse.json({
          id: 1,
          assignment: 1,
          actual_start_at: '2026-08-04T04:00:00Z',
          actual_end_at: '2026-08-04T12:00:00Z',
          recorded_by: 'user-1',
          created_at: '2026-08-04T18:00:00Z',
          updated_at: '2026-08-04T18:00:00Z',
        }),
      ),
      http.post('*/api/operations/placement-assignments/1/service-hours/', () =>
        HttpResponse.json({ error_code: 'ENTITY_NOT_FOUND' }, { status: 404 }),
      ),
    )
    const user = userEvent.setup()
    renderPage('/placement/9')
    await waitFor(() => expect(screen.getByText(/Версия 1/)).toBeInTheDocument())

    const startInput = screen.getByLabelText(`Начало факта: ${EMPLOYEE_A}`)
    const endInput = screen.getByLabelText(`Окончание факта: ${EMPLOYEE_A}`)
    await user.click(startInput)
    await user.paste('2026-08-04T09:00')
    await user.click(endInput)
    await user.paste('2026-08-04T17:00')
    await user.click(screen.getByRole('button', { name: 'Записать факт' }))

    const hoursButton = await screen.findByRole('button', {
      name: 'Вычислить налёт',
    })
    await user.click(hoursButton)

    await waitFor(() => expect(hoursButton).not.toBeDisabled())
    expect(screen.getByRole('button', { name: 'Вычислить налёт' })).toBeInTheDocument()
  })

  it('review (Blind Hunter/Edge Case Hunter): two rows keep independent opros state, no assignmentId mixup', async () => {
    const version = versionWithOneAssignment()
    version.assignments.push({
      id: 2,
      employee_id: EMPLOYEE_B,
      post: 6,
      conflict_severity: '',
      conflict_codes: [],
      acknowledged_at: null,
      ack_escalated_at: null,
    })
    server.use(
      http.get('*/api/operations/assignment-versions/9/', () =>
        HttpResponse.json(version),
      ),
      http.get('*/api/operations/assignment-versions/9/conflicts/', () =>
        HttpResponse.json([]),
      ),
      http.post(
        '*/api/operations/placement-assignments/1/actual-time/',
        () =>
          HttpResponse.json({
            id: 1,
            assignment: 1,
            actual_start_at: '2026-08-04T04:00:00Z',
            actual_end_at: '2026-08-04T12:00:00Z',
            recorded_by: 'user-1',
            created_at: '2026-08-04T18:00:00Z',
            updated_at: '2026-08-04T18:00:00Z',
          }),
      ),
    )
    const user = userEvent.setup()
    renderPage('/placement/9')
    await waitFor(() => expect(screen.getByText(/Версия 1/)).toBeInTheDocument())

    // Advance row A (employee_id=1) to step 2; row B (employee_id=2) must
    // stay on its own untouched step 1 form.
    const startA = screen.getByLabelText(`Начало факта: ${EMPLOYEE_A}`)
    const endA = screen.getByLabelText(`Окончание факта: ${EMPLOYEE_A}`)
    await user.click(startA)
    await user.paste('2026-08-04T09:00')
    await user.click(endA)
    await user.paste('2026-08-04T17:00')
    const buttons = screen.getAllByRole('button', { name: 'Записать факт' })
    await user.click(buttons[0])

    await screen.findByRole('button', { name: 'Вычислить налёт' })
    expect(
      screen.getByLabelText(`Начало факта: ${EMPLOYEE_B}`),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'Записать факт' }),
    ).toBeInTheDocument()
  })
})
