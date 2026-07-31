import { beforeEach, describe, expect, it } from 'vitest'
import { createMemoryPersistence } from '../../../shared/testing/mock-runtime/memory-persistence'
import { DemoClock } from '../../../shared/testing/mock-runtime/demo-clock'
import { registerRbacDirectory } from '../../../shared/testing/mock-runtime/rbac-directory'
import type { DemoStateEnvelope } from '../../../shared/testing/mock-runtime/persistence'
import {
  createSecurityEventsRepository,
  RepositoryBusinessRuleError,
  RepositoryConflictError,
  RepositoryNotFoundError,
  RepositoryPermissionError,
  RepositoryValidationError,
} from './repository'
import type { SecurityEventsSlice } from './fixtures'
import type { SecurityObjectProjection } from '../lib/passportBinding'
import type { SecurityEvent, SecurityEventTransition } from '../model/types'
import type {
  ForceRequest,
  PlacementAssignment,
  ReconChecklistItem,
  ReconSectorPost,
  StaffingDemandRow,
} from '../model/types'

const VIEWER = 'viewer-user'
const CREATOR = 'creator-user'
const NOBODY = 'no-permissions-user'
const RECON_OFFICER = 'recon-officer-user'
const DEMAND_PLANNER = 'demand-planner-user'
const PLACEMENT_MANAGER = 'placement-manager-user'
const PLACEMENT_APPROVER = 'placement-approver-user'
const BROKER = 'broker-user'
const CONDUCT_MANAGER = 'conduct-manager-user'

/**
 * Слайс `objects` кладётся РЯДОМ, а не импортируется из `features/objects`
 * (ARCH-FE-013): repository читает его как чужой снимок по узкой проекции,
 * ровно так же он выглядит и в бою.
 */
const PASSPORT_OBJECT: SecurityObjectProjection = {
  id: 'object-1',
  name: 'Дворец Независимости',
  code: 'OBJ-001',
  passportVersions: [
    {
      id: 'object-1-v1',
      versionNumber: 1,
      effectiveFrom: '2026-07-01',
      sectors: [
        {
          id: 'sector-1',
          name: 'Сектор A',
          posts: [
            { id: 'post-1', name: 'КПП-1', task: 'Контроль въезда', requirements: 'Допуск' },
            { id: 'post-2', name: 'Пост 2', task: 'Периметр', requirements: '' },
          ],
        },
      ],
    },
  ],
}

/** Объект в реестре есть, опубликованного паспорта — нет (§9.6, явный случай). */
const OBJECT_WITHOUT_PASSPORT: SecurityObjectProjection = {
  id: 'object-2',
  name: 'Дом Министерств',
  code: 'OBJ-002',
  passportVersions: [],
}

function seedEnvelope(
  events: SecurityEventsSlice['events'],
  objects: SecurityObjectProjection[] = [],
): DemoStateEnvelope {
  return {
    application: 'smart-josparlau',
    schema_version: 1,
    seed_version: 'test-v1',
    scenario: 'normal',
    revision: 0,
    created_at: '2026-07-20T08:00:00+05:00',
    updated_at: '2026-07-20T08:00:00+05:00',
    slices: { 'security-events': { events }, objects: { objects } },
  }
}

const SAMPLE_EVENT = {
  id: 'evt-1',
  code: 'ОМ-2026-1',
  title: 'Форум',
  objectId: null,
  objectName: 'Дворец',
  passportBinding: null,
  businessDate: '2026-07-25',
  stage: 'BULLETIN' as const,
  readinessPercent: 10,
  forceNeed: 0,
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
  approvalStatus: 'PENDING' as const,
  approvalComment: '',
  journalEntries: [],
  closureDirectionSummaries: [],
  closedAt: null,
  createdAt: '2026-07-20T08:00:00+05:00',
  updatedAt: '2026-07-20T08:00:00+05:00',
}

/** ОМ, уже привязанный к v1 «Дворца Независимости» — база тестов импорта. */
const BOUND_BINDING = {
  objectId: 'object-1',
  objectName: 'Дворец Независимости',
  versionId: 'object-1-v1',
  versionNumber: 1,
  effectiveFrom: '2026-07-01',
  boundAt: '2026-07-20T08:00:00+05:00',
}
const BOUND_RECON_EVENT = {
  ...SAMPLE_EVENT,
  id: 'evt-bound-recon',
  stage: 'RECON' as const,
  objectId: 'object-1' as string | null,
  passportBinding: BOUND_BINDING as SecurityEvent['passportBinding'],
}
const BOUND_PLACEMENT_EVENT = { ...BOUND_RECON_EVENT, id: 'evt-bound-placement', stage: 'PLACEMENT' as const }

