// @vitest-environment jsdom
// QA-проход 8.7 поверх AppLayout.test.tsx (прецедент — auth-flow.qa.test.tsx
// 8.6): непокрытые связки каркаса через РЕАЛЬНУЮ композицию Providers +
// AppRoutes. Пробелы: (1) клик-навигация сайдбаром (существующие тесты — только
// прямые заходы; активность — aria-current от NavLink); (2) карта гейтов
// оставшихся 4 маршрутов, причём deny — с «всеми кодами, КРОМЕ нужного»
// (доказывает гейт именно на СВОЁМ коде, а не на любом); (3) Task 6: шапка и
// «Выйти» не зависят от состояния прав — зависшая загрузка и сбой 500;
// (4) инициалы Avatar: dev-ветка и JWT-фолбэк «??». jsdom не парсит Tailwind —
// ассертим поведение и aria, не стили.
import '@testing-library/jest-dom/vitest'
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { delay, http, HttpResponse } from 'msw'
import { MemoryRouter } from 'react-router'
import { serverEnvelope } from '../shared/api/testing/handlers'
import { server } from '../shared/api/testing/server'
import type { Credential } from '../shared/auth/credential'
import {
  clearCredential,
  getCredential,
  setCredential,
} from '../shared/auth/credential'
import {
  ACCESS_DENIED_TEXT,
  PERMISSIONS_ERROR_TEXT,
} from '../shared/auth/guards'
import { ROUTES } from '../shared/routes'
import { AppRoutes } from './App'
import { Providers } from './providers'

// Radix DropdownMenu в jsdom: полифиллы per-file (прецедент AppLayout.test.tsx)
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
globalThis.ResizeObserver ??=
  ResizeObserverStub as unknown as typeof ResizeObserver
Element.prototype.scrollIntoView ??= () => {}
Element.prototype.hasPointerCapture ??= () => false
Element.prototype.releasePointerCapture ??= () => {}

afterEach(() => {
  cleanup()
  clearCredential()
  sessionStorage.clear()
})

// полный набор кодов пилота (seed_operations) — не wildcard
const ALL_CODES = [
  'status.view',
  'daily_report.mark_update',
  'daily_report.generate',
  'audit.view',
] as const

function usePermissionsResponse(payload: { permissions: string[] }) {
  server.use(
    http.get('*/api/operations/my-permissions/', () =>
      HttpResponse.json(payload),
    ),
  )
}

