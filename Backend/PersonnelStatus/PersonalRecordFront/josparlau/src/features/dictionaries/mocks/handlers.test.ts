// Handler-уровень: проверяется, что MSW действительно СОПОСТАВЛЯЕТ маршруты
// раздела с реальными URL, которые строит клиент. Приём Этапа 49: КАЖДЫЙ новый
// путь с параметром получает такой тест — юнит-тесты репозитория зовут функции
// напрямую и несовпадения маршрута не увидели бы.
//
// Здесь это особенно уместно: удаление живёт по пути
// `/api/ops/dictionaries/entries/:id/`, а рядом уже есть
// `/api/ops/dictionaries/:code/entries/` — формы похожи, и перехват одного
// маршрута другим не дал бы ни ошибки, ни предупреждения.
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { setupServer } from 'msw/node'
import { createApiClient } from '../../../shared/api/client'
import { ApiError } from '../../../shared/api/errors'
import { createMemoryPersistence } from '../../../shared/testing/mock-runtime/memory-persistence'
import { DemoClock } from '../../../shared/testing/mock-runtime/demo-clock'
import { registerRbacDirectory } from '../../../shared/testing/mock-runtime/rbac-directory'
import type { SeedContext } from '../../../shared/testing/mock-runtime/seed-context'
import {
  SeededRandom,
  StableIdGenerator,
} from '../../../shared/testing/mock-runtime/id-generator'
import {
  DICTIONARIES_PATH,
  dictionaryEntriesPath,
  dictionaryEntryPath,
  dictionaryEntrySetActivePath,
} from '../api/pending-contracts'
import type { ListDictionaryEntriesResponse } from '../api/pending-contracts'
import { createDictionariesHandlers } from './handlers'
import { buildDictionariesSeed } from './fixtures'

const CLOCK_ISO = '2026-07-20T08:00:00+05:00'
const ADMIN = 'admin-user'
const BASE = 'http://localhost'

const adapter = createMemoryPersistence()
const clock = new DemoClock(CLOCK_ISO)
const server = setupServer(...createDictionariesHandlers(adapter, clock))

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }))
afterAll(() => server.close())
afterEach(() => server.resetHandlers(...createDictionariesHandlers(adapter, clock)))

beforeEach(async () => {
  const seedContext: SeedContext = {
    clock,
    ids: new StableIdGenerator('dictionaries-handlers-test'),
    random: new SeededRandom('dictionaries-handlers-test'),
    scenario: { id: 'normal', startIso: CLOCK_ISO },
    builtSlices: {},
  }
  const { sliceName, data } = buildDictionariesSeed(seedContext)
  await adapter.reset({
    application: 'smart-josparlau',
    schema_version: 29,
    seed_version: 'test-v29',
    scenario: 'normal',
    revision: 0,
    created_at: CLOCK_ISO,
    updated_at: CLOCK_ISO,
    slices: {
      [sliceName]: data,
      // Чужой слайс ОМ — источник связей типов записей журнала. Без него
      // связи были бы UNKNOWN, и удаление отклонялось бы по другой причине.
      'security-events': {
        events: [
          {
            id: 'event-1',
            code: 'ОМ-2026-3',
            title: 'Тестовое мероприятие',
            journalEntries: [{ id: 'j-1', type: 'INSTRUCTION' }],
          },
        ],
      },
    },
  })
  registerRbacDirectory([
    { userId: ADMIN, permissions: ['ops.dictionary.view', 'ops.dictionary.manage'] },
  ])
})

const client = createApiClient({ baseUrl: BASE, defaultHeaders: { 'X-User-Id': ADMIN } })

async function statusOf(call: () => Promise<unknown>): Promise<number> {
  try {
    await call()
    return 200
  } catch (error) {
    if (error instanceof ApiError) return error.status
    throw error
  }
}

async function entryIdByCode(dictionaryCode: string, code: string): Promise<string> {
  const body = await client.get<ListDictionaryEntriesResponse>(
    dictionaryEntriesPath(dictionaryCode),
  )
  const found = body.results.find((e) => e.code === code)
  if (found === undefined) throw new Error(`значение ${code} не найдено`)
  return found.id
}

describe('dictionaries handlers — сопоставление маршрутов', () => {
  it('GET реестра и значений совпадают со своими путями', async () => {
    expect(await statusOf(() => client.get(DICTIONARIES_PATH))).toBe(200)
    expect(await statusOf(() => client.get(dictionaryEntriesPath('RETURN_REASONS')))).toBe(200)
  })

  it('DELETE значения совпадает с путём, который строит КЛИЕНТ, а не перехватывается соседним маршрутом', async () => {
    // ORDER — тип записи журнала без единой ссылки: связи ОТСЛЕЖИВАЮТСЯ и
    // равны нулю, значит удаление законно и доезжает до репозитория.
    const id = await entryIdByCode('JOURNAL_ENTRY_TYPES', 'ORDER')
    expect(await statusOf(() => client.del(dictionaryEntryPath(id)))).toBe(200)

    const after = await client.get<ListDictionaryEntriesResponse>(
      dictionaryEntriesPath('JOURNAL_ENTRY_TYPES'),
    )
    expect(after.results.some((e) => e.code === 'ORDER')).toBe(false)
  })

  it('DELETE используемого значения доезжает 409 с зависимостью в details, а не 500', async () => {
    const id = await entryIdByCode('JOURNAL_ENTRY_TYPES', 'INSTRUCTION')
    const error = await client.del(dictionaryEntryPath(id)).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(ApiError)
    expect((error as ApiError).status).toBe(409)
    expect((error as ApiError).errorCode).toBe('DICTIONARY_ENTRY_REFERENCED')
    expect(JSON.stringify((error as ApiError).details)).toContain('Записи журнала штаба')
  })

  it('POST set-active не перехватывается маршрутом удаления — пути различаются сегментом', async () => {
    const id = await entryIdByCode('JOURNAL_ENTRY_TYPES', 'ORDER')
    expect(
      await statusOf(() => client.post(dictionaryEntrySetActivePath(id), { isActive: false })),
    ).toBe(200)

    const after = await client.get<ListDictionaryEntriesResponse>(
      dictionaryEntriesPath('JOURNAL_ENTRY_TYPES'),
    )
    // Значение осталось — деактивация не удаление.
    expect(after.results.find((e) => e.code === 'ORDER')?.isActive).toBe(false)
  })

  it('неизвестный id удаления доезжает 404', async () => {
    expect(await statusOf(() => client.del(dictionaryEntryPath('does-not-exist')))).toBe(404)
  })
})
