// Pending-контракты «План дежурств» (§7.5): backend Smart Josparlau не
// существует — статус `backend-contract-pending`.
import type {
  MonthlyDutyPlan,
  MonthlyDutyPlanConflict,
  UnavailableMetric,
} from '../lib/monthlyPlan'
import type { MonthlyPlanHeader } from '../lib/planLifecycle'
import type {
  CombatDutyShift,
  CombatDutyTypeDefinition,
  CombatRosterCandidate,
  DutyRoute,
  DutyRouteCoverageMode,
  DutyShift,
  DutyTypeDefinition,
  MonthlyPlanRecord,
} from '../model/types'

export const DUTY_TYPES_PATH = '/api/ops/duty-types/'
export const DUTY_SHIFTS_PATH = '/api/ops/duty-shifts/'
export const COMBAT_DUTY_TYPES_PATH = '/api/ops/combat-duty-types/'
export const DUTY_ROUTES_PATH = '/api/ops/duty-routes/'
export const COMBAT_ROSTER_CANDIDATES_PATH = '/api/ops/combat-roster-candidates/'
export const COMBAT_DUTY_SHIFTS_PATH = '/api/ops/combat-duty-shifts/'
/** §21.27-21.30 — месячный план отдельным ресурсом, а не фильтром по сменам:
 * §21.29 требует СЕРВЕРНЫЕ KPI, а §21.34 — серверную severity конфликтов;
 * и то и другое приходит в этом ответе вместе с сеткой, чтобы страница не
 * могла посчитать итог «по отрисованной части». */
export const DUTY_MONTHLY_PLAN_PATH = '/api/ops/duty-monthly-plan/'
/** §21.31 «После выбора объекта загружай: активные виды дежурств, действующие
 * секторы, активные посты, требования, инструкции, readiness паспорта» —
 * отдельный ресурс формы, а не реестр объектов: он отдаёт объекты УЖЕ
 * разрешёнными на конкретную дату (действующая версия + её посты + причина
 * блокировки), потому что и выбор версии, и server policy §21.31 принадлежат
 * серверу, а не форме. */
export const DUTY_PLAN_OBJECTS_PATH = '/api/ops/duty-plan-objects/'
/** §21.33 «Подбор кандидатов». */
export const DUTY_CANDIDATES_PATH = '/api/ops/duty-candidates/'
/** §21.30 «Список дежурств» и «История» — плоский список с серверными
 * счётчиками конфликтов (§21.34) и явным списком невыводимых колонок (§35). */
export const DUTY_SHIFT_LIST_PATH = '/api/ops/duty-shift-list/'

/**
 * §21.27 lifecycle месячного плана — действия ПОД тем же ресурсом, что и
 * чтение плана: они меняют ровно его. Месяц едет в теле, а не в пути: плана
 * как отдельного идентификатора нет, ключ — сам месяц (см. `MonthlyPlanRecord`).
 */
export function dutyPlanDraftPath(): string {
  return `${DUTY_MONTHLY_PLAN_PATH}draft/`
}
export function dutyPlanCheckPath(): string {
  return `${DUTY_MONTHLY_PLAN_PATH}check/`
}
export function dutyPlanApprovePath(): string {
  return `${DUTY_MONTHLY_PLAN_PATH}approve/`
}
export function dutyPlanReopenPath(): string {
  return `${DUTY_MONTHLY_PLAN_PATH}reopen/`
}

/** §21.32 «Карточка дежурства» — deep link на одну смену. */
export function dutyShiftDetailPath(id: string): string {
  return `${DUTY_SHIFTS_PATH}${id}/`
}
export function dutyShiftUpdatePath(id: string): string {
  return `${DUTY_SHIFTS_PATH}${id}/update/`
}
export function dutyShiftCancelPath(id: string): string {
  return `${DUTY_SHIFTS_PATH}${id}/cancel/`
}
export function dutyShiftAcknowledgePath(id: string): string {
  return `${DUTY_SHIFTS_PATH}${id}/acknowledge/`
}
export function dutyShiftClockInPath(id: string): string {
  return `${DUTY_SHIFTS_PATH}${id}/clock-in/`
}
export function dutyShiftClockOutPath(id: string): string {
  return `${DUTY_SHIFTS_PATH}${id}/clock-out/`
}
export function combatDutyShiftSubmitPath(id: string): string {
  return `${COMBAT_DUTY_SHIFTS_PATH}${id}/submit/`
}
export function combatDutyShiftReviewPath(id: string): string {
  return `${COMBAT_DUTY_SHIFTS_PATH}${id}/review/`
}
export function combatDutyShiftAcknowledgePath(id: string): string {
  return `${COMBAT_DUTY_SHIFTS_PATH}${id}/acknowledge/`
}
export function combatDutyShiftCheckInPath(id: string): string {
  return `${COMBAT_DUTY_SHIFTS_PATH}${id}/check-in/`
}
export function combatDutyShiftCompletePath(id: string): string {
  return `${COMBAT_DUTY_SHIFTS_PATH}${id}/complete/`
}
export function combatDutyShiftReplacePath(id: string): string {
  return `${COMBAT_DUTY_SHIFTS_PATH}${id}/replace/`
}
export function combatDutyShiftHandoverPath(id: string): string {
  return `${COMBAT_DUTY_SHIFTS_PATH}${id}/handover/`
}

