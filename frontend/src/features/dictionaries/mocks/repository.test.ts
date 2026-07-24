import { beforeEach, describe, expect, it } from 'vitest'
import { createMemoryPersistence } from '../../../shared/testing/mock-runtime/memory-persistence'
import { DemoClock } from '../../../shared/testing/mock-runtime/demo-clock'
import { registerRbacDirectory } from '../../../shared/testing/mock-runtime/rbac-directory'
import type { DemoStateEnvelope } from '../../../shared/testing/mock-runtime/persistence'
import {
  createDictionariesRepository,
  RepositoryConflictError,
  RepositoryNotFoundError,
  RepositoryPermissionError,
  RepositoryValidationError,
} from './repository'
import type { DictionariesSlice } from './fixtures'
import type { DictionaryEntry } from '../model/types'

const VIEWER = 'viewer-user'
const MANAGER = 'manager-user'
const NOBODY = 'no-permissions-user'

const DEFINITIONS: DictionariesSlice['definitions'] = [
  {
    code: 'RETURN_REASONS',
    label: 'Причины возврата на доработку',
    description: 'test',
  },
  {
    code: 'POST_REQUIREMENTS',
    label: 'Требования постов',
    description: 'test',
  },
]

const ENTRY_UNUSED: DictionaryEntry = {
  id: 'entry-1',
  dictionaryCode: 'RETURN_REASONS',
  code: 'OUTDATED_DATA',
  label: 'Устаревшие исходные данные',
  description: '',
  isActive: true,
  referencedCount: 0,
  updatedAt: '2026-07-20T08:00:00+05:00',
}

const ENTRY_REFERENCED: DictionaryEntry = {
  id: 'entry-2',
  dictionaryCode: 'RETURN_REASONS',
  code: 'INSUFFICIENT_COVERAGE',
  label: 'Недостаточная укомплектованность постов',
  description: '',
  isActive: true,
  referencedCount: 3,
  updatedAt: '2026-07-20T08:00:00+05:00',
}

function seedEnvelope(entries: DictionaryEntry[]): DemoStateEnvelope {
  return {
    application: 'smart-josparlau',
    schema_version: 1,
    seed_version: 'test-v1',
    scenario: 'normal',
    revision: 0,
    created_at: '2026-07-20T08:00:00+05:00',
    updated_at: '2026-07-20T08:00:00+05:00',
    slices: { dictionaries: { definitions: DEFINITIONS, entries } },
  }
}

