// «Боевые группы на Трассе» (§24.5-24.10) — нативный порт: процесс §24.1 от
// потребности до факта: формирование потребности (requiredEmployees) → подача
// составом (leader+members+reserve) → рассмотрение (принять/вернуть с
// причиной) → после принятия: индивидуальное ознакомление каждого (БЕЗ
// резерва) → заступление → сдача смены (checkpoint §24.22) → факт несения
// (фактический состав может отличаться от планового) → замена участника ДО
// заступления (§24.21).
//
// НЕ реализовано (честное подмножество, как в SPA): публикация графика
// комплектования отдельным шагом, requiredGroups/requiredPosts (§24.4),
// ротация экипажей §24.22 (только checkpoint сдачи), Conflict Repository
// §24.17 (только внутрифичевый DOUBLE_ASSIGNMENT), revision/optimistic
// concurrency, подача от имени другого лица.

/** §24.9-24.10 — Трасса и набор Трасс, СОБСТВЕННЫЙ реестр (не шарится с
 * направлением «Трасса» внутри ОМ: разные процессы, разные ID-пространства). */
export interface DutyRoute {
  routeId: string;
  safeLabel: string;
}

export type DutyRouteCoverageMode = "SEQUENTIAL" | "PARALLEL" | "RESERVE";

export interface DutyRouteSet {
  routeSetId: string;
  safeLabel: string;
  coverageMode: DutyRouteCoverageMode;
  routeIds: string[];
}

/** Кандидат в состав — собственный снапшот фичи (склейка с чужими реестрами
 * по ФИО дала бы ложные совпадения). */
export interface CombatRosterCandidate {
  employeeName: string;
  unitName: string;
}

export type CombatSubmissionState = "SUBMITTED" | "RETURNED" | "ACCEPTED";

/** §24.13 sub-lifecycle ПОСЛЕ принятия состава: линейный READY-путь без
 * HANDOVER/BLOCKED/EXPIRED. null, пока состав не принят. */
export type CombatDutyExecutionState =
  | "PENDING_ACKNOWLEDGEMENT"
  | "READY"
  | "ACTIVE"
  | "COMPLETED";

/** §24.22 «Передача и завершение смены», сокращено до checkpoint'а сдачи:
 * модель — один экипаж на businessDate, без ротации; реализована только часть
 * «сдающий фиксирует данные передачи». Обязателен ПЕРЕД завершением. */
export interface CombatDutyHandover {
  /** Пустая строка — сдающий явно отметил «нет незакрытых происшествий». */
  unresolvedIncidents: string;
  remarks: string;
  confirmedByEmployeeName: string;
  confirmedAt: string;
}

export interface CombatDutyExecution {
  stateCode: CombatDutyExecutionState;
  /** §24.19 — каждый (старший+состав, БЕЗ резерва) подтверждает отдельно;
   * READY — когда список покрывает leader+members целиком. */
  acknowledgedMemberNames: string[];
  actualStart: string | null;
  actualEnd: string | null;
  /** §24.23 «плановое назначение нельзя автоматически считать фактическим
   * участием» — фактический состав задаётся отдельно при завершении. */
  actualMemberNames: string[] | null;
  /** null, пока сдача смены не оформлена; завершение требует handover. */
  handover: CombatDutyHandover | null;
}

/** §24.21 «после утверждения нельзя просто поменять сотрудника в массиве» —
 * запись истории замены (упрощено: атомарно, без approval-шага). */
export interface DutyReplacementRecord {
  replacementId: string;
  outgoingEmployeeName: string;
  incomingEmployeeName: string;
  reasonCode: string;
  safeComment: string | null;
  appliedAt: string;
}

/** Упрощённая проекция подачи состава (§24.6). */
export interface CombatDutyRosterSubmission {
  submittedByUnitName: string;
  groupLeaderEmployeeName: string;
  memberEmployeeNames: string[];
  reserveEmployeeNames: string[];
  stateCode: CombatSubmissionState;
  returnReason: string | null;
  submittedAt: string;
  updatedAt: string;
  execution: CombatDutyExecution | null;
  /** История замен, самая свежая последней. */
  replacements: DutyReplacementRecord[];
}

/** Смена боевой группы. submission === null — «Требует подачи». */
export interface CombatDutyShift {
  id: string;
  businessDate: string;
  dutyTypeCode: string;
  routeSet: DutyRouteSet;
  submission: CombatDutyRosterSubmission | null;
  updatedAt: string;
  /** §24.1 «формирование потребности» — минимальное числовое требование. */
  requiredEmployees: number | null;
}

/** Duty Type Registry боевых групп (§24.3 — виды не хардкодятся во фронте). */
export interface CombatDutyTypeDefinition {
  dutyTypeCode: string;
  safeLabel: string;
  supportsMultipleRoutes: boolean;
}

// ── Пути API (pending-контракт мок-слоя) ─────────────────────────────────

