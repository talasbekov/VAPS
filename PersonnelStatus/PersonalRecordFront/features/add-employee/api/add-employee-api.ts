// API функции для добавления сотрудника

import { getAccessToken } from "@/lib/api";
import { BACKEND_URL } from "@/shared/config/env";
import { readApiError } from "@/shared/lib/api-error";
import type {
  CreateEmployeeRequest,
  CreateEmployeeResponse,
} from "../model/types";

/**
 * Создает сотрудника и штатную единицу
 */
export async function createEmployee(
  payload: CreateEmployeeRequest
): Promise<CreateEmployeeResponse> {
  const endpoint = `/api/staff_unit/staff-units/directorate/`;
  const url = `${BACKEND_URL}${endpoint}`;

  const token = await getAccessToken();

  const headers: HeadersInit = {
    "Content-Type": "application/json",
    accept: "application/json",
  };

  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  }

  const response = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify(payload),
  });

  // Тело отказа доезжает до формы КАК ЕСТЬ: раскладкой по полям занимается
  // сама форма — здесь неоткуда знать, что `iin` в ответе это поле «ИИН».
  if (!response.ok) {
    throw await readApiError(response);
  }

  return await response.json();
}
