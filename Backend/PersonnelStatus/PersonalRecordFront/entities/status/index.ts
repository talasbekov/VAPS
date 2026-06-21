// Публичный API сущности status

export type { EmployeeStatusType } from "./model";
export {
  EMPLOYEE_STATUS_LABELS,
  EMPLOYEE_STATUS_COLORS,
  EMPLOYEE_STATUS_CODE_BY_LABEL,
  EMPLOYEE_STATUS_ITEMS,
  SELECTABLE_STATUS_ITEMS,
  getEmployeeStatusLabel,
  getEmployeeStatusColor,
} from "./model";

export { StatusBadge } from "./ui/StatusBadge";