export const COMBAT_DUTY_TYPES_PATH = "/api/ops/combat-duty-types/";
export const COMBAT_ROUTES_PATH = "/api/ops/combat-routes/";
export const COMBAT_ROSTER_CANDIDATES_PATH = "/api/ops/combat-roster-candidates/";
export const COMBAT_DUTY_SHIFTS_PATH = "/api/ops/combat-duty-shifts/";

export function combatSubmitPath(id: string): string {
  return `${COMBAT_DUTY_SHIFTS_PATH}${encodeURIComponent(id)}/submit/`;
}
export function combatReviewPath(id: string): string {
  return `${COMBAT_DUTY_SHIFTS_PATH}${encodeURIComponent(id)}/review/`;
}
export function combatAcknowledgePath(id: string): string {
  return `${COMBAT_DUTY_SHIFTS_PATH}${encodeURIComponent(id)}/acknowledge/`;
}
export function combatCheckInPath(id: string): string {
  return `${COMBAT_DUTY_SHIFTS_PATH}${encodeURIComponent(id)}/check-in/`;
}
export function combatCompletePath(id: string): string {
  return `${COMBAT_DUTY_SHIFTS_PATH}${encodeURIComponent(id)}/complete/`;
}
export function combatReplacePath(id: string): string {
  return `${COMBAT_DUTY_SHIFTS_PATH}${encodeURIComponent(id)}/replace/`;
}
export function combatHandoverPath(id: string): string {
  return `${COMBAT_DUTY_SHIFTS_PATH}${encodeURIComponent(id)}/handover/`;
}
// Шаблоны для MSW — литералами (фабрика энкодит ":" в %3A).
export const COMBAT_SUBMIT_PATH_PATTERN =
  "/api/ops/combat-duty-shifts/:shiftId/submit/";
export const COMBAT_REVIEW_PATH_PATTERN =
  "/api/ops/combat-duty-shifts/:shiftId/review/";
export const COMBAT_ACKNOWLEDGE_PATH_PATTERN =
  "/api/ops/combat-duty-shifts/:shiftId/acknowledge/";
export const COMBAT_CHECKIN_PATH_PATTERN =
  "/api/ops/combat-duty-shifts/:shiftId/check-in/";
export const COMBAT_COMPLETE_PATH_PATTERN =
  "/api/ops/combat-duty-shifts/:shiftId/complete/";
export const COMBAT_REPLACE_PATH_PATTERN =
  "/api/ops/combat-duty-shifts/:shiftId/replace/";
export const COMBAT_HANDOVER_PATH_PATTERN =
  "/api/ops/combat-duty-shifts/:shiftId/handover/";

// ── Контракты запросов/ответов ───────────────────────────────────────────

export interface ListCombatDutyTypesResponse {
  results: CombatDutyTypeDefinition[];
}

export interface ListDutyRoutesResponse {
  results: DutyRoute[];
}

export interface ListCombatRosterCandidatesResponse {
  results: CombatRosterCandidate[];
}

export interface ListCombatDutyShiftsResponse {
  results: CombatDutyShift[];
}

export type SubmitCombatGroupRequest = {
  groupLeaderEmployeeName: string;
  memberEmployeeNames: string[];
  reserveEmployeeNames: string[];
};

export type ReviewCombatGroupRequest = {
  decision: "ACCEPT" | "RETURN";
  returnReason: string | null;
};

export type AcknowledgeCombatDutyRequest = {
  employeeName: string;
};

export type CompleteCombatDutyRequest = {
  actualMemberNames: string[];
};

export type RequestCombatDutyReplacementRequest = {
  outgoingEmployeeName: string;
  incomingEmployeeName: string;
  reasonCode: string;
  safeComment: string | null;
};

/** §24.1 — заводит новую смену со submission: null («Требует подачи»). */
export type CreateCombatDutyShiftRequest = {
  businessDate: string;
  dutyTypeCode: string;
  routeIds: string[];
  coverageMode: DutyRouteCoverageMode;
  requiredEmployees: number;
};

export type SubmitCombatDutyHandoverRequest = {
  unresolvedIncidents: string;
  remarks: string;
  confirmedByEmployeeName: string;
};

// ── Подписи состояний ────────────────────────────────────────────────────

export const SUBMISSION_STATE_LABEL: Record<CombatSubmissionState, string> = {
  SUBMITTED: "Подано, ожидает рассмотрения",
  RETURNED: "Возвращено на доработку",
  ACCEPTED: "Принято",
};

export const EXECUTION_STATE_LABEL: Record<CombatDutyExecutionState, string> = {
  PENDING_ACKNOWLEDGEMENT: "Ожидает ознакомления состава",
  READY: "Ознакомлены, готовы к заступлению",
  ACTIVE: "Заступили, несут службу",
  COMPLETED: "Дежурство завершено",
};

export const COVERAGE_MODE_LABEL: Record<DutyRouteCoverageMode, string> = {
  SEQUENTIAL: "последовательно",
  PARALLEL: "параллельно",
  RESERVE: "основная/резервная",
};
