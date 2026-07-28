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
  AttentionResponse,
  DrilldownResponse,
  ServiceAnalyticsResponse,
} from '../api/pending-contracts'
import type { AttentionItem } from '../model/types'

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

describe('блок «Требует внимания» (§22.11)', () => {
  const ATTENTION_URL = '*/api/ops/service-analytics-attention/'
  const PERMISSIONS_URL = '*/api/operations/my-permissions/'

  function item(overrides: Partial<AttentionItem> = {}): AttentionItem {
    return {
      attentionId: 'att-1',
      categoryCode: 'ACKNOWLEDGEMENT_MISSING',
      severity: 'WARNING',
      safeTitle: 'Требуется проверка',
      safeDescription: 'Записей с ближайшим заступлением без отметки: 2.',
      count: 2,
      scopeLabel: 'Область demo-режима',
      targetRoute: '/duties',
      targetPermission: 'ops.duty.view',
      detectedAt: '2026-07-20T08:00:00+05:00',
      policyVersion: 'attention-policy-2026.07.1',
      ...overrides,
    }
  }

  function attention(overrides: Partial<AttentionResponse['data']> = {}): AttentionResponse {
    const base = snapshot()
    return {
      ...base,
      policyVersion: 'attention-policy-2026.07.1',
      data: {
        items: [item()],
        detectionState: 'COMPLETE',
        detectionUnavailableReason: null,
        unavailableDetectors: [],
        ...overrides,
      },
    }
  }

  function baseHandlers() {
    return [
      http.get(PRESETS_URL, () => HttpResponse.json(presets())),
      http.get(SNAPSHOT_URL, () => HttpResponse.json(snapshot())),
    ]
  }

  it('печатает элементы В ПОРЯДКЕ ОТВЕТА и красит по severity, а не по числу', async () => {
    // ⚠️ Три элемента и числа подобраны так, чтобы порядок ответа НЕ СОВПАДАЛ
    // ни с одной правдоподобной клиентской сортировкой: ни по severity
    // (CRITICAL был бы первым), ни по числу по убыванию (99, 50, 1), ни по
    // возрастанию. Первая редакция этого теста обходилась двумя элементами и
    // осталась ЗЕЛЁНОЙ, когда экрану добавили сортировку по count, — то есть
    // проверяла меньше, чем обещала.
    server.use(
      ...baseHandlers(),
      http.get(ATTENTION_URL, () =>
        HttpResponse.json(
          attention({
            items: [
              item({
                attentionId: 'att-info',
                categoryCode: 'SOURCE_AGE',
                severity: 'INFO',
                safeTitle: 'Источник не обновлён',
                safeDescription: 'Последнее изменение — 72 ч назад.',
                count: 99,
                targetRoute: null,
                targetPermission: null,
              }),
              item({
                attentionId: 'att-critical',
                severity: 'CRITICAL',
                safeTitle: 'Обнаружено превышение серверного порога',
                safeDescription: 'Доля записей периода с конфликтом — 38%.',
                count: 1,
              }),
              item({
                attentionId: 'att-warning',
                severity: 'WARNING',
                safeTitle: 'Есть незавершённые процессы',
                safeDescription: 'Записей, не переведённых в завершённое состояние: 50.',
                count: 50,
              }),
            ],
          }),
        ),
      ),
    )
    renderPage()

    const block = await screen.findByRole('group', { name: 'Требует внимания' })
    const entries = await waitFor(() => {
      const found = block.querySelectorAll('li')
      expect(found).toHaveLength(3)
      return found
    })
    expect(entries[0]).toHaveTextContent('Источник не обновлён')
    expect(entries[1]).toHaveTextContent('Обнаружено превышение серверного порога')
    expect(entries[2]).toHaveTextContent('Есть незавершённые процессы')
    // Цвет — от severity ответа: спокойный элемент с числом 99 остаётся
    // спокойным, тревожный с единицей — тревожным.
    expect(entries[0].className).not.toContain('red')
    expect(entries[1].className).toContain('red')
  })

  it('печатает текст сервера дословно и называет версию политики наблюдений', async () => {
    server.use(
      ...baseHandlers(),
      http.get(ATTENTION_URL, () => HttpResponse.json(attention())),
    )
    renderPage()

    expect(
      await screen.findByText('Записей с ближайшим заступлением без отметки: 2.'),
    ).toBeInTheDocument()
    // Версия политики НАБЛЮДЕНИЙ, а не порогов показателей (снимок KPI несёт
    // `analytics-policy-2026.07.1`).
    expect(
      await screen.findByText(/Версия политики наблюдений: attention-policy-2026\.07\.1/),
    ).toBeInTheDocument()
  })

  it('неработающий детектор называется вслух и не выдаётся за «замечаний нет»', async () => {
    server.use(
      ...baseHandlers(),
      http.get(ATTENTION_URL, () =>
        HttpResponse.json(
          attention({
            items: [],
            detectionState: 'UNAVAILABLE',
            detectionUnavailableReason: 'Источник наблюдений недоступен: детекторы не отработали.',
          }),
        ),
      ),
    )
    renderPage()

    expect(
      await screen.findByText('Источник наблюдений недоступен: детекторы не отработали.'),
    ).toBeInTheDocument()
    expect(screen.queryByText(/Ни один серверный детектор не сработал/)).not.toBeInTheDocument()
  })

  it('пустой результат отработавшего детектора — отдельное утверждение', async () => {
    server.use(
      ...baseHandlers(),
      http.get(ATTENTION_URL, () => HttpResponse.json(attention({ items: [] }))),
    )
    renderPage()

    expect(
      await screen.findByText(/Ни один серверный детектор не сработал в этом периоде/),
    ).toBeInTheDocument()
  })

  it('переход рисуется только при праве на раздел назначения (§22.27)', async () => {
    server.use(
      ...baseHandlers(),
      http.get(ATTENTION_URL, () => HttpResponse.json(attention())),
      http.get(PERMISSIONS_URL, () =>
        HttpResponse.json({ permissions: ['ops.analytics.view', 'ops.duty.view'] }),
      ),
    )
    renderPage()

    const link = await screen.findByRole('link', { name: 'Перейти к записям' })
    expect(link).toHaveAttribute('href', '/duties')
  })

  it('без права на раздел назначения ссылки нет, а причина названа', async () => {
    server.use(
      ...baseHandlers(),
      http.get(ATTENTION_URL, () => HttpResponse.json(attention())),
      // У аналитика нет `ops.duty.view` — ровно та persona, на которой держится
      // демонстрация разделения прав.
      http.get(PERMISSIONS_URL, () => HttpResponse.json({ permissions: ['ops.analytics.view'] })),
    )
    renderPage()

    expect(await screen.findByText('Требуется проверка')).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Перейти к записям' })).not.toBeInTheDocument()
    expect(
      screen.getByText('Переход к записям закрыт: раздел требует отдельного доступа.'),
    ).toBeInTheDocument()
  })
})
