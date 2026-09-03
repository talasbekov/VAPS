// Протокол ошибок бэкенда охранных мероприятий (ОМ): единая точка маппинга
// HTTP-статусов в типизированные классы ошибок для страниц /security-ops/*.
// Семантика статусов: 400 = ошибка ФОРМЫ (детали по полям), 422 = нарушение
// БИЗНЕС-ПРАВИЛА, 409 = конфликт состояния (часть кодов допускает override).
// Парсер обязан деградировать без вторичных исключений: тело может быть
// не-JSON (HTML от прокси) или JSON без конверта (DRF-native {"detail"}).

/** Конверт ошибки бэкенда ОМ: details — всегда объект, request_id может быть null. */
export interface OpsErrorEnvelope {
  error_code: string;
  message: string;
  details: Record<string, unknown>;
  request_id: string | null;
  timestamp: string;
}

/**
 * Коды 409-конфликтов, которые разрешено повторить с override_reason
 * («мягкие» конфликты). Источник истины — реестр кодов бэкенда ОМ;
 * при подключении реального бэка список сверить.
 */
export const OVERRIDABLE_CODES: ReadonlySet<string> = new Set([
  "SOFT_CONFLICT_DETECTED",
  "STATUS_OVERLAP_WARNING",
  "DUTY_CONFLICT_DETECTED",
  // Недобор при завершении расстановки (`[РАС-06]`, Plane №396): «K постов
  // без людей. Завершить с недобором?» — тот же протокол подтверждения
  // причиной, что и у обхода предупреждения по рейтингу.
  "PLACEMENT_UNDERSTAFFED",
]);

export interface OpsApiErrorInit {
  status: number;
  errorCode: string | null;
  message: string;
  details: Record<string, unknown>;
  requestId: string | null;
}

/**
 * Базовая ошибка HTTP-ответа ОМ (401/403/404 и любой прочий не-2xx без
 * спец-класса). Ветвление — instanceof и дискриминант kind;
 * constructor.name не использовать — ломается минификацией.
 */
export class OpsApiError extends Error {
  readonly kind: "api" | "validation" | "business_rule" | "conflict" | "server" =
    "api";
  readonly status: number;
  readonly errorCode: string | null;
  readonly details: Record<string, unknown>;
  readonly requestId: string | null;

  constructor(init: OpsApiErrorInit) {
    super(init.message);
    this.name = "OpsApiError";
    this.status = init.status;
    this.errorCode = init.errorCode;
    this.details = init.details;
    this.requestId = init.requestId;
  }
}

/** 400: ошибка формы — details несёт ошибки по полям (сырьё для RHF setError). */
export class OpsValidationError extends OpsApiError {
  override readonly kind = "validation" as const;
  constructor(init: OpsApiErrorInit) {
    super(init);
    this.name = "OpsValidationError";
  }
}

/** 422: нарушение бизнес-правила (жёсткое) — это НЕ ошибка формы. */
export class OpsBusinessRuleError extends OpsApiError {
  override readonly kind = "business_rule" as const;
  constructor(init: OpsApiErrorInit) {
    super(init);
    this.name = "OpsBusinessRuleError";
  }
}

/** 409: конфликт состояния; overridable выводится из OVERRIDABLE_CODES. */
export class OpsConflictError extends OpsApiError {
  override readonly kind = "conflict" as const;
  readonly overridable: boolean;
  constructor(init: OpsApiErrorInit) {
    super(init);
    this.name = "OpsConflictError";
    this.overridable =
      init.errorCode !== null && OVERRIDABLE_CODES.has(init.errorCode);
  }
}

/** ≥500 — с конвертом (INTERNAL_ERROR) или без него (HTML от прокси). */
export class OpsServerError extends OpsApiError {
  override readonly kind = "server" as const;
  constructor(init: OpsApiErrorInit) {
    super(init);
    this.name = "OpsServerError";
  }
}

/** HTTP-ответа не было вовсе (обрыв сети/DNS) — вне иерархии OpsApiError. */
export class OpsNetworkError extends Error {
  readonly kind = "network" as const;
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "OpsNetworkError";
  }
}

/** Всё, чем может упасть вызов opsApiClient (тип ошибки use-ops-mutation). */
export type OpsApiFailure = OpsApiError | OpsNetworkError;

/** Defensive-чтение конверта: не-JSON тело или JSON без error_code → null. */
async function readEnvelope(response: Response): Promise<OpsErrorEnvelope | null> {
  let raw: unknown;
  try {
    raw = await response.json();
  } catch {
    return null; // HTML и прочие не-JSON тела — конверта нет
  }
  if (typeof raw !== "object" || raw === null) return null;
  const data = raw as Record<string, unknown>;
  if (typeof data.error_code !== "string") {
    // DRF-NATIVE {"detail": "..."} — ПРИЧИНА ЕСТЬ, и терять её нельзя
    // (Plane №274). Раньше здесь возвращался null, и человек видел
    // «HTTP 400 Bad Request» вместо «Должность используется в штатном
    // расписании (3) — сначала снимите эти назначения». Ручки раздела ОМ
    // отвечают конвертом и этой ветки не касаются; сюда попадают соседние
    // ручки бэкенда — кадровые справочники и всё, что отвечает по-DRF.
    //
    // Пустой `error_code` — признак «конверта не было»: по нему ниже
    // выбирается общий класс ошибки, а не разбор по коду, которого нет.
    if (typeof data.detail === "string" && data.detail !== "") {
      return {
        error_code: "",
        message: data.detail,
        details: {},
        request_id: null,
        timestamp: "",
      };
    }
    return null; // чужой JSON без причины
  }
  return {
    error_code: data.error_code,
    message: typeof data.message === "string" ? data.message : data.error_code,
    details:
      typeof data.details === "object" && data.details !== null
        ? (data.details as Record<string, unknown>)
        : {},
    request_id: typeof data.request_id === "string" ? data.request_id : null,
    timestamp: typeof data.timestamp === "string" ? data.timestamp : "",
  };
}

/** Единственная точка маппинга status → класс ошибки для клиента ОМ. */
export async function parseOpsErrorResponse(
  response: Response
): Promise<OpsApiError> {
  const status = response.status;
  const envelope = await readEnvelope(response);
  const init: OpsApiErrorInit = envelope
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
      };
  if (status >= 500) return new OpsServerError(init);
  if (envelope === null) return new OpsApiError(init);
  // Ответ без конверта, но с причиной: класс общий (разбирать нечего по
  // коду), сообщение — настоящее.
  if (envelope.error_code === "") return new OpsApiError(init);
  switch (status) {
    case 400:
      return new OpsValidationError(init);
    case 422:
      return new OpsBusinessRuleError(init);
    case 409:
      return new OpsConflictError(init);
    default:
      return new OpsApiError(init);
  }
}
