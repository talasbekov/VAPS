// @vitest-environment jsdom
// Стори 10.5 AC-7 — скачивание официального .docx.
//
// Ловушка окружения №9: jsdom НЕ реализует URL.createObjectURL/revokeObjectURL —
// оба стабятся здесь. Честная проверка скачанных БАЙТОВ и заголовка
// Content-Disposition возможна только в Playwright
// (`page.waitForEvent('download')`) — открытый вопрос №5 стори.
//
// Что этот файл доказывает вместо байтов:
//  - запрос идёт через канал `shared/api` и НЕСЁТ auth-заголовок (голый
//    `<a href>` его не несёт и получил бы 403 — красная проба №3);
//  - objectURL освобождается (иначе блоб живёт до перезагрузки вкладки);
//  - 403 читается объяснением, а не тишиной.
import '@testing-library/jest-dom/vitest'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import type { ReactNode } from 'react'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { setCredential, clearCredential } from '../../shared/auth/credential'
import { server } from '../../shared/api/testing/server'
import { issuedExpenseReportFixture } from '../../shared/api/testing/handlers'
import { ToastProvider } from '../../shared/ui/toast'
import { ExpenseReportPage } from './ExpenseReportPage'

const DIVISION_ID = '7a1b2c3d-4e5f-6071-8293-a4b5c6d7e8f9'
const ATTACHMENT_ID = issuedExpenseReportFixture.attachment_id

let createdUrls: string[]
let revokedUrls: string[]
let anchorClicks: { href: string; download: string }[]

beforeEach(() => {
  createdUrls = []
  revokedUrls = []
  anchorClicks = []

  // jsdom этих методов не имеет вовсе — определяем, а не шпионим
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

  // Клик по синтетическому <a download> в jsdom навигацию не выполняет —
  // перехватываем, чтобы прочитать href и имя файла.
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
    this: HTMLAnchorElement,
  ) {
    anchorClicks.push({ href: this.href, download: this.download })
  })

  setCredential({ kind: 'dev', userId: 'user-omd-7' })
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  clearCredential()
})

function divisionsResponse() {
  return HttpResponse.json({
    count: 1,
    next: null,
    previous: null,
    results: [
      { id: DIVISION_ID, name: 'Управление кадров', parent: null, is_active: true },
    ],
  })
}

function errorEnvelope(errorCode: string, message: string) {
  return {
    error_code: errorCode,
    message,
    details: {},
    request_id: 'req-10-5',
    timestamp: '2026-07-19T08:00:00+05:00',
  }
}

function renderPage() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>
        {/* MemoryRouter добавлен стори 10.7 — см. ExpenseReportPage.test.tsx:
            <Link> печатной формы без Router-контекста падает на монтаже. */}
        <ToastProvider>
          <MemoryRouter>{children}</MemoryRouter>
        </ToastProvider>
      </QueryClientProvider>
    )
  }
  return render(<ExpenseReportPage />, { wrapper: Wrapper })
}

/** Довести экран до карточки с кнопкой «Скачать». */
async function reachIssuedCard() {
  const user = userEvent.setup()
  renderPage()
  const select = await screen.findByLabelText('Подразделение')
  await waitFor(() => expect(select).not.toBeDisabled())
  await user.selectOptions(select, DIVISION_ID)
  await screen.findByRole('button', { name: 'Скачать' })
  return user
}

