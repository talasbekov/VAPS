// @vitest-environment jsdom
// Карточка работы отчёта (§22.27). Проверяются два свойства, ради которых
// экран и существует отдельно от строки реестра:
//   1. закрытые данные ОТСУТСТВУЮТ В DOM, а не спрятаны стилями;
//   2. отказ в доступе — весь экран, а не бейдж поверх карточки.
// Плюс обычное: политику действий считает сервер, экран её не выводит.
import '@testing-library/jest-dom/vitest'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import type { ReactNode } from 'react'
import { MemoryRouter, Route, Routes } from 'react-router'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { server } from '../../../shared/api/testing/server'
import { clearCredential, setCredential } from '../../../shared/auth/credential'
import { ROUTES } from '../../../shared/routes'
import { ToastProvider } from '../../../shared/ui/toast'
import { ReportHistoryPage } from './ReportHistoryPage'
import { ReportJobPage } from './ReportJobPage'
import type { ReportJobDetailResponse, ReportJobView } from '../api/pending-contracts'
import type { ReportJobAction, ReportJobActionCode } from '../model/types'

const JOB_ID = 'report-job-1'
const JOB_URL = `*/api/ops/service-report-jobs/${JOB_ID}/`
const PERIOD_FROM = '2026-07-01'
const PERIOD_TO = '2026-07-31'

const ALL_CODES: readonly ReportJobActionCode[] = [
  'OPEN_PARAMETERS',
  'DOWNLOAD',
  'RETRY',
  'NEW_REVISION',
  'VIEW_ERROR',
]

function actions(available: Partial<Record<ReportJobActionCode, boolean>>): ReportJobAction[] {
  return ALL_CODES.map((code) => ({
    code,
    available: available[code] ?? false,
    reason: (available[code] ?? false) ? null : `Причина отказа ${code}`,
  }))
}

function job(overrides: Partial<ReportJobView> = {}): ReportJobView {
  return {
    reportJobId: JOB_ID,
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
    idempotencyKey: `PERSONNEL_EXPENSE:${PERIOD_FROM}:${PERIOD_TO}:N:1`,
    sensitive: false,
    parameters: { from: PERIOD_FROM, to: PERIOD_TO },
    parametersRedactedReason: null,
    ...overrides,
  }
}

const ARTIFACT = {
  artifactId: 'artifact-1',
  reportJobId: JOB_ID,
  safeTitle: 'Расход личного состава',
  format: 'CSV' as const,
  revision: 2,
  generatedAt: '2026-07-20T08:05:00.000Z',
  generatedBy: 'demo-analyst',
  parameterSnapshot: { from: PERIOD_FROM, to: PERIOD_TO },
  calculationVersion: 'expense-2026.07.1',
  maskingPolicyVersion: 'masking-2026.07.1',
  sensitive: false,
  fileSize: 512,
  hash: 'deadbeef',
  expiresAt: '2026-08-10T08:05:00.000Z',
  available: true,
  unavailableReason: null,
}

function detail(overrides: Partial<ReportJobDetailResponse> = {}): ReportJobDetailResponse {
  return {
    job: job(),
    artifact: ARTIFACT,
    actions: actions({ OPEN_PARAMETERS: true, DOWNLOAD: true, RETRY: true, NEW_REVISION: true }),
    reportTypeTitle: 'Расход личного состава',
    isOwn: true,
    unavailableBlocks: [{ code: 'SCOPE', label: 'Scope запуска', reason: 'Плоский RBAC.' }],
    unavailableArtifactFields: [],
    serverTime: '2026-07-20T08:10:00.000Z',
    ...overrides,
  }
}

/** Рендерится через РОУТЕР по реальному шаблону маршрута: карточка читает
 * идентификатор из пути, и подстановка пропа скрыла бы ошибку в шаблоне. */
function renderPage(initialUrl = `/service-reports/${JOB_ID}`): void {
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
  render(
    <Routes>
      <Route path={ROUTES.serviceReportJob} element={<ReportJobPage />} />
      <Route path={ROUTES.serviceReportHistory} element={<ReportHistoryPage />} />
    </Routes>,
    { wrapper: Wrapper },
  )
}

beforeEach(() => {
  setCredential({ kind: 'dev', userId: 'demo-analyst' })
})

afterEach(() => {
  cleanup()
  clearCredential()
})

