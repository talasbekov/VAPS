// @vitest-environment jsdom
// Календарь смен (§21.4, третье представление) + назначение смены с
// протоколом конфликтов (§36). Проверяется ЖИВОЙ путь через MSW: сетка недели,
// открытие формы из пустой клетки, 409 → общий ConflictDialog → повтор с
// причиной. Юнит-тесты репозитория (mocks/repository.test.ts) закрывают
// правила, здесь — что UI действительно ходит по этому протоколу.
import '@testing-library/jest-dom/vitest'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { afterEach, describe, expect, it } from 'vitest'

import { server } from '../../../shared/api/testing/server'
import { clearCredential, setCredential } from '../../../shared/auth/credential'
import { ToastProvider } from '../../../shared/ui/toast'
import { DutyPlanPage } from './DutyPlanPage'

afterEach(() => {
  cleanup()
  clearCredential()
  sessionStorage.clear()
})

// jsdom не реализует методы <dialog> (showModal/close) — минимальный полифилл
// open-семантики, тот же, что в ConflictDialog.test.tsx. Фокус-трап/top-layer
// им не эмулируются и здесь не ассертятся.
if (typeof HTMLDialogElement.prototype.showModal !== 'function') {
  HTMLDialogElement.prototype.showModal = function (this: HTMLDialogElement) {
    this.open = true
  }
  HTMLDialogElement.prototype.close = function (this: HTMLDialogElement) {
    this.open = false
    this.dispatchEvent(new Event('close'))
  }
}

// Понедельник 2026-07-20 — «сегодня» сервера; неделя пн 20 … вс 26.
const BUSINESS_DATE = '2026-07-20'

const ROSTER = [
  { employeeId: 'duty-emp-1', fullName: 'Ахметов Б.', unitLabel: 'Штабная группа' },
  { employeeId: 'duty-emp-2', fullName: 'Ерланов Д.', unitLabel: 'Резерв' },
]

const TARGETS = [
  { objectId: 'obj-1', targetType: 'OWN_OBJECT' as const, safeLabel: 'Штаб управления' },
]

const DUTY_TYPES = [
  {
    dutyTypeCode: 'OWN_OBJECT_DAILY',
    safeLabel: 'Суточное дежурство на собственном объекте',
    targetType: 'OWN_OBJECT' as const,
    defaultDurationMinutes: 1440,
    requiresSenior: true,
  },
]

const EXISTING_SHIFT = {
  id: 'shift-1',
  businessDate: '2026-07-22',
  dutyTypeCode: 'OWN_OBJECT_DAILY',
  target: TARGETS[0],
  employeeId: 'duty-emp-1',
  employeeName: 'Ахметов Б.',
  stateCode: 'PLANNED' as const,
  acknowledgedAt: null,
  actualStart: null,
  actualEnd: null,
  updatedAt: '2026-07-20T08:00:00+05:00',
}

function baseHandlers(createHandler: Parameters<typeof server.use>[0]) {
  server.use(
    http.get('*/api/operations/my-permissions/', () =>
      HttpResponse.json({ permissions: ['ops.duty.view', 'ops.duty.manage'] }),
    ),
    http.get('*/api/ops/duty-types/', () => HttpResponse.json({ results: DUTY_TYPES })),
    http.get('*/api/ops/duty-directory/', () =>
      HttpResponse.json({ targets: TARGETS, roster: ROSTER }),
    ),
    http.get('*/api/ops/duty-shifts/', () =>
      HttpResponse.json({ results: [EXISTING_SHIFT], businessDate: BUSINESS_DATE }),
    ),
    createHandler,
  )
}

function renderPage() {
  setCredential({ kind: 'dev', userId: 'planner-1' })
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  return render(
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <DutyPlanPage />
      </ToastProvider>
    </QueryClientProvider>,
  )
}

async function openCalendar(user: ReturnType<typeof userEvent.setup>) {
  await screen.findByRole('button', { name: 'Календарь' })
  await user.click(screen.getByRole('button', { name: 'Календарь' }))
}

