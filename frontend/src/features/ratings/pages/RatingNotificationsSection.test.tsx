// @vitest-environment jsdom
// Уведомления оценивания (§19.28): фиксированные формулировки, deep link,
// отсутствие закрытых данных.
import '@testing-library/jest-dom/vitest'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen, within } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import type { ReactNode } from 'react'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { server } from '../../../shared/api/testing/server'
import { clearCredential, setCredential } from '../../../shared/auth/credential'
import { RatingNotificationsSection } from './RatingNotificationsSection'
import type { RatingNotificationsResponse } from '../api/pending-contracts'

const URL_PATTERN = '*/api/ops/rating-notifications/'

function response(overrides: Partial<RatingNotificationsResponse> = {}): RatingNotificationsResponse {
  return {
    results: [
      {
        id: 'rating-notification-1',
        createdAt: '2026-07-18T19:30:00+05:00',
        recipientUserId: 'demo-event-planner',
        code: 'EVALUATION_AVAILABLE',
        deepLink: '/ratings/workspace?event=event-1',
        securityEventId: 'event-1',
      },
      {
        id: 'rating-notification-2',
        createdAt: '2026-07-18T20:05:00+05:00',
        recipientUserId: 'demo-event-planner',
        code: 'EVALUATION_CORRECTED',
        deepLink: '/ratings/workspace?event=event-1',
        securityEventId: 'event-1',
      },
    ],
    unavailableViews: [
      {
        code: 'AGGREGATE_UPDATED_NOTICE',
        label: 'Уведомление «Итоговая сводка оперативного рейтинга обновлена»',
        reason: 'Адресатов у него нет: перечня людей с правом на агрегат не существует.',
      },
    ],
    ...overrides,
  }
}

function renderSection() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>
      <MemoryRouter>{children}</MemoryRouter>
    </QueryClientProvider>
  )
  return render(<RatingNotificationsSection />, { wrapper })
}

beforeEach(() => {
  setCredential({ kind: 'dev', userId: 'demo-event-planner' })
})

afterEach(() => {
  cleanup()
  clearCredential()
})

describe('уведомления §19.28', () => {
  it('печатает РАЗРЕШЁННЫЕ формулировки дословно и ведёт по deep link', async () => {
    server.use(http.get(URL_PATTERN, () => HttpResponse.json(response())))
    renderSection()
    const section = await screen.findByLabelText('Уведомления оценивания')
    const available = within(section).getByRole('link', {
      name: 'Вам доступно итоговое оценивание мероприятия',
    })
    expect(available).toHaveAttribute('href', '/ratings/workspace?event=event-1')
    expect(
      within(section).getByRole('link', {
        name: 'Оценка была исправлена уполномоченным пользователем',
      }),
    ).toBeInTheDocument()
  })

  it('в уведомлении нет ни оценщика, ни значения, ни причины снижения', async () => {
    server.use(http.get(URL_PATTERN, () => HttpResponse.json(response())))
    renderSection()
    const section = await screen.findByLabelText('Уведомления оценивания')
    // §19.28 перечисляет запрещённое поимённо. Текст берётся из фиксированного
    // словаря по коду, поэтому подставить туда закрытые данные нечем — и это
    // проверяется отсутствием их следов, а не намерением.
    expect(section.textContent).not.toContain('demo-event-planner')
    expect(section.textContent).not.toMatch(/оценка\s*[:=]\s*\d/i)
    expect(section.textContent).not.toContain('Ерланов')
  })

  it('невозможное уведомление названо вслух, а не молча отсутствует', async () => {
    server.use(http.get(URL_PATTERN, () => HttpResponse.json(response())))
    renderSection()
    expect(
      await screen.findByText(/Итоговая сводка оперативного рейтинга обновлена/),
    ).toBeInTheDocument()
  })

  it('пустая лента говорит об этом', async () => {
    server.use(http.get(URL_PATTERN, () => HttpResponse.json(response({ results: [] }))))
    renderSection()
    expect(await screen.findByText('Уведомлений нет.')).toBeInTheDocument()
  })
})
