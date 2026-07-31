// Handler-уровень (приём Этапа 49): проверяется, что MSW действительно
// СОПОСТАВЛЯЕТ новый маршрут §19.24 с URL, который строит клиент, и что 409
// мягкого конфликта доезжает до клиента ConflictError'ом с деталями. Тест
// репозитория этого не видит (зовёт функции напрямую), тест страницы
// подменяет handler'ы своими.
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { setupServer } from 'msw/node'
import { createApiClient } from '../../../shared/api/client'
import { ApiError, ConflictError } from '../../../shared/api/errors'
import { createMemoryPersistence } from '../../../shared/testing/mock-runtime/memory-persistence'
import { DemoClock } from '../../../shared/testing/mock-runtime/demo-clock'
import { registerRbacDirectory } from '../../../shared/testing/mock-runtime/rbac-directory'
import {
  securityEventPlacementAssignPath,
  securityEventPlacementRatingsPath,
} from '../api/pending-contracts'
import type {
  AssignPlacementResponse,
  ListPlacementRatingsResponse,
} from '../api/pending-contracts'
import { createSecurityEventsHandlers } from './handlers'

const CLOCK_ISO = '2026-07-20T08:00:00+05:00'
const MANAGER = 'se-handlers-manager'
const MANAGER_WITH_AGGREGATE = 'se-handlers-manager-aggregate'
const NOBODY = 'se-handlers-nobody'
const RECON_MANAGER = 'se-handlers-recon'
const BASE = 'http://localhost'

const adapter = createMemoryPersistence()
const clock = new DemoClock(CLOCK_ISO)
const server = setupServer(...createSecurityEventsHandlers(adapter, clock))

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }))
afterAll(() => server.close())
afterEach(() => server.resetHandlers(...createSecurityEventsHandlers(adapter, clock)))

const EVENT_ID = 'evt-h19'

beforeEach(async () => {
  await adapter.reset({
    application: 'smart-josparlau',
    schema_version: 37,
    seed_version: 'test-v37',
    scenario: 'normal',
    revision: 0,
    created_at: CLOCK_ISO,
    updated_at: CLOCK_ISO,
    slices: {
      'security-events': {
        events: [
          {
            id: EVENT_ID,
            code: 'ОМ-2026-Х',
            title: 'Handler-тест',
            objectId: null,
            objectName: 'Объект',
            passportBinding: null,
            businessDate: '2026-07-25',
            stage: 'PLACEMENT',
            readinessPercent: 50,
            forceNeed: 1,
            conflictsCount: 0,
            ownerName: 'demo',
            briefDescription: '',
            initialTasks: '',
            reconChecklist: [],
            reconSectorPosts: [
              {
                id: 'post-rated',
                sector: 'B',
                post: 'Пресс-зона',
                task: 'Контроль',
                need: 1,
                requirements: '',
                result: 'MATCHES',
                comment: '',
                sourceSectorId: null,
                sourcePostId: null,
                minRating: 8,
              },
            ],
            demandRows: [],
            demandApproved: true,
            forceRequests: [],
            placementAssignments: [],
            approvalStatus: 'PENDING',
            approvalComment: '',
            journalEntries: [],
            closureDirectionSummaries: [],
            closedAt: null,
            createdAt: CLOCK_ISO,
            updatedAt: CLOCK_ISO,
          },
          {
            id: 'evt-h19-recon',
            code: 'ОМ-2026-Р',
            title: 'Handler-тест рекогносцировки',
            objectId: null,
            objectName: 'Объект',
            passportBinding: null,
            businessDate: '2026-07-26',
            stage: 'RECON',
            readinessPercent: 30,
            forceNeed: 1,
            conflictsCount: 0,
            ownerName: 'demo',
            briefDescription: '',
            initialTasks: '',
            reconChecklist: [],
            reconSectorPosts: [],
            demandRows: [],
            demandApproved: false,
            forceRequests: [],
            placementAssignments: [],
            approvalStatus: 'PENDING',
            approvalComment: '',
            journalEntries: [],
            closureDirectionSummaries: [],
            closedAt: null,
            createdAt: CLOCK_ISO,
            updatedAt: CLOCK_ISO,
          },
        ],
        transitions: [],
      },
      objects: { objects: [] },
      // Чужой слайс рукописной формой (ARCH-FE-013 запрещает импорт фикстур
      // рейтинга); последний закрытый период «Абишева» ниже требования поста.
      ratings: {
        dynamicsPoints: [
          {
            employeeId: 'employee-2',
            period: '2026-06',
            periodStartsAt: '2026-06-01',
            periodEndsAt: '2026-06-30',
            aggregateRating: 7.9,
            evaluationsCount: 6,
            policyVersion: 'OPERATIONAL-RATING-2',
            dataState: 'READY',
            recordedAt: '2026-06-30T23:59:00+05:00',
          },
        ],
        capabilities: { operationalRatings: true, ratingConflicts: true },
      },
    },
  })
  registerRbacDirectory([
    { userId: MANAGER, permissions: ['ops.security_event.view', 'ops.placement.manage'] },
    {
      userId: MANAGER_WITH_AGGREGATE,
      permissions: [
        'ops.security_event.view',
        'ops.placement.manage',
        'ops.rating.view_aggregate',
      ],
    },
    { userId: NOBODY, permissions: [] },
    { userId: RECON_MANAGER, permissions: ['ops.security_event.view', 'ops.recon.manage'] },
  ])
})