export interface ListDutyTypesResponse {
  results: DutyTypeDefinition[]
}

/**
 * §9.6, ПРОИЗВОДНЫЙ (не хранимый) взгляд на привязку дежурства: сам снимок
 * лежит в `DutyShift.passportBinding`, а «какая версия действует прямо
 * сейчас» пересчитывается на каждом чтении. Хранить `stale` было бы ошибкой —
 * публикация новой версии паспорта дежурства не трогает, и флаг молча
 * устарел бы.
 *
 * Отдельным блоком рядом с `results`, а не полем внутри `DutyShift`: так по
 * форме ответа видно, что хранимое и вычисленное — разные вещи (и наоборот,
 * отдельный endpoint на КАЖДУЮ строку таблицы плана был бы N+1).
 */
export interface DutyPassportStatus {
  shiftId: string
  /** Объект дежурства найден в реестре объектов. */
  objectKnown: boolean
  applicableVersionId: string | null
  applicableVersionNumber: number | null
  /** Действует версия НОВЕЕ привязанной — предупреждение, не ошибка. */
  stale: boolean
}

export interface ListDutyShiftsResponse {
  results: DutyShift[]
  /** По одной записи на каждую строку `results`, тот же порядок. */
  passportStatuses: DutyPassportStatus[]
}

/** §21.31: пост формы — из ЗАФИКСИРОВАННОЙ версии паспорта (§21.32 «Посты
 * загружай из зафиксированной версии паспорта, а не из текущего изменившегося
 * объекта»), поэтому сюда едут `task`/`requirements` того же снимка. */
export interface DutyPlanPostOption {
  postId: string
  postName: string
  task: string
  requirements: string
}

export interface DutyPlanSectorOption {
  sectorId: string
  sectorName: string
  posts: DutyPlanPostOption[]
}

/**
 * Объект в форме создания дежурства НА КОНКРЕТНУЮ ДАТУ. `blockReason !== null`
 * — объект показывается, но выбрать его нельзя, и причина видна сразу: §21.31
 * требует «состояние данных», а исчезнувший из списка объект читался бы как
 * «его не существует».
 */
export interface DutyPlanObjectOption {
  objectId: string
  objectName: string
  objectCode: string
  passportState: string
  /** Действующая на дату версия паспорта; `null` — её нет. */
  applicableVersionId: string | null
  applicableVersionNumber: number | null
  applicableVersionEffectiveFrom: string | null
  sectors: DutyPlanSectorOption[]
  /** `null` — объект доступен для планирования на эту дату. */
  blockReason: string | null
}

export interface ListDutyPlanObjectsResponse {
  businessDate: string
  results: DutyPlanObjectOption[]
}

/** §21.33: кандидат + ЕДИНСТВЕННЫЙ выводимый из модели признак занятости —
 * ближайшее уже запланированное дежурство. */
export interface DutyCandidateOption {
  employeeName: string
  unitName: string
  positionName: string
  /** Ближайшее дежурство не раньше запрошенной даты; `null` — таких нет. */
  nearestDutyDate: string | null
  /** Дежурство ровно на запрошенную дату — пересечение (§21.34 HARD). */
  busyOnRequestedDate: boolean
}

export interface ListDutyCandidatesResponse {
  businessDate: string
  results: DutyCandidateOption[]
  /** §35: признаки, которые §21.33 называет, а модель не выдаёт. */
  unavailableAttributes: UnavailableMetric[]
}

