// MSW handlers — feature-owned (§8.2). Фабрика принимает adapter/clock
// (dependency injection): feature НЕ импортирует app/mocks/demo-runtime
// (ARCH-FE-013 запрещает features→app) — композиция берёт синглтоны на
// уровне app и передаёт их сюда явно.
import { http, HttpResponse } from 'msw'
import type { DemoClock } from '../../../shared/testing/mock-runtime/demo-clock'
import type { PersistenceAdapter } from '../../../shared/testing/mock-runtime/persistence'
import { hasPermission } from '../../../shared/testing/mock-runtime/rbac-directory'
import type { ErrorEnvelope } from '../../../shared/api/errors'
import {
  BINDABLE_OBJECTS_PATH,
  PERSONNEL_PATH,
  SECURITY_EVENTS_PATH,
  securityEventAcknowledgePath,
  securityEventAcknowledgementCompletePath,
  securityEventApprovalApprovePath,
  securityEventApprovalReturnPath,
  securityEventClosePath,
  securityEventDemandApprovePath,
  securityEventForceAllocationPath,
  securityEventForcesCompletePath,
  securityEventJournalPath,
  securityEventPassportPath,
  securityEventPlacementAssignPath,
  securityEventPlacementCompletePath,
  securityEventPlacementRatingsPath,
  securityEventPlacementUnassignPath,
  securityEventReconCompletePath,
  securityEventReconImportPath,
  securityEventReconPath,
  securityEventReplaceAssignmentPath,
} from '../api/pending-contracts'
import type {
  AddJournalEntryRequest,
  AssignPlacementRequest,
  CloseSecurityEventRequest,
  CreateSecurityEventRequest,
  ListPersonnelResponse,
  ListSecurityEventsParams,
  ReplaceAssignmentRequest,
  ReturnPlacementRequest,
  UpdateBulletinRequest,
  UpdateDemandRequest,
  UpdateForceAllocationRequest,
  UpdateReconRequest,
} from '../api/pending-contracts'
import { PERSONNEL_ROSTER } from './personnelRoster'
import type { ReconChecklistItem, ReconSectorPost, SecurityEventStage } from '../model/types'
import { SECURITY_EVENT_STAGES } from '../model/types'
import {
  createSecurityEventsRepository,
  RepositoryBusinessRuleError,
  RepositoryConflictError,
  RepositoryNotFoundError,
  RepositoryPermissionError,
  RepositoryValidationError,
} from './repository'

function businessRuleEnvelope(
  clock: DemoClock,
  errorCode: string,
  message: string,
): ErrorEnvelope {
  return {
    error_code: errorCode,
    message,
    details: {},
    request_id: null,
    timestamp: clock.now(),
  }
}

function normalizeChecklist(raw: unknown): ReconChecklistItem[] {
  if (!Array.isArray(raw)) return []
  return raw.map((item) => {
    const record = (item ?? {}) as Record<string, unknown>
    return {
      id: typeof record.id === 'string' ? record.id : '',
      label: typeof record.label === 'string' ? record.label : '',
      done: record.done === true,
      result:
        record.result === 'MATCHES' || record.result === 'NEEDS_CHANGES'
          ? record.result
          : null,
      comment: typeof record.comment === 'string' ? record.comment : '',
    }
  })
}

function normalizeSectorPosts(raw: unknown): ReconSectorPost[] {
  if (!Array.isArray(raw)) return []
  return raw.map((item) => {
    const record = (item ?? {}) as Record<string, unknown>
    return {
      id: typeof record.id === 'string' ? record.id : '',
      sector: typeof record.sector === 'string' ? record.sector : '',
      post: typeof record.post === 'string' ? record.post : '',
      task: typeof record.task === 'string' ? record.task : '',
      need: typeof record.need === 'number' ? record.need : 0,
      requirements: typeof record.requirements === 'string' ? record.requirements : '',
      result:
        record.result === 'MATCHES' || record.result === 'NEEDS_CHANGES'
          ? record.result
          : null,
      comment: typeof record.comment === 'string' ? record.comment : '',
      // Источник строки в паспорте переживает сохранение расчёта. Если его
      // здесь потерять, §9.6-цепочка «расстановка → пост версии паспорта»
      // рвётся при первом же «Сохранить расчёт» — молча и без ошибки.
      sourceSectorId:
        typeof record.sourceSectorId === 'string' ? record.sourceSectorId : null,
      sourcePostId: typeof record.sourcePostId === 'string' ? record.sourcePostId : null,
      // §19.24: требование поста к рейтингу тоже переживает «Сохранить
      // расчёт» — потерять его здесь значило бы молча снять требование первым
      // же сохранением рекогносцировки (тот же класс, что source* выше).
      minRating: typeof record.minRating === 'number' ? record.minRating : null,
    }
  })
}

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
    message: 'Охранное мероприятие не найдено.',
    details: { id },
    request_id: null,
    timestamp: clock.now(),
  }
}

