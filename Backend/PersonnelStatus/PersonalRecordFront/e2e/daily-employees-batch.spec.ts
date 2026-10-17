import { expect, test } from '@playwright/test'
import { loadDailyEmployees, type DailyEmployee } from '../lib/daily-employees-batch'

const person = (id: number, level = 8): DailyEmployee => ({
  id: String(id), full_name: `Person ${id}`, rank_code: '', division_id: id, position_level: level,
})

test('empty scope does not issue a personnel request', async () => {
  let calls = 0
  expect(await loadDailyEmployees([], async () => { calls++; return { results: [] } })).toEqual({ results: [] })
  expect(calls).toBe(0)
})

test('200 divisions fit one request and the 201st remains visible in the next batch', async () => {
  for (const size of [200, 201, 577]) {
    const calls: number[][] = []
    const ids = Array.from({ length: size }, (_, index) => index + 1)
    const result = await loadDailyEmployees(ids, async (batch) => {
      calls.push(batch)
      if (batch.length > 200) throw new Error('API division limit exceeded')
      return { results: batch.map((id) => person(id)) }
    })
    expect(calls).toHaveLength(Math.ceil(size / 200))
    expect(new Set(calls.flat())).toEqual(new Set(ids))
    expect(new Set(result.results.map((row) => Number(row.id)))).toEqual(new Set(ids))
  }
})

test('duplicate input divisions and overlapping personnel do not duplicate people', async () => {
  const ids = [...Array.from({ length: 201 }, (_, index) => index + 1), 1, 201]
  const result = await loadDailyEmployees(ids, async (batch) => ({ results: [person(1), ...batch.map((id) => person(id))] }))
  expect(result.results).toHaveLength(201)
})

test('a rejected batch fails the whole result instead of exposing a partial roster', async () => {
  const ids = Array.from({ length: 201 }, (_, index) => index + 1)
  await expect(loadDailyEmployees(ids, async (batch) => {
    if (batch.includes(201)) throw new Error('Personnel service unavailable')
    return { results: batch.map((id) => person(id)) }
  })).rejects.toThrow('Personnel service unavailable')
})

test('batch response order preserves the global position hierarchy with missing positions last', async () => {
  const ids = Array.from({ length: 201 }, (_, index) => index + 1)
  const result = await loadDailyEmployees(ids, async (batch) => ({ results: batch.includes(201)
    ? [{ ...person(201, 1), full_name: 'Яков' }]
    : [{ ...person(1, 8), full_name: 'Алексей' }, { ...person(2), position_level: null }],
  }))
  expect(result.results.map((row) => row.id)).toEqual(['201', '1', '2'])
})

test('very large trees keep at most three requests in flight', async () => {
  let active = 0
  let peak = 0
  await loadDailyEmployees(Array.from({ length: 1201 }, (_, index) => index + 1), async () => {
    active++; peak = Math.max(peak, active)
    await new Promise((resolve) => setTimeout(resolve, 1))
    active--
    return { results: [] }
  })
  expect(peak).toBeLessThanOrEqual(3)
})
