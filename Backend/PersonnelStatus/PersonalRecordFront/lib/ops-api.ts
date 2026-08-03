// API-клиент раздела «Охранные мероприятия» (/security-ops/*). Отдельный от
// lib/api.ts: у ApiClient другой протокол ошибок (throw new Error(text) и
// конверт ApiResponse<T>), а бэкенд ОМ отвечает типизированным конвертом
// ошибок (400/409/422 + error_code/details) — см. lib/ops-errors.ts.
// Существующий ApiClient не трогаем (правки логики OLD запрещены).
import { BACKEND_URL } from "@/shared/config/env";
import { OpsNetworkError, parseOpsErrorResponse } from "@/lib/ops-errors";

// Токен из NextAuth-сессии — аналог непубличного хелпера в lib/api.ts
// (он не экспортирован, поэтому свой; lib/api.ts не правим).
async function getAccessToken(): Promise<string | null> {
  if (typeof window === "undefined") return null;
  try {
    const { getSession } = await import("next-auth/react");
    const session = await getSession();
    const user = session?.user as { accessToken?: string } | undefined;
    return user?.accessToken || null;
  } catch {
    return null;
  }
}

// Класс для работы с API охранных мероприятий
class OpsApiClient {
  private baseUrl: string;

  constructor(baseUrl: string = BACKEND_URL) {
    this.baseUrl = baseUrl;
  }

  private async request<T>(
    endpoint: string,
    options: RequestInit = {}
  ): Promise<T> {
    const url = `${this.baseUrl}${endpoint}`;

    const headers: HeadersInit = {
      "Content-Type": "application/json",
      accept: "application/json",
    };

    const token = await getAccessToken();
    if (token) {
      headers["Authorization"] = `Bearer ${token}`;
    }

    let response: Response;
    try {
      response = await fetch(url, {
        ...options,
        headers: { ...headers, ...options.headers },
      });
    } catch (error) {
      // fetch упал до получения ответа — сеть/DNS, не HTTP-ошибка
      throw new OpsNetworkError("Сеть недоступна", { cause: error });
    }

    if (!response.ok) {
      throw await parseOpsErrorResponse(response);
    }

    if (response.status === 204) {
      return undefined as T;
    }
    return (await response.json()) as T;
  }

  async get<T>(endpoint: string): Promise<T> {
    return this.request<T>(endpoint);
  }

  async post<T>(endpoint: string, body?: unknown): Promise<T> {
    return this.request<T>(endpoint, {
      method: "POST",
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  }

  async patch<T>(endpoint: string, body?: unknown): Promise<T> {
    return this.request<T>(endpoint, {
      method: "PATCH",
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  }

  async del<T>(endpoint: string): Promise<T> {
    return this.request<T>(endpoint, { method: "DELETE" });
  }
}

export const opsApiClient = new OpsApiClient();
