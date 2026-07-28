// @vitest-environment jsdom
// Отчётный реестр на экране (§22.21-22.24). Главное свойство: экран НИЧЕГО не
// формирует и не выводит сам — состояния работы, метаданные и доступность
// приходят с сервера.
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
import { ServiceReportsPage } from './ServiceReportsPage'
import type {
  ListReportJobsResponse,
  ListReportTypesResponse,
} from '../api/pending-contracts'
import type { ReportJob } from '../model/types'

const TYPES_URL = '*/api/ops/service-report-types/'
const JOBS_URL = '*/api/ops/service-report-jobs/'

function types(overrides: Partial<ListReportTypesResponse> = {}): ListReportTypesResponse {
  return {
    results: [
      {
        reportTypeCode: 'PERSONNEL_EXPENSE',
        safeTitle: 'Расход личного состава',
        description: 'Смены дежурств за период.',
        formats: ['CSV'],
        maxPeriodDays: 92,
      },
    ],
    retentionPolicy: { retentionDays: 21, policyVersion: 'retention-2026.07.1' },
    maskedFields: [
      { code: 'NOTE', label: 'Примечание к дежурству', reason: 'Персональные комментарии.' },
    ],
    unavailableFormats: [{ code: 'XLSX', label: 'XLSX', reason: 'Генератора нет.' }],
    unavailableArtifactFields: [
      { code: 'SCOPE_SNAPSHOT', label: 'Снимок scope', reason: 'Плоский RBAC.' },
    ],
    canExportSensitive: true,
    ...overrides,
  }
}

function job(overrides: Partial<ReportJob> = {}): ReportJob {
  return {
    reportJobId: 'report-job-1',
    reportTypeCode: 'PERSONNEL_EXPENSE',
    format: 'CSV',
    state: 'PENDING',
    progressPercent: null,
    createdAt: '2026-07-20T08:00:00.000Z',
    createdBy: { userId: 'demo-analyst', safeLabel: 'demo-analyst' },
    completedAt: null,
    failureCode: null,
    safeFailureMessage: null,
    artifactId: null,
    idempotencyKey: 'key-1',
    sensitive: false,
    parameters: { from: '2026-07-01', to: '2026-07-31' },
    ...overrides,
  }
}

function jobs(overrides: Partial<ListReportJobsResponse> = {}): ListReportJobsResponse {
  return {
    results: [],
    artifacts: [],
    serverTime: '2026-07-20T08:00:00.000Z',
    ...overrides,
  }
}

const ARTIFACT = {
  artifactId: 'artifact-1',
  reportJobId: 'report-job-1',
  safeTitle: 'Расход личного состава',
  format: 'CSV' as const,
  revision: 1,
  generatedAt: '2026-07-20T08:05:00.000Z',
  generatedBy: 'demo-analyst',
  parameterSnapshot: { from: '2026-07-01', to: '2026-07-31' },
  calculationVersion: 'expense-2026.07.1',
  maskingPolicyVersion: 'masking-2026.07.1',
  sensitive: false,
  fileSize: 2048,
  hash: 'deadbeef',
  expiresAt: '2026-08-10T08:05:00.000Z',
  available: true,
  unavailableReason: null,
}

function renderPage(): void {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={client}>
        <ToastProvider>{children}</ToastProvider>
      </QueryClientProvider>
    )
  }
  render(<ServiceReportsPage />, { wrapper: Wrapper })
}

beforeEach(() => {
  setCredential({ kind: 'dev', userId: 'demo-analyst' })
})

afterEach(() => {
  cleanup()
  clearCredential()
})

