// Feature repository (§8.5): server-like validation, permission/scope,
// атомарная мутация. Операции предметной области, НЕ generic CRUD.
import type { DemoClock } from '../../../shared/testing/mock-runtime/demo-clock'
import { hasPermission } from '../../../shared/testing/mock-runtime/rbac-directory'
import type {
  DemoStateEnvelope,
  PersistenceAdapter,
} from '../../../shared/testing/mock-runtime/persistence'
import { runMutation } from '../../../shared/testing/mock-runtime/transaction'
import type { ListObjectsResponse, UpdatePassportRequest } from '../api/pending-contracts'
import type { SecurityObject } from '../model/types'
import type { ObjectsSlice } from './fixtures'

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

export function createObjectsRepository(adapter: PersistenceAdapter, clock: DemoClock) {
  async function list(actorUserId: string | null): Promise<ListObjectsResponse> {
    if (!hasPermission(actorUserId, VIEW_PERMISSION)) {
      throw new RepositoryPermissionError(VIEW_PERMISSION)
    }
    const envelope = await adapter.load()
    const objects = envelope === null ? [] : readSlice(envelope).objects
    const sorted = [...objects].sort((a, b) => a.code.localeCompare(b.code))
    return { results: sorted }
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
          objects: slice.objects.map((o) => (o.id === id ? updated : o)),
        } satisfies ObjectsSlice,
      }
    })
    return updated
  }

  return { list, get, updatePassport }
}
