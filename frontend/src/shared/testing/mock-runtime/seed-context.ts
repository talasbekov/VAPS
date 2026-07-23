// Тип контекста сидирования — shared (НЕ app/mocks/compose-seed.ts): features
// не могут импортировать app (ARCH-FE-013 features→app запрещён), а
// `FeatureSeedBuilder` реализуют именно feature-owned fixtures.ts. Композиция
// (реестр builder'ов) по-прежнему живёт в app/mocks/compose-seed.ts (§8.2).
import type { DemoClock } from './demo-clock'
import type { SeededRandom, StableIdGenerator } from './id-generator'

/** Минимальная структурная форма сценария — без привязки к app-каталогу сценариев. */
export interface SeedScenario {
  id: string
  startIso: string
}

export interface SeedContext {
  clock: DemoClock
  ids: StableIdGenerator
  random: SeededRandom
  scenario: SeedScenario
}

/** Один builder = один slice; регистрируется в app/mocks/compose-seed.ts. */
export type FeatureSeedBuilder = (ctx: SeedContext) => {
  sliceName: string
  data: unknown
}
