// Pending-контракты «Справочники» (§7.5): backend Smart Josparlau не
// существует — статус `backend-contract-pending`.
import type { DictionaryDefinition, DictionaryEntryView } from '../model/types'

export const DICTIONARIES_PATH = '/api/ops/dictionaries/'

export function dictionaryEntriesPath(code: string): string {
  return `${DICTIONARIES_PATH}${code}/entries/`
}

export function dictionaryEntrySetActivePath(id: string): string {
  return `${DICTIONARIES_PATH}entries/${id}/set-active/`
}

/**
 * Удаление значения — СВОЙ путь, а не `set-active` с флагом: §30 говорит
 * именно об удалении, и правило у него строже деактивации (удаление
 * необратимо, поэтому требует ДОКАЗАННОГО отсутствия связей).
 */
export function dictionaryEntryPath(id: string): string {
  return `${DICTIONARIES_PATH}entries/${id}/`
}

export interface DictionaryDefinitionSummary extends DictionaryDefinition {
  totalCount: number
  activeCount: number
}

export interface ListDictionaryDefinitionsResponse {
  results: DictionaryDefinitionSummary[]
}

export interface ListDictionaryEntriesResponse {
  results: DictionaryEntryView[]
}

export interface CreateDictionaryEntryRequest extends Record<string, unknown> {
  code: string
  label: string
  description: string
  /** Только для `POST_REQUIREMENTS` — код записи `POST_REQUIREMENT_GROUPS`. */
  groupCode?: string | null
}

export type CreateDictionaryEntryResponse = DictionaryEntryView

export interface SetDictionaryEntryActiveRequest extends Record<string, unknown> {
  isActive: boolean
}

export type SetDictionaryEntryActiveResponse = DictionaryEntryView
