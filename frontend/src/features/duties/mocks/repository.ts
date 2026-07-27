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
import { buildMonthlyPlan, detectConflicts, isValidMonth } from '../lib/monthlyPlan'
import type { UnavailableMetric } from '../lib/monthlyPlan'
import {
  NO_POSTS_IN_VERSION_TEXT,
  NO_VERSION_FOR_DATE_TEXT,
  PASSPORT_RED_BLOCK_TEXT,
  bindDutyPost,
  isBindingStale,
  isPassportBlocking,
  resolveApplicableVersion,
} from '../lib/passportBinding'
import { findObjectById, readObjectsProjection } from './objectsSlice'
import type {
  CompleteCombatDutyRequest,
  CreateCombatDutyShiftRequest,
  CreateDutyShiftRequest,
  DutyCandidateOption,
  DutyPassportStatus,
  DutyPlanObjectOption,
  DutyPlanSectorOption,
  ListDutyCandidatesResponse,
  ListDutyPlanObjectsResponse,
  ListCombatDutyShiftsResponse,
  ListCombatDutyTypesResponse,
  ListCombatRosterCandidatesResponse,
  ListDutyRoutesResponse,
  ListDutyShiftsResponse,
  ListDutyTypesResponse,
  MonthlyDutyPlanResponse,
  RequestCombatDutyReplacementRequest,
  ReviewCombatGroupRequest,
  SubmitCombatDutyHandoverRequest,
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
/**
 * §21.34 «Soft conflict → 409»: сохранение возможно, но требует явного
 * обхода — это КОНФЛИКТ состояния, а не нарушенное бизнес-правило (422,
 * обойти нельзя). Разные коды состояния здесь несут разный смысл для формы:
 * на 422 она показывает отказ, на 409 — предлагает обоснование.
 */
export class RepositoryConflictError extends Error {
  readonly errorCode: string
  /** Конверт §36 несёт `details.conflicts[]` — общий `ConflictDialog` их
   * перечисляет. Пустой объект тут был бы диалогом без содержания. */
  readonly details: Record<string, unknown>
  constructor(errorCode: string, message: string, details: Record<string, unknown> = {}) {
    super(message)
    this.errorCode = errorCode
    this.details = details
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
/** §21.34 «SOFT_OVERRIDE — возможно с обоснованием И ОТДЕЛЬНЫМ permission».
 * Отдельным: право планировать дежурства (`ops.duty.manage`) не то же самое,
 * что право обойти обязательный отдых. */
const REST_OVERRIDE_PERMISSION = 'ops.duty.override_rest'

const BUSINESS_DATE_RE = /^\d{4}-\d{2}-\d{2}$/

/** §21.33 перечисляет факторы подбора, которых в demo-модели нет НИ В КАКОМ
 * виде. Список отдаётся клиенту, а не пишется в вёрстке: причина принадлежит
 * серверу, который знает, чего у него нет (§35, тот же приём, что
 * `UNAVAILABLE_MONTHLY_METRICS`). */
const UNAVAILABLE_CANDIDATE_ATTRIBUTES: readonly UnavailableMetric[] = [
  {
    code: 'AVAILABILITY',
    label: 'Доступность и текущий статус (отпуск, больничный, командировка)',
    reason:
      'Employee Status Repository в demo-срезе отсутствует; §21.33 при этом прямо запрещает раскрывать причину недоступности — показывать нечего и нечем.',
  },
  {
    code: 'POST_REQUIREMENTS_MATCH',
    label: 'Соответствие требованиям поста и допуски',
    reason:
      'Требования поста хранятся текстом в паспорте объекта, допуски сотрудника не моделируются — сопоставление было бы разбором свободного текста.',
  },
  {
    code: 'WORKLOAD_AND_RATING',
    label: 'Нагрузка и агрегированный рейтинг',
    reason:
      'Workload Repository нет, а рейтинг — hidden-score (§D3): показывать его без включённой политики §21.33 запрещает.',
  },
]

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
    // §9.6: серверный join с реестром объектов. Статус считается по КАЖДОЙ
    // строке на чтении — см. `DutyPassportStatus` в pending-contracts.
    const passportStatuses: DutyPassportStatus[] = sorted.map((shift) => {
      const object =
        envelope === null ? null : findObjectById(envelope.slices, shift.target.objectId)
      const applicable =
        object === null ? null : resolveApplicableVersion(object, shift.businessDate)
      return {
        shiftId: shift.id,
        objectKnown: object !== null,
        applicableVersionId: applicable?.id ?? null,
        applicableVersionNumber: applicable?.versionNumber ?? null,
        stale:
          shift.passportBinding === null
            ? false
            : isBindingStale(shift.passportBinding, applicable),
      }
    })
    return { results: sorted, passportStatuses }
  }

  /**
   * §21.27-21.30. Ответ собирается ЦЕЛИКОМ здесь (на «сервере»): страница
   * получает и сетку, и KPI, и severity конфликтов готовыми — §21.29 прямо
   * запрещает считать итог по отрисованной части календаря, §21.34 — выводить
   * severity на frontend. Конфликты ищутся по ВСЕМ сменам, а не по сменам
   * месяца (см. `detectConflicts`), и лишь потом обрезаются месяцем.
   */
  async function getMonthlyPlan(
    month: string,
    actorUserId: string | null,
  ): Promise<MonthlyDutyPlanResponse> {
    if (!hasPermission(actorUserId, VIEW_PERMISSION)) {
      throw new RepositoryPermissionError(VIEW_PERMISSION)
    }
    if (!isValidMonth(month)) {
      throw new RepositoryBusinessRuleError(
        'INVALID_MONTH',
        'Месяц плана указывается в формате YYYY-MM.',
      )
    }
    const envelope = await adapter.load()
    const slice = envelope === null ? null : readSlice(envelope)
    return buildMonthlyPlan(month, slice?.shifts ?? [], slice?.dutyTypes ?? [])
  }

  /**
   * §21.31 «После выбора объекта загружай… действующие секторы, активные
   * посты, требования, readiness паспорта». Разрешение «какая версия действует
   * на эту дату» и server policy §21.31 живут ЗДЕСЬ, а не в форме: форма
   * получает готовый список с готовой причиной блокировки и ничего не выводит
   * сама. Поэтому вид дежурства — обязательный параметр запроса: без него
   * правило «красный паспорт + вид требует актуального» неприменимо, а
   * применить его наполовину хуже, чем потребовать параметр.
   */
  async function listDutyPlanObjects(
    businessDate: string,
    dutyTypeCode: string,
    actorUserId: string | null,
  ): Promise<ListDutyPlanObjectsResponse> {
    if (!hasPermission(actorUserId, VIEW_PERMISSION)) {
      throw new RepositoryPermissionError(VIEW_PERMISSION)
    }
    if (!BUSINESS_DATE_RE.test(businessDate)) {
      throw new RepositoryBusinessRuleError(
        'INVALID_BUSINESS_DATE',
        'Укажите дату в формате ГГГГ-ММ-ДД.',
      )
    }
    const envelope = await adapter.load()
    if (envelope === null) {
      return { businessDate, results: [] }
    }
    const dutyType = readSlice(envelope).dutyTypes.find((t) => t.dutyTypeCode === dutyTypeCode)
    if (dutyType === undefined) {
      throw new RepositoryBusinessRuleError('UNKNOWN_DUTY_TYPE', 'Неизвестный вид дежурства.')
    }
    const results: DutyPlanObjectOption[] = readObjectsProjection(envelope.slices)
      .map((object) => {
        const version = resolveApplicableVersion(object, businessDate)
        const sectors: DutyPlanSectorOption[] =
          version === null
            ? []
            : version.sectors.map((sector) => ({
                sectorId: sector.id,
                sectorName: sector.name,
                posts: sector.posts.map((post) => ({
                  postId: post.id,
                  postName: post.name,
                  task: post.task,
                  requirements: post.requirements,
                })),
              }))
        const hasPost = sectors.some((sector) => sector.posts.length > 0)
        const blockReason =
          dutyType.requiresCurrentPassport && isPassportBlocking(object.passportState)
            ? PASSPORT_RED_BLOCK_TEXT
            : version === null
              ? NO_VERSION_FOR_DATE_TEXT
              : !hasPost
                ? NO_POSTS_IN_VERSION_TEXT
                : null
        return {
          objectId: object.id,
          objectName: object.name,
          objectCode: object.code,
          passportState: object.passportState,
          applicableVersionId: version?.id ?? null,
          applicableVersionNumber: version?.versionNumber ?? null,
          applicableVersionEffectiveFrom: version?.effectiveFrom ?? null,
          sectors,
          blockReason,
        }
      })
      .sort((a, b) => a.objectName.localeCompare(b.objectName))
    return { businessDate, results }
  }

  /**
   * §21.33 «Подбор кандидатов». Из перечисленных промптом факторов модель
   * выдаёт РОВНО ОДИН — уже запланированные дежурства; он и считается здесь.
   * Остальные (доступность, статус, отдых как отдельный фактор, ОМ, нагрузка,
   * требования поста, допуски, рейтинг) не подменяются нулём и не молчат:
   * ответ несёт их списком с причиной (§35).
   */
  async function listDutyCandidates(
    businessDate: string,
    actorUserId: string | null,
  ): Promise<ListDutyCandidatesResponse> {
    if (!hasPermission(actorUserId, VIEW_PERMISSION)) {
      throw new RepositoryPermissionError(VIEW_PERMISSION)
    }
    if (!BUSINESS_DATE_RE.test(businessDate)) {
      throw new RepositoryBusinessRuleError(
        'INVALID_BUSINESS_DATE',
        'Укажите дату в формате ГГГГ-ММ-ДД.',
      )
    }
    const envelope = await adapter.load()
    const slice = envelope === null ? null : readSlice(envelope)
    const shifts = slice?.shifts ?? []
    const results: DutyCandidateOption[] = (slice?.dutyCandidates ?? [])
      .map((candidate) => {
        const own = shifts
          .filter((shift) => shift.employeeName === candidate.employeeName)
          .map((shift) => shift.businessDate)
          .sort()
        return {
          employeeName: candidate.employeeName,
          unitName: candidate.unitName,
          positionName: candidate.positionName,
          nearestDutyDate: own.find((date) => date >= businessDate) ?? null,
          busyOnRequestedDate: own.includes(businessDate),
        }
      })
      .sort((a, b) => a.employeeName.localeCompare(b.employeeName))
    return { businessDate, results, unavailableAttributes: [...UNAVAILABLE_CANDIDATE_ATTRIBUTES] }
  }

  /**
   * §21.31 «Создание дежурства» + §21.34 конфликты.
   *
   * Конфликты считаются НЕ отдельной проверкой «а нет ли уже смены в этот
   * день», а тем же `detectConflicts`, что строит месячный план: иначе форма
   * и месячный план разошлись бы в том, что считается конфликтом. Берётся
   * РАЗНИЦА «после − до»: конфликты, которые уже существовали в данных, эта
   * смена не создавала и блокировать её не должны.
   */
  async function createDutyShift(
    request: CreateDutyShiftRequest,
    actorUserId: string | null,
  ): Promise<DutyShift> {
    if (!hasPermission(actorUserId, MANAGE_PERMISSION)) {
      throw new RepositoryPermissionError(MANAGE_PERMISSION)
    }
    if (!BUSINESS_DATE_RE.test(request.businessDate)) {
      throw new RepositoryBusinessRuleError(
        'INVALID_BUSINESS_DATE',
        'Укажите дату в формате ГГГГ-ММ-ДД.',
      )
    }
    if (request.employeeName.trim() === '') {
      throw new RepositoryBusinessRuleError('EMPTY_EMPLOYEE', 'Выберите сотрудника.')
    }
    // Обход засчитывается только при обоих признаках протокола: флаг без
    // причины — не обоснованный обход, причина без флага — не обход вовсе.
    const overrideReason =
      request.override === true ? (request.override_reason ?? '').trim() : ''
    if (overrideReason !== '' && !hasPermission(actorUserId, REST_OVERRIDE_PERMISSION)) {
      throw new RepositoryPermissionError(REST_OVERRIDE_PERMISSION)
    }
    let created!: DutyShift
    await runMutation(adapter, clock, (current) => {
      const slice = readSlice(current)
      const dutyType = slice.dutyTypes.find((t) => t.dutyTypeCode === request.dutyTypeCode)
      if (dutyType === undefined) {
        throw new RepositoryBusinessRuleError('UNKNOWN_DUTY_TYPE', 'Неизвестный вид дежурства.')
      }
      const object = findObjectById(current.slices, request.objectId)
      if (object === null) {
        throw new RepositoryBusinessRuleError(
          'UNKNOWN_OBJECT',
          'Объект не найден в реестре объектов.',
        )
      }
      if (dutyType.requiresCurrentPassport && isPassportBlocking(object.passportState)) {
        throw new RepositoryBusinessRuleError('PASSPORT_NOT_READY', PASSPORT_RED_BLOCK_TEXT)
      }
      const version = resolveApplicableVersion(object, request.businessDate)
      if (version === null) {
        throw new RepositoryBusinessRuleError('PASSPORT_VERSION_MISSING', NO_VERSION_FOR_DATE_TEXT)
      }
      // §9.6/§21.32: снимок берётся из ЗАФИКСИРОВАННОЙ версии. `null` здесь —
      // пост назвали, но в этой версии его нет: молча привязать к другому
      // посту нельзя.
      const binding = bindDutyPost(
        object,
        version,
        request.sectorId,
        request.postId,
        clock.now(),
      )
      if (binding === null) {
        throw new RepositoryBusinessRuleError(
          'UNKNOWN_POST',
          'Выбранного поста нет в действующей на эту дату версии паспорта.',
        )
      }

      const candidate: DutyShift = {
        id: `duty-shift-${current.revision + 1}-${slice.shifts.length + 1}`,
        businessDate: request.businessDate,
        dutyTypeCode: request.dutyTypeCode,
        target: {
          targetType: dutyType.targetType,
          objectId: object.id,
          safeLabel: object.name,
        },
        employeeName: request.employeeName.trim(),
        stateCode: 'PLANNED',
        acknowledgedAt: null,
        actualStart: null,
        actualEnd: null,
        updatedAt: clock.now(),
        passportBinding: binding,
        note: request.note?.trim() === '' ? null : (request.note?.trim() ?? null),
        // Заполняется НИЖЕ и только если обход действительно понадобился:
        // обоснование при отсутствии конфликта — шум в данных, который потом
        // читался бы как «здесь что-то обходили».
        overrideReason: null,
      }

      const before = new Set(
        detectConflicts(slice.shifts, slice.dutyTypes).map((conflict) => conflict.conflictId),
      )
      const introduced = detectConflicts(
        [...slice.shifts, candidate],
        slice.dutyTypes,
      ).filter((conflict) => !before.has(conflict.conflictId))

      const hard = introduced.find((conflict) => conflict.severity === 'HARD')
      if (hard !== undefined) {
        throw new RepositoryBusinessRuleError('DUTY_CONFLICT_HARD', hard.message)
      }
      const soft = introduced.find((conflict) => conflict.severity === 'SOFT')
      if (soft !== undefined && overrideReason === '') {
        // Код НЕ выдуман: `DUTY_CONFLICT_DETECTED` уже в
        // `docs/registries/error-codes.yaml` как overridable/conflict_soft —
        // ровно он включает канонический путь `useApiMutation.conflict` →
        // общий `ConflictDialog` → повтор с override (ARCH-FE-015). Свой код
        // сюда завёл бы второй, параллельный протокол обхода.
        throw new RepositoryConflictError('DUTY_CONFLICT_DETECTED', soft.message, {
          conflicts: introduced.map((conflict) => ({
            conflict_code: conflict.code,
            severity: conflict.severity,
            employee_id: conflict.employeeName,
            business_date: conflict.businessDate,
            message: conflict.message,
          })),
        })
      }
      const stored: DutyShift = {
        ...candidate,
        overrideReason: soft === undefined ? null : overrideReason,
      }

      created = stored
      return {
        ...current.slices,
        [SLICE_NAME]: {
          ...slice,
          shifts: [...slice.shifts, stored],
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
                  handover: null,
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
      // §24.22 (сокращённо, A55): сдача смены — обязательный checkpoint ДО
      // завершения, независимо от completeCombatDuty.
      if (submission.execution.handover === null) {
        throw new RepositoryBusinessRuleError(
          'MISSING_HANDOVER',
          'Перед завершением нужно оформить сдачу смены.',
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

  // §24.22 «Передача и завершение смены», сокращённо до checkpoint'а сдачи
  // (см. model/types.ts CombatDutyHandover, FRONTEND_DECISIONS A55) — БЕЗ
  // принимающего экипажа, которого модель не поддерживает. Доступна только
  // из ACTIVE (сдавать смену, которая ещё не началась или уже завершена,
  // бессмысленно); повторная подача перезаписывает предыдущую (сдающий может
  // поправить данные до самого завершения).
  async function submitCombatDutyHandover(
    id: string,
    request: SubmitCombatDutyHandoverRequest,
    actorUserId: string | null,
  ): Promise<CombatDutyShift> {
    if (!hasPermission(actorUserId, COMBAT_COMPLETE_PERMISSION)) {
      throw new RepositoryPermissionError(COMBAT_COMPLETE_PERMISSION)
    }
    if (request.confirmedByEmployeeName.trim() === '') {
      throw new RepositoryBusinessRuleError(
        'CONFIRMER_REQUIRED',
        'Укажите, кто сдаёт смену.',
      )
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
          'Сдать смену можно только во время несения службы.',
        )
      }
      const requiredNames = [submission.groupLeaderEmployeeName, ...submission.memberEmployeeNames]
      if (!requiredNames.includes(request.confirmedByEmployeeName)) {
        throw new RepositoryBusinessRuleError(
          'NOT_IN_ROSTER',
          'Сдать смену может только старший или участник основного состава.',
        )
      }
      updated = {
        ...existing,
        submission: {
          ...submission,
          execution: {
            ...submission.execution,
            handover: {
              unresolvedIncidents: request.unresolvedIncidents,
              remarks: request.remarks,
              confirmedByEmployeeName: request.confirmedByEmployeeName,
              confirmedAt: clock.now(),
            },
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
    getMonthlyPlan,
    listDutyPlanObjects,
    listDutyCandidates,
    createDutyShift,
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
    submitCombatDutyHandover,
    requestReplacement,
  }
}
