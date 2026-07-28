// Story 10.6b — контракт GET /daily-submissions/freshness/ на фронте.
// Окружение node (дефолт vite.config): функции чистые, DOM не нужен.
import { describe, expect, it } from 'vitest'

import { describeStaleness, parseSummaryFreshness } from './freshness'

describe('parseSummaryFreshness — тотализирующий разбор', () => {
  it('валидный FRESH проходит', () => {
    const raw = { status: 'FRESH', superseded: [], missing: [], unpinned: [] }
    expect(parseSummaryFreshness(raw)).toEqual(raw)
  })

  it('валидный NOT_SUMMARY проходит', () => {
    const raw = { status: 'NOT_SUMMARY', superseded: [], missing: [], unpinned: [] }
    expect(parseSummaryFreshness(raw)).toEqual(raw)
  })

  it('валидный STALE со всеми тремя осями проходит', () => {
    const raw = {
      status: 'STALE',
      superseded: [
        { division_id: 'a', pinned_version: 1, current_version: 2 },
      ],
      missing: [{ division_id: 'b', pinned_version: 1 }],
      unpinned: ['c'],
    }
    expect(parseSummaryFreshness(raw)).toEqual(raw)
  })

  it('мусорный status вне трёх литералов → null', () => {
    const raw = { status: 'WEIRD', superseded: [], missing: [], unpinned: [] }
    expect(parseSummaryFreshness(raw)).toBeNull()
  })

  it('не-объект → null', () => {
    expect(parseSummaryFreshness(null)).toBeNull()
    expect(parseSummaryFreshness('STALE')).toBeNull()
    expect(parseSummaryFreshness([])).toBeNull()
  })

  it('отсутствующая ось superseded → null', () => {
    const raw = { status: 'STALE', missing: [], unpinned: [] }
    expect(parseSummaryFreshness(raw)).toBeNull()
  })

  it('неверно типизированный элемент superseded (строка вместо числа) → null', () => {
    const raw = {
      status: 'STALE',
      superseded: [{ division_id: 'a', pinned_version: '1', current_version: 2 }],
      missing: [],
      unpinned: [],
    }
    expect(parseSummaryFreshness(raw)).toBeNull()
  })

  it('неверно типизированный элемент missing → null', () => {
    const raw = {
      status: 'STALE',
      superseded: [],
      missing: [{ division_id: 'a' }],
      unpinned: [],
    }
    expect(parseSummaryFreshness(raw)).toBeNull()
  })

  it('unpinned с не-строковым элементом → null', () => {
    const raw = { status: 'STALE', superseded: [], missing: [], unpinned: [42] }
    expect(parseSummaryFreshness(raw)).toBeNull()
  })
})

describe('describeStaleness — по осям, склонение количества', () => {
  it('только superseded — одна строка', () => {
    const lines = describeStaleness({
      status: 'STALE',
      superseded: [{ division_id: 'a', pinned_version: 1, current_version: 2 }],
      missing: [],
      unpinned: [],
    })
    expect(lines).toEqual(['1 подразделение пересдало после сборки сводки'])
  })

  it('только missing — одна строка', () => {
    const lines = describeStaleness({
      status: 'STALE',
      superseded: [],
      missing: [{ division_id: 'a', pinned_version: 1 }],
      unpinned: [],
    })
    expect(lines).toEqual(['1 подразделение без действующей сдачи'])
  })

  it('только unpinned — одна строка', () => {
    const lines = describeStaleness({
      status: 'STALE',
      superseded: [],
      missing: [],
      unpinned: ['a'],
    })
    expect(lines).toEqual(['1 новое подразделение вне сводки'])
  })

  it('все три оси сразу — три отдельные строки, не слитная', () => {
    const lines = describeStaleness({
      status: 'STALE',
      superseded: [{ division_id: 'a', pinned_version: 1, current_version: 2 }],
      missing: [{ division_id: 'b', pinned_version: 1 }],
      unpinned: ['c'],
    })
    expect(lines).toHaveLength(3)
  })

  it('все оси пусты — пустой массив (защита от вызова на не-STALE)', () => {
    expect(
      describeStaleness({ status: 'FRESH', superseded: [], missing: [], unpinned: [] }),
    ).toEqual([])
  })

  it.each([
    [1, '1 подразделение'],
    [2, '2 подразделения'],
    [5, '5 подразделений'],
  ])('склонение количества %i → %s', (n, expectedPrefix) => {
    const lines = describeStaleness({
      status: 'STALE',
      superseded: Array.from({ length: n }, (_, i) => ({
        division_id: `d${i}`,
        pinned_version: 1,
        current_version: 2,
      })),
      missing: [],
      unpinned: [],
    })
    expect(lines[0]).toMatch(new RegExp(`^${expectedPrefix}`))
  })
})
