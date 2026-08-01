// @vitest-environment jsdom
// Карточка отправленной оценки (§19.17) и исправление (§19.18).
//
// Главное, что проверяется: порядок шагов промпта соблюдён — diff показывается
// ДО отправки, мутация уходит с редакцией из ответа КАРТОЧКИ, а исправление не
// объявляется успешным до ответа сервера.
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
import { SubmittedEvaluationCard } from './SubmittedEvaluationCard'
import type { SubmittedEvaluationDetailResponse } from '../api/pending-contracts'

const DETAIL_URL = '*/api/ops/evaluation-work-items/:workItemId/detail/'
const CORRECT_URL = '*/api/ops/evaluation-work-items/:workItemId/correct/'

function detail(
  overrides: Partial<SubmittedEvaluationDetailResponse> = {},
): SubmittedEvaluationDetailResponse {
  return {
    workItem: {
      id: 'work-item-9',
      securityEventId: 'event-1',
      eventRunId: 'run-1',
      assignmentId: 'assignment-9',
      targetEmployeeId: 'employee-1',
      targetGroupId: null,
      targetSafeLabel: 'Ерланов Д.',
      targetSafeUnitLabel: 'Первое управление',
      postLabel: 'Пост 1 — главный вход',
      actualStartsAt: '2026-07-18T07:40:00+05:00',
      actualEndsAt: '2026-07-18T19:20:00+05:00',
      participated: true,
      evaluationDirection: 'SENIOR_TO_EMPLOYEE',
      initialScore: 8,
      status: 'SUBMITTED',
      revision: 3,
      submittedEvaluationId: 'evaluation-5',
      submittedAt: '2026-07-15T09:20:00+05:00',
    },
    submitted: {
      workItemId: 'work-item-9',
      evaluationId: 'evaluation-5',
      targetSafeLabel: 'Ерланов Д.',
      postLabel: 'Пост 1 — главный вход',
      evaluationDirection: 'SENIOR_TO_EMPLOYEE',
      method: 'MANUAL',
      score: 9,
      basisLabel: 'Исполнение обязанностей',
      basisNote: null,
      comment: null,
      submittedAt: '2026-07-15T09:20:00+05:00',
      revision: 3,
    },
    chain: [
      {
        correctionId: 'correction-1',
        evaluationId: 'evaluation-4',
        score: 3,
        basisLabel: 'Своевременное прибытие',
        basisNote: null,
        comment: 'Оценка выставлена по ошибке не тому участнику',
        supersededReason: 'Оценка выставлена по ошибке не тому участнику',
        supersededAt: '2026-07-15T09:20:00+05:00',
        current: false,
      },
      {
        correctionId: null,
        evaluationId: 'evaluation-5',
        score: 9,
        basisLabel: 'Исполнение обязанностей',
        basisNote: null,
        comment: null,
        supersededReason: null,
        supersededAt: null,
        current: true,
      },
    ],
    bases: [
      { code: 'EXECUTION_OF_DUTIES', label: 'Исполнение обязанностей', requiresNote: false },
      { code: 'DISCIPLINE', label: 'Дисциплина', requiresNote: false },
      { code: 'OTHER', label: 'Другое', requiresNote: true },
    ],
    canCorrect: true,
    loadedAt: '2026-07-20T08:00:00+05:00',
    ...overrides,
  }
}

function renderCard() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>
      <ToastProvider>{children}</ToastProvider>
    </QueryClientProvider>
  )
  return render(<SubmittedEvaluationCard workItemId="work-item-9" onClose={() => {}} />, {
    wrapper,
  })
}

beforeEach(() => {
  setCredential({ kind: 'dev', userId: 'demo-event-planner' })
})

afterEach(() => {
  cleanup()
  clearCredential()
})

