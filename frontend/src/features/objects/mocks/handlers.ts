// MSW handlers — feature-owned (§8.2).
import { http, HttpResponse } from 'msw'
import type { DemoClock } from '../../../shared/testing/mock-runtime/demo-clock'
import type { PersistenceAdapter } from '../../../shared/testing/mock-runtime/persistence'
import type { ErrorEnvelope } from '../../../shared/api/errors'
import { OBJECTS_PATH, objectDetailPath, objectPassportPath } from '../api/pending-contracts'
import type { UpdatePassportRequest } from '../api/pending-contracts'
import {
  createObjectsRepository,
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
    message: 'Объект не найден.',
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
      message: 'Проверьте заполнение паспорта.',
      details: error.fieldErrors,
      request_id: null,
      timestamp: clock.now(),
    }
    return HttpResponse.json(envelope, { status: 400 })
  }
  return null
}

export function createObjectsHandlers(adapter: PersistenceAdapter, clock: DemoClock) {
  const repository = createObjectsRepository(adapter, clock)

  return [
    http.get(`*${OBJECTS_PATH}`, async ({ request }) => {
      const actorUserId = request.headers.get('X-User-Id')
      try {
        return HttpResponse.json(await repository.list(actorUserId))
      } catch (error) {
        return mapRepositoryError(error, clock, '') ?? HttpResponse.error()
      }
    }),
    http.get(`*${objectDetailPath(':id')}`, async ({ request, params }) => {
      const actorUserId = request.headers.get('X-User-Id')
      const id = params.id as string
      try {
        return HttpResponse.json(await repository.get(id, actorUserId))
      } catch (error) {
        return mapRepositoryError(error, clock, id) ?? HttpResponse.error()
      }
    }),
    http.patch(`*${objectPassportPath(':id')}`, async ({ request, params }) => {
      const actorUserId = request.headers.get('X-User-Id')
      const id = params.id as string
      const body = (await request.json()) as UpdatePassportRequest
      try {
        return HttpResponse.json(await repository.updatePassport(id, body, actorUserId))
      } catch (error) {
        return mapRepositoryError(error, clock, id) ?? HttpResponse.error()
      }
    }),
  ]
}
