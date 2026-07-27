// @vitest-environment jsdom
// Колонка «Пост по паспорту» плана дежурств (§9.6). Первый *.test.tsx у
// features/duties — покрывает ровно то, что добавила привязка: снимок
// сектора/поста/редакции, предупреждение об устаревшей версии и ЯВНУЮ
// причину, когда привязки нет (молчаливый прочерк — не вариант).
//
// ⚠️ Фикстура прав не нужна: гейт (`ops.duty.view`) стоит СНАРУЖИ, в роутере
// — тот же приём, что в `SecurityEventArchivePage.test.tsx`.
import '@testing-library/jest-dom/vitest'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import type { ReactNode } from 'react'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { server } from '../../../shared/api/testing/server'
import { clearCredential, setCredential } from '../../../shared/auth/credential'
import { ToastProvider } from '../../../shared/ui/toast'
import {
  NO_BINDABLE_POST_TEXT,
  NO_PUBLISHED_VERSION_TEXT,
  NO_REGISTRY_OBJECT_TEXT,
} from '../lib/passportBinding'
import type { DutyPassportStatus } from '../api/pending-contracts'
import type { DutyShift } from '../model/types'
import { DutyPlanPage } from './DutyPlanPage'

const DUTY_TYPES_URL = '*/api/ops/duty-types/'
const DUTY_SHIFTS_URL = '*/api/ops/duty-shifts/'
const COMBAT_URL = '*/api/ops/combat-duty-shifts/'

const BOUND_SHIFT: DutyShift = {
  id: 'duty-1',
  businessDate: '2026-07-24',
  dutyTypeCode: 'PROTECTED_OBJECT_DAILY',
  target: {
    targetType: 'PROTECTED_OBJECT',
    objectId: 'object-1',
    safeLabel: 'Дворец Независимости',
  },
  employeeName: 'Ерланов Д.',
  stateCode: 'ACKNOWLEDGED',
  acknowledgedAt: '2026-07-24T08:00:00+05:00',
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
}

const UNBOUND_SHIFT: DutyShift = {
  ...BOUND_SHIFT,
  id: 'duty-2',
  target: { targetType: 'OWN_OBJECT', objectId: 'object-2', safeLabel: 'Штаб управления' },
  employeeName: 'Ахметов Б.',
  passportBinding: null,
}

const FRESH_STATUS: DutyPassportStatus = {
  shiftId: 'duty-1',
  objectKnown: true,
  applicableVersionId: 'v1',
  applicableVersionNumber: 1,
  stale: false,
}

function mockPlan(results: DutyShift[], passportStatuses: DutyPassportStatus[]): void {
  server.use(
    http.get(DUTY_TYPES_URL, () =>
      HttpResponse.json({
        results: [
          {
            dutyTypeCode: 'PROTECTED_OBJECT_DAILY',
            safeLabel: 'Суточное дежурство на охраняемом объекте',
            targetType: 'PROTECTED_OBJECT',
            defaultDurationMinutes: 1440,
            requiresSenior: false,
          },
        ],
      }),
    ),
    http.get(DUTY_SHIFTS_URL, () => HttpResponse.json({ results, passportStatuses })),
    http.get(COMBAT_URL, () => HttpResponse.json({ results: [] })),
  )
}

function renderPlan(): void {
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
  render(<DutyPlanPage />, { wrapper: Wrapper })
}

beforeEach(() => {
  setCredential({ kind: 'dev', userId: 'operator-1' })
})

afterEach(() => {
  cleanup()
  clearCredential()
})

describe('План дежурств — привязка к версии паспорта (§9.6)', () => {
  it('привязанное дежурство показывает сектор, пост и редакцию паспорта', async () => {
    mockPlan([BOUND_SHIFT], [FRESH_STATUS])
    renderPlan()

    expect(await screen.findByText('Сектор A · КПП-1')).toBeInTheDocument()
    expect(screen.getByText('Паспорт: ред. 1 от 2026-01-01')).toBeInTheDocument()
    expect(screen.queryByText(/Действующая редакция паспорта/)).not.toBeInTheDocument()
  })

  it('устаревшая привязка: предупреждение названо, а снимок поста НЕ подменён', async () => {
    mockPlan(
      [BOUND_SHIFT],
      [{ ...FRESH_STATUS, applicableVersionId: 'v2', applicableVersionNumber: 2, stale: true }],
    )
    renderPlan()

    expect(
      await screen.findByText(
        'Действующая редакция паспорта — версия 2, дежурство привязано к версии 1. Пост не переназначается автоматически.',
      ),
    ).toBeInTheDocument()
    expect(screen.getByText('Сектор A · КПП-1')).toBeInTheDocument()
    expect(screen.getByText('Паспорт: ред. 1 от 2026-01-01')).toBeInTheDocument()
  })

  it('объекта нет в реестре — причина названа, а не пустая ячейка', async () => {
    mockPlan(
      [UNBOUND_SHIFT],
      [
        {
          shiftId: 'duty-2',
          objectKnown: false,
          applicableVersionId: null,
          applicableVersionNumber: null,
          stale: false,
        },
      ],
    )
    renderPlan()

    expect(await screen.findByText(NO_REGISTRY_OBJECT_TEXT)).toBeInTheDocument()
  })

  it('объект есть, опубликованной версии на дату нет — своя причина', async () => {
    mockPlan(
      [UNBOUND_SHIFT],
      [
        {
          shiftId: 'duty-2',
          objectKnown: true,
          applicableVersionId: null,
          applicableVersionNumber: null,
          stale: false,
        },
      ],
    )
    renderPlan()

    expect(await screen.findByText(NO_PUBLISHED_VERSION_TEXT)).toBeInTheDocument()
    expect(screen.queryByText(NO_REGISTRY_OBJECT_TEXT)).not.toBeInTheDocument()
  })

  it('версия действует, но привязать не к чему — постов в паспорте нет', async () => {
    mockPlan(
      [UNBOUND_SHIFT],
      [
        {
          shiftId: 'duty-2',
          objectKnown: true,
          applicableVersionId: 'v1',
          applicableVersionNumber: 1,
          stale: false,
        },
      ],
    )
    renderPlan()

    expect(await screen.findByText(NO_BINDABLE_POST_TEXT)).toBeInTheDocument()
  })

  it('статус не пришёл вовсе: снимок показан, вывода об актуальности нет', async () => {
    mockPlan([BOUND_SHIFT], [])
    renderPlan()

    expect(await screen.findByText('Сектор A · КПП-1')).toBeInTheDocument()
    expect(screen.queryByText(/Действующая редакция паспорта/)).not.toBeInTheDocument()
  })
})
