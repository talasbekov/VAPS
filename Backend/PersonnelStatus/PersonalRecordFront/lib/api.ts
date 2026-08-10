// Конфигурация API для подключения к бэкенду
// В dev используем полный URL бэкенда (NEXT_PUBLIC_API_URL)
// В prod используем относительные пути (Next.js rewrites проксируют на backend)
import { BACKEND_URL } from "@/shared/config/env";
const API_BASE_URL = BACKEND_URL;

// Интерфейсы для API
export interface ApiResponse<T> {
  data: T;
  message?: string;
  success: boolean;
}

export interface Employee {
  id: string;
  name: string;
  position: string;
  status:
    | "in_service"
    | "vacation"
    | "leave_by_report"
    | "sick_leave"
    | "business_trip"
    | "training"
    | "competition"
    | "other_absence"
    | "on_duty"
    | "after_duty"
    | "seconded_from"
    | "seconded_to";
  statusState?: "planned" | "active" | "completed" | "cancelled";
  avatar: string;
  phone?: string;
  email?: string;
  department_id?: string;
  manager_id?: string;
  statusStartDate?: string;
  statusEndDate?: string;
}

export interface Department {
  id: string;
  name: string;
  head_id: string;
  parent_id?: string;
  type: "leadership" | "department" | "directorate" | "section";
  color?: string;
}

export interface OrgUnit {
  id: string;
  name: string;
  head: Employee;
  employees: Employee[];
  color: string;
  type: "leadership" | "department" | "directorate" | "section";
  children?: OrgUnit[];
}

// Интерфейсы для данных из staff-units API
export interface StaffUnitEmployee {
  position: {
    id: number;
    name: string;
    level: number;
  };
  employee: {
    id: number;
    first_name: string;
    last_name: string;
    middle_name?: string;
    photo?: string;
    photo_url?: string;
    current_status?: {
      status_type:
        | "in_service"
        | "vacation"
        | "leave_by_report"
        | "sick_leave"
        | "business_trip"
        | "training"
        | "competition"
        | "other_absence"
        | "on_duty"
        | "after_duty"
        | "seconded_from"
        | "seconded_to";
      state: "planned" | "active" | "completed" | "cancelled";
      start_date?: string;
      end_date?: string | null;
    } | null;
    rank?: number | null;
  } | null; // employee может быть null для вакантных должностей
}

// Интерфейс для нового формата ответа API (дерево)
export interface StaffUnitTreeResponse {
  id: number;
  division: {
    id: number;
    name: string;
    level?: number;
    code?: string;
  };
  employees: Array<{
    position: {
      id: number;
      name: string;
      level: number;
    };
    employee: {
      id: number;
      first_name: string;
      last_name: string;
      middle_name?: string;
      photo?: string;
      photo_url?: string;
      current_status?: {
        status_type:
          | "in_service"
          | "vacation"
          | "leave_by_report"
          | "sick_leave"
          | "business_trip"
          | "training"
          | "competition"
          | "other_absence"
          | "on_duty"
          | "after_duty"
          | "seconded_from"
          | "seconded_to";
        state: "planned" | "active" | "completed" | "cancelled";
        start_date?: string;
        end_date?: string | null;
      } | null;
      rank?: number | null;
    } | null;
    vacancy: number | null;
    index: number;
  }>;
  children: StaffUnitTreeResponse[];
}

export interface StaffUnit {
  id: number;
  division: {
    id: number;
    name: string;
    level?: number;
    code?: string;
  };
  index: number;
  parent_id: number | null;
  vacancy: number | null; // vacancy может быть null
  employees: StaffUnitEmployee[]; // массив сотрудников с позициями
  children?: StaffUnit[]; // children может быть undefined или отсутствовать (добавляется при построении дерева)
}

// Интерфейсы для статистики по штатным единицам
export interface StaffUnitStatisticsSummary {
  departments_count: number;
  directorates_count: number;
  divisions_count: number;
  staff_units_count: number;
  employees_count: number;
  vacancies_count: number;
}

export interface StaffUnitStatistics {
  scope_division: {
    id: number;
    name: string;
    division_type: string;
  };
  summary: StaffUnitStatisticsSummary;
  departments: Array<{
    department_id: number;
    department_name: string;
    directorates_count: number;
    divisions_count: number;
    staff_units_count: number;
    employees_count: number;
    vacancies_count: number;
  }>;
  directorates: Array<{
    directorate_id: number;
    directorate_name: string;
    divisions_count: number;
    staff_units_count: number;
    employees_count: number;
    vacancies_count: number;
  }>;
  divisions: Array<{
    division_id: number;
    division_name: string;
    staff_units_count: number;
    employees_count: number;
    vacancies_count: number;
  }>;
}

// Интерфейсы для справочников
export interface Position {
  id: number;
  name: string;
  level: number;
}

export interface Rank {
  id: number;
  name: string;
  level: number;
  created_at?: string;
  updated_at?: string;
}

export interface Division {
  id: number;
  name: string;
  code: string;
  division_type: string;
  parent: number | null;
  is_active: boolean;
  order: number;
  children: Division[];
}

// Расход (строевая записка): форма ответа /api/operations/strength-report/.
// `columns` — коды статусов, порядок задаёт СЕРВЕР, поэтому шапку таблицы
// строим по этому массиву, а не по ключам объекта `row.columns`: порядок
// ключей объекта в JS не гарантирован и разъехался бы с сервером.
export interface StrengthReportRow {
  division_id: number;
  name: string;
  staff_total: number;
  list_total: number;
  vacancies: number;
  attached: number;
  off_list: number;
  columns: Record<string, number>;
}

