// @vitest-environment jsdom
// Story 16.7, AC-6 — разводка /print/placement: сиблинг layout-route за
// RequireAuth + RequirePermission('assignment.create'). Образец
// print-expense-routing.test.tsx (10.7).
//
// ⚠️ ФАЙЛ ОБЯЗАН ЛЕЖАТЬ В src/app/ (не в слоте фичи) — из features/**
// импорт AppRoutes запрещён boundaries/dependencies.
import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { MemoryRouter } from 'react-router'
import { afterEach, describe, expect, it } from 'vitest'
import { server } from '../shared/api/testing/server'
import { clearCredential, setCredential } from '../shared/auth/credential'
import { ACCESS_DENIED_TEXT } from '../shared/auth/guards'
import { ROUTES } from '../shared/routes'
import { AppRoutes } from './App'
import { Providers } from './providers'

afterEach(() => {
  cleanup()
  clearCredential()
  sessionStorage.clear()
})

function grantPermissions(permissions: string[]) {
  setCredential({ kind: 'dev', userId: 'operator-omd-7' })
  server.use(
    http.get('*/api/operations/my-permissions/', () =>
      HttpResponse.json({ permissions }),
    ),
  )
}

function stubPageData() {
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
            employee_id: '11111111-1111-1111-1111-111111111111',
            post: 5,
            conflict_severity: '',
            conflict_codes: [],
            acknowledged_at: null,
            ack_escalated_at: null,
          },
        ],
      }),
    ),
  )
}

function renderPrintPlacement() {
  return render(
    <Providers>
      <MemoryRouter initialEntries={[ROUTES.printPlacementTo(7)]}>
        <AppRoutes />
      </MemoryRouter>
    </Providers>,
  )
}

describe('разводка /print/placement (AC-6)', () => {
  it('с правом assignment.create: печатная форма рендерится ВНЕ AppLayout', async () => {
    grantPermissions(['assignment.create', 'status.view'])
    stubPageData()
    renderPrintPlacement()

    expect(await screen.findByRole('table')).toBeInTheDocument()
    expect(document.querySelector('main.print-root')).toBeInTheDocument()
    expect(screen.queryByRole('navigation')).not.toBeInTheDocument()
  })

  it('БЕЗ права assignment.create → «Доступ запрещён», данных нет', async () => {
    grantPermissions(['status.view'])
    renderPrintPlacement()

    expect(await screen.findByText(ACCESS_DENIED_TEXT)).toBeInTheDocument()
    expect(screen.queryByRole('table')).not.toBeInTheDocument()
    expect(document.querySelector('main.print-root')).not.toBeInTheDocument()
  })

  it('без credential: прямой заход по URL → редирект на /login', async () => {
    renderPrintPlacement()

    expect(
      await screen.findByLabelText('Идентификатор (X-User-Id)'),
    ).toBeInTheDocument()
    expect(document.querySelector('main.print-root')).not.toBeInTheDocument()
  })

  it('фабрика ROUTES собирает query: маршрут не пишется литералом нигде', () => {
    expect(ROUTES.printPlacementTo(7)).toBe('/print/placement?version_id=7')
    expect(ROUTES.printPlacementTo('7 a')).toContain('7%20a')
  })

  it('печатная форма НЕ добавлена в NAV_SECTIONS — не раздел портала', async () => {
    const { NAV_SECTIONS } = await import('../shared/routes')
    expect(
      NAV_SECTIONS.some((section) => section.route === ROUTES.printPlacement),
    ).toBe(false)
  })
})
