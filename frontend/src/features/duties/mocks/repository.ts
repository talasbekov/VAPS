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
  CompleteCombatDutyRequest,
  CreateCombatDutyShiftRequest,
  ListCombatDutyShiftsResponse,
  ListCombatDutyTypesResponse,
  ListCombatRosterCandidatesResponse,
  ListDutyRoutesResponse,
  ListDutyShiftsResponse,
  ListDutyTypesResponse,
  RequestCombatDutyReplacementRequest,
  ReviewCombatGroupRequest,
  SubmitCombatGroupRequest,
} from '../api/pending-contracts'
import type { CombatDutyShift, DutyReplacementRecord, DutyShift } from '../model/types'
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
const COMBAT_ACKNOWLEDGE_PERMISSION = 'ops.combat_group.acknowledge'
const COMBAT_CHECKIN_PERMISSION = 'ops.combat_group.checkin'
const COMBAT_COMPLETE_PERMISSION = 'ops.combat_group.complete'
const COMBAT_REPLACE_PERMISSION = 'ops.combat_group.replace'

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

  // §24.1 «формирование потребности на период» — заводит новую смену
  // (submission: null, сразу «Требует подачи»). Упрощено до одного шага, без
  // отдельной публикации графика комплектования (см. model/types.ts шапку).
  async function createCombatDutyShift(
    request: CreateCombatDutyShiftRequest,
    actorUserId: string | null,
  ): Promise<CombatDutyShift> {
    if (!hasPermission(actorUserId, MANAGE_PERMISSION)) {
      throw new RepositoryPermissionError(MANAGE_PERMISSION)
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(request.businessDate)) {
      throw new RepositoryBusinessRuleError(
        'INVALID_BUSINESS_DATE',
        'Укажите дату в формате ГГГГ-ММ-ДД.',
      )
    }
    if (request.routeIds.length === 0) {
      throw new RepositoryBusinessRuleError('EMPTY_ROUTE_SET', 'Укажите хотя бы одну Трассу.')
    }
    if (request.requiredEmployees < 1) {
      throw new RepositoryBusinessRuleError(
        'INVALID_REQUIREMENT',
        'Требуемая численность должна быть не менее 1.',
      )
    }
    let created!: CombatDutyShift
    await runMutation(adapter, clock, (current) => {
      const slice = readSlice(current)
      const dutyType = slice.combatDutyTypes.find((t) => t.dutyTypeCode === request.dutyTypeCode)
      if (dutyType === undefined) {
        throw new RepositoryBusinessRuleError('UNKNOWN_DUTY_TYPE', 'Неизвестный вид дежурства.')
      }
      if (!dutyType.supportsMultipleRoutes && request.routeIds.length > 1) {
        throw new RepositoryBusinessRuleError(
          'TOO_MANY_ROUTES',
          'Этот вид дежурства не поддерживает несколько Трасс.',
        )
      }
      const unknownRoute = request.routeIds.find(
        (routeId) => !slice.routes.some((r) => r.routeId === routeId),
      )
      if (unknownRoute !== undefined) {
        throw new RepositoryBusinessRuleError('UNKNOWN_ROUTE', 'Неизвестная Трасса.')
      }
      const seq = slice.combatShifts.length + 1
      const id = `combat-duty-shift-${current.revision + 1}-${seq}`
      const routeLabels = request.routeIds.map(
        (routeId) => slice.routes.find((r) => r.routeId === routeId)?.safeLabel ?? routeId,
      )
      created = {
        id,
        businessDate: request.businessDate,
        dutyTypeCode: request.dutyTypeCode,
        routeSet: {
          routeSetId: `duty-route-set-${current.revision + 1}-${seq}`,
          safeLabel: routeLabels.join(', '),
          coverageMode: request.coverageMode,
          routeIds: request.routeIds,
        },
        submission: null,
        updatedAt: clock.now(),
        requiredEmployees: request.requiredEmployees,
      }
      return {
        ...current.slices,
        [SLICE_NAME]: {
          ...slice,
          combatShifts: [...slice.combatShifts, created],
        } satisfies DutiesSlice,
      }
    })
    return created
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
          execution: null,
          replacements: [],
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
          // §24.19-24.23: принятие открывает пост-lifecycle ознакомления;
          // возврат оставляет execution нетронутым (RETURNED не имеет своего).
          execution:
            request.decision === 'ACCEPT'
              ? {
                  stateCode: 'PENDING_ACKNOWLEDGEMENT',
                  acknowledgedMemberNames: [],
                  actualStart: null,
                  actualEnd: null,
                  actualMemberNames: null,
                }
              : existing.submission.execution,
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

  async function acknowledgeCombatDuty(
    id: string,
    employeeName: string,
    actorUserId: string | null,
  ): Promise<CombatDutyShift> {
    if (!hasPermission(actorUserId, COMBAT_ACKNOWLEDGE_PERMISSION)) {
      throw new RepositoryPermissionError(COMBAT_ACKNOWLEDGE_PERMISSION)
    }
    let updated!: CombatDutyShift
    await runMutation(adapter, clock, (current) => {
      const slice = readSlice(current)
      const existing = slice.combatShifts.find((s) => s.id === id)
      if (existing === undefined) {
        throw new RepositoryNotFoundError(id)
      }
      const submission = existing.submission
      if (submission === null || submission.stateCode !== 'ACCEPTED' || submission.execution === null) {
        throw new RepositoryBusinessRuleError(
          'INVALID_STATE_TRANSITION',
          'Ознакомиться можно только с принятым составом.',
        )
      }
      if (submission.execution.stateCode !== 'PENDING_ACKNOWLEDGEMENT') {
        throw new RepositoryBusinessRuleError(
          'INVALID_STATE_TRANSITION',
          'Ознакомление уже завершено для всего состава.',
        )
      }
      const requiredNames = [submission.groupLeaderEmployeeName, ...submission.memberEmployeeNames]
      if (!requiredNames.includes(employeeName)) {
        throw new RepositoryBusinessRuleError(
          'NOT_IN_ROSTER',
          'Ознакомиться может только старший или участник основного состава.',
        )
      }
      if (submission.execution.acknowledgedMemberNames.includes(employeeName)) {
        throw new RepositoryBusinessRuleError(
          'ALREADY_ACKNOWLEDGED',
          'Этот сотрудник уже подтвердил ознакомление.',
        )
      }
      const acknowledgedMemberNames = [...submission.execution.acknowledgedMemberNames, employeeName]
      const allAcknowledged = requiredNames.every((name) => acknowledgedMemberNames.includes(name))
      updated = {
        ...existing,
        submission: {
          ...submission,
          execution: {
            ...submission.execution,
            acknowledgedMemberNames,
            stateCode: allAcknowledged ? 'READY' : 'PENDING_ACKNOWLEDGEMENT',
          },
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

  async function checkInCombatDuty(id: string, actorUserId: string | null): Promise<CombatDutyShift> {
    if (!hasPermission(actorUserId, COMBAT_CHECKIN_PERMISSION)) {
      throw new RepositoryPermissionError(COMBAT_CHECKIN_PERMISSION)
    }
    let updated!: CombatDutyShift
    await runMutation(adapter, clock, (current) => {
      const slice = readSlice(current)
      const existing = slice.combatShifts.find((s) => s.id === id)
      if (existing === undefined) {
        throw new RepositoryNotFoundError(id)
      }
      const submission = existing.submission
      if (
        submission === null ||
        submission.stateCode !== 'ACCEPTED' ||
        submission.execution === null ||
        submission.execution.stateCode !== 'READY'
      ) {
        throw new RepositoryBusinessRuleError(
          'INVALID_STATE_TRANSITION',
          'Заступить можно только после ознакомления всего состава.',
        )
      }
      updated = {
        ...existing,
        submission: {
          ...submission,
          execution: { ...submission.execution, stateCode: 'ACTIVE', actualStart: clock.now() },
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

  async function completeCombatDuty(
    id: string,
    request: CompleteCombatDutyRequest,
    actorUserId: string | null,
  ): Promise<CombatDutyShift> {
    if (!hasPermission(actorUserId, COMBAT_COMPLETE_PERMISSION)) {
      throw new RepositoryPermissionError(COMBAT_COMPLETE_PERMISSION)
    }
    let updated!: CombatDutyShift
    await runMutation(adapter, clock, (current) => {
      const slice = readSlice(current)
      const existing = slice.combatShifts.find((s) => s.id === id)
      if (existing === undefined) {
        throw new RepositoryNotFoundError(id)
      }
      const submission = existing.submission
      if (
        submission === null ||
        submission.stateCode !== 'ACCEPTED' ||
        submission.execution === null ||
        submission.execution.stateCode !== 'ACTIVE'
      ) {
        throw new RepositoryBusinessRuleError(
          'INVALID_STATE_TRANSITION',
          'Завершить можно только начатое дежурство.',
        )
      }
      updated = {
        ...existing,
        submission: {
          ...submission,
          execution: {
            ...submission.execution,
            stateCode: 'COMPLETED',
            actualEnd: clock.now(),
            actualMemberNames: request.actualMemberNames,
          },
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

  // §24.21 «после утверждения нельзя просто поменять сотрудника в массиве» —
  // упрощено до одной атомарной команды (без отдельного approval-шага для
  // замены внутри своего управления, см. model/types.ts шапку): доступна
  // только пока состав ещё не заступил (PENDING_ACKNOWLEDGEMENT/READY).
  async function requestReplacement(
    id: string,
    request: RequestCombatDutyReplacementRequest,
    actorUserId: string | null,
  ): Promise<CombatDutyShift> {
    if (!hasPermission(actorUserId, COMBAT_REPLACE_PERMISSION)) {
      throw new RepositoryPermissionError(COMBAT_REPLACE_PERMISSION)
    }
    if (request.reasonCode.trim() === '') {
      throw new RepositoryBusinessRuleError('REASON_REQUIRED', 'Причина замены обязательна.')
    }
    let updated!: CombatDutyShift
    await runMutation(adapter, clock, (current) => {
      const slice = readSlice(current)
      const existing = slice.combatShifts.find((s) => s.id === id)
      if (existing === undefined) {
        throw new RepositoryNotFoundError(id)
      }
      const submission = existing.submission
      if (
        submission === null ||
        submission.stateCode !== 'ACCEPTED' ||
        submission.execution === null ||
        (submission.execution.stateCode !== 'PENDING_ACKNOWLEDGEMENT' &&
          submission.execution.stateCode !== 'READY')
      ) {
        throw new RepositoryBusinessRuleError(
          'INVALID_STATE_TRANSITION',
          'Замена возможна только до заступления принятого состава.',
        )
      }
      const { outgoingEmployeeName, incomingEmployeeName } = request
      const currentRoster = [submission.groupLeaderEmployeeName, ...submission.memberEmployeeNames]
      if (!currentRoster.includes(outgoingEmployeeName)) {
        throw new RepositoryBusinessRuleError(
          'NOT_IN_ROSTER',
          'Заменяемый сотрудник не состоит в основном составе.',
        )
      }
      if (currentRoster.includes(incomingEmployeeName)) {
        throw new RepositoryBusinessRuleError(
          'ALREADY_IN_ROSTER',
          'Указанный сотрудник уже состоит в основном составе.',
        )
      }
      // §24.17 hard-rule (тот же принцип, что submitCombatGroup): заменяющий
      // не может быть уже принят в другую боевую группу на эту дату.
      const conflict = slice.combatShifts.find((s) => {
        if (s.id === id || s.businessDate !== existing.businessDate) return false
        if (s.submission === null || s.submission.stateCode !== 'ACCEPTED') return false
        const acceptedNames = [s.submission.groupLeaderEmployeeName, ...s.submission.memberEmployeeNames]
        return acceptedNames.includes(incomingEmployeeName)
      })
      if (conflict !== undefined) {
        throw new RepositoryBusinessRuleError(
          'DOUBLE_ASSIGNMENT',
          'Заменяющий сотрудник уже принят в другую боевую группу на эту дату.',
        )
      }
      const groupLeaderEmployeeName =
        submission.groupLeaderEmployeeName === outgoingEmployeeName
          ? incomingEmployeeName
          : submission.groupLeaderEmployeeName
      const memberEmployeeNames = submission.memberEmployeeNames.map((name) =>
        name === outgoingEmployeeName ? incomingEmployeeName : name,
      )
      const requiredNames = [groupLeaderEmployeeName, ...memberEmployeeNames]
      // Заменённый участник выбывает из списка ознакомившихся — новый
      // человек должен подтвердить ознакомление сам (§24.19 остаётся в силе).
      const acknowledgedMemberNames = submission.execution.acknowledgedMemberNames.filter(
        (name) => name !== outgoingEmployeeName,
      )
      const allAcknowledged = requiredNames.every((name) => acknowledgedMemberNames.includes(name))
      const replacementRecord: DutyReplacementRecord = {
        replacementId: `${id}-replacement-${submission.replacements.length + 1}`,
        outgoingEmployeeName,
        incomingEmployeeName,
        reasonCode: request.reasonCode,
        safeComment: request.safeComment,
        appliedAt: clock.now(),
      }
      updated = {
        ...existing,
        submission: {
          ...submission,
          groupLeaderEmployeeName,
          memberEmployeeNames,
          execution: {
            ...submission.execution,
            acknowledgedMemberNames,
            stateCode: allAcknowledged ? 'READY' : 'PENDING_ACKNOWLEDGEMENT',
          },
          replacements: [...submission.replacements, replacementRecord],
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
    createCombatDutyShift,
    submitCombatGroup,
    reviewCombatGroup,
    acknowledgeCombatDuty,
    checkInCombatDuty,
    completeCombatDuty,
    requestReplacement,
  }
}
