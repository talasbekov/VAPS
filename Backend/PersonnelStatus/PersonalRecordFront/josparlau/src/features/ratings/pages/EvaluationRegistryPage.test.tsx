// @vitest-environment jsdom
// Сводный экран «Итоговые оценки участников» (§19.15-19.16): состояние отбора в
// URL, колонки без закрытых величин, ссылка в карточку с сохранением отбора.
import '@testing-library/jest-dom/vitest'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import type { ReactNode } from 'react'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { server } from '../../../shared/api/testing/server'
import { clearCredential, setCredential } from '../../../shared/auth/credential'
import { EvaluationRegistryPage } from './EvaluationRegistryPage'
import type { EvaluationRegistryResponse } from '../api/pending-contracts'
import type { EvaluationRegistryRow } from '../lib/registry'

const REGISTRY_URL = '*/api/ops/evaluation-registry/'

function row(overrides: Partial<EvaluationRegistryRow> = {}): EvaluationRegistryRow {
  return {
    rowId: 'row-evaluation-1',
    employeeId: 'employee-1',
    employeeSafeLabel: 'Ерланов Д.',
    unitSafeLabel: 'Первое управление',
    eventNumber: 'ОМ-2026-014',
    eventTitle: 'Международный форум',
    objectLabel: 'Конгресс-холл',
    postLabel: 'Пост 1 — главный вход',
    participated: true,
    evaluationDirection: 'SENIOR_TO_EMPLOYEE',
    method: 'MANUAL',
    evaluatedAt: '2026-07-10',
    corrected: false,
    aggregateRating: 8.6,
    aggregateState: 'READY',
    ...overrides,
  }
}

function response(overrides: Partial<EvaluationRegistryResponse> = {}): EvaluationRegistryResponse {
  return {
    results: [row()],
    total: 1,
    page: 1,
    pageCount: 1,
    options: {
      events: [{ value: 'ОМ-2026-014', label: 'ОМ-2026-014 — Международный форум' }],
      units: [{ value: 'Первое управление', label: 'Первое управление' }],
      employees: [
        { value: 'employee-1', label: 'Ерланов Д.' },
        { value: 'employee-7', label: 'Оспанов Р.' },
      ],
    },
    policy: { periodDays: 105, minEvaluations: 4, policyVersion: 'OPERATIONAL-RATING-2026.07.1' },
    capabilities: { operationalRatings: true },
    columns: { sensitiveDetails: false },
    unavailableViews: [
      {
        code: 'SENSITIVE_COLUMNS',
        label: 'Score, комментарий, основание и оценщик отдельной записи',
        reason: '§19.16 закрывает их держателю права на агрегат.',
      },
    ],
    ...overrides,
  }
}

function renderPage(initialUrl = '/ratings/evaluations') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[initialUrl]}>{children}</MemoryRouter>
    </QueryClientProvider>
  )
  return render(<EvaluationRegistryPage />, { wrapper })
}

beforeEach(() => {
  setCredential({ kind: 'dev', userId: 'demo-analyst' })
})

afterEach(() => {
  cleanup()
  clearCredential()
})

describe('таблица §19.16', () => {
  it('вместо закрытых величин стоит подпись, а не пустая ячейка', async () => {
    server.use(http.get(REGISTRY_URL, () => HttpResponse.json(response())))
    renderPage()
    const line = await screen.findByRole('row', { name: /Ерланов/ })
    expect(within(line).getByText('Детали оценки закрыты')).toBeInTheDocument()
    expect(within(line).getByText('Старший → сотрудник')).toBeInTheDocument()
    expect(within(line).getByText('8,6')).toBeInTheDocument()
  })

  it('запрещённых §19.16 колонок нет — проверяется СТРУКТУРНО, а не поиском слов', async () => {
    server.use(http.get(REGISTRY_URL, () => HttpResponse.json(response())))
    renderPage()
    await screen.findByRole('row', { name: /Ерланов/ })
    const headers = screen.getAllByRole('columnheader').map((cell) => cell.textContent)
    expect(headers).toEqual([
      'Участник',
      'Подразделение',
      'Мероприятие',
      'Объект',
      'Пост или роль',
      'Участие',
      'Дата',
      'Контекст',
      'Детали оценки',
      'Агрегат',
      'Действие',
    ])
    // Ни «Оценка», ни «Комментарий», ни «Кто оценил» — их нет в перечне выше, и
    // это утверждение сильнее, чем отсутствие слова где-то на странице.
    expect(headers).not.toContain('Оценка')
    expect(headers).not.toContain('Кто оценил')
  })

  it('системная оценка называется своим контекстом, а не ролью человека', async () => {
    server.use(
      http.get(REGISTRY_URL, () =>
        HttpResponse.json(
          response({
            results: [row({ method: 'SYSTEM_DEFAULT', employeeSafeLabel: 'Нурланов Е.' })],
          }),
        ),
      ),
    )
    renderPage()
    const line = await screen.findByRole('row', { name: /Нурланов/ })
    expect(within(line).getByText('Системная оценка по умолчанию')).toBeInTheDocument()
  })
})

