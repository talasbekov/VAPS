// Handler-уровень: проверяется, что MSW действительно СОПОСТАВЛЯЕТ маршруты
// раздела с реальными URL, которые строит клиент. Тесты репозитория этого не
// видят (они зовут функции напрямую), а тест страницы подменяет handler'ы
// своими — обе половины были зелёными, пока PATCH не совпадал ни с чем.
//
// Так и был найден дефект (живым прогоном в браузере): паттерн собирался
// `settingPath(':settingCode')`, а фабрика делает `encodeURIComponent` — в
// шаблон уезжало `%3AsettingCode`, и запрос молча уходил в onUnhandledRequest.
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { setupServer } from 'msw/node'
import { createApiClient } from '../../../shared/api/client'
import { ApiError } from '../../../shared/api/errors'
import { createMemoryPersistence } from '../../../shared/testing/mock-runtime/memory-persistence'
import { DemoClock } from '../../../shared/testing/mock-runtime/demo-clock'
import { registerRbacDirectory } from '../../../shared/testing/mock-runtime/rbac-directory'
import { SETTINGS_PATH, SETTING_CHANGES_PATH, settingPath } from '../api/pending-contracts'
import { createSettingsHandlers } from './handlers'
import { buildSettingsSeed } from './fixtures'

const CLOCK_ISO = '2026-07-20T08:00:00+05:00'
const ADMIN = 'admin-user'
const BASE = 'http://localhost'
const SETTING_CODE = 'ATTENTION.ACKNOWLEDGEMENT_MISSING.PARAMETER'

const adapter = createMemoryPersistence()
const clock = new DemoClock(CLOCK_ISO)
const server = setupServer(...createSettingsHandlers(adapter, clock))

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }))
afterAll(() => server.close())
afterEach(() => server.resetHandlers(...createSettingsHandlers(adapter, clock)))

beforeEach(async () => {
  const { sliceName, data } = buildSettingsSeed()
  await adapter.reset({
    application: 'smart-josparlau',
    schema_version: 26,
    seed_version: 'test-v26',
    scenario: 'normal',
    revision: 0,
    created_at: CLOCK_ISO,
    updated_at: CLOCK_ISO,
    slices: { [sliceName]: data },
  })
  registerRbacDirectory([
    { userId: ADMIN, permissions: ['ops.settings.view', 'ops.settings.manage'] },
  ])
})

// HTTP — только через apiClient (ARCH-FE-015; сырой fetch запрещён eslint-ом).
// Здесь это и точнее: клиент строит запрос ровно так же, как приложение.
const client = createApiClient({
  baseUrl: BASE,
  defaultHeaders: { 'X-User-Id': ADMIN },
})

/** Статус неуспешного ответа: apiClient кидает типизированную ошибку. */
async function statusOf(call: () => Promise<unknown>): Promise<number> {
  try {
    await call()
    return 200
  } catch (error) {
    if (error instanceof ApiError) return error.status
    throw error
  }
}

describe('settings handlers — сопоставление маршрутов', () => {
  it('GET списка и журнала совпадают со своими путями', async () => {
    expect(await statusOf(() => client.get(SETTINGS_PATH))).toBe(200)
    expect(await statusOf(() => client.get(SETTING_CHANGES_PATH))).toBe(200)
  })

  it('PATCH совпадает с путём, который строит КЛИЕНТ (settingPath), а не с придуманным', async () => {
    const body = await client.patch<{ setting: { value: number }; policyVersion: string }>(
      settingPath(SETTING_CODE),
      { value: 6, reason: 'Срок упреждения увеличен приказом' },
    )
    expect(body.setting.value).toBe(6)
    expect(body.policyVersion).not.toBe(buildSettingsSeed().data.policyVersion)
  })

  it('журнал изменений не перехватывается маршрутом одной настройки', async () => {
    // `/api/ops/setting-changes/` намеренно живёт в СВОЁМ префиксе: будь он
    // `/api/ops/settings/change-log/`, его сматчил бы `settings/:settingCode/`.
    const body = await client.get<{ results: unknown[] }>(SETTING_CHANGES_PATH)
    expect(Array.isArray(body.results)).toBe(true)
  })

  it('ошибки репозитория доезжают своими статусами, а не 500', async () => {
    expect(
      await statusOf(() =>
        client.patch(settingPath(SETTING_CODE), {
          value: 3,
          reason: 'Значение то же самое, отказ ожидаем',
        }),
      ),
    ).toBe(422)

    expect(
      await statusOf(() => client.patch(settingPath(SETTING_CODE), { value: 999, reason: 'кор' })),
    ).toBe(400)

    expect(
      await statusOf(() =>
        client.patch(settingPath('ATTENTION.NOPE.PARAMETER'), {
          value: 5,
          reason: 'Настройки с таким кодом нет',
        }),
      ),
    ).toBe(404)
  })
})
