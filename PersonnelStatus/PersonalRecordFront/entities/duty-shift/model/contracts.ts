// Контракты API «План дежурств» (реального бэка нет — pending, см. отчёт).
import type {
  ConflictPolicy,
  DutyPlanConflict,
  DutyShift,
  DutyTypeDefinition,
  MonthlyPlanRecord,
} from "./types";
import type { DutyPlanAction } from "./plan-lifecycle";

export const DUTY_TYPES_PATH = "/api/ops/duty-types/";
export const DUTY_SHIFTS_PATH = "/api/ops/duty-shifts/";
export const DUTY_MONTHLY_PLAN_PATH = "/api/ops/duty-monthly-plan/";
export const DUTY_PLAN_OBJECTS_PATH = "/api/ops/duty-plan-objects/";
export const DUTY_CANDIDATES_PATH = "/api/ops/duty-candidates/";

export function dutyPlanDraftPath(): string {
  return `${DUTY_MONTHLY_PLAN_PATH}draft/`;
}
export function dutyPlanCheckPath(): string {
  return `${DUTY_MONTHLY_PLAN_PATH}check/`;
}
export function dutyPlanApprovePath(): string {
  return `${DUTY_MONTHLY_PLAN_PATH}approve/`;
}
export function dutyPlanReopenPath(): string {
  return `${DUTY_MONTHLY_PLAN_PATH}reopen/`;
}
export function dutyShiftDetailPath(id: string): string {
  return `${DUTY_SHIFTS_PATH}${id}/`;
}
export function dutyShiftCancelPath(id: string): string {
  return `${DUTY_SHIFTS_PATH}${id}/cancel/`;
}
export function dutyShiftAcknowledgePath(id: string): string {
  return `${DUTY_SHIFTS_PATH}${id}/acknowledge/`;
}
export function dutyShiftClockInPath(id: string): string {
  return `${DUTY_SHIFTS_PATH}${id}/clock-in/`;
}
export function dutyShiftClockOutPath(id: string): string {
  return `${DUTY_SHIFTS_PATH}${id}/clock-out/`;
}

export interface ListDutyTypesResponse {
  results: DutyTypeDefinition[];
  /** Правила конфликтов приходят вместе с видами — читаются вместе. */
  conflictPolicy: ConflictPolicy;
}

/**
 * Производный взгляд на привязку смены: сам снимок — в shift.passportBinding,
 * «какая версия действует сейчас» пересчитывается на каждом чтении.
 */
export interface DutyPassportStatus {
  shiftId: string;
  objectKnown: boolean;
  applicableVersionId: string | null;
  applicableVersionNumber: number | null;
  /** Действует версия новее привязанной — предупреждение, не ошибка. */
  stale: boolean;
}

/** KPI месяца — серверные, по всему месяцу, не по отрисованной части. */
export interface MonthlyDutyPlanKpi {
  totalShifts: number;
  activeShifts: number;
  cancelledShifts: number;
  hardConflicts: number;
  softConflicts: number;
}

/** Месячный план одним ответом: шапка lifecycle + смены + конфликты + KPI. */
export interface MonthlyDutyPlanResponse {
  month: string;
  /** null — черновик на месяц ещё не сформирован («плана нет» ≠ «черновик»). */
  record: MonthlyPlanRecord | null;
  actions: DutyPlanAction[];
  shifts: DutyShift[];
  passportStatuses: DutyPassportStatus[];
  conflicts: DutyPlanConflict[];
  conflictPolicy: ConflictPolicy;
  kpi: MonthlyDutyPlanKpi;
}

export type MonthlyPlanActionRequest = {
  month: string;
} & Record<string, unknown>;

/** Пост формы — из версии паспорта, действующей на дату (снимок). */
export interface DutyPlanPostOption {
  postId: string;
  postName: string;
  task: string;
  requirements: string;
}

export interface DutyPlanSectorOption {
  sectorId: string;
  sectorName: string;
  posts: DutyPlanPostOption[];
}

/** Объект в форме создания НА КОНКРЕТНУЮ ДАТУ; blockReason ≠ null — объект
 * виден, но недоступен, и причина видна сразу. */
export interface DutyPlanObjectOption {
  objectId: string;
  objectName: string;
  objectCode: string;
  passportState: string;
  applicableVersionId: string | null;
  applicableVersionNumber: number | null;
  applicableVersionEffectiveFrom: string | null;
  sectors: DutyPlanSectorOption[];
  blockReason: string | null;
}

export interface ListDutyPlanObjectsResponse {
  businessDate: string;
  results: DutyPlanObjectOption[];
}

/** Кандидат + единственный выводимый признак занятости. */
export interface DutyCandidateOption {
  employeeId: string;
  employeeName: string;
  unitName: string;
  positionName: string;
  /** Ближайшее дежурство не раньше запрошенной даты; null — таких нет. */
  nearestDutyDate: string | null;
  /** Дежурство ровно на запрошенную дату — пересечение (HARD). */
  busyOnRequestedDate: boolean;
}

export interface ListDutyCandidatesResponse {
  businessDate: string;
  results: DutyCandidateOption[];
}

/** Время начала/продолжительность не входят: одна смена = один календарный
 * день, продолжительность — у вида. override/override_reason — канон
 * 409-протокола (confirmOverride кладёт их в корень тела). */
export type CreateDutyShiftRequest = {
  businessDate: string;
  dutyTypeCode: string;
  objectId: string;
  sectorId: string;
  postId: string;
  employeeId: string;
  note: string | null;
  override?: boolean;
  override_reason?: string;
} & Record<string, unknown>;

/** Карточка смены одним ответом — согласованный срез. */
export interface DutyShiftDetail {
  shift: DutyShift;
  passportStatus: DutyPassportStatus;
  /** null — вида нет в реестре: карточка обязана показать это, а не
   * подставить дефолтные 24 часа. */
  dutyType: DutyTypeDefinition | null;
  /** Конфликты сотрудника, проявляющиеся в день этой смены. */
  conflicts: DutyPlanConflict[];
  conflictPolicy: ConflictPolicy;
}

export interface CancelDutyShiftRequest extends Record<string, unknown> {
  reason: string;
}

export interface ListDutyShiftsResponse {
  results: DutyShift[];
  passportStatuses: DutyPassportStatus[];
}
