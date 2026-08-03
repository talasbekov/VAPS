// Домен «Охранное мероприятие» (ОМ). Полный жизненный цикл:
// bulletin → recon → demand → forces → placement → approval →
// acknowledgement → conduct → closed.
/**
 * Снимок привязки ОМ к опубликованной версии паспорта объекта. Именно снимок,
 * а не ссылка: публикация новой версии паспорта не переписывает согласованную
 * расстановку. objectName продублирован сознательно — переименование объекта
 * не должно задним числом менять заархивированные документы.
 */
export interface PassportBinding {
  objectId: string;
  objectName: string;
  versionId: string;
  versionNumber: number;
  /** Дата, с которой действует привязанная версия (YYYY-MM-DD). */
  effectiveFrom: string;
  boundAt: string;
}

export const SECURITY_EVENT_STAGES = [
  "BULLETIN",
  "RECON",
  "DEMAND",
  "FORCES",
  "PLACEMENT",
  "APPROVAL",
  "ACKNOWLEDGEMENT",
  "CONDUCT",
  "CLOSED",
] as const;

export type SecurityEventStage = (typeof SECURITY_EVENT_STAGES)[number];

/** Результат проверки пункта чек-листа/поста рекогносцировки. */
export type ReconCheckResult = "MATCHES" | "NEEDS_CHANGES" | null;

export interface ReconChecklistItem {
  id: string;
  label: string;
  done: boolean;
  result: ReconCheckResult;
  comment: string;
}

/**
 * Строка «Посты и секторы» рекогносцировки — event-specific расчёт на основе
 * паспорта; правка строки не редактирует паспорт. sourceSectorId/sourcePostId
 * заполнены при импорте из привязанной версии паспорта, null у ручных строк.
 */
export interface ReconSectorPost {
  id: string;
  sector: string;
  post: string;
  task: string;
  need: number;
  requirements: string;
  result: ReconCheckResult;
  comment: string;
  sourceSectorId: string | null;
  sourcePostId: string | null;
  /** Требование поста к рейтингу; null — требования нет (не «ноль»). */
  minRating: number | null;
}

/** Строка потребности в силах. */
export interface StaffingDemandRow {
  id: string;
  sector: string;
  task: string;
  shift: string;
  need: number;
  group: string;
  requirements: string;
  comment: string;
}

export type ForceRequestStatus =
  | "NOT_SENT"
  | "SENT"
  | "PARTIALLY_ALLOCATED"
  | "ALLOCATED";

/** Запрос группе — агрегат, автосформированный при утверждении потребности. */
export interface ForceRequest {
  id: string;
  group: string;
  requestedCount: number;
  allocatedCount: number;
  status: ForceRequestStatus;
  comment: string;
}

/** Назначение сотрудника на пост. Двойное назначение внутри одного ОМ запрещено. */
export interface PlacementAssignment {
  id: string;
  postId: string;
  employeeId: string;
  employeeName: string;
  /** Ознакомление: null до подтверждения. */
  acknowledgedAt: string | null;
  /** Обоснование обхода предупреждения по рейтингу; заполнено только если предупреждение было. */
  ratingOverrideReason: string | null;
}

export type ApprovalStatus = "PENDING" | "APPROVED" | "RETURNED";

/** Внешний кадровый read-only снимок — только для подбора кандидатов. */
export interface PersonnelSummarySnapshot {
  id: string;
  name: string;
  rankLabel: string;
  unit: string;
}

export type JournalEntryType = "INSTRUCTION" | "ORDER" | "INCIDENT" | "REPLACEMENT";

export interface JournalEntry {
  id: string;
  type: JournalEntryType;
  title: string;
  description: string;
  createdAt: string;
}

/** Итог направления при закрытии (итоги всех направлений обязательны). */
export interface ClosureDirectionSummary {
  direction: string;
  summary: string;
}

