// Feature repository (§8.5): server-like validation, permission/scope,
// атомарная мутация. Упрощённый процесс §24.1 (см. model/types.ts шапку) —
// PLANNED→ACKNOWLEDGED→ACTIVE→COMPLETED, без потребности/подачи/утверждения.
import type { DemoClock } from '../../../shared/testing/mock-runtime/demo-clock'
import { hasPermission } from '../../../shared/testing/mock-runtime/rbac-directory'
import type {
  DemoStateEnvelope,
  PersistenceAdapter,
} from '../../../shared/testing/mock-runtime/persistence'
import { runMutation } from '../../../shared/testing/mock-runtime/transaction'
import type {
  ListCombatDutyShiftsResponse,
  ListCombatDutyTypesResponse,
  ListCombatRosterCandidatesResponse,
  ListDutyRoutesResponse,
  ListDutyShiftsResponse,
  ListDutyTypesResponse,
  ReviewCombatGroupRequest,
  SubmitCombatGroupRequest,
} from '../api/pending-contracts'
import type { CombatDutyShift, DutyShift } from '../model/types'
import type { DutiesSlice } from './fixtures'

export class RepositoryPermissionError extends Error {}
export class RepositoryNotFoundError extends Error {}
export class RepositoryBusinessRuleError extends Error {
  readonly errorCode: string
  constructor(errorCode: string, message: string) {
    super(message)
    this.errorCode = errorCode
  }
}

const SLICE_NAME = 'duties'
const VIEW_PERMISSION = 'ops.duty.view'
const MANAGE_PERMISSION = 'ops.duty.manage'
const COMBAT_SUBMIT_PERMISSION = 'ops.combat_group.submit'
const COMBAT_REVIEW_PERMISSION = 'ops.combat_group.review'

function readSlice(envelope: DemoStateEnvelope): DutiesSlice {
  const slice = envelope.slices[SLICE_NAME]
  if (slice === undefined) {
    throw new Error(
      `mock-runtime: слайс "${SLICE_NAME}" не засеян — проверь app/mocks/compose-seed.ts`,
    )
  }
  return slice as DutiesSlice
}

