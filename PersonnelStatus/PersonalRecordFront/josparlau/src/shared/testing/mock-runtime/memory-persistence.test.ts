import { describe, expect, it } from 'vitest'
import { createMemoryPersistence } from './memory-persistence'
import { PersistenceSchemaError } from './persistence'
import type { DemoStateEnvelope } from './persistence'
import { DemoClock } from './demo-clock'
import { runMutation } from './transaction'

function seedEnvelope(
  overrides: Partial<DemoStateEnvelope> = {},
): DemoStateEnvelope {
  return {
    application: 'smart-josparlau',
    schema_version: 1,
    seed_version: 'normal-v1',
    scenario: 'normal',
    revision: 0,
    created_at: '2026-07-20T08:00:00+05:00',
    updated_at: '2026-07-20T08:00:00+05:00',
    slices: {},
    ...overrides,
  }
}

describe('createMemoryPersistence', () => {
  it('load() пуст до первого reset/replace', async () => {
    const adapter = createMemoryPersistence()
    await expect(adapter.load()).resolves.toBeNull()
  })

  it('transaction() до seed кидает, а не создаёт снапшот из ничего', async () => {
    const adapter = createMemoryPersistence()
    await expect(
      adapter.transaction(() => ({}), '2026-07-20T09:00:00+05:00'),
    ).rejects.toThrow()
  })

  it('reset() задаёт снапшот, transaction() увеличивает revision монотонно', async () => {
    const adapter = createMemoryPersistence()
    await adapter.reset(seedEnvelope())
    const clock = new DemoClock('2026-07-20T09:00:00+05:00')

    // runMutation() сдвигает часы на 1мс перед коммитом (уникальный updated_at
    // между последовательными сохранениями, см. transaction.ts) — отсюда `.001`.
    const first = await runMutation(adapter, clock, () => ({ a: 1 }))
    expect(first.revision).toBe(1)
    expect(first.updated_at).toBe('2026-07-20T09:00:00.001+05:00')

    clock.set('2026-07-20T10:00:00+05:00')
    const second = await runMutation(adapter, clock, () => ({ a: 2 }))
    expect(second.revision).toBe(2)
    expect(second.updated_at).toBe('2026-07-20T10:00:00.001+05:00')
  })

  it('mutator, бросивший исключение, не меняет снапшот (нет частичной записи)', async () => {
    const adapter = createMemoryPersistence()
    await adapter.reset(seedEnvelope({ slices: { a: 1 } }))

    await expect(
      adapter.transaction(() => {
        throw new Error('boom')
      }, '2026-07-20T09:00:00+05:00'),
    ).rejects.toThrow('boom')

    const snapshot = await adapter.load()
    expect(snapshot?.revision).toBe(0)
    expect(snapshot?.slices).toEqual({ a: 1 })
  })

  it('конкурентные transaction() сериализуются, а не гонятся', async () => {
    const adapter = createMemoryPersistence()
    await adapter.reset(seedEnvelope({ slices: { counter: 0 } }))
    const clock = new DemoClock('2026-07-20T09:00:00+05:00')

    await Promise.all(
      Array.from({ length: 10 }, () =>
        runMutation(adapter, clock, (current) => ({
          counter: (current.slices as { counter: number }).counter + 1,
        })),
      ),
    )

    const snapshot = await adapter.load()
    expect((snapshot?.slices as { counter: number }).counter).toBe(10)
    expect(snapshot?.revision).toBe(10)
  })

  it('migrate() применяет цепочку N-1 → N', () => {
    const adapter = createMemoryPersistence()
    const old = seedEnvelope({ schema_version: 1, slices: { legacy: true } })
    const migrated = adapter.migrate(
      old,
      { 1: (e) => ({ ...e, schema_version: 2, slices: { migrated: true } }) },
      2,
    )
    expect(migrated.schema_version).toBe(2)
    expect(migrated.slices).toEqual({ migrated: true })
  })

  it('migrate() без пути миграции кидает PersistenceSchemaError', () => {
    const adapter = createMemoryPersistence()
    const old = seedEnvelope({ schema_version: 1 })
    expect(() => adapter.migrate(old, {}, 2)).toThrow(PersistenceSchemaError)
  })

  it('getMetadata() отражает scenario/revision текущего снапшота', async () => {
    const adapter = createMemoryPersistence()
    await adapter.reset(seedEnvelope({ scenario: 'normal' }))
    await expect(adapter.getMetadata()).resolves.toMatchObject({
      scenario: 'normal',
      revision: 0,
      seed_version: 'normal-v1',
    })
  })
})
