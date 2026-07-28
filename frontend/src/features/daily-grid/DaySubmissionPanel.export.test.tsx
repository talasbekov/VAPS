// @vitest-environment jsdom
// Story 10.8a — «моя копия»: скачивание личного .xlsx сданной версии.
//
// Ловушка окружения №9 (зеркало ExpenseReportPage.download.test.tsx):
// jsdom НЕ реализует URL.createObjectURL/revokeObjectURL — оба стабятся
// здесь. Честная проверка байтов/Content-Disposition — только в Playwright;
// этот файл доказывает вместо байтов: запрос идёт ЗА ВЕРСИЮ `current.id`
// (не «последний id»), objectURL освобождается, 403/404/422 читаются
// объяснением, не тишиной.
import '@testing-library/jest-dom/vitest'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { clearCredential, setCredential } from '../../shared/auth/credential'
import { server } from '../../shared/api/testing/server'
import { ToastProvider } from '../../shared/ui/toast'
import { todayLocalIso } from './daySubmission'
import type { DaySubmission } from './daySubmission'
import { DaySubmissionPanel } from './DaySubmissionPanel'
import type { DaySubmissionPanelProps } from './DaySubmissionPanel'

const DIVISION_ID = '7a1b2c3d-4e5f-6071-8293-a4b5c6d7e8f9'
const TODAY = todayLocalIso()

let createdUrls: string[]
let revokedUrls: string[]
let anchorClicks: { href: string; download: string }[]

beforeEach(() => {
  createdUrls = []
  revokedUrls = []
  anchorClicks = []

  Object.defineProperty(URL, 'createObjectURL', {
    configurable: true,
    writable: true,
    value: vi.fn(() => {
      const url = `blob:mock/${createdUrls.length}`
      createdUrls.push(url)
      return url
    }),
  })
  Object.defineProperty(URL, 'revokeObjectURL', {
    configurable: true,
    writable: true,
    value: vi.fn((url: string) => {
      revokedUrls.push(url)
    }),
  })
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
    this: HTMLAnchorElement,
  ) {
    anchorClicks.push({ href: this.href, download: this.download })
  })

  setCredential({ kind: 'dev', userId: 'operator-1' })
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  clearCredential()
})

function submissionFixture(over: Partial<DaySubmission> = {}): DaySubmission {
  return {
    id: 12,
    division_id: DIVISION_ID,
    business_date: TODAY,
    version: 1,
    is_current: true,
    event: 'CHANGED',
    submitted_by: 'operator-1',
    submitted_at: '2026-07-19T08:15:00+05:00',
    late: false,
    ...over,
  }
}

function errorEnvelope(errorCode: string, message: string) {
  return {
    error_code: errorCode,
    message,
    details: {},
    request_id: 'req-10-8a',
    timestamp: '2026-07-19T08:00:00+05:00',
  }
}

function renderPanel(over: Partial<DaySubmissionPanelProps> = {}) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>
        <ToastProvider>{children}</ToastProvider>
      </QueryClientProvider>
    )
  }
  const props: DaySubmissionPanelProps = {
    divisionId: DIVISION_ID,
    businessDate: TODAY,
    dateValid: true,
    rowCount: 40,
    dirtyCount: 0,
    localDrift: [],
    nameById: {},
    submission: null,
    submissions: [],
    isLoading: false,
    isError: false,
    ...over,
  }
  return render(<DaySubmissionPanel {...props} />, { wrapper: Wrapper })
}

describe('AC-1: кнопка видна только на сданном дне', () => {
  it('день НЕ сдан → кнопки «Моя копия» нет', async () => {
    renderPanel({ submission: null })
    await screen.findByText(/День не сдан/)
    expect(screen.queryByRole('button', { name: 'Моя копия' })).not.toBeInTheDocument()
  })

  it('день сдан → кнопка есть', async () => {
    renderPanel({ submission: submissionFixture() })
    expect(await screen.findByRole('button', { name: 'Моя копия' })).toBeInTheDocument()
  })
})

