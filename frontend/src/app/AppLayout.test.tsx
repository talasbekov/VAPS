// @vitest-environment jsdom
// Каркас 8.7 через РЕАЛЬНУЮ композицию Providers + AppRoutes (прецедент QA
// 8.5/8.6): роль-фильтрованный сайдбар (UX L52), «Выйти» из шапки, разводка
// маршрутов за RequirePermission. Тест живёт в app/ — ему нужны AppRoutes и
// Providers (инцидент 8.6: boundaries ловит и тест-файлы). jsdom не парсит
// Tailwind — ассертим ПОВЕДЕНИЕ (наличие пунктов nav, редиректы), не стили.
import '@testing-library/jest-dom/vitest'
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { MemoryRouter } from 'react-router'
import {
  adminPermissionsFixture,
  myPermissionsFixture,
} from '../shared/api/testing/handlers'
import { server } from '../shared/api/testing/server'
import { ACCESS_DENIED_TEXT } from '../shared/auth/guards'
import {
  clearCredential,
  getCredential,
  setCredential,
} from '../shared/auth/credential'
import { ROUTES } from '../shared/routes'
import { AppRoutes } from './App'
import { Providers } from './providers'

// Radix DropdownMenu в jsdom: floating-ui требует ResizeObserver, сам Radix —
// scrollIntoView/pointer-capture; полифиллы per-file, общий setup 8.4 не трогаем
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

const ALL_SECTIONS = [
  'Дашборд',
  'Управление персоналом',
  'Расход дня',
  'Подразделения',
  'Отчёты',
  'Аудит',
] as const

// полный набор кодов пилота (seed_operations) — не wildcard
const fullPermissions = {
  permissions: [
    'status.view',
    'daily_report.mark_update',
    'daily_report.generate',
    'audit.view',
  ],
}

function usePermissionsResponse(payload: { permissions: string[] }) {
  server.use(
    http.get('*/api/operations/my-permissions/', () =>
      HttpResponse.json(payload),
    ),
  )
}

function renderApp(initialEntry: string = ROUTES.home) {
  setCredential({ kind: 'dev', userId: 'operator-1' })
  return render(
    <Providers>
      <MemoryRouter initialEntries={[initialEntry]}>
        <AppRoutes />
      </MemoryRouter>
    </Providers>,
  )
}

describe('AppLayout: роль-фильтрованный сайдбар (AC 5, 6)', () => {
  it('полный набор прав → все 6 разделов в сайдбаре', async () => {
    usePermissionsResponse(fullPermissions)
    renderApp()

    for (const label of ALL_SECTIONS) {
      expect(
        await screen.findByRole('link', { name: label }),
      ).toBeInTheDocument()
    }
  })

  it('wildcard `*` (ADMIN) → все 6 разделов', async () => {
    usePermissionsResponse(adminPermissionsFixture)
    renderApp()

    for (const label of ALL_SECTIONS) {
      expect(
        await screen.findByRole('link', { name: label }),
      ).toBeInTheDocument()
    }
  })

  it('только status.view → Дашборд/Управление персоналом/Подразделения; остальное скрыто', async () => {
    usePermissionsResponse({ permissions: ['status.view'] })
    renderApp()

    expect(
      await screen.findByRole('link', { name: 'Дашборд' }),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('link', { name: 'Управление персоналом' }),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('link', { name: 'Подразделения' }),
    ).toBeInTheDocument()
    for (const hidden of ['Расход дня', 'Отчёты', 'Аудит']) {
      expect(
        screen.queryByRole('link', { name: hidden }),
      ).not.toBeInTheDocument()
    }
  })

  it('шапка: колокольчик — disabled-заглушка (центр уведомлений — E11)', async () => {
    usePermissionsResponse(fullPermissions)
    renderApp()

    expect(
      await screen.findByRole('button', {
        name: 'Уведомления (появятся в E11)',
      }),
    ).toBeDisabled()
  })
})

describe('AppLayout: «Выйти» (AC 5)', () => {
  it('пункт меню чистит credential; RequireAuth реактивно уводит на /login', async () => {
    usePermissionsResponse(fullPermissions)
    const user = userEvent.setup()
    renderApp()

    await user.click(
      await screen.findByRole('button', { name: 'Меню пользователя' }),
    )
    await user.click(await screen.findByRole('menuitem', { name: 'Выйти' }))

    // молчаливый возврат на вход без window.location (механика Д7-8.6)
    expect(
      await screen.findByLabelText('Идентификатор (X-User-Id)'),
    ).toBeInTheDocument()
    expect(getCredential()).toBeNull()
    expect(sessionStorage.getItem('vaps.credential')).toBeNull()
  })
})

describe('Разводка маршрутов: RequirePermission на данных [me] (AC 6, 7)', () => {
  it('прямой заход на /daily-expense БЕЗ daily_report.mark_update → «Доступ запрещён»', async () => {
    usePermissionsResponse({ permissions: ['status.view'] })
    renderApp(ROUTES.dailyExpense)

    expect(await screen.findByText(ACCESS_DENIED_TEXT)).toBeInTheDocument()
    expect(
      screen.queryByRole('heading', { name: 'Расход дня' }),
    ).not.toBeInTheDocument()
  })

  it('с правом → реальный экран «Расход дня» (10.2: заглушка заменена страницей)', async () => {
    // дефолтная фикстура оператора несёт daily_report.mark_update
    usePermissionsResponse(myPermissionsFixture)
    // Экран 10.2 грузит grid-prefill на маунте — минимальный валидный ответ
    // (onUnhandledRequest: 'error' иначе уронит тест).
    server.use(
      http.get('*/api/operations/statuses/grid-prefill/', ({ request }) =>
        HttpResponse.json({
          business_date:
            new URL(request.url).searchParams.get('business_date') ?? '',
          employees: [],
          statuses: [],
          status_types: [{ code: 'IN_SERVICE', name: 'В строю' }],
        }),
      ),
      // Панель «Сдача дня» (10.3) на той же странице грузит day-state —
      // тот же минимальный валидный ответ по той же причине.
      http.get('*/api/operations/daily-submissions/day-state/', () =>
        HttpResponse.json({ divisions: [], detail: null }),
      ),
    )
    renderApp(ROUTES.dailyExpense)

    expect(
      await screen.findByRole('heading', { level: 1, name: 'Расход дня' }),
    ).toBeInTheDocument()
    // Реальный экран, не заглушка: есть выбор даты, текста заглушки нет.
    expect(screen.getByLabelText('Дата')).toBeInTheDocument()
    expect(
      screen.queryByText('Экран появится в E9–E10'),
    ).not.toBeInTheDocument()
  })

  it('/ (Дашборд «Расход») за status.view: заглушка рендерится в <main> каркаса', async () => {
    usePermissionsResponse(myPermissionsFixture)
    renderApp()

    expect(
      await screen.findByRole('heading', { level: 1, name: 'Дашборд «Расход»' }),
    ).toBeInTheDocument()
    // каркас вокруг: сайдбар с лого и nav присутствуют
    expect(screen.getByText('PersonnelStatus')).toBeInTheDocument()
    expect(screen.getByRole('navigation', { name: 'Разделы' })).toBeInTheDocument()
  })
})
