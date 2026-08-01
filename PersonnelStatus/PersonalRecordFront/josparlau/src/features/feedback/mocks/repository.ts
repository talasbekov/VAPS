// Feature repository обратной связи (§8.5, §28): видимость обращений,
// серверное вырезание закрытого содержания, область поиска, страницы,
// создание и отправка черновика.
import type { DemoClock } from '../../../shared/testing/mock-runtime/demo-clock'
import { hasPermission } from '../../../shared/testing/mock-runtime/rbac-directory'
import type { PersistenceAdapter } from '../../../shared/testing/mock-runtime/persistence'
import { runMutation } from '../../../shared/testing/mock-runtime/transaction'
import {
  CLOSED_LOCK_REASON,
  FEEDBACK_PAGE_SIZE,
  INTERNAL_NOTE_REASON,
  REPLY_REASON,
  RESTRICTED_REASON,
  TRIAGE_REASON,
  UNAVAILABLE_CAPABILITIES,
  UNAVAILABLE_CARD_BLOCKS,
  allowedTransitions,
  buildStats,
  commentVisibleTo,
  diffEvents,
  eventVisibleTo,
  matchesFilters,
  pageCount,
  pageOf,
  previewOf,
  sortRequests,
} from '../lib/feedback'
import type { FeedbackSlice } from './fixtures'
import type {
  AddFeedbackCommentRequest,
  CloseFeedbackRequest,
  CreateFeedbackRequest,
  FeedbackDetailResponse,
  FeedbackDuplicateLink,
  FeedbackRequestView,
  ListFeedbackFilters,
  ListFeedbackResponse,
  TriageFeedbackRequest,
} from '../api/pending-contracts'
import type {
  FeedbackAction,
  FeedbackComment,
  FeedbackEvent,
  FeedbackRequest,
} from '../model/types'

export class RepositoryPermissionError extends Error {}
export class RepositoryNotFoundError extends Error {}
export class RepositoryBusinessRuleError extends Error {
  readonly errorCode: string
  constructor(errorCode: string, message: string) {
    super(message)
    this.errorCode = errorCode
  }
}

const SLICE_NAME = 'feedback'

/** §28: читать реестр обращений. Своих — всегда, чужих — только с VIEW_ALL. */
const VIEW_PERMISSION = 'ops.feedback.view'
/** Завести обращение. Отдельно от чтения: право пожаловаться и право читать
 * чужие жалобы — разные вещи. */
const CREATE_PERMISSION = 'ops.feedback.create'
/** Видеть ЧУЖИЕ обращения. Черновики этим правом НЕ открываются — см.
 * `isVisible`. */
const VIEW_ALL_PERMISSION = 'ops.feedback.view_all'
/** §28 create «confidential»: видеть СОДЕРЖАНИЕ чужого конфиденциального
 * обращения — отдельное разрешение, как «параметры чужого отчёта» (§22.26). */
const VIEW_CONFIDENTIAL_PERMISSION = 'ops.feedback.view_confidential'
/** §28 detail: разбирать обращение (ответственный, рабочий приоритет, статус,
 * закрытие). Право читать обращения его НЕ включает. */
const TRIAGE_PERMISSION = 'ops.feedback.triage'
/** §28 detail «internal note только по праву» — прямая формулировка промпта.
 * Отдельно от разбора: заметка пишется о человеке, обратившемся за помощью,
 * и право её вести — не то же, что право менять статус. */
const INTERNAL_NOTE_PERMISSION = 'ops.feedback.internal_note'

const EMPTY_REGISTRY = {
  types: [],
  priorities: [],
  statuses: [],
  modules: [],
  statusTransitions: [],
  terminalStatuses: [],
  registryVersion: 'unknown',
}

const MAX_SUBJECT = 160
const MAX_DESCRIPTION = 4000

function readSlice(slices: Record<string, unknown>): FeedbackSlice {
  const slice = slices[SLICE_NAME]
  if (slice === undefined) {
    throw new Error(
      `mock-runtime: слайс "${SLICE_NAME}" не засеян — проверь app/mocks/compose-seed.ts`,
    )
  }
  return slice as FeedbackSlice
}

