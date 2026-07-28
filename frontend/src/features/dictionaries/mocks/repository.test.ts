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
  {
    code: 'POST_REQUIREMENT_GROUPS',
    label: 'Группы требований постов',
    description: 'test',
  },
  {
    code: 'JOURNAL_ENTRY_TYPES',
    label: 'Типы записей журнала',
    description: 'test',
  },
]

function entry(overrides: Partial<DictionaryEntry> & Pick<DictionaryEntry, 'id'>): DictionaryEntry {
  return {
    dictionaryCode: 'RETURN_REASONS',
    code: 'CODE',
    label: 'Значение',
    description: '',
    isActive: true,
    groupCode: null,
    updatedAt: '2026-07-20T08:00:00+05:00',
    ...overrides,
  }
}

/** Справочник со свободнотекстовым потребителем — связи неотслеживаемы. */
const REASON_A = entry({ id: 'entry-1', code: 'OUTDATED_DATA' })
const REASON_B = entry({ id: 'entry-2', code: 'INSUFFICIENT_COVERAGE' })

/** Единственный справочник с настоящим потребителем по коду. */
const JOURNAL_INSTRUCTION = entry({
  id: 'journal-1',
  dictionaryCode: 'JOURNAL_ENTRY_TYPES',
  code: 'INSTRUCTION',
  label: 'Инструктаж',
})
const JOURNAL_ORDER = entry({
  id: 'journal-2',
  dictionaryCode: 'JOURNAL_ENTRY_TYPES',
  code: 'ORDER',
  label: 'Распоряжение',
})

const GROUP_ACCESS = entry({
  id: 'group-1',
  dictionaryCode: 'POST_REQUIREMENT_GROUPS',
  code: 'ACCESS',
  label: 'Допуски',
})
const GROUP_INACTIVE = entry({
  id: 'group-2',
  dictionaryCode: 'POST_REQUIREMENT_GROUPS',
  code: 'EQUIPMENT',
  label: 'Экипировка',
  isActive: false,
})
const REQUIREMENT_IN_ACCESS = entry({
  id: 'req-1',
  dictionaryCode: 'POST_REQUIREMENTS',
  code: 'ARMED',
  label: 'Вооружённый пост',
  groupCode: 'ACCESS',
})

/** Чужой слайс ОМ: записи журнала ссылаются на коды типов. */
function securityEventsSlice(journalTypes: string[]): unknown {
  return {
    events: [
      {
        id: 'event-1',
        code: 'ОМ-2026-3',
        title: 'Тестовое мероприятие',
        journalEntries: journalTypes.map((type, index) => ({ id: `j-${index}`, type })),
      },
    ],
  }
}