function isValidStage(value: string | null): value is SecurityEventStage {
  return (SECURITY_EVENT_STAGES as readonly string[]).includes(value ?? '')
}

/** Общий маппинг repository-ошибок → HTTP-ответ (§36 канон). `null` = не распознано, пробросить дальше. */
function mapRepositoryError(
  error: unknown,
  clock: DemoClock,
  entityId: string,
): Response | null {
  if (error instanceof RepositoryPermissionError) {
    return HttpResponse.json(permissionDeniedEnvelope(clock), { status: 403 })
  }
  if (error instanceof RepositoryNotFoundError) {
    return HttpResponse.json(notFoundEnvelope(clock, entityId), { status: 404 })
  }
  if (error instanceof RepositoryValidationError) {
    const envelope: ErrorEnvelope = {
      error_code: 'VALIDATION_ERROR',
      message: 'Проверьте заполнение формы.',
      details: error.fieldErrors,
      request_id: null,
      timestamp: clock.now(),
    }
    return HttpResponse.json(envelope, { status: 400 })
  }
  if (error instanceof RepositoryBusinessRuleError) {
    return HttpResponse.json(
      businessRuleEnvelope(clock, error.errorCode, error.message),
      { status: 422 },
    )
  }
  // §19.24: мягкий конфликт — 409, а не 422. Клиент различает их по статусу:
  // 422 — отказ, 409 с overridable-кодом — «можно, но нужно обоснование».
  if (error instanceof RepositoryConflictError) {
    const envelope: ErrorEnvelope = {
      error_code: error.errorCode,
      message: error.message,
      details: error.details,
      request_id: null,
      timestamp: clock.now(),
    }
    return HttpResponse.json(envelope, { status: 409 })
  }
  return null
}

