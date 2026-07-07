// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { http, HttpResponse } from 'msw'
import { MemoryRouter, Route, Routes } from 'react-router'
import { apiClient } from '../../shared/api/client'
import { myPermissionsFixture } from '../../shared/api/testing/handlers'
import { server } from '../../shared/api/testing/server'
import { AuthProvider } from '../../shared/auth/AuthContext'
import {
  clearCredential,
  getCredential,
} from '../../shared/auth/credential'
import { RequireAuth } from '../../shared/auth/guards'
import { ROUTES } from '../../shared/routes'
import { EXACTLY_ONE_MESSAGE, LoginPage } from './LoginPage'

afterEach(() => {
  cleanup()
  clearCredential()
  sessionStorage.clear()
})

const USER_ID_LABEL = 'Идентификатор (X-User-Id)'
const JWT_LABEL = 'JWT-токен'
const SUBMIT = 'Войти'

// капчер заголовков — массив, не let (урок 8.4)
function captureHeaders() {
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

function renderLogin(initialEntries: string[] = [ROUTES.login]) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return render(
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <MemoryRouter initialEntries={initialEntries}>
          <Routes>
            <Route path={ROUTES.login} element={<LoginPage />} />
            <Route path={ROUTES.home} element={<p>Дом</p>} />
          </Routes>
        </MemoryRouter>
      </AuthProvider>
    </QueryClientProvider>,
  )
}

describe('zod-валидация «ровно одно» (AC 2)', () => {
  it('оба поля пусты → submit заблокирован, credential не создан', async () => {
    const user = userEvent.setup()
    renderLogin()

    await user.click(screen.getByRole('button', { name: SUBMIT }))

    expect(await screen.findByRole('alert')).toHaveTextContent(
      EXACTLY_ONE_MESSAGE,
    )
    expect(getCredential()).toBeNull()
    expect(screen.queryByText('Дом')).not.toBeInTheDocument()
  })

  it('заполнены ОБА поля → submit заблокирован', async () => {
    const user = userEvent.setup()
    renderLogin()

    await user.type(screen.getByLabelText(USER_ID_LABEL), 'operator-1')
    await user.type(screen.getByLabelText(JWT_LABEL), 'abc.def.ghi')
    await user.click(screen.getByRole('button', { name: SUBMIT }))

    expect(await screen.findByRole('alert')).toHaveTextContent(
      EXACTLY_ONE_MESSAGE,
    )
    expect(getCredential()).toBeNull()
  })
})

describe('вход по идентификатору — dev-путь X-User-Id (AC 1)', () => {
  it('подтверждение КЛАВИАТУРОЙ (Enter, L262): credential сохранён, редирект на /, запросы несут ровно X-User-Id', async () => {
    const captured = captureHeaders()
    const user = userEvent.setup()
    renderLogin()

    await user.type(screen.getByLabelText(USER_ID_LABEL), 'operator-1{enter}')

    expect(await screen.findByText('Дом')).toBeInTheDocument()
    expect(getCredential()).toEqual({ kind: 'dev', userId: 'operator-1' })
    expect(
      JSON.parse(sessionStorage.getItem('vaps.credential')!),
    ).toMatchObject({ kind: 'dev' })

    // MSW-ассерт провода: последующий запрос несёт ровно один auth-заголовок
    await apiClient.get('/api/operations/my-permissions/')
    expect(captured).toEqual([
      { 'x-user-id': 'operator-1', authorization: null },
    ])
  })

  it('подтверждение МЫШЬЮ: тот же результат', async () => {
    const user = userEvent.setup()
    renderLogin()

    await user.type(screen.getByLabelText(USER_ID_LABEL), 'operator-2')
    await user.click(screen.getByRole('button', { name: SUBMIT }))

    expect(await screen.findByText('Дом')).toBeInTheDocument()
    expect(getCredential()).toEqual({ kind: 'dev', userId: 'operator-2' })
  })
})

describe('возврат на исходно запрошенный маршрут (AC 1, 4)', () => {
  it('guard увёл с /secret на вход → после входа вернуло на /secret (state.from)', async () => {
    const user = userEvent.setup()
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    })
    render(
      <QueryClientProvider client={queryClient}>
        <AuthProvider>
          <MemoryRouter initialEntries={['/secret']}>
            <Routes>
              <Route path={ROUTES.login} element={<LoginPage />} />
              <Route
                path="/secret"
                element={
                  <RequireAuth>
                    <p>Секретный контент</p>
                  </RequireAuth>
                }
              />
            </Routes>
          </MemoryRouter>
        </AuthProvider>
      </QueryClientProvider>,
    )

    await user.type(
      await screen.findByLabelText(USER_ID_LABEL),
      'operator-1{enter}',
    )

    expect(await screen.findByText('Секретный контент')).toBeInTheDocument()
  })

  it('вредоносный state.from с protocol-relative путём (//host) игнорируется → домой', async () => {
    // pushState на кросс-origin URL кидает SecurityError в браузере —
    // fromLocationState принимает только внутренние пути (фикс ревью 8.6)
    const user = userEvent.setup()
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    })
    render(
      <QueryClientProvider client={queryClient}>
        <AuthProvider>
          <MemoryRouter
            initialEntries={[
              {
                pathname: ROUTES.login,
                state: { from: { pathname: '//evil.example' } },
              },
            ]}
          >
            <Routes>
              <Route path={ROUTES.login} element={<LoginPage />} />
              <Route path={ROUTES.home} element={<p>Дом</p>} />
            </Routes>
          </MemoryRouter>
        </AuthProvider>
      </QueryClientProvider>,
    )

    await user.type(screen.getByLabelText(USER_ID_LABEL), 'operator-1{enter}')

    expect(await screen.findByText('Дом')).toBeInTheDocument()
  })
})

describe('вход по JWT (AC 2)', () => {
  it('запросы несут Authorization: Bearer и НЕ несут X-User-Id (JWT приоритетен)', async () => {
    const captured = captureHeaders()
    const user = userEvent.setup()
    renderLogin()

    await user.click(screen.getByLabelText(JWT_LABEL))
    await user.paste('eyJ.header.payload')
    await user.click(screen.getByRole('button', { name: SUBMIT }))

    expect(await screen.findByText('Дом')).toBeInTheDocument()
    expect(getCredential()).toEqual({ kind: 'jwt', token: 'eyJ.header.payload' })

    await apiClient.get('/api/operations/my-permissions/')
    expect(captured).toEqual([
      { 'x-user-id': null, authorization: 'Bearer eyJ.header.payload' },
    ])
  })
})
