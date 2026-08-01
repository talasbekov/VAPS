// Транспортная половина ARCH-FE-015: свой fetch-клиент (~100 строк, ARCH-FE-011 —
// НЕ orval/openapi-fetch). Любой не-2xx превращается в типизированный ApiError в
// одной точке (parseErrorResponse); fetch/XHR вне src/shared/api забанены eslint-ом.
// Осознанно НЕТ: трансформаций имён (snake_case end-to-end, L429), ретраев
// (канон §Process: мутации не ретраить), таймаутов (AbortSignal.timeout — граница
// FF100), auth-логики (8.6 подключит через defaultHeaders, парсинг не правится).
import { authHeaders } from '../auth/credential'
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

/** Бинарное тело + имя файла с сервера (null = сервер имени не назвал). */
export interface BlobResponse {
  blob: Blob
  filename: string | null
}

export interface ApiClient {
  get<T>(path: string): Promise<T>
  post<T>(path: string, body?: unknown): Promise<T>
  patch<T>(path: string, body?: unknown): Promise<T>
  del<T = undefined>(path: string): Promise<T>
  /**
   * Бинарная загрузка (стори 10.5): единственный путь мимо `response.json()`.
   * Живёт ЗДЕСЬ, а не в фиче, не по вкусу: `fetch`/`XHR` вне `src/shared/api/**`
   * — ошибка eslint (ARCH-FE-015, eslint.config.js:211-249), включая
   * `window.fetch`/`globalThis.fetch`.
   */
  getBlob(path: string): Promise<BlobResponse>
}

/**
 * Имя файла из `Content-Disposition`. Бэк ставит заголовок в ОБЕИХ ветках
 * выдачи — X-Accel-Redirect (прод) и FileResponse (dev) — через
 * `content_disposition_header(True, attachment.original_name)`.
 *
 * Читаем ТОЛЬКО `filename*=UTF-8''<pct>`: имя кириллическое
 * («расход_2026-07-19_исх-247.docx»), и ASCII-фолбэк `filename="..."` того же
 * заголовка несёт транслитерированный/испорченный вариант. Без
 * `decodeURIComponent` файл сохранился бы с процентами в имени.
 *
 * Ничего не разобралось → null: фолбэк-имя строит ФИЧА (она знает
 * `{business_date, number}`), транспорт сочинять его не вправе.
 */
function parseContentDisposition(header: string | null): string | null {
  if (header === null) return null
  const match = /filename\*=UTF-8''([^;]+)/i.exec(header)
  if (match === null) return null
  try {
    const decoded = decodeURIComponent(match[1].trim())
    return decoded === '' ? null : decoded
  } catch {
    return null // битая percent-последовательность — не повод падать
  }
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

  /**
   * Тот же спред `{ ...defaultHeaders }`, что и в `request` — заголовки
   * `credential.ts:18` мутабельны и обязаны читаться В МОМЕНТ запроса.
   *
   * Не-2xx идёт через тот же `parseErrorResponse`: иначе 403 «нет права
   * document.view» приехал бы «пустым блобом» и экран показал бы скачанный
   * файл на 0 байт вместо объяснения.
   *
   * ⚠️ Длина тела как признак здоровья НЕ проверяется: в проде файл отдаёт
   * nginx по X-Accel-Redirect (documents/api/views.py:79-81), в dev —
   * FileResponse (:83-86). Ассерт «байты пришли» честен только в Playwright.
   */
  async function requestBlob(path: string): Promise<BlobResponse> {
    let response: Response
    try {
      response = await fetch(`${baseUrl}${path}`, {
        method: 'GET',
        headers: { ...defaultHeaders },
      })
    } catch (cause) {
      throw new NetworkError(`Сетевой сбой: GET ${path}`, { cause })
    }
    if (!response.ok) {
      throw await parseErrorResponse(response)
    }
    return {
      blob: await response.blob(),
      filename: parseContentDisposition(
        response.headers.get('Content-Disposition'),
      ),
    }
  }

  return {
    get: <T>(path: string) => request<T>('GET', path),
    post: <T>(path: string, body?: unknown) => request<T>('POST', path, body),
    patch: <T>(path: string, body?: unknown) => request<T>('PATCH', path, body),
    del: <T = undefined>(path: string) => request<T>('DELETE', path),
    getBlob: (path: string) => requestBlob(path),
  }
}

/** Дефолтный клиент приложения: same-origin; auth-заголовки — 8.6 (Д8). */
export const apiClient = createApiClient({ defaultHeaders: authHeaders })
