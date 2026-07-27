import { beforeEach, describe, expect, it } from 'vitest'
import { createMemoryPersistence } from '../../../shared/testing/mock-runtime/memory-persistence'
import { DemoClock } from '../../../shared/testing/mock-runtime/demo-clock'
import { registerRbacDirectory } from '../../../shared/testing/mock-runtime/rbac-directory'
import type { DemoStateEnvelope } from '../../../shared/testing/mock-runtime/persistence'
import {
  createDutiesRepository,
  RepositoryNotFoundError,
  RepositoryPermissionError,
} from './repository'
import type { CombatDutyShift, DutyPassportBinding, DutyShift } from '../model/types'

const VIEWER = 'viewer-user'
const SUBMITTER = 'submitter-user'
const REVIEWER = 'reviewer-user'
const ACKNOWLEDGER = 'acknowledger-user'
const CHECKER = 'checker-user'
const COMPLETER = 'completer-user'
const REPLACER = 'replacer-user'
const PLANNER = 'planner-user'
const NOBODY = 'no-permissions-user'

const AWAITING_SHIFT: CombatDutyShift = {
  id: 'combat-shift-1',
  businessDate: '2026-07-24',
  dutyTypeCode: 'COMBAT_GROUP_SINGLE_ROUTE',
  routeSet: {
    routeSetId: 'route-set-1',
    safeLabel: 'Трасса №1',
    coverageMode: 'RESERVE',
    routeIds: ['route-1'],
  },
  submission: null,
  updatedAt: '2026-07-24T08:00:00+05:00',
  requiredEmployees: 2,
}

const SUBMITTED_SHIFT: CombatDutyShift = {
  id: 'combat-shift-2',
  businessDate: '2026-07-24',
  dutyTypeCode: 'COMBAT_GROUP_MULTI_ROUTE',
  routeSet: {
    routeSetId: 'route-set-2',
    safeLabel: 'Трассы №2-3',
    coverageMode: 'PARALLEL',
    routeIds: ['route-2', 'route-3'],
  },
  submission: {
    submittedByUnitName: '2-е боевое управление',
    groupLeaderEmployeeName: 'Рахимов Т.',
    memberEmployeeNames: ['Сарсенов Б.'],
    reserveEmployeeNames: [],
    stateCode: 'SUBMITTED',
    returnReason: null,
    submittedAt: '2026-07-24T08:00:00+05:00',
    updatedAt: '2026-07-24T08:00:00+05:00',
    execution: null,
    replacements: [],
  },
  updatedAt: '2026-07-24T08:00:00+05:00',
  requiredEmployees: 2,
}

const ACCEPTED_SAME_DAY_SHIFT: CombatDutyShift = {
  id: 'combat-shift-3',
  businessDate: '2026-07-24',
  dutyTypeCode: 'COMBAT_GROUP_SINGLE_ROUTE',
  routeSet: {
    routeSetId: 'route-set-3',
    safeLabel: 'Трасса №2',
    coverageMode: 'SEQUENTIAL',
    routeIds: ['route-2'],
  },
  submission: {
    submittedByUnitName: '1-е боевое управление',
    groupLeaderEmployeeName: 'Байжанов С.',
    memberEmployeeNames: ['Дюсенов М.'],
    reserveEmployeeNames: [],
    stateCode: 'ACCEPTED',
    returnReason: null,
    submittedAt: '2026-07-24T08:00:00+05:00',
    updatedAt: '2026-07-24T08:00:00+05:00',
    execution: {
      stateCode: 'PENDING_ACKNOWLEDGEMENT',
      acknowledgedMemberNames: [],
      actualStart: null,
      actualEnd: null,
      actualMemberNames: null,
      handover: null,
    },
    replacements: [],
  },
  updatedAt: '2026-07-24T08:00:00+05:00',
  requiredEmployees: 2,
}

const READY_SHIFT: CombatDutyShift = {
  ...ACCEPTED_SAME_DAY_SHIFT,
  id: 'combat-shift-4',
  submission: {
    ...ACCEPTED_SAME_DAY_SHIFT.submission!,
    execution: {
      stateCode: 'READY',
      acknowledgedMemberNames: ['Байжанов С.', 'Дюсенов М.'],
      actualStart: null,
      actualEnd: null,
      actualMemberNames: null,
      handover: null,
    },
  },
}

// §24.22 — уже оформленная сдача смены, чтобы существующие completeCombatDuty
// тесты остались про ЗАВЕРШЕНИЕ, не про handover-гард (тот — отдельно, ниже).
const ACTIVE_SHIFT: CombatDutyShift = {
  ...ACCEPTED_SAME_DAY_SHIFT,
  id: 'combat-shift-5',
  submission: {
    ...ACCEPTED_SAME_DAY_SHIFT.submission!,
    execution: {
      stateCode: 'ACTIVE',
      acknowledgedMemberNames: ['Байжанов С.', 'Дюсенов М.'],
      actualStart: '2026-07-24T08:00:00+05:00',
      actualEnd: null,
      actualMemberNames: null,
      handover: {
        unresolvedIncidents: '',
        remarks: '',
        confirmedByEmployeeName: 'Байжанов С.',
        confirmedAt: '2026-07-24T08:00:00+05:00',
      },
    },
  },
}

// Тот же ACTIVE, но БЕЗ сдачи смены — для handover-тестов и MISSING_HANDOVER.
const ACTIVE_SHIFT_NO_HANDOVER: CombatDutyShift = {
  ...ACCEPTED_SAME_DAY_SHIFT,
  id: 'combat-shift-7',
  submission: {
    ...ACCEPTED_SAME_DAY_SHIFT.submission!,
    execution: {
      stateCode: 'ACTIVE',
      acknowledgedMemberNames: ['Байжанов С.', 'Дюсенов М.'],
      actualStart: '2026-07-24T08:00:00+05:00',
      actualEnd: null,
      actualMemberNames: null,
      handover: null,
    },
  },
}

// §24.17 hard-rule fixture для DOUBLE_ASSIGNMENT-теста requestReplacement:
// «Кенжебаев А.» уже ПРИНЯТ в ДРУГУЮ группу на ту же businessDate.
const CONFLICT_SHIFT: CombatDutyShift = {
  id: 'combat-shift-6',
  businessDate: '2026-07-24',
  dutyTypeCode: 'COMBAT_GROUP_SINGLE_ROUTE',
  routeSet: {
    routeSetId: 'route-set-6',
    safeLabel: 'Трасса №3',
    coverageMode: 'RESERVE',
    routeIds: ['route-3'],
  },
  submission: {
    submittedByUnitName: '1-е боевое управление',
    groupLeaderEmployeeName: 'Кенжебаев А.',
    memberEmployeeNames: [],
    reserveEmployeeNames: [],
    stateCode: 'ACCEPTED',
    returnReason: null,
    submittedAt: '2026-07-24T08:00:00+05:00',
    updatedAt: '2026-07-24T08:00:00+05:00',
    execution: {
      stateCode: 'PENDING_ACKNOWLEDGEMENT',
      acknowledgedMemberNames: [],
      actualStart: null,
      actualEnd: null,
      actualMemberNames: null,
      handover: null,
    },
    replacements: [],
  },
  updatedAt: '2026-07-24T08:00:00+05:00',
  requiredEmployees: 2,
}

