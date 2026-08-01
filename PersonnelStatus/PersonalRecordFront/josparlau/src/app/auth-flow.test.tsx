// @vitest-environment jsdom
// E2E-уровень стека (прецедент QA 8.5): auth-флоу 8.6 через РЕАЛЬНУЮ
// app-композицию Providers (QueryCache/MutationCache onError → handle401,
// AuthProvider, ToastProvider) — login → запрос с заголовком → 401 →
// credential очищен → на /login; 403 → остаёмся, credential цел (AC 1, 3, 6).
import '@testing-library/jest-dom/vitest'
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { MemoryRouter, Route, Routes } from 'react-router'
import { LoginPage } from '../features/auth/LoginPage'
import { apiClient } from '../shared/api/client'
import { useApiMutation } from '../shared/api/useApiMutation'
import {
  adminPermissionsFixture,
  authRequiredEnvelope,
  myPermissionsFixture,
  permissionDeniedEnvelope,
} from '../shared/api/testing/handlers'
import { server } from '../shared/api/testing/server'
import { useAuth } from '../shared/auth/AuthContext'
import {
  ACCESS_DENIED_TEXT,
  RequireAuth,
  RequirePermission,
} from '../shared/auth/guards'
import {
  clearCredential,
  getCredential,
  setCredential,
  authHeaders,
} from '../shared/auth/credential'
import { ROUTES } from '../shared/routes'
import { AppRoutes } from './App'
import { createQueryClient, Providers } from './providers'

afterEach(() => {
  cleanup()
  clearCredential()
  sessionStorage.clear()
})

const SECRET = 'Секретный контент'
type Body = Record<string, unknown>

function captureMyPermissions() {
  const captured: Array<{
    'x-user-id': string | null
    authorization: string | null
  }> = []
  server.use(
    http.get('*/api/operations/my-permissions/', ({ request }) => {
      captured.push({
        'x-user-id': request.headers.get('x-user-id'),
        authorization: request.headers.get('authorization'),
      })
      return HttpResponse.json(myPermissionsFixture)
    }),
  )
  return captured
}

// Мини-экран «как в E9»: контент за RequirePermission + мутация фичи
function ProbeScreen() {
  const mutation = useApiMutation<Body, Body>({
    mutationFn: (vars) =>
      apiClient.post<Body>('/api/operations/temporary-duty/', vars),
  })
  return (
    <main>
      <h1>Проба</h1>
      <RequirePermission permission="status.view">
        <p>{SECRET}</p>
      </RequirePermission>
      <button type="button" onClick={() => mutation.mutate({})}>
        Мутация
      </button>
    </main>
  )
}

function renderProbeApp() {
  return render(
    <Providers>
      <MemoryRouter initialEntries={[ROUTES.home]}>
        <Routes>
          <Route path={ROUTES.login} element={<LoginPage />} />
          <Route
            path={ROUTES.home}
            element={
              <RequireAuth>
                <ProbeScreen />
              </RequireAuth>
            }
          />
        </Routes>
      </MemoryRouter>
    </Providers>,
  )
}

describe('E2E: вход → права → защищённый контент (AC 1, 3, 4)', () => {
  it('не залогинен: /login без запросов; после входа — контент и X-User-Id на проводе', async () => {
    const captured = captureMyPermissions()
    const user = userEvent.setup()
    renderProbeApp()

    // guard увёл на форму входа ДО любых запросов
    expect(
      await screen.findByLabelText('Идентификатор (X-User-Id)'),
    ).toBeInTheDocument()
    expect(captured).toHaveLength(0)

    await user.type(
      screen.getByLabelText('Идентификатор (X-User-Id)'),
      'operator-1{enter}',
    )

    // возврат на исходный маршрут; ['me'] загрузился, право есть
    expect(await screen.findByText(SECRET)).toBeInTheDocument()
    expect(captured).toEqual([
      { 'x-user-id': 'operator-1', authorization: null },
    ])
  })

  it('реальный AppRoutes: вход по ID открывает Home-заглушку', async () => {
    captureMyPermissions()
    const user = userEvent.setup()
    render(
      <Providers>
        <MemoryRouter initialEntries={[ROUTES.home]}>
          <AppRoutes />
        </MemoryRouter>
      </Providers>,
    )

    await user.type(
      await screen.findByLabelText('Идентификатор (X-User-Id)'),
      'operator-1{enter}',
    )
    expect(await screen.findByText('PersonnelStatus')).toBeInTheDocument()
  })
})

