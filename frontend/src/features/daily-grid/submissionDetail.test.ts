// Story 10.6c — контракт GET /daily-submissions/{id}/ на фронте.
// Окружение node (дефолт vite.config): функции чистые, DOM не нужен.
import { describe, expect, it } from 'vitest'

import { describeAmendmentReason, parseSubmissionDetail } from './submissionDetail'

function validRaw(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 12,
    division_id: '7a1b2c3d-4e5f-6071-8293-a4b5c6d7e8f9',
    business_date: '2026-07-19',
    version: 1,
    is_current: true,
    event: 'CHANGED',
    submitted_by: 'operator-1',
    submitted_at: '2026-07-19T08:15:00+05:00',
    late: false,
    snapshot: { any: 'shape' },
    reason: '',
    sanction: '',
    triggered_by_status_id: null,
    ...over,
  }
}

describe('parseSubmissionDetail — тотализирующий разбор', () => {
  it('валидный конверт (13 полей) проходит', () => {
    const raw = validRaw()
    expect(parseSubmissionDetail(raw)).toEqual(raw)
  })

  it('snapshot допускает ЛЮБОЙ тип (unknown) — не гейтится по форме', () => {
    expect(parseSubmissionDetail(validRaw({ snapshot: 'weird-string' }))).not.toBeNull()
    expect(parseSubmissionDetail(validRaw({ snapshot: null }))).not.toBeNull()
    expect(parseSubmissionDetail(validRaw({ snapshot: [1, 2, 3] }))).not.toBeNull()
  })

  it('triggered_by_status_id: число ИЛИ null проходят, остальное → null-результат', () => {
    expect(parseSubmissionDetail(validRaw({ triggered_by_status_id: 42 }))).not.toBeNull()
    expect(parseSubmissionDetail(validRaw({ triggered_by_status_id: null }))).not.toBeNull()
    expect(parseSubmissionDetail(validRaw({ triggered_by_status_id: 'weird' }))).toBeNull()
  })

  it('не-объект → null', () => {
    expect(parseSubmissionDetail(null)).toBeNull()
    expect(parseSubmissionDetail('STALE')).toBeNull()
  })

  it('мусорный event вне трёх литералов → null', () => {
    expect(parseSubmissionDetail(validRaw({ event: 'WEIRD' }))).toBeNull()
  })

  it.each(['id', 'division_id', 'business_date', 'version', 'is_current', 'submitted_by', 'submitted_at', 'late', 'reason', 'sanction'])(
    'отсутствующее поле %s → null',
    (field) => {
      const raw = validRaw()
      delete raw[field]
      expect(parseSubmissionDetail(raw)).toBeNull()
    },
  )
})

describe('describeAmendmentReason', () => {
  it('reason === "" → null (неисправленная версия)', () => {
    const detail = parseSubmissionDetail(validRaw())
    expect(detail).not.toBeNull()
    expect(describeAmendmentReason(detail!)).toBeNull()
  })

  it('reason !== "" → объект с обоими полями буквально', () => {
    const detail = parseSubmissionDetail(
      validRaw({ reason: 'Ошибка в ростере', sanction: 'Выговор' }),
    )
    expect(detail).not.toBeNull()
    expect(describeAmendmentReason(detail!)).toEqual({
      reason: 'Ошибка в ростере',
      sanction: 'Выговор',
    })
  })
})
