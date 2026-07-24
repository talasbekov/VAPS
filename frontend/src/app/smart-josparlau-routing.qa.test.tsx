// @vitest-environment jsdom
// Этап 7 (hardening, §34 «route audit»): карта гейтов Smart Josparlau-маршрутов
// (§20-21 личный состав/объекты + Этап 2-3 ОМ) — те же не покрыты ни одним
// per-page тестом (features/security-events/pages не имеет *.test.tsx),
// только ручной браузерной QA. Прецедент — app-layout.qa.test.tsx GATE_MATRIX,
// но ТА матрица намеренно ограничена исходными pilot-кодами (ALL_CODES);
// здесь — отдельный набор кодов `ops.*`, не смешиваем со старым списком.
import '@testing-library/jest-dom/vitest'
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { MemoryRouter } from 'react-router'
import { server } from '../shared/api/testing/server'
import type { Credential } from '../shared/auth/credential'
import { clearCredential, setCredential } from '../shared/auth/credential'
import { ACCESS_DENIED_TEXT } from '../shared/auth/guards'
import { ROUTES } from '../shared/routes'
import { AppRoutes } from './App'
import { Providers } from './providers'

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
globalThis.ResizeObserver ??= ResizeObserverStub as unknown as typeof ResizeObserver
Element.prototype.scrollIntoView ??= () => {}
Element.prototype.hasPointerCapture ??= () => false
Element.prototype.releasePointerCapture ??= () => {}

afterEach(() => {
  cleanup()
  clearCredential()
  sessionStorage.clear()
})

const OPS_CODES = [
  'ops.dashboard.view',
  'ops.security_event.view',
  'status.view',
  'ops.object.view',
  'ops.analytics.view',
  'ops.duty.view',
] as const

function usePermissionsResponse(payload: { permissions: string[] }) {
  server.use(
    http.get('*/api/operations/my-permissions/', () => HttpResponse.json(payload)),
  )
}

function renderApp(initialEntry: string) {
  setCredential({ kind: 'dev', userId: 'operator-1' } satisfies Credential)
  return render(
    <Providers>
      <MemoryRouter initialEntries={[initialEntry]}>
        <AppRoutes />
      </MemoryRouter>
    </Providers>,
  )
}

const ROUTE_MATRIX = [
  { route: ROUTES.commandCenter, code: 'ops.dashboard.view' },
  { route: ROUTES.securityEvents, code: 'ops.security_event.view' },
  { route: ROUTES.securityEventDetailTo('does-not-exist'), code: 'ops.security_event.view' },
  { route: ROUTES.employees, code: 'status.view' },
  { route: ROUTES.employeeDetailTo('does-not-exist'), code: 'status.view' },
  { route: ROUTES.objects, code: 'ops.object.view' },
  { route: ROUTES.objectDetailTo('does-not-exist'), code: 'ops.object.view' },
  { route: ROUTES.serviceAnalytics, code: 'ops.analytics.view' },
  { route: ROUTES.duties, code: 'ops.duty.view' },
] as const

describe('Карта гейтов Smart Josparlau-маршрутов (§34 route audit)', () => {
  it.each(ROUTE_MATRIX)('$route: без $code → «Доступ запрещён»', async ({ route, code }) => {
    usePermissionsResponse({ permissions: OPS_CODES.filter((c) => c !== code) })
    renderApp(route)
    expect(await screen.findByText(ACCESS_DENIED_TEXT)).toBeInTheDocument()
  })

  it.each(ROUTE_MATRIX)('$route: ровно $code → доступ открыт (не «Доступ запрещён»)', async ({ route, code }) => {
    usePermissionsResponse({ permissions: [code] })
    renderApp(route)
    // Дожидаемся хоть какого-то рендера страницы (не «Загрузка…» гейта), затем
    // проверяем отсутствие отказа — сами страницы дальше могут показать
    // «не найдено»/ошибку сети (моки данных вне охвата этого route-audit).
    await screen.findByRole('navigation', { name: 'Разделы' })
    expect(screen.queryByText(ACCESS_DENIED_TEXT)).not.toBeInTheDocument()
  })
})
