import { beforeEach, describe, expect, it } from 'vitest'
import { createMemoryPersistence } from '../../../shared/testing/mock-runtime/memory-persistence'
import { DemoClock } from '../../../shared/testing/mock-runtime/demo-clock'
import { registerRbacDirectory } from '../../../shared/testing/mock-runtime/rbac-directory'
import type { DemoStateEnvelope } from '../../../shared/testing/mock-runtime/persistence'
import {
  createSecurityEventsRepository,
  RepositoryBusinessRuleError,
  RepositoryNotFoundError,
  RepositoryPermissionError,
  RepositoryValidationError,
} from './repository'
import type { SecurityEventsSlice } from './fixtures'
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

function seedEnvelope(events: SecurityEventsSlice['events']): DemoStateEnvelope {
  return {
    application: 'smart-josparlau',
    schema_version: 1,
    seed_version: 'test-v1',
    scenario: 'normal',
    revision: 0,
    created_at: '2026-07-20T08:00:00+05:00',
    updated_at: '2026-07-20T08:00:00+05:00',
    slices: { 'security-events': { events } },
  }
}

const SAMPLE_EVENT = {
  id: 'evt-1',
  code: 'ОМ-2026-1',
  title: 'Форум',
  objectName: 'Дворец',
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
    await adapter.reset(seedEnvelope([]))
    const repo = createSecurityEventsRepository(adapter, new DemoClock('2026-07-20T08:00:00+05:00'))
    await expect(
      repo.create({ title: 'X', objectName: 'Y', businessDate: '2026-08-01' }, VIEWER),
    ).rejects.toBeInstanceOf(RepositoryPermissionError)
  })

  it('create() с пустыми полями кидает RepositoryValidationError с полевыми ошибками', async () => {
    const adapter = createMemoryPersistence()
    await adapter.reset(seedEnvelope([]))
    const repo = createSecurityEventsRepository(adapter, new DemoClock('2026-07-20T08:00:00+05:00'))
    try {
      await repo.create({ title: '', objectName: '', businessDate: 'not-a-date' }, CREATOR)
      expect.unreachable()
    } catch (error) {
      expect(error).toBeInstanceOf(RepositoryValidationError)
      const validationError = error as RepositoryValidationError
      expect(Object.keys(validationError.fieldErrors).sort()).toEqual([
        'businessDate',
        'objectName',
        'title',
      ])
    }
  })

  it('create() успешно сохраняет — виден следующему list() (персистентность из БД, не из памяти вызова)', async () => {
    const adapter = createMemoryPersistence()
    await adapter.reset(seedEnvelope([]))
    const clock = new DemoClock('2026-07-20T08:00:00+05:00')
    const repo = createSecurityEventsRepository(adapter, clock)

    const created = await repo.create(
      { title: 'Новое ОМ', objectName: 'Объект', businessDate: '2026-08-01' },
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
      { id: 'p1', sector: 'A', post: 'Вход', task: 'Досмотр', need: 2, requirements: '', result: 'MATCHES', comment: '' },
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
      seedEnvelope([{ ...RECON_EVENT, reconChecklist: RECON_CHECKLIST, reconSectorPosts: [{ id: 'p1', sector: 'A', post: 'X', task: 'Y', need: 1, requirements: '', result: 'MATCHES', comment: '' }] }]),
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
      { id: 'p1', sector: 'A', post: 'Вход', task: 'Досмотр', need: 2, requirements: '', result: 'MATCHES', comment: '' },
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
    { id: 'pa1', postId: POST_A.id, employeeId: 'emp-1', employeeName: 'Ахметов Б.', acknowledgedAt: null },
    { id: 'pa2', postId: POST_B.id, employeeId: 'emp-2', employeeName: 'Бекова А.', acknowledgedAt: null },
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
          { assignmentId: 'pa1', incomingEmployeeId: 'emp-3', reasonCode: 'Заболел' },
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
          { assignmentId: 'pa1', incomingEmployeeId: 'emp-3', reasonCode: '' },
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
          { assignmentId: 'pa1', incomingEmployeeId: 'emp-3', reasonCode: 'Заболел' },
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
          { assignmentId: 'unknown-assignment', incomingEmployeeId: 'emp-3', reasonCode: 'Заболел' },
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
        { assignmentId: 'pa1', incomingEmployeeId: 'emp-3', reasonCode: 'Заболел' },
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
