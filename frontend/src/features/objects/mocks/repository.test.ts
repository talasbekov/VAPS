// Первое unit-покрытие objects-repository (до этого фича проверялась только
// route-audit'ом и e2e). Фокус — публикация версии паспорта: §8.5
// `publishPassportVersion` + инварианты §8.10 (неизменяемость версии, не более
// одной версии на дату).
import { beforeEach, describe, expect, it } from 'vitest'
import { createMemoryPersistence } from '../../../shared/testing/mock-runtime/memory-persistence'
import { DemoClock } from '../../../shared/testing/mock-runtime/demo-clock'
import { registerRbacDirectory } from '../../../shared/testing/mock-runtime/rbac-directory'
import type {
  DemoStateEnvelope,
  PersistenceAdapter,
} from '../../../shared/testing/mock-runtime/persistence'
import {
  createObjectsRepository,
  RepositoryNotFoundError,
  RepositoryPermissionError,
  RepositoryValidationError,
} from './repository'
import type { ObjectsSlice } from './fixtures'
import type { SecurityObject } from '../model/types'

const MANAGER = 'objects-admin-user'
const VIEWER = 'objects-viewer-user'
const OBJECT_ID = 'object-1'

function makeObject(overrides: Partial<SecurityObject> = {}): SecurityObject {
  return {
    id: OBJECT_ID,
    name: 'Дворец Независимости',
    code: 'OBJ-001',
    type: 'Государственное учреждение',
    region: 'г. Астана',
    address: 'пр. Мангилик Ел, 55',
    objectState: 'ACTIVE',
    passportState: 'GREEN',
    sectors: [
      {
        id: 'sector-1',
        name: 'Сектор A',
        posts: [
          { id: 'post-1', name: 'КПП-1', task: 'Контроль въезда', requirements: 'Допуск' },
        ],
      },
    ],
    passportVersions: [],
    createdAt: '2026-07-20T08:00:00+05:00',
    updatedAt: '2026-07-20T08:00:00+05:00',
    ...overrides,
  }
}

let adapter: PersistenceAdapter
let clock: DemoClock
let repository: ReturnType<typeof createObjectsRepository>

function envelope(object: SecurityObject): DemoStateEnvelope {
  return {
    application: 'smart-josparlau',
    schema_version: 1,
    seed_version: 'test-v1',
    scenario: 'normal',
    revision: 0,
    created_at: '2026-07-20T08:00:00+05:00',
    updated_at: '2026-07-20T08:00:00+05:00',
    slices: {
      objects: { objects: [object] } satisfies ObjectsSlice,
      // §21.7: политика свежести живёт в ЧУЖОМ слайсе настроек (§29) и
      // читается узкой проекцией — реестр объектов ею не владеет.
      settings: freshnessSettingsSlice(120, 20),
    },
  }
}

/** Узкая копия слайса «Настройки» в объёме, который читает реестр объектов. */
function freshnessSettingsSlice(intervalDays: number, dueSoonPercent: number) {
  return {
    sectionVersions: { PASSPORT_FRESHNESS: 'passport-freshness-test.1' },
    settings: [
      {
        settingCode: 'PASSPORT.FRESHNESS.PARAMETER',
        sectionCode: 'PASSPORT_FRESHNESS',
        value: intervalDays,
      },
      {
        settingCode: 'PASSPORT.FRESHNESS.WARNING_FROM',
        sectionCode: 'PASSPORT_FRESHNESS',
        value: dueSoonPercent,
      },
    ],
    changeLog: [],
  }
}

async function seed(object: SecurityObject): Promise<void> {
  await adapter.reset(envelope(object))
}

/**
 * Пересевает снапшот с ДРУГОЙ политикой свежести — значения намеренно не
 * совпадают ни с сидом, ни с fallback-ом проекции: иначе «политика приходит из
 * настроек» нельзя было бы отличить от захардкоженной (проба это и показала).
 */