function seedEnvelope(
  entries: DictionaryEntry[],
  foreignSlices: Record<string, unknown> = {},
): DemoStateEnvelope {
  return {
    application: 'smart-josparlau',
    schema_version: 1,
    seed_version: 'test-v1',
    scenario: 'normal',
    revision: 0,
    created_at: '2026-07-20T08:00:00+05:00',
    updated_at: '2026-07-20T08:00:00+05:00',
    slices: { dictionaries: { definitions: DEFINITIONS, entries }, ...foreignSlices },
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

  async function setup(
    entries: DictionaryEntry[] = [REASON_A, REASON_B],
    foreignSlices: Record<string, unknown> = {},
  ) {
    const adapter = createMemoryPersistence()
    await adapter.reset(seedEnvelope(entries, foreignSlices))
    const clock = new DemoClock('2026-07-24T09:00:00+05:00')
    return { repository: createDictionariesRepository(adapter, clock), adapter, clock }
  }

  async function usageOfEntry(
    repository: ReturnType<typeof createDictionariesRepository>,
    dictionaryCode: string,
    entryId: string,
  ) {
    const result = await repository.listEntries(dictionaryCode, VIEWER)
    const found = result.results.find((e) => e.id === entryId)
    if (found === undefined) throw new Error(`значение ${entryId} не найдено`)
    return found.usage
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

    it('deleteEntry() требует ops.dictionary.manage, не только view', async () => {
      const { repository } = await setup()
      await expect(repository.deleteEntry('entry-1', VIEWER)).rejects.toThrow(
        RepositoryPermissionError,
      )
    })
  })

  describe('listDefinitions', () => {
    it('возвращает справочники с активным/общим счётчиком значений', async () => {
      const { repository } = await setup()
      const result = await repository.listDefinitions(VIEWER)
      const returnReasons = result.results.find((d) => d.code === 'RETURN_REASONS')
      expect(returnReasons).toEqual(expect.objectContaining({ totalCount: 2, activeCount: 2 }))
      const postRequirements = result.results.find((d) => d.code === 'POST_REQUIREMENTS')
      expect(postRequirements).toEqual(expect.objectContaining({ totalCount: 0, activeCount: 0 }))
    })
  })

  describe('listEntries', () => {
    it('фильтрует по dictionaryCode и сортирует по code', async () => {
      const { repository } = await setup()
      const result = await repository.listEntries('RETURN_REASONS', VIEWER)
      expect(result.results.map((e) => e.code)).toEqual(['INSUFFICIENT_COVERAGE', 'OUTDATED_DATA'])
    })

    it('неизвестный dictionaryCode кидает RepositoryNotFoundError', async () => {
      const { repository } = await setup()
      await expect(repository.listEntries('NOT_A_DICTIONARY', VIEWER)).rejects.toThrow(
        RepositoryNotFoundError,
      )
    })
  })

  // §30: связи считает СЕРВЕР по общему снимку. Раньше здесь было число из
  // фикстуры, и у типов журнала — единственного справочника с настоящим
  // потребителем — оно утверждало «связей нет».
  describe('связи значения (§30)', () => {
    it('тип записи журнала считает ссылки по ЧУЖОМУ слайсу ОМ, с носителем', async () => {
      const { repository } = await setup(
        [JOURNAL_INSTRUCTION, JOURNAL_ORDER],
        { 'security-events': securityEventsSlice(['INSTRUCTION', 'INSTRUCTION', 'ORDER']) },
      )
      const usage = await usageOfEntry(repository, 'JOURNAL_ENTRY_TYPES', 'journal-1')
      expect(usage.status).toBe('TRACKED')
      expect(usage.totalCount).toBe(2)
      expect(usage.references[0].samples).toEqual(['ОМ-2026-3'])
    })

    it('тип записи журнала без единой ссылки — TRACKED с нулём, а не «не отслеживается»', async () => {
      const { repository } = await setup([JOURNAL_INSTRUCTION], {
        'security-events': securityEventsSlice([]),
      })
      const usage = await usageOfEntry(repository, 'JOURNAL_ENTRY_TYPES', 'journal-1')
      expect(usage.status).toBe('TRACKED')
      expect(usage.totalCount).toBe(0)
    })

    it('отсутствие слайса ОМ даёт UNKNOWN, а НЕ ноль связей', async () => {
      const { repository } = await setup([JOURNAL_INSTRUCTION])
      const usage = await usageOfEntry(repository, 'JOURNAL_ENTRY_TYPES', 'journal-1')
      expect(usage.status).toBe('UNKNOWN')
      expect(usage.totalCount).toBe(0)
      expect(usage.reason).not.toBeNull()
    })

    it('причина возврата — NOT_TRACKED с названной причиной (потребитель хранит текст)', async () => {
      const { repository } = await setup()
      const usage = await usageOfEntry(repository, 'RETURN_REASONS', 'entry-1')
      expect(usage.status).toBe('NOT_TRACKED')
      expect(usage.reason).toContain('свободный комментарий')
    })

    it('группа требований считает ссылки по СВОЕМУ слайсу', async () => {
      const { repository } = await setup([GROUP_ACCESS, REQUIREMENT_IN_ACCESS])
      const usage = await usageOfEntry(repository, 'POST_REQUIREMENT_GROUPS', 'group-1')
      expect(usage.status).toBe('TRACKED')
      expect(usage.totalCount).toBe(1)
      expect(usage.references[0].samples).toEqual(['Вооружённый пост'])
    })
  })

  describe('createEntry — валидация', () => {
    it('пустой code кидает RepositoryValidationError с полем code', async () => {
      const { repository } = await setup()
      await expect(
        repository.createEntry(
          'RETURN_REASONS',
          { code: '  ', label: 'Y', description: '' },
          MANAGER,
        ),
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
        repository.createEntry(
          'NOT_A_DICTIONARY',
          { code: 'X', label: 'Y', description: '' },
          MANAGER,
        ),
      ).rejects.toThrow(RepositoryNotFoundError)
    })
  })

  describe('createEntry — groupCode (POST_REQUIREMENT_GROUPS)', () => {
    it('groupCode на несуществующую/неактивную группу кидает RepositoryValidationError по полю groupCode', async () => {
      const { repository } = await setup([REASON_A, REASON_B, GROUP_INACTIVE])
      const error = await repository
        .createEntry(
          'POST_REQUIREMENTS',
          { code: 'NEW_REQ', label: 'Новое требование', description: '', groupCode: 'EQUIPMENT' },
          MANAGER,
        )
        .catch((e: unknown) => e)
      expect(error).toBeInstanceOf(RepositoryValidationError)
      expect((error as RepositoryValidationError).fieldErrors.groupCode).toBeDefined()
    })

    it('groupCode на действующую группу сохраняется на созданной записи', async () => {
      const { repository } = await setup([REASON_A, REASON_B, GROUP_ACCESS])
      const created = await repository.createEntry(
        'POST_REQUIREMENTS',
        { code: 'NEW_REQ', label: 'Новое требование', description: '', groupCode: 'ACCESS' },
        MANAGER,
      )
      expect(created.groupCode).toBe('ACCESS')
    })

    it('groupCode в справочнике, отличном от POST_REQUIREMENTS, игнорируется (сохраняется null)', async () => {
      const { repository } = await setup([REASON_A, REASON_B, GROUP_ACCESS])
      const created = await repository.createEntry(
        'RETURN_REASONS',
        { code: 'NEW_REASON', label: 'Новая причина', description: '', groupCode: 'ACCESS' },
        MANAGER,
      )
      expect(created.groupCode).toBeNull()
    })

    it('созданное требование СРАЗУ становится связью своей группы (ответ несёт пересчитанное значение)', async () => {
      const { repository } = await setup([GROUP_ACCESS])
      const before = await usageOfEntry(repository, 'POST_REQUIREMENT_GROUPS', 'group-1')
      expect(before.totalCount).toBe(0)

      await repository.createEntry(
        'POST_REQUIREMENTS',
        { code: 'NEW_REQ', label: 'Новое требование', description: '', groupCode: 'ACCESS' },
        MANAGER,
      )

      const after = await usageOfEntry(repository, 'POST_REQUIREMENT_GROUPS', 'group-1')
      expect(after.totalCount).toBe(1)
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
      expect(created.usage.status).toBe('NOT_TRACKED')

      const persisted = await adapter.load()
      const slice = persisted?.slices.dictionaries as DictionariesSlice
      expect(slice.entries.some((e) => e.id === created.id && e.code === 'NEW_REASON')).toBe(true)
    })
  })

  describe('setEntryActive — деактивация используемого значения (§30)', () => {
    it('деактивация значения с ЖИВЫМИ связями кидает RepositoryConflictError и называет зависимость', async () => {
      const { repository } = await setup([JOURNAL_INSTRUCTION], {
        'security-events': securityEventsSlice(['INSTRUCTION']),
      })
      const error = await repository
        .setEntryActive('journal-1', false, MANAGER)
        .catch((e: unknown) => e)
      expect(error).toBeInstanceOf(RepositoryConflictError)
      expect((error as RepositoryConflictError).errorCode).toBe('DICTIONARY_ENTRY_REFERENCED')
      expect((error as RepositoryConflictError).message).toContain('Записи журнала штаба')
      expect((error as RepositoryConflictError).usage?.totalCount).toBe(1)
    })

    it('деактивация отслеживаемого значения без связей проходит и персистентна', async () => {
      const { repository, adapter } = await setup([JOURNAL_INSTRUCTION], {
        'security-events': securityEventsSlice([]),
      })
      const updated = await repository.setEntryActive('journal-1', false, MANAGER)
      expect(updated.isActive).toBe(false)

      const persisted = await adapter.load()
      const slice = persisted?.slices.dictionaries as DictionariesSlice
      expect(slice.entries.find((e) => e.id === 'journal-1')?.isActive).toBe(false)
    })

    it('деактивация НЕОТСЛЕЖИВАЕМОГО значения разрешена — действие обратимо', async () => {
      const { repository } = await setup()
      const updated = await repository.setEntryActive('entry-1', false, MANAGER)
      expect(updated.isActive).toBe(false)
    })

    it('реактивация (isActive=true) не блокируется связями', async () => {
      const { repository } = await setup([JOURNAL_INSTRUCTION], {
        'security-events': securityEventsSlice(['INSTRUCTION']),
      })
      const updated = await repository.setEntryActive('journal-1', true, MANAGER)
      expect(updated.isActive).toBe(true)
    })

    it('неизвестный id кидает RepositoryNotFoundError', async () => {
      const { repository } = await setup()
      await expect(repository.setEntryActive('does-not-exist', false, MANAGER)).rejects.toThrow(
        RepositoryNotFoundError,
      )
    })
  })

  // §30 говорит именно об УДАЛЕНИИ. Оно необратимо, поэтому требует
  // доказанного отсутствия связей — в отличие от деактивации.
  describe('deleteEntry (§30)', () => {
    it('удаление значения со связями отклоняется 409 с зависимостью в details', async () => {
      const { repository } = await setup([JOURNAL_INSTRUCTION], {
        'security-events': securityEventsSlice(['INSTRUCTION', 'INSTRUCTION']),
      })
      const error = await repository.deleteEntry('journal-1', MANAGER).catch((e: unknown) => e)
      expect(error).toBeInstanceOf(RepositoryConflictError)
      expect((error as RepositoryConflictError).errorCode).toBe('DICTIONARY_ENTRY_REFERENCED')
      expect((error as RepositoryConflictError).usage?.references[0].count).toBe(2)
    })

    it('удаление НЕОТСЛЕЖИВАЕМОГО значения запрещено — отсутствие связей не доказано', async () => {
      const { repository } = await setup()
      const error = await repository.deleteEntry('entry-1', MANAGER).catch((e: unknown) => e)
      expect(error).toBeInstanceOf(RepositoryConflictError)
      expect((error as RepositoryConflictError).errorCode).toBe('DICTIONARY_USAGE_NOT_TRACKED')
    })

    it('удаление при недоступном источнике связей запрещено (UNKNOWN)', async () => {
      const { repository } = await setup([JOURNAL_INSTRUCTION])
      const error = await repository.deleteEntry('journal-1', MANAGER).catch((e: unknown) => e)
      expect(error).toBeInstanceOf(RepositoryConflictError)
      expect((error as RepositoryConflictError).errorCode).toBe('DICTIONARY_USAGE_UNKNOWN')
    })

    it('удаление отслеживаемого значения без связей проходит и персистентно', async () => {
      const { repository, adapter } = await setup([JOURNAL_INSTRUCTION, JOURNAL_ORDER], {
        'security-events': securityEventsSlice(['ORDER']),
      })
      await repository.deleteEntry('journal-1', MANAGER)

      const persisted = await adapter.load()
      const slice = persisted?.slices.dictionaries as DictionariesSlice
      expect(slice.entries.some((e) => e.id === 'journal-1')).toBe(false)
      expect(slice.entries.some((e) => e.id === 'journal-2')).toBe(true)
    })

    it('группа с требованием не удаляется, и само требование тоже — цепочка отказов названа явно', async () => {
      // Следствие правила, а не недосмотр: требование поста неотслеживаемо
      // (паспорт хранит текст), поэтому удалить его нельзя, а значит и его
      // группа остаётся неудаляемой. Рабочий путь для обоих — деактивация.
      const { repository } = await setup([GROUP_ACCESS, REQUIREMENT_IN_ACCESS])

      const groupError = await repository.deleteEntry('group-1', MANAGER).catch((e: unknown) => e)
      expect((groupError as RepositoryConflictError).errorCode).toBe('DICTIONARY_ENTRY_REFERENCED')

      const requirementError = await repository
        .deleteEntry('req-1', MANAGER)
        .catch((e: unknown) => e)
      expect((requirementError as RepositoryConflictError).errorCode).toBe(
        'DICTIONARY_USAGE_NOT_TRACKED',
      )

      // Обе записи на месте — ни один отказ не удалил ничего частично.
      const groups = await repository.listEntries('POST_REQUIREMENT_GROUPS', VIEWER)
      const requirements = await repository.listEntries('POST_REQUIREMENTS', VIEWER)
      expect(groups.results).toHaveLength(1)
      expect(requirements.results).toHaveLength(1)

      // Деактивация — доступный путь для обеих.
      expect((await repository.setEntryActive('req-1', false, MANAGER)).isActive).toBe(false)
    })

    it('неизвестный id кидает RepositoryNotFoundError', async () => {
      const { repository } = await setup()
      await expect(repository.deleteEntry('does-not-exist', MANAGER)).rejects.toThrow(
        RepositoryNotFoundError,
      )
    })
  })
})
