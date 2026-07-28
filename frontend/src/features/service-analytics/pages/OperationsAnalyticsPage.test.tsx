// @vitest-environment jsdom
// Аналитика ОМ (§22.13, §22.15). Главное свойство экрана: набор колонок,
// строки, breadcrumb и распределение приходят ГОТОВЫМИ — поэтому ключевые
// тесты подсовывают ответ, который экран не смог бы собрать сам.
import '@testing-library/jest-dom/vitest'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import type { ReactNode } from 'react'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { server } from '../../../shared/api/testing/server'
import { clearCredential, setCredential } from '../../../shared/auth/credential'
import { ToastProvider } from '../../../shared/ui/toast'
import { OperationsAnalyticsPage } from './OperationsAnalyticsPage'
import type { OperationsAnalyticsResponse } from '../api/pending-contracts'
import type { OperationsAnalyticsData } from '../model/types'

const OPS_URL = '*/api/ops/operations-analytics/'

function response(data: Partial<OperationsAnalyticsData> = {}): OperationsAnalyticsResponse {
  return {
    snapshotId: 'snap-ops',
    businessDate: '2026-07-20',
    timezone: 'Asia/Almaty',
    period: { from: '2026-07-20', to: '2026-07-20', presetCode: null },
    scope: { scopeType: 'DEMO_FLAT', scopeId: 'demo', safeLabel: 'Область demo-режима' },
    generatedAt: '2026-07-20T08:00:00+05:00',
    sourceUpdatedAt: null,
    sourceWatermark: null,
    freshnessState: 'CURRENT',
    completenessState: 'COMPLETE',
    calculationVersion: 'operations-analytics-2026.07.1',
    policyVersion: 'analytics-policy-2026.07.1',
    data: {
      level: 'ALL',
      breadcrumb: [{ level: 'ALL', id: null, safeLabel: 'Все ОМ' }],
      columns: [
        { code: 'REQUESTED', safeLabel: 'Запрошено' },
        { code: 'ALLOCATED', safeLabel: 'Выделено' },
        { code: 'ASSIGNED', safeLabel: 'Назначено' },
      ],
      rows: [
        {
          rowId: 'object-1',
          safeLabel: 'Дворец Независимости',
          childLevel: 'OBJECT',
          cells: [
            { code: 'REQUESTED', value: 8, unavailableReason: null },
            { code: 'ALLOCATED', value: 6, unavailableReason: null },
            { code: 'ASSIGNED', value: 2, unavailableReason: null },
          ],
        },
      ],
      lifecycleDistribution: [{ stateCode: 'PLACEMENT', safeLabel: 'Расстановка', count: 1 }],
      unknownLifecycleCodes: [],
      eventCard: null,
      funnel: null,
      funnelUnavailableReason: 'Журнала переходов в снапшоте нет.',
      unavailableMeasures: [
        { code: 'FUNNEL', label: 'Воронка ОМ (§22.14)', reason: 'Нет transition events.' },
      ],
      ...data,
    },
  }
}

function renderPage(initialUrl = '/analytics/operations'): void {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={[initialUrl]}>
          <ToastProvider>{children}</ToastProvider>
        </MemoryRouter>
      </QueryClientProvider>
    )
  }
  render(<OperationsAnalyticsPage />, { wrapper: Wrapper })
}

beforeEach(() => {
  setCredential({ kind: 'dev', userId: 'demo-analyst' })
})

afterEach(() => {
  cleanup()
  clearCredential()
})

