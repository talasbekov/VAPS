// Feature repository (§8.5): server-like validation, permission/scope,
// атомарная мутация. §30 «не допускай удаление значения, используемого
// связанными сущностями» — отказ идёт КОНФЛИКТОМ (409,
// RepositoryConflictError), не бизнес-правилом (422): это состояние-конфликт
// между двумя сущностями, а не нарушение инварианта самой формы (канон
// §Ошибки: 400=форма, 422=бизнес-правило, 409=конфликт).
//
// Связи считаются ЗДЕСЬ, на чтении, по общему снимку (§8.4) — раньше это было
// числом из фикстуры. Два действия различаются строгостью:
//   деактивация — обратима, достаточно «связей не найдено»;
//   удаление    — необратимо, требует ДОКАЗАННОГО отсутствия связей, поэтому
//                 неотслеживаемый и неизвестный статус его запрещают.
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
import type {
  DictionaryCode,
  DictionaryEntry,
  DictionaryEntryView,
  DictionaryUsage,
} from '../model/types'
import { computeEntryUsage, describeUsage } from '../lib/usage'
import type { DictionariesSlice } from './fixtures'
import { readJournalTypeReferences } from './securityEventsSlice'

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
  /**
   * Зависимости, из-за которых действие отклонено (§30 «понятная
   * зависимость»). Едут в `details` конверта ошибки — чтобы клиент мог
   * показать источники списком, а не разбирать текст сообщения.
   */
  readonly usage: DictionaryUsage | null
  constructor(errorCode: string, message: string, usage: DictionaryUsage | null = null) {
    super(message)
    this.errorCode = errorCode
    this.usage = usage
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

/**
 * Считает связи значения по ВСЕМУ снимку: свой слайс даёт ссылки `groupCode`,
 * чужой слайс ОМ — записи журнала (узкой проекцией, без импорта фичи).
 */
function usageOf(
  entry: DictionaryEntry,
  slice: DictionariesSlice,
  slices: Readonly<Record<string, unknown>>,
): DictionaryUsage {
  return computeEntryUsage(entry, slice.entries, readJournalTypeReferences(slices))
}

function viewOf(
  entry: DictionaryEntry,
  slice: DictionariesSlice,
  slices: Readonly<Record<string, unknown>>,
): DictionaryEntryView {
  return { ...entry, usage: usageOf(entry, slice, slices) }
}

/**
 * Общий замок обоих действий. Отказ несёт ПОНЯТНУЮ ЗАВИСИМОСТЬ (§30), а не
 * только счёт: имя источника и носители связи.
 *
 * `requireProof` разделяет удаление и деактивацию — см. шапку файла.
 */
function assertMutable(usage: DictionaryUsage, refusal: string, requireProof: boolean): void {
  if (usage.status === 'TRACKED' && usage.totalCount > 0) {
    throw new RepositoryConflictError(
      'DICTIONARY_ENTRY_REFERENCED',
      `Значение используется связанными сущностями — ${refusal}. Зависимости: ${describeUsage(usage)}.`,
      usage,
    )
  }
  if (!requireProof) return
  if (usage.status === 'NOT_TRACKED') {
    throw new RepositoryConflictError(
      'DICTIONARY_USAGE_NOT_TRACKED',
      `Отсутствие связей не доказано, ${refusal}. ${usage.reason ?? ''} Значение можно деактивировать.`.trim(),
      usage,
    )
  }
  if (usage.status === 'UNKNOWN') {
    throw new RepositoryConflictError(
      'DICTIONARY_USAGE_UNKNOWN',
      `Отсутствие связей не доказано, ${refusal}. ${usage.reason ?? ''}`.trim(),
      usage,
    )
  }
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
    const slices = envelope === null ? {} : envelope.slices
    if (!slice.definitions.some((d) => d.code === dictionaryCode)) {
      throw new RepositoryNotFoundError(dictionaryCode)
    }
    const own = slice.entries.filter((e) => e.dictionaryCode === dictionaryCode)
    return {
      results: [...own]
        .sort((a, b) => a.code.localeCompare(b.code))
        .map((entry) => viewOf(entry, slice, slices)),
    }
  }

  async function createEntry(
    dictionaryCode: string,
    request: CreateDictionaryEntryRequest,
    actorUserId: string | null,
  ): Promise<DictionaryEntryView> {
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

    let created!: DictionaryEntryView
    await runMutation(adapter, clock, (current) => {
      const slice = readSlice(current)
      const entry: DictionaryEntry = {
        id: `dict-entry-${current.revision + 1}-${slice.entries.length}`,
        dictionaryCode: dictionaryCode as DictionaryCode,
        code,
        label,
        description: request.description.trim(),
        isActive: true,
        groupCode,
        updatedAt: clock.now(),
      }
      const nextSlice: DictionariesSlice = { ...slice, entries: [...slice.entries, entry] }
      // Связи считаются по УЖЕ обновлённому слайсу: новое значение может
      // ссылаться само (группа требований), и ответ обязан это отражать.
      created = viewOf(entry, nextSlice, current.slices)
      return { ...current.slices, [SLICE_NAME]: nextSlice }
    })
    return created
  }

  async function setEntryActive(
    id: string,
    isActive: boolean,
    actorUserId: string | null,
  ): Promise<DictionaryEntryView> {
    if (!hasPermission(actorUserId, MANAGE_PERMISSION)) {
      throw new RepositoryPermissionError(MANAGE_PERMISSION)
    }
    let updated!: DictionaryEntryView
    await runMutation(adapter, clock, (current) => {
      const slice = readSlice(current)
      const existing = slice.entries.find((e) => e.id === id)
      if (existing === undefined) {
        throw new RepositoryNotFoundError(id)
      }
      if (!isActive) {
        // Деактивация обратима — доказательства отсутствия связей не требует.
        assertMutable(usageOf(existing, slice, current.slices), 'деактивация запрещена', false)
      }
      const entry: DictionaryEntry = { ...existing, isActive, updatedAt: clock.now() }
      const nextSlice: DictionariesSlice = {
        ...slice,
        entries: slice.entries.map((e) => (e.id === id ? entry : e)),
      }
      updated = viewOf(entry, nextSlice, current.slices)
      return { ...current.slices, [SLICE_NAME]: nextSlice }
    })
    return updated
  }

  /**
   * §30 «не допускай удаление значения, используемого связанными
   * сущностями». Отказ несёт зависимость; неотслеживаемые и неизвестные
   * связи удаление запрещают — необратимое действие не делается на
   * недоказанном основании.
   */
  async function deleteEntry(id: string, actorUserId: string | null): Promise<void> {
    if (!hasPermission(actorUserId, MANAGE_PERMISSION)) {
      throw new RepositoryPermissionError(MANAGE_PERMISSION)
    }
    await runMutation(adapter, clock, (current) => {
      const slice = readSlice(current)
      const existing = slice.entries.find((e) => e.id === id)
      if (existing === undefined) {
        throw new RepositoryNotFoundError(id)
      }
      assertMutable(usageOf(existing, slice, current.slices), 'удаление запрещено', true)
      return {
        ...current.slices,
        [SLICE_NAME]: {
          ...slice,
          entries: slice.entries.filter((e) => e.id !== id),
        } satisfies DictionariesSlice,
      }
    })
  }

  return { listDefinitions, listEntries, createEntry, setEntryActive, deleteEntry }
}