const manager = createApiClient({ baseUrl: BASE, defaultHeaders: { 'X-User-Id': MANAGER } })
const managerWithAggregate = createApiClient({
  baseUrl: BASE,
  defaultHeaders: { 'X-User-Id': MANAGER_WITH_AGGREGATE },
})
const stranger = createApiClient({ baseUrl: BASE, defaultHeaders: { 'X-User-Id': NOBODY } })

describe('security-events handlers — сводка рейтинга при расстановке (§19.24)', () => {
  it('GET placement/ratings/ сопоставляется и отдаёт строки по правам смотрящего', async () => {
    // Сначала назначение с обходом, чтобы в сводке была строка.
    await manager.post<AssignPlacementResponse>(securityEventPlacementAssignPath(EVENT_ID), {
      postId: 'post-rated',
      employeeId: 'employee-2',
      override: true,
      override_reason: 'Обоснование обхода на handler-уровне',
    })
    const closed = await manager.get<ListPlacementRatingsResponse>(
      securityEventPlacementRatingsPath(EVENT_ID),
    )
    expect(closed.aggregateVisible).toBe(false)
    expect(closed.results[0]?.compliance).toBe('BELOW')
    expect(closed.results[0]?.aggregateRating).toBeNull()

    const open = await managerWithAggregate.get<ListPlacementRatingsResponse>(
      securityEventPlacementRatingsPath(EVENT_ID),
    )
    expect(open.aggregateVisible).toBe(true)
    expect(open.results[0]?.aggregateRating).toBe(7.9)
  })

  it('GET placement/ratings/ без права расстановки — 403', async () => {
    let status = 0
    try {
      await stranger.get(securityEventPlacementRatingsPath(EVENT_ID))
    } catch (error) {
      if (error instanceof ApiError) status = error.status
    }
    expect(status).toBe(403)
  })

  it('назначение ниже требования — 409 ConflictError, overridable, с conflicts[] в details', async () => {
    let conflict: ConflictError | null = null
    try {
      await manager.post(securityEventPlacementAssignPath(EVENT_ID), {
        postId: 'post-rated',
        employeeId: 'employee-2',
      })
    } catch (error) {
      if (error instanceof ConflictError) conflict = error
    }
    expect(conflict).not.toBeNull()
    // SOFT_CONFLICT_DETECTED уже в OVERRIDABLE_CODES — клиентский протокол
    // ConflictDialog включается без своего кода.
    expect(conflict?.overridable).toBe(true)
    const conflicts = (conflict?.details as { conflicts: { conflict_code: string }[] }).conflicts
    expect(conflicts.map((c) => c.conflict_code)).toEqual([
      'POST_REQUIREMENT_MISMATCH_CONFLICT',
    ])
  })

  it('«Сохранить расчёт» рекогносцировки не теряет minRating поста (узкое место normalize)', async () => {
    // Тот же класс, что потеря source*: normalizeSectorPosts пересобирает
    // строку поимённо, и забытое поле молча снимало бы требование §19.24
    // первым же сохранением. PATCH идёт с телом, где minRating стоит.
    const recon = createApiClient({
      baseUrl: BASE,
      defaultHeaders: { 'X-User-Id': RECON_MANAGER },
    })
    const updated = await recon.patch<{ reconSectorPosts: { id: string; minRating: number | null }[] }>(
      `/api/ops/security-events/evt-h19-recon/recon/`,
      {
        checklist: [],
        sectorPosts: [
          {
            id: 'post-rated',
            sector: 'B',
            post: 'Пресс-зона',
            task: 'Контроль',
            need: 1,
            requirements: '',
            result: 'MATCHES',
            comment: '',
            sourceSectorId: null,
            sourcePostId: null,
            minRating: 8,
          },
        ],
      },
    )
    expect(updated.reconSectorPosts[0]?.minRating).toBe(8)
  })

  it('повтор той же мутации с override/override_reason в КОРНЕ тела проходит (протокол confirmOverride)', async () => {
    const updated = await manager.post<AssignPlacementResponse>(
      securityEventPlacementAssignPath(EVENT_ID),
      {
        postId: 'post-rated',
        employeeId: 'employee-2',
        override: true,
        override_reason: 'Опыт подтверждён',
      },
    )
    const assignment = updated.placementAssignments.find((a) => a.employeeId === 'employee-2')
    expect(assignment?.ratingOverrideReason).toBe('Опыт подтверждён')
  })
})
