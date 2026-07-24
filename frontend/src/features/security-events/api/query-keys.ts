// Key factory владения feature'ы (§7.10) — НЕ глобальный файл в shared.
import type { ListSecurityEventsParams } from './pending-contracts'

export const securityEventKeys = {
  all: ['security-events'] as const,
  lists: () => [...securityEventKeys.all, 'list'] as const,
  list: (params: ListSecurityEventsParams) =>
    [...securityEventKeys.lists(), params] as const,
  details: () => [...securityEventKeys.all, 'detail'] as const,
  detail: (id: string) => [...securityEventKeys.details(), id] as const,
}
