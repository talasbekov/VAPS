// @vitest-environment jsdom
// Story 14.11k: деталь плана + грид смен — реальная композиция
// Providers+AppRoutes (прецедент duty-plans-list.qa.test.tsx/app-layout.qa.
// test.tsx), права — через server.use()-оверрайд.
import '@testing-library/jest-dom/vitest'
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { MemoryRouter } from 'react-router'
import { server } from '../shared/api/testing/server'
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
  initialEntry: string,
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

const PLAN = { id: 1, object: 5, year: 2026, month: 9, status_code: 'DRAFT' }

describe('DutyPlanDetailPage', () => {
  it('AC-1/3: заголовок плана + грид смен', async () => {
    usePermissionsResponse({ permissions: ['duty.manage'] })
    server.use(
      http.get('*/api/operations/duty-plans/', () =>
        HttpResponse.json({ count: 1, next: null, previous: null, results: [PLAN] }),
      ),
      http.get('*/api/operations/duty-plans/1/shifts/', () =>
        HttpResponse.json({
          count: 1,
          next: null,
          previous: null,
          results: [
            {
              id: 1,
              plan: 1,
              employee_id: '11111111-1111-1111-1111-111111111111',
              post: 3,
              duty_type: 2,
              duty_role_code: 'SENIOR',
              notes: '',
              starts_at: '2026-09-01T08:00:00Z',
              ends_at: '2026-09-01T20:00:00Z',
              cancelled_at: null,
              cancelled_by: null,
              cancelled_reason: '',
            },
          ],
        }),
      ),
    )
    renderApp(ROUTES.dutyPlanDetailTo(1))

    expect(
      await screen.findByRole('heading', {
        level: 1,
        name: 'Объект 5 — Сентябрь 2026',
      }),
    ).toBeInTheDocument()
    expect(screen.getByText('Черновик')).toBeInTheDocument()
    expect(
      await screen.findByText('11111111-1111-1111-1111-111111111111'),
    ).toBeInTheDocument()
    expect(screen.getByText('SENIOR')).toBeInTheDocument()
    expect(screen.getByText('Активна')).toBeInTheDocument()
  })

  it('AC-2: несуществующий id — не найдено + ссылка назад', async () => {
    usePermissionsResponse({ permissions: ['duty.manage'] })
    server.use(
      http.get('*/api/operations/duty-plans/', () =>
        HttpResponse.json({ count: 1, next: null, previous: null, results: [PLAN] }),
      ),
    )
    renderApp(ROUTES.dutyPlanDetailTo(999))

    expect(await screen.findByText('План не найден.')).toBeInTheDocument()
    expect(
      screen.getByRole('link', { name: '← Назад к списку планов' }),
    ).toHaveAttribute('href', ROUTES.dutyPlans)
  })

  it('AC-2 (доп.): битый :id (не число) — не найдено, БЕЗ запроса смен', async () => {
    usePermissionsResponse({ permissions: ['duty.manage'] })
    let shiftsRequested = false
    server.use(
      http.get('*/api/operations/duty-plans/', () =>
        HttpResponse.json({ count: 1, next: null, previous: null, results: [PLAN] }),
      ),
      http.get('*/api/operations/duty-plans/abc/shifts/', () => {
        shiftsRequested = true
        return HttpResponse.json({ count: 0, next: null, previous: null, results: [] })
      }),
    )
    renderApp(ROUTES.dutyPlanDetailTo('abc'))

    expect(await screen.findByText('План не найден.')).toBeInTheDocument()
    // Review (Blind Hunter/Edge Case Hunter): useDutyShifts должен быть
    // enabled только когда план разрешён — иначе лишний запрос на битый id.
    expect(shiftsRequested).toBe(false)
  })

  it('AC-4: пустой грид смен показывает сообщение', async () => {
    usePermissionsResponse({ permissions: ['duty.manage'] })
    server.use(
      http.get('*/api/operations/duty-plans/', () =>
        HttpResponse.json({ count: 1, next: null, previous: null, results: [PLAN] }),
      ),
      http.get('*/api/operations/duty-plans/1/shifts/', () =>
        HttpResponse.json({ count: 0, next: null, previous: null, results: [] }),
      ),
    )
    renderApp(ROUTES.dutyPlanDetailTo(1))

    expect(await screen.findByText('Смены не найдены')).toBeInTheDocument()
  })

  it('AC-5: строка списка планов ведёт на деталь-страницу', async () => {
    usePermissionsResponse({ permissions: ['duty.manage'] })
    server.use(
      http.get('*/api/operations/duty-plans/', () =>
        HttpResponse.json({ count: 1, next: null, previous: null, results: [PLAN] }),
      ),
    )
    renderApp(ROUTES.dutyPlans)

    const link = await screen.findByRole('link', { name: '5' })
    expect(link).toHaveAttribute('href', ROUTES.dutyPlanDetailTo(1))
  })

  it('AC-6/7: создание смены — форма, успех обновляет грид, ISO не зависит от TZ раннера', async () => {
    usePermissionsResponse({ permissions: ['duty.manage'] })
    const shifts: Array<Record<string, unknown>> = []
    let receivedBody: Record<string, unknown> | null = null
    server.use(
      http.get('*/api/operations/duty-plans/', () =>
        HttpResponse.json({ count: 1, next: null, previous: null, results: [PLAN] }),
      ),
      http.get('*/api/operations/duty-plans/1/shifts/', () =>
        HttpResponse.json({ count: shifts.length, next: null, previous: null, results: shifts }),
      ),
      http.post('*/api/operations/duty-plans/1/shifts/', async ({ request }) => {
        receivedBody = (await request.json()) as Record<string, unknown>
        const shift = {
          id: 7,
          plan: 1,
          employee_id: '22222222-2222-2222-2222-222222222222',
          post: null,
          duty_type: null,
          duty_role_code: '',
          notes: '',
          starts_at: '2026-09-05T08:00:00Z',
          ends_at: '2026-09-05T20:00:00Z',
          cancelled_at: null,
          cancelled_by: null,
          cancelled_reason: '',
        }
        shifts.push(shift)
        return HttpResponse.json(shift, { status: 201 })
      }),
    )
    const user = userEvent.setup()
    renderApp(ROUTES.dutyPlanDetailTo(1))

    await screen.findByText('Смены не найдены')
    await user.click(screen.getByRole('button', { name: '+ Создать смену' }))

    const dialog = await screen.findByRole('dialog')
    await user.type(
      within(dialog).getByLabelText('UUID сотрудника'),
      '22222222-2222-2222-2222-222222222222',
    )
    const startsInput = within(dialog).getByLabelText('Начало')
    const endsInput = within(dialog).getByLabelText('Окончание')
    // fireEvent через userEvent.type на datetime-local — value напрямую
    await user.click(startsInput)
    await user.paste('2026-09-05T08:00')
    await user.click(endsInput)
    await user.paste('2026-09-05T20:00')
    await user.click(within(dialog).getByRole('button', { name: 'Создать' }))

    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    })
    expect(
      await screen.findByText('22222222-2222-2222-2222-222222222222'),
    ).toBeInTheDocument()
    // Review (Blind Hunter/Edge Case Hunter): "08:00"/"20:00" вводятся как
    // wall-clock Asia/Qyzylorda (+05:00) — фиксирует ТОЧНОЕ ISO-значение,
    // не зависящее от таймзоны машины, где гоняется тест.
    expect(receivedBody).toMatchObject({
      starts_at: '2026-09-05T03:00:00.000Z',
      ends_at: '2026-09-05T15:00:00.000Z',
    })
  })

  it('AC-8: 400 (валидация) — инлайн-ошибка поля, форма остаётся открытой', async () => {
    usePermissionsResponse({ permissions: ['duty.manage'] })
    server.use(
      http.get('*/api/operations/duty-plans/', () =>
        HttpResponse.json({ count: 1, next: null, previous: null, results: [PLAN] }),
      ),
      http.get('*/api/operations/duty-plans/1/shifts/', () =>
        HttpResponse.json({ count: 0, next: null, previous: null, results: [] }),
      ),
      http.post('*/api/operations/duty-plans/1/shifts/', () =>
        HttpResponse.json(
          {
            error_code: 'VALIDATION_ERROR',
            message: 'Ошибка валидации',
            details: { employee_id: ['Некорректный UUID.'] },
            request_id: null,
            timestamp: '2026-07-31T00:00:00Z',
          },
          { status: 400 },
        ),
      ),
    )
    const user = userEvent.setup()
    renderApp(ROUTES.dutyPlanDetailTo(1))

    await screen.findByText('Смены не найдены')
    await user.click(screen.getByRole('button', { name: '+ Создать смену' }))

    const dialog = await screen.findByRole('dialog')
    await user.type(
      within(dialog).getByLabelText('UUID сотрудника'),
      '11111111-1111-1111-1111-111111111111',
    )
    await user.click(within(dialog).getByLabelText('Начало'))
    await user.paste('2026-09-05T08:00')
    await user.click(within(dialog).getByLabelText('Окончание'))
    await user.paste('2026-09-05T20:00')
    await user.click(within(dialog).getByRole('button', { name: 'Создать' }))

    expect(await screen.findByText('Некорректный UUID.')).toBeInTheDocument()
    expect(screen.getByRole('dialog')).toBeInTheDocument()
  })
})
