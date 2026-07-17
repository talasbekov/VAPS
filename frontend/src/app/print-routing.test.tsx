// @vitest-environment jsdom
// Разводка print-роутов: /print/test (8.8, AC 1/7) — за RequireAuth БЕЗ
// RequirePermission (Д3, данных нет); /print/expense (10.7, AC-3) — реальные
// данные, потому RequireAuth + RequirePermission("daily_report.generate")
// (зеркало backend-гейта period _EXPENSE_PERMISSION). Тест в app/ — паттерн
// 8.7 (features из shared-тестов нельзя, app→всё легально); реальная
// Providers-композиция + AppRoutes.
import '@testing-library/jest-dom/vitest'
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { MemoryRouter } from 'react-router'
import { server } from '../shared/api/testing/server'
import { clearCredential, setCredential } from '../shared/auth/credential'
import { ACCESS_DENIED_TEXT } from '../shared/auth/guards'
import { printExpenseUrl, ROUTES } from '../shared/routes'
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

// --- Story 10.7: /print/expense — гейт права daily_report.generate (AC-3) ---

const DIVISION_ID = '7a1b2c3d-4e5f-6071-8293-a4b5c6d7e8f9'
const DATE = '2026-07-15'

// Минимальная валидная страница period (single-date → одна страница).
const periodPage = {
  business_date: DATE,
  totals: {
    staff_total: 1,
    list_total: 1,
    vacancies: 0,
    attached: 0,
    columns: {
      SICK: 0,
      VACATION: 0,
      COMMAND: 0,
      TRAINING: 0,
      OTHER: 0,
      DETACHED: 0,
      AFTER_DUTY: 0,
      BEFORE_DUTY: 0,
      ON_DUTY: 0,
      PENDING: 0,
      IN_SERVICE: 1,
    },
  },
  rows: [
    {
      division_id: DIVISION_ID,
      name: 'Управление А',
      staff_total: 1,
      list_total: 1,
      vacancies: 0,
      attached: 0,
      columns: {
        SICK: 0,
        VACATION: 0,
        COMMAND: 0,
        TRAINING: 0,
        OTHER: 0,
        DETACHED: 0,
        AFTER_DUTY: 0,
        BEFORE_DUTY: 0,
        ON_DUTY: 0,
        PENDING: 0,
        IN_SERVICE: 1,
      },
    },
  ],
}

function mockMe(permissions: string[]) {
  server.use(
    http.get('*/api/operations/my-permissions/', () =>
      HttpResponse.json({ permissions }),
    ),
  )
}

function trackPeriodCalls() {
  const calls: string[] = []
  server.use(
    http.get('*/api/operations/expense-reports/period/', ({ request }) => {
      calls.push(request.url)
      return HttpResponse.json({ pages: [periodPage] })
    }),
  )
  return calls
}

function renderExpensePrintRoute() {
  return render(
    <Providers>
      <MemoryRouter initialEntries={[printExpenseUrl(DIVISION_ID, DATE)]}>
        <AppRoutes />
      </MemoryRouter>
    </Providers>,
  )
}

describe('разводка /print/expense (10.7, AC-3)', () => {
  it('без credential: цепь RequireAuth → форма /login, запрос данных не уходит', async () => {
    const calls = trackPeriodCalls()
    renderExpensePrintRoute()
    expect(
      await screen.findByLabelText('Идентификатор (X-User-Id)'),
    ).toBeInTheDocument()
    expect(document.querySelector('.print-root')).not.toBeInTheDocument()
    // flush перед негативным ассертом — гипотетический ошибочный запрос
    // должен успеть дойти до msw-хендлера (ревью BH#5)
    await new Promise((resolve) => setTimeout(resolve, 30))
    expect(calls).toEqual([])
  })

  it('credential БЕЗ daily_report.generate: «Доступ запрещён», запрос данных не уходит', async () => {
    mockMe(['status.view'])
    const calls = trackPeriodCalls()
    setCredential({ kind: 'dev', userId: 'no-generate' })
    renderExpensePrintRoute()
    expect(await screen.findByText(ACCESS_DENIED_TEXT)).toBeInTheDocument()
    expect(document.querySelector('.print-root')).not.toBeInTheDocument()
    await new Promise((resolve) => setTimeout(resolve, 30))
    expect(calls).toEqual([])
  })

  it('credential С правом: страница рендерится ВНЕ AppLayout (сиблинг, без сайдбара)', async () => {
    mockMe(['daily_report.generate'])
    trackPeriodCalls()
    setCredential({ kind: 'dev', userId: 'print-operator' })
    renderExpensePrintRoute()
    expect(
      await screen.findByText(
        'Управление А ЖЕКЕ ҚҰРАМЫНЫҢ САПТЫҚ ТІЗІМІ 15.07.2026 ЖЫЛҒЫ',
      ),
    ).toBeInTheDocument()
    expect(screen.queryByRole('navigation')).not.toBeInTheDocument()
  })
})
