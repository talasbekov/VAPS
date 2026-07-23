// Шина доменных событий между feature-repositories (§8.5 «генерировать domain
// events для побочных эффектов»). Композиция — на уровне app: repository не
// знает о других features (ARCH-FE-013 запрещает feature→feature импорт), а
// событие одной feature (например «участник заменён») может требовать
// побочного эффекта в другой (например проекция статуса личного состава).
// Тип события расширяется по мере Этапа 2+ — намеренно узкий сейчас: ни одна
// feature ещё не существует.
export type DemoDomainEvent = { type: 'demo-data-reset'; scenario: string }

type Listener = (event: DemoDomainEvent) => void

export function createDemoEventBus() {
  const listeners = new Set<Listener>()
  return {
    emit(event: DemoDomainEvent): void {
      listeners.forEach((listener) => listener(event))
    },
    subscribe(listener: Listener): () => void {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
  }
}

/** Единая шина процесса — composed на уровне app, НЕ per-feature instance. */
export const demoEventBus = createDemoEventBus()
