// Handler-уровень (приём Этапа 49): проверяется, что MSW действительно
// СОПОСТАВЛЯЕТ маршрут раздела с URL, который строит клиент. Тест репозитория
// этого не видит (зовёт функции напрямую), тест страницы подменяет handler'ы
// своими — обе половины остаются зелёными при несовпадающем пути.
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { setupServer } from 'msw/node'
import { createApiClient } from '../../../shared/api/client'
import { ApiError } from '../../../shared/api/errors'
import { createMemoryPersistence } from '../../../shared/testing/mock-runtime/memory-persistence'
import { DemoClock } from '../../../shared/testing/mock-runtime/demo-clock'
import { registerRbacDirectory } from '../../../shared/testing/mock-runtime/rbac-directory'
import {
  OPERATIONAL_RATINGS_PATH,
  OPERATIONAL_RATING_DYNAMICS_PATH,
  RATING_ANALYTICS_PATH,
} from '../api/pending-contracts'
import type {
  ListOperationalRatingsResponse,
  RatingAnalyticsResponse,
  RatingDynamicsResponse,
} from '../api/pending-contracts'
import { createRatingsHandlers } from './handlers'
import { buildRatingsSeed } from './fixtures'

const CLOCK_ISO = '2026-07-20T08:00:00+05:00'
const VIEWER = 'rating-viewer'
const ANALYST = 'rating-analyst'
const NOBODY = 'nobody-user'
const BASE = 'http://localhost'

const adapter = createMemoryPersistence()
const clock = new DemoClock(CLOCK_ISO)
const server = setupServer(...createRatingsHandlers(adapter, clock))

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }))
afterAll(() => server.close())
afterEach(() => server.resetHandlers(...createRatingsHandlers(adapter, clock)))

beforeEach(async () => {
  const ratings = buildRatingsSeed()
  // Слайс «Настроек» — рукописной формой: импорт чужой фичи запрещён
  // ARCH-FE-013, а сверку этой формы с настоящим сидом ведёт контрактный тест
  // в `app/` (он единственный слой, которому позволено видеть обе фичи).
  const settings = {
    sliceName: 'settings',
    data: {
      sectionVersions: { RATING_POLICY: 'OPERATIONAL-RATING-test.1' },
      settings: [
        {
          settingCode: 'RATING.PERIOD.PARAMETER',
          sectionCode: 'RATING_POLICY',
          groupCode: 'AGGREGATION',
          field: 'PARAMETER',
          value: 105,
        },
        {
          settingCode: 'RATING.MIN_EVALUATIONS.PARAMETER',
          sectionCode: 'RATING_POLICY',
          groupCode: 'AGGREGATION',
          field: 'WARNING_FROM',
          value: 4,
        },
        {
          settingCode: 'RATING.SUPPRESSION_MIN_GROUP.PARAMETER',
          sectionCode: 'RATING_POLICY',
          groupCode: 'PRIVACY',
          field: 'PARAMETER',
          value: 3,
        },
      ],
      changeLog: [],
    },
  }
  await adapter.reset({
    application: 'smart-josparlau',
    schema_version: 32,
    seed_version: 'test-v32',
    scenario: 'normal',
    revision: 0,
    created_at: CLOCK_ISO,
    updated_at: CLOCK_ISO,
    slices: { [ratings.sliceName]: ratings.data, [settings.sliceName]: settings.data },
  })
  registerRbacDirectory([
    { userId: VIEWER, permissions: ['ops.rating.view_aggregate'] },
    { userId: ANALYST, permissions: ['ops.analytics.view'] },
    { userId: NOBODY, permissions: [] },
  ])
})

const client = createApiClient({ baseUrl: BASE, defaultHeaders: { 'X-User-Id': VIEWER } })
const stranger = createApiClient({ baseUrl: BASE, defaultHeaders: { 'X-User-Id': NOBODY } })
const analyst = createApiClient({ baseUrl: BASE, defaultHeaders: { 'X-User-Id': ANALYST } })

async function statusOf(call: () => Promise<unknown>): Promise<number> {
  try {
    await call()
    return 200
  } catch (error) {
    if (error instanceof ApiError) return error.status
    throw error
  }
}

describe('ratings handlers — сопоставление маршрута', () => {
  it('GET сводки доходит до repository и отдаёт агрегаты', async () => {
    const response = await client.get<ListOperationalRatingsResponse>(OPERATIONAL_RATINGS_PATH)
    expect(response.results.length).toBeGreaterThan(0)
    // Методика доезжает до клиента ЧЕРЕЗ HTTP: репозиторий её отдаёт, а
    // handler не теряет по дороге.
    expect(response.policy?.policyVersion).toBe('OPERATIONAL-RATING-test.1')
  })

  it('без права — 403 конвертом, а не пустым списком', async () => {
    expect(await statusOf(() => stranger.get(OPERATIONAL_RATINGS_PATH))).toBe(403)
  })
})

describe('ratings handlers — динамика (§19.20)', () => {
  it('GET динамики доходит до repository и отдаёт ряд точек', async () => {
    const response = await client.get<RatingDynamicsResponse>(
      `${OPERATIONAL_RATING_DYNAMICS_PATH}?employee=employee-2`,
    )
    // Выбор сотрудника едет ЧЕРЕЗ HTTP query, а не теряется в handler'е:
    // потерянный параметр вернул бы ряд первого сотрудника и остался бы
    // незамеченным — поэтому проверяется именно НЕ первый.
    expect(response.employeeId).toBe('employee-2')
    expect(response.points.length).toBeGreaterThan(0)
    expect(response.boundaries.length).toBeGreaterThan(0)
  })

  it('без права — 403 конвертом, а не пустым рядом', async () => {
    expect(await statusOf(() => stranger.get(OPERATIONAL_RATING_DYNAMICS_PATH))).toBe(403)
  })
})

describe('ratings handlers — аналитика рейтинга (§22.16)', () => {
  it('GET отчёта доходит до repository и отдаёт агрегаты групп', async () => {
    const response = await analyst.get<RatingAnalyticsResponse>(RATING_ANALYTICS_PATH)
    expect(response.figures?.groups.length).toBeGreaterThan(0)
    expect(response.suppressionMinGroupSize).toBe(3)
  })

  it('держателю одной лишь сводки отчёт закрыт — 403 конвертом', async () => {
    expect(await statusOf(() => client.get(RATING_ANALYTICS_PATH))).toBe(403)
  })
})
