// Story 9.7 — контейнер: prefill «вчера» → DailyGrid → отправка ТОЛЬКО дельт в
// bulk-3.8-shape через onBulkSubmit-проп. Тонкий: данные/эндпоинт = 10.2/E10.
import { useMemo } from 'react'

import type { ApiError } from '../../shared/api/errors'
import { DailyGrid } from './DailyGrid'
import type { RowChange, StatusOption } from './DailyGrid.types'
import {
  buildPrefilledRows,
  toBulkRequest,
  type BulkStatusRequest,
  type EmployeeSeed,
  type YesterdayPlacement,
} from './prefill'

export interface DailyGridContainerProps {
  employees: EmployeeSeed[]
  yesterday: YesterdayPlacement
  businessDate: string
  statusOptions: StatusOption[]
  /** «Сдать день»: получает bulk-3.8-запрос ТОЛЬКО с дельтами (E10 → apiClient). */
  onBulkSubmit: (request: BulkStatusRequest) => void
  /** 409/422-ответ per-row → маркеры (9.6-seam); реальный маппинг ответа = E10. */
  onCellCommit?: (change: RowChange) => ApiError | null
  emptyLabel?: string
}

export function DailyGridContainer({
  employees,
  yesterday,
  businessDate,
  statusOptions,
  onBulkSubmit,
  onCellCommit,
  emptyLabel,
}: DailyGridContainerProps) {
  const rows = useMemo(
    () => buildPrefilledRows(employees, yesterday),
    [employees, yesterday],
  )
  return (
    <DailyGrid
      rows={rows}
      statusOptions={statusOptions}
      onSubmit={(changes) => onBulkSubmit(toBulkRequest(changes, businessDate))}
      onCellCommit={onCellCommit}
      emptyLabel={emptyLabel}
    />
  )
}
