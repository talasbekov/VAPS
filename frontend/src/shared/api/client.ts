// Транспортная половина ARCH-FE-015: свой fetch-клиент (~100 строк, ARCH-FE-011 —
// НЕ orval/openapi-fetch). Любой не-2xx превращается в типизированный ApiError в
// одной точке (parseErrorResponse); fetch/XHR вне src/shared/api забанены eslint-ом.
// Осознанно НЕТ: трансформаций имён (snake_case end-to-end, L429), ретраев
// (канон §Process: мутации не ретраить), таймаутов (AbortSignal.timeout — граница
// FF100), auth-логики (8.6 подключит через defaultHeaders, парсинг не правится).
import { NetworkError, parseErrorResponse } from './errors'

export interface ApiClientOptions {
  /**
   * '' (дефолт) = same-origin через dev-прокси vite; тестам в node нужен
   * абсолютный origin — относительный URL в node-fetch не парсится.
   */
  baseUrl?: string
  /** Точка расширения 8.6 (X-User-Id/JWT) без правки транспорта и парсинга (Д6). */
  defaultHeaders?: Record<string, string>
}

export interface ApiClient {
  get<T>(path: string): Promise<T>
  post<T>(path: string, body?: unknown): Promise<T>
  patch<T>(path: string, body?: unknown): Promise<T>
  del<T = undefined>(path: string): Promise<T>
}

/** Фабрика без состояния (ARCH-FE-010): чистый транспорт, никаких кэшей. */
export function createApiClient(options: ApiClientOptions = {}): ApiClient {
  const { baseUrl = '', defaultHeaders = {} } = options

  async function request<T>(
    method: string,
    path: string,
    body?: unknown,
  ): Promise<T> {
    const headers: Record<string, string> = { ...defaultHeaders }
    const init: RequestInit = { method, headers }
    if (body !== undefined) {
      headers['Content-Type'] = 'application/json'
      init.body = JSON.stringify(body)
    }

    let response: Response
    try {
      response = await fetch(`${baseUrl}${path}`, init)
    } catch (cause) {
      // fetch реджектится (TypeError) только когда HTTP-ответа нет вовсе
      throw new NetworkError(`Сетевой сбой: ${method} ${path}`, { cause })
    }

    if (!response.ok) {
      throw await parseErrorResponse(response)
    }
    if (response.status === 204) {
      return undefined as T // 204 No Content — тела нет, .json() упал бы
    }
    return (await response.json()) as T
  }

  return {
    get: <T>(path: string) => request<T>('GET', path),
    post: <T>(path: string, body?: unknown) => request<T>('POST', path, body),
    patch: <T>(path: string, body?: unknown) => request<T>('PATCH', path, body),
    del: <T = undefined>(path: string) => request<T>('DELETE', path),
  }
}

/** Дефолтный клиент приложения: same-origin, без доп. заголовков. */
export const apiClient = createApiClient()
