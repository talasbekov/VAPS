// Lifecycle месячного плана и action policy шапки — чистая модель.
// Доступность кнопки приходит ОТ СЕРВЕРА (мок-слоя): страница получает
// готовый список действий с причинами недоступности и только рисует его.
// Действия возвращаются всегда все: скрытая кнопка не сообщает причину.
import type {
  DutyPlanConflict,
  DutyShift,
  MonthlyPlanHistoryEntry,
  MonthlyPlanRecord,
  MonthlyPlanValidation,
} from "./types";
import { monthOf } from "./conflicts";

export type DutyPlanActionCode =
  | "CREATE_DRAFT"
  | "CHECK_CONFLICTS"
  | "APPROVE"
  | "REOPEN"
  | "ADD_SHIFT";

/** reason заполнен ровно тогда, когда действие недоступно. */
export interface DutyPlanAction {
  code: DutyPlanActionCode;
  label: string;
  enabled: boolean;
  reason: string | null;
}

export interface DutyPlanActorRights {
  canManage: boolean;
  canApprove: boolean;
}

export const PLAN_STATE_LABEL: Record<MonthlyPlanRecord["stateCode"], string> = {
  DRAFT: "Черновик",
  APPROVED: "Утверждён",
};

export const PLAN_HISTORY_LABEL: Record<
  MonthlyPlanHistoryEntry["event"],
  string
> = {
  DRAFT_CREATED: "Сформирован черновик",
  VALIDATED: "Проверка конфликтов",
  APPROVED: "План утверждён",
  REOPENED: "Открыта новая редакция",
};

export const DUTY_STATE_LABEL: Record<DutyShift["stateCode"], string> = {
  PLANNED: "Запланировано",
  ACKNOWLEDGED: "Ознакомлен",
  ACTIVE: "На дежурстве",
  COMPLETED: "Завершено",
  CANCELLED: "Отменено",
};

/**
 * Отпечаток планового состава месяца: активные смены месяца + их updatedAt —
 * и появление смены, и правка обязаны обесценить прежнюю проверку; отменённая
 * смена из отпечатка ВЫПАДАЕТ.
 */
export function planFingerprint(
  month: string,
  shifts: readonly DutyShift[]
): string {
  return shifts
    .filter(
      (shift) =>
        monthOf(shift.businessDate) === month && shift.stateCode !== "CANCELLED"
    )
    .map((shift) => `${shift.id}@${shift.updatedAt}`)
    .sort()
    .join("|");
}

export function isValidationCurrent(
  validation: MonthlyPlanValidation | null,
  fingerprint: string
): boolean {
  return validation !== null && validation.planFingerprint === fingerprint;
}

export function buildValidation(
  checkedAt: string,
  conflicts: readonly DutyPlanConflict[],
  fingerprint: string
): MonthlyPlanValidation {
  const hardConflicts = conflicts.filter((c) => c.severity === "HARD").length;
  return {
    checkedAt,
    hardConflicts,
    softConflicts: conflicts.length - hardConflicts,
    // жёсткий конфликт — единственное, что валит проверку: мягкий уже прошёл
    // обход с обоснованием при заведении смены
    passed: hardConflicts === 0,
    planFingerprint: fingerprint,
  };
}

/** Операция заводит запись плана над уже заведёнными сменами месяца —
 * состава не предлагает и утверждением не является. */
export const DRAFT_LABEL = "Сформировать черновик";

const NO_MANAGE_REASON = "Нужно право планирования дежурств (ops.duty.manage).";
const NO_APPROVE_REASON =
  "Нужно право утверждения плана (ops.duty.approve_plan).";

/** Порядок проверок — от права к состоянию: отсутствие права не должно
 * маскироваться состоянием плана. */
