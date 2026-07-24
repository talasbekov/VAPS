// Pending-контракты «Справочники» (§7.5): backend Smart Josparlau не
// существует — статус `backend-contract-pending`.
import type { DictionaryDefinition, DictionaryEntry } from '../model/types'

export const DICTIONARIES_PATH = '/api/ops/dictionaries/'

export function dictionaryEntriesPath(code: string): string {
  return `${DICTIONARIES_PATH}${code}/entries/`
}

export function dictionaryEntrySetActivePath(id: string): string {
  return `${DICTIONARIES_PATH}entries/${id}/set-active/`
}

export interface DictionaryDefinitionSummary extends DictionaryDefinition {
  totalCount: number
  activeCount: number
}

export interface ListDictionaryDefinitionsResponse {
  results: DictionaryDefinitionSummary[]
}

export interface ListDictionaryEntriesResponse {
  results: DictionaryEntry[]
}

export interface CreateDictionaryEntryRequest extends Record<string, unknown> {
  code: string
  label: string
  description: string
}

export type CreateDictionaryEntryResponse = DictionaryEntry

export interface SetDictionaryEntryActiveRequest extends Record<string, unknown> {
  isActive: boolean
}

export type SetDictionaryEntryActiveResponse = DictionaryEntry
