// @vitest-environment jsdom
// Аналитика службы (§22.3-22.7, §22.12). Главное свойство экрана: он НИЧЕГО не
// считает и не выводит цвет из числа — поэтому ключевой тест подсовывает ответ,
// в котором состояние ПРОТИВОРЕЧИТ значению, и требует, чтобы экран послушался
// ответа (тот же приём, что action policy §21.28 и §22.25).
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
import { ServiceAnalyticsPage } from './ServiceAnalyticsPage'
import type {
  AnalyticsPresetsResponse,
  DrilldownResponse,
  ServiceAnalyticsResponse,
} from '../api/pending-contracts'

const PRESETS_URL = '*/api/ops/service-analytics-presets/'
const DRILLDOWN_URL = '*/api/ops/service-analytics-drilldown/'
const SNAPSHOT_URL = '*/api/ops/service-analytics/'
const SNAPSHOT_ID = 'snap-3-2026-07-20-2026-07-20-demo'

function presets(): AnalyticsPresetsResponse {
  return {
    results: [
      { presetCode: 'TODAY', safeLabel: 'Сегодня', offsetDays: 0, lengthDays: 1 },
      { presetCode: 'CURRENT_WEEK', safeLabel: 'Текущая неделя', offsetDays: 0, lengthDays: 7 },
    ],
    maxCustomPeriodDays: 62,
    defaultPresetCode: 'TODAY',
  }
}

function snapshot(overrides: Partial<ServiceAnalyticsResponse> = {}): ServiceAnalyticsResponse {
  return {
    snapshotId: SNAPSHOT_ID,
    businessDate: '2026-07-20',
    timezone: 'Asia/Almaty',
    period: { from: '2026-07-20', to: '2026-07-20', presetCode: 'TODAY' },
    scope: { scopeType: 'DEMO_FLAT', scopeId: 'demo', safeLabel: 'Область demo-режима' },
    generatedAt: '2026-07-20T08:00:00+05:00',
    sourceUpdatedAt: '2026-07-20T07:30:00+05:00',
    sourceWatermark: null,
    freshnessState: 'CURRENT',
    completenessState: 'COMPLETE',
    calculationVersion: 'service-analytics-2026.07.1',
    policyVersion: 'analytics-policy-2026.07.1',
    data: {
      metrics: [
        {
          metricCode: 'DUTY_PLANNED',
          safeLabel: 'Запланировано смен',
          value: 5,
          displayValue: '5',
          unit: 'COUNT',
          state: 'NORMAL',
          drilldownAvailable: true,
          metricDefinitionVersion: 'metrics-2026.07.1',
        },
      ],
      unavailableMetrics: [
        { code: 'WORKLOAD', label: 'Перегрузка', reason: 'Политики нагрузки в срезе нет.' },
      ],
    },
    unavailableHeaderBlocks: [
      { code: 'SCOPE_FILTER', label: 'Выбор scope', reason: 'Плоский RBAC.' },
    ],
    drilldownAllowed: true,
    drilldownDeniedReason: null,
    ...overrides,
  }
}

function drilldown(overrides: Partial<DrilldownResponse['data']> = {}): DrilldownResponse {
  const base = snapshot()
  return {
    ...base,
    data: {
      metricCode: 'DUTY_PLANNED',
      rows: [
        {
          rowId: 's1',
          businessDate: '2026-07-20',
          objectLabel: 'Штаб управления',
          stateLabel: 'Запланировано',
          employeeLabel: 'Ерланов Д.',
        },
      ],
      nextCursor: null,
      totalCount: 1,
      personalDetailSuppressed: false,
      personalDetailReason: null,
      ...overrides,
    },
  }
}

function renderPage(initialUrl = '/analytics'): void {
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
  render(<ServiceAnalyticsPage />, { wrapper: Wrapper })
}

beforeEach(() => {
  setCredential({ kind: 'dev', userId: 'demo-analyst' })
})

afterEach(() => {
  cleanup()
  clearCredential()
})