function seedEnvelope(combatShifts: CombatDutyShift[]): DemoStateEnvelope {
  return {
    application: 'smart-josparlau',
    schema_version: 7,
    seed_version: 'test-v7',
    scenario: 'normal',
    revision: 0,
    created_at: '2026-07-24T08:00:00+05:00',
    updated_at: '2026-07-24T08:00:00+05:00',
    slices: {
      duties: {
        dutyTypes: [],
        shifts: [],
        combatDutyTypes: [
          {
            dutyTypeCode: 'COMBAT_GROUP_SINGLE_ROUTE',
            safeLabel: 'Дежурство боевой группы на одной Трассе',
            supportsMultipleRoutes: false,
          },
          {
            dutyTypeCode: 'COMBAT_GROUP_MULTI_ROUTE',
            safeLabel: 'Дежурство боевой группы на нескольких Трассах',
            supportsMultipleRoutes: true,
          },
        ],
        routes: [
          { routeId: 'route-1', safeLabel: 'Трасса №1' },
          { routeId: 'route-2', safeLabel: 'Трасса №2' },
          { routeId: 'route-3', safeLabel: 'Трасса №3' },
        ],
        rosterCandidates: [
          { employeeName: 'Байжанов С.', unitName: '1-е боевое управление' },
          { employeeName: 'Дюсенов М.', unitName: '1-е боевое управление' },
          { employeeName: 'Кенжебаев А.', unitName: '1-е боевое управление' },
        ],
        combatShifts,
      },
    },
  }
}

