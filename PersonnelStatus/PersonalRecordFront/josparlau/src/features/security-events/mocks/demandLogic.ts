// Чистая доменная логика «Потребность → Выделение сил» (Smart Josparlau.dc.html
// :611-612 «запросы будут сформированы автоматически»). Используется и
// fixtures.ts (сид), и repository.ts (approveDemand) — один источник правила
// агрегации, не два независимых расчёта.
import type { ForceRequest, StaffingDemandRow } from '../model/types'

/** Группирует строки потребности по `group`, суммируя `need` — один ForceRequest на группу. */
export function aggregateForceRequests(
  rows: readonly StaffingDemandRow[],
  idFactory: (group: string, index: number) => string,
): ForceRequest[] {
  const totals = new Map<string, number>()
  for (const row of rows) {
    if (row.group.trim() === '') continue
    totals.set(row.group, (totals.get(row.group) ?? 0) + row.need)
  }
  return [...totals.entries()].map(([group, requestedCount], index) => ({
    id: idFactory(group, index),
    group,
    requestedCount,
    allocatedCount: 0,
    status: 'NOT_SENT',
    comment: '',
  }))
}
