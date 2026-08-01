// @vitest-environment jsdom
// QA-дополнение E2E 8.6 (bmad-qa-generate-e2e-tests, прецедент QA 8.5):
// пробелы поверх auth-flow.test.tsx — через РЕАЛЬНУЮ композицию Providers:
// logout()-механика (нулевое покрытие в стори), JWT-вход на проводе,
// 401 на query при старте с протухшим токеном (цена Д10), remount-«F5»,
// deny-ветка RequirePermission по полному флоу входа с возвратом на state.from.
import '@testing-library/jest-dom/vitest'
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { MemoryRouter, Route, Routes } from 'react-router'
import { useQueryClient } from '@tanstack/react-query'
import type { QueryClient } from '@tanstack/react-query'
import { LoginPage } from '../features/auth/LoginPage'
import {
  authRequiredEnvelope,
  myPermissionsFixture,
} from '../shared/api/testing/handlers'
import { server } from '../shared/api/testing/server'
import { useAuth } from '../shared/auth/AuthContext'
import {
  authHeaders,
  clearCredential,
  getCredential,
  setCredential,
} from '../shared/auth/credential'
import {
  ACCESS_DENIED_TEXT,
  RequireAuth,
  RequirePermission,
} from '../shared/auth/guards'
import { ROUTES } from '../shared/routes'
import { Providers } from './providers'

const spiedClients: QueryClient[] = []

afterEach(() => {
  cleanup()
  clearCredential()
  sessionStorage.clear()
  spiedClients.length = 0
})

const SECRET = 'Секретный контент'
const USER_ID_LABEL = 'Идентификатор (X-User-Id)'
const JWT_LABEL = 'JWT-токен'
const PROBE_PATH = '/probe'

// капчер заголовков — массив, не let (урок 8.4)
function captureMyPermissions(
  respond: () => Response = () => HttpResponse.json(myPermissionsFixture),
) {
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
      return respond()
    }),
  )
  return captured
}

// Шпион за QueryClient, созданным ВНУТРИ Providers (снаружи он недоступен):
// нужен ассертам removeQueries(['me']) в logout-тесте
function QueryClientSpy() {
  const client = useQueryClient()
  if (!spiedClients.includes(client)) {
    spiedClients.push(client)
  }
  return null
}

// Мини-экран «как в E9»: контент за RequirePermission + кнопка logout()
// (кнопки в UI нет до 8.7 — механика вызывается как будущий сайдбар)
function ProbeScreen({ permission }: { permission: string }) {
  const { logout } = useAuth()
  return (
    <main>
      <h1>Проба</h1>
      <RequirePermission permission={permission}>
        <p>{SECRET}</p>
      </RequirePermission>
      <button type="button" onClick={logout}>
        Выйти
      </button>
    </main>
  )
}

function renderApp({
  permission = 'status.view',
  initialEntries = [PROBE_PATH],
}: { permission?: string; initialEntries?: string[] } = {}) {
  return render(
    <Providers>
      <QueryClientSpy />
      <MemoryRouter initialEntries={initialEntries}>
        <Routes>
          <Route path={ROUTES.login} element={<LoginPage />} />
          <Route
            path={PROBE_PATH}
            element={
              <RequireAuth>
                <ProbeScreen permission={permission} />
              </RequireAuth>
            }
          />
        </Routes>
      </MemoryRouter>
    </Providers>,
  )
}

describe('QA: logout()-механика (Task 6 — до сих пор без покрытия)', () => {
  it('logout(): credential очищен всюду, [me] снят с кэша, RequireAuth уводит на /login', async () => {
    captureMyPermissions()
    const user = userEvent.setup()
    setCredential({ kind: 'dev', userId: 'operator-1' })
    renderApp()

    expect(await screen.findByText(SECRET)).toBeInTheDocument()
    const client = spiedClients[spiedClients.length - 1]
    expect(client.getQueryData(['me'])).toEqual(myPermissionsFixture)

    await user.click(screen.getByRole('button', { name: 'Выйти' }))

    expect(await screen.findByLabelText(USER_ID_LABEL)).toBeInTheDocument()
    expect(getCredential()).toBeNull()
    expect(authHeaders).toEqual({})
    expect(sessionStorage.getItem('vaps.credential')).toBeNull()
    // removeQueries(['me']), не invalidate (Ловушка 4): кэш пуст, рефетча нет
    expect(client.getQueryData(['me'])).toBeUndefined()
  })
})