export function buildPlanActions(
  record: MonthlyPlanRecord | null,
  rights: DutyPlanActorRights,
  validationIsCurrent: boolean
): DutyPlanAction[] {
  const state = record?.stateCode ?? null;
  const approvedLockReason =
    record === null
      ? null
      : `План месяца утверждён (редакция ${record.revision}) — изменения только в новой редакции.`;

  const createDraft = (): DutyPlanAction => {
    if (!rights.canManage) {
      return { code: "CREATE_DRAFT", label: DRAFT_LABEL, enabled: false, reason: NO_MANAGE_REASON };
    }
    if (record !== null) {
      return {
        code: "CREATE_DRAFT",
        label: DRAFT_LABEL,
        enabled: false,
        reason: `План на этот месяц уже создан (редакция ${record.revision}, ${PLAN_STATE_LABEL[record.stateCode].toLowerCase()}).`,
      };
    }
    return { code: "CREATE_DRAFT", label: DRAFT_LABEL, enabled: true, reason: null };
  };

  const checkConflicts = (): DutyPlanAction => {
    const label = "Проверить конфликты";
    if (!rights.canManage) {
      return { code: "CHECK_CONFLICTS", label, enabled: false, reason: NO_MANAGE_REASON };
    }
    if (record === null) {
      return {
        code: "CHECK_CONFLICTS",
        label,
        enabled: false,
        reason: "Плана на этот месяц нет — сначала сформируйте черновик.",
      };
    }
    if (state === "APPROVED") {
      return {
        code: "CHECK_CONFLICTS",
        label,
        enabled: false,
        reason:
          "План утверждён и закрыт для изменений: проверять нечего до открытия новой редакции.",
      };
    }
    return { code: "CHECK_CONFLICTS", label, enabled: true, reason: null };
  };

  const approve = (): DutyPlanAction => {
    const label = "Утвердить план";
    if (!rights.canApprove) {
      return { code: "APPROVE", label, enabled: false, reason: NO_APPROVE_REASON };
    }
    if (record === null) {
      return {
        code: "APPROVE",
        label,
        enabled: false,
        reason: "Плана на этот месяц нет — сначала сформируйте черновик.",
      };
    }
    if (state === "APPROVED") {
      return { code: "APPROVE", label, enabled: false, reason: "План уже утверждён." };
    }
    if (record.lastValidation === null) {
      return {
        code: "APPROVE",
        label,
        enabled: false,
        reason: "Проверка конфликтов не проводилась — она обязательна перед утверждением.",
      };
    }
    if (!validationIsCurrent) {
      return {
        code: "APPROVE",
        label,
        enabled: false,
        reason:
          "Состав месяца менялся после последней проверки — проверьте конфликты заново.",
      };
    }
    if (!record.lastValidation.passed) {
      return {
        code: "APPROVE",
        label,
        enabled: false,
        reason: `Проверка нашла жёстких конфликтов: ${record.lastValidation.hardConflicts}. Их нельзя обойти обоснованием.`,
      };
    }
    return { code: "APPROVE", label, enabled: true, reason: null };
  };

  const reopen = (): DutyPlanAction => {
    const label = "Открыть новую редакцию";
    if (!rights.canApprove) {
      return { code: "REOPEN", label, enabled: false, reason: NO_APPROVE_REASON };
    }
    if (state !== "APPROVED") {
      return {
        code: "REOPEN",
        label,
        enabled: false,
        reason: "Новая редакция открывается только для утверждённого плана.",
      };
    }
    return { code: "REOPEN", label, enabled: true, reason: null };
  };

  const addShift = (): DutyPlanAction => {
    const label = "Добавить дежурство";
    if (!rights.canManage) {
      return { code: "ADD_SHIFT", label, enabled: false, reason: NO_MANAGE_REASON };
    }
    if (state === "APPROVED") {
      return { code: "ADD_SHIFT", label, enabled: false, reason: approvedLockReason };
    }
    return { code: "ADD_SHIFT", label, enabled: true, reason: null };
  };

  return [createDraft(), checkConflicts(), approve(), reopen(), addShift()];
}