describe('DutyPlanPage — календарь смен', () => {
  it('рисует неделю сервера: строки — весь ростер, существующая смена в своей клетке', async () => {
    baseHandlers(http.post('*/api/ops/duty-shifts/', () => HttpResponse.json({}, { status: 500 })))
    const user = userEvent.setup()
    renderPage()
    await openCalendar(user)

    // Заголовок недели считается от бизнес-даты СЕРВЕРА, а не от часов браузера.
    expect(await screen.findByText('20–26 июля 2026')).toBeInTheDocument()
    // Обе строки ростера присутствуют, даже та, у которой смен нет.
    expect(screen.getByRole('rowheader', { name: /Ахметов Б\./ })).toBeInTheDocument()
    expect(screen.getByRole('rowheader', { name: /Ерланов Д\./ })).toBeInTheDocument()
    expect(screen.getByText('Штаб управления')).toBeInTheDocument()
  })

  it('переключение недели уводит с недели с сеяной сменой и возвращает обратно', async () => {
    baseHandlers(http.post('*/api/ops/duty-shifts/', () => HttpResponse.json({}, { status: 500 })))
    const user = userEvent.setup()
    renderPage()
    await openCalendar(user)
    await screen.findByText('20–26 июля 2026')
    expect(screen.getByText('Штаб управления')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Следующая неделя' }))
    expect(await screen.findByText('27 июля – 2 августа 2026')).toBeInTheDocument()
    // Смена 22 июля в следующую неделю не протекла.
    expect(screen.queryByText('Штаб управления')).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Предыдущая неделя' }))
    expect(await screen.findByText('20–26 июля 2026')).toBeInTheDocument()
    expect(screen.getByText('Штаб управления')).toBeInTheDocument()
  })

  it('409 открывает общий ConflictDialog, повтор с причиной уходит с override в корне тела', async () => {
    const bodies: Record<string, unknown>[] = []
    baseHandlers(
      http.post('*/api/ops/duty-shifts/', async ({ request }) => {
        const body = (await request.json()) as Record<string, unknown>
        bodies.push(body)
        if (body.override !== true) {
          return HttpResponse.json(
            {
              error_code: 'DUTY_CONFLICT_DETECTED',
              message: 'Смежные сутки с другим дежурством сотрудника.',
              details: {
                conflicts: [
                  { conflict_code: 'REST_AFTER_DAILY_DUTY', employee_id: 'Ахметов Б.' },
                ],
              },
              request_id: null,
              timestamp: '2026-07-20T08:00:00+05:00',
            },
            { status: 409 },
          )
        }
        return HttpResponse.json({ ...EXISTING_SHIFT, id: 'shift-2' }, { status: 201 })
      }),
    )
    const user = userEvent.setup()
    renderPage()
    await openCalendar(user)
    await screen.findByText('20–26 июля 2026')

    // Пустая клетка «Ахметов Б., 23 июля» — соседняя с существующей сменой.
    await user.click(
      screen.getByRole('button', { name: 'Назначить смену: Ахметов Б., 2026-07-23' }),
    )

    const dialog = await screen.findByRole('dialog')
    await user.selectOptions(within(dialog).getByLabelText('Сотрудник'), 'duty-emp-1')
    await user.selectOptions(within(dialog).getByLabelText('Объект дежурства'), 'obj-1')
    await user.selectOptions(within(dialog).getByLabelText('Вид дежурства'), 'OWN_OBJECT_DAILY')
    await user.click(within(dialog).getByRole('button', { name: 'Назначить' }))

    // ConflictDialog — общий (shared/ui), не свой пер-фичевый.
    const conflictHeading = await screen.findByText(/Конфликт:/)
    expect(conflictHeading).toHaveTextContent('Смежные сутки')
    expect(screen.getByText(/REST_AFTER_DAILY_DUTY/)).toBeInTheDocument()

    await user.type(
      screen.getByLabelText('Причина (10–500 символов)'),
      'Замена заболевшего по устному распоряжению',
    )
    await user.click(screen.getByRole('button', { name: 'Подтвердить оверрайд' }))

    await waitFor(() => expect(bodies).toHaveLength(2))
    // Первый запрос — без обхода, второй — с override В КОРНЕ тела и причиной.
    expect(bodies[0].override).toBeUndefined()
    expect(bodies[1]).toMatchObject({
      override: true,
      override_reason: 'Замена заболевшего по устному распоряжению',
      businessDate: '2026-07-23',
      employeeId: 'duty-emp-1',
    })
  })

  it('422 (hard-block) показывается как неотменяемый отказ, без предложения обхода', async () => {
    baseHandlers(
      http.post('*/api/ops/duty-shifts/', () =>
        HttpResponse.json(
          {
            error_code: 'DUTY_DOUBLE_ASSIGNMENT',
            message: 'Сотрудник уже назначен на дежурство в этот день.',
            details: {},
            request_id: null,
            timestamp: '2026-07-20T08:00:00+05:00',
          },
          { status: 422 },
        ),
      ),
    )
    const user = userEvent.setup()
    renderPage()
    await openCalendar(user)
    await screen.findByText('20–26 июля 2026')

    await user.click(
      screen.getByRole('button', { name: 'Назначить смену: Ерланов Д., 2026-07-21' }),
    )
    const dialog = await screen.findByRole('dialog')
    await user.selectOptions(within(dialog).getByLabelText('Сотрудник'), 'duty-emp-2')
    await user.selectOptions(within(dialog).getByLabelText('Объект дежурства'), 'obj-1')
    await user.selectOptions(within(dialog).getByLabelText('Вид дежурства'), 'OWN_OBJECT_DAILY')
    await user.click(within(dialog).getByRole('button', { name: 'Назначить' }))

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Сотрудник уже назначен на дежурство в этот день.',
    )
    // Диалог обхода НЕ появился: hard-block причиной не обходится.
    expect(screen.queryByText(/Конфликт:/)).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Причина (10–500 символов)')).not.toBeInTheDocument()
  })

  it('без ops.duty.manage клетки не кликабельны', async () => {
    server.use(
      http.get('*/api/operations/my-permissions/', () =>
        HttpResponse.json({ permissions: ['ops.duty.view'] }),
      ),
      http.get('*/api/ops/duty-types/', () => HttpResponse.json({ results: DUTY_TYPES })),
      http.get('*/api/ops/duty-directory/', () =>
        HttpResponse.json({ targets: TARGETS, roster: ROSTER }),
      ),
      http.get('*/api/ops/duty-shifts/', () =>
        HttpResponse.json({ results: [EXISTING_SHIFT], businessDate: BUSINESS_DATE }),
      ),
    )
    const user = userEvent.setup()
    renderPage()
    await openCalendar(user)
    await screen.findByText('20–26 июля 2026')

    expect(screen.queryByRole('button', { name: /Назначить смену:/ })).not.toBeInTheDocument()
  })
})