describe('карточка §19.17', () => {
  it('печатает присланное и показывает историю записи со старым значением', async () => {
    server.use(http.get(DETAIL_URL, () => HttpResponse.json(detail())))
    renderCard()
    const card = await screen.findByLabelText('Отправленная оценка')
    // Идентификатор записи стоит и в карточке, и в истории — это один факт в
    // двух местах, поэтому ассерт считает вхождения, а не берёт «единственное».
    expect(within(card).getAllByText('evaluation-5')).toHaveLength(2)
    // Старое значение НЕ скрыто, и рядом с ним причина замещения (§19.18).
    expect(card.textContent).toContain('оценка 3')
    expect(card.textContent).toContain('Оценка выставлена по ошибке не тому участнику')
    expect(card.textContent).toContain('действующая запись')
  })

  it('без права цепочка не приходит — экран говорит это, а не рисует пустую историю', async () => {
    server.use(http.get(DETAIL_URL, () => HttpResponse.json(detail({ chain: null }))))
    renderCard()
    expect(
      await screen.findByText(/право на просмотр цепочки исправлений не выдано/),
    ).toBeInTheDocument()
    expect(screen.queryByText('История записи')).not.toBeInTheDocument()
  })

  it('кнопки «Исправить оценку» нет, когда право не прислал сервер', async () => {
    server.use(http.get(DETAIL_URL, () => HttpResponse.json(detail({ canCorrect: false }))))
    renderCard()
    await screen.findByLabelText('Отправленная оценка')
    expect(screen.queryByRole('button', { name: 'Исправить оценку' })).not.toBeInTheDocument()
    expect(screen.getByText(/право на исправление оценки не выдано/)).toBeInTheDocument()
  })
})

