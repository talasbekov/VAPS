import { beforeEach, describe, expect, it } from 'vitest'
import {
  ensureSeeded,
  getPersistenceAdapter,
  resetDemoClockForTests,
  resetPersistenceAdapterForTests,
} from './demo-runtime'
import { SCHEMA_VERSION } from './compose-seed'

describe('ensureSeeded', () => {
  beforeEach(() => {
    resetPersistenceAdapterForTests()
    resetDemoClockForTests()
  })

  it('сидирует пустое хранилище', async () => {
    await ensureSeeded()
    const snapshot = await getPersistenceAdapter().load()
    expect(snapshot).not.toBeNull()
    expect(snapshot?.slices['security-events']).toBeDefined()
  })

  it('повторный вызов на уже засеянном хранилище — идемпотентен (не растит revision)', async () => {
    await ensureSeeded()
    const first = await getPersistenceAdapter().load()
    await ensureSeeded()
    const second = await getPersistenceAdapter().load()
    expect(second?.revision).toBe(first?.revision)
  })

  it('schema_version несовпадение → безопасный полный reset, а не краш на устаревшей форме', async () => {
    await ensureSeeded()
    const adapter = getPersistenceAdapter()
    const stale = await adapter.load()
    if (stale === null) throw new Error('setup failed')

    // Симулируем «устаревшую форму» прошлой сессии: старая schema_version +
    // слайс security-events БЕЗ reconChecklist/reconSectorPosts (ровно баг,
    // найденный вручную в браузере 2026-07-23).
    await adapter.replace({
      ...stale,
      schema_version: SCHEMA_VERSION - 1,
      slices: {
        'security-events': {
          events: [{ id: 'evt-legacy', title: 'Легаси-событие' /* без reconChecklist */ }],
        },
      },
    })

    await ensureSeeded()
    const fresh = await adapter.load()
    expect(fresh?.schema_version).toBe(SCHEMA_VERSION)
    const events = (fresh?.slices['security-events'] as { events: unknown[] }).events
    // Легаси-запись заменена свежим сидом (не смержена частично)
    expect(events.some((e) => (e as { id: string }).id === 'evt-legacy')).toBe(false)
  })

  it('тот же schema_version, но появился новый слайс → backfill без потери существующих данных', async () => {
    await ensureSeeded()
    const adapter = getPersistenceAdapter()
    const current = await adapter.load()
    if (current === null) throw new Error('setup failed')

    // Существующий слайс "тронут" пользователем — backfill НЕ должен его перезаписать.
    await adapter.replace({
      ...current,
      slices: { ...current.slices, 'security-events': { events: [] } },
    })

    await ensureSeeded()
    const after = await adapter.load()
    expect(after?.slices['security-events']).toEqual({ events: [] })
  })
})
