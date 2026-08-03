// @vitest-environment jsdom
// Экран выгрузки рейтинга (§19.29): состояния приходят с сервера, ссылки на
// файл нет, а недоступные форматы и режим названы вслух с причиной.
import '@testing-library/jest-dom/vitest'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { server } from '../../../shared/api/testing/server'
import { clearCredential, setCredential } from '../../../shared/auth/credential'
import { ToastProvider } from '../../../shared/ui/toast'
import { RatingExportPage } from './RatingExportPage'
import type { ListRatingExportsResponse } from '../api/pending-contracts'
import type { RatingExportJob } from '../model/types'

const EXPORTS_URL = '*/api/ops/rating-exports/'
const DOWNLOAD_URL = '*/api/ops/rating-export-artifacts/:artifactId/download/'

function job(overrides: Partial<RatingExportJob> = {}): RatingExportJob {
  return {
    exportJobId: 'rating-export-1',
    scope: 'AGGREGATE',
    format: 'CSV',
    state: 'QUEUED',
    createdAt: '2026-07-20T08:00:00+05:00',
    createdBy: 'demo-analyst',
    finishedAt: null,
    failureCode: null,
    safeFailureMessage: null,
    artifactId: null,
    idempotencyKey: 'idem-1',
    ...overrides,
  }
}

function response(overrides: Partial<ListRatingExportsResponse> = {}): ListRatingExportsResponse {
  return {
    results: [job()],
    artifacts: [],
    formats: ['CSV'],
    unavailableFormats: [
      {
        code: 'XLSX',
        label: 'XLSX',
        reason: 'Генератора книги XLSX в сборке нет.',
      },
      { code: 'PDF', label: 'PDF', reason: 'Генератора PDF в сборке нет.' },
    ],
    unavailableScopes: [
      {
        code: 'INDIVIDUAL',
        label: 'Экспорт индивидуальных оценок (sensitive export)',
        reason: 'Нет ни scope, ни срока полномочия (§19.21).',
      },
    ],
    capabilities: { operationalRatings: true },
    serverTime: '2026-07-20T08:00:00+05:00',
    ...overrides,
  }
}

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>
      <ToastProvider>{children}</ToastProvider>
    </QueryClientProvider>
  )
  return render(<RatingExportPage />, { wrapper })
}

beforeEach(() => {
  setCredential({ kind: 'dev', userId: 'demo-analyst' })
})

afterEach(() => {
  cleanup()
  clearCredential()
})

