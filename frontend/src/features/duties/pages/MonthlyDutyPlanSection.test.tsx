// @vitest-environment jsdom
// Месячный план (§21.27-21.30). Проверяется главное свойство экрана: он
// НИЧЕГО не выводит сам — KPI и severity берутся из ответа (§21.29 «не
// вычисляй итог по отрисованной части календаря», §21.34 «frontend не
// определяет severity самостоятельно»).
//
// ⚠️ Фикстура прав не нужна: гейт (`ops.duty.view`) стоит СНАРУЖИ, в роутере.
import '@testing-library/jest-dom/vitest'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { server } from '../../../shared/api/testing/server'
import { clearCredential, setCredential } from '../../../shared/auth/credential'
import { ToastProvider } from '../../../shared/ui/toast'
import { daysInMonth } from '../lib/monthlyPlan'
import type { MonthlyDutyPlanResponse } from '../api/pending-contracts'
import type { DutyPlanAction, MonthlyPlanHeader } from '../lib/planLifecycle'
import type { MonthlyPlanRecord } from '../model/types'
import { MonthlyDutyPlanSection } from './MonthlyDutyPlanSection'

const PLAN_URL = '*/api/ops/duty-monthly-plan/'

/** Шапка §21.28 по умолчанию: плана нет, всё, кроме формирования черновика,
 * недоступно — ровно то состояние, с которого месяц начинается в сиде. */
function header(month: string, overrides: Partial<MonthlyPlanHeader> = {}): MonthlyPlanHeader {
  return {
    month,
    record: null,
    objectSource: {
      registryLabel: 'Реестр объектов (паспорта, секторы и посты)',
      knownObjects: 1,
      unknownObjects: 0,
    },
    actions: [
      { code: 'CREATE_DRAFT', label: 'Сформировать черновик', enabled: true, reason: null },
      {
        code: 'CHECK_CONFLICTS',
        label: 'Проверить конфликты',
        enabled: false,
        reason: 'Плана на этот месяц нет — сначала сформируйте черновик.',
      },
      {
        code: 'APPROVE',
        label: 'Утвердить план',
        enabled: false,
        reason: 'Плана на этот месяц нет — сначала сформируйте черновик.',
      },
      {
        code: 'REOPEN',
        label: 'Открыть новую редакцию',
        enabled: false,
        reason: 'Новая редакция открывается только для утверждённого плана.',
      },
      { code: 'EXPORT', label: 'Экспортировать', enabled: false, reason: 'Экспорт не реализован.' },
      { code: 'ADD_SHIFT', label: 'Добавить дежурство', enabled: true, reason: null },
    ] satisfies DutyPlanAction[],
    unavailableFields: [
      { code: 'USER_SCOPE', label: 'Scope пользователя', reason: 'Плоский список прав.' },
    ],
    unavailableApprovalEffects: [
      { code: 'PARTICIPANT_NOTIFICATIONS', label: 'Уведомления', reason: 'Нет реестра адресатов.' },
    ],
    ...overrides,
  }
}

function planRecord(
  month: string,
  overrides: Partial<MonthlyPlanRecord> = {},
): MonthlyPlanRecord {
  return {
    month,
    stateCode: 'DRAFT',
    revision: 1,
    createdAt: '2026-07-01T09:00:00.000Z',
    lastValidation: null,
    approvedAt: null,
    approvedBy: null,
    history: [
      {
        at: '2026-07-01T09:00:00.000Z',
        revision: 1,
        event: 'DRAFT_CREATED',
        note: 'Черновик плана сформирован.',
      },
    ],
    ...overrides,
  }
}

