// @vitest-environment jsdom
// Журнал оценивания (§19.27): события и отказы видны, значений оценок нет.
import '@testing-library/jest-dom/vitest'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen, within } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { server } from '../../../shared/api/testing/server'
import { clearCredential, setCredential } from '../../../shared/auth/credential'
import { RatingAuditPage } from './RatingAuditPage'
import type { RatingAuditResponse } from '../api/pending-contracts'

const AUDIT_URL = '*/api/ops/rating-audit/'

function response(overrides: Partial<RatingAuditResponse> = {}): RatingAuditResponse {
  return {
    results: [
      {
        id: 'rating-audit-1',
        occurredAt: '2026-07-20T08:00:00+05:00',
        actorUserId: 'demo-event-planner',
        eventCode: 'EVALUATION_SUBMITTED',
        outcome: 'SUCCESS',
        reasonCode: null,
        securityEventId: 'event-1',
        eventRunId: 'run-1',
        assignmentId: 'assignment-work-item-1',
        evaluationId: 'evaluation-30',
        correctionId: null,
        requestId: 'idem-1',
        revision: 2,
      },
      {
        id: 'rating-audit-2',
        occurredAt: '2026-07-19T08:00:00+05:00',
        actorUserId: 'demo-event-planner',
        eventCode: 'EVALUATION_LOW_SCORE_WITHOUT_COMMENT',
        outcome: 'REJECTED',
        reasonCode: 'COMMENT_REQUIRED',
        securityEventId: 'event-1',
        eventRunId: 'run-1',
        assignmentId: 'assignment-work-item-1',
        evaluationId: null,
        correctionId: null,
        requestId: 'idem-2',
        revision: 1,
      },
    ],
    total: 2,
    page: 1,
    pageCount: 1,
    unavailableViews: [
      {
        code: 'AUDIT_SENSITIVE_VALUES',
        label: 'Старое и новое значение оценки, комментарии, оценщик',
        reason: '§19.27 отдаёт их отдельной audit privacy permission.',
      },
    ],
    ...overrides,
  }
}

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  )
  return render(<RatingAuditPage />, { wrapper })
}

beforeEach(() => {
  setCredential({ kind: 'dev', userId: 'demo-analyst' })
})

afterEach(() => {
  cleanup()
  clearCredential()
})

describe('журнал §19.27', () => {
  it('успех и отказ печатаются РАЗНО, и у отказа виден код причины', async () => {
    server.use(http.get(AUDIT_URL, () => HttpResponse.json(response())))
    renderPage()
    const success = await screen.findByRole('row', { name: /Оценка отправлена/ })
    expect(within(success).getByText('Выполнено')).toBeInTheDocument()
    const rejected = screen.getByRole('row', { name: /Попытка снижения без комментария/ })
    expect(within(rejected).getByText('Отклонено')).toBeInTheDocument()
    expect(within(rejected).getByText('COMMENT_REQUIRED')).toBeInTheDocument()
  })

  it('ссылки §19.27 напечатаны: оценка, назначение, requestId и revision', async () => {
    server.use(http.get(AUDIT_URL, () => HttpResponse.json(response())))
    renderPage()
    const line = await screen.findByRole('row', { name: /Оценка отправлена/ })
    expect(line.textContent).toContain('evaluation-30')
    expect(line.textContent).toContain('assignment-work-item-1')
    expect(line.textContent).toContain('req:idem-1')
    expect(line.textContent).toContain('rev:2')
  })

  it('колонок со значениями оценок в журнале нет — проверяется СТРУКТУРНО', async () => {
    server.use(http.get(AUDIT_URL, () => HttpResponse.json(response())))
    renderPage()
    await screen.findByRole('row', { name: /Оценка отправлена/ })
    const headers = screen.getAllByRole('columnheader').map((cell) => cell.textContent)
    expect(headers).toEqual([
      'Время',
      'Событие',
      'Исход',
      'Кто действовал',
      'Мероприятие',
      'Ссылки',
    ])
    expect(headers).not.toContain('Оценка')
    expect(headers).not.toContain('Комментарий')
    // И отказ назван вслух: значений нет не потому, что колонку забыли.
    expect(screen.getByText(/audit privacy permission/)).toBeInTheDocument()
  })

  it('пустой журнал говорит об этом, а не показывает пустую таблицу молча', async () => {
    server.use(
      http.get(AUDIT_URL, () => HttpResponse.json(response({ results: [], total: 0 }))),
    )
    renderPage()
    expect(await screen.findByText('Событий пока нет.')).toBeInTheDocument()
  })
})
