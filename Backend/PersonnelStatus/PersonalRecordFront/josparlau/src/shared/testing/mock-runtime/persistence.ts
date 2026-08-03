// Persistence-контракт demo-состояния (§8.6). Один интерфейс — две реализации:
// memory-persistence.ts (тесты, unit/integration), indexeddb-persistence.ts
// (браузер). Домен (features/*) НИКОГДА не читает/пишет storage напрямую —
// только через feature repository → этот adapter.

/** Текущий demo-сценарий (расширяется по мере Этапа 2+; см. scenario-manifest). */
export type DemoScenario = string

/**
 * Единый конверт снапшота (§8.6). `schema_version` — форма ЭТОГО объекта,
 * `seed_version` — версия исходного demo-набора данных: разный смысл,
 * разный жизненный цикл (миграция схемы ≠ пересборка seed).
 */
export interface DemoStateEnvelope {
  application: 'smart-josparlau'
  schema_version: number
  seed_version: string
  scenario: DemoScenario
  revision: number
  created_at: string
  updated_at: string
  /** Ключ — имя feature-слайса (например `security-events`), значение — его нормализованное состояние. */
  slices: Record<string, unknown>
}

export interface PersistenceMetadata {
  schema_version: number
  seed_version: string
  scenario: DemoScenario
  revision: number
}

/** Ошибка несовместимой/повреждённой схемы — вызывающий решает: мигрировать или сбросить. */
export class PersistenceSchemaError extends Error {
  readonly found: unknown

  constructor(message: string, found: unknown) {
    super(message)
    this.name = 'PersistenceSchemaError'
    this.found = found
  }
}

export interface PersistenceAdapter {
  /** Текущий снапшот либо `null`, если хранилище пусто (первый запуск). */
  load(): Promise<DemoStateEnvelope | null>
  /**
   * Атомарная мутация: `mutator` получает ТЕКУЩИЙ снапшот и возвращает новые
   * `slices`; adapter сам увеличивает `revision`/`updated_at` и коммитит.
   * Если `mutator` бросает исключение — снапшот НЕ изменяется (никакого
   * частично применённого состояния).
   */
  transaction(
    mutator: (current: DemoStateEnvelope) => Record<string, unknown>,
    /** `updated_at` метка коммита — приходит от вызывающего (DemoClock), НЕ `new Date()`: §8.8. */
    nowIso: string,
  ): Promise<DemoStateEnvelope>
  /** Полная замена снапшота (используется reset/seed) — тоже атомарна. */
  replace(next: DemoStateEnvelope): Promise<DemoStateEnvelope>
  /** Сбрасывает хранилище к переданному начальному снапшоту. Требует явного вызова — не молчаливый побочный эффект. */
  reset(seed: DemoStateEnvelope): Promise<DemoStateEnvelope>
  /**
   * Приводит снапшот старой `schema_version` к текущей через `migrations`
   * (ключ — целевая версия). Несовместимая схема без пути миграции кидает
   * `PersistenceSchemaError` — вызывающий (demo-runtime) решает: показать
   * уведомление и сбросить, либо остановить запуск.
   */
  migrate(
    envelope: DemoStateEnvelope,
    migrations: Record<number, (e: DemoStateEnvelope) => DemoStateEnvelope>,
    targetVersion: number,
  ): DemoStateEnvelope
  getMetadata(): Promise<PersistenceMetadata | null>
  close(): void
}
