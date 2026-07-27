// @vitest-environment jsdom
// §21.32 «Карточка дежурства».
//
// Проверяется то, чем карточка отличается от сервера: она ничего не выводит
// сама. Ответы подсовываются ЗАВЕДОМО расходящимися с тем, что страница могла
// бы посчитать (severity SOFT при пересечении — сервер так сказал; продолжи-
// тельность 720 мин вместо «суточных» 1440) — тот же приём, что в
// MonthlyDutyPlanSection.test.tsx.
import '@testing-library/jest-dom/vitest'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import type { ReactNode } from 'react'
import { MemoryRouter, Route, Routes } from 'react-router'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { server } from '../../../shared/api/testing/server'
import { clearCredential, setCredential } from '../../../shared/auth/credential'
import { ToastProvider } from '../../../shared/ui/toast'
import { ROUTES } from '../../../shared/routes'
import { DutyShiftDetailPage } from './DutyShiftDetailPage'
import type { DutyShiftDetail } from '../api/pending-contracts'

const ME_URL = '*/api/operations/my-permissions/'
const DETAIL_URL = '*/api/ops/duty-shifts/duty-1/'

const BASE_DETAIL: DutyShiftDetail = {
  shift: {
    id: 'duty-1',
    businessDate: '2026-07-24',
    dutyTypeCode: 'OWN_OBJECT_DAILY',
    target: {
      targetType: 'OWN_OBJECT',
      objectId: 'object-1',
      safeLabel: 'Дворец Независимости',
    },
    employeeName: 'Ахметов Б.',
    stateCode: 'PLANNED',
    acknowledgedAt: null,
    actualStart: null,
    actualEnd: null,
    updatedAt: '2026-07-24T08:00:00+05:00',
    passportBinding: {
      objectId: 'object-1',
      objectName: 'Дворец Независимости',
      versionId: 'v1',
      versionNumber: 1,
      effectiveFrom: '2026-01-01',
      sectorId: 'sector-a',
      sectorName: 'Сектор A',
      postId: 'post-1',
      postName: 'КПП-1',
      boundAt: '2026-07-24T08:00:00+05:00',
    },
    note: null,
    overrideReason: null,
  },
  passportStatus: {
    shiftId: 'duty-1',
    objectKnown: true,
    applicableVersionId: 'v1',
    applicableVersionNumber: 1,
    stale: false,
  },
  dutyType: {
    dutyTypeCode: 'OWN_OBJECT_DAILY',
    safeLabel: 'Суточное дежурство на собственном объекте',
    targetType: 'OWN_OBJECT',
    // 720 ≠ «сутки»: если карточка нарисует 24 ч, значит взяла константу,
    // а не реестр (§21.35 «не хардкодь 24 часа»).
    defaultDurationMinutes: 720,
    requiresSenior: true,
    restAfterMinutes: 720,
    restPolicy: 'HARD_BLOCK',
    requiresCurrentPassport: false,
  },
  conflicts: [],
  unavailableBlocks: [
    {
      code: 'JOURNAL',
      label: 'Журнал',
      reason: 'У суточного дежурства своего журнала нет.',
    },
  ],
}

function mockDetail(detail: DutyShiftDetail, permissions: string[] = ['ops.duty.view']): void {
  server.use(
    http.get(ME_URL, () => HttpResponse.json({ permissions })),
    http.get(DETAIL_URL, () => HttpResponse.json(detail)),
  )
}

function renderCard(): void {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={client}>
        <ToastProvider>
          <MemoryRouter initialEntries={[ROUTES.dutyShiftDetailTo('duty-1')]}>
            {children}
          </MemoryRouter>
        </ToastProvider>
      </QueryClientProvider>
    )
  }
  render(
    <Routes>
      <Route path={ROUTES.dutyShiftDetail} element={<DutyShiftDetailPage />} />
    </Routes>,
    { wrapper: Wrapper },
  )
}

