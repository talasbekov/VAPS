// Story 16.7 — chistye helper functions for the placement print form
// (`/print/placement`). No hand-mirrored types needed (unlike
// expensePrint.ts) — GET assignment-versions/{id}/ (16.8a) is a real,
// typed schema endpoint, consumed directly via `paths[...]` in
// PlacementPrintPage.tsx.
//
// Pure functions only: no React, no apiClient (node-env testable).
import type { ApiFailure } from '../../shared/api/errors'

export const PRINT_MISSING_PARAMS_MESSAGE =
  'Не хватает параметра печати: нужен номер версии (version_id).'

export const PRINT_NOT_FOUND_MESSAGE = 'Версия Расстановки не найдена.'

export const PRINT_EMPTY_MESSAGE = 'Назначений в этой версии нет.'

export const PRINT_LOADING_TEXT = 'Загрузка версии Расстановки…'

export const PRINT_SCREEN_HINT_TEXT =
  'Экранная подсказка: этот блок на бумагу не выводится. Печать — Ctrl+P.'

export type PrintFailureKind = 'silent' | 'not-found' | 'other'

export interface PrintFailureDescription {
  kind: PrintFailureKind
  /** Текст для страницы; для `silent` — пустой (страница ничего не рисует). */
  message: string
}

/**
 * Тотальная карта отказов печати — образец `expensePrint.ts::
 * describePrintFailure` (10.7), без permission/no-data-веток: у Placement
 * нет per-object scope (`assignment.create` гейтит роут целиком,
 * `RequirePermission`), значит достижимый 403 здесь не несёт отдельного
 * "вне зоны ответственности"-смысла — падает в общий `other`.
 *
 * 401 — `silent`: `providers.tsx`'s `handle401` уже чистит credential,
 * `RequireAuth` уводит на `/login`; текст успел бы только мигнуть.
 * 5xx/network/403/иное — ТЕКСТ, не тишина: страница читает через
 * `useQuery`, тоста нет, `silent` означал бы пустой лист без объяснения.
 */
export function describePrintFailure(error: ApiFailure): PrintFailureDescription {
  if (error.kind === 'network') {
    return {
      kind: 'other',
      message: `Не удалось загрузить версию Расстановки: ${error.message}`,
    }
  }
  if (error.status === 401) return { kind: 'silent', message: '' }
  if (error.status === 404) {
    return { kind: 'not-found', message: PRINT_NOT_FOUND_MESSAGE }
  }
  return {
    kind: 'other',
    message: `Не удалось загрузить версию Расстановки: ${error.message}`,
  }
}

/** ISO datetime -> `ДД.ММ.ГГГГ ЧЧ:ММ`; невалидный вход возвращается как есть. */
export function formatPrintDateTime(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return iso
  return date.toLocaleString('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}
