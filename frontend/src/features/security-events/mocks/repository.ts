// Feature repository (§8.5): server-like validation, permission/scope,
// уникальность, атомарная мутация, серверный read model. НЕ React, НЕ
// TanStack Query. Операции предметной области (`listSecurityEvents`,
// `createSecurityEvent`), а не generic `create(table, payload)` (запрет §8.5).
import type { DemoClock } from '../../../shared/testing/mock-runtime/demo-clock'
import { hasPermission } from '../../../shared/testing/mock-runtime/rbac-directory'
import type {
  DemoStateEnvelope,
  PersistenceAdapter,
} from '../../../shared/testing/mock-runtime/persistence'
import { runMutation } from '../../../shared/testing/mock-runtime/transaction'
import type {
  AddJournalEntryRequest,
  AssignPlacementRequest,
  CloseSecurityEventRequest,
  CreateSecurityEventRequest,
  ListBindableObjectsResponse,
  ListSecurityEventsParams,
  ListSecurityEventsResponse,
  ReplaceAssignmentRequest,
  ReturnPlacementRequest,
  SecurityEventPassportView,
  UpdateDemandRequest,
  UpdateForceAllocationRequest,
  UpdateReconRequest,
} from '../api/pending-contracts'
import type {
  ForceRequest,
  JournalEntry,
  PlacementAssignment,
  ReconChecklistItem,
  ReconSectorPost,
  SecurityEvent,
  StaffingDemandRow,
} from '../model/types'
import type { SecurityObjectProjection } from '../lib/passportBinding'
import {
  NO_PUBLISHED_VERSION_TEXT,
  bindPassportVersion,
  isBindingStale,
  resolveApplicableVersion,
} from '../lib/passportBinding'
import { RECON_CHECKLIST_TEMPLATE } from './fixtures'
import type { SecurityEventsSlice } from './fixtures'
import { findObjectById, readObjectsProjection } from './objectsSlice'
import { STAGE_ORDER } from '../lib/stageMeta'
import { aggregateForceRequests } from './demandLogic'
import { findPersonnel } from './personnelRoster'

export class RepositoryPermissionError extends Error {}
export class RepositoryNotFoundError extends Error {}
export class RepositoryValidationError extends Error {
  readonly fieldErrors: Record<string, string[]>
  constructor(fieldErrors: Record<string, string[]>) {
    super('validation')
    this.fieldErrors = fieldErrors
  }
}
/** 422: бизнес-правило нарушено (не форма) — например, завершение рекогносцировки без выполненного чек-листа. */
export class RepositoryBusinessRuleError extends Error {
  readonly errorCode: string
  constructor(errorCode: string, message: string) {
    super(message)
    this.errorCode = errorCode
  }
}

const SLICE_NAME = 'security-events'
const VIEW_PERMISSION = 'ops.security_event.view'
const CREATE_PERMISSION = 'ops.security_event.create'
const BULLETIN_PERMISSION = 'ops.bulletin.manage'
const RECON_PERMISSION = 'ops.recon.manage'
const DEMAND_PERMISSION = 'ops.demand.manage'
const FORCE_ALLOCATION_PERMISSION = 'ops.force_allocation.manage'
const PLACEMENT_MANAGE_PERMISSION = 'ops.placement.manage'
const PLACEMENT_APPROVE_PERMISSION = 'ops.placement.approve'
const ACKNOWLEDGEMENT_PERMISSION = 'ops.acknowledgement.manage'
const CONDUCT_PERMISSION = 'ops.conduct.manage'
const CLOSURE_PERMISSION = 'ops.closure.manage'

function readSlice(envelope: DemoStateEnvelope): SecurityEventsSlice {
  const slice = envelope.slices[SLICE_NAME]
  // Слайс отсутствует только если compose-seed не зарегистрировал builder —
  // программная ошибка конфигурации, а не штатный «пусто» (тот кодируется
  // events: []). Кидаем громко, а не молча возвращаем [] — тихий пропуск
  // спрятал бы пропущенную регистрацию FeatureSeedBuilder.
  if (slice === undefined) {
    throw new Error(
      `mock-runtime: слайс "${SLICE_NAME}" не засеян — проверь app/mocks/compose-seed.ts`,
    )
  }
  return slice as SecurityEventsSlice
}

/**
 * Сколько постов привязанной версии ещё НЕ в расчёте — ровно то число, что
 * покажет кнопка импорта. Считается на чтении, а не хранится: расчёт правят
 * вручную, и хранимый счётчик разъехался бы с реальностью.
 */
function countImportablePosts(
  event: SecurityEvent,
  object: SecurityObjectProjection | null,
  versionId: string,
): number {
  const version = object?.passportVersions.find((v) => v.id === versionId) ?? null
  if (version === null) {
    return 0
  }
  const alreadyImported = new Set(
    event.reconSectorPosts
      .map((row) => row.sourcePostId)
      .filter((sourcePostId): sourcePostId is string => sourcePostId !== null),
  )
  return version.sectors
    .flatMap((sector) => sector.posts)
    .filter((post) => !alreadyImported.has(post.id)).length
}