export function createDutiesRepository(adapter: PersistenceAdapter, clock: DemoClock) {
  async function listDutyTypes(actorUserId: string | null): Promise<ListDutyTypesResponse> {
    if (!hasPermission(actorUserId, VIEW_PERMISSION)) {
      throw new RepositoryPermissionError(VIEW_PERMISSION)
    }
    const envelope = await adapter.load()
    const dutyTypes = envelope === null ? [] : readSlice(envelope).dutyTypes
    return { results: dutyTypes }
  }

  async function listShifts(actorUserId: string | null): Promise<ListDutyShiftsResponse> {
    if (!hasPermission(actorUserId, VIEW_PERMISSION)) {
      throw new RepositoryPermissionError(VIEW_PERMISSION)
    }
    const envelope = await adapter.load()
    const shifts = envelope === null ? [] : readSlice(envelope).shifts
    const sorted = [...shifts].sort(
      (a, b) => a.businessDate.localeCompare(b.businessDate) || a.id.localeCompare(b.id),
    )
    return { results: sorted }
  }

  async function transitionShift(
    id: string,
    actorUserId: string | null,
    expectedState: DutyShift['stateCode'],
    nextState: DutyShift['stateCode'],
    patch: Partial<DutyShift>,
    errorMessage: string,
  ): Promise<DutyShift> {
    if (!hasPermission(actorUserId, MANAGE_PERMISSION)) {
      throw new RepositoryPermissionError(MANAGE_PERMISSION)
    }
    let updated!: DutyShift
    await runMutation(adapter, clock, (current) => {
      const slice = readSlice(current)
      const existing = slice.shifts.find((s) => s.id === id)
      if (existing === undefined) {
        throw new RepositoryNotFoundError(id)
      }
      if (existing.stateCode !== expectedState) {
        throw new RepositoryBusinessRuleError('INVALID_STATE_TRANSITION', errorMessage)
      }
      updated = { ...existing, ...patch, stateCode: nextState, updatedAt: clock.now() }
      return {
        ...current.slices,
        [SLICE_NAME]: {
          ...slice,
          shifts: slice.shifts.map((s) => (s.id === id ? updated : s)),
        } satisfies DutiesSlice,
      }
    })
    return updated
  }

  function acknowledge(id: string, actorUserId: string | null): Promise<DutyShift> {
    return transitionShift(
      id,
      actorUserId,
      'PLANNED',
      'ACKNOWLEDGED',
      { acknowledgedAt: clock.now() },
      'Ознакомиться можно только с ещё не подтверждённым дежурством.',
    )
  }

  function clockIn(id: string, actorUserId: string | null): Promise<DutyShift> {
    return transitionShift(
      id,
      actorUserId,
      'ACKNOWLEDGED',
      'ACTIVE',
      { actualStart: clock.now() },
      'Заступить можно только после ознакомления.',
    )
  }

  function clockOut(id: string, actorUserId: string | null): Promise<DutyShift> {
    return transitionShift(
      id,
      actorUserId,
      'ACTIVE',
      'COMPLETED',
      { actualEnd: clock.now() },
      'Завершить можно только начатое дежурство.',
    )
  }

  async function listCombatDutyTypes(actorUserId: string | null): Promise<ListCombatDutyTypesResponse> {
    if (!hasPermission(actorUserId, VIEW_PERMISSION)) {
      throw new RepositoryPermissionError(VIEW_PERMISSION)
    }
    const envelope = await adapter.load()
    return { results: envelope === null ? [] : readSlice(envelope).combatDutyTypes }
  }

  async function listRoutes(actorUserId: string | null): Promise<ListDutyRoutesResponse> {
    if (!hasPermission(actorUserId, VIEW_PERMISSION)) {
      throw new RepositoryPermissionError(VIEW_PERMISSION)
    }
    const envelope = await adapter.load()
    return { results: envelope === null ? [] : readSlice(envelope).routes }
  }

  async function listRosterCandidates(
    actorUserId: string | null,
  ): Promise<ListCombatRosterCandidatesResponse> {
    // Просмотр кандидатов в состав — часть подачи (§24.6), не общего
    // просмотра дежурств: только тот, кто может подать, видит роспись людей.
    if (!hasPermission(actorUserId, COMBAT_SUBMIT_PERMISSION)) {
      throw new RepositoryPermissionError(COMBAT_SUBMIT_PERMISSION)
    }
    const envelope = await adapter.load()
    return { results: envelope === null ? [] : readSlice(envelope).rosterCandidates }
  }

  async function listCombatShifts(actorUserId: string | null): Promise<ListCombatDutyShiftsResponse> {
    if (!hasPermission(actorUserId, VIEW_PERMISSION)) {
      throw new RepositoryPermissionError(VIEW_PERMISSION)
    }
    const envelope = await adapter.load()
    const shifts = envelope === null ? [] : readSlice(envelope).combatShifts
    const sorted = [...shifts].sort(
      (a, b) => a.businessDate.localeCompare(b.businessDate) || a.id.localeCompare(b.id),
    )
    return { results: sorted }
  }

  async function submitCombatGroup(
    id: string,
    request: SubmitCombatGroupRequest,
    actorUserId: string | null,
  ): Promise<CombatDutyShift> {
    if (!hasPermission(actorUserId, COMBAT_SUBMIT_PERMISSION)) {
      throw new RepositoryPermissionError(COMBAT_SUBMIT_PERMISSION)
    }
    if (request.groupLeaderEmployeeName.trim() === '' || request.memberEmployeeNames.length === 0) {
      throw new RepositoryBusinessRuleError(
        'EMPTY_GROUP',
        'Укажите старшего группы и не менее одного участника.',
      )
    }
    let updated!: CombatDutyShift
    await runMutation(adapter, clock, (current) => {
      const slice = readSlice(current)
      const existing = slice.combatShifts.find((s) => s.id === id)
      if (existing === undefined) {
        throw new RepositoryNotFoundError(id)
      }
      if (existing.submission !== null && existing.submission.stateCode !== 'RETURNED') {
        throw new RepositoryBusinessRuleError(
          'ALREADY_SUBMITTED',
          'Состав уже подан и ожидает либо прошёл рассмотрение — повторная подача недоступна.',
        )
      }
      // §24.17 hard-rule (сокращённое подмножество): сотрудник не может быть
      // ПРИНЯТ одновременно в две боевые группы на одну и ту же смену.
      const proposedNames = new Set([
        request.groupLeaderEmployeeName,
        ...request.memberEmployeeNames,
        ...request.reserveEmployeeNames,
      ])
      const conflict = slice.combatShifts.find((s) => {
        if (s.id === id || s.businessDate !== existing.businessDate) return false
        if (s.submission === null || s.submission.stateCode !== 'ACCEPTED') return false
        const acceptedNames = [
          s.submission.groupLeaderEmployeeName,
          ...s.submission.memberEmployeeNames,
        ]
        return acceptedNames.some((name) => proposedNames.has(name))
      })
      if (conflict !== undefined) {
        throw new RepositoryBusinessRuleError(
          'DOUBLE_ASSIGNMENT',
          'Один или несколько сотрудников уже приняты в другую боевую группу на эту дату.',
        )
      }
      updated = {
        ...existing,
        submission: {
          submittedByUnitName: '2-е боевое управление',
          groupLeaderEmployeeName: request.groupLeaderEmployeeName,
          memberEmployeeNames: request.memberEmployeeNames,
          reserveEmployeeNames: request.reserveEmployeeNames,
          stateCode: 'SUBMITTED',
          returnReason: null,
          submittedAt: clock.now(),
          updatedAt: clock.now(),
        },
        updatedAt: clock.now(),
      }
      return {
        ...current.slices,
        [SLICE_NAME]: {
          ...slice,
          combatShifts: slice.combatShifts.map((s) => (s.id === id ? updated : s)),
        } satisfies DutiesSlice,
      }
    })
    return updated
  }

  async function reviewCombatGroup(
    id: string,
    request: ReviewCombatGroupRequest,
    actorUserId: string | null,
  ): Promise<CombatDutyShift> {
    if (!hasPermission(actorUserId, COMBAT_REVIEW_PERMISSION)) {
      throw new RepositoryPermissionError(COMBAT_REVIEW_PERMISSION)
    }
    if (request.decision === 'RETURN' && (request.returnReason ?? '').trim() === '') {
      throw new RepositoryBusinessRuleError('REASON_REQUIRED', 'Причина возврата обязательна.')
    }
    let updated!: CombatDutyShift
    await runMutation(adapter, clock, (current) => {
      const slice = readSlice(current)
      const existing = slice.combatShifts.find((s) => s.id === id)
      if (existing === undefined) {
        throw new RepositoryNotFoundError(id)
      }
      if (existing.submission === null || existing.submission.stateCode !== 'SUBMITTED') {
        throw new RepositoryBusinessRuleError(
          'INVALID_STATE_TRANSITION',
          'Рассмотреть можно только поданный и ещё не рассмотренный состав.',
        )
      }
      updated = {
        ...existing,
        submission: {
          ...existing.submission,
          stateCode: request.decision === 'ACCEPT' ? 'ACCEPTED' : 'RETURNED',
          returnReason: request.decision === 'RETURN' ? request.returnReason : null,
          updatedAt: clock.now(),
        },
        updatedAt: clock.now(),
      }
      return {
        ...current.slices,
        [SLICE_NAME]: {
          ...slice,
          combatShifts: slice.combatShifts.map((s) => (s.id === id ? updated : s)),
        } satisfies DutiesSlice,
      }
    })
    return updated
  }

  return {
    listDutyTypes,
    listShifts,
    acknowledge,
    clockIn,
    clockOut,
    listCombatDutyTypes,
    listRoutes,
    listRosterCandidates,
    listCombatShifts,
    submitCombatGroup,
    reviewCombatGroup,
  }
}
