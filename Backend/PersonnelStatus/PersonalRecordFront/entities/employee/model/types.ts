// Типы для сущности Employee (UI-представление)
export interface Employee {
  id: string;
  number: number;
  name: string;
  position: string;
  department: string;
  departmentId: string;
  status: string;
  phone: string;
  email: string;
  hireDate: string;
  birthDate: string;
  address: string;
  manager: string;
  photo?: string;
}
