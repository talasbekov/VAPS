// @vitest-environment jsdom
// §21.7 KPI реестра объектов. Главное свойство экрана: он НИЧЕГО не считает —
// ни агрегатов (§21.7 «не считай KPI по текущей странице таблицы»), ни срока
// актуальности (§21.7 запрещает фиксированный frontend-период). Ответы
// подсовываются ЗАВЕДОМО расходящимися с тем, что можно вывести из таблицы.
import '@testing-library/jest-dom/vitest'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import type { ReactNode } from 'react'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { server } from '../../../shared/api/testing/server'
import { clearCredential, setCredential } from '../../../shared/auth/credential'
import { ToastProvider } from '../../../shared/ui/toast'
import { ObjectsListPage } from './ObjectsListPage'
import type { SecurityObject } from '../model/types'

const OBJECTS_URL = '*/api/ops/objects/'

function objectFixture(id: string, name: string, code: string): SecurityObject {
  return {
    id,
    name,
    code,
    type: 'Тип',
    region: 'г. Астана',
    address: 'адрес',
    objectState: 'ACTIVE',
    passportState: 'GREEN',
    sectors: [],
    passportVersions: [],
    createdAt: '2026-01-01T00:00:00+05:00',
    updatedAt: '2026-01-01T00:00:00+05:00',
  }
}

const FRESH_OBJECT = objectFixture('obj-1', 'Дворец Независимости', 'OBJ-001')
const OVERDUE_OBJECT = objectFixture('obj-2', 'Комплекс Казмедиа', 'OBJ-002')

function mockRegistry(): void {
  server.use(
    http.get(OBJECTS_URL, () =>
      HttpResponse.json({
        results: [FRESH_OBJECT, OVERDUE_OBJECT],
        freshness: [
          {
            objectId: 'obj-1',
            state: 'FRESH',
            verificationDueAt: '2026-11-01',
            freshnessPolicyVersion: 'policy-v1',
          },
          {
            objectId: 'obj-2',
            state: 'OVERDUE',
            verificationDueAt: '2025-05-01',
            freshnessPolicyVersion: 'policy-v1',
          },
        ],
        // ЗАВЕДОМО расходится с таблицей: строк две, а сервер говорит 42/7.
        // Экран обязан напечатать серверные числа (§21.7).
        kpi: {
          total: 42,
          passportGreen: 7,
          passportYellow: 3,
          passportRed: 1,
          verificationOverdue: 5,
          neverPublished: 2,
        },
        freshnessPolicy: { version: 'policy-v1', verificationIntervalDays: 120 },
        unavailableKpi: [
          {
            code: 'OPEN_REMARKS',
            label: 'Есть открытые замечания',
            reason: 'Замечания по объекту не моделируются.',
          },
        ],
      }),
    ),
  )
}

function renderPage(): void {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={client}>
        <ToastProvider>
          <MemoryRouter>{children}</MemoryRouter>
        </ToastProvider>
      </QueryClientProvider>
    )
  }
  render(<ObjectsListPage />, { wrapper: Wrapper })
}

beforeEach(() => {
  setCredential({ kind: 'dev', userId: 'viewer-1' })
})

afterEach(() => {
  cleanup()
  clearCredential()
})

describe('ObjectsListPage — §21.7 KPI реестра', () => {
  it('печатает СЕРВЕРНЫЕ агрегаты, а не считает их по строкам таблицы', async () => {
    mockRegistry()
    renderPage()

    const total = await screen.findByRole('group', { name: 'Всего объектов' })
    expect(within(total).getByText('42')).toBeInTheDocument()
    expect(
      within(screen.getByRole('button', { name: /Красный статус паспорта/ })).getByText('1'),
    ).toBeInTheDocument()
    expect(
      within(screen.getByRole('button', { name: /Проверка просрочена/ })).getByText('5'),
    ).toBeInTheDocument()
  })

  it('срок актуальности и версия политики приходят из ответа, а не выводятся из «90 дней»', async () => {
    mockRegistry()
    renderPage()

    expect(await screen.findByText(/по политике policy-v1: 120 дней/)).toBeInTheDocument()
    expect(screen.getByText('до 2026-11-01')).toBeInTheDocument()
    expect(screen.getByText('Срок соблюдён')).toBeInTheDocument()
    // Сужаем до строки таблицы: «Проверка просрочена» — ещё и подпись KPI.
    const overdueRow = screen.getByText('Комплекс Казмедиа').closest('tr')
    expect(overdueRow).not.toBeNull()
    expect(within(overdueRow as HTMLElement).getByText('Проверка просрочена')).toBeInTheDocument()
    expect(within(overdueRow as HTMLElement).getByText('до 2025-05-01')).toBeInTheDocument()
  })

  it('§21.7: клик по KPI фильтрует таблицу, повторный клик снимает фильтр', async () => {
    mockRegistry()
    renderPage()

    expect(await screen.findByText('Комплекс Казмедиа')).toBeInTheDocument()
    const overdueKpi = screen.getByRole('button', { name: /Проверка просрочена/ })
    await userEvent.click(overdueKpi)

    expect(overdueKpi).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByText('Комплекс Казмедиа')).toBeInTheDocument()
    expect(screen.queryByText('Дворец Независимости')).not.toBeInTheDocument()
    // KPI при фильтре НЕ пересчитываются: они про весь реестр.
    expect(
      within(screen.getByRole('group', { name: 'Всего объектов' })).getByText('42'),
    ).toBeInTheDocument()

    await userEvent.click(overdueKpi)
    expect(overdueKpi).toHaveAttribute('aria-pressed', 'false')
    expect(screen.getByText('Дворец Независимости')).toBeInTheDocument()
  })

  it('§35: невыводимые KPI названы с причиной', async () => {
    mockRegistry()
    renderPage()

    expect(await screen.findByText('Показатели, которых нет в модели')).toBeInTheDocument()
    expect(screen.getByText('Есть открытые замечания')).toBeInTheDocument()
    expect(screen.getByText(/Замечания по объекту не моделируются\./)).toBeInTheDocument()
  })
})
