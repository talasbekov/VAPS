// @vitest-environment jsdom
// «Архив дела» — первый *.test.tsx среди страниц security-events (до этого
// экраны фичи покрывались только route-audit'ом и e2e). Ассертим то, что
// отличает архив от карточки: read-only и честные причины пустоты.
//
// ⚠️ Фикстура прав не нужна: гейт (`ops.security_event.view`) стоит СНАРУЖИ,
// в роутере — тот же приём, что в `PlacementPrintPage.test.tsx`.
import '@testing-library/jest-dom/vitest'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import type { ReactNode } from 'react'
import { MemoryRouter, Route, Routes } from 'react-router'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { server } from '../../../shared/api/testing/server'
import { clearCredential, setCredential } from '../../../shared/auth/credential'
import { ROUTES } from '../../../shared/routes'
import { NOT_CLOSED_TEXT, NO_PLACEMENT_VERSIONS_TEXT } from '../lib/archiveCase'
import { SecurityEventArchivePage } from './SecurityEventArchivePage'

const EVENT_ID = 'se-archive-1'
const EVENT_URL = '*/api/ops/security-events/:id/'

const CLOSED_EVENT = {
  id: EVENT_ID,
  code: 'ОМ-2026-041',
  title: 'Международный экономический форум',
  objectName: 'Дворец Независимости',
  businessDate: '2026-07-17',
  stage: 'CLOSED',
  readinessPercent: 100,
  forceNeed: 6,
  conflictsCount: 0,
  ownerName: 'Нуртаев Е.',
  briefDescription: 'Международный форум с участием делегаций.',
  initialTasks: 'Согласовать периметр с комендатурой.',
  reconChecklist: [
    { id: 'c-1', label: 'Периметр объекта', done: true, result: 'MATCHES', comment: '' },
  ],
  reconSectorPosts: [
    {
      id: 'post-1',
      sector: 'A',
      post: 'Главный вход',
      task: 'Досмотр',
      need: 2,
      requirements: 'Досмотровая подготовка',
      result: 'MATCHES',
      comment: '',
    },
  ],
  demandRows: [
    { id: 'd-1', sector: 'A', task: 'Досмотр', shift: 'День 08:00–20:00', need: 2, group: 'Группа досмотра', requirements: '', comment: '' },
  ],
  demandApproved: true,
  forceRequests: [
    { id: 'fr-1', group: 'Группа досмотра', requestedCount: 2, allocatedCount: 2, status: 'ALLOCATED', comment: '' },
  ],
  placementAssignments: [
    { id: 'a-1', postId: 'post-1', employeeId: 'e-1', employeeName: 'Иванов И.', acknowledgedAt: '2026-07-16T10:00:00+05:00' },
    { id: 'a-2', postId: 'пост-которого-нет', employeeId: 'e-2', employeeName: 'Сидоров С.', acknowledgedAt: null },
  ],
  approvalStatus: 'APPROVED',
  approvalComment: '',
  journalEntries: [
    { id: 'j-1', type: 'INCIDENT', title: 'Задержание на входе', description: 'Передан наряду', createdAt: '2026-07-17T13:00:00+05:00' },
    { id: 'j-2', type: 'REPLACEMENT', title: 'Замена на посту', description: 'Иванов И. → Петров П.', createdAt: '2026-07-17T15:00:00+05:00' },
  ],
  closureDirectionSummaries: [{ direction: 'A', summary: 'Без происшествий' }],
  closedAt: '2026-07-17T23:40:00+05:00',
  createdAt: '2026-07-10T08:00:00+05:00',
  updatedAt: '2026-07-17T23:40:00+05:00',
}

function renderArchive(): void {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={[ROUTES.securityEventArchiveTo(EVENT_ID)]}>
          <Routes>
            <Route path={ROUTES.securityEventArchive} element={children} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    )
  }
  render(<SecurityEventArchivePage />, { wrapper: Wrapper })
}

beforeEach(() => {
  setCredential({ kind: 'dev', userId: 'operator-1' })
})

afterEach(() => {
  cleanup()
  clearCredential()
})

describe('Архив дела ОМ', () => {
  it('закрытое ОМ: дело собрано из реальных стадийных данных', async () => {
    server.use(http.get(EVENT_URL, () => HttpResponse.json(CLOSED_EVENT)))
    renderArchive()

    expect(
      await screen.findByRole('heading', { name: /Архив дела · ОМ-2026-041/ }),
    ).toBeInTheDocument()
    expect(screen.getByText('read-only')).toBeInTheDocument()
    expect(screen.getByText(/Мероприятие закрыто/)).toHaveTextContent(
      '2026-07-17T23:40:00+05:00',
    )
    expect(screen.getByText('Международный форум с участием делегаций.')).toBeInTheDocument()
    expect(screen.getByText('Без происшествий')).toBeInTheDocument()
    // Замена и инцидент — в разных разделах, каждая запись ровно один раз.
    expect(screen.getByText('Задержание на входе')).toBeInTheDocument()
    expect(screen.getByText('Замена на посту')).toBeInTheDocument()
    expect(screen.getAllByText('Замена на посту')).toHaveLength(1)
    // Версий расстановки в demo-срезе нет — сказано текстом, а не списком из
    // одной выдуманной «версии 1».
    expect(screen.getByText(NO_PLACEMENT_VERSIONS_TEXT)).toBeInTheDocument()
  })

  it('назначение на исчезнувший пост показано, а не потеряно', async () => {
    server.use(http.get(EVENT_URL, () => HttpResponse.json(CLOSED_EVENT)))
    renderArchive()

    await screen.findByRole('heading', { name: /Архив дела/ })
    expect(screen.getByText(/Сидоров С\./)).toBeInTheDocument()
    expect(screen.getAllByText(/Пост удалён из расчёта/).length).toBeGreaterThan(0)
  })

  it('архив read-only: ни одного интерактивного контрола на странице', async () => {
    server.use(http.get(EVENT_URL, () => HttpResponse.json(CLOSED_EVENT)))
    renderArchive()

    await screen.findByRole('heading', { name: /Архив дела/ })
    expect(screen.queryAllByRole('button')).toEqual([])
    expect(screen.queryAllByRole('textbox')).toEqual([])
    expect(screen.queryAllByRole('combobox')).toEqual([])
    expect(screen.queryAllByRole('checkbox')).toEqual([])
    // Ссылки — можно: навигация не мутация.
    expect(screen.getAllByRole('link').length).toBeGreaterThan(0)
  })

  it('незакрытое ОМ: дело не открывается, причина названа', async () => {
    server.use(
      http.get(EVENT_URL, () =>
        HttpResponse.json({ ...CLOSED_EVENT, stage: 'CONDUCT', closedAt: null }),
      ),
    )
    renderArchive()

    expect(await screen.findByText(NOT_CLOSED_TEXT)).toBeInTheDocument()
    // Никакого содержимого дела до закрытия — ни итогов, ни журнала.
    expect(screen.queryByText('Без происшествий')).not.toBeInTheDocument()
    expect(screen.queryByText('Задержание на входе')).not.toBeInTheDocument()
  })

  it('мероприятие не найдено: отказ с возвратом в реестр', async () => {
    server.use(
      http.get(EVENT_URL, () => HttpResponse.json({ detail: 'not found' }, { status: 404 })),
    )
    renderArchive()

    await waitFor(() => {
      expect(
        screen.getByText('Мероприятие не найдено или недоступно.'),
      ).toBeInTheDocument()
    })
  })
})
