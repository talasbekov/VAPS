import { describe, expect, it } from 'vitest'
import { SeededRandom, StableIdGenerator } from './id-generator'

describe('SeededRandom', () => {
  it('одинаковый seed даёт одинаковую последовательность', () => {
    const a = new SeededRandom('normal')
    const b = new SeededRandom('normal')
    const seqA = Array.from({ length: 5 }, () => a.next())
    const seqB = Array.from({ length: 5 }, () => b.next())
    expect(seqA).toEqual(seqB)
  })

  it('разный seed даёт разную последовательность', () => {
    const a = new SeededRandom('normal')
    const b = new SeededRandom('other')
    expect(a.next()).not.toBe(b.next())
  })

  it('int() остаётся в границах [0, max)', () => {
    const r = new SeededRandom('bounds')
    for (let i = 0; i < 50; i++) {
      const v = r.int(7)
      expect(v).toBeGreaterThanOrEqual(0)
      expect(v).toBeLessThan(7)
    }
  })

  it('pick() кидает на пустом массиве, а не возвращает undefined', () => {
    const r = new SeededRandom('empty')
    expect(() => r.pick([])).toThrow()
  })
})

describe('StableIdGenerator', () => {
  it('монотонно нумерует ID одного префикса', () => {
    const gen = new StableIdGenerator('normal')
    expect(gen.next('event')).toBe('event-normal-1')
    expect(gen.next('event')).toBe('event-normal-2')
  })

  it('разные префиксы не делят счётчик', () => {
    const gen = new StableIdGenerator('normal')
    expect(gen.next('event')).toBe('event-normal-1')
    expect(gen.next('post')).toBe('post-normal-1')
    expect(gen.next('event')).toBe('event-normal-2')
  })

  it('два независимых generator с одним seed дают одинаковую последовательность', () => {
    const genA = new StableIdGenerator('normal')
    const genB = new StableIdGenerator('normal')
    expect(genA.next('event')).toBe(genB.next('event'))
  })
})
