// @vitest-environment jsdom
// Story 14.11j: список+создание планов дежурств — реальная композиция
// Providers+AppRoutes (прецедент app-layout.qa.test.tsx), права — через
// server.use()-оверрайд /api/operations/my-permissions/ (Scope Decision:
// не заводим новую demo-персону в demo-personas.ts для одной стори).
import '@testing-library/jest-dom/vitest'
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
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

// jsdom не реализует <dialog> methods — прецедент ConflictDialog.test.tsx.
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
  initialEntry: string = ROUTES.dutyPlans,
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

describe('DutyPlansListPage', () => {
  it('AC-4: без duty.manage маршрут заблокирован', async () => {
    usePermissionsResponse({ permissions: ['status.view'] })
    renderApp()
    expect(await screen.findByText(ACCESS_DENIED_TEXT)).toBeInTheDocument()
  })

  it('AC-1: с duty.manage показывает таблицу планов', async () => {
    usePermissionsResponse({ permissions: ['duty.manage'] })
    server.use(
      http.get('*/api/operations/duty-plans/', () =>
        HttpResponse.json({
          count: 1,
          next: null,
          previous: null,
          results: [
            { id: 1, object: 5, year: 2026, month: 9, status_code: 'DRAFT' },
          ],
        }),
      ),
    )
    renderApp()
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Планы дежурств' }),
    ).toBeInTheDocument()
    const row = await screen.findByText('2026')
    expect(row).toBeInTheDocument()
    expect(screen.getByText('Сентябрь')).toBeInTheDocument()
    expect(screen.getByText('Черновик')).toBeInTheDocument()
  })

  it('AC-2: пустой список показывает сообщение, не пустую таблицу', async () => {
    usePermissionsResponse({ permissions: ['duty.manage'] })
    server.use(
      http.get('*/api/operations/duty-plans/', () =>
        HttpResponse.json({ count: 0, next: null, previous: null, results: [] }),
      ),
    )
    renderApp()
    expect(await screen.findByText('Планы дежурств не найдены')).toBeInTheDocument()
    expect(screen.queryByRole('table')).not.toBeInTheDocument()
  })

  it('AC-3: ошибка загрузки показывает сообщение, не падает', async () => {
    usePermissionsResponse({ permissions: ['duty.manage'] })
    server.use(
      http.get('*/api/operations/duty-plans/', () =>
        HttpResponse.json({ detail: 'Internal error' }, { status: 500 }),
      ),
    )
    renderApp()
    // Дефолтный retry queries (Providers не переопределяет его для query,
    // только для mutations) — до ~7с backoff на 3 повторах, RTL-дефолт 1с мал.
    expect(
      await screen.findByText(
        'Не удалось загрузить планы дежурств. Попробуйте обновить страницу.',
        {},
        { timeout: 10_000 },
      ),
    ).toBeInTheDocument()
  }, 15_000)

  it('AC-5/6: создание плана — форма, успех обновляет список, диалог закрывается', async () => {
    usePermissionsResponse({ permissions: ['duty.manage'] })
    // Стейтфулный мок (не статичный return): POST должен реально появиться
    // в следующем GET — иначе invalidateQueries()'s рефетч не докажет
    // AC-6 (список обновляется), только то, что мутация вернула 201.
    const plans: Array<{ id: number; object: number; year: number; month: number; status_code: string }> = []
    server.use(
      http.get('*/api/operations/duty-plans/', () =>
        HttpResponse.json({ count: plans.length, next: null, previous: null, results: plans }),
      ),
      http.post('*/api/operations/duty-plans/', () => {
        const plan = { id: 9, object: 5, year: 2026, month: 9, status_code: 'DRAFT' }
        plans.push(plan)
        return HttpResponse.json(plan, { status: 201 })
      }),
    )
    const user = userEvent.setup()
    renderApp()

    await screen.findByText('Планы дежурств не найдены')
    await user.click(screen.getByRole('button', { name: '+ Создать план' }))

    const dialog = await screen.findByRole('dialog')
    await user.type(within(dialog).getByLabelText('ID объекта'), '5')
    await user.type(within(dialog).getByLabelText('Год'), '2026')
    await user.type(within(dialog).getByLabelText('Месяц (1-12)'), '9')
    await user.click(within(dialog).getByRole('button', { name: 'Создать' }))

    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    })
    expect(await screen.findByText('Сентябрь')).toBeInTheDocument()
  })

  it('AC-7: 400 от сервера — инлайн-ошибка поля, форма остаётся открытой', async () => {
    usePermissionsResponse({ permissions: ['duty.manage'] })
    server.use(
      http.get('*/api/operations/duty-plans/', () =>
        HttpResponse.json({ count: 0, next: null, previous: null, results: [] }),
      ),
      http.post('*/api/operations/duty-plans/', () =>
        HttpResponse.json(
          {
            error_code: 'VALIDATION_ERROR',
            message: 'Ошибка валидации',
            details: { object: ['Объект не найден.'] },
            request_id: null,
            timestamp: '2026-07-31T00:00:00Z',
          },
          { status: 400 },
        ),
      ),
    )
    const user = userEvent.setup()
    renderApp()

    await screen.findByText('Планы дежурств не найдены')
    await user.click(screen.getByRole('button', { name: '+ Создать план' }))

    const dialog = await screen.findByRole('dialog')
    await user.type(within(dialog).getByLabelText('ID объекта'), '999')
    await user.type(within(dialog).getByLabelText('Год'), '2026')
    await user.type(within(dialog).getByLabelText('Месяц (1-12)'), '9')
    await user.click(within(dialog).getByRole('button', { name: 'Создать' }))

    expect(await screen.findByText('Объект не найден.')).toBeInTheDocument()
    expect(screen.getByRole('dialog')).toBeInTheDocument()
  })

  it('AC-7 (доп.): 409 дубль плана — серверное сообщение показано, не generic-текст, форма остаётся открытой', async () => {
    usePermissionsResponse({ permissions: ['duty.manage'] })
    server.use(
      http.get('*/api/operations/duty-plans/', () =>
        HttpResponse.json({ count: 0, next: null, previous: null, results: [] }),
      ),
      http.post('*/api/operations/duty-plans/', () =>
        HttpResponse.json(
          {
            error_code: 'DUTY_PLAN_ALREADY_EXISTS',
            message: 'План на этот месяц уже существует.',
            details: {},
            request_id: null,
            timestamp: '2026-07-31T00:00:00Z',
          },
          { status: 409 },
        ),
      ),
    )
    const user = userEvent.setup()
    renderApp()

    await screen.findByText('Планы дежурств не найдены')
    await user.click(screen.getByRole('button', { name: '+ Создать план' }))

    const dialog = await screen.findByRole('dialog')
    await user.type(within(dialog).getByLabelText('ID объекта'), '5')
    await user.type(within(dialog).getByLabelText('Год'), '2026')
    await user.type(within(dialog).getByLabelText('Месяц (1-12)'), '9')
    await user.click(within(dialog).getByRole('button', { name: 'Создать' }))

    expect(
      await screen.findByText('План на этот месяц уже существует.'),
    ).toBeInTheDocument()
    expect(screen.getByRole('dialog')).toBeInTheDocument()
  })
})