describe('Карточка работы отчёта (§22.27)', () => {
  it('показывает состояние, параметры и метаданные артефакта одним срезом', async () => {
    server.use(http.get(JOB_URL, () => HttpResponse.json(detail())))
    renderPage()

    expect(await screen.findByRole('heading', { name: 'Расход личного состава' })).toBeInTheDocument()
    expect(screen.getByText('Готов')).toBeInTheDocument()
    expect(screen.getByText(`${PERIOD_FROM} — ${PERIOD_TO} (границы включительно)`)).toBeInTheDocument()
    // Редакция — из ответа: карточка не считает её сама.
    expect(screen.getByText('2')).toBeInTheDocument()
    expect(screen.getByText('deadbeef')).toBeInTheDocument()
    expect(screen.getByText('ваш запуск')).toBeInTheDocument()
  })

  it('параметров чужого запуска нет В DOM — ни периода, ни ключа (§22.26/§22.27)', async () => {
    const redacted = 'Это чужой запуск: параметры чужого отчёта — отдельное право.'
    server.use(
      http.get(JOB_URL, () =>
        HttpResponse.json(
          detail({
            job: job({
              parameters: null,
              // ⚠️ Ключ НАМЕРЕННО оставлен непустым, хотя сервер его вырезает:
              // так тест перестаёт быть пустым. Ключ буквально содержит период
              // (`…:2026-07-01:2026-07-31:…`), и экран, который печатает его
              // вне ветки «параметры видны», вернул бы период на страницу.
              // Проверяется структурное свойство разметки, а не аккуратность
              // конкретного ответа.
              parametersRedactedReason: redacted,
            }),
            // Снимок параметров артефакта вырезан тем же ответом: иначе период
            // приехал бы соседним полем.
            artifact: { ...ARTIFACT, parameterSnapshot: null },
            isOwn: false,
            actions: actions({ DOWNLOAD: false, RETRY: true }),
          }),
        ),
      ),
    )
    renderPage()

    expect(await screen.findByText(redacted)).toBeInTheDocument()
    expect(screen.getByText('запуск другого пользователя')).toBeInTheDocument()
    // Ключевая проверка: ищем по ВСЕЙ разметке, а не по конкретному узлу —
    // «скрыто вёрсткой» и «отсутствует» различает только это.
    expect(document.body.textContent).not.toContain(PERIOD_FROM)
    expect(document.body.textContent).not.toContain(PERIOD_TO)
    expect(document.body.innerHTML).not.toContain(PERIOD_FROM)
  })

  it('отказ в доступе — весь экран: состояния и автора работы на нём нет', async () => {
    server.use(
      http.get(JOB_URL, () =>
        HttpResponse.json(
          {
            error_code: 'ENTITY_NOT_FOUND',
            message: 'Запись не найдена.',
            details: {},
            request_id: null,
            timestamp: '2026-07-20T08:10:00.000Z',
          },
          { status: 404 },
        ),
      ),
    )
    renderPage()

    expect(await screen.findByRole('heading', { name: 'Работа недоступна' })).toBeInTheDocument()
    expect(screen.getByText('Запись не найдена.')).toBeInTheDocument()
    expect(screen.queryByText('demo-analyst')).not.toBeInTheDocument()
    expect(screen.queryByText('Готов')).not.toBeInTheDocument()
    // Ссылка назад остаётся: отказ — не тупик.
    expect(screen.getByRole('link', { name: '← История отчётов' })).toBeInTheDocument()
  })

  it('доступность действий берётся ИЗ ОТВЕТА, а не выводится из состояния', async () => {
    // Ответ намеренно противоречит «здравому смыслу»: работа ГОТОВА и артефакт
    // доступен, но сервер запрещает скачивание. Экран обязан слушаться ответа.
    server.use(
      http.get(JOB_URL, () =>
        HttpResponse.json(detail({ actions: actions({ RETRY: true }) })),
      ),
    )
    renderPage()

    expect(await screen.findByRole('button', { name: 'Скачать' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Повторить' })).toBeEnabled()
    // Причина отказа читается не только мышью: она напечатана списком.
    expect(screen.getByText(/Причина отказа DOWNLOAD/)).toBeInTheDocument()
  })

  it('«Открыть параметры» и «Посмотреть ошибку» кнопками не дублируются', async () => {
    // Карточка И ЕСТЬ развёрнутая строка: обе секции уже на экране, и кнопка,
    // которая ничего не открывает, была бы действием без последствий.
    server.use(
      http.get(JOB_URL, () =>
        HttpResponse.json(
          detail({
            job: job({
              state: 'FAILED',
              artifactId: null,
              failureCode: 'ASSEMBLY_FAILED',
              safeFailureMessage: 'Не удалось собрать отчёт.',
            }),
            artifact: null,
            actions: actions({ OPEN_PARAMETERS: true, VIEW_ERROR: true, RETRY: true }),
          }),
        ),
      ),
    )
    renderPage()

    expect(await screen.findByText('ASSEMBLY_FAILED: Не удалось собрать отчёт.')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Открыть параметры' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Посмотреть ошибку' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Повторить' })).toBeEnabled()
  })

  it('повтор ведёт на карточку НОВОЙ работы, а переиспользование файла — нет', async () => {
    server.use(
      http.get(JOB_URL, () => HttpResponse.json(detail())),
      http.post(`*/api/ops/service-report-jobs/${JOB_ID}/retry/`, () =>
        HttpResponse.json({ reused: false, reportJobId: 'report-job-9', artifactId: null }),
      ),
    )
    renderPage()

    await userEvent.click(await screen.findByRole('button', { name: 'Повторить' }))

    const link = await screen.findByRole('link', { name: 'Открыть её карточку' })
    expect(link).toHaveAttribute('href', '/service-reports/report-job-9')
  })

  it('статический /service-reports/history не читается как работа с таким id', async () => {
    // Соседство статического и динамического сегмента — свойство роутера, и
    // ошибка здесь была бы бесшумной: история открывалась бы карточкой.
    let requestedJobUrl: string | null = null
    server.use(
      http.get('*/api/ops/service-report-jobs/history/', ({ request }) => {
        requestedJobUrl = request.url
        return HttpResponse.json(detail())
      }),
      http.get('*/api/ops/service-report-jobs/', () =>
        HttpResponse.json({
          results: [],
          artifacts: [],
          actions: [],
          unavailableColumns: [],
          totalVisible: 0,
          serverTime: '2026-07-20T08:10:00.000Z',
        }),
      ),
    )
    renderPage('/service-reports/history')

    expect(await screen.findByRole('heading', { name: 'История отчётов' })).toBeInTheDocument()
    await waitFor(() => expect(screen.getByText('Отчёты ещё не запускались.')).toBeInTheDocument())
    expect(requestedJobUrl).toBeNull()
  })
})
