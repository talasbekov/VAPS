// Story 20.5c — чистая модель штатного расписания (env node: ни React, ни apiClient).
import { describe, expect, it } from 'vitest'
import {
  describeStaffingTableFailure,
  parseStaffingTable,
} from './staffingTable'
import { ApiError, NetworkError } from '../../shared/api/errors'

function apiError(status: number, message = 'сообщение бэка') {
  return new ApiError({ status, errorCode: null, message, details: {}, requestId: null })
}

describe('parseStaffingTable', () => {
  it('parses a well-formed envelope', () => {
    const result = parseStaffingTable({
      business_date: '2026-07-01',
      count: 1,
      results: [
        {
          division_id: 'd1',
          position_code: 'P1',
          position_name: 'Инспектор',
          allocated: 5,
          filled: 4,
          vacant: 1,
        },
      ],
    })
    expect(result).toEqual({
      businessDate: '2026-07-01',
      count: 1,
      rows: [
        {
          division_id: 'd1',
          position_code: 'P1',
          position_name: 'Инспектор',
          allocated: 5,
          filled: 4,
          vacant: 1,
        },
      ],
    })
  })

  it('returns null on a malformed envelope', () => {
    expect(parseStaffingTable(null)).toBeNull()
    expect(parseStaffingTable({})).toBeNull()
    expect(parseStaffingTable({ business_date: '2026-07-01' })).toBeNull()
  })

  it('drops malformed rows without discarding valid ones', () => {
    const result = parseStaffingTable({
      business_date: '2026-07-01',
      count: 2,
      results: [
        {
          division_id: 'd1',
          position_code: 'P1',
          position_name: 'Инспектор',
          allocated: 5,
          filled: 4,
          vacant: 1,
        },
        { division_id: 'd2' },
        null,
      ],
    })
    expect(result?.rows).toEqual([
      {
        division_id: 'd1',
        position_code: 'P1',
        position_name: 'Инспектор',
        allocated: 5,
        filled: 4,
        vacant: 1,
      },
    ])
  })

  it('preserves negative vacant (rassinhron signal, not clamped)', () => {
    const result = parseStaffingTable({
      business_date: '2026-07-01',
      count: 1,
      results: [
        {
          division_id: 'd1',
          position_code: 'P1',
          position_name: 'Инспектор',
          allocated: 2,
          filled: 5,
          vacant: -3,
        },
      ],
    })
    expect(result?.rows[0]?.vacant).toBe(-3)
  })
})

describe('describeStaffingTableFailure', () => {
  it('classifies network/5xx/401 as silent', () => {
    expect(describeStaffingTableFailure(new NetworkError('сеть недоступна')).kind).toBe(
      'silent',
    )
    expect(describeStaffingTableFailure(apiError(500)).kind).toBe('silent')
    expect(describeStaffingTableFailure(apiError(401)).kind).toBe('silent')
  })

  it('classifies 400/422 as validation with a visible message', () => {
    const result = describeStaffingTableFailure(apiError(422, 'Некорректная дата.'))
    expect(result).toEqual({ kind: 'validation', message: 'Некорректная дата.' })
  })

  it('classifies other statuses (e.g. 403) as other with a visible message', () => {
    const result = describeStaffingTableFailure(apiError(403, 'нет доступа'))
    expect(result).toEqual({ kind: 'other', message: 'нет доступа' })
  })
})