describe('createSecurityEventsRepository', () => {
  beforeEach(() => {
    registerRbacDirectory([
      { userId: VIEWER, permissions: ['ops.security_event.view'] },
      {
        userId: CREATOR,
        permissions: [
          'ops.security_event.view',
          'ops.security_event.create',
          'ops.bulletin.manage',
        ],
      },
      { userId: NOBODY, permissions: [] },
      { userId: RECON_OFFICER, permissions: ['ops.security_event.view', 'ops.recon.manage'] },
      { userId: DEMAND_PLANNER, permissions: ['ops.security_event.view', 'ops.demand.manage'] },
      { userId: BROKER, permissions: ['ops.security_event.view', 'ops.force_allocation.manage'] },
      { userId: PLACEMENT_MANAGER, permissions: ['ops.security_event.view', 'ops.placement.manage'] },
      { userId: PLACEMENT_APPROVER, permissions: ['ops.security_event.view', 'ops.placement.approve'] },
      { userId: CONDUCT_MANAGER, permissions: ['ops.security_event.view', 'ops.conduct.manage'] },
    ])
  })

  it('list() без прав кидает RepositoryPermissionError', async () => {
    const adapter = createMemoryPersistence()
    await adapter.reset(seedEnvelope([]))
    const repo = createSecurityEventsRepository(adapter, new DemoClock('2026-07-20T08:00:00+05:00'))
    await expect(repo.list({ search: '', stage: 'ALL', page: 1, pageSize: 20 }, NOBODY)).rejects.toBeInstanceOf(
      RepositoryPermissionError,
    )
  })

  it('list() без credential (null) тоже отказывает — не молчаливый допуск', async () => {
    const adapter = createMemoryPersistence()
    await adapter.reset(seedEnvelope([]))
    const repo = createSecurityEventsRepository(adapter, new DemoClock('2026-07-20T08:00:00+05:00'))
    await expect(
      repo.list({ search: '', stage: 'ALL', page: 1, pageSize: 20 }, null),
    ).rejects.toBeInstanceOf(RepositoryPermissionError)
  })

  it('list() фильтрует по search и stage, сортирует устойчиво по businessDate/id', async () => {
    const adapter = createMemoryPersistence()
    await adapter.reset(
      seedEnvelope([
        { ...SAMPLE_EVENT, id: 'evt-2', title: 'Визит', businessDate: '2026-07-24', stage: 'DEMAND' },
        SAMPLE_EVENT,
      ]),
    )
    const repo = createSecurityEventsRepository(adapter, new DemoClock('2026-07-20T08:00:00+05:00'))

    const all = await repo.list({ search: '', stage: 'ALL', page: 1, pageSize: 20 }, VIEWER)
    expect(all.results.map((e) => e.id)).toEqual(['evt-2', 'evt-1']) // earlier businessDate first

    const filtered = await repo.list({ search: 'форум', stage: 'ALL', page: 1, pageSize: 20 }, VIEWER)
    expect(filtered.results.map((e) => e.id)).toEqual(['evt-1'])

    const byStage = await repo.list({ search: '', stage: 'DEMAND', page: 1, pageSize: 20 }, VIEWER)
    expect(byStage.results.map((e) => e.id)).toEqual(['evt-2'])
  })

  it('get() несуществующего id кидает RepositoryNotFoundError', async () => {
    const adapter = createMemoryPersistence()
    await adapter.reset(seedEnvelope([SAMPLE_EVENT]))
    const repo = createSecurityEventsRepository(adapter, new DemoClock('2026-07-20T08:00:00+05:00'))
    await expect(repo.get('missing', VIEWER)).rejects.toBeInstanceOf(RepositoryNotFoundError)
  })

  it('create() без ops.security_event.create кидает RepositoryPermissionError, даже с ops.security_event.view', async () => {
    const adapter = createMemoryPersistence()
    await adapter.reset(seedEnvelope([], [PASSPORT_OBJECT]))
    const repo = createSecurityEventsRepository(adapter, new DemoClock('2026-07-20T08:00:00+05:00'))
    await expect(
      repo.create({ title: 'X', objectId: 'object-1', businessDate: '2026-08-01' }, VIEWER),
    ).rejects.toBeInstanceOf(RepositoryPermissionError)
  })

  it('create() с пустыми полями кидает RepositoryValidationError с полевыми ошибками', async () => {
    const adapter = createMemoryPersistence()
    await adapter.reset(seedEnvelope([], [PASSPORT_OBJECT]))
    const repo = createSecurityEventsRepository(adapter, new DemoClock('2026-07-20T08:00:00+05:00'))
    try {
      await repo.create({ title: '', objectId: '', businessDate: 'not-a-date' }, CREATOR)
      expect.unreachable()
    } catch (error) {
      expect(error).toBeInstanceOf(RepositoryValidationError)
      const validationError = error as RepositoryValidationError
      expect(Object.keys(validationError.fieldErrors).sort()).toEqual([
        'businessDate',
        'objectId',
        'title',
      ])
    }
  })

  it('create() успешно сохраняет — виден следующему list() (персистентность из БД, не из памяти вызова)', async () => {
    const adapter = createMemoryPersistence()
    await adapter.reset(seedEnvelope([], [PASSPORT_OBJECT]))
    const clock = new DemoClock('2026-07-20T08:00:00+05:00')
    const repo = createSecurityEventsRepository(adapter, clock)

    const created = await repo.create(
      { title: 'Новое ОМ', objectId: 'object-1', businessDate: '2026-08-01' },
      CREATOR,
    )
    expect(created.stage).toBe('BULLETIN')

    const reread = await repo.get(created.id, VIEWER)
    expect(reread.title).toBe('Новое ОМ')

    const snapshot = await adapter.load()
    expect(snapshot?.revision).toBe(1)
  })

  it('updateBulletin() требует ops.bulletin.manage, а не ops.security_event.view', async () => {
    const adapter = createMemoryPersistence()
    await adapter.reset(seedEnvelope([SAMPLE_EVENT]))
    const repo = createSecurityEventsRepository(adapter, new DemoClock('2026-07-20T08:00:00+05:00'))
    await expect(
      repo.updateBulletin(
        SAMPLE_EVENT.id,
        { briefDescription: 'x', initialTasks: 'y' },
        VIEWER,
      ),
    ).rejects.toBeInstanceOf(RepositoryPermissionError)
  })

  it('updateBulletin() с пустыми полями кидает валидацию, не сохраняя частично', async () => {
    const adapter = createMemoryPersistence()
    await adapter.reset(seedEnvelope([SAMPLE_EVENT]))
    const repo = createSecurityEventsRepository(adapter, new DemoClock('2026-07-20T08:00:00+05:00'))
    await expect(
      repo.updateBulletin(SAMPLE_EVENT.id, { briefDescription: '', initialTasks: '' }, CREATOR),
    ).rejects.toBeInstanceOf(RepositoryValidationError)

    const snapshot = await adapter.load()
    expect(snapshot?.revision).toBe(0) // отклонённая мутация не увеличила revision
  })

  it('updateBulletin() персистентно сохраняет и возвращает обновлённую сущность', async () => {
    const adapter = createMemoryPersistence()
    await adapter.reset(seedEnvelope([SAMPLE_EVENT]))
    const repo = createSecurityEventsRepository(adapter, new DemoClock('2026-07-20T08:00:00+05:00'))

    const updated = await repo.updateBulletin(
      SAMPLE_EVENT.id,
      { briefDescription: 'Описание', initialTasks: 'Задачи' },
      CREATOR,
    )
    expect(updated.briefDescription).toBe('Описание')

    const reread = await repo.get(SAMPLE_EVENT.id, VIEWER)
    expect(reread.briefDescription).toBe('Описание')
    expect(reread.initialTasks).toBe('Задачи')
  })

  const RECON_CHECKLIST: ReconChecklistItem[] = [
    { id: 'c1', label: 'Периметр', done: false, result: null, comment: '' },
    { id: 'c2', label: 'Освещение', done: false, result: null, comment: '' },
  ]
  const RECON_EVENT = { ...SAMPLE_EVENT, id: 'evt-recon', stage: 'RECON' as const }


  it('updateRecon() требует ops.recon.manage, а не ops.bulletin.manage', async () => {
    const adapter = createMemoryPersistence()
    await adapter.reset(seedEnvelope([RECON_EVENT]))
    const repo = createSecurityEventsRepository(adapter, new DemoClock('2026-07-20T08:00:00+05:00'))
    await expect(
      repo.updateRecon(RECON_EVENT.id, { checklist: RECON_CHECKLIST, sectorPosts: [] }, CREATOR),
    ).rejects.toBeInstanceOf(RepositoryPermissionError)
  })

  it('updateRecon() требует комментарий, когда результат «Требует изменений»', async () => {
    const adapter = createMemoryPersistence()
    await adapter.reset(seedEnvelope([RECON_EVENT]))
    const repo = createSecurityEventsRepository(adapter, new DemoClock('2026-07-20T08:00:00+05:00'))
    const checklist: ReconChecklistItem[] = [
      { ...RECON_CHECKLIST[0], done: true, result: 'NEEDS_CHANGES', comment: '' },
    ]
    await expect(
      repo.updateRecon(RECON_EVENT.id, { checklist, sectorPosts: [] }, RECON_OFFICER),
    ).rejects.toBeInstanceOf(RepositoryValidationError)
  })

  it('updateRecon() сохраняет чек-лист и посты персистентно', async () => {
    const adapter = createMemoryPersistence()
    await adapter.reset(seedEnvelope([RECON_EVENT]))
    const repo = createSecurityEventsRepository(adapter, new DemoClock('2026-07-20T08:00:00+05:00'))
    const sectorPosts: ReconSectorPost[] = [
      { id: 'p1', sector: 'A', post: 'Вход', task: 'Досмотр', need: 2, requirements: '', result: 'MATCHES', comment: '', sourceSectorId: null, sourcePostId: null, minRating: null },
    ]
    const updated = await repo.updateRecon(
      RECON_EVENT.id,
      { checklist: RECON_CHECKLIST.map((c) => ({ ...c, done: true, result: 'MATCHES' })), sectorPosts },
      RECON_OFFICER,
    )
    expect(updated.reconChecklist.every((c) => c.done)).toBe(true)
    expect(updated.reconSectorPosts).toHaveLength(1)

    const reread = await repo.get(RECON_EVENT.id, VIEWER)
    expect(reread.reconSectorPosts[0].post).toBe('Вход')
  })

  it('completeRecon() требует все пункты чек-листа выполненными', async () => {
    const adapter = createMemoryPersistence()
    await adapter.reset(
      seedEnvelope([{ ...RECON_EVENT, reconChecklist: RECON_CHECKLIST, reconSectorPosts: [{ id: 'p1', sector: 'A', post: 'X', task: 'Y', need: 1, requirements: '', result: 'MATCHES', comment: '', sourceSectorId: null, sourcePostId: null, minRating: null }] }]),
    )
    const repo = createSecurityEventsRepository(adapter, new DemoClock('2026-07-20T08:00:00+05:00'))
    await expect(repo.completeRecon(RECON_EVENT.id, RECON_OFFICER)).rejects.toBeInstanceOf(
      RepositoryBusinessRuleError,
    )
  })

  it('completeRecon() требует хотя бы один пост', async () => {
    const adapter = createMemoryPersistence()
    const doneChecklist = RECON_CHECKLIST.map((c) => ({ ...c, done: true, result: 'MATCHES' as const }))
    await adapter.reset(
      seedEnvelope([{ ...RECON_EVENT, reconChecklist: doneChecklist, reconSectorPosts: [] }]),
    )
    const repo = createSecurityEventsRepository(adapter, new DemoClock('2026-07-20T08:00:00+05:00'))
    await expect(repo.completeRecon(RECON_EVENT.id, RECON_OFFICER)).rejects.toBeInstanceOf(
      RepositoryBusinessRuleError,
    )
  })

  it('completeRecon() переводит стадию RECON → DEMAND, персистентно', async () => {
    const adapter = createMemoryPersistence()
    const doneChecklist = RECON_CHECKLIST.map((c) => ({ ...c, done: true, result: 'MATCHES' as const }))
    const sectorPosts: ReconSectorPost[] = [
      { id: 'p1', sector: 'A', post: 'Вход', task: 'Досмотр', need: 2, requirements: '', result: 'MATCHES', comment: '', sourceSectorId: null, sourcePostId: null, minRating: null },
    ]
    await adapter.reset(
      seedEnvelope([{ ...RECON_EVENT, reconChecklist: doneChecklist, reconSectorPosts: sectorPosts }]),
    )
    const repo = createSecurityEventsRepository(adapter, new DemoClock('2026-07-20T08:00:00+05:00'))

    const completed = await repo.completeRecon(RECON_EVENT.id, RECON_OFFICER)
    expect(completed.stage).toBe('DEMAND')

    const reread = await repo.get(RECON_EVENT.id, VIEWER)
    expect(reread.stage).toBe('DEMAND')
  })

  it('completeRecon() на неверной стадии кидает RepositoryBusinessRuleError', async () => {
    const adapter = createMemoryPersistence()
    await adapter.reset(seedEnvelope([SAMPLE_EVENT])) // stage: BULLETIN
    const repo = createSecurityEventsRepository(adapter, new DemoClock('2026-07-20T08:00:00+05:00'))
    await expect(repo.completeRecon(SAMPLE_EVENT.id, RECON_OFFICER)).rejects.toBeInstanceOf(
      RepositoryBusinessRuleError,
    )
  })

  const DEMAND_ROWS: StaffingDemandRow[] = [
    { id: 'd1', sector: 'A', task: 'Досмотр', shift: 'День', need: 4, group: 'Группа досмотра', requirements: '', comment: '' },
    { id: 'd2', sector: 'B', task: 'Патруль', shift: 'Ночь', need: 2, group: 'Физическая охрана', requirements: '', comment: '' },
  ]
  const DEMAND_EVENT = { ...SAMPLE_EVENT, id: 'evt-demand', stage: 'DEMAND' as const }

  it('approveDemand() требует ops.demand.manage', async () => {
    const adapter = createMemoryPersistence()
    await adapter.reset(seedEnvelope([DEMAND_EVENT]))
    const repo = createSecurityEventsRepository(adapter, new DemoClock('2026-07-20T08:00:00+05:00'))
    await expect(
      repo.approveDemand(DEMAND_EVENT.id, { rows: DEMAND_ROWS }, VIEWER),
    ).rejects.toBeInstanceOf(RepositoryPermissionError)
  })

  it('approveDemand() валидирует обязательные поля строки', async () => {
    const adapter = createMemoryPersistence()
    await adapter.reset(seedEnvelope([DEMAND_EVENT]))
    const repo = createSecurityEventsRepository(adapter, new DemoClock('2026-07-20T08:00:00+05:00'))
    const badRow: StaffingDemandRow = { id: 'd1', sector: '', task: '', shift: '', need: 0, group: '', requirements: '', comment: '' }
    await expect(
      repo.approveDemand(DEMAND_EVENT.id, { rows: [badRow] }, DEMAND_PLANNER),
    ).rejects.toBeInstanceOf(RepositoryValidationError)
  })

  it('approveDemand() на неверной стадии (уже утверждена/не DEMAND) кидает RepositoryBusinessRuleError', async () => {
    const adapter = createMemoryPersistence()
    await adapter.reset(
      seedEnvelope([{ ...DEMAND_EVENT, stage: 'FORCES', demandRows: DEMAND_ROWS, demandApproved: true }]),
    )
    const repo = createSecurityEventsRepository(adapter, new DemoClock('2026-07-20T08:00:00+05:00'))
    await expect(
      repo.approveDemand(DEMAND_EVENT.id, { rows: DEMAND_ROWS }, DEMAND_PLANNER),
    ).rejects.toBeInstanceOf(RepositoryBusinessRuleError)
  })

  it('approveDemand() требует непустые строки, иначе RepositoryBusinessRuleError', async () => {
    const adapter = createMemoryPersistence()
    await adapter.reset(seedEnvelope([DEMAND_EVENT]))
    const repo = createSecurityEventsRepository(adapter, new DemoClock('2026-07-20T08:00:00+05:00'))
    await expect(
      repo.approveDemand(DEMAND_EVENT.id, { rows: [] }, DEMAND_PLANNER),
    ).rejects.toBeInstanceOf(RepositoryBusinessRuleError)
  })

  it('approveDemand() сохраняет строки, агрегирует в forceRequests по группам и переводит DEMAND→FORCES', async () => {
    const adapter = createMemoryPersistence()
    await adapter.reset(seedEnvelope([DEMAND_EVENT]))
    const repo = createSecurityEventsRepository(adapter, new DemoClock('2026-07-20T08:00:00+05:00'))

    const approved = await repo.approveDemand(DEMAND_EVENT.id, { rows: DEMAND_ROWS }, DEMAND_PLANNER)
    expect(approved.stage).toBe('FORCES')
    expect(approved.demandApproved).toBe(true)
    expect(approved.demandRows).toHaveLength(2)
    expect(approved.forceRequests).toHaveLength(2)
    const groupA = approved.forceRequests.find((r) => r.group === 'Группа досмотра')
    expect(groupA?.requestedCount).toBe(4)
    expect(groupA?.status).toBe('NOT_SENT')

    const reread = await repo.get(DEMAND_EVENT.id, VIEWER)
    expect(reread.stage).toBe('FORCES')
  })

  const FORCE_REQUESTS: ForceRequest[] = [
    { id: 'fr1', group: 'Группа досмотра', requestedCount: 4, allocatedCount: 0, status: 'NOT_SENT', comment: '' },
  ]
  const FORCES_EVENT = {
    ...SAMPLE_EVENT,
    id: 'evt-forces',
    stage: 'FORCES' as const,
    demandApproved: true,
    forceRequests: FORCE_REQUESTS,
  }

  it('updateForceAllocation() требует ops.force_allocation.manage', async () => {
    const adapter = createMemoryPersistence()
    await adapter.reset(seedEnvelope([FORCES_EVENT]))
    const repo = createSecurityEventsRepository(adapter, new DemoClock('2026-07-20T08:00:00+05:00'))
    await expect(
      repo.updateForceAllocation(FORCES_EVENT.id, 'fr1', { allocatedCount: 4, comment: '' }, VIEWER),
    ).rejects.toBeInstanceOf(RepositoryPermissionError)
  })

  it('updateForceAllocation() выводит статус из соотношения allocated/requested', async () => {
    const adapter = createMemoryPersistence()
    await adapter.reset(seedEnvelope([FORCES_EVENT]))
    const repo = createSecurityEventsRepository(adapter, new DemoClock('2026-07-20T08:00:00+05:00'))

    const partial = await repo.updateForceAllocation(
      FORCES_EVENT.id,
      'fr1',
      { allocatedCount: 2, comment: 'частично' },
      BROKER,
    )
    expect(partial.forceRequests[0].status).toBe('PARTIALLY_ALLOCATED')

    const full = await repo.updateForceAllocation(
      FORCES_EVENT.id,
      'fr1',
      { allocatedCount: 4, comment: '' },
      BROKER,
    )
    expect(full.forceRequests[0].status).toBe('ALLOCATED')
  })

  it('completeForces() требует полного выделения всех запросов', async () => {
    const adapter = createMemoryPersistence()
    await adapter.reset(seedEnvelope([FORCES_EVENT]))
    const repo = createSecurityEventsRepository(adapter, new DemoClock('2026-07-20T08:00:00+05:00'))
    await expect(repo.completeForces(FORCES_EVENT.id, BROKER)).rejects.toBeInstanceOf(
      RepositoryBusinessRuleError,
    )
  })

  it('completeForces() переводит стадию FORCES→PLACEMENT, персистентно', async () => {
    const adapter = createMemoryPersistence()
    await adapter.reset(
      seedEnvelope([
        {
          ...FORCES_EVENT,
          forceRequests: [{ ...FORCE_REQUESTS[0], allocatedCount: 4, status: 'ALLOCATED' }],
        },
      ]),
    )
    const repo = createSecurityEventsRepository(adapter, new DemoClock('2026-07-20T08:00:00+05:00'))
    const completed = await repo.completeForces(FORCES_EVENT.id, BROKER)
    expect(completed.stage).toBe('PLACEMENT')
    const reread = await repo.get(FORCES_EVENT.id, VIEWER)
    expect(reread.stage).toBe('PLACEMENT')
  })

  const POST_A: ReconSectorPost = {
    id: 'post-a',
    sector: 'A',
    post: 'Главный вход',
    task: 'Досмотр',
    need: 2,
    requirements: '',
    result: 'MATCHES',
    comment: '',
    sourceSectorId: null,
    sourcePostId: null,
    minRating: null,
  }
  const POST_B: ReconSectorPost = { ...POST_A, id: 'post-b', post: 'Второй пост' }
  const PLACEMENT_EVENT = {
    ...SAMPLE_EVENT,
    id: 'evt-placement',
    stage: 'PLACEMENT' as const,
    reconSectorPosts: [POST_A, POST_B],
  }

  it('assignPlacement() требует ops.placement.manage', async () => {
    const adapter = createMemoryPersistence()
    await adapter.reset(seedEnvelope([PLACEMENT_EVENT]))
    const repo = createSecurityEventsRepository(adapter, new DemoClock('2026-07-20T08:00:00+05:00'))
    await expect(
      repo.assignPlacement(PLACEMENT_EVENT.id, { postId: POST_A.id, employeeId: 'emp-1' }, VIEWER),
    ).rejects.toBeInstanceOf(RepositoryPermissionError)
  })

  it('assignPlacement() отклоняет двойное назначение на другой пост того же ОМ', async () => {
    const adapter = createMemoryPersistence()
    await adapter.reset(seedEnvelope([PLACEMENT_EVENT]))
    const repo = createSecurityEventsRepository(adapter, new DemoClock('2026-07-20T08:00:00+05:00'))

    await repo.assignPlacement(PLACEMENT_EVENT.id, { postId: POST_A.id, employeeId: 'emp-1' }, PLACEMENT_MANAGER)
    await expect(
      repo.assignPlacement(PLACEMENT_EVENT.id, { postId: POST_B.id, employeeId: 'emp-1' }, PLACEMENT_MANAGER),
    ).rejects.toBeInstanceOf(RepositoryBusinessRuleError)
  })

  it('assignPlacement() персистентно назначает; unassignPlacement() снимает назначение', async () => {
    const adapter = createMemoryPersistence()
    await adapter.reset(seedEnvelope([PLACEMENT_EVENT]))
    const repo = createSecurityEventsRepository(adapter, new DemoClock('2026-07-20T08:00:00+05:00'))

    const assigned = await repo.assignPlacement(
      PLACEMENT_EVENT.id,
      { postId: POST_A.id, employeeId: 'emp-1' },
      PLACEMENT_MANAGER,
    )
    expect(assigned.placementAssignments).toHaveLength(1)
    expect(assigned.placementAssignments[0].employeeName).toBe('Ахметов Б.')

    const reread = await repo.get(PLACEMENT_EVENT.id, VIEWER)
    expect(reread.placementAssignments).toHaveLength(1)

    const unassigned = await repo.unassignPlacement(
      PLACEMENT_EVENT.id,
      assigned.placementAssignments[0].id,
      PLACEMENT_MANAGER,
    )
    expect(unassigned.placementAssignments).toHaveLength(0)
  })

  it('completePlacement() требует все посты укомплектованными, переводит PLACEMENT→APPROVAL', async () => {
    const adapter = createMemoryPersistence()
    await adapter.reset(seedEnvelope([PLACEMENT_EVENT]))
    const repo = createSecurityEventsRepository(adapter, new DemoClock('2026-07-20T08:00:00+05:00'))

    await expect(repo.completePlacement(PLACEMENT_EVENT.id, PLACEMENT_MANAGER)).rejects.toBeInstanceOf(
      RepositoryBusinessRuleError,
    )

    await repo.assignPlacement(PLACEMENT_EVENT.id, { postId: POST_A.id, employeeId: 'emp-1' }, PLACEMENT_MANAGER)
    await repo.assignPlacement(PLACEMENT_EVENT.id, { postId: POST_B.id, employeeId: 'emp-2' }, PLACEMENT_MANAGER)

    const completed = await repo.completePlacement(PLACEMENT_EVENT.id, PLACEMENT_MANAGER)
    expect(completed.stage).toBe('APPROVAL')
  })

  const ASSIGNMENTS: PlacementAssignment[] = [
    { id: 'pa1', postId: POST_A.id, employeeId: 'emp-1', employeeName: 'Ахметов Б.', acknowledgedAt: null, ratingOverrideReason: null },
    { id: 'pa2', postId: POST_B.id, employeeId: 'emp-2', employeeName: 'Бекова А.', acknowledgedAt: null, ratingOverrideReason: null },
  ]
  const APPROVAL_EVENT = {
    ...PLACEMENT_EVENT,
    id: 'evt-approval',
    stage: 'APPROVAL' as const,
    placementAssignments: ASSIGNMENTS,
  }

  it('approvePlacement() требует ops.placement.approve', async () => {
    const adapter = createMemoryPersistence()
    await adapter.reset(seedEnvelope([APPROVAL_EVENT]))
    const repo = createSecurityEventsRepository(adapter, new DemoClock('2026-07-20T08:00:00+05:00'))
    await expect(repo.approvePlacement(APPROVAL_EVENT.id, PLACEMENT_MANAGER)).rejects.toBeInstanceOf(
      RepositoryPermissionError,
    )
  })

  it('approvePlacement() утверждает и сразу открывает «Ознакомление» (Epic 16.4→16.6)', async () => {
    const adapter = createMemoryPersistence()
    await adapter.reset(seedEnvelope([APPROVAL_EVENT]))
    const repo = createSecurityEventsRepository(adapter, new DemoClock('2026-07-20T08:00:00+05:00'))
    const approved = await repo.approvePlacement(APPROVAL_EVENT.id, PLACEMENT_APPROVER)
    expect(approved.approvalStatus).toBe('APPROVED')
    expect(approved.stage).toBe('ACKNOWLEDGEMENT')
  })

  it('returnPlacement() требует непустую причину', async () => {
    const adapter = createMemoryPersistence()
    await adapter.reset(seedEnvelope([APPROVAL_EVENT]))
    const repo = createSecurityEventsRepository(adapter, new DemoClock('2026-07-20T08:00:00+05:00'))
    await expect(
      repo.returnPlacement(APPROVAL_EVENT.id, { comment: '' }, PLACEMENT_APPROVER),
    ).rejects.toBeInstanceOf(RepositoryValidationError)
  })

  it('returnPlacement() откатывает стадию на PLACEMENT с сохранением причины', async () => {
    const adapter = createMemoryPersistence()
    await adapter.reset(seedEnvelope([APPROVAL_EVENT]))
    const repo = createSecurityEventsRepository(adapter, new DemoClock('2026-07-20T08:00:00+05:00'))
    const returned = await repo.returnPlacement(
      APPROVAL_EVENT.id,
      { comment: 'Не хватает поста B' },
      PLACEMENT_APPROVER,
    )
    expect(returned.stage).toBe('PLACEMENT')
    expect(returned.approvalStatus).toBe('RETURNED')
    expect(returned.approvalComment).toBe('Не хватает поста B')

    const reread = await repo.get(APPROVAL_EVENT.id, VIEWER)
    expect(reread.stage).toBe('PLACEMENT')
  })

  const CONDUCT_EVENT = {
    ...APPROVAL_EVENT,
    id: 'evt-conduct',
    stage: 'CONDUCT' as const,
  }

  describe('replaceAssignment (§9.11)', () => {
    it('требует ops.conduct.manage', async () => {
      const adapter = createMemoryPersistence()
      await adapter.reset(seedEnvelope([CONDUCT_EVENT]))
      const repo = createSecurityEventsRepository(adapter, new DemoClock('2026-07-20T08:00:00+05:00'))
      await expect(
        repo.replaceAssignment(
          CONDUCT_EVENT.id,
          { assignmentId: 'pa1', incomingEmployeeId: 'employee-1', reasonCode: 'Заболел' },
          PLACEMENT_MANAGER,
        ),
      ).rejects.toBeInstanceOf(RepositoryPermissionError)
    })

    it('требует непустую причину', async () => {
      const adapter = createMemoryPersistence()
      await adapter.reset(seedEnvelope([CONDUCT_EVENT]))
      const repo = createSecurityEventsRepository(adapter, new DemoClock('2026-07-20T08:00:00+05:00'))
      await expect(
        repo.replaceAssignment(
          CONDUCT_EVENT.id,
          { assignmentId: 'pa1', incomingEmployeeId: 'employee-1', reasonCode: '' },
          CONDUCT_MANAGER,
        ),
      ).rejects.toBeInstanceOf(RepositoryValidationError)
    })

    it('неизвестный сотрудник — RepositoryValidationError', async () => {
      const adapter = createMemoryPersistence()
      await adapter.reset(seedEnvelope([CONDUCT_EVENT]))
      const repo = createSecurityEventsRepository(adapter, new DemoClock('2026-07-20T08:00:00+05:00'))
      await expect(
        repo.replaceAssignment(
          CONDUCT_EVENT.id,
          { assignmentId: 'pa1', incomingEmployeeId: 'emp-unknown', reasonCode: 'Заболел' },
          CONDUCT_MANAGER,
        ),
      ).rejects.toBeInstanceOf(RepositoryValidationError)
    })

    it('доступна только на этапе «Проведение»', async () => {
      const adapter = createMemoryPersistence()
      await adapter.reset(seedEnvelope([APPROVAL_EVENT]))
      const repo = createSecurityEventsRepository(adapter, new DemoClock('2026-07-20T08:00:00+05:00'))
      await expect(
        repo.replaceAssignment(
          APPROVAL_EVENT.id,
          { assignmentId: 'pa1', incomingEmployeeId: 'employee-1', reasonCode: 'Заболел' },
          CONDUCT_MANAGER,
        ),
      ).rejects.toBeInstanceOf(RepositoryBusinessRuleError)
    })

    it('несуществующее назначение — RepositoryNotFoundError', async () => {
      const adapter = createMemoryPersistence()
      await adapter.reset(seedEnvelope([CONDUCT_EVENT]))
      const repo = createSecurityEventsRepository(adapter, new DemoClock('2026-07-20T08:00:00+05:00'))
      await expect(
        repo.replaceAssignment(
          CONDUCT_EVENT.id,
          { assignmentId: 'unknown-assignment', incomingEmployeeId: 'employee-1', reasonCode: 'Заболел' },
          CONDUCT_MANAGER,
        ),
      ).rejects.toBeInstanceOf(RepositoryNotFoundError)
    })

    it('DOUBLE_ASSIGNMENT: заменяющий уже назначен на другой пост', async () => {
      const adapter = createMemoryPersistence()
      await adapter.reset(seedEnvelope([CONDUCT_EVENT]))
      const repo = createSecurityEventsRepository(adapter, new DemoClock('2026-07-20T08:00:00+05:00'))
      // emp-2 уже на посте B (ASSIGNMENTS) — заменить pa1 (пост A) на emp-2 нельзя.
      await expect(
        repo.replaceAssignment(
          CONDUCT_EVENT.id,
          { assignmentId: 'pa1', incomingEmployeeId: 'emp-2', reasonCode: 'Заболел' },
          CONDUCT_MANAGER,
        ),
      ).rejects.toMatchObject({ errorCode: 'DOUBLE_ASSIGNMENT' })
    })

    it('успешная замена меняет назначение и пишет journal entry типа REPLACEMENT', async () => {
      const adapter = createMemoryPersistence()
      await adapter.reset(seedEnvelope([CONDUCT_EVENT]))
      const repo = createSecurityEventsRepository(adapter, new DemoClock('2026-07-20T08:00:00+05:00'))
      const result = await repo.replaceAssignment(
        CONDUCT_EVENT.id,
        { assignmentId: 'pa1', incomingEmployeeId: 'employee-1', reasonCode: 'Заболел' },
        CONDUCT_MANAGER,
      )
      expect(result.placementAssignments.find((a) => a.postId === POST_A.id)?.employeeName).toBe(
        'Ерланов Д.',
      )
      expect(result.placementAssignments).toHaveLength(2)
      expect(result.journalEntries[0]).toMatchObject({
        type: 'REPLACEMENT',
        description: 'Ахметов Б. → Ерланов Д. — причина: Заболел',
      })
    })

    it('успешная замена персистентна из БД (перечитано через get)', async () => {
      const adapter = createMemoryPersistence()
      await adapter.reset(seedEnvelope([CONDUCT_EVENT]))
      const repo = createSecurityEventsRepository(adapter, new DemoClock('2026-07-20T08:00:00+05:00'))
      await repo.replaceAssignment(
        CONDUCT_EVENT.id,
        { assignmentId: 'pa2', incomingEmployeeId: 'emp-4', reasonCode: 'Травма' },
        CONDUCT_MANAGER,
      )
      const reread = await repo.get(CONDUCT_EVENT.id, VIEWER)
      expect(reread.placementAssignments.find((a) => a.postId === POST_B.id)?.employeeName).toBe(
        'Жаксыбеков Т.',
      )
      expect(reread.journalEntries).toHaveLength(1)
    })
  })
})

