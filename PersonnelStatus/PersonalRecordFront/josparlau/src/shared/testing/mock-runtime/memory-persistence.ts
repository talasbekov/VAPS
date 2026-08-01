// In-memory реализация PersistenceAdapter (§8.6): unit/integration тесты и
// фолбэк, если IndexedDB недоступна. Каждый вызов `createMemoryPersistence()`
// даёт ИЗОЛИРОВАННЫЙ instance — тесты не делят состояние (§8.2).
import type {
  DemoStateEnvelope,
  PersistenceAdapter,
  PersistenceMetadata,
} from './persistence'
import { PersistenceSchemaError } from './persistence'

export function createMemoryPersistence(): PersistenceAdapter {
  let snapshot: DemoStateEnvelope | null = null
  // Сериализация мутаций (§8.6 «mutations сериализуются»): каждая следующая
  // операция ждёт завершения предыдущей — конкурентные вызовы не мешают друг другу.
  let queue: Promise<unknown> = Promise.resolve()

  function enqueue<T>(fn: () => T): Promise<T> {
    const result = queue.then(fn)
    queue = result.catch(() => undefined)
    return result
  }

  return {
    async load() {
      return snapshot
    },

    transaction(mutator, nowIso) {
      return enqueue(() => {
        if (snapshot === null) {
          throw new Error(
            'transaction() вызван до seed: сначала replace()/reset()',
          )
        }
        // mutator может бросить — snapshot не переопределяем до успеха
        const nextSlices = mutator(snapshot)
        snapshot = {
          ...snapshot,
          slices: nextSlices,
          revision: snapshot.revision + 1,
          updated_at: nowIso,
        }
        return snapshot
      })
    },

    replace(next) {
      return enqueue(() => {
        snapshot = next
        return snapshot
      })
    },

    reset(seed) {
      return enqueue(() => {
        snapshot = seed
        return snapshot
      })
    },

    migrate(envelope, migrations, targetVersion) {
      let current = envelope
      while (current.schema_version < targetVersion) {
        const step = migrations[current.schema_version]
        if (step === undefined) {
          throw new PersistenceSchemaError(
            `Нет пути миграции с schema_version=${current.schema_version} к ${targetVersion}`,
            current,
          )
        }
        current = step(current)
      }
      return current
    },

    async getMetadata(): Promise<PersistenceMetadata | null> {
      if (snapshot === null) return null
      const { schema_version, seed_version, scenario, revision } = snapshot
      return { schema_version, seed_version, scenario, revision }
    },

    close() {
      // in-memory: нечего закрывать
    },
  }
}
