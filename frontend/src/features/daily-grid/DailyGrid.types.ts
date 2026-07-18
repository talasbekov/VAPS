// Story 9.4 — типы грид-компонента (данные приходят props; реальный источник
// + prefill = 9.7). Ноль бизнес-логики конфликтов (9.6) / отправки-дельт (9.7).

import type { ApiError } from '../../shared/api/errors'

/** Маркер конфликта/валидации строки (Story 9.6). */
export type RowMarker = 'soft' | 'hard' | 'invalid'

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
   * Канал ГРЯЗНОГО СОСТОЯНИЯ для beforeunload экрана (стори 10.2): отдаёт
   * ЧИСЛО дельт, значений не отдаёт. Считает отклонения (мемо `changed`), а не
   * нажатия — навигация стрелками dirty НЕ поднимает. Колбэк должен быть
   * стабилен (useCallback у парента), иначе эффект зациклится.
   */
  onDirtyChange?: (changedCount: number) => void
  /**
   * Seam коммита ячейки (Story 9.5/9.6): вернул ApiError → грид маппит на
   * маркер строки и ветвит soft (ConflictError.overridable → жёлтый +
   * ConflictDialog + оверрайд) / hard (BusinessRuleError 422 / non-overridable
   * → красная заливка, коммит блокируется, без диалога). null → нет конфликта.
   */
  onCellCommit?: (change: RowChange) => ApiError | null
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
  /**
   * Ресинк при смене rows-пропа (refetch/фильтр — источник 9.7/10.2):
   * нетронутые оператором строки берут новый initial, правки сохраняются,
   * исчезнувшие id отбрасываются. Сравнение «тронуто ли» — против initials
   * ПРЕДЫДУЩЕГО состава rows.
   */
  | { type: 'RESYNC'; initials: ValueState; prevInitials: ValueState }