export function createFeedbackRepository(adapter: PersistenceAdapter, clock: DemoClock) {
  function isOwn(request: FeedbackRequest, actorUserId: string | null): boolean {
    return actorUserId !== null && request.author.userId === actorUserId
  }

  /**
   * Кого смотрящий видит В РЕЕСТРЕ.
   *
   * Черновик — единственное, что НЕ открывается правом «видеть все
   * обращения»: §28 держит «Черновик» отдельным статусом, то есть обращением,
   * которое автор ещё не отправил. Показать его читателю значило бы отдать
   * недописанный текст без ведома написавшего — и никакое право этого не
   * меняет, потому что отправки не было.
   */
  function isVisible(request: FeedbackRequest, actorUserId: string | null): boolean {
    if (isOwn(request, actorUserId)) return true
    if (request.statusCode === 'DRAFT') return false
    return hasPermission(actorUserId, VIEW_ALL_PERMISSION)
  }

  /** Видно ли смотрящему СОДЕРЖАНИЕ обращения (описание и всё при нём). */
  function contentVisible(request: FeedbackRequest, actorUserId: string | null): boolean {
    if (!request.confidential) return true
    if (isOwn(request, actorUserId)) return true
    return hasPermission(actorUserId, VIEW_CONFIDENTIAL_PERMISSION)
  }

  /**
   * Проекция наружу. Тема, тип, приоритет, статус и модуль остаются видимыми
   * даже у конфиденциального обращения — иначе реестр перестаёт быть реестром:
   * такое обращение нельзя ни найти, ни отличить от дубликата, ни понять, к
   * какому разделу оно относится. Закрыто именно СОДЕРЖАНИЕ: описание,
   * ожидаемый результат, шаги, контакт, вложения и техническая информация.
   */
  function project(request: FeedbackRequest, actorUserId: string | null): FeedbackRequestView {
    const visible = contentVisible(request, actorUserId)
    return {
      feedbackId: request.feedbackId,
      subject: request.subject,
      typeCode: request.typeCode,
      priorityCode: request.priorityCode,
      statusCode: request.statusCode,
      moduleCode: request.moduleCode,
      authorLabel: request.author.safeLabel,
      createdAt: request.createdAt,
      submittedAt: request.submittedAt,
      confidential: request.confidential,
      // Разбор — решение СЛУЖБЫ об обращении, а не содержание обращения:
      // конфиденциальность закрывает второе и не закрывает первое.
      workingPriorityCode: request.workingPriorityCode,
      assigneeLabel: request.assignee?.safeLabel ?? null,
      assigneeUserId: request.assignee?.userId ?? null,
      isOwn: isOwn(request, actorUserId),
      description: visible ? request.description : null,
      // Превью — производное описания и вырезается ВМЕСТЕ с ним: оставить его
      // значило бы вернуть первые сто двадцать символов закрытого текста
      // соседним полем ответа (тот же класс, что `idempotencyKey` в §22.26).
      descriptionPreview: visible ? previewOf(request.description) : null,
      expectedResult: visible ? request.expectedResult : null,
      reproductionSteps: visible ? request.reproductionSteps : null,
      contact: visible ? request.contact : null,
      relatedRoute: visible ? request.relatedRoute : null,
      attachments: visible ? request.attachments : null,
      technicalInfo: visible ? request.technicalInfo : null,
      restrictedReason: visible ? null : RESTRICTED_REASON,
    }
  }

  async function listFeedback(
    actorUserId: string | null,
    filters: ListFeedbackFilters = {},
  ): Promise<ListFeedbackResponse> {
    if (!hasPermission(actorUserId, VIEW_PERMISSION)) {
      throw new RepositoryPermissionError(VIEW_PERMISSION)
    }
    const envelope = await adapter.load()
    const slice = envelope === null ? null : readSlice(envelope.slices)
    const registry = slice?.registry ?? EMPTY_REGISTRY

    const all = sortRequests(slice?.requests ?? [])
    const visible = all.filter((request) => isVisible(request, actorUserId))
    const mine = filters.mine === true ? visible.filter((r) => isOwn(r, actorUserId)) : visible

    const matched = mine.filter((request) =>
      matchesFilters(
        request,
        {
          search: filters.search ?? '',
          typeCode: filters.typeCode,
          statusCode: filters.statusCode,
          moduleCode: filters.moduleCode,
        },
        // Область поиска — по ВИДИМЫМ смотрящему полям: см. `matchesSearch`.
        contentVisible(request, actorUserId),
      ),
    )

    const requestedPage = filters.page ?? 1
    const total = pageCount(matched.length, FEEDBACK_PAGE_SIZE)
    // Страница за пределами набора — не ошибка запроса, а следствие того, что
    // между открытием и переходом реестр изменился: отдаём последнюю.
    const page = Math.min(Math.max(1, requestedPage), total)

    return {
      results: pageOf(matched, page, FEEDBACK_PAGE_SIZE).map((request) =>
        project(request, actorUserId),
      ),
      // Сводка — по всему ВИДИМОМУ набору, до фильтров и до страниц.
      stats: buildStats(
        visible,
        registry.statuses.map((entry) => entry.code),
      ),
      registry,
      page,
      pageSize: FEEDBACK_PAGE_SIZE,
      pageCount: total,
      totalMatched: matched.length,
      totalVisible: visible.length,
      unavailableCapabilities: [...UNAVAILABLE_CAPABILITIES],
      serverTime: clock.now(),
    }
  }

  function validate(body: CreateFeedbackRequest, slice: FeedbackSlice): void {
    if (body.subject.trim() === '') {
      throw new RepositoryBusinessRuleError('VALIDATION_ERROR', 'Тема обращения обязательна.')
    }
    if (body.subject.length > MAX_SUBJECT) {
      throw new RepositoryBusinessRuleError(
        'VALIDATION_ERROR',
        `Тема длиннее ${MAX_SUBJECT} символов.`,
      )
    }
    if (body.description.trim() === '') {
      throw new RepositoryBusinessRuleError('VALIDATION_ERROR', 'Описание обращения обязательно.')
    }
    if (body.description.length > MAX_DESCRIPTION) {
      throw new RepositoryBusinessRuleError(
        'VALIDATION_ERROR',
        `Описание длиннее ${MAX_DESCRIPTION} символов.`,
      )
    }
    // Коды сверяются со СПРАВОЧНИКОМ, а не с типом: тип проверяет компилятор
    // у нашего же кода, а сюда приходит тело запроса.
    if (!slice.registry.types.some((entry) => entry.code === body.typeCode)) {
      throw new RepositoryBusinessRuleError('VALIDATION_ERROR', 'Неизвестный тип обращения.')
    }
    if (!slice.registry.priorities.some((entry) => entry.code === body.priorityCode)) {
      throw new RepositoryBusinessRuleError('VALIDATION_ERROR', 'Неизвестный приоритет.')
    }
    if (!slice.registry.modules.some((entry) => entry.moduleCode === body.moduleCode)) {
      throw new RepositoryBusinessRuleError('VALIDATION_ERROR', 'Неизвестный модуль.')
    }
  }

  async function createFeedback(
    body: CreateFeedbackRequest,
    actorUserId: string | null,
  ): Promise<FeedbackRequest> {
    if (!hasPermission(actorUserId, CREATE_PERMISSION)) {
      throw new RepositoryPermissionError(CREATE_PERMISSION)
    }
    let created: FeedbackRequest | null = null
    await runMutation(adapter, clock, (current) => {
      const slice = readSlice(current.slices)
      validate(body, slice)
      const now = clock.now()
      const draft = body.saveAsDraft
      const request: FeedbackRequest = {
        // Идентификатор — из revision снапшота и позиции, как у остальных
        // repositories проекта: он обязан быть URL-безопасным (путь отправки
        // черновика) и устойчивым между перезагрузками.
        feedbackId: `feedback-${current.revision + 1}-${slice.requests.length + 1}`,
        subject: body.subject.trim(),
        description: body.description.trim(),
        typeCode: body.typeCode,
        priorityCode: body.priorityCode,
        statusCode: draft ? 'DRAFT' : 'NEW',
        moduleCode: body.moduleCode,
        expectedResult: body.expectedResult,
        reproductionSteps: body.reproductionSteps,
        // §28 «attachment metadata»: наружу берутся РОВНО три поля. Любое
        // лишнее поле тела (в том числе содержимое файла) сюда не попадает —
        // не потому, что его отфильтровали, а потому, что запись собирается
        // поимённо и месту для него неоткуда взяться.
        attachments: body.attachments.map((file) => ({
          fileName: file.fileName,
          sizeBytes: file.sizeBytes,
          mimeType: file.mimeType,
        })),
        contact: body.contact,
        confidential: body.confidential,
        relatedRoute: body.relatedRoute,
        // Согласие решает СЕРВЕР. Присланная без согласия техническая
        // информация не сохраняется: тело запроса согласия не заменяет, иначе
        // «include technical info» был бы галочкой, ни на что не влияющей.
        technicalInfo: body.includeTechnicalInfo ? body.technicalInfo : null,
        // Разбор ещё не начинался: рабочий приоритет и ответственный — не
        // копия заявленного и не пустая строка, а отсутствие решения.
        workingPriorityCode: null,
        assignee: null,
        duplicateOfId: null,
        author: { userId: actorUserId ?? '', safeLabel: actorUserId ?? '' },
        createdAt: now,
        submittedAt: draft ? null : now,
        updatedAt: now,
      }
      created = request
      return {
        ...current.slices,
        [SLICE_NAME]: { ...slice, requests: [...slice.requests, request] },
      }
    })
    if (created === null) throw new Error('mock-runtime: обращение не создано')
    return created
  }

  /**
   * §28 «Черновик» → «Новое». Отправить можно ТОЛЬКО свой черновик: чужой не
   * виден вовсе, а свой уже отправленный второй отправки не имеет.
   */
  async function submitFeedback(
    feedbackId: string,
    actorUserId: string | null,
  ): Promise<FeedbackRequest> {
    if (!hasPermission(actorUserId, CREATE_PERMISSION)) {
      throw new RepositoryPermissionError(CREATE_PERMISSION)
    }
    let updated: FeedbackRequest | null = null
    await runMutation(adapter, clock, (current) => {
      const slice = readSlice(current.slices)
      const request = slice.requests.find((item) => item.feedbackId === feedbackId)
      // Невидимое обращение — 404, а не 403: отказ по праву подтвердил бы, что
      // обращение с таким идентификатором существует.
      if (request === undefined || !isVisible(request, actorUserId)) {
        throw new RepositoryNotFoundError(feedbackId)
      }
      if (!isOwn(request, actorUserId)) {
        throw new RepositoryNotFoundError(feedbackId)
      }
      if (request.statusCode !== 'DRAFT') {
        throw new RepositoryBusinessRuleError(
          'FEEDBACK_ALREADY_SUBMITTED',
          'Обращение уже отправлено.',
        )
      }
      const now = clock.now()
      const next: FeedbackRequest = {
        ...request,
        statusCode: 'NEW',
        submittedAt: now,
        updatedAt: now,
      }
      updated = next
      return {
        ...current.slices,
        [SLICE_NAME]: {
          ...slice,
          requests: slice.requests.map((item) =>
            item.feedbackId === feedbackId ? next : item,
          ),
        },
      }
    })
    if (updated === null) throw new Error('mock-runtime: обращение не отправлено')
    return updated
  }


  // ─── Карточка обращения (§28 detail) ──────────────────────────────────────

  function canTriage(actorUserId: string | null): boolean {
    return hasPermission(actorUserId, TRIAGE_PERMISSION)
  }

  function canSeeInternal(actorUserId: string | null): boolean {
    return hasPermission(actorUserId, INTERNAL_NOTE_PERMISSION)
  }

  function isTerminal(request: FeedbackRequest, slice: FeedbackSlice): boolean {
    return slice.registry.terminalStatuses.includes(request.statusCode)
  }

  /**
   * Действия карточки считает СЕРВЕР — по статусу, правам и замку закрытого
   * обращения. Компонент не знает ни одного из этих условий.
   */
  function buildActions(
    request: FeedbackRequest,
    actorUserId: string | null,
    slice: FeedbackSlice,
  ): FeedbackAction[] {
    const closed = isTerminal(request, slice)
    const draft = request.statusCode === 'DRAFT'
    const triage = canTriage(actorUserId)
    const own = isOwn(request, actorUserId)

    function action(
      code: FeedbackAction['code'],
      allowed: boolean,
      reason: string,
    ): FeedbackAction {
      // Замок закрытого обращения проверяется ПЕРВЫМ и одинаково для всех
      // действий: иначе причина отказа зависела бы от прав смотрящего, и один
      // и тот же закрытый разговор объяснялся бы по-разному.
      if (closed) return { code, available: false, reason: CLOSED_LOCK_REASON }
      if (draft) {
        return {
          code,
          available: false,
          reason: 'Обращение ещё не отправлено: черновик не разбирают и не комментируют.',
        }
      }
      return allowed ? { code, available: true, reason: null } : { code, available: false, reason }
    }

    return [
      // Публичный ответ пишет разбирающий ИЛИ автор: обращение — разговор, а
      // не форма, отправленная в один конец.
      action('ADD_PUBLIC_REPLY', triage || own, REPLY_REASON),
      action('ADD_INTERNAL_NOTE', canSeeInternal(actorUserId), INTERNAL_NOTE_REASON),
      action('TRIAGE', triage, TRIAGE_REASON),
      action('CLOSE', triage, TRIAGE_REASON),
    ]
  }

  /** Ссылка на оригинал у признанного дубликата. */
  function duplicateLink(
    request: FeedbackRequest,
    actorUserId: string | null,
    slice: FeedbackSlice,
  ): FeedbackDuplicateLink | null {
    if (request.duplicateOfId === null) return null
    const target = slice.requests.find((item) => item.feedbackId === request.duplicateOfId)
    // Тема оригинала показывается ТОЛЬКО если он и сам видим смотрящему:
    // иначе ссылка на дубликат стала бы обходным путём к чужому обращению.
    if (target === undefined || !isVisible(target, actorUserId)) {
      return {
        feedbackId: request.duplicateOfId,
        subject: null,
        hiddenReason: 'Обращение-оригинал недоступно смотрящему.',
      }
    }
    return { feedbackId: target.feedbackId, subject: target.subject, hiddenReason: null }
  }

  async function getFeedback(
    feedbackId: string,
    actorUserId: string | null,
  ): Promise<FeedbackDetailResponse> {
    if (!hasPermission(actorUserId, VIEW_PERMISSION)) {
      throw new RepositoryPermissionError(VIEW_PERMISSION)
    }
    const envelope = await adapter.load()
    const slice = envelope === null ? null : readSlice(envelope.slices)
    const request = slice?.requests.find((item) => item.feedbackId === feedbackId)
    // Невидимое обращение — 404: отказ по праву подтвердил бы его существование.
    if (slice === undefined || slice === null || request === undefined) {
      throw new RepositoryNotFoundError(feedbackId)
    }
    if (!isVisible(request, actorUserId)) throw new RepositoryNotFoundError(feedbackId)

    const internal = canSeeInternal(actorUserId)
    return {
      request: project(request, actorUserId),
      comments: slice.comments
        .filter((comment) => comment.feedbackId === feedbackId)
        .filter((comment) => commentVisibleTo(comment.kind, internal))
        .sort((left, right) => (left.createdAt < right.createdAt ? -1 : 1))
        .map((comment) => ({
          commentId: comment.commentId,
          kind: comment.kind,
          body: comment.body,
          authorLabel: comment.author.safeLabel,
          createdAt: comment.createdAt,
        })),
      timeline: slice.events
        .filter((event) => event.feedbackId === feedbackId)
        .filter((event) => eventVisibleTo(event.kind, internal))
        .sort((left, right) => (left.at < right.at ? -1 : 1))
        .map((event) => ({
          eventId: event.eventId,
          kind: event.kind,
          actorLabel: event.actor.safeLabel,
          at: event.at,
          fieldCode: event.fieldCode,
          oldValue: event.oldValue,
          newValue: event.newValue,
        })),
      actions: buildActions(request, actorUserId, slice),
      allowedStatuses: allowedTransitions(slice.registry, request.statusCode),
      // Кандидаты в ответственные — те, кто УЖЕ участвовал в обращениях:
      // справочника сотрудников поддержки в demo-срезе нет, и выдумывать его
      // значило бы обещать роли, которых никто не назначал.
      assigneeCandidates: [
        ...new Map(
          slice.requests
            .flatMap((item) => (item.assignee === null ? [] : [item.assignee]))
            .concat(slice.comments.map((comment) => comment.author))
            .map((person) => [person.userId, person]),
        ).values(),
      ],
      duplicateOf: duplicateLink(request, actorUserId, slice),
      registry: slice.registry,
      unavailableBlocks: [...UNAVAILABLE_CARD_BLOCKS],
      serverTime: clock.now(),
    }
  }

  /** Единственная точка записи изменений карточки: сравнивает «до» и «после»
   * и сама дописывает ленту. Операции о ленте не знают. */
  function commitChange(
    slice: FeedbackSlice,
    before: FeedbackRequest,
    after: FeedbackRequest,
    actor: { userId: string; safeLabel: string },
    extraEvents: FeedbackEvent['kind'][],
    nowIso: string,
    seq: number,
  ): FeedbackSlice {
    const changes = diffEvents(
      {
        statusCode: before.statusCode,
        workingPriorityCode: before.workingPriorityCode,
        assigneeUserId: before.assignee?.userId ?? null,
        duplicateOfId: before.duplicateOfId,
      },
      {
        statusCode: after.statusCode,
        workingPriorityCode: after.workingPriorityCode,
        assigneeUserId: after.assignee?.userId ?? null,
        duplicateOfId: after.duplicateOfId,
      },
      slice.registry.terminalStatuses,
    )
    const events: FeedbackEvent[] = [
      ...extraEvents.map((kind, index) => ({
        eventId: `fbe-${seq}-x${index + 1}`,
        feedbackId: after.feedbackId,
        kind,
        actor,
        at: nowIso,
        fieldCode: null,
        oldValue: null,
        newValue: null,
      })),
      ...changes.map((change, index) => ({
        eventId: `fbe-${seq}-${index + 1}`,
        feedbackId: after.feedbackId,
        kind: change.kind,
        actor,
        at: nowIso,
        fieldCode: change.fieldCode,
        oldValue: change.oldValue,
        newValue: change.newValue,
      })),
    ]
    return {
      ...slice,
      requests: slice.requests.map((item) =>
        item.feedbackId === after.feedbackId ? after : item,
      ),
      events: [...slice.events, ...events],
    }
  }

  function requireOpen(request: FeedbackRequest, slice: FeedbackSlice): void {
    if (isTerminal(request, slice)) {
      throw new RepositoryBusinessRuleError('FEEDBACK_CLOSED', CLOSED_LOCK_REASON)
    }
    if (request.statusCode === 'DRAFT') {
      throw new RepositoryBusinessRuleError(
        'FEEDBACK_NOT_SUBMITTED',
        'Черновик не разбирают и не комментируют: он ещё не отправлен.',
      )
    }
  }

  function locate(
    slice: FeedbackSlice,
    feedbackId: string,
    actorUserId: string | null,
  ): FeedbackRequest {
    const request = slice.requests.find((item) => item.feedbackId === feedbackId)
    if (request === undefined || !isVisible(request, actorUserId)) {
      throw new RepositoryNotFoundError(feedbackId)
    }
    return request
  }

  async function addComment(
    body: AddFeedbackCommentRequest,
    actorUserId: string | null,
  ): Promise<{ feedbackId: string }> {
    if (!hasPermission(actorUserId, VIEW_PERMISSION)) {
      throw new RepositoryPermissionError(VIEW_PERMISSION)
    }
    await runMutation(adapter, clock, (current) => {
      const slice = readSlice(current.slices)
      const request = locate(slice, body.feedbackId, actorUserId)
      requireOpen(request, slice)
      if (body.body.trim() === '') {
        throw new RepositoryBusinessRuleError('VALIDATION_ERROR', 'Комментарий пуст.')
      }
      if (body.kind === 'INTERNAL_NOTE' && !canSeeInternal(actorUserId)) {
        throw new RepositoryPermissionError(INTERNAL_NOTE_PERMISSION)
      }
      if (
        body.kind === 'PUBLIC_REPLY' &&
        !canTriage(actorUserId) &&
        !isOwn(request, actorUserId)
      ) {
        throw new RepositoryPermissionError(TRIAGE_PERMISSION)
      }
      const now = clock.now()
      const actor = { userId: actorUserId ?? '', safeLabel: actorUserId ?? '' }
      const comment: FeedbackComment = {
        commentId: `fbc-${current.revision + 1}-${slice.comments.length + 1}`,
        feedbackId: body.feedbackId,
        kind: body.kind,
        body: body.body.trim(),
        author: actor,
        createdAt: now,
      }
      // Комментарий полей обращения не меняет — событие ленты приходит
      // отдельным списком, а не диффом (диффу нечего сравнивать).
      const withEvent = commitChange(
        slice,
        request,
        { ...request, updatedAt: now },
        actor,
        [body.kind === 'PUBLIC_REPLY' ? 'PUBLIC_REPLY_ADDED' : 'INTERNAL_NOTE_ADDED'],
        now,
        slice.events.length + 1,
      )
      return {
        ...current.slices,
        [SLICE_NAME]: { ...withEvent, comments: [...slice.comments, comment] },
      }
    })
    return { feedbackId: body.feedbackId }
  }

  async function triageFeedback(
    body: TriageFeedbackRequest,
    actorUserId: string | null,
  ): Promise<{ feedbackId: string }> {
    if (!canTriage(actorUserId)) throw new RepositoryPermissionError(TRIAGE_PERMISSION)
    await runMutation(adapter, clock, (current) => {
      const slice = readSlice(current.slices)
      const request = locate(slice, body.feedbackId, actorUserId)
      requireOpen(request, slice)

      let next: FeedbackRequest = { ...request, updatedAt: clock.now() }
      if (body.statusCode !== undefined) {
        // Переход сверяется с КАРТОЙ справочника, а не с «любым непустым
        // статусом»: порядок разбора принадлежит службе, а не запросу.
        if (!allowedTransitions(slice.registry, request.statusCode).includes(body.statusCode)) {
          throw new RepositoryBusinessRuleError(
            'FEEDBACK_TRANSITION_NOT_ALLOWED',
            'Такой переход статуса не разрешён справочником.',
          )
        }
        // Закрытие — отдельная операция со своим публичным ответом: разрешить
        // его здесь значило бы закрыть обращение молча.
        if (slice.registry.terminalStatuses.includes(body.statusCode)) {
          throw new RepositoryBusinessRuleError(
            'FEEDBACK_USE_CLOSE',
            'Закрытие обращения оформляется отдельным действием с ответом автору.',
          )
        }
        next = { ...next, statusCode: body.statusCode }
      }
      if (body.assigneeUserId !== undefined) {
        next = {
          ...next,
          assignee:
            body.assigneeUserId === null
              ? null
              : { userId: body.assigneeUserId, safeLabel: body.assigneeUserId },
        }
      }
      if (body.workingPriorityCode !== undefined) {
        if (
          body.workingPriorityCode !== null &&
          !slice.registry.priorities.some((entry) => entry.code === body.workingPriorityCode)
        ) {
          throw new RepositoryBusinessRuleError('VALIDATION_ERROR', 'Неизвестный приоритет.')
        }
        next = { ...next, workingPriorityCode: body.workingPriorityCode }
      }
      const actor = { userId: actorUserId ?? '', safeLabel: actorUserId ?? '' }
      return {
        ...current.slices,
        [SLICE_NAME]: commitChange(
          slice,
          request,
          next,
          actor,
          [],
          clock.now(),
          slice.events.length + 1,
        ),
      }
    })
    return { feedbackId: body.feedbackId }
  }

  async function closeFeedback(
    body: CloseFeedbackRequest,
    actorUserId: string | null,
  ): Promise<{ feedbackId: string }> {
    if (!canTriage(actorUserId)) throw new RepositoryPermissionError(TRIAGE_PERMISSION)
    await runMutation(adapter, clock, (current) => {
      const slice = readSlice(current.slices)
      const request = locate(slice, body.feedbackId, actorUserId)
      requireOpen(request, slice)

      if (!slice.registry.terminalStatuses.includes(body.statusCode)) {
        throw new RepositoryBusinessRuleError(
          'VALIDATION_ERROR',
          'Закрыть обращение можно только терминальным статусом.',
        )
      }
      if (!allowedTransitions(slice.registry, request.statusCode).includes(body.statusCode)) {
        throw new RepositoryBusinessRuleError(
          'FEEDBACK_TRANSITION_NOT_ALLOWED',
          'Такой переход статуса не разрешён справочником.',
        )
      }
      if (body.publicReply.trim() === '') {
        throw new RepositoryBusinessRuleError(
          'VALIDATION_ERROR',
          'Закрытие сопровождается ответом автору.',
        )
      }
      let duplicateOfId = request.duplicateOfId
      if (body.statusCode === 'DUPLICATE') {
        const targetId = body.duplicateOfId ?? null
        if (targetId === null) {
          throw new RepositoryBusinessRuleError(
            'VALIDATION_ERROR',
            'Признание дубликатом требует указать обращение-оригинал.',
          )
        }
        if (targetId === request.feedbackId) {
          throw new RepositoryBusinessRuleError(
            'VALIDATION_ERROR',
            'Обращение не может быть дубликатом самого себя.',
          )
        }
        // Оригинал обязан быть ВИДИМ закрывающему: сослаться на обращение,
        // которого он не видит, значит утверждать о содержимом вслепую.
        const target = slice.requests.find((item) => item.feedbackId === targetId)
        if (target === undefined || !isVisible(target, actorUserId)) {
          throw new RepositoryNotFoundError(targetId)
        }
        duplicateOfId = targetId
      }

      const now = clock.now()
      const actor = { userId: actorUserId ?? '', safeLabel: actorUserId ?? '' }
      const next: FeedbackRequest = {
        ...request,
        statusCode: body.statusCode,
        duplicateOfId,
        updatedAt: now,
      }
      const comment: FeedbackComment = {
        commentId: `fbc-${current.revision + 1}-${slice.comments.length + 1}`,
        feedbackId: body.feedbackId,
        kind: 'PUBLIC_REPLY',
        body: body.publicReply.trim(),
        author: actor,
        createdAt: now,
      }
      const committed = commitChange(
        slice,
        request,
        next,
        actor,
        ['PUBLIC_REPLY_ADDED'],
        now,
        slice.events.length + 1,
      )
      return {
        ...current.slices,
        [SLICE_NAME]: { ...committed, comments: [...slice.comments, comment] },
      }
    })
    return { feedbackId: body.feedbackId }
  }

  return { listFeedback, createFeedback, submitFeedback, getFeedback, addComment, triageFeedback, closeFeedback }
}
