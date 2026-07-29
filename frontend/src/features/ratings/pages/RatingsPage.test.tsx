// @vitest-environment jsdom
// Сводный экран рейтинга (§19.19/§22.16). Главное свойство: экран печатает
// присланное и не считает ничего сам — ни среднего, ни округления, ни
// состояния «недостаточно данных».
import '@testing-library/jest-dom/vitest'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen, within } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import type { ReactNode } from 'react'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { server } from '../../../shared/api/testing/server'
import { clearCredential, setCredential } from '../../../shared/auth/credential'
import { RatingsPage } from './RatingsPage'
import type { ListOperationalRatingsResponse } from '../api/pending-contracts'
import type { OperationalRatingSummary } from '../model/types'

const RATINGS_URL = '*/api/ops/operational-ratings/'
const DYNAMICS_URL = '*/api/ops/operational-rating-dynamics/'

function summary(overrides: Partial<OperationalRatingSummary> = {}): OperationalRatingSummary {
  return {
    employeeId: 'employee-1',
    safeLabel: 'Ерланов Д.',
    aggregateRating: 8.6,
    evaluationsCount: 5,
    periodStartsAt: '2026-04-07',
    periodEndsAt: '2026-07-20',
    calculationPolicyVersion: 'OPERATIONAL-RATING-2026.07.1',
    calculatedAt: '2026-07-20T08:00:00+05:00',
    dataState: 'READY',
    ...overrides,
  }
}

function response(
  overrides: Partial<ListOperationalRatingsResponse> = {},
): ListOperationalRatingsResponse {
  return {
    results: [summary()],
    policy: {
      periodDays: 105,
      minEvaluations: 4,
      policyVersion: 'OPERATIONAL-RATING-2026.07.1',
    },
    capabilities: { operationalRatings: true, ratingConflicts: false },
    unavailableFactors: [
      { code: 'EVALUATOR_WEIGHTS', label: 'Веса оценщиков', reason: 'Модель весов не заведена.' },
    ],
    unavailableViews: [
      { code: 'OWN_RATING', label: 'Собственный рейтинг смотрящего', reason: 'Связи нет.' },
    ],
    ...overrides,
  }
}

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>
      <MemoryRouter>{children}</MemoryRouter>
    </QueryClientProvider>
  )
  return render(<RatingsPage />, { wrapper })
}

beforeEach(() => {
  setCredential({ kind: 'dev', userId: 'demo-analyst' })
  // Динамика (§19.20) — свой запрос, свой экран и свои тесты
  // (`RatingDynamicsSection.test.tsx`). Здесь она отвечает пустым рядом: этот
  // файл проверяет СВОДКУ, а вторая таблица на странице ломала бы структурную
  // проверку колонок §22.16, ничего при этом не доказывая.
  server.use(
    http.get(DYNAMICS_URL, () =>
      HttpResponse.json({
        employeeId: 'employee-1',
        safeLabel: 'Ерланов Д.',
        points: [],
        boundaries: [],
        currentPolicy: null,
        currentPolicyHasClosedPeriods: false,
        capabilities: { operationalRatings: true },
        employees: [{ employeeId: 'employee-1', safeLabel: 'Ерланов Д.' }],
      }),
    ),
  )
})

afterEach(() => {
  cleanup()
  clearCredential()
})