describe('исправление §19.18', () => {
  it('без причины исправление не уходит на сервер', async () => {
    const correct = vi.fn()
    server.use(
      http.get(DETAIL_URL, () => HttpResponse.json(detail())),
      http.post(CORRECT_URL, () => {
        correct()
        return HttpResponse.json({}, { status: 201 })
      }),
    )
    renderCard()
    await userEvent.click(await screen.findByRole('button', { name: 'Исправить оценку' }))
    await userEvent.selectOptions(screen.getByLabelText('Новая оценка'), '10')
    await userEvent.click(screen.getByRole('button', { name: 'Показать изменения' }))
    expect(await screen.findByText('Укажите причину исправления оценки.')).toBeInTheDocument()
    expect(correct).not.toHaveBeenCalled()
  })

  it('diff показывается ДО подтверждения, и только он открывает мутацию', async () => {
    let body: unknown = null
    server.use(
      http.get(DETAIL_URL, () => HttpResponse.json(detail())),
      http.post(CORRECT_URL, async ({ request }) => {
        body = await request.json()
        return HttpResponse.json(
          { workItem: detail().workItem, submitted: detail().submitted, chain: detail().chain },
          { status: 201 },
        )
      }),
    )
    renderCard()
    await userEvent.click(await screen.findByRole('button', { name: 'Исправить оценку' }))
    await userEvent.selectOptions(screen.getByLabelText('Новая оценка'), '10')
    await userEvent.type(screen.getByLabelText(/Причина исправления/), 'Учтён рапорт')
    // До «Показать изменения» мутации нет и подтверждать нечего.
    expect(screen.queryByRole('button', { name: 'Подтвердить исправление' })).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Показать изменения' }))

    const preview = await screen.findByLabelText('Подтверждение исправления')
    expect(preview.textContent).toContain('Оценка: 9 → 10')
    // Неизменившиеся поля в diff не печатаются — иначе настоящее изменение
    // терялось бы в списке «было = стало».
    expect(preview.textContent).not.toContain('Основание:')
    expect(body).toBeNull()

    await userEvent.click(screen.getByRole('button', { name: 'Подтвердить исправление' }))
    await waitFor(() => expect(body).not.toBeNull())
    expect(body).toMatchObject({
      score: 10,
      basisCode: 'EXECUTION_OF_DUTIES',
      basisNote: null,
      comment: null,
      reason: 'Учтён рапорт',
      // Редакция — из ответа КАРТОЧКИ (§19.18 шаг 3), а не из списка заданий.
      revision: 3,
    })
    expect((body as { idempotencyKey: string }).idempotencyKey.length).toBeGreaterThan(0)
    const json = JSON.stringify(body)
    expect(json).not.toContain('employee-1')
    expect(json).not.toContain('demo-event-planner')
  })

  it('пустой diff не даёт подтвердить: исправлять нечего', async () => {
    server.use(http.get(DETAIL_URL, () => HttpResponse.json(detail())))
    renderCard()
    await userEvent.click(await screen.findByRole('button', { name: 'Исправить оценку' }))
    await userEvent.type(screen.getByLabelText(/Причина исправления/), 'Ошибочно открыл')
    await userEvent.click(screen.getByRole('button', { name: 'Показать изменения' }))
    expect(await screen.findByText('Значения не изменились — исправлять нечего.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Подтвердить исправление' })).toBeDisabled()
  })

  it('отказ сервера показывается и НЕ выдаёт исправление за успешное', async () => {
    server.use(
      http.get(DETAIL_URL, () => HttpResponse.json(detail())),
      http.post(CORRECT_URL, () =>
        HttpResponse.json(
          {
            error_code: 'EVALUATION_REVISION_MISMATCH',
            message: 'Задание изменилось: обновите страницу и повторите.',
            details: {},
            request_id: null,
            timestamp: '2026-07-20T08:00:00+05:00',
          },
          { status: 422 },
        ),
      ),
    )
    renderCard()
    await userEvent.click(await screen.findByRole('button', { name: 'Исправить оценку' }))
    await userEvent.selectOptions(screen.getByLabelText('Новая оценка'), '10')
    await userEvent.type(screen.getByLabelText(/Причина исправления/), 'Учтён рапорт')
    await userEvent.click(screen.getByRole('button', { name: 'Показать изменения' }))
    await userEvent.click(screen.getByRole('button', { name: 'Подтвердить исправление' }))
    expect(
      await screen.findByText('Задание изменилось: обновите страницу и повторите.'),
    ).toBeInTheDocument()
    // Экран остался на подтверждении: «успешно» до commit не показывается.
    expect(screen.getByRole('button', { name: 'Подтвердить исправление' })).toBeInTheDocument()
  })

  it('возврат к правке снимает ошибку прошлой попытки — путь не заперт', async () => {
    let attempts = 0
    server.use(
      http.get(DETAIL_URL, () => HttpResponse.json(detail())),
      http.post(CORRECT_URL, () => {
        attempts += 1
        return HttpResponse.json(
          {
            error_code: 'EVALUATION_REVISION_MISMATCH',
            message: 'Задание изменилось: обновите страницу и повторите.',
            details: {},
            request_id: null,
            timestamp: '2026-07-20T08:00:00+05:00',
          },
          { status: 422 },
        )
      }),
    )
    renderCard()
    await userEvent.click(await screen.findByRole('button', { name: 'Исправить оценку' }))
    await userEvent.selectOptions(screen.getByLabelText('Новая оценка'), '10')
    await userEvent.type(screen.getByLabelText(/Причина исправления/), 'Учтён рапорт')
    await userEvent.click(screen.getByRole('button', { name: 'Показать изменения' }))
    await userEvent.click(screen.getByRole('button', { name: 'Подтвердить исправление' }))
    await screen.findByText('Задание изменилось: обновите страницу и повторите.')

    await userEvent.click(screen.getByRole('button', { name: 'Вернуться к правке' }))
    expect(
      screen.queryByText('Задание изменилось: обновите страницу и повторите.'),
    ).not.toBeInTheDocument()
    // ПОВТОРНЫЙ вход в путь: производная от ошибки не должна держать его закрытым.
    await userEvent.click(screen.getByRole('button', { name: 'Показать изменения' }))
    await userEvent.click(screen.getByRole('button', { name: 'Подтвердить исправление' }))
    await waitFor(() => expect(attempts).toBe(2))
  })
})

