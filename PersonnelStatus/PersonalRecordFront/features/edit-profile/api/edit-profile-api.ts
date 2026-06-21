// API функции для редактирования профиля

import { getAccessToken } from "@/lib/api";
import { BACKEND_URL } from "@/shared/config/env";
import type {
  UpdateProfileRequest,
  UpdateProfileResponse,
  ChangePasswordRequest,
  ChangePasswordResponse,
} from "../model/types";

/**
 * Обновляет данные профиля пользователя
 */
export async function updateProfile(
  payload: UpdateProfileRequest
): Promise<UpdateProfileResponse> {
  const endpoint = `/api/user/profile/`;
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
    method: "PATCH",
    headers,
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    let errorMessage = `Ошибка ${response.status}`;

    try {
      const errorData = await response.json();
      console.error("Ошибка от API:", errorData);

      if (errorData.detail) {
        errorMessage = errorData.detail;
      } else if (errorData.message) {
        errorMessage = errorData.message;
      } else if (typeof errorData === "string") {
        errorMessage = errorData;
      } else if (errorData.non_field_errors) {
        const nonFieldErrors = Array.isArray(errorData.non_field_errors)
          ? errorData.non_field_errors.join(", ")
          : errorData.non_field_errors;
        errorMessage = nonFieldErrors;
      } else {
        // Обрабатываем ошибки валидации полей
        const errors: string[] = [];
        Object.keys(errorData).forEach((key) => {
          const fieldErrors = errorData[key];
          if (Array.isArray(fieldErrors)) {
            errors.push(`${key}: ${fieldErrors.join(", ")}`);
          } else if (typeof fieldErrors === "string") {
            errors.push(`${key}: ${fieldErrors}`);
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
    }

    throw new Error(errorMessage);
  }

  return await response.json();
}

/**
 * Изменяет пароль пользователя
 */
export async function changePassword(
  payload: ChangePasswordRequest
): Promise<ChangePasswordResponse> {
  const endpoint = `/api/user/change-password/`;
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

    try {
      const errorData = await response.json();
      console.error("Ошибка от API:", errorData);

      if (errorData.detail) {
        errorMessage = errorData.detail;
      } else if (errorData.message) {
        errorMessage = errorData.message;
      } else if (typeof errorData === "string") {
        errorMessage = errorData;
      } else if (errorData.non_field_errors) {
        const nonFieldErrors = Array.isArray(errorData.non_field_errors)
          ? errorData.non_field_errors.join(", ")
          : errorData.non_field_errors;
        errorMessage = nonFieldErrors;
      } else {
        // Обрабатываем ошибки валидации полей
        const errors: string[] = [];
        Object.keys(errorData).forEach((key) => {
          const fieldErrors = errorData[key];
          if (Array.isArray(fieldErrors)) {
            errors.push(`${key}: ${fieldErrors.join(", ")}`);
          } else if (typeof fieldErrors === "string") {
            errors.push(`${key}: ${fieldErrors}`);
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
    }

    throw new Error(errorMessage);
  }

  return await response.json();
}
