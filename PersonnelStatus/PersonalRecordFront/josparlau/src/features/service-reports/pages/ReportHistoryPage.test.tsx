// @vitest-environment jsdom
// История отчётов (§22.25). Главное свойство экрана: он НЕ выводит доступность
// действий из состояния работы — она приходит с сервера вместе с причиной
// отказа. Поэтому ключевой тест подсовывает ответ, противоречащий «здравому
// смыслу» экрана, и требует, чтобы экран послушался ответа.
import '@testing-library/jest-dom/vitest'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import type { ReactNode } from 'react'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { server } from '../../../shared/api/testing/server'
import { clearCredential, setCredential } from '../../../shared/auth/credential'
import { ToastProvider } from '../../../shared/ui/toast'
import { ReportHistoryPage } from './ReportHistoryPage'
import type { ListReportJobsResponse, ReportJobView } from '../api/pending-contracts'
import type { ReportJobAction, ReportJobActionCode } from '../model/types'

const JOBS_URL = '*/api/ops/service-report-jobs/'

function job(overrides: Partial<ReportJobView> = {}): ReportJobView {
  return {
    reportJobId: 'report-job-1',
    reportTypeCode: 'PERSONNEL_EXPENSE',
    format: 'CSV',
    state: 'COMPLETED',
    progressPercent: 100,
    createdAt: '2026-07-20T08:00:00.000Z',
    createdBy: { userId: 'demo-analyst', safeLabel: 'demo-analyst' },
    completedAt: '2026-07-20T08:05:00.000Z',
    failureCode: null,
    safeFailureMessage: null,
    artifactId: 'artifact-1',
    idempotencyKey: 'key-1',
    sensitive: false,
    parameters: { from: '2026-07-01', to: '2026-07-31' },
    parametersRedactedReason: null,
    ...overrides,
  }
}

