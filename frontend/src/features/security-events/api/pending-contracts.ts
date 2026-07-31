// Pending-контракты Smart Josparlau (§7.5): Backend/VAPS/schema.yaml НЕ несёт
// операций реестра ОМ — Wire DTO ниже НЕ generated, статус
// `backend-contract-pending` (реестр — docs/frontend/FRONTEND_MOCK_API_CONTRACT.md).
// Один контракт = ОДИН источник истины для hook (api/queries.ts), MSW handler
// (mocks/handlers.ts) и fixture (mocks/fixtures.ts) — не создавать параллельных
// несовместимых типов (§7.5 явный запрет).
import type {
  ClosureDirectionSummary,
  PassportBinding,
  JournalEntryType,
  PersonnelSummarySnapshot,
  PlacementRatingRow,
  ReconChecklistItem,
  ReconSectorPost,
  SecurityEvent,
  SecurityEventStage,
  StaffingDemandRow,
} from '../model/types'

export const SECURITY_EVENTS_PATH = '/api/ops/security-events/'
/** external-personnel-contract-pending (§7.1): read-only внешний кадровый источник. */
export const PERSONNEL_PATH = '/api/ops/personnel/'

export interface ListPersonnelResponse {
  results: PersonnelSummarySnapshot[]
}

export interface ListSecurityEventsParams {
  search: string
  stage: SecurityEventStage | 'ALL'
  page: number
  pageSize: number
}

/** LimitOffset-подобный envelope — тот же канон, что существующие пагинируемые endpoints (§7.4). */
export interface ListSecurityEventsResponse {
  count: number
  next: string | null
  previous: string | null
  results: SecurityEvent[]
}

export interface CreateSecurityEventRequest extends Record<string, unknown> {
  title: string
  /**
   * §9.6: мероприятие заводится НА ОБЪЕКТ реестра, а не на строку текста —
   * без id объекта версию паспорта не к чему привязать. Имя объекта в запросе
   * больше не передаётся: его снимок делает сервер, чтобы клиент не мог
   * разойтись с реестром.
   */
  objectId: string
  businessDate: string
}

/** Строка выпадающего списка объектов в форме создания ОМ (§9.6). */
export interface BindableObject {
  id: string
  name: string
  code: string
  /** 0 — у объекта нет ни одной опубликованной версии паспорта. */
  publishedVersionCount: number
}

export interface ListBindableObjectsResponse {
  results: BindableObject[]
}

/**
 * Производный взгляд на привязку ОМ к версии паспорта (§9.6). Отдельный
 * endpoint, а не поля в `SecurityEvent`: `stale`/`applicable*` считаются на
 * каждом чтении по ЖИВОМУ реестру объектов, тогда как сам ОМ хранит только
 * неизменяемый снимок привязки.
 */
export interface SecurityEventPassportView {
  objectId: string | null
  /** false — объекта с таким id в реестре нет (или ОМ вообще не привязан). */
  objectKnown: boolean
  binding: PassportBinding | null
  applicableVersionId: string | null
  applicableVersionNumber: number | null
  /** §9.6 «предупреждение об устаревшей версии» — действует версия новее привязанной. */
  stale: boolean
  /** Сколько постов привязанной версии ещё не перенесено в расчёт ОМ. */
  importablePostCount: number
}

export type CreateSecurityEventResponse = SecurityEvent

export interface UpdateBulletinRequest extends Record<string, unknown> {
  briefDescription: string
  initialTasks: string
}

export type UpdateBulletinResponse = SecurityEvent

export interface UpdateReconRequest extends Record<string, unknown> {
  checklist: ReconChecklistItem[]
  sectorPosts: ReconSectorPost[]
}

export type UpdateReconResponse = SecurityEvent
export type CompleteReconResponse = SecurityEvent

export function securityEventDetailPath(id: string): string {
  return `${SECURITY_EVENTS_PATH}${id}/`
}

export function securityEventBulletinPath(id: string): string {
  return `${SECURITY_EVENTS_PATH}${id}/bulletin/`
}

export function securityEventPassportPath(id: string): string {
  return `${SECURITY_EVENTS_PATH}${id}/passport/`
}

export function securityEventReconImportPath(id: string): string {
  return `${SECURITY_EVENTS_PATH}${id}/recon/import-from-passport/`
}

export const BINDABLE_OBJECTS_PATH = `${SECURITY_EVENTS_PATH}bindable-objects/`

export type ImportReconPostsResponse = SecurityEvent

export function securityEventReconPath(id: string): string {
  return `${SECURITY_EVENTS_PATH}${id}/recon/`
}

export function securityEventReconCompletePath(id: string): string {
  return `${SECURITY_EVENTS_PATH}${id}/recon/complete/`
}

/** Секция 1 прототипа не даёт отдельного «сохранить черновик» — одна операция сохраняет строки И утверждает потребность (§7.5: одна операция = один запрос, без промежуточного «сохранено, не утверждено»). */
export interface UpdateDemandRequest extends Record<string, unknown> {
  rows: StaffingDemandRow[]
}
export type ApproveDemandResponse = SecurityEvent

