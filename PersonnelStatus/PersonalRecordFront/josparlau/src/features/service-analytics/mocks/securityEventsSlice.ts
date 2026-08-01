// Чтение ЧУЖОГО слайса `security-events` из общего demo-снапшота (§8.4).
//
// Пятый случай того же приёма в проекте (A58 печатная форма, A62 привязка
// паспорта, отчётный реестр, аналитика службы): импорт из
// `features/security-events` красный по ARCH-FE-013, поэтому выборку делает
// СЕРВЕР — рукописная УЗКАЯ проекция соседнего слайса.
//
// Инвариант: ТОЛЬКО ЧТЕНИЕ. Аналитика ничего не меняет в чужом агрегате.
import type { OpsSourceEvent, OpsSourcePost, OpsSourceTransition } from '../lib/operations'

export const SECURITY_EVENTS_SLICE_NAME = 'security-events'

interface PostProjection {
  id?: unknown
  sector?: unknown
  post?: unknown
  need?: unknown
  sourceSectorId?: unknown
}

interface EventProjection {
  id?: unknown
  code?: unknown
  title?: unknown
  objectId?: unknown
  objectName?: unknown
  businessDate?: unknown
  stage?: unknown
  readinessPercent?: unknown
  conflictsCount?: unknown
  demandApproved?: unknown
  demandRows?: unknown
  forceRequests?: unknown
  placementAssignments?: unknown
  journalEntries?: unknown
  reconSectorPosts?: unknown
  closedAt?: unknown
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function asNumber(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

function buildPosts(event: EventProjection): OpsSourcePost[] {
  const assignments = asArray(event.placementAssignments) as {
    postId?: unknown
    acknowledgedAt?: unknown
  }[]
  return (asArray(event.reconSectorPosts) as PostProjection[]).map((post) => {
    const postId = asString(post.id)
    const own = assignments.filter((assignment) => asString(assignment.postId) === postId)
    return {
      postId,
      sectorLabel: asString(post.sector),
      sourceSectorId: typeof post.sourceSectorId === 'string' ? post.sourceSectorId : null,
      postLabel: asString(post.post),
      need: asNumber(post.need),
      assigned: own.length,
      // Ознакомление — СВОЙ счёт, а не доля от назначенных: §22.15 запрещает
      // смешивать назначенное с подтверждённым.
      acknowledged: own.filter((assignment) => typeof assignment.acknowledgedAt === 'string')
        .length,
    }
  })
}

/**
 * §22.14: журнал переходов. Читается ОТДЕЛЬНО от карточек — воронка обязана
 * строиться по нему, и передавать сюда события вместе с карточками значило бы
 * позволить перепутать источники.
 *
 * `null` — журнала нет вовсе (снапшот старой схемы); пустой массив — журнал
 * есть и он пуст. Разница видна на экране: «истории нет» и «переходов не
 * было» — разные утверждения.
 */
export function readOperationsTransitions(
  slices: Readonly<Record<string, unknown>>,
): OpsSourceTransition[] | null {
  const slice = slices[SECURITY_EVENTS_SLICE_NAME]
  if (slice === undefined || slice === null || typeof slice !== 'object') return null
  const raw = (slice as { transitions?: unknown }).transitions
  if (!Array.isArray(raw)) return null

  return (raw as Record<string, unknown>[]).map((transition) => ({
    eventId: asString(transition.eventId),
    fromStage: typeof transition.fromStage === 'string' ? transition.fromStage : null,
    toStage: asString(transition.toStage),
    kind: transition.kind === 'RETURN' ? ('RETURN' as const) : ('FORWARD' as const),
    occurredAt: asString(transition.occurredAt),
  }))
}

/**
 * `null`, а НЕ пустой массив, когда слайса нет — та же причина, что у
 * проекции дежурств: пустой массив означает «мероприятий нет» и даёт честный
 * ноль, отсутствие источника означает «посчитать не удалось».
 */
export function readOperationsSource(
  slices: Readonly<Record<string, unknown>>,
): OpsSourceEvent[] | null {
  const slice = slices[SECURITY_EVENTS_SLICE_NAME]
  if (slice === undefined || slice === null || typeof slice !== 'object') return null
  const rawEvents = (slice as { events?: unknown }).events
  if (!Array.isArray(rawEvents)) return null

  return (rawEvents as EventProjection[]).map((event) => {
    const forceRequests = asArray(event.forceRequests) as {
      requestedCount?: unknown
      allocatedCount?: unknown
    }[]
    const journal = asArray(event.journalEntries) as { type?: unknown }[]
    return {
      id: asString(event.id),
      code: asString(event.code),
      title: asString(event.title),
      objectId: typeof event.objectId === 'string' ? event.objectId : null,
      objectName: asString(event.objectName),
      businessDate: asString(event.businessDate),
      stageCode: asString(event.stage),
      readinessPercent:
        typeof event.readinessPercent === 'number' ? event.readinessPercent : null,
      conflictsCount: asNumber(event.conflictsCount),
      demandApproved: event.demandApproved === true,
      demandNeedTotal: (asArray(event.demandRows) as { need?: unknown }[]).reduce(
        (total, row) => total + asNumber(row.need),
        0,
      ),
      requestedTotal: forceRequests.reduce(
        (total, request) => total + asNumber(request.requestedCount),
        0,
      ),
      allocatedTotal: forceRequests.reduce(
        (total, request) => total + asNumber(request.allocatedCount),
        0,
      ),
      incidentsCount: journal.filter((entry) => entry.type === 'INCIDENT').length,
      closedAt: typeof event.closedAt === 'string' ? event.closedAt : null,
      posts: buildPosts(event),
    }
  })
}
