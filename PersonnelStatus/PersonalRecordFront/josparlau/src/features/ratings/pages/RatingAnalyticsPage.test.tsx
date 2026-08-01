// @vitest-environment jsdom
// Отчёт аналитики рейтинга (§22.16-22.17). Главное свойство: экран печатает
// присланное и НЕ восстанавливает подавленное значение — ни само, ни из
// соседних показателей.
import '@testing-library/jest-dom/vitest'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen, within } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { server } from '../../../shared/api/testing/server'
import { clearCredential, setCredential } from '../../../shared/auth/credential'
import { RatingAnalyticsPage } from './RatingAnalyticsPage'
import type { RatingAnalyticsResponse } from '../api/pending-contracts'

const ANALYTICS_URL = '*/api/ops/rating-analytics/'

function response(overrides: Partial<RatingAnalyticsResponse> = {}): RatingAnalyticsResponse {
  return {
    policy: {
      periodDays: 105,
      minEvaluations: 4,
      policyVersion: 'OPERATIONAL-RATING-2026.07.1',
    },
    periodStartsAt: '2026-04-07',
    periodEndsAt: '2026-07-20',
    calculatedAt: '2026-07-20T08:00:00+05:00',
    suppressionMinGroupSize: 3,
    figures: {
      ratedParticipants: 6,
      coveredParticipants: 7,
      totalParticipants: 8,
      withoutAggregate: 2,
      correctedEvaluations: 1,
      distribution: [
        { code: 'BAND_BELOW_5', label: 'ниже 5', count: 0 },
        { code: 'BAND_5_7', label: '5,0–6,9', count: 1 },
        { code: 'BAND_7_8', label: '7,0–7,9', count: 1 },
        { code: 'BAND_8_9', label: '8,0–8,9 (стандартное выполнение — 8)', count: 2 },
        { code: 'BAND_9_10', label: '9,0–10', count: 2 },
      ],
      groups: [
        {
          groupCode: 'division-1',
          safeLabel: 'Первое управление',
          state: 'READY',
          aggregateRating: 8.1,
          ratedCount: 4,
          memberCount: 4,
        },
        {
          groupCode: 'division-3',
          safeLabel: 'Третье управление',
          state: 'SUPPRESSED',
          aggregateRating: null,
          ratedCount: 2,
          memberCount: 2,
        },
      ],
    },
    unpublishedReason: null,
    capabilities: { operationalRatings: true },
    unavailableViews: [
      { code: 'NO_OVERALL_MEAN', label: 'Общее среднее', reason: 'Восстанавливает скрытое.' },
    ],
    ...overrides,
  }
}

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  )
  return render(<RatingAnalyticsPage />, { wrapper })
}

beforeEach(() => {
  setCredential({ kind: 'dev', userId: 'demo-analyst' })
})

afterEach(() => {
  cleanup()
  clearCredential()
})

describe('отчёт аналитики рейтинга (§22.16-22.17)', () => {
  it('подавленная группа печатается формулировкой §22.17, а не значением', async () => {
    server.use(http.get(ANALYTICS_URL, () => HttpResponse.json(response())))
    renderPage()
    const row = await screen.findByRole('row', { name: /Третье управление/ })
    expect(
      within(row).getByText('Недостаточно данных для безопасного отображения'),
    ).toBeInTheDocument()
    // Ни нуля, ни прочерка вместо значения: у отсутствия и подавления разные
    // причины, и §19.19 запрещает 0,0.
    expect(within(row).queryByText('0,0')).not.toBeInTheDocument()
    // Размер группы при этом ВИДЕН — он и объясняет, почему значение скрыто.
    expect(within(row).getByText('2 из 2')).toBeInTheDocument()
  })

  it('рассчитанная группа печатается как ПРИСЛАНО, без округления на клиенте', async () => {
    server.use(
      http.get(ANALYTICS_URL, () =>
        HttpResponse.json(
          response({
            figures: {
              ...response().figures!,
              groups: [
                {
                  groupCode: 'division-1',
                  safeLabel: 'Первое управление',
                  state: 'READY',
                  aggregateRating: 8.14,
                  ratedCount: 4,
                  memberCount: 4,
                },
              ],
            },
          }),
        ),
      ),
    )
    renderPage()
    expect(await screen.findByText('8,14')).toBeInTheDocument()
  })

  it('запрещённых §22.16 колонок в отчёте нет — проверяется СТРУКТУРНО', async () => {
    server.use(http.get(ANALYTICS_URL, () => HttpResponse.json(response())))
    renderPage()
    await screen.findByText('8,1')
    const headers = screen.getAllByRole('columnheader').map((cell) => cell.textContent)
    // Ни «Место», ни «Сотрудник», ни «Оценщик»: отчёт оперирует полосами и
    // группами. Проверка по заголовкам, а не поиском слов по странице.
    expect(headers).toEqual(['Полоса', 'Участников', 'Группа', 'Агрегат', 'С агрегатом'])
  })

  it('покрытие и «без агрегата» показаны РАЗНЫМИ числами', async () => {
    server.use(http.get(ANALYTICS_URL, () => HttpResponse.json(response())))
    renderPage()
    expect(await screen.findByText('7 из 8')).toBeInTheDocument()
    const without = screen.getByText('Без готового агрегата').parentElement
    expect(within(without as HTMLElement).getByText('2')).toBeInTheDocument()
  })

  it('незаданное правило приватности отменяет ВЕСЬ отчёт, а не одну группу', async () => {
    server.use(
      http.get(ANALYTICS_URL, () =>
        HttpResponse.json(
          response({
            figures: null,
            suppressionMinGroupSize: null,
            unpublishedReason: 'SUPPRESSION_UNDEFINED',
          }),
        ),
      ),
    )
    renderPage()
    expect(await screen.findByText(/Правило безопасной агрегации не задано/)).toBeInTheDocument()
    expect(screen.queryByRole('table')).not.toBeInTheDocument()
  })

  it('выключенная функция и отсутствующая методика различаются формулировкой', async () => {
    server.use(
      http.get(ANALYTICS_URL, () =>
        HttpResponse.json(
          response({ figures: null, policy: null, unpublishedReason: 'POLICY_UNDEFINED' }),
        ),
      ),
    )
    renderPage()
    expect(await screen.findByText('Методика расчёта не определена')).toBeInTheDocument()
  })
})