describe('привязка ОМ к версии паспорта (§9.6)', () => {
  const CLOCK_ISO = '2026-07-20T08:00:00+05:00'

  function makeRepo(events: SecurityEventsSlice['events'], objects: SecurityObjectProjection[]) {
    const adapter = createMemoryPersistence()
    return adapter
      .reset(seedEnvelope(events, objects))
      .then(() => createSecurityEventsRepository(adapter, new DemoClock(CLOCK_ISO)))
  }

  beforeEach(() => {
    registerRbacDirectory([
      {
        userId: CREATOR,
        permissions: ['ops.security_event.view', 'ops.security_event.create'],
      },
      { userId: VIEWER, permissions: ['ops.security_event.view'] },
      { userId: RECON_OFFICER, permissions: ['ops.security_event.view', 'ops.recon.manage'] },
      { userId: NOBODY, permissions: [] },
    ])
  })

  it('create() на несуществующий объект — ошибка поля, а не битая ссылка', async () => {
    const repo = await makeRepo([], [PASSPORT_OBJECT])
    try {
      await repo.create({ title: 'ОМ', objectId: 'object-нет', businessDate: '2026-08-01' }, CREATOR)
      expect.unreachable()
    } catch (error) {
      expect(error).toBeInstanceOf(RepositoryValidationError)
      expect(Object.keys((error as RepositoryValidationError).fieldErrors)).toEqual(['objectId'])
    }
  })

  it('create() привязывает версию, действующую на бизнес-дату, и берёт имя объекта из реестра', async () => {
    const repo = await makeRepo([], [PASSPORT_OBJECT])
    const created = await repo.create(
      { title: 'ОМ', objectId: PASSPORT_OBJECT.id, businessDate: '2026-08-01' },
      CREATOR,
    )
    expect(created.objectId).toBe(PASSPORT_OBJECT.id)
    // Имя — из реестра, а не из запроса: клиент не может разойтись с реестром.
    expect(created.objectName).toBe('Дворец Независимости')
    expect(created.passportBinding).toEqual({
      objectId: 'object-1',
      objectName: 'Дворец Независимости',
      versionId: 'object-1-v1',
      versionNumber: 1,
      effectiveFrom: '2026-07-01',
      // DemoClock двигает время на 1 мс за вызов — пинить полный ISO значило бы
      // пинить число вызовов часов внутри мутации.
      boundAt: expect.stringMatching(/^2026-07-20T08:00:00/) as unknown as string,
    })
    // Персистентно, а не только в возвращённом объекте.
    expect((await repo.get(created.id, VIEWER)).passportBinding?.versionId).toBe('object-1-v1')
  })

  it('create() на дату РАНЬШЕ вступления версии в силу оставляет привязку пустой, но ОМ создаёт', async () => {
    const repo = await makeRepo([], [PASSPORT_OBJECT])
    const created = await repo.create(
      { title: 'ОМ', objectId: PASSPORT_OBJECT.id, businessDate: '2026-06-30' },
      CREATOR,
    )
    expect(created.objectId).toBe(PASSPORT_OBJECT.id)
    expect(created.passportBinding).toBeNull()
  })

  it('create() на объект без опубликованного паспорта — тоже без привязки, но не отказ', async () => {
    const repo = await makeRepo([], [PASSPORT_OBJECT, OBJECT_WITHOUT_PASSPORT])
    const created = await repo.create(
      { title: 'ОМ', objectId: OBJECT_WITHOUT_PASSPORT.id, businessDate: '2026-08-01' },
      CREATOR,
    )
    expect(created.passportBinding).toBeNull()
    expect(created.objectName).toBe('Дом Министерств')
  })

  it('getPassportView(): непривязанный ОМ не помечается устаревшим — это другой случай', async () => {
    const repo = await makeRepo([SAMPLE_EVENT], [PASSPORT_OBJECT])
    const view = await repo.getPassportView(SAMPLE_EVENT.id, VIEWER)
    expect(view).toEqual({
      objectId: null,
      objectKnown: false,
      binding: null,
      applicableVersionId: null,
      applicableVersionNumber: null,
      stale: false,
      importablePostCount: 0,
    })
  })

  it('getPassportView(): публикация более новой версии помечает привязку устаревшей, НЕ трогая ОМ', async () => {
    const repo = await makeRepo([], [PASSPORT_OBJECT])
    const created = await repo.create(
      { title: 'ОМ', objectId: PASSPORT_OBJECT.id, businessDate: '2026-08-01' },
      CREATOR,
    )
    expect((await repo.getPassportView(created.id, VIEWER)).stale).toBe(false)

    // Владелец объекта публикует v2 — операция ЧУЖОЙ фичи, здесь эмулируется
    // прямой записью в слайс `objects`, как это сделал бы её repository.
    const repoAfterPublish = await makeRepo(
      [await repo.get(created.id, VIEWER)],
      [
        {
          ...PASSPORT_OBJECT,
          passportVersions: [
            ...PASSPORT_OBJECT.passportVersions,
            {
              id: 'object-1-v2',
              versionNumber: 2,
              effectiveFrom: '2026-07-15',
              sectors: [],
            },
          ],
        },
      ],
    )
    const view = await repoAfterPublish.getPassportView(created.id, VIEWER)
    expect(view.stale).toBe(true)
    expect(view.applicableVersionNumber).toBe(2)
    // §9.6: расстановка не переписывается — сам ОМ по-прежнему на v1.
    expect(view.binding?.versionNumber).toBe(1)
    expect((await repoAfterPublish.get(created.id, VIEWER)).passportBinding?.versionId).toBe(
      'object-1-v1',
    )
  })

  it('importReconPostsFromPassport() требует ops.recon.manage', async () => {
    const repo = await makeRepo(
      [{ ...SAMPLE_EVENT, stage: 'RECON' as const }],
      [PASSPORT_OBJECT],
    )
    await expect(
      repo.importReconPostsFromPassport(SAMPLE_EVENT.id, VIEWER),
    ).rejects.toBeInstanceOf(RepositoryPermissionError)
  })

  it('importReconPostsFromPassport() без привязки отказывает бизнес-правилом', async () => {
    const repo = await makeRepo(
      [{ ...SAMPLE_EVENT, stage: 'RECON' as const }],
      [PASSPORT_OBJECT],
    )
    await expect(
      repo.importReconPostsFromPassport(SAMPLE_EVENT.id, RECON_OFFICER),
    ).rejects.toMatchObject({ errorCode: 'NO_PASSPORT_VERSION' })
  })

  it('importReconPostsFromPassport() не работает вне рекогносцировки', async () => {
    const repo = await makeRepo([BOUND_PLACEMENT_EVENT], [PASSPORT_OBJECT])
    await expect(
      repo.importReconPostsFromPassport(BOUND_PLACEMENT_EVENT.id, RECON_OFFICER),
    ).rejects.toMatchObject({ errorCode: 'RECON_STAGE_REQUIRED' })
  })

  it('importReconPostsFromPassport() переносит посты версии с их sectorId/postId, не трогая ручные строки', async () => {
    const manualRow: ReconSectorPost = {
      id: 'manual-1',
      sector: 'Своё',
      post: 'Ручной пост',
      task: '',
      need: 3,
      requirements: '',
      result: null,
      comment: '',
      sourceSectorId: null,
      sourcePostId: null,
      minRating: null,
    }
    const repo = await makeRepo(
      [{ ...BOUND_RECON_EVENT, reconSectorPosts: [manualRow] }],
      [PASSPORT_OBJECT],
    )
    const updated = await repo.importReconPostsFromPassport(BOUND_RECON_EVENT.id, RECON_OFFICER)

    expect(updated.reconSectorPosts).toHaveLength(3)
    // Ручная строка осталась ПЕРВОЙ и неизменной — импорт добавляет, а не заменяет.
    expect(updated.reconSectorPosts[0]).toEqual(manualRow)
    expect(
      updated.reconSectorPosts.slice(1).map((row) => [row.sector, row.post, row.sourceSectorId, row.sourcePostId]),
    ).toEqual([
      ['Сектор A', 'КПП-1', 'sector-1', 'post-1'],
      ['Сектор A', 'Пост 2', 'sector-1', 'post-2'],
    ])
    // Численность паспортом не задаётся — минимальная 1, а не выдуманное число.
    expect(updated.reconSectorPosts.slice(1).every((row) => row.need === 1)).toBe(true)
  })

  it('повторный импорт не плодит дубли и говорит об этом явно', async () => {
    const repo = await makeRepo([BOUND_RECON_EVENT], [PASSPORT_OBJECT])
    await repo.importReconPostsFromPassport(BOUND_RECON_EVENT.id, RECON_OFFICER)
    await expect(
      repo.importReconPostsFromPassport(BOUND_RECON_EVENT.id, RECON_OFFICER),
    ).rejects.toMatchObject({ errorCode: 'NOTHING_TO_IMPORT' })
    expect((await repo.get(BOUND_RECON_EVENT.id, VIEWER)).reconSectorPosts).toHaveLength(2)
  })

  it('импорт НЕ пишет в чужой слайс objects — паспорт остаётся нетронутым (§9.6)', async () => {
    const adapter = createMemoryPersistence()
    await adapter.reset(seedEnvelope([BOUND_RECON_EVENT], [PASSPORT_OBJECT]))
    const repo = createSecurityEventsRepository(adapter, new DemoClock(CLOCK_ISO))
    const before = JSON.stringify((await adapter.load())?.slices.objects)

    await repo.importReconPostsFromPassport(BOUND_RECON_EVENT.id, RECON_OFFICER)

    expect(JSON.stringify((await adapter.load())?.slices.objects)).toBe(before)
  })

  it('правка импортированной строки не рвёт связь с постом паспорта', async () => {
    const repo = await makeRepo([BOUND_RECON_EVENT], [PASSPORT_OBJECT])
    const imported = await repo.importReconPostsFromPassport(BOUND_RECON_EVENT.id, RECON_OFFICER)
    const edited = imported.reconSectorPosts.map((row) => ({ ...row, need: 5, post: `${row.post} (уточнён)` }))

    const saved = await repo.updateRecon(
      BOUND_RECON_EVENT.id,
      { checklist: imported.reconChecklist, sectorPosts: edited },
      RECON_OFFICER,
    )
    expect(saved.reconSectorPosts.map((row) => row.sourcePostId)).toEqual(['post-1', 'post-2'])
    const reread = await repo.get(BOUND_RECON_EVENT.id, VIEWER)
    expect(reread.reconSectorPosts.map((row) => row.sourcePostId)).toEqual(['post-1', 'post-2'])
  })

  it('importablePostCount падает до нуля после переноса всех постов', async () => {
    const repo = await makeRepo([BOUND_RECON_EVENT], [PASSPORT_OBJECT])
    expect((await repo.getPassportView(BOUND_RECON_EVENT.id, VIEWER)).importablePostCount).toBe(2)
    await repo.importReconPostsFromPassport(BOUND_RECON_EVENT.id, RECON_OFFICER)
    expect((await repo.getPassportView(BOUND_RECON_EVENT.id, VIEWER)).importablePostCount).toBe(0)
  })

  it('listBindableObjects() отдаёт реестр по коду и честно помечает отсутствие паспорта', async () => {
    const repo = await makeRepo([], [OBJECT_WITHOUT_PASSPORT, PASSPORT_OBJECT])
    const { results } = await repo.listBindableObjects(VIEWER)
    expect(results.map((o) => [o.code, o.publishedVersionCount])).toEqual([
      ['OBJ-001', 1],
      ['OBJ-002', 0],
    ])
  })

  it('listBindableObjects() без права просмотра отказывает', async () => {
    const repo = await makeRepo([], [PASSPORT_OBJECT])
    await expect(repo.listBindableObjects(NOBODY)).rejects.toBeInstanceOf(
      RepositoryPermissionError,
    )
  })
})

