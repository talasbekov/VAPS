// Story 9.4 — типы грид-компонента (данные приходят props; реальный источник
// + prefill = 9.7). Ноль бизнес-логики конфликтов (9.6) / отправки-дельт (9.7).

import type { ConflictError } from '../../shared/api/errors'

export interface EmployeeRow {
  id: string
  fullName: string
  rank?: string
  /** Текущий статус-код (из справочника StatusOption). */
  statusCode: string
  /** «по … включительно» — конечная дата срочного статуса (может быть пусто). */
  period?: string
}

export interface StatusOption {
  code: string
  label: string
}

/** Отклонение строки от исходного значения — то, что уходит в onSubmit. */
export interface RowChange {
  id: string
  statusCode: string
  period: string
}

export interface DailyGridProps {
  rows: EmployeeRow[]
  statusOptions: StatusOption[]
  /** «Сдать день» — вызывается с изменёнными строками (bulk-контракт 3.8 = 9.7). */
  onSubmit: (changes: RowChange[]) => void
  /** Текст пустого состояния (0 строк). */
  emptyLabel?: string
  /**
   * Seam входа в CONFLICT (Story 9.5): вызывается на коммите ячейки; вернул
   * ConflictError → грид показывает ConflictDialog и возвращает фокус в ячейку
   * после закрытия. Реальный маппинг 409/422 + маркеры строк = Story 9.6.
   */
  onCellCommit?: (change: RowChange) => ConflictError | null
}

/** Редактируемое значение строки (нормализованное состояние, ключ = row.id). */
export interface RowValue {
  statusCode: string
  period: string
}

export type ValueState = Record<string, RowValue>

export type ValueAction =
  | { type: 'SET_STATUS'; id: string; statusCode: string }
  | { type: 'SET_PERIOD'; id: string; period: string }
