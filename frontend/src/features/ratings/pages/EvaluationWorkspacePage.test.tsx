// @vitest-environment jsdom
// Рабочее пространство оценивания (§19.7-19.10, §19.14). Главные свойства
// экрана: он печатает присланное, не отправляет форму до прохождения проверки
// и не показывает того, чего сервер не прислал.
import '@testing-library/jest-dom/vitest'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import type { ReactNode } from 'react'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { server } from '../../../shared/api/testing/server'
import { clearCredential, setCredential } from '../../../shared/auth/credential'
import { ToastProvider } from '../../../shared/ui/toast'
import { EvaluationWorkspacePage } from './EvaluationWorkspacePage'
import type {
  EvaluationWorkspaceResponse,
  EvaluationWorkItemView,
} from '../api/pending-contracts'

const WORKSPACE_URL = '*/api/ops/evaluation-workspace/'
const SUBMIT_URL = '*/api/ops/evaluation-work-items/:workItemId/submit/'

function workItem(overrides: Partial<EvaluationWorkItemView> = {}): EvaluationWorkItemView {
  return {
    id: 'work-item-1',
    securityEventId: 'event-1',
    eventRunId: 'run-1',
    assignmentId: 'assignment-1',
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
    status: 'PENDING',
    revision: 1,
    submittedEvaluationId: null,
    submittedAt: null,
    ...overrides,
  }
}

function response(overrides: Partial<EvaluationWorkspaceResponse> = {}): EvaluationWorkspaceResponse {
  return {
    events: [
      {
        securityEventId: 'event-1',
        number: 'ОМ-2026-014',
        title: 'Международный форум',
        objectLabel: 'Конгресс-холл',
        actualStartsAt: '2026-07-18T07:40:00+05:00',
        actualEndsAt: '2026-07-18T19:20:00+05:00',
        stateLabel: 'Завершено',
      },
    ],
    selectedEvent: {
      securityEventId: 'event-1',
      number: 'ОМ-2026-014',
      title: 'Международный форум',
      objectLabel: 'Конгресс-холл',
      actualStartsAt: '2026-07-18T07:40:00+05:00',
      actualEndsAt: '2026-07-18T19:20:00+05:00',
      stateLabel: 'Завершено',
    },
    pending: [workItem()],
    submitted: [
      {
        workItemId: 'work-item-4',
        evaluationId: 'evaluation-21',
        targetSafeLabel: 'Жумабек С.',
        postLabel: 'Пост 3 — периметр',
        evaluationDirection: 'SENIOR_TO_EMPLOYEE',
        method: 'MANUAL',
        score: 7,
        basisLabel: 'Своевременное прибытие',
        basisNote: null,
        comment: 'Задержка на инструктаже',
        submittedAt: '2026-07-18T20:05:00+05:00',
        revision: 2,
      },
    ],
    queue: { total: 2, submitted: 1, remaining: 1 },
    eventProgress: null,
    bases: [
      { code: 'DISCIPLINE', label: 'Дисциплина', requiresNote: false },
      { code: 'OTHER', label: 'Другое', requiresNote: true },
    ],
    policy: { periodDays: 105, minEvaluations: 4, policyVersion: 'OPERATIONAL-RATING-2026.07.1' },
    loadedAt: '2026-07-20T08:00:00+05:00',
    capabilities: { operationalRatings: true },
    unavailableReason: null,
    unavailableViews: [
      {
        code: 'BULK_DEFAULT',
        label: 'Кнопка «Применить 8 всем»',
        reason: '§19.8 называет её поимённо среди запрещённых.',
      },
    ],
    ...overrides,
  }
}

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>
      <ToastProvider>
        <MemoryRouter>{children}</MemoryRouter>
      </ToastProvider>
    </QueryClientProvider>
  )
  return render(<EvaluationWorkspacePage />, { wrapper })
}

beforeEach(() => {
  setCredential({ kind: 'dev', userId: 'demo-event-planner' })
})

afterEach(() => {
  cleanup()
  clearCredential()
})