describe('AC-7: скачивание идёт авторизованным каналом shared/api', () => {
  it('успех: заголовок авторизации ушёл, имя файла — из Content-Disposition', async () => {
    let sentUserId: string | null = 'не вызывался'
    let requestedUrl = ''
    server.use(
      http.get('*/api/core/divisions/', () => divisionsResponse()),
      http.get('*/api/operations/expense-reports/', () =>
        HttpResponse.json(issuedExpenseReportFixture),
      ),
      http.get('*/api/documents/attachments/:id/download/', ({ request }) => {
        sentUserId = request.headers.get('X-User-Id')
        requestedUrl = request.url
        return new HttpResponse(new Blob(['PK-docx']), {
          headers: {
            'Content-Disposition':
              "attachment; filename=\"expense.docx\"; filename*=UTF-8''%D1%80%D0%B0%D1%81%D1%85%D0%BE%D0%B4_2026-07-19_%D0%B8%D1%81%D1%85-247.docx",
          },
        })
      }),
    )
    const user = await reachIssuedCard()
    await user.click(screen.getByRole('button', { name: 'Скачать' }))

    await waitFor(() => expect(anchorClicks).toHaveLength(1))
    // Красная проба №3: голый <a href> этого заголовка не несёт и дал бы 403
    expect(sentUserId).toBe('user-omd-7')
    expect(requestedUrl).toContain(`/api/documents/attachments/${ATTACHMENT_ID}/download/`)
    // Имя от СЕРВЕРА приоритетно и percent-декодировано
    expect(anchorClicks[0].download).toBe('расход_2026-07-19_исх-247.docx')
    expect(anchorClicks[0].href).toBe(createdUrls[0])
  })

  it('objectURL освобождается после клика (revokeObjectURL вызван)', async () => {
    server.use(
      http.get('*/api/core/divisions/', () => divisionsResponse()),
      http.get('*/api/operations/expense-reports/', () =>
        HttpResponse.json(issuedExpenseReportFixture),
      ),
      http.get(
        '*/api/documents/attachments/:id/download/',
        () => new HttpResponse(new Blob(['PK-docx'])),
      ),
    )
    const user = await reachIssuedCard()
    await user.click(screen.getByRole('button', { name: 'Скачать' }))

    await waitFor(() => expect(revokedUrls).toHaveLength(1))
    expect(revokedUrls[0]).toBe(createdUrls[0])
  })

  it('сервер имени не назвал → клиентский фолбэк из {business_date, number}', async () => {
    server.use(
      http.get('*/api/core/divisions/', () => divisionsResponse()),
      http.get('*/api/operations/expense-reports/', () =>
        HttpResponse.json({
          ...issuedExpenseReportFixture,
          business_date: '2026-07-19',
          number: 247,
        }),
      ),
      http.get(
        '*/api/documents/attachments/:id/download/',
        // Заголовка Content-Disposition нет вовсе
        () => new HttpResponse(new Blob(['PK-docx'])),
      ),
    )
    const user = await reachIssuedCard()
    await user.click(screen.getByRole('button', { name: 'Скачать' }))

    await waitFor(() => expect(anchorClicks).toHaveLength(1))
    expect(anchorClicks[0].download).toBe('расход_2026-07-19_исх-247.docx')
  })

  it('403 → ЧИТАЕМОЕ объяснение про document.view, не тишина и не голый код', async () => {
    // Живой разрыв прав: роль OMD имеет daily_report.generate, но НЕ
    // document.view (seed_operations.py:51-55) — выпускает и не скачивает.
    server.use(
      http.get('*/api/core/divisions/', () => divisionsResponse()),
      http.get('*/api/operations/expense-reports/', () =>
        HttpResponse.json(issuedExpenseReportFixture),
      ),
      http.get('*/api/documents/attachments/:id/download/', () =>
        HttpResponse.json(errorEnvelope('PERMISSION_DENIED', 'PERMISSION_DENIED'), {
          status: 403,
        }),
      ),
    )
    const user = await reachIssuedCard()
    await user.click(screen.getByRole('button', { name: 'Скачать' }))

    expect(
      await screen.findByText(/Нет права на скачивание документов/),
    ).toBeInTheDocument()
    expect(screen.queryByText(/PERMISSION_DENIED/)).not.toBeInTheDocument()
    // Файл не сохранялся
    expect(anchorClicks).toHaveLength(0)
    expect(createdUrls).toHaveLength(0)
  })

  it('403 не прячет кнопку: документ выпущен и лежит, «функции нет» было бы ложью', async () => {
    server.use(
      http.get('*/api/core/divisions/', () => divisionsResponse()),
      http.get('*/api/operations/expense-reports/', () =>
        HttpResponse.json(issuedExpenseReportFixture),
      ),
      http.get('*/api/documents/attachments/:id/download/', () =>
        HttpResponse.json(errorEnvelope('PERMISSION_DENIED', 'PERMISSION_DENIED'), {
          status: 403,
        }),
      ),
    )
    const user = await reachIssuedCard()
    await user.click(screen.getByRole('button', { name: 'Скачать' }))
    await screen.findByText(/Нет права на скачивание документов/)

    expect(screen.getByRole('button', { name: 'Скачать' })).toBeInTheDocument()
  })

  it('404 файла → своё объяснение, отличное от 403', async () => {
    server.use(
      http.get('*/api/core/divisions/', () => divisionsResponse()),
      http.get('*/api/operations/expense-reports/', () =>
        HttpResponse.json(issuedExpenseReportFixture),
      ),
      http.get('*/api/documents/attachments/:id/download/', () =>
        HttpResponse.json(errorEnvelope('ENTITY_NOT_FOUND', 'нет файла'), { status: 404 }),
      ),
    )
    const user = await reachIssuedCard()
    await user.click(screen.getByRole('button', { name: 'Скачать' }))

    expect(await screen.findByText('Файл документа не найден.')).toBeInTheDocument()
    expect(
      screen.queryByText(/Нет права на скачивание документов/),
    ).not.toBeInTheDocument()
  })
})
