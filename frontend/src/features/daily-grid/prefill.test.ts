// Story 9.7 — чистые мапперы prefill/bulk (node-env).
import { describe, expect, it } from 'vitest'

import { DEFAULT_STATUS, buildPrefilledRows, toBulkRequest } from './prefill'

describe('9.7 buildPrefilledRows', () => {
  it('вчера → statusCode/period; без вчера → дефолт IN_SERVICE', () => {
    const rows = buildPrefilledRows(
      [
        { id: 'e0', fullName: 'A' },
        { id: 'e1', fullName: 'B' },
      ],
      { e0: { statusCode: 'VACATION', period: '2026-07-15' } },
    )
    expect(rows[0]).toMatchObject({
      id: 'e0',
      statusCode: 'VACATION',
      period: '2026-07-15',
    })
    expect(rows[1].statusCode).toBe(DEFAULT_STATUS)
    expect(rows[1].period).toBeUndefined()
  })
})

describe('9.7 toBulkRequest', () => {
  it('только дельты; period → date_end; пустой period опущен', () => {
    const req = toBulkRequest(
      [
        { id: 'e0', statusCode: 'VACATION', period: '2026-07-15' },
        { id: 'e1', statusCode: 'SICK', period: '' },
      ],
      '2026-07-08',
    )
    expect(req.business_date).toBe('2026-07-08')
    expect(req.rows).toEqual([
      {
        employee_id: 'e0',
        status_type_code: 'VACATION',
        date_end: '2026-07-15',
      },
      { employee_id: 'e1', status_type_code: 'SICK' },
    ])
  })

  it('нет дельт → пустой rows', () => {
    expect(toBulkRequest([], '2026-07-08').rows).toEqual([])
  })
})
