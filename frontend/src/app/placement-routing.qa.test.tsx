// @vitest-environment jsdom
// Story 16.8h5: подключение /placement и /placement/:id к App.tsx +
// RequirePermission-гейт + NAV_SECTIONS-запись — реальная композиция
// Providers+AppRoutes, образец duty-plans-list.qa.test.tsx/
// duty-plan-detail.qa.test.tsx (14.11j/k).
import '@testing-library/jest-dom/vitest'
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { MemoryRouter } from 'react-router'
import { server } from '../shared/api/testing/server'
import { ACCESS_DENIED_TEXT } from '../shared/auth/guards'
import type { Credential } from '../shared/auth/credential'
import { clearCredential, setCredential } from '../shared/auth/credential'
import { ROUTES } from '../shared/routes'
import { AppRoutes } from './App'
import { Providers } from './providers'

afterEach(() => {
  cleanup()
  clearCredential()
  sessionStorage.clear()
})

if (typeof HTMLDialogElement.prototype.showModal !== 'function') {
  HTMLDialogElement.prototype.showModal = function (this: HTMLDialogElement) {
    this.open = true
  }
  HTMLDialogElement.prototype.close = function (this: HTMLDialogElement) {
    this.open = false
    this.dispatchEvent(new Event('close'))
  }
}

function usePermissionsResponse(payload: { permissions: string[] }) {
  server.use(
    http.get('*/api/operations/my-permissions/', () => HttpResponse.json(payload)),
  )
}

function renderApp(
  initialEntry: string = ROUTES.placementVersions,
  credential: Credential = { kind: 'dev', userId: 'operator-1' },
) {
  setCredential(credential)
  return render(
    <Providers>
      <MemoryRouter initialEntries={[initialEntry]}>
        <AppRoutes />
      </MemoryRouter>
    </Providers>,
  )
}

describe('placement routing', () => {
  it('без assignment.create маршрут заблокирован', async () => {
    usePermissionsResponse({ permissions: ['status.view'] })
    renderApp()
    expect(await screen.findByText(ACCESS_DENIED_TEXT)).toBeInTheDocument()
  })

  it('с assignment.create список версий доступен', async () => {
    usePermissionsResponse({ permissions: ['assignment.create'] })
    server.use(
      http.get('*/api/operations/assignment-versions/', () =>
        HttpResponse.json({
          count: 1,
          next: null,
          previous: null,
          results: [
            {
              id: 7,
              event: 3,
              status: 'DRAFT',
              version: 1,
              is_current: true,
              signature_hash: '',
              created_at: '2026-08-01T09:00:00Z',
              updated_at: '2026-08-01T09:00:00Z',
            },
          ],
        }),
      ),
    )
    renderApp()

    expect(
      await screen.findByRole('heading', { level: 1, name: 'Расстановка' }),
    ).toBeInTheDocument()
    expect(
      await screen.findByRole('link', { name: 'Событие #3' }),
    ).toBeInTheDocument()
  })

  it('деталь версии доступна по прямому URL и рендерит реальные данные', async () => {
    usePermissionsResponse({ permissions: ['assignment.create'] })
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
      http.get('*/api/operations/assignment-versions/7/conflicts/', () =>
        HttpResponse.json([]),
      ),
    )
    renderApp(ROUTES.placementVersionDetailTo(7))

    expect(await screen.findByText(/Версия 1/)).toBeInTheDocument()
  })

  it('раздел «Расстановка» присутствует в навигации для держателя assignment.create', async () => {
    usePermissionsResponse({ permissions: ['assignment.create'] })
    server.use(
      http.get('*/api/operations/assignment-versions/', () =>
        HttpResponse.json({ count: 0, next: null, previous: null, results: [] }),
      ),
    )
    renderApp(ROUTES.home)

    await waitFor(() =>
      expect(screen.getByRole('link', { name: 'Расстановка' })).toHaveAttribute(
        'href',
        ROUTES.placementVersions,
      ),
    )
  })

  it('раздел «Расстановка» скрыт в навигации без assignment.create', async () => {
    usePermissionsResponse({ permissions: ['status.view'] })
    renderApp(ROUTES.home)

    await waitFor(() => expect(screen.queryByRole('navigation')).toBeInTheDocument())
    expect(screen.queryByRole('link', { name: 'Расстановка' })).not.toBeInTheDocument()
  })

  it('переход список→деталь по клику работает end-to-end', async () => {
    usePermissionsResponse({ permissions: ['assignment.create'] })
    server.use(
      http.get('*/api/operations/assignment-versions/', () =>
        HttpResponse.json({
          count: 1,
          next: null,
          previous: null,
          results: [
            {
              id: 7,
              event: 3,
              status: 'APPROVED',
              version: 4,
              is_current: true,
              signature_hash: '',
              created_at: '2026-08-01T09:00:00Z',
              updated_at: '2026-08-01T09:00:00Z',
            },
          ],
        }),
      ),
      http.get('*/api/operations/assignment-versions/7/', () =>
        HttpResponse.json({
          id: 7,
          event: 3,
          status: 'APPROVED',
          version: 4,
          is_current: true,
          signature_hash: 'sig',
          created_at: '2026-08-01T09:00:00Z',
          updated_at: '2026-08-01T09:00:00Z',
          assignments: [],
        }),
      ),
      http.get('*/api/operations/assignment-versions/7/conflicts/', () =>
        HttpResponse.json([]),
      ),
    )
    renderApp()
    const link = await screen.findByRole('link', { name: 'Событие #3' })

    await userEvent.click(link)

    expect(await screen.findByText(/Версия 4/)).toBeInTheDocument()
  })
})