describe('createDutiesRepository — боевые группы на Трассе (§24.5-24.10)', () => {
  beforeEach(() => {
    registerRbacDirectory([
      { userId: VIEWER, permissions: ['ops.duty.view'] },
      { userId: SUBMITTER, permissions: ['ops.duty.view', 'ops.combat_group.submit'] },
      { userId: REVIEWER, permissions: ['ops.duty.view', 'ops.combat_group.review'] },
      { userId: ACKNOWLEDGER, permissions: ['ops.duty.view', 'ops.combat_group.acknowledge'] },
      { userId: CHECKER, permissions: ['ops.duty.view', 'ops.combat_group.checkin'] },
      { userId: COMPLETER, permissions: ['ops.duty.view', 'ops.combat_group.complete'] },
      { userId: REPLACER, permissions: ['ops.duty.view', 'ops.combat_group.replace'] },
      { userId: PLANNER, permissions: ['ops.duty.view', 'ops.duty.manage'] },
      { userId: NOBODY, permissions: [] },
    ])
  })

  async function setup(combatShifts: CombatDutyShift[]) {
    const adapter = createMemoryPersistence()
    await adapter.reset(seedEnvelope(combatShifts))
    const clock = new DemoClock('2026-07-24T09:00:00+05:00')
    return { repository: createDutiesRepository(adapter, clock), adapter, clock }
  }

  describe('permission', () => {
    it('listCombatShifts() без ops.duty.view кидает RepositoryPermissionError', async () => {
      const { repository } = await setup([AWAITING_SHIFT])
      await expect(repository.listCombatShifts(NOBODY)).rejects.toThrow(RepositoryPermissionError)
    })

    it('listRosterCandidates() требует ops.combat_group.submit, не только ops.duty.view', async () => {
      const { repository } = await setup([AWAITING_SHIFT])
      await expect(repository.listRosterCandidates(VIEWER)).rejects.toThrow(
        RepositoryPermissionError,
      )
    })

    it('submitCombatGroup() требует ops.combat_group.submit', async () => {
      const { repository } = await setup([AWAITING_SHIFT])
      await expect(
        repository.submitCombatGroup(
          AWAITING_SHIFT.id,
          { groupLeaderEmployeeName: 'Байжанов С.', memberEmployeeNames: ['Дюсенов М.'], reserveEmployeeNames: [] },
          VIEWER,
        ),
      ).rejects.toThrow(RepositoryPermissionError)
    })

    it('reviewCombatGroup() требует ops.combat_group.review, не ops.combat_group.submit', async () => {
      const { repository } = await setup([SUBMITTED_SHIFT])
      await expect(
        repository.reviewCombatGroup(
          SUBMITTED_SHIFT.id,
          { decision: 'ACCEPT', returnReason: null },
          SUBMITTER,
        ),
      ).rejects.toThrow(RepositoryPermissionError)
    })
  })

  describe('submitCombatGroup', () => {
    it('без старшего или без участников — RepositoryBusinessRuleError EMPTY_GROUP', async () => {
      const { repository } = await setup([AWAITING_SHIFT])
      await expect(
        repository.submitCombatGroup(
          AWAITING_SHIFT.id,
          { groupLeaderEmployeeName: '', memberEmployeeNames: [], reserveEmployeeNames: [] },
          SUBMITTER,
        ),
      ).rejects.toMatchObject({ errorCode: 'EMPTY_GROUP' })
    })

    it('несуществующая смена — RepositoryNotFoundError', async () => {
      const { repository } = await setup([AWAITING_SHIFT])
      await expect(
        repository.submitCombatGroup(
          'no-such-shift',
          { groupLeaderEmployeeName: 'Байжанов С.', memberEmployeeNames: ['Дюсенов М.'], reserveEmployeeNames: [] },
          SUBMITTER,
        ),
      ).rejects.toThrow(RepositoryNotFoundError)
    })

    it('успешная подача переводит смену в SUBMITTED с составом', async () => {
      const { repository } = await setup([AWAITING_SHIFT])
      const result = await repository.submitCombatGroup(
        AWAITING_SHIFT.id,
        { groupLeaderEmployeeName: 'Байжанов С.', memberEmployeeNames: ['Дюсенов М.'], reserveEmployeeNames: [] },
        SUBMITTER,
      )
      expect(result.submission).toMatchObject({
        stateCode: 'SUBMITTED',
        groupLeaderEmployeeName: 'Байжанов С.',
        memberEmployeeNames: ['Дюсенов М.'],
      })
    })

    it('повторная подача уже поданного/принятого состава — RepositoryBusinessRuleError ALREADY_SUBMITTED', async () => {
      const { repository } = await setup([SUBMITTED_SHIFT])
      await expect(
        repository.submitCombatGroup(
          SUBMITTED_SHIFT.id,
          { groupLeaderEmployeeName: 'Байжанов С.', memberEmployeeNames: ['Дюсенов М.'], reserveEmployeeNames: [] },
          SUBMITTER,
        ),
      ).rejects.toMatchObject({ errorCode: 'ALREADY_SUBMITTED' })
    })

    it('возвращённый состав можно подать заново', async () => {
      const returnedShift: CombatDutyShift = {
        ...SUBMITTED_SHIFT,
        submission: { ...SUBMITTED_SHIFT.submission!, stateCode: 'RETURNED', returnReason: 'Недостаточный состав' },
      }
      const { repository } = await setup([returnedShift])
      const result = await repository.submitCombatGroup(
        returnedShift.id,
        { groupLeaderEmployeeName: 'Байжанов С.', memberEmployeeNames: ['Дюсенов М.'], reserveEmployeeNames: [] },
        SUBMITTER,
      )
      expect(result.submission?.stateCode).toBe('SUBMITTED')
    })

    it('§24.17 hard-rule: сотрудник, уже ПРИНЯТЫЙ в другую группу на ту же дату — DOUBLE_ASSIGNMENT', async () => {
      const { repository } = await setup([AWAITING_SHIFT, ACCEPTED_SAME_DAY_SHIFT])
      await expect(
        repository.submitCombatGroup(
          AWAITING_SHIFT.id,
          // «Байжанов С.» уже принят на ACCEPTED_SAME_DAY_SHIFT в ту же дату
          { groupLeaderEmployeeName: 'Дюсенов М.', memberEmployeeNames: ['Байжанов С.'], reserveEmployeeNames: [] },
          SUBMITTER,
        ),
      ).rejects.toMatchObject({ errorCode: 'DOUBLE_ASSIGNMENT' })
    })
  })

  describe('reviewCombatGroup', () => {
    it('ACCEPT переводит submission в ACCEPTED', async () => {
      const { repository } = await setup([SUBMITTED_SHIFT])
      const result = await repository.reviewCombatGroup(
        SUBMITTED_SHIFT.id,
        { decision: 'ACCEPT', returnReason: null },
        REVIEWER,
      )
      expect(result.submission?.stateCode).toBe('ACCEPTED')
    })

    it('RETURN без причины — RepositoryBusinessRuleError REASON_REQUIRED', async () => {
      const { repository } = await setup([SUBMITTED_SHIFT])
      await expect(
        repository.reviewCombatGroup(
          SUBMITTED_SHIFT.id,
          { decision: 'RETURN', returnReason: '' },
          REVIEWER,
        ),
      ).rejects.toMatchObject({ errorCode: 'REASON_REQUIRED' })
    })

    it('RETURN с причиной сохраняет её дословно', async () => {
      const { repository } = await setup([SUBMITTED_SHIFT])
      const result = await repository.reviewCombatGroup(
        SUBMITTED_SHIFT.id,
        { decision: 'RETURN', returnReason: 'Недостаточно допусков у резерва' },
        REVIEWER,
      )
      expect(result.submission).toMatchObject({
        stateCode: 'RETURNED',
        returnReason: 'Недостаточно допусков у резерва',
      })
    })

    it('рассмотреть можно только SUBMITTED — не ACCEPTED повторно', async () => {
      const { repository } = await setup([ACCEPTED_SAME_DAY_SHIFT])
      await expect(
        repository.reviewCombatGroup(
          ACCEPTED_SAME_DAY_SHIFT.id,
          { decision: 'ACCEPT', returnReason: null },
          REVIEWER,
        ),
      ).rejects.toMatchObject({ errorCode: 'INVALID_STATE_TRANSITION' })
    })

    it('успешный ACCEPT персистентен из БД (перечитан через listCombatShifts)', async () => {
      const { repository } = await setup([SUBMITTED_SHIFT])
      await repository.reviewCombatGroup(
        SUBMITTED_SHIFT.id,
        { decision: 'ACCEPT', returnReason: null },
        REVIEWER,
      )
      const list = await repository.listCombatShifts(VIEWER)
      const reread = list.results.find((s) => s.id === SUBMITTED_SHIFT.id)
      expect(reread?.submission?.stateCode).toBe('ACCEPTED')
    })

    it('ACCEPT инициализирует execution в PENDING_ACKNOWLEDGEMENT', async () => {
      const { repository } = await setup([SUBMITTED_SHIFT])
      const result = await repository.reviewCombatGroup(
        SUBMITTED_SHIFT.id,
        { decision: 'ACCEPT', returnReason: null },
        REVIEWER,
      )
      expect(result.submission?.execution).toMatchObject({
        stateCode: 'PENDING_ACKNOWLEDGEMENT',
        acknowledgedMemberNames: [],
      })
    })
  })

  describe('acknowledgeCombatDuty (§24.19)', () => {
    it('требует ops.combat_group.acknowledge', async () => {
      const { repository } = await setup([ACCEPTED_SAME_DAY_SHIFT])
      await expect(
        repository.acknowledgeCombatDuty(ACCEPTED_SAME_DAY_SHIFT.id, 'Байжанов С.', VIEWER),
      ).rejects.toThrow(RepositoryPermissionError)
    })

    it('сотрудник вне leader+members — RepositoryBusinessRuleError NOT_IN_ROSTER', async () => {
      const { repository } = await setup([ACCEPTED_SAME_DAY_SHIFT])
      await expect(
        repository.acknowledgeCombatDuty(ACCEPTED_SAME_DAY_SHIFT.id, 'Рахимов Т.', ACKNOWLEDGER),
      ).rejects.toMatchObject({ errorCode: 'NOT_IN_ROSTER' })
    })

    it('повторное ознакомление того же сотрудника — ALREADY_ACKNOWLEDGED', async () => {
      const partiallyAcked: CombatDutyShift = {
        ...ACCEPTED_SAME_DAY_SHIFT,
        submission: {
          ...ACCEPTED_SAME_DAY_SHIFT.submission!,
          execution: {
            ...ACCEPTED_SAME_DAY_SHIFT.submission!.execution!,
            acknowledgedMemberNames: ['Байжанов С.'],
          },
        },
      }
      const { repository } = await setup([partiallyAcked])
      await expect(
        repository.acknowledgeCombatDuty(partiallyAcked.id, 'Байжанов С.', ACKNOWLEDGER),
      ).rejects.toMatchObject({ errorCode: 'ALREADY_ACKNOWLEDGED' })
    })

    it('ознакомление одного из двух оставляет execution PENDING_ACKNOWLEDGEMENT', async () => {
      const { repository } = await setup([ACCEPTED_SAME_DAY_SHIFT])
      const result = await repository.acknowledgeCombatDuty(
        ACCEPTED_SAME_DAY_SHIFT.id,
        'Байжанов С.',
        ACKNOWLEDGER,
      )
      expect(result.submission?.execution).toMatchObject({
        stateCode: 'PENDING_ACKNOWLEDGEMENT',
        acknowledgedMemberNames: ['Байжанов С.'],
      })
    })

    it('ознакомление ПОСЛЕДНЕГО из leader+members переводит execution в READY', async () => {
      const almostReady: CombatDutyShift = {
        ...ACCEPTED_SAME_DAY_SHIFT,
        submission: {
          ...ACCEPTED_SAME_DAY_SHIFT.submission!,
          execution: {
            ...ACCEPTED_SAME_DAY_SHIFT.submission!.execution!,
            acknowledgedMemberNames: ['Байжанов С.'],
          },
        },
      }
      const { repository } = await setup([almostReady])
      const result = await repository.acknowledgeCombatDuty(almostReady.id, 'Дюсенов М.', ACKNOWLEDGER)
      expect(result.submission?.execution?.stateCode).toBe('READY')
    })
  })

  describe('checkInCombatDuty (§24.20)', () => {
    it('требует ops.combat_group.checkin', async () => {
      const { repository } = await setup([READY_SHIFT])
      await expect(repository.checkInCombatDuty(READY_SHIFT.id, VIEWER)).rejects.toThrow(
        RepositoryPermissionError,
      )
    })

    it('заступить можно только из READY — не из PENDING_ACKNOWLEDGEMENT', async () => {
      const { repository } = await setup([ACCEPTED_SAME_DAY_SHIFT])
      await expect(
        repository.checkInCombatDuty(ACCEPTED_SAME_DAY_SHIFT.id, CHECKER),
      ).rejects.toMatchObject({ errorCode: 'INVALID_STATE_TRANSITION' })
    })

    it('успешное заступление переводит execution в ACTIVE и проставляет actualStart', async () => {
      const { repository, clock } = await setup([READY_SHIFT])
      const result = await repository.checkInCombatDuty(READY_SHIFT.id, CHECKER)
      expect(result.submission?.execution).toMatchObject({ stateCode: 'ACTIVE' })
      expect(result.submission?.execution?.actualStart).toBe(clock.now())
    })
  })

  describe('completeCombatDuty (§24.23)', () => {
    it('требует ops.combat_group.complete', async () => {
      const { repository } = await setup([ACTIVE_SHIFT])
      await expect(
        repository.completeCombatDuty(ACTIVE_SHIFT.id, { actualMemberNames: [] }, VIEWER),
      ).rejects.toThrow(RepositoryPermissionError)
    })

    it('завершить можно только из ACTIVE — не из READY', async () => {
      const { repository } = await setup([READY_SHIFT])
      await expect(
        repository.completeCombatDuty(READY_SHIFT.id, { actualMemberNames: [] }, COMPLETER),
      ).rejects.toMatchObject({ errorCode: 'INVALID_STATE_TRANSITION' })
    })

    it('успешное завершение сохраняет фактический состав, отдельный от плана', async () => {
      const { repository, clock } = await setup([ACTIVE_SHIFT])
      const result = await repository.completeCombatDuty(
        ACTIVE_SHIFT.id,
        { actualMemberNames: ['Байжанов С.'] },
        COMPLETER,
      )
      expect(result.submission?.execution).toMatchObject({
        stateCode: 'COMPLETED',
        actualMemberNames: ['Байжанов С.'],
      })
      expect(result.submission?.execution?.actualEnd).toBe(clock.now())
    })

    it('успешное завершение персистентно из БД (перечитано через listCombatShifts)', async () => {
      const { repository } = await setup([ACTIVE_SHIFT])
      await repository.completeCombatDuty(ACTIVE_SHIFT.id, { actualMemberNames: ['Дюсенов М.'] }, COMPLETER)
      const list = await repository.listCombatShifts(VIEWER)
      const reread = list.results.find((s) => s.id === ACTIVE_SHIFT.id)
      expect(reread?.submission?.execution).toMatchObject({
        stateCode: 'COMPLETED',
        actualMemberNames: ['Дюсенов М.'],
      })
    })

    it('MISSING_HANDOVER — без оформленной сдачи смены завершить нельзя', async () => {
      const { repository } = await setup([ACTIVE_SHIFT_NO_HANDOVER])
      await expect(
        repository.completeCombatDuty(
          ACTIVE_SHIFT_NO_HANDOVER.id,
          { actualMemberNames: [] },
          COMPLETER,
        ),
      ).rejects.toMatchObject({ errorCode: 'MISSING_HANDOVER' })
    })
  })

  describe('submitCombatDutyHandover (§24.22)', () => {
    it('требует ops.combat_group.complete', async () => {
      const { repository } = await setup([ACTIVE_SHIFT_NO_HANDOVER])
      await expect(
        repository.submitCombatDutyHandover(
          ACTIVE_SHIFT_NO_HANDOVER.id,
          { unresolvedIncidents: '', remarks: '', confirmedByEmployeeName: 'Байжанов С.' },
          VIEWER,
        ),
      ).rejects.toThrow(RepositoryPermissionError)
    })

    it('CONFIRMER_REQUIRED на пустое имя сдающего', async () => {
      const { repository } = await setup([ACTIVE_SHIFT_NO_HANDOVER])
      await expect(
        repository.submitCombatDutyHandover(
          ACTIVE_SHIFT_NO_HANDOVER.id,
          { unresolvedIncidents: '', remarks: '', confirmedByEmployeeName: '  ' },
          COMPLETER,
        ),
      ).rejects.toMatchObject({ errorCode: 'CONFIRMER_REQUIRED' })
    })

    it('сдать смену можно только из ACTIVE — не из READY', async () => {
      const { repository } = await setup([READY_SHIFT])
      await expect(
        repository.submitCombatDutyHandover(
          READY_SHIFT.id,
          { unresolvedIncidents: '', remarks: '', confirmedByEmployeeName: 'Байжанов С.' },
          COMPLETER,
        ),
      ).rejects.toMatchObject({ errorCode: 'INVALID_STATE_TRANSITION' })
    })

    it('NOT_IN_ROSTER на сдающего вне leader+members', async () => {
      const { repository } = await setup([ACTIVE_SHIFT_NO_HANDOVER])
      await expect(
        repository.submitCombatDutyHandover(
          ACTIVE_SHIFT_NO_HANDOVER.id,
          { unresolvedIncidents: '', remarks: '', confirmedByEmployeeName: 'Кенжебаев А.' },
          COMPLETER,
        ),
      ).rejects.toMatchObject({ errorCode: 'NOT_IN_ROSTER' })
    })

    it('успешная сдача смены сохраняет данные и открывает завершение', async () => {
      const { repository, clock } = await setup([ACTIVE_SHIFT_NO_HANDOVER])
      const result = await repository.submitCombatDutyHandover(
        ACTIVE_SHIFT_NO_HANDOVER.id,
        {
          unresolvedIncidents: 'Не закрыт наряд на Трассе №1',
          remarks: 'Всё штатно',
          confirmedByEmployeeName: 'Байжанов С.',
        },
        COMPLETER,
      )
      expect(result.submission?.execution?.handover).toMatchObject({
        unresolvedIncidents: 'Не закрыт наряд на Трассе №1',
        remarks: 'Всё штатно',
        confirmedByEmployeeName: 'Байжанов С.',
        confirmedAt: clock.now(),
      })
      // После сдачи завершение больше не блокируется MISSING_HANDOVER.
      const completed = await repository.completeCombatDuty(
        ACTIVE_SHIFT_NO_HANDOVER.id,
        { actualMemberNames: ['Байжанов С.', 'Дюсенов М.'] },
        COMPLETER,
      )
      expect(completed.submission?.execution?.stateCode).toBe('COMPLETED')
    })

    it('успешная сдача смены персистентна из БД (перечитано через listCombatShifts)', async () => {
      const { repository } = await setup([ACTIVE_SHIFT_NO_HANDOVER])
      await repository.submitCombatDutyHandover(
        ACTIVE_SHIFT_NO_HANDOVER.id,
        { unresolvedIncidents: '', remarks: 'Проверено', confirmedByEmployeeName: 'Дюсенов М.' },
        COMPLETER,
      )
      const list = await repository.listCombatShifts(VIEWER)
      const reread = list.results.find((s) => s.id === ACTIVE_SHIFT_NO_HANDOVER.id)
      expect(reread?.submission?.execution?.handover).toMatchObject({
        remarks: 'Проверено',
        confirmedByEmployeeName: 'Дюсенов М.',
      })
    })

    it('shift не найден — RepositoryNotFoundError', async () => {
      const { repository } = await setup([ACTIVE_SHIFT_NO_HANDOVER])
      await expect(
        repository.submitCombatDutyHandover(
          'unknown-id',
          { unresolvedIncidents: '', remarks: '', confirmedByEmployeeName: 'Байжанов С.' },
          COMPLETER,
        ),
      ).rejects.toThrow(RepositoryNotFoundError)
    })
  })

  describe('requestReplacement (§24.21)', () => {
    it('требует ops.combat_group.replace', async () => {
      const { repository } = await setup([ACCEPTED_SAME_DAY_SHIFT])
      await expect(
        repository.requestReplacement(
          ACCEPTED_SAME_DAY_SHIFT.id,
          {
            outgoingEmployeeName: 'Дюсенов М.',
            incomingEmployeeName: 'Кенжебаев А.',
            reasonCode: 'Болезнь',
            safeComment: null,
          },
          VIEWER,
        ),
      ).rejects.toThrow(RepositoryPermissionError)
    })

    it('REASON_REQUIRED на пустую причину', async () => {
      const { repository } = await setup([ACCEPTED_SAME_DAY_SHIFT])
      await expect(
        repository.requestReplacement(
          ACCEPTED_SAME_DAY_SHIFT.id,
          {
            outgoingEmployeeName: 'Дюсенов М.',
            incomingEmployeeName: 'Кенжебаев А.',
            reasonCode: '  ',
            safeComment: null,
          },
          REPLACER,
        ),
      ).rejects.toMatchObject({ errorCode: 'REASON_REQUIRED' })
    })

    it('замена недоступна после заступления (ACTIVE)', async () => {
      const { repository } = await setup([ACTIVE_SHIFT])
      await expect(
        repository.requestReplacement(
          ACTIVE_SHIFT.id,
          {
            outgoingEmployeeName: 'Дюсенов М.',
            incomingEmployeeName: 'Кенжебаев А.',
            reasonCode: 'Болезнь',
            safeComment: null,
          },
          REPLACER,
        ),
      ).rejects.toMatchObject({ errorCode: 'INVALID_STATE_TRANSITION' })
    })

    it('NOT_IN_ROSTER на заменяемого, который не в составе', async () => {
      const { repository } = await setup([ACCEPTED_SAME_DAY_SHIFT])
      await expect(
        repository.requestReplacement(
          ACCEPTED_SAME_DAY_SHIFT.id,
          {
            outgoingEmployeeName: 'Кенжебаев А.',
            incomingEmployeeName: 'Тастанова Г.',
            reasonCode: 'Болезнь',
            safeComment: null,
          },
          REPLACER,
        ),
      ).rejects.toMatchObject({ errorCode: 'NOT_IN_ROSTER' })
    })

    it('ALREADY_IN_ROSTER на заменяющего, который уже в составе', async () => {
      const { repository } = await setup([ACCEPTED_SAME_DAY_SHIFT])
      await expect(
        repository.requestReplacement(
          ACCEPTED_SAME_DAY_SHIFT.id,
          {
            outgoingEmployeeName: 'Дюсенов М.',
            incomingEmployeeName: 'Байжанов С.',
            reasonCode: 'Болезнь',
            safeComment: null,
          },
          REPLACER,
        ),
      ).rejects.toMatchObject({ errorCode: 'ALREADY_IN_ROSTER' })
    })

    it('DOUBLE_ASSIGNMENT на заменяющего, уже принятого в другую группу на ту же дату', async () => {
      const { repository } = await setup([ACCEPTED_SAME_DAY_SHIFT, CONFLICT_SHIFT])
      await expect(
        repository.requestReplacement(
          ACCEPTED_SAME_DAY_SHIFT.id,
          {
            outgoingEmployeeName: 'Дюсенов М.',
            incomingEmployeeName: 'Кенжебаев А.',
            reasonCode: 'Болезнь',
            safeComment: null,
          },
          REPLACER,
        ),
      ).rejects.toMatchObject({ errorCode: 'DOUBLE_ASSIGNMENT' })
    })

    it('успешная замена участника меняет состав и пишет историю', async () => {
      const { repository } = await setup([ACCEPTED_SAME_DAY_SHIFT])
      const result = await repository.requestReplacement(
        ACCEPTED_SAME_DAY_SHIFT.id,
        {
          outgoingEmployeeName: 'Дюсенов М.',
          incomingEmployeeName: 'Кенжебаев А.',
          reasonCode: 'Болезнь',
          safeComment: 'Заменён по устной договорённости',
        },
        REPLACER,
      )
      expect(result.submission?.groupLeaderEmployeeName).toBe('Байжанов С.')
      expect(result.submission?.memberEmployeeNames).toEqual(['Кенжебаев А.'])
      expect(result.submission?.replacements).toMatchObject([
        {
          outgoingEmployeeName: 'Дюсенов М.',
          incomingEmployeeName: 'Кенжебаев А.',
          reasonCode: 'Болезнь',
        },
      ])
    })

    it('успешная замена старшего группы обновляет groupLeaderEmployeeName', async () => {
      const { repository } = await setup([ACCEPTED_SAME_DAY_SHIFT])
      const result = await repository.requestReplacement(
        ACCEPTED_SAME_DAY_SHIFT.id,
        {
          outgoingEmployeeName: 'Байжанов С.',
          incomingEmployeeName: 'Кенжебаев А.',
          reasonCode: 'Отпуск',
          safeComment: null,
        },
        REPLACER,
      )
      expect(result.submission?.groupLeaderEmployeeName).toBe('Кенжебаев А.')
      expect(result.submission?.memberEmployeeNames).toEqual(['Дюсенов М.'])
    })

    it('замена уже ознакомленного участника снимает READY обратно в PENDING_ACKNOWLEDGEMENT', async () => {
      const { repository } = await setup([READY_SHIFT])
      const result = await repository.requestReplacement(
        READY_SHIFT.id,
        {
          outgoingEmployeeName: 'Дюсенов М.',
          incomingEmployeeName: 'Кенжебаев А.',
          reasonCode: 'Болезнь',
          safeComment: null,
        },
        REPLACER,
      )
      expect(result.submission?.execution?.stateCode).toBe('PENDING_ACKNOWLEDGEMENT')
      expect(result.submission?.execution?.acknowledgedMemberNames).toEqual(['Байжанов С.'])
    })

    it('успешная замена персистентна из БД (перечитано через listCombatShifts)', async () => {
      const { repository } = await setup([ACCEPTED_SAME_DAY_SHIFT])
      await repository.requestReplacement(
        ACCEPTED_SAME_DAY_SHIFT.id,
        {
          outgoingEmployeeName: 'Дюсенов М.',
          incomingEmployeeName: 'Кенжебаев А.',
          reasonCode: 'Болезнь',
          safeComment: null,
        },
        REPLACER,
      )
      const list = await repository.listCombatShifts(VIEWER)
      const reread = list.results.find((s) => s.id === ACCEPTED_SAME_DAY_SHIFT.id)
      expect(reread?.submission?.memberEmployeeNames).toEqual(['Кенжебаев А.'])
      expect(reread?.submission?.replacements).toHaveLength(1)
    })

    it('shift не найден — RepositoryNotFoundError', async () => {
      const { repository } = await setup([ACCEPTED_SAME_DAY_SHIFT])
      await expect(
        repository.requestReplacement(
          'unknown-id',
          {
            outgoingEmployeeName: 'Дюсенов М.',
            incomingEmployeeName: 'Кенжебаев А.',
            reasonCode: 'Болезнь',
            safeComment: null,
          },
          REPLACER,
        ),
      ).rejects.toThrow(RepositoryNotFoundError)
    })
  })

  describe('createCombatDutyShift (§24.1)', () => {
    it('требует ops.duty.manage', async () => {
      const { repository } = await setup([])
      await expect(
        repository.createCombatDutyShift(
          {
            businessDate: '2026-08-01',
            dutyTypeCode: 'COMBAT_GROUP_SINGLE_ROUTE',
            routeIds: ['route-1'],
            coverageMode: 'RESERVE',
            requiredEmployees: 3,
          },
          VIEWER,
        ),
      ).rejects.toThrow(RepositoryPermissionError)
    })

    it('INVALID_BUSINESS_DATE на некорректный формат даты', async () => {
      const { repository } = await setup([])
      await expect(
        repository.createCombatDutyShift(
          {
            businessDate: '01.08.2026',
            dutyTypeCode: 'COMBAT_GROUP_SINGLE_ROUTE',
            routeIds: ['route-1'],
            coverageMode: 'RESERVE',
            requiredEmployees: 3,
          },
          PLANNER,
        ),
      ).rejects.toMatchObject({ errorCode: 'INVALID_BUSINESS_DATE' })
    })

    it('EMPTY_ROUTE_SET без Трасс', async () => {
      const { repository } = await setup([])
      await expect(
        repository.createCombatDutyShift(
          {
            businessDate: '2026-08-01',
            dutyTypeCode: 'COMBAT_GROUP_SINGLE_ROUTE',
            routeIds: [],
            coverageMode: 'RESERVE',
            requiredEmployees: 3,
          },
          PLANNER,
        ),
      ).rejects.toMatchObject({ errorCode: 'EMPTY_ROUTE_SET' })
    })

    it('INVALID_REQUIREMENT при requiredEmployees < 1', async () => {
      const { repository } = await setup([])
      await expect(
        repository.createCombatDutyShift(
          {
            businessDate: '2026-08-01',
            dutyTypeCode: 'COMBAT_GROUP_SINGLE_ROUTE',
            routeIds: ['route-1'],
            coverageMode: 'RESERVE',
            requiredEmployees: 0,
          },
          PLANNER,
        ),
      ).rejects.toMatchObject({ errorCode: 'INVALID_REQUIREMENT' })
    })

    it('UNKNOWN_DUTY_TYPE на неизвестный код вида дежурства', async () => {
      const { repository } = await setup([])
      await expect(
        repository.createCombatDutyShift(
          {
            businessDate: '2026-08-01',
            dutyTypeCode: 'NOT_A_REAL_TYPE',
            routeIds: ['route-1'],
            coverageMode: 'RESERVE',
            requiredEmployees: 3,
          },
          PLANNER,
        ),
      ).rejects.toMatchObject({ errorCode: 'UNKNOWN_DUTY_TYPE' })
    })

    it('UNKNOWN_ROUTE на неизвестную Трассу', async () => {
      const { repository } = await setup([])
      await expect(
        repository.createCombatDutyShift(
          {
            businessDate: '2026-08-01',
            dutyTypeCode: 'COMBAT_GROUP_SINGLE_ROUTE',
            routeIds: ['route-unknown'],
            coverageMode: 'RESERVE',
            requiredEmployees: 3,
          },
          PLANNER,
        ),
      ).rejects.toMatchObject({ errorCode: 'UNKNOWN_ROUTE' })
    })

    it('TOO_MANY_ROUTES: одна Трасса — вид не поддерживает несколько', async () => {
      const { repository } = await setup([])
      await expect(
        repository.createCombatDutyShift(
          {
            businessDate: '2026-08-01',
            dutyTypeCode: 'COMBAT_GROUP_SINGLE_ROUTE',
            routeIds: ['route-1', 'route-2'],
            coverageMode: 'PARALLEL',
            requiredEmployees: 3,
          },
          PLANNER,
        ),
      ).rejects.toMatchObject({ errorCode: 'TOO_MANY_ROUTES' })
    })

    it('успешное создание заводит смену со submission:null, «Требует подачи»', async () => {
      const { repository } = await setup([])
      const created = await repository.createCombatDutyShift(
        {
          businessDate: '2026-08-01',
          dutyTypeCode: 'COMBAT_GROUP_MULTI_ROUTE',
          routeIds: ['route-2', 'route-3'],
          coverageMode: 'PARALLEL',
          requiredEmployees: 4,
        },
        PLANNER,
      )
      expect(created.submission).toBeNull()
      expect(created.requiredEmployees).toBe(4)
      expect(created.businessDate).toBe('2026-08-01')
      expect(created.routeSet.routeIds).toEqual(['route-2', 'route-3'])
      expect(created.routeSet.safeLabel).toBe('Трасса №2, Трасса №3')
    })

    it('успешное создание персистентно из БД (перечитано через listCombatShifts)', async () => {
      const { repository } = await setup([])
      const created = await repository.createCombatDutyShift(
        {
          businessDate: '2026-08-02',
          dutyTypeCode: 'COMBAT_GROUP_SINGLE_ROUTE',
          routeIds: ['route-1'],
          coverageMode: 'RESERVE',
          requiredEmployees: 2,
        },
        PLANNER,
      )
      const list = await repository.listCombatShifts(VIEWER)
      const reread = list.results.find((s) => s.id === created.id)
      expect(reread).toMatchObject({ businessDate: '2026-08-02', submission: null })
    })

    it('созданная смена появляется рядом с фикстурными, не затирает их', async () => {
      const { repository } = await setup([AWAITING_SHIFT, SUBMITTED_SHIFT])
      await repository.createCombatDutyShift(
        {
          businessDate: '2026-08-03',
          dutyTypeCode: 'COMBAT_GROUP_SINGLE_ROUTE',
          routeIds: ['route-1'],
          coverageMode: 'RESERVE',
          requiredEmployees: 1,
        },
        PLANNER,
      )
      const list = await repository.listCombatShifts(VIEWER)
      expect(list.results).toHaveLength(3)
    })
  })
})