describe('QA: JWT-вход через реальную композицию (AC 2)', () => {
  it('вставка JWT + Enter: возврат на state.from, [me] несёт ровно Authorization: Bearer', async () => {
    const captured = captureMyPermissions()
    const user = userEvent.setup()
    renderApp() // нет credential → guard уводит на /login c state.from

    await user.click(await screen.findByLabelText(JWT_LABEL))
    await user.paste('eyJ.qa.token')
    // Enter в JWT-поле (keyboard path L262 доказан для обоих полей формы)
    await user.keyboard('{Enter}')

    // контент виден = вернуло на исходный PROBE_PATH, а не на дефолтный /
    expect(await screen.findByText(SECRET)).toBeInTheDocument()
    expect(captured).toEqual([
      { 'x-user-id': null, authorization: 'Bearer eyJ.qa.token' },
    ])
  })
})

describe('QA: deny-ветка по полному флоу входа (AC 5)', () => {
  it('вход без нужного права: возврат на маршрут → «Доступ запрещён», БЕЗ редиректа и очистки (deny ≠ logout)', async () => {
    captureMyPermissions() // в фикстуре оператора нет audit.view
    const user = userEvent.setup()
    renderApp({ permission: 'audit.view' })

    await user.type(
      await screen.findByLabelText(USER_ID_LABEL),
      'operator-1{enter}',
    )

    expect(await screen.findByText(ACCESS_DENIED_TEXT)).toBeInTheDocument()
    expect(screen.queryByText(SECRET)).not.toBeInTheDocument()
    // остались на маршруте с заглушкой отказа, credential цел (403-семантика UX L203)
    expect(screen.queryByLabelText(USER_ID_LABEL)).not.toBeInTheDocument()
    expect(getCredential()).toEqual({ kind: 'dev', userId: 'operator-1' })
  })
})

describe('QA: credential переживает пересоздание дерева (AC 1, «F5»)', () => {
  it('remount с новым Providers (пустой Query-кэш): сразу контент без /login, [me] перезапрошен', async () => {
    const captured = captureMyPermissions()
    setCredential({ kind: 'dev', userId: 'operator-1' })

    const first = renderApp()
    expect(await screen.findByText(SECRET)).toBeInTheDocument()
    first.unmount()

    // гидратация модуля из storage покрыта юнитом (credential.test.ts);
    // здесь — что НОВОЕ дерево с НОВЫМ QueryClient не требует повторного входа
    renderApp()
    expect(await screen.findByText(SECRET)).toBeInTheDocument()
    expect(screen.queryByLabelText(USER_ID_LABEL)).not.toBeInTheDocument()
    expect(captured).toHaveLength(2) // каждый клиент сходил за правами сам
  })
})

describe('QA: 401 на query — старт с протухшим токеном (AC 6, цена Д10)', () => {
  it(
    'протухший JWT из storage: [me] получает 401 → после дефолтных ретраев молчаливый возврат на вход',
    { timeout: 15_000 },
    async () => {
      const captured = captureMyPermissions(() =>
        HttpResponse.json(authRequiredEnvelope, { status: 401 }),
      )
      setCredential({ kind: 'jwt', token: 'stale.qa.token' })
      renderApp()

      // пока Query ретраит — только Query-заглушка, контента нет
      expect(await screen.findByText('Загрузка…')).toBeInTheDocument()
      expect(screen.queryByText(SECRET)).not.toBeInTheDocument()

      // дефолтная retry-политика query (Д10): ~7 с до глобального logout
      expect(
        await screen.findByLabelText(USER_ID_LABEL, undefined, {
          timeout: 10_000,
        }),
      ).toBeInTheDocument()
      expect(getCredential()).toBeNull()
      expect(authHeaders).toEqual({})
      // документируем цену Д10: 1 запрос + 3 ретрая (кандидат на донастройку 8.7+)
      expect(captured).toHaveLength(4)
    },
  )
})
