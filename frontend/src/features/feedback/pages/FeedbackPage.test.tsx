// @vitest-environment jsdom
// Реестр обращений на экране (§28). Главное свойство: экран НИЧЕГО не считает
// и не режет сам — сводка, страницы, вырезанное содержание и причина отказа
// приходят с сервера, а форма отправляет ровно то, что человек согласился
// отдать.
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
import { FEEDBACK_REGISTRY } from '../mocks/fixtures'
import { FeedbackPage } from './FeedbackPage'
import type { FeedbackRequestView, ListFeedbackResponse } from '../api/pending-contracts'

const LIST_URL = '*/api/ops/feedback-requests/'

function row(overrides: Partial<FeedbackRequestView> = {}): FeedbackRequestView {
  return {
    feedbackId: 'fb-1',
    subject: 'Не открывается карточка мероприятия',
    typeCode: 'BUG',
    priorityCode: 'HIGH',
    statusCode: 'NEW',
    moduleCode: 'SECURITY_EVENTS',
    authorLabel: 'Организатор ОМ',
    createdAt: '2026-07-20T08:00:00+05:00',
    submittedAt: '2026-07-20T08:00:00+05:00',
    confidential: false,
    isOwn: true,
    description: 'Полное описание обращения.',
    descriptionPreview: 'Полное описание обращения.',
    expectedResult: null,
    reproductionSteps: null,
    contact: null,
    relatedRoute: '/security-events',
    attachments: [],
    technicalInfo: null,
    restrictedReason: null,
    ...overrides,
  }
}

function list(overrides: Partial<ListFeedbackResponse> = {}): ListFeedbackResponse {
  return {
    results: [row()],
    stats: {
      byStatus: FEEDBACK_REGISTRY.statuses.map((entry) => ({
        statusCode: entry.code,
        count: entry.code === 'NEW' ? 42 : 0,
      })),
      total: 42,
    },
    registry: FEEDBACK_REGISTRY,
    page: 1,
    pageSize: 4,
    pageCount: 1,
    totalMatched: 1,
    totalVisible: 1,
    unavailableCapabilities: [
      {
        code: 'ATTACHMENT_CONTENT',
        label: 'Содержимое вложений',
        reason: 'Blob-хранилища нет: сохраняются только имя, размер и тип файла.',
      },
    ],
    serverTime: '2026-07-20T08:00:00+05:00',
    ...overrides,
  }
}

function renderPage(): void {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={client}>
        <MemoryRouter>
          <ToastProvider>{children}</ToastProvider>
        </MemoryRouter>
      </QueryClientProvider>
    )
  }
  render(<FeedbackPage />, { wrapper: Wrapper })
}

beforeEach(() => {
  setCredential({ kind: 'dev', userId: 'demo-event-planner' })
})

afterEach(() => {
  cleanup()
  clearCredential()
})