async function seedWithPolicy(
  object: SecurityObject,
  intervalDays: number,
  dueSoonPercent: number,
  version = 'passport-freshness-test.9',
): Promise<void> {
  const base = envelope(object)
  const slice = freshnessSettingsSlice(intervalDays, dueSoonPercent)
  await adapter.reset({
    ...base,
    slices: {
      ...base.slices,
      settings: { ...slice, sectionVersions: { PASSPORT_FRESHNESS: version } },
    },
  })
}

/** Объект с ОДНОЙ опубликованной редакцией — от неё и считается срок §21.7. */
function publishedObject(effectiveFrom: string): SecurityObject {
  return makeObject({
    passportVersions: [
      {
        id: 'version-1',
        versionNumber: 1,
        effectiveFrom,
        publishedAt: `${effectiveFrom}T08:00:00+05:00`,
        publishedBy: MANAGER,
        note: '',
        sectors: [],
      },
    ],
  })
}

async function readObject(): Promise<SecurityObject> {
  const envelope = await adapter.load()
  const slice = envelope?.slices.objects as ObjectsSlice
  return slice.objects[0]
}

beforeEach(async () => {
  registerRbacDirectory([
    { userId: MANAGER, permissions: ['ops.object.view', 'ops.object.manage'] },
    { userId: VIEWER, permissions: ['ops.object.view'] },
  ])
  adapter = createMemoryPersistence()
  clock = new DemoClock('2026-07-20T08:00:00+05:00')
  repository = createObjectsRepository(adapter, clock)
  await seed(makeObject())
})

describe('publishPassportVersion', () => {
  it('без права ops.object.manage — отказ, паспорт не тронут', async () => {
    await expect(
      repository.publishPassportVersion(
        OBJECT_ID,
        { effectiveFrom: '2026-08-01', note: '' },
        VIEWER,
      ),
    ).rejects.toBeInstanceOf(RepositoryPermissionError)
    expect((await readObject()).passportVersions).toHaveLength(0)
  })

  it('несуществующий объект — RepositoryNotFoundError', async () => {
    await expect(
      repository.publishPassportVersion(
        'нет-такого',
        { effectiveFrom: '2026-08-01', note: '' },
        MANAGER,
      ),
    ).rejects.toBeInstanceOf(RepositoryNotFoundError)
  })

  it('публикует снимок действующей редакции с номером и реквизитами', async () => {
    const updated = await repository.publishPassportVersion(
      OBJECT_ID,
      { effectiveFrom: '2026-08-01', note: '  Обновлены требования  ' },
      MANAGER,
    )
    expect(updated.passportVersions).toHaveLength(1)
    const version = updated.passportVersions[0]
    expect(version.versionNumber).toBe(1)
    expect(version.effectiveFrom).toBe('2026-08-01')
    expect(version.publishedBy).toBe(MANAGER)
    expect(version.note).toBe('Обновлены требования')
    expect(version.sectors[0].posts[0].name).toBe('КПП-1')
    // Персистентно, не только в возврате.
    expect((await readObject()).passportVersions).toHaveLength(1)
  })

  it('§8.10 версия НЕИЗМЕНЯЕМА: правка паспорта после публикации её не трогает', async () => {
    await repository.publishPassportVersion(
      OBJECT_ID,
      { effectiveFrom: '2026-08-01', note: '' },
      MANAGER,
    )
    await repository.updatePassport(
      OBJECT_ID,
      {
        sectors: [
          {
            id: 'sector-1',
            name: 'Сектор A (переименован)',
            posts: [
              { id: 'post-1', name: 'КПП-1 (переделан)', task: 'Другая задача', requirements: '' },
            ],
          },
        ],
      },
      MANAGER,
    )
    const stored = await readObject()
    expect(stored.sectors[0].name).toBe('Сектор A (переименован)')
    expect(stored.passportVersions[0].sectors[0].name).toBe('Сектор A')
    expect(stored.passportVersions[0].sectors[0].posts[0].name).toBe('КПП-1')
  })

  it('§8.10 не более одной версии на дату', async () => {
    await repository.publishPassportVersion(
      OBJECT_ID,
      { effectiveFrom: '2026-08-01', note: '' },
      MANAGER,
    )
    await expect(
      repository.publishPassportVersion(
        OBJECT_ID,
        { effectiveFrom: '2026-08-01', note: 'дубль' },
        MANAGER,
      ),
    ).rejects.toBeInstanceOf(RepositoryValidationError)
    expect((await readObject()).passportVersions).toHaveLength(1)
  })

  it('вторая публикация на другую дату получает следующий номер', async () => {
    await repository.publishPassportVersion(OBJECT_ID, { effectiveFrom: '2026-08-01', note: '' }, MANAGER)
    const updated = await repository.publishPassportVersion(
      OBJECT_ID,
      { effectiveFrom: '2026-09-01', note: '' },
      MANAGER,
    )
    expect(updated.passportVersions.map((v) => v.versionNumber)).toEqual([1, 2])
    expect(new Set(updated.passportVersions.map((v) => v.id)).size).toBe(2)
  })

  it.each(['', '01.08.2026', '2026-8-1'])(
    'дата «%s» не принимается',
    async (effectiveFrom) => {
      await expect(
        repository.publishPassportVersion(OBJECT_ID, { effectiveFrom, note: '' }, MANAGER),
      ).rejects.toBeInstanceOf(RepositoryValidationError)
      expect((await readObject()).passportVersions).toHaveLength(0)
    },
  )

  it('паспорт без единого поста публиковать нечего', async () => {
    await seed(makeObject({ sectors: [{ id: 'sector-1', name: 'Сектор A', posts: [] }] }))
    await expect(
      repository.publishPassportVersion(OBJECT_ID, { effectiveFrom: '2026-08-01', note: '' }, MANAGER),
    ).rejects.toBeInstanceOf(RepositoryValidationError)
  })
})

