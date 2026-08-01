// Единые часы demo-состояния (§8.8): repositories и handlers читают ВРЕМЯ
// ТОЛЬКО отсюда — не `new Date()`/`Date.now()` напрямую — иначе одинаковый
// seed даёт разные timestamps при каждом запуске и тесты плывут.
//
// Смещение таймзоны сохраняется руками (не `Date.toISOString()`, которая
// нормализует в UTC 'Z'): businessDate()/slice(0,10) обязаны отражать
// локальный календарный день канона (+05:00), а не UTC-день — иначе дата у
// событий рядом с полуночью съезжала бы на сутки после advanceMs().
const OFFSET_RE = /([+-]\d{2}:\d{2})$/

function extractOffset(iso: string): string {
  const match = OFFSET_RE.exec(iso)
  return match ? match[1] : '+00:00'
}

function formatWithOffset(epochMs: number, offset: string): string {
  const sign = offset.startsWith('-') ? -1 : 1
  const [oh, om] = offset.slice(1).split(':').map(Number)
  const shifted = new Date(epochMs + sign * (oh * 60 + om) * 60_000)
  // `.000` отброшен, если миллисекунды нулевые — иначе КАЖДЫЙ now() отличался
  // бы от исходной seed-строки (обычно без миллисекунд), даже без единого
  // advanceMs(). Ненулевые миллисекунды (после advanceMs) остаются видимыми.
  const iso = shifted
    .toISOString()
    .replace('Z', '')
    .replace(/\.000$/, '')
  return `${iso}${offset}`
}

export class DemoClock {
  private epochMs: number
  private offset: string

  constructor(initialIso: string) {
    this.epochMs = Date.parse(initialIso)
    this.offset = extractOffset(initialIso)
  }

  /** Текущее время сценария (ISO-8601, таймзона канона — §9). */
  now(): string {
    return formatWithOffset(this.epochMs, this.offset)
  }

  /** Business date (YYYY-MM-DD) — первые 10 символов ISO-времени сценария. */
  businessDate(): string {
    return this.now().slice(0, 10)
  }

  /** Тестам и demo-сценариям: сдвинуть время сценария вручную (не wall-clock; сохраняет смещение из `nextIso`). */
  set(nextIso: string): void {
    this.epochMs = Date.parse(nextIso)
    this.offset = extractOffset(nextIso)
  }

  /** Сдвинуть на N миллисекунд вперёд относительно текущего времени сценария. */
  advanceMs(ms: number): void {
    this.epochMs += ms
  }
}

/** Дефолтное время сценария `normal` — фиксировано, НЕ `new Date()`. */
export const DEFAULT_SCENARIO_START_ISO = '2026-07-20T08:00:00+05:00'