describe('E2E: 401 — глобальный logout; 403 — нет (AC 6)', () => {
  it('mutation → 401 AUTH_REQUIRED: credential очищен, RequireAuth реактивно уводит на /login', async () => {
    captureMyPermissions()
    server.use(
      http.post('*/api/operations/temporary-duty/', () =>
        HttpResponse.json(authRequiredEnvelope, { status: 401 }),
      ),
    )
    const user = userEvent.setup()
    // протухшая сессия из storage (переживший F5 credential, AC 1)
    setCredential({ kind: 'jwt', token: 'stale.jwt.token' })
    renderProbeApp()

    expect(await screen.findByText(SECRET)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Мутация' }))

    // молчаливый возврат на вход (UX L202), без window.location
    expect(
      await screen.findByLabelText('Идентификатор (X-User-Id)'),
    ).toBeInTheDocument()
    expect(getCredential()).toBeNull()
    expect(authHeaders).toEqual({})
    expect(sessionStorage.getItem('vaps.credential')).toBeNull()
  })

  it('mutation → 403 PERMISSION_DENIED: НЕТ ни редиректа, ни очистки credential', async () => {
    captureMyPermissions()
    server.use(
      http.post('*/api/operations/temporary-duty/', () =>
        HttpResponse.json(permissionDeniedEnvelope, { status: 403 }),
      ),
    )
    const user = userEvent.setup()
    setCredential({ kind: 'dev', userId: 'operator-1' })
    renderProbeApp()

    expect(await screen.findByText(SECRET)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Мутация' }))

    // ошибка осталась фиче (mutation.error), экран не сменился
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(screen.getByText(SECRET)).toBeInTheDocument()
    expect(
      screen.queryByLabelText('Идентификатор (X-User-Id)'),
    ).not.toBeInTheDocument()
    expect(getCredential()).toEqual({ kind: 'dev', userId: 'operator-1' })
  })
})

describe('E2E: повторный login() другим пользователем без logout (AC 3, фикс ревью 8.6)', () => {
  // Смена credential НЕ меняет queryKey ['me'] — без сброса кэш прежнего
  // пользователя пережил бы вход нового (login() обязан removeQueries)
  function SwitchProbe() {
    const { login } = useAuth()
    return (
      <main>
        <RequirePermission permission="audit.view">
          <p>{SECRET}</p>
        </RequirePermission>
        <button
          type="button"
          onClick={() => login({ kind: 'dev', userId: 'admin-1' })}
        >
          Сменить пользователя
        </button>
      </main>
    )
  }

  it('login() сбрасывает [me]: права прежнего пользователя не переживают смену credential', async () => {
    server.use(
      http.get('*/api/operations/my-permissions/', ({ request }) =>
        HttpResponse.json(
          request.headers.get('x-user-id') === 'admin-1'
            ? adminPermissionsFixture
            : myPermissionsFixture,
        ),
      ),
    )
    const user = userEvent.setup()
    setCredential({ kind: 'dev', userId: 'operator-1' })
    render(
      <Providers>
        <MemoryRouter initialEntries={[ROUTES.home]}>
          <Routes>
            <Route path={ROUTES.login} element={<LoginPage />} />
            <Route
              path={ROUTES.home}
              element={
                <RequireAuth>
                  <SwitchProbe />
                </RequireAuth>
              }
            />
          </Routes>
        </MemoryRouter>
      </Providers>,
    )

    // у operator-1 нет audit.view — отказ на его правах
    expect(await screen.findByText(ACCESS_DENIED_TEXT)).toBeInTheDocument()

    await user.click(
      screen.getByRole('button', { name: 'Сменить пользователя' }),
    )

    // [me] сброшен и перезапрошен с НОВЫМ заголовком → права админа (`*`)
    expect(await screen.findByText(SECRET)).toBeInTheDocument()
    expect(screen.queryByText(ACCESS_DENIED_TEXT)).not.toBeInTheDocument()
  })
})

describe('createQueryClient: handle401 на ОБОИХ кэшах (AC 6, Ловушка 3)', () => {
  it('QueryCache onError: 401 чистит credential и сбрасывает [me] (removeQueries, не invalidate)', async () => {
    const client = createQueryClient()
    setCredential({ kind: 'jwt', token: 'stale.jwt.token' })
    client.setQueryData(['me'], myPermissionsFixture)
    server.use(
      http.get('*/api/operations/my-permissions/', () =>
        HttpResponse.json(authRequiredEnvelope, { status: 401 }),
      ),
    )

    await expect(
      client.fetchQuery({
        queryKey: ['probe-401'],
        queryFn: () =>
          apiClient.get('/api/operations/my-permissions/'),
        retry: false,
      }),
    ).rejects.toMatchObject({ status: 401, errorCode: 'AUTH_REQUIRED' })

    await waitFor(() => expect(getCredential()).toBeNull())
    expect(client.getQueryData(['me'])).toBeUndefined()
  })

  it('QueryCache onError: 403 НЕ трогает ни credential, ни кэш [me]', async () => {
    const client = createQueryClient()
    setCredential({ kind: 'dev', userId: 'operator-1' })
    client.setQueryData(['me'], myPermissionsFixture)
    server.use(
      http.get('*/api/operations/my-permissions/', () =>
        HttpResponse.json(permissionDeniedEnvelope, { status: 403 }),
      ),
    )

    await expect(
      client.fetchQuery({
        queryKey: ['probe-403'],
        queryFn: () =>
          apiClient.get('/api/operations/my-permissions/'),
        retry: false,
      }),
    ).rejects.toMatchObject({ status: 403, errorCode: 'PERMISSION_DENIED' })

    expect(getCredential()).toEqual({ kind: 'dev', userId: 'operator-1' })
    expect(client.getQueryData(['me'])).toEqual(myPermissionsFixture)
  })
})
