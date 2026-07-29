// @vitest-environment jsdom
// Story 13.1b — open dialog, fill, submit, success/error paths, auto-context.
import '@testing-library/jest-dom/vitest'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { http, HttpResponse } from 'msw'
import { MemoryRouter } from 'react-router'
import { server } from '../api/testing/server'
import { ToastProvider } from './toast'
import { GENERIC_FAILURE_MESSAGE } from '../api/useApiMutation'
import { clearCredential, setCredential } from '../auth/credential'
import { resetRecentRequestIds } from '../api/recentRequestIds'
import { BugReportButton } from './BugReportButton'

// jsdom 29 НЕ реализует методы <dialog> (see ConflictDialog.test.tsx's own
// identical shim — open-семантика only, no top-layer/focus-trap).
if (typeof HTMLDialogElement.prototype.showModal !== 'function') {
  HTMLDialogElement.prototype.showModal = function (this: HTMLDialogElement) {
    this.open = true
  }
  HTMLDialogElement.prototype.close = function (this: HTMLDialogElement) {
    this.open = false
    this.dispatchEvent(new Event('close'))
  }
}

const DEV_CREDENTIAL = { kind: 'dev', userId: 'operator-1' } as const

function renderButton(initialPath = '/daily-update') {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  return render(
    <QueryClientProvider client={client}>
      <ToastProvider>
        <MemoryRouter initialEntries={[initialPath]}>
          <BugReportButton />
        </MemoryRouter>
      </ToastProvider>
    </QueryClientProvider>,
  )
}

describe('BugReportButton', () => {
  beforeEach(() => {
    setCredential(DEV_CREDENTIAL)
    resetRecentRequestIds()
  })

  afterEach(() => {
    clearCredential()
    cleanup()
  })

  it('opens the dialog, submits, and shows a success toast', async () => {
    let capturedBody: unknown = null
    server.use(
      http.post('/api/bugreports/', async ({ request }) => {
        capturedBody = await request.json()
        return HttpResponse.json(
          {
            id: 1,
            user_id: 'operator-1',
            screen_path: '/daily-update',
            app_version: 'test',
            build_sha: 'abc',
            last_request_ids: [],
            description: 'кнопка не работает',
            created_at: '2026-07-29T09:00:00+05:00',
          },
          { status: 201 },
        )
      }),
    )

    const user = userEvent.setup()
    renderButton('/daily-update')

    await user.click(screen.getByRole('button', { name: 'Сообщить о проблеме' }))
    const textarea = screen.getByLabelText('Что произошло')
    await user.type(textarea, 'кнопка не работает')
    await user.click(screen.getByRole('button', { name: 'Отправить' }))

    await waitFor(() => {
      expect(screen.getByText('Спасибо, репорт отправлен.')).toBeInTheDocument()
    })

    expect(capturedBody).toMatchObject({
      screen_path: '/daily-update',
      description: 'кнопка не работает',
    })
  })

  it('keeps the dialog open and the text intact on a server error (global toast, no duplicate inline alert)', async () => {
    // Review (Blind Hunter): useApiMutation's onError already fires a
    // GLOBAL toast for ServerError — an inline dialog alert on TOP of that
    // would say the same thing twice. This test pins the fix: exactly the
    // global toast, no role="alert" inside the dialog.
    server.use(
      http.post('/api/bugreports/', () =>
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

    const user = userEvent.setup()
    renderButton()

    await user.click(screen.getByRole('button', { name: 'Сообщить о проблеме' }))
    const textarea = screen.getByLabelText('Что произошло')
    await user.type(textarea, 'текст не должен потеряться')
    await user.click(screen.getByRole('button', { name: 'Отправить' }))

    await waitFor(() => {
      expect(screen.getByText(GENERIC_FAILURE_MESSAGE)).toBeInTheDocument()
    })
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(screen.getByLabelText('Что произошло')).toHaveValue(
      'текст не должен потеряться',
    )
  })

  it('surfaces a network failure the same way (global toast, dialog stays open)', async () => {
    server.use(http.post('/api/bugreports/', () => HttpResponse.error()))

    const user = userEvent.setup()
    renderButton()

    await user.click(screen.getByRole('button', { name: 'Сообщить о проблеме' }))
    await user.type(screen.getByLabelText('Что произошло'), 'сеть недоступна')
    await user.click(screen.getByRole('button', { name: 'Отправить' }))

    await waitFor(() => {
      expect(screen.getByText(GENERIC_FAILURE_MESSAGE)).toBeInTheDocument()
    })
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(screen.getByLabelText('Что произошло')).toHaveValue('сеть недоступна')
  })

  it('shows an inline field alert for a non-server error (e.g. 400)', async () => {
    server.use(
      http.post('/api/bugreports/', () =>
        HttpResponse.json(
          {
            error_code: 'VALIDATION_ERROR',
            message: 'x',
            details: { description: ['обязательное поле'] },
            request_id: null,
            timestamp: '2026-07-29T09:00:00+05:00',
          },
          { status: 400 },
        ),
      ),
    )

    const user = userEvent.setup()
    renderButton()

    await user.click(screen.getByRole('button', { name: 'Сообщить о проблеме' }))
    await user.type(screen.getByLabelText('Что произошло'), 'x')
    await user.click(screen.getByRole('button', { name: 'Отправить' }))

    await waitFor(() => {
      expect(screen.getByRole('alert')).toBeInTheDocument()
    })
    expect(screen.getByLabelText('Что произошло')).toHaveAttribute(
      'aria-invalid',
      'true',
    )
  })

  it('disables submit until the description is non-empty', async () => {
    const user = userEvent.setup()
    renderButton()
    await user.click(screen.getByRole('button', { name: 'Сообщить о проблеме' }))
    expect(screen.getByRole('button', { name: 'Отправить' })).toBeDisabled()
    await user.type(screen.getByLabelText('Что произошло'), '  ')
    expect(screen.getByRole('button', { name: 'Отправить' })).toBeDisabled()
    await user.type(screen.getByLabelText('Что произошло'), 'x')
    expect(screen.getByRole('button', { name: 'Отправить' })).toBeEnabled()
  })
})
