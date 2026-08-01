// Тонкий помощник для feature repositories (§8.5, §8.8): один вызов вместо
// «достать DemoClock.now() + вызвать adapter.transaction» в каждом repository.
// Repository не обязан знать про nowIso-параметр adapter'а напрямую.
import type { DemoClock } from './demo-clock'
import type { DemoStateEnvelope, PersistenceAdapter } from './persistence'

export function runMutation(
  adapter: PersistenceAdapter,
  clock: DemoClock,
  mutator: (current: DemoStateEnvelope) => Record<string, unknown>,
): Promise<DemoStateEnvelope> {
  // Каждая мутация сдвигает сценарное время на 1мс: `updatedAt` внутри
  // мутирующей записи гарантированно меняется между последовательными
  // сохранениями — UI использует это как React `key` для сброса локального
  // состояния формы после успешного save (без setState в эффекте,
  // react-hooks/set-state-in-effect), а не только для косметики.
  clock.advanceMs(1)
  return adapter.transaction(mutator, clock.now())
}