function renderApp(
  initialEntry: string = ROUTES.home,
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

describe('Сайдбар — рабочая навигация, не витрина (AC 5)', () => {
  it('клик по разделу меняет контент <Outlet/>; aria-current переезжает за активным NavLink', async () => {
    usePermissionsResponse({ permissions: [...ALL_CODES] })
    const user = userEvent.setup()
    renderApp()

    expect(
      await screen.findByRole('heading', {
        level: 1,
        name: 'Дашборд «Расход»',
      }),
    ).toBeInTheDocument()
    const dashboardLink = screen.getByRole('link', { name: 'Дашборд' })
    const dailyLink = screen.getByRole('link', { name: 'Расход дня' })
    expect(dashboardLink).toHaveAttribute('aria-current', 'page')
    expect(dailyLink).not.toHaveAttribute('aria-current')

    await user.click(dailyLink)

    expect(
      await screen.findByRole('heading', { level: 1, name: 'Расход дня' }),
    ).toBeInTheDocument()
    expect(
      screen.queryByRole('heading', { level: 1, name: 'Дашборд «Расход»' }),
    ).not.toBeInTheDocument()
    expect(dailyLink).toHaveAttribute('aria-current', 'page')
    expect(dashboardLink).not.toHaveAttribute('aria-current')
  })
})

// Оставшиеся 4 маршрута карты (/, /daily-expense — в тестах стори); heading —
// H1 заглушки раздела (section-stubs), код — seed_operations дословно (AC 6)
const GATE_MATRIX = [
  {
    route: ROUTES.employees,
    heading: 'Управление персоналом',
    code: 'status.view',
  },
  { route: ROUTES.organization, heading: 'Подразделения', code: 'status.view' },
  { route: ROUTES.reports, heading: 'Отчёты', code: 'daily_report.generate' },
  { route: ROUTES.audit, heading: 'Аудит', code: 'audit.view' },
] as const

describe('Карта гейтов: маршрут открывается ровно СВОИМ кодом (AC 6)', () => {
  it.each(GATE_MATRIX)(
    '$route: все коды, КРОМЕ $code → «Доступ запрещён»',
    async ({ route, heading, code }) => {
      usePermissionsResponse({
        permissions: ALL_CODES.filter((c) => c !== code),
      })
      renderApp(route)

      expect(await screen.findByText(ACCESS_DENIED_TEXT)).toBeInTheDocument()
      expect(
        screen.queryByRole('heading', { level: 1, name: heading }),
      ).not.toBeInTheDocument()
    },
  )

  it.each(GATE_MATRIX)(
    '$route: ровно один код $code → заглушка раздела',
    async ({ route, heading, code }) => {
      usePermissionsResponse({ permissions: [code] })
      renderApp(route)

      expect(
        await screen.findByRole('heading', { level: 1, name: heading }),
      ).toBeInTheDocument()
      expect(screen.queryByText(ACCESS_DENIED_TEXT)).not.toBeInTheDocument()
    },
  )
})

describe('Шапка не зависит от состояния прав (Task 6)', () => {
  it('права зависли в загрузке → сайдбар пуст, но «Выйти» доступен и работает', async () => {
    server.use(
      http.get('*/api/operations/my-permissions/', async () => {
        await delay('infinite')
        return HttpResponse.json({ permissions: [] })
      }),
    )
    const user = userEvent.setup()
    renderApp()

    const nav = await screen.findByRole('navigation', { name: 'Разделы' })
    expect(within(nav).queryAllByRole('link')).toHaveLength(0)

    await user.click(screen.getByRole('button', { name: 'Меню пользователя' }))
    await user.click(await screen.findByRole('menuitem', { name: 'Выйти' }))

    expect(
      await screen.findByLabelText('Идентификатор (X-User-Id)'),
    ).toBeInTheDocument()
    expect(getCredential()).toBeNull()
  })

  // цена дефолтных ретраев Query (Д10-8.6): 1 запрос + 3 ретрая ≈ 7 с до
  // финального error — таймауты подняты осознанно, hardcoded-sleep нет
  it(
    'сбой загрузки прав (500 после ретраев) → сайдбар пуст, шапка НЕ спрятана',
    { timeout: 15_000 },
    async () => {
      server.use(
        http.get('*/api/operations/my-permissions/', () =>
          HttpResponse.json(serverEnvelope, { status: 500 }),
        ),
      )
      renderApp()

      const alert = await screen.findByRole('alert', {}, { timeout: 12_000 })
      expect(alert).toHaveTextContent(PERMISSIONS_ERROR_TEXT)
      const nav = screen.getByRole('navigation', { name: 'Разделы' })
      expect(within(nav).queryAllByRole('link')).toHaveLength(0)
      // шапка живая: logout остаётся достижим (Task 6)
      expect(
        screen.getByRole('button', { name: 'Меню пользователя' }),
      ).toBeInTheDocument()
      expect(
        screen.getByRole('button', { name: 'Уведомления' }),
      ).toBeEnabled()
    },
  )
})

describe('Avatar в шапке (AC 5)', () => {
  it('dev-credential → инициалы «OP»; метка меню — userId', async () => {
    const user = userEvent.setup()
    renderApp()

    const trigger = await screen.findByRole('button', {
      name: 'Меню пользователя',
    })
    expect(within(trigger).getByText('OP')).toBeInTheDocument()

    await user.click(trigger)
    expect(await screen.findByText('operator-1')).toBeInTheDocument()
  })

  it('JWT-вход (userId неизвестен, ARCH-SEC-030) → фолбэк «??» и «Вход по JWT»', async () => {
    const user = userEvent.setup()
    renderApp(ROUTES.home, { kind: 'jwt', token: 'jwt-qa-8-7' })

    const trigger = await screen.findByRole('button', {
      name: 'Меню пользователя',
    })
    expect(within(trigger).getByText('??')).toBeInTheDocument()

    await user.click(trigger)
    expect(await screen.findByText('Вход по JWT')).toBeInTheDocument()
  })
})
