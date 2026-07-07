// @vitest-environment jsdom
// jsdom обязателен: в node-окружении vitest НЕТ sessionStorage (Ловушка 8).
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  authHeaders,
  clearCredential,
  getCredential,
  getSnapshot,
  setCredential,
  subscribe,
} from './credential'

const STORAGE_KEY = 'vaps.credential'

// чистим и store, и storage — протекание между тестами (Ловушка 8)
afterEach(() => {
  clearCredential()
  sessionStorage.clear()
})

describe('credential store: set/clear ↔ sessionStorage ↔ authHeaders (AC 1, 2)', () => {
  it('dev-credential: X-User-Id — ЕДИНСТВЕННЫЙ заголовок, storage несёт JSON', () => {
    setCredential({ kind: 'dev', userId: 'operator-1' })

    expect(authHeaders).toEqual({ 'X-User-Id': 'operator-1' })
    expect(JSON.parse(sessionStorage.getItem(STORAGE_KEY)!)).toEqual({
      kind: 'dev',
      userId: 'operator-1',
    })
    expect(getCredential()).toEqual({ kind: 'dev', userId: 'operator-1' })
  })

  it('jwt-credential: Authorization Bearer — ЕДИНСТВЕННЫЙ заголовок (зеркало build_auth_classes)', () => {
    setCredential({ kind: 'jwt', token: 'abc.def.ghi' })

    expect(authHeaders).toEqual({ Authorization: 'Bearer abc.def.ghi' })
    expect(authHeaders['X-User-Id']).toBeUndefined()
  })

  it('смена dev → jwt убирает прежний заголовок (ровно один в любой момент)', () => {
    setCredential({ kind: 'dev', userId: 'operator-1' })
    setCredential({ kind: 'jwt', token: 'abc.def.ghi' })

    expect(Object.keys(authHeaders)).toEqual(['Authorization'])
  })

  it('clearCredential: заголовки пусты, storage очищен, значение null', () => {
    setCredential({ kind: 'dev', userId: 'operator-1' })
    clearCredential()

    expect(authHeaders).toEqual({})
    expect(sessionStorage.getItem(STORAGE_KEY)).toBeNull()
    expect(getCredential()).toBeNull()
  })

  it('getSnapshot возвращает СТАБИЛЬНУЮ ссылку между вызовами (контракт useSyncExternalStore)', () => {
    setCredential({ kind: 'dev', userId: 'operator-1' })

    expect(getSnapshot()).toBe(getSnapshot())
  })
})

describe('subscribe-уведомления', () => {
  it('set и clear уведомляют подписчика; отписка прекращает уведомления', () => {
    const listener = vi.fn()
    const unsubscribe = subscribe(listener)

    setCredential({ kind: 'dev', userId: 'operator-1' })
    expect(listener).toHaveBeenCalledTimes(1)

    clearCredential()
    expect(listener).toHaveBeenCalledTimes(2)

    // повторный clear при null — идемпотентен, без лишнего уведомления
    clearCredential()
    expect(listener).toHaveBeenCalledTimes(2)

    unsubscribe()
    setCredential({ kind: 'dev', userId: 'operator-2' })
    expect(listener).toHaveBeenCalledTimes(2)
  })
})

describe('гидратация из sessionStorage на init (переживает F5, AC 1)', () => {
  it('валидный JSON в storage → credential и заголовки готовы сразу после импорта', async () => {
    sessionStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ kind: 'dev', userId: 'operator-f5' }),
    )
    vi.resetModules()
    const fresh = await import('./credential')

    expect(fresh.getCredential()).toEqual({
      kind: 'dev',
      userId: 'operator-f5',
    })
    expect(fresh.authHeaders).toEqual({ 'X-User-Id': 'operator-f5' })
  })

  it('битый/чужой JSON в storage → null без падения', async () => {
    sessionStorage.setItem(STORAGE_KEY, '{oops')
    vi.resetModules()
    const broken = await import('./credential')
    expect(broken.getCredential()).toBeNull()

    sessionStorage.setItem(STORAGE_KEY, JSON.stringify({ kind: 'alien' }))
    vi.resetModules()
    const alien = await import('./credential')
    expect(alien.getCredential()).toBeNull()
    expect(alien.authHeaders).toEqual({})
  })
})