beforeEach(() => {
  setCredential({ kind: 'dev', userId: 'viewer-1' })
})

afterEach(() => {
  cleanup()
  clearCredential()
})

describe('DutyShiftDetailPage — §21.32 карточка дежурства', () => {
  it('шапка несёт код, вид, дату и состояние; продолжительность — ИЗ вида дежурства', async () => {
    mockDetail(BASE_DETAIL)
    renderCard()

    expect(await screen.findByRole('heading', { name: 'Дворец Независимости' })).toBeInTheDocument()
    expect(screen.getByText('duty-1')).toBeInTheDocument()
    expect(
      screen.getByText('Суточное дежурство на собственном объекте · 12 ч'),
    ).toBeInTheDocument()
    expect(screen.getByText('2026-07-24')).toBeInTheDocument()
    expect(screen.getByText('Запланировано')).toBeInTheDocument()
    expect(screen.getByText('Сектор A · КПП-1')).toBeInTheDocument()
    expect(screen.getByText('ред. 1 от 2026-01-01')).toBeInTheDocument()
  })

  it('§35: блоки без данных названы С ПРИЧИНОЙ, а не опущены', async () => {
    mockDetail(BASE_DETAIL)
    renderCard()

    expect(await screen.findByText('Блоки, которых нет в модели дежурства')).toBeInTheDocument()
    expect(screen.getByText('Журнал')).toBeInTheDocument()
    expect(screen.getByText(/У суточного дежурства своего журнала нет\./)).toBeInTheDocument()
  })

  it('§21.34: severity конфликта берётся из ответа, а не выводится карточкой', async () => {
    mockDetail({
      ...BASE_DETAIL,
      conflicts: [
        {
          conflictId: 'overlap:Ахметов Б.:2026-07-24',
          // Пересечение, которое сервер назвал МЯГКИМ. Карточка обязана
          // напечатать «Мягкий»: собственного правила «пересечение = жёсткий»
          // у неё быть не должно.
          code: 'DUTY_OVERLAP',
          severity: 'SOFT',
          employeeName: 'Ахметов Б.',
          businessDate: '2026-07-24',
          message: 'Ахметов Б.: 2 дежурства в один день (2026-07-24).',
        },
      ],
    })
    renderCard()

    expect(await screen.findByText('Мягкий')).toBeInTheDocument()
    expect(screen.queryByText('Жёсткий')).not.toBeInTheDocument()
    expect(
      screen.getByText('Ахметов Б.: 2 дежурства в один день (2026-07-24).'),
    ).toBeInTheDocument()
  })

  it('устаревшая версия паспорта: предупреждение названо, снимок поста НЕ подменён', async () => {
    mockDetail({
      ...BASE_DETAIL,
      passportStatus: {
        ...BASE_DETAIL.passportStatus,
        applicableVersionId: 'v2',
        applicableVersionNumber: 2,
        stale: true,
      },
    })
    renderCard()

    expect(
      await screen.findByText(
        'Действующая редакция паспорта — версия 2, дежурство привязано к версии 1. Пост не переназначается автоматически.',
      ),
    ).toBeInTheDocument()
    expect(screen.getByText('Сектор A · КПП-1')).toBeInTheDocument()
    expect(screen.getByText('ред. 1 от 2026-01-01')).toBeInTheDocument()
  })

  it('вид дежурства вне реестра назван явно, а не подменён «сутками»', async () => {
    mockDetail({ ...BASE_DETAIL, dutyType: null })
    renderCard()

    expect(
      await screen.findByText('OWN_OBJECT_DAILY — вида нет в действующем реестре'),
    ).toBeInTheDocument()
    expect(screen.getByText('Неизвестен — вида дежурства нет в реестре')).toBeInTheDocument()
  })

  it('фактическое участие до заступления — словами, а не нулями', async () => {
    mockDetail(BASE_DETAIL)
    renderCard()

    expect(await screen.findByText('Ещё не заступал')).toBeInTheDocument()
    expect(screen.getByText('Ещё не сдавал')).toBeInTheDocument()
  })

  it('без ops.duty.manage действий нет, с ним — переход по состоянию смены', async () => {
    mockDetail(BASE_DETAIL)
    renderCard()
    expect(await screen.findByRole('heading', { name: 'Дворец Независимости' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Ознакомиться' })).not.toBeInTheDocument()

    cleanup()
    mockDetail(BASE_DETAIL, ['ops.duty.view', 'ops.duty.manage'])
    renderCard()
    expect(await screen.findByRole('button', { name: 'Ознакомиться' })).toBeInTheDocument()
    // Действие ровно одно и соответствует состоянию PLANNED.
    expect(screen.queryByRole('button', { name: 'Заступить' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Завершить' })).not.toBeInTheDocument()
  })

  it('завершённая смена действий не предлагает вовсе', async () => {
    mockDetail(
      {
        ...BASE_DETAIL,
        shift: {
          ...BASE_DETAIL.shift,
          stateCode: 'COMPLETED',
          acknowledgedAt: '2026-07-24T08:10:00+05:00',
          actualStart: '2026-07-24T09:00:00+05:00',
          actualEnd: '2026-07-25T09:00:00+05:00',
        },
      },
      ['ops.duty.view', 'ops.duty.manage'],
    )
    renderCard()

    expect(await screen.findByText('Завершено')).toBeInTheDocument()
    expect(screen.getByText('2026-07-24T09:00:00+05:00')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Завершить' })).not.toBeInTheDocument()
  })

  it('404 показывает ошибку и выход к плану, а не пустую карточку', async () => {
    server.use(
      http.get(ME_URL, () => HttpResponse.json({ permissions: ['ops.duty.view'] })),
      http.get(DETAIL_URL, () =>
        HttpResponse.json(
          {
            error_code: 'ENTITY_NOT_FOUND',
            message: 'Дежурство не найдено.',
            details: {},
            request_id: null,
            timestamp: '2026-07-24T09:00:00+05:00',
          },
          { status: 404 },
        ),
      ),
    )
    renderCard()

    expect(await screen.findByText('Не удалось загрузить дежурство.')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'К плану дежурств' })).toHaveAttribute(
      'href',
      ROUTES.duties,
    )
  })

  it('обход конфликта, сделанный при планировании, виден в карточке', async () => {
    mockDetail({
      ...BASE_DETAIL,
      shift: { ...BASE_DETAIL.shift, overrideReason: 'Некем заменить, приказ №5' },
    })
    renderCard()

    expect(
      await screen.findByText('Конфликт обойдён при планировании: Некем заменить, приказ №5'),
    ).toBeInTheDocument()
  })

  it('действие со страницы вызывает переход смены', async () => {
    let acknowledged = false
    server.use(
      http.get(ME_URL, () =>
        HttpResponse.json({ permissions: ['ops.duty.view', 'ops.duty.manage'] }),
      ),
      http.get(DETAIL_URL, () =>
        HttpResponse.json(
          acknowledged
            ? {
                ...BASE_DETAIL,
                shift: {
                  ...BASE_DETAIL.shift,
                  stateCode: 'ACKNOWLEDGED',
                  acknowledgedAt: '2026-07-24T09:00:00+05:00',
                },
              }
            : BASE_DETAIL,
        ),
      ),
      http.post('*/api/ops/duty-shifts/duty-1/acknowledge/', () => {
        acknowledged = true
        return HttpResponse.json(BASE_DETAIL.shift)
      }),
    )
    renderCard()

    await userEvent.click(await screen.findByRole('button', { name: 'Ознакомиться' }))
    // Карточка перечитывается после мутации — состояние на экране новое.
    expect(await screen.findByRole('button', { name: 'Заступить' })).toBeInTheDocument()
    expect(screen.getByText('Ознакомлен')).toBeInTheDocument()
  })
})
