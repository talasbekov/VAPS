// Детерминированные ID и случайность для mock-runtime (§8.8). Один и тот же
// seed + scenario обязаны давать один и тот же результат: reset двух вкладок
// с одним seed должен воспроизводить одинаковые ID и связи. Запрещено:
// crypto.randomUUID()/Math.random() внутри seed builders и бизнес-правил.

/** Mulberry32 — маленький детерминированный PRNG, без внешней зависимости. */
export class SeededRandom {
  private state: number

  constructor(seed: string | number) {
    this.state = SeededRandom.hashSeed(seed)
  }

  private static hashSeed(seed: string | number): number {
    const str = String(seed)
    let h = 1779033703 ^ str.length
    for (let i = 0; i < str.length; i++) {
      h = Math.imul(h ^ str.charCodeAt(i), 3432918353)
      h = (h << 13) | (h >>> 19)
    }
    return h >>> 0
  }

  /** Следующее число с плавающей точкой в [0, 1). */
  next(): number {
    this.state |= 0
    this.state = (this.state + 0x6d2b79f5) | 0
    let t = Math.imul(this.state ^ (this.state >>> 15), 1 | this.state)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }

  /** Целое число в [0, maxExclusive). */
  int(maxExclusive: number): number {
    return Math.floor(this.next() * maxExclusive)
  }

  /** Случайный элемент непустого массива (детерминированно по seed). */
  pick<T>(items: readonly T[]): T {
    if (items.length === 0) {
      throw new Error('SeededRandom.pick: пустой массив')
    }
    return items[this.int(items.length)]
  }
}

/**
 * Стабильные ID: `<prefix>-<seed>-<counter>`. Не переиспользуются после
 * удаления/reset внутри ОДНОЙ seed-версии (счётчик монотонен на инстанс);
 * reset создаёт новый generator → тот же порядок вызовов даёт те же ID.
 */
export class StableIdGenerator {
  private counters = new Map<string, number>()
  private readonly seed: string

  constructor(seed: string) {
    this.seed = seed
  }

  next(prefix: string): string {
    const current = this.counters.get(prefix) ?? 0
    this.counters.set(prefix, current + 1)
    return `${prefix}-${this.seed}-${current + 1}`
  }
}
