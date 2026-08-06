// Key factory владения feature'ы (§7.10) — НЕ глобальный файл в shared.
import type { ListSecurityEventsParams } from './pending-contracts'

export const securityEventKeys = {
  all: ['security-events'] as const,
  lists: () => [...securityEventKeys.all, 'list'] as const,
  list: (params: ListSecurityEventsParams) =>
    [...securityEventKeys.lists(), params] as const,
  details: () => [...securityEventKeys.all, 'detail'] as const,
  detail: (id: string) => [...securityEventKeys.details(), id] as const,
  // Story 20.1c: реальный бэкенд-эндпоинт (20.1b), не pending-contract.
  // Review (Blind Hunter + Edge Case Hunter, независимо совпали): НЕ
  // вложен под `.details()` — `queries.ts`'s mock-first мутации
  // инвалидируют по `.details()`/`.detail(id)` (prefix-match в TanStack
  // Query), что случайно рефетчило бы этот РЕАЛЬНЫЙ бэкенд-запрос при
  // завершении НИКАК не связанной mock-мутации. Отдельный корневой
  // ключ развязывает два источника истины полностью.
  readiness: (id: string) => [...securityEventKeys.all, 'readiness', id] as const,
}