function plan(
  month: string,
  overrides: Partial<MonthlyDutyPlanResponse> = {},
): MonthlyDutyPlanResponse {
  const days = daysInMonth(month)
  return {
    month,
    days,
    rows: [
      {
        objectId: 'object-1',
        objectLabel: 'Штаб управления',
        cells: days.map((date) => ({
          date,
          shiftCount: date === `${month}-22` ? 1 : 0,
          cancelledCount: 0,
          notAcknowledgedCount: date === `${month}-22` ? 1 : 0,
          completedCount: 0,
          hardConflictCount: date === `${month}-22` ? 1 : 0,
          softConflictCount: 0,
        })),
      },
    ],
    kpi: {
      objectsInPlan: 1,
      shifts: 1,
      cancelled: 0,
      notAcknowledged: 1,
      completed: 0,
      hardConflicts: 1,
      softConflicts: 0,
    },
    employeeRows: [],
    unavailableLayers: [],
    conflicts: [
      {
        conflictId: 'overlap:Жумабаев Р.:2026-07-22',
        code: 'DUTY_OVERLAP',
        severity: 'HARD',
        employeeName: 'Жумабаев Р.',
        businessDate: `${month}-22`,
        message: 'Жумабаев Р.: 2 дежурства в один день.',
      },
    ],
    unavailableMetrics: [
      { code: 'STAFFING_COMPLETENESS', label: 'Укомплектовано', reason: 'Нет требуемой численности.' },
    ],
    header: header(month),
    ...overrides,
  }
}

/** Отдаёт свой ответ на каждый месяц и запоминает запрошенные месяцы. */
function mockPlanByMonth(byMonth: Record<string, MonthlyDutyPlanResponse>): string[] {
  const requested: string[] = []
  server.use(
    http.get(PLAN_URL, ({ request }) => {
      const month = new URL(request.url).searchParams.get('month') ?? ''
      requested.push(month)
      const payload = byMonth[month]
      if (payload === undefined) return HttpResponse.json({ detail: 'not seeded' }, { status: 404 })
      return HttpResponse.json(payload)
    }),
  )
  return requested
}

function renderSection(initialMonth = '2026-07'): { addShiftCalls: number[] } {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const calls: number[] = []
  function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={client}>
        <ToastProvider>{children}</ToastProvider>
      </QueryClientProvider>
    )
  }
  render(
    <MonthlyDutyPlanSection
      initialMonth={initialMonth}
      onAddShift={() => calls.push(calls.length + 1)}
    />,
    { wrapper: Wrapper },
  )
  return {
    get addShiftCalls() {
      return calls
    },
  }
}

beforeEach(() => {
  setCredential({ kind: 'dev', userId: 'operator-1' })
})

afterEach(() => {
  cleanup()
  clearCredential()
})