describe('Обратная связь — реестр (§28 list)', () => {
  it('сводка берётся из ответа сервера, а не считается по отрисованным строкам', async () => {
    server.use(http.get(LIST_URL, () => HttpResponse.json(list())))
    renderPage()

    // Ответ ЗАВЕДОМО расходится с сеткой: одна строка на экране, 42 в сводке.
    // Экран, который сложил бы видимые строки, показал бы 1.
    expect(await screen.findByTestId('stat-NEW')).toHaveTextContent('42')
    expect(screen.getByText(/Всего доступно обращений: 42/)).toBeInTheDocument()
  })

  it('подписи типов и статусов приходят из справочника, а не из кода экрана', async () => {
    server.use(
      http.get(LIST_URL, () =>
        HttpResponse.json(
          list({
            registry: {
              ...FEEDBACK_REGISTRY,
              statuses: FEEDBACK_REGISTRY.statuses.map((entry) =>
                entry.code === 'NEW' ? { ...entry, label: 'Только что заведено' } : entry,
              ),
            },
          }),
        ),
      ),
    )
    renderPage()

    // Экран печатает подпись сервера, даже если она непривычная. Подпись
    // приходит в трёх местах (сводка, фильтр, бейдж строки) — ассерт по
    // ОДНОМУ элементу здесь неоднозначен, а не строг.
    expect(await screen.findAllByText('Только что заведено', { exact: true })).toHaveLength(3)
    // Привычной подписи нет НИГДЕ: значит, в компоненте её и не было.
    expect(screen.queryByText('Новое', { exact: true })).not.toBeInTheDocument()
  })

  it('у закрытого обращения экран печатает причину, а содержания в DOM нет вовсе', async () => {
    server.use(
      http.get(LIST_URL, () =>
        HttpResponse.json(
          list({
            results: [
              row({
                subject: 'Обращение по доступу',
                confidential: true,
                isOwn: false,
                description: null,
                descriptionPreview: null,
                attachments: null,
                technicalInfo: null,
                relatedRoute: null,
                restrictedReason: 'Обращение помечено автором как конфиденциальное.',
              }),
            ],
          }),
        ),
      ),
    )
    renderPage()

    expect(await screen.findByText('Обращение по доступу')).toBeInTheDocument()
    expect(screen.getByText('Конфиденциально', { exact: true })).toBeInTheDocument()
    expect(
      screen.getByText('Обращение помечено автором как конфиденциальное.'),
    ).toBeInTheDocument()
    expect(screen.queryByText(/Вложения \(метаданные\)/)).not.toBeInTheDocument()
  })

  it('«ничего не нашлось» и «обращений ещё нет» — разные сообщения', async () => {
    server.use(
      http.get(LIST_URL, () =>
        HttpResponse.json(list({ results: [], totalMatched: 0, totalVisible: 0 })),
      ),
    )
    renderPage()
    expect(await screen.findByText('Обращений пока нет.')).toBeInTheDocument()

    cleanup()
    server.use(
      http.get(LIST_URL, () =>
        HttpResponse.json(list({ results: [], totalMatched: 0, totalVisible: 7 })),
      ),
    )
    renderPage()
    expect(await screen.findByText(/ничего не нашлось/)).toBeInTheDocument()
  })

  it('страницы считает сервер: кнопки следуют его page/pageCount', async () => {
    server.use(
      http.get(LIST_URL, () => HttpResponse.json(list({ page: 2, pageCount: 3, totalMatched: 9 }))),
    )
    renderPage()

    expect(await screen.findByText('Страница 2 из 3 · найдено 9')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Назад' })).toBeEnabled()
    expect(screen.getByRole('button', { name: 'Вперёд' })).toBeEnabled()
  })

  it('на последней странице «Вперёд» выключен, на первой — «Назад»', async () => {
    server.use(http.get(LIST_URL, () => HttpResponse.json(list({ page: 1, pageCount: 1 }))))
    renderPage()

    await screen.findByText('Страница 1 из 1 · найдено 1')
    expect(screen.getByRole('button', { name: 'Назад' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Вперёд' })).toBeDisabled()
  })

  it('поиск и фильтры уезжают В ЗАПРОС, а не режут полученный массив', async () => {
    const seen: string[] = []
    server.use(
      http.get(LIST_URL, ({ request }) => {
        seen.push(new URL(request.url).search)
        return HttpResponse.json(list())
      }),
    )
    renderPage()
    await screen.findByText('Не открывается карточка мероприятия')

    await userEvent.type(screen.getByLabelText('Поиск по обращениям'), 'карточка')
    await userEvent.selectOptions(screen.getByLabelText('Фильтр по типу'), 'UX')

    await waitFor(() => {
      expect(seen.some((search) => search.includes('search=') && search.includes('type=UX'))).toBe(
        true,
      )
    })
  })

  it('смена фильтра возвращает на первую страницу', async () => {
    const seen: string[] = []
    server.use(
      http.get(LIST_URL, ({ request }) => {
        seen.push(new URL(request.url).search)
        return HttpResponse.json(list({ page: 2, pageCount: 3, totalMatched: 9 }))
      }),
    )
    renderPage()
    await screen.findByText('Страница 2 из 3 · найдено 9')

    await userEvent.click(screen.getByRole('button', { name: 'Вперёд' }))
    await waitFor(() => expect(seen.some((s) => s.includes('page=3'))).toBe(true))

    await userEvent.selectOptions(screen.getByLabelText('Фильтр по статусу'), 'FIXED')
    await waitFor(() => {
      const last = seen[seen.length - 1]
      expect(last).toContain('status=FIXED')
      expect(last).not.toContain('page=')
    })
  })

  it('кнопка отправки есть только у СВОЕГО черновика', async () => {
    server.use(
      http.get(LIST_URL, () =>
        HttpResponse.json(
          list({
            results: [
              row({ feedbackId: 'fb-own-draft', statusCode: 'DRAFT', isOwn: true }),
              row({ feedbackId: 'fb-sent', statusCode: 'NEW', isOwn: true }),
            ],
          }),
        ),
      ),
    )
    renderPage()

    await screen.findAllByText('Не открывается карточка мероприятия')
    expect(screen.getAllByRole('button', { name: 'Отправить в работу' })).toHaveLength(1)
  })
})

describe('Обратная связь — форма (§28 create)', () => {
  async function renderWithCapture() {
    const bodies: Record<string, unknown>[] = []
    server.use(
      http.get(LIST_URL, () => HttpResponse.json(list())),
      http.post(LIST_URL, async ({ request }) => {
        const body = (await request.json()) as Record<string, unknown>
        bodies.push(body)
        return HttpResponse.json({ feedbackId: 'feedback-1-1' })
      }),
    )
    renderPage()
    await screen.findByLabelText('Тема обращения')
    await userEvent.type(screen.getByLabelText('Тема обращения'), 'Ошибка в плане')
    await userEvent.type(screen.getByLabelText('Описание обращения'), 'Смена не сохраняется.')
    return bodies
  }

  it('без согласия техническая информация в запрос НЕ кладётся', async () => {
    const bodies = await renderWithCapture()
    await userEvent.click(screen.getByRole('button', { name: 'Создать обращение' }))

    await waitFor(() => expect(bodies).toHaveLength(1))
    expect(bodies[0].includeTechnicalInfo).toBe(false)
    expect(bodies[0].technicalInfo).toBeNull()
  })

  it('при согласии техническая информация собирается и берёт СЕРВЕРНОЕ время', async () => {
    const bodies = await renderWithCapture()
    await userEvent.click(
      screen.getByLabelText(/Приложить техническую информацию/, { exact: false }),
    )
    await userEvent.click(screen.getByRole('button', { name: 'Создать обращение' }))

    await waitFor(() => expect(bodies).toHaveLength(1))
    expect(bodies[0].includeTechnicalInfo).toBe(true)
    const technicalInfo = bodies[0].technicalInfo as { capturedAt: string }
    // Отметка времени — из ответа сервера, а не из часов машины: иначе она
    // разошлась бы с датами самих обращений (§8.8).
    expect(technicalInfo.capturedAt).toBe('2026-07-20T08:00:00+05:00')
  })

  it('«Сохранить без отправки» и «Создать обращение» шлют разный признак черновика', async () => {
    const bodies = await renderWithCapture()
    await userEvent.click(screen.getByRole('button', { name: 'Сохранить без отправки' }))
    await waitFor(() => expect(bodies).toHaveLength(1))
    expect(bodies[0].saveAsDraft).toBe(true)
  })

  it('обе кнопки выключены, пока нет темы или описания', async () => {
    server.use(http.get(LIST_URL, () => HttpResponse.json(list())))
    renderPage()
    await screen.findByLabelText('Тема обращения')

    expect(screen.getByRole('button', { name: 'Создать обращение' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Сохранить без отправки' })).toBeDisabled()

    await userEvent.type(screen.getByLabelText('Тема обращения'), 'Тема')
    // Одной темы мало: описание §28 обязательно.
    expect(screen.getByRole('button', { name: 'Создать обращение' })).toBeDisabled()
  })

  it('форма очищается после успешного создания', async () => {
    const bodies = await renderWithCapture()
    await userEvent.click(screen.getByRole('button', { name: 'Создать обращение' }))
    await waitFor(() => expect(bodies).toHaveLength(1))

    await waitFor(() => {
      expect(screen.getByLabelText('Тема обращения')).toHaveValue('')
    })
  })

  it('отказ сервера печатается человеку, а форма не считает себя отправленной', async () => {
    server.use(
      http.get(LIST_URL, () => HttpResponse.json(list())),
      http.post(LIST_URL, () =>
        HttpResponse.json(
          {
            error_code: 'VALIDATION_ERROR',
            message: 'Тема длиннее 160 символов.',
            details: {},
            request_id: null,
            timestamp: '2026-07-20T08:00:00+05:00',
          },
          { status: 422 },
        ),
      ),
    )
    renderPage()
    await userEvent.type(await screen.findByLabelText('Тема обращения'), 'Тема')
    await userEvent.type(screen.getByLabelText('Описание обращения'), 'Описание')
    await userEvent.click(screen.getByRole('button', { name: 'Создать обращение' }))

    expect(await screen.findByText('Тема длиннее 160 символов.')).toBeInTheDocument()
    // Введённое не потеряно: человеку есть что исправлять.
    expect(screen.getByLabelText('Тема обращения')).toHaveValue('Тема')
  })

  it('§35-блок печатается дословно из ответа сервера', async () => {
    server.use(http.get(LIST_URL, () => HttpResponse.json(list())))
    renderPage()
    expect(
      await screen.findByText(/Blob-хранилища нет: сохраняются только имя, размер и тип файла\./),
    ).toBeInTheDocument()
  })
})
