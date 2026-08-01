// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { delay, http, HttpResponse } from 'msw'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router'
import type { ReactNode } from 'react'
import {
  adminPermissionsFixture,
  myPermissionsFixture,
  permissionDeniedEnvelope,
  serverEnvelope,
} from '../api/testing/handlers'
import { server } from '../api/testing/server'
import { ROUTES } from '../routes'
import { AuthProvider } from './AuthContext'
import { clearCredential, setCredential } from './credential'
import {
  ACCESS_DENIED_TEXT,
  PERMISSIONS_ERROR_TEXT,
  RequireAuth,
  RequirePermission,
} from './guards'

afterEach(() => {
  cleanup()
  clearCredential()
  sessionStorage.clear()
})

const SECRET = 'Секретный контент'

function captureRequests(fixture = myPermissionsFixture) {
  const captured: Array<Record<string, unknown>> = []
  server.use(
    http.get('*/api/operations/my-permissions/', ({ request }) => {
      captured.push({ url: request.url })
      return HttpResponse.json(fixture)
    }),
  )
  return captured
}

// маркер /login: показывает, откуда нас увело (state.from, Ловушка 12)
function LoginMarker() {
  const location = useLocation()
  const state: unknown = location.state
  const from =
    typeof state === 'object' && state !== null && 'from' in state
      ? ((state as { from?: { pathname?: unknown } }).from?.pathname ?? null)
      : null
  return <p>login-marker:{typeof from === 'string' ? from : 'нет'}</p>
}

function renderRouted(initialEntries: string[], secretElement: ReactNode) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return render(
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <MemoryRouter initialEntries={initialEntries}>
          <Routes>
            <Route path={ROUTES.login} element={<LoginMarker />} />
            <Route path="/secret" element={secretElement} />
          </Routes>
        </MemoryRouter>
      </AuthProvider>
    </QueryClientProvider>,
  )
}

describe('RequireAuth (AC 4)', () => {
  it('нет credential → Navigate на /login c state.from БЕЗ единого сетевого запроса', async () => {
    const captured = captureRequests()
    // внутри — потребитель ['me']: докажем, что он даже не монтируется
    renderRouted(
      ['/secret'],
      <RequireAuth>
        <RequirePermission permission="status.view">
          <p>{SECRET}</p>
        </RequirePermission>
      </RequireAuth>,
    )

    expect(await screen.findByText('login-marker:/secret')).toBeInTheDocument()
    expect(screen.queryByText(SECRET)).not.toBeInTheDocument()
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(captured).toHaveLength(0)
  })

  it('есть credential → children рендерятся без редиректа', async () => {
    setCredential({ kind: 'dev', userId: 'operator-1' })
    renderRouted(
      ['/secret'],
      <RequireAuth>
        <p>{SECRET}</p>
      </RequireAuth>,
    )

    expect(await screen.findByText(SECRET)).toBeInTheDocument()
    expect(screen.queryByText(/login-marker/)).not.toBeInTheDocument()
  })

  // «вход выполнен → возврат на state.from» живёт в LoginPage.test.tsx:
  // импорт LoginPage сюда запрещён матрицей слоёв (shared ↛ features)
})

describe('RequirePermission (AC 5)', () => {
  function renderGuardedByPermission(permission: string) {
    setCredential({ kind: 'dev', userId: 'operator-1' })
    return renderRouted(
      ['/secret'],
      <RequireAuth>
        <RequirePermission permission={permission}>
          <p>{SECRET}</p>
        </RequirePermission>
      </RequireAuth>,
    )
  }

  it('право есть в [me] → children', async () => {
    captureRequests() // status.view есть в фикстуре
    renderGuardedByPermission('status.view')

    expect(await screen.findByText(SECRET)).toBeInTheDocument()
    expect(screen.queryByText(ACCESS_DENIED_TEXT)).not.toBeInTheDocument()
  })

  it('права нет (и нет `*`) → headless «Доступ запрещён», children НЕ рендерятся', async () => {
    captureRequests() // audit.view в фикстуре отсутствует
    renderGuardedByPermission('audit.view')

    expect(await screen.findByText(ACCESS_DENIED_TEXT)).toBeInTheDocument()
    expect(screen.queryByText(SECRET)).not.toBeInTheDocument()
  })

  it('wildcard `*` (ADMIN) открывает любой маршрут', async () => {
    captureRequests(adminPermissionsFixture)
    renderGuardedByPermission('audit.view')

    expect(await screen.findByText(SECRET)).toBeInTheDocument()
  })

  it('пока [me] грузится — контент НЕ рендерится (индикация — состояние Query)', async () => {
    server.use(
      http.get('*/api/operations/my-permissions/', async () => {
        await delay(150)
        return HttpResponse.json(myPermissionsFixture)
      }),
    )
    renderGuardedByPermission('status.view')

    // во время загрузки: ни children, ни отказа
    expect(screen.getByRole('status')).toHaveTextContent('Загрузка…')
    expect(screen.queryByText(SECRET)).not.toBeInTheDocument()
    expect(screen.queryByText(ACCESS_DENIED_TEXT)).not.toBeInTheDocument()

    expect(await screen.findByText(SECRET)).toBeInTheDocument()
  })

  it('сбой загрузки [me] (500) → «Не удалось проверить права», НЕ «Доступ запрещён» (deny ≠ fail)', async () => {
    server.use(
      http.get('*/api/operations/my-permissions/', () =>
        HttpResponse.json(serverEnvelope, { status: 500 }),
      ),
    )
    renderGuardedByPermission('status.view')

    expect(await screen.findByRole('alert')).toHaveTextContent(
      PERMISSIONS_ERROR_TEXT,
    )
    expect(screen.queryByText(ACCESS_DENIED_TEXT)).not.toBeInTheDocument()
    expect(screen.queryByText(SECRET)).not.toBeInTheDocument()
  })

  it('403 с провода на [me] (defence-in-depth) → «Доступ запрещён» — это отказ, не сбой', async () => {
    server.use(
      http.get('*/api/operations/my-permissions/', () =>
        HttpResponse.json(permissionDeniedEnvelope, { status: 403 }),
      ),
    )
    renderGuardedByPermission('status.view')

    expect(await screen.findByText(ACCESS_DENIED_TEXT)).toBeInTheDocument()
    expect(screen.queryByText(PERMISSIONS_ERROR_TEXT)).not.toBeInTheDocument()
    expect(screen.queryByText(SECRET)).not.toBeInTheDocument()
  })
})