describe('AC-2/AC-6: скачивание — за ВЕРСИЮ current.id, байты через apiClient', () => {
  it('успех: URL несёт current.id, имя — из Content-Disposition, objectURL освобождается', async () => {
    let requestedUrl = ''
    server.use(
      http.get('*/api/operations/daily-submissions/:id/export/', ({ request }) => {
        requestedUrl = request.url
        return new HttpResponse(new Blob(['PK-xlsx']), {
          headers: {
            'Content-Disposition':
              "attachment; filename=\"export.xlsx\"; filename*=UTF-8''%D1%81%D0%B4%D0%B0%D1%87%D0%B0_2026-07-19_v1.xlsx",
          },
        })
      }),
    )
    const user = userEvent.setup()
    renderPanel({ submission: submissionFixture({ id: 42, version: 1 }) })

    await user.click(await screen.findByRole('button', { name: 'Моя копия' }))

    await waitFor(() => expect(anchorClicks).toHaveLength(1))
    expect(requestedUrl).toContain('/api/operations/daily-submissions/42/export/')
    expect(anchorClicks[0].download).toBe('сдача_2026-07-19_v1.xlsx')
    expect(anchorClicks[0].href).toBe(createdUrls[0])
    await waitFor(() => expect(revokedUrls).toEqual(createdUrls))
  })

  it('сервер имени не назвал → клиентский фолбэк {business_date}_{version}', async () => {
    server.use(
      http.get(
        '*/api/operations/daily-submissions/:id/export/',
        () => new HttpResponse(new Blob(['PK-xlsx'])),
      ),
    )
    const user = userEvent.setup()
    renderPanel({ submission: submissionFixture({ id: 12, version: 3 }) })

    await user.click(await screen.findByRole('button', { name: 'Моя копия' }))

    await waitFor(() => expect(anchorClicks).toHaveLength(1))
    expect(anchorClicks[0].download).toBe(`сдача_${TODAY}_v3.xlsx`)
  })
})

describe('AC-4: 403/404/422 — читаемое объяснение, не тишина', () => {
  it('403 → фикс-текст про daily_report.mark_update', async () => {
    server.use(
      http.get('*/api/operations/daily-submissions/:id/export/', () =>
        HttpResponse.json(errorEnvelope('PERMISSION_DENIED', 'PERMISSION_DENIED'), {
          status: 403,
        }),
      ),
    )
    const user = userEvent.setup()
    renderPanel({ submission: submissionFixture() })

    await user.click(await screen.findByRole('button', { name: 'Моя копия' }))

    expect(await screen.findByText(/daily_report.mark_update/)).toBeInTheDocument()
    expect(screen.queryByText('PERMISSION_DENIED')).not.toBeInTheDocument()
    expect(anchorClicks).toHaveLength(0)
  })

  it('404 → «Версия сдачи не найдена.»', async () => {
    server.use(
      http.get('*/api/operations/daily-submissions/:id/export/', () =>
        HttpResponse.json(errorEnvelope('ENTITY_NOT_FOUND', 'нет сдачи'), { status: 404 }),
      ),
    )
    const user = userEvent.setup()
    renderPanel({ submission: submissionFixture() })

    await user.click(await screen.findByRole('button', { name: 'Моя копия' }))

    expect(await screen.findByText('Версия сдачи не найдена.')).toBeInTheDocument()
  })

  it('422 → текст конверта (SNAPSHOT_SCHEMA_UNSUPPORTED)', async () => {
    const message = 'Снапшот сдачи имеет неподдерживаемую версию схемы.'
    server.use(
      http.get('*/api/operations/daily-submissions/:id/export/', () =>
        HttpResponse.json(errorEnvelope('SNAPSHOT_SCHEMA_UNSUPPORTED', message), {
          status: 422,
        }),
      ),
    )
    const user = userEvent.setup()
    renderPanel({ submission: submissionFixture() })

    await user.click(await screen.findByRole('button', { name: 'Моя копия' }))

    expect(await screen.findByText(message)).toBeInTheDocument()
  })

  it('403 не прячет кнопку — повторный клик возможен', async () => {
    server.use(
      http.get('*/api/operations/daily-submissions/:id/export/', () =>
        HttpResponse.json(errorEnvelope('PERMISSION_DENIED', 'PERMISSION_DENIED'), {
          status: 403,
        }),
      ),
    )
    const user = userEvent.setup()
    renderPanel({ submission: submissionFixture() })

    await user.click(await screen.findByRole('button', { name: 'Моя копия' }))
    await screen.findByRole('alert')

    expect(screen.getByRole('button', { name: 'Моя копия' })).toBeInTheDocument()
  })
})