export interface SecurityEvent {
  id: string;
  code: string;
  title: string;
  /** Объект реестра; null — ОМ заведено до появления привязки. */
  objectId: string | null;
  /** Снимок имени объекта: показывается и там, где objectId — null. */
  objectName: string;
  /** Версия паспорта на дату ОМ; null обрабатывается явно. */
  passportBinding: PassportBinding | null;
  businessDate: string;
  stage: SecurityEventStage;
  /** Готовность текущей стадии, 0–100 (демонстрационная метрика). */
  readinessPercent: number;
  forceNeed: number;
  conflictsCount: number;
  ownerName: string;
  /** Бюллетень: краткое описание, обязательное поле этапа BULLETIN. */
  briefDescription: string;
  /** Бюллетень: первичные задачи направлениям. */
  initialTasks: string;
  reconChecklist: ReconChecklistItem[];
  reconSectorPosts: ReconSectorPost[];
  demandRows: StaffingDemandRow[];
  demandApproved: boolean;
  forceRequests: ForceRequest[];
  placementAssignments: PlacementAssignment[];
  approvalStatus: ApprovalStatus;
  approvalComment: string;
  journalEntries: JournalEntry[];
  closureDirectionSummaries: ClosureDirectionSummary[];
  closedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

// ── Контракты API (реального бэка нет — pending, см. отчёт) ──────────────

export const SECURITY_EVENTS_PATH = "/api/ops/security-events/";

export function securityEventDetailPath(id: string): string {
  return `${SECURITY_EVENTS_PATH}${id}/`;
}

export const BINDABLE_OBJECTS_PATH = `${SECURITY_EVENTS_PATH}bindable-objects/`;

export interface ListSecurityEventsParams {
  search: string;
  stage: SecurityEventStage | "ALL";
  page: number;
  pageSize: number;
}

/** LimitOffset-подобный конверт — канон пагинируемых эндпоинтов. */
export interface ListSecurityEventsResponse {
  count: number;
  next: string | null;
  previous: string | null;
  results: SecurityEvent[];
}

export interface CreateSecurityEventRequest extends Record<string, unknown> {
  title: string;
  /** ОМ заводится НА ОБЪЕКТ реестра — иначе версию паспорта не к чему привязать. */
  objectId: string;
  businessDate: string;
}

/** Строка выпадающего списка объектов в форме создания ОМ. */
export interface BindableObject {
  id: string;
  name: string;
  code: string;
  /** 0 — у объекта нет ни одной опубликованной версии паспорта. */
  publishedVersionCount: number;
}

export interface ListBindableObjectsResponse {
  results: BindableObject[];
}

// ── Контракты операций этапов карточки ОМ ────────────────────────────────

export interface UpdateBulletinRequest extends Record<string, unknown> {
  briefDescription: string;
  initialTasks: string;
}

export interface UpdateReconRequest extends Record<string, unknown> {
  checklist: ReconChecklistItem[];
  sectorPosts: ReconSectorPost[];
}

/** Секция потребности не даёт отдельного «сохранить черновик» — одна операция
 * сохраняет строки И утверждает потребность (без «сохранено, не утверждено»). */
export interface UpdateDemandRequest extends Record<string, unknown> {
  rows: StaffingDemandRow[];
}

export interface UpdateForceAllocationRequest extends Record<string, unknown> {
  allocatedCount: number;
  comment: string;
}

export interface AssignPlacementRequest extends Record<string, unknown> {
  postId: string;
  employeeId: string;
  /** Протокол обхода мягкого конфликта: оба поля добавляет confirmOverride
   * в корень тела — своего протокола у рейтинга нет намеренно. */
  override?: boolean;
  override_reason?: string;
}

export interface ReturnPlacementRequest extends Record<string, unknown> {
  comment: string;
}

export interface AddJournalEntryRequest extends Record<string, unknown> {
  type: JournalEntryType;
  title: string;
  description: string;
}

export interface CloseSecurityEventRequest extends Record<string, unknown> {
  directionSummaries: ClosureDirectionSummary[];
}

/** Замена выбывшего: без авто-подбора кандидата — только ручной выбор,
 * атомарная замена одной мутацией (снять + назначить + запись в журнал). */
export interface ReplaceAssignmentRequest extends Record<string, unknown> {
  assignmentId: string;
  incomingEmployeeId: string;
  reasonCode: string;
}

export const OPS_PERSONNEL_PATH = "/api/ops/personnel/";

export interface ListPersonnelResponse {
  results: PersonnelSummarySnapshot[];
}

export function securityEventBulletinPath(id: string): string {
  return `${SECURITY_EVENTS_PATH}${id}/bulletin/`;
}
export function securityEventBulletinCompletePath(id: string): string {
  return `${SECURITY_EVENTS_PATH}${id}/bulletin/complete/`;
}
export function securityEventReconPath(id: string): string {
  return `${SECURITY_EVENTS_PATH}${id}/recon/`;
}
export function securityEventReconImportPath(id: string): string {
  return `${SECURITY_EVENTS_PATH}${id}/recon/import-from-passport/`;
}
export function securityEventReconCompletePath(id: string): string {
  return `${SECURITY_EVENTS_PATH}${id}/recon/complete/`;
}
export function securityEventDemandApprovePath(id: string): string {
  return `${SECURITY_EVENTS_PATH}${id}/demand/approve/`;
}
export function securityEventForceAllocationPath(
  id: string,
  requestId: string
): string {
  return `${SECURITY_EVENTS_PATH}${id}/forces/${requestId}/`;
}
export function securityEventForcesCompletePath(id: string): string {
  return `${SECURITY_EVENTS_PATH}${id}/forces/complete/`;
}
export function securityEventPlacementAssignPath(id: string): string {
  return `${SECURITY_EVENTS_PATH}${id}/placement/assign/`;
}
export function securityEventPlacementUnassignPath(
  id: string,
  assignmentId: string
): string {
  return `${SECURITY_EVENTS_PATH}${id}/placement/${assignmentId}/`;
}
export function securityEventPlacementCompletePath(id: string): string {
  return `${SECURITY_EVENTS_PATH}${id}/placement/complete/`;
}
export function securityEventApprovalApprovePath(id: string): string {
  return `${SECURITY_EVENTS_PATH}${id}/approval/approve/`;
}
export function securityEventApprovalReturnPath(id: string): string {
  return `${SECURITY_EVENTS_PATH}${id}/approval/return/`;
}
// Раздельные сегменты ("acknowledge" vs "acknowledgement/complete") — иначе
// path-to-regexp у MSW матчит /acknowledgement/complete/ более ранним
// :assignmentId-роутом (assignmentId="complete") и отвечает не тот handler.
export function securityEventAcknowledgePath(
  id: string,
  assignmentId: string
): string {
  return `${SECURITY_EVENTS_PATH}${id}/acknowledge/${assignmentId}/`;
}
export function securityEventAcknowledgementCompletePath(id: string): string {
  return `${SECURITY_EVENTS_PATH}${id}/acknowledgement/complete/`;
}
export function securityEventJournalPath(id: string): string {
  return `${SECURITY_EVENTS_PATH}${id}/journal/`;
}
export function securityEventReplaceAssignmentPath(id: string): string {
  return `${SECURITY_EVENTS_PATH}${id}/conduct/replace/`;
}
export function securityEventClosePath(id: string): string {
  return `${SECURITY_EVENTS_PATH}${id}/close/`;
}
