// Тесты модуля errors.ts: (1) контракт-тест Д1 (AC 7) — OVERRIDABLE_CODES ⇔
// множество overridable:true из docs/registries/error-codes.yaml, сверка В ОБЕ
// СТОРОНЫ, дрейф = красный gate (реестр — единственный источник истины; конверт
// §36 overridable не несёт); (2) юнит-тесты defensive-веток parseErrorResponse
// (AC 5, 6) — мусорные конверты, не достижимые через MSW-транспорт client.test.ts.
// reference types="node": app-tsconfig ограничен types:["vite/client"] и не
// трогается (граница стори) — node-builtins подключаются per-file директивой.
/// <reference types="node" />
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { parse } from 'yaml'
import {
  ApiError,
  BusinessRuleError,
  ConflictError,
  OVERRIDABLE_CODES,
  parseErrorResponse,
  ServerError,
  ValidationError,
} from './errors'

// Ловушка 7: кириллица в пути репо — fileURLToPath, НЕ URL.pathname
const REGISTRY_PATH = fileURLToPath(
  new URL('../../../../docs/registries/error-codes.yaml', import.meta.url),
)

interface RegistryCode {
  overridable?: boolean
}

interface Registry {
  codes: Record<string, RegistryCode>
}

function registryOverridable(): Set<string> {
  const registry = parse(readFileSync(REGISTRY_PATH, 'utf8')) as Registry
  return new Set(
    Object.entries(registry.codes)
      .filter(([, code]) => code.overridable === true)
      .map(([name]) => name),
  )
}

/** Сравнение множеств в обе стороны; diff и подсказка — в сообщении падения. */
function compareSets(
  registry: Set<string>,
  client: Set<string>,
): { ok: boolean; message: string } {
  const missingOnClient = [...registry].filter((c) => !client.has(c)).sort()
  const extraOnClient = [...client].filter((c) => !registry.has(c)).sort()
  const ok = missingOnClient.length === 0 && extraOnClient.length === 0
  const message = ok
    ? 'OVERRIDABLE_CODES синхронизирован с реестром'
    : 'OVERRIDABLE_CODES разошёлся с реестром — sync c docs/registries/error-codes.yaml. ' +
      `Нет на клиенте: [${missingOnClient.join(', ') || '—'}]; ` +
      `лишние на клиенте: [${extraOnClient.join(', ') || '—'}]`
  return { ok, message }
}

describe('OVERRIDABLE_CODES ⇔ error-codes.yaml (AC 7)', () => {
  it('sanity: реестр читается и несёт overridable-коды', () => {
    expect(registryOverridable().size).toBeGreaterThan(0)
  })

  it('множества совпадают в обе стороны', () => {
    const { ok, message } = compareSets(
      registryOverridable(),
      new Set(OVERRIDABLE_CODES),
    )
    expect(ok, message).toBe(true)
  })

  // Негативные контроли функции сравнения — страховка от вакуумного pass:
  // doctored-набор ОБЯЗАН детектиться в обе стороны.
  it('негативный контроль: лишний код на клиенте детектится', () => {
    const doctored = new Set(OVERRIDABLE_CODES)
    doctored.add('__DOCTORED_CODE__')
    const res = compareSets(registryOverridable(), doctored)
    expect(res.ok).toBe(false)
    expect(res.message).toContain('__DOCTORED_CODE__')
    expect(res.message).toContain('sync c docs/registries/error-codes.yaml')
  })

  it('негативный контроль: отсутствующий на клиенте код детектится', () => {
    const registry = registryOverridable()
    const [first, ...rest] = [...registry]
    const res = compareSets(registry, new Set(rest))
    expect(res.ok).toBe(false)
    expect(res.message).toContain(String(first))
    expect(res.message).toContain('sync c docs/registries/error-codes.yaml')
  })
})

// Юнит-уровень: Response конструируется напрямую (без MSW) — проверяются ветки
// readEnvelope/parseErrorResponse на мусорных конвертах, которые бэк-handler не
// шлёт, но защита от которых обязана существовать (Ловушка 3: конверт ≠ гарантия).
describe('parseErrorResponse: defensive-деградация (AC 5, 6)', () => {
  it('конверт без message → message = error_code, details → {}', async () => {
    const err = await parseErrorResponse(
      new Response(JSON.stringify({ error_code: 'VALIDATION_ERROR' }), {
        status: 400,
      }),
    )
    expect(err).toBeInstanceOf(ValidationError)
    expect(err.message).toBe('VALIDATION_ERROR')
    expect(err.details).toEqual({})
    expect(err.requestId).toBeNull()
  })

  it('мусорные поля конверта нормализуются: details не-объект → {}, request_id не-строка → null', async () => {
    const err = await parseErrorResponse(
      new Response(
        JSON.stringify({
          error_code: 'BUSINESS_DATE_OUT_OF_WINDOW',
          message: 'Вне окна.',
          details: 'oops',
          request_id: 42,
        }),
        { status: 422 },
      ),
    )
    expect(err).toBeInstanceOf(BusinessRuleError)
    expect(err.details).toEqual({})
    expect(err.requestId).toBeNull()
  })

  it('JSON не-объект (массив) → конверта нет → базовый ApiError, errorCode null', async () => {
    const err = await parseErrorResponse(
      new Response(JSON.stringify(['не', 'конверт']), { status: 400 }),
    )
    expect(err).toBeInstanceOf(ApiError)
    expect(err).not.toBeInstanceOf(ValidationError)
    expect(err.kind).toBe('api')
    expect(err.errorCode).toBeNull()
  })

  it('5xx с JSON без error_code (DRF-native) → ServerError без вторичного исключения', async () => {
    const err = await parseErrorResponse(
      new Response(JSON.stringify({ detail: 'Сервер упал.' }), {
        status: 500,
        statusText: 'Internal Server Error',
      }),
    )
    expect(err).toBeInstanceOf(ServerError)
    expect(err.kind).toBe('server')
    expect(err.errorCode).toBeNull()
    expect(err.message).toBe('HTTP 500 Internal Server Error')
  })

  it('пустой statusText → message «HTTP <status>» без хвоста', async () => {
    const err = await parseErrorResponse(new Response('упс', { status: 503 }))
    expect(err).toBeInstanceOf(ServerError)
    expect(err.message).toBe('HTTP 503')
  })

  it('ConflictError с errorCode null → overridable=false (defensive-ветка конструктора)', () => {
    const e = new ConflictError({
      status: 409,
      errorCode: null,
      message: 'конфликт без кода',
      details: {},
      requestId: null,
    })
    expect(e.overridable).toBe(false)
  })
})
