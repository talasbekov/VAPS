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
 * Отказ сервера в виде, пригодном для показа рядом с полями.
 *
 * ЗАЧЕМ КЛАСС, А НЕ `Error` СО СКЛЕЕННЫМ ТЕКСТОМ. Раньше ошибки полей
 * склеивались в одну строку вида «new_password: Введённый пароль слишком
 * короткий» и печатались одним блоком наверху диалога. Человек читал в ней
 * имя поля из чужого языка и сам искал, к какому из трёх полей пароля это
 * относится. Разбор оставлен здесь, где известна форма ответа DRF, а решение
 * «что где показать» — экрану.
 */
export class ProfileApiError extends Error {
  /** Ошибки по именам полей запроса: `{ new_password: ["…"] }`. */
  readonly fieldErrors: Record<string, string[]>;

  constructor(message: string, fieldErrors: Record<string, string[]> = {}) {
    super(message);
    this.name = "ProfileApiError";
    this.fieldErrors = fieldErrors;
  }
}

/** Ключи ответа DRF, которые относятся к запросу целиком, а не к полю. */
const NON_FIELD_KEYS = ["detail", "message", "non_field_errors"];

function asMessages(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(String);
  if (typeof value === "string") return [value];
  return [];
}

/**
 * Превратить неуспешный ответ в `ProfileApiError`.
 *
 * 🔴 ТЕЛО ЧИТАЕТСЯ РОВНО ОДИН РАЗ. Прежняя редакция звала `response.json()`, а
 * в `catch` — `response.text()` по уже вычитанному потоку; второй вызов сам
 * бросал «body stream already read», и это исключение уходило наружу ВМЕСТО
 * настоящей ошибки. Ловилось оно ровно там, где ответ не JSON, — то есть на
 * 404 и 500, когда Django отдаёт HTML-страницу. Так пользователь на
 * несуществующем эндпоинте видел жалобу на поток вместо «страница не найдена»
 * (Plane №180).
 */
async function toApiError(response: Response): Promise<ProfileApiError> {
  const fallback = `Ошибка ${response.status}`;
  const raw = await response.text();

  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    // Не JSON — значит это страница ошибки сервера, а не ответ API. Её
    // разметку человеку показывать незачем.
    console.error("Ответ не в формате JSON:", raw.slice(0, 500));
    return new ProfileApiError(fallback);
  }

  if (typeof data === "string") return new ProfileApiError(data);
  if (data === null || typeof data !== "object") {
    return new ProfileApiError(fallback);
  }

  const body = data as Record<string, unknown>;
  const common: string[] = [];
  const fieldErrors: Record<string, string[]> = {};

  for (const [key, value] of Object.entries(body)) {
    const messages = asMessages(value);
    if (messages.length === 0) continue;
    if (NON_FIELD_KEYS.includes(key)) {
      common.push(...messages);
    } else {
      fieldErrors[key] = messages;
    }
  }

  // Общий текст: сначала то, что сказано про запрос целиком; если сказано
  // только про поля — берём первое сообщение, чтобы шапка диалога не осталась
  // молчаливой у тех, кто читает её скринридером.
  const message =
    common[0] ?? Object.values(fieldErrors)[0]?.[0] ?? fallback;
  return new ProfileApiError(message, fieldErrors);
}

async function authorizedHeaders(): Promise<HeadersInit> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    accept: "application/json",
  };
  const token = await getAccessToken();
  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  }
  return headers;
}

/**
 * Обновляет данные профиля пользователя
 */
export async function updateProfile(
  payload: UpdateProfileRequest
): Promise<UpdateProfileResponse> {
  const response = await fetch(`${BACKEND_URL}/api/user/profile/`, {
    method: "PATCH",
    headers: await authorizedHeaders(),
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    throw await toApiError(response);
  }

  return await response.json();
}

/**
 * Изменяет пароль пользователя
 */
export async function changePassword(
  payload: ChangePasswordRequest
): Promise<ChangePasswordResponse> {
  const response = await fetch(`${BACKEND_URL}/api/user/change-password/`, {
    method: "POST",
    headers: await authorizedHeaders(),
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    throw await toApiError(response);
  }

  return await response.json();
}
