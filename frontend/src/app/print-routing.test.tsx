// @vitest-environment jsdom
// Разводка print-роута (8.8, AC 1/7): сиблинг layout-route за RequireAuth
// БЕЗ RequirePermission (Д3). Тест в app/ — паттерн 8.7 (features из shared-
// тестов нельзя, app→всё легально); реальная Providers-композиция + AppRoutes.
import '@testing-library/jest-dom/vitest'
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { clearCredential, setCredential } from '../shared/auth/credential'
import { ROUTES } from '../shared/routes'
import { AppRoutes } from './App'
import { Providers } from './providers'

afterEach(() => {
  cleanup()
  clearCredential()
  sessionStorage.clear()
})

function renderPrintRoute() {
  return render(
    <Providers>
      <MemoryRouter initialEntries={[ROUTES.printTest]}>
        <AppRoutes />
      </MemoryRouter>
    </Providers>,
  )
}

describe('разводка /print/test (AC 1, 7)', () => {
  it('без credential: прямой заход по URL → редирект /login (механика RequireAuth 8.6)', async () => {
    renderPrintRoute()
    // форма входа видна, печатной страницы нет
    expect(
      await screen.findByLabelText('Идентификатор (X-User-Id)'),
    ).toBeInTheDocument()
    expect(document.querySelector('.print-root')).not.toBeInTheDocument()
  })

  it('с credential: страница рендерится ВНЕ AppLayout — без сайдбара/шапки', async () => {
    setCredential({ kind: 'dev', userId: 'print-tester' })
    renderPrintRoute()
    // печатная страница видна (итог doc-print-фрагмента)
    expect(await screen.findByText('Общее')).toBeInTheDocument()
    // navigation-лендмарк сайдбара AppLayout отсутствует — print-роут
    // разведён сиблингом, НЕ вложен в layout-route
    expect(screen.queryByRole('navigation')).not.toBeInTheDocument()
    // и никакого RequirePermission: контент виден без заглушки загрузки прав
    // (queryByText, не queryByRole('status') — live-region ToastProvider тоже status)
    expect(screen.queryByText('Загрузка…')).not.toBeInTheDocument()
  })
})
