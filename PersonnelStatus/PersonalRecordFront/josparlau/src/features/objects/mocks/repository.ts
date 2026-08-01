// Feature repository (§8.5): server-like validation, permission/scope,
// атомарная мутация. Операции предметной области, НЕ generic CRUD.
import type { DemoClock } from '../../../shared/testing/mock-runtime/demo-clock'
import { hasPermission } from '../../../shared/testing/mock-runtime/rbac-directory'
import type {
  DemoStateEnvelope,
  PersistenceAdapter,
} from '../../../shared/testing/mock-runtime/persistence'
import { runMutation } from '../../../shared/testing/mock-runtime/transaction'
import type {
  ListObjectsResponse,
  PublishPassportVersionRequest,
  UpdatePassportRequest,
} from '../api/pending-contracts'
import type { PassportVersion, SecurityObject } from '../model/types'
import type { ObjectsSlice } from './fixtures'
import { buildObjectsKpi, resolveFreshness } from '../lib/passportFreshness'
import type { UnavailableMetric } from '../lib/passportFreshness'
import { readFreshnessPolicy } from './settingsSlice'

export class RepositoryPermissionError extends Error {}
export class RepositoryNotFoundError extends Error {}
export class RepositoryValidationError extends Error {
  readonly fieldErrors: Record<string, string[]>
  constructor(fieldErrors: Record<string, string[]>) {
    super('validation')
    this.fieldErrors = fieldErrors
  }
}

const SLICE_NAME = 'objects'
const VIEW_PERMISSION = 'ops.object.view'
const MANAGE_PERMISSION = 'ops.object.manage'

function readSlice(envelope: DemoStateEnvelope): ObjectsSlice {
  const slice = envelope.slices[SLICE_NAME]
  if (slice === undefined) {
    throw new Error(
      `mock-runtime: слайс "${SLICE_NAME}" не засеян — проверь app/mocks/compose-seed.ts`,
    )
  }
  return slice as ObjectsSlice
}

/** §21.7, KPI прототипа, которых модель объекта не даёт (§35). */
const UNAVAILABLE_OBJECT_KPI: readonly UnavailableMetric[] = [
  {
    code: 'OPEN_REMARKS',
    label: 'Есть открытые замечания',
    reason:
      'Замечания по объекту не моделируются: у объекта есть паспорт, секторы и посты, но нет журнала замечаний — считать было бы нечего.',
  },
  {
    code: 'MISSING_REQUIRED_SCHEME',
    label: 'Нет обязательной схемы',
    reason:
      'Схемы и документы объекта требуют blob-хранилища, которого в demo-срезе нет (тот же вывод, что для материалов рекогносцировки).',
  },
]

