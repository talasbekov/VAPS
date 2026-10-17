/**
 * Вид дежурства. Ось «постовое/групповое» задаёт, ЧЕМ уточняется объект:
 * постом из паспорта объекта или группой. Реестр видов бэкенда
 * (/api/ops/duty-types/) этой оси не несёт — он делит дежурства по цели
 * (свой объект / охраняемый объект), поэтому реестр здесь свой.
 */
export type DutyKindCode = "POST" | "GROUP";

export interface DutyPlacementInput {
  kind: DutyKindCode;
  object_id: string;
  post_id?: string;
  group_id?: string;
}

export interface DutyPlacement {
  kind: DutyKindCode;
  object_id: string;
  object_name: string;
  post_id: string | null;
  post_name: string | null;
  sector_name: string | null;
  group_id: string | null;
  group_name: string | null;
}

export interface ServerDutyAssignment {
  dispatch_assignment_id?: number;
  start_at?: string;
  end_at?: string;
  time_zone?: string;
  status_id: number | null;
  employee_id: number;
  employee_name: string;
  rank_name: string;
  position_name: string;
  department_name: string;
  placement: DutyPlacement;
  start_date: string;
  end_date: string;
  assigned_at: string;
}

export interface DutyKindDefinition {
  code: DutyKindCode;
  label: string;
}

export const DUTY_KINDS: readonly DutyKindDefinition[] = [
  { code: "POST", label: "Постовое" },
  { code: "GROUP", label: "Групповое" },
];

export function getDutyKindLabel(code: DutyKindCode | ""): string {
  return DUTY_KINDS.find((kind) => kind.code === code)?.label ?? "";
}

/**
 * Group identifiers are validated by the personnel-status backend.
 * Combat routes belong to a separate workflow and identifier space.
 */
export interface DutyGroupDefinition {
  id: string;
  name: string;
}

export const DUTY_GROUPS: readonly DutyGroupDefinition[] = [
  { id: "duty-group-1", name: "Группа №1" },
  { id: "duty-group-2", name: "Группа №2" },
  { id: "duty-group-3", name: "Группа №3" },
  { id: "duty-group-reserve", name: "Резервная группа" },
];

/**
 * Наряд одного сотрудника. Имена объекта/поста/группы хранятся СНИМКОМ рядом
 * с идентификаторами: карточка объекта показывает состав на выбранную дату, и
 * переименование поста задним числом не должно менять то, что было в наряде.
 *
 * Personnel labels come from the server current staff record.
 */
export interface DutyAssignment {
  shiftStart?: string;
  shiftEnd?: string;
  timeZone?: string;
  /** Stable status identifier used as the roster row key. */
  employeeKey: string;
  employeeName: string;
  /** Empty when no rank is assigned in the server personnel record. */
  rankName: string;
  positionName: string;
  departmentName: string;

  dutyKind: DutyKindCode;
  objectId: string;
  objectName: string;
  /** Заполнен при dutyKind === "POST". */
  postId: string | null;
  postName: string | null;
  /** Заполнен при dutyKind === "GROUP". */
  groupId: string | null;
  groupName: string | null;

  /** Период дежурства, YYYY-MM-DD включительно с обеих сторон. */
  startDate: string;
  endDate: string;
  /** Когда наряд оформили — для разбора расхождений. */
  assignedAt: string;
}

/** Пост или группа — то, подо что группируются люди в карточке объекта. */
export interface DutyForcesPlacement {
  key: string;
  label: string;
  assignments: DutyAssignment[];
}

export interface DutyForcesDepartment {
  departmentName: string;
  placements: DutyForcesPlacement[];
}
