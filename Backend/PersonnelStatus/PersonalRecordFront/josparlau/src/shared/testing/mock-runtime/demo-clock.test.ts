import { describe, expect, it } from 'vitest'
import { DemoClock } from './demo-clock'

describe('DemoClock', () => {
  it('now() возвращает исходное время без изменений', () => {
    const clock = new DemoClock('2026-07-20T09:00:00+05:00')
    expect(clock.now()).toBe('2026-07-20T09:00:00+05:00')
  })

  it('advanceMs() сохраняет смещение таймзоны, а не нормализует в UTC Z', () => {
    const clock = new DemoClock('2026-07-20T09:00:00+05:00')
    clock.advanceMs(1)
    expect(clock.now()).toBe('2026-07-20T09:00:00.001+05:00')
  })

  it('advanceMs() через полночь не съезжает businessDate на UTC-день', () => {
    // 23:59:59.999 +05:00 → 19:59:59.999 UTC (тот же календарный день в UTC,
    // но проверка на будущее: сценарий может стартовать ближе к UTC-границе)
    const clock = new DemoClock('2026-07-20T23:59:59.999+05:00')
    clock.advanceMs(1)
    expect(clock.now()).toBe('2026-07-21T00:00:00+05:00')
    expect(clock.businessDate()).toBe('2026-07-21')
  })

  it('set() принимает новое смещение вместе с временем', () => {
    const clock = new DemoClock('2026-07-20T09:00:00+05:00')
    clock.set('2026-07-20T09:00:00+00:00')
    expect(clock.now()).toBe('2026-07-20T09:00:00+00:00')
  })

  it('businessDate() — первые 10 символов now() в локальном смещении', () => {
    const clock = new DemoClock('2026-07-20T22:30:00+05:00')
    expect(clock.businessDate()).toBe('2026-07-20')
  })
})
