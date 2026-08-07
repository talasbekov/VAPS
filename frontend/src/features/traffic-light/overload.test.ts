// Story 20.3c — чистая модель дашборда перегрузки (env node: ни React, ни apiClient).
// Ревью 20.3c: `daysWord` был написан без теста — закрыто здесь.
import { describe, expect, it } from 'vitest'
import { daysWord, describeOverloadFailure, parseOverloadSummary } from './overload'
import { ApiError, NetworkError } from '../../shared/api/errors'

function apiError(status: number, message = 'сообщение бэка') {
  return new ApiError({ status, errorCode: null, message, details: {}, requestId: null })
}

describe('daysWord', () => {
  it('singular for 1', () => {
    expect(daysWord(1)).toBe('день')
  })

  it('paucal for 2-4', () => {
    expect(daysWord(2)).toBe('дня')
    expect(daysWord(3)).toBe('дня')
    expect(daysWord(4)).toBe('дня')
  })

  it('plural for 5-9 and 0', () => {
    expect(daysWord(0)).toBe('дней')
    expect(daysWord(5)).toBe('дней')
    expect(daysWord(9)).toBe('дней')
  })

  it('plural for the 11-14 exception (not paucal despite trailing 1-4)', () => {
    expect(daysWord(11)).toBe('дней')
    expect(daysWord(12)).toBe('дней')
    expect(daysWord(14)).toBe('дней')
  })

  it('resumes normal last-digit rule past teens', () => {
    expect(daysWord(21)).toBe('день')
    expect(daysWord(22)).toBe('дня')
    expect(daysWord(25)).toBe('дней')
  })
})

describe('parseOverloadSummary', () => {
  it('parses a well-formed envelope', () => {
    const result = parseOverloadSummary({
      division_id: 'd1',
      date_from: '2026-07-01',
      date_to: '2026-07-07',
      threshold_hours: '8',
      employees: [{ employee_id: 'e1', overload_days: ['2026-07-03'] }],
    })
    expect(result).toEqual({
      divisionId: 'd1',
      dateFrom: '2026-07-01',
      dateTo: '2026-07-07',
      employees: [{ employee_id: 'e1', overload_days: ['2026-07-03'] }],
    })
  })

  it('returns null on a malformed envelope', () => {
    expect(parseOverloadSummary(null)).toBeNull()
    expect(parseOverloadSummary({})).toBeNull()
    expect(parseOverloadSummary({ division_id: 'd1' })).toBeNull()
  })

  it('drops malformed employee rows without discarding valid ones', () => {
    const result = parseOverloadSummary({
      division_id: 'd1',
      date_from: '2026-07-01',
      date_to: '2026-07-07',
      employees: [
        { employee_id: 'e1', overload_days: ['2026-07-03'] },
        { employee_id: 123, overload_days: [] },
        null,
      ],
    })
    expect(result?.employees).toEqual([{ employee_id: 'e1', overload_days: ['2026-07-03'] }])
  })
})

describe('describeOverloadFailure', () => {
  it('classifies network/5xx/401 as silent', () => {
    expect(describeOverloadFailure(new NetworkError('сеть недоступна')).kind).toBe('silent')
    expect(describeOverloadFailure(apiError(500)).kind).toBe('silent')
    expect(describeOverloadFailure(apiError(401)).kind).toBe('silent')
  })

  it('classifies 400/422 as validation with a visible message', () => {
    const result = describeOverloadFailure(apiError(400, 'диапазон длиннее 62 дней'))
    expect(result).toEqual({ kind: 'validation', message: 'диапазон длиннее 62 дней' })
  })

  it('classifies other statuses (e.g. 403) as other with a visible message', () => {
    const result = describeOverloadFailure(apiError(403, 'нет доступа'))
    expect(result).toEqual({ kind: 'other', message: 'нет доступа' })
  })
})