describe('сводка рейтинга на экране', () => {
  it('печатает каноническое значение как ПРИСЛАНО, не округляя его сам', async () => {
    // Сервер прислал два знака — экран обязан показать оба: округление на
    // клиенте прямо запрещено §19.19.
    server.use(
      http.get(RATINGS_URL, () =>
        HttpResponse.json(response({ results: [summary({ aggregateRating: 8.64 })] })),
      ),
    )
    renderPage()
    expect(await screen.findByText('8,64')).toBeInTheDocument()
  })

  it('методика, период и минимум приходят с сервера и названы на экране', async () => {
    server.use(http.get(RATINGS_URL, () => HttpResponse.json(response())))
    renderPage()
    expect(await screen.findByText('OPERATIONAL-RATING-2026.07.1')).toBeInTheDocument()
    expect(screen.getByText('105 сут.')).toBeInTheDocument()
  })

  it('отсутствие рейтинга печатается состоянием, а НЕ нулём', async () => {
    server.use(
      http.get(RATINGS_URL, () =>
        HttpResponse.json(
          response({
            results: [
              summary({ aggregateRating: null, evaluationsCount: 2, dataState: 'INSUFFICIENT_DATA' }),
            ],
          }),
        ),
      ),
    )
    renderPage()
    expect(await screen.findByText('Недостаточно данных')).toBeInTheDocument()
    // Ни «0», ни «0,0» на экране быть не должно (§19.19 «Не показывай 0,0»).
    expect(screen.queryByText('0,0')).not.toBeInTheDocument()
    expect(screen.queryByText('0')).not.toBeInTheDocument()
  })

  it('методику решает СЕРВЕР: пустая политика печатается его формулировкой', async () => {
    server.use(
      http.get(RATINGS_URL, () =>
        HttpResponse.json(
          response({
            policy: null,
            results: [summary({ aggregateRating: null, dataState: 'POLICY_UNDEFINED' })],
          }),
        ),
      ),
    )
    renderPage()
    // Формулировка одна на ДВА места (панель методики и состояние строки) — и
    // это не дубль-опечатка, а один и тот же факт: они обязаны совпадать.
    // Поэтому оба адресуются точно, а не поиском по странице.
    const panel = await screen.findByRole('region', { name: 'Методика расчёта' })
    expect(within(panel).getByText('Методика расчёта не определена')).toBeInTheDocument()
    const row = screen.getByRole('row', { name: /Ерланов/ })
    expect(within(row).getByText('Методика расчёта не определена')).toBeInTheDocument()
  })

  it('выключенная функция объясняет себя и не выдаёт себя за нулевой рейтинг', async () => {
    server.use(
      http.get(RATINGS_URL, () =>
        HttpResponse.json(
          response({
            capabilities: { operationalRatings: false, ratingConflicts: false },
            policy: null,
            results: [summary({ aggregateRating: null, dataState: 'FEATURE_DISABLED' })],
          }),
        ),
      ),
    )
    renderPage()
    // Та же пара мест: объяснение сверху и состояние в строке.
    expect(
      (await screen.findAllByText(/Оперативный рейтинг пока недоступен/)).length,
    ).toBe(2)
    expect(screen.getByText(/ENABLE_OPERATIONAL_RATINGS/)).toBeInTheDocument()
  })

  it('запрещённых §22.16 колонок на экране нет — проверяется СТРУКТУРНО', async () => {
    server.use(http.get(RATINGS_URL, () => HttpResponse.json(response())))
    renderPage()
    await screen.findByText('8,6')
    const headers = screen.getAllByRole('columnheader').map((cell) => cell.textContent)
    // Ни «Место», ни «Оценщик», ни «Оценка» отдельной строкой: §22.16 запрещает
    // таблицу лидеров, место сотрудника и раскрытие оценщика. Проверка по
    // заголовкам, а не поиском слов по странице: слово «оценок» законно стоит
    // в подписи «Учтено оценок» и в §35-причинах.
    expect(headers).toEqual(['Сотрудник', 'Агрегат', 'Учтено оценок', 'Период', 'Состояние'])
  })

  it('§35-блоки печатаются формулировкой сервера', async () => {
    server.use(http.get(RATINGS_URL, () => HttpResponse.json(response())))
    renderPage()
    expect(await screen.findByText(/Модель весов не заведена/)).toBeInTheDocument()
    expect(screen.getByText(/Связи нет/)).toBeInTheDocument()
  })
})
