// Feature repository обратной связи (§8.5, §28): видимость обращений,
// серверное вырезание закрытого содержания, область поиска, страницы,
// создание и отправка черновика.
import type { DemoClock } from '../../../shared/testing/mock-runtime/demo-clock'
import { hasPermission } from '../../../shared/testing/mock-runtime/rbac-directory'
import type { PersistenceAdapter } from '../../../shared/testing/mock-runtime/persistence'
import { runMutation } from '../../../shared/testing/mock-runtime/transaction'
import {
  FEEDBACK_PAGE_SIZE,
  RESTRICTED_REASON,
  UNAVAILABLE_CAPABILITIES,
  buildStats,
  matchesFilters,
  pageCount,
  pageOf,
  previewOf,
  sortRequests,
} from '../lib/feedback'
import type { FeedbackSlice } from './fixtures'
import type {
  CreateFeedbackRequest,
  FeedbackRequestView,
  ListFeedbackFilters,
  ListFeedbackResponse,
} from '../api/pending-contracts'
import type { FeedbackRequest } from '../model/types'

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
    const registry = slice?.registry ?? {
      types: [],
      priorities: [],
      statuses: [],
      modules: [],
      registryVersion: 'unknown',
    }

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

  return { listFeedback, createFeedback, submitFeedback }
}
