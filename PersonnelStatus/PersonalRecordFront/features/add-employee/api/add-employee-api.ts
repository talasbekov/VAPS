// API функции для добавления сотрудника

import { getAccessToken } from "@/lib/api";
import { BACKEND_URL } from "@/shared/config/env";
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

  if (!response.ok) {
    let errorMessage = `Ошибка ${response.status}`;
    const errors: string[] = [];

    try {
      const errorData = await response.json();
      console.error("Ошибка от API:", errorData);

      // Обрабатываем различные форматы ошибок от API
      if (errorData.detail) {
        errorMessage = errorData.detail;
        errors.push(errorData.detail);
      } else if (errorData.message) {
        errorMessage = errorData.message;
        errors.push(errorData.message);
      } else if (typeof errorData === "string") {
        errorMessage = errorData;
        errors.push(errorData);
      } else if (errorData.non_field_errors) {
        const nonFieldErrors = Array.isArray(errorData.non_field_errors)
          ? errorData.non_field_errors.join(", ")
          : errorData.non_field_errors;
        errorMessage = nonFieldErrors;
        errors.push(nonFieldErrors);
      } else {
        // Обрабатываем ошибки валидации полей
        Object.keys(errorData).forEach((key) => {
          const fieldErrors = errorData[key];
          if (Array.isArray(fieldErrors)) {
            errors.push(`${key}: ${fieldErrors.join(", ")}`);
          } else if (typeof fieldErrors === "string") {
            errors.push(`${key}: ${fieldErrors}`);
          } else {
            errors.push(`${key}: ${JSON.stringify(fieldErrors)}`);
          }
        });

        if (errors.length > 0) {
          errorMessage = errors.join("; ");
        }
      }
    } catch (e) {
      const errorText = await response.text();
      console.error("Не удалось распарсить ошибку:", errorText);
      errorMessage = errorText || errorMessage;
      errors.push(errorMessage);
    }

    const error = new Error(errorMessage);
    (error as any).fieldErrors = errors;
    throw error;
  }

  return await response.json();
}
