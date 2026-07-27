import { beforeEach, describe, expect, it } from 'vitest'
import { createMemoryPersistence } from '../../../shared/testing/mock-runtime/memory-persistence'
import { DemoClock } from '../../../shared/testing/mock-runtime/demo-clock'
import { registerRbacDirectory } from '../../../shared/testing/mock-runtime/rbac-directory'
import type { DemoStateEnvelope } from '../../../shared/testing/mock-runtime/persistence'
import {
  createDutiesRepository,
  RepositoryConflictError,
  RepositoryNotFoundError,
  RepositoryPermissionError,
} from './repository'
import { NO_VERSION_FOR_DATE_TEXT, PASSPORT_RED_BLOCK_TEXT } from '../lib/passportBinding'
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
      note: null,
      overrideReason: null,
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
      note: null,
      overrideReason: null,
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

// §21.31 создание индивидуального дежурства + §21.33 подбор + §21.34 конфликты.
// Ключевое, что здесь проверяется: НИ ОДНО решение (какая версия паспорта
// действует, доступен ли объект, какой severity у конфликта) не принимается
// формой — всё приходит готовым отсюда.
describe('createDutiesRepository — создание дежурства (§21.31/§21.33/§21.34)', () => {
  const OVERRIDER = 'overrider-user'

  beforeEach(() => {
    registerRbacDirectory([
      { userId: VIEWER, permissions: ['ops.duty.view'] },
      { userId: PLANNER, permissions: ['ops.duty.view', 'ops.duty.manage'] },
      {
        userId: OVERRIDER,
        permissions: ['ops.duty.view', 'ops.duty.manage', 'ops.duty.override_rest'],
      },
      { userId: NOBODY, permissions: [] },
    ])
  })

  const GREEN_OBJECT = {
    id: 'object-green',
    name: 'Дворец Независимости',
    code: 'OBJ-001',
    passportState: 'GREEN',
    passportVersions: [
      {
        id: 'green-v1',
        versionNumber: 1,
        effectiveFrom: '2026-01-01',
        sectors: [
          {
            id: 'sector-a',
            name: 'Сектор A',
            posts: [{ id: 'post-1', name: 'КПП-1', task: 'Контроль въезда', requirements: 'Допуск A' }],
          },
        ],
      },
    ],
  }
  // Жёлтый паспорт без опубликованных версий — блокируется НЕ цветом, а
  // отсутствием версии: разные причины не должны схлопываться в одну.
  const YELLOW_OBJECT = {
    id: 'object-yellow',
    name: 'Дом Министерств',
    code: 'OBJ-002',
    passportState: 'YELLOW',
    passportVersions: [],
  }
  // Красный, НО с опубликованной версией и постом: без такого объекта правило
  // §21.31 было бы неотличимо от правила «нет версии» и тест был бы вакуумным.
  const RED_OBJECT = {
    id: 'object-red',
    name: 'Астана Арена',
    code: 'OBJ-003',
    passportState: 'RED',
    passportVersions: [
      {
        id: 'red-v1',
        versionNumber: 1,
        effectiveFrom: '2026-01-01',
        sectors: [
          {
            id: 'sector-r',
            name: 'Сектор R',
            posts: [{ id: 'post-r', name: 'Пост R', task: 'Периметр', requirements: 'Допуск R' }],
          },
        ],
      },
    ],
  }

  const CREATE_DUTY_TYPES = [
    {
      dutyTypeCode: 'OWN_OBJECT_DAILY',
      safeLabel: 'Суточное дежурство на собственном объекте',
      targetType: 'OWN_OBJECT',
      defaultDurationMinutes: 1440,
      requiresSenior: true,
      restAfterMinutes: 1440,
      restPolicy: 'HARD_BLOCK',
      requiresCurrentPassport: false,
    },
    {
      dutyTypeCode: 'PROTECTED_OBJECT_DAILY',
      safeLabel: 'Суточное дежурство на охраняемом объекте',
      targetType: 'PROTECTED_OBJECT',
      defaultDurationMinutes: 1440,
      requiresSenior: false,
      restAfterMinutes: 1440,
      restPolicy: 'SOFT_OVERRIDE',
      requiresCurrentPassport: true,
    },
  ]

  function createShift(id: string, businessDate: string, employeeName: string, dutyTypeCode: string): DutyShift {
    return {
      id,
      businessDate,
      dutyTypeCode,
      target: { targetType: 'OWN_OBJECT', objectId: GREEN_OBJECT.id, safeLabel: GREEN_OBJECT.name },
      employeeName,
      stateCode: 'PLANNED',
      acknowledgedAt: null,
      actualStart: null,
      actualEnd: null,
      updatedAt: `${businessDate}T08:00:00+05:00`,
      passportBinding: null,
      note: null,
      overrideReason: null,
    }
  }

  async function setupCreate(shifts: DutyShift[] = []) {
    const envelope = seedEnvelope([])
    const adapter = createMemoryPersistence()
    await adapter.reset({
      ...envelope,
      slices: {
        ...envelope.slices,
        objects: { objects: [GREEN_OBJECT, YELLOW_OBJECT, RED_OBJECT] },
        duties: {
          ...(envelope.slices.duties as object),
          shifts,
          dutyTypes: CREATE_DUTY_TYPES,
          dutyCandidates: [
            { employeeName: 'Ахметов Б.', unitName: '1-й отдел', positionName: 'Инспектор' },
            { employeeName: 'Оразов К.', unitName: '2-й отдел', positionName: 'Инспектор' },
          ],
        },
      },
    })
    return createDutiesRepository(adapter, new DemoClock('2026-07-24T09:00:00+05:00'))
  }

  const VALID_REQUEST = {
    businessDate: '2026-07-24',
    dutyTypeCode: 'OWN_OBJECT_DAILY',
    objectId: GREEN_OBJECT.id,
    sectorId: 'sector-a',
    postId: 'post-1',
    employeeName: 'Ахметов Б.',
    note: null,
  }

  it('createDutyShift() без ops.duty.manage кидает RepositoryPermissionError', async () => {
    const repository = await setupCreate()
    await expect(repository.createDutyShift(VALID_REQUEST, VIEWER)).rejects.toThrow(
      RepositoryPermissionError,
    )
  })

  it('создаёт смену PLANNED со СНИМКОМ поста из действующей версии паспорта', async () => {
    const repository = await setupCreate()
    const created = await repository.createDutyShift(
      { ...VALID_REQUEST, note: '  Усиление на период визита  ' },
      PLANNER,
    )
    expect(created.stateCode).toBe('PLANNED')
    expect(created.target).toMatchObject({ objectId: GREEN_OBJECT.id, targetType: 'OWN_OBJECT' })
    expect(created.passportBinding).toMatchObject({
      versionId: 'green-v1',
      versionNumber: 1,
      sectorName: 'Сектор A',
      postName: 'КПП-1',
    })
    // Примечание сохраняется обрезанным, а не как ввели.
    expect(created.note).toBe('Усиление на период визита')
    expect(created.overrideReason).toBeNull()

    // Персистентность: смена читается ИЗ ХРАНИЛИЩА, а не только из ответа.
    const listed = await repository.listShifts(VIEWER)
    expect(listed.results.map((shift) => shift.id)).toContain(created.id)
  })

  it('пустое примечание сохраняется как null, а не как пустая строка', async () => {
    const repository = await setupCreate()
    const created = await repository.createDutyShift({ ...VALID_REQUEST, note: '   ' }, PLANNER)
    expect(created.note).toBeNull()
  })

  it('targetType берётся у ВИДА дежурства, а не приходит из запроса', async () => {
    const repository = await setupCreate()
    const created = await repository.createDutyShift(
      { ...VALID_REQUEST, dutyTypeCode: 'PROTECTED_OBJECT_DAILY' },
      PLANNER,
    )
    expect(created.target.targetType).toBe('PROTECTED_OBJECT')
  })

  it('§21.31: красный паспорт + вид, требующий актуального, — отказ 422', async () => {
    const repository = await setupCreate()
    await expect(
      repository.createDutyShift(
        {
          ...VALID_REQUEST,
          dutyTypeCode: 'PROTECTED_OBJECT_DAILY',
          objectId: RED_OBJECT.id,
          sectorId: 'sector-r',
          postId: 'post-r',
        },
        PLANNER,
      ),
    ).rejects.toMatchObject({ errorCode: 'PASSPORT_NOT_READY' })
  })

  it('§21.31: тот же красный объект под видом, НЕ требующим паспорта, создаётся', async () => {
    const repository = await setupCreate()
    const created = await repository.createDutyShift(
      {
        ...VALID_REQUEST,
        dutyTypeCode: 'OWN_OBJECT_DAILY',
        objectId: RED_OBJECT.id,
        sectorId: 'sector-r',
        postId: 'post-r',
      },
      PLANNER,
    )
    expect(created.passportBinding?.postName).toBe('Пост R')
  })

  it('объект без опубликованной версии на дату — отдельный код, не PASSPORT_NOT_READY', async () => {
    const repository = await setupCreate()
    await expect(
      repository.createDutyShift({ ...VALID_REQUEST, objectId: YELLOW_OBJECT.id }, PLANNER),
    ).rejects.toMatchObject({ errorCode: 'PASSPORT_VERSION_MISSING' })
  })

  it('пост не из этой версии паспорта — отказ, а не привязка «к какому-нибудь»', async () => {
    const repository = await setupCreate()
    await expect(
      repository.createDutyShift({ ...VALID_REQUEST, postId: 'post-999' }, PLANNER),
    ).rejects.toMatchObject({ errorCode: 'UNKNOWN_POST' })
  })

  it('объект вне реестра и неизвестный вид дежурства различаются кодами', async () => {
    const repository = await setupCreate()
    await expect(
      repository.createDutyShift({ ...VALID_REQUEST, objectId: 'object-missing' }, PLANNER),
    ).rejects.toMatchObject({ errorCode: 'UNKNOWN_OBJECT' })
    await expect(
      repository.createDutyShift({ ...VALID_REQUEST, dutyTypeCode: 'NOPE' }, PLANNER),
    ).rejects.toMatchObject({ errorCode: 'UNKNOWN_DUTY_TYPE' })
  })

  it('§21.34 HARD: второе дежурство сотрудника в тот же день — 422, обойти нельзя', async () => {
    const repository = await setupCreate([
      createShift('existing-1', '2026-07-24', 'Ахметов Б.', 'OWN_OBJECT_DAILY'),
    ])
    await expect(repository.createDutyShift(VALID_REQUEST, PLANNER)).rejects.toMatchObject({
      errorCode: 'DUTY_CONFLICT_HARD',
    })
    // Даже с обоснованием и правом обхода: hard — это hard.
    await expect(
      repository.createDutyShift(
        { ...VALID_REQUEST, override: true, override_reason: 'Приказ №5' },
        OVERRIDER,
      ),
    ).rejects.toMatchObject({ errorCode: 'DUTY_CONFLICT_HARD' })
  })

  it('§21.34 SOFT: нарушение отдыха — 409 с деталями конфликтов, смена НЕ создана', async () => {
    const repository = await setupCreate([
      createShift('existing-1', '2026-07-23', 'Ахметов Б.', 'PROTECTED_OBJECT_DAILY'),
    ])
    let caught: unknown
    try {
      await repository.createDutyShift(
        { ...VALID_REQUEST, dutyTypeCode: 'PROTECTED_OBJECT_DAILY' },
        PLANNER,
      )
    } catch (error) {
      caught = error
    }
    expect(caught).toBeInstanceOf(RepositoryConflictError)
    // Код — канонический overridable из docs/registries/error-codes.yaml, а не
    // свой: именно он включает путь ConflictDialog.
    expect(caught).toMatchObject({ errorCode: 'DUTY_CONFLICT_DETECTED' })
    const conflicts = (caught as RepositoryConflictError).details.conflicts as unknown[]
    expect(conflicts).toHaveLength(1)
    expect(conflicts[0]).toMatchObject({ conflict_code: 'REST_AFTER_DUTY', severity: 'SOFT' })

    const listed = await repository.listShifts(VIEWER)
    expect(listed.results).toHaveLength(1)
  })

  it('§21.34 SOFT: повтор с override сохраняет смену И обоснование', async () => {
    const repository = await setupCreate([
      createShift('existing-1', '2026-07-23', 'Ахметов Б.', 'PROTECTED_OBJECT_DAILY'),
    ])
    const created = await repository.createDutyShift(
      {
        ...VALID_REQUEST,
        dutyTypeCode: 'PROTECTED_OBJECT_DAILY',
        override: true,
        override_reason: '  Некем заменить, приказ №5  ',
      },
      OVERRIDER,
    )
    expect(created.overrideReason).toBe('Некем заменить, приказ №5')
    const listed = await repository.listShifts(VIEWER)
    expect(listed.results.find((shift) => shift.id === created.id)?.overrideReason).toBe(
      'Некем заменить, приказ №5',
    )
  })

  it('§21.34: обход БЕЗ отдельного permission — отказ по правам, а не тихое сохранение', async () => {
    const repository = await setupCreate([
      createShift('existing-1', '2026-07-23', 'Ахметов Б.', 'PROTECTED_OBJECT_DAILY'),
    ])
    await expect(
      repository.createDutyShift(
        {
          ...VALID_REQUEST,
          dutyTypeCode: 'PROTECTED_OBJECT_DAILY',
          override: true,
          override_reason: 'Некем заменить',
        },
        PLANNER,
      ),
    ).rejects.toThrow(RepositoryPermissionError)
  })

  it('обоснование без конфликта НЕ записывается — обход должен быть следом, а не шумом', async () => {
    const repository = await setupCreate()
    const created = await repository.createDutyShift(
      { ...VALID_REQUEST, override: true, override_reason: 'Просто так' },
      OVERRIDER,
    )
    expect(created.overrideReason).toBeNull()
  })

  it('УЖЕ СУЩЕСТВОВАВШИЙ конфликт чужой пары смен не блокирует создание', async () => {
    // Оразов К. и так конфликтует сам с собой два дня подряд; новая смена
    // ДРУГОГО сотрудника не должна падать из-за чужого конфликта в данных.
    const repository = await setupCreate([
      createShift('existing-1', '2026-07-23', 'Оразов К.', 'OWN_OBJECT_DAILY'),
      createShift('existing-2', '2026-07-24', 'Оразов К.', 'OWN_OBJECT_DAILY'),
    ])
    const created = await repository.createDutyShift(VALID_REQUEST, PLANNER)
    expect(created.employeeName).toBe('Ахметов Б.')
  })

  it('§21.31: список объектов формы несёт причину блокировки, а не прячет объект', async () => {
    const repository = await setupCreate()
    const response = await repository.listDutyPlanObjects(
      '2026-07-24',
      'PROTECTED_OBJECT_DAILY',
      VIEWER,
    )
    expect(response.results.map((option) => option.objectName)).toEqual([
      'Астана Арена',
      'Дворец Независимости',
      'Дом Министерств',
    ])
    const byName = new Map(response.results.map((option) => [option.objectName, option]))
    expect(byName.get('Дворец Независимости')?.blockReason).toBeNull()
    expect(byName.get('Дворец Независимости')?.sectors[0]?.posts[0]).toMatchObject({
      postName: 'КПП-1',
      task: 'Контроль въезда',
      requirements: 'Допуск A',
    })
    expect(byName.get('Астана Арена')?.blockReason).toBe(PASSPORT_RED_BLOCK_TEXT)
    expect(byName.get('Дом Министерств')?.blockReason).toBe(NO_VERSION_FOR_DATE_TEXT)
  })

  it('§21.31: тот же красный объект под видом без требования паспорта — доступен', async () => {
    const repository = await setupCreate()
    const response = await repository.listDutyPlanObjects('2026-07-24', 'OWN_OBJECT_DAILY', VIEWER)
    const red = response.results.find((option) => option.objectName === 'Астана Арена')
    expect(red?.blockReason).toBeNull()
  })

  it('список объектов формы требует и дату, и известный вид дежурства', async () => {
    const repository = await setupCreate()
    await expect(repository.listDutyPlanObjects('2026-7-4', 'OWN_OBJECT_DAILY', VIEWER)).rejects.toMatchObject({
      errorCode: 'INVALID_BUSINESS_DATE',
    })
    await expect(repository.listDutyPlanObjects('2026-07-24', '', VIEWER)).rejects.toMatchObject({
      errorCode: 'UNKNOWN_DUTY_TYPE',
    })
  })

  it('§21.33: занятость кандидата считается по РЕАЛЬНЫМ сменам, недоступное — с причиной', async () => {
    const repository = await setupCreate([
      createShift('existing-1', '2026-07-24', 'Ахметов Б.', 'OWN_OBJECT_DAILY'),
      createShift('existing-2', '2026-08-01', 'Оразов К.', 'OWN_OBJECT_DAILY'),
    ])
    const response = await repository.listDutyCandidates('2026-07-24', VIEWER)
    const byName = new Map(response.results.map((option) => [option.employeeName, option]))
    expect(byName.get('Ахметов Б.')).toMatchObject({
      busyOnRequestedDate: true,
      nearestDutyDate: '2026-07-24',
    })
    expect(byName.get('Оразов К.')).toMatchObject({
      busyOnRequestedDate: false,
      nearestDutyDate: '2026-08-01',
    })
    // §35: чего подбор не учитывает — списком с причиной, а не молчанием.
    expect(response.unavailableAttributes.length).toBeGreaterThan(0)
    expect(response.unavailableAttributes.every((item) => item.reason.length > 0)).toBe(true)
  })

  it('§21.33: прошедшее дежурство не считается «ближайшим»', async () => {
    const repository = await setupCreate([
      createShift('existing-1', '2026-07-01', 'Оразов К.', 'OWN_OBJECT_DAILY'),
    ])
    const response = await repository.listDutyCandidates('2026-07-24', VIEWER)
    const orazov = response.results.find((option) => option.employeeName === 'Оразов К.')
    expect(orazov?.nearestDutyDate).toBeNull()
  })
})
