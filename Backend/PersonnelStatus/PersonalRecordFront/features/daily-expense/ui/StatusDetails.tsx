import type { OpsEmployeeStatusRow } from '@/lib/api'
import { formatIsoDate } from '@/shared/lib/date'

/** Operations dates are [start,end); personnel displays the last day inclusively. */
export function statusPeriod(status: Pick<OpsEmployeeStatusRow, 'date_start' | 'date_end'>): string {
  const end = new Date(`${status.date_end}T00:00:00Z`)
  if (!Number.isFinite(end.getTime())) return formatIsoDate(status.date_start)
  end.setUTCDate(end.getUTCDate() - 1)
  const last = end.toISOString().slice(0, 10)
  const start = formatIsoDate(status.date_start)
  return last <= status.date_start ? start : `${start} – ${formatIsoDate(last)}`
}

export function StatusDetails({ status, labelOf }: { status: OpsEmployeeStatusRow | null | undefined; labelOf: (code: string) => string }) {
  return <span className="inline-flex flex-wrap items-center gap-x-2 gap-y-1">
    <span>{status === undefined ? 'Статус не найден в справочнике' : status === null ? labelOf('IN_SERVICE') : labelOf(status.status_type_code)}</span>
    {status && <span className="text-xs text-muted-foreground">{statusPeriod(status)}</span>}
    {status?.destination && <span className="text-xs text-muted-foreground">{status.destination}</span>}
  </span>
}
