// Feature repository (§8.5): server-like validation, permission/scope,
// атомарная мутация. §30 «не допускай удаление значения, используемого
// связанными сущностями» — деактивация с referencedCount>0 отклоняется
// КОНФЛИКТОМ (409, RepositoryConflictError), не бизнес-правилом (422): это
// состояние-конфликт между двумя сущностями, а не нарушение инварианта самой
// формы (канон §Ошибки: 400=форма, 422=бизнес-правило, 409=конфликт).
import type { DemoClock } from '../../../shared/testing/mock-runtime/demo-clock'
import { hasPermission } from '../../../shared/testing/mock-runtime/rbac-directory'
import type {
  DemoStateEnvelope,
  PersistenceAdapter,
} from '../../../shared/testing/mock-runtime/persistence'
import { runMutation } from '../../../shared/testing/mock-runtime/transaction'
import type {
  CreateDictionaryEntryRequest,
  DictionaryDefinitionSummary,
  ListDictionaryDefinitionsResponse,
  ListDictionaryEntriesResponse,
} from '../api/pending-contracts'
import type { DictionaryCode, DictionaryEntry } from '../model/types'
import type { DictionariesSlice } from './fixtures'

export class RepositoryPermissionError extends Error {}
export class RepositoryNotFoundError extends Error {}
export class RepositoryValidationError extends Error {
  readonly fieldErrors: Record<string, string[]>
  constructor(fieldErrors: Record<string, string[]>) {
    super('validation')
    this.fieldErrors = fieldErrors
  }
}
export class RepositoryConflictError extends Error {
  readonly errorCode: string
  constructor(errorCode: string, message: string) {
    super(message)
    this.errorCode = errorCode
  }
}

const SLICE_NAME = 'dictionaries'
const VIEW_PERMISSION = 'ops.dictionary.view'
const MANAGE_PERMISSION = 'ops.dictionary.manage'

function readSlice(envelope: DemoStateEnvelope): DictionariesSlice {
  const slice = envelope.slices[SLICE_NAME]
  if (slice === undefined) {
    throw new Error(
      `mock-runtime: слайс "${SLICE_NAME}" не засеян — проверь app/mocks/compose-seed.ts`,
    )
  }
  return slice as DictionariesSlice
}

function summarize(slice: DictionariesSlice): DictionaryDefinitionSummary[] {
  return slice.definitions.map((def) => {
    const ownEntries = slice.entries.filter((e) => e.dictionaryCode === def.code)
    return {
      ...def,
      totalCount: ownEntries.length,
      activeCount: ownEntries.filter((e) => e.isActive).length,
    }
  })
}

export function createDictionariesRepository(adapter: PersistenceAdapter, clock: DemoClock) {
  async function listDefinitions(
    actorUserId: string | null,
  ): Promise<ListDictionaryDefinitionsResponse> {
    if (!hasPermission(actorUserId, VIEW_PERMISSION)) {
      throw new RepositoryPermissionError(VIEW_PERMISSION)
    }
    const envelope = await adapter.load()
    const slice = envelope === null ? { definitions: [], entries: [] } : readSlice(envelope)
    return { results: summarize(slice) }
  }

  async function listEntries(
    dictionaryCode: string,
    actorUserId: string | null,
  ): Promise<ListDictionaryEntriesResponse> {
    if (!hasPermission(actorUserId, VIEW_PERMISSION)) {
      throw new RepositoryPermissionError(VIEW_PERMISSION)
    }
    const envelope = await adapter.load()
    const slice = envelope === null ? { definitions: [], entries: [] } : readSlice(envelope)
    if (!slice.definitions.some((d) => d.code === dictionaryCode)) {
      throw new RepositoryNotFoundError(dictionaryCode)
    }
    const own = slice.entries.filter((e) => e.dictionaryCode === dictionaryCode)
    return { results: [...own].sort((a, b) => a.code.localeCompare(b.code)) }
  }

  async function createEntry(
    dictionaryCode: string,
    request: CreateDictionaryEntryRequest,
    actorUserId: string | null,
  ): Promise<DictionaryEntry> {
    if (!hasPermission(actorUserId, MANAGE_PERMISSION)) {
      throw new RepositoryPermissionError(MANAGE_PERMISSION)
    }
    const envelope = await adapter.load()
    const currentSlice = envelope === null ? { definitions: [], entries: [] } : readSlice(envelope)
    if (!currentSlice.definitions.some((d) => d.code === dictionaryCode)) {
      throw new RepositoryNotFoundError(dictionaryCode)
    }

    const code = request.code.trim()
    const label = request.label.trim()
    const groupCode =
      dictionaryCode === 'POST_REQUIREMENTS' && request.groupCode != null && request.groupCode !== ''
        ? request.groupCode
        : null
    const fieldErrors: Record<string, string[]> = {}
    if (code === '') {
      fieldErrors.code = ['Укажите код значения.']
    } else if (
      currentSlice.entries.some(
        (e) => e.dictionaryCode === dictionaryCode && e.code.toLowerCase() === code.toLowerCase(),
      )
    ) {
      fieldErrors.code = ['Значение с таким кодом уже существует в этом справочнике.']
    }
    if (label === '') {
      fieldErrors.label = ['Укажите наименование значения.']
    }
    if (
      groupCode !== null &&
      !currentSlice.entries.some(
        (e) => e.dictionaryCode === 'POST_REQUIREMENT_GROUPS' && e.code === groupCode && e.isActive,
      )
    ) {
      fieldErrors.groupCode = ['Выберите действующую группу требований.']
    }
    if (Object.keys(fieldErrors).length > 0) {
      throw new RepositoryValidationError(fieldErrors)
    }

    let created!: DictionaryEntry
    await runMutation(adapter, clock, (current) => {
      const slice = readSlice(current)
      created = {
        id: `dict-entry-${current.revision + 1}-${slice.entries.length}`,
        dictionaryCode: dictionaryCode as DictionaryCode,
        code,
        label,
        description: request.description.trim(),
        isActive: true,
        referencedCount: 0,
        groupCode,
        updatedAt: clock.now(),
      }
      return {
        ...current.slices,
        [SLICE_NAME]: {
          ...slice,
          entries: [...slice.entries, created],
        } satisfies DictionariesSlice,
      }
    })
    return created
  }

  async function setEntryActive(
    id: string,
    isActive: boolean,
    actorUserId: string | null,
  ): Promise<DictionaryEntry> {
    if (!hasPermission(actorUserId, MANAGE_PERMISSION)) {
      throw new RepositoryPermissionError(MANAGE_PERMISSION)
    }
    let updated!: DictionaryEntry
    await runMutation(adapter, clock, (current) => {
      const slice = readSlice(current)
      const existing = slice.entries.find((e) => e.id === id)
      if (existing === undefined) {
        throw new RepositoryNotFoundError(id)
      }
      if (!isActive && existing.referencedCount > 0) {
        throw new RepositoryConflictError(
          'DICTIONARY_ENTRY_REFERENCED',
          `Значение используется в ${existing.referencedCount} связанных записях — деактивация запрещена.`,
        )
      }
      updated = { ...existing, isActive, updatedAt: clock.now() }
      return {
        ...current.slices,
        [SLICE_NAME]: {
          ...slice,
          entries: slice.entries.map((e) => (e.id === id ? updated : e)),
        } satisfies DictionariesSlice,
      }
    })
    return updated
  }

  return { listDefinitions, listEntries, createEntry, setEntryActive }
}
