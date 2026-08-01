// MSW handlers — feature-owned (§8.2).
import { http, HttpResponse } from 'msw'
import type { DemoClock } from '../../../shared/testing/mock-runtime/demo-clock'
import type { PersistenceAdapter } from '../../../shared/testing/mock-runtime/persistence'
import type { ErrorEnvelope } from '../../../shared/api/errors'
import {
  DICTIONARIES_PATH,
  dictionaryEntriesPath,
  dictionaryEntryPath,
  dictionaryEntrySetActivePath,
} from '../api/pending-contracts'
import type {
  CreateDictionaryEntryRequest,
  SetDictionaryEntryActiveRequest,
} from '../api/pending-contracts'
import {
  createDictionariesRepository,
  RepositoryConflictError,
  RepositoryNotFoundError,
  RepositoryPermissionError,
  RepositoryValidationError,
} from './repository'

function permissionDeniedEnvelope(clock: DemoClock): ErrorEnvelope {
  return {
    error_code: 'PERMISSION_DENIED',
    message: 'Недостаточно прав.',
    details: {},
    request_id: null,
    timestamp: clock.now(),
  }
}

function notFoundEnvelope(clock: DemoClock, id: string): ErrorEnvelope {
  return {
    error_code: 'ENTITY_NOT_FOUND',
    message: 'Справочник или значение не найдены.',
    details: { id },
    request_id: null,
    timestamp: clock.now(),
  }
}

function mapRepositoryError(error: unknown, clock: DemoClock, entityId: string): Response | null {
  if (error instanceof RepositoryPermissionError) {
    return HttpResponse.json(permissionDeniedEnvelope(clock), { status: 403 })
  }
  if (error instanceof RepositoryNotFoundError) {
    return HttpResponse.json(notFoundEnvelope(clock, entityId), { status: 404 })
  }
  if (error instanceof RepositoryValidationError) {
    const envelope: ErrorEnvelope = {
      error_code: 'VALIDATION_ERROR',
      message: 'Проверьте заполнение значения справочника.',
      details: error.fieldErrors,
      request_id: null,
      timestamp: clock.now(),
    }
    return HttpResponse.json(envelope, { status: 400 })
  }
  if (error instanceof RepositoryConflictError) {
    const envelope: ErrorEnvelope = {
      error_code: error.errorCode,
      message: error.message,
      // §30 «понятная зависимость»: источники едут структурой, а не только
      // внутри текста сообщения.
      details: error.usage === null ? {} : { usage: error.usage },
      request_id: null,
      timestamp: clock.now(),
    }
    return HttpResponse.json(envelope, { status: 409 })
  }
  return null
}

export function createDictionariesHandlers(adapter: PersistenceAdapter, clock: DemoClock) {
  const repository = createDictionariesRepository(adapter, clock)

  return [
    http.get(`*${DICTIONARIES_PATH}`, async ({ request }) => {
      const actorUserId = request.headers.get('X-User-Id')
      try {
        return HttpResponse.json(await repository.listDefinitions(actorUserId))
      } catch (error) {
        return mapRepositoryError(error, clock, '') ?? HttpResponse.error()
      }
    }),
    http.get(`*${dictionaryEntriesPath(':code')}`, async ({ request, params }) => {
      const actorUserId = request.headers.get('X-User-Id')
      const code = params.code as string
      try {
        return HttpResponse.json(await repository.listEntries(code, actorUserId))
      } catch (error) {
        return mapRepositoryError(error, clock, code) ?? HttpResponse.error()
      }
    }),
    http.post(`*${dictionaryEntriesPath(':code')}`, async ({ request, params }) => {
      const actorUserId = request.headers.get('X-User-Id')
      const code = params.code as string
      const body = (await request.json()) as CreateDictionaryEntryRequest
      try {
        return HttpResponse.json(await repository.createEntry(code, body, actorUserId))
      } catch (error) {
        return mapRepositoryError(error, clock, code) ?? HttpResponse.error()
      }
    }),
    http.delete(`*${dictionaryEntryPath(':id')}`, async ({ request, params }) => {
      const actorUserId = request.headers.get('X-User-Id')
      const id = params.id as string
      try {
        await repository.deleteEntry(id, actorUserId)
        return new HttpResponse(null, { status: 204 })
      } catch (error) {
        return mapRepositoryError(error, clock, id) ?? HttpResponse.error()
      }
    }),
    http.post(`*${dictionaryEntrySetActivePath(':id')}`, async ({ request, params }) => {
      const actorUserId = request.headers.get('X-User-Id')
      const id = params.id as string
      const body = (await request.json()) as SetDictionaryEntryActiveRequest
      try {
        return HttpResponse.json(await repository.setEntryActive(id, body.isActive, actorUserId))
      } catch (error) {
        return mapRepositoryError(error, clock, id) ?? HttpResponse.error()
      }
    }),
  ]
}
