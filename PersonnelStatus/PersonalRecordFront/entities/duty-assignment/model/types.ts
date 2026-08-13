// Наряд — расшифровка статуса «На дежурстве»: КУДА заступил сотрудник.
//
// Запись рождается ровно в одном месте — в модалке «Статусы сотрудника»
// (features/employee-status-update) — и читается ровно в одном месте —
// в разделе «Дежурные силы» карточки объекта. Второго источника у карточки
// нет намеренно: сведения о заступивших, набираемые отдельно от статуса,
// расходятся со статусом молча.
//
// Хранилище — клиентское (см. ./store.ts): у EmployeeStatus на бэкенде полей
// наряда нет, а правка бэкенда в эту работу не входит. Формат записи специально
// повторяет то, что отдал бы сервер, чтобы подмена хранилища на HTTP-клиент
// была заменой ./store.ts, а не переписыванием потребителей.

/**
 * Вид дежурства. Ось «постовое/групповое» задаёт, ЧЕМ уточняется объект:
 * постом из паспорта объекта или группой. Реестр видов бэкенда
 * (/api/ops/duty-types/) этой оси не несёт — он делит дежурства по цели
 * (свой объект / охраняемый объект), поэтому реестр здесь свой.
 */
export type DutyKindCode = "POST" | "GROUP";

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
 * Группа для группового дежурства. Реестр фронтовый — у бэкенда групп нет:
 * «Трассы» боевых групп (/api/ops/combat-routes/) это другое ID-пространство
 * и другой процесс, склейка по имени дала бы ложные совпадения.
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
 * Кадровые поля (ФИО, звание, должность, департамент) — тоже снимок: карточка
 * объекта не ходит в кадровый API, она показывает, кем человек заступал.
 */
export interface DutyAssignment {
  /** Идентификатор строки таблицы сотрудников: `${staffUnitId}-${employeeId}`. */
  employeeKey: string;
  employeeName: string;
  /**
   * Звание. Пустая строка — источник его не отдал: сводка штатки
   * (/api/staff_unit/staff-units/directorate/) кладёт у сотрудника только
   * id/ФИО/текущий статус, а карточки сотрудника у этого бэкенда нет.
   * Карточка объекта в таком случае звание не печатает, а не пишет «—»:
   * прочерк читался бы как «звания нет».
   */
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

/** Действует ли наряд на дату (YYYY-MM-DD), границы включены. */
export function isAssignmentActiveOn(
  assignment: DutyAssignment,
  date: string
): boolean {
  return assignment.startDate <= date && date <= assignment.endDate;
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