export function createObjectsRepository(adapter: PersistenceAdapter, clock: DemoClock) {
  async function list(actorUserId: string | null): Promise<ListObjectsResponse> {
    if (!hasPermission(actorUserId, VIEW_PERMISSION)) {
      throw new RepositoryPermissionError(VIEW_PERMISSION)
    }
    const envelope = await adapter.load()
    const slice = envelope === null ? null : readSlice(envelope)
    const sorted = [...(slice?.objects ?? [])].sort((a, b) => a.code.localeCompare(b.code))
    // §21.7: политика — из данных, срок и состояние считаются ЗДЕСЬ (на
    // «сервере»), KPI — по ВСЕМУ реестру, а не по отрисованной странице.
    const policy = readFreshnessPolicy(envelope?.slices ?? {})
    const businessDate = clock.businessDate()
    const freshness = sorted.map((object) => resolveFreshness(object, policy, businessDate))
    return {
      results: sorted,
      freshness,
      kpi: buildObjectsKpi(sorted, freshness),
      freshnessPolicy: policy,
      unavailableKpi: [...UNAVAILABLE_OBJECT_KPI],
    }
  }

  async function get(id: string, actorUserId: string | null): Promise<SecurityObject> {
    if (!hasPermission(actorUserId, VIEW_PERMISSION)) {
      throw new RepositoryPermissionError(VIEW_PERMISSION)
    }
    const envelope = await adapter.load()
    const objects = envelope === null ? [] : readSlice(envelope).objects
    const found = objects.find((o) => o.id === id)
    if (found === undefined) {
      throw new RepositoryNotFoundError(id)
    }
    return found
  }

  async function updatePassport(
    id: string,
    request: UpdatePassportRequest,
    actorUserId: string | null,
  ): Promise<SecurityObject> {
    if (!hasPermission(actorUserId, MANAGE_PERMISSION)) {
      throw new RepositoryPermissionError(MANAGE_PERMISSION)
    }
    const fieldErrors: Record<string, string[]> = {}
    request.sectors.forEach((sector, sectorIndex) => {
      if (sector.name.trim() === '') {
        fieldErrors[`sectors.${sectorIndex}.name`] = ['Укажите название сектора.']
      }
      sector.posts.forEach((post, postIndex) => {
        if (post.name.trim() === '') {
          fieldErrors[`sectors.${sectorIndex}.posts.${postIndex}.name`] = ['Укажите название поста.']
        }
      })
    })
    if (Object.keys(fieldErrors).length > 0) {
      throw new RepositoryValidationError(fieldErrors)
    }

    let updated!: SecurityObject
    await runMutation(adapter, clock, (current) => {
      const slice = readSlice(current)
      const existing = slice.objects.find((o) => o.id === id)
      if (existing === undefined) {
        throw new RepositoryNotFoundError(id)
      }
      updated = { ...existing, sectors: request.sectors, updatedAt: clock.now() }
      return {
        ...current.slices,
        [SLICE_NAME]: {
          ...slice,
          objects: slice.objects.map((o) => (o.id === id ? updated : o)),
        } satisfies ObjectsSlice,
      }
    })
    return updated
  }

  /**
   * §8.5 `publishPassportVersion` — публикация действующей редакции паспорта
   * как НЕИЗМЕНЯЕМОЙ версии (§8.10).
   *
   * Снимок — глубокая копия. ⚠️ Честно: красная проба показала, что СЕГОДНЯ
   * unit-тест неизменяемости зелёный и без неё — `updatePassport` заменяет
   * `sectors` целиком новым массивом из запроса, поэтому общая ссылка ничего
   * не портит. Копия оставлена как защита от будущей правки, которая начнёт
   * менять секторы НА МЕСТЕ (тогда версия переписалась бы задним числом), и
   * сознательно является вторым гардом, а не проверяемым тестом инвариантом.
   */
  async function publishPassportVersion(
    id: string,
    request: PublishPassportVersionRequest,
    actorUserId: string | null,
  ): Promise<SecurityObject> {
    if (!hasPermission(actorUserId, MANAGE_PERMISSION)) {
      throw new RepositoryPermissionError(MANAGE_PERMISSION)
    }

    let updated!: SecurityObject
    await runMutation(adapter, clock, (current) => {
      const slice = readSlice(current)
      const existing = slice.objects.find((o) => o.id === id)
      if (existing === undefined) {
        throw new RepositoryNotFoundError(id)
      }

      const fieldErrors: Record<string, string[]> = {}
      const effectiveFrom = request.effectiveFrom.trim()
      if (!/^\d{4}-\d{2}-\d{2}$/.test(effectiveFrom)) {
        fieldErrors.effectiveFrom = ['Укажите дату вступления в силу.']
      } else if (
        existing.passportVersions.some((v) => v.effectiveFrom === effectiveFrom)
      ) {
        // §8.10: «не более чем одна действующая опубликованная версия на дату».
        fieldErrors.effectiveFrom = [
          'На эту дату версия паспорта уже опубликована.',
        ]
      }
      // Публиковать нечего, если ни на одном секторе нет ни одного поста:
      // пустой паспорт как «версия» — документ ни о чём.
      if (!existing.sectors.some((sector) => sector.posts.length > 0)) {
        fieldErrors.sectors = [
          'В паспорте нет ни одного поста — публиковать нечего.',
        ]
      }
      if (Object.keys(fieldErrors).length > 0) {
        throw new RepositoryValidationError(fieldErrors)
      }

      const versionNumber = existing.passportVersions.length + 1
      const version: PassportVersion = {
        id: `${existing.id}-passport-v${versionNumber}`,
        versionNumber,
        effectiveFrom,
        publishedAt: clock.now(),
        publishedBy: actorUserId ?? '',
        note: request.note.trim(),
        sectors: existing.sectors.map((sector) => ({
          ...sector,
          posts: sector.posts.map((post) => ({ ...post })),
        })),
      }
      updated = {
        ...existing,
        passportVersions: [...existing.passportVersions, version],
        updatedAt: clock.now(),
      }
      return {
        ...current.slices,
        [SLICE_NAME]: {
          ...slice,
          objects: slice.objects.map((o) => (o.id === id ? updated : o)),
        } satisfies ObjectsSlice,
      }
    })
    return updated
  }

  return { list, get, updatePassport, publishPassportVersion }
}
