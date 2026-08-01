// @vitest-environment jsdom
// Карточка обращения на экране (§28 detail). Главное свойство: экран не знает
// ни одного условия доступности — что можно сделать, в какие статусы можно
// уйти и видна ли внутренняя заметка, приходит с сервера.
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
import { ToastProvider } from '../../../shared/ui/toast'
import { FEEDBACK_REGISTRY } from '../mocks/fixtures'
import { FeedbackDetailPage } from './FeedbackDetailPage'
import type { FeedbackDetailResponse, FeedbackRequestView } from '../api/pending-contracts'

const DETAIL_URL = '*/api/ops/feedback-requests/fb-card/'
const TRIAGE_URL = '*/api/ops/feedback-requests/fb-card/triage/'
const COMMENTS_URL = '*/api/ops/feedback-requests/fb-card/comments/'

function view(overrides: Partial<FeedbackRequestView> = {}): FeedbackRequestView {
  return {
    feedbackId: 'fb-card',
    subject: 'Не открывается карточка мероприятия',
    typeCode: 'BUG',
    priorityCode: 'CRITICAL',
    statusCode: 'NEW',
    moduleCode: 'SECURITY_EVENTS',
    authorLabel: 'Организатор ОМ',
    createdAt: '2026-07-20T08:00:00+05:00',
    submittedAt: '2026-07-20T08:00:00+05:00',
    confidential: false,
    workingPriorityCode: null,
    assigneeLabel: null,
    assigneeUserId: null,
    isOwn: false,
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

function detail(overrides: Partial<FeedbackDetailResponse> = {}): FeedbackDetailResponse {
  return {
    request: view(),
    comments: [],
    timeline: [
      {
        eventId: 'e-1',
        kind: 'CREATED',
        actorLabel: 'Организатор ОМ',
        at: '2026-07-20T08:00:00+05:00',
        fieldCode: null,
        oldValue: null,
        newValue: null,
      },
    ],
    actions: [
      { code: 'ADD_PUBLIC_REPLY', available: true, reason: null },
      { code: 'ADD_INTERNAL_NOTE', available: false, reason: 'Нужно отдельное право.' },
      { code: 'TRIAGE', available: true, reason: null },
      { code: 'CLOSE', available: true, reason: null },
    ],
    allowedStatuses: ['IN_REVIEW', 'NEED_INFO', 'REJECTED'],
    assigneeCandidates: [{ userId: 'demo-objects-admin', safeLabel: 'Ведение объектов' }],
    duplicateOf: null,
    registry: FEEDBACK_REGISTRY,
    unavailableBlocks: [
      { code: 'SLA', label: 'Срок реакции', reason: 'Политики сроков в модели нет.' },
    ],
    serverTime: '2026-07-20T08:00:00+05:00',
    ...overrides,
  }
}

function renderCard(): void {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={['/feedback/fb-card']}>
          <ToastProvider>{children}</ToastProvider>
        </MemoryRouter>
      </QueryClientProvider>
    )
  }
  render(
    <Routes>
      <Route path="/feedback/:feedbackId" element={<FeedbackDetailPage />} />
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

describe('Карточка обращения (§28 detail)', () => {
  it('рабочий приоритет не подменяется заявленным, пока разбора не было', async () => {
    server.use(http.get(DETAIL_URL, () => HttpResponse.json(detail())))
    renderCard()

    // Заявленный «Критический» — на месте; рабочего нет, и это сказано словами.
    expect(await screen.findByTestId('card-working-priority')).toHaveTextContent(
      'не назначен — обращение ещё не разбирали',
    )
    expect(screen.getByTestId('card-assignee')).toHaveTextContent('не назначен')
  })

  it('доступность действий берётся из ответа, а не выводится из статуса', async () => {
    // Ответ ЗАВЕДОМО противоречив: обращение ЗАКРЫТО, но сервер разрешает
    // разбор. Экран, у которого есть своя ветка «если закрыто — выключить»,
    // этот ответ не послушает.
    server.use(
      http.get(DETAIL_URL, () =>
        HttpResponse.json(
          detail({
            request: view({ statusCode: 'CLOSED' }),
            actions: [
              { code: 'ADD_PUBLIC_REPLY', available: true, reason: null },
              { code: 'ADD_INTERNAL_NOTE', available: false, reason: 'Нужно отдельное право.' },
              { code: 'TRIAGE', available: true, reason: null },
              { code: 'CLOSE', available: true, reason: null },
            ],
          }),
        ),
      ),
    )
    renderCard()

    expect(await screen.findByTestId('card-status')).toHaveTextContent('Закрыто')
    expect(screen.getByRole('group', { name: 'Разбор обращения' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Отправить ответ' })).toBeInTheDocument()
  })

  it('поле внутренней заметки не рисуется без права, причина отказа названа', async () => {
    server.use(http.get(DETAIL_URL, () => HttpResponse.json(detail())))
    renderCard()

    await screen.findByLabelText('Ответ автору')
    expect(screen.queryByLabelText('Внутренняя заметка')).not.toBeInTheDocument()
  })

  it('с правом поле заметки появляется', async () => {
    server.use(
      http.get(DETAIL_URL, () =>
        HttpResponse.json(
          detail({
            actions: [
              { code: 'ADD_PUBLIC_REPLY', available: true, reason: null },
              { code: 'ADD_INTERNAL_NOTE', available: true, reason: null },
              { code: 'TRIAGE', available: true, reason: null },
              { code: 'CLOSE', available: true, reason: null },
            ],
          }),
        ),
      ),
    )
    renderCard()
    expect(await screen.findByLabelText('Внутренняя заметка')).toBeInTheDocument()
  })

  it('список переходов приходит с сервера — экран не выводит его из статуса', async () => {
    server.use(
      http.get(DETAIL_URL, () =>
        HttpResponse.json(detail({ allowedStatuses: ['PLANNED'] })),
      ),
    )
    renderCard()

    const select = await screen.findByLabelText('Перевести в статус')
    // Ровно один переход + плейсхолдер: экран не добавил «привычных» статусов.
    expect(select.querySelectorAll('option')).toHaveLength(2)
    expect(screen.getByRole('option', { name: 'Запланировано' })).toBeInTheDocument()
  })

  it('терминальные статусы уходят в закрытие, а не в разбор', async () => {
    server.use(
      http.get(DETAIL_URL, () =>
        HttpResponse.json(detail({ allowedStatuses: ['IN_REVIEW', 'REJECTED'] })),
      ),
    )
    renderCard()

    const workflow = await screen.findByLabelText('Перевести в статус')
    const closing = screen.getByLabelText('Исход закрытия')
    // «Отклонено» — терминальный статус справочника: он предлагается только
    // при закрытии, где обязателен ответ автору.
    expect(workflow).not.toHaveTextContent('Отклонено')
    expect(closing).toHaveTextContent('Отклонено')
  })

  it('закрытие не отправляется без ответа автору', async () => {
    server.use(http.get(DETAIL_URL, () => HttpResponse.json(detail())))
    renderCard()

    await userEvent.selectOptions(await screen.findByLabelText('Исход закрытия'), 'REJECTED')
    expect(screen.getByRole('button', { name: 'Закрыть обращение' })).toBeDisabled()

    await userEvent.type(screen.getByLabelText('Ответ автору при закрытии'), 'Причина.')
    expect(screen.getByRole('button', { name: 'Закрыть обращение' })).toBeEnabled()
  })

  it('разбор шлёт ровно изменённое поле, не трогая остальные', async () => {
    const bodies: Record<string, unknown>[] = []
    server.use(
      http.get(DETAIL_URL, () => HttpResponse.json(detail())),
      http.post(TRIAGE_URL, async ({ request }) => {
        bodies.push((await request.json()) as Record<string, unknown>)
        return HttpResponse.json({ feedbackId: 'fb-card' })
      }),
    )
    renderCard()

    await userEvent.selectOptions(await screen.findByLabelText('Рабочий приоритет'), 'LOW')
    await waitFor(() => expect(bodies).toHaveLength(1))
    // Ни статуса, ни ответственного в теле нет: `undefined` — «не трогать»,
    // и отправить их значило бы переназначить их прежними значениями.
    expect(Object.keys(bodies[0])).toEqual(['workingPriorityCode'])
    expect(bodies[0].workingPriorityCode).toBe('LOW')
  })

  it('ссылка на оригинал-дубликат печатает причину, если он смотрящему не виден', async () => {
    server.use(
      http.get(DETAIL_URL, () =>
        HttpResponse.json(
          detail({
            request: view({ statusCode: 'DUPLICATE' }),
            duplicateOf: {
              feedbackId: 'fb-original',
              subject: null,
              hiddenReason: 'Обращение-оригинал недоступно смотрящему.',
            },
          }),
        ),
      ),
    )
    renderCard()

    const block = await screen.findByTestId('card-duplicate')
    expect(block).toHaveTextContent('Обращение-оригинал недоступно смотрящему.')
    // Ссылки нет: вести некуда, и «пустая» ссылка обещала бы доступ.
    expect(block.querySelector('a')).toBeNull()
  })

  it('после успешного комментария поле очищается', async () => {
    let sent = 0
    server.use(
      http.get(DETAIL_URL, () =>
        HttpResponse.json(
          sent === 0
            ? detail()
            : detail({
                comments: [
                  {
                    commentId: 'c-1',
                    kind: 'PUBLIC_REPLY',
                    body: 'Разбираемся.',
                    authorLabel: 'Аналитик',
                    createdAt: '2026-07-20T08:01:00+05:00',
                  },
                ],
              }),
        ),
      ),
      http.post(COMMENTS_URL, () => {
        sent += 1
        return HttpResponse.json({ feedbackId: 'fb-card' })
      }),
    )
    renderCard()

    await userEvent.type(await screen.findByLabelText('Ответ автору'), 'Разбираемся.')
    await userEvent.click(screen.getByRole('button', { name: 'Отправить ответ' }))

    await waitFor(() => {
      expect(screen.getByLabelText('Ответ автору')).toHaveValue('')
    })
  })

  it('невидимое обращение показывает отказ сервера, а не пустую карточку', async () => {
    server.use(
      http.get(DETAIL_URL, () =>
        HttpResponse.json(
          {
            error_code: 'ENTITY_NOT_FOUND',
            message: 'Обращение не найдено.',
            details: {},
            request_id: null,
            timestamp: '2026-07-20T08:00:00+05:00',
          },
          { status: 404 },
        ),
      ),
    )
    renderCard()
    expect(await screen.findByText('Обращение не найдено.')).toBeInTheDocument()
  })

  it('§35-блок карточки печатается дословно из ответа', async () => {
    server.use(http.get(DETAIL_URL, () => HttpResponse.json(detail())))
    renderCard()
    expect(await screen.findByText(/Политики сроков в модели нет\./)).toBeInTheDocument()
  })
})