describe('конфликт и неизвестный исход (§19.25-19.26)', () => {
  function conflictResponse() {
    return HttpResponse.json(
      {
        error_code: 'EVALUATION_REVISION_MISMATCH',
        message: 'Запись изменилась: сравните значения и решите, что отправлять.',
        details: {
          currentRevision: 4,
          currentScore: 6,
          currentBasisLabel: 'Дисциплина',
          currentComment: 'Разбор со старшим',
          currentEvaluationId: 'evaluation-9',
        },
        request_id: null,
        timestamp: '2026-07-20T08:00:00+05:00',
      },
      { status: 409 },
    )
  }

  it('конфликт показывает diff «сейчас / вы вводите» и НЕ стирает введённое', async () => {
    server.use(
      http.get(DETAIL_URL, () => HttpResponse.json(detail())),
      http.post(CORRECT_URL, () => conflictResponse()),
    )
    renderCard()
    await userEvent.click(await screen.findByRole('button', { name: 'Исправить оценку' }))
    await userEvent.selectOptions(screen.getByLabelText('Новая оценка'), '10')
    await userEvent.type(screen.getByLabelText(/Причина исправления/), 'Учтён рапорт')
    await userEvent.click(screen.getByRole('button', { name: 'Показать изменения' }))
    await userEvent.click(screen.getByRole('button', { name: 'Подтвердить исправление' }))

    const notice = await screen.findByLabelText('Запись изменилась')
    expect(notice.textContent).toContain('Актуальная редакция: 4')
    expect(notice.textContent).toContain('сейчас 6')
    expect(notice.textContent).toContain('вы вводите 10')
    // §19.25: введённый текст сохраняется для ручного восстановления — панель
    // стоит РЯДОМ с формой и ничего не сбрасывает.
    await userEvent.click(screen.getByRole('button', { name: 'Вернуться к правке' }))
    expect(screen.getByLabelText(/Причина исправления/)).toHaveValue('Учтён рапорт')
    expect((screen.getByLabelText('Новая оценка') as HTMLSelectElement).value).toBe('10')
  })

  it('общий ConflictDialog для конфликта версии НЕ открывается (§19.25)', async () => {
    server.use(
      http.get(DETAIL_URL, () => HttpResponse.json(detail())),
      http.post(CORRECT_URL, () => conflictResponse()),
    )
    renderCard()
    await userEvent.click(await screen.findByRole('button', { name: 'Исправить оценку' }))
    await userEvent.selectOptions(screen.getByLabelText('Новая оценка'), '10')
    await userEvent.type(screen.getByLabelText(/Причина исправления/), 'Учтён рапорт')
    await userEvent.click(screen.getByRole('button', { name: 'Показать изменения' }))
    await userEvent.click(screen.getByRole('button', { name: 'Подтвердить исправление' }))
    await screen.findByLabelText('Запись изменилась')
    // Ни диалога, ни кнопки «повторить с обоснованием»: конфликт версии оценки
    // не разрешается override'ом.
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /обоснован/i })).not.toBeInTheDocument()
  })

  it('неизвестный исход не выдаётся за успех и предлагает проверить состояние (§19.26)', async () => {
    server.use(
      http.get(DETAIL_URL, () => HttpResponse.json(detail())),
      http.post(CORRECT_URL, () => HttpResponse.error()),
    )
    renderCard()
    await userEvent.click(await screen.findByRole('button', { name: 'Исправить оценку' }))
    await userEvent.selectOptions(screen.getByLabelText('Новая оценка'), '10')
    await userEvent.type(screen.getByLabelText(/Причина исправления/), 'Учтён рапорт')
    await userEvent.click(screen.getByRole('button', { name: 'Показать изменения' }))
    await userEvent.click(screen.getByRole('button', { name: 'Подтвердить исправление' }))

    const notice = await screen.findByLabelText('Исход неизвестен')
    expect(notice.textContent).toContain('результат отправки неизвестен')
    expect(screen.getByRole('button', { name: 'Проверить состояние' })).toBeInTheDocument()
    // Никакого «сохранено» и никакого перехода в состояние «отправлено».
    expect(screen.queryByText(/сохранена/i)).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Подтвердить исправление' })).toBeInTheDocument()
  })
})
