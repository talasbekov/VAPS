// Credential store 8.6 (Д2/Д8): значение живёт В ПАМЯТИ модуля (стабильная
// ссылка — контракт getSnapshot для useSyncExternalStore, Ловушка 7),
// sessionStorage — только персистенция (гидратация на init + запись в
// set/clear; переживает F5, гаснет с вкладкой). Зеркало build_auth_classes
// бэка (ARCH-SEC-030): JWT приоритетен, X-User-Id — только dev/пилот-fallback;
// наружу уходит РОВНО ОДИН заголовок.
export type Credential =
  | { kind: 'dev'; userId: string }
  | { kind: 'jwt'; token: string }

const STORAGE_KEY = 'vaps.credential'

/**
 * Мутируемый объект заголовков: client.ts передаёт его в defaultHeaders,
 * спред `{ ...defaultHeaders }` читает содержимое В МОМЕНТ запроса (Д6-8.4) —
 * транспорт не правится, set/clear синхронно обновляют объект.
 */
export const authHeaders: Record<string, string> = {}

const listeners = new Set<() => void>()

// node-импорт (vitest environment node) обязан переживать отсутствие storage
function storageAvailable(): boolean {
  return typeof sessionStorage !== 'undefined'
}

function readStorage(): Credential | null {
  if (!storageAvailable()) return null
  const raw = sessionStorage.getItem(STORAGE_KEY)
  if (raw === null) return null
  try {
    const parsed: unknown = JSON.parse(raw)
    if (typeof parsed !== 'object' || parsed === null) return null
    const c = parsed as Record<string, unknown>
    if (c.kind === 'dev' && typeof c.userId === 'string' && c.userId !== '') {
      return { kind: 'dev', userId: c.userId }
    }
    if (c.kind === 'jwt' && typeof c.token === 'string' && c.token !== '') {
      return { kind: 'jwt', token: c.token }
    }
    return null // чужой/битый JSON — не credential
  } catch {
    return null
  }
}

function syncHeaders(credential: Credential | null): void {
  delete authHeaders['X-User-Id']
  delete authHeaders['Authorization']
  if (credential === null) return
  if (credential.kind === 'jwt') {
    authHeaders['Authorization'] = `Bearer ${credential.token}`
  } else {
    authHeaders['X-User-Id'] = credential.userId
  }
}

// Гидратация на init: значение и заголовки готовы до первого запроса
let current: Credential | null = readStorage()
syncHeaders(current)

/** Стабильная ссылка на текущий credential (контракт useSyncExternalStore). */
export function getSnapshot(): Credential | null {
  return current
}

export function getCredential(): Credential | null {
  return current
}

export function setCredential(credential: Credential): void {
  current = credential
  if (storageAvailable()) {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(credential))
  }
  syncHeaders(credential)
  listeners.forEach((listener) => listener())
}

export function clearCredential(): void {
  if (current === null) return // идемпотентность: без лишних уведомлений
  current = null
  if (storageAvailable()) {
    sessionStorage.removeItem(STORAGE_KEY)
  }
  syncHeaders(null)
  listeners.forEach((listener) => listener())
}

export function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}
