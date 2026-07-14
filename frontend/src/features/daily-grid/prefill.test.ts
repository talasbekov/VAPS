// Story 9.7 — чистые мапперы prefill/bulk (node-env).
import { describe, expect, it } from 'vitest'

import type { EmployeeSeed, YesterdayPlacement } from './prefill'
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

  it('пустой statusCode из грязного вчера → дефолт, осиротевший period НЕ тащится', () => {
    // Ревью 9.6 (|| вместо ??) + ревью 9.7 P1: статус признан «отсутствующим» —
    // его period не должен пережить фолбэк и уехать с ДРУГИМ статусом.
    const rows = buildPrefilledRows([{ id: 'e0', fullName: 'A' }], {
      e0: { statusCode: '', period: '2026-07-20' },
    })
    expect(rows[0].statusCode).toBe(DEFAULT_STATUS)
    expect(rows[0].period).toBeUndefined()
  })

  it('дубль id сотрудника → первый выигрывает (дубль дал бы 400 бэка на весь payload)', () => {
    const rows = buildPrefilledRows(
      [
        { id: 'e0', fullName: 'A' },
        { id: 'e0', fullName: 'A-дубль' },
        { id: 'e1', fullName: 'B' },
      ],
      {},
    )
    expect(rows.map((r) => r.id)).toEqual(['e0', 'e1'])
    expect(rows[0].fullName).toBe('A')
  })

  it('самоисцеление входа: null/undefined employees/yesterday не роняют маппер', () => {
    expect(buildPrefilledRows(null as unknown as EmployeeSeed[], {})).toEqual(
      [],
    )
    const rows = buildPrefilledRows(
      [{ id: 'e0', fullName: 'A' }],
      undefined as unknown as YesterdayPlacement,
    )
    expect(rows[0].statusCode).toBe(DEFAULT_STATUS)
  })
})

describe('9.7 toBulkRequest', () => {
  it('только дельты; ключи date_start/date_end всегда; период «включительно» → +1 день', () => {
    // Контракт сервиса 3.8 (D1): _REQUIRED_ROW_KEYS требует оба ключа в КАЖДОЙ
    // строке; полуинтервал [s, e) — пустой период = один день [D, D+1).
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
        date_start: '2026-07-08',
        date_end: '2026-07-16',
      },
      {
        employee_id: 'e1',
        status_type_code: 'SICK',
        date_start: '2026-07-08',
        date_end: '2026-07-09',
      },
    ])
  })

  it('+1 день корректен на границах месяца/года (UTC-математика)', () => {
    const req = toBulkRequest(
      [
        { id: 'e0', statusCode: 'VACATION', period: '2026-07-31' },
        { id: 'e1', statusCode: 'SICK', period: '2026-12-31' },
      ],
      '2026-07-08',
    )
    expect(req.rows[0].date_end).toBe('2026-08-01')
    expect(req.rows[1].date_end).toBe('2027-01-01')
  })

  it('whitespace-период = пустой (день [D, D+1)); не-ISO мусор уходит как есть', () => {
    const req = toBulkRequest(
      [
        { id: 'e0', statusCode: 'SICK', period: '   ' },
        { id: 'e1', statusCode: 'SICK', period: '15.07.2026' },
      ],
      '2026-07-08',
    )
    expect(req.rows[0].date_end).toBe('2026-07-09')
    // Громкий 422 бэка вместо тихого Invalid Date; валидация = date-редактор E10.
    expect(req.rows[1].date_end).toBe('15.07.2026')
  })

  it('нет дельт → пустой rows', () => {
    expect(toBulkRequest([], '2026-07-08').rows).toEqual([])
  })
})