/**
 * §21.31 «Создание дежурства». Время начала и продолжительность в запрос НЕ
 * входят: модель проекта — «одна смена = один календарный день» (A55), а
 * продолжительность берётся у вида дежурства (`defaultDurationMinutes`) и
 * потому не дублируется в данных смены.
 *
 * `override`/`override_reason` (snake_case, вопреки остальному телу) — НЕ
 * произвол, а канон протокола 409 платформы: `useApiMutation.confirmOverride`
 * повторяет ИСХОДНОЕ тело плюс ровно эти два ключа. Тип — `type`, а не
 * `interface`, потому что переменные мутации обязаны быть присваиваемы к
 * `Record<string, unknown>` (у интерфейсов нет неявной индексной сигнатуры).
 */
export type CreateDutyShiftRequest = {
  businessDate: string
  dutyTypeCode: string
  objectId: string
  sectorId: string
  postId: string
  employeeName: string
  note: string | null
  /** §21.34 «Soft conflict → 409»; повтор с обходом — только через
   * `confirmOverride`, руками эти поля форма не заполняет. */
  override?: boolean
  override_reason?: string
}

export type CreateDutyShiftResponse = DutyShift

/**
 * §21.32 «Карточка дежурства», ОДНИМ ответом: сама смена, производный статус
 * паспорта, конфликты с СЕРВЕРНОЙ severity (§21.34 — frontend её не выводит),
 * вид дежурства целиком (продолжительность и правила отдыха — его атрибуты,
 * §21.35) и явный список блоков прототипа, которых модель не даёт (§35).
 *
 * Почему одним ответом, а не четырьмя запросами со страницы: карточка обязана
 * показать согласованный срез (конфликт, посчитанный по другому снимку смен,
 * чем показанная смена, — хуже, чем его отсутствие).
 */
export interface DutyShiftDetail {
  shift: DutyShift
  passportStatus: DutyPassportStatus
  /** Вид дежурства этой смены; `null` — вида нет в реестре (смена старше
   * реестра либо вид выведен из обращения): карточка обязана это показать,
   * а не подставить дефолтные 24 часа (§21.35). */
  dutyType: DutyTypeDefinition | null
  /**
   * Конфликты сотрудника, ПРОЯВЛЯЮЩИЕСЯ в день этой смены. Именно
   * «проявляющиеся»: у нарушения отдыха `businessDate` — день ВТОРОГО
   * дежурства (см. MonthlyDutyPlanConflict), поэтому карточка первой из пары
   * смен конфликта не покажет, и это не потеря — конфликт принадлежит той
   * смене, которая его создала.
   */
  conflicts: MonthlyDutyPlanConflict[]
  /** §35: блоки §21.32, которых в модели суточного дежурства нет. */
  unavailableBlocks: UnavailableMetric[]
}

/**
 * §21.30 «Список дежурств». Строка несёт то, что модель даёт; недостающие
 * колонки промпта перечислены в `unavailableColumns` (§35).
 *
 * Счётчики конфликтов приходят СЕРВЕРНЫЕ (§21.34) — список их не выводит,
 * иначе он разошёлся бы с месячным планом и карточкой, где они уже считаются.
 */
export interface DutyShiftListRow {
  id: string
  businessDate: string
  objectLabel: string
  dutyTypeCode: string
  dutyTypeLabel: string
  /** §21.30 «состав»: у индивидуального дежурства это один исполнитель. */
  employeeName: string
  /** Пост из зафиксированной версии паспорта; `null` — привязки нет (§9.6). */
  postLabel: string | null
  hardConflictCount: number
  softConflictCount: number
  /** ISO момент ознакомления либо `null` — «не подтверждено». */
  acknowledgedAt: string | null
  stateCode: DutyShift['stateCode']
  /** §21.30 «фактическое завершение»; `null` — смена не завершена. */
  actualEnd: string | null
  cancellationReason: string | null
}

export type DutyShiftListScope = 'ALL' | 'HISTORY'

export interface ListDutyShiftListResponse {
  scope: DutyShiftListScope
  /**
   * Бизнес-дата, ОТ КОТОРОЙ сервер отделяет прошедшее. Приходит в ответе, а не
   * берётся фронтом из `new Date()`: demo-runtime живёт по DemoClock (§8.8), и
   * «сегодня» по часам машины разошлось бы с данными.
   */
  businessDate: string
  results: DutyShiftListRow[]
  /** §35: колонки §21.30, которых в модели суточного дежурства нет. */
  unavailableColumns: UnavailableMetric[]
}

