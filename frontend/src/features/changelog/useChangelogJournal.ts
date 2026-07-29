// Story 13.4b — журнал «сообщено → исправлено»: реальный запрос вместо
// changelog.ts's CLOSED_FIXES-дефолта. Паттерн зеркалит
// shared/notifications/useNotificationsFeed.ts (useQuery, isError-состояние
// потребителю, не useToast — GET-запрос, не мутация, тот же прецедент, что
// NotificationBell.tsx's ERROR_TEXT-рендер).
import { useQuery } from '@tanstack/react-query'
import { apiClient } from '../../shared/api/client'
import type { components } from '../../shared/api/schema'
import type { FixEntry } from './changelog'

type JournalPage = components['schemas']['PaginatedBugReportJournalEntryList']

export const CHANGELOG_JOURNAL_QUERY_KEY = ['bugreports-journal'] as const

export interface UseChangelogJournalResult {
  fixes: readonly FixEntry[]
  isPending: boolean
  isError: boolean
}

/**
 * Распаковывает `.results` ДО отдачи потребителю (13.4a-ревью: бэк отдаёт
 * limit/offset-конверт `{count,next,previous,results}`, а `FixEntry[]`/
 * `CLOSED_FIXES` — голый массив, без конверта — расхождение обязано
 * закрыться здесь, не выше).
 *
 * `BugReportJournalEntry` (сгенерированный тип) структурно совпадает с
 * `FixEntry` поле-в-поле (13.4a's сериализатор спроектирован именно под
 * этот контракт) — ручного маппинга не требуется.
 */
export function useChangelogJournal(): UseChangelogJournalResult {
  const query = useQuery({
    queryKey: CHANGELOG_JOURNAL_QUERY_KEY,
    queryFn: () => apiClient.get<JournalPage>('/api/bugreports/journal/'),
  })

  return {
    fixes: query.data?.results ?? [],
    isPending: query.isPending,
    isError: query.isError,
  }
}