export function createSecurityEventsRepository(
  adapter: PersistenceAdapter,
  clock: DemoClock,
) {
  /**
   * ЕДИНСТВЕННАЯ точка, где слайс ОМ уходит в снапшот, и единственное место,
   * где пишется журнал переходов §22.14.
   *
   * Журнал пишется ДИФФОМ: сравниваются стадии «до» и «после». Ручная запись
   * на каждом переходе означала бы девять мест, где её можно забыть, — а
   * забытый переход не сломал бы ни одного теста стадий и молча исказил бы
   * конверсию. При таком устройстве новая операция, меняющая стадию, попадает
   * в журнал сама, ничего не зная о нём.
   */
  function commitEvents(
    current: DemoStateEnvelope,
    nextEvents: SecurityEvent[],
  ): DemoStateEnvelope['slices'] {
    const previous = readSlice(current)
    const before = new Map(previous.events.map((event) => [event.id, event.stage]))
    const transitions = [...(previous.transitions ?? [])]
    const now = clock.now()

    for (const event of nextEvents) {
      const fromStage = before.get(event.id) ?? null
      // Создание тоже переход: до него стадии не было, и §22.14 считает
      // «достигших этапа» в том числе на первом.
      if (before.has(event.id) && fromStage === event.stage) continue
      transitions.push({
        id: `security-event-transition-${current.revision + 1}-${transitions.length + 1}`,
        eventId: event.id,
        fromStage,
        toStage: event.stage,
        kind:
          fromStage !== null &&
          STAGE_ORDER.indexOf(event.stage) < STAGE_ORDER.indexOf(fromStage)
            ? 'RETURN'
            : 'FORWARD',
        occurredAt: now,
      })
    }

    return {
      ...current.slices,
      // Журнал APPEND-ONLY: старые записи переносятся как есть, новые
      // дописываются в конец. Ни одна операция их не правит и не удаляет.
      [SLICE_NAME]: { events: nextEvents, transitions } satisfies SecurityEventsSlice,
    }
  }

  async function list(
    params: ListSecurityEventsParams,
    actorUserId: string | null,
  ): Promise<ListSecurityEventsResponse> {
    if (!hasPermission(actorUserId, VIEW_PERMISSION)) {
      throw new RepositoryPermissionError(VIEW_PERMISSION)
    }
    const envelope = await adapter.load()
    const events = envelope === null ? [] : readSlice(envelope).events

    const search = params.search.trim().toLowerCase()
    const filtered = events.filter((e) => {
      const matchesStage = params.stage === 'ALL' || e.stage === params.stage
      const matchesSearch =
        search === '' ||
        e.title.toLowerCase().includes(search) ||
        e.objectName.toLowerCase().includes(search) ||
        e.ownerName.toLowerCase().includes(search)
      return matchesStage && matchesSearch
    })
    // Устойчивый tie-breaker: businessDate, затем id (§8.8) — не порядок вставки.
    const sorted = [...filtered].sort(
      (a, b) =>
        a.businessDate.localeCompare(b.businessDate) || a.id.localeCompare(b.id),
    )

    const start = (params.page - 1) * params.pageSize
    const pageItems = sorted.slice(start, start + params.pageSize)
    const base = `page_size=${params.pageSize}`
    const hasNext = start + params.pageSize < sorted.length
    const hasPrev = params.page > 1

    return {
      count: sorted.length,
      next: hasNext ? `?page=${params.page + 1}&${base}` : null,
      previous: hasPrev ? `?page=${params.page - 1}&${base}` : null,
      results: pageItems,
    }
  }

  async function get(
    id: string,
    actorUserId: string | null,
  ): Promise<SecurityEvent> {
    if (!hasPermission(actorUserId, VIEW_PERMISSION)) {
      throw new RepositoryPermissionError(VIEW_PERMISSION)
    }
    const envelope = await adapter.load()
    const events = envelope === null ? [] : readSlice(envelope).events
    const found = events.find((e) => e.id === id)
    if (found === undefined) {
      throw new RepositoryNotFoundError(id)
    }
    return found
  }

  /**
   * Объекты, доступные для привязки нового ОМ (§9.6). Собственный узкий read
   * model, а не переиспользование `features/objects` — кросс-фичевый импорт
   * красный по ARCH-FE-013, а форма создания ОМ живёт здесь. Дублируется
   * ровно то, что нужно выпадающему списку.
   */
  async function listBindableObjects(
    actorUserId: string | null,
  ): Promise<ListBindableObjectsResponse> {
    if (!hasPermission(actorUserId, VIEW_PERMISSION)) {
      throw new RepositoryPermissionError(VIEW_PERMISSION)
    }
    const envelope = await adapter.load()
    const objects = envelope === null ? [] : readObjectsProjection(envelope.slices)
    const results = [...objects]
      .sort((a, b) => a.code.localeCompare(b.code))
      .map((object) => ({
        id: object.id,
        name: object.name,
        code: object.code,
        publishedVersionCount: object.passportVersions.length,
      }))
    return { results }
  }

  /**
   * Производный (НЕ хранимый) взгляд на привязку: сам снимок лежит в ОМ, а
   * «какая версия действует ПРЯМО СЕЙЧАС» пересчитывается на каждом чтении.
   * Хранить `stale` было бы ошибкой: публикация новой версии паспорта не
   * трогает ОМ (§9.6), и хранимый флаг молча устарел бы.
   */
  async function getPassportView(
    id: string,
    actorUserId: string | null,
  ): Promise<SecurityEventPassportView> {
    if (!hasPermission(actorUserId, VIEW_PERMISSION)) {
      throw new RepositoryPermissionError(VIEW_PERMISSION)
    }
    const envelope = await adapter.load()
    const events = envelope === null ? [] : readSlice(envelope).events
    const event = events.find((e) => e.id === id)
    if (event === undefined) {
      throw new RepositoryNotFoundError(id)
    }
    const object =
      envelope === null || event.objectId === null
        ? null
        : findObjectById(envelope.slices, event.objectId)
    const applicable =
      object === null ? null : resolveApplicableVersion(object, event.businessDate)
    return {
      objectId: event.objectId,
      objectKnown: object !== null,
      binding: event.passportBinding,
      applicableVersionId: applicable?.id ?? null,
      applicableVersionNumber: applicable?.versionNumber ?? null,
      stale:
        event.passportBinding === null
          ? false
          : isBindingStale(event.passportBinding, applicable),
      importablePostCount:
        event.passportBinding === null
          ? 0
          : countImportablePosts(event, object, event.passportBinding.versionId),
    }
  }

  async function create(
    request: CreateSecurityEventRequest,
    actorUserId: string | null,
  ): Promise<SecurityEvent> {
    if (!hasPermission(actorUserId, CREATE_PERMISSION)) {
      throw new RepositoryPermissionError(CREATE_PERMISSION)
    }
    const fieldErrors: Record<string, string[]> = {}
    if (request.title.trim() === '') {
      fieldErrors.title = ['Обязательное поле.']
    }
    if (request.objectId.trim() === '') {
      fieldErrors.objectId = ['Обязательное поле.']
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(request.businessDate)) {
      fieldErrors.businessDate = ['Укажите дату в формате ГГГГ-ММ-ДД.']
    }
    if (Object.keys(fieldErrors).length > 0) {
      throw new RepositoryValidationError(fieldErrors)
    }

    let created!: SecurityEvent
    await runMutation(adapter, clock, (current) => {
      const slice = readSlice(current)
      const now = clock.now()
      // Объект резолвится ВНУТРИ мутации: между валидацией и записью объект
      // мог исчезнуть, а ОМ с битой ссылкой на объект — хуже отказа.
      const object = findObjectById(current.slices, request.objectId)
      if (object === null) {
        throw new RepositoryValidationError({ objectId: ['Объект не найден в реестре.'] })
      }
      // §9.6: версия выбирается по бизнес-дате ОМ. Её отсутствие — НЕ ошибка
      // создания: мероприятие на объекте без опубликованного паспорта вести
      // можно, просто расчёт постов будет ручным (карточка скажет об этом).
      const applicableVersion = resolveApplicableVersion(object, request.businessDate)
      const id = `security-event-${current.revision + 1}-${slice.events.length + 1}`
      created = {
        id,
        code: `ОМ-${request.businessDate.slice(0, 4)}-${slice.events.length + 1}`,
        title: request.title.trim(),
        objectId: object.id,
        objectName: object.name,
        passportBinding:
          applicableVersion === null
            ? null
            : bindPassportVersion(object, applicableVersion, now),
        businessDate: request.businessDate,
        stage: 'BULLETIN',
        readinessPercent: 0,
        forceNeed: 0,
        conflictsCount: 0,
        ownerName: actorUserId ?? 'demo',
        briefDescription: '',
        initialTasks: '',
        reconChecklist: RECON_CHECKLIST_TEMPLATE.map((label, index) => ({
          id: `${id}-checklist-${index}`,
          label,
          done: false,
          result: null,
          comment: '',
        })),
        reconSectorPosts: [],
        demandRows: [],
        demandApproved: false,
        forceRequests: [],
        placementAssignments: [],
        approvalStatus: 'PENDING',
        approvalComment: '',
        journalEntries: [],
        closureDirectionSummaries: [],
        closedAt: null,
        createdAt: now,
        updatedAt: now,
      }
      return commitEvents(current, [...slice.events, created])
    })
    return created
  }

  async function updateBulletin(
    id: string,
    request: { briefDescription: string; initialTasks: string },
    actorUserId: string | null,
  ): Promise<SecurityEvent> {
    if (!hasPermission(actorUserId, BULLETIN_PERMISSION)) {
      throw new RepositoryPermissionError(BULLETIN_PERMISSION)
    }
    const fieldErrors: Record<string, string[]> = {}
    if (request.briefDescription.trim() === '') {
      fieldErrors.briefDescription = ['Обязательное поле.']
    }
    if (request.initialTasks.trim() === '') {
      fieldErrors.initialTasks = ['Обязательное поле.']
    }
    if (Object.keys(fieldErrors).length > 0) {
      throw new RepositoryValidationError(fieldErrors)
    }

    let updated!: SecurityEvent
    await runMutation(adapter, clock, (current) => {
      const slice = readSlice(current)
      const existing = slice.events.find((e) => e.id === id)
      if (existing === undefined) {
        throw new RepositoryNotFoundError(id)
      }
      updated = {
        ...existing,
        briefDescription: request.briefDescription.trim(),
        initialTasks: request.initialTasks.trim(),
        updatedAt: clock.now(),
      }
      return commitEvents(
        current,
        slice.events.map((e) => (e.id === id ? updated : e)),
      )
    })
    return updated
  }

  async function updateRecon(
    id: string,
    request: UpdateReconRequest,
    actorUserId: string | null,
  ): Promise<SecurityEvent> {
    if (!hasPermission(actorUserId, RECON_PERMISSION)) {
      throw new RepositoryPermissionError(RECON_PERMISSION)
    }
    const fieldErrors: Record<string, string[]> = {}
    request.checklist.forEach((item, index) => {
      if (item.result === 'NEEDS_CHANGES' && item.comment.trim() === '') {
        fieldErrors[`checklist.${index}.comment`] = ['Укажите комментарий.']
      }
    })
    request.sectorPosts.forEach((row, index) => {
      if (row.sector.trim() === '') fieldErrors[`sectorPosts.${index}.sector`] = ['Обязательное поле.']
      if (row.post.trim() === '') fieldErrors[`sectorPosts.${index}.post`] = ['Обязательное поле.']
      if (row.need < 1) fieldErrors[`sectorPosts.${index}.need`] = ['Должно быть не меньше 1.']
    })
    if (Object.keys(fieldErrors).length > 0) {
      throw new RepositoryValidationError(fieldErrors)
    }

    let updated!: SecurityEvent
    await runMutation(adapter, clock, (current) => {
      const slice = readSlice(current)
      const existing = slice.events.find((e) => e.id === id)
      if (existing === undefined) {
        throw new RepositoryNotFoundError(id)
      }
      const checklist: ReconChecklistItem[] = request.checklist.map((item) => ({
        ...item,
        comment: item.comment.trim(),
      }))
      const sectorPosts: ReconSectorPost[] = request.sectorPosts.map((row) => ({
        ...row,
        sector: row.sector.trim(),
        post: row.post.trim(),
        task: row.task.trim(),
        requirements: row.requirements.trim(),
        comment: row.comment.trim(),
      }))
      updated = {
        ...existing,
        reconChecklist: checklist,
        reconSectorPosts: sectorPosts,
        updatedAt: clock.now(),
      }
      return commitEvents(
        current,
        slice.events.map((e) => (e.id === id ? updated : e)),
      )
    })
    return updated
  }

  /**
   * §9.6 «рекогносцировка может создать event-specific расчёт на основе
   * паспорта». Импорт ДОБАВЛЯЕТ строки, а не заменяет расчёт: уже заведённые
   * руками посты — тоже решение человека, затирать их операцией «подтянуть из
   * паспорта» было бы потерей работы. Повторный импорт не плодит дубли —
   * пост, уже пришедший из этой версии, пропускается.
   */
  async function importReconPostsFromPassport(
    id: string,
    actorUserId: string | null,
  ): Promise<SecurityEvent> {
    if (!hasPermission(actorUserId, RECON_PERMISSION)) {
      throw new RepositoryPermissionError(RECON_PERMISSION)
    }
    let updated!: SecurityEvent
    await runMutation(adapter, clock, (current) => {
      const slice = readSlice(current)
      const existing = slice.events.find((e) => e.id === id)
      if (existing === undefined) {
        throw new RepositoryNotFoundError(id)
      }
      if (existing.stage !== 'RECON') {
        throw new RepositoryBusinessRuleError(
          'RECON_STAGE_REQUIRED',
          'Расчёт постов формируется на этапе рекогносцировки.',
        )
      }
      const binding = existing.passportBinding
      if (binding === null) {
        throw new RepositoryBusinessRuleError('NO_PASSPORT_VERSION', NO_PUBLISHED_VERSION_TEXT)
      }
      const object = findObjectById(current.slices, binding.objectId)
      const version = object?.passportVersions.find((v) => v.id === binding.versionId) ?? null
      if (version === null) {
        throw new RepositoryBusinessRuleError(
          'PASSPORT_VERSION_NOT_FOUND',
          'Привязанная версия паспорта недоступна — обратитесь к владельцу объекта.',
        )
      }
      const alreadyImported = new Set(
        existing.reconSectorPosts
          .map((row) => row.sourcePostId)
          .filter((sourcePostId): sourcePostId is string => sourcePostId !== null),
      )
      const now = clock.now()
      let counter = 0
      const added: ReconSectorPost[] = []
      for (const sector of version.sectors) {
        for (const post of sector.posts) {
          if (alreadyImported.has(post.id)) {
            continue
          }
          counter += 1
          added.push({
            id: `${id}-imported-${now}-${counter}`,
            sector: sector.name,
            post: post.name,
            task: post.task,
            // Паспорт описывает ПОСТ, а не численность на конкретное
            // мероприятие: 1 — минимально допустимое значение расчёта, его и
            // уточняет старший наряда. Подставить сюда выдуманное число
            // означало бы сочинить потребность за человека (§35).
            need: 1,
            requirements: post.requirements,
            result: null,
            comment: '',
            sourceSectorId: sector.id,
            sourcePostId: post.id,
          })
        }
      }
      if (added.length === 0) {
        throw new RepositoryBusinessRuleError(
          'NOTHING_TO_IMPORT',
          'Все посты этой версии паспорта уже в расчёте.',
        )
      }
      updated = {
        ...existing,
        reconSectorPosts: [...existing.reconSectorPosts, ...added],
        updatedAt: now,
      }
      return commitEvents(
        current,
        slice.events.map((e) => (e.id === id ? updated : e)),
      )
    })
    return updated
  }

  async function completeRecon(
    id: string,
    actorUserId: string | null,
  ): Promise<SecurityEvent> {
    if (!hasPermission(actorUserId, RECON_PERMISSION)) {
      throw new RepositoryPermissionError(RECON_PERMISSION)
    }

    let updated!: SecurityEvent
    await runMutation(adapter, clock, (current) => {
      const slice = readSlice(current)
      const existing = slice.events.find((e) => e.id === id)
      if (existing === undefined) {
        throw new RepositoryNotFoundError(id)
      }
      if (existing.stage !== 'RECON') {
        throw new RepositoryBusinessRuleError(
          'INVALID_STAGE_TRANSITION',
          'Рекогносцировку можно завершить только на этапе «Рекогносцировка».',
        )
      }
      if (!existing.reconChecklist.every((item) => item.done)) {
        throw new RepositoryBusinessRuleError(
          'RECON_CHECKLIST_INCOMPLETE',
          'Не все пункты чек-листа отмечены выполненными.',
        )
      }
      if (existing.reconSectorPosts.length === 0) {
        throw new RepositoryBusinessRuleError(
          'RECON_SECTOR_POSTS_EMPTY',
          'Добавьте хотя бы один пост, прежде чем завершать этап.',
        )
      }
      updated = { ...existing, stage: 'DEMAND', updatedAt: clock.now() }
      return commitEvents(
        current,
        slice.events.map((e) => (e.id === id ? updated : e)),
      )
    })
    return updated
  }

  /**
   * Сохранение и утверждение потребности — ОДНА атомарная операция (прототип
   * не даёт отдельного «просто сохранить» действия для секции 1 — только
   * «Сохранить и утвердить потребность»). Валидирует строки, сохраняет их,
   * агрегирует в `forceRequests` по группам и переводит DEMAND→FORCES —
   * без промежуточного состояния «сохранено, но не утверждено».
   */
  async function approveDemand(
    id: string,
    request: UpdateDemandRequest,
    actorUserId: string | null,
  ): Promise<SecurityEvent> {
    if (!hasPermission(actorUserId, DEMAND_PERMISSION)) {
      throw new RepositoryPermissionError(DEMAND_PERMISSION)
    }
    const fieldErrors: Record<string, string[]> = {}
    request.rows.forEach((row, index) => {
      if (row.sector.trim() === '') fieldErrors[`rows.${index}.sector`] = ['Обязательное поле.']
      if (row.task.trim() === '') fieldErrors[`rows.${index}.task`] = ['Обязательное поле.']
      if (row.group.trim() === '') fieldErrors[`rows.${index}.group`] = ['Выберите группу.']
      if (row.need < 1) fieldErrors[`rows.${index}.need`] = ['Должно быть не меньше 1.']
    })
    if (Object.keys(fieldErrors).length > 0) {
      throw new RepositoryValidationError(fieldErrors)
    }
    if (request.rows.length === 0) {
      throw new RepositoryBusinessRuleError(
        'DEMAND_ROWS_EMPTY',
        'Добавьте хотя бы одну строку потребности.',
      )
    }

    let updated!: SecurityEvent
    await runMutation(adapter, clock, (current) => {
      const slice = readSlice(current)
      const existing = slice.events.find((e) => e.id === id)
      if (existing === undefined) {
        throw new RepositoryNotFoundError(id)
      }
      if (existing.stage !== 'DEMAND') {
        throw new RepositoryBusinessRuleError(
          'INVALID_STAGE_TRANSITION',
          'Потребность можно утвердить только на этапе «Потребность».',
        )
      }
      const rows: StaffingDemandRow[] = request.rows.map((row) => ({
        ...row,
        sector: row.sector.trim(),
        task: row.task.trim(),
        shift: row.shift.trim(),
        group: row.group.trim(),
        requirements: row.requirements.trim(),
        comment: row.comment.trim(),
      }))
      const forceRequests = aggregateForceRequests(
        rows,
        (group, index) => `${id}-force-request-${index}-${group}`,
      )
      updated = {
        ...existing,
        demandRows: rows,
        demandApproved: true,
        forceRequests,
        stage: 'FORCES',
        updatedAt: clock.now(),
      }
      return commitEvents(
        current,
        slice.events.map((e) => (e.id === id ? updated : e)),
      )
    })
    return updated
  }

  async function updateForceAllocation(
    id: string,
    requestId: string,
    request: UpdateForceAllocationRequest,
    actorUserId: string | null,
  ): Promise<SecurityEvent> {
    if (!hasPermission(actorUserId, FORCE_ALLOCATION_PERMISSION)) {
      throw new RepositoryPermissionError(FORCE_ALLOCATION_PERMISSION)
    }
    if (request.allocatedCount < 0) {
      throw new RepositoryValidationError({
        allocatedCount: ['Не может быть отрицательным.'],
      })
    }

    let updated!: SecurityEvent
    await runMutation(adapter, clock, (current) => {
      const slice = readSlice(current)
      const existing = slice.events.find((e) => e.id === id)
      if (existing === undefined) {
        throw new RepositoryNotFoundError(id)
      }
      const target = existing.forceRequests.find((r) => r.id === requestId)
      if (target === undefined) {
        throw new RepositoryNotFoundError(requestId)
      }
      const forceRequests: ForceRequest[] = existing.forceRequests.map((r) => {
        if (r.id !== requestId) return r
        const allocatedCount = request.allocatedCount
        const status: ForceRequest['status'] =
          allocatedCount === 0
            ? 'SENT'
            : allocatedCount < r.requestedCount
              ? 'PARTIALLY_ALLOCATED'
              : 'ALLOCATED'
        return { ...r, allocatedCount, status, comment: request.comment.trim() }
      })
      updated = { ...existing, forceRequests, updatedAt: clock.now() }
      return commitEvents(
        current,
        slice.events.map((e) => (e.id === id ? updated : e)),
      )
    })
    return updated
  }

  async function completeForces(
    id: string,
    actorUserId: string | null,
  ): Promise<SecurityEvent> {
    if (!hasPermission(actorUserId, FORCE_ALLOCATION_PERMISSION)) {
      throw new RepositoryPermissionError(FORCE_ALLOCATION_PERMISSION)
    }

    let updated!: SecurityEvent
    await runMutation(adapter, clock, (current) => {
      const slice = readSlice(current)
      const existing = slice.events.find((e) => e.id === id)
      if (existing === undefined) {
        throw new RepositoryNotFoundError(id)
      }
      if (existing.stage !== 'FORCES') {
        throw new RepositoryBusinessRuleError(
          'INVALID_STAGE_TRANSITION',
          'Выделение сил можно завершить только на этапе «Запрос сил».',
        )
      }
      if (
        existing.forceRequests.length === 0 ||
        !existing.forceRequests.every((r) => r.allocatedCount >= r.requestedCount)
      ) {
        throw new RepositoryBusinessRuleError(
          'FORCE_ALLOCATION_INCOMPLETE',
          'Не все запросы полностью выделены.',
        )
      }
      updated = { ...existing, stage: 'PLACEMENT', updatedAt: clock.now() }
      return commitEvents(
        current,
        slice.events.map((e) => (e.id === id ? updated : e)),
      )
    })
    return updated
  }

  /**
   * Назначает сотрудника на пост. Единственное реализованное правило
   * конфликтов Этапа 2: сотрудник не может занимать ДВА поста ОДНОГО ОМ
   * одновременно (hard, без override). Межсобытийные конфликты (другой ОМ в
   * то же время), отдых, усталость — Epic 16.3, Not started (см.
   * FRONTEND_DECISIONS: PersonnelAvailabilitySnapshot не подключён).
   */
  async function assignPlacement(
    id: string,
    request: AssignPlacementRequest,
    actorUserId: string | null,
  ): Promise<SecurityEvent> {
    if (!hasPermission(actorUserId, PLACEMENT_MANAGE_PERMISSION)) {
      throw new RepositoryPermissionError(PLACEMENT_MANAGE_PERMISSION)
    }
    const employee = findPersonnel(request.employeeId)
    if (employee === undefined) {
      throw new RepositoryValidationError({
        employeeId: ['Сотрудник не найден.'],
      })
    }

    let updated!: SecurityEvent
    await runMutation(adapter, clock, (current) => {
      const slice = readSlice(current)
      const existing = slice.events.find((e) => e.id === id)
      if (existing === undefined) {
        throw new RepositoryNotFoundError(id)
      }
      if (existing.reconSectorPosts.every((p) => p.id !== request.postId)) {
        throw new RepositoryNotFoundError(request.postId)
      }
      const alreadyOnAnotherPost = existing.placementAssignments.some(
        (a) => a.employeeId === request.employeeId && a.postId !== request.postId,
      )
      if (alreadyOnAnotherPost) {
        throw new RepositoryBusinessRuleError(
          'DOUBLE_ASSIGNMENT',
          `${employee.name} уже назначен(а) на другой пост этого мероприятия.`,
        )
      }
      const assignment: PlacementAssignment = {
        id: `${id}-assignment-${existing.placementAssignments.length + 1}`,
        postId: request.postId,
        employeeId: request.employeeId,
        employeeName: employee.name,
        acknowledgedAt: null,
      }
      updated = {
        ...existing,
        placementAssignments: [...existing.placementAssignments, assignment],
        updatedAt: clock.now(),
      }
      return commitEvents(
        current,
        slice.events.map((e) => (e.id === id ? updated : e)),
      )
    })
    return updated
  }

  async function unassignPlacement(
    id: string,
    assignmentId: string,
    actorUserId: string | null,
  ): Promise<SecurityEvent> {
    if (!hasPermission(actorUserId, PLACEMENT_MANAGE_PERMISSION)) {
      throw new RepositoryPermissionError(PLACEMENT_MANAGE_PERMISSION)
    }

    let updated!: SecurityEvent
    await runMutation(adapter, clock, (current) => {
      const slice = readSlice(current)
      const existing = slice.events.find((e) => e.id === id)
      if (existing === undefined) {
        throw new RepositoryNotFoundError(id)
      }
      updated = {
        ...existing,
        placementAssignments: existing.placementAssignments.filter(
          (a) => a.id !== assignmentId,
        ),
        updatedAt: clock.now(),
      }
      return commitEvents(
        current,
        slice.events.map((e) => (e.id === id ? updated : e)),
      )
    })
    return updated
  }

  /**
   * Упрощённое правило Этапа 2: пост укомплектован при ХОТЯ БЫ ОДНОМ
   * назначении (не точное совпадение с `need`) — полноценный расчёт
   * дефицита требует reconSectorPosts.need, но демо-ростер намеренно мал
   * (8 чел., см. personnelRoster.ts), точный подсчёт был бы нечестной
   * демонстрацией. Точное совпадение — Epic 16, Not started.
   */
  async function completePlacement(
    id: string,
    actorUserId: string | null,
  ): Promise<SecurityEvent> {
    if (!hasPermission(actorUserId, PLACEMENT_MANAGE_PERMISSION)) {
      throw new RepositoryPermissionError(PLACEMENT_MANAGE_PERMISSION)
    }

    let updated!: SecurityEvent
    await runMutation(adapter, clock, (current) => {
      const slice = readSlice(current)
      const existing = slice.events.find((e) => e.id === id)
      if (existing === undefined) {
        throw new RepositoryNotFoundError(id)
      }
      if (existing.stage !== 'PLACEMENT') {
        throw new RepositoryBusinessRuleError(
          'INVALID_STAGE_TRANSITION',
          'Расстановку можно завершить только на этапе «Расстановка».',
        )
      }
      const assignedPostIds = new Set(existing.placementAssignments.map((a) => a.postId))
      const unstaffed = existing.reconSectorPosts.filter((p) => !assignedPostIds.has(p.id))
      if (existing.reconSectorPosts.length === 0 || unstaffed.length > 0) {
        throw new RepositoryBusinessRuleError(
          'PLACEMENT_INCOMPLETE',
          'Не все посты укомплектованы.',
        )
      }
      updated = { ...existing, stage: 'APPROVAL', updatedAt: clock.now() }
      return commitEvents(
        current,
        slice.events.map((e) => (e.id === id ? updated : e)),
      )
    })
    return updated
  }

  async function approvePlacement(
    id: string,
    actorUserId: string | null,
  ): Promise<SecurityEvent> {
    if (!hasPermission(actorUserId, PLACEMENT_APPROVE_PERMISSION)) {
      throw new RepositoryPermissionError(PLACEMENT_APPROVE_PERMISSION)
    }

    let updated!: SecurityEvent
    await runMutation(adapter, clock, (current) => {
      const slice = readSlice(current)
      const existing = slice.events.find((e) => e.id === id)
      if (existing === undefined) {
        throw new RepositoryNotFoundError(id)
      }
      if (existing.stage !== 'APPROVAL') {
        throw new RepositoryBusinessRuleError(
          'INVALID_STAGE_TRANSITION',
          'Согласовать расстановку можно только на этапе «Согласование».',
        )
      }
      updated = {
        ...existing,
        // Утверждение сразу открывает «Ознакомление» — следующий шаг
        // жизненного цикла (Epic 16.4→16.6), без отдельного клика.
        stage: 'ACKNOWLEDGEMENT',
        approvalStatus: 'APPROVED',
        approvalComment: '',
        updatedAt: clock.now(),
      }
      return commitEvents(
        current,
        slice.events.map((e) => (e.id === id ? updated : e)),
      )
    })
    return updated
  }

  /** Возврат на доработку: расстановка НЕ утверждена, стадия откатывается на PLACEMENT — причина обязательна (аудит). */
  async function returnPlacement(
    id: string,
    request: ReturnPlacementRequest,
    actorUserId: string | null,
  ): Promise<SecurityEvent> {
    if (!hasPermission(actorUserId, PLACEMENT_APPROVE_PERMISSION)) {
      throw new RepositoryPermissionError(PLACEMENT_APPROVE_PERMISSION)
    }
    if (request.comment.trim() === '') {
      throw new RepositoryValidationError({ comment: ['Укажите причину возврата.'] })
    }

    let updated!: SecurityEvent
    await runMutation(adapter, clock, (current) => {
      const slice = readSlice(current)
      const existing = slice.events.find((e) => e.id === id)
      if (existing === undefined) {
        throw new RepositoryNotFoundError(id)
      }
      if (existing.stage !== 'APPROVAL') {
        throw new RepositoryBusinessRuleError(
          'INVALID_STAGE_TRANSITION',
          'Вернуть на доработку можно только на этапе «Согласование».',
        )
      }
      updated = {
        ...existing,
        stage: 'PLACEMENT',
        approvalStatus: 'RETURNED',
        approvalComment: request.comment.trim(),
        updatedAt: clock.now(),
      }
      return commitEvents(
        current,
        slice.events.map((e) => (e.id === id ? updated : e)),
      )
    })
    return updated
  }

  /** Подтверждение прочтения назначения (Smart Josparlau.dc.html:1136-1140 «✓ Ознакомлен»). */
  async function acknowledgePlacement(
    id: string,
    assignmentId: string,
    actorUserId: string | null,
  ): Promise<SecurityEvent> {
    if (!hasPermission(actorUserId, ACKNOWLEDGEMENT_PERMISSION)) {
      throw new RepositoryPermissionError(ACKNOWLEDGEMENT_PERMISSION)
    }

    let updated!: SecurityEvent
    await runMutation(adapter, clock, (current) => {
      const slice = readSlice(current)
      const existing = slice.events.find((e) => e.id === id)
      if (existing === undefined) {
        throw new RepositoryNotFoundError(id)
      }
      const target = existing.placementAssignments.find((a) => a.id === assignmentId)
      if (target === undefined) {
        throw new RepositoryNotFoundError(assignmentId)
      }
      updated = {
        ...existing,
        placementAssignments: existing.placementAssignments.map((a) =>
          a.id === assignmentId ? { ...a, acknowledgedAt: clock.now() } : a,
        ),
        updatedAt: clock.now(),
      }
      return commitEvents(
        current,
        slice.events.map((e) => (e.id === id ? updated : e)),
      )
    })
    return updated
  }

  async function completeAcknowledgement(
    id: string,
    actorUserId: string | null,
  ): Promise<SecurityEvent> {
    if (!hasPermission(actorUserId, ACKNOWLEDGEMENT_PERMISSION)) {
      throw new RepositoryPermissionError(ACKNOWLEDGEMENT_PERMISSION)
    }

    let updated!: SecurityEvent
    await runMutation(adapter, clock, (current) => {
      const slice = readSlice(current)
      const existing = slice.events.find((e) => e.id === id)
      if (existing === undefined) {
        throw new RepositoryNotFoundError(id)
      }
      if (existing.stage !== 'ACKNOWLEDGEMENT') {
        throw new RepositoryBusinessRuleError(
          'INVALID_STAGE_TRANSITION',
          'Ознакомление можно завершить только на этапе «Ознакомление».',
        )
      }
      if (!existing.placementAssignments.every((a) => a.acknowledgedAt !== null)) {
        throw new RepositoryBusinessRuleError(
          'ACKNOWLEDGEMENT_INCOMPLETE',
          'Не все назначенные сотрудники подтвердили ознакомление.',
        )
      }
      updated = { ...existing, stage: 'CONDUCT', updatedAt: clock.now() }
      return commitEvents(
        current,
        slice.events.map((e) => (e.id === id ? updated : e)),
      )
    })
    return updated
  }

  /** Журнал штаба (Smart Josparlau.dc.html:1181-1252): инструктаж/указания/инциденты/замены — одна операция добавления записи для всех типов. */
  async function addJournalEntry(
    id: string,
    request: AddJournalEntryRequest,
    actorUserId: string | null,
  ): Promise<SecurityEvent> {
    if (!hasPermission(actorUserId, CONDUCT_PERMISSION)) {
      throw new RepositoryPermissionError(CONDUCT_PERMISSION)
    }
    if (request.title.trim() === '') {
      throw new RepositoryValidationError({ title: ['Обязательное поле.'] })
    }

    let updated!: SecurityEvent
    await runMutation(adapter, clock, (current) => {
      const slice = readSlice(current)
      const existing = slice.events.find((e) => e.id === id)
      if (existing === undefined) {
        throw new RepositoryNotFoundError(id)
      }
      if (existing.stage !== 'CONDUCT') {
        throw new RepositoryBusinessRuleError(
          'INVALID_STAGE_TRANSITION',
          'Журнал штаба доступен только на этапе «Проведение».',
        )
      }
      const entry: JournalEntry = {
        id: `${id}-journal-${existing.journalEntries.length + 1}`,
        type: request.type,
        title: request.title.trim(),
        description: request.description.trim(),
        createdAt: clock.now(),
      }
      updated = {
        ...existing,
        journalEntries: [entry, ...existing.journalEntries],
        updatedAt: clock.now(),
      }
      return commitEvents(
        current,
        slice.events.map((e) => (e.id === id ? updated : e)),
      )
    })
    return updated
  }

  /** §9.11 «Замена выбывшего сотрудника», сокращённо (FRONTEND_DECISIONS
   * A56) — БЕЗ авто-подбора кандидата (алгоритм не утверждён заказчиком,
   * REPLACEMENT-SUGGESTION-001 = business-policy-pending). Одна атомарная
   * мутация: снимает исходное назначение, создаёт новое на ТОТ ЖЕ пост,
   * пишет journal entry типа REPLACEMENT. */
  async function replaceAssignment(
    id: string,
    request: ReplaceAssignmentRequest,
    actorUserId: string | null,
  ): Promise<SecurityEvent> {
    if (!hasPermission(actorUserId, CONDUCT_PERMISSION)) {
      throw new RepositoryPermissionError(CONDUCT_PERMISSION)
    }
    if (request.reasonCode.trim() === '') {
      throw new RepositoryValidationError({ reasonCode: ['Обязательное поле.'] })
    }
    const incomingEmployee = findPersonnel(request.incomingEmployeeId)
    if (incomingEmployee === undefined) {
      throw new RepositoryValidationError({
        incomingEmployeeId: ['Сотрудник не найден.'],
      })
    }

    let updated!: SecurityEvent
    await runMutation(adapter, clock, (current) => {
      const slice = readSlice(current)
      const existing = slice.events.find((e) => e.id === id)
      if (existing === undefined) {
        throw new RepositoryNotFoundError(id)
      }
      if (existing.stage !== 'CONDUCT') {
        throw new RepositoryBusinessRuleError(
          'INVALID_STAGE_TRANSITION',
          'Замена доступна только на этапе «Проведение».',
        )
      }
      const outgoing = existing.placementAssignments.find((a) => a.id === request.assignmentId)
      if (outgoing === undefined) {
        throw new RepositoryNotFoundError(request.assignmentId)
      }
      const alreadyOnAnotherPost = existing.placementAssignments.some(
        (a) => a.employeeId === request.incomingEmployeeId && a.postId !== outgoing.postId,
      )
      if (alreadyOnAnotherPost) {
        throw new RepositoryBusinessRuleError(
          'DOUBLE_ASSIGNMENT',
          `${incomingEmployee.name} уже назначен(а) на другой пост этого мероприятия.`,
        )
      }
      const post = existing.reconSectorPosts.find((p) => p.id === outgoing.postId)
      const incoming: PlacementAssignment = {
        id: `${id}-assignment-${existing.placementAssignments.length + 1}`,
        postId: outgoing.postId,
        employeeId: request.incomingEmployeeId,
        employeeName: incomingEmployee.name,
        acknowledgedAt: null,
      }
      const journalEntry: JournalEntry = {
        id: `${id}-journal-${existing.journalEntries.length + 1}`,
        type: 'REPLACEMENT',
        title: `Замена: ${post?.post ?? outgoing.postId}`,
        // ФИО в ростере оканчиваются на «.» (инициалы) — разделитель " — ",
        // а не точка сразу после имени, иначе получалось бы «Д.. Причина».
        description: `${outgoing.employeeName} → ${incomingEmployee.name} — причина: ${request.reasonCode.trim()}`,
        createdAt: clock.now(),
      }
      updated = {
        ...existing,
        placementAssignments: [
          ...existing.placementAssignments.filter((a) => a.id !== request.assignmentId),
          incoming,
        ],
        journalEntries: [journalEntry, ...existing.journalEntries],
        updatedAt: clock.now(),
      }
      return commitEvents(
        current,
        slice.events.map((e) => (e.id === id ? updated : e)),
      )
    })
    return updated
  }

  /** Закрытие ОМ (Epic 18.1 FR-30): итоги ВСЕХ направлений обязательны — не частичное закрытие. */
  async function closeSecurityEvent(
    id: string,
    request: CloseSecurityEventRequest,
    actorUserId: string | null,
  ): Promise<SecurityEvent> {
    if (!hasPermission(actorUserId, CLOSURE_PERMISSION)) {
      throw new RepositoryPermissionError(CLOSURE_PERMISSION)
    }
    const fieldErrors: Record<string, string[]> = {}
    request.directionSummaries.forEach((d, index) => {
      if (d.summary.trim() === '') {
        fieldErrors[`directionSummaries.${index}.summary`] = ['Обязательное поле.']
      }
    })
    if (Object.keys(fieldErrors).length > 0) {
      throw new RepositoryValidationError(fieldErrors)
    }

    let updated!: SecurityEvent
    await runMutation(adapter, clock, (current) => {
      const slice = readSlice(current)
      const existing = slice.events.find((e) => e.id === id)
      if (existing === undefined) {
        throw new RepositoryNotFoundError(id)
      }
      if (existing.stage !== 'CONDUCT') {
        throw new RepositoryBusinessRuleError(
          'INVALID_STAGE_TRANSITION',
          'Закрыть ОМ можно только на этапе «Проведение».',
        )
      }
      const directions = new Set(existing.reconSectorPosts.map((p) => p.sector))
      const coveredDirections = new Set(request.directionSummaries.map((d) => d.direction))
      const missing = [...directions].filter((d) => !coveredDirections.has(d))
      if (missing.length > 0) {
        throw new RepositoryBusinessRuleError(
          'CLOSURE_DIRECTIONS_INCOMPLETE',
          `Не хватает итогов направлений: ${missing.join(', ')}.`,
        )
      }
      updated = {
        ...existing,
        stage: 'CLOSED',
        closureDirectionSummaries: request.directionSummaries.map((d) => ({
          direction: d.direction,
          summary: d.summary.trim(),
        })),
        closedAt: clock.now(),
        updatedAt: clock.now(),
      }
      return commitEvents(
        current,
        slice.events.map((e) => (e.id === id ? updated : e)),
      )
    })
    return updated
  }

  return {
    list,
    get,
    create,
    listBindableObjects,
    getPassportView,
    updateBulletin,
    updateRecon,
    importReconPostsFromPassport,
    completeRecon,
    approveDemand,
    updateForceAllocation,
    completeForces,
    assignPlacement,
    unassignPlacement,
    completePlacement,
    approvePlacement,
    returnPlacement,
    acknowledgePlacement,
    completeAcknowledgement,
    addJournalEntry,
    replaceAssignment,
    closeSecurityEvent,
  }
}

export type SecurityEventsRepository = ReturnType<
  typeof createSecurityEventsRepository
>