/**
 * §21.31 «Создание дежурства» отвечает и за его правку: заведённая смена не
 * должна быть неисправимой.
 *
 * ЧТО МЕНЯТЬ НЕЛЬЗЯ и почему — дата и вид дежурства. Оба задают, какая версия
 * паспорта действует и какие правила отдыха применяются; смена с другой датой —
 * это ДРУГАЯ смена, и «правка» подменила бы её молча. Для этого есть отмена +
 * создание, где конфликты пересчитываются с нуля и видны человеку.
 *
 * Смена сотрудника СБРАСЫВАЕТ ознакомление (ACKNOWLEDGED → PLANNED): подтвердил
 * прежний, новый ещё нет — тот же принцип, что §24.21 у боевых групп.
 */
export type UpdateDutyShiftRequest = {
  employeeName: string
  /** Пост из версии паспорта, действующей на дату смены (она не меняется). */
  sectorId: string
  postId: string
  note: string | null
  /** §21.34 — те же два ключа канонического протокола обхода, что у создания. */
  override?: boolean
  override_reason?: string
}

export type UpdateDutyShiftResponse = DutyShift

/** Отмена смены. Причина обязательна — см. `DutyShiftCancellation`. */
export interface CancelDutyShiftRequest {
  reason: string
}

export type CancelDutyShiftResponse = DutyShift

export type AcknowledgeDutyShiftResponse = DutyShift
export type ClockInDutyShiftResponse = DutyShift
export type ClockOutDutyShiftResponse = DutyShift

/** §21.28-21.30 — весь месячный план одним ответом: сетка «объект × день»,
 * серверные KPI (§21.29), конфликты с серверной severity (§21.34), шапка с
 * lifecycle и action policy (§21.27-21.28) и явный список показателей, которых
 * у модели нет (§35). Шапка едет ЗДЕСЬ, а не отдельным запросом: доступность
 * действий выведена из того же снимка смен, что KPI и конфликты, и разъехаться
 * с ними не должна. */
export interface MonthlyDutyPlanResponse extends MonthlyDutyPlan {
  header: MonthlyPlanHeader
}

/** §21.27, действия lifecycle. Месяц — единственный параметр: план на месяц
 * один, отдельного идентификатора у него нет.
 *
 * `type`, а не `interface`: переменные `useApiMutation` обязаны удовлетворять
 * `Record<string, unknown>`, а неявный index signature есть только у
 * type-алиасов (тот же приём, что `CreateDutyShiftRequest`). */
export type MonthlyPlanActionRequest = {
  month: string
}

export type MonthlyPlanActionResponse = MonthlyPlanRecord

export interface ListCombatDutyTypesResponse {
  results: CombatDutyTypeDefinition[]
}

export interface ListDutyRoutesResponse {
  results: DutyRoute[]
}

export interface ListCombatRosterCandidatesResponse {
  results: CombatRosterCandidate[]
}

export interface ListCombatDutyShiftsResponse {
  results: CombatDutyShift[]
}

export interface SubmitCombatGroupRequest {
  groupLeaderEmployeeName: string
  memberEmployeeNames: string[]
  reserveEmployeeNames: string[]
}

export type SubmitCombatGroupResponse = CombatDutyShift

export interface ReviewCombatGroupRequest {
  decision: 'ACCEPT' | 'RETURN'
  returnReason: string | null
}

export type ReviewCombatGroupResponse = CombatDutyShift

export interface AcknowledgeCombatDutyRequest {
  employeeName: string
}

export type AcknowledgeCombatDutyResponse = CombatDutyShift

export type CheckInCombatDutyResponse = CombatDutyShift

export interface CompleteCombatDutyRequest {
  actualMemberNames: string[]
}

export type CompleteCombatDutyResponse = CombatDutyShift

export interface RequestCombatDutyReplacementRequest {
  outgoingEmployeeName: string
  incomingEmployeeName: string
  reasonCode: string
  safeComment: string | null
}

export type RequestCombatDutyReplacementResponse = CombatDutyShift

/** §24.1 «формирование потребности на период» — заводит новую смену со
 * `submission: null` (сразу попадает в очередь «Требует подачи»). */
export interface CreateCombatDutyShiftRequest {
  businessDate: string
  dutyTypeCode: string
  routeIds: string[]
  coverageMode: DutyRouteCoverageMode
  requiredEmployees: number
}

export type CreateCombatDutyShiftResponse = CombatDutyShift

/** §24.22 «Передача и завершение смены», сокращённая до checkpoint'а сдачи
 * (см. FRONTEND_DECISIONS A55) — обязательна ДО `completeCombatDuty`. */
export interface SubmitCombatDutyHandoverRequest {
  unresolvedIncidents: string
  remarks: string
  confirmedByEmployeeName: string
}

export type SubmitCombatDutyHandoverResponse = CombatDutyShift
