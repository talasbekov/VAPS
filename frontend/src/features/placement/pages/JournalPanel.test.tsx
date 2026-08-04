// @vitest-environment jsdom
// Story 17.7c: JournalPanel — list/empty-state/create/403-view/403-create/
// empty-text-validation.
import '@testing-library/jest-dom/vitest'
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { server } from '../../../shared/api/testing/server'
import { ToastProvider } from '../../../shared/ui/toast'
import { JournalPanel } from './JournalPanel'

afterEach(cleanup)

function renderPanel(eventId = 1) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <JournalPanel eventId={eventId} />
      </ToastProvider>
    </QueryClientProvider>,
  )
}

describe('JournalPanel', () => {
  it('renders the journal list from the real endpoint', async () => {
    server.use(
      http.get('*/api/operations/security-events/1/journal-entries/', () =>
        HttpResponse.json([
          {
            id: 1,
            event: 1,
            entry_type: 'BRIEFING',
            text: 'Инструктаж проведён.',
            post: null,
            participant_ids: [],
            photo_attachment_id: null,
            created_by: 'user-1',
            created_at: '2026-08-01T09:00:00Z',
          },
        ]),
      ),
    )

    renderPanel()

    expect(await screen.findByText('Инструктаж проведён.')).toBeInTheDocument()
  })

  it('shows an empty state, not an error, when there are no entries', async () => {
    server.use(
      http.get('*/api/operations/security-events/1/journal-entries/', () =>
        HttpResponse.json([]),
      ),
    )

    renderPanel()

    expect(await screen.findByText('Записей пока нет.')).toBeInTheDocument()
  })

  it('submits the form and the new entry appears in the list', async () => {
    const user = userEvent.setup()
    let created: { id: number; entry_type: string; text: string } | null = null
    server.use(
      http.get('*/api/operations/security-events/1/journal-entries/', () =>
        HttpResponse.json(
          created === null
            ? []
            : [
                {
                  id: created.id,
                  event: 1,
                  entry_type: created.entry_type,
                  text: created.text,
                  post: null,
                  participant_ids: [],
                  photo_attachment_id: null,
                  created_by: 'user-1',
                  created_at: '2026-08-01T10:00:00Z',
                },
              ],
        ),
      ),
      http.post(
        '*/api/operations/security-events/1/journal-entries/',
        async ({ request }) => {
          const body = (await request.json()) as { entry_type: string; text: string }
          created = { id: 99, entry_type: body.entry_type, text: body.text }
          return HttpResponse.json(
            {
              id: 99,
              event: 1,
              entry_type: body.entry_type,
              text: body.text,
              post: null,
              participant_ids: [],
              photo_attachment_id: null,
              created_by: 'user-1',
              created_at: '2026-08-01T10:00:00Z',
            },
            { status: 201 },
          )
        },
      ),
    )

    renderPanel()
    await screen.findByText('Записей пока нет.')

    await user.type(screen.getByPlaceholderText('Текст записи'), 'Новая запись')
    await user.click(screen.getByRole('button', { name: 'Добавить запись' }))

    expect(await screen.findByText('Новая запись')).toBeInTheDocument()
    await waitFor(() => {
      expect(screen.getByPlaceholderText('Текст записи')).toHaveValue('')
    })
  })

  it('shows an access-denied state instead of crashing when listing is forbidden (403)', async () => {
    server.use(
      http.get('*/api/operations/security-events/1/journal-entries/', () =>
        HttpResponse.json({ error_code: 'PERMISSION_DENIED' }, { status: 403 }),
      ),
    )

    renderPanel()

    expect(await screen.findByText('Нет доступа.')).toBeInTheDocument()
  })

  it('hides the form and shows a message when create is forbidden (403)', async () => {
    const user = userEvent.setup()
    server.use(
      http.get('*/api/operations/security-events/1/journal-entries/', () =>
        HttpResponse.json([]),
      ),
      http.post('*/api/operations/security-events/1/journal-entries/', () =>
        HttpResponse.json({ error_code: 'PERMISSION_DENIED' }, { status: 403 }),
      ),
    )

    renderPanel()
    await screen.findByText('Записей пока нет.')

    await user.type(screen.getByPlaceholderText('Текст записи'), 'x')
    await user.click(screen.getByRole('button', { name: 'Добавить запись' }))

    expect(await screen.findByText('Нет права на добавление записей.')).toBeInTheDocument()
    expect(screen.queryByPlaceholderText('Текст записи')).not.toBeInTheDocument()
  })

  it('review (Blind Hunter + Edge Case Hunter + Acceptance Auditor): a "Повторить" button resets the 403 and brings the form back', async () => {
    const user = userEvent.setup()
    server.use(
      http.get('*/api/operations/security-events/1/journal-entries/', () =>
        HttpResponse.json([]),
      ),
      http.post('*/api/operations/security-events/1/journal-entries/', () =>
        HttpResponse.json({ error_code: 'PERMISSION_DENIED' }, { status: 403 }),
      ),
    )

    renderPanel()
    await screen.findByText('Записей пока нет.')
    await user.type(screen.getByPlaceholderText('Текст записи'), 'x')
    await user.click(screen.getByRole('button', { name: 'Добавить запись' }))
    await screen.findByText('Нет права на добавление записей.')

    await user.click(screen.getByRole('button', { name: 'Повторить' }))

    expect(screen.getByPlaceholderText('Текст записи')).toBeInTheDocument()
    expect(screen.queryByText('Нет права на добавление записей.')).not.toBeInTheDocument()
  })

  it('review (Acceptance Auditor): a non-403 list error shows the generic alert, not "Нет доступа" (branch discrimination)', async () => {
    server.use(
      http.get('*/api/operations/security-events/1/journal-entries/', () =>
        HttpResponse.json({ error_code: 'SERVER_ERROR' }, { status: 500 }),
      ),
    )

    renderPanel()

    expect(await screen.findByText('Не удалось загрузить журнал.')).toBeInTheDocument()
    expect(screen.queryByText('Нет доступа.')).not.toBeInTheDocument()
  })

  it('review (Acceptance Auditor): a 422 lifecycle error (event not IN_PROGRESS) surfaces via the generic mutation-error text', async () => {
    const user = userEvent.setup()
    server.use(
      http.get('*/api/operations/security-events/1/journal-entries/', () =>
        HttpResponse.json([]),
      ),
      http.post('*/api/operations/security-events/1/journal-entries/', () =>
        HttpResponse.json(
          {
            error_code: 'INVALID_LIFECYCLE_TRANSITION',
            message: 'Событие не в статусе IN_PROGRESS.',
            details: {},
            request_id: null,
            timestamp: new Date().toISOString(),
          },
          { status: 422 },
        ),
      ),
    )

    renderPanel()
    await screen.findByText('Записей пока нет.')
    await user.type(screen.getByPlaceholderText('Текст записи'), 'x')
    await user.click(screen.getByRole('button', { name: 'Добавить запись' }))

    expect(
      await screen.findByText('Событие не в статусе IN_PROGRESS.'),
    ).toBeInTheDocument()
    expect(screen.getByPlaceholderText('Текст записи')).toBeInTheDocument()
  })

  it('review (Blind Hunter): renders entries in the order the API returns them (3+ items, non-vacuous)', async () => {
    server.use(
      http.get('*/api/operations/security-events/1/journal-entries/', () =>
        HttpResponse.json([
          {
            id: 3,
            event: 1,
            entry_type: 'BRIEFING',
            text: 'Третья по времени, первая в ответе',
            post: null,
            participant_ids: [],
            photo_attachment_id: null,
            created_by: 'user-1',
            created_at: '2026-08-01T11:00:00Z',
          },
          {
            id: 1,
            event: 1,
            entry_type: 'DIRECTIVE',
            text: 'Первая по времени, вторая в ответе',
            post: null,
            participant_ids: [],
            photo_attachment_id: null,
            created_by: 'user-1',
            created_at: '2026-08-01T09:00:00Z',
          },
          {
            id: 2,
            event: 1,
            entry_type: 'BRIEFING',
            text: 'Вторая по времени, третья в ответе',
            post: null,
            participant_ids: [],
            photo_attachment_id: null,
            created_by: 'user-1',
            created_at: '2026-08-01T10:00:00Z',
          },
        ]),
      ),
    )

    renderPanel()
    await screen.findByText('Третья по времени, первая в ответе')

    const items = screen.getAllByRole('listitem')
    expect(items.map((item) => item.textContent)).toEqual([
      expect.stringContaining('Третья по времени, первая в ответе'),
      expect.stringContaining('Первая по времени, вторая в ответе'),
      expect.stringContaining('Вторая по времени, третья в ответе'),
    ])
  })

  it('submits a DIRECTIVE entry_type (not just the BRIEFING default)', async () => {
    const user = userEvent.setup()
    let receivedType: string | undefined
    server.use(
      http.get('*/api/operations/security-events/1/journal-entries/', () =>
        HttpResponse.json([]),
      ),
      http.post(
        '*/api/operations/security-events/1/journal-entries/',
        async ({ request }) => {
          const body = (await request.json()) as { entry_type: string; text: string }
          receivedType = body.entry_type
          return HttpResponse.json(
            {
              id: 5,
              event: 1,
              entry_type: body.entry_type,
              text: body.text,
              post: null,
              participant_ids: [],
              photo_attachment_id: null,
              created_by: 'user-1',
              created_at: '2026-08-01T10:00:00Z',
            },
            { status: 201 },
          )
        },
      ),
    )

    renderPanel()
    await screen.findByText('Записей пока нет.')

    await user.selectOptions(screen.getByRole('combobox'), 'DIRECTIVE')
    await user.type(screen.getByPlaceholderText('Текст записи'), 'Указание участникам')
    await user.click(screen.getByRole('button', { name: 'Добавить запись' }))

    await waitFor(() => expect(receivedType).toBe('DIRECTIVE'))
  })

  it('blocks submit on empty text via client-side validation', async () => {
    const user = userEvent.setup()
    server.use(
      http.get('*/api/operations/security-events/1/journal-entries/', () =>
        HttpResponse.json([]),
      ),
    )
    let postCalled = false
    server.use(
      http.post('*/api/operations/security-events/1/journal-entries/', () => {
        postCalled = true
        return HttpResponse.json({}, { status: 201 })
      }),
    )

    renderPanel()
    await screen.findByText('Записей пока нет.')

    await user.click(screen.getByRole('button', { name: 'Добавить запись' }))

    expect(await screen.findByText('Обязательное поле')).toBeInTheDocument()
    expect(postCalled).toBe(false)
  })
})