const ARTIFACT = {
  artifactId: 'artifact-1',
  reportJobId: 'report-job-1',
  safeTitle: 'Расход личного состава',
  format: 'CSV' as const,
  revision: 3,
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

const ALL_CODES: readonly ReportJobActionCode[] = [
  'OPEN_PARAMETERS',
  'DOWNLOAD',
  'RETRY',
  'NEW_REVISION',
  'VIEW_ERROR',
]

/** Действия строки задаёт ТЕСТ, а не выводит экран: в этом и смысл проверки. */
function actions(available: Partial<Record<ReportJobActionCode, boolean>>): ReportJobAction[] {
  return ALL_CODES.map((code) => ({
    code,
    available: available[code] ?? false,
    reason: (available[code] ?? false) ? null : `Причина отказа ${code}`,
  }))
}

function response(overrides: Partial<ListReportJobsResponse> = {}): ListReportJobsResponse {
  return {
    results: [job()],
    artifacts: [ARTIFACT],
    actions: [{ reportJobId: 'report-job-1', actions: actions({ OPEN_PARAMETERS: true }) }],
    unavailableColumns: [{ code: 'SCOPE', label: 'Scope', reason: 'Плоский RBAC demo-режима.' }],
    totalVisible: 1,
    serverTime: '2026-07-20T08:10:00.000Z',
    ...overrides,
  }
}

function renderPage(initialUrl = '/service-reports/history'): void {
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
  render(<ReportHistoryPage />, { wrapper: Wrapper })
}

beforeEach(() => {
  setCredential({ kind: 'dev', userId: 'demo-analyst' })
})

afterEach(() => {
  cleanup()
  clearCredential()
})

describe('История отчётов (§22.25)', () => {
  it('доступность действий берётся ИЗ ОТВЕТА, а не выводится из состояния', async () => {
    // Ответ намеренно противоречит «здравому смыслу»: работа УПАЛА, но сервер
    // разрешает скачивание и запрещает просмотр ошибки. Экран обязан слушать
    // ответ — иначе политика действий живёт в компоненте, а не на сервере.
    server.use(
      http.get(JOBS_URL, () =>
        HttpResponse.json(
          response({
            results: [
              job({ state: 'FAILED', failureCode: 'ASSEMBLY_FAILED', safeFailureMessage: 'Сбой.' }),
            ],
            actions: [
              {
                reportJobId: 'report-job-1',
                actions: actions({ DOWNLOAD: true, VIEW_ERROR: false }),
              },
            ],
          }),
        ),
      ),
    )
    renderPage()

    expect(await screen.findByRole('button', { name: 'Скачать' })).toBeEnabled()
    expect(screen.getByRole('button', { name: 'Посмотреть ошибку' })).toBeDisabled()
  })

  it('причина отказа приходит с сервера и видна на самой кнопке', async () => {
    server.use(http.get(JOBS_URL, () => HttpResponse.json(response())))
    renderPage()

    const retry = await screen.findByRole('button', { name: 'Повторить' })
    expect(retry).toBeDisabled()
    expect(retry).toHaveAttribute('title', 'Причина отказа RETRY')
  })

  it('редакция и срок хранения печатаются из артефакта, а без него — прочерк', async () => {
    server.use(
      http.get(JOBS_URL, () =>
        HttpResponse.json(
          response({
            results: [job(), job({ reportJobId: 'report-job-2', state: 'PROCESSING', artifactId: null, completedAt: null })],
            actions: [
              { reportJobId: 'report-job-1', actions: actions({ OPEN_PARAMETERS: true }) },
              { reportJobId: 'report-job-2', actions: actions({ OPEN_PARAMETERS: true }) },
            ],
            totalVisible: 2,
          }),
        ),
      ),
    )
    renderPage()

    const rows = await screen.findAllByRole('row')
    // Строка 0 — шапка. Редакция 3 пришла из артефакта, а не «1» по умолчанию.
    expect(rows[1]).toHaveTextContent('3')
    expect(rows[1]).toHaveTextContent(/до 10\.08\.2026/)
    // У работы без артефакта редакции НЕТ — прочерк, а не выдуманная единица.
    expect(rows[2]).not.toHaveTextContent(/до /)
  })

  it('«Открыть параметры» показывает период и режим выгрузки самой работы', async () => {
    server.use(http.get(JOBS_URL, () => HttpResponse.json(response())))
    renderPage()

    await userEvent.click(await screen.findByRole('button', { name: 'Открыть параметры' }))
    expect(screen.getByText('key-1')).toBeInTheDocument()
    expect(screen.getByText(/границы включительно/)).toBeInTheDocument()
    expect(screen.getByText('обычный')).toBeInTheDocument()
  })

  it('«Посмотреть ошибку» печатает безопасное сообщение сервера', async () => {
    server.use(
      http.get(JOBS_URL, () =>
        HttpResponse.json(
          response({
            results: [
              job({
                state: 'FAILED',
                artifactId: null,
                failureCode: 'ASSEMBLY_FAILED',
                safeFailureMessage: 'Не удалось собрать отчёт: источник данных недоступен.',
              }),
            ],
            artifacts: [],
            actions: [{ reportJobId: 'report-job-1', actions: actions({ VIEW_ERROR: true }) }],
          }),
        ),
      ),
    )
    renderPage()

    // До нажатия текста ошибки на экране нет — реестр не кричит подробностями.
    const button = await screen.findByRole('button', { name: 'Посмотреть ошибку' })
    // Именно в СТРОКЕ: «Ошибка» — ещё и подпись варианта фильтра состояний,
    // и поиск по всему экрану нашёл бы её там (класс дублей подписей).
    expect(within(screen.getAllByRole('row')[1]).getByText('Ошибка')).toBeInTheDocument()
    expect(screen.queryByText(/источник данных недоступен/)).not.toBeInTheDocument()
    await userEvent.click(button)
    expect(screen.getByText(/ASSEMBLY_FAILED: Не удалось собрать отчёт/)).toBeInTheDocument()
  })

  it('фильтр состояния уезжает В ЗАПРОС — экран не режет полученный массив', async () => {
    const requested: string[] = []
    server.use(
      http.get(JOBS_URL, ({ request }) => {
        requested.push(new URL(request.url).search)
        return HttpResponse.json(response())
      }),
    )
    renderPage()

    await screen.findByRole('button', { name: 'Открыть параметры' })
    await userEvent.selectOptions(screen.getByLabelText('Состояние работы'), 'FAILED')
    await waitFor(() => expect(requested.at(-1)).toContain('state=FAILED'))
  })

  it('фильтр из URL применяется при открытии по ссылке', async () => {
    const requested: string[] = []
    server.use(
      http.get(JOBS_URL, ({ request }) => {
        requested.push(new URL(request.url).search)
        return HttpResponse.json(response({ results: [], artifacts: [], actions: [] }))
      }),
    )
    renderPage('/service-reports/history?state=FAILED&mine=true')

    await waitFor(() => expect(requested).not.toHaveLength(0))
    expect(requested[0]).toContain('state=FAILED')
    expect(requested[0]).toContain('mine=true')
    expect(screen.getByLabelText('Состояние работы')).toHaveValue('FAILED')
  })

  it('«ничего не нашлось» и «ничего не запускали» — разные сообщения', async () => {
    server.use(
      http.get(JOBS_URL, () =>
        HttpResponse.json(response({ results: [], artifacts: [], actions: [], totalVisible: 4 })),
      ),
    )
    renderPage()

    expect(await screen.findByText('По выбранным фильтрам работ нет.')).toBeInTheDocument()

    cleanup()
    server.use(
      http.get(JOBS_URL, () =>
        HttpResponse.json(response({ results: [], artifacts: [], actions: [], totalVisible: 0 })),
      ),
    )
    renderPage()
    expect(await screen.findByText('Отчёты ещё не запускались.')).toBeInTheDocument()
  })

  it('повтор различает «отдан прежний файл» и «запущена новая работа»', async () => {
    let reused = true
    server.use(
      http.get(JOBS_URL, () =>
        HttpResponse.json(
          response({
            actions: [{ reportJobId: 'report-job-1', actions: actions({ RETRY: true }) }],
          }),
        ),
      ),
      http.post('*/api/ops/service-report-jobs/report-job-1/retry/', () =>
        HttpResponse.json({
          reused,
          reportJobId: 'report-job-1',
          artifactId: reused ? 'artifact-1' : null,
        }),
      ),
    )
    renderPage()

    await userEvent.click(await screen.findByRole('button', { name: 'Повторить' }))
    expect(await screen.findByText(/новая работа не запускалась/)).toBeInTheDocument()

    reused = false
    await userEvent.click(screen.getByRole('button', { name: 'Повторить' }))
    expect(await screen.findByText('Запущена новая работа с теми же параметрами.')).toBeInTheDocument()
  })

  it('недоступная колонка §22.25 названа с причиной, а не нарисована пустой', async () => {
    server.use(http.get(JOBS_URL, () => HttpResponse.json(response())))
    renderPage()

    expect(await screen.findByText('Scope')).toBeInTheDocument()
    expect(screen.getByText(/Плоский RBAC demo-режима/)).toBeInTheDocument()
    // Колонки в таблице при этом НЕТ: заголовок «Scope» среди шапки не найден.
    const header = screen.getAllByRole('row')[0]
    expect(header).not.toHaveTextContent('Scope')
  })
})