describe('журнал переходов §22.14 (append-only, пишется диффом)', () => {
  // Локальные фикстуры: те же формы, что у стадийных тестов выше, но их
  // константы живут в чужом describe — тянуть их наружу ради журнала значило
  // бы переписывать соседние тесты.
  const POSTS: ReconSectorPost[] = [
    { id: 'p1', sector: 'A', post: 'Вход', task: 'Досмотр', need: 1, requirements: '', result: 'MATCHES', comment: '', sourceSectorId: null, sourcePostId: null, minRating: null },
  ]
  const RECON_CHECKLIST: ReconChecklistItem[] = [
    { id: 'c1', label: 'Периметр', done: false, result: null, comment: '' },
  ]
  const RECON_EVENT = { ...SAMPLE_EVENT, id: 'evt-recon', stage: 'RECON' as const }

  /** Реестр прав перерегистрируется В КАЖДОМ тесте, а не в `beforeEach`:
   * директория RBAC глобальна на модуль, и хук этого describe перетирал
   * набор пользователей соседних блоков — 16 чужих тестов краснели. */
  function registerJournalRbac(): void {
    registerRbacDirectory([
      { userId: VIEWER, permissions: ['ops.security_event.view'] },
      { userId: CREATOR, permissions: ['ops.security_event.view', 'ops.bulletin.manage'] },
      { userId: RECON_OFFICER, permissions: ['ops.security_event.view', 'ops.recon.manage'] },
      { userId: PLACEMENT_MANAGER, permissions: ['ops.security_event.view', 'ops.placement.manage'] },
      { userId: PLACEMENT_APPROVER, permissions: ['ops.security_event.view', 'ops.placement.approve'] },
    ])
  }
  const APPROVAL_EVENT = {
    ...SAMPLE_EVENT,
    id: 'evt-approval',
    stage: 'APPROVAL' as const,
    reconSectorPosts: POSTS,
    placementAssignments: [
      { id: 'pa1', postId: 'p1', employeeId: 'emp-1', employeeName: 'Ахметов Б.', acknowledgedAt: null, ratingOverrideReason: null },
    ] as PlacementAssignment[],
  }

  async function transitionsOf(adapter: ReturnType<typeof createMemoryPersistence>) {
    const envelope = await adapter.load()
    return ((envelope?.slices['security-events'] as SecurityEventsSlice | undefined)
      ?.transitions ?? []) as SecurityEventTransition[]
  }

  it('операция, меняющая стадию, оставляет запись, ничего не зная о журнале', async () => {
    registerJournalRbac()
    const adapter = createMemoryPersistence()
    const doneChecklist = RECON_CHECKLIST.map((c) => ({
      ...c,
      done: true,
      result: 'MATCHES' as const,
    }))
    const sectorPosts: ReconSectorPost[] = [
      { id: 'p1', sector: 'A', post: 'Вход', task: 'Досмотр', need: 2, requirements: '', result: 'MATCHES', comment: '', sourceSectorId: null, sourcePostId: null, minRating: null },
    ]
    await adapter.reset(
      seedEnvelope([
        { ...RECON_EVENT, reconChecklist: doneChecklist, reconSectorPosts: sectorPosts },
      ]),
    )
    const repo = createSecurityEventsRepository(adapter, new DemoClock('2026-07-20T08:00:00+05:00'))

    // Сеяный слайс приходит БЕЗ журнала — запись появляется сама.
    expect(await transitionsOf(adapter)).toHaveLength(0)
    await repo.completeRecon(RECON_EVENT.id, RECON_OFFICER)

    const [transition] = await transitionsOf(adapter)
    expect(transition.eventId).toBe(RECON_EVENT.id)
    expect(transition.fromStage).toBe('RECON')
    expect(transition.toStage).toBe('DEMAND')
    expect(transition.kind).toBe('FORWARD')
  })

  it('возврат на доработку пишется отдельным видом, а не вычитается из переходов', async () => {
    registerJournalRbac()
    const adapter = createMemoryPersistence()
    await adapter.reset(seedEnvelope([APPROVAL_EVENT]))
    const repo = createSecurityEventsRepository(adapter, new DemoClock('2026-07-20T08:00:00+05:00'))

    await repo.returnPlacement(APPROVAL_EVENT.id, { comment: 'Не хватает поста B' }, PLACEMENT_APPROVER)

    const [transition] = await transitionsOf(adapter)
    expect(transition.fromStage).toBe('APPROVAL')
    expect(transition.toStage).toBe('PLACEMENT')
    // §22.14 считает возвраты своим показателем: запись остаётся в журнале
    // и помечена, а не удаляет собой переход вперёд.
    expect(transition.kind).toBe('RETURN')
  })

  it('операция БЕЗ смены стадии журнал не трогает', async () => {
    registerJournalRbac()
    const adapter = createMemoryPersistence()
    await adapter.reset(seedEnvelope([SAMPLE_EVENT]))
    const repo = createSecurityEventsRepository(adapter, new DemoClock('2026-07-20T08:00:00+05:00'))

    await repo.updateBulletin(
      SAMPLE_EVENT.id,
      { briefDescription: 'Описание', initialTasks: 'Задачи' },
      CREATOR,
    )
    expect(await transitionsOf(adapter)).toHaveLength(0)
  })

  it('журнал append-only: прошлые записи не переписываются следующей операцией', async () => {
    registerJournalRbac()
    const adapter = createMemoryPersistence()
    await adapter.reset(seedEnvelope([APPROVAL_EVENT]))
    const repo = createSecurityEventsRepository(adapter, new DemoClock('2026-07-20T08:00:00+05:00'))

    await repo.returnPlacement(APPROVAL_EVENT.id, { comment: 'Первый возврат' }, PLACEMENT_APPROVER)
    const first = (await transitionsOf(adapter))[0]

    await repo.completePlacement(APPROVAL_EVENT.id, PLACEMENT_MANAGER)
    const after = await transitionsOf(adapter)

    expect(after).toHaveLength(2)
    // Первая запись цела: id, время и вид не переписаны второй операцией.
    expect(after[0]).toEqual(first)
    expect(after[1].kind).toBe('FORWARD')
  })
})

