// Протокол ошибок §36 — единственная точка маппинга HTTP-статусов в типизированный
// ApiError-union (ARCH-FE-015). Ground truth:
// - конверт: apps/core/api/exception_handler.py::_envelope; в OpenAPI-схеме конверт
//   ОТСУТСТВУЕТ (schema.d.ts описывает только 2xx-ответы) — рукописный ErrorEnvelope
//   легален и НЕ нарушает ARCH-FE-011 («ручные типы при наличии схемы»);
// - семантика статусов (канон §Ошибки): 400 = ФОРМА, 422 = БИЗНЕС, 409 = КОНФЛИКТ;
// - handler переформатирует не всё: 405/406/415/429 остаются DRF-native ({"detail"}),
//   502 от nginx — HTML; парсер обязан деградировать без вторичных исключений.

/** Конверт §36: details — всегда объект (None → {}), request_id может быть null. */
export interface ErrorEnvelope {
  error_code: string
  message: string
  details: Record<string, unknown>
  request_id: string | null
  timestamp: string
}

/**
 * Коды 409-конфликтов, повторяемых с override_reason (категория conflict_soft
 * реестра). Конверт §36 поле overridable НЕ несёт (у DomainError оно есть,
 * _envelope не рендерит) — единственный источник истины:
 * docs/registries/error-codes.yaml; синхронизация в обе стороны — контракт-тест
 * errors.test.ts (дрейф = красный gate).
 */
export const OVERRIDABLE_CODES: ReadonlySet<string> = new Set([
  'SOFT_CONFLICT_DETECTED',
  'STATUS_OVERLAP_WARNING',
  'DUTY_CONFLICT_DETECTED',
])

export interface ApiErrorInit {
  status: number
  errorCode: string | null
  message: string
  details: Record<string, unknown>
  requestId: string | null
}

/**
 * Базовая ошибка HTTP-ответа (конвертированные 401/403/404 и любой прочий
 * не-2xx без спец-класса). Narrowing — instanceof И дискриминант kind;
 * constructor.name не использовать (ломается минификацией).
 */
export class ApiError extends Error {
  readonly kind:
    'api' | 'validation' | 'business_rule' | 'conflict' | 'server' = 'api'
  readonly status: number
  readonly errorCode: string | null
  readonly details: Record<string, unknown>
  readonly requestId: string | null

  constructor(init: ApiErrorInit) {
    super(init.message)
    this.name = 'ApiError'
    this.status = init.status
    this.errorCode = init.errorCode
    this.details = init.details
    this.requestId = init.requestId
  }
}

/** 400: нарушение ФОРМЫ — details несёт DRF-ошибки по полям (сырьё setError, 8.5). */
export class ValidationError extends ApiError {
  override readonly kind = 'validation' as const
  constructor(init: ApiErrorInit) {
    super(init)
    this.name = 'ValidationError'
  }
}

/** 422: нарушение БИЗНЕС-ПРАВИЛА (hard) — это НЕ ValidationError (Д2). */
export class BusinessRuleError extends ApiError {
  override readonly kind = 'business_rule' as const
  constructor(init: ApiErrorInit) {
    super(init)
    this.name = 'BusinessRuleError'
  }
}

/** 409: конфликт состояния; overridable выводится из OVERRIDABLE_CODES (Д1). */
export class ConflictError extends ApiError {
  override readonly kind = 'conflict' as const
  readonly overridable: boolean
  constructor(init: ApiErrorInit) {
    super(init)
    this.name = 'ConflictError'
    this.overridable =
      init.errorCode !== null && OVERRIDABLE_CODES.has(init.errorCode)
  }
}

/** ≥500 — с конвертом (INTERNAL_ERROR) или без (502 HTML от nginx). */
export class ServerError extends ApiError {
  override readonly kind = 'server' as const
  constructor(init: ApiErrorInit) {
    super(init)
    this.name = 'ServerError'
  }
}

/** HTTP-ответа не было (обрыв сети/DNS) — вне ApiError-иерархии (Д7). */
export class NetworkError extends Error {
  readonly kind = 'network' as const
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options)
    this.name = 'NetworkError'
  }
}

/**
 * Всё, чем может упасть вызов apiClient (тип ошибки useApiMutation, 8.5).
 * Ветвление — instanceof + kind-runtime; полноценный discriminated-union по
 * kind НЕ вводить: широкий kind базового ApiError поглощает narrowing
 * (нота L2 ревью 8.4).
 */
export type ApiFailure = ApiError | NetworkError

/** Defensive-чтение конверта: не-JSON тело или JSON без error_code → null. */
async function readEnvelope(response: Response): Promise<ErrorEnvelope | null> {
  let raw: unknown
  try {
    raw = await response.json()
  } catch {
    return null // 502 HTML и прочие не-JSON тела — конверта нет
  }
  if (typeof raw !== 'object' || raw === null) return null
  const data = raw as Record<string, unknown>
  if (typeof data.error_code !== 'string') return null // DRF-native {"detail"} и чужой JSON
  return {
    error_code: data.error_code,
    message: typeof data.message === 'string' ? data.message : data.error_code,
    details:
      typeof data.details === 'object' && data.details !== null
        ? (data.details as Record<string, unknown>)
        : {},
    request_id: typeof data.request_id === 'string' ? data.request_id : null,
    timestamp: typeof data.timestamp === 'string' ? data.timestamp : '',
  }
}

/** Единственная точка маппинга status → класс ошибки (ARCH-FE-015). */
export async function parseErrorResponse(
  response: Response,
): Promise<ApiError> {
  const status = response.status
  const envelope = await readEnvelope(response)
  const init: ApiErrorInit = envelope
    ? {
        status,
        errorCode: envelope.error_code,
        message: envelope.message,
        details: envelope.details,
        requestId: envelope.request_id,
      }
    : {
        status,
        errorCode: null,
        message: response.statusText
          ? `HTTP ${status} ${response.statusText}`
          : `HTTP ${status}`,
        details: {},
        requestId: null,
      }
  if (status >= 500) return new ServerError(init)
  if (envelope === null) return new ApiError(init)
  switch (status) {
    case 400:
      return new ValidationError(init)
    case 422:
      return new BusinessRuleError(init)
    case 409:
      return new ConflictError(init)
    default:
      return new ApiError(init)
  }
}