describe('Отчёты службы (§22.21-22.24)', () => {
  it('до COMPLETED не показывает ни метаданных, ни кнопки скачивания (§22.21)', async () => {
    server.use(
      http.get(TYPES_URL, () => HttpResponse.json(types())),
      http.get(JOBS_URL, () =>
        HttpResponse.json(jobs({ results: [job({ state: 'PROCESSING', progressPercent: 50 })] })),
      ),
    )
    renderPage()

    expect(await screen.findByText('Формируется')).toBeInTheDocument()
    expect(screen.getByText('50%')).toBeInTheDocument()
    expect(screen.getByText(/Артефакт ещё не сформирован/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Скачать CSV' })).not.toBeInTheDocument()
  })

  it('метаданные артефакта печатаются ИЗ ОТВЕТА, включая версии политик', async () => {
    server.use(
      http.get(TYPES_URL, () => HttpResponse.json(types())),
      http.get(JOBS_URL, () =>
        HttpResponse.json(
          jobs({
            results: [job({ state: 'COMPLETED', artifactId: 'artifact-1', progressPercent: 100 })],
            artifacts: [ARTIFACT],
          }),
        ),
      ),
    )
    renderPage()

    expect(await screen.findByText('Готов')).toBeInTheDocument()
    expect(screen.getByText(/маскирование masking-2026\.07\.1/)).toBeInTheDocument()
    expect(screen.getByText(/контрольная сумма deadbeef/)).toBeInTheDocument()
    expect(screen.getByText(/2\.0 КБ/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Скачать CSV' })).toBeEnabled()
  })

  it('срок хранения берётся из ответа, а не из «файлы доступны 30 дней» (§22.22)', async () => {
    server.use(
      http.get(TYPES_URL, () => HttpResponse.json(types())),
      http.get(JOBS_URL, () =>
        HttpResponse.json(
          jobs({
            results: [job({ state: 'COMPLETED', artifactId: 'artifact-1' })],
            artifacts: [ARTIFACT],
          }),
        ),
      ),
    )
    renderPage()

    expect(await screen.findByText(/Артефакт хранится 21 дней/)).toBeInTheDocument()
    expect(screen.queryByText(/30 дней/)).not.toBeInTheDocument()
  })

  it('недоступный артефакт: причина названа, кнопка выключена', async () => {
    server.use(
      http.get(TYPES_URL, () => HttpResponse.json(types())),
      http.get(JOBS_URL, () =>
        HttpResponse.json(
          jobs({
            results: [job({ state: 'COMPLETED', artifactId: 'artifact-1' })],
            artifacts: [{ ...ARTIFACT, available: false, unavailableReason: 'EXPIRED' as const }],
          }),
        ),
      ),
    )
    renderPage()

    expect(await screen.findByText('Срок хранения истёк')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Скачать CSV' })).toBeDisabled()
  })

  it('без права sensitive export флажок выключен, причина видима', async () => {
    server.use(
      http.get(TYPES_URL, () => HttpResponse.json(types({ canExportSensitive: false }))),
      http.get(JOBS_URL, () => HttpResponse.json(jobs())),
    )
    renderPage()

    expect(await screen.findByLabelText(/Включить скрытые поля/)).toBeDisabled()
    expect(screen.getByText(/ops\.report\.export_sensitive/)).toBeInTheDocument()
  })

  it('запуск шлёт период и ключ идемпотентности, зависящий от параметров', async () => {
    const bodies: { idempotencyKey?: string }[] = []
    server.use(
      http.get(TYPES_URL, () => HttpResponse.json(types())),
      http.get(JOBS_URL, () => HttpResponse.json(jobs())),
      http.post(JOBS_URL, async ({ request }) => {
        const body = (await request.json()) as { idempotencyKey?: string }
        bodies.push(body)
        return HttpResponse.json(job())
      }),
    )
    renderPage()

    await userEvent.type(await screen.findByLabelText('Начало периода'), '2026-07-01')
    await userEvent.type(screen.getByLabelText('Конец периода'), '2026-07-31')
    await userEvent.click(screen.getByRole('button', { name: 'Сформировать отчёт' }))

    await waitFor(() => expect(bodies).toHaveLength(1))
    expect(bodies[0]).toMatchObject({
      from: '2026-07-01',
      to: '2026-07-31',
      sensitive: false,
      format: 'CSV',
    })
    expect(bodies[0].idempotencyKey).toContain('2026-07-01:2026-07-31')
  })

  it('ограничение периода и исключённые поля названы текстом, а не спрятаны', async () => {
    server.use(
      http.get(TYPES_URL, () => HttpResponse.json(types())),
      http.get(JOBS_URL, () => HttpResponse.json(jobs())),
    )
    renderPage()

    expect(await screen.findByText(/не длиннее 92 дней/)).toBeInTheDocument()
    expect(screen.getByText('Примечание к дежурству')).toBeInTheDocument()
    expect(screen.getByText('XLSX')).toBeInTheDocument()
    expect(screen.getByText('Снимок scope')).toBeInTheDocument()
  })

  it('ошибка сервера при запуске показана, работа не выдумывается', async () => {
    server.use(
      http.get(TYPES_URL, () => HttpResponse.json(types())),
      http.get(JOBS_URL, () => HttpResponse.json(jobs())),
      http.post(JOBS_URL, () =>
        HttpResponse.json(
          {
            error_code: 'PERIOD_TOO_LONG',
            message: 'Период отчёта не может превышать 92 дней.',
            details: {},
            request_id: null,
            timestamp: '2026-07-20T08:00:00.000Z',
          },
          { status: 422 },
        ),
      ),
    )
    renderPage()

    await userEvent.type(await screen.findByLabelText('Начало периода'), '2026-01-01')
    await userEvent.type(screen.getByLabelText('Конец периода'), '2026-12-31')
    await userEvent.click(screen.getByRole('button', { name: 'Сформировать отчёт' }))

    expect(await screen.findByText(/не может превышать 92 дней/)).toBeInTheDocument()
    expect(screen.getByText('Отчёты ещё не запускались.')).toBeInTheDocument()
  })
})
