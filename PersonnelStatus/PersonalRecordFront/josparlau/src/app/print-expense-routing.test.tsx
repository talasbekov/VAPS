// @vitest-environment jsdom
// Стори 10.7, AC-1 — разводка /print/expense: сиблинг layout-route за
// RequireAuth + RequirePermission('daily_report.generate').
//
// ⚠️ ФАЙЛ ОБЯЗАН ЛЕЖАТЬ В src/app/, а не в слоте фичи: из features/** импорт
// AppRoutes запрещён boundaries/dependencies (eslint.config.js:107,120-121), и
// блок навешен на src/**/*.{ts,tsx} БЕЗ исключения для тестов. Все потребители
// AppRoutes живут в src/app/ — паттерн 8.7, образец print-routing.test.tsx.
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

const DIVISION_ID = '7a1b2c3d-4e5f-6071-8293-a4b5c6d7e8f9'
const BUSINESS_DATE = '2026-07-19'

afterEach(() => {
  cleanup()
  clearCredential()
  sessionStorage.clear()
})

/**
 * ⚠️ ГЛАВНАЯ ЛОВУШКА (10.6 №0): право в тестах не появляется само — нужны ДВЕ
 * вещи. `useMe` гейтится `enabled: credential !== null`, а дефолтная фикстура
 * (`handlers.ts:28-30`) содержит только `daily_report.mark_update` и
 * `status.view` — `daily_report.generate` в ней НЕТ. Без setCredential И
 * server.use позитивный тест недостижим, и дев решит, что гейт неверен.
 */
function grantPermissions(permissions: string[]) {
  setCredential({ kind: 'dev', userId: 'operator-omd-7' })
  server.use(
    http.get('*/api/operations/my-permissions/', () =>
      HttpResponse.json({ permissions }),
    ),
  )
}

/** Страница под роутом делает ОБА запроса — оба обязаны быть замоканы
 *  (onUnhandledRequest: 'error' уронил бы любой незамоканный путь). */
function stubPageData() {
  server.use(
    http.get('*/api/operations/expense-reports/period/', () =>
      HttpResponse.json({
        pages: [
          {
            business_date: BUSINESS_DATE,
            totals: {
              staff_total: 140,
              list_total: 129,
              vacancies: 11,
              attached: 12,
              columns: {
                IN_SERVICE: 71,
                ON_DUTY: 13,
                AFTER_DUTY: 9,
                COMMAND: 5,
                TRAINING: 3,
                VACATION: 8,
                SICK: 6,
                DETACHED: 2,
                BEFORE_DUTY: 1,
                OTHER: 4,
                PENDING: 7,
              },
            },
            rows: [
              {
                division_id: DIVISION_ID,
                name: 'Шығыс басқармасы',
                staff_total: 140,
                list_total: 129,
                vacancies: 11,
                attached: 12,
                columns: {
                  IN_SERVICE: 71,
                  ON_DUTY: 13,
                  AFTER_DUTY: 9,
                  COMMAND: 5,
                  TRAINING: 3,
                  VACATION: 8,
                  SICK: 6,
                  DETACHED: 2,
                  BEFORE_DUTY: 1,
                  OTHER: 4,
                  PENDING: 7,
                },
              },
            ],
          },
        ],
      }),
    ),
    http.get('*/api/core/divisions/', () =>
      HttpResponse.json({
        count: 1,
        next: null,
        previous: null,
        results: [
          {
            id: DIVISION_ID,
            name: 'Шығыс басқармасы',
            parent: null,
            is_active: true,
          },
        ],
      }),
    ),
  )
}

function renderPrintExpense() {
  return render(
    <Providers>
      <MemoryRouter
        initialEntries={[ROUTES.printExpenseTo(DIVISION_ID, BUSINESS_DATE)]}
      >
        <AppRoutes />
      </MemoryRouter>
    </Providers>,
  )
}

describe('разводка /print/expense (AC-1)', () => {
  it('с правом daily_report.generate: печатная форма рендерится ВНЕ AppLayout', async () => {
    grantPermissions(['daily_report.generate', 'status.view'])
    stubPageData()
    renderPrintExpense()

    expect(await screen.findByRole('table')).toBeInTheDocument()
    expect(document.querySelector('main.print-root')).toBeInTheDocument()
    // navigation-лендмарк сайдбара отсутствует: роут разведён СИБЛИНГОМ, а не
    // вложен в layout-route (свой ассерт; print-routing.test.tsx не трогаем)
    expect(screen.queryByRole('navigation')).not.toBeInTheDocument()
  })

  it('БЕЗ права daily_report.generate → «Доступ запрещён», данных нет', async () => {
    // credential ставится ОБЯЗАТЕЛЬНО: без него тест был бы зелёным по
    // отсутствию credential (редирект на /login) и про гейт права не доказывал
    // бы ничего.
    grantPermissions(['daily_report.mark_update', 'status.view'])
    renderPrintExpense()

    expect(await screen.findByText(ACCESS_DENIED_TEXT)).toBeInTheDocument()
    expect(screen.queryByRole('table')).not.toBeInTheDocument()
    expect(document.querySelector('main.print-root')).not.toBeInTheDocument()
  })

  it('без credential: прямой заход по URL → редирект на /login', async () => {
    renderPrintExpense()

    expect(
      await screen.findByLabelText('Идентификатор (X-User-Id)'),
    ).toBeInTheDocument()
    expect(document.querySelector('main.print-root')).not.toBeInTheDocument()
  })

  it('фабрика ROUTES собирает query: маршрут не пишется литералом нигде', () => {
    // ARCH-FE-012: literal-путь вне routes.ts — eslint error; фабрика —
    // единственный легальный способ собрать адрес печатной формы.
    expect(ROUTES.printExpenseTo(DIVISION_ID, BUSINESS_DATE)).toBe(
      `/print/expense?division_id=${DIVISION_ID}&business_date=${BUSINESS_DATE}`,
    )
    // параметры экранируются
    expect(ROUTES.printExpenseTo('a b&c', '2026-07-19')).toContain('a%20b%26c')
  })

  it('печатная форма НЕ добавлена в NAV_SECTIONS — не раздел портала', async () => {
    const { NAV_SECTIONS } = await import('../shared/routes')
    expect(
      NAV_SECTIONS.some((section) => section.route === ROUTES.printExpense),
    ).toBe(false)
  })
})
