// Браузерный PersistenceAdapter (§8.6): один object store, один ключ
// (SNAPSHOT_KEY) — вся demo-БД лежит одной атомарной записью. IndexedDB
// транзакция (readwrite) уже гарантирует атомарность коммита; поверх неё
// держим ту же сериализацию мутаций, что и memory-persistence, чтобы
// параллельные repository-вызовы из разных features не гонялись за один tick.
//
// Multi-tab (§8.6): после commit шлём revision через BroadcastChannel — другая
// вкладка приглашается инвалидировать защищённые queries (слушатель — на
// стороне demo-runtime, не здесь: этот файл не знает о TanStack Query).
import type {
  DemoStateEnvelope,
  PersistenceAdapter,
  PersistenceMetadata,
} from './persistence'
import { PersistenceSchemaError } from './persistence'

const DB_NAME = 'smart-josparlau-demo'
const DB_VERSION = 1
const STORE_NAME = 'snapshot'
const SNAPSHOT_KEY = 'current'
export const BROADCAST_CHANNEL_NAME = 'smart-josparlau-demo-revision'

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION)
    request.onupgradeneeded = () => {
      const db = request.result
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME)
      }
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error('IndexedDB open failed'))
  })
}

function idbGet(db: IDBDatabase): Promise<DemoStateEnvelope | null> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly')
    const req = tx.objectStore(STORE_NAME).get(SNAPSHOT_KEY)
    req.onsuccess = () => resolve((req.result as DemoStateEnvelope | undefined) ?? null)
    req.onerror = () => reject(req.error ?? new Error('IndexedDB get failed'))
  })
}

function idbPut(db: IDBDatabase, value: DemoStateEnvelope): Promise<void> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite')
    tx.objectStore(STORE_NAME).put(value, SNAPSHOT_KEY)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error ?? new Error('IndexedDB put failed'))
    tx.onabort = () => reject(tx.error ?? new Error('IndexedDB transaction aborted'))
  })
}

export function createIndexedDbPersistence(): PersistenceAdapter {
  let dbPromise: Promise<IDBDatabase> | null = null
  let queue: Promise<unknown> = Promise.resolve()
  const channel =
    typeof BroadcastChannel !== 'undefined'
      ? new BroadcastChannel(BROADCAST_CHANNEL_NAME)
      : null

  function db(): Promise<IDBDatabase> {
    dbPromise ??= openDb()
    return dbPromise
  }

  function enqueue<T>(fn: () => Promise<T>): Promise<T> {
    const result = queue.then(fn)
    queue = result.catch(() => undefined)
    return result
  }

  function broadcast(envelope: DemoStateEnvelope): void {
    channel?.postMessage({ revision: envelope.revision })
  }

  async function commit(envelope: DemoStateEnvelope): Promise<DemoStateEnvelope> {
    const handle = await db()
    await idbPut(handle, envelope)
    broadcast(envelope)
    return envelope
  }

  return {
    async load() {
      const handle = await db()
      return idbGet(handle)
    },

    transaction(mutator, nowIso) {
      return enqueue(async () => {
        const handle = await db()
        const current = await idbGet(handle)
        if (current === null) {
          throw new Error(
            'transaction() вызван до seed: сначала replace()/reset()',
          )
        }
        // Не затираем более новую ревизию молча: пере-читали current из
        // хранилища прямо перед мутацией (не из внешнего кэша вызывающего).
        const nextSlices = mutator(current)
        const next: DemoStateEnvelope = {
          ...current,
          slices: nextSlices,
          revision: current.revision + 1,
          updated_at: nowIso,
        }
        return commit(next)
      })
    },

    replace(next) {
      return enqueue(() => commit(next))
    },

    reset(seed) {
      return enqueue(() => commit(seed))
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
      const handle = await db()
      const snapshot = await idbGet(handle)
      if (snapshot === null) return null
      const { schema_version, seed_version, scenario, revision } = snapshot
      return { schema_version, seed_version, scenario, revision }
    },

    close() {
      channel?.close()
      dbPromise
        ?.then((handle) => handle.close())
        .catch(() => undefined)
    },
  }
}
