// Story 20.6c — чистая модель сводки по статусам (env node: ни React, ни apiClient).
import { describe, expect, it } from 'vitest'
import {
  REPORT_COLUMN_LABELS,
  describeStatusSummaryFailure,
  parseStatusSummary,
} from './statusSummary'
import { ApiError, NetworkError } from '../../shared/api/errors'

function apiError(status: number, message = 'сообщение бэка') {
  return new ApiError({ status, errorCode: null, message, details: {}, requestId: null })
}

function envelope(overrides: Record<string, unknown> = {}) {
  return {
    business_date: '2026-07-08',
    division_id: null,
    staff_total: 10,
    list_total: 8,
    vacancies: 2,
    attached: 1,
    columns: { IN_SERVICE: 5, ON_DUTY: 3 },
    ...overrides,
  }
}

describe('REPORT_COLUMN_LABELS', () => {
  it('carries all 11 report columns, fixed order', () => {
    expect(REPORT_COLUMN_LABELS.map((c) => c.code)).toEqual([
      'SICK',
      'VACATION',
      'COMMAND',
      'TRAINING',
      'OTHER',
      'DETACHED',
      'AFTER_DUTY',
      'BEFORE_DUTY',
      'ON_DUTY',
      'PENDING',
      'IN_SERVICE',
    ])
  })

  it('every column has a non-empty Russian label', () => {
    for (const column of REPORT_COLUMN_LABELS) {
      expect(column.label.length).toBeGreaterThan(0)
    }
  })
})

describe('parseStatusSummary', () => {
  it('parses a well-formed org-wide envelope (division_id: null)', () => {
    const result = parseStatusSummary(envelope())
    expect(result).toEqual({
      businessDate: '2026-07-08',
      divisionId: null,
      staffTotal: 10,
      listTotal: 8,
      vacancies: 2,
      attached: 1,
      columns: { IN_SERVICE: 5, ON_DUTY: 3 },
    })
  })

  it('parses a division-scoped envelope', () => {
    const result = parseStatusSummary(envelope({ division_id: 'd1' }))
    expect(result?.divisionId).toBe('d1')
  })

  it('returns null on a malformed envelope', () => {
    expect(parseStatusSummary(null)).toBeNull()
    expect(parseStatusSummary({})).toBeNull()
    expect(parseStatusSummary(envelope({ columns: null }))).toBeNull()
    expect(parseStatusSummary(envelope({ staff_total: 'ten' }))).toBeNull()
  })

  it('drops non-numeric columns entries without discarding valid ones', () => {
    const result = parseStatusSummary(
      envelope({ columns: { IN_SERVICE: 5, GARBAGE: 'nope', ON_DUTY: 3 } }),
    )
    expect(result?.columns).toEqual({ IN_SERVICE: 5, ON_DUTY: 3 })
  })
})

describe('describeStatusSummaryFailure', () => {
  it('classifies network/5xx/401 as silent', () => {
    expect(describeStatusSummaryFailure(new NetworkError('сеть недоступна')).kind).toBe(
      'silent',
    )
    expect(describeStatusSummaryFailure(apiError(500)).kind).toBe('silent')
    expect(describeStatusSummaryFailure(apiError(401)).kind).toBe('silent')
  })

  it('classifies 400/422 as validation with a visible message', () => {
    const result = describeStatusSummaryFailure(apiError(422, 'Некорректная дата.'))
    expect(result).toEqual({ kind: 'validation', message: 'Некорректная дата.' })
  })

  it('classifies other statuses (e.g. 403) as other with a visible message', () => {
    const result = describeStatusSummaryFailure(apiError(403, 'нет доступа'))
    expect(result).toEqual({ kind: 'other', message: 'нет доступа' })
  })
})
