// @vitest-environment jsdom
// Smart Josparlau §9.15 — разводка /print/placement: сиблинг layout-route за
// RequireAuth + RequirePermission('ops.security_event.view').
//
// ⚠️ ФАЙЛ ОБЯЗАН ЛЕЖАТЬ В src/app/, а не в слоте фичи: из features/** импорт
// AppRoutes запрещён boundaries/dependencies, и блок навешен на
// src/**/*.{ts,tsx} БЕЗ исключения для тестов (образец
// print-expense-routing.test.tsx).
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

const EVENT_ID = 'se-print-routing'

afterEach(() => {
  cleanup()
  clearCredential()
  sessionStorage.clear()
})

/**
 * ⚠️ Право в тестах не появляется само: `useMe` гейтится
 * `enabled: credential !== null`, а дефолтная фикстура прав не содержит
 * `ops.security_event.view`. Без setCredential И server.use позитивный тест
 * недостижим.
 */
function grantPermissions(permissions: string[]) {
  setCredential({ kind: 'dev', userId: 'operator-om-1' })
  server.use(
    http.get('*/api/operations/my-permissions/', () =>
      HttpResponse.json({ permissions }),
    ),
  )
}

function stubEvent() {
  server.use(
    http.get('*/api/ops/security-events/:id/', () =>
      HttpResponse.json({
        id: EVENT_ID,
        code: 'ОМ-2026-014',
        title: 'Визит делегации',
        objectName: 'Резиденция «Ак Орда»',
        businessDate: '2026-07-22',
        ownerName: 'Тастанов Г. К.',
        stage: 'APPROVAL',
        updatedAt: '2026-07-20T09:15:00+05:00',
        reconSectorPosts: [
          {
            id: 'post-1',
            sector: 'Северный сектор',
            post: 'Пост №1 (КПП)',
            task: 'Пропускной режим',
            requirements: 'Допуск формы 2',
            need: 1,
          },
        ],
        placementAssignments: [
          {
            id: 'a-1',
            postId: 'post-1',
            employeeId: 'emp-1',
            employeeName: 'Байжанов С. Т.',
            acknowledgedAt: null,
          },
        ],
      }),
    ),
  )
}

function renderPrintPlacement() {
  return render(
    <Providers>
      <MemoryRouter initialEntries={[ROUTES.printPlacementTo(EVENT_ID)]}>
        <AppRoutes />
      </MemoryRouter>
    </Providers>,
  )
}

describe('разводка /print/placement', () => {
  it('с правом ops.security_event.view: форма рендерится ВНЕ AppLayout', async () => {
    grantPermissions(['ops.security_event.view'])
    stubEvent()
    renderPrintPlacement()

    expect(await screen.findByRole('table')).toBeInTheDocument()
    expect(document.querySelector('main.print-root')).toBeInTheDocument()
    // navigation-лендмарк сайдбара отсутствует: роут разведён СИБЛИНГОМ,
    // а не вложен в layout-route.
    expect(screen.queryByRole('navigation')).not.toBeInTheDocument()
  })

  it('БЕЗ права → «Доступ запрещён», документа нет', async () => {
    // credential ставится ОБЯЗАТЕЛЬНО: без него тест был бы зелёным по
    // редиректу на /login и про гейт права не доказывал бы ничего.
    grantPermissions(['status.view'])
    renderPrintPlacement()

    expect(await screen.findByText(ACCESS_DENIED_TEXT)).toBeInTheDocument()
    expect(document.querySelector('main.print-root')).not.toBeInTheDocument()
  })

  it('без credential: прямой заход по URL → редирект на /login', async () => {
    renderPrintPlacement()

    expect(
      await screen.findByLabelText('Идентификатор (X-User-Id)'),
    ).toBeInTheDocument()
    expect(document.querySelector('main.print-root')).not.toBeInTheDocument()
  })

  it('фабрика ROUTES собирает query и экранирует идентификатор', () => {
    expect(ROUTES.printPlacementTo(EVENT_ID)).toBe(
      `/print/placement?security_event_id=${EVENT_ID}`,
    )
    expect(ROUTES.printPlacementTo('a b&c')).toContain('a%20b%26c')
  })

  it('печатная форма НЕ добавлена в NAV_SECTIONS — не раздел портала', async () => {
    const { NAV_SECTIONS } = await import('../shared/routes')
    expect(
      NAV_SECTIONS.some((section) => section.route === ROUTES.printPlacement),
    ).toBe(false)
  })
})
