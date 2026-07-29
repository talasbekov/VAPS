// @vitest-environment jsdom
// Динамика на экране (§19.20). Главное свойство: экран рисует ПРИСЛАННОЕ и
// рвёт линию там, где промпт запрещает её вести — на смене методики и на
// периоде без агрегата.
import '@testing-library/jest-dom/vitest'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { server } from '../../../shared/api/testing/server'
import { clearCredential, setCredential } from '../../../shared/auth/credential'
import { RatingDynamicsSection } from './RatingDynamicsSection'
import type { RatingDynamicsResponse } from '../api/pending-contracts'
import type { RatingDynamicsPoint } from '../model/types'

const DYNAMICS_URL = '*/api/ops/operational-rating-dynamics/'
const V1 = 'OPERATIONAL-RATING-2026.01.1'
const V2 = 'OPERATIONAL-RATING-2026.05.1'

function point(
  period: string,
  aggregateRating: number | null,
  policyVersion: string,
): RatingDynamicsPoint {
  return {
    employeeId: 'employee-1',
    period,
    periodStartsAt: `${period}-01`,
    periodEndsAt: `${period}-28`,
    aggregateRating,
    evaluationsCount: aggregateRating === null ? 2 : 5,
    policyVersion,
    dataState: aggregateRating === null ? 'INSUFFICIENT_DATA' : 'READY',
    recordedAt: `${period}-28T23:59:00+05:00`,
  }
}

function response(overrides: Partial<RatingDynamicsResponse> = {}): RatingDynamicsResponse {
  return {
    employeeId: 'employee-1',
    safeLabel: 'Ерланов Д.',
    // Пропуск (2026-03) и смена методики (2026-05) РАЗВЕДЕНЫ по разным
    // периодам намеренно: совпади они, тест не отличил бы разрыв по методике
    // от разрыва по отсутствующему агрегату — и не заметил бы потери первого.
    points: [
      point('2026-02', 8.1, V1),
      point('2026-03', null, V1),
      point('2026-04', 7.9, V1),
      point('2026-05', 8.4, V2),
      point('2026-06', 8.6, V2),
    ],
    boundaries: [{ period: '2026-05', fromPolicyVersion: V1, toPolicyVersion: V2 }],
    currentPolicy: {
      periodDays: 105,
      minEvaluations: 4,
      policyVersion: 'OPERATIONAL-RATING-2026.07.1',
    },
    currentPolicyHasClosedPeriods: false,
    capabilities: { operationalRatings: true },
    employees: [
      { employeeId: 'employee-1', safeLabel: 'Ерланов Д.' },
      { employeeId: 'employee-2', safeLabel: 'Абишев Н.' },
    ],
    ...overrides,
  }
}

function renderSection() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  )
  return render(<RatingDynamicsSection />, { wrapper })
}

/** Вершины линий — то, что реально соединено на графике. */
function polylinePoints(): string[][] {
  return Array.from(document.querySelectorAll('polyline')).map((node) =>
    (node.getAttribute('points') ?? '').trim().split(/\s+/).filter(Boolean),
  )
}

beforeEach(() => {
  setCredential({ kind: 'dev', userId: 'demo-analyst' })
})

afterEach(() => {
  cleanup()
  clearCredential()
})