// §9.6: производный статус привязки дежурства к версии паспорта. Слайс
// `objects` здесь сеется РУКАМИ — repository обязан читать его как чужой
// снимок, а не зависеть от demo-сида.
describe('createDutiesRepository — привязка дежурства к версии паспорта (§9.6)', () => {
  beforeEach(() => {
    registerRbacDirectory([
      { userId: VIEWER, permissions: ['ops.duty.view'] },
      { userId: PLANNER, permissions: ['ops.duty.view', 'ops.duty.manage'] },
      { userId: NOBODY, permissions: [] },
    ])
  })

  const BINDING: DutyPassportBinding = {
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
  }

  function shift(id: string, overrides: Partial<DutyShift> = {}): DutyShift {
    return {
      id,
      businessDate: '2026-07-24',
      dutyTypeCode: 'OWN_OBJECT_DAILY',
      target: { targetType: 'OWN_OBJECT', objectId: 'object-1', safeLabel: 'Дворец Независимости' },
      employeeName: 'Ахметов Б.',
      stateCode: 'PLANNED',
      acknowledgedAt: null,
      actualStart: null,
      actualEnd: null,
      updatedAt: '2026-07-24T08:00:00+05:00',
      passportBinding: BINDING,
      ...overrides,
    }
  }

  function objectSlice(versions: Array<{ id: string; versionNumber: number; effectiveFrom: string }>) {
    return {
      objects: [
        {
          id: 'object-1',
          name: 'Дворец Независимости',
          code: 'OBJ-001',
          passportVersions: versions.map((version) => ({
            ...version,
            sectors: [{ id: 'sector-a', name: 'Сектор A', posts: [{ id: 'post-1', name: 'КПП-1' }] }],
          })),
        },
      ],
    }
  }

  async function setupShifts(shifts: DutyShift[], objects: unknown) {
    const envelope = seedEnvelope([])
    const adapter = createMemoryPersistence()
    await adapter.reset({
      ...envelope,
      slices: {
        ...envelope.slices,
        duties: { ...(envelope.slices.duties as object), shifts },
        ...(objects === undefined ? {} : { objects }),
      },
    })
    const clock = new DemoClock('2026-07-24T09:00:00+05:00')
    return { repository: createDutiesRepository(adapter, clock), adapter, clock }
  }

  it('статус приходит по одному на строку, в том же порядке', async () => {
    const { repository } = await setupShifts(
      [shift('duty-2'), shift('duty-1')],
      objectSlice([{ id: 'v1', versionNumber: 1, effectiveFrom: '2026-01-01' }]),
    )
    const list = await repository.listShifts(VIEWER)
    expect(list.passportStatuses.map((s) => s.shiftId)).toEqual(list.results.map((s) => s.id))
    expect(list.results.map((s) => s.id)).toEqual(['duty-1', 'duty-2'])
  })

  it('привязка к действующей версии — не устарела', async () => {
    const { repository } = await setupShifts(
      [shift('duty-1')],
      objectSlice([{ id: 'v1', versionNumber: 1, effectiveFrom: '2026-01-01' }]),
    )
    const [status] = (await repository.listShifts(VIEWER)).passportStatuses
    expect(status).toEqual({
      shiftId: 'duty-1',
      objectKnown: true,
      applicableVersionId: 'v1',
      applicableVersionNumber: 1,
      stale: false,
    })
  })

  it('публикация более новой версии делает привязку устаревшей БЕЗ мутации дежурства', async () => {
    const { repository } = await setupShifts(
      [shift('duty-1')],
      objectSlice([
        { id: 'v1', versionNumber: 1, effectiveFrom: '2026-01-01' },
        { id: 'v2', versionNumber: 2, effectiveFrom: '2026-07-01' },
      ]),
    )
    const list = await repository.listShifts(VIEWER)
    expect(list.passportStatuses[0]).toMatchObject({
      applicableVersionId: 'v2',
      applicableVersionNumber: 2,
      stale: true,
    })
    // Снимок в самой смене не переписан — §9.6 «не переписывается автоматически».
    expect(list.results[0].passportBinding).toEqual(BINDING)
  })

  it('версия, вступающая в силу ПОСЛЕ даты дежурства, не считается действующей', async () => {
    const { repository } = await setupShifts(
      [shift('duty-1')],
      objectSlice([
        { id: 'v1', versionNumber: 1, effectiveFrom: '2026-01-01' },
        { id: 'v2', versionNumber: 2, effectiveFrom: '2026-08-01' },
      ]),
    )
    expect((await repository.listShifts(VIEWER)).passportStatuses[0]).toMatchObject({
      applicableVersionId: 'v1',
      stale: false,
    })
  })

  it('объект вне реестра: objectKnown=false, действующей версии нет, устаревания нет', async () => {
    const { repository } = await setupShifts([shift('duty-1', { passportBinding: null })], undefined)
    expect((await repository.listShifts(VIEWER)).passportStatuses[0]).toEqual({
      shiftId: 'duty-1',
      objectKnown: false,
      applicableVersionId: null,
      applicableVersionNumber: null,
      stale: false,
    })
  })

  it('объект есть, опубликованных версий нет — objectKnown=true, версии нет', async () => {
    const { repository } = await setupShifts(
      [shift('duty-1', { passportBinding: null })],
      objectSlice([]),
    )
    expect((await repository.listShifts(VIEWER)).passportStatuses[0]).toMatchObject({
      objectKnown: true,
      applicableVersionNumber: null,
      stale: false,
    })
  })

  it('переходы дежурства НЕ пишут в чужой слайс objects', async () => {
    const objects = objectSlice([{ id: 'v1', versionNumber: 1, effectiveFrom: '2026-01-01' }])
    const { repository, adapter } = await setupShifts([shift('duty-1')], objects)
    const before = JSON.stringify((await adapter.load())?.slices.objects)
    await repository.acknowledge('duty-1', PLANNER)
    await repository.clockIn('duty-1', PLANNER)
    const after = JSON.stringify((await adapter.load())?.slices.objects)
    expect(after).toBe(before)
    expect(after).toContain('"v1"')
  })
})