export interface StrengthReport {
  business_date: string;
  columns: string[];
  rows: StrengthReportRow[];
}

// Ошибка раздела ОМ: бэк отвечает конвертом {error_code, message, details}.
// Держим `code` отдельно от текста, чтобы UI мог разводить случаи по коду
// (например DAY_NOT_SUBMITTED — это не поломка, а «выгружать нечего»), а не
// сравнением строк сообщения, которое переписывают без предупреждения.
export class OpsApiError extends Error {
  readonly status: number;
  readonly code: string | null;

  constructor(status: number, code: string | null, message: string) {
    super(message);
    this.name = "OpsApiError";
    this.status = status;
    this.code = code;
  }
}

// Разбирает неуспешный ответ в OpsApiError. Тело читаем как текст и лишь
// потом пробуем как JSON: у выгрузки тип ответа файловый, и на ошибке там
// может прийти не-JSON — `response.json()` тогда бросил бы SyntaxError,
// подменив настоящую причину отказа.
async function toDomainError(response: Response): Promise<OpsApiError> {
  const raw = await response.text();
  let code: string | null = null;
  let message = "";
  try {
    const body = JSON.parse(raw);
    code = body?.error_code ?? null;
    message = body?.message || body?.detail || "";
  } catch {
    message = raw;
  }
  return new OpsApiError(
    response.status,
    code,
    message || `HTTP ${response.status}`
  );
}

// Хелпер для получения токена из NextAuth сессии
// Используется в API клиенте для автоматической авторизации запросов
async function getAccessToken(): Promise<string | null> {
  if (typeof window === "undefined") return null;

  try {
    const { getSession } = await import("next-auth/react");
    const session = await getSession();
    return (session?.user as any)?.accessToken || null;
  } catch (error) {
    console.error("Error getting access token:", error);
    return null;
  }
}

// Класс для работы с API
class ApiClient {
  private baseUrl: string;

  constructor(baseUrl: string = API_BASE_URL) {
    this.baseUrl = baseUrl;
  }

  private async request<T>(
    endpoint: string,
    options: RequestInit = {},
    token?: string | null
  ): Promise<ApiResponse<T>> {
    const url = `${this.baseUrl}${endpoint}`;

    const defaultHeaders: HeadersInit = {
      "Content-Type": "application/json",
      accept: "application/json",
    };

    // Получаем токен из NextAuth сессии, если не передан явно
    let authToken = token;
    if (!authToken && typeof window !== "undefined") {
      authToken = await getAccessToken();
    }

    // Добавляем токен авторизации, если он есть
    if (authToken) {
      defaultHeaders["Authorization"] = `Bearer ${authToken}`;
    }

    const config: RequestInit = {
      ...options,
      headers: {
        ...defaultHeaders,
        ...options.headers,
      },
    };

    try {
      const response = await fetch(url, config);

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const data = await response.json();
      return data;
    } catch (error) {
      console.error("API request failed:", error);
      throw error;
    }
  }

  // Методы для работы с сотрудниками
  async getEmployees(): Promise<ApiResponse<Employee[]>> {
    return this.request<Employee[]>("/api/employees");
  }

  async getEmployee(id: string): Promise<ApiResponse<Employee>> {
    return this.request<Employee>(`/api/employees/${id}/`);
  }

  async createEmployee(
    employee: Omit<Employee, "id">
  ): Promise<ApiResponse<Employee>> {
    return this.request<Employee>("/api/employees/", {
      method: "POST",
      body: JSON.stringify(employee),
    });
  }

  async updateEmployee(
    id: string,
    employee: Partial<Employee>
  ): Promise<ApiResponse<Employee>> {
    return this.request<Employee>(`/api/employees/${id}/`, {
      method: "PUT",
      body: JSON.stringify(employee),
    });
  }

  async deleteEmployee(id: string): Promise<ApiResponse<void>> {
    return this.request<void>(`/api/employees/${id}/`, {
      method: "DELETE",
    });
  }

  // Методы для работы с департаментами
  async getDepartments(): Promise<ApiResponse<Department[]>> {
    return this.request<Department[]>("/api/departments/");
  }

  async getDepartment(id: string): Promise<ApiResponse<Department>> {
    return this.request<Department>(`/api/departments/${id}/`);
  }

  async createDepartment(
    department: Omit<Department, "id">
  ): Promise<ApiResponse<Department>> {
    return this.request<Department>("/api/departments/", {
      method: "POST",
      body: JSON.stringify(department),
    });
  }

  async updateDepartment(
    id: string,
    department: Partial<Department>
  ): Promise<ApiResponse<Department>> {
    return this.request<Department>(`/api/departments/${id}/`, {
      method: "PUT",
      body: JSON.stringify(department),
    });
  }

  async deleteDepartment(id: string): Promise<ApiResponse<void>> {
    return this.request<void>(`/api/departments/${id}/`, {
      method: "DELETE",
    });
  }

  // Методы для работы с организационной структурой
  async getOrgChart(): Promise<ApiResponse<OrgUnit>> {
    return this.request<OrgUnit>("/api/org-chart/");
  }

