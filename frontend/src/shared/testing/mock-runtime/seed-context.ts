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
  /**
   * Слайсы, УЖЕ построенные ранее в этом же проходе композиции (§8.4).
   * Нужен ровно для одного класса связей: demo-сид должен уметь сослаться на
   * запись чужого агрегата по ЕЁ id — например, ОМ на объект и опубликованную
   * версию его паспорта (§9.6). Склейка по имени/коду вместо id — та самая
   * ложная склейка, которую запретили в FRONTEND_DECISIONS A44-A46.
   *
   * Тип `unknown` намеренно: shared не знает типов features (ARCH-FE-013).
   * Читающий builder обязан объявить СВОЮ узкую проекцию чужой формы и
   * пережить её отсутствие: порядок реестра — единственная гарантия, что
   * слайс уже построен, и отсутствие обязано означать «связь не установлена»,
   * а не падение сида.
   */
  builtSlices: Readonly<Record<string, unknown>>
}

/** Один builder = один slice; регистрируется в app/mocks/compose-seed.ts. */
export type FeatureSeedBuilder = (ctx: SeedContext) => {
  sliceName: string
  data: unknown
}