export function createSecurityEventsHandlers(
  adapter: PersistenceAdapter,
  clock: DemoClock,
) {
  const repository = createSecurityEventsRepository(adapter, clock)

  return [
    http.get(`*${SECURITY_EVENTS_PATH}`, async ({ request }) => {
      const url = new URL(request.url)
      const actorUserId = request.headers.get('X-User-Id')
      const stageParam = url.searchParams.get('stage')
      const params: ListSecurityEventsParams = {
        search: url.searchParams.get('search') ?? '',
        stage: isValidStage(stageParam) ? stageParam : 'ALL',
        page: Number(url.searchParams.get('page') ?? '1') || 1,
        pageSize: Number(url.searchParams.get('page_size') ?? '20') || 20,
      }
      try {
        const response = await repository.list(params, actorUserId)
        return HttpResponse.json(response)
      } catch (error) {
        if (error instanceof RepositoryPermissionError) {
          return HttpResponse.json(permissionDeniedEnvelope(clock), {
            status: 403,
          })
        }
        throw error
      }
    }),

    // ⚠️ ПОРЯДОК: этот маршрут обязан стоять ДО `:id/` — иначе MSW разберёт
    // «bindable-objects» как идентификатор ОМ и вернёт 404.
    http.get(`*${BINDABLE_OBJECTS_PATH}`, async ({ request }) => {
      const actorUserId = request.headers.get('X-User-Id')
      try {
        return HttpResponse.json(await repository.listBindableObjects(actorUserId))
      } catch (error) {
        const mapped = mapRepositoryError(error, clock, '')
        if (mapped !== null) return mapped
        throw error
      }
    }),

    http.get(`*${securityEventPassportPath(':id')}`, async ({ request, params }) => {
      const actorUserId = request.headers.get('X-User-Id')
      const id = String(params.id)
      try {
        return HttpResponse.json(await repository.getPassportView(id, actorUserId))
      } catch (error) {
        const mapped = mapRepositoryError(error, clock, id)
        if (mapped !== null) return mapped
        throw error
      }
    }),

    http.post(`*${securityEventReconImportPath(':id')}`, async ({ request, params }) => {
      const actorUserId = request.headers.get('X-User-Id')
      const id = String(params.id)
      try {
        return HttpResponse.json(
          await repository.importReconPostsFromPassport(id, actorUserId),
        )
      } catch (error) {
        const mapped = mapRepositoryError(error, clock, id)
        if (mapped !== null) return mapped
        throw error
      }
    }),

    http.get(`*${SECURITY_EVENTS_PATH}:id/`, async ({ request, params }) => {
      const actorUserId = request.headers.get('X-User-Id')
      const id = String(params.id)
      try {
        const event = await repository.get(id, actorUserId)
        return HttpResponse.json(event)
      } catch (error) {
        if (error instanceof RepositoryPermissionError) {
          return HttpResponse.json(permissionDeniedEnvelope(clock), {
            status: 403,
          })
        }
        if (error instanceof RepositoryNotFoundError) {
          return HttpResponse.json(notFoundEnvelope(clock, id), {
            status: 404,
          })
        }
        throw error
      }
    }),

    http.post(`*${SECURITY_EVENTS_PATH}`, async ({ request }) => {
      const actorUserId = request.headers.get('X-User-Id')
      const body = (await request.json().catch(() => ({}))) as Partial<
        Record<keyof CreateSecurityEventRequest, unknown>
      >
      const normalized: CreateSecurityEventRequest = {
        title: typeof body.title === 'string' ? body.title : '',
        objectId: typeof body.objectId === 'string' ? body.objectId : '',
        businessDate:
          typeof body.businessDate === 'string' ? body.businessDate : '',
      }
      try {
        const created = await repository.create(normalized, actorUserId)
        return HttpResponse.json(created, { status: 201 })
      } catch (error) {
        if (error instanceof RepositoryPermissionError) {
          return HttpResponse.json(permissionDeniedEnvelope(clock), {
            status: 403,
          })
        }
        if (error instanceof RepositoryValidationError) {
          const envelope: ErrorEnvelope = {
            error_code: 'VALIDATION_ERROR',
            message: 'Проверьте заполнение формы.',
            details: error.fieldErrors,
            request_id: null,
            timestamp: clock.now(),
          }
          return HttpResponse.json(envelope, { status: 400 })
        }
        throw error
      }
    }),

    http.patch(`*${SECURITY_EVENTS_PATH}:id/bulletin/`, async ({ request, params }) => {
      const actorUserId = request.headers.get('X-User-Id')
      const id = String(params.id)
      const body = (await request.json().catch(() => ({}))) as Partial<
        Record<keyof UpdateBulletinRequest, unknown>
      >
      const normalized = {
        briefDescription:
          typeof body.briefDescription === 'string' ? body.briefDescription : '',
        initialTasks:
          typeof body.initialTasks === 'string' ? body.initialTasks : '',
      }
      try {
        const updated = await repository.updateBulletin(id, normalized, actorUserId)
        return HttpResponse.json(updated)
      } catch (error) {
        if (error instanceof RepositoryPermissionError) {
          return HttpResponse.json(permissionDeniedEnvelope(clock), {
            status: 403,
          })
        }
        if (error instanceof RepositoryNotFoundError) {
          return HttpResponse.json(notFoundEnvelope(clock, id), {
            status: 404,
          })
        }
        if (error instanceof RepositoryValidationError) {
          const envelope: ErrorEnvelope = {
            error_code: 'VALIDATION_ERROR',
            message: 'Проверьте заполнение формы.',
            details: error.fieldErrors,
            request_id: null,
            timestamp: clock.now(),
          }
          return HttpResponse.json(envelope, { status: 400 })
        }
        throw error
      }
    }),

    http.patch(`*${securityEventReconPath(':id')}`, async ({ request, params }) => {
      const actorUserId = request.headers.get('X-User-Id')
      const id = String(params.id)
      const body = (await request.json().catch(() => ({}))) as Record<string, unknown>
      const normalized: UpdateReconRequest = {
        checklist: normalizeChecklist(body.checklist),
        sectorPosts: normalizeSectorPosts(body.sectorPosts),
      }
      try {
        const updated = await repository.updateRecon(id, normalized, actorUserId)
        return HttpResponse.json(updated)
      } catch (error) {
        if (error instanceof RepositoryPermissionError) {
          return HttpResponse.json(permissionDeniedEnvelope(clock), {
            status: 403,
          })
        }
        if (error instanceof RepositoryNotFoundError) {
          return HttpResponse.json(notFoundEnvelope(clock, id), {
            status: 404,
          })
        }
        if (error instanceof RepositoryValidationError) {
          const envelope: ErrorEnvelope = {
            error_code: 'VALIDATION_ERROR',
            message: 'Проверьте заполнение формы.',
            details: error.fieldErrors,
            request_id: null,
            timestamp: clock.now(),
          }
          return HttpResponse.json(envelope, { status: 400 })
        }
        throw error
      }
    }),

    http.post(`*${securityEventReconCompletePath(':id')}`, async ({ request, params }) => {
      const actorUserId = request.headers.get('X-User-Id')
      const id = String(params.id)
      try {
        const updated = await repository.completeRecon(id, actorUserId)
        return HttpResponse.json(updated)
      } catch (error) {
        if (error instanceof RepositoryPermissionError) {
          return HttpResponse.json(permissionDeniedEnvelope(clock), {
            status: 403,
          })
        }
        if (error instanceof RepositoryNotFoundError) {
          return HttpResponse.json(notFoundEnvelope(clock, id), {
            status: 404,
          })
        }
        if (error instanceof RepositoryBusinessRuleError) {
          return HttpResponse.json(
            businessRuleEnvelope(clock, error.errorCode, error.message),
            { status: 422 },
          )
        }
        throw error
      }
    }),

    http.post(`*${securityEventDemandApprovePath(':id')}`, async ({ request, params }) => {
      const actorUserId = request.headers.get('X-User-Id')
      const id = String(params.id)
      const body = (await request.json().catch(() => ({}))) as Record<string, unknown>
      const rows = Array.isArray(body.rows) ? body.rows : []
      const normalized: UpdateDemandRequest = {
        rows: rows.map((item) => {
          const record = (item ?? {}) as Record<string, unknown>
          return {
            id: typeof record.id === 'string' ? record.id : '',
            sector: typeof record.sector === 'string' ? record.sector : '',
            task: typeof record.task === 'string' ? record.task : '',
            shift: typeof record.shift === 'string' ? record.shift : '',
            need: typeof record.need === 'number' ? record.need : 0,
            group: typeof record.group === 'string' ? record.group : '',
            requirements: typeof record.requirements === 'string' ? record.requirements : '',
            comment: typeof record.comment === 'string' ? record.comment : '',
          }
        }),
      }
      try {
        const updated = await repository.approveDemand(id, normalized, actorUserId)
        return HttpResponse.json(updated)
      } catch (error) {
        const mapped = mapRepositoryError(error, clock, id)
        if (mapped) return mapped
        throw error
      }
    }),

    http.patch(
      `*${securityEventForceAllocationPath(':id', ':requestId')}`,
      async ({ request, params }) => {
        const actorUserId = request.headers.get('X-User-Id')
        const id = String(params.id)
        const requestId = String(params.requestId)
        const body = (await request.json().catch(() => ({}))) as Partial<
          Record<keyof UpdateForceAllocationRequest, unknown>
        >
        const normalized: UpdateForceAllocationRequest = {
          allocatedCount: typeof body.allocatedCount === 'number' ? body.allocatedCount : 0,
          comment: typeof body.comment === 'string' ? body.comment : '',
        }
        try {
          const updated = await repository.updateForceAllocation(
            id,
            requestId,
            normalized,
            actorUserId,
          )
          return HttpResponse.json(updated)
        } catch (error) {
          const mapped = mapRepositoryError(error, clock, id)
          if (mapped) return mapped
          throw error
        }
      },
    ),

    http.post(`*${securityEventForcesCompletePath(':id')}`, async ({ request, params }) => {
      const actorUserId = request.headers.get('X-User-Id')
      const id = String(params.id)
      try {
        const updated = await repository.completeForces(id, actorUserId)
        return HttpResponse.json(updated)
      } catch (error) {
        const mapped = mapRepositoryError(error, clock, id)
        if (mapped) return mapped
        throw error
      }
    }),

    http.post(`*${securityEventPlacementAssignPath(':id')}`, async ({ request, params }) => {
      const actorUserId = request.headers.get('X-User-Id')
      const id = String(params.id)
      const body = (await request.json().catch(() => ({}))) as Partial<
        Record<keyof AssignPlacementRequest, unknown>
      >
      const normalized: AssignPlacementRequest = {
        postId: typeof body.postId === 'string' ? body.postId : '',
        employeeId: typeof body.employeeId === 'string' ? body.employeeId : '',
        // §19.24: поля протокола обхода. Потерять их при нормализации значило
        // бы сделать `confirmOverride` вечным 409 — повтор с обоснованием
        // приходил бы на сервер без него.
        override: body.override === true,
        override_reason:
          typeof body.override_reason === 'string' ? body.override_reason : '',
      }
      try {
        const updated = await repository.assignPlacement(id, normalized, actorUserId)
        return HttpResponse.json(updated)
      } catch (error) {
        const mapped = mapRepositoryError(error, clock, id)
        if (mapped) return mapped
        throw error
      }
    }),

    // §19.24: разрешённая краткая сводка рейтинга назначенных. GET и ровно
    // одна операция — состав полей решает сервер по правам смотрящего.
    http.get(`*${securityEventPlacementRatingsPath(':id')}`, async ({ request, params }) => {
      const actorUserId = request.headers.get('X-User-Id')
      const id = String(params.id)
      try {
        const response = await repository.listPlacementRatings(id, actorUserId)
        return HttpResponse.json(response)
      } catch (error) {
        const mapped = mapRepositoryError(error, clock, id)
        if (mapped) return mapped
        throw error
      }
    }),

    http.delete(
      `*${securityEventPlacementUnassignPath(':id', ':assignmentId')}`,
      async ({ request, params }) => {
        const actorUserId = request.headers.get('X-User-Id')
        const id = String(params.id)
        const assignmentId = String(params.assignmentId)
        try {
          const updated = await repository.unassignPlacement(id, assignmentId, actorUserId)
          return HttpResponse.json(updated)
        } catch (error) {
          const mapped = mapRepositoryError(error, clock, id)
          if (mapped) return mapped
          throw error
        }
      },
    ),

    http.post(`*${securityEventPlacementCompletePath(':id')}`, async ({ request, params }) => {
      const actorUserId = request.headers.get('X-User-Id')
      const id = String(params.id)
      try {
        const updated = await repository.completePlacement(id, actorUserId)
        return HttpResponse.json(updated)
      } catch (error) {
        const mapped = mapRepositoryError(error, clock, id)
        if (mapped) return mapped
        throw error
      }
    }),

    http.post(`*${securityEventApprovalApprovePath(':id')}`, async ({ request, params }) => {
      const actorUserId = request.headers.get('X-User-Id')
      const id = String(params.id)
      try {
        const updated = await repository.approvePlacement(id, actorUserId)
        return HttpResponse.json(updated)
      } catch (error) {
        const mapped = mapRepositoryError(error, clock, id)
        if (mapped) return mapped
        throw error
      }
    }),

    http.post(`*${securityEventApprovalReturnPath(':id')}`, async ({ request, params }) => {
      const actorUserId = request.headers.get('X-User-Id')
      const id = String(params.id)
      const body = (await request.json().catch(() => ({}))) as Partial<
        Record<keyof ReturnPlacementRequest, unknown>
      >
      const normalized: ReturnPlacementRequest = {
        comment: typeof body.comment === 'string' ? body.comment : '',
      }
      try {
        const updated = await repository.returnPlacement(id, normalized, actorUserId)
        return HttpResponse.json(updated)
      } catch (error) {
        const mapped = mapRepositoryError(error, clock, id)
        if (mapped) return mapped
        throw error
      }
    }),

    http.post(
      `*${securityEventAcknowledgePath(':id', ':assignmentId')}`,
      async ({ request, params }) => {
        const actorUserId = request.headers.get('X-User-Id')
        const id = String(params.id)
        try {
          const updated = await repository.acknowledgePlacement(
            id,
            String(params.assignmentId),
            actorUserId,
          )
          return HttpResponse.json(updated)
        } catch (error) {
          const mapped = mapRepositoryError(error, clock, id)
          if (mapped) return mapped
          throw error
        }
      },
    ),

    http.post(
      `*${securityEventAcknowledgementCompletePath(':id')}`,
      async ({ request, params }) => {
        const actorUserId = request.headers.get('X-User-Id')
        const id = String(params.id)
        try {
          const updated = await repository.completeAcknowledgement(id, actorUserId)
          return HttpResponse.json(updated)
        } catch (error) {
          const mapped = mapRepositoryError(error, clock, id)
          if (mapped) return mapped
          throw error
        }
      },
    ),

    http.post(`*${securityEventJournalPath(':id')}`, async ({ request, params }) => {
      const actorUserId = request.headers.get('X-User-Id')
      const id = String(params.id)
      const body = (await request.json().catch(() => ({}))) as Partial<
        Record<keyof AddJournalEntryRequest, unknown>
      >
      const validTypes = ['INSTRUCTION', 'ORDER', 'INCIDENT', 'REPLACEMENT']
      const normalized: AddJournalEntryRequest = {
        type: validTypes.includes(body.type as string)
          ? (body.type as AddJournalEntryRequest['type'])
          : 'INSTRUCTION',
        title: typeof body.title === 'string' ? body.title : '',
        description: typeof body.description === 'string' ? body.description : '',
      }
      try {
        const updated = await repository.addJournalEntry(id, normalized, actorUserId)
        return HttpResponse.json(updated)
      } catch (error) {
        const mapped = mapRepositoryError(error, clock, id)
        if (mapped) return mapped
        throw error
      }
    }),

    http.post(`*${securityEventReplaceAssignmentPath(':id')}`, async ({ request, params }) => {
      const actorUserId = request.headers.get('X-User-Id')
      const id = String(params.id)
      const body = (await request.json().catch(() => ({}))) as Partial<
        Record<keyof ReplaceAssignmentRequest, unknown>
      >
      const normalized: ReplaceAssignmentRequest = {
        assignmentId: typeof body.assignmentId === 'string' ? body.assignmentId : '',
        incomingEmployeeId: typeof body.incomingEmployeeId === 'string' ? body.incomingEmployeeId : '',
        reasonCode: typeof body.reasonCode === 'string' ? body.reasonCode : '',
      }
      try {
        const updated = await repository.replaceAssignment(id, normalized, actorUserId)
        return HttpResponse.json(updated)
      } catch (error) {
        const mapped = mapRepositoryError(error, clock, id)
        if (mapped) return mapped
        throw error
      }
    }),

    http.post(`*${securityEventClosePath(':id')}`, async ({ request, params }) => {
      const actorUserId = request.headers.get('X-User-Id')
      const id = String(params.id)
      const body = (await request.json().catch(() => ({}))) as Record<string, unknown>
      const rawSummaries = Array.isArray(body.directionSummaries) ? body.directionSummaries : []
      const normalized: CloseSecurityEventRequest = {
        directionSummaries: rawSummaries.map((item) => {
          const record = (item ?? {}) as Record<string, unknown>
          return {
            direction: typeof record.direction === 'string' ? record.direction : '',
            summary: typeof record.summary === 'string' ? record.summary : '',
          }
        }),
      }
      try {
        const updated = await repository.closeSecurityEvent(id, normalized, actorUserId)
        return HttpResponse.json(updated)
      } catch (error) {
        const mapped = mapRepositoryError(error, clock, id)
        if (mapped) return mapped
        throw error
      }
    }),

    // external-personnel-contract-pending: read-only снимок для подбора
    // кандидатов на «Расстановке» — та же проверка прав, что и назначение
    // (кто может назначать, тот может видеть, кого назначать).
    http.get(`*${PERSONNEL_PATH}`, ({ request }) => {
      const actorUserId = request.headers.get('X-User-Id')
      if (!hasPermission(actorUserId, 'ops.placement.manage')) {
        return HttpResponse.json(permissionDeniedEnvelope(clock), { status: 403 })
      }
      const body: ListPersonnelResponse = { results: [...PERSONNEL_ROSTER] }
      return HttpResponse.json(body)
    }),
  ]
}