describe('Аналитика службы (§22.3-22.7)', () => {
  it('печатает displayValue и состояние ИЗ ОТВЕТА, а не выводит цвет из числа', async () => {
    // Ответ намеренно противоречит «здравому смыслу»: значение НОЛЬ, а состояние
    // критическое. Экран, который красит по числу, показал бы норму.
    server.use(
      http.get(PRESETS_URL, () => HttpResponse.json(presets())),
      http.get(SNAPSHOT_URL, () =>
        HttpResponse.json(
          snapshot({
            data: {
              metrics: [
                {
                  metricCode: 'CONFLICT_HARD',
                  safeLabel: 'Жёсткие конфликты',
                  value: 0,
                  displayValue: 'ноль по данным источника',
                  unit: 'COUNT',
                  state: 'CRITICAL',
                  drilldownAvailable: false,
                  metricDefinitionVersion: 'metrics-2026.07.1',
                },
              ],
              unavailableMetrics: [],
            },
          }),
        ),
      ),
    )
    renderPage()

    // Печатается СТРОКА из ответа, а не число, отформатированное экраном.
    expect(await screen.findByText('ноль по данным источника')).toBeInTheDocument()
    expect(screen.getByText('Обнаружено превышение серверного порога')).toBeInTheDocument()
    expect(screen.queryByText('В норме')).not.toBeInTheDocument()
  })

  it('UNKNOWN не подменяется зелёным и не даёт раскрытия', async () => {
    server.use(
      http.get(PRESETS_URL, () => HttpResponse.json(presets())),
      http.get(SNAPSHOT_URL, () =>
        HttpResponse.json(
          snapshot({
            freshnessState: 'UNKNOWN',
            completenessState: 'INCOMPLETE',
            data: {
              metrics: [
                {
                  metricCode: 'DUTY_PLANNED',
                  safeLabel: 'Запланировано смен',
                  value: null,
                  displayValue: 'нет данных',
                  unit: 'COUNT',
                  state: 'UNKNOWN',
                  drilldownAvailable: false,
                  metricDefinitionVersion: 'metrics-2026.07.1',
                },
              ],
              unavailableMetrics: [],
            },
          }),
        ),
      ),
    )
    renderPage()

    expect(await screen.findByText('нет данных')).toBeInTheDocument()
    expect(screen.getByText('Данные не подтверждены')).toBeInTheDocument()
    expect(screen.getByText('Данные неполные')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Показать строки' })).toBeDisabled()
  })

  it('§22.12: строки НЕ приходят со снимком — их запрашивают отдельно и по snapshotId', async () => {
    let drilldownUrl: string | null = null
    server.use(
      http.get(PRESETS_URL, () => HttpResponse.json(presets())),
      http.get(SNAPSHOT_URL, () => HttpResponse.json(snapshot())),
      http.get(DRILLDOWN_URL, ({ request }) => {
        drilldownUrl = request.url
        return HttpResponse.json(drilldown())
      }),
    )
    renderPage()

    expect(await screen.findByText('Запланировано смен')).toBeInTheDocument()
    // До нажатия строк нет и запроса не было.
    expect(screen.queryByText('Ерланов Д.')).not.toBeInTheDocument()
    expect(drilldownUrl).toBeNull()

    await userEvent.click(screen.getByRole('button', { name: 'Показать строки' }))

    expect(await screen.findByText('Ерланов Д.')).toBeInTheDocument()
    await waitFor(() => expect(drilldownUrl).not.toBeNull())
    const url = new URL(drilldownUrl as unknown as string)
    expect(url.searchParams.get('snapshot_id')).toBe(SNAPSHOT_ID)
    expect(url.searchParams.get('metric_code')).toBe('DUTY_PLANNED')
  })

  it('вырезанная персональная детализация названа причиной, а строка остаётся', async () => {
    server.use(
      http.get(PRESETS_URL, () => HttpResponse.json(presets())),
      http.get(SNAPSHOT_URL, () => HttpResponse.json(snapshot())),
      http.get(DRILLDOWN_URL, () =>
        HttpResponse.json(
          drilldown({
            rows: [
              {
                rowId: 's1',
                businessDate: '2026-07-20',
                objectLabel: 'Штаб управления',
                stateLabel: 'Запланировано',
                employeeLabel: null,
              },
            ],
            personalDetailSuppressed: true,
            personalDetailReason: 'У вас нет права на персональную детализацию.',
          }),
        ),
      ),
    )
    renderPage()

    await userEvent.click(await screen.findByRole('button', { name: 'Показать строки' }))

    expect(
      await screen.findByText('У вас нет права на персональную детализацию.'),
    ).toBeInTheDocument()
    // Строка на месте — вырезан сотрудник, а не вся выборка.
    expect(screen.getByText('Штаб управления')).toBeInTheDocument()
    expect(screen.getByText('скрыт')).toBeInTheDocument()
  })

  it('без права на раскрытие кнопка выключена и причина приходит с сервера', async () => {
    server.use(
      http.get(PRESETS_URL, () => HttpResponse.json(presets())),
      http.get(SNAPSHOT_URL, () =>
        HttpResponse.json(
          snapshot({
            drilldownAllowed: false,
            drilldownDeniedReason: 'Раскрытие — отдельное право.',
          }),
        ),
      ),
    )
    renderPage()

    const button = await screen.findByRole('button', { name: 'Показать строки' })
    expect(button).toBeDisabled()
    expect(button).toHaveAttribute('title', 'Раскрытие — отдельное право.')
  })

  it('пресеты приходят из API и выбранный живёт в URL (§22.5/§22.6)', async () => {
    const requested: string[] = []
    server.use(
      http.get(PRESETS_URL, () => HttpResponse.json(presets())),
      http.get(SNAPSHOT_URL, ({ request }) => {
        requested.push(new URL(request.url).searchParams.get('preset') ?? '')
        return HttpResponse.json(snapshot())
      }),
    )
    renderPage()

    // Первый запрос идёт с ДЕФОЛТОМ СЕРВЕРА, а не с зашитым в экран периодом.
    await waitFor(() => expect(requested).toContain('TODAY'))
    expect(await screen.findByRole('button', { name: 'Текущая неделя' })).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Текущая неделя' }))
    await waitFor(() => expect(requested).toContain('CURRENT_WEEK'))
    expect(await screen.findByText('Фильтры активны')).toBeInTheDocument()
  })

  it('период из URL переживает перезагрузку и не подменяется дефолтом', async () => {
    const requested: string[] = []
    server.use(
      http.get(PRESETS_URL, () => HttpResponse.json(presets())),
      http.get(SNAPSHOT_URL, ({ request }) => {
        requested.push(new URL(request.url).searchParams.get('preset') ?? '')
        return HttpResponse.json(snapshot())
      }),
    )
    renderPage('/analytics?period=CURRENT_WEEK')

    await waitFor(() => expect(requested).toContain('CURRENT_WEEK'))
    expect(requested).not.toContain('TODAY')
  })

  it('отказ сервера по произвольному периоду печатается как есть', async () => {
    server.use(
      http.get(PRESETS_URL, () => HttpResponse.json(presets())),
      http.get(SNAPSHOT_URL, ({ request }) => {
        if (new URL(request.url).searchParams.get('from') === null) {
          return HttpResponse.json(snapshot())
        }
        return HttpResponse.json(
          {
            error_code: 'PERIOD_TOO_LONG',
            message: 'Период аналитики не может превышать 62 дней.',
            details: {},
            request_id: null,
            timestamp: '2026-07-20T08:00:00+05:00',
          },
          { status: 422 },
        )
      }),
    )
    renderPage()

    await screen.findByText('Запланировано смен')
    await userEvent.type(screen.getByLabelText('Начало периода'), '2026-01-01')
    await userEvent.type(screen.getByLabelText('Конец периода'), '2026-12-31')
    await userEvent.click(screen.getByRole('button', { name: 'Произвольный период' }))

    expect(
      await screen.findByText('Период аналитики не может превышать 62 дней.'),
    ).toBeInTheDocument()
  })
})