describe('§21.7 — политика свежести приходит ИЗ НАСТРОЕК (§29)', () => {
  it('интервал и версия берутся из чужого слайса, а не из кода реестра', async () => {
    // Публикация 30 дней назад: при интервале 20 срок уже прошёл, при 120 — нет.
    await seedWithPolicy(publishedObject('2026-06-20'), 20, 50)
    const response = await repository.list(VIEWER)
    expect(response.freshnessPolicy).toEqual({
      version: 'passport-freshness-test.9',
      verificationIntervalDays: 20,
      dueSoonPercent: 50,
    })
    expect(response.freshness[0].state).toBe('OVERDUE')
    expect(response.freshness[0].freshnessPolicyVersion).toBe('passport-freshness-test.9')
    expect(response.kpi.verificationOverdue).toBe(1)
  })

  it('порог «скоро» из настроек меняет состояние без правки срока', async () => {
    // Срок — 2026-10-18 (120 дней от 2026-06-20), остаток 90 дней = 75%.
    await seedWithPolicy(publishedObject('2026-06-20'), 120, 50)
    const narrow = await repository.list(VIEWER)
    expect(narrow.freshness[0].state).toBe('FRESH')

    await seedWithPolicy(publishedObject('2026-06-20'), 120, 80)
    const wide = await repository.list(VIEWER)
    expect(wide.freshness[0].state).toBe('DUE_SOON')
    // Сам срок не сдвинулся — менялось только окно предупреждения.
    expect(wide.freshness[0].verificationDueAt).toBe(narrow.freshness[0].verificationDueAt)
  })

  it('без слайса настроек реестр не выдаёт расчёт за действующую редакцию', async () => {
    const base = envelope(publishedObject('2026-06-20'))
    await adapter.reset({ ...base, slices: { objects: base.slices.objects } })
    const response = await repository.list(VIEWER)
    expect(response.freshnessPolicy.version).toContain('unresolved')
    expect(response.freshness[0].freshnessPolicyVersion).toContain('unresolved')
  })
})
