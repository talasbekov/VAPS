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
  CreateDutyShiftRequest,
  ListDutyDirectoryResponse,
  ListDutyShiftsResponse,
  ListDutyTypesResponse,
} from '../api/pending-contracts'
import { addDaysIso } from '../model/calendar'
import type { DutyShift } from '../model/types'
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
/** 400: ошибки ФОРМЫ (§36) — по полям, канал RHF setError. */
export class RepositoryValidationError extends Error {
  readonly fieldErrors: Record<string, string[]>
  constructor(fieldErrors: Record<string, string[]>) {
    super('validation')
    this.fieldErrors = fieldErrors
  }
}
/**
 * 409 soft-конфликт (категория `conflict_soft` реестра error-codes.yaml):
 * повторяем с `override`+`override_reason`. Код ОДИН — `DUTY_CONFLICT_DETECTED`
 * (он уже в OVERRIDABLE_CODES; свой новый код диалог обхода НЕ включил бы).
 */
export class RepositoryConflictError extends Error {
  readonly errorCode = 'DUTY_CONFLICT_DETECTED'
  readonly conflicts: Record<string, unknown>[]
  constructor(message: string, conflicts: Record<string, unknown>[]) {
    super(message)
    this.conflicts = conflicts
  }
}

const SLICE_NAME = 'duties'
const VIEW_PERMISSION = 'ops.duty.view'
const MANAGE_PERMISSION = 'ops.duty.manage'

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

  async function listDirectory(actorUserId: string | null): Promise<ListDutyDirectoryResponse> {
    if (!hasPermission(actorUserId, VIEW_PERMISSION)) {
      throw new RepositoryPermissionError(VIEW_PERMISSION)
    }
    const envelope = await adapter.load()
    if (envelope === null) return { targets: [], roster: [] }
    const slice = readSlice(envelope)
    return { targets: [...slice.targets], roster: [...slice.roster] }
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
    // Демо-масштаб: пагинации/диапазона нет — ОДИН набор данных обслуживает
    // все три представления §21.4 (по объектам/по сотрудникам/календарь),
    // недельное окно нарезается на клиенте из него же, вторым запросом — нет.
    return { results: sorted, businessDate: clock.businessDate() }
  }

  /**
   * Назначение смены (§24). Два уровня конфликтов — как в прототипе
   * КалендарьСмен: hard-block 422 (обход невозможен) и soft 409 (обходится
   * причиной). Оба правила опираются на ДАННЫЕ, которые у нас реально есть —
   * смены сотрудника; статусные hard-block'и прототипа (SICK_LEAVE, VACATION,
   * COMMAND) НЕ реализованы: источник кадровых статусов живёт в другой фиче,
   * а выдумывать отсутствующие данные запрещено (§35).
   */
  async function createShift(
    request: CreateDutyShiftRequest,
    actorUserId: string | null,
  ): Promise<DutyShift> {
    if (!hasPermission(actorUserId, MANAGE_PERMISSION)) {
      throw new RepositoryPermissionError(MANAGE_PERMISSION)
    }
    const envelope = await adapter.load()
    if (envelope === null) {
      throw new Error('mock-runtime: назначение смены до инициализации demo-состояния')
    }
    const slice = readSlice(envelope)

    const fieldErrors: Record<string, string[]> = {}
    if (!/^\d{4}-\d{2}-\d{2}$/.test(request.businessDate)) {
      fieldErrors.businessDate = ['Укажите дату в формате ГГГГ-ММ-ДД.']
    }
    const employee = slice.roster.find((e) => e.employeeId === request.employeeId)
    if (employee === undefined) {
      fieldErrors.employeeId = ['Выберите сотрудника из списка.']
    }
    const target = slice.targets.find((t) => t.objectId === request.objectId)
    if (target === undefined) {
      fieldErrors.objectId = ['Выберите объект дежурства.']
    }
    const dutyType = slice.dutyTypes.find((t) => t.dutyTypeCode === request.dutyTypeCode)
    if (dutyType === undefined) {
      fieldErrors.dutyTypeCode = ['Выберите вид дежурства.']
    }
    if (request.override === true && (request.override_reason ?? '').trim() === '') {
      fieldErrors.override_reason = ['Причина обхода обязательна.']
    }
    if (
      Object.keys(fieldErrors).length > 0 ||
      employee === undefined ||
      target === undefined ||
      dutyType === undefined
    ) {
      // Второй половиной условия сужаем типы (TS не выводит связь с fieldErrors);
      // ветка «пусто, но undefined» недостижима — проверки выше её покрывают.
      throw new RepositoryValidationError(fieldErrors)
    }
    const resolvedEmployee = employee
    const resolvedTarget = target
    const resolvedType = dutyType

    if (resolvedType.targetType !== resolvedTarget.targetType) {
      throw new RepositoryBusinessRuleError(
        'DUTY_TYPE_TARGET_MISMATCH',
        'Вид дежурства не соответствует типу объекта.',
      )
    }

    const employeeShifts = slice.shifts.filter((s) => s.employeeId === request.employeeId)

    // Hard-block (422): двойное назначение в один день — обход невозможен,
    // как двойное назначение на посты в расстановке ОМ.
    if (employeeShifts.some((s) => s.businessDate === request.businessDate)) {
      throw new RepositoryBusinessRuleError(
        'DUTY_DOUBLE_ASSIGNMENT',
        'Сотрудник уже назначен на дежурство в этот день.',
      )
    }

    // Soft (409, overridable): смежные сутки — нарушение отдыха после
    // суточного дежурства. Обходится причиной (10–500 символов проверяет фронт).
    if (request.override !== true) {
      const adjacent = employeeShifts.filter(
        (s) =>
          s.businessDate === addDaysIso(request.businessDate, -1) ||
          s.businessDate === addDaysIso(request.businessDate, 1),
      )
      if (adjacent.length > 0) {
        throw new RepositoryConflictError(
          'Смежные сутки с другим дежурством сотрудника.',
          adjacent.map((s) => ({
            conflict_code: 'REST_AFTER_DAILY_DUTY',
            employee_id: resolvedEmployee.fullName,
            business_date: s.businessDate,
          })),
        )
      }
    }

    let created!: DutyShift
    await runMutation(adapter, clock, (current) => {
      const currentSlice = readSlice(current)
      const now = clock.now()
      created = {
        id: `duty-shift-${current.revision + 1}-${currentSlice.shifts.length + 1}`,
        businessDate: request.businessDate,
        dutyTypeCode: resolvedType.dutyTypeCode,
        target: { ...resolvedTarget },
        employeeId: resolvedEmployee.employeeId,
        employeeName: resolvedEmployee.fullName,
        stateCode: 'PLANNED',
        acknowledgedAt: null,
        actualStart: null,
        actualEnd: null,
        updatedAt: now,
      }
      return {
        ...current.slices,
        [SLICE_NAME]: {
          ...currentSlice,
          shifts: [...currentSlice.shifts, created],
        } satisfies DutiesSlice,
      }
    })
    return created
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

  return { listDutyTypes, listDirectory, listShifts, createShift, acknowledge, clockIn, clockOut }
}
