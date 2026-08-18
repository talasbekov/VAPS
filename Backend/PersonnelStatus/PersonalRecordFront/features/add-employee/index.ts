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
export { flattenDivisions } from "./lib/utils";

// Правила формы — единственный источник, схема
export { employeeFormSchema, EMPTY_EMPLOYEE_FORM } from "./model/schema";
export type { EmployeeFormValues } from "./model/schema";








