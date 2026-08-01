// Каталог demo-сценариев (§8.9 «Runtime-only данные»: DemoScenario не продуктовый
// API). Один сценарий = фиксированное стартовое время DemoClock + seed для
// каждой feature-owned slice (заполняется по мере Этапа 2+; сейчас features
// ещё нет — slices пуст, и это ожидаемо для Этапа 1).
import { DEFAULT_SCENARIO_START_ISO } from '../../shared/testing/mock-runtime/demo-clock'

export interface DemoScenarioDefinition {
  id: string
  label: string
  description: string
  startIso: string
}

export const DEMO_SCENARIOS: readonly DemoScenarioDefinition[] = [
  {
    id: 'normal',
    label: 'Обычный день',
    description: 'Штатный набор данных без искусственных сбоев',
    startIso: DEFAULT_SCENARIO_START_ISO,
  },
] as const

export function findDemoScenario(id: string): DemoScenarioDefinition {
  return DEMO_SCENARIOS.find((s) => s.id === id) ?? DEMO_SCENARIOS[0]
}

export const DEFAULT_DEMO_SCENARIO_ID = DEMO_SCENARIOS[0].id
