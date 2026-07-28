import { beforeEach, describe, expect, it } from 'vitest'
import { createMemoryPersistence } from '../../../shared/testing/mock-runtime/memory-persistence'
import { DemoClock } from '../../../shared/testing/mock-runtime/demo-clock'
import { registerRbacDirectory } from '../../../shared/testing/mock-runtime/rbac-directory'
import type { DemoStateEnvelope } from '../../../shared/testing/mock-runtime/persistence'
import { OVERRIDABLE_CODES } from '../../../shared/api/errors'
import {
  createDutiesRepository,
  RepositoryBusinessRuleError,
  RepositoryConflictError,
  RepositoryPermissionError,
  RepositoryValidationError,
} from './repository'
import type { DutiesSlice } from './fixtures'
import type { DutyShift } from '../model/types'

const VIEWER = 'viewer-user'
const PLANNER = 'planner-user'
const NOBODY = 'no-permissions-user'

const CLOCK_ISO = '2026-07-20T08:00:00+05:00'

const TARGETS: DutiesSlice['targets'] = [
  { objectId: 'obj-own', targetType: 'OWN_OBJECT', safeLabel: 'Штаб' },
  { objectId: 'obj-prot', targetType: 'PROTECTED_OBJECT', safeLabel: 'Дворец' },
]

const ROSTER: DutiesSlice['roster'] = [
  { employeeId: 'emp-1', fullName: 'Ахметов Б.', unitLabel: 'Штабная группа' },
  { employeeId: 'emp-2', fullName: 'Ерланов Д.', unitLabel: 'Физическая охрана' },
]

const DUTY_TYPES: DutiesSlice['dutyTypes'] = [
  {
    dutyTypeCode: 'OWN_OBJECT_DAILY',
    safeLabel: 'Собственный объект',
    targetType: 'OWN_OBJECT',
    defaultDurationMinutes: 1440,
    requiresSenior: true,
  },
  {
    dutyTypeCode: 'PROTECTED_OBJECT_DAILY',
    safeLabel: 'Охраняемый объект',
    targetType: 'PROTECTED_OBJECT',
    defaultDurationMinutes: 1440,
    requiresSenior: false,
  },
]

function shift(overrides: Partial<DutyShift> & Pick<DutyShift, 'id' | 'businessDate'>): DutyShift {
  return {
    dutyTypeCode: 'OWN_OBJECT_DAILY',
    target: { ...TARGETS[0] },
    employeeId: 'emp-1',
    employeeName: 'Ахметов Б.',
    stateCode: 'PLANNED',
    acknowledgedAt: null,
    actualStart: null,
    actualEnd: null,
    updatedAt: CLOCK_ISO,
    ...overrides,
  }
}

function seedEnvelope(shifts: DutyShift[]): DemoStateEnvelope {
  return {
    application: 'smart-josparlau',
    schema_version: 6,
    seed_version: 'test-v6',
    scenario: 'normal',
    revision: 0,
    created_at: CLOCK_ISO,
    updated_at: CLOCK_ISO,
    slices: {
      duties: {
        dutyTypes: DUTY_TYPES,
        targets: TARGETS,
        roster: ROSTER,
        shifts,
      } satisfies DutiesSlice,
    },
  }
}

async function makeRepository(shifts: DutyShift[]) {
  const adapter = createMemoryPersistence()
  await adapter.reset(seedEnvelope(shifts))
  const clock = new DemoClock(CLOCK_ISO)
  return { repository: createDutiesRepository(adapter, clock), adapter }
}

beforeEach(() => {
  registerRbacDirectory([
    { userId: VIEWER, permissions: ['ops.duty.view'] },
    { userId: PLANNER, permissions: ['ops.duty.view', 'ops.duty.manage'] },
    { userId: NOBODY, permissions: [] },
  ])
})

describe('duties repository — чтение', () => {
  it('без ops.duty.view список закрыт', async () => {
    const { repository } = await makeRepository([])
    await expect(repository.listShifts(NOBODY)).rejects.toBeInstanceOf(RepositoryPermissionError)
    await expect(repository.listDirectory(NOBODY)).rejects.toBeInstanceOf(RepositoryPermissionError)
    await expect(repository.listDutyTypes(NOBODY)).rejects.toBeInstanceOf(RepositoryPermissionError)
  })

  it('список сортирован по дате, затем по id (не по порядку вставки)', async () => {
    // Три элемента и фикстура, чей порядок вставки НЕ совпадает ни с одной
    // клиентской сортировкой — иначе ассерт порядка был бы вакуумным.
    const { repository } = await makeRepository([
      shift({ id: 'c', businessDate: '2026-07-22' }),
      shift({ id: 'a', businessDate: '2026-07-21' }),
      shift({ id: 'b', businessDate: '2026-07-21' }),
    ])
    const response = await repository.listShifts(VIEWER)
    expect(response.results.map((s) => s.id)).toEqual(['a', 'b', 'c'])
  })

  it('отдаёт бизнес-дату сервера — якорь календаря', async () => {
    const { repository } = await makeRepository([])
    const response = await repository.listShifts(VIEWER)
    expect(response.businessDate).toBe('2026-07-20')
  })

  it('справочник назначения отдаёт цели и ростер', async () => {
    const { repository } = await makeRepository([])
    const directory = await repository.listDirectory(VIEWER)
    expect(directory.targets.map((t) => t.objectId)).toEqual(['obj-own', 'obj-prot'])
    expect(directory.roster.map((e) => e.employeeId)).toEqual(['emp-1', 'emp-2'])
  })
})

