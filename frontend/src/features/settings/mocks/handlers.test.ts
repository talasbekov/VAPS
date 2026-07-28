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
    schema_version: 28,
    seed_version: 'test-v28',
    scenario: 'normal',
    revision: 0,
    created_at: CLOCK_ISO,
    updated_at: CLOCK_ISO,
    slices: { [sliceName]: data },
  })
  registerRbacDirectory([
    {
      userId: ADMIN,
      permissions: [
        'ops.settings.view',
        'ops.settings.manage',
        'ops.settings.manage_conflict_rules',
      ],
    },
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
    const body = await client.patch<{
      setting: { value: number }
      sectionVersions: Record<string, string>
    }>(
      settingPath(SETTING_CODE),
      { value: 6, reason: 'Срок упреждения увеличен приказом' },
    )
    expect(body.setting.value).toBe(6)
    expect(body.sectionVersions.ATTENTION_POLICY).not.toBe(buildSettingsSeed().data.sectionVersions.ATTENTION_POLICY)
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

describe('handler правил конфликтов (§29/§21.35)', () => {
  it('PATCH режима доезжает до репозитория — код правила тоже параметр пути', async () => {
    // Код правила содержит точки (`CONFLICT.REST_AFTER_DUTY.MODE`), и путь к
    // нему строит та же фабрика с `encodeURIComponent`. Приём Этапа 49: КАЖДЫЙ
    // новый путь с параметром получает handler-тест — юнит-тесты репозитория
    // зовут функции напрямую и несовпадения маршрута не увидели бы.
    const response = await client.patch<{
      setting: { value: string }
      sectionVersions: Record<string, string>
    }>(
      settingPath('CONFLICT.REST_AFTER_DUTY.MODE'),
      { value: 'HARD_BLOCK', reason: 'Ужесточение режима на период учений' },
    )
    expect(response.setting.value).toBe('HARD_BLOCK')
    expect(response.sectionVersions.CONFLICT_RULES).not.toBe('conflict-rules-2026.07.1')
  })

  it('запертое правило отвечает 422 по своему коду, а не 403', async () => {
    const status = await statusOf(() =>
      client.patch(settingPath('CONFLICT.DUTY_OVERLAP.MODE'), {
        value: 'HARD_BLOCK',
        reason: 'Попытка ослабить запрет пересечения',
      }),
    )
    expect(status).toBe(422)
  })
})
