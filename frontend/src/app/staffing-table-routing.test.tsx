// @vitest-environment jsdom
// Story 20.5c, AC-1/AC-7 — разводка /staffing-table: пункт навигации виден
// ТОЛЬКО с personnel.view, прямой заход без права → «Доступ запрещён».
// Файл живёт в src/app/ (тот же прецедент, что AppLayout.test.tsx/
// print-expense-routing.test.tsx) — из features/** импорт AppRoutes
// запрещён eslint boundaries.
import '@testing-library/jest-dom/vitest'
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { MemoryRouter } from 'react-router'
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

function usePermissionsResponse(permissions: string[]) {
  setCredential({ kind: 'dev', userId: 'operator-1' })
  server.use(
    http.get('*/api/operations/my-permissions/', () =>
      HttpResponse.json({ permissions }),
    ),
    http.get('*/api/core/divisions/', () =>
      HttpResponse.json({ count: 0, next: null, previous: null, results: [] }),
    ),
    http.get('*/api/core/staffing-table/', () =>
      HttpResponse.json({ business_date: '2026-07-08', count: 0, results: [] }),
    ),
  )
}

function renderApp(initialEntry: string) {
  return render(
    <Providers>
      <MemoryRouter initialEntries={[initialEntry]}>
        <AppRoutes />
      </MemoryRouter>
    </Providers>,
  )
}

describe('разводка /staffing-table (AC-1/AC-7)', () => {
  it('с правом personnel.view: пункт навигации виден, страница рендерится', async () => {
    usePermissionsResponse(['personnel.view'])
    renderApp(ROUTES.home)

    expect(
      await screen.findByRole('link', { name: 'Штатное расписание' }),
    ).toBeInTheDocument()
  })

  it('без personnel.view: пункт навигации скрыт', async () => {
    usePermissionsResponse(['status.view'])
    renderApp(ROUTES.home)

    await screen.findByRole('link', { name: 'Дашборд' })
    expect(
      screen.queryByRole('link', { name: 'Штатное расписание' }),
    ).not.toBeInTheDocument()
  })

  it('без personnel.view: прямой заход на /staffing-table → «Доступ запрещён»', async () => {
    usePermissionsResponse(['status.view'])
    renderApp(ROUTES.staffingTable)

    expect(await screen.findByText(ACCESS_DENIED_TEXT)).toBeInTheDocument()
  })

  it('с правом personnel.view: прямой заход рендерит живой экран', async () => {
    usePermissionsResponse(['personnel.view'])
    renderApp(ROUTES.staffingTable)

    expect(
      await screen.findByRole('heading', { name: 'Штатное расписание' }),
    ).toBeInTheDocument()
  })
})