describe('duties repository — назначение смены', () => {
  const REQUEST = {
    businessDate: '2026-07-25',
    employeeId: 'emp-1',
    objectId: 'obj-own',
    dutyTypeCode: 'OWN_OBJECT_DAILY',
  }

  it('без ops.duty.manage назначение закрыто (просмотра мало)', async () => {
    const { repository } = await makeRepository([])
    await expect(repository.createShift(REQUEST, VIEWER)).rejects.toBeInstanceOf(
      RepositoryPermissionError,
    )
  })

  it('создаёт смену в PLANNED и сохраняет её в состоянии', async () => {
    const { repository } = await makeRepository([])
    const created = await repository.createShift(REQUEST, PLANNER)
    expect(created.stateCode).toBe('PLANNED')
    expect(created.employeeName).toBe('Ахметов Б.')
    expect(created.target.safeLabel).toBe('Штаб')
    // Персистентность — из ПОВТОРНОГО чтения, а не из возвращённого объекта.
    const listed = await repository.listShifts(VIEWER)
    expect(listed.results.map((s) => s.id)).toContain(created.id)
  })

  it('неизвестные сотрудник/объект/вид и кривая дата — 400 по полям', async () => {
    const { repository } = await makeRepository([])
    await expect(
      repository.createShift(
        { businessDate: '25.07.2026', employeeId: 'ghost', objectId: 'nowhere', dutyTypeCode: 'X' },
        PLANNER,
      ),
    ).rejects.toMatchObject({
      fieldErrors: {
        businessDate: expect.any(Array),
        employeeId: expect.any(Array),
        objectId: expect.any(Array),
        dutyTypeCode: expect.any(Array),
      },
    })
  })

  it('вид дежурства должен соответствовать типу объекта', async () => {
    const { repository } = await makeRepository([])
    await expect(
      repository.createShift({ ...REQUEST, objectId: 'obj-prot' }, PLANNER),
    ).rejects.toMatchObject({ errorCode: 'DUTY_TYPE_TARGET_MISMATCH' })
  })

  it('второе назначение в тот же день — hard-block 422, обойти нельзя', async () => {
    const { repository } = await makeRepository([shift({ id: 'x', businessDate: '2026-07-25' })])
    const error = await repository.createShift(REQUEST, PLANNER).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(RepositoryBusinessRuleError)
    expect(error).toMatchObject({ errorCode: 'DUTY_DOUBLE_ASSIGNMENT' })
    // Именно hard: с override тот же запрос тоже не проходит.
    await expect(
      repository.createShift({ ...REQUEST, override: true, override_reason: 'очень нужно' }, PLANNER),
    ).rejects.toBeInstanceOf(RepositoryBusinessRuleError)
  })

  it('смежные сутки — soft-конфликт 409 с кодом из OVERRIDABLE_CODES', async () => {
    const { repository } = await makeRepository([shift({ id: 'x', businessDate: '2026-07-24' })])
    const error = await repository.createShift(REQUEST, PLANNER).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(RepositoryConflictError)
    const conflict = error as RepositoryConflictError
    // Код обязан быть в общем реестре — иначе ConflictDialog не открылся бы
    // и «мягкий» конфликт стал бы тупиком без пути обхода.
    expect(OVERRIDABLE_CODES.has(conflict.errorCode)).toBe(true)
    expect(conflict.conflicts).toEqual([
      expect.objectContaining({
        conflict_code: 'REST_AFTER_DAILY_DUTY',
        business_date: '2026-07-24',
      }),
    ])
  })

  it('конфликт ищется по следующему дню тоже, и только по этому сотруднику', async () => {
    const { repository } = await makeRepository([
      shift({ id: 'next', businessDate: '2026-07-26' }),
      shift({ id: 'other', businessDate: '2026-07-24', employeeId: 'emp-2', employeeName: 'Ерланов Д.' }),
    ])
    const error = await repository.createShift(REQUEST, PLANNER).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(RepositoryConflictError)
    // Смена ЧУЖОГО сотрудника в смежный день в конфликты не попала.
    expect((error as RepositoryConflictError).conflicts).toEqual([
      expect.objectContaining({ business_date: '2026-07-26' }),
    ])
  })

  it('override с причиной проводит смену; без причины — 400', async () => {
    const { repository } = await makeRepository([shift({ id: 'x', businessDate: '2026-07-24' })])
    await expect(
      repository.createShift({ ...REQUEST, override: true, override_reason: '   ' }, PLANNER),
    ).rejects.toBeInstanceOf(RepositoryValidationError)

    const created = await repository.createShift(
      { ...REQUEST, override: true, override_reason: 'Замена заболевшего по устному распоряжению' },
      PLANNER,
    )
    expect(created.businessDate).toBe('2026-07-25')
    const listed = await repository.listShifts(VIEWER)
    expect(listed.results.map((s) => s.id)).toContain(created.id)
  })

  it('смена через двое суток конфликтом не считается', async () => {
    const { repository } = await makeRepository([shift({ id: 'x', businessDate: '2026-07-23' })])
    await expect(repository.createShift(REQUEST, PLANNER)).resolves.toMatchObject({
      businessDate: '2026-07-25',
    })
  })
})

describe('duties repository — жизненный цикл смены', () => {
  it('ознакомление → заступление → завершение, порядок обязателен', async () => {
    const { repository } = await makeRepository([shift({ id: 'x', businessDate: '2026-07-20' })])
    await expect(repository.clockIn('x', PLANNER)).rejects.toMatchObject({
      errorCode: 'INVALID_STATE_TRANSITION',
    })
    expect((await repository.acknowledge('x', PLANNER)).stateCode).toBe('ACKNOWLEDGED')
    expect((await repository.clockIn('x', PLANNER)).stateCode).toBe('ACTIVE')
    const completed = await repository.clockOut('x', PLANNER)
    expect(completed.stateCode).toBe('COMPLETED')
    expect(completed.actualEnd).not.toBeNull()
  })
})