describe('очередь заданий (§19.14)', () => {
  it('строка задания печатает присланный контекст, включая факт участия', async () => {
    server.use(
      http.get(WORKSPACE_URL, () =>
        HttpResponse.json(
          response({ pending: [workItem({ participated: false, initialScore: 8 })] }),
        ),
      ),
    )
    renderPage()
    expect(await screen.findByText('Ерланов Д.')).toBeInTheDocument()
    expect(
      screen.getByText(/Факт участия: не участвовал · Начальная оценка: 8/),
    ).toBeInTheDocument()
    expect(screen.getByText(/Пост 1 — главный вход · Старший → сотрудник/)).toBeInTheDocument()
  })

  it('счётчики шапки названы своими именами: это МОИ задания, а не мероприятия', async () => {
    server.use(http.get(WORKSPACE_URL, () => HttpResponse.json(response())))
    renderPage()
    const header = await screen.findByLabelText('Мероприятие')
    expect(within(header).getByText('Моих заданий')).toBeInTheDocument()
    expect(within(header).getByText('Отправлено мной')).toBeInTheDocument()
    expect(within(header).getByText('OPERATIONAL-RATING-2026.07.1')).toBeInTheDocument()
  })

  it('кнопки массового проставления восьмёрки нет, и отказ назван вслух (§19.8)', async () => {
    server.use(http.get(WORKSPACE_URL, () => HttpResponse.json(response())))
    renderPage()
    await screen.findByText('Ерланов Д.')
    expect(screen.queryByRole('button', { name: /Применить 8 всем/ })).not.toBeInTheDocument()
    expect(screen.getByText(/Кнопка «Применить 8 всем»/)).toBeInTheDocument()
  })

  it('вкладка «Сводка мероприятия» отсутствует, пока сервер её не прислал (§19.14)', async () => {
    server.use(http.get(WORKSPACE_URL, () => HttpResponse.json(response())))
    renderPage()
    await screen.findByText('Ерланов Д.')
    expect(screen.queryByRole('tab', { name: 'Сводка мероприятия' })).not.toBeInTheDocument()

    cleanup()
    server.use(
      http.get(WORKSPACE_URL, () =>
        HttpResponse.json(
          response({
            eventProgress: {
              participants: 6,
              counters: { total: 6, submitted: 2, remaining: 4 },
              byDirection: [
                {
                  direction: 'SENIOR_TO_EMPLOYEE',
                  counters: { total: 5, submitted: 2, remaining: 3 },
                },
              ],
            },
          }),
        ),
      ),
    )
    renderPage()
    const tab = await screen.findByRole('tab', { name: 'Сводка мероприятия' })
    await userEvent.click(tab)
    const panel = await screen.findByLabelText('Сводка мероприятия')
    expect(within(panel).getByText(/Участников: 6 · Заданий: 6/)).toBeInTheDocument()
  })

  it('выключенная функция называет причину, а не показывает пустую очередь', async () => {
    server.use(
      http.get(WORKSPACE_URL, () =>
        HttpResponse.json(
          response({
            events: [],
            selectedEvent: null,
            pending: [],
            submitted: [],
            capabilities: { operationalRatings: false },
            unavailableReason: 'FEATURE_DISABLED',
          }),
        ),
      ),
    )
    renderPage()
    expect(
      await screen.findByText(/Оценивание выключено сервером \(ENABLE_OPERATIONAL_RATINGS\)/),
    ).toBeInTheDocument()
  })
})

