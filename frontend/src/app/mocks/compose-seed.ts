// Композиция единого demo-снапшота (§8.4/§8.9): app собирает slices каждой
// feature в ОДИН DemoStateEnvelope. Сейчас реестр builder'ов пуст — ни одна
// Smart Josparlau feature ещё не реализована (Этап 2 добавит первую запись).
// Композиция живёт в app, а не в shared (shared не знает о features, ARCH-FE-013),
// и не в конкретной feature (ни одна feature не владеет ЧУЖИМ слайсом).
import { DemoClock } from '../../shared/testing/mock-runtime/demo-clock'
import { StableIdGenerator, SeededRandom } from '../../shared/testing/mock-runtime/id-generator'
import type { DemoStateEnvelope } from '../../shared/testing/mock-runtime/persistence'
import type {
  FeatureSeedBuilder,
  SeedContext,
} from '../../shared/testing/mock-runtime/seed-context'
import { buildSecurityEventsSeed } from '../../features/security-events/mocks/fixtures'
import { buildObjectsSeed } from '../../features/objects/mocks/fixtures'
import { buildDutiesSeed } from '../../features/duties/mocks/fixtures'
import { buildDictionariesSeed } from '../../features/dictionaries/mocks/fixtures'
import { buildPersonnelSeed } from '../../features/personnel/mocks/fixtures'
import { buildServiceReportsSeed } from '../../features/service-reports/mocks/fixtures'
import { buildServiceAnalyticsSeed } from '../../features/service-analytics/mocks/fixtures'
import { buildFeedbackSeed } from '../../features/feedback/mocks/fixtures'
import type { DemoScenarioDefinition } from './scenario-manifest'

export type { SeedContext, FeatureSeedBuilder }

// ⚠️ ПОРЯДОК ЗНАЧИМ. Builder видит через `ctx.builtSlices` только те слайсы,
// что построены РАНЬШЕ него. `objects` идёт первым, потому что и сид ОМ, и
// сид дежурств привязываются к объекту и опубликованной версии его паспорта
// по id (§9.6); перестановка местами не сломает сид — привязка просто станет
// `null`, что и карточка ОМ, и план дежурств обязаны обрабатывать явно
// (у дежурства при этом останется демонстрационный objectId вне реестра —
// ровно тот исход, который UI и так показывает). Гвард на порядок — тест
// `compose-seed.test.ts`, а не комментарий.
//
// Идентификаторы этой перестановкой не смещаются: `StableIdGenerator` ведёт
// СВОЙ счётчик на каждый префикс, а `ctx.random` не используется ни одним
// builder'ом (последовательный PRNG был бы чувствителен к порядку).
const FEATURE_SEED_BUILDERS: readonly FeatureSeedBuilder[] = [
  buildObjectsSeed,
  buildSecurityEventsSeed,
  buildDutiesSeed,
  buildDictionariesSeed,
  // Личный состав хранит только журнал раскрытий ИИН (§20.33) — от чужих
  // слайсов не зависит, поэтому позиция в реестре значения не имеет.
  buildPersonnelSeed,
  // Отчётный реестр читает слайс `duties` при ГЕНЕРАЦИИ (на запросе), а не
  // при сидировании — от порядка не зависит.
  buildServiceReportsSeed,
  // Аналитика службы читает слайс `duties` при ЗАПРОСЕ (считает показатели), а
  // не при сидировании — от порядка не зависит.
  buildServiceAnalyticsSeed,
  // Обратная связь ни от кого не зависит: обращения ссылаются на разделы
  // портала строкой маршрута, а не на записи чужих слайсов.
  buildFeedbackSeed,
]

// Бампается при КАЖДОМ изменении формы существующего feature-слайса (не
// только при добавлении новой feature — для этого хватает additive-бэкафилла
// в ensureSeeded()). Пример: добавление `reconChecklist`/`reconSectorPosts` в
// `SecurityEvent` — 1→2; добавление `passportBinding` в `DutyShift` — 12→13;
// добавление `note`/`restOverrideReason` в `DutyShift`, `requiresCurrentPassport`
// в `DutyTypeDefinition` и нового списка `dutyCandidates` — 14→15;
// добавление состояния CANCELLED и поля `cancellation` в `DutyShift` — 15→16;
// добавление `freshnessPolicy` в слайс `objects` и двух объектов сида — 16→17;
// добавление списка `monthlyPlans` (lifecycle месячного плана §21.27) — 17→18;
// новый слайс `personnel` с журналом раскрытий ИИН (§20.33) — 18→19;
// новый слайс `serviceReports` (отчётный реестр §22.18) — 19→20;
// новый слайс `serviceAnalytics` (определения показателей и пресеты периодов
// §22.3-22.5) — 20→21; новый слайс `feedback` с обращениями и справочником
// §28 — 23→24.
// `ensureSeeded()` при несовпадении версии делает
// безопасный полный reset (§8.6 «несовместимая схема мигрируется ЛИБО
// безопасно сбрасывается» — тонкой per-field миграции демо-данных не стоит).
export const SCHEMA_VERSION = 24

export function composeSeed(scenario: DemoScenarioDefinition): DemoStateEnvelope {
  const clock = new DemoClock(scenario.startIso)
  const ids = new StableIdGenerator(scenario.id)
  const random = new SeededRandom(scenario.id)
  const slices: Record<string, unknown> = {}
  for (const build of FEATURE_SEED_BUILDERS) {
    // Свежий ctx на каждый шаг: `builtSlices` — снимок уже построенного, а не
    // живая ссылка на накапливаемый объект (иначе builder мог бы прочитать
    // собственный слайс «из будущего» через мутацию).
    const ctx: SeedContext = { clock, ids, random, scenario, builtSlices: { ...slices } }
    const { sliceName, data } = build(ctx)
    slices[sliceName] = data
  }

  const now = clock.now()
  return {
    application: 'smart-josparlau',
    schema_version: SCHEMA_VERSION,
    seed_version: `${scenario.id}-v${SCHEMA_VERSION}`,
    scenario: scenario.id,
    revision: 0,
    created_at: now,
    updated_at: now,
    slices,
  }
}
