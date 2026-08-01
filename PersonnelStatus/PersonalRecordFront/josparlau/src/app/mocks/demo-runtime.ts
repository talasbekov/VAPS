// Demo-runtime (§8.3 `mock-only-demo`): владеет persistence adapter'ом,
// сидированием сценария и мелкими runtime-настройками (persona/scenario —
// разрешённое исключение §8.6 «localStorage только для небольших runtime-
// настроек»). НЕ auth-модель — persona switch дергает СУЩЕСТВУЮЩИЙ
// AuthContext.login() снаружи (в DemoToolbar, React-слое), этот файл только
// хранит каталог/настройки и persistence.
import { createIndexedDbPersistence } from '../../shared/testing/mock-runtime/indexeddb-persistence'
import { createMemoryPersistence } from '../../shared/testing/mock-runtime/memory-persistence'
import { DemoClock } from '../../shared/testing/mock-runtime/demo-clock'
import type { PersistenceAdapter } from '../../shared/testing/mock-runtime/persistence'
import { getFrontendEnv } from '../../shared/config/env'
import { composeSeed } from './compose-seed'
import { demoEventBus } from './side-effects'
import {
  DEFAULT_DEMO_SCENARIO_ID,
  findDemoScenario,
} from './scenario-manifest'

const SETTINGS_KEY = 'smart-josparlau.demo-settings'

export interface DemoSettings {
  personaId: string
  scenarioId: string
  faultProfile: string
}

function hasIndexedDb(): boolean {
  return typeof indexedDB !== 'undefined'
}

let adapter: PersistenceAdapter | null = null

/** Один adapter на процесс: IndexedDB в браузере, in-memory иначе (SSR/тест-подобный контекст). */
export function getPersistenceAdapter(): PersistenceAdapter {
  adapter ??= hasIndexedDb() ? createIndexedDbPersistence() : createMemoryPersistence()
  return adapter
}

/** Только для тестов: сбрасывает singleton, чтобы каждый тест получил чистый adapter. */
export function resetPersistenceAdapterForTests(): void {
  adapter?.close()
  adapter = null
}

let clock: DemoClock | null = null

/**
 * Один `DemoClock` на процесс — feature-репозитории берут `updated_at`/бизнес-
 * дату мутаций отсюда, а не `new Date()` (§8.8). Стартует со времени
 * ТЕКУЩЕГО сценария; `performFullReset()` пересоздаёт его вместе со снапшотом.
 */
export function getDemoClock(): DemoClock {
  if (clock === null) {
    const scenario = findDemoScenario(readDemoSettings().scenarioId)
    clock = new DemoClock(scenario.startIso)
  }
  return clock
}

/** Только для тестов. */
export function resetDemoClockForTests(): void {
  clock = null
}

export function readDemoSettings(): DemoSettings {
  const env = getFrontendEnv()
  const fallback: DemoSettings = {
    personaId: env.demoPersona,
    scenarioId: env.demoScenario,
    faultProfile: env.demoFaultProfile,
  }
  if (typeof localStorage === 'undefined') return fallback
  const raw = localStorage.getItem(SETTINGS_KEY)
  if (raw === null) return fallback
  try {
    const parsed = JSON.parse(raw) as Partial<DemoSettings>
    return {
      personaId: parsed.personaId ?? fallback.personaId,
      scenarioId: parsed.scenarioId ?? fallback.scenarioId,
      faultProfile: parsed.faultProfile ?? fallback.faultProfile,
    }
  } catch {
    return fallback
  }
}

export function writeDemoSettings(next: DemoSettings): void {
  if (typeof localStorage === 'undefined') return
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(next))
}

/**
 * Сидирует хранилище при первом запуске. При следующих запусках:
 * 1) `schema_version` несовпадает (форма СУЩЕСТВУЮЩЕГО слайса поменялась
 *    между сессиями разработки, напр. добавили поле в `SecurityEvent`) —
 *    безопасный полный reset (§8.6 «несовместимая схема… безопасно
 *    сбрасывается»), с уведомлением в консоль. Тонкая per-field миграция demo-
 *    данных не стоит: seed полностью регенерируем.
 * 2) `schema_version` совпадает, но появился НОВЫЙ feature-слайс
 *    (`FEATURE_SEED_BUILDERS` выросла) — точечный backfill только
 *    отсутствующих слайсов, существующие НЕ трогаются.
 * Без (1) браузер с IndexedDB от предыдущего Этапа навсегда падал бы на
 * `TypeError` внутри уже загруженной, но устаревшей по форме записи (readSlice
 * кидает громко только на ПОЛНОСТЬЮ отсутствующий слайс — устаревшую форму
 * ВНУТРИ слайса он не ловит).
 */
export async function ensureSeeded(): Promise<void> {
  const store = getPersistenceAdapter()
  const existing = await store.load()
  const settings = readDemoSettings()
  const scenario = findDemoScenario(settings.scenarioId)
  if (existing === null) {
    await store.reset(composeSeed(scenario))
    return
  }
  const freshSeed = composeSeed(scenario)
  if (existing.schema_version !== freshSeed.schema_version) {
    console.warn(
      `[demo-runtime] schema_version изменилась (${existing.schema_version} → ${freshSeed.schema_version}) — demo-данные сброшены к чистому сиду сценария «${scenario.id}».`,
    )
    await store.reset(freshSeed)
    return
  }
  const missing = Object.keys(freshSeed.slices).filter(
    (name) => !(name in existing.slices),
  )
  if (missing.length === 0) return
  await store.transaction((current) => {
    const next = { ...current.slices }
    for (const name of missing) next[name] = freshSeed.slices[name]
    return next
  }, getDemoClock().now())
}

/**
 * Полный сброс demo-данных к чистому сиду текущего сценария. Вызывающий
 * (DemoToolbar) обязан взять подтверждение ДО вызова — сама функция ничего
 * не спрашивает (§8.6 «ручной reset требует подтверждения» — на UI-уровне).
 */
export async function performFullReset(scenarioId?: string): Promise<void> {
  const store = getPersistenceAdapter()
  const settings = readDemoSettings()
  const nextScenarioId = scenarioId ?? settings.scenarioId
  const scenario = findDemoScenario(nextScenarioId)
  await store.reset(composeSeed(scenario))
  writeDemoSettings({ ...settings, scenarioId: nextScenarioId })
  clock = new DemoClock(scenario.startIso)
  demoEventBus.emit({ type: 'demo-data-reset', scenario: nextScenarioId })
}

export { DEFAULT_DEMO_SCENARIO_ID }