describe('форма оценивания (§19.9-19.10)', () => {
  it('шкала идёт от 1 до 10 и нуля в ней нет', async () => {
    server.use(http.get(WORKSPACE_URL, () => HttpResponse.json(response())))
    renderPage()
    await userEvent.click(await screen.findByRole('button', { name: /Оценить: Ерланов Д./ }))
    const select = screen.getByLabelText('Оценка')
    const options = within(select).getAllByRole('option').map((option) => option.textContent)
    expect(options).toEqual(['1', '2', '3', '4', '5', '6', '7', '8', '9', '10'])
    // Начальное значение — присланное сервером, а не константа формы.
    expect((select as HTMLSelectElement).value).toBe('8')
  })

  it('оценка ниже 8 без комментария НЕ уходит на сервер (§19.9)', async () => {
    const submit = vi.fn()
    server.use(
      http.get(WORKSPACE_URL, () => HttpResponse.json(response())),
      http.post(SUBMIT_URL, () => {
        submit()
        return HttpResponse.json({}, { status: 201 })
      }),
    )
    renderPage()
    await userEvent.click(await screen.findByRole('button', { name: /Оценить: Ерланов Д./ }))
    await userEvent.selectOptions(screen.getByLabelText('Оценка'), '6')
    await userEvent.selectOptions(screen.getByLabelText('Основание'), 'DISCIPLINE')
    await userEvent.click(screen.getByRole('button', { name: 'Отправить оценку' }))
    expect(
      await screen.findByText('Оценка ниже 8 требует комментария с конкретной причиной.'),
    ).toBeInTheDocument()
    // Главное утверждение: запроса НЕ БЫЛО. Без него тест проверял бы только
    // наличие надписи, а форма могла бы уже уехать на сервер.
    expect(submit).not.toHaveBeenCalled()
  })

  it('«Другое» открывает поле пояснения — и только оно', async () => {
    server.use(http.get(WORKSPACE_URL, () => HttpResponse.json(response())))
    renderPage()
    await userEvent.click(await screen.findByRole('button', { name: /Оценить: Ерланов Д./ }))
    expect(screen.queryByLabelText('Пояснение к основанию')).not.toBeInTheDocument()
    await userEvent.selectOptions(screen.getByLabelText('Основание'), 'DISCIPLINE')
    expect(screen.queryByLabelText('Пояснение к основанию')).not.toBeInTheDocument()
    await userEvent.selectOptions(screen.getByLabelText('Основание'), 'OTHER')
    expect(screen.getByLabelText('Пояснение к основанию')).toBeInTheDocument()
  })

  it('отправка уходит с редакцией задания и БЕЗ оценщика и target в теле', async () => {
    let body: unknown = null
    server.use(
      http.get(WORKSPACE_URL, () => HttpResponse.json(response())),
      http.post(SUBMIT_URL, async ({ request }) => {
        body = await request.json()
        return HttpResponse.json(
          {
            workItem: workItem({ status: 'SUBMITTED', revision: 2 }),
            submitted: response().submitted[0],
            queue: { total: 2, submitted: 2, remaining: 0 },
          },
          { status: 201 },
        )
      }),
    )
    renderPage()
    await userEvent.click(await screen.findByRole('button', { name: /Оценить: Ерланов Д./ }))
    await userEvent.selectOptions(screen.getByLabelText('Основание'), 'DISCIPLINE')
    await userEvent.click(screen.getByRole('button', { name: 'Отправить оценку' }))
    await waitFor(() => expect(body).not.toBeNull())
    expect(body).toEqual({
      score: 8,
      basisCode: 'DISCIPLINE',
      basisNote: null,
      comment: null,
      revision: 1,
    })
    // Проверяется ВЕСЬ JSON тела: подменить оценщика или target нечем, потому
    // что этих полей в нём нет вовсе.
    const json = JSON.stringify(body)
    expect(json).not.toContain('employee-1')
    expect(json).not.toContain('demo-event-planner')
  })

  it('отказ сервера показывается рядом с полем — по коду, а не по тексту', async () => {
    server.use(
      http.get(WORKSPACE_URL, () => HttpResponse.json(response())),
      http.post(SUBMIT_URL, () =>
        HttpResponse.json(
          {
            error_code: 'BASIS_NOTE_REQUIRED',
            message: 'Основание «Другое» требует пояснения.',
            details: {},
            request_id: null,
            timestamp: '2026-07-20T08:00:00+05:00',
          },
          { status: 422 },
        ),
      ),
    )
    renderPage()
    await userEvent.click(await screen.findByRole('button', { name: /Оценить: Ерланов Д./ }))
    // Клиентскую проверку проходим (основание без пояснения не выбрано), а
    // сервер всё равно отказывает — так проверяется ИМЕННО серверный канал.
    await userEvent.selectOptions(screen.getByLabelText('Основание'), 'DISCIPLINE')
    await userEvent.click(screen.getByRole('button', { name: 'Отправить оценку' }))
    // Отказ адресован СКРЫТОМУ полю пояснения (основание выбрано другое), и он
    // всё равно доходит до человека общим сообщением формы: иначе нажатие
    // «Отправить» осталось бы без всякого следа.
    expect(await screen.findByText('Основание «Другое» требует пояснения.')).toBeInTheDocument()
  })
})

describe('чего на экране нет (§19.14, §19.21)', () => {
  it('оценок, полученных смотрящим, нет — их не присылает сервер', async () => {
    server.use(http.get(WORKSPACE_URL, () => HttpResponse.json(response())))
    renderPage()
    await screen.findByText('Ерланов Д.')
    expect(screen.queryByText(/Полученные мной/)).not.toBeInTheDocument()
    expect(screen.getAllByRole('tab').map((tab) => tab.textContent)).toEqual([
      'Мне нужно оценить',
      'Отправленные мной',
    ])
  })

  it('карточка отправленной оценки уходит ОТДЕЛЬНЫМ запросом (§19.18 шаг 3)', async () => {
    const detailRequests: string[] = []
    server.use(
      http.get(WORKSPACE_URL, () => HttpResponse.json(response())),
      http.get('*/api/ops/evaluation-work-items/:workItemId/detail/', ({ request }) => {
        detailRequests.push(request.url)
        return HttpResponse.json({}, { status: 500 })
      }),
    )
    renderPage()
    await userEvent.click(await screen.findByRole('tab', { name: 'Отправленные мной' }))
    // Пока карточку не открыли, лишнего запроса нет — и это важно: карточка
    // несёт закрытые поля, и возить их списком не нужно (§19.17 «не загружай
    // sensitive detail заранее в общий list endpoint»).
    expect(detailRequests).toHaveLength(0)
    await userEvent.click(
      screen.getByRole('button', { name: /Открыть отправленную оценку: Жумабек С./ }),
    )
    // Редакция задания читается ЗАНОВО, а не берётся из уже полученного списка.
    await waitFor(() => expect(detailRequests).toHaveLength(1))
    expect(detailRequests[0]).toContain('work-item-4/detail/')
  })

  it('своя отправленная оценка видна целиком — это собственный акт человека', async () => {
    server.use(http.get(WORKSPACE_URL, () => HttpResponse.json(response())))
    renderPage()
    await userEvent.click(await screen.findByRole('tab', { name: 'Отправленные мной' }))
    const panel = await screen.findByLabelText('Отправленные мной')
    expect(panel.textContent).toContain('Оценка: 7 · Основание: Своевременное прибытие')
    expect(within(panel).getByText(/Комментарий: Задержка на инструктаже/)).toBeInTheDocument()
  })
})
