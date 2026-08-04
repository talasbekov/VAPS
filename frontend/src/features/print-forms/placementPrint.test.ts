// Story 16.7 (review, Edge Case Hunter) — dedicated unit tests for
// placementPrint.ts's pure functions, образец expensePrint.test.ts's
// isolation-level coverage (node env, no React/apiClient).
import { describe, expect, it } from 'vitest'
import { NetworkError, ApiError } from '../../shared/api/errors'
import {
  PRINT_NOT_FOUND_MESSAGE,
  describePrintFailure,
  formatPrintDateTime,
} from './placementPrint'

describe('formatPrintDateTime', () => {
  it('formats a valid ISO datetime', () => {
    expect(formatPrintDateTime('2026-08-02T10:00:00Z')).toMatch(/2026/)
  })

  it('returns the input verbatim for an invalid date string', () => {
    expect(formatPrintDateTime('not-a-date')).toBe('not-a-date')
  })
})

describe('describePrintFailure', () => {
  it('network error -> other, with text', () => {
    const error = new NetworkError('offline')
    const result = describePrintFailure(error)
    expect(result.kind).toBe('other')
    expect(result.message).toContain('offline')
  })

  it('401 -> silent, empty message', () => {
    const error = new ApiError({
      status: 401,
      errorCode: 'AUTH_REQUIRED',
      message: 'Требуется вход',
      details: {},
      requestId: null,
    })
    expect(describePrintFailure(error)).toEqual({ kind: 'silent', message: '' })
  })

  it('404 -> not-found, fixed message', () => {
    const error = new ApiError({
      status: 404,
      errorCode: 'ENTITY_NOT_FOUND',
      message: 'Не найдено',
      details: {},
      requestId: null,
    })
    expect(describePrintFailure(error)).toEqual({
      kind: 'not-found',
      message: PRINT_NOT_FOUND_MESSAGE,
    })
  })

  it('500 -> other, with text', () => {
    const error = new ApiError({
      status: 500,
      errorCode: null,
      message: 'Внутренняя ошибка',
      details: {},
      requestId: null,
    })
    const result = describePrintFailure(error)
    expect(result.kind).toBe('other')
    expect(result.message).toContain('Внутренняя ошибка')
  })
})
