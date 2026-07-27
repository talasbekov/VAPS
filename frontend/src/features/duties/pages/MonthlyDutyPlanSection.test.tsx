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
import type { MonthlyDutyPlan } from '../lib/monthlyPlan'
import { MonthlyDutyPlanSection } from './MonthlyDutyPlanSection'

const PLAN_URL = '*/api/ops/duty-monthly-plan/'

function plan(month: string, overrides: Partial<MonthlyDutyPlan> = {}): MonthlyDutyPlan {
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
      notAcknowledged: 1,
      completed: 0,
      hardConflicts: 1,
      softConflicts: 0,
    },
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
    ...overrides,
  }
}

/** Отдаёт свой ответ на каждый месяц и запоминает запрошенные месяцы. */
function mockPlanByMonth(byMonth: Record<string, MonthlyDutyPlan>): string[] {
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

function renderSection(initialMonth = '2026-07'): void {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={client}>
        <ToastProvider>{children}</ToastProvider>
      </QueryClientProvider>
    )
  }
  render(<MonthlyDutyPlanSection initialMonth={initialMonth} />, { wrapper: Wrapper })
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
})
