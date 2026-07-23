// Pending-контракты Smart Josparlau (§7.5): Backend/VAPS/schema.yaml НЕ несёт
// операций реестра ОМ — Wire DTO ниже НЕ generated, статус
// `backend-contract-pending` (реестр — docs/frontend/FRONTEND_MOCK_API_CONTRACT.md).
// Один контракт = ОДИН источник истины для hook (api/queries.ts), MSW handler
// (mocks/handlers.ts) и fixture (mocks/fixtures.ts) — не создавать параллельных
// несовместимых типов (§7.5 явный запрет).
import type {
  ClosureDirectionSummary,
  JournalEntryType,
  PersonnelSummarySnapshot,
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
  objectName: string
  businessDate: string
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