// §21.27-21.30: месячный план. Проверяется ИМЕННО проводка репозитория —
// права, валидация месяца и то, что политика отдыха читается из СОХРАНЁННОГО
// реестра видов дежурств (сама арифметика месяца покрыта lib/monthlyPlan.test.ts).
describe('createDutiesRepository — месячный план дежурств (§21.27-21.30)', () => {
  beforeEach(() => {
    registerRbacDirectory([
      { userId: VIEWER, permissions: ['ops.duty.view'] },
      { userId: NOBODY, permissions: [] },
    ])
  })

  function planShift(id: string, businessDate: string, dutyTypeCode: string): DutyShift {
    return {
      id,
      businessDate,
      dutyTypeCode,
      target: { targetType: 'OWN_OBJECT', objectId: 'object-1', safeLabel: 'Штаб управления' },
      employeeName: 'Сейтказы М.',
      stateCode: 'PLANNED',
      acknowledgedAt: null,
      actualStart: null,
      actualEnd: null,
      updatedAt: `${businessDate}T08:00:00+05:00`,
      passportBinding: null,
    }
  }

  async function setupPlan(shifts: DutyShift[], restPolicy: 'HARD_BLOCK' | 'SOFT_OVERRIDE') {
    const envelope = seedEnvelope([])
    const adapter = createMemoryPersistence()
    await adapter.reset({
      ...envelope,
      slices: {
        ...envelope.slices,
        duties: {
          ...(envelope.slices.duties as object),
          shifts,
          dutyTypes: [
            {
              dutyTypeCode: 'OWN_OBJECT_DAILY',
              safeLabel: 'Суточное дежурство на собственном объекте',
              targetType: 'OWN_OBJECT',
              defaultDurationMinutes: 1440,
              requiresSenior: true,
              restAfterMinutes: 1440,
              restPolicy,
            },
          ],
        },
      },
    })
    const clock = new DemoClock('2026-07-24T09:00:00+05:00')
    return createDutiesRepository(adapter, clock)
  }

  it('getMonthlyPlan() без ops.duty.view кидает RepositoryPermissionError', async () => {
    const repository = await setupPlan([], 'HARD_BLOCK')
    await expect(repository.getMonthlyPlan('2026-07', NOBODY)).rejects.toThrow(
      RepositoryPermissionError,
    )
  })

  it('месяц вне формата YYYY-MM — бизнес-ошибка, а не пустой план', async () => {
    const repository = await setupPlan([], 'HARD_BLOCK')
    await expect(repository.getMonthlyPlan('2026-13', VIEWER)).rejects.toMatchObject({
      errorCode: 'INVALID_MONTH',
    })
    await expect(repository.getMonthlyPlan('', VIEWER)).rejects.toMatchObject({
      errorCode: 'INVALID_MONTH',
    })
  })

  it('severity конфликта отдыха приходит из СОХРАНЁННОЙ политики вида дежурства', async () => {
    const shifts = [
      planShift('duty-1', '2026-07-24', 'OWN_OBJECT_DAILY'),
      planShift('duty-2', '2026-07-25', 'OWN_OBJECT_DAILY'),
    ]
    const hardRepository = await setupPlan(shifts, 'HARD_BLOCK')
    const hardPlan = await hardRepository.getMonthlyPlan('2026-07', VIEWER)
    expect(hardPlan.conflicts.map((c) => c.severity)).toEqual(['HARD'])
    expect(hardPlan.kpi).toMatchObject({ shifts: 2, hardConflicts: 1, softConflicts: 0 })

    const softRepository = await setupPlan(shifts, 'SOFT_OVERRIDE')
    const softPlan = await softRepository.getMonthlyPlan('2026-07', VIEWER)
    expect(softPlan.conflicts.map((c) => c.severity)).toEqual(['SOFT'])
    expect(softPlan.kpi).toMatchObject({ hardConflicts: 0, softConflicts: 1 })
  })

  it('план — чтение: повторный вызов не меняет ревизию состояния', async () => {
    const envelope = seedEnvelope([])
    const adapter = createMemoryPersistence()
    await adapter.reset(envelope)
    const repository = createDutiesRepository(adapter, new DemoClock('2026-07-24T09:00:00+05:00'))
    const before = (await adapter.load())?.revision
    await repository.getMonthlyPlan('2026-07', VIEWER)
    expect((await adapter.load())?.revision).toBe(before)
  })
})