export interface UpdateForceAllocationRequest extends Record<string, unknown> {
  allocatedCount: number
  comment: string
}
export type UpdateForceAllocationResponse = SecurityEvent
export type CompleteForcesResponse = SecurityEvent

export function securityEventDemandApprovePath(id: string): string {
  return `${SECURITY_EVENTS_PATH}${id}/demand/approve/`
}

export function securityEventForceAllocationPath(id: string, requestId: string): string {
  return `${SECURITY_EVENTS_PATH}${id}/forces/${requestId}/`
}

export function securityEventForcesCompletePath(id: string): string {
  return `${SECURITY_EVENTS_PATH}${id}/forces/complete/`
}

export interface AssignPlacementRequest extends Record<string, unknown> {
  postId: string
  employeeId: string
  /**
   * Протокол обхода мягкого конфликта (§19.24 «используй существующий workflow
   * override»). Оба поля добавляет `useApiMutation.confirmOverride` В КОРЕНЬ
   * тела — своего протокола у рейтинга нет намеренно: второй путь обхода
   * разошёлся бы с общим `ConflictDialog`.
   */
  override?: boolean
  override_reason?: string
}
export type AssignPlacementResponse = SecurityEvent
export type UnassignPlacementResponse = SecurityEvent
export type CompletePlacementResponse = SecurityEvent
export type ApprovePlacementResponse = SecurityEvent

export interface ReturnPlacementRequest extends Record<string, unknown> {
  comment: string
}
export type ReturnPlacementResponse = SecurityEvent

export function securityEventPlacementAssignPath(id: string): string {
  return `${SECURITY_EVENTS_PATH}${id}/placement/assign/`
}

export function securityEventPlacementUnassignPath(id: string, assignmentId: string): string {
  return `${SECURITY_EVENTS_PATH}${id}/placement/${assignmentId}/`
}

export function securityEventPlacementCompletePath(id: string): string {
  return `${SECURITY_EVENTS_PATH}${id}/placement/complete/`
}

/**
 * §19.24: краткая сводка рейтинга назначенных — ОТДЕЛЬНЫЙ ресурс, а не поле
 * мероприятия. Так у него своё право и свой отказ: закрытая сводка не отбирает
 * у расстановщика саму расстановку, а её отсутствие не притворяется пустым
 * списком назначений.
 */
export function securityEventPlacementRatingsPath(id: string): string {
  return `${SECURITY_EVENTS_PATH}${id}/placement/ratings/`
}

export interface ListPlacementRatingsResponse {
  results: PlacementRatingRow[]
  /** §19.3: выключенный флаг конфликтов виден клиенту, а не угадывается. */
  ratingConflictsEnabled: boolean
  /** `false` — сводка закрыта смотрящему: значения в строках `null`. */
  aggregateVisible: boolean
}

export function securityEventApprovalApprovePath(id: string): string {
  return `${SECURITY_EVENTS_PATH}${id}/approval/approve/`
}

export function securityEventApprovalReturnPath(id: string): string {
  return `${SECURITY_EVENTS_PATH}${id}/approval/return/`
}

export type AcknowledgePlacementResponse = SecurityEvent
export type CompleteAcknowledgementResponse = SecurityEvent

export interface AddJournalEntryRequest extends Record<string, unknown> {
  type: JournalEntryType
  title: string
  description: string
}
export type AddJournalEntryResponse = SecurityEvent

export interface CloseSecurityEventRequest extends Record<string, unknown> {
  directionSummaries: ClosureDirectionSummary[]
}
export type CloseSecurityEventResponse = SecurityEvent

/** §9.11 «Замена выбывшего сотрудника», сокращённо (см. FRONTEND_DECISIONS
 * A56): БЕЗ авто-подбора кандидата (REPLACEMENT-SUGGESTION-001 =
 * business-policy-pending по мастер-промпту, алгоритм не утверждён
 * заказчиком) — только ручной выбор, атомарная замена одной мутацией. */
export interface ReplaceAssignmentRequest extends Record<string, unknown> {
  assignmentId: string
  incomingEmployeeId: string
  reasonCode: string
}
export type ReplaceAssignmentResponse = SecurityEvent

export function securityEventReplaceAssignmentPath(id: string): string {
  return `${SECURITY_EVENTS_PATH}${id}/conduct/replace/`
}

// Раздельные сегменты ("acknowledge" vs "acknowledgement/complete") — иначе
// path-to-regexp у MSW матчит /acknowledgement/complete/ через более ранний
// :assignmentId-роут (assignmentId="complete") и отдаёт 404 от НЕ того handler'а.
export function securityEventAcknowledgePath(id: string, assignmentId: string): string {
  return `${SECURITY_EVENTS_PATH}${id}/acknowledge/${assignmentId}/`
}

export function securityEventAcknowledgementCompletePath(id: string): string {
  return `${SECURITY_EVENTS_PATH}${id}/acknowledgement/complete/`
}

export function securityEventJournalPath(id: string): string {
  return `${SECURITY_EVENTS_PATH}${id}/journal/`
}

export function securityEventClosePath(id: string): string {
  return `${SECURITY_EVENTS_PATH}${id}/close/`
}