describe('рейтинг при расстановке §19.24 (soft warning + краткая сводка)', () => {
  // Свои константы: у verhнего describe директория RBAC глобальна на модуль,
  // поэтому регистрация — в теле КАЖДОГО теста (урок Этапа 46).
  const MANAGER = 'p19-placement-manager'
  const MANAGER_WITH_AGGREGATE = 'p19-manager-with-aggregate'
  const VIEWER_ONLY = 'p19-viewer'

  function registerRatingRbac(): void {
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
      { userId: VIEWER_ONLY, permissions: ['ops.security_event.view'] },
    ])
  }

  const RATED_POST: ReconSectorPost = {
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
  }
  const FREE_POST: ReconSectorPost = { ...RATED_POST, id: 'post-free', post: 'Главный вход', minRating: null }
  const RATING_EVENT = {
    ...SAMPLE_EVENT,
    id: 'evt-rating',
    stage: 'PLACEMENT' as const,
    reconSectorPosts: [RATED_POST, FREE_POST],
  }

  /**
   * Слайс `ratings` кладётся РЯДОМ, как выглядит в бою (ARCH-FE-013): точки
   * динамики — записанные агрегаты, оценки в проекцию не читаются вовсе.
   */
  function ratingsSlice(overrides?: {
    ratingConflicts?: boolean
    operationalRatings?: boolean
  }): Record<string, unknown> {
    return {
      evaluations: [
        // Нарочно свежая высокая оценка НЕ в точках: если бы проекция считала
        // агрегат из оценок сама, «Абишев» прошёл бы требование.
        { id: 'ev-1', targetEmployeeId: 'employee-2', score: 10, comment: 'закрытое поле' },
      ],
      dynamicsPoints: [
        {
          employeeId: 'employee-1',
          period: '2026-06',
          periodStartsAt: '2026-06-01',
          periodEndsAt: '2026-06-30',
          aggregateRating: 8.6,
          evaluationsCount: 7,
          policyVersion: 'OPERATIONAL-RATING-2',
          dataState: 'READY',
          recordedAt: '2026-06-30T23:59:00+05:00',
        },
        // Более СТАРАЯ и более высокая точка того же сотрудника: если проекция
        // возьмёт не последний период, сравнение изменится.
        {
          employeeId: 'employee-2',
          period: '2026-04',
          periodStartsAt: '2026-04-01',
          periodEndsAt: '2026-04-30',
          aggregateRating: 9.9,
          evaluationsCount: 5,
          policyVersion: 'OPERATIONAL-RATING-1',
          dataState: 'READY',
          recordedAt: '2026-04-30T23:59:00+05:00',
        },
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
        {
          employeeId: 'employee-3',
          period: '2026-06',
          periodStartsAt: '2026-06-01',
          periodEndsAt: '2026-06-30',
          aggregateRating: null,
          evaluationsCount: 2,
          policyVersion: 'OPERATIONAL-RATING-2',
          dataState: 'INSUFFICIENT_DATA',
          recordedAt: '2026-06-30T23:59:00+05:00',
        },
      ],
      capabilities: {
        operationalRatings: overrides?.operationalRatings ?? true,
        ratingConflicts: overrides?.ratingConflicts ?? true,
      },
    }
  }

  function ratingSeed(
    events: SecurityEventsSlice['events'],
    overrides?: Parameters<typeof ratingsSlice>[0],
  ): DemoStateEnvelope {
    const envelope = seedEnvelope(events)
    return { ...envelope, slices: { ...envelope.slices, ratings: ratingsSlice(overrides) } }
  }

  it('назначение ниже требования поста даёт 409 SOFT_CONFLICT_DETECTED, а не отказ', async () => {
    registerRatingRbac()
    const adapter = createMemoryPersistence()
    await adapter.reset(ratingSeed([RATING_EVENT]))
    const repo = createSecurityEventsRepository(adapter, new DemoClock('2026-07-20T08:00:00+05:00'))
    // employee-2: последний закрытый период 7,9 < 8. Старая точка 9,9 и свежая
    // оценка 10 в слайсе НЕ должны пройти вместо него.
    const attempt = repo.assignPlacement(
      RATING_EVENT.id,
      { postId: RATED_POST.id, employeeId: 'employee-2' },
      MANAGER,
    )
    const error: unknown = await attempt.then(
      () => null,
      (e: unknown) => e,
    )
    expect(error).toBeInstanceOf(RepositoryConflictError)
    const conflict = error as RepositoryConflictError
    expect(conflict.errorCode).toBe('SOFT_CONFLICT_DETECTED')
    const conflicts = (conflict.details as { conflicts: { conflict_code: string }[] }).conflicts
    expect(conflicts.map((c) => c.conflict_code)).toEqual(['POST_REQUIREMENT_MISMATCH_CONFLICT'])
  })

  it('повтор с override+reason проходит и сохраняет обоснование у назначения', async () => {
    registerRatingRbac()
    const adapter = createMemoryPersistence()
    await adapter.reset(ratingSeed([RATING_EVENT]))
    const repo = createSecurityEventsRepository(adapter, new DemoClock('2026-07-20T08:00:00+05:00'))
    const updated = await repo.assignPlacement(
      RATING_EVENT.id,
      {
        postId: RATED_POST.id,
        employeeId: 'employee-2',
        override: true,
        override_reason: 'Замены нет, опыт подтверждён руководителем',
      },
      MANAGER,
    )
    const assignment = updated.placementAssignments.find((a) => a.employeeId === 'employee-2')
    expect(assignment?.ratingOverrideReason).toBe('Замены нет, опыт подтверждён руководителем')
    // Персистентно, из БД (не из ответа мутации).
    const envelope = await adapter.load()
    const slice = envelope?.slices['security-events'] as SecurityEventsSlice
    const stored = slice.events
      .find((e) => e.id === RATING_EVENT.id)
      ?.placementAssignments.find((a) => a.employeeId === 'employee-2')
    expect(stored?.ratingOverrideReason).toBe('Замены нет, опыт подтверждён руководителем')
  })

  it('отсутствие данных рейтинга — ОТДЕЛЬНОЕ предупреждение RATING_DATA_MISSING, не молчаливый допуск', async () => {
    registerRatingRbac()
    const adapter = createMemoryPersistence()
    await adapter.reset(ratingSeed([RATING_EVENT]))
    const repo = createSecurityEventsRepository(adapter, new DemoClock('2026-07-20T08:00:00+05:00'))
    // employee-3: точка есть, агрегата в ней нет (INSUFFICIENT_DATA).
    const attempt = repo.assignPlacement(
      RATING_EVENT.id,
      { postId: RATED_POST.id, employeeId: 'employee-3' },
      MANAGER,
    )
    const error: unknown = await attempt.then(
      () => null,
      (e: unknown) => e,
    )
    expect(error).toBeInstanceOf(RepositoryConflictError)
    const conflicts = ((error as RepositoryConflictError).details as {
      conflicts: { conflict_code: string }[]
    }).conflicts
    expect(conflicts.map((c) => c.conflict_code)).toEqual(['RATING_DATA_MISSING'])
  })

  it('соответствующий требованию сотрудник назначается без предупреждения и без следа обхода', async () => {
    registerRatingRbac()
    const adapter = createMemoryPersistence()
    await adapter.reset(ratingSeed([RATING_EVENT]))
    const repo = createSecurityEventsRepository(adapter, new DemoClock('2026-07-20T08:00:00+05:00'))
    // employee-1: 8,6 >= 8. Поля override посланы, но конфликта не было —
    // обоснование НЕ сохраняется (иначе читалось бы как «здесь обходили»).
    const updated = await repo.assignPlacement(
      RATING_EVENT.id,
      {
        postId: RATED_POST.id,
        employeeId: 'employee-1',
        override: true,
        override_reason: 'на всякий случай',
      },
      MANAGER,
    )
    const assignment = updated.placementAssignments.find((a) => a.employeeId === 'employee-1')
    expect(assignment).toBeDefined()
    expect(assignment?.ratingOverrideReason).toBeNull()
  })

  it('ENABLE_RATING_CONFLICTS=false: min_rating игнорируется, назначение проходит (§19.3)', async () => {
    registerRatingRbac()
    const adapter = createMemoryPersistence()
    await adapter.reset(ratingSeed([RATING_EVENT], { ratingConflicts: false }))
    const repo = createSecurityEventsRepository(adapter, new DemoClock('2026-07-20T08:00:00+05:00'))
    const updated = await repo.assignPlacement(
      RATING_EVENT.id,
      { postId: RATED_POST.id, employeeId: 'employee-2' },
      MANAGER,
    )
    expect(updated.placementAssignments.some((a) => a.employeeId === 'employee-2')).toBe(true)
  })

  it('жёсткое правило первее мягкого: двойное назначение — 422 и с override', async () => {
    registerRatingRbac()
    const adapter = createMemoryPersistence()
    await adapter.reset(ratingSeed([RATING_EVENT]))
    const repo = createSecurityEventsRepository(adapter, new DemoClock('2026-07-20T08:00:00+05:00'))
    await repo.assignPlacement(
      RATING_EVENT.id,
      { postId: FREE_POST.id, employeeId: 'employee-2' },
      MANAGER,
    )
    await expect(
      repo.assignPlacement(
        RATING_EVENT.id,
        {
          postId: RATED_POST.id,
          employeeId: 'employee-2',
          override: true,
          override_reason: 'обход не спасает от hard',
        },
        MANAGER,
      ),
    ).rejects.toBeInstanceOf(RepositoryBusinessRuleError)
  })

  it('без override двойное назначение — 422 DOUBLE_ASSIGNMENT, а не 409 рейтинга: у отказа один владелец', async () => {
    registerRatingRbac()
    const adapter = createMemoryPersistence()
    await adapter.reset(ratingSeed([RATING_EVENT]))
    const repo = createSecurityEventsRepository(adapter, new DemoClock('2026-07-20T08:00:00+05:00'))
    await repo.assignPlacement(
      RATING_EVENT.id,
      { postId: FREE_POST.id, employeeId: 'employee-2' },
      MANAGER,
    )
    // employee-2 одновременно и занят (hard), и ниже требования (soft).
    // Причина отказа не должна зависеть от порядка проверок: «сохранить можно
    // с обоснованием» здесь было бы ложью — hard обоснованием не обходится.
    const error: unknown = await repo
      .assignPlacement(
        RATING_EVENT.id,
        { postId: RATED_POST.id, employeeId: 'employee-2' },
        MANAGER,
      )
      .then(
        () => null,
        (e: unknown) => e,
      )
    expect(error).toBeInstanceOf(RepositoryBusinessRuleError)
    expect((error as RepositoryBusinessRuleError).errorCode).toBe('DOUBLE_ASSIGNMENT')
  })

  it('listPlacementRatings() требует ops.placement.manage', async () => {
    registerRatingRbac()
    const adapter = createMemoryPersistence()
    await adapter.reset(ratingSeed([RATING_EVENT]))
    const repo = createSecurityEventsRepository(adapter, new DemoClock('2026-07-20T08:00:00+05:00'))
    await expect(repo.listPlacementRatings(RATING_EVENT.id, VIEWER_ONLY)).rejects.toBeInstanceOf(
      RepositoryPermissionError,
    )
  })

  it('без ops.rating.view_aggregate соответствие видно, а ВСЕ значения сводки — null', async () => {
    registerRatingRbac()
    const adapter = createMemoryPersistence()
    const seeded = {
      ...RATING_EVENT,
      placementAssignments: [
        {
          id: 'a-r1',
          postId: RATED_POST.id,
          employeeId: 'employee-2',
          employeeName: 'Абишев Н.',
          acknowledgedAt: null,
          ratingOverrideReason: 'Обход при назначении',
        },
      ],
    }
    await adapter.reset(ratingSeed([seeded]))
    const repo = createSecurityEventsRepository(adapter, new DemoClock('2026-07-20T08:00:00+05:00'))
    const response = await repo.listPlacementRatings(RATING_EVENT.id, MANAGER)
    expect(response.aggregateVisible).toBe(false)
    expect(response.results).toHaveLength(1)
    const row = response.results[0]
    // Соответствие — свойство назначения, оно остаётся.
    expect(row.compliance).toBe('BELOW')
    expect(row.postMinRating).toBe(8)
    // Значения агрегата закрыл сервер: включая СОСТОЯНИЕ данных.
    expect(row.aggregateRating).toBeNull()
    expect(row.evaluationsCount).toBeNull()
    expect(row.policyVersion).toBeNull()
    expect(row.calculatedAt).toBeNull()
    expect(row.dataState).toBeNull()
  })

  it('с ops.rating.view_aggregate сводка несёт значение ПОСЛЕДНЕГО периода, счётчик, методику и дату', async () => {
    registerRatingRbac()
    const adapter = createMemoryPersistence()
    const seeded = {
      ...RATING_EVENT,
      placementAssignments: [
        {
          id: 'a-r1',
          postId: RATED_POST.id,
          employeeId: 'employee-2',
          employeeName: 'Абишев Н.',
          acknowledgedAt: null,
          ratingOverrideReason: null,
        },
      ],
    }
    await adapter.reset(ratingSeed([seeded]))
    const repo = createSecurityEventsRepository(adapter, new DemoClock('2026-07-20T08:00:00+05:00'))
    const response = await repo.listPlacementRatings(RATING_EVENT.id, MANAGER_WITH_AGGREGATE)
    expect(response.aggregateVisible).toBe(true)
    const row = response.results[0]
    // Последний закрытый период (7,9), а не старая более высокая точка (9,9).
    expect(row.aggregateRating).toBe(7.9)
    expect(row.evaluationsCount).toBe(6)
    expect(row.policyVersion).toBe('OPERATIONAL-RATING-2')
    expect(row.calculatedAt).toBe('2026-06-30T23:59:00+05:00')
    expect(row.dataState).toBe('READY')
  })

  it('ответ сводки не несёт закрытых полей ни одним ключом (проверка по всему JSON)', async () => {
    registerRatingRbac()
    const adapter = createMemoryPersistence()
    const seeded = {
      ...RATING_EVENT,
      placementAssignments: [
        {
          id: 'a-r1',
          postId: RATED_POST.id,
          employeeId: 'employee-2',
          employeeName: 'Абишев Н.',
          acknowledgedAt: null,
          ratingOverrideReason: null,
        },
      ],
    }
    await adapter.reset(ratingSeed([seeded]))
    const repo = createSecurityEventsRepository(adapter, new DemoClock('2026-07-20T08:00:00+05:00'))
    const response = await repo.listPlacementRatings(RATING_EVENT.id, MANAGER_WITH_AGGREGATE)
    const json = JSON.stringify(response)
    // Запрещённый список §19.24 целиком: оценки, комментарии, оценщики.
    // Сеяный комментарий «закрытое поле» лежит в слайсе — сюда он не доехал.
    expect(json).not.toContain('закрытое поле')
    expect(json).not.toContain('"score"')
    expect(json).not.toContain('"comment"')
    expect(json).not.toContain('evaluatorUserId')
    expect(json).not.toContain('"evaluations"')
  })

  it('ENABLE_OPERATIONAL_RATINGS=false: сводка честно говорит FEATURE_DISABLED, а не ноль', async () => {
    registerRatingRbac()
    const adapter = createMemoryPersistence()
    const seeded = {
      ...RATING_EVENT,
      placementAssignments: [
        {
          id: 'a-r1',
          postId: RATED_POST.id,
          employeeId: 'employee-1',
          employeeName: 'Ерланов Д.',
          acknowledgedAt: null,
          ratingOverrideReason: null,
        },
      ],
    }
    await adapter.reset(ratingSeed([seeded], { operationalRatings: false }))
    const repo = createSecurityEventsRepository(adapter, new DemoClock('2026-07-20T08:00:00+05:00'))
    const response = await repo.listPlacementRatings(RATING_EVENT.id, MANAGER_WITH_AGGREGATE)
    const row = response.results[0]
    expect(row.dataState).toBe('FEATURE_DISABLED')
    expect(row.aggregateRating).toBeNull()
  })
})