describe('Аналитика ОМ (§22.13, §22.15)', () => {
  it('печатает КОЛОНКИ ОТВЕТА и не смешивает запрошено/выделено/назначено', async () => {
    server.use(http.get(OPS_URL, () => HttpResponse.json(response())))
    renderPage()

    const header = await screen.findByRole('row', { name: /Запрошено/ })
    // Три разные подписи и три разных числа — ни одна пара не сложена.
    expect(header).toHaveTextContent('Запрошено')
    expect(header).toHaveTextContent('Выделено')
    expect(header).toHaveTextContent('Назначено')

    const row = screen.getByRole('row', { name: /Дворец Независимости/ })
    expect(row).toHaveTextContent('8')
    expect(row).toHaveTextContent('6')
    expect(row).toHaveTextContent('2')
    expect(row).not.toHaveTextContent('14')
  })

  it('колонки берутся из ответа: экран не знает своего набора', async () => {
    // Ответ несёт ОДНУ незнакомую колонку. Экран, у которого набор зашит,
    // напечатал бы свои подписи и потерял эту.
    server.use(
      http.get(OPS_URL, () =>
        HttpResponse.json(
          response({
            columns: [{ code: 'СВОЙ_КОД', safeLabel: 'Придуманная колонка' }],
            rows: [
              {
                rowId: 'object-1',
                safeLabel: 'Дворец Независимости',
                childLevel: null,
                cells: [{ code: 'СВОЙ_КОД', value: 42, unavailableReason: null }],
              },
            ],
          }),
        ),
      ),
    )
    renderPage()

    expect(await screen.findByText('Придуманная колонка')).toBeInTheDocument()
    expect(screen.getByRole('row', { name: /Дворец Независимости/ })).toHaveTextContent('42')
    expect(screen.queryByText('Запрошено')).not.toBeInTheDocument()
  })

  it('детализация уходит по стабильному ID строки, а не по её подписи', async () => {
    const urls: string[] = []
    server.use(
      http.get(OPS_URL, ({ request }) => {
        urls.push(request.url)
        return HttpResponse.json(response())
      }),
    )
    renderPage()

    await userEvent.click(await screen.findByRole('button', { name: 'Детализировать' }))
    await waitFor(() => {
      expect(urls.some((url) => url.includes('object_id=object-1'))).toBe(true)
    })
    // Подпись в запрос не уезжает: §22.15 требует переходов по ID.
    expect(urls.some((url) => url.includes('%D0%94%D0%B2%D0%BE%D1%80%D0%B5%D1%86'))).toBe(false)
  })

  it('состояние вне Lifecycle Registry названо, а не разложено по корзинам', async () => {
    server.use(
      http.get(OPS_URL, () =>
        HttpResponse.json(response({ unknownLifecycleCodes: ['ВЫДУМАННАЯ'] })),
      ),
    )
    renderPage()

    expect(await screen.findByText(/Состояния вне Lifecycle Registry/)).toBeInTheDocument()
    expect(screen.getByText(/ВЫДУМАННАЯ/)).toBeInTheDocument()
  })

  it('невыводимые поля карточки печатаются с причиной, а не нулём', async () => {
    server.use(
      http.get(OPS_URL, () =>
        HttpResponse.json(
          response({
            level: 'EVENT',
            eventCard: {
              eventId: 'event-1',
              code: 'ОМ-001',
              safeLabel: 'Форум',
              facts: [
                { code: 'ASSIGNED', safeLabel: 'Назначено', displayValue: '2', unavailableReason: null },
                {
                  code: 'ACTUAL',
                  safeLabel: 'Фактически участвовало',
                  displayValue: 'нет данных',
                  unavailableReason: 'Факта участия модель не ведёт.',
                },
              ],
            },
          }),
        ),
      ),
    )
    renderPage()

    const card = await screen.findByRole('group', { name: 'Карточка мероприятия' })
    expect(card).toHaveTextContent('Фактически участвовало')
    expect(card).toHaveTextContent('Факта участия модель не ведёт.')
    // Факт не приравнен к назначенным: ноль и «2» здесь оба были бы ложью.
    expect(card).toHaveTextContent('нет данных')
  })

  it('breadcrumb приходит с сервера и ведёт вверх по уровням', async () => {
    server.use(
      http.get(OPS_URL, () =>
        HttpResponse.json(
          response({
            level: 'EVENT',
            breadcrumb: [
              { level: 'ALL', id: null, safeLabel: 'Все ОМ' },
              { level: 'OBJECT', id: 'object-1', safeLabel: 'Дворец Независимости' },
              { level: 'EVENT', id: 'event-1', safeLabel: 'ОМ-001 · Форум' },
            ],
          }),
        ),
      ),
    )
    renderPage('/analytics/operations?object=object-1&event=event-1')

    const nav = await screen.findByRole('navigation', { name: 'Путь детализации' })
    const steps = nav.querySelectorAll('button')
    expect([...steps].map((step) => step.textContent)).toEqual([
      'Все ОМ',
      'Дворец Независимости',
      'ОМ-001 · Форум',
    ])
  })
})
