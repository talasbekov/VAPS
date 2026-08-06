// Story 20.1d: панель готовности ОМ (FR-38) — изолированный компонент, НЕ
// встроенный в mock-first security-events-страницы (см. Scope Decision в
// 20-1d-готовность-ом-панель.md). Структурный образец —
// status-calendar/pages/StatusCalendarPanel.tsx (19.4d).
import { useSecurityEventReadiness } from '../api/readiness'
import type { SecurityEventReadinessResponse } from '../api/readiness'
import { ApiError } from '../../../shared/api/errors'

type ChecklistKey = Exclude<keyof SecurityEventReadinessResponse, 'readiness_pct'>

const CHECKLIST_ROWS: Array<{
  key: ChecklistKey
  label: string
}> = [
  { key: 'checklist_ready', label: 'Чек-лист' },
  { key: 'demand_ready', label: 'Наряд' },
  { key: 'placement_ready', label: 'Расстановка' },
  { key: 'acknowledgement_ready', label: 'Ознакомление' },
  { key: 'conflicts_ready', label: 'Конфликты' },
]

export function ReadinessPanel({ eventId }: { eventId: string }) {
  const query = useSecurityEventReadiness(eventId)

  return (
    <section className="rounded-xl border bg-card p-4">
      <div className="mb-3 text-sm font-semibold">Готовность ОМ</div>

      {query.isLoading && (
        <p className="text-sm text-muted-foreground">Загрузка готовности…</p>
      )}

      {query.isError && (
        <p className="text-sm text-destructive">
          Не удалось загрузить готовность
          {query.error instanceof ApiError ? `: ${query.error.message}` : ''}.
        </p>
      )}

      {query.isSuccess && (
        <div className="flex flex-col gap-3">
          <div className="text-3xl font-bold tabular-nums">
            {query.data.readiness_pct}%
          </div>
          <div className="flex flex-col gap-1 text-sm">
            {CHECKLIST_ROWS.map(({ key, label }) => (
              <div key={key} className="flex items-center justify-between">
                <span>{label}</span>
                <span aria-label={query.data[key] ? 'готово' : 'не готово'}>
                  {query.data[key] ? '✓' : '—'}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </section>
  )
}
