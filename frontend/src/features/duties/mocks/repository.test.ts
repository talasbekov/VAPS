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

/** Узкая копия слайса «Настройки» в объёме, который читает планирование. */
function conflictRulesSlice(mode: 'HARD_BLOCK' | 'SOFT_OVERRIDE') {
  return {
    sectionVersions: {
      ATTENTION_POLICY: 'attention-policy-test.1',
      CONFLICT_RULES: 'conflict-rules-test.1',
      PASSPORT_FRESHNESS: 'passport-freshness-test.1',
    },
    settings: [
      {
        settingCode: 'CONFLICT.REST_AFTER_DUTY.MODE',
        sectionCode: 'CONFLICT_RULES',
        groupCode: 'REST_AFTER_DUTY',
        field: 'MODE',
        value: mode,
      },
    ],
    changeLog: [],
  }
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
      // §21.35: режим обязательного отдыха — ГЛОБАЛЬНАЯ политика из «Настроек»
      // (§29), а не свойство вида дежурства. Сеем мягкий режим: именно на нём
      // достижим путь 409+override, который проверяют пробы ниже. Отсутствие
      // слайса дало бы строгий дефолт HARD_BLOCK — это отдельная проба.
      settings: conflictRulesSlice('SOFT_OVERRIDE'),
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
        // §21.27: планов нет — месяц открыт для планирования, как в сиде.
        monthlyPlans: [],
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
      cancellation: null,
      overrideReason: null,
      employeeId: null,
      unitId: null,
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
      cancellation: null,
      overrideReason: null,
      employeeId: null,
      unitId: null,
    }
  }

  async function setupPlan(shifts: DutyShift[], restPolicy: 'HARD_BLOCK' | 'SOFT_OVERRIDE') {
    const envelope = seedEnvelope([])
    const adapter = createMemoryPersistence()
    await adapter.reset({
      ...envelope,
      slices: {
        ...envelope.slices,
        settings: conflictRulesSlice(restPolicy),
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

  it('severity конфликта отдыха приходит из ДЕЙСТВУЮЩЕЙ политики конфликтов, а не из вида', async () => {
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
      cancellation: null,
      overrideReason: null,
      employeeId: null,
      unitId: null,
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
            { employeeId: 'duty-emp-1', employeeName: 'Ахметов Б.', unitId: 'unit-guard-1', unitName: '1-й отдел', positionName: 'Инспектор' },
            { employeeId: 'duty-emp-3', employeeName: 'Оразов К.', unitId: 'unit-guard-2', unitName: '2-й отдел', positionName: 'Инспектор' },
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

// §21.32 «Карточка дежурства». Ключевое свойство: страница получает
// СОГЛАСОВАННЫЙ срез одним ответом и ничего не выводит сама — severity
// конфликта, актуальность версии паспарта и список недоступных блоков считает
// сервер.
describe('createDutiesRepository — карточка дежурства (§21.32)', () => {
  beforeEach(() => {
    registerRbacDirectory([
      { userId: VIEWER, permissions: ['ops.duty.view'] },
      { userId: NOBODY, permissions: [] },
    ])
  })

  const CARD_OBJECT = {
    id: 'object-card',
    name: 'Дворец Независимости',
    code: 'OBJ-001',
    passportState: 'GREEN',
    passportVersions: [
      {
        id: 'card-v1',
        versionNumber: 1,
        effectiveFrom: '2026-01-01',
        sectors: [
          {
            id: 'sector-a',
            name: 'Сектор A',
            posts: [{ id: 'post-1', name: 'КПП-1', task: 'Контроль', requirements: 'Допуск A' }],
          },
        ],
      },
    ],
  }

  const CARD_DUTY_TYPES = [
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
  ]

  function cardShift(id: string, businessDate: string, overrides: Partial<DutyShift> = {}): DutyShift {
    return {
      id,
      businessDate,
      dutyTypeCode: 'OWN_OBJECT_DAILY',
      target: { targetType: 'OWN_OBJECT', objectId: CARD_OBJECT.id, safeLabel: CARD_OBJECT.name },
      employeeName: 'Ахметов Б.',
      stateCode: 'PLANNED',
      acknowledgedAt: null,
      actualStart: null,
      actualEnd: null,
      updatedAt: `${businessDate}T08:00:00+05:00`,
      passportBinding: {
        objectId: CARD_OBJECT.id,
        objectName: CARD_OBJECT.name,
        versionId: 'card-v1',
        versionNumber: 1,
        effectiveFrom: '2026-01-01',
        sectorId: 'sector-a',
        sectorName: 'Сектор A',
        postId: 'post-1',
        postName: 'КПП-1',
        boundAt: '2026-07-24T08:00:00+05:00',
      },
      note: null,
      cancellation: null,
      overrideReason: null,
      employeeId: null,
      unitId: null,
      ...overrides,
    }
  }

  async function setupCard(shifts: DutyShift[], objects: unknown[] = [CARD_OBJECT]) {
    const envelope = seedEnvelope([])
    const adapter = createMemoryPersistence()
    await adapter.reset({
      ...envelope,
      slices: {
        ...envelope.slices,
        objects: { objects },
        duties: {
          ...(envelope.slices.duties as object),
          shifts,
          dutyTypes: CARD_DUTY_TYPES,
        },
      },
    })
    return {
      repository: createDutiesRepository(adapter, new DemoClock('2026-07-24T09:00:00+05:00')),
      adapter,
    }
  }

  it('getShiftDetail() без ops.duty.view кидает RepositoryPermissionError', async () => {
    const { repository } = await setupCard([cardShift('duty-1', '2026-07-24')])
    await expect(repository.getShiftDetail('duty-1', NOBODY)).rejects.toThrow(
      RepositoryPermissionError,
    )
  })

  it('несуществующая смена — 404, а не пустая карточка', async () => {
    const { repository } = await setupCard([cardShift('duty-1', '2026-07-24')])
    await expect(repository.getShiftDetail('duty-999', VIEWER)).rejects.toThrow(
      RepositoryNotFoundError,
    )
  })

  it('отдаёт смену, вид дежурства и статус паспорта одним согласованным срезом', async () => {
    const { repository } = await setupCard([
      cardShift('duty-1', '2026-07-24', { note: 'Усиление', stateCode: 'ACTIVE' }),
    ])
    const detail = await repository.getShiftDetail('duty-1', VIEWER)
    expect(detail.shift.id).toBe('duty-1')
    expect(detail.shift.note).toBe('Усиление')
    // Вид дежурства целиком — карточка показывает продолжительность и отдых
    // ИЗ реестра, а не своими константами (§21.35).
    expect(detail.dutyType).toMatchObject({ restAfterMinutes: 1440, restPolicy: 'HARD_BLOCK' })
    expect(detail.passportStatus).toMatchObject({
      shiftId: 'duty-1',
      objectKnown: true,
      applicableVersionNumber: 1,
      stale: false,
    })
    // §35: блоки §21.32 без данных названы С ПРИЧИНОЙ, а не пропущены молча.
    expect(detail.unavailableBlocks.length).toBeGreaterThan(0)
    expect(detail.unavailableBlocks.every((block) => block.reason.length > 0)).toBe(true)
    expect(detail.unavailableBlocks.map((block) => block.code)).toContain('JOURNAL')
  })

  it('вид дежурства вне реестра приходит null — карточка не подставит дефолт', async () => {
    const { repository } = await setupCard([
      cardShift('duty-1', '2026-07-24', { dutyTypeCode: 'RETIRED_TYPE' }),
    ])
    const detail = await repository.getShiftDetail('duty-1', VIEWER)
    expect(detail.dutyType).toBeNull()
  })

  it('объект вне реестра: карточка получает objectKnown=false, а не падает', async () => {
    const { repository } = await setupCard([cardShift('duty-1', '2026-07-24')], [])
    const detail = await repository.getShiftDetail('duty-1', VIEWER)
    expect(detail.passportStatus).toMatchObject({
      objectKnown: false,
      applicableVersionNumber: null,
    })
  })

  it('устаревшая привязка помечается stale, снимок поста НЕ переписывается', async () => {
    const { repository } = await setupCard(
      [cardShift('duty-1', '2026-07-24')],
      [
        {
          ...CARD_OBJECT,
          passportVersions: [
            ...CARD_OBJECT.passportVersions,
            {
              id: 'card-v2',
              versionNumber: 2,
              effectiveFrom: '2026-07-01',
              sectors: [
                {
                  id: 'sector-b',
                  name: 'Сектор B',
                  posts: [{ id: 'post-9', name: 'КПП-9', task: 'x', requirements: 'y' }],
                },
              ],
            },
          ],
        },
      ],
    )
    const detail = await repository.getShiftDetail('duty-1', VIEWER)
    expect(detail.passportStatus).toMatchObject({ stale: true, applicableVersionNumber: 2 })
    expect(detail.shift.passportBinding).toMatchObject({ versionNumber: 1, postName: 'КПП-1' })
  })

  it('§21.34: конфликт приходит с СЕРВЕРНОЙ severity, не выводится карточкой', async () => {
    const { repository } = await setupCard([
      cardShift('duty-1', '2026-07-24'),
      cardShift('duty-2', '2026-07-24', { id: 'duty-2' }),
    ])
    const detail = await repository.getShiftDetail('duty-1', VIEWER)
    expect(detail.conflicts).toHaveLength(1)
    expect(detail.conflicts[0]).toMatchObject({ code: 'DUTY_OVERLAP', severity: 'HARD' })
  })

  it('конфликт отдыха виден смене, В ДЕНЬ которой он проявляется, и не виден первой из пары', async () => {
    const { repository } = await setupCard([
      cardShift('duty-1', '2026-07-24'),
      cardShift('duty-2', '2026-07-25', { id: 'duty-2' }),
    ])
    const second = await repository.getShiftDetail('duty-2', VIEWER)
    expect(second.conflicts.map((conflict) => conflict.code)).toEqual(['REST_AFTER_DUTY'])
    const first = await repository.getShiftDetail('duty-1', VIEWER)
    expect(first.conflicts).toEqual([])
  })

  it('конфликт ДРУГОГО сотрудника в тот же день в карточку не попадает', async () => {
    const { repository } = await setupCard([
      cardShift('duty-1', '2026-07-24'),
      cardShift('duty-2', '2026-07-24', { id: 'duty-2', employeeName: 'Оразов К.' }),
      cardShift('duty-3', '2026-07-24', { id: 'duty-3', employeeName: 'Оразов К.' }),
    ])
    const detail = await repository.getShiftDetail('duty-1', VIEWER)
    expect(detail.conflicts).toEqual([])
  })

  it('карточка — чтение: вызов не поднимает ревизию состояния', async () => {
    const { repository, adapter } = await setupCard([cardShift('duty-1', '2026-07-24')])
    const before = (await adapter.load())?.revision
    await repository.getShiftDetail('duty-1', VIEWER)
    expect((await adapter.load())?.revision).toBe(before)
  })
})

// §21.31, правка и отмена заведённой смены (Этап 34). Ключевые инварианты:
// дата и вид неизменны, смена сотрудника снимает ознакомление, отменённая
// смена выбывает из конфликтов, но остаётся в данных.
describe('createDutiesRepository — правка и отмена дежурства (§21.31)', () => {
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

  const EDIT_OBJECT = {
    id: 'object-edit',
    name: 'Дворец Независимости',
    code: 'OBJ-001',
    passportState: 'GREEN',
    passportVersions: [
      {
        id: 'edit-v1',
        versionNumber: 1,
        effectiveFrom: '2026-01-01',
        sectors: [
          {
            id: 'sector-a',
            name: 'Сектор A',
            posts: [
              { id: 'post-1', name: 'КПП-1', task: 'Контроль', requirements: 'Допуск A' },
              { id: 'post-2', name: 'Пост 2', task: 'Периметр', requirements: 'Допуск A' },
            ],
          },
        ],
      },
    ],
  }

  const EDIT_DUTY_TYPES = [
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

  function editShift(
    id: string,
    businessDate: string,
    overrides: Partial<DutyShift> = {},
  ): DutyShift {
    return {
      id,
      businessDate,
      dutyTypeCode: 'OWN_OBJECT_DAILY',
      target: { targetType: 'OWN_OBJECT', objectId: EDIT_OBJECT.id, safeLabel: EDIT_OBJECT.name },
      employeeName: 'Ахметов Б.',
      stateCode: 'PLANNED',
      acknowledgedAt: null,
      actualStart: null,
      actualEnd: null,
      updatedAt: `${businessDate}T08:00:00+05:00`,
      passportBinding: {
        objectId: EDIT_OBJECT.id,
        objectName: EDIT_OBJECT.name,
        versionId: 'edit-v1',
        versionNumber: 1,
        effectiveFrom: '2026-01-01',
        sectorId: 'sector-a',
        sectorName: 'Сектор A',
        postId: 'post-1',
        postName: 'КПП-1',
        boundAt: '2026-07-24T08:00:00+05:00',
      },
      note: null,
      cancellation: null,
      overrideReason: null,
      employeeId: null,
      unitId: null,
      ...overrides,
    }
  }

  async function setupEdit(shifts: DutyShift[]) {
    const envelope = seedEnvelope([])
    const adapter = createMemoryPersistence()
    await adapter.reset({
      ...envelope,
      slices: {
        ...envelope.slices,
        objects: { objects: [EDIT_OBJECT] },
        duties: {
          ...(envelope.slices.duties as object),
          shifts,
          dutyTypes: EDIT_DUTY_TYPES,
        },
      },
    })
    return {
      repository: createDutiesRepository(adapter, new DemoClock('2026-07-26T09:00:00+05:00')),
      adapter,
    }
  }

  const VALID_UPDATE = {
    employeeName: 'Ахметов Б.',
    sectorId: 'sector-a',
    postId: 'post-2',
    note: null,
  }

  it('updateDutyShift() без ops.duty.manage кидает RepositoryPermissionError', async () => {
    const { repository } = await setupEdit([editShift('duty-1', '2026-07-24')])
    await expect(repository.updateDutyShift('duty-1', VALID_UPDATE, VIEWER)).rejects.toThrow(
      RepositoryPermissionError,
    )
  })

  it('переназначает пост в ТОЙ ЖЕ версии паспорта и пишет изменения в хранилище', async () => {
    const { repository } = await setupEdit([editShift('duty-1', '2026-07-24')])
    const updated = await repository.updateDutyShift(
      'duty-1',
      { ...VALID_UPDATE, note: '  Перевод на периметр  ' },
      PLANNER,
    )
    expect(updated.passportBinding).toMatchObject({ versionNumber: 1, postName: 'Пост 2' })
    expect(updated.note).toBe('Перевод на периметр')
    // Дата и вид дежурства неизменны — правка не подменяет смену другой.
    expect(updated.businessDate).toBe('2026-07-24')
    expect(updated.dutyTypeCode).toBe('OWN_OBJECT_DAILY')

    const detail = await repository.getShiftDetail('duty-1', VIEWER)
    expect(detail.shift.passportBinding?.postName).toBe('Пост 2')
    expect(detail.shift.note).toBe('Перевод на периметр')
  })

  it('смена сотрудника СНИМАЕТ ознакомление и откатывает состояние в PLANNED', async () => {
    const { repository } = await setupEdit([
      editShift('duty-1', '2026-07-24', {
        stateCode: 'ACKNOWLEDGED',
        acknowledgedAt: '2026-07-24T08:30:00+05:00',
      }),
    ])
    const updated = await repository.updateDutyShift(
      'duty-1',
      { ...VALID_UPDATE, employeeName: 'Оразов К.' },
      PLANNER,
    )
    expect(updated.employeeName).toBe('Оразов К.')
    expect(updated.stateCode).toBe('PLANNED')
    expect(updated.acknowledgedAt).toBeNull()
  })

  it('правка БЕЗ смены сотрудника ознакомление сохраняет', async () => {
    const { repository } = await setupEdit([
      editShift('duty-1', '2026-07-24', {
        stateCode: 'ACKNOWLEDGED',
        acknowledgedAt: '2026-07-24T08:30:00+05:00',
      }),
    ])
    const updated = await repository.updateDutyShift('duty-1', VALID_UPDATE, PLANNER)
    expect(updated.stateCode).toBe('ACKNOWLEDGED')
    expect(updated.acknowledgedAt).toBe('2026-07-24T08:30:00+05:00')
  })

  it('править начатую и завершённую смену нельзя', async () => {
    const { repository } = await setupEdit([
      editShift('duty-1', '2026-07-24', { stateCode: 'ACTIVE' }),
      editShift('duty-2', '2026-07-25', { stateCode: 'COMPLETED' }),
    ])
    for (const id of ['duty-1', 'duty-2']) {
      await expect(repository.updateDutyShift(id, VALID_UPDATE, PLANNER)).rejects.toMatchObject({
        errorCode: 'INVALID_STATE_TRANSITION',
      })
    }
  })

  it('пост не из действующей версии — отказ, привязка не подменяется', async () => {
    const { repository } = await setupEdit([editShift('duty-1', '2026-07-24')])
    await expect(
      repository.updateDutyShift('duty-1', { ...VALID_UPDATE, postId: 'post-999' }, PLANNER),
    ).rejects.toMatchObject({ errorCode: 'UNKNOWN_POST' })
    const detail = await repository.getShiftDetail('duty-1', VIEWER)
    expect(detail.shift.passportBinding?.postName).toBe('КПП-1')
  })

  it('§21.34: правка, создающая пересечение, отклоняется как жёсткий конфликт', async () => {
    const { repository } = await setupEdit([
      editShift('duty-1', '2026-07-24'),
      editShift('duty-2', '2026-07-24', { id: 'duty-2', employeeName: 'Оразов К.' }),
    ])
    await expect(
      repository.updateDutyShift('duty-2', { ...VALID_UPDATE, employeeName: 'Ахметов Б.' }, PLANNER),
    ).rejects.toMatchObject({ errorCode: 'DUTY_CONFLICT_HARD' })
  })

  it('правка НЕ конфликтует смены сама с собой (иначе любое сохранение падало бы)', async () => {
    // Единственная смена сотрудника: сохранение без смены сотрудника не должно
    // увидеть «пересечение» с собственной прежней редакцией.
    const { repository } = await setupEdit([editShift('duty-1', '2026-07-24')])
    const updated = await repository.updateDutyShift('duty-1', VALID_UPDATE, PLANNER)
    expect(updated.id).toBe('duty-1')
  })

  it('§21.34: правка с мягким конфликтом — 409, повтор с override сохраняет обоснование', async () => {
    const shifts = [
      editShift('duty-1', '2026-07-25', { dutyTypeCode: 'PROTECTED_OBJECT_DAILY' }),
      editShift('duty-2', '2026-07-26', {
        id: 'duty-2',
        dutyTypeCode: 'PROTECTED_OBJECT_DAILY',
        employeeName: 'Оразов К.',
      }),
    ]
    const { repository } = await setupEdit(shifts)
    await expect(
      repository.updateDutyShift('duty-2', { ...VALID_UPDATE, employeeName: 'Ахметов Б.' }, PLANNER),
    ).rejects.toBeInstanceOf(RepositoryConflictError)

    const { repository: second } = await setupEdit(shifts)
    const updated = await second.updateDutyShift(
      'duty-2',
      {
        ...VALID_UPDATE,
        employeeName: 'Ахметов Б.',
        override: true,
        override_reason: 'Некем заменить',
      },
      OVERRIDER,
    )
    expect(updated.overrideReason).toBe('Некем заменить')
  })

  it('правка БЕЗ конфликта снимает прежнюю пометку обхода', async () => {
    const { repository } = await setupEdit([
      editShift('duty-1', '2026-07-24', { overrideReason: 'Старое обоснование' }),
    ])
    const updated = await repository.updateDutyShift('duty-1', VALID_UPDATE, PLANNER)
    expect(updated.overrideReason).toBeNull()
  })

  it('cancelDutyShift(): причина обязательна, права проверяются', async () => {
    const { repository } = await setupEdit([editShift('duty-1', '2026-07-24')])
    await expect(
      repository.cancelDutyShift('duty-1', { reason: 'x' }, VIEWER),
    ).rejects.toThrow(RepositoryPermissionError)
    await expect(
      repository.cancelDutyShift('duty-1', { reason: '   ' }, PLANNER),
    ).rejects.toMatchObject({ errorCode: 'REASON_REQUIRED' })
  })

  it('отменяет смену с причиной; смена ОСТАЁТСЯ в данных', async () => {
    const { repository } = await setupEdit([editShift('duty-1', '2026-07-24')])
    const cancelled = await repository.cancelDutyShift(
      'duty-1',
      { reason: '  Объект снят с охраны  ' },
      PLANNER,
    )
    expect(cancelled.stateCode).toBe('CANCELLED')
    expect(cancelled.cancellation).toMatchObject({ reason: 'Объект снят с охраны' })

    const listed = await repository.listShifts(VIEWER)
    expect(listed.results.map((shift) => shift.id)).toContain('duty-1')
  })

  it('повторная отмена и отмена начатой смены отклоняются', async () => {
    const { repository } = await setupEdit([
      editShift('duty-1', '2026-07-24'),
      editShift('duty-2', '2026-07-25', { id: 'duty-2', stateCode: 'ACTIVE' }),
    ])
    await repository.cancelDutyShift('duty-1', { reason: 'Причина' }, PLANNER)
    await expect(
      repository.cancelDutyShift('duty-1', { reason: 'Ещё раз' }, PLANNER),
    ).rejects.toMatchObject({ errorCode: 'INVALID_STATE_TRANSITION' })
    await expect(
      repository.cancelDutyShift('duty-2', { reason: 'Причина' }, PLANNER),
    ).rejects.toMatchObject({ errorCode: 'INVALID_STATE_TRANSITION' })
  })

  it('отменённая смена ОСВОБОЖДАЕТ сотрудника: на её место можно поставить другую', async () => {
    const { repository } = await setupEdit([editShift('duty-1', '2026-07-24')])
    // До отмены — пересечение.
    await expect(
      repository.createDutyShift(
        {
          businessDate: '2026-07-24',
          dutyTypeCode: 'OWN_OBJECT_DAILY',
          objectId: EDIT_OBJECT.id,
          sectorId: 'sector-a',
          postId: 'post-2',
          employeeName: 'Ахметов Б.',
          note: null,
        },
        PLANNER,
      ),
    ).rejects.toMatchObject({ errorCode: 'DUTY_CONFLICT_HARD' })

    await repository.cancelDutyShift('duty-1', { reason: 'Объект снят с охраны' }, PLANNER)

    const created = await repository.createDutyShift(
      {
        businessDate: '2026-07-24',
        dutyTypeCode: 'OWN_OBJECT_DAILY',
        objectId: EDIT_OBJECT.id,
        sectorId: 'sector-a',
        postId: 'post-2',
        employeeName: 'Ахметов Б.',
        note: null,
      },
      PLANNER,
    )
    expect(created.employeeName).toBe('Ахметов Б.')
  })

  it('отменённая смена выбывает из KPI месяца, но строка объекта остаётся', async () => {
    const { repository } = await setupEdit([
      editShift('duty-1', '2026-07-24'),
      editShift('duty-2', '2026-07-26', { id: 'duty-2', employeeName: 'Оразов К.' }),
    ])
    await repository.cancelDutyShift('duty-1', { reason: 'Объект снят с охраны' }, PLANNER)
    const plan = await repository.getMonthlyPlan('2026-07', VIEWER)
    expect(plan.kpi).toMatchObject({ shifts: 1, cancelled: 1 })
    expect(plan.rows).toHaveLength(1)
    const day24 = plan.rows[0].cells.find((cell) => cell.date === '2026-07-24')
    expect(day24).toMatchObject({ shiftCount: 0, cancelledCount: 1 })
  })

  it('карточка отменённой смены несёт причину отмены', async () => {
    const { repository } = await setupEdit([editShift('duty-1', '2026-07-24')])
    await repository.cancelDutyShift('duty-1', { reason: 'Объект снят с охраны' }, PLANNER)
    const detail = await repository.getShiftDetail('duty-1', VIEWER)
    expect(detail.shift.stateCode).toBe('CANCELLED')
    expect(detail.shift.cancellation?.reason).toBe('Объект снят с охраны')
    expect(detail.conflicts).toEqual([])
  })
})

// §21.30 «Список дежурств» и «История» (Этап 36). Ключевое: «прошедшее»
// определяет СЕРВЕР по DemoClock, а не фронт по часам машины, и история
// требует ОБА признака — завершённый факт И прошедшую дату.
describe('createDutiesRepository — список дежурств и история (§21.30)', () => {
  beforeEach(() => {
    registerRbacDirectory([
      { userId: VIEWER, permissions: ['ops.duty.view'] },
      { userId: NOBODY, permissions: [] },
    ])
  })

  const LIST_TYPES = [
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
  ]

  function listShiftFixture(
    id: string,
    businessDate: string,
    overrides: Partial<DutyShift> = {},
  ): DutyShift {
    return {
      id,
      businessDate,
      dutyTypeCode: 'OWN_OBJECT_DAILY',
      target: { targetType: 'OWN_OBJECT', objectId: 'object-1', safeLabel: 'Штаб управления' },
      employeeName: 'Ахметов Б.',
      stateCode: 'PLANNED',
      acknowledgedAt: null,
      actualStart: null,
      actualEnd: null,
      updatedAt: `${businessDate}T08:00:00+05:00`,
      passportBinding: null,
      note: null,
      cancellation: null,
      overrideReason: null,
      employeeId: null,
      unitId: null,
      ...overrides,
    }
  }

  async function setupList(shifts: DutyShift[]) {
    const envelope = seedEnvelope([])
    const adapter = createMemoryPersistence()
    await adapter.reset({
      ...envelope,
      slices: {
        ...envelope.slices,
        duties: { ...(envelope.slices.duties as object), shifts, dutyTypes: LIST_TYPES },
      },
    })
    // Бизнес-дата сценария — 2026-07-24.
    return createDutiesRepository(adapter, new DemoClock('2026-07-24T09:00:00+05:00'))
  }

  it('listShiftList() без ops.duty.view кидает RepositoryPermissionError', async () => {
    const repository = await setupList([])
    await expect(repository.listShiftList('ALL', NOBODY)).rejects.toThrow(
      RepositoryPermissionError,
    )
  })

  it('ALL: все смены по возрастанию даты, с подписью вида и серверными конфликтами', async () => {
    const repository = await setupList([
      listShiftFixture('duty-2', '2026-07-25'),
      listShiftFixture('duty-1', '2026-07-24'),
    ])
    const response = await repository.listShiftList('ALL', VIEWER)
    expect(response.results.map((row) => row.id)).toEqual(['duty-1', 'duty-2'])
    expect(response.results[0].dutyTypeLabel).toBe('Суточное дежурство на собственном объекте')
    // Две смены подряд у одного сотрудника — нарушение отдыха. Severity берётся
    // из ДЕЙСТВУЮЩЕЙ политики конфликтов (сид: SOFT_OVERRIDE), а не из вида
    // дежурства; счётчик считает СЕРВЕР.
    expect(response.results[1].softConflictCount).toBe(1)
    expect(response.results[1].hardConflictCount).toBe(0)
    // §35: невыводимые колонки названы с причиной.
    expect(response.unavailableColumns.map((column) => column.code)).toContain('TIME_INTERVAL')
    expect(response.unavailableColumns.every((column) => column.reason.length > 0)).toBe(true)
  })

  it('бизнес-дата приходит В ОТВЕТЕ — экран не берёт её из часов машины', async () => {
    const repository = await setupList([])
    expect((await repository.listShiftList('ALL', VIEWER)).businessDate).toBe('2026-07-24')
  })

  it('HISTORY: только ЗАВЕРШЁННЫЕ смены ПРОШЕДШИХ дней, свежие первыми', async () => {
    const repository = await setupList([
      // прошедшая и завершённая — попадает
      listShiftFixture('past-done', '2026-07-20', {
        stateCode: 'COMPLETED',
        actualEnd: '2026-07-21T08:00:00+05:00',
      }),
      listShiftFixture('past-done-2', '2026-07-22', {
        stateCode: 'COMPLETED',
        actualEnd: '2026-07-23T08:00:00+05:00',
        employeeName: 'Оразов К.',
      }),
      // прошедшая, но НЕ завершённая — факта нет
      listShiftFixture('past-active', '2026-07-21', {
        stateCode: 'ACTIVE',
        employeeName: 'Сагинова А.',
      }),
      // завершённая СЕГОДНЯ — ещё не прошедшее
      listShiftFixture('today-done', '2026-07-24', {
        stateCode: 'COMPLETED',
        actualEnd: '2026-07-24T08:00:00+05:00',
        employeeName: 'Нурланов Е.',
      }),
      // будущая
      listShiftFixture('future', '2026-07-30', { employeeName: 'Жумабаев Р.' }),
    ])
    const response = await repository.listShiftList('HISTORY', VIEWER)
    expect(response.results.map((row) => row.id)).toEqual(['past-done-2', 'past-done'])
    expect(response.scope).toBe('HISTORY')
  })

  it('отменённая смена видна в списке с причиной, но в историю не попадает', async () => {
    const repository = await setupList([
      listShiftFixture('cancelled', '2026-07-20', {
        stateCode: 'CANCELLED',
        cancellation: { reason: 'Объект снят с охраны', cancelledAt: '2026-07-19T10:00:00+05:00' },
      }),
    ])
    const all = await repository.listShiftList('ALL', VIEWER)
    expect(all.results[0]).toMatchObject({
      stateCode: 'CANCELLED',
      cancellationReason: 'Объект снят с охраны',
    })
    expect((await repository.listShiftList('HISTORY', VIEWER)).results).toEqual([])
  })

  it('отсутствие привязки к паспорту приходит как null, а не пустой строкой', async () => {
    const repository = await setupList([
      listShiftFixture('unbound', '2026-07-24'),
      listShiftFixture('bound', '2026-07-26', {
        employeeName: 'Оразов К.',
        passportBinding: {
          objectId: 'object-1',
          objectName: 'Штаб управления',
          versionId: 'v1',
          versionNumber: 1,
          effectiveFrom: '2026-01-01',
          sectorId: 'sector-a',
          sectorName: 'Сектор A',
          postId: 'post-1',
          postName: 'КПП-1',
          boundAt: '2026-07-24T08:00:00+05:00',
        },
      }),
    ])
    const response = await repository.listShiftList('ALL', VIEWER)
    expect(response.results.find((row) => row.id === 'unbound')?.postLabel).toBeNull()
    expect(response.results.find((row) => row.id === 'bound')?.postLabel).toBe('Сектор A · КПП-1')
  })

  it('список — чтение: вызов не поднимает ревизию состояния', async () => {
    const envelope = seedEnvelope([])
    const adapter = createMemoryPersistence()
    await adapter.reset(envelope)
    const repository = createDutiesRepository(adapter, new DemoClock('2026-07-24T09:00:00+05:00'))
    const before = (await adapter.load())?.revision
    await repository.listShiftList('ALL', VIEWER)
    expect((await adapter.load())?.revision).toBe(before)
  })
})

// §21.27 lifecycle месячного плана + §21.28 action policy шапки. Ключевое, что
// здесь проверяется: `VALIDATED` НЕ становится состоянием сущности, утверждение
// закрывает месяц для ПЛАНИРУЮЩИХ мутаций (и только для них), а изменения после
// утверждения возможны только через новую редакцию.
describe('createDutiesRepository — lifecycle месячного плана (§21.27/§21.28)', () => {
  const APPROVER = 'approver-user'

  beforeEach(() => {
    registerRbacDirectory([
      { userId: VIEWER, permissions: ['ops.duty.view'] },
      { userId: PLANNER, permissions: ['ops.duty.view', 'ops.duty.manage'] },
      { userId: APPROVER, permissions: ['ops.duty.view', 'ops.duty.approve_plan'] },
      {
        userId: 'both-user',
        permissions: ['ops.duty.view', 'ops.duty.manage', 'ops.duty.approve_plan'],
      },
      { userId: NOBODY, permissions: [] },
    ])
  })
  const BOTH = 'both-user'

  const LIFECYCLE_OBJECT = {
    id: 'object-life',
    name: 'Дворец Независимости',
    code: 'OBJ-001',
    passportState: 'GREEN',
    passportVersions: [
      {
        id: 'life-v1',
        versionNumber: 1,
        effectiveFrom: '2026-01-01',
        sectors: [
          {
            id: 'sector-a',
            name: 'Сектор A',
            posts: [
              { id: 'post-1', name: 'КПП-1', task: 'Контроль', requirements: 'Допуск A' },
              { id: 'post-2', name: 'Пост 2', task: 'Периметр', requirements: 'Допуск A' },
            ],
          },
        ],
      },
    ],
  }

  const LIFECYCLE_DUTY_TYPES = [
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
  ]

  function lifecycleShift(
    id: string,
    businessDate: string,
    overrides: Partial<DutyShift> = {},
  ): DutyShift {
    return {
      id,
      businessDate,
      dutyTypeCode: 'OWN_OBJECT_DAILY',
      target: {
        targetType: 'OWN_OBJECT',
        objectId: LIFECYCLE_OBJECT.id,
        safeLabel: LIFECYCLE_OBJECT.name,
      },
      employeeName: 'Ахметов Б.',
      stateCode: 'PLANNED',
      acknowledgedAt: null,
      actualStart: null,
      actualEnd: null,
      updatedAt: `${businessDate}T08:00:00+05:00`,
      passportBinding: {
        objectId: LIFECYCLE_OBJECT.id,
        objectName: LIFECYCLE_OBJECT.name,
        versionId: 'life-v1',
        versionNumber: 1,
        effectiveFrom: '2026-01-01',
        sectorId: 'sector-a',
        sectorName: 'Сектор A',
        postId: 'post-1',
        postName: 'КПП-1',
        boundAt: '2026-07-24T08:00:00+05:00',
      },
      note: null,
      cancellation: null,
      overrideReason: null,
      employeeId: null,
      unitId: null,
      ...overrides,
    }
  }

  async function setupLifecycle(shifts: DutyShift[]) {
    const envelope = seedEnvelope([])
    const adapter = createMemoryPersistence()
    await adapter.reset({
      ...envelope,
      slices: {
        ...envelope.slices,
        objects: { objects: [LIFECYCLE_OBJECT] },
        duties: {
          ...(envelope.slices.duties as object),
          shifts,
          dutyTypes: LIFECYCLE_DUTY_TYPES,
        },
      },
    })
    return {
      repository: createDutiesRepository(adapter, new DemoClock('2026-07-26T09:00:00+05:00')),
      adapter,
    }
  }

  /** Доводит месяц до утверждённого состояния целиком через публичные операции. */
  async function approveMonth(
    repository: ReturnType<typeof createDutiesRepository>,
    month = '2026-07',
  ) {
    await repository.createPlanDraft({ month }, PLANNER)
    await repository.checkPlanConflicts({ month }, PLANNER)
    return repository.approvePlan({ month }, APPROVER)
  }

  describe('права', () => {
    it('черновик и проверка требуют ops.duty.manage', async () => {
      const { repository } = await setupLifecycle([])
      await expect(repository.createPlanDraft({ month: '2026-07' }, VIEWER)).rejects.toThrow(
        RepositoryPermissionError,
      )
      await repository.createPlanDraft({ month: '2026-07' }, PLANNER)
      await expect(repository.checkPlanConflicts({ month: '2026-07' }, VIEWER)).rejects.toThrow(
        RepositoryPermissionError,
      )
    })

    it('утверждение НЕ даётся правом планирования: нужно ops.duty.approve_plan', async () => {
      const { repository } = await setupLifecycle([])
      await repository.createPlanDraft({ month: '2026-07' }, PLANNER)
      await repository.checkPlanConflicts({ month: '2026-07' }, PLANNER)
      await expect(repository.approvePlan({ month: '2026-07' }, PLANNER)).rejects.toThrow(
        RepositoryPermissionError,
      )
      await expect(repository.approvePlan({ month: '2026-07' }, APPROVER)).resolves.toMatchObject({
        stateCode: 'APPROVED',
      })
    })

    it('новую редакцию открывает тот же, кто утверждает, а не планировщик', async () => {
      const { repository } = await setupLifecycle([])
      await approveMonth(repository)
      await expect(repository.reopenPlan({ month: '2026-07' }, PLANNER)).rejects.toThrow(
        RepositoryPermissionError,
      )
      await expect(repository.reopenPlan({ month: '2026-07' }, APPROVER)).resolves.toMatchObject({
        stateCode: 'DRAFT',
      })
    })
  })

  describe('состояния и проверка', () => {
    it('месяца без черновика не существует: план приходит null, а не пустым DRAFT', async () => {
      const { repository } = await setupLifecycle([lifecycleShift('duty-1', '2026-07-10')])
      const plan = await repository.getMonthlyPlan('2026-07', VIEWER)
      expect(plan.header.record).toBeNull()
    })

    it('повторный черновик на тот же месяц — бизнес-ошибка, а не второй план', async () => {
      const { repository } = await setupLifecycle([])
      await repository.createPlanDraft({ month: '2026-07' }, PLANNER)
      await expect(repository.createPlanDraft({ month: '2026-07' }, PLANNER)).rejects.toMatchObject(
        { errorCode: 'PLAN_ALREADY_EXISTS' },
      )
    })

    it('проверка НЕ меняет состояние плана: VALIDATED — результат, а не состояние (§21.27)', async () => {
      const { repository } = await setupLifecycle([lifecycleShift('duty-1', '2026-07-10')])
      await repository.createPlanDraft({ month: '2026-07' }, PLANNER)
      const checked = await repository.checkPlanConflicts({ month: '2026-07' }, PLANNER)
      expect(checked.stateCode).toBe('DRAFT')
      expect(checked.lastValidation).toMatchObject({ passed: true, hardConflicts: 0 })
      // Проверка попадает в ИСТОРИЮ как событие, но ни одно состояние плана за
      // весь конвейер не называется VALIDATED — §21.27 «VALIDATED может быть
      // результатом проверки, а не состоянием сущности».
      const approved = await repository.approvePlan({ month: '2026-07' }, APPROVER)
      expect(approved.history.map((entry) => entry.event)).toEqual([
        'DRAFT_CREATED',
        'VALIDATED',
        'APPROVED',
      ])
      const states = [checked.stateCode, approved.stateCode]
      expect(states).toEqual(['DRAFT', 'APPROVED'])
      expect(states).not.toContain('VALIDATED')
    })

    it('жёсткий конфликт валит проверку и закрывает утверждение', async () => {
      const { repository } = await setupLifecycle([
        lifecycleShift('duty-1', '2026-07-10'),
        lifecycleShift('duty-2', '2026-07-10', { id: 'duty-2' }),
      ])
      await repository.createPlanDraft({ month: '2026-07' }, PLANNER)
      const checked = await repository.checkPlanConflicts({ month: '2026-07' }, PLANNER)
      expect(checked.lastValidation).toMatchObject({ passed: false, hardConflicts: 1 })
      await expect(repository.approvePlan({ month: '2026-07' }, APPROVER)).rejects.toMatchObject({
        errorCode: 'PLAN_HAS_HARD_CONFLICTS',
      })
    })

    it('утверждение без проверки отклоняется', async () => {
      const { repository } = await setupLifecycle([])
      await repository.createPlanDraft({ month: '2026-07' }, PLANNER)
      await expect(repository.approvePlan({ month: '2026-07' }, APPROVER)).rejects.toMatchObject({
        errorCode: 'PLAN_NOT_VALIDATED',
      })
    })

    it('проверка обесценивается ЛЮБОЙ правкой состава месяца', async () => {
      const { repository } = await setupLifecycle([lifecycleShift('duty-1', '2026-07-10')])
      await repository.createPlanDraft({ month: '2026-07' }, PLANNER)
      await repository.checkPlanConflicts({ month: '2026-07' }, PLANNER)
      // Правка существующей смены — не появление новой: отпечаток обязан
      // измениться и от неё тоже.
      await repository.updateDutyShift(
        'duty-1',
        { employeeName: 'Ахметов Б.', sectorId: 'sector-a', postId: 'post-2', note: null },
        PLANNER,
      )
      await expect(repository.approvePlan({ month: '2026-07' }, APPROVER)).rejects.toMatchObject({
        errorCode: 'PLAN_VALIDATION_STALE',
      })
      // Повторная проверка снимает блокировку.
      await repository.checkPlanConflicts({ month: '2026-07' }, PLANNER)
      await expect(repository.approvePlan({ month: '2026-07' }, APPROVER)).resolves.toMatchObject({
        stateCode: 'APPROVED',
      })
    })

    it('смена соседнего месяца проверку НЕ обесценивает', async () => {
      const { repository } = await setupLifecycle([lifecycleShift('duty-1', '2026-07-10')])
      await repository.createPlanDraft({ month: '2026-07' }, PLANNER)
      await repository.checkPlanConflicts({ month: '2026-07' }, PLANNER)
      await repository.createDutyShift(
        {
          businessDate: '2026-08-05',
          dutyTypeCode: 'OWN_OBJECT_DAILY',
          objectId: LIFECYCLE_OBJECT.id,
          sectorId: 'sector-a',
          postId: 'post-1',
          employeeName: 'Ахметов Б.',
          note: null,
        },
        PLANNER,
      )
      await expect(repository.approvePlan({ month: '2026-07' }, APPROVER)).resolves.toMatchObject({
        stateCode: 'APPROVED',
      })
    })
  })

  describe('фиксация утверждённого месяца (§21.27 «изменения через новую revision»)', () => {
    it('заводить, править и отменять дежурства утверждённого месяца нельзя', async () => {
      const { repository } = await setupLifecycle([lifecycleShift('duty-1', '2026-07-10')])
      await approveMonth(repository)

      await expect(
        repository.createDutyShift(
          {
            businessDate: '2026-07-20',
            dutyTypeCode: 'OWN_OBJECT_DAILY',
            objectId: LIFECYCLE_OBJECT.id,
            sectorId: 'sector-a',
            postId: 'post-1',
            employeeName: 'Сериков Н.',
            note: null,
          },
          PLANNER,
        ),
      ).rejects.toMatchObject({ errorCode: 'PLAN_APPROVED_LOCKED' })
      await expect(
        repository.updateDutyShift(
          'duty-1',
          { employeeName: 'Ахметов Б.', sectorId: 'sector-a', postId: 'post-2', note: null },
          PLANNER,
        ),
      ).rejects.toMatchObject({ errorCode: 'PLAN_APPROVED_LOCKED' })
      await expect(
        repository.cancelDutyShift('duty-1', { reason: 'Изменился график' }, PLANNER),
      ).rejects.toMatchObject({ errorCode: 'PLAN_APPROVED_LOCKED' })
    })

    it('ознакомление и заступление ОСТАЮТСЯ доступны: это факт, а не изменение плана', async () => {
      const { repository } = await setupLifecycle([lifecycleShift('duty-1', '2026-07-10')])
      await approveMonth(repository)
      await expect(repository.acknowledge('duty-1', PLANNER)).resolves.toMatchObject({
        stateCode: 'ACKNOWLEDGED',
      })
      await expect(repository.clockIn('duty-1', PLANNER)).resolves.toMatchObject({
        stateCode: 'ACTIVE',
      })
    })

    it('соседний месяц утверждением НЕ закрывается', async () => {
      const { repository } = await setupLifecycle([lifecycleShift('duty-1', '2026-07-10')])
      await approveMonth(repository)
      await expect(
        repository.createDutyShift(
          {
            businessDate: '2026-08-05',
            dutyTypeCode: 'OWN_OBJECT_DAILY',
            objectId: LIFECYCLE_OBJECT.id,
            sectorId: 'sector-a',
            postId: 'post-1',
            employeeName: 'Сериков Н.',
            note: null,
          },
          PLANNER,
        ),
      ).resolves.toMatchObject({ businessDate: '2026-08-05' })
    })

    it('проверка конфликтов утверждённого месяца отклоняется', async () => {
      const { repository } = await setupLifecycle([])
      await approveMonth(repository)
      await expect(
        repository.checkPlanConflicts({ month: '2026-07' }, PLANNER),
      ).rejects.toMatchObject({ errorCode: 'PLAN_APPROVED_LOCKED' })
    })

    it('новая редакция поднимает номер, снимает утверждение и сбрасывает проверку', async () => {
      const { repository } = await setupLifecycle([lifecycleShift('duty-1', '2026-07-10')])
      const approved = await approveMonth(repository)
      expect(approved).toMatchObject({ revision: 1, approvedBy: APPROVER })
      const reopened = await repository.reopenPlan({ month: '2026-07' }, APPROVER)
      expect(reopened).toMatchObject({
        stateCode: 'DRAFT',
        revision: 2,
        approvedAt: null,
        approvedBy: null,
        // Проверка относилась к прошлой редакции — новая ещё не проверялась.
        lastValidation: null,
      })
      // И месяц снова открыт для планирования.
      await expect(
        repository.cancelDutyShift('duty-1', { reason: 'Изменился график' }, PLANNER),
      ).resolves.toMatchObject({ stateCode: 'CANCELLED' })
    })

    it('история только дополняется: прежнее утверждение остаётся после переоткрытия', async () => {
      const { repository } = await setupLifecycle([])
      await approveMonth(repository)
      const reopened = await repository.reopenPlan({ month: '2026-07' }, APPROVER)
      expect(reopened.history.map((entry) => entry.event)).toEqual([
        'DRAFT_CREATED',
        'VALIDATED',
        'APPROVED',
        'REOPENED',
      ])
      // Событие утверждения помнит СВОЮ редакцию, а не текущую.
      expect(reopened.history[2]).toMatchObject({ event: 'APPROVED', revision: 1 })
      expect(reopened.history[3]).toMatchObject({ event: 'REOPENED', revision: 2 })
    })

    it('повторное утверждение уже утверждённого плана отклоняется', async () => {
      const { repository } = await setupLifecycle([])
      await approveMonth(repository)
      await expect(repository.approvePlan({ month: '2026-07' }, APPROVER)).rejects.toMatchObject({
        errorCode: 'PLAN_ALREADY_APPROVED',
      })
    })

    it('операции над несформированным планом дают 404, а не создают его молча', async () => {
      const { repository } = await setupLifecycle([])
      await expect(repository.checkPlanConflicts({ month: '2026-07' }, PLANNER)).rejects.toThrow(
        RepositoryNotFoundError,
      )
      await expect(repository.approvePlan({ month: '2026-07' }, APPROVER)).rejects.toThrow(
        RepositoryNotFoundError,
      )
      expect((await repository.getMonthlyPlan('2026-07', VIEWER)).header.record).toBeNull()
    })

    it('месяц вне формата YYYY-MM отклоняется всеми действиями lifecycle', async () => {
      const { repository } = await setupLifecycle([])
      for (const call of [
        () => repository.createPlanDraft({ month: '2026-13' }, PLANNER),
        () => repository.checkPlanConflicts({ month: '' }, PLANNER),
        () => repository.approvePlan({ month: '2026-7' }, APPROVER),
        () => repository.reopenPlan({ month: 'июль' }, APPROVER),
      ]) {
        await expect(call()).rejects.toMatchObject({ errorCode: 'INVALID_MONTH' })
      }
    })
  })

  describe('шапка плана (§21.28)', () => {
    it('доступность действий приходит В ОТВЕТЕ и зависит от прав актора', async () => {
      const { repository } = await setupLifecycle([lifecycleShift('duty-1', '2026-07-10')])
      const asViewer = await repository.getMonthlyPlan('2026-07', VIEWER)
      expect(asViewer.header.actions.every((action) => !action.enabled)).toBe(true)

      const asPlanner = await repository.getMonthlyPlan('2026-07', PLANNER)
      expect(
        asPlanner.header.actions
          .filter((action) => action.enabled)
          .map((action) => action.code),
      ).toEqual(['CREATE_DRAFT', 'ADD_SHIFT'])
    })

    it('после утверждения шапка оставляет доступной только новую редакцию', async () => {
      const { repository } = await setupLifecycle([lifecycleShift('duty-1', '2026-07-10')])
      await approveMonth(repository)
      const header = (await repository.getMonthlyPlan('2026-07', BOTH)).header
      expect(header.record).toMatchObject({ stateCode: 'APPROVED', revision: 1 })
      expect(header.actions.filter((action) => action.enabled).map((action) => action.code)).toEqual(
        ['REOPEN'],
      )
    })

    it('источник объектов различает объекты реестра и объекты вне его', async () => {
      const { repository } = await setupLifecycle([
        lifecycleShift('duty-1', '2026-07-10'),
        lifecycleShift('duty-2', '2026-07-11', {
          id: 'duty-2',
          target: { targetType: 'OWN_OBJECT', objectId: 'object-ghost', safeLabel: 'Штаб' },
        }),
      ])
      const header = (await repository.getMonthlyPlan('2026-07', VIEWER)).header
      expect(header.objectSource).toMatchObject({ knownObjects: 1, unknownObjects: 1 })
    })

    it('невыводимые поля шапки и эффекты утверждения приходят С ПРИЧИНОЙ (§35)', async () => {
      const { repository } = await setupLifecycle([])
      const header = (await repository.getMonthlyPlan('2026-07', VIEWER)).header
      expect(header.unavailableFields.map((field) => field.code)).toEqual([
        'USER_SCOPE',
        'AVAILABILITY_STATE',
      ])
      expect(
        [...header.unavailableFields, ...header.unavailableApprovalEffects].every(
          (item) => item.reason.trim() !== '',
        ),
      ).toBe(true)
    })

    it('чтение плана с шапкой не поднимает ревизию состояния', async () => {
      const { repository, adapter } = await setupLifecycle([])
      const before = (await adapter.load())?.revision
      await repository.getMonthlyPlan('2026-07', BOTH)
      expect((await adapter.load())?.revision).toBe(before)
    })
  })
})

describe('устойчивый ID сотрудника на смене (§22.9)', () => {
  beforeEach(() => {
    registerRbacDirectory([
      { userId: VIEWER, permissions: ['ops.duty.view'] },
      { userId: PLANNER, permissions: ['ops.duty.view', 'ops.duty.manage'] },
    ])
  })

  const DUTY_TYPES_LOCAL = [
    {
      dutyTypeCode: 'OWN_OBJECT_DAILY',
      safeLabel: 'Суточное дежурство на собственном объекте',
      targetType: 'OWN_OBJECT' as const,
      defaultDurationMinutes: 1440,
      requiresSenior: true,
      restAfterMinutes: 1440,
      requiresCurrentPassport: false,
    },
  ]
  const OBJECT = {
    id: 'link-object-1',
    name: 'Штаб связи',
    code: 'OBJ-L1',
    passportState: 'GREEN',
    passportVersions: [
      {
        id: 'link-object-1-v1',
        versionNumber: 1,
        effectiveFrom: '2026-07-01',
        sectors: [
          {
            id: 'sector-a',
            name: 'Сектор A',
            posts: [{ id: 'post-1', name: 'Пост 1', task: '', requirements: '' }],
          },
        ],
      },
    ],
  }

  async function setupLink() {
    const envelope = seedEnvelope([])
    const adapter = createMemoryPersistence()
    await adapter.reset({
      ...envelope,
      slices: {
        ...envelope.slices,
        objects: { objects: [OBJECT] },
        duties: {
          ...(envelope.slices.duties as object),
          shifts: [],
          dutyTypes: DUTY_TYPES_LOCAL,
          dutyCandidates: [
            {
              employeeId: 'employee-1',
              employeeName: 'Ерланов Д.',
              unitId: 'unit-guard-1',
              unitName: '1-й отдел охраны',
              positionName: 'Инспектор',
            },
          ],
        },
      },
    })
    return {
      repository: createDutiesRepository(adapter, new DemoClock('2026-07-24T09:00:00+05:00')),
      adapter,
    }
  }

  const REQUEST = {
    businessDate: '2026-07-24',
    dutyTypeCode: 'OWN_OBJECT_DAILY',
    objectId: 'link-object-1',
    sectorId: 'sector-a',
    postId: 'post-1',
    note: null,
  }

  it('создание смены сохраняет employeeId и unitId из справочника — проверено из БД', async () => {
    const { repository, adapter } = await setupLink()
    const created = await repository.createDutyShift(
      { ...REQUEST, employeeName: 'Ерланов Д.' },
      PLANNER,
    )
    expect(created.employeeId).toBe('employee-1')
    expect(created.unitId).toBe('unit-guard-1')
    const envelope = await adapter.load()
    const stored = (envelope?.slices.duties as { shifts: DutyShift[] }).shifts.find(
      (shift) => shift.id === created.id,
    )
    expect(stored?.employeeId).toBe('employee-1')
    expect(stored?.unitId).toBe('unit-guard-1')
  })

  it('имя вне справочника — связь null, а не отказ и не пустая строка', async () => {
    const { repository } = await setupLink()
    const created = await repository.createDutyShift(
      { ...REQUEST, employeeName: 'Внешний Сотрудник' },
      PLANNER,
    )
    expect(created.employeeId).toBeNull()
    expect(created.unitId).toBeNull()
  })

  it('кандидаты наружу несут employeeId и unitId', async () => {
    const { repository } = await setupLink()
    const response = await repository.listDutyCandidates('2026-07-24', VIEWER)
    expect(response.results[0]?.employeeId).toBe('employee-1')
    expect(response.results[0]?.unitId).toBe('unit-guard-1')
  })
})