describe('createDictionariesRepository', () => {
  beforeEach(() => {
    registerRbacDirectory([
      { userId: VIEWER, permissions: ['ops.dictionary.view'] },
      { userId: MANAGER, permissions: ['ops.dictionary.view', 'ops.dictionary.manage'] },
      { userId: NOBODY, permissions: [] },
    ])
  })

  async function setup(entries: DictionaryEntry[] = [ENTRY_UNUSED, ENTRY_REFERENCED]) {
    const adapter = createMemoryPersistence()
    await adapter.reset(seedEnvelope(entries))
    const clock = new DemoClock('2026-07-24T09:00:00+05:00')
    return { repository: createDictionariesRepository(adapter, clock), adapter, clock }
  }

  describe('permission', () => {
    it('listDefinitions() без прав кидает RepositoryPermissionError', async () => {
      const { repository } = await setup()
      await expect(repository.listDefinitions(NOBODY)).rejects.toThrow(RepositoryPermissionError)
    })

    it('listDefinitions() без credential (null) тоже отказывает', async () => {
      const { repository } = await setup()
      await expect(repository.listDefinitions(null)).rejects.toThrow(RepositoryPermissionError)
    })

    it('listEntries() без прав кидает RepositoryPermissionError', async () => {
      const { repository } = await setup()
      await expect(repository.listEntries('RETURN_REASONS', NOBODY)).rejects.toThrow(
        RepositoryPermissionError,
      )
    })

    it('createEntry() требует ops.dictionary.manage, не только view', async () => {
      const { repository } = await setup()
      await expect(
        repository.createEntry('RETURN_REASONS', { code: 'X', label: 'Y', description: '' }, VIEWER),
      ).rejects.toThrow(RepositoryPermissionError)
    })

    it('setEntryActive() требует ops.dictionary.manage, не только view', async () => {
      const { repository } = await setup()
      await expect(repository.setEntryActive('entry-1', false, VIEWER)).rejects.toThrow(
        RepositoryPermissionError,
      )
    })
  })

  describe('listDefinitions', () => {
    it('возвращает справочники с активным/общим счётчиком значений', async () => {
      const { repository } = await setup()
      const result = await repository.listDefinitions(VIEWER)
      const returnReasons = result.results.find((d) => d.code === 'RETURN_REASONS')
      expect(returnReasons).toEqual(
        expect.objectContaining({ totalCount: 2, activeCount: 2 }),
      )
      const postRequirements = result.results.find((d) => d.code === 'POST_REQUIREMENTS')
      expect(postRequirements).toEqual(
        expect.objectContaining({ totalCount: 0, activeCount: 0 }),
      )
    })
  })

  describe('listEntries', () => {
    it('фильтрует по dictionaryCode и сортирует по code', async () => {
      const { repository } = await setup()
      const result = await repository.listEntries('RETURN_REASONS', VIEWER)
      expect(result.results.map((e) => e.code)).toEqual([
        'INSUFFICIENT_COVERAGE',
        'OUTDATED_DATA',
      ])
    })

    it('неизвестный dictionaryCode кидает RepositoryNotFoundError', async () => {
      const { repository } = await setup()
      await expect(repository.listEntries('NOT_A_DICTIONARY', VIEWER)).rejects.toThrow(
        RepositoryNotFoundError,
      )
    })
  })

  describe('createEntry — валидация', () => {
    it('пустой code кидает RepositoryValidationError с полем code', async () => {
      const { repository } = await setup()
      await expect(
        repository.createEntry('RETURN_REASONS', { code: '  ', label: 'Y', description: '' }, MANAGER),
      ).rejects.toThrow(RepositoryValidationError)
    })

    it('пустой label кидает RepositoryValidationError с полем label', async () => {
      const { repository } = await setup()
      const error = await repository
        .createEntry('RETURN_REASONS', { code: 'NEW_CODE', label: ' ', description: '' }, MANAGER)
        .catch((e: unknown) => e)
      expect(error).toBeInstanceOf(RepositoryValidationError)
      expect((error as RepositoryValidationError).fieldErrors.label).toBeDefined()
    })

    it('дублирующий code (без учёта регистра) внутри справочника кидает RepositoryValidationError', async () => {
      const { repository } = await setup()
      await expect(
        repository.createEntry(
          'RETURN_REASONS',
          { code: 'outdated_data', label: 'Дубликат', description: '' },
          MANAGER,
        ),
      ).rejects.toThrow(RepositoryValidationError)
    })

    it('неизвестный dictionaryCode кидает RepositoryNotFoundError', async () => {
      const { repository } = await setup()
      await expect(
        repository.createEntry('NOT_A_DICTIONARY', { code: 'X', label: 'Y', description: '' }, MANAGER),
      ).rejects.toThrow(RepositoryNotFoundError)
    })
  })

  describe('createEntry — персистентность', () => {
    it('успешное создание сохраняется и читается заново из адаптера', async () => {
      const { repository, adapter } = await setup()
      const created = await repository.createEntry(
        'RETURN_REASONS',
        { code: 'NEW_REASON', label: 'Новая причина', description: 'описание' },
        MANAGER,
      )
      expect(created.isActive).toBe(true)
      expect(created.referencedCount).toBe(0)

      const persisted = await adapter.load()
      const slice = persisted?.slices.dictionaries as DictionariesSlice
      expect(slice.entries.some((e) => e.id === created.id && e.code === 'NEW_REASON')).toBe(true)
    })
  })

  describe('setEntryActive — деактивация используемого значения (§30)', () => {
    it('деактивация значения с referencedCount>0 кидает RepositoryConflictError', async () => {
      const { repository } = await setup()
      await expect(repository.setEntryActive('entry-2', false, MANAGER)).rejects.toThrow(
        RepositoryConflictError,
      )
    })

    it('деактивация неиспользуемого значения (referencedCount=0) проходит и персистентна', async () => {
      const { repository, adapter } = await setup()
      const updated = await repository.setEntryActive('entry-1', false, MANAGER)
      expect(updated.isActive).toBe(false)

      const persisted = await adapter.load()
      const slice = persisted?.slices.dictionaries as DictionariesSlice
      const entry = slice.entries.find((e) => e.id === 'entry-1')
      expect(entry?.isActive).toBe(false)
    })

    it('реактивация (isActive=true) не блокируется referencedCount', async () => {
      const { repository } = await setup()
      const updated = await repository.setEntryActive('entry-2', true, MANAGER)
      expect(updated.isActive).toBe(true)
    })

    it('неизвестный id кидает RepositoryNotFoundError', async () => {
      const { repository } = await setup()
      await expect(repository.setEntryActive('does-not-exist', false, MANAGER)).rejects.toThrow(
        RepositoryNotFoundError,
      )
    })
  })
})
