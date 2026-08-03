// @vitest-environment jsdom
// Карточка агрегата участника (§19.17, aggregate-only ветка) и возврат к отбору.
import '@testing-library/jest-dom/vitest'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen, within } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import type { ReactNode } from 'react'
import { MemoryRouter, Route, Routes } from 'react-router'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { server } from '../../../shared/api/testing/server'
import { clearCredential, setCredential } from '../../../shared/auth/credential'
import { RatingEmployeeDetailPage } from './RatingEmployeeDetailPage'
import type { RatingEmployeeDetailResponse } from '../api/pending-contracts'

const DETAIL_URL = '*/api/ops/operational-rating-employee/'

function response(
  overrides: Partial<RatingEmployeeDetailResponse> = {},
): RatingEmployeeDetailResponse {
  return {
    employeeId: 'employee-1',
    safeLabel: 'Ерланов Д.',
    unitSafeLabel: 'Первое управление',
    summary: {
      employeeId: 'employee-1',
      safeLabel: 'Ерланов Д.',
      aggregateRating: 8.6,
      evaluationsCount: 5,
      periodStartsAt: '2026-04-07',
      periodEndsAt: '2026-07-20',
      calculationPolicyVersion: 'OPERATIONAL-RATING-2026.07.1',
      calculatedAt: '2026-07-20T08:00:00+05:00',
      dataState: 'READY',
    },
    points: [
      {
        employeeId: 'employee-1',
        period: '2026-05',
        periodStartsAt: '2026-05-01',
        periodEndsAt: '2026-05-31',
        aggregateRating: null,
        evaluationsCount: 2,
        policyVersion: 'OPERATIONAL-RATING-2026.05.1',
        dataState: 'INSUFFICIENT_DATA',
        recordedAt: '2026-05-31T23:59:00+05:00',
      },
    ],
    unavailableViews: [
      {
        code: 'SENSITIVE_COLUMNS',
        label: 'Отдельные оценки и оценщики',
        reason: '§19.17 для этой ветки их не перечисляет.',
      },
    ],
    ...overrides,
  }
}

function renderPage(url = '/ratings/employees/employee-1') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[url]}>{children}</MemoryRouter>
    </QueryClientProvider>
  )
  return render(
    <Routes>
      <Route path="/ratings/employees/:employeeId" element={<RatingEmployeeDetailPage />} />
    </Routes>,
    { wrapper },
  )
}

beforeEach(() => {
  setCredential({ kind: 'dev', userId: 'demo-analyst' })
})

afterEach(() => {
  cleanup()
  clearCredential()
})

describe('карточка агрегата §19.17', () => {
  it('печатает разрешённые величины и ни одной закрытой', async () => {
    server.use(http.get(DETAIL_URL, () => HttpResponse.json(response())))
    renderPage()
    const card = await screen.findByLabelText('Агрегат участника')
    expect(within(card).getByText('8,6')).toBeInTheDocument()
    expect(within(card).getByText('OPERATIONAL-RATING-2026.07.1')).toBeInTheDocument()
    expect(within(card).getByText('Учтено оценок')).toBeInTheDocument()
    // Ни оценок, ни оценщиков, ни комментариев — их не присылает сервер.
    expect(screen.queryByText(/Комментарий/)).not.toBeInTheDocument()
    expect(screen.queryByText(/Кто оценил/)).not.toBeInTheDocument()
  })

  it('период без агрегата печатается прочерком, а не нулём (§19.19)', async () => {
    server.use(http.get(DETAIL_URL, () => HttpResponse.json(response())))
    renderPage()
    const dynamics = await screen.findByLabelText('Агрегированная динамика')
    const line = within(dynamics).getByRole('row', { name: /2026-05/ })
    expect(within(line).getByText('—')).toBeInTheDocument()
    expect(within(line).queryByText('0,0')).not.toBeInTheDocument()
  })

  it('состояние «Недостаточно данных» показывается вместо числа', async () => {
    server.use(
      http.get(DETAIL_URL, () =>
        HttpResponse.json(
          response({
            summary: {
              ...response().summary,
              aggregateRating: null,
              dataState: 'INSUFFICIENT_DATA',
            },
          }),
        ),
      ),
    )
    renderPage()
    const card = await screen.findByLabelText('Агрегат участника')
    expect(within(card).getByText('Недостаточно данных')).toBeInTheDocument()
    // §19.31: канон дословно — предложение говорит, ЧТО отсутствует, строка
    // «Состояние» выше — ПОЧЕМУ (§19.30 различает причины точно).
    expect(
      within(card).getByText('Оценок пока недостаточно для отображения итогового рейтинга.'),
    ).toBeInTheDocument()
    expect(
      within(card).queryByText('Итоговый рейтинг пока не сформирован.'),
    ).not.toBeInTheDocument()
  })

  it('без методики агрегат — «Итоговый рейтинг пока не сформирован.» (§19.31), причина названа отдельно', async () => {
    server.use(
      http.get(DETAIL_URL, () =>
        HttpResponse.json(
          response({
            summary: {
              ...response().summary,
              aggregateRating: null,
              calculationPolicyVersion: null,
              dataState: 'POLICY_UNDEFINED',
            },
          }),
        ),
      ),
    )
    renderPage()
    const card = await screen.findByLabelText('Агрегат участника')
    expect(within(card).getByText('Итоговый рейтинг пока не сформирован.')).toBeInTheDocument()
    expect(within(card).getByText('Методика расчёта не определена')).toBeInTheDocument()
  })

  it('возврат ведёт на СОХРАНЁННЫЙ отбор, а не на пустой реестр (§19.15)', async () => {
    server.use(http.get(DETAIL_URL, () => HttpResponse.json(response())))
    renderPage('/ratings/employees/employee-1?back=unit%3D%25D0%259F%26page%3D2')
    const link = await screen.findByRole('link', { name: 'Вернуться к отбору' })
    const href = link.getAttribute('href') ?? ''
    const restored = new URLSearchParams(href.split('?')[1] ?? '')
    expect(href.startsWith('/ratings/evaluations')).toBe(true)
    expect(restored.get('page')).toBe('2')
  })

  it('без параметра возврата ссылка ведёт в реестр без отбора', async () => {
    server.use(http.get(DETAIL_URL, () => HttpResponse.json(response())))
    renderPage()
    const link = await screen.findByRole('link', { name: 'Вернуться к отбору' })
    expect(link.getAttribute('href')).toBe('/ratings/evaluations')
  })
})
