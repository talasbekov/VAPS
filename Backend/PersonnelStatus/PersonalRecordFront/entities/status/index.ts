// Публичный API сущности status

export type { EmployeeStatusType } from "./model";
export {
  EMPLOYEE_STATUS_LABELS,
  EMPLOYEE_STATUS_COLORS,
  EMPLOYEE_STATUS_CODE_BY_LABEL,
  EMPLOYEE_STATUS_ITEMS,
  getEmployeeStatusLabel,
  getEmployeeStatusColor,
} from "./model";

// Подписи и цвета ПО СПРАВОЧНИКУ (Plane №366). Таблицы выше остаются запасным
// путём — они отвечают, пока каталог не доехал; источником подписи служит хук.
export { useStatusNaming } from "./naming";
export type { StatusNaming } from "./naming";

export { StatusBadge } from "./ui/StatusBadge";