describe('выгрузка рейтинга §19.29', () => {
  it('у незавершённой работы нет ни файла, ни кнопки «Скачать» — только отмена', async () => {
    server.use(http.get(EXPORTS_URL, () => HttpResponse.json(response())))
    renderPage()
    const row = await screen.findByRole('row', { name: /В очереди/ })
    expect(within(row).queryByRole('button', { name: 'Скачать' })).not.toBeInTheDocument()
    expect(within(row).getByRole('button', { name: 'Отменить' })).toBeInTheDocument()
    // §19.29 «Не добавляй фиктивную ссылку на файл»: ссылок в строке нет вовсе.
    expect(within(row).queryByRole('link')).not.toBeInTheDocument()
  })

  it('«Скачать» появляется только у READY с артефактом и зовёт серверную выдачу', async () => {
    const ready = job({ state: 'READY', artifactId: 'artifact-1', finishedAt: '2026-07-20T08:05:00+05:00' })
    server.use(
      http.get(EXPORTS_URL, () =>
        HttpResponse.json(
          response({
            results: [ready],
            artifacts: [
              {
                artifactId: 'artifact-1',
                exportJobId: ready.exportJobId,
                scope: 'AGGREGATE',
                format: 'CSV',
                fileName: 'operational-rating-aggregate-2026-07-20.csv',
                generatedAt: '2026-07-20T08:05:00+05:00',
                policyVersion: 'OPERATIONAL-RATING-test.1',
                rowCount: 8,
              },
            ],
          }),
        ),
      ),
      http.post(DOWNLOAD_URL, () =>
        HttpResponse.json({
          fileName: 'operational-rating-aggregate-2026-07-20.csv',
          content: 'Участник;Агрегат\nЕрланов Д.;8.6\n',
        }),
      ),
    )
    // Файл сохраняет браузер: в jsdom нет ни `createObjectURL`, ни настоящего
    // клика по ссылке. Подменяются ТОЧЕЧНО два метода — целиком `URL` подменять
    // нельзя: его же конструктором MSW сопоставляет запросы, и подмена роняет
    // сеть всему файлу (поймано красной пробой на самом себе).
    const createObjectURL = vi.fn(() => 'blob:rating-export')
    const revokeObjectURL = vi.fn()
    const originalCreate = URL.createObjectURL
    const originalRevoke = URL.revokeObjectURL
    URL.createObjectURL = createObjectURL
    URL.revokeObjectURL = revokeObjectURL
    const clicked = vi
      .spyOn(HTMLAnchorElement.prototype, 'click')
      .mockImplementation(() => undefined)

    renderPage()
    const row = await screen.findByRole('row', { name: /Готов/ })
    expect(within(row).getByText(/operational-rating-aggregate-2026-07-20\.csv/)).toBeInTheDocument()
    await userEvent.click(within(row).getByRole('button', { name: 'Скачать' }))
    await waitFor(() => expect(clicked).toHaveBeenCalled())
    expect(createObjectURL).toHaveBeenCalled()

    clicked.mockRestore()
    URL.createObjectURL = originalCreate
    URL.revokeObjectURL = originalRevoke
  })

  it('файл не предлагается у НЕготовой работы, даже если артефакт в ответе есть', async () => {
    // Состояние, которого сервер не создаёт: артефакт при отменённой работе.
    // Экран всё равно не предлагает файл — он не выводит право на выдачу из
    // наличия метаданных, а сама выдача перепроверяет состояние на сервере.
    server.use(
      http.get(EXPORTS_URL, () =>
        HttpResponse.json(
          response({
            results: [job({ state: 'CANCELLED', artifactId: 'artifact-1' })],
            artifacts: [
              {
                artifactId: 'artifact-1',
                exportJobId: 'rating-export-1',
                scope: 'AGGREGATE',
                format: 'CSV',
                fileName: 'operational-rating-aggregate-2026-07-20.csv',
                generatedAt: '2026-07-20T08:05:00+05:00',
                policyVersion: 'OPERATIONAL-RATING-test.1',
                rowCount: 8,
              },
            ],
          }),
        ),
      ),
    )
    renderPage()
    const row = await screen.findByRole('row', { name: /Отменён/ })
    expect(within(row).queryByRole('button', { name: 'Скачать' })).not.toBeInTheDocument()
  })

  it('состояния печатаются серверные: FAILED показывает безопасную причину', async () => {
    server.use(
      http.get(EXPORTS_URL, () =>
        HttpResponse.json(
          response({
            results: [
              job({
                state: 'FAILED',
                failureCode: 'RATING_DISABLED',
                safeFailureMessage: 'Оперативный рейтинг выключен.',
                finishedAt: '2026-07-20T08:05:00+05:00',
              }),
            ],
          }),
        ),
      ),
    )
    renderPage()
    const row = await screen.findByRole('row', { name: /Ошибка/ })
    expect(within(row).getByText(/Оперативный рейтинг выключен\./)).toBeInTheDocument()
    // У упавшей работы нет ни скачивания, ни отмены: отменять нечего.
    expect(within(row).queryByRole('button')).not.toBeInTheDocument()
  })

  it('отменённая работа не предлагает ни отмены, ни файла', async () => {
    server.use(
      http.get(EXPORTS_URL, () =>
        HttpResponse.json(
          response({ results: [job({ state: 'CANCELLED', finishedAt: '2026-07-20T08:01:00+05:00' })] }),
        ),
      ),
    )
    renderPage()
    const row = await screen.findByRole('row', { name: /Отменён/ })
    expect(within(row).queryByRole('button')).not.toBeInTheDocument()
  })

  it('заказ уходит с режимом, форматом и ключом идемпотентности', async () => {
    const bodies: unknown[] = []
    server.use(
      http.get(EXPORTS_URL, () => HttpResponse.json(response({ results: [] }))),
      http.post(EXPORTS_URL, async ({ request }) => {
        bodies.push(await request.json())
        return HttpResponse.json({ job: job() }, { status: 201 })
      }),
    )
    renderPage()
    await userEvent.click(await screen.findByRole('button', { name: 'Заказать CSV' }))
    await waitFor(() => expect(bodies).toHaveLength(1))
    expect(bodies[0]).toMatchObject({ scope: 'AGGREGATE', format: 'CSV' })
    expect(String((bodies[0] as { idempotencyKey: string }).idempotencyKey).length).toBeGreaterThan(
      5,
    )
  })

  it('второй заказ уходит с ДРУГИМ ключом — иначе он вернул бы прежнюю работу', async () => {
    const bodies: { idempotencyKey: string }[] = []
    server.use(
      http.get(EXPORTS_URL, () => HttpResponse.json(response({ results: [] }))),
      http.post(EXPORTS_URL, async ({ request }) => {
        bodies.push((await request.json()) as { idempotencyKey: string })
        return HttpResponse.json({ job: job() }, { status: 201 })
      }),
    )
    renderPage()
    const button = await screen.findByRole('button', { name: 'Заказать CSV' })
    await userEvent.click(button)
    await waitFor(() => expect(bodies).toHaveLength(1))
    await userEvent.click(button)
    await waitFor(() => expect(bodies).toHaveLength(2))
    expect(bodies[0].idempotencyKey).not.toBe(bodies[1].idempotencyKey)
  })

  it('выключенный рейтинг не даёт заказать файл и говорит почему', async () => {
    server.use(
      http.get(EXPORTS_URL, () =>
        HttpResponse.json(response({ results: [], capabilities: { operationalRatings: false } })),
      ),
    )
    renderPage()
    expect(await screen.findByRole('button', { name: 'Заказать CSV' })).toBeDisabled()
    expect(screen.getByText(/Оперативный рейтинг выключен/)).toBeInTheDocument()
  })

  it('недоступные форматы и режим §19.29 названы вслух с причиной', async () => {
    server.use(http.get(EXPORTS_URL, () => HttpResponse.json(response({ results: [] }))))
    renderPage()
    expect(
      await screen.findByText(/Экспорт индивидуальных оценок \(sensitive export\)/),
    ).toBeInTheDocument()
    expect(screen.getByText(/Генератора книги XLSX в сборке нет\./)).toBeInTheDocument()
    expect(screen.getByText(/Генератора PDF в сборке нет\./)).toBeInTheDocument()
    // Выбора режима на экране НЕТ: недоступное не предлагается кнопкой, а
    // называется причиной. Иначе экран обещал бы файл, которого не соберут.
    expect(
      screen.queryByRole('button', { name: /индивидуальн/i }),
    ).not.toBeInTheDocument()
  })
})
