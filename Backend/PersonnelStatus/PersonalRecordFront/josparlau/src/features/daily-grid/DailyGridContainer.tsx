// Story 9.7 — контейнер: prefill «вчера» → DailyGrid → отправка ТОЛЬКО дельт в
// bulk-3.8-shape через onBulkSubmit-проп. Тонкий: данные/эндпоинт = 10.2/E10.
import { useCallback, useMemo } from 'react'

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
  /** Ссылки должны быть стабильны между рендерами (useMemo/стейт у парента):
   * новый литерал на каждый рендер → RESYNC грида и пробитый memo всех строк
   * (перф-инвариант 9.4); мутация in place — наоборот, ресинка не будет. */
  employees: EmployeeSeed[]
  yesterday: YesterdayPlacement
  businessDate: string
  statusOptions: StatusOption[]
  /** «Сдать день»: получает bulk-3.8-запрос ТОЛЬКО с дельтами (E10 → apiClient).
   * При нуле дельт НЕ вызывается (бэк-3.8 отвечает 400 на пустой payload). */
  onBulkSubmit: (request: BulkStatusRequest) => void | Promise<void>
  /** 409/422-ответ per-row → маркеры (9.6-seam); реальный маппинг ответа = E10. */
  onCellCommit?: (change: RowChange) => ApiError | null
  emptyLabel?: string
  /** Число дельт → экрану (10.2): beforeunload и подтверждение смены даты. */
  onDirtyChange?: (changedCount: number) => void
  /** Транзитный проброс надписи кнопки отправки дельт (10.3): контейнер
   * значение не читает — решение о надписи принимает экран. */
  submitLabel?: string
}

export function DailyGridContainer({
  employees,
  yesterday,
  businessDate,
  statusOptions,
  onBulkSubmit,
  onCellCommit,
  emptyLabel,
  onDirtyChange,
  submitLabel,
}: DailyGridContainerProps) {
  const rows = useMemo(
    () => buildPrefilledRows(employees, yesterday),
    [employees, yesterday],
  )
  const handleSubmit = useCallback(
    (changes: RowChange[]) => {
      // Ноль отклонений — штатный день: bulk-вызова нет (сервис 3.8 отверг бы
      // пустой payload 400); сдача дня без дельт = submission-флоу E10/3.9.
      if (changes.length === 0) return
      return onBulkSubmit(toBulkRequest(changes, businessDate))
    },
    [onBulkSubmit, businessDate],
  )
  return (
    <DailyGrid
      // Правки принадлежат дню: смена businessDate ремоунтит грид — иначе
      // дельты, введённые для старого дня, молча уехали бы с новой датой.
      key={businessDate}
      rows={rows}
      statusOptions={statusOptions}
      onSubmit={handleSubmit}
      onCellCommit={onCellCommit}
      emptyLabel={emptyLabel}
      onDirtyChange={onDirtyChange}
      submitLabel={submitLabel}
    />
  )
}