describe('динамика агрегата (§19.20)', () => {
  it('несопоставимые периоды не соединены одной линией', async () => {
    server.use(http.get(DYNAMICS_URL, () => HttpResponse.json(response())))
    renderSection()
    await screen.findByText('8,1')
    // Три отрезка: 2026-02 (одиночная точка перед пропуском), 2026-04
    // (одиночная перед сменой методики) и 2026-05+2026-06 под новой методикой.
    // Слитая линия означала бы соединение несопоставимых периодов.
    const lines = polylinePoints()
    expect(lines.map((line) => line.length)).toEqual([1, 1, 2])
  })

  it('период без агрегата не становится вершиной и не печатается нулём', async () => {
    server.use(http.get(DYNAMICS_URL, () => HttpResponse.json(response())))
    renderSection()
    const table = await screen.findByRole('table')
    const row = within(table).getByRole('row', { name: /2026-03/ })
    expect(within(row).getByText('Недостаточно данных')).toBeInTheDocument()
    expect(within(table).queryByText('0,0')).not.toBeInTheDocument()
    // Всего вершин на графике — ровно четыре, по числу присланных агрегатов.
    expect(polylinePoints().flat()).toHaveLength(4)
  })

  it('граница смены методики обозначена и объяснена', async () => {
    server.use(http.get(DYNAMICS_URL, () => HttpResponse.json(response())))
    renderSection()
    expect(await screen.findByText('смена методики')).toBeInTheDocument()
    expect(screen.getByText(/сравнивать их как однородный ряд нельзя/)).toBeInTheDocument()
  })

  it('однородный ряд границы не рисует', async () => {
    server.use(
      http.get(DYNAMICS_URL, () =>
        HttpResponse.json(
          response({
            points: [point('2026-02', 8.1, V1), point('2026-04', 7.9, V1)],
            boundaries: [],
          }),
        ),
      ),
    )
    renderSection()
    await screen.findByText('8,1')
    expect(screen.queryByText('смена методики')).not.toBeInTheDocument()
    expect(screen.getByText(/по одной методике/)).toBeInTheDocument()
  })

  it('tooltip точки несёт версию методики (§19.20)', async () => {
    server.use(http.get(DYNAMICS_URL, () => HttpResponse.json(response())))
    renderSection()
    await screen.findByText('8,1')
    const titles = Array.from(document.querySelectorAll('svg title')).map(
      (node) => node.textContent ?? '',
    )
    expect(titles).toContain(`2026-02: Агрегат 8,1. Учтено оценок: 5. Методика: ${V1}`)
    // У точки без агрегата tooltip тоже есть — и говорит состояние, а не ноль.
    expect(titles).toContain(`2026-03: Недостаточно данных. Учтено оценок: 2. Методика: ${V1}`)
  })

  it('действующая методика, не закрывшая ни одного периода, названа прямо', async () => {
    server.use(http.get(DYNAMICS_URL, () => HttpResponse.json(response())))
    renderSection()
    expect(await screen.findByText(/ещё не закрывала/)).toBeInTheDocument()
    expect(screen.getByText('OPERATIONAL-RATING-2026.07.1')).toBeInTheDocument()
  })

  it('методика, закрывшая периоды, лишней оговорки не печатает', async () => {
    server.use(
      http.get(DYNAMICS_URL, () =>
        HttpResponse.json(response({ currentPolicyHasClosedPeriods: true })),
      ),
    )
    renderSection()
    await screen.findByText('8,1')
    expect(screen.queryByText(/ещё не закрывала/)).not.toBeInTheDocument()
  })

  it('выбор сотрудника уходит на сервер, а не фильтруется на экране', async () => {
    const requested: (string | null)[] = []
    server.use(
      http.get(DYNAMICS_URL, ({ request }) => {
        const employee = new URL(request.url).searchParams.get('employee')
        requested.push(employee)
        return HttpResponse.json(
          employee === 'employee-2'
            ? response({
                employeeId: 'employee-2',
                safeLabel: 'Абишев Н.',
                points: [point('2026-06', 7.9, V2)],
                boundaries: [],
              })
            : response(),
        )
      }),
    )
    renderSection()
    await screen.findByText('8,1')
    await userEvent.selectOptions(screen.getByLabelText('Сотрудник'), 'employee-2')
    await waitFor(() => expect(requested).toContain('employee-2'))
    // Ряд именно перезапрошен: экран не режет уже полученный ответ по
    // сотруднику — точек другого сотрудника у него и нет.
    expect(await screen.findByText('7,9')).toBeInTheDocument()
    expect(screen.queryByText('8,1')).not.toBeInTheDocument()
  })

  it('выключенная функция объясняет пустоту, а не рисует нулевую линию', async () => {
    server.use(
      http.get(DYNAMICS_URL, () =>
        HttpResponse.json(
          response({
            points: [],
            boundaries: [],
            capabilities: { operationalRatings: false },
          }),
        ),
      ),
    )
    renderSection()
    expect(await screen.findByText(/выключен сервером/)).toBeInTheDocument()
    expect(document.querySelector('polyline')).toBeNull()
  })
})
