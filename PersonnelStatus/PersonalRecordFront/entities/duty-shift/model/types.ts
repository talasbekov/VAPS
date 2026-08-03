// Домен «План дежурств» (индивидуальные суточные дежурства). Боевые группы
// на маршрутах — вне первой очереди порта (см. отчёт).
export type DutyTargetType = "OWN_OBJECT" | "PROTECTED_OBJECT";

/** Отдых после дежурства: HARD_BLOCK — назначение в период отдыха невозможно,
 * SOFT_OVERRIDE — возможно с обоснованием (через общий 409-протокол). */
export type DutyRestPolicy = "HARD_BLOCK" | "SOFT_OVERRIDE";

/** Действующие правила конфликтов; владелец — «Настройки», здесь читаются. */
export interface ConflictPolicy {
  restAfterDutyMode: DutyRestPolicy;
  /** null — политика не прочитана, применён строгий дефолт. */
  conflictPolicyVersion: string | null;
}

/** Виды дежурств не хардкодятся во фронте — реестр видов. */
export interface DutyTypeDefinition {
  dutyTypeCode: string;
  safeLabel: string;
  targetType: DutyTargetType;
  defaultDurationMinutes: number;
  requiresSenior: boolean;
  /** Срок отдыха — свойство ВИДА; режим — глобальная политика. */
  restAfterMinutes: number;
  /** Требование актуального паспорта — атрибут вида, не глобальная константа. */
  requiresCurrentPassport: boolean;
}

/**
 * Линейный цикл индивидуальной смены: PLANNED → ACKNOWLEDGED → ACTIVE →
 * COMPLETED. CANCELLED — тупик: отменить можно только не начатую смену;
 * отменённая остаётся в данных и видна в плане — удаление стёрло бы след
 * планирования.
 */
export type DutyShiftState =
  | "PLANNED"
  | "ACKNOWLEDGED"
  | "ACTIVE"
  | "COMPLETED"
  | "CANCELLED";

/** След отмены: причина обязательна — только она отличает отмену от ошибки данных. */
export interface DutyShiftCancellation {
  reason: string;
  cancelledAt: string;
}

/**
 * ХРАНИМЫЙ снимок привязки смены к опубликованной версии паспорта на момент
 * планирования (objectId/versionId/sectorId/postId + имена-снимки).
 * Производное «какая версия действует сейчас» — DutyPassportStatus,
 * пересчитывается на каждом чтении.
 */
export interface DutyPassportBinding {
  objectId: string;
  objectName: string;
  versionId: string;
  versionNumber: number;
  effectiveFrom: string;
  sectorId: string;
  sectorName: string;
  postId: string;
  postName: string;
  boundAt: string;
}

export interface DutyShift {
  id: string;
  businessDate: string;
  dutyTypeCode: string;
  target: {
    targetType: DutyTargetType;
    objectId: string;
    safeLabel: string;
  };
  employeeName: string;
  /** Устойчивый ID человека; null — исполнитель вне справочника. */
  employeeId: string | null;
  stateCode: DutyShiftState;
  acknowledgedAt: string | null;
  actualStart: string | null;
  actualEnd: string | null;
  updatedAt: string;
  passportBinding: DutyPassportBinding | null;
  /** null — поле не заполняли; пустая строка сюда не пишется. */
  note: string | null;
  cancellation: DutyShiftCancellation | null;
  /** Обоснование обхода SOFT-конфликта при создании; null — конфликта не было. */
  overrideReason: string | null;
}

// ── Конфликты ────────────────────────────────────────────────────────────

export type DutyConflictSeverity = "HARD" | "SOFT";
export type DutyConflictCode = "DUTY_OVERLAP" | "REST_AFTER_DUTY";

export interface DutyPlanConflict {
  conflictId: string;
  code: DutyConflictCode;
  /** Severity — серверная: фронт её не выводит. */
  severity: DutyConflictSeverity;
  employeeName: string;
  /** День, в который конфликт ПРОЯВЛЯЕТСЯ (у отдыха — день второй смены). */
  businessDate: string;
  message: string;
  policyVersion: string | null;
}

// ── Месячный план ────────────────────────────────────────────────────────

/** В данных два состояния; VALIDATED — результат проверки, не состояние. */
export type MonthlyPlanStateCode = "DRAFT" | "APPROVED";

/**
 * Результат последней проверки конфликтов. planFingerprint — отпечаток
 * состава месяца на момент проверки: утверждать можно только план, отпечаток
 * которого совпадает с текущим (иначе проверка «протухла» бы молча).
 */
export interface MonthlyPlanValidation {
  checkedAt: string;
  hardConflicts: number;
  softConflicts: number;
  /** Жёстких нет. Мягкие утверждению не мешают — они уже обойдены с
   * обоснованием при заведении смены. */
  passed: boolean;
  planFingerprint: string;
}

export type MonthlyPlanHistoryEvent =
  | "DRAFT_CREATED"
  | "VALIDATED"
  | "APPROVED"
  | "REOPENED";

/** История не перезаписывается — список только дополняется. */
export interface MonthlyPlanHistoryEntry {
  at: string;
  revision: number;
  event: MonthlyPlanHistoryEvent;
  note: string;
}

/**
 * План на месяц один (ключ — месяц). Утверждённый месяц закрыт для
 * планирующих мутаций; REOPEN поднимает revision и возвращает DRAFT.
 */
export interface MonthlyPlanRecord {
  /** YYYY-MM. */
  month: string;
  stateCode: MonthlyPlanStateCode;
  revision: number;
  createdAt: string;
  lastValidation: MonthlyPlanValidation | null;
  approvedAt: string | null;
  approvedBy: string | null;
  history: MonthlyPlanHistoryEntry[];
}
