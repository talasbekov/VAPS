// Типы для фичи добавления сотрудника

export interface CreateEmployeeFormData {
  firstName: string;
  lastName: string;
  middleName: string;
  iin: string;
  positionId: string;
  rankId: string;
  divisionId: string;
}

export interface CreateEmployeeRequest {
  employees: Array<{
    first_name: string;
    last_name: string;
    middle_name?: string;
    iin: string;
    rank?: number;
  }>;
  staff_units: Array<{
    division: number;
    position: number;
  }>;
}

export interface CreateEmployeeResponse {
  // Тип ответа от API после создания сотрудника
  // Можно расширить на основе реального ответа API
  id?: number;
  [key: string]: any;
}








