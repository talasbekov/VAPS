// Story 9.7 — контейнер: prefill «вчера» → DailyGrid → отправка ТОЛЬКО дельт в
// bulk-3.8-shape через onBulkSubmit-проп. Тонкий: данные/эндпоинт — 10.2
// (DailyExpensePage); здесь только прокидка ref/pending (минимум 10.2).
import { useCallback, useMemo } from 'react'
import type { Ref } from 'react'

import type { ApiError } from '../../shared/api/errors'
import { DailyGrid } from './DailyGrid'
import type {
  DailyGridHandle,
  RowChange,
  StatusOption,
} from './DailyGrid.types'
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
  /** «Сдать день»: получает bulk-3.8-запрос ТОЛЬКО с дельтами + исходные
   * RowChange (10.2: rebase initials после успеха — страница мержит именно
   * введённые значения, не обратную конверсию date_end∓1, которая теряла бы
   * period === businessDate). При нуле дельт НЕ вызывается (бэк-3.8 отвечает
   * 400 на пустой payload). */
  onBulkSubmit: (
    request: BulkStatusRequest,
    changes: RowChange[],
  ) => void | Promise<void>
  /** 409/422-ответ per-row → маркеры (9.6-seam); реальный маппинг ответа = E10. */
  onCellCommit?: (change: RowChange) => ApiError | null
  /** Императивный канал грида (10.2): applyMarkers/isDirty — сквозная прокидка. */
  gridRef?: Ref<DailyGridHandle>
  /** Полёт bulk-запроса (10.2 AC-5) — сквозная прокидка в кнопку грида. */
  submitPending?: boolean
  /** Лейбл bulk-кнопки (10.3) — сквозная прокидка; default в самом гриде. */
  submitLabel?: string
  emptyLabel?: string
}

export function DailyGridContainer({
  employees,
  yesterday,
  businessDate,
  statusOptions,
  onBulkSubmit,
  onCellCommit,
  gridRef,
  submitPending,
  submitLabel,
  emptyLabel,
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
      return onBulkSubmit(toBulkRequest(changes, businessDate), changes)
    },
    [onBulkSubmit, businessDate],
  )
  return (
    <DailyGrid
      // Правки принадлежат дню: смена businessDate ремоунтит грид — иначе
      // дельты, введённые для старого дня, молча уехали бы с новой датой.
      key={businessDate}
      ref={gridRef}
      rows={rows}
      statusOptions={statusOptions}
      onSubmit={handleSubmit}
      submitPending={submitPending}
      submitLabel={submitLabel}
      onCellCommit={onCellCommit}
      emptyLabel={emptyLabel}
    />
  )
}