  // Новый метод для получения данных из staff-units API
  // API возвращает массив напрямую, не в формате ApiResponse
  async getStaffUnits(page?: number, pageSize?: number): Promise<StaffUnit[]> {
    const params = new URLSearchParams();
    if (page !== undefined) params.append("page", page.toString());
    if (pageSize !== undefined) params.append("page_size", pageSize.toString());
    const queryString = params.toString();
    const endpoint = `/api/staff_unit/staff-units/${
      queryString ? `?${queryString}` : ""
    }`;

    // Используем относительный путь (Next.js rewrites проксируют)
    const url = this.baseUrl ? `${this.baseUrl}${endpoint}` : endpoint;

    console.log("📡 [API Client] getStaffUnits");
    console.log("  → Base URL:", this.baseUrl || "(empty - using rewrites)");
    console.log("  → Endpoint:", endpoint);
    console.log("  → Full URL:", url);

    // Получаем токен из NextAuth сессии
    const token = await getAccessToken();

    const headers: HeadersInit = {
      "Content-Type": "application/json",
      accept: "application/json",
    };

    if (token) {
      headers["Authorization"] = `Bearer ${token}`;
    }

    try {
      const response = await fetch(url, { headers });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const data = await response.json();

      // Функция для преобразования дерева в плоский массив
      const flattenTree = (
        tree: StaffUnitTreeResponse,
        parentId: number | null = null
      ): StaffUnit[] => {
        const result: StaffUnit[] = [];

        // Преобразуем employees из нового формата в старый
        const employees: StaffUnitEmployee[] = tree.employees.map((emp) => ({
          position: emp.position,
          employee: emp.employee,
        }));

        // Вычисляем минимальный index из всех employees для сортировки
        const minIndex =
          tree.employees.length > 0
            ? Math.min(...tree.employees.map((emp) => emp.index))
            : 0;

        // Проверяем наличие вакансий (если хотя бы один employee имеет vacancy !== null)
        const hasVacancy = tree.employees.some((emp) => emp.vacancy !== null);
        const vacancy = hasVacancy
          ? tree.employees.find((emp) => emp.vacancy !== null)?.vacancy ?? null
          : null;

        // Создаем StaffUnit из текущего узла дерева
        const staffUnit: StaffUnit = {
          id: tree.id,
          division: {
            id: tree.division.id,
            name: tree.division.name,
            level: tree.division.level,
            code: tree.division.code,
          },
          index: minIndex,
          parent_id: parentId,
          vacancy: vacancy,
          employees: employees,
        };

        result.push(staffUnit);

        // Рекурсивно обрабатываем детей
        if (tree.children && tree.children.length > 0) {
          tree.children.forEach((child) => {
            result.push(...flattenTree(child, tree.id));
          });
        }

        return result;
      };

      // Если API возвращает дерево (объект с children)
      if (data && typeof data === "object" && "children" in data) {
        return flattenTree(data as StaffUnitTreeResponse);
      }

      // Живой бэкенд (StaffUnitViewSet.list) отдаёт конверт DRF-пагинации
      // {count, next, previous, results}. Раньше он не совпадал ни с веткой
      // дерева, ни с веткой массива, метод молча возвращал [] — и экран
      // /organization/ писал «Данные не загружены из API» при HTTP 200.
      const rows: unknown[] | null = Array.isArray(data)
        ? data
        : data &&
            typeof data === "object" &&
            Array.isArray((data as { results?: unknown }).results)
          ? ((data as { results: unknown[] }).results)
          : null;

      if (rows) {
        // Строка списка описывает ОДНУ штатную единицу: должность и сотрудник
        // лежат в корне (position/employee), а не в массиве employees, который
        // ждут convertStaffUnitsResponseToOrgUnit и OrgNode. Приводим форму
        // бэка к форме потребителя — контракт бэка источник правды.
        return rows.map((row) => {
          const unit = row as StaffUnit & {
            position?: StaffUnitEmployee["position"] | null;
            employee?: StaffUnitEmployee["employee"] | null;
          };

          let employees: StaffUnitEmployee[];
          if (Array.isArray(unit.employees)) {
            employees = unit.employees;
          } else if (unit.position || unit.employee) {
            employees = [
              {
                // position на строке может быть null (штатная единица без
                // должности в справочнике). Пустой employees здесь означал бы
                // «вакансия» и стирал реального сотрудника из строки, поэтому
                // подставляем нейтральную должность — ту же формулировку, что
                // используют остальные экраны для отсутствующей должности.
                position: unit.position ?? {
                  id: 0,
                  name: "Должность не указана",
                  level: Number.MAX_SAFE_INTEGER,
                },
                // Вакантная строка приходит с employee: null — оставляем
                // как есть, конвертер подписывает её «Вакантная должность».
                employee: unit.employee as StaffUnitEmployee["employee"],
              },
            ];
          } else {
            employees = [];
          }

          return {
            id: unit.id,
            division: unit.division,
            index: unit.index,
            parent_id: unit.parent_id ?? null,
            vacancy: unit.vacancy ?? null,
            employees,
          };
        });
      }

      return [];
    } catch (error) {
      console.error("API request failed:", error);
      throw error;
    }
  }