describe('состояние отбора в URL §19.15', () => {
  it('фильтр читается ИЗ URL и уезжает в запрос', async () => {
    const requests: string[] = []
    server.use(
      http.get(REGISTRY_URL, ({ request }) => {
        requests.push(request.url)
        return HttpResponse.json(response())
      }),
    )
    renderPage('/ratings/evaluations?employee=employee-7&corrected=true&page=2')
    await screen.findByRole('row', { name: /Ерланов/ })
    expect(requests[0]).toContain('employee=employee-7')
    expect(requests[0]).toContain('corrected=true')
    expect(requests[0]).toContain('page=2')
    // Значения полей формы взяты из URL — экран не держит второй копии.
    expect((screen.getByLabelText('Сотрудник') as HTMLSelectElement).value).toBe('employee-7')
    expect(screen.getByLabelText(/Только исправленные/)).toBeChecked()
  })

  it('правка фильтра сбрасывает страницу: третья страница чужого отбора не показывается', async () => {
    const requests: string[] = []
    server.use(
      http.get(REGISTRY_URL, ({ request }) => {
        requests.push(request.url)
        return HttpResponse.json(response({ page: 3, pageCount: 3, total: 25 }))
      }),
    )
    renderPage('/ratings/evaluations?page=3')
    await screen.findByRole('row', { name: /Ерланов/ })
    await userEvent.selectOptions(screen.getByLabelText('Подразделение'), 'Первое управление')
    await waitFor(() => expect(requests.length).toBeGreaterThan(1))
    const last = requests.at(-1) ?? ''
    expect(last).toContain('unit=')
    expect(last).not.toContain('page=')
  })

  it('ссылка в карточку несёт текущий отбор целиком (§19.15 «после возврата»)', async () => {
    server.use(http.get(REGISTRY_URL, () => HttpResponse.json(response())))
    renderPage('/ratings/evaluations?unit=%D0%9F%D0%B5%D1%80%D0%B2%D0%BE%D0%B5+%D1%83%D0%BF%D1%80%D0%B0%D0%B2%D0%BB%D0%B5%D0%BD%D0%B8%D0%B5&page=2')
    const link = await screen.findByRole('link', { name: 'Открыть агрегат' })
    const href = link.getAttribute('href') ?? ''
    expect(href).toContain('/ratings/employees/employee-1')
    // Отбор уезжает в параметр `back`: без него возврат привёл бы на первую
    // страницу пустого фильтра, а §19.15 требует восстановить и то, и другое.
    // Разбирается ПАРАМЕТРАМИ, а не подстрокой: значение само percent-кодировано,
    // и поиск по тексту прошёл бы и на полуразобранной ссылке.
    const back = new URLSearchParams(href.split('?')[1]).get('back') ?? ''
    const restored = new URLSearchParams(back)
    expect(restored.get('unit')).toBe('Первое управление')
    expect(restored.get('page')).toBe('2')
  })

  it('пустой результат — каноническая формулировка §19.31, и она объясняется отбором', async () => {
    server.use(
      http.get(REGISTRY_URL, () => HttpResponse.json(response({ results: [], total: 0 }))),
    )
    renderPage()
    // Канон §19.31 дословно (лечится только правкой канона, не пересказом).
    expect(
      await screen.findByText(/По выбранным условиям оценки не найдены\./),
    ).toBeInTheDocument()
    expect(
      screen.getByText(/Это результат отбора, а не отсутствие оценивания/),
    ).toBeInTheDocument()
  })
})