describe('Месячный план дежурств', () => {
  it('KPI печатаются ИЗ ОТВЕТА, а не пересчитываются по нарисованной сетке', async () => {
    // Сетка содержит одну смену, сервер сообщает 42 — на экране обязано быть
    // серверное число. Если бы страница считала сама, здесь была бы 1.
    mockPlanByMonth({
      '2026-07': plan('2026-07', {
        kpi: {
          objectsInPlan: 7,
          cancelled: 0,
          shifts: 42,
          notAcknowledged: 5,
          completed: 3,
          hardConflicts: 2,
          softConflicts: 1,
        },
      }),
    })
    renderSection()

    expect(await screen.findByText('42')).toBeInTheDocument()
    expect(screen.getByText('7')).toBeInTheDocument()
    expect(screen.getByText('Дежурств')).toBeInTheDocument()
  })

  it('severity берётся из ответа: тот же код конфликта с SOFT подписан как soft', async () => {
    const soft = plan('2026-07')
    soft.conflicts = [{ ...soft.conflicts[0], severity: 'SOFT' }]
    mockPlanByMonth({ '2026-07': soft })
    renderSection()

    expect(await screen.findByText('Soft-конфликт')).toBeInTheDocument()
    expect(screen.queryByText('Hard-конфликт')).not.toBeInTheDocument()
    expect(screen.getByText('Жумабаев Р.: 2 дежурства в один день.')).toBeInTheDocument()
  })

  it('переключение месяца запрашивает соседний месяц и показывает его данные', async () => {
    const requested = mockPlanByMonth({
      '2026-07': plan('2026-07'),
      '2026-08': plan('2026-08', {
        kpi: {
          objectsInPlan: 2,
          cancelled: 0,
          shifts: 9,
          notAcknowledged: 5,
          completed: 4,
          hardConflicts: 0,
          softConflicts: 0,
        },
        conflicts: [],
      }),
    })
    renderSection()

    expect(await screen.findByText('июль 2026')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Следующий месяц' }))

    expect(await screen.findByText('август 2026')).toBeInTheDocument()
    await waitFor(() => expect(screen.getByText('9')).toBeInTheDocument())
    expect(requested).toEqual(['2026-07', '2026-08'])
    expect(
      screen.getByText('Конфликтов не найдено: ни пересечений дежурств, ни нарушений обязательного отдыха.'),
    ).toBeInTheDocument()
  })

  it('пустой месяц назван словами, а не пустой таблицей', async () => {
    mockPlanByMonth({
      '2026-09': plan('2026-09', {
        rows: [],
        conflicts: [],
        kpi: {
          objectsInPlan: 0,
          cancelled: 0,
          shifts: 0,
          notAcknowledged: 0,
          completed: 0,
          hardConflicts: 0,
          softConflicts: 0,
        },
      }),
    })
    renderSection('2026-09')

    expect(await screen.findByText('В этом месяце дежурств не запланировано')).toBeInTheDocument()
  })

  it('невыводимый показатель показан с причиной, а не нулём в KPI', async () => {
    mockPlanByMonth({ '2026-07': plan('2026-07') })
    renderSection()

    expect(await screen.findByText('Показатели, которых нет в модели')).toBeInTheDocument()
    expect(screen.getByText('Укомплектовано')).toBeInTheDocument()
    expect(screen.getByText(/Нет требуемой численности\./)).toBeInTheDocument()
  })

  it('§21.30: матрица «по сотрудникам» рисует СЕРВЕРНЫЕ слои, а не выводит их сама', async () => {
    server.use(
      http.get(PLAN_URL, () =>
        HttpResponse.json(
          plan('2026-07', {
            employeeRows: [
              {
                employeeName: 'Ахметов Б.',
                cells: daysInMonth('2026-07').map((date) => ({
                  date,
                  // Заведомо «неправильная» раскладка: в день дежурства сервер
                  // прислал REST, а конфликт стоит в дне БЕЗ дежурства. Матрица
                  // обязана нарисовать это как есть — своей логики у неё нет.
                  layer: date === '2026-07-10' ? 'REST' : 'FREE',
                  dutyCount: 0,
                  hardConflictCount: date === '2026-07-11' ? 1 : 0,
                  softConflictCount: 0,
                  incompleteData: date === '2026-07-12',
                })),
              },
            ],
            unavailableLayers: [
              {
                code: 'HR_UNAVAILABILITY_LAYER',
                label: 'Кадровая недоступность',
                reason: 'Employee Status Repository отсутствует.',
              },
            ],
          }),
        ),
      ),
    )
    renderSection()
    await screen.findByRole('group', { name: 'Дежурств' })

    await userEvent.click(screen.getByRole('button', { name: 'Сотрудники × дни' }))
    expect(await screen.findByText('Ахметов Б.')).toBeInTheDocument()
    // Клетка читается словами, а не только цветом (WCAG 1.4.1).
    expect(
      screen.getByText('2026-07-10, обязательный отдых после дежурства'),
    ).toBeInTheDocument()
    expect(screen.getByText('2026-07-11, дежурств нет, жёстких конфликтов: 1')).toBeInTheDocument()
    expect(
      screen.getByText(
        '2026-07-12, дежурств нет, неполные данные: нет привязки к версии паспорта',
      ),
    ).toBeInTheDocument()
    // §35: невыводимые слои названы с причиной.
    expect(screen.getByText('Слои, которых нет в модели')).toBeInTheDocument()
    expect(screen.getByText(/Employee Status Repository отсутствует\./)).toBeInTheDocument()
  })

  it('переключение представлений не делает второго запроса за месяцем', async () => {
    let requests = 0
    server.use(
      http.get(PLAN_URL, () => {
        requests += 1
        return HttpResponse.json(
          plan('2026-07', {
            employeeRows: [
              {
                employeeName: 'Ахметов Б.',
                cells: daysInMonth('2026-07').map((date) => ({
                  date,
                  layer: 'FREE' as const,
                  dutyCount: 0,
                  hardConflictCount: 0,
                  softConflictCount: 0,
                  incompleteData: false,
                })),
              },
            ],
          }),
        )
      }),
    )
    renderSection()
    await screen.findByRole('group', { name: 'Дежурств' })
    expect(requests).toBe(1)

    await userEvent.click(screen.getByRole('button', { name: 'Сотрудники × дни' }))
    expect(await screen.findByText('Ахметов Б.')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Объекты × дни' }))
    // §21.4/§21.30 — это ПРЕДСТАВЛЕНИЯ одного ответа, а не два источника.
    expect(requests).toBe(1)
  })
})

describe('Шапка месячного плана (§21.27-21.28)', () => {
  it('доступность кнопок берётся ИЗ ОТВЕТА, а не выводится из состояния плана', async () => {
    // Сервер говорит: план утверждён, но «Утвердить план» ДОСТУПНО. Экран,
    // который выводит доступность сам, здесь показал бы кнопку выключенной —
    // §21.28 требует ровно обратного (action policy приходит с сервера).
    mockPlanByMonth({
      '2026-07': plan('2026-07', {
        header: header('2026-07', {
          record: planRecord('2026-07', { stateCode: 'APPROVED', revision: 3 }),
          actions: [
            { code: 'CREATE_DRAFT', label: 'Сформировать черновик', enabled: false, reason: 'нельзя' },
            { code: 'CHECK_CONFLICTS', label: 'Проверить конфликты', enabled: false, reason: 'нельзя' },
            { code: 'APPROVE', label: 'Утвердить план', enabled: true, reason: null },
            { code: 'REOPEN', label: 'Открыть новую редакцию', enabled: false, reason: 'нельзя' },
            { code: 'EXPORT', label: 'Экспортировать', enabled: false, reason: 'нельзя' },
            { code: 'ADD_SHIFT', label: 'Добавить дежурство', enabled: false, reason: 'нельзя' },
          ],
        }),
      }),
    })
    renderSection()

    expect(await screen.findByRole('button', { name: 'Утвердить план' })).toBeEnabled()
    expect(screen.getByRole('button', { name: 'Открыть новую редакцию' })).toBeDisabled()
  })

  it('причина недоступности видна текстом, а не только в подсказке выключенной кнопки', async () => {
    mockPlanByMonth({ '2026-07': plan('2026-07') })
    renderSection()

    // Выключенная кнопка не получает фокус — title недостижим с клавиатуры.
    expect(await screen.findByRole('button', { name: 'Проверить конфликты' })).toBeDisabled()
    // Причина видна у КАЖДОГО недоступного действия, а не у одного: две кнопки
    // закрыты одной и той же причиной, и обе обязаны её назвать.
    const reasons = screen
      .getAllByRole('listitem')
      .map((item) => item.textContent ?? '')
      .filter((text) => text.includes('сначала сформируйте черновик'))
    expect(reasons).toHaveLength(2)
    expect(reasons[0]).toContain('Проверить конфликты')
    expect(reasons[1]).toContain('Утвердить план')
  })

  it('месяц без плана назван «черновик не сформирован», а не пустым состоянием', async () => {
    mockPlanByMonth({ '2026-07': plan('2026-07') })
    renderSection()

    expect(await screen.findByText('Черновик не сформирован')).toBeInTheDocument()
    expect(screen.getByText('Проверка конфликтов не проводилась')).toBeInTheDocument()
    // Редакции у несформированного плана нет — прочерк, а не «1».
    expect(screen.getByText('Редакция').nextElementSibling).toHaveTextContent('—')
  })

  it('утверждённый план: состояние, редакция и результат проверки — из ответа', async () => {
    mockPlanByMonth({
      '2026-07': plan('2026-07', {
        header: header('2026-07', {
          record: planRecord('2026-07', {
            stateCode: 'APPROVED',
            revision: 2,
            approvedAt: '2026-07-05T11:30:00.000Z',
            approvedBy: 'demo-objects-admin',
            lastValidation: {
              checkedAt: '2026-07-05T11:00:00.000Z',
              hardConflicts: 0,
              softConflicts: 2,
              passed: true,
              planFingerprint: 'fp-1',
            },
          }),
        }),
      }),
    })
    renderSection()

    expect(await screen.findByText('Утверждён')).toBeInTheDocument()
    expect(screen.getByText('Редакция').nextElementSibling).toHaveTextContent('2')
    expect(screen.getByText(/пройдена$/)).toBeInTheDocument()
    expect(screen.getByText(/изменения выполняются через новую/)).toBeInTheDocument()
  })

  it('провалившаяся проверка названа числом жёстких конфликтов, а не словом «ошибка»', async () => {
    mockPlanByMonth({
      '2026-07': plan('2026-07', {
        header: header('2026-07', {
          record: planRecord('2026-07', {
            lastValidation: {
              checkedAt: '2026-07-05T11:00:00.000Z',
              hardConflicts: 3,
              softConflicts: 0,
              passed: false,
              planFingerprint: 'fp-1',
            },
          }),
        }),
      }),
    })
    renderSection()

    expect(await screen.findByText(/не пройдена \(жёстких конфликтов 3\)/)).toBeInTheDocument()
  })

  it('«Добавить дежурство» уводит туда, где живёт форма, а не шлёт мутацию', async () => {
    mockPlanByMonth({ '2026-07': plan('2026-07') })
    const section = renderSection()

    await userEvent.click(await screen.findByRole('button', { name: 'Добавить дежурство' }))
    expect(section.addShiftCalls).toHaveLength(1)
  })

  it('история плана показана целиком и в порядке событий (§21.27 «не перезаписывается»)', async () => {
    mockPlanByMonth({
      '2026-07': plan('2026-07', {
        header: header('2026-07', {
          record: planRecord('2026-07', {
            revision: 2,
            history: [
              { at: '2026-07-01T09:00:00.000Z', revision: 1, event: 'DRAFT_CREATED', note: 'создан' },
              { at: '2026-07-02T09:00:00.000Z', revision: 1, event: 'APPROVED', note: 'утверждён' },
              { at: '2026-07-03T09:00:00.000Z', revision: 2, event: 'REOPENED', note: 'переоткрыт' },
            ],
          }),
        }),
      }),
    })
    renderSection()

    await userEvent.click(await screen.findByText('История плана (3)'))
    const entries = screen.getAllByRole('listitem').filter((item) => /редакция \d/.test(item.textContent ?? ''))
    expect(entries.map((item) => item.textContent)).toEqual([
      expect.stringContaining('Сформирован черновик'),
      expect.stringContaining('План утверждён'),
      expect.stringContaining('Открыта новая редакция'),
    ])
  })

  it('нажатие «Сформировать черновик» шлёт месяц ЭКРАНА, а не текущий месяц машины', async () => {
    const bodies: unknown[] = []
    mockPlanByMonth({ '2026-07': plan('2026-07'), '2026-08': plan('2026-08') })
    server.use(
      http.post('*/api/ops/duty-monthly-plan/draft/', async ({ request }) => {
        bodies.push(await request.json())
        return HttpResponse.json(planRecord('2026-08'))
      }),
    )
    renderSection()

    await screen.findByText('Черновик не сформирован')
    await userEvent.click(screen.getByRole('button', { name: 'Следующий месяц' }))
    expect(await screen.findByText('август 2026')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Сформировать черновик' }))

    await waitFor(() => expect(bodies).toEqual([{ month: '2026-08' }]))
  })
})