  // Метод для получения staff units по директории
  // API возвращает данные напрямую, не в формате ApiResponse
  async getStaffUnitsByDirectorate(): Promise<{
    division: {
      id: number;
      name: string;
      code: string;
    };
    staff_units: StaffUnit[];
    total_count: number;
  }> {
    const endpoint = `/api/staff_unit/staff-units/directorate/`;

    // Используем относительный путь (Next.js rewrites проксируют)
    const url = this.baseUrl ? `${this.baseUrl}${endpoint}` : endpoint;

    console.log("📡 [API Client] getStaffUnitsByDirectorate");
    console.log("  → Base URL:", this.baseUrl || "(empty - using rewrites)");
    console.log("  → Endpoint:", endpoint);
    console.log("  → Full URL:", url);

    // Получаем токен из NextAuth сессии
    const token = await getAccessToken();

    const headers: HeadersInit = {
      "Content-Type": "application/json",
      accept: "application/json",
    };

    if (token) {
      headers["Authorization"] = `Bearer ${token}`;
    }

    try {
      const response = await fetch(url, {
        headers,
        cache: "no-store",
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error(`API request failed: ${response.status}`, errorText);
        throw new Error(
          `HTTP error! status: ${response.status} - ${errorText}`
        );
      }

      const data = await response.json();
      return data;
    } catch (error) {
      console.error("API request failed:", error);
      throw error;
    }
  }

  // Метод для обновления штатного расписания подразделения
  // PUT /api/staff_unit/staff-units/directorate/
  async updateStaffUnitsByDirectorate(data: {
    staff_units?: Array<{
      id?: number;
      division?: number;
      position?: number;
      index?: string;
    }>;
    employees?: Array<{
      id?: number;
      first_name?: string;
      last_name?: string;
      middle_name?: string;
      iin?: string;
      rank?: number;
    }>;
    employee_statuses: Array<{
      employee: number;
      status_type:
        | "in_service"
        | "vacation"
        | "leave_by_report"
        | "sick_leave"
        | "business_trip"
        | "training"
        | "competition"
        | "other_absence"
        | "on_duty"
        | "after_duty"
        | "seconded_from"
        | "seconded_to";
      start_date?: string;
      end_date?: string;
      comment?: string;
    }>;
  }): Promise<StaffUnit[]> {
    const endpoint = `/api/staff_unit/staff-units/directorate/`;

    const url = this.baseUrl ? `${this.baseUrl}${endpoint}` : endpoint;

    const token = await getAccessToken();

    const headers: HeadersInit = {
      "Content-Type": "application/json",
      accept: "application/json",
    };

    if (token) {
      headers["Authorization"] = `Bearer ${token}`;
    }

    try {
      const response = await fetch(url, {
        method: "PUT",
        headers,
        body: JSON.stringify(data),
        cache: "no-store",
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error(`API request failed: ${response.status}`, errorText);
        throw new Error(
          `HTTP error! status: ${response.status} - ${errorText}`
        );
      }

      const result = await response.json();
      return result;
    } catch (error) {
      console.error("API request failed:", error);
      throw error;
    }
  }

  // Методы для работы со статусами
  async updateEmployeeStatus(
    id: string,
    status: Employee["status"]
  ): Promise<ApiResponse<Employee>> {
    return this.request<Employee>(`/api/employees/${id}/status`, {
      method: "PATCH",
      body: JSON.stringify({ status }),
    });
  }

  // Обновление конкретного статуса по ID
  async updateEmployeeStatusById(
    statusId: number,
    data: {
      employee: number;
      status_type: string;
      start_date?: string;
      end_date?: string;
      comment?: string;
    }
  ): Promise<any> {
    const endpoint = `/api/statuses/statuses/${statusId}/`;

    const url = this.baseUrl ? `${this.baseUrl}${endpoint}` : endpoint;

    const token = await getAccessToken();

    const headers: HeadersInit = {
      "Content-Type": "application/json",
      accept: "application/json",
    };

    if (token) {
      headers["Authorization"] = `Bearer ${token}`;
    }

    try {
      const response = await fetch(url, {
        method: "PATCH",
        headers,
        body: JSON.stringify(data),
        cache: "no-store",
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error(`API request failed: ${response.status}`, errorText);
        throw new Error(
          `HTTP error! status: ${response.status} - ${errorText}`
        );
      }

      const result = await response.json();
      return result;
    } catch (error) {
      console.error("API request failed:", error);
      throw error;
    }
  }

  // Создание нового статуса сотрудника
  async createEmployeeStatus(data: {
    employee: number;
    status_type:
      | "in_service"
      | "vacation"
      | "leave_by_report"
      | "sick_leave"
      | "business_trip"
      | "training"
      | "competition"
      | "other_absence"
      | "on_duty"
      | "after_duty"
      | "seconded_from"
      | "seconded_to";
    start_date?: string;
    end_date?: string;
    comment?: string;
    location?: string;
    related_division?: number;
  }): Promise<any> {
    const endpoint = `/api/statuses/statuses/`;

    const url = this.baseUrl ? `${this.baseUrl}${endpoint}` : endpoint;

    const token = await getAccessToken();

    const headers: HeadersInit = {
      "Content-Type": "application/json",
      accept: "application/json",
    };

    if (token) {
      headers["Authorization"] = `Bearer ${token}`;
    }

    try {
      const response = await fetch(url, {
        method: "POST",
        headers,
        body: JSON.stringify(data),
        cache: "no-store",
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error(`API request failed: ${response.status}`, errorText);
        throw new Error(
          `HTTP error! status: ${response.status} - ${errorText}`
        );
      }

      const result = await response.json();
      return result;
    } catch (error) {
      console.error("API request failed:", error);
      throw error;
    }
  }

  async massUpdateStatus(
    employeeIds: string[],
    status: Employee["status"]
  ): Promise<ApiResponse<Employee[]>> {
    return this.request<Employee[]>("/api/employees/mass-status-update", {
      method: "PATCH",
      body: JSON.stringify({ employee_ids: employeeIds, status }),
    });
  }

  // Методы для работы со справочниками
  async getPositions(
    page?: number,
    pageSize?: number
  ): Promise<{
    count: number;
    next: string | null;
    previous: string | null;
    results: Position[];
  }> {
    const params = new URLSearchParams();
    if (page !== undefined) params.append("page", page.toString());
    if (pageSize !== undefined) params.append("page_size", pageSize.toString());
    const queryString = params.toString();
    const endpoint = `/api/dictionaries/positions/${
      queryString ? `?${queryString}` : ""
    }`;

    const url = this.baseUrl ? `${this.baseUrl}${endpoint}` : endpoint;

    const token = await getAccessToken();

    const headers: HeadersInit = {
      "Content-Type": "application/json",
      accept: "application/json",
    };

    if (token) {
      headers["Authorization"] = `Bearer ${token}`;
    }

    try {
      const response = await fetch(url, { headers });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const data = await response.json();
      return data;
    } catch (error) {
      console.error("API request failed:", error);
      throw error;
    }
  }

  async getRanks(
    page?: number,
    pageSize?: number
  ): Promise<{
    count: number;
    next: string | null;
    previous: string | null;
    results: Rank[];
  }> {
    const params = new URLSearchParams();
    if (page !== undefined) params.append("page", page.toString());
    if (pageSize !== undefined) params.append("page_size", pageSize.toString());
    const queryString = params.toString();
    const endpoint = `/api/dictionaries/ranks/${
      queryString ? `?${queryString}` : ""
    }`;

    const url = this.baseUrl ? `${this.baseUrl}${endpoint}` : endpoint;

    const token = await getAccessToken();

    const headers: HeadersInit = {
      "Content-Type": "application/json",
      accept: "application/json",
    };

    if (token) {
      headers["Authorization"] = `Bearer ${token}`;
    }

    try {
      const response = await fetch(url, { headers });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const data = await response.json();
      return data;
    } catch (error) {
      console.error("API request failed:", error);
      throw error;
    }
  }

  // Методы для аутентификации
  // Новый метод для получения токена из /api/token/
  async login(
    username: string,
    password: string
  ): Promise<{
    access: string;
    refresh: string;
  }> {
    // Используем относительный путь (Next.js rewrites проксируют)
    const url = this.baseUrl ? `${this.baseUrl}/api/token/` : "/api/token/";

    const headers: HeadersInit = {
      "Content-Type": "application/json",
      accept: "application/json",
    };

    try {
      const response = await fetch(url, {
        method: "POST",
        headers,
        body: JSON.stringify({ username, password }),
      });

      if (!response.ok) {
        // Пытаемся получить детали ошибки от сервера
        let errorMessage = `HTTP error! status: ${response.status}`;
        try {
          const errorText = await response.text();
          if (errorText) {
            errorMessage += ` - ${errorText}`;
          }
        } catch (e) {
          // Игнорируем ошибку чтения текста ошибки
        }
        throw new Error(errorMessage);
      }

      const data = await response.json();
      return data;
    } catch (error) {
      console.error("Login failed:", error);
      throw error;
    }
  }

  async logout(): Promise<ApiResponse<void>> {
    return this.request<void>("/api/auth/logout/", {
      method: "POST",
    });
  }

  async getCurrentUser(): Promise<ApiResponse<Employee>> {
    return this.request<Employee>("/api/auth/me/");
  }

  // Методы для статистики
  async getDashboardStats(): Promise<
    ApiResponse<{
      totalEmployees: number;
      activeEmployees: number;
      onVacation: number;
      sick: number;
      onBusinessTrip: number;
      departments: number;
    }>
  > {
    return this.request("/api/dashboard/stats/");
  }

  // Метод для получения статистики по отсутствиям
  async getAbsenceStatistics(): Promise<{
    period: {
      start_date: string;
      end_date: string;
    };
    division_id: number;
    staff_count: number;
    total_absences: number;
    by_type: {
      vacation: number;
      leave_by_report: number;
      sick_leave: number;
      business_trip: number;
      training: number;
      competition: number;
      other_absence: number;
      on_duty: number;
      after_duty: number;
      seconded_from: number;
      seconded_to: number;
    };
  }> {
    const endpoint = `/api/statuses/statuses/absence_statistics/`;

    const url = this.baseUrl ? `${this.baseUrl}${endpoint}` : endpoint;

    const token = await getAccessToken();

    const headers: HeadersInit = {
      "Content-Type": "application/json",
      accept: "application/json",
    };

    if (token) {
      headers["Authorization"] = `Bearer ${token}`;
    }

    try {
      const response = await fetch(url, {
        headers,
        cache: "no-store",
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error(`API request failed: ${response.status}`, errorText);
        throw new Error(
          `HTTP error! status: ${response.status} - ${errorText}`
        );
      }

      const data = await response.json();
      return data;
    } catch (error) {
      console.error("API request failed:", error);
      throw error;
    }
  }

  // Метод для получения текущего и запланированных статусов сотрудника
  async getEmployeePlannedStatuses(employeeId: number): Promise<{
    current: any | null;
    planned: any[];
  }> {
    const endpoint = `/api/statuses/statuses/planned/?employee_id=${employeeId}`;

    const url = this.baseUrl ? `${this.baseUrl}${endpoint}` : endpoint;

    const token = await getAccessToken();

    const headers: HeadersInit = {
      "Content-Type": "application/json",
      accept: "application/json",
    };

    if (token) {
      headers["Authorization"] = `Bearer ${token}`;
    }

    try {
      const response = await fetch(url, {
        headers,
        cache: "no-store",
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error(`API request failed: ${response.status}`, errorText);
        throw new Error(
          `HTTP error! status: ${response.status} - ${errorText}`
        );
      }

      const data = await response.json();
      return data;
    } catch (error) {
      console.error("API request failed:", error);
      throw error;
    }
  }

  // Метод для создания сотрудника и штатной единицы
  // POST /api/staff_unit/staff-units/directorate/
  async createStaffUnit(data: {
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
  }): Promise<any> {
    const endpoint = `/api/staff_unit/staff-units/directorate/`;

    const url = this.baseUrl ? `${this.baseUrl}${endpoint}` : endpoint;

    const token = await getAccessToken();

    const headers: HeadersInit = {
      "Content-Type": "application/json",
      accept: "application/json",
    };

    if (token) {
      headers["Authorization"] = `Bearer ${token}`;
    }

    try {
      const response = await fetch(url, {
        method: "POST",
        headers,
        body: JSON.stringify(data),
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error(`API request failed: ${response.status}`, errorText);
        throw new Error(
          `HTTP error! status: ${response.status} - ${errorText}`
        );
      }

      const responseData = await response.json();
      return responseData;
    } catch (error) {
      console.error("API request failed:", error);
      throw error;
    }
  }

  // Метод для получения дерева подразделений
  // GET /api/divisions/divisions_tree/
  async getDivisionsTree(): Promise<Division> {
    const endpoint = `/api/divisions/divisions_tree/`;

    const url = this.baseUrl ? `${this.baseUrl}${endpoint}` : endpoint;

    const token = await getAccessToken();

    const headers: HeadersInit = {
      "Content-Type": "application/json",
      accept: "*/*",
    };

    if (token) {
      headers["Authorization"] = `Bearer ${token}`;
    }

    try {
      const response = await fetch(url, {
        headers,
        cache: "no-store",
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error(`API request failed: ${response.status}`, errorText);
        throw new Error(
          `HTTP error! status: ${response.status} - ${errorText}`
        );
      }

      const data = await response.json();
      return data;
    } catch (error) {
      console.error("API request failed:", error);
      throw error;
    }
  }

  // Метод для получения статистики по штатным единицам и сотрудникам
  async getStaffUnitStatistics(): Promise<StaffUnitStatistics> {
    const endpoint = `/api/staff_unit/statistics/`;

    const url = this.baseUrl ? `${this.baseUrl}${endpoint}` : endpoint;

    const token = await getAccessToken();

    const headers: HeadersInit = {
      "Content-Type": "application/json",
      accept: "application/json",
    };

    if (token) {
      headers["Authorization"] = `Bearer ${token}`;
    }

    try {
      const response = await fetch(url, {
        headers,
        cache: "no-store",
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error(`API request failed: ${response.status}`, errorText);
        throw new Error(
          `HTTP error! status: ${response.status} - ${errorText}`
        );
      }

      const data = await response.json();
      return data;
    } catch (error) {
      console.error("API request failed:", error);
      throw error;
    }
  }

  // Метод для обновления профиля пользователя
  async updateProfile(data: {
    first_name?: string;
    last_name?: string;
    email?: string;
  }): Promise<ApiResponse<any>> {
    return this.request<any>("/api/user/profile/", {
      method: "PATCH",
      body: JSON.stringify(data),
    });
  }

  // Метод для смены пароля
  async changePassword(data: {
    current_password: string;
    new_password: string;
  }): Promise<ApiResponse<void>> {
    return this.request<void>("/api/user/change-password/", {
      method: "POST",
      body: JSON.stringify(data),
    });
  }

  // Методы для отчетов
  async downloadExpenseReport(date?: string): Promise<Blob> {
    const params = new URLSearchParams();
    if (date) params.append("date", date);
    const queryString = params.toString();
    const endpoint = `/api/reports/reports/expense/${
      queryString ? `?${queryString}` : ""
    }`;

    const url = this.baseUrl ? `${this.baseUrl}${endpoint}` : endpoint;

    const token = await getAccessToken();

    const headers: HeadersInit = {};

    if (token) {
      headers["Authorization"] = `Bearer ${token}`;
    }

    try {
      const response = await fetch(url, {
        method: "GET",
        headers,
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error(`API request failed: ${response.status}`, errorText);
        throw new Error(
          `HTTP error! status: ${response.status} - ${errorText}`
        );
      }

      const blob = await response.blob();
      return blob;
    } catch (error) {
      console.error("API request failed:", error);
      throw error;
    }
  }

  // Расход (строевая записка) — ЖИВОЙ контракт раздела ОМ.
  //
  // Соседний `downloadExpenseReport` выше бьёт в донорскую ручку
  // `/api/reports/reports/expense/<department_id>/`, которая на бэке хоть и
  // объявлена, но нерабочая: она строится из шаблона `расход.xlsx`, а его нет
  // в репозитории (и он не в .gitignore — просто никогда не коммитился).
  // Живой пробой она отвечает 500 «No such file or directory». Поэтому расход
  // читается отсюда.
  //
  // `division_id` НЕ обязателен: бэк сужает выборку по области видимости
  // всегда, поэтому «свой департамент» определяет он, а не клиент. Клиенту
  // незачем угадывать, какой из предков его подразделения — департамент.
  async getStrengthReport(params: {
    businessDate?: string;
    divisionId?: number;
  } = {}): Promise<StrengthReport> {
    const query = new URLSearchParams();
    if (params.businessDate) query.append("business_date", params.businessDate);
    if (params.divisionId !== undefined) {
      query.append("division_id", String(params.divisionId));
    }
    const queryString = query.toString();
    const endpoint = `/api/operations/strength-report/${
      queryString ? `?${queryString}` : ""
    }`;

    const url = this.baseUrl ? `${this.baseUrl}${endpoint}` : endpoint;
    const token = await getAccessToken();

    const headers: HeadersInit = {
      "Content-Type": "application/json",
      accept: "application/json",
    };
    if (token) {
      headers["Authorization"] = `Bearer ${token}`;
    }

    const response = await fetch(url, { headers, cache: "no-store" });
    if (!response.ok) {
      throw await toDomainError(response);
    }
    return response.json();
  }

  // Выгрузка расхода СДАННОГО дня файлом.
  //
  // Здесь `divisionId` обязателен — в отличие от чтения выше: бэк требует его
  // явно и на пустой параметр отвечает 400 (проверено живой пробой).
  //
  // Параметр формата зовётся `file_format`, а НЕ `format`: имя `format` DRF
  // резервирует под выбор рендерера ответа, и `?format=xlsx` ушло бы в
  // согласование содержимого, отвечая 404 ещё до вьюхи.
  async downloadStrengthReportExport(params: {
    divisionId: number;
    businessDate?: string;
    fileFormat?: "csv" | "xlsx" | "docx";
  }): Promise<Blob> {
    const query = new URLSearchParams();
    query.append("division_id", String(params.divisionId));
    if (params.businessDate) query.append("business_date", params.businessDate);
    query.append("file_format", params.fileFormat ?? "xlsx");

    const endpoint = `/api/operations/strength-report/export/?${query.toString()}`;
    const url = this.baseUrl ? `${this.baseUrl}${endpoint}` : endpoint;
    const token = await getAccessToken();

    const headers: HeadersInit = {};
    if (token) {
      headers["Authorization"] = `Bearer ${token}`;
    }

    const response = await fetch(url, { headers, cache: "no-store" });
    if (!response.ok) {
      throw await toDomainError(response);
    }
    return response.blob();
  }

  // Метод для получения уведомлений
  async getNotifications(): Promise<
    ApiResponse<
      Array<{
        id: number;
        title: string;
        message: string;
        read: boolean;
        created_at: string;
      }>
    >
  > {
    return this.request<
      Array<{
        id: number;
        title: string;
        message: string;
        read: boolean;
        created_at: string;
      }>
    >("/api/notifications/");
  }
}

// Функция для преобразования данных из StaffUnit в OrgUnit
export function convertStaffUnitToOrgUnit(staffUnit: StaffUnit): OrgUnit {
  // Находим руководителя (обычно это сотрудник с наименьшим level позиции или с определенными должностями)
  const headEmployee =
    staffUnit.employees.find(
      (emp) =>
        emp.position.level <= 7 ||
        emp.position.name.toUpperCase().includes("НАЧАЛЬНИК") ||
        emp.position.name.toUpperCase().includes("ЗАМЕСТИТЕЛЬ")
    ) || staffUnit.employees[0];

  // Определяем тип на основе уровня позиции руководителя
  let type: "leadership" | "department" | "directorate" | "section" = "section";
  if (headEmployee) {
    const level = headEmployee.position.level;
    if (level === 1) {
      type = "leadership";
    } else if (level <= 3) {
      type = "department";
    } else if (level <= 7) {
      type = "directorate";
    }
  }

  // Определяем цвет на основе типа
  const colors = {
    leadership:
      "bg-gradient-to-br from-blue-100 via-blue-150 to-blue-200 border-blue-300",
    department:
      "bg-gradient-to-br from-green-100 via-green-150 to-green-200 border-green-300",
    directorate:
      "bg-gradient-to-br from-green-50 via-green-100 to-green-150 border-green-200",
    section:
      "bg-gradient-to-br from-green-25 via-green-50 to-green-75 border-green-100",
  };

  // Создаем объект Employee для руководителя
  const head: Employee = headEmployee
    ? {
        id: headEmployee.employee?.id?.toString() || staffUnit.id.toString(),
        name: headEmployee.employee
          ? `${headEmployee.employee.first_name} ${headEmployee.employee.last_name}`
          : "Вакантная должность",
        position: headEmployee.position.name,
        status:
          headEmployee.employee?.current_status?.status_type || "in_service",
        statusState: headEmployee.employee?.current_status?.state || "active",
        statusStartDate: headEmployee.employee?.current_status?.start_date,
        statusEndDate:
          headEmployee.employee?.current_status?.end_date || undefined,
        avatar: (() => {
          const photoUrl = headEmployee.employee?.photo_url;
          const photo = headEmployee.employee?.photo;

          // Если есть photo_url и это не null/пустая строка, используем его
          if (photoUrl && photoUrl !== "null" && photoUrl.trim() !== "") {
            return photoUrl;
          }

          // Если есть photo и это не null/пустая строка, добавляем MEDIA_URL
          if (photo && photo !== "null" && photo.trim() !== "") {
            const mediaUrl = process.env.NEXT_PUBLIC_MEDIA_URL || "";
            // Если photo уже начинается с http, используем как есть
            if (photo.startsWith("http://") || photo.startsWith("https://")) {
              return photo;
            }
            // Иначе добавляем MEDIA_URL
            return mediaUrl ? `${mediaUrl}${photo}` : photo;
          }

          // Иначе используем заглушку
          return "/placeholder.svg";
        })(),
      }
    : {
        id: staffUnit.id.toString(),
        name: "Вакантная должность",
        position: "Должность не указана",
        status: "in_service",
        statusState: "active",
        avatar: "/placeholder.svg",
      };

  // Преобразуем остальных сотрудников (исключая руководителя)
  const otherEmployees = staffUnit.employees
    .filter((emp) => emp !== headEmployee && emp.employee)
    .map((emp) => ({
      id: emp.employee!.id.toString(),
      name: `${emp.employee!.first_name} ${emp.employee!.last_name}`,
      position: emp.position.name,
      status: emp.employee!.current_status?.status_type || "in_service",
      statusState: emp.employee!.current_status?.state || "active",
      statusStartDate: emp.employee!.current_status?.start_date,
      statusEndDate: emp.employee!.current_status?.end_date || undefined,
      avatar: (() => {
        const photoUrl = (emp.employee as any)?.photo_url;
        const photo = emp.employee!.photo;

        // Если есть photo_url и это не null/пустая строка, используем его
        if (photoUrl && photoUrl !== "null" && photoUrl.trim() !== "") {
          return photoUrl;
        }

        // Если есть photo и это не null/пустая строка, добавляем MEDIA_URL
        if (photo && photo !== "null" && photo.trim() !== "") {
          const mediaUrl = process.env.NEXT_PUBLIC_MEDIA_URL || "";
          // Если photo уже начинается с http, используем как есть
          if (photo.startsWith("http://") || photo.startsWith("https://")) {
            return photo;
          }
          // Иначе добавляем MEDIA_URL
          return mediaUrl ? `${mediaUrl}${photo}` : photo;
        }

        // Иначе используем заглушку
        return "/placeholder.svg";
      })(),
    }));

  // Преобразуем детей (если они есть)
  const children: OrgUnit[] = (staffUnit.children || []).map(
    convertStaffUnitToOrgUnit
  );

  return {
    id: staffUnit.id.toString(),
    name: staffUnit.division.name,
    head,
    employees: otherEmployees,
    color: colors[type],
    type,
    children: children.length > 0 ? children : undefined,
  };
}

// Функция для преобразования ответа API в OrgUnit
// API возвращает массив, нужно построить дерево на основе parent_id
export function convertStaffUnitsResponseToOrgUnit(
  staffUnits: StaffUnit[]
): OrgUnit | null {
  if (!staffUnits || staffUnits.length === 0) {
    return null;
  }

  // Создаем Set всех существующих ID для быстрой проверки
  const existingIds = new Set(staffUnits.map((unit) => unit.id));

  // Рекурсивная функция для построения дерева
  const buildTree = (parentId: number | null): StaffUnit[] => {
    return staffUnits
      .filter((unit) => unit.parent_id === parentId)
      .map((unit) => {
        // Рекурсивно находим детей для каждого элемента
        const children = buildTree(unit.id);
        return {
          ...unit,
          children: children.length > 0 ? children : undefined,
        };
      });
  };

  // Находим корневые элементы:
  // 1. Элементы с parent_id === null
  // 2. Элементы, у которых parent_id не существует в данных (сироты)
  const rootUnits = staffUnits.filter(
    (unit) =>
      unit.parent_id === null ||
      (unit.parent_id !== null && !existingIds.has(unit.parent_id))
  );

  if (rootUnits.length === 0) {
    // Если нет явных корней, берем элемент с минимальным ID
    const minIdUnit = staffUnits.reduce((min, unit) =>
      unit.id < min.id ? unit : min
    );
    const rootWithChildren: StaffUnit = {
      ...minIdUnit,
      children: buildTree(minIdUnit.id),
    };
    return convertStaffUnitToOrgUnit(rootWithChildren);
  }

  // Если есть несколько корневых элементов, создаем виртуальный корень
  if (rootUnits.length > 1) {
    // Находим элемент с минимальным ID среди корневых
    const mainRoot = rootUnits.reduce((min, unit) =>
      unit.id < min.id ? unit : min
    );

    // Строим дерево для главного корня, включая другие корни как его детей
    const otherRoots = rootUnits.filter((unit) => unit.id !== mainRoot.id);
    const mainRootChildren = buildTree(mainRoot.id);

    // Добавляем другие корни как детей главного корня
    const allChildren = [
      ...mainRootChildren,
      ...otherRoots.map((root) => ({
        ...root,
        children: buildTree(root.id),
      })),
    ];

    const rootWithChildren: StaffUnit = {
      ...mainRoot,
      children: allChildren.length > 0 ? allChildren : undefined,
    };

    return convertStaffUnitToOrgUnit(rootWithChildren);
  }

  // Если корневой элемент один, строим дерево для него
  const rootUnit = rootUnits[0];
  const rootWithChildren: StaffUnit = {
    ...rootUnit,
    children: buildTree(rootUnit.id),
  };

  return convertStaffUnitToOrgUnit(rootWithChildren);
}

// Создаем экземпляр API клиента
export const apiClient = new ApiClient();

// Экспортируем также класс для создания других экземпляров
export { ApiClient };

// Экспортируем функцию для использования в компонентах
export { getAccessToken };
