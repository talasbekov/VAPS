// Публичный API фичи add-employee

export { AddEmployeeDialog } from "./ui/AddEmployeeDialog";

// Экспортируем типы
export type {
  CreateEmployeeFormData,
  CreateEmployeeRequest,
  CreateEmployeeResponse,
} from "./model/types";

// Экспортируем API функции
export { createEmployee } from "./api/add-employee-api";

// Экспортируем утилиты
export { flattenDivisions, validateIIN, validateEmployeeForm } from "./lib/utils";








